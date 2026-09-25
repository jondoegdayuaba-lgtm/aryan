// World generation: terrain heightfield, the stage road carved into it, surface
// masks and where every tree, rock and prop goes. Pure JavaScript with no
// rendering, so it also runs in Node for testing.
import { rng, makeSimplex, fbm, ridged, smoothstep, lerp, clamp, hash2 } from './noise.js';
import { expandRoute, buildLoop, tangentsAndCurvature, wrap } from './road.js';
import { ROUTE, ROAD, FEATURES, TARMAC } from './track.js';

export const N = 2048;            // heightfield samples per side (1 m apart)
export const HALF = N / 2;        // world spans -HALF..HALF-1 on x and z
export const WATER = 0;           // lake surface height

// Surface ids used by physics, sound and effects.
export const SURF = { GRAVEL: 0, TARMAC: 1, LOOSE: 2, GRASS: 3, DIRT: 4, ROCK: 5, SAND: 6, WATER: 7 };

const nA = makeSimplex(1234);
const nB = makeSimplex(5678);
const nC = makeSimplex(9012);
const nD = makeSimplex(3456);
const nE = makeSimplex(7890);

// Natural terrain before the road is carved in: a lake island of rolling
// hills, gravel ridges and a few inland ponds.
export function baseHeight(x, z) {
  const warp = 140 * fbm(nD, x / 520, z / 520, 3);
  const r = Math.hypot(x, z) + warp;
  const island = smoothstep(960, 820, r);
  const hills = fbm(nA, x / 620, z / 620, 5);
  const ridges = ridged(nB, x / 390 + 3.1, z / 390 - 7.4, 3);
  const ridgeMask = smoothstep(-0.2, 0.35, fbm(nC, x / 900, z / 900, 2));
  const land = 11 + 30 * hills + 16 * ridges * ridgeMask;
  return lerp(-16, land, island);
}

// Forest density 0..1: big woods with meadows and clearings between them.
export function forestDensity(x, z) {
  const f = fbm(nE, x / 380, z / 380, 4);
  return smoothstep(-0.28, 0.12, f);
}

// Cubic (Catmull-Rom) interpolation weights.
function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

// Circular box-blur, repeated for a Gaussian-ish result.
function blurLoop(src, radius, passes) {
  const n = src.length;
  let a = Float32Array.from(src), b = new Float32Array(n);
  const w = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += a[wrap(k, n)];
    for (let i = 0; i < n; i++) {
      b[i] = sum / w;
      sum += a[wrap(i + radius + 1, n)] - a[wrap(i - radius, n)];
    }
    [a, b] = [b, a];
  }
  return a;
}

// Smooth bump used for designed features: 0 outside [-1, 1], 1 at 0.
const bump = (u) => (Math.abs(u) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u));

// Height offset a feature adds at distance ds from its position.
function featureOffset(f, ds) {
  switch (f.type) {
    case 'jump': {
      // Long ramp up to the lip, then the ground falls away steeply to a
      // landing slope that ends below where the ramp began.
      const up = f.up ?? 38, down = f.down ?? 26, drop = f.drop ?? f.h * 0.6;
      if (ds <= -up || ds >= down * 2.2) return 0;
      if (ds <= 0) {
        const u = (ds + up) / up;                 // 0..1 up the ramp
        return f.h * (u * u * (3 - 2 * u)) ** 1.35;
      }
      const u = ds / down;
      if (u <= 1) return lerp(f.h, -drop, (1 - Math.cos(Math.PI * u)) / 2) + f.h * 0.12 * Math.sin(Math.PI * u);
      const v = (u - 1) / 1.2;                    // ease the landing back to the road
      return -drop * (1 - v * v * (3 - 2 * v));
    }
    case 'crest': return f.h * bump(ds / (f.len ?? 30));
    case 'dip': return -f.h * bump(ds / (f.len ?? 30));
    default: return 0;
  }
}

// Ground roughness tile (1 m samples, wraps every 256 m).
function detailTile() {
  const n = makeSimplex(4242);
  const t = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      // periodic by sampling a torus
      const a = (i / 256) * Math.PI * 2, b = (j / 256) * Math.PI * 2;
      const R = 256 / (Math.PI * 2);
      const x = Math.cos(a) * R, y = Math.sin(a) * R, z = Math.cos(b) * R, w = Math.sin(b) * R;
      // 4D torus via two 2D lookups mixed: cheap approximation
      t[j * 256 + i] = 0.6 * n(x / 7 + z / 11, y / 7 - w / 13) + 0.4 * n(z / 3.2 + y / 17, w / 3.2 - x / 19);
    }
  }
  return t;
}

export function generateWorld(progress) {
  const it = steps();
  let r;
  while (!(r = it.next()).done) progress?.(r.value);
  return r.value;
}

// Same, but gives the browser a chance to repaint (loading bar) between phases.
export async function generateWorldAsync(progress) {
  const it = steps();
  let r;
  while (!(r = it.next()).done) {
    progress?.(r.value);
    await new Promise((res) => setTimeout(res, 0));
  }
  return r.value;
}

function* steps() {
  const t0 = performance.now();
  const W = ROAD.halfWidth;

  // ---- 1. Natural terrain: 4 m noise samples, cubic upsampling, fine roughness ----
  const C = 4, M = N / C + 3;                   // one extra sample around the edges
  const coarse = new Float32Array(M * M);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) coarse[j * M + i] = baseHeight(-HALF + (i - 1) * C, -HALF + (j - 1) * C);
  }
  yield 0.15;

  const height = new Float32Array(N * N);
  const rows = new Float32Array(M * N);          // interpolated along x
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const g = i / C + 1, gi = Math.floor(g), t = g - gi;
      const r = j * M;
      rows[j * N + i] = cubic(coarse[r + gi - 1], coarse[r + gi], coarse[r + gi + 1], coarse[r + Math.min(M - 1, gi + 2)], t);
    }
  }
  const tile = detailTile();
  for (let j = 0; j < N; j++) {
    const g = j / C + 1, gj = Math.floor(g), t = g - gj;
    const r0 = (gj - 1) * N, r1 = gj * N, r2 = (gj + 1) * N, r3 = Math.min(M - 1, gj + 2) * N;
    for (let i = 0; i < N; i++) {
      const h = cubic(rows[r0 + i], rows[r1 + i], rows[r2 + i], rows[r3 + i], t);
      const rough = tile[(j & 255) * 256 + (i & 255)] * 0.32 + tile[((i + 97) & 255) * 256 + ((j + 31) & 255)] * 0.18;
      height[j * N + i] = h + rough * smoothstep(-2, 1, h);
    }
  }
  yield 0.3;

  // ---- 2. The road: spline, height profile, features ----
  const road = buildLoop(expandRoute(ROUTE), 1);
  const n = road.count;
  const { tx, tz, k: curv } = tangentsAndCurvature(road, 5);
  const sample = (x, z) => heightAt(height, x, z);
  const natural = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // average across the road so side slopes split the difference
    const lx = tz[i], lz = -tx[i];
    natural[i] = (sample(road.x[i], road.z[i]) * 2 + sample(road.x[i] + lx * W, road.z[i] + lz * W) + sample(road.x[i] - lx * W, road.z[i] - lz * W)) / 4;
  }
  let y = blurLoop(natural, 7, 3);
  // Keep above the lakes (causeways), limit the grade both ways round the loop.
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i], WATER + ROAD.minAboveWater);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < n * 2; i++) {
      const a = wrap(i - 1, n), b = wrap(i, n);
      y[b] = clamp(y[b], y[a] - ROAD.maxGrade, y[a] + ROAD.maxGrade);
    }
    for (let i = n * 2; i > 0; i--) {
      const a = wrap(i, n), b = wrap(i - 1, n);
      y[b] = clamp(y[b], y[a] - ROAD.maxGrade, y[a] + ROAD.maxGrade);
    }
  }
  // Round off the hilltops so crests launch the car only at real speed.
  y = blurLoop(y, 10, 3);
  // Designed features, then fords pulled down to the water.
  for (const f of FEATURES) {
    if (f.type === 'ford') continue;
    const from = Math.floor(f.s - 60), to = Math.ceil(f.s + 70);
    for (let s = from; s <= to; s++) y[wrap(s, n)] += featureOffset(f, s - f.s);
  }
  for (const f of FEATURES) {
    if (f.type !== 'ford') continue;
    const half = f.len / 2, ramp = f.ramp ?? 30;
    for (let s = Math.floor(f.s - half - ramp); s <= Math.ceil(f.s + half + ramp); s++) {
      const i = wrap(s, n), ds = Math.abs(s - f.s);
      const target = WATER - (f.depth ?? 0.28);
      const w = ds <= half ? 1 : smoothstep(half + ramp, half, ds);
      y[i] = lerp(y[i], target, w);
    }
  }
  // Gravel roads are never perfectly smooth: small undulations and ruts.
  const rough = makeSimplex(777);
  for (let i = 0; i < n; i++) y[i] += 0.06 * rough(i / 9, 0.5) + 0.025 * rough(i / 3.1, 7.5);

  const surf = new Uint8Array(n);                // per-sample road surface
  for (const [a, b] of TARMAC) for (let s = a; s <= b; s++) surf[wrap(s, n)] = 1;

  road.y = y;
  road.tx = tx;
  road.tz = tz;
  road.curv = curv;
  road.surf = surf;
  road.halfWidth = W;
  yield 0.4;

  // ---- 3. Carve the road into the terrain ----
  const reach = W + ROAD.shoulder + ROAD.ditch + 24;
  const dist = new Float32Array(N * N).fill(99);   // |distance| to the centreline
  const side = new Float32Array(N * N);            // signed distance, + = left of travel
  const along = new Float32Array(N * N).fill(-1);  // nearest sample index (fractional)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = road.x[i], az = road.z[i], bx = road.x[j], bz = road.z[j];
    const ex = bx - ax, ez = bz - az, el = ex * ex + ez * ez || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach) + HALF);
    const x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + reach) + HALF);
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) - reach) + HALF);
    const z1 = Math.min(N - 1, Math.ceil(Math.max(az, bz) + reach) + HALF);
    for (let gz = z0; gz <= z1; gz++) {
      const pz = gz - HALF;
      for (let gx = x0; gx <= x1; gx++) {
        const px = gx - HALF;
        let t = ((px - ax) * ex + (pz - az) * ez) / el;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - (ax + ex * t), qz = pz - (az + ez * t);
        const d = Math.sqrt(qx * qx + qz * qz);
        const idx = gz * N + gx;
        if (d < dist[idx]) {
          dist[idx] = d;
          // left of travel when cross(edge, offset) < 0 (y up, see road.js)
          side[idx] = ex * qz - ez * qx < 0 ? d : -d;
          along[idx] = i + t;
        }
      }
    }
  }
  yield 0.55;

  const roadY = (a) => {
    const i = Math.floor(a), t = a - i;
    return lerp(y[wrap(i, n)], y[wrap(i + 1, n)], t);
  };
  const crown = 0.07;
  const edge = W + ROAD.shoulder;
  for (let idx = 0; idx < N * N; idx++) {
    const d = dist[idx];
    if (d >= reach) continue;
    const ry = roadY(along[idx]);
    const nat = height[idx];
    if (d <= W) {
      height[idx] = ry - crown * (d / W) * (d / W);
      continue;
    }
    const base = ry - crown - 0.12 * Math.min(1, (d - W) / ROAD.shoulder);
    if (d <= edge) { height[idx] = base; continue; }
    const dd = d - edge;
    let h;
    if (nat >= base) {
      // Cutting: a ditch, then a wall climbing back up to the natural ground.
      const dz = ROAD.ditch;
      const cut = dd < dz ? base - ROAD.ditchDepth * Math.sin(Math.PI * dd / dz) : base + (dd - dz) * ROAD.cutSlope;
      h = smin(nat, cut, 0.8);
    } else {
      // Embankment falling away to the natural ground.
      h = smax(nat, base - dd * ROAD.fillSlope, 0.8);
    }
    // fade out any leftover step at the edge of the carve zone
    height[idx] = lerp(h, nat, smoothstep(reach - 4, reach, d));
  }
  yield 0.65;

  const world = { N, HALF, WATER, height, dist, side, along, road };
  world.heightAt = (x, z) => heightAt(height, x, z);
  world.normalAt = (x, z, out) => normalAt(height, x, z, out);
  world.surfaceAt = (x, z) => surfaceAt(world, x, z);
  world.nearestRoad = (x, z) => {
    const i = gridIndex(x, z);
    return i < 0 ? null : { d: side[i], s: along[i] };
  };

  // ---- 4. Trees, rocks, bushes ----
  placeScenery(world);
  buildObstacleGrid(world);
  yield 0.8;

  world.genMs = performance.now() - t0;
  return world;
}

// ---- Heightfield queries (bilinear) ----
function gridIndex(x, z) {
  const gx = Math.round(x) + HALF, gz = Math.round(z) + HALF;
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -1;
  return gz * N + gx;
}

export function heightAt(h, x, z) {
  let gx = x + HALF, gz = z + HALF;
  gx = gx < 0 ? 0 : gx > N - 1.001 ? N - 1.001 : gx;
  gz = gz < 0 ? 0 : gz > N - 1.001 ? N - 1.001 : gz;
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const i = iz * N + ix;
  const a = h[i], b = h[i + 1], c = h[i + N], d = h[i + N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// Surface normal from the bilinear patch gradient.
export function normalAt(h, x, z, out) {
  let gx = x + HALF, gz = z + HALF;
  gx = gx < 0 ? 0 : gx > N - 1.001 ? N - 1.001 : gx;
  gz = gz < 0 ? 0 : gz > N - 1.001 ? N - 1.001 : gz;
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const i = iz * N + ix;
  const a = h[i], b = h[i + 1], c = h[i + N], d = h[i + N + 1];
  const dx = (b - a) + (a - b - c + d) * fz;
  const dz = (c - a) + (a - b - c + d) * fx;
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  out.x = -dx / l; out.y = 1 / l; out.z = -dz / l;
  return out;
}

// What the ground is made of at (x, z).
export function surfaceAt(world, x, z) {
  const i = gridIndex(x, z);
  if (i < 0) return SURF.WATER;
  const h = world.height[i];
  if (h < WATER - 0.05) return SURF.WATER;
  const d = world.dist[i];
  const W = world.road.halfWidth;
  if (d < W + 0.2) {
    const s = Math.round(world.along[i]);
    return world.road.surf[wrap(s, world.road.count)] ? SURF.TARMAC : SURF.GRAVEL;
  }
  if (d < W + ROAD.shoulder + 0.6) return SURF.LOOSE;
  if (h < WATER + 0.6) return SURF.SAND;
  const hx = world.height[Math.min(i + 1, world.height.length - 1)] - h;
  const hz = world.height[Math.min(i + N, world.height.length - 1)] - h;
  const slope = Math.sqrt(hx * hx + hz * hz);
  if (slope > 0.75) return SURF.ROCK;
  return hash2(x >> 3, z >> 3, 9) < 0.18 ? SURF.DIRT : SURF.GRASS;
}

// Scatter trees, rocks and bushes with jittered grids.
function placeScenery(world) {
  const W = world.road.halfWidth;
  const trees = [];
  const r = rng(99);
  const spacing = 4.6;
  const cells = Math.floor(N / spacing);
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const x = -HALF + (cx + r()) * spacing, z = -HALF + (cz + r()) * spacing;
      const roll = r(), kind = r(), size = r(), rot = r();
      const h = world.heightAt(x, z);
      if (h < WATER + 0.7) continue;
      const idx = gridIndex(x, z);
      const d = world.dist[idx];
      // Keep the road clear, but let the forest crowd right up to the ditch.
      if (d < W + ROAD.shoulder + ROAD.ditch + 0.8) continue;
      const nrm = world.normalAt(x, z, {});
      if (nrm.y < 0.8) continue;
      let dens = forestDensity(x, z);
      if (d < 14) dens = Math.max(dens, 0.35 * dens + 0.2);   // roadside tree lines
      if (roll > dens * 0.82) continue;
      const nearWater = h < WATER + 4;
      const type = nearWater || kind < 0.16 ? 2 : kind < 0.72 ? 0 : 1;   // 0 pine, 1 spruce, 2 birch
      trees.push({ x, y: h, z, type, scale: 0.72 + size * 0.6, rot: rot * Math.PI * 2 });
    }
  }
  world.trees = trees;

  const rocks = [];
  const rr = rng(1717);
  const rs = 11;
  const rcells = Math.floor(N / rs);
  for (let cz = 0; cz < rcells; cz++) {
    for (let cx = 0; cx < rcells; cx++) {
      const x = -HALF + (cx + rr()) * rs, z = -HALF + (cz + rr()) * rs;
      const roll = rr(), size = rr(), rot = rr(), tilt = rr();
      const h = world.heightAt(x, z);
      if (h < WATER - 1.5) continue;
      const d = world.dist[gridIndex(x, z)];
      if (d < W + ROAD.shoulder + 1.5) continue;
      const nrm = world.normalAt(x, z, {});
      const steep = 1 - nrm.y;
      const shore = h < WATER + 1.2 ? 0.25 : 0;
      const p = 0.035 + steep * 1.4 + shore + (d < 12 ? 0.05 : 0);
      if (roll > p) continue;
      const big = size > 0.85;
      rocks.push({ x, y: h, z, r: big ? 1.4 + size * 1.6 : 0.35 + size * 0.9, rot: rot * Math.PI * 2, tilt });
    }
  }
  world.rocks = rocks;
}

// Solid things a car can hit: tree trunks (vertical cylinders) and boulders
// (spheres), bucketed in an 8 m grid for quick lookups around the car.
function buildObstacleGrid(world) {
  const CELL = 8, CN = N / CELL;
  const lists = new Map();
  const add = (x, z, item) => {
    const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
    if (cx < 0 || cz < 0 || cx >= CN || cz >= CN) return;
    const k = cz * CN + cx;
    let l = lists.get(k);
    if (!l) lists.set(k, (l = []));
    l.push(item);
  };
  // trunk radius by type: pine, spruce, birch
  const TRUNK = [0.3, 0.3, 0.17];
  for (const t of world.trees) {
    add(t.x, t.z, { kind: 'tree', x: t.x, y: t.y, z: t.z, r: TRUNK[t.type] * t.scale * 1.05, h: 12 * t.scale, tree: t });
  }
  for (const r of world.rocks) {
    // rocks are squat and half buried; this sphere matches the visible top
    add(r.x, r.z, { kind: 'rock', x: r.x, y: r.y - r.r * 0.5, z: r.z, r: r.r * 0.85, rock: r });
  }
  world.obstacles = lists;
  world.obstacleCell = CELL;
  // Calls fn(item) for obstacles whose cell is within `radius` of (x, z).
  world.forObstacles = (x, z, radius, fn) => {
    const c0x = Math.floor((x - radius + HALF) / CELL), c1x = Math.floor((x + radius + HALF) / CELL);
    const c0z = Math.floor((z - radius + HALF) / CELL), c1z = Math.floor((z + radius + HALF) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const l = lists.get(cz * CN + cx);
        if (l) for (const it of l) fn(it);
      }
    }
  };
}
