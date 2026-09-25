// Things beside the stage: start and finish gantries, split boards, chevron
// boards on tight corners, hay bales you can knock flying, spectators who
// cheer when you pass, and the stars to find in free roam.
import * as THREE from 'three';
import { patch, G } from './shading.js';
import { rng } from './noise.js';
import { wrap } from './road.js';
import { WATER } from './gen.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function bannerTex(text, bg, fg, checker = false) {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (checker) {
      for (let x = 0; x < w; x += 32) for (let y = 0; y < h; y += 32) if (((x + y) / 32) % 2 === 0) { g.fillStyle = '#111'; g.fillRect(x, y, 32, 32); }
      g.fillStyle = bg; g.fillRect(w * 0.28, 14, w * 0.44, h - 28);
    }
    g.fillStyle = fg;
    g.font = 'italic bold 92px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

// A gantry spanning the road at sample i.
function gantry(road, world, i, text, colors, mats) {
  const W = road.halfWidth + 1.6;
  const group = new THREE.Group();
  const x = road.x[i], z = road.z[i];
  group.position.set(x, road.y[i], z);
  group.rotation.y = Math.atan2(road.tx[i], road.tz[i]);
  const legGeo = new THREE.BoxGeometry(0.35, 6.4, 0.35);
  for (const s of [-1, 1]) {
    const lx = x + road.tz[i] * W * s, lz = z - road.tx[i] * W * s;
    const gh = world.heightAt(lx, lz);
    const leg = new THREE.Mesh(legGeo, mats.frame);
    leg.position.set(s * W, gh - road.y[i] + 2.9, 0);
    leg.castShadow = true;
    group.add(leg);
  }
  const tex = bannerTex(text, colors[0], colors[1], text === 'FINISH');
  const banner = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.6, 1.3, 0.12), [mats.frame, mats.frame, mats.frame, mats.frame,
    patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), {}), patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), {})]);
  banner.position.y = 5.9;
  banner.castShadow = true;
  group.add(banner);
  return group;
}

function board(text, w = 1.8, h = 0.9, bg = '#ffc629', fg = '#111') {
  const tex = canvasTex(256, 128, (g, cw, ch) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    g.fillStyle = fg;
    g.font = 'italic bold 64px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, cw / 2, ch / 2 + 3);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }), {}));
  return m;
}

// A figure made of boxes, merged, with vertex colours per part.
function personGeometry() {
  const parts = [];
  const add = (g, col, x, y, z) => {
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  // colour channels: r = jacket mask, g = trousers mask, b = skin mask (recoloured per instance)
  add(new THREE.BoxGeometry(0.16, 0.8, 0.2), [0, 1, 0], -0.1, 0.4, 0);
  add(new THREE.BoxGeometry(0.16, 0.8, 0.2), [0, 1, 0], 0.1, 0.4, 0);
  add(new THREE.BoxGeometry(0.46, 0.66, 0.26), [1, 0, 0], 0, 1.12, 0);
  add(new THREE.BoxGeometry(0.12, 0.6, 0.14), [1, 0, 0], -0.3, 1.12, 0);
  add(new THREE.BoxGeometry(0.12, 0.6, 0.14), [1, 0, 0], 0.3, 1.12, 0);
  add(new THREE.SphereGeometry(0.13, 10, 8), [0, 0, 1], 0, 1.6, 0);
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nrm.set(p.attributes.normal.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const JACKETS = ['#c62828', '#1f5fbf', '#f2f2f2', '#1b1b1f', '#e8c547', '#2e7d32', '#ef6c00', '#6a1b9a', '#455a64', '#d81b60'];
const TROUSERS = ['#23262b', '#2b3a55', '#3d3a33', '#1b1b1f', '#4a4f57'];
const SKIN = ['#e6c1a1', '#c99a76', '#8d5b3c', '#f1d2b8'];

export class Props {
  constructor(world, notes, stages) {
    this.world = world;
    this.group = new THREE.Group();
    const road = world.road, n = road.count;
    const frame = patch(new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.6, metalness: 0.4 }), {});
    const mats = { frame };

    // Start and finish gantries for every stage, split boards along the way.
    this.gantries = [];
    for (const st of stages) {
      if (st.full) continue;
      const g1 = gantry(road, world, wrap(st.start, n), 'START', ['#ffc629', '#111'], mats);
      const g2 = gantry(road, world, wrap(st.end, n), 'FINISH', ['#f2f2f2', '#111'], mats);
      this.group.add(g1, g2);
      this.gantries.push(g1, g2);
      const len = (st.end - st.start + n) % n;
      for (const [k, frac] of [[1, 1 / 3], [2, 2 / 3]]) {
        const i = wrap(Math.round(st.start + len * frac), n);
        const b = board(`SPLIT ${k}`);
        const off = road.halfWidth + 2.2;
        const x = road.x[i] + road.tz[i] * off, z = road.z[i] - road.tx[i] * off;
        b.position.set(x, world.heightAt(x, z) + 1.5, z);
        b.rotation.y = Math.atan2(road.tx[i], road.tz[i]) + Math.PI;
        this.group.add(b);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), frame);
        post.position.set(x, world.heightAt(x, z) + 0.6, z);
        this.group.add(post);
      }
    }

    // Chevron boards on the outside of tight corners.
    const chevTex = (dir) => canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#d32f2f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      for (let k = 0; k < 3; k++) {
        const x0 = 40 + k * 70;
        g.beginPath();
        if (dir > 0) { g.moveTo(x0 + 40, 14); g.lineTo(x0, h / 2); g.lineTo(x0 + 40, h - 14); g.lineTo(x0 + 62, h - 14); g.lineTo(x0 + 22, h / 2); g.lineTo(x0 + 62, 14); }
        else { g.moveTo(x0, 14); g.lineTo(x0 + 40, h / 2); g.lineTo(x0, h - 14); g.lineTo(x0 + 22, h - 14); g.lineTo(x0 + 62, h / 2); g.lineTo(x0 + 22, 14); }
        g.closePath(); g.fill();
      }
    });
    const chevMat = [-1, 1].map((d) => patch(new THREE.MeshStandardMaterial({ map: chevTex(d), roughness: 0.6, side: THREE.DoubleSide }), {}));
    const chevGeo = new THREE.PlaneGeometry(1.3, 0.65);
    const postGeo = new THREE.BoxGeometry(0.08, 1.1, 0.08);
    this.bales = [];
    const baleSpots = [];
    for (const note of notes) {
      if (!(note.grade === 'hairpin' || note.grade === 'square' || note.grade === 1 || note.grade === 2)) continue;
      const len = (note.end - note.s + n) % n;
      const mid = wrap(note.s + Math.round(len / 2), n);
      const out = note.dir === 'left' ? -1 : 1;    // outside of the corner
      for (let k = -1; k <= 1; k++) {
        const i = wrap(mid + k * 5, n);
        const off = (road.halfWidth + 3.2) * out;
        const x = road.x[i] + road.tz[i] * off, z = road.z[i] - road.tx[i] * off;
        const gh = world.heightAt(x, z);
        if (gh < WATER + 0.3) continue;
        const b = new THREE.Mesh(chevGeo, chevMat[note.dir === 'left' ? 0 : 1]);
        b.position.set(x, gh + 1.2, z);
        // face the oncoming car
        const back = wrap(i - 30, n);
        b.lookAt(road.x[back], gh + 1.2, road.z[back]);
        this.group.add(b);
        const p = new THREE.Mesh(postGeo, frame);
        p.position.set(x, gh + 0.55, z);
        this.group.add(p);
      }
      if (note.grade === 'hairpin' || note.grade === 'square' || note.grade === 1) baleSpots.push({ i: mid, out, count: 5 });
    }

    // Spectators at jumps, crests and hairpins.
    const r = rng(4242);
    const crowd = [];
    for (const note of notes) {
      const big = note.grade === 'jump' || note.grade === 'hairpin' || note.mods.includes('over jump') || (note.grade === 'crest' && r() < 0.5);
      if (!big) continue;
      const i0 = note.s;
      for (const side of [-1, 1]) {
        if (r() < 0.3) continue;
        const people = 6 + Math.floor(r() * 12);
        for (let k = 0; k < people; k++) {
          const i = wrap(i0 - 10 + Math.floor(r() * 30), n);
          const off = (road.halfWidth + 6.5 + r() * 6) * side;
          const x = road.x[i] + road.tz[i] * off + (r() - 0.5), z = road.z[i] - road.tx[i] * off + (r() - 0.5);
          const gh = world.heightAt(x, z);
          if (gh < WATER + 0.5) continue;
          // skip spots crowded by trees
          let blocked = false;
          world.forObstacles(x, z, 1.5, (o) => { if (Math.hypot(o.x - x, o.z - z) < o.r + 0.5) blocked = true; });
          if (blocked) continue;
          crowd.push({ x, y: gh, z, face: Math.atan2(road.x[i] - x, road.z[i] - z) + (r() - 0.5) * 0.6, j: Math.floor(r() * JACKETS.length), t: Math.floor(r() * TROUSERS.length), s: Math.floor(r() * SKIN.length), h: 0.92 + r() * 0.16 });
        }
      }
      if (note.grade === 'jump' || note.mods.includes('over jump')) baleSpots.push({ i: wrap(note.s + 30, n), out: r() < 0.5 ? -1 : 1, count: 3 });
    }
    this.crowd = crowd;
    if (crowd.length) {
      const geo = personGeometry();
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
      const uni = { uCar: { value: new THREE.Vector3(1e5, 0, 0) } };
      patch(mat, {
        uniforms: uni,
        vertexPars: 'uniform vec3 uCar; attribute vec3 aJacket; attribute vec3 aTrousers; attribute vec3 aSkin; varying vec3 vPCol;',
        vertex: {
          '#include <begin_vertex>': /* glsl */`
            vec3 transformed = vec3( position );
            vec3 ip = instanceMatrix[3].xyz;
            float d = distance( ip.xz, uCar.xz );
            float ph = dot( ip.xz, vec2( 1.3, 0.7 ) );
            float cheer = smoothstep( 45.0, 15.0, d );
            transformed.y += max( 0.0, sin( uTime * 9.0 + ph ) ) * 0.28 * cheer;
            // arms go up when the car flies past
            if ( abs( position.x ) > 0.25 && position.y > 0.8 ) transformed.y += cheer * ( 0.35 + 0.2 * sin( uTime * 12.0 + ph ) );
            transformed.x += sin( uTime * 1.3 + ph ) * 0.02 * position.y;
            vPCol = color.r * aJacket + color.g * aTrousers + color.b * aSkin;`,
          '#include <color_vertex>': '',
        },
        fragmentPars: 'varying vec3 vPCol;',
        fragment: { '#include <color_fragment>': 'diffuseColor.rgb *= vPCol;' },
      });
      const mesh = new THREE.InstancedMesh(geo, mat, crowd.length);
      const aJ = new Float32Array(crowd.length * 3), aT = new Float32Array(crowd.length * 3), aS = new Float32Array(crowd.length * 3);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      const col = new THREE.Color();
      crowd.forEach((c, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.face);
        s.setScalar(c.h);
        p.set(c.x, c.y, c.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(k, m);
        col.set(JACKETS[c.j]).toArray(aJ, k * 3);
        col.set(TROUSERS[c.t]).toArray(aT, k * 3);
        col.set(SKIN[c.s]).toArray(aS, k * 3);
      });
      geo.setAttribute('aJacket', new THREE.InstancedBufferAttribute(aJ, 3));
      geo.setAttribute('aTrousers', new THREE.InstancedBufferAttribute(aT, 3));
      geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aS, 3));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.crowdMesh = mesh;
      this.crowdUniforms = uni;
      this.group.add(mesh);
    }

    // Hay bales: dynamic bodies you can send flying.
    const baleGeo = new THREE.CylinderGeometry(0.65, 0.65, 1.2, 16);
    baleGeo.rotateZ(Math.PI / 2);
    const baleTex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#c9a85a'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 400; k++) { g.strokeStyle = `rgba(${120 + Math.random() * 80},${90 + Math.random() * 60},40,0.5)`; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 8); g.stroke(); }
    });
    baleTex.wrapS = baleTex.wrapT = THREE.RepeatWrapping;
    const baleMat = patch(new THREE.MeshStandardMaterial({ map: baleTex, roughness: 0.95 }), {});
    const bales = [];
    for (const spot of baleSpots) {
      for (let k = 0; k < spot.count; k++) {
        const i = wrap(spot.i + (k - spot.count / 2) * 1.6, n);
        const off = (road.halfWidth + 1.9) * spot.out;
        const x = road.x[Math.round(i)] + road.tz[Math.round(i)] * off, z = road.z[Math.round(i)] - road.tx[Math.round(i)] * off;
        const gh = world.heightAt(x, z);
        if (gh < WATER + 0.3) continue;
        bales.push({
          pos: new THREE.Vector3(x, gh + 0.65, z), vel: new THREE.Vector3(), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(road.tx[Math.round(i)], road.tz[Math.round(i)]) + Math.PI / 2),
          ang: new THREE.Vector3(), r: 0.65, mass: 180, awake: false, home: new THREE.Vector3(x, gh + 0.65, z),
        });
      }
    }
    this.bales = bales;
    this.baleMesh = new THREE.InstancedMesh(baleGeo, baleMat, Math.max(1, bales.length));
    this.baleMesh.castShadow = true;
    this.baleMesh.receiveShadow = true;
    this.baleMesh.frustumCulled = false;
    this.baleMesh.count = bales.length;
    this.homeQuats = bales.map((b) => b.quat.clone());
    this._syncBales(true);
    this.group.add(this.baleMesh);

    // Free roam stars.
    this.stars = this._placeStars();
    const shape = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2, rr = k % 2 ? 0.45 : 1;
      k ? shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
    starGeo.center();
    const starMat = patch(new THREE.MeshStandardMaterial({ color: '#ffcf40', emissive: '#ffae00', emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.3 }), {});
    this.starGroup = new THREE.Group();
    const beamGeo = new THREE.CylinderGeometry(0.6, 0.6, 60, 12, 1, true);
    beamGeo.translate(0, 30, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ffcf40', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const s of this.stars) {
      const m = new THREE.Mesh(starGeo, starMat);
      m.position.set(s.x, s.y + 1.6, s.z);
      m.castShadow = true;
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(s.x, s.y, s.z);
      s.mesh = m;
      s.beam = beam;
      this.starGroup.add(m, beam);
    }
    this.starGroup.visible = false;
    this.group.add(this.starGroup);
  }

  // Twenty stars on hilltops, lake shores, jumps and out in the woods.
  _placeStars() {
    const w = this.world, r = rng(777);
    const out = [];
    for (let tries = 0; tries < 4000 && out.length < 20; tries++) {
      const x = (r() - 0.5) * 1700, z = (r() - 0.5) * 1700;
      const h = w.heightAt(x, z);
      if (h < WATER + 1.5) continue;
      const nrm = w.normalAt(x, z, new THREE.Vector3());
      if (nrm.y < 0.85) continue;
      let clear = true;
      w.forObstacles(x, z, 4, (o) => { if (Math.hypot(o.x - x, o.z - z) < o.r + 3) clear = false; });
      if (!clear) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 170)) continue;
      out.push({ x, y: h, z, got: false });
    }
    return out;
  }

  setStarsVisible(v, got = []) {
    this.starGroup.visible = v;
    this.stars.forEach((s, i) => { s.got = !!got[i]; s.mesh.visible = s.beam.visible = !s.got; });
  }

  // Returns the index of a star the car just touched, or -1.
  collectStar(pos) {
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      if (s.got) continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < 3.2 && Math.abs(s.y + 1.2 - pos.y) < 4) {
        s.got = true;
        s.mesh.visible = s.beam.visible = false;
        return i;
      }
    }
    return -1;
  }

  resetBales() {
    this.bales.forEach((b, i) => { b.pos.copy(b.home); b.vel.set(0, 0, 0); b.ang.set(0, 0, 0); b.quat.copy(this.homeQuats[i]); b.awake = false; });
    this._syncBales(true);
  }

  _syncBales(all = false) {
    const m = new THREE.Matrix4(), s = new THREE.Vector3(1, 1, 1);
    this.bales.forEach((b, i) => {
      if (!all && !b.awake && !b._moved) return;
      b._moved = b.awake;
      m.compose(b.pos, b.quat, s);
      this.baleMesh.setMatrixAt(i, m);
    });
    this.baleMesh.instanceMatrix.needsUpdate = true;
  }

  // Car against bales (sphere vs the car's box), then bale motion.
  update(dt, car, time) {
    if (this.crowdUniforms) this.crowdUniforms.uCar.value.copy(car.pos);
    for (const s of this.stars) if (s.mesh.visible) { s.mesh.rotation.y = time * 1.6; s.mesh.position.y = s.y + 1.6 + Math.sin(time * 2 + s.x) * 0.2; }
    const hits = [];
    const he = car.bodyHalf;
    const c = car._center || car.pos;
    for (const b of this.bales) {
      const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
      if (dx * dx + dz * dz < 36) {
        const dy = b.pos.y - c.y;
        const lx = dx * car.L.x + dy * car.L.y + dz * car.L.z;
        const ly = dx * car.U.x + dy * car.U.y + dz * car.U.z;
        const lz = dx * car.F.x + dy * car.F.y + dz * car.F.z;
        const bx = Math.max(-he.x, Math.min(he.x, lx)), by = Math.max(-he.y, Math.min(he.y, ly)), bz = Math.max(-he.z, Math.min(he.z, lz));
        const px = c.x + car.L.x * bx + car.U.x * by + car.F.x * bz;
        const py = c.y + car.L.y * bx + car.U.y * by + car.F.y * bz;
        const pz = c.z + car.L.z * bx + car.U.z * by + car.F.z * bz;
        const ex = b.pos.x - px, ey = b.pos.y - py, ez = b.pos.z - pz;
        const d = Math.hypot(ex, ey, ez);
        if (d < b.r && d > 1e-4) {
          const nx = ex / d, ny = ey / d, nz = ez / d;
          const rel = (car.vel.x - b.vel.x) * nx + (car.vel.y - b.vel.y) * ny + (car.vel.z - b.vel.z) * nz;
          if (rel > 0) {
            // light bale, heavy car: the bale takes almost all of it
            const j = (1.4 * rel) / (1 / b.mass + 1 / car.spec.mass);
            b.vel.x += (nx * j) / b.mass; b.vel.y += (ny * j) / b.mass + rel * 0.25; b.vel.z += (nz * j) / b.mass;
            car.vel.x -= (nx * j) / car.spec.mass; car.vel.y -= (ny * j) / car.spec.mass; car.vel.z -= (nz * j) / car.spec.mass;
            b.ang.set((Math.random() - 0.5) * rel, (Math.random() - 0.5) * rel, (Math.random() - 0.5) * rel);
            b.awake = true;
            if (rel > 2) hits.push({ point: new THREE.Vector3(px, py, pz), speed: rel });
          }
          b.pos.x += nx * (b.r - d); b.pos.y += ny * (b.r - d); b.pos.z += nz * (b.r - d);
        }
      }
      if (!b.awake) continue;
      b.vel.y -= 9.81 * dt;
      b.pos.addScaledVector(b.vel, dt);
      const gh = this.world.heightAt(b.pos.x, b.pos.z);
      if (b.pos.y - b.r < gh) {
        b.pos.y = gh + b.r;
        if (b.vel.y < 0) b.vel.y *= -0.25;
        b.vel.x *= 1 - Math.min(1, dt * 2.5); b.vel.z *= 1 - Math.min(1, dt * 2.5);
        b.ang.multiplyScalar(1 - Math.min(1, dt * 2));
      }
      const al = b.ang.length();
      if (al > 1e-4) b.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(b.ang.clone().divideScalar(al), al * dt));
      if (b.vel.lengthSq() < 0.01 && al < 0.1 && b.pos.y - b.r - gh < 0.05) b.awake = false;
    }
    this._syncBales();
    return hits;
  }
}
