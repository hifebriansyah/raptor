import * as THREE from 'three';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import { surfaceAt } from './Terrain';

export interface FollowSettings {
  distance: number;
  /** Heading the camera may drift back behind (radians), or null to leave yaw alone. */
  recenterTo: number | null;
  /** How fast it swings back behind (1/s). */
  recenterRate?: number;
  /** Over-the-shoulder offset (metres to the right, up) so the reticle clears the character. */
  shoulder?: { right: number; up: number };
}

const SENSITIVITY = 0.0028;
const MIN_PITCH = -0.25;
const MAX_PITCH = 1.25;

/**
 * Third-person orbit camera: mouse turns it around the focus point, walls pull it closer, and
 * while riding it slowly swings back behind the Raptor when the mouse is left alone.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  private distance = 6;
  private idle = 0;
  private readonly shoulder = new THREE.Vector2();
  /** Camera shake strength (m), decays quickly. */
  private shakeAmt = 0;

  /** Rattle the camera (e.g. a heavy landing). */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  update(
    dt: number,
    mouse: { dx: number; dy: number },
    focus: THREE.Vector3,
    settings: FollowSettings,
    physics: PhysicsSystem,
    ignore: ReadonlySet<number>,
  ): void {
    const moved = mouse.dx !== 0 || mouse.dy !== 0;
    this.yaw -= mouse.dx * SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + mouse.dy * SENSITIVITY, MIN_PITCH, MAX_PITCH);
    this.idle = moved ? 0 : this.idle + dt;

    if (settings.recenterTo !== null && this.idle > 1.5) {
      // Camera sits behind when yaw = heading + π
      const want = settings.recenterTo + Math.PI;
      let d = (want - this.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-(settings.recenterRate ?? 1.2) * dt));
    }

    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const wanted = settings.distance;
    const desired = focus.clone().addScaledVector(offset, wanted);
    const free = Math.max(1.2, physics.rayDistance(focus, desired, ignore) - 0.35);
    // Snap in quickly when something blocks the view, ease back out slowly.
    const target = Math.min(wanted, free);
    const rate = target < this.distance ? 20 : 3;
    this.distance += (target - this.distance) * (1 - Math.exp(-rate * dt));
    if (this.distance > free) this.distance = free;

    // Ease the shoulder offset in and out
    const want = settings.shoulder ?? { right: 0, up: 0 };
    const k = 1 - Math.exp(-5 * dt);
    this.shoulder.x += (want.right - this.shoulder.x) * k;
    this.shoulder.y += (want.up - this.shoulder.y) * k;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shift = right.multiplyScalar(this.shoulder.x).add(new THREE.Vector3(0, this.shoulder.y, 0));

    this.camera.position.copy(focus).addScaledVector(offset, this.distance).add(shift);
    const minY = surfaceAt(this.camera.position.x, this.camera.position.z) + 0.4;
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    this.camera.lookAt(focus.clone().add(shift));
    if (this.shakeAmt > 0.005) {
      const s = this.shakeAmt;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.05;
      this.shakeAmt *= Math.exp(-7 * dt);
    } else this.shakeAmt = 0;
  }
}
