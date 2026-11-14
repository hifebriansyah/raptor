import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type { RAPIER };

export interface CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  /** Capsule half-height of the cylinder part (excludes the hemispheres). */
  halfHeight: number;
  radius: number;
  /** Gap the character controller keeps from surfaces (its "skin"). */
  skin: number;
}

export interface CharacterOptions {
  position: THREE.Vector3;
  radius: number;
  halfHeight: number;
  maxStep: number;
}

/**
 * Thin wrapper around the Rapier world: static level geometry, kinematic character bodies and the
 * scene queries the game needs (camera collision, "is this spot free" for dismounting).
 */
export class PhysicsSystem {
  readonly world: RAPIER.World;
  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  /** Loads the Rapier WASM module, then builds the world. */
  static async create(): Promise<PhysicsSystem> {
    await RAPIER.init();
    return new PhysicsSystem();
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** A fixed box collider. `center` is in world space, `half` is half the size on each axis. */
  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rotation?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z);
    if (rotation) desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    return this.world.createCollider(desc);
  }

  addStaticCylinder(center: THREE.Vector3, halfHeight: number, radius: number): RAPIER.Collider {
    return this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(center.x, center.y, center.z),
    );
  }

  /** A kinematic capsule driven by Rapier's character controller (slides along walls, climbs steps). */
  createCharacter(opts: CharacterOptions): CharacterBody {
    const { position: p, radius, halfHeight } = opts;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
    const skin = 0.1;
    const controller = this.world.createCharacterController(skin);
    controller.enableAutostep(opts.maxStep, radius * 0.5, false);
    controller.enableSnapToGround(0.3);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    controller.setApplyImpulsesToDynamicBodies(true);
    return { body, collider, controller, halfHeight, radius, skin };
  }

  /**
   * How far a ray from `from` towards `to` gets before hitting static level geometry.
   * Returns the full distance when nothing is in the way. `ignore` skips colliders by handle.
   */
  rayDistance(from: THREE.Vector3, to: THREE.Vector3, ignore?: ReadonlySet<number>): number {
    const dir = new THREE.Vector3().subVectors(to, from);
    const max = dir.length();
    if (max < 1e-4) return 0;
    dir.divideScalar(max);
    const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, max, true, undefined, undefined, undefined, undefined, (c) => {
      const parent = c.parent();
      if (parent && !parent.isFixed()) return false; // characters never block the camera
      return !ignore?.has(c.handle);
    });
    return hit ? hit.timeOfImpact : max;
  }

  /** True when a capsule of this size centred at `pos` overlaps nothing (except `exclude`). */
  isFree(pos: THREE.Vector3, radius: number, halfHeight: number, exclude?: RAPIER.Collider): boolean {
    const shape = new RAPIER.Capsule(halfHeight, radius);
    const hit = this.world.intersectionWithShape(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      undefined,
      undefined,
      exclude,
    );
    return hit === null;
  }
}
