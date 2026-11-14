import { createStore } from 'zustand/vanilla';

/** Who the player is controlling right now. */
export type ControlMode = 'onFoot' | 'raptorWalk' | 'raptorFlight' | 'raptorRace' | 'raptorBoat' | 'driveCar' | 'rideBike' | 'rideMotorbike';

/**
 * Where the Mecha Raptor is.
 * - parked: on the Lab pad, refilled
 * - idle:   left somewhere in town, nobody riding
 * - ridden: the Professor is on it
 * - stolen: thieves have it at a hideout
 * - attic:  it snuck into Grandma's attic for cookies
 */
export type RaptorStatus = 'parked' | 'idle' | 'ridden' | 'stolen' | 'attic';

export type UpgradeId = 'thruster' | 'tank' | 'alarm' | 'dispenser';

export interface Objective {
  id: string;
  icon: 'fire' | 'search' | 'flag' | 'cookie' | 'eye';
  text: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
}

export interface GameState {
  control: ControlMode;
  raptorStatus: RaptorStatus;
  /** 0–100 % of the tank. Spent by the water gun, refilled at hydrants, fountains and the Lab pad. */
  water: number;
  /** 0–100 % boost energy for race mode (also powers flight boost). Recharges slowly; refilled at the Lab. */
  thruster: number;
  /** Emptied the thruster: boost is locked until it auto-refills to 30 %. */
  thrusterOverheat: boolean;
  /** 0–100. Drops over time; when low the Raptor may sneak off to Grandma's for cookies. */
  treats: number;
  /** Currency earned from fires, races and rescues; spent at the Lab upgrade bench. */
  labPoints: number;
  upgrades: Record<UpgradeId, number>;
  /** Seconds of Sugar Rush left (speed buff after the cookie run). */
  sugarRush: number;
  /** Contextual action hint, e.g. "Ride the Mecha Raptor". Null hides the prompt. */
  prompt: string | null;
  /** Short banner message, cleared after a few seconds. */
  toast: { text: string; id: number } | null;
  objectives: Objective[];
  /** Open conversation (Grandma, the kids). Null when closed. */
  dialogue: (DialogueLine & { more: boolean }) | null;
  /** Grandma's vision overlay; x/z is the centre of the zone she saw. */
  premonition: { x: number; z: number; place: string } | null;
  upgradeBenchOpen: boolean;
  /** Showing the aim reticle (water gun available). */
  aiming: boolean;
  refilling: boolean;
  /** Race HUD line, e.g. "Checkpoint 3/8 · 2nd". */
  raceInfo: string | null;
  musicOn: boolean;
  soundOn: boolean;
}

export const UPGRADE_MAX = 3;

export const gameStore = createStore<GameState>(() => ({
  control: 'onFoot',
  raptorStatus: 'parked',
  water: 100,
  thruster: 100,
  thrusterOverheat: false,
  treats: 100,
  labPoints: 0,
  upgrades: { thruster: 0, tank: 0, alarm: 0, dispenser: 0 },
  sugarRush: 0,
  prompt: null,
  toast: null,
  objectives: [],
  dialogue: null,
  premonition: null,
  upgradeBenchOpen: false,
  aiming: false,
  refilling: false,
  raceInfo: null,
  musicOn: true,
  soundOn: true,
}));

let toastId = 0;
export function showToast(text: string): void {
  gameStore.setState({ toast: { text, id: ++toastId } });
}

export function setObjective(obj: Objective): void {
  const list = gameStore.getState().objectives.filter((o) => o.id !== obj.id);
  gameStore.setState({ objectives: [...list, obj] });
}

export function clearObjective(id: string): void {
  const list = gameStore.getState().objectives;
  if (list.some((o) => o.id === id)) gameStore.setState({ objectives: list.filter((o) => o.id !== id) });
}

export function addPoints(n: number): void {
  gameStore.setState((s) => ({ labPoints: s.labPoints + n }));
}

/** Saved between visits: points, upgrades, audio settings. */
const SAVE_KEY = 'mecha-raptor-save-v1';

export function loadSave(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<Pick<GameState, 'labPoints' | 'upgrades' | 'musicOn' | 'soundOn'>>;
    gameStore.setState((cur) => ({
      labPoints: typeof s.labPoints === 'number' ? s.labPoints : cur.labPoints,
      upgrades: { ...cur.upgrades, ...(s.upgrades ?? {}) },
      musicOn: s.musicOn ?? cur.musicOn,
      soundOn: s.soundOn ?? cur.soundOn,
    }));
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
}

export function startAutoSave(): void {
  gameStore.subscribe((s, p) => {
    if (s.labPoints === p.labPoints && s.upgrades === p.upgrades && s.musicOn === p.musicOn && s.soundOn === p.soundOn) return;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ labPoints: s.labPoints, upgrades: s.upgrades, musicOn: s.musicOn, soundOn: s.soundOn }),
      );
    } catch {
      /* ignore */
    }
  });
}
