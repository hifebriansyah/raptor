import * as THREE from 'three';
import { WORLD } from '../game/WorldMap';
import { addPoints, clearObjective, gameStore, setObjective, showToast } from '../state/gameStore';
import { RING_PERIMETER, ringPoint } from './RoadAgent';
import type { Car, TrafficSystem } from './TrafficSystem';

const GATES = 8;
const GATE_RADIUS = 9;
const REWARD = 80;

interface ActiveRace {
  rival: Car;
  /** Ring distance where the race started (unwrapped base). */
  start: number;
  /** Ring distances of each gate (unwrapped, increasing). */
  gates: number[];
  next: number;
  rivalTravel: number;
  /** Player progress along the ring, integrated from projected movement. */
  playerTravel: number;
  lastProj: number;
  forfeitTimer: number;
  elapsed: number;
}

/** Nearest point on the ring loop: returns its clockwise distance and how far `pos` is from the road. */
export function projectRing(pos: THREE.Vector3): { d: number; off: number } {
  const R = WORLD.roadMax;
  const L = 2 * R;
  const clamp = (v: number) => Math.max(-R, Math.min(R, v));
  const cands = [
    { d: clamp(pos.x) + R, off: Math.hypot(pos.x - clamp(pos.x), pos.z + R) },
    { d: L + clamp(pos.z) + R, off: Math.hypot(pos.x - R, pos.z - clamp(pos.z)) },
    { d: 2 * L + (R - clamp(pos.x)), off: Math.hypot(pos.x - clamp(pos.x), pos.z - R) },
    { d: 3 * L + (R - clamp(pos.z)), off: Math.hypot(pos.x + R, pos.z - clamp(pos.z)) },
  ];
  return cands.reduce((a, b) => (b.off < a.off ? b : a));
}

/**
 * Street races against the rival cars on the ring road: drive up to a rival in Race mode, press E to
 * challenge, then beat them through 8 checkpoint gates around one lap.
 */
export class RaceSystem {
  private race: ActiveRace | null = null;
  private readonly gateMeshes: THREE.Mesh[] = [];
  private readonly cooldown = new Map<Car, number>();
  onEvent: ((e: 'start' | 'gate' | 'win' | 'lose') => void) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly traffic: TrafficSystem,
    private readonly cheer: (pos: THREE.Vector3) => void,
  ) {
    const geo = new THREE.TorusGeometry(6.5, 0.35, 8, 32);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i === 0 ? '#ffd166' : '#ffffff', transparent: true, opacity: i === 0 ? 0.95 : 0.4 }));
      m.visible = false;
      scene.add(m);
      this.gateMeshes.push(m);
    }
  }

  get active(): boolean {
    return this.race !== null;
  }

  /** World position of the next gate (for the minimap). */
  get nextGate(): THREE.Vector3 | null {
    if (!this.race) return null;
    return ringPoint(this.race.gates[this.race.next]).pos;
  }

  /** A rival close enough to challenge, if any. */
  challengeable(raptorPos: THREE.Vector3, racing: boolean): Car | null {
    if (!racing || this.race) return null;
    for (const car of this.traffic.rivals) {
      if ((this.cooldown.get(car) ?? 0) > 0) continue;
      if (car.agent.world.distanceTo(raptorPos) < 20) return car;
    }
    return null;
  }

  start(rival: Car, raptorPos: THREE.Vector3): void {
    const startD = projectRing(raptorPos).d;
    const gates: number[] = [];
    for (let i = 1; i <= GATES; i++) gates.push(startD + (RING_PERIMETER / GATES) * i);
    // rival starts level with the player
    const rp = ringPoint(startD);
    rival.agent.place(rp.pos.x, rp.pos.z, rp.dir);
    rival.vis.copy(rival.agent.world);
    rival.speed = 20;
    this.race = { rival, start: startD, gates, next: 0, rivalTravel: 0, playerTravel: 0, lastProj: startD, forfeitTimer: 0, elapsed: 0 };
    showToast(`${rival.name} accepts! Beat them around the ring: ${GATES} checkpoints`);
    setObjective({ id: 'race', icon: 'flag', text: `Race ${rival.name} around the ring road` });
    this.onEvent?.('start');
    this.showGates();
  }

  update(dt: number, raptorPos: THREE.Vector3, racing: boolean): void {
    for (const [car, t] of this.cooldown) this.cooldown.set(car, t - dt);
    const r = this.race;
    if (!r) return;
    r.elapsed += dt;

    // Rival speed with rubber-banding so it stays a close race
    const proj = projectRing(raptorPos);
    let delta = proj.d - r.lastProj;
    if (delta > RING_PERIMETER / 2) delta -= RING_PERIMETER;
    if (delta < -RING_PERIMETER / 2) delta += RING_PERIMETER;
    r.playerTravel += delta;
    r.lastProj = proj.d;
    const lead = r.rivalTravel - r.playerTravel;
    const base = 46; // keeps up with the Raptor's 42 m/s race mode (boost 66)
    r.rival.targetSpeed = lead > 90 ? base - 6 : lead < -90 ? base + 10 : base + THREE.MathUtils.clamp(-lead * 0.05, -4, 6);
    r.rivalTravel += r.rival.speed * dt;

    // Gates
    const gate = ringPoint(r.gates[r.next]).pos;
    if (Math.hypot(raptorPos.x - gate.x, raptorPos.z - gate.z) < GATE_RADIUS) {
      r.next++;
      this.onEvent?.('gate');
      if (r.next >= GATES) {
        this.finish(true, raptorPos);
        return;
      }
      this.showGates();
    }

    const total = RING_PERIMETER;
    if (r.rivalTravel >= total) {
      this.finish(false, raptorPos);
      return;
    }

    // Forfeit if the player leaves race mode or the ring road for too long
    if (!racing || proj.off > 60) r.forfeitTimer += dt;
    else r.forfeitTimer = 0;
    if (r.forfeitTimer > 6) {
      showToast(`Race abandoned. ${r.rival.name} zooms off laughing`);
      this.end();
      return;
    }

    const place = lead > 0 ? '2nd' : '1st';
    const info = `Checkpoint ${r.next}/${GATES} · ${place}`;
    if (gameStore.getState().raceInfo !== info) gameStore.setState({ raceInfo: info });
  }

  private finish(won: boolean, pos: THREE.Vector3): void {
    const r = this.race!;
    if (won) {
      addPoints(REWARD);
      showToast(`You beat ${r.rival.name}! +${REWARD} Lab Points (${r.elapsed.toFixed(1)} s)`);
      this.cheer(pos);
      this.onEvent?.('win');
    } else {
      showToast(`${r.rival.name} wins this time. Try again!`);
      this.onEvent?.('lose');
    }
    this.end();
  }

  private end(): void {
    const r = this.race;
    if (r) {
      r.rival.targetSpeed = null;
      this.cooldown.set(r.rival, 20);
    }
    this.race = null;
    this.gateMeshes.forEach((m) => (m.visible = false));
    clearObjective('race');
    gameStore.setState({ raceInfo: null });
  }

  private showGates(): void {
    const r = this.race!;
    this.gateMeshes.forEach((m, i) => {
      const idx = r.next + i;
      if (idx >= r.gates.length) {
        m.visible = false;
        return;
      }
      const { pos, dir } = ringPoint(r.gates[idx]);
      m.position.set(pos.x, 5.5, pos.z);
      m.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
      m.visible = true;
    });
  }

  /** Spin the gates a little; call per frame. */
  render(time: number): void {
    this.gateMeshes.forEach((m, i) => {
      if (!m.visible) return;
      const s = 1 + Math.sin(time * 4 + i) * 0.04;
      m.scale.setScalar(s);
    });
  }
}
