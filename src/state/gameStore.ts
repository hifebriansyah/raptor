import { createStore } from 'zustand/vanilla';

/** Who the player is controlling right now. */
export type ControlMode = 'onFoot' | 'raptorWalk' | 'raptorFlight' | 'raptorRace' | 'driveCar' | 'driveBoat' | 'rideTrain' | 'driveTrain' | 'rideBike' | 'rideMotorbike';

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

export type GunId = 'water' | 'size' | 'teleport' | 'transform' | 'megaphone';
export const GUNS: GunId[] = ['water', 'size', 'teleport', 'transform', 'megaphone'];
export type CheatId = 'turbo' | 'water' | 'magnet' | 'bighead' | 'confetti';
/** What unlocks each cheat: a number of Gold Bricks, or Red Bricks. */
export const CHEAT_COST: Record<CheatId, { kind: 'gold' | 'red'; n: number }> = {
  turbo: { kind: 'gold', n: 2 },
  water: { kind: 'gold', n: 4 },
  confetti: { kind: 'gold', n: 7 },
  magnet: { kind: 'red', n: 1 },
  bighead: { kind: 'red', n: 2 },
};

/** Bricks collected of a kind (red brick ids start with "red-"). */
export function brickCount(kind: 'gold' | 'red'): number {
  return gameStore.getState().goldBricks.filter((b) => b.startsWith('red-') === (kind === 'red')).length;
}

export type Crowd = 'low' | 'medium' | 'high' | 'packed';
export type Quality = 'flat' | 'toon' | 'standard' | 'high';

export interface Settings {
  /** Pedestrians, road traffic and sea boats. */
  crowd: Crowd;
  /** Flat (no shadows), Toon (cel-shaded), Standard, High (sharper shadows + glow). */
  quality: Quality;
}

/** How many of each kind of extra a crowd level spawns. */
export const CROWD_COUNTS: Record<Crowd, { walkers: number; cars: number; boats: number }> = {
  low: { walkers: 18, cars: 8, boats: 3 },
  medium: { walkers: 40, cars: 18, boats: 6 },
  high: { walkers: 60, cars: 26, boats: 9 },
  packed: { walkers: 90, cars: 36, boats: 12 },
};

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
  /** Cookies the Professor carries (T: feed the Raptor or throw one as a lure). Grandma refills them. */
  treatStock: number;
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
  /** The Lab Gun in the Professor's hand (Z / 1–5 on foot). */
  gun: GunId;
  /** Cheats switched on in the Extras menu. */
  cheats: Record<CheatId, boolean>;
  /** Gold Bricks found (unlock cheats). Ids of the bricks collected. */
  goldBricks: string[];
  /** Bolts collected (the currency shed by smashed props); also count towards Lab Points. */
  bolts: number;
  /** Super Builds finished (bridge, megaramp, launchpad). */
  superBuilds: string[];
  /** Giant (Hulkbuster) Mode active. */
  giant: boolean;
  /** Teleport pads switched on (indexes into TeleportSystem.pads). */
  pads: number[];
  /** Thugs zapped into the police holding cells. */
  jailed: number;
  /** Game clock, hours 0–24 (a day lasts 12 minutes). People follow routines on it. */
  clock: number;
  /** The pause/main menu is open (the game is paused). */
  menuOpen: boolean;
  settings: Settings;
}

export const UPGRADE_MAX = 3;

export const gameStore = createStore<GameState>(() => ({
  control: 'onFoot',
  raptorStatus: 'parked',
  water: 100,
  thruster: 100,
  thrusterOverheat: false,
  treats: 100,
  treatStock: 4,
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
  gun: 'water',
  cheats: { turbo: false, water: false, magnet: false, bighead: false, confetti: false },
  goldBricks: [],
  bolts: 0,
  giant: false,
  superBuilds: [],
  pads: [0],
  jailed: 0,
  clock: 9,
  menuOpen: true,
  settings: { crowd: 'medium', quality: 'standard' },
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

/** Saved between visits: points, upgrades, audio and options. */
const SAVE_KEY = 'mecha-raptor-save-v1';

/** Wipe the save (New Game). Options and audio settings are kept. */
export function resetProgress(): void {
  gameStore.setState({ labPoints: 0, upgrades: { thruster: 0, tank: 0, alarm: 0, dispenser: 0 }, pads: [0], jailed: 0, treatStock: 4, goldBricks: [], bolts: 0, superBuilds: [], cheats: { turbo: false, water: false, magnet: false, bighead: false, confetti: false } });
}

/** True when there is saved progress worth continuing. */
export function hasProgress(): boolean {
  const s = gameStore.getState();
  return s.labPoints > 0 || Object.values(s.upgrades).some((v) => v > 0) || s.pads.length > 1;
}

export function loadSave(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<Pick<GameState, 'labPoints' | 'upgrades' | 'musicOn' | 'soundOn' | 'settings' | 'treatStock' | 'pads' | 'jailed' | 'cheats' | 'goldBricks' | 'bolts' | 'superBuilds'>>;
    gameStore.setState((cur) => ({
      labPoints: typeof s.labPoints === 'number' ? s.labPoints : cur.labPoints,
      upgrades: { ...cur.upgrades, ...(s.upgrades ?? {}) },
      musicOn: s.musicOn ?? cur.musicOn,
      soundOn: s.soundOn ?? cur.soundOn,
      settings: { ...cur.settings, ...(s.settings ?? {}) },
      treatStock: typeof s.treatStock === 'number' ? s.treatStock : cur.treatStock,
      pads: Array.isArray(s.pads) ? s.pads : cur.pads,
      jailed: typeof s.jailed === 'number' ? s.jailed : cur.jailed,
      cheats: { ...cur.cheats, ...(s.cheats ?? {}) },
      goldBricks: Array.isArray(s.goldBricks) ? s.goldBricks : cur.goldBricks,
      bolts: typeof s.bolts === 'number' ? s.bolts : cur.bolts,
      superBuilds: Array.isArray(s.superBuilds) ? s.superBuilds : cur.superBuilds,
    }));
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
}

export function startAutoSave(): void {
  gameStore.subscribe((s, p) => {
    if (s.labPoints === p.labPoints && s.upgrades === p.upgrades && s.musicOn === p.musicOn && s.soundOn === p.soundOn && s.settings === p.settings && s.treatStock === p.treatStock && s.pads === p.pads && s.jailed === p.jailed && s.cheats === p.cheats && s.goldBricks === p.goldBricks && Math.floor(s.bolts / 10) === Math.floor(p.bolts / 10) && s.superBuilds === p.superBuilds) return;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ labPoints: s.labPoints, upgrades: s.upgrades, musicOn: s.musicOn, soundOn: s.soundOn, settings: s.settings, treatStock: s.treatStock, pads: s.pads, jailed: s.jailed, cheats: s.cheats, goldBricks: s.goldBricks, bolts: s.bolts, superBuilds: s.superBuilds }),
      );
    } catch {
      /* ignore */
    }
  });
}
