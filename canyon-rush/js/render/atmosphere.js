// Physically based sky: single-scattering Rayleigh + Mie atmosphere rendered once
// into a cube map. The cube lights the scene (image-based lighting), draws the
// background, and its horizon colours feed the aerial-perspective haze.
import * as THREE from 'three';

// Atmosphere constants shared by the GLSL and the JS versions.
const R_E = 6371e3;
const R_A = 6471e3;
const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6];
const H_R = 8000;
const H_M = 1200;
const G = 0.78;
export const SUN_E = 22;          // solar irradiance scale (matches the directional light)

// Time-of-day presets: sun elevation / azimuth in degrees (azimuth 0 = north, 90 = east),
// plus how dusty the air is (scales Mie scattering) and exposure.
export const TIMES = {
  morning: { label: 'Morning', elevation: 16, azimuth: 105, dust: 1.2, exposure: 0.42, clouds: 0.35 },
  midday: { label: 'Midday', elevation: 58, azimuth: 200, dust: 1.0, exposure: 0.34, clouds: 0.25 },
  golden: { label: 'Golden hour', elevation: 12, azimuth: 235, dust: 1.5, exposure: 0.5, clouds: 0.45 },
  sunset: { label: 'Sunset', elevation: 3.2, azimuth: 262, dust: 1.8, exposure: 0.85, clouds: 0.55 },
};

export function sunDirection(elevationDeg, azimuthDeg) {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  // azimuth 0 = north (-z), 90 = east (+x)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

// ---------- JS version (used for sun colour and haze colours) ----------

function raySphere(ro, rd, r) {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

function opticalDepth(pos, dir, steps = 32) {
  const hit = raySphere(pos, dir, R_A);
  if (!hit) return [0, 0];
  const len = hit[1];
  const ds = len / steps;
  let odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) {
    const t = ds * (i + 0.5);
    const x = pos[0] + dir[0] * t, y = pos[1] + dir[1] * t, z = pos[2] + dir[2] * t;
    const h = Math.hypot(x, y, z) - R_E;
    if (h < 0) return [Infinity, Infinity];
    odR += Math.exp(-h / H_R) * ds;
    odM += Math.exp(-h / H_M) * ds;
  }
  return [odR, odM];
}

// Colour of direct sunlight at ground level (transmittance), linear RGB.
export function sunTransmittance(sunDir, dust) {
  const [odR, odM] = opticalDepth([0, R_E + 20, 0], [sunDir.x, sunDir.y, sunDir.z], 64);
  const bM = 21e-6 * dust;
  return BETA_R.map((b) => Math.exp(-(b * odR + bM * 1.1 * odM)));
}

// Sky radiance in direction rd (no sun disk). Mirrors the GLSL below.
export function skyRadiance(rd, sunDir, dust, steps = 16, lsteps = 8) {
  const ro = [0, R_E + 20, 0];
  const hitA = raySphere(ro, rd, R_A);
  if (!hitA) return [0, 0, 0];
  let tMax = hitA[1];
  const hitG = raySphere(ro, rd, R_E);
  if (hitG && hitG[0] > 0) tMax = Math.min(tMax, hitG[0]);
  const ds = tMax / steps;
  const bM = 21e-6 * dust;
  const mu = rd[0] * sunDir.x + rd[1] * sunDir.y + rd[2] * sunDir.z;
  const pR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const gg = G * G;
  const pM = ((3 / (8 * Math.PI)) * ((1 - gg) * (1 + mu * mu))) / ((2 + gg) * Math.pow(1 + gg - 2 * G * mu, 1.5));
  let odR = 0, odM = 0;
  const sumR = [0, 0, 0], sumM = [0, 0, 0];
  const sd = [sunDir.x, sunDir.y, sunDir.z];
  for (let i = 0; i < steps; i++) {
    const t = ds * (i + 0.5);
    const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const h = Math.hypot(p[0], p[1], p[2]) - R_E;
    const hr = Math.exp(-h / H_R) * ds, hm = Math.exp(-h / H_M) * ds;
    odR += hr; odM += hm;
    const [lR, lM] = opticalDepth(p, sd, lsteps);
    if (!isFinite(lR)) continue;
    for (let c = 0; c < 3; c++) {
      const att = Math.exp(-(BETA_R[c] * (odR + lR) + bM * 1.1 * (odM + lM)));
      sumR[c] += hr * att;
      sumM[c] += hm * att;
    }
  }
  return [0, 1, 2].map((c) => SUN_E * (sumR[c] * BETA_R[c] * pR + sumM[c] * bM * pM));
}

// ---------- GLSL ----------

export const ATMOSPHERE_GLSL = /* glsl */ `
#define PI_A 3.14159265
const float R_E = ${R_E.toFixed(1)};
const float R_A = ${R_A.toFixed(1)};
const vec3 BETA_R = vec3(${BETA_R.map((b) => b.toExponential(3)).join(', ')});
const float H_R = ${H_R.toFixed(1)};
const float H_M = ${H_M.toFixed(1)};
const float G_M = ${G.toFixed(3)};

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

// Returns inscattered radiance; transmittance along the view ray goes to 'trans'.
vec3 atmosphere(vec3 rd, vec3 sunDir, float betaM, out vec3 trans, out float tHit) {
  vec3 ro = vec3(0.0, R_E + 20.0, 0.0);
  vec2 pa = raySphere(ro, rd, R_A);
  trans = vec3(1.0);
  tHit = -1.0;
  if (pa.x > pa.y) return vec3(0.0);
  float tMax = pa.y;
  vec2 pg = raySphere(ro, rd, R_E);
  if (pg.x > 0.0 && pg.x < pg.y) { tMax = min(tMax, pg.x); tHit = pg.x; }
  const int STEPS = 32;
  const int LSTEPS = 12;
  float ds = tMax / float(STEPS);
  float mu = dot(rd, sunDir);
  float pR = 3.0 / (16.0 * PI_A) * (1.0 + mu * mu);
  float gg = G_M * G_M;
  float pM = 3.0 / (8.0 * PI_A) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * G_M * mu, 1.5));
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (ds * (float(i) + 0.5));
    float h = length(p) - R_E;
    float hr = exp(-h / H_R) * ds;
    float hm = exp(-h / H_M) * ds;
    odR += hr; odM += hm;
    vec2 pl = raySphere(p, sunDir, R_A);
    float dsl = pl.y / float(LSTEPS);
    float lR = 0.0, lM = 0.0;
    bool blocked = false;
    for (int j = 0; j < LSTEPS; j++) {
      vec3 q = p + sunDir * (dsl * (float(j) + 0.5));
      float lh = length(q) - R_E;
      if (lh < 0.0) { blocked = true; break; }
      lR += exp(-lh / H_R) * dsl;
      lM += exp(-lh / H_M) * dsl;
    }
    if (!blocked) {
      vec3 att = exp(-(BETA_R * (odR + lR) + betaM * 1.1 * (odM + lM)));
      sumR += hr * att;
      sumM += hm * att;
    }
  }
  trans = exp(-(BETA_R * odR + betaM * 1.1 * odM));
  return ${SUN_E.toFixed(1)} * (sumR * BETA_R * pR + sumM * betaM * pM);
}
`;

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
`;

// Renders the sky (with a static cloud layer and a lit ground below the horizon)
// into a cube map.
function makeSkyCaptureMaterial(sunDir, dust, clouds, groundAlbedo, sunColor, skyAmbient) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uSun: { value: sunDir.clone() },
      uBetaM: { value: 21e-6 * dust },
      uClouds: { value: clouds },
      uGround: { value: groundAlbedo },
      uSunColor: { value: sunColor },
      uSkyAmbient: { value: skyAmbient },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uBetaM;
      uniform float uClouds;
      uniform vec3 uGround;
      uniform vec3 uSunColor;
      uniform vec3 uSkyAmbient;
      varying vec3 vDir;
      ${ATMOSPHERE_GLSL}
      ${NOISE_GLSL}
      void main() {
        vec3 rd = normalize(vDir);
        vec3 trans; float tHit;
        vec3 col = atmosphere(rd, uSun, uBetaM, trans, tHit);
        if (tHit > 0.0) {
          // Ground below the horizon: lit sand seen through the haze.
          vec3 groundRad = uGround / PI_A * (uSunColor * max(uSun.y, 0.0) * ${SUN_E.toFixed(1)} + uSkyAmbient);
          col += groundRad * trans;
        } else if (rd.y > 0.0) {
          // Clouds: a thin high cirrus deck and scattered mid-level puffs.
          float mu = dot(rd, uSun);
          vec2 pc = rd.xz / (rd.y + 0.06);
          float ci = fbm5(pc * vec2(0.9, 3.2) + vec2(3.0, 1.0));
          float cirrus = smoothstep(0.52, 0.85, ci) * uClouds;
          float cu = fbm5(pc * 2.2 + 7.3);
          float cum = smoothstep(0.62 - uClouds * 0.12, 0.78, cu) * uClouds;
          float fade = smoothstep(0.0, 0.18, rd.y);
          vec3 sunLit = uSunColor * ${SUN_E.toFixed(1)};
          float silver = 0.6 + 2.4 * pow(max(mu, 0.0), 12.0);
          vec3 cirrusCol = sunLit * 0.05 * silver + uSkyAmbient * 0.12;
          vec3 cumCol = sunLit * 0.07 * (0.55 + 0.45 * silver) + uSkyAmbient * 0.2;
          col = mix(col, cirrusCol, cirrus * 0.55 * fade);
          col = mix(col, cumCol * (0.75 + 0.25 * cu), cum * 0.85 * fade);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export class Atmosphere {
  constructor(renderer, timeKey = 'golden') {
    this.renderer = renderer;
    this.sunDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.skyAmbient = new THREE.Color();
    this.haze = [];
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCamera = new THREE.CubeCamera(1, 10, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = null;
    this.set(timeKey);
  }

  set(timeKey) {
    const T = TIMES[timeKey] ?? TIMES.golden;
    this.timeKey = timeKey;
    this.time = T;
    this.sunDir.copy(sunDirection(T.elevation, T.azimuth));
    const tr = sunTransmittance(this.sunDir, T.dust);
    this.sunColor.setRGB(tr[0], tr[1], tr[2]);

    // Average sky radiance over the upper hemisphere (for the ground bounce estimate).
    const acc = [0, 0, 0];
    let cnt = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = 1; j <= 3; j++) {
        const el = (j / 4) * (Math.PI / 2);
        const az = (i / 6) * Math.PI * 2;
        const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
        const L = skyRadiance(d, this.sunDir, T.dust, 10, 6);
        const w = Math.sin(el);
        for (let c = 0; c < 3; c++) acc[c] += L[c] * w;
        cnt += w;
      }
    }
    this.skyAmbient.setRGB((acc[0] / cnt) * Math.PI, (acc[1] / cnt) * Math.PI, (acc[2] / cnt) * Math.PI);

    // Horizon haze colours at 8 azimuths relative to the sun (index 0 = toward the sun).
    const sunAz = Math.atan2(this.sunDir.x, this.sunDir.z);
    this.haze = [];
    for (let i = 0; i < 8; i++) {
      const az = sunAz + (i / 8) * Math.PI * 2;
      const el = THREE.MathUtils.degToRad(1.5);
      const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      const L = skyRadiance(d, this.sunDir, T.dust, 16, 8);
      this.haze.push(new THREE.Color(L[0], L[1], L[2]));
    }
    this.renderCube();
  }

  renderCube() {
    const T = this.time;
    const scene = new THREE.Scene();
    const mat = makeSkyCaptureMaterial(this.sunDir, T.dust, T.clouds, new THREE.Color(0.42, 0.3, 0.2), this.sunColor, this.skyAmbient);
    const box = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), mat);
    scene.add(box);
    this.cubeCamera.update(this.renderer, scene);
    box.geometry.dispose();
    mat.dispose();
    if (this.envMap) this.envMap.dispose();
    this.envMap = this.pmrem.fromCubemap(this.cubeRT.texture).texture;
  }

  // Light intensity for the sun's DirectionalLight.
  get sunIntensity() {
    return SUN_E;
  }
}

// Sky dome drawn behind everything: samples the cube and adds a crisp sun disk.
export function makeSkyDome(atmo) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uCube: { value: atmo.cubeRT.texture },
      uSun: { value: atmo.sunDir },
      uSunColor: { value: atmo.sunColor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */ `
      uniform samplerCube uCube;
      uniform vec3 uSun;
      uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 rd = normalize(vDir);
        vec3 col = textureLod(uCube, rd, 0.0).rgb;
        float mu = dot(rd, uSun);
        float sunR = 0.00467;                      // angular radius, radians
        float d = acos(clamp(mu, -1.0, 1.0)) / sunR;
        if (d < 1.0) {
          float limb = 0.4 + 0.6 * sqrt(1.0 - d * d);
          col += uSunColor * 40000.0 * limb * smoothstep(1.0, 0.9, d) * step(0.0, rd.y + 0.02);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mesh.position.copy(camera.position);
    mesh.scale.setScalar(camera.far * 0.5);
    mesh.updateMatrixWorld();
  };
  return mesh;
}
