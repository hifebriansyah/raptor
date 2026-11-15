import * as THREE from 'three';
import { part } from './CharacterEntity';

export interface HumanoidLook {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  /** 'short' | 'long' | 'bun' | 'cap' | 'bald' */
  hairStyle?: 'short' | 'long' | 'bun' | 'cap' | 'bald';
  hat?: string;
  /** Uniform scale; kids ≈ 0.65. */
  scale?: number;
  /** Long dress/skirt instead of trousers. */
  dress?: boolean;
  glasses?: boolean;
}

/**
 * A simple blocky person for pedestrians and NPCs (Grandma, the kids, thieves). Origin at the feet,
 * facing +z. Animate with walk(speed) / wave() / panic() each frame.
 */
export class Humanoid {
  /** Big Head cheat. */
  static bigHeads = false;
  readonly root = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  private phase = Math.random() * 10;

  constructor(look: HumanoidLook) {
    const s = look.scale ?? 1;
    this.root.scale.setScalar(s);
    const hip = 0.9;

    for (const [leg, x] of [[this.legL, -0.12], [this.legR, 0.12]] as const) {
      leg.position.set(x, hip, 0);
      leg.add(part(new THREE.BoxGeometry(0.17, 0.82, 0.19), look.dress ? look.skin : look.pants, 0, -0.41, 0));
      leg.add(part(new THREE.BoxGeometry(0.18, 0.1, 0.28), '#3b3b48', 0, -0.86, 0.04));
      this.root.add(leg);
    }

    this.body.position.y = hip;
    this.root.add(this.body);
    this.body.add(part(new THREE.BoxGeometry(0.46, 0.6, 0.27), look.shirt, 0, 0.3, 0));
    if (look.dress) this.body.add(part(new THREE.CylinderGeometry(0.26, 0.38, 0.6, 8), look.shirt, 0, -0.2, 0));
    else this.body.add(part(new THREE.BoxGeometry(0.46, 0.16, 0.28), look.pants, 0, -0.04, 0));

    for (const [arm, x] of [[this.armL, -0.3], [this.armR, 0.3]] as const) {
      arm.position.set(x, 0.56, 0);
      arm.add(part(new THREE.BoxGeometry(0.12, 0.52, 0.14), look.shirt, 0, -0.24, 0));
      arm.add(part(new THREE.BoxGeometry(0.1, 0.1, 0.1), look.skin, 0, -0.54, 0));
      this.body.add(arm);
    }

    this.head.position.y = 0.78;
    this.body.add(this.head);
    this.head.add(part(new THREE.BoxGeometry(0.32, 0.34, 0.3), look.skin, 0, 0.1, 0));
    this.head.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', -0.07, 0.12, 0.155));
    this.head.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', 0.07, 0.12, 0.155));
    if (look.glasses) this.head.add(part(new THREE.BoxGeometry(0.28, 0.06, 0.02), '#5a5a6a', 0, 0.12, 0.165));

    const style = look.hairStyle ?? 'short';
    if (style !== 'bald') {
      this.head.add(part(new THREE.BoxGeometry(0.34, 0.1, 0.32), look.hair, 0, 0.3, -0.01));
      this.head.add(part(new THREE.BoxGeometry(0.34, 0.24, 0.08), look.hair, 0, 0.17, -0.14));
    }
    if (style === 'long') this.head.add(part(new THREE.BoxGeometry(0.36, 0.42, 0.1), look.hair, 0, 0.02, -0.15));
    if (style === 'bun') this.head.add(part(new THREE.IcosahedronGeometry(0.11, 0), look.hair, 0, 0.36, -0.12));
    if (style === 'cap') {
      this.head.add(part(new THREE.BoxGeometry(0.36, 0.1, 0.34), look.hat ?? '#e63946', 0, 0.32, 0));
      this.head.add(part(new THREE.BoxGeometry(0.3, 0.04, 0.16), look.hat ?? '#e63946', 0, 0.28, 0.22));
    }
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  /** Walk/run cycle; speed in m/s (0 = idle breathing). */
  walk(dt: number, speed: number): void {
    this.head.scale.setScalar(Humanoid.bigHeads ? 1.9 : 1);
    this.phase += dt * (2 + speed * 2.4);
    const amp = Math.min(speed / 3, 1) * 0.8;
    const s = Math.sin(this.phase);
    this.legL.rotation.set(s * amp, 0, 0);
    this.legR.rotation.set(-s * amp, 0, 0);
    this.armL.rotation.set(-s * amp * 0.8, 0, 0.06);
    this.armR.rotation.set(s * amp * 0.8, 0, -0.06);
    this.body.position.y = 0.9 + Math.abs(Math.cos(this.phase)) * amp * 0.05 + (speed < 0.1 ? Math.sin(this.phase * 0.5) * 0.01 : 0);
    this.body.rotation.x = Math.min(speed / 6, 1) * 0.15;
  }

  /** Arms up, running scared. */
  panic(dt: number, speed: number): void {
    this.walk(dt, speed);
    const s = Math.sin(this.phase * 1.5);
    this.armL.rotation.set(-2.8 + s * 0.3, 0, 0.3);
    this.armR.rotation.set(-2.8 - s * 0.3, 0, -0.3);
  }

  /** Friendly wave with the right arm. */
  wave(dt: number): void {
    this.walk(dt, 0);
    this.phase += dt * 4;
    this.armR.rotation.set(-2.6, 0, -0.4 + Math.sin(this.phase * 2) * 0.4);
  }

  /** Shaking off water. */
  soaked(dt: number): void {
    this.walk(dt, 0);
    this.phase += dt * 20;
    this.body.rotation.z = Math.sin(this.phase) * 0.12;
    this.armL.rotation.set(-0.3, 0, 0.9);
    this.armR.rotation.set(-0.3, 0, -0.9);
  }

  /** Seated (driving): thighs forward, shins down, hands on the wheel. */
  sit(time = 0): void {
    this.legL.rotation.set(-1.5, 0, 0.05);
    this.legR.rotation.set(-1.5, 0, -0.05);
    const s = Math.sin(time * 1.3) * 0.04;
    this.armL.rotation.set(-1.15 + s, 0, 0.15);
    this.armR.rotation.set(-1.15 - s, 0, -0.15);
    this.body.position.y = 0.9;
    this.body.rotation.set(0, 0, 0);
  }

  resetTilt(): void {
    this.body.rotation.z = 0;
  }
}

const SKINS = ['#f2c9a0', '#e0ac7e', '#c68642', '#8d5524', '#f7d7c4', '#a86b3c'];
const SHIRTS = ['#e76f51', '#2a9d8f', '#e9c46a', '#457b9d', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ef476f', '#ffffff'];
const PANTS = ['#264653', '#3d405b', '#6d6875', '#1d3557', '#5c4033', '#2b2d42'];
const HAIRS = ['#2b1d14', '#5a3825', '#d4a373', '#111111', '#8d6e63', '#c0c0c0', '#e85d04'];
const STYLES: HumanoidLook['hairStyle'][] = ['short', 'long', 'bun', 'cap', 'short', 'bald'];

export function randomLook(rand: () => number = Math.random): HumanoidLook {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const style = pick(STYLES);
  return {
    skin: pick(SKINS),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    hair: pick(HAIRS),
    hairStyle: style,
    hat: pick(SHIRTS),
    dress: style === 'long' && rand() < 0.5,
    glasses: rand() < 0.2,
    scale: 0.92 + rand() * 0.16,
  };
}
