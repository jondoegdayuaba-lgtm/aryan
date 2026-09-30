// Rigged characters from character.glb: outfits and fully procedural animation (gait, aim, IK arms).
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
    } else {
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
    this.resetPose();

    // local movement
    const sinY = Math.sin(a.yaw), cosY = Math.cos(a.yaw);
    const lx = a.vel.x * cosY - a.vel.z * sinY;   // character's left-right (+X = left)
    const lz = a.vel.x * sinY + a.vel.z * cosY;   // forward
    const speed = Math.hypot(lx, lz);
    s.speed = damp(s.speed, a.mode === 'ground' && a.grounded ? speed : 0, 10, dt);
    s.crouch = damp(s.crouch, a.crouch ? 1 : 0, 12, dt);
    s.air = damp(s.air, a.mode === 'ground' && !a.grounded ? 1 : 0, 10, dt);
    s.sky = damp(s.sky, a.mode === 'sky' ? 1 : 0, 6, dt);
    s.glide = damp(s.glide, a.mode === 'glide' ? 1 : 0, 6, dt);
    s.dead = a.mode === 'dead' ? Math.min(1, s.dead + dt * 2.2) : 0;
    s.aimPitch = damp(s.aimPitch, a.aimPitch || 0, 18, dt);
    s.recoil = Math.max(0, s.recoil - dt * 9);
    if (a.fired) s.recoil = Math.min(1.2, s.recoil + a.fired);
    s.hit = Math.max(0, s.hit - dt * 5);
    s.dance = a.dance ? s.dance + dt : 0;

    // movement direction relative to facing
    let moveAng = Math.atan2(lx, lz); // 0 forward, +pi/2 left
    const moving = s.speed > 0.4;
    let backwards = 0;
    if (moving && Math.abs(moveAng) > 1.9) { backwards = 1; moveAng = wrapAngle(moveAng - Math.PI); }
    s.backwards = damp(s.backwards, backwards, 10, dt);
    const targetHipsYaw = moving ? clamp(moveAng, -1.0, 1.0) * 0.75 : 0;
    s.hipsYaw = damp(s.hipsYaw, targetHipsYaw, 8, dt);

    // gait phase: a full cycle every ~2.3 m (run) / 1.7 m (walk)
    const stride = lerp(1.5, 2.4, clamp(s.speed / 7, 0, 1)) * (s.crouch > 0.5 ? 0.8 : 1);
    s.phase += (s.speed / stride) * Math.PI * 2 * dt * (backwards ? -1 : 1);
    const ph = s.phase;
    const run = clamp((s.speed - 1) / 6, 0, 1);
    const moveAmt = clamp(s.speed / 2.5, 0, 1);

    // ---- pelvis
    const hips = this.bones.hips;
    const bob = (Math.cos(ph * 2) * (0.02 + 0.03 * run)) * moveAmt;
    hips.position.y = this.hipsY - s.crouch * 0.36 + bob - s.air * 0.04;
    hips.position.z = this.rest.hips.p.z + s.crouch * 0.05;
    // lean into the run; hips turn toward the move direction, torso turns back to the aim
    const lean = (0.08 + run * 0.18) * moveAmt * (1 - s.backwards * 1.6) + s.crouch * 0.25;
    this.rotate('hips', lean * 0.5, s.hipsYaw + Math.sin(ph) * 0.08 * moveAmt, Math.cos(ph) * 0.04 * moveAmt);
    this.rotate('spine', lean * 0.4 - s.aimPitch * 0.25, -s.hipsYaw * 0.45 - Math.sin(ph) * 0.06 * moveAmt, 0);
    this.rotate('chest', -s.aimPitch * 0.35 - s.recoil * 0.05, -s.hipsYaw * 0.45 - Math.sin(ph) * 0.04 * moveAmt, 0);
    this.rotate('neck', -s.aimPitch * 0.2, 0, 0);
    this.rotate('head', -s.aimPitch * 0.2 - lean * 0.5, -s.hipsYaw * 0.1, 0);

    // ---- legs
    for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
      const p = ph + off;
      const sw = Math.sin(p);
      const swing = sw * (0.28 + 0.42 * run) * moveAmt;
      const knee = (Math.max(0, Math.cos(p - 0.35)) ** 1.4 * (0.55 + 0.9 * run) + 0.08) * moveAmt;
      const crouchT = s.crouch * 1.05, crouchK = s.crouch * 1.75;
      const airT = s.air * (side === 'L' ? 0.55 : 0.15), airK = s.air * (side === 'L' ? 0.9 : 0.35);
      this.rotate('thigh' + side, -(swing + crouchT + airT), 0, (side === 'L' ? -1 : 1) * 0.04);
      this.rotate('shin' + side, knee + crouchK + airK, 0, 0);
      this.rotate('foot' + side, -(knee * 0.35) + swing * 0.3 - crouchK * 0.35 + crouchT * 0.1, 0, 0);
      // footstep events: foot plants when the swing turns
      const planted = sw < -0.2;
      const idx = side === 'L' ? 0 : 1;
      if (planted && !this.footPlant[idx] && s.speed > 1.2 && this.onFootstep) this.onFootstep(side, s.speed);
      this.footPlant[idx] = planted;
    }

    // ---- sky poses override
    if (s.sky > 0.01) this.poseSky(s.sky, a);
    if (s.glide > 0.01) this.poseGlide(s.glide, a);

    // ---- arms
    root.updateMatrixWorld(true);
    this.poseArms(dt, a, moveAmt, run);

    // ---- death: topple backwards
    if (s.dead > 0) {
      const t = s.dead;
      this.model.rotation.x = -Math.PI / 2 * (t * t * (3 - 2 * t));
      this.model.position.y = 0.12 * t;
    } else if (a.mode === 'sky') {
      this.model.rotation.x = lerp(this.model.rotation.x, 1.2 + (a.dive || 0) * 0.3, 1 - Math.exp(-dt * 6));
      this.model.position.y = 0.9;
    } else {
      this.model.rotation.x = damp(this.model.rotation.x, a.mode === 'glide' ? 0.15 : 0, 8, dt);
      this.model.position.y = damp(this.model.position.y, 0, 10, dt);
    }
    if (s.dance > 0) this.poseDance(s.dance);
  }

  poseSky(w, a) {
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      this.rotate('thigh' + side, 0.35 * w, 0, sg * 0.18 * w);
      this.rotate('shin' + side, 0.9 * w, 0, 0);
    }
    this.rotate('spine', -0.25 * w, 0, 0);
    this.rotate('head', -0.9 * w, 0, 0);
  }

  poseGlide(w) {
    const t = performance.now() / 1000;
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      this.rotate('thigh' + side, (0.25 + Math.sin(t * 2 + sg) * 0.12) * w, 0, sg * 0.06 * w);
      this.rotate('shin' + side, (0.4 + Math.sin(t * 2 + sg + 1) * 0.15) * w, 0, 0);
    }
  }

  poseDance(t) {
    const beat = t * Math.PI * 2 * 2;
    this.bones.hips.position.y += Math.abs(Math.sin(beat)) * 0.06;
    this.rotate('hips', 0, Math.sin(beat * 0.5) * 0.3, Math.sin(beat) * 0.12);
    this.rotate('chest', 0, -Math.sin(beat * 0.5) * 0.4, -Math.sin(beat) * 0.1);
    this.rotate('head', Math.sin(beat) * 0.15, 0, 0);
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      this.rotate('upperarm' + side, 0, 0, sg * (1.1 + Math.sin(beat + sg) * 0.6));
      this.rotate('forearm' + side, -1.2 - Math.sin(beat * 2) * 0.4, 0, 0);
      this.rotate('thigh' + side, -Math.max(0, Math.sin(beat + (sg > 0 ? 0 : Math.PI))) * 0.5, 0, 0);
      this.rotate('shin' + side, Math.max(0, Math.sin(beat + (sg > 0 ? 0 : Math.PI))) * 0.8, 0, 0);
    }
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
    if (a.mode === 'sky') {
      // arms spread like a skydiver
      for (const side of ['L', 'R']) {
        const sg = side === 'L' ? 1 : -1;
        this.rotate('upperarm' + side, -0.3, 0, sg * 0.75);
        this.rotate('forearm' + side, -0.9, 0, 0);
      }
      sock.visible = false;
      return;
    }
    if (a.mode === 'glide' && this.glider) {
      sock.visible = false;
      this.root.updateMatrixWorld(true);
      this.ikArm('L', this.toWorld(0.3, 2.0, 0.12), this.toWorld(0.7, 1.4, -0.3));
      this.ikArm('R', this.toWorld(-0.3, 2.0, 0.12), this.toWorld(-0.7, 1.4, -0.3));
      return;
    }
    if (a.mode === 'dead' || a.mode === 'bus') { sock.visible = false; this.relaxArms(0, 0); return; }
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
    sway = Math.sin(s.phase) * 0.02 * moveAmt;
    // recoil pushes back and up
    gz -= s.recoil * 0.06;
    rx -= s.recoil * 0.12;
    // reload: dip and roll the weapon
    const rl = a.reload || 0;
    if (rl > 0) {
      const k = Math.sin(clamp(rl, 0, 1) * Math.PI);
      roll += k * 0.6;
      gy -= k * 0.08;
      rx += k * 0.35;
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
    if (kind === 'none') { this.relaxArms(moveAmt, run); return; }
    if (kind === 'build') {
      // right hand reaches forward to "draw" the build, left relaxed
      this.ikArm('R', this.toWorld(-0.18, 1.25 + sp * 0.3, 0.45), poleR);
      this.aimHand('R', this.toWorld(-0.18, 1.3 + sp * 0.3, 0.7));
      this.relaxArm('L', moveAmt, run, 0);
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
      this.relaxArm('L', moveAmt, run, 0);
      return;
    }
    let lt;
    if (this.gripL) lt = this.gripL.getWorldPosition(new THREE.Vector3());
    else lt = handR.clone().addScaledVector(fwd, 0.25);
    if (kind === 'pistol') lt = handR.clone().add(new THREE.Vector3(0.05, -0.02, 0).applyQuaternion(this.root.quaternion));
    if (rl > 0 && kind !== 'tool') {
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
