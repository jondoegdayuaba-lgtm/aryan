// Static world props (trees, rocks, cars, crates...): instanced with a near/far level of detail,
// with colliders, hit points, harvesting and destruction.
import * as THREE from 'three';
import { Collider, CYL, OBB } from './physics.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { farMaterial, textureTint } from './materials.js';

const NEAR = 130;          // metres: full detail + shadows inside this radius
const TINTABLE = new Set(['CarPaint', 'MetalPainted', 'GliderFabric']);

// Vertex-clustering simplifier for the far LOD.
export function simplify(src, cell) {
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const ao = src.attributes.aAO;
  const wind = src.attributes.aWind;
  const idx = src.index ? src.index.array : [...Array(pos.count).keys()];
  const map = new Map();
  const cl = [];
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor ? nor.getX(i) : 0, ny = nor ? nor.getY(i) : 1, nz = nor ? nor.getZ(i) : 0;
    // keep opposite-facing sheets apart so thin shells don't collapse into each other
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const dirKey = ay >= ax && ay >= az ? (ny > 0 ? 0 : 1) : ax >= az ? (nx > 0 ? 2 : 3) : (nz > 0 ? 4 : 5);
    const k = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)},${dirKey}`;
    let c = map.get(k);
    if (c === undefined) {
      c = cl.length;
      map.set(k, c);
      cl.push({ x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, ao: 0, w: 0, n: 0 });
    }
    const o = cl[c];
    o.x += x; o.y += y; o.z += z; o.nx += nx; o.ny += ny; o.nz += nz;
    o.ao += ao ? ao.getX(i) : 1; o.w += wind ? wind.getX(i) : 0; o.n++;
    vid[i] = c;
  }
  const P = new Float32Array(cl.length * 3), N = new Float32Array(cl.length * 3);
  const A = new Float32Array(cl.length), W = new Float32Array(cl.length);
  cl.forEach((o, i) => {
    P[i * 3] = o.x / o.n; P[i * 3 + 1] = o.y / o.n; P[i * 3 + 2] = o.z / o.n;
    const l = Math.hypot(o.nx, o.ny, o.nz) || 1;
    N[i * 3] = o.nx / l; N[i * 3 + 1] = o.ny / l; N[i * 3 + 2] = o.nz / l;
    A[i] = o.ao / o.n; W[i] = o.w / o.n;
  });
  const out = [];
  const seen = new Set();
  for (let t = 0; t < idx.length; t += 3) {
    const a = vid[idx[t]], b = vid[idx[t + 1]], c = vid[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((u, v) => u - v).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aAO', new THREE.BufferAttribute(A, 1));
  g.setAttribute('aWind', new THREE.BufferAttribute(W, 1));
  g.setIndex(out);
  g.computeBoundingSphere();
  return g;
}

// Average colour of a texture image (linear), cached.
const tintCache = new Map();
function averageTexture(tex) {
  if (!tex || !tex.image) return null;
  if (tintCache.has(tex)) return tintCache.get(tex);
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
  tintCache.set(tex, col);
  return col;
}

// One merged, vertex-coloured, simplified geometry for the far level of detail.
function farGeometry(parts, cell) {
  const list = [];
  for (const p of parts) {
    // leaf cards fall apart when simplified; the far tree keeps its leaf volume instead
    if (/^LeafCard/.test(p.matName)) continue;
    const g = simplify(p.geometry, cell);
    if (!g.index || g.index.count === 0) continue;
    const c = p.material.color ? p.material.color.clone() : new THREE.Color(1, 1, 1);
    const t = averageTexture(textureTint(p.matName) || p.material.map);
    if (t) c.multiply(t);
    if (p.material.emissive && p.material.emissiveIntensity > 0.5) c.add(p.material.emissive.clone().multiplyScalar(0.5));
    const n = g.attributes.position.count;
    const tint = TINTABLE.has(p.matName) ? 1 : 0;
    if (tint) c.setRGB(1, 1, 1);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
    list.push(g);
  }
  if (!list.length) return null;
  const m = mergeGeometries(list, false);
  m.computeBoundingSphere();
  return m;
}

class LodBatch {
  constructor(scene, parts, count, castShadow, name) {
    this.meshes = parts.map((part) => {
      const m = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, count));
      m.count = 0;
      m.castShadow = castShadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.name = name;
      m.userData.tint = TINTABLE.has(part.matName) || part.matName === 'FarTint';
      if (m.userData.tint) m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    });
    this.count = 0;
  }

  begin() { this.count = 0; }

  push(matrix, color) {
    const i = this.count++;
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      if (m.userData.tint && color) m.setColorAt(i, color);
    }
    return i;
  }

  set(i, matrix) { for (const m of this.meshes) m.setMatrixAt(i, matrix); }

  end() {
    for (const m of this.meshes) {
      m.count = this.count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      // cull whole batch cheaply
      m.visible = this.count > 0;
    }
  }

  touch() { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
}

let propId = 1;

export class PropSystem {
  constructor(scene, physics, assets) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;
    this.types = new Map();  // name -> { proto, list, near, far }
    this.all = [];
    this.shaking = new Set();
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.drawDist = 800;
    this.onDestroyed = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  add(name, x, y, z, yaw = 0, scale = 1, opts = {}) {
    let type = this.types.get(name);
    if (!type) {
      type = { name, proto: this.assets.proto(name), list: [] };
      this.types.set(name, type);
    }
    const ud = type.proto.userData;
    const prop = {
      id: propId++, type, name, x, y, z, yaw, scale, tint: opts.tint ? new THREE.Color(opts.tint) : null,
      hp: (ud.hp || 100) * (opts.hpScale || 1), mat: ud.mat || 'wood', alive: true, shake: 0, colliders: [],
      batch: null, index: -1, harvest: opts.harvest !== false, sway: 0,
    };
    prop.maxHp = prop.hp;
    this.addColliders(prop, ud);
    type.list.push(prop);
    this.all.push(prop);
    return prop;
  }

  addColliders(prop, ud) {
    const s = prop.scale;
    let c = null;
    if (ud.col === 'cyl') {
      c = new Collider(CYL, { cx: prop.x, cz: prop.z, r: (ud.r || 0.4) * s, minY: prop.y - 0.5, maxY: prop.y + (ud.h || 2) * s });
    } else if (ud.col === 'box') {
      c = new Collider(OBB, {
        cx: prop.x, cz: prop.z, hx: (ud.sx || 1) * s / 2, hz: (ud.sy || 1) * s / 2, c: Math.cos(prop.yaw),
        s: -Math.sin(prop.yaw), minY: prop.y - 0.3, maxY: prop.y + (ud.sz || 1) * s,
      });
    } else {
      // walk-through (bushes): still harvestable with the pickaxe
      const r = Math.max(0.4, (prop.type.proto.box.max.x - prop.type.proto.box.min.x) * 0.4 * s);
      c = new Collider(CYL, { cx: prop.x, cz: prop.z, r, minY: prop.y, maxY: prop.y + (prop.type.proto.box.max.y || 1) * s });
      c.blocksMove = false;
      c.blocksShots = false;
      c.soft = true;
    }
    if (prop.noCollide) c.blocksMove = false;
    c.owner = prop;
    c.kind = 'prop';
    prop.colliders.push(c);
    this.physics.add(c);
  }

  // Build the instanced meshes once all props are placed.
  finalize() {
    for (const type of this.types.values()) {
      const n = type.list.length;
      const parts = type.proto.parts;
      const size = type.proto.box.getSize(new THREE.Vector3());
      const cell = Math.max(0.35, Math.max(size.x, size.y, size.z) / 4.5);
      const fg = farGeometry(parts, cell);
      const tintable = parts.some((p) => TINTABLE.has(p.matName));
      const farParts = fg ? [{ geometry: fg, material: farMaterial(), matName: tintable ? 'FarTint' : 'Far' }] : parts;
      type.near = new LodBatch(this.scene, parts, n, true, type.name);
      type.far = new LodBatch(this.scene, farParts, n, false, type.name + '_far');
      // big landmarks are visible from far away, small things fade out sooner
      type.farDist = Math.max(size.x, size.y, size.z) > 6 ? 5000 : Math.max(size.y, 1.5) * 90;
    }
    this.updateLod(new THREE.Vector3(0, 0, 0), true);
  }

  matrixOf(p, out) {
    let yaw = p.yaw;
    this._q.setFromAxisAngle(this._up, yaw);
    if (p.shake > 0) {
      const a = Math.sin(p.shake * 40) * p.shake * 0.06;
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, a * 0.6));
      this._q.multiply(q2);
    }
    if (p.fall) {
      const q3 = new THREE.Quaternion().setFromAxisAngle(p.fallAxis, p.fall);
      this._q.premultiply(q3);
    }
    let s = p.scale;
    if (p.dying) s *= Math.max(0.001, p.dying);
    this._s.setScalar(s);
    this._p.set(p.x, p.y, p.z);
    return out.compose(this._p, this._q, this._s);
  }

  updateLod(cam, force = false) {
    if (!force && cam.distanceToSquared(this.lastCam) < 64) return;
    this.lastCam.copy(cam);
    const near2 = NEAR * NEAR;
    for (const type of this.types.values()) {
      type.near.begin();
      type.far.begin();
      const fd2 = Math.min(type.farDist, this.drawDist) ** 2;
      for (const p of type.list) {
        if (!p.alive && !p.dying) { p.batch = null; continue; }
        const d2 = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
        this.matrixOf(p, this._m);
        if (d2 < near2 || p.dying) { p.batch = type.near; p.index = type.near.push(this._m, p.tint); }
        else if (d2 < fd2) { p.batch = type.far; p.index = type.far.push(this._m, p.tint); }
        else p.batch = null;
      }
      type.near.end();
      type.far.end();
    }
  }

  // Returns { destroyed, amount } where amount is harvested material count.
  damage(prop, amount, { harvest = false } = {}) {
    if (!prop.alive) return { destroyed: false };
    prop.hp -= amount;
    prop.shake = 1;
    this.shaking.add(prop);
    if (prop.hp <= 0) {
      this.destroy(prop);
      return { destroyed: true };
    }
    return { destroyed: false };
  }

  destroy(prop) {
    if (!prop.alive) return;
    prop.alive = false;
    for (const c of prop.colliders) this.physics.remove(c);
    prop.colliders.length = 0;
    // trees topple, everything else shrinks away
    const isTree = prop.name.startsWith('Tree');
    if (isTree) {
      prop.fall = 0.001;
      const a = Math.random() * Math.PI * 2;
      prop.fallAxis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    }
    prop.dying = 1;
    this.shaking.add(prop);
    this.lastCam.set(1e9, 0, 0); // force LOD rebuild so it moves to the near batch
    if (this.onDestroyed) this.onDestroyed(prop);
  }

  update(dt, cam) {
    this.updateLod(cam);
    if (!this.shaking.size) return;
    const touched = new Set();
    for (const p of this.shaking) {
      if (p.shake > 0) p.shake = Math.max(0, p.shake - dt * 3.5);
      if (p.fall !== undefined && p.dying) {
        p.fall = Math.min(Math.PI / 2, p.fall + dt * (0.6 + p.fall * 3));
        if (p.fall >= Math.PI / 2 - 0.01) p.dying -= dt * 1.5;
      } else if (p.dying) {
        p.dying -= dt * 3;
      }
      if (p.dying !== undefined && p.dying <= 0) {
        p.dying = 0;
        this.shaking.delete(p);
        this.lastCam.set(1e9, 0, 0);
        continue;
      }
      if (p.batch) {
        this.matrixOf(p, this._m);
        p.batch.set(p.index, this._m);
        touched.add(p.batch);
      }
      if (p.shake <= 0 && !p.dying) this.shaking.delete(p);
    }
    for (const b of touched) b.touch();
  }

  setDrawDist(d) { this.drawDist = d; this.lastCam.set(1e9, 0, 0); }

  dispose() {
    for (const type of this.types.values()) {
      for (const b of [type.near, type.far]) {
        if (!b) continue;
        for (const m of b.meshes) { this.scene.remove(m); m.dispose(); }
      }
      for (const p of type.list) for (const c of p.colliders) this.physics.remove(c);
    }
    this.types.clear();
    this.all.length = 0;
    this.shaking.clear();
  }
}
