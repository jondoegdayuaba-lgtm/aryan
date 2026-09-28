// Global shader tweaks applied to every three.js material:
//  - Aerial perspective: distance haze that thickens near the ground and takes
//    its colour from the sky (warm toward the sun, cool away from it).
//  - Baked terrain lighting: materials that opt in (useTerrainLight) are shaded
//    by the canyon walls and mesas using the baked sun-visibility / sky-visibility
//    maps, so a truck driving into a canyon's shadow goes dark.
import * as THREE from 'three';

export const terrainLightUniforms = {
  tlNear: { value: null },
  tlMid: { value: null },
  tlFar: { value: null },
  tlNearXf: { value: new THREE.Vector2(0, 0) },
  tlMidXf: { value: new THREE.Vector2(0, 0) },
  tlFarXf: { value: new THREE.Vector2(0, 0) },
};

const original = {};
const KEEP = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment', 'lights_fragment_begin', 'lights_pars_begin', 'aomap_fragment'];

const v3 = (c) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;

// Installs the chunks. Call again (then flag materials for recompile) if the sky changes.
export function installShaderChunks(atmo, { hazeDensity = 0.00011, hazeFalloff = 0.0011 } = {}) {
  const C = THREE.ShaderChunk;
  for (const k of KEEP) if (!(k in original)) original[k] = C[k];

  const sun = atmo.sunDir;
  const hz = atmo.haze;
  const glow = atmo.sunColor.clone().multiplyScalar(6.0 * (0.35 + atmo.time.dust * 0.25));

  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogRel;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogRel = mvPosition.xyz * mat3( viewMatrix );
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vFogRel;
  const vec3 AP_SUN = vec3(${sun.x.toFixed(5)}, ${sun.y.toFixed(5)}, ${sun.z.toFixed(5)});
  const vec3 AP_GLOW = ${v3(glow)};
  const float AP_FALLOFF = ${hazeFalloff.toFixed(6)};
  vec3 apHazeColor(vec3 dir) {
    // Horizon colour by azimuth relative to the sun (8 samples around the horizon).
    float a = atan(dir.x, dir.z) - atan(AP_SUN.x, AP_SUN.z);
    float f = fract(a / 6.2831853) * 8.0;
    float t = fract(f);
    int i = int(f);
    vec3 H[9] = vec3[9](${hz.map(v3).join(', ')}, ${v3(hz[0])});
    vec3 c = mix(H[i], H[i + 1], t);
    return c + AP_GLOW * pow(max(dot(dir, AP_SUN), 0.0), 10.0);
  }
  vec3 applyAerialPerspective(vec3 col, vec3 rel) {
    float dist = length(rel);
    vec3 dir = rel / max(dist, 1e-3);
    float ro = max(cameraPosition.y + 20.0, 0.0);
    float t = dir.y * AP_FALLOFF;
    float optical = fogDensity * exp(-AP_FALLOFF * ro) * (abs(t) > 1e-6 ? (1.0 - exp(-dist * t)) / t : dist);
    vec3 ext = exp(-optical * vec3(0.75, 1.0, 1.35));
    return col * ext + apHazeColor(dir) * (1.0 - ext);
  }
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAerialPerspective( gl_FragColor.rgb, vFogRel );
#endif`;

  C.lights_pars_begin = original.lights_pars_begin + /* glsl */ `
#ifdef TERRAIN_LIGHT
  #ifndef TL_WORLDPOS
    #define TL_WORLDPOS ( cameraPosition + vFogRel )
  #endif
  uniform sampler2D tlNear;
  uniform sampler2D tlMid;
  uniform sampler2D tlFar;
  uniform vec2 tlNearXf;
  uniform vec2 tlMidXf;
  uniform vec2 tlFarXf;
  vec2 tlSample(sampler2D tex, vec2 xf, vec2 p, out float w) {
    vec2 uv = p * xf.x + xf.y;
    vec2 e = min(uv, 1.0 - uv);
    w = clamp(min(e.x, e.y) * 60.0, 0.0, 1.0);
    return texture2D(tex, uv).rg;
  }
  // x: sun visibility (terrain shadow), y: sky visibility (terrain ambient occlusion)
  vec2 terrainLight(vec3 p) {
    float wn, wm, wf;
    vec2 f = tlSample(tlFar, tlFarXf, p.xz, wf);
    vec2 m = tlSample(tlMid, tlMidXf, p.xz, wm);
    vec2 n = tlSample(tlNear, tlNearXf, p.xz, wn);
    vec2 v = mix(vec2(1.0), f, wf);
    v = mix(v, m, wm);
    return mix(v, n, wn);
  }
#endif`;

  C.lights_fragment_begin = /* glsl */ `
#ifdef TERRAIN_LIGHT
  vec2 tlLight = terrainLight( TL_WORLDPOS );
#endif
` + original.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n#ifdef TERRAIN_LIGHT\n\t\tdirectLight.color *= tlLight.x;\n#endif',
  );
  if (!C.lights_fragment_begin.includes('tlLight.x')) console.warn('Terrain light patch did not apply');

  C.aomap_fragment = original.aomap_fragment + /* glsl */ `
#ifdef TERRAIN_LIGHT
  reflectedLight.indirectDiffuse *= tlLight.y;
  reflectedLight.indirectSpecular *= mix( tlLight.y, 1.0, 0.2 ) * mix( 0.55, 1.0, tlLight.x );
#endif`;
}

// Opt a material in to baked terrain lighting. Returns the material.
// Programs are cached by onBeforeCompile's source text, and this wrapper's text is the
// same for every material, so the previous key is carried over to keep them distinct.
export function useTerrainLight(material) {
  material.defines = { ...(material.defines || {}), TERRAIN_LIGHT: '' };
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, terrainLightUniforms);
    prev?.call(material, shader, renderer);
  };
  material.customProgramCacheKey = () => prevKey + '|TL';
  return material;
}
