// Every texture is drawn at runtime, so the game ships no image files. Ground and rock layers are
// tileable and come with normal maps built from their own height; foliage is hand-drawn on canvases.
import * as THREE from 'three';
import { createTileNoise } from './noise.js';
import { rng, clamp, lerp, saturate, smoothstep } from './util.js';
import { patchMaterial } from './atmosphere.js';

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const gray = (v, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

// Fills a canvas per pixel; fn(u, v, out) writes out.r/g/b (0..255) and out.h (0..1).
function fillPixels(colorCtx, heightCtx, size, fn) {
  const cImg = colorCtx.createImageData(size, size);
  const hImg = heightCtx.createImageData(size, size);
  const out = { r: 0, g: 0, b: 0, h: 0.5 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x / size, y / size, out);
      const i = (y * size + x) * 4;
      cImg.data[i] = out.r; cImg.data[i + 1] = out.g; cImg.data[i + 2] = out.b; cImg.data[i + 3] = 255;
      const hv = clamp(out.h, 0, 1) * 255;
      hImg.data[i] = hv; hImg.data[i + 1] = hv; hImg.data[i + 2] = hv; hImg.data[i + 3] = 255;
    }
  }
  colorCtx.putImageData(cImg, 0, 0);
  heightCtx.putImageData(hImg, 0, 0);
}

// Draws something that may straddle an edge again on the far side, so the tile stays seamless.
function wrapDraw(size, x, y, reach, draw) {
  for (let dx = -1; dx <= 1; dx++) {
    if ((dx < 0 && x > reach) || (dx > 0 && x < size - reach)) continue;
    for (let dy = -1; dy <= 1; dy++) {
      if ((dy < 0 && y > reach) || (dy > 0 && y < size - reach)) continue;
      draw(x + dx * size, y + dy * size);
    }
  }
}

// Packs a colour canvas and a height canvas into albedo(+height in alpha) and normal(+roughness, ao) bytes.
function packLayer(colorCtx, heightCtx, size, { strength = 5, rough = 0.9, roughVar = 0.1, standard = false } = {}) {
  const c = colorCtx.getImageData(0, 0, size, size).data;
  const h = heightCtx.getImageData(0, 0, size, size).data;
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const H = (x, y) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      albedo[i] = c[i]; albedo[i + 1] = c[i + 1]; albedo[i + 2] = c[i + 2]; albedo[i + 3] = standard ? 255 : h[i];
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      normal[i] = Math.round((-dx * il * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((-dy * il * 0.5 + 0.5) * 255);
      const hv = h[i] / 255;
      // Terrain packs roughness in blue and rebuilds z in the shader; ordinary materials need z there.
      normal[i + 2] = standard ? Math.round((il * 0.5 + 0.5) * 255) : Math.round(clamp(rough + (0.5 - hv) * roughVar, 0.05, 1) * 255);
      // Crevices are darker: a cheap ambient-occlusion term from the height itself.
      const local = (H(x - 3, y) + H(x + 3, y) + H(x, y - 3) + H(x, y + 3)) / 4;
      normal[i + 3] = Math.round(clamp(0.78 + (hv - local) * 2.4 + hv * 0.22, 0.35, 1) * 255);
    }
  }
  return { albedo, normal };
}

function arrayTexture(layers, size, srgb) {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((l, i) => data.set(l, i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, layers.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------- Terrain layers: 0 grass, 1 forest floor, 2 dirt, 3 gravel, 4 rock, 5 snow ----------
function paintGrass(ac, hc, size) {
  const tn = createTileNoise(11), r = rng(11);
  const dark = hex(0x364f1f), mid = hex(0x587430), light = hex(0x7d9646), dry = hex(0x8f8650);
  fillPixels(ac, hc, size, (u, v, o) => {
    const macro = tn.fbm(u, v, 3, 4), m = tn.fbm(u + 0.31, v + 0.17, 9, 4), s = tn.fbm(u, v, 40, 2, 0.5, 8);
    const t = saturate(0.5 + 0.55 * m + 0.2 * macro);
    let c = mixRGB(dark, mid, t);
    c = mixRGB(c, light, saturate(s * 0.9 + 0.1));
    c = mixRGB(c, dry, saturate(macro * 0.8 - 0.1) * 0.55);
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.5 + 0.28 * s + 0.16 * m;
  });
  for (let i = 0; i < 9000; i++) {
    const x = r() * size, y = r() * size;
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4, len = 3 + r() * 6, w = 0.9 + r() * 1.0;
    const tint = mixRGB(mixRGB(dark, light, r()), dry, r() * 0.35);
    wrapDraw(size, x, y, 16, (px, py) => {
      ac.strokeStyle = rgb(tint, 0.75);
      ac.lineWidth = w;
      ac.beginPath(); ac.moveTo(px, py); ac.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + (r() - 0.5) * 3, py + Math.sin(a) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len); ac.stroke();
      hc.strokeStyle = gray(0.72, 0.6);
      hc.lineWidth = w;
      hc.beginPath(); hc.moveTo(px, py); hc.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); hc.stroke();
    });
  }
}

function paintForest(ac, hc, size) {
  const tn = createTileNoise(23), r = rng(23);
  const humus = hex(0x262619), litter = hex(0x40382a), moss = hex(0x39502a);
  fillPixels(ac, hc, size, (u, v, o) => {
    const macro = tn.fbm(u, v, 4, 4), m = tn.fbm(u + 0.2, v + 0.6, 14, 3);
    let c = mixRGB(humus, litter, saturate(0.5 + 0.6 * m));
    c = mixRGB(c, moss, smoothstep(0.15, 0.5, macro) * 0.75);
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.45 + 0.25 * m;
  });
  const needle = [hex(0x5e4a30), hex(0x54432a), hex(0x6f5836), hex(0x3c3020), hex(0x7a6440)];
  for (let i = 0; i < 16000; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI * 2, len = 6 + r() * 9;
    const col = needle[(r() * needle.length) | 0];
    wrapDraw(size, x, y, 16, (px, py) => {
      ac.strokeStyle = rgb(col, 0.85); ac.lineWidth = 1 + r() * 0.8;
      ac.beginPath(); ac.moveTo(px, py); ac.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ac.stroke();
      hc.strokeStyle = gray(0.62, 0.7); hc.lineWidth = 1.2;
      hc.beginPath(); hc.moveTo(px, py); hc.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); hc.stroke();
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI * 2, len = 24 + r() * 50;
    wrapDraw(size, x, y, 60, (px, py) => {
      ac.strokeStyle = rgb(hex(0x2a2018), 0.9); ac.lineWidth = 1.6 + r() * 1.6;
      ac.beginPath(); ac.moveTo(px, py); ac.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ac.stroke();
      hc.strokeStyle = gray(0.85, 0.9); hc.lineWidth = 2.4;
      hc.beginPath(); hc.moveTo(px, py); hc.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); hc.stroke();
    });
  }
}

function paintDirt(ac, hc, size) {
  const tn = createTileNoise(37), r = rng(37);
  const a0 = hex(0x6b5340), a1 = hex(0x8e7457);
  fillPixels(ac, hc, size, (u, v, o) => {
    const m = tn.fbm(u, v, 6, 5), f = tn.fbm(u, v, 70, 2);
    const c = mixRGB(a0, a1, saturate(0.5 + 0.7 * m + 0.2 * f));
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.5 + 0.2 * m + 0.12 * f;
  });
  for (let i = 0; i < 900; i++) {
    const x = r() * size, y = r() * size, rad = 1.5 + r() * 4.5, k = r();
    const col = k < 0.6 ? mixRGB(hex(0x9b8f7e), hex(0x7a6f60), r()) : mixRGB(hex(0xb0a48f), hex(0x8a7d68), r());
    wrapDraw(size, x, y, rad + 2, (px, py) => {
      ac.fillStyle = rgb(col, 0.95);
      ac.beginPath(); ac.ellipse(px, py, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2); ac.fill();
      hc.fillStyle = gray(0.78, 0.9);
      hc.beginPath(); hc.ellipse(px, py, rad, rad * 0.8, 0, 0, Math.PI * 2); hc.fill();
    });
  }
}

function paintGravel(ac, hc, size) {
  const tn = createTileNoise(53), r = rng(53);
  const base = hex(0x9a8c73);
  fillPixels(ac, hc, size, (u, v, o) => {
    const m = tn.fbm(u, v, 8, 4);
    const c = mixRGB(hex(0x85795f), base, saturate(0.5 + 0.6 * m));
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.35 + 0.1 * m;
  });
  const stones = [hex(0xb4a993), hex(0x8f8a80), hex(0xa79a80), hex(0x6f6b64), hex(0xc3b9a3), hex(0x7d7568)];
  for (let i = 0; i < 2600; i++) {
    const x = r() * size, y = r() * size, rad = 3 + r() * 7, col = stones[(r() * stones.length) | 0];
    wrapDraw(size, x, y, rad + 2, (px, py) => {
      const g = ac.createRadialGradient(px - rad * 0.3, py - rad * 0.3, 0, px, py, rad);
      g.addColorStop(0, rgb(mixRGB(col, [255, 255, 255], 0.18))); g.addColorStop(1, rgb(mixRGB(col, [0, 0, 0], 0.35)));
      ac.fillStyle = g;
      ac.beginPath(); ac.ellipse(px, py, rad, rad * (0.65 + r() * 0.3), r() * 3, 0, Math.PI * 2); ac.fill();
      const hg = hc.createRadialGradient(px, py, 0, px, py, rad);
      hg.addColorStop(0, gray(0.95)); hg.addColorStop(1, gray(0.3));
      hc.fillStyle = hg;
      hc.beginPath(); hc.ellipse(px, py, rad, rad * 0.8, 0, 0, Math.PI * 2); hc.fill();
    });
  }
}

function paintRock(ac, hc, size) {
  const tn = createTileNoise(71);
  const lo = hex(0x4e4c4a), hi = hex(0x8f8a80), lichen = hex(0x8a9466);
  fillPixels(ac, hc, size, (u, v, o) => {
    const warp = tn.fbm(u + 0.13, v + 0.71, 3, 3) * 0.05;
    const tone = tn.fbm(u + warp, v + warp, 4, 5);
    const crackN = Math.abs(tn.fbm(u + warp * 2, v - warp, 5, 3));
    const crack = 1 - smoothstep(0.0, 0.07, crackN);
    const fine = tn.fbm(u, v, 48, 2);
    const strata = Math.sin((v * 12 + tone * 1.6) * Math.PI * 2) * 0.5 + 0.5;
    let c = mixRGB(lo, hi, saturate(0.5 + 0.65 * tone + 0.1 * fine));
    c = mixRGB(c, lichen, smoothstep(0.4, 0.75, tn.fbm(u + 0.4, v + 0.2, 9, 3)) * 0.35);
    const k = (1 - 0.6 * crack) * (0.93 + 0.07 * strata);
    o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
    o.h = 0.55 + 0.28 * tone + 0.08 * fine - 0.45 * crack + 0.04 * strata;
  });
}

function paintSnow(ac, hc, size) {
  const tn = createTileNoise(91);
  const white = hex(0xf2f5fa), shade = hex(0xc9d8ec);
  fillPixels(ac, hc, size, (u, v, o) => {
    const m = tn.fbm(u, v, 5, 5), f = tn.fbm(u, v, 60, 2);
    const c = mixRGB(shade, white, saturate(0.62 + 0.5 * m + 0.05 * f));
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.5 + 0.35 * m + 0.03 * f;
  });
}

const TERRAIN_LAYERS = [
  { paint: paintGrass, pack: { strength: 4, rough: 0.92 } },
  { paint: paintForest, pack: { strength: 5, rough: 0.95 } },
  { paint: paintDirt, pack: { strength: 5, rough: 0.93 } },
  { paint: paintGravel, pack: { strength: 9, rough: 0.85, roughVar: 0.25 } },
  { paint: paintRock, pack: { strength: 9, rough: 0.82, roughVar: 0.3 } },
  { paint: paintSnow, pack: { strength: 3, rough: 0.6, roughVar: 0.2 } },
];

export function makeTerrainTextures(anisotropy = 8, size = 512) {
  const albedo = [], normal = [];
  for (const layer of TERRAIN_LAYERS) {
    const [ac, actx] = makeCanvas(size), [hc, hctx] = makeCanvas(size);
    layer.paint(actx, hctx, size);
    const packed = packLayer(actx, hctx, size, layer.pack);
    albedo.push(packed.albedo);
    normal.push(packed.normal);
  }
  const a = arrayTexture(albedo, size, true), n = arrayTexture(normal, size, false);
  a.anisotropy = n.anisotropy = anisotropy;
  return { albedo: a, normal: n };
}

// ---------- Small utility textures ----------
function dataTexture(data, w, h, { srgb = false, wrap = true, mip = true } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = mip;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Four unrelated tileable noises in the four channels: macro colour variation, gusts and so on.
export function makeNoiseTexture(size = 256) {
  const tn = createTileNoise(5);
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = (y * size + x) * 4;
      d[i] = (0.5 + 0.5 * tn.fbm(u, v, 4, 5)) * 255;
      d[i + 1] = (0.5 + 0.5 * tn.fbm(u + 0.37, v + 0.11, 9, 4)) * 255;
      d[i + 2] = (0.5 + 0.5 * tn.fbm(u + 0.71, v + 0.53, 2, 4)) * 255;
      d[i + 3] = (0.5 + 0.5 * tn.fbm(u + 0.13, v + 0.87, 16, 3)) * 255;
    }
  }
  return dataTexture(d, size, size);
}

// A tileable ripple normal map for water (RGB = normal, unpacked in the shader).
export function makeWaterNormal(size = 512) {
  const tn = createTileNoise(131);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    h[y * size + x] = tn.fbm(u, v, 6, 5, 0.55) + 0.5 * tn.fbm(u + 0.3, v + 0.6, 24, 2);
  }
  const d = new Uint8Array(size * size * 4);
  const H = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 9, dy = (H(x, y + 1) - H(x, y - 1)) * 9;
    const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * size + x) * 4;
    d[i] = (-dx * il * 0.5 + 0.5) * 255; d[i + 1] = (-dy * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return dataTexture(d, size, size);
}

// ---------- Foliage and bark ----------
export function canvasTexture(canvas, { srgb = true, repeat = false, anisotropy = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  return t;
}

// A feathery conifer branch: a twig with side twigs and hundreds of needles, transparent around it.
export function makePineBranch(w = 256, h = 512) {
  const [c, g] = makeCanvas(w, h), r = rng(3);
  const cols = [hex(0x1c3a22), hex(0x24472a), hex(0x2f5a34), hex(0x3a6a3c), hex(0x1a301c)];
  const needles = (x0, y0, dirx, diry, len, count, thick) => {
    for (let i = 0; i < count; i++) {
      const t = (i + r() * 0.6) / count;
      const px = x0 + dirx * len * t, py = y0 + diry * len * t;
      const nl = lerp(w * 0.2, w * 0.05, t) * (0.7 + r() * 0.5);
      for (const side of [-1, 1]) {
        const a = Math.atan2(diry, dirx) + side * (0.85 + r() * 0.5);
        const col = cols[(r() * cols.length) | 0];
        g.strokeStyle = rgb(mixRGB(col, hex(0x6aa05a), r() * r() * 0.5));
        g.lineWidth = thick * (0.8 + r() * 0.5);
        g.beginPath(); g.moveTo(px, py);
        g.quadraticCurveTo(px + Math.cos(a) * nl * 0.6, py + Math.sin(a) * nl * 0.6 + nl * 0.1, px + Math.cos(a) * nl, py + Math.sin(a) * nl + nl * 0.22);
        g.stroke();
      }
    }
  };
  const twig = (x0, y0, dirx, diry, len, width) => {
    g.strokeStyle = rgb(hex(0x4a3524)); g.lineWidth = width;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + dirx * len, y0 + diry * len); g.stroke();
  };
  const cx = w / 2;
  // main twig, then side twigs that shorten toward the tip
  twig(cx, h - 4, 0, -1, h - 20, 3.4);
  needles(cx, h - 4, 0, -1, h - 20, 130, 1.9);
  for (let t = 0.1; t < 0.9; t += 0.075) {
    for (const side of [-1, 1]) {
      const len = lerp(w * 0.46, w * 0.1, t) * (0.85 + r() * 0.3);
      const a = -Math.PI / 2 + side * (0.95 + r() * 0.3);
      const y0 = h - 4 - (h - 20) * t, dx = Math.cos(a), dy = Math.sin(a);
      twig(cx, y0, dx, dy, len, 2.2);
      needles(cx, y0, dx, dy, len, 46, 1.7);
    }
  }
  return canvasTexture(c, { anisotropy: 8 });
}

// A puff of leaves for birch and aspen, in autumn colours.
export function makeLeafCluster(size = 256) {
  const [c, g] = makeCanvas(size), r = rng(9);
  const pal = [hex(0xe2b83c), hex(0xd99a28), hex(0xc9782a), hex(0xe9cf58), hex(0xb8ad3c), hex(0x9aa838)];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size * (0.4 - pass * 0.04);
      const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d * 0.92;
      const s = size * (0.05 + r() * 0.04), rot = r() * Math.PI;
      const col = mixRGB(pal[(r() * pal.length) | 0], [0, 0, 0], (2 - pass) * 0.14);
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = rgb(col);
      g.beginPath(); g.moveTo(0, -s); g.bezierCurveTo(s * 0.9, -s * 0.5, s * 0.8, s * 0.6, 0, s * 1.05); g.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.9, -s * 0.5, 0, -s); g.fill();
      g.strokeStyle = rgb(mixRGB(col, [0, 0, 0], 0.35), 0.7); g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -s * 0.9); g.lineTo(0, s); g.stroke();
      g.restore();
    }
  }
  return canvasTexture(c, { anisotropy: 4 });
}

// 2x2 atlas: green clump, dry clump, purple lupine, white daisies. Each tile is a tuft rooted at its bottom edge.
export function makeGrassAtlas(size = 512) {
  const [c, g] = makeCanvas(size), r = rng(19), s = size / 2;
  const blade = (ox, oy, x, h, lean, wid, base, tip) => {
    const bx = ox + x, by = oy + s - 1;
    const tx = bx + lean, ty = by - h;
    const grad = g.createLinearGradient(0, by, 0, ty);
    grad.addColorStop(0, rgb(base)); grad.addColorStop(1, rgb(tip));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(bx - wid, by);
    g.bezierCurveTo(bx - wid * 0.8 + lean * 0.1, by - h * 0.5, tx - lean * 0.15 - 0.6, ty + h * 0.32, tx, ty);
    g.bezierCurveTo(tx - lean * 0.05 + 0.6, ty + h * 0.32, bx + wid * 0.8 + lean * 0.5, by - h * 0.5, bx + wid, by);
    g.closePath(); g.fill();
  };
  const clump = (ox, oy, count, hMin, hMax, base, tip, dry) => {
    for (let i = 0; i < count; i++) {
      const x = s * (0.12 + 0.76 * r()), spread = (x - s / 2) / (s / 2);
      const h = lerp(hMin, hMax, r()) * s * (1 - Math.abs(spread) * 0.35);
      const tipCol = mixRGB(tip, dry, r() * 0.35);
      blade(ox, oy, x, h, spread * s * 0.16 + (r() - 0.5) * s * 0.22, s * (0.012 + r() * 0.01), mixRGB(base, [0, 0, 0], r() * 0.2), tipCol);
    }
  };
  clump(0, 0, 44, 0.4, 0.82, hex(0x2c4418), hex(0x7fa040), hex(0xb0a050));
  clump(s, 0, 36, 0.5, 0.92, hex(0x4a5a22), hex(0xb2a656), hex(0xd8c070));
  // lupine spikes
  clump(0, s, 22, 0.3, 0.55, hex(0x2c4418), hex(0x6f9a3a), hex(0x9aa848));
  for (let i = 0; i < 6; i++) {
    const x = s * (0.2 + 0.6 * r()), h = s * (0.55 + r() * 0.3), top = s + s - h, lean = (r() - 0.5) * s * 0.12;
    g.strokeStyle = rgb(hex(0x4a6a2c)); g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, s * 2 - 1); g.quadraticCurveTo(x + lean, s * 2 - h * 0.6, x + lean, top); g.stroke();
    for (let k = 0; k < 16; k++) {
      const t = k / 16, px = x + lean * (1 - t * 0.2) + (r() - 0.5) * 7, py = top + t * h * 0.42;
      g.fillStyle = rgb(mixRGB(hex(0x6a48c8), hex(0xb090ec), r()));
      g.beginPath(); g.ellipse(px, py, 4.5 * (1 - t * 0.45), 3.4, r() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  // daisies
  clump(s, s, 20, 0.28, 0.5, hex(0x2c4418), hex(0x6f9a3a), hex(0x9aa848));
  for (let i = 0; i < 7; i++) {
    const x = s + s * (0.16 + 0.68 * r()), h = s * (0.32 + r() * 0.34), top = s * 2 - h, lean = (r() - 0.5) * s * 0.1;
    g.strokeStyle = rgb(hex(0x4a6a2c)); g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(x, s * 2 - 1); g.quadraticCurveTo(x + lean, s * 2 - h * 0.5, x + lean, top); g.stroke();
    const yellow = r() < 0.4;
    const petals = yellow ? hex(0xf2c81e) : hex(0xf6f2e8);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      g.fillStyle = rgb(petals);
      g.beginPath(); g.ellipse(x + lean + Math.cos(a) * 7, top + Math.sin(a) * 7, 5.5, 2.6, a, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = rgb(yellow ? hex(0xb8740c) : hex(0xe8b020));
    g.beginPath(); g.arc(x + lean, top, 3.6, 0, Math.PI * 2); g.fill();
  }
  const t = canvasTexture(c, { anisotropy: 4 });
  return t;
}

// ---------- Bark ----------
export function makeBark(kind, size = 256) {
  const tn = createTileNoise(kind === 'birch' ? 201 : 211), r = rng(kind === 'birch' ? 5 : 6);
  const [ac, actx] = makeCanvas(size), [hc, hctx] = makeCanvas(size);
  if (kind === 'birch') {
    fillPixels(actx, hctx, size, (u, v, o) => {
      const m = tn.fbm(u, v, 3, 4, 0.5, 5), f = tn.fbm(u, v, 30, 2);
      const c = mixRGB(hex(0xd7d2c4), hex(0xf2eee2), saturate(0.5 + 0.6 * m));
      const dash = smoothstep(0.42, 0.55, tn.fbm(u + 0.2, v, 7, 4, 0.5, 44)) * smoothstep(0.1, 0.5, m + 0.5);
      const k = 1 - 0.86 * dash;
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k * (1 + 0.03 * f);
      o.h = 0.55 + 0.2 * m - 0.35 * dash;
    });
  } else {
    fillPixels(actx, hctx, size, (u, v, o) => {
      const m = tn.fbm(u, v, 9, 4, 0.5, 2), f = tn.fbm(u, v, 24, 3, 0.5, 5);
      const ridge = 1 - Math.abs(m);
      const c = mixRGB(hex(0x2b2118), hex(0x6d5641), saturate(ridge * ridge * 1.2 + 0.12 * f));
      o.r = c[0]; o.g = c[1]; o.b = c[2];
      o.h = 0.25 + 0.6 * ridge * ridge;
    });
  }
  const p = packLayer(actx, hctx, size, { strength: kind === 'birch' ? 3 : 6, rough: 0.9, standard: true });
  const map = dataTexture(p.albedo, size, size, { srgb: true });
  const normalMap = dataTexture(p.normal, size, size);
  map.anisotropy = 4;
  return { map, normalMap };
}

// A single rock material's textures (colour + normal), for boulders and cliffs made from meshes.
export function makeRockTextures(size = 512) {
  const [ac, actx] = makeCanvas(size), [hc, hctx] = makeCanvas(size);
  paintRock(actx, hctx, size);
  const p = packLayer(actx, hctx, size, { strength: 8, rough: 0.85, standard: true });
  const map = dataTexture(p.albedo, size, size, { srgb: true });
  const normalMap = dataTexture(p.normal, size, size);
  map.anisotropy = 4;
  return { map, normalMap };
}

// ---------- Man-made surfaces, keyed by the material names used in the Blender models ----------
function planks(ac, hc, size, tint, seed, plankH = 0.2) {
  const tn = createTileNoise(seed), r = rng(seed);
  const rows = Math.round(1 / plankH), a = mixRGB(tint, [0, 0, 0], 0.35), b = mixRGB(tint, [255, 255, 255], 0.12);
  const off = Array.from({ length: rows }, () => r());
  fillPixels(ac, hc, size, (u, v, o) => {
    const row = Math.floor(v * rows), fv = v * rows - row;
    const grain = tn.fbm((u + off[row]) % 1, v, 3, 3, 0.5, 60);
    const tone = tn.fbm(u + off[row], v, 5, 3);
    let c = mixRGB(a, b, saturate(0.5 + 0.55 * grain + 0.3 * tone));
    const seam = Math.min(fv, 1 - fv) < 0.035 ? 0.35 : 1;
    const end = Math.abs(((u + off[row]) % 0.5) - 0.0) < 0.004 ? 0.4 : 1;
    o.r = c[0] * seam * end; o.g = c[1] * seam * end; o.b = c[2] * seam * end;
    o.h = 0.55 + 0.25 * grain - (seam < 1 ? 0.3 : 0) - (end < 1 ? 0.2 : 0);
  });
}

function logs(ac, hc, size) {
  const tn = createTileNoise(301);
  fillPixels(ac, hc, size, (u, v, o) => {
    const round = Math.sin(v * Math.PI * 2 * 3) * 0.5 + 0.5;          // three logs per tile height
    const f = tn.fbm(u, v, 3, 4, 0.5, 40), bark = tn.fbm(u, v, 9, 3, 0.5, 60);
    const c = mixRGB(hex(0x3a281a), hex(0x7a5a3c), saturate(0.45 + 0.6 * bark + 0.25 * f));
    const k = 0.55 + 0.5 * Math.pow(round, 0.6);
    o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
    o.h = 0.35 + 0.45 * round + 0.2 * bark;
  });
}

function tin(ac, hc, size, rusty) {
  const tn = createTileNoise(rusty ? 311 : 312);
  fillPixels(ac, hc, size, (u, v, o) => {
    const rib = Math.sin(u * Math.PI * 2 * 4) * 0.5 + 0.5;
    const rust = smoothstep(0.35, 0.7, 0.5 + 0.7 * tn.fbm(u, v, 4, 5) + (rusty ? 0.25 : -0.1));
    const streak = tn.fbm(u, v, 40, 3, 0.5, 3);
    let c = mixRGB(hex(0x9aa0a4), hex(0x5c6266), 0.5 + 0.5 * streak);
    c = mixRGB(c, mixRGB(hex(0x8a4a22), hex(0x5a2c14), 0.5 + 0.5 * streak), rust);
    const k = 0.75 + 0.35 * rib;
    o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
    o.h = 0.4 + 0.5 * rib;
  });
}

function shingles(ac, hc, size) {
  const tn = createTileNoise(321), r = rng(321);
  const rows = 8, off = Array.from({ length: rows }, () => r());
  fillPixels(ac, hc, size, (u, v, o) => {
    const row = Math.floor(v * rows), fv = v * rows - row;
    const col = Math.floor(((u + off[row] * 0.125) * 8)), fu = ((u + off[row] * 0.125) * 8) % 1;
    const n = tn.fbm(u, v, 6, 4), moss = smoothstep(0.1, 0.6, tn.fbm(u + 0.3, v, 5, 3));
    let c = mixRGB(hex(0x3a3630), hex(0x64594a), saturate(0.5 + 0.6 * n + 0.05 * ((col * 7 + row * 3) % 5)));
    c = mixRGB(c, hex(0x4a5a34), moss * 0.35);
    const edge = Math.min(fv * 1.6, 1) * (Math.min(fu, 1 - fu) < 0.04 ? 0.5 : 1);
    o.r = c[0] * (0.55 + 0.45 * edge); o.g = c[1] * (0.55 + 0.45 * edge); o.b = c[2] * (0.55 + 0.45 * edge);
    o.h = 0.3 + 0.6 * fv * (Math.min(fu, 1 - fu) < 0.04 ? 0.4 : 1);
  });
}

function stone(ac, hc, size) {
  const r = rng(331), tn = createTileNoise(331);
  fillPixels(ac, hc, size, (u, v, o) => { o.r = 70; o.g = 68; o.b = 64; o.h = 0.2; });
  for (let i = 0; i < 90; i++) {
    const x = r() * size, y = r() * size, w = 26 + r() * 40, h = 16 + r() * 22;
    const c = mixRGB(hex(0x6b6a66), hex(0xa39c90), r());
    wrapDraw(size, x, y, w, (px, py) => {
      ac.fillStyle = rgb(c);
      ac.beginPath(); ac.ellipse(px, py, w / 2, h / 2, 0, 0, Math.PI * 2); ac.fill();
      const g = hc.createRadialGradient(px, py, 0, px, py, w / 2);
      g.addColorStop(0, gray(0.95)); g.addColorStop(1, gray(0.45));
      hc.fillStyle = g; hc.beginPath(); hc.ellipse(px, py, w / 2, h / 2, 0, 0, Math.PI * 2); hc.fill();
    });
  }
}

function canvasWeave(ac, hc, size) {
  const tn = createTileNoise(341);
  fillPixels(ac, hc, size, (u, v, o) => {
    const w = (Math.sin(u * 200) * Math.sin(v * 200)) * 0.5 + 0.5;
    const n = tn.fbm(u, v, 6, 3);
    const c = mixRGB(hex(0xa8531c), hex(0xd2732a), saturate(0.5 + 0.5 * n));
    const k = 0.82 + 0.18 * w;
    o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
    o.h = 0.5 + 0.2 * w;
  });
}

function paintedMetal(ac, hc, size, base, seed) {
  const tn = createTileNoise(seed), r = rng(seed);
  fillPixels(ac, hc, size, (u, v, o) => {
    const n = tn.fbm(u, v, 5, 5), s = tn.fbm(u, v, 30, 3, 0.5, 4);
    let c = mixRGB(mixRGB(base, [0, 0, 0], 0.16), base, saturate(0.5 + 0.5 * n));
    const soot = smoothstep(0.2, 0.7, tn.fbm(u + 0.5, v, 3, 3)) * 0.55;
    c = mixRGB(c, hex(0x1d1a18), soot);
    const scuff = smoothstep(0.55, 0.7, s);
    c = mixRGB(c, hex(0x9b9b98), scuff * 0.5);
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.5 + 0.1 * n;
  });
  for (let i = 0; i < 24; i++) {
    const x = r() * size, y = r() * size, l = 20 + r() * 60, a = r() * Math.PI;
    ac.strokeStyle = 'rgba(60,54,48,0.5)'; ac.lineWidth = 1 + r() * 2;
    ac.beginPath(); ac.moveTo(x, y); ac.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ac.stroke();
  }
}

function rustMetal(ac, hc, size) {
  const tn = createTileNoise(351);
  fillPixels(ac, hc, size, (u, v, o) => {
    const n = tn.fbm(u, v, 5, 5), s = tn.fbm(u, v, 30, 3, 0.5, 4);
    const c = mixRGB(mixRGB(hex(0x4a2410), hex(0x2c2622), smoothstep(0.1, 0.6, s + n * 0.3)), hex(0xa4562a), saturate(0.4 + 0.7 * n));
    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.h = 0.5 + 0.35 * n;
  });
}

function fur(ac, hc, size, base, seed) {
  const tn = createTileNoise(seed), r = rng(seed);
  fillPixels(ac, hc, size, (u, v, o) => {
    const n = tn.fbm(u, v, 5, 4), s = tn.fbm(u, v, 80, 2, 0.5, 20);
    const c = mixRGB(mixRGB(base, [0, 0, 0], 0.3), mixRGB(base, [255, 255, 255], 0.12), saturate(0.5 + 0.6 * n + 0.3 * s));
    o.r = c[0]; o.g = c[1]; o.b = c[2]; o.h = 0.5 + 0.2 * s;
  });
  for (let i = 0; i < 2500; i++) {
    const x = r() * size, y = r() * size;
    ac.strokeStyle = `rgba(255,240,220,${0.06 + r() * 0.08})`; ac.lineWidth = 1;
    ac.beginPath(); ac.moveTo(x, y); ac.lineTo(x + (r() - 0.5) * 4, y + 6 + r() * 8); ac.stroke();
  }
}

const SURFACES = {
  Fur_Deer: { paint: (a, h, s) => fur(a, h, s, hex(0x8a5f3a), 421), strength: 2, rough: 0.95 },
  Fur_White: { paint: (a, h, s) => fur(a, h, s, hex(0xe3d7c2), 422), strength: 2, rough: 0.95 },
  Wood_Planks: { paint: (a, h, s) => planks(a, h, s, hex(0x8a7355), 401), strength: 5, rough: 0.9 },
  Wood_Old: { paint: (a, h, s) => planks(a, h, s, hex(0x5a5346), 402), strength: 6, rough: 0.95 },
  Wood_Fresh: { paint: (a, h, s) => planks(a, h, s, hex(0xb8925c), 403), strength: 4, rough: 0.8 },
  Wood_Log: { paint: logs, strength: 7, rough: 0.92 },
  Roof_Tin: { paint: (a, h, s) => tin(a, h, s, true), strength: 8, rough: 0.55, metal: 0.55 },
  Roof_Tin_Clean: { paint: (a, h, s) => tin(a, h, s, false), strength: 8, rough: 0.5, metal: 0.6 },
  Roof_Shingle: { paint: shingles, strength: 7, rough: 0.95 },
  Stone: { paint: stone, strength: 8, rough: 0.9 },
  Fabric_Tent: { paint: canvasWeave, strength: 3, rough: 0.95 },
  Metal_Paint_White: { paint: (a, h, s) => paintedMetal(a, h, s, hex(0xe6e3da), 411), strength: 2, rough: 0.5, metal: 0.35 },
  Metal_Paint_Red: { paint: (a, h, s) => paintedMetal(a, h, s, hex(0xb02a24), 412), strength: 2, rough: 0.5, metal: 0.35 },
  Metal_Paint_Olive: { paint: (a, h, s) => paintedMetal(a, h, s, hex(0x4b5a3c), 413), strength: 2, rough: 0.55, metal: 0.3 },
  Metal_Rust: { paint: rustMetal, strength: 6, rough: 0.7, metal: 0.5 },
};

const surfaceCache = {};
// Textured material for a Blender material name; unknown names fall back to a plain colour.
export function surfaceMaterial(name, anisotropy = 4) {
  if (surfaceCache[name]) return surfaceCache[name];
  const def = SURFACES[name];
  if (!def) return null;
  const size = 256;
  const [ac, actx] = makeCanvas(size), [hc, hctx] = makeCanvas(size);
  def.paint(actx, hctx, size);
  const p = packLayer(actx, hctx, size, { strength: def.strength, rough: def.rough, standard: true });
  const map = dataTexture(p.albedo, size, size, { srgb: true });
  const normalMap = dataTexture(p.normal, size, size);
  map.anisotropy = anisotropy;
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: def.rough, metalness: def.metal || 0, vertexColors: true });
  m.name = name;
  patchMaterial(m, 'surface', null);
  return (surfaceCache[name] = m);
}
