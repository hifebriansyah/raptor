import * as THREE from 'three';
import { BOAT_LABEL, BOAT_TOP, CAR_SPECS, buildBoatModel, buildCarModel, flashBeacons, removeDriver, seatDriver, type BoatModel, type CarModel, type VehicleModel } from '../entities/CarModels';
import { CharacterEntity, part } from '../entities/CharacterEntity';
import type { InputManager } from '../game/InputManager';
import { PALM_ISLE, WATER_Y } from '../game/Terrain';
import { WORLD, roadWidthX, roadWidthZ } from '../game/WorldMap';
import type { PhysicsSystem } from './PhysicsSystem';
import type { Car } from './TrafficSystem';

export type VehicleKind = 'car' | 'bike' | 'motorbike' | 'boat';

interface Tuning {
  radius: number;
  halfHeight: number;
  maxStep: number;
  top: number;
  /** Top speed while holding Shift (pedalling hard / full throttle). */
  sprintTop: number;
  accel: number;
  reverse: number;
  steer: number;
  traction: number;
  wheelRadius: number;
}

const TUNING: Record<VehicleKind, Tuning> = {
  car: { radius: 1.0, halfHeight: 0.25, maxStep: 0.45, top: 24, sprintTop: 30, accel: 13, reverse: 9, steer: 1.9, traction: 6.5, wheelRadius: 0.38 },
  bike: { radius: 0.4, halfHeight: 0.45, maxStep: 0.3, top: 9, sprintTop: 13, accel: 5, reverse: 3, steer: 2.7, traction: 9, wheelRadius: 0.35 },
  motorbike: { radius: 0.5, halfHeight: 0.45, maxStep: 0.35, top: 28, sprintTop: 36, accel: 16, reverse: 4, steer: 2.3, traction: 7, wheelRadius: 0.4 },
  boat: { radius: 1.2, halfHeight: 0.1, maxStep: 0.2, top: 30, sprintTop: 40, accel: 14, reverse: 6, steer: 1.6, traction: 2.2, wheelRadius: 1 },
};

export const VEHICLE_LABEL: Record<VehicleKind, string> = { car: 'car', bike: 'bicycle', motorbike: 'motorbike', boat: 'boat' };

/**
 * A vehicle the Professor can take: a car (taken from traffic), a bicycle or a motorbike.
 * Arcade handling like the Raptor's race mode: W/S throttle and brake, A/D steer, Space handbrake
 * (car) or bunny-hop (bikes), Shift for extra speed. Left alone it rolls to a stop and stays put.
 */
export class Vehicle extends CharacterEntity {
  driven = false;
  /** Thrown through the air (the FlingSystem moves the mesh meanwhile). */
  flung = false;
  speed = 0;
  readonly events: ('crash' | 'hop')[] = [];
  /** Where the Professor sits (bikes: on the saddle; cars and boats: in the driver's seat). */
  seat = new THREE.Object3D();
  /** Glass-cabin model for cars and boats (with an AI driver while it is traffic). */
  model: VehicleModel | null = null;
  carModel: CarModel | null = null;
  boatModel: BoatModel | null = null;
  /** AI boats: their cruising loop (null for parked / player vehicles). */
  route: THREE.Vector3[] | null = null;
  private routeIndex = 0;
  private time = 0;
  private readonly body = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private fork: THREE.Object3D | null = null;
  private crank: THREE.Object3D | null = null;
  private steerVis = 0;
  private lean = 0;
  private spin = 0;
  private resting = true;
  readonly tuning2: Tuning;
  /** Took it from a traffic driver (counts towards the parked-car limit). */
  readonly stolen: boolean;

  constructor(
    physics: PhysicsSystem,
    readonly kind: VehicleKind,
    feet: THREE.Vector3,
    heading: number,
    opts: { model?: VehicleModel; carModel?: CarModel; boatModel?: BoatModel; color?: string } = {},
  ) {
    const base = TUNING[kind];
    const t: Tuning = { ...base };
    if (kind === 'car') {
      const spec = CAR_SPECS[opts.carModel ?? 'sedan'];
      Object.assign(t, { top: spec.top, sprintTop: spec.sprintTop, accel: spec.accel, steer: spec.steer });
    }
    if (kind === 'boat') {
      const [top, sprintTop] = BOAT_TOP[opts.boatModel ?? 'speedboat'];
      Object.assign(t, { top, sprintTop, accel: top * 0.5, steer: opts.boatModel === 'yacht' ? 1.0 : 1.6 });
    }
    const color = opts.color;
    const centre = feet.clone().setY(feet.y + t.halfHeight + t.radius + 0.1);
    super(physics, physics.createCharacter({ position: centre, radius: t.radius, halfHeight: t.halfHeight, maxStep: t.maxStep }), {
      accel: 0,
      airAccel: 0,
      turnRate: 0,
      jumpSpeed: 5.5,
    });
    this.tuning2 = t;
    this.stolen = kind === 'car';
    if (kind === 'boat') this.resting = false; // let it settle onto the water first
    this.heading = heading;
    this.teleport(centre, heading);
    this.group.add(this.body);
    if (kind === 'car' || kind === 'boat') {
      this.carModel = kind === 'car' ? (opts.carModel ?? 'sedan') : null;
      this.boatModel = kind === 'boat' ? (opts.boatModel ?? 'speedboat') : null;
      const m = opts.model ?? (kind === 'car' ? buildCarModel(this.carModel!, color ?? '#e76f51') : buildBoatModel(this.boatModel!, color ?? '#ffffff'));
      m.group.position.set(0, 0, 0);
      m.group.rotation.set(0, 0, 0);
      this.body.add(m.group);
      this.wheels = m.wheels;
      this.model = m;
      this.seat = m.driverSeat;
    } else if (kind === 'bike') this.buildBike(color ?? '#ef476f');
    else this.buildMotorbike(color ?? '#1d3557');
  }

  get moving(): boolean {
    return !this.resting;
  }

  /** "car", "fire truck", "speedboat"… */
  get label(): string {
    if (this.carModel) return CAR_SPECS[this.carModel].label;
    if (this.boatModel) return BOAT_LABEL[this.boatModel];
    return VEHICLE_LABEL[this.kind];
  }

  /** Boats float on the sea (and beach in the shallows). */
  protected floorCentre(x: number, z: number, feetY = Infinity): number {
    const base = super.floorCentre(x, z, feetY);
    return this.kind === 'boat' ? Math.max(base, WATER_Y - 0.05 + this.footOffset) : base;
  }

  /** The AI skipper takes the boat round its loop. */
  cruise(dt: number): void {
    if (!this.route) return;
    const tgt = this.route[this.routeIndex];
    const to = new THREE.Vector3(tgt.x - this.pos.x, 0, tgt.z - this.pos.z);
    if (to.length() < 14) this.routeIndex = (this.routeIndex + 1) % this.route.length;
    let diff = Math.atan2(to.x, to.z) - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.driveCore(dt, Math.abs(diff) > 1.2 ? 0.4 : 0.75, THREE.MathUtils.clamp(-diff * 2, -1, 1), false, false, false, 1);
  }

  /** One physics step while the Professor drives. */
  drive(dt: number, input: InputManager, speedMult: number): void {
    const a = input.moveAxis();
    this.driveCore(dt, a.z, a.x, input.sprint, this.kind === 'car' && input.ascend, input.jump, speedMult);
  }

  private driveCore(dt: number, throttle: number, steer: number, sprint: boolean, handbrake: boolean, jump: boolean, speedMult: number): void {
    this.resting = false;
    this.beginStep();
    this.time += dt;
    const t = this.tuning2;
    // wheels in the sea barely move; a boat on land only scrapes along
    const wet = this.kind === 'boat' ? this.depth < 0.5 : this.depth > 0.5;
    const top = (sprint ? t.sprintTop : t.top) * speedMult * (wet ? (this.kind === 'boat' ? 0.08 : 0.25) : 1);
    if (this.kind === 'boat') this.grounded = true; // afloat: always has "grip" on the water

    if (this.grounded) {
      if (throttle > 0) {
        if (this.speed < top) this.speed += t.accel * throttle * dt;
      } else if (throttle < 0) {
        this.speed -= (this.speed > 0 ? 30 : t.accel * 0.6) * -throttle * dt;
        this.speed = Math.max(this.speed, -t.reverse);
      } else this.speed *= Math.exp(-(this.kind === 'bike' ? 0.6 : 0.8) * dt);
      if (handbrake) this.speed *= Math.exp(-0.6 * dt);
      if (this.speed > top) this.speed -= 10 * dt;
      if ((this.kind === 'bike' || this.kind === 'motorbike') && jump) {
        this.vy = this.kind === 'bike' ? 5 : 6;
        this.events.push('hop');
      }
    }

    const grip = Math.min(Math.abs(this.speed) / 5, 1);
    this.heading -= steer * t.steer * grip * Math.sign(this.speed || 1) * (handbrake ? 1.5 : 1) * (this.grounded ? 1 : 0.3) * dt;
    this.steerVis += (steer - this.steerVis) * (1 - Math.exp(-8 * dt));

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const traction = this.grounded ? (handbrake ? 1.2 : t.traction) : 0.3;
    const k = 1 - Math.exp(-traction * dt);
    this.velocity.x += (fx * this.speed - this.velocity.x) * k;
    this.velocity.z += (fz * this.speed - this.velocity.z) * k;
    this.integrate(dt, true);

    if (this.moveRatio < 0.35 && Math.abs(this.speed) > 7) {
      this.speed *= 0.3;
      this.events.push('crash');
    }
    if (this.kind === 'boat') {
      // bob on the waves and lift the bow at speed
      this.body.position.y = Math.sin(this.time * 2.4) * 0.06;
      this.body.rotation.x = -Math.min(Math.abs(this.speed) / 40, 1) * 0.12;
    }
  }

  /** Nobody aboard: roll to a stop, then rest (no more physics work). */
  idle(dt: number): void {
    if (this.resting) return;
    this.beginStep();
    this.speed *= Math.exp(-2.5 * dt);
    this.steerVis *= Math.exp(-4 * dt);
    this.velocity.x = Math.sin(this.heading) * this.speed;
    this.velocity.z = Math.cos(this.heading) * this.speed;
    this.integrate(dt, true);
    if (Math.abs(this.speed) < 0.1 && this.grounded) {
      this.speed = 0;
      this.velocity.set(0, 0, 0);
      this.resting = true;
      this.prev.copy(this.pos);
    }
  }

  localToWorld(local: THREE.Vector3): THREE.Vector3 {
    return local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading).add(this.feet);
  }

  animate(dt: number): void {
    const t = this.tuning2;
    this.spin += (this.speed / t.wheelRadius) * dt;
    for (const w of this.wheels) {
      if (this.kind === 'car') w.rotation.x = this.spin;
      else (w.children[0] ?? w).rotation.x = this.spin;
    }
    if (this.fork) this.fork.rotation.y = -this.steerVis * 0.5;
    if (this.crank) this.crank.rotation.x = this.spin * 0.45;
    if (this.model) flashBeacons(this.model, performance.now() / 1000);
    if (this.kind === 'boat') {
      this.body.rotation.z = THREE.MathUtils.clamp(this.steerVis * Math.abs(this.speed) * 0.006, -0.12, 0.12);
    } else if (this.kind !== 'car') {
      // lean into turns while riding; rest on the kickstand when parked
      const want = this.driven ? THREE.MathUtils.clamp(-this.steerVis * Math.min(1, Math.abs(this.speed) / 6) * 0.45, -0.5, 0.5) : 0.14;
      this.lean += (want - this.lean) * (1 - Math.exp(-6 * dt));
      this.body.rotation.z = this.lean;
    } else {
      this.body.rotation.z = THREE.MathUtils.clamp(this.steerVis * Math.abs(this.speed) * 0.004, -0.06, 0.06);
    }
  }

  private buildBike(color: string): void {
    const b = this.body;
    const wheel = (z: number) => {
      const holder = new THREE.Group();
      holder.position.set(0, 0.35, z);
      const w = new THREE.Group();
      w.add(part(new THREE.TorusGeometry(0.32, 0.035, 6, 16).rotateY(Math.PI / 2), '#222222'));
      for (let i = 0; i < 3; i++) w.add(part(new THREE.BoxGeometry(0.02, 0.62, 0.02).rotateX((i * Math.PI) / 3), '#bbbbbb'));
      holder.add(w);
      this.wheels.push(holder);
      return holder;
    };
    b.add(wheel(-0.55));
    // frame
    const tube = (len: number, x: number, y: number, z: number, rx: number) => {
      const m = part(new THREE.BoxGeometry(0.06, len, 0.06), color, x, y, z);
      m.rotation.x = rx;
      b.add(m);
    };
    tube(0.75, 0, 0.62, 0.05, 0.9); // top/down tube
    tube(0.6, 0, 0.6, -0.25, -0.35); // seat tube
    tube(0.55, 0, 0.42, -0.3, 1.2); // chain stay
    b.add(part(new THREE.BoxGeometry(0.16, 0.06, 0.28), '#2b2d42', 0, 0.95, -0.2)); // saddle
    this.seat.position.set(0, 0.98 - 0.95, -0.2);
    b.add(this.seat);
    // fork + front wheel + handlebar steer together
    const fork = new THREE.Group();
    fork.position.set(0, 0, 0.55);
    fork.add(wheel(0));
    const stem = part(new THREE.BoxGeometry(0.05, 0.75, 0.05), color, 0, 0.72, -0.05);
    stem.rotation.x = -0.25;
    fork.add(stem);
    fork.add(part(new THREE.BoxGeometry(0.55, 0.04, 0.04), '#2b2d42', 0, 1.08, -0.12));
    b.add(fork);
    this.fork = fork;
    // the wheel added to the fork was pushed to wheels with z=0 relative to the fork: fine
    const crank = new THREE.Group();
    crank.position.set(0, 0.38, -0.05);
    crank.add(part(new THREE.BoxGeometry(0.3, 0.04, 0.04), '#888888'));
    crank.add(part(new THREE.BoxGeometry(0.04, 0.3, 0.04), '#888888'));
    b.add(crank);
    this.crank = crank;
    b.add(part(new THREE.BoxGeometry(0.02, 0.3, 0.02), '#888888', 0.08, 0.18, -0.05)); // kickstand
  }

  private buildMotorbike(color: string): void {
    const b = this.body;
    const wheel = (z: number) => {
      const holder = new THREE.Group();
      holder.position.set(0, 0.4, z);
      const w = new THREE.Group();
      w.add(part(new THREE.CylinderGeometry(0.4, 0.4, 0.16, 14).rotateZ(Math.PI / 2), '#1b1b1b'));
      w.add(part(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 8).rotateZ(Math.PI / 2), '#adb5bd'));
      holder.add(w);
      this.wheels.push(holder);
      return holder;
    };
    b.add(wheel(-0.7));
    b.add(part(new THREE.BoxGeometry(0.42, 0.42, 0.9), color, 0, 0.72, 0.05)); // tank + body
    b.add(part(new THREE.BoxGeometry(0.36, 0.3, 0.5), '#3d405b', 0, 0.48, -0.05)); // engine
    b.add(part(new THREE.BoxGeometry(0.34, 0.1, 0.6), '#111111', 0, 0.95, -0.35)); // seat
    b.add(part(new THREE.BoxGeometry(0.4, 0.14, 0.5), color, 0, 0.78, -0.65)); // tail
    b.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8).rotateX(Math.PI / 2), '#c0c0c0', 0.24, 0.42, -0.55)); // exhaust
    b.add(part(new THREE.BoxGeometry(0.2, 0.08, 0.04), '#ff3b3b', 0, 0.82, -0.91, true)); // tail light
    this.seat.position.set(0, 0.99 - 0.95, -0.3);
    b.add(this.seat);
    const fork = new THREE.Group();
    fork.position.set(0, 0, 0.7);
    fork.add(wheel(0));
    const legs = part(new THREE.BoxGeometry(0.3, 0.7, 0.06), '#adb5bd', 0, 0.78, -0.12);
    legs.rotation.x = -0.35;
    fork.add(legs);
    fork.add(part(new THREE.BoxGeometry(0.7, 0.05, 0.05), '#222222', 0, 1.1, -0.32)); // handlebar
    fork.add(part(new THREE.BoxGeometry(0.2, 0.16, 0.1), '#fff8d6', 0, 0.98, -0.12, true)); // headlight
    b.add(fork);
    this.fork = fork;
    b.add(part(new THREE.BoxGeometry(0.03, 0.4, 0.03), '#888888', 0.18, 0.2, -0.1)); // kickstand
  }
}

const BIKE_COLORS = ['#ef476f', '#06d6a0', '#118ab2', '#ffd166', '#8338ec', '#ff6b35'];
const MOTO_COLORS = ['#1d3557', '#e63946', '#2a9d8f', '#111111', '#f77f00'];
const MAX_PARKED_CARS = 5;

/**
 * Every vehicle the Professor can use: parked bicycles and motorbikes around town (one of each by
 * the Lab, a bicycle at Grandma's), plus any traffic car he takes over.
 */
export class VehicleSystem {
  readonly vehicles: Vehicle[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
    landmarks: { lab: { x: number; z: number }; grandma: { x: number; z: number } },
  ) {
    const { lab, grandma } = landmarks;
    this.add(new Vehicle(physics, 'bike', new THREE.Vector3(lab.x + 13, 0, lab.z + 13), Math.PI / 2, { color: '#ffd166' }));
    this.add(new Vehicle(physics, 'motorbike', new THREE.Vector3(lab.x - 12, 0, lab.z + 13), -Math.PI / 2, { color: '#e63946' }));
    this.add(new Vehicle(physics, 'bike', new THREE.Vector3(grandma.x - 11, 0, grandma.z + 12), 0.4, { color: '#ff8fab' }));
    // A speedboat tied up at each pier
    this.add(new Vehicle(physics, 'boat', new THREE.Vector3(296, 0, 72), Math.PI / 2, { boatModel: 'speedboat', color: '#e63946' }));
    this.add(new Vehicle(physics, 'boat', new THREE.Vector3(PALM_ISLE.x - PALM_ISLE.r - 16, 0, PALM_ISLE.z + 20), -Math.PI / 2, { boatModel: 'speedboat', color: '#118ab2' }));

    // Parked along sidewalks around town
    const { roadMin, roadMax, roadStep } = WORLD;
    const rand = mulberry32(777);
    for (let i = 0; i < 16; i++) {
      const road = roadMin + Math.floor(rand() * ((roadMax - roadMin) / roadStep + 1)) * roadStep;
      const along = roadMin + roadStep / 2 + Math.floor(rand() * ((roadMax - roadMin) / roadStep)) * roadStep + (rand() - 0.5) * 30;
      const side = rand() < 0.5 ? -1 : 1;
      const alongX = rand() < 0.5;
      const kerb = (alongX ? roadWidthZ(road) : roadWidthX(road)) / 2 - 0.6;
      const pos = alongX ? new THREE.Vector3(along, 0, road + side * kerb) : new THREE.Vector3(road + side * kerb, 0, along);
      const heading = alongX ? Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI) : rand() < 0.5 ? 0 : Math.PI;
      const moto = i % 3 === 0;
      const colors = moto ? MOTO_COLORS : BIKE_COLORS;
      this.add(new Vehicle(physics, moto ? 'motorbike' : 'bike', pos, heading, { color: colors[Math.floor(rand() * colors.length)] }));
    }
  }

  private add(v: Vehicle): Vehicle {
    this.scene.add(v.group);
    this.vehicles.push(v);
    return v;
  }

  /** Turn a traffic car into a drivable car (its driver jumps out: the caller adds a fleeing pedestrian). */
  fromTraffic(car: Car): Vehicle {
    removeDriver(car.model);
    const v = new Vehicle(this.physics, 'car', car.agent.world.clone(), car.agent.heading, { model: car.model, carModel: car.kind });
    return this.add(v);
  }

  // ───────────────────────────────────────────── sea traffic

  private boatTarget = 6;

  /** Crowd setting: how many AI boats cruise the coast. */
  setBoats(n: number): void {
    this.boatTarget = n;
    const ai = this.vehicles.filter((v) => v.route && !v.driven);
    while (ai.length < n) ai.push(this.spawnBoat(ai.length));
    while (ai.length > n) this.remove(ai.pop()!);
  }

  private spawnBoat(i: number): Vehicle {
    const models: BoatModel[] = ['speedboat', 'fishing', 'yacht', 'coastguard'];
    const colors = ['#ffffff', '#e63946', '#118ab2', '#ffd166', '#06d6a0', '#f77f00'];
    const model = models[i % models.length];
    // two loops: around Palm Isle, and up and down the channel off the town's east coast
    const route: THREE.Vector3[] = [];
    if (i % 2 === 0) {
      const r = PALM_ISLE.r + 14 + (i % 3) * 2;
      const dir = i % 4 === 0 ? 1 : -1;
      for (let k = 0; k < 12; k++) {
        const a = (dir * k * Math.PI * 2) / 12;
        route.push(new THREE.Vector3(PALM_ISLE.x + Math.cos(a) * r, 0, PALM_ISLE.z + Math.sin(a) * r));
      }
    } else {
      const x = 302 + (i % 3) * 8;
      route.push(new THREE.Vector3(x, 0, -250), new THREE.Vector3(x + 20, 0, -80), new THREE.Vector3(x, 0, 90), new THREE.Vector3(x + 15, 0, 250), new THREE.Vector3(x + 40, 0, 120), new THREE.Vector3(x + 45, 0, -150));
    }
    const start = Math.floor(Math.random() * route.length);
    const p = route[start];
    const next = route[(start + 1) % route.length];
    const v = new Vehicle(this.physics, 'boat', p.clone().setY(WATER_Y), Math.atan2(next.x - p.x, next.z - p.z), { boatModel: model, color: colors[i % colors.length] });
    v.route = route;
    v['routeIndex'] = (start + 1) % route.length;
    seatDriver(v.model!);
    return this.add(v);
  }

  /** The Professor takes an AI boat: the skipper dives overboard. */
  takeBoat(v: Vehicle): THREE.Vector3 {
    v.route = null;
    if (v.model) removeDriver(v.model);
    const splash = v.localToWorld(new THREE.Vector3(3, 0, 0));
    // keep the sea busy: a replacement boat appears elsewhere
    setTimeout(() => this.setBoats(this.boatTarget), 8000);
    return splash;
  }

  private remove(v: Vehicle): void {
    this.scene.remove(v.group);
    this.physics.world.removeRigidBody(v.char.body);
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
  }

  /** Closest vehicle within reach of a point (feet), not currently driven. */
  nearest(feet: THREE.Vector3): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      if (v.driven) continue;
      const f = v.feet;
      const d = Math.hypot(f.x - feet.x, f.z - feet.z);
      const reach = v.kind === 'car' ? 3.4 : v.kind === 'boat' ? 5 : 2.0;
      if (d < reach && Math.abs(f.y - feet.y) < (v.kind === 'boat' ? 3.5 : 2) && d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  update(dt: number): void {
    for (const v of this.vehicles) {
      if (v.driven || v.flung) continue;
      if (v.route) v.cruise(dt);
      else v.idle(dt);
    }
  }

  /** Parked/abandoned vehicles within `radius` of `pos`. */
  near(pos: THREE.Vector3, radius: number): Vehicle[] {
    return this.vehicles.filter((v) => !v.driven && !v.flung && Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) < radius);
  }

  beginFling(v: Vehicle): void {
    v.flung = true;
    v.char.collider.setEnabled(false);
  }

  /** Landed: put its physics body where the mesh came down. */
  endFling(v: Vehicle, landing: THREE.Vector3, heading: number): void {
    v.char.collider.setEnabled(true);
    v.teleport(new THREE.Vector3(landing.x, landing.y + v.footOffset, landing.z), heading);
    v.speed = 0;
    v.flung = false;
  }

  render(dt: number, alpha: number, camera: THREE.Camera): void {
    for (const v of this.vehicles) {
      if (v.flung) continue;
      v.sync(alpha);
      if (v.driven || v.group.position.distanceToSquared(camera.position) < 120 * 120) v.animate(dt);
    }
  }

  /** Keep only a few taken cars around: remove the farthest abandoned one. */
  prune(player: THREE.Vector3): void {
    const cars = this.vehicles.filter((v) => v.stolen && !v.driven && !v.route);
    if (cars.length <= MAX_PARKED_CARS) return;
    const far = cars.reduce((a, b) => (a.pos.distanceToSquared(player) > b.pos.distanceToSquared(player) ? a : b));
    this.remove(far);
  }

  /** For traffic and pedestrians: where vehicles are. */
  obstacles(): { pos: THREE.Vector3; radius: number }[] {
    return this.vehicles.filter((v) => v.kind !== 'boat').map((v) => ({ pos: v.pos, radius: v.kind === 'car' ? 2 : 0.7 }));
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
