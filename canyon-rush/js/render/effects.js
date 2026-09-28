// Particles and decals: dust plumes lit by the low sun (they glow when you look
// toward it), wheel spray, water splashes, cactus debris, exhaust flames, and
// tyre tracks pressed into the ground.
import * as THREE from 'three';
import { makePuffTexture, canvasTexture } from './textures.js';

const clamp = THREE.MathUtils.clamp;
const MAX = 4096;

// ---------- Soft, lit billboard particles ----------

const PARTICLE_VERT = /* glsl */ `
  attribute vec4 iPosSize;     // xyz, size
  attribute vec4 iColAlpha;    // rgb, alpha
  attribute vec2 iRotKind;     // rotation, kind (0 = dust, 1 = emissive)
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vKind;
  varying float vDepth;
  varying vec3 vWorldDir;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vCol = iColAlpha;
    vKind = iRotKind.y;
    vec4 mvPosition = modelViewMatrix * vec4(iPosSize.xyz, 1.0);
    float c = cos(iRotKind.x), s = sin(iRotKind.x);
    vec2 off = (uv - 0.5) * iPosSize.w;
    mvPosition.xy += vec2(off.x * c - off.y * s, off.x * s + off.y * c);
    vDepth = -mvPosition.z;
    vWorldDir = normalize(iPosSize.xyz - cameraPosition);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D tPuff;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform float uNear;
  uniform float uFar;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uAmbient;
  uniform float uSoft;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vKind;
  varying float vDepth;
  varying vec3 vWorldDir;
  #include <fog_pars_fragment>
  float linearDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  void main() {
    vec4 t = texture2D(tPuff, vUv);
    float a = t.a * vCol.a;
    if (uSoft > 0.5) {
      float scene = linearDepth(texture2D(tDepth, gl_FragCoord.xy / uRes).r);
      a *= clamp((scene - vDepth) / 1.2, 0.0, 1.0);
    }
    // Fade puffs that come very close to the camera.
    a *= clamp((vDepth - 0.6) / 2.5, 0.0, 1.0);
    if (a < 0.003) discard;
    vec3 col;
    if (vKind > 0.5) {
      col = vCol.rgb;                  // flames, sparks: emissive
    } else {
      // Light the puff: its top faces the sky, sunward edges catch the light,
      // and it glows when backlit (forward scattering).
      vec2 n2 = t.rg * 2.0 - 1.0;
      float lit = clamp(0.55 + 0.45 * (n2.y * 0.6 + dot(normalize(uSunDir.xz + 1e-4), n2) * 0.4), 0.0, 1.0);
      float fwd = pow(max(dot(vWorldDir, uSunDir), 0.0), 6.0);
      col = vCol.rgb * (uAmbient * (0.7 + 0.3 * t.b) + uSunCol * (lit * 0.8 + fwd * 2.5));
    }
    gl_FragColor = vec4(col * a, a);
    #include <fog_fragment>
  }
`;

class Particles {
  constructor(scene, puff, atmo) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.posSize = new Float32Array(MAX * 4);
    this.colAlpha = new Float32Array(MAX * 4);
    this.rotKind = new Float32Array(MAX * 2);
    const mk = (arr, n) => {
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(this.posSize, 4);
    this.aCol = mk(this.colAlpha, 4);
    this.aRot = mk(this.rotKind, 2);
    geo.setAttribute('iPosSize', this.aPos);
    geo.setAttribute('iColAlpha', this.aCol);
    geo.setAttribute('iRotKind', this.aRot);
    geo.instanceCount = 0;
    this.uniforms = {
      tPuff: { value: puff },
      tDepth: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.2 },
      uFar: { value: 30000 },
      uSunDir: { value: atmo.sunDir },
      uSunCol: { value: atmo.sunColor.clone().multiplyScalar(atmo.sunIntensity / Math.PI) },
      uAmbient: { value: atmo.skyAmbient.clone().multiplyScalar(1 / Math.PI) },
      uSoft: { value: 1 },
      ...THREE.UniformsLib.fog,
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    scene.add(this.mesh);
    this.geo = geo;
    this.list = [];
    this.order = [];
  }

  spawn(p) {
    if (this.list.length >= MAX) this.list.shift();
    p.age = 0;
    this.list.push(p);
  }

  update(dt, camera, wind) {
    const keep = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const drag = Math.exp(-p.drag * dt);
      p.vx = p.vx * drag + wind.x * (1 - drag);
      p.vz = p.vz * drag + wind.z * (1 - drag);
      p.vy = p.vy * drag - p.gravity * dt + p.buoy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.2; p.vx *= 0.6; p.vz *= 0.6; }
      p.rot += p.spin * dt;
      keep.push(p);
    }
    this.list = keep;
    // Back-to-front.
    const cp = camera.position;
    for (const p of keep) {
      const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z;
      p.d2 = dx * dx + dy * dy + dz * dz;
    }
    keep.sort((a, b) => b.d2 - a.d2);
    let n = 0;
    for (const p of keep) {
      const t = p.age / p.life;
      const size = p.size0 + (p.size1 - p.size0) * (1 - (1 - t) * (1 - t));
      const fadeIn = clamp(p.age / (p.fadeIn || 0.15), 0, 1);
      const alpha = p.alpha * fadeIn * Math.pow(1 - t, p.fadePow || 1.5);
      const k = n * 4;
      this.posSize[k] = p.x; this.posSize[k + 1] = p.y; this.posSize[k + 2] = p.z; this.posSize[k + 3] = size;
      this.colAlpha[k] = p.r; this.colAlpha[k + 1] = p.g; this.colAlpha[k + 2] = p.b; this.colAlpha[k + 3] = alpha;
      this.rotKind[n * 2] = p.rot;
      this.rotKind[n * 2 + 1] = p.kind || 0;
      n++;
    }
    this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aCol, this.aRot]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  clear() { this.list = []; this.geo.instanceCount = 0; }
}

// ---------- Tyre tracks ----------

class Tracks {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    this.segs = 700;
    const tex = canvasTexture(64, 256, (g, W, H) => {
      g.fillStyle = 'rgb(128,128,128)';
      g.fillRect(0, 0, W, H);
      // Tread imprint: staggered lugs.
      for (let y = 0; y < H; y += 32) {
        g.fillStyle = 'rgb(60,60,60)';
        g.fillRect(4, y + 2, W / 2 - 8, 14);
        g.fillRect(W / 2 + 4, y + 18, W / 2 - 8, 14);
      }
    }, { srgb: false, repeat: true });
    this.material = new THREE.ShaderMaterial({
      uniforms: { tTread: { value: tex }, ...THREE.UniformsLib.fog },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tTread;
        varying vec2 vUv;
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          float t = texture2D(tTread, vUv).r;
          float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          float a = vAlpha * edge * (0.45 + 0.55 * (1.0 - t));
          // Darken what's underneath (compressed, shaded ruts).
          gl_FragColor = vec4(vec3(0.0), a * 0.5);
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
    });
    this.wheels = [];
    for (let w = 0; w < 4; w++) {
      const n = this.segs * 2;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), alpha = new Float32Array(n);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
      const idx = [];
      for (let i = 0; i < this.segs; i++) {
        const a = i * 2, b = ((i + 1) % this.segs) * 2;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.wheels.push({ geo, pos, uv, alpha, head: 0, last: null, dist: 0, strength: new Float32Array(this.segs), mesh });
    }
  }

  // Adds a new cross-section for wheel w; `strength` 0 breaks the ribbon.
  add(w, point, side, width, strength) {
    const T = this.wheels[w];
    if (T.last && T.last.distanceToSquared(point) < 0.09 && strength > 0) return;
    const i = T.head;
    T.head = (T.head + 1) % this.segs;
    T.dist += T.last ? T.last.distanceTo(point) : 0;
    T.last = (T.last || new THREE.Vector3()).copy(point);
    for (const [k, s] of [[0, -0.5], [1, 0.5]]) {
      const x = point.x + side.x * width * s, z = point.z + side.z * width * s;
      const y = this.heightAt(x, z) + 0.03;
      const o = (i * 2 + k) * 3;
      T.pos[o] = x; T.pos[o + 1] = y; T.pos[o + 2] = z;
      T.uv[(i * 2 + k) * 2] = k;
      T.uv[(i * 2 + k) * 2 + 1] = T.dist / 1.2;
    }
    T.strength[i] = strength;
    // Break the strip at the write head so the oldest and newest don't join.
    const nxt = T.head;
    T.strength[nxt] = 0;
    T.dirty = true;
  }

  // Breaks the ribbon (wheel lifted).
  lift(w) {
    const T = this.wheels[w];
    if (T.last) { T.last = null; }
  }

  update() {
    for (const T of this.wheels) {
      // Fade with age: newest at head-1.
      for (let j = 0; j < this.segs; j++) {
        const age = (T.head - 1 - j + this.segs) % this.segs;
        const f = 1 - age / this.segs;
        const s = T.strength[j] * Math.min(1, f * 1.4);
        const nextIdx = (j + 1) % this.segs;
        const brk = T.strength[nextIdx] === 0 ? 0 : 1;
        T.alpha[j * 2] = T.alpha[j * 2 + 1] = s * brk;
      }
      if (T.dirty) {
        T.geo.attributes.position.needsUpdate = true;
        T.geo.attributes.uv.needsUpdate = true;
        T.dirty = false;
      }
      T.geo.attributes.aAlpha.needsUpdate = true;
    }
  }

  clear() {
    for (const T of this.wheels) {
      T.strength.fill(0);
      T.last = null;
    }
  }
}

// ---------- Debris (cactus chunks) ----------

class Debris {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    const geo = new THREE.CylinderGeometry(0.22, 0.26, 1, 10, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55703f, roughness: 0.75 });
    this.mesh = new THREE.InstancedMesh(geo, mat, 128);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.list = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  burst(ob, vel) {
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      if (this.list.length >= 128) this.list.shift();
      const h = ob.height * (i / n) + 0.3;
      this.list.push({
        x: ob.x + (Math.random() - 0.5) * 0.4, y: ob.base + h, z: ob.z + (Math.random() - 0.5) * 0.4,
        vx: vel.x * (0.35 + Math.random() * 0.4) + (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 5 + vel.length() * 0.08,
        vz: vel.z * (0.35 + Math.random() * 0.4) + (Math.random() - 0.5) * 4,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
        wx: (Math.random() - 0.5) * 12, wy: (Math.random() - 0.5) * 12, wz: (Math.random() - 0.5) * 12,
        len: (0.5 + Math.random() * 0.9) * ob.scale, age: 0, rest: 0,
      });
    }
  }

  update(dt) {
    let n = 0;
    const keep = [];
    for (const d of this.list) {
      d.age += dt;
      if (d.age > 25) continue;
      if (d.rest < 1) {
        d.vy -= 9.8 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
        const g = this.heightAt(d.x, d.z) + 0.2;
        if (d.y < g) {
          d.y = g;
          d.vy = Math.abs(d.vy) * 0.25;
          d.vx *= 0.55; d.vz *= 0.55;
          d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
          if (Math.abs(d.vy) < 0.6 && Math.hypot(d.vx, d.vz) < 0.6) d.rest = 1;
        }
      }
      keep.push(d);
      this._e.set(d.rx, d.ry, d.rz);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(d.x, d.y, d.z), this._q, this._s.set(1, d.len, 1));
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.list = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.list = []; this.mesh.count = 0; }
}

// ---------- Effects manager ----------

export class Effects {
  constructor(scene, atmo, heightAt, { soft = true } = {}) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.particles = new Particles(scene, makePuffTexture(), atmo);
    this.particles.uniforms.uSoft.value = soft ? 1 : 0;
    this.tracks = new Tracks(scene, heightAt);
    this.debris = new Debris(scene, heightAt);
    this.wind = new THREE.Vector3(2.2, 0, 0.6);
    this.acc = [0, 0, 0, 0];
    this.exhaustAcc = 0;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.dustColors = {
      sand: [0.62, 0.43, 0.26], dirt: [0.5, 0.38, 0.27], road: [0.52, 0.4, 0.29], playa: [0.66, 0.58, 0.48], rock: [0.5, 0.35, 0.25],
    };
  }

  // Per-frame emitters for the truck.
  truck(dt, vehicle, bodyQuat, boost) {
    const P = this.particles;
    const up = this._v.set(0, 1, 0).applyQuaternion(bodyQuat);
    vehicle.wheels.forEach((w, i) => {
      if (!w.contact) {
        this.tracks.lift(i);
        return;
      }
      const surf = w.surface;
      const sp = vehicle.speed;
      // Tyre tracks: deeper on sand, faint on packed road, none in water.
      if (surf.name !== 'water') {
        const side = this._w.set(1, 0, 0).applyQuaternion(bodyQuat);
        side.y = 0;
        side.normalize();
        const s = surf.name === 'sand' ? 0.8 : surf.name === 'playa' ? 0.55 : surf.name === 'rock' ? 0.15 : surf.name === 'road' ? 0.3 : 0.45;
        this.tracks.add(i, w.point, side, 0.34, clamp(s + w.slipLong * 0.3 + Math.min(1, w.slipLat / 6) * 0.3, 0, 1));
      } else this.tracks.lift(i);

      if (surf.name === 'water') {
        // Spray.
        const rate = clamp(sp / 4, 0, 6) * 14;
        this.acc[i] += rate * dt;
        while (this.acc[i] > 1) {
          this.acc[i] -= 1;
          P.spawn({
            x: w.point.x + (Math.random() - 0.5) * 0.5, y: w.point.y + 0.2, z: w.point.z + (Math.random() - 0.5) * 0.5,
            vx: vehicle.vel.x * 0.5 + (Math.random() - 0.5) * 3, vy: 1.5 + Math.random() * 3 + sp * 0.12, vz: vehicle.vel.z * 0.5 + (Math.random() - 0.5) * 3,
            drag: 0.8, gravity: 9, buoy: 0, life: 0.7 + Math.random() * 0.6, size0: 0.4, size1: 1.8 + sp * 0.06,
            alpha: 0.5, r: 0.85, g: 0.9, b: 0.95, rot: Math.random() * 6, spin: 0.5, fadeIn: 0.05,
          });
        }
        return;
      }
      // Dust: more with speed, wheelspin and sliding, and on loose ground.
      const slip = w.slipLong * 2.2 + Math.min(1.5, w.slipLat / 5);
      const rear = w.front ? 0.6 : 1;
      const rate = surf.dust * rear * (clamp((sp - 2) / 22, 0, 1.5) * 16 + slip * 22);
      this.acc[i] += rate * dt;
      const col = this.dustColors[surf.name] || this.dustColors.dirt;
      while (this.acc[i] > 1) {
        this.acc[i] -= 1;
        const big = Math.random() < 0.45;
        const vy = 0.6 + Math.random() * 1.4 + slip * 1.4;
        // Dust is dragged along in the truck's wake before it settles.
        const kick = 0.35 + Math.random() * 0.25 + w.slipLong * 0.15;
        P.spawn({
          x: w.point.x + (Math.random() - 0.5) * 0.6, y: w.point.y + 0.35, z: w.point.z + (Math.random() - 0.5) * 0.6,
          vx: vehicle.vel.x * kick + (Math.random() - 0.5) * 1.8, vy, vz: vehicle.vel.z * kick + (Math.random() - 0.5) * 1.8,
          drag: 1.1, gravity: 0.15, buoy: 0.35, life: big ? 4 + Math.random() * 3.5 : 1.5 + Math.random(),
          size0: 1.4, size1: big ? 7 + sp * 0.16 : 3.2, alpha: (big ? 0.5 : 0.6) * clamp(0.4 + surf.dust * 0.5, 0.3, 1.1),
          r: col[0] * (0.9 + Math.random() * 0.2), g: col[1] * (0.9 + Math.random() * 0.2), b: col[2] * (0.9 + Math.random() * 0.2),
          rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.6, fadeIn: 0.2, fadePow: 1.2,
        });
      }
    });

    // Exhaust: flames when boosting, a puff of smoke otherwise.
    if (boost || vehicle.throttleInput > 0.8) {
      this.exhaustAcc += dt * (boost ? 60 : 8);
      while (this.exhaustAcc > 1) {
        this.exhaustAcc -= 1;
        for (const sx of [-0.55, 0.55]) {
          const p = this._s.set(sx, -0.16 - 0.3, 2.95).applyQuaternion(bodyQuat).add(vehicle.pos);
          const back = this._w.set(0, 0, 1).applyQuaternion(bodyQuat);
          P.spawn({
            x: p.x, y: p.y, z: p.z,
            vx: vehicle.vel.x + back.x * 6, vy: vehicle.vel.y + 0.4, vz: vehicle.vel.z + back.z * 6,
            drag: 3, gravity: 0, buoy: 0.5, life: boost ? 0.12 : 0.6, size0: boost ? 0.35 : 0.25, size1: boost ? 0.7 : 1.2,
            alpha: boost ? 1 : 0.18, r: boost ? 3.5 : 0.2, g: boost ? 1.4 : 0.18, b: boost ? 0.5 : 0.16,
            rot: Math.random() * 6, spin: 2, kind: boost ? 1 : 0, fadeIn: 0.02,
          });
        }
      }
    }
    void up;
  }

  // A cloud of dust when landing hard or hitting something.
  burst(point, strength, color = this.dustColors.dirt) {
    const n = Math.floor(10 + strength * 30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5 * strength;
      this.particles.spawn({
        x: point.x, y: point.y + 0.3, z: point.z,
        vx: Math.cos(a) * sp, vy: 0.8 + Math.random() * 2.5 * strength, vz: Math.sin(a) * sp,
        drag: 1.6, gravity: 0.1, buoy: 0.3, life: 2 + Math.random() * 2.5, size0: 1, size1: 4 + strength * 3,
        alpha: 0.28, r: color[0], g: color[1], b: color[2], rot: Math.random() * 6, spin: (Math.random() - 0.5), fadeIn: 0.1,
      });
    }
  }

  cactusBreak(ob, vel) {
    this.debris.burst(ob, vel);
    const p = this._v.set(ob.x, ob.base + 1.2, ob.z);
    for (let i = 0; i < 18; i++) {
      this.particles.spawn({
        x: p.x, y: p.y + Math.random() * ob.height * 0.6, z: p.z,
        vx: vel.x * 0.3 + (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: vel.z * 0.3 + (Math.random() - 0.5) * 4,
        drag: 2, gravity: 0.3, buoy: 0.1, life: 1.2 + Math.random(), size0: 0.5, size1: 2.4,
        alpha: 0.3, r: 0.45, g: 0.5, b: 0.3, rot: Math.random() * 6, spin: 1, fadeIn: 0.05,
      });
    }
    this.burst(this._v.set(ob.x, ob.base, ob.z), 0.4);
  }

  update(dt, camera, post) {
    this.particles.uniforms.tDepth.value = post.depthTexture;
    this.particles.uniforms.uRes.value.set(post.width, post.height);
    this.particles.uniforms.uNear.value = camera.near;
    this.particles.uniforms.uFar.value = camera.far;
    this.particles.update(dt, camera, this.wind);
    this.tracks.update();
    this.debris.update(dt);
  }

  clear() {
    this.particles.clear();
    this.tracks.clear();
    this.debris.clear();
  }
}
