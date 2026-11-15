import * as THREE from 'three';
import { dampAngle, part } from '../entities/CharacterEntity';
import { Humanoid } from '../entities/Humanoid';
import { floorAt } from '../game/Terrain';
import { WORLD } from '../game/WorldMap';
import { RoadAgent } from './RoadAgent';
import type { WaterSystem, WaterTarget } from './WaterSystem';

export type ThugState = 'roam' | 'chase' | 'flee' | 'stagger' | 'dazed' | 'flung' | 'costume';

export interface Thug {
  body: Humanoid;
  pos: THREE.Vector3;
  heading: number;
  agent: RoadAgent;
  state: ThugState;
  health: number;
  timer: number;
  punchCooldown: number;
  push: THREE.Vector3;
  target: WaterTarget;
  stars: THREE.Group;
  /** Size Gun scale (0.4 tiny … 2.4 giant). */
  size: number;
  anim: number;
}

const MAX_HEALTH = 3;
const LOOKS = ['#2b2d42', '#3d405b', '#6a040f', '#264653'];

/**
 * Street thugs causing mischief around town. They pick fights with the Professor when he's on foot
 * (and scatter from the Raptor). Knock one down to its last bit of health and it gets dazed (stars
 * spin over its head): that's when the Teleport Gun can zap it into the police holding cells.
 */
export class ThugSystem {
  readonly thugs: Thug[] = [];
  /** Professor got punched (knockback direction). */
  onPunch: ((dir: THREE.Vector3) => void) | null = null;
  private respawn: number[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly water: WaterSystem,
    count = 5,
  ) {
    for (let i = 0; i < count; i++) this.spawn(null);
  }

  private spawn(awayFrom: THREE.Vector3 | null): void {
    const agent = new RoadAgent(WORLD.roadWidth / 2 - 0.8, 'random');
    for (let t = 0; t < 20; t++) {
      agent.placeRandom();
      if (!awayFrom || agent.world.distanceTo(awayFrom) > 80) break;
    }
    const body = new Humanoid({ skin: ['#e0ac7e', '#c68642', '#f2c9a0', '#8d5524'][this.thugs.length % 4], shirt: LOOKS[this.thugs.length % LOOKS.length], pants: '#1b1b1b', hair: '#111111', hairStyle: 'cap', hat: '#111111' });
    body.head.add(part(new THREE.BoxGeometry(0.34, 0.08, 0.32), '#111111', 0, 0.12, 0.01)); // mask
    const stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = part(new THREE.OctahedronGeometry(0.1, 0), '#ffd166', Math.cos((i / 3) * Math.PI * 2) * 0.35, 0, Math.sin((i / 3) * Math.PI * 2) * 0.35, true);
      stars.add(s);
    }
    stars.position.y = 2.1;
    stars.visible = false;
    body.root.add(stars);
    this.scene.add(body.root);
    const t: Thug = {
      body,
      pos: agent.world.clone(),
      heading: agent.heading,
      agent,
      state: 'roam',
      health: MAX_HEALTH,
      timer: 0,
      punchCooldown: 0,
      push: new THREE.Vector3(),
      stars,
      size: 1,
      anim: 0,
      target: {
        position: agent.world.clone().setY(1.1),
        radius: 0.9,
        kind: 'thief',
        onHit: (power) => {
          // a good soaking knocks them about a bit
          t.timer = Math.max(t.timer, 0.4);
          if (Math.random() < power * 0.08) this.hurt(t, 1, new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
        },
      },
    };
    this.water.targets.add(t.target);
    this.thugs.push(t);
  }

  /** Thugs within reach, not already flying through the air or zapped. */
  near(pos: THREE.Vector3, radius: number): Thug[] {
    return this.thugs.filter((t) => t.state !== 'flung' && Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) < radius * Math.max(1, t.size));
  }

  /** Punched, kicked, splashed hard or blasted. */
  hurt(t: Thug, amount: number, dir: THREE.Vector3): void {
    if (t.state === 'flung' || t.state === 'costume') return;
    t.health = Math.max(0, t.health - amount / Math.max(0.6, t.size));
    t.push.addScaledVector(dir.clone().setY(0).normalize(), 2.5);
    if (t.health <= 1) {
      t.state = 'dazed';
      t.timer = 14;
      t.health = Math.min(t.health, 1);
    } else {
      t.state = 'stagger';
      t.timer = 0.5;
    }
  }

  /** Teleport Gun: only works on a dazed thug (healthy ones dodge). Returns true if zapped away. */
  zap(t: Thug, player: THREE.Vector3): boolean {
    if (t.state !== 'dazed') {
      // sidestep the beam
      const side = new THREE.Vector3(-(player.z - t.pos.z), 0, player.x - t.pos.x).normalize().multiplyScalar(Math.random() < 0.5 ? 2 : -2);
      t.push.add(side);
      return false;
    }
    this.remove(t);
    this.respawn.push(25);
    return true;
  }

  private remove(t: Thug): void {
    this.scene.remove(t.body.root);
    this.water.targets.delete(t.target);
    this.thugs.splice(this.thugs.indexOf(t), 1);
  }

  /** Hand to the FlingSystem; it lands dazed. */
  beginFling(t: Thug): THREE.Object3D {
    t.state = 'flung';
    return t.body.root;
  }

  endFling(t: Thug, landing: THREE.Vector3): void {
    t.pos.copy(landing).setY(floorAt(landing.x, landing.z, landing.y + 1));
    t.agent.placeNear(t.pos);
    t.push.subVectors(t.pos, t.agent.world).setY(0);
    t.body.root.rotation.set(0, t.heading, 0);
    t.state = 'dazed';
    t.health = Math.min(t.health, 1);
    t.timer = 14;
  }

  /** Transform Gun: a goofy animal costume for a while (no fighting in that). */
  costume(t: Thug, seconds: number): void {
    if (t.state === 'flung') return;
    t.state = 'costume';
    t.timer = seconds;
  }

  setSize(t: Thug, size: number): void {
    t.size = size;
    t.body.root.scale.setScalar(size);
  }

  update(dt: number, professor: THREE.Vector3, professorOnFoot: boolean, raptor: THREE.Vector3, playerAround: THREE.Vector3): void {
    this.respawn = this.respawn.map((r) => r - dt);
    while (this.respawn.length && this.respawn[0] <= 0) {
      this.respawn.shift();
      this.spawn(playerAround);
    }
    for (const t of this.thugs) {
      if (t.state === 'flung') continue;
      t.timer -= dt;
      t.punchCooldown -= dt;
      const toProf = new THREE.Vector3(professor.x - t.pos.x, 0, professor.z - t.pos.z);
      const dProf = toProf.length();
      const dRaptor = Math.hypot(raptor.x - t.pos.x, raptor.z - t.pos.z);
      let move = new THREE.Vector3();
      let speed = 0;

      if (t.state === 'dazed' || t.state === 'stagger' || t.state === 'costume') {
        if (t.timer <= 0) {
          if (t.state === 'dazed') t.health = 2;
          t.state = 'roam';
        }
        if (t.state === 'costume') {
          // hop about in a panic
          move = new THREE.Vector3(Math.sin(t.timer * 3 + t.heading), 0, Math.cos(t.timer * 2.3)).normalize();
          speed = 2.5;
        }
      } else if (dRaptor < 14 && !professorOnFoot) {
        t.state = 'flee';
      } else if (professorOnFoot && dProf < 14 && Math.abs(professor.y - t.pos.y) < 3) {
        t.state = 'chase';
      } else if (t.state !== 'roam' && (dProf > 22 || !professorOnFoot)) {
        t.state = dRaptor < 20 ? 'flee' : 'roam';
        if (t.state === 'roam') t.agent.placeNear(t.pos);
      }

      if (t.state === 'chase') {
        if (dProf > 1.3 * t.size) {
          move = toProf.clone().normalize();
          speed = 3.6;
        } else if (t.punchCooldown <= 0) {
          t.punchCooldown = 1.3;
          this.onPunch?.(toProf.clone().normalize());
        }
        t.heading = dampAngle(t.heading, Math.atan2(toProf.x, toProf.z), 8, dt);
      } else if (t.state === 'flee') {
        move = new THREE.Vector3(t.pos.x - raptor.x, 0, t.pos.z - raptor.z).normalize();
        speed = 5;
        if (dRaptor > 30) {
          t.state = 'roam';
          t.agent.placeNear(t.pos);
        }
      } else if (t.state === 'roam') {
        t.agent.advance(1.4 * dt);
        move = new THREE.Vector3(t.agent.world.x - t.pos.x, 0, t.agent.world.z - t.pos.z);
        speed = Math.min(3, move.length() * 4);
        if (move.lengthSq() > 1e-6) move.normalize();
      }

      t.pos.addScaledVector(move, speed * dt);
      t.pos.addScaledVector(t.push, Math.min(1, dt * 6));
      t.push.multiplyScalar(Math.exp(-6 * dt));
      t.pos.y = floorAt(t.pos.x, t.pos.z, t.pos.y + 1);
      if (speed > 0.3 && t.state !== 'chase') t.heading = dampAngle(t.heading, Math.atan2(move.x, move.z), 8, dt);
      t.anim = speed;
      t.target.position.set(t.pos.x, t.pos.y + 1.1 * t.size, t.pos.z);
    }
  }

  render(dt: number, time: number): void {
    for (const t of this.thugs) {
      if (t.state === 'flung') continue;
      t.body.root.position.copy(t.pos);
      t.body.root.rotation.y = t.heading;
      t.stars.visible = t.state === 'dazed';
      if (t.stars.visible) t.stars.rotation.y = time * 4;
      if (t.state === 'dazed') {
        t.body.soaked(dt);
        t.body.root.rotation.z = Math.sin(time * 2) * 0.1;
      } else {
        t.body.root.rotation.z = 0;
        if (t.state === 'costume' || t.state === 'flee') t.body.panic(dt, t.anim);
        else if (t.state === 'chase' && t.punchCooldown > 1.0) t.body.wave(dt); // swinging a punch
        else t.body.walk(dt, t.anim);
      }
    }
  }
}
