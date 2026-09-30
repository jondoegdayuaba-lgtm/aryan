// The skier on screen: places the Blender-made skinned model on the snow and poses its skeleton from the
// physics state. Legs use two-bone IK (feet stay on the skis while the hips crouch), arms reach for hand
// targets, the torso pitches into a tuck, the whole body rolls into turns and tumbles in a crash.
//
// Bones may have arbitrary local axes after the glTF export, so every pose is expressed in MODEL space:
// each bone gets an absolute rotation delta D (applied on top of its rest orientation) and a model-space
// position; the code converts those to local quaternions / positions through the parent chain.
import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { applyWorldLight } from './shader-patches.js';

const sanitize = (n) => n.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

/** outfit colour choices: hue rotations applied to the saturated parts of the suit, helmet and accents */
export const OUTFIT_HUES = [
  { name: 'Classic', hue: 0 }, { name: 'Ocean', hue: 0.56 }, { name: 'Forest', hue: 0.31 },
  { name: 'Sunshine', hue: 0.13 }, { name: 'Violet', hue: 0.76 }, { name: 'Ruby', hue: 0.93 },
];
const TINT_MATERIALS = ['helmet', 'boot_accent', 'glove_accent', 'basket', 'pack'];
const _col = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
function shiftColor(color, hue) {
  color.getHSL(_hsl, THREE.LinearSRGBColorSpace);
  if (_hsl.s > 0.3 && _hsl.l > 0.015) color.setHSL((_hsl.h + hue) % 1, _hsl.s, _hsl.l, THREE.LinearSRGBColorSpace);
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const AX = V(1, 0, 0), AZ = V(0, 0, 1);
const WORLD_UP = V(0, 1, 0);

const NAMES = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R',
  'UpperArm.L', 'ForeArm.L', 'Hand.L', 'UpperArm.R', 'ForeArm.R', 'Hand.R'];

// temporaries
const _u = V(), _p = V(), _d = V(), _pw = V(), _pv = V(), _dn = V(), _dr = V();
const _up = V(), _f = V(), _l = V();
const _qt = Q(), _qr = Q(), _qa = Q(), _qb = Q(), _qc = Q(), _qd = Q(), _qi = Q();
const _e = new THREE.Euler();
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();

/** point K such that |HK| = l1 and |KA| = l2, bending toward the pole vector */
function solveTwoBone(H, A, l1, l2, pole, outK) {
  const d = clamp(H.distanceTo(A), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _u.copy(A).sub(H).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  _p.copy(pole).addScaledVector(_u, -pole.dot(_u)).normalize();
  outK.copy(H).addScaledVector(_u, a).addScaledVector(_p, h);
}

export class SkierRig {
  /**
   * @param gltf parsed skier.glb  @param rigInfo skier_rig.json
   * @param opts { ghost, clone(fn) } - the ghost gets its own skeleton and a translucent material
   */
  constructor(gltf, rigInfo, opts = {}) {
    this.info = rigInfo;
    this.group = new THREE.Group();
    this.group.name = 'skier';
    this.model = opts.clone ? opts.clone(gltf.scene) : gltf.scene;
    this.group.add(this.model);
    this.meshes = [];
    this.bones = {};
    this.canon = {};
    for (const n of NAMES) this.canon[sanitize(n)] = n;
    this.model.traverse((o) => {
      if (o.isBone) this.bones[this.canon[o.name] || o.name] = o;
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = !opts.ghost;
        o.receiveShadow = true;
        o.frustumCulled = false;
        this.meshes.push(o);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (opts.ghost) { m.transparent = true; m.opacity = 0.34; m.depthWrite = false; }
          applyWorldLight(m);
        }
      }
    });
    this.model.updateMatrixWorld(true);

    // ---- rest state in model space
    const inv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    this.rest = {};
    for (const n of NAMES) {
      const bone = this.bones[n];
      if (!bone) throw new Error(`skier.glb is missing bone ${n}`);
      _m1.multiplyMatrices(inv, bone.matrixWorld);
      const pos = V(), quat = Q(), sc = V();
      _m1.decompose(pos, quat, sc);
      const parent = bone.parent && bone.parent.isBone ? (this.canon[bone.parent.name] || bone.parent.name) : null;
      this.rest[n] = { pos, quat, parent };
    }
    const R = this.rest;
    // the armature node above the root bone may carry a rotation of its own
    const rootBone = this.bones['Root'];
    this.rootParentInv = Q();
    if (rootBone.parent) {
      _m1.multiplyMatrices(inv, rootBone.parent.matrixWorld);
      _m1.decompose(_pw, this.rootParentInv, _pv);
      this.rootParentInv.invert();
    }
    this.legLen = { t: R['UpperLeg.L'].pos.distanceTo(R['LowerLeg.L'].pos), s: R['LowerLeg.L'].pos.distanceTo(R['Foot.L'].pos) };
    this.armLen = { u: R['UpperArm.L'].pos.distanceTo(R['ForeArm.L'].pos), f: R['ForeArm.L'].pos.distanceTo(R['Hand.L'].pos) };

    this.wq = {};
    for (const n of NAMES) this.wq[n] = Q();
    this.quat = Q();
    this.basis = new THREE.Matrix4();
    this.tumble = 0;
    this.tumbleVel = 0;
    this.airBlend = 0;
    this.time = 0;
    this._first = true;
    this.pose = { tuck: 0, compress: 0, roll: 0, bodyYaw: 0, steer: 0, footLift: 0 };
    this.t = { H: V(), A: V(), K: V(), pole: V() };
    this.restPose();
  }

  // ---------------------------------------------------------------------- outfit colour
  /** rotate the hue of the saturated colours (suit vertex colours, helmet, gloves, pack). 0 = as modelled. */
  setHue(hue) {
    if (!this._tint) {
      const suits = [], mats = new Map();
      for (const m of this.meshes) {
        const attr = m.geometry.attributes.color;
        if (attr) suits.push({ attr, orig: Float32Array.from(attr.array), size: attr.itemSize });
        const list = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of list) if (TINT_MATERIALS.includes(mt.name) && !mats.has(mt)) mats.set(mt, mt.color.clone());
      }
      this._tint = { suits, mats };
    }
    const { suits, mats } = this._tint;
    for (const s of suits) {
      const a = s.attr.array, o = s.orig, k = s.size;
      for (let i = 0; i < a.length; i += k) {
        _col.setRGB(o[i], o[i + 1], o[i + 2], THREE.LinearSRGBColorSpace);
        if (hue) shiftColor(_col, hue);
        a[i] = _col.r; a[i + 1] = _col.g; a[i + 2] = _col.b;
      }
      s.attr.needsUpdate = true;
    }
    for (const [mt, orig] of mats) {
      mt.color.copy(orig);
      if (hue) shiftColor(mt.color, hue);
    }
  }

  // ------------------------------------------------------------------ bone helpers
  /** bone `name` gets absolute model-space rotation delta `d` on top of its rest orientation */
  _rot(name, d) {
    const r = this.rest[name];
    const w = this.wq[name].copy(d).multiply(r.quat);
    const bone = this.bones[name];
    if (r.parent) bone.quaternion.copy(this.wq[r.parent]).invert().multiply(w);
    else bone.quaternion.copy(this.rootParentInv).multiply(w);
  }

  /** place bone `name` at model-space position p (parents must already be posed) */
  _pos(name, p) {
    const r = this.rest[name];
    if (!r.parent) return;
    const par = this.rest[r.parent];
    this.bones[name].position.copy(p).sub(par.pos).applyQuaternion(_qd.copy(this.wq[r.parent]).invert());
  }

  /** shortest-arc delta taking the rest bone direction (name -> child) onto dirNew */
  _aim(name, child, dirNew) {
    const r = this.rest[name], c = this.rest[child];
    _dn.copy(dirNew);
    _dr.copy(c.pos).sub(r.pos).normalize();
    return _qb.setFromUnitVectors(_dr, _dn).clone();
  }

  modelPosOf(name) {
    _m1.multiplyMatrices(_m0.copy(this.model.matrixWorld).invert(), this.bones[name].matrixWorld);
    return _pw.setFromMatrixPosition(_m1);
  }

  restPose() {
    for (const n of NAMES) this._rot(n, _qi.identity());
    this._pos('Hips', this.rest['Hips'].pos);
    this._pos('Foot.L', this.rest['Foot.L'].pos);
    this._pos('Foot.R', this.rest['Foot.R'].pos);
  }

  // ------------------------------------------------------------------------ update
  update(sk, dt) {
    this.time += dt;
    const P = this.pose;
    this.airBlend = damp(this.airBlend, sk.grounded ? 0 : 1, 9, dt);
    P.tuck = damp(P.tuck, sk.crashed ? 0 : clamp(sk.tuck, 0, 1), 6, dt);
    P.compress = damp(P.compress, sk.compress, 10, dt);
    P.roll = damp(P.roll, sk.lean * 0.95, 16, dt);
    P.steer = damp(P.steer, sk.steer, 8, dt);
    P.bodyYaw = damp(P.bodyYaw, clamp(-sk.slip * 0.6, -0.5, 0.5), 8, dt);
    P.footLift = damp(P.footLift, this.airBlend * (0.6 + 0.4 * sk.tuck), 8, dt);

    if (sk.crashed) {
      if (this.tumbleVel === 0 && this.tumble === 0) this.tumbleVel = -9.5;
      this.tumble += this.tumbleVel * dt;
      this.tumbleVel = damp(this.tumbleVel, 0, 1.6 + Math.max(0, sk.crashTimer - 0.9) * 3, dt);
      if (sk.crashTimer > 1.1) {
        const floor = -Math.PI * 0.5;
        this.tumble = damp(this.tumble, floor + Math.round((this.tumble - floor) / (2 * Math.PI)) * 2 * Math.PI, 5, dt);
      }
    } else { this.tumble = 0; this.tumbleVel = 0; }

    this._place(sk, dt);
    this._pose(sk);
  }

  _place(sk, dt) {
    const up = _up.set(sk.nx, sk.ny, sk.nz);
    const a = this.airBlend;
    if (a > 0.001) up.lerp(WORLD_UP, 0.55 * a).normalize();
    const f = _f.set(Math.sin(sk.yaw), 0, -Math.cos(sk.yaw));
    if (a > 0.001) {
      const h = Math.hypot(sk.vx, sk.vz) || 1;
      const pitch = Math.atan2(sk.vy, h) * 0.85;
      f.set(Math.sin(sk.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(sk.yaw) * Math.cos(pitch));
    } else {
      f.addScaledVector(up, -f.dot(up)).normalize();
    }
    _l.crossVectors(up, f).normalize();           // left = up x forward
    up.crossVectors(f, _l).normalize();
    this.basis.makeBasis(_l, up, f);              // model axes: X = left, Y = up, Z = forward
    _qt.setFromRotationMatrix(this.basis);
    _qt.multiply(_qr.setFromAxisAngle(AZ, this.pose.roll));
    if (sk.crashed) {
      _qt.multiply(_qr.setFromAxisAngle(AX, this.tumble));
      _qt.multiply(_qr.setFromAxisAngle(AZ, Math.sin(sk.crashTimer * 3.1) * 0.5 * Math.min(1, sk.crashTimer)));
    }
    if (this._first) { this.quat.copy(_qt); this._first = false; }
    else this.quat.slerp(_qt, 1 - Math.exp(-(sk.crashed ? 18 : 30) * dt));
    this.group.quaternion.copy(this.quat);
    this.group.position.set(sk.x, sk.y, sk.z);
    if (sk.crashed) {                              // tumble about the hips, not the skis
      _pv.set(0, 0.9, 0).applyQuaternion(this.quat);
      this.group.position.add(_pv);
      this.group.position.y -= 0.9;
    }
  }

  _pose(sk) {
    const P = this.pose, R = this.rest, t = this.t;
    const tuck = P.tuck, comp = P.compress, air = this.airBlend;
    const lift = P.footLift;

    // root and feet: the skis stay where they are; in the air the feet come up a little
    this._rot('Root', _qi.identity());
    for (const s of ['L', 'R']) {
      const n = `Foot.${s}`;
      this._rot(n, _qa.setFromAxisAngle(AX, -0.28 * lift));
      this._pos(n, _pw.copy(R[n].pos).add(_d.set(0, 0.06 * lift, -0.02 * lift)));
    }

    // hips: height, set-back and angulation
    const crouch = 0.32 * tuck + 0.06 * comp + 0.14 * air * (0.4 + 0.6 * tuck) + 0.03 * Math.abs(P.roll);
    const back = -0.20 * tuck - 0.03 * comp;
    const inside = -P.roll * 0.10;
    const torsoFwd = 0.66 * tuck + 0.05 * comp - 0.06 * air * (1 - tuck);
    const ang = -0.30 * P.roll;
    const twist = P.bodyYaw;
    this._rot('Hips', _qa.setFromEuler(_e.set(torsoFwd * 0.45, 0, ang * 0.3, 'XYZ')));
    this._pos('Hips', _pw.copy(R['Hips'].pos).add(_d.set(inside, -crouch, back)));
    this._rot('Spine', _qa.setFromEuler(_e.set(torsoFwd * 0.8, twist * 0.5, ang * 0.7, 'XYZ')));
    this._rot('Chest', _qa.setFromEuler(_e.set(torsoFwd, twist, ang, 'XYZ')));
    this._rot('Neck', _qa.setFromEuler(_e.set(torsoFwd * 0.55 - 0.05, twist * 1.2 + P.steer * 0.12, ang * 0.5, 'XYZ')));
    this._rot('Head', _qa.setFromEuler(_e.set(-0.10 * tuck, twist * 1.4 + P.steer * 0.25, ang * 0.2, 'XYZ')));
    // forward kinematics moves everything above the hips with them
    this.model.updateMatrixWorld(true);

    // legs: IK from the moved hips to the (fixed) ankles
    for (const [s, sx] of [['L', 1], ['R', -1]]) {
      const H = t.H.copy(this.modelPosOf(`UpperLeg.${s}`));
      const A = t.A.copy(R[`Foot.${s}`].pos).add(_d.set(0, 0.06 * lift, -0.02 * lift));
      t.pole.set(sx * 0.08, 0.05, 1);
      solveTwoBone(H, A, this.legLen.t, this.legLen.s, t.pole, t.K);
      this._rot(`UpperLeg.${s}`, this._aim(`UpperLeg.${s}`, `LowerLeg.${s}`, _d.copy(t.K).sub(H).normalize()));
      this._rot(`LowerLeg.${s}`, this._aim(`LowerLeg.${s}`, `Foot.${s}`, _d.copy(A).sub(t.K).normalize()));
    }

    // arms: reach for hand targets relative to the shoulders
    for (const [s, sx] of [['L', 1], ['R', -1]]) {
      const S = t.H.copy(this.modelPosOf(`UpperArm.${s}`));
      const tg = t.A.copy(S).add(_d.copy(R[`Hand.${s}`].pos).sub(R[`UpperArm.${s}`].pos));
      tg.x += -sx * 0.11 * tuck + sx * 0.06 * air - P.steer * 0.05 + P.roll * 0.05;
      tg.y += 0.06 * tuck + 0.10 * air - 0.05 * comp;
      tg.z += 0.16 * tuck - 0.04 * air;
      t.pole.set(sx * 0.7, -0.6, -0.35);
      solveTwoBone(S, tg, this.armLen.u, this.armLen.f, t.pole, t.K);
      this._rot(`UpperArm.${s}`, this._aim(`UpperArm.${s}`, `ForeArm.${s}`, _d.copy(t.K).sub(S).normalize()));
      const fa = this._aim(`ForeArm.${s}`, `Hand.${s}`, _d.copy(tg).sub(t.K).normalize());
      this._rot(`ForeArm.${s}`, fa);
      // the hand follows the forearm; tucking swings the poles back along the body
      _qc.setFromEuler(_e.set(1.15 * tuck - 0.25 * air, 0, 0, 'XYZ')).multiply(fa);
      this._rot(`Hand.${s}`, _qc);
    }
  }
}
