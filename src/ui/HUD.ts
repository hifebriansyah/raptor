import {
  Bot,
  CarFront,
  Coins,
  Cookie,
  Crosshair,
  Droplets,
  Eye,
  AudioLines,
  Flag,
  Flame,
  FlaskConical,
  Bike,
  Footprints,
  Keyboard,
  MapPin,
  MousePointerClick,
  Plane,
  Search,
  Ship,
  Sparkles,
  Volume2,
  VolumeX,
  createElement,
  type IconNode,
} from 'lucide';
import { gameStore, type ControlMode, type GameState, type Objective, type RaptorStatus } from '../state/gameStore';

export function icon(node: IconNode, size = 18): SVGElement {
  return createElement(node, { width: size, height: size, 'stroke-width': 2.2 });
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.append(...children);
  return e;
}

const MODE_LABEL: Record<ControlMode, [IconNode, string]> = {
  onFoot: [Footprints, 'On foot'],
  raptorWalk: [Bot, 'Raptor · Walk'],
  raptorFlight: [Plane, 'Raptor · Flight'],
  raptorRace: [CarFront, 'Raptor · Race'],
  raptorBoat: [Ship, 'Raptor · Boat'],
  driveCar: [CarFront, 'Driving a car'],
  rideBike: [Bike, 'Riding a bicycle'],
  rideMotorbike: [Bike, 'Riding a motorbike'],
};

const STATUS_LABEL: Record<RaptorStatus, [IconNode, string]> = {
  parked: [FlaskConical, 'Raptor parked at the Lab'],
  ridden: [Bot, 'Riding the Raptor'],
  idle: [MapPin, 'Raptor left in town'],
  stolen: [Search, 'Raptor is missing!'],
  attic: [Search, 'Raptor is missing!'],
};

const OBJECTIVE_ICON: Record<Objective['icon'], IconNode> = {
  fire: Flame,
  search: Search,
  flag: Flag,
  cookie: Cookie,
  eye: Eye,
};

/**
 * The DOM overlay: control mode, Raptor status, gauges, Lab Points, objectives, the action prompt,
 * toasts, the aim reticle and a controls card. It re-renders from the zustand store, so game code
 * only sets state.
 */
export class HUD {
  readonly root = el('div', 'hud');
  readonly minimapSlot = el('div', 'minimap');
  private readonly modeChip = el('div', 'chip mode');
  private readonly statusChip = el('div', 'chip status');
  private readonly waterBar = el('div', 'fill water');
  private readonly thrusterBar = el('div', 'fill thruster');
  private readonly treatsBar = el('div', 'fill treats');
  private readonly points = el('div', 'points');
  private readonly objectives = el('div', 'objectives');
  private readonly prompt = el('div', 'prompt');
  private readonly toast = el('div', 'toast');
  private readonly reticle = el('div', 'reticle', icon(Crosshair, 28));
  private readonly badge = el('div', 'badge');
  private readonly raceLine = el('div', 'race-line');
  private readonly lookHint = el('div', 'look-hint', icon(MousePointerClick, 16), 'Click to look around · Esc frees the mouse');
  private toastTimer = 0;
  private readonly soundBtn = el('button', 'icon-btn');
  private readonly musicBtn = el('button', 'icon-btn');
  private readonly help = el('details', 'panel help');
  private readonly lock = el('div', 'lock-marker');

  constructor(container: HTMLElement) {
    const gauge = (node: IconNode, label: string, fill: HTMLElement) =>
      el('div', 'gauge', el('span', 'gauge-icon', icon(node, 16)), el('span', 'gauge-label', label), el('div', 'bar', fill));

    const panel = el(
      'div',
      'panel top-left',
      this.modeChip,
      this.statusChip,
      gauge(Droplets, 'Water', this.waterBar),
      gauge(Flame, 'Thruster', this.thrusterBar),
      gauge(Cookie, 'Treats', this.treatsBar),
      this.points,
    );

    this.help.open = window.innerWidth > 900;

    this.soundBtn.title = 'Sound on/off';
    this.musicBtn.title = 'Music on/off (M)';
    this.soundBtn.addEventListener('click', () => gameStore.setState((st) => ({ soundOn: !st.soundOn })));
    this.musicBtn.addEventListener('click', () => gameStore.setState((st) => ({ musicOn: !st.musicOn })));
    const toggles = el('div', 'audio-toggles', this.soundBtn, this.musicBtn);
    this.renderHelp();

    this.root.append(toggles, panel, this.help, this.lock, this.objectives, this.minimapSlot, this.raceLine, this.prompt, this.toast, this.reticle, this.badge, this.lookHint);
    container.append(this.root);

    gameStore.subscribe((s, prev) => this.render(s, prev));
    this.render(gameStore.getState());
  }

  /** Lock-on marker over the auto-aim target (LEGO controls), in CSS pixels. */
  setLock(p: { x: number; y: number; firing: boolean } | null): void {
    this.lock.classList.toggle('show', !!p);
    if (!p) return;
    this.lock.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    this.lock.classList.toggle('firing', p.firing);
  }

  private renderHelp(): void {
    const rows = [
      ['W A S D', 'Move (with the screen)'],
      ['Mouse', 'Look around'],
      ['Click', 'Spray (auto-aims)'],
      ['Right-click', 'Hold to aim freely'],
      ['Shift', 'Tap to run · boost'],
      ['Space', 'Jump · climb · back to Walk (race)'],
      ['Space ×2', 'Double jump: fly'],
      ['Ctrl / C', 'Descend (flight) · drift (race)'],
      ['1 2 3 4 / Q', 'Walk · Flight · Race · Boat'],
      ['E', 'Ride · drive · talk · use'],
      ['A / D', 'Steer (race, vehicles)'],
      ['H', 'Horn · bell'],
      ['M', 'Music on/off'],
      ['Gamepad', 'Supported'],
    ];
    this.help.replaceChildren(
      el('summary', '', icon(Keyboard, 16), 'Controls'),
      ...rows.map(([k, v]) => el('div', 'help-row', el('kbd', '', k), el('span', '', v))),
    );
  }

  /** Per-frame bits that are not store-driven. */
  frame(dt: number, pointerLocked: boolean): void {
    this.lookHint.classList.toggle('hidden', pointerLocked);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  private render(s: GameState, prev?: GameState): void {
    if (!prev || s.soundOn !== prev.soundOn || s.musicOn !== prev.musicOn) {
      this.soundBtn.replaceChildren(icon(s.soundOn ? Volume2 : VolumeX, 18));
      this.musicBtn.replaceChildren(icon(AudioLines, 18));
      this.musicBtn.classList.toggle('off', !s.musicOn || !s.soundOn);
      this.soundBtn.classList.toggle('off', !s.soundOn);
    }
    if (!prev || s.control !== prev.control) {
      const [node, text] = MODE_LABEL[s.control];
      this.modeChip.replaceChildren(icon(node), text);
      this.modeChip.classList.toggle('riding', s.control !== 'onFoot');
    }
    if (!prev || s.raptorStatus !== prev.raptorStatus) {
      const [node, text] = STATUS_LABEL[s.raptorStatus];
      this.statusChip.replaceChildren(icon(node, 16), text);
      this.statusChip.dataset.status = s.raptorStatus;
    }
    this.waterBar.style.width = `${s.water}%`;
    this.thrusterBar.style.width = `${s.thruster}%`;
    this.thrusterBar.classList.toggle('low', s.thrusterOverheat);
    this.treatsBar.style.width = `${s.treats}%`;
    this.waterBar.classList.toggle('low', s.water < 20);

    if (!prev || s.labPoints !== prev.labPoints) {
      this.points.replaceChildren(icon(Coins, 16), `${s.labPoints} Lab Points`);
      if (prev) {
        this.points.classList.remove('bump');
        void this.points.offsetWidth;
        this.points.classList.add('bump');
      }
    }

    if (!prev || s.objectives !== prev.objectives) {
      this.objectives.replaceChildren(...s.objectives.map((o) => el('div', `objective ${o.icon}`, icon(OBJECTIVE_ICON[o.icon], 16), o.text)));
      this.objectives.classList.toggle('show', s.objectives.length > 0);
    }

    if (!prev || s.prompt !== prev.prompt) {
      if (s.prompt) this.prompt.replaceChildren(el('kbd', '', 'E'), s.prompt);
      this.prompt.classList.toggle('show', !!s.prompt);
    }
    if (s.toast && s.toast.id !== prev?.toast?.id) {
      this.toast.textContent = s.toast.text;
      this.toast.classList.add('show');
      this.toastTimer = 3.5;
    }

    const modal = !!(s.dialogue || s.premonition || s.upgradeBenchOpen);
    this.reticle.classList.toggle('show', s.aiming && !modal);

    let badge = '';
    if (s.refilling) badge = 'Refilling water…';
    else if (s.sugarRush > 0) badge = `Sugar Rush! ${Math.ceil(s.sugarRush)} s`;
    if (!prev || badge !== this.badge.textContent) {
      this.badge.replaceChildren(...(badge ? [icon(s.refilling ? Droplets : Sparkles, 16), badge] : []));
      this.badge.classList.toggle('show', !!badge);
      this.badge.classList.toggle('sugar', !s.refilling && s.sugarRush > 0);
    }

    if (!prev || s.raceInfo !== prev.raceInfo) {
      this.raceLine.replaceChildren(...(s.raceInfo ? [icon(Flag, 18), s.raceInfo] : []));
      this.raceLine.classList.toggle('show', !!s.raceInfo);
    }
  }
}
