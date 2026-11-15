import { el } from './HUD';

/**
 * A cartoon iris wipe: a black circle closes on the screen centre, something happens behind it
 * (entering a building, teleporting), then it opens again.
 */
export class IrisWipe {
  private readonly overlay = el('div', 'iris');
  busy = false;

  constructor(root: HTMLElement) {
    root.append(this.overlay);
  }

  /** Close, run `middle`, open. Resolves when fully open again. */
  async play(middle: () => void, label?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.overlay.dataset.label = label ?? '';
    this.overlay.classList.add('closed');
    await wait(380);
    middle();
    await wait(260);
    this.overlay.classList.remove('closed');
    await wait(380);
    this.busy = false;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
