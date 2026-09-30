// Blocky fighters for the bots: legs, torso, head with a visor, arms holding a gun.
import * as THREE from 'three';

const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

export function makeCharacter(color, name) {
  const body = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf1c9a0 });
  const visor = new THREE.MeshLambertMaterial({ color: 0x1b2230, emissive: 0x0a1a33 });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });

  const root = new THREE.Group();
  const rig = new THREE.Group(); // tips over on death
  root.add(rig);

  const leg = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.8, 0);
    const m = box(0.26, 0.8, 0.28, dark);
    m.position.y = -0.4;
    pivot.add(m);
    rig.add(pivot);
    return pivot;
  };
  const legL = leg(-0.16), legR = leg(0.16);

  const torso = box(0.62, 0.62, 0.36, body);
  torso.position.y = 1.1;
  rig.add(torso);

  const head = box(0.42, 0.42, 0.42, skin);
  head.position.y = 1.62;
  rig.add(head);
  const helmet = box(0.46, 0.14, 0.46, body);
  helmet.position.y = 1.86;
  rig.add(helmet);
  const eyes = box(0.34, 0.1, 0.02, visor);
  eyes.position.set(0, 1.66, -0.215);
  rig.add(eyes);

  // Arms reach forward to the gun; the whole arm group pitches with aim.
  const arms = new THREE.Group();
  arms.position.y = 1.32;
  rig.add(arms);
  for (const x of [-0.38, 0.38]) {
    const a = box(0.18, 0.18, 0.55, body);
    a.position.set(x * 0.8, -0.05, -0.25);
    a.rotation.y = x > 0 ? 0.25 : -0.25;
    arms.add(a);
  }
  const gun = box(0.1, 0.14, 0.7, gunMat);
  gun.position.set(0.06, -0.02, -0.6);
  arms.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.06, 0, -0.98);
  arms.add(muzzle);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // Name tag
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px "Chakra Petch", sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(name, 128, 44);
  g.fillStyle = '#fff';
  g.fillText(name, 128, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  tag.scale.set(1.6, 0.4, 1);
  tag.position.y = 2.25;
  root.add(tag);

  return { root, rig, legL, legR, arms, muzzle, tag, phase: 0 };
}

export function animateCharacter(ch, f, dt) {
  ch.root.position.copy(f.pos);
  ch.root.rotation.y = f.yaw;
  ch.arms.rotation.x = f.pitch;
  const speed = Math.hypot(f.vel.x, f.vel.z);
  ch.phase += dt * speed * 1.6;
  const swing = Math.min(1, speed / 5) * 0.7 * Math.sin(ch.phase);
  ch.legL.rotation.x = swing;
  ch.legR.rotation.x = -swing;
  if (!f.alive) {
    ch.rig.rotation.x = Math.max(ch.rig.rotation.x - dt * 5, -Math.PI / 2);
  } else {
    ch.rig.rotation.x = 0;
  }
}
