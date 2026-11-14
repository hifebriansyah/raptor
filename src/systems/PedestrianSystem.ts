import * as THREE from 'three';
import { dampAngle } from '../entities/CharacterEntity';
import { Humanoid, randomLook } from '../entities/Humanoid';
import { WORLD } from '../game/WorldMap';
import { RoadAgent } from './RoadAgent';
import type { WaterSystem, WaterTarget } from './WaterSystem';

type Mood = 'stroll' | 'panic' | 'soaked' | 'wave' | 'cheer';

interface Walker {
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

  private get baseCount(): number {
    return 40;
  }

  /** Obstacles for the traffic system (people standing in the road). */
  get obstacles(): { pos: THREE.Vector3; radius: number }[] {
    return this.walkers.map((w) => ({ pos: w.pos, radius: 0.5 }));
  }

  /** Make everyone near `pos` cheer (after a fire is put out, a race is won…). */
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
