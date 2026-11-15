import * as THREE from 'three';
import { surfaceAt } from '../game/Terrain';
import type { Particles } from './ParticleSystem';
import type { PhysicsSystem } from './PhysicsSystem';

/** Something water can hit: a fire hotspot, a thief, a pedestrian… */
export interface WaterTarget {
  position: THREE.Vector3;
  radius: number;
  /** What it is, for auto-aim priorities. */
  kind?: 'fire' | 'thief' | 'person';
  /** Called once per droplet that lands inside the radius. */
  onHit(power: number, source: 'raptor' | 'professor'): void;
}

const MAX = 500;
const GRAVITY = -14;

/**
 * Pooled water droplets for the Raptor's water machine gun and the Professor's handheld blaster.
 * Droplets fly ballistically, splash on buildings/ground (ray-cast per step) and report hits to
 * registered targets.
 */
export class WaterSystem {
  readonly targets = new Set<WaterTarget>();
  private readonly mesh: THREE.InstancedMesh;
  private readonly pos: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly life = new Float32Array(MAX);
  private readonly power = new Float32Array(MAX);
  private readonly src: ('raptor' | 'professor')[] = [];
  private cursor = 0;
  private cooldown = 0;
  private readonly tmp = new THREE.Object3D();
  private readonly ignore = new Set<number>();
  /** Confetti Water cheat: every droplet a party colour. */
  set confetti(on: boolean) {
    const c = new THREE.Color();
    const party = ['#ff70a6', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c'];
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, c.set(on ? party[i % party.length] : '#ffffff'));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).color.set(on ? '#ffffff' : '#7fdcff');
  }

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
    private readonly particles: Particles,
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.85 }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.src.push('raptor');
    }
    this.hideAll();
    scene.add(this.mesh);
  }

  private hideAll(): void {
    this.tmp.scale.setScalar(0);
    this.tmp.updateMatrix();
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this.tmp.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Spray towards `target` for one step. `rate` is droplets per second.
   * Returns how many droplets were fired (for tank consumption).
   */
  spray(dt: number, origin: THREE.Vector3, target: THREE.Vector3, opts: { rate: number; speed: number; spread: number; power: number; source: 'raptor' | 'professor'; inherit?: THREE.Vector3 }): number {
    this.cooldown -= dt;
    let fired = 0;
    const dir = target.clone().sub(origin).normalize();
    while (this.cooldown <= 0) {
      this.cooldown += 1 / opts.rate;
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const jitter = new THREE.Vector3((Math.random() - 0.5) * opts.spread, (Math.random() - 0.5) * opts.spread, (Math.random() - 0.5) * opts.spread);
      this.pos[i].copy(origin);
      this.vel[i].copy(dir).add(jitter).normalize().multiplyScalar(opts.speed * (0.92 + Math.random() * 0.16));
      // compensate a little for the arc so the stream lands near the reticle
      const dist = origin.distanceTo(target);
      this.vel[i].y += (0.5 * -GRAVITY * Math.min(dist, 70)) / opts.speed;
      if (opts.inherit) this.vel[i].add(opts.inherit);
      this.life[i] = 1.8;
      this.power[i] = opts.power;
      this.src[i] = opts.source;
      fired++;
    }
    return fired;
  }

  /** Stop the spray cadence from banking up shots while not firing. */
  idle(): void {
    this.cooldown = Math.max(this.cooldown, 0);
  }

  update(dt: number): void {
    const step = new THREE.Vector3();
    const next = new THREE.Vector3();
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const p = this.pos[i];
      const v = this.vel[i];
      v.y += GRAVITY * dt;
      step.copy(v).multiplyScalar(dt);
      next.copy(p).add(step);

      // targets first (they are usually in front of walls)
      let hit = false;
      for (const t of this.targets) {
        if (next.distanceToSquared(t.position) < t.radius * t.radius) {
          t.onHit(this.power[i], this.src[i]);
          this.particles.splash(next, 3);
          hit = true;
          break;
        }
      }
      if (!hit) {
        const surface = surfaceAt(next.x, next.z) + 0.05;
        if (next.y <= surface) {
          next.y = surface;
          hit = true;
        } else {
          const len = step.length();
          const d = this.physics.rayDistance(p, next, this.ignore);
          if (d < len - 1e-3) {
            next.copy(p).addScaledVector(step, d / len);
            hit = true;
          }
        }
        if (hit) this.particles.splash(next, 4);
      }
      p.copy(next);
      if (hit || this.life[i] <= 0) this.life[i] = 0;
    }
  }

  /** Update instance matrices; call once per rendered frame. */
  render(): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] > 0) {
        this.tmp.position.copy(this.pos[i]);
        const sp = this.vel[i].length();
        this.tmp.scale.set(1, 1, 1 + sp * 0.04);
        this.tmp.lookAt(this.pos[i].x + this.vel[i].x, this.pos[i].y + this.vel[i].y, this.pos[i].z + this.vel[i].z);
      } else {
        this.tmp.scale.setScalar(0);
      }
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
