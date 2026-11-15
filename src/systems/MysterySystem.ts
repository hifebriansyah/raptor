import * as THREE from 'three';
import { dampAngle, part } from '../entities/CharacterEntity';
import { Humanoid } from '../entities/Humanoid';
import type { NpcId } from '../entities/NPCManager';
import type { GameEngine, Interaction } from '../game/GameEngine';
import type { Hideout } from '../game/WorldMap';
import { addPoints, clearObjective, gameStore, setObjective, showToast, type DialogueLine } from '../state/gameStore';
import type { DialogueController } from '../ui/DialogueBox';
import type { MinimapMarker } from '../ui/Minimap';
import type { WaterTarget } from './WaterSystem';

type CaseKind = 'stolen' | 'cookie';

interface Case {
  kind: CaseKind;
  hideout: Hideout | null;
  /** Centre of Grandma's vision zone (offset from the real spot so you still have to look). */
  zone: THREE.Vector3 | null;
  clueSpot: THREE.Vector3;
  clue: THREE.Group;
  inspected: boolean;
  askedGrandma: boolean;
  /** For the cookie case: someone told you to check the attic. */
  atticHint: boolean;
}

type ThiefState = 'guard' | 'chase' | 'flee' | 'flung';

interface Thief {
  body: Humanoid;
  pos: THREE.Vector3;
  home: THREE.Vector3;
  heading: number;
  state: ThiefState;
  soak: number;
  fleeTime: number;
  wander: THREE.Vector3 | null;
  target: WaterTarget;
  anim: number;
}

const ZONE_RADIUS = 45;
const THEFT_REWARD = 100;
const COOKIE_REWARD = 20;

/**
 * The "Mecha Raptor is missing!" mystery. When the Raptor is left alone and the Professor is far
 * away, either thieves steal it (branch 1: ask Grandma for a premonition, then soak the thieves at
 * the hideout) or it sneaks off to Grandma's attic for cookies (branch 2: the kids drop hints).
 */
export class MysterySystem {
  case: Case | null = null;
  private cooldown = 150;
  private checkTimer = 10;
  private readonly thieves: Thief[] = [];
  private crumbTimer = 0;
  onEvent: ((e: 'missing' | 'premonition' | 'caught' | 'soaked' | 'recovered' | 'cookies') => void) | null = null;

  constructor(
    private readonly game: GameEngine,
    private readonly dialogue: DialogueController,
  ) {}

  // ───────────────────────────────────────────── triggering

  update(dt: number): void {
    const g = this.game;
    const s = gameStore.getState();
    if (!this.case) {
      this.cooldown -= dt;
      this.checkTimer -= dt;
      if (this.cooldown <= 0 && this.checkTimer <= 0) {
        this.checkTimer = 12;
        const alone = (s.raptorStatus === 'parked' || s.raptorStatus === 'idle') && !g.riding;
        const far = g.worldPos.distanceTo(g.raptor.pos) > 70;
        if (alone && far && !g.race.active && !s.dialogue) {
          const craving = s.treats < 30;
          const dispenserGuard = s.raptorStatus === 'parked' && s.upgrades.dispenser >= 1;
          if (craving && !dispenserGuard && Math.random() < 0.6) this.begin('cookie');
          // thieves can strike anywhere the Raptor is left alone; the Lab alarm only guards the Lab
          else if (Math.random() < (s.raptorStatus === 'idle' ? 0.3 : 0.22 * (1 - 0.3 * s.upgrades.alarm))) this.begin('stolen');
          else if (s.upgrades.alarm > 0 && Math.random() < 0.15) showToast('Your Lab alarm scared off a would-be thief!');
        }
      }
      return;
    }
    this.updateThieves(dt);
    if (this.case.kind === 'cookie') {
      this.crumbTimer -= dt;
      if (this.crumbTimer <= 0) {
        this.crumbTimer = 0.6;
        g.particles.crumbs(g.raptor.localToWorld(new THREE.Vector3(0, 2.6, 1.8)), 3); // munch munch
      }
    }
  }

  /** Start a case right away (also used by the dev console). */
  begin(kind: CaseKind): void {
    const g = this.game;
    if (this.case || g.riding) return;
    const s = gameStore.getState();
    const wasAtLab = s.raptorStatus === 'parked';
    const from = g.raptor.feet.clone();
    const clue = this.makeClue(kind, from, wasAtLab);

    let hideout: Hideout | null = null;
    let zone: THREE.Vector3 | null = null;
    if (kind === 'stolen') {
      hideout = g.world.hideouts[Math.floor(Math.random() * g.world.hideouts.length)];
      const a = Math.random() * Math.PI * 2;
      const off = 10 + Math.random() * 20;
      zone = hideout.raptorSpot.clone().add(new THREE.Vector3(Math.cos(a) * off, 0, Math.sin(a) * off));
      g.raptor.teleport(hideout.raptorSpot.clone().setY(g.raptor.footOffset), Math.random() * Math.PI * 2);
      for (const spot of hideout.guardSpots) this.spawnThief(spot);
      gameStore.setState({ raptorStatus: 'stolen' });
    } else {
      const spot = g.world.landmarks.atticSpot;
      g.raptor.teleport(spot.clone().setY(spot.y + g.raptor.footOffset), Math.PI / 2);
      gameStore.setState({ raptorStatus: 'attic' });
    }
    g.raptor.resetToWalk();
    this.case = { kind, hideout, zone, clueSpot: from, clue, inspected: false, askedGrandma: false, atticHint: false };
    showToast(wasAtLab ? 'Mecha Raptor is missing from the Lab!' : 'Mecha Raptor is missing from where you left it!');
    setObjective({ id: 'mystery', icon: 'search', text: 'Find the Mecha Raptor. Check where you left it, or ask Grandma' });
    this.onEvent?.('missing');
  }

  /** Footprints + a broken lock (thieves) or a crumb trail (cookies) where the Raptor was. */
  private makeClue(kind: CaseKind, at: THREE.Vector3, atLab: boolean): THREE.Group {
    const g = new THREE.Group();
    const grandma = this.game.world.landmarks.grandma;
    const dir = kind === 'cookie' ? new THREE.Vector3(grandma.x - at.x, 0, grandma.z - at.z).normalize() : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < 14; i++) {
      const p = at.clone().addScaledVector(dir, 1.5 + i * 1.1).addScaledVector(side, (i % 2 ? 0.35 : -0.35) * (kind === 'stolen' ? 1 : 0.2));
      const mark =
        kind === 'stolen'
          ? new THREE.Mesh(new THREE.CircleGeometry(0.18, 8).scale(1, 1.8, 1), new THREE.MeshBasicMaterial({ color: '#5c4033', transparent: true, opacity: 0.8 }))
          : new THREE.Mesh(new THREE.CircleGeometry(0.09 + Math.random() * 0.06, 6), new THREE.MeshBasicMaterial({ color: '#c98b4a' }));
      mark.rotation.x = -Math.PI / 2;
      mark.rotation.z = -Math.atan2(dir.x, dir.z);
      mark.position.set(p.x, 0.05, p.z);
      g.add(mark);
    }
    if (kind === 'stolen' && atLab) {
      // snapped padlock on the pad
      const lock = new THREE.Group();
      lock.add(part(new THREE.BoxGeometry(0.4, 0.35, 0.15), '#ffd166', 0, 0.18, 0));
      const shackle = part(new THREE.TorusGeometry(0.14, 0.04, 6, 10, Math.PI), '#adb5bd', 0.08, 0.35, 0);
      shackle.rotation.z = -0.6;
      lock.add(shackle);
      lock.position.set(at.x + 1, 0, at.z);
      lock.rotation.z = 1.4;
      g.add(lock);
    }
    this.game.scene.add(g);
    return g;
  }

  private spawnThief(spot: THREE.Vector3): void {
    const body = new Humanoid({ skin: '#e0ac7e', shirt: '#2b2d42', pants: '#1b1b1b', hair: '#111111', hairStyle: 'cap', hat: '#111111', scale: 1 });
    body.head.add(part(new THREE.BoxGeometry(0.34, 0.1, 0.32), '#111111', 0, 0.12, 0.01)); // bandit mask
    this.game.scene.add(body.root);
    const t: Thief = {
      body,
      pos: spot.clone(),
      home: spot.clone(),
      heading: Math.random() * Math.PI * 2,
      state: 'guard',
      soak: 0,
      fleeTime: 0,
      wander: null,
      anim: 0,
      target: {
        position: spot.clone().setY(1.1),
        radius: 0.9,
        kind: 'thief',
        onHit: (power) => {
          if (t.state === 'flee') return;
          t.soak += power;
          if (t.soak >= 1.2) {
            t.state = 'flee';
            t.fleeTime = 4;
            this.game.water.targets.delete(t.target);
            showToast(this.thieves.filter((x) => x.state !== 'flee').length ? 'Splash! One thief runs off dripping!' : 'Splash! The last thief flees. Grab your Raptor!');
            this.onEvent?.('soaked');
          }
        },
      },
    };
    this.game.water.targets.add(t.target);
    this.thieves.push(t);
  }

  /** Thieves within `radius` of `pos` (for the turbo ram / landing blast). */
  thievesNear(pos: THREE.Vector3, radius: number): { pos: THREE.Vector3; body: THREE.Object3D; thief: unknown }[] {
    return this.thieves
      .filter((t) => t.state !== 'flung' && Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) < radius)
      .map((t) => ({ pos: t.pos, body: t.body.root, thief: t }));
  }

  /** A thief got launched: out of the fight. Returns a callback for when they land. */
  flingThief(thief: unknown): (landing: THREE.Vector3) => void {
    const t = thief as Thief;
    t.state = 'flung';
    this.game.water.targets.delete(t.target);
    const left = this.thieves.filter((x) => x.state !== 'flee' && x.state !== 'flung').length;
    showToast(left ? 'WHAM! A thief goes flying!' : 'WHAM! The last thief goes flying. Grab your Raptor!');
    this.onEvent?.('soaked');
    return (landing) => {
      // they land, pick themselves up and run off for good
      t.pos.copy(landing).setY(0);
      t.state = 'flee';
      t.fleeTime = 4;
    };
  }

  private updateThieves(dt: number): void {
    const g = this.game;
    const prof = g.professor.pos;
    const onFoot = g.onFoot;
    for (const t of this.thieves.slice()) {
      if (t.state === 'flung') continue;
      const toProf = new THREE.Vector3(prof.x - t.pos.x, 0, prof.z - t.pos.z);
      const dProf = toProf.length();
      let move = new THREE.Vector3();
      let speed = 0;

      if (t.state === 'flee') {
        t.fleeTime -= dt;
        speed = 7;
        move = toProf.clone().multiplyScalar(-1).normalize();
        if (t.fleeTime <= 0) {
          g.scene.remove(t.body.root);
          this.thieves.splice(this.thieves.indexOf(t), 1);
          continue;
        }
      } else if (t.state === 'guard') {
        if (onFoot && dProf < 13) t.state = 'chase';
        if (!t.wander || t.pos.distanceTo(t.wander) < 0.4) {
          const a = Math.random() * Math.PI * 2;
          t.wander = t.home.clone().add(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3));
        }
        move = new THREE.Vector3(t.wander.x - t.pos.x, 0, t.wander.z - t.pos.z).normalize();
        speed = 1.2;
      } else if (t.state === 'chase') {
        if (!onFoot || dProf > 24 || t.pos.distanceTo(t.home) > 30) t.state = 'guard';
        move = toProf.clone().normalize();
        speed = 4.3;
        if (dProf < 1.2) this.caught();
      }
      t.pos.addScaledVector(move, speed * dt);
      t.anim = speed;
      if (speed > 0.1) t.heading = dampAngle(t.heading, Math.atan2(move.x, move.z), 8, dt);
      t.target.position.set(t.pos.x, 1.1, t.pos.z);
    }
  }

  /** A thief grabbed the Professor: shoo him out of the hideout. */
  private caught(): void {
    const g = this.game;
    const c = this.case;
    if (!c?.hideout) return;
    const centre = c.hideout.raptorSpot;
    const away = new THREE.Vector3(g.professor.pos.x - centre.x, 0, g.professor.pos.z - centre.z);
    if (away.lengthSq() < 0.01) away.set(1, 0, 0);
    away.normalize();
    const { radius, halfHeight } = g.professor.capsule;
    for (let d = 30; d < 60; d += 5) {
      const spot = centre.clone().addScaledVector(away, d).setY(g.professor.footOffset);
      if (g.physics.isFree(spot, radius, halfHeight)) {
        g.professor.teleport(spot, Math.atan2(-away.x, -away.z));
        break;
      }
    }
    for (const t of this.thieves) if (t.state === 'chase') t.state = 'guard';
    showToast('The thieves shooed you away! Soak them with your water blaster (hold click)');
    this.onEvent?.('caught');
  }

  // ───────────────────────────────────────────── interactions & dialogue

  interaction(): Interaction | null {
    const g = this.game;
    const c = this.case;
    if (!c || !g.onFoot) return null;
    const prof = g.professor.feet;

    if (!c.inspected && Math.hypot(prof.x - c.clueSpot.x, prof.z - c.clueSpot.z) < 4) {
      return { prompt: 'Inspect the empty spot', priority: 1, run: () => this.inspect() };
    }
    if (g.nearRaptor()) {
      if (c.kind === 'stolen') {
        const guarded = this.thieves.some((t) => t.state !== 'flee' && t.pos.distanceTo(g.raptor.feet) < 7);
        if (guarded) return { prompt: 'Too many thieves around! Soak them first', priority: 1, run: () => showToast('Soak the thieves first: hold click to spray') };
        return { prompt: 'Reclaim the Mecha Raptor', priority: 0, run: () => this.resolve() };
      }
      return { prompt: 'Wake the Raptor (it’s full of cookies)', priority: 0, run: () => this.resolve() };
    }
    return null;
  }

  private inspect(): void {
    const c = this.case!;
    c.inspected = true;
    const lines: DialogueLine[] =
      c.kind === 'stolen'
        ? [
            { speaker: 'Professor', text: 'Muddy footprints… and a snapped padlock! Someone has pinched my Raptor!' },
            { speaker: 'Professor', text: 'Grandma always says her crystal ball sees everything. Off to Grandma’s house!' },
          ]
        : [
            { speaker: 'Professor', text: 'Big claw scratches heading off down the road… and are those cookie crumbs?' },
            { speaker: 'Professor', text: 'Hmm. Thieves don’t usually snack. Grandma’s house is that way…' },
          ];
    this.dialogue.start(lines);
  }

  /** Lines an NPC says during a case, or null for everyday chatter. */
  linesFor(id: NpcId): { lines: DialogueLine[]; after?: () => void } | null {
    const c = this.case;
    if (!c) return null;
    if (id !== 'grandma' && id !== 'leo' && id !== 'max') {
      return { lines: [{ speaker: id === 'gwen' ? 'Gwen' : 'Townsfolk', text: c.kind === 'stolen' ? 'Your Raptor’s gone? Go and ask your mum, she sees everything in that crystal ball of hers!' : 'Lost the Raptor? I heard munching from Grandma’s place…' }] };
    }
    if (c.kind === 'stolen') {
      if (id === 'grandma') {
        if (!c.askedGrandma) {
          return {
            lines: [
              { speaker: 'Grandma', text: 'Your metal dinosaur is gone? Oh my. Sit down, dear, let me look into my crystal ball…' },
              { speaker: 'Grandma', text: 'Mmmmm… the mists are swirling… I see something…' },
            ],
            after: () => this.showPremonition(),
          };
        }
        return { lines: [{ speaker: 'Grandma', text: `The vision showed ${c.hideout!.name}. Be careful, dear. Those ruffians hate getting wet!` }] };
      }
      return {
        lines: [id === 'leo' ? { speaker: 'Leo', text: 'A shady van zoomed past with a giant tarp on it! Ask Grandma, she sees EVERYTHING.' } : { speaker: 'Max', text: 'Thieves hate water! Squirt them with your blaster, Dad!' }],
      };
    }
    // cookie case
    if (id === 'grandma') {
      return {
        lines: [
          { speaker: 'Grandma', text: 'Thieves? Let me see… hmm, my crystal ball shows no thieves at all. Just… crumbs.' },
          { speaker: 'Grandma', text: 'Now that you mention it, my cookie jar is empty again. And something upstairs is purring like a lawnmower.' },
        ],
        after: () => this.atticHint(),
      };
    }
    return {
      lines: [id === 'leo' ? { speaker: 'Leo', text: 'I heard metallic crunching upstairs! CRUNCH CRUNCH!' } : { speaker: 'Max', text: 'Did you check the attic, Dad? Go in the front door and up, up, UP to the top floor!' }],
      after: () => this.atticHint(),
    };
  }

  private atticHint(): void {
    const c = this.case;
    if (!c || c.atticHint) return;
    c.atticHint = true;
    setObjective({ id: 'mystery', icon: 'cookie', text: 'Check Grandma’s attic: E at her front door, then up to the 3rd floor' });
  }

  private showPremonition(): void {
    const c = this.case!;
    c.askedGrandma = true;
    gameStore.setState({ premonition: { x: c.zone!.x, z: c.zone!.z, place: c.hideout!.name } });
    this.onEvent?.('premonition');
  }

  /** Called when the premonition overlay is closed. */
  premonitionClosed(): void {
    const c = this.case;
    if (!c?.hideout) return;
    setObjective({ id: 'mystery', icon: 'eye', text: `Rescue the Raptor near ${c.hideout.name}. Soak the thieves with your blaster` });
  }

  private resolve(): void {
    const g = this.game;
    const c = this.case!;
    g.scene.remove(c.clue);
    for (const t of this.thieves) {
      if (t.state === 'flung') continue;
      t.state = 'flee';
      t.fleeTime = 4;
      g.water.targets.delete(t.target);
    }
    g.mount();
    // found in Grandma's attic: ride straight out into her front yard
    if (g.interiors.inside) g.leaveInterior(false);
    if (c.kind === 'stolen') {
      addPoints(THEFT_REWARD);
      showToast(`Raptor rescued! +${THEFT_REWARD} Lab Points`);
      this.onEvent?.('recovered');
    } else {
      addPoints(COOKIE_REWARD);
      gameStore.setState({ treats: 100, sugarRush: 60 });
      showToast(`Found it, stuffed with cookies! SUGAR RUSH: faster for 60 s. +${COOKIE_REWARD} Lab Points`);
      this.onEvent?.('cookies');
    }
    clearObjective('mystery');
    gameStore.setState({ premonition: null });
    this.case = null;
    this.cooldown = 240;
  }

  /** Per rendered frame: animate thieves. */
  render(dt: number): void {
    for (const t of this.thieves) {
      if (t.state === 'flung') continue;
      t.body.root.position.copy(t.pos);
      t.body.root.rotation.y = t.heading;
      if (t.state === 'flee') t.body.panic(dt, t.anim);
      else t.body.walk(dt, t.anim);
    }
  }

  markers(): MinimapMarker[] {
    const c = this.case;
    if (!c) return [];
    const out: MinimapMarker[] = [];
    if (c.zone && c.askedGrandma) out.push({ x: c.zone.x, z: c.zone.z, color: '#9d4edd', label: '?', zone: ZONE_RADIUS, pinToEdge: true });
    if (!c.inspected) out.push({ x: c.clueSpot.x, z: c.clueSpot.z, color: '#6d6875', label: '!', pinToEdge: false });
    return out;
  }
}
