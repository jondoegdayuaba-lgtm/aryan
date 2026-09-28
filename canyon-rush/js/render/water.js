// Oasis pond: a flat water surface that refracts the lake bed (read back from the
// scene render), gets murkier with depth, reflects the sky with Fresnel, glints
// in the sun and foams where it laps the shore.
import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vWorld;
  varying vec4 vClip;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    vClip = gl_Position;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tNoise;
  uniform samplerCube tSky;
  uniform vec2 uRes;
  uniform float uNear;
  uniform float uFar;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uRefract;
  varying vec3 vWorld;
  varying vec4 vClip;
  #include <fog_pars_fragment>

  float linearDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  vec2 slope(vec2 p) {
    float e = 0.004;
    float a = texture2D(tNoise, p).r;
    float b = texture2D(tNoise, p + vec2(e, 0.0)).r;
    float c = texture2D(tNoise, p + vec2(0.0, e)).r;
    return vec2(b - a, c - a) / e;
  }
  void main() {
    vec2 p = vWorld.xz;
    vec2 s = slope(p * 0.018 + uTime * vec2(0.006, 0.004)) * 0.0035
           + slope(p * 0.061 - uTime * vec2(0.011, -0.007)) * 0.0022
           + slope(p * 0.23 + uTime * vec2(-0.02, 0.03)) * 0.0009;
    vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
    vec3 V = normalize(cameraPosition - vWorld);
    vec2 uv = gl_FragCoord.xy / uRes;

    float sceneD = linearDepth(texture2D(tDepth, uv).r);
    float waterD = linearDepth(gl_FragCoord.z);
    float thick = max(sceneD - waterD, 0.0);
    // Refracted lake bed (only offset where the ground is actually behind the water).
    vec2 ruv = uv + N.xz * uRefract * clamp(thick * 0.5, 0.0, 1.0);
    float sceneD2 = linearDepth(texture2D(tDepth, ruv).r);
    if (sceneD2 < waterD) ruv = uv;
    vec3 below = texture2D(tScene, ruv).rgb;
    float depthM = thick * max(V.y, 0.15);
    vec3 absorb = exp(-depthM * vec3(0.9, 0.35, 0.28));
    vec3 deep = vec3(0.012, 0.045, 0.04) * (uSunCol * 0.08 + 0.4);
    vec3 refr = below * absorb + deep * (1.0 - absorb);

    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = textureCube(tSky, R).rgb;
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 col = mix(refr, sky, fres);
    // Sun glitter.
    vec3 H = normalize(uSunDir + V);
    col += uSunCol * pow(max(dot(N, H), 0.0), 700.0) * 30.0;
    // Foam where it meets the shore.
    float foam = (1.0 - smoothstep(0.0, 0.35, thick)) * smoothstep(0.35, 0.7, texture2D(tNoise, p * 0.4 + uTime * 0.02).b);
    col = mix(col, vec3(0.8, 0.78, 0.72) * (uSunCol * 0.05 + 0.5), foam * 0.6);
    // Soft edge against the shore.
    float a = smoothstep(0.0, 0.06, thick);
    gl_FragColor = vec4(mix(below, col, a), 1.0);
    #include <fog_fragment>
  }
`;

export class Water {
  constructor(scene, stage, atmo, tex) {
    const o = stage.oasis;
    const geo = new THREE.CircleGeometry(o.r * 1.9, 64);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = {
      tScene: { value: null },
      tDepth: { value: null },
      tNoise: { value: tex.noise },
      tSky: { value: atmo.cubeRT.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.2 },
      uFar: { value: 30000 },
      uTime: { value: 0 },
      uSunDir: { value: atmo.sunDir },
      uSunCol: { value: atmo.sunColor.clone().multiplyScalar(atmo.sunIntensity) },
      uRefract: { value: 0.035 },
      ...THREE.UniformsLib.fog,
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, fog: true });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(o.x, o.level, o.z);
    this.mesh.layers.set(1);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(dt, camera, post) {
    const U = this.uniforms;
    U.uTime.value += dt;
    U.tScene.value = post.hdr.texture;
    U.tDepth.value = post.depthTexture;
    U.uRes.value.set(post.width, post.height);
    U.uNear.value = camera.near;
    U.uFar.value = camera.far;
  }
}
