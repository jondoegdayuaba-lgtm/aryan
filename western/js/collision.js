// Static collision: rotated boxes (buildings, props), vertical cylinders
// (trunks, rocks) and walkable platforms (porches, the bridge), bucketed in
// a grid. Characters are circles pushed out of whatever they overlap.
import * as THREE from 'three';

export class Collision {
  constructor(terrain) {
    this.terrain = terrain;
    this.cell = 16;
    this.grid = new Map();
    this.stamp = 0;
    this._out = [];
  }

  key(i, j) {
    return i * 4096 + j;
  }

  insert(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this.key(i, j);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(item);
      }
    }
    item.stamp = 0;
  }

  addBox(cx, cz, hx, hz, yaw, y0, y1, tag) {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const item = { type: 'box', cx, cz, hx, hz, cos, sin, y0, y1, tag };
    const r = Math.hypot(hx, hz);
    this.insert(item, cx - r, cz - r, cx + r, cz + r);
    return item;
  }

  addCircle(x, z, r, y0, y1, tag) {
    const item = { type: 'circle', x, z, r, y0, y1, tag };
    this.insert(item, x - r, z - r, x + r, z + r);
    return item;
  }

  addPlatform(cx, cz, hx, hz, yaw, top) {
    const item = { type: 'platform', cx, cz, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), top };
    const r = Math.hypot(hx, hz);
    this.insert(item, cx - r, cz - r, cx + r, cz + r);
    return item;
  }

  // Add a model's colliders (model-local boxes from world.json) at a placement.
  addPlaced(model, place, tag) {
    if (!model) return;
    const cos = Math.cos(place.yaw);
    const sin = Math.sin(place.yaw);
    for (const [x0, z0, x1, z1, h] of model.colliders) {
      const lx = (x0 + x1) / 2;
      const lz = (z0 + z1) / 2;
      this.addBox(place.x + lx * cos + lz * sin, place.z - lx * sin + lz * cos, (x1 - x0) / 2, (z1 - z0) / 2,
        place.yaw, place.y - 1, place.y + h, tag);
    }
    for (const [x0, z0, x1, z1, h] of model.platforms) {
      const lx = (x0 + x1) / 2;
      const lz = (z0 + z1) / 2;
      this.addPlatform(place.x + lx * cos + lz * sin, place.z - lx * sin + lz * cos, (x1 - x0) / 2, (z1 - z0) / 2,
        place.yaw, place.y + h);
    }
  }

  query(x0, z0, x1, z1) {
    const c = this.cell;
    const out = this._out;
    out.length = 0;
    const s = ++this.stamp;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const list = this.grid.get(this.key(i, j));
        if (!list) continue;
        for (const it of list) {
          if (it.stamp === s) continue;
          it.stamp = s;
          out.push(it);
        }
      }
    }
    return out;
  }

  // Push a circle (pos.x, pos.z, r) standing at pos.y with `height` out of solids.
  resolve(pos, r, height = 1.8) {
    const items = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    let hit = false;
    for (const it of items) {
      if (it.type === 'platform') continue;
      if (pos.y + height < it.y0 || pos.y > it.y1 - 0.45) continue;
      if (it.type === 'circle') {
        const dx = pos.x - it.x;
        const dz = pos.z - it.z;
        const d = Math.hypot(dx, dz);
        const m = r + it.r;
        if (d < m && d > 1e-6) {
          pos.x = it.x + (dx / d) * m;
          pos.z = it.z + (dz / d) * m;
          hit = true;
        }
      } else {
        const dx = pos.x - it.cx;
        const dz = pos.z - it.cz;
        const lx = dx * it.cos - dz * it.sin;
        const lz = dx * it.sin + dz * it.cos;
        const qx = Math.max(-it.hx, Math.min(it.hx, lx));
        const qz = Math.max(-it.hz, Math.min(it.hz, lz));
        let ox = lx - qx;
        let oz = lz - qz;
        let d = Math.hypot(ox, oz);
        if (d >= r) continue;
        let nx;
        let nz;
        if (d < 1e-6) {
          // Centre inside the box: leave by the nearest face
          const px = it.hx - Math.abs(lx);
          const pz = it.hz - Math.abs(lz);
          if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; d = -px; } else { nx = 0; nz = Math.sign(lz) || 1; d = -pz; }
        } else {
          nx = ox / d;
          nz = oz / d;
        }
        const push = r - d;
        const wx = nx * it.cos + nz * it.sin;
        const wz = -nx * it.sin + nz * it.cos;
        pos.x += wx * push;
        pos.z += wz * push;
        hit = true;
      }
    }
    return hit;
  }

  // Ground height: terrain, or a platform we're standing on or stepping onto.
  groundY(x, z, y = Infinity, step = 0.65) {
    let g = this.terrain.heightAt(x, z);
    const items = this.query(x, z, x, z);
    for (const it of items) {
      if (it.type !== 'platform') continue;
      if (it.top <= g || y < it.top - step) continue;
      const dx = x - it.cx;
      const dz = z - it.cz;
      const lx = dx * it.cos - dz * it.sin;
      const lz = dx * it.sin + dz * it.cos;
      if (Math.abs(lx) <= it.hx && Math.abs(lz) <= it.hz) g = it.top;
    }
    return g;
  }

  // Nearest hit along a ray against solids and terrain.
  // Returns { dist, point, normal, kind } or null.
  raycast(origin, dir, maxDist, { terrain = true } = {}) {
    let best = maxDist;
    let bestN = null;
    let kind = null;
    let tag = null;
    const c = this.cell;
    const seen = ++this.stamp;
    const steps = Math.ceil(maxDist / (c * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(s * c * 0.5, maxDist);
      if (t > best + c) break;
      const px = origin.x + dir.x * t;
      const pz = origin.z + dir.z * t;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const list = this.grid.get(this.key(Math.floor(px / c) + di, Math.floor(pz / c) + dj));
          if (!list) continue;
          for (const it of list) {
            if (it.stamp === seen || it.type === 'platform') continue;
            it.stamp = seen;
            const hit = it.type === 'box' ? rayBox(origin, dir, it) : rayCylinder(origin, dir, it);
            if (hit && hit.t < best) {
              best = hit.t;
              bestN = hit.n;
              kind = it.type;
              tag = it.tag;
            }
          }
        }
      }
    }
    if (terrain) {
      const tt = this.terrain.raycast(origin, dir, best);
      if (tt >= 0 && tt < best) {
        best = tt;
        const p = origin.clone().addScaledVector(dir, tt);
        bestN = this.terrain.normalAt(p.x, p.z);
        kind = 'ground';
        tag = null;
      }
    }
    if (!kind) return null;
    return { dist: best, point: origin.clone().addScaledVector(dir, best), normal: bestN, kind, tag };
  }
}

function rayBox(o, d, it) {
  // Into box space (y unrotated)
  const ox = o.x - it.cx;
  const oz = o.z - it.cz;
  const lox = ox * it.cos - oz * it.sin;
  const loz = ox * it.sin + oz * it.cos;
  const ldx = d.x * it.cos - d.z * it.sin;
  const ldz = d.x * it.sin + d.z * it.cos;
  let t0 = -Infinity;
  let t1 = Infinity;
  let axis = 0;
  let sign = 1;
  const slab = (p, v, lo, hi, ax) => {
    if (Math.abs(v) < 1e-9) return p >= lo && p <= hi;
    let a = (lo - p) / v;
    let b = (hi - p) / v;
    let s = -1;
    if (a > b) { const tmp = a; a = b; b = tmp; s = 1; }
    if (a > t0) { t0 = a; axis = ax; sign = s; }
    if (b < t1) t1 = b;
    return t0 <= t1;
  };
  if (!slab(lox, ldx, -it.hx, it.hx, 0)) return null;
  if (!slab(o.y, d.y, it.y0, it.y1, 1)) return null;
  if (!slab(loz, ldz, -it.hz, it.hz, 2)) return null;
  if (t1 < 0) return null;
  const t = t0 > 0 ? t0 : 0;
  let n;
  if (axis === 1) n = new THREE.Vector3(0, sign, 0);
  else {
    const nx = axis === 0 ? sign : 0;
    const nz = axis === 2 ? sign : 0;
    n = new THREE.Vector3(nx * it.cos + nz * it.sin, 0, -nx * it.sin + nz * it.cos);
  }
  return { t, n };
}

function rayCylinder(o, d, it) {
  const ox = o.x - it.x;
  const oz = o.z - it.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - it.r * it.r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = o.y + d.y * t;
  if (y < it.y0 || y > it.y1) return null;
  const n = new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize();
  return { t, n };
}
