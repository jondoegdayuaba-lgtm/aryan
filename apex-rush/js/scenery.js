// Sky, sun, ground and far hills (built once), plus the trees, grandstands,
// buildings and boulders placed around whichever track is loaded.
import * as THREE from 'three';
import { rng } from './textures.js';
import { KERB } from './path.js';

const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.43).normalize();
const HORIZON = '#cfe6fb';

// Jitter a geometry's vertices (after merging duplicates) for a hand-cut look.
function roughen(geo, amount, rand) {
  const p = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, [(rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount]);
    const [dx, dy, dz] = seen.get(k);
    p.setXYZ(i, p.getX(i) + dx, p.getY(i) + dy * 0.6, p.getZ(i) + dz);
  }
  return geo;
}

// Merge non-indexed geometries, painting each a flat colour.
function merge(parts) {
  const pos = [], col = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(color.r, color.g, color.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildScenery(scene, T, { mobile = false } = {}) {
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 380, 2700);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3200, 48, 24),
    new THREE.MeshBasicMaterial({ map: T.sky, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -2;
  scene.add(sky);

  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.sun, fog: false, depthWrite: false, transparent: true }));
  sunGlow.scale.set(700, 700, 1);
  sunGlow.renderOrder = -1;
  scene.add(sunGlow);

  const hemi = new THREE.HemisphereLight('#d9ecff', '#71806a', 1.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dd', 2.5);
  sun.castShadow = true;
  const size = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 10, far: 600 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  // Tiled rather than one giant quad, and nudged back in depth, so it never
  // shows through the road lying just above it.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 90, 90), new THREE.MeshLambertMaterial({
    map: T.grass, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  }));
  T.grass.repeat.set(9000 / 26, 9000 / 26);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // A ring of faceted green hills on the horizon.
  const hills = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  scene.add(hills);
  {
    const rand = rng(91);
    const tints = ['#5fae83', '#4e9e76', '#73bb8f', '#41906c', '#86c49a'].map((c) => new THREE.Color(c));
    const parts = [];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rand() * 0.1;
      const d = 1500 + rand() * 700;
      const r = 150 + rand() * 260, h = 70 + rand() * 210;
      const geo = roughen(new THREE.ConeGeometry(r, h, 6 + ((rand() * 3) | 0), 3), r * 0.18, rand);
      geo.rotateY(rand() * 3);
      geo.translate(Math.cos(a) * d, h / 2 - 12, Math.sin(a) * d);
      parts.push({ geo, color: tints[(rand() * tints.length) | 0] });
    }
    hills.geometry = merge(parts);
  }

  let decor = null;

  return {
    sun,
    // Keep the shadow camera (and the sky) centred on the action.
    follow(p) {
      sun.target.position.copy(p);
      sun.position.copy(p).addScaledVector(SUN_DIR, 300);
      sky.position.set(p.x, 0, p.z);
      sunGlow.position.copy(p).addScaledVector(SUN_DIR, 2900);
    },

    // Trees, stands, buildings and rocks for a track.
    populate(path, opts = {}) {
      if (decor) {
        scene.remove(decor);
        decor.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      }
      decor = new THREE.Group();
      const rand = rng(opts.seed ?? 1);
      const b = path.bounds;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      hills.position.set(cx, 0, cz);
      ground.position.x = cx;
      ground.position.z = cz;
      const placed = [];
      const free = (x, z, r, roadGap) => path.clearance(x, z) > r + roadGap && placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r);
      const spot = (r, roadGap, margin, tries = 40) => {
        for (let i = 0; i < tries; i++) {
          const x = b.minX - margin + rand() * (b.maxX - b.minX + margin * 2);
          const z = b.minZ - margin + rand() * (b.maxZ - b.minZ + margin * 2);
          if (free(x, z, r, roadGap)) { placed.push({ x, z, r }); return { x, z }; }
        }
        return null;
      };

      // Grandstands along the start straight.
      if (opts.stands) {
        const parts = [];
        const seat = [new THREE.Color('#e2342d'), new THREE.Color('#2f6ff0'), new THREE.Color('#ffd21f')];
        const concrete = new THREE.Color('#c5c9d3'), roof = new THREE.Color('#e9ebf0'), dark = new THREE.Color('#5c6170');
        for (const side of [1, -1]) {
          const along = path.start.s + (side > 0 ? 40 : -30);
          const o = path.at(along, {});
          const lat = side * (o.hw + KERB + 10);
          const x = o.x + o.rx * lat, z = o.z + o.rz * lat;
          if (path.clearance(x, z) < 7) continue;
          const len = 60, rows = 6;
          const add = (geo, color) => {
            geo.rotateY(o.yaw + side * Math.PI / 2);   // local x along the track, -z away from it
            geo.translate(x, 0, z);
            parts.push({ geo, color });
          };
          for (let r = 0; r < rows; r++) {
            const g = new THREE.BoxGeometry(len, 1 + r * 1.1, 2.2);
            g.translate(0, (1 + r * 1.1) / 2, -(r * 2.2 + 1.1));
            add(g, r % 2 ? concrete : seat[(r / 2 | 0) % 3]);
          }
          const back = new THREE.BoxGeometry(len, 11, 0.6);
          back.translate(0, 5.5, -rows * 2.2 - 0.3);
          add(back, dark);
          const canopy = new THREE.BoxGeometry(len + 2, 0.5, rows * 2.2 + 3);
          canopy.translate(0, 11.2, -rows * 1.1 + 0.6);
          add(canopy, roof);
          for (let i = -2; i <= 2; i++) {
            const post = new THREE.BoxGeometry(0.4, 11, 0.4);
            post.translate(i * len / 4.2, 5.5, 1.6);
            add(post, dark);
          }
          placed.push({ x, z, r: 30 });
        }
        if (parts.length) {
          const m = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
          m.castShadow = m.receiveShadow = true;
          decor.add(m);
        }
      }

      // Big grey blocks out past the track, like hangars and factory sheds.
      {
        const parts = [];
        const greys = ['#8f95a4', '#a3a9b7', '#767d8d', '#b4b9c5'].map((c) => new THREE.Color(c));
        const n = opts.buildings ?? 9;
        for (let i = 0; i < n; i++) {
          const w = 24 + rand() * 50, d = 20 + rand() * 40, h = 10 + rand() * 26;
          const p = spot(Math.max(w, d) * 0.6, 26, 160);
          if (!p) continue;
          const yaw = rand() * Math.PI;
          const g = new THREE.BoxGeometry(w, h, d);
          g.translate(0, h / 2, 0);
          const top = new THREE.BoxGeometry(w * 0.5, 3 + rand() * 4, d * 0.5);
          top.translate((rand() - 0.5) * w * 0.3, h + 2, (rand() - 0.5) * d * 0.3);
          for (const geo of [g, top]) { geo.rotateY(yaw); geo.translate(p.x, 0, p.z); }
          const c = greys[(rand() * greys.length) | 0];
          parts.push({ geo: g, color: c }, { geo: top, color: greys[(rand() * greys.length) | 0] });
        }
        if (parts.length) {
          const m = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
          m.castShadow = m.receiveShadow = true;
          decor.add(m);
        }
      }

      // Boulders.
      if (opts.rocks) {
        const parts = [];
        const greys = ['#9a958c', '#857f76', '#aaa59b'].map((c) => new THREE.Color(c));
        for (let i = 0; i < 70; i++) {
          const r = 3 + rand() * 9;
          const p = spot(r, 9, 120);
          if (!p) continue;
          const g = roughen(new THREE.DodecahedronGeometry(r, 0), r * 0.35, rand);
          g.scale(1, 0.55 + rand() * 0.5, 1);
          g.rotateY(rand() * 3);
          g.translate(p.x, r * 0.2, p.z);
          parts.push({ geo: g, color: greys[(rand() * greys.length) | 0] });
        }
        if (parts.length) {
          const m = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
          m.castShadow = m.receiveShadow = true;
          decor.add(m);
        }
      }

      // Trees in loose clumps: round ones and pines.
      {
        const count = opts.trees ?? 200;
        const trees = [];
        let guard = 0;
        while (trees.length < count && guard++ < count * 12) {
          const c = spot(2, 10, 220, 1);
          if (!c) continue;
          placed.pop();
          const clump = 1 + ((rand() * 6) | 0);
          for (let j = 0; j < clump && trees.length < count; j++) {
            const x = c.x + (rand() - 0.5) * 30, z = c.z + (rand() - 0.5) * 30;
            if (!free(x, z, 1.5, 9)) continue;
            trees.push({ x, z, s: 0.8 + rand() * 0.7, pine: rand() < 0.4, yaw: rand() * 6, tint: rand() });
          }
        }
        const crownColors = ['#2f9150', '#3fa45b', '#2a7f45', '#56b166'].map((c) => new THREE.Color(c));
        const pineColors = ['#24774a', '#2e8a55', '#1f6a42'].map((c) => new THREE.Color(c));
        const trunk = new THREE.CylinderGeometry(0.28, 0.36, 2.2, 5);
        trunk.translate(0, 1.1, 0);
        const round = roughen(new THREE.IcosahedronGeometry(2.4, 0), 0.6, rng(5));
        round.translate(0, 4.4, 0);
        const pine = new THREE.ConeGeometry(2.4, 7, 6);
        pine.translate(0, 5.4, 0);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
        const mk = (geo, list, color) => {
          if (!list.length) return;
          const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), list.length);
          list.forEach((t, i) => {
            inst.setMatrixAt(i, m.compose(v.set(t.x, 0, t.z), q.setFromEuler(e.set(0, t.yaw, 0)), s.setScalar(t.s)));
            inst.setColorAt(i, color(t));
          });
          inst.castShadow = true;
          inst.receiveShadow = true;
          decor.add(inst);
        };
        const brown = new THREE.Color('#7b5a3c');
        mk(trunk, trees, () => brown);
        mk(round, trees.filter((t) => !t.pine), (t) => crownColors[(t.tint * crownColors.length) | 0]);
        mk(pine, trees.filter((t) => t.pine), (t) => pineColors[(t.tint * pineColors.length) | 0]);
      }

      scene.add(decor);
    },
  };
}
