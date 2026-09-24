// Tiny collision world: oriented boxes, spheres, vertical cylinders and tori.
// Everything the missile can crash into registers a shape here.
import * as THREE from 'three';

const _d = new THREE.Vector3();
const _l = new THREE.Vector3();
const _n = new THREE.Vector3();
const _o = new THREE.Vector3();
const _r = new THREE.Vector3();

export class Colliders {
  constructor() {
    this.shapes = [];
  }

  // Oriented box. `quaternion` is optional.
  addBox(center, size, quaternion = null) {
    const half = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    const q = quaternion ? quaternion.clone() : new THREE.Quaternion();
    this.shapes.push({
      type: 'box', center: center.clone(), half, q, invQ: q.clone().invert(), bound: half.length(),
    });
  }

  // Register a Mesh with a BoxGeometry, using its world transform.
  addBoxMesh(mesh) {
    mesh.updateWorldMatrix(true, false);
    const p = mesh.geometry.parameters;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    mesh.matrixWorld.decompose(pos, q, s);
    this.addBox(pos, new THREE.Vector3(p.width * s.x, p.height * s.y, p.depth * s.z), q);
  }

  addSphere(center, radius) {
    this.shapes.push({ type: 'sphere', center: center.clone(), radius, bound: radius });
  }

  addCylinder(center, radius, yMin, yMax) {
    const c = new THREE.Vector3(center.x, (yMin + yMax) / 2, center.z);
    this.shapes.push({ type: 'cyl', center: c, radius, yMin, yMax, bound: Math.hypot(radius, (yMax - yMin) / 2) });
  }

  // Torus lying in its local XY plane (same as THREE.TorusGeometry).
  addTorus(center, quaternion, majorRadius, tubeRadius) {
    this.shapes.push({
      type: 'torus', center: center.clone(), q: quaternion.clone(), invQ: quaternion.clone().invert(),
      R: majorRadius, r: tubeRadius, bound: majorRadius + tubeRadius,
    });
  }

  // Returns a surface normal (Vector3) if a sphere at `p` with `radius` touches anything, else null.
  test(p, radius, out = new THREE.Vector3()) {
    if (p.y < radius) return out.set(0, 1, 0);
    for (const s of this.shapes) {
      _d.subVectors(p, s.center);
      const b = s.bound + radius;
      if (_d.lengthSq() > b * b) continue;
      switch (s.type) {
        case 'box': {
          _l.copy(_d).applyQuaternion(s.invQ);
          const px = s.half.x + radius - Math.abs(_l.x);
          const py = s.half.y + radius - Math.abs(_l.y);
          const pz = s.half.z + radius - Math.abs(_l.z);
          if (px > 0 && py > 0 && pz > 0) {
            if (px < py && px < pz) _n.set(Math.sign(_l.x) || 1, 0, 0);
            else if (py < pz) _n.set(0, Math.sign(_l.y) || 1, 0);
            else _n.set(0, 0, Math.sign(_l.z) || 1);
            return out.copy(_n).applyQuaternion(s.q);
          }
          break;
        }
        case 'sphere':
          if (_d.length() < s.radius + radius) return out.copy(_d).normalize();
          break;
        case 'cyl': {
          const h = Math.hypot(_d.x, _d.z);
          if (h < s.radius + radius && p.y > s.yMin - radius && p.y < s.yMax + radius) {
            if (p.y > s.yMax - 0.5) return out.set(0, 1, 0);
            if (p.y < s.yMin + 0.5) return out.set(0, -1, 0);
            return out.set(_d.x, 0, _d.z).normalize();
          }
          break;
        }
        case 'torus': {
          _l.copy(_d).applyQuaternion(s.invQ);
          const rad = Math.hypot(_l.x, _l.y) || 1e-6;
          const cx = (_l.x / rad) * s.R, cy = (_l.y / rad) * s.R;
          _n.set(_l.x - cx, _l.y - cy, _l.z);
          if (_n.length() < s.r + radius) return out.copy(_n).normalize().applyQuaternion(s.q);
          break;
        }
      }
    }
    return null;
  }

  // Distance along a unit-length ray to the first solid thing (ground included),
  // or maxDist if nothing is hit. Gates are ignored so you can aim through them.
  raycast(origin, dir, maxDist) {
    let best = maxDist;
    if (dir.y < -1e-6) {
      const t = -origin.y / dir.y;
      if (t >= 0 && t < best) best = t;
    }
    for (const s of this.shapes) {
      if (s.type === 'torus') continue;
      _d.subVectors(s.center, origin);
      const tc = _d.dot(dir);
      if (tc < -s.bound || tc - s.bound > best) continue;
      const d2 = _d.lengthSq() - tc * tc;
      if (d2 > s.bound * s.bound) continue;
      let t = Infinity;
      if (s.type === 'sphere') {
        t = tc - Math.sqrt(s.radius * s.radius - d2);
      } else if (s.type === 'box') {
        _o.subVectors(origin, s.center).applyQuaternion(s.invQ);
        _r.copy(dir).applyQuaternion(s.invQ);
        let tmin = -Infinity, tmax = Infinity;
        for (const a of ['x', 'y', 'z']) {
          const h = s.half[a];
          if (Math.abs(_r[a]) < 1e-9) {
            if (Math.abs(_o[a]) > h) { tmin = Infinity; break; }
          } else {
            const t1 = (-h - _o[a]) / _r[a], t2 = (h - _o[a]) / _r[a];
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
          }
        }
        if (tmin <= tmax && tmin >= 0) t = tmin;
      } else if (s.type === 'cyl') {
        const ox = origin.x - s.center.x, oz = origin.z - s.center.z;
        const a = dir.x * dir.x + dir.z * dir.z;
        if (a > 1e-9) {
          const b = ox * dir.x + oz * dir.z, c = ox * ox + oz * oz - s.radius * s.radius;
          const disc = b * b - a * c;
          if (disc >= 0) {
            const t1 = (-b - Math.sqrt(disc)) / a;
            const y = origin.y + dir.y * t1;
            if (t1 >= 0 && y >= s.yMin && y <= s.yMax) t = t1;
          }
        }
        for (const capY of [s.yMax, s.yMin]) {
          if (Math.abs(dir.y) < 1e-9) break;
          const tp = (capY - origin.y) / dir.y;
          if (tp >= 0 && tp < t && Math.hypot(ox + dir.x * tp, oz + dir.z * tp) <= s.radius) t = tp;
        }
      }
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
}
