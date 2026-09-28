// Deterministic noise for world generation and procedural textures.
// Pure JS with no three.js dependency, so it also runs under Node for tooling.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash to [0, 1).
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float64Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 0, 1, 0, -1,
  0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071,
]);

// 2D simplex noise in about [-1, 1].
export function simplex2(seed) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const pg = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    pg[i] = (perm[i] % 12) * 2;
  }
  return function noise(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pg[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = pg[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pg[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
    }
    return 70 * n;
  };
}

// Fractal sum of a noise function. Rotates each octave a little to hide grid alignment.
export function fbm(noise, x, y, octaves, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    norm += amp;
    amp *= gain;
    const nx = (x * 0.8 - y * 0.6) * lacunarity + 17.3;
    y = (x * 0.6 + y * 0.8) * lacunarity - 9.1;
    x = nx;
  }
  return sum / norm;
}

// Ridged multifractal: sharp crests, used for eroded gullies and mountain ridges.
export function ridged(noise, x, y, octaves, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x, y));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    amp *= gain;
    const nx = (x * 0.8 - y * 0.6) * lacunarity + 5.7;
    y = (x * 0.6 + y * 0.8) * lacunarity + 11.3;
    x = nx;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------- Tileable noise for textures ----------

// Periodic value noise: lattice wraps every `period` cells, so textures tile.
export function periodicValue(seed) {
  return (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const m = (v) => ((v % period) + period) % period;
    const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
    const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
  };
}

export function periodicFbm(noise, x, y, period, octaves, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, period * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

// Periodic Worley (cellular) noise. Returns [F1, F2, cellRandom].
export function periodicWorley(seed) {
  const out = [0, 0, 0];
  return (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy;
        const wx = ((cx % period) + period) % period;
        const wy = ((cy % period) + period) % period;
        const px = cx + hash2(wx, wy, seed);
        const py = cy + hash2(wx, wy, seed + 1);
        const d = Math.hypot(px - x, py - y);
        if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 2); }
        else if (d < f2) f2 = d;
      }
    }
    out[0] = f1; out[1] = f2; out[2] = id;
    return out;
  };
}
