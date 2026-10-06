// Draws the obstacles, boost pads and jump hoops, and moves them in step
// with the race clock using the same maths as obstacles.js.
import * as THREE from 'three';
import { KERB } from './path.js';
import { obstaclesFor, KINDS } from './obstacles.js';

export function buildFeatures(path, T) {
  const group = new THREE.Group();
  const movers = [];
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const hazard = lambert({ map: T.hazard });
  const dark = lambert({ color: '#2b2f3a' });
  const steel = lambert({ color: '#9aa0ab' });
  const red = lambert({ color: '#e2342d' });
  const bands = T.bands.clone();
  bands.repeat.set(8, 1);
  const banded = lambert({ map: bands });
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Each obstacle gets a group in its own frame: z along the road, -x to the
  // right (so lateral l draws at x = -l), y up.
  for (const o of obstaclesFor(path).list) {
    const g = new THREE.Group();
    g.position.set(o.x, o.y, o.z);
    g.rotation.y = o.yaw;
    group.add(g);
    const W = o.hw + KERB;

    if (o.kind === 'hammer') {
      const K = KINDS.hammer, side = W + 1.6, top = K.pivot + 0.7;
      for (const x of [-side, side]) mesh(new THREE.BoxGeometry(0.8, top + 0.4, 0.8), dark, g, x, (top + 0.4) / 2, 0);
      mesh(new THREE.BoxGeometry(side * 2 + 0.8, 0.9, 0.9), hazard, g, 0, top, 0);
      const swing = new THREE.Group();
      swing.position.y = K.pivot;
      g.add(swing);
      mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 10).rotateX(Math.PI / 2), steel, swing);
      mesh(new THREE.BoxGeometry(0.4, K.arm, 0.4), steel, swing, 0, -K.arm / 2, 0);
      const { ha, hl, hh } = K.head;
      mesh(new THREE.BoxGeometry(hl * 2, hh * 2, ha * 2), hazard, swing, 0, -K.arm, 0);
      mesh(new THREE.BoxGeometry(hl * 2 + 0.2, 0.35, ha * 2 + 0.2), red, swing, 0, -K.arm + hh, 0);
      movers.push((t) => { swing.rotation.z = -K.angle(t, o); });
    } else if (o.kind === 'sweeper') {
      const K = KINDS.sweeper;
      mesh(new THREE.CylinderGeometry(K.post, K.post * 1.15, 2.6, 12), hazard, g, 0, 1.3, 0);
      const rotor = new THREE.Group();
      rotor.position.y = 0.95;
      g.add(rotor);
      mesh(new THREE.BoxGeometry(0.64, 0.64, K.len * 2), banded, rotor);
      mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.9, 12), red, rotor);
      movers.push((t) => { rotor.rotation.y = -K.angle(t, o); });
    } else if (o.kind === 'pistons') {
      const K = KINDS.pistons;
      K.rows.forEach((a, row) => {
        for (const side of [1, -1]) {
          mesh(new THREE.BoxGeometry(1.6, 2.8, 5), dark, g, -side * (W + 2), 1.4, a);
          const block = mesh(new THREE.BoxGeometry(1, 2.2, 4.4), hazard, g, 0, 1.1, a);
          movers.push((t) => {
            const [x] = K.out(t, o, row, side);
            const inner = W - x * W * K.reach, outer = W + 1.2;
            block.position.x = -side * (inner + outer) / 2;
            block.scale.x = outer - inner;
          });
        }
      });
    } else if (o.type.posts) {
      const posts = o.posts || (o.posts = o.type.posts(o));
      const body = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.45, 1.2, 8).translate(0, 0.6, 0), lambert({ color: '#ff7a1a' }), posts.length);
      const band = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.43, 0.45, 0.24, 8).translate(0, 0.8, 0), lambert({ color: '#f3f4f6' }), posts.length);
      const m = new THREE.Matrix4();
      posts.forEach(([a, l], i) => {
        m.makeTranslation(-l, 0, a);
        body.setMatrixAt(i, m);
        band.setMatrixAt(i, m);
      });
      body.castShadow = true;
      g.add(body, band);
    }
  }

  // Boost pads: flowing chevrons lying on the road.
  const padTex = T.boost.clone();
  padTex.repeat.set(1, 1);
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pt = {};
  for (const p of path.pads) {
    const o = path.at(p.s, pt);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(p.hl * 2, p.s1 - p.s0), padMat);
    pad.rotation.order = 'YXZ';
    pad.rotation.set(Math.PI / 2, o.yaw, 0);
    pad.position.set(o.x, o.y + 0.05, o.z);
    group.add(pad);
  }

  // Hoops over the big jumps, on legs down to the ground.
  const hoopTex = T.bands.clone();
  hoopTex.repeat.set(12, 1);
  const hoopMat = lambert({ map: hoopTex });
  for (const h of path.hoops) {
    const o = path.at(h.s, pt);
    const g = new THREE.Group();
    g.position.set(o.x, 0, o.z);
    g.rotation.y = o.yaw;
    mesh(new THREE.TorusGeometry(7, 0.5, 10, 40), hoopMat, g, 0, h.y, 0);
    for (const x of [-7, 7]) mesh(new THREE.BoxGeometry(0.5, h.y, 0.5), dark, g, x, h.y / 2, 0);
    group.add(g);
  }

  return {
    group,
    update(t) {
      for (const f of movers) f(t);
      padTex.offset.y = -((t * 1.6) % 1);
    },
  };
}
