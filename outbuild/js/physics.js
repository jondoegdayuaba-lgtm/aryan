// Collision world: a 2D spatial hash of simple shapes, actor movement, and raycasts.
//
// Shapes are "columns" over a footprint so that standing, stepping and ceilings are cheap:
//   BOX  axis-aligned box          RAMP  sloped slab over a grid cell (rises toward `dir`)
//   CONE pyramid roof over a cell  CYL   vertical cylinder             OBB  yaw-rotated box
import * as THREE from 'three';
import { GRID, PLAYER, WORLD } from './config.js';

export const BOX = 0, RAMP = 1, CONE = 2, CYL = 3, OBB = 4;
const CELL = 8;
const EPS = 1e-6;

let nextId = 1;

export class Collider {
  constructor(type, props) {
    this.id = nextId++;
    this.type = type;
    this.minX = 0; this.maxX = 0; this.minY = 0; this.maxY = 0; this.minZ = 0; this.maxZ = 0;
    this.blocksMove = true;
    this.blocksShots = true;
    this.owner = null;
    this.stamp = 0;
    this.cells = null;
    Object.assign(this, props);
    this.computeBounds();
  }

  computeBounds() {
    switch (this.type) {
      case RAMP:
        this.maxY = this.y0 + GRID.level;
        this.minY = this.y0 - this.thick;
        break;
      case CONE:
        this.maxY = this.y0 + GRID.coneHeight;
        this.minY = this.y0 - this.thick;
        break;
      case CYL:
        this.minX = this.cx - this.r; this.maxX = this.cx + this.r;
        this.minZ = this.cz - this.r; this.maxZ = this.cz + this.r;
        break;
      case OBB: {
        const ex = Math.abs(this.c * this.hx) + Math.abs(this.s * this.hz);
        const ez = Math.abs(this.s * this.hx) + Math.abs(this.c * this.hz);
        this.minX = this.cx - ex; this.maxX = this.cx + ex;
        this.minZ = this.cz - ez; this.maxZ = this.cz + ez;
        break;
      }
      default:
    }
  }

  // Surface height at (x, z) for standing (x, z assumed inside or clamped to the footprint).
  top(x, z) {
    if (this.type === RAMP) return this.y0 + GRID.level * rampT(this, x, z);
    if (this.type === CONE) {
      const cx = (this.minX + this.maxX) * 0.5, cz = (this.minZ + this.maxZ) * 0.5;
      const m = Math.min(1, Math.max(Math.abs(x - cx), Math.abs(z - cz)) / (GRID.cell / 2));
      return this.y0 + GRID.coneHeight * (1 - m);
    }
    return this.maxY;
  }

  bottom(x, z) {
    if (this.type === RAMP || this.type === CONE) return this.top(x, z) - this.thick;
    return this.minY;
  }
}

function rampT(c, x, z) {
  let t;
  const S = GRID.cell;
  switch (c.dir) {
    case 0: t = (z - c.minZ) / S; break;
    case 1: t = (x - c.minX) / S; break;
    case 2: t = (c.maxZ - z) / S; break;
    default: t = (c.maxX - x) / S;
  }
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export const RAMP_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export class RayHit {
  constructor() {
    this.dist = Infinity;
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.collider = null;
    this.actor = null;
    this.head = false;
    this.kind = 'none'; // 'terrain' | 'collider' | 'actor' | 'water' | 'none'
  }
  reset() {
    this.dist = Infinity; this.collider = null; this.actor = null; this.head = false; this.kind = 'none';
    return this;
  }
}

export class Physics {
  constructor(terrain) {
    this.terrain = terrain;
    this.hash = new Map();
    this.stamp = 1;
    this._out = [];
    this._ray = new RayHit();
    this.bound = WORLD.size / 2 - 4;
  }

  key(ix, iz) { return (ix + 2048) * 8192 + (iz + 2048); }

  add(c) {
    const i0 = Math.floor(c.minX / CELL), i1 = Math.floor(c.maxX / CELL);
    const j0 = Math.floor(c.minZ / CELL), j1 = Math.floor(c.maxZ / CELL);
    c.cells = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.hash.get(k);
        if (!list) { list = []; this.hash.set(k, list); }
        list.push(c);
        c.cells.push(list);
      }
    }
    return c;
  }

  remove(c) {
    if (!c.cells) return;
    for (const list of c.cells) {
      const i = list.indexOf(c);
      if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
    }
    c.cells = null;
  }

  // Colliders whose footprint touches the rectangle. Returns a shared array.
  query(minX, minZ, maxX, maxZ, out = this._out) {
    out.length = 0;
    const st = ++this.stamp;
    const i0 = Math.floor(minX / CELL), i1 = Math.floor(maxX / CELL);
    const j0 = Math.floor(minZ / CELL), j1 = Math.floor(maxZ / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.hash.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.stamp === st) continue;
          c.stamp = st;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  queryBox(minX, minY, minZ, maxX, maxY, maxZ, out = []) {
    this.query(minX, minZ, maxX, maxZ, out);
    let w = 0;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (c.maxY < minY || c.minY > maxY) continue;
      out[w++] = c;
    }
    out.length = w;
    return out;
  }

  // ------------------------------------------------------------------ footprint helpers
  // Returns push vector length (0 if no overlap) and writes the push into `res`.
  footprintPush(c, x, z, r, res) {
    if (c.type === CYL) {
      const dx = x - c.cx, dz = z - c.cz;
      const d = Math.hypot(dx, dz);
      const rr = r + c.r;
      if (d >= rr) return 0;
      if (d < EPS) { res.x = rr; res.z = 0; return rr; }
      res.x = dx / d * (rr - d);
      res.z = dz / d * (rr - d);
      return rr - d;
    }
    if (c.type === OBB) {
      // local frame
      const lx = (x - c.cx) * c.c + (z - c.cz) * c.s;
      const lz = -(x - c.cx) * c.s + (z - c.cz) * c.c;
      const px = boxPush(lx, lz, -c.hx, c.hx, -c.hz, c.hz, r, res);
      if (px === 0) return 0;
      const wx = res.x * c.c - res.z * c.s;
      const wz = res.x * c.s + res.z * c.c;
      res.x = wx; res.z = wz;
      return px;
    }
    return boxPush(x, z, c.minX, c.maxX, c.minZ, c.maxZ, r, res);
  }

  overlapsFootprint(c, x, z, r) {
    if (c.type === CYL) return Math.hypot(x - c.cx, z - c.cz) < r + c.r;
    if (c.type === OBB) {
      const lx = (x - c.cx) * c.c + (z - c.cz) * c.s;
      const lz = -(x - c.cx) * c.s + (z - c.cz) * c.c;
      const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
      return (lx - qx) ** 2 + (lz - qz) ** 2 < r * r;
    }
    const qx = Math.max(c.minX, Math.min(c.maxX, x)), qz = Math.max(c.minZ, Math.min(c.maxZ, z));
    return (x - qx) ** 2 + (z - qz) ** 2 < r * r;
  }

  // Highest standable surface under a vertical cylinder at (x, z) whose feet are at `feet`.
  groundAt(x, z, feet, r = 0.3, stepUp = PLAYER.stepUp, ignore = null) {
    let g = this.terrain.heightAt(x, z);
    const list = this.query(x - r, z - r, x + r, z + r);
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.blocksMove || c === ignore) continue;
      if (!this.overlapsFootprint(c, x, z, r)) continue;
      const top = this.topUnder(c, x, z, r);
      if (top <= feet + stepUp && top > g) { g = top; best = c; }
    }
    this.lastGround = best;
    return g;
  }

  // Top height of a collider for a disc of radius r at (x,z): for slopes use the highest point under the disc.
  topUnder(c, x, z, r) {
    if (c.type === RAMP || c.type === CONE) {
      const cx = clampv(x, c.minX, c.maxX), cz = clampv(z, c.minZ, c.maxZ);
      if (c.type === RAMP) {
        const d = RAMP_DIRS[c.dir];
        const px = clampv(cx + d[0] * r * 0.5, c.minX, c.maxX);
        const pz = clampv(cz + d[1] * r * 0.5, c.minZ, c.maxZ);
        return c.top(px, pz);
      }
      return c.top(cx, cz);
    }
    return c.maxY;
  }

  // ------------------------------------------------------------------ actor movement
  // body: { pos, vel, radius, height, grounded, ... }. Moves by vel*dt with collisions.
  move(body, dt) {
    const r = body.radius;
    const p = body.pos;
    const v = body.vel;
    const res = { x: 0, z: 0 };
    const stepUp = body.grounded ? PLAYER.stepUp : 0.25;

    // --- horizontal (substeps keep fast movers from tunnelling through thin walls)
    const hx = v.x * dt, hz = v.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(hx, hz) / (r * 0.8)));
    let nx = p.x, nz = p.z;
    body.blocked = false;
    for (let s = 0; s < steps; s++) {
      nx += hx / steps;
      nz += hz / steps;
      for (let it = 0; it < 3; it++) {
        const list = this.query(nx - r, nz - r, nx + r, nz + r);
        let pushed = false;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.blocksMove || c === body.ignoreCollider) continue;
          if (!this.overlapsFootprint(c, nx, nz, r)) continue;
          const cx = clampv(nx, c.minX, c.maxX), cz = clampv(nz, c.minZ, c.maxZ);
          const top = this.topUnder(c, cx, cz, r);
          if (p.y >= top - stepUp) continue; // we can step onto it
          const bot = c.bottom(cx, cz);
          if (p.y + body.height <= bot + 0.02) continue; // passes overhead
          if (this.footprintPush(c, nx, nz, r, res) > 0) {
            nx += res.x;
            nz += res.z;
            pushed = true;
            body.blocked = true;
            body.blockedBy = c;
          }
        }
        if (!pushed) break;
      }
    }
    // keep inside the map
    nx = clampv(nx, -this.bound, this.bound);
    nz = clampv(nz, -this.bound, this.bound);
    // remove the velocity that went into walls
    if (dt > 0) {
      const ax = (nx - p.x) / dt, az = (nz - p.z) / dt;
      if (body.blocked) {
        if (Math.abs(ax) < Math.abs(v.x)) v.x = ax;
        if (Math.abs(az) < Math.abs(v.z)) v.z = az;
      }
    }
    p.x = nx;
    p.z = nz;

    // --- vertical
    const wasGrounded = body.grounded;
    let ny = p.y + v.y * dt;
    const ground = this.groundAt(nx, nz, p.y, r * 0.75, stepUp, body.ignoreCollider);
    const groundCol = this.lastGround;
    // ceiling
    const list = this.query(nx - r, nz - r, nx + r, nz + r);
    let ceil = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.blocksMove || c === body.ignoreCollider) continue;
      if (!this.overlapsFootprint(c, nx, nz, r * 0.8)) continue;
      const cx = clampv(nx, c.minX, c.maxX), cz = clampv(nz, c.minZ, c.maxZ);
      const bot = c.bottom(cx, cz);
      if (bot >= p.y + body.height - 0.05 && bot < ceil) ceil = bot;
    }
    body.landed = false;
    body.impactSpeed = 0;
    if (ny <= ground) {
      if (!wasGrounded) { body.landed = true; body.impactSpeed = -v.y; }
      ny = ground;
      if (v.y < 0) v.y = 0;
      body.grounded = true;
    } else if (wasGrounded && v.y <= 0 && ny - ground < 0.45) {
      ny = ground; // stick to ramps and small steps when walking down
      v.y = 0;
      body.grounded = true;
    } else {
      body.grounded = false;
    }
    if (ny + body.height > ceil) {
      ny = Math.max(ground, ceil - body.height);
      if (v.y > 0) v.y = 0;
    }
    body.groundCollider = body.grounded ? groundCol : null;
    p.y = ny;
    body.groundY = ground;
  }

  // ------------------------------------------------------------------ raycasts
  // opts: { actors, ignoreActor, ignoreCollider, colliders: true, terrain: true, water: false, shots: true }
  raycast(o, d, maxDist, opts = {}, hit = this._ray.reset()) {
    hit.reset();
    const ox = o.x, oy = o.y, oz = o.z;
    const dx = d.x, dy = d.y, dz = d.z;
    let best = maxDist;
    if (opts.terrain !== false) {
      const t = this.terrain.raycast(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) {
        best = t;
        hit.kind = 'terrain';
        hit.dist = t;
        hit.point.set(ox + dx * t, oy + dy * t, oz + dz * t);
        this.terrain.normalAt(hit.point.x, hit.point.z, hit.normal);
      }
    }
    if (opts.water && dy < -1e-4) {
      const t = (WORLD.waterLevel - oy) / dy;
      if (t > 0 && t < best) {
        best = t;
        hit.kind = 'water';
        hit.dist = t;
        hit.point.set(ox + dx * t, WORLD.waterLevel, oz + dz * t);
        hit.normal.set(0, 1, 0);
        hit.collider = null;
      }
    }
    if (opts.colliders !== false) {
      // walk the hash cells along the ray (2D DDA)
      const st = ++this.stamp;
      let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
      const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const tDX = Math.abs(dx) > EPS ? CELL / Math.abs(dx) : Infinity;
      const tDZ = Math.abs(dz) > EPS ? CELL / Math.abs(dz) : Infinity;
      let tMX = Math.abs(dx) > EPS ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / Math.abs(dx)) : Infinity;
      let tMZ = Math.abs(dz) > EPS ? ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / Math.abs(dz)) : Infinity;
      let tCell = 0;
      const nrm = this._n || (this._n = new THREE.Vector3());
      for (let guard = 0; guard < 400; guard++) {
        const list = this.hash.get(this.key(cx, cz));
        if (list) {
          for (let k = 0; k < list.length; k++) {
            const c = list[k];
            if (c.stamp === st) continue;
            c.stamp = st;
            const pass = opts.soft && c.soft ? true : (opts.shots === false ? c.blocksMove : c.blocksShots);
            if (!pass) continue;
            if (c === opts.ignoreCollider) continue;
            if (opts.filter && !opts.filter(c)) continue;
            const t = rayCollider(c, ox, oy, oz, dx, dy, dz, best, nrm);
            if (t >= 0 && t < best) {
              best = t;
              hit.kind = 'collider';
              hit.dist = t;
              hit.collider = c;
              hit.point.set(ox + dx * t, oy + dy * t, oz + dz * t);
              hit.normal.copy(nrm);
            }
          }
        }
        // next cell
        if (tMX < tMZ) { tCell = tMX; tMX += tDX; cx += stepX; } else { tCell = tMZ; tMZ += tDZ; cz += stepZ; }
        if (tCell > best) break;
        if (tCell === Infinity) break;
      }
    }
    if (opts.actors) {
      for (const a of opts.actors) {
        if (a === opts.ignoreActor || !a.alive || !a.hittable) continue;
        const r = rayActor(a, ox, oy, oz, dx, dy, dz, best);
        if (r && r.t < best) {
          best = r.t;
          hit.kind = 'actor';
          hit.dist = r.t;
          hit.actor = a;
          hit.head = r.head;
          hit.collider = null;
          hit.point.set(ox + dx * r.t, oy + dy * r.t, oz + dz * r.t);
          hit.normal.set(-dx, -dy, -dz);
        }
      }
    }
    return hit;
  }

  // True when nothing blocks the segment a->b (terrain and colliders).
  lineOfSight(a, b, ignoreCollider = null) {
    const d = this._los || (this._los = new THREE.Vector3());
    d.subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    const h = this.raycast(a, d, len - 0.05, { ignoreCollider }, this._losHit || (this._losHit = new RayHit()));
    return h.kind === 'none';
  }
}

function clampv(v, a, b) { return v < a ? a : v > b ? b : v; }

function boxPush(x, z, minX, maxX, minZ, maxZ, r, res) {
  const qx = clampv(x, minX, maxX), qz = clampv(z, minZ, maxZ);
  const dx = x - qx, dz = z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return 0;
  if (d2 > EPS) {
    const d = Math.sqrt(d2);
    res.x = dx / d * (r - d);
    res.z = dz / d * (r - d);
    return r - d;
  }
  // centre inside the box: push out along the shallowest side
  const l = x - minX, rr = maxX - x, b = z - minZ, t = maxZ - z;
  const m = Math.min(l, rr, b, t);
  res.x = 0; res.z = 0;
  if (m === l) res.x = -(l + r);
  else if (m === rr) res.x = rr + r;
  else if (m === b) res.z = -(b + r);
  else res.z = t + r;
  return m + r;
}

// ------------------------------------------------------------------ ray vs shapes
function slab(o, d, min, max, st) {
  // st = [tmin, tmax, axisHit, sign]
  if (Math.abs(d) < EPS) return o >= min && o <= max;
  let t1 = (min - o) / d, t2 = (max - o) / d;
  let s = -1;
  if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
  if (t1 > st[0]) { st[0] = t1; st[2] = st.axis; st[3] = s; }
  if (t2 < st[1]) st[1] = t2;
  return st[0] <= st[1];
}

const _st = [0, 0, 0, 0];
function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxT, nrm) {
  _st[0] = -Infinity; _st[1] = Infinity; _st[2] = -1; _st[3] = 0;
  _st.axis = 0; if (!slab(ox, dx, minX, maxX, _st)) return -1;
  _st.axis = 1; if (!slab(oy, dy, minY, maxY, _st)) return -1;
  _st.axis = 2; if (!slab(oz, dz, minZ, maxZ, _st)) return -1;
  let t = _st[0];
  if (_st[1] < 0) return -1;
  if (t < 0) { t = 0; nrm.set(-dx, -dy, -dz); return t; }
  if (t > maxT) return -1;
  nrm.set(0, 0, 0);
  if (_st[2] === 0) nrm.x = _st[3];
  else if (_st[2] === 1) nrm.y = _st[3];
  else nrm.z = _st[3];
  return t;
}

const _v = new THREE.Vector3(), _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _a3 = new THREE.Vector3();
function rayOBB3(ox, oy, oz, dx, dy, dz, cx, cy, cz, A1, A2, A3, h1, h2, h3, maxT, nrm) {
  // transform into the box frame
  const rx = ox - cx, ry = oy - cy, rz = oz - cz;
  const lo1 = rx * A1.x + ry * A1.y + rz * A1.z;
  const lo2 = rx * A2.x + ry * A2.y + rz * A2.z;
  const lo3 = rx * A3.x + ry * A3.y + rz * A3.z;
  const ld1 = dx * A1.x + dy * A1.y + dz * A1.z;
  const ld2 = dx * A2.x + dy * A2.y + dz * A2.z;
  const ld3 = dx * A3.x + dy * A3.y + dz * A3.z;
  const t = rayAABB(lo1, lo2, lo3, ld1, ld2, ld3, -h1, -h2, -h3, h1, h2, h3, maxT, _v);
  if (t < 0) return -1;
  nrm.set(0, 0, 0).addScaledVector(A1, _v.x).addScaledVector(A2, _v.y).addScaledVector(A3, _v.z);
  return t;
}

function rayTri(ox, oy, oz, dx, dy, dz, a, b, c, maxT, nrm) {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPS) return -1;
  const inv = 1 / det;
  const tx = ox - a.x, ty = oy - a.y, tz = oz - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t < 0 || t > maxT) return -1;
  nrm.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
  if (nrm.x * dx + nrm.y * dy + nrm.z * dz > 0) nrm.negate();
  return t;
}

const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _cc = new THREE.Vector3(), _cn = new THREE.Vector3();
export function rayCollider(c, ox, oy, oz, dx, dy, dz, maxT, nrm) {
  switch (c.type) {
    case BOX:
      return rayAABB(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, maxT, nrm);
    case CYL: {
      // side
      const fx = ox - c.cx, fz = oz - c.cz;
      const a = dx * dx + dz * dz;
      let best = -1;
      if (a > EPS) {
        const b = 2 * (fx * dx + fz * dz);
        const cc = fx * fx + fz * fz - c.r * c.r;
        const disc = b * b - 4 * a * cc;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          let t = (-b - sq) / (2 * a);
          if (t < 0 && cc < 0) t = 0;
          if (t >= 0 && t <= maxT) {
            const y = oy + dy * t;
            if (y >= c.minY && y <= c.maxY) {
              best = t;
              nrm.set(fx + dx * t, 0, fz + dz * t).normalize();
            }
          }
        }
      }
      // caps
      if (Math.abs(dy) > EPS) {
        for (const yy of [c.maxY, c.minY]) {
          const t = (yy - oy) / dy;
          if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
            const x = fx + dx * t, z = fz + dz * t;
            if (x * x + z * z <= c.r * c.r) { best = t; nrm.set(0, yy === c.maxY ? 1 : -1, 0); }
          }
        }
      }
      return best;
    }
    case OBB: {
      _a1.set(c.c, 0, c.s);
      _a2.set(0, 1, 0);
      _a3.set(-c.s, 0, c.c);
      return rayOBB3(ox, oy, oz, dx, dy, dz, c.cx, (c.minY + c.maxY) / 2, c.cz, _a1, _a2, _a3, c.hx,
        (c.maxY - c.minY) / 2, c.hz, maxT, nrm);
    }
    case RAMP: {
      const S = GRID.cell, H = GRID.level;
      const d = RAMP_DIRS[c.dir];
      const L = Math.hypot(S, H);
      _a1.set(d[0] * S / L, H / L, d[1] * S / L);          // up the slope
      _a3.set(-d[0] * H / L, S / L, -d[1] * H / L);        // surface normal
      _a2.crossVectors(_a3, _a1);                          // across
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const cy = c.y0 + H / 2;
      const t = rayOBB3(ox, oy, oz, dx, dy, dz, cx - _a3.x * c.thick / 2, cy - _a3.y * c.thick / 2,
        cz - _a3.z * c.thick / 2, _a1, _a2, _a3, L / 2, S / 2, c.thick / 2, maxT, nrm);
      return t;
    }
    case CONE: {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const h = GRID.cell / 2;
      _cc.set(cx, c.y0 + GRID.coneHeight, cz);
      let best = -1;
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
      for (let i = 0; i < 4; i++) {
        const p = corners[i], q = corners[(i + 1) % 4];
        _ca.set(cx + p[0], c.y0, cz + p[1]);
        _cb.set(cx + q[0], c.y0, cz + q[1]);
        const t = rayTri(ox, oy, oz, dx, dy, dz, _ca, _cb, _cc, best >= 0 ? best : maxT, _cn);
        if (t >= 0 && (best < 0 || t < best)) { best = t; nrm.copy(_cn); }
      }
      return best;
    }
    default:
      return -1;
  }
}

// Actor hit shapes: a vertical capsule for the body and a sphere for the head.
function rayActor(a, ox, oy, oz, dx, dy, dz, maxT) {
  const p = a.pos;
  const hh = a.height;
  const headR = 0.17;
  const headY = p.y + hh - headR * 0.95;
  // head sphere
  let best = null;
  {
    const fx = ox - p.x, fy = oy - headY, fz = oz - p.z;
    const b = fx * dx + fy * dy + fz * dz;
    const c = fx * fx + fy * fy + fz * fz - headR * headR;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t < maxT) best = { t, head: true };
    }
  }
  // body: cylinder of radius r from feet to below the head, with rounded ends approximated
  const r = a.radius * 0.95;
  const fx = ox - p.x, fz = oz - p.z;
  const aa = dx * dx + dz * dz;
  if (aa > EPS) {
    const b = 2 * (fx * dx + fz * dz);
    const cc = fx * fx + fz * fz - r * r;
    const disc = b * b - 4 * aa * cc;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * aa);
      if (t >= 0 && t < maxT && (!best || t < best.t)) {
        const y = oy + dy * t;
        if (y >= p.y && y <= headY - headR * 0.6) best = { t, head: false };
      }
    }
  }
  return best;
}
