// Lakes: one big sheet at the water level. Shallow water shows the lake bed,
// deep water turns dark peaty green, and the surface reflects the sky with
// proper Fresnel and a sharp sun glint.
import * as THREE from 'three';
import { N, HALF, WATER } from './gen.js';
import { patch, G } from './shading.js';
import { bakeTexture } from './bake.js';

export class Water {
  constructor(renderer, world) {
    // Water depth at 2 m resolution (0..8 m).
    const SN = N / 2;
    const px = new Uint8Array(SN * SN * 4);
    for (let j = 0; j < SN; j++) {
      for (let i = 0; i < SN; i++) {
        const h = world.heightAt(-HALF + (i + 0.5) * 2, -HALF + (j + 0.5) * 2);
        const k = (j * SN + i) * 4;
        px[k] = Math.round(Math.min(1, Math.max(0, (WATER - h) / 8)) * 255);
        px[k + 3] = 255;
      }
    }
    this.depthTex = new THREE.DataTexture(px, SN, SN, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.depthTex.minFilter = this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.needsUpdate = true;

    // Tiling ripple normals.
    this.normalTex = bakeTexture(renderer, /* glsl */`
      float Hw( vec2 uv ) { return fbm( uv, 5., 4 ) + 0.4 * fbm( uv + 0.37, 13., 3 ); }
      void main() {
        float e = 1. / 256.;
        float hx = Hw( vUv + vec2( e, 0. ) ) - Hw( vUv - vec2( e, 0. ) );
        float hy = Hw( vUv + vec2( 0., e ) ) - Hw( vUv - vec2( 0., e ) );
        vec3 n = normalize( vec3( -hx * 6., 1., -hy * 6. ) );
        gl_FragColor = vec4( n.x * .5 + .5, n.z * .5 + .5, Hw( vUv ) * .5 + .5, 1. );
      }`, 256, { srgb: false });

    this.uniforms = {
      uDepth: { value: this.depthTex },
      uWaterN: { value: this.normalTex },
      uWave: { value: 0.22 },
      uShallow: { value: new THREE.Color('#5b6a52') },
      uDeep: { value: new THREE.Color('#0b1512') },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, premultipliedAlpha: true });
    patch(mat, {
      uniforms: this.uniforms,
      fragmentPars: /* glsl */`
        uniform sampler2D uDepth;
        uniform sampler2D uWaterN;
        uniform float uWave;
        uniform vec3 uShallow, uDeep;
        float waterAlpha;
        vec3 waterN;`,
      fragment: {
        '#include <map_fragment>': /* glsl */`
          vec2 wxz = vWorldPosG.xz;
          float depth = texture2D( uDepth, ( wxz + ${HALF}.0 ) / ${N}.0 ).r * 8.0;
          if ( abs( wxz.x ) > ${HALF - 2}.0 || abs( wxz.y ) > ${HALF - 2}.0 ) depth = 8.0;
          float camDist = length( vWorldPosG - cameraPosition );
          vec2 uv1 = wxz / 21.0 + uTime * vec2( 0.021, 0.013 );
          vec2 uv2 = wxz / 7.7 + uTime * vec2( -0.017, 0.024 );
          vec2 uv3 = wxz / 61.0 + uTime * vec2( 0.006, -0.009 );
          vec2 w = ( texture2D( uWaterN, uv1 ).rg + texture2D( uWaterN, uv2 ).rg * 0.6 + texture2D( uWaterN, uv3 ).rg * 0.8 - 1.2 );
          float strength = uWave * mix( 1.0, 0.25, smoothstep( 20.0, 400.0, camDist ) );
          waterN = normalize( vec3( w.x * strength, 1.0, w.y * strength ) );
          waterAlpha = clamp( 1.0 - exp( -depth * 1.4 ), 0.0, 1.0 );
          waterAlpha = mix( waterAlpha, 1.0, smoothstep( 60.0, 300.0, camDist ) );
          float foam = smoothstep( 0.12, 0.0, depth ) * smoothstep( 0.35, 0.7, texture2D( uWaterN, wxz / 3.1 + uTime * 0.05 ).b );
          diffuseColor.rgb = mix( uShallow, uDeep, smoothstep( 0.0, 2.5, depth ) ) + foam * 0.5;
          waterAlpha = max( waterAlpha, foam * 0.8 );`,
        '#include <normal_fragment_begin>': /* glsl */`
          float faceDirection = 1.0;
          vec3 normal = normalize( ( viewMatrix * vec4( waterN, 0.0 ) ).xyz );
          vec3 nonPerturbedNormal = normal;`,
        '#include <normal_fragment_maps>': '',
        // Reflections stay at full strength however clear the water is.
        '#include <opaque_fragment>': 'gl_FragColor = vec4( totalDiffuse * waterAlpha + totalSpecular + totalEmissiveRadiance * waterAlpha, waterAlpha );',
        '#include <fog_fragment>': /* glsl */`
          #ifdef USE_FOG
            vec3 fogged = applyFog( gl_FragColor.rgb / max( gl_FragColor.a, 1e-3 ), vFogOffset );
            gl_FragColor.rgb = fogged * gl_FragColor.a;
          #endif`,
        '#include <premultiplied_alpha_fragment>': '',
      },
    });
    this.material = mat;
    const geo = new THREE.PlaneGeometry(14000, 14000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  follow(camera) {
    this.mesh.position.x = Math.round(camera.position.x);
    this.mesh.position.z = Math.round(camera.position.z);
  }
}
