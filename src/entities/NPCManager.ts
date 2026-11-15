import * as THREE from 'three';
import { floorAt } from '../game/Terrain';
import { POLICE_BLOCK, WORLD, roadWidthX, roadWidthZ, type BuildingDoor, type Landmarks } from '../game/WorldMap';
import type { DialogueLine } from '../state/gameStore';
import { dampAngle, part } from './CharacterEntity';
import { Humanoid } from './Humanoid';

export type NpcId = 'grandma' | 'leo' | 'max' | 'gwen' | 'sam' | 'bruno' | 'cora';

/** A place an NPC spends part of the day. `inside` places hide them (they went indoors). */
interface Place {
  name: string;
  pos: THREE.Vector3;
  inside?: boolean;
  /** Wander this far around the spot while there. */
  roam?: number;
}

interface Npc {
  id: NpcId;
  name: string;
  body: Humanoid;
  pos: THREE.Vector3;
  heading: number;
  /** [hour, place] sorted by hour. */
  schedule: [number, Place][];
  current: Place | null;
  path: THREE.Vector3[];
  wait: number;
  speed: number;
  hop: number;
  lineIndex: number;
  /** Grandma's rocking chair while on the porch. */
  chair?: THREE.Group;
  /** The Godzilla costume's tail (sways). */
  tail?: THREE.Object3D;
  roarTimer: number;
  hidden: boolean;
  /** Playing tag: running away from this point (the Professor). */
  fleeFrom: THREE.Vector3 | null;
  fleeHome: THREE.Vector3 | null;
}

/** Everyday lines (rotated through on each chat). */
const DEFAULT_LINES: Record<NpcId, DialogueLine[][]> = {
  grandma: [
    [{ speaker: 'Grandma', text: 'Hello, son! Your mechanical lizard looks hungry. I do hope it isn’t eyeing my cookie jar again.' }],
    [{ speaker: 'Grandma', text: 'If you ever lose that contraption, come see your old mum. My crystal ball sees all sorts of things… mostly cookies.' }],
    [{ speaker: 'Grandma', text: 'Those red hydrants on the street corners refill your water tank, you know. So do the park fountains.' }],
    [{ speaker: 'Grandma', text: 'The boys call me Grandma, so now even you do. Thirty-six years old and still calling your mother Grandma!' }],
  ],
  leo: [
    [{ speaker: 'Leo', text: 'Dad! Can the Raptor turn into a car? Press V and it does?! So cool!' }],
    [{ speaker: 'Leo', text: 'The fast cars on the big ring road love to race. Drive up next to one in Race mode!' }],
    [{ speaker: 'Leo', text: 'I’m eleven, so I’m basically a scientist too. Wanna play tag? I’m super fast!' }],
  ],
  max: [
    [{ speaker: 'Max', text: 'Dad, Grandma says the Raptor has a sweet tooth. Like me!' }],
    [{ speaker: 'Max', text: 'If you see smoke, fly up high with 2 and spray it with the water cannon!' }],
    [{ speaker: 'Max', text: 'I’m nine and three quarters. I hid stars around the park. Bet you can’t find them all!' }],
  ],
  gwen: [
    [{ speaker: 'Gwen', text: 'RAWR! Oh, it’s you, honey. Do you like my costume? I think the tail really ties it together.' }],
    [{ speaker: 'Gwen', text: 'The kids at the park LOVE it when I stomp. The grown-ups… less so.' }],
    [{ speaker: 'Gwen', text: 'If you ever zap me with that Big Gun, I’m going to be a REAL kaiju. Don’t you dare. (Do it.)' }],
  ],
  sam: [
    [{ speaker: 'Sam', text: 'Morning, Professor! Café’s open. Your Raptor’s not allowed inside after the croissant incident.' }],
    [{ speaker: 'Sam', text: 'Fresh cookies at the café today. Not that you need them, with your mum next door.' }],
  ],
  bruno: [
    [{ speaker: 'Chief Bruno', text: 'Professor. Catch a thug, zap them to my holding cells with that Teleport Gun. Rough ’em up a bit first, they dodge otherwise.' }],
    [{ speaker: 'Chief Bruno', text: 'Your dinosaur parked on the pavement again. I’m letting it slide. Again.' }],
  ],
  cora: [
    [{ speaker: 'Cora', text: 'All aboard! Well, soon. The city train runs round the whole town on the viaduct.' }],
    [{ speaker: 'Cora', text: 'You can ride on the roof if you like. Hold on to your goggles!' }],
  ],
};

const SPEED: Record<NpcId, number> = { grandma: 1.1, leo: 2.6, max: 2.4, gwen: 1.6, sam: 1.3, bruno: 1.5, cora: 1.4 };

/**
 * The family and the named townsfolk: Grandma (the Professor's mum), his sons Leo (11) and Max (9),
 * his wife Gwen in her Godzilla costume, Sam from the café, Police Chief Bruno and Cora the train
 * conductor. Each follows a daily routine (home → work → park → home) on the game clock, walking
 * along the sidewalks; they turn to face the Professor, wave and chat.
 */
export class NPCManager {
  private readonly npcs: Npc[] = [];
  private readonly scene: THREE.Scene;
  /** Fired when Gwen roars (scares people nearby). */
  onRoar: ((pos: THREE.Vector3) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly landmarks: Landmarks,
    doors: readonly BuildingDoor[],
    /** Where the city train stops (the conductor's workplace). */
    station: THREE.Vector3,
  ) {
    this.scene = scene;
    const L = landmarks;
    const near = (x: number, z: number, kind?: BuildingDoor['kind']) =>
      doors.filter((d) => !kind || d.kind === kind).reduce((a, b) => (Math.hypot(b.pos.x - x, b.pos.z - z) < Math.hypot(a.pos.x - x, a.pos.z - z) ? b : a)).pos.clone();
    const V = (x: number, z: number) => new THREE.Vector3(x, floorAt(x, z), z);
    const places = {
      home: { name: 'home at the Lab', pos: V(L.lab.x + 8, L.lab.z + 4), roam: 6 },
      porch: { name: 'Grandma’s porch', pos: L.grandmaPorch.clone() },
      kitchen: { name: 'Grandma’s kitchen', pos: V(L.grandma.x - 2, L.grandma.z), inside: true },
      garden: { name: 'Grandma’s garden', pos: V(L.grandmaYard.x, L.grandmaYard.z), roam: 10 },
      yard: { name: 'Grandma’s yard', pos: V(L.grandmaYard.x, L.grandmaYard.z), roam: 14 },
      cafe: { name: 'the café', pos: near(90, 30, 'shop'), inside: true },
      cafeFront: { name: 'outside the café', pos: near(90, 30, 'shop'), roam: 3 },
      school: { name: 'school', pos: near(-90, 90, 'office'), inside: true },
      arcade: { name: 'the arcade', pos: near(150, -30, 'shop'), inside: true },
      park: { name: 'the sunken park', pos: V(30, -30), roam: 13 },
      downtown: { name: 'downtown', pos: V(0, 0), roam: 40 },
      police: { name: 'the police station', pos: V(POLICE_BLOCK.x, POLICE_BLOCK.z + 12), roam: 4 },
      station: { name: 'the train station', pos: station.clone(), roam: 6 },
      samHome: { name: 'home', pos: near(150, 90, 'house'), inside: true },
      brunoHome: { name: 'home', pos: near(-150, -30, 'house'), inside: true },
      coraHome: { name: 'home', pos: near(-30, 150, 'house'), inside: true },
    } satisfies Record<string, Place>;

    // Grandma (the Professor's mum): kitchen, porch, the café, her garden
    const grandma = new Humanoid({ skin: '#f2d0b5', shirt: '#b8a1e3', pants: '#6d597a', hair: '#e5e5e5', hairStyle: 'bun', dress: true, glasses: true, scale: 0.9 });
    const chair = new THREE.Group();
    chair.position.copy(L.grandmaPorch);
    chair.add(part(new THREE.BoxGeometry(0.8, 0.1, 0.7), '#8d5a4a', 0, 0.45, 0));
    chair.add(part(new THREE.BoxGeometry(0.8, 0.9, 0.1), '#8d5a4a', 0, 0.9, -0.35));
    chair.add(part(new THREE.BoxGeometry(0.9, 0.06, 0.06), '#5c3b30', 0, 0.02, 0.3));
    chair.add(part(new THREE.BoxGeometry(0.9, 0.06, 0.06), '#5c3b30', 0, 0.02, -0.3));
    scene.add(chair);
    this.add('grandma', 'Grandma', grandma, [[6, places.kitchen], [9, places.porch], [12, places.cafeFront], [14, places.garden], [17, places.porch], [21, places.kitchen]]).chair = chair;

    // The boys: school, park, arcade, Grandma's yard
    this.add('leo', 'Leo', new Humanoid({ skin: '#e0ac7e', shirt: '#4cc9f0', pants: '#264653', hair: '#5a3825', hairStyle: 'cap', hat: '#ef476f', scale: 0.68 }), [[7, places.home], [8, places.school], [15, places.park], [17, places.arcade], [18.5, places.yard], [21, places.home]]);
    this.add('max', 'Max', new Humanoid({ skin: '#e0ac7e', shirt: '#06d6a0', pants: '#3d405b', hair: '#5a3825', hairStyle: 'short', scale: 0.6 }), [[7, places.home], [8, places.school], [15, places.park], [17.5, places.yard], [21, places.home]]);

    // Gwen in her Godzilla costume
    const gwen = new Humanoid({ skin: '#f7d7c4', shirt: '#4caf50', pants: '#4caf50', hair: '#7b3f00', hairStyle: 'long', scale: 1 });
    const tail = this.dressAsKaiju(gwen);
    this.add('gwen', 'Gwen', gwen, [[7, places.home], [9, places.park], [12, places.cafeFront], [14, places.downtown], [17, places.yard], [21, places.home]]).tail = tail;

    this.add('sam', 'Sam', new Humanoid({ skin: '#c68642', shirt: '#ffffff', pants: '#264653', hair: '#111111', hairStyle: 'short', glasses: true }), [[7, places.cafeFront], [10, places.cafe], [15, places.cafeFront], [20, places.samHome]]);
    const bruno = new Humanoid({ skin: '#a86b3c', shirt: '#1d3557', pants: '#1d3557', hair: '#111111', hairStyle: 'cap', hat: '#1d3557', scale: 1.08 });
    bruno.head.add(part(new THREE.BoxGeometry(0.12, 0.08, 0.02), '#ffd166', 0, 0.33, 0.18, true)); // badge
    this.add('bruno', 'Chief Bruno', bruno, [[8, places.police], [12, places.cafeFront], [13, places.downtown], [16, places.police], [22, places.brunoHome]]);
    this.add('cora', 'Cora', new Humanoid({ skin: '#f2c9a0', shirt: '#9d0208', pants: '#2b2d42', hair: '#d4a373', hairStyle: 'cap', hat: '#2b2d42' }), [[6, places.station], [13, places.cafeFront], [14, places.station], [21, places.coraHome]]);
  }

  /** Turn a person into a Godzilla-costume wearer: green suit, dino hood with her face peeking out, spikes and a tail. */
  private dressAsKaiju(h: Humanoid): THREE.Object3D {
    const green = '#4caf50';
    // hood: the dino head sits on top, jaw below the face
    h.head.add(part(new THREE.BoxGeometry(0.46, 0.22, 0.5), green, 0, 0.36, 0.04));
    h.head.add(part(new THREE.BoxGeometry(0.4, 0.1, 0.2), green, 0, 0.38, 0.34)); // snout
    h.head.add(part(new THREE.BoxGeometry(0.42, 0.08, 0.3), green, 0, -0.1, 0.12)); // jaw
    for (const sx of [-0.12, 0.12]) h.head.add(part(new THREE.BoxGeometry(0.07, 0.07, 0.05), '#ffd166', sx, 0.44, 0.38, true)); // eyes
    for (let i = 0; i < 4; i++) h.head.add(part(new THREE.ConeGeometry(0.04, 0.08, 4).rotateX(Math.PI), '#ffffff', -0.15 + i * 0.1, 0.3, 0.42)); // teeth
    // back spikes
    const back = h.head.parent!;
    for (let i = 0; i < 4; i++) back.add(part(new THREE.ConeGeometry(0.09 - i * 0.012, 0.22, 4), '#81c784', 0, 0.62 - i * 0.18, -0.2));
    // tail
    const tail = new THREE.Group();
    tail.position.set(0, -0.05, -0.15);
    for (let i = 0; i < 5; i++) {
      const seg = part(new THREE.BoxGeometry(0.3 - i * 0.05, 0.26 - i * 0.04, 0.32), green, 0, -i * 0.06, -0.16 - i * 0.3);
      tail.add(seg);
    }
    back.add(tail);
    return tail;
  }

  private add(id: NpcId, name: string, body: Humanoid, schedule: [number, Place][]): Npc {
    this.scene.add(body.root);
    const place = this.placeAt(schedule, 9);
    const n: Npc = { id, name, body, pos: place.pos.clone(), heading: 0, schedule, current: place, path: [], wait: Math.random() * 2, speed: SPEED[id], hop: 0, lineIndex: Math.floor(Math.random() * 3), roarTimer: 8 + Math.random() * 10, hidden: !!place.inside, fleeFrom: null, fleeHome: null };
    body.root.visible = !n.hidden;
    this.npcs.push(n);
    return n;
  }

  private placeAt(schedule: [number, Place][], hour: number): Place {
    let p = schedule[schedule.length - 1][1];
    for (const [h, place] of schedule) if (hour >= h) p = place;
    return p;
  }

  /** The NPC the Professor is standing next to, if any (people indoors can't be talked to). */
  nearest(pos: THREE.Vector3, range = 2.8): Npc | null {
    let best: Npc | null = null;
    let bestD = range;
    for (const n of this.npcs) {
      if (n.hidden) continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d < bestD && Math.abs(n.pos.y - pos.y) < 2.5) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  /** Named people within `radius` (for gadgets). */
  near(pos: THREE.Vector3, radius: number): { id: NpcId; name: string; body: Humanoid }[] {
    return this.npcs.filter((n) => !n.hidden && Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < radius * Math.max(1, n.body.root.scale.x) && Math.abs(n.pos.y + 1 - pos.y) < 2.5 * n.body.root.scale.x).map((n) => ({ id: n.id, name: n.name, body: n.body }));
  }

  /** Tag: make someone run from `from` (null to stop). */
  flee(id: NpcId, from: THREE.Vector3 | null): void {
    const n = this.npcs.find((x) => x.id === id)!;
    n.fleeFrom = from;
    n.fleeHome = from ? n.pos.clone() : null;
    n.path = [];
  }

  /** Who is inside the building with this door (for interiors). */
  insideAt(door: THREE.Vector3): { id: NpcId; name: string }[] {
    return this.npcs.filter((n) => n.hidden && n.current && n.current.pos.distanceTo(door) < 2).map((n) => ({ id: n.id, name: n.name }));
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

  /** Where someone is heading / spending time now (for minimap and "where's Grandma?"). */
  whereabouts(id: NpcId): string {
    const n = this.npcs.find((x) => x.id === id)!;
    return n.current?.name ?? 'around town';
  }

  /** Sidewalk route between two points: out to the nearest road edge, along the grid, then in. */
  private route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const { roadMin, roadMax, roadStep } = WORLD;
    const snap = (v: number) => Math.max(roadMin, Math.min(roadMax, roadMin + Math.round((v - roadMin) / roadStep) * roadStep));
    const inTown = (p: THREE.Vector3) => Math.abs(p.x) < 280 && Math.abs(p.z) < 280;
    if (!inTown(from) || !inTown(to) || from.distanceTo(to) < 25) return [to.clone()];
    const rx = snap(from.x);
    const tz = snap(to.z);
    const sx = rx + Math.sign(from.x - rx || 1) * (roadWidthX(rx) / 2 - 0.8);
    const sz = tz + Math.sign(to.z - tz || 1) * (roadWidthZ(tz) / 2 - 0.8);
    const pts = [new THREE.Vector3(sx, 0, from.z), new THREE.Vector3(sx, 0, sz), new THREE.Vector3(to.x, 0, sz), to.clone()];
    for (const p of pts) p.y = floorAt(p.x, p.z);
    return pts;
  }

  update(dt: number, time: number, hour: number, professor: THREE.Vector3, talkingTo: NpcId | null): void {
    for (const n of this.npcs) {
      // follow the daily routine
      const want = this.placeAt(n.schedule, hour);
      if (want !== n.current) {
        n.current = want;
        if (n.hidden) {
          // come out of the building we were in
          n.hidden = false;
          n.body.root.visible = true;
        }
        n.path = this.route(n.pos, want.pos);
      }
      const dProf = Math.hypot(professor.x - n.pos.x, professor.z - n.pos.z);
      const attentive = !n.hidden && (dProf < 6 || talkingTo === n.id);
      let speed = 0;

      if (n.hidden) continue;

      // Tag: run away from the Professor, staying near where the game started
      if (n.fleeFrom) {
        const away = new THREE.Vector3(n.pos.x - n.fleeFrom.x, 0, n.pos.z - n.fleeFrom.z);
        const home = new THREE.Vector3(n.fleeHome!.x - n.pos.x, 0, n.fleeHome!.z - n.pos.z);
        const dir = away.normalize().add(home.multiplyScalar(home.length() > 30 ? 0.08 : 0.01)).normalize();
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(time * 1.7) * 0.6); // zig-zag
        const run = 6.2;
        n.pos.addScaledVector(dir, run * dt);
        n.pos.y = floorAt(n.pos.x, n.pos.z);
        n.heading = dampAngle(n.heading, Math.atan2(dir.x, dir.z), 8, dt);
        n.body.root.position.copy(n.pos);
        n.body.root.rotation.y = n.heading;
        n.body.panic(dt, run);
        continue;
      }

      // Grandma rocking on the porch
      const onPorch = n.chair && n.current?.name === 'Grandma’s porch' && !n.path.length;
      if (n.chair && onPorch) {
        n.chair.rotation.x = Math.sin(time * 1.4) * 0.06;
        n.pos.copy(this.landmarks.grandmaPorch).add(new THREE.Vector3(0, 0, 0.35));
        n.body.root.position.copy(n.pos);
        n.body.root.position.y += 0.05 + Math.sin(time * 1.4) * 0.02;
        n.heading = dampAngle(n.heading, attentive ? Math.atan2(professor.x - n.pos.x, professor.z - n.pos.z) : 0, 3, dt);
        n.body.root.rotation.y = n.heading;
        if (talkingTo === n.id || (attentive && dProf > 3)) n.body.wave(dt);
        else n.body.walk(dt, 0);
        continue;
      }

      if (attentive && !n.path.length) {
        n.heading = dampAngle(n.heading, Math.atan2(professor.x - n.pos.x, professor.z - n.pos.z), 5, dt);
      } else if (talkingTo !== n.id) {
        // walk the route; once there, mill about (or go indoors)
        if (!n.path.length && n.current?.roam) {
          n.wait -= dt;
          if (n.wait <= 0) {
            const r = n.current.roam;
            const p = n.current.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * r, 0, (Math.random() - 0.5) * 2 * r));
            p.y = floorAt(p.x, p.z);
            n.path = [p];
            n.wait = 1.5 + Math.random() * 4;
            if (n.id === 'leo' || n.id === 'max') n.hop = Math.random() < 0.4 ? 0.6 : 0;
          }
        }
        const tgt = n.path[0];
        if (tgt) {
          const d = new THREE.Vector3(tgt.x - n.pos.x, 0, tgt.z - n.pos.z);
          if (d.length() < 0.4) {
            n.path.shift();
            if (!n.path.length && n.current?.inside && n.current.pos.distanceTo(n.pos) < 1.5) {
              n.hidden = true; // went indoors
              n.body.root.visible = false;
              continue;
            }
          } else {
            const far = n.path.length > 1 ? 1.6 : 1;
            speed = n.speed * far;
            n.pos.addScaledVector(d.normalize(), speed * dt);
            n.pos.y = floorAt(n.pos.x, n.pos.z);
            n.heading = dampAngle(n.heading, Math.atan2(d.x, d.z), 6, dt);
          }
        }
      }

      // Gwen roars at people now and then
      if (n.id === 'gwen') {
        n.roarTimer -= dt;
        if (n.roarTimer <= 0) {
          n.roarTimer = 12 + Math.random() * 14;
          this.onRoar?.(n.pos.clone());
        }
        if (n.tail) n.tail.rotation.y = Math.sin(time * 3) * 0.35;
      }

      n.hop = Math.max(0, n.hop - dt);
      n.body.root.position.copy(n.pos);
      n.body.root.position.y += Math.sin((n.hop / 0.6) * Math.PI) * 0.35;
      n.body.root.rotation.y = n.heading;
      if (talkingTo === n.id) n.body.wave(dt);
      else if (n.id === 'gwen' && n.roarTimer > 11.2) n.body.panic(dt, 0); // arms up: RAWR
      else n.body.walk(dt, speed);
    }
  }
}
