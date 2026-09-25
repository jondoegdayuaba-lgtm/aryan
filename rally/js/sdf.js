// Signed distance modelling: car bodies are written as smooth combinations of
// shapes and turned into meshes with surface nets. Distances are in metres.
import * as THREE from 'three';

export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a, b, k) => -smin(-a, -b, k);

export function roundBox(px, py, pz, bx, by, bz, r) {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r, qz = Math.abs(pz) - bz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export function ellipsoid(px, py, pz, rx, ry, rz) {
  const k0 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
  const k1 = Math.sqrt((px / (rx * rx)) ** 2 + (py / (ry * ry)) ** 2 + (pz / (rz * rz)) ** 2);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}

// Cylinder along x, centred at the origin: radius r, half length h.
export function cylX(px, py, pz, r, h) {
  const dx = Math.sqrt(py * py + pz * pz) - r, dy = Math.abs(px) - h;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

// Exact distance to a closed 2D polygon given as a flat array [x0, y0, x1, y1, ...].
export function polygon(px, py, v) {
  const n = v.length / 2;
  let d = (px - v[0]) ** 2 + (py - v[1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vix = v[2 * i], viy = v[2 * i + 1], vjx = v[2 * j], vjy = v[2 * j + 1];
    const ex = vjx - vix, ey = vjy - viy;
    const wx = px - vix, wy = py - viy;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= viy, c2 = py < vjy, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Surface nets over a box. `sdf(x, y, z)` gives signed distance; the model is
// assumed mirror-symmetric in x when `mirror` is set (only x >= 0 is sampled).
export function surfaceNets(sdf, min, max, cell, { mirror = true, relax = 1 } = {}) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  const X = (i) => min[0] + i * cell, Y = (j) => min[1] + j * cell, Z = (k) => min[2] + k * cell;
  const at = (i, j, k) => (k * ny + j) * nx + i;
  const mirrorCol = new Int32Array(nx).fill(-1);
  if (mirror) {
    for (let i = 0; i < nx; i++) {
      const x = X(i);
      if (x < -cell * 0.01) {
        const m = Math.round((-x - min[0]) / cell);
        if (m >= 0 && m < nx && Math.abs(X(m) + x) < cell * 0.01) mirrorCol[i] = m;
      }
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (mirrorCol[i] >= 0) continue;
        field[at(i, j, k)] = sdf(X(i), Y(j), Z(k));
      }
      for (let i = 0; i < nx; i++) if (mirrorCol[i] >= 0) field[at(i, j, k)] = field[at(mirrorCol[i], j, k)];
    }
  }

  // one vertex per cell that straddles the surface
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float32Array(8);
  const off = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[at(i + off[c][0], j + off[c][1], k + off[c][2])];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of E) {
          const va = corner[a], vb = corner[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += off[a][0] + (off[b][0] - off[a][0]) * t;
          sy += off[a][1] + (off[b][1] - off[a][1]) * t;
          sz += off[a][2] + (off[b][2] - off[a][2]) * t;
          cnt++;
        }
        cellVert[at(i, j, k)] = pos.length / 3;
        pos.push(X(i) + (sx / cnt) * cell, Y(j) + (sy / cnt) * cell, Z(k) + (sz / cnt) * cell);
      }
    }
  }

  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = field[at(i, j, k)] < 0;
        // edge along x from (i,j,k)
        if ((field[at(i + 1, j, k)] < 0) !== v0) {
          quad(cellVert[at(i, j - 1, k - 1)], cellVert[at(i, j, k - 1)], cellVert[at(i, j, k)], cellVert[at(i, j - 1, k)], !v0);
        }
        if ((field[at(i, j + 1, k)] < 0) !== v0) {
          quad(cellVert[at(i - 1, j, k - 1)], cellVert[at(i - 1, j, k)], cellVert[at(i, j, k)], cellVert[at(i, j, k - 1)], !v0);
        }
        if ((field[at(i, j, k + 1)] < 0) !== v0) {
          quad(cellVert[at(i - 1, j - 1, k)], cellVert[at(i, j - 1, k)], cellVert[at(i, j, k)], cellVert[at(i - 1, j, k)], !v0);
        }
      }
    }
  }

  // Snap vertices onto the true surface and take normals from the gradient.
  const nrm = new Float32Array(pos.length);
  const e = cell * 0.3;
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    for (let it = 0; it <= relax; it++) {
      const d = sdf(x, y, z);
      const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
      const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
      const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      if (it < relax) {
        const step = Math.max(-cell, Math.min(cell, d));
        x -= (gx / gl) * step; y -= (gy / gl) * step; z -= (gz / gl) * step;
      } else {
        nrm[v] = gx / gl; nrm[v + 1] = gy / gl; nrm[v + 2] = gz / gl;
      }
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
