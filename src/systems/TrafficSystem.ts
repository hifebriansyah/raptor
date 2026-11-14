import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { dampAngle, part } from '../entities/CharacterEntity';
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

  private readonly ambientTarget = 18;
  private refillTimer = 0;

  /** An ambient car close enough for the Professor to take over (never the rival racers). */
  takeable(feet: THREE.Vector3): Car | null {
    let best: Car | null = null;
    let bestD = 3.6;
    for (const c of this.cars) {
      if (c.rival) continue;
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
    this.refillTimer = 3;
    if (this.cars.filter((c) => !c.rival).length >= this.ambientTarget) return;
    this.spawn(false, CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], 'car', player);
  }

  private spawn(rival: boolean, color: string, name: string, awayFrom?: THREE.Vector3): void {
    const agent = new RoadAgent(2.5, rival ? 'ring' : 'random');
    // keep cars apart at spawn (and out of the player's sight when refilling)
    for (let tries = 0; tries < 30; tries++) {
      agent.placeRandom();
      const clear = this.cars.every((c) => c.agent.world.distanceTo(agent.world) > 25);
      const hidden = !awayFrom || agent.world.distanceTo(awayFrom) > 140;
      if (clear && hidden) break;
    }
    const { group, wheels } = buildCar(color, rival);
    this.scene.add(group);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(agent.world.x, 0.75, agent.world.z),
    );
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 0.75, 2.1), body);
    const cruise = rival ? 24 : 9 + Math.random() * 4;
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
    });
  }

  /**
   * @param walker the Professor's feet when he is on foot: ambient cars he walks up to slow to a
   *               stop (so he can take one, GTA-style)
   */
  update(dt: number, obstacles: readonly Obstacle[], walker: THREE.Vector3 | null = null): void {
    for (const car of this.cars) {
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
      for (const other of this.cars) if (other !== car) check(other.agent.world, 2.2);

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
      car.vis.lerp(car.agent.world, 1 - Math.exp(-10 * dt));
      car.heading = dampAngle(car.heading, car.agent.heading, 7, dt);
      car.mesh.position.copy(car.vis);
      car.mesh.rotation.y = car.heading;
      for (const wh of car.wheels) wh.rotation.x += (car.speed / 0.38) * dt;
    }
  }
}

export function buildCar(color: string, sporty: boolean): { group: THREE.Group; wheels: THREE.Object3D[] } {
  const g = new THREE.Group();
  const wheels: THREE.Object3D[] = [];
  const bodyH = sporty ? 0.65 : 0.8;
  g.add(part(new THREE.BoxGeometry(2, bodyH, 4.2), color, 0, 0.35 + bodyH / 2, 0));
  const cabinW = sporty ? 1.6 : 1.75;
  const cabinH = sporty ? 0.55 : 0.75;
  g.add(part(new THREE.BoxGeometry(cabinW, cabinH, sporty ? 1.8 : 2.2), color, 0, 0.35 + bodyH + cabinH / 2, -0.25));
  g.add(part(new THREE.BoxGeometry(cabinW + 0.04, cabinH * 0.7, sporty ? 1.5 : 1.9), '#2b3a55', 0, 0.35 + bodyH + cabinH / 2, -0.25));
  // lights
  for (const sx of [-0.65, 0.65]) {
    g.add(part(new THREE.BoxGeometry(0.4, 0.18, 0.05), '#fff8d6', sx, 0.35 + bodyH * 0.6, 2.11, true));
    g.add(part(new THREE.BoxGeometry(0.4, 0.15, 0.05), '#ff3b3b', sx, 0.35 + bodyH * 0.6, -2.11, true));
  }
  if (sporty) {
    g.add(part(new THREE.BoxGeometry(0.4, bodyH + 0.02, 4.22), '#ffffff', 0, 0.35 + bodyH / 2, 0)); // racing stripe
    g.add(part(new THREE.BoxGeometry(1.9, 0.1, 0.5), '#222222', 0, 0.35 + bodyH + 0.45, -1.9)); // spoiler
    for (const sx of [-0.7, 0.7]) g.add(part(new THREE.BoxGeometry(0.1, 0.4, 0.1), '#222222', sx, 0.35 + bodyH + 0.2, -1.9));
  }
  for (const [wx, wz] of [[-1, 1.35], [1, 1.35], [-1, -1.35], [1, -1.35]] as const) {
    const w = new THREE.Group();
    w.position.set(wx, 0.38, wz);
    w.add(part(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10).rotateZ(Math.PI / 2), '#222222'));
    w.add(part(new THREE.BoxGeometry(0.32, 0.14, 0.14), '#bbbbbb'));
    wheels.push(w);
    g.add(w);
  }
  return { group: g, wheels };
}
