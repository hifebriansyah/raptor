import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { GameEngine } from '../game/GameEngine';
import { floorAt } from '../game/Terrain';
import { addPoints, clearObjective, setObjective, showToast } from '../state/gameStore';
import type { MinimapMarker } from '../ui/Minimap';

export type SandboxEvent = 'meteor' | 'train' | 'mech';

interface Meteor {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  landed: boolean;
}

interface Mech {
  root: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  pos: THREE.Vector3;
  heading: number;
  hp: number;
  target: THREE.Vector3;
  stomp: number;
  hitCooldown: number;
  down: number;
  phase: number;
}

const MECH_HP = 10;

/**
 * Surprise events around town (one at a time, every few minutes): a meteor crashing down, the city
 * train's brakes failing, or a Rogue Mech stomping into downtown (a job for Giant Mode).
 */
export class SandboxEvents {
  active: SandboxEvent | null = null;
  private timer = 150 + Math.random() * 60;
  private meteor: Meteor | null = null;
  private rock: THREE.Group | null = null;
  private mech: Mech | null = null;
  private trainTime = 0;

  constructor(private readonly g: GameEngine) {
    const prev = g.onMeleeHit;
    g.onMeleeHit = (pos, radius, power) => {
      prev?.(pos, radius, power);
      this.hitMech(pos, radius, power);
    };
    g.onBrake = () => this.brakeTrain();
  }

  start(kind: SandboxEvent): void {
    if (this.active) return;
    this.active = kind;
    if (kind === 'meteor') this.startMeteor();
    else if (kind === 'train') this.startRunaway();
    else this.startMech();
  }

  // ───────────────────────────────────────────── meteor

  private startMeteor(): void {
    const g = this.g;
    const me = g.worldPos;
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 90;
    const x = THREE.MathUtils.clamp(me.x + Math.cos(a) * r, -250, 250);
    const z = THREE.MathUtils.clamp(me.z + Math.sin(a) * r, -250, 250);
    const target = new THREE.Vector3(x, floorAt(x, z), z);
    const mesh = new THREE.Group();
    mesh.add(part(new THREE.IcosahedronGeometry(2.2, 0), '#5c4033'));
    mesh.add(part(new THREE.IcosahedronGeometry(2.6, 0), '#ff7b00', 0, 0, 0, true));
    (mesh.children[1] as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: '#ff7b00', transparent: true, opacity: 0.4 });
    const pos = target.clone().add(new THREE.Vector3(120, 420, -80));
    mesh.position.copy(pos);
    g.scene.add(mesh);
    this.meteor = { mesh, pos, target, landed: false };
    showToast('Look up! A METEOR is coming down over town!');
    g.audio.play('alarm', 0.8);
    setObjective({ id: 'event', icon: 'eye', text: 'A meteor is falling! Find where it lands' });
  }

  // ───────────────────────────────────────────── runaway train

  private startRunaway(): void {
    this.g.train.runaway = true;
    this.trainTime = 80;
    showToast('The city train’s brakes have failed! Land on the front car, climb into the cab and pull the brake!');
    this.g.audio.play('alarm');
    setObjective({ id: 'event', icon: 'flag', text: 'Runaway train! Get into the cab (front car) and pull the brake · 80 s' });
  }

  private brakeTrain(): void {
    if (this.active !== 'train') return;
    this.g.train.brake();
    addPoints(80);
    this.g.collectibles.shower(this.g.train.cars[0].pos.clone().setY(13), 20);
    showToast('You pulled the emergency brake! The passengers cheer. +80 Lab Points');
    this.g.audio.play('reward');
    this.end();
  }

  // ───────────────────────────────────────────── rogue mech

  private startMech(): void {
    const g = this.g;
    const root = new THREE.Group();
    const steel = '#6c757d';
    const dark = '#343a40';
    const legs: THREE.Object3D[] = [];
    const arms: THREE.Object3D[] = [];
    for (const sx of [-1.4, 1.4]) {
      const leg = new THREE.Group();
      leg.position.set(sx, 5, 0);
      leg.add(part(new THREE.BoxGeometry(1.6, 5, 1.8), steel, 0, -2.5, 0));
      leg.add(part(new THREE.BoxGeometry(2, 0.8, 2.8), dark, 0, -4.8, 0.4));
      root.add(leg);
      legs.push(leg);
    }
    root.add(part(new THREE.BoxGeometry(5, 4, 3), steel, 0, 7, 0));
    root.add(part(new THREE.BoxGeometry(5.2, 0.6, 3.2), '#e63946', 0, 8.2, 0));
    root.add(part(new THREE.BoxGeometry(2.4, 1.8, 2), dark, 0, 9.9, 0.2));
    root.add(part(new THREE.BoxGeometry(1.8, 0.4, 0.1), '#ff1744', 0, 10, 1.25, true)); // red visor
    for (const sx of [-3.2, 3.2]) {
      const arm = new THREE.Group();
      arm.position.set(sx, 8.5, 0);
      arm.add(part(new THREE.BoxGeometry(1.2, 4.5, 1.2), steel, 0, -2.2, 0));
      arm.add(part(new THREE.BoxGeometry(1.6, 1.6, 1.6), dark, 0, -4.6, 0));
      root.add(arm);
      arms.push(arm);
    }
    // comes in from the beach the player isn't on
    const me = g.worldPos;
    const from = new THREE.Vector3(me.x > 0 ? -262 : 262, 0, me.z > 0 ? -200 : 200);
    root.position.copy(from);
    g.scene.add(root);
    this.mech = { root, legs, arms, pos: from.clone(), heading: 0, hp: MECH_HP, target: new THREE.Vector3(0, 0, 0), stomp: 0, hitCooldown: 0, down: 0, phase: 0 };
    showToast('A ROGUE MECH is stomping towards downtown! Hop on the Raptor and press G for Giant Mode!');
    g.audio.play('alarm');
    setObjective({ id: 'event', icon: 'fire', text: `Stop the Rogue Mech! Giant Mode (G), then punch (X) · ${MECH_HP}/${MECH_HP}` });
  }

  /** Giant punches, Titan stomps, megaphone blasts and turbo rams hurt the mech. */
  private hitMech(pos: THREE.Vector3, radius: number, power: number): void {
    const m = this.mech;
    if (!m || m.down > 0 || m.hitCooldown > 0) return;
    if (Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z) > radius + 3.5) return;
    // only big hits count: Titan punches/stomps (power ≥ 1), megaphone, ram
    if (power < 1) return;
    m.hitCooldown = 0.5;
    m.hp -= this.g.giant.active ? 1.5 * Math.min(2, power) : 0.5;
    this.g.particles.sparks(m.pos.clone().setY(7), 40, '#ffd166');
    this.g.audio.play('crash', 1);
    this.g.rig.shake(0.4);
    setObjective({ id: 'event', icon: 'fire', text: `Stop the Rogue Mech! Giant Mode (G), then punch (X) · ${Math.max(0, Math.ceil(m.hp))}/${MECH_HP}` });
    if (m.hp <= 0) {
      m.down = 0.001;
      showToast('The Rogue Mech topples over! KA-BOOM! +150 Lab Points');
      addPoints(150);
      this.g.collectibles.shower(m.pos.clone().setY(2), 60);
      this.g.audio.play('reward');
    } else if (!this.g.giant.active) showToast('Barely a scratch! It needs a giant to fight a giant (G on the Raptor).');
  }

  markers(): MinimapMarker[] {
    const out: MinimapMarker[] = [];
    if (this.meteor) out.push({ x: this.meteor.target.x, z: this.meteor.target.z, color: '#ff7b00', label: '☄', pinToEdge: true });
    if (this.rock) out.push({ x: this.rock.position.x, z: this.rock.position.z, color: '#ffd166', label: '◆', pinToEdge: true });
    if (this.mech) out.push({ x: this.mech.pos.x, z: this.mech.pos.z, color: '#ff1744', label: 'M', pinToEdge: true });
    if (this.active === 'train') out.push({ x: this.g.train.cars[0].pos.x, z: this.g.train.cars[0].pos.z, color: '#d62828', label: 'T', pinToEdge: true });
    return out;
  }

  private end(): void {
    this.active = null;
    this.timer = 180 + Math.random() * 120;
    clearObjective('event');
  }

  update(dt: number): void {
    const g = this.g;
    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0 && !g.mystery.case && !g.race.active && !g.interiors.inside) {
        const pick: SandboxEvent[] = ['meteor', 'train', 'mech'];
        this.start(pick[Math.floor(Math.random() * pick.length)]);
      }
      return;
    }
    // meteor falling, then a glowing rock to collect
    const mt = this.meteor;
    if (mt && !mt.landed) {
      const dir = mt.target.clone().sub(mt.pos);
      const step = Math.min(dir.length(), 110 * dt);
      mt.pos.addScaledVector(dir.normalize(), step);
      mt.mesh.position.copy(mt.pos);
      mt.mesh.rotation.x += dt * 3;
      g.particles.glow.emit({ pos: mt.pos.clone(), vel: new THREE.Vector3(0, 4, 0), spread: 2, color: '#ff9f1c', size: 2, grow: 2, life: 0.8, drag: 1, count: 4, alpha: 0.9 });
      g.particles.soft.emit({ pos: mt.pos.clone(), vel: new THREE.Vector3(0, 3, 0), spread: 2, color: '#3a2f2a', size: 2, grow: 4, life: 1.5, drag: 1, count: 2, alpha: 0.5 });
      if (step < 0.5 || mt.pos.distanceTo(mt.target) < 1) {
        mt.landed = true;
        g.scene.remove(mt.mesh);
        g.meteorImpact(mt.target.clone());
        this.rock = new THREE.Group();
        this.rock.add(part(new THREE.IcosahedronGeometry(1.2, 0), '#5c4033'));
        this.rock.add(part(new THREE.OctahedronGeometry(0.5, 0), '#7cf3ff', 0.6, 0.8, 0.2, true));
        this.rock.position.copy(mt.target).setY(mt.target.y + 0.8);
        g.scene.add(this.rock);
        this.meteor = null;
        setObjective({ id: 'event', icon: 'eye', text: 'Grab the glowing space rock from the crater' });
      }
    }
    if (this.rock) {
      this.rock.rotation.y += dt;
      if (this.rock.position.distanceTo(g.playerPos) < 3) {
        g.scene.remove(this.rock);
        this.rock = null;
        addPoints(30);
        g.collectibles.shower(g.playerPos.clone(), 25);
        showToast('A glowing space rock! +30 Lab Points and a shower of bolts');
        g.audio.play('reward');
        this.end();
      }
    }
    // runaway train countdown
    if (this.active === 'train') {
      this.trainTime -= dt;
      if (Math.floor(this.trainTime) !== Math.floor(this.trainTime + dt)) setObjective({ id: 'event', icon: 'flag', text: `Runaway train! Get into the cab (front car) and pull the brake · ${Math.max(0, Math.ceil(this.trainTime))} s` });
      if (this.trainTime <= 0) {
        g.train.runaway = false;
        showToast('Phew, the train’s brakes kicked back in by themselves. Next time!');
        this.end();
      }
    }
    // the mech walks, stomps and swings
    const m = this.mech;
    if (m) {
      m.hitCooldown -= dt;
      if (m.down > 0) {
        m.down += dt;
        m.root.rotation.x = Math.min(Math.PI / 2, m.down * 1.5);
        if (m.down > 3) {
          g.scene.remove(m.root);
          this.mech = null;
          this.end();
        }
        return;
      }
      const to = new THREE.Vector3(m.target.x - m.pos.x, 0, m.target.z - m.pos.z);
      if (to.length() < 10) m.target.set((Math.random() - 0.5) * 300, 0, (Math.random() - 0.5) * 300);
      m.heading += Math.atan2(Math.sin(Math.atan2(to.x, to.z) - m.heading), Math.cos(Math.atan2(to.x, to.z) - m.heading)) * Math.min(1, dt);
      m.pos.addScaledVector(new THREE.Vector3(Math.sin(m.heading), 0, Math.cos(m.heading)), 4 * dt);
      m.pos.y = floorAt(m.pos.x, m.pos.z);
      m.phase += dt * 3;
      m.legs[0].rotation.x = Math.sin(m.phase) * 0.5;
      m.legs[1].rotation.x = -Math.sin(m.phase) * 0.5;
      m.arms[0].rotation.x = -Math.sin(m.phase) * 0.4;
      m.arms[1].rotation.x = Math.sin(m.phase) * 0.4;
      m.root.position.copy(m.pos);
      m.root.rotation.y = m.heading;
      m.stomp -= dt;
      if (m.stomp <= 0) {
        m.stomp = Math.PI / 3;
        const foot = m.pos.clone().add(new THREE.Vector3(Math.sin(m.heading) * 2, 0, Math.cos(m.heading) * 2));
        g.mechStomp(foot);
      }
    }
  }
}
