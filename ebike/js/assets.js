import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FILES = ['city', 'ebike', 'police', 'sedan', 'taxi', 'van'];

/** Load every Blender-built GLB. Returns { city: Object3D, ebike, police, ... } */
export async function loadAssets(renderer, onProgress = () => {}) {
  const loader = new GLTFLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const out = {};
  let done = 0;
  await Promise.all(FILES.map(async (name) => {
    const embedded = globalThis.__EMBEDDED_ASSETS && globalThis.__EMBEDDED_ASSETS[name];
    const gltf = embedded   // single-file build: models are inlined as base64
      ? await loader.parseAsync(Uint8Array.from(atob(embedded), (c) => c.charCodeAt(0)).buffer, '')
      : await loader.loadAsync(`assets/${name}.glb`);
    tune(gltf.scene, aniso);
    out[name] = gltf.scene;
    onProgress(++done / FILES.length);
  }));
  return out;
}

const CLOSED = new Set(['asphalt', 'sidewalk', 'curb', 'roof', 'store', 'fac_brick', 'fac_glass', 'fac_concrete', 'fac_deco']);

function tune(root, aniso) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const k of ['map', 'emissiveMap', 'metalnessMap', 'roughnessMap']) {
        if (m[k]) m[k].anisotropy = aniso;
      }
      if (CLOSED.has(m.name)) m.side = THREE.FrontSide;
      // night look: keep emissive windows / shop fronts from blooming into white
      if (m.name === 'store') m.emissiveIntensity = 0.75;
      if (m.name === 'adpanel') m.emissiveIntensity = 0.55;
      if (m.name === 'headlamp') m.emissiveIntensity = Math.min(m.emissiveIntensity, 4);
      if (m.name.startsWith('fac_')) m.emissiveIntensity = 1.15;
      if (m.name === 'shelter_glass') { m.transparent = true; m.depthWrite = false; }
    }
  });
}

/** Find a named node (first match) in a loaded scene. */
export function node(root, name) {
  return root.getObjectByName(name);
}
