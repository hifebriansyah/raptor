import { Cookie, Droplet, Flame, Lock, Wrench, X, createElement, type IconNode } from 'lucide';
import { UPGRADE_MAX, gameStore, showToast, type UpgradeId } from '../state/gameStore';
import { el } from './HUD';

interface UpgradeInfo {
  id: UpgradeId;
  name: string;
  icon: IconNode;
  /** What each level does. */
  effect: string;
}

export const UPGRADES: UpgradeInfo[] = [
  { id: 'thruster', name: 'Turbo Thrusters', icon: Flame, effect: 'Faster boost, burns less energy' },
  { id: 'tank', name: 'Bigger Water Tank', icon: Droplet, effect: 'Sprays longer, refills faster' },
  { id: 'alarm', name: 'Lab Security Alarm', icon: Lock, effect: 'Fewer thefts while you are away' },
  { id: 'dispenser', name: 'Cookie Dispenser', icon: Cookie, effect: 'Feeds the Raptor at the Lab: fewer cookie runs' },
];

export const UPGRADE_COST = [60, 120, 200];

/** Try to buy the next level of an upgrade; returns true on success. */
export function buyUpgrade(id: UpgradeId): boolean {
  const s = gameStore.getState();
  const lvl = s.upgrades[id];
  if (lvl >= UPGRADE_MAX) {
    showToast('Already maxed out!');
    return false;
  }
  const cost = UPGRADE_COST[lvl];
  if (s.labPoints < cost) {
    showToast(`Need ${cost - s.labPoints} more Lab Points`);
    return false;
  }
  gameStore.setState({ labPoints: s.labPoints - cost, upgrades: { ...s.upgrades, [id]: lvl + 1 } });
  showToast(`${UPGRADES.find((u) => u.id === id)!.name} upgraded to level ${lvl + 1}!`);
  return true;
}

const ic = (node: IconNode, size = 20) => createElement(node, { width: size, height: size, 'stroke-width': 2.2 });

/**
 * The Lab workbench panel: spend Lab Points on four upgrades (3 levels each). Click a card, or press
 * 1–4; E or Esc closes it.
 */
export class UpgradeBench {
  private readonly overlay = el('div', 'bench');
  private readonly list = el('div', 'bench-list');
  private readonly points = el('div', 'bench-points');
  onBuy: (() => void) | null = null;

  constructor(root: HTMLElement) {
    const close = el('button', 'bench-close', ic(X, 18));
    close.addEventListener('click', () => gameStore.setState({ upgradeBenchOpen: false }));
    const head = el('div', 'bench-head', ic(Wrench, 22), el('span', '', 'Lab Upgrade Bench'), this.points, close);
    const hint = el('div', 'dialogue-hint', el('kbd', '', '1–4'), ' Buy  ', el('kbd', '', 'E'), ' Close');
    this.overlay.append(el('div', 'bench-card', head, this.list, hint));
    root.append(this.overlay);
    gameStore.subscribe((s, p) => {
      if (s.upgradeBenchOpen !== p.upgradeBenchOpen) {
        this.overlay.classList.toggle('show', s.upgradeBenchOpen);
        if (s.upgradeBenchOpen) document.exitPointerLock?.();
      }
      if (s.upgradeBenchOpen && (s.labPoints !== p.labPoints || s.upgrades !== p.upgrades || s.upgradeBenchOpen !== p.upgradeBenchOpen)) this.render();
    });
  }

  private render(): void {
    const s = gameStore.getState();
    this.points.textContent = `${s.labPoints} pts`;
    this.list.replaceChildren(
      ...UPGRADES.map((u, i) => {
        const lvl = s.upgrades[u.id];
        const maxed = lvl >= UPGRADE_MAX;
        const cost = maxed ? 0 : UPGRADE_COST[lvl];
        const pips = el('div', 'pips', ...Array.from({ length: UPGRADE_MAX }, (_, k) => el('span', k < lvl ? 'pip on' : 'pip')));
        const btn = el('button', 'bench-buy', maxed ? 'Maxed' : `${cost} pts`);
        btn.disabled = maxed || s.labPoints < cost;
        btn.addEventListener('click', () => {
          if (buyUpgrade(u.id)) this.onBuy?.();
        });
        return el(
          'div',
          'bench-item',
          el('kbd', 'bench-key', String(i + 1)),
          el('div', 'bench-icon', ic(u.icon, 22)),
          el('div', 'bench-text', el('div', 'bench-name', u.name), el('div', 'bench-effect', u.effect), pips),
          btn,
        );
      }),
    );
  }
}
