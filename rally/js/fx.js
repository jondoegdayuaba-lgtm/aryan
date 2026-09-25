// Particle effects and tyre marks: dust clouds, flying gravel, water spray,
// sparks, backfire flames and the ruts cars leave in the gravel.
import * as THREE from 'three';
import { SURF, WATER } from './gen.js';
import { G } from './shading.js';
import { bakeTexture } from './bake.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Camera-facing quads with per-instance position, size, rotation, colour, alpha.
class ParticlePool {
  constructor(max, texture, { additive = false, lit = true } = {}) {
    this.max = max;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: 1, s0: 1, s1: 1, rot: 0, spin: 0, a0: 1, col: new THREE.Color(), drag: 0, grav: 0, rise: 0, kind: 0 });
    this.next = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);   // xyz + size
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);   // rgb + alpha
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aPos, this.aCol, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aRot', this.aRot);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.uniforms = {
      uTex: { value: texture },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec4 aPos; attribute vec4 aCol; attribute float aRot;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        uniform float uFogDensity;
        void main() {
          vUv = uv; vCol = aCol;
          vec4 mv = viewMatrix * vec4( aPos.xyz, 1.0 );
          float c = cos( aRot ), s = sin( aRot );
          vec2 q = mat2( c, -s, s, c ) * position.xy * aPos.w;
          mv.xy += q;
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vFog = 1.0 - exp( -uFogDensity * uFogDensity * d * d );
          vCol.a *= smoothstep( 1.0, 7.0, d );   // don't blind the camera
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform vec3 uFogColor;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main() {
          vec4 t = texture2D( uTex, vUv );
          vec3 col = mix( vCol.rgb * t.rgb, uFogColor, ${additive ? '0.0' : 'vFog'} );
          float a = t.a * vCol.a * ${additive ? '(1.0 - vFog)' : '1.0'};
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( col, a );
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.order = new Int32Array(max);
    this.dist = new Float32Array(max);
  }

  spawn() {
    const p = this.p[this.next];
    this.next = (this.next + 1) % this.max;
    p.alive = true;
    p.age = 0;
    return p;
  }

  clear() { for (const p of this.p) p.alive = false; }

  update(dt, camera, world, sort = true) {
    let n = 0;
    const cam = camera.position;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      p.vel.y += (p.rise - p.grav) * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.grav > 0) {
        const gh = world.heightAt(p.pos.x, p.pos.z);
        if (p.pos.y < gh) { p.pos.y = gh; p.vel.y *= -0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; }
      }
      p.rot += p.spin * dt;
      this.order[n] = i;
      this.dist[i] = p.pos.distanceToSquared(cam);
      n++;
    }
    const ord = this.order.subarray(0, n);
    if (sort) ord.sort((a, b) => this.dist[b] - this.dist[a]);
    const P = this.aPos.array, C = this.aCol.array, R = this.aRot.array;
    for (let k = 0; k < n; k++) {
      const p = this.p[ord[k]];
      const t = p.age / p.life;
      P[k * 4] = p.pos.x; P[k * 4 + 1] = p.pos.y; P[k * 4 + 2] = p.pos.z;
      P[k * 4 + 3] = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      C[k * 4] = p.col.r; C[k * 4 + 1] = p.col.g; C[k * 4 + 2] = p.col.b;
      // fade in quickly, out slowly
      C[k * 4 + 3] = p.a0 * Math.min(1, t * 8) * (1 - t) * (1 - t);
      R[k] = p.rot;
    }
    for (const a of [this.aPos, this.aCol, this.aRot]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = n;
    this.count = n;
  }
}

// Tyre marks: a ring buffer of quads per wheel, fading with age.
class Skids {
  constructor(max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.dat = new Float32Array(max * 4 * 2);   // birth time, strength
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aDat', new THREE.BufferAttribute(this.dat, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.uniforms = { uNow: { value: 0 }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: /* glsl */`
        attribute vec2 aDat; varying float vA; uniform float uNow;
        void main() {
          float age = uNow - aDat.x;
          vA = aDat.y * ( 1.0 - smoothstep( 25.0, 45.0, age ) );
          gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() { gl_FragColor = vec4( 0.09, 0.075, 0.06, vA * 0.55 ); }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.next = 0;
    this.last = [null, null, null, null];
  }

  add(wheel, pIn, sideIn, width, strength, now) {
    // copy first: callers pass shared scratch vectors
    const p = this._p || (this._p = new THREE.Vector3());
    const side = this._s || (this._s = new THREE.Vector3());
    p.copy(pIn);
    side.copy(sideIn);
    const a = this._a || (this._a = new THREE.Vector3()), b = this._b || (this._b = new THREE.Vector3());
    const last = this.last[wheel];
    if (!last || strength <= 0.02) {
      this.last[wheel] = strength > 0.02 ? { p: p.clone(), side: side.clone(), s: strength } : null;
      return;
    }
    if (last.p.distanceToSquared(p) < 0.12) return;
    if (last.p.distanceToSquared(p) > 9) { this.last[wheel] = { p: p.clone(), side: side.clone(), s: strength }; return; }
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const hw = width / 2;
    const P = this.pos, o = i * 12;
    const a1 = a.copy(last.p).addScaledVector(last.side, -hw), a2 = b.copy(last.p).addScaledVector(last.side, hw);
    P[o] = a1.x; P[o + 1] = a1.y; P[o + 2] = a1.z;
    P[o + 3] = a2.x; P[o + 4] = a2.y; P[o + 5] = a2.z;
    const b1 = a.copy(p).addScaledVector(side, hw), b2 = b.copy(p).addScaledVector(side, -hw);
    P[o + 6] = b1.x; P[o + 7] = b1.y; P[o + 8] = b1.z;
    P[o + 9] = b2.x; P[o + 10] = b2.y; P[o + 11] = b2.z;
    const D = this.dat, d = i * 8;
    D[d] = now; D[d + 1] = last.s; D[d + 2] = now; D[d + 3] = last.s;
    D[d + 4] = now; D[d + 5] = strength; D[d + 6] = now; D[d + 7] = strength;
    const g = this.mesh.geometry;
    g.attributes.position.addUpdateRange(o, 12);
    g.attributes.position.needsUpdate = true;
    g.attributes.aDat.addUpdateRange(d, 8);
    g.attributes.aDat.needsUpdate = true;
    last.p.copy(p); last.side.copy(side); last.s = strength;
  }

  clear() {
    this.pos.fill(0);
    this.dat.fill(-1000);
    this.last = [null, null, null, null];
    const g = this.mesh.geometry;
    g.attributes.position.clearUpdateRanges();
    g.attributes.aDat.clearUpdateRanges();
    g.attributes.position.needsUpdate = true;
    g.attributes.aDat.needsUpdate = true;
  }
}

// How much dust each surface throws up, and its colour.
const DUST = {
  [SURF.GRAVEL]: [1, '#b3aa99'], [SURF.LOOSE]: [1.2, '#b0a592'], [SURF.DIRT]: [0.9, '#9a8a70'],
  [SURF.SAND]: [1.1, '#c0b396'], [SURF.GRASS]: [0.2, '#8a8468'], [SURF.TARMAC]: [0.05, '#777777'],
  [SURF.ROCK]: [0.15, '#8a8580'], [SURF.WATER]: [0, '#ffffff'],
};

export class Effects {
  constructor(renderer, scene, world, { dust = 1600 } = {}) {
    this.world = world;
    const soft = bakeTexture(renderer, /* glsl */`
      void main() {
        vec2 c = vUv - 0.5;
        float r = length( c ) * 2.0;
        float n = fbm( vUv * 0.999, 4., 5 ) * 0.5 + 0.5;
        float a = smoothstep( 1.0, 0.15, r + ( n - 0.5 ) * 0.7 );
        gl_FragColor = vec4( vec3( 0.82 + n * 0.2 ), a );
      }`, 128, { srgb: false, wrap: false });
    const spark = bakeTexture(renderer, /* glsl */`
      void main() {
        vec2 c = vUv - 0.5;
        float a = exp( -dot( c, c ) * 40.0 ) + exp( -dot( c, c ) * 400.0 );
        gl_FragColor = vec4( 1.0, 1.0, 1.0, clamp( a, 0.0, 1.0 ) );
      }`, 64, { srgb: false, wrap: false });
    this.dust = new ParticlePool(dust, soft);
    this.bits = new ParticlePool(500, soft);
    this.glow = new ParticlePool(300, spark, { additive: true });
    this.skids = new Skids();
    this.skids.clear();
    scene.add(this.dust.mesh, this.bits.mesh, this.glow.mesh, this.skids.mesh);
    this.acc = [0, 0, 0, 0];
    this.rain = 0;          // wet roads: spray instead of dust
    this.time = 0;
    this.dustTint = new THREE.Color();
    this.light = new THREE.Color(1, 1, 1);
  }

  clear() {
    this.dust.clear(); this.bits.clear(); this.glow.clear(); this.skids.clear();
  }

  // Scene lighting for the dust colour.
  setLighting(sunCol, ambient) { this.light.copy(sunCol).multiplyScalar(0.25).add(ambient); }

  // Emit from each wheel of a car. `vehicle` is the physics car.
  fromCar(vehicle, dt, strength = 1) {
    this.time += dt;
    const sp = vehicle.speed;
    vehicle.wheels.forEach((w, i) => {
      if (!w.contact) { this.skids.add(i, w.point, _v, 0, 0, this.time); return; }
      const surf = w.surface;
      const [dusty, hex] = DUST[surf] || DUST[SURF.GRAVEL];
      const slide = Math.min(1, w.slide);
      const spin = Math.min(1, Math.abs(w.slipRatio) * 1.5);
      // tyre marks: on loose ground every car leaves ruts; sliding makes them darker
      const side = _w.set(vehicle.L.x, vehicle.L.y, vehicle.L.z);
      const loose = surf === SURF.GRAVEL || surf === SURF.LOOSE || surf === SURF.DIRT || surf === SURF.SAND || surf === SURF.GRASS;
      const mark = (loose ? 0.25 : 0) + Math.max(slide - 0.35, 0) * 1.2 + (surf === SURF.TARMAC ? Math.max(slide - 0.6, 0) : 0);
      const p = _v.copy(w.point).addScaledVector(w.normal, 0.02);
      this.skids.add(i, p, side, vehicle.spec.wheelWidth * 0.9, Math.min(1, mark) * (sp > 1 ? 1 : 0), this.time);

      const water = Math.max(w.water, this.rain * 0.12);
      if (water > 0.02 && sp > 2) {
        // spray from fords, lake edges and wet roads
        this.acc[i] += dt * sp * 6 * Math.min(1, water * 4) * strength;
        while (this.acc[i] > 1) {
          this.acc[i] -= 1;
          const q = this.bits.spawn();
          q.pos.copy(w.point).addScaledVector(w.normal, 0.1);
          q.vel.copy(vehicle.vel).multiplyScalar(0.4).add(_v.set((Math.random() - 0.5) * 4, 2 + Math.random() * sp * 0.25, (Math.random() - 0.5) * 4));
          q.life = 0.7 + Math.random() * 0.5; q.s0 = 0.3; q.s1 = 1.6; q.a0 = 0.55;
          q.col.setRGB(0.85, 0.9, 0.95).multiply(this.light);
          if (!w.water) { q.a0 = 0.3; q.s1 = 2.4; q.life = 0.9; q.vel.y *= 0.5; }
          q.drag = 0.8; q.grav = 9; q.rise = 0; q.rot = Math.random() * 6; q.spin = (Math.random() - 0.5) * 2;
        }
        return;
      }
      const rate = dusty * (sp * 0.45 + slide * 16 + spin * 12) * strength;
      if (rate < 0.5 || sp < 1.5) return;
      this.acc[i] += dt * rate;
      const color = this.dustTint.set(hex);
      while (this.acc[i] > 1) {
        this.acc[i] -= 1;
        const q = this.dust.spawn();
        q.pos.copy(w.point).addScaledVector(w.normal, 0.25 + Math.random() * 0.2);
        q.pos.x += (Math.random() - 0.5) * 0.4; q.pos.z += (Math.random() - 0.5) * 0.4;
        q.vel.copy(vehicle.vel).multiplyScalar(0.08 + Math.random() * 0.12);
        q.vel.x += (Math.random() - 0.5) * 2.5; q.vel.z += (Math.random() - 0.5) * 2.5; q.vel.y += 0.3 + Math.random() * 0.7;
        q.life = 2 + Math.random() * 2 + dusty;
        q.s0 = 0.5 + Math.random() * 0.4; q.s1 = 3 + Math.random() * 2.5 + sp * 0.04;
        q.a0 = Math.min(0.32, 0.06 + dusty * 0.09 + slide * 0.1);
        q.col.copy(color).multiply(this.light).multiplyScalar(0.8 + Math.random() * 0.3);
        q.drag = 1.4; q.grav = 0; q.rise = 0.25; q.rot = Math.random() * 6.28; q.spin = (Math.random() - 0.5) * 0.6;
        // flying stones when the wheels dig in
        if ((spin > 0.3 || slide > 0.5) && Math.random() < 0.35 && dusty > 0.5) {
          const b = this.bits.spawn();
          b.pos.copy(w.point).addScaledVector(w.normal, 0.1);
          b.vel.copy(vehicle.vel).multiplyScalar(0.6).addScaledVector(vehicle.F, -3 - Math.random() * 4);
          b.vel.y += 1.5 + Math.random() * 3; b.vel.x += (Math.random() - 0.5) * 3; b.vel.z += (Math.random() - 0.5) * 3;
          b.life = 0.8 + Math.random() * 0.6; b.s0 = b.s1 = 0.05 + Math.random() * 0.05; b.a0 = 1;
          b.col.setRGB(0.25, 0.23, 0.2).multiply(this.light); b.drag = 0.2; b.grav = 9.8; b.rise = 0; b.spin = 8;
        }
      }
    });
  }

  sparks(point, normal, speed) {
    const n = Math.min(40, 6 + speed * 2);
    for (let k = 0; k < n; k++) {
      const q = this.glow.spawn();
      q.pos.copy(point);
      q.vel.copy(normal).multiplyScalar(-1 - Math.random() * 2).add(_v.set((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6));
      q.life = 0.25 + Math.random() * 0.4; q.s0 = 0.08; q.s1 = 0.03; q.a0 = 1;
      q.col.setRGB(3, 1.6, 0.5); q.drag = 0.5; q.grav = 9.8; q.rise = 0; q.spin = 0;
    }
  }

  // Bark chips and dirt when hitting trees or rocks.
  debris(point, color, speed) {
    const n = Math.min(30, 4 + speed * 1.5);
    for (let k = 0; k < n; k++) {
      const q = this.bits.spawn();
      q.pos.copy(point);
      q.vel.set((Math.random() - 0.5) * 7, 1 + Math.random() * 5, (Math.random() - 0.5) * 7);
      q.life = 0.9 + Math.random() * 0.8; q.s0 = q.s1 = 0.06 + Math.random() * 0.1; q.a0 = 1;
      q.col.set(color).multiply(this.light); q.drag = 0.3; q.grav = 9.8; q.rise = 0; q.spin = 6;
    }
    for (let k = 0; k < 6; k++) {
      const q = this.dust.spawn();
      q.pos.copy(point);
      q.vel.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
      q.life = 1.5 + Math.random(); q.s0 = 0.8; q.s1 = 3.5; q.a0 = 0.35;
      q.col.set('#8a7a60').multiply(this.light); q.drag = 1.2; q.grav = 0; q.rise = 0.3; q.rot = Math.random() * 6; q.spin = 0.3;
    }
  }

  // A flame spits out of the exhaust.
  backfire(pos, dir) {
    for (let k = 0; k < 6; k++) {
      const q = this.glow.spawn();
      q.pos.copy(pos).addScaledVector(dir, 0.05 + k * 0.06);
      q.vel.copy(dir).multiplyScalar(4 + Math.random() * 4);
      q.life = 0.08 + Math.random() * 0.06; q.s0 = 0.35 - k * 0.03; q.s1 = 0.15; q.a0 = 1;
      q.col.setRGB(4, 1.6 + Math.random(), 0.5 + Math.random() * 1.5); q.drag = 2; q.grav = 0; q.rise = 0; q.rot = Math.random() * 6; q.spin = 0;
    }
  }

  // A spectator's camera flash (night stages).
  flash(pos) {
    const q = this.glow.spawn();
    q.pos.copy(pos);
    q.vel.set(0, 0, 0);
    q.life = 0.07; q.s0 = 0.9; q.s1 = 0.5; q.a0 = 1;
    q.col.setRGB(9, 9, 10); q.drag = 0; q.grav = 0; q.rise = 0; q.rot = Math.random() * 6; q.spin = 0;
  }

  // A big landing throws out a ring of dust.
  landing(vehicle, power) {
    for (let k = 0; k < 16 * power; k++) {
      const q = this.dust.spawn();
      const a = Math.random() * Math.PI * 2;
      q.pos.copy(vehicle.pos).add(_v.set(Math.cos(a) * 1.4, -vehicle.spec.cgHeight + 0.3, Math.sin(a) * 1.8));
      q.vel.set(Math.cos(a) * 4, 0.6, Math.sin(a) * 4).addScaledVector(vehicle.vel, 0.3);
      q.life = 2 + Math.random() * 2; q.s0 = 1; q.s1 = 5; q.a0 = 0.35;
      q.col.set('#a89a82').multiply(this.light); q.drag = 1.8; q.grav = 0; q.rise = 0.2; q.rot = Math.random() * 6; q.spin = 0.4;
    }
  }

  update(dt, camera, scene) {
    const f = scene.fog;
    for (const pool of [this.dust, this.bits, this.glow]) {
      pool.uniforms.uFogColor.value.copy(f.color);
      pool.uniforms.uFogDensity.value = f.density;
    }
    this.dust.update(dt, camera, this.world, true);
    this.bits.update(dt, camera, this.world, false);
    this.glow.update(dt, camera, this.world, false);
    this.skids.uniforms.uNow.value = this.time;
  }
}
