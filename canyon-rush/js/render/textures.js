// Procedural textures generated at load time, so the game ships no image files.
import * as THREE from 'three';
import { periodicValue, periodicFbm, periodicWorley, rng } from '../noise.js';

function dataTexture(data, size, { repeat = true, srgb = false, mipmaps = true } = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mipmaps;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Stretch a float channel to the full 0..255 range.
function normalizeInto(out, src, channel) {
  let lo = Infinity, hi = -Infinity;
  for (const v of src) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = 255 / (hi - lo || 1);
  for (let i = 0; i < src.length; i++) out[i * 4 + channel] = Math.round((src[i] - lo) * k);
}

// Four independent tileable noise channels:
//  R: smooth fbm, G: ridged, B: fine grain, A: broad fbm (different seed)
export function makeNoiseTexture(size = 256) {
  const n1 = periodicValue(11), n2 = periodicValue(23), n3 = periodicValue(37), n4 = periodicValue(51);
  const N = size * size;
  const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N), a = new Float32Array(N);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      r[i] = periodicFbm(n1, u * 8, v * 8, 8, 6, 0.5);
      g[i] = 1 - Math.abs(periodicFbm(n2, u * 8, v * 8, 8, 5, 0.55));
      g[i] = g[i] * g[i];
      b[i] = periodicFbm(n3, u * 64, v * 64, 64, 2, 0.5);
      a[i] = periodicFbm(n4, u * 4, v * 4, 4, 6, 0.55);
    }
  }
  const out = new Uint8Array(N * 4);
  normalizeInto(out, r, 0);
  normalizeInto(out, g, 1);
  normalizeInto(out, b, 2);
  normalizeInto(out, a, 3);
  return dataTexture(out, size);
}

// Cellular (Worley) channels, tileable:
//  R: F1 distance, G: F2 - F1 (cell edges / cracks), B: random value per cell, A: F1 at half the cell count
export function makeCellTexture(size = 256) {
  const w1 = periodicWorley(71), w2 = periodicWorley(89);
  const N = size * size;
  const out = new Uint8Array(N * 4);
  const cells = 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x / size) * cells, v = (y / size) * cells;
      const [f1, f2, id] = w1(u, v, cells);
      out[i] = Math.min(255, Math.round(f1 * 255));
      out[i + 1] = Math.min(255, Math.round((f2 - f1) * 255 * 1.4));
      out[i + 2] = Math.round(id * 255);
      const [g1] = w2((x / size) * 8, (y / size) * 8, 8);
      out[i + 3] = Math.min(255, Math.round(g1 * 255));
    }
  }
  return dataTexture(out, size);
}

// Soft puff sprite for dust and smoke (alpha in A, a little internal structure in RGB).
export function makePuffTexture(size = 128) {
  const n = periodicValue(5);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
      const d = Math.sqrt(u * u + v * v);
      const warp = periodicFbm(n, (x / size) * 4, (y / size) * 4, 4, 4, 0.55);
      const a = Math.max(0, 1 - d * (1.05 + 0.35 * warp));
      const alpha = Math.pow(a, 1.6) * (0.75 + 0.25 * (warp * 0.5 + 0.5));
      // Normal-ish shading hint in RGB: brighter toward the top-left (sun side is decided in the shader).
      out[i] = Math.round(128 + 127 * u * a);
      out[i + 1] = Math.round(128 - 127 * v * a);
      out[i + 2] = Math.round(255 * (0.6 + 0.4 * (warp * 0.5 + 0.5)));
      out[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  return dataTexture(out, size, { repeat: false });
}

// Canvas helper for textures that need drawing (text, shapes).
export function canvasTexture(w, h, draw, { srgb = true, repeat = false, mipmaps = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}

export { rng };
