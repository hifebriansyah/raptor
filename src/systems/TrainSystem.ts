import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildCarModel, seatDriver } from '../entities/CarModels';
import { part } from '../entities/CharacterEntity';
import { Humanoid, randomLook } from '../entities/Humanoid';
import { WORLD, type SpecialDoor } from '../game/WorldMap';
import type { PhysicsSystem } from './PhysicsSystem';

/** Height of the rail tops on the viaduct. */
export const RAIL_Y = 10;
const R = WORLD.roadMax;
const CORNER = 26;
const CAR_LEN = 9;
const GAP = 0.8;
const CARS = 4;
const CRUISE = 16;

interface Station {
  name: string;
  /** Distance along the loop where the train stops (its middle). */
  at: number;
  /** Feet position on the platform. */
  platform: THREE.Vector3;
}

interface TrainCar {
  group: THREE.Group;
  body: RAPIER.RigidBody;
  pos: THREE.Vector3;
  heading: number;
  seat: THREE.Object3D;
  /** Where a passenger (the Professor) sits. */
  passengerSeat: THREE.Object3D;
  /** Movement this step (to carry people standing on the roof). */
  delta: THREE.Vector3;
}

/**
 * The LEGO-City-style train: an elevated viaduct loop above the 4-lane ring road, four stations
 * (ground-floor hall with a lift up to the platform), and a live four-car train that stops at each
 * one. Board it as a passenger, drive it from the cab (W/S), or hop on the roof and ride along.
 */
export class TrainSystem {
  private readonly path: { p: THREE.Vector3; d: number }[] = [];
  readonly length: number;
  readonly stations: Station[] = [];
  readonly cars: TrainCar[] = [];
  /** Distance of the front of the train along the loop. */
  head = 0;
  speed = CRUISE;
  private targetSpeed = CRUISE;
  private dwell = 0;
  private nextStop = 0;
  /** Who is driving: the AI, or the Professor from the cab. */
  driver: 'ai' | 'player' = 'ai';
  /** The Professor is on board (inside a carriage). */
  passenger: 'none' | 'seat' | 'cab' = 'none';
  /** Runaway train event: brakes failed. */
  runaway = false;
  private readonly conductorModel: Humanoid | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
    doors: SpecialDoor[],
  ) {
    // Loop: the ring road square with rounded corners (clockwise, like the rival racers)
    const corners = [
      [-R, -R, 1, 0],
      [R, -R, 0, 1],
      [R, R, -1, 0],
      [-R, R, 0, -1],
    ] as const;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const [cx, cz, dx, dz] = corners[i];
      const [nx, nz] = [corners[(i + 1) % 4][2], corners[(i + 1) % 4][3]];
      // straight from after this corner's arc to before the next corner's arc
      const start = new THREE.Vector3(cx + dx * CORNER, RAIL_Y, cz + dz * CORNER);
      const nextCorner = corners[(i + 1) % 4];
      const end = new THREE.Vector3(nextCorner[0] - dx * CORNER, RAIL_Y, nextCorner[1] - dz * CORNER);
      pts.push(start, end);
      // arc round the next corner
      const centre = new THREE.Vector3(nextCorner[0] - dx * CORNER + nx * CORNER, RAIL_Y, nextCorner[1] - dz * CORNER + nz * CORNER);
      const a0 = Math.atan2(end.z - centre.z, end.x - centre.x);
      const a1 = Math.atan2(nextCorner[1] + nx * CORNER - centre.z, nextCorner[0] + nx * CORNER - centre.x);
      let da = a1 - a0;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      for (let k = 1; k < 8; k++) pts.push(new THREE.Vector3(centre.x + Math.cos(a0 + (da * k) / 8) * CORNER, RAIL_Y, centre.z + Math.sin(a0 + (da * k) / 8) * CORNER));
    }
    let d = 0;
    pts.forEach((p, i) => {
      if (i > 0) d += p.distanceTo(pts[i - 1]);
      this.path.push({ p, d });
    });
    this.length = d + pts[pts.length - 1].distanceTo(pts[0]);
    this.buildViaduct();

    // Stations at the middle of each side
    const sides: [string, number, number, number, number][] = [
      ['North Station', 0, -R, 0, -1],
      ['East Station', R, 0, 1, 0],
      ['South Station', 0, R, 0, 1],
      ['West Station', -R, 0, -1, 0],
    ];
    for (const [name, x, z, ox, oz] of sides) {
      const mid = new THREE.Vector3(x, RAIL_Y, z);
      const at = this.closest(mid);
      const platform = new THREE.Vector3(x + ox * 5.2, RAIL_Y + 0.4, z + oz * 5.2);
      this.stations.push({ name, at, platform });
      this.buildStation(name, x, z, ox, oz, doors);
    }

    // The train
    const colors = ['#d62828', '#ffffff', '#d62828', '#ffffff'];
    for (let i = 0; i < CARS; i++) {
      const group = new THREE.Group();
      const c = colors[i];
      // carriage: body, glass windows, roof, bogies
      const m = buildCarModel('bus', c);
      m.group.scale.set(1.15, 1, CAR_LEN / 10);
      group.add(m.group);
      // rail bogies instead of road wheels
      for (const w of m.wheels) w.visible = false;
      for (const bz of [-CAR_LEN / 2 + 1.6, CAR_LEN / 2 - 1.6]) {
        group.add(part(new THREE.BoxGeometry(2.2, 0.6, 2.4), '#343a40', 0, 0.3, bz));
        for (const wz of [-0.7, 0.7]) for (const wx of [-0.8, 0.8]) group.add(part(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10).rotateZ(Math.PI / 2), '#adb5bd', wx, 0.3, bz + wz));
      }
      group.add(part(new THREE.BoxGeometry(3.04, 0.25, CAR_LEN + 0.02), '#ffd166', 0, 1.35, 0)); // stripe
      if (i === 0) {
        group.add(part(new THREE.BoxGeometry(3, 1.2, 0.6), '#ffd166', 0, 1.2, CAR_LEN / 2 - 0.1)); // nose
        group.add(part(new THREE.BoxGeometry(0.6, 0.3, 0.1), '#fff8d6', 0, 1.6, CAR_LEN / 2 + 0.22, true)); // lamp
      }
      for (let k = 0; k < 4; k++) seatDriverIf(m, k === 0 && i > 0);
      this.scene.add(group);
      const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.5, CAR_LEN / 2), body);
      const passengerSeat = new THREE.Object3D();
      passengerSeat.position.set(0.7, 1.63, -1);
      group.add(passengerSeat);
      this.cars.push({ group, body, pos: new THREE.Vector3(), heading: 0, seat: m.driverSeat, passengerSeat, delta: new THREE.Vector3() });
    }
    // conductor in the cab
    const cab = this.cars[0];
    const look = { skin: '#f2c9a0', shirt: '#9d0208', pants: '#2b2d42', hair: '#d4a373', hairStyle: 'cap' as const, hat: '#2b2d42' };
    const h = new Humanoid(look);
    h.root.position.y = -0.9;
    h.sit();
    cab.seat.add(h.root);
    this.conductorModel = h;
    this.head = this.stations[0].at + CARS * (CAR_LEN + GAP) * 0.5;
    this.place(0);

    function seatDriverIf(m: ReturnType<typeof buildCarModel>, yes: boolean): void {
      if (yes) seatDriver(m, randomLook());
    }
  }

  /** Point and heading at distance d along the loop. */
  pointAt(d: number): { pos: THREE.Vector3; heading: number } {
    const t = ((d % this.length) + this.length) % this.length;
    let i = 0;
    while (i < this.path.length - 1 && this.path[i + 1].d <= t) i++;
    const a = this.path[i].p;
    const b = i + 1 < this.path.length ? this.path[i + 1].p : this.path[0].p;
    const segLen = (i + 1 < this.path.length ? this.path[i + 1].d : this.length) - this.path[i].d;
    const k = segLen > 0 ? (t - this.path[i].d) / segLen : 0;
    return { pos: a.clone().lerp(b, k), heading: Math.atan2(b.x - a.x, b.z - a.z) };
  }

  private closest(p: THREE.Vector3): number {
    let best = 0;
    let bestD = Infinity;
    for (let d = 0; d < this.length; d += 1) {
      const q = this.pointAt(d).pos;
      const dd = q.distanceToSquared(p);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, rotY = 0, solid = true): void {
    const m = part(new THREE.BoxGeometry(w, h, d), color, x, y, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    this.scene.add(m);
    if (solid) this.physics.addStaticBox(m.position, new THREE.Vector3(w / 2, h / 2, d / 2), rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY) : undefined);
  }

  /** Deck, rails and pillars along the loop (pillars stay clear of the intersections). */
  private buildViaduct(): void {
    const segs = this.path.map((e, i) => [e.p, (this.path[i + 1] ?? this.path[0]).p] as const);
    for (const [a, b] of segs) {
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      this.box(mid.x, RAIL_Y - 0.5, mid.z, 6, 0.8, len + 0.6, '#c9ccd3', rot);
      for (const s of [-0.8, 0.8]) {
        const off = new THREE.Vector3(Math.cos(rot) * s, 0, -Math.sin(rot) * s);
        this.box(mid.x + off.x, RAIL_Y + 0.05, mid.z + off.z, 0.18, 0.12, len + 0.6, '#6c757d', rot, false);
      }
      for (const s of [-2.9, 2.9]) {
        const off = new THREE.Vector3(Math.cos(rot) * s, 0, -Math.sin(rot) * s);
        this.box(mid.x + off.x, RAIL_Y + 0.3, mid.z + off.z, 0.2, 0.6, len + 0.6, '#ffd166', rot); // guard rail
      }
    }
    // pillars every 20 m along the straights, 10 m off the intersections
    for (let i = -R + 10; i <= R - 10; i += 20) {
      for (const [x, z] of [[i, -R], [R, i], [i, R], [-R, i]]) {
        if (Math.abs(Math.abs(x) - R) < 1 && Math.abs(Math.abs(z) - R) < 30) continue; // near the rounded corners
        if (Math.abs(Math.abs(z) - R) < 1 && Math.abs(Math.abs(x) - R) < 30) continue;
        this.box(x, (RAIL_Y - 0.9) / 2, z, 1.2, RAIL_Y - 0.9, 1.2, '#adb5bd');
      }
    }
  }

  /** Station hall on the ground outside the ring, with a lift up to the platform. */
  private buildStation(name: string, x: number, z: number, ox: number, oz: number, doors: SpecialDoor[]): void {
    const rot = Math.atan2(ox, oz);
    const out = (dist: number) => new THREE.Vector3(x + ox * dist, 0, z + oz * dist);
    // platform deck beside the track, with a canopy
    const plat = out(5.6);
    this.box(plat.x, RAIL_Y - 0.1, plat.z, 26, 0.8, 3.2, '#e9ecef', rot + Math.PI / 2);
    const can = out(6.8);
    this.box(can.x, RAIL_Y + 3.6, can.z, 26, 0.3, 3.4, '#d62828', rot + Math.PI / 2, false);
    for (const s of [-11, 11]) {
      const side = new THREE.Vector3(Math.cos(rot) * s, 0, -Math.sin(rot) * s);
      this.box(can.x + side.x, RAIL_Y + 1.8, can.z + side.z, 0.3, 3.6, 0.3, '#6c757d', 0, false);
    }
    // hall on the ground, lift tower up to the platform
    const hall = out(13);
    this.box(hall.x, 2.5, hall.z, 14, 5, 7, '#fff1e6', rot);
    this.box(hall.x, 5.2, hall.z, 14.4, 0.4, 7.4, '#d62828', rot, false);
    const tower = out(8.6);
    this.box(tower.x, RAIL_Y / 2, tower.z, 3, RAIL_Y, 2.2, '#adb5bd', rot);
    const sign = out(9.4);
    this.box(sign.x, 4.4, sign.z, 6, 1, 0.2, '#ffd166', rot, false);
    // the entrance is on the far side of the hall (the lift tower is on the track side)
    const door = out(16.58);
    this.box(door.x, 1.3, door.z, 1.6, 2.6, 0.15, '#6d4c41', rot, false);
    const sign2 = out(16.62);
    this.box(sign2.x, 4.0, sign2.z, 6, 0.9, 0.12, '#ffd166', rot, false);
    doors.push({ id: 'station', pos: out(17.3).setY(0), facing: rot, label: name, roof: out(5.4).setY(RAIL_Y + 0.4) });
  }

  private place(dt: number): void {
    this.cars.forEach((c, i) => {
      const { pos, heading } = this.pointAt(this.head - i * (CAR_LEN + GAP) - CAR_LEN / 2);
      const prev = c.pos.clone();
      c.pos.copy(pos);
      c.heading = heading;
      c.delta.copy(pos).sub(prev);
      if (dt === 0) c.delta.set(0, 0, 0);
      c.group.position.set(pos.x, RAIL_Y + 0.15, pos.z);
      c.group.rotation.y = heading;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      c.body.setNextKinematicTranslation({ x: pos.x, y: RAIL_Y + 1.65, z: pos.z });
      c.body.setNextKinematicRotation(q);
    });
  }

  /** Stopped at a station? Which one. */
  get stoppedAt(): Station | null {
    if (this.speed > 0.5) return null;
    const mid = this.head - (CARS * (CAR_LEN + GAP)) / 2;
    return this.stations.find((s) => Math.abs(wrap(mid - s.at, this.length)) < 8) ?? null;
  }

  /** The car whose roof a point is standing on (feet), if any. */
  roofUnder(feet: THREE.Vector3): TrainCar | null {
    for (const c of this.cars) {
      const local = feet.clone().sub(c.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), -c.heading);
      if (Math.abs(local.x) < 1.7 && Math.abs(local.z) < CAR_LEN / 2 + 0.2 && Math.abs(feet.y - (RAIL_Y + 3.15)) < 0.8) return c;
    }
    return null;
  }

  /** Nearest carriage door within reach (for boarding from the platform). */
  doorNear(feet: THREE.Vector3): number | null {
    for (let i = 0; i < this.cars.length; i++) {
      if (this.cars[i].pos.distanceTo(new THREE.Vector3(feet.x, RAIL_Y, feet.z)) < 6 && Math.abs(feet.y - (RAIL_Y + 0.4)) < 1.5) return i;
    }
    return null;
  }

  /** Throttle from the cab: W/S. */
  drive(throttle: number): void {
    if (this.runaway) return;
    this.targetSpeed = THREE.MathUtils.clamp(this.targetSpeed + throttle * 0.4, 0, 30);
  }

  /** Pull the emergency brake (runaway train). */
  brake(): void {
    this.runaway = false;
    this.targetSpeed = 0;
  }

  update(dt: number): void {
    if (this.runaway) {
      this.targetSpeed = 38;
    } else if (this.driver === 'ai') {
      // cruise, slow for the next station, wait there, then go
      if (this.dwell > 0) {
        this.dwell -= dt;
        this.targetSpeed = 0;
        if (this.dwell <= 0) this.nextStop = (this.nextStop + 1) % this.stations.length;
      } else {
        const mid = this.head - (CARS * (CAR_LEN + GAP)) / 2;
        const toStop = wrap(this.stations[this.nextStop].at - mid, this.length);
        const dist = toStop < 0 ? toStop + this.length : toStop;
        this.targetSpeed = dist < 50 ? Math.max(0, Math.min(CRUISE, dist * 0.6)) : CRUISE;
        if (dist < 0.8 && this.speed < 1) {
          this.dwell = 7;
          this.speed = 0;
        }
      }
    }
    const rate = this.targetSpeed > this.speed ? 3 : 5;
    this.speed += THREE.MathUtils.clamp(this.targetSpeed - this.speed, -rate * dt, rate * dt);
    this.head += this.speed * dt;
    this.place(dt);
  }

  /** After the player drives off, hand back to the AI towards the next station. */
  releaseToAi(): void {
    this.driver = 'ai';
    const mid = this.head - (CARS * (CAR_LEN + GAP)) / 2;
    let best = 0;
    let bestD = Infinity;
    this.stations.forEach((s, i) => {
      let d = wrap(s.at - mid, this.length);
      if (d < 0) d += this.length;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.nextStop = best;
  }

  get conductor(): Humanoid | null {
    return this.conductorModel;
  }
}

function wrap(d: number, L: number): number {
  return ((((d + L / 2) % L) + L) % L) - L / 2;
}
