// Loads the models made by blender/turbo_kickoff_assets.py. The one-file build
// embeds them in the page (window.TK_ASSETS); otherwise they're fetched from
// assets/models/.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = 'assets/models/';
const MODEL_FILES = ['arena', 'ball', 'car_blue', 'car_orange', 'boost_pad_small', 'boost_pad_big'];

function embedded(name) {
  return window.TK_ASSETS && window.TK_ASSETS[name];
}

async function loadBuffer(name) {
  const data = embedded(name);
  if (data) return Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)).buffer;
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`Couldn't load ${BASE}${name} (${res.status})`);
  return res.arrayBuffer();
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const models = {};
  let done = 0;
  const total = MODEL_FILES.length + 1;
  const layoutText = embedded('arena_layout.json')
    ? atob(embedded('arena_layout.json'))
    : await (await fetch(BASE + 'arena_layout.json')).text();
  const layout = JSON.parse(layoutText);
  onProgress && onProgress(++done / total);
  await Promise.all(MODEL_FILES.map(async (name) => {
    const buffer = await loadBuffer(name + '.glb');
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
    models[name] = gltf.scene;
    onProgress && onProgress(++done / total);
  }));
  return { models, layout };
}
