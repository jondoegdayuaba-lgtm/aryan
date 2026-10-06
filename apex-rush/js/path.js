// The track's centre line, sampled every two metres, plus everything the physics
// needs to know about the surface under the car: height, banking, width, walls
// and gaps. No rendering here, so it also runs headless (see tools/check-tracks.mjs).
import * as THREE from 'three';

export const KERB = 1.1;        // red-and-white kerb outside the tarmac, each side
export const WALL_GAP = 0.3;    // between the kerb and a wall
export const WALL_T = 0.6;      // wall thickness
export const WALL_H = 1.3;      // wall height
export const START_S = 16;      // closed tracks: where the start/finish line sits
const STEP = 2;                 // metres between samples
const CELL = 24;                // spatial grid cell size
const SUB = 32;                 // fine steps per control segment when measuring
const STEP_UP = 0.9;            // the car can climb onto a surface this far above it

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// How far the sides of a raised stretch of road reach down from an edge at
// height h: low road is solid to the ground, higher road is a deck on pillars.
export function deckDepth(h) {
  return h <= 2.5 ? h + 0.06 : Math.max(1.1, 2.56 - (h - 2.5) * 1.5);
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const key = (cx, cz) => (cx + 2048) * 4096 + (cz + 2048);

// Points are written as [x, z], [x, z, y] or [x, z, y, options] (see tracks.js).
function parsePoint(raw, def) {
  const [x, z] = raw;
  let y = 0, o = {};
  if (typeof raw[2] === 'number') { y = raw[2]; o = raw[3] || {}; } else if (raw[2]) o = raw[2];
  return {
    x, z, y,
    w: o.w ?? def.width ?? 14,
    bank: (o.bank ?? 0) * Math.PI / 180,
    slope: o.slope,
    cp: !!o.cp,
    gap: !!o.gap,
    tunnel: !!o.tunnel,
    walls: !!(o.walls || o.tunnel),
    sign: o.sign,
  };
}

export class TrackPath {
  constructor(def) {
    this.def = def;
    this.closed = !!def.closed;
    this.laps = this.closed ? def.laps || 1 : 1;
    const P = (this.points = def.points.map((p) => parsePoint(p, def)));
    const n = P.length;
    const segs = this.closed ? n : n - 1;

    // 1. Measure the curve finely in the ground plane.
    const curve = new THREE.CatmullRomCurve3(P.map((p) => new THREE.Vector3(p.x, 0, p.z)), this.closed, 'centripetal');
    const fine = [];
    const v = new THREE.Vector3();
    let d = 0, px = 0, pz = 0;
    for (let j = 0; j <= segs * SUB; j++) {
      curve.getPoint(j / (segs * SUB), v);
      if (j) d += Math.hypot(v.x - px, v.z - pz);
      fine.push({ x: v.x, z: v.z, segf: j / SUB, d });
      px = v.x; pz = v.z;
    }
    const at = (i) => fine[i * SUB].d;             // distance of control point i
    const segLen = (i) => at(i + 1) - at(i);
    this.pointS = P.map((_, i) => at(i));

    // 2. Heights: a monotone cubic along the distance, so flats stay flat and
    // ramps don't overshoot. A point's `slope` overrides (ramp lips, landings).
    const m = P.map((p, i) => {
      if (p.slope !== undefined) return p.slope;
      const hasPrev = this.closed || i > 0, hasNext = this.closed || i < n - 1;
      const ip = (i - 1 + n) % n, inx = (i + 1) % n;
      const d0 = hasPrev ? (p.y - P[ip].y) / segLen(ip) : null;
      const d1 = hasNext ? (P[inx].y - p.y) / segLen(i % segs) : null;
      if (d0 === null) return d1;
      if (d1 === null) return d0;
      if (d0 === 0 || d1 === 0 || Math.sign(d0) !== Math.sign(d1)) return 0;
      return (2 * d0 * d1) / (d0 + d1);               // harmonic mean keeps it monotone
    });

    // 3. Resample evenly.
    const total = fine[fine.length - 1].d;
    const count = Math.max(8, Math.round(total / STEP));
    const step = (this.step = total / count);
    this.length = total;
    const N = this.closed ? count : count + 1;
    const S = (this.samples = []);
    let f = 0;
    for (let k = 0; k < N; k++) {
      const s = k * step;
      while (f < fine.length - 2 && fine[f + 1].d < s) f++;
      const a = fine[f], b = fine[f + 1];
      const t = clamp((s - a.d) / (b.d - a.d || 1), 0, 1);
      const segf = lerp(a.segf, b.segf, t);
      const seg = Math.min(Math.floor(segf), segs - 1);
      const p0 = P[seg], p1 = P[(seg + 1) % n];
      const L = segLen(seg);
      const u = clamp((s - at(seg)) / L, 0, 1);
      const u2 = u * u, u3 = u2 * u;
      const y = (2 * u3 - 3 * u2 + 1) * p0.y + (u3 - 2 * u2 + u) * L * m[seg]
        + (-2 * u3 + 3 * u2) * p1.y + (u3 - u2) * L * m[(seg + 1) % n];
      S.push({
        x: lerp(a.x, b.x, t), y: Math.max(0, y), z: lerp(a.z, b.z, t), s,
        seg, u, hw: lerp(p0.w, p1.w, smooth(u)) / 2,
        gap: p0.gap, walls: p0.walls, tunnel: p0.tunnel,
        tx: 0, ty: 0, tz: 1, rx: -1, rz: 0, yaw: 0, curv: 0, bank: 0, tanB: 0,
      });
    }

    // 4. Directions and curvature (positive = turning left).
    const idx = (k) => (this.closed ? (k + N) % N : clamp(k, 0, N - 1));
    for (let k = 0; k < N; k++) {
      const a = S[idx(k - 1)], b = S[idx(k + 1)], o = S[k];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      o.tx = dx / len; o.ty = dy / len; o.tz = dz / len;
      const h = Math.hypot(o.tx, o.tz) || 1;
      o.rx = -o.tz / h; o.rz = o.tx / h;              // right = tangent x up
      o.yaw = Math.atan2(o.tx, o.tz);
    }
    const raw = S.map((o, k) => {
      const a = S[idx(k - 2)], b = S[idx(k + 2)];
      let dyaw = b.yaw - a.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      return dyaw / (step * 4);
    });
    S.forEach((o, k) => {
      let sum = 0;
      for (let j = -3; j <= 3; j++) sum += raw[idx(k + j)];
      o.curv = sum / 7;
    });

    // 5. Banking leans into the corner, so its sign comes from the turn direction.
    const pointBank = P.map((p, i) => {
      if (!p.bank) return 0;
      const k = clamp(Math.round(at(i) / step), 0, N - 1);
      return p.bank * (S[k].curv >= 0 ? 1 : -1);
    });
    for (const o of S) {
      const sb = lerp(pointBank[o.seg], pointBank[(o.seg + 1) % n], smooth(o.u));
      o.bank = sb;
      o.tanB = Math.tan(sb);
      // Lift banked road so its low edge never dips into the ground.
      o.y = Math.max(o.y, (o.hw + KERB) * Math.abs(o.tanB));
    }

    // 6. Spatial grid of segments for fast lookups.
    this.grid = new Map();
    this.segCount = this.closed ? N : N - 1;
    const pad = 22;
    for (let k = 0; k < this.segCount; k++) {
      const a = S[k], b = S[(k + 1) % N];
      const x0 = Math.floor((Math.min(a.x, b.x) - pad) / CELL), x1 = Math.floor((Math.max(a.x, b.x) + pad) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - pad) / CELL), z1 = Math.floor((Math.max(a.z, b.z) + pad) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const kk = key(cx, cz);
          let list = this.grid.get(kk);
          if (!list) this.grid.set(kk, (list = []));
          list.push(k);
        }
      }
    }
    this.bounds = S.reduce((b, o) => ({
      minX: Math.min(b.minX, o.x), maxX: Math.max(b.maxX, o.x), minZ: Math.min(b.minZ, o.z), maxZ: Math.max(b.maxZ, o.z),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

    // 7. Gates: checkpoints in order, then the finish (the start line on closed tracks).
    this.checkpoints = P.map((p, i) => (p.cp ? this.gate(at(i), 'checkpoint') : null)).filter(Boolean);
    if (this.closed) {
      this.finish = this.gate(START_S, 'finish');
      this.start = this.finish;
      this.spawnS = START_S - 8;
    } else {
      this.start = this.gate(START_S, 'start');
      this.finish = this.gate(total - 16, 'finish');
      this.spawnS = START_S - 8;
    }
  }

  gate(s, kind) {
    const o = this.at(s, {});
    return { ...o, s, kind };
  }

  // Interpolated centre-line point at distance s (wraps on closed tracks).
  at(s, out = {}) {
    const S = this.samples, N = S.length;
    s = this.closed ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length);
    let k = Math.floor(s / this.step), t = s / this.step - k;
    if (!this.closed && k >= N - 1) { k = N - 2; t = 1; }
    const a = S[k], b = S[(k + 1) % N];
    out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t); out.z = lerp(a.z, b.z, t);
    const tx = lerp(a.tx, b.tx, t), tz = lerp(a.tz, b.tz, t), h = Math.hypot(tx, tz) || 1;
    out.tx = tx / h; out.tz = tz / h;
    out.rx = -out.tz; out.rz = out.tx;
    out.yaw = Math.atan2(out.tx, out.tz);
    out.hw = lerp(a.hw, b.hw, t);
    out.bank = lerp(a.bank, b.bank, t);
    out.curv = lerp(a.curv, b.curv, t);
    out.gap = a.gap;
    out.index = k;
    return out;
  }

  // What's under point p? Fills `out` with the supporting surface (road or the
  // ground at y = 0), the nearest stretch of road, and any wall close by.
  probe(p, out) {
    const S = this.samples, N = S.length;
    out.road = false; out.onRoad = false; out.kerb = false;
    out.height = 0; out.nx = 0; out.ny = 1; out.nz = 0;
    out.index = -1; out.s = 0; out.lat = 0; out.hw = 0;
    out.nearIndex = -1; out.nearS = 0; out.nearLat = 0; out.nearY = 0;
    out.wall = false;
    out.side = false;
    const list = this.grid.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
    if (!list) return out;

    let best = -1, bestH = -Infinity, bestAlong = Infinity, bt = 0, blat = 0;
    let near = -1, nearScore = Infinity, nt = 0, nlat = 0, ny = 0;
    let wall = -1, wallScore = Infinity, wt = 0, wlat = 0, wh = 0;
    let side = -1, sideScore = Infinity, st = 0, slat = 0;
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      const a = S[k], b = S[(k + 1) % N];
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      const along = Math.abs(t - tc) * Math.sqrt(len2);
      if (along > 2) continue;
      const cx = a.x + dx * tc, cz = a.z + dz * tc;
      const lat = (p.x - cx) * (a.rx + (b.rx - a.rx) * tc) + (p.z - cz) * (a.rz + (b.rz - a.rz) * tc);
      const hw = a.hw + (b.hw - a.hw) * tc;
      const al = Math.abs(lat);
      if (al > hw + KERB + WALL_GAP + WALL_T + 3) continue;
      const h = a.y + (b.y - a.y) * tc + lat * (a.tanB + (b.tanB - a.tanB) * tc);
      const dy = p.y - h;

      const ns = Math.max(0, al - hw) + Math.abs(dy) * 2 + along;
      if (ns < nearScore) { nearScore = ns; near = k; nt = tc; nlat = lat; ny = h; }
      if (a.gap) continue;
      if (al <= hw + KERB + 0.35 && dy >= -STEP_UP) {
        if (h > bestH + 0.5 || (Math.abs(h - bestH) <= 0.5 && along < bestAlong)) {
          best = k; bestH = h; bestAlong = along; bt = tc; blat = lat;
        }
      }
      if (a.walls && dy > -2 && dy < WALL_H + 1.5) {
        const ws = along + Math.abs(dy);
        if (ws < wallScore) { wallScore = ws; wall = k; wt = tc; wlat = lat; wh = h; }
      }
      // Beside road too high to climb onto: its side is solid if it reaches
      // down past the car's roof.
      const W = hw + KERB;
      if (dy < -STEP_UP && al > W - 1.5 && al < W + 2) {
        const edge = h + (Math.sign(lat) * W - lat) * (a.tanB + (b.tanB - a.tanB) * tc);
        if (edge - deckDepth(edge) < p.y + 1.2 && along < sideScore) { sideScore = along; side = k; st = tc; slat = lat; }
      }
    }

    if (near >= 0) {
      out.nearIndex = near; out.nearS = S[near].s + nt * this.step; out.nearLat = nlat; out.nearY = ny;
    }
    if (best >= 0) {
      const a = S[best], b = S[(best + 1) % N];
      const hw = a.hw + (b.hw - a.hw) * bt;
      const al = Math.abs(blat);
      out.road = true;
      out.onRoad = al <= hw + KERB;
      out.kerb = al > hw;
      out.height = bestH;
      out.index = best;
      out.s = a.s + bt * this.step;
      out.lat = blat;
      out.hw = hw;
      // Surface normal: across-the-road direction (tilted by the banking) x tangent.
      const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const rx = a.rx, rz = a.rz, ry = a.tanB + (b.tanB - a.tanB) * bt;
      let nx = ry * tz - rz * ty, nyy = rz * tx - rx * tz, nz = rx * ty - ry * tx;
      const l = Math.hypot(nx, nyy, nz) || 1;
      if (nyy < 0) { nx = -nx; nyy = -nyy; nz = -nz; }
      out.nx = nx / l; out.ny = nyy / l; out.nz = nz / l;
    }
    if (side >= 0) {
      const a = S[side], b = S[(side + 1) % N];
      out.side = true;
      out.sideLat = slat;
      out.sideW = a.hw + (b.hw - a.hw) * st + KERB;
      out.sideRx = a.rx; out.sideRz = a.rz;
      out.sideTx = a.tx; out.sideTz = a.tz;
    }
    if (wall >= 0) {
      const a = S[wall], b = S[(wall + 1) % N];
      out.wall = true;
      out.wallLat = wlat;
      out.wallIn = a.hw + (b.hw - a.hw) * wt + KERB + WALL_GAP;
      out.wallRx = a.rx; out.wallRz = a.rz;
      out.wallTx = a.tx; out.wallTz = a.tz;
      out.wallBase = wh;
    }
    return out;
  }

  // Horizontal distance from (x, z) to the nearest road edge, for placing scenery.
  clearance(x, z) {
    let best = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.grid.get(key(cx + i, cz + j));
        if (!list) continue;
        for (const k of list) {
          const o = this.samples[k];
          const d = Math.hypot(x - o.x, z - o.z) - o.hw - KERB;
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  // Height of the highest road deck over (x, z) below `maxY`, or -Infinity.
  deckBelow(x, z, maxY) {
    const out = this._tmp || (this._tmp = {});
    this.probe({ x, y: maxY, z }, out);
    return out.road ? out.height : -Infinity;
  }
}
