// The stage road: a closed spline through hand-placed control points,
// resampled every metre, plus helpers to find where a car is along it.

// Expands hairpin entries (['hp', x, z, side, radius, degrees]) into points
// along a circular arc that starts at (x, z) heading away from the previous point.
export function expandRoute(route) {
  const out = [];
  for (const p of route) {
    if (p[0] !== 'hp') { out.push(p); continue; }
    const [, x, z, side, r, deg] = p;
    const prev = out[out.length - 1];
    let fx = x - prev[0], fz = z - prev[1];
    const l = Math.hypot(fx, fz);
    fx /= l; fz /= l;
    // With y up, the driver's left is (fz, -fx) and right is (-fz, fx).
    const right = side === 'R';
    const cx = x + (right ? -fz : fz) * r, cz = z + (right ? fx : -fx) * r;
    const a0 = Math.atan2(z - cz, x - cx);
    const dir = right ? 1 : -1;
    const n = Math.max(2, Math.ceil(deg / 30));
    out.push([x, z]);
    for (let k = 1; k <= n; k++) {
      const a = a0 + dir * (deg * Math.PI / 180) * (k / n);
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return out;
}

// Centripetal Catmull-Rom through a closed loop of [x, z] points, sampled
// densely, then resampled to exactly `step` metres apart.
export function buildLoop(points, step = 1) {
  const n = points.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const t01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) || 1e-4;
    const t12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) || 1e-4;
    const t23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) || 1e-4;
    const segs = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.25) + 1;
    for (let s = 0; s < segs; s++) {
      const u = s / segs;
      const out = [0, 0];
      for (let k = 0; k < 2; k++) {
        // Barry-Goldman pyramidal formulation
        const P0 = p0[k], P1 = p1[k], P2 = p2[k], P3 = p3[k];
        const T0 = 0, T1 = t01, T2 = t01 + t12, T3 = t01 + t12 + t23;
        const t = T1 + u * (T2 - T1);
        const A1 = ((T1 - t) * P0 + (t - T0) * P1) / (T1 - T0);
        const A2 = ((T2 - t) * P1 + (t - T1) * P2) / (T2 - T1);
        const A3 = ((T3 - t) * P2 + (t - T2) * P3) / (T3 - T2);
        const B1 = ((T2 - t) * A1 + (t - T0) * A2) / (T2 - T0);
        const B2 = ((T3 - t) * A2 + (t - T1) * A3) / (T3 - T1);
        out[k] = ((T2 - t) * B1 + (t - T1) * B2) / (T2 - T1);
      }
      dense.push(out);
    }
  }
  // Arc-length resample.
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const count = Math.round(total / step);
  const ds = total / count;
  const x = new Float32Array(count), z = new Float32Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    x[i] = a[0] + (b[0] - a[0]) * t;
    z[i] = a[1] + (b[1] - a[1]) * t;
  }
  return { x, z, count, length: total, ds };
}

// Unit tangent and signed curvature (1/m, positive = turning left, i.e. toward +x
// when heading +z) for every sample of a closed loop.
export function tangentsAndCurvature(road, smoothing = 6) {
  const { x, z, count, ds } = road;
  const tx = new Float32Array(count), tz = new Float32Array(count), k = new Float32Array(count);
  const w = Math.max(1, Math.round(smoothing / ds));
  for (let i = 0; i < count; i++) {
    const a = (i - w + count) % count, b = (i + w) % count;
    const dx = x[b] - x[a], dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  for (let i = 0; i < count; i++) {
    const a = (i - w + count) % count, b = (i + w) % count;
    // heading change over 2w samples; heading = atan2(tx, tz)
    let d = Math.atan2(tx[b], tz[b]) - Math.atan2(tx[a], tz[a]);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    k[i] = d / (2 * w * ds);
  }
  return { tx, tz, k };
}

export const wrap = (i, n) => ((i % n) + n) % n;

// Nearest point on the road to (x, z). Searches ±`window` samples around
// `hint`, or the whole loop when hint < 0. Returns the sample index, the
// fractional position `s`, the signed lateral offset (+ = left of travel)
// and the distance from the centreline.
export function locate(road, x, z, hint = -1, window = 60) {
  const n = road.count;
  let best = 0, bestD = Infinity;
  const test = (i) => {
    const dx = road.x[i] - x, dz = road.z[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  };
  if (hint < 0) {
    for (let i = 0; i < n; i += 4) test(i);
    for (let k = -4; k <= 4; k++) test(wrap(best + k, n));
  } else {
    for (let k = -window; k <= window; k++) test(wrap(hint + k, n));
  }
  // project onto the segment toward whichever neighbour is closer
  const a = best, b = wrap(best + 1, n), c = wrap(best - 1, n);
  let i0 = a, i1 = b;
  const db = (road.x[b] - x) ** 2 + (road.z[b] - z) ** 2, dc = (road.x[c] - x) ** 2 + (road.z[c] - z) ** 2;
  if (dc < db) { i0 = c; i1 = a; }
  const ex = road.x[i1] - road.x[i0], ez = road.z[i1] - road.z[i0];
  const el = ex * ex + ez * ez || 1;
  const t = Math.min(1, Math.max(0, ((x - road.x[i0]) * ex + (z - road.z[i0]) * ez) / el));
  const px = road.x[i0] + ex * t, pz = road.z[i0] + ez * t;
  const ox = x - px, oz = z - pz;
  const lateral = ex * oz - ez * ox < 0 ? Math.hypot(ox, oz) : -Math.hypot(ox, oz);
  return { i: best, s: i0 + t, lateral, dist: Math.hypot(ox, oz) };
}
