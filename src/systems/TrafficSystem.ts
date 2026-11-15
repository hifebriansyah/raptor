import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CAR_SPECS, buildCarModel, flashBeacons, seatDriver, type CarModel, type VehicleModel } from '../entities/CarModels';
import { dampAngle } from '../entities/CharacterEntity';
import type { PhysicsSystem } from './PhysicsSystem';
import { RoadAgent } from './RoadAgent';

export interface Car {
  agent: RoadAgent;
  mesh: THREE.Group;
  body: RAPIER.RigidBody;
  speed: number;
  cruise: number;
  heading: number;
  wheels: THREE.Object3D[];
  rival: boolean;
  name: string;
  /** Visual position (smoothed towards agent.world). */
  vis: THREE.Vector3;
  /** Set by the race system to override cruise speed. */
  targetSpeed: number | null;
  honk: number;
  /** Thrown through the air (the FlingSystem moves the mesh meanwhile). */
  flung: boolean;
  /** Which kind of vehicle (sedan, bus, police car…) and its model (glass cabin, driver). */
  kind: CarModel;
  model: VehicleModel;
}

/** Traffic mix (weights). Rivals always drive sports cars. */
const MIX: [CarModel, number][] = [
  ['sedan', 38],
  ['van', 12],
  ['roadster', 10],
  ['police', 9],
  ['bus', 8],
  ['racecar', 6],
  ['firetruck', 6],
  ['sports', 6],
];
const MODEL_COLOR: Partial<Record<CarModel, string>> = { police: '#1d3557', firetruck: '#d62828', bus: '#f4a300' };

function pickModel(): CarModel {
  const total = MIX.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [m, w] of MIX) {
    r -= w;
    if (r <= 0) return m;
  }
  return 'sedan';
}

const CAR_COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#a8dadc', '#ffffff', '#6d6875', '#b5838d', '#90be6d'];
const RIVALS = [
  { name: 'Blaze', color: '#e63946' },
  { name: 'Volt', color: '#ffd60a' },
  { name: 'Nitro Nana', color: '#9b5de5' },
];

/** Things in the road the cars should not drive into. */
export interface Obstacle {
  pos: THREE.Vector3;
  radius: number;
}

/**
 * Ambient traffic wandering the road grid plus the rival racers cruising the ring road. Cars are
 * kinematic bodies (the Raptor bumps into them), brake for anything in their lane and honk if
 * they wait too long.
 */
export class TrafficSystem {
  readonly cars: Car[] = [];
  /** Fired when a car honks (for sound). */
  onHonk: ((pos: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
    ambient = 18,
  ) {
    for (let i = 0; i < ambient; i++) this.spawn(false, CAR_COLORS[i % CAR_COLORS.length], `car${i}`);
    RIVALS.forEach((r) => this.spawn(true, r.color, r.name));
  }

  get rivals(): Car[] {
    return this.cars.filter((c) => c.rival);
  }

  private ambientTarget = 18;

  /** Crowd density option: how many ambient cars to keep on the roads. */
  setAmbient(n: number): void {
    this.ambientTarget = n;
  }
  private refillTimer = 0;

  /** Cars (rivals too) within `radius` of `pos`, not already flying. */
  near(pos: THREE.Vector3, radius: number): Car[] {
    return this.cars.filter((c) => !c.flung && Math.hypot(c.agent.world.x - pos.x, c.agent.world.z - pos.z) < radius);
  }

  /** Hand a car to the FlingSystem: it stops driving and loses its collider until it lands. */
  beginFling(car: Car): void {
    car.flung = true;
    car.speed = 0;
    car.body.setEnabled(false);
  }

  /** Landed: shake it off and rejoin the nearest road (rivals go back to the ring road). */
  endFling(car: Car, landing: THREE.Vector3): void {
    car.agent.placeNear(landing);
    car.vis.copy(car.agent.world);
    car.heading = car.agent.heading;
    car.mesh.position.copy(car.vis);
    car.mesh.rotation.set(0, car.heading, 0);
    car.model.driver?.sit();
    car.body.setTranslation({ x: car.vis.x, y: 0.75, z: car.vis.z }, true);
    car.body.setEnabled(true);
    car.flung = false;
    car.honk = -3;
  }

  /** An ambient car close enough for the Professor to take over (never the rival racers). */
  takeable(feet: THREE.Vector3): Car | null {
    let best: Car | null = null;
    let bestD = 3.6;
    for (const c of this.cars) {
      if (c.rival || c.flung) continue;
      const d = Math.hypot(c.agent.world.x - feet.x, c.agent.world.z - feet.z);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  /** Remove a car from traffic (its mesh is handed over to the caller). */
  take(car: Car): Car {
    this.cars.splice(this.cars.indexOf(car), 1);
    this.physics.world.removeRigidBody(car.body);
    return car;
  }

  /** Keep the streets busy: replace taken cars with new ones far from the player. */
  refill(dt: number, player: THREE.Vector3): void {
    this.refillTimer -= dt;
    if (this.refillTimer > 0) return;
    this.refillTimer = 1.5;
    const ambient = this.cars.filter((c) => !c.rival && !c.flung);
    if (ambient.length > this.ambientTarget) {
      // too many for the crowd setting: drop one the player can't see
      const far = ambient.reduce((a, b) => (a.agent.world.distanceToSquared(player) > b.agent.world.distanceToSquared(player) ? a : b));
      if (far.agent.world.distanceTo(player) > 90) {
        this.take(far);
        this.scene.remove(far.mesh);
      }
      return;
    }
    if (ambient.length >= this.ambientTarget) return;
    this.spawn(false, CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], 'car', player);
  }

  private spawn(rival: boolean, color: string, name: string, awayFrom?: THREE.Vector3): void {
    const agent = new RoadAgent(2.5, rival ? 'ring' : 'random');
    agent.outer = !rival && Math.random() < 0.5;
    // keep cars apart at spawn (and out of the player's sight when refilling)
    for (let tries = 0; tries < 30; tries++) {
      agent.placeRandom();
      const clear = this.cars.every((c) => c.agent.world.distanceTo(agent.world) > 25);
      const hidden = !awayFrom || agent.world.distanceTo(awayFrom) > 140;
      if (clear && hidden) break;
    }
    const kind: CarModel = rival ? 'sports' : pickModel();
    const spec = CAR_SPECS[kind];
    const model = buildCarModel(kind, MODEL_COLOR[kind] ?? color);
    seatDriver(model);
    const { group, wheels } = model;
    this.scene.add(group);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(agent.world.x, 0.75, agent.world.z),
    );
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(spec.half[0], kind === 'bus' || kind === 'firetruck' ? 1.4 : 0.75, spec.half[1]), body);
    const cruise = rival ? 24 : spec.cruise[0] + Math.random() * (spec.cruise[1] - spec.cruise[0]);
    this.cars.push({
      agent,
      mesh: group,
      body,
      speed: cruise,
      cruise,
      heading: agent.heading,
      wheels,
      rival,
      name,
      vis: agent.world.clone(),
      targetSpeed: null,
      honk: 0,
      flung: false,
      kind,
      model,
    });
  }

  /**
   * @param walker the Professor's feet when he is on foot: ambient cars he walks up to slow to a
   *               stop (so he can take one, GTA-style)
   */
  update(dt: number, obstacles: readonly Obstacle[], walker: THREE.Vector3 | null = null): void {
    for (const car of this.cars) {
      if (car.flung) continue;
      let want = car.targetSpeed ?? car.cruise;
      if (walker && !car.rival && Math.hypot(walker.x - car.agent.world.x, walker.z - car.agent.world.z) < 7) want = 0;
      // Look ahead in our lane for obstacles and other cars
      const fwd = car.agent.dir;
      const p = car.agent.world;
      let blocked = Infinity;
      const check = (q: THREE.Vector3, r: number) => {
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const ahead = dx * fwd.x + dz * fwd.z;
        const side = Math.abs(-dx * fwd.z + dz * fwd.x);
        if (ahead > 0 && ahead < 16 && side < 1.6 + r) blocked = Math.min(blocked, ahead - r);
      };
      for (const o of obstacles) check(o.pos, o.radius);
      for (const other of this.cars) if (other !== car && !other.flung) check(other.agent.world, CAR_SPECS[other.kind].half[1] + 0.2);

      let target = want;
      if (blocked < 14) target = Math.min(target, Math.max(0, (blocked - 4) * 1.2));
      const rate = target < car.speed ? 14 : car.rival ? 9 : 4;
      car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), rate * dt);

      // Honk when stuck behind something
      if (car.speed < 1 && blocked < 8) {
        car.honk += dt;
        if (car.honk > 2.5) {
          car.honk = -4;
          this.onHonk?.(p);
        }
      } else car.honk = Math.min(car.honk, 0) + dt * 0.5;

      car.agent.advance(car.speed * dt);
      const w = car.agent.world;
      car.body.setNextKinematicTranslation({ x: w.x, y: 0.75, z: w.z });
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.agent.heading);
      car.body.setNextKinematicRotation(q);
    }
  }

  /** Smooth visuals; call once per rendered frame. */
  render(dt: number): void {
    for (const car of this.cars) {
      if (car.flung) continue;
      car.vis.lerp(car.agent.world, 1 - Math.exp(-10 * dt));
      car.heading = dampAngle(car.heading, car.agent.heading, 7, dt);
      car.mesh.position.copy(car.vis);
      car.mesh.rotation.y = car.heading;
      for (const wh of car.wheels) wh.rotation.x += (car.speed / 0.38) * dt;
      flashBeacons(car.model, this.time);
    }
    this.time += dt;
  }

  private time = 0;
}
