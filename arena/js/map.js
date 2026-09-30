// The arena: a walled square with crates, walls, pillars and four corner
// platforms reached by stairs. Collision uses the same axis-aligned boxes that
// are drawn, and bots walk a grid built from them.
import * as THREE from 'three';

export const HALF = 32;
export const boxes = [];

function add(x, z, w, d, h, y0 = 0, kind = 'crate') {
  boxes.push({
    min: new THREE.Vector3(x - w / 2, y0, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y0 + h, z + d / 2),
    kind,
  });
}

// Every quadrant piece is added four times, rotated around the centre, so the
// map is fair from every spawn.
function rotated(x, z, w, d, h, y0, kind) {
  add(x, z, w, d, h, y0, kind);
  add(-z, x, d, w, h, y0, kind);
  add(-x, -z, w, d, h, y0, kind);
  add(z, -x, d, w, h, y0, kind);
}

function layout() {
  const W = HALF * 2 + 2;
  add(0, HALF + 0.5, W, 1, 5, 0, 'wall');
  add(0, -HALF - 0.5, W, 1, 5, 0, 'wall');
  add(HALF + 0.5, 0, 1, W, 5, 0, 'wall');
  add(-HALF - 0.5, 0, 1, W, 5, 0, 'wall');

  // Centre: a low block with a smaller block on top, both reachable by jumping.
  add(0, 0, 4, 4, 1, 0, 'platform');
  add(0, 0, 2, 2, 1, 1, 'crate');

  // Corner platform with stairs down toward the middle and a low parapet.
  rotated(23, 23, 8, 8, 3, 0, 'platform');
  for (let i = 1; i <= 5; i++) rotated(19 - i + 0.5, 23.5, 1, 3, 3 - i * 0.5, 0, 'stairs');
  rotated(19.25, 20.5, 0.5, 3, 1, 3, 'wall');
  rotated(22, 19.25, 3, 0.5, 1, 3, 'wall');

  rotated(12, 10, 1, 8, 3, 0, 'wall');
  rotated(4, 16, 6, 1, 2.2, 0, 'wall');
  rotated(16, 16, 1.5, 1.5, 6, 0, 'pillar');
  rotated(6, 6, 2, 2, 2, 0, 'crate');
  rotated(7.5, 6.5, 1, 1, 1, 0, 'crate');
  rotated(20, 8, 2, 2, 2, 0, 'crate');
  rotated(26, 12, 3, 1.5, 1.1, 0, 'crate');
  rotated(10, 25, 2, 2, 2, 0, 'crate');
  rotated(11.5, 24.5, 1, 1, 1, 0, 'crate');
  rotated(27, 2, 1.5, 1.5, 1.5, 0, 'crate');
}
layout();

// ---------- textures ----------
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function noise(g, s, n, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * alpha})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}

const TEX = {
  floor: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#7fbf5a'; g.fillRect(0, 0, s, s);
    noise(g, s, 500, 0.08);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }),
  crate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#c98a45'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) { g.fillStyle = y % 32 ? '#bb7d3b' : '#c98a45'; g.fillRect(0, y, s, 14); }
    noise(g, s, 150, 0.1);
    g.strokeStyle = '#7a4a1f'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
  }),
  wall: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#b9bcc6'; g.fillRect(0, 0, s, s);
    noise(g, s, 300, 0.07);
    g.strokeStyle = 'rgba(40,40,60,0.25)'; g.lineWidth = 2;
    for (let y = 0; y <= s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    for (let y = 0; y < s; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < s; x += 64) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
    }
  }),
  platform: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#4b7bd6'; g.fillRect(0, 0, s, s);
    noise(g, s, 200, 0.08);
    g.fillStyle = '#f2c230';
    for (let x = -s; x < s * 2; x += 32) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 + 12, 12); g.lineTo(x + 12, 12); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 4; g.strokeRect(2, 2, s - 4, s - 4);
  }),
  pillar: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#d65b4b'; g.fillRect(0, 0, s, s);
    noise(g, s, 200, 0.08);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, 0, s, 8);
  }),
};
TEX.stairs = TEX.platform;

// Scale a box's UVs so textures keep a constant size (texSize metres per tile).
function boxGeometry(w, h, d, texSize) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / texSize, uv.getY(i) * dims[f][1] / texSize);
  }
  return geo;
}

export function buildMap(scene) {
  const mats = {};
  for (const k of Object.keys(TEX)) mats[k] = new THREE.MeshLambertMaterial({ map: TEX[k]() });

  const floorTex = TEX.floor();
  floorTex.repeat.set(HALF / 2, HALF / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 2, HALF * 2 + 2), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grass beyond the walls so the horizon is not empty.
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x6aa84f }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  scene.add(outer);

  for (const b of boxes) {
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    const m = new THREE.Mesh(boxGeometry(w, h, d, b.kind === 'crate' ? Math.min(2, Math.max(w, d, h)) : 2), mats[b.kind]);
    m.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // Far-off blocky hills and clouds for a sense of place.
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x5c9a47 });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, r = 90 + Math.random() * 40, s = 10 + Math.random() * 18;
    const hill = new THREE.Mesh(new THREE.BoxGeometry(s, s * (0.5 + Math.random()), s), hillMat);
    hill.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    hill.rotation.y = Math.random() * Math.PI;
    scene.add(hill);
  }
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(8 + Math.random() * 14, 2, 5 + Math.random() * 8), cloudMat);
    c.position.set((Math.random() - 0.5) * 240, 40 + Math.random() * 15, (Math.random() - 0.5) * 240);
    scene.add(c);
  }

  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x5b7a3a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
  sun.position.set(25, 45, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -40; sc.right = sc.top = 40; sc.near = 1; sc.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}

// ---------- ray casting ----------
// Slab test. Returns the entry distance, or -1 on a miss within tmax.
export function rayAABB(o, d, minx, miny, minz, maxx, maxy, maxz, tmax) {
  let t0 = 0, t1 = tmax;
  const lo = [minx, miny, minz], hi = [maxx, maxy, maxz], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) {
      if (oo[a] < lo[a] || oo[a] > hi[a]) return -1;
      continue;
    }
    const inv = 1 / dd[a];
    let tn = (lo[a] - oo[a]) * inv, tf = (hi[a] - oo[a]) * inv;
    if (tn > tf) { const s = tn; tn = tf; tf = s; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return -1;
  }
  return t0;
}

// Nearest hit against the floor and every box. Normal is the face that was hit.
export function raycastWorld(o, d, maxT) {
  let t = maxT, normal = null;
  if (d.y < 0) {
    const tf = -o.y / d.y;
    if (tf < t) { t = tf; normal = new THREE.Vector3(0, 1, 0); }
  }
  let hitBox = null;
  for (const b of boxes) {
    const tb = rayAABB(o, d, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, t);
    if (tb >= 0 && tb < t) { t = tb; hitBox = b; }
  }
  if (hitBox) {
    const p = o.clone().addScaledVector(d, t), e = 1e-3;
    normal = new THREE.Vector3();
    if (Math.abs(p.x - hitBox.min.x) < e) normal.set(-1, 0, 0);
    else if (Math.abs(p.x - hitBox.max.x) < e) normal.set(1, 0, 0);
    else if (Math.abs(p.y - hitBox.max.y) < e) normal.set(0, 1, 0);
    else if (Math.abs(p.y - hitBox.min.y) < e) normal.set(0, -1, 0);
    else if (Math.abs(p.z - hitBox.min.z) < e) normal.set(0, 0, -1);
    else normal.set(0, 0, 1);
  }
  return { t, normal };
}

// ---------- navigation grid for bots ----------
const N = HALF * 2;
const blocked = new Uint8Array(N * N);
const MARGIN = 0.45;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x0 = i - HALF, z0 = j - HALF;
  for (const b of boxes) {
    if (b.min.y > 1.7) continue;
    if (x0 < b.max.x + MARGIN && x0 + 1 > b.min.x - MARGIN && z0 < b.max.z + MARGIN && z0 + 1 > b.min.z - MARGIN) {
      blocked[j * N + i] = 1;
      break;
    }
  }
}

const open = (i, j) => i >= 0 && j >= 0 && i < N && j < N && !blocked[j * N + i];
const cellOf = (v) => Math.floor(v + HALF);

function nearestOpen(i, j) {
  if (open(i, j)) return [i, j];
  for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) === r && open(i + di, j + dj)) return [i + di, j + dj];
  }
  return null;
}

export const nav = {
  randomOpen() {
    for (;;) {
      const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
      if (open(i, j) && open(i + 1, j) && open(i - 1, j) && open(i, j + 1) && open(i, j - 1)) {
        return new THREE.Vector3(i - HALF + 0.5, 0, j - HALF + 0.5);
      }
    }
  },

  // True when a straight walk between two points stays on open cells.
  lineClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, steps = Math.ceil(Math.hypot(dx, dz) / 0.35);
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      if (!open(cellOf(ax + dx * t), cellOf(az + dz * t))) return false;
    }
    return true;
  },

  // A* over the grid with 8-way moves (no corner cutting). Returns world points.
  findPath(ax, az, bx, bz) {
    const s = nearestOpen(cellOf(ax), cellOf(az)), g = nearestOpen(cellOf(bx), cellOf(bz));
    if (!s || !g) return null;
    const start = s[1] * N + s[0], goal = g[1] * N + g[0];
    const gs = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = [];
    const push = (n, f) => {
      heap.push([f, n]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top[1];
    };
    const h = (n) => {
      const dx = Math.abs((n % N) - g[0]), dz = Math.abs(((n / N) | 0) - g[1]);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    gs[start] = 0;
    push(start, h(start));
    while (heap.length) {
      const n = pop();
      if (n === goal) break;
      if (closed[n]) continue;
      closed[n] = 1;
      const i = n % N, j = (n / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!open(ni, nj)) continue;
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue;
        const m = nj * N + ni, cost = gs[n] + (di && dj ? 1.414 : 1);
        if (cost < gs[m]) { gs[m] = cost; from[m] = n; push(m, cost + h(m)); }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const pts = [];
    for (let n = goal; n !== -1 && n !== start; n = from[n]) pts.push(new THREE.Vector3((n % N) - HALF + 0.5, 0, ((n / N) | 0) - HALF + 0.5));
    pts.reverse();
    return pts;
  },
};
