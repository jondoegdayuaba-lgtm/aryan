// Course furniture built from the Blender props.glb:
// slalom gates that swing when hit, piste-edge markers, start / finish / checkpoint gantries with fluttering
// banners, safety nets, the timing hut, the base lodge and a working chairlift.
import * as THREE from 'three';
import { applyWorldLight } from './shader-patches.js';
import { clamp } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();

// -------------------------------------------------------------------------------- glb helpers
function collectParts(gltf) {
  const map = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const [prop, mat] = o.name.split('__');
    if (!mat) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!map.has(prop)) map.set(prop, []);
    map.get(prop).push({ geometry, material: o.material, name: mat });
  });
  return map;
}

/** InstancedMesh set for one prop (one InstancedMesh per material). */
class Inst {
  constructor(parts, capacity, { cast = true, receive = true, group }) {
    this.capacity = capacity;
    this.meshes = parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = cast;
      im.receiveShadow = receive;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im);
      return im;
    });
    this.count = 0;
  }

  set(i, matrix) {
    for (const im of this.meshes) im.setMatrixAt(i, matrix);
  }

  commit(count = this.count) {
    this.count = count;
    for (const im of this.meshes) {
      im.count = count;
      im.instanceMatrix.needsUpdate = true;
    }
  }
}

function spawn(parts, { cast = true, receive = true } = {}) {
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    g.add(m);
  }
  return g;
}

/** A cloth strip between two posts that flutters in the wind. Textures are glTF style (v = 0 at the top). */
class Banner {
  constructor(material, width, height, seed = 0) {
    const segs = Math.max(10, Math.round(width / 0.7));
    this.segs = segs;
    this.width = width;
    this.height = height;
    this.seed = seed;
    const n = (segs + 1) * 2;
    this.pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = [];
    const repeats = Math.max(1, Math.round(width / (height * 4)));
    for (let i = 0; i <= segs; i++) {
      const u = (i / segs) * repeats;
      uv.set([u, 0, u, 1], i * 4);
      if (i < segs) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.update(0);
  }

  update(time) {
    const { segs, width, height, seed, pos } = this;
    const nor = this.geometry.attributes.normal.array;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const edge = Math.sin(Math.PI * t);                                   // pinned at both posts
      const w = 0.16 * edge * Math.sin(t * 9.0 - time * 2.6 + seed) + 0.07 * edge * Math.sin(t * 17.0 - time * 4.3 + seed * 2);
      const sag = -0.35 * edge;
      for (let k = 0; k < 2; k++) {
        const j = (i * 2 + k) * 3;
        const hang = k === 0 ? 0 : -height;
        pos[j] = t * width;
        pos[j + 1] = sag * (k === 0 ? 1 : 0.6) + hang;
        pos[j + 2] = w * (k === 0 ? 0.5 : 1.0);
      }
      // normal from the ripple slope
      const dz = 0.16 * edge * 9.0 / width * Math.cos(t * 9.0 - time * 2.6 + seed);
      const l = Math.hypot(dz, 1);
      for (let k = 0; k < 2; k++) {
        const j = (i * 2 + k) * 3;
        nor[j] = -dz / l; nor[j + 1] = 0; nor[j + 2] = 1 / l;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
  }
}

// ------------------------------------------------------------------------------------ Props
export class Props {
  constructor(world, gltf, opts = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.parts = collectParts(gltf);
    this.opts = opts;
    this.time = 0;
    this._prepMaterials(opts);
    this.runGroup = new THREE.Group();
    this.group.add(this.runGroup);
    this.banners = [];
    this.poles = [];
    this.disposables = [];

    // slalom gate poles (pooled, re-filled by setRun)
    const gp = { cast: true, receive: true, group: this.group };
    this.gateInst = { red: new Inst(this.need('gate_red'), 64, gp), blue: new Inst(this.need('gate_blue'), 64, gp) };
    this._buildMarkers();
    this._buildNets();
    this._buildBuildings();
    this._buildLift();
    this.stats = { instances: 0 };
  }

  need(name) {
    const p = this.parts.get(name);
    if (!p) throw new Error(`props.glb is missing '${name}'`);
    return p;
  }

  _prepMaterials(opts) {
    const done = new Set();
    for (const parts of this.parts.values()) {
      for (const p of parts) {
        const m = p.material;
        if (done.has(m)) continue;
        done.add(m);
        if (/^net_/.test(m.name)) {
          m.transparent = false;
          m.alphaTest = 0.35;
          m.alphaToCoverage = true;
          m.side = THREE.DoubleSide;
          m.roughness = 0.9;
        }
        if (m.name === 'glass') {
          m.emissiveIntensity = opts.glow ?? 6;
          m.roughness = 0.15;
        }
        if (m.map) m.map.anisotropy = opts.anisotropy || 8;
        applyWorldLight(m);
      }
    }
  }

  // ======================================================================== static furniture
  _buildMarkers() {
    const w = this.world;
    const P = w.poles;
    const n = P.length / 4;
    const inst = this.markers = new Inst(this.need('marker'), Math.max(n, 1), { cast: true, receive: true, group: this.group });
    for (let i = 0; i < n; i++) {
      _p.set(P[i * 4], P[i * 4 + 2] - 0.06, P[i * 4 + 1]);
      _q.setFromAxisAngle(UP, i * 2.399);
      _m.compose(_p, _q, _s);
      inst.set(i, _m);
    }
    inst.commit(n);
  }

  _buildNets() {
    const w = this.world;
    const nets = w.info.nets || [];
    const kinds = ['orange', 'blue'];
    const lists = [[], []];
    const step = 6;
    nets.forEach((net, ni) => {
      const which = ni % 2;
      const at = (s) => {
        const p = w.path.at(s, {});
        const off = net.side * (p.width * 0.5 + net.off);
        const x = p.x + p.rx * off, z = p.z + p.rz * off;
        return [x, w.height(x, z), z];
      };
      let prev = at(net.s0);
      for (let s = net.s0; s + step <= net.s1 + 0.01; s += step) {
        const next = at(s + step);
        lists[which].push([prev, next]);
        prev = next;
      }
    });
    this.netInst = kinds.map((k, i) => {
      const inst = new Inst(this.need(`net_${k}`), Math.max(lists[i].length, 1), { cast: false, receive: true, group: this.group });
      lists[i].forEach(([a, b], j) => {
        _x.set((b[0] - a[0]) / step, (b[1] - a[1]) / step, (b[2] - a[2]) / step);
        _z.crossVectors(_x, UP).normalize();
        _m.makeBasis(_x, UP, _z);
        _m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        inst.set(j, _m);
      });
      inst.commit(lists[i].length);
      return inst;
    });
  }

  _placeBuilding(name, x, y, z, yaw, opts = {}) {
    const g = spawn(this.need(name), opts);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    g.name = name;
    this.group.add(g);
    return g;
  }

  _buildBuildings() {
    const pr = this.world.info.props || {};
    this.buildings = [];
    if (pr.startHut) this.buildings.push(this._placeBuilding('hut', pr.startHut.x, pr.startHut.y, pr.startHut.z, pr.startHut.yaw));
    if (pr.lodge) this.buildings.push(this._placeBuilding('lodge', pr.lodge.x, pr.lodge.y, pr.lodge.z, pr.lodge.yaw));
  }

  // ------------------------------------------------------------------------------- chairlift
  _buildLift() {
    const lift = this.world.info.props && this.world.info.props.lift;
    this.lift = null;
    if (!lift || lift.points.length < 3) return;
    const w = this.world;
    const pts = lift.points;
    const N = pts.length;
    const ARM = 2.3, PYLON_H = 9.0, CABLE_PYL = PYLON_H + 0.84, CABLE_STN = 4.6;
    const dirs = [];
    for (let i = 0; i < N; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, N - 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dirs.push([dx / l, dz / l]);
    }
    // pylons
    const pyl = new Inst(this.need('lift_pylon'), N, { cast: true, receive: true, group: this.group });
    const top = [];        // cable points on the up (+ARM) and down (-ARM) lines
    for (let i = 0; i < N; i++) {
      const [x, z] = pts[i];
      const y = w.height(x, z);
      const [dx, dz] = dirs[i];
      const rx = -dz, rz = dx;
      const cy = y + (i === 0 || i === N - 1 ? CABLE_STN : CABLE_PYL);
      top.push({ up: new THREE.Vector3(x + rx * ARM, cy, z + rz * ARM), down: new THREE.Vector3(x - rx * ARM, cy, z - rz * ARM), c: new THREE.Vector3(x, cy, z) });
      if (i > 0 && i < N - 1) {
        _q.setFromAxisAngle(UP, Math.atan2(-rz, rx));
        _p.set(x, y - 0.1, z);
        _m.compose(_p, _q, _s);
        pyl.set(i - 1, _m);
      }
    }
    pyl.commit(N - 2);
    // terminals
    const stationParts = this.need('lift_station');
    const st0 = spawn(stationParts);
    st0.position.set(pts[0][0], w.height(pts[0][0], pts[0][1]), pts[0][1]);
    st0.rotation.y = Math.atan2(dirs[0][0], dirs[0][1]);
    const st1 = spawn(stationParts);
    st1.position.set(pts[N - 1][0], w.height(pts[N - 1][0], pts[N - 1][1]), pts[N - 1][1]);
    st1.rotation.y = Math.atan2(-dirs[N - 1][0], -dirs[N - 1][1]);
    this.group.add(st0, st1);

    // closed loop polyline: up line, wrap around the top wheel, down line, wrap around the bottom wheel
    const loop = [];
    const push = (v) => loop.push(v.clone());
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
    const wrap = (C, from, dir) => {          // half circle from the +ARM side to the -ARM side (or back) passing through C + dir * ARM
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
    wrap(top[N - 1].c, top[N - 1].up, dirs[N - 1]);
    for (let i = N - 1; i > 0; i--) span(top[i].down, top[i - 1].down);
    wrap(top[0].c, top[0].down, [-dirs[0][0], -dirs[0][1]]);
    loop.push(loop[0].clone());
    const cum = [0];
    for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + loop[i].distanceTo(loop[i - 1]));
    const total = cum[cum.length - 1];

    // cables (two thin lines)
    const seg = [];
    for (let i = 0; i < loop.length - 1; i++) seg.push(loop[i].x, loop[i].y, loop[i].z, loop[i + 1].x, loop[i + 1].y, loop[i + 1].z);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const cable = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.55, 0.55, 0.58).multiplyScalar(this.opts.radiance ? this.opts.radiance * 0.03 : 0.6) }));
    cable.frustumCulled = false;
    this.group.add(cable);

    // chairs
    const spacing = 34;
    const count = Math.floor(total / spacing);
    const chairs = new Inst(this.need('lift_chair'), count, { cast: false, receive: true, group: this.group });
    chairs.commit(count);
    this.lift = { loop, cum, total, count, chairs, spacing: total / count, speed: 5.0, offset: 0, phase: Array.from({ length: count }, (_, i) => i * 1.7) };
  }

  _updateLift(dt, time) {
    const L = this.lift;
    if (!L) return;
    L.offset = (L.offset + L.speed * dt) % L.total;
    const { loop, cum } = L;
    let seg = 0;
    for (let c = 0; c < L.count; c++) {
      const u = (L.offset + c * L.spacing) % L.total;
      // segments are visited in order as c grows (mod wrap), so a binary search keeps this cheap
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= u) lo = mid; else hi = mid; }
      seg = lo;
      const A = loop[seg], B = loop[seg + 1];
      const f = (u - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-4);
      _p.copy(A).lerp(B, f);
      _a.copy(B).sub(A);
      _q.setFromAxisAngle(UP, Math.atan2(_a.x, _a.z));
      const sway = 0.045 * Math.sin(time * 1.3 + L.phase[c]);
      _q2.setFromAxisAngle(_z.set(_a.x, 0, _a.z).normalize(), sway);
      _q.premultiply(_q2);
      _m.compose(_p, _q, _s);
      L.chairs.set(c, _m);
    }
    L.chairs.commit(L.count);
  }

  // ============================================================================ per run
  setRun(run) {
    const w = this.world;
    // tear down the previous course
    for (const b of this.banners) b.dispose();
    this.banners.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.runGroup.clear();
    this.poles.length = 0;
    this.run = run;

    // ---- slalom gates
    const counts = { red: 0, blue: 0 };
    if (run.mode === 'slalom') {
      run.gates.forEach((g, gi) => {
        const col = g.colour === 'blue' ? 'blue' : 'red';
        const rx = -g.tz, rz = g.tx;
        for (const side of [-1, 1]) {
          const x = g.x + rx * g.open * side, z = g.z + rz * g.open * side;
          const inst = this.gateInst[col];
          const idx = counts[col]++;
          this.poles.push({
            inst, idx, x, z, y: w.height(x, z) - 0.03, gate: gi, side,
            yaw: Math.atan2(-rz, rx) + (side > 0 ? Math.PI : 0),
            tilt: 0, vel: 0, dx: 1, dz: 0, dirty: true, hitCool: 0,
          });
        }
      });
    }
    for (const p of this.poles) this._poleMatrix(p);
    for (const k of ['red', 'blue']) this.gateInst[k].commit(counts[k]);

    // ---- gantries, checkpoints and ground lines
    const startP = w.path.at(run.sStart, {});
    const endP = w.path.at(run.sEnd, {});
    this._gantry(startP, 'start', Math.min(startP.width * 0.5 + 1.4, 21), 'banner_start', 'start_post', 6.5);
    this._gantry(endP, 'finish', Math.min(endP.width * 0.5 + 1.4, 24), 'banner_finish', 'finish_post', 7.5);
    this._groundLine(startP, Math.min(startP.width * 0.5, 20), 0.7, 'start');
    this._groundLine(endP, Math.min(endP.width * 0.5, 22), 3.0, 'finish');
    if (run.mode !== 'slalom') {
      run.gates.forEach((g, i) => {
        const p = { x: g.x, z: g.z, tx: g.tx, tz: g.tz, rx: -g.tz, rz: g.tx };
        this._gantry(p, `check${i}`, g.open + 1.3, 'banner_check', 'start_post', 6.5);
        this._groundLine(p, g.open, 0.5, 'check');
      });
    }
  }

  _gantry(p, name, half, bannerProp, postProp, height) {
    const w = this.world;
    const yaw = Math.atan2(p.tx, p.tz);                      // local +z along the run direction
    const rx = -p.tz, rz = p.tx;
    const ends = [];
    for (const side of [-1, 1]) {
      const x = p.x + rx * half * side, z = p.z + rz * half * side;
      const g = spawn(this.need(postProp));
      g.position.set(x, w.height(x, z) - 0.1, z);
      g.rotation.y = yaw;
      this.runGroup.add(g);
      ends.push([x, w.height(x, z), z]);
    }
    const bp = this.need(bannerProp)[0];
    const span = 2 * half;
    const bh = 2.2;
    const b = new Banner(bp.material, span, bh, name.length * 1.3 + span);
    const yTop = Math.min(ends[0][1], ends[1][1]) + height - 0.35;
    // the strip runs along +x of its frame; face the run direction
    b.mesh.position.set(p.x - rx * half, yTop, p.z - rz * half);
    b.mesh.rotation.y = Math.atan2(-rz, rx);
    this.runGroup.add(b.mesh);
    this.banners.push(b);
    // a taut wire along the top edge
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, span, 5), this._wireMaterial());
    wire.position.set(p.x, yTop + 0.03, p.z);
    wire.quaternion.setFromUnitVectors(UP, new THREE.Vector3(rx, 0, rz).normalize());
    wire.castShadow = true;
    this.runGroup.add(wire);
    this.disposables.push(wire.geometry);
  }

  _wireMaterial() {
    if (!this._wire) this._wire = applyWorldLight(new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0.6 }));
    return this._wire;
  }

  /** a strip painted on the snow across the piste, following the terrain */
  _groundLine(p, half, depth, kind) {
    const w = this.world;
    const nu = Math.max(8, Math.round(half * 2 / 1.5));
    const nv = Math.max(1, Math.round(depth / 1.0));
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const t = (i / nu * 2 - 1) * half;
        const a = (j / nv - 0.5) * depth;
        const x = p.x + p.rx * t + p.tx * a, z = p.z + p.rz * t + p.tz * a;
        pos.push(x, w.height(x, z) + 0.07, z);
        uv.push(t / 2, a / 2 + 0.5);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i;
        idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = this._lineMaterial(kind);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.runGroup.add(mesh);
    this.disposables.push(g);
  }

  _lineMaterial(kind) {
    this._lineMats = this._lineMats || {};
    if (this._lineMats[kind]) return this._lineMats[kind];
    let m;
    const common = { roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    if (kind === 'finish') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#e9edf4'; x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#15171c'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      m = new THREE.MeshStandardMaterial({ map: tex, ...common });
    } else {
      m = new THREE.MeshStandardMaterial({ color: kind === 'start' ? new THREE.Color(0.02, 0.10, 0.42) : new THREE.Color(0.02, 0.32, 0.17), ...common });
    }
    applyWorldLight(m);
    this._lineMats[kind] = m;
    return m;
  }

  // ============================================================================= per frame
  _poleMatrix(p) {
    _q.setFromAxisAngle(UP, p.yaw);
    if (p.tilt !== 0) {
      _a.set(p.dz, 0, -p.dx);                     // axis so that the top of the pole moves along (dx, dz)
      _q2.setFromAxisAngle(_a, p.tilt);
      _q.premultiply(_q2);
    }
    _p.set(p.x, p.y, p.z);
    _m.compose(_p, _q, _s);
    p.inst.set(p.idx, _m);
    p.dirty = false;
  }

  update(dt, time, course, skier) {
    this.time = time;
    for (const b of this.banners) b.update(time);
    this._updateLift(dt, time);

    // ---- slalom poles: swing when the skier brushes them, spring back with a few wobbles
    if (this.poles.length) {
      let touched = false;
      for (const p of this.poles) {
        if (skier && !skier.crashed) {
          const dx = p.x - skier.x, dz = p.z - skier.z;
          if (dx * dx + dz * dz < 0.42 * 0.42 && skier.y - p.y < 1.4 && p.hitCool <= 0) {
            const sp = Math.hypot(skier.vx, skier.vz);
            const l = Math.hypot(skier.vx, skier.vz) || 1;
            const ddx = (skier.vx / l) * 0.6 + dx * 0.4, ddz = (skier.vz / l) * 0.6 + dz * 0.4;
            const dl = Math.hypot(ddx, ddz) || 1;
            if (p.tilt < 0.25) { p.dx = ddx / dl; p.dz = ddz / dl; }
            p.vel += 4.5 + 0.28 * sp;
            p.hitCool = 0.25;
          }
        }
        if (p.hitCool > 0) p.hitCool -= dt;
        if (p.tilt !== 0 || p.vel !== 0) {
          const k = 46, c = 3.4;
          p.vel += (-k * p.tilt - c * p.vel) * dt;
          p.tilt += p.vel * dt;
          if (p.tilt < 0) { p.tilt = 0; p.vel = Math.max(p.vel, 0) * 0.4; }
          if (p.tilt > 1.45) { p.tilt = 1.45; p.vel = Math.min(p.vel, 0); }
          if (p.tilt < 0.002 && Math.abs(p.vel) < 0.05) { p.tilt = 0; p.vel = 0; }
          this._poleMatrix(p);
          touched = true;
        }
      }
      if (touched) for (const k of ['red', 'blue']) this.gateInst[k].commit();
    }
  }

  gateResult(index, ok) {
    void index; void ok;
  }
}
