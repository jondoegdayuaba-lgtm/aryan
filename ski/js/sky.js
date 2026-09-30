// Sky dome + image based lighting. Uses the Blender-rendered HDR panoramas when present
// and a procedural Rayleigh-style gradient sky otherwise (also used for lighting fallback).
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
	gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uSunDir;
uniform float uSunDisc;
void main() {
	vec3 d = normalize( vDir );
	float h = clamp( d.y, -0.2, 1.0 );
	vec3 zenith = vec3( 0.075, 0.24, 0.62 );
	vec3 mid = vec3( 0.28, 0.5, 0.86 );
	vec3 horizon = vec3( 0.82, 0.9, 1.0 );
	vec3 col = mix( horizon, mid, pow( clamp( h * 1.6, 0.0, 1.0 ), 0.55 ) );
	col = mix( col, zenith, pow( clamp( h, 0.0, 1.0 ), 0.9 ) );
	float sd = max( dot( d, uSunDir ), 0.0 );
	col += vec3( 1.0, 0.85, 0.65 ) * ( pow( sd, 8.0 ) * 0.25 + pow( sd, 96.0 ) * 0.6 );
	col += uSunDisc * vec3( 1.0, 0.92, 0.8 ) * 60.0 * smoothstep( 0.99985, 0.99992, sd );
	col = mix( col, vec3( 0.9, 0.94, 1.0 ) * 0.9, smoothstep( 0.0, -0.2, d.y ) );
	gl_FragColor = vec4( col, 1.0 );
}`;

export function createProceduralSky(sunDir, withSun = true) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { uSunDir: { value: new THREE.Vector3(...sunDir).normalize() }, uSunDisc: { value: withSun ? 1 : 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/**
 * Builds scene.background / scene.environment.
 *   assets.sky      equirect HDR with sun disc + distant peaks (Blender)
 *   assets.skyIbl   equirect HDR without the sun, used for lighting (Blender)
 * Returns { background: Object3D|null, envMap: Texture, dispose }.
 */
export function setupSky(renderer, scene, assets, sunDir, opts = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envTex;
  let bgMesh = null;
  const iblSrc = assets.skyIbl || assets.sky;
  if (iblSrc) {
    envTex = pmrem.fromEquirectangular(iblSrc).texture;
  } else {
    const s = new THREE.Scene();
    s.add(createProceduralSky(sunDir, false));
    envTex = pmrem.fromScene(s, 0.02, 0.1, 10).texture;
    s.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
  }
  scene.environment = envTex;
  scene.environmentIntensity = opts.envIntensity ?? 1.0;
  if (assets.sky) {
    scene.background = assets.sky;
    scene.backgroundIntensity = opts.backgroundIntensity ?? 1.0;
    scene.backgroundRotation.set(0, opts.backgroundRotation ?? 0, 0);
  } else {
    bgMesh = createProceduralSky(sunDir, true);
    scene.add(bgMesh);
  }
  pmrem.dispose();
  return { background: bgMesh, envMap: envTex };
}
