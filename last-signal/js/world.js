// Builds the valley: a height grid with a lake, a creek in a small gorge, trails and level pads
// for the story locations, plus the data maps the renderer shades from.
// Pure JavaScript with no DOM or three.js, so it also runs under Node for testing.
import { WORLD, SITE_DEFS } from './config.js';
import { createNoise } from './noise.js';
import { clamp, lerp, saturate, smoothstep, nextFrame } from './util.js';

const LAKE = { cx: 46, cz: 128, rx: 215, rz: 128, rot: 0.5, depth: 15 };

// The creek flows south from a spring under the northern peaks, through a gorge at the bridge, into the lake.
const RIVER_PTS = [
  [-26, -790], [-44, -700], [-64, -610], [-84, -520], [-98, -430], [-106, -340], [-104, -250],
  [-92, -170], [-66, -100], [-30, -40], [4, 12], [26, 52],
];
const RIVER = { halfWidth: 4.2, depth: 1.5, gorgeAt: -318, gorgeLen: 80, springLen: 90 };

// Trails are found, not drawn: a least-cost path between these stops, so steep ground gets switchbacks.
const TRAIL_STOPS = {
  wreckToTower: ['wreck', 'tower'],
  towerToCamp: ['tower', 'camp'],
  campToMine: ['camp', 'mine'],
  mineToBridge: ['mine', 'bridgeW'],
  bridgeToCabin: ['bridgeE', 'cabin'],
  cabinToLz: ['cabin', 'lz'],
  cabinToPeak: ['cabin', 'peak'],
};

function catmullRom(pts, step) {
  const out = [];
  const P = (i) => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

// Fills `dist` with the distance to a polyline and `attrs` with values interpolated at the nearest point.
function rasterize(line, radius, V, half, cell, dist, attrs) {
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k], b = line[k + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
    const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
    const ix0 = Math.max(0, Math.floor((minX + half) / cell)), ix1 = Math.min(V - 1, Math.ceil((maxX + half) / cell));
    const iz0 = Math.max(0, Math.floor((minZ + half) / cell)), iz1 = Math.min(V - 1, Math.ceil((maxZ + half) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = -half + iz * cell;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -half + ix * cell;
        const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
        const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
        const i = iz * V + ix;
        if (d < dist[i]) {
          dist[i] = d;
          for (const name in attrs) attrs[name][i] = lerp(a[name], b[name], t);
        }
      }
    }
  }
}

// Minimal binary heap for the path search.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, pri) {
    const a = this.a;
    a.push([pri, item]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

export async function generateWorld({ onProgress = () => {} } = {}) {
  const { size, cell, lakeY } = WORLD;
  const N = size / cell;
  const V = N + 1;
  const half = size / 2;
  const noise = createNoise(WORLD.seed);
  const { n2, fbm, ridged } = noise;

  // ---------- Natural terrain ----------
  const VALLEY = { cx: 20, cz: -40, ax: 800, az: 760 };

  function naturalHeight(x, z) {
    const wx = x + 70 * n2(x * 0.0011, z * 0.0011);
    const wz = z + 70 * n2(x * 0.0011 + 17.3, z * 0.0011 - 9.1);
    const dx = wx - VALLEY.cx, dz = wz - VALLEY.cz;
    const ang = Math.atan2(dz, dx);
    const wobble = 1 + 0.2 * n2(Math.cos(ang) * 1.4 + 4, Math.sin(ang) * 1.4 - 2);
    const rr = Math.hypot(dx / VALLEY.ax, dz / VALLEY.az) / wobble;
    const rim = smoothstep(0.6, 1.3, rr);

    // Valley walls: ridged crests that grow toward the rim.
    const rid = 0.55 * ridged(wx * 0.0019 + 3.1, wz * 0.0019 - 7.7, 4) + 0.45 * (0.5 + 0.5 * fbm(wx * 0.0024 + 8, wz * 0.0024 - 3, 4));
    const mountains = Math.pow(rim, 1.35) * (60 + 330 * rid) + 46 * rim * fbm(wx * 0.0009 + 9, wz * 0.0009 + 2, 3);

    // Valley floor: a shallow basin rising away from the lake, with hills that grow with distance.
    const dLake = Math.hypot(x - LAKE.cx, z - LAKE.cz);
    const basin = 0.05 * Math.max(0, dLake - 120);
    const roll = 4 + 17 * smoothstep(120, 520, dLake);
    const rolling = roll * fbm(wx * 0.0034, wz * 0.0034, 4) * (1 - 0.4 * rim);
    const bumps = 3.2 * fbm(wx * 0.016 + 5, wz * 0.016 - 3, 3) * smoothstep(50, 300, dLake) + 0.45 * n2(x * 0.09, z * 0.09);

    return lakeY + 5 + basin + rolling + bumps + mountains;
  }

  // ---------- Lake ----------
  const lc = Math.cos(LAKE.rot), ls = Math.sin(LAKE.rot);
  function lakeE(x, z) {
    const dx = x - LAKE.cx, dz = z - LAKE.cz;
    const u = (dx * lc + dz * ls) / LAKE.rx, v = (-dx * ls + dz * lc) / LAKE.rz;
    return Math.sqrt(u * u + v * v) * (1 + 0.2 * fbm(x * 0.0075 + 9, z * 0.0075 - 4, 3));
  }

  // ---------- Creek profile: a monotone descent from the spring into the lake ----------
  await nextFrame();
  onProgress(0.02, 'Tracing the creek');
  const riverLine = catmullRom(RIVER_PTS, 2).map(([x, z]) => ({ x, z }));
  {
    let s = 0;
    for (let i = 0; i < riverLine.length; i++) {
      if (i) s += Math.hypot(riverLine[i].x - riverLine[i - 1].x, riverLine[i].z - riverLine[i - 1].z);
      riverLine[i].s = s;
    }
    const total = s;
    for (const p of riverLine) {
      const width = smoothstep(0, RIVER.springLen, p.s);
      p.hw = RIVER.halfWidth * (0.25 + 0.75 * width) * (1 + 0.5 * smoothstep(0.55, 1, p.s / total));
      p.depth = RIVER.depth * (0.4 + 0.6 * width);
      p.gorge = 1 - smoothstep(0, RIVER.gorgeLen, Math.abs(p.z - RIVER.gorgeAt));
      p.natural = naturalHeight(p.x, p.z) - 0.9 - p.depth;
    }
    // Running minimum so the water only ever flows downhill, then smooth and re-enforce.
    let prev = Infinity;
    for (const p of riverLine) { prev = Math.min(prev - 0.004, p.natural); p.level = prev; }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < riverLine.length - 1; i++) {
        let sum = 0, cnt = 0;
        for (let k = -8; k <= 8; k++) { sum += riverLine[clamp(i + k, 0, riverLine.length - 1)].level; cnt++; }
        riverLine[i].smooth = sum / cnt;
      }
      for (let i = 1; i < riverLine.length - 1; i++) riverLine[i].level = riverLine[i].smooth;
      prev = Infinity;
      for (const p of riverLine) { prev = Math.min(prev - 0.004, p.level); p.level = prev; }
    }
    // The last stretch settles into the lake.
    for (const p of riverLine) {
      const toEnd = total - p.s;
      p.level = Math.max(Math.min(p.level, lakeY + 0.06 + toEnd * 0.045), lakeY + 0.06);
    }
  }

  // ---------- Rasters: distance to the creek ----------
  const riverDist = new Float32Array(V * V).fill(1e9);
  const riverLevel = new Float32Array(V * V);
  const riverHw = new Float32Array(V * V);
  const riverDepth = new Float32Array(V * V);
  const riverGorge = new Float32Array(V * V);
  rasterize(riverLine, 90, V, half, cell, riverDist, { level: riverLevel, hw: riverHw, depth: riverDepth, gorge: riverGorge });

  // ---------- Sites ----------
  const sites = {};
  for (const [name, def] of Object.entries(SITE_DEFS)) sites[name] = { ...def, name };

  // The bridge sits where the creek runs through its gorge.
  const BRIDGE_HALF = 15;
  {
    let best = riverLine[0], bd = Infinity;
    for (const p of riverLine) {
      const d = Math.hypot(p.x - SITE_DEFS.bridge.x, p.z - SITE_DEFS.bridge.z);
      if (d < bd) { bd = d; best = p; }
    }
    const i = riverLine.indexOf(best);
    const a = riverLine[Math.max(0, i - 3)], b = riverLine[Math.min(riverLine.length - 1, i + 3)];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz);
    // n points from the west bank to the east bank.
    let nx = -tz / tl, nz = tx / tl;
    if (nx < 0) { nx = -nx; nz = -nz; }
    Object.assign(sites.bridge, { x: best.x, z: best.z, tx: tx / tl, tz: tz / tl, nx, nz, level: best.level, half: BRIDGE_HALF });
    sites.bridgeW = { name: 'bridgeW', x: best.x - nx * (BRIDGE_HALF + 4), z: best.z - nz * (BRIDGE_HALF + 4), clear: 0 };
    sites.bridgeE = { name: 'bridgeE', x: best.x + nx * (BRIDGE_HALF + 4), z: best.z + nz * (BRIDGE_HALF + 4), clear: 0 };
  }

  // ---------- Trails: least-cost paths over a coarse grid ----------
  await nextFrame();
  onProgress(0.05, 'Cutting trails');
  const G = 8, GN = size / G + 1;
  const gh = new Float32Array(GN * GN);
  const blocked = new Uint8Array(GN * GN);
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const x = -half + i * G, z = -half + j * G;
      const k = j * GN + i;
      gh[k] = naturalHeight(x, z);
      const fi = Math.round((x + half) / cell), fj = Math.round((z + half) / cell);
      const ri = clamp(fj, 0, V - 1) * V + clamp(fi, 0, V - 1);
      if (lakeE(x, z) < 1.1) blocked[k] = 1;
      if (riverDist[ri] < riverHw[ri] + 3.5) blocked[k] = 1;
      if (Math.abs(x) > 900 || Math.abs(z) > 900) blocked[k] = 1;
    }
  }
  const gridIndex = (x, z) => clamp(Math.round((z + half) / G), 0, GN - 1) * GN + clamp(Math.round((x + half) / G), 0, GN - 1);

  function findPath(from, to) {
    const start = gridIndex(from.x, from.z), goal = gridIndex(to.x, to.z);
    const cost = new Float32Array(GN * GN).fill(Infinity);
    const prev = new Int32Array(GN * GN).fill(-1);
    const heap = new Heap();
    const saveS = blocked[start], saveG = blocked[goal];
    blocked[start] = blocked[goal] = 0;
    cost[start] = 0;
    heap.push(start, 0);
    const gx = goal % GN, gz = (goal / GN) | 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      const cx = cur % GN, cz = (cur / GN) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
          const nk = nz * GN + nx;
          if (blocked[nk]) continue;
          const dist = Math.hypot(dx, dz) * G;
          const slope = Math.abs(gh[nk] - gh[cur]) / dist;
          if (slope > 0.7) continue;
          const c = cost[cur] + dist * (1 + 26 * Math.max(0, slope - 0.04) ** 2);
          if (c < cost[nk]) {
            cost[nk] = c;
            prev[nk] = cur;
            heap.push(nk, c + Math.hypot(nx - gx, nz - gz) * G);
          }
        }
      }
    }
    blocked[start] = saveS; blocked[goal] = saveG;
    if (!isFinite(cost[goal])) return null;
    const nodes = [];
    for (let k = goal; k !== -1; k = prev[k]) nodes.push([-half + (k % GN) * G, -half + ((k / GN) | 0) * G]);
    nodes.reverse();
    nodes[0] = [from.x, from.z];
    nodes[nodes.length - 1] = [to.x, to.z];
    return nodes;
  }

  // The summit: the highest rise near the cabin that a walkable trail can actually reach.
  {
    const c = SITE_DEFS.cabin, pk = sites.peak;
    const candidates = [];
    for (let dz = -360; dz <= 360; dz += 8) {
      for (let dx = -360; dx <= 360; dx += 8) {
        const d = Math.hypot(dx, dz);
        if (d < 200 || d > 360) continue;
        const x = c.x + dx, z = c.z + dz;
        if (Math.abs(x) > 860 || Math.abs(z) > 860) continue;
        const h = naturalHeight(x, z);
        if (Math.abs(h - naturalHeight(x + 10, z)) + Math.abs(h - naturalHeight(x, z + 10)) > 4.5) continue;
        candidates.push({ x, z, h });
      }
    }
    candidates.sort((a, b) => b.h - a.h);
    pk.x = c.x + 250; pk.z = c.z - 60;
    for (const cand of candidates.slice(0, 40)) {
      const path = findPath(c, cand);
      if (path && path.length < 260) { pk.x = cand.x; pk.z = cand.z; break; }
    }
    pk.flat = 5;
    pk.clear = 14;
  }

  // Trail heights are smoothed along the path so slopes across the tread flatten out.
  const trails = {};
  const trailDist = new Float32Array(V * V).fill(1e9);
  const trailY = new Float32Array(V * V);
  for (const [name, [a, b]] of Object.entries(TRAIL_STOPS)) {
    const nodes = findPath(sites[a], sites[b]);
    if (!nodes) { trails[name] = []; continue; }
    // Thin the node path a little before smoothing so the curve does not wobble with the grid.
    const thin = nodes.filter((_, i) => i % 2 === 0 || i === nodes.length - 1);
    const line = catmullRom(thin, 2).map(([x, z]) => ({ x, z }));
    for (const p of line) p.raw = naturalHeight(p.x, p.z);
    for (let i = 0; i < line.length; i++) {
      let sum = 0, cnt = 0;
      for (let k = -12; k <= 12; k++) { sum += line[clamp(i + k, 0, line.length - 1)].raw; cnt++; }
      line[i].y = sum / cnt - 0.08;
    }
    trails[name] = line;
    rasterize(line, 14, V, half, cell, trailDist, { y: trailY });
  }

  // ---------- Level pads ----------
  const pads = [];
  for (const s of Object.values(sites)) {
    if (s.flat > 0) { s.target = naturalHeight(s.x, s.z) + (s.lift || 0); pads.push(s); }
  }
  {
    const b = sites.bridge;
    const bank = b.level + 0.4 + (BRIDGE_HALF - RIVER.halfWidth) * 0.62 + 5;
    b.deckY = bank + 0.15;
    for (const sgn of [-1, 1]) {
      pads.push({ x: b.x + b.nx * (BRIDGE_HALF + 3) * sgn, z: b.z + b.nz * (BRIDGE_HALF + 3) * sgn, flat: 5, target: b.deckY - 0.12, blend: 12 });
    }
  }

  // ---------- Height grid ----------
  const heights = new Float32Array(V * V);
  const lakeMask = new Uint8Array(V * V);

  for (let iz = 0; iz < V; iz++) {
    const z = -half + iz * cell;
    for (let ix = 0; ix < V; ix++) {
      const x = -half + ix * cell;
      const i = iz * V + ix;
      let h = naturalHeight(x, z);

      // The gorge stands on a low shoulder of land so the creek runs in a proper cut.
      const rd = riverDist[i];
      if (rd < 90 && riverGorge[i] > 0) h += riverGorge[i] * 5 * (1 - smoothstep(24, 90, rd));

      // Lake basin: a bowl below the waterline with banks that ramp up to the land.
      const e = lakeE(x, z);
      if (e < 1.7) {
        if (e < 1.45) lakeMask[i] = 1;
        const bed = lakeY - LAKE.depth * Math.pow(smoothstep(1.02, 0.22, e), 1.15) - 0.1;
        const bank = lakeY + 0.35 + Math.max(0, e - 1) * 30;
        if (e < 1) h = bed;
        else {
          const w = 1 - smoothstep(1.15, 1.7, e);
          h = lerp(h, Math.min(h, bank), w);
          if (e < 1.15) h = Math.min(h, bank);
        }
      }

      // Trail tread.
      const td = trailDist[i];
      if (td < 14) h = lerp(h, trailY[i], (1 - smoothstep(1.6, 9, td)) * 0.85);

      // Creek channel and banks.
      if (rd < 60) {
        const hw = riverHw[i], lvl = riverLevel[i], g = riverGorge[i];
        const R = hw + lerp(24, 30, g);
        if (rd < R) {
          const slope = lerp(0.12, 0.6, g);
          let target;
          if (rd < hw) target = lvl - riverDepth[i] * (1 - (rd / hw) * (rd / hw));
          else target = lvl + 0.35 + (rd - hw) * slope * (0.55 + 0.45 * smoothstep(0, 8, rd - hw));
          const w = rd < hw ? 1 : 1 - smoothstep(R * 0.5, R, rd);
          h = lerp(h, Math.min(target, Math.max(h, lvl + 0.35)), w);
        }
      }

      // Level pads for buildings and clearings.
      for (let k = 0; k < pads.length; k++) {
        const p = pads[k];
        const dx = x - p.x, dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        const outer = p.flat + (p.blend || Math.max(14, p.flat * 0.7));
        if (d2 < outer * outer) h = lerp(h, p.target, 1 - smoothstep(p.flat, outer, Math.sqrt(d2)));
      }
      heights[i] = h;
    }
    if (iz % 48 === 0) {
      onProgress(0.08 + 0.5 * (iz / V), 'Raising mountains');
      await nextFrame();
    }
  }

  // ---------- Finalise sites ----------
  const at = (x, z) => {
    const fx = clamp((x + half) / cell, 0, N - 1e-6), fz = clamp((z + half) / cell, 0, N - 1e-6);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * V + ix;
    const ha = heights[i], hb = heights[i + 1], hc = heights[i + V], hd = heights[i + V + 1];
    return tx + tz <= 1 ? ha + tx * (hb - ha) + tz * (hc - ha) : hd + (1 - tx) * (hc - hd) + (1 - tz) * (hb - hd);
  };
  for (const s of Object.values(sites)) s.y = at(s.x, s.z);

  // ---------- Normals, cavity shading and the splat map ----------
  await nextFrame();
  onProgress(0.6, 'Weathering the rock');
  const normalTex = new Uint8Array(V * V * 4);
  const splat = new Uint8Array(V * V * 4);
  const noiseF = createNoise(WORLD.seed + 101);
  const clearSites = Object.values(sites).filter((s) => s.clear);
  const clearMask = (x, z) => {
    let m = 0;
    for (const s of clearSites) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.clear) m = Math.max(m, 1 - smoothstep(s.clear * 0.6, s.clear, d));
    }
    return m;
  };

  const H = (ix, iz) => heights[clamp(iz, 0, V - 1) * V + clamp(ix, 0, V - 1)];
  for (let iz = 0; iz < V; iz++) {
    const z = -half + iz * cell;
    for (let ix = 0; ix < V; ix++) {
      const x = -half + ix * cell;
      const i = iz * V + ix;
      const h = heights[i];
      const dhx = (H(ix - 1, iz) - H(ix + 1, iz)) / (2 * cell);
      const dhz = (H(ix, iz - 1) - H(ix, iz + 1)) / (2 * cell);
      const il = 1 / Math.sqrt(dhx * dhx + 1 + dhz * dhz);
      const nx = dhx * il, ny = il, nz = dhz * il;
      const avg = (H(ix - 3, iz) + H(ix + 3, iz) + H(ix, iz - 3) + H(ix, iz + 3) + H(ix - 2, iz - 2) + H(ix + 2, iz + 2) + H(ix - 2, iz + 2) + H(ix + 2, iz - 2)) / 8;
      const ao = clamp(1 - (avg - h) * 0.09, 0.5, 1.15);
      normalTex[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      normalTex[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalTex[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalTex[i * 4 + 3] = Math.round(clamp(ao * 0.87, 0, 1) * 255);

      // Splat channels: R trail, G forest floor, B shore, A lushness.
      const elev = h - lakeY;
      const wob = noiseF.n2(x * 0.09, z * 0.09);
      const trail = 1 - smoothstep(0.7, 1.9, trailDist[i] + wob * 0.55);
      const nearWater = lakeMask[i] ? 1 - smoothstep(lakeY + 0.4, lakeY + 3.4, h) : 0;
      const river = riverDist[i] < 40 ? 1 - smoothstep(0, 5.5, Math.max(0, riverDist[i] - riverHw[i])) : 0;
      const shore = Math.max(nearWater * smoothstep(0.86, 0.94, ny), river * 0.9);

      const band = smoothstep(-1, 14, elev) * (1 - smoothstep(170, 240, elev + 8 * noiseF.n2(x * 0.004, z * 0.004)));
      const patch = smoothstep(-0.22, 0.2, noiseF.fbm(x * 0.0065 + 50, z * 0.0065 - 30, 3));
      const slopeOk = smoothstep(0.7, 0.86, ny);
      let forest = band * slopeOk * (0.35 + 0.65 * patch);
      forest *= 1 - clearMask(x, z);
      forest *= 1 - 0.95 * trail;
      forest *= 1 - shore;
      const lush = clamp(0.62 + 0.4 * noiseF.fbm(x * 0.011 + 3, z * 0.011 + 8, 3) + 0.25 * shore - elev * 0.0017, 0, 1);

      splat[i * 4] = Math.round(trail * 255);
      splat[i * 4 + 1] = Math.round(forest * 255);
      splat[i * 4 + 2] = Math.round(shore * 255);
      splat[i * 4 + 3] = Math.round(lush * 255);
    }
    if (iz % 96 === 0) { onProgress(0.6 + 0.35 * (iz / V), 'Weathering the rock'); await nextFrame(); }
  }

  // ---------- Queries ----------
  function heightAt(x, z) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    fx = fx < 0 ? 0 : fx > N - 1e-6 ? N - 1e-6 : fx;
    fz = fz < 0 ? 0 : fz > N - 1e-6 ? N - 1e-6 : fz;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i = iz * V + ix;
    const ha = heights[i], hb = heights[i + 1], hc = heights[i + V], hd = heights[i + V + 1];
    return tx + tz <= 1 ? ha + tx * (hb - ha) + tz * (hc - ha) : hd + (1 - tx) * (hc - hd) + (1 - tz) * (hb - hd);
  }

  // Surface normal of the same triangle heightAt uses; writes into out ({x,y,z}).
  function normalAt(x, z, out) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    fx = fx < 0 ? 0 : fx > N - 1e-6 ? N - 1e-6 : fx;
    fz = fz < 0 ? 0 : fz > N - 1e-6 ? N - 1e-6 : fz;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i = iz * V + ix;
    const ha = heights[i], hb = heights[i + 1], hc = heights[i + V], hd = heights[i + V + 1];
    let dx, dz;
    if (tx + tz <= 1) { dx = (hb - ha) / cell; dz = (hc - ha) / cell; } else { dx = (hd - hc) / cell; dz = (hd - hb) / cell; }
    const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    out.x = -dx * l; out.y = l; out.z = -dz * l;
    return out;
  }

  const nearest = (x, z) => {
    const ix = clamp(Math.round((x + half) / cell), 0, V - 1), iz = clamp(Math.round((z + half) / cell), 0, V - 1);
    return iz * V + ix;
  };

  // Water at a point: writes depth (metres), surface height and the body it belongs to.
  function waterAt(x, z, out) {
    const i = nearest(x, z);
    out.depth = 0; out.y = lakeY; out.body = null;
    if (lakeMask[i]) {
      const d = lakeY - heightAt(x, z);
      if (d > 0) { out.depth = d; out.body = 'lake'; return out; }
    }
    const rd = riverDist[i];
    if (rd < riverHw[i] + 1.5) {
      const d = riverLevel[i] - heightAt(x, z);
      if (d > 0) { out.depth = d; out.y = riverLevel[i]; out.body = 'river'; }
    }
    return out;
  }

  function splatAt(x, z, out) {
    const i = nearest(x, z) * 4;
    out.trail = splat[i] / 255; out.forest = splat[i + 1] / 255; out.shore = splat[i + 2] / 255; out.lush = splat[i + 3] / 255;
    return out;
  }

  const _n = { x: 0, y: 1, z: 0 }, _s = { trail: 0, forest: 0, shore: 0, lush: 0 }, _w = { depth: 0, y: 0, body: null };
  // What the ground is made of at a point, for footsteps and fire lighting.
  function surfaceAt(x, z) {
    waterAt(x, z, _w);
    if (_w.depth > 0.05) return 'water';
    const h = heightAt(x, z);
    normalAt(x, z, _n);
    splatAt(x, z, _s);
    if (h - lakeY > 300 + 30 * n2(x * 0.004, z * 0.004) && _n.y > 0.55) return 'snow';
    if (_n.y < 0.72) return 'rock';
    if (_s.trail > 0.5) return 'dirt';
    if (_s.shore > 0.5) return 'gravel';
    if (_s.forest > 0.5) return 'forest';
    return 'grass';
  }

  onProgress(1, 'Ready');
  return {
    size, half, cell, n: N, v: V, lakeY,
    heights, normalTex, splat, lakeMask, riverDist, riverLevel, riverHw,
    heightAt, normalAt, waterAt, splatAt, surfaceAt, farHeight: naturalHeight, lakeE,
    lake: LAKE, riverLine, riverInfo: RIVER,
    trails, sites, bridgeHalf: BRIDGE_HALF,
  };
}
