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
  private padDpad = { up: false, down: false };
  /** Borderlands-style sprint: tap Shift once and keep running until you stop. */
  private sprintLatched = false;
  private stillTime = 0;
  /** Camera zoom steps since the last read (+ = closer). */
  private zoomSteps = 0;
  private zoomResetPressed = false;
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
      if (e.button === 1) {
        e.preventDefault();
        this.zoomResetPressed = true;
      }
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
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomSteps += -Math.sign(e.deltaY) * Math.min(3, Math.max(1, Math.abs(e.deltaY) / 100));
      },
      { passive: false },
    );
  }

  /** Zoom in (+) / out (−) by buttons, e.g. the HUD zoom icons. */
  zoomBy(steps: number): void {
    this.zoomSteps += steps;
  }

  resetZoom(): void {
    this.zoomResetPressed = true;
  }

  /** Zoom request since the last call: steps (+ closer) and whether to reset. */
  consumeZoom(dt: number): { steps: number; reset: boolean } {
    let steps = this.zoomSteps;
    if (this.any(['Equal', 'NumpadAdd'], this.down)) steps += dt * 4;
    if (this.any(['Minus', 'NumpadSubtract'], this.down)) steps -= dt * 4;
    if (this.padDpad.up) steps += dt * 4;
    if (this.padDpad.down) steps -= dt * 4;
    const reset = this.zoomResetPressed || this.any(['Digit0', 'Numpad0', 'Pad:RS'], this.pressed);
    this.zoomSteps = 0;
    this.zoomResetPressed = false;
    return { steps, reset };
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Read the gamepad and update the sprint latch once per rendered frame. */
  poll(dt: number): void {
    this.pollPad(dt);
    // Arrow keys turn and tilt the camera like the mouse (WASD moves)
    const turn = (this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('ArrowLeft') ? 1 : 0);
    const tilt = (this.isDown('ArrowDown') ? 1 : 0) - (this.isDown('ArrowUp') ? 1 : 0);
    this.mouseDX += turn * dt * 700;
    this.mouseDY += tilt * dt * 450;
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
      this.padDpad = { up: false, down: false };
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.stick = { x: dz(pad.axes[0] ?? 0), z: -dz(pad.axes[1] ?? 0) };
    this.padLook = { x: dz(pad.axes[2] ?? 0), y: dz(pad.axes[3] ?? 0) };
    this.mouseDX += this.padLook.x * dt * 900;
    this.mouseDY += this.padLook.y * dt * 700;
    this.padTriggers = { lt: pad.buttons[6]?.value ?? 0, rt: pad.buttons[7]?.value ?? 0 };
    this.padDpad = { up: !!pad.buttons[12]?.pressed, down: !!pad.buttons[13]?.pressed };
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
    const k = (code: string) => (this.isDown(code) ? 1 : 0);
    let x = k('KeyD') - k('KeyA') + this.stick.x + this.touchStick.x;
    let z = k('KeyW') - k('KeyS') + this.stick.z + this.touchStick.z;
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
    return this.any(['KeyE', 'Pad:X', 'Touch:Act'], this.pressed);
  }

  /** Advance dialogue / close panels. */
  get confirm(): boolean {
    return this.any(['KeyE', 'Space', 'Enter', 'Pad:A', 'Pad:X', 'Touch:Act', 'Touch:Jump'], this.pressed);
  }

  get cancel(): boolean {
    return this.any(['Escape', 'Pad:B'], this.pressed);
  }

  /** Open / close the menu: Tab, P, gamepad Start, the touch Menu button. */
  get menuToggle(): boolean {
    return this.any(['Tab', 'KeyP', 'Pad:Start', 'Touch:Menu'], this.pressed);
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
  modeRequest(): 'walk' | 'flight' | 'race' | 'cycle' | null {
    if (this.pressed.has('Digit1')) return 'walk';
    if (this.pressed.has('Digit2')) return 'flight';
    if (this.pressed.has('Digit3') || this.pressed.has('KeyV')) return 'race';
    if (this.any(['KeyQ', 'Pad:RB', 'Pad:Y', 'Touch:Mode'], this.pressed)) return 'cycle';
    return null;
  }

  /** Toggle the Raptor following you around on foot (F). */
  get toggleFollow(): boolean {
    return this.pressed.has('KeyF');
  }

  /** Use a cookie: feed the Raptor, or throw one as a lure (T / gamepad Back). */
  get treat(): boolean {
    return this.any(['KeyT', 'Pad:Back'], this.pressed);
  }

  /** Punch / kick (X on foot; giant punch on the Raptor in Giant Mode). */
  get melee(): boolean {
    return this.any(['KeyX', 'Pad:B', 'Touch:Punch'], this.pressed);
  }

  /** Gadget wheel: next Lab Gun (Z), or pick one with 1–5 (on foot). */
  gunRequest(): 'cycle' | 0 | 1 | 2 | 3 | 4 | null {
    if (this.any(['KeyZ', 'Pad:Y', 'Touch:Gun'], this.pressed)) return 'cycle';
    for (let i = 0; i < 5; i++) if (this.pressed.has(`Digit${i + 1}`)) return i as 0 | 1 | 2 | 3 | 4;
    return null;
  }

  /** Giant Mode (G, on the Raptor). */
  get giantToggle(): boolean {
    return this.pressed.has('KeyG');
  }

  /** Quick-travel map (N). */
  get mapToggle(): boolean {
    return this.pressed.has('KeyN');
  }

  /** Call the Raptor to you (R). */
  get callRaptor(): boolean {
    return this.pressed.has('KeyR');
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
  return code === 'Space' || code.startsWith('Arrow') || code === 'ControlLeft' || code === 'Tab';
}
