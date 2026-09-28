// Bakes terrain lighting on the GPU once per time of day:
//   R = sun visibility (soft shadows cast by mesas, buttes and canyon walls)
//   G = sky visibility (how much open sky each spot sees; darkens canyon floors)
// The result feeds the terrain and every material that opts in with useTerrainLight.
import * as THREE from 'three';
import { terrainLightUniforms } from './shaderpatch.js';

function halfHeights(grid, step) {
  const n = Math.floor((grid.size - 1) / step) + 1;
  const data = new Uint16Array(n * n);
  const src = grid.data, gs = grid.size;
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < n; j++) {
    const row = j * step * gs;
    for (let i = 0; i < n; i++) data[j * n + i] = toHalf(src[row + i * step]);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return { tex: t, spec: new THREE.Vector3(grid.origin, grid.spacing * step, n) };
}

const VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D hN;
  uniform sampler2D hM;
  uniform sampler2D hF;
  uniform vec3 gN;
  uniform vec3 gM;
  uniform vec3 gF;
  uniform vec3 uOut;    // origin, spacing, size of the output grid
  uniform vec3 uSun;
  uniform float uMaxH;

  bool inside(vec3 g, vec2 p, float m) {
    float lo = g.x + m * g.y, hi = g.x + (g.z - 1.0 - m) * g.y;
    return p.x > lo && p.y > lo && p.x < hi && p.y < hi;
  }
  float H(vec2 p) {
    if (inside(gN, p, 1.0)) return texture2D(hN, ((p - gN.x) / gN.y + 0.5) / gN.z).r;
    if (inside(gM, p, 1.0)) return texture2D(hM, ((p - gM.x) / gM.y + 0.5) / gM.z).r;
    return texture2D(hF, ((p - gF.x) / gF.y + 0.5) / gF.z).r;
  }

  void main() {
    vec2 texel = floor(gl_FragCoord.xy);
    vec2 p = uOut.x + texel * uOut.y;
    float e = max(uOut.y, 1.0);
    float h = H(p);
    vec3 N = normalize(vec3(H(p - vec2(e, 0.0)) - H(p + vec2(e, 0.0)), 2.0 * e, H(p - vec2(0.0, e)) - H(p + vec2(0.0, e))));

    // Sun: march toward the sun, keeping the smallest clearance angle for a soft penumbra.
    vec3 ro = vec3(p.x, h, p.y) + N * (0.35 + 0.2 * e);
    float vis = 1.0;
    float t = 1.2 * e;
    for (int i = 0; i < 220; i++) {
      vec3 q = ro + uSun * t;
      if (q.y > uMaxH) break;
      float c = (q.y - H(q.xz)) / t;
      vis = min(vis, smoothstep(-0.004, 0.014, c));
      if (vis < 0.002) break;
      t += max(0.7 * e, t * 0.022);
      if (t > 9000.0) break;
    }
    vis *= smoothstep(-0.02, 0.06, dot(N, uSun));

    // Sky: horizon angle in 12 directions, relative to the local slope.
    float blocked = 0.0;
    for (int d = 0; d < 12; d++) {
      float a = (float(d) + 0.5) / 12.0 * 6.2831853;
      vec2 dir = vec2(cos(a), sin(a));
      float own = -(N.x * dir.x + N.z * dir.y) / N.y;
      float best = -10.0;
      float r = 1.5 * e;
      for (int s = 0; s < 14; s++) {
        best = max(best, (H(p + dir * r) - h) / r);
        r *= 1.62;
      }
      float elev = max(0.0, atan(best) - atan(own));
      float sn = sin(elev);
      blocked += sn * sn;
    }
    float sky = 1.0 - blocked / 12.0;
    gl_FragColor = vec4(vis, sky, 1.0, 1.0);
  }
`;

// Returns render targets for near / mid / far plus the uv transforms, and wires
// them into terrainLightUniforms. `onProgress(f)` reports 0..1. Spread over frames.
export async function bakeTerrainLight(renderer, world, sunDir, { nearStep = 2, onProgress } = {}) {
  const hN = halfHeights(world.near, 1);
  const hM = halfHeights(world.mid, 1);
  const hF = halfHeights(world.far, 1);
  let maxH = -Infinity;
  for (const g of [world.near, world.mid, world.far]) for (let i = 0; i < g.data.length; i += 7) maxH = Math.max(maxH, g.data[i]);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      hN: { value: hN.tex }, hM: { value: hM.tex }, hF: { value: hF.tex },
      gN: { value: hN.spec }, gM: { value: hM.spec }, gF: { value: hF.spec },
      uOut: { value: new THREE.Vector3() },
      uSun: { value: sunDir.clone() },
      uMaxH: { value: maxH + 5 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const tri = new THREE.Mesh(geo, mat);
  tri.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(tri);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const jobs = [
    { key: 'far', grid: world.far, step: 1 },
    { key: 'mid', grid: world.mid, step: 1 },
    { key: 'near', grid: world.near, step: nearStep },
  ];
  const out = {};
  const prevTarget = renderer.getRenderTarget();
  const totalRows = jobs.reduce((s, j) => s + Math.floor((j.grid.size - 1) / j.step) + 1, 0);
  let doneRows = 0;
  for (const job of jobs) {
    const size = Math.floor((job.grid.size - 1) / job.step) + 1;
    const spacing = job.grid.spacing * job.step;
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    mat.uniforms.uOut.value.set(job.grid.origin, spacing, size);
    const strip = Math.max(16, Math.floor(131072 / size));
    for (let y = 0; y < size; y += strip) {
      renderer.setRenderTarget(rt);
      rt.scissor.set(0, y, size, Math.min(strip, size - y));
      rt.scissorTest = true;
      renderer.render(scene, cam);
      doneRows += Math.min(strip, size - y);
      onProgress?.(doneRows / totalRows);
      await new Promise((r) => requestAnimationFrame(r));
    }
    rt.scissorTest = false;
    out[job.key] = { texture: rt.texture, target: rt, xf: new THREE.Vector2(1 / (spacing * size), (0.5 - job.grid.origin / spacing) / size) };
  }
  renderer.setRenderTarget(prevTarget);
  geo.dispose();
  mat.dispose();
  for (const h of [hN, hM, hF]) h.tex.dispose();

  const U = terrainLightUniforms;
  U.tlNear.value = out.near.texture; U.tlNearXf.value.copy(out.near.xf);
  U.tlMid.value = out.mid.texture; U.tlMidXf.value.copy(out.mid.xf);
  U.tlFar.value = out.far.texture; U.tlFarXf.value.copy(out.far.xf);
  return out;
}
