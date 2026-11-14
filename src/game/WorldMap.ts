import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsSystem, RAPIER } from '../systems/PhysicsSystem';
import { BOUNDS, MAIN_ISLAND, PALM_ISLE, SEABED_Y, WATER_Y } from './Terrain';

/** Map layout constants (metres). The town is a 9×9 road grid inside a coastal ring. */
export const WORLD = {
  /** Half the size of the playable square; invisible walls stand here. */
  half: 282,
  /** Land (beach) half-size; beyond is sea. */
  landHalf: 280,
  roadStep: 60,
  roadMin: -240,
  roadMax: 240,
  roadWidth: 10,
} as const;

export type FeatureKind = 'road' | 'sidewalk' | 'building' | 'park' | 'lab' | 'pad' | 'grandma' | 'hideout' | 'hut' | 'pier';

/** Axis-aligned rectangle (centre + size) for the minimap. */
export interface MapFeature {
  kind: FeatureKind;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Height (buildings), used to place fires. */
  h?: number;
  color?: string;
}

export interface Hideout {
  name: string;
  /** Where the stolen Raptor is kept (feet position). */
  raptorSpot: THREE.Vector3;
  /** Where thieves stand guard. */
  guardSpots: THREE.Vector3[];
}

export interface Landmarks {
  labPad: { x: number; z: number; radius: number; facing: number };
  lab: { x: number; z: number };
  /** In front of the garage door: the upgrade bench. */
  labBench: THREE.Vector3;
  grandma: { x: number; z: number };
  /** Where Grandma sits on the porch. */
  grandmaPorch: THREE.Vector3;
  /** The front yard the grandchildren play in (centre + half-size). */
  grandmaYard: { x: number; z: number; hx: number; hz: number };
  /** A spot in the attic where the Raptor curls up with cookies (feet position). */
  atticSpot: THREE.Vector3;
  professorSpawn: THREE.Vector3;
}

interface BoxOpts {
  collide?: boolean;
  rot?: THREE.Euler;
  material?: THREE.Material;
  castShadow?: boolean;
  /** Bake into a shared merged mesh (static scenery, fewer draw calls). */
  merge?: boolean;
}

const LAB = { x: -30, z: 30 };
const GRANDMA = { x: 90, z: -90 };
/** Blocks left empty for thief hideouts: warehouse, junkyard, forest clearing. */
const HIDEOUT_BLOCKS: [number, number][] = [[-210, -150], [150, 210], [-150, 210]];

/** Grandma's house interior footprint (local half-sizes) and floor heights. */
const HOUSE = { hx: 7, hz: 6, wall: 0.3, groundH: 3.2, atticFloor: 3.4, atticH: 4.2 };

export class WorldMap {
  readonly features: MapFeature[] = [];
  readonly landmarks: Landmarks;
  /** Collider handles the follow camera should look through (Grandma's house while inside it). */
  readonly cameraIgnore = new Set<number>();

  private readonly mats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly houseColliders: number[] = [];
  /** House walls + roof, faded while the Professor is inside. */
  private readonly houseShell: THREE.Mesh[] = [];
  /** Attic floor, faded only while the Professor is on the ground floor. */
  private readonly houseCeiling: THREE.Mesh[] = [];
  private insideHouse: 'no' | 'ground' | 'attic' = 'no';
  private readonly rand = mulberry32(20261114);
  private readonly treeSpots: THREE.Vector3[] = [];
  private readonly mergeBuckets = new Map<string, THREE.BufferGeometry[]>();
  /** Hydrants and park fountains: the Raptor refills its water tank near these. */
  readonly refillPoints: THREE.Vector3[] = [];
  readonly hideouts: Hideout[] = [];
  /** Ring-road loop (clockwise corners) the rival racers drive. */
  readonly ringLoop: THREE.Vector3[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
  ) {
    this.buildGroundAndSea();
    this.buildRoads();
    this.buildLab();
    this.buildGrandmaHouse();
    this.buildBlocks();
    this.buildHydrants();
    this.buildRamps();
    this.buildHideouts();
    this.buildPalmIsle();
    this.buildTrees();
    this.buildBoundary();
    this.flushMerged();

    const R = WORLD.roadMax;
    this.ringLoop.push(new THREE.Vector3(-R, 0, -R), new THREE.Vector3(R, 0, -R), new THREE.Vector3(R, 0, R), new THREE.Vector3(-R, 0, R));

    this.landmarks = {
      labPad: { x: LAB.x, z: LAB.z + 16, radius: 5, facing: 0 },
      lab: { ...LAB },
      labBench: new THREE.Vector3(LAB.x + 9, 0, LAB.z + 3),
      grandma: { ...GRANDMA },
      grandmaPorch: new THREE.Vector3(GRANDMA.x + 3.5, 0.24, GRANDMA.z + HOUSE.hz + 1.4),
      grandmaYard: { x: GRANDMA.x, z: GRANDMA.z + 15, hx: 18, hz: 6 },
      atticSpot: new THREE.Vector3(GRANDMA.x + 2, HOUSE.atticFloor + 0.02, GRANDMA.z - 1),
      professorSpawn: new THREE.Vector3(LAB.x + 7, 1.2, LAB.z + 20),
    };
  }

  /** Every building footprint (with height) — candidates for neighbourhood fires. */
  get buildings(): MapFeature[] {
    return this.features.filter((f) => f.kind === 'building');
  }

  /** Fades Grandma's house shell when the Professor walks in, so the camera can see inside. */
  update(professorPos: THREE.Vector3): void {
    const lx = professorPos.x - GRANDMA.x;
    const lz = professorPos.z - GRANDMA.z;
    let state: typeof this.insideHouse = 'no';
    if (Math.abs(lx) < HOUSE.hx && Math.abs(lz) < HOUSE.hz) {
      state = professorPos.y > HOUSE.atticFloor + 0.5 ? 'attic' : 'ground';
    }
    if (state === this.insideHouse) return;
    this.insideHouse = state;

    const inside = state !== 'no';
    for (const m of this.houseShell) setFade(m, inside ? 0.12 : 1);
    for (const m of this.houseCeiling) setFade(m, state === 'ground' ? 0.12 : 1);
    this.cameraIgnore.clear();
    if (inside) for (const h of this.houseColliders) this.cameraIgnore.add(h);
  }

  // ───────────────────────────────────────────── building blocks

  private mat(color: string): THREE.MeshLambertMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.mats.set(color, m);
    }
    return m;
  }

  /** Adds a box mesh (and, by default, a matching static collider). `cy` is the centre height. */
  private box(cx: number, cy: number, cz: number, w: number, h: number, d: number, color: string, opts: BoxOpts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material ?? this.mat(color));
    mesh.position.set(cx, cy, cz);
    if (opts.rot) mesh.rotation.copy(opts.rot);
    if (opts.merge) {
      mesh.updateMatrix();
      this.bucket(color + (opts.castShadow === false ? '|ns' : '')).push(mesh.geometry.clone().applyMatrix4(mesh.matrix));
      let collider: RAPIER.Collider | undefined;
      if (opts.collide ?? true) {
        const q = opts.rot ? new THREE.Quaternion().setFromEuler(opts.rot) : undefined;
        collider = this.physics.addStaticBox(mesh.position, new THREE.Vector3(w / 2, h / 2, d / 2), q);
      }
      return { mesh, collider };
    }
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    let collider: RAPIER.Collider | undefined;
    if (opts.collide ?? true) {
      const q = opts.rot ? new THREE.Quaternion().setFromEuler(opts.rot) : undefined;
      collider = this.physics.addStaticBox(mesh.position, new THREE.Vector3(w / 2, h / 2, d / 2), q);
    }
    return { mesh, collider };
  }

  private bucket(key: string): THREE.BufferGeometry[] {
    let b = this.mergeBuckets.get(key);
    if (!b) {
      b = [];
      this.mergeBuckets.set(key, b);
    }
    return b;
  }

  /** A flat ground decal baked into the merged scenery. */
  private flatMerged(w: number, d: number, color: string, x: number, y: number, z: number): void {
    this.bucket(color + '|ns').push(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z));
  }

  /** Turn all `merge` boxes into one mesh per colour. */
  private flushMerged(): void {
    for (const [key, geos] of this.mergeBuckets) {
      const [color, flag] = key.split('|');
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.mat(color));
      mesh.castShadow = flag !== 'ns';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    this.mergeBuckets.clear();
  }

  private flat(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.mat(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  // ───────────────────────────────────────────── terrain

  private buildGroundAndSea(): void {
    // No ground collider: the floor is handled by hand (see Terrain + CharacterEntity).
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ color: '#3fa7d6', transparent: true, opacity: 0.82, depthWrite: false }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = WATER_Y;
    sea.renderOrder = 1;
    this.scene.add(sea);
    const seabed = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#2b7a9e' }));
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = SEABED_Y;
    this.scene.add(seabed);
    const L = MAIN_ISLAND.half;
    this.flat(new THREE.PlaneGeometry(L * 2, L * 2), '#f2dca0', 0, 0, 0); // beach
    this.flat(new THREE.PlaneGeometry(L * 2 - 24, L * 2 - 24), '#8ccf6a', 0, 0.005, 0); // grass
    // Sandy slope from the shoreline down to the sea floor (a square frustum)
    const shelf = 9;
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(L * Math.SQRT2, (L + shelf) * Math.SQRT2, -SEABED_Y, 4, 1, true).rotateY(Math.PI / 4),
      new THREE.MeshLambertMaterial({ color: '#e6cf92', side: THREE.DoubleSide }),
    );
    skirt.position.y = SEABED_Y / 2;
    this.scene.add(skirt);
  }

  private buildRoads(): void {
    const { roadMin, roadMax, roadStep, roadWidth } = WORLD;
    const length = roadMax - roadMin + roadWidth;
    const roadMat = '#5d6470';
    for (let r = roadMin; r <= roadMax; r += roadStep) {
      this.flat(new THREE.PlaneGeometry(roadWidth, length), roadMat, r, 0.02, 0);
      this.flat(new THREE.PlaneGeometry(length, roadWidth), roadMat, 0, 0.021, r);
      this.features.push({ kind: 'road', x: r, z: 0, w: roadWidth, d: length });
      this.features.push({ kind: 'road', x: 0, z: r, w: length, d: roadWidth });
      // Sidewalk strips along both edges between intersections (pedestrians walk here)
      const seg = roadStep - roadWidth;
      for (let m = roadMin + roadStep / 2; m < roadMax; m += roadStep) {
        for (const s of [-1, 1]) {
          this.flatMerged(1.6, seg, '#c9ccd3', r + s * (roadWidth / 2 - 0.8), 0.025, m);
          this.flatMerged(seg, 1.6, '#c9ccd3', m, 0.026, r + s * (roadWidth / 2 - 0.8));
        }
      }
      // zebra crossings at each intersection approach are drawn below with the dashes
    }

    // Dashed centre lines, skipping the intersections. One instanced mesh for all of them.
    const dashes: THREE.Matrix4[] = [];
    const tmp = new THREE.Object3D();
    for (let r = roadMin; r <= roadMax; r += roadStep) {
      for (let t = roadMin; t < roadMax; t += 4) {
        const nearCross = Math.abs(((t - roadMin) % roadStep) - roadStep / 2) > roadStep / 2 - roadWidth;
        if (nearCross) continue;
        tmp.rotation.set(-Math.PI / 2, 0, 0);
        tmp.position.set(r, 0.03, t + 1);
        tmp.updateMatrix();
        dashes.push(tmp.matrix.clone());
        tmp.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
        tmp.position.set(t + 1, 0.03, r);
        tmp.updateMatrix();
        dashes.push(tmp.matrix.clone());
      }
    }
    const dashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 2), this.mat('#f4f1de'), dashes.length);
    dashes.forEach((m, i) => dashMesh.setMatrixAt(i, m));
    this.scene.add(dashMesh);
  }

  private buildBoundary(): void {
    // Invisible walls around both islands and the sea between them.
    const h = 300;
    const t = 2;
    const { minX, maxX, minZ, maxZ } = BOUNDS;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = maxX - minX;
    const d = maxZ - minZ;
    for (const [x, z, hx, hz] of [
      [cx, minZ - t, w / 2 + t * 2, t],
      [cx, maxZ + t, w / 2 + t * 2, t],
      [minX - t, cz, t, d / 2],
      [maxX + t, cz, t, d / 2],
    ] as const) {
      this.physics.addStaticBox(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(hx, h / 2, hz));
    }
  }

  // ───────────────────────────────────────────── Palm Isle

  private lighthouseBeam: THREE.Object3D | null = null;

  /** Spin the lighthouse beam; call once per rendered frame. */
  animate(time: number): void {
    if (this.lighthouseBeam) this.lighthouseBeam.rotation.y = time * 0.9;
  }

  /** A palm: a gently curved trunk and drooping fronds (baked into the merged scenery). */
  private palm(x: number, z: number, lean: number, height: number): void {
    const segs = 6;
    const segH = height / segs;
    let px = x;
    let pz = z;
    const dir = this.rand() * Math.PI * 2;
    for (let i = 0; i < segs; i++) {
      const off = Math.pow(i / segs, 2) * lean;
      px = x + Math.cos(dir) * off;
      pz = z + Math.sin(dir) * off;
      this.box(px, segH * (i + 0.5), pz, 0.55 - i * 0.04, segH * 1.05, 0.55 - i * 0.04, i % 2 ? '#9c6b3f' : '#b07d4f', { collide: false, merge: true });
    }
    const top = height;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + this.rand() * 0.3;
      const rot = new THREE.Euler(0.45 + this.rand() * 0.2, a, 0, 'YXZ');
      const off = new THREE.Vector3(0, 0, 1.6).applyEuler(rot);
      this.box(px + off.x, top + off.y - 0.2, pz + off.z, 0.9, 0.12, 3.4, k % 2 ? '#2d9a4e' : '#3fb35c', { collide: false, merge: true, rot });
    }
    this.physics.addStaticCylinder(new THREE.Vector3(x, height / 2, z), height / 2, 0.35);
  }

  private buildPalmIsle(): void {
    const { x, z, r } = PALM_ISLE;
    // Land: sand ring, grassy middle, and a sandy slope down to the sea floor
    const sand = new THREE.Mesh(new THREE.CircleGeometry(r, 72).rotateX(-Math.PI / 2), this.mat('#f2dca0'));
    sand.position.set(x, 0.002, z);
    sand.receiveShadow = true;
    const grass = new THREE.Mesh(new THREE.CircleGeometry(r - 18, 60).rotateX(-Math.PI / 2), this.mat('#9bd36a'));
    grass.position.set(x, 0.006, z);
    grass.receiveShadow = true;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 9, -SEABED_Y, 72, 1, true), new THREE.MeshLambertMaterial({ color: '#e6cf92', side: THREE.DoubleSide }));
    skirt.position.set(x, SEABED_Y / 2, z);
    this.scene.add(sand, grass, skirt);

    // Palms: a ring along the beach plus a few groves inland
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + this.rand() * 0.15;
      const rr = r - 12 - this.rand() * 10;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.18) continue; // keep the pier path clear (west)
      this.palm(x + Math.cos(a) * rr, z + Math.sin(a) * rr, 1.2 + this.rand() * 1.6, 7 + this.rand() * 3);
    }
    for (let i = 0; i < 14; i++) {
      const a = this.rand() * Math.PI * 2;
      const rr = 20 + this.rand() * 55;
      this.palm(x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.6 + this.rand(), 6 + this.rand() * 3);
    }

    // Lighthouse on the east point, with a spinning beam
    {
      const lx = x + r - 16;
      const lz = z + 6;
      for (let i = 0; i < 6; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - i * 0.18, 2.8 - i * 0.18, 3.2, 14), this.mat(i % 2 ? '#e63946' : '#ffffff'));
        seg.position.set(lx, 1.6 + i * 3.2, lz);
        seg.castShadow = true;
        this.scene.add(seg);
      }
      const room = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2, 12), new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
      room.position.set(lx, 20.2, lz);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.8, 12), this.mat('#2b2d42'));
      cap.position.set(lx, 22.1, lz);
      this.scene.add(room, cap);
      const beam = new THREE.Group();
      beam.position.set(lx, 20.2, lz);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(4, 40, 16, 1, true).rotateZ(-Math.PI / 2).translate(20, 0, 0),
        new THREE.MeshBasicMaterial({ color: '#fff7c2', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      beam.add(cone);
      this.scene.add(beam);
      this.lighthouseBeam = beam;
      this.physics.addStaticCylinder(new THREE.Vector3(lx, 11, lz), 11, 2.8);
    }

    // Beach huts near the pier
    const huts: [number, number, string][] = [[-60, -22, '#f4a261'], [-64, 4, '#2a9d8f'], [-56, 26, '#e76f51']];
    for (const [hx, hz, c] of huts) {
      const cx = x + hx;
      const cz = z + hz;
      this.box(cx, 1.6, cz, 6, 3.2, 5, c);
      this.box(cx + 3.05, 1.1, cz, 0.1, 2.2, 1.4, '#6d4c41', { collide: false, castShadow: false });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.2, 4).rotateY(Math.PI / 4), this.mat('#d4a373'));
      roof.position.set(cx, 4.3, cz);
      roof.castShadow = true;
      this.scene.add(roof);
      this.features.push({ kind: 'hut', x: cx, z: cz, w: 6, d: 5 });
    }

    // Pier reaching west towards the main island (top at y = 0.4, walkable over the water)
    this.pier(x - r + 6, z, x - r - 34, z);
    // …and a matching pier on the main island's east shore
    this.pier(MAIN_ISLAND.half - 8, z, MAIN_ISLAND.half + 30, z);

    // Pirate shack: a thief hideout on the north-east of the isle
    {
      const sx = x + 38;
      const sz = z - 52;
      const wood = '#7f5539';
      this.box(sx, 1.8, sz - 4, 10, 3.6, 0.3, wood);
      this.box(sx - 5, 1.8, sz, 0.3, 3.6, 8, wood);
      this.box(sx + 5, 1.8, sz, 0.3, 3.6, 8, wood);
      this.box(sx, 3.8, sz, 10.6, 0.3, 8.6, '#5c4033');
      this.box(sx + 4.6, 5.5, sz + 3.6, 0.15, 3.6, 0.15, '#3d2b1f'); // flag pole
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshLambertMaterial({ color: '#111111', side: THREE.DoubleSide }));
      flag.position.set(sx + 5.5, 6.7, sz + 3.6);
      this.scene.add(flag);
      for (const [cx, cz] of [[-3, 5], [3.5, 6], [-6, 2]]) this.box(sx + cx, 0.6, sz + cz, 1.2, 1.2, 1.2, '#d4a373');
      this.hideouts.push({
        name: 'the pirate shack on Palm Isle',
        raptorSpot: new THREE.Vector3(sx, 0, sz + 1),
        guardSpots: [new THREE.Vector3(sx - 7, 0, sz + 8), new THREE.Vector3(sx + 7, 0, sz + 8), new THREE.Vector3(sx, 0, sz + 15)],
      });
      this.features.push({ kind: 'hideout', x: sx, z: sz, w: 6, d: 6 });
    }
  }

  /** A wooden pier from (x0, z0) to (x1, z1) along x, deck at y = 0.4. */
  private pier(x0: number, z0: number, x1: number, z1: number): void {
    const len = Math.abs(x1 - x0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.box(cx, 0.15, cz, len, 0.5, 4.5, '#a47148');
    for (let px = Math.min(x0, x1) + 2; px < Math.max(x0, x1); px += 5) {
      for (const s of [-2, 2]) this.box(px, -1.2, cz + s, 0.4, 2.8, 0.4, '#6d4c41', { collide: false, merge: true });
    }
    this.features.push({ kind: 'pier', x: cx, z: cz, w: len, d: 4.5 });
  }

  // ───────────────────────────────────────────── the Professor's Lab

  private buildLab(): void {
    const { x, z } = LAB;
    const bz = z - 8; // building centre (north half of the block)
    const W = 24;
    const D = 16;
    const H = 8;
    this.box(x, H / 2, bz, W, H, D, '#eef2f5');
    this.box(x, H - 0.6, bz + D / 2 + 0.05, W + 0.2, 1.2, 0.2, '#2f80ed', { collide: false }); // blue stripe
    this.box(x, 2.6, bz + D / 2 + 0.06, 9, 5.2, 0.2, '#3b4252', { collide: false }); // garage door
    for (let i = 0; i < 5; i++) {
      this.box(x, 0.6 + i * 1.0, bz + D / 2 + 0.18, 8.6, 0.08, 0.05, '#4c566a', { collide: false, castShadow: false });
    }
    // windows
    for (const wx of [-8.5, 8.5]) {
      this.box(x + wx, 4.2, bz + D / 2 + 0.06, 4, 2.2, 0.15, '#9ad7ff', { collide: false, castShadow: false });
    }
    // observatory dome + antenna + dish
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('#c7d2dc'));
    dome.position.set(x - 5, H, bz - 1);
    dome.castShadow = true;
    this.scene.add(dome);
    this.physics.addStaticCylinder(new THREE.Vector3(x - 5, H + 1.5, bz - 1), 1.5, 3.6);
    this.box(x + 6, H + 3, bz - 3, 0.3, 6, 0.3, '#8a94a6');
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4d6d' }));
    bulb.position.set(x + 6, H + 6.2, bz - 3);
    this.scene.add(bulb);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.8, 16, 1, true), this.mat('#dfe6ee'));
    dish.material.side = THREE.DoubleSide;
    dish.position.set(x + 8.5, H + 1.4, bz + 3);
    dish.rotation.set(-0.9, 0, 0.4);
    this.scene.add(dish);
    this.features.push({ kind: 'lab', x, z: bz, w: W, d: D });

    // Parking pad: dark disc with a glowing ring, between the Lab and the road.
    const pz = z + 16;
    this.flat(new THREE.CircleGeometry(5, 32), '#2e3440', x, 0.03, pz);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.3, 4.8, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd166' }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.04, pz);
    this.scene.add(ring);
    // A chevron pointing at the Lab door
    const chev = new THREE.Mesh(
      new THREE.ShapeGeometry(
        new THREE.Shape([new THREE.Vector2(-1.2, -0.6), new THREE.Vector2(0, 0.8), new THREE.Vector2(1.2, -0.6), new THREE.Vector2(0, -0.1)]),
      ),
      new THREE.MeshBasicMaterial({ color: '#ffd166' }),
    );
    chev.rotation.x = -Math.PI / 2;
    chev.position.set(x, 0.045, pz - 2.6);
    this.scene.add(chev);
    this.features.push({ kind: 'pad', x, z: pz, w: 10, d: 10 });

    // Upgrade bench beside the garage door: table, toolbox, a monitor and a cookie jar
    const bx = x + 9;
    const bz2 = z + 2;
    this.box(bx, 0.5, bz2, 3.2, 1, 1.4, '#8d6e63');
    this.box(bx - 0.9, 1.25, bz2 - 0.2, 0.9, 0.5, 0.6, '#e63946', { collide: false });
    this.box(bx + 0.5, 1.45, bz2 - 0.4, 1.2, 0.8, 0.1, '#2b2d42', { collide: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.65), new THREE.MeshBasicMaterial({ color: '#5ef2ff' }));
    screen.position.set(bx + 0.5, 1.45, bz2 - 0.34);
    this.scene.add(screen);
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 10), new THREE.MeshLambertMaterial({ color: '#cdeffd', transparent: true, opacity: 0.6 }));
    jar.position.set(bx + 1.3, 1.23, bz2 + 0.3);
    this.scene.add(jar);

    // A driveway from the pad to the road
    this.flat(new THREE.PlaneGeometry(8, 9), '#7b8290', x, 0.015, pz + 8);
  }

  // ───────────────────────────────────────────── Grandma's house + attic

  private houseBox(lx: number, cy: number, lz: number, w: number, h: number, d: number, color: string, part: 'shell' | 'ceiling' | 'solid') {
    const material = part === 'solid' ? undefined : this.mat(color).clone();
    const { mesh, collider } = this.box(GRANDMA.x + lx, cy, GRANDMA.z + lz, w, h, d, color, { material });
    if (collider) this.houseColliders.push(collider.handle);
    if (part === 'shell') this.houseShell.push(mesh);
    if (part === 'ceiling') this.houseCeiling.push(mesh);
    return mesh;
  }

  private buildGrandmaHouse(): void {
    const { hx, hz, wall: t, groundH, atticFloor, atticH } = HOUSE;
    const wallC = '#f7c6c7';
    const trimC = '#fff3e2';
    const roofC = '#b5485d';
    const gx = GRANDMA.x;
    const gz = GRANDMA.z;

    // Ground floor slab (also stops the grass showing through)
    this.box(gx, 0.04, gz, hx * 2, 0.08, hz * 2, '#c8a27a', { collide: false, castShadow: false });

    // Ground floor walls. Door in the south (+z) wall, offset east so it clears the stairs.
    const doorX = 1.5;
    const doorW = 1.8;
    const doorH = 2.5;
    const gy = groundH / 2;
    this.houseBox(0, gy, -hz, hx * 2, groundH, t, wallC, 'shell'); // north
    this.houseBox(-hx, gy, 0, t, groundH, hz * 2, wallC, 'shell'); // west
    this.houseBox(hx, gy, 0, t, groundH, hz * 2, wallC, 'shell'); // east
    const leftW = hx + (doorX - doorW / 2);
    const rightW = hx - (doorX + doorW / 2);
    this.houseBox(-hx + leftW / 2, gy, hz, leftW, groundH, t, wallC, 'shell');
    this.houseBox(hx - rightW / 2, gy, hz, rightW, groundH, t, wallC, 'shell');
    this.houseBox(doorX, doorH + (groundH - doorH) / 2, hz, doorW, groundH - doorH, t, wallC, 'shell'); // lintel

    // Stairs along the west wall, rising northwards from the door side up to the attic floor.
    const steps = 11;
    const rise = atticFloor / steps;
    const run = 0.7;
    const stairX = -hx + t / 2 + 0.8;
    const startZ = 4.0;
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * rise;
      this.box(gx + stairX, top / 2, gz + startZ - (i + 0.5) * run, 1.6, top, run, '#a47148');
    }
    const stairEnd = startZ - steps * run;

    // Attic floor with a hole over the stairs
    const fy = atticFloor - 0.1;
    const holeX0 = -hx + t / 2;
    const holeX1 = holeX0 + 1.6;
    this.houseBox((holeX1 + hx) / 2, fy, 0, hx - holeX1, 0.2, hz * 2, '#d9b38c', 'ceiling');
    this.houseBox((holeX0 + holeX1) / 2, fy, (-hz + stairEnd) / 2, 1.6, 0.2, stairEnd + hz, '#d9b38c', 'ceiling');
    this.houseBox((holeX0 + holeX1) / 2, fy, (startZ + hz) / 2, 1.6, 0.2, hz - startZ, '#d9b38c', 'ceiling');

    // Attic walls. Big window in the east wall so the Raptor can fly in (Phase 3 cookie run).
    const ay = atticFloor + atticH / 2;
    this.houseBox(0, ay, -hz, hx * 2, atticH, t, wallC, 'shell');
    this.houseBox(0, ay, hz, hx * 2, atticH, t, wallC, 'shell');
    this.houseBox(-hx, ay, 0, t, atticH, hz * 2, wallC, 'shell');
    const winW = 5;
    const winH = 3.8;
    const sideD = hz - winW / 2;
    this.houseBox(hx, ay, -hz + sideD / 2, t, atticH, sideD, wallC, 'shell');
    this.houseBox(hx, ay, hz - sideD / 2, t, atticH, sideD, wallC, 'shell');
    const sill = 0.2;
    this.houseBox(hx, atticFloor + sill / 2, 0, t, sill, winW, wallC, 'shell');
    const headH = atticH - sill - winH;
    this.houseBox(hx, atticFloor + atticH - headH / 2, 0, t, headH, winW, wallC, 'shell');

    // Gable roof, ridge running east–west.
    const eaves = atticFloor + atticH;
    const pitch = Math.PI / 6;
    const slopeLen = (hz + 0.8) / Math.cos(pitch);
    const rise2 = (hz + 0.8) * Math.tan(pitch);
    for (const s of [1, -1]) {
      this.houseBox(0, eaves + rise2 / 2 + 0.1, (s * (hz + 0.8)) / 2, hx * 2 + 1.2, 0.3, slopeLen, roofC, 'shell').rotation.x = s * pitch;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s * pitch, 0, 0));
      this.physics.world.getCollider(this.houseColliders[this.houseColliders.length - 1]).setRotation(q);
    }
    // Gable triangles (visual)
    const tri = new THREE.Shape([new THREE.Vector2(-hz, 0), new THREE.Vector2(hz, 0), new THREE.Vector2(0, hz * Math.tan(pitch))]);
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), this.mat(wallC).clone());
      m.material.side = THREE.DoubleSide;
      m.position.set(gx + s * hx, eaves, gz);
      m.rotation.y = Math.PI / 2;
      this.scene.add(m);
      this.houseShell.push(m);
    }
    // Chimney
    this.houseBox(-3.5, eaves + 3, -2.5, 1.2, 3.5, 1.2, '#8d5a4a', 'shell');

    // Trim, windows (visual only) — they fade with the shell so they never block the inside view
    const deco = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) =>
      this.houseShell.push(this.box(gx + x, y, gz + z, w, h, d, color, { collide: false, material: this.mat(color).clone() }).mesh);
    deco(0, atticFloor, hz + 0.2, hx * 2 + 0.4, 0.25, 0.15, trimC);
    for (const wx of [-4.5, 5.2]) deco(wx, 1.7, hz + 0.17, 1.6, 1.3, 0.08, '#9ad7ff');
    deco(-3, atticFloor + 2, hz + 0.17, 1.6, 1.3, 0.08, '#9ad7ff');
    deco(3, atticFloor + 2, hz + 0.17, 1.6, 1.3, 0.08, '#9ad7ff');

    // Porch with posts and a little roof
    this.box(gx + doorX, 0.12, gz + hz + 1.6, 6, 0.24, 3, '#d9b38c', { castShadow: false });
    for (const px of [-2.6, 2.6]) this.houseBox(doorX + px, 1.5, hz + 2.9, 0.25, 3, 0.25, trimC, 'shell');
    this.houseBox(doorX, 3.05, hz + 1.6, 6.4, 0.2, 3.4, roofC, 'shell');

    // Garden path to the road, picket fence, cookie-sign mailbox
    this.flat(new THREE.PlaneGeometry(2, 16), '#e2c79f', gx + doorX, 0.02, gz + hz + 11);
    for (let fx = -24; fx <= 24; fx += 1.5) {
      if (Math.abs(fx - doorX) < 1.8) continue;
      this.box(gx + fx, 0.5, gz + 24, 0.15, 1, 0.15, '#ffffff', { castShadow: false });
    }
    this.box(gx, 0.8, gz + 24, 48, 0.12, 0.08, '#ffffff', { collide: false, castShadow: false });
    this.box(gx + doorX + 2.2, 0.6, gz + 23.3, 0.15, 1.2, 0.15, '#8d5a4a');
    this.box(gx + doorX + 2.2, 1.3, gz + 23.3, 0.6, 0.45, 0.8, '#ff8fab');

    for (const [tx, tz] of [[-14, 8], [14, 10], [-16, -10], [15, -12], [-8, 16], [10, 18]]) {
      this.treeSpots.push(new THREE.Vector3(gx + tx, 0, gz + tz));
    }
    this.features.push({ kind: 'grandma', x: gx, z: gz, w: hx * 2, d: hz * 2 });
  }

  // ───────────────────────────────────────────── town blocks

  private buildBlocks(): void {
    const { roadMin, roadMax, roadStep, roadWidth } = WORLD;
    const palette = ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#ffadad', '#e9edc9', '#f1f1f1'];
    const inner = roadStep - roadWidth;
    for (let bx = roadMin + roadStep / 2; bx < roadMax; bx += roadStep) {
      for (let bz = roadMin + roadStep / 2; bz < roadMax; bz += roadStep) {
        if ((bx === LAB.x && bz === LAB.z) || (bx === GRANDMA.x && bz === GRANDMA.z)) continue;
        if (HIDEOUT_BLOCKS.some(([hx, hz]) => hx === bx && hz === bz)) continue;

        // Sidewalk tone so blocks read clearly against the roads
        this.flatMerged(inner, inner, '#d8dcd0', bx, 0.01, bz);

        const distFromCentre = Math.hypot(bx, bz);
        const isPark = this.rand() < 0.18 || (bx === 30 && bz === -30);
        if (isPark) {
          this.flatMerged(inner - 4, inner - 4, '#76c25a', bx, 0.015, bz);
          this.features.push({ kind: 'park', x: bx, z: bz, w: inner - 4, d: inner - 4 });
          this.buildFountain(bx, bz);
          const trees = 6 + Math.floor(this.rand() * 6);
          for (let i = 0; i < trees; i++) {
            const tx = (this.rand() - 0.5) * (inner - 8);
            const tz = (this.rand() - 0.5) * (inner - 8);
            if (Math.hypot(tx, tz) < 7) continue; // keep the fountain clear
            this.treeSpots.push(new THREE.Vector3(bx + tx, 0, bz + tz));
          }
          continue;
        }

        // Town centre is denser and taller; the outskirts are low suburban houses.
        const downtown = distFromCentre < 130;
        const q = inner / 2;
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          if (this.rand() < (downtown ? 0.08 : 0.25)) {
            this.treeSpots.push(new THREE.Vector3(bx + (ox * q) / 2, 0, bz + (oz * q) / 2));
            continue;
          }
          const w = 9 + this.rand() * (q - 12);
          const d = 9 + this.rand() * (q - 12);
          const h = downtown ? 8 + this.rand() * 26 : 4 + this.rand() * 6;
          const cx = bx + (ox * q) / 2 + (this.rand() - 0.5) * 2;
          const cz = bz + (oz * q) / 2 + (this.rand() - 0.5) * 2;
          const color = palette[Math.floor(this.rand() * palette.length)];
          this.box(cx, h / 2, cz, w, h, d, color, { merge: true });
          // roof cap + a rooftop box for silhouette
          this.box(cx, h + 0.15, cz, w + 0.4, 0.3, d + 0.4, '#e5e5e5', { collide: false, castShadow: false, merge: true });
          if (this.rand() < 0.6) {
            const rw = 2 + this.rand() * 3;
            this.box(cx + (this.rand() - 0.5) * (w - rw), h + 1.2, cz + (this.rand() - 0.5) * (d - rw), rw, 2, rw, '#b0b8c4', { merge: true });
          }
          // Window rows on every floor (baked, no colliders)
          for (let fy = 2; fy < h - 1; fy += 3.2) {
            this.box(cx, fy, cz, w + 0.06, 1.1, d + 0.06, '#7fb8e0', { collide: false, castShadow: false, merge: true });
          }
          // Door on the side facing the nearest road
          const doorSide = Math.abs(cx - bx) > Math.abs(cz - bz) ? [Math.sign(cx - bx), 0] : [0, Math.sign(cz - bz)];
          this.box(cx + doorSide[0] * (w / 2 + 0.05), 1.1, cz + doorSide[1] * (d / 2 + 0.05), doorSide[0] ? 0.1 : 1.6, 2.2, doorSide[1] ? 0.1 : 1.6, '#6d4c41', { collide: false, castShadow: false, merge: true });
          this.features.push({ kind: 'building', x: cx, z: cz, w, d, h, color });
        }
      }
    }
  }

  private buildFountain(x: number, z: number): void {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.8, 16), this.mat('#d9d9d9'));
    basin.position.set(x, 0.4, z);
    basin.castShadow = basin.receiveShadow = true;
    this.scene.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.8, 16).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#4cc9f0' }));
    water.position.set(x, 0.75, z);
    this.scene.add(water);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.2, 8), this.mat('#bfc5cc'));
    spout.position.set(x, 1.1, z);
    spout.castShadow = true;
    this.scene.add(spout);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6), new THREE.MeshLambertMaterial({ color: '#9ae6ff', transparent: true, opacity: 0.75 }));
    top.position.set(x, 2.4, z);
    this.scene.add(top);
    this.physics.addStaticCylinder(new THREE.Vector3(x, 0.4, z), 0.4, 3.4);
    this.refillPoints.push(new THREE.Vector3(x, 0, z));
  }

  /** Red fire hydrants on intersection corners (every other one). */
  private buildHydrants(): void {
    const { roadMin, roadMax, roadStep, roadWidth } = WORLD;
    const geoBody = new THREE.CylinderGeometry(0.28, 0.32, 0.9, 8);
    const geoCap = new THREE.SphereGeometry(0.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let x = roadMin; x <= roadMax; x += roadStep) {
      for (let z = roadMin; z <= roadMax; z += roadStep) {
        if (((x - roadMin) / roadStep + (z - roadMin) / roadStep) % 2 !== 0) continue;
        const off = roadWidth / 2 - 0.6; // on the sidewalk corner
        const px = x + off;
        const pz = z + off;
        const body = new THREE.Mesh(geoBody, this.mat('#e63946'));
        body.position.set(px, 0.45, pz);
        body.castShadow = true;
        const cap = new THREE.Mesh(geoCap, this.mat('#ffd166'));
        cap.position.set(px, 0.9, pz);
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6).rotateZ(Math.PI / 2), this.mat('#c1121f'));
        nozzle.position.set(px, 0.55, pz);
        this.scene.add(body, cap, nozzle);
        this.physics.addStaticCylinder(new THREE.Vector3(px, 0.5, pz), 0.5, 0.35);
        this.refillPoints.push(new THREE.Vector3(px, 0, pz));
      }
    }
  }

  /** Stunt ramps on the grass just outside the ring road, for race-mode jumps. */
  private buildRamps(): void {
    const R = WORLD.roadMax;
    const ramp = (x: number, z: number, yaw: number) => {
      const len = 12;
      const pitch = 0.32;
      const rise = Math.sin(pitch) * len;
      const rot = new THREE.Euler(-pitch, yaw, 0, 'YXZ');
      this.box(x, rise / 2 - 0.2, z, 6, 0.4, len, '#f4a261', { rot });
      // chevrons on top
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        const off = new THREE.Vector3(0, 0.22, -3 + i * 3).applyEuler(rot);
        c.position.set(x + off.x, rise / 2 - 0.2 + off.y, z + off.z);
        c.rotation.copy(rot);
        c.rotateX(-Math.PI / 2);
        this.scene.add(c);
      }
      // support block under the high end
      const hi = new THREE.Vector3(0, 0, len / 2 - 0.5).applyEuler(new THREE.Euler(0, yaw, 0));
      this.box(x + hi.x, rise / 2 - 0.4, z + hi.z, 6, rise - 0.6, 1, '#6d6875');
    };
    // high end points along the clockwise driving direction (see TrafficSystem ring loop)
    ramp(R + 14, -60, 0); // east side, heading +z
    ramp(-R - 14, 60, Math.PI); // west side, heading -z
    ramp(-120, R + 14, -Math.PI / 2); // south side, heading -x (clear of the dockyard)
    ramp(-60, -R - 14, Math.PI / 2); // north side, heading +x
  }

  /** Thief hideouts: warehouse, junkyard, forest clearing, and a dockyard on the beach. */
  private buildHideouts(): void {
    const add = (name: string, x: number, z: number, guards: [number, number][]) => {
      this.hideouts.push({
        name,
        raptorSpot: new THREE.Vector3(x, 0, z),
        guardSpots: guards.map(([gx, gz]) => new THREE.Vector3(x + gx, 0, z + gz)),
      });
      this.features.push({ kind: 'hideout', x, z, w: 6, d: 6 });
    };

    // Warehouse: big shed with an open front
    {
      const [x, z] = HIDEOUT_BLOCKS[0];
      this.flatMerged(48, 48, '#a8a29e', x, 0.012, z);
      const wc = '#9c6644';
      this.box(x, 5, z - 10, 30, 10, 0.5, wc);
      this.box(x - 15, 5, z, 0.5, 10, 20, wc);
      this.box(x + 15, 5, z, 0.5, 10, 20, wc);
      this.box(x - 10, 5, z + 10, 10, 10, 0.5, wc);
      this.box(x + 10, 5, z + 10, 10, 10, 0.5, wc);
      this.box(x, 10.3, z, 31, 0.6, 21, '#6b705c');
      for (const [cx, cz] of [[-11, -7], [-9, -7], [11, 6], [12, -6], [-12, 5]]) this.box(x + cx, 0.8, z + cz, 1.6, 1.6, 1.6, '#d4a373');
      this.box(x, 9.5, z + 10.3, 6, 1.2, 0.2, '#e63946', { collide: false });
      add('the old warehouse', x, z - 2, [[-6, 4], [6, 4], [0, 14]]);
    }
    // Junkyard: car wrecks stacked behind a fence
    {
      const [x, z] = HIDEOUT_BLOCKS[1];
      this.flatMerged(48, 48, '#b5a48b', x, 0.012, z);
      const colors = ['#8d99ae', '#bc6c25', '#606c38', '#9d0208', '#495057'];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r = 14 + (i % 3) * 3;
        const stack = 1 + (i % 3);
        for (let k = 0; k < stack; k++) {
          this.box(x + Math.cos(a) * r, 0.7 + k * 1.4, z + Math.sin(a) * r, 4, 1.3, 2, colors[(i + k) % colors.length], { rot: new THREE.Euler(0, a + k * 0.4, 0) });
        }
      }
      for (let fx = -22; fx <= 22; fx += 2) {
        if (Math.abs(fx) < 4) continue;
        this.box(x + fx, 1.2, z - 23, 0.12, 2.4, 0.12, '#adb5bd', { castShadow: false });
      }
      add('the junkyard', x, z, [[-5, -6], [6, 3], [0, -14]]);
    }
    // Forest clearing: a ring of dense trees around a campfire
    {
      const [x, z] = HIDEOUT_BLOCKS[2];
      this.flatMerged(48, 48, '#5a9e47', x, 0.012, z);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        if (Math.abs(a - Math.PI * 1.5) < 0.35) continue; // a path in from the north
        this.treeSpots.push(new THREE.Vector3(x + Math.cos(a) * 16, 0, z + Math.sin(a) * 16));
        this.treeSpots.push(new THREE.Vector3(x + Math.cos(a + 0.1) * 21, 0, z + Math.sin(a + 0.1) * 21));
      }
      this.box(x + 4, 0.25, z + 4, 1.4, 0.5, 1.4, '#5c4033');
      this.box(x - 6, 1.2, z - 3, 3, 2.4, 3, '#606c38'); // tent
      add('the forest clearing', x - 1, z, [[4, 6], [-6, 5], [0, -10]]);
    }
    // Dockyard: containers on the south beach
    {
      const x = 60;
      const z = WORLD.roadMax + 24;
      const cc = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653'];
      for (let i = 0; i < 6; i++) {
        const cx = x - 18 + (i % 3) * 18;
        const cz = z + (i < 3 ? -6 : 6);
        if (i === 1) continue; // gap where the Raptor is kept
        this.box(cx, 1.4, cz, 12, 2.8, 3, cc[i % cc.length]);
        if (i % 2 === 0) this.box(cx, 4.2, cz, 12, 2.8, 3, cc[(i + 1) % cc.length]);
      }
      this.box(x + 22, 0.2, z + 9, 10, 0.4, 6, '#8d6e63', { castShadow: false }); // jetty
      add('the dockyard', x, z - 4, [[-8, 2], [8, 2], [0, 10]]);
    }
  }

  private buildTrees(): void {
    const n = this.treeSpots.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), this.mat('#8d5a3b'), n);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), this.mat('#3fa34d'), n);
    trunk.castShadow = crown.castShadow = true;
    const tmp = new THREE.Object3D();
    this.treeSpots.forEach((p, i) => {
      const s = 0.8 + this.rand() * 0.6;
      tmp.position.set(p.x, 1.2 * s, p.z);
      tmp.scale.setScalar(s);
      tmp.rotation.set(0, this.rand() * Math.PI, 0);
      tmp.updateMatrix();
      trunk.setMatrixAt(i, tmp.matrix);
      tmp.position.y = 3.4 * s;
      tmp.updateMatrix();
      crown.setMatrixAt(i, tmp.matrix);
      this.physics.addStaticCylinder(new THREE.Vector3(p.x, 1.5 * s, p.z), 1.5 * s, 0.4 * s);
    });
    this.scene.add(trunk, crown);
  }
}

function setFade(mesh: THREE.Mesh, opacity: number): void {
  const m = mesh.material as THREE.MeshLambertMaterial;
  m.transparent = opacity < 1;
  m.opacity = opacity;
  m.depthWrite = opacity >= 1;
  mesh.castShadow = opacity >= 1;
}

/** Small deterministic PRNG so the town layout is the same every load. */
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
