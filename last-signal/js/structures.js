// Places the Blender-made buildings and set pieces in the valley and reads what they carry:
// collision boxes (COL_*), anchors for fires, lights and pickups (ANCHOR_*, FIRE_*, LIGHT_*).
import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';
import { loadModel } from './models.js';
import { surfaceMaterial } from './textures.js';

const plain = {};
function specialMaterial(name) {
  if (plain[name]) return plain[name];
  let m = null;
  if (name === 'Glass') m = new THREE.MeshStandardMaterial({ color: 0xa8c8d8, transparent: true, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  else if (name === 'Rubber') m = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.95, vertexColors: true });
  else if (name === 'Rope') m = new THREE.MeshStandardMaterial({ color: 0x8a7654, roughness: 1, vertexColors: true });
  else if (name === 'Dark') m = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8, vertexColors: true });
  if (m) { m.name = name; patchMaterial(m, 'special-' + name, null); }
  return (plain[name] = m);
}

export class Structures {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'structures';
    this.colliders = [];        // oriented boxes: {x, z, y0, y1, hx, hz, cos, sin}
    this.anchors = {};          // name -> {pos: Vector3, extras}
    this.placed = {};
    this.shadows = true;
  }

  // Places a model. opts: { yaw, lift, align (0..1 tilt to the ground), dy }
  async place(id, file, x, z, { yaw = 0, lift = 0, align = 0, y = null, castShadow = true } = {}) {
    const scene = (await loadModel(file)).clone(true);
    const root = new THREE.Group();
    root.name = id;
    root.add(scene);
    const gy = y ?? this.world.heightAt(x, z);
    root.position.set(x, gy + lift, z);
    root.rotation.y = yaw;
    if (align > 0) {
      const n = this.world.normalAt(x, z, { x: 0, y: 1, z: 0 });
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z).lerp(new THREE.Vector3(0, 1, 0), 1 - align).normalize());
      root.quaternion.premultiply(q);
    }
    this.group.add(root);
    root.updateMatrixWorld(true);

    const anchors = {}, cols = [];
    const toRemove = [];
    scene.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const out = mats.map((m) => surfaceMaterial(m.name) || specialMaterial(m.name) || this._fallback(m));
        o.material = Array.isArray(o.material) ? out : out[0];
        o.castShadow = castShadow && this.shadows && out[0].name !== 'Glass';
        o.receiveShadow = true;
      }
      const n = o.name || '';
      if (n.startsWith('COL_')) {
        const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
        o.matrixWorld.decompose(wp, wq, ws);
        const e = new THREE.Euler().setFromQuaternion(wq, 'YXZ');
        const sc = o.userData.size || null;
        cols.push({ name: n.slice(4), x: wp.x, z: wp.z, y0: wp.y - Math.abs(ws.y) * 0.5, y1: wp.y + Math.abs(ws.y) * 0.5, hx: Math.abs(ws.x) * 0.5, hz: Math.abs(ws.z) * 0.5, cos: Math.cos(e.y), sin: Math.sin(e.y), id });
        toRemove.push(o);
      } else if (/^(ANCHOR|FIRE|LIGHT|SMOKE|SPOT|DOOR|SEAT)_?/.test(n)) {
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        anchors[n] = { pos: wp, extras: o.userData || {}, node: o };
      }
    });
    toRemove.forEach((o) => o.parent && o.parent.remove(o));
    this.colliders.push(...cols);
    this.anchors[id] = anchors;
    this.placed[id] = root;
    return { root, anchors, colliders: cols };
  }

  _fallback(m) {
    const c = m.clone();
    c.vertexColors = true;
    patchMaterial(c, 'fallback', null);
    return c;
  }

  setShadows(on) {
    this.shadows = on;
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = on && !(o.material && o.material.name === 'Glass'); });
  }
}
