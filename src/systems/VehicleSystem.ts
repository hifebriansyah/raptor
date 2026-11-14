import * as THREE from 'three';
import { CharacterEntity, part } from '../entities/CharacterEntity';
import type { InputManager } from '../game/InputManager';
import { WORLD } from '../game/WorldMap';
import type { PhysicsSystem } from './PhysicsSystem';
import { buildCar, type Car } from './TrafficSystem';

export type VehicleKind = 'car' | 'bike' | 'motorbike';

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
};

export const VEHICLE_LABEL: Record<VehicleKind, string> = { car: 'car', bike: 'bicycle', motorbike: 'motorbike' };

/**
 * A vehicle the Professor can take: a car (taken from traffic), a bicycle or a motorbike.
 * Arcade handling like the Raptor's race mode: W/S throttle and brake, A/D steer, Space handbrake
 * (car) or bunny-hop (bikes), Shift for extra speed. Left alone it rolls to a stop and stays put.
 */
export class Vehicle extends CharacterEntity {
  driven = false;
  speed = 0;
  readonly events: ('crash' | 'hop')[] = [];
  /** Where the Professor sits (bikes); cars hide him. */
  readonly seat = new THREE.Object3D();
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
    carMesh?: { group: THREE.Group; wheels: THREE.Object3D[] },
    color?: string,
  ) {
    const t = TUNING[kind];
    const centre = feet.clone().setY(feet.y + t.halfHeight + t.radius + 0.1);
    super(physics, physics.createCharacter({ position: centre, radius: t.radius, halfHeight: t.halfHeight, maxStep: t.maxStep }), {
      accel: 0,
      airAccel: 0,
      turnRate: 0,
      jumpSpeed: 5.5,
    });
    this.tuning2 = t;
    this.stolen = kind === 'car';
    this.heading = heading;
    this.teleport(centre, heading);
    this.group.add(this.body);
    if (kind === 'car') {
      const mesh = carMesh ?? buildCar(color ?? '#e76f51', false);
      mesh.group.position.set(0, 0, 0);
      mesh.group.rotation.set(0, 0, 0);
      this.body.add(mesh.group);
      this.wheels = mesh.wheels;
    } else if (kind === 'bike') this.buildBike(color ?? '#ef476f');
    else this.buildMotorbike(color ?? '#1d3557');
  }

  get moving(): boolean {
    return !this.resting;
  }

  /** One physics step while the Professor drives. */
  drive(dt: number, input: InputManager, speedMult: number): void {
    this.resting = false;
    this.beginStep();
    const t = this.tuning2;
    const a = input.moveAxis();
    const throttle = a.z;
    const steer = a.x;
    const handbrake = this.kind === 'car' && input.ascend;
    const wet = this.depth > 0.5; // wheels in the sea: barely moving
    const top = (input.sprint ? t.sprintTop : t.top) * speedMult * (wet ? 0.25 : 1);

    if (this.grounded) {
      if (throttle > 0) {
        if (this.speed < top) this.speed += t.accel * throttle * dt;
      } else if (throttle < 0) {
        this.speed -= (this.speed > 0 ? 30 : t.accel * 0.6) * -throttle * dt;
        this.speed = Math.max(this.speed, -t.reverse);
      } else this.speed *= Math.exp(-(this.kind === 'bike' ? 0.6 : 0.8) * dt);
      if (handbrake) this.speed *= Math.exp(-0.6 * dt);
      if (this.speed > top) this.speed -= 10 * dt;
      if (this.kind !== 'car' && input.jump) {
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
    if (this.kind !== 'car') {
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
    this.add(new Vehicle(physics, 'bike', new THREE.Vector3(lab.x + 13, 0, lab.z + 13), Math.PI / 2, undefined, '#ffd166'));
    this.add(new Vehicle(physics, 'motorbike', new THREE.Vector3(lab.x - 12, 0, lab.z + 13), -Math.PI / 2, undefined, '#e63946'));
    this.add(new Vehicle(physics, 'bike', new THREE.Vector3(grandma.x - 11, 0, grandma.z + 12), 0.4, undefined, '#ff8fab'));

    // Parked along sidewalks around town
    const { roadMin, roadMax, roadStep, roadWidth } = WORLD;
    const rand = mulberry32(777);
    const kerb = roadWidth / 2 - 0.6;
    for (let i = 0; i < 16; i++) {
      const road = roadMin + Math.floor(rand() * ((roadMax - roadMin) / roadStep + 1)) * roadStep;
      const along = roadMin + roadStep / 2 + Math.floor(rand() * ((roadMax - roadMin) / roadStep)) * roadStep + (rand() - 0.5) * 30;
      const side = rand() < 0.5 ? -1 : 1;
      const alongX = rand() < 0.5;
      const pos = alongX ? new THREE.Vector3(along, 0, road + side * kerb) : new THREE.Vector3(road + side * kerb, 0, along);
      const heading = alongX ? Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI) : rand() < 0.5 ? 0 : Math.PI;
      const moto = i % 3 === 0;
      const colors = moto ? MOTO_COLORS : BIKE_COLORS;
      this.add(new Vehicle(physics, moto ? 'motorbike' : 'bike', pos, heading, undefined, colors[Math.floor(rand() * colors.length)]));
    }
  }

  private add(v: Vehicle): Vehicle {
    this.scene.add(v.group);
    this.vehicles.push(v);
    return v;
  }

  /** Turn a traffic car into a drivable car (its driver is handled by the caller). */
  fromTraffic(car: Car): Vehicle {
    const v = new Vehicle(this.physics, 'car', car.agent.world.clone(), car.agent.heading, { group: car.mesh, wheels: car.wheels });
    return this.add(v);
  }

  /** Closest vehicle within reach of a point (feet), not currently driven. */
  nearest(feet: THREE.Vector3): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      if (v.driven) continue;
      const f = v.feet;
      const d = Math.hypot(f.x - feet.x, f.z - feet.z);
      const reach = v.kind === 'car' ? 3.4 : 2.0;
      if (d < reach && Math.abs(f.y - feet.y) < 2 && d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  update(dt: number): void {
    for (const v of this.vehicles) if (!v.driven) v.idle(dt);
  }

  render(dt: number, alpha: number, camera: THREE.Camera): void {
    for (const v of this.vehicles) {
      v.sync(alpha);
      if (v.driven || v.group.position.distanceToSquared(camera.position) < 120 * 120) v.animate(dt);
    }
  }

  /** Keep only a few taken cars around: remove the farthest abandoned one. */
  prune(player: THREE.Vector3): void {
    const cars = this.vehicles.filter((v) => v.stolen && !v.driven);
    if (cars.length <= MAX_PARKED_CARS) return;
    const far = cars.reduce((a, b) => (a.pos.distanceToSquared(player) > b.pos.distanceToSquared(player) ? a : b));
    this.scene.remove(far.group);
    this.physics.world.removeRigidBody(far.char.body);
    this.vehicles.splice(this.vehicles.indexOf(far), 1);
  }

  /** For traffic and pedestrians: where vehicles are. */
  obstacles(): { pos: THREE.Vector3; radius: number }[] {
    return this.vehicles.map((v) => ({ pos: v.pos, radius: v.kind === 'car' ? 2 : 0.7 }));
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
