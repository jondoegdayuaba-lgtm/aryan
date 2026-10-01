import * as THREE from 'three';
import { MOVE, PLAYER } from './config.js';

// A fighter: the player or a bot. Holds position, health, weapons and score.
// Bots also get a blocky body model; the player is only seen through the camera.
export class Actor {
  constructor({ name, team, color, isPlayer = false }) {
    this.name = name;
    this.team = team;            // team index, or a unique number in free-for-all
    this.color = color;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = MOVE.height;
    this.onGround = false;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.health = PLAYER.health;
    this.alive = false;
    this.respawnAt = 0;
    this.protectUntil = 0;
    this.lastHurt = -99;
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.gunLevel = 0;
    this.weapons = [];           // weapon ids
    this.slot = 0;
    this.ammo = {};              // id -> { mag, reserve }
    this.nextFire = 0;
    this.reloadUntil = 0;
    this.switchUntil = 0;
    this.triggerHeld = false;
    this.grenades = PLAYER.grenades;
    this.model = null;
  }

  get weapon() { return this.weapons[this.slot]; }

  eye(out) {
    return out.set(this.pos.x, this.pos.y + this.height - MOVE.eye, this.pos.z);
  }

  aimDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
}

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const box = (w, h, d, color) => new THREE.Mesh(
  new THREE.BoxGeometry(w, h, d),
  new THREE.MeshLambertMaterial({ color }),
);

export function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px "Chakra Petch", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

// Blocky character. Forward is -z, matching the camera.
export function buildModel(actor, gunMesh) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = SKIN[(Math.random() * SKIN.length) | 0];
  const dark = new THREE.Color(actor.color).multiplyScalar(0.45).getHex();

  const legL = new THREE.Group(), legR = new THREE.Group();
  for (const [leg, x] of [[legL, -0.14], [legR, 0.14]]) {
    const m = box(0.24, 0.8, 0.26, 0x2d3140);
    m.position.y = -0.4;
    const shoe = box(0.26, 0.12, 0.34, 0x16181f);
    shoe.position.set(0, -0.76, -0.04);
    leg.add(m, shoe);
    leg.position.set(x, 0.8, 0);
    body.add(leg);
  }
  const torso = box(0.62, 0.66, 0.34, actor.color);
  torso.position.y = 1.13;
  const belt = box(0.64, 0.08, 0.36, dark);
  belt.position.y = 0.83;
  const head = box(0.44, 0.42, 0.42, skin);
  head.position.y = 1.67;
  const hair = box(0.46, 0.12, 0.44, dark);
  hair.position.y = 1.9;
  const visor = box(0.36, 0.1, 0.05, 0x111111);
  visor.position.set(0, 1.7, -0.22);
  body.add(torso, belt, head, hair, visor);

  // Arms and gun pivot together at the shoulders so they follow the aim pitch.
  const arms = new THREE.Group();
  arms.position.y = 1.38;
  const armL = box(0.18, 0.18, 0.6, actor.color);
  armL.position.set(-0.3, -0.08, -0.25);
  armL.rotation.y = -0.35;
  const armR = box(0.18, 0.18, 0.55, actor.color);
  armR.position.set(0.3, -0.1, -0.2);
  const handL = box(0.16, 0.16, 0.14, skin);
  handL.position.set(-0.12, -0.08, -0.55);
  const handR = box(0.16, 0.16, 0.14, skin);
  handR.position.set(0.24, -0.12, -0.48);
  arms.add(armL, armR, handL, handR);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.12, -0.05, -0.5);
  arms.add(gunHolder);
  body.add(arms);
  if (gunMesh) gunHolder.add(gunMesh);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const tag = nameTag(actor.name, actor.color);
  tag.position.y = 2.3;
  root.add(tag);

  actor.model = { root, body, legL, legR, arms, gunHolder, tag, walk: 0, deathT: 0 };
  return root;
}

export function setModelGun(actor, gunMesh) {
  const m = actor.model;
  m.gunHolder.clear();
  if (gunMesh) m.gunHolder.add(gunMesh);
}

export function animateModel(actor, dt, now) {
  const m = actor.model;
  m.root.position.copy(actor.pos);
  m.root.rotation.y = actor.yaw;
  if (!actor.alive) {
    m.deathT = Math.min(m.deathT + dt * 3.5, 1);
    m.body.rotation.x = -Math.PI / 2 * m.deathT;
    m.body.position.y = 0.15 * m.deathT;
    m.tag.visible = false;
    m.root.visible = now < actor.respawnAt - 0.6;
    return;
  }
  m.deathT = 0;
  m.body.rotation.x = 0;
  m.body.position.y = 0;
  m.root.visible = true;
  m.tag.visible = true;
  const crouch = actor.height / MOVE.height;
  m.body.scale.y = crouch;
  m.tag.position.y = 2.3 * crouch;
  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  if (actor.onGround && !actor.sliding) m.walk += dt * speed * 1.6;
  const swing = actor.onGround && !actor.sliding ? Math.sin(m.walk) * Math.min(speed / 6, 1) * 0.7 : 0.35;
  m.legL.rotation.x = swing;
  m.legR.rotation.x = actor.onGround ? -swing : -0.2;
  m.arms.rotation.x = actor.pitch;
  // Blink while spawn-protected.
  if (now < actor.protectUntil) m.body.visible = Math.floor(now * 10) % 2 === 0;
  else m.body.visible = true;
}
