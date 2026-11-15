import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import type { MinimapMarker } from '../ui/Minimap';
import { SPACE_Y } from './Terrain';
import { Models } from './Models';

export interface SkyIsland {
  name: string;
  x: number;
  /** Height of the walkable top surface. */
  y: number;
  z: number;
  r: number;
  discovered: boolean;
}

const SKY = new THREE.Color('#bfe3ff');
const SPACE = new THREE.Color('#04050d');
/** Camera height above which stars, planet and space islands are drawn / below which the land is no longer drawn. */
const SPACE_SHOW = 190;
/** Cloud Isle is hidden above this (the town itself thins out by distance, see GameEngine.cullLand). */
const LAND_HIDE = 700;

/**
 * Up, up and away: a sky that fades to black with stars and a ringed planet as you
 * climb into space, and floating islands to land on — Cloud Isle above the town, and the Star Isles
 * and Moon Rock out in space (where gravity is low, see Terrain.gravityAt).
 */
export class SkyIslands {
  readonly islands: SkyIsland[] = [
    { name: 'Cloud Isle', x: 0, y: 170, z: -40, r: 26, discovered: false },
    { name: 'Crystal Star Isle', x: 180, y: 420, z: 60, r: 20, discovered: false },
    { name: 'Satellite Star Isle', x: 70, y: 470, z: 170, r: 15, discovered: false },
    { name: 'Moon Rock', x: -130, y: 520, z: 30, r: 30, discovered: false },
  ];
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.PointsMaterial;
  private readonly planet = new THREE.Group();
  private readonly planetMats: THREE.Material[] = [];
  private readonly crystals: THREE.Mesh[] = [];
  private readonly mats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly rand = mulberry32(4242);
  /** Stars, planet and the space islands: only drawn once you are high enough to see them. */
  private readonly spaceRoots: THREE.Object3D[] = [];
  /** Cloud Isle (the low floating island): not drawn once you are deep in space. */
  private readonly lowRoots: THREE.Object3D[] = [];
  private spaceVisible = true;
  /** False while deep in space: the town, sea, traffic and so on are not drawn (GameEngine applies it). */
  landVisible = true;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
  ) {
    // Stars: a shell of points that follows the camera, fading in with altitude
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = this.rand() * 2 - 1;
      const a = this.rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * 2200, u * 2200, Math.sin(a) * s * 2200], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);
    this.spaceRoots.push(this.stars);

    // A ringed planet hanging in space
    const pm = new THREE.MeshBasicMaterial({ color: '#b388ff', transparent: true, opacity: 0, fog: false });
    const rm = new THREE.MeshBasicMaterial({ color: '#ffd6a5', transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false });
    this.planetMats.push(pm, rm);
    this.planet.add(new THREE.Mesh(new THREE.SphereGeometry(260, 32, 20), pm));
    const ring = new THREE.Mesh(new THREE.RingGeometry(340, 470, 64), rm);
    ring.rotation.x = Math.PI / 2.4;
    this.planet.add(ring);
    this.planet.position.set(-1600, 1100, -2000);
    scene.add(this.planet);
    this.spaceRoots.push(this.planet);

    for (const isl of this.islands) this.buildIsland(isl);
  }

  private mat(color: string): THREE.MeshLambertMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.mats.set(color, m);
    }
    return m;
  }

  /** A floating island: grassy (or rocky) top you can stand on, a jagged rock cone underneath. */
  private buildIsland(isl: SkyIsland): void {
    const g = new THREE.Group();
    g.position.set(isl.x, isl.y, isl.z);
    const moon = isl.name === 'Moon Rock';
    const space = isl.y > SPACE_Y;
    const topColor = moon ? '#b8bcc6' : space ? '#7b6cff' : '#8ccf6a';
    const rockColor = moon ? '#7d828c' : space ? '#3d3466' : '#8d6e63';

    const top = new THREE.Mesh(new THREE.CylinderGeometry(isl.r, isl.r * 0.96, 1.4, 20), this.mat(topColor));
    top.position.y = -0.7;
    top.receiveShadow = true;
    g.add(top);
    const coneGeo = new THREE.ConeGeometry(isl.r * 0.96, isl.r * 1.5, 14, 3).rotateX(Math.PI);
    const p = coneGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > isl.r * 0.74) continue; // keep the rim
      p.setX(i, p.getX(i) * (0.8 + this.rand() * 0.4));
      p.setZ(i, p.getZ(i) * (0.8 + this.rand() * 0.4));
    }
    coneGeo.computeVertexNormals();
    const cone = new THREE.Mesh(coneGeo, this.mat(rockColor));
    cone.position.y = -1.4 - isl.r * 0.75;
    cone.castShadow = true;
    g.add(cone);
    this.scene.add(g);
    (space ? this.spaceRoots : this.lowRoots).push(g);
    // walkable top (characters stand on this collider)
    this.physics.addStaticCylinder(new THREE.Vector3(isl.x, isl.y - 0.7, isl.z), 0.7, isl.r);

    const spot = (frac: number) => {
      const a = this.rand() * Math.PI * 2;
      const rr = isl.r * frac * Math.sqrt(this.rand());
      return new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    };
    const solid = (mesh: THREE.Object3D, local: THREE.Vector3, halfH: number, radius: number) => {
      mesh.position.add(local);
      g.add(mesh);
      this.physics.addStaticCylinder(new THREE.Vector3(isl.x + local.x, isl.y + halfH, isl.z + local.z), halfH, radius);
    };

    if (isl.name === 'Cloud Isle') {
      // temple ruins: a ring of columns and a broken lintel, trees, and a waterfall off the edge
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const h = i % 2 ? 6 : 4.2;
        solid(part(new THREE.CylinderGeometry(0.7, 0.8, h, 8), '#f1ece2', 0, h / 2, 0), new THREE.Vector3(Math.cos(a) * 8, 0, Math.sin(a) * 8), h / 2, 0.8);
      }
      g.add(part(new THREE.BoxGeometry(9, 0.8, 1.6), '#e7dfd0', 4, 6.4, -4));
      g.add(part(new THREE.CylinderGeometry(3, 3, 0.4, 16), '#e7dfd0', 0, 0.2, 0));
      for (let i = 0; i < 7; i++) {
        const s = spot(0.85);
        if (s.length() < 11) continue;
        solid(part(new THREE.CylinderGeometry(0.3, 0.4, 2.6, 6), '#8d5a3b', 0, 1.3, 0), s.clone(), 1.3, 0.4);
        g.add(part(new THREE.IcosahedronGeometry(2, 0), '#3fa34d', s.x, 3.6, s.z));
      }
      const fall = new THREE.Mesh(new THREE.BoxGeometry(4, 60, 0.6), new THREE.MeshLambertMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.55, depthWrite: false }));
      fall.position.set(0, -30, isl.r - 0.2);
      g.add(fall);
      g.add(part(new THREE.BoxGeometry(4, 0.2, 6), '#7fd4ff', 0, 0.05, isl.r - 3));
    } else if (isl.name === 'Crystal Star Isle') {
      for (let i = 0; i < 9; i++) {
        const s = spot(0.8);
        const h = 2 + this.rand() * 4;
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: i % 2 ? '#5ef2ff' : '#ff8fff' }));
        c.scale.set(0.8, h / 2, 0.8);
        c.position.set(0, h / 2, 0);
        this.crystals.push(c);
        solid(c, s, h / 2, 0.8);
      }
    } else if (isl.name === 'Satellite Star Isle') {
      const sat = new THREE.Group();
      sat.add(part(new THREE.BoxGeometry(3, 3, 3), '#c0c6d0'));
      for (const sx of [-1, 1]) sat.add(part(new THREE.BoxGeometry(6, 0.1, 2.4), '#2f5dd0', sx * 4.6, 0, 0));
      sat.add(part(new THREE.ConeGeometry(1.4, 1.2, 12, 1, true).rotateX(-Math.PI / 2), '#e5e5e5', 0, 0.4, 2.1));
      sat.position.y = 1.6;
      sat.rotation.set(0.3, 0.8, 0.5);
      solid(sat, new THREE.Vector3(2, 0, -2), 1.6, 2);
      for (let i = 0; i < 4; i++) {
        const s = spot(0.7);
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
        c.position.set(0, 0.8, 0);
        this.crystals.push(c);
        solid(c, s, 0.8, 0.6);
      }
    } else {
      // Moon Rock: craters and a flag
      for (let i = 0; i < 6; i++) {
        const s = spot(0.8);
        const r = 2 + this.rand() * 3;
        const crater = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 6, 16).rotateX(Math.PI / 2), this.mat('#9aa0aa'));
        crater.position.set(s.x, 0.1, s.z);
        g.add(crater);
      }
      solid(part(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), '#dddddd', 0, 2, 0), new THREE.Vector3(-6, 0, 5), 2, 0.2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshLambertMaterial({ color: '#2a9d8f', side: THREE.DoubleSide }));
      flag.position.set(-4.9, 3.3, 5);
      g.add(flag);
    }
  }

  /** A small domed Moon Base on Moon Rock (enterable); returns its door (feet position). */
  buildMoonBase(): THREE.Vector3 {
    const isl = this.islands.find((i) => i.name === 'Moon Rock')!;
    const g = new THREE.Group();
    g.position.set(isl.x - 10, isl.y, isl.z - 6);
    if (Models.has('hangar_roundGlass')) {
      // Kenney space kit (CC0): a glass-domed hangar, a dish, a rover and an astronaut
      g.add(Models.get('hangar_roundGlass', { width: 18 }));
      const dish = Models.get('satelliteDish_large', { height: 7 });
      dish.position.set(-9, 0, -4);
      const rover = Models.get('rover', { length: 4 });
      rover.position.set(9, 0, 6);
      rover.rotation.y = -0.6;
      const astro = Models.get('astronautA', { height: 1.9 });
      astro.position.set(3, 0, 10);
      astro.rotation.y = Math.PI;
      g.add(dish, rover, astro);
      g.add(part(new THREE.BoxGeometry(1.6, 2.6, 0.1), '#1b2a49', 0, 1.3, 8.42, true)); // the door
    } else {
      g.add(part(new THREE.CylinderGeometry(7, 7, 4, 20), '#ced4da', 0, 2, 0));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#e9ecef', flatShading: true }));
      dome.position.y = 4;
      g.add(dome);
      g.add(part(new THREE.BoxGeometry(2.2, 2.8, 2), '#adb5bd', 0, 1.4, 7.4));
      g.add(part(new THREE.BoxGeometry(1.4, 2.4, 0.1), '#1b2a49', 0, 1.2, 8.42, true));
    }
    g.add(part(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), '#adb5bd', 4, 9, 0));
    g.add(part(new THREE.BoxGeometry(2.4, 1.4, 0.05), '#e63946', 5.2, 11, 0)); // a flag
    this.scene.add(g);
    this.spaceRoots.push(g);
    this.physics.addStaticCylinder(new THREE.Vector3(g.position.x, isl.y + 4, g.position.z), 4, 7);
    return new THREE.Vector3(g.position.x, isl.y, g.position.z + 9.2);
  }

  /** True if this scene child belongs to the sky layers (so GameEngine does not treat it as land). */
  owns(o: THREE.Object3D): boolean {
    return this.spaceRoots.includes(o) || this.lowRoots.includes(o);
  }

  /** Sky colour, fog, stars and planet follow the camera height; crystals sparkle. Layers are culled by height (with a gap so they do not flicker). */
  update(time: number, camera: THREE.Camera, scene: THREE.Scene): void {
    const y = camera.position.y;
    if (this.spaceVisible ? y < SPACE_SHOW - 15 : y > SPACE_SHOW) {
      this.spaceVisible = !this.spaceVisible;
      for (const o of this.spaceRoots) o.visible = this.spaceVisible;
    }
    if (this.landVisible ? y > LAND_HIDE : y < LAND_HIDE - 30) {
      this.landVisible = !this.landVisible;
      for (const o of this.lowRoots) o.visible = this.landVisible;
    }
    const t = THREE.MathUtils.smoothstep(y, 140, 420);
    const col = SKY.clone().lerp(SPACE, t);
    (scene.background as THREE.Color).copy(col);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(col);
    fog.near = THREE.MathUtils.lerp(180, 900, t);
    fog.far = THREE.MathUtils.lerp(560, 3200, t);
    this.stars.position.copy(camera.position);
    this.starMat.opacity = THREE.MathUtils.smoothstep(y, 200, 380);
    const po = THREE.MathUtils.smoothstep(y, 220, 420);
    for (const m of this.planetMats) (m as THREE.MeshBasicMaterial).opacity = po;
    this.planet.visible = this.spaceVisible && po > 0.01;
    this.planet.rotation.y = time * 0.01;
    this.crystals.forEach((c, i) => (c.rotation.y = time * (0.6 + (i % 3) * 0.2)));
  }

  /** The island someone is standing on (feet position), if any. */
  islandAt(feet: THREE.Vector3): SkyIsland | null {
    for (const isl of this.islands) {
      if (Math.hypot(feet.x - isl.x, feet.z - isl.z) < isl.r && Math.abs(feet.y - isl.y) < 2.5) return isl;
    }
    return null;
  }

  /** Minimap markers for the floating islands (only once you are up in the air). */
  markers(altitude: number): MinimapMarker[] {
    if (altitude < 40) return [];
    return this.islands.map((i) => ({ x: i.x, z: i.z, color: i.y > SPACE_Y ? '#7b6cff' : '#9ad7ff', label: i.y > SPACE_Y ? '✦' : '☁', pinToEdge: true }));
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
