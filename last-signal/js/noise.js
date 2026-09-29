// Seeded 2D simplex noise plus the fractal helpers the terrain and textures need.
import { rng } from './util.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

export function createNoise(seed = 1) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const gi = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; gi[i] = (perm[i] % 8) * 2; }

  // Simplex noise, roughly -1..1.
  function n2(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let a = 0.5 - x0 * x0 - y0 * y0;
    if (a > 0) { a *= a; const g = gi[ii + perm[jj]]; n += a * a * (GRAD[g] * x0 + GRAD[g + 1] * y0); }
    a = 0.5 - x1 * x1 - y1 * y1;
    if (a > 0) { a *= a; const g = gi[ii + i1 + perm[jj + j1]]; n += a * a * (GRAD[g] * x1 + GRAD[g + 1] * y1); }
    a = 0.5 - x2 * x2 - y2 * y2;
    if (a > 0) { a *= a; const g = gi[ii + 1 + perm[jj + 1]]; n += a * a * (GRAD[g] * x2 + GRAD[g + 1] * y2); }
    return 70 * n;
  }

  // Fractal Brownian motion, roughly -1..1.
  function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * n2(x, y);
      norm += amp;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
    }
    return sum / norm;
  }

  // Ridged multifractal, 0..1: sharp crests, good for mountains.
  function ridged(x, y, octaves = 5, lacunarity = 2.05, gain = 0.5) {
    let sum = 0, amp = 0.5, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let s = 1 - Math.abs(n2(x, y));
      s *= s;
      s *= weight;
      weight = Math.min(1, Math.max(0, s * 1.6));
      sum += s * amp;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
    }
    return sum;
  }

  return { n2, fbm, ridged };
}

// Tileable gradient noise for textures: the lattice wraps every `period` cells.
export function createTileNoise(seed = 1) {
  const r = rng(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const cell = (ix, iy) => perm[(perm[ix & 255] + iy) & 255];

  // x and y are in lattice cells; the pattern repeats every px cells across and py cells down.
  function noise(x, y, px, py = px) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
    const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
    const i00 = cell(x0, y0), i10 = cell(x1, y0), i01 = cell(x0, y1), i11 = cell(x1, y1);
    const n00 = gx[i00] * xf + gy[i00] * yf;
    const n10 = gx[i10] * (xf - 1) + gy[i10] * yf;
    const n01 = gx[i01] * xf + gy[i01] * (yf - 1);
    const n11 = gx[i11] * (xf - 1) + gy[i11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    const top = n00 + (n10 - n00) * u;
    const bottom = n01 + (n11 - n01) * u;
    return top + (bottom - top) * v;
  }

  // u, v in 0..1 across the texture; returns roughly -1..1. cellsY defaults to cellsX;
  // use different counts to stretch the pattern (wood grain, grass streaks).
  function fbm(u, v, cellsX = 4, octaves = 5, gain = 0.5, cellsY = cellsX) {
    let sum = 0, amp = 1, norm = 0, cx = cellsX, cy = cellsY;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(u * cx, v * cy, cx, cy);
      norm += amp;
      amp *= gain;
      cx *= 2;
      cy *= 2;
    }
    return (sum / norm) * 1.6;
  }

  return { noise, fbm };
}
