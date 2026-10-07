// Loops: the road leaves the ground, goes all the way round (upside down over
// the top) and comes back down a little further on and off to one side, so
// the way up and the way down don't run into each other.
//
// A loop starts at a track point marked `loop` (its radius) and ends at the
// next point. Its shape in the loop's own frame (F forward, U up, Rt right):
//   forward  a·θ + R·sin θ      up  R·(1 − cos θ)      across  D·smoothstep(θ / 2π)
// for θ from 0 to 2π, where the exit is Δ = 2π·a ahead and D to the side.
// No rendering here, so the physics and the track checker can use it.

export const TAU = Math.PI * 2;

export class Loop {
  // E: entry point {x, y, z}; F: road direction there {x, z}; X: exit point.
  constructor({ E, F, X, R, hw, s0, s1 }) {
    this.E = E;
    this.F = { x: F.x, z: F.z };
    this.Rt = { x: -F.z, z: F.x };
    const dx = X.x - E.x, dz = X.z - E.z;
    this.fwd = dx * F.x + dz * F.z;                 // Δ
    this.side = dx * this.Rt.x + dz * this.Rt.z;    // D
    this.R = R;
    this.a = this.fwd / TAU;
    this.hw = hw;
    this.s0 = s0;
    this.s1 = s1;
    this.X = { x: X.x, y: E.y, z: X.z };
  }

  // Point, unit tangent T, normal N (from the road surface toward the loop's
  // middle: the car's up) and right B at angle th. Also |dP/dθ| as `rate`.
  frame(th, out) {
    const { a, R, side: D, F, Rt, E } = this;
    const u = th / TAU, sm = u * u * (3 - 2 * u), dsm = (6 * u * (1 - u)) / TAU;
    const f = a * th + R * Math.sin(th), h = R * (1 - Math.cos(th)), l = D * sm;
    const df = a + R * Math.cos(th), dh = R * Math.sin(th), dl = D * dsm;
    out.x = E.x + F.x * f + Rt.x * l;
    out.y = E.y + h;
    out.z = E.z + F.z * f + Rt.z * l;
    // Tangent.
    let tx = F.x * df + Rt.x * dl, ty = dh, tz = F.z * df + Rt.z * dl;
    const rate = Math.hypot(tx, ty, tz) || 1;
    tx /= rate; ty /= rate; tz /= rate;
    // Inward normal: the planar loop's normal, squared up to the tangent.
    const p = Math.hypot(df, dh) || 1;
    const nf = -dh / p, nh = df / p;
    let nx = F.x * nf, ny = nh, nz = F.z * nf;
    const d = nx * tx + ny * ty + nz * tz;
    nx -= tx * d; ny -= ty * d; nz -= tz * d;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    out.tx = tx; out.ty = ty; out.tz = tz;
    out.nx = nx; out.ny = ny; out.nz = nz;
    // Right = tangent x normal.
    out.bx = ty * nz - tz * ny; out.by = tz * nx - tx * nz; out.bz = tx * ny - ty * nx;
    out.rate = rate;
    return out;
  }

  // How hard the loop pushes on a car going at speed v at angle th, per unit
  // mass: below zero the car is falling off.
  grip(th, v, gravity) {
    const e = 0.01, A = this.frame(th - e, {}), B = this.frame(th + e, {}), M = this.frame(th, {});
    const k = 1 / (2 * e * M.rate);
    const kn = ((B.tx - A.tx) * M.nx + (B.ty - A.ty) * M.ny + (B.tz - A.tz) * M.nz) * k;   // curvature toward the normal
    return v * v * kn + gravity * M.ny;
  }

  // Checks for the track checker: does it go upside down, and do the way up
  // and the way down miss each other?
  check(width) {
    const issues = [];
    if (this.a > this.R * 0.75) issues.push(`loop at s=${this.s0.toFixed(0)} is too stretched to go upside down (exit ${this.fwd.toFixed(0)} m ahead, radius ${this.R})`);
    // Where the two legs pass the same spot (same height, same forward
    // distance), how far apart are they sideways?
    let best = Infinity;
    const P = {}, Q = {};
    for (let th = 0.05; th < Math.PI - 0.6; th += 0.01) {      // (at the very top both legs are one point)
      this.frame(th, P);
      this.frame(TAU - th, Q);
      const df = (P.x - Q.x) * this.F.x + (P.z - Q.z) * this.F.z;
      if (Math.abs(df) < 0.6) best = Math.min(best, Math.abs((P.x - Q.x) * this.Rt.x + (P.z - Q.z) * this.Rt.z));
    }
    if (best < width) issues.push(`loop at s=${this.s0.toFixed(0)}: the way up and the way down overlap (${best.toFixed(1)} m apart, need ${width.toFixed(1)}); move the exit further to the side`);
    return issues;
  }
}
