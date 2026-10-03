// Places the Blender-built buildings, props, trees and rocks from world.json.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { meshParts, bakedGeometry } from './assets.js';

const TREE_RADIUS = {
  Pine1: 0.35, Pine2: 0.3, Pine3: 0.4, Oak1: 0.45, Oak2: 0.4, DeadTree: 0.3,
  Rock1: 1.2, Rock3: 2.4, Boulder: 4.6, RockSlab: 2.6, FallenLog: 0,
};
const TREE_HEIGHT = {
  Pine1: 13, Pine2: 9, Pine3: 18, Oak1: 9, Oak2: 7, DeadTree: 7, Rock1: 0.9, Rock3: 1.8, Boulder: 3.4, RockSlab: 1.6,
};
// Small things fade out early; trees switch to a cheap stand-in far away.
const NEAR_ONLY = { Bush1: 240, Bush2: 200, Sage: 200, Rock2: 140, Tobacco: 170, Tobacco2: 170, FallenLog: 220, Grass1: 60 };
const LOD_MODELS = new Set(['Pine1', 'Pine2', 'Pine3', 'Oak1', 'Oak2']);

export class World {
  constructor(scene, assets, terrain, collision) {
    this.scene = scene;
    this.assets = assets;
    this.terrain = terrain;
    this.collision = collision;
    this.data = assets.world;
    this.tagged = {};
    this.chunks = [];
    this.lodDist = 260;
    this.placeStatics();
    this.placeVegetation();
    this.addMountains();
  }

  node(name) {
    return this.assets.props.scene.getObjectByName(name);
  }

  // Buildings and props never move, so their meshes are baked into a few big
  // meshes per material and area: far fewer draw calls than one per object.
  placeStatics() {
    const batches = new Map();
    const m4 = new THREE.Matrix4();
    const add = (p, isBuilding) => {
      const src = this.node(p.model);
      if (!src) return;
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
        new THREE.Vector3(1, 1, 1));
      const area = Math.floor(p.x / 200) + ',' + Math.floor(p.z / 200);
      for (const part of meshParts(src)) {
        const key = area + '|' + part.material.uuid;
        let b = batches.get(key);
        if (!b) batches.set(key, (b = { material: part.material, geos: [] }));
        b.geos.push(part.geometry.applyMatrix4(m4));
      }
      this.collision.addPlaced(this.data.models[p.model], p, p.tag || p.model);
      if (p.tag) this.tagged[p.tag] = { place: p };
      if (!isBuilding && p.model === 'Campfire') (this.campfires ||= []).push(p);
    };
    for (const b of this.data.buildings) add(b, true);
    for (const p of this.data.props) add(p, false);
    for (const { material, geos } of batches.values()) {
      const merged = mergeGeometries(geos.map(clean), false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
  }

  placeVegetation() {
    const CH = 400;
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const leafy = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const lodGeo = {
      pine: pineLod(), oak: oakLod(),
    };
    const lodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    for (const [model, list] of Object.entries(this.data.instances)) {
      const src = this.node(model);
      if (!src) continue;
      // Each plant/rock model becomes one vertex-coloured geometry: one draw per chunk
      const parts = [{ geometry: bakedGeometry(meshParts(src)), material: model.startsWith('Tobacco') ? leafy : solid }];
      const buckets = new Map();
      for (const [x, y, z, yaw, sc] of list) {
        const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = []));
        b.push([x, y, z, yaw, sc]);
        const r = TREE_RADIUS[model];
        if (r) this.collision.addCircle(x, z, r * sc, y - 1, y + (TREE_HEIGHT[model] || 2) * sc, 'tree');
      }
      for (const [key, items] of buckets) {
        const [ci, cj] = key.split(',').map(Number);
        const center = new THREE.Vector3((ci + 0.5) * CH, 0, (cj + 0.5) * CH);
        const near = parts.map((part) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, items.length);
          items.forEach(([x, y, z, yaw, sc], i) => {
            q.setFromAxisAngle(up, yaw);
            s.set(sc, sc, sc);
            p.set(x, y, z);
            im.setMatrixAt(i, m4.compose(p, q, s));
          });
          im.castShadow = !model.startsWith('Tobacco');
          im.receiveShadow = true;
          im.computeBoundingSphere();
          this.scene.add(im);
          return im;
        });
        let far = null;
        if (LOD_MODELS.has(model)) {
          const g = model.startsWith('Pine') ? lodGeo.pine : lodGeo.oak;
          const hs = { Pine1: 13, Pine2: 9, Pine3: 18, Oak1: 9, Oak2: 7 }[model];
          far = new THREE.InstancedMesh(g, lodMat, items.length);
          items.forEach(([x, y, z, yaw, sc], i) => {
            q.setFromAxisAngle(up, yaw);
            const k = model.startsWith('Pine') ? hs / 13 : hs / 9;
            s.set(sc * (model === 'Pine3' ? k * 0.8 : k), sc * k, sc * (model === 'Pine3' ? k * 0.8 : k));
            p.set(x, y, z);
            far.setMatrixAt(i, m4.compose(p, q, s));
          });
          far.castShadow = false;
          far.computeBoundingSphere();
          far.visible = false;
          this.scene.add(far);
        }
        this.chunks.push({ model, center, near, far, limit: NEAR_ONLY[model] });
      }
    }
  }

  addMountains() {
    const m = this.assets.mountains.scene;
    m.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.receiveShadow = false;
        o.material.fog = true;
      }
    });
    this.scene.add(m);
  }

  // Swap detailed and stand-in trees by distance; hide small plants far away.
  updateLod(camPos) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camPos.x, c.center.z - camPos.z) - 181;
      if (c.limit) {
        const vis = d < c.limit;
        for (const m of c.near) m.visible = vis;
      } else if (c.far) {
        const near = d < this.lodDist;
        for (const m of c.near) m.visible = near;
        c.far.visible = !near;
      }
    }
  }
}

// Same attribute set everywhere so geometries can be merged
function clean(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

function coloredCone(r, h, y, seg, color, jag = 0) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, false);
  g.translate(0, y + h / 2, 0);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.toNonIndexed();
}

function merge(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function pineLod() {
  return merge([
    coloredCone(0.25, 4, -0.3, 5, '#2e241c'),
    coloredCone(2.9, 5.2, 1.5, 7, '#1d2a1a'),
    coloredCone(2.2, 4.6, 4.6, 7, '#223020'),
    coloredCone(1.4, 4.4, 7.6, 7, '#26341f'),
  ]);
}

function oakLod() {
  const trunk = coloredCone(0.4, 4.5, -0.3, 5, '#3a2c20');
  const crown = new THREE.IcosahedronGeometry(3.6, 0);
  crown.scale(1, 0.72, 1);
  crown.translate(0, 6.3, 0);
  const n = crown.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color('#3f5522');
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  crown.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merge([trunk, crown]);
}
