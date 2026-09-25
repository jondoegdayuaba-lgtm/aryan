// Sky, sun and atmosphere. The dome uses the Preetham scattering model
// (after three.js' Sky example, MIT) plus a drifting cloud layer, stars and
// a moon at night. The same shader renders the environment map that lights
// every PBR material, so the sky, the fog and the lighting always agree.
import * as THREE from 'three';
import { G } from './shading.js';

const SKY_VS = /* glsl */`
uniform vec3 uSun;
uniform float uRayleigh, uTurbidity, uMie;
varying vec3 vDir;
varying vec3 vBetaR, vBetaM;
varying float vSunE, vSunfade;
const float e = 2.718281828459045;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
float sunIntensity( float c ) {
  c = clamp( c, -1.0, 1.0 );
  return 1000.0 * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( c ) ) / steepness ) ) );
}
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
  vSunE = sunIntensity( uSun.y );
  vSunfade = 1.0 - clamp( 1.0 - exp( uSun.y ), 0.0, 1.0 );
  vBetaR = totalRayleigh * ( uRayleigh - ( 1.0 - vSunfade ) );
  vBetaM = 0.434 * ( 0.2 * uTurbidity ) * 10E-18 * MieConst * uMie;
}`;

const SKY_FS = /* glsl */`
uniform vec3 uSun;
uniform float uMieG, uExposure, uNight, uClouds, uCloudDark, uGround, uStars, uTime, uDisk, uOvercast;
uniform vec3 uCloudLit, uCloudShade, uNightTint, uMoon, uGroundColor;
uniform sampler2D uNoise;
varying vec3 vDir;
varying vec3 vBetaR, vBetaM;
varying float vSunE, vSunfade;
const float pi = 3.141592653589793;
float rayleighPhase( float c ) { return 0.05968310365946075 * ( 1.0 + c * c ); }
float hgPhase( float c, float g ) {
  float g2 = g * g;
  return 0.07957747154594767 * ( 1.0 - g2 ) / pow( 1.0 - 2.0 * g * c + g2, 1.5 );
}
float hash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }

vec3 atmosphere( vec3 dir ) {
  vec3 d = dir;
  d.y = max( d.y, 0.0 );
  d = normalize( d + vec3( 0.0, 0.0001, 0.0 ) );
  float zen = acos( max( 0.0, d.y ) );
  float inv = 1.0 / ( cos( zen ) + 0.15 * pow( 93.885 - zen * 180.0 / pi, -1.253 ) );
  vec3 Fex = exp( -( vBetaR * 8.4E3 * inv + vBetaM * 1.25E3 * inv ) );
  float c = dot( d, uSun );
  vec3 bR = vBetaR * rayleighPhase( c * 0.5 + 0.5 );
  vec3 bM = vBetaM * hgPhase( c, uMieG );
  vec3 Lin = pow( vSunE * ( ( bR + bM ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( bR + bM ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ), clamp( pow( 1.0 - uSun.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  float disk = smoothstep( 0.99995, 0.99997, c ) * uDisk;
  L0 += vSunE * 1900.0 * Fex * disk;
  vec3 col = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
  col = pow( col, vec3( 1.0 / ( 1.2 + 1.2 * vSunfade ) ) );
  return col;
}

void main() {
  vec3 dir = normalize( vDir );
  vec3 col = atmosphere( dir ) * uExposure;

  // Night: deep blue gradient, glow near the horizon, stars and the moon.
  if ( uNight > 0.0 ) {
    float up = max( dir.y, 0.0 );
    vec3 night = mix( uNightTint * 1.8, uNightTint * 0.35, pow( up, 0.45 ) );
    vec3 cell = floor( dir * 420.0 );
    float star = hash( cell );
    float tw = 0.6 + 0.4 * sin( uTime * ( 2.0 + star * 5.0 ) + star * 40.0 );
    float s = smoothstep( 0.9965, 1.0, star ) * smoothstep( 0.0, 0.25, up ) * tw * uStars;
    night += vec3( 0.9, 0.95, 1.0 ) * s * 1.6;
    float mc = dot( dir, normalize( uMoon ) );
    night += vec3( 0.95, 0.93, 0.85 ) * ( smoothstep( 0.99965, 0.99975, mc ) * 1.2 + pow( max( mc, 0.0 ), 400.0 ) * 0.08 + pow( max( mc, 0.0 ), 12.0 ) * 0.012 );
    col = mix( col, night, uNight );
  }

  // Clouds on a flat layer high above, lit from the sun side.
  if ( dir.y > 0.0 && uClouds > 0.0 ) {
    float t = 1400.0 / ( dir.y + 0.03 );
    vec2 p = dir.xz * t * 0.00018 + uTime * vec2( 0.0016, 0.0007 );
    float n = texture2D( uNoise, p ).r * 0.55 + texture2D( uNoise, p * 2.7 + 0.3 ).g * 0.3 + texture2D( uNoise, p * 7.1 + 0.6 ).r * 0.15;
    float cover = smoothstep( 1.0 - uClouds, 1.0 - uClouds + 0.28, n );
    float fade = smoothstep( 0.0, 0.14, dir.y );
    float sunSide = pow( max( dot( dir, uSun ), 0.0 ), 6.0 );
    vec3 cc = mix( uCloudShade, uCloudLit, smoothstep( 0.2, 0.85, n ) * 0.7 + 0.3 );
    cc += uCloudLit * sunSide * ( 1.0 - cover ) * 1.5;
    cc *= mix( 1.0, uCloudDark, smoothstep( 0.5, 1.0, cover ) );
    col = mix( col, cc, cover * fade * 0.92 );
  }

  // Overcast: a low grey ceiling, brighter overhead than at the horizon,
  // with darker rain-heavy patches drifting across it.
  if ( uOvercast > 0.0 ) {
    float up = max( dir.y, 0.0 );
    vec2 q = dir.xz / ( dir.y + 0.12 ) * 0.35 + uTime * vec2( 0.004, 0.002 );
    float m = texture2D( uNoise, q ).r * 0.6 + texture2D( uNoise, q * 3.1 + 0.4 ).g * 0.4;
    vec3 grey = mix( uCloudShade, uCloudLit, ( 1.0 + 2.0 * up ) / 3.0 ) * mix( 0.72, 1.08, m );
    col = mix( col, grey, uOvercast );
  }

  // Below the horizon (only used for the environment map): the ground.
  if ( uGround > 0.5 && dir.y < 0.0 ) col = mix( col, uGroundColor, smoothstep( 0.0, -0.08, dir.y ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(renderer, noiseTexture) {
    this.renderer = renderer;
    this.uniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uRayleigh: { value: 2 },
      uTurbidity: { value: 6 },
      uMie: { value: 0.005 },
      uMieG: { value: 0.8 },
      uExposure: { value: 1 },
      uNight: { value: 0 },
      uNightTint: { value: new THREE.Color(0.007, 0.013, 0.032) },
      uMoon: { value: new THREE.Vector3(0.3, 0.5, -0.8) },
      uStars: { value: 1 },
      uClouds: { value: 0.3 },
      uCloudDark: { value: 0.75 },
      uCloudLit: { value: new THREE.Color(1, 0.95, 0.9) },
      uCloudShade: { value: new THREE.Color(0.55, 0.6, 0.68) },
      uGround: { value: 0 },
      uGroundColor: { value: new THREE.Color(0.06, 0.07, 0.04) },
      uNoise: { value: noiseTexture },
      uTime: G.uTime,
      uDisk: { value: 1 },
      uOvercast: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(4000);

    // Environment capture scene: the same dome, with ground below the horizon.
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.mesh.geometry, mat);
    this.envMesh.scale.setScalar(50);
    this.envScene.add(this.envMesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
  }

  follow(camera) {
    this.mesh.position.copy(camera.position);
  }

  // Apply a time-of-day preset (see config.js) and rebuild the lighting.
  apply(t, scene, sun) {
    const u = this.uniforms;
    const el = THREE.MathUtils.degToRad(t.sunElevation), az = THREE.MathUtils.degToRad(t.sunAzimuth);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    u.uSun.value.copy(dir);
    u.uRayleigh.value = t.rayleigh;
    u.uTurbidity.value = t.turbidity;
    u.uMie.value = t.mie;
    u.uMieG.value = t.mieG;
    u.uExposure.value = t.skyExposure;
    u.uNight.value = t.night ? 1 : 0;
    u.uDisk.value = t.night ? 0 : 1;
    u.uClouds.value = t.clouds;
    u.uCloudLit.value.set(t.cloudLit);
    u.uCloudShade.value.set(t.cloudShade);
    u.uCloudDark.value = t.cloudDark ?? 0.75;
    u.uOvercast.value = t.overcast ?? 0;
    u.uGroundColor.value.set(t.groundColor);
    if (t.night) {
      const mel = THREE.MathUtils.degToRad(t.moonElevation), maz = THREE.MathUtils.degToRad(t.moonAzimuth);
      u.uMoon.value.set(Math.cos(mel) * Math.sin(maz), Math.sin(mel), Math.cos(mel) * Math.cos(maz));
    }

    // The directional light is the sun, or the moon at night.
    const lightDir = t.night ? u.uMoon.value.clone().normalize() : dir;
    sun.color.set(t.sunColor);
    sun.intensity = t.sunIntensity;
    sun.userData.dir = lightDir.clone();
    G.uSunDir.value.copy(lightDir);
    G.uSunCol.value.set(t.sunColor).multiplyScalar(t.sunIntensity);

    scene.fog.color.set(t.fogColor);
    scene.fog.density = t.fogDensity;
    G.uFogSun.value.set(t.fogSunColor);
    G.uFogFalloff.value = t.fogFalloff;
    G.uFogBase.value = t.fogBase ?? 0;
    G.uFogHaze.value = t.haze ?? 0.0001;

    // Environment lighting from the sky.
    // (no sun disk: the directional light already provides the sun itself)
    u.uGround.value = 1;
    u.uDisk.value = 0;
    const prevTime = G.uTime.value;
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    G.uTime.value = prevTime;
    u.uGround.value = 0;
    u.uDisk.value = t.night || t.overcast ? 0 : 1;
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = t.envIntensity;
    return lightDir;
  }
}
