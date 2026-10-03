// Terrain, river, sky, sun, fog, time of day and grass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, hash2 } from './util.js';

// ---------------------------------------------------------------------------
// Terrain: heights from Blender's terrain.bin, drawn in chunks.
// ---------------------------------------------------------------------------
export class Terrain {
  constructor(world, buf) {
    const n = world.n;
    this.n = n;
    this.size = world.size;
    this.half = world.size / 2;
    this.step = world.size / (n - 1);
    this.play = world.play;
    const q = new Uint16Array(buf, 0, n * n);
    this.h = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) this.h[i] = world.heightBase + q[i] * world.heightScale;
    let off = n * n * 2;
    this.dirt = new Uint8Array(buf, off, n * n); off += n * n;
    this.field = new Uint8Array(buf, off, n * n); off += n * n;
    this.forest = new Uint8Array(buf, off, n * n);
    this.river = world.river.points;      // [x, z, waterY] every 8 m in z
    this.riverHalf = world.river.halfWidth;
    this.riverZ0 = this.river[0][1];
    this.riverStep = this.river[1][1] - this.river[0][1];
  }

  heightAt(x, z) {
    const n = this.n;
    const fx = clamp((x + this.half) / this.step, 0, n - 1.001);
    const fz = clamp((z + this.half) / this.step, 0, n - 1.001);
    const j = fx | 0;
    const i = fz | 0;
    const tx = fx - j;
    const tz = fz - i;
    const h = this.h;
    const a = h[i * n + j];
    const b = h[i * n + j + 1];
    const c = h[(i + 1) * n + j];
    const d = h[(i + 1) * n + j + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e,
      this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  maskAt(arr, x, z) {
    const n = this.n;
    const j = clamp(Math.round((x + this.half) / this.step), 0, n - 1);
    const i = clamp(Math.round((z + this.half) / this.step), 0, n - 1);
    return arr[i * n + j] / 255;
  }

  riverAt(z) {
    const f = clamp((z - this.riverZ0) / this.riverStep, 0, this.river.length - 1.001);
    const i = f | 0;
    const t = f - i;
    const a = this.river[i];
    const b = this.river[i + 1];
    return { x: lerp(a[0], b[0], t), y: lerp(a[2], b[2], t) };
  }

  // Depth of river water at (x, z) above ground height y (0 when dry).
  waterDepth(x, z, y) {
    const r = this.riverAt(z);
    if (Math.abs(x - r.x) > this.riverHalf) return 0;
    return Math.max(0, r.y - y);
  }

  waterLevel(x, z) {
    const r = this.riverAt(z);
    return Math.abs(x - r.x) <= this.riverHalf ? r.y : -Infinity;
  }

  build(scene, tex) {
    const n = this.n;
    const C = 50;
    const verts = C + 1;
    const idx = [];
    for (let i = 0; i < C; i++) {
      for (let j = 0; j < C; j++) {
        const a = i * verts + j;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    this.material = terrainMaterial(tex);
    this.chunks = [];
    const nrm = new THREE.Vector3();
    for (let ci = 0; ci < (n - 1) / C; ci++) {
      for (let cj = 0; cj < (n - 1) / C; cj++) {
        const pos = new Float32Array(verts * verts * 3);
        const nor = new Float32Array(verts * verts * 3);
        const spl = new Float32Array(verts * verts * 3);
        let k = 0;
        for (let i = 0; i < verts; i++) {
          for (let j = 0; j < verts; j++) {
            const gi = ci * C + i;
            const gj = cj * C + j;
            const x = gj * this.step - this.half;
            const z = gi * this.step - this.half;
            const id = gi * n + gj;
            pos[k * 3] = x;
            pos[k * 3 + 1] = this.h[id];
            pos[k * 3 + 2] = z;
            const l = this.h[gi * n + Math.max(gj - 1, 0)];
            const r = this.h[gi * n + Math.min(gj + 1, n - 1)];
            const u = this.h[Math.max(gi - 1, 0) * n + gj];
            const dn = this.h[Math.min(gi + 1, n - 1) * n + gj];
            nrm.set(l - r, 2 * this.step, u - dn).normalize();
            nor[k * 3] = nrm.x;
            nor[k * 3 + 1] = nrm.y;
            nor[k * 3 + 2] = nrm.z;
            spl[k * 3] = this.dirt[id] / 255;
            spl[k * 3 + 1] = this.field[id] / 255;
            spl[k * 3 + 2] = this.forest[id] / 255;
            k++;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('splat', new THREE.BufferAttribute(spl, 3));
        g.setIndex(index);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const m = new THREE.Mesh(g, this.material);
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        scene.add(m);
        this.chunks.push(m);
      }
    }
  }

  // Ray march against the heightfield. Returns distance or -1.
  raycast(origin, dir, maxDist) {
    let t = 0;
    let prev = origin.y - this.heightAt(origin.x, origin.z);
    if (prev < 0) return 0;
    const step = 1.5;
    while (t < maxDist) {
      const nt = t + step;
      const x = origin.x + dir.x * nt;
      const y = origin.y + dir.y * nt;
      const z = origin.z + dir.z * nt;
      const d = y - this.heightAt(x, z);
      if (d < 0) {
        // Linear refine between t and nt
        return t + step * (prev / (prev - d));
      }
      prev = d;
      t = nt;
    }
    return -1;
  }
}

function terrainMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
  m.userData.uniforms = {
    tGrass: { value: tex.grass }, tDirt: { value: tex.dirt }, tRock: { value: tex.rock }, tSnow: { value: tex.snow },
    uSnowLine: { value: 560 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNorm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock; uniform sampler2D tSnow;
        uniform float uSnowLine;
        varying vec3 vSplat; varying vec3 vWPos; varying vec3 vWNorm;`)
      .replace('#include <map_fragment>', `
        vec2 uvA = vWPos.xz * 0.15;
        vec2 uvB = vWPos.xz * 0.031 + 0.37;
        float macro = texture2D(tGrass, vWPos.xz * 0.0019).g * 5.5;
        float macro2 = texture2D(tDirt, vWPos.xz * 0.0041 + 0.5).r * 2.2;
        vec3 grass = texture2D(tGrass, uvA).rgb * (0.7 + 2.2 * texture2D(tGrass, uvB).g);
        grass *= mix(vec3(1.32, 1.12, 0.66), vec3(0.86, 1.0, 0.86), smoothstep(0.75, 1.15, macro));
        vec3 dirt = texture2D(tDirt, uvA).rgb * (0.65 + 1.6 * texture2D(tDirt, uvB).r);
        vec3 nw = normalize(vWNorm);
        vec3 rockA = texture2D(tRock, vWPos.xz * 0.06).rgb;
        vec3 rockB = texture2D(tRock, vec2(vWPos.x + vWPos.z, vWPos.y) * 0.06).rgb;
        vec3 rock = mix(rockB, rockA, smoothstep(0.5, 0.85, nw.y)) * vec3(1.05, 1.0, 0.95);
        vec3 snow = texture2D(tSnow, uvA).rgb;
        float slope = 1.0 - nw.y;
        vec3 col = grass;
        col = mix(col, grass * vec3(0.5, 0.6, 0.5) + dirt * 0.15, vSplat.z * 0.75);
        col = mix(col, dirt, smoothstep(0.08, 0.55, vSplat.x));
        float furrow = smoothstep(0.18, 0.42, abs(fract(vWPos.z / 1.6) - 0.5));
        col = mix(col, mix(dirt * vec3(0.62, 0.55, 0.5), dirt * 0.9, furrow), vSplat.y);
        col = mix(col, rock, smoothstep(0.24, 0.42, slope + (macro2 - 1.1) * 0.12));
        float sl = uSnowLine + (macro - 1.0) * 60.0;
        col = mix(col, snow, smoothstep(sl - 25.0, sl + 35.0, vWPos.y) * (1.0 - smoothstep(0.5, 0.72, slope)));
        diffuseColor.rgb *= col;
      `);
  };
  return m;
}

// ---------------------------------------------------------------------------
// River surface: a strip along the centreline at water level.
// ---------------------------------------------------------------------------
export function buildRiver(scene, terrain) {
  const pts = terrain.river;
  const hw = terrain.riverHalf;
  const across = 6;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const o = pts[Math.max(i - 1, 0)];
    let dx = q[0] - o[0];
    let dz = q[1] - o[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    for (let k = 0; k <= across; k++) {
      const s = (k / across) * 2 - 1;
      pos.push(p[0] + dz * hw * s, p[2], p[1] - dx * hw * s);
      uv.push(s, i * 8);
    }
  }
  const row = across + 1;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uniforms = { uTime: { value: 0 }, uSky: { value: new THREE.Color('#9fb6c8') } };
  const m = new THREE.MeshStandardMaterial({ color: '#2b4249', roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.86 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRUv;\nvarying vec3 vRW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRUv = uv; vRW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uSky; varying vec2 vRUv; varying vec3 vRW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float fl = vRUv.y * 0.6 - uTime * 1.2;
        vec2 rp = vec2(vRUv.x * 6.0, fl);
        vec3 pert = vec3(sin(rp.y * 2.1 + sin(rp.x * 1.3) * 1.5) * 0.12 + sin(rp.y * 5.3 + rp.x * 2.0) * 0.05,
                         0.0, cos(rp.x * 3.1 + rp.y * 1.7) * 0.06);
        normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), -normal), 0.0, 1.0), 3.0);
        outgoingLight = mix(outgoingLight, uSky * 0.9, fres * 0.75);
        float edge = smoothstep(1.0, 0.75, abs(vRUv.x));
        diffuseColor.a *= edge;
        #include <opaque_fragment>`);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  scene.add(mesh);
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Sky dome with sun and drifting clouds
// ---------------------------------------------------------------------------
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
      uTime: { value: 0 }, cover: { value: 0.5 }, night: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float uTime; uniform float cover; uniform float night;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.9, h), 0.55));
        col = mix(col, ground, smoothstep(0.0, -0.2, h));
        float sd = max(dot(d, sunDir), 0.0);
        float sunUp = smoothstep(-0.12, 0.05, sunDir.y);
        col += sunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.5) * sunUp;
        col += sunColor * smoothstep(0.9993, 0.99965, sd) * 22.0 * sunUp;
        if (h > 0.0) {
          vec2 p = d.xz / (h + 0.18) * 1.4 + vec2(uTime * 0.006, uTime * 0.0025);
          float c = fbm(p * 1.3);
          float m = smoothstep(0.62 - cover * 0.3, 0.92 - cover * 0.2, c) * smoothstep(0.0, 0.18, h);
          float shade = fbm(p * 1.3 + sunDir.xz * 0.08);
          vec3 lit = mix(vec3(1.0), sunColor * 1.1 + 0.2, 0.25) * (0.75 + 0.35 * sunUp);
          vec3 cc = mix(lit, horizon * 0.75 + zenith * 0.15, smoothstep(c, c + 0.25, shade) * 0.6);
          cc = mix(cc, vec3(0.08, 0.1, 0.16), night * 0.85);
          col = mix(col, cc, m * 0.92);
          float stars = step(0.9975, hash(floor(d.xz / (h + 0.3) * 260.0))) * night * smoothstep(0.1, 0.4, h) * (1.0 - m);
          col += vec3(stars);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------
// Time of day: keyframes blended by hour
// ---------------------------------------------------------------------------
const C = (s) => new THREE.Color(s);
const TOD = [
  { h: 0, sun: C('#6d7fb0'), sunI: 0.35, sky: C('#2a3a5c'), gnd: C('#121418'), hemiI: 0.55, zen: C('#060b18'), hor: C('#1b2640'), fog: C('#141c2c'), dens: 0.00055 },
  { h: 4.8, sun: C('#6d7fb0'), sunI: 0.35, sky: C('#2a3a5c'), gnd: C('#121418'), hemiI: 0.55, zen: C('#0a1224'), hor: C('#24304a'), fog: C('#1a2236'), dens: 0.00055 },
  { h: 6.0, sun: C('#ff9c64'), sunI: 1.3, sky: C('#7f8fb0'), gnd: C('#3a2e26'), hemiI: 0.7, zen: C('#3a5585'), hor: C('#efab7c'), fog: C('#c9a08a'), dens: 0.0004 },
  { h: 7.5, sun: C('#ffd9a8'), sunI: 2.6, sky: C('#a9c1dc'), gnd: C('#4b4030'), hemiI: 0.95, zen: C('#3d6cb0'), hor: C('#cfd8df'), fog: C('#bfcbd6'), dens: 0.00026 },
  { h: 12, sun: C('#fff3df'), sunI: 3.1, sky: C('#b6cde6'), gnd: C('#56492f'), hemiI: 1.0, zen: C('#2f63b4'), hor: C('#c3d6e8'), fog: C('#b9cbdc'), dens: 0.00023 },
  { h: 16.5, sun: C('#ffe4b8'), sunI: 2.9, sky: C('#b4c6db'), gnd: C('#58482e'), hemiI: 0.95, zen: C('#3b67ac'), hor: C('#d9dbd6'), fog: C('#c8cfd4'), dens: 0.00024 },
  { h: 18.4, sun: C('#ffb465'), sunI: 2.4, sky: C('#a9a8b8'), gnd: C('#5a4128'), hemiI: 0.85, zen: C('#4f6a9c'), hor: C('#f2bc7e'), fog: C('#ddb68a'), dens: 0.00027 },
  { h: 19.5, sun: C('#ff7a42'), sunI: 1.0, sky: C('#6c6a88'), gnd: C('#2e2219'), hemiI: 0.65, zen: C('#28385e'), hor: C('#cf7450'), fog: C('#7c5a4e'), dens: 0.00038 },
  { h: 20.6, sun: C('#6d7fb0'), sunI: 0.35, sky: C('#2a3a5c'), gnd: C('#121418'), hemiI: 0.55, zen: C('#0a1224'), hor: C('#24304a'), fog: C('#1a2236'), dens: 0.00055 },
  { h: 24, sun: C('#6d7fb0'), sunI: 0.35, sky: C('#2a3a5c'), gnd: C('#121418'), hemiI: 0.55, zen: C('#060b18'), hor: C('#1b2640'), fog: C('#141c2c'), dens: 0.00055 },
];

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.hour = 8.0;
    this.daySpeed = 1 / 60;      // game hours per real second (1 day = 24 min)
    this.haze = 0;               // 0..1 mission override: thick golden haze
    this.hazeTarget = 0;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadow, quality.shadow);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#b6cde6', '#56492f', 1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2('#bfd0df', 0.0002);
    this.sunDir = new THREE.Vector3();
    this.k = { sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), zen: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color() };
    this.hazeColor = new THREE.Color('#d9a868');
    this.night = 0;
    this.update(0, new THREE.Vector3());
  }

  setQuality(q) {
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
  }

  sample(h) {
    let i = 0;
    while (i < TOD.length - 2 && TOD[i + 1].h <= h) i++;
    const a = TOD[i];
    const b = TOD[i + 1];
    const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
    const k = this.k;
    for (const key of ['sun', 'sky', 'gnd', 'zen', 'hor', 'fog']) k[key].copy(a[key]).lerp(b[key], t);
    k.sunI = lerp(a.sunI, b.sunI, t);
    k.hemiI = lerp(a.hemiI, b.hemiI, t);
    k.dens = lerp(a.dens, b.dens, t);
    return k;
  }

  update(dt, focus, camera) {
    this.hour = (this.hour + dt * this.daySpeed) % 24;
    this.haze += (this.hazeTarget - this.haze) * Math.min(1, dt * 0.5);
    const h = this.hour;
    const k = this.sample(h);
    // Sun path: rises in the east (+x), crosses the south (+z) at noon, sets in the west.
    const t = (h - 6) / 13.5;
    const up = Math.sin(Math.PI * clamp(t, -0.2, 1.2));
    const day = t > -0.05 && t < 1.05;
    if (day) {
      const a = Math.PI * t;
      this.sunDir.set(Math.cos(a), Math.sin(a) * 0.86, Math.sin(a) * 0.5).normalize();
    } else {
      // Moon: a fixed-ish high light from the south-west
      this.sunDir.set(-0.4, 0.75, 0.5).normalize();
    }
    this.night = day ? 0 : 1;
    if (!day && up > -0.05) this.night = 0;
    const haze = this.haze;
    const fog = k.fog.clone().lerp(this.hazeColor, haze * 0.85);
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = lerp(k.dens, 0.0032, haze);
    this.sun.color.copy(k.sun).lerp(this.hazeColor, haze * 0.4);
    this.sun.intensity = k.sunI * (1 - haze * 0.25);
    this.hemi.color.copy(k.sky).lerp(this.hazeColor, haze * 0.5);
    this.hemi.groundColor.copy(k.gnd);
    this.hemi.intensity = k.hemiI;
    const u = this.sky.material.uniforms;
    u.zenith.value.copy(k.zen).lerp(this.hazeColor, haze * 0.55);
    u.horizon.value.copy(k.hor).lerp(fog, 0.35 + haze * 0.6);
    u.ground.value.copy(fog).multiplyScalar(0.85);
    u.sunDir.value.copy(day ? this.sunDir : new THREE.Vector3(0, -1, 0));
    u.sunColor.value.copy(k.sun);
    u.uTime.value += dt;
    u.night.value = 1 - smoothstep(0.0, 0.25, k.sunI - 0.35) ;
    if (focus) {
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
    }
    if (camera) {
      this.sky.position.copy(camera.position);
      this.sky.scale.setScalar(camera.far * 0.9);
    }
  }

  get clock() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
}

// ---------------------------------------------------------------------------
// Grass: instanced clumps scattered around the player, rebuilt as they move.
// ---------------------------------------------------------------------------
export class Grass {
  constructor(scene, terrain, parts, density = 1) {
    this.terrain = terrain;
    // Merge each clump model into one vertex-coloured geometry
    const geos = parts.map((list) => {
      const pieces = list.map(({ geometry, material }) => {
        const g = geometry.clone();
        const c = material.color;
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
        return g;
      });
      const merged = mergeGeometries(pieces);
      // Point normals up so blades are lit like the ground beneath them
      const nr = merged.attributes.normal;
      for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
      return merged;
    });
    this.uniforms = { uTime: { value: 0 }, uFade: { value: 40 }, uCenter: { value: new THREE.Vector3() } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uFade; uniform vec3 uCenter;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.6 + wp0.x * 0.35 + wp0.z * 0.27) * 0.5 + sin(uTime * 3.1 + wp0.x * 0.9) * 0.2;
          transformed.x += sway * 0.12 * position.y * position.y;
          transformed.z += sway * 0.07 * position.y * position.y;
          float fd = distance(wp0.xz, uCenter.xz);
          transformed *= 1.0 - smoothstep(uFade * 0.75, uFade, fd);`);
      // Blades are double sided; light both faces like the ground beneath them
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    this.radius = 40;
    this.cell = 1.35;
    this.max = Math.floor(9000 * density);
    this.meshes = geos.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, this.max);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.density = density;
    this.last = new THREE.Vector3(1e9, 0, 1e9);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setDensity(d) {
    this.density = d;
    this.last.set(1e9, 0, 1e9);
  }

  update(dt, center) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value.copy(center);
    if (Math.hypot(center.x - this.last.x, center.z - this.last.z) < 5) return;
    this.last.copy(center);
    const t = this.terrain;
    const R = this.radius;
    this.uniforms.uFade.value = R;
    const cs = this.cell;
    const counts = this.meshes.map(() => 0);
    const i0 = Math.floor((center.x - R) / cs);
    const i1 = Math.floor((center.x + R) / cs);
    const j0 = Math.floor((center.z - R) / cs);
    const j1 = Math.floor((center.z + R) / cs);
    const dens = this.density;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const r1 = hash2(i, j);
        const x = (i + hash2(i * 7 + 3, j)) * cs;
        const z = (j + hash2(i, j * 5 + 11)) * cs;
        const d = Math.hypot(x - center.x, z - center.z);
        if (d > R) continue;
        if (r1 > dens) continue;
        const dirt = t.maskAt(t.dirt, x, z);
        const field = t.maskAt(t.field, x, z);
        if (dirt > 0.25 || field > 0.5) continue;
        const forest = t.maskAt(t.forest, x, z);
        if (forest > 0.5 && r1 > 0.35 * dens) continue;
        const y = t.heightAt(x, z);
        if (y > 520) continue;
        if (t.waterLevel(x, z) > y - 0.2) continue;
        const nrm = t.normalAt(x, z, this._p);
        if (nrm.y < 0.8) continue;
        const k = r1 < 0.25 * dens ? 2 : r1 < 0.6 * dens ? 0 : 1;
        const mesh = this.meshes[k];
        if (counts[k] >= this.max) continue;
        const s = 0.9 + hash2(j, i) * 0.8;
        this._q.setFromAxisAngle(this._up, hash2(i + 9, j - 4) * 6.283);
        this._s.set(s, s * (0.8 + hash2(i - 2, j + 3) * 0.6), s);
        this._p.set(x, y - 0.05, z);
        this._m.compose(this._p, this._q, this._s);
        mesh.setMatrixAt(counts[k]++, this._m);
      }
    }
    this.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
