import { Eye, createElement } from 'lucide';
import type { MapFeature } from '../game/WorldMap';
import { gameStore } from '../state/gameStore';
import { el } from './HUD';
import { drawSnapshot } from './Minimap';

/**
 * Grandma's vision: a swirling crystal ball showing a hazy top-down view of the area where the
 * thieves took the Raptor.
 */
export class PremonitionModal {
  private readonly overlay = el('div', 'premonition');
  private readonly canvas = document.createElement('canvas');
  private readonly caption = el('div', 'premonition-caption');

  constructor(root: HTMLElement, features: readonly MapFeature[]) {
    this.canvas.width = this.canvas.height = 320;
    const ball = el('div', 'crystal', this.canvas, el('div', 'crystal-swirl'), el('div', 'crystal-zone'));
    const title = el('div', 'premonition-title', createElement(Eye, { width: 20, height: 20, 'stroke-width': 2.4 }), 'Grandma’s Premonition');
    const hint = el('div', 'dialogue-hint', el('kbd', '', 'E'), ' Close the vision');
    this.overlay.append(el('div', 'premonition-card', title, ball, this.caption, hint));
    root.append(this.overlay);

    gameStore.subscribe((s, p) => {
      if (s.premonition === p.premonition) return;
      const v = s.premonition;
      this.overlay.classList.toggle('show', !!v);
      if (!v) return;
      drawSnapshot(this.canvas, features, v.x, v.z, 70);
      this.caption.textContent = `“I see… ${v.place}… shady folk in hoodies… and your big metal lizard, all tied up!” It’s marked on your map.`;
    });
  }
}
