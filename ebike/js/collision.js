// 2D (x,z) collision helpers. Everything is a circle, an axis-aligned rect or a segment.

/**
 * Push a circle out of a rect. Returns null or { nx, nz, depth } (normal points out of the rect).
 */
export function circleRect(x, z, r, rc) {
  const cx = Math.max(rc.minX, Math.min(x, rc.maxX));
  const cz = Math.max(rc.minZ, Math.min(z, rc.maxZ));
  let dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // centre inside the rect: leave by the nearest face
  const l = x - rc.minX, rr = rc.maxX - x, t = z - rc.minZ, b = rc.maxZ - z;
  const m = Math.min(l, rr, t, b);
  if (m === l) return { nx: -1, nz: 0, depth: l + r };
  if (m === rr) return { nx: 1, nz: 0, depth: rr + r };
  if (m === t) return { nx: 0, nz: -1, depth: t + r };
  return { nx: 0, nz: 1, depth: b + r };
}

/** Circle vs circle. Normal points from b to a. */
export function circleCircle(ax, az, ar, bx, bz, br) {
  const dx = ax - bx, dz = az - bz;
  const rr = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-4;
  return { nx: dx / d, nz: dz / d, depth: rr - d };
}

/** Does the segment a->b cross the rect? (slab test) */
export function segmentRect(ax, az, bx, bz, rc) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q, lo, hi] of [[ax, dx, rc.minX, rc.maxX], [az, dz, rc.minZ, rc.maxZ]]) {
    if (Math.abs(q) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let ta = (lo - p) / q, tb = (hi - p) / q;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent smoothing factor. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
