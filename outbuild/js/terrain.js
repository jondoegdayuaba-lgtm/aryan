// Island heightmap, terrain mesh with a splat-blended PBR shader, and height queries.
import * as THREE from 'three';
import { WORLD, GRID } from './config.js';
import { Noise2D, clamp, smoothstep, lerp } from './util.js';
import { POIS, ROADS } from './layout.js';

const SPLAT_RES = 512;

export class Terrain {
  constructor(seed) {
    this.size = WORLD.size;
    this.res = WORLD.res;
    this.n = this.size / this.res + 1; // vertices per side
    this.half = this.size / 2;
    this.noise = new Noise2D(seed);
    this.noise2 = new Noise2D(seed + 17);
    this.heights = new Float32Array(this.n * this.n);
    this.roadMask = new Float32Array(SPLAT_RES * SPLAT_RES);
    this.flatMask = new Float32Array(SPLAT_RES * SPLAT_RES); // building ground (no grass)
    this.poiHeights = new Map();
    this.generate();
    // the heights before any building levels the ground, so every rebuild of the island is identical
    this.base = this.heights.slice();
  }

  // ------------------------------------------------------------------ generation
  naturalHeight(x, z) {
    const nz = this.noise;
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const coast = WORLD.islandRadius * (1 + 0.1 * nz.noise(Math.cos(ang) * 1.3 + 5, Math.sin(ang) * 1.3 + 5)
      + 0.06 * nz.noise(Math.cos(ang) * 4 + 9, Math.sin(ang) * 4 - 3));
    const d = r / coast;
    const land = smoothstep(1.08, 0.78, d);
    let h = 3.2 + 7 * (nz.fbm(x * 0.0035 + 11, z * 0.0035 - 7, 5) * 0.5 + 0.5);
    // rolling hills
    h += 12 * Math.max(0, nz.fbm(x * 0.0065 - 3, z * 0.0065 + 2, 4)) ** 1.3;
    // big mountain in the north-east, ridges around it
    const mx = 250, mz = -218;
    const md = Math.hypot(x - mx, z - mz);
    h += 58 * Math.exp(-(md * md) / (2 * 78 * 78));
    h += 16 * this.noise2.ridged(x * 0.012, z * 0.012, 4) * Math.exp(-(md * md) / (2 * 120 * 120));
    // western bluffs
    const bx = -300, bz = -150;
    const bd = Math.hypot(x - bx, z - bz);
    h += 22 * Math.exp(-(bd * bd) / (2 * 70 * 70)) * (0.6 + 0.4 * nz.noise(x * 0.02, z * 0.02));
    // small detail
    h += 1.2 * nz.fbm(x * 0.03, z * 0.03, 3);
    // coast falls into the sea
    h = h * land + (1 - land) * (-14 + 4 * nz.noise(x * 0.01, z * 0.01));
    // beaches: flatten the last stretch near sea level
    const beach = smoothstep(0.7, 0.92, d) * smoothstep(1.1, 0.95, d);
    h = lerp(h, Math.min(h, 1.2 + (0.92 - d) * 20), beach * 0.85);
    return h;
  }

  generate() {
    const { n, res, half } = this;
    const H = this.heights;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res;
        const z = -half + j * res;
        H[j * n + i] = this.naturalHeight(x, z);
      }
    }
    // lakes and quarries dig down, towns flatten to a build level
    for (const p of POIS) {
      if (p.lake) this.carveLake(p);
      if (p.kind === 'quarry') this.carveQuarry(p);
    }
    for (const p of POIS) if (p.flat > 0 && p.kind !== 'quarry') this.flatten(p);
    this.buildRoads();
    this.smooth(1);
  }

  flatten(p) {
    const { n, res, half } = this;
    const H = this.heights;
    const center = this.sample(p.x, p.z);
    const lvl = Math.max(1, Math.round(center / GRID.level));
    const target = lvl * GRID.level - 0.05;
    this.poiHeights.set(p.name, lvl * GRID.level);
    const R = p.flat;
    const blend = 26;
    const i0 = Math.max(0, Math.floor((p.x - R - blend + half) / res));
    const i1 = Math.min(n - 1, Math.ceil((p.x + R + blend + half) / res));
    const j0 = Math.max(0, Math.floor((p.z - R - blend + half) / res));
    const j1 = Math.min(n - 1, Math.ceil((p.z + R + blend + half) / res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * res;
        const z = -half + j * res;
        // squarish footprint with rounded corners suits the grid-aligned towns
        const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z);
        const d = Math.max(dx, dz) * 0.7 + Math.hypot(dx, dz) * 0.3;
        const t = smoothstep(R + blend, R, d);
        if (t <= 0) continue;
        const k = j * n + i;
        H[k] = lerp(H[k], target, t);
      }
    }
  }

  carveLake(p) {
    const { n, res, half } = this;
    const H = this.heights;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res;
        const z = -half + j * res;
        const wob = 1 + 0.18 * this.noise.noise(x * 0.02, z * 0.02);
        const d = Math.hypot(x - p.x, z - p.z) / (p.lake * wob);
        if (d > 1.6) continue;
        const k = j * n + i;
        const depth = -6 * smoothstep(1.0, 0.2, d) - 1.5 * smoothstep(1.15, 0.9, d);
        const rim = smoothstep(1.6, 1.0, d);
        H[k] = lerp(H[k], Math.min(H[k], 1.5 + depth), rim);
      }
    }
  }

  carveQuarry(p) {
    const { n, res, half } = this;
    const H = this.heights;
    const center = this.sample(p.x, p.z);
    const lvl = Math.max(1, Math.round((center - 7) / GRID.level));
    const floor = lvl * GRID.level - 0.05;
    this.poiHeights.set(p.name, lvl * GRID.level);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res;
        const z = -half + j * res;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > p.flat + 30) continue;
        const k = j * n + i;
        // terraced pit walls
        const t = smoothstep(p.flat + 26, p.flat - 6, d);
        const terr = Math.floor(t * 3) / 3 * 0.7 + t * 0.3;
        H[k] = lerp(H[k], floor, terr);
      }
    }
  }

  buildRoads() {
    // paint a road mask and gently level the ground across each road
    const R = SPLAT_RES;
    const cell = this.size / R;
    const segs = [];
    for (const [a, b] of ROADS) {
      const pa = POIS[a];
      const pb = POIS[b];
      // meander with a couple of intermediate points
      const pts = [[pa.x, pa.z]];
      const steps = 6;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const x = lerp(pa.x, pb.x, t);
        const z = lerp(pa.z, pb.z, t);
        const nx = -(pb.z - pa.z);
        const nz = pb.x - pa.x;
        const len = Math.hypot(nx, nz) || 1;
        const off = this.noise2.noise(x * 0.01, z * 0.01) * 26 * Math.sin(t * Math.PI);
        pts.push([x + (nx / len) * off, z + (nz / len) * off]);
      }
      pts.push([pb.x, pb.z]);
      for (let s = 0; s < pts.length - 1; s++) segs.push([...pts[s], ...pts[s + 1]]);
    }
    this.roadSegs = segs;
    const width = 3.2;
    for (const [x0, z0, x1, z1] of segs) {
      const minx = Math.min(x0, x1) - 8, maxx = Math.max(x0, x1) + 8;
      const minz = Math.min(z0, z1) - 8, maxz = Math.max(z0, z1) + 8;
      const i0 = Math.max(0, Math.floor((minx + this.half) / cell));
      const i1 = Math.min(R - 1, Math.ceil((maxx + this.half) / cell));
      const j0 = Math.max(0, Math.floor((minz + this.half) / cell));
      const j1 = Math.min(R - 1, Math.ceil((maxz + this.half) / cell));
      const dx = x1 - x0, dz = z1 - z0;
      const l2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -this.half + (i + 0.5) * cell;
          const z = -this.half + (j + 0.5) * cell;
          const t = clamp(((x - x0) * dx + (z - z0) * dz) / l2, 0, 1);
          const d = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
          const w = smoothstep(width + 1.5, width - 1, d + this.noise.noise(x * 0.3, z * 0.3) * 0.8);
          const k = j * R + i;
          if (w > this.roadMask[k]) this.roadMask[k] = w;
        }
      }
    }
  }

  smooth(passes) {
    const { n } = this;
    const H = this.heights;
    const tmp = new Float32Array(H.length);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = j * n + i;
          if (i === 0 || j === 0 || i === n - 1 || j === n - 1) { tmp[k] = H[k]; continue; }
          tmp[k] = H[k] * 0.5 + (H[k - 1] + H[k + 1] + H[k - n] + H[k + n]) * 0.125;
        }
      }
      // keep flattened town levels exact
      for (let k = 0; k < H.length; k++) H[k] = tmp[k];
    }
    for (const p of POIS) {
      if (!(p.flat > 0)) continue;
      const lvl = this.poiHeights.get(p.name);
      if (lvl === undefined) continue;
      const R = p.flat - 2;
      const { res, half } = this;
      const i0 = Math.max(0, Math.floor((p.x - R + half) / res));
      const i1 = Math.min(n - 1, Math.ceil((p.x + R + half) / res));
      const j0 = Math.max(0, Math.floor((p.z - R + half) / res));
      const j1 = Math.min(n - 1, Math.ceil((p.z + R + half) / res));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -half + i * res, z = -half + j * res;
          const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z);
          const d = Math.max(dx, dz) * 0.7 + Math.hypot(dx, dz) * 0.3;
          if (d < R && p.kind !== 'quarry') H[j * n + i] = lvl - 0.05;
        }
      }
    }
  }

  // Level a rectangle to an exact build level (for houses outside the towns). Returns the level index.
  flattenRect(x0, z0, x1, z1, margin = 10) {
    const { n, res, half } = this;
    const H = this.heights;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const lvl = Math.max(1, Math.round(this.sample(cx, cz) / GRID.level));
    const target = lvl * GRID.level - 0.05;
    const i0 = Math.max(0, Math.floor((x0 - margin + half) / res));
    const i1 = Math.min(n - 1, Math.ceil((x1 + margin + half) / res));
    const j0 = Math.max(0, Math.floor((z0 - margin + half) / res));
    const j1 = Math.min(n - 1, Math.ceil((z1 + margin + half) / res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * res, z = -half + j * res;
        const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
        const d = Math.hypot(dx, dz);
        const t = smoothstep(margin, 1.5, d);
        const k = j * n + i;
        H[k] = lerp(H[k], target, t);
      }
    }
    return lvl;
  }

  // Mark an area as built-on (dirt, no grass) — called by world.js for building footprints.
  markFlat(x0, z0, x1, z1, value = 1) {
    const R = SPLAT_RES;
    const cell = this.size / R;
    const i0 = Math.max(0, Math.floor((x0 + this.half) / cell));
    const i1 = Math.min(R - 1, Math.floor((x1 + this.half) / cell));
    const j0 = Math.max(0, Math.floor((z0 + this.half) / cell));
    const j1 = Math.min(R - 1, Math.floor((z1 + this.half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * R + i;
      this.flatMask[k] = Math.max(this.flatMask[k], value);
    }
  }

  // ------------------------------------------------------------------ queries
  sample(x, z) {
    // bilinear sample of the raw grid (used during generation)
    const { n, res, half } = this;
    const fx = clamp((x + half) / res, 0, n - 1.001);
    const fz = clamp((z + half) / res, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = this.heights;
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // Exact height of the rendered triangles.
  heightAt(x, z) {
    const { n, res, half } = this;
    let fx = (x + half) / res;
    let fz = (z + half) / res;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return -14;
    const i = fx | 0, j = fz | 0;
    fx -= i; fz -= j;
    const H = this.heights;
    const a = H[j * n + i];
    const b = H[j * n + i + 1];
    const c = H[(j + 1) * n + i];
    const d = H[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.res;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  // Ray against the heightfield. Returns distance or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const step = 1.5;
    let prevT = 0;
    let prevDiff = oy - this.heightAt(ox, oz);
    if (prevDiff < 0) return 0;
    const maxH = WORLD.maxHeight + 20;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist);
      const y = oy + dy * tt;
      if (y > maxH && dy >= 0) return -1;
      const x = ox + dx * tt, z = oz + dz * tt;
      const diff = y - this.heightAt(x, z);
      if (diff <= 0) {
        // refine
        let a = prevT, b = tt;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) * 0.5;
          const dm = oy + dy * m - this.heightAt(ox + dx * m, oz + dz * m);
          if (dm > 0) a = m; else b = m;
        }
        return (a + b) * 0.5;
      }
      prevT = tt;
      prevDiff = diff;
      if (tt >= maxDist) break;
    }
    return -1;
  }

  // ------------------------------------------------------------------ textures
  buildSplat() {
    const R = SPLAT_RES;
    const data = new Uint8Array(R * R * 4);
    const cell = this.size / R;
    const nrm = new THREE.Vector3();
    this.grassMap = new Float32Array(R * R);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const x = -this.half + (i + 0.5) * cell;
        const z = -this.half + (j + 0.5) * cell;
        const h = this.heightAt(x, z);
        this.normalAt(x, z, nrm);
        const slope = 1 - nrm.y;
        const nz = this.noise.fbm(x * 0.02, z * 0.02, 3);
        const k = j * R + i;
        let rock = smoothstep(0.22, 0.4, slope + nz * 0.06);
        rock = Math.max(rock, smoothstep(58, 70, h + nz * 6) * 0.8);
        let sand = smoothstep(2.6 + nz * 0.8, 1.2, h);
        let dirt = Math.max(this.roadMask[k] * 0.95, this.flatMask[k] * 0.85);
        dirt = Math.max(dirt, smoothstep(0.45, 0.75, this.noise2.fbm(x * 0.012, z * 0.012, 4) * 0.5 + 0.5) * 0.7);
        dirt *= 1 - rock;
        sand *= 1 - rock;
        let grass = Math.max(0, 1 - rock - sand - dirt);
        const sum = grass + dirt + sand + rock || 1;
        grass /= sum; dirt /= sum; sand /= sum; rock /= sum;
        data[k * 4] = grass * 255;
        data[k * 4 + 1] = dirt * 255;
        data[k * 4 + 2] = sand * 255;
        data[k * 4 + 3] = rock * 255;
        this.grassMap[k] = h > 0.6 ? grass * (1 - this.flatMask[k]) : 0;
      }
    }
    const tex = new THREE.DataTexture(data, R, R, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.splatTex = tex;
    return tex;
  }

  grassAt(x, z) {
    const R = SPLAT_RES;
    const i = Math.floor((x + this.half) / this.size * R);
    const j = Math.floor((z + this.half) / this.size * R);
    if (i < 0 || j < 0 || i >= R || j >= R) return 0;
    return this.grassMap[j * R + i];
  }

  buildHeightTexture() {
    const tex = new THREE.DataTexture(this.heights, this.n, this.n, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.heightTex = tex;
    return tex;
  }

  // ------------------------------------------------------------------ mesh
  buildMesh(tex) {
    const group = new THREE.Group();
    group.name = 'terrain';
    const material = this.makeMaterial(tex);
    this.material = material;
    const chunks = 8;
    const quads = (this.n - 1) / chunks; // quads per chunk side
    const { n, res, half } = this;
    for (let cj = 0; cj < chunks; cj++) {
      for (let ci = 0; ci < chunks; ci++) {
        const vn = quads + 1;
        const pos = new Float32Array(vn * vn * 3);
        const nor = new Float32Array(vn * vn * 3);
        const v = new THREE.Vector3();
        let p = 0;
        for (let j = 0; j < vn; j++) {
          for (let i = 0; i < vn; i++) {
            const gi = ci * quads + i;
            const gj = cj * quads + j;
            const x = -half + gi * res;
            const z = -half + gj * res;
            pos[p] = x;
            pos[p + 1] = this.heights[gj * n + gi];
            pos[p + 2] = z;
            this.normalAt(x, z, v);
            nor[p] = v.x; nor[p + 1] = v.y; nor[p + 2] = v.z;
            p += 3;
          }
        }
        // skirt: a copy of the edge vertices hanging 4 m lower hides cracks between LOD levels
        const edge = [];
        for (let k = 0; k < vn; k++) edge.push(k, (vn - 1) * vn + k, k * vn, k * vn + vn - 1);
        const skirtOf = new Map();
        const allPos = Array.from(pos), allNor = Array.from(nor);
        let next = vn * vn;
        for (const e of edge) {
          if (skirtOf.has(e)) continue;
          skirtOf.set(e, next++);
          allPos.push(pos[e * 3], pos[e * 3 + 1] - 4, pos[e * 3 + 2]);
          allNor.push(nor[e * 3], nor[e * 3 + 1], nor[e * 3 + 2]);
        }
        const lods = [1, 2, 4].map((st) => {
          const out = [];
          for (let j = 0; j < quads; j += st) {
            for (let i = 0; i < quads; i += st) {
              const a = j * vn + i, b = a + st, c = a + st * vn, d = c + st;
              out.push(a, c, b, b, c, d);
            }
          }
          const side = (list) => {
            for (let k = 0; k + st < list.length; k += st) {
              const e0 = list[k], e1 = list[k + st], s0 = skirtOf.get(e0), s1 = skirtOf.get(e1);
              out.push(e0, s0, e1, e1, s0, s1, e0, e1, s0, e1, s1, s0);
            }
          };
          const top = [], bottom = [], left = [], right = [];
          for (let k = 0; k < vn; k++) { top.push(k); bottom.push((vn - 1) * vn + k); left.push(k * vn); right.push(k * vn + vn - 1); }
          side(top); side(bottom); side(left); side(right);
          return new THREE.BufferAttribute(new Uint32Array(out), 1);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPos), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(allNor), 3));
        g.setIndex(lods[0]);
        g.userData.lods = lods;
        g.userData.lod = 0;
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const m = new THREE.Mesh(g, material);
        m.receiveShadow = true;
        m.castShadow = true;
        m.matrixAutoUpdate = false;
        group.add(m);
      }
    }
    this.mesh = group;
    return group;
  }

  // Pick a mesh resolution per chunk from the camera distance.
  updateLod(cam) {
    if (!this.mesh) return;
    for (const m of this.mesh.children) {
      const g = m.geometry;
      const c = g.boundingSphere.center;
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      const lod = d < 170 ? 0 : d < 380 ? 1 : 2;
      if (lod !== g.userData.lod) { g.userData.lod = lod; g.setIndex(g.userData.lods[lod]); }
    }
  }

  makeMaterial(tex) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    const uniforms = {
      tSplat: { value: this.splatTex },
      tGrass: { value: tex.grass }, tGrassN: { value: tex.grass_n },
      tDirt: { value: tex.dirt }, tDirtN: { value: tex.dirt_n },
      tSand: { value: tex.sand }, tSandN: { value: tex.sand_n },
      tRock: { value: tex.rock }, tRockN: { value: tex.rock_n },
      uMapSize: { value: this.size },
    };
    this.terrainUniforms = uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTPos;\nvarying vec3 vTNrm;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTNrm = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTPos;
          varying vec3 vTNrm;
          uniform sampler2D tSplat, tGrass, tGrassN, tDirt, tDirtN, tSand, tSandN, tRock, tRockN;
          uniform float uMapSize;
          vec4 terrainW;
          vec3 terrainN;
          vec3 tri(sampler2D t, vec3 p, vec3 w, float s) {
            return texture2D(t, p.xz * s).rgb * w.y + texture2D(t, p.xy * s).rgb * w.z + texture2D(t, p.zy * s).rgb * w.x;
          }`)
        .replace('#include <map_fragment>', `
          vec4 sp = texture2D(tSplat, vTPos.xz / uMapSize + 0.5);
          vec3 wn = normalize(vTNrm);
          float slopeRock = smoothstep(0.62, 0.78, 1.0 - wn.y);
          sp.a = max(sp.a, slopeRock);
          sp.rgb *= 1.0 - slopeRock;
          // break up the blend edges with the textures' own detail
          vec2 uvG = vec2(vTPos.x, -vTPos.z) / 5.5;
          vec2 uvD = vec2(vTPos.x, -vTPos.z) / 4.0;
          vec2 uvS = vec2(vTPos.x, -vTPos.z) / 6.0;
          vec3 cG = texture2D(tGrass, uvG).rgb * 0.6 + texture2D(tGrass, uvG * 0.23 + 0.37).rgb * 0.4;
          vec3 cD = texture2D(tDirt, uvD).rgb * 0.7 + texture2D(tDirt, uvD * 0.27).rgb * 0.3;
          vec3 cS = texture2D(tSand, uvS).rgb;
          vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 cR = tri(tRock, vTPos * vec3(1.0, 1.0, -1.0), bw, 1.0 / 9.0);
          float nG = cG.g, nD = cD.r, nS = cS.r, nR = cR.r;
          vec4 w = sp * (vec4(nG, nD, nS, nR) * 0.6 + 0.4);
          w = pow(w, vec4(2.0));
          w /= max(1e-4, w.r + w.g + w.b + w.a);
          terrainW = w;
          vec3 tcol = cG * w.r + cD * w.g + cS * w.b + cR * w.a;
          // large-scale colour variation
          float macro = texture2D(tGrass, vTPos.xz / 170.0).g;
          tcol *= 0.85 + 0.3 * macro;
          // wet sand near the water line
          tcol *= mix(0.7, 1.0, smoothstep(-0.2, 0.9, vTPos.y));
          diffuseColor.rgb *= tcol;
        `)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          roughnessFactor = mix(roughnessFactor, 0.55, smoothstep(0.6, -0.3, vTPos.y));
        `)
        .replace('#include <normal_fragment_maps>', `
          {
            vec3 N = normalize(vTNrm);
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
            vec3 B = cross(N, T);
            vec3 nG = texture2D(tGrassN, uvG).xyz * 2.0 - 1.0;
            vec3 nD = texture2D(tDirtN, uvD).xyz * 2.0 - 1.0;
            vec3 nS = texture2D(tSandN, uvS).xyz * 2.0 - 1.0;
            vec3 nR = tri(tRockN, vTPos * vec3(1.0, 1.0, -1.0), bw, 1.0 / 9.0) * 2.0 - 1.0;
            vec3 tn = nG * terrainW.r + nD * terrainW.g + nS * terrainW.b + nR * terrainW.a;
            tn.xy *= 0.9;
            vec3 wN = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.2));
            normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
          }
        `);
    };
    mat.customProgramCacheKey = () => 'terrain-v1';
    return mat;
  }
}
