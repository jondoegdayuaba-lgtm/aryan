// The rider, modelled in Blender (tools/blender/rider.py): a one-piece body in
// motocross kit (jersey, pants, knee-high boots, gloves, neck brace) over a
// skeleton, and a helmet with a chin bar, peak and goggles. Posed every frame
// from targets for the hips, torso, head, hands and feet: two-bone IK bends
// the arms and legs, and the body skins smoothly over the joints, whether
// sitting, standing up over jumps, hanging back in a wheelie, leaning into a
// turn or throwing a trick. After a crash the same body flails as it's thrown
// clear.
import * as THREE from 'three';
import { clone as cloneSkinned } from '../../../vendor/three/addons/utils/SkeletonUtils.js';
import { canvasTexture } from '../render/textures.js';
import { getModel } from './models.js';

// From the wrist to the middle of the glove, where it holds the grip.
const GRIP = 0.055;
// Where the ankle sits relative to a foot target (the ball of the boot on the peg).
const ANKLE = new THREE.Vector3(0, 0.035, 0.1);
// Centre of the head in the rest pose (for the helmet camera).
const HEAD_CENTRE = new THREE.Vector3(0, 1.66, -0.02);

const TORSO = ['hips', 'spine', 'chest', 'neck', 'head'];
const SIDES = [['L', -1], ['R', 1]];

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

// Rotation taking the canonical axes to (x: hinge, y: along the bone).
const _fm = new THREE.Matrix4(), _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3();
function frameQuat(dir, hinge, out) {
  _fy.copy(dir).normalize();
  _fx.copy(hinge).addScaledVector(_fy, -hinge.dot(_fy)).normalize();
  _fz.crossVectors(_fx, _fy);
  return out.setFromRotationMatrix(_fm.makeBasis(_fx, _fy, _fz));
}

export class Rider {
  constructor(look, prep) {
    this.root = new THREE.Group();
    const scene = cloneSkinned(getModel('rider.glb').scene);
    this.root.add(scene);

    // Materials, by the names they have in Blender, in this rider's colours.
    const std = (color, roughness) => prep(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
    const shiny = (color) => prep(new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 }));
    const M = (this.mat = {
      jersey: std(look.jersey, 0.85),
      jersey2: std(look.jersey2, 0.85),
      pants: std(look.pants, 0.8),
      boots: std(look.boots, 0.5),
      gloves: std(look.gloves || look.jersey2, 0.75),
      dark: std(0x151517, 0.6),
      helmet: shiny(look.helmet),
      helmet2: shiny(look.helmet2),
      lens: prep(new THREE.MeshPhysicalMaterial({ color: 0x1a1208, roughness: 0.06, metalness: 0.6, clearcoat: 1, envMapIntensity: 1.6, iridescence: 0.6 }), false),
    });
    const B = (this.bones = {});
    scene.traverse((o) => {
      if (o.isBone) B[o.name] = o;
      if (o.isMesh) {
        o.material = M[o.material.name] || M.dark;
        o.castShadow = true;
        o.frustumCulled = false;          // its bounds are for the standing rest pose
      }
    });

    // Rest pose, in the rider's own space: where each joint is and how each
    // bone is turned, plus each bone's offset from its parent.
    scene.updateMatrixWorld(true);
    this.rest = {};
    for (const [name, b] of Object.entries(B)) {
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
      b.matrixWorld.decompose(pos, quat, new THREE.Vector3());
      this.rest[name] = { pos, quat, local: b.position.clone(), localQuat: b.quaternion.clone() };
    }
    const R = this.rest;
    const dist = (a, b) => R[a].pos.distanceTo(R[b].pos);
    this.len = { upper: dist('upperArmL', 'foreArmL'), fore: dist('foreArmL', 'handL'), thigh: dist('thighL', 'shinL'), shin: dist('shinL', 'footL') };
    // For each limb bone: its rest orientation expressed in the frame of the
    // limb (along the bone, about the elbow or knee hinge), so a posed limb
    // frame gives back the bone's orientation, twist and all.
    this.limbRest = {};
    const hingeOf = (a, b, c) => new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(R[b].pos, R[a].pos), new THREE.Vector3().subVectors(R[c].pos, R[b].pos)).normalize();
    for (const [s] of SIDES) {
      for (const [upper, lower, end] of [['upperArm', 'foreArm', 'hand'], ['thigh', 'shin', 'foot']]) {
        const n = hingeOf(upper + s, lower + s, end + s);
        const f1 = frameQuat(new THREE.Vector3().subVectors(R[lower + s].pos, R[upper + s].pos), n, new THREE.Quaternion());
        const f2 = frameQuat(new THREE.Vector3().subVectors(R[end + s].pos, R[lower + s].pos), n, new THREE.Quaternion());
        this.limbRest[upper + s] = f1.clone().invert().multiply(R[upper + s].quat);
        this.limbRest[lower + s] = f2.clone().invert().multiply(R[lower + s].quat);
        if (end === 'hand') this.limbRest[end + s] = f2.clone().invert().multiply(R[end + s].quat);
      }
    }

    // Number on the back of the jersey, curved round the chest, riding on the chest bone.
    const decal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.168, 0.168, 0.2, 12, 1, true, -0.62, 1.24),
      prep(new THREE.MeshStandardMaterial({ map: numberTexture(look.number, look.jersey, look.jersey2), roughness: 0.85, transparent: false })),
    );
    decal.scale.set(1.12, 1, 1.02);
    this._attach(decal, 'chest', new THREE.Vector3(0, 1.3, 0.024), new THREE.Quaternion());
    // Helmet camera anchor at the centre of the head.
    this.head = new THREE.Object3D();
    this._attach(this.head, 'head', HEAD_CENTRE, new THREE.Quaternion());

    this.world = {};          // posed bones in the rider's space: { pos, quat }
    for (const name of Object.keys(B)) this.world[name] = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this._v = Array.from({ length: 8 }, () => new THREE.Vector3());
    this._q = Array.from({ length: 4 }, () => new THREE.Quaternion());
    this._e = new THREE.Euler();
    this.flail = 0;
  }

  // Parent `obj` to a bone, keeping the given rest-pose position and rotation.
  _attach(obj, bone, pos, quat) {
    const r = this.rest[bone];
    const inv = r.quat.clone().invert();
    obj.position.copy(pos).sub(r.pos).applyQuaternion(inv);
    obj.quaternion.copy(inv).multiply(quat);
    this.bones[bone].add(obj);
  }

  // Turn a bone to `quat` (rider space); its position follows from its parent.
  _set(name, quat) {
    const b = this.bones[name];
    const w = this.world[name];
    const parent = this.world[b.parent.name];
    w.quat.copy(quat);
    if (parent) {
      w.pos.copy(this.rest[name].local).applyQuaternion(parent.quat).add(parent.pos);
      b.quaternion.copy(parent.quat).invert().multiply(quat);
    } else b.quaternion.copy(quat);
  }

  // Keep a bone's rest angle against its parent (collar bones).
  _follow(name) {
    const parent = this.world[this.bones[name].parent.name];
    this._set(name, this._q[3].copy(parent.quat).multiply(this.rest[name].localQuat));
  }

  // Bend a two-bone limb: `upper` from its joint toward the target, with the
  // middle joint pushed toward `pole`. `reach` extends the lower bone (the
  // hand holds the grip past the wrist).
  _limb(upper, lower, end, target, pole, reach, endQuat) {
    const V = this._v;
    const a = this.world[upper].pos;           // set when the parent was placed
    const l1 = upper.startsWith('thigh') ? this.len.thigh : this.len.upper;
    const l2 = upper.startsWith('thigh') ? this.len.shin : this.len.fore;
    const mid = solveIK(a, target, l1, l2 + reach, pole, V[0]);
    const d1 = V[1].subVectors(mid, a);
    const d2 = V[2].subVectors(target, mid);
    const hinge = V[3].crossVectors(d1, d2);
    if (hinge.lengthSq() < 1e-8) hinge.crossVectors(d1, pole);
    hinge.normalize();
    const q = this._q[0];
    this._set(upper, frameQuat(d1, hinge, q).multiply(this.limbRest[upper]));
    this._set(lower, frameQuat(d2, hinge, q).multiply(this.limbRest[lower]));
    if (endQuat) this._set(end, endQuat);
    else this._set(end, frameQuat(d2, hinge, q).multiply(this.limbRest[end]));
  }

  // p: { hip, torsoPitch, torsoRoll, headPitch, handL, handR, footL, footR, footQuat } in the parent's space.
  pose(p) {
    const q = this._q, e = this._e, R = this.rest, W = this.world;
    // Torso: the pelvis takes part of the lean, the chest all of it.
    const torso = (k, pitch, roll) => q[1].setFromEuler(e.set(-pitch * k, 0, roll * k, 'ZXY'));
    const hips = this.bones.hips;
    hips.position.copy(p.hip);
    W.hips.pos.copy(p.hip);
    this._set('hips', q[2].multiplyQuaternions(torso(0.45, p.torsoPitch, p.torsoRoll), R.hips.quat));
    this._set('spine', q[2].multiplyQuaternions(torso(0.8, p.torsoPitch, p.torsoRoll), R.spine.quat));
    this._set('chest', q[2].multiplyQuaternions(torso(1, p.torsoPitch, p.torsoRoll), R.chest.quat));
    const headPitch = p.headPitch ?? p.torsoPitch * 0.3;
    q[1].setFromEuler(e.set(-(p.torsoPitch + headPitch) * 0.5, 0, p.torsoRoll * 0.8, 'ZXY'));
    this._set('neck', q[2].multiplyQuaternions(q[1], R.neck.quat));
    q[1].setFromEuler(e.set(-headPitch, 0, p.torsoRoll * 0.6, 'ZXY'));
    this._set('head', q[2].multiplyQuaternions(q[1], R.head.quat));

    // Arms: elbows out and back.
    const V = this._v;
    for (const [s, sign] of SIDES) {
      this._follow('shoulder' + s);
      W['upperArm' + s].pos.copy(R['upperArm' + s].local).applyQuaternion(W['shoulder' + s].quat).add(W['shoulder' + s].pos);
      this._limb('upperArm' + s, 'foreArm' + s, 'hand' + s, s === 'L' ? p.handL : p.handR, V[4].set(sign, -0.5, 0.5), GRIP);
    }
    // Legs: knees forward and a little out, boots flat unless a trick turns them.
    const fq = p.footQuat;
    for (const [s, sign] of SIDES) {
      W['thigh' + s].pos.copy(R['thigh' + s].local).applyQuaternion(W.hips.quat).add(W.hips.pos);
      const ankle = V[5].copy(ANKLE);
      if (fq) ankle.applyQuaternion(fq);
      ankle.add(s === 'L' ? p.footL : p.footR);
      const footQ = fq ? q[3].multiplyQuaternions(fq, R['foot' + s].quat) : R['foot' + s].quat;
      this._limb('thigh' + s, 'shin' + s, 'foot' + s, ankle, V[4].set(sign * 0.35, 0.15, -1), 0, footQ);
    }
  }

  // Thrown clear after a crash: a ragged sprawl relative to the pelvis, with flailing.
  poseTumble(dt, onGround) {
    this.flail += dt * (onGround ? 2 : 9);
    const f = this.flail;
    const s = onGround ? 0.15 : 1;
    const V = this._v;
    this.pose({
      hip: V[6].set(0, 0, 0),
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
