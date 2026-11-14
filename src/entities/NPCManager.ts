import * as THREE from 'three';
import type { Landmarks } from '../game/WorldMap';
import type { DialogueLine } from '../state/gameStore';
import { dampAngle, part } from './CharacterEntity';
import { Humanoid } from './Humanoid';

export type NpcId = 'grandma' | 'leo' | 'mia';

interface Npc {
  id: NpcId;
  name: string;
  body: Humanoid;
  pos: THREE.Vector3;
  heading: number;
  target: THREE.Vector3 | null;
  wait: number;
  speed: number;
  hop: number;
  lineIndex: number;
}

/** Everyday lines when nothing special is going on (rotated through on each chat). */
const DEFAULT_LINES: Record<NpcId, DialogueLine[][]> = {
  grandma: [
    [{ speaker: 'Grandma', text: 'Hello, dear! Your mechanical lizard looks hungry. I do hope it isn’t eyeing my cookie jar again.' }],
    [{ speaker: 'Grandma', text: 'If you ever lose that contraption, come see me. My crystal ball sees all sorts of things… mostly cookies.' }],
    [{ speaker: 'Grandma', text: 'Those red hydrants on the street corners refill your water tank, you know. So do the park fountains.' }],
    [{ speaker: 'Grandma', text: 'Your Lab has a workbench, doesn’t it? Spend those Lab Points on something useful, like a cookie dispenser!' }],
  ],
  leo: [
    [{ speaker: 'Leo', text: 'Whoa, Professor! Can the Raptor turn into a car? Press 3 and it does?! So cool!' }],
    [{ speaker: 'Leo', text: 'The fast cars on the big ring road love to race. Drive up next to one in Race mode!' }],
    [{ speaker: 'Leo', text: 'There are ramps outside the ring road. If you boost you can fly sooo far!' }],
  ],
  mia: [
    [{ speaker: 'Mia', text: 'Grandma says your Raptor has a sweet tooth. Like me!' }],
    [{ speaker: 'Mia', text: 'If you see smoke, fly up high with 2 and spray it with the water cannon!' }],
    [{ speaker: 'Mia', text: 'I counted the hydrants. There are a lot. Like, a LOT.' }],
  ],
};

/**
 * Grandma rocking on her porch and her two grandchildren, Leo and Mia, playing in the front yard.
 * They turn to face the Professor, wave, and chat (lines come from the mystery/event systems first,
 * falling back to everyday chatter).
 */
export class NPCManager {
  private readonly npcs: Npc[] = [];
  private readonly chair = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private readonly landmarks: Landmarks,
  ) {
    const porch = landmarks.grandmaPorch;
    const grandma = new Humanoid({ skin: '#f2d0b5', shirt: '#b8a1e3', pants: '#6d597a', hair: '#e5e5e5', hairStyle: 'bun', dress: true, glasses: true, scale: 0.9 });
    // rocking chair
    this.chair.position.copy(porch);
    this.chair.add(part(new THREE.BoxGeometry(0.8, 0.1, 0.7), '#8d5a4a', 0, 0.45, 0));
    this.chair.add(part(new THREE.BoxGeometry(0.8, 0.9, 0.1), '#8d5a4a', 0, 0.9, -0.35));
    this.chair.add(part(new THREE.BoxGeometry(0.9, 0.06, 0.06), '#5c3b30', 0, 0.02, 0.3));
    this.chair.add(part(new THREE.BoxGeometry(0.9, 0.06, 0.06), '#5c3b30', 0, 0.02, -0.3));
    scene.add(this.chair);

    this.add(scene, 'grandma', 'Grandma', grandma, porch.clone().add(new THREE.Vector3(0, 0, 0.35)), 0);
    const yard = landmarks.grandmaYard;
    this.add(scene, 'leo', 'Leo', new Humanoid({ skin: '#e0ac7e', shirt: '#4cc9f0', pants: '#264653', hair: '#5a3825', hairStyle: 'cap', hat: '#ef476f', scale: 0.62 }), new THREE.Vector3(yard.x - 5, 0, yard.z), 0.9);
    this.add(scene, 'mia', 'Mia', new Humanoid({ skin: '#e0ac7e', shirt: '#c77dff', pants: '#3d405b', hair: '#2b1d14', hairStyle: 'long', dress: true, scale: 0.6 }), new THREE.Vector3(yard.x + 5, 0, yard.z), 1.0);
  }

  private add(scene: THREE.Scene, id: NpcId, name: string, body: Humanoid, pos: THREE.Vector3, speed: number): void {
    scene.add(body.root);
    this.npcs.push({ id, name, body, pos: pos.clone(), heading: 0, target: null, wait: Math.random() * 2, speed, hop: 0, lineIndex: Math.floor(Math.random() * 3) });
  }

  /** The NPC the Professor is standing next to, if any. */
  nearest(pos: THREE.Vector3, range = 2.8): Npc | null {
    let best: Npc | null = null;
    let bestD = range;
    for (const n of this.npcs) {
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d < bestD && Math.abs(n.pos.y - pos.y) < 2.5) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  /** Next everyday line for an NPC. */
  defaultLines(id: NpcId): DialogueLine[] {
    const n = this.npcs.find((x) => x.id === id)!;
    const pool = DEFAULT_LINES[id];
    const lines = pool[n.lineIndex % pool.length];
    n.lineIndex++;
    return lines;
  }

  position(id: NpcId): THREE.Vector3 {
    return this.npcs.find((x) => x.id === id)!.pos;
  }

  update(dt: number, time: number, professor: THREE.Vector3, talkingTo: NpcId | null): void {
    const yard = this.landmarks.grandmaYard;
    for (const n of this.npcs) {
      const dProf = Math.hypot(professor.x - n.pos.x, professor.z - n.pos.z);
      const attentive = dProf < 6 || talkingTo === n.id;
      let speed = 0;

      if (n.id === 'grandma') {
        // rock gently in the chair
        this.chair.rotation.x = Math.sin(time * 1.4) * 0.06;
        n.body.root.position.copy(n.pos);
        n.body.root.position.y += 0.05 + Math.sin(time * 1.4) * 0.02;
        const want = attentive ? Math.atan2(professor.x - n.pos.x, professor.z - n.pos.z) : 0;
        n.heading = dampAngle(n.heading, want, 3, dt);
        n.body.root.rotation.y = n.heading;
        if (talkingTo === n.id || (attentive && dProf > 3)) n.body.wave(dt);
        else n.body.walk(dt, 0);
        continue;
      }

      if (attentive) {
        n.target = null;
        n.heading = dampAngle(n.heading, Math.atan2(professor.x - n.pos.x, professor.z - n.pos.z), 5, dt);
      } else {
        n.wait -= dt;
        if (!n.target && n.wait <= 0) {
          n.target = new THREE.Vector3(yard.x + (Math.random() - 0.5) * 2 * yard.hx, 0, yard.z + (Math.random() - 0.5) * 2 * yard.hz);
        }
        if (n.target) {
          const d = new THREE.Vector3(n.target.x - n.pos.x, 0, n.target.z - n.pos.z);
          if (d.length() < 0.3) {
            n.target = null;
            n.wait = 1 + Math.random() * 3;
            if (Math.random() < 0.5) n.hop = 0.6; // jump for joy
          } else {
            speed = n.speed * 2.2;
            n.pos.addScaledVector(d.normalize(), speed * dt);
            n.heading = dampAngle(n.heading, Math.atan2(d.x, d.z), 6, dt);
          }
        }
      }
      n.hop = Math.max(0, n.hop - dt);
      n.body.root.position.copy(n.pos);
      n.body.root.position.y = Math.sin((n.hop / 0.6) * Math.PI) * 0.35;
      n.body.root.rotation.y = n.heading;
      if (talkingTo === n.id) n.body.wave(dt);
      else n.body.walk(dt, speed);
    }
  }
}
