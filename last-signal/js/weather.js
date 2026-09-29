// The night's weather: a clear golden afternoon that closes in through sunset, drizzle and a
// storm that peaks around 21:30, then clears toward morning. Also draws the rain and lightning.
import * as THREE from 'three';
import { ATMO, ATMO_GLSL } from './atmosphere.js';
import { clamp, damp, lerp, smoothstep } from './util.js';

// hour, cover, overcast, storm, rain, wind, fog
const KEYS = [
  [16.0, 0.30, 0.10, 0.00, 0.00, 0.25, 0.00],
  [17.6, 0.36, 0.16, 0.00, 0.00, 0.30, 0.00],
  [18.8, 0.62, 0.42, 0.00, 0.00, 0.40, 0.00],
  [19.8, 0.86, 0.78, 0.10, 0.10, 0.50, 0.00],
  [20.8, 1.00, 0.95, 0.50, 0.50, 0.65, 0.00],
  [21.8, 1.00, 1.00, 0.95, 0.95, 0.85, 0.05],
  [23.2, 1.00, 1.00, 0.85, 0.80, 0.78, 0.05],
  [25.0, 0.92, 0.90, 0.50, 0.40, 0.55, 0.10],
  [28.0, 0.62, 0.50, 0.00, 0.00, 0.30, 0.45],
  [31.0, 0.30, 0.15, 0.00, 0.00, 0.20, 0.25],
  [40.0, 0.28, 0.10, 0.00, 0.00, 0.20, 0.00],
];

const RAIN_VERT = /* glsl */`
attribute vec3 aSeed;
attribute float aEnd;
uniform vec3 uCam;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uWind;
varying float vAlpha;
void main() {
  vec3 box = vec3( 34.0, 26.0, 34.0 );
  float speed = 13.0 + aSeed.y * 5.0;
  vec3 vel = vec3( uWind.x * 2.5, -speed, uWind.y * 2.5 );
  vec3 p = aSeed * box - box * 0.5;
  p += vel * uTime;
  vec3 rel = mod( p - uCam + box * 0.5, box ) - box * 0.5;
  vec3 world = uCam + rel;
  float len = 0.45 + aSeed.z * 0.25;
  world -= normalize( vel ) * len * aEnd;
  float keep = step( fract( aSeed.x * 91.7 + aSeed.z * 13.1 ), uIntensity );
  float d = length( rel );
  vAlpha = keep * ( 1.0 - smoothstep( 14.0, 17.0, d ) ) * smoothstep( 0.5, 2.0, d ) * ( aEnd < 0.5 ? 0.15 : 0.9 );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;

const RAIN_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if ( vAlpha < 0.01 ) discard;
  gl_FragColor = vec4( uColor, vAlpha * 0.28 );
}`;

export class Weather {
  constructor(scene, atmo) {
    this.atmo = atmo;
    this.scene = scene;
    this.state = { cover: 0.3, overcast: 0.1, storm: 0, rain: 0, wind: 0.25, fog: 0 };
    this.ground = 0;                   // how soaked the ground is, 0..1
    this.indoor = 0;                   // set by the game when the player is under a roof
    this.nextStrike = 12;
    this.bolt = null;
    this.onThunder = null;             // (delaySeconds, distance) => void
    this.flash = 0;
    this.strikeQueue = [];
    this.time = 0;
    this.manual = false;

    // Rain: thousands of short streaks that wrap around the camera.
    const N = 6500;
    const seeds = new Float32Array(N * 2 * 3), ends = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random();
      for (let k = 0; k < 2; k++) { seeds.set([a, b, c], (i * 2 + k) * 3); ends[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainUniforms = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uIntensity: { value: 0 }, uWind: ATMO.uWind, uColor: { value: new THREE.Color(0.55, 0.6, 0.66) } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: this.rainUniforms, transparent: true, depthWrite: false, fog: false,
    }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 25;
    scene.add(this.rain);
  }

  target(hour) {
    const h = hour < 16 ? hour + 24 : hour;
    let i = 0;
    while (i < KEYS.length - 2 && h > KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothstep(a[0], b[0], h);
    return { cover: lerp(a[1], b[1], t), overcast: lerp(a[2], b[2], t), storm: lerp(a[3], b[3], t), rain: lerp(a[4], b[4], t), wind: lerp(a[5], b[5], t), fog: lerp(a[6], b[6], t) };
  }

  update(dt, camera, hour, player) {
    this.time += dt;
    const s = this.state, w = this.atmo.weather;
    if (!this.manual) {
      const t = this.target(hour);
      const rate = 0.25;
      for (const k in t) s[k] = damp(s[k], t[k], rate * 0.1 + 0.02, dt);
    }
    const gust = 0.8 + 0.3 * Math.sin(this.time * 0.37) * Math.sin(this.time * 0.91 + 1) + 0.15 * Math.sin(this.time * 2.3);
    Object.assign(w, { cover: s.cover, overcast: s.overcast, storm: s.storm, rain: s.rain, fog: s.fog, wind: clamp(s.wind * gust, 0, 1.4) });
    this.ground = clamp(this.ground + (s.rain > 0.08 ? s.rain * 0.012 : -0.0025) * dt * 3, 0, 1);
    w.wet = this.ground;

    // rain streaks; none under a roof
    this.indoor = damp(this.indoor, player?.sheltered ? 1 : 0, 4, dt);
    this.rainUniforms.uCam.value.copy(camera.position);
    this.rainUniforms.uTime.value = this.time;
    this.rainUniforms.uIntensity.value = clamp(s.rain, 0, 1) * (1 - this.indoor);
    this.rain.visible = this.rainUniforms.uIntensity.value > 0.01;
    this.rainUniforms.uColor.value.setRGB(0.5, 0.55, 0.62).multiplyScalar(0.4 + 0.6 * this.atmo.day + 0.8 * this.flash);

    this._lightning(dt, camera);
  }

  _lightning(dt, camera) {
    const s = this.state, w = this.atmo.weather;
    if (s.storm > 0.35 && (this.nextStrike -= dt) <= 0) {
      this.nextStrike = lerp(28, 6, clamp(s.storm, 0, 1)) * (0.5 + Math.random());
      this.strike(camera);
    }
    // flash envelope: sharp pulses that fade
    let f = 0;
    for (let i = this.strikeQueue.length - 1; i >= 0; i--) {
      const q = this.strikeQueue[i];
      q.t += dt;
      const e = q.t - q.delay;
      if (e < 0) continue;
      f = Math.max(f, q.power * Math.exp(-e * 9) * (e < q.len ? 1 : 0));
      if (e > q.len + 0.3) this.strikeQueue.splice(i, 1);
    }
    this.flash = f;
    w.flash = f * 0.55;
    if (this.bolt) {
      this.bolt.life -= dt;
      this.bolt.mesh.material.opacity = clamp(this.bolt.life * 6, 0, 1) * (0.6 + 0.4 * Math.random());
      if (this.bolt.life <= 0) { this.scene.remove(this.bolt.mesh); this.bolt.mesh.geometry.dispose(); this.bolt = null; }
    }
  }

  strike(camera, distance = null, bearing = null) {
    const dist = distance ?? lerp(350, 2600, Math.random() ** 1.5);
    const az = bearing ?? Math.random() * Math.PI * 2;
    const x = camera.position.x + Math.sin(az) * dist, z = camera.position.z - Math.cos(az) * dist;
    // a jagged bolt from the cloud base to the ground with a couple of forks
    const pts = [];
    const top = 1300, ground = camera.position.y - 60;
    let px = x, pz = z;
    const seg = 22;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const y = lerp(top, ground, t);
      px += (Math.random() - 0.5) * 70; pz += (Math.random() - 0.5) * 70;
      pts.push(new THREE.Vector3(px, y, pz));
      if (i > 4 && i < seg - 2 && Math.random() < 0.22) {
        let fx = px, fz = pz, fy = y;
        pts.push(null);
        for (let k = 0; k < 5; k++) { fx += (Math.random() - 0.3) * 90; fz += (Math.random() - 0.5) * 90; fy -= 55; pts.push(new THREE.Vector3(fx, fy, fz)); }
        pts.push(null);
        pts.push(new THREE.Vector3(px, y, pz));
      }
    }
    const verts = [];
    let prev = null;
    for (const p of pts) { if (!p) { prev = null; continue; } if (prev) verts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 1, depthWrite: false, fog: false });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.frustumCulled = false;
    if (this.bolt) { this.scene.remove(this.bolt.mesh); this.bolt.mesh.geometry.dispose(); }
    this.scene.add(mesh);
    this.bolt = { mesh, life: 0.35 };
    const power = clamp(1.4 - dist / 3000, 0.35, 1.3);
    this.strikeQueue.push({ t: 0, delay: 0, len: 0.09, power }, { t: 0, delay: 0.14, len: 0.06, power: power * 0.7 }, { t: 0, delay: 0.3, len: 0.05, power: power * 0.5 });
    this.onThunder?.(dist / 343 * 0.6, dist);
  }

  // Jump straight to a weather for testing or scripted moments.
  set(state) { this.manual = true; Object.assign(this.state, state); }
  auto() { this.manual = false; }
}
