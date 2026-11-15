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
  TrainFront,
  Clock,
  Wand,
  Megaphone,
  Rabbit,
  Maximize2,
  Gem,
  Footprints,
  MapPin,
  Menu as MenuIcon,
  MousePointerClick,
  Plane,
  Search,
  Ship,
  Sparkles,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Scan,
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
  driveBoat: [Ship, 'Driving a boat'],
  rideTrain: [TrainFront, 'On the city train'],
  driveTrain: [TrainFront, 'Driving the train · W/S'],
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
  private readonly gunChip = el('div', 'chip gun');
  private readonly waterBar = el('div', 'fill water');
  private readonly thrusterBar = el('div', 'fill thruster');
  private readonly treatsBar = el('div', 'fill treats');
  private readonly treatsLabel = el('span', 'gauge-label', 'Treats');
  private readonly points = el('div', 'points');
  private readonly clock = el('div', 'clock');
  private readonly objectives = el('div', 'objectives');
  private readonly prompt = el('div', 'prompt');
  private readonly toast = el('div', 'toast');
  private readonly reticle = el('div', 'reticle', icon(Crosshair, 28));
  private readonly badge = el('div', 'badge');
  private readonly raceLine = el('div', 'race-line');
  private readonly lookHint = el('div', 'look-hint', icon(MousePointerClick, 16), 'Click to look around · Tab for the menu');
  private toastTimer = 0;
  private readonly soundBtn = el('button', 'icon-btn');
  private readonly musicBtn = el('button', 'icon-btn');
  /** HUD buttons (wired by the engine). */
  onMenu: (() => void) | null = null;
  onZoom: ((steps: number) => void) | null = null;
  onZoomReset: (() => void) | null = null;
  private readonly lock = el('div', 'lock-marker');

  constructor(container: HTMLElement) {
    const gauge = (node: IconNode, label: string, fill: HTMLElement) =>
      el('div', 'gauge', el('span', 'gauge-icon', icon(node, 16)), el('span', 'gauge-label', label), el('div', 'bar', fill));

    const panel = el(
      'div',
      'panel top-left',
      this.modeChip,
      this.statusChip,
      this.gunChip,
      gauge(Droplets, 'Water', this.waterBar),
      gauge(Flame, 'Thruster', this.thrusterBar),
      el('div', 'gauge', el('span', 'gauge-icon', icon(Cookie, 16)), this.treatsLabel, el('div', 'bar', this.treatsBar)),
      this.points,
      this.clock,
    );

    this.soundBtn.title = 'Sound on/off';
    this.musicBtn.title = 'Music on/off (M)';
    this.soundBtn.addEventListener('click', () => gameStore.setState((st) => ({ soundOn: !st.soundOn })));
    this.musicBtn.addEventListener('click', () => gameStore.setState((st) => ({ musicOn: !st.musicOn })));
    const button = (node: IconNode, title: string, run: () => void) => {
      const b = el('button', 'icon-btn', icon(node, 18));
      b.title = title;
      b.addEventListener('click', run);
      return b;
    };
    const toggles = el(
      'div',
      'audio-toggles',
      button(ZoomIn, 'Zoom in (wheel, +)', () => this.onZoom?.(1.5)),
      button(ZoomOut, 'Zoom out (wheel, −)', () => this.onZoom?.(-1.5)),
      button(Scan, 'Reset zoom (middle-click, 0)', () => this.onZoomReset?.()),
      this.soundBtn,
      this.musicBtn,
      button(MenuIcon, 'Menu (Tab, P)', () => this.onMenu?.()),
    );

    this.root.append(toggles, panel, this.lock, this.objectives, this.minimapSlot, this.raceLine, this.prompt, this.toast, this.reticle, this.badge, this.lookHint);
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
    if (!prev || s.gun !== prev.gun || s.control !== prev.control || s.goldBricks !== prev.goldBricks || s.bolts !== prev.bolts) {
      const guns = { water: [Droplets, 'Water Gun'], size: [Maximize2, 'Shrink / Big Gun'], teleport: [Wand, 'Teleport Gun'], transform: [Rabbit, 'Transform Gun'], megaphone: [Megaphone, 'Megaphone Gun'] } as const;
      const [node, text] = guns[s.gun];
      this.gunChip.replaceChildren(icon(node, 15), `${text} · Z`, el('span', 'gun-extra', icon(Gem, 13), `${s.goldBricks.length}`, ' · ', `${s.bolts} bolts`));
      this.gunChip.classList.toggle('hidden', s.control !== 'onFoot');
    }
    if (!prev || s.control !== prev.control || s.giant !== prev.giant) {
      const [node, text] = MODE_LABEL[s.control];
      this.modeChip.replaceChildren(icon(node), s.giant && s.control === 'raptorWalk' ? 'Raptor · TITAN' : text);
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
    if (!prev || s.treatStock !== prev.treatStock) this.treatsLabel.textContent = `Treats ×${s.treatStock}`;
    this.waterBar.classList.toggle('low', s.water < 20);

    if (!prev || Math.floor(s.clock * 6) !== Math.floor(prev.clock * 6)) {
      const h = Math.floor(s.clock);
      const m = Math.floor((s.clock - h) * 6) * 10;
      this.clock.replaceChildren(icon(Clock, 14), `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
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

    const modal = !!(s.dialogue || s.premonition || s.upgradeBenchOpen || s.menuOpen);
    this.root.classList.toggle('menu-open', s.menuOpen);
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
