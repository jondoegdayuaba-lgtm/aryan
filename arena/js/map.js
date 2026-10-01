import * as THREE from 'three';

// The arena: a walled yard with a raised centre platform, shipping containers,
// crates, low cover walls and two open courtyards. Every solid is an axis-aligned
// box, which keeps collisions, bullets and bot pathfinding simple. There are no
// overhangs, so the floor height under any point is just the tallest box there.

export const HALF = 42;            // the yard spans -HALF..HALF on x and z
const WALL_H = 7;

function tileTexture(base, line, size = 128, lines = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.fillStyle = line;
  const step = size / lines;
  for (let i = 0; i < lines; i++) {
    g.fillRect(0, i * step, size, 3);
    g.fillRect(i * step, 0, 3, size);
  }
  // A little speckle so large surfaces don't look flat.
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.13)';
  for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 3, 64);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, 64, 2);
  g.fillRect(0, 62, 64, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Box UVs scaled to world size so textures tile evenly instead of stretching.
function scaledBox(sx, sy, sz, tile) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return geo;
}

export function buildMap(scene) {
  scene.background = new THREE.Color(0x9fd8ff);
  scene.fog = new THREE.Fog(0x9fd8ff, 70, 190);

  scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x6a6458, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
  sun.position.set(30, 60, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -HALF - 4;
  sc.right = sc.top = HALF + 4;
  sc.near = 10;
  sc.far = 140;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const boxes = [];
  const tex = {
    floor: tileTexture('#c9ccd3', '#aeb2bb', 128, 2),
    concrete: tileTexture('#d9d5cc', '#bdb8ad', 128, 1),
    stripe: stripeTexture(),
  };
  const mats = new Map();
  const mat = (color, map) => {
    const key = color + ':' + (map?.uuid || '');
    if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, map }));
    return mats.get(key);
  };

  // Floor
  const floorGeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2);
  floorGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * HALF; });
  const floor = new THREE.Mesh(floorGeo, mat(0xffffff, tex.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // add(x0, z0, x1, z1, top, color, texture) adds a solid box from the ground up.
  function add(x0, z0, x1, z1, top, color, map = tex.concrete, bottom = 0) {
    const sx = x1 - x0, sz = z1 - z0, sy = top - bottom;
    const mesh = new THREE.Mesh(scaledBox(sx, sy, sz, map === tex.stripe ? 2.6 : 2), mat(color, map));
    mesh.position.set((x0 + x1) / 2, bottom + sy / 2, (z0 + z1) / 2);
    mesh.castShadow = sy > 0.3;
    mesh.receiveShadow = true;
    scene.add(mesh);
    boxes.push({ min: new THREE.Vector3(x0, bottom, z0), max: new THREE.Vector3(x1, top, z1) });
  }
  // Mirror helper: the map is point-symmetric so both halves play the same.
  function add2(x0, z0, x1, z1, top, color, map) {
    add(x0, z0, x1, z1, top, color, map);
    add(-x1, -z1, -x0, -z0, top, color, map);
  }

  // Perimeter
  const H = HALF, T = 1.5;
  add(-H - T, -H - T, H + T, -H, WALL_H, 0xb9bec8);
  add(-H - T, H, H + T, H + T, WALL_H, 0xb9bec8);
  add(-H - T, -H, -H, H, WALL_H, 0xb9bec8);
  add(H, -H, H + T, H, WALL_H, 0xb9bec8);

  // Centre platform with stairs on two sides and parapets for cover.
  add(-7, -7, 7, 7, 3, 0xe8c86a);
  for (let k = 1; k <= 6; k++) {
    const top = 0.5 * k;
    add(7 + (6 - k), -2, 7 + (7 - k), 2, top, 0xd7b45a);
    add(-7 - (7 - k), -2, -7 - (6 - k), 2, top, 0xd7b45a);
  }
  add(-7, -7, -2, -6.4, 4.1, 0xcaa64c);
  add(2, 6.4, 7, 7, 4.1, 0xcaa64c);
  add(-7, 6.4, -4, 7, 4.1, 0xcaa64c);
  add(4, -7, 7, -6.4, 4.1, 0xcaa64c);

  // Shipping containers
  const cont = [0x3d8bd9, 0xe2553f, 0x3fae64, 0xf0a030];
  add2(14, -20, 20.5, -17.4, 2.7, cont[0], tex.stripe);
  add2(20, 8, 22.6, 14.5, 2.7, cont[1], tex.stripe);
  add2(-24, -30, -17.5, -27.4, 2.7, cont[2], tex.stripe);
  add2(-24, -27.4, -17.5, -24.8, 2.7, cont[3], tex.stripe);   // a stacked pair, side by side
  add2(28, -6, 34.5, -3.4, 2.7, cont[0], tex.stripe);

  // Crates (jumpable) and crate stacks
  const crate = 0xb07a45;
  add2(10, -12, 11.4, -10.6, 1.4, crate);
  add2(11.4, -12, 12.8, -10.6, 1.4, crate);
  add2(10, -10.6, 11.4, -9.2, 1.4, crate);
  add2(-14, 18, -12.6, 19.4, 1.4, crate);
  add2(30, 22, 31.4, 23.4, 1.4, crate);
  add2(31.4, 22, 32.8, 23.4, 2.8, crate);
  add2(4, 24, 5.4, 25.4, 1.4, crate);

  // Low cover walls (crouch behind them)
  const low = 0x9aa3b5;
  add2(-4, 14, 4, 14.8, 1.15, low);
  add2(14, -4, 14.8, 4, 1.15, low);
  add2(24, 30, 30, 30.8, 1.15, low);
  add2(-30, 4, -29.2, 12, 1.15, low);
  add2(-10, -22, -4, -21.2, 1.15, low);

  // Courtyards in two corners: walls with gaps you can run through.
  const cy = 0x8fb3c9;
  add2(26, 26, 38, 27, 4, cy);
  add2(26, 27, 27, 31, 4, cy);
  add2(26, 35, 27, 42, 4, cy);
  add2(32, 31, 33, 36, 2.2, cy);

  // Pillars
  add2(-20, 6, -18.6, 7.4, 5.5, 0xa1a9b8);
  add2(6, -30, 7.4, -28.6, 5.5, 0xa1a9b8);
  add2(-34, -14, -32.6, -12.6, 5.5, 0xa1a9b8);

  const spawns = [];
  for (const [x, z] of [
    [-36, -36], [36, 36], [-36, 36], [36, -36], [0, -36], [0, 36], [-36, 0], [36, 0],
    [-24, -12], [24, 12], [-12, 30], [12, -30], [30, -16], [-30, 16], [-20, 22], [20, -22],
  ]) spawns.push(new THREE.Vector3(x, 0, z));

  const map = { boxes, spawns, sun, tex };
  map.nav = buildNav(boxes);
  return map;
}

// ---------- Ray and box queries ----------

// Slab test. Returns the distance along the ray to the nearest box, or Infinity.
const _n = new THREE.Vector3();
export function rayBoxes(boxes, o, d, maxDist, outNormal) {
  let best = maxDist;
  let hit = false;
  for (const b of boxes) {
    let tmin = 0, tmax = best, axis = -1, sign = 0;
    let ok = true;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const lo = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z;
      const hi = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
      if (Math.abs(da) < 1e-9) {
        if (oa < lo || oa > hi) { ok = false; break; }
        continue;
      }
      let t1 = (lo - oa) / da, t2 = (hi - oa) / da, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin < best && axis >= 0) {
      best = tmin;
      hit = true;
      if (outNormal) outNormal.set(0, 0, 0).setComponent(axis, sign);
    }
  }
  return hit ? best : Infinity;
}

export function lineOfSight(boxes, a, b) {
  _n.subVectors(b, a);
  const len = _n.length();
  _n.divideScalar(len);
  return rayBoxes(boxes, a, _n, len) === Infinity;
}

export function pointInBoxes(boxes, p, pad = 0) {
  for (const b of boxes) {
    if (p.x > b.min.x - pad && p.x < b.max.x + pad && p.y > b.min.y - pad && p.y < b.max.y + pad &&
        p.z > b.min.z - pad && p.z < b.max.z + pad) return b;
  }
  return null;
}

// ---------- Navigation: 1 m heightfield grid with A* ----------

function buildNav(boxes) {
  const N = HALF * 2;
  const h = new Float32Array(N * N);
  const samples = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let top = 0;
      for (const [sx, sz] of samples) {
        const x = -HALF + i + sx, z = -HALF + j + sz;
        for (const b of boxes) {
          if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y > top) top = b.max.y;
        }
      }
      h[i * N + j] = top;
    }
  }
  // Cells next to a ledge or wall cost more, so bots keep off corners.
  const cost = new Float32Array(N * N).fill(1);
  for (let i = 1; i < N - 1; i++) {
    for (let j = 1; j < N - 1; j++) {
      const c = h[i * N + j];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (h[(i + di) * N + j + dj] > c + 0.6) cost[i * N + j] = 4;
      }
    }
  }
  const walkable = (k) => h[k] <= 3.05;
  const passable = (a, b) => walkable(b) && Math.abs(h[a] - h[b]) <= 0.6;

  const cellOf = (x, z) => {
    const i = THREE.MathUtils.clamp(Math.floor(x + HALF), 0, N - 1);
    const j = THREE.MathUtils.clamp(Math.floor(z + HALF), 0, N - 1);
    return i * N + j;
  };
  const center = (k, out) => out.set(-HALF + Math.floor(k / N) + 0.5, h[k], -HALF + (k % N) + 0.5);

  // Shared scratch arrays for A*.
  const g = new Float32Array(N * N);
  const came = new Int32Array(N * N);
  const stamp = new Int32Array(N * N);
  const closed = new Int32Array(N * N);
  let run = 0;

  function findPath(from, to, maxNodes = 4000) {
    let start = cellOf(from.x, from.z), goal = cellOf(to.x, to.z);
    if (!walkable(goal)) goal = nearestWalkable(goal);
    if (goal < 0 || start === goal) return null;
    run++;
    const gi = (k) => k / N | 0, gj = (k) => k % N;
    const heur = (k) => Math.hypot(gi(k) - gi(goal), gj(k) - gj(goal));
    const heap = [];   // [f, k]
    const push = (f, k) => {
      heap.push([f, k]);
      let n = heap.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (heap[p][0] <= heap[n][0]) break;
        [heap[p], heap[n]] = [heap[n], heap[p]];
        n = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = 2 * n + 1, r = l + 1;
          let m = n;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n], heap[m]];
          n = m;
        }
      }
      return top;
    };
    stamp[start] = run; g[start] = 0; came[start] = -1;
    push(heur(start), start);
    let expanded = 0;
    while (heap.length && expanded++ < maxNodes) {
      const [, k] = pop();
      if (k === goal) break;
      if (closed[k] === run) continue;
      closed[k] = run;
      const i = gi(k), j = gj(k);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = ni * N + nj;
        if (!passable(k, nk)) continue;
        if (di && dj && (!passable(k, ni * N + j) || !passable(k, i * N + nj))) continue;
        const ng = g[k] + (di && dj ? 1.414 : 1) * cost[nk];
        if (stamp[nk] !== run || ng < g[nk]) {
          stamp[nk] = run; g[nk] = ng; came[nk] = k;
          push(ng + heur(nk), nk);
        }
      }
    }
    if (stamp[goal] !== run) return null;
    const path = [];
    for (let k = goal; k !== -1 && k !== start; k = came[k]) path.push(center(k, new THREE.Vector3()));
    return path.reverse();
  }

  function nearestWalkable(k) {
    const i0 = k / N | 0, j0 = k % N;
    for (let r = 1; r < 6; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        const i = i0 + di, j = j0 + dj;
        if (i >= 0 && j >= 0 && i < N && j < N && walkable(i * N + j)) return i * N + j;
      }
    }
    return -1;
  }

  // A random open spot on the map, for bots to wander to.
  function randomPoint(out) {
    for (let tries = 0; tries < 50; tries++) {
      const k = (Math.random() * N * N) | 0;
      if (walkable(k) && cost[k] === 1) return center(k, out);
    }
    return out.set(0, 0, 20);
  }

  return { findPath, randomPoint, heightAt: (x, z) => h[cellOf(x, z)] };
}
