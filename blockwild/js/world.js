// Chunked voxel world: terrain generation, meshing with ambient occlusion,
// block edits and ray casting.
import * as THREE from 'three';
import { makeNoise2D, hash2, fbm } from './noise.js';
import { B, BLOCKS } from './blocks.js';

export const CS = 16;
export const CH = 96;
export const SEA = 30;
const IDX = (x, y, z) => (y * CS + z) * CS + x;
const ckey = (cx, cz) => `${cx},${cz}`;

// Face table: direction and the four corners (in the order the index
// pattern 0,1,2 / 2,1,3 expects) with their texture coordinates.
const FACES = [
  { dir: [-1, 0, 0], shade: 0.8, slot: 1, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.8, slot: 1, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, slot: 2, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1.0, slot: 0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.65, slot: 1, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.65, slot: 1, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const AO = [0.42, 0.6, 0.8, 1];

class MeshBuf {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  toGeometry() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export class World {
  constructor(seed, atlas, materials, scene) {
    this.seed = seed;
    this.atlas = atlas;
    this.materials = materials;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.edits = new Map(); // chunk key -> Map(index -> block id)
    this.nC = makeNoise2D(seed);
    this.nH = makeNoise2D(seed + 1);
    this.nM = makeNoise2D(seed + 2);
    this.nR = makeNoise2D(seed + 3);
    this.nB = makeNoise2D(seed + 4);
    this.nF = makeNoise2D(seed + 5);
  }

  // ------------------------------------------------------------ terrain

  heightAt(x, z) {
    const c = fbm(this.nC, x / 260, z / 260, 3);
    const hill = fbm(this.nH, x / 70, z / 70, 4);
    const mr = fbm(this.nM, x / 380 + 50, z / 380 - 30, 3);
    let m = Math.min(1, Math.max(0, (mr - 0.05) / 0.45));
    m = m * m * (3 - 2 * m);
    const ridge = 1 - Math.abs(this.nR(x / 90, z / 90));
    const h = SEA + 4 + c * 8 + hill * (3 + m * 6) + m * (26 + ridge * 22);
    return Math.max(3, Math.min(CH - 12, Math.floor(h)));
  }

  biome(x, z) {
    const b = this.nB(x / 210, z / 210);
    return b > 0.3 ? 'cherry' : b < -0.25 ? 'forest' : 'plains';
  }

  surface(x, z, h) {
    if (h < SEA) {
      const f = this.nF(x / 24, z / 24);
      const s = f > 0.25 ? B.GRAVEL : f < -0.3 ? B.DIRT : B.SAND;
      return [s, s];
    }
    const j = hash2(this.seed + 9, x, z) * 4;
    if (h >= SEA + 38 + j) return [B.SNOW, B.STONE];
    if (h >= SEA + 27 + j) return [B.STONE, B.STONE];
    if (h <= SEA + 1) return [B.SAND, B.SAND];
    return [B.GRASS, B.DIRT];
  }

  generate(ch) {
    const data = ch.data;
    const ox = ch.cx * CS, oz = ch.cz * CS;
    let maxY = SEA;
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const x = ox + lx, z = oz + lz;
        const h = this.heightAt(x, z);
        const [top, fill] = this.surface(x, z, h);
        for (let y = 0; y <= Math.max(h, SEA); y++) {
          let id;
          if (y === 0 || (y < 3 && hash2(this.seed + y, x, z) < 0.5)) id = B.BEDROCK;
          else if (y < h - 3) id = B.STONE;
          else if (y < h) id = fill;
          else if (y === h) id = top;
          else id = B.WATER;
          data[IDX(lx, y, lz)] = id;
        }
        if (h > maxY) maxY = h;
        if (top === B.GRASS && h + 1 < CH) {
          const biome = this.biome(x, z);
          const r = hash2(this.seed + 1, x, z);
          const grassChance = biome === 'plains' ? 0.28 : biome === 'cherry' ? 0.2 : 0.12;
          if (r < 0.025) data[IDX(lx, h + 1, lz)] = r < 0.012 ? B.FLOWER_RED : B.FLOWER_YELLOW;
          else if (r < grassChance) data[IDX(lx, h + 1, lz)] = B.TALLGRASS;
        }
      }
    }
    // Trees, including ones rooted just outside this chunk whose leaves reach in.
    for (let lz = -3; lz < CS + 3; lz++) {
      for (let lx = -3; lx < CS + 3; lx++) {
        const x = ox + lx, z = oz + lz;
        const r = hash2(this.seed + 7, x, z);
        if (r > 0.05) continue;
        const biome = this.biome(x, z);
        const chance = biome === 'forest' ? 0.045 : biome === 'cherry' ? 0.02 : 0.005;
        if (r > chance) continue;
        const h = this.heightAt(x, z);
        if (h <= SEA + 1 || this.surface(x, z, h)[0] !== B.GRASS) continue;
        if (biome === 'cherry') this.cherryTree(ch, x, h + 1, z);
        else this.oakTree(ch, x, h + 1, z);
        maxY = Math.max(maxY, h + 10);
      }
    }
    ch.maxY = Math.min(CH - 1, maxY + 1);
    // Player edits are replayed on top.
    const ed = this.edits.get(ch.key);
    if (ed) for (const [i, id] of ed) { data[i] = id; ch.maxY = Math.max(ch.maxY, Math.floor(i / (CS * CS)) + 1); }
    ch.maxY = Math.min(CH - 1, ch.maxY);
  }

  putTree(ch, x, y, z, id, force) {
    const lx = x - ch.cx * CS, lz = z - ch.cz * CS;
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= CH) return;
    const i = IDX(lx, y, lz);
    const cur = ch.data[i];
    if (force || cur === B.AIR || BLOCKS[cur].cross) ch.data[i] = id;
  }

  oakTree(ch, x, y, z) {
    const th = 4 + Math.floor(hash2(this.seed + 11, x, z) * 3);
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy >= th ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r) {
            if (dy >= th || hash2(this.seed + dy, x + dx, z + dz) < 0.5) continue;
          }
          this.putTree(ch, x + dx, y + dy, z + dz, B.LEAVES, false);
        }
      }
    }
    for (let i = 0; i < th; i++) this.putTree(ch, x, y + i, z, B.LOG, true);
  }

  cherryTree(ch, x, y, z) {
    const th = 5 + Math.floor(hash2(this.seed + 12, x, z) * 2);
    const layers = [[th - 1, 3, 10], [th, 3, 8], [th + 1, 2, 4]];
    for (const [dy, r, r2] of layers) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const d = dx * dx + dz * dz;
          if (d > r2) continue;
          this.putTree(ch, x + dx, y + dy, z + dz, B.BLOSSOM, false);
          if (dy === th - 1 && d >= 5 && hash2(this.seed + 31, x + dx, z + dz) < 0.35) {
            this.putTree(ch, x + dx, y + dy - 1, z + dz, B.BLOSSOM, false);
          }
        }
      }
    }
    for (let i = 0; i < th; i++) this.putTree(ch, x, y + i, z, B.CHERRY_LOG, true);
  }

  // ------------------------------------------------------------ access

  chunkData(cx, cz) {
    const k = ckey(cx, cz);
    let ch = this.chunks.get(k);
    if (!ch) {
      ch = { key: k, cx, cz, data: new Uint8Array(CS * CS * CH), maxY: 0, meshes: [], dirty: true, meshed: false };
      this.generate(ch);
      this.chunks.set(k, ch);
    }
    return ch;
  }

  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return B.AIR;
    const ch = this.chunkData(Math.floor(x / CS), Math.floor(z / CS));
    return ch.data[IDX(x & 15, y, z & 15)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= CH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const ch = this.chunkData(cx, cz);
    const lx = x & 15, lz = z & 15;
    const i = IDX(lx, y, lz);
    ch.data[i] = id;
    ch.maxY = Math.max(ch.maxY, Math.min(CH - 1, y + 1));
    let ed = this.edits.get(ch.key);
    if (!ed) this.edits.set(ch.key, (ed = new Map()));
    ed.set(i, id);
    this.rebuild(ch);
    if (lx === 0) this.rebuildAt(cx - 1, cz);
    if (lx === 15) this.rebuildAt(cx + 1, cz);
    if (lz === 0) this.rebuildAt(cx, cz - 1);
    if (lz === 15) this.rebuildAt(cx, cz + 1);
  }

  rebuildAt(cx, cz) {
    const ch = this.chunks.get(ckey(cx, cz));
    if (ch && ch.meshed) this.rebuild(ch);
  }

  // ------------------------------------------------------------ meshing

  rebuild(ch) {
    for (const m of ch.meshes) { this.group.remove(m); m.geometry.dispose(); }
    ch.meshes = [];
    const ox = ch.cx * CS, oz = ch.cz * CS;
    // Make sure neighbours exist so border faces are correct.
    this.chunkData(ch.cx - 1, ch.cz); this.chunkData(ch.cx + 1, ch.cz);
    this.chunkData(ch.cx, ch.cz - 1); this.chunkData(ch.cx, ch.cz + 1);
    const data = ch.data;
    const get = (x, y, z) => {
      if (y < 0) return B.BEDROCK;
      if (y >= CH) return B.AIR;
      if (x >= 0 && x < CS && z >= 0 && z < CS) return data[IDX(x, y, z)];
      return this.get(ox + x, y, oz + z);
    };
    const occ = (x, y, z) => (BLOCKS[get(x, y, z)].occludes ? 1 : 0);
    const solid = new MeshBuf(), plants = new MeshBuf(), water = new MeshBuf();
    const uvOf = this.atlas.uv;

    for (let y = 0; y <= ch.maxY; y++) {
      for (let z = 0; z < CS; z++) {
        for (let x = 0; x < CS; x++) {
          const id = data[IDX(x, y, z)];
          if (!id) continue;
          const d = BLOCKS[id];
          if (d.cross) { this.addCross(plants, x, y, z, uvOf(d.tex[1])); continue; }
          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const [dx, dy, dz] = face.dir;
            const n = get(x + dx, y + dy, z + dz);
            const nd = BLOCKS[n];
            if (nd.opaque) continue;
            if ((d.liquid || id === B.GLASS) && n === id) continue;
            if (d.liquid && nd.solid && !nd.opaque && n !== B.GLASS && dy === 0) continue;
            const buf = d.liquid ? water : solid;
            const [u0, v0, u1, v1] = uvOf(d.tex[face.slot]);
            const base = buf.n;
            const lowerTop = d.liquid && get(x, y + 1, z) !== id;
            const ao = [0, 0, 0, 0];
            for (let c = 0; c < 4; c++) {
              const [px, py, pz, cu, cv] = face.corners[c];
              buf.pos.push(x + px, y + py - (lowerTop && py === 1 ? 0.12 : 0), z + pz);
              buf.uv.push(u0 + cu * (u1 - u0), v0 + cv * (v1 - v0));
              let a = 3;
              if (!d.liquid) {
                const bx = x + dx, by = y + dy, bz = z + dz;
                const sx = px ? 1 : -1, sy = py ? 1 : -1, sz = pz ? 1 : -1;
                let s1, s2, cr;
                if (dx) { s1 = occ(bx, by + sy, bz); s2 = occ(bx, by, bz + sz); cr = occ(bx, by + sy, bz + sz); }
                else if (dy) { s1 = occ(bx + sx, by, bz); s2 = occ(bx, by, bz + sz); cr = occ(bx + sx, by, bz + sz); }
                else { s1 = occ(bx + sx, by, bz); s2 = occ(bx, by + sy, bz); cr = occ(bx + sx, by + sy, bz); }
                a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
              }
              ao[c] = a;
              const l = face.shade * AO[a];
              buf.col.push(l, l, l);
            }
            if (ao[0] + ao[3] > ao[1] + ao[2]) buf.idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
            else buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            buf.n += 4;
          }
        }
      }
    }

    const add = (buf, mat, order) => {
      const g = buf.toGeometry();
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.position.set(ox, 0, oz);
      m.renderOrder = order;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
      ch.meshes.push(m);
    };
    add(solid, this.materials.solid, 0);
    add(plants, this.materials.plants, 0);
    add(water, this.materials.water, 2);
    ch.dirty = false;
    ch.meshed = true;
  }

  addCross(buf, x, y, z, [u0, v0, u1, v1]) {
    const a = 0.15, b = 0.85;
    const quads = [[[x + a, z + a], [x + b, z + b]], [[x + b, z + a], [x + a, z + b]]];
    for (const [[x0, z0], [x1, z1]] of quads) {
      const base = buf.n;
      buf.pos.push(x0, y, z0, x1, y, z1, x0, y + 1, z0, x1, y + 1, z1);
      buf.uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
      for (let i = 0; i < 4; i++) buf.col.push(0.92, 0.92, 0.92);
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      buf.n += 4;
    }
  }

  // ------------------------------------------------------------ streaming

  // Builds meshes near (px, pz) within a time budget and unloads far chunks.
  // Returns how many chunks inside `ready` radius are meshed vs needed.
  update(px, pz, radius, budgetMs, ready = 2) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const want = [];
    let readyNeed = 0, readyHave = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius + 1) continue;
        const ch = this.chunks.get(ckey(pcx + dx, pcz + dz));
        const isReady = ch && ch.meshed && !ch.dirty;
        if (d2 <= ready * ready + 1) { readyNeed++; if (isReady) readyHave++; }
        if (!isReady) want.push([d2, pcx + dx, pcz + dz]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    for (let i = 0; i < want.length; i++) {
      const ch = this.chunkData(want[i][1], want[i][2]);
      this.rebuild(ch);
      if (want[i][0] <= ready * ready + 1) readyHave++;
      if (performance.now() - t0 > budgetMs) break;
    }
    // Unload: drop meshes outside the view, and block data further out.
    const far = (radius + 2) * (radius + 2), farther = (radius + 5) * (radius + 5);
    for (const [k, ch] of this.chunks) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz, d2 = dx * dx + dz * dz;
      if (d2 > far && ch.meshes.length) {
        for (const m of ch.meshes) { this.group.remove(m); m.geometry.dispose(); }
        ch.meshes = [];
        ch.meshed = false;
      }
      if (d2 > farther) this.chunks.delete(k);
    }
    return { need: readyNeed, have: readyHave };
  }

  dispose() {
    for (const ch of this.chunks.values()) for (const m of ch.meshes) m.geometry.dispose();
    this.group.parent?.remove(this.group);
    this.chunks.clear();
  }

  // ------------------------------------------------------------ queries

  // Voxel traversal from `o` along unit vector `d`. Ignores air and water.
  raycast(o, d, maxDist) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity;
    const tdy = sy ? Math.abs(1 / d.y) : Infinity;
    const tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tx = sx ? (sx > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
    let ty = sy ? (sy > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity;
    let tz = sz ? (sz > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
    let normal = [0, 0, 0], t = 0;
    while (t <= maxDist) {
      const id = this.get(x, y, z);
      if (id && !BLOCKS[id].liquid) return { x, y, z, id, normal, dist: t };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; normal = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; normal = [0, -sy, 0]; }
      else { z += sz; t = tz; tz += tdz; normal = [0, 0, -sz]; }
    }
    return null;
  }

  findSpawn() {
    for (let r = 0; r < 400; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
        const h = this.heightAt(x, z);
        if (h > SEA + 1 && h < SEA + 20 && this.surface(x, z, h)[0] === B.GRASS && this.clearAbove(x, h + 1, z)) {
          return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
        if (r === 0) break;
      }
    }
    return { x: 0.5, y: this.heightAt(0, 0) + 1, z: 0.5 };
  }

  // True when nothing solid (trunks, leaves) is in the 8 blocks above.
  clearAbove(x, y, z) {
    for (let i = 0; i < 8; i++) {
      const id = this.get(x, y + i, z);
      if (BLOCKS[id].solid || id === B.LEAVES || id === B.BLOSSOM) return false;
    }
    return true;
  }

  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) out[k] = [...m];
    return out;
  }

  loadEdits(obj) {
    for (const k in obj || {}) this.edits.set(k, new Map(obj[k]));
  }
}
