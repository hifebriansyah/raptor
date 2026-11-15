import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { GameEngine } from '../game/GameEngine';
import { OBSERVATORY, LIGHTHOUSE_HILL, PARK_BASIN, PALM_ISLE, UPTOWN, floorAt } from '../game/Terrain';
import { WORLD, roadWidthX, roadWidthZ } from '../game/WorldMap';
import type { RAPIER } from './PhysicsSystem';
import { addPoints, gameStore, showToast } from '../state/gameStore';

interface Prop {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  collider: RAPIER.Collider | null;
  smashed: number; // seconds since smashed (0 = intact)
  bolts: number;
  kind: string;
}

interface BoltCoin {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
}

interface Brick {
  id: string;
  red: boolean;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  hint: string;
}

interface SuperBuild {
  id: 'bridge' | 'megaramp' | 'launchpad';
  name: string;
  cost: number;
  pad: THREE.Vector3;
  padMesh: THREE.Group;
  /** Pieces and where they end up. */
  pieces: { mesh: THREE.Mesh; to: THREE.Vector3; from: THREE.Vector3; rotTo: THREE.Euler }[];
  colliders: { pos: THREE.Vector3; half: THREE.Vector3; rot?: THREE.Quaternion }[];
  progress: number;
  building: boolean;
}

const BOLT_GEO = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 6);
const BOLT_MAT = new THREE.MeshBasicMaterial({ color: '#dee2e6' });
const BOLT_GOLD = new THREE.MeshBasicMaterial({ color: '#ffd166' });

/**
 * LEGO-game toys: smashable street props that burst into magnetic bolts (smash quickly for a
 * multiplier), hidden Gold and Red Bricks that unlock cheats, and Super Build pads that turn your
 * bolts into a Palm Isle sea bridge, a mega-ramp and a space launch pad.
 */
export class Collectibles {
  private readonly props: Prop[] = [];
  private readonly coins: BoltCoin[] = [];
  readonly bricks: Brick[] = [];
  readonly builds: SuperBuild[] = [];
  multiplier = 1;
  private multTimer = 0;
  private interiorBrick: Brick | null = null;
  private time = 0;

  constructor(private readonly g: GameEngine) {
    this.placeProps();
    this.placeBricks();
    this.placeBuilds();
    g.onMeleeHit = (pos, radius, power) => this.smashAround(pos, radius, power);
    g.onBoltHit = (_gun, pos) => this.smashAround(pos, 0.9, 1) > 0;
    g.interiors.decorators.push((def, add, _actions, at) => {
      this.interiorBrick = null;
      // one house in town hides a Gold Brick under the bed; the pirate keeps one in his chest
      const brick = this.bricks.find((b) => (def.kind === 'house' && b.id === 'gold-house' && def.seed % 5 === 0) || (def.kind === 'shack' && b.id === 'gold-shack'));
      if (!brick || this.has(brick.id)) return;
      const mesh = this.brickMesh(brick.red);
      const local = def.kind === 'shack' ? new THREE.Vector3(0, 1.3, -2.6) : new THREE.Vector3(-3, 0.9, -2);
      mesh.position.copy(local);
      add(mesh);
      this.interiorBrick = { ...brick, pos: at(local.x, local.y, local.z), mesh };
    });
  }

  private has(id: string): boolean {
    return gameStore.getState().goldBricks.includes(id);
  }

  // ───────────────────────────────────────────── props

  private placeProps(): void {
    const { roadMin, roadMax, roadStep } = WORLD;
    const rand = mulberry(4040);
    const kinds = ['bench', 'bin', 'crate', 'mailbox', 'phone', 'barrel'];
    for (let x = roadMin; x <= roadMax; x += roadStep) {
      for (let z = roadMin; z <= roadMax; z += roadStep) {
        for (let k = 0; k < 2; k++) {
          // on the sidewalk, a few metres from the corner (not the hydrant corner)
          const sx = rand() < 0.5 ? -1 : 1;
          const sz = sx > 0 ? -1 : rand() < 0.5 ? -1 : 1;
          const along = 6 + rand() * 14;
          const alongX = rand() < 0.5;
          const px = alongX ? x + sx * along : x + sx * (roadWidthX(x) / 2 - 0.8);
          const pz = alongX ? z + sz * (roadWidthZ(z) / 2 - 0.8) : z + sz * along;
          this.addProp(kinds[Math.floor(rand() * kinds.length)], new THREE.Vector3(px, 0, pz), alongX ? 0 : Math.PI / 2);
        }
      }
    }
    // barrels and crates on Palm Isle and around the dockyard
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      this.addProp(rand() < 0.5 ? 'barrel' : 'crate', new THREE.Vector3(PALM_ISLE.x + Math.cos(a) * 70, 0, PALM_ISLE.z + Math.sin(a) * 70), a);
    }
  }

  private addProp(kind: string, pos: THREE.Vector3, rotY: number): void {
    pos.y = floorAt(pos.x, pos.z);
    const m = new THREE.Group();
    let half = new THREE.Vector3(0.4, 0.5, 0.4);
    if (kind === 'bench') {
      m.add(part(new THREE.BoxGeometry(1.8, 0.1, 0.5), '#a47148', 0, 0.45, 0));
      m.add(part(new THREE.BoxGeometry(1.8, 0.4, 0.08), '#a47148', 0, 0.75, -0.22));
      for (const s of [-0.75, 0.75]) m.add(part(new THREE.BoxGeometry(0.08, 0.45, 0.45), '#495057', s, 0.22, 0));
      half = new THREE.Vector3(0.9, 0.5, 0.3);
    } else if (kind === 'bin') {
      m.add(part(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 8), '#2a9d8f', 0, 0.45, 0));
      m.add(part(new THREE.CylinderGeometry(0.33, 0.33, 0.08, 8), '#264653', 0, 0.92, 0));
    } else if (kind === 'crate') {
      m.add(part(new THREE.BoxGeometry(0.9, 0.9, 0.9), '#d4a373', 0, 0.45, 0));
      m.add(part(new THREE.BoxGeometry(0.95, 0.12, 0.95), '#bc6c25', 0, 0.45, 0));
      half = new THREE.Vector3(0.45, 0.45, 0.45);
    } else if (kind === 'mailbox') {
      m.add(part(new THREE.BoxGeometry(0.5, 0.9, 0.5), '#e63946', 0, 0.75, 0));
      m.add(part(new THREE.BoxGeometry(0.15, 0.3, 0.15), '#222222', 0, 0.15, 0));
    } else if (kind === 'phone') {
      m.add(part(new THREE.BoxGeometry(0.9, 2.3, 0.9), '#d62828', 0, 1.15, 0));
      m.add(part(new THREE.BoxGeometry(0.7, 1.4, 0.92), '#bde0fe', 0, 1.2, 0));
      half = new THREE.Vector3(0.45, 1.15, 0.45);
    } else {
      m.add(part(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 10), '#e76f51', 0, 0.48, 0));
      m.add(part(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 10), '#495057', 0, 0.7, 0));
    }
    m.position.copy(pos);
    m.rotation.y = rotY;
    this.g.scene.add(m);
    const collider = this.g.physics.addStaticBox(pos.clone().setY(pos.y + half.y), half, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
    this.props.push({ mesh: m, pos, collider, smashed: 0, bolts: kind === 'phone' ? 8 : kind === 'bench' ? 5 : 3 + Math.floor(Math.random() * 3), kind });
  }

  /** Smash every intact prop within `radius` of `pos`; returns how many broke. */
  smashAround(pos: THREE.Vector3, radius: number, _power: number): number {
    let n = 0;
    for (const p of this.props) {
      if (p.smashed > 0) continue;
      if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) > radius + 0.6 || Math.abs(p.pos.y - pos.y) > 3) continue;
      this.smash(p);
      n++;
    }
    return n;
  }

  private smash(p: Prop): void {
    p.smashed = 0.001;
    p.mesh.visible = false;
    if (p.collider) {
      this.g.physics.world.removeCollider(p.collider, true);
      p.collider = null;
    }
    const at = p.pos.clone().setY(p.pos.y + 0.6);
    this.g.particles.soft.emit({ pos: at, vel: new THREE.Vector3(0, 5, 0), spread: 2.5, color: '#bc6c25', size: 0.3, life: 0.9, gravity: -20, count: 14 });
    this.g.particles.sparks(at, 12, '#ffffff');
    this.g.audio.play('crash', 0.35);
    // multiplier: smash things quickly one after another
    this.multiplier = Math.min(4, this.multiplier + (this.multTimer > 0 ? 0.5 : 0));
    this.multTimer = 3;
    for (let i = 0; i < p.bolts; i++) this.spawnBolt(at, i === 0 && Math.random() < 0.3);
  }

  private spawnBolt(at: THREE.Vector3, gold: boolean): void {
    const mesh = new THREE.Mesh(BOLT_GEO, gold ? BOLT_GOLD : BOLT_MAT);
    mesh.userData.value = gold ? 5 : 1;
    mesh.position.copy(at);
    this.g.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.coins.push({ mesh, pos: at.clone(), vel: new THREE.Vector3(Math.cos(a) * 3, 6 + Math.random() * 3, Math.sin(a) * 3), age: 0 });
  }

  /** Drop a shower of bolts (rewards from events). */
  shower(at: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) this.spawnBolt(at.clone().setY(at.y + 1), Math.random() < 0.2);
  }

  // ───────────────────────────────────────────── bricks

  private brickMesh(red: boolean): THREE.Group {
    const g = new THREE.Group();
    const c = red ? '#e63946' : '#ffd166';
    g.add(part(new THREE.BoxGeometry(0.9, 0.5, 0.6), c, 0, 0, 0, true));
    for (const sx of [-0.22, 0.22]) for (const sz of [-0.15, 0.15]) g.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), c, sx, 0.3, sz, true));
    return g;
  }

  private placeBricks(): void {
    const tallest = this.g.world.buildings.reduce((a, b) => ((b.h ?? 0) > (a.h ?? 0) ? b : a));
    const list: [string, boolean, THREE.Vector3, string][] = [
      ['gold-cloud', false, new THREE.Vector3(4, 171.4, -48), 'Cloud Isle'],
      ['gold-moon', false, new THREE.Vector3(-142, 521.4, 40), 'Moon Rock'],
      ['gold-crystal', false, new THREE.Vector3(184, 421.4, 64), 'Crystal Star Isle'],
      ['gold-tunnel', false, new THREE.Vector3(-120, 1.4, -390), 'the hill tunnel'],
      ['gold-lighthouse', false, new THREE.Vector3(LIGHTHOUSE_HILL.x + 1.2, LIGHTHOUSE_HILL.top + 22.9, LIGHTHOUSE_HILL.z), 'the top of the lighthouse'],
      ['gold-dome', false, new THREE.Vector3(OBSERVATORY.x, OBSERVATORY.top + 14.8, OBSERVATORY.z), 'the observatory dome'],
      ['gold-basin', false, new THREE.Vector3(PARK_BASIN.x + 6, floorAt(PARK_BASIN.x + 6, PARK_BASIN.z) + 1, PARK_BASIN.z), 'the sunken park'],
      ['gold-tower', false, new THREE.Vector3(tallest.x, (tallest.h ?? 20) + 1.4, tallest.z), 'the tallest tower’s roof'],
      ['gold-house', false, new THREE.Vector3(0, -1000, 0), 'a house in town (under the bed)'],
      ['gold-shack', false, new THREE.Vector3(0, -1000, 0), 'the pirate’s treasure room'],
      ['red-viaduct', true, new THREE.Vector3(100, 10.9, -240), 'the train viaduct'],
      ['red-cliff', true, new THREE.Vector3(UPTOWN.maxX - 10, floorAt(UPTOWN.maxX - 10, UPTOWN.minZ + 10) + 1, UPTOWN.minZ + 10), 'the Uptown cliffs'],
      ['red-satellite', true, new THREE.Vector3(74, 471.4, 172), 'Satellite Star Isle'],
    ];
    for (const [id, red, pos, hint] of list) {
      const mesh = this.brickMesh(red);
      mesh.position.copy(pos);
      mesh.visible = pos.y > -500 && !this.has(id);
      this.g.scene.add(mesh);
      this.bricks.push({ id, red, pos, mesh, hint });
    }
  }

  private collectBrick(b: Brick): void {
    if (this.has(b.id)) return;
    gameStore.setState((s) => ({ goldBricks: [...s.goldBricks, b.id] }));
    b.mesh.visible = false;
    this.g.particles.sparks(b.pos, 50, b.red ? '#e63946' : '#ffd166');
    this.g.audio.play('reward');
    this.g.audio.play('magic');
    const gold = gameStore.getState().goldBricks.filter((x) => !x.startsWith('red-')).length;
    const red = gameStore.getState().goldBricks.length - gold;
    showToast(`${b.red ? 'Red' : 'Gold'} Brick found at ${b.hint}! (Gold ${gold}/10 · Red ${red}/3) Check the cheats in the menu.`);
  }

  // ───────────────────────────────────────────── super builds

  private placeBuilds(): void {
    const mk = (id: SuperBuild['id'], name: string, cost: number, pad: THREE.Vector3, pieces: { size: THREE.Vector3; at: THREE.Vector3; rot?: THREE.Euler; color: string }[]): void => {
      const padMesh = new THREE.Group();
      padMesh.position.copy(pad);
      padMesh.add(part(new THREE.CylinderGeometry(2.2, 2.4, 0.25, 6), '#3d405b', 0, 0.12, 0));
      for (let i = 0; i < 6; i++) padMesh.add(part(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8), '#ffd166', Math.cos(i) * 1.4, 0.32, Math.sin(i) * 1.4, true));
      this.g.scene.add(padMesh);
      const b: SuperBuild = { id, name, cost, pad, padMesh, pieces: [], colliders: [], progress: 0, building: false };
      for (const p of pieces) {
        const mesh = part(new THREE.BoxGeometry(p.size.x, p.size.y, p.size.z), p.color);
        mesh.receiveShadow = true;
        const rot = p.rot ?? new THREE.Euler();
        mesh.position.copy(p.at);
        mesh.rotation.copy(rot);
        mesh.visible = false;
        this.g.scene.add(mesh);
        const from = p.at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 25 + Math.random() * 25, (Math.random() - 0.5) * 30));
        b.pieces.push({ mesh, to: p.at.clone(), from, rotTo: rot.clone() });
        b.colliders.push({ pos: p.at.clone(), half: p.size.clone().multiplyScalar(0.5), rot: new THREE.Quaternion().setFromEuler(rot) });
      }
      this.builds.push(b);
      if (gameStore.getState().superBuilds.includes(id)) this.finish(b, true);
    };
    // Palm Isle Sea Bridge: from the town's east beach over the channel to Palm Isle
    {
      const z = 40;
      const x0 = 283;
      const x1 = 412;
      const deck: { size: THREE.Vector3; at: THREE.Vector3; rot?: THREE.Euler; color: string }[] = [];
      for (let x = x0 + 8; x < x1 - 8; x += 12) deck.push({ size: new THREE.Vector3(12.2, 0.6, 9), at: new THREE.Vector3(x + 6, 1.7, z), color: '#c9ccd3' });
      const ramp = (x: number, dir: number) => ({ size: new THREE.Vector3(8.6, 0.5, 9), at: new THREE.Vector3(x, 0.85, z), rot: new THREE.Euler(0, 0, dir * Math.atan2(2, 8.6)), color: '#adb5bd' });
      deck.push(ramp(x0 + 4, 1), ramp(x1 - 4, -1));
      for (let x = x0 + 14; x < x1 - 8; x += 12) deck.push({ size: new THREE.Vector3(1, 4, 1), at: new THREE.Vector3(x, -0.6, z), color: '#8d99ae' });
      for (const s of [-4.4, 4.4]) for (let x = x0 + 8; x < x1 - 8; x += 12) deck.push({ size: new THREE.Vector3(12.2, 0.8, 0.3), at: new THREE.Vector3(x + 6, 2.4, z + s), color: '#e63946' });
      mk('bridge', 'Palm Isle Sea Bridge', 300, new THREE.Vector3(272, 0, 26), deck);
    }
    // Mega Ramp on the west beach
    {
      const x = -262;
      const pieces: { size: THREE.Vector3; at: THREE.Vector3; rot?: THREE.Euler; color: string }[] = [];
      const len = 34;
      const pitch = 0.36;
      for (let i = 0; i < 4; i++) {
        const seg = len / 4;
        const zc = -110 - (i + 0.5) * seg * Math.cos(pitch);
        const yc = (i + 0.5) * seg * Math.sin(pitch);
        pieces.push({ size: new THREE.Vector3(8, 0.6, seg + 0.2), at: new THREE.Vector3(x, yc, zc), rot: new THREE.Euler(pitch, 0, 0), color: i % 2 ? '#f4a261' : '#e76f51' });
        pieces.push({ size: new THREE.Vector3(7.6, yc * 2, 1), at: new THREE.Vector3(x, yc, zc), color: '#6d6875' });
      }
      mk('megaramp', 'Mega Ramp', 150, new THREE.Vector3(-262, 0, -96), pieces);
    }
    // Space Launch Pad on the south beach
    {
      const at = new THREE.Vector3(-200, 0, 262);
      mk('launchpad', 'Space Launch Pad', 400, new THREE.Vector3(-186, 0, 262), [
        { size: new THREE.Vector3(9, 0.6, 9), at: at.clone().setY(0.3), color: '#495057' },
        { size: new THREE.Vector3(7, 0.2, 7), at: at.clone().setY(0.7), color: '#ffd166' },
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ size: new THREE.Vector3(0.6, 9, 0.6), at: at.clone().add(new THREE.Vector3(sx * 4.2, 4.5, sz * 4.2)), color: '#adb5bd' }))),
        { size: new THREE.Vector3(9, 0.5, 0.5), at: at.clone().add(new THREE.Vector3(0, 9, -4.2)), color: '#e63946' },
      ]);
    }
  }

  private startBuild(b: SuperBuild): void {
    const s = gameStore.getState();
    if (s.bolts < b.cost) {
      showToast(`${b.name} needs ${b.cost} bolts (you have ${s.bolts}). Smash things to collect more!`);
      return;
    }
    gameStore.setState({ bolts: s.bolts - b.cost });
    b.building = true;
    b.progress = 0;
    for (const p of b.pieces) {
      p.mesh.visible = true;
      p.mesh.position.copy(p.from);
    }
    showToast(`Super Build: ${b.name}!`);
    this.g.audio.play('transform');
  }

  private finish(b: SuperBuild, silent = false): void {
    b.building = false;
    b.progress = 1;
    b.padMesh.visible = false;
    for (const p of b.pieces) {
      p.mesh.visible = true;
      p.mesh.position.copy(p.to);
      p.mesh.rotation.copy(p.rotTo);
    }
    for (const c of b.colliders) this.g.physics.addStaticBox(c.pos, c.half, c.rot);
    if (silent) return;
    if (!gameStore.getState().superBuilds.includes(b.id)) gameStore.setState((s) => ({ superBuilds: [...s.superBuilds, b.id] }));
    addPoints(50);
    this.g.audio.play('reward');
    showToast(b.id === 'launchpad' ? 'Space Launch Pad built! Stand on it and press E to blast off.' : `${b.name} built! +50 Lab Points`);
  }

  /** E prompts: build pads, the launch pad. */
  interaction(): { prompt: string; priority: number; run: () => void } | null {
    const g = this.g;
    const feet = g.riding ? g.raptor.feet : g.onFoot ? g.professor.feet : null;
    if (!feet) return null;
    for (const b of this.builds) {
      const near = Math.hypot(b.pad.x - feet.x, b.pad.z - feet.z) < 3 && Math.abs(feet.y - b.pad.y) < 2;
      if (b.progress === 0 && !b.building && near) return { prompt: `Super Build: ${b.name} (${b.cost} bolts)`, priority: 1, run: () => this.startBuild(b) };
      if (b.id === 'launchpad' && b.progress === 1) {
        const at = new THREE.Vector3(-200, 0, 262);
        if (Math.hypot(at.x - feet.x, at.z - feet.z) < 3.5 && feet.y < 2) return { prompt: 'BLAST OFF to space!', priority: 0.5, run: () => g.launchToSpace() };
      }
    }
    return null;
  }

  update(dt: number): void {
    const g = this.g;
    this.time += dt;
    this.multTimer -= dt;
    if (this.multTimer <= 0 && this.multiplier > 1) this.multiplier = Math.max(1, this.multiplier - dt * 0.5);
    const me = g.playerPos;
    const magnet = gameStore.getState().cheats.magnet ? 14 : 3.5;
    let got = 0;
    for (const c of this.coins.slice()) {
      c.age += dt;
      const to = me.clone().sub(c.pos);
      const d = to.length();
      if (c.age > 0.5 && d < magnet) {
        c.vel.lerp(to.normalize().multiplyScalar(18), Math.min(1, dt * 6));
      } else c.vel.y -= 25 * dt;
      c.pos.addScaledVector(c.vel, dt);
      const floor = floorAt(c.pos.x, c.pos.z, c.pos.y) + 0.1;
      if (c.pos.y < floor) {
        c.pos.y = floor;
        c.vel.multiplyScalar(0.5);
        c.vel.y = Math.abs(c.vel.y) * 0.3;
      }
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.set(Math.PI / 2, this.time * 5, 0);
      if (d < 1.2 && c.age > 0.4) {
        got += (c.mesh.userData.value as number) * this.multiplier;
        g.scene.remove(c.mesh);
        this.coins.splice(this.coins.indexOf(c), 1);
      } else if (c.age > 30) {
        g.scene.remove(c.mesh);
        this.coins.splice(this.coins.indexOf(c), 1);
      }
    }
    if (got) {
      gameStore.setState((s) => ({ bolts: s.bolts + Math.round(got) }));
      g.audio.play('blip', 0.25);
    }
    // smashing by running into things: the Raptor sprinting, a driven vehicle at speed
    const hitters: [THREE.Vector3, number][] = [];
    if (g.vehicle && Math.abs(g.vehicle.speed) > 8) hitters.push([g.vehicle.pos, g.vehicle.kind === 'car' ? 2 : 1]);
    if (g.riding && g.raptor.horizontalSpeed > 10) hitters.push([g.raptor.pos, g.giant.active ? 4 : 1.6]);
    for (const [p, r] of hitters) this.smashAround(p, r, 1);
    // props come back a while after being smashed (when nobody's looking)
    for (const p of this.props) {
      if (p.smashed <= 0) continue;
      p.smashed += dt;
      if (p.smashed > 90 && p.pos.distanceTo(me) > 60) {
        p.smashed = 0;
        p.mesh.visible = true;
        const half = new THREE.Vector3(0.4, 0.5, 0.4);
        p.collider = g.physics.addStaticBox(p.pos.clone().setY(p.pos.y + half.y), half);
      }
    }
    // bricks: spin and pick up
    for (const b of this.bricks) {
      if (!b.mesh.visible) continue;
      b.mesh.rotation.y = this.time * 2;
      b.mesh.position.y = b.pos.y + Math.sin(this.time * 2) * 0.15;
      if (b.pos.distanceTo(me) < (g.riding ? 3.5 : 1.8)) this.collectBrick(b);
    }
    if (this.interiorBrick && g.interiors.inside && this.interiorBrick.mesh.visible) {
      this.interiorBrick.mesh.rotation.y = this.time * 2;
      if (this.interiorBrick.pos.distanceTo(g.professor.feet.clone().setY(g.professor.feet.y + 0.9)) < 1.8) {
        this.interiorBrick.mesh.visible = false;
        this.collectBrick(this.interiorBrick);
      }
    }
    // super builds fly together piece by piece
    for (const b of this.builds) {
      if (!b.building) continue;
      b.progress = Math.min(0.999, b.progress + dt / 3);
      b.pieces.forEach((p, i) => {
        const k = THREE.MathUtils.clamp(b.progress * 1.6 - (i / b.pieces.length) * 0.6, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        p.mesh.position.lerpVectors(p.from, p.to, e);
        p.mesh.rotation.set(p.rotTo.x + (1 - e) * 3, p.rotTo.y + (1 - e) * 2, p.rotTo.z);
      });
      if (Math.random() < 0.3) g.particles.sparks(b.pieces[Math.floor(Math.random() * b.pieces.length)].mesh.position, 6, '#ffd166');
      if (b.progress >= 0.999) this.finish(b);
    }
  }

  /** For the progress wall. */
  counts(): { gold: number; red: number; builds: number } {
    const s = gameStore.getState();
    const red = s.goldBricks.filter((x) => x.startsWith('red-')).length;
    return { gold: s.goldBricks.length - red, red, builds: s.superBuilds.length };
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
