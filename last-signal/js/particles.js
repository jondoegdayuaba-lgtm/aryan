// Soft point-sprite particles for flames, sparks, smoke, splashes and breath. One system per blend mode.
import * as THREE from 'three';
import { ATMO, ATMO_GLSL } from './atmosphere.js';
import { makeCanvas } from './textures.js';

const VERT = /* glsl */`
attribute vec4 aData;      // size, alpha, seed, unused
attribute vec3 aColor;
uniform float uScale;
varying vec4 vData;
varying vec3 vColor;
varying vec3 vRay;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vRay = mv.xyz * mat3( viewMatrix );
  vData = aData;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp( aData.x * uScale / max( -mv.z, 0.1 ), 0.0, 900.0 );
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uUseFog;
uniform float uLit;
varying vec4 vData;
varying vec3 vColor;
varying vec3 vRay;
${ATMO_GLSL}
void main() {
  vec4 t = texture2D( uMap, gl_PointCoord );
  float a = t.a * vData.y;
  if ( a < 0.004 ) discard;
  vec3 col = vColor * t.rgb;
  if ( uUseFog > 0.5 ) {
    // smoke and dust take the day's light and dissolve into the haze
    col *= uLit;
    col = applyAtmosphere( col, vRay );
  }
  gl_FragColor = vec4( col, a );
}`;

export function softSprite(kind) {
  const [c, g] = makeCanvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'flame') {
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else if (kind === 'smoke') {
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ParticleSystem {
  constructor({ max = 800, additive = false, sprite = 'flame', fog = false }) {
    this.max = max;
    this.count = 0;
    const N = max;
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3);
    this.age = new Float32Array(N); this.life = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N); this.a0 = new Float32Array(N);
    this.c0 = new Float32Array(N * 3); this.c1 = new Float32Array(N * 3);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N);
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aData', this.data);
    this.geo.setAttribute('aColor', this.col);
    this.geo.setDrawRange(0, 0);
    this.uniforms = { ...ATMO, uMap: { value: softSprite(sprite) }, uScale: { value: 800 }, uUseFog: { value: fog ? 1 : 0 }, uLit: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 15;
  }

  // o: {x,y,z, vx,vy,vz, life, size0, size1, alpha, c0:[r,g,b], c1:[r,g,b], grav, drag}
  emit(o) {
    let i;
    if (this.count < this.max) i = this.count++;
    else { i = (this._next = ((this._next || 0) + 1) % this.max); }
    const p = this.p, v = this.v;
    p[i * 3] = o.x; p[i * 3 + 1] = o.y; p[i * 3 + 2] = o.z;
    v[i * 3] = o.vx || 0; v[i * 3 + 1] = o.vy || 0; v[i * 3 + 2] = o.vz || 0;
    this.age[i] = 0; this.life[i] = o.life || 1;
    this.s0[i] = o.size0 ?? 1; this.s1[i] = o.size1 ?? o.size0 ?? 1; this.a0[i] = o.alpha ?? 1;
    const a = o.c0 || [1, 1, 1], b = o.c1 || a;
    this.c0.set(a, i * 3); this.c1.set(b, i * 3);
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag ?? 0.5;
  }

  update(dt, camera, viewportHeight, lit = 1) {
    this.uniforms.uScale.value = viewportHeight * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    this.uniforms.uLit.value = lit;
    let n = this.count;
    const P = this.pos.array, D = this.data.array, C = this.col.array;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        // swap the last live particle into this slot
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[n * 3 + k]; this.v[i * 3 + k] = this.v[n * 3 + k]; this.c0[i * 3 + k] = this.c0[n * 3 + k]; this.c1[i * 3 + k] = this.c1[n * 3 + k]; }
          this.age[i] = this.age[n]; this.life[i] = this.life[n]; this.s0[i] = this.s0[n]; this.s1[i] = this.s1[n]; this.a0[i] = this.a0[n];
          this.grav[i] = this.grav[n]; this.drag[i] = this.drag[n];
        }
        i--;
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dr - this.grav[i] * dt; this.v[i * 3 + 2] *= dr;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      const fadeIn = Math.min(1, t * 6), fadeOut = 1 - t;
      D[i * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      D[i * 4 + 1] = this.a0[i] * fadeIn * fadeOut * fadeOut;
      for (let k = 0; k < 3; k++) C[i * 3 + k] = this.c0[i * 3 + k] + (this.c1[i * 3 + k] - this.c0[i * 3 + k]) * t;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.pos.needsUpdate = this.data.needsUpdate = this.col.needsUpdate = true;
  }
}
