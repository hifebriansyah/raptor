import * as THREE from 'three';

export interface EmitOptions {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  /** Random extra velocity in each axis (±). */
  spread?: number;
  color: THREE.ColorRepresentation;
  /** World size in metres. */
  size: number;
  /** Size change per second (metres). */
  grow?: number;
  life: number;
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
  alpha?: number;
  count?: number;
}

const VERT = /* glsl */ `
  attribute float psize;
  attribute float palpha;
  attribute vec3 pcolor;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = psize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vColor = pcolor;
    vAlpha = palpha;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.15, d) * vAlpha);
  }
`;

/**
 * A fixed pool of soft round point sprites. Two of these exist: one additive (fire, sparks,
 * thruster flames) and one normal-blended (smoke, water, steam, crumbs). Emitting when full
 * recycles the oldest slot, so it never allocates during play.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly grow: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  /** Keep sprite sizes in metres: call on resize with the viewport height in device pixels. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(o: EmitOptions): void {
    const n = o.count ?? 1;
    const spread = o.spread ?? 0;
    this.tmpColor.set(o.color);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = o.pos.x;
      this.pos[i3 + 1] = o.pos.y;
      this.pos[i3 + 2] = o.pos.z;
      this.vel[i3] = (o.vel?.x ?? 0) + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3 + 1] = (o.vel?.y ?? 0) + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3 + 2] = (o.vel?.z ?? 0) + (Math.random() - 0.5) * 2 * spread;
      this.col[i3] = this.tmpColor.r;
      this.col[i3 + 1] = this.tmpColor.g;
      this.col[i3 + 2] = this.tmpColor.b;
      this.size[i] = o.size * (0.75 + Math.random() * 0.5);
      this.life[i] = this.maxLife[i] = o.life * (0.8 + Math.random() * 0.4);
      this.baseAlpha[i] = this.alpha[i] = o.alpha ?? 1;
      this.grow[i] = o.grow ?? 0;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp + this.grav[i] * dt;
      this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      const t = this.life[i] / this.maxLife[i];
      // fade in quickly, fade out over the last 40 %
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, (1 - t) * 8) * Math.min(1, t / 0.4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.psize.needsUpdate = true;
    g.attributes.palpha.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
  }
}

/** The pair of particle pools the game uses. */
export class Particles {
  readonly glow: ParticleSystem;
  readonly soft: ParticleSystem;

  constructor(scene: THREE.Scene) {
    this.glow = new ParticleSystem(scene, 2500, true);
    this.soft = new ParticleSystem(scene, 3500, false);
  }

  setViewport(heightPx: number, fov: number): void {
    this.glow.setViewport(heightPx, fov);
    this.soft.setViewport(heightPx, fov);
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.soft.update(dt);
  }

  splash(pos: THREE.Vector3, count = 6): void {
    this.soft.emit({ pos, vel: new THREE.Vector3(0, 3, 0), spread: 2.5, color: '#bfefff', size: 0.35, life: 0.45, gravity: -14, count, alpha: 0.9 });
  }

  steam(pos: THREE.Vector3): void {
    this.soft.emit({ pos, vel: new THREE.Vector3(0, 3, 0), spread: 1, color: '#eef3f7', size: 1.6, grow: 2.5, life: 1.4, drag: 1, count: 3, alpha: 0.7 });
  }

  sparks(pos: THREE.Vector3, count = 20, color = '#ffd166'): void {
    this.glow.emit({ pos, vel: new THREE.Vector3(0, 2, 0), spread: 6, color, size: 0.25, life: 0.5, gravity: -12, drag: 1.5, count });
  }

  crumbs(pos: THREE.Vector3, count = 8): void {
    this.soft.emit({ pos, vel: new THREE.Vector3(0, 2, 0), spread: 2, color: '#c98b4a', size: 0.18, life: 1.2, gravity: -10, count });
  }
}
