// The sky's mood: sun and moon position, the colour palette for every hour and weather,
// and the haze shared by every material. The fog chunks below replace three.js's fog with a
// sun-aware exponential height fog, so far mountains fade into the same colour the sky
// has at the horizon in that direction.
import * as THREE from 'three';
import { WORLD, TIME } from './config.js';
import { clamp, lerp, saturate, smoothstep } from './util.js';

// ---------- Shared uniforms (every patched material points at these same objects) ----------
export const ATMO = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uHazeAway: { value: new THREE.Color('#a9c8e6') },
  uHazeSun: { value: new THREE.Color('#dbe8f2') },
  uSunGlow: { value: new THREE.Color(0, 0, 0) },
  uFog: { value: new THREE.Vector4(0.0004, 0.005, WORLD.lakeY, 0) },  // density, height falloff, base height, underwater
  uUnderColor: { value: new THREE.Color('#0d3a44') },
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.6, 0.2) },
  uWet: { value: 0 },
  uPlayer: { value: new THREE.Vector3() },
};

export const ATMO_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uHazeAway;
uniform vec3 uHazeSun;
uniform vec3 uSunGlow;
uniform vec4 uFog;
uniform vec3 uUnderColor;

vec3 hazeAt( vec3 rd ) {
  vec2 h = rd.xz, s = uSunDir.xz;
  float hl = length( h ), sl = length( s );
  float c = ( hl > 1e-4 && sl > 1e-4 ) ? max( dot( h, s ) / ( hl * sl ), 0.0 ) : 0.0;
  float k = c * c * ( 1.5 - 0.5 * c );
  return mix( uHazeAway, uHazeSun, k * sl );
}

vec3 applyAtmosphere( vec3 col, vec3 ray ) {
  float t = length( ray );
  vec3 rd = ray / max( t, 1e-4 );
  float k = uFog.y;
  float x = k * ray.y;
  float integral = abs( x ) < 1e-3 ? 1.0 - 0.5 * x : ( 1.0 - exp( -x ) ) / x;
  float tau = uFog.x * exp( clamp( -k * ( cameraPosition.y - uFog.z ), -30.0, 12.0 ) ) * t * integral;
  float f = 1.0 - exp( -tau );
  vec3 haze = hazeAt( rd ) + uSunGlow * pow( max( dot( rd, uSunDir ), 0.0 ), 5.0 );
  col = mix( col, haze, f );
  if ( uFog.w > 0.0 ) col = mix( col, uUnderColor, ( 1.0 - exp( -t * 0.16 ) ) * uFog.w );
  return col;
}
`;

let installed = false;
export function installFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = mvPosition.xyz * mat3( viewMatrix );
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${ATMO_GLSL}
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere( gl_FragColor.rgb, vFogRay );
#endif`;
}

export function attachAtmosphere(shader) {
  for (const k of ['uSunDir', 'uHazeAway', 'uHazeSun', 'uSunGlow', 'uFog', 'uUnderColor', 'uTime', 'uWind', 'uWet', 'uPlayer']) {
    shader.uniforms[k] = ATMO[k];
  }
}

// Hooks a material into the shared atmosphere, plus any extra shader edits.
// `key` must differ for each distinct kind of edit so three.js caches programs correctly.
export function patchMaterial(material, key, edit) {
  material.onBeforeCompile = (shader, renderer) => {
    attachAtmosphere(shader);
    if (edit) edit(shader, renderer);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ---------- Palette: keyed on the sun's elevation in degrees ----------
const c = (hex) => new THREE.Color(hex);
const KEYS = [
  { e: -24, zenith: c('#02040c'), away: c('#070c1c'), sunside: c('#0b1226'), sun: c('#000000'), sunI: 0,   exposure: 4.6, glow: 0 },
  { e: -12, zenith: c('#0a112c'), away: c('#1e2748'), sunside: c('#33305a'), sun: c('#000000'), sunI: 0,   exposure: 3.4, glow: 0.1 },
  { e: -6,  zenith: c('#172352'), away: c('#3f4b78'), sunside: c('#94607a'), sun: c('#ff6a3a'), sunI: 0,   exposure: 2.4, glow: 0.35 },
  { e: -2,  zenith: c('#2a3b76'), away: c('#767ba0'), sunside: c('#f08e66'), sun: c('#ff6a2a'), sunI: 0.1, exposure: 1.6, glow: 0.7 },
  { e: 1.5, zenith: c('#39508f'), away: c('#a5a2b4'), sunside: c('#ff9455'), sun: c('#ff8236'), sunI: 0.9, exposure: 1.25, glow: 0.85 },
  { e: 5,   zenith: c('#436aa4'), away: c('#b3b3bd'), sunside: c('#ffb473'), sun: c('#ff9c4c'), sunI: 1.9, exposure: 1.1, glow: 0.7 },
  { e: 10,  zenith: c('#4a78b4'), away: c('#b5c4d2'), sunside: c('#ffcd92'), sun: c('#ffb570'), sunI: 3.0, exposure: 1.0, glow: 0.5 },
  { e: 20,  zenith: c('#4a80c6'), away: c('#aac6df'), sunside: c('#ffe3bb'), sun: c('#ffd3a0'), sunI: 4.3, exposure: 0.92, glow: 0.3 },
  { e: 38,  zenith: c('#3a7fd2'), away: c('#a0c9ec'), sunside: c('#d9eaf7'), sun: c('#ffefd9'), sunI: 5.3, exposure: 0.85, glow: 0.15 },
  { e: 65,  zenith: c('#2e77d6'), away: c('#98c6ee'), sunside: c('#c6e0f5'), sun: c('#fff4e6'), sunI: 6.0, exposure: 0.82, glow: 0.08 },
];

const _pa = { zenith: new THREE.Color(), away: new THREE.Color(), sunside: new THREE.Color(), sun: new THREE.Color(), sunI: 0, exposure: 1, glow: 0 };
function samplePalette(e) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = saturate((e - a.e) / (b.e - a.e));
  _pa.zenith.copy(a.zenith).lerp(b.zenith, t);
  _pa.away.copy(a.away).lerp(b.away, t);
  _pa.sunside.copy(a.sunside).lerp(b.sunside, t);
  _pa.sun.copy(a.sun).lerp(b.sun, t);
  _pa.sunI = lerp(a.sunI, b.sunI, t);
  _pa.exposure = lerp(a.exposure, b.exposure, t);
  _pa.glow = lerp(a.glow, b.glow, t);
  return _pa;
}

const lum = (col) => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;

// Weather inputs the atmosphere reads. The weather module writes these.
export function defaultWeather() {
  return { overcast: 0.25, storm: 0, rain: 0, wet: 0, fog: 0, wind: 0.25, flash: 0, cover: 0.3 };
}

const STAR_LATITUDE = 46 * (Math.PI / 180);
const STAR_AXIS = new THREE.Vector3(0, Math.sin(STAR_LATITUDE), -Math.cos(STAR_LATITUDE));

export class Atmosphere {
  constructor() {
    this.hour = TIME.startHour;
    this.weather = defaultWeather();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.keyDir = new THREE.Vector3(0, 1, 0);      // whichever of sun/moon lights the world
    this.keyColor = new THREE.Color();
    this.keyIntensity = 0;
    this.elev = 30;                                 // sun elevation, degrees
    this.night = 0;                                 // 0 by day, 1 at night
    this.day = 1;
    this.exposure = 1;
    this.envIntensity = 1;
    this.ambientFloor = 0;                          // extra hemisphere light, keeps nights playable
    this.zenith = new THREE.Color();
    this.away = new THREE.Color();
    this.sunside = new THREE.Color();
    this.cloudLit = new THREE.Color();
    this.cloudDark = new THREE.Color();
    this.cloudSilver = new THREE.Color();
    this.ground = new THREE.Color();
    this.moonPhaseDir = new THREE.Vector3();
    this.starMatrix = new THREE.Matrix3();
    this._m4 = new THREE.Matrix4();
    this.envDirty = true;
    this._envKey = '';
    this._tmp = new THREE.Color();
    this.update(0);
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
  }

  advance(dtSeconds, speed = 1) {
    this.setHour(this.hour + (dtSeconds * speed) / (TIME.secondsPerMinute * 60));
  }

  // Recomputes every derived value from the hour and the weather.
  update(dt, underwater = 0) {
    const w = this.weather;
    const a = ((this.hour - TIME.sunrise) / (TIME.sunset - TIME.sunrise)) * Math.PI;
    const maxElev = 44 * (Math.PI / 180);
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.sin(maxElev), Math.sin(a) * Math.cos(maxElev)).normalize();
    this.elev = Math.asin(clamp(this.sunDir.y, -1, 1)) * (180 / Math.PI);

    // Full moon opposite the sun, nudged so it does not sit exactly on the antipode.
    this.moonDir.set(-this.sunDir.x * 0.96 + 0.16, -this.sunDir.y * 0.92 + 0.06, -this.sunDir.z * 0.96).normalize();

    const p = samplePalette(this.elev);
    const over = saturate(w.overcast), storm = saturate(w.storm);
    this.night = smoothstep(-3, -13, this.elev);
    this.day = smoothstep(-6, 12, this.elev);

    // Overcast pulls every colour toward a grey with the same brightness, storms darken it.
    const grey = (from, mul, tint) => {
      const l = lum(from) * mul * (1 - 0.55 * storm);
      return this._tmp.setRGB(l * tint[0], l * tint[1], l * tint[2]);
    };
    this.zenith.copy(p.zenith).lerp(grey(p.zenith, 1.05, [0.9, 0.96, 1.06]), over);
    this.away.copy(p.away).lerp(grey(p.away, 0.95, [0.95, 0.99, 1.04]), over);
    this.sunside.copy(p.sunside).lerp(grey(p.sunside, 0.82, [1.03, 1.0, 0.97]), over * 0.85);
    if (storm > 0) {
      this.zenith.multiplyScalar(1 - 0.35 * storm);
      this.away.multiplyScalar(1 - 0.3 * storm);
      this.sunside.multiplyScalar(1 - 0.4 * storm);
    }
    // Lightning washes the whole sky.
    if (w.flash > 0) {
      this.zenith.addScalar(0.9 * w.flash);
      this.away.addScalar(0.85 * w.flash);
      this.sunside.addScalar(0.85 * w.flash);
    }
    this.ground.copy(this.away).multiplyScalar(0.28).lerp(this._tmp.set('#2a2418'), 0.35);

    // Key light: the sun by day, the moon once the sun is well below the horizon.
    const sunUp = this.elev > -3.5;
    if (sunUp) {
      this.keyDir.copy(this.sunDir);
      this.keyColor.copy(p.sun);
      this.keyIntensity = p.sunI * (1 - 0.94 * over);
    } else {
      this.keyDir.copy(this.moonDir);
      this.keyColor.set('#8ea6dc');
      const moonUp = smoothstep(-0.02, 0.2, this.moonDir.y);
      this.keyIntensity = 0.5 * moonUp * (1 - 0.85 * over) * smoothstep(-3.5, -9, this.elev);
    }
    this.keyIntensity = Math.max(this.keyIntensity, 0);
    this.ambientFloor = 0.22 * this.night * (1 - 0.5 * over) + 0.04;
    this.exposure = p.exposure * (1 + 0.3 * over + 0.28 * storm);
    this.envIntensity = lerp(1, 0.55, this.night) * (1 + 0.15 * over);

    // Cloud colours: lit side follows the sun (or moon), shadow side follows the sky.
    const lightCol = sunUp ? p.sun : this._tmp.set('#9fb4e6');
    const lightAmt = sunUp ? saturate(0.35 + p.sunI / 3.4) : 0.28;
    this.cloudLit.copy(lightCol).multiplyScalar((0.7 + 1.5 * lightAmt * (1 - 0.7 * over)) * (1 - 0.85 * this.night));
    this.cloudDark.copy(this.zenith).lerp(this.away, 0.6).multiplyScalar(0.55 + 0.35 * (1 - storm));
    if (sunUp && this.elev < 14) this.cloudDark.lerp(this._tmp.set('#5d4a6c'), 0.25 * (1 - over) * (1 - this.elev / 14));
    this.cloudSilver.copy(p.sun).multiplyScalar(1.4 * (1 - over));
    if (w.flash > 0) { this.cloudLit.addScalar(1.2 * w.flash); this.cloudDark.addScalar(0.7 * w.flash); }

    // Haze: valley mist at dawn and dusk, thick under rain.
    const mist = Math.exp(-Math.pow((this.hour - 6.9) / 1.3, 2)) * 0.8 + Math.exp(-Math.pow((this.hour - 19.0) / 1.1, 2)) * 0.35;
    const density = 0.00034 * (1 + mist * 0.9) * (1 + 1.6 * over + 3.2 * saturate(w.rain) + 2.2 * w.fog);
    const uf = ATMO.uFog.value;
    uf.set(density, 0.0052 + 0.0018 * w.fog, WORLD.lakeY, underwater);

    ATMO.uSunDir.value.copy(this.sunDir);
    ATMO.uHazeAway.value.copy(this.away);
    ATMO.uHazeSun.value.copy(this.sunside);
    ATMO.uSunGlow.value.copy(p.sun).multiplyScalar(p.glow * 0.42 * (1 - over) * (this.elev > -8 ? 1 : 0));
    ATMO.uUnderColor.value.set('#0c3a42').multiplyScalar(0.25 + 0.75 * this.day);
    ATMO.uTime.value += dt;
    ATMO.uWind.value.set(0.86, 0.5).multiplyScalar(0.4 + 2.6 * w.wind);
    ATMO.uWet.value = saturate(w.wet);

    // Stars turn about the pole once a day.
    this._m4.makeRotationAxis(STAR_AXIS, -(this.hour / 24) * Math.PI * 2);
    this.starMatrix.setFromMatrix4(this._m4);

    // Environment lighting only needs rebuilding when the sky has changed noticeably.
    const key = [Math.round(this.elev * 0.7), Math.round(over * 8), Math.round(storm * 4), Math.round(w.flash * 3)].join('|');
    if (key !== this._envKey) { this._envKey = key; this.envDirty = true; }
  }
}
