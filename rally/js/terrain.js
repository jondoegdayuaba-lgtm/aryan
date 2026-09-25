// Terrain rendering. The heightfield lives in a float texture; one small grid
// patch is instanced across a quadtree whose nodes get coarser with distance
// (CDLOD: vertices morph smoothly between levels so there are no cracks or pops).
// Surface detail comes from per-pixel normals and splatted ground textures.
import * as THREE from 'three';
import { N, HALF, WATER } from './gen.js';
import { LAYER } from './bake.js';
import { patch } from './shading.js';

const P = 16;                 // cells per patch side
const LEVELS = 8;             // node size 16 m (level 0) .. 2048 m (level 7, the root)
const R0 = 90;                // level 0 is used out to 90 m, doubling per level
const MORPH_START = 0.6;      // morph over the last 40% of each level's range
const RANGES = Array.from({ length: LEVELS }, (_, l) => (l === LEVELS - 1 ? 1e6 : R0 * 2 ** l));

// ---------- CPU-side texture data ----------

function downsample(src, n) {
  const m = n >> 1, dst = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      let s = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const z = Math.min(n - 1, Math.max(0, 2 * j + dj));
        for (let di = -1; di <= 1; di++) {
          const x = Math.min(n - 1, Math.max(0, 2 * i + di));
          const wt = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1);
          s += src[z * n + x] * wt;
          w += wt;
        }
      }
      dst[j * m + i] = s / w;
    }
  }
  return dst;
}

// Everything the terrain shader samples, built once from the world data.
export function buildTerrainData(world) {
  const { height, side, road, trees } = world;
  // Height pyramid packed in one atlas: level 0 on the left, the rest stacked on the right.
  const AW = N + N / 2, AH = N;
  const atlas = new Float32Array(AW * AH);
  const offsets = [];
  let lvl = height, n = N;
  for (let l = 0; l < LEVELS; l++) {
    const ox = l === 0 ? 0 : N, oy = l === 0 ? 0 : N - (N >> (l - 1));
    offsets.push(new THREE.Vector2(ox, oy));
    for (let j = 0; j < n; j++) atlas.set(lvl.subarray(j * n, j * n + n), (oy + j) * AW + ox);
    if (l < LEVELS - 1) { lvl = downsample(lvl, n); n >>= 1; }
  }
  const heightTex = new THREE.DataTexture(atlas, AW, AH, THREE.RedFormat, THREE.FloatType);
  heightTex.minFilter = heightTex.magFilter = THREE.NearestFilter;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;

  // Node bounds (min/max height) for culling, per level.
  const minmax = [];
  {
    const cn = N / P;
    const mm = new Float32Array(cn * cn * 2);
    for (let cz = 0; cz < cn; cz++) {
      for (let cx = 0; cx < cn; cx++) {
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j <= P; j++) {
          const z = Math.min(N - 1, cz * P + j);
          for (let i = 0; i <= P; i++) {
            const v = height[z * N + Math.min(N - 1, cx * P + i)];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        mm[(cz * cn + cx) * 2] = lo - 1;
        mm[(cz * cn + cx) * 2 + 1] = hi + 1;
      }
    }
    minmax.push(mm);
    let c = cn;
    for (let l = 1; l < LEVELS; l++) {
      const pc = c; c >>= 1;
      const up = new Float32Array(c * c * 2), prev = minmax[l - 1];
      for (let z = 0; z < c; z++) {
        for (let x = 0; x < c; x++) {
          let lo = Infinity, hi = -Infinity;
          for (let k = 0; k < 4; k++) {
            const i = ((2 * z + (k >> 1)) * pc + 2 * x + (k & 1)) * 2;
            lo = Math.min(lo, prev[i]);
            hi = Math.max(hi, prev[i + 1]);
          }
          up[(z * c + x) * 2] = lo;
          up[(z * c + x) * 2 + 1] = hi;
        }
      }
      minmax.push(up);
    }
  }

  // Normals (x, z) plus a cavity term that darkens ditches and hollows.
  const nrm = new Uint8Array(N * N * 4);
  {
    // box-filtered height for the cavity term (summed-area table)
    const sat = new Float64Array((N + 1) * (N + 1));
    for (let j = 0; j < N; j++) {
      let row = 0;
      for (let i = 0; i < N; i++) {
        row += height[j * N + i];
        sat[(j + 1) * (N + 1) + i + 1] = sat[j * (N + 1) + i + 1] + row;
      }
    }
    const R = 5;
    for (let j = 0; j < N; j++) {
      const j0 = Math.max(0, j - R), j1 = Math.min(N, j + R + 1);
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        const l = height[j * N + Math.max(0, i - 1)], r = height[j * N + Math.min(N - 1, i + 1)];
        const u = height[Math.max(0, j - 1) * N + i], d = height[Math.min(N - 1, j + 1) * N + i];
        let nx = -(r - l) / 2, nz = -(d - u) / 2;
        const len = Math.sqrt(nx * nx + 1 + nz * nz);
        nx /= len; nz /= len;
        const i0 = Math.max(0, i - R), i1 = Math.min(N, i + R + 1);
        const area = (j1 - j0) * (i1 - i0);
        const avg = (sat[j1 * (N + 1) + i1] - sat[j0 * (N + 1) + i1] - sat[j1 * (N + 1) + i0] + sat[j0 * (N + 1) + i0]) / area;
        const cav = Math.max(0.45, Math.min(1, 1 - (avg - height[idx]) * 0.35));
        nrm[idx * 4] = Math.round((nx * 0.5 + 0.5) * 255);
        nrm[idx * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
        nrm[idx * 4 + 2] = Math.round(cav * 255);
        nrm[idx * 4 + 3] = 255;
      }
    }
  }
  const normalTex = new THREE.DataTexture(nrm, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;
  normalTex.magFilter = THREE.LinearFilter;
  normalTex.generateMipmaps = true;
  normalTex.anisotropy = 4;
  normalTex.needsUpdate = true;

  // Road: distance to the centreline (0..16 m), offset from the racing line
  // (±8 m, signed) and a tarmac flag. Unsigned distance in r means texels far
  // from any road filter cleanly on both sides.
  const rd = new Uint8Array(N * N * 4);
  {
    const racing = racingLine(road);
    const W = road.halfWidth;
    for (let idx = 0; idx < N * N; idx++) {
      const d = side[idx];
      const a = world.along[idx];
      const o = idx * 4;
      rd[o + 3] = 255;
      if (a < 0) { rd[o] = 255; rd[o + 1] = 255; continue; }
      rd[o] = Math.round(Math.min(1, Math.abs(d) / 16) * 255);
      const s = Math.round(a) % road.count;
      rd[o + 1] = Math.abs(d) > 7.5 ? 255 : Math.round(Math.min(1, Math.max(0, (d - racing[s]) / 16 + 0.5)) * 255);
      rd[o + 2] = road.surf[s] && Math.abs(d) < W + 2 ? 255 : 0;
    }
  }
  const roadTex = new THREE.DataTexture(rd, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  roadTex.minFilter = THREE.LinearMipmapLinearFilter;
  roadTex.magFilter = THREE.LinearFilter;
  roadTex.generateMipmaps = true;
  roadTex.anisotropy = 4;
  roadTex.needsUpdate = true;

  // Splat (2 m texels): r = tree canopy cover, g = rocky ground.
  const SN = N / 2;
  const canopy = new Float32Array(SN * SN), rocky = new Float32Array(SN * SN);
  const stamp = (arr, x, z, radius, amount) => {
    const cx = (x + HALF) / 2, cz = (z + HALF) / 2, r = radius / 2;
    for (let j = Math.floor(cz - r); j <= Math.ceil(cz + r); j++) {
      if (j < 0 || j >= SN) continue;
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if (i < 0 || i >= SN) continue;
        const dd = Math.hypot(i - cx, j - cz) / r;
        if (dd < 1) arr[j * SN + i] += amount * (1 - dd * dd);
      }
    }
  };
  for (const t of trees) stamp(canopy, t.x, t.z, 5.5 * t.scale, 0.55);
  for (const r of world.rocks) stamp(rocky, r.x, r.z, r.r * 1.6 + 0.6, 0.8);
  const sp = new Uint8Array(SN * SN * 4);
  for (let i = 0; i < SN * SN; i++) {
    sp[i * 4] = Math.round(Math.min(1, canopy[i]) * 255);
    sp[i * 4 + 1] = Math.round(Math.min(1, rocky[i]) * 255);
    sp[i * 4 + 3] = 255;
  }
  const splatTex = new THREE.DataTexture(sp, SN, SN, THREE.RGBAFormat, THREE.UnsignedByteType);
  splatTex.minFilter = THREE.LinearMipmapLinearFilter;
  splatTex.magFilter = THREE.LinearFilter;
  splatTex.generateMipmaps = true;
  splatTex.needsUpdate = true;

  return { heightTex, offsets, minmax, normalTex, roadTex, splatTex };
}

// Where cars actually drive: toward the inside of corners, cutting the apex.
export function racingLine(road) {
  const n = road.count;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.max(-1.3, Math.min(1.3, road.curv[i] * 45));
  // smooth so the line anticipates corners
  const out = new Float32Array(n);
  const R = 20;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -R; k <= R; k++) s += raw[(i + k + n) % n];
    out[i] = s / (2 * R + 1);
  }
  return out;
}

// ---------- Rendering ----------

function patchGeometry(cells) {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [], idx = [];
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) pos.push(i, 0, j);
  const row = cells + 1;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      // alternate the diagonal for a more even look
      if ((i + j) & 1) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(4 * 4096), 4);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aNode', inst);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e7, -1e7, -1e7), new THREE.Vector3(1e7, 1e7, 1e7));
  return g;
}

const TERRAIN_VS_PARS = /* glsl */`
uniform highp sampler2D uHeight;
uniform vec2 uLevelOff[${LEVELS}];
uniform vec2 uMorph[${LEVELS}];
uniform vec3 uCamPos;
uniform sampler2D uNormTex;
attribute vec4 aNode;
varying vec3 vTW;
varying float vCamDist;

float fetchH( ivec2 c, int L ) {
  int n = ${N} >> L;
  c = clamp( c, ivec2( 0 ), ivec2( n - 1 ) );
  return texelFetch( uHeight, c + ivec2( uLevelOff[ L ] ), 0 ).r;
}
float heightL( vec2 w, int L ) {
  float s = float( 1 << L );
  vec2 g = ( w + ${HALF}.0 ) / s;
  vec2 i = floor( g ), f = g - i;
  ivec2 c = ivec2( i );
  float a = fetchH( c, L ), b = fetchH( c + ivec2( 1, 0 ), L );
  float d = fetchH( c + ivec2( 0, 1 ), L ), e = fetchH( c + ivec2( 1, 1 ), L );
  return mix( mix( a, b, f.x ), mix( d, e, f.x ), f.y );
}`;

const TERRAIN_VS_BEGIN = /* glsl */`
  int L = int( aNode.w + 0.5 );
  vec2 grid = position.xz;
  vec2 w0 = aNode.xy + grid * aNode.z;
  float h0 = fetchH( ivec2( ( w0 + ${HALF}.0 ) / aNode.z ), L );
  float camD = distance( uCamPos, vec3( w0.x, h0, w0.y ) );
  float k = clamp( ( camD - uMorph[ L ].x ) / ( uMorph[ L ].y - uMorph[ L ].x ), 0.0, 1.0 );
  vec2 mg = grid - fract( grid * 0.5 ) * 2.0 * k;
  vec2 w = aNode.xy + mg * aNode.z;
  int L1 = min( L + 1, ${LEVELS - 1} );
  float hh = mix( heightL( w, L ), heightL( w, L1 ), k );
  vec3 transformed = vec3( w.x, hh, w.y );
  vTW = transformed;
  vCamDist = camD;
`;

const TERRAIN_VS_NORMAL = /* glsl */`
  vec2 nuv0 = ( w0 + ${HALF}.5 ) / ${N}.0;
  vec4 ntv = textureLod( uNormTex, nuv0, float( L ) );
  vec3 objectNormal = vec3( ntv.r * 2.0 - 1.0, 0.0, ntv.g * 2.0 - 1.0 );
  objectNormal.y = sqrt( max( 1.0 - dot( objectNormal.xz, objectNormal.xz ), 0.0 ) );
`;

const TERRAIN_FS_PARS = /* glsl */`
uniform sampler2D uNormTex;
uniform sampler2D uRoadTex;
uniform sampler2D uSplatTex;
uniform sampler2D uNoiseTex;
uniform mediump sampler2DArray uAlb;
uniform mediump sampler2DArray uNrm;
uniform float uRoadW;
uniform float uWater;
uniform float uWet;
varying vec3 vTW;
varying float vCamDist;

vec4 tA; vec4 tN;   // running albedo+roughness, normal+ao+height

// Height-aware blend of one more ground layer on top of what we have.
void addLayer( float layer, vec2 uv, float w ) {
  if ( w < 0.002 ) return;
  vec4 a = texture( uAlb, vec3( uv, layer ) );
  vec4 n = texture( uNrm, vec3( uv, layer ) );
  float ha = tN.a + ( 1.0 - w ) * 1.2;
  float hb = n.a + w * 1.2;
  float m = max( ha, hb ) - 0.25;
  float ba = max( ha - m, 0.0 ), bb = max( hb - m, 0.0 );
  float t = bb / ( ba + bb );
  tA = mix( tA, a, t );
  tN = mix( tN, n, t );
}
`;

const TERRAIN_FS_MAP = /* glsl */`
  vec2 wxz = vTW.xz;
  vec2 tuv = ( wxz + ${HALF}.5 ) / ${N}.0;
  vec4 nt = texture2D( uNormTex, tuv );
  vec3 macroN = vec3( nt.r * 2.0 - 1.0, 0.0, nt.g * 2.0 - 1.0 );
  macroN.y = sqrt( max( 1.0 - dot( macroN.xz, macroN.xz ), 0.0 ) );
  vec4 rd = texture2D( uRoadTex, tuv );
  float ad = rd.r * 16.0;
  float fromLine = ( rd.g - 0.5 ) * 16.0;
  float tarmac = rd.b;
  vec4 sp = texture2D( uSplatTex, ( wxz + ${HALF}.0 ) / ${N}.0 );
  vec4 n1 = texture2D( uNoiseTex, wxz / 257.0 );
  vec4 n2 = texture2D( uNoiseTex, wxz / 41.0 );
  vec4 n3 = texture2D( uNoiseTex, wxz / 7.3 );
  float slope = 1.0 - macroN.y;
  float above = vTW.y - uWater;

  // Grass everywhere, then meadow, dirt, forest floor, rock and sand on top.
  vec2 uvGrass = wxz / 3.1;
  tA = texture( uAlb, vec3( uvGrass, ${LAYER.GRASS}.0 ) );
  tN = texture( uNrm, vec3( uvGrass, ${LAYER.GRASS}.0 ) );
  addLayer( ${LAYER.MEADOW}.0, wxz / 3.7, smoothstep( 0.5, 0.66, n1.r + ( n2.g - 0.5 ) * 0.2 ) );
  addLayer( ${LAYER.DIRT}.0, wxz / 3.3, smoothstep( 0.66, 0.8, n1.g + ( n2.r - 0.5 ) * 0.3 ) * 0.9 );
  addLayer( ${LAYER.FOREST}.0, wxz / 3.9, smoothstep( 0.2, 0.55, sp.r + ( n2.b - 0.5 ) * 0.35 ) );
  addLayer( ${LAYER.ROCK}.0, wxz / 6.5, max( smoothstep( 0.3, 0.46, slope + ( n2.g - 0.5 ) * 0.18 ), sp.g * 0.8 ) );
  addLayer( ${LAYER.SAND}.0, wxz / 4.0, smoothstep( 1.3, 0.35, above + ( n3.r - 0.5 ) * 0.5 ) );

  // Road shoulders: loose gravel thrown out by passing cars.
  float edgeN = ( n3.g - 0.5 ) * 0.5 + ( n2.a - 0.5 ) * 0.3;
  float loose = 1.0 - smoothstep( uRoadW + 0.5, uRoadW + 1.9, ad + edgeN * 1.4 );
  addLayer( ${LAYER.GRAVEL}.0, wxz / 3.4, loose );
  tA.rgb *= mix( 1.0, 1.08, loose );

  // The road surface itself with two compacted wheel tracks along the racing line.
  float onRoad = 1.0 - smoothstep( uRoadW - 0.25, uRoadW + 0.25, ad + edgeN * 0.6 );
  float puddle = 0.0;
  if ( onRoad > 0.002 ) {
    vec2 ruv = wxz / 2.4;
    vec4 ga = texture( uAlb, vec3( ruv, ${LAYER.GRAVEL}.0 ) );
    vec4 gn = texture( uNrm, vec3( ruv, ${LAYER.GRAVEL}.0 ) );
    vec4 aa = texture( uAlb, vec3( wxz / 3.0, ${LAYER.ASPHALT}.0 ) );
    vec4 an = texture( uNrm, vec3( wxz / 3.0, ${LAYER.ASPHALT}.0 ) );
    float dr = abs( fromLine );
    float track = exp( -pow( ( dr - 0.82 ) / 0.34, 2.0 ) ) * ( 0.75 + 0.25 * n2.b );
    // compacted tracks: darker, flatter, fewer loose stones
    ga.rgb *= mix( 1.0, 0.72, track );
    ga.rgb = mix( ga.rgb, vec3( 0.36, 0.33, 0.29 ), track * 0.35 );
    gn.rg = mix( gn.rg, vec2( 0.5 ), track * 0.75 );
    ga.a = mix( ga.a, 0.8, track );
    // dust between and outside the tracks
    ga.rgb *= mix( 1.0, 1.1, ( 1.0 - track ) * smoothstep( 0.4, 0.8, n3.b ) );
    // rain: standing water in the ruts and the dips
    if ( uWet > 0.5 ) puddle = smoothstep( 0.6, 0.7, n2.g * 0.5 + n3.b * 0.25 + track * 0.35 ) * onRoad;
    aa.rgb *= mix( 1.0, 0.85, track );
    vec4 roadA = mix( ga, aa, tarmac );
    vec4 roadN = mix( gn, an, tarmac );
    tA = mix( tA, roadA, onRoad );
    tN = mix( tN, roadN, onRoad );
  }

  // Large-scale colour variation hides tiling.
  tA.rgb *= mix( 0.86, 1.1, n1.b ) * mix( 0.93, 1.05, n2.r );
  // Damp near the water's edge.
  float wet = smoothstep( 1.0, 0.1, above ) + uWet * 0.6;
  tA.rgb *= mix( 1.0, 0.62, clamp( wet, 0.0, 1.0 ) );
  tA.a = mix( tA.a, 0.35, clamp( wet, 0.0, 1.0 ) );
  // puddles: dark mirrors of the sky
  tA.rgb *= 1.0 - puddle * 0.55;
  tA.a = mix( tA.a, 0.03, puddle );

  diffuseColor.rgb = tA.rgb;
  float detailStrength = mix( 1.0, 0.25, smoothstep( 25.0, 140.0, vCamDist ) );
  vec3 dn = vec3( tN.r * 2.0 - 1.0, 0.0, tN.g * 2.0 - 1.0 ) * detailStrength * ( 1.0 - puddle );
  // raindrops stirring the puddles
  if ( puddle > 0.0 ) {
    vec2 rp = ( texture2D( uNoiseTex, wxz * 1.9 + uTime * vec2( 0.31, -0.23 ) ).rg + texture2D( uNoiseTex, wxz * 3.7 - uTime * vec2( 0.27, 0.35 ) ).rg - 1.0 );
    dn.xz += rp * 0.07 * puddle;
  }
  vec3 terrainNormalW = normalize( vec3( macroN.x + dn.x, macroN.y, macroN.z + dn.z ) );
  float terrainAO = nt.b * mix( 1.0, tN.b, detailStrength );
`;

export class Terrain {
  constructor(data, textures, { quality = 'high' } = {}) {
    this.data = data;
    const morph = RANGES.map((r, l) => {
      const prev = l === 0 ? 0 : RANGES[l - 1];
      return new THREE.Vector2(prev + (r - prev) * MORPH_START, r * 0.98);
    });
    this.uniforms = {
      uHeight: { value: data.heightTex },
      uLevelOff: { value: data.offsets },
      uMorph: { value: morph },
      uCamPos: { value: new THREE.Vector3() },
      uNormTex: { value: data.normalTex },
      uRoadTex: { value: data.roadTex },
      uSplatTex: { value: data.splatTex },
      uNoiseTex: { value: textures.noise },
      uAlb: { value: textures.ground.albedo },
      uNrm: { value: textures.ground.normal },
      uRoadW: { value: 3.6 },
      uWater: { value: WATER },
      uWet: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.9 });
    patch(mat, {
      uniforms: this.uniforms,
      vertexPars: TERRAIN_VS_PARS,
      vertex: {
        // three computes normals before positions, so displace the vertex first
        '#include <beginnormal_vertex>': TERRAIN_VS_BEGIN + TERRAIN_VS_NORMAL,
        '#include <begin_vertex>': '',
      },
      fragmentPars: TERRAIN_FS_PARS,
      fragment: {
        '#include <map_fragment>': TERRAIN_FS_MAP,
        '#include <roughnessmap_fragment>': 'float roughnessFactor = tA.a;',
        '#include <normal_fragment_begin>': `
          float faceDirection = 1.0;
          vec3 normal = normalize( ( viewMatrix * vec4( terrainNormalW, 0.0 ) ).xyz );
          vec3 nonPerturbedNormal = normal;`,
        '#include <normal_fragment_maps>': '',
        '#include <aomap_fragment>': `
          reflectedLight.indirectDiffuse *= terrainAO;
          reflectedLight.indirectSpecular *= terrainAO;`,
      },
    });
    this.material = mat;

    this.full = new THREE.Mesh(patchGeometry(P), mat);
    this.half = new THREE.Mesh(patchGeometry(P / 2), mat);
    for (const m of [this.full, this.half]) {
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false;
      m.matrixAutoUpdate = false;
    }
    this.group = new THREE.Group();
    this.group.add(this.full, this.half);

    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._cam = new THREE.Vector3();
    this.stats = { full: 0, half: 0 };
  }

  // Pick the quadtree nodes for this camera and fill the instance buffers.
  update(camera) {
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    this._cam.setFromMatrixPosition(camera.matrixWorld);
    this.uniforms.uCamPos.value.copy(this._cam);
    this._nf = 0;
    this._nh = 0;
    this._fa = this.full.geometry.attributes.aNode;
    this._ha = this.half.geometry.attributes.aNode;
    this._select(LEVELS - 1, 0, 0);
    for (const [mesh, count] of [[this.full, this._nf], [this.half, this._nh]]) {
      const a = mesh.geometry.attributes.aNode;
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * 4);
      a.needsUpdate = true;
      mesh.geometry.instanceCount = count;
    }
    this.stats.full = this._nf;
    this.stats.half = this._nh;
  }

  _nodeBox(l, ix, iz, size) {
    const mm = this.data.minmax[l];
    const cn = (N / P) >> l;
    const i = (iz * cn + ix) * 2;
    const x0 = -HALF + ix * size, z0 = -HALF + iz * size;
    this._box.min.set(x0, mm[i], z0);
    this._box.max.set(x0 + size, mm[i + 1], z0 + size);
    return this._box;
  }

  _intersectsSphere(box, r) {
    return box.distanceToPoint(this._cam) <= r;
  }

  _add(full, x0, z0, cell, l) {
    const a = full ? this._fa : this._ha;
    const k = full ? this._nf++ : this._nh++;
    if (k * 4 + 3 >= a.array.length) { full ? this._nf-- : this._nh--; return; }
    a.array[k * 4] = x0;
    a.array[k * 4 + 1] = z0;
    a.array[k * 4 + 2] = cell;
    a.array[k * 4 + 3] = l;
  }

  // Returns false if this node is beyond level l's range (the parent draws it).
  _select(l, ix, iz) {
    const size = P << l;
    const box = this._nodeBox(l, ix, iz, size);
    if (!this._intersectsSphere(box, RANGES[l])) return false;
    if (!this._frustum.intersectsBox(box)) return true;   // handled (culled)
    const x0 = -HALF + ix * size, z0 = -HALF + iz * size;
    if (l === 0 || !this._intersectsSphere(box, RANGES[l - 1])) {
      this._add(true, x0, z0, 1 << l, l);
      return true;
    }
    for (let k = 0; k < 4; k++) {
      const cx = ix * 2 + (k & 1), cz = iz * 2 + (k >> 1);
      if (!this._select(l - 1, cx, cz)) {
        // this quarter is too far for the finer level: draw it at ours
        const half = size >> 1;
        if (this._frustum.intersectsBox(this._nodeBox(l - 1, cx, cz, half))) {
          this._add(false, x0 + (k & 1) * half, z0 + (k >> 1) * half, 1 << l, l);
        }
      }
    }
    return true;
  }
}
