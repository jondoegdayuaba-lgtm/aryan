// The water itself: how light behaves underwater. Every lit material in the
// game is patched here so that
//  - sunlight reaching a surface loses red, then green, the deeper it is,
//  - light travelling to your eye is absorbed and scattered into a blue haze,
//  - animated caustics ripple over anything facing up,
//  - the dive lamp lights things with its own cone (and restores their colour).
// Also builds the surface (Snell's window from below), the background water
// volume, god rays, marine snow and the bubble system.
import * as THREE from 'three';
import { WATER } from './config.js';

const col = (hex) => new THREE.Color(hex);

export const U = {
  uTime: { value: 0 },
  uCamDepth: { value: 10 },
  uUnderwater: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0.28, 1, 0.18).normalize() },
  uWaterShallow: { value: col(WATER.shallow) },
  uWaterMid: { value: col(WATER.mid) },
  uWaterDeep: { value: col(WATER.deep) },
  uFogDensity: { value: WATER.fogDensity },
  uAbsorb: { value: new THREE.Vector3(...WATER.absorb) },
  uSunAbsorb: { value: new THREE.Vector3(...WATER.sunAbsorb) },
  uCaustics: { value: 1.0 },
  uLampOn: { value: 0 },
  uLampPos: { value: new THREE.Vector3() },
  uLampDir: { value: new THREE.Vector3(0, 0, -1) },
  uLampRange: { value: 16 },
  uLampColor: { value: col('#fff1d6').multiplyScalar(9) },
  uSkyTop: { value: col('#3b8fe0') },
  uSkyHorizon: { value: col('#cfe8f6') },
  uFlash: { value: 0 },
};

// GLSL shared by every patched material and the custom water shaders.
export const WATER_GLSL = /* glsl */`
uniform float uTime;
uniform float uCamDepth;
uniform float uUnderwater;
uniform vec3 uSunDir;
uniform vec3 uWaterShallow;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform float uFogDensity;
uniform vec3 uAbsorb;
uniform vec3 uSunAbsorb;
uniform float uCaustics;
uniform float uLampOn;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform float uLampRange;
uniform vec3 uLampColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform float uFlash;

// Colour of the water haze seen along direction dir from the camera.
vec3 sgWaterColor(vec3 dir, float camDepth) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uWaterDeep, uWaterMid, smoothstep(0.0, 0.62, up));
  c = mix(c, uWaterShallow, smoothstep(0.55, 1.0, up));
  // Brighter toward the sun's refracted glow.
  float sun = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  c += uWaterShallow * sun * 0.45;
  // Deeper water is darker and bluer.
  c *= exp(-vec3(0.05, 0.03, 0.022) * camDepth);
  return c;
}

vec3 sgSkyColor(vec3 dir) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));
  vec3 s = normalize(uSunDir * vec3(1.6, 1.0, 1.6));
  float d = max(dot(dir, s), 0.0);
  c += vec3(1.0, 0.92, 0.75) * (pow(d, 900.0) * 30.0 + pow(d, 24.0) * 0.35);
  return c;
}

// Tileable water caustics (after Dave Hoskins / joltz0r), 0..~1.5.
float sgCaustic(vec2 p, float t) {
  vec2 q = mod(p, 6.28318530718) - 250.0;
  vec2 i = q;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

float sgCaustics(vec3 wp) {
  // Project along the light so caustics slide across slopes believably.
  vec2 p = wp.xz - wp.y * uSunDir.xz / uSunDir.y;
  float a = sgCaustic(p * 1.05, uTime * 0.6);
  float b = sgCaustic(p * 1.05 * 1.37 + 3.1, uTime * 0.5 + 2.0);
  return min(a, b) * 2.2 + (a + b) * 0.25;
}

vec3 sgFog(vec3 color, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);
  if (uUnderwater > 0.5) {
    color *= exp(-uAbsorb * dist);
    float f = 1.0 - exp(-uFogDensity * dist);
    color = mix(color, sgWaterColor(dir, uCamDepth), f);
  } else {
    float f = 1.0 - exp(-0.0016 * dist);
    color = mix(color, sgSkyColor(normalize(vec3(dir.x, max(dir.y, 0.02), dir.z))), f);
  }
  return color + uFlash * vec3(0.9, 0.95, 1.0);
}
`;

// ------------------------------------------------------------------ patching

// opts.sway: { amp, freq, height } bends geometry with height (kelp, grass, fans)
// opts.swim: { amp, length, freq } side-to-side fish body wave (instanced or single)
// opts.flap: { amp, freq } eagle ray wing beat
// opts.pulse: jellyfish bell pulse
// opts.uniforms: extra uniforms object (e.g. per-shark phase)
export function patchMaterial(mat, opts = {}) {
  if (mat.userData.sgPatched) return mat;
  mat.userData.sgPatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, U, opts.uniforms || {});
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;

    const anim = animationGLSL(opts);
    vs = vs.replace('#include <common>', `#include <common>\n${WATER_GLSL}\nvarying vec3 vSgWorld;\n${anim.decl}`);
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${anim.body}`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 sgP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        sgP = instanceMatrix * sgP;
      #endif
      vSgWorld = (modelMatrix * sgP).xyz;`);

    fs = fs.replace('#include <common>', `#include <common>\n${WATER_GLSL}\nvarying vec3 vSgWorld;`);
    fs = fs.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      {
        float sgDepth = max(-vSgWorld.y, 0.0);
        // Sunlight fades with depth (red first), so the trench is a dark place without a lamp.
        vec3 sgAtt = uUnderwater > 0.5 ? exp(-(uSunAbsorb + 0.02) * sgDepth) : vec3(1.0);
        vec3 sgN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        float sgC = uUnderwater > 0.5 ? sgCaustics(vSgWorld) * uCaustics * smoothstep(-0.1, 0.8, sgN.y) * exp(-sgDepth * 0.035) : 0.0;
        reflectedLight.directDiffuse *= sgAtt * (0.75 + sgC * 2.4);
        reflectedLight.directSpecular *= sgAtt;
        reflectedLight.indirectDiffuse *= sgAtt;
        reflectedLight.indirectSpecular *= sgAtt;
        if (uLampOn > 0.5) {
          vec3 L = uLampPos - vSgWorld;
          float d = length(L);
          L /= max(d, 1e-4);
          float cone = smoothstep(0.82, 0.96, dot(-L, uLampDir));
          float fall = cone * smoothstep(uLampRange, uLampRange * 0.25, d) / (1.0 + d * d * 0.012);
          vec3 Lv = normalize((viewMatrix * vec4(L, 0.0)).xyz);
          float ndl = max(dot(normal, Lv), 0.0);
          vec3 lamp = uLampColor * fall * ndl * exp(-uAbsorb * d);
          reflectedLight.directDiffuse += lamp * BRDF_Lambert(material.diffuseColor);
          vec3 H = normalize(Lv + normalize(vViewPosition) * -1.0);
          float sp = pow(max(dot(normal, H), 0.0), mix(80.0, 4.0, material.roughness)) * (1.0 - material.roughness);
          reflectedLight.directSpecular += lamp * sp * mix(vec3(0.04), material.diffuseColor + 0.04, metalnessFactor);
        }
      }`);
    fs = fs.replace('#include <fog_fragment>', `gl_FragColor.rgb = sgFog(gl_FragColor.rgb, vSgWorld);`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    mat.userData.shader = shader;
  };
  // Materials compile to different code depending on their name (triplanar,
  // textures) and animation, so both go into the program cache key.
  const key = `${mat.name}|${opts.key || ''}|${JSON.stringify(opts.sway || opts.swim || opts.flap || opts.pulse || {})}|${opts.uniforms ? 'u' : ''}`;
  mat.customProgramCacheKey = () => 'sg' + key;
  return mat;
}

function animationGLSL(o) {
  if (o.sway) {
    const { amp, freq = 0.7, height = 1 } = o.sway;
    return {
      decl: '',
      body: `{
        vec3 org = vec3(0.0);
        #ifdef USE_INSTANCING
          org = instanceMatrix[3].xyz;
        #endif
        float h = clamp(position.y / ${height.toFixed(3)}, 0.0, 1.5);
        float ph = org.x * 0.21 + org.z * 0.17;
        float w = sin(uTime * ${freq.toFixed(3)} + ph + position.y * 0.35) + 0.4 * sin(uTime * ${(freq * 2.3).toFixed(3)} + ph * 1.7);
        float w2 = cos(uTime * ${(freq * 0.8).toFixed(3)} + ph * 1.3 + position.y * 0.27);
        transformed.x += w * h * h * ${amp.toFixed(3)};
        transformed.z += w2 * h * h * ${(amp * 0.6).toFixed(3)};
      }`,
    };
  }
  if (o.swim) {
    const { amp, length, freq = 9 } = o.swim;
    return {
      decl: o.uniforms?.uPhase ? 'uniform float uPhase; uniform float uRate;' : 'attribute vec2 aSwim;',
      body: `{
        ${o.uniforms?.uPhase ? 'vec2 sw = vec2(uPhase, uRate);' : 'vec2 sw = aSwim;'}
        float s = clamp(position.z / ${length.toFixed(4)} + 0.5, 0.0, 1.0);   // 0 snout .. 1 tail
        float wave = sin(position.z / ${length.toFixed(4)} * 6.0 - uTime * ${freq.toFixed(2)} * sw.y + sw.x);
        transformed.x += wave * (0.15 + s * s) * ${(amp * length).toFixed(4)};
      }`,
    };
  }
  if (o.flap) {
    const { amp, freq } = o.flap;
    return {
      decl: '',
      body: `{
        float ax = abs(position.x);
        transformed.y += sin(uTime * ${freq.toFixed(2)} - ax * 1.6) * pow(ax, 1.4) * ${amp.toFixed(3)};
        transformed.y += sin(uTime * 2.0 + position.z * 1.5) * 0.04 * smoothstep(0.4, 2.0, position.z);
      }`,
    };
  }
  if (o.pulse) {
    return {
      decl: '',
      body: `{
        vec3 org = vec3(0.0);
        #ifdef USE_INSTANCING
          org = instanceMatrix[3].xyz;
        #endif
        float ph = org.x * 0.37 + org.z * 0.11;
        float p = sin(uTime * 1.7 + ph);
        float bell = smoothstep(-0.05, 0.1, position.y);
        transformed.xz *= 1.0 + p * 0.12 * bell - p * 0.05 * (1.0 - bell);
        transformed.y += p * 0.03 * bell;
        float trail = clamp(-position.y, 0.0, 2.0);
        transformed.x += sin(uTime * 1.3 + ph + position.y * 3.0) * 0.07 * trail;
        transformed.z += cos(uTime * 1.1 + ph + position.y * 2.5) * 0.07 * trail;
      }`,
    };
  }
  return { decl: '', body: '' };
}

// ------------------------------------------------------------------ environment

// A small gradient scene turned into an environment map so metals (gold!) and
// wet surfaces have something underwater-ish to reflect.
export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: col('#e6fbff') }, mid: { value: col('#2c8fa8') }, bottom: { value: col('#06202c') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float y = normalize(vP).y;
        vec3 c = y > 0.0 ? mix(mid, top, pow(y, 1.6)) : mix(mid, bottom, pow(-y, 0.6));
        c += vec3(1.0,0.95,0.85) * pow(max(dot(normalize(vP), normalize(vec3(0.28,1.0,0.18))),0.0), 40.0) * 3.0;
        gl_FragColor = vec4(c * 1.4, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return env;
}

// Background: the open water in every direction (or the sky above the surface).
export function makeBackdrop() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: U,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `${WATER_GLSL}
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = uUnderwater > 0.5 ? sgWaterColor(d, uCamDepth) : sgSkyColor(d);
        if (uUnderwater < 0.5 && d.y < 0.0) c = mix(vec3(0.03, 0.22, 0.3), uSkyHorizon * 0.6, pow(1.0 + d.y, 6.0));
        gl_FragColor = vec4(c + uFlash, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.onBeforeRender = (r, s, cam) => mesh.position.set(0, 0, 0);
  return mesh;
}

// The sea surface. From below: Snell's window (the sky squeezed into a bright
// circle overhead) surrounded by mirror-like total internal reflection.
export function makeSurface(waterNormal) {
  waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: false, uniforms: { ...U, tNormal: { value: waterNormal } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${WATER_GLSL}
      uniform sampler2D tNormal;
      varying vec3 vW;
      vec3 waveNormal(vec2 p) {
        vec3 a = texture2D(tNormal, p * 0.045 + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
        vec3 b = texture2D(tNormal, p * 0.11 - vec2(uTime * 0.017, -uTime * 0.011)).xyz * 2.0 - 1.0;
        vec3 n = normalize(vec3(a.xy + b.xy * 0.7, 1.6));
        return normalize(vec3(n.x, n.z, n.y));     // tangent space -> world (y up)
      }
      void main(){
        vec3 v = vW - cameraPosition;
        float dist = length(v);
        vec3 V = v / dist;
        vec3 N = waveNormal(vW.xz);
        vec3 c;
        if (cameraPosition.y < 0.0) {
          vec3 Nd = -N;                                  // faces down toward the diver
          vec3 R = refract(V, Nd, 1.33);
          if (dot(R, R) < 1e-4) {
            vec3 rr = reflect(V, Nd);
            c = sgWaterColor(rr, uCamDepth + 4.0) * 0.9;
          } else {
            c = sgSkyColor(R) * 1.25;
            float edge = smoothstep(0.6, 0.78, V.y);
            c = mix(sgWaterColor(reflect(V, Nd), uCamDepth) * 1.4, c, edge);
          }
          c *= exp(-uAbsorb * dist * 0.6);
          float f = 1.0 - exp(-uFogDensity * dist * 1.1);
          c = mix(c, sgWaterColor(V, uCamDepth), f);
        } else {
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
          vec3 deep = vec3(0.02, 0.2, 0.26);
          vec3 refl = sgSkyColor(reflect(V, N));
          c = mix(deep, refl, fres);
          vec3 s = normalize(uSunDir * vec3(1.6, 1.0, 1.6));
          c += vec3(1.0, 0.9, 0.7) * pow(max(dot(reflect(V, N), s), 0.0), 400.0) * 6.0;
          float f = 1.0 - exp(-0.0016 * dist);
          c = mix(c, uSkyHorizon, f);
        }
        gl_FragColor = vec4(c + uFlash, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2), mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ god rays

export class GodRays {
  constructor(count = 22) {
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
    const geo = new THREE.InstancedBufferGeometry().copy(quad);
    geo.instanceCount = count;
    this.data = new Float32Array(count * 4);          // x, z, width, seed
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4);
    geo.setAttribute('aRay', this.attr);
    this.count = count;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U, uStrength: { value: 1 } },
      vertexShader: `${WATER_GLSL}
        attribute vec4 aRay;
        varying float vAlong; varying float vAcross; varying float vSeed; varying vec3 vW;
        void main(){
          vec3 axis = -normalize(uSunDir);              // light heads down along -sun
          vec3 top = vec3(aRay.x, 0.0, aRay.y);
          float len = 70.0;
          vec3 p = top + axis * (-position.y * len);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(axis, toCam));
          p += side * position.x * aRay.z * (1.0 + -position.y * 0.6);
          vAlong = -position.y; vAcross = position.x; vSeed = aRay.w; vW = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `${WATER_GLSL}
        uniform float uStrength;
        varying float vAlong; varying float vAcross; varying float vSeed; varying vec3 vW;
        void main(){
          float across = 1.0 - smoothstep(0.15, 0.5, abs(vAcross));
          float shimmer = 0.55 + 0.45 * sin(uTime * (0.6 + vSeed * 0.5) + vSeed * 20.0) * sin(uTime * 0.37 + vSeed * 7.0);
          float fadeDown = exp(-vAlong * 2.6) * smoothstep(0.0, 0.03, vAlong);
          float d = distance(vW, cameraPosition);
          float nearFade = smoothstep(1.5, 9.0, d) * (1.0 - smoothstep(45.0, 80.0, d));
          float a = across * shimmer * fadeDown * nearFade * uStrength * 0.085;
          gl_FragColor = vec4(mix(uWaterShallow, vec3(1.0, 0.97, 0.85), 0.6) * a, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.rng = Math.random;
    this.anchor = new THREE.Vector3(1e9, 0, 0);
  }

  update(cam, depth) {
    // Re-scatter the shafts around the diver whenever they move far.
    if (this.anchor.distanceToSquared(cam) > 30 * 30) {
      this.anchor.copy(cam);
      for (let i = 0; i < this.count; i++) {
        const a = this.rng() * Math.PI * 2, r = 4 + Math.sqrt(this.rng()) * 46;
        this.data.set([cam.x + Math.cos(a) * r, cam.z + Math.sin(a) * r, 1.5 + this.rng() * 5, this.rng()], i * 4);
      }
      this.attr.needsUpdate = true;
    }
    this.mat.uniforms.uStrength.value = Math.exp(-depth * 0.03) * (depth > 0 ? 1 : 0);
  }
}

// ------------------------------------------------------------------ marine snow

export function makeMarineSnow(count = 1800) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([Math.random() * 40, Math.random() * 40, Math.random() * 40], i * 3);
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U, uScale: { value: 600 } },
    vertexShader: `${WATER_GLSL}
      uniform float uScale;
      attribute float aSeed;
      varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.2 + aSeed * 30.0), -uTime * (0.05 + aSeed * 0.08), cos(uTime * 0.17 + aSeed * 20.0)) * 0.8;
        p = mod(p - cameraPosition + 20.0, 40.0) - 20.0 + cameraPosition;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        float lamp = 0.0;
        if (uLampOn > 0.5) {
          vec3 L = p - uLampPos; float ld = length(L);
          lamp = smoothstep(0.8, 0.97, dot(L / ld, uLampDir)) * smoothstep(uLampRange, 1.0, ld) * 4.0;
        }
        vA = (0.12 + lamp) * smoothstep(0.3, 2.0, d) * (1.0 - smoothstep(12.0, 20.0, d)) * (p.y < 0.0 ? 1.0 : 0.0);
        gl_PointSize = (0.02 + aSeed * 0.04) * uScale / max(d, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)) * vA;
        gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

// ------------------------------------------------------------------ bubbles

export class Bubbles {
  constructor(max = 900) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { ...U, uScale: { value: 600 } },
      vertexShader: `${WATER_GLSL}
        uniform float uScale; attribute float aSize; varying float vA;
        void main(){ vec4 mv = viewMatrix * vec4(position, 1.0); float d = -mv.z;
          vA = smoothstep(0.05, 0.4, d) * (1.0 - smoothstep(25.0, 45.0, d)) * (position.y < -0.05 ? 1.0 : 0.0);
          gl_PointSize = aSize * uScale / max(d, 0.05); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c);
          if (r > 0.5) discard;
          float rim = smoothstep(0.32, 0.48, r) * (1.0 - smoothstep(0.48, 0.5, r));
          float hl = smoothstep(0.14, 0.0, length(c - vec2(-0.15, -0.15)));
          float a = (rim * 0.75 + hl * 0.9 + 0.06) * vA;
          gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a * 1.4, a); }`,
    });
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  emit(p, count, spread = 0.05, size = [0.01, 0.05], up = 0.4) {
    for (let k = 0; k < count; k++) {
      let i = this.n;
      if (i >= this.max) {                        // recycle the oldest
        i = Math.floor(Math.random() * this.max);
      } else this.n++;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.3;
      this.vel[i * 3 + 1] = up + Math.random() * 0.4;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      this.size[i] = size[0] + Math.random() * (size[1] - size[0]);
      this.life[i] = 0;
    }
  }

  update(dt, t) {
    for (let i = 0; i < this.n; i++) {
      const s = this.size[i];
      const rise = 0.25 + s * 12;                 // bigger bubbles rise faster
      this.vel[i * 3 + 1] += (rise - this.vel[i * 3 + 1]) * Math.min(1, dt * 1.5);
      this.vel[i * 3] *= 1 - Math.min(1, dt * 1.2);
      this.vel[i * 3 + 2] *= 1 - Math.min(1, dt * 1.2);
      const wob = Math.sin(t * 9 + i) * 0.25 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt + wob;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt + Math.cos(t * 7 + i) * 0.25 * dt;
      this.life[i] += dt;
      // Bubbles expand as they rise and pop at the surface.
      if (this.pos[i * 3 + 1] > -0.05 || this.life[i] > 40) {
        const j = --this.n;
        this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
        this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
        this.size[i] = this.size[j];
        this.life[i] = this.life[j];
        i--;
      }
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

// A faint visible cone of light in front of the scooter when the lamp is on.
export function makeLampBeam() {
  const geo = new THREE.ConeGeometry(2.6, 14, 24, 1, true).translate(0, -7, 0).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uOn: { value: 0 } },
    vertexShader: `varying float vZ; varying vec3 vN; varying vec3 vV;
      void main(){ vZ = -position.z / 14.0; vec4 mv = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOn; varying float vZ; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.5);
        float a = uOn * edge * (1.0 - smoothstep(0.1, 1.0, vZ)) * smoothstep(0.0, 0.08, vZ) * 0.06;
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.85) * a, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 8;
  return m;
}
