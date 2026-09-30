// The mountain as data: heightfield, piste path, tree / rock colliders.
// Pure JS (no three.js) so the same code drives rendering, physics and Node tests.
import { clamp, assetUrl } from './util.js';

const CELL = 16;   // collision hash cell size (m)

// Footprints of the village buildings in the model's own frame (x along the ridge, z from the back to the front), metres:
// [centre x, centre z, half width, half depth] per box, and the height of the roof line.
const FOOTPRINTS = {
  lodge: { h: 12, boxes: [[0, 0, 17.2, 7.7], [-21.0, 0.5, 4.1, 4.6]] },
  alp_hut: { h: 6, boxes: [[0, 0, 8.2, 4.7]] },
  chapel: { h: 17, boxes: [[0, -1.0, 3.4, 5.7], [0, 5.7, 2.0, 2.0]] },
  chalet_a: { h: 8, boxes: [[0, 0, 5.2, 4.2]] },
  chalet_b: { h: 8.5, boxes: [[0, 0, 6.4, 4.7], [-7.85, -0.5, 1.7, 2.9]] },
  chalet_c: { h: 7.5, boxes: [[0, 0, 4.4, 3.6]] },
};

/**
 * The open world stores its height field as prediction residuals (zigzag coded uint16 of h - (left + above - above-left)), which
 * gzip shrinks four times better than the raw heights. Returns the raw uint16 heights.
 */
export function decodePredictedHeights(res, nx, nz) {
  const out = new Uint16Array(nx * nz);
  for (let y = 0; y < nz; y++) {
    const row = y * nx, up = row - nx;
    for (let x = 0; x < nx; x++) {
      const z = res[row + x];
      const r = (z >>> 1) ^ -(z & 1);
      let pred;
      if (y === 0) pred = x === 0 ? 0 : out[row + x - 1];
      else if (x === 0) pred = out[up];
      else pred = out[row + x - 1] + out[up + x] - out[up + x - 1];
      out[row + x] = pred + r;
    }
  }
  return out;
}

export class WorldData {
  /**
   * @param {object} info world.json  @param {Uint16Array} u16 heights
   * @param {Uint8Array} [groom] groomed-snow weight per height-field cell (open world); the race mountain measures the
   *        distance to its single piste instead
   */
  constructor(info, u16, trees, rocks, poles, groom = null) {
    this.info = info;
    const g = info.grid;
    this.nx = g.nx;
    this.nz = g.nz;
    this.dx = g.dx;
    this.invDx = 1 / g.dx;
    this.x0 = g.x0;
    this.z0 = g.z0;
    this.x1 = g.x0 + (g.nx - 1) * g.dx;
    this.z1 = g.z0 + (g.nz - 1) * g.dx;
    this.sizeX = this.nx * this.dx;      // texture-space extent (cells * dx)
    this.sizeZ = this.nz * this.dx;
    this.heights = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) this.heights[i] = g.hMin + u16[i] / g.hQuant;
    this.trees = trees;    // x z y scale yaw species (6 floats)
    this.rocks = rocks;    // x z y scale yaw type
    this.poles = poles;    // x z y side (open world: x z y piste level)
    this.path = info.path ? new PathSampler(info.path) : null;
    this.pistes = (info.pistes || []).map((p) => ({ ...p, sampler: new PathSampler(p.path) }));
    this.groom = groom;
    this.open = info.kind === 'open';
    this.sunDir = info.sun.dir;
    this.runs = info.runs || [];
    this._buildHash();
    this._buildSolids();
  }

  /** oriented boxes (village buildings) and circles (lift pylons) the skier cannot pass through */
  _buildSolids() {
    const out = this.solids = [];
    for (const b of this.info.buildings || []) {
      const fp = FOOTPRINTS[b.type];
      if (!fp) continue;
      const sc = b.scale || 1, c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      for (const [cx, cz, hx, hz] of fp.boxes) {
        // model frame -> world: rotation about +Y by yaw maps local (x, z) to (x c + z sn, -x sn + z c)
        const wx = b.x + (cx * c + cz * sn) * sc, wz = b.z + (-cx * sn + cz * c) * sc;
        out.push({ x: wx, z: wz, hx: hx * sc + 0.15, hz: hz * sc + 0.15, c, s: sn, r: Math.hypot(hx, hz) * sc + 0.4, y: b.y, h: fp.h * sc });
      }
    }
    for (const lf of this.info.lifts || []) {
      lf.points.forEach(([x, z], i) => {
        if (i === 0 || i === lf.points.length - 1) return;
        out.push({ x, z, hx: 0.42, hz: 0.42, c: 1, s: 0, r: 0.6, y: this.height(x, z), h: 10, round: true });
      });
    }
  }

  /**
   * Calls fn(nx, nz, penetration, top) for every solid touching the disc (x, z, r): (nx, nz) is the unit push-out direction and
   * top the height (above sea level) of the solid.
   */
  querySolids(x, z, r, fn) {
    const S = this.solids;
    if (!S || !S.length) return;
    for (let i = 0; i < S.length; i++) {
      const o = S[i];
      const dx = x - o.x, dz = z - o.z;
      const reach = o.r + r;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (o.round) {
        const d = Math.hypot(dx, dz) || 1e-3;
        if (d < o.hx + r) fn(dx / d, dz / d, o.hx + r - d, o.y + o.h);
        continue;
      }
      // into the box frame
      const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
      const px = Math.max(-o.hx, Math.min(o.hx, lx)), pz = Math.max(-o.hz, Math.min(o.hz, lz));
      let ex = lx - px, ez = lz - pz;
      let d = Math.hypot(ex, ez);
      if (d < 1e-6) {                                   // centre inside the box: leave through the nearest face
        const gx = o.hx - Math.abs(lx), gz = o.hz - Math.abs(lz);
        if (gx < gz) { ex = lx < 0 ? -1 : 1; ez = 0; d = -gx; } else { ex = 0; ez = lz < 0 ? -1 : 1; d = -gz; }
        fn(ex * o.c + ez * o.s, -ex * o.s + ez * o.c, r - d, o.y + o.h);
        continue;
      }
      if (d < r) fn((ex * o.c + ez * o.s) / d, (-ex * o.s + ez * o.c) / d, r - d, o.y + o.h);
    }
  }

  static async load(base = 'assets/world/', onProgress = () => {}) {
    const get = async (name, type) => {
      const r = await fetch(assetUrl(base + name));
      if (!r.ok) throw new Error(`Could not load ${base}${name} (${r.status})`);
      const out = type === 'json' ? await r.json() : await r.arrayBuffer();
      onProgress(name);
      return out;
    };
    const info = await get('world.json', 'json');
    const open = info.kind === 'open';
    const [hb, tb, rb, pb, gb] = await Promise.all([
      get(open ? 'heightmap.pz' : 'heightmap.u16'), get('trees.f32'), get('rocks.f32'), get('poles.f32'), open ? get('groom.u8') : null,
    ]);
    const heights = open ? decodePredictedHeights(new Uint16Array(hb), info.grid.nx, info.grid.nz) : new Uint16Array(hb);
    return new WorldData(info, heights, new Float32Array(tb), new Float32Array(rb), new Float32Array(pb), gb ? new Uint8Array(gb) : null);
  }

  // ------------------------------------------------------------------ groomed snow
  /** 0..1: how much the snow under (x, z) is groomed piste (open world; bilinear on the groom raster) */
  groomAt(x, z) {
    const G = this.groom;
    if (!G) return 0;
    const fx = (x - this.x0) * this.invDx, fz = (z - this.z0) * this.invDx;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= this.nx - 1 || iz >= this.nz - 1) return 0;
    const tx = fx - ix, tz = fz - iz;
    const o = iz * this.nx + ix;
    const a = G[o], b = G[o + 1], c = G[o + this.nx], d = G[o + this.nx + 1];
    return ((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz) / 255;
  }

  // ------------------------------------------------------------------ heights
  /** Catmull-Rom bicubic height with analytic slopes. Returns h, writes out.gx / out.gz (dh/dx, dh/dz). */
  sample(x, z, out) {
    const fx = (x - this.x0) * this.invDx;
    const fz = (z - this.z0) * this.invDx;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const nx = this.nx;
    const nzm = this.nz - 1;
    const nxm = nx - 1;
    const H = this.heights;

    const tx2 = tx * tx, tx3 = tx2 * tx;
    const wx0 = -0.5 * tx3 + tx2 - 0.5 * tx;
    const wx1 = 1.5 * tx3 - 2.5 * tx2 + 1;
    const wx2 = -1.5 * tx3 + 2 * tx2 + 0.5 * tx;
    const wx3 = 0.5 * tx3 - 0.5 * tx2;
    const dx0 = -1.5 * tx2 + 2 * tx - 0.5;
    const dx1 = 4.5 * tx2 - 5 * tx;
    const dx2 = -4.5 * tx2 + 4 * tx + 0.5;
    const dx3 = 1.5 * tx2 - tx;
    const tz2 = tz * tz, tz3 = tz2 * tz;
    const wz0 = -0.5 * tz3 + tz2 - 0.5 * tz;
    const wz1 = 1.5 * tz3 - 2.5 * tz2 + 1;
    const wz2 = -1.5 * tz3 + 2 * tz2 + 0.5 * tz;
    const wz3 = 0.5 * tz3 - 0.5 * tz2;
    const dz0 = -1.5 * tz2 + 2 * tz - 0.5;
    const dz1 = 4.5 * tz2 - 5 * tz;
    const dz2 = -4.5 * tz2 + 4 * tz + 0.5;
    const dz3 = 1.5 * tz2 - tz;

    const i0 = clamp(ix - 1, 0, nxm), i1 = clamp(ix, 0, nxm), i2 = clamp(ix + 1, 0, nxm), i3 = clamp(ix + 2, 0, nxm);
    let h = 0, gx = 0, gz = 0;
    for (let j = 0; j < 4; j++) {
      const row = clamp(iz - 1 + j, 0, nzm) * nx;
      const v0 = H[row + i0], v1 = H[row + i1], v2 = H[row + i2], v3 = H[row + i3];
      const r = wx0 * v0 + wx1 * v1 + wx2 * v2 + wx3 * v3;
      const dr = dx0 * v0 + dx1 * v1 + dx2 * v2 + dx3 * v3;
      const wz = j === 0 ? wz0 : j === 1 ? wz1 : j === 2 ? wz2 : wz3;
      const dz = j === 0 ? dz0 : j === 1 ? dz1 : j === 2 ? dz2 : dz3;
      h += wz * r;
      gx += wz * dr;
      gz += dz * r;
    }
    if (out) {
      out.gx = gx * this.invDx;
      out.gz = gz * this.invDx;
    }
    return h;
  }

  height(x, z) {
    return this.sample(x, z, null);
  }

  /** Height of the rendered terrain triangles (piecewise linear, same diagonal as the terrain grid): use it to lay decals flat on the mesh. */
  heightTri(x, z) {
    const fx = (x - this.x0) * this.invDx;
    const fz = (z - this.z0) * this.invDx;
    const ix = clamp(Math.floor(fx), 0, this.nx - 2);
    const iz = clamp(Math.floor(fz), 0, this.nz - 2);
    const tx = fx - ix, tz = fz - iz;
    const H = this.heights, nx = this.nx;
    const ha = H[iz * nx + ix], hc = H[iz * nx + ix + 1], hb = H[(iz + 1) * nx + ix], hd = H[(iz + 1) * nx + ix + 1];
    return tx + tz <= 1 ? ha + tx * (hc - ha) + tz * (hb - ha) : hd + (1 - tx) * (hb - hd) + (1 - tz) * (hc - hd);
  }

  /** Unit surface normal into out {x,y,z}. Returns height. */
  normal(x, z, out, tmp = _tmp) {
    const h = this.sample(x, z, tmp);
    const gx = tmp.gx, gz = tmp.gz;
    const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    out.x = -gx * inv;
    out.y = inv;
    out.z = -gz * inv;
    return h;
  }

  inside(x, z, margin = 0) {
    return x > this.x0 + margin && x < this.x1 - margin && z > this.z0 + margin && z < this.z1 - margin;
  }

  // ---------------------------------------------------------------- colliders
  _buildHash() {
    const sx = Math.ceil((this.x1 - this.x0) / CELL) + 1;
    const sz = Math.ceil((this.z1 - this.z0) / CELL) + 1;
    this._hash = { sx, sz, trees: new Map(), rocks: new Map() };
    const put = (map, arr, stride, n) => {
      for (let i = 0; i < n; i++) {
        const cx = Math.floor((arr[i * stride] - this.x0) / CELL);
        const cz = Math.floor((arr[i * stride + 1] - this.z0) / CELL);
        const key = cz * sx + cx;
        let list = map.get(key);
        if (!list) map.set(key, (list = []));
        list.push(i);
      }
    };
    put(this._hash.trees, this.trees, 6, this.trees.length / 6);
    put(this._hash.rocks, this.rocks, 6, this.rocks.length / 6);
  }

  /** Radius of the solid part of a tree / rock (metres) */
  static treeRadius(scale, species) {
    return (species === 3 ? 0.22 : 0.32) * scale + 0.12;
  }

  static rockRadius(scale) {
    return 0.72 * scale;
  }

  /**
   * Calls fn(kind, index, x, z, radius, height) for each collider within `r` of (x,z).
   * kind: 0 = tree, 1 = rock.
   */
  queryColliders(x, z, r, fn) {
    const { sx, trees, rocks } = this._hash;
    const c0x = Math.floor((x - r - this.x0) / CELL), c1x = Math.floor((x + r - this.x0) / CELL);
    const c0z = Math.floor((z - r - this.z0) / CELL), c1z = Math.floor((z + r - this.z0) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = cz * sx + cx;
        const tl = trees.get(key);
        if (tl) {
          for (let k = 0; k < tl.length; k++) {
            const i = tl[k];
            const o = i * 6;
            const rad = WorldData.treeRadius(this.trees[o + 3], this.trees[o + 5]);
            const dx = this.trees[o] - x, dz = this.trees[o + 1] - z;
            const rr = r + rad;
            if (dx * dx + dz * dz < rr * rr) fn(0, i, this.trees[o], this.trees[o + 1], rad, 12 * this.trees[o + 3]);
          }
        }
        const rl = rocks.get(key);
        if (rl) {
          for (let k = 0; k < rl.length; k++) {
            const i = rl[k];
            const o = i * 6;
            const rad = WorldData.rockRadius(this.rocks[o + 3]);
            const dx = this.rocks[o] - x, dz = this.rocks[o + 1] - z;
            const rr = r + rad;
            if (dx * dx + dz * dz < rr * rr) fn(1, i, this.rocks[o], this.rocks[o + 1], rad, rad * 1.4);
          }
        }
      }
    }
  }
}

const _tmp = { gx: 0, gz: 0 };

/** The centre line of the piste (x, y, z by distance s) with lateral projection. */
export class PathSampler {
  constructor(p) {
    const cols = p.columns;
    const ix = (n) => cols.indexOf(n);
    const n = p.data.length;
    this.step = p.step;
    this.count = n;
    const col = (name) => {
      const a = new Float32Array(n);
      const c = ix(name);
      for (let i = 0; i < n; i++) a[i] = p.data[i][c];
      return a;
    };
    this.s = col('s');
    this.x = col('x');
    this.y = col('y');
    this.z = col('z');
    this.tx = col('tx');
    this.tz = col('tz');
    this.width = col('width');
    this.bank = col('bank');
    this.curv = col('curv');
    this.pitch = col('pitch');
    this.s0 = this.s[0];
    this.sEnd = this.s[n - 1];
    this.spacing = (this.sEnd - this.s0) / (n - 1);
  }

  /** Fill out with the interpolated path state at distance s. */
  at(s, out = {}) {
    const f = clamp((s - this.s0) / this.spacing, 0, this.count - 1.0001);
    const i = Math.floor(f);
    const t = f - i;
    const l = (a) => a[i] + (a[i + 1] - a[i]) * t;
    out.s = s;
    out.x = l(this.x);
    out.y = l(this.y);
    out.z = l(this.z);
    let tx = l(this.tx), tz = l(this.tz);
    const m = Math.hypot(tx, tz) || 1;
    tx /= m; tz /= m;
    out.tx = tx; out.tz = tz;
    out.rx = -tz;      // right hand normal
    out.rz = tx;
    out.width = l(this.width);
    out.bank = l(this.bank);
    out.curv = l(this.curv);
    out.pitch = l(this.pitch);
    return out;
  }

  /**
   * Project (x, z) onto the path near hintS (or globally when hintS is undefined).
   * out: s, t (signed lateral offset, + = right), dist
   */
  project(x, z, hintS, out = {}) {
    let i0 = 0, i1 = this.count - 2;
    if (hintS !== undefined) {
      const c = Math.round((hintS - this.s0) / this.spacing);
      const w = Math.ceil(120 / this.spacing);
      i0 = clamp(c - w, 0, this.count - 2);
      i1 = clamp(c + w, 0, this.count - 2);
    }
    let best = Infinity, bs = 0, bt = 0;
    for (let i = i0; i <= i1; i++) {
      const ax = this.x[i], az = this.z[i];
      const bx = this.x[i + 1], bz = this.z[i + 1];
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez;
      let u = ((x - ax) * ex + (z - az) * ez) / len2;
      u = clamp(u, 0, 1);
      const px = ax + ex * u, pz = az + ez * u;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        bs = this.s[i] + (this.s[i + 1] - this.s[i]) * u;
        const len = Math.sqrt(len2);
        bt = ((x - px) * -ez + (z - pz) * ex) / len;   // right normal = (-tz, tx)
      }
    }
    out.s = bs;
    out.t = bt;
    out.dist = Math.sqrt(best);
    return out;
  }
}
