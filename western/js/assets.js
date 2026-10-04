// Loads everything Blender exported (see blender/build_assets.py).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The one-file desktop build (tools/build-western.mjs) embeds every asset as
// gzipped base64 in window.__EMBEDDED_ASSETS; otherwise they're fetched.
export async function loadBytes(path) {
  return bytes(path);
}

async function bytes(path) {
  const emb = window.__EMBEDDED_ASSETS?.[path];
  if (emb) {
    const raw = Uint8Array.from(atob(emb), (c) => c.charCodeAt(0));
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.arrayBuffer();
}

const MIME = { jpg: 'image/jpeg', png: 'image/png' };
async function assetUrl(path) {
  if (!window.__EMBEDDED_ASSETS?.[path]) return path;
  const type = MIME[path.split('.').pop()] || 'application/octet-stream';
  return URL.createObjectURL(new Blob([await bytes(path)], { type }));
}

export async function loadAssets(progress) {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const steps = 12;
  let done = 0;
  const tick = (label) => progress(++done / steps, label);

  const glb = (name, label) => bytes(`assets/${name}.glb`).then((buf) => loader.parseAsync(buf, '')).then((g) => { tick(label); return g; });
  const tex = (name) => assetUrl(`assets/textures/${name}.jpg`).then((u) => tl.loadAsync(u)).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    tick('Painting the ground');
    return t;
  });
  const json = bytes('assets/world.json').then((b) => JSON.parse(new TextDecoder().decode(b)))
    .then((j) => { tick('Reading the map'); return j; });
  const bin = bytes('assets/terrain.bin').then((b) => { tick('Raising the hills'); return b; });
  const mapImg = assetUrl('assets/map.jpg').then((src) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { tick('Unfolding the map'); res(img); };
    img.onerror = () => res(null);
    img.src = src;
  }));

  const [cowboy, horse, deer, props, mountains, world, terrain, grass, dirt, rock, snow, map] = await Promise.all([
    glb('cowboy', 'Dressing the outlaws'), glb('horse', 'Shoeing the horses'), glb('deer', 'Spotting deer'),
    glb('props', 'Raising the town'), glb('mountains', 'Piling up mountains'), json, bin,
    tex('grass'), tex('dirt'), tex('rock'), tex('snow'), mapImg,
  ]);
  return { cowboy, horse, deer, props, mountains, world, terrain, tex: { grass, dirt, rock, snow }, map };
}

// Geometry of a props.glb node with its children's transforms baked in,
// one entry per material. Used for instancing.
export function meshParts(root) {
  const parts = [];
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    parts.push({ geometry: g, material: o.material });
  });
  return parts;
}

// Average colour of a material: its colour times its texture's mean colour.
const avgCache = new Map();
export function materialColor(mat) {
  const c = mat.color.clone();
  const img = mat.map && mat.map.image;
  if (!img) return c;
  let avg = avgCache.get(img);
  if (!avg) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 4;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    avg = new THREE.Color().setRGB(r / 16 / 255, g / 16 / 255, b / 16 / 255, THREE.SRGBColorSpace);
    avgCache.set(img, avg);
  }
  return c.multiply(avg);
}

function withColor(geometry, color, keep) {
  const g = geometry.clone();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (keep.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  return g;
}

// One vertex-coloured geometry from a multi-material model (for instancing).
export function bakedGeometry(parts) {
  return mergeGeometries(parts.map(({ geometry, material }) => withColor(geometry, materialColor(material), ['position', 'normal', 'color'])));
}

const SKIN_KEEP = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
const skinMats = new Map();

// Merge a rigged model's visible skinned pieces into one SkinnedMesh per
// texture atlas (plus one per name in `separate`, which stay toggleable).
// Each material's colour moves into vertex colours, multiplied by the shared
// atlas in the shader. Cuts a character from ~20 draw calls to a handful.
export function mergeSkinned(root, separate = []) {
  const groups = new Map();
  const drop = [];
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    let p = o;
    let part = null;
    let visible = true;
    while (p && p !== root) {
      if (!p.visible) visible = false;
      if (separate.includes(p.name)) part = p;
      p = p.parent;
    }
    drop.push(o);
    if (!visible && !part) return;
    const key = part ? part.name : '';
    if (!groups.has(key)) groups.set(key, { meshes: [], parent: part });
    groups.get(key).meshes.push(o);
  });
  for (const { meshes, parent } of groups.values()) {
    const map = meshes[0].material.map || null;
    const merged = mergeGeometries(meshes.map((m) => withColor(m.geometry, map ? m.material.color : materialColor(m.material), SKIN_KEEP)));
    if (!merged) continue;
    let mat = skinMats.get(map);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.78, side: THREE.DoubleSide });
      skinMats.set(map, mat);
    }
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.bind(meshes[0].skeleton, meshes[0].bindMatrix);
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.frustumCulled = false;
    (parent || meshes[0].parent).add(sm);
  }
  for (const o of drop) o.removeFromParent();
}
