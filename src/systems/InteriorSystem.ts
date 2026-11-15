import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import { Humanoid, randomLook, type HumanoidLook } from '../entities/Humanoid';
import { INTERIOR_Y } from '../game/Terrain';
import type { PhysicsSystem } from './PhysicsSystem';

export type InteriorKind = 'grandma' | 'house' | 'shop' | 'cafe' | 'office' | 'tower' | 'lab' | 'police' | 'lighthouse' | 'observatory' | 'shack' | 'station' | 'moonbase';

export interface InteriorDef {
  kind: InteriorKind;
  title: string;
  /** Seeds the layout and colours (same building → same interior). */
  seed: number;
  /** Feet position just outside the door, and the way to face when coming out. */
  exitTo: THREE.Vector3;
  exitFacing: number;
  /** Rooftop (feet position) reached by the lift / stairs, if any. */
  roof?: THREE.Vector3;
  /** Named townsfolk inside right now. */
  people?: { id: string; name: string }[];
  /** Wall colour from the building outside. */
  color?: string;
}

/** Something to do inside (the engine turns these into E prompts). */
export interface InteriorAction {
  pos: THREE.Vector3;
  radius: number;
  prompt: string;
  /** 'exit' and 'roof' are handled by the engine; others call back by id. */
  id: string;
  /** Walk-in trigger (teleport portals) instead of pressing E. */
  auto?: boolean;
}

interface Current {
  def: InteriorDef;
  group: THREE.Group;
  bodies: RAPIER.RigidBody[];
  actions: InteriorAction[];
  people: { body: Humanoid; id: string; name: string; pos: THREE.Vector3 }[];
  spawn: THREE.Vector3;
  spawnFacing: number;
  /** Big enough for the Raptor to come in too (the Lab hangar). */
  roomy: boolean;
  animated: { obj: THREE.Object3D; spin?: number; bob?: number }[];
}

/** Interior space origin (all rooms are built around here, under the town). */
const O = new THREE.Vector3(0, INTERIOR_Y, 0);

/** Grandma's house: three floors (ground, bedrooms, attic). Heights of each floor's surface. */
const G_FLOORS = [0, 3.8, 7.6];
const G_W = 16;
const G_D = 13;
/** Where the Raptor curls up in the attic during a cookie run (feet, world space). */
export const GRANDMA_ATTIC_SPOT = new THREE.Vector3(2, INTERIOR_Y + G_FLOORS[2], -2.5);

const WALL_COLORS = ['#fff1e6', '#e2ece9', '#fde2e4', '#dfe7fd', '#fff8d6', '#e9f5db'];
const FLOOR_COLORS = ['#c9a27e', '#b08968', '#d6ccc2', '#a3b18a', '#bfc0c0'];

/**
 * Every building can be entered: an iris wipe, then a room built on the fly under the town (the
 * floor down there is INTERIOR_Y, see Terrain.floorAt) and torn down again on leaving.
 * Handcrafted rooms for the landmarks; seeded rooms (house, shop, café, office, tower) for the rest.
 */
export class InteriorSystem {
  current: Current | null = null;
  private readonly mats = new Map<string, THREE.Material>();
  private rand: () => number = Math.random;
  /** Extra decoration hooks (gold bricks…), run after a room is built. */
  readonly decorators: ((def: InteriorDef, add: (obj: THREE.Object3D) => void, actions: InteriorAction[], at: (x: number, y: number, z: number) => THREE.Vector3) => void)[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsSystem,
  ) {}

  get inside(): boolean {
    return this.current !== null;
  }

  get roomy(): boolean {
    return this.current?.roomy ?? false;
  }

  /** Build the room; returns the spawn point (feet) and facing. */
  enter(def: InteriorDef, jailed = 0): { spawn: THREE.Vector3; facing: number } {
    this.leave();
    this.rand = mulberry(def.seed);
    const group = new THREE.Group();
    group.position.copy(O);
    this.scene.add(group);
    const cur: Current = { def, group, bodies: [], actions: [], people: [], spawn: O.clone(), spawnFacing: Math.PI, roomy: false, animated: [] };
    this.current = cur;
    switch (def.kind) {
      case 'grandma':
        this.buildGrandma(cur);
        break;
      case 'lab':
        this.buildLab(cur);
        break;
      case 'police':
        this.buildPolice(cur, jailed);
        break;
      case 'lighthouse':
        this.buildLighthouse(cur);
        break;
      case 'observatory':
        this.buildObservatory(cur);
        break;
      case 'shack':
        this.buildShack(cur);
        break;
      case 'station':
        this.buildStation(cur);
        break;
      case 'moonbase':
        this.buildMoonBase(cur);
        break;
      case 'office':
      case 'tower':
        this.buildOffice(cur, def.kind === 'tower');
        break;
      case 'shop':
      case 'cafe':
        this.buildShop(cur, def.kind === 'cafe');
        break;
      default:
        this.buildHouse(cur);
    }
    // named townsfolk who are in here right now
    (def.people ?? []).forEach((p, i) => this.person(cur, new THREE.Vector3(-2 + i * 2, 0, -1), Math.PI, p.id, p.name, randomLook(mulberry(p.name.length * 31))));
    for (const d of this.decorators) d(def, (o) => group.add(o), cur.actions, (x, y, z) => new THREE.Vector3(x, y, z).add(O));
    return { spawn: cur.spawn.clone(), facing: cur.spawnFacing };
  }

  leave(): void {
    const c = this.current;
    if (!c) return;
    this.scene.remove(c.group);
    c.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    for (const b of c.bodies) this.physics.world.removeRigidBody(b);
    this.current = null;
  }

  /** The closest action within reach (walk-in ones fire on their own). */
  actionNear(feet: THREE.Vector3): InteriorAction | null {
    if (!this.current) return null;
    let best: InteriorAction | null = null;
    let bestD = Infinity;
    for (const a of this.current.actions) {
      const d = Math.hypot(a.pos.x - feet.x, a.pos.z - feet.z);
      if (d < a.radius && Math.abs(a.pos.y - feet.y) < 3 && d < bestD) {
        best = a;
        bestD = d;
      }
    }
    return best;
  }

  /** People to chat with (named townsfolk and generic residents). */
  personNear(feet: THREE.Vector3): { id: string; name: string } | null {
    if (!this.current) return null;
    for (const p of this.current.people) if (Math.hypot(p.pos.x - feet.x, p.pos.z - feet.z) < 2.4) return p;
    return null;
  }

  update(dt: number, time: number, professor: THREE.Vector3): void {
    const c = this.current;
    if (!c) return;
    for (const p of c.people) {
      const want = Math.atan2(professor.x - p.pos.x, professor.z - p.pos.z);
      const near = Math.hypot(professor.x - p.pos.x, professor.z - p.pos.z) < 5;
      if (near) p.body.root.rotation.y += (Math.atan2(Math.sin(want - p.body.root.rotation.y), Math.cos(want - p.body.root.rotation.y))) * Math.min(1, dt * 4);
      if (near) p.body.wave(dt);
      else p.body.walk(dt, 0);
    }
    for (const a of c.animated) {
      if (a.spin) a.obj.rotation.y += a.spin * dt;
      if (a.bob) a.obj.position.y = (a.obj.userData.baseY ??= a.obj.position.y) + Math.sin(time * a.bob) * 0.15;
    }
  }

  // ───────────────────────────────────────────── building blocks

  private mat(color: string, opts: { emissive?: boolean; transparent?: number } = {}): THREE.Material {
    const key = `${color}|${opts.emissive ? 1 : 0}|${opts.transparent ?? 1}`;
    let m = this.mats.get(key);
    if (!m) {
      m = opts.emissive
        ? new THREE.MeshBasicMaterial({ color, transparent: (opts.transparent ?? 1) < 1, opacity: opts.transparent ?? 1, depthWrite: (opts.transparent ?? 1) >= 1 })
        : new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: (opts.transparent ?? 1) < 1, opacity: opts.transparent ?? 1 });
      this.mats.set(key, m);
    }
    return m;
  }

  /** A box in room coordinates (y = 0 is the floor). Solid unless `solid` is false. */
  private box(c: Current, x: number, y: number, z: number, w: number, h: number, d: number, color: string, solid = true, opts: { emissive?: boolean; transparent?: number; rotY?: number } = {}): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color, opts));
    m.position.set(x, y, z);
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.receiveShadow = true;
    c.group.add(m);
    if (solid) {
      const q = opts.rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY) : new THREE.Quaternion();
      const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(O.x + x, O.y + y, O.z + z).setRotation(q));
      this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
      c.bodies.push(body);
    }
    return m;
  }

  private at(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).add(O);
  }

  /**
   * A rectangular room w × d × h with the entrance in the middle of the +z wall: floor, walls,
   * ceiling (doesn't cast shadows, so the sun still lights the room), lamps and the exit.
   */
  private room(c: Current, w: number, d: number, h: number, wall: string, floor: string): void {
    this.box(c, 0, -0.25, 0, w, 0.5, d, floor, false);
    const t = 0.4;
    this.box(c, 0, h / 2, -d / 2 - t / 2, w + 2 * t, h, t, wall);
    this.box(c, -w / 2 - t / 2, h / 2, 0, t, h, d, wall);
    this.box(c, w / 2 + t / 2, h / 2, 0, t, h, d, wall);
    // front wall with a door
    const side = (w - 1.8) / 2;
    this.box(c, -w / 2 + side / 2, h / 2, d / 2 + t / 2, side, h, t, wall);
    this.box(c, w / 2 - side / 2, h / 2, d / 2 + t / 2, side, h, t, wall);
    this.box(c, 0, (h + 2.6) / 2, d / 2 + t / 2, 1.8, h - 2.6, t, wall);
    this.box(c, 0, 1.3, d / 2 + t * 0.6, 1.5, 2.6, 0.12, '#6d4c41', false); // the door (closed behind you)
    this.box(c, 0, h + 0.2, 0, w + 2 * t, 0.4, d + 2 * t, wall);
    // ceiling lamps
    for (let x = -w / 2 + 3; x < w / 2; x += 6) {
      for (let z = -d / 2 + 3; z < d / 2; z += 6) this.box(c, x, h - 0.08, z, 1.6, 0.12, 0.6, '#fff8e1', false, { emissive: true });
    }
    // a warm light so it isn't gloomy
    const lamp = new THREE.PointLight('#fff4e0', 1.4, Math.max(w, d) * 1.6, 1.2);
    lamp.position.set(0, h - 0.8, 0);
    c.group.add(lamp);
    c.spawn = this.at(0, 0, d / 2 - 3.6);
    c.spawnFacing = Math.PI;
    c.actions.push({ pos: this.at(0, 0, d / 2 - 0.6), radius: 1.5, prompt: 'Leave', id: 'exit' });
  }

  private person(c: Current, local: THREE.Vector3, facing: number, id: string, name: string, look: HumanoidLook): void {
    const h = new Humanoid({ ...look });
    h.root.position.copy(local);
    h.root.rotation.y = facing;
    c.group.add(h.root);
    c.people.push({ body: h, id, name, pos: this.at(local.x, local.y, local.z) });
  }

  private sofa(c: Current, x: number, z: number, rotY: number, color: string): void {
    const g = new THREE.Group();
    g.add(part(new THREE.BoxGeometry(2.2, 0.45, 0.9), color, 0, 0.35, 0));
    g.add(part(new THREE.BoxGeometry(2.2, 0.6, 0.25), color, 0, 0.8, -0.35));
    for (const sx of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.25, 0.65, 0.9), color, sx * 1.1, 0.5, 0));
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    c.group.add(g);
    this.box(c, x, 0.5, z, 2.4, 1, 1, color, true, { rotY }).visible = false;
  }

  private table(c: Current, x: number, z: number, w = 1.4, d = 0.9, color = '#a47148'): void {
    this.box(c, x, 0.75, z, w, 0.08, d, color);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(c, x + (sx * (w - 0.15)) / 2, 0.37, z + (sz * (d - 0.15)) / 2, 0.08, 0.74, 0.08, color, false);
  }

  private chair(c: Current, x: number, z: number, rotY: number, color = '#6d597a'): void {
    const g = new THREE.Group();
    g.add(part(new THREE.BoxGeometry(0.45, 0.06, 0.45), color, 0, 0.45, 0));
    g.add(part(new THREE.BoxGeometry(0.45, 0.5, 0.06), color, 0, 0.72, -0.2));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(part(new THREE.BoxGeometry(0.05, 0.45, 0.05), color, sx * 0.19, 0.22, sz * 0.19));
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    c.group.add(g);
  }

  private plant(c: Current, x: number, z: number): void {
    this.box(c, x, 0.3, z, 0.5, 0.6, 0.5, '#bc6c25');
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), this.mat('#3fa34d'));
    leaf.position.set(x, 1.0, z);
    c.group.add(leaf);
  }

  /** A lift (or stairs) to the roof, against the back wall. */
  private lift(c: Current, x: number, z: number, label: string): void {
    this.box(c, x, 1.5, z - 0.3, 2.4, 3, 0.2, '#adb5bd', false);
    this.box(c, x - 0.55, 1.3, z - 0.18, 1, 2.5, 0.06, '#dee2e6', false);
    this.box(c, x + 0.55, 1.3, z - 0.18, 1, 2.5, 0.06, '#dee2e6', false);
    this.box(c, x + 1.5, 1.4, z - 0.15, 0.2, 0.3, 0.06, '#ffd166', false, { emissive: true });
    c.actions.push({ pos: this.at(x, 0, z + 0.8), radius: 1.8, prompt: label, id: 'roof' });
  }

  // ───────────────────────────────────────────── seeded rooms

  private buildHouse(c: Current): void {
    const r = this.rand;
    const wall = WALL_COLORS[Math.floor(r() * WALL_COLORS.length)];
    const floor = FLOOR_COLORS[Math.floor(r() * FLOOR_COLORS.length)];
    const w = 12 + Math.floor(r() * 3) * 2;
    const d = 10 + Math.floor(r() * 2) * 2;
    this.room(c, w, d, 3.6, wall, floor);
    // rug, sofa, TV, kitchen corner, bed behind a divider
    this.box(c, -w / 4, 0.02, 0, 3.4, 0.03, 2.4, ['#e76f51', '#457b9d', '#2a9d8f', '#e9c46a'][Math.floor(r() * 4)], false);
    this.sofa(c, -w / 4, 1.4, Math.PI, ['#457b9d', '#9d4edd', '#2a9d8f', '#e76f51'][Math.floor(r() * 4)]);
    this.box(c, -w / 4, 0.4, -1.6, 2, 0.8, 0.5, '#3d405b');
    this.box(c, -w / 4, 1.3, -1.7, 1.8, 1, 0.08, '#111111', false);
    this.box(c, -w / 4, 1.3, -1.65, 1.6, 0.85, 0.02, '#5ef2ff', false, { emissive: true });
    this.box(c, w / 2 - 1, 0.45, -d / 2 + 2.5, 1.4, 0.9, 4.5, '#dee2e6'); // kitchen counter
    this.box(c, w / 2 - 1, 0.95, -d / 2 + 1, 1.2, 0.1, 0.6, '#adb5bd', false);
    this.table(c, w / 4 - 0.5, 1.2);
    this.chair(c, w / 4 - 1.3, 1.2, Math.PI / 2);
    this.chair(c, w / 4 + 0.3, 1.2, -Math.PI / 2);
    this.box(c, 0.4, 1.4, -d / 2 + 2, 0.15, 2.8, 4, wall); // divider
    this.box(c, -w / 2 + 1.5, 0.35, -d / 2 + 1.5, 2, 0.7, 2.6, '#ffffff'); // bed
    this.box(c, -w / 2 + 1.5, 0.75, -d / 2 + 0.5, 1.8, 0.2, 0.5, '#ffafcc', false);
    this.plant(c, w / 2 - 0.6, d / 2 - 0.8);
    c.actions.push({ pos: this.at(-w / 2 + 1.5, 0, -d / 2 + 3.2), radius: 1.6, prompt: 'Take a nap', id: 'nap' });
    if (r() < 0.6) this.person(c, new THREE.Vector3(w / 4, 0, -d / 4), Math.PI, 'resident', 'Resident', randomLook(r));
  }

  private buildShop(c: Current, cafe: boolean): void {
    const r = this.rand;
    const w = 16;
    const d = 12;
    this.room(c, w, d, 4, cafe ? '#fff1d6' : WALL_COLORS[Math.floor(r() * WALL_COLORS.length)], cafe ? '#b08968' : '#d6ccc2');
    // counter at the back, clerk behind it
    this.box(c, 0, 0.55, -d / 2 + 2.2, 6, 1.1, 1, cafe ? '#6d4c41' : '#457b9d');
    this.box(c, 0, 1.12, -d / 2 + 2.2, 6.2, 0.06, 1.1, '#f8f9fa', false);
    this.person(c, new THREE.Vector3(0, 0, -d / 2 + 1.2), 0, cafe ? 'barista' : 'clerk', cafe ? 'Barista' : 'Shopkeeper', randomLook(r));
    if (cafe) {
      for (const [x, z] of [[-5, 1], [-5, 3.6], [4.5, 1.5], [4.5, 4]]) {
        this.table(c, x, z, 1, 1, '#ffffff');
        this.chair(c, x - 0.9, z, Math.PI / 2, '#e76f51');
        this.chair(c, x + 0.9, z, -Math.PI / 2, '#e76f51');
      }
      for (let i = 0; i < 5; i++) this.box(c, -2 + i, 1.3, -d / 2 + 2.1, 0.5, 0.3, 0.5, ['#c98b4a', '#f4a261', '#ffafcc'][i % 3], false); // cakes
      c.actions.push({ pos: this.at(0, 0, -d / 2 + 3.2), radius: 1.8, prompt: 'Buy 3 cookies (10 Lab Points)', id: 'buyCookies' });
    } else {
      // shelves with goods
      for (const x of [-5, 5]) {
        for (let z = -2; z <= 3; z += 2.5) {
          this.box(c, x, 1.0, z, 1, 2, 2, '#adb5bd');
          for (let k = 0; k < 3; k++) this.box(c, x, 0.5 + k * 0.6, z, 1.05, 0.3, 1.8, ['#e63946', '#ffd166', '#06d6a0', '#118ab2'][(k + Math.floor(z)) & 3], false);
        }
      }
      c.actions.push({ pos: this.at(0, 0, -d / 2 + 3.2), radius: 1.8, prompt: 'Buy a cookie (5 Lab Points)', id: 'buyCookie' });
    }
    this.plant(c, -w / 2 + 0.7, d / 2 - 0.8);
    this.plant(c, w / 2 - 0.7, d / 2 - 0.8);
  }

  private buildOffice(c: Current, tower: boolean): void {
    const r = this.rand;
    const w = tower ? 16 : 18;
    const d = 14;
    this.room(c, w, d, 3.8, tower ? '#e9ecef' : '#dfe7fd', '#bfc0c0');
    if (tower) {
      // lobby: reception desk, sofas, a big plant
      this.box(c, 0, 0.55, -1, 5, 1.1, 1.2, '#3d405b');
      this.person(c, new THREE.Vector3(0, 0, -2), 0, 'receptionist', 'Receptionist', randomLook(r));
      this.sofa(c, -5, 3, 0, '#adb5bd');
      this.sofa(c, 5, 3, 0, '#adb5bd');
      this.plant(c, -6.5, -5.5);
      this.plant(c, 6.5, -5.5);
    } else {
      for (let i = 0; i < 6; i++) {
        const x = -5 + (i % 3) * 5;
        const z = -3 + Math.floor(i / 3) * 4;
        this.box(c, x, 0.75, z, 2.2, 0.08, 1.1, '#f8f9fa');
        this.box(c, x, 1.15, z - 0.35, 0.8, 0.55, 0.06, '#222222', false);
        this.box(c, x, 1.15, z - 0.32, 0.7, 0.45, 0.02, '#5ef2ff', false, { emissive: true });
        this.chair(c, x, z + 0.8, Math.PI, '#3d405b');
        if (r() < 0.5) this.person(c, new THREE.Vector3(x, 0, z + 1.3), Math.PI, 'worker', 'Office worker', randomLook(r));
      }
      this.box(c, w / 2 - 0.8, 0.6, d / 2 - 2, 0.6, 1.2, 0.6, '#4cc9f0'); // water cooler
    }
    this.lift(c, -w / 2 + 2, -d / 2 + 0.4, tower ? 'Take the lift to the roof' : 'Take the stairs to the roof');
  }

  // ───────────────────────────────────────────── landmarks

  /**
   * Grandma's house, three floors: kitchen and sitting room on the ground floor, bedrooms on the
   * 1st floor, and the dusty cookie attic on the top (3rd) floor. Stairs go up the west wall, then
   * back along the east wall.
   */
  private buildGrandma(c: Current): void {
    const w = G_W;
    const d = G_D;
    const H = G_FLOORS[2] + 5.4; // the attic is tall enough for the Raptor
    const wall = '#fde2e4';
    this.room(c, w, d, H, wall, '#c9a27e');
    // not "roomy": the Raptor can't follow you in (it only turns up in the attic on a cookie run)
    const stairW = 1.8;
    const steps = 11;
    const run = 0.65;
    const flight = (x: number, fromZ: number, dir: number, y0: number, y1: number) => {
      const rise = (y1 - y0) / steps;
      for (let i = 0; i < steps; i++) {
        const top = y0 + (i + 1) * rise;
        this.box(c, x, y0 + (top - y0) / 2, fromZ + dir * (i + 0.5) * run, stairW, top - y0, run, '#a47148');
      }
      return fromZ + dir * steps * run;
    };
    // flight 1: west wall, ground → 1st floor, going north (−z); flight 2: east wall, 1st → attic, going south
    const sx1 = -w / 2 + stairW / 2;
    const top1 = flight(sx1, 3.2, -1, G_FLOORS[0], G_FLOORS[1]);
    const sx2 = w / 2 - stairW / 2;
    const top2 = flight(sx2, top1, 1, G_FLOORS[1], G_FLOORS[2]);
    // floor slabs with stairwell holes (solid: you stand on them)
    const slab = (y: number, holeX: number, z0: number, z1: number, color: string) => {
      const t = 0.25;
      const hx0 = holeX - stairW / 2;
      const hx1 = holeX + stairW / 2;
      // the part beside the hole
      const left = hx0 + w / 2;
      const right = w / 2 - hx1;
      if (left > 0.01) this.box(c, -w / 2 + left / 2, y - t / 2, 0, left, t, d, color);
      if (right > 0.01) this.box(c, w / 2 - right / 2, y - t / 2, 0, right, t, d, color);
      // in front of / behind the hole
      const front = d / 2 - z1;
      const back = z0 + d / 2;
      if (front > 0.01) this.box(c, holeX, y - t / 2, z1 + front / 2, stairW, t, front, color);
      if (back > 0.01) this.box(c, holeX, y - t / 2, -d / 2 + back / 2, stairW, t, back, color);
    };
    slab(G_FLOORS[1], sx1, top1, 3.2, '#d9b38c');
    slab(G_FLOORS[2], sx2, top1, top2, '#c8a27a');
    // banisters along the stairwells
    for (const [x, y, z0, z1] of [[sx1 + stairW / 2 + 0.05, G_FLOORS[1], top1, 3.2], [sx2 - stairW / 2 - 0.05, G_FLOORS[2], top1, top2]]) {
      this.box(c, x, y + 0.5, (z0 + z1) / 2, 0.08, 1, Math.abs(z1 - z0), '#6d4c41');
    }
    // ground floor: kitchen with an oven and the famous cookie jar, sitting room with a rug and armchair
    this.box(c, 3, 0.45, -d / 2 + 0.8, 6, 0.9, 1.2, '#dee2e6');
    this.box(c, 1.2, 0.5, -d / 2 + 0.8, 1, 1, 1.25, '#495057'); // oven
    this.box(c, 1.2, 0.55, -d / 2 + 1.44, 0.7, 0.4, 0.04, '#ff9f1c', false, { emissive: true });
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12), this.mat('#cdeffd', { transparent: 0.6 }));
    jar.position.set(4.5, 1.15, -d / 2 + 0.8);
    c.group.add(jar);
    this.table(c, 3, -2, 1.6, 1);
    this.chair(c, 2.1, -2, Math.PI / 2, '#b8a1e3');
    this.chair(c, 3.9, -2, -Math.PI / 2, '#b8a1e3');
    this.box(c, 2.5, 0.02, 2.5, 3.6, 0.03, 2.6, '#ff8fab', false); // rug
    this.sofa(c, 2.5, 4.4, Math.PI, '#b5838d');
    this.plant(c, w / 2 - 2.6, d / 2 - 0.8);
    c.actions.push({ pos: this.at(4.5, 0, -d / 2 + 2), radius: 1.6, prompt: 'Peek in the cookie jar', id: 'grandmaJar' });
    // 1st floor: two bedrooms (beds, a wardrobe, the boys' bunk bed)
    const y1 = G_FLOORS[1];
    this.box(c, -2, y1 + 0.35, -d / 2 + 1.6, 2.2, 0.7, 3, '#ffffff');
    this.box(c, -2, y1 + 0.75, -d / 2 + 0.5, 2, 0.25, 0.5, '#ffafcc', false);
    this.box(c, 2.5, y1 + 1.1, -d / 2 + 0.4, 2, 2.2, 0.7, '#8d6e63'); // wardrobe
    this.box(c, -1, y1 + 0.35, 3.5, 1.2, 0.7, 2.4, '#4cc9f0'); // bunk (bottom)
    this.box(c, -1, y1 + 1.6, 3.5, 1.2, 0.2, 2.4, '#06d6a0', false); // bunk (top)
    for (const [x, z] of [[-1.55, 2.35], [-0.45, 2.35], [-1.55, 4.65], [-0.45, 4.65]]) this.box(c, x, y1 + 0.85, z, 0.1, 1.7, 0.1, '#a47148', false);
    this.box(c, 3, y1 + 1.4, d / 2 - 0.2, 2, 1.2, 0.05, '#9ad7ff', false); // window
    // attic: boxes, an old trunk, dusty rafters, cookie crumbs everywhere, a round window
    const y2 = G_FLOORS[2];
    for (const [x, z, s2] of [[-5, -4.5, 1.2], [-3.8, -4.8, 0.9], [-5.2, -3.1, 0.8], [5.5, -5, 1], [-5, 4.5, 1.1]]) this.box(c, x, y2 + s2 / 2, z, s2, s2, s2, '#d4a373');
    this.box(c, -2, y2 + 0.4, 4.6, 1.8, 0.8, 1, '#6d4c41'); // trunk
    for (let x = -6; x <= 6; x += 3) this.box(c, x, H - 0.3, 0, 0.3, 0.3, d, '#8d6e63', false); // rafters
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), this.mat('#fff3b0', { emissive: true }));
    win.position.set(0, y2 + 3, -d / 2 + 0.05);
    c.group.add(win);
    for (let i = 0; i < 30; i++) this.box(c, (this.rand() - 0.5) * 8, y2 + 0.02, (this.rand() - 0.5) * 8, 0.12, 0.03, 0.12, '#c98b4a', false);
    const attic = new THREE.PointLight('#ffe8b0', 1.1, 18, 1.3);
    attic.position.set(0, y2 + 3.5, 0);
    c.group.add(attic);
    const bedroom = new THREE.PointLight('#fff4e0', 0.9, 16, 1.3);
    bedroom.position.set(0, y1 + 2.8, 0);
    c.group.add(bedroom);
    // floor-numbers on the stair walls
    for (const [x, y, z] of [[-w / 2 + 0.25, G_FLOORS[1] + 2, top1 - 0.5], [w / 2 - 0.25, G_FLOORS[2] + 2, top2 + 0.5]]) {
      this.box(c, x, y, z, 0.05, 0.6, 0.6, '#ffd166', false, { emissive: true });
    }
  }

  /** The Lab: a hangar (big enough for the Raptor) with a workbench, and the Teleport Hub wing. */
  private buildLab(c: Current): void {
    c.roomy = true;
    const w = 36;
    const d = 28;
    this.room(c, w, d, 11, '#eef2f5', '#8d99ae');
    // hazard stripes on the floor where the Raptor parks
    this.box(c, -8, 0.02, 2, 10, 0.03, 10, '#2e3440', false);
    this.box(c, -8, 0.03, 2, 9, 0.03, 0.4, '#ffd166', false);
    // workbench (opens the upgrade bench), tool walls, a chalkboard of doodles
    this.box(c, 8, 0.5, -d / 2 + 2, 6, 1, 1.6, '#8d6e63');
    this.box(c, 8, 2.6, -d / 2 + 0.3, 8, 3, 0.1, '#3d405b', false);
    this.box(c, -8, 4, -d / 2 + 0.3, 10, 4, 0.1, '#2b3a33', false);
    for (let i = 0; i < 6; i++) this.box(c, -11.5 + i * 1.4, 4 + Math.sin(i) * 0.8, -d / 2 + 0.36, 0.9, 0.06, 0.02, '#ffffff', false, { emissive: true });
    c.actions.push({ pos: this.at(8, 0, -d / 2 + 3.4), radius: 2, prompt: 'Open the upgrade bench', id: 'bench' });
    // the 100 % progress & Extras wall
    this.box(c, w / 2 - 0.3, 3, 4, 0.1, 4, 8, '#1b2a49', false);
    for (let i = 0; i < 12; i++) this.box(c, w / 2 - 0.36, 1.6 + Math.floor(i / 4) * 1.2, 1.2 + (i % 4) * 1.8, 0.04, 0.8, 1.2, '#ffd166', false, { emissive: true, transparent: 0.35 });
    c.actions.push({ pos: this.at(w / 2 - 2, 0, 4), radius: 2.4, prompt: 'Look at the progress & Extras wall', id: 'progress' });
    // Teleport Hub: an archway in the back wall, portals in a semicircle
    this.box(c, 0, 6, -d / 2 + 0.2, 10, 1, 0.4, '#7b2cbf', false);
    const portals = ['Town', 'Downtown', 'Uptown', 'Harbour', 'Park', 'Palm Isle', 'Cloud Isle', 'Moon Base'];
    portals.forEach((name, i) => {
      const a = Math.PI * (0.15 + (0.7 * i) / (portals.length - 1));
      const x = Math.cos(a) * -11;
      const z = -4 - Math.sin(a) * 6;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.15, 8, 24), this.mat('#c77dff', { emissive: true }));
      ring.position.set(x, 1.5, z);
      ring.rotation.y = Math.atan2(-x, -z - 4);
      c.group.add(ring);
      const film = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), this.mat('#e0aaff', { emissive: true, transparent: 0.45 }));
      film.position.copy(ring.position);
      film.rotation.copy(ring.rotation);
      c.group.add(film);
      c.animated.push({ obj: film, spin: 0 }, { obj: ring, bob: 1.5 + i * 0.1 });
      this.box(c, x, 0.05, z, 2.4, 0.1, 2.4, '#3c096c', false);
      c.actions.push({ pos: this.at(x, 0, z), radius: 1.3, prompt: `Teleport: ${name}`, id: `portal:${i}`, auto: false });
    });
  }

  private buildPolice(c: Current, jailed: number): void {
    const w = 24;
    const d = 18;
    this.room(c, w, d, 4.2, '#dbe4ff', '#adb5bd');
    this.box(c, 0, 0.6, 2, 6, 1.2, 1.2, '#1d3557');
    this.box(c, 0, 2.6, d / 2 - 0.3, 3.4, 0.6, 0.1, '#1d3557', false);
    this.person(c, new THREE.Vector3(0, 0, 0.8), 0, 'bruno', 'Chief Bruno', { skin: '#a86b3c', shirt: '#1d3557', pants: '#1d3557', hair: '#111111', hairStyle: 'cap', hat: '#1d3557', scale: 1.08 });
    // three holding cells along the back wall, with bars
    for (let k = 0; k < 3; k++) {
      const cx = -8 + k * 8;
      const cz = -d / 2 + 3;
      for (let b = -3; b <= 3; b++) this.box(c, cx + b * 0.5, 1.6, cz + 3, 0.08, 3.2, 0.08, '#6c757d', b === 0 ? false : true);
      this.box(c, cx, 3.25, cz + 3, 3.6, 0.1, 0.1, '#6c757d', false);
      this.box(c, cx - 3.6, 1.6, cz, 0.2, 3.2, 6, '#adb5bd');
      this.box(c, cx, 0.35, cz - 2, 2.5, 0.25, 1, '#8d6e63', false); // bench
      // thugs you zapped here (up to 3 per cell)
      for (let t = 0; t < 3; t++) {
        const idx = k * 3 + t;
        if (idx >= jailed) break;
        this.person(c, new THREE.Vector3(cx - 1 + t, 0, cz - 0.5), 0, 'thug', 'Jailed thug', { skin: '#e0ac7e', shirt: '#f77f00', pants: '#f77f00', hair: '#111111', hairStyle: 'short' });
      }
    }
    c.actions.push({ pos: this.at(0, 0, 3.6), radius: 1.8, prompt: 'Ask the Chief about the cells', id: 'cells' });
  }

  private buildLighthouse(c: Current): void {
    const r = 6;
    this.box(c, 0, -0.25, 0, r * 2, 0.5, r * 2, '#d6ccc2', false);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (Math.abs(Math.sin(a)) < 0.2 && Math.cos(a) > 0) continue; // doorway (+z)
      this.box(c, Math.sin(a) * r, 3, Math.cos(a) * r, 2.5, 6, 0.4, i % 2 ? '#ffffff' : '#e63946', true, { rotY: a });
    }
    this.box(c, 0, 6.2, 0, r * 2.2, 0.4, r * 2.2, '#ffffff', false);
    // a spiral staircase in the middle
    for (let i = 0; i < 18; i++) {
      const a = i * 0.45;
      this.box(c, Math.cos(a) * 1.6, 0.2 + i * 0.3, Math.sin(a) * 1.6, 1.8, 0.15, 0.6, '#8d6e63', false, { rotY: -a });
    }
    this.box(c, 0, 3, 0, 0.4, 6, 0.4, '#6c757d');
    const lamp = new THREE.PointLight('#fff4e0', 1.2, 20, 1.2);
    lamp.position.set(0, 5, 0);
    c.group.add(lamp);
    c.spawn = this.at(0, 0, r - 2.6);
    c.spawnFacing = Math.PI;
    c.actions.push({ pos: this.at(0, 0, r - 0.6), radius: 1.6, prompt: 'Leave', id: 'exit' });
    c.actions.push({ pos: this.at(1.6, 0, 0.8), radius: 1.8, prompt: 'Climb to the lamp gallery', id: 'roof' });
  }

  private buildObservatory(c: Current): void {
    const r = 9;
    this.box(c, 0, -0.25, 0, r * 2, 0.5, r * 2, '#495057', false);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      if (Math.abs(Math.sin(a)) < 0.17 && Math.cos(a) > 0) continue;
      this.box(c, Math.sin(a) * r, 2.5, Math.cos(a) * r, 3, 5, 0.4, '#e9ecef', true, { rotY: a });
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('#1b2a49'));
    dome.material.side = THREE.BackSide;
    dome.position.y = 5;
    c.group.add(dome);
    // painted stars inside the dome
    for (let i = 0; i < 60; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = this.rand() * 1.3;
      const s = part(new THREE.BoxGeometry(0.12, 0.12, 0.12), '#ffffff', Math.cos(a) * Math.cos(e) * (r - 0.3), 5 + Math.sin(e) * (r - 0.3), Math.sin(a) * Math.cos(e) * (r - 0.3), true);
      c.group.add(s);
    }
    // the big telescope
    this.box(c, 0, 1, -2, 2, 2, 2, '#3d405b');
    const scope = part(new THREE.CylinderGeometry(0.6, 0.9, 7, 12), '#adb5bd', 0, 4.3, -3.5);
    scope.rotation.x = 0.7;
    c.group.add(scope);
    const lamp = new THREE.PointLight('#c8d7ff', 1.3, 26, 1.2);
    lamp.position.set(0, 6, 0);
    c.group.add(lamp);
    this.person(c, new THREE.Vector3(3, 0, -1), -Math.PI / 2, 'astronomer', 'Astronomer', { skin: '#f2c9a0', shirt: '#9d4edd', pants: '#3d405b', hair: '#c0c0c0', hairStyle: 'bald', glasses: true });
    c.spawn = this.at(0, 0, r - 3);
    c.spawnFacing = Math.PI;
    c.actions.push({ pos: this.at(0, 0, r - 0.6), radius: 1.6, prompt: 'Leave', id: 'exit' });
    c.actions.push({ pos: this.at(0, 0, 0), radius: 2, prompt: 'Look through the telescope', id: 'telescope' });
  }

  private buildShack(c: Current): void {
    this.room(c, 10, 8, 3.2, '#a47148', '#6f4518');
    this.box(c, 0, 0.45, -2.6, 2, 0.9, 1.2, '#8b5e34');
    this.box(c, 0, 0.95, -2.6, 2.1, 0.12, 1.3, '#ffd166', false);
    this.box(c, -3.5, 1.5, -3.6, 1.4, 1, 0.1, '#111111', false); // skull flag
    this.box(c, -3.5, 1.55, -3.55, 0.5, 0.5, 0.02, '#ffffff', false, { emissive: true });
    for (let i = 0; i < 3; i++) this.box(c, 3.5, 0.4 + i * 0.8, -3, 1, 0.8, 1, '#8b5e34');
    c.actions.push({ pos: this.at(0, 0, -1.4), radius: 1.6, prompt: 'Open the treasure chest', id: 'chest' });
  }

  private buildStation(c: Current): void {
    this.room(c, 20, 12, 5, '#fff1e6', '#d6ccc2');
    this.box(c, -6, 0.55, -3, 4, 1.1, 1.2, '#9d0208');
    this.person(c, new THREE.Vector3(-6, 0, -4), 0, 'clerk', 'Ticket clerk', { skin: '#f2c9a0', shirt: '#9d0208', pants: '#2b2d42', hair: '#5a3825', hairStyle: 'cap', hat: '#2b2d42' });
    for (const x of [2, 6]) this.sofa(c, x, 1, 0, '#adb5bd');
    this.box(c, 0, 3.4, -5.7, 6, 1, 0.1, '#111111', false);
    this.box(c, 0, 3.4, -5.65, 5.6, 0.7, 0.02, '#ffd166', false, { emissive: true });
    this.lift(c, 8, -5.6, 'Up to the platform');
  }

  private buildMoonBase(c: Current): void {
    c.roomy = true;
    this.room(c, 26, 20, 7, '#ced4da', '#6c757d');
    for (const x of [-8, 0, 8]) {
      const g = part(new THREE.CylinderGeometry(1.2, 1.2, 3, 12), '#adb5bd', x, 1.5, -7);
      c.group.add(g);
      const win = part(new THREE.CircleGeometry(0.8, 16), '#04050d', x, 2, -6.9 + 1.25, true);
      c.group.add(win);
    }
    // a big round window to space
    const window = new THREE.Mesh(new THREE.CircleGeometry(3, 32), this.mat('#04050d', { emissive: true }));
    window.position.set(0, 4, -9.8);
    c.group.add(window);
    for (let i = 0; i < 40; i++) c.group.add(part(new THREE.BoxGeometry(0.06, 0.06, 0.02), '#ffffff', (this.rand() - 0.5) * 5, 4 + (this.rand() - 0.5) * 5, -9.75, true));
    this.person(c, new THREE.Vector3(5, 0, -3), 0, 'astronaut', 'Astronaut', { skin: '#f2c9a0', shirt: '#ffffff', pants: '#ffffff', hair: '#ffffff', hairStyle: 'bald' });
    c.actions.push({ pos: this.at(0, 0, -7), radius: 2.4, prompt: 'Read the mission log', id: 'moonlog' });
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
