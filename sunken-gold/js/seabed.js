// The seabed: a height field from the Blender build, drawn as culled chunks
// with a material that blends four baked textures (sand, coral rubble, reef
// rock, silt) using the splat map, with triplanar rock on steep walls and the
// baked ambient occlusion on top.
import * as THREE from 'three';
import { patchMaterial } from './ocean.js';

export class Seabed {
  constructor(assets, quality) {
    const { world, heights, textures: T } = assets;
    this.size = world.size;
    this.n = world.n;
    this.cell = this.size / (this.n - 1);
    this.half = this.size / 2;
    const lo = world.height.min, span = world.height.max - world.height.min;
    this.h = new Float32Array(heights.length);
    for (let i = 0; i < heights.length; i++) this.h[i] = lo + (heights[i] / 65535) * span;
    this.group = new THREE.Group();
    this.material = this.makeMaterial(T, quality);
    this.buildChunks(quality === 'low' ? 2 : 1);
  }

  // Height at (x, z), matching the triangle split used by the mesh.
  heightAt(x, z) {
    const n = this.n;
    const fx = THREE.MathUtils.clamp((x + this.half) / this.cell, 0, n - 1.001);
    const fz = THREE.MathUtils.clamp((z + this.half) / this.cell, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h = this.h;
    const h00 = h[j * n + i], h10 = h[j * n + i + 1], h01 = h[(j + 1) * n + i], h11 = h[(j + 1) * n + i + 1];
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.8;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  buildChunks(stride) {
    const n = this.n, chunks = 8;
    const per = (n - 1) / chunks;                 // 64 cells per chunk
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const cells = per / stride;
        const verts = cells + 1;
        const pos = new Float32Array(verts * verts * 3);
        const nor = new Float32Array(verts * verts * 3);
        const v = new THREE.Vector3();
        for (let b = 0; b < verts; b++) {
          for (let a = 0; a < verts; a++) {
            const i = cx * per + a * stride, j = cz * per + b * stride;
            const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
            const k = (b * verts + a) * 3;
            pos[k] = x; pos[k + 1] = this.h[j * n + i]; pos[k + 2] = z;
            this.normalAt(x, z, v);
            nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
          }
        }
        const idx = [];
        for (let b = 0; b < cells; b++) {
          for (let a = 0; a < cells; a++) {
            const p = b * verts + a;
            idx.push(p, p + verts, p + 1, p + verts, p + verts + 1, p + 1);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
    }
  }

  // Hide chunks the fog swallows anyway.
  cull(cam, range) {
    for (const m of this.group.children) {
      const s = m.geometry.boundingSphere;
      m.visible = s.center.distanceTo(cam) - s.radius < range;
    }
  }

  makeMaterial(T, quality) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    const layers = ['sand', 'rubble', 'rock', 'silt'];
    const uniforms = {
      tSplat: { value: T.splat }, tAO: { value: T.ao },
      uMapSize: { value: this.size },
      uTiles: { value: new THREE.Vector4(1 / 3.0, 1 / 2.6, 1 / 4.5, 1 / 4.0) },
    };
    layers.forEach((l, i) => {
      uniforms[`tA${i}`] = { value: T[`${l}_albedo`] };
      uniforms[`tN${i}`] = { value: T[`${l}_normal`] };
    });
    const antiTile = quality !== 'low';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tSplat, tAO, tA0, tA1, tA2, tA3, tN0, tN1, tN2, tN3;
          uniform float uMapSize;
          uniform vec4 uTiles;
          float sbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float sbNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(sbHash(i), sbHash(i + vec2(1, 0)), f.x), mix(sbHash(i + vec2(0, 1)), sbHash(i + 1.0), f.x), f.y);
          }
          // Two samples at unrelated scales, mixed by large-scale noise, hide tiling.
          vec4 sbTex(sampler2D t, vec2 p, float m) {
            ${antiTile ? 'return mix(texture2D(t, p), texture2D(t, p * 0.29 + vec2(0.37, 0.71)), m);' : 'return texture2D(t, p);'}
          }`)
        .replace('#include <map_fragment>', `
          vec2 sbUV = (vSgWorld.xz + uMapSize * 0.5) / uMapSize;
          vec4 sbW = texture2D(tSplat, sbUV);
          sbW /= max(sbW.r + sbW.g + sbW.b + sbW.a, 1e-3);
          float sbM = smoothstep(0.3, 0.7, sbNoise(vSgWorld.xz * 0.045));
          vec3 sbNw = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
          vec3 sbBlend = pow(abs(sbNw), vec3(4.0)); sbBlend /= dot(sbBlend, vec3(1.0));
          vec2 pS = vSgWorld.xz * uTiles.x, pR = vSgWorld.xz * uTiles.y, pT = vSgWorld.xz * uTiles.w;
          vec3 sbCol = sbTex(tA0, pS, sbM).rgb * sbW.r + sbTex(tA1, pR, sbM).rgb * sbW.g + sbTex(tA3, pT, sbM).rgb * sbW.a;
          vec3 rk = texture2D(tA2, vSgWorld.zy * uTiles.z).rgb * sbBlend.x
                  + sbTex(tA2, vSgWorld.xz * uTiles.z, sbM).rgb * sbBlend.y
                  + texture2D(tA2, vSgWorld.xy * uTiles.z).rgb * sbBlend.z;
          sbCol += rk * sbW.b;
          // Gentle large-scale tint variation so the sand isn't one flat colour.
          sbCol *= 0.88 + 0.24 * sbNoise(vSgWorld.xz * 0.012 + 3.0);
          float sbAO = texture2D(tAO, sbUV).r;
          diffuseColor.rgb *= sbCol * mix(1.0, sbAO, 0.9);`)
        .replace('#include <normal_fragment_maps>', `{
          vec3 Nw = sbNw;
          vec3 nS = sbTex(tN0, pS, sbM).xyz * 2.0 - 1.0;
          vec3 nR = sbTex(tN1, pR, sbM).xyz * 2.0 - 1.0;
          vec3 nT = sbTex(tN3, pT, sbM).xyz * 2.0 - 1.0;
          vec3 tn = nS * sbW.r + nR * sbW.g + nT * sbW.a;
          vec3 planar = normalize(vec3(tn.x + Nw.x, abs(tn.z) * Nw.y, tn.y + Nw.z));
          vec3 tX = texture2D(tN2, vSgWorld.zy * uTiles.z).xyz * 2.0 - 1.0;
          vec3 tY = sbTex(tN2, vSgWorld.xz * uTiles.z, sbM).xyz * 2.0 - 1.0;
          vec3 tZ = texture2D(tN2, vSgWorld.xy * uTiles.z).xyz * 2.0 - 1.0;
          tX = vec3(tX.xy + Nw.zy, abs(tX.z) * Nw.x);
          tY = vec3(tY.xy + Nw.xz, abs(tY.z) * Nw.y);
          tZ = vec3(tZ.xy + Nw.xy, abs(tZ.z) * Nw.z);
          vec3 rockN = normalize(tX.zyx * sbBlend.x + tY.xzy * sbBlend.y + tZ.xyz * sbBlend.z);
          vec3 Nf = normalize(planar * (1.0 - sbW.b) + rockN * sbW.b);
          normal = normalize((viewMatrix * vec4(Nf, 0.0)).xyz);
        }`);
    };
    patchMaterial(mat);
    mat.customProgramCacheKey = () => 'seabed' + quality;
    return mat;
  }
}
