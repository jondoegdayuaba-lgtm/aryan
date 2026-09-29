// Forests, shrubs and boulders: scatters the Blender models over the valley from the world's
// density maps and draws them as instanced meshes, swapping to simpler versions with distance.
import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';
import { loadModel, meshesOf } from './models.js';
import { makeBark, makePineBranch, makeLeafCluster, makeRockTextures } from './textures.js';
import { hash2, smoothstep, clamp, rng } from './util.js';

const WIND_VERT = /* glsl */`
uniform float uTime;
uniform vec2 uWind;
`;

// Sway grows with height squared, so trunks stay put and crowns move.
function windEdit(strength) {
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_VERT)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3( instanceMatrix[3] );
        #else
          vec3 ip = vec3( 0.0 );
        #endif
        float ph = ip.x * 0.11 + ip.z * 0.13;
        float gust = sin( uTime * 1.1 + ph ) * 0.6 + sin( uTime * 2.9 + ph * 2.3 ) * 0.4;
        float bend = transformed.y * transformed.y * ${strength.toFixed(5)} * ( 0.35 + length( uWind ) );
        transformed.x += uWind.x * gust * bend;
        transformed.z += uWind.y * gust * bend;
        transformed.y += sin( uTime * 6.0 + ph * 5.0 + transformed.x * 3.0 ) * 0.01 * bend * 6.0;`);
  };
}

function makeMaterials() {
  const M = {};
  const pineBark = makeBark('pine');
  M.Bark_Pine = new THREE.MeshStandardMaterial({ map: pineBark.map, normalMap: pineBark.normalMap, vertexColors: true, roughness: 0.95 });
  patchMaterial(M.Bark_Pine, 'bark-wind', windEdit(0.00022));
  const birchBark = makeBark('birch');
  M.Bark_Birch = new THREE.MeshStandardMaterial({ map: birchBark.map, normalMap: birchBark.normalMap, vertexColors: true, roughness: 0.8 });
  patchMaterial(M.Bark_Birch, 'birchbark-wind', windEdit(0.0004));
  M.Bark_Dead = new THREE.MeshStandardMaterial({ map: pineBark.map, normalMap: pineBark.normalMap, vertexColors: true, roughness: 1, color: 0x9a948a });
  patchMaterial(M.Bark_Dead, 'deadbark', null);

  const needles = makePineBranch();
  M.Pine_Needles = new THREE.MeshStandardMaterial({ map: needles, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9 });
  M.Pine_Needles.color.setRGB(2.4, 2.4, 2.2);
  patchMaterial(M.Pine_Needles, 'needles-wind', windEdit(0.0011));
  M.Pine_Far = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0xffffff });
  M.Pine_Far.color.setRGB(0.16, 0.42, 0.2);
  patchMaterial(M.Pine_Far, 'pinefar-wind', windEdit(0.0006));

  const leaf = makeLeafCluster();
  M.Leaf_Autumn = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 });
  patchMaterial(M.Leaf_Autumn, 'leaf-wind', windEdit(0.0016));
  M.Leaf_Green = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, color: 0x6f9a3a });
  M.Leaf_Green.color.multiplyScalar(1.6);
  patchMaterial(M.Leaf_Green, 'leafgreen-wind', windEdit(0.0016));

  const rock = makeRockTextures();
  M.Rock = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, vertexColors: true, roughness: 0.9 });
  patchMaterial(M.Rock, 'rock', null);
  return M;
}

// Which model file, variants and level-of-detail distances each kind of plant uses.
const KINDS = {
  pine:  { file: 'pine',  variants: ['A', 'B', 'C'], lods: [90, 300, 1500], shadow: [true, true, false], trunk: 0.3 },
  birch: { file: 'birch', variants: ['A', 'B', 'C'], lods: [80, 260, 1000], shadow: [true, true, false], trunk: 0.22 },
  snag:  { file: 'snag',  variants: ['A', 'B'],      lods: [90, 260, 700],  shadow: [true, true, false], trunk: 0.25 },
  shrub: { file: 'shrub', variants: ['A', 'B'],      lods: [50, 130, 260],  shadow: [false, false, false], trunk: 0 },
  rock:  { file: 'rock',  variants: ['A', 'B', 'C', 'D', 'E'], lods: [110, 380, 1100], shadow: [true, true, false], trunk: 0 },
};
const CELL = [64, 128, 256];   // grid size for each level of detail

export class Flora {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.items = [];          // {kind, variant, x, y, z, yaw, scale, tint}
    this.colliders = [];      // {x, z, r} for trunks and boulders
    this.cells = [{}, {}, {}];
    this.models = {};
    this.lodScale = 1;
    this.shadows = true;
  }

  async load() {
    this.materials = makeMaterials();
    for (const [kind, def] of Object.entries(KINDS)) {
      const scene = await loadModel(def.file);
      this.models[kind] = {};
      for (const v of def.variants) {
        this.models[kind][v] = [0, 1, 2].map((l) => meshesOf(scene, `${v}_lod${l}`));
      }
    }
  }

  // Scatters everything from the world's forest, slope and water data.
  scatter(exclude = () => false) {
    const w = this.world, items = this.items, S = { trail: 0, forest: 0, shore: 0, lush: 0 }, N = { x: 0, y: 1, z: 0 }, Wt = { depth: 0 };
    const add = (kind, variant, x, z, scale, dy = 0, tint = 1) => {
      const y = w.heightAt(x, z) + dy;
      items.push({ kind, variant, x, y, z, yaw: hash2(x * 7 | 0, z * 7 | 0, 5) * Math.PI * 2, scale, tint });
      const t = KINDS[kind].trunk;
      if (t) this.colliders.push({ x, z, r: t * scale });
    };
    const ok = (x, z, minNy) => {
      if (Math.abs(x) > 1000 || Math.abs(z) > 1000) return false;
      w.waterAt(x, z, Wt);
      if (Wt.depth > 0) return false;
      w.normalAt(x, z, N);
      if (N.y < minNy) return false;
      return !exclude(x, z);
    };

    // Trees on a jittered grid, thinned by the forest map.
    const step = 6.4;
    for (let gz = -1000; gz < 1000; gz += step) {
      for (let gx = -1000; gx < 1000; gx += step) {
        const ix = Math.round(gx / step), iz = Math.round(gz / step);
        const x = gx + (hash2(ix, iz, 1) - 0.5) * step * 0.95, z = gz + (hash2(ix, iz, 2) - 0.5) * step * 0.95;
        w.splatAt(x, z, S);
        if (hash2(ix, iz, 3) > S.forest * 0.95) continue;
        if (!ok(x, z, 0.8)) continue;
        const elev = w.heightAt(x, z) - w.lakeY;
        const r = hash2(ix, iz, 4);
        const birchChance = 0.3 * (1 - smoothstep(15, 90, elev)) * (0.4 + S.lush);
        if (r < 0.025) add('snag', hash2(ix, iz, 6) < 0.5 ? 'A' : 'B', x, z, 0.8 + hash2(ix, iz, 7) * 0.5);
        else if (r < 0.025 + birchChance) add('birch', ['A', 'B', 'C'][(hash2(ix, iz, 6) * 3) | 0], x, z, 0.8 + hash2(ix, iz, 7) * 0.45);
        else add('pine', ['A', 'B', 'C'][(hash2(ix, iz, 6) * 3) | 0], x, z, 0.7 + hash2(ix, iz, 7) * 0.65 - Math.max(0, elev - 130) * 0.003);
      }
    }
    // Shrubs: thick at forest edges, scattered in meadows.
    for (let gz = -1000; gz < 1000; gz += 4.6) {
      for (let gx = -1000; gx < 1000; gx += 4.6) {
        const ix = Math.round(gx / 4.6), iz = Math.round(gz / 4.6);
        const x = gx + hash2(ix, iz, 11) * 4, z = gz + hash2(ix, iz, 12) * 4;
        w.splatAt(x, z, S);
        const edge = S.forest * (1 - S.forest) * 4;
        if (hash2(ix, iz, 13) > 0.05 + 0.45 * edge + 0.1 * S.forest) continue;
        if (S.trail > 0.3 || S.shore > 0.5 || !ok(x, z, 0.75)) continue;
        add('shrub', hash2(ix, iz, 14) < 0.5 ? 'A' : 'B', x, z, 0.7 + hash2(ix, iz, 15) * 0.8, -0.05, 0.75 + hash2(ix, iz, 16) * 0.4);
      }
    }
    // Rocks: on slopes, along shores and scattered on meadows.
    for (let gz = -1000; gz < 1000; gz += 9) {
      for (let gx = -1000; gx < 1000; gx += 9) {
        const ix = Math.round(gx / 9), iz = Math.round(gz / 9);
        const x = gx + hash2(ix, iz, 21) * 9, z = gz + hash2(ix, iz, 22) * 9;
        w.splatAt(x, z, S);
        w.normalAt(x, z, N);
        const slopeBoost = smoothstep(0.95, 0.72, N.y);
        const p = 0.035 + 0.5 * slopeBoost + 0.2 * S.shore;
        if (hash2(ix, iz, 23) > p) continue;
        if (S.trail > 0.25 || !ok(x, z, 0.35)) continue;
        const big = hash2(ix, iz, 24);
        const variant = big < 0.4 ? 'E' : big < 0.68 ? 'B' : big < 0.86 ? 'A' : big < 0.96 ? 'C' : 'D';
        add('rock', variant, x, z, 0.8 + hash2(ix, iz, 25) * 0.7, -0.12, 0.85 + hash2(ix, iz, 26) * 0.3);
        const it = items[items.length - 1];
        const sz = { A: 1.3, B: 0.8, C: 2.4, D: 4.2, E: 0.45 }[variant] * it.scale;
        this.colliders.push({ x, z, r: sz * 0.85 });
      }
    }
    return this;
  }

  // Sorts every item into the grid cells of each level of detail.
  index() {
    for (let l = 0; l < 3; l++) {
      const cells = (this.cells[l] = {});
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        const key = `${it.kind}|${Math.floor(it.x / CELL[l])}|${Math.floor(it.z / CELL[l])}`;
        (cells[key] ||= { kind: it.kind, cx: Math.floor(it.x / CELL[l]), cz: Math.floor(it.z / CELL[l]), ids: [], meshes: null, visible: false, lod: l }).ids.push(i);
      }
    }
  }

  _build(cell) {
    const def = KINDS[cell.kind], group = new THREE.Group();
    const byVariant = {};
    for (const id of cell.ids) (byVariant[this.items[id].variant] ||= []).push(this.items[id]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [variant, list] of Object.entries(byVariant)) {
      for (const src of this.models[cell.kind][variant][cell.lod]) {
        const mat = this.materials[src.material.name] || src.material;
        const mesh = new THREE.InstancedMesh(src.geometry, mat, list.length);
        list.forEach((it, i) => {
          q.setFromAxisAngle(up, it.yaw);
          p.set(it.x, it.y, it.z);
          sc.setScalar(it.scale);
          m4.compose(p, q, sc);
          mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, col.setScalar(it.tint));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = this.shadows && def.shadow[cell.lod];
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    cell.meshes = group;
    this.group.add(group);
  }

  // Shows each cell at the level of detail its distance calls for.
  update(camera) {
    const cp = camera.position, s = this.lodScale;
    for (let l = 0; l < 3; l++) {
      for (const key in this.cells[l]) {
        const c = this.cells[l][key], def = KINDS[c.kind];
        const x0 = c.cx * CELL[l], z0 = c.cz * CELL[l];
        const dx = Math.max(x0 - cp.x, 0, cp.x - (x0 + CELL[l])), dz = Math.max(z0 - cp.z, 0, cp.z - (z0 + CELL[l]));
        const d = Math.hypot(dx, dz);
        const near = l === 0 ? 0 : def.lods[l - 1] * s, far = def.lods[l] * s;
        const want = d >= near && d < far && !(l === 2 && c.kind === 'shrub' && d > far);
        if (want !== c.visible) {
          if (want && !c.meshes) this._build(c);
          if (c.meshes) c.meshes.visible = want;
          c.visible = want;
        }
      }
    }
  }

  setShadows(on) {
    this.shadows = on;
    for (let l = 0; l < 3; l++) for (const key in this.cells[l]) {
      const c = this.cells[l][key];
      if (c.meshes) c.meshes.traverse((o) => { if (o.isInstancedMesh) o.castShadow = on && KINDS[c.kind].shadow[l]; });
    }
  }
}
