// Loads the Blender-made GLB files and textures and turns them into reusable prototypes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setTextures, buildLibrary, libMaterial, flatMaterial } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = 'assets/';
// The one-file desktop build embeds every asset as a data: URL in this map.
const EMBEDDED = (typeof window !== 'undefined' && window.__OUTBUILD_ASSETS) || null;
const url = (path) => (EMBEDDED && EMBEDDED[path]) || path;
const MODELS = ['character', 'pieces', 'props', 'items', 'weapons', 'vehicles'];
// Separately animated gun parts (see blender/gun_anims.py)
const MOVER = /_(Mag|Bolt|Slide|Pump|Handle|Warhead|Shell)$/;
const TEXTURES = ['wood', 'stone', 'metal', 'siding', 'brick', 'shingles', 'floorboards', 'corrugated', 'concrete',
  'plaster', 'grass', 'dirt', 'rock', 'sand', 'bark', 'fabric', 'water'];

export class Assets {
  constructor() {
    this.gltf = {};
    this.textures = {};
    this.protos = new Map();
    this.missing = new Set();
  }

  async load(onProgress = () => {}) {
    const loader = new GLTFLoader();
    const tl = new THREE.TextureLoader();
    const jobs = [];
    let done = 0;
    const total = MODELS.length + TEXTURES.length * 2;
    const tick = () => onProgress(++done / total);
    for (const t of TEXTURES) {
      for (const suffix of ['', '_n']) {
        if (t === 'water' && suffix === '') { tick(); continue; }
        const name = t + suffix;
        jobs.push(tl.loadAsync(url(`${BASE}textures/${name}.jpg`)).then((tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = suffix ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          this.textures[name] = tex;
        }).catch(() => { this.missing.add(name); }).finally(tick));
      }
    }
    for (const m of MODELS) {
      jobs.push(loader.loadAsync(url(`${BASE}models/${m}.glb`)).then((g) => { this.gltf[m] = g; })
        .catch((e) => { console.warn('missing model', m, e?.message); this.missing.add(m); }).finally(tick));
    }
    await Promise.all(jobs);
    setTextures(this.textures);
    buildLibrary();
    for (const m of MODELS) if (m !== 'character' && this.gltf[m]) this.extract(this.gltf[m].scene, m);
    this.gunClips = gunClips(this.gltf.weapons);
  }

  // Top-level nodes of a file become prototypes: a list of (geometry, material) parts plus named empties.
  extract(scene, file) {
    scene.updateMatrixWorld(true);
    for (const node of scene.children) {
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      const parts = [];
      const empties = {};
      const movers = {};
      // the nearest ancestor (below the prototype node) that is a moving part, if any
      const moverOf = (o) => { for (let p = o; p && p !== node; p = p.parent) if (MOVER.test(p.name)) return p; return null; };
      node.traverse((o) => {
        const mv = o !== node ? moverOf(o) : null;
        if (mv) {
          let m = movers[mv.name];
          if (!m) {
            const rel = new THREE.Matrix4().multiplyMatrices(inv, mv.matrixWorld);
            const pp = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
            rel.decompose(pp, q, sc);
            // geometry is kept in the part's unscaled space (a part may rest at scale 0, hidden until a clip shows it)
            const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
            mv.matrixWorld.decompose(wp, wq, ws);
            if (Math.abs(ws.x * ws.y * ws.z) < 1e-9) ws.set(1, 1, 1);
            m = movers[mv.name] = { parts: [], position: pp, quaternion: q, scale: sc,
              inv: new THREE.Matrix4().compose(wp, wq, ws).invert() };
          }
          if (o.isMesh) {
            const g = o.geometry.clone();
            // transform relative to the part from local matrices (so a zero-scale part does not flatten it)
            const rel = new THREE.Matrix4();
            for (let q = o; q && q !== mv; q = q.parent) rel.premultiply(q.matrix);
            if (o === mv) rel.identity();
            g.applyMatrix4(rel);
            convertColors(g);
            const srcName = o.material.name || 'Default';
            g.computeBoundingBox();
            m.parts.push({ geometry: g, material: libMaterial(srcName, o.material), matName: srcName });
          }
          return;
        }
        if (o.isMesh) {
          const g = o.geometry.clone();
          const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
          if (!isIdentity(rel)) g.applyMatrix4(rel);
          convertColors(g);
          const srcName = o.material.name || 'Default';
          const material = libMaterial(srcName, o.material);
          g.computeBoundingBox();
          g.computeBoundingSphere();
          parts.push({ geometry: g, material, matName: srcName });
        } else if (o !== node && !o.isMesh) {
          const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
          const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          rel.decompose(p, q, s);
          empties[o.name] = { position: p, quaternion: q };
        }
      });
      const box = new THREE.Box3();
      for (const p of parts) box.union(p.geometry.boundingBox);
      this.protos.set(node.name, {
        name: node.name, file, parts, empties, movers, userData: { ...node.userData }, box,
        // node transform in the file (used for things like the airship propellers)
        position: node.position.clone(), quaternion: node.quaternion.clone(),
      });
    }
  }

  has(name) { return this.protos.has(name); }

  proto(name) {
    let p = this.protos.get(name);
    if (!p) {
      p = placeholder(name);
      this.protos.set(name, p);
    }
    return p;
  }

  // Single-draw-call version of a prototype (tints: material name -> colour). Geometry is cached.
  flat(name, { tints = {}, shadows = true } = {}) {
    const p = this.proto(name);
    this.flatCache = this.flatCache || new Map();
    const key = name + JSON.stringify(tints);
    let geo = this.flatCache.get(key);
    if (!geo) {
      geo = p.placeholder ? p.parts[0].geometry : flattenProto(p, tints);
      this.flatCache.set(key, geo);
    }
    const g = new THREE.Group();
    g.name = name;
    const mesh = new THREE.Mesh(geo, p.placeholder ? p.parts[0].material : flatMaterial());
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    g.add(mesh);
    for (const [en, e] of Object.entries(p.empties)) {
      const o = new THREE.Object3D();
      o.name = en;
      o.position.copy(e.position);
      o.quaternion.copy(e.quaternion);
      g.add(o);
    }
    g.userData = { ...p.userData };
    this.addMovers(g, p, tints, shadows);
    return g;
  }

  // Moving gun parts as their own meshes, plus what the character needs to play the gun's clips.
  addMovers(g, p, tints, shadows) {
    const movers = p.movers || {};
    const names = Object.keys(movers);
    if (!names.length && !(this.gunClips && this.gunClips[p.name])) return;
    const nodes = {}, rest = {};
    for (const n of names) {
      const mv = movers[n];
      const key = p.name + '|' + n + JSON.stringify(tints);
      let geo = this.flatCache.get(key);
      if (!geo) { geo = flattenProto({ parts: mv.parts }, tints); this.flatCache.set(key, geo); }
      const o = new THREE.Group();
      o.name = n;
      const mesh = new THREE.Mesh(geo, flatMaterial());
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      o.add(mesh);
      o.position.copy(mv.position);
      o.quaternion.copy(mv.quaternion);
      o.scale.copy(mv.scale);
      g.add(o);
    }
    for (const c of g.children) {
      if (c.name.endsWith('_Hand') || MOVER.test(c.name)) {
        nodes[c.name] = c;
        rest[c.name] = { p: c.position.clone(), q: c.quaternion.clone(), s: c.scale.clone() };
      }
    }
    const ud = p.userData || {};
    g.userData.gun = { name: p.name, clips: (this.gunClips && this.gunClips[p.name]) || {}, nodes, rest, atRest: false,
      magDropAt: ud.mag_drop_at, ejectAt: ud.eject_at || 0, shell: ud.shell || 'brass' };
  }

  // A plain (non-instanced) Object3D built from a prototype. Materials can be overridden per part name.
  instance(name, { override = null, shadows = true } = {}) {
    const p = this.proto(name);
    const g = new THREE.Group();
    g.name = name;
    for (const part of p.parts) {
      const mat = (override && override(part.matName, part.material)) || part.material;
      const m = new THREE.Mesh(part.geometry, mat);
      m.castShadow = shadows;
      m.receiveShadow = true;
      m.userData.matName = part.matName;
      g.add(m);
    }
    for (const [n, mv] of Object.entries(p.movers || {})) {
      const o = new THREE.Group();
      o.name = n;
      for (const part of mv.parts) {
        const m = new THREE.Mesh(part.geometry, (override && override(part.matName, part.material)) || part.material);
        m.castShadow = shadows;
        m.userData.matName = part.matName;
        o.add(m);
      }
      o.position.copy(mv.position);
      o.quaternion.copy(mv.quaternion);
      o.scale.copy(mv.scale);
      g.add(o);
    }
    for (const [en, e] of Object.entries(p.empties)) {
      const o = new THREE.Object3D();
      o.name = en;
      o.position.copy(e.position);
      o.quaternion.copy(e.quaternion);
      g.add(o);
    }
    g.userData = { ...p.userData };
    return g;
  }
}

const avgCache = new Map();
function avgTexColor(tex) {
  if (!tex || !tex.image) return null;
  if (avgCache.has(tex)) return avgCache.get(tex);
  let col = null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const x = c.getContext('2d');
    x.drawImage(tex.image, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 64; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
    col = new THREE.Color().setRGB(r / 64 / 255, g / 64 / 255, b / 64 / 255, THREE.SRGBColorSpace);
  } catch { col = null; }
  avgCache.set(tex, col);
  return col;
}

// Merge all parts of a prototype into one geometry with per-vertex colour / roughness / metalness / glow.
export function flattenProto(proto, tints = {}) {
  const list = [];
  const c = new THREE.Color();
  for (const part of proto.parts) {
    const m = part.material;
    const src = part.geometry;
    const g = new THREE.BufferGeometry();
    g.setIndex(src.index ? src.index.clone() : null);
    g.setAttribute('position', src.attributes.position.clone());
    g.setAttribute('normal', src.attributes.normal.clone());
    g.setAttribute('aAO', src.attributes.aAO.clone());
    const n = src.attributes.position.count;
    if (tints[part.matName]) c.set(tints[part.matName]);
    else {
      c.copy(m.color || new THREE.Color(1, 1, 1));
      const t = avgTexColor(m.map || m.userData.triMap);
      if (t) c.multiply(t);
    }
    let glow = 0;
    if (m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05) {
      glow = m.emissiveIntensity * 0.8;
      if (!tints[part.matName]) c.copy(m.emissive);
    }
    const col = new Float32Array(n * 3), rm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      rm[i * 3] = m.roughness ?? 0.7; rm[i * 3 + 1] = m.metalness ?? 0; rm[i * 3 + 2] = glow;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRM', new THREE.BufferAttribute(rm, 3));
    if (!g.index) g.setIndex([...Array(n).keys()]);
    list.push(g);
  }
  const merged = mergeGeometries(list, false);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

function isIdentity(m) {
  const e = m.elements;
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - id[i]) > 1e-6) return false;
  return true;
}

// COLOR_0 from Blender holds (AO, wind, 1). Split it into named attributes the shaders read.
export function convertColors(g) {
  const n = g.attributes.position.count;
  const ao = new Float32Array(n).fill(1);
  const wind = new Float32Array(n);
  const c = g.attributes.color;
  if (c) {
    for (let i = 0; i < n; i++) {
      ao[i] = c.getX(i);
      wind[i] = c.getY(i);
    }
    g.deleteAttribute('color');
  }
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('aWind', new THREE.BufferAttribute(wind, 1));
}

const PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.6 });
function placeholder(name) {
  const g = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  g.translate(0, 0.3, 0);
  convertColors(g);
  g.computeBoundingBox();
  return { name, parts: [{ geometry: g, material: PLACEHOLDER_MAT, matName: 'Placeholder' }], empties: {},
    userData: { col: 'box', sx: 0.6, sy: 0.6, sz: 0.6, hp: 50, mat: 'wood' }, box: g.boundingBox.clone(),
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), placeholder: true };
}

// Gun clips from weapons.glb: { W_AR: { Fire: { duration, tracks: [{ node, prop, values, size, times }] }, Reload } }
function gunClips(gltf) {
  const out = {};
  if (!gltf) return out;
  for (const clip of gltf.animations || []) {
    const m = /^(.*)_(Fire|Reload)$/.exec(clip.name);
    if (!m) continue;
    const tracks = [];
    for (const tr of clip.tracks) {
      const dot = tr.name.lastIndexOf('.');
      tracks.push({ node: tr.name.slice(0, dot), prop: tr.name.slice(dot + 1), values: tr.values, size: tr.getValueSize(),
        times: tr.times, frames: tr.times.length });
    }
    (out[m[1]] = out[m[1]] || {})[m[2]] = { duration: clip.duration, tracks };
  }
  return out;
}
