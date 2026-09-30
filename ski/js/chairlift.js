// A chairlift: pylons, two terminals, the cable loop and the chairs riding on it. The chairs move along one closed loop
// (up line, wrap around the top wheel, down line, wrap around the bottom wheel), and the game can take a chair's pose to
// carry the skier ("rideable"): chairMatrix(), boarding point, nearest arriving chair, the exit at the top.
import * as THREE from 'three';
import { Inst, spawn } from './props-kit.js';

const UP = new THREE.Vector3(0, 1, 0);
const ARM = 2.3, PYLON_H = 9.0, CABLE_PYL = PYLON_H + 0.84, CABLE_STN = 4.6;
const SPACING = 34;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _z = new THREE.Vector3();

export class Chairlift {
  /**
   * @param world WorldData (ground height)
   * @param group THREE.Group everything is added to
   * @param parts Map from collectParts(props.glb)
   * @param spec  { id, name, points: [[x, z], ...] (bottom station first), cable?: absolute cable height at every point, speed? }
   * @param opts  { radiance } scene radiance used to tint the cable
   */
  constructor(world, group, parts, spec, opts = {}) {
    this.world = world;
    this.spec = spec;
    this.id = spec.id || 'lift';
    this.name = spec.name || 'Chairlift';
    this.group = group;
    const need = (n) => { const p = parts.get(n); if (!p) throw new Error(`props.glb is missing '${n}'`); return p; };
    const pts = spec.points;
    const N = pts.length;
    const w = world;
    const dirs = [];
    for (let i = 0; i < N; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, N - 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dirs.push([dx / l, dz / l]);
    }
    this.dirs = dirs;
    this.points = pts;

    // pylons (taller where the ground drops away) and the cable heights over every point
    const pyl = new Inst(need('lift_pylon'), Math.max(N - 2, 1), { cast: true, receive: true, group });
    const top = [];
    for (let i = 0; i < N; i++) {
      const [x, z] = pts[i];
      const y = w.height(x, z);
      const [dx, dz] = dirs[i];
      const rx = -dz, rz = dx;
      const station = i === 0 || i === N - 1;
      const cy = spec.cable ? spec.cable[i] : y + (station ? CABLE_STN : CABLE_PYL);
      top.push({ up: new THREE.Vector3(x + rx * ARM, cy, z + rz * ARM), down: new THREE.Vector3(x - rx * ARM, cy, z - rz * ARM), c: new THREE.Vector3(x, cy, z) });
      if (!station) {
        _q.setFromAxisAngle(UP, Math.atan2(-rz, rx));
        _p.set(x, y - 0.1, z);
        _s.set(1, Math.max(1, (cy - y) / CABLE_PYL), 1);
        _m.compose(_p, _q, _s);
        pyl.set(i - 1, _m);
      }
    }
    _s.set(1, 1, 1);
    pyl.commit(Math.max(N - 2, 0));
    this.top = top;

    // terminals
    const stationParts = need('lift_station');
    const st0 = spawn(stationParts);
    st0.position.set(pts[0][0], w.height(pts[0][0], pts[0][1]), pts[0][1]);
    st0.rotation.y = Math.atan2(dirs[0][0], dirs[0][1]);
    const st1 = spawn(stationParts);
    st1.position.set(pts[N - 1][0], w.height(pts[N - 1][0], pts[N - 1][1]), pts[N - 1][1]);
    st1.rotation.y = Math.atan2(-dirs[N - 1][0], -dirs[N - 1][1]);
    group.add(st0, st1);
    this.stations = [st0, st1];

    // closed loop polyline: up line, wrap around the top wheel, down line, wrap around the bottom wheel
    const loop = [];
    const span = (A, B) => {
      const L = A.distanceTo(B);
      const sag = 0.02 * L;
      const n = Math.max(4, Math.round(L / 8));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const v = A.clone().lerp(B, f);
        v.y -= sag * 4 * f * (1 - f);
        loop.push(v);
      }
    };
    const wrap = (C, from, dir) => {
      const a0 = Math.atan2(from.z - C.z, from.x - C.x);
      const mid = Math.atan2(dir[1], dir[0]);
      let da = mid - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const sgn = da >= 0 ? 1 : -1;
      const n = 14;
      for (let k = 0; k < n; k++) {
        const a = a0 + sgn * Math.PI * (k / n);
        loop.push(new THREE.Vector3(C.x + Math.cos(a) * ARM, C.y, C.z + Math.sin(a) * ARM));
      }
    };
    for (let i = 0; i < N - 1; i++) span(top[i].up, top[i + 1].up);
    const upEndIndex = loop.length;
    wrap(top[N - 1].c, top[N - 1].up, dirs[N - 1]);
    for (let i = N - 1; i > 0; i--) span(top[i].down, top[i - 1].down);
    wrap(top[0].c, top[0].down, [-dirs[0][0], -dirs[0][1]]);
    loop.push(loop[0].clone());
    const cum = [0];
    for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + loop[i].distanceTo(loop[i - 1]));
    const total = cum[cum.length - 1];
    this.loop = loop;
    this.cum = cum;
    this.total = total;
    this.upEndDist = cum[upEndIndex];

    // cables (two thin lines)
    const seg = [];
    for (let i = 0; i < loop.length - 1; i++) seg.push(loop[i].x, loop[i].y, loop[i].z, loop[i + 1].x, loop[i + 1].y, loop[i + 1].z);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const cable = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.55, 0.55, 0.58).multiplyScalar(opts.radiance ? opts.radiance * 0.03 : 0.6) }));
    cable.frustumCulled = false;
    group.add(cable);
    this.cable = cable;

    // chairs
    const count = Math.max(2, Math.floor(total / SPACING));
    const chairs = new Inst(need('lift_chair'), count, { cast: false, receive: true, group });
    chairs.commit(count);
    this.chairs = chairs;
    this.count = count;
    this.spacing = total / count;
    this.speed = spec.speed || 5.0;
    this.speedMul = 1;
    this.offset = 0;
    this.phase = Array.from({ length: count }, (_, i) => i * 1.7);
    this.mats = Array.from({ length: count }, () => new THREE.Matrix4());
    this.u = new Float32Array(count);
    this.time = 0;
    this.update(0, 0);

    // handy places for the game
    const g0 = w.height(pts[0][0], pts[0][1]);
    const g1 = w.height(pts[N - 1][0], pts[N - 1][1]);
    this.base = { x: pts[0][0], z: pts[0][1], y: g0, dx: dirs[0][0], dz: dirs[0][1] };
    this.summit = { x: pts[N - 1][0], z: pts[N - 1][1], y: g1, dx: dirs[N - 1][0], dz: dirs[N - 1][1] };
  }

  /** pose of the cable point at loop distance u: writes position and yaw, returns the segment direction */
  pointAt(u, outPos, outDir) {
    const { loop, cum, total } = this;
    u = ((u % total) + total) % total;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= u) lo = mid; else hi = mid; }
    const A = loop[lo], B = loop[lo + 1];
    const f = (u - cum[lo]) / Math.max(cum[lo + 1] - cum[lo], 1e-4);
    outPos.copy(A).lerp(B, f);
    if (outDir) outDir.copy(B).sub(A);
    return outPos;
  }

  update(dt, time) {
    this.time = time;
    this.offset = (this.offset + this.speed * this.speedMul * dt) % this.total;
    for (let c = 0; c < this.count; c++) {
      const u = (this.offset + c * this.spacing) % this.total;
      this.u[c] = u;
      this.pointAt(u, _p, _a);
      _q.setFromAxisAngle(UP, Math.atan2(_a.x, _a.z));
      const sway = 0.045 * Math.sin(time * 1.3 + this.phase[c]);
      _q2.setFromAxisAngle(_z.set(_a.x, 0, _a.z).normalize(), sway);
      _q.premultiply(_q2);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      this.chairs.set(c, _m);
      this.mats[c].copy(_m);
    }
    this.chairs.commit(this.count);
  }

  /** world position of the seat of chair c (cable point + hanger and seat offsets in the chair frame) */
  seatPosition(c, out) {
    return out.set(0, -1.93, 0.02).applyMatrix4(this.mats[c]);
  }

  /** yaw of chair c (direction of travel) */
  chairYaw(c) {
    _q.setFromRotationMatrix(this.mats[c]);
    _a.set(0, 0, 1).applyQuaternion(_q);
    return Math.atan2(_a.x, _a.z);
  }

  /** loop distance of the boarding point (a few metres into the up line) and the ground spot under it */
  boardingSpot(out, dist = 7.0) {
    this.pointAt(dist, _p, null);
    out.set(_p.x, this.world.height(_p.x, _p.z), _p.z);
    return out;
  }

  /** the chair that will reach the boarding point next (not one that is already there): { c, wait seconds } */
  nextChair(dist = 7.0, minAhead = 6.0) {
    let best = -1, bestAhead = 1e9;
    for (let c = 0; c < this.count; c++) {
      let ahead = dist - this.u[c];
      if (ahead < 0) ahead += this.total;
      if (ahead >= minAhead && ahead < bestAhead) { bestAhead = ahead; best = c; }
    }
    return { c: best, wait: bestAhead / (this.speed * this.speedMul) };
  }

  /** how far chair c has travelled along the up line (m); > upEndDist means it has passed the top wheel */
  progress(c) {
    return this.u[c];
  }
}
