// A closed (or open) centripetal Catmull-Rom path resampled at even arc-length
// steps. Used for the rally route: carving the road, placing checkpoints and
// tracking the player's progress. Pure JS (no three.js) so tools can use it.

export class Route {
  // points: [{ x, z, ...numeric attributes }]. Attributes are blended smoothly
  // between control points and can be read back with attr(name, s).
  constructor(points, { closed = true, step = 0.5, attrs = [] } = {}) {
    this.closed = closed;
    this.step = step;
    this.attrNames = attrs;
    const P = points;
    const n = P.length;
    const get = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);

    // Fine sampling of each segment.
    const fx = [], fz = [], fa = attrs.map(() => []), fseg = [];
    const segs = closed ? n : n - 1;
    const SUB = 64;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const t0 = 0;
      const t1 = t0 + Math.pow(Math.hypot(p1.x - p0.x, p1.z - p0.z), 0.5) || 1e-3;
      const t2 = t1 + (Math.pow(Math.hypot(p2.x - p1.x, p2.z - p1.z), 0.5) || 1e-3);
      const t3 = t2 + (Math.pow(Math.hypot(p3.x - p2.x, p3.z - p2.z), 0.5) || 1e-3);
      for (let k = 0; k < SUB; k++) {
        const u = k / SUB;
        const t = t1 + (t2 - t1) * u;
        const c = (a, b, ta, tb) => (tb - t) / (tb - ta) * a + (t - ta) / (tb - ta) * b;
        const ax1 = c(p0.x, p1.x, t0, t1), az1 = c(p0.z, p1.z, t0, t1);
        const ax2 = c(p1.x, p2.x, t1, t2), az2 = c(p1.z, p2.z, t1, t2);
        const ax3 = c(p2.x, p3.x, t2, t3), az3 = c(p2.z, p3.z, t2, t3);
        const bx1 = c(ax1, ax2, t0, t2), bz1 = c(az1, az2, t0, t2);
        const bx2 = c(ax2, ax3, t1, t3), bz2 = c(az2, az3, t1, t3);
        fx.push(c(bx1, bx2, t1, t2));
        fz.push(c(bz1, bz2, t1, t2));
        const w = u * u * (3 - 2 * u);
        attrs.forEach((name, ai) => {
          const a = p1[name] ?? 0, b = p2[name] ?? 0;
          fa[ai].push(a + (b - a) * w);
        });
        fseg.push(i + u);
      }
    }
    if (!closed) {
      const last = P[n - 1];
      fx.push(last.x); fz.push(last.z);
      attrs.forEach((name, ai) => fa[ai].push(last[name] ?? 0));
      fseg.push(n - 1);
    } else {
      fx.push(fx[0]); fz.push(fz[0]);
      attrs.forEach((_, ai) => fa[ai].push(fa[ai][0]));
      fseg.push(n);
    }

    // Cumulative length of the fine polyline.
    const cum = new Float64Array(fx.length);
    for (let i = 1; i < fx.length; i++) cum[i] = cum[i - 1] + Math.hypot(fx[i] - fx[i - 1], fz[i] - fz[i - 1]);
    this.length = cum[cum.length - 1];

    // Resample at even steps.
    const count = Math.max(2, Math.round(this.length / step));
    this.step = this.length / count;
    this.count = closed ? count : count + 1;
    this.xs = new Float64Array(this.count);
    this.zs = new Float64Array(this.count);
    this.seg = new Float64Array(this.count);
    this.attr = {};
    attrs.forEach((name) => { this.attr[name] = new Float64Array(this.count); });
    let j = 0;
    for (let i = 0; i < this.count; i++) {
      const s = i * this.step;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      this.xs[i] = fx[j] + (fx[j + 1] - fx[j]) * f;
      this.zs[i] = fz[j] + (fz[j + 1] - fz[j]) * f;
      this.seg[i] = fseg[j] + (fseg[j + 1] - fseg[j]) * f;
      attrs.forEach((name, ai) => { this.attr[name][i] = fa[ai][j] + (fa[ai][j + 1] - fa[ai][j]) * f; });
    }

    // Unit tangents (central differences).
    this.tx = new Float64Array(this.count);
    this.tz = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const a = this._wrap(i - 1), b = this._wrap(i + 1);
      const dx = this.xs[b] - this.xs[a], dz = this.zs[b] - this.zs[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
  }

  _wrap(i) {
    if (this.closed) return ((i % this.count) + this.count) % this.count;
    return Math.max(0, Math.min(this.count - 1, i));
  }

  wrapS(s) {
    if (!this.closed) return Math.max(0, Math.min(this.length, s));
    return ((s % this.length) + this.length) % this.length;
  }

  // Linear interpolation of a per-sample array at arc length s.
  sample(arr, s) {
    const f = this.wrapS(s) / this.step;
    const i = Math.floor(f);
    const t = f - i;
    const a = arr[this._wrap(i)], b = arr[this._wrap(i + 1)];
    return a + (b - a) * t;
  }

  pos(s, out = {}) {
    out.x = this.sample(this.xs, s);
    out.z = this.sample(this.zs, s);
    return out;
  }

  tangent(s, out = {}) {
    const x = this.sample(this.tx, s), z = this.sample(this.tz, s);
    const l = Math.hypot(x, z) || 1;
    out.x = x / l;
    out.z = z / l;
    return out;
  }

  attrAt(name, s) {
    return this.sample(this.attr[name], s);
  }

  // Arc length at which a control point sits (by index).
  sAtControl(index) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = Math.abs(this.seg[i] - index);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best * this.step;
  }

  // Closest point on the route. If `hintS` is given only a window around it is searched.
  nearest(x, z, hintS = null, window = 80) {
    let i0 = 0, i1 = this.count - 1;
    if (hintS !== null) {
      const c = Math.round(this.wrapS(hintS) / this.step);
      const w = Math.ceil(window / this.step);
      i0 = c - w;
      i1 = c + w;
    }
    let best = 0, bestD = Infinity;
    for (let k = i0; k <= i1; k++) {
      const i = this._wrap(k);
      const dx = x - this.xs[i], dz = z - this.zs[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    // Refine on the two neighbouring segments.
    let bs = best * this.step, bd = Math.sqrt(bestD);
    for (const nb of [best - 1, best]) {
      const a = this._wrap(nb), b = this._wrap(nb + 1);
      const ax = this.xs[a], az = this.zs[a];
      const vx = this.xs[b] - ax, vz = this.zs[b] - az;
      const l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
      if (d < bd) { bd = d; bs = (nb + t) * this.step; }
    }
    const s = this.wrapS(bs);
    const t = this.tangent(s);
    const p = this.pos(s);
    const side = Math.sign((x - p.x) * t.z - (z - p.z) * t.x) || 1;
    return { s, d: bd, side };
  }
}
