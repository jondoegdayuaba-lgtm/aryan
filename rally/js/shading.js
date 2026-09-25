// Shared shader plumbing: every material in the scene is patched through
// `patch()`, which wires in the global uniforms (sun, fog, wind, baked shadows)
// and lets each material swap three.js shader chunks for its own code.
import * as THREE from 'three';

// Uniforms shared by every patched material; update the values, never replace the objects.
export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.5).normalize() },
  uSunCol: { value: new THREE.Color(1, 1, 1) },                // sun colour × intensity
  uFogSun: { value: new THREE.Color(1, 0.9, 0.7) },     // fog colour looking toward the sun
  uFogFalloff: { value: 0.02 },                          // height fog falloff per metre
  uFogBase: { value: 0 },                                // height where fog density is fogDensity
  uFogHaze: { value: 0.00012 },                          // extra thin haze that ignores height
  uWind: { value: new THREE.Vector2(0.6, 0.3) },
  uBake: { value: null },                                // baked terrain + canopy shadows
  uBakeOn: { value: 0 },
  uBakeFade: { value: new THREE.Vector4(0, 0, 70, 110) }, // xz = shadow-map centre, z/w = fade radii
};

// Height fog with a warm glow toward the sun. Replaces three's fog chunks for
// all materials; world offsets are recovered from view space.
THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogOffset;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogOffset = mvPosition.xyz * mat3( viewMatrix );
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  #ifndef RR_COMMON
  uniform vec3 uSunDir;
  #endif
  uniform vec3 uFogSun;
  uniform float uFogFalloff;
  uniform float uFogBase;
  uniform float uFogHaze;
  varying vec3 vFogOffset;
  vec3 applyFog( vec3 col, vec3 offset ) {
    float dist = length( offset );
    vec3 dir = offset / max( dist, 1e-4 );
    float b = max( uFogFalloff, 1e-4 );
    float camY = cameraPosition.y - uFogBase;
    float dy = offset.y;
    float integ = abs( dy ) > 0.01 ? ( 1.0 - exp( -b * dy ) ) / ( b * dy ) : 1.0;
    float tau = fogDensity * exp( -b * camY ) * dist * integ + uFogHaze * dist;
    float f = 1.0 - exp( -max( tau, 0.0 ) );
    float sunAmt = pow( max( dot( dir, uSunDir ), 0.0 ), 10.0 ) * 0.85;
    vec3 fc = mix( fogColor, uFogSun, sunAmt );
    return mix( col, fc, f );
  }
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = applyFog( gl_FragColor.rgb, vFogOffset );
#endif`;

// Declared once for every patched shader, vertex and fragment.
const COMMON = /* glsl */`
#define RR_COMMON
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uSunDir;
uniform vec3 uSunCol;`;

// World position varying for every lit material (baked shadows need it).
const WORLD_VARYING_VS = /* glsl */`
varying vec3 vWorldPosG;`;
const WORLD_VARYING_SET = /* glsl */`
vWorldPosG = ( mvPosition.xyz * mat3( viewMatrix ) ) + cameraPosition;`;

// Baked sun shadow for anything lit by the directional light: terrain
// self-shadowing everywhere, tree canopy shadows beyond the shadow map.
const BAKE_FS = /* glsl */`
uniform sampler2D uBake;
uniform float uBakeOn;
uniform vec4 uBakeFade;
varying vec3 vWorldPosG;
float bakedSun() {
  if ( uBakeOn < 0.5 ) return 1.0;
  vec2 uv = ( vWorldPosG.xz + 1024.0 ) / 2048.0;
  vec2 b = texture2D( uBake, uv ).rg;
  float far = smoothstep( uBakeFade.z, uBakeFade.w, length( vWorldPosG.xz - uBakeFade.xy ) );
  return b.r * mix( 1.0, b.g, far );
}`;

/**
 * Patch a built-in material.
 *  opts.uniforms            extra uniforms (merged with the globals)
 *  opts.vertexPars / fragmentPars   code added before main()
 *  opts.vertex / fragment   { '#include <chunk>': 'replacement', ... }; use '$&' to keep the original
 *  opts.defines
 */
export function patch(material, opts = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, G, opts.uniforms || {});
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>\n${COMMON}`);
    fs = fs.replace('#include <common>', `#include <common>\n${COMMON}`);
    const lit = fs.includes('#include <lights_fragment_begin>');
    if (lit) {
      vs = vs.replace('#include <common>', `#include <common>\n${WORLD_VARYING_VS}`);
      vs = vs.replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYING_SET}`);
      fs = fs.replace('#include <common>', `#include <common>\n${BAKE_FS}`);
      // Dim the sun (first directional light) by the baked shadows.
      fs = fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tif ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= bakedSun();',
      ));
    }
    if (opts.vertexPars) vs = vs.replace('#include <common>', `#include <common>\n${opts.vertexPars}`);
    if (opts.fragmentPars) fs = fs.replace('#include <common>', `#include <common>\n${opts.fragmentPars}`);
    for (const [k, v] of Object.entries(opts.vertex || {})) {
      if (!vs.includes(k)) console.warn('patch: vertex chunk not found', k);
      vs = vs.replace(k, v.replace(/\$&/g, k));
    }
    for (const [k, v] of Object.entries(opts.fragment || {})) {
      if (!fs.includes(k)) console.warn('patch: fragment chunk not found', k);
      fs = fs.replace(k, v.replace(/\$&/g, k));
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (prev) prev(shader, renderer);
    material.userData.shader = shader;
  };
  if (opts.defines) material.defines = { ...(material.defines || {}), ...opts.defines };
  // Different patches must not share a compiled program.
  const src = JSON.stringify([opts.vertex, opts.fragment, opts.vertexPars, opts.fragmentPars, opts.defines]);
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (Math.imul(h, 31) + src.charCodeAt(i)) | 0;
  material.customProgramCacheKey = () => 'rr' + h;
  return material;
}
