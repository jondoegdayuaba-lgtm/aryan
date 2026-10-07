// Draws boost pads, jump pads and the hoops over big jumps.
import * as THREE from 'three';

export function buildFeatures(path, T) {
  const group = new THREE.Group();
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const dark = lambert({ color: '#2b2f3a' });
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Pads lie on the road; their arrows flow forward.
  const flat = (tex) => new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const boostTex = T.boost.clone(), launchTex = T.launch.clone();
  const boostMat = flat(boostTex), launchMat = flat(launchTex);
  const pt = {};
  for (const p of path.pads) {
    const o = path.at(p.s, pt);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(p.hl * 2, p.s1 - p.s0), p.kind === 'launch' ? launchMat : boostMat);
    pad.rotation.order = 'YXZ';
    pad.rotation.set(Math.PI / 2, o.yaw, 0);
    pad.position.set(o.x, o.y + 0.05, o.z);
    group.add(pad);
    if (p.kind === 'launch') {
      // A low frame round a jump pad, so you can spot it from a distance.
      for (const side of [1, -1]) {
        const rail = mesh(new THREE.BoxGeometry(0.4, 0.3, p.s1 - p.s0 + 0.4), lambert({ color: '#3ddc84' }), group);
        rail.position.set(o.x + o.rx * side * (p.hl + 0.2), o.y + 0.15, o.z + o.rz * side * (p.hl + 0.2));
        rail.rotation.y = o.yaw;
      }
    }
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
      boostTex.offset.y = -((t * 1.6) % 1);
      launchTex.offset.y = -((t * 1.1) % 1);
    },
  };
}
