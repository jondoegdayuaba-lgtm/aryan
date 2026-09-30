// Tileable procedural fallbacks for the Blender-baked detail textures.
import * as THREE from 'three';
import { makeRng } from './util.js';

function periodicNoise(size, period, rng) {
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(size * size);
  const s = period / size;
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = y * s, iy = Math.floor(fy), ty = sm(fy - iy);
    const y0 = iy % period, y1 = (iy + 1) % period;
    for (let x = 0; x < size; x++) {
      const fx = x * s, ix = Math.floor(fx), tx = sm(fx - ix);
      const x0 = ix % period, x1 = (ix + 1) % period;
      const a = lat[y0 * period + x0], b = lat[y0 * period + x1];
      const c = lat[y1 * period + x0], d = lat[y1 * period + x1];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fbmHeight(size, periods, gains, seed, ridged = false) {
  const rng = makeRng(seed);
  const h = new Float32Array(size * size);
  periods.forEach((p, k) => {
    const n = periodicNoise(size, p, rng);
    for (let i = 0; i < h.length; i++) {
      const v = ridged ? 1 - Math.abs(n[i] * 2 - 1) : n[i];
      h[i] += v * gains[k];
    }
  });
  return h;
}

function heightToNormalTexture(h, size, strength) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function makeTexture(data, size, srgb = false) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Soft grainy snow normal map (tileable). */
export function makeSnowNormalTexture(size = 256) {
  const h = fbmHeight(size, [4, 8, 16, 32, 64], [1, 0.55, 0.3, 0.16, 0.08], 7);
  return makeTexture(heightToNormalTexture(h, size, 2.2), size);
}

/** Craggy rock normal + luminance (tileable). */
export function makeRockTextures(size = 256) {
  const h = fbmHeight(size, [4, 8, 16, 32, 64], [1, 0.7, 0.45, 0.25, 0.12], 19, true);
  const normal = makeTexture(heightToNormalTexture(h, size, 4.5), size);
  const col = new Uint8Array(size * size * 4);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < h.length; i++) { mn = Math.min(mn, h[i]); mx = Math.max(mx, h[i]); }
  for (let i = 0; i < h.length; i++) {
    const v = (h[i] - mn) / (mx - mn);
    const l = 0.55 + 0.6 * v;
    col[i * 4] = Math.min(255, 128 * l * 1.05);
    col[i * 4 + 1] = Math.min(255, 128 * l);
    col[i * 4 + 2] = Math.min(255, 128 * l * 0.95);
    col[i * 4 + 3] = 255;
  }
  return { normal, color: makeTexture(col, size, false) };
}
