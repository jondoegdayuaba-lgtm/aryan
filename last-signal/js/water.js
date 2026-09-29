// The lake and the creek: transparent water that reads its own depth from the height map, so the
// shoreline, the murk and the foam are exact without any extra render pass. The lake also gets a
// planar reflection of the whole valley.
import * as THREE from 'three';
import { ATMO, ATMO_GLSL } from './atmosphere.js';

const VERT = /* glsl */`
attribute vec2 aFlow;
varying vec3 vWorld;
varying vec2 vFlow;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorld = wp.xyz;
  vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform sampler2D uHeightTex;
uniform sampler2D uWaterNormal;
uniform sampler2D uReflection;
uniform mat4 uReflVP;
uniform float uPlanar;
uniform float uTime;
uniform vec3 uWind3;
uniform vec4 uGrid;        // half size, cell, texel count, unused
uniform vec3 uZenithColor;
varying vec3 vWorld;
varying vec2 vFlow;
${ATMO_GLSL}

float bedAt( vec2 xz ) {
  vec2 p = ( xz + uGrid.x ) / uGrid.y;
  vec2 ip = floor( p ), f = p - ip;
  ivec2 lim = ivec2( int( uGrid.z ) - 1 );
  ivec2 a = clamp( ivec2( ip ), ivec2( 0 ), lim ), b = clamp( ivec2( ip ) + 1, ivec2( 0 ), lim );
  float h00 = texelFetch( uHeightTex, ivec2( a.x, a.y ), 0 ).r, h10 = texelFetch( uHeightTex, ivec2( b.x, a.y ), 0 ).r;
  float h01 = texelFetch( uHeightTex, ivec2( a.x, b.y ), 0 ).r, h11 = texelFetch( uHeightTex, ivec2( b.x, b.y ), 0 ).r;
  return mix( mix( h00, h10, f.x ), mix( h01, h11, f.x ), f.y );
}

void main() {
  float depth = vWorld.y - bedAt( vWorld.xz );
  if ( depth < 0.004 ) discard;

  vec3 toCam = cameraPosition - vWorld;
  float dist = length( toCam );
  vec3 V = toCam / dist;

  // Ripples: two scrolling normal maps. The creek's follow the current; the lake's drift with the wind.
  float wind = length( uWind3.xy );
  vec2 drift = ( length( vFlow ) > 0.01 ) ? vFlow * 0.9 : uWind3.xy * 0.06;
  vec2 uv1 = vWorld.xz * 0.16 - drift * uTime * 0.14;
  vec2 uv2 = vWorld.xz * 0.43 + vec2( -drift.y, drift.x ) * uTime * 0.1 + 0.37;
  vec2 uv3 = vWorld.xz * 0.037 - drift * uTime * 0.03;
  vec2 s1 = texture2D( uWaterNormal, uv1 ).xy * 2.0 - 1.0;
  vec2 s2 = texture2D( uWaterNormal, uv2 ).xy * 2.0 - 1.0;
  vec2 s3 = texture2D( uWaterNormal, uv3 ).xy * 2.0 - 1.0;
  float amp = ( 0.10 + 0.5 * clamp( wind, 0.0, 1.5 ) ) * mix( 1.0, 0.28, smoothstep( 40.0, 320.0, dist ) );
  vec2 slope = ( s1 * 0.6 + s2 * 0.35 + s3 * 0.9 ) * amp;
  if ( length( vFlow ) > 0.01 ) slope *= 1.6;
  vec3 N = normalize( vec3( slope.x, 1.0, slope.y ) );

  float cosT = clamp( dot( N, V ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );

  // Reflection: the mirrored valley on the lake, the sky's own colour on the creek.
  vec3 R = reflect( -V, N );
  vec3 refl = mix( hazeAt( R ), uZenithColor, smoothstep( 0.05, 0.9, R.y ) );
  if ( uPlanar > 0.5 ) {
    vec4 rc = uReflVP * vec4( vWorld, 1.0 );
    vec2 ruv = rc.xy / rc.w * 0.5 + 0.5 + N.xz * 0.028;
    if ( rc.w > 0.0 && ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0 ) refl = texture2D( uReflection, ruv ).rgb;
  }

  // Sun glint on the ripples.
  vec3 H = normalize( V + uSunDir );
  float spec = pow( max( dot( N, H ), 0.0 ), 900.0 ) * 60.0 + pow( max( dot( N, H ), 0.0 ), 90.0 ) * 1.4;
  spec *= step( 0.0, uSunDir.y ) * smoothstep( 0.0, 0.08, uSunDir.y );
  vec3 sunCol = uSunGlow * 2.4 + vec3( 0.06 );

  // Body colour: clear and green in the shallows, dark blue-green where deep.
  vec3 ambient = mix( uHazeAway, uHazeSun, 0.35 ) * 0.9 + vec3( max( uSunDir.y, 0.0 ) * 0.18 );
  float k = 1.0 - exp( -depth * 0.32 );
  vec3 shallow = vec3( 0.05, 0.17, 0.14 ), deep = vec3( 0.006, 0.04, 0.06 );
  vec3 body = mix( shallow, deep, k ) * ambient;
  float aBody = clamp( 1.0 - exp( -depth * 1.9 ), 0.0, 1.0 );

  // Foam along the shore and where the creek runs shallow and fast.
  float fn = texture2D( uWaterNormal, vWorld.xz * 0.21 + vec2( uTime * 0.02, 0.0 ) ).b;
  float foam = smoothstep( 0.42, 0.0, depth + ( fn - 0.5 ) * 0.28 ) * ( 0.55 + 0.45 * sin( uTime * 1.3 + vWorld.x * 0.8 + vWorld.z * 0.6 ) );
  if ( length( vFlow ) > 0.01 ) foam += smoothstep( 0.7, 0.2, depth ) * smoothstep( 0.6, 0.8, fn ) * 0.35;
  foam = clamp( foam, 0.0, 1.0 );
  vec3 foamCol = vec3( 0.86, 0.9, 0.92 ) * ambient * 1.1;

  // Everything below is premultiplied: what the surface adds, and how much of the bed it hides.
  vec3 surface = F * refl + ( 1.0 - F ) * aBody * body;
  float a = F + ( 1.0 - F ) * aBody;
  surface = surface * ( 1.0 - foam ) + foamCol * foam;
  a = a * ( 1.0 - foam ) + foam;
  surface += spec * sunCol;

  // A soft waterline, then the atmosphere applied to the straight (un-premultiplied) colour.
  float edge = smoothstep( 0.0, 0.05, depth );
  vec3 straight = applyAtmosphere( surface / max( a, 1e-3 ), vWorld - cameraPosition );
  a *= edge;
  gl_FragColor = vec4( straight * a, a );
}`;

export class Water {
  constructor(world, terrain, waterNormal, { reflectionSize = 512 } = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.reflectionSize = reflectionSize;
    this.reflectionRT = null;
    this.uniforms = {
      uHeightTex: { value: terrain.heightTex },
      uWaterNormal: { value: waterNormal },
      uReflection: { value: null },
      uReflVP: { value: new THREE.Matrix4() },
      uPlanar: { value: 0 },
      uWind3: { value: new THREE.Vector3() },
      uGrid: { value: new THREE.Vector4(world.half, world.cell, world.v, 0) },
      uZenithColor: { value: new THREE.Color() },
    };
    const base = {
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
    };
    this.lakeMaterial = new THREE.ShaderMaterial({ ...base, uniforms: { ...ATMO, ...this.uniforms, uPlanar: { value: 0 } } });
    this.creekMaterial = new THREE.ShaderMaterial({ ...base, uniforms: { ...ATMO, ...this.uniforms, uPlanar: { value: 0 } } });

    // Lake: a plane at the waterline, bigger than the lake; pixels above the bed are discarded.
    const L = world.lake, r = Math.max(L.rx, L.rz) * 1.45;
    const lg = new THREE.PlaneGeometry(r * 2, r * 2, 1, 1);
    lg.rotateX(-Math.PI / 2);
    lg.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(4 * 2), 2));
    this.lake = new THREE.Mesh(lg, this.lakeMaterial);
    this.lake.position.set(L.cx, world.lakeY, L.cz);
    this.lake.frustumCulled = false;
    this.lake.renderOrder = 10;
    this.group.add(this.lake);

    // Creek: a ribbon following the channel, level with the water surface.
    const line = world.riverLine;
    const pos = [], flow = [], idx = [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i], a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const w = p.hw + 2.2;
      for (const side of [-1, 1]) {
        pos.push(p.x - tz * w * side, p.level, p.z + tx * w * side);
        flow.push(tx, tz);
      }
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    cg.setIndex(idx);
    this.creek = new THREE.Mesh(cg, this.creekMaterial);
    this.creek.frustumCulled = false;
    this.creek.renderOrder = 11;
    this.group.add(this.creek);

    // Reflection camera.
    this.mirror = new THREE.PerspectiveCamera();
    this.mirror.layers.set(0);
    this._n = new THREE.Vector3(0, 1, 0);
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -world.lakeY - 0.05);
    this.setReflection(reflectionSize);
  }

  setReflection(size) {
    this.reflectionSize = size;
    this.reflectionRT?.dispose();
    this.reflectionRT = null;
    if (size > 0) {
      this.reflectionRT = new THREE.WebGLRenderTarget(size, Math.round(size * 0.6), { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      this.reflectionRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    this.lakeMaterial.uniforms.uReflection.value = this.reflectionRT ? this.reflectionRT.texture : null;
    this.lakeMaterial.uniforms.uPlanar.value = this.reflectionRT ? 1 : 0;
  }

  // Both materials share these uniform objects, so one update serves the lake and the creek.
  update(atmo) {
    this.uniforms.uWind3.value.set(ATMO.uWind.value.x, ATMO.uWind.value.y, 0);
    this.uniforms.uZenithColor.value.copy(atmo.zenith);
  }

  // Renders the mirrored view of the world into the reflection target. `draw(camera)` does the render.
  renderReflection(renderer, camera, draw) {
    if (!this.reflectionRT || !this.lake.visible) return;
    const y = this.world.lakeY;
    // Skip when the camera is below the surface or the lake is nowhere near the view.
    if (camera.position.y < y + 0.1) return;
    const m = this.mirror;
    m.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    m.up.set(up.x, -up.y, up.z);
    m.lookAt(camera.position.x + fwd.x, 2 * y - (camera.position.y + fwd.y), camera.position.z + fwd.z);
    m.fov = camera.fov; m.aspect = camera.aspect; m.near = camera.near; m.far = Math.min(camera.far, 6000);
    m.updateProjectionMatrix();
    m.updateMatrixWorld();
    this.uniforms.uReflVP.value.multiplyMatrices(m.projectionMatrix, m.matrixWorldInverse);
    this.lakeMaterial.uniforms.uReflVP.value.copy(this.uniforms.uReflVP.value);

    this._plane.constant = -y - 0.05;
    const prevClip = renderer.clippingPlanes;
    renderer.clippingPlanes = [this._plane];
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.reflectionRT);
    renderer.clear();
    draw(m);
    renderer.setRenderTarget(prevTarget);
    renderer.clippingPlanes = prevClip;
  }

  dispose() {
    this.reflectionRT?.dispose();
  }
}
