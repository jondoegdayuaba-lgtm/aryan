// The mountain as data: heightfield, piste path, tree / rock colliders.
// Pure JS (no three.js) so the same code drives rendering, physics and Node tests.
import { clamp } from './util.js';

const CELL = 16;   // collision hash cell size (m)

export class WorldData {
  /** @param {object} info world.json  @param {Uint16Array} u16 heights  */
  constructor(info, u16, trees, rocks, poles) {
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
    this.poles = poles;    // x z y side
    this.path = new PathSampler(info.path);
    this.sunDir = info.sun.dir;
    this.runs = info.runs;
    this._buildHash();
  }

  static async load(base = 'assets/world/', onProgress = () => {}) {
    const get = async (name, type) => {
      const r = await fetch(base + name);
      if (!r.ok) throw new Error(`Could not load ${base}${name} (${r.status})`);
      const out = type === 'json' ? await r.json() : await r.arrayBuffer();
      onProgress(name);
      return out;
    };
    const [info, hb, tb, rb, pb] = await Promise.all([
      get('world.json', 'json'), get('heightmap.u16'), get('trees.f32'), get('rocks.f32'), get('poles.f32'),
    ]);
    return new WorldData(info, new Uint16Array(hb), new Float32Array(tb), new Float32Array(rb), new Float32Array(pb));
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
    return 0.62 * scale;
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
