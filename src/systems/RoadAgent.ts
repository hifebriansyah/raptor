import * as THREE from 'three';
import { WORLD, roadWidthX, roadWidthZ } from '../game/WorldMap';

export type TurnPolicy = 'random' | 'ring';

/**
 * Moves along the road grid's centre lines, keeping a fixed sideways offset (`lane`, + = right of
 * travel). At each intersection it picks a new direction: 'random' wanders the town, 'ring' keeps
 * driving the outer ring road clockwise.
 */
export class RoadAgent {
  /** Point on the road centre line. */
  readonly centre = new THREE.Vector3();
  dir = { x: 1, z: 0 };
  /** World position including the lane offset. */
  readonly world = new THREE.Vector3();
  /** Cars: use the outer lane on the 4-lane boulevards. */
  outer = false;

  constructor(
    public lane: number,
    private readonly policy: TurnPolicy,
    private readonly rand: () => number = Math.random,
  ) {}

  /** Start on a random road segment (or on the ring for 'ring'). */
  placeRandom(): void {
    const { roadMin, roadMax, roadStep } = WORLD;
    const n = Math.round((roadMax - roadMin) / roadStep);
    const road = this.policy === 'ring' ? (this.rand() < 0.5 ? roadMin : roadMax) : roadMin + Math.floor(this.rand() * (n + 1)) * roadStep;
    const along = roadMin + this.rand() * (roadMax - roadMin);
    if (this.rand() < 0.5) {
      this.centre.set(along, 0, road);
      this.dir = { x: this.rand() < 0.5 ? 1 : -1, z: 0 };
    } else {
      this.centre.set(road, 0, along);
      this.dir = { x: 0, z: this.rand() < 0.5 ? 1 : -1 };
    }
    if (this.policy === 'ring') this.dir = this.ringDir();
    this.updateWorld();
  }

  /** Start at a specific centre-line point and direction. */
  place(x: number, z: number, dir: { x: number; z: number }): void {
    this.centre.set(x, 0, z);
    this.dir = dir;
    this.updateWorld();
  }

  /** Put the agent back on the road nearest to `p` (after being thrown somewhere). */
  placeNear(p: THREE.Vector3): void {
    const { roadMin, roadMax, roadStep } = WORLD;
    const clamp = (v: number) => Math.max(roadMin, Math.min(roadMax, v));
    if (this.policy === 'ring') {
      const R = roadMax;
      const cands = [
        { x: clamp(p.x), z: -R, dir: { x: 1, z: 0 } },
        { x: R, z: clamp(p.z), dir: { x: 0, z: 1 } },
        { x: clamp(p.x), z: R, dir: { x: -1, z: 0 } },
        { x: -R, z: clamp(p.z), dir: { x: 0, z: -1 } },
      ];
      const best = cands.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a));
      this.place(best.x, best.z, best.dir);
      return;
    }
    const snap = (v: number) => clamp(roadMin + Math.round((v - roadMin) / roadStep) * roadStep);
    const rx = snap(p.x);
    const rz = snap(p.z);
    const s = this.rand() < 0.5 ? 1 : -1;
    if (Math.abs(p.x - rx) < Math.abs(p.z - rz)) this.place(rx, clamp(p.z), { x: 0, z: s });
    else this.place(clamp(p.x), rz, { x: s, z: 0 });
  }

  get heading(): number {
    return Math.atan2(this.dir.x, this.dir.z);
  }

  /** Unit vector to the right of travel. */
  get right(): { x: number; z: number } {
    return { x: -this.dir.z, z: this.dir.x };
  }

  advance(distance: number): void {
    const { roadMin, roadStep } = WORLD;
    let left = distance;
    for (let guard = 0; guard < 4 && left > 0; guard++) {
      // distance to the next intersection along the current direction
      const coord = this.dir.x !== 0 ? this.centre.x : this.centre.z;
      const sign = this.dir.x !== 0 ? this.dir.x : this.dir.z;
      const rel = (coord - roadMin) / roadStep;
      const nextIdx = sign > 0 ? Math.floor(rel + 1e-6) + 1 : Math.ceil(rel - 1e-6) - 1;
      const nodeCoord = roadMin + nextIdx * roadStep;
      const toNode = Math.abs(nodeCoord - coord);
      if (left < toNode) {
        this.centre.x += this.dir.x * left;
        this.centre.z += this.dir.z * left;
        left = 0;
      } else {
        if (this.dir.x !== 0) this.centre.x = nodeCoord;
        else this.centre.z = nodeCoord;
        left -= toNode;
        this.chooseTurn();
      }
    }
    this.updateWorld();
  }

  private inBounds(x: number, z: number): boolean {
    return x >= WORLD.roadMin - 0.1 && x <= WORLD.roadMax + 0.1 && z >= WORLD.roadMin - 0.1 && z <= WORLD.roadMax + 0.1;
  }

  private chooseTurn(): void {
    const { roadStep } = WORLD;
    const straight = this.dir;
    const right = { x: -this.dir.z, z: this.dir.x };
    const left = { x: this.dir.z, z: -this.dir.x };
    const ok = (d: { x: number; z: number }) => this.inBounds(this.centre.x + d.x * roadStep, this.centre.z + d.z * roadStep);

    if (this.policy === 'ring') {
      this.dir = ok(straight) && this.onRing(straight) ? straight : right;
      return;
    }
    const options: { x: number; z: number }[] = [];
    if (ok(straight)) options.push(straight, straight); // prefer going straight
    if (ok(left)) options.push(left);
    if (ok(right)) options.push(right);
    this.dir = options.length ? options[Math.floor(this.rand() * options.length)] : { x: -this.dir.x, z: -this.dir.z };
  }

  /** Still on the outer ring after one more segment in direction d? */
  private onRing(d: { x: number; z: number }): boolean {
    const R = WORLD.roadMax;
    const nx = this.centre.x + d.x * WORLD.roadStep;
    const nz = this.centre.z + d.z * WORLD.roadStep;
    return Math.abs(Math.abs(nx) - R) < 0.1 || Math.abs(Math.abs(nz) - R) < 0.1;
  }

  /** Clockwise direction along the ring from the current centre point. */
  private ringDir(): { x: number; z: number } {
    const R = WORLD.roadMax;
    const { x, z } = this.centre;
    if (Math.abs(z + R) < 0.1) return { x: 1, z: 0 };
    if (Math.abs(x - R) < 0.1) return { x: 0, z: 1 };
    if (Math.abs(z - R) < 0.1) return { x: -1, z: 0 };
    return { x: 0, z: -1 };
  }

  private updateWorld(): void {
    const r = this.right;
    // On a 4-lane boulevard the sidewalks are 4 m further out, and some cars take the outer lane
    const wide = (this.dir.x !== 0 ? roadWidthZ(this.centre.z) : roadWidthX(this.centre.x)) > WORLD.roadWidth;
    let lane = this.lane;
    if (wide && (Math.abs(lane) >= 4 || this.outer)) lane += Math.sign(lane) * 4;
    this.world.set(this.centre.x + r.x * lane, 0, this.centre.z + r.z * lane);
  }

  /** Distance travelled along the ring loop from the north-west corner (clockwise), 0…perimeter. */
  ringDistance(): number {
    const R = WORLD.roadMax;
    const L = 2 * R;
    const { x, z } = this.centre;
    if (Math.abs(z + R) < 0.5) return x + R;
    if (Math.abs(x - R) < 0.5) return L + (z + R);
    if (Math.abs(z - R) < 0.5) return 2 * L + (R - x);
    return 3 * L + (R - z);
  }
}

/** World point on the ring loop centre line at distance `d` clockwise from the north-west corner. */
export function ringPoint(d: number): { pos: THREE.Vector3; dir: { x: number; z: number } } {
  const R = WORLD.roadMax;
  const L = 2 * R;
  const P = 4 * L;
  const t = ((d % P) + P) % P;
  if (t < L) return { pos: new THREE.Vector3(-R + t, 0, -R), dir: { x: 1, z: 0 } };
  if (t < 2 * L) return { pos: new THREE.Vector3(R, 0, -R + (t - L)), dir: { x: 0, z: 1 } };
  if (t < 3 * L) return { pos: new THREE.Vector3(R - (t - 2 * L), 0, R), dir: { x: -1, z: 0 } };
  return { pos: new THREE.Vector3(-R, 0, R - (t - 3 * L)), dir: { x: 0, z: -1 } };
}

export const RING_PERIMETER = 8 * WORLD.roadMax;
