import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { NpcId } from '../entities/NPCManager';
import { floorAt } from '../game/Terrain';
import { addPoints, clearObjective, setObjective, showToast } from '../state/gameStore';

interface Ctx {
  scene: THREE.Scene;
  /** Where the player is (whatever they ride). */
  player(): THREE.Vector3;
  professorOnFoot(): boolean;
  npcPos(id: NpcId): THREE.Vector3;
  flee(id: NpcId, from: THREE.Vector3 | null): void;
  sound(name: 'reward' | 'gate' | 'lose'): void;
}

type Game = { kind: 'tag'; time: number } | { kind: 'stars'; time: number; stars: THREE.Group[]; found: number };

/**
 * The boys' challenges: Leo (11) plays tag ("catch me in 30 seconds!"), Max (9) hides stars around
 * where he is ("find all 6 in 75 seconds!").
 */
export class MiniGames {
  game: Game | null = null;
  private cooldown: Record<'leo' | 'max', number> = { leo: 0, max: 0 };

  constructor(private readonly ctx: Ctx) {}

  get active(): boolean {
    return this.game !== null;
  }

  /** Offered after chatting with Leo or Max. */
  canStart(id: NpcId): boolean {
    return (id === 'leo' || id === 'max') && !this.game && this.cooldown[id] <= 0;
  }

  start(id: NpcId): void {
    if (!this.canStart(id) || (id !== 'leo' && id !== 'max')) return;
    if (id === 'leo') {
      this.game = { kind: 'tag', time: 30 };
      this.ctx.flee('leo', this.ctx.player());
      setObjective({ id: 'minigame', icon: 'flag', text: 'Tag! Catch Leo (run with Shift) · 30 s' });
      showToast('Leo: "Bet you can\'t catch me, Dad!"');
    } else {
      const c = this.ctx.npcPos('max');
      const stars: THREE.Group[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.8;
        const r = 12 + Math.random() * 22;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const g = new THREE.Group();
        const star = part(new THREE.OctahedronGeometry(0.7, 0), '#ffd166', 0, 0, 0, true);
        g.add(star);
        g.position.set(x, floorAt(x, z) + 1.4, z);
        this.ctx.scene.add(g);
        stars.push(g);
      }
      this.game = { kind: 'stars', time: 75, stars, found: 0 };
      setObjective({ id: 'minigame', icon: 'flag', text: 'Find Max\'s 6 hidden stars · 75 s' });
      showToast('Max: "I hid six stars around here. GO!"');
    }
    this.cooldown[id] = 90;
  }

  update(dt: number): void {
    this.cooldown.leo -= dt;
    this.cooldown.max -= dt;
    const g = this.game;
    if (!g) return;
    g.time -= dt;
    const me = this.ctx.player();
    if (g.kind === 'tag') {
      this.ctx.flee('leo', me);
      const leo = this.ctx.npcPos('leo');
      if (this.ctx.professorOnFoot() && Math.hypot(leo.x - me.x, leo.z - me.z) < 1.6) {
        this.finish(true, 'Tag, you\'re it! Leo: "Aww, no fair, you\'re a grown-up!" +30 Lab Points', 30);
        return;
      }
      setObjective({ id: 'minigame', icon: 'flag', text: `Tag! Catch Leo (run with Shift) · ${Math.ceil(g.time)} s` });
      if (g.time <= 0) this.finish(false, 'Leo: "Too slow, Dad! Too sloooow!"', 0);
    } else {
      for (const s of g.stars.slice()) {
        s.rotation.y += dt * 2;
        s.position.y += Math.sin(performance.now() / 300) * 0.004;
        if (s.position.distanceTo(me) < 2.6) {
          this.ctx.scene.remove(s);
          g.stars.splice(g.stars.indexOf(s), 1);
          g.found++;
          this.ctx.sound('gate');
        }
      }
      setObjective({ id: 'minigame', icon: 'flag', text: `Max's stars: ${g.found}/6 · ${Math.ceil(g.time)} s` });
      if (g.found >= 6) this.finish(true, 'Max: "You found them ALL?! You\'re the best, Dad!" +40 Lab Points', 40);
      else if (g.time <= 0) this.finish(false, `Max: "Ha! You only found ${g.found}!" +${g.found * 5} Lab Points`, g.found * 5);
    }
  }

  private finish(won: boolean, text: string, points: number): void {
    const g = this.game!;
    if (g.kind === 'tag') this.ctx.flee('leo', null);
    else for (const s of g.stars) this.ctx.scene.remove(s);
    this.game = null;
    clearObjective('minigame');
    if (points) addPoints(points);
    showToast(text);
    this.ctx.sound(won ? 'reward' : 'lose');
  }
}
