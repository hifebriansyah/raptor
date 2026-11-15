import { Download, Gauge, Keyboard, Play, RotateCcw, Settings2, Sparkles, Users, X, createElement, type IconNode } from 'lucide';
import { gameStore, hasProgress, resetProgress, type Crowd, type Quality } from '../state/gameStore';
import { el } from './HUD';
import { installState, promptInstall } from './install';

const ic = (node: IconNode, size = 18) => createElement(node, { width: size, height: size, 'stroke-width': 2.2 });

/** Every control, shown only here (the live HUD stays clean). */
export const CONTROL_ROWS: [string, string][] = [
  ['W A S D', 'Move (with the screen)'],
  ['Mouse · Arrow keys', 'Turn and tilt the camera'],
  ['Wheel · + −', 'Zoom in / out'],
  ['Middle-click · 0', 'Reset zoom'],
  ['Click · J', 'Spray / fire (auto-aims)'],
  ['Right-click · K', 'Hold to aim freely'],
  ['Shift', 'Tap to run · boost'],
  ['Space', 'Jump · climb (flight)'],
  ['Space ×2', 'Walk: fly · other modes: back to Walk'],
  ['Space (parachute)', 'Cut the parachute · skydive · re-open'],
  ['Ctrl / C', 'Descend (flight) · drift (race)'],
  ['1 2 3 / Q', 'Walk · Flight · Race'],
  ['V', 'Race mode'],
  ['G', 'Giant Mode (on the Raptor)'],
  ['E', 'Ride · drive · talk · enter · use'],
  ['E (in the air)', 'Jump off with a parachute'],
  ['X', 'Punch / kick combo (on foot)'],
  ['Z', 'Gadget wheel: next Lab Gun'],
  ['T', 'Throw a treat · feed the Raptor'],
  ['R', 'Call the Raptor'],
  ['F', 'Raptor follows you / stays'],
  ['A / D', 'Steer (race, vehicles, boats)'],
  ['H', 'Horn · bell'],
  ['N', 'Map: quick travel to a teleport pad'],
  ['M', 'Music on / off'],
  ['Tab · P', 'Menu'],
  ['Gamepad', 'Supported (Start = menu)'],
];

type Page = 'main' | 'options' | 'controls';

/**
 * Main / pause menu. The game starts straight away; this opens with Tab / P / Start / the HUD menu button, and
 * whenever the mouse is released (Esc). The game is paused while it is open.
 */
export class Menu {
  private readonly overlay = el('div', 'menu');
  private readonly card = el('div', 'menu-card');
  private page: Page = 'main';
  private confirmNew = false;
  /** Called when the player picks Continue / New Game (to re-capture the mouse). */
  onResume: (() => void) | null = null;
  /** Extra buttons from other systems (cheats). */
  extras: { label: string; icon: IconNode; on: () => boolean; toggle: () => void }[] = [];

  constructor(root: HTMLElement) {
    this.overlay.append(this.card);
    root.append(this.overlay);
    gameStore.subscribe((s, p) => {
      if (s.menuOpen !== p.menuOpen) {
        this.overlay.classList.toggle('show', s.menuOpen);
        if (s.menuOpen) {
          this.page = 'main';
          this.confirmNew = false;
          document.exitPointerLock?.();
          this.render();
        }
      }
      if (s.menuOpen && s.settings !== p.settings) this.render();
    });
    this.overlay.classList.toggle('show', gameStore.getState().menuOpen);
    this.render();
    window.addEventListener('install-state', () => this.render());
  }

  close(): void {
    gameStore.setState({ menuOpen: false });
    this.onResume?.();
  }

  private render(): void {
    const s = gameStore.getState();
    const title = el('div', 'menu-title', el('span', 'menu-logo', ic(Sparkles, 26)), el('div', '', el('h1', '', 'Mecha Raptor'), el('p', '', 'A toybox town, a homemade dino-mech, and space above it all.')));
    const close = el('button', 'menu-close', ic(X, 18));
    close.title = 'Close (Tab)';
    close.addEventListener('click', () => this.close());

    const body = el('div', 'menu-body');
    if (this.page === 'main') {
      const btn = (label: string, node: IconNode, run: () => void, cls = '') => {
        const b = el('button', `menu-btn ${cls}`, ic(node), el('span', '', label));
        b.addEventListener('click', run);
        return b;
      };
      body.append(btn(hasProgress() ? 'Continue' : 'Play', Play, () => this.close(), 'primary'));
      if (hasProgress()) {
        body.append(
          btn(this.confirmNew ? 'Really start over? Click again' : 'New Game', RotateCcw, () => {
            if (!this.confirmNew) {
              this.confirmNew = true;
              this.render();
              return;
            }
            resetProgress();
            this.close();
          }, this.confirmNew ? 'danger' : ''),
        );
      }
      body.append(btn('Options', Settings2, () => this.go('options')), btn('Controls', Keyboard, () => this.go('controls')));
      const inst = installState();
      if (inst !== 'unsupported') {
        const label = inst === 'installed' ? 'Installed' : inst === 'ios' ? 'Install: Share → Add to Home Screen' : 'Install app';
        const b = btn(label, Download, () => {
          if (inst === 'ready') void promptInstall();
        });
        b.disabled = inst === 'installed' || inst === 'ios';
        body.append(b);
      }
    } else if (this.page === 'options') {
      body.append(this.back());
      body.append(
        this.choice<Crowd>('Crowds', Users, 'Pedestrians, road traffic and boats at sea', s.settings.crowd, [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['packed', 'Packed'],
        ], (v) => gameStore.setState({ settings: { ...gameStore.getState().settings, crowd: v } })),
        this.choice<Quality>('Shading', Gauge, 'Flat is fastest; High adds sharper shadows and glow', s.settings.quality, [
          ['flat', 'Flat'],
          ['toon', 'Toon'],
          ['standard', 'Standard'],
          ['high', 'High'],
        ], (v) => gameStore.setState({ settings: { ...gameStore.getState().settings, quality: v } })),
      );
      if (this.extras.length) {
        const list = el('div', 'menu-extras');
        for (const x of this.extras) {
          const b = el('button', `menu-toggle ${x.on() ? 'on' : ''}`, ic(x.icon, 16), el('span', '', x.label));
          b.addEventListener('click', () => {
            x.toggle();
            this.render();
          });
          list.append(b);
        }
        body.append(el('div', 'menu-row', el('div', 'menu-row-head', ic(Sparkles, 16), el('b', '', 'Cheats & Extras'), el('small', '', 'Unlocked with Gold Bricks')), list));
      }
    } else {
      body.append(this.back());
      body.append(el('div', 'menu-controls', ...CONTROL_ROWS.map(([k, v]) => el('div', 'help-row', el('kbd', '', k), el('span', '', v)))));
    }
    this.card.replaceChildren(close, title, body, el('div', 'menu-foot', 'Tab or P opens this menu · Esc frees the mouse · 3D models by Kenney (kenney.nl, CC0)'));
  }

  private go(page: Page): void {
    this.page = page;
    this.render();
  }

  private back(): HTMLElement {
    const b = el('button', 'menu-back', '← Back');
    b.addEventListener('click', () => this.go('main'));
    return b;
  }

  private choice<T extends string>(label: string, node: IconNode, hint: string, value: T, options: [T, string][], set: (v: T) => void): HTMLElement {
    const row = el('div', 'menu-seg');
    for (const [v, text] of options) {
      const b = el('button', v === value ? 'on' : '', text);
      b.addEventListener('click', () => set(v));
      row.append(b);
    }
    return el('div', 'menu-row', el('div', 'menu-row-head', ic(node, 16), el('b', '', label), el('small', '', hint)), row);
  }
}
