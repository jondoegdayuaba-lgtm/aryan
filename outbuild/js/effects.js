// Visual effects: particles (sparks, smoke, dust), debris chunks, tracers, muzzle flashes, explosions.
import * as THREE from 'three';

const MAT_COLORS = {
  wood: [0xb98552, 0x8a5d34, 0xd4a26c], stone: [0x9aa3ad, 0x7d8793, 0xc2c8ce], metal: [0x8d99a6, 0x5d6670, 0xd0d6dc],
  dirt: [0x7a5c3e, 0x5e4630, 0x9a7a58], grass: [0x5c9a36, 0x3f7a2e, 0x86bf4a],
};

// ----------------------------------------------------------------------------- sprite particles
const P_VS = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
attribute float aRot;
varying vec4 vColor;
varying float vRot;
uniform float uScale;
void main() {
  vColor = aColor;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}`;
const P_FS = /* glsl */`
varying vec4 vColor;
varying float vRot;
uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot), co = cos(vRot);
  c = mat2(co, -s, s, co) * c;
  float d = length(c) * 2.0;
  float a = uSoft > 0.5 ? smoothstep(1.0, 0.2, d) * (0.75 + 0.25 * sin(c.x * 9.0 + vRot * 3.0) * sin(c.y * 8.0)) : smoothstep(1.0, 0.6, d);
  if (a <= 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, cap, additive, soft) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.alpha0 = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aRot', this.aRot);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VS, fragmentShader: P_FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft ? 1 : 0 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 11;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, { grow = 0, drag = 1, grav = 0 } = {}) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.alpha0[i] = a;
    this.size[i] = size;
    this.rot[i] = Math.random() * 6.28;
    this.life[i] = life;
    this.max[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const d = Math.pow(this.drag[i], dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += dt * 0.6;
      const t = this.life[i] / this.max[i];
      this.col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 2.5);
    }
    this.n = n;
    this.points.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aRot.needsUpdate = true;
  }

  copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.size[to] = this.size[from]; this.rot[to] = this.rot[from]; this.life[to] = this.life[from];
    this.max[to] = this.max[from]; this.grow[to] = this.grow[from]; this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from]; this.alpha0[to] = this.alpha0[from];
  }
}

// ----------------------------------------------------------------------------- debris chunks
class Chunks {
  constructor(scene, terrain, cap = 700) {
    this.cap = cap;
    this.terrain = terrain;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  emit(x, y, z, vx, vy, vz, size, color, life = 1.6) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ x, y, z, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      sx: (Math.random() - 0.5) * 12, sy: (Math.random() - 0.5) * 12, size: size * (0.6 + Math.random() * 0.8),
      sq: 0.4 + Math.random() * 0.6, color, life, max: life });
  }

  update(dt) {
    let w = 0;
    for (const c of this.items) {
      c.life -= dt;
      if (c.life <= 0) continue;
      c.vy -= 22 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.sx * dt; c.ry += c.sy * dt;
      const g = this.terrain.heightAt(c.x, c.z);
      if (c.y < g + c.size * 0.3) {
        c.y = g + c.size * 0.3;
        c.vy *= -0.3; c.vx *= 0.6; c.vz *= 0.6; c.sx *= 0.5; c.sy *= 0.5;
      }
      this.items[w++] = c;
    }
    this.items.length = w;
    for (let i = 0; i < w; i++) {
      const c = this.items[i];
      const s = c.size * Math.min(1, c.life / c.max * 3);
      this._q.setFromEuler(this._e.set(c.rx, c.ry, c.rz));
      this._s.set(s, s * c.sq, s * 0.8);
      this._p.set(c.x, c.y, c.z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c.setHex(c.color));
    }
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ----------------------------------------------------------------------------- effects facade
export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.add = new Particles(scene, 3000, true, false);
    this.smoke = new Particles(scene, 2500, false, true);
    this.chunks = new Chunks(scene, game.terrain);
    // tracers: stretched quads
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.tracerGeo = tg;
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.6), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracerMatSniper = this.tracerMat.clone();
    this.tracerMatSniper.color = new THREE.Color(2, 3, 5);
    // flashes
    this.flashes = [];
    const fl = new THREE.PlaneGeometry(1, 1);
    this.flashGeo = fl;
    this.flashTex = this.makeFlashTexture();
    this.flashMat = new THREE.MeshBasicMaterial({ map: this.flashTex, color: new THREE.Color(5, 3.5, 1.8), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, peak: 0 });
    }
    this.fireballs = [];
    this.fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3, 1.2), transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.fireGeo = new THREE.IcosahedronGeometry(1, 2);
  }

  makeFlashTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,220,150,0.9)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g;
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const r = i % 2 ? 12 : 32;
      x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    x.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  light(pos, color, peak, dur) {
    const l = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    l.light.position.copy(pos);
    l.light.color.set(color);
    l.peak = peak;
    l.t = dur;
    l.dur = dur;
    l.light.intensity = peak;
  }

  tracer(from, to, kind, hit, visible = true) {
    if (!visible) return;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const m = new THREE.Mesh(this.tracerGeo, kind === 'sniper' ? this.tracerMatSniper : this.tracerMat);
    m.position.copy(from);
    m.lookAt(to);
    const w = kind === 'sniper' ? 0.03 : 0.012;
    m.scale.set(w, w, len);
    m.renderOrder = 13;
    this.game.scene.add(m);
    this.tracers.push({ mesh: m, t: kind === 'sniper' ? 0.35 : 0.06, max: kind === 'sniper' ? 0.35 : 0.06 });
  }

  muzzleFlash(pos, dir, kind) {
    const m = new THREE.Mesh(this.flashGeo, this.flashMat);
    m.position.copy(pos);
    m.lookAt(this.game.camera.position);
    const s = kind === 'rocket' ? 1.1 : kind.includes('shot') || kind === 'pump' || kind === 'tactical' || kind === 'sniper' ? 0.8 : 0.5;
    m.scale.setScalar(s * (0.8 + Math.random() * 0.4));
    m.rotation.z = Math.random() * 6.28;
    this.game.scene.add(m);
    this.flashes.push({ mesh: m, t: 0.05 });
    this.light(pos, 0xffb060, 6, 0.06);
    for (let i = 0; i < 3; i++) {
      this.smoke.emit(pos.x, pos.y, pos.z, dir.x * 1.5 + (Math.random() - 0.5), dir.y * 1.5 + Math.random() * 0.5,
        dir.z * 1.5 + (Math.random() - 0.5), 0.7, 0.7, 0.7, 0.25, 0.25, 0.5, { grow: 0.8, drag: 0.2 });
    }
  }

  impact(p, n, mat, heavy = false) {
    const cols = MAT_COLORS[mat] || MAT_COLORS.stone;
    const c = new THREE.Color(cols[0]);
    const count = heavy ? 10 : 5;
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(n.x + (Math.random() - 0.5) * 1.2, n.y + Math.random() * 0.8, n.z + (Math.random() - 0.5) * 1.2)
        .multiplyScalar(3 + Math.random() * 4);
      this.chunks.emit(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, v.x, v.y, v.z, heavy ? 0.1 : 0.06,
        cols[Math.floor(Math.random() * 3)], 0.8);
    }
    for (let i = 0; i < (heavy ? 5 : 3); i++) {
      this.smoke.emit(p.x, p.y, p.z, n.x * 1.5 + (Math.random() - 0.5), n.y * 1.5 + Math.random(), n.z * 1.5 + (Math.random() - 0.5),
        c.r * 0.9 + 0.1, c.g * 0.9 + 0.1, c.b * 0.9 + 0.1, 0.45, 0.35, 0.7, { grow: 1.2, drag: 0.15 });
    }
    if (mat === 'metal' || mat === 'stone') {
      for (let i = 0; i < 6; i++) {
        this.add.emit(p.x, p.y, p.z, n.x * 5 + (Math.random() - 0.5) * 6, n.y * 5 + Math.random() * 4,
          n.z * 5 + (Math.random() - 0.5) * 6, 1, 0.75, 0.35, 1, 0.07, 0.25, { grav: 15, drag: 0.5 });
      }
    }
  }

  splash(p) {
    for (let i = 0; i < 10; i++) {
      this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.85, 0.95,
        1, 0.7, 0.25, 0.6, { grav: 12, grow: 0.4 });
    }
  }

  // Broken build piece / house part
  debris(bounds, mat) {
    const cols = MAT_COLORS[mat] || MAT_COLORS.wood;
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    const sx = bounds.maxX - bounds.minX, sy = bounds.maxY - bounds.minY, sz = bounds.maxZ - bounds.minZ;
    for (let i = 0; i < 18; i++) {
      const x = cx + (Math.random() - 0.5) * sx, y = cy + (Math.random() - 0.5) * sy, z = cz + (Math.random() - 0.5) * sz;
      this.chunks.emit(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 5, (Math.random() - 0.5) * 5, 0.25 + Math.random() * 0.3,
        cols[i % 3], 1.8);
    }
    const c = new THREE.Color(cols[0]).lerp(new THREE.Color(0xcccccc), 0.5);
    for (let i = 0; i < 14; i++) {
      const x = cx + (Math.random() - 0.5) * sx, y = cy + (Math.random() - 0.5) * sy, z = cz + (Math.random() - 0.5) * sz;
      this.smoke.emit(x, y, z, (Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5, c.r, c.g, c.b, 0.55,
        1.4, 1.6, { grow: 2.2, drag: 0.3 });
    }
  }

  propBreak(p) {
    const cols = MAT_COLORS[p.mat] || MAT_COLORS.wood;
    const h = p.type.proto.box.max.y * p.scale;
    for (let i = 0; i < 16; i++) {
      this.chunks.emit(p.x + (Math.random() - 0.5) * 2, p.y + Math.random() * h * 0.6, p.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 6, Math.random() * 6, (Math.random() - 0.5) * 6, 0.25, cols[i % 3], 1.6);
    }
    for (let i = 0; i < 10; i++) {
      this.smoke.emit(p.x + (Math.random() - 0.5) * 2, p.y + Math.random() * h * 0.5, p.z + (Math.random() - 0.5) * 2, 0, 0.8, 0,
        0.75, 0.72, 0.66, 0.5, 1.6, 1.8, { grow: 2.5, drag: 0.3 });
    }
  }

  buildPuff(bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28;
      this.add.emit(cx + Math.cos(a) * 1.8, bounds.minY + Math.random() * (bounds.maxY - bounds.minY), cz + Math.sin(a) * 1.8,
        0, 1.2, 0, 0.35, 0.65, 1.3, 0.8, 0.25, 0.6, { drag: 0.5 });
    }
  }

  explosion(p, radius) {
    const fb = new THREE.Mesh(this.fireGeo, this.fireMat.clone());
    fb.position.copy(p);
    fb.scale.setScalar(0.5);
    this.game.scene.add(fb);
    this.fireballs.push({ mesh: fb, t: 0, max: 0.45, r: radius * 0.8 });
    this.light(p, 0xff8a3a, 60, 0.5);
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 10);
      this.add.emit(p.x, p.y, p.z, v.x, v.y, v.z, 1, 0.6 + Math.random() * 0.3, 0.2, 1, 0.12, 0.6 + Math.random() * 0.5, { grav: 12, drag: 0.4 });
    }
    for (let i = 0; i < 24; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).multiplyScalar(4);
      const d = 0.2 + Math.random() * 0.25;
      this.smoke.emit(p.x + v.x * 0.3, p.y + v.y * 0.3, p.z + v.z * 0.3, v.x, v.y, v.z, d, d, d, 0.75, 2, 2.5 + Math.random(),
        { grow: 3, drag: 0.35 });
    }
    for (let i = 0; i < 12; i++) {
      this.chunks.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 14, Math.random() * 12, (Math.random() - 0.5) * 14, 0.15, 0x3a3a3a, 1.5);
    }
    const d = this.game.camera.position.distanceTo(p);
    if (this.game.rig && d < 40) this.game.rig.addShake(1.2 * (1 - d / 40));
  }

  rocketTrail(p) {
    this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, 0.8, 0.8, 0.8, 0.5, 0.4, 1.4,
      { grow: 1.4, drag: 0.4 });
    this.add.emit(p.x, p.y, p.z, 0, 0, 0, 1, 0.6, 0.2, 1, 0.35, 0.08);
  }

  landingDust(p) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      this.smoke.emit(p.x, p.y + 0.1, p.z, Math.cos(a) * 3, 0.4, Math.sin(a) * 3, 0.8, 0.74, 0.62, 0.5, 0.8, 1.2, { grow: 1.5, drag: 0.2 });
    }
  }

  // Blue-white shards rising where someone was eliminated.
  eliminate(p) {
    for (let i = 0; i < 40; i++) {
      this.add.emit(p.x + (Math.random() - 0.5) * 0.8, p.y + Math.random() * 1.8, p.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6, 0.35, 0.8, 1.4, 1, 0.12, 1.5 + Math.random(),
        { drag: 0.8 });
    }
  }

  sparkle(p) {
    this.add.emit(p.x + (Math.random() - 0.5) * 0.8, p.y + 0.3 + Math.random() * 0.6, p.z + (Math.random() - 0.5) * 0.8, 0, 0.6, 0,
      1.4, 1.1, 0.4, 1, 0.08, 0.9);
  }

  update(dt) {
    const cam = this.game.camera;
    this.add.mat.uniforms.uScale.value = this.smoke.mat.uniforms.uScale.value =
      (this.game.renderer.renderer.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    this.add.update(dt);
    this.smoke.update(dt);
    this.chunks.update(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.game.scene.remove(t.mesh); this.tracers.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) { this.game.scene.remove(f.mesh); this.flashes.splice(i, 1); }
    }
    for (const l of this.lights) {
      if (l.t > 0) { l.t -= dt; l.light.intensity = Math.max(0, l.peak * (l.t / l.dur)); } else l.light.intensity = 0;
    }
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.t += dt;
      const k = f.t / f.max;
      f.mesh.scale.setScalar(0.5 + f.r * Math.sqrt(k));
      f.mesh.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) { this.game.scene.remove(f.mesh); f.mesh.material.dispose(); this.fireballs.splice(i, 1); }
    }
  }
}
