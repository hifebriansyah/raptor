import { gameStore } from '../state/gameStore';

export type Sfx =
  | 'stomp'
  | 'jump'
  | 'land'
  | 'transform'
  | 'splash'
  | 'sizzle'
  | 'reward'
  | 'alarm'
  | 'blip'
  | 'honk'
  | 'crash'
  | 'gate'
  | 'magic'
  | 'crunch'
  | 'lose'
  | 'shoo';

type LoopName = 'spray' | 'thruster' | 'engine' | 'wind' | 'fire';

interface Loop {
  gain: GainNode;
  osc?: OscillatorNode;
  filter?: BiquadFilterNode;
  level: number;
}

/**
 * All sound is synthesised with the Web Audio API — no audio files. One-shot effects, a few
 * continuous loops whose volume follows the game (spray, thrusters, engine, wind, fire crackle),
 * and a small upbeat chiptune that loops in the background.
 * The context starts on the first click/keypress (browser autoplay rules).
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private readonly loops = new Map<LoopName, Loop>();
  private nextNoteTime = 0;
  private step = 0;
  private scheduler: number | null = null;

  constructor() {
    const unlock = () => {
      this.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    gameStore.subscribe((s, p) => {
      if (s.musicOn !== p.musicOn || s.soundOn !== p.soundOn) this.applyVolumes();
    });
  }

  private start(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.applyVolumes();

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.makeNoiseLoop('spray', 'bandpass', 2200, 0.8);
    this.makeNoiseLoop('wind', 'bandpass', 500, 0.6);
    this.makeNoiseLoop('fire', 'bandpass', 900, 1.5);
    const thr = this.makeNoiseLoop('thruster', 'lowpass', 700, 0.5);
    thr.osc = ctx.createOscillator();
    thr.osc.type = 'sawtooth';
    thr.osc.frequency.value = 55;
    const og = ctx.createGain();
    og.gain.value = 0.25;
    thr.osc.connect(og).connect(thr.gain);
    thr.osc.start();
    const engine: Loop = { gain: ctx.createGain(), level: 0 };
    engine.gain.gain.value = 0;
    engine.osc = ctx.createOscillator();
    engine.osc.type = 'sawtooth';
    engine.osc.frequency.value = 60;
    engine.filter = ctx.createBiquadFilter();
    engine.filter.type = 'lowpass';
    engine.filter.frequency.value = 900;
    engine.osc.connect(engine.filter).connect(engine.gain).connect(this.sfx);
    engine.osc.start();
    this.loops.set('engine', engine);

    this.nextNoteTime = ctx.currentTime + 0.1;
    this.scheduler = window.setInterval(() => this.scheduleMusic(), 25);
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = gameStore.getState();
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(s.soundOn ? 0.9 : 0, t, 0.05);
    this.music.gain.setTargetAtTime(s.musicOn && s.soundOn ? 0.22 : 0, t, 0.2);
  }

  private makeNoiseLoop(name: LoopName, type: BiquadFilterType, freq: number, q: number): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfx);
    src.start();
    const loop: Loop = { gain, filter, level: 0 };
    this.loops.set(name, loop);
    return loop;
  }

  /** Set a loop's loudness 0…1 (and optionally its pitch-ish parameter). */
  setLoop(name: LoopName, level: number, param?: number): void {
    const l = this.loops.get(name);
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = { spray: 0.18, thruster: 0.35, engine: 0.07, wind: 0.25, fire: 0.5 }[name];
    let target = Math.max(0, Math.min(1, level)) * vol;
    if (name === 'fire') target *= 0.6 + Math.random() * 0.8; // crackle
    l.gain.gain.setTargetAtTime(target, t, name === 'fire' ? 0.02 : 0.08);
    if (param !== undefined) {
      if (name === 'engine' && l.osc) {
        l.osc.frequency.setTargetAtTime(50 + param * 4, t, 0.05);
        l.filter!.frequency.setTargetAtTime(500 + param * 30, t, 0.05);
      }
      if (name === 'wind' && l.filter) l.filter.frequency.setTargetAtTime(300 + param * 25, t, 0.1);
    }
  }

  // ───────────────────────────────────────────── one-shots

  play(name: Sfx, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !gameStore.getState().soundOn) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'stomp':
        this.thump(t, 70, 0.35 * volume, 0.18);
        this.burst(t, 'lowpass', 400, 0.08, 0.2 * volume);
        break;
      case 'land':
        this.thump(t, 55, 0.6 * volume, 0.3);
        this.burst(t, 'lowpass', 600, 0.2, 0.35 * volume);
        break;
      case 'jump':
        this.tone(t, 'sine', 220, 520, 0.18, 0.2 * volume);
        break;
      case 'transform':
        this.tone(t, 'sawtooth', 160, 1100, 0.45, 0.12 * volume, 1400);
        [880, 1175, 1568, 2093].forEach((f, i) => this.tone(t + 0.08 * i, 'square', f, f, 0.08, 0.05 * volume));
        break;
      case 'splash':
        this.burst(t, 'highpass', 2500, 0.15, 0.12 * volume);
        break;
      case 'sizzle':
        this.burst(t, 'highpass', 4000, 0.7, 0.25 * volume);
        break;
      case 'reward':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, 'square', f, f, 0.14, 0.09 * volume));
        break;
      case 'gate':
        this.tone(t, 'sine', 1200, 1600, 0.15, 0.2 * volume);
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.3, 'square', i % 2 ? 440 : 660, i % 2 ? 440 : 660, 0.26, 0.08 * volume);
        break;
      case 'blip':
        this.tone(t, 'sine', 700 + Math.random() * 200, 900, 0.05, 0.06 * volume);
        break;
      case 'honk':
        this.tone(t, 'square', 392, 392, 0.3, 0.05 * volume);
        this.tone(t, 'square', 494, 494, 0.3, 0.05 * volume);
        break;
      case 'crash':
        this.thump(t, 50, 0.6 * volume, 0.3);
        this.burst(t, 'bandpass', 1200, 0.3, 0.3 * volume);
        break;
      case 'magic':
        [660, 830, 990, 1320, 990, 1320, 1660].forEach((f, i) => this.tone(t + i * 0.12, 'sine', f, f * 1.01, 0.5, 0.06 * volume));
        break;
      case 'crunch':
        for (let i = 0; i < 4; i++) this.burst(t + i * 0.11, 'bandpass', 1800 + Math.random() * 800, 0.06, 0.25 * volume);
        break;
      case 'lose':
        [523, 466, 415, 349].forEach((f, i) => this.tone(t + i * 0.15, 'triangle', f, f, 0.18, 0.12 * volume));
        break;
      case 'shoo':
        this.tone(t, 'sawtooth', 300, 120, 0.4, 0.1 * volume, 800);
        break;
    }
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, lowpass?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = o.connect(f);
    }
    node.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private thump(t: number, freq: number, vol: number, dur: number): void {
    this.tone(t, 'sine', freq * 2, freq * 0.6, dur, vol);
  }

  private burst(t: number, type: BiquadFilterType, freq: number, dur: number, vol: number, out?: GainNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out ?? this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ───────────────────────────────────────────── music

  /** 16 steps per bar, 4 bars: C – G – Am – F, bass + arpeggio + drums at 112 BPM. */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const spb = 60 / 112 / 4; // seconds per 16th note
    const chords = [
      [261.63, 329.63, 392.0],
      [196.0, 246.94, 293.66],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
    ];
    const melody = [0, -1, 2, -1, 1, -1, 2, 1, 0, -1, -1, 2, 1, -1, 0, -1];
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const t = this.nextNoteTime;
      const s = this.step % 64;
      const bar = Math.floor(s / 16);
      const i = s % 16;
      const chord = chords[bar];
      // bass on eighths
      if (i % 2 === 0) this.note(t, 'triangle', chord[0] / 2, spb * 1.8, 0.5);
      // arpeggio on 16ths
      this.note(t, 'square', chord[i % 3] * 2, spb * 0.9, 0.08);
      // simple melody every other bar
      const m = melody[i];
      if (m >= 0 && bar % 2 === 1) this.note(t, 'triangle', chord[m] * 4, spb * 1.6, 0.18);
      // drums
      if (i % 4 === 0) this.kick(t);
      if (i % 8 === 4) this.snare(t);
      if (i % 2 === 1) this.hat(t);
      this.nextNoteTime += spb;
      this.step++;
    }
  }

  private note(t: number, type: OscillatorType, freq: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.16);
  }

  private snare(t: number): void {
    this.burst(t, 'bandpass', 1800, 0.12, 0.35, this.music);
  }

  private hat(t: number): void {
    this.burst(t, 'highpass', 7000, 0.04, 0.15, this.music);
  }

  dispose(): void {
    if (this.scheduler !== null) clearInterval(this.scheduler);
    void this.ctx?.close();
  }
}
