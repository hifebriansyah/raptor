import * as THREE from 'three';
import { dampAngle } from '../entities/CharacterEntity';
import { Humanoid, randomLook } from '../entities/Humanoid';
import { WORLD } from '../game/WorldMap';
import { RoadAgent } from './RoadAgent';
import type { WaterSystem, WaterTarget } from './WaterSystem';

type Mood = 'stroll' | 'panic' | 'soaked' | 'wave' | 'cheer';

export interface Walker {
  agent: RoadAgent;
  body: Humanoid;
  speed: number;
  /** Sideways shove away from danger; decays back to the sidewalk. */
  push: THREE.Vector3;
  mood: Mood;
  moodTime: number;
  heading: number;
  pos: THREE.Vector3;
  target: WaterTarget;
  /** Short pause (looking at shop windows, chatting). */
  pause: number;
  /** Actual speed last step, drives the walk animation. */
  anim: number;
  /** Thrown through the air (the FlingSystem moves the body meanwhile). */
  flung: boolean;
}

/** Something people get out of the way of: the Raptor, or a vehicle the Professor drives. */
export interface Threat {
  pos: THREE.Vector3;
  speed: number;
  /** How close counts as "too close" (m). */
  radius: number;
}

export interface PedestrianContext {
  threats: Threat[];
  professorPos: THREE.Vector3;
  professorOnFoot: boolean;
  /** Solid bodies people are shoved aside by (the Professor, the Raptor, driven vehicles). */
  solids?: { pos: THREE.Vector3; radius: number }[];
}

/**
 * Townsfolk strolling the sidewalks. They stop to look around, wave at the Professor, scatter with
 * their arms up when the Raptor charges past, and shake themselves off when splashed.
 */
export class PedestrianSystem {
  private readonly walkers: Walker[] = [];
  /** Fired when someone gets soaked (for a giggle sound / comment). */
  onSoaked: ((pos: THREE.Vector3) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    water: WaterSystem,
    count = 40,
  ) {
    const sidewalk = WORLD.roadWidth / 2 - 0.8;
    this.water = water;
    this.scene = scene;
    for (let i = 0; i < count; i++) {
      const agent = new RoadAgent(Math.random() < 0.5 ? sidewalk : -sidewalk, 'random');
      agent.placeRandom();
      this.spawn(agent, agent.world.clone(), 'stroll');
    }
  }

  private readonly water: WaterSystem;
  private readonly scene: THREE.Scene;

  private spawn(agent: RoadAgent, at: THREE.Vector3, mood: Mood): Walker {
    {
      const body = new Humanoid(randomLook());
      this.scene.add(body.root);
      const w: Walker = {
        agent,
        body,
        speed: 1.1 + Math.random() * 0.7,
        push: new THREE.Vector3(),
        mood: 'stroll',
        moodTime: 0,
        heading: agent.heading,
        pos: at.clone(),
        pause: 0,
        anim: 0,
        flung: false,
        target: {
          position: new THREE.Vector3(),
          radius: 0.8,
          kind: 'person',
          onHit: () => {
            if (w.mood !== 'soaked') this.onSoaked?.(w.pos);
            w.mood = 'soaked';
            w.moodTime = 2.2;
          },
        },
      };
      this.water.targets.add(w.target);
      this.walkers.push(w);
      w.pos.copy(at);
      w.push.subVectors(at, agent.world);
      w.mood = mood;
      w.moodTime = mood === 'panic' ? 4 : 0;
      return w;
    }
  }

  /**
   * A driver who just had their car taken: they jump out at `at` and run off along the road the
   * car was on (agent centre + direction), then carry on as a normal pedestrian.
   */
  addFleeing(at: THREE.Vector3, roadCentre: THREE.Vector3, dir: { x: number; z: number }): void {
    const agent = new RoadAgent(WORLD.roadWidth / 2 - 0.8, 'random');
    agent.place(roadCentre.x, roadCentre.z, { x: -dir.x, z: -dir.z });
    this.spawn(agent, at, 'panic');
    // keep the crowd size steady: drop the farthest stroller
    if (this.walkers.length > this.baseCount) {
      const far = this.walkers.filter((w) => w.mood === 'stroll').reduce((a, b) => (a.pos.distanceToSquared(at) > b.pos.distanceToSquared(at) ? a : b));
      this.scene.remove(far.body.root);
      this.water.targets.delete(far.target);
      this.walkers.splice(this.walkers.indexOf(far), 1);
    }
  }

  private target = 40;

  private get baseCount(): number {
    return this.target;
  }

  /** Crowd density option: add strollers out of sight, or drop the farthest ones. */
  setCount(n: number, player: THREE.Vector3): void {
    this.target = n;
    const sidewalk = WORLD.roadWidth / 2 - 0.8;
    let guard = 0;
    while (this.walkers.length < n && guard++ < 200) {
      const agent = new RoadAgent(Math.random() < 0.5 ? sidewalk : -sidewalk, 'random');
      for (let t = 0; t < 10; t++) {
        agent.placeRandom();
        if (agent.world.distanceTo(player) > 60) break;
      }
      this.spawn(agent, agent.world.clone(), 'stroll');
    }
    while (this.walkers.length > n) {
      const idle = this.walkers.filter((w) => !w.flung);
      if (!idle.length) break;
      const far = idle.reduce((a, b) => (a.pos.distanceToSquared(player) > b.pos.distanceToSquared(player) ? a : b));
      this.scene.remove(far.body.root);
      this.water.targets.delete(far.target);
      this.walkers.splice(this.walkers.indexOf(far), 1);
    }
  }

  /** Obstacles for the traffic system (people standing in the road). */
  get obstacles(): { pos: THREE.Vector3; radius: number }[] {
    return this.walkers.map((w) => ({ pos: w.pos, radius: 0.5 }));
  }

  /** Make everyone near `pos` cheer (after a fire is put out, a race is won…). */
  /** People within `radius` of `pos`, not already flying. */
  near(pos: THREE.Vector3, radius: number): Walker[] {
    return this.walkers.filter((w) => !w.flung && Math.hypot(w.pos.x - pos.x, w.pos.z - pos.z) < radius);
  }

  /** Hand someone to the FlingSystem; returns their body to throw. */
  beginFling(w: Walker): THREE.Object3D {
    w.flung = true;
    w.body.panic(0, 0);
    return w.body.root;
  }

  /** Landed: dizzy for a moment, then wander back to the nearest sidewalk. */
  endFling(w: Walker, landing: THREE.Vector3): void {
    w.agent.placeNear(landing);
    w.pos.set(landing.x, 0, landing.z);
    w.push.subVectors(w.pos, w.agent.world).setY(0);
    w.mood = 'soaked';
    w.moodTime = 2.5;
    w.flung = false;
    w.body.root.rotation.set(0, w.heading, 0);
  }

  /** Everyone near `pos` runs away screaming (big Raptor landings, explosions…). */
  scare(pos: THREE.Vector3, radius: number): void {
    for (const w of this.walkers) {
      const away = new THREE.Vector3(w.pos.x - pos.x, 0, w.pos.z - pos.z);
      const d = away.length();
      if (d > radius) continue;
      w.mood = 'panic';
      w.moodTime = 3;
      w.push.addScaledVector(d > 0.01 ? away.divideScalar(d) : new THREE.Vector3(1, 0, 0), 3 * (1 - d / radius));
      if (w.push.length() > 7) w.push.setLength(7);
    }
  }

  /** Panic for a while (costumes, size changes, a kick up the bum). */
  frighten(w: Walker, seconds: number, push?: THREE.Vector3): void {
    w.mood = 'panic';
    w.moodTime = seconds;
    if (push) {
      w.push.add(push);
      if (w.push.length() > 7) w.push.setLength(7);
    }
  }

  /** Teleport someone a little way off (Teleport Gun on a passer-by). */
  relocate(w: Walker): void {
    w.agent.placeRandom();
    w.pos.copy(w.agent.world);
    w.push.set(0, 0, 0);
  }

  cheer(pos: THREE.Vector3, radius: number): void {
    for (const w of this.walkers) {
      if (w.pos.distanceTo(pos) < radius && w.mood === 'stroll') {
        w.mood = 'cheer';
        w.moodTime = 3;
      }
    }
  }

  update(dt: number, ctx: PedestrianContext): void {
    for (const w of this.walkers) {
      if (w.flung) continue;
      for (const t of ctx.threats) {
        if (t.speed < 6 || w.mood === 'soaked') continue;
        const away = new THREE.Vector3(w.pos.x - t.pos.x, 0, w.pos.z - t.pos.z);
        const d = away.length();
        if (d > t.radius) continue;
        w.mood = 'panic';
        w.moodTime = 2.5;
        if (d > 0.01) away.divideScalar(d);
        else away.set(1, 0, 0);
        w.push.addScaledVector(away, 7 * dt);
        if (w.push.length() > 7) w.push.setLength(7);
      }
      // Bumped into: shoved out of the way (never walked through)
      for (const b of ctx.solids ?? []) {
        let dx = w.pos.x - b.pos.x;
        let dz = w.pos.z - b.pos.z;
        let d = Math.hypot(dx, dz);
        const min = b.radius + 0.45;
        if (d >= min || Math.abs(w.pos.y - (b.pos.y - 1)) > 3) continue;
        if (d < 1e-3) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const k = (min - d) / d;
        w.pos.x += dx * k;
        w.pos.z += dz * k;
        w.push.x += dx * k;
        w.push.z += dz * k;
        if (w.push.length() > 7) w.push.setLength(7);
        if (w.mood === 'stroll' || w.mood === 'wave') {
          w.mood = 'panic';
          w.moodTime = 0.8;
        }
      }
      const dProf = Math.hypot(w.pos.x - ctx.professorPos.x, w.pos.z - ctx.professorPos.z);
      if (ctx.professorOnFoot && dProf < 3.5 && w.mood === 'stroll' && Math.random() < dt * 0.6) {
        w.mood = 'wave';
        w.moodTime = 2;
      }

      w.moodTime -= dt;
      if (w.moodTime <= 0 && w.mood !== 'stroll') {
        w.mood = 'stroll';
        w.body.resetTilt();
      }

      let speed = 0;
      if (w.mood === 'stroll') {
        if (w.pause > 0) w.pause -= dt;
        else {
          speed = w.speed;
          if (Math.random() < dt * 0.03) w.pause = 1.5 + Math.random() * 3;
        }
        // drift back onto the sidewalk
        const back = Math.min(w.push.length(), 1.2 * dt);
        if (back > 0) w.push.setLength(w.push.length() - back);
      } else if (w.mood === 'panic') {
        speed = 4.2;
      }
      w.agent.advance(speed * dt);

      const target = w.agent.world.clone().add(w.push);
      const prev = w.pos.clone();
      w.pos.lerp(target, 1 - Math.exp(-8 * dt));
      const moved = new THREE.Vector3().subVectors(w.pos, prev);
      const actual = moved.length() / Math.max(dt, 1e-4);
      if (w.mood === 'wave') {
        // face the Professor
        const want = Math.atan2(ctx.professorPos.x - w.pos.x, ctx.professorPos.z - w.pos.z);
        w.heading = dampAngle(w.heading, want, 6, dt);
      } else if (actual > 0.3) {
        w.heading = dampAngle(w.heading, Math.atan2(moved.x, moved.z), 8, dt);
      }
      w.target.position.set(w.pos.x, 1.1, w.pos.z);
      w.anim = actual;
    }
  }

  /** Animate; call once per rendered frame. */
  render(dt: number, camera: THREE.Camera): void {
    const cam = camera.position;
    for (const w of this.walkers) {
      if (w.flung) continue;
      // skip animating far-away people (they are tiny anyway)
      const far = w.pos.distanceToSquared(cam) > 160 * 160;
      w.body.root.visible = w.pos.distanceToSquared(cam) < 260 * 260;
      w.body.root.position.copy(w.pos);
      w.body.root.rotation.y = w.heading;
      if (far) continue;
      const v = w.anim;
      if (w.mood === 'panic') w.body.panic(dt, v);
      else if (w.mood === 'soaked') w.body.soaked(dt);
      else if (w.mood === 'wave') w.body.wave(dt);
      else if (w.mood === 'cheer') {
        w.body.wave(dt);
        w.body.root.position.y = Math.abs(Math.sin(performance.now() / 150)) * 0.3;
      } else w.body.walk(dt, v);
    }
  }
}
