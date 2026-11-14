import * as THREE from 'three';
import type { InputManager } from '../game/InputManager';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import { WATER_Y } from '../game/Terrain';
import { CharacterEntity, cameraRelative, dampAngle, flatMat, part } from './CharacterEntity';

const RADIUS = 0.9;
const HALF_HEIGHT = 0.8;
const WALK = 13;
const SPRINT = 22;
/** Running jump launch speed: ≈ 12 m high (h ≈ v² / 2g with g = 30, minus a little for the 60 Hz steps). */
const RUN_JUMP = 27.1;
const FLY = 24;
const FLY_BOOST = 44;
const RACE_TOP = 34;
const RACE_BOOST = 54;
const BOAT_TOP = 30;
const BOAT_BOOST = 46;
const MAX_ALTITUDE = 160;
/** Camera pitch that counts as "level" for flight (the camera's starting pitch). */
const DEFAULT_CAM_PITCH = 0.32;

export type RaptorMode = 'walk' | 'flight' | 'race' | 'boat';
export const RAPTOR_MODES: RaptorMode[] = ['walk', 'flight', 'race', 'boat'];

/** Things that happened this step, drained by the engine for sound and effects. */
export type RaptorEvent = 'transform' | 'takeoff' | 'landed' | 'jump' | 'crash' | 'stomp' | 'wet';

export interface RaptorDrive {
  input: InputManager;
  camYaw: number;
  camPitch: number;
  /** Sugar Rush etc. */
  speedMult: number;
  /** Boost energy is available (thruster gauge > 0). */
  canBoost: boolean;
  /** Thruster upgrade multiplier for boost top speed. */
  boostMult: number;
  /** Heading to face this step (auto-aim / free-aim), or null. */
  face: number | null;
}

/**
 * The Mecha Raptor: a rideable mech with three locomotion modes.
 * - walk:   bipedal sprinting and big jumps
 * - flight: wings unfold, free 3D arcade flight (climb with Space, descend with Ctrl/C)
 * - race:   folds into a low racer with wheels, drifting (Space) and thruster boost (Shift)
 */
export class MechaRaptor extends CharacterEntity {
  mode: RaptorMode = 'walk';
  ridden = false;
  /** True while a boost (flight or race) burned thruster energy this step. */
  boosting = false;
  drifting = false;
  /** Signed forward speed in race mode. */
  raceSpeed = 0;
  readonly events: RaptorEvent[] = [];
  /** Where the Professor's mesh sits (its origin is the Professor's feet). */
  readonly saddle = new THREE.Object3D();
  /** Tip of the water cannon. */
  readonly muzzle = new THREE.Object3D();

  private readonly pelvis = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly turret = new THREE.Group();
  private readonly tail: THREE.Group[] = [];
  private readonly legs: { thigh: THREE.Group; shin: THREE.Group; foot: THREE.Group }[] = [];
  private readonly wings: THREE.Group[] = [];
  private readonly wheels: THREE.Group[] = [];
  private readonly jetFlames: THREE.Mesh[] = [];
  private readonly rearFlames: THREE.Mesh[] = [];
  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: '#5ef2ff' });
  private walkPhase = 0;
  private lookTimer = 0;
  private lookTarget = 0;
  private crouch = 0;
  private wFlight = 0;
  private wRace = 0;
  private wBoat = 0;
  private readonly hull = new THREE.Group();
  private wasWet = false;
  private bank = 0;
  private steerVis = 0;
  private landTimer = 0;
  private wheelSpin = 0;
  private stompSide = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  /** Gentle idle wandering when left in town (autonomy charm). */
  private wanderTarget: THREE.Vector3 | null = null;
  private wanderTimer = 4;
  private home: THREE.Vector3 | null = null;

  constructor(physics: PhysicsSystem, spawn: THREE.Vector3) {
    super(
      physics,
      physics.createCharacter({ position: spawn, radius: RADIUS, halfHeight: HALF_HEIGHT, maxStep: 0.7 }),
      // jumpSpeed 19.2 ≈ 6 m jump (h ≈ v² / 2g with g = 30, minus a little for the 60 Hz steps)
      { accel: 6, airAccel: 1.5, turnRate: 7, jumpSpeed: 19.2 },
    );
    this.buildModel();
  }

  get capsule(): { radius: number; halfHeight: number } {
    return { radius: RADIUS, halfHeight: HALF_HEIGHT };
  }

  setMode(mode: RaptorMode): void {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    this.events.push('transform');
    if (mode === 'flight') {
      this.vy = Math.max(this.vy, 9);
      this.grounded = false;
      this.landTimer = 0;
      this.events.push('takeoff');
    }
    if (mode === 'race') {
      this.raceSpeed = this.velocity.x * Math.sin(this.heading) + this.velocity.z * Math.cos(this.heading);
    }
    if (from === 'flight' && mode !== 'flight') this.vy = Math.min(this.vy, 0);
  }

  /** Back to walking, standing still (used when parking, stealing, attic…). */
  resetToWalk(): void {
    this.mode = 'walk';
    this.raceSpeed = 0;
    this.boosting = false;
    this.drifting = false;
    this.wanderTarget = null;
    this.home = null;
  }

  update(dt: number, drive: RaptorDrive | null): void {
    this.boosting = false;
    this.drifting = false;
    if (!this.ridden || !drive) {
      this.updateIdle(dt);
      return;
    }
    this.home = null;
    if (this.mode === 'walk') this.updateWalk(dt, drive);
    else if (this.mode === 'flight') this.updateFlight(dt, drive);
    else if (this.mode === 'race') this.updateRace(dt, drive);
    else this.updateBoat(dt, drive);
    // tell the engine when it wades into water in a land mode (hint: Boat mode)
    const wet = this.depth > 0.8 && (this.mode === 'walk' || this.mode === 'race');
    if (wet && !this.wasWet) this.events.push('wet');
    this.wasWet = wet;
  }

  private updateIdle(dt: number): void {
    // left at sea in Boat mode it stays a floating boat; otherwise it folds back to walking
    const afloat = this.mode === 'boat' && this.depth > 0.5;
    if (this.mode !== 'walk' && !afloat) this.resetToWalk();
    this.raceSpeed = 0;
    this.move(dt, new THREE.Vector3(), false);
  }

  /**
   * Called by the engine while the Raptor is left in town (status 'idle'): it sniffs around a few
   * metres from where it was left, then wanders back.
   */
  wander(dt: number): void {
    if (!this.home) this.home = this.pos.clone();
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 5 + Math.random() * 6;
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      this.wanderTarget = Math.random() < 0.3 ? null : this.home.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const target = new THREE.Vector3();
    if (this.wanderTarget) {
      const d = new THREE.Vector3(this.wanderTarget.x - this.pos.x, 0, this.wanderTarget.z - this.pos.z);
      if (d.length() > 0.5) target.copy(d.normalize().multiplyScalar(2.2));
      else this.wanderTarget = null;
    }
    this.move(dt, target, false);
  }

  /** Walk mode, LEGO-style: go where you push on screen, turning to face it. */
  private updateWalk(dt: number, d: RaptorDrive): void {
    const dir = cameraRelative(d.input.moveAxis(), d.camYaw);
    const wasGrounded = this.grounded;
    // Running (tap Shift) jumps twice as high: ≈ 12 m instead of ≈ 6 m
    const running = d.input.sprint && this.horizontalSpeed > WALK * 0.8;
    const wade = this.depth > 1.0 ? 0.5 : 1; // slow going through deep water
    this.move(dt, dir.multiplyScalar((d.input.sprint ? SPRINT : WALK) * d.speedMult * wade), d.input.jump, d.face === null, running ? RUN_JUMP : undefined);
    if (d.face !== null) this.heading = dampAngle(this.heading, d.face, 8, dt);
    if (wasGrounded && !this.grounded && this.vy > 5) this.events.push('jump');
    if (!wasGrounded && this.grounded) this.events.push('stomp');
  }

  /**
   * Flight, LEGO-style: fly across the screen the way you push, facing the way you fly. Flying
   * forward follows the camera's pitch: move the mouse up to climb, down to dive (the default
   * camera angle flies level). Space climbs and Ctrl/C descends straight up/down; strafing stays level.
   */
  private updateFlight(dt: number, d: RaptorDrive): void {
    this.beginStep();
    const a = d.input.moveAxis();
    const before = this.heading;
    const boost = d.input.sprint && d.canBoost && Math.hypot(a.x, a.z) > 0.2;
    const spd = (boost ? FLY_BOOST * d.boostMult : FLY) * d.speedMult;
    const pitch = d.camPitch - DEFAULT_CAM_PITCH; // > 0 looking down, < 0 looking up
    const yaw = d.camYaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const target = fwd
      .multiplyScalar(a.z * spd * Math.cos(pitch))
      .addScaledVector(right, a.x * spd);
    if (target.length() > spd) target.setLength(spd);
    if (d.face !== null) this.heading = dampAngle(this.heading, d.face, 6, dt);
    else if (Math.hypot(target.x, target.z) > 1) this.heading = dampAngle(this.heading, Math.atan2(target.x, target.z), 4, dt);
    this.boosting = boost;
    target.y = -Math.sin(pitch) * a.z * spd + ((d.input.ascend ? 1 : 0) - (d.input.descend ? 1 : 0)) * 12;
    if (this.pos.y > MAX_ALTITUDE) target.y = Math.min(target.y, -2);

    const k = 1 - Math.exp(-2.5 * dt);
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;
    this.vy += (target.y - this.vy) * k;
    this.integrate(dt, false);

    // Bank into turns
    let turn = this.heading - before;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    const steer = THREE.MathUtils.clamp((-turn / dt) * 0.6, -1, 1);
    this.bank += (-steer * 0.55 * Math.min(1, 0.4 + this.horizontalSpeed / FLY) - this.bank) * (1 - Math.exp(-5 * dt));

    // Touch down and stay down → land in walk mode
    // only lands on land; over the sea it skims the surface
    if (this.grounded && !d.input.ascend && this.depth < 0.3) {
      this.landTimer += dt;
      if (this.landTimer > 0.35) {
        this.setMode('walk');
        this.events.push('landed');
      }
    } else this.landTimer = 0;
  }

  /** Over the sea in Flight or Boat mode it rides on the water surface instead of sinking. */
  protected floorCentre(x: number, z: number): number {
    const base = super.floorCentre(x, z);
    if (this.mode === 'boat') return Math.max(base, WATER_Y + this.footOffset - 0.45);
    if (this.mode === 'flight') return Math.max(base, WATER_Y + this.footOffset + 0.3);
    return base;
  }

  /**
   * Boat mode: a jet-boat that planes over the sea. W/S throttle, A/D steer (drifty), Shift boosts
   * on open water. On land it can only crawl.
   */
  private updateBoat(dt: number, d: RaptorDrive): void {
    this.beginStep();
    const a = d.input.moveAxis();
    const onWater = this.depth > 0.5;
    const boost = d.input.sprint && d.canBoost && a.z > 0.2 && onWater;
    this.boosting = boost;
    const top = onWater ? (boost ? BOAT_BOOST * d.boostMult : BOAT_TOP) * d.speedMult : 3.5;
    const accel = onWater ? (boost ? 30 : 16) : 4;
    if (a.z > 0) {
      if (this.raceSpeed < top) this.raceSpeed += accel * a.z * dt;
    } else if (a.z < 0) {
      this.raceSpeed -= (this.raceSpeed > 0 ? 22 : 8) * -a.z * dt;
      this.raceSpeed = Math.max(this.raceSpeed, -6);
    } else this.raceSpeed *= Math.exp(-0.5 * dt);
    if (this.raceSpeed > top) this.raceSpeed -= 12 * dt;

    const grip = 0.35 + Math.min(Math.abs(this.raceSpeed) / 8, 1) * 0.65;
    this.heading -= a.x * 1.8 * grip * Math.sign(this.raceSpeed || 1) * dt;
    this.steerVis += (a.x - this.steerVis) * (1 - Math.exp(-6 * dt));

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const k = 1 - Math.exp(-(onWater ? 2.2 : 6) * dt);
    this.velocity.x += (fx * this.raceSpeed - this.velocity.x) * k;
    this.velocity.z += (fz * this.raceSpeed - this.velocity.z) * k;
    this.integrate(dt, true);
    this.drifting = onWater && Math.abs(-this.velocity.x * fz + this.velocity.z * fx) > 4;
    if (this.moveRatio < 0.35 && Math.abs(this.raceSpeed) > 10) {
      this.raceSpeed *= 0.4;
      this.events.push('crash');
    }
  }

  private updateRace(dt: number, d: RaptorDrive): void {
    this.beginStep();
    const a = d.input.moveAxis();
    const throttle = a.z;
    const steer = a.x;
    const handbrake = d.input.descend; // Ctrl/C: drift (Space switches back to Walk mode)
    const boost = d.input.sprint && d.canBoost && throttle > 0.2;
    this.boosting = boost;
    const top = (boost ? RACE_BOOST * d.boostMult : RACE_TOP) * d.speedMult * (this.depth > 0.6 ? 0.3 : 1);

    if (this.grounded) {
      if (throttle > 0) {
        if (this.raceSpeed < top) this.raceSpeed += (boost ? 34 : 22) * throttle * dt;
      } else if (throttle < 0) {
        this.raceSpeed -= (this.raceSpeed > 0 ? 40 : 14) * -throttle * dt;
        this.raceSpeed = Math.max(this.raceSpeed, -12);
      } else {
        this.raceSpeed *= Math.exp(-0.7 * dt);
      }
      if (handbrake) this.raceSpeed *= Math.exp(-0.5 * dt);
      if (this.raceSpeed > top) this.raceSpeed -= 14 * dt;
    }

    const grip = Math.min(Math.abs(this.raceSpeed) / 8, 1);
    const rate = 2.1 * grip * (handbrake ? 1.6 : 1) * Math.sign(this.raceSpeed || 1) * (this.grounded ? 1 : 0.3);
    this.heading -= steer * rate * dt;
    this.steerVis += (steer - this.steerVis) * (1 - Math.exp(-8 * dt));

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const traction = this.grounded ? (handbrake ? 1.1 : 7) : 0.3;
    const k = 1 - Math.exp(-traction * dt);
    this.velocity.x += (fx * this.raceSpeed - this.velocity.x) * k;
    this.velocity.z += (fz * this.raceSpeed - this.velocity.z) * k;
    this.integrate(dt, true);

    const lateral = Math.abs(-this.velocity.x * fz + this.velocity.z * fx);
    this.drifting = this.grounded && lateral > 5;
    if (this.moveRatio < 0.35 && Math.abs(this.raceSpeed) > 10) {
      this.raceSpeed *= 0.35;
      this.events.push('crash');
    }
  }

  /** Point `local` (in the Raptor's own frame, feet origin) to world space, using physics state. */
  localToWorld(local: THREE.Vector3): THREE.Vector3 {
    const v = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    return v.add(this.feet);
  }

  /** World position of the water cannon tip (uses the last rendered pose). */
  muzzleWorld(): THREE.Vector3 {
    return this.muzzle.getWorldPosition(new THREE.Vector3());
  }

  /** Swivel the turret towards a world point. */
  aimAt(target: THREE.Vector3 | null): void {
    if (!target) {
      this.aimYaw = 0;
      this.aimPitch = 0;
      return;
    }
    const base = this.turret.getWorldPosition(new THREE.Vector3());
    const d = target.clone().sub(base).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.heading);
    this.aimYaw = Math.atan2(d.x, d.z);
    this.aimPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  /** Limb animation; call once per rendered frame. `parked` lowers it into a resting crouch. */
  animate(dt: number, time: number, parked: boolean): void {
    const speed = this.horizontalSpeed;
    const moving = Math.min(speed / SPRINT, 1);
    const ease = (r: number) => 1 - Math.exp(-r * dt);

    this.wFlight += ((this.mode === 'flight' ? 1 : 0) - this.wFlight) * ease(5);
    this.wRace += ((this.mode === 'race' ? 1 : 0) - this.wRace) * ease(5);
    this.wBoat += ((this.mode === 'boat' ? 1 : 0) - this.wBoat) * ease(5);
    const wB = this.wBoat;
    const wF = this.wFlight;
    const wR = this.wRace;
    const wW = Math.max(0, 1 - wF - wR - wB);
    const fold = wR + wB;

    const wantCrouch = parked ? 1 : this.ridden ? 0 : 0.35;
    this.crouch += (wantCrouch - this.crouch) * ease(3);

    this.walkPhase += dt * (2 + speed * 0.55);
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase);
    const stride = this.grounded ? moving * 0.75 : 0;

    // Footstep events (for sound) in walk mode
    if (this.mode === 'walk' && this.grounded && speed > 2) {
      const side = s > 0 ? 1 : -1;
      if (side !== this.stompSide) {
        this.stompSide = side;
        this.events.push('stomp');
      }
    }

    this.legs.forEach((leg, i) => {
      const ph = i === 0 ? s : -s;
      const lift = Math.max(0, i === 0 ? c : -c);
      let tx: number, sx: number, fx: number;
      if (this.grounded || this.mode !== 'walk') {
        tx = -0.35 + ph * stride - this.crouch * 0.55;
        sx = 0.9 + lift * stride * 1.1 + this.crouch * 0.9;
        fx = -0.55 - lift * stride * 0.4 - this.crouch * 0.35;
      } else {
        tx = -1.0;
        sx = 1.7;
        fx = -0.6;
      }
      // flight: tucked; race: folded back along the body
      leg.thigh.rotation.x = tx * wW + -1.1 * wF + 1.45 * fold;
      leg.shin.rotation.x = sx * wW + 1.9 * wF + 0.2 * fold;
      leg.foot.rotation.x = fx * wW + -0.4 * wF + 0.3 * fold;
      leg.thigh.scale.setScalar(1 - fold * 0.45);
    });

    const bob = this.grounded && this.mode === 'walk' ? Math.abs(c) * stride * 0.18 : 0;
    const breathe = Math.sin(time * 2) * 0.03;
    const hover = Math.sin(time * 2.4) * 0.12;
    const walkY = 1.95 - this.crouch * 0.55 + bob + breathe;
    const boatBob = Math.sin(time * 2.6) * 0.06 * (1 - Math.min(Math.abs(this.raceSpeed) / 20, 1));
    this.pelvis.position.y = walkY * wW + (2.1 + hover) * wF + 1.05 * wR + (1.15 + boatBob) * wB;
    const flightPitch = THREE.MathUtils.clamp(-this.vy * 0.03, -0.5, 0.5) + moving * 0.25;
    const planing = -Math.min(Math.abs(this.raceSpeed) / 30, 1) * 0.14 + Math.sin(time * 2.1) * 0.025;
    this.pelvis.rotation.x = (0.12 + moving * 0.15 + this.crouch * 0.05) * wW + flightPitch * wF + 0.02 * wR + planing * wB;
    this.pelvis.rotation.z = this.bank * wF + -this.steerVis * 0.06 * wR;

    // Head
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 1.5 + Math.random() * 2.5;
      this.lookTarget = this.ridden && speed > 1 ? 0 : (Math.random() - 0.5) * 1.4;
    }
    if (this.ridden && speed > 1) this.lookTarget = 0;
    this.neck.rotation.y += (this.lookTarget * wW - this.neck.rotation.y) * ease(4);
    this.neck.rotation.x = (-0.25 - moving * 0.25 + this.crouch * 0.25) * wW + -0.55 * wF + 0.45 * wR + 0.3 * wB;
    this.hull.scale.setScalar(Math.max(0.001, wB));
    this.jaw.rotation.x = 0.08 + Math.max(0, Math.sin(time * 0.7)) * 0.12 * (1 - moving);

    // Tail
    this.tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(time * 2.2 - i * 0.6 + this.walkPhase * 0.5) * (0.12 + (1 - moving) * 0.1) * (1 - wR * 0.8);
      seg.rotation.x = (0.06 - moving * 0.05) * (1 - wR) + 0.04 * wF;
    });

    // Wings unfold in flight
    this.wings.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      const flap = Math.sin(time * (this.boosting ? 9 : 5)) * 0.12 * wF;
      w.rotation.z = side * (1.35 * (1 - wF)) + side * flap;
      w.scale.set(0.25 + 0.75 * wF, 1, 0.5 + 0.5 * wF);
    });

    // Wheels appear in race mode
    this.wheelSpin += (this.raceSpeed / 0.5) * dt;
    this.wheels.forEach((wh, i) => {
      wh.scale.setScalar(Math.max(0.001, wR));
      wh.children[0].rotation.x = this.wheelSpin;
      if (i < 2) wh.rotation.y = -this.steerVis * 0.45; // front wheels steer
    });

    // Flames
    const jet = wF * (0.6 + (this.boosting ? 0.9 : 0) + Math.random() * 0.2);
    this.jetFlames.forEach((f) => f.scale.set(1, Math.max(0.001, jet), 1));
    const rear = (this.boosting ? 1.2 : wR * 0.25) * (0.8 + Math.random() * 0.4);
    this.rearFlames.forEach((f) => f.scale.set(1, 1, Math.max(0.001, rear)));

    // Turret aims at the reticle when ridden
    this.turret.rotation.y += ((this.ridden ? this.aimYaw : 0) - this.turret.rotation.y) * ease(12);
    this.turretBarrel.rotation.x += ((this.ridden ? -this.aimPitch : 0) - this.turretBarrel.rotation.x) * ease(12);

    this.eyeMat.color.set(parked ? '#2a9d8f' : this.boosting ? '#ffd166' : '#5ef2ff');
  }

  private readonly turretBarrel = new THREE.Group();

  private buildModel(): void {
    const hull = '#2a9d8f';
    const hullDark = '#1d6f66';
    const accent = '#f4a261';
    const metal = '#8d99ae';
    const dark = '#2b2d42';

    this.pelvis.position.y = 1.95;
    this.group.add(this.pelvis);

    this.pelvis.add(part(new THREE.BoxGeometry(1.5, 1.3, 2.4), hull, 0, 0.35, 0.1));
    this.pelvis.add(part(new THREE.BoxGeometry(1.2, 0.5, 1.9), metal, 0, -0.35, 0.2));
    this.pelvis.add(part(new THREE.BoxGeometry(1.6, 0.25, 1.6), hullDark, 0, 1.05, -0.2));
    for (let i = 0; i < 3; i++) {
      this.pelvis.add(part(new THREE.BoxGeometry(0.25, 0.35, 0.3), accent, 0, 1.25, 0.4 - i * 0.55));
    }

    this.pelvis.add(part(new THREE.BoxGeometry(0.75, 0.15, 0.9), '#6d4c41', 0, 1.2, 0.55));
    this.pelvis.add(part(new THREE.BoxGeometry(0.75, 0.35, 0.12), '#6d4c41', 0, 1.35, 0.1));
    this.saddle.position.set(0, 1.27 - 0.95, 0.6);
    this.pelvis.add(this.saddle);
    this.pelvis.add(part(new THREE.BoxGeometry(0.9, 0.08, 0.08), dark, 0, 1.55, 1.15));
    this.pelvis.add(part(new THREE.BoxGeometry(0.08, 0.4, 0.08), dark, 0, 1.35, 1.15));

    // Water turret on the back: swivels (yaw) with a pitching barrel
    this.turret.position.set(0, 1.25, -0.75);
    this.turret.add(part(new THREE.CylinderGeometry(0.35, 0.4, 0.3, 10), metal));
    this.turret.add(part(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 10), '#4cc9f0', 0, 0.2, -0.35));
    this.turretBarrel.position.set(0, 0.25, 0);
    this.turretBarrel.add(part(new THREE.CylinderGeometry(0.1, 0.12, 1.1, 8).rotateX(Math.PI / 2), dark, 0, 0, 0.5));
    this.turretBarrel.add(part(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 8).rotateX(Math.PI / 2), accent, 0, 0, 1.05));
    this.muzzle.position.set(0, 0, 1.15);
    this.turretBarrel.add(this.muzzle);
    this.turret.add(this.turretBarrel);
    this.pelvis.add(this.turret);

    // Wing pods on the flanks, with wings that unfold for flight
    for (const sx of [-1, 1]) {
      const pod = part(new THREE.BoxGeometry(0.2, 0.7, 1.6), hullDark, sx * 0.85, 0.55, -0.1);
      pod.rotation.z = sx * 0.15;
      this.pelvis.add(pod);
      this.pelvis.add(part(new THREE.BoxGeometry(0.06, 0.5, 1.2), accent, sx * 0.97, 0.6, -0.1));

      const wing = new THREE.Group();
      wing.position.set(sx * 0.95, 0.85, -0.1);
      // three overlapping feather plates, sweeping back
      for (let i = 0; i < 3; i++) {
        const plate = part(new THREE.BoxGeometry(3.4 - i * 0.7, 0.08, 0.7), i === 1 ? accent : hull, sx * (1.7 - i * 0.35), 0, -0.2 - i * 0.55);
        plate.rotation.y = sx * 0.12 * i;
        wing.add(plate);
      }
      wing.add(part(new THREE.BoxGeometry(3.6, 0.14, 0.18), metal, sx * 1.8, 0.05, 0.25)); // leading-edge spar
      this.wings.push(wing);
      this.pelvis.add(wing);

      // downward jet under each pod (flight)
      // wide end at the pod, tip pointing down; scaling y grows it downwards
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 8).rotateX(Math.PI).translate(0, -0.7, 0), flatMat('#ffb703', true));
      jet.position.set(sx * 0.85, 0.15, -0.1);
      jet.scale.set(1, 0.001, 1);
      this.jetFlames.push(jet);
      this.pelvis.add(jet);
    }

    // Rear thrusters with boost flames
    for (const sx of [-0.4, 0.4]) {
      this.pelvis.add(part(new THREE.CylinderGeometry(0.22, 0.28, 0.5, 10).rotateX(Math.PI / 2), dark, sx, 0.2, -1.15));
      this.pelvis.add(part(new THREE.CircleGeometry(0.17, 10).rotateY(Math.PI), '#ff9f1c', sx, 0.2, -1.41, true));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.8, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.9), flatMat('#ff6b35', true));
      flame.position.set(sx, 0.2, -1.42);
      flame.scale.set(1, 1, 0.001);
      this.rearFlames.push(flame);
      this.pelvis.add(flame);
    }

    // Boat hull for boat mode (hidden otherwise): sits under the folded body, bottom at the feet
    {
      const h = this.hull;
      h.position.set(0, -0.62, 0.1);
      h.add(part(new THREE.BoxGeometry(2.3, 0.85, 3.6), '#f8f9fa', 0, 0, -0.2));
      const bow = part(new THREE.CylinderGeometry(0.05, 1.15, 1.6, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2), '#f8f9fa', 0, 0.02, 2.35);
      bow.scale.set(1, 0.55, 1);
      h.add(bow);
      h.add(part(new THREE.BoxGeometry(2.36, 0.18, 3.65), accent, 0, 0.18, -0.2)); // stripe
      h.add(part(new THREE.BoxGeometry(2.0, 0.2, 0.3), hullDark, 0, 0.5, 1.45)); // dash
      const glass = part(new THREE.BoxGeometry(1.8, 0.55, 0.06), '#9ad7ff', 0, 0.8, 1.5);
      glass.rotation.x = -0.5;
      h.add(glass);
      for (const sx of [-0.55, 0.55]) h.add(part(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10).rotateX(Math.PI / 2), dark, sx, -0.15, -2.15));
      h.scale.setScalar(0.001);
      this.pelvis.add(h);
    }

    // Wheels for race mode (hidden otherwise)
    for (const [wx, wz] of [[-0.95, 0.95], [0.95, 0.95], [-0.95, -0.85], [0.95, -0.85]] as const) {
      const holder = new THREE.Group();
      holder.position.set(wx, -0.55, wz);
      const spin = new THREE.Group();
      spin.add(part(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12).rotateZ(Math.PI / 2), dark));
      spin.add(part(new THREE.CylinderGeometry(0.28, 0.28, 0.42, 6).rotateZ(Math.PI / 2), accent));
      holder.add(spin);
      holder.scale.setScalar(0.001);
      this.wheels.push(holder);
      this.pelvis.add(holder);
    }

    // Neck → head, facing +z
    this.neck.position.set(0, 0.85, 1.25);
    this.pelvis.add(this.neck);
    const neckMesh = part(new THREE.BoxGeometry(0.6, 0.6, 1.1), hull, 0, 0.35, 0.4);
    neckMesh.rotation.x = -0.6;
    this.neck.add(neckMesh);
    this.head.position.set(0, 0.8, 0.95);
    this.neck.add(this.head);
    this.head.add(part(new THREE.BoxGeometry(0.75, 0.6, 1.1), hull, 0, 0.05, 0.35));
    this.head.add(part(new THREE.BoxGeometry(0.8, 0.12, 0.9), accent, 0, 0.38, 0.25));
    for (const sx of [-0.3, 0.3]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), this.eyeMat);
      eye.position.set(sx, 0.18, 0.55);
      this.head.add(eye);
    }
    this.jaw.position.set(0, -0.2, 0.0);
    this.head.add(this.jaw);
    this.jaw.add(part(new THREE.BoxGeometry(0.65, 0.18, 1.0), hullDark, 0, -0.05, 0.4));
    for (let i = 0; i < 4; i++) {
      this.head.add(part(new THREE.BoxGeometry(0.06, 0.1, 0.06), '#ffffff', -0.27 + (i % 2) * 0.54, -0.28, 0.6 + Math.floor(i / 2) * 0.2));
    }

    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.65, -0.05, 1.1);
      arm.rotation.x = 0.6;
      arm.add(part(new THREE.BoxGeometry(0.18, 0.55, 0.18), metal, 0, -0.25, 0));
      arm.add(part(new THREE.BoxGeometry(0.22, 0.12, 0.3), dark, 0, -0.55, 0.08));
      this.pelvis.add(arm);
    }

    let parent: THREE.Object3D = this.pelvis;
    let z = -1.15;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.45 : 0, z);
      const w = 0.8 - i * 0.13;
      seg.add(part(new THREE.BoxGeometry(w, w * 0.8, 0.8), i % 2 ? hullDark : hull, 0, 0, -0.4));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
      z = -0.8;
    }
    parent.add(part(new THREE.ConeGeometry(0.15, 0.5, 6).rotateX(-Math.PI / 2), accent, 0, 0, -0.95));

    for (const sx of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(sx * 0.62, -0.05, -0.1);
      this.pelvis.add(thigh);
      thigh.add(part(new THREE.BoxGeometry(0.5, 1.0, 0.65), hull, 0, -0.45, 0));
      thigh.add(part(new THREE.SphereGeometry(0.3, 8, 6), metal, 0, 0, 0));
      const shin = new THREE.Group();
      shin.position.set(0, -0.95, 0);
      thigh.add(shin);
      shin.add(part(new THREE.BoxGeometry(0.32, 0.95, 0.35), metal, 0, -0.45, 0));
      shin.add(part(new THREE.BoxGeometry(0.36, 0.3, 0.4), accent, 0, -0.1, 0.05));
      const foot = new THREE.Group();
      foot.position.set(0, -0.92, 0);
      shin.add(foot);
      foot.add(part(new THREE.BoxGeometry(0.5, 0.18, 0.85), dark, 0, -0.08, 0.25));
      for (const tx of [-0.16, 0, 0.16]) {
        foot.add(part(new THREE.ConeGeometry(0.06, 0.25, 4).rotateX(Math.PI / 2), '#e5e5e5', tx, -0.08, 0.75));
      }
      this.legs.push({ thigh, shin, foot });
    }
  }
}
