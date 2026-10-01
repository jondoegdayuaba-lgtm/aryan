// Instanced grass that follows the camera: a fixed patch of blades wrapped around the view,
// placed on the terrain and thinned out by the grass map, swaying in the wind.
import * as THREE from 'three';
import { shared } from './materials.js';

const PATCH = 72; // metres covered by the grass field around the camera

export function createGrass(terrain, density = 1) {
  if (density <= 0) return null;
  const count = Math.floor(90000 * density);
  // one blade: a bent strip of 3 segments (7 verts)
  const blade = new THREE.BufferGeometry();
  const pos = [], uv = [];
  const segs = 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.03 * (1 - t * 0.85);
    pos.push(-w, t, 0, w, t, 0);
    uv.push(0, t, 1, t);
  }
  const idx = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  blade.setIndex(idx);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  geo.attributes.uv = blade.attributes.uv;
  const offsets = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    offsets[i * 4] = Math.random() * PATCH;
    offsets[i * 4 + 1] = Math.random() * PATCH;
    offsets[i * 4 + 2] = Math.random() * Math.PI * 2; // yaw
    offsets[i * 4 + 3] = 0.14 + Math.random() * Math.random() * 0.3;  // height
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
  geo.instanceCount = count;

  // grass density texture from the terrain's grass map
  const R = 512;
  const dens = new Uint8Array(R * R);
  for (let i = 0; i < R * R; i++) dens[i] = Math.min(255, terrain.grassMap[i] * 255);
  const densTex = new THREE.DataTexture(dens, R, R, THREE.RedFormat);
  densTex.magFilter = THREE.LinearFilter;
  densTex.minFilter = THREE.LinearFilter;
  densTex.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
  const uniforms = {
    tHeight: { value: terrain.heightTex },
    tDens: { value: densTex },
    uN: { value: terrain.n }, uHalf: { value: terrain.half }, uRes: { value: terrain.res },
    uMapSize: { value: terrain.size },
    uCam: { value: new THREE.Vector3() },
    uPatch: { value: PATCH },
    uTime: shared.uTime, uWind: shared.uWind,
    uBase: { value: new THREE.Color('#3f7a2e') }, uTip: { value: new THREE.Color('#a9cf5a') },
    tGrass: { value: null },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aOffset;
        uniform sampler2D tHeight, tDens;
        uniform float uN, uHalf, uRes, uMapSize, uPatch, uTime;
        uniform vec3 uCam;
        uniform vec2 uWind;
        varying float vT;
        varying float vShade;
        varying vec2 vWorldXZ;
        float hAt(vec2 xz) {
          vec2 f = clamp((xz + uHalf) / uRes, vec2(0.0), vec2(uN - 1.001));
          ivec2 i = ivec2(floor(f));
          vec2 t = fract(f);
          float a = texelFetch(tHeight, i, 0).r, b = texelFetch(tHeight, i + ivec2(1, 0), 0).r;
          float c = texelFetch(tHeight, i + ivec2(0, 1), 0).r, d = texelFetch(tHeight, i + ivec2(1, 1), 0).r;
          return (t.x + t.y <= 1.0) ? a + (b - a) * t.x + (c - a) * t.y : d + (c - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
        }`)
      .replace('#include <beginnormal_vertex>', `
        // wrap the patch around the camera
        vec2 base = uCam.xz - uPatch * 0.5;
        vec2 p = base + mod(aOffset.xy - base, uPatch);
        float dens = texture2D(tDens, p / uMapSize + 0.5).r;
        float d = length(p - uCam.xz);
        float fade = smoothstep(uPatch * 0.5, uPatch * 0.33, d);
        float keep = step(fract(aOffset.x * 13.7 + aOffset.y * 7.3), dens);
        float hgt = aOffset.w * mix(0.6, 1.0, dens) * fade * keep;
        vT = position.y;
        float s = sin(aOffset.z), c = cos(aOffset.z);
        vec3 grassPos = vec3(position.x * c, position.y * hgt, position.x * s);
        // bend: wind and a natural curl
        float ph = p.x * 0.21 + p.y * 0.17;
        float sway = sin(uTime * 1.8 + ph) * 0.5 + sin(uTime * 3.1 + ph * 1.9) * 0.2;
        vec2 bend = (uWind * (0.35 + sway * 0.45) + vec2(s, c) * 0.25) * position.y * position.y * hgt;
        grassPos.xz += bend;
        grassPos.y -= dot(bend, bend) * 0.3;
        grassPos += vec3(p.x, hAt(p) - 0.03, p.y);
        vec3 objectNormal = normalize(vec3(-s * 0.3 + bend.x, 1.0, c * 0.3 + bend.y));
        vShade = fract(aOffset.x * 3.1 + aOffset.y * 1.7);
        vWorldXZ = p;`)
      .replace('#include <begin_vertex>', `vec3 transformed = grassPos;`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', `vec4 worldPosition = vec4(transformed, 1.0);`)
      .replace('#include <defaultnormal_vertex>', `
        vec3 transformedNormal = normalMatrix * objectNormal;
        #ifdef FLIP_SIDED
          transformedNormal = - transformedNormal;
        #endif`)
      .replace('#include <shadowmap_vertex>', `#include <shadowmap_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uBase, uTip;
        varying float vT;
        varying float vShade;
        varying vec2 vWorldXZ;`)
      .replace('#include <map_fragment>', `
        vec3 gc = mix(uBase, uTip, pow(vT, 1.3));
        gc *= 0.85 + vShade * 0.3;
        // big soft patches: lush dark green here, sun-dried yellow-green there
        float pn = sin(vWorldXZ.x * 0.045) * sin(vWorldXZ.y * 0.039) + 0.5 * sin(vWorldXZ.x * 0.11 + vWorldXZ.y * 0.083);
        gc = mix(gc, gc * vec3(0.72, 0.95, 0.7), smoothstep(0.2, 0.9, pn));
        gc = mix(gc, gc * vec3(1.3, 1.15, 0.62), smoothstep(-0.25, -0.95, pn));
        // a few wildflowers
        if (vShade > 0.972 && vT > 0.72) {
          float k = fract(vShade * 917.3);
          gc = k < 0.4 ? vec3(1.0, 0.95, 0.9) : k < 0.7 ? vec3(1.0, 0.82, 0.2) : vec3(0.72, 0.45, 1.0);
        }
        diffuseColor.rgb *= gc;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.45, 1.0, vT);
        reflectedLight.directDiffuse *= mix(0.6, 1.0, vT);`);
  };
  mat.customProgramCacheKey = () => 'grass-v2';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.update = (cam) => { uniforms.uCam.value.copy(cam); };
  mesh.userData.uniforms = uniforms;
  return mesh;
}
