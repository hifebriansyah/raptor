import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import { OBSERVATORY, TUNNEL, UPTOWN, WATER_Y, floorAt, hillHeight, isLand } from './Terrain';
import type { BuildingDoor, MapFeature, SpecialDoor } from './WorldMap';
import { Models, SUBURB_FRONT, type StaticBatch } from './Models';

interface WorldHooks {
  batch: StaticBatch;
  features: MapFeature[];
  doors: BuildingDoor[];
  specialDoors: SpecialDoor[];
  refillPoints: THREE.Vector3[];
  addTree(p: THREE.Vector3): void;
  addStuds(cx: number, y: number, cz: number, w: number, d: number): void;
}

const GRASS = new THREE.Color('#8ccf6a');
const GRASS_HIGH = new THREE.Color('#6fb85a');
const ROCK = new THREE.Color('#a39e93');
const SAND = new THREE.Color('#f2dca0');
const SEABED = new THREE.Color('#e6cf92');

/**
 * A heightfield mesh of the ground over a rectangle, sampled from Terrain.floorAt (the floor
 * characters stand on), coloured by height and steepness: sand at the shore, grass, rock on cliffs.
 * `skipFlat` leaves out triangles that are flat at town level (another mesh draws those).
 */
export function buildTerrainMesh(
  scene: THREE.Scene,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  step: number,
  opts: { skipFlat?: boolean | ((x: number, z: number) => boolean); lift?: number } = {},
): THREE.Mesh {
  const nx = Math.ceil((b.maxX - b.minX) / step) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const h = (x: number, z: number) => floorAt(x, z);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = b.minX + i * step;
      const z = b.minZ + j * step;
      const y = h(x, z);
      const k = (j * nx + i) * 3;
      pos[k] = x;
      pos[k + 1] = y + (opts.lift ?? 0);
      pos[k + 2] = z;
      const slope = Math.max(Math.abs(h(x + 1, z) - h(x - 1, z)), Math.abs(h(x, z + 1) - h(x, z - 1))) / 2;
      let c: THREE.Color;
      if (!isLand(x, z)) c = SEABED;
      else if (slope > 0.9) c = ROCK;
      else if (y < 0.6 && !isLand(x + 6, z) !== !isLand(x - 6, z)) c = SAND;
      else c = GRASS.clone().lerp(GRASS_HIGH, Math.min(1, Math.max(0, y / 30))).lerp(ROCK, Math.min(1, Math.max(0, (slope - 0.5) / 0.4)));
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const bq = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (opts.skipFlat) {
        const flat = [a, bq, c, d].every((v) => Math.abs(pos[v * 3 + 1] - (opts.lift ?? 0)) < 0.02);
        const covered = typeof opts.skipFlat === 'function' ? [a, d].every((v) => (opts.skipFlat as (x: number, z: number) => boolean)(pos[v * 3], pos[v * 3 + 2])) : true;
        if (flat && covered) continue;
      }
      idx.push(a, c, bq, bq, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/**
 * Uptown, the hilly district north of the town: Observatory Hill with a spiral road to the
 * observatory, a 4-lane tunnel through the hill's west flank (the Avenue carries on north), a coast
 * road along the cliffs, terraced houses on the east hill and leafy streets.
 */
export class Uptown {
  private readonly mats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly rand = mulberry(9001);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
    private readonly world: WorldHooks,
  ) {
    // flat bits inside the town square are drawn by the town's own ground
    buildTerrainMesh(scene, { minX: UPTOWN.minX - 12, maxX: UPTOWN.maxX + 12, minZ: UPTOWN.minZ - 12, maxZ: UPTOWN.maxZ + 8 }, 3, { skipFlat: (_x, z) => z > UPTOWN.maxZ + 0.5 });
    this.buildRoads();
    this.buildTunnel();
    this.buildObservatory();
    this.buildHouses();
    this.world.features.push({ kind: 'park', x: OBSERVATORY.x, z: OBSERVATORY.z, w: 70, d: 70, color: '#76c25a' });
  }

  private mat(color: string): THREE.MeshLambertMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.mats.set(color, m);
    }
    return m;
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, collide = true, rotY = 0): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    if (collide) this.physics.addStaticBox(m.position, new THREE.Vector3(w / 2, h / 2, d / 2), rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY) : undefined);
  }

  /** A road ribbon following the ground along a path (in the tunnel it stays on the road level). */
  private road(points: THREE.Vector3[], width: number): void {
    const pos: number[] = [];
    const idx: number[] = [];
    // resample every ~2 m so the ribbon hugs the slopes
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 2));
      for (let k = 0; k < n; k++) pts.push(a.clone().lerp(b, k / n));
    }
    pts.push(points[points.length - 1].clone());
    pts.forEach((p, i) => {
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const prev = pts[Math.max(i - 1, 0)];
      const dir = next.clone().sub(prev).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
      for (const s of [-1, 1]) {
        const q = p.clone().addScaledVector(side, s);
        const y = Math.max(floorAt(q.x, q.z, 0.5), floorAt(p.x, p.z, 0.5)) + 0.07;
        pos.push(q.x, y, q.z);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#5d6470', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true;
    this.scene.add(m);
    // a dashed centre line
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f4f1de' }), Math.ceil(pts.length / 2));
    const tmp = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < pts.length - 1; i += 2) {
      const p = pts[i];
      const d = pts[i + 1].clone().sub(p);
      tmp.position.set(p.x, floorAt(p.x, p.z, 0.5) + 0.09, p.z);
      tmp.rotation.set(0, Math.atan2(d.x, d.z), 0);
      tmp.updateMatrix();
      dash.setMatrixAt(n++, tmp.matrix);
    }
    dash.count = n;
    this.scene.add(dash);
  }

  private buildRoads(): void {
    const top = UPTOWN.minZ + 18;
    // The Avenue carries on north through the cutting and the tunnel to the coast road
    this.road([new THREE.Vector3(TUNNEL.x, 0, -249), new THREE.Vector3(TUNNEL.x, 0, top)], 16);
    // East road over the shoulder of the east hill
    this.road([new THREE.Vector3(120, 0, -245), new THREE.Vector3(120, 0, top)], 10);
    // Coast road along the cliffs joining them
    this.road([new THREE.Vector3(TUNNEL.x - 4, 0, top), new THREE.Vector3(124, 0, top)], 10);
    // Hill road: up from the ring road and round Observatory Hill to the top
    const spiral: THREE.Vector3[] = [new THREE.Vector3(-60, 0, -245), new THREE.Vector3(-60, 0, -292)];
    const start = Math.atan2(-292 - OBSERVATORY.z, -60 - OBSERVATORY.x);
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = start + t * Math.PI * 1.7;
      const r = 94 - t * 70;
      spiral.push(new THREE.Vector3(OBSERVATORY.x + Math.cos(a) * r, 0, OBSERVATORY.z + Math.sin(a) * r));
    }
    this.road(spiral, 8);
    this.spiral = spiral;
    for (const f of [
      { x: TUNNEL.x, z: (-249 + top) / 2, w: 16, d: -249 - top },
      { x: 120, z: (-245 + top) / 2, w: 10, d: -245 - top },
      { x: (TUNNEL.x + 124) / 2, z: top, w: 124 - TUNNEL.x, d: 10 },
    ]) {
      this.world.features.push({ kind: 'road', ...f });
    }
  }

  private spiral: THREE.Vector3[] = [];

  /** Walls, ceiling and portals of the Avenue tunnel (and the cutting walls leading to it). */
  private buildTunnel(): void {
    const { x, halfWidth: hw, roof } = TUNNEL;
    // find where the hill is high enough for a bore (tunnel) and where it is a cutting
    let z0 = Infinity;
    let z1 = -Infinity;
    let c0 = Infinity;
    let c1 = -Infinity;
    for (let z = TUNNEL.minZ; z <= TUNNEL.maxZ; z += 1) {
      const h = Math.max(hillHeight(x - hw, z), hillHeight(x + hw, z), hillHeight(x, z));
      if (h >= roof) {
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      if (h > 0.8) {
        c0 = Math.min(c0, z);
        c1 = Math.max(c1, z);
      }
    }
    if (!isFinite(c0)) return;
    // side walls along the whole cutting + tunnel
    for (const s of [-1, 1]) {
      this.box(x + s * (hw + 0.4), 3.5, (c0 + c1) / 2, 0.8, 7, c1 - c0, '#b5a48b');
    }
    if (!isFinite(z0)) return;
    // ceiling (tunnel only) and lights
    this.box(x, 6.8, (z0 + z1) / 2, hw * 2 + 1.6, 0.6, z1 - z0, '#8d8676');
    for (let z = z0 + 6; z < z1; z += 12) {
      const lamp = part(new THREE.BoxGeometry(1.4, 0.15, 0.4), '#fff3b0', x, 6.45, z, true);
      this.scene.add(lamp);
    }
    // portals: stone frames with a name plate
    for (const pz of [z0, z1]) {
      this.box(x, 7.6, pz, hw * 2 + 3, 1.6, 1.2, '#6c757d', false);
      for (const s of [-1, 1]) this.box(x + s * (hw + 1), 3.5, pz, 1.4, 7, 1.2, '#6c757d', false);
      const plate = part(new THREE.BoxGeometry(5, 0.8, 0.1), '#ffd166', x, 7.6, pz + (pz === z1 ? 0.62 : -0.62), true);
      this.scene.add(plate);
    }
    // dark tunnel interior (inside faces) so it doesn't look hollow from the hilltop gaps
    const inner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 6.5, z1 - z0), new THREE.MeshLambertMaterial({ color: '#4a463f', side: THREE.BackSide }));
    inner.position.set(x, 3.25, (z0 + z1) / 2);
    this.scene.add(inner);
  }

  /** The domed observatory on top of the hill, with a telescope poking out. */
  private buildObservatory(): void {
    const { x, z, top } = OBSERVATORY;
    this.box(x, top + 3, z, 16, 6, 16, '#e9ecef');
    const dome = new THREE.Mesh(new THREE.SphereGeometry(8.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('#f8f9fa'));
    dome.position.set(x, top + 6, z);
    dome.castShadow = true;
    this.scene.add(dome);
    this.box(x, top + 10.5, z + 3, 1.6, 6, 1.6, '#3d405b', false, 0);
    const scope = part(new THREE.CylinderGeometry(0.6, 0.8, 7, 10), '#495057', x, top + 11, z + 5);
    scope.rotation.x = 0.8;
    this.scene.add(scope);
    this.box(x, top + 1.3, z + 8.05, 1.6, 2.6, 0.15, '#6d4c41', false);
    this.world.specialDoors.push({ id: 'observatory', pos: new THREE.Vector3(x, top, z + 8.6), facing: 0, label: 'the observatory' });
    this.world.features.push({ kind: 'building', x, z, w: 16, d: 16, h: 14, color: '#e9ecef' });
    this.world.refillPoints.push(new THREE.Vector3(x + 10, top, z + 10));
    // a fountain on the terrace (refill point up here)
    const f = part(new THREE.CylinderGeometry(1.6, 1.8, 0.7, 12), '#d9d9d9', x + 10, top + 0.35, z + 10);
    this.scene.add(f, part(new THREE.CylinderGeometry(1.3, 1.3, 0.05, 12), '#4cc9f0', x + 10, top + 0.72, z + 10, true));
  }

  /** Houses on the hill and terraces on the east hill; trees between them. */
  private buildHouses(): void {
    const palette = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff'];
    const spots: [number, number][] = [];
    // along the outside of the hill road
    for (let i = 4; i < this.spiral.length - 6; i += 4) {
      const p = this.spiral[i];
      const out = new THREE.Vector3(p.x - OBSERVATORY.x, 0, p.z - OBSERVATORY.z).normalize();
      spots.push([p.x + out.x * 14, p.z + out.z * 14]);
    }
    // terraces on the east hill and along the coast road
    for (let z = -300; z > UPTOWN.minZ + 40; z -= 18) for (const x of [100, 140]) spots.push([x, z]);
    for (let x = 30; x < 110; x += 20) spots.push([x, UPTOWN.minZ + 34]);
    for (const [x, z] of spots) {
      if (!isLand(x - 6, z - 6) || !isLand(x + 6, z + 6)) continue;
      if (Math.abs(x - TUNNEL.x) < 16 || Math.abs(x - 120) < 9) continue;
      if (Math.hypot(x - OBSERVATORY.x, z - OBSERVATORY.z) < 24) continue;
      const w = 8 + this.rand() * 3;
      const d = 7 + this.rand() * 3;
      const floors = 1 + Math.floor(this.rand() * 2);
      const h = floors * 3.6 + 0.6;
      // sit on the lowest corner, with a plinth down into the slope
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([cx, cz]) => floorAt(x + cx, z + cz));
      const base = Math.min(...corners);
      const topG = Math.max(...corners);
      const color = palette[Math.floor(this.rand() * palette.length)];
      this.box(x, base - 1 + (topG - base + 1) / 2, z, w + 0.6, topG - base + 1, d + 0.6, '#b5a48b');
      const toHill0 = Math.atan2(OBSERVATORY.x - x, OBSERVATORY.z - z);
      const facing0 = Math.round(toHill0 / (Math.PI / 2)) * (Math.PI / 2);
      const kname = `house_type${String(1 + Math.floor(this.rand() * 21)).padStart(2, '0')}`;
      if (Models.has(kname)) {
        // a Kenney suburban house (CC0) on the plinth, facing the hill road
        const size = Models.size(kname);
        const across = Math.abs(Math.sin(facing0 + SUBURB_FRONT)) > 0.5;
        const fx = across ? size.z : size.x;
        const fz = across ? size.x : size.z;
        const sc = Math.min((w + 0.6) / fx, (d + 0.6) / fz);
        const obj = Models.get(kname);
        obj.children[0].scale.setScalar(sc);
        obj.position.set(x, topG, z);
        obj.rotation.y = facing0 + SUBURB_FRONT;
        this.world.batch.add(obj);
        const H = size.y * sc;
        this.physics.addStaticBox(new THREE.Vector3(x, topG + H / 2, z), new THREE.Vector3((fx * sc) / 2, H / 2, (fz * sc) / 2));
        const fxx = Math.sin(facing0);
        const fzz = Math.cos(facing0);
        const door = new THREE.Vector3(x + fxx * ((fx * sc) / 2 + 0.3), topG, z + fzz * ((fz * sc) / 2 + 0.3));
        this.world.doors.push({ pos: door, facing: facing0, building: { x, z, w: fx * sc, d: fz * sc, h: H }, kind: 'house', color });
        this.world.features.push({ kind: 'building', x, z, w: fx * sc, d: fz * sc, h: H, color });
        if (this.rand() < 0.7) this.world.addTree(new THREE.Vector3(x + (this.rand() < 0.5 ? -1 : 1) * (w / 2 + 3), 0, z + (this.rand() - 0.5) * d));
        continue;
      }
      this.box(x, topG + h / 2, z, w, h, d, color);
      // pitched roof
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, (w / 2 + 0.6) * Math.SQRT2, 2.6, 4, 1).rotateY(Math.PI / 4), this.mat('#c0504d'));
      roof.scale.set(1, 1, (d + 1) / (w + 1));
      roof.position.set(x, topG + h + 1.3, z);
      roof.castShadow = true;
      this.scene.add(roof);
      // door towards the hilltop road (or south)
      const toHill = Math.atan2(OBSERVATORY.x - x, OBSERVATORY.z - z);
      const facing = Math.round(toHill / (Math.PI / 2)) * (Math.PI / 2);
      const fx = Math.sin(facing);
      const fz = Math.cos(facing);
      const door = new THREE.Vector3(x + fx * (Math.abs(fx) > 0.5 ? w / 2 + 0.06 : 0), topG, z + fz * (Math.abs(fz) > 0.5 ? d / 2 + 0.06 : 0));
      this.box(door.x, topG + 1.3, door.z, Math.abs(fx) > 0.5 ? 0.12 : 1.5, 2.6, Math.abs(fz) > 0.5 ? 0.12 : 1.5, '#6d4c41', false);
      for (let f = 0; f < floors; f++) this.box(x, topG + f * 3.6 + 1.9, z, w + 0.06, 1.1, d + 0.06, '#7fb8e0', false);
      this.world.doors.push({ pos: door, facing, building: { x, z, w, d, h }, kind: 'house', color });
      this.world.features.push({ kind: 'building', x, z, w, d, h, color });
      if (this.rand() < 0.7) this.world.addTree(new THREE.Vector3(x + (this.rand() < 0.5 ? -1 : 1) * (w / 2 + 3), 0, z + (this.rand() - 0.5) * d));
    }
    // a scatter of trees on the hillsides, away from roads
    for (let i = 0; i < 80; i++) {
      const x = UPTOWN.minX + 10 + this.rand() * (UPTOWN.maxX - UPTOWN.minX - 20);
      const z = UPTOWN.minZ + 10 + this.rand() * (UPTOWN.maxZ - UPTOWN.minZ - 30);
      if (Math.abs(x - TUNNEL.x) < 14 || Math.abs(x - 120) < 9 || Math.abs(z - (UPTOWN.minZ + 18)) < 9) continue;
      if (this.spiral.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
      if (Math.hypot(x - OBSERVATORY.x, z - OBSERVATORY.z) < 26) continue;
      if (floorAt(x, z) < WATER_Y + 0.5) continue;
      this.world.addTree(new THREE.Vector3(x, 0, z));
    }
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
