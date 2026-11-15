import { MapPin, X, createElement } from 'lucide';
import type { MapFeature } from '../game/WorldMap';
import type { Pad } from '../systems/TeleportSystem';
import { gameStore } from '../state/gameStore';
import { el } from './HUD';
import { drawSnapshot } from './Minimap';

/** The quick-travel map (N): the whole world with the switched-on teleport pads to pick from. */
export class TravelMap {
  private readonly overlay = el('div', 'bench travel');
  private readonly canvas = document.createElement('canvas');
  private readonly list = el('div', 'travel-list');
  open = false;
  onPick: ((i: number) => void) | null = null;

  constructor(root: HTMLElement, private readonly features: readonly MapFeature[], private readonly pads: Pad[]) {
    this.canvas.width = this.canvas.height = 360;
    const close = el('button', 'bench-close', createElement(X, { width: 18, height: 18 }));
    close.addEventListener('click', () => this.toggle(false));
    const head = el('div', 'bench-head', createElement(MapPin, { width: 22, height: 22, 'stroke-width': 2.2 }), el('span', '', 'Quick travel'), close);
    const hint = el('div', 'dialogue-hint', el('kbd', '', 'N'), ' Close · step on a pad to switch it on');
    this.overlay.append(el('div', 'bench-card', head, el('div', 'travel-body', this.canvas, this.list), hint));
    root.append(this.overlay);
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.overlay.classList.toggle('show', open);
    if (open) {
      document.exitPointerLock?.();
      this.render();
    }
  }

  private render(): void {
    // centre the map on the middle of the world, wide enough to show everything
    drawSnapshot(this.canvas, this.features, 170, -95, 470);
    const ctx = this.canvas.getContext('2d')!;
    const on = gameStore.getState().pads;
    const s = this.canvas.width / 2 / 470;
    this.list.replaceChildren(
      ...this.pads.map((p, i) => {
        const x = this.canvas.width / 2 + (p.pos.x - 170) * s;
        const y = this.canvas.height / 2 + (p.pos.z + 95) * s;
        ctx.fillStyle = on.includes(i) ? '#e0aaff' : 'rgba(60,9,108,0.6)';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(String(i + 1), x - 3, y + 4);
        const b = el('button', 'menu-btn', `${i + 1}. ${on.includes(i) ? p.name : '??? (not found yet)'}`);
        b.disabled = !on.includes(i);
        b.addEventListener('click', () => {
          this.toggle(false);
          this.onPick?.(i);
        });
        return b;
      }),
    );
  }
}
