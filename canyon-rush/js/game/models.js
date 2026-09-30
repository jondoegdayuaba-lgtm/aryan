// The 3D models made in Blender (see tools/blender/). They're loaded once at
// start-up; the one-file build carries them inline (base64, in
// window.__CANYON_MODELS__), otherwise they're fetched from models/.
import { GLTFLoader } from '../../../vendor/three/addons/loaders/GLTFLoader.js';

export const MODEL_FILES = ['rider.glb', 'bike-volt.glb', 'bike-sting.glb', 'bike-storm.glb'];

const cache = new Map();

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function load(name) {
  const inline = globalThis.__CANYON_MODELS__?.[name];
  let data;
  if (inline) data = fromBase64(inline);
  else {
    const res = await fetch(`models/${name}`);
    if (!res.ok) throw new Error(`couldn't load models/${name} (${res.status})`);
    data = await res.arrayBuffer();
  }
  return new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
}

export async function loadModels(onProgress) {
  let done = 0;
  await Promise.all(MODEL_FILES.map(async (name) => {
    cache.set(name, await load(name));
    onProgress?.(++done / MODEL_FILES.length);
  }));
}

// The parsed glTF (scene, etc.); clone its scene before use.
export function getModel(name) {
  const m = cache.get(name);
  if (!m) throw new Error(`model ${name} not loaded`);
  return m;
}
