// Furniture of the open world, built from props.glb: the village (lodge, chalets, chapel, huts), five rideable chairlifts,
// piste marker poles coloured by difficulty, trail signs, the summit cross and the collectible flags.
import * as THREE from 'three';
import { applyWorldLight } from './shader-patches.js';
import { collectParts, Inst } from './props-kit.js';
import { Chairlift } from './chairlift.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const LEVELS = ['green', 'blue', 'red', 'black'];
const FALLBACK = { alp_hut: 'hut', chapel: 'hut', chalet_a: 'hut', chalet_b: 'hut', chalet_c: 'hut' };

export class OpenProps {
  constructor(world, gltf, opts = {}) {
    this.world = world;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'open-props';
    this.parts = collectParts(gltf);
    this._prepMaterials(opts);
    this.lifts = [];
    this.flagInst = null;
    this._buildBuildings();
    this._buildLifts();
    this._buildMarkers();
    this._buildSigns();
    this._buildFlags();
    this.time = 0;
  }

  part(name) {
    return this.parts.get(name) || (FALLBACK[name] ? this.parts.get(FALLBACK[name]) : null);
  }

  _prepMaterials(opts) {
    const done = new Set();
    for (const parts of this.parts.values()) {
      for (const p of parts) {
        const m = p.material;
        if (done.has(m)) continue;
        done.add(m);
        if (m.name === 'glass') {
          m.emissiveIntensity = opts.glow ?? 6;
          m.roughness = 0.15;
        }
        if (m.name === 'flag_cloth') {
          m.emissiveIntensity = (opts.glow ?? 6) * 0.9;
          m.side = THREE.DoubleSide;
        }
        if (m.map) m.map.anisotropy = opts.anisotropy || 8;
        applyWorldLight(m);
      }
    }
  }

  // ------------------------------------------------------------------------------ village
  _buildBuildings() {
    const list = this.world.info.buildings || [];
    const byType = new Map();
    for (const b of list) {
      if (!byType.has(b.type)) byType.set(b.type, []);
      byType.get(b.type).push(b);
    }
    this.buildingInst = [];
    this.buildings = list;
    let k = 0;
    for (const [type, items] of byType) {
      const parts = this.part(type);
      if (!parts) continue;
      const inst = new Inst(parts, items.length, { cast: true, receive: true, group: this.group });
      items.forEach((b, i) => {
        const big = FALLBACK[type] && !this.parts.get(type) ? 1.35 : 1;
        const sc = big * (type.startsWith('chalet') ? 0.94 + 0.12 * (((k++ * 2654435761) >>> 0) % 1000) / 1000 : 1);
        _p.set(b.x, b.y - 0.05, b.z);
        _q.setFromAxisAngle(UP, b.yaw);
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        inst.set(i, _m);
      });
      inst.commit(items.length);
      this.buildingInst.push(inst);
    }
    _s.set(1, 1, 1);
  }

  // ------------------------------------------------------------------------------- lifts
  _buildLifts() {
    for (const spec of this.world.info.lifts || []) {
      this.lifts.push(new Chairlift(this.world, this.group, this.parts, spec, { radiance: this.opts.radiance }));
    }
  }

  // ------------------------------------------------------------------------- piste markers
  _buildMarkers() {
    const P = this.world.poles;
    const n = P.length / 4;
    const per = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) per[P[i * 4 + 3] | 0]++;
    this.markers = LEVELS.map((lvl, li) => {
      const parts = this.parts.get(`marker_${lvl}`) || this.parts.get('marker');
      if (!parts || !per[li]) return null;
      return new Inst(parts, per[li], { cast: true, receive: true, group: this.group });
    });
    const at = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const li = P[i * 4 + 3] | 0;
      const inst = this.markers[li];
      if (!inst) continue;
      _p.set(P[i * 4], P[i * 4 + 2] - 0.06, P[i * 4 + 1]);
      _q.setFromAxisAngle(UP, i * 2.399);
      _m.compose(_p, _q, _s);
      inst.set(at[li]++, _m);
    }
    this.markers.forEach((inst, li) => inst && inst.commit(at[li]));
  }

  // ------------------------------------------------------------------------------- signs
  _buildSigns() {
    const list = [];
    for (const pst of this.world.pistes) {
      const s = pst.sampler;
      const p = s.at(s.s0 + 8, {});
      const side = p.width * 0.5 + 3.2;
      list.push({ x: p.x + p.rx * side, z: p.z + p.rz * side, yaw: Math.atan2(-p.tx, -p.tz), level: pst.level });
    }
    this.signInst = LEVELS.map((lvl) => {
      const parts = this.parts.get(`sign_${lvl}`);
      const mine = list.filter((e) => e.level === lvl);
      if (!parts || !mine.length) return null;
      const inst = new Inst(parts, mine.length, { cast: true, receive: true, group: this.group });
      mine.forEach((e, i) => {
        _p.set(e.x, this.world.height(e.x, e.z) - 0.05, e.z);
        _q.setFromAxisAngle(UP, e.yaw);
        _m.compose(_p, _q, _s);
        inst.set(i, _m);
      });
      inst.commit(mine.length);
      return inst;
    });
    // the summit cross
    const summit = (this.world.info.landmarks || []).find((l) => l.id === 'summit');
    const cross = this.parts.get('summit_cross');
    if (summit && cross) {
      const inst = new Inst(cross, 1, { cast: true, receive: true, group: this.group });
      _p.set(summit.x, this.world.height(summit.x, summit.z) - 0.1, summit.z);
      _q.setFromAxisAngle(UP, 0.5);
      _m.compose(_p, _q, _s);
      inst.set(0, _m);
      inst.commit(1);
    }
  }

  // ------------------------------------------------------------------------------- flags
  _buildFlags() {
    const flags = this.world.info.flags || [];
    const parts = this.parts.get('flag');
    this.flagCount = flags.length;
    if (!parts || !flags.length) return;
    const inst = this.flagInst = new Inst(parts, flags.length, { cast: true, receive: true, group: this.group });
    this._flagMats = flags.map((f, i) => {
      _p.set(f.x, this.world.height(f.x, f.z) - 0.05, f.z);
      _q.setFromAxisAngle(UP, (i * 2.399) % 6.283);
      _m.compose(_p, _q, _s);
      return _m.clone();
    });
    this.setCollected(new Set());
  }

  /** show every flag except the ones in `taken` */
  setCollected(taken) {
    if (!this.flagInst) return;
    this._flagMats.forEach((m, i) => this.flagInst.set(i, taken.has(i) ? ZERO : m));
    this.flagInst.commit(this._flagMats.length);
  }

  hideFlag(i) {
    if (!this.flagInst) return;
    this.flagInst.set(i, ZERO);
    this.flagInst.commit(this._flagMats.length);
  }

  // ------------------------------------------------------------------------------ frame
  update(dt, time) {
    this.time = time;
    for (const l of this.lifts) l.update(dt, time);
  }
}
