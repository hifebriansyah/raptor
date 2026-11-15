import * as THREE from 'three';
import { part } from '../entities/CharacterEntity';
import type { GameEngine } from '../game/GameEngine';
import { gameStore, showToast } from '../state/gameStore';

/** How big the Titan Raptor gets. */
export const GIANT_SCALE = 2.6;

interface Module {
  name: string;
  mesh: THREE.Group;
  /** Where it locks on (Raptor local space, before scaling). */
  slot: THREE.Vector3;
  from: THREE.Vector3;
  t: number;
  delay: number;
  locked: boolean;
}

/**
 * Hulkbuster Giant Mode: G (riding the Raptor) calls oversized armour down from the sky: a chest
 * rig, two heavy gauntlets, two leg boosters and back cannons fly in and lock on one by one, then the
 * Raptor grows into a towering Titan. Stomping makes shockwaves, X throws a giant punch, and nothing
 * on the road stands a chance. G again (or hopping off) sends the armour back to the Lab.
 */
export class GiantMode {
  private state: 'off' | 'assembling' | 'growing' | 'on' | 'shrinking' = 'off';
  private modules: Module[] = [];
  private grow = 0;
  private stompTimer = 0;
  private punchCooldown = 0;

  constructor(private readonly g: GameEngine) {}

  get active(): boolean {
    return this.state !== 'off';
  }

  /** Current visual scale of the Raptor. */
  get scale(): number {
    return 1 + (GIANT_SCALE - 1) * this.grow;
  }

  toggle(): void {
    const g = this.g;
    if (this.state === 'off') {
      if (!g.riding || g.interiors.inside) return;
      if (g.raptor.mode !== 'walk') g.raptor.setMode('walk');
      this.callArmour();
    } else if (this.state === 'on' || this.state === 'growing') {
      this.state = 'shrinking';
      showToast('Armour off! The pieces fly back to the Lab.');
    }
  }

  private callArmour(): void {
    const g = this.g;
    this.state = 'assembling';
    showToast('GIANT MODE! Calling the armour down from the Lab…');
    g.audio.play('alarm', 0.6);
    const metal = '#adb5bd';
    const accent = '#e63946';
    const make = (name: string, slot: THREE.Vector3, build: (m: THREE.Group) => void, i: number): Module => {
      const mesh = new THREE.Group();
      build(mesh);
      const a = Math.random() * Math.PI * 2;
      const from = new THREE.Vector3(Math.cos(a) * 40, 70 + i * 6, Math.sin(a) * 40);
      g.raptor.group.add(mesh);
      mesh.position.copy(from);
      return { name, mesh, slot, from, t: 0, delay: i * 0.35, locked: false };
    };
    this.modules = [
      make('chest rig', new THREE.Vector3(0, 2.4, 0.6), (m) => {
        m.add(part(new THREE.BoxGeometry(1.9, 1.4, 1.6), metal));
        m.add(part(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 12).rotateX(Math.PI / 2), '#5ef2ff', 0, 0.1, 0.82, true)); // arc reactor
        m.add(part(new THREE.BoxGeometry(2.0, 0.25, 1.65), accent, 0, 0.6, 0));
      }, 0),
      ...[-1, 1].map((s, k) =>
        make(`${s < 0 ? 'left' : 'right'} gauntlet`, new THREE.Vector3(s * 1.15, 1.9, 1.2), (m) => {
          m.add(part(new THREE.BoxGeometry(0.75, 0.75, 1.1), accent));
          m.add(part(new THREE.BoxGeometry(0.85, 0.3, 0.5), metal, 0, -0.2, 0.55));
        }, 1 + k),
      ),
      ...[-1, 1].map((s, k) =>
        make(`${s < 0 ? 'left' : 'right'} leg booster`, new THREE.Vector3(s * 0.55, 0.7, -0.2), (m) => {
          m.add(part(new THREE.BoxGeometry(0.7, 1.2, 0.9), metal));
          m.add(part(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 8), '#ff9f1c', 0, -0.7, -0.2, true));
        }, 3 + k),
      ),
      make('back cannons', new THREE.Vector3(0, 3.1, -0.8), (m) => {
        for (const s of [-0.5, 0.5]) m.add(part(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 10).rotateX(Math.PI / 2), '#495057', s, 0, 0.2));
        m.add(part(new THREE.BoxGeometry(1.5, 0.5, 0.8), accent, 0, -0.2, -0.3));
      }, 5),
    ];
  }

  /** Called every step while riding (or not). */
  update(dt: number): void {
    const g = this.g;
    if (this.state === 'off') return;
    if (!g.riding && this.state !== 'shrinking') this.state = 'shrinking';
    if (this.state === 'assembling') {
      let all = true;
      for (const m of this.modules) {
        if (m.locked) continue;
        all = false;
        if (m.delay > 0) {
          m.delay -= dt;
          continue;
        }
        m.t = Math.min(1, m.t + dt / 0.7);
        const e = 1 - Math.pow(1 - m.t, 3);
        m.mesh.position.lerpVectors(m.from, m.slot, e);
        m.mesh.rotation.set((1 - e) * 6, (1 - e) * 4, 0);
        if (m.t >= 1) {
          m.locked = true;
          const at = m.mesh.getWorldPosition(new THREE.Vector3());
          g.particles.sparks(at, 30, '#ffd166');
          g.audio.play('crash', 0.5);
          g.rig.shake(0.2);
        }
      }
      if (all) {
        this.state = 'growing';
        g.audio.play('transform');
      }
    } else if (this.state === 'growing') {
      this.grow = Math.min(1, this.grow + dt / 0.9);
      if (this.grow >= 1) {
        this.state = 'on';
        gameStore.setState({ giant: true });
        showToast('TITAN RAPTOR! Stomp around, X to punch, G to power down.');
        g.rig.shake(0.8);
        g.audio.play('stomp');
      }
    } else if (this.state === 'shrinking') {
      this.grow = Math.max(0, this.grow - dt / 0.6);
      for (const m of this.modules) {
        m.mesh.position.y += dt * (this.grow > 0 ? 2 : 60);
        m.mesh.rotation.y += dt * 4;
      }
      if (this.grow <= 0) {
        for (const m of this.modules) m.mesh.parent?.remove(m.mesh);
        this.modules = [];
        this.state = 'off';
        gameStore.setState({ giant: false });
      }
    } else if (this.state === 'on') {
      this.punchCooldown -= dt;
      // heavy footsteps make little shockwaves
      if (g.raptor.grounded && g.raptor.horizontalSpeed > 3) {
        this.stompTimer -= dt;
        if (this.stompTimer <= 0) {
          this.stompTimer = 0.55;
          const feet = g.raptor.feet;
          g.giantStomp(feet, 6, 0.5);
        }
      }
      if (g.input.melee && this.punchCooldown <= 0) {
        this.punchCooldown = 0.8;
        const r = g.raptor;
        const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
        g.giantStomp(r.feet.clone().addScaledVector(fwd, 6), 9, 1.6);
        g.audio.play('crash', 1);
      }
    }
    // keep the rider normal-sized and apply the growth
    g.raptor.group.scale.setScalar(this.scale);
    g.professor.group.scale.setScalar(g.riding && g.vehicle === null ? 1 / this.scale : 1);
  }
}
