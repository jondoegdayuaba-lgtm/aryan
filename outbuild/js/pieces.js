// Grid building: player builds and the island's houses share one system.
// Pieces are drawn with one InstancedMesh per model part, collide through physics.js colliders,
// build up over time, take damage, and collapse when nothing connects them to the ground.
import * as THREE from 'three';
import { GRID, MATS, BUILD_COST } from './config.js';
import { Collider, BOX, RAMP, CONE } from './physics.js';

const S = GRID.cell;
const H = GRID.level;

// model name -> piece info
export const MODELS = {
  Wall_wood: { kind: 'wall', mat: 'wood' }, Wall_stone: { kind: 'wall', mat: 'stone' },
  Wall_metal: { kind: 'wall', mat: 'metal' },
  Floor_wood: { kind: 'floor', mat: 'wood' }, Floor_stone: { kind: 'floor', mat: 'stone' },
  Floor_metal: { kind: 'floor', mat: 'metal' },
  Ramp_wood: { kind: 'ramp', mat: 'wood' }, Ramp_stone: { kind: 'ramp', mat: 'stone' },
  Ramp_metal: { kind: 'ramp', mat: 'metal' },
  Cone_wood: { kind: 'cone', mat: 'wood' }, Cone_stone: { kind: 'cone', mat: 'stone' },
  Cone_metal: { kind: 'cone', mat: 'metal' },
  HouseWall: { kind: 'wall', mat: 'wood', hp: 180 },
  HouseWallWindow: { kind: 'wall', mat: 'wood', opening: 'window', hp: 160 },
  HouseWallDoor: { kind: 'wall', mat: 'wood', opening: 'door', hp: 160 },
  BrickWall: { kind: 'wall', mat: 'stone', hp: 280 },
  BrickWallWindow: { kind: 'wall', mat: 'stone', opening: 'window', hp: 250 },
  BrickWallDoor: { kind: 'wall', mat: 'stone', opening: 'door', hp: 250 },
  MetalWall: { kind: 'wall', mat: 'metal', hp: 350 },
  MetalWallDoor: { kind: 'wall', mat: 'metal', opening: 'door', hp: 320 },
  MetalWallGarage: { kind: 'wall', mat: 'metal', opening: 'garage', hp: 300 },
  HouseFloor: { kind: 'floor', mat: 'wood', hp: 180 },
  ConcreteFloor: { kind: 'floor', mat: 'stone', hp: 320 },
  Roof: { kind: 'ramp', mat: 'wood', hp: 150 },
  RoofCone: { kind: 'cone', mat: 'wood', hp: 150 },
  Stairs: { kind: 'ramp', mat: 'wood', hp: 150 },
};

export const BUILD_MODEL = (kind, mat) => `${kind[0].toUpperCase()}${kind.slice(1)}_${mat}`;

// Wall openings in local wall coordinates (x across the wall centre, y up from the base).
const OPENINGS = {
  window: [-0.65, 0.65, 1.0, 2.2],
  door: [-0.6, 0.6, 0.0, 2.3],
  garage: [-1.5, 1.5, 0.0, 2.6],
};

// ----------------------------------------------------------------------------- instanced batches

const PIECE_PATCH_VS = /* glsl */`
attribute vec2 aState;
varying vec2 vState;
varying float vLocalY;`;

function patchPiece(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + PIECE_PATCH_VS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvState = aState;\nvLocalY = position.y;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vState;\nvarying float vLocalY;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float fillY = mix(-0.35, 3.2, vState.x);
      bool blueprint = vState.x < 0.999 && vLocalY > fillY;
      if (blueprint) {
        vec2 fc = floor(gl_FragCoord.xy);
        if (mod(fc.x + fc.y, 2.0) < 1.0) discard;
      }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (blueprint) {
        totalEmissiveRadiance += vec3(0.25, 0.6, 1.4) * 0.55;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.6, 1.0), 0.6);
      }
      totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * vState.y * 0.45;
      // glowing fill line while building
      if (vState.x < 0.999) totalEmissiveRadiance += vec3(0.4, 0.8, 1.6) * smoothstep(0.12, 0.0, abs(vLocalY - fillY)) * 1.5;`);
}

const pieceMatCache = new Map();
function pieceMaterial(base) {
  let m = pieceMatCache.get(base);
  if (!m) {
    m = base.clone();
    const prev = base.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { prev.call(base, sh, r); patchPiece(sh); };
    const key = base.customProgramCacheKey();
    m.customProgramCacheKey = () => 'piece|' + key;
    pieceMatCache.set(base, m);
  }
  return m;
}

class Batch {
  constructor(scene, proto, capacity = 64) {
    this.scene = scene;
    this.proto = proto;
    this.items = [];
    this.meshes = [];
    this.capacity = 0;
    this.grow(capacity);
  }

  grow(cap) {
    const old = this.meshes;
    this.meshes = this.proto.parts.map((part, i) => {
      const geo = part.geometry.clone();
      const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      state.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aState', state);
      const mesh = new THREE.InstancedMesh(geo, pieceMaterial(part.material), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = true;
      mesh.castShadow = !part.material.transparent;
      mesh.receiveShadow = true;
      if (old[i]) {
        mesh.instanceMatrix.array.set(old[i].instanceMatrix.array.subarray(0, this.capacity * 16));
        mesh.instanceColor.array.set(old[i].instanceColor.array.subarray(0, this.capacity * 3));
        state.array.set(old[i].geometry.attributes.aState.array.subarray(0, this.capacity * 2));
        mesh.count = old[i].count;
        mesh.visible = mesh.count > 0;
        this.scene.remove(old[i]);
        old[i].geometry.dispose();
        old[i].dispose();
      }
      this.scene.add(mesh);
      return mesh;
    });
    this.capacity = cap;
  }

  add(piece, matrix, color) {
    if (this.items.length >= this.capacity) this.grow(this.capacity * 2);
    const i = this.items.length;
    this.items.push(piece);
    piece.batch = this;
    piece.index = i;
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.setColorAt(i, color);
      m.count = this.items.length;
      m.visible = true;
      m.boundingSphere = null;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.setState(i, piece.progress, 0);
  }

  remove(piece) {
    const i = piece.index;
    const last = this.items.length - 1;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    if (i !== last) {
      const moved = this.items[last];
      this.items[i] = moved;
      moved.index = i;
      for (const m of this.meshes) {
        m.getMatrixAt(last, mtx);
        m.setMatrixAt(i, mtx);
        m.getColorAt(last, col);
        m.setColorAt(i, col);
        const st = m.geometry.attributes.aState;
        st.array[i * 2] = st.array[last * 2];
        st.array[i * 2 + 1] = st.array[last * 2 + 1];
        st.needsUpdate = true;
      }
    }
    this.items.pop();
    for (const m of this.meshes) {
      m.count = this.items.length;
      m.visible = this.items.length > 0;
      m.boundingSphere = null;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    piece.batch = null;
  }

  setState(i, progress, flash) {
    for (const m of this.meshes) {
      const st = m.geometry.attributes.aState;
      st.array[i * 2] = progress;
      st.array[i * 2 + 1] = flash;
      st.needsUpdate = true;
    }
  }

  setMatrix(i, matrix) {
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

// ----------------------------------------------------------------------------- pieces

let pieceId = 1;

export class Piece {
  constructor(model, slot) {
    this.id = pieceId++;
    this.model = model;
    const info = MODELS[model];
    this.kind = info.kind;
    this.mat = info.mat;
    this.opening = info.opening || null;
    Object.assign(this, slot); // ix, iy, iz, axis|dir
    this.maxHp = info.hp || MATS[this.mat].hp;
    this.hp = this.maxHp;
    this.progress = 1;
    this.buildRate = 0;
    this.colliders = [];
    this.flash = 0;
    this.alive = true;
    this.house = false;
    this.owner = null;
  }

  get key() { return slotKey(this.kind, this); }
}

export function slotKey(kind, s) {
  switch (kind) {
    case 'wall': return `w${s.axis}:${s.ix}:${s.iy}:${s.iz}`;
    case 'floor': return `f:${s.ix}:${s.iy}:${s.iz}`;
    default: return `m:${s.ix}:${s.iy}:${s.iz}`;
  }
}

// World transform of a piece slot.
export function slotTransform(kind, s, out = new THREE.Matrix4()) {
  const pos = new THREE.Vector3();
  let rot = 0;
  if (kind === 'wall') {
    if (s.axis === 0) pos.set(s.ix * S + S / 2, s.iy * H, s.iz * S);
    else { pos.set(s.ix * S, s.iy * H, s.iz * S + S / 2); rot = Math.PI / 2; }
  } else {
    pos.set(s.ix * S + S / 2, s.iy * H, s.iz * S + S / 2);
    if (kind === 'ramp' || kind === 'cone') rot = (s.dir || 0) * Math.PI / 2;
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  return out.compose(pos, q, new THREE.Vector3(1, 1, 1));
}

// Axis-aligned bounds of a slot (used for support checks).
export function slotBounds(kind, s) {
  const y0 = s.iy * H;
  if (kind === 'wall') {
    const t = GRID.wallHalfThick;
    if (s.axis === 0) return { minX: s.ix * S, maxX: s.ix * S + S, minY: y0, maxY: y0 + H, minZ: s.iz * S - t, maxZ: s.iz * S + t };
    return { minX: s.ix * S - t, maxX: s.ix * S + t, minY: y0, maxY: y0 + H, minZ: s.iz * S, maxZ: s.iz * S + S };
  }
  const b = { minX: s.ix * S, maxX: s.ix * S + S, minZ: s.iz * S, maxZ: s.iz * S + S };
  if (kind === 'floor') return { ...b, minY: y0 - GRID.floorThick, maxY: y0 };
  if (kind === 'ramp') return { ...b, minY: y0 - GRID.rampThick, maxY: y0 + H };
  return { ...b, minY: y0 - 0.2, maxY: y0 + GRID.coneHeight };
}

function makeColliders(p) {
  const out = [];
  const b = slotBounds(p.kind, p);
  if (p.kind === 'wall') {
    const hole = p.opening && OPENINGS[p.opening];
    if (!hole) {
      out.push(new Collider(BOX, { ...b }));
    } else {
      const [x0, x1, y0h, y1h] = hole;
      const y0 = p.iy * H;
      // split into boxes around the hole, along the wall's length axis
      const along = p.axis === 0 ? ['minX', 'maxX'] : ['minZ', 'maxZ'];
      const c = p.axis === 0 ? p.ix * S + S / 2 : p.iz * S + S / 2;
      const segs = [
        [c - S / 2, c + x0, y0, y0 + H],
        [c + x1, c + S / 2, y0, y0 + H],
        [c + x0, c + x1, y0 + y1h, y0 + H],
      ];
      if (y0h > 0.01) segs.push([c + x0, c + x1, y0, y0 + y0h]);
      for (const [a0, a1, yy0, yy1] of segs) {
        if (a1 - a0 < 0.01 || yy1 - yy0 < 0.01) continue;
        const bb = { ...b, minY: yy0, maxY: yy1 };
        bb[along[0]] = a0;
        bb[along[1]] = a1;
        out.push(new Collider(BOX, bb));
      }
    }
  } else if (p.kind === 'floor') {
    out.push(new Collider(BOX, { ...b }));
  } else if (p.kind === 'ramp') {
    out.push(new Collider(RAMP, { ...b, y0: p.iy * H, dir: p.dir || 0, thick: GRID.rampThick }));
  } else {
    out.push(new Collider(CONE, { ...b, y0: p.iy * H, thick: 0.2 }));
  }
  for (const c of out) { c.owner = p; c.kind = 'piece'; }
  return out;
}

export class PieceSystem {
  constructor(scene, physics, terrain, assets) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.assets = assets;
    this.pieces = new Map();   // slot key -> piece
    this.batches = new Map();  // model -> Batch
    this.active = new Set();   // pieces building or flashing
    this.collapseQueue = [];
    this.onDestroyed = null;   // (piece, cause) => {}
    this.onPlaced = null;
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  // One batch per model per 128 m region, so whole towns can be frustum culled (camera and shadows).
  batch(model, slot) {
    const rx = Math.floor((slot.ix * S) / 128), rz = Math.floor((slot.iz * S) / 128);
    const key = model + '|' + rx + ',' + rz;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(this.scene, this.assets.proto(model), MODELS[model].kind === 'wall' ? 64 : 32);
      this.batches.set(key, b);
    }
    return b;
  }

  occupied(kind, slot) { return this.pieces.has(slotKey(kind, slot)); }
  get(kind, slot) { return this.pieces.get(slotKey(kind, slot)); }

  // Add a piece. opts: { color, owner, house, build: seconds (0 = instant) }
  add(model, slot, opts = {}) {
    const p = new Piece(model, slot);
    const key = p.key;
    if (this.pieces.has(key)) return null;
    p.house = !!opts.house;
    p.owner = opts.owner || null;
    if (opts.build) {
      const frac = MATS[p.mat].startFrac;
      p.progress = 0;
      p.hp = p.maxHp * frac;
      p.buildRate = 1 / opts.build;
      this.active.add(p);
    }
    this.pieces.set(key, p);
    slotTransform(p.kind, p, this._m);
    this._c.set(opts.color || 0xffffff);
    this.batch(model, slot).add(p, this._m, this._c);
    p.colliders = makeColliders(p);
    for (const c of p.colliders) this.physics.add(c);
    p.grounded = this.touchesGround(p);
    if (this.onPlaced) this.onPlaced(p);
    return p;
  }

  // Can a player place this piece here? Returns true/false.
  canPlace(kind, slot) {
    if (this.occupied(kind, slot)) return false;
    const b = slotBounds(kind, slot);
    // not completely buried
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const g = Math.min(this.terrain.heightAt(b.minX + 0.2, b.minZ + 0.2), this.terrain.heightAt(b.maxX - 0.2, b.maxZ - 0.2),
      this.terrain.heightAt(cx, cz));
    if (g > b.maxY + 0.05) return false;
    if (this.slotGrounded(kind, slot)) return true;
    return this.neighbours(b).length > 0;
  }

  slotGrounded(kind, s) {
    const b = slotBounds(kind, s);
    const y0 = s.iy * H;
    const pts = [];
    if (kind === 'wall') {
      if (s.axis === 0) pts.push([b.minX + 0.3, s.iz * S], [b.maxX - 0.3, s.iz * S], [(b.minX + b.maxX) / 2, s.iz * S]);
      else pts.push([s.ix * S, b.minZ + 0.3], [s.ix * S, b.maxZ - 0.3], [s.ix * S, (b.minZ + b.maxZ) / 2]);
    } else if (kind === 'ramp') {
      // low edge
      const d = [[0, -1], [-1, 0], [0, 1], [1, 0]][s.dir || 0];
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      pts.push([cx + d[0] * 1.6, cz + d[1] * 1.6], [cx, cz]);
      if (d[0] === 0) pts.push([cx - 1.5, cz + d[1] * 1.6], [cx + 1.5, cz + d[1] * 1.6]);
      else pts.push([cx + d[0] * 1.6, cz - 1.5], [cx + d[0] * 1.6, cz + 1.5]);
    } else {
      pts.push([b.minX + 0.3, b.minZ + 0.3], [b.maxX - 0.3, b.minZ + 0.3], [b.minX + 0.3, b.maxZ - 0.3],
        [b.maxX - 0.3, b.maxZ - 0.3], [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]);
    }
    for (const [x, z] of pts) if (this.terrain.heightAt(x, z) >= y0 - 0.35) return true;
    return false;
  }

  touchesGround(p) { return this.slotGrounded(p.kind, p); }

  neighbours(b, exclude = null) {
    const e = 0.06;
    const list = this.physics.queryBox(b.minX - e, b.minY - e, b.minZ - e, b.maxX + e, b.maxY + e, b.maxZ + e, []);
    const out = new Set();
    for (const c of list) if (c.kind === 'piece' && c.owner !== exclude && c.owner.alive) out.add(c.owner);
    return [...out];
  }

  damage(p, amount, source = null) {
    if (!p.alive) return false;
    p.hp -= amount;
    p.flash = 1;
    this.active.add(p);
    if (p.hp <= 0) { this.destroy(p, source); return true; }
    return false;
  }

  destroy(p, cause = null, cascade = true) {
    if (!p.alive) return;
    p.alive = false;
    this.pieces.delete(p.key);
    this.active.delete(p);
    if (p.batch) p.batch.remove(p);
    for (const c of p.colliders) this.physics.remove(c);
    const b = slotBounds(p.kind, p);
    if (this.onDestroyed) this.onDestroyed(p, cause, b);
    if (cascade) this.checkSupport(b, p);
  }

  // After a piece goes, anything no longer connected to the ground falls.
  checkSupport(bounds, removed) {
    const start = this.neighbours(bounds, removed);
    const settled = new Set();
    for (const s of start) {
      if (settled.has(s) || !s.alive) continue;
      const seen = new Set([s]);
      const queue = [s];
      let grounded = false;
      while (queue.length && seen.size < 600) {
        const p = queue.shift();
        if (p.grounded) { grounded = true; break; }
        for (const n of this.neighbours(slotBounds(p.kind, p), p)) {
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
      for (const p of seen) settled.add(p);
      if (!grounded && seen.size < 600) {
        // collapse from the break outward
        const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
        for (const p of seen) {
          const pb = slotBounds(p.kind, p);
          const d = Math.hypot((pb.minX + pb.maxX) / 2 - cx, (pb.minY + pb.maxY) / 2 - cy, (pb.minZ + pb.maxZ) / 2 - cz);
          this.collapseQueue.push({ p, t: 0.08 + d * 0.035 });
        }
      }
    }
  }

  update(dt) {
    for (const p of this.active) {
      let dirty = false;
      if (p.progress < 1) {
        const before = p.progress;
        p.progress = Math.min(1, p.progress + p.buildRate * dt);
        p.hp = Math.min(p.maxHp, p.hp + (p.progress - before) * p.maxHp * (1 - MATS[p.mat].startFrac));
        dirty = true;
      }
      if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt * 6); dirty = true; }
      if (dirty && p.batch) p.batch.setState(p.index, p.progress, p.flash);
      if (p.progress >= 1 && p.flash <= 0) this.active.delete(p);
    }
    if (this.collapseQueue.length) {
      for (const c of this.collapseQueue) c.t -= dt;
      const due = this.collapseQueue.filter((c) => c.t <= 0);
      this.collapseQueue = this.collapseQueue.filter((c) => c.t > 0);
      for (const c of due) if (c.p.alive) this.destroy(c.p, 'collapse', false);
    }
  }

  clear() {
    for (const p of [...this.pieces.values()]) this.destroy(p, 'clear', false);
    this.collapseQueue.length = 0;
  }
}

export { OPENINGS, BUILD_COST };
