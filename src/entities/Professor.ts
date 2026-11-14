import * as THREE from 'three';
import type { InputManager } from '../game/InputManager';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import { WATER_Y, waterDepth } from '../game/Terrain';
import { CharacterEntity, cameraRelative, dampAngle, part, type SteerOptions } from './CharacterEntity';

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
  /** How he sits while riding: on the Raptor, pedalling a bicycle, on a motorbike, or inside a car (hidden). */
  ridePose: 'raptor' | 'bike' | 'motorbike' | 'car' = 'raptor';
  /** Pedalling speed (m/s of the bicycle) for the leg animation. */
  pedalSpeed = 0;
  private pedalPhase = 0;

  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly torso = new THREE.Group();
  private walkPhase = 0;
  /** Nozzle of the handheld water blaster (in the right hand). */
  private readonly nozzle = new THREE.Object3D();
  /** Arm raise while spraying (set each frame by the engine). */
  aiming = false;

  constructor(physics: PhysicsSystem, spawn: THREE.Vector3) {
    super(
      physics,
      physics.createCharacter({ position: spawn, radius: RADIUS, halfHeight: HALF_HEIGHT, maxStep: 0.4 }),
      // jumpSpeed 11.2 ≈ 2 m jump (h ≈ v² / 2g with g = 30, minus a little for the 60 Hz steps)
      { accel: 14, airAccel: 3, turnRate: 14, jumpSpeed: 11.2 },
    );
    this.buildModel();
  }

  /**
   * LEGO-style: he walks the way you push on screen and turns to face it. `face` (when set) makes
   * him face that heading instead: the auto-aim target, or the camera direction while free-aiming.
   */
  update(dt: number, input: InputManager, opts: SteerOptions): void {
    if (this.riding) return;
    this.swimming = this.depth > SWIM_DEPTH;
    const dir = cameraRelative(input.moveAxis(), opts.camYaw);
    const speed = (input.sprint ? SPRINT : WALK) * (this.swimming ? 0.4 : this.depth > 0.4 ? 0.7 : 1);
    this.move(dt, dir.multiplyScalar(speed), input.jump && !this.swimming, opts.face === null);
    if (opts.face !== null) this.heading = dampAngle(this.heading, opts.face, 12, dt);
  }

  /** Deep water: float with the head above the surface instead of walking on the sea floor. */
  protected floorCentre(x: number, z: number): number {
    const base = super.floorCentre(x, z);
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
    this.group.visible = pose !== 'car';
    this.char.collider.setEnabled(false);
    this.velocity.set(0, 0, 0);
    saddle.add(this.group);
    this.group.position.set(0, 0, 0);
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

  sync(alpha: number): void {
    if (!this.riding) super.sync(alpha);
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

  private buildModel(): void {
    const coat = '#f5f7fa';
    const pants = '#4a5568';
    const skin = '#f2c9a0';
    const hair = '#ffffff';

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
    // Handheld water blaster in the right hand: orange body, blue tank, nozzle pointing forward
    this.armR.add(part(new THREE.BoxGeometry(0.12, 0.14, 0.34), '#ff9f1c', 0, -0.6, 0.12));
    this.armR.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), '#4cc9f0', 0, -0.5, 0.02));
    this.nozzle.position.set(0, -0.6, 0.32);
    this.armR.add(this.nozzle);

    const head = new THREE.Group();
    head.position.y = 0.82;
    this.torso.add(head);
    head.add(part(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin, 0, 0.1, 0));
    // Wild white hair puffs on the sides and back, bald on top
    head.add(part(new THREE.IcosahedronGeometry(0.15, 0), hair, -0.2, 0.15, -0.04));
    head.add(part(new THREE.IcosahedronGeometry(0.15, 0), hair, 0.2, 0.15, -0.04));
    head.add(part(new THREE.IcosahedronGeometry(0.17, 0), hair, 0, 0.16, -0.17));
    head.add(part(new THREE.BoxGeometry(0.22, 0.05, 0.05), hair, 0, 0.0, 0.16)); // moustache
    // Goggles pushed up on the forehead
    head.add(part(new THREE.BoxGeometry(0.36, 0.05, 0.34), '#3d405b', 0, 0.24, 0));
    head.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), '#ffd166', -0.08, 0.25, 0.17, true));
    head.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), '#ffd166', 0.08, 0.25, 0.17, true));
    head.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', -0.08, 0.12, 0.165));
    head.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', 0.08, 0.12, 0.165));
  }
}
