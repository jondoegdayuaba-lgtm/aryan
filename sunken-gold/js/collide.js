// Collision against solid models using the distance fields baked in Blender.
// Each placed model keeps its world matrix; a query transforms the diver into
// the model's local space, samples the distance to its surface and pushes the
// diver back out along the field's gradient.
import * as THREE from 'three';

const CELL = 24;   // broadphase grid size in metres

export class Colliders {
  constructor(index, data) {
    this.index = index;     // name -> { min, dims, cell, offset }
    this.data = data;       // Uint8Array of centimetres
    this.items = [];
    this.grid = new Map();
    this._l = new THREE.Vector3();
    this._g = new THREE.Vector3();
  }

  add(name, object) {
    const f = this.index[name];
    if (!f) return;
    object.updateWorldMatrix(true, false);
    const m = object.matrixWorld.clone();
    const scale = new THREE.Vector3().setFromMatrixScale(m).x;
    const rot = new THREE.Matrix3().setFromMatrix4(m).multiplyScalar(1 / scale);
    const item = { f, inv: m.clone().invert(), rot, scale, center: new THREE.Vector3(), radius: 0 };
    // Bounding sphere of the field box in world space for the broadphase.
    const min = new THREE.Vector3(...f.min);
    const max = min.clone().add(new THREE.Vector3(...f.dims).subScalar(1).multiplyScalar(f.cell));
    item.center.copy(min).add(max).multiplyScalar(0.5).applyMatrix4(m);
    item.radius = min.distanceTo(max) * 0.5 * scale;
    this.items.push(item);
    const r = Math.ceil(item.radius / CELL);
    const cx = Math.floor(item.center.x / CELL), cz = Math.floor(item.center.z / CELL);
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const k = `${cx + a},${cz + b}`;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(item);
      }
    }
  }

  sample(f, x, y, z) {
    const gx = (x - f.min[0]) / f.cell, gy = (y - f.min[1]) / f.cell, gz = (z - f.min[2]) / f.cell;
    const [nx, ny, nz] = f.dims;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1.001 || gy > ny - 1.001 || gz > nz - 1.001) return 2.55;
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    const u = gx - ix, v = gy - iy, w = gz - iz;
    const d = this.data, o = f.offset;
    const at = (a, b, c) => d[o + ((iz + c) * ny + (iy + b)) * nx + ix + a];
    const c00 = at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u;
    const c10 = at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u;
    const c01 = at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u;
    const c11 = at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u;
    return ((c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w) / 100;
  }

  // Push position p (Vector3, modified in place) out of any solid closer than r.
  // Returns the summed push normal (zero when nothing touched).
  resolve(p, r, outNormal) {
    outNormal.set(0, 0, 0);
    const list = this.grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`);
    if (!list) return outNormal;
    for (const it of list) {
      if (p.distanceToSquared(it.center) > (it.radius + r) ** 2) continue;
      const l = this._l.copy(p).applyMatrix4(it.inv);
      const f = it.f;
      const rl = r / it.scale;
      const d = this.sample(f, l.x, l.y, l.z);
      if (d >= rl) continue;
      const e = f.cell * 0.75;
      const g = this._g.set(
        this.sample(f, l.x + e, l.y, l.z) - this.sample(f, l.x - e, l.y, l.z),
        this.sample(f, l.x, l.y + e, l.z) - this.sample(f, l.x, l.y - e, l.z),
        this.sample(f, l.x, l.y, l.z + e) - this.sample(f, l.x, l.y, l.z - e));
      if (g.lengthSq() < 1e-8) g.set(0, 1, 0);
      g.normalize().applyMatrix3(it.rot).normalize();
      p.addScaledVector(g, (rl - d) * it.scale);
      outNormal.add(g);
    }
    return outNormal;
  }

  // Distance to the nearest solid (used to keep fish and sharks out of rocks).
  distance(p, maxR = 3) {
    const list = this.grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`);
    let best = maxR;
    if (!list) return best;
    for (const it of list) {
      if (p.distanceToSquared(it.center) > (it.radius + maxR) ** 2) continue;
      const l = this._l.copy(p).applyMatrix4(it.inv);
      best = Math.min(best, this.sample(it.f, l.x, l.y, l.z) * it.scale);
    }
    return best;
  }
}
