import * as THREE from 'three';

/** CPU particle pool drawn as soft round points (sparks additive, smoke alpha-blended). */
export class Particles {
  constructor(scene, max = 700, additive = true) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.base = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.pos.fill(1e6);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;
        void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vColor;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;
          gl_FragColor = vec4(vColor.rgb, vColor.a * a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, grow = 0, gravity = 0) {
    const i = this.i = (this.i + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.base[i] = size;
    this.grow[i] = grow;
    this.grav[i] = gravity;
    this.a0[i] = a;
    this.col.set([r, g, b, a], i * 4);
    this.size[i] = size;
  }

  update(dt, camera, height) {
    this.mat.uniforms.uScale.value = height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = 1e6; this.col[i * 4 + 3] = 0; continue; }
      const k = this.life[i] / this.maxLife[i];
      const p = i * 3;
      this.vel[p + 1] -= this.grav[i] * dt;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] = Math.max(0.03, this.pos[p + 1] + this.vel[p + 1] * dt);
      this.pos[p + 2] += this.vel[p + 2] * dt;
      if (this.pos[p + 1] <= 0.03 && this.grav[i] > 0) { this.vel[p + 1] *= -0.3; this.vel[p] *= 0.7; this.vel[p + 2] *= 0.7; }
      this.size[i] = this.base[i] + this.grow[i] * (1 - k);
      this.col[i * 4 + 3] = this.a0[i] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

/** GPU rain: streaks wrap inside a box that follows the camera and slant with your speed. */
export class Rain {
  constructor(scene, n = 3200) {
    const seed = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) { seed.set(s, (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -22, 0) }, uLen: { value: 0.9 } },
      vertexShader: `attribute vec3 aSeed; attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uLen; varying float vA;
        void main(){
          vec3 box = vec3(56., 34., 56.);
          vec3 p = aSeed * box + uVel * uTime;
          p = mod(p - uCam + box * 0.5, box) - box * 0.5;
          vec3 w = uCam + p + normalize(uVel) * uLen * aEnd * -1.0;
          vA = (1.0 - length(p.xz) / 30.0) * (0.35 + 0.65 * aEnd) * smoothstep(1.5, 5.0, length(p));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.8, 0.95, clamp(vA, 0.0, 1.0) * 0.2); }`,
    });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    scene.add(this.lines);
  }

  update(t, cam, vx, vz, speed) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCam.value.copy(cam);
    u.uVel.value.set(-vx * 0.9 + 1.5, -24, -vz * 0.9 + 0.6);
    u.uLen.value = 0.7 + speed * 0.045;
  }
}
