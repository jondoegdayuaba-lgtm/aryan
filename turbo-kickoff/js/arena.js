// The arena's shape as maths, for collisions. It matches arena.glb exactly:
// a rounded-rectangle footprint, a ramp from the floor into the walls, a curve
// from the walls into the ceiling, and a box-shaped goal behind each end wall.
// Axes are three.js: X across, Y up, Z along the pitch. Blue's goal is at +Z.

export class ArenaShape {
  constructor(layout) {
    const a = layout.arena;
    const g = layout.goal;
    this.HX = a.half_width;
    this.HZ = a.half_length;
    this.H = a.height;
    this.RC = a.corner_radius;
    this.R1 = a.floor_curve_radius;
    this.R2 = a.ceiling_curve_radius;
    this.GW = g.half_width;
    this.GH = g.height;
    this.GD = g.depth;
    this.ax = this.HX - this.RC;
    this.az = this.HZ - this.RC;
  }

  // Distance from p to the nearest arena surface (positive = inside the playing
  // space). The normal pointing into the playing space is written to `n`.
  distance(p, n) {
    const x = p.x, y = p.y, z = p.z;
    const { RC, R1, R2, H, ax, az } = this;

    // Horizontal distance in from the wall line, and the inward horizontal normal
    const qx = Math.abs(x) - ax, qz = Math.abs(z) - az;
    const sx = x < 0 ? -1 : 1, sz = z < 0 ? -1 : 1;
    let dh, hx, hz;
    if (qx > 0 && qz > 0) {
      const l = Math.hypot(qx, qz);
      dh = RC - l; hx = -sx * qx / l; hz = -sz * qz / l;
    } else if (qx > qz) {
      dh = RC - qx; hx = -sx; hz = 0;
    } else {
      dh = RC - qz; hx = 0; hz = -sz;
    }

    // The side profile: floor, ramp, wall, curve, ceiling
    let dm, nd, ny;
    if (dh < R1 && y < R1) {
      const cd = R1 - dh, cy = R1 - y, l = Math.hypot(cd, cy) || 1e-6;
      dm = R1 - l; nd = cd / l; ny = cy / l;
    } else if (dh < R2 && y > H - R2) {
      const cd = R2 - dh, cy = H - R2 - y, l = Math.hypot(cd, cy) || 1e-6;
      dm = R2 - l; nd = cd / l; ny = cy / l;
    } else {
      dm = y; nd = 0; ny = 1;
      if (H - y < dm) { dm = H - y; ny = -1; }
      if (dh < dm) { dm = dh; nd = 1; ny = 0; }
    }

    // The goal box (its open front reaches back over the ramp into the mouth)
    const { GW, GH, GD, HZ } = this;
    const azz = Math.abs(z);
    let dg = GW - Math.abs(x), gx = -sx, gy = 0, gz = 0;
    if (y < dg) { dg = y; gx = 0; gy = 1; gz = 0; }
    if (GH - y < dg) { dg = GH - y; gx = 0; gy = -1; gz = 0; }
    if (HZ + GD - azz < dg) { dg = HZ + GD - azz; gx = 0; gy = 0; gz = -sz; }
    if (azz - (HZ - R1) < dg) { dg = azz - (HZ - R1); gx = 0; gy = 0; gz = sz; }

    if (dg > dm) {
      n.set(gx, gy, gz);
      return dg;
    }
    n.set(hx * nd, ny, hz * nd);
    return dm;
  }

  // Which goal the ball is completely inside, if any: 'blue' (at +Z) or 'orange'.
  goalFor(p, r) {
    if (Math.abs(p.x) > this.GW || p.y > this.GH) return null;
    if (p.z > this.HZ + r) return 'blue';
    if (p.z < -this.HZ - r) return 'orange';
    return null;
  }
}
