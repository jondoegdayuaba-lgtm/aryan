// Generates the landscape: height maps at three resolutions, the carved rally
// road, surface masks and scatter positions (rocks, cacti, bushes).
// Pure JS so it can run in the browser, in a worker, or under Node for tooling.
import { simplex2, fbm, ridged, smoothstep, clamp, lerp, rng } from '../noise.js';
import { Route } from './route.js';

// Height grids. Grid point (i, j) sits at (origin + i * spacing, origin + j * spacing).
export const NEAR = { size: 2049, spacing: 1, origin: -1024 };
export const MID = { size: 1025, spacing: 8, origin: -4096 };
export const FAR = { size: 513, spacing: 64, origin: -16384 };
export const PLAY_RADIUS = 900;

export class Grid {
  constructor(spec, data = new Float32Array(spec.size * spec.size)) {
    this.size = spec.size;
    this.spacing = spec.spacing;
    this.origin = spec.origin;
    this.data = data;
    this.extent = this.origin + (this.size - 1) * this.spacing;
  }

  contains(x, z, margin = 0) {
    return x >= this.origin + margin && x <= this.extent - margin && z >= this.origin + margin && z <= this.extent - margin;
  }

  sample(x, z) {
    const n = this.size;
    let fx = (x - this.origin) / this.spacing;
    let fz = (z - this.origin) / this.spacing;
    fx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz;
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const k = j * n + i;
    const d = this.data;
    const a = d[k], b = d[k + 1], c = d[k + n], e = d[k + n + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;
  }
}

// ---------- Natural landscape (before the road is cut in) ----------

// Smooth fields cached on coarse grids and upsampled; see macro().
const F_BASE = 0, F_M = 1, F_G = 2, F_DM = 3, F_DU = 4, F_DA = 5, F_DU2 = 6, F_PM = 7, F_PH = 8, F_OO = 9, F_FK = 10;
const NF = 11;

// Turns a smooth rise of `H` metres into steps: steep risers with narrow ledges
// roughly every 6 m, like layered sandstone.
function ledges3(s, H) {
  if (s <= 0 || s >= H) return s;
  const n = Math.max(1, Math.round(H / 6));
  const f = (s / H) * n;
  const k = Math.floor(f);
  const u = f - k;
  const stepped = (k + smoothstep(0.25, 0.75, u)) / n;
  return H * lerp(s / H, stepped, 0.7);
}

function makeLandscape(stage) {
  const S = stage.seed;
  const nA = simplex2(S + 1), nB = simplex2(S + 2), nWx = simplex2(S + 3), nWz = simplex2(S + 4);
  const nM = simplex2(S + 5), nG = simplex2(S + 6), nD = simplex2(S + 7), nDa = simplex2(S + 8);
  const nDet = simplex2(S + 9), nMt = simplex2(S + 10), nBt = simplex2(S + 11), nPl = simplex2(S + 12);
  const { mesas, buttes, playa, oasis, dunes } = stage;
  const ledges = stage.ledges ?? [];
  const octaves = (spacing, wl, n) => Math.max(1, Math.min(n, Math.floor(Math.log2(wl / (2 * spacing))) + 1));

  // Eroded gullies that notch the cliff edges (fine detail, evaluated per sample).
  function gully(x, z, spacing) {
    return spacing < 30 ? 0.032 * (ridged(nG, x / 70, z / 70, octaves(spacing, 70, 3)) - 0.55) : 0;
  }

  // Large-scale smooth fields into F (a Float64Array indexed by the F_* constants).
  // `spacing` is the grid spacing they are evaluated for, so octaves finer than the
  // grid can resolve are skipped.
  function macro(x, z, spacing, F) {
    const oct = (wl, n) => octaves(spacing, wl, n);
    const r = Math.sqrt(x * x + z * z);
    F[F_BASE] = 6 * fbm(nA, x / 650, z / 650, oct(650, 4)) + 2.2 * fbm(nB, x / 170, z / 170, oct(170, 3));
    const wo = oct(520, 3);
    const wx = x + 110 * fbm(nWx, x / 520, z / 520, wo);
    const wz = z + 110 * fbm(nWz, x / 520, z / 520, wo);
    let m = 0.3 * fbm(nM, wx / 620, wz / 620, oct(620, 5)) - 0.2;
    // Placed plateaus only get a third of the warp so they land where the stage puts them.
    const bx = x + 0.35 * (wx - x), bz = z + 0.35 * (wz - z);
    for (let i = 0; i < mesas.length; i++) {
      const b = mesas[i];
      const dx = bx - b[0], dz = bz - b[1];
      const d = Math.sqrt(dx * dx + dz * dz) / b[2];
      if (d < 1.3) m += b[3] * (1 - smoothstep(0.55, 1.25, d));
    }
    // The rim of the basin: a ragged ring of plateaus.
    const rim = r + 150 * fbm(nPl, x / 480, z / 480, oct(480, 3)) + 40 * fbm(nPl, x / 140 + 9, z / 140, oct(140, 2));
    m += 0.62 * smoothstep(900, 1030, rim);
    F[F_M] = m;
    F[F_G] = 0;

    // Dunes.
    const ddx = x - dunes.x, ddz = z - dunes.z;
    const dd = Math.sqrt(ddx * ddx + ddz * ddz) / dunes.r;
    if (dd < 1.3) {
      F[F_DM] = 1 - smoothstep(0.62, 1.05, dd + 0.18 * fbm(nDa, x / 250, z / 250, oct(250, 2)));
      F[F_DU] = (x + 55 * fbm(nD, x / 340, z / 340, oct(340, 3)) + 0.25 * z) / 78;
      F[F_DA] = 7.5 + 5.5 * fbm(nDa, x / 300 + 5, z / 300, oct(300, 2));
      F[F_DU2] = (z * 0.7 + x * 0.3 + 20 * fbm(nD, x / 120, z / 120, oct(120, 2))) / 23;
    } else {
      F[F_DM] = 0; F[F_DU] = 0; F[F_DA] = 0; F[F_DU2] = 0;
    }

    // Dry lake.
    const px = (x - playa.x) / playa.rx, pz = (z - playa.z) / playa.rz;
    const pd = Math.sqrt(px * px + pz * pz);
    if (pd < 1.3) {
      F[F_PM] = 1 - smoothstep(0.8, 1.03, pd + 0.08 * fbm(nPl, x / 150, z / 150, oct(150, 3)));
      F[F_PH] = playa.h + 0.12 * fbm(nDet, x / 220, z / 220, oct(220, 2));
    } else {
      F[F_PM] = 0; F[F_PH] = 0;
    }

    // Oasis.
    const ox = x - oasis.x, oz = z - oasis.z;
    const od = Math.sqrt(ox * ox + oz * oz) / oasis.r;
    F[F_OO] = od < 3.2 ? od + 0.1 * fbm(nPl, x / 40, z / 40, oct(40, 2)) : 99;

    // Beyond the basin: eroded plateau country, then distant mountain ranges.
    let fk = 0;
    if (r > 1000) {
      fk += smoothstep(1000, 2600, r) * 42 * (ridged(nMt, x / 900, z / 900, oct(900, 4)) - 0.4);
      const k2 = smoothstep(3200, 7500, r);
      if (k2 > 0) fk += k2 * 560 * Math.pow(ridged(nMt, x / 2600 + 3, z / 2600 - 7, oct(2600, 5)), 1.7);
    }
    F[F_FK] = fk;
    return F;
  }

  // Sharp features, evaluated at full resolution from the smooth fields.
  // `masks` (optional) receives dune / playa weights for the surface textures.
  function shape(x, z, F, detail, masks) {
    const base = F[F_BASE];
    let h = base;

    // Mesas: terraced plateaus with cliffs and a talus apron. Cliff faces are
    // stepped into sandstone ledges and fluted by narrow vertical gullies.
    let mm = F[F_M] + F[F_G];
    if (detail && mm > -0.03 && mm < 0.4) mm += 0.0045 * nDet(x / 16, z / 16) + 0.0018 * nDet(x / 6 + 7, z / 6);
    const tal = smoothstep(-0.12, 0.012, mm);
    const t1 = smoothstep(0.0, 0.03, mm);
    const t2 = smoothstep(0.17, 0.2, mm);
    const t3 = smoothstep(0.34, 0.37, mm);
    h += 10 * tal * tal + ledges3(30 * t1, 30) + ledges3(24 * t2, 24) + ledges3(18 * t3, 18);
    if (detail && t1 > 0) h += 1.1 * t1 * fbm(nDet, x / 45, z / 45, 2);

    // Buttes: tall rock towers on a scree cone.
    for (let i = 0; i < buttes.length; i++) {
      const b = buttes[i];
      const dx = x - b[0], dz = z - b[1];
      const R = b[2];
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R * 6.5) continue;
      const d = Math.sqrt(d2);
      const ca = dx / (d || 1), sa = dz / (d || 1);
      const rr = R * (1 + 0.15 * nBt(ca * 1.1 + b[0] * 0.01, sa * 1.1 + b[1] * 0.01) + 0.05 * nBt(ca * 3 + b[0], sa * 3 - b[1]));
      const cliff = 1 - smoothstep(rr - 2.5, rr + 2, d);
      const cone = smoothstep(R * 2.5, R * 0.95, d + 4 * nBt(x / 25, z / 25));
      const hb = b[3] * (0.2 * cone * cone + 0.8 * cliff) + (cliff > 0 ? 2 * cliff * nBt(x / 20, z / 20) : 0);
      if (hb > h - base) h = base + hb;
    }

    // Ledges: low flat-topped shelves with a short cliff.
    for (let i = 0; i < ledges.length; i++) {
      const b = ledges[i];
      const dx = x - b[0], dz = z - b[1];
      const R = b[2];
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + 30) * (R + 30)) continue;
      const d = Math.sqrt(d2);
      const rr = R * (1 + 0.1 * nBt(dx / 60 + 11, dz / 60 - 4));
      const top = 1 - smoothstep(rr - 4, rr + 1.5, d);
      const skirt = 1 - smoothstep(rr, rr + 18, d);
      h = Math.max(h, base + b[3] * (0.82 * top + 0.18 * skirt * skirt) + (top > 0 ? 0.6 * top * nBt(x / 14, z / 14) : 0));
    }

    // Dunes: transverse ridges with a gentle windward slope and a steep slip face.
    const dm = F[F_DM] * (1 - t1);
    if (dm > 0) {
      const u = F[F_DU], s = u - Math.floor(u);
      const prof = s < 0.72 ? Math.pow(s / 0.72, 1.4) : Math.pow(1 - (s - 0.72) / 0.28, 1.6);
      const u2 = F[F_DU2], s2 = u2 - Math.floor(u2);
      const p2 = s2 < 0.7 ? s2 / 0.7 : (1 - s2) / 0.3;
      h += dm * (F[F_DA] * prof + 1.3 * p2 * p2);
    }

    // Dry lake: dead flat.
    const pm = F[F_PM];
    if (pm > 0) h = lerp(h, F[F_PH], pm);

    // Oasis pond: a bowl in a flat apron.
    const oo = F[F_OO];
    if (oo < 3) {
      const rimH = oasis.level + 0.9;
      h = lerp(h, rimH + 0.03 * (h - rimH), smoothstep(2.8, 1.3, oo));
      h -= oasis.depth * Math.pow(1 - smoothstep(0, 1.05, oo), 0.8);
    }

    h += F[F_FK];
    if (detail) h += 0.8 * fbm(nDet, x / 26, z / 26, 2) * (1 - 0.8 * dm) * (1 - pm);

    if (masks) {
      masks.dune = dm;
      masks.playa = pm;
    }
    return h;
  }

  return { macro, shape, gully, noise: { nDet } };
}

// Fills a grid by evaluating the smooth fields on a coarser cache, upsampling
// them bilinearly and applying the sharp shaping per sample.
function* fillGrid(L, grid, cacheSpacing, opts) {
  const { detail = false, gullyPerSample = false, skip = null, masks = null, label, p0, p1 } = opts;
  const ratio = cacheSpacing / grid.spacing;
  const cn = Math.ceil((grid.size - 1) / ratio) + 2;
  const cache = new Float64Array(cn * cn * NF);
  const F = new Float64Array(NF);
  for (let j = 0; j < cn; j++) {
    for (let i = 0; i < cn; i++) {
      L.macro(grid.origin + i * cacheSpacing, grid.origin + j * cacheSpacing, cacheSpacing, F);
      cache.set(F, (j * cn + i) * NF);
    }
    if ((j & 31) === 0) yield { progress: p0 + (p1 - p0) * 0.3 * (j / cn), label };
  }
  if (!gullyPerSample && cacheSpacing < 30) {
    // Gullies are fine enough to need their own evaluation at the cache's resolution.
    for (let k = 0; k < cn * cn; k++) {
      const i = k % cn, j = (k / cn) | 0;
      cache[k * NF + F_G] = L.gully(grid.origin + i * cacheSpacing, grid.origin + j * cacheSpacing, cacheSpacing);
    }
  }
  const n = grid.size;
  const m = {};
  for (let j = 0; j < n; j++) {
    const z = grid.origin + j * grid.spacing;
    const cj = Math.floor(j / ratio), tz = j / ratio - cj;
    for (let i = 0; i < n; i++) {
      const x = grid.origin + i * grid.spacing;
      if (skip && skip.contains(x, z)) continue;
      const ci = Math.floor(i / ratio), tx = i / ratio - ci;
      const k00 = (cj * cn + ci) * NF, k10 = k00 + NF, k01 = k00 + cn * NF, k11 = k01 + NF;
      const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
      for (let f = 0; f < NF; f++) F[f] = cache[k00 + f] * w00 + cache[k10 + f] * w10 + cache[k01 + f] * w01 + cache[k11 + f] * w11;
      if (gullyPerSample) F[F_G] = L.gully(x, z, grid.spacing);
      const k = j * n + i;
      grid.data[k] = L.shape(x, z, F, detail, masks ? m : null);
      if (masks) {
        masks.dune[k] = Math.round(clamp(m.dune, 0, 1) * 255);
        masks.playa[k] = Math.round(clamp(m.playa, 0, 1) * 255);
      }
    }
    if ((j & 31) === 0) yield { progress: p0 + (p1 - p0) * (0.3 + 0.7 * (j / n)), label };
  }
}

// ---------- Road profile ----------

function smoothArray(a, radius, passes, closed) {
  const n = a.length;
  let src = Float64Array.from(a);
  let dst = new Float64Array(n);
  const idx = (i) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[idx(i)];
    for (let i = 0; i < n; i++) {
      dst[i] = sum / (2 * radius + 1);
      sum += src[idx(i + radius + 1)] - src[idx(i - radius)];
    }
    [src, dst] = [dst, src];
  }
  return src;
}

function buildProfile(route, stage, nearGrid) {
  const n = route.count;
  const nat = new Float64Array(n);
  for (let i = 0; i < n; i++) nat[i] = nearGrid.sample(route.xs[i], route.zs[i]);
  let prof = smoothArray(nat, Math.round(28 / route.step), 3, route.closed);

  const at = ([ci, off]) => route.wrapS(route.sAtControl(ci) + off);
  const fwd = (a, b) => route.wrapS(b - a);  // distance going forward from a to b

  for (const e of stage.profile) {
    if (e.type === 'level') {
      const s0 = at(e.from), s1 = at(e.to);
      const span = fwd(s0, s1);
      const h0 = prof[Math.round(s0 / route.step) % n], h1 = prof[Math.round(s1 / route.step) % n];
      const bIn = e.blendIn ?? e.blend, bOut = e.blendOut ?? e.blend;
      const out = Float64Array.from(prof);
      for (let i = 0; i < n; i++) {
        const s = i * route.step;
        const u = fwd(s0, s);
        const before = fwd(s, s0);
        let w, t;
        if (u <= span) { w = 1; t = u / span; }
        else {
          const after = u - span;
          if (after < before) { w = 1 - smoothstep(0, bOut, after); t = 1; }
          else { w = 1 - smoothstep(0, bIn, before); t = 0; }
        }
        if (w <= 0) continue;
        let target;
        if (e.h === 'bridge') target = lerp(h0, h1, t);
        else if (e.h === 'water') target = stage.oasis.level - 0.45;
        else target = e.h;
        out[i] = lerp(prof[i], target, w);
      }
      prof = out;
    } else if (e.type === 'kicker') {
      const s0 = at(e.at);
      for (let i = 0; i < n; i++) {
        let d = fwd(s0, i * route.step);
        if (d > route.length / 2) d -= route.length;
        // Concave ramp up to the lip, then a smooth fall-away on the far side.
        if (d >= -e.up && d <= 0) prof[i] += e.height * Math.pow((d + e.up) / e.up, 2);
        else if (d > 0 && d <= e.down) { const u = d / e.down; prof[i] += e.height * (1 - u * u * (3 - 2 * u)); }
      }
    } else if (e.type === 'jump') {
      // Tabletop: a take-off face that steepens up to the lip, a flat top, then
      // a long landing slope down the far side.
      const s0 = at(e.at);
      const top = e.top ?? 0, pw = e.curve ?? 1.8;
      for (let i = 0; i < n; i++) {
        let d = fwd(s0, i * route.step);
        if (d > route.length / 2) d -= route.length;
        if (d >= -e.up && d <= 0) prof[i] += e.height * Math.pow((d + e.up) / e.up, pw);
        else if (d > 0 && d <= top) prof[i] += e.height;
        else if (d > top && d <= top + e.down) { const u = (d - top) / e.down; prof[i] += e.height * (1 - u * u * (3 - 2 * u)); }
      }
    } else if (e.type === 'whoops') {
      const s0 = at(e.from), s1 = at(e.to);
      const span = fwd(s0, s1);
      for (let i = 0; i < n; i++) {
        const u = fwd(s0, i * route.step);
        if (u > span) continue;
        const win = smoothstep(0, e.wavelength, u) * smoothstep(0, e.wavelength, span - u);
        prof[i] += e.amp * win * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / e.wavelength));
      }
    }
  }
  return smoothArray(prof, Math.round(1.5 / route.step), 1, route.closed);
}

// ---------- Nearest-route field (dead-reckoning distance transform) ----------

function routeField(route, spec) {
  const n = spec.size;
  const idx = new Int32Array(n * n).fill(-1);
  const dist = new Float32Array(n * n).fill(1e12);
  const X = route.xs, Z = route.zs;
  const o = spec.origin, sp = spec.spacing;

  for (let r = 0; r < route.count; r++) {
    const gi = Math.floor((X[r] - o) / sp), gj = Math.floor((Z[r] - o) / sp);
    for (let j = gj - 1; j <= gj + 2; j++) {
      if (j < 0 || j >= n) continue;
      for (let i = gi - 1; i <= gi + 2; i++) {
        if (i < 0 || i >= n) continue;
        const k = j * n + i;
        const dx = o + i * sp - X[r], dz = o + j * sp - Z[r];
        const d = dx * dx + dz * dz;
        if (d < dist[k]) { dist[k] = d; idx[k] = r; }
      }
    }
  }

  // Propagate nearest-seed indices: forward then backward raster passes.
  const relax = (k, px, pz, nk) => {
    const r = idx[nk];
    if (r < 0) return;
    const dx = px - X[r], dz = pz - Z[r];
    const d = dx * dx + dz * dz;
    if (d < dist[k]) { dist[k] = d; idx[k] = r; }
  };
  for (let j = 0; j < n; j++) {
    const pz = o + j * sp;
    for (let i = 0; i < n; i++) {
      const k = j * n + i, px = o + i * sp;
      if (i > 0) relax(k, px, pz, k - 1);
      if (j > 0) {
        relax(k, px, pz, k - n);
        if (i > 0) relax(k, px, pz, k - n - 1);
        if (i < n - 1) relax(k, px, pz, k - n + 1);
      }
    }
    for (let i = n - 2; i >= 0; i--) relax(j * n + i, o + i * sp, pz, j * n + i + 1);
  }
  for (let j = n - 1; j >= 0; j--) {
    const pz = o + j * sp;
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i, px = o + i * sp;
      if (i < n - 1) relax(k, px, pz, k + 1);
      if (j < n - 1) {
        relax(k, px, pz, k + n);
        if (i < n - 1) relax(k, px, pz, k + n + 1);
        if (i > 0) relax(k, px, pz, k + n - 1);
      }
    }
    for (let i = 1; i < n; i++) relax(j * n + i, o + i * sp, pz, j * n + i - 1);
  }
  return { idx, dist };
}

const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
};
const smax = (a, b, k) => -smin(-a, -b, k);

// ---------- Main entry ----------

// A generator so the browser can spread the work over frames and show progress.
// Yields { progress, label }; returns the finished world data.
export function* generateWorld(stage) {
  const L = makeLandscape(stage);
  const route = new Route(stage.route, { closed: true, step: 0.5, attrs: ['w', 'f', 'cut', 'fill'] });
  const near = new Grid(NEAR), mid = new Grid(MID), far = new Grid(FAR);
  const n = NEAR.size;
  const duneMask = new Uint8Array(n * n);
  const playaMask = new Uint8Array(n * n);

  yield* fillGrid(L, far, 128, { label: 'Raising mountains', p0: 0, p1: 0.06 });
  yield* fillGrid(L, mid, 32, { gullyPerSample: true, skip: new Grid({ size: 2033, spacing: 1, origin: -1016 }), label: 'Carving mesas', p0: 0.06, p1: 0.22 });
  yield* fillGrid(L, near, 4, { detail: true, masks: { dune: duneMask, playa: playaMask }, label: 'Blowing dunes', p0: 0.22, p1: 0.62 });

  // Road: height profile, then cut it into the ground.
  yield { progress: 0.65, label: 'Grading the road' };
  const profile = buildProfile(route, stage, near);
  const field = routeField(route, NEAR);
  yield { progress: 0.75, label: 'Grading the road' };

  const splat = new Uint8Array(n * n * 4);
  const nEdge = L.noise.nDet;
  const X = route.xs, Z = route.zs, TX = route.tx, TZ = route.tz;
  const A = route.attr;
  const BAND2 = 90 * 90;
  for (let j = 0; j < n; j++) {
    const z = NEAR.origin + j;
    for (let i = 0; i < n; i++) {
      const x = NEAR.origin + i;
      const k = j * n + i;
      const ri = field.idx[k];
      let road = 0, lat = 0;
      if (ri >= 0 && field.dist[k] < BAND2) {
        // Refine against the two neighbouring segments.
        let best = Math.sqrt(field.dist[k]), bi = ri, bt = 0;
        for (let a = ri - 1; a <= ri; a++) {
          const ia = route._wrap(a), ib = route._wrap(a + 1);
          const vx = X[ib] - X[ia], vz = Z[ib] - Z[ia];
          const l2 = vx * vx + vz * vz || 1;
          const t = clamp(((x - X[ia]) * vx + (z - Z[ia]) * vz) / l2, 0, 1);
          const ex = x - X[ia] - vx * t, ez = z - Z[ia] - vz * t;
          const d = Math.sqrt(ex * ex + ez * ez);
          if (d <= best) { best = d; bi = ia; bt = t; }
        }
        const d = best;
        const ib = route._wrap(bi + 1);
        const L2 = (arr) => arr[bi] + (arr[ib] - arr[bi]) * bt;
        const rh = L2(profile);
        const cx = X[bi] + (X[ib] - X[bi]) * bt, cz = Z[bi] + (Z[ib] - Z[bi]) * bt;
        const side = Math.sign((x - cx) * TZ[bi] - (z - cz) * TX[bi]) || 1;
        lat = side * d;
        const edgeN = fbm(nEdge, x / 18, z / 18, 2);
        const hw = L2(A.w) + 0.5 * edgeN;
        const fl = L2(A.f) + 1.5 * edgeN;
        const cs = L2(A.cut) * (1 + 0.25 * nEdge(x / 60 + 3, z / 60));
        const fs = L2(A.fill);
        const e = Math.max(0, d - fl);
        // Cut banks: gentle talus apron, then the wall.
        const eT = cs > 1.8 ? 6 : 0;
        const hiEnv = rh + 0.25 + 0.55 * Math.min(e, eT) + cs * Math.max(0, e - eT);
        const loEnv = rh - 0.1 - e * fs;
        let h = smin(smax(near.data[k], loEnv, 1.2), hiEnv, 1.5);
        // Road surface: slight crown and two worn wheel tracks. The ruts
        // themselves are painted by the terrain shader: narrow grooves on a
        // 1 m grid would come out as random bumps that shake the suspension.
        const u = lat / Math.max(2.5, hw);
        const crown = 0.07 * (1 - u * u);
        let ruts = 0;
        for (const c of [-1.55, 1.55]) ruts += Math.exp(-((lat - c) * (lat - c)) / 0.5);
        const surf = rh + crown - 0.025 * ruts;
        h = lerp(h, surf, 1 - smoothstep(hw - 0.6, hw + 1.0, d));
        near.data[k] = h;
        road = 1 - smoothstep(hw - 0.3, hw + 1.8 + 1.2 * edgeN, d);
      }
      const q = k * 4;
      splat[q] = Math.round(road * 255);
      splat[q + 1] = Math.round(clamp(lat / 16 + 0.5, 0, 1) * 255);
      splat[q + 2] = duneMask[k];
      splat[q + 3] = playaMask[k];
    }
    if ((j & 31) === 0) yield { progress: 0.75 + 0.17 * (j / n), label: 'Grading the road' };
  }

  // Keep the coarse grids consistent with the carved near grid where they overlap.
  for (const grid of [mid, far]) {
    const g = grid.size;
    for (let j = 0; j < g; j++) {
      const z = grid.origin + j * grid.spacing;
      if (z < NEAR.origin || z > near.extent) continue;
      for (let i = 0; i < g; i++) {
        const x = grid.origin + i * grid.spacing;
        if (x < NEAR.origin || x > near.extent) continue;
        grid.data[j * g + i] = near.sample(x, z);
      }
    }
  }

  yield { progress: 0.93, label: 'Planting cacti' };
  const scatter = makeScatter(stage, near, splat, field);

  return { route, profile, near, mid, far, splat, scatter, roadDist: field.dist };
}

// ---------- Scatter: rocks, cacti, bushes ----------

function slopeAt(grid, x, z) {
  const e = 1.5;
  const dx = grid.sample(x + e, z) - grid.sample(x - e, z);
  const dz = grid.sample(x, z + e) - grid.sample(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

function makeScatter(stage, near, splat, field) {
  const r = rng(stage.seed * 7 + 3);
  const n = near.size;
  const cell = (x, z) => clamp(Math.round(z - near.origin), 0, n - 1) * n + clamp(Math.round(x - near.origin), 0, n - 1);
  const maskAt = (x, z, c) => splat[cell(x, z) * 4 + c] / 255;
  const roadDist = (x, z) => Math.sqrt(field.dist[cell(x, z)]);
  const oasis = stage.oasis;
  const out = { boulders: [], rocks: [], cacti: [], bushes: [], grass: [], palms: [], deadTrees: [] };
  // Under (or right at the edge of) the oasis water.
  const wet = (x, z) => {
    const ox = x - oasis.x, oz = z - oasis.z;
    return ox * ox + oz * oz < (oasis.r * 1.8) ** 2 && near.sample(x, z) < oasis.level + 0.35;
  };
  const lim = PLAY_RADIUS + 60;
  const inside = (x, z) => x * x + z * z < (PLAY_RADIUS + 120) * (PLAY_RADIUS + 120);

  const scan = (step, fn) => {
    for (let z = -lim; z < lim; z += step) {
      for (let x = -lim; x < lim; x += step) {
        const px = x + r() * step, pz = z + r() * step;
        if (inside(px, pz)) fn(px, pz);
      }
    }
  };

  // Boulders gather at the foot of cliffs; a few lie out on the plain.
  // Stride 8: x, y, z, size, rotY, tiltA, tiltB, variant
  // Height above the lowest ground nearby: small at the foot of a slope, large on a rim.
  const aboveLow = (x, z, h) => {
    let lo = h;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      lo = Math.min(lo, near.sample(x + Math.cos(a) * 14, z + Math.sin(a) * 14));
    }
    return h - lo;
  };
  scan(9, (x, z) => {
    const s = slopeAt(near, x, z);
    if (roadDist(x, z) < 9 || maskAt(x, z, 3) > 0.3 || wet(x, z)) return;
    if (aboveLow(x, z, near.sample(x, z)) > (s > 0.25 ? 3.5 : 1.5)) return;
    const cliffFoot = s > 0.25 && s < 1.1;
    if (r() > (cliffFoot ? 0.55 : s < 0.25 ? 0.02 : 0)) return;
    const size = 0.6 + Math.pow(r(), 2.2) * (cliffFoot ? 4.2 : 1.8);
    out.boulders.push(x, near.sample(x, z), z, size, r() * Math.PI * 2, r(), r(), (r() * 4) | 0);
  });

  // Small scattered stones: visual only. Same stride.
  scan(5, (x, z) => {
    if (roadDist(x, z) < 5.5 || maskAt(x, z, 3) > 0.5 || maskAt(x, z, 2) > 0.5 || wet(x, z)) return;
    if (r() > 0.28) return;
    out.rocks.push(x, near.sample(x, z), z, 0.12 + Math.pow(r(), 2) * 0.45, r() * 6.28, r(), r(), (r() * 4) | 0);
  });

  // Saguaro cacti on gentle, stable ground. Stride 6: x, y, z, scale, rotY, variant
  scan(38, (x, z) => {
    if (slopeAt(near, x, z) > 0.22 || roadDist(x, z) < 8 || maskAt(x, z, 3) > 0.1 || maskAt(x, z, 2) > 0.35) return;
    const ox = x - oasis.x, oz = z - oasis.z;
    if (ox * ox + oz * oz < (oasis.r * 1.6) ** 2 || near.sample(x, z) > 24 || r() > 0.55) return;
    out.cacti.push(x, near.sample(x, z), z, 0.75 + r() * 0.55, r() * 6.28, (r() * 5) | 0);
  });

  // Desert scrub everywhere it can grow.
  scan(7, (x, z) => {
    if (slopeAt(near, x, z) > 0.5 || roadDist(x, z) < 6 || maskAt(x, z, 3) > 0.4 || wet(x, z)) return;
    if (r() > 0.42 * (1 - 0.85 * maskAt(x, z, 2))) return;
    out.bushes.push(x, near.sample(x, z), z, 0.5 + Math.pow(r(), 1.6) * 1.1, r() * 6.28, (r() * 4) | 0);
  });

  // Dry grass tufts, densest along the road verges.
  scan(3.2, (x, z) => {
    const rd = roadDist(x, z);
    if (rd < 5 || slopeAt(near, x, z) > 0.45 || maskAt(x, z, 3) > 0.25 || wet(x, z)) return;
    if (r() > (rd < 18 ? 0.5 : 0.16) * (1 - 0.7 * maskAt(x, z, 2))) return;
    out.grass.push(x, near.sample(x, z), z, 0.6 + r() * 0.7, r() * 6.28, (r() * 3) | 0);
  });

  // Palms ring the oasis.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + r() * 0.3;
    const d = oasis.r * (0.95 + r() * 0.55);
    const x = oasis.x + Math.cos(a) * d, z = oasis.z + Math.sin(a) * d;
    if (roadDist(x, z) < 8 || near.sample(x, z) < oasis.level + 0.3) continue;
    out.palms.push(x, near.sample(x, z), z, 0.85 + r() * 0.4, r() * 6.28, r());
  }

  // A few dead trees for character.
  scan(120, (x, z) => {
    if (r() > 0.35) return;
    if (slopeAt(near, x, z) > 0.2 || roadDist(x, z) < 10 || maskAt(x, z, 3) > 0.2 || maskAt(x, z, 2) > 0.3 || wet(x, z)) return;
    out.deadTrees.push(x, near.sample(x, z), z, 0.8 + r() * 0.5, r() * 6.28, (r() * 3) | 0);
  });

  for (const key of Object.keys(out)) out[key] = Float32Array.from(out[key]);
  return out;
}

// Convenience: run the generator to completion (Node tools, tests, workers).
export function generateWorldSync(stage, onProgress) {
  const it = generateWorld(stage);
  for (;;) {
    const { value, done } = it.next();
    if (done) return value;
    onProgress?.(value);
  }
}
