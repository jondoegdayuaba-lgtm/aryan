// The car: a chunky low-poly open-wheeler built from lofted sections and boxes.
// The model faces +z with +x on its left; its origin is where it meets the road.
import * as THREE from 'three';

const WHEEL_R = 0.46;
export const WHEELS = [
  { x: 0.98, z: 1.35, front: true },
  { x: -0.98, z: 1.35, front: true },
  { x: 1.0, z: -1.3, front: false },
  { x: -1.0, z: -1.3, front: false },
];

// A closed hull through cross-sections { z, w (half width), y0, y1, c (chamfer) }.
function loft(sections) {
  const ring = ({ z, w, y0, y1, c }) => [[w, y0], [w, y1 - c], [w - c, y1], [-w + c, y1], [-w, y1 - c], [-w, y0]].map(([x, y]) => [x, y, z]);
  const pos = [];
  const tri = (a, b, c, out) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) [b, c] = [c, b];
    pos.push(...a, ...b, ...c);
  };
  const rings = sections.map(ring);
  for (let s = 0; s < rings.length - 1; s++) {
    const A = rings[s], B = rings[s + 1];
    const midY = (sections[s].y0 + sections[s].y1) / 2;
    for (let j = 0; j < 6; j++) {
      const j2 = (j + 1) % 6;
      const cx = (A[j][0] + A[j2][0]) / 2, cy = (A[j][1] + A[j2][1]) / 2 - midY;
      const out = [cx, cy, 0];
      tri(A[j], A[j2], B[j2], out);
      tri(A[j], B[j2], B[j], out);
    }
  }
  for (const [r, dir] of [[rings[0], 1], [rings[rings.length - 1], -1]]) {
    for (let j = 1; j < 5; j++) tri(r[0], r[j], r[j + 1], [0, 0, dir * (sections[0].z > sections[1].z ? 1 : -1)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export class CarModel {
  constructor(paint) {
    const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    this.paintMat = lambert(paint.body);
    this.stripeMat = lambert(paint.stripe);
    const carbon = lambert('#23262e'), tyre = lambert('#1b1d22'), rim = lambert('#c9ccd6');
    const helmet = lambert('#f4f4f6'), visor = lambert('#18203a'), chrome = lambert('#9aa0ab');

    const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flames = [];
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // leans and pitches inside root
    this.root.add(this.body);
    const add = (geo, mat, parent = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    const hull = [
      { z: 2.25, w: 0.28, y0: 0.36, y1: 0.52, c: 0.08 },
      { z: 1.6, w: 0.42, y0: 0.32, y1: 0.66, c: 0.12 },
      { z: 0.8, w: 0.55, y0: 0.3, y1: 0.82, c: 0.16 },
      { z: 0.1, w: 0.62, y0: 0.3, y1: 0.9, c: 0.18 },
      { z: -0.9, w: 0.62, y0: 0.3, y1: 0.86, c: 0.18 },
      { z: -1.7, w: 0.45, y0: 0.34, y1: 0.7, c: 0.14 },
      { z: -2.0, w: 0.34, y0: 0.38, y1: 0.6, c: 0.1 },
    ];
    add(loft(hull), this.paintMat);
    // Racing stripe down the middle of the nose and deck.
    add(loft(hull.slice(0, 6).map((s) => ({ z: s.z, w: 0.17, y0: s.y1 - 0.04, y1: s.y1 + 0.014, c: 0 }))), this.stripeMat);
    // Airbox behind the driver.
    add(loft([
      { z: -0.4, w: 0.2, y0: 0.8, y1: 1.3, c: 0.08 },
      { z: -1.0, w: 0.17, y0: 0.8, y1: 1.12, c: 0.06 },
      { z: -1.45, w: 0.12, y0: 0.7, y1: 0.86, c: 0.04 },
    ]), this.paintMat);
    add(box(0.38, 0.06, 0.95, 0, 0.9, 0.18), carbon);                   // cockpit opening
    add(new THREE.IcosahedronGeometry(0.27, 1).translate(0, 1.08, -0.12), helmet);
    add(box(0.4, 0.12, 0.1, 0, 1.11, 0.1), visor);
    add(box(1.3, 0.12, 3.9, 0, 0.27, 0.1), carbon);                     // floor
    for (const s of [1, -1]) {
      add(box(0.42, 0.42, 1.7, s * 0.8, 0.52, -0.35), this.paintMat);   // side pods
      add(box(0.36, 0.3, 0.05, s * 0.8, 0.53, 0.52), carbon);           // pod intakes
      add(box(0.06, 0.34, 0.62, s * 1.07, 0.37, 2.05), this.paintMat);  // front wing endplates
      add(box(0.06, 0.62, 0.78, s * 1.0, 1.15, -1.86), carbon);         // rear wing endplates
      add(box(0.08, 0.72, 0.2, s * 0.32, 0.92, -1.84), carbon);         // rear wing struts
      add(box(0.55, 0.05, 0.08, s * 0.66, 0.5, 1.35), carbon);          // wishbones
      add(box(0.55, 0.05, 0.08, s * 0.68, 0.52, -1.3), carbon);
      add(new THREE.CylinderGeometry(0.07, 0.08, 0.32, 6).rotateX(Math.PI / 2).translate(s * 0.16, 0.52, -2.08), chrome);
      // Boost flame, hidden until a boost pad fires.
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1, 7).rotateX(-Math.PI / 2).translate(0, 0, -0.5), flameMat);
      flame.position.set(s * 0.16, 0.52, -2.22);
      flame.visible = false;
      this.body.add(flame);
      this.flames.push(flame);
    }
    add(box(2.08, 0.07, 0.56, 0, 0.26, 2.05), this.stripeMat);          // front wing
    add(box(2.0, 0.08, 0.6, 0, 1.3, -1.9), this.paintMat);              // rear wing
    add(box(2.0, 0.06, 0.28, 0, 1.45, -1.7), this.stripeMat);

    // Wheels sit outside the leaning body. Front ones turn on a pivot.
    const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 14).rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.44, 8).rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.46, 0.5, 0.09);
    this.wheels = WHEELS.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, WHEEL_R, w.z);
      const wheel = new THREE.Group();
      add(tyreGeo, tyre, wheel);
      add(rimGeo, rim, wheel);
      add(spokeGeo, carbon, wheel);
      add(spokeGeo.clone().rotateX(Math.PI / 2), carbon, wheel);
      if (!w.front) wheel.scale.x = 1.18;
      pivot.add(wheel);
      this.root.add(pivot);
      return { pivot, wheel, front: w.front };
    });
    this.spin = 0;
  }

  setPaint(p) {
    this.paintMat.color.set(p.body);
    this.stripeMat.color.set(p.stripe);
  }

  // Wheel spin and steering, plus a little body roll and pitch.
  animate(dt, { speed, steer, roll, pitch, boost = 0 }) {
    for (const f of this.flames) {
      f.visible = boost > 0.02;
      f.scale.set(1, 1, boost * (1.6 + Math.random() * 0.8));
    }
    this.spin = (this.spin + (speed / WHEEL_R) * dt) % (Math.PI * 2);
    for (const w of this.wheels) {
      w.wheel.rotation.x = this.spin;
      if (w.front) w.pivot.rotation.y = -steer * 0.42;
    }
    const k = 1 - Math.exp(-dt * 8);
    this.body.rotation.z += (roll - this.body.rotation.z) * k;
    this.body.rotation.x += (pitch - this.body.rotation.x) * k;
  }

  // A see-through copy for the ghost of your best run.
  makeGhost() {
    const mat = new THREE.MeshLambertMaterial({ color: '#cfeeff', transparent: true, opacity: 0.38, depthWrite: false });
    const ghost = this.root.clone(true);
    ghost.traverse((o) => {
      if (o.isMesh && o.material.blending === THREE.AdditiveBlending) o.visible = false;
      if (o.isMesh) {
        o.material = mat;
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    return ghost;
  }
}
