import * as THREE from 'three';
import type { MapFeature } from '../game/WorldMap';
import type { Particles } from '../systems/ParticleSystem';
import type { WaterSystem, WaterTarget } from '../systems/WaterSystem';

interface Hotspot {
  pos: THREE.Vector3;
  intensity: number;
  flames: THREE.Group;
  target: WaterTarget;
  out: boolean;
}

const flameMats = ['#ff4d00', '#ff9f1c', '#ffd166'].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
const flameGeo = new THREE.ConeGeometry(0.7, 2.2, 6).translate(0, 1.1, 0);

/**
 * One burning building: a few flame hotspots on its walls/roof, a smoke column you can see across
 * town, and a flickering light. Spray every hotspot to zero intensity to put it out.
 */
export class FireHazard {
  readonly hotspots: Hotspot[] = [];
  readonly centre: THREE.Vector3;
  timeLeft: number;
  private smokeTimer = 0;
  private emberTimer = 0;
  onHotspotOut: ((pos: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly water: WaterSystem,
    private readonly particles: Particles,
    building: MapFeature,
    nearestRoad: { x: number; z: number },
    timeLimit: number,
    /** Borrowed from a pool created at start-up (adding lights later would recompile every material). */
    private readonly light: THREE.PointLight,
  ) {
    this.timeLeft = timeLimit;
    const h = building.h ?? 6;
    // Which face looks at the road?
    const dx = nearestRoad.x - building.x;
    const dz = nearestRoad.z - building.z;
    const alongX = Math.abs(dx) / building.w > Math.abs(dz) / building.d;
    const nx = alongX ? Math.sign(dx) : 0;
    const nz = alongX ? 0 : Math.sign(dz);
    const faceOff = alongX ? building.w / 2 + 0.5 : building.d / 2 + 0.5;
    const faceSpan = alongX ? building.d : building.w;

    const count = h > 12 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const across = (i / (count - 1) - 0.5) * faceSpan * 0.7;
      let y = 1.5 + Math.random() * Math.min(h - 2, 9);
      let px = building.x + nx * faceOff + (alongX ? 0 : across);
      let pz = building.z + nz * faceOff + (alongX ? across : 0);
      if (i === count - 1 && h < 14) {
        // one on the roof
        px = building.x + (Math.random() - 0.5) * building.w * 0.5;
        pz = building.z + (Math.random() - 0.5) * building.d * 0.5;
        y = h + 0.4;
      }
      this.addHotspot(new THREE.Vector3(px, y, pz));
    }
    this.centre = new THREE.Vector3(building.x, h, building.z);

    this.light.position.copy(this.hotspots[0].pos).add(new THREE.Vector3(nx * 2, 1, nz * 2));
  }

  private addHotspot(pos: THREE.Vector3): void {
    const flames = new THREE.Group();
    flames.position.copy(pos);
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Mesh(flameGeo, flameMats[k]);
      f.position.set((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8);
      f.scale.setScalar(1 - k * 0.25);
      flames.add(f);
    }
    this.scene.add(flames);
    const hs: Hotspot = {
      pos,
      intensity: 1,
      flames,
      out: false,
      target: {
        position: pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
        radius: 2.0,
        kind: 'fire',
        onHit: (power) => {
          if (hs.out) return;
          hs.intensity -= 0.032 * power;
          if (Math.random() < 0.3) this.particles.steam(hs.target.position);
          if (hs.intensity <= 0) {
            hs.out = true;
            hs.intensity = 0;
            this.water.targets.delete(hs.target);
            this.particles.steam(hs.pos);
            this.particles.steam(hs.pos);
            this.onHotspotOut?.(hs.pos);
          }
        },
      },
    };
    this.water.targets.add(hs.target);
    this.hotspots.push(hs);
  }

  get remaining(): number {
    return this.hotspots.filter((h) => !h.out).length;
  }

  get extinguished(): boolean {
    return this.remaining === 0;
  }

  /** Per rendered frame: flicker, embers, smoke. Burning hotspots slowly grow back if left alone. */
  update(dt: number, time: number): void {
    let total = 0;
    for (const hs of this.hotspots) {
      if (!hs.out) hs.intensity = Math.min(1, hs.intensity + dt * 0.015);
      total += hs.intensity;
      const s = hs.out ? 0 : 0.35 + hs.intensity * 0.8;
      hs.flames.visible = !hs.out;
      hs.flames.children.forEach((f, k) => {
        const flick = 0.85 + Math.sin(time * (9 + k * 3) + k) * 0.15 + Math.random() * 0.08;
        f.scale.set(s * (1 - k * 0.25), s * flick * (1.2 - k * 0.2), s * (1 - k * 0.25));
        f.rotation.y = time * (1 + k);
      });
    }
    this.light.intensity = this.extinguished ? 0 : (25 + Math.random() * 15) * (total / this.hotspots.length);

    // Embers and the tall smoke column
    this.emberTimer -= dt;
    this.smokeTimer -= dt;
    const burning = this.hotspots.filter((h) => !h.out);
    if (burning.length && this.emberTimer <= 0) {
      this.emberTimer = 0.05;
      const hs = burning[Math.floor(Math.random() * burning.length)];
      this.particles.glow.emit({ pos: hs.pos.clone().add(new THREE.Vector3(0, 1, 0)), vel: new THREE.Vector3(0, 4, 0), spread: 1.2, color: '#ffb703', size: 0.35, life: 0.9, drag: 0.5, count: 2 });
      this.particles.glow.emit({ pos: hs.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), vel: new THREE.Vector3(0, 2.5, 0), spread: 0.6, color: '#ff5400', size: 1.4, grow: -0.8, life: 0.6, count: 1 });
    }
    if (burning.length && this.smokeTimer <= 0) {
      this.smokeTimer = 0.09;
      const top = burning.reduce((a, b) => (b.pos.y > a.pos.y ? b : a));
      const shade = 0.25 + Math.random() * 0.2;
      this.particles.soft.emit({
        pos: top.pos.clone().add(new THREE.Vector3(0, 2, 0)),
        vel: new THREE.Vector3(0.8, 5, 0.4),
        spread: 0.8,
        color: new THREE.Color(shade, shade, shade + 0.03),
        size: 3,
        grow: 2.2,
        life: 9,
        drag: 0.05,
        alpha: 0.55,
      });
    }
  }

  dispose(): void {
    for (const hs of this.hotspots) {
      this.scene.remove(hs.flames);
      this.water.targets.delete(hs.target);
    }
    this.light.intensity = 0;
  }
}
