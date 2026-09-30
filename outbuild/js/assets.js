// Loads the Blender-made GLB files and textures and turns them into reusable prototypes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setTextures, buildLibrary, libMaterial } from './materials.js';

const BASE = 'assets/';
const MODELS = ['character', 'pieces', 'props', 'items', 'weapons', 'vehicles'];
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
        jobs.push(tl.loadAsync(`${BASE}textures/${name}.jpg`).then((tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = suffix ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          this.textures[name] = tex;
        }).catch(() => { this.missing.add(name); }).finally(tick));
      }
    }
    for (const m of MODELS) {
      jobs.push(loader.loadAsync(`${BASE}models/${m}.glb`).then((g) => { this.gltf[m] = g; })
        .catch((e) => { console.warn('missing model', m, e?.message); this.missing.add(m); }).finally(tick));
    }
    await Promise.all(jobs);
    setTextures(this.textures);
    buildLibrary();
    for (const m of MODELS) if (m !== 'character' && this.gltf[m]) this.extract(this.gltf[m].scene, m);
  }

  // Top-level nodes of a file become prototypes: a list of (geometry, material) parts plus named empties.
  extract(scene, file) {
    scene.updateMatrixWorld(true);
    for (const node of scene.children) {
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      const parts = [];
      const empties = {};
      node.traverse((o) => {
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
        name: node.name, file, parts, empties, userData: { ...node.userData }, box,
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
