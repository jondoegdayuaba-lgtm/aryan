import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, BUILDINGS } from './config.js';
import { circleRect, segmentRect } from './collision.js';

const P = CITY.period;

export function hash(a, b, c = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- road-grid helpers (roads run along x = 50 + 100k and z = 50 + 100k) --------------
export const nodePos = (i, j) => ({ x: 50 + P * i, z: 50 + P * j });
export const nearestNode = (x, z) => ({ i: Math.round((x - 50) / P), j: Math.round((z - 50) / P) });
const roadDist = (v) => { const d = (((v - 50) % P) + P) % P; return Math.min(d, P - d); };
export const onRoad = (x, z) => roadDist(x) < CITY.roadHalf || roadDist(z) < CITY.roadHalf;

// ---- glow sprite texture ---------------------------------------------------------------
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.tiles = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    this.poolTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    this.glowMat = new THREE.PointsMaterial({
      map: this.glowTex, size: 5.5, sizeAttenuation: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, fog: false, opacity: 0.9,
    });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: this.poolTex, color: 0xffb060, transparent: true, depthWrite: false, opacity: 0.17,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true,
    });
    this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.city = assets.city;
    this.proto = {};
    this.city.traverse((o) => { if (o.name && !this.proto[o.name] && (o.parent === this.city || o.parent?.parent === this.city)) this.proto[o.name] = o; });
    // small props share two vertex-coloured materials (one rough, one metallic) so a tile costs ~15 draw calls
    this.vcRough = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, name: 'vc_rough' });
    this.vcMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.85, name: 'vc_metal' });
    this.vcNames = new Set(['trim', 'metal', 'darkmetal', 'curb', 'paint_white', 'paint_yellow', 'manhole', 'wood', 'tank', 'hydrant_red',
      'mailbox_blue', 'dumpster', 'cone_orange', 'plain_white', 'leaf_a', 'leaf_b', 'bark', 'barrier', 'barrier_stripe', 'awning_red',
      'awning_blue', 'awning_green', 'sig_case', 'crate', 'vent_grate', 'fruit_red', 'fruit_green', 'fruit_yellow',
      'plastic_trim', 'tire', 'wheelwell', 'rim_alloy', 'brake_rotor', 'chrome', 'paint', 'paint_black']);
  }

  key(tx, tz) { return tx + ',' + tz; }

  /** Keep the (2R+1)^2 tiles around (x,z) alive. `sync` builds everything now. */
  update(x, z, sync = false) {
    const cx = Math.round(x / P), cz = Math.round(z / P);
    const R = CITY.viewRadius;
    const want = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const tx = cx + dx, tz = cz + dz;
      if (!this.tiles.has(this.key(tx, tz))) want.push({ tx, tz, d: dx * dx + dz * dz });
    }
    want.sort((a, b) => a.d - b.d);
    let budget = sync ? 999 : 1;
    for (const w of want) {
      if (w.d <= 2 || budget > 0) { this.build(w.tx, w.tz); budget--; }
      if (budget <= 0 && w.d > 2) break;
    }
    for (const [k, t] of this.tiles) {
      if (Math.abs(t.tx - cx) > R + 1 || Math.abs(t.tz - cz) > R + 1) this.drop(k, t);
    }
  }

  drop(k, t) {
    this.root.remove(t.group);
    t.group.traverse((o) => { if (o.geometry && o.userData.own) o.geometry.dispose(); });
    this.tiles.delete(k);
  }

  clone(name) {
    const p = this.proto[name];
    if (!p) throw new Error('missing city node ' + name);
    return p.clone(true);
  }

  build(tx, tz) {
    const key = this.key(tx, tz);
    if (this.tiles.has(key)) return;
    const ox = tx * P, oz = tz * P;
    const tmp = new THREE.Group();
    const rects = [];
    const circles = [];
    const vents = [];
    const glows = [];   // {x,y,z,color}
    const pools = [];   // {x,z,r}
    const add = (name, x, z, rot = 0, y = 0, s = 1) => {
      const o = this.clone(name);
      o.position.set(x, y, z);
      o.rotation.y = rot;
      o.scale.setScalar(s);
      tmp.add(o);
      return o;
    };

    add('ground_tile', 0, 0);

    // --- buildings ---
    let li = 0;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const h = hash(tx, tz, li);
      const b = BUILDINGS[Math.floor(hash(tx, tz, 10 + li) * BUILDINGS.length)];
      // face the storefront toward one of the two streets the lot touches
      const towardX = hash(tx, tz, 20 + li) < 0.5;
      const rot = towardX ? (sx > 0 ? -Math.PI / 2 : Math.PI / 2) : (sz > 0 ? Math.PI : 0);
      const lx = sx * CITY.lotCenter, lz = sz * CITY.lotCenter;
      add(b.name, lx, lz, rot);
      rects.push({ minX: ox + lx - b.half, maxX: ox + lx + b.half, minZ: oz + lz - b.half, maxZ: oz + lz + b.half });
      // blade signs on the two street-facing walls
      for (const [nx, nz] of [[sx, 0], [0, sz]]) {
        const hh = hash(tx, tz, 40 + li * 2 + (nx ? 1 : 0));
        if (hh < 0.7) {
          const idx = Math.floor(hash(tx, tz, 60 + li * 2 + (nx ? 1 : 0)) * 16);
          const along = (hash(tx, tz, 80 + li * 2 + (nx ? 1 : 0)) - 0.5) * 2 * (b.half - 4);
          const y = 3.0 + hash(tx, tz, 90 + li) * 1.6;
          const wx = lx + nx * (b.half + 0.55) + (nx ? 0 : along);
          const wz = lz + nz * (b.half + 0.55) + (nz ? 0 : along);
          add(`neon_${String(idx).padStart(2, '0')}`, wx, wz, Math.atan2(nx, nz), y);
        }
      }
      li++;
    }

    // --- street furniture on the four sidewalks ---
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    sides.forEach(([nx, nz], si) => {
      const tX = -nz, tZ = nx;                     // tangent
      const at = (t, off) => [nx * off + tX * t, nz * off + tZ * t];
      // the props' arm / front is model -Z; rotate it to point out toward the road
      const rotOut = Math.atan2(-nx, -nz);
      for (const t of [-24, 24]) {
        const [x, z] = at(t, 38.8);
        add('prop_streetlight', x, z, rotOut);
        circles.push({ x: ox + x, z: oz + z, r: 0.28 });
        // lamp head sits 2.8 m out along the arm, 9.4 m up
        const lx = x + nx * 2.8, lz = z + nz * 2.8;
        glows.push({ x: lx, y: 9.3, z: lz, c: [1.0, 0.7, 0.36] });
        pools.push({ x: lx, z: lz, r: 17 });
      }
      for (const t of [-11, 12]) {
        if (hash(tx, tz, 200 + si * 5 + (t > 0 ? 1 : 0)) < 0.8) {
          const [x, z] = at(t, 36.8);
          add('prop_tree', x, z, hash(tx, tz, 300 + si) * 6.28, 0, 0.9 + 0.3 * hash(tx, tz, 310 + si + t));
          circles.push({ x: ox + x, z: oz + z, r: 0.4 });
        }
      }
      // one or two bits of clutter per side
      const clutter = ['prop_hydrant', 'prop_mailbox', 'prop_bin', 'prop_bench', 'prop_meter', 'prop_bollard', 'prop_planter', 'prop_shelter'];
      for (let c = 0; c < 2; c++) {
        const hh = hash(tx, tz, 400 + si * 3 + c);
        if (hh < 0.75) {
          const name = clutter[Math.floor(hash(tx, tz, 500 + si * 3 + c) * clutter.length)];
          const t = -30 + hash(tx, tz, 600 + si * 3 + c) * 60;
          const off = name === 'prop_shelter' || name === 'prop_bench' ? 37.6 : 39.2;
          const [x, z] = at(t, off);
          const rot = name === 'prop_bench' || name === 'prop_shelter' ? Math.atan2(nx, nz) : 0;
          add(name, x, z, rot);
          if (name !== 'prop_bench' && name !== 'prop_shelter') circles.push({ x: ox + x, z: oz + z, r: name === 'prop_planter' ? 0.65 : 0.3 });
          else circles.push({ x: ox + x, z: oz + z, r: 0.9 });
        }
      }
      // market stalls and scaffolding on the sidewalk
      for (let k = 0; k < 2; k++) {
        const hs = hash(tx, tz, 1000 + si * 4 + k);
        if (hs < 0.3) {
          const t = -28 + hash(tx, tz, 1010 + si * 4 + k) * 56;
          const scaffold = hs < 0.09;
          const [x, z] = at(t, scaffold ? 35.2 : 37.2);
          add(scaffold ? 'prop_scaffold' : 'prop_stall', x, z, rotOut);
          for (const d of scaffold ? [-0.8, 0.8] : [-1.0, 0, 1.0]) circles.push({ x: ox + x + tX * d, z: oz + z + tZ * d, r: scaffold ? 0.8 : 0.75 });
        }
      }
      // steam vents in the road
      if (hash(tx, tz, 1100 + si) < 0.4) {
        const t = -26 + hash(tx, tz, 1110 + si) * 52;
        const [x, z] = at(t, 45.2);
        add('prop_vent', x, z, 0);
        vents.push({ x: ox + x, z: oz + z });
      }
      // road works in the outer lane of the road on this side
      const works = hash(tx, tz, 700 + si) < 0.14;
      // cars parked along the curb (solid!)
      if (!works) {
        for (let k = 0; k < 3; k++) {
          if (hash(tx, tz, 1200 + si * 5 + k) > 0.42) continue;
          const t = -30 + k * 26 + hash(tx, tz, 1210 + si * 5 + k) * 10;
          const kind = ['sedan', 'sedan', 'taxi', 'van'][Math.floor(hash(tx, tz, 1220 + si * 5 + k) * 4)];
          const [x, z] = at(t, 41.2);
          const car = this.assets[kind].clone(true);
          car.position.set(x, 0, z);
          car.rotation.y = Math.atan2(-tX, -tZ) + (hash(tx, tz, 1230 + si * 5 + k) < 0.5 ? 0 : Math.PI);
          tmp.add(car);
          for (const d of [-1.6, 0, 1.6]) circles.push({ x: ox + x + tX * d, z: oz + z + tZ * d, r: 0.95 });
        }
      }
      if (works) {
        const t = -24 + hash(tx, tz, 710 + si) * 48;
        const [bx, bz] = at(t, 43.6);
        add('prop_barrier', bx, bz, Math.atan2(nx, nz) + Math.PI / 2);
        for (const d of [-1.4, 0, 1.4]) circles.push({ x: ox + bx + tX * d, z: oz + bz + tZ * d, r: 0.7 });
        for (let k = 0; k < 4; k++) {
          const [cx2, cz2] = at(t + 3 + k * 2.2, 43.6 - k * 0.5);
          add('prop_cone', cx2, cz2, 0);
          circles.push({ x: ox + cx2, z: oz + cz2, r: 0.25 });
        }
      }
    });
    // traffic signals at the block corners
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * 40.4, z = sz * 40.4;
      const red = hash(tx, tz, 800 + sx + sz * 2) < 0.5;
      // mast arm reaches out over the road, alternating between the x and z roads
      const rot = (sx + sz) % 4 === 0 ? -sx * Math.PI / 2 : (sz > 0 ? Math.PI : 0);
      add(red ? 'prop_signal_red' : 'prop_signal', x, z, rot);   // no collider: keeps corner-cutting fair
    }

    // --- merge everything by material: one draw call per material per tile ---
    tmp.updateMatrixWorld(true);
    const byMat = new Map();
    tmp.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(o.matrixWorld);
      let mat = o.material;
      if (this.vcNames.has(mat.name)) {
        const n = g.attributes.position.count, col = new Float32Array(n * 3), c = mat.color;
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mat = mat.metalness > 0.5 ? this.vcMetal : this.vcRough;
      }
      const arr = byMat.get(mat) || [];
      arr.push(g);
      byMat.set(mat, arr);
    });
    const group = new THREE.Group();
    group.position.set(ox, 0, oz);
    const flat = new Set(['asphalt', 'sidewalk']);
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, mat);
      m.userData.own = true;
      m.castShadow = !flat.has(mat.name);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.frustumCulled = true;
      group.add(m);
    }

    // additive glow sprites for lamps + pools of light on the wet road
    if (glows.length) {
      const pos = new Float32Array(glows.length * 3), col = new Float32Array(glows.length * 3);
      glows.forEach((g, i) => { pos.set([g.x, g.y, g.z], i * 3); col.set(g.c, i * 3); });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, this.glowMat);
      pts.userData.own = true;
      pts.frustumCulled = false;
      group.add(pts);
      const inst = new THREE.InstancedMesh(this.poolGeo, this.poolMat, pools.length);
      const mtx = new THREE.Matrix4();
      pools.forEach((p, i) => { mtx.makeScale(p.r, 1, p.r).setPosition(p.x, 0.06, p.z); inst.setMatrixAt(i, mtx); });
      inst.frustumCulled = false;
      inst.renderOrder = 2;
      group.add(inst);
    }

    this.root.add(group);
    this.tiles.set(key, { tx, tz, group, rects, circles, vents });
  }

  // ---- queries ------------------------------------------------------------------------
  *tilesNear(x, z, n = 1) {
    const cx = Math.round(x / P), cz = Math.round(z / P);
    for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
      const t = this.tiles.get(this.key(cx + dx, cz + dz));
      if (t) yield t;
    }
  }

  /** Circle vs buildings + props. Returns list of {nx,nz,depth,solid:'wall'|'prop'} */
  collide(x, z, r, props = true) {
    const hits = [];
    for (const t of this.tilesNear(x, z, 1)) {
      for (const rc of t.rects) {
        if (x < rc.minX - r - 1 || x > rc.maxX + r + 1 || z < rc.minZ - r - 1 || z > rc.maxZ + r + 1) continue;
        const h = circleRect(x, z, r, rc);
        if (h) { h.kind = 'wall'; hits.push(h); }
      }
      if (props) {
        for (const c of t.circles) {
          const dx = x - c.x, dz = z - c.z, rr = r + c.r;
          if (dx * dx + dz * dz < rr * rr) {
            const d = Math.hypot(dx, dz) || 1e-4;
            hits.push({ nx: dx / d, nz: dz / d, depth: rr - d, kind: 'prop', ref: c });
          }
        }
      }
    }
    return hits;
  }

  /** Steam vents near a point (for particle plumes). */
  ventsNear(x, z) {
    const out = [];
    for (const t of this.tilesNear(x, z, 1)) out.push(...t.vents);
    return out;
  }

  /** True when a straight line between two points is not cut by a building. */
  lineClear(ax, az, bx, bz) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const span = Math.hypot(bx - ax, bz - az) / P / 2 + 1;
    for (const t of this.tilesNear(mx, mz, Math.min(3, Math.ceil(span)))) {
      for (const rc of t.rects) if (segmentRect(ax, az, bx, bz, rc)) return false;
    }
    return true;
  }
}
