// The rider, in motocross kit: helmet with peak and goggles, jersey with a
// number on the back, pants, knee-high boots and gloves. Posed every frame:
// two-bone IK keeps the hands on the grips and the boots on the pegs whether
// sitting, standing up over jumps, hanging back in a wheelie or leaning into a
// turn. After a crash the same body flails as it's thrown clear.
import * as THREE from 'three';
import { canvasTexture } from '../render/textures.js';
import { useTerrainLight } from '../render/shaderpatch.js';

const Y = new THREE.Vector3(0, 1, 0);
export const LIMB = { thigh: 0.44, shin: 0.43, upper: 0.29, fore: 0.27, spine: 0.47 };

function capsule(r, len, radial = 10) {
  return new THREE.CapsuleGeometry(r, len, 4, radial);
}

// Joint position for a two-bone chain from `a` toward `t`, bending toward `pole`.
function solveIK(a, t, l1, l2, pole, out) {
  const d = new THREE.Vector3().subVectors(t, a);
  let dist = d.length();
  const dir = d.multiplyScalar(1 / (dist || 1));
  dist = THREE.MathUtils.clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.005);
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, -1).addScaledVector(dir, -dir.z);
  bend.normalize();
  return out.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
}

function numberTexture(num, bg, fg) {
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = fg;
    g.font = 'italic 900 170px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(num, W / 2, H / 2 + 10);
  });
}

export class Rider {
  constructor(look, prep) {
    this.root = new THREE.Group();
    const std = (color, rough = 0.8, extra = {}) => prep(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }));
    this.mat = {
      jersey: std(look.jersey, 0.85),
      jersey2: std(look.jersey2, 0.85),
      pants: std(look.pants, 0.8),
      boots: std(look.boots, 0.5),
      gloves: std(look.gloves || look.jersey2, 0.75),
      helmet: prep(new THREE.MeshPhysicalMaterial({ color: look.helmet, roughness: 0.35, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 })),
      helmet2: prep(new THREE.MeshPhysicalMaterial({ color: look.helmet2, roughness: 0.35, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 })),
      lens: prep(new THREE.MeshPhysicalMaterial({ color: 0x1a1208, roughness: 0.06, metalness: 0.6, clearcoat: 1, envMapIntensity: 1.6, iridescence: 0.6 }), false),
      dark: std(0x151517, 0.6),
    };
    const M = this.mat;
    const add = (geo, mat) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      this.root.add(m);
      return m;
    };

    // Limbs: capsules exactly as long as the bones, so they only need turning.
    this.upperL = add(capsule(0.06, LIMB.upper), M.jersey);
    this.upperR = add(capsule(0.06, LIMB.upper), M.jersey);
    this.foreL = add(capsule(0.052, LIMB.fore), M.jersey2);
    this.foreR = add(capsule(0.052, LIMB.fore), M.jersey2);
    this.thighL = add(capsule(0.078, LIMB.thigh), M.pants);
    this.thighR = add(capsule(0.078, LIMB.thigh), M.pants);
    this.shinL = add(capsule(0.066, LIMB.shin * 0.45), M.pants);
    this.shinR = add(capsule(0.066, LIMB.shin * 0.45), M.pants);
    this.bootShaftL = add(capsule(0.072, LIMB.shin * 0.52), M.boots);
    this.bootShaftR = add(capsule(0.072, LIMB.shin * 0.52), M.boots);
    const bootGeo = new THREE.BoxGeometry(0.11, 0.1, 0.27, 1, 1, 2);
    {
      // Toe box slopes down; sole in black.
      const p = bootGeo.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) < -0.05 && p.getY(i) > 0) p.setY(i, p.getY(i) - 0.035);
      bootGeo.computeVertexNormals();
    }
    this.bootL = add(bootGeo, M.boots);
    this.bootR = add(bootGeo, M.boots);
    const gloveGeo = new THREE.SphereGeometry(0.052, 10, 8);
    gloveGeo.scale(1, 0.8, 1.35);
    this.gloveL = add(gloveGeo, M.gloves);
    this.gloveR = add(gloveGeo, M.gloves);

    // Torso: jersey over a chest protector, number on the back.
    this.torso = new THREE.Group();
    this.root.add(this.torso);
    const chest = new THREE.Mesh(capsule(0.155, 0.27, 14), M.jersey);
    chest.scale.set(1.22, 1, 0.82);
    chest.position.y = LIMB.spine * 0.52;
    chest.castShadow = true;
    this.torso.add(chest);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.07, 18, 1, true), M.jersey2);
    stripe.scale.set(1.22, 1, 0.82);
    stripe.position.y = LIMB.spine * 0.3;
    this.torso.add(stripe);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), prep(new THREE.MeshStandardMaterial({ map: numberTexture(look.number, look.jersey, look.jersey2), roughness: 0.85 })));
    back.position.set(0, LIMB.spine * 0.6, 0.131);
    this.torso.add(back);
    const hips = new THREE.Mesh(capsule(0.12, 0.14, 12), M.pants);
    hips.rotation.z = Math.PI / 2;
    hips.scale.set(1, 1, 0.85);
    hips.castShadow = true;
    this.torso.add(hips);
    this.neck = add(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 10), M.dark);

    // Helmet: shell, chin bar, peak, goggles.
    this.head = new THREE.Group();
    this.root.add(this.head);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 18), M.helmet);
    shell.scale.set(0.95, 1, 1.12);
    shell.position.set(0, 0.02, 0.01);
    const shellStripe = new THREE.Mesh(new THREE.SphereGeometry(0.1365, 24, 18, Math.PI / 2 - 0.25, 0.5, 0, Math.PI * 0.62), M.helmet2);
    shellStripe.scale.copy(shell.scale);
    shellStripe.position.copy(shell.position);
    shellStripe.rotation.y = Math.PI;
    const chin = new THREE.Mesh(capsule(0.045, 0.1, 12), M.helmet);
    chin.rotation.z = Math.PI / 2;
    chin.scale.set(1, 1, 1.2);
    chin.position.set(0, -0.072, -0.098);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), M.dark);
    vent.position.set(0, -0.078, -0.152);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.01, 0.11), M.helmet);
    peak.position.set(0, 0.1, -0.14);
    peak.rotation.x = -0.32;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.06, 20, 1, true, Math.PI - 0.85, 1.7), M.lens);
    lens.scale.set(0.95, 1, 1.12);
    lens.position.set(0, 0.02, 0.012);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.137, 0.013, 6, 30), M.helmet2);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(0.95, 1.12, 1);
    strap.position.set(0, 0.02, 0.01);
    for (const m of [shell, shellStripe, chin, vent, peak, lens, strap]) {
      m.castShadow = true;
      this.head.add(m);
    }

    this._v = Array.from({ length: 12 }, () => new THREE.Vector3());
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this.flail = 0;
  }

  _seg(mesh, a, b) {
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    const d = this._v[11].subVectors(b, a);
    mesh.quaternion.setFromUnitVectors(Y, d.normalize());
  }

  // p: { hip, torsoPitch, torsoRoll, headPitch, handL, handR, footL, footR } in the parent's space.
  pose(p) {
    const V = this._v;
    // Torso frame: pitch forward about x, then roll about z.
    this._e.set(-p.torsoPitch, 0, p.torsoRoll, 'ZXY');
    const qT = this._q.setFromEuler(this._e);
    this.torso.position.copy(p.hip);
    this.torso.quaternion.copy(qT);
    const up = V[0].set(0, 1, 0).applyQuaternion(qT);
    const chest = V[1].copy(p.hip).addScaledVector(up, LIMB.spine);
    const shL = V[2].set(-0.19, -0.05, 0.01).applyQuaternion(qT).add(chest);
    const shR = V[3].set(0.19, -0.05, 0.01).applyQuaternion(qT).add(chest);
    // Arms: elbows out and back.
    const elbow = V[4];
    solveIK(shL, p.handL, LIMB.upper, LIMB.fore, V[9].set(-1, -0.5, 0.5), elbow);
    this._seg(this.upperL, shL, elbow);
    this._seg(this.foreL, elbow, p.handL);
    solveIK(shR, p.handR, LIMB.upper, LIMB.fore, V[9].set(1, -0.5, 0.5), elbow);
    this._seg(this.upperR, shR, elbow);
    this._seg(this.foreR, elbow, p.handR);
    this.gloveL.position.copy(p.handL);
    this.gloveR.position.copy(p.handR);
    this.gloveL.quaternion.copy(qT);
    this.gloveR.quaternion.copy(qT);
    // Legs: knees forward and a little out.
    const hipL = V[5].set(-0.1, -0.02, 0).applyQuaternion(qT).add(p.hip);
    const hipR = V[6].set(0.1, -0.02, 0).applyQuaternion(qT).add(p.hip);
    const knee = V[7];
    for (const [side, hipJ, foot, thigh, shin, shaft, boot] of [
      [-1, hipL, p.footL, this.thighL, this.shinL, this.bootShaftL, this.bootL],
      [1, hipR, p.footR, this.thighR, this.shinR, this.bootShaftR, this.bootR],
    ]) {
      solveIK(hipJ, foot, LIMB.thigh, LIMB.shin, V[9].set(side * 0.35, 0.15, -1), knee);
      this._seg(thigh, hipJ, knee);
      // Shin: pants above, boot shaft below.
      const mid = V[8].lerpVectors(knee, foot, 0.45);
      this._seg(shin, knee, mid);
      this._seg(shaft, mid, foot);
      boot.position.copy(foot).add(V[10].set(0, -0.03, -0.06).applyQuaternion(p.footQuat || this._q2.identity()));
      boot.quaternion.copy(p.footQuat || this._q2.identity());
    }
    // Neck and head: the head stays nearer level than the torso.
    const neckBase = V[8].copy(chest).addScaledVector(up, 0.02);
    this._e.set(-(p.headPitch ?? p.torsoPitch * 0.3), 0, p.torsoRoll * 0.6, 'ZXY');
    const qH = this._q2.setFromEuler(this._e);
    const headUp = V[9].set(0, 1, 0).applyQuaternion(qH);
    this.neck.position.copy(neckBase).addScaledVector(headUp, 0.04);
    this.neck.quaternion.copy(qH);
    this.head.position.copy(neckBase).addScaledVector(headUp, 0.165);
    this.head.quaternion.copy(qH);
  }

  // Thrown clear after a crash: a ragged sprawl relative to the pelvis, with flailing.
  poseTumble(dt, onGround) {
    this.flail += dt * (onGround ? 2 : 9);
    const f = this.flail;
    const s = onGround ? 0.15 : 1;
    const V = this._v;
    this.pose({
      hip: V[0].set(0, 0, 0).clone(),
      torsoPitch: -0.2 + Math.sin(f * 0.7) * 0.2 * s,
      torsoRoll: Math.sin(f * 0.5) * 0.25 * s,
      headPitch: -0.3,
      handL: new THREE.Vector3(-0.55, 0.55 + Math.sin(f) * 0.25 * s, -0.1 + Math.cos(f * 1.3) * 0.2 * s),
      handR: new THREE.Vector3(0.55, 0.5 + Math.cos(f * 1.1) * 0.25 * s, -0.05 + Math.sin(f * 0.9) * 0.2 * s),
      footL: new THREE.Vector3(-0.3, -0.75 + Math.sin(f * 1.2) * 0.12 * s, -0.25 + Math.cos(f) * 0.2 * s),
      footR: new THREE.Vector3(0.28, -0.8 + Math.cos(f * 0.8) * 0.12 * s, -0.1 + Math.sin(f * 1.4) * 0.2 * s),
    });
  }
}
