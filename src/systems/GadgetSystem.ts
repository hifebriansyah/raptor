import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { Humanoid } from '../entities/Humanoid';
import type { GameEngine } from '../game/GameEngine';
import { addPoints, gameStore, showToast, type GunId } from '../state/gameStore';
import type { Thug } from './ThugSystem';

type Animal = 'chicken' | 'frog' | 'minidino' | 'penguin' | 'duck';
const ANIMALS: Animal[] = ['chicken', 'frog', 'minidino', 'penguin', 'duck'];

const GUN_COLOR: Record<GunId, string> = { water: '#4cc9f0', size: '#06d6a0', teleport: '#c77dff', transform: '#ff70a6', megaphone: '#ffd166' };
export const GUN_LABEL: Record<GunId, string> = { water: 'Water Gun', size: 'Shrink / Big Gun', teleport: 'Teleport Gun', transform: 'Transform Gun', megaphone: 'Megaphone Gun' };

interface Bolt {
  gun: GunId;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

/** Sizes the Size Gun cycles through: normal → giant → tiny → normal. */
const SIZES = [1, 2.4, 0.45];

/**
 * The Professor's toolkit on foot: a punch & kick combo (X), a flying kick and a ground slam in the
 * air, a shoulder bash while running, and the gadget wheel of five Lab Guns (Z cycles, 1–5 picks):
 * Water, Shrink/Big, Teleport (zaps dazed thugs to jail), Transform (animal costumes) and Megaphone
 * (a sonic blast that throws everything).
 */
export class GadgetSystem {
  private combo = 0;
  private comboTimer = 0;
  private hitPending: { at: number; power: number; reach: number; spread: number; kind: string } | null = null;
  private cooldown = 0;
  private readonly bolts: Bolt[] = [];
  private readonly costumes: { root: THREE.Object3D; group: THREE.Group; time: number }[] = [];
  private gwenGiant = false;

  constructor(private readonly g: GameEngine) {}

  /** Z / 1–5 on foot: switch guns. */
  selectGun(next: GunId | 'cycle'): void {
    const s = gameStore.getState();
    const order: GunId[] = ['water', 'size', 'teleport', 'transform', 'megaphone'];
    const gun = next === 'cycle' ? order[(order.indexOf(s.gun) + 1) % order.length] : next;
    if (gun === s.gun) return;
    gameStore.setState({ gun });
    showToast(`${GUN_LABEL[gun]}`);
    this.g.audio.play('blip');
  }

  // ───────────────────────────────────────────── melee

  /** X pressed (on foot). */
  melee(): void {
    const p = this.g.professor;
    if (p.attack && p.attack.t < 0.18) return;
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    if (!p.grounded && !p.swimming && !p.parachuting) {
      const height = p.feet.y - this.g.groundBelow(p.feet);
      if (height > 3) {
        p.attack = { kind: 'slam', t: 0 };
        p.vy = Math.min(p.vy, -26);
        this.slamPending = true;
      } else {
        p.attack = { kind: 'flykick', t: 0 };
        p.dash = { vel: fwd.clone().multiplyScalar(12), time: 0.35 };
        this.hitPending = { at: 0.05, power: 1, reach: 2.2, spread: 0.9, kind: 'flykick' };
      }
      return;
    }
    if (this.g.input.sprint && p.horizontalSpeed > 6) {
      p.attack = { kind: 'bash', t: 0 };
      p.dash = { vel: fwd.clone().multiplyScalar(13), time: 0.3 };
      this.hitPending = { at: 0.05, power: 1, reach: 2.4, spread: 0.9, kind: 'bash' };
      return;
    }
    this.combo = this.comboTimer > 0 ? (this.combo % 4) + 1 : 1;
    this.comboTimer = 0.75;
    const kind = (['jab', 'hook', 'spin', 'finisher'] as const)[this.combo - 1];
    p.attack = { kind, t: 0 };
    this.hitPending = { at: 0.1, power: kind === 'finisher' ? 2 : 1, reach: kind === 'spin' ? 2.3 : 1.9, spread: kind === 'spin' ? Math.PI : 0.8, kind };
  }

  private slamPending = false;

  /** Land a melee hit: thugs take damage, people stumble, things get knocked. */
  private strike(power: number, reach: number, spread: number, kind: string): void {
    const p = this.g.professor;
    const at = p.pos.clone();
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    const inCone = (q: THREE.Vector3, r: number) => {
      const d = new THREE.Vector3(q.x - at.x, 0, q.z - at.z);
      const len = d.length();
      if (len > r || Math.abs(q.y - p.feet.y) > 2.2) return false;
      return len < 0.6 || Math.acos(Math.max(-1, Math.min(1, d.normalize().dot(fwd)))) < spread;
    };
    let hit = false;
    for (const t of this.g.thugs.near(at, reach + 1)) {
      if (!inCone(t.pos, reach * Math.max(1, t.size))) continue;
      const dir = new THREE.Vector3(t.pos.x - at.x, 0, t.pos.z - at.z).normalize();
      if (kind === 'finisher' || kind === 'bash') {
        // knockback finisher: send them flying
        this.g.thugs.hurt(t, power, dir);
        const body = this.g.thugs.beginFling(t);
        this.g.fling.launch(body, body.position.clone(), dir.multiplyScalar(9).setY(9), 0, (q) => this.g.thugs.endFling(t, q), 1.5);
      } else this.g.thugs.hurt(t, power, dir);
      hit = true;
    }
    for (const w of this.g.pedestrians.near(at, reach + 0.5)) {
      if (!inCone(w.pos, reach)) continue;
      this.g.pedestrians.frighten(w, 2, new THREE.Vector3(w.pos.x - at.x, 0, w.pos.z - at.z).normalize().multiplyScalar(2.5));
      hit = true;
    }
    this.g.onMeleeHit?.(at.clone().addScaledVector(fwd, reach * 0.6), reach, power);
    if (hit) {
      this.g.particles.sparks(at.clone().addScaledVector(fwd, 1).setY(at.y + 0.3), 14, '#ffffff');
      this.g.audio.play('stomp', 0.7);
      this.g.rig.shake(0.12 * power);
    } else this.g.audio.play('blip', 0.3);
  }

  // ───────────────────────────────────────────── guns

  /** Fire the current (non-water) gun towards `aim`. */
  fire(aim: THREE.Vector3): void {
    if (this.cooldown > 0) return;
    const gun = gameStore.getState().gun;
    const p = this.g.professor;
    const from = p.handWorld();
    p.attack = { kind: 'zap', t: 0 };
    if (gun === 'megaphone') {
      this.cooldown = 1.1;
      this.megaphone(from, aim);
      return;
    }
    this.cooldown = 0.4;
    const dir = aim.clone().sub(from).normalize();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: GUN_COLOR[gun] }));
    mesh.position.copy(from);
    this.g.scene.add(mesh);
    this.bolts.push({ gun, mesh, pos: from.clone(), vel: dir.multiplyScalar(42), life: 1.2 });
    this.g.audio.play('magic', 0.35);
  }

  /** A cone of sound: throws cars, bikes, people, thugs and loose things. */
  private megaphone(from: THREE.Vector3, aim: THREE.Vector3): void {
    const g = this.g;
    const dir = aim.clone().sub(from).setY(0).normalize();
    const range = 16;
    const hitCone = (q: THREE.Vector3) => {
      const d = new THREE.Vector3(q.x - from.x, 0, q.z - from.z);
      const len = d.length();
      return len < range && len > 0.3 && d.normalize().dot(dir) > Math.cos(0.55);
    };
    const throwVel = (q: THREE.Vector3) => {
      const d = new THREE.Vector3(q.x - from.x, 0, q.z - from.z);
      const k = 1 - d.length() / range;
      return dir.clone().multiplyScalar(14 + 10 * k).setY(12 + 8 * k);
    };
    for (const car of g.traffic.near(from, range)) {
      if (!hitCone(car.agent.world)) continue;
      g.traffic.beginFling(car);
      g.fling.launch(car.mesh, car.mesh.position.clone(), throwVel(car.agent.world), 0, (q) => g.traffic.endFling(car, q), 0.7);
    }
    for (const v of g.vehicles.near(from, range)) {
      if (!hitCone(v.pos) || v.kind === 'boat') continue;
      g.vehicles.beginFling(v);
      g.fling.launch(v.group, v.group.position.clone(), throwVel(v.pos), 0, (q, h) => g.vehicles.endFling(v, q, h), 1);
    }
    for (const w of g.pedestrians.near(from, range)) {
      if (!hitCone(w.pos)) continue;
      const body = g.pedestrians.beginFling(w);
      g.fling.launch(body, body.position.clone(), throwVel(w.pos), 0, (q) => g.pedestrians.endFling(w, q), 1.5);
    }
    for (const t of g.thugs.near(from, range)) {
      if (!hitCone(t.pos)) continue;
      g.thugs.hurt(t, 1, dir);
      const body = g.thugs.beginFling(t);
      g.fling.launch(body, body.position.clone(), throwVel(t.pos), 0, (q) => g.thugs.endFling(t, q), 1.5);
    }
    g.onMeleeHit?.(from.clone().addScaledVector(dir, 6), 8, 3);
    // visible sound rings
    for (let i = 0; i < 3; i++) {
      g.particles.glow.emit({ pos: from.clone().addScaledVector(dir, 1 + i), vel: dir.clone().multiplyScalar(22), spread: 1.5 + i, color: '#ffd166', size: 0.8, grow: 3, life: 0.5, drag: 0.5, count: 6, alpha: 0.6 });
    }
    g.audio.play('honk', 1);
    g.audio.play('crash', 0.4);
    g.rig.shake(0.25);
  }

  /** What a bolt does to whatever it hits. Returns true if it hit something. */
  private hitTest(b: Bolt): boolean {
    const g = this.g;
    const p = b.pos;
    const thug = g.thugs.near(p, 1.2).find((t) => Math.abs(t.pos.y + 1 * t.size - p.y) < 1.4 * t.size);
    if (thug) {
      this.applyToThug(b.gun, thug);
      return true;
    }
    const npc = g.npcs.near(p, 1.1)[0];
    if (npc) {
      this.applyToBody(b.gun, npc.body, npc.id === 'gwen' ? 'gwen' : 'npc', npc.name);
      return true;
    }
    const w = g.pedestrians.near(p, 1.1).find((x) => Math.abs(x.pos.y + 1 - p.y) < 1.4 * x.body.root.scale.x);
    if (w) {
      if (b.gun === 'teleport') {
        g.pedestrians.relocate(w);
        g.particles.sparks(p, 20, '#c77dff');
        showToast('Zap! A passer-by blinks off somewhere else in town.');
      } else {
        this.applyToBody(b.gun, w.body, 'person');
        g.pedestrians.frighten(w, b.gun === 'transform' ? 15 : 3);
      }
      return true;
    }
    const car = g.traffic.near(p, 2.4)[0];
    if (car && p.y < 3.5 * car.mesh.scale.x) {
      this.applyToObject(b.gun, car.mesh);
      return true;
    }
    const v = g.vehicles.near(p, 1.6)[0];
    if (v && p.y - v.pos.y < 3) {
      this.applyToObject(b.gun, v.group);
      return true;
    }
    return g.onBoltHit?.(b.gun, p) ?? false;
  }

  private applyToThug(gun: GunId, t: Thug): void {
    const g = this.g;
    if (gun === 'teleport') {
      if (g.thugs.zap(t, g.professor.pos)) {
        g.particles.sparks(t.pos.clone().setY(t.pos.y + 1), 50, '#c77dff');
        gameStore.setState((s) => ({ jailed: s.jailed + 1 }));
        addPoints(20);
        g.audio.play('magic');
        g.audio.play('reward');
        showToast(`Zapped to the police holding cells! (${gameStore.getState().jailed} jailed) +20 Lab Points`);
      } else {
        showToast('The thug dodges the beam! Knock them silly first (punch with X).');
      }
      return;
    }
    if (gun === 'size') {
      g.thugs.setSize(t, nextSize(t.size));
      g.particles.sparks(t.pos.clone().setY(t.pos.y + 1), 24, '#06d6a0');
      showToast(t.size > 1.5 ? 'Uh oh, a GIANT thug!' : t.size < 0.8 ? 'A teeny tiny thug! Squeak!' : 'Back to normal size.');
      return;
    }
    if (gun === 'transform') {
      g.thugs.costume(t, 12);
      this.costume(t.body, 12);
      showToast('The thug is now a goofy animal and too embarrassed to fight!');
    }
  }

  private applyToBody(gun: GunId, body: Humanoid, who: 'npc' | 'gwen' | 'person', name?: string): void {
    const g = this.g;
    const at = body.root.getWorldPosition(new THREE.Vector3());
    if (gun === 'size') {
      const s = nextSize(body.root.scale.x);
      body.root.scale.setScalar(who === 'gwen' && s > 1.5 ? 6 : s);
      g.particles.sparks(at.setY(at.y + 1), 24, '#06d6a0');
      if (who === 'gwen') {
        this.gwenGiant = body.root.scale.x > 3;
        showToast(this.gwenGiant ? 'Gwen is a REAL kaiju now! "RAAAAAWR!" (the whole street runs)' : 'Gwen shrinks back down. "Aww."');
        if (this.gwenGiant) {
          g.pedestrians.scare(at, 40);
          g.rig.shake(0.6);
          g.audio.play('stomp');
        }
      } else if (name) showToast(`${name}: "${s > 1.5 ? 'Whoa, I can see my house from here!' : s < 0.8 ? 'Hey! Who shrank me?!' : 'Phew, normal again.'}"`);
      return;
    }
    if (gun === 'transform') {
      this.costume(body, 15);
      if (name) showToast(`${name} is now dressed as a ${ANIMALS[this.costumes.length % ANIMALS.length]}!`);
      return;
    }
    if (gun === 'teleport' && name) showToast(`${name}: "Don't you zap me, young man!"`);
  }

  private applyToObject(gun: GunId, obj: THREE.Object3D): void {
    const at = obj.getWorldPosition(new THREE.Vector3());
    if (gun === 'size') {
      obj.scale.setScalar(nextSize(obj.scale.x));
      this.g.particles.sparks(at.setY(at.y + 1), 30, '#06d6a0');
    } else if (gun === 'teleport') {
      this.g.particles.sparks(at.setY(at.y + 1), 30, '#c77dff');
      showToast('Zap! (Cars are too heavy to teleport… for now.)');
    } else if (gun === 'transform') {
      showToast('The Transform Gun only works on people. And thugs.');
    }
  }

  /** Dress a person up as an animal for a while. */
  private costume(body: Humanoid, seconds: number): void {
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const old = this.costumes.find((c) => c.root === body.root);
    if (old) {
      old.group.parent?.remove(old.group);
      this.costumes.splice(this.costumes.indexOf(old), 1);
    }
    const color: Record<Animal, string> = { chicken: '#ffffff', frog: '#57cc99', minidino: '#80b918', penguin: '#222222', duck: '#ffd60a' };
    const g = new THREE.Group();
    const c = color[animal];
    g.add(part(new THREE.BoxGeometry(0.56, 0.72, 0.4), c, 0, 0.3, 0)); // suit body (over the torso)
    const hood = new THREE.Group();
    hood.position.y = 0.78;
    hood.add(part(new THREE.BoxGeometry(0.42, 0.44, 0.4), c, 0, 0.12, -0.02));
    if (animal === 'chicken') {
      hood.add(part(new THREE.BoxGeometry(0.08, 0.16, 0.22), '#e63946', 0, 0.4, 0));
      hood.add(part(new THREE.ConeGeometry(0.07, 0.18, 4).rotateX(Math.PI / 2), '#ffb703', 0, 0.08, 0.26));
    } else if (animal === 'duck' || animal === 'penguin') {
      hood.add(part(new THREE.BoxGeometry(0.22, 0.06, 0.18), '#fb8500', 0, 0.06, 0.26));
      if (animal === 'penguin') g.add(part(new THREE.BoxGeometry(0.4, 0.6, 0.05), '#ffffff', 0, 0.28, 0.21));
    } else if (animal === 'frog') {
      for (const sx of [-0.12, 0.12]) hood.add(part(new THREE.SphereGeometry(0.09, 8, 6), '#ffffff', sx, 0.38, 0.12));
    } else {
      for (let i = 0; i < 3; i++) g.add(part(new THREE.ConeGeometry(0.07, 0.18, 4), '#ffd166', 0, 0.55 - i * 0.18, -0.24));
      g.add(part(new THREE.BoxGeometry(0.16, 0.14, 0.5), c, 0, -0.05, -0.4));
    }
    g.add(hood);
    const torso = body.head.parent!;
    torso.add(g);
    this.costumes.push({ root: body.root, group: g, time: seconds });
    this.g.particles.sparks(body.root.getWorldPosition(new THREE.Vector3()).setY(body.root.position.y + 1), 30, '#ff70a6');
    this.g.audio.play('magic', 0.6);
  }

  update(dt: number): void {
    const p = this.g.professor;
    this.cooldown -= dt;
    this.comboTimer -= dt;
    if (this.hitPending && p.attack && p.attack.t >= this.hitPending.at) {
      const h = this.hitPending;
      this.hitPending = null;
      this.strike(h.power, h.reach, h.spread, h.kind);
    }
    if (this.slamPending && (p.grounded || p.swimming)) {
      this.slamPending = false;
      this.g.groundSlam(p.feet);
    }
    for (const b of this.bolts.slice()) {
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      this.g.particles.glow.emit({ pos: b.pos.clone(), vel: new THREE.Vector3(), spread: 0.15, color: GUN_COLOR[b.gun], size: 0.4, grow: -0.6, life: 0.25, count: 1 });
      const hit = this.hitTest(b);
      if (hit || b.life <= 0 || b.pos.y < this.g.groundBelow(b.pos)) {
        this.g.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bolts.splice(this.bolts.indexOf(b), 1);
      }
    }
    for (const c of this.costumes.slice()) {
      c.time -= dt;
      if (c.time <= 0) {
        c.group.parent?.remove(c.group);
        this.costumes.splice(this.costumes.indexOf(c), 1);
      }
    }
  }
}

function nextSize(s: number): number {
  const i = SIZES.findIndex((x) => Math.abs(x - s) < 0.2);
  return SIZES[(i + 1) % SIZES.length];
}
