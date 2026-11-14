import * as THREE from 'three';
import { surfaceAt } from '../game/Terrain';
import type { Particles } from './ParticleSystem';

interface Flung {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  /** Height of the object's origin above the ground when resting. */
  rest: number;
  bounces: number;
  settled: number;
  onSettle: (pos: THREE.Vector3, heading: number) => void;
}

const GRAVITY = -30;

/**
 * Throws things through the air: cars, bikes and people hit by the turbo-charged Raptor, or caught
 * in a heavy landing. Each object tumbles, bounces a couple of times, lies still for a moment, then
 * hands control back to its owner via `onSettle` (the owner stops updating it meanwhile).
 */
export class FlingSystem {
  private readonly flung: Flung[] = [];
  onBounce: ((pos: THREE.Vector3, hard: boolean) => void) | null = null;

  constructor(private readonly particles: Particles) {}

  get count(): number {
    return this.flung.length;
  }

  launch(obj: THREE.Object3D, from: THREE.Vector3, vel: THREE.Vector3, rest: number, onSettle: Flung['onSettle'], spinScale = 1): void {
    this.flung.push({
      obj,
      pos: from.clone(),
      vel: vel.clone(),
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14).multiplyScalar(spinScale),
      rot: obj.rotation.clone(),
      rest,
      bounces: 0,
      settled: 0,
      onSettle,
    });
  }

  update(dt: number): void {
    for (const f of this.flung.slice()) {
      if (f.settled > 0) {
        f.settled += dt;
        if (f.settled > 1.6) {
          this.flung.splice(this.flung.indexOf(f), 1);
          f.obj.rotation.set(0, f.rot.y, 0);
          f.onSettle(f.pos.clone(), f.rot.y);
        }
        continue;
      }
      f.vel.y += GRAVITY * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.rot.x += f.spin.x * dt;
      f.rot.y += f.spin.y * dt;
      f.rot.z += f.spin.z * dt;
      const floor = surfaceAt(f.pos.x, f.pos.z) + f.rest;
      if (f.pos.y <= floor && f.vel.y < 0) {
        f.pos.y = floor;
        const hard = f.vel.y < -6;
        this.onBounce?.(f.pos, hard);
        this.particles.soft.emit({ pos: f.pos.clone().setY(floor - f.rest + 0.2), vel: new THREE.Vector3(0, 1.5, 0), spread: 2, color: '#d9c7a3', size: 1, grow: 2, life: 0.8, drag: 2, count: hard ? 8 : 3, alpha: 0.6 });
        if (hard && f.bounces < 2) {
          f.vel.y = -f.vel.y * 0.35;
          f.vel.x *= 0.55;
          f.vel.z *= 0.55;
          f.spin.multiplyScalar(0.5);
          f.bounces++;
        } else {
          // come to rest upright-ish, facing where it slid
          f.vel.set(0, 0, 0);
          f.rot.set(0, f.rot.y, 0);
          f.settled = 0.001;
        }
      }
      f.obj.position.copy(f.pos);
      f.obj.rotation.copy(f.rot);
    }
  }
}
