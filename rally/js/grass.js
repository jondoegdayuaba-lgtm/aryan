// Grass tufts around the camera, placed entirely on the GPU: each instance
// finds its own spot on a world-anchored grid, samples the heightfield and
// the road/rock masks, and hides itself where grass wouldn't grow.
import * as THREE from 'three';
import { N, HALF, WATER } from './gen.js';
import { patch } from './shading.js';
import { bakeTexture } from './bake.js';

export class Grass {
  constructor(renderer, terrainData, textures, count = 30000, spacing = 0.62) {
    const side = Math.floor(Math.sqrt(count));
    this.side = side;
    this.spacing = spacing;
    const radius = (side / 2) * spacing;

    // two crossed cards per tuft
    const g = new THREE.InstancedBufferGeometry();
    const pos = [], uv = [], idx = [];
    const W = 0.8, H = 0.5;
    for (let q = 0; q < 2; q++) {
      const a = q * Math.PI / 2;
      const cx = Math.cos(a) * W / 2, cz = Math.sin(a) * W / 2;
      const b = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, H, cz, -cx, H, -cz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const seeds = new Float32Array(side * side);
    for (let i = 0; i < seeds.length; i++) seeds[i] = i;
    g.setAttribute('aI', new THREE.InstancedBufferAttribute(seeds, 1));
    g.instanceCount = side * side;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    this.uniforms = {
      uHeight: { value: terrainData.heightTex },
      uRoadTex: { value: terrainData.roadTex },
      uNormTex: { value: terrainData.normalTex },
      uSplatTex: { value: terrainData.splatTex },
      uNoiseTex: { value: textures.noise },
      uGrassTex: { value: null },
      uCamXZ: { value: new THREE.Vector2() },
      uSide: { value: side },
      uSpacing: { value: spacing },
      uRadius: { value: radius },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, envMapIntensity: 0.7 });
    patch(mat, {
      uniforms: this.uniforms,
      vertexPars: /* glsl */`
        uniform highp sampler2D uHeight;
        uniform sampler2D uRoadTex, uNormTex, uSplatTex, uNoiseTex;
        uniform vec2 uCamXZ;
        uniform float uSide, uSpacing, uRadius;
        attribute float aI;
        varying vec2 vGUv;
        varying float vGShade;
        varying vec3 vGTint;
        float gh( ivec2 c ) { c = clamp( c, ivec2( 0 ), ivec2( ${N - 1} ) ); return texelFetch( uHeight, c, 0 ).r; }
        float hAt( vec2 w ) {
          vec2 g = w + ${HALF}.0; vec2 i = floor( g ), f = g - i; ivec2 c = ivec2( i );
          return mix( mix( gh( c ), gh( c + ivec2( 1, 0 ) ), f.x ), mix( gh( c + ivec2( 0, 1 ) ), gh( c + ivec2( 1, 1 ) ), f.x ), f.y );
        }
        float hash1( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * .1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }`,
      vertex: {
        '#include <begin_vertex>': /* glsl */`
          float ci = mod( aI, uSide ), cj = floor( aI / uSide );
          vec2 base = floor( uCamXZ / uSpacing ) * uSpacing;
          vec2 cell = base + ( vec2( ci, cj ) - uSide * 0.5 ) * uSpacing;
          vec2 jit = vec2( hash1( cell ), hash1( cell + 17.3 ) );
          vec2 wxz = cell + jit * uSpacing;
          vec2 tuv = ( wxz + ${HALF}.5 ) / ${N}.0;
          float rd = textureLod( uRoadTex, tuv, 0.0 ).r * 16.0;
          vec4 nt = textureLod( uNormTex, tuv, 0.0 );
          vec3 tn = vec3( nt.r * 2.0 - 1.0, 0.0, nt.g * 2.0 - 1.0 );
          tn.y = sqrt( max( 1.0 - dot( tn.xz, tn.xz ), 0.0 ) );
          vec4 sp = textureLod( uSplatTex, ( wxz + ${HALF}.0 ) / ${N}.0, 0.0 );
          float h = hAt( wxz );
          vec4 nz = textureLod( uNoiseTex, wxz / 61.0, 0.0 );
          float dens = smoothstep( 4.8, 6.5, rd ) * smoothstep( 0.8, 0.9, tn.y ) * ( 1.0 - smoothstep( 0.3, 0.7, sp.r ) * 0.75 )
                     * ( 1.0 - smoothstep( 0.1, 0.5, sp.g ) ) * smoothstep( ${WATER.toFixed(1)} + 0.4, ${WATER.toFixed(1)} + 0.9, h )
                     * smoothstep( 0.25, 0.45, nz.r + 0.2 );
          float d = distance( wxz, uCamXZ );
          float fade = 1.0 - smoothstep( uRadius * 0.6, uRadius * 0.95, d );
          float r = hash1( cell + 5.1 );
          float scale = ( 0.65 + 0.7 * r ) * step( hash1( cell + 9.7 ), dens ) * fade;
          float ang = hash1( cell + 2.2 ) * 6.2832;
          vec3 p = position * scale;
          p.xz = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) ) * p.xz;
          // wind bends the tips
          float top = uv.y;
          float gust = sin( uTime * 1.7 + dot( wxz, vec2( 0.21, 0.17 ) ) ) * 0.5 + sin( uTime * 3.1 + wxz.x * 0.7 ) * 0.25;
          p.xz += uWind * gust * top * top * 0.25 * scale;
          vec3 transformed = vec3( wxz.x, h - 0.03, wxz.y ) + p;
          vGUv = uv;
          vGShade = 0.55 + 0.45 * top;
          vGTint = mix( vec3( 0.85, 1.0, 0.8 ), vec3( 1.25, 1.1, 0.7 ), nz.g ) * ( 0.85 + 0.3 * r );`,
      },
      fragmentPars: 'uniform sampler2D uGrassTex; varying vec2 vGUv; varying float vGShade; varying vec3 vGTint;',
      fragment: {
        '#include <map_fragment>': /* glsl */`
          vec4 gt = texture2D( uGrassTex, vGUv );
          diffuseColor.rgb = gt.rgb * vGTint * vGShade;
          diffuseColor.a = gt.a;`,
        '#include <emissivemap_fragment>': /* glsl */`
          float through = pow( max( dot( normalize( vWorldPosG - cameraPosition ), uSunDir ), 0.0 ), 3.0 );
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * through * 0.25 * bakedSun();`,
      },
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.uniforms.uGrassTex.value = bakeTexture(renderer, /* glsl */`
      void main() {
        vec2 uv = vUv;
        float cov = 0.0, shade = 0.0, id = 0.0;
        for (int i = 0; i < 14; i++) {
          float fi = float(i);
          float x0 = 0.12 + 0.76 * h12(vec2(fi, 3.1));
          float lean = (h12(vec2(fi, 7.7)) - 0.5) * 0.5;
          float hgt = 0.55 + 0.45 * h12(vec2(fi, 1.9));
          float t = uv.y / hgt;
          if (t > 1.0) continue;
          float cx = x0 + lean * t * t;
          float w = 0.028 * (1.0 - t);
          float d = abs(uv.x - cx);
          float c = smoothstep(w, w * 0.4, d);
          if (c > cov) { cov = c; shade = t; id = h12(vec2(fi, 5.5)); }
        }
        vec3 col = mix(vec3(0.20, 0.30, 0.10), vec3(0.42, 0.52, 0.20), shade);
        col = mix(col, vec3(0.55, 0.52, 0.28), step(0.8, id) * shade);
        gl_FragColor = vec4(col, cov);
      }`, 256, { wrap: false });
  }

  update(camera) {
    this.uniforms.uCamXZ.value.set(camera.position.x, camera.position.z);
  }
}
