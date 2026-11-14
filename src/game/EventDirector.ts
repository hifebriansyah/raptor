import * as THREE from 'three';
import { FireHazard } from '../entities/FireHazard';
import { addPoints, clearObjective, gameStore, setObjective, showToast } from '../state/gameStore';
import type { Particles } from '../systems/ParticleSystem';
import type { WaterSystem } from '../systems/WaterSystem';
import type { MinimapMarker } from '../ui/Minimap';
import { WORLD, type MapFeature, type WorldMap } from './WorldMap';

const FIRE_TIME = 150;
const FIRE_REWARD = 50;

export type DirectorEvent = 'fireStart' | 'hotspotOut' | 'fireOut' | 'fireFailed';

/**
 * Runs the living-neighbourhood clock: schedules building fires, drains the Raptor's treat meter
 * (which drives the cookie-craving mystery), and counts down Sugar Rush.
 */
export class EventDirector {
  fire: FireHazard | null = null;
  private nextFire = 40;
  private objectiveText = '';
  private readonly lights: THREE.PointLight[] = [];
  onEvent: ((e: DirectorEvent, pos: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: WorldMap,
    private readonly water: WaterSystem,
    private readonly particles: Particles,
  ) {
    // Fire light lives in the scene from the start (intensity 0) so no shader recompiles later.
    const light = new THREE.PointLight('#ff7b00', 0, 30, 1.6);
    scene.add(light);
    this.lights.push(light);
  }

  /** Where the fire is, for kids' gossip ("over by the ..."). */
  get fireArea(): string | null {
    if (!this.fire) return null;
    const c = this.fire.centre;
    const ns = c.z < -60 ? 'north' : c.z > 60 ? 'south' : '';
    const ew = c.x < -60 ? 'west' : c.x > 60 ? 'east' : '';
    return ns || ew ? `the ${ns}${ns && ew ? '-' : ''}${ew} side of town` : 'the town centre';
  }

  update(dt: number, player: THREE.Vector3): void {
    this.updateTreats(dt);
    this.updateFire(dt, player);
  }

  private updateTreats(dt: number): void {
    const s = gameStore.getState();
    const lvl = s.upgrades.dispenser;
    let treats = s.treats;
    if (s.raptorStatus === 'parked' && lvl >= 1) treats += 6 * dt; // the dispenser feeds it at the Lab
    else treats -= (100 / 540) * (1 - 0.25 * Math.max(0, lvl - 1)) * dt; // empty in ~9 minutes
    treats = THREE.MathUtils.clamp(treats, 0, 100);
    const sugarRush = Math.max(0, s.sugarRush - dt);
    if (Math.abs(treats - s.treats) > 0.1 || (sugarRush === 0) !== (s.sugarRush === 0) || Math.ceil(sugarRush) !== Math.ceil(s.sugarRush)) {
      gameStore.setState({ treats, sugarRush });
    }
  }

  private updateFire(dt: number, player: THREE.Vector3): void {
    if (!this.fire) {
      this.nextFire -= dt;
      if (this.nextFire <= 0) this.startFire(player);
      return;
    }
    const f = this.fire;
    f.timeLeft -= dt;
    if (f.extinguished) {
      const bonus = Math.floor(f.timeLeft / 3);
      addPoints(FIRE_REWARD + bonus);
      showToast(`Fire's out! +${FIRE_REWARD + bonus} Lab Points`);
      this.onEvent?.('fireOut', f.centre);
      this.endFire();
      return;
    }
    if (f.timeLeft <= 0) {
      showToast('The fire brigade got there first. No points this time!');
      this.onEvent?.('fireFailed', f.centre);
      this.endFire();
      return;
    }
    const t = Math.ceil(f.timeLeft);
    const text = `Put out the fire on ${this.fireArea}: ${f.remaining} hotspot${f.remaining === 1 ? '' : 's'} · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (text !== this.objectiveText) {
      this.objectiveText = text;
      setObjective({ id: 'fire', icon: 'fire', text });
    }
  }

  /** Start a fire now (also used by the dev console). */
  startFire(player: THREE.Vector3): void {
    if (this.fire) return;
    const candidates = this.world.buildings.filter((b) => {
      const d = Math.hypot(b.x - player.x, b.z - player.z);
      return d > 60 && d < 260;
    });
    const pool = candidates.length ? candidates : this.world.buildings;
    const b = pool[Math.floor(Math.random() * pool.length)];
    this.fire = new FireHazard(this.scene, this.water, this.particles, b, nearestRoad(b), FIRE_TIME, this.lights[0]);
    this.fire.onHotspotOut = (p) => this.onEvent?.('hotspotOut', p);
    this.objectiveText = '';
    showToast(`Smoke over ${this.fireArea}! Grab the Raptor's water cannon!`);
    this.onEvent?.('fireStart', this.fire.centre);
  }

  private endFire(): void {
    this.fire?.dispose();
    this.fire = null;
    this.nextFire = 70 + Math.random() * 60;
    clearObjective('fire');
  }

  render(dt: number, time: number): void {
    this.fire?.update(dt, time);
  }

  markers(): MinimapMarker[] {
    if (!this.fire) return [];
    const c = this.fire.centre;
    return [{ x: c.x, z: c.z, color: '#ff5400', label: '🔥', pinToEdge: true }];
  }
}

function nearestRoad(b: MapFeature): { x: number; z: number } {
  const snap = (v: number) => WORLD.roadMin + Math.round((v - WORLD.roadMin) / WORLD.roadStep) * WORLD.roadStep;
  const rx = snap(b.x);
  const rz = snap(b.z);
  return Math.abs(rx - b.x) < Math.abs(rz - b.z) ? { x: rx, z: b.z } : { x: b.x, z: rz };
}
