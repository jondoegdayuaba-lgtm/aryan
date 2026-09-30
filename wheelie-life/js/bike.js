// Loads the Blender-exported bike (assets/bike.json) into a three.js rig.
//   root  : ground contact, carries lateral position and lean
//   pivot : rear axle; pitching it lifts the front wheel
import * as THREE from 'three';

const f32 = (b64) => {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Float32Array(u.buffer);
};

export async function loadBike() {
  const data = window.__BIKE__ || await (await fetch('assets/bike.json')).json();
  const mats = {};
  for (const [name, m] of Object.entries(data.materials)) {
    const opt = { color: new THREE.Color().setRGB(...m.color, THREE.LinearSRGBColorSpace), metalness: m.metalness, roughness: m.roughness };
    if (m.alpha !== undefined) Object.assign(opt, { transparent: true, opacity: m.alpha, depthWrite: false });
    if (m.emissive) Object.assign(opt, { emissive: new THREE.Color().setRGB(...m.emissive, THREE.LinearSRGBColorSpace), emissiveIntensity: m.emissiveIntensity });
    mats[name] = m.clearcoat ? new THREE.MeshPhysicalMaterial({ ...opt, clearcoat: m.clearcoat, clearcoatRoughness: 0.04 }) : new THREE.MeshStandardMaterial(opt);
  }
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = 0.32; // rear axle height
  root.add(pivot);
  const groups = {};
  for (const p of data.parts) {
    const g = new THREE.Group();
    g.position.set(...p.pivot);
    for (const m of p.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(f32(m.position), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(f32(m.normal), 3));
      const mesh = new THREE.Mesh(geo, mats[m.material]);
      mesh.castShadow = m.material !== 'glass';
      mesh.renderOrder = m.material === 'glass' ? 2 : 0;
      g.add(mesh);
    }
    pivot.add(g);
    groups[p.name] = g;
  }
  return {
    root, pivot, wheelF: groups.wheelF, wheelR: groups.wheelR,
    spin(distance) { const a = distance / 0.32; groups.wheelF.rotation.x -= a; groups.wheelR.rotation.x -= a; },
  };
}
