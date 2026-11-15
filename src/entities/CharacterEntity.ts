import * as THREE from 'three';
import { floorAt, gravityAt, waterDepth } from '../game/Terrain';

/** Terminal fall speed (m/s). Above ~60 m/s a fall counts as a meteor drop (see GameEngine.impact). */
export const MAX_FALL = 110;
import type { CharacterBody, PhysicsSystem } from '../systems/PhysicsSystem';

export const GRAVITY = -30;

/** How the player steers this step (shared by the Professor and the Raptor). */
export interface SteerOptions {
  camYaw: number;
  /** Heading to face this step (auto-aim target / free-aim direction), or null. */
  face: number | null;
}

export interface MoveTuning {
  /** Ground acceleration responsiveness (1/s). Higher = snappier. */
  accel: number;
  /** Air control responsiveness (1/s). */
  airAccel: number;
  /** Turn rate towards the movement direction (1/s). */
  turnRate: number;
  jumpSpeed: number;
}

/**
 * Something that walks around on a kinematic capsule: the Professor and the Raptor.
 *
 * Physics runs at a fixed 60 Hz; `sync(alpha)` blends between the last two physics states so the
 * mesh moves smoothly on high-refresh displays. The mesh group's origin is at the character's feet.
 */
export abstract class CharacterEntity {
  readonly group = new THREE.Group();
  /** Capsule centre, current and previous physics step. */
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = 0;
  /** Fastest this character falls (m/s); a parachute lowers it. */
  protected fallLimit = MAX_FALL;
  protected prevHeading = 0;
  vy = 0;
  /** Downward speed (m/s) of the last hard landing on land, set here and cleared by whoever shows the impact. */
  lastImpact = 0;
  grounded = false;

  protected constructor(
    protected readonly physics: PhysicsSystem,
    readonly char: CharacterBody,
    protected readonly tuning: MoveTuning,
  ) {
    const t = char.body.translation();
    this.pos.set(t.x, t.y, t.z);
    this.prev.copy(this.pos);
  }

  /** Distance from capsule centre down to the ground under the feet (includes the controller skin). */
  get footOffset(): number {
    return this.char.halfHeight + this.char.radius + this.char.skin;
  }

  /** Feet position (current physics state). */
  get feet(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y - this.footOffset, this.pos.z);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /**
   * One physics step of movement. `target` is the wanted horizontal velocity (m/s, y ignored).
   * Must be followed by a world step for the move to take effect.
   */
  protected move(dt: number, target: THREE.Vector3, jump: boolean, faceTarget = true, jumpSpeed = this.tuning.jumpSpeed): void {
    this.beginStep();
    const k = 1 - Math.exp(-(this.grounded ? this.tuning.accel : this.tuning.airAccel) * dt);
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;

    if (this.grounded && jump) {
      this.vy = jumpSpeed;
      this.grounded = false;
      this.onJump();
    }
    this.integrate(dt, true);

    // Face where we are going
    if (faceTarget && Math.hypot(target.x, target.z) > 0.1) {
      const want = Math.atan2(target.x, target.z);
      this.heading = dampAngle(this.heading, want, this.tuning.turnRate, dt);
    }
  }

  /** Save the previous state for render interpolation. Call once at the start of each step. */
  protected beginStep(): void {
    this.prev.copy(this.pos);
    this.prevHeading = this.heading;
  }

  /** Vertical speed the ground gave us last step (driving up a ramp); used to launch off ramps. */
  private groundVy = 0;
  /** How much of the wanted horizontal move actually happened last step (0 = hit a wall). */
  moveRatio = 1;

  /**
   * Sweep the capsule by the current velocity (`velocity.x/z`, `vy`), sliding along walls.
   * With `gravity` false, `vy` is used as is (flight).
   */
  protected integrate(dt: number, gravity: boolean): void {
    if (gravity) this.vy = Math.max(this.vy + gravityAt(this.pos.y) * dt, -this.fallLimit); // low gravity in space; a long drop from space or the clouds builds up to meteor speed
    const desired = { x: this.velocity.x * dt, y: this.vy * dt, z: this.velocity.z * dt };
    const { controller, collider, body } = this.char;
    // Walls, ramps, buildings and cars go through the character controller; the ground and sea
    // floor (see Terrain) are handled by hand below. (A ground collider made characters sink in,
    // freeze, or trip over its triangle edges at speed.)
    controller.computeColliderMovement(collider, desired);
    const m = controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = controller.computedGrounded();
    const t0 = body.translation();
    const floor = this.floorCentre(t0.x + m.x, t0.z + m.z, t0.y - this.footOffset + 0.5); // capsule centre when standing on the floor
    let onFloor = false;
    if (t0.y + m.y <= floor + 1e-3) {
      m.y = floor - t0.y;
      this.grounded = true;
      onFloor = true;
    }

    const want = Math.hypot(desired.x, desired.z);
    this.moveRatio = want > 1e-4 ? Math.min(1, Math.hypot(m.x, m.z) / want) : 1;

    if (gravity) {
      if (this.grounded) {
        this.groundVy = onFloor ? 0 : m.y / dt; // only ramps/slopes launch you
        // Standing: no downward push (snap-to-ground keeps us on slopes/steps). A constant push here
        // made the capsule creep into the ground and get stuck.
        if (this.vy < 0) {
          if (!wasGrounded && -this.vy > 22 && this.depth < 0.3) this.lastImpact = -this.vy;
          this.vy = 0;
        }
      } else if (wasGrounded && this.groundVy > 2) {
        this.vy = Math.max(this.vy, this.groundVy); // launched off a ramp
        this.groundVy = 0;
      }
    }
    if (this.vy > 0 && m.y < desired.y * 0.5) this.vy = 0; // bonked a ceiling

    const t = body.translation();
    this.pos.set(t.x + m.x, t.y + m.y, t.z + m.z);
    body.setNextKinematicTranslation(this.pos);
  }

  /**
   * Lowest the capsule centre may go at (x, z): standing on the ground or sea floor. Swimmers and
   * boats raise this to float at the water surface.
   */
  protected floorCentre(x: number, z: number, feetY = Infinity): number {
    return floorAt(x, z, feetY) + this.footOffset;
  }

  /** Water depth where this character stands (0 on land). */
  get depth(): number {
    return waterDepth(this.pos.x, this.pos.z, this.pos.y);
  }

  /** Stand still but keep gravity working (used while idle/parked). */
  protected settle(dt: number): void {
    this.move(dt, new THREE.Vector3(), false);
  }

  /** Carry along by `d` (standing on a moving train roof) without resetting motion. */
  nudge(d: THREE.Vector3): void {
    this.pos.add(d);
    this.prev.add(d);
    this.char.body.setTranslation(this.pos, true);
    this.char.body.setNextKinematicTranslation(this.pos);
  }

  /** Instantly move to a capsule-centre position (no sweep). */
  teleport(center: THREE.Vector3, heading = this.heading): void {
    this.char.body.setTranslation(center, true);
    this.char.body.setNextKinematicTranslation(center);
    this.pos.copy(center);
    this.prev.copy(center);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.grounded = false; // re-checked on the next physics step
    this.heading = this.prevHeading = heading;
  }

  /** Place the mesh between the last two physics states. */
  sync(alpha: number): void {
    this.group.position.lerpVectors(this.prev, this.pos, alpha);
    this.group.position.y -= this.footOffset;
    this.group.rotation.y = lerpAngle(this.prevHeading, this.heading, alpha);
  }

  protected onJump(): void {}
}

export function dampAngle(from: number, to: number, rate: number, dt: number): number {
  return lerpAngle(from, to, 1 - Math.exp(-rate * dt));
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Camera-relative movement (LEGO-style): turns a (strafe, forward) input into a world direction. */
export function cameraRelative(axis: { x: number; z: number }, camYaw: number): THREE.Vector3 {
  // The camera sits at +(sin yaw, cos yaw) behind the target, so "forward" is the opposite way.
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  const v = new THREE.Vector3(fx * axis.z + rx * axis.x, 0, fz * axis.z + rz * axis.x);
  if (v.lengthSq() > 1) v.normalize();
  return v;
}

/** Shared flat-shaded material cache for entity models. */
const matCache = new Map<string, THREE.Material>();
export function flatMat(color: string, emissive = false): THREE.Material {
  const key = color + (emissive ? '!' : '');
  let m = matCache.get(key);
  if (!m) {
    m = emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshLambertMaterial({ color, flatShading: true });
    matCache.set(key, m);
  }
  return m;
}

export function part(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, emissive = false): THREE.Mesh {
  const m = new THREE.Mesh(geo, flatMat(color, emissive));
  m.position.set(x, y, z);
  m.castShadow = !emissive;
  return m;
}
