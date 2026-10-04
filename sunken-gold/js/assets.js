// Loads everything the Blender build produced: models, seabed heights,
// collision fields, world layout and textures. Reports progress 0..1.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The single-file desktop build embeds every asset as a data URI in
// globalThis.SUNKEN_GOLD_FILES (keyed by path under assets/); otherwise they're fetched.
const EMBED = globalThis.SUNKEN_GOLD_FILES || {};
const url = (path) => EMBED[path] || `assets/${path}`;
export const FILES = {
  world: url('world.json'),
  terrain: url('terrain.bin'),
  colliders: url('colliders.bin'),
  models: url('models.glb'),
  tex: (name) => url(`tex/${name}`),
};

const TEXTURES = {
  sand_albedo: 'sand_albedo.jpg', sand_normal: 'sand_normal.jpg',
  rubble_albedo: 'rubble_albedo.jpg', rubble_normal: 'rubble_normal.jpg',
  rock_albedo: 'rock_albedo.jpg', rock_normal: 'rock_normal.jpg',
  silt_albedo: 'silt_albedo.jpg', silt_normal: 'silt_normal.jpg',
  wood_albedo: 'wood_albedo.jpg', wood_normal: 'wood_normal.jpg',
  brain_albedo: 'brain_albedo.jpg', brain_normal: 'brain_normal.jpg',
  water_normal: 'water_normal.jpg', fan: 'fan.png', splat: 'splat.png', ao: 'ao.jpg',
};

export async function loadAssets(renderer, onProgress) {
  const parts = { world: 0, terrain: 0, colliders: 0, models: 0, tex: 0 };
  const weights = { world: 0.02, terrain: 0.06, colliders: 0.14, models: 0.38, tex: 0.4 };
  const report = () => onProgress?.(Object.keys(parts).reduce((s, k) => s + parts[k] * weights[k], 0));

  async function fetchBuf(url, key) {
    if (url.startsWith('data:')) {
      // Embedded asset: decode it here rather than fetch() it, which some page security policies block.
      const bin = atob(url.slice(url.indexOf(',') + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      parts[key] = 1; report();
      return out.buffer;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !total) {
      const b = await res.arrayBuffer();
      parts[key] = 1; report();
      return b;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      parts[key] = Math.min(1, got / total); report();
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    parts[key] = 1; report();
    return out.buffer;
  }

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const texLoader = new THREE.TextureLoader();
  const names = Object.keys(TEXTURES);
  let texDone = 0;
  const textures = {};
  const texPromise = Promise.all(names.map((key) => new Promise((resolve, reject) => {
    texLoader.load(FILES.tex(TEXTURES[key]), (t) => {
      const color = key.endsWith('_albedo') || key === 'fan';
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = key === 'splat' || key === 'ao' || key === 'fan' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      textures[key] = t;
      parts.tex = ++texDone / names.length; report();
      resolve();
    }, undefined, () => reject(new Error(`Could not load texture ${TEXTURES[key]}`)));
  })));

  const [worldBuf, terrainBuf, colliderBuf, modelBuf] = await Promise.all([
    fetchBuf(FILES.world, 'world'), fetchBuf(FILES.terrain, 'terrain'),
    fetchBuf(FILES.colliders, 'colliders'), fetchBuf(FILES.models, 'models'),
  ]);
  await texPromise;
  const world = JSON.parse(new TextDecoder().decode(worldBuf));
  const gltf = await new GLTFLoader().parseAsync(modelBuf, '');
  const models = {};
  for (const child of gltf.scene.children) models[child.name] = child;
  return {
    world, models, textures,
    heights: new Uint16Array(terrainBuf),
    colliders: new Uint8Array(colliderBuf),
  };
}
