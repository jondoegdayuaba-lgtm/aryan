// Builds the map: launch hangar, the test area, the brick town, lattice towers,
// gates, trees and scenery. Returns what the game needs to know about it.
import * as THREE from 'three';
import { Colliders } from './collision.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// BoxGeometry whose UVs are scaled to world units, so one texture tiles
// evenly no matter how big the box is.
function worldBox(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * faces[f][0]) / tile, (uv.getY(k) * faces[f][1]) / tile);
    }
  }
  return g;
}

export function buildWorld(scene, T) {
  const colliders = new Colliders();
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const tex = (src) => T.repeat(src, 1, 1);

  const M = {
    lavender: lambert('#ffffff', { map: tex(T.lavenderWall) }),
    orangeGrid: lambert('#ffffff', { map: tex(T.orangeGrid) }),
    hazard: lambert('#ffffff', { map: tex(T.hazard) }),
    brick: lambert('#ffffff', { map: tex(T.brick) }),
    trim: lambert('#3d3a4a'),
    roof: lambert('#8e8aa3'),
    pillar: lambert('#4b4655'),
    tower: lambert('#f0962e'),
    window: lambert('#ffffff', { map: T.window }),
    hangarFloor: lambert('#b9b5dc'),
    screenBand: lambert('#1a1c2a'),
  };

  const add = (mesh, { collide = true, cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    if (collide) colliders.addBoxMesh(mesh);
    return mesh;
  };

  const box = (w, h, d, mat, x, y, z, opts = {}) => {
    const m = new THREE.Mesh(worldBox(w, h, d, opts.tile ?? 8), mat);
    m.position.set(x, y, z);
    if (opts.rotY) m.rotation.y = opts.rotY;
    return add(m, opts);
  };

  // ---------- Sky, fog, lights ----------
  scene.fog = new THREE.Fog('#b9c2ee', 260, 1600);
  {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color('#1f6fe0') }, mid: { value: new THREE.Color('#58a6ff') }, bottom: { value: new THREE.Color('#c3c8f2') } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(bottom, mid, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
      }),
    );
    sky.renderOrder = -1;
    scene.add(sky);
  }

  const hemi = new THREE.HemisphereLight('#dfe6ff', '#6c5f80', 1.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.3);
  const sunOffset = V(140, 220, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 10, far: 700 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  // ---------- Ground ----------
  {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), lambert('#ffffff', { map: T.grass }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.z = -450;
    grass.receiveShadow = true;
    scene.add(grass);

    T.testFloor.repeat.set(55, 60);
    const test = new THREE.Mesh(new THREE.PlaneGeometry(440, 480), lambert('#ffffff', { map: T.testFloor }));
    test.rotation.x = -Math.PI / 2;
    test.position.set(0, 0.04, -130);
    test.receiveShadow = true;
    scene.add(test);
  }

  // ---------- Launch hangar (octagonal, door facing the map) ----------
  const hangar = V(0, 0, 90);
  {
    const R = 32, H = 26, sides = 8;
    const L = 2 * R * Math.tan(Math.PI / sides);
    const circum = R / Math.cos(Math.PI / sides);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const dir = V(Math.sin(a), 0, Math.cos(a));
      if (i === 4) continue; // doorway
      box(L + 1.4, H, 2, M.lavender, hangar.x + dir.x * (R + 1), H / 2, hangar.z + dir.z * (R + 1), { rotY: a, tile: 6 });
      // Band of wall screens.
      const band = new THREE.Mesh(new THREE.BoxGeometry(L - 1, 7, 0.3), M.screenBand);
      band.position.set(hangar.x + dir.x * (R - 0.2), 13, hangar.z + dir.z * (R - 0.2));
      band.rotation.y = a;
      add(band, { collide: false, cast: false });
      for (let s = -1; s <= 1; s++) {
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.5), new THREE.MeshBasicMaterial({ map: T.screens[(i + s + 4) % 4], fog: true }));
        const side = V(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(s * 7.5);
        scr.position.set(hangar.x + dir.x * (R - 0.4) + side.x, 13, hangar.z + dir.z * (R - 0.4) + side.z);
        scr.rotation.y = a + Math.PI;
        scene.add(scr);
      }
    }
    // Hazard-striped door frame.
    const doorZ = hangar.z - R - 1;
    box(2.4, H, 3, M.hazard, -L / 2, H / 2, doorZ, { tile: 3 });
    box(2.4, H, 3, M.hazard, L / 2, H / 2, doorZ, { tile: 3 });
    box(L, 3, 3, M.hazard, 0, H - 1.5, doorZ, { tile: 3 });

    // Roof and ceiling light strips.
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(circum + 2, circum + 2, 2, sides), M.roof);
    roof.rotation.y = Math.PI / sides;
    roof.position.set(hangar.x, H + 1, hangar.z);
    add(roof, { collide: false });
    colliders.addCylinder(hangar, circum + 2, H, H + 2);
    const light = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, circum), light);
      strip.position.set(hangar.x + Math.sin(a) * circum / 2, H - 0.1, hangar.z + Math.cos(a) * circum / 2);
      strip.rotation.y = a;
      scene.add(strip);
    }

    const floor = new THREE.Mesh(new THREE.CircleGeometry(circum, sides), M.hangarFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.rotation.z = Math.PI / sides;
    floor.position.set(hangar.x, 0.08, hangar.z);
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(circum * 0.55, circum * 0.58, sides), lambert('#8d88c4'));
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = Math.PI / sides;
    ring.position.set(hangar.x, 0.12, hangar.z);
    scene.add(ring);

    // Launch stand: a slim post with a cradle under the missile.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, 7.2, 8), lambert('#5d5985'));
    post.position.set(hangar.x, 3.6, hangar.z + 0.4);
    add(post, { collide: false });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.6, 8), M.hazard);
    base.position.set(hangar.x, 0.3, hangar.z + 0.4);
    add(base, { collide: false });
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 2.6), lambert('#5d5985'));
    cradle.position.set(hangar.x, 7.55, hangar.z + 0.4);
    add(cradle, { collide: false });
    colliders.addCylinder(V(hangar.x, 0, hangar.z + 0.4), 0.9, 0, 7.4);
  }

  // ---------- Test area ----------
  {
    // Boundary walls.
    box(6, 50, 480, M.lavender, -223, 25, -130);
    box(6, 50, 480, M.lavender, 223, 25, -130);
    // Slalom walls with gaps on alternating sides.
    box(230, 44, 5, M.lavender, -105, 22, -40);
    box(230, 44, 5, M.lavender, 105, 22, -150);
    // Free-standing panels.
    box(5, 50, 70, M.lavender, 60, 25, -240);
    box(70, 40, 5, M.lavender, -150, 20, -300);
    // Dark orange-grid columns.
    box(22, 90, 22, M.orangeGrid, -160, 45, -95, { tile: 10 });
    box(18, 70, 18, M.orangeGrid, 160, 35, -95, { tile: 10 });
    box(20, 110, 20, M.orangeGrid, -60, 55, -250, { tile: 10 });
    box(26, 80, 26, M.orangeGrid, 150, 40, -285, { tile: 10 });
  }

  // ---------- Brick town ----------
  function warehouse(x, z, w, h, d, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    const body = new THREE.Mesh(worldBox(w, h, d, 8), M.brick);
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    colliders.addBoxMesh(body);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 1.4, d + 1.2), M.trim);
    trim.position.y = h + 0.1;
    trim.castShadow = true;
    g.add(trim);
    colliders.addBoxMesh(trim);
    const floors = Math.max(1, Math.floor(h / 11));
    const addWindows = (len, off, rot) => {
      const n = Math.floor(len / 13);
      for (let i = 0; i < n; i++) {
        for (let f = 0; f < floors; f++) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.2), M.window);
          const t = (i + 0.5) / n - 0.5;
          const y = 6 + f * 10.5;
          if (rot === 0 || rot === Math.PI) win.position.set(t * len, y, rot === 0 ? off : -off);
          else win.position.set(rot > 0 ? off : -off, y, t * len);
          win.rotation.y = rot;
          g.add(win);
        }
      }
    };
    addWindows(w, d / 2 + 0.06, 0);
    addWindows(w, d / 2 + 0.06, Math.PI);
    addWindows(d, w / 2 + 0.06, Math.PI / 2);
    addWindows(d, w / 2 + 0.06, -Math.PI / 2);
  }

  warehouse(-160, -470, 90, 22, 50);
  warehouse(90, -440, 60, 30, 40);
  warehouse(260, -580, 70, 18, 90);
  warehouse(-10, -680, 50, 26, 70);
  warehouse(-250, -700, 80, 20, 60);
  warehouse(150, -790, 100, 24, 45);
  warehouse(-110, -900, 60, 34, 60);
  warehouse(270, -920, 60, 22, 60);

  // Unfinished building: a grid of dark pillars and beams to weave through.
  {
    const cx = 40, cz = -560, hgt = 38;
    const xs = [-33, -11, 11, 33], zs = [-22, 0, 22];
    for (const px of xs) for (const pz of zs) box(3, hgt, 3, M.pillar, cx + px, hgt / 2, cz + pz, { tile: 4 });
    for (const pz of zs) {
      box(69, 2.5, 2.5, M.pillar, cx, hgt - 1.25, cz + pz, { tile: 4 });
      box(69, 2, 2, M.pillar, cx, 19, cz + pz, { tile: 4 });
    }
    for (const px of xs) box(2.5, 2.5, 47, M.pillar, cx + px, hgt - 1.25, cz, { tile: 4 });
  }

  // Shipping containers.
  {
    const cols = ['#d86a8b', '#e8c14a', '#4a79c9', '#3aa39a', '#c85a3c'];
    const r = rng(11);
    const stacks = [[320, -460, 0], [-330, -590, 0.4], [40, -985, -0.2], [-40, -790, 0.9], [330, -760, 0.1]];
    for (const [x, z, rot] of stacks) {
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const level = i < 2 ? 0 : 1;
        const off = i < 2 ? (i - 0.5) * 6.4 : 0;
        const m = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 14), lambert(cols[Math.floor(r() * cols.length)]));
        m.position.set(x + Math.cos(rot) * off, 3 + level * 6, z - Math.sin(rot) * off);
        m.rotation.y = rot;
        add(m);
      }
    }
  }

  // ---------- Orange lattice towers ----------
  const towers = [];
  {
    const beams = [];
    const seg = (a, b, t) => beams.push([a, b, t]);
    const tower = (x, z, h, baseHalf, topHalf, levels) => {
      const corners = [];
      for (let k = 0; k <= levels; k++) {
        const y = (h * k) / levels;
        const hw = THREE.MathUtils.lerp(baseHalf, topHalf, k / levels);
        corners.push([V(x - hw, y, z - hw), V(x + hw, y, z - hw), V(x + hw, y, z + hw), V(x - hw, y, z + hw)]);
      }
      for (let k = 0; k < levels; k++) {
        for (let j = 0; j < 4; j++) {
          const j2 = (j + 1) % 4;
          seg(corners[k][j], corners[k + 1][j], 1.2);
          seg(corners[k][j], corners[k + 1][j2], 0.6);
          seg(corners[k][j2], corners[k + 1][j], 0.6);
          if (k > 0) seg(corners[k][j], corners[k][j2], 0.8);
        }
      }
      for (let j = 0; j < 4; j++) seg(corners[levels][j], corners[levels][(j + 1) % 4], 0.8);
      // Cross-arms sticking out of the sides, keeping the middle open.
      const armY = h * 0.84, hw = THREE.MathUtils.lerp(baseHalf, topHalf, 0.84);
      seg(V(x - hw, armY, z), V(x - hw - 14, armY, z), 1);
      seg(V(x + hw, armY, z), V(x + hw + 14, armY, z), 1);
      seg(V(x - hw - 14, armY, z), V(x - hw, armY + 6, z), 0.6);
      seg(V(x + hw + 14, armY, z), V(x + hw, armY + 6, z), 0.6);
      towers.push({ x, z, h, baseHalf, topHalf });
    };
    tower(-70, -540, 110, 13, 6, 8);
    tower(200, -690, 90, 11, 5.5, 7);
    tower(-250, -930, 130, 14, 6.5, 9);

    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.tower, beams.length);
    inst.castShadow = inst.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), dir = V(0, 0, 0), mid = V(0, 0, 0), s = V(0, 0, 0);
    beams.forEach(([a, b, t], i) => {
      dir.subVectors(b, a);
      const len = dir.length() + t;
      dir.normalize();
      q.setFromUnitVectors(UP, dir);
      mid.addVectors(a, b).multiplyScalar(0.5);
      s.set(t, len, t);
      m.compose(mid, q, s);
      inst.setMatrixAt(i, m);
      colliders.addBox(mid, s, q);
    });
    scene.add(inst);
  }

  // ---------- Gates ----------
  const gates = [];
  {
    const R = 9, r = 1.1;
    const geo = new THREE.TorusGeometry(R, r, 10, 36);
    const hz = T.repeat(T.hazard, 12, 1);
    const mat = lambert('#ffffff', { map: hz, emissive: '#221400' });
    const list = [
      [110, 18, -40, 0], [-110, 18, -150, 0], [0, 34, -330, 0],
      [-60, 30, -420, 0.3], [150, 22, -640, -0.4], [-200, 26, -800, 0.5], [100, 40, -880, 0],
    ];
    for (const [x, y, z, rot] of list) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.castShadow = true;
      scene.add(m);
      colliders.addTorus(m.position, m.quaternion, R, r);
      gates.push({ mesh: m, center: m.position.clone(), normal: V(0, 0, 1).applyQuaternion(m.quaternion), R, r });
    }
  }

  // ---------- Trees ----------
  {
    const r = rng(99);
    const spots = [];
    let guard = 0;
    while (spots.length < 70 && guard++ < 2000) {
      const x = -480 + r() * 960, z = -380 - r() * 640;
      const p = V(x, 12, z);
      if (colliders.test(p, 10)) continue;
      if (towers.some((t) => Math.abs(t.x - x) < t.baseHalf + 26 && Math.abs(t.z - z) < t.baseHalf + 12)) continue;
      spots.push([x, z, 0.8 + r() * 0.6]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.6, 0.9, 7, 6);
    const leafGeo = new THREE.IcosahedronGeometry(5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, lambert('#6b4a33'), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, lambert('#ffffff', { flatShading: true }), spots.length);
    trunks.castShadow = leaves.castShadow = true;
    leaves.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const greens = ['#3f9a4a', '#2f8a3f', '#57ad4f', '#2b7c3c'];
    spots.forEach(([x, z, s], i) => {
      m.compose(V(x, 3.5 * s, z), q, V(s, s, s));
      trunks.setMatrixAt(i, m);
      q.setFromAxisAngle(UP, r() * 6);
      m.compose(V(x, 9 * s, z), q, V(s, s * 1.1, s));
      leaves.setMatrixAt(i, m);
      q.identity();
      leaves.setColorAt(i, c.set(greens[i % greens.length]));
      colliders.addSphere(V(x, 9 * s, z), 5 * s);
      colliders.addCylinder(V(x, 0, z), 0.9 * s, 0, 7 * s);
    });
    scene.add(trunks, leaves);
  }

  // ---------- Distant hills (scenery only) ----------
  {
    const r = rng(5);
    const mat = lambert('#6f8fa8', { flatShading: true });
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + r() * 0.1;
      const dist = 1500 + r() * 400;
      const h = 140 + r() * 260;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(160 + r() * 160, h, 6 + Math.floor(r() * 3)), mat);
      hill.position.set(Math.sin(a) * dist, h / 2 - 5, -450 + Math.cos(a) * dist);
      hill.rotation.y = r() * 3;
      scene.add(hill);
    }
  }

  // Areas where tanks patrol (x, z, radius).
  const tankAreas = [
    [100, -95, 40], [-120, -225, 45], [90, -330, 40],
    [-20, -490, 40], [165, -520, 35], [-160, -615, 40], [80, -705, 45],
    [-10, -830, 50], [170, -900, 35], [-230, -830, 40], [-300, -480, 40],
  ];
  const shieldSpots = [V(0, 22, -210), V(-160, 34, -615), V(230, 40, -805), V(-70, 55, -540)];

  return {
    colliders, gates, towers, tankAreas, shieldSpots,
    spawn: { pos: V(hangar.x, 8.5, hangar.z), dir: V(0, 0, -1) },
    hangar,
    followShadow(p) {
      sun.target.position.copy(p);
      sun.position.copy(p).add(sunOffset);
    },
    sun,
  };
}
