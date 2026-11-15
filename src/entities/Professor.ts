import * as THREE from 'three';
import type { InputManager } from '../game/InputManager';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import { SPACE_Y, WATER_Y, surfaceAt, waterDepth } from '../game/Terrain';
import { CharacterEntity, MAX_FALL, cameraRelative, dampAngle, part, type SteerOptions } from './CharacterEntity';

/** Parachute: sink rate and glide speed (m/s). */
const CHUTE_SINK = 3.5;
const CHUTE_GLIDE = 7;
/** Skydiving (parachute cut): belly-down glide and fall speed, just under meteor speed. */
const SKYDIVE_GLIDE = 13;
const SKYDIVE_FALL = 50;

/** Water deeper than this and the Professor swims. */
const SWIM_DEPTH = 1.3;

const RADIUS = 0.35;
const HALF_HEIGHT = 0.55;
const WALK = 5;
const SPRINT = 9;

/** The playable Professor, on foot. While riding, the mesh is parented to the Raptor's saddle. */
export class Professor extends CharacterEntity {
  riding = false;
  /** In deep water: floats at the surface and swims slowly. */
  swimming = false;
  /** How he sits while riding: on the Raptor, pedalling a bicycle, on a motorbike, or at the wheel of a car or boat. */
  ridePose: 'raptor' | 'bike' | 'motorbike' | 'car' | 'boat' = 'raptor';
  /** Pedalling speed (m/s of the bicycle) for the leg animation. */
  pedalSpeed = 0;
  private pedalPhase = 0;

  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly torso = new THREE.Group();
  /** Head group (Big Head cheat scales it). */
  readonly head = new THREE.Group();
  private walkPhase = 0;
  /** Nozzle of the handheld water blaster (in the right hand). */
  private readonly nozzle = new THREE.Object3D();
  /** Arm raise while spraying (set each frame by the engine). */
  aiming = false;
  /** Melee move being played (set by the GadgetSystem), with time since it started. */
  attack: { kind: 'jab' | 'hook' | 'spin' | 'finisher' | 'flykick' | 'slam' | 'bash' | 'zap'; t: number } | null = null;
  /** A short burst of speed (flying kick, shoulder bash). */
  dash: { vel: THREE.Vector3; time: number } | null = null;

  constructor(physics: PhysicsSystem, spawn: THREE.Vector3) {
    super(
      physics,
      physics.createCharacter({ position: spawn, radius: RADIUS, halfHeight: HALF_HEIGHT, maxStep: 0.4 }),
      // jumpSpeed 11.2 ≈ 2 m jump (h ≈ v² / 2g with g = 30, minus a little for the 60 Hz steps)
      { accel: 14, airAccel: 3, turnRate: 14, jumpSpeed: 11.2 },
    );
    this.buildModel();
    this.group.rotation.order = 'YXZ';
  }

  /**
   * LEGO-style: he walks the way you push on screen and turns to face it. `face` (when set) makes
   * him face that heading instead: the auto-aim target, or the camera direction while free-aiming.
   */
  update(dt: number, input: InputManager, opts: SteerOptions): void {
    if (this.riding) return;
    this.swimming = this.depth > SWIM_DEPTH;
    // Space in the air: cut the parachute away into a skydive; Space again re-opens it
    if (!this.grounded && !this.swimming && input.jump) {
      if (this.parachuting) {
        this.parachuting = false;
        this.skydiving = true;
      } else if (this.skydiving) {
        this.skydiving = false;
        this.parachuting = true;
      }
    }
    this.updateParachute(dt);
    const dir = cameraRelative(input.moveAxis(), opts.camYaw);
    const speed = this.parachuting ? CHUTE_GLIDE : this.skydiving ? SKYDIVE_GLIDE : (input.sprint ? SPRINT : WALK) * (this.swimming ? 0.4 : this.depth > 0.4 ? 0.7 : 1);
    let target = dir.multiplyScalar(speed);
    if (this.dash) {
      target = this.dash.vel.clone();
      this.velocity.x = target.x;
      this.velocity.z = target.z;
      this.dash.time -= dt;
      if (this.dash.time <= 0) this.dash = null;
    } else if (this.attack && this.grounded && this.attack.kind !== 'zap') target.multiplyScalar(0.2); // plant your feet to punch
    this.move(dt, target, input.jump && !this.swimming && !this.attack, opts.face === null && !this.dash);
    if (opts.face !== null) this.heading = dampAngle(this.heading, opts.face, 12, dt);
  }

  /** Floating down under a parachute. */
  parachuting = false;
  /** Cut the parachute away: spread-eagle freefall (it won't auto-open again until landing). */
  skydiving = false;
  private chuteOpen = 0;
  private readonly chute = new THREE.Group();

  /** Open the parachute now (getting off the Raptor high up). */
  deployParachute(): void {
    if (this.parachuting || this.grounded) return;
    this.parachuting = true;
  }

  /**
   * Opens by itself on any long fall once inside the atmosphere (so jumping off a space island is
   * safe), closes on landing. While open it brakes the fall to a gentle 3.5 m/s.
   */
  private updateParachute(dt: number): void {
    const height = this.pos.y - this.footOffset - surfaceAt(this.pos.x, this.pos.z, this.pos.y);
    if (!this.parachuting && !this.skydiving && !this.grounded && this.vy < -8 && height > 18 && this.pos.y < SPACE_Y - 10) this.parachuting = true;
    if (this.grounded || this.swimming) {
      this.parachuting = false;
      this.skydiving = false;
    }
    // brake hard (≈ 60 m/s²) down to the canopy's gentle sink rate rather than stopping dead
    // sink faster when high up (a re-entry from space shouldn't take minutes), gently near the ground
    const sink = Math.max(CHUTE_SINK, Math.min(22, height * 0.07));
    this.fallLimit = this.parachuting ? Math.max(sink, -this.vy - 60 * dt) : this.skydiving ? SKYDIVE_FALL : MAX_FALL;
  }

  /** Deep water: float with the head above the surface instead of walking on the sea floor. */
  protected floorCentre(x: number, z: number, feetY = Infinity): number {
    const base = super.floorCentre(x, z, feetY);
    return waterDepth(x, z) > SWIM_DEPTH ? Math.max(base, WATER_Y - 0.55) : base;
  }

  /** Stand still (during conversations) but keep gravity working. */
  idle(dt: number): void {
    if (this.riding) return;
    this.move(dt, new THREE.Vector3(), false);
  }

  /** Hop onto the Raptor: hide the capsule from physics and sit on the saddle. */
  mount(saddle: THREE.Object3D, pose: Professor['ridePose'] = 'raptor'): void {
    this.riding = true;
    this.ridePose = pose;
    this.group.visible = true;
    this.char.collider.setEnabled(false);
    this.velocity.set(0, 0, 0);
    saddle.add(this.group);
    // cars and boats: the seat marks the hips
    this.group.position.set(0, pose === 'car' || pose === 'boat' ? -0.95 : 0, 0);
    this.group.rotation.set(0, 0, 0);
  }

  /** Step off at a free spot (feet position). */
  dismount(scene: THREE.Scene, feetAt: THREE.Vector3, heading: number): void {
    this.riding = false;
    this.group.visible = true;
    scene.add(this.group);
    this.char.collider.setEnabled(true);
    this.teleport(new THREE.Vector3(feetAt.x, feetAt.y + this.footOffset, feetAt.z), heading);
  }

  /** While driving: keep his (disabled) capsule with the vehicle so distance checks still work. */
  follow(centre: THREE.Vector3): void {
    this.char.body.setTranslation(centre, false);
    this.pos.copy(centre);
    this.prev.copy(centre);
  }

  /** World position of the blaster nozzle (last rendered pose). */
  handWorld(): THREE.Vector3 {
    return this.nozzle.getWorldPosition(new THREE.Vector3());
  }

  get capsule(): { radius: number; halfHeight: number } {
    return { radius: RADIUS, halfHeight: HALF_HEIGHT };
  }

  private dive = 0;

  sync(alpha: number): void {
    if (this.riding) return;
    super.sync(alpha);
    // skydive: tip forward onto the belly (pivot near the hips)
    this.group.rotation.x = this.dive * 1.35;
    this.group.position.y += this.dive * 0.9;
  }

  /** Limb animation; call once per rendered frame. */
  animate(dt: number, time: number): void {
    if (this.riding && this.ridePose === 'bike') {
      // Pedalling: legs go round with the cranks, hands on the bars, leaning forward
      this.pedalPhase += dt * this.pedalSpeed * 1.3;
      const p = Math.sin(this.pedalPhase);
      this.legL.rotation.set(-0.9 + p * 0.45, 0, 0.08);
      this.legR.rotation.set(-0.9 - p * 0.45, 0, -0.08);
      this.armL.rotation.set(-1.25, 0, 0.12);
      this.armR.rotation.set(-1.25, 0, -0.12);
      this.torso.position.y = 0.95;
      this.torso.rotation.x = 0.25;
      return;
    }
    this.torso.rotation.x = this.riding && this.ridePose === 'motorbike' ? 0.2 : 0;
    // Parachute canopy opens/closes and sways
    this.chuteOpen += ((this.parachuting ? 1 : 0) - this.chuteOpen) * (1 - Math.exp(-(this.parachuting ? 6 : 10) * dt));
    this.chute.visible = this.chuteOpen > 0.02;
    this.chute.scale.set(this.chuteOpen, 0.3 + 0.7 * this.chuteOpen, this.chuteOpen);
    this.chute.rotation.set(Math.sin(time * 1.3) * 0.08, 0, Math.sin(time * 1.7) * 0.1);
    this.dive += ((this.skydiving && !this.riding ? 1 : 0) - this.dive) * (1 - Math.exp(-6 * dt));
    if (!this.riding && this.attack) {
      this.attack.t += dt;
      if (this.poseAttack(this.attack.kind, this.attack.t)) return;
      this.attack = null;
    }
    if (!this.riding && this.skydiving) {
      // LEGO-style spread-eagle: arms and legs out wide, flapping in the wind
      const f = Math.sin(time * 9) * 0.06;
      this.armL.rotation.set(-0.3, 0, 1.4 + f);
      this.armR.rotation.set(-0.3, 0, -1.4 - f);
      this.legL.rotation.set(0.25, 0, 0.45 - f);
      this.legR.rotation.set(0.25, 0, -0.45 + f);
      this.torso.rotation.x = -0.25;
      this.torso.position.y = 0.95;
      return;
    }
    if (!this.riding && this.parachuting) {
      // hanging from the lines: arms up holding the toggles, legs dangling
      this.armL.rotation.set(-2.7, 0, 0.35);
      this.armR.rotation.set(-2.7, 0, -0.35);
      this.legL.rotation.set(0.15 + Math.sin(time * 2) * 0.1, 0, 0.05);
      this.legR.rotation.set(0.15 - Math.sin(time * 2) * 0.1, 0, -0.05);
      this.torso.rotation.x = 0;
      this.torso.position.y = 0.95;
      return;
    }
    if (!this.riding && this.swimming) {
      // Front crawl: arms windmill, legs flutter, body leaning forward
      this.walkPhase += dt * (4 + this.horizontalSpeed * 2);
      const s = Math.sin(this.walkPhase);
      this.armL.rotation.set(-1.6 + s * 1.4, 0, 0.2);
      this.armR.rotation.set(-1.6 - s * 1.4, 0, -0.2);
      this.legL.rotation.set(0.3 + s * 0.35, 0, 0);
      this.legR.rotation.set(0.3 - s * 0.35, 0, 0);
      this.torso.rotation.x = 0.6;
      this.torso.position.y = 0.95;
      return;
    }
    if (this.riding && (this.ridePose === 'car' || this.ridePose === 'boat')) {
      // In the driver's seat: thighs forward, hands on the wheel
      this.legL.rotation.set(-1.5, 0, 0.05);
      this.legR.rotation.set(-1.5, 0, -0.05);
      this.armL.rotation.set(-1.15, 0, 0.15);
      this.armR.rotation.set(-1.15, 0, -0.15);
      this.torso.position.y = 0.95;
      return;
    }
    if (this.riding) {
      // Sitting astride: legs forward and apart, hands on the controls.
      this.legL.rotation.set(-1.3, 0, 0.35);
      this.legR.rotation.set(-1.3, 0, -0.35);
      this.armL.rotation.set(-1.0, 0, 0.1);
      this.armR.rotation.set(-1.0, 0, -0.1);
      this.torso.position.y = 0.95 + Math.sin(time * 6) * 0.01;
      return;
    }
    const speed = this.horizontalSpeed;
    this.walkPhase += dt * (3 + speed * 1.6);
    const swing = this.grounded ? Math.min(speed / SPRINT, 1) * 0.9 : 0.4;
    const s = Math.sin(this.walkPhase);
    this.legL.rotation.set(s * swing, 0, 0);
    this.legR.rotation.set(-s * swing, 0, 0);
    this.armL.rotation.set(-s * swing * 0.8, 0, 0.08);
    this.armR.rotation.set(s * swing * 0.8, 0, -0.08);
    if (!this.grounded) {
      this.armL.rotation.set(-2.4, 0, 0.3);
      this.armR.rotation.set(-2.4, 0, -0.3);
    }
    this.torso.position.y = 0.95 + Math.abs(Math.cos(this.walkPhase)) * swing * 0.06;
    if (this.aiming) this.armR.rotation.set(-1.5, 0, 0);
  }

  /** Punch/kick poses; returns false once the move is over. */
  private poseAttack(kind: NonNullable<Professor['attack']>['kind'], t: number): boolean {
    const k = Math.min(1, t / 0.12); // wind-up → strike
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.y = 0.95;
    switch (kind) {
      case 'jab':
        this.armR.rotation.set(-1.55 * k, 0, 0);
        this.armL.rotation.set(-0.6, 0, 0.3);
        return t < 0.28;
      case 'hook':
        this.armL.rotation.set(-1.4 * k, 0, 0.9 * k);
        this.armR.rotation.set(-0.6, 0, -0.3);
        this.torso.rotation.y = -0.5 * k;
        return t < 0.3;
      case 'spin':
        this.legR.rotation.set(-1.4 * k, 0, -0.5);
        this.torso.rotation.y = t * 22;
        this.armL.rotation.set(-0.3, 0, 1.2);
        this.armR.rotation.set(-0.3, 0, -1.2);
        return t < 0.4;
      case 'finisher':
        this.armL.rotation.set(-2.9 * k, 0, 0.2);
        this.armR.rotation.set(-2.9 * k, 0, -0.2);
        if (t > 0.15) {
          this.armL.rotation.set(-0.9, 0, 0.2);
          this.armR.rotation.set(-0.9, 0, -0.2);
        }
        return t < 0.45;
      case 'flykick':
        this.legR.rotation.set(-1.5, 0, 0);
        this.legL.rotation.set(0.6, 0, 0);
        this.armL.rotation.set(-0.4, 0, 1.1);
        this.armR.rotation.set(-0.4, 0, -1.1);
        return t < 0.5 && !this.grounded;
      case 'slam':
        this.armL.rotation.set(-3, 0, 0.1);
        this.armR.rotation.set(-3, 0, -0.1);
        this.legL.rotation.set(-0.4, 0, 0);
        this.legR.rotation.set(-0.4, 0, 0);
        return !this.grounded || t < 0.2;
      case 'bash':
        this.torso.rotation.x = 0.35;
        this.armL.rotation.set(-0.3, 0, 0.1);
        this.armR.rotation.set(-1.2, 0, -0.6);
        return t < 0.35;
      case 'zap':
        this.armR.rotation.set(-1.55, 0, 0);
        this.armL.rotation.set(-1.2, 0, 0.4);
        return t < 0.25;
    }
  }

  private buildModel(): void {
    const coat = '#f5f7fa';
    const pants = '#4a5568';
    const skin = '#f2c9a0';
    const hair = '#6b4226';

    // Legs pivot at the hip (y ≈ 0.95)
    for (const [leg, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      leg.position.set(x, 0.95, 0);
      leg.add(part(new THREE.BoxGeometry(0.18, 0.85, 0.2), pants, 0, -0.43, 0));
      leg.add(part(new THREE.BoxGeometry(0.2, 0.12, 0.32), '#2d3748', 0, -0.9, 0.05));
      this.group.add(leg);
    }

    this.torso.position.y = 0.95;
    this.group.add(this.torso);
    this.torso.add(part(new THREE.BoxGeometry(0.5, 0.62, 0.3), coat, 0, 0.32, 0));
    this.torso.add(part(new THREE.BoxGeometry(0.54, 0.3, 0.32), coat, 0, -0.02, 0)); // coat tails
    this.torso.add(part(new THREE.BoxGeometry(0.16, 0.5, 0.02), '#6fb1fc', 0, 0.34, 0.16)); // shirt
    this.torso.add(part(new THREE.BoxGeometry(0.05, 0.3, 0.02), '#e63946', 0, 0.38, 0.175)); // tie

    for (const [arm, x] of [[this.armL, -0.32], [this.armR, 0.32]] as const) {
      arm.position.set(x, 0.58, 0);
      arm.add(part(new THREE.BoxGeometry(0.13, 0.55, 0.15), coat, 0, -0.26, 0));
      arm.add(part(new THREE.BoxGeometry(0.11, 0.11, 0.11), skin, 0, -0.58, 0));
      this.torso.add(arm);
    }
    // Parachute: striped canopy with lines down to the shoulders (hidden until opened)
    {
      const colors = ['#e63946', '#ffffff', '#ffd166', '#ffffff'];
      for (let i = 0; i < 8; i++) {
        const seg = new THREE.Mesh(
          new THREE.SphereGeometry(2.6, 6, 6, (i / 8) * Math.PI * 2, Math.PI / 4, 0, Math.PI / 2.4),
          new THREE.MeshLambertMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, flatShading: true }),
        );
        seg.scale.set(1, 0.55, 1);
        seg.castShadow = true;
        this.chute.add(seg);
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const top = new THREE.Vector3(Math.cos(a) * 2.1, 0.4, Math.sin(a) * 2.1);
        const bottom = new THREE.Vector3(Math.cos(a) * 0.2, -2.4, Math.sin(a) * 0.15);
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, top.distanceTo(bottom), 4), new THREE.MeshBasicMaterial({ color: '#444444' }));
        line.position.copy(top).add(bottom).multiplyScalar(0.5);
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
        this.chute.add(line);
      }
      this.chute.position.y = 4.4;
      this.chute.visible = false;
      this.group.add(this.chute);
    }
    // Handheld water blaster in the right hand: orange body, blue tank, nozzle pointing forward
    this.armR.add(part(new THREE.BoxGeometry(0.12, 0.14, 0.34), '#ff9f1c', 0, -0.6, 0.12));
    this.armR.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), '#4cc9f0', 0, -0.5, 0.02));
    this.nozzle.position.set(0, -0.6, 0.32);
    this.armR.add(this.nozzle);

    const head = this.head;
    head.position.y = 0.82;
    this.torso.add(head);
    head.add(part(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin, 0, 0.1, 0));
    // 36 and full of ideas: messy brown hair sticking up, a little stubble
    head.add(part(new THREE.BoxGeometry(0.38, 0.12, 0.36), hair, 0, 0.31, -0.01));
    head.add(part(new THREE.IcosahedronGeometry(0.11, 0), hair, -0.1, 0.38, 0.06));
    head.add(part(new THREE.IcosahedronGeometry(0.12, 0), hair, 0.08, 0.4, -0.05));
    head.add(part(new THREE.IcosahedronGeometry(0.1, 0), hair, -0.02, 0.37, 0.13));
    head.add(part(new THREE.BoxGeometry(0.36, 0.2, 0.06), hair, 0, 0.2, -0.16));
    head.add(part(new THREE.BoxGeometry(0.06, 0.16, 0.3), hair, -0.18, 0.2, -0.02));
    head.add(part(new THREE.BoxGeometry(0.06, 0.16, 0.3), hair, 0.18, 0.2, -0.02));
    // Goggles pushed up on the forehead
    head.add(part(new THREE.BoxGeometry(0.36, 0.05, 0.34), '#3d405b', 0, 0.24, 0));
    head.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), '#ffd166', -0.08, 0.25, 0.17, true));
    head.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), '#ffd166', 0.08, 0.25, 0.17, true));
    head.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', -0.08, 0.12, 0.165));
    head.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', 0.08, 0.12, 0.165));
  }
}
