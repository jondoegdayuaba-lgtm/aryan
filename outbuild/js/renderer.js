// Renderer, sky, sun, fog and post-processing, with quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { QUALITY } from './config.js';

export const TIMES = {
  day: {
    elevation: 52, azimuth: 135, sun: '#fff1dc', sunI: 3.4, zenith: '#2f7fd8', horizon: '#b6d9f2', ground: '#8aa27a',
    fog: '#bcd7ec', fogD: 0.0017, hemiSky: '#cfe4ff', hemiGround: '#6f7b52', hemiI: 0.55, envI: 0.75, cloud: 0.5,
    exposure: 1.0,
  },
  golden: {
    elevation: 20, azimuth: 250, sun: '#ffcf8f', sunI: 3.2, zenith: '#3e72bf', horizon: '#f2cf9e', ground: '#9a8a6a',
    fog: '#e6cfae', fogD: 0.0018, hemiSky: '#d9d7ff', hemiGround: '#7a6848', hemiI: 0.5, envI: 0.7, cloud: 0.55,
    exposure: 1.05,
  },
  sunset: {
    elevation: 6.5, azimuth: 262, sun: '#ff9c5c', sunI: 2.8, zenith: '#34458a', horizon: '#ff9b6b', ground: '#7a5a5a',
    fog: '#e3a489', fogD: 0.0021, hemiSky: '#a9a6e8', hemiGround: '#5a4640', hemiI: 0.55, envI: 0.65, cloud: 0.6,
    exposure: 1.1,
  },
};

const lin = (hex) => new THREE.Color(hex);

// ----------------------------------------------------------------------------- sky dome
const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uTime, uCloud;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  // warm glow toward the sun near the horizon
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 6.0) * 0.18 * (1.0 - clamp(h * 2.0, 0.0, 1.0));
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));

  // clouds on a virtual plane
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(p);
    float cover = smoothstep(1.0 - uCloud * 0.9, 1.25 - uCloud * 0.6, n + 0.15);
    float n2 = fbm(p * 2.0 + 3.1 + uSunDir.xz * 0.2);
    float lit = clamp(0.55 + (n - n2) * 1.6, 0.0, 1.0);
    vec3 cLit = mix(uHorizon * 0.9 + vec3(0.08), vec3(1.0), 0.55) * (0.75 + 0.5 * pow(sd, 3.0));
    vec3 cDark = mix(uZenith, uHorizon, 0.55) * 0.75;
    vec3 cloud = mix(cDark, cLit, lit) + uSunColor * pow(sd, 10.0) * 0.4 * (1.0 - cover * 0.5);
    float fade = smoothstep(0.0, 0.18, h);
    col = mix(col, cloud, cover * fade * 0.92);
  }
  // sun disc + halo (goes above 1.0 so bloom catches it)
  col += uSunColor * (smoothstep(0.9993, 0.99965, sd) * 22.0 + pow(sd, 350.0) * 2.5 + pow(sd, 40.0) * 0.25);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uCloud: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  apply(t) {
    const u = this.uniforms;
    u.uZenith.value.set(t.zenith);
    u.uHorizon.value.set(t.horizon);
    u.uGround.value.set(t.ground);
    u.uSunColor.value.set(t.sun);
    u.uCloud.value = t.cloud;
    const el = THREE.MathUtils.degToRad(t.elevation);
    const az = THREE.MathUtils.degToRad(t.azimuth);
    u.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  }
}

// ----------------------------------------------------------------------------- grading pass
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uStorm: { value: 0 },
    uDamage: { value: 0 },
    uHeal: { value: 0 },
    uSaturation: { value: 1.2 },
    uContrast: { value: 1.04 },
    uTime: { value: 0 },
    uScope: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette, uStorm, uDamage, uHeal, uSaturation, uContrast, uTime, uScope, uAspect;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      // storm: gentle wobble of the image
      if (uStorm > 0.0) {
        uv += vec2(sin(uv.y * 30.0 + uTime * 3.0), cos(uv.x * 26.0 + uTime * 2.4)) * 0.0022 * uStorm;
      }
      vec4 c = texture2D(tDiffuse, uv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      float r = length(q * vec2(uAspect, 1.0));
      float vig = smoothstep(0.35, 1.05, r);
      c.rgb *= 1.0 - vig * uVignette;
      // storm tint
      c.rgb = mix(c.rgb, c.rgb * vec3(0.72, 0.5, 1.05) + vec3(0.07, 0.0, 0.12), uStorm * 0.75);
      c.rgb += vec3(0.25, 0.05, 0.4) * vig * uStorm * 0.6;
      // damage flash on the edges
      c.rgb = mix(c.rgb, vec3(0.75, 0.05, 0.05), clamp(vig * 1.6, 0.0, 1.0) * uDamage);
      c.rgb = mix(c.rgb, vec3(0.2, 0.9, 0.5), clamp(vig * 1.2, 0.0, 1.0) * uHeal * 0.3);
      // sniper scope: black outside a circle with a thin reticle
      if (uScope > 0.0) {
        vec2 s = q * vec2(uAspect, 1.0);
        float rr = length(s);
        float ring = smoothstep(0.43, 0.425, rr);
        vec3 sc = c.rgb * ring;
        float cross = (step(abs(s.x), 0.0012) + step(abs(s.y), 0.0012)) * step(0.018, rr) * ring;
        sc = mix(sc, vec3(0.0), clamp(cross, 0.0, 1.0));
        float dotc = smoothstep(0.004, 0.002, rr);
        sc = mix(sc, vec3(1.0, 0.15, 0.1), dotc);
        c.rgb = mix(c.rgb, sc, uScope);
      }
      gl_FragColor = c;
    }`,
};

// ----------------------------------------------------------------------------- renderer
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2400);
    this.camera.position.set(0, 50, 100);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 0.5);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xbcd7ec, 0.0017);

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.time = TIMES.day;
    this.quality = null;
    this.composer = null;
    this._shadowSnap = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    window.addEventListener('resize', () => this.resize());
  }

  setTime(key) {
    const t = TIMES[key] || TIMES.day;
    this.timeKey = key;
    this.time = t;
    this.sky.apply(t);
    this.sunDir.copy(this.sky.uniforms.uSunDir.value);
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiI;
    this.scene.fog.color.set(t.fog);
    this.scene.fog.density = t.fogD;
    this.baseFog = this.scene.fog.color.clone();
    this.baseFogD = t.fogD;
    this.renderer.toneMappingExposure = t.exposure;
    this.buildEnvironment();
  }

  buildEnvironment() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.apply(this.time);
    sky.uniforms.uCloud.value = this.time.cloud * 0.6;
    sky.mesh.scale.setScalar(100);
    envScene.add(sky.mesh);
    if (this.envRT) this.envRT.dispose();
    this.envRT = pm.fromScene(envScene, 0.02, 0.1, 400);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.time.envI;
    pm.dispose();
    sky.mesh.geometry.dispose();
    sky.mesh.material.dispose();
  }

  setQuality(key) {
    const q = QUALITY[key] || QUALITY.high;
    this.qualityKey = key;
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio);
    r.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    this.camera.far = q.drawDist + 400;
    this.camera.updateProjectionMatrix();
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) { this.composer.dispose(); }
    const q = this.quality;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    const composer = new EffectComposer(r, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = null;
    if (q.ao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12,
        distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(ao);
      this.aoPass = ao;
    }
    this.bloomPass = null;
    if (q.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 0.92);
      composer.addPass(bloom);
      this.bloomPass = bloom;
    }
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    if (q.aa === 'smaa') composer.addPass(new SMAAPass());
    else composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    if (this.grade) this.grade.uniforms.uAspect.value = w / h;
  }

  // Keep the sun's shadow box centred on the action, snapped to shadow texels so edges don't crawl.
  updateShadow(focus) {
    const s = this.sun;
    const cam = s.shadow.camera;
    const texel = (cam.right - cam.left) / s.shadow.mapSize.x;
    // light-space basis
    const zAxis = this._tmp.copy(this.sunDir).negate();
    const up = Math.abs(zAxis.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    let lx = focus.dot(xAxis);
    let ly = focus.dot(yAxis);
    const lz = focus.dot(zAxis);
    lx = Math.round(lx / texel) * texel;
    ly = Math.round(ly / texel) * texel;
    const snapped = new THREE.Vector3().addScaledVector(xAxis, lx).addScaledVector(yAxis, ly).addScaledVector(zAxis, lz);
    s.target.position.copy(snapped);
    s.position.copy(snapped).addScaledVector(this.sunDir, 350);
    s.target.updateMatrixWorld();
  }

  render(dt, t) {
    this.renderer.info.reset();
    this.sky.uniforms.uTime.value = t;
    this.sky.mesh.position.copy(this.camera.position);
    if (this.grade) this.grade.uniforms.uTime.value = t;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
