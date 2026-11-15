import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import { OBSERVATORY, PALM_ISLE, PARK_BASIN, floorAt } from '../game/Terrain';
import { gameStore, showToast } from '../state/gameStore';
import type { MinimapMarker } from '../ui/Minimap';

export interface Pad {
  name: string;
  /** Feet position on the pad. */
  pos: THREE.Vector3;
}

/**
 * Teleport pads in every district, on Palm Isle, Cloud Isle and at the Moon Base. Step on one to
 * switch it on; then quick-travel between switched-on pads from the map (N) or from any portal in
 * the Lab's Teleport Hub (those always work).
 */
export class TeleportSystem {
  readonly pads: Pad[];
  private readonly rings: THREE.Mesh[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, lab: { x: number; z: number }) {
    const P = (name: string, x: number, z: number, y?: number): Pad => ({ name, pos: new THREE.Vector3(x, y ?? floorAt(x, z), z) });
    // same order as the Lab's hub portals
    this.pads = [
      P('Town (the Lab)', lab.x - 14, lab.z + 20),
      P('Downtown', 6.2, 6.2),
      P('Uptown (Observatory Hill)', OBSERVATORY.x - 8, OBSERVATORY.z + 18, OBSERVATORY.top),
      P('Harbour', 266, 46),
      P('The Sunken Park', PARK_BASIN.x, PARK_BASIN.z + 22),
      P('Palm Isle', PALM_ISLE.x - 72, PALM_ISLE.z - 6),
      P('Cloud Isle', 6, -34, 170),
      P('Moon Base', -122, 30, 520),
    ];
    for (const p of this.pads) {
      const g = new THREE.Group();
      g.position.copy(p.pos);
      g.add(part(new THREE.CylinderGeometry(1.6, 1.8, 0.2, 20), '#3c096c', 0, 0.1, 0));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.1, 6, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#c77dff' }));
      ring.position.y = 0.25;
      g.add(ring);
      this.rings.push(ring);
      scene.add(g);
    }
  }

  isOn(i: number): boolean {
    return gameStore.getState().pads.includes(i);
  }

  /** Switch on any pad the player steps onto. */
  update(dt: number, feet: THREE.Vector3): void {
    this.time += dt;
    this.rings.forEach((r, i) => {
      const on = this.isOn(i);
      r.position.y = 0.25 + (on ? Math.sin(this.time * 2 + i) * 0.15 + 0.15 : 0);
      (r.material as THREE.MeshBasicMaterial).color.set(on ? '#e0aaff' : '#5a189a');
    });
    this.pads.forEach((p, i) => {
      if (this.isOn(i)) return;
      if (Math.hypot(p.pos.x - feet.x, p.pos.z - feet.z) < 2 && Math.abs(p.pos.y - feet.y) < 2.5) {
        gameStore.setState((s) => ({ pads: [...s.pads, i] }));
        showToast(`Teleport pad switched on: ${p.name}! Press N to quick-travel.`);
        this.onActivate?.();
      }
    });
  }

  onActivate: (() => void) | null = null;

  markers(altitude: number): MinimapMarker[] {
    return this.pads
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => this.isOn(i) && (p.pos.y < 100 || altitude > 40))
      .map(({ p }) => ({ x: p.pos.x, z: p.pos.z, color: '#c77dff', label: '◎' }));
  }
}
