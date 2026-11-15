import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Kenney 3D models (CC0, www.kenney.nl) from public/models. Everything is loaded once at boot;
 * `Models.get` hands out clones normalised to sit on the ground, centred, at a chosen size.
 */
const FILES: Record<string, string[]> = {
  cars: ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'van', 'delivery', 'police', 'firetruck', 'ambulance', 'garbage-truck', 'race', 'race-future', 'truck', 'cone', 'box'],
  boats: ['boat-speed-a', 'boat-speed-c', 'boat-speed-e', 'boat-fishing-small', 'boat-sail-a', 'boat-tug-a', 'buoy', 'buoy-flag', 'cargo-container-a', 'cargo-container-b', 'cargo-container-c'],
  suburb: [...Array.from({ length: 21 }, (_, i) => `house_type${String(i + 1).padStart(2, '0')}`), 'tree_large', 'tree_small', 'fence_large'],
  town: ['building-sample-tower-a', 'building-sample-tower-b', 'building-sample-tower-c', 'building-sample-tower-d', 'building-sample-house-a', 'building-sample-house-b', 'building-sample-house-c'],
  space: ['monorail_trainFront', 'monorail_trainPassenger', 'monorail_trainEnd', 'hangar_roundGlass', 'rocket_baseA', 'rocket_fuelA', 'rocket_topA', 'rocket_finsA', 'meteor_detailed', 'rock_crystals', 'rock_crystalsLargeA', 'craterLarge', 'satelliteDish_large', 'rover', 'astronautA'],
  blasters: ['blasterA', 'blasterB', 'blasterC', 'blasterD', 'blasterE'],
};

/** Which way the Kenney building fronts face (radians added to "face the road"). */
export const SUBURB_FRONT = 0;
export const TOWN_FRONT = 0;

interface Entry {
  scene: THREE.Object3D;
  size: THREE.Vector3;
  /** Offset that puts the bounding box's bottom-centre at the origin. */
  offset: THREE.Vector3;
}

const library = new Map<string, Entry>();
/** Shared materials (one per look), so models from different files batch together. */
const materials = new Map<string, THREE.Material>();

function shareMaterial(m: THREE.Material): THREE.Material {
  const std = m as THREE.MeshStandardMaterial;
  const key = `${std.name}|${std.color?.getHexString()}|${std.map ? ((std.map.image as { src?: string } | null)?.src ?? std.map.uuid) : ''}`;
  let shared = materials.get(key);
  if (!shared) {
    // flat-ish Lambert keeps the toy look and matches the rest of the game's lighting
    shared = new THREE.MeshLambertMaterial({ color: std.color ?? new THREE.Color('#ffffff'), map: std.map ?? null, name: std.name, transparent: std.transparent, opacity: std.opacity });
    materials.set(key, shared);
  }
  return shared;
}

export const Models = {
  /** Load every model; `onProgress` gets 0…1. */
  async load(onProgress?: (k: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/`;
    const jobs: [string, string][] = [];
    for (const [dir, names] of Object.entries(FILES)) for (const n of names) jobs.push([dir, n]);
    let done = 0;
    await Promise.all(
      jobs.map(async ([dir, name]) => {
        try {
          const gltf = await loader.loadAsync(`${base}${dir}/${name}.glb`);
          const scene = gltf.scene;
          scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shareMaterial) : shareMaterial(mesh.material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          });
          scene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(scene);
          const size = box.getSize(new THREE.Vector3());
          const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
          library.set(name, { scene, size, offset });
        } catch (e) {
          console.warn(`Model ${dir}/${name} failed to load`, e);
        }
        onProgress?.(++done / jobs.length);
      }),
    );
  },

  has(name: string): boolean {
    return library.has(name);
  },

  /** Natural size of a model (before scaling). */
  size(name: string): THREE.Vector3 {
    return library.get(name)?.size.clone() ?? new THREE.Vector3(1, 1, 1);
  },

  /**
   * A fresh copy, bottom-centred at the origin. `fit` scales it uniformly so its length (z) /
   * width (x) / height (y) matches; `stretch` scales each axis to exact sizes.
   */
  get(name: string, opts: { length?: number; width?: number; height?: number; stretch?: THREE.Vector3 } = {}): THREE.Group {
    const e = library.get(name);
    const g = new THREE.Group();
    if (!e) return g;
    const inner = e.scene.clone(true);
    inner.position.copy(e.offset);
    const holder = new THREE.Group();
    holder.add(inner);
    let s = new THREE.Vector3(1, 1, 1);
    if (opts.stretch) s = new THREE.Vector3(opts.stretch.x / e.size.x, opts.stretch.y / e.size.y, opts.stretch.z / e.size.z);
    else if (opts.length) s.setScalar(opts.length / e.size.z);
    else if (opts.width) s.setScalar(opts.width / e.size.x);
    else if (opts.height) s.setScalar(opts.height / e.size.y);
    holder.scale.copy(s);
    g.add(holder);
    return g;
  },

  /** Give a copy a tint: every material is swapped for a tinted twin (shared per tint, so it still batches). */
  tint(root: THREE.Object3D, color: string): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshLambertMaterial;
      const key = `${m.uuid}|${color}`;
      let t = materials.get(key);
      if (!t) {
        t = m.clone();
        (t as THREE.MeshLambertMaterial).color.multiply(new THREE.Color(color));
        materials.set(key, t);
      }
      mesh.material = t;
    });
  },

  /** Named child nodes (e.g. the car kit's "wheel-front-left"). */
  nodes(root: THREE.Object3D, prefix: string): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name.startsWith(prefix)) out.push(o);
    });
    return out;
  },
};

/**
 * Bakes many static model copies (buildings, trees, props) into one mesh per material, so a town
 * of hundreds of Kenney houses costs a handful of draw calls.
 */
export class StaticBatch {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(obj: THREE.Object3D): void {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      let geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if (geo.index) geo = geo.toNonIndexed();
      // keep a common set of attributes so everything merges
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
      let b = this.buckets.get(mat);
      if (!b) this.buckets.set(mat, (b = []));
      b.push(geo);
    });
  }

  /** Merge into the scene (call once, after every add). */
  flush(scene: THREE.Scene): void {
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    this.buckets.clear();
  }
}
