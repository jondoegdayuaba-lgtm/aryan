// Shader plumbing shared by every material in the scene:
//   * installFog():        height + sun aware aerial perspective replacing three's fog chunks
//   * WorldLight:          baked terrain light map (sun visibility, ambient occlusion) sampled by world XZ
//   * applyWorldLight():   makes any MeshStandard/Physical material honour that light map
import * as THREE from 'three';

/** Uniforms shared by all patched materials (values are updated by the game each frame). */
export const WorldLight = {
  tex: { value: null },                                   // R terrain-only sun vis, G full sun vis, B AO
  rect: { value: new THREE.Vector4(0, 0, 1, 1) },        // x0, z0, extentX, extentZ
  blend: { value: new THREE.Vector4(140, 230, 0, 0) },   // dynamic -> baked distance blend (near, far)
  aoStrength: { value: 1.0 },
  useTex: { value: 0.0 },
};

const _white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
_white.needsUpdate = true;
WorldLight.tex.value = _white;

export function setWorldLightTexture(tex, world) {
  WorldLight.tex.value = tex || _white;
  WorldLight.useTex.value = tex ? 1 : 0;
  WorldLight.rect.value.set(world.x0, world.z0, world.x1 - world.x0, world.z1 - world.z0);
}

// --------------------------------------------------------------------------- fog
export function installFog({ density = 0.00028, heightFalloff = 1 / 650, refHeight = 1380, sunDir, sunColor }) {
  const sd = sunDir;
  const f3 = (v) => v.toFixed(6);
  const consts = `
#define FOG_DENSITY ${f3(density)}
#define FOG_FALLOFF ${f3(heightFalloff)}
#define FOG_REF_H ${refHeight.toFixed(1)}
#define FOG_SUN_DIR vec3(${f3(sd[0])}, ${f3(sd[1])}, ${f3(sd[2])})
#define FOG_SUN_COLOR vec3(${f3(sunColor[0])}, ${f3(sunColor[1])}, ${f3(sunColor[2])})
`;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogRay;
#endif
`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogRay = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogRay;
	${consts}
#endif
`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
	{
		float fdist = length( vFogRay );
		vec3 frd = vFogRay / max( fdist, 1e-4 );
		float fh0 = cameraPosition.y - FOG_REF_H;
		float fdy = vFogRay.y;
		float fk = FOG_FALLOFF;
		float fint = abs( fdy ) > 0.05 ? ( 1.0 - exp( - fk * fdy ) ) / ( fk * fdy ) : 1.0;
		float optical = FOG_DENSITY * exp( - fk * fh0 ) * fint * fdist;
		float fogFactor = 1.0 - exp( - optical );
		float sunAmt = pow( saturate( dot( frd, FOG_SUN_DIR ) ), 5.0 );
		vec3 fc = mix( fogColor, FOG_SUN_COLOR, sunAmt * 0.55 );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fc, fogFactor );
	}
#endif
`;
}

// ------------------------------------------------------------------- light chunk
const WL_PARS = /* glsl */`
uniform sampler2D uLightTex;
uniform vec4 uWorldRect;
uniform vec4 uWLBlend;
uniform float uWLUse;
varying vec3 vWLPos;
float gWLVis = 1.0;
float WL_SUN( float dyn ) {
	float vis = dyn;
	if ( uWLUse > 0.5 ) {
		vec2 uv = ( vWLPos.xz - uWorldRect.xy ) / uWorldRect.zw;
		vec3 lm = texture2D( uLightTex, uv ).rgb;
		#ifdef WL_TERRAIN
			float dist = length( vViewPosition );
			float blend = smoothstep( uWLBlend.x, uWLBlend.y, dist );
			vis = mix( min( dyn, lm.r ), lm.g, blend );
		#else
			vis = dyn * lm.r;
		#endif
	}
	gWLVis = vis;
	return vis;
}
`;

let _patchedLightChunk = null;

export function patchedLightsChunk() {
  if (_patchedLightChunk) return _patchedLightChunk;
  let src = THREE.ShaderChunk.lights_fragment_begin;
  const before = src;
  src = src.replace(
    /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getSunShadow\(([^;]*?)\) : 1\.0;/,
    'directLight.color *= WL_SUN( ( directLight.visible && receiveShadow ) ? getSunShadow($1) : 1.0 );');
  src = src.replace(
    /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap([^;]*?)\) : 1\.0;/,
    'directLight.color *= WL_SUN( ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap$1) : 1.0 );');
  if (src === before) console.warn('[shader-patches] sun shadow hook not applied - baked terrain shadows disabled');
  _patchedLightChunk = src;
  return src;
}

/** Add the vertex varying + uniforms + light chunk replacement to a shader (used by materials). */
export function injectWorldLight(shader, { terrain = false } = {}) {
  shader.uniforms.uLightTex = WorldLight.tex;
  shader.uniforms.uWorldRect = WorldLight.rect;
  shader.uniforms.uWLBlend = WorldLight.blend;
  shader.uniforms.uWLUse = WorldLight.useTex;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec3 vWLPos;\nvoid main() {')
    .replace('#include <fog_vertex>', `#include <fog_vertex>
	{
		vec4 wlp = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
			wlp = instanceMatrix * wlp;
		#endif
		vWLPos = ( modelMatrix * wlp ).xyz;
	}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${terrain ? '#define WL_TERRAIN\n' : ''}${WL_PARS}\nvoid main() {`)
    .replace('#include <lights_fragment_begin>', patchedLightsChunk());
}

/** Make a MeshStandard/Physical material honour the baked terrain light map. */
export function applyWorldLight(material, extra) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    injectWorldLight(shader);
    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => 'wl' + (extra ? extra.name : '');
  return material;
}
