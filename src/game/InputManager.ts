/**
 * Keyboard, mouse, gamepad and on-screen touch input, folded into game actions.
 *
 * "Pressed" edges are kept until a fixed simulation step has seen them, then cleared by endStep().
 * That way a press is never lost on a fast display (no step this frame) and never handled twice on a
 * slow one (several steps in one frame). Gamepad and touch buttons use synthetic codes
 * ('Pad:A', 'Touch:Jump' …) so every source goes through the same sets.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private dragging = false;
  private mouseHeld = false;
  private rightHeld = false;
  /** Left stick / touch joystick, x = right, z = forward. */
  private stick = { x: 0, z: 0 };
  private touchStick = { x: 0, z: 0 };
  private padLook = { x: 0, y: 0 };
  private padTriggers = { lt: 0, rt: 0 };
  /** Borderlands-style sprint: tap Shift once and keep running until you stop. */
  private sprintLatched = false;
  private stillTime = 0;
  /** Time since the last keyboard/mouse event vs. pad/touch event (for UI hints). */
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (isGameKey(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) this.pressed.add(e.code);
      if (!e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.sprintLatched = !this.sprintLatched;
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.sprintLatched = false;
      this.dragging = false;
      this.mouseHeld = false;
      this.rightHeld = false;
    });

    // Click captures the mouse for camera look; Esc releases it (browser default).
    canvas.addEventListener('mousedown', (e) => {
      this.lastDevice = 'keyboard';
      if (e.button === 2) this.rightHeld = true;
      if (e.button === 0) {
        if (document.pointerLockElement !== canvas) {
          // Some browsers return a promise that rejects when lock isn't allowed (iframes, hidden tabs);
          // dragging still turns the camera then.
          const req = canvas.requestPointerLock?.() as unknown;
          if (req instanceof Promise) req.catch(() => {});
        }
        this.mouseHeld = true;
        this.dragging = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.rightHeld = false;
      if (e.button === 0) {
        this.mouseHeld = false;
        this.dragging = false;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Read the gamepad and update the sprint latch once per rendered frame. */
  poll(dt: number): void {
    this.pollPad(dt);
    // Sprint stays on while you keep moving; stopping (or free-aiming) ends it
    const a = this.moveAxis();
    this.stillTime = Math.hypot(a.x, a.z) < 0.15 ? this.stillTime + dt : 0;
    if (this.stillTime > 0.3 || this.freeAim) this.sprintLatched = false;
  }

  private pollPad(dt: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) {
      this.stick = { x: 0, z: 0 };
      this.padLook = { x: 0, y: 0 };
      this.padTriggers = { lt: 0, rt: 0 };
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.stick = { x: dz(pad.axes[0] ?? 0), z: -dz(pad.axes[1] ?? 0) };
    this.padLook = { x: dz(pad.axes[2] ?? 0), y: dz(pad.axes[3] ?? 0) };
    this.mouseDX += this.padLook.x * dt * 900;
    this.mouseDY += this.padLook.y * dt * 700;
    this.padTriggers = { lt: pad.buttons[6]?.value ?? 0, rt: pad.buttons[7]?.value ?? 0 };
    const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS'];
    names.forEach((n, i) => {
      const code = `Pad:${n}`;
      const isDown = !!pad.buttons[i]?.pressed;
      if (isDown && !this.down.has(code)) {
        this.pressed.add(code);
        this.lastDevice = 'gamepad';
        if (n === 'LS' || n === 'LB') this.sprintLatched = !this.sprintLatched;
      }
      if (isDown) this.down.add(code);
      else this.down.delete(code);
    });
    if (this.stick.x || this.stick.z || this.padLook.x || this.padLook.y) this.lastDevice = 'gamepad';
  }

  // ───────────────────────────────────────────── touch hooks (ui/TouchControls)

  setTouchStick(x: number, z: number): void {
    this.touchStick = { x, z };
    this.lastDevice = 'touch';
  }

  touchButton(name: string, isDown: boolean): void {
    const code = `Touch:${name}`;
    if (isDown && !this.down.has(code)) {
      this.pressed.add(code);
      if (name === 'Boost') this.sprintLatched = !this.sprintLatched;
    }
    if (isDown) this.down.add(code);
    else this.down.delete(code);
    this.lastDevice = 'touch';
  }

  addLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  // ───────────────────────────────────────────── actions

  private any(codes: string[], set: Set<string>): boolean {
    return codes.some((c) => set.has(c));
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Movement intent: x = strafe right, z = forward. Length ≤ 1. */
  moveAxis(): { x: number; z: number } {
    const k = (a: string, b: string) => (this.isDown(a) || this.isDown(b) ? 1 : 0);
    let x = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + this.stick.x + this.touchStick.x;
    let z = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + this.stick.z + this.touchStick.z;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  /**
   * Sprint on foot / in walk mode, boost in flight and race. Tap Shift (L3/LB, or the touch Boost
   * button) once to start; it keeps going until you stop moving, free-aim, or tap again.
   */
  get sprint(): boolean {
    return this.sprintLatched || this.padTriggers.lt > 0.4;
  }

  get interact(): boolean {
    return this.any(['KeyE', 'KeyF', 'Pad:X', 'Touch:Act'], this.pressed);
  }

  /** Advance dialogue / close panels. */
  get confirm(): boolean {
    return this.any(['KeyE', 'KeyF', 'Space', 'Enter', 'Pad:A', 'Pad:X', 'Touch:Act', 'Touch:Jump'], this.pressed);
  }

  get cancel(): boolean {
    return this.any(['Escape', 'Pad:B', 'Pad:Start'], this.pressed);
  }

  get jump(): boolean {
    return this.any(['Space', 'Pad:A', 'Touch:Jump'], this.pressed);
  }

  /** Use up this step's jump press (so one press doesn't trigger two things). */
  consumeJump(): void {
    for (const c of ['Space', 'Pad:A', 'Touch:Jump']) this.pressed.delete(c);
  }

  /** Held: climb in flight, handbrake for cars. */
  get ascend(): boolean {
    return this.any(['Space', 'Pad:A', 'Touch:Jump'], this.down);
  }

  get descend(): boolean {
    return this.any(['ControlLeft', 'ControlRight', 'KeyC', 'Pad:B', 'Touch:Down'], this.down);
  }

  get fire(): boolean {
    return this.mouseHeld || this.any(['KeyJ', 'Touch:Fire'], this.down) || this.padTriggers.rt > 0.4;
  }

  /** Hold to aim freely with the mouse instead of auto-aim. */
  get freeAim(): boolean {
    return this.rightHeld || this.isDown('KeyK');
  }

  /** Mode switch request: 1/2/3 direct, Q / RB / touch to cycle. */
  modeRequest(): 'walk' | 'flight' | 'race' | 'boat' | 'cycle' | null {
    if (this.pressed.has('Digit1')) return 'walk';
    if (this.pressed.has('Digit2')) return 'flight';
    if (this.pressed.has('Digit3')) return 'race';
    if (this.pressed.has('Digit4')) return 'boat';
    if (this.any(['KeyQ', 'Pad:RB', 'Pad:Y', 'Touch:Mode'], this.pressed)) return 'cycle';
    return null;
  }

  get toggleMusic(): boolean {
    return this.pressed.has('KeyM');
  }

  /** Mouse movement since the last call, in pixels. */
  consumeMouse(): { dx: number; dy: number } {
    const m = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return m;
  }

  /** Call after each fixed simulation step. */
  endStep(): void {
    this.pressed.clear();
  }
}

function isGameKey(code: string): boolean {
  return code === 'Space' || code.startsWith('Arrow') || code === 'ControlLeft';
}
