// Building blocks shared by the race-course props and the open-world props: glb part collection, instanced part sets,
// spawned static groups and the fluttering banner.
import * as THREE from 'three';

// -------------------------------------------------------------------------------- glb helpers
export function collectParts(gltf) {
  const map = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const [prop, mat] = o.name.split('__');
    if (!mat) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!map.has(prop)) map.set(prop, []);
    map.get(prop).push({ geometry, material: o.material, name: mat });
  });
  return map;
}

/** InstancedMesh set for one prop (one InstancedMesh per material). */
export class Inst {
  constructor(parts, capacity, { cast = true, receive = true, group }) {
    this.capacity = capacity;
    this.meshes = parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = cast;
      im.receiveShadow = receive;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im);
      return im;
    });
    this.count = 0;
  }

  set(i, matrix) {
    for (const im of this.meshes) im.setMatrixAt(i, matrix);
  }

  commit(count = this.count) {
    this.count = count;
    for (const im of this.meshes) {
      im.count = count;
      im.instanceMatrix.needsUpdate = true;
    }
  }
}

export function spawn(parts, { cast = true, receive = true } = {}) {
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    g.add(m);
  }
  return g;
}

/** A cloth strip between two posts that flutters in the wind. Textures are glTF style (v = 0 at the top). */
export class Banner {
  constructor(material, width, height, seed = 0) {
    const segs = Math.max(10, Math.round(width / 0.7));
    this.segs = segs;
    this.width = width;
    this.height = height;
    this.seed = seed;
    const n = (segs + 1) * 2;
    this.pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = [];
    const repeats = Math.max(1, Math.round(width / (height * 4)));
    for (let i = 0; i <= segs; i++) {
      const u = (i / segs) * repeats;
      uv.set([u, 0, u, 1], i * 4);
      if (i < segs) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.update(0);
  }

  update(time) {
    const { segs, width, height, seed, pos } = this;
    const nor = this.geometry.attributes.normal.array;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const edge = Math.sin(Math.PI * t);                                   // pinned at both posts
      const w = 0.16 * edge * Math.sin(t * 9.0 - time * 2.6 + seed) + 0.07 * edge * Math.sin(t * 17.0 - time * 4.3 + seed * 2);
      const sag = -0.35 * edge;
      for (let k = 0; k < 2; k++) {
        const j = (i * 2 + k) * 3;
        const hang = k === 0 ? 0 : -height;
        pos[j] = t * width;
        pos[j + 1] = sag * (k === 0 ? 1 : 0.6) + hang;
        pos[j + 2] = w * (k === 0 ? 0.5 : 1.0);
      }
      // normal from the ripple slope
      const dz = 0.16 * edge * 9.0 / width * Math.cos(t * 9.0 - time * 2.6 + seed);
      const l = Math.hypot(dz, 1);
      for (let k = 0; k < 2; k++) {
        const j = (i * 2 + k) * 3;
        nor[j] = -dz / l; nor[j + 1] = 0; nor[j + 2] = 1 / l;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
  }
}

