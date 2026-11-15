import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import { surfaceAt } from '../game/Terrain';

export interface ThrownTreat {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  landed: boolean;
  /** Seconds left before it goes stale and disappears. */
  life: number;
}

/**
 * Grandma's cookies as toys: thrown cookies fly in an arc, land and sit there as a lure (the Raptor
 * trots over to eat them; townsfolk come and look). The engine decides who eats what.
 */
export class TreatSystem {
  readonly treats: ThrownTreat[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  throw(from: THREE.Vector3, dir: THREE.Vector3): ThrownTreat {
    const mesh = new THREE.Group();
    mesh.add(part(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10), '#c98b4a'));
    for (let i = 0; i < 4; i++) mesh.add(part(new THREE.BoxGeometry(0.06, 0.05, 0.06), '#4a2c17', Math.cos(i * 1.7) * 0.12, 0.04, Math.sin(i * 1.7) * 0.12));
    mesh.position.copy(from);
    this.scene.add(mesh);
    const t: ThrownTreat = { mesh, pos: from.clone(), vel: dir.clone().setY(0).normalize().multiplyScalar(11).setY(7), landed: false, life: 40 };
    this.treats.push(t);
    return t;
  }

  /** The closest landed cookie within `radius`. */
  nearest(pos: THREE.Vector3, radius: number): ThrownTreat | null {
    let best: ThrownTreat | null = null;
    let bestD = radius;
    for (const t of this.treats) {
      if (!t.landed) continue;
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  eat(t: ThrownTreat): void {
    this.scene.remove(t.mesh);
    this.treats.splice(this.treats.indexOf(t), 1);
  }

  update(dt: number): void {
    for (const t of this.treats.slice()) {
      t.life -= dt;
      if (t.life <= 0) {
        this.eat(t);
        continue;
      }
      if (t.landed) continue;
      t.vel.y -= 30 * dt;
      t.pos.addScaledVector(t.vel, dt);
      t.mesh.rotation.x += dt * 9;
      const floor = surfaceAt(t.pos.x, t.pos.z) + 0.05;
      if (t.pos.y <= floor) {
        t.pos.y = floor;
        t.landed = true;
        t.mesh.rotation.set(0, Math.random() * 6, 0);
      }
      t.mesh.position.copy(t.pos);
    }
  }
}
