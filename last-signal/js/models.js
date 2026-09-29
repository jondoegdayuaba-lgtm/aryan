// Loads the Blender-made GLB models. In the one-file desktop build they are embedded as base64.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

function fromBase64(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const embedded = window.__LS_MODELS__ && window.__LS_MODELS__[name];
  const p = embedded
    ? loader.parseAsync(fromBase64(embedded), '')
    : loader.loadAsync(new URL(`../models/${name}.glb`, import.meta.url).href);
  const out = p.then((g) => g.scene);
  cache.set(name, out);
  return out;
}

// Finds a node by name and returns its meshes (a node with several materials loads as a group).
export function meshesOf(scene, name) {
  const node = scene.getObjectByName(name);
  if (!node) return [];
  const out = [];
  node.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}
