// The sky dome (gradient, sun, moon, stars, clouds) and the environment map baked from it,
// which lights everything with soft, correctly coloured ambient light and reflections.
import * as THREE from 'three';
import { ATMO, ATMO_GLSL } from './atmosphere.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const FRAG = /* glsl */`
uniform float uTime;
uniform mat3 uStarRot;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uGround;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec3 uCloudSilver;
uniform float uCover;
uniform float uOvercast;
uniform float uNight;
uniform float uEnv;
uniform vec2 uCloudWind;
varying vec3 vDir;
${ATMO_GLSL}

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( i ), b = hash12( i + vec2( 1.0, 0.0 ) ), c = hash12( i + vec2( 0.0, 1.0 ) ), d = hash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float cloudFbm( vec2 p ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 5; i ++ ) {
    s += a * vnoise( p );
    p = p * 2.02 + vec2( 11.3, 7.7 );
    a *= 0.5;
  }
  return s;
}

vec3 skyBase( vec3 dir ) {
  vec3 hz = hazeAt( dir );
  float t = clamp( dir.y, 0.0, 1.0 );
  vec3 col = mix( hz, uZenith, pow( t, 0.45 ) );
  if ( dir.y < 0.0 ) col = mix( hz, uGround, 1.0 - smoothstep( -0.3, 0.0, dir.y ) );
  float sd = max( dot( dir, uSunDir ), 0.0 );
  col += uSunGlow * ( pow( sd, 12.0 ) * 1.4 + pow( sd, 3.0 ) * 0.5 );
  return col;
}

vec3 starField( vec3 sdir ) {
  vec3 result = vec3( 0.0 );
  for ( int layer = 0; layer < 2; layer ++ ) {
    float scale = layer == 0 ? 80.0 : 190.0;
    vec3 p = sdir * scale;
    vec3 ip = floor( p ), fp = fract( p ) - 0.5;
    float h = hash13( ip + float( layer ) * 17.0 );
    float has = step( layer == 0 ? 0.972 : 0.985, h );
    vec3 jitter = vec3( hash13( ip + 3.1 ), hash13( ip + 7.7 ), hash13( ip + 11.3 ) ) - 0.5;
    float d = length( fp - jitter * 0.7 );
    float m = ( 1.0 - smoothstep( 0.0, layer == 0 ? 0.11 : 0.09, d ) ) * has;
    float b = 0.35 + 0.65 * fract( h * 173.3 );
    vec3 tint = mix( vec3( 1.0, 0.82, 0.66 ), vec3( 0.7, 0.8, 1.0 ), fract( h * 31.7 ) );
    float tw = 0.75 + 0.25 * sin( uTime * ( 1.5 + h * 4.0 ) + h * 40.0 );
    result += tint * m * b * tw * ( layer == 0 ? 1.0 : 0.55 );
  }
  // Milky Way: a soft band along a tilted great circle, broken up with noise.
  vec3 mwN = normalize( vec3( 0.32, 0.86, -0.4 ) );
  float band = exp( -pow( dot( sdir, mwN ) / 0.17, 2.0 ) );
  float clumps = cloudFbm( vec2( atan( sdir.z, sdir.x ) * 4.0, sdir.y * 7.0 ) + 4.0 );
  result += vec3( 0.55, 0.6, 0.75 ) * band * ( 0.25 + 1.3 * clumps * clumps ) * 0.09;
  return result;
}

vec4 cumulus( vec3 dir ) {
  if ( dir.y < 0.004 ) return vec4( 0.0 );
  float fade = smoothstep( 0.0, 0.17, dir.y );
  vec2 uv = dir.xz / ( dir.y + 0.11 ) * 0.42 + uCloudWind * 0.011 * uTime;
  float base = cloudFbm( uv );
  float th = mix( 0.7, 0.3, uCover );
  float dens = smoothstep( th, th + 0.15, base );
  vec2 toSun = normalize( uSunDir.xz + 1e-4 ) * ( 0.06 + 0.12 * ( 1.0 - max( uSunDir.y, 0.0 ) ) );
  float base2 = cloudFbm( uv + toSun );
  float shade = clamp( 0.58 + ( base - base2 ) * 5.5, 0.0, 1.0 );
  float thick = smoothstep( th, th + 0.34, base );
  shade = mix( shade, 0.18, thick * 0.55 );
  vec3 c = mix( uCloudDark, uCloudLit, shade );
  float edge = dens * ( 1.0 - dens ) * 4.0;
  c += uCloudSilver * edge * pow( max( dot( dir, uSunDir ), 0.0 ), 4.0 );
  c = mix( hazeAt( dir ), c, fade );
  return vec4( c, dens * mix( 0.9, 1.0, uOvercast ) * fade );
}

vec4 cirrus( vec3 dir ) {
  if ( dir.y < 0.05 ) return vec4( 0.0 );
  vec2 uv = dir.xz / ( dir.y + 0.25 ) * vec2( 0.45, 1.5 ) + uCloudWind * 0.004 * uTime + 3.0;
  float n = cloudFbm( uv * 1.4 );
  float a = smoothstep( 0.52, 0.85, n ) * 0.4 * ( 1.0 - uOvercast ) * smoothstep( 0.05, 0.3, dir.y );
  return vec4( mix( uCloudLit, vec3( 1.0 ), 0.25 ) * 0.9, a );
}

void main() {
  vec3 dir = normalize( vDir );
  vec3 col = skyBase( dir );
  float open = 1.0;

  vec4 hi = cirrus( dir );
  vec4 lo = cumulus( dir );

  if ( uEnv < 0.5 ) {
    // Stars fade out with daylight and behind cloud.
    if ( uNight > 0.01 && dir.y > -0.02 ) {
      vec3 sdir = uStarRot * dir;
      col += starField( sdir ) * uNight * ( 1.0 - uOvercast ) * smoothstep( -0.02, 0.12, dir.y ) * ( 1.0 - lo.a );
    }

    // Moon: a shaded disc with maria and a soft halo.
    float md = dot( dir, uMoonDir );
    if ( md > 0.994 && uMoonDir.y > -0.06 ) {
      vec3 t = normalize( cross( abs( uMoonDir.y ) > 0.99 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 ), uMoonDir ) );
      vec3 b = cross( uMoonDir, t );
      vec3 off = dir - uMoonDir * md;
      vec2 q = vec2( dot( off, t ), dot( off, b ) ) / 0.03;
      float r2 = dot( q, q );
      float disc = 1.0 - smoothstep( 0.93, 1.0, sqrt( r2 ) );
      float surf = 0.74 + 0.2 * vnoise( q * 3.2 + 7.0 ) - 0.3 * smoothstep( 0.55, 0.72, vnoise( q * 2.1 + 3.3 ) ) + 0.1 * vnoise( q * 10.0 );
      vec3 nrm = vec3( q, sqrt( max( 1.0 - r2, 0.0 ) ) );
      vec3 sl = vec3( dot( uSunDir, t ), dot( uSunDir, b ), dot( uSunDir, -uMoonDir ) );
      float lit = smoothstep( -0.04, 0.14, dot( nrm, normalize( sl ) ) );
      col += vec3( 0.93, 0.96, 1.0 ) * surf * ( 0.04 + 0.96 * lit ) * 6.0 * disc * ( 1.0 - lo.a );
    }
    col += vec3( 0.5, 0.6, 0.9 ) * ( pow( max( md, 0.0 ), 120.0 ) * 0.22 + pow( max( md, 0.0 ), 14.0 ) * 0.03 ) * uNight * ( 1.0 - lo.a );

    // Sun disc, dimmed by any cloud in front of it.
    float sd = dot( dir, uSunDir );
    float disc = smoothstep( 0.99988, 0.99996, sd ) * step( -0.012, dir.y );
    col += uSunColor * ( disc * 55.0 + pow( max( sd, 0.0 ), 1400.0 ) * 6.0 ) * ( 1.0 - lo.a ) * ( 1.0 - 0.7 * hi.a );
  }

  col = mix( col, hi.rgb, hi.a );
  col = mix( col, lo.rgb, lo.a );
  gl_FragColor = vec4( col, 1.0 );
}`;

function makeMaterial(shared, env) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { ...ATMO, ...shared, uEnv: { value: env ? 1 : 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  m.toneMapped = false;
  return m;
}

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.shared = {
      uStarRot: { value: new THREE.Matrix3() },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uCloudSilver: { value: new THREE.Color() },
      uCover: { value: 0.3 },
      uOvercast: { value: 0 },
      uNight: { value: 0 },
      uCloudWind: { value: new THREE.Vector2(1, 0.4) },
    };
    const geo = new THREE.SphereGeometry(1, 48, 32);
    this.mesh = new THREE.Mesh(geo, makeMaterial(this.shared, false));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(geo, makeMaterial(this.shared, true));
    this.envMesh.scale.setScalar(50);
    this.envMesh.frustumCulled = false;
    this.envScene.add(this.envMesh);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
  }

  // Pushes the atmosphere's current state into the shader.
  update(atmo, camera) {
    const s = this.shared;
    s.uStarRot.value.copy(atmo.starMatrix);
    s.uMoonDir.value.copy(atmo.moonDir);
    s.uSunColor.value.copy(atmo.keyColor).multiplyScalar(atmo.elev > -3.5 ? 1 : 0);
    s.uZenith.value.copy(atmo.zenith);
    s.uGround.value.copy(atmo.ground);
    s.uCloudLit.value.copy(atmo.cloudLit);
    s.uCloudDark.value.copy(atmo.cloudDark);
    s.uCloudSilver.value.copy(atmo.cloudSilver);
    s.uCover.value = atmo.weather.cover;
    s.uOvercast.value = atmo.weather.overcast;
    s.uNight.value = atmo.night;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
  }

  // Bakes the sky into a prefiltered cube map when it has changed enough to matter.
  refreshEnvironment(scene, atmo, force = false) {
    if (!force && !atmo.envDirty) return;
    atmo.envDirty = false;
    const target = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: 128 });
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = target;
    scene.environment = target.texture;
  }
}
