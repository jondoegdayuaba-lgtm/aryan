// Sea and lake surface: depth-tinted, fresnel sky reflection, sun glints and shore foam.
import * as THREE from 'three';

const VS = /* glsl */`
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float w = sin(wp.x * 0.045 + uTime * 0.9) * 0.5 + sin(wp.z * 0.06 - uTime * 0.7) * 0.5
          + sin((wp.x + wp.z) * 0.11 + uTime * 1.3) * 0.25;
  wp.y += w * 0.09;
  vPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tHeight;
uniform sampler2D tNormal;
uniform float uN, uHalf, uRes, uTime;
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uShallow, uDeep, uFoam;
varying vec3 vPos;

float terrainH(vec2 xz) {
  vec2 f = (xz + uHalf) / uRes;
  f = clamp(f, vec2(0.0), vec2(uN - 1.001));
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  float a = texelFetch(tHeight, i, 0).r;
  float b = texelFetch(tHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(tHeight, i + ivec2(0, 1), 0).r;
  float d = texelFetch(tHeight, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

void main() {
  float depth = max(0.0, vPos.y - terrainH(vPos.xz));
  vec2 uv = vPos.xz;
  vec3 n1 = texture2D(tNormal, uv * 0.031 + uTime * vec2(0.006, 0.004)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, uv * 0.083 - uTime * vec2(0.009, -0.011)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tNormal, uv * 0.009 + uTime * vec2(-0.002, 0.003)).xyz * 2.0 - 1.0;
  vec2 slope = n1.xy * 0.5 + n2.xy * 0.35 + n3.xy * 0.4;
  float dist = length(cameraPosition - vPos);
  slope *= mix(1.0, 0.35, smoothstep(40.0, 400.0, dist));
  vec3 N = normalize(vec3(slope.x, 1.0, -slope.y));
  vec3 V = normalize(cameraPosition - vPos);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float sd = max(dot(R, uSunDir), 0.0);
  sky += uSunColor * pow(sd, 6.0) * 0.2;
  // body colour
  float d01 = smoothstep(0.0, 7.0, depth);
  vec3 body = mix(uShallow, uDeep, d01);
  float sunDiff = max(uSunDir.y, 0.0) * 0.6 + 0.4;
  body *= sunDiff;
  // subsurface-ish glow on wave faces toward the sun
  body += uShallow * 0.25 * pow(max(dot(V, -uSunDir), 0.0), 3.0) * (1.0 - d01);
  vec3 col = mix(body, sky, fres);
  // sun glint
  vec3 Hh = normalize(uSunDir + V);
  float spec = pow(max(dot(N, Hh), 0.0), 420.0) * 6.0 + pow(max(dot(N, Hh), 0.0), 60.0) * 0.18;
  col += uSunColor * spec;
  // shore foam
  float foamN = texture2D(tNormal, uv * 0.2 + vec2(uTime * 0.02, 0.0)).b;
  float wave = sin(depth * 5.0 - uTime * 1.6 + foamN * 4.0) * 0.5 + 0.5;
  float foam = smoothstep(0.9, 0.0, depth) * (0.55 + 0.45 * wave);
  foam *= smoothstep(0.25, 0.7, foamN + 0.2);
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
  float alpha = mix(0.55, 0.97, smoothstep(0.0, 2.5, depth));
  alpha = max(alpha, fres);
  alpha = max(alpha, foam * 0.9);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWater(terrain, normalTex, renderer) {
  const t = renderer.time;
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.colorSpace = THREE.NoColorSpace;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tHeight: { value: terrain.heightTex },
    tNormal: { value: normalTex },
    uN: { value: terrain.n },
    uHalf: { value: terrain.half },
    uRes: { value: terrain.res },
    uTime: { value: 0 },
    uSunDir: { value: renderer.sunDir.clone() },
    uSunColor: { value: new THREE.Color(t.sun) },
    uZenith: { value: new THREE.Color(t.zenith) },
    uHorizon: { value: new THREE.Color(t.horizon) },
    uShallow: { value: new THREE.Color('#3fc1c9') },
    uDeep: { value: new THREE.Color('#0f4d7a') },
    uFoam: { value: new THREE.Color('#f4fbff') },
  }]);
  uniforms.tHeight.value = terrain.heightTex;
  uniforms.tNormal.value = normalTex;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, uniforms, transparent: true, fog: true, depthWrite: false,
  });
  // dense near the island, the rest of the sea is a coarse ring out to the horizon
  const geo = new THREE.PlaneGeometry(1200, 1200, 150, 150);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  const far = new THREE.Mesh(new THREE.RingGeometry(590, 5000, 64, 2).rotateX(-Math.PI / 2), mat);
  far.renderOrder = 5;
  const group = new THREE.Group();
  group.add(mesh, far);
  group.userData.update = (time, rend) => {
    uniforms.uTime.value = time;
    uniforms.uSunDir.value.copy(rend.sunDir);
  };
  group.userData.setTime = (tt) => {
    uniforms.uSunColor.value.set(tt.sun);
    uniforms.uZenith.value.set(tt.zenith);
    uniforms.uHorizon.value.set(tt.horizon);
  };
  return group;
}
