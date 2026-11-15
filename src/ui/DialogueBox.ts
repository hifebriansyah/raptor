import { MessageCircle, createElement } from 'lucide';
import { gameStore, type DialogueLine } from '../state/gameStore';
import { el } from './HUD';
import { portraitFor } from './Portraits';

/**
 * Conversation flow: open() a list of lines, advance() on E/Space. The store holds the current
 * line so the box re-renders from state; `onDone` runs after the last line.
 */
export class DialogueController {
  private queue: DialogueLine[] = [];
  private onDone: (() => void) | null = null;
  /** Fired for every line shown (blip sound). */
  onLine: (() => void) | null = null;

  get open(): boolean {
    return gameStore.getState().dialogue !== null;
  }

  start(lines: DialogueLine[], onDone?: () => void): void {
    if (!lines.length) return;
    this.queue = lines.slice();
    this.onDone = onDone ?? null;
    this.show();
  }

  advance(): void {
    if (!this.open) return;
    if (this.queue.length) this.show();
    else {
      gameStore.setState({ dialogue: null });
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
    }
  }

  private show(): void {
    const line = this.queue.shift()!;
    gameStore.setState({ dialogue: { ...line, more: this.queue.length > 0 } });
    this.onLine?.();
  }
}

const SPEAKER_COLOR: Record<string, string> = {
  Grandma: '#ff8fab',
  Leo: '#4cc9f0',
  Max: '#06d6a0',
  Gwen: '#81c784',
  Sam: '#ffd166',
  'Chief Bruno': '#7aa2ff',
  Cora: '#ff6b6b',
  Professor: '#f7f9fc',
};

/** The speech box at the bottom of the screen. Text types out letter by letter. */
export class DialogueBox {
  private readonly box = el('div', 'dialogue');
  private readonly name = el('div', 'dialogue-name');
  private readonly text = el('div', 'dialogue-text');
  private readonly hint = el('div', 'dialogue-hint');
  private readonly portrait = document.createElement('img');
  private typing: number | null = null;

  constructor(root: HTMLElement) {
    const head = el('div', 'dialogue-head', createElement(MessageCircle, { width: 16, height: 16, 'stroke-width': 2.4 }), this.name);
    this.portrait.className = 'dialogue-portrait';
    this.portrait.alt = '';
    this.box.append(this.portrait, el('div', 'dialogue-main', head, this.text, this.hint));
    root.append(this.box);
    gameStore.subscribe((s, p) => {
      if (s.dialogue === p.dialogue) return;
      const d = s.dialogue;
      this.box.classList.toggle('show', !!d);
      if (!d) return;
      this.name.textContent = d.speaker;
      this.portrait.src = portraitFor(d.speaker);
      this.box.style.setProperty('--speaker', SPEAKER_COLOR[d.speaker] ?? '#ffd166');
      this.hint.replaceChildren(el('kbd', '', 'E'), d.more ? ' Next' : ' Close');
      this.typeOut(d.text);
    });
  }

  private typeOut(full: string): void {
    if (this.typing !== null) clearInterval(this.typing);
    let i = 0;
    this.text.textContent = '';
    this.typing = window.setInterval(() => {
      i += 2;
      this.text.textContent = full.slice(0, i);
      if (i >= full.length && this.typing !== null) {
        clearInterval(this.typing);
        this.typing = null;
      }
    }, 16);
  }
}
