// Terrain renderer: one instanced grid mesh drawn many times at different sizes
// (continuous distance-based LOD / CDLOD). The vertex shader reads heights from
// float textures and morphs vertices between detail levels so there is no popping.
// The fragment shader paints the desert procedurally: sand with wind ripples,
// gravel hardpan, banded sandstone cliffs, a cracked dry lake and the dirt road.
import * as THREE from 'three';
import { NEAR, MID, FAR } from '../world/worldgen.js';
import { useTerrainLight } from './shaderpatch.js';

const LEAF = 32;                 // metres covered by a finest-level node
const MAX_LOD = 10;              // root node spans 32 * 2^10 = 32768 m
const ROOT = -16384;

const clamp = THREE.MathUtils.clamp;

// sRGB hex -> linear GLSL vec3
function lin(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

export function heightTexture(grid) {
  const t = new THREE.DataTexture(grid.data, grid.size, grid.size, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// Half-resolution copy of a corner-aligned grid with a [1 2 1] filter, so distant
// terrain (drawn with sparse vertices) doesn't alias into zigzags.
function downsample(grid) {
  const n = grid.size, m = (n - 1) / 2 + 1;
  const src = grid.data, out = new Float32Array(m * m);
  const at = (i, j) => src[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const ci = 2 * i, cj = 2 * j;
      let s = 4 * at(ci, cj);
      s += 2 * (at(ci - 1, cj) + at(ci + 1, cj) + at(ci, cj - 1) + at(ci, cj + 1));
      s += at(ci - 1, cj - 1) + at(ci + 1, cj - 1) + at(ci - 1, cj + 1) + at(ci + 1, cj + 1);
      out[j * m + i] = s / 16;
    }
  }
  return { size: m, spacing: grid.spacing * 2, origin: grid.origin, data: out };
}

// RGB: packed normal (x, z, y). A: curvature (above 128 = hollow, below = crest).
export function normalTexture(grid) {
  const n = grid.size, d = grid.data, s = grid.spacing;
  const out = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    const j0 = j > 0 ? j - 1 : 0, j1 = j < n - 1 ? j + 1 : n - 1;
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
      const c = d[j * n + i];
      const dx = (d[j * n + i1] - d[j * n + i0]) / ((i1 - i0) * s);
      const dz = (d[j1 * n + i] - d[j0 * n + i]) / ((j1 - j0) * s);
      const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
      const lap = (d[j * n + i0] + d[j * n + i1] + d[j0 * n + i] + d[j1 * n + i] - 4 * c) / s;
      const k = (j * n + i) * 4;
      out[k] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      out[k + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255);
      out[k + 2] = Math.round(inv * 255);
      out[k + 3] = clamp(Math.round(128 + lap * 60), 0, 255);
    }
  }
  const t = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Grid spec uniform: (origin, spacing, size)
const gridVec = (g) => new THREE.Vector3(g.origin, g.spacing, g.size);

const SHARED_GLSL = /* glsl */ `
  uniform vec3 gNear;
  uniform vec3 gMid;
  uniform vec3 gFar;
  float gridWeight(vec3 g, vec2 p, float margin) {
    float lo = g.x, hi = g.x + g.y * (g.z - 1.0);
    vec2 d = min(p - lo, hi - p);
    return clamp(min(d.x, d.y) / margin, 0.0, 1.0);
  }
  vec2 gridUV(vec3 g, vec2 p) { return ((p - g.x) / g.y + 0.5) / g.z; }
`;

const HEIGHT_GLSL = /* glsl */ `
  uniform sampler2D hN0;
  uniform sampler2D hN1;
  uniform sampler2D hN2;
  uniform sampler2D hN3;
  uniform sampler2D hMid;
  uniform sampler2D hFar;
  uniform vec3 gN1;
  uniform vec3 gN2;
  uniform vec3 gN3;
  float fetchHeight(sampler2D t, vec3 g, vec2 p) {
    vec2 f = clamp((p - g.x) / g.y, vec2(0.0), vec2(g.z - 1.001));
    ivec2 i = ivec2(f);
    vec2 w = f - vec2(i);
    float a = texelFetch(t, i, 0).r;
    float b = texelFetch(t, i + ivec2(1, 0), 0).r;
    float c = texelFetch(t, i + ivec2(0, 1), 0).r;
    float d = texelFetch(t, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
  }
  // Height at detail level L (0 = 1 m, 1 = 2 m, 2 = 4 m, 3+ = 8 m and coarser).
  float heightLevel(vec2 p, int L) {
    float h = fetchHeight(hFar, gFar, p);
    float wm = gridWeight(gMid, p, 256.0);
    if (wm > 0.0) h = mix(h, fetchHeight(hMid, gMid, p), wm);
    float wn = gridWeight(gNear, p, 24.0);
    if (wn > 0.0 && L < 4) {
      float hn;
      if (L == 0) hn = fetchHeight(hN0, gNear, p);
      else if (L == 1) hn = fetchHeight(hN1, gN1, p);
      else if (L == 2) hn = fetchHeight(hN2, gN2, p);
      else hn = fetchHeight(hN3, gN3, p);
      h = mix(h, hn, wn);
    }
    return h;
  }
  // Continuous level: blends toward the next coarser level as nodes morph.
  float terrainHeight(vec2 p, float level) {
    int L = int(level);
    float f = level - float(L);
    float h = heightLevel(p, L);
    if (f > 0.001) h = mix(h, heightLevel(p, L + 1), f);
    return h;
  }
`;

// The procedural desert surface. Produces albedo, roughness and a world-space normal.
function surfaceGLSL(stage) {
  const o = stage.oasis;
  return /* glsl */ `
  uniform sampler2D nNear;
  uniform sampler2D nMid;
  uniform sampler2D nFar;
  uniform sampler2D tSplat;
  uniform sampler2D tNoise;
  uniform sampler2D tCell;
  varying vec3 vWorld;

  const vec4 OASIS = vec4(${o.x.toFixed(1)}, ${o.z.toFixed(1)}, ${o.r.toFixed(1)}, ${o.level.toFixed(2)});

  vec3 decodeN(vec4 t) { return normalize(vec3(t.r * 2.0 - 1.0, t.b, t.g * 2.0 - 1.0)); }

  // Banded sandstone: mostly one warm orange-red, with a few paler and darker
  // layers at set heights (as real strata are), wandering slightly.
  vec3 strata(float y, vec2 xz, float n0, float n1) {
    float h = y + n0 * 10.0 + n1 * 1.5;
    vec3 c = mix(${lin('#9a4d31')}, ${lin('#ad5c39')}, 0.5 + 0.5 * sin(h * 0.16));
    c = mix(c, ${lin('#bf8c68')}, smoothstep(0.9, 1.0, 0.5 + 0.5 * sin(h * 0.055 + 1.7)) * 0.3);
    c = mix(c, ${lin('#7e3f2b')}, smoothstep(0.85, 1.0, 0.5 + 0.5 * sin(h * 0.29 + 0.4)) * 0.2);
    return c;
  }

  // Wind ripples: gradient of an asymmetric (steep lee side) ripple field.
  vec2 rippleGrad(vec2 p, float warp, float scale, float amp) {
    vec2 w = vec2(0.970, 0.243);
    float ph = dot(p, w) * scale + warp;
    float s = fract(ph);
    float d = s < 0.72 ? 1.0 / 0.72 : -1.0 / 0.28;
    d *= smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.94, s) * 0.6 + 0.4;
    return w * d * scale * amp;
  }

  struct Surface { vec3 albedo; float rough; vec3 normal; float wet; };

  Surface desertSurface(vec3 wp, float viewDist) {
    Surface S;
    vec2 xz = wp.xz;
    float y = wp.y;
    float detail = 1.0 - smoothstep(35.0, 160.0, viewDist);
    float fine = 1.0 - smoothstep(10.0, 45.0, viewDist);

    // Macro normal, blended across the three height grids.
    float wn = gridWeight(gNear, xz, 24.0);
    float wm = gridWeight(gMid, xz, 256.0);
    vec4 tf = texture2D(nFar, gridUV(gFar, xz));
    vec4 tm = texture2D(nMid, gridUV(gMid, xz));
    vec4 tn = texture2D(nNear, gridUV(gNear, xz));
    vec4 nt = mix(mix(tf, tm, wm), tn, wn);
    vec3 N = decodeN(nt);
    float curv = nt.a * 2.0 - 1.0;
    vec4 sp = texture2D(tSplat, gridUV(gNear, xz));
    float lat = (sp.g * 2.0 - 1.0) * 8.0;
    sp *= wn;

    float slope = 1.0 - N.y;
    vec4 n0 = texture2D(tNoise, xz * 0.0009);
    vec4 n1 = texture2D(tNoise, xz * 0.012);
    vec4 n2 = texture2D(tNoise, xz * 0.085);
    vec4 n3 = texture2D(tNoise, xz * 0.53);

    // ---- Sand: dunes, drifts in hollows, and patches.
    float sandW = sp.b * 1.3 + smoothstep(0.6, 0.78, n1.a) * 0.55 + smoothstep(0.1, 0.45, curv) * 0.6;
    sandW = clamp(sandW * (1.0 - smoothstep(0.22, 0.4, slope)), 0.0, 1.0);
    vec3 sand = mix(${lin('#c08650')}, ${lin('#d9a66b')}, n1.r * 0.6 + n2.r * 0.4);
    sand = mix(sand, ${lin('#e2b57f')}, smoothstep(-0.05, -0.4, curv) * 0.5);

    // ---- Ground: gravelly hardpan with darker patches of desert pavement.
    float pave = smoothstep(0.52, 0.78, n1.g * 0.65 + n0.b * 0.35);
    vec3 ground = mix(${lin('#a07a58')}, ${lin('#bf9670')}, n1.r);
    ground = mix(ground, ${lin('#b3795a')}, smoothstep(0.5, 0.85, n0.a) * 0.55);
    ground = mix(ground, ${lin('#7d6450')}, pave * 0.55);
    ground *= 0.9 + 0.2 * n2.r;
    vec4 cl = texture2D(tCell, xz * 0.38);
    vec4 cl2 = texture2D(tCell, xz * 0.93 + 0.37);
    float pebA = smoothstep(0.3, 0.16, cl.r) * step(0.62, cl.b);
    float pebB = smoothstep(0.26, 0.12, cl2.r) * step(0.7, cl2.b);
    float peb = max(pebA, pebB * 0.8) * clamp(smoothstep(0.35, 0.85, n2.g + 0.25 * n1.r) + pave, 0.0, 1.0) * (1.0 - sandW * 0.85);
    vec3 pebCol = mix(${lin('#5f4a3d')}, ${lin('#a9876a')}, fract(cl.b * 7.13 + cl2.b));
    ground = mix(ground, pebCol, peb * 0.45 * detail);

    // ---- Rock: cliffs by slope, caprock on high ground. Triplanar, so vertical
    // faces aren't stretched.
    vec3 tw = pow(abs(N), vec3(4.0));
    tw /= tw.x + tw.y + tw.z;
    vec4 rA = texture2D(tNoise, wp.zy * 0.035) * tw.x + texture2D(tNoise, xz * 0.035) * tw.y + texture2D(tNoise, wp.xy * 0.035) * tw.z;
    vec4 rB = texture2D(tNoise, wp.zy * 0.23) * tw.x + texture2D(tNoise, xz * 0.23) * tw.y + texture2D(tNoise, wp.xy * 0.23) * tw.z;
    vec4 rC = texture2D(tCell, wp.zy * vec2(0.06, 0.11)) * tw.x + texture2D(tCell, xz * 0.08) * tw.y + texture2D(tCell, wp.xy * vec2(0.06, 0.11)) * tw.z;
    float rockW = smoothstep(0.26, 0.42, slope + (rA.g - 0.5) * 0.16);
    float cap = smoothstep(20.0, 27.0, y) * smoothstep(0.35, 0.6, n1.g + n2.r * 0.3) * (1.0 - sp.b);
    rockW = clamp(max(rockW, cap * 0.8) * (1.0 - sp.r), 0.0, 1.0);
    vec3 rock = strata(y + (rA.r - 0.5) * 3.0, xz, n0.r, rA.a) * (0.88 + 0.22 * rB.r);
    float fracture = 1.0 - smoothstep(0.0, 0.05, rC.g);
    rock *= 1.0 - 0.18 * fracture;
    float streak = texture2D(tNoise, vec2((wp.x * tw.z + wp.z * tw.x) * 0.04, y * 0.003)).g;
    rock = mix(rock, ${lin('#4a3026')}, smoothstep(0.66, 0.92, streak) * 0.3 * (1.0 - tw.y));

    // ---- Dry lake: cracked mud plates.
    float playaW = sp.a;
    vec4 cr = texture2D(tCell, xz * 0.034);
    float crackW = 0.045 + 0.05 * n2.b;
    float crack = 1.0 - smoothstep(crackW * 0.4, crackW, cr.g);
    vec3 playa = mix(${lin('#cdbba1')}, ${lin('#ded0ba')}, n1.r) * (0.93 + 0.14 * cr.b);
    playa = mix(playa, ${lin('#7d6a58')}, crack * 0.85);

    // ---- Road: packed dirt, darker ruts, loose gravel on the crown and edges.
    float roadW = sp.r;
    float ruts = 0.0;
    ruts += exp(-(lat + 2.4) * (lat + 2.4) / 0.3);
    ruts += exp(-(lat + 0.7) * (lat + 0.7) / 0.3);
    ruts += exp(-(lat - 0.7) * (lat - 0.7) / 0.3);
    ruts += exp(-(lat - 2.4) * (lat - 2.4) / 0.3);
    ruts = clamp(ruts, 0.0, 1.0);
    float loose = smoothstep(3.2, 5.0, abs(lat)) + exp(-lat * lat / 0.15) * 0.6 + exp(-(abs(lat) - 1.55) * (abs(lat) - 1.55) / 0.12) * 0.4;
    vec3 road = mix(${lin('#9b7555')}, ${lin('#7f5f45')}, ruts * 0.75);
    road = mix(road, ${lin('#b39272')}, clamp(loose, 0.0, 1.0) * 0.55);
    road *= 0.9 + 0.2 * n3.r;
    road = mix(road, pebCol, peb * 0.3 * detail * (1.0 - ruts));

    // ---- Oasis shore: wet, dark sand.
    float od = length(xz - OASIS.xy);
    float wet = (1.0 - smoothstep(OASIS.z * 0.85, OASIS.z * 1.3, od + n2.r * 8.0)) * (1.0 - smoothstep(OASIS.w + 0.15, OASIS.w + 1.1, y));

    // ---- Combine.
    vec3 albedo = ground;
    float rough = 0.9;
    albedo = mix(albedo, sand, sandW);
    rough = mix(rough, 0.97, sandW);
    albedo = mix(albedo, rock, rockW);
    rough = mix(rough, 0.82, rockW);
    albedo = mix(albedo, playa, playaW);
    rough = mix(rough, 0.86, playaW);
    albedo = mix(albedo, road, roadW);
    rough = mix(rough, mix(0.9, 0.72, ruts), roadW);
    albedo *= 0.94 + 0.12 * n0.r;
    albedo = mix(albedo, albedo * vec3(0.42, 0.44, 0.4), wet);
    rough = mix(rough, 0.3, wet);

    // ---- Small-scale relief (world-space normal perturbation).
    vec3 bump = vec3(0.0);
    float rippleAmt = sandW * (1.0 - roadW) * (1.0 - wet) * (1.0 - smoothstep(0.12, 0.3, slope));
    float warp = n1.r * 7.0 + n2.g * 1.6;
    vec2 rg = rippleGrad(xz, warp, 1.6, 0.018) * detail + rippleGrad(xz, warp * 2.3, 7.5, 0.006) * fine;
    bump.xz += rg * rippleAmt;
    // Rock: grain, fracture edges and horizontal bedding planes.
    vec3 rb = (vec3(rB.g, rA.g, rB.b) - 0.5) * 0.7 + (vec3(rC.r, rC.b, rC.a) - 0.5) * 0.35;
    rb.y += (smoothstep(0.7, 1.0, sin(y * 1.9 + rA.r * 3.0)) - 0.3) * 0.6;
    bump += (rb - N * dot(rb, N)) * rockW * (0.35 + 0.65 * detail);
    // Gravel.
    bump.xz += (vec2(cl.r, cl.a) - 0.5) * peb * 0.35 * detail * (1.0 - sandW);
    // Crack edges curl up slightly.
    bump.xz += (vec2(cr.r, cr.b) - 0.5) * crack * playaW * 0.3 * detail;
    // Fine road texture.
    bump.xz += (n3.rg - 0.5) * roadW * 0.12 * fine;

    S.normal = normalize(N - bump);
    S.albedo = albedo;
    S.rough = rough;
    S.wet = wet;
    return S;
  }
  `;
}

export class Terrain {
  constructor(world, tex, { gridDim = 32, baseRange = 80, stage } = {}) {
    this.world = world;
    this.gridDim = gridDim;
    this.ranges = [];
    for (let l = 0; l <= MAX_LOD; l++) this.ranges.push(baseRange * Math.pow(2, l));

    // Filtered copies of the near heights for distant, sparsely-vertexed nodes.
    const n1 = downsample(world.near), n2 = downsample(n1), n3 = downsample(n2);
    this.nearMips = [world.near, n1, n2, n3];
    // The mid grid overlaps the near one at the same 8 m spacing as n3: keep them identical.
    {
      const M = world.mid, off = (NEAR.origin - MID.origin) / MID.spacing;
      for (let j = 0; j < n3.size; j++) for (let i = 0; i < n3.size; i++) M.data[(j + off) * M.size + i + off] = n3.data[j * n3.size + i];
    }
    this.h = {
      n0: heightTexture(world.near), n1: heightTexture(n1), n2: heightTexture(n2), n3: heightTexture(n3),
      mid: heightTexture(world.mid), far: heightTexture(world.far),
    };
    this.n = { near: normalTexture(world.near), mid: normalTexture(world.mid), far: normalTexture(world.far) };
    const sp = new THREE.DataTexture(world.splat, NEAR.size, NEAR.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    sp.minFilter = THREE.LinearMipmapLinearFilter;
    sp.magFilter = THREE.LinearFilter;
    sp.generateMipmaps = true;
    sp.anisotropy = 4;
    sp.needsUpdate = true;
    this.splat = sp;
    this._buildBounds();

    // Instanced grid: positions in [0,1] on xz.
    const G = gridDim;
    const pos = new Float32Array((G + 1) * (G + 1) * 3);
    for (let j = 0; j <= G; j++) {
      for (let i = 0; i <= G; i++) {
        const k = (j * (G + 1) + i) * 3;
        pos[k] = i / G;
        pos[k + 2] = j / G;
      }
    }
    const idx = [];
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
        // Alternate the diagonal for a more even look.
        if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.maxNodes = 1024;
    this.nodeData = new Float32Array(this.maxNodes * 4);
    this.nodeAttr = new THREE.InstancedBufferAttribute(this.nodeData, 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aNode', this.nodeAttr);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.uniforms = {
      hN0: { value: this.h.n0 }, hN1: { value: this.h.n1 }, hN2: { value: this.h.n2 }, hN3: { value: this.h.n3 },
      hMid: { value: this.h.mid }, hFar: { value: this.h.far },
      gN1: { value: gridVec(n1) }, gN2: { value: gridVec(n2) }, gN3: { value: gridVec(n3) },
      uLodBias: { value: gridDim >= 32 ? 0 : 1 },
      nNear: { value: this.n.near }, nMid: { value: this.n.mid }, nFar: { value: this.n.far },
      gNear: { value: gridVec(NEAR) }, gMid: { value: gridVec(MID) }, gFar: { value: gridVec(FAR) },
      tSplat: { value: sp }, tNoise: { value: tex.noise }, tCell: { value: tex.cell },
      uMorph: { value: this.ranges.map(() => new THREE.Vector2()) },
      uGrid: { value: G },
      uDebug: { value: 0 },
    };
    this.ranges.forEach((r, l) => {
      const end = r * 0.94;
      const prev = l > 0 ? this.ranges[l - 1] : 0;
      const start = prev + (end - prev) * 0.62;
      this.uniforms.uMorph.value[l].set(start / (end - start), 1 / (end - start));
    });

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const U = this.uniforms;
    const surface = surfaceGLSL(stage);
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aNode;
          uniform vec2 uMorph[${MAX_LOD + 1}];
          uniform float uGrid;
          uniform float uLodBias;
          varying vec3 vWorld;
          ${SHARED_GLSL}
          ${HEIGHT_GLSL}`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
        .replace('#include <begin_vertex>', `
          vec2 gp = position.xz;
          vec2 wp = aNode.xy + gp * aNode.z;
          float lod = aNode.w + uLodBias;
          float h0 = terrainHeight(wp, lod);
          float camDist = distance(cameraPosition, vec3(wp.x, h0, wp.y));
          vec2 mc = uMorph[int(aNode.w + 0.5)];
          float morph = clamp(camDist * mc.y - mc.x, 0.0, 1.0);
          vec2 fr = fract(gp * uGrid * 0.5) * 2.0 / uGrid;
          wp -= fr * aNode.z * morph;
          vec3 transformed = vec3(wp.x, terrainHeight(wp, lod + morph), wp.y);
          vWorld = transformed;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform int uDebug;
          ${SHARED_GLSL}
          ${surface}`)
        .replace('#include <map_fragment>', `
          Surface ts = desertSurface(vWorld, length(vWorld - cameraPosition));
          diffuseColor.rgb = ts.albedo;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = ts.rough;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = 1.0;
          vec3 normal = normalize( ( viewMatrix * vec4( ts.normal, 0.0 ) ).xyz );
          vec3 nonPerturbedNormal = normal;`)
        .replace('#include <normal_fragment_maps>', '')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          if (uDebug == 1) gl_FragColor = vec4(ts.albedo, 1.0);
          if (uDebug == 2) gl_FragColor = vec4(ts.normal * 0.5 + 0.5, 1.0);
          if (uDebug == 3) gl_FragColor = vec4(terrainLight(vWorld), 0.0, 1.0);
          if (uDebug == 4) gl_FragColor = vec4(vec3(ts.rough), 1.0);`);
    };
    mat.customProgramCacheKey = () => 'canyon-terrain-' + G;
    mat.defines = { TL_WORLDPOS: 'vWorld' };
    useTerrainLight(mat);
    this.material = mat;

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;

    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._cam = new THREE.Vector3();
  }

  // Min/max height pyramid over 64 m cells, for culling nodes against the view.
  _buildBounds() {
    const W = this.world;
    const C = 64, cells = 32768 / C;
    const lo = new Float32Array(cells * cells), hi = new Float32Array(cells * cells);
    for (let cj = 0; cj < cells; cj++) {
      const z0 = ROOT + cj * C;
      for (let ci = 0; ci < cells; ci++) {
        const x0 = ROOT + ci * C;
        let mn = Infinity, mx = -Infinity;
        let grid = null;
        if (W.near.contains(x0, z0) && W.near.contains(x0 + C, z0 + C)) grid = W.near;
        else if (W.mid.contains(x0, z0) && W.mid.contains(x0 + C, z0 + C)) grid = W.mid;
        if (grid) {
          const n = grid.size, s = grid.spacing;
          const i0 = Math.round((x0 - grid.origin) / s), j0 = Math.round((z0 - grid.origin) / s);
          const steps = C / s;
          const stride = Math.max(1, steps >> 4);
          for (let j = j0; j <= j0 + steps; j += stride) {
            for (let i = i0; i <= i0 + steps; i += stride) {
              const v = grid.data[j * n + i];
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
          }
        } else {
          for (const [dx, dz] of [[0, 0], [C, 0], [0, C], [C, C], [C / 2, C / 2]]) {
            const v = W.far.sample(x0 + dx, z0 + dz);
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        lo[cj * cells + ci] = mn - 3;
        hi[cj * cells + ci] = mx + 3;
      }
    }
    this.levels = [{ cells, lo, hi }];
    let prev = this.levels[0];
    while (prev.cells > 1) {
      const c = prev.cells / 2;
      const l2 = new Float32Array(c * c), h2 = new Float32Array(c * c);
      for (let j = 0; j < c; j++) {
        for (let i = 0; i < c; i++) {
          const a = (2 * j) * prev.cells + 2 * i, b = a + prev.cells;
          l2[j * c + i] = Math.min(prev.lo[a], prev.lo[a + 1], prev.lo[b], prev.lo[b + 1]);
          h2[j * c + i] = Math.max(prev.hi[a], prev.hi[a + 1], prev.hi[b], prev.hi[b + 1]);
        }
      }
      prev = { cells: c, lo: l2, hi: h2 };
      this.levels.push(prev);
    }
  }

  _setBox(x0, z0, size) {
    const level = Math.max(0, Math.round(Math.log2(size / 64)));
    const L = this.levels[Math.min(level, this.levels.length - 1)];
    const cs = 32768 / L.cells;
    const i = clamp(Math.floor((x0 - ROOT) / cs), 0, L.cells - 1);
    const j = clamp(Math.floor((z0 - ROOT) / cs), 0, L.cells - 1);
    const k = j * L.cells + i;
    this._box.min.set(x0, L.lo[k], z0);
    this._box.max.set(x0 + size, L.hi[k], z0 + size);
    return this._box;
  }

  _inRange(box, r) {
    return box.distanceToPoint(this._cam) <= r;
  }

  _add(x0, z0, size, lod) {
    if (this.count >= this.maxNodes) return;
    const k = this.count * 4;
    this.nodeData[k] = x0;
    this.nodeData[k + 1] = z0;
    this.nodeData[k + 2] = size;
    this.nodeData[k + 3] = lod;
    this.count++;
  }

  _select(x0, z0, size, lod) {
    const box = this._setBox(x0, z0, size);
    if (!this._frustum.intersectsBox(box)) return;
    if (lod === 0 || !this._inRange(box, this.ranges[lod - 1])) {
      this._add(x0, z0, size, lod);
      return;
    }
    const h = size / 2;
    for (let q = 0; q < 4; q++) {
      const cx = x0 + (q & 1) * h, cz = z0 + (q >> 1) * h;
      const cb = this._setBox(cx, cz, h);
      if (this._inRange(cb, this.ranges[lod - 1])) this._select(cx, cz, h, lod - 1);
      else if (this._frustum.intersectsBox(cb)) this._add(cx, cz, h, lod - 1);
    }
  }

  // Choose nodes for this camera. Call once per frame (and for other views if needed).
  update(camera) {
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    this._cam.copy(camera.position);
    this.count = 0;
    this._select(ROOT, ROOT, 32768, MAX_LOD);
    this.geometry.instanceCount = this.count;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, this.count * 4);
    this.nodeAttr.needsUpdate = true;
  }

  // CPU height lookup matching the renderer (for physics, cameras, placement).
  heightAt(x, z) {
    const W = this.world;
    if (W.near.contains(x, z)) return W.near.sample(x, z);
    if (W.mid.contains(x, z)) return W.mid.sample(x, z);
    return W.far.sample(x, z);
  }
}

export { LEAF };
