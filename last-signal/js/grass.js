// Grass and wildflowers drawn entirely on the GPU. A fixed grid of tufts follows the camera; each
// tuft works out its own world position, height and whether it belongs there (not on trails,
// rock, snow, or under dense forest) from the terrain maps, so nothing is rebuilt as you walk.
import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';
import { TERRAIN_COMMON_GLSL } from './terrain.js';
import { makeGrassAtlas } from './textures.js';

const VERT_PARS = /* glsl */`
attribute vec2 aSeed;
uniform sampler2D uHeightTex;
uniform sampler2D uNormalTex;
uniform vec4 uGrid;        // world half size, cell (m), texel count, unused
uniform vec2 uCamXZ;
uniform vec4 uLayer;       // grid size, cell size, fade start, fade end
uniform vec4 uSize;        // min width, max width, min height, max height
uniform float uDensity;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uPlayer;
varying float vTint;
varying float vShade;
varying float vFlower;
${TERRAIN_COMMON_GLSL}

float h21( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float groundAt( vec2 xz ) {
  vec2 p = ( xz + uGrid.x ) / uGrid.y;
  vec2 ip = floor( p ), f = p - ip;
  ivec2 lim = ivec2( int( uGrid.z ) - 1 );
  ivec2 a = clamp( ivec2( ip ), ivec2( 0 ), lim ), b = clamp( ivec2( ip ) + 1, ivec2( 0 ), lim );
  float h00 = texelFetch( uHeightTex, a, 0 ).r, h10 = texelFetch( uHeightTex, ivec2( b.x, a.y ), 0 ).r;
  float h01 = texelFetch( uHeightTex, ivec2( a.x, b.y ), 0 ).r, h11 = texelFetch( uHeightTex, b, 0 ).r;
  return mix( mix( h00, h10, f.x ), mix( h01, h11, f.x ), f.y );
}
`;

const VERT_MAIN = /* glsl */`
  // Which world cell this tuft occupies: the window slides with the camera, tufts keep their cell.
  float G = uLayer.x, cell = uLayer.y;
  vec2 origin = floor( uCamXZ / cell ) - G * 0.5;
  vec2 cellAbs = origin + mod( aSeed - origin, G );
  vec2 rnd = vec2( h21( cellAbs + 3.1 ), h21( cellAbs + 17.7 ) );
  vec2 xz = ( cellAbs + rnd ) * cell;
  float dCam = length( xz - uCamXZ );
  float fade = 1.0 - smoothstep( uLayer.z, uLayer.w, dCam );

  vec2 uvw = worldUv( xz );
  vec4 sp = texture2D( uSplatTex, uvw );
  vec3 nrm = texture2D( uNormalTex, uvw ).xyz * 2.0 - 1.0;
  float ground = groundAt( xz );
  float snow = smoothstep( uWorld.z - 40.0, uWorld.z, ground - uWorld.y );
  float wet = 1.0 - smoothstep( 0.3, 0.9, sp.b );
  float allowed = ( 1.0 - sp.r ) * wet * smoothstep( 0.78, 0.9, nrm.y ) * ( 1.0 - snow ) * ( 1.0 - 0.72 * sp.g ) * step( uWorld.y + 0.6, ground );
  float keep = step( h21( cellAbs + 9.3 ), allowed * uDensity );
  float grow = fade * keep;

  float pick = h21( cellAbs + 41.0 );
  float tile = pick < 0.62 ? 0.0 : pick < 0.86 ? 1.0 : pick < 0.93 ? 2.0 : 3.0;
  vFlower = tile > 1.5 ? 1.0 : 0.0;
  vMapUv = uv * 0.5 + vec2( mod( tile, 2.0 ) * 0.5, floor( tile / 2.0 ) == 0.0 ? 0.5 : 0.0 );

  float w = mix( uSize.x, uSize.y, h21( cellAbs + 5.5 ) ) * ( tile > 1.5 ? 0.8 : 1.0 );
  float hgt = mix( uSize.z, uSize.w, h21( cellAbs + 6.5 ) ) * ( 0.7 + 0.6 * sp.a ) * ( tile > 1.5 ? 1.15 : 1.0 );
  float yaw = h21( cellAbs + 7.5 ) * 6.2831853 + position.z * 2.0943951;   // position.z carries the plane index
  float cy = cos( yaw ), sy = sin( yaw );
  vec3 local = vec3( position.x * w, position.y * hgt, 0.0 );
  vec3 rotated = vec3( local.x * cy, local.y, local.x * sy );

  // Wind, and blades leaning away from the player.
  float ph = xz.x * 0.21 + xz.y * 0.17;
  float gust = sin( uTime * 1.6 + ph ) * 0.6 + sin( uTime * 3.7 + ph * 2.1 ) * 0.4;
  float bend = position.y * position.y * ( 0.09 + 0.16 * length( uWind ) ) * hgt;
  vec2 away = xz - uPlayer.xz;
  float pd = length( away );
  vec2 push = pd < 1.6 ? normalize( away + 1e-4 ) * ( 1.0 - pd / 1.6 ) * 0.5 * position.y * position.y : vec2( 0.0 );
  rotated.xz += uWind * gust * bend + push * hgt;
  rotated.y -= length( push ) * 0.25 * hgt;

  transformed = vec3( xz.x, ground - 0.02, xz.y ) + rotated * grow;
  vTint = h21( cellAbs + 2.2 );
  vShade = position.y;
  vLush = sp.a;
`;

export class Grass {
  constructor(terrain, world) {
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.atlas = makeGrassAtlas();
    this.layers = [];
    const make = (G, cell, fadeStart, fadeEnd, size, density) => {
      // One tuft = three crossed quads; position.z holds the plane number for the yaw offset.
      const geo = new THREE.InstancedBufferGeometry();
      const pos = [], uvs = [], idx = [];
      for (let p = 0; p < 3; p++) {
        const o = p * 4;
        pos.push(-0.5, 0, p, 0.5, 0, p, -0.5, 1, p, 0.5, 1, p);
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      const seeds = new Float32Array(G * G * 2);
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { seeds[(j * G + i) * 2] = i; seeds[(j * G + i) * 2 + 1] = j; }
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
      geo.instanceCount = G * G;

      const mat = new THREE.MeshStandardMaterial({ map: this.atlas, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.9 });
      const u = {
        uHeightTex: { value: terrain.heightTex },
        uNormalTex: { value: terrain.normalTex },
        uSplatTex: { value: terrain.splatTex },
        uNoiseTex: terrain.uniforms.uNoiseTex,
        uWorld: terrain.uniforms.uWorld,
        uMapT: terrain.uniforms.uMapT,
        uGrid: { value: new THREE.Vector4(world.half, world.cell, world.v, 0) },
        uCamXZ: { value: new THREE.Vector2() },
        uLayer: { value: new THREE.Vector4(G, cell, fadeStart, fadeEnd) },
        uSize: { value: new THREE.Vector4(...size) },
        uDensity: { value: density },
      };
      patchMaterial(mat, `grass-${G}`, (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + VERT_PARS + '\nvarying float vLush;')
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );\n#ifdef USE_TANGENT\n vec3 objectTangent = vec3( tangent.xyz );\n#endif')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vTint;\nvarying float vShade;\nvarying float vFlower;\nvarying float vLush;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            // Blades darken toward the root and vary in tone; flowers keep their own colour.
            float rootDark = mix( 0.45, 1.0, smoothstep( 0.0, 0.55, vShade ) );
            vec3 tone = mix( vec3( 1.18, 1.05, 0.72 ), vec3( 0.85, 1.05, 0.82 ), clamp( vLush * 1.1, 0.0, 1.0 ) ) * ( 0.85 + 0.3 * vTint );
            diffuseColor.rgb *= mix( tone, vec3( 1.0 ), vFlower ) * rootDark;`);
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.layers.set(1);           // main camera only; the lake reflection skips grass
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.layers.push({ mesh, u, base: density });
    };
    //        grid  cell  fade   [minW maxW minH maxH]     density
    make(150, 0.34, 15, 24, [0.34, 0.6, 0.28, 0.5], 1.0);
    make(118, 1.05, 42, 78, [0.9, 1.5, 0.6, 0.95], 0.9);
  }

  setDensity(k) {
    for (const l of this.layers) { l.u.uDensity.value = l.base * k; l.mesh.visible = k > 0.01; }
  }

  update(camera, playerPos) {
    for (const l of this.layers) l.u.uCamXZ.value.set(camera.position.x, camera.position.z);
    if (playerPos) this.playerPos = playerPos;
  }
}
