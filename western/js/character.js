// Characters built from cowboy.glb: one rig, outfits switched by showing
// clothing pieces and recolouring materials by name.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { clamp, rng } from './util.js';
import { mergeSkinned } from './assets.js';

const UPPER = new Set(['spine', 'chest', 'neck', 'head', 'upperarmL', 'upperarmR', 'forearmL', 'forearmR', 'handL', 'handR']);
const PARTS = ['Body', 'Hat', 'Mask', 'Beard', 'Coat', 'Jacket', 'Vest', 'Suspenders', 'Satchel', 'GunBelt', 'Badge',
  'Revolver', 'RifleHand', 'HolsterGun', 'RifleBack'];

export const OUTFITS = {
  player: {
    show: ['Body', 'Hat', 'GunBelt', 'HolsterGun', 'Suspenders', 'Satchel', 'RifleBack', 'Beard'],
    colors: { Shirt: '#4f6b8e', Pants: '#5a4b3c', Hat: '#3b2b1f', Hair: '#3a2a1e', Skin: '#b97f5c', Hands: '#b97f5c' },
  },
  gus: {
    show: ['Body', 'Hat', 'Vest', 'Beard', 'GunBelt', 'HolsterGun'],
    colors: { Shirt: '#cbbfa4', Pants: '#3c3a36', Hat: '#5b4a3a', Hair: '#a19b90', Vest: '#3a2d26', Skin: '#c29072', Hands: '#c29072' },
  },
  sheriff: {
    show: ['Body', 'Hat', 'Vest', 'Badge', 'GunBelt', 'HolsterGun'],
    colors: { Shirt: '#d8d2c2', Pants: '#45403a', Hat: '#cdbb94', Vest: '#2d2a2a', Hair: '#5a4632', Skin: '#c9946f', Hands: '#c9946f' },
  },
  farmer: {
    show: ['Body', 'Hat', 'Suspenders', 'Beard'],
    colors: { Shirt: '#8b3b2f', Pants: '#4a5468', Hat: '#9c8a64', Hair: '#7a6a5a', Skin: '#c08a66', Hands: '#c08a66' },
  },
  outlaw: {
    show: ['Body', 'Hat', 'Mask', 'Coat', 'GunBelt', 'HolsterGun'],
    colors: { Shirt: '#655d4f', Pants: '#3d3833', Coat: '#4b5046', Mask: '#28282c', Hat: '#2c241e', Hands: '#3a2a20' },
    vary: { Coat: ['#4b5046', '#3a3530', '#5a4a3a', '#2e3236', '#55503f'], Shirt: ['#655d4f', '#7a6a58', '#4a4a50'],
      Hat: ['#2c241e', '#1e1c1b', '#4a3a2c', '#5e5040'], Mask: ['#28282c', '#323236', '#3a3430'] },
  },
  raider: {
    show: ['Body', 'Hat', 'Mask', 'Jacket', 'GunBelt', 'HolsterGun'],
    colors: { Shirt: '#7a6a58', Pants: '#3d3833', Jacket: '#5a4632', Mask: '#8c2a22', Hat: '#3a2c22', Hands: '#3a2a20' },
    vary: { Jacket: ['#5a4632', '#4a3a2c', '#3c3a33', '#6a5038'], Mask: ['#8c2a22', '#a0362a', '#7a2420'] },
  },
  boss: {
    show: ['Body', 'Hat', 'Mask', 'Coat', 'GunBelt', 'HolsterGun', 'Beard'],
    colors: { Shirt: '#2a2626', Pants: '#211f1e', Coat: '#1a1818', Mask: '#9a1c16', Hat: '#151313', Hands: '#201814', Hair: '#7a2a1a' },
  },
  townsman: {
    show: ['Body', 'Hat', 'Vest'],
    colors: { Shirt: '#c8bda6', Pants: '#4a4440', Vest: '#3c3430', Hat: '#6a5a48' },
    vary: { Shirt: ['#c8bda6', '#a8b0b8', '#d8cfc0', '#9a8a70'], Vest: ['#3c3430', '#2a3040', '#4a3a30', '#5a5040'],
      Hat: ['#6a5a48', '#2a2624', '#8a7a60', '#3a3028'], Pants: ['#4a4440', '#3a3a40', '#5a5048'] },
  },
};

export class CharacterFactory {
  constructor(gltf) {
    this.gltf = gltf;
    this.clips = {};
    for (const c of gltf.animations) this.clips[c.name] = c;
    for (const name of ['idle', 'walk', 'run', 'ride']) {
      const c = this.clips[name].clone();
      c.name = name + '_lower';
      c.tracks = c.tracks.filter((t) => !UPPER.has(t.name.split('.')[0]));
      this.clips[c.name] = c;
    }
    this.rand = rng(99);
  }

  create(outfit) {
    return new Character(this, outfit);
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class Character {
  constructor(factory, outfitName) {
    this.root = new THREE.Group();
    this.model = skeletonClone(factory.gltf.scene);
    this.root.add(this.model);
    this.outfit = outfitName;
    const outfit = OUTFITS[outfitName] || OUTFITS.townsman;
    const colors = { ...outfit.colors };
    if (outfit.vary) {
      for (const [k, list] of Object.entries(outfit.vary)) colors[k] = list[Math.floor(factory.rand() * list.length)];
    }
    for (const name of PARTS) {
      const o = this.model.getObjectByName(name);
      if (o) o.visible = outfit.show.includes(name);
    }
    const cache = {};
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const c = colors[o.material.name];
        if (c) {
          if (!cache[o.material.name]) {
            cache[o.material.name] = o.material.clone();
            cache[o.material.name].color.set(c);
          }
          o.material = cache[o.material.name];
        }
      }
    });
    mergeSkinned(this.model, ['HolsterGun', 'RifleBack']);
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.revolver = this.model.getObjectByName('Revolver');
    this.rifleHand = this.model.getObjectByName('RifleHand');
    this.holster = this.model.getObjectByName('HolsterGun');
    this.rifleBack = this.model.getObjectByName('RifleBack');
    this.hasHolster = outfit.show.includes('HolsterGun');
    this.hasRifleBack = outfit.show.includes('RifleBack');
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [name, clip] of Object.entries(factory.clips)) {
      const a = this.mixer.clipAction(clip);
      if (name === 'die') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[name] = a;
    }
    this.base = null;
    this.overlay = null;
    this.weapon = null;
    this.aimPitch = 0;
    this.aimTwist = 0;
    this.yaw = 0;
    this.health = 100;
    this.dead = false;
    this.setBase('idle', 0);
  }

  get position() {
    return this.root.position;
  }

  setBase(name, fade = 0.25, timeScale = 1) {
    const a = this.actions[name];
    if (!a) return;
    a.timeScale = timeScale;
    if (this.base === name) return;
    const prev = this.base && this.actions[this.base];
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (prev && fade > 0) prev.crossFadeTo(a, fade, false);
    else if (prev) prev.stop();
    this.base = name;
  }

  setOverlay(name, fade = 0.15) {
    if (this.overlay === name) return;
    if (this.overlay) this.actions[this.overlay].fadeOut(fade);
    if (name) {
      const a = this.actions[name];
      a.reset();
      a.setEffectiveWeight(1);
      a.fadeIn(fade);
      a.play();
    }
    this.overlay = name;
  }

  setWeapon(kind) {
    this.weapon = kind;
    if (this.revolver) this.revolver.visible = kind === 'revolver';
    if (this.rifleHand) this.rifleHand.visible = kind === 'rifle';
    if (this.holster) this.holster.visible = this.hasHolster && kind !== 'revolver';
    if (this.rifleBack) this.rifleBack.visible = this.hasRifleBack && kind !== 'rifle';
  }

  // Picks idle / walk / run (or ride) to match a ground speed in m/s.
  locomote(speed, { mounted = false, aiming = false } = {}) {
    let name;
    let ts = 1;
    if (mounted) name = 'ride';
    else if (speed < 0.25) name = 'idle';
    else if (speed < 2.9) {
      name = 'walk';
      ts = clamp(speed / 1.6, 0.5, 1.6);
    } else {
      name = 'run';
      ts = clamp(speed / 4.8, 0.7, 1.45);
    }
    if (aiming) name += '_lower';
    this.setBase(name, 0.22, ts);
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.setOverlay(null, 0.1);
    this.setBase('die', 0.12);
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.overlay) {
      if (this.aimTwist) this.rotateTorso(_v2.set(0, 1, 0), this.aimTwist, 0.45);
      if (Math.abs(this.aimPitch) > 1e-3) {
        const yaw = this.root.rotation.y + (this.aimTwist || 0);
        this.rotateTorso(_v2.set(-Math.cos(yaw), 0, Math.sin(yaw)), this.aimPitch, 0.4);
      }
    }
  }

  // Turn the spine and chest about a world axis after the animation has
  // posed them: used to aim up/down and to twist in the saddle.
  rotateTorso(axis, angle, spineShare) {
    for (const [name, share] of [['spine', spineShare], ['chest', 1 - spineShare]]) {
      const b = this.bones[name];
      if (!b) continue;
      b.parent.getWorldQuaternion(_q2);
      _q.setFromAxisAngle(axis, angle * share);
      const local = _q2.clone().invert().multiply(_q).multiply(_q2);
      b.quaternion.premultiply(local);
    }
  }

  // World position of the gun muzzle (or the right hand).
  muzzle(out = new THREE.Vector3()) {
    const gun = this.weapon === 'rifle' ? this.rifleHand : this.revolver;
    if (gun && gun.visible) {
      gun.updateWorldMatrix(true, false);
      // The barrel runs along Blender's -Y, which the glTF export turns into +Z.
      return this.weapon === 'rifle' ? out.set(0, 0.03, 0.69).applyMatrix4(gun.matrixWorld)
        : out.set(0, 0.032, 0.205).applyMatrix4(gun.matrixWorld);
    }
    const h = this.bones.handR;
    if (h) return h.getWorldPosition(out);
    return out.copy(this.root.position).add(_v.set(0, 1.4, 0));
  }

  forward(out = new THREE.Vector3()) {
    const y = this.root.rotation.y;
    return out.set(Math.sin(y), 0, Math.cos(y));
  }

  // Hit spheres from the posed skeleton: [name, centre, radius]
  hitSpheres() {
    const b = this.bones;
    const out = [];
    const add = (part, bone, r, up = 0) => {
      if (!b[bone]) return;
      const p = b[bone].getWorldPosition(new THREE.Vector3());
      p.y += up;
      out.push([part, p, r]);
    };
    add('head', 'head', 0.15, 0.1);
    add('body', 'chest', 0.22, 0.08);
    add('body', 'spine', 0.2);
    add('body', 'hips', 0.2);
    add('legs', 'shinL', 0.12);
    add('legs', 'shinR', 0.12);
    add('legs', 'thighL', 0.12, -0.15);
    add('legs', 'thighR', 0.12, -0.15);
    add('arms', 'forearmL', 0.09);
    add('arms', 'forearmR', 0.09);
    return out;
  }

  // Closest ray hit on this character: { dist, part, point } or null.
  rayHit(origin, dir, maxDist) {
    let best = null;
    for (const [part, c, r] of this.hitSpheres()) {
      const t = raySphere(origin, dir, c, r);
      if (t >= 0 && t < maxDist && (!best || t < best.dist)) best = { dist: t, part, point: origin.clone().addScaledVector(dir, t) };
    }
    return best;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : -1);
}
