import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../state/gameStore';

/**
 * Shading presets:
 * - flat:     no shadows, plain flat colours (fastest, phones)
 * - toon:     cel-shaded (3-step toon ramp) with shadows
 * - standard: flat-shaded Lambert with shadows (the default look)
 * - high:     sharper, wider shadows and a soft glow on bright things (bloom)
 */
export class Graphics {
  private quality: Quality = 'standard';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly toonFor = new Map<THREE.Material, THREE.Material>();
  private readonly lambertFor = new Map<THREE.Material, THREE.Material>();
  private readonly ramp: THREE.DataTexture;
  private scanTimer = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly sun: THREE.DirectionalLight,
  ) {
    const data = new Uint8Array([90, 170, 255]);
    this.ramp = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    this.ramp.minFilter = this.ramp.magFilter = THREE.NearestFilter;
    this.ramp.needsUpdate = true;
  }

  get current(): Quality {
    return this.quality;
  }

  set(q: Quality): void {
    if (q === this.quality) return;
    const wasToon = this.quality === 'toon';
    this.quality = q;
    const shadows = q !== 'flat';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const c = this.sun.shadow.camera;
    const half = q === 'high' ? 90 : 60;
    c.left = c.bottom = -half;
    c.right = c.top = half;
    c.updateProjectionMatrix();
    // every material must recompile when shadows switch on/off
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
    if (q === 'toon') this.swap(true);
    else if (wasToon) this.swap(false);
    if (q === 'high') this.ensureComposer();
  }

  /** Swap Lambert ↔ Toon materials across the scene (new objects are picked up by scan()). */
  private swap(toToon: boolean): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.Material;
      if (Array.isArray(m)) return;
      if (toToon && (m as THREE.MeshLambertMaterial).isMeshLambertMaterial) mesh.material = this.toon(m as THREE.MeshLambertMaterial);
      else if (!toToon && this.lambertFor.has(m)) mesh.material = this.lambertFor.get(m)!;
    });
  }

  private toon(m: THREE.MeshLambertMaterial): THREE.Material {
    let t = this.toonFor.get(m);
    if (!t) {
      t = new THREE.MeshToonMaterial({
        color: m.color,
        map: m.map,
        gradientMap: this.ramp,
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        emissive: m.emissive,
        vertexColors: m.vertexColors,
      });
      this.toonFor.set(m, t);
      this.lambertFor.set(t, m);
    }
    return t;
  }

  private ensureComposer(): void {
    if (this.composer) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.35, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize(w: number, h: number): void {
    this.composer?.setSize(w, h);
  }

  render(dt: number): void {
    if (this.quality === 'toon') {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) {
        this.scanTimer = 1.5;
        this.swap(true);
      }
    }
    if (this.quality === 'high' && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
