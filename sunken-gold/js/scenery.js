// Puts the Blender models into the world: materials by name, instanced reef
// scenery split into culled chunks, the wreck, the arch, debris, the dive boat
// and its anchor line. Registers solid models with the collision system.
import * as THREE from 'three';
import { patchMaterial, U } from './ocean.js';

const UP = new THREE.Vector3(0, 1, 0);
const CHUNK = 64;
const VERTEX_COLORED = new Set(['coral', 'sponge', 'barrelsponge', 'fanstalk', 'turtle', 'clam', 'mantle', 'terracotta', 'rope', 'boat', 'flag']);

// Give every Blender material its game look, once.
export function prepareMaterials(models, T) {
  const seen = new Set();
  const tri = triplanar(T);
  for (const root of Object.values(models)) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        tune(m, T, tri);
      }
    });
  }
}

function tune(m, T, tri) {
  const name = m.name;
  m.envMapIntensity = 1.0;
  const opts = {};
  switch (name) {
    case 'rock':
      tri(m, T.rock_albedo, T.rock_normal, 1 / 3.5);
      m.roughness = 0.9;
      break;
    case 'brain':
      tri(m, T.brain_albedo, T.brain_normal, 1 / 0.9);
      m.roughness = 0.8;
      break;
    case 'wood':
      m.map = T.wood_albedo;
      m.normalMap = T.wood_normal;
      m.normalScale.set(1.2, 1.2);
      m.color.set(0xffffff);
      m.roughness = 0.9;
      break;
    case 'fan':
      m.map = T.fan;
      m.alphaTest = 0.45;
      m.side = THREE.DoubleSide;
      m.color.set(0xffffff);
      m.roughness = 0.85;
      opts.sway = { amp: 0.06, freq: 0.9, height: 1.2 };
      break;
    case 'kelp':
      m.side = THREE.DoubleSide;
      m.roughness = 0.55;
      m.color.set(0xffffff);
      opts.sway = { amp: 1.4, freq: 0.45, height: 14 };
      break;
    case 'seagrass':
      m.side = THREE.DoubleSide;
      m.color.set(0xffffff);
      opts.sway = { amp: 0.12, freq: 0.9, height: 0.7 };
      break;
    case 'anemone':
      m.color.set(0xffffff);
      m.roughness = 0.5;
      opts.sway = { amp: 0.05, freq: 1.4, height: 0.3 };
      break;
    case 'gold':
      // Water strips the red out of gold, so it gets a warm glow to stay golden at depth.
      m.color.set('#ffcf5a');
      m.metalness = 1;
      m.roughness = 0.22;
      m.envMapIntensity = 1.6;
      m.emissive.set('#7a4a00');
      m.emissiveIntensity = 0.55;
      break;
    case 'brass':
      m.metalness = 1;
      m.roughness = 0.35;
      m.envMapIntensity = 1.4;
      m.emissive.set('#5a3a08');
      m.emissiveIntensity = 0.5;
      break;
    case 'gem': case 'emerald': case 'sapphire':
      m.roughness = 0.05;
      m.metalness = 0.1;
      m.emissive.copy(m.color).multiplyScalar(0.35);
      m.envMapIntensity = 2;
      break;
    case 'pearl':
      m.roughness = 0.12;
      m.emissive.set('#4a4a46');
      m.envMapIntensity = 2;
      break;
    case 'jelly': case 'jellyarm':
      m.transparent = true;
      m.opacity = name === 'jelly' ? 0.42 : 0.55;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      m.emissiveIntensity = 1.6;
      opts.pulse = true;
      break;
    case 'glass':
      m.transparent = true;
      m.opacity = 0.35;
      break;
    case 'lamp':
      m.emissiveIntensity = 3;
      break;
    case 'screen':
      m.emissiveIntensity = 1.2;
      break;
    case 'fish': case 'fin':
      m.side = THREE.DoubleSide;
      m.roughness = name === 'fish' ? 0.35 : 0.5;
      m.color.set(0xffffff);
      break;
    case 'shark':
      m.side = THREE.DoubleSide;
      m.color.set(0xffffff);
      m.roughness = 0.5;
      break;
    case 'ray':
      m.side = THREE.DoubleSide;
      m.color.set(0xffffff);
      break;
    default:
      // These models carry their colour in vertex colours; the rest keep their base colour.
      if (VERTEX_COLORED.has(name)) m.color.set(0xffffff);
  }
  // Animated creature materials are patched per use (they need their own options).
  if (!['fish', 'fin', 'shark', 'ray'].includes(name)) patchMaterial(m, opts);
}

// Triplanar texturing for models without UVs (rocks, brain coral).
function triplanar() {
  return (m, albedo, normal, tile) => {
    m.color.set(0xffffff);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      shader.uniforms.tTriA = { value: albedo };
      shader.uniforms.tTriN = { value: normal };
      shader.uniforms.uTriTile = { value: tile };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriP; varying vec3 vTriN; varying vec3 vTriM0, vTriM1, vTriM2;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vTriP = position; vTriN = normal;
          mat3 trM = normalMatrix;
          #ifdef USE_INSTANCING
            trM = normalMatrix * mat3(instanceMatrix);
          #endif
          vTriM0 = trM[0]; vTriM1 = trM[1]; vTriM2 = trM[2];`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tTriA, tTriN; uniform float uTriTile; varying vec3 vTriP; varying vec3 vTriN; varying vec3 vTriM0, vTriM1, vTriM2;`)
        .replace('#include <map_fragment>', `
          vec3 trN = normalize(vTriN);
          vec3 trB = pow(abs(trN), vec3(4.0)); trB /= dot(trB, vec3(1.0));
          vec3 trP = vTriP * uTriTile;
          diffuseColor.rgb *= texture2D(tTriA, trP.zy).rgb * trB.x + texture2D(tTriA, trP.xz).rgb * trB.y + texture2D(tTriA, trP.xy).rgb * trB.z;`)
        .replace('#include <normal_fragment_maps>', `{
          vec3 tX = texture2D(tTriN, trP.zy).xyz * 2.0 - 1.0;
          vec3 tY = texture2D(tTriN, trP.xz).xyz * 2.0 - 1.0;
          vec3 tZ = texture2D(tTriN, trP.xy).xyz * 2.0 - 1.0;
          tX = vec3(tX.xy + trN.zy, abs(tX.z) * trN.x);
          tY = vec3(tY.xy + trN.xz, abs(tY.z) * trN.y);
          tZ = vec3(tZ.xy + trN.xy, abs(tZ.z) * trN.z);
          vec3 nl = normalize(tX.zyx * trB.x + tY.xzy * trB.y + tZ.xyz * trB.z);
          // Local -> view through the model (and instance) rotation from the vertex stage.
          normal = normalize(mat3(vTriM0, vTriM1, vTriM2) * nl);
        }`);
      prev?.call(m, shader, r);
    };
  };
}

// ------------------------------------------------------------------ instancing

function meshesOf(root) {
  const out = [];
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  root.traverse((o) => {
    if (o.isMesh) out.push({ geometry: o.geometry, material: o.material, local: inv.clone().multiply(o.matrixWorld) });
  });
  return out;
}

export class InstancedScenery {
  constructor(scene) {
    this.scene = scene;
    this.chunks = [];          // { mesh, center, radius }
  }

  // matrices: array of Matrix4 (instance transforms). Splits them into chunks.
  add(root, matrices, { shadow = true, extra, range = Infinity } = {}) {
    const parts = meshesOf(root);
    const buckets = new Map();
    matrices.forEach((m, i) => {
      const k = `${Math.floor(m.elements[12] / CHUNK)},${Math.floor(m.elements[14] / CHUNK)}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    });
    const tmp = new THREE.Matrix4();
    for (const ids of buckets.values()) {
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, ids.length);
        ids.forEach((id, j) => im.setMatrixAt(j, tmp.multiplyMatrices(matrices[id], p.local)));
        if (extra) extra(im, ids);
        im.castShadow = shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        this.scene.add(im);
        this.chunks.push({ mesh: im, center: im.boundingSphere.center, radius: im.boundingSphere.radius, range });
      }
    }
  }

  cull(cam, range) {
    for (const c of this.chunks) c.mesh.visible = c.center.distanceTo(cam) - c.radius < Math.min(range, c.range);
  }
}

// ------------------------------------------------------------------ world

export function buildScenery(scene, assets, seabed, colliders, quality = 'high') {
  const { world, models } = assets;
  const inst = new InstancedScenery(scene);
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), n = new THREE.Vector3();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();

  function placement(x, z, yaw, s, { tilt = 0.4, sink = 0.05 } = {}) {
    seabed.normalAt(x, z, n);
    q.setFromUnitVectors(UP, n.lerp(UP, 1 - tilt).normalize());
    qy.setFromAxisAngle(UP, yaw);
    q.multiply(qy);
    pos.set(x, seabed.heightAt(x, z) - sink * s, z);
    return new THREE.Matrix4().compose(pos, q, scl.setScalar(s));
  }

  const S = world.scenery;
  const groups = {
    // range: how far away (m) a chunk of these is still drawn. thin: share kept on low quality.
    brain: { models: ['brain_0', 'brain_1'], tilt: 0.3, sink: 0.12, collide: true, range: 95 },
    branch: { models: ['branch_0', 'branch_1', 'branch_2'], tilt: 0.3, sink: 0.05, range: 80, thin: 0.5 },
    table: { models: ['table_0', 'table_1'], tilt: 0.2, sink: 0.05, collide: true, range: 95 },
    fan: { models: ['fan_0', 'fan_1'], tilt: 0.2, sink: 0.05, shadow: false, range: 80 },
    tube: { models: ['tube_0', 'tube_1'], tilt: 0.5, sink: 0.05, range: 80, thin: 0.6 },
    barrel: { models: ['barrel_0'], tilt: 0.3, sink: 0.06, collide: true, range: 95 },
    anemone: { models: ['anemone_0'], tilt: 0.6, sink: 0.04, shadow: false, range: 50 },
    grass: { models: ['grass_0', 'grass_1'], tilt: 0.7, sink: 0.02, shadow: false, range: 55, thin: 0.45 },
    kelp: { models: ['kelp_0', 'kelp_1'], tilt: 0.0, sink: 0.02, range: 125 },
    boulder: { models: ['boulder_0', 'boulder_1', 'boulder_2', 'boulder_3'], tilt: 0.6, sink: 0.22, collide: true, range: 125 },
  };
  const solids = [];
  for (const [key, g] of Object.entries(groups)) {
    const perModel = g.models.map(() => []);
    (S[key] || []).forEach(([x, z, yaw, s, v], n) => {
      const m = placement(x, z, yaw, s, g);
      if (g.collide) solids.push([g.models[v % g.models.length], m]);
      // Low quality draws a thinner reef (the colliders above stay the same).
      if (quality === 'low' && g.thin && (n * 0.618034) % 1 > g.thin) return;
      perModel[v % g.models.length].push(m);
    });
    g.models.forEach((name, i) => {
      if (models[name] && perModel[i].length) inst.add(models[name], perModel[i], { shadow: g.shadow !== false && !(quality === 'low' && key === 'branch'), range: g.range });
    });
  }
  const holder = new THREE.Object3D();
  for (const [name, m] of solids) {
    holder.matrix.copy(m);
    holder.matrixWorld.copy(m);
    holder.matrixAutoUpdate = false;
    colliders.add(name, holder);
  }

  // The wreck.
  const statics = [];
  const wreck = models.wreck.clone();
  wreck.position.fromArray(world.wreck.pos);
  wreck.quaternion.fromArray(world.wreck.quat);
  scene.add(wreck);
  colliders.add('wreck', wreck);
  statics.push(wreck);

  const arch = models.arch.clone();
  arch.position.fromArray(world.arch.pos);
  arch.rotation.y = world.arch.yaw;
  scene.add(arch);
  colliders.add('arch', arch);
  statics.push(arch);

  for (const d of world.debris) {
    const o = models[d.model].clone();
    const y = seabed.heightAt(d.x, d.z);
    o.position.set(d.x, y, d.z);
    o.rotation.set(0, d.yaw, 0);
    if (d.model === 'barrel') {
      o.rotation.set(0, d.yaw, Math.PI / 2, 'YXZ');
      o.position.y = y + 0.24;
    } else if (d.model === 'anchor') {
      o.rotation.set(0, d.yaw, Math.PI / 2 - 0.25, 'YXZ');
      o.position.y = y + 0.1;
    } else if (d.model === 'cannon') {
      o.rotation.set(0.12, d.yaw, 0.18, 'YXZ');
      o.position.y = y - 0.15;
    } else {
      o.position.y = y - 0.1;
    }
    scene.add(o);
    colliders.add(d.model, o);
    statics.push(o);
  }

  // Dive boat at the surface, with its anchor line down to the reef.
  const boat = models.boat.clone();
  boat.position.fromArray(world.boat);
  boat.rotation.y = 0.4;
  scene.add(boat);
  colliders.add('boat', boat);
  const bow = new THREE.Vector3(0, 0.6, -6.2).applyMatrix4(boat.matrixWorld.clone().compose(boat.position, boat.quaternion, new THREE.Vector3(1, 1, 1)));
  const anchorAt = new THREE.Vector3().fromArray(world.anchor);
  const mid = bow.clone().lerp(anchorAt, 0.5);
  mid.x += 1.5;
  mid.y -= 1.0;
  const curve = new THREE.CatmullRomCurve3([bow, bow.clone().lerp(mid, 0.5).add(new THREE.Vector3(0.6, -0.4, 0)), mid, anchorAt]);
  const ropeMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#cbbf96', roughness: 0.95 }));
  const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.025, 6), ropeMat);
  rope.castShadow = true;
  scene.add(rope);
  const anc = models.anchor.clone();
  anc.scale.setScalar(0.22);
  anc.position.copy(anchorAt).add(new THREE.Vector3(0, -0.1, 0));
  anc.rotation.set(0.2, 0.7, 1.2);
  scene.add(anc);

  return { inst, wreck, arch, boat, statics };
}

export { U };
