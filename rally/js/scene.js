// Assembles the rendered world: sky, sun, fog, terrain, lakes, forest, rocks
// and grass, with a shadow map that follows the car and baked shadows for
// hills and tree canopies further away.
import * as THREE from 'three';
import { N, HALF, WATER } from './gen.js';
import { G } from './shading.js';
import { bakeGroundTextures, bakeNoiseTexture } from './bake.js';
import { buildTerrainData, Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Rain } from './rain.js';
import { Forest } from './trees.js';
import { Rocks } from './rocks.js';
import { Grass } from './grass.js';

export class WorldView {
  constructor(renderer, world, quality) {
    this.renderer = renderer;
    this.world = world;
    this.quality = quality;
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(0xaabbcc, 0.001);

    this.textures = {
      ground: bakeGroundTextures(renderer, quality.textureSize),
      noise: bakeNoiseTexture(renderer, 256),
    };
    this.terrainData = buildTerrainData(world);
    this.terrain = new Terrain(this.terrainData, this.textures);
    scene.add(this.terrain.group);

    this.sky = new Sky(renderer, this.textures.noise);
    scene.add(this.sky.mesh);

    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 3));
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    this.shadowHalf = quality.shadowMap >= 4096 ? 55 : quality.shadowMap >= 2048 ? 45 : 35;
    const sc = sun.shadow.camera;
    sc.left = -this.shadowHalf; sc.right = this.shadowHalf; sc.top = this.shadowHalf; sc.bottom = -this.shadowHalf;
    sc.near = 1; sc.far = 800;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);

    this.water = new Water(renderer, world);
    scene.add(this.water.mesh);

    this.rain = new Rain(quality.grass > 20000 ? 7000 : quality.grass > 0 ? 5000 : 3000);
    scene.add(this.rain.mesh);

    this.forest = new Forest(renderer, world, {
      nearRange: quality.treeRange * 0.34, farRange: quality.treeRange,
      maxNear: quality.treeRange > 600 ? 3200 : 2000,
    });
    scene.add(this.forest.group);

    this.rocks = new Rocks(world, this.textures);
    scene.add(this.rocks.group);

    this.grass = quality.grass > 0 ? new Grass(renderer, this.terrainData, this.textures, quality.grass) : null;
    if (this.grass) scene.add(this.grass.mesh);

    this.bakeTex = null;
    this.focus = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
  }

  // Switch time of day: sky, lighting, fog and the baked shadows.
  setTime(preset) {
    this.preset = preset;
    this.lightDir.copy(this.sky.apply(preset, this.scene, this.sun));
    this._bakeShadows(this.lightDir);
    this.terrain.uniforms.uWet.value = preset.wet || 0;
    this.rain.amount = preset.rain || 0;
    this.rain.uniforms.uColor.value.set(preset.fogColor).lerp(new THREE.Color(1, 1, 1), 0.35);
  }

  // Terrain horizon shadows (ray-marched through the heightfield) and tree
  // canopy shadows (each crown's shadow smeared away from the sun).
  _bakeShadows(dir) {
    const world = this.world;
    const S = 1024, cell = N / S;
    const px = new Uint8Array(S * S * 4);
    const el = Math.asin(THREE.MathUtils.clamp(dir.y, 0.02, 1));
    const hx = dir.x, hz = dir.z, hl = Math.hypot(hx, hz) || 1;
    const sx = hx / hl, sz = hz / hl;
    const tanEl = Math.tan(el);
    // terrain: coarse march at 512 then upsample
    const T = 512, tc = N / T;
    const terr = new Float32Array(T * T);
    const maxH = 60;
    for (let j = 0; j < T; j++) {
      for (let i = 0; i < T; i++) {
        const x = -HALF + (i + 0.5) * tc, z = -HALF + (j + 0.5) * tc;
        const h0 = world.heightAt(x, z) + 0.5;
        let vis = 1;
        const step = 4;
        for (let k = 1; k < 120; k++) {
          const d = k * step;
          const rayH = h0 + d * tanEl;
          if (rayH > maxH) break;
          const th = world.heightAt(x + sx * d, z + sz * d);
          const clear = (rayH - th) / (d * 0.06 + 0.5);   // soft penumbra
          if (clear < vis) { vis = Math.max(0, clear); if (vis <= 0) break; }
        }
        terr[j * T + i] = vis;
      }
    }
    const canopy = new Float32Array(S * S);
    const len = Math.min(60, 9 / Math.max(tanEl, 0.08));
    for (const t of world.trees) {
      const h = 18 * t.scale;
      const off = Math.min(80, (h * 0.55) / Math.max(tanEl, 0.07));
      const cx = (t.x + sx * off + HALF) / cell, cz = (t.z + sz * off + HALF) / cell;
      const rad = 2.4 * t.scale / cell, L = (len * t.scale) / cell;
      const i0 = Math.floor(cx - L - rad), i1 = Math.ceil(cx + L + rad);
      const j0 = Math.floor(cz - L - rad), j1 = Math.ceil(cz + L + rad);
      for (let j = Math.max(0, j0); j <= Math.min(S - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(S - 1, i1); i++) {
          const dx = i - cx, dz = j - cz;
          const along = dx * sx + dz * sz, across = -dx * sz + dz * sx;
          const a = Math.max(0, Math.abs(along) - L) , d2 = (a * a + across * across) / (rad * rad);
          if (d2 < 1) canopy[j * S + i] += (1 - d2) * 0.45;
        }
      }
    }
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const k = j * S + i;
        const ti = Math.min(T - 1, (i * T / S) | 0), tj = Math.min(T - 1, (j * T / S) | 0);
        px[k * 4] = Math.round(THREE.MathUtils.clamp(terr[tj * T + ti], 0, 1) * 255);
        px[k * 4 + 1] = Math.round(THREE.MathUtils.clamp(1 - canopy[k] * 0.8, 0.12, 1) * 255);
        px[k * 4 + 3] = 255;
      }
    }
    if (this.bakeTex) this.bakeTex.dispose();
    const tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.bakeTex = tex;
    G.uBake.value = tex;
    G.uBakeOn.value = 1;
  }

  // Keep everything centred on the camera and the shadow map on the car.
  update(camera, focus, dt) {
    G.uTime.value += dt;
    this.sky.follow(camera);
    this.water.follow(camera);
    this.rain.update(camera, dt, this.cameraInside);
    this.terrain.update(camera);
    this.forest.update(camera);
    this.rocks.update(camera);
    if (this.grass) this.grass.update(camera);

    // shadow box centred a little ahead of the focus point, snapped to texels
    const sun = this.sun;
    const ahead = new THREE.Vector3();
    camera.getWorldDirection(ahead);
    ahead.y = 0;
    ahead.normalize().multiplyScalar(this.shadowHalf * 0.45);
    const c = this.focus.copy(focus).add(ahead);
    const texel = (this.shadowHalf * 2) / this.quality.shadowMap;
    const lightMat = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.lightDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightMat.clone().invert();
    const lc = c.clone().applyMatrix4(inv);
    lc.x = Math.round(lc.x / texel) * texel;
    lc.y = Math.round(lc.y / texel) * texel;
    c.copy(lc.applyMatrix4(lightMat));
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(this.lightDir, 300);
    sun.target.updateMatrixWorld();
    G.uBakeFade.value.set(c.x, c.z, this.shadowHalf * 0.8, this.shadowHalf * 1.0);
  }
}
