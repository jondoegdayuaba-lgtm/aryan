// Rigged characters from character.glb: outfits, keyframed Blender clips (gaits, air, dance, death, swings)
// blended by speed and state, with aiming, IK arms and recoil layered on top.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { clamp, lerp, damp, wrapAngle } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ----------------------------------------------------------------------------- outfits (all original)
const BASE_PARTS = ['Body', 'Head', 'HandL', 'HandR', 'BootL', 'BootR'];
export const OUTFITS = [
  { name: 'Ranger', parts: ['HairShort', 'GearVest', 'WaistBelt', 'BackPack', 'GearPads'],
    colors: { Top: '#3d7fd6', Sleeve: '#3d7fd6', Bottom: '#39414f', Boots: '#4a3528', Gloves: '#2b2b2f', Accent: '#f2a93b', Gear: '#5b6352', Hair: '#3b2618' } },
  { name: 'Nova', parts: ['HatHelmet', 'TopJacket', 'WaistBelt', 'GearPads'],
    colors: { Top: '#eef0f2', Sleeve: '#eef0f2', Bottom: '#d9dde2', Boots: '#e8e8ea', Gloves: '#f07a2a', Accent: '#f07a2a', Gear: '#dfe3e8', Hair: '#222222' } },
  { name: 'Juniper', parts: ['HairLong', 'HatBeanie', 'TopJacket', 'BackPack'],
    colors: { Top: '#2f8f6f', Sleeve: '#2f8f6f', Bottom: '#2c2f3a', Boots: '#6b4a32', Gloves: '#2f8f6f', Accent: '#f4d35e', Gear: '#8a6a4a', Hair: '#c46a2e' } },
  { name: 'Brick', parts: ['HatCap', 'GearVest', 'WaistBelt', 'GearPads'],
    colors: { Top: '#6e7f8f', Sleeve: '#6e7f8f', Bottom: '#34495e', Boots: '#5a3f2a', Gloves: '#e3b23c', Accent: '#ff8c1a', Gear: '#ff8c1a', Hair: '#2a1a12' } },
  { name: 'Kestrel', parts: ['HairMohawk', 'FaceGoggles', 'BackCape', 'WaistBelt', 'TopJacket'],
    colors: { Top: '#2b2b33', Sleeve: '#2b2b33', Bottom: '#3a3a44', Boots: '#1f1f24', Gloves: '#8a2be2', Accent: '#d7263d', Gear: '#44444f', Hair: '#e94f9c' } },
  { name: 'Moss', parts: ['HatHood', 'FaceMask', 'GearVest', 'BackPack'],
    colors: { Top: '#4f6b3a', Sleeve: '#4f6b3a', Bottom: '#3e4a2f', Boots: '#4a3a28', Gloves: '#3b3b2f', Accent: '#8a9a5b', Gear: '#6b5a3a', Hair: '#2a1a12' } },
  { name: 'Ember', parts: ['HairBun', 'TopJacket', 'WaistBelt', 'GearPads'],
    colors: { Top: '#d64933', Sleeve: '#d64933', Bottom: '#2d2a32', Boots: '#2d2a32', Gloves: '#f6ae2d', Accent: '#f6ae2d', Gear: '#3d3a42', Hair: '#1c1c1c' } },
  { name: 'Tide', parts: ['HatCap', 'FaceGoggles', 'BackPack', 'GearVest'],
    colors: { Top: '#1b98a8', Sleeve: '#f5f5f5', Bottom: '#f2e9dc', Boots: '#f5f5f5', Gloves: '#1b98a8', Accent: '#ffcf56', Gear: '#e07a5f', Hair: '#f2d0a4' } },
];
export const SKIN_TONES = ['#f1c7a5', '#e0a882', '#c68a5e', '#9c6644', '#6e4630', '#f5d6bf'];

// ----------------------------------------------------------------------------- merged outfit mesh
// Every visible part of an outfit is merged into ONE skinned mesh: material colours become vertex colours,
// roughness/metalness/emission a per-vertex attribute. One draw call per character instead of ~30.
const ROUGH = { Skin: 0.6, Top: 0.85, Sleeve: 0.85, Bottom: 0.85, Gear: 0.8, Accent: 0.75, Gloves: 0.8, Boots: 0.6,
  Hair: 0.55, EyeWhite: 0.2, Iris: 0.15, Dark: 0.4, Lips: 0.5, Metal: 0.35, Visor: 0.08 };
const METAL = { Metal: 1, Visor: 0.3 };
const EMIT = { Visor: 1.2 };

export const CHAR_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
CHAR_MATERIAL.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aRM;\nvarying vec3 vRM;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vRM;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vRM.z;');
};
CHAR_MATERIAL.customProgramCacheKey = () => 'character-merged';

const mergedCache = new Map();
const lodCache = new Map();

// Low-detail version for distant characters: vertex clustering that keeps each cluster's first vertex.
function simplifySkinned(src, cell) {
  const pos = src.attributes.position;
  const n = pos.count;
  const map = new Map();
  const rep = new Int32Array(n);
  const keep = [];
  for (let i = 0; i < n; i++) {
    const nx = src.attributes.normal.getX(i), ny = src.attributes.normal.getY(i), nz = src.attributes.normal.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const dk = ay >= ax && ay >= az ? (ny > 0 ? 0 : 1) : ax >= az ? (nx > 0 ? 2 : 3) : (nz > 0 ? 4 : 5);
    const k = `${Math.floor(pos.getX(i) / cell)},${Math.floor(pos.getY(i) / cell)},${Math.floor(pos.getZ(i) / cell)},${dk}`;
    let c = map.get(k);
    if (c === undefined) { c = keep.length; map.set(k, c); keep.push(i); }
    rep[i] = c;
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const size = attr.itemSize;
    const arr = new attr.array.constructor(keep.length * size);
    keep.forEach((vi, j) => { for (let k = 0; k < size; k++) arr[j * size + k] = attr.array[vi * size + k]; });
    g.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized));
  }
  const idx = src.index.array;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = rep[idx[t]], b = rep[idx[t + 1]], c = rep[idx[t + 2]];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  g.setIndex(out);
  g.computeBoundingSphere();
  return g;
}
function buildMergedGeometry(parts, show, colors) {
  const list = [];
  const c = new THREE.Color();
  for (const [name, obj] of Object.entries(parts)) {
    if (!show.has(name)) continue;
    obj.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const src = m.geometry;
      const mn = m.material.name;
      const g = new THREE.BufferGeometry();
      g.setIndex(src.index ? src.index.clone() : null);
      g.setAttribute('position', src.attributes.position.clone());
      g.setAttribute('normal', src.attributes.normal.clone());
      const n = src.attributes.position.count;
      const si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
      const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        idx[i * 4] = si.getX(i); idx[i * 4 + 1] = si.getY(i); idx[i * 4 + 2] = si.getZ(i); idx[i * 4 + 3] = si.getW(i);
        wt[i * 4] = sw.getX(i); wt[i * 4 + 1] = sw.getY(i); wt[i * 4 + 2] = sw.getZ(i); wt[i * 4 + 3] = sw.getW(i);
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
      c.set(colors[mn] || m.material.color);
      const col = new Float32Array(n * 3), rm = new Float32Array(n * 3);
      const r = ROUGH[mn] ?? m.material.roughness, me = METAL[mn] ?? 0, em = EMIT[mn] ?? 0;
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        rm[i * 3] = r; rm[i * 3 + 1] = me; rm[i * 3 + 2] = em;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aRM', new THREE.BufferAttribute(rm, 3));
      list.push(g);
    });
  }
  const merged = mergeGeometries(list, false);
  merged.computeBoundingSphere();
  for (const g of list) g.dispose();
  return merged;
}

// ----------------------------------------------------------------------------- Blender clips
// Clips are baked at a fixed rate, so sampling is an index plus a normalised lerp between two keys.
const LIBS = new WeakMap();
const UPPER = ['spine', 'chest', 'neck', 'head'];
const ARMS = ['shoulderL', 'upperarmL', 'forearmL', 'handL', 'shoulderR', 'upperarmR', 'forearmR', 'handR'];

function clipLibrary(gltf) {
  let lib = LIBS.get(gltf);
  if (lib) return lib;
  const order = [];
  const index = new Map();
  const idx = (n) => { if (!index.has(n)) { index.set(n, order.length); order.push(n); } return index.get(n); };
  const clips = {};
  for (const clip of gltf.animations || []) {
    const c = { name: clip.name, duration: clip.duration, rot: [], pos: null, step: 1 / 30, frames: 0 };
    for (const tr of clip.tracks) {
      const dot = tr.name.lastIndexOf('.');
      const node = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
      if (tr.times.length > 1) c.step = tr.times[1] - tr.times[0];
      c.frames = Math.max(c.frames, tr.times.length);
      if (prop === 'quaternion') c.rot[idx(node)] = tr.values;
      else if (prop === 'position' && node === 'hips') c.pos = tr.values;
    }
    clips[clip.name] = c;
  }
  lib = { order, index, clips };
  LIBS.set(gltf, lib);
  return lib;
}

// ----------------------------------------------------------------------------- model

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export class CharacterModel {
  constructor(gltf, outfitIndex = 0, skinTone = null) {
    this.root = new THREE.Group();
    this.model = cloneSkinned(gltf.scene);
    this.root.add(this.model);
    this.meshes = {};
    this.model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    // top-level parts (Group or SkinnedMesh directly under Rig) - kept only as sources for the merged mesh
    const rig = this.model.getObjectByName('Rig') || this.model;
    this.rig = rig;
    for (const c of rig.children) if (!c.isBone) this.meshes[c.name] = c;
    let first = null;
    this.model.traverse((o) => { if (o.isSkinnedMesh && !first) first = o; });
    this.skeleton = first.skeleton;
    this.bindMatrix = first.bindMatrix.clone();
    for (const obj of Object.values(this.meshes)) rig.remove(obj);
    this.body = null;
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.rest = {};
    this.model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    for (const [n, b] of Object.entries(this.bones)) {
      const wm = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
      const wq = new THREE.Quaternion();
      wm.decompose(new THREE.Vector3(), wq, new THREE.Vector3());
      const child = b.children.find((c) => c.isBone);
      this.rest[n] = {
        q: b.quaternion.clone(), p: b.position.clone(), mq: wq, mqi: wq.clone().invert(),
        childPos: child ? child.position.clone() : new THREE.Vector3(0, 0.1, 0),
      };
    }
    this.upperLen = this.rest.forearmL.p.length();
    this.lowerLen = this.rest.handL.p.length();
    this.hipsY = this.rest.hips.p.y;
    // weapon socket in model space
    this.socket = new THREE.Object3D();
    this.root.add(this.socket);
    this.weapon = null;
    this.weaponInfo = null;
    this.glider = null;
    this.state = {
      phase: 0, speed: 0, hipsYaw: 0, crouch: 0, air: 0, sky: 0, glide: 0, aimPitch: 0, lookYaw: 0,
      recoil: 0, harvest: -1, reload: 0, use: 0, build: 0, dead: 0, dance: 0, hit: 0, lean: 0, backwards: 0,
      strafe: 0,
    };
    this.footPlant = [false, false];
    this.onFootstep = null;
    this.onEject = null;     // (worldPos, worldDir, kind) when a gun throws out a shell
    this.onMagDrop = null;   // (mover) when a magazine leaves the gun during a reload
    // blended pose buffers
    this.lib = clipLibrary(gltf);
    const nb = this.lib.order.length;
    this.lbones = this.lib.order.map((n) => this.bones[n.replace(/\./g, '')] || this.bones[n] || null);
    this.acc = new Float32Array(nb * 4);
    this.accW = new Float32Array(nb);
    this.pacc = new Float32Array(3);
    this.paccW = 0;
    Object.assign(this.state, { cycle: 0, idleT: 0, airT: 0, land: 0, deadT: 0, danceW: 0, deadW: 0, throwT: -1,
      equip: 0, gunFireT: -1, gunFireDur: 0.2, lastReload: 0, magDropped: false, lastGrounded: true });
    this.setOutfit(outfitIndex, skinTone);
  }

  setOutfit(index, skinTone) {
    const o = OUTFITS[index % OUTFITS.length];
    this.outfit = o;
    const tone = skinTone || o.skin || SKIN_TONES[1];
    const colors = { ...o.colors, Skin: tone };
    const key = (index % OUTFITS.length) + '|' + tone;
    let geo = mergedCache.get(key);
    if (!geo) {
      geo = buildMergedGeometry(this.meshes, new Set([...BASE_PARTS, ...o.parts]), colors);
      mergedCache.set(key, geo);
    }
    let lod = lodCache.get(key);
    if (!lod) { lod = simplifySkinned(geo, 0.055); lodCache.set(key, lod); }
    this.geoNear = geo;
    this.geoFar = lod;
    if (this.body) this.rig.remove(this.body);
    const body = new THREE.SkinnedMesh(geo, CHAR_MATERIAL);
    body.bind(this.skeleton, this.bindMatrix);
    body.castShadow = true;
    body.receiveShadow = true;
    body.frustumCulled = false;
    this.rig.add(body);
    this.body = body;
  }

  // Swap to the low-detail body when far from the camera.
  setLod(far) {
    const g = far ? this.geoFar : this.geoNear;
    if (this.body && g && this.body.geometry !== g) this.body.geometry = g;
  }

  // Attach a weapon/tool Object3D (from assets.instance) or null.
  hold(obj, kind = 'rifle') {
    if (this.weapon) this.socket.remove(this.weapon);
    this.weapon = obj;
    this.holdKind = obj ? kind : 'none';
    if (obj) {
      this.socket.add(obj);
      obj.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      this.gripL = obj.children.find((c) => c.name.endsWith('_Hand')) || null;
      this.muzzle = obj.children.find((c) => c.name.endsWith('_Muzzle')) || null;
      this.eject = obj.children.find((c) => c.name.endsWith('_Eject')) || null;
      this.gun = obj.userData.gun || null;   // { name, clips: { Fire, Reload }, nodes, rest }
      this.state.equip = 1;
      this.state.gunFireT = -1;
      if (this.gun) restGun(this.gun);
    } else {
      this.gun = null;
      this.eject = null;
      this.gripL = null;
      this.muzzle = null;
    }
  }

  setGlider(obj) {
    if (this.glider) this.root.remove(this.glider);
    this.glider = obj;
    if (obj) {
      obj.position.set(0, 2.02, 0.12);
      this.root.add(obj);
    }
  }

  // ------------------------------------------------------------------ bone helpers
  // Rotate a bone by a rotation expressed in the character's rest model axes.
  rotate(name, x, y = 0, z = 0) {
    const b = this.bones[name];
    if (!b) return;
    const r = this.rest[name];
    _q1.setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    // delta_local = mq^-1 * R * mq
    _q2.copy(r.mqi).multiply(_q1).multiply(r.mq);
    b.quaternion.multiply(_q2);
  }

  resetPose() {
    for (const [n, b] of Object.entries(this.bones)) {
      const r = this.rest[n];
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
  }

  // Point bone `name` so its child joint lies toward world point `target`.
  aimBone(name, target) {
    const b = this.bones[name];
    b.updateWorldMatrix(true, false);
    const parent = b.parent;
    parent.getWorldQuaternion(_q3);
    b.getWorldQuaternion(_q1);
    b.getWorldPosition(_v1);
    _v2.copy(this.rest[name].childPos).applyQuaternion(_q1).normalize();
    _v3.subVectors(target, _v1).normalize();
    _q2.setFromUnitVectors(_v2, _v3);
    _q1.premultiply(_q2);
    b.quaternion.copy(_q3.invert().multiply(_q1));
    b.updateMatrixWorld(true);
  }

  // Two-bone IK for an arm: upper arm + forearm reach `target` with the elbow toward `pole` (world).
  ikArm(side, target, pole) {
    const up = 'upperarm' + side, fo = 'forearm' + side;
    const sb = this.bones[up];
    sb.updateWorldMatrix(true, false);
    const S = sb.getWorldPosition(_v4.set(0, 0, 0)).clone();
    const a = this.upperLen * this.root.scale.x, b = this.lowerLen * this.root.scale.x;
    const toT = _v1.subVectors(target, S);
    let d = toT.length();
    const dir = toT.normalize().clone();
    d = clamp(d, 0.05, a + b - 0.002);
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const pd = _v2.subVectors(pole, S);
    pd.addScaledVector(dir, -pd.dot(dir)).normalize();
    const elbow = S.clone().addScaledVector(dir, x).addScaledVector(pd, h);
    this.aimBone(up, elbow);
    const tgt = S.clone().addScaledVector(dir, d);
    this.aimBone(fo, tgt);
  }

  // ------------------------------------------------------------------ animation
  /**
   * a: { vel (world), yaw, aimPitch, grounded, crouch, sprint, mode ('ground'|'sky'|'glide'|'bus'|'dead'),
   *      firing (0..1 recoil), harvest (-1 or 0..1), reload (0..1 or 0), use (0..1 or 0), building, dance }
   */
  update(dt, a) {
    const s = this.state;
    const root = this.root;

    // local movement
    const sinY = Math.sin(a.yaw), cosY = Math.cos(a.yaw);
    const lx = a.vel.x * cosY - a.vel.z * sinY;   // character's left-right (+X = left)
    const lz = a.vel.x * sinY + a.vel.z * cosY;   // forward
    const speed = Math.hypot(lx, lz);
    const onGround = a.mode === 'ground' && a.grounded;
    s.speed = damp(s.speed, onGround ? speed : 0, 10, dt);
    s.crouch = damp(s.crouch, a.crouch ? 1 : 0, 12, dt);
    s.air = damp(s.air, a.mode === 'ground' && !a.grounded ? 1 : 0, 10, dt);
    s.sky = damp(s.sky, a.mode === 'sky' ? 1 : 0, 6, dt);
    s.glide = damp(s.glide, a.mode === 'glide' ? 1 : 0, 6, dt);
    s.aimPitch = damp(s.aimPitch, a.aimPitch || 0, 18, dt);
    s.recoil = Math.max(0, s.recoil - dt * 9);
    if (a.fired) s.recoil = Math.min(1.2, s.recoil + a.fired);
    s.hit = Math.max(0, s.hit - dt * 5);
    s.equip = Math.max(0, s.equip - dt * 4);
    s.idleT += dt;
    s.airT = a.mode === 'ground' && !a.grounded ? s.airT + dt : 0;
    // landing: a short knee dip scaled by how hard we came down
    if (onGround && !s.lastGrounded && a.mode === 'ground') s.land = Math.min(1, 0.35 + Math.max(0, -(this._vy || 0)) / 18);
    s.lastGrounded = onGround || a.mode !== 'ground';
    this._vy = a.vel.y;
    s.land = Math.max(0, s.land - dt * 4);
    if (a.mode === 'dead') s.deadT += dt; else s.deadT = 0;
    s.deadW = a.mode === 'dead' ? Math.min(1, s.deadT / 0.12) : 0;
    s.dance = a.dance ? s.dance + dt : 0;
    s.danceW = damp(s.danceW, a.dance ? 1 : 0, 8, dt);
    if (s.throwT >= 0) { s.throwT += dt; if (s.throwT > 0.6) s.throwT = -1; }

    // movement direction relative to facing
    let moveAng = Math.atan2(lx, lz); // 0 forward, +pi/2 left
    const moving = s.speed > 0.4;
    let backwards = 0;
    if (moving && Math.abs(moveAng) > 1.9) { backwards = 1; moveAng = wrapAngle(moveAng - Math.PI); }
    s.backwards = damp(s.backwards, backwards, 10, dt);
    const targetHipsYaw = moving ? clamp(moveAng, -1.0, 1.0) * 0.75 : 0;
    s.hipsYaw = damp(s.hipsYaw, targetHipsYaw, 8, dt);

    // ---- locomotion weights from speed: idle 0, walk 3.4, run 6.2, sprint 8.2 m/s
    const sp = s.speed;
    let wIdle = 0, wWalk = 0, wRun = 0, wSprint = 0;
    if (sp < 0.3) wIdle = 1;
    else if (sp < 3.4) { const t = (sp - 0.3) / 3.1; wIdle = 1 - t; wWalk = t; }
    else if (sp < 6.2) { const t = (sp - 3.4) / 2.8; wWalk = 1 - t; wRun = t; }
    else { const t = clamp((sp - 6.2) / 2.0, 0, 1); wRun = 1 - t; wSprint = t; }
    const stand = 1 - s.crouch, crouch = s.crouch;
    const move = 1 - wIdle;
    // metres per gait cycle (two steps) for each style
    const mw = wWalk + wRun + wSprint;
    const stride = lerp(mw > 0 ? (wWalk * 1.9 + wRun * 3.3 + wSprint * 4.2) / mw : 1.9, 1.8, crouch);
    if (!Number.isFinite(s.cycle)) s.cycle = 0;
    const prevCycle = s.cycle;
    s.cycle += (sp / stride) * dt * (backwards ? -1 : 1);
    s.phase = s.cycle * Math.PI * 2;
    // footsteps at each heel strike (cycle 0 and 0.5)
    if (sp > 1.2 && this.onFootstep) {
      const a0 = Math.floor(prevCycle * 2), a1 = Math.floor(s.cycle * 2);
      if (a0 !== a1) this.onFootstep((a1 & 1) ? 'R' : 'L', sp);
    }

    // ---- blend the Blender clips
    this.beginPose();
    const ground = (1 - s.air) * (1 - s.sky) * (1 - s.glide);
    const alive = 1 - s.deadW;
    const base = ground * alive * (1 - s.danceW);
    const cyc = ((s.cycle % 1) + 1) % 1;
    if (base > 0.001) {
      this.addClip('Idle', s.idleT, wIdle * stand * base);
      this.addClip('CrouchIdle', s.idleT, wIdle * crouch * base);
      this.addClipU('Walk', cyc, wWalk * stand * base);
      this.addClipU('Run', cyc, wRun * stand * base);
      this.addClipU('Sprint', cyc, wSprint * stand * base);
      this.addClipU('CrouchWalk', cyc, move * crouch * base);
    }
    if (s.air > 0.001 && alive > 0) {
      const w = s.air * (1 - s.sky) * (1 - s.glide) * alive;
      const rising = clamp(a.vel.y / 3, 0, 1);
      this.addClip('Jump', Math.min(s.airT, 0.49), w * rising, false);
      this.addClip('Fall', s.airT, w * (1 - rising));
    }
    this.addClip('Sky', s.idleT, s.sky * alive);
    this.addClip('Glide', s.idleT, s.glide * (1 - s.sky) * alive);
    if (s.danceW > 0.001) this.addClip('Dance', s.dance, s.danceW * ground * alive);
    if (s.deadW > 0) this.addClip('Death', s.deadT, s.deadW, false);
    this.endPose();

    // ---- layered on top: the pelvis turns toward the move direction, the torso aims
    const aimW = (1 - s.sky) * (1 - s.glide) * alive * (1 - s.danceW);
    this.rotate('hips', 0, s.hipsYaw * aimW, 0);
    this.rotate('spine', -s.aimPitch * 0.25 * aimW, -s.hipsYaw * 0.45 * aimW, 0);
    this.rotate('chest', (-s.aimPitch * 0.35 - s.recoil * 0.05 - s.hit * 0.12) * aimW, -s.hipsYaw * 0.45 * aimW, 0);
    this.rotate('neck', -s.aimPitch * 0.2 * aimW, 0, 0);
    this.rotate('head', (-s.aimPitch * 0.2 - s.hit * 0.1) * aimW, -s.hipsYaw * 0.1 * aimW, 0);
    if (s.land > 0 && alive) {
      const k = s.land * s.land;
      this.bones.hips.position.y -= 0.14 * k;
      for (const side of ['L', 'R']) {
        this.rotate('thigh' + side, -0.4 * k, 0, 0);
        this.rotate('shin' + side, 0.8 * k, 0, 0);
        this.rotate('foot' + side, -0.4 * k, 0, 0);
      }
      this.rotate('spine', 0.15 * k, 0, 0);
    }
    // pickaxe swing turns the upper body
    if (this.holdKind === 'tool' && a.harvest >= 0 && alive) this.overlay('Swing', a.harvest * 0.6, 0.9, UPPER);

    // ---- arms
    root.updateMatrixWorld(true);
    this.updateGun(dt, a);
    this.poseArms(dt, a, move, wRun + wSprint);
    if (s.throwT >= 0 && alive) {
      const env = Math.min(1, s.throwT / 0.08) * Math.min(1, (0.6 - s.throwT) / 0.12);
      this.overlay('Throw', s.throwT, env, [...UPPER, ...ARMS]);
      if (s.throwT > 0.4) this.socket.visible = false;
    }

    // ---- whole-body tilt while skydiving and gliding (death lies down in its clip)
    if (a.mode === 'sky') {
      this.model.rotation.x = lerp(this.model.rotation.x, 1.2 + (a.dive || 0) * 0.3, 1 - Math.exp(-dt * 6));
      this.model.position.y = 0.9;
    } else {
      this.model.rotation.x = damp(this.model.rotation.x, a.mode === 'glide' ? 0.15 : 0, 8, dt);
      this.model.position.y = damp(this.model.position.y, 0, 10, dt);
    }
  }

  // ------------------------------------------------------------------ clip blending
  beginPose() {
    this.acc.fill(0);
    this.accW.fill(0);
    this.pacc.fill(0);
    this.paccW = 0;
  }

  // Add a clip at time t (seconds), looping unless told otherwise.
  addClip(name, t, w, loop = true) {
    const c = this.lib.clips[name];
    if (!c || w <= 0.001) return;
    const d = c.duration || 1;
    this.addClipU(name, loop ? t / d : clamp(t / d, 0, 1), w, loop);
  }

  // Add a clip at normalised time u (0..1).
  addClipU(name, u, w, loop = true) {
    const c = this.lib.clips[name];
    if (!c || w <= 0.001) return;
    const last = c.frames - 1;
    let f = (loop ? ((u % 1) + 1) % 1 : clamp(u, 0, 1)) * last;
    const i0 = Math.min(last, Math.floor(f));
    const i1 = Math.min(last, i0 + 1);
    const k = f - i0;
    const acc = this.acc;
    for (let b = 0; b < c.rot.length; b++) {
      const v = c.rot[b];
      if (!v) continue;
      const o0 = i0 * 4, o1 = i1 * 4;
      let x = v[o0] + (v[o1] - v[o0]) * k, y = v[o0 + 1] + (v[o1 + 1] - v[o0 + 1]) * k;
      let z = v[o0 + 2] + (v[o1 + 2] - v[o0 + 2]) * k, ww = v[o0 + 3] + (v[o1 + 3] - v[o0 + 3]) * k;
      const j = b * 4;
      // keep every sample in the same hemisphere as what is already there
      if (acc[j] * x + acc[j + 1] * y + acc[j + 2] * z + acc[j + 3] * ww < 0) { x = -x; y = -y; z = -z; ww = -ww; }
      acc[j] += x * w; acc[j + 1] += y * w; acc[j + 2] += z * w; acc[j + 3] += ww * w;
      this.accW[b] += w;
    }
    if (c.pos) {
      const v = c.pos, o0 = i0 * 3, o1 = i1 * 3;
      for (let a = 0; a < 3; a++) this.pacc[a] += (v[o0 + a] + (v[o1 + a] - v[o0 + a]) * k) * w;
      this.paccW += w;
    }
  }

  endPose() {
    const acc = this.acc;
    for (let b = 0; b < this.lbones.length; b++) {
      const bone = this.lbones[b];
      if (!bone) continue;
      if (this.accW[b] > 0) {
        const j = b * 4;
        bone.quaternion.set(acc[j], acc[j + 1], acc[j + 2], acc[j + 3]).normalize();
      } else bone.quaternion.copy(this.rest[bone.name].q);
    }
    for (const [n, b] of Object.entries(this.bones)) if (!this.lib.index.has(n) && !this.lib.index.has(dotted(n))) b.quaternion.copy(this.rest[n].q);
    const hips = this.bones.hips;
    if (this.paccW > 0) hips.position.set(this.pacc[0] / this.paccW, this.pacc[1] / this.paccW, this.pacc[2] / this.paccW);
    else hips.position.copy(this.rest.hips.p);
  }

  // Blend some bones toward a clip's pose (upper-body swings and throws on top of everything else).
  overlay(name, t, w, bones) {
    const c = this.lib.clips[name];
    if (!c || w <= 0.001) return;
    const last = c.frames - 1;
    const f = clamp(t / (c.duration || 1), 0, 1) * last;
    const i0 = Math.floor(f), i1 = Math.min(last, i0 + 1), k = f - i0;
    for (const n of bones) {
      const bi = this.lib.index.has(n) ? this.lib.index.get(n) : this.lib.index.get(dotted(n));
      const v = bi !== undefined ? c.rot[bi] : null;
      const bone = this.bones[n];
      if (!v || !bone) continue;
      _q1.fromArray(v, i0 * 4);
      _q2.fromArray(v, i1 * 4);
      _q1.slerp(_q2, k);
      bone.quaternion.slerp(_q1, w);
    }
  }

  // ------------------------------------------------------------------ gun parts (Blender clips on the weapon)
  updateGun(dt, a) {
    const s = this.state;
    const gun = this.gun;
    if (!gun) return;
    const rl = a.reload || 0;
    if (a.fired && gun.clips.Fire) {
      s.gunFireT = 0;
      s.gunFireDur = Math.min(gun.clips.Fire.duration, a.fireDur || gun.clips.Fire.duration);
      s.ejected = false;
    }
    let clip = null, u = 0;
    if (rl > 0 && gun.clips.Reload) {
      clip = gun.clips.Reload;
      u = rl;
      if (s.lastReload === 0) s.magDropped = false;
      if (!s.magDropped && gun.magDropAt !== undefined && rl >= gun.magDropAt) {
        s.magDropped = true;
        if (this.onMagDrop && gun.nodes[gun.name + '_Mag'] && !this.socket.userData.far) this.onMagDrop(gun.nodes[gun.name + '_Mag']);
      }
      s.gunFireT = -1;
    } else if (s.gunFireT >= 0) {
      s.gunFireT += dt;
      u = s.gunFireT / s.gunFireDur;
      clip = gun.clips.Fire;
      if (!s.ejected && u >= (gun.ejectAt || 0) && this.eject && this.onEject && !this.socket.userData.far) {
        s.ejected = true;
        this.root.updateMatrixWorld(true);
        const p = this.eject.getWorldPosition(new THREE.Vector3());
        const q = this.eject.getWorldQuaternion(new THREE.Quaternion());
        this.onEject(p, new THREE.Vector3(0, 1, 0).applyQuaternion(q), gun.shell || 'brass');
      }
      if (u >= 1) { s.gunFireT = -1; clip = null; }
    }
    s.lastReload = rl;
    if (clip) sampleGun(gun, clip, clamp(u, 0, 1));
    else restGun(gun);
  }

  // Model-space point -> world.
  toWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.root.matrixWorld);
  }

  poseArms(dt, a, moveAmt, run) {
    const s = this.state;
    const sock = this.socket;
    const kind = this.holdKind;
    sock.visible = !!this.weapon && !sock.userData.far;
    if (a.mode === 'sky') { sock.visible = false; return; }
    if (a.mode === 'glide' && this.glider) {
      sock.visible = false;
      this.root.updateMatrixWorld(true);
      this.ikArm('L', this.toWorld(0.3, 2.0, 0.12), this.toWorld(0.7, 1.4, -0.3));
      this.ikArm('R', this.toWorld(-0.3, 2.0, 0.12), this.toWorld(-0.7, 1.4, -0.3));
      return;
    }
    if (a.mode === 'dead' || a.mode === 'bus') { sock.visible = false; return; }
    if (s.dance > 0) { sock.visible = false; return; }

    const pitch = s.aimPitch;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // pivot at the right shoulder / chest
    const px = -0.14, py = 1.36 - s.crouch * 0.36, pz = 0.06 + s.crouch * 0.05;
    // offset of the grip from the pivot, rotated by pitch around X
    let gx = 0, gy = -0.14, gz = 0.3, roll = 0, sway = 0;
    let rx = 0; // extra weapon pitch
    if (kind === 'pistol') { gx = 0.1; gy = -0.02; gz = 0.46; }
    if (kind === 'rocket') { gx = -0.04; gy = 0.05; gz = 0.22; }
    if (kind === 'none' || kind === 'item' || kind === 'build') { gy = -0.2; gz = 0.25; }
    // idle sway + run bounce
    sway = Math.sin(s.phase * 2) * 0.012 * moveAmt + Math.sin(s.idleT * 1.7) * 0.004;
    // just switched to this item: it comes up from low
    const eq = s.equip * s.equip;
    gy -= eq * 0.22;
    rx += eq * 0.9;
    // recoil pushes back and up
    gz -= s.recoil * 0.06;
    rx -= s.recoil * 0.12;
    // reload: dip and roll the weapon (guns with a Blender reload clip move less: their parts do the work)
    const rl = a.reload || 0;
    const clipReload = !!(this.gun && this.gun.clips.Reload);
    if (rl > 0) {
      const k = Math.sin(clamp(rl, 0, 1) * Math.PI);
      const m = clipReload ? 0.55 : 1;
      roll += k * 0.6 * m;
      gy -= k * 0.08 * m;
      rx += k * 0.35 * m;
    }
    // sprint: hold the weapon lower and across the chest
    const sprint = a.sprint && moveAmt > 0.5 ? 1 : 0;
    this._sprint = damp(this._sprint || 0, sprint, 8, dt);
    rx += this._sprint * 0.55;
    roll += this._sprint * 0.35;
    gx += this._sprint * 0.1;

    // pickaxe: resting on the shoulder, swing when harvesting
    if (kind === 'tool') {
      const hv = a.harvest;
      if (hv >= 0) {
        // 0 -> wind up, 0.35 -> strike, 1 -> recover
        const t = hv;
        const k = t < 0.35 ? -Math.sin(t / 0.35 * Math.PI * 0.5) : Math.sin((t - 0.35) / 0.65 * Math.PI) * 1.4 - (1 - (t - 0.35) / 0.65) * 0.0;
        const ang = t < 0.35 ? lerp(0, -1.4, t / 0.35) : t < 0.55 ? lerp(-1.4, 1.1, (t - 0.35) / 0.2) : lerp(1.1, 0, (t - 0.55) / 0.45);
        sock.position.set(px + 0.02, py + 0.05 - Math.max(0, ang) * 0.12, pz + 0.24 + Math.max(0, ang) * 0.12);
        sock.rotation.set(ang - pitch * 0.6 + k * 0.05, 0, 0.15);
      } else {
        sock.position.set(px - 0.06, py - 0.28 + sway, pz + 0.22);
        sock.rotation.set(-0.35 - pitch * 0.3, 0, 0.25);
      }
    } else {
      sock.position.set(px + gx * cp, py + gy * cp + gz * sp + sway, pz + gz * cp - gy * sp);
      sock.rotation.set(-pitch + rx, 0, roll, 'YXZ');
      if (kind === 'none' || kind === 'item' || kind === 'build') sock.rotation.set(-pitch * 0.5 + 0.2, 0, 0);
    }
    this.root.updateMatrixWorld(true);

    const handR = new THREE.Vector3();
    sock.getWorldPosition(handR);
    // elbows down and out
    const poleR = this.toWorld(-0.55, 0.9, -0.25);
    const poleL = this.toWorld(0.55, 0.9, -0.1);
    if (kind === 'none') return;   // arms from the clips
    if (kind === 'build') {
      // right hand reaches forward to "draw" the build, left arm from the clips
      this.ikArm('R', this.toWorld(-0.18, 1.25 + sp * 0.3, 0.45), poleR);
      this.aimHand('R', this.toWorld(-0.18, 1.3 + sp * 0.3, 0.7));
      return;
    }
    this.ikArm('R', handR, poleR);
    // right hand follows the weapon's forward direction
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(sock.getWorldQuaternion(new THREE.Quaternion()));
    this.aimHand('R', handR.clone().addScaledVector(fwd, 0.15).add(new THREE.Vector3(0, -0.05, 0)));
    if (kind === 'item') {
      const u = a.use || 0;
      if (u > 0) {
        // bring the item up to the face
        const k = Math.sin(clamp(u, 0, 1) * Math.PI);
        sock.position.lerp(new THREE.Vector3(-0.05, 1.55, 0.2), k * 0.8);
        this.root.updateMatrixWorld(true);
        sock.getWorldPosition(handR);
        this.ikArm('R', handR, poleR);
      }
      return;
    }
    let lt;
    if (this.gripL) lt = this.gripL.getWorldPosition(new THREE.Vector3());
    else lt = handR.clone().addScaledVector(fwd, 0.25);
    if (kind === 'pistol' && !(rl > 0 && clipReload)) lt = handR.clone().add(new THREE.Vector3(0.05, -0.02, 0).applyQuaternion(this.root.quaternion));
    if (rl > 0 && kind !== 'tool' && !clipReload) {
      // left hand grabs the magazine area and comes back
      const k = Math.sin(clamp(rl, 0, 1) * Math.PI);
      lt.lerp(handR.clone().add(new THREE.Vector3(0, -0.25, 0)), k);
    }
    this.ikArm('L', lt, poleL);
    this.aimHand('L', lt.clone().addScaledVector(fwd, 0.1));
  }

  aimHand(side, target) {
    const b = this.bones['hand' + side];
    if (b) this.aimBone('hand' + side, target);
  }

  relaxArm(side, moveAmt, run, swingSign) {
    const sg = side === 'L' ? 1 : -1;
    const sw = Math.sin(this.state.phase + (side === 'L' ? Math.PI : 0)) * (0.35 + run * 0.5) * moveAmt;
    this.rotate('upperarm' + side, -sw, 0, sg * -0.55);
    this.rotate('forearm' + side, -0.35 - run * 0.9 * moveAmt, 0, 0);
  }

  relaxArms(moveAmt, run) {
    this.relaxArm('L', moveAmt, run);
    this.relaxArm('R', moveAmt, run);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (this.muzzle) return this.muzzle.getWorldPosition(out);
    return this.socket.getWorldPosition(out);
  }
}

function dotted(n) { return n.replace(/(L|R)$/, '.$1'); }

// ----------------------------------------------------------------------------- gun clips
// A held gun's moving parts (magazine, bolt, slide, pump, warhead) and its left-hand grip follow the
// weapon's Fire and Reload clips from weapons.glb.
function restGun(gun) {
  if (gun.atRest) return;
  for (const [n, node] of Object.entries(gun.nodes)) {
    const r = gun.rest[n];
    node.position.copy(r.p); node.quaternion.copy(r.q); node.scale.copy(r.s);
  }
  gun.atRest = true;
}

function sampleGun(gun, clip, u) {
  restGun(gun);
  gun.atRest = false;
  for (const t of clip.tracks) {
    const node = gun.nodes[t.node];
    if (!node) continue;
    const last = t.frames - 1;
    const step = last > 0 ? t.times[1] - t.times[0] : 1;
    const f = Math.min(last, (u * clip.duration - t.times[0]) / step);
    const i0 = Math.max(0, Math.floor(f)), i1 = Math.min(last, i0 + 1), k = clamp(f - i0, 0, 1);
    const v = t.values, n = t.size;
    if (t.prop === 'quaternion') {
      _q1.fromArray(v, i0 * 4); _q2.fromArray(v, i1 * 4); node.quaternion.copy(_q1.slerp(_q2, k));
    } else {
      const o = t.prop === 'position' ? node.position : node.scale;
      o.set(v[i0 * n] + (v[i1 * n] - v[i0 * n]) * k, v[i0 * n + 1] + (v[i1 * n + 1] - v[i0 * n + 1]) * k,
        v[i0 * n + 2] + (v[i1 * n + 2] - v[i0 * n + 2]) * k);
    }
  }
}
