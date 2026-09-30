// Visual effects: snow spray particles and the tracks the skis leave in the snow.
import * as THREE from 'three';
import { makeRng } from './util.js';

const MAX = 2600;

const SPRAY_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
	vAlpha = aAlpha;
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	gl_PointSize = aSize * uScale / max( - mv.z, 0.5 );
	gl_Position = projectionMatrix * mv;
}`;

const SPRAY_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main() {
	vec2 p = gl_PointCoord - 0.5;
	float d = dot( p, p ) * 4.0;
	float a = smoothstep( 1.0, 0.15, d ) * vAlpha;
	if ( a < 0.01 ) discard;
	gl_FragColor = vec4( uColor * ( 0.88 + 0.12 * ( 1.0 - d ) ), a );
}`;

export class SnowSpray {
  constructor(radiance) {
    this.n = MAX;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.sizeAttr = new Float32Array(MAX);
    this.alphaAttr = new Float32Array(MAX);
    this.head = 0;
    this.rng = makeRng(77);
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      uniforms: { uColor: { value: new THREE.Color(radiance[0], radiance[1], radiance[2]) }, uScale: { value: 900 } },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.alive = 0;
  }

  setViewport(h, fov) {
    this.material.uniforms.uScale.value = (h * 0.5) / Math.tan((fov * Math.PI) / 360);
  }

  /** emit `count` puffs from p with base velocity (vx,vy,vz) and random spread */
  emit(px, py, pz, vx, vy, vz, count, spread = 1.5, size = 0.16, life = 0.9) {
    const r = this.rng;
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.n;
      const o = i * 3;
      this.pos[o] = px + (r() - 0.5) * 0.25; this.pos[o + 1] = py + r() * 0.08; this.pos[o + 2] = pz + (r() - 0.5) * 0.25;
      this.vel[o] = vx + (r() - 0.5) * spread; this.vel[o + 1] = vy + r() * spread * 0.9; this.vel[o + 2] = vz + (r() - 0.5) * spread;
      this.life[i] = this.maxLife[i] = life * (0.6 + 0.8 * r());
      this.size0[i] = size * (0.6 + 0.9 * r());
    }
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alphaAttr[i] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      const k = 1 - Math.min(1, 1.9 * dt);
      this.vel[o] *= k; this.vel[o + 2] *= k;
      this.vel[o + 1] = this.vel[o + 1] * k - 5.2 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.sizeAttr[i] = this.size0[i] * (1 + 2.6 * t);
      this.alphaAttr[i] = 0.75 * (1 - t) * Math.min(1, t * 8);
      alive++;
    }
    this.alive = alive;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------- ski tracks
const TRACK_VERT = /* glsl */`
attribute float aFade;
varying vec2 vUv;
varying float vFade;
void main() {
	vUv = uv;
	vFade = aFade;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const TRACK_FRAG = /* glsl */`
uniform vec3 uColor;
varying vec2 vUv;
varying float vFade;
void main() {
	float edge = smoothstep( 0.0, 0.45, vUv.x ) * smoothstep( 1.0, 0.55, vUv.x );
	float a = edge * vFade * 0.62;
	if ( a < 0.01 ) discard;
	gl_FragColor = vec4( uColor, a );
}`;

export class SkiTracks {
  /**
   * @param world WorldData (for the ground height)
   * @param radiance [r,g,b] colour of a compressed-snow groove in scene radiance units
   */
  constructor(world, radiance, segments = 3200) {
    this.world = world;
    this.M = segments;
    const M = segments;
    this.pos = new Float32Array(M * 4 * 3);
    this.uv = new Float32Array(M * 4 * 2);
    this.fade = new Float32Array(M * 4);
    const idx = new Uint32Array(M * 6);
    for (let i = 0; i < M; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
      this.uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    }
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: TRACK_VERT,
      fragmentShader: TRACK_FRAG,
      uniforms: { uColor: { value: new THREE.Color(radiance[0], radiance[1], radiance[2]) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.head = 0;
    this.last = [null, null];
  }

  reset() {
    this.fade.fill(0);
    this.last = [null, null];
    this.geometry.attributes.aFade.needsUpdate = true;
  }

  /** add a track sample for ski `k` (0 left, 1 right); half-width w, lateral direction (rx, rz) */
  add(k, x, z, rx, rz, w, strength) {
    const y = this.world.height(x, z) + 0.035;
    const cur = { x, y, z, lx: x - rx * w, lz: z - rz * w, rx: x + rx * w, rz: z + rz * w };
    const prev = this.last[k];
    if (prev) {
      const d = Math.hypot(x - prev.x, z - prev.z);
      if (d < 0.35) return;
      if (d > 6) { this.last[k] = cur; return; }
      const i = this.head;
      this.head = (this.head + 1) % this.M;
      const o = i * 12;
      const hl = (px, pz) => this.world.height(px, pz) + 0.035;
      this.pos.set([prev.lx, hl(prev.lx, prev.lz), prev.lz, prev.rx, hl(prev.rx, prev.rz), prev.rz,
        cur.lx, hl(cur.lx, cur.lz), cur.lz, cur.rx, hl(cur.rx, cur.rz), cur.rz], o);
      const f = Math.min(1, strength);
      this.fade.set([f, f, f, f], i * 4);
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aFade.needsUpdate = true;
    }
    this.last[k] = cur;
  }

  breakTrack() {
    this.last = [null, null];
  }
}
