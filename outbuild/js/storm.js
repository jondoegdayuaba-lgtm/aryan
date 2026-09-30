// The storm: a shrinking safe circle with a glowing wall, damaging anyone outside it.
import * as THREE from 'three';
import { STORM, WORLD } from './config.js';
import { lerp, clamp } from './util.js';

const VS = /* glsl */`
varying vec2 vUv;
varying vec3 vPos;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
}`;

const FS = /* glsl */`
uniform float uTime, uRadius;
uniform vec3 uColA, uColB;
varying vec2 vUv;
varying vec3 vPos;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; } return s; }
void main() {
  // world-scaled coordinates around the ring so the pattern keeps its size as the storm shrinks
  float ang = atan(vPos.z, vPos.x);
  vec2 p = vec2(ang * uRadius * 0.02, vPos.y * 0.02);
  float n = fbm(p * 1.6 + vec2(uTime * 0.05, -uTime * 0.12));
  float n2 = fbm(p * 4.0 + vec2(-uTime * 0.1, -uTime * 0.25));
  float streak = smoothstep(0.35, 0.9, fbm(vec2(p.x * 6.0, p.y * 0.8 - uTime * 0.4)));
  vec3 col = mix(uColA, uColB, n);
  col += uColB * streak * 0.6;
  float a = 0.35 + 0.35 * n + 0.2 * n2;
  a *= smoothstep(1.0, 0.72, vUv.y);
  // lightning flicker
  float flash = step(0.985, fract(sin(floor(uTime * 3.0) * 12.9898) * 43758.5453)) * step(0.7, n2);
  col += vec3(0.8, 0.7, 1.0) * flash * 2.0;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Storm {
  constructor(game) {
    this.game = game;
    this.uniforms = {
      uTime: { value: 0 }, uRadius: { value: 100 },
      uColA: { value: new THREE.Color('#3b1f8f') }, uColB: { value: new THREE.Color('#c05cff') },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, transparent: true,
      side: THREE.DoubleSide, depthWrite: false, fog: false });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 8;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
    this.reset();
  }

  reset() {
    this.center = new THREE.Vector2(0, 0);
    this.radius = STORM.startRadius;
    this.from = { c: this.center.clone(), r: this.radius };
    this.next = { c: this.center.clone(), r: this.radius };
    this.phase = -1;
    this.state = 'idle';
    this.timer = 0;
    this.dps = 1;
    this.net = false;
    this.mesh.visible = false;
  }

  // Online client: the host runs the storm; we copy its state and only count the timer down between updates.
  applyNet(st) {
    this.net = true;
    const changed = st.state !== this.state || st.phase !== this.phase;
    this.state = st.state;
    this.timer = st.timer;
    this.phase = st.phase;
    this.center.set(st.cx, st.cz);
    this.radius = st.r;
    this.next = { c: new THREE.Vector2(st.nx, st.nz), r: st.nr };
    this.dps = st.dps;
    if (changed && (st.state === 'wait' || st.state === 'shrink') && this.game.onStorm) this.game.onStorm(st.state, this);
  }

  start(rng, delay = STORM.startDelay) {
    this.rng = rng;
    this.state = 'pre';
    this.timer = delay;
    this.phase = -1;
    this.mesh.visible = false;
    this.pickNext();
  }

  pickNext() {
    const ph = STORM.phases[this.phase + 1];
    if (!ph) return;
    const r = ph.radius;
    const maxOff = Math.max(0, this.radius - r) * (this.phase < 0 ? 0.55 : 1);
    let best = null, bestScore = -1;
    const T = this.game.terrain;
    for (let i = 0; i < 24; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * maxOff;
      const c = new THREE.Vector2(this.center.x + Math.cos(a) * d, this.center.y + Math.sin(a) * d);
      // prefer circles over land
      let land = 0;
      for (let k = 0; k < 9; k++) {
        const aa = k / 9 * Math.PI * 2;
        const rr = k === 0 ? 0 : r * 0.7;
        if (T.heightAt(c.x + Math.cos(aa) * rr, c.y + Math.sin(aa) * rr) > 1) land++;
      }
      const inside = Math.hypot(c.x, c.y) < WORLD.islandRadius - 40 ? 1 : 0;
      const score = land + inside * 2 + this.rng.next() * 0.5;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    this.next = { c: best, r };
    this.from = { c: this.center.clone(), r: this.radius };
  }

  update(dt) {
    const u = this.uniforms;
    u.uTime.value += dt;
    if (this.state === 'idle') return;
    this.timer -= dt;
    if (this.net) {
      this.timer = Math.max(0, this.timer);
      this.updateMesh();
      return;
    }
    if (this.state === 'pre' && this.timer <= 0) {
      this.phase = 0;
      this.state = 'wait';
      this.timer = STORM.phases[0].wait;
      this.dps = STORM.phases[0].dps;
      if (this.game.onStorm) this.game.onStorm('wait', this);
    } else if (this.state === 'wait' && this.timer <= 0) {
      this.state = 'shrink';
      this.timer = STORM.phases[this.phase].shrink;
      if (this.game.onStorm) this.game.onStorm('shrink', this);
    } else if (this.state === 'shrink') {
      const ph = STORM.phases[this.phase];
      const t = clamp(1 - this.timer / ph.shrink, 0, 1);
      this.center.set(lerp(this.from.c.x, this.next.c.x, t), lerp(this.from.c.y, this.next.c.y, t));
      this.radius = lerp(this.from.r, this.next.r, t);
      if (this.timer <= 0) {
        this.center.copy(this.next.c);
        this.radius = this.next.r;
        const nextPh = STORM.phases[this.phase + 1];
        if (nextPh) {
          this.pickNext();
          this.phase++;
          this.state = 'wait';
          this.timer = nextPh.wait;
          this.dps = nextPh.dps;
          if (this.game.onStorm) this.game.onStorm('wait', this);
        } else {
          this.state = 'final';
          this.dps = STORM.phases[STORM.phases.length - 1].dps + 4;
        }
      }
    }
    this.updateMesh();
  }

  updateMesh() {
    const u = this.uniforms;
    this.mesh.visible = this.state === 'wait' || this.state === 'shrink' || this.state === 'final';
    const r = Math.max(0.5, this.radius);
    this.mesh.position.set(this.center.x, -30, this.center.y);
    this.mesh.scale.set(r, 700, r);
    u.uRadius.value = r;
  }

  distOutside(x, z) { return Math.hypot(x - this.center.x, z - this.center.y) - this.radius; }
  isOutside(x, z) { return this.state !== 'idle' && this.state !== 'pre' && this.distOutside(x, z) > 0; }

  // Text for the HUD.
  status() {
    if (this.state === 'pre') return { label: 'Storm forming', time: this.timer };
    if (this.state === 'wait') return { label: 'Storm shrinks in', time: this.timer };
    if (this.state === 'shrink') return { label: 'Storm shrinking', time: this.timer };
    if (this.state === 'final') return { label: 'Final storm', time: 0 };
    return { label: '', time: 0 };
  }
}
