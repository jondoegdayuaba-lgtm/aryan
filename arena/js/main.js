// Blockfire Arena: a free-for-all arena shooter against bots.
import * as THREE from 'three';
import { buildMap, boxes, raycastWorld, rayAABB, nav } from './map.js';
import { makeCharacter, animateCharacter } from './character.js';
import { WEAPONS, buildViewModel } from './weapons.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const R = 0.35, H = 1.8, EYE = 1.6, G = 22, JUMP = 7.6, STEP = 0.55;
const RESPAWN = 3, REGEN_DELAY = 4, REGEN_RATE = 25;
const DIFFS = {
  easy: { react: 0.75, spread: 0.07, turn: 3.5, settle: 1.2, dmg: 0.55, burst: [2, 4] },
  normal: { react: 0.45, spread: 0.04, turn: 6, settle: 2.2, dmg: 0.8, burst: [3, 6] },
  hard: { react: 0.25, spread: 0.02, turn: 10, settle: 4, dmg: 1, burst: [4, 9] },
};
const BOT_NAMES = ['Pixelhound', 'Cubey', 'Rustbolt', 'Nova', 'Sprocket', 'Voxelina', 'Mango', 'Ziggy', 'Tundra',
  'Quill', 'Rexbox', 'Fennel', 'Juno', 'Kestrel', 'Blip', 'Gravel', 'Toaster', 'Wobble', 'Pepper', 'Brick'];
const COLORS = [0xe74c3c, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff6fb5, 0x95a5a6,
  0x34495e, 0xa0522d, 0x00bcd4, 0xcddc39, 0x795548, 0x607d8b, 0xff5722];

// ---------- settings ----------
const settings = { name: 'Player', bots: 7, diff: 'normal', sens: 1, kills: 25, minutes: 5 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('blockfire-settings') || '{}')); } catch { /* storage off */ }
const saveSettings = () => { try { localStorage.setItem('blockfire-settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------- renderer / scenes ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd4ff);
scene.fog = new THREE.Fog(0x9fd4ff, 70, 170);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
buildMap(scene);

const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.8));
const vmSun = new THREE.DirectionalLight(0xffffff, 1.6);
vmSun.position.set(1, 2, 1);
vmScene.add(vmSun);
const viewModels = WEAPONS.map((w) => { const v = buildViewModel(w); v.group.visible = false; vmScene.add(v.group); return v; });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = vmCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- effects ----------
const fx = [];
const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
tracerGeo.translate(0, 0, 0.5);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd060 });
const bloodMat = new THREE.MeshBasicMaterial({ color: 0xd8262e });
const dustMat = new THREE.MeshLambertMaterial({ color: 0x8c8c8c });
const holeGeo = new THREE.PlaneGeometry(0.1, 0.1);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const holes = [];
const flashLight = new THREE.PointLight(0xffc36b, 0, 8);
scene.add(flashLight);

function tracer(from, to) {
  const len = from.distanceTo(to);
  if (len < 0.5) return;
  const m = new THREE.Mesh(tracerGeo, tracerMat);
  m.position.copy(from);
  m.lookAt(to);
  m.scale.set(0.025, 0.025, len);
  scene.add(m);
  fx.push({ m, life: 0.06, kind: 'tracer' });
}

function burst(p, n, mat, speed, normal) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sparkGeo, mat);
    m.position.copy(p);
    const v = new V3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    if (normal) v.addScaledVector(normal, speed * 0.6);
    scene.add(m);
    fx.push({ m, v, life: 0.25 + Math.random() * 0.25, kind: 'spark' });
  }
}

function bulletHole(p, n) {
  const m = holes.length >= 80 ? holes.shift() : new THREE.Mesh(holeGeo, holeMat);
  m.position.copy(p).addScaledVector(n, 0.005);
  m.lookAt(p.clone().add(n));
  m.rotation.z = Math.random() * Math.PI;
  scene.add(m);
  holes.push(m);
}

function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    e.life -= dt;
    if (e.v) { e.v.y -= 12 * dt; e.m.position.addScaledVector(e.v, dt); }
    if (e.life <= 0) { scene.remove(e.m); fx.splice(i, 1); }
  }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 200);
}

// ---------- fighters ----------
let clock = 0; // game time, frozen while paused
let fighters = [];
let player = null;

class Fighter {
  constructor(name, color, isPlayer) {
    this.name = name;
    this.color = color;
    this.isPlayer = isPlayer;
    this.pos = new V3();
    this.vel = new V3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.hp = 100;
    this.alive = false;
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.lastHurt = -99;
    this.respawnAt = 0;
    this.killer = null;
    this.switchEnd = 0;
    this.bloom = 0;
    this.slots = [];
    this.cur = 0;
    if (!isPlayer) {
      this.ch = makeCharacter(color, name);
      scene.add(this.ch.root);
      this.ai = { path: null, pi: 0, goal: null, target: null, think: 0, seenSince: -1, lastSeen: null, lastSeenAt: -99,
        aimYaw: 0, aimPitch: 0, strafe: 1, strafeT: 0, burst: 0, pauseUntil: 0, stuckT: 0, repath: 0, jumpT: 2 };
    }
  }
  get w() { return this.slots[this.cur]; }
  giveLoadout(ids) {
    this.slots = ids.map((id) => {
      const def = WEAPONS.find((w) => w.id === id);
      return { def, mag: def.mag, reserve: def.reserve, next: 0, reloading: false, reloadEnd: 0 };
    });
    this.cur = 0;
  }
  eye(out = new V3()) { return out.set(this.pos.x, this.pos.y + EYE, this.pos.z); }
}

function dirFrom(yaw, pitch, out = new V3()) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- physics ----------
function overlaps(p, b) {
  return p.x - R < b.max.x && p.x + R > b.min.x && p.z - R < b.max.z && p.z + R > b.min.z &&
    p.y < b.max.y - 1e-4 && p.y + H > b.min.y + 1e-4;
}
function anyOverlap(p) { for (const b of boxes) if (overlaps(p, b)) return true; return false; }

function moveAxis(f, axis, d) {
  if (!d) return;
  f.pos[axis] += d;
  for (const b of boxes) {
    if (!overlaps(f.pos, b)) continue;
    const rise = b.max.y - f.pos.y;
    if (f.onGround && rise > 0 && rise <= STEP) {
      const oldY = f.pos.y;
      f.pos.y = b.max.y;
      if (!anyOverlap(f.pos)) { f.stepUp = (f.stepUp || 0) + rise; continue; }
      f.pos.y = oldY;
    }
    f.pos[axis] = d > 0 ? b.min[axis] - R - 1e-4 : b.max[axis] + R + 1e-4;
    f.vel[axis] = 0;
    f.bumped = true;
  }
}

function moveBody(f, dt) {
  f.bumped = false;
  f.vel.y -= G * dt;
  moveAxis(f, 'x', f.vel.x * dt);
  moveAxis(f, 'z', f.vel.z * dt);
  const wasGround = f.onGround;
  f.pos.y += f.vel.y * dt;
  f.onGround = false;
  for (const b of boxes) {
    if (!overlaps(f.pos, b)) continue;
    if (f.vel.y <= 0) { f.pos.y = b.max.y; f.onGround = true; } else f.pos.y = b.min.y - H - 1e-4;
    f.vel.y = 0;
  }
  if (f.pos.y <= 0) { f.pos.y = 0; f.vel.y = 0; f.onGround = true; }
  // Stick to the ground when walking down stairs.
  if (wasGround && !f.onGround && f.vel.y <= 0) {
    const y0 = f.pos.y;
    f.pos.y -= STEP;
    let land = -1;
    for (const b of boxes) if (overlaps(f.pos, b)) land = Math.max(land, b.max.y);
    if (f.pos.y <= 0) land = Math.max(land, 0);
    if (land >= 0 && land <= y0) { f.pos.y = land; f.onGround = true; f.vel.y = 0; } else f.pos.y = y0;
  }
}

// ---------- shooting ----------
function coneDir(dir, spread, out) {
  if (spread <= 0) return out.copy(dir);
  const up = Math.abs(dir.y) > 0.99 ? new V3(1, 0, 0) : new V3(0, 1, 0);
  const right = new V3().crossVectors(dir, up).normalize();
  const u = new V3().crossVectors(right, dir).normalize();
  const r = spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
  return out.copy(dir).addScaledVector(right, Math.cos(a) * r).addScaledVector(u, Math.sin(a) * r).normalize();
}

function trace(o, d, shooter, maxT) {
  const w = raycastWorld(o, d, maxT);
  let t = w.t, who = null, head = false;
  for (const f of fighters) {
    if (f === shooter || !f.alive) continue;
    const p = f.pos;
    const th = rayAABB(o, d, p.x - 0.25, p.y + 1.4, p.z - 0.25, p.x + 0.25, p.y + 1.9, p.z + 0.25, t);
    if (th >= 0 && th < t) { t = th; who = f; head = true; }
    const tb = rayAABB(o, d, p.x - 0.36, p.y, p.z - 0.36, p.x + 0.36, p.y + 1.4, p.z + 0.36, t);
    if (tb >= 0 && tb < t) { t = tb; who = f; head = false; }
  }
  return { t, point: o.clone().addScaledVector(d, t), who, head, normal: who ? null : w.normal, hitWorld: !who && t < maxT };
}

function soundAt(pos, kind) {
  if (!player) return;
  const cam = camera.position, dist = cam.distanceTo(pos);
  const vol = 1 / (1 + dist / 8);
  const rel = new V3().subVectors(pos, cam);
  const right = new V3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const pan = dist > 0.5 ? rel.normalize().dot(right) * 0.8 : 0;
  sfx.shot(kind, vol, pan);
}

const tmpDir = new V3();
function shoot(f, origin, dir, spread, muzzle) {
  const w = f.w, def = w.def;
  w.mag--;
  w.next = clock + 60 / def.rpm;
  const dmgMul = f.isPlayer ? 1 : DIFFS[settings.diff].dmg;
  for (let i = 0; i < def.pellets; i++) {
    coneDir(dir, spread, tmpDir);
    const hit = trace(origin, tmpDir, f, 300);
    tracer(muzzle, hit.point);
    if (hit.who) {
      let dmg = def.dmg * (hit.head ? def.head : 1) * dmgMul;
      if (hit.t > def.range) dmg *= Math.max(0.35, def.range / hit.t);
      burst(hit.point, 4, bloodMat, 3);
      damage(hit.who, f, dmg, hit.head);
    } else if (hit.hitWorld) {
      burst(hit.point, 3, dustMat, 2.5, hit.normal);
      burst(hit.point, 2, sparkMat, 4, hit.normal);
      bulletHole(hit.point, hit.normal);
    }
  }
  flashLight.position.copy(muzzle);
  flashLight.intensity = 30;
  soundAt(muzzle, def.id);
}

function startReload(f) {
  const w = f.w;
  if (w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return;
  w.reloading = true;
  w.reloadEnd = clock + w.def.reload;
  if (f.isPlayer) sfx.reload(w.def.reload);
}

function tickWeapon(f) {
  const w = f.w;
  if (w.reloading && clock >= w.reloadEnd) {
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    if (w.reserve !== Infinity) w.reserve -= take;
    w.reloading = false;
  }
}

function switchTo(f, i) {
  if (i === f.cur || i < 0 || i >= f.slots.length) return;
  f.w.reloading = false;
  f.cur = i;
  f.switchEnd = clock + 0.35;
  if (f.isPlayer) { sfx.swap(); vmAnim.swap = 1; updateSlotsHud(); }
}

const canFire = (f) => f.alive && !f.w.reloading && clock >= f.w.next && clock >= f.switchEnd && f.w.mag > 0;

// ---------- damage / kills ----------
let multi = { n: 0, t: -99 };

function damage(victim, attacker, amount, head) {
  if (!victim.alive || matchOver) return;
  victim.hp -= amount;
  victim.lastHurt = clock;
  if (attacker.isPlayer) showHitmarker(head, victim.hp <= 0);
  if (victim.isPlayer) { sfx.hurt(); damageIndicator(attacker); }
  if (!victim.isPlayer && attacker.alive) {
    const ai = victim.ai;
    if (!ai.target || !ai.target.alive || Math.random() < 0.6) { ai.target = attacker; ai.lastSeen = attacker.pos.clone(); ai.lastSeenAt = clock; }
  }
  if (victim.hp > 0) return;

  victim.hp = 0;
  victim.alive = false;
  victim.deaths++;
  victim.streak = 0;
  victim.killer = attacker;
  victim.respawnAt = clock + RESPAWN;
  victim.vel.set(0, victim.vel.y, 0);
  attacker.kills++;
  attacker.streak++;
  addFeed(attacker, victim, head);

  if (attacker.isPlayer) {
    sfx.kill();
    if (clock - multi.t < 4) multi.n++; else multi.n = 1;
    multi.t = clock;
    const names = { 2: 'Double Kill', 3: 'Triple Kill', 4: 'Quad Kill', 5: 'Rampage' };
    if (multi.n >= 2) announce(names[Math.min(multi.n, 5)]);
    else if ([3, 5, 10, 15, 20].includes(attacker.streak)) announce({ 3: 'Killing Spree', 5: 'Dominating', 10: 'Unstoppable', 15: 'Legendary', 20: 'Godlike' }[attacker.streak]);
    else if (head) announce('Headshot', true);
  }
  if (victim.isPlayer) {
    sfx.death();
    $('death-by').textContent = attacker.name;
    $('death-weapon').textContent = attacker.w.def.name + (head ? ' · headshot' : '');
    $('death').hidden = false;
    $('scope').hidden = true;
  }
  if (attacker.kills >= settings.kills) endMatch();
}

function spawnPoint(f) {
  let best = null, bestD = -1;
  for (let i = 0; i < 20; i++) {
    const p = nav.randomOpen();
    let d = Infinity;
    for (const o of fighters) if (o !== f && o.alive) d = Math.min(d, o.pos.distanceTo(p));
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

function respawn(f) {
  f.pos.copy(spawnPoint(f));
  f.vel.set(0, 0, 0);
  f.hp = 100;
  f.alive = true;
  f.bloom = 0;
  f.recoilDebt = 0;
  f.yaw = Math.atan2(f.pos.x, f.pos.z); // face the middle
  f.pitch = 0;
  if (f.isPlayer) {
    f.giveLoadout(['rifle', 'pistol', 'shotgun', 'sniper']);
    $('death').hidden = true;
    updateSlotsHud();
  } else {
    const primary = ['rifle', 'rifle', 'shotgun', 'sniper', 'pistol'][(Math.random() * 5) | 0];
    f.giveLoadout(primary === 'pistol' ? ['pistol'] : [primary, 'pistol']);
    f.ai.path = null; f.ai.target = null; f.ai.goal = null; f.ai.seenSince = -1;
    f.ch.root.visible = true;
  }
}

// ---------- bots ----------
function canSee(from, to) {
  const a = from.eye(), b = to.eye().setY(to.pos.y + 1.2);
  const d = new V3().subVectors(b, a), dist = d.length();
  d.divideScalar(dist);
  return raycastWorld(a, d, dist).t >= dist - 0.01;
}

function pickTarget(b) {
  const fwd = dirFrom(b.yaw, 0);
  let best = null, bestScore = Infinity;
  for (const o of fighters) {
    if (o === b || !o.alive) continue;
    const to = new V3().subVectors(o.pos, b.pos), dist = to.length();
    if (dist > 70) continue;
    to.y = 0; to.normalize();
    const inView = to.dot(fwd) > -0.1 || dist < 7 || o === b.ai.target;
    if (!inView || !canSee(b, o)) continue;
    const score = dist - (o === b.ai.target ? 8 : 0);
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

function goTo(b, x, z) {
  const ai = b.ai;
  ai.goal = new V3(x, 0, z);
  ai.path = nav.findPath(b.pos.x, b.pos.z, x, z);
  ai.pi = 0;
  ai.repath = clock + 2.5;
}

// Returns a unit xz direction along the current path, or null when done.
function followPath(b) {
  const ai = b.ai;
  if (!ai.path || ai.pi >= ai.path.length) return null;
  // Skip ahead to the furthest point we can walk to directly.
  for (let k = Math.min(ai.path.length - 1, ai.pi + 6); k > ai.pi; k--) {
    if (nav.lineClear(b.pos.x, b.pos.z, ai.path[k].x, ai.path[k].z)) { ai.pi = k; break; }
  }
  const p = ai.path[ai.pi];
  const d = new V3(p.x - b.pos.x, 0, p.z - b.pos.z);
  if (d.length() < 0.5) { ai.pi++; return followPath(b); }
  return d.normalize();
}

function updateBot(b, dt) {
  const ai = b.ai, diff = DIFFS[settings.diff], def = b.w.def;
  tickWeapon(b);
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = 0.2 + Math.random() * 0.15;
    const t = pickTarget(b);
    if (t !== ai.target || ai.seenSince < 0) {
      if (t) { ai.seenSince = clock; ai.aimYaw = (Math.random() - 0.5) * 0.5; ai.aimPitch = (Math.random() - 0.5) * 0.25; }
      else ai.seenSince = -1;
    }
    if (t || !ai.target || !ai.target.alive) ai.target = t;
    ai.visible = !!t;
    if (t) { ai.lastSeen = t.pos.clone(); ai.lastSeenAt = clock; }
  }
  const tgt = ai.target && ai.target.alive ? ai.target : null;
  const move = new V3();

  if (tgt && ai.visible) {
    const eye = b.eye();
    const aim = new V3(tgt.pos.x, tgt.pos.y + 1.15, tgt.pos.z).addScaledVector(tgt.vel, 0.08).sub(eye);
    const dist = aim.length();
    const settle = Math.exp(-diff.settle * dt);
    ai.aimYaw *= settle;
    ai.aimPitch *= settle;
    const wantYaw = Math.atan2(-aim.x, -aim.z) + ai.aimYaw;
    const wantPitch = Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) + ai.aimPitch;
    const dy = wrap(wantYaw - b.yaw), maxTurn = diff.turn * dt;
    b.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    b.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - b.pitch));

    // Pick the weapon that suits the range.
    if (b.slots.length > 1 && !b.w.reloading) {
      const want = b.slots[0].mag === 0 && b.slots[0].reserve === 0 ? 1
        : dist < 9 && b.slots[0].def.id === 'sniper' ? 1 : 0;
      switchTo(b, want);
    }
    if (b.w.mag === 0) startReload(b);
    if (clock - ai.seenSince > diff.react && Math.abs(dy) < 0.12 && clock >= ai.pauseUntil && canFire(b)) {
      const spread = diff.spread + def.spread * 0.5 + Math.hypot(b.vel.x, b.vel.z) * 0.003;
      shoot(b, b.eye(), dirFrom(b.yaw, b.pitch), spread, b.ch.muzzle.getWorldPosition(new V3()));
      if (--ai.burst <= 0) {
        ai.burst = diff.burst[0] + ((Math.random() * (diff.burst[1] - diff.burst[0] + 1)) | 0);
        if (def.auto) ai.pauseUntil = clock + 0.25 + Math.random() * 0.5;
      }
    }
    // Keep the preferred range and strafe.
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = 0.5 + Math.random() * 1.2; }
    const fwd = new V3(aim.x, 0, aim.z).normalize();
    const side = new V3(-fwd.z, 0, fwd.x);
    const pref = b.w.def.pref;
    if (dist > pref + 6) {
      if (!ai.path || clock > ai.repath) goTo(b, tgt.pos.x, tgt.pos.z);
      const d = followPath(b);
      if (d) move.copy(d); else move.copy(fwd);
      move.addScaledVector(side, ai.strafe * 0.4);
    } else {
      move.addScaledVector(side, ai.strafe);
      if (dist < pref - 4) move.addScaledVector(fwd, -0.6);
      ai.path = null;
    }
    ai.jumpT -= dt;
    if (ai.jumpT <= 0 && b.onGround) { ai.jumpT = 1.5 + Math.random() * 4; if (Math.random() < 0.3) b.vel.y = JUMP; }
  } else {
    if (b.w.mag < b.w.def.mag * 0.5) startReload(b);
    if (!b.w.reloading && b.cur !== 0) switchTo(b, 0);
    if (ai.lastSeen && clock - ai.lastSeenAt < 6) {
      if (!ai.goal || ai.goal.distanceTo(ai.lastSeen) > 2) goTo(b, ai.lastSeen.x, ai.lastSeen.z);
    } else if (!ai.path || ai.pi >= ai.path.length) {
      // Wander, drifting toward other fighters so fights happen.
      const others = fighters.filter((o) => o !== b && o.alive);
      const p = others.length && Math.random() < 0.6 ? others[(Math.random() * others.length) | 0].pos : nav.randomOpen();
      goTo(b, p.x + (Math.random() - 0.5) * 8, p.z + (Math.random() - 0.5) * 8);
    }
    const d = followPath(b);
    if (d) {
      move.copy(d);
      const want = Math.atan2(-d.x, -d.z);
      b.yaw += wrap(want - b.yaw) * Math.min(1, dt * 6);
      b.pitch *= 1 - Math.min(1, dt * 4);
    } else if (ai.lastSeen && clock - ai.lastSeenAt < 6) ai.lastSeenAt = -99;
  }

  const speed = tgt && ai.visible ? 4.6 : 5.4;
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
  const k = Math.min(1, (b.onGround ? 10 : 2) * dt);
  b.vel.x += (move.x - b.vel.x) * k;
  b.vel.z += (move.z - b.vel.z) * k;
  const before = b.pos.clone();
  moveBody(b, dt);
  // Unstick: if we wanted to move but barely did, pick a new route.
  if (move.lengthSq() > 1 && before.distanceTo(b.pos) < speed * dt * 0.2) {
    ai.stuckT += dt;
    if (ai.stuckT > 0.6) { ai.stuckT = 0; ai.path = null; ai.strafe *= -1; const p = nav.randomOpen(); goTo(b, p.x, p.z); }
  } else ai.stuckT = 0;
}

// ---------- input ----------
const keys = {};
const input = { dx: 0, dy: 0, fire: false, firePressed: false, ads: false };
let locked = false;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); if (state !== 'menu') $('board').hidden = false, renderBoard(); }
  if (state !== 'playing' || !player) return;
  if (e.code.startsWith('Digit')) switchTo(player, +e.code.slice(5) - 1);
  if (e.code === 'KeyR' && player.alive) startReload(player);
  if (e.code === 'KeyQ') switchTo(player, player.lastSlot ?? 1);
  if (e.code === 'KeyM') { sfx.setMuted(!sfx.isMuted()); }
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab' && state !== 'over') $('board').hidden = true;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.fire = input.ads = false; });

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  // Some browsers report a huge jump when the pointer is re-locked; drop it.
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  input.dx += e.movementX;
  input.dy += e.movementY;
});
canvas.addEventListener('mousedown', (e) => {
  if (state === 'playing' && !locked) lock();
  if (e.button === 0) { input.fire = true; input.firePressed = true; }
  if (e.button === 2) input.ads = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.ads = false;
});
addEventListener('contextmenu', (e) => { if (state === 'playing') e.preventDefault(); });
addEventListener('wheel', (e) => {
  if (state !== 'playing' || !player) return;
  const n = player.slots.length;
  switchTo(player, (player.cur + (e.deltaY > 0 ? 1 : n - 1)) % n);
}, { passive: true });

function lock() {
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* unsupported */ }
}
document.addEventListener('pointerlockchange', () => {
  const was = locked;
  locked = document.pointerLockElement === canvas;
  if (was && !locked && state === 'playing') pause();
});

// ---------- player ----------
const vmAnim = { bob: 0, kick: 0, swap: 0, ads: 0, sway: new V3(), landDip: 0 };
let fov = 75, eyeY = 0;

function updatePlayer(dt) {
  const p = player;
  tickWeapon(p);
  if (!p.alive) {
    // Death cam: drop to the floor and look at the killer.
    camera.position.lerp(new V3(p.pos.x, p.pos.y + 0.4, p.pos.z), Math.min(1, dt * 4));
    const k = p.killer;
    if (k && k !== p && k.alive) {
      const d = k.eye().sub(camera.position);
      const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      p.yaw += wrap(yaw - p.yaw) * Math.min(1, dt * 5);
      p.pitch += (pitch - p.pitch) * Math.min(1, dt * 5);
    }
    camera.rotation.set(p.pitch, p.yaw, 0.3);
    const left = Math.max(0, p.respawnAt - clock);
    $('death-timer').textContent = left.toFixed(1);
    if (left <= 0) respawn(p);
    return;
  }

  const w = p.w, def = w.def;
  const adsTarget = input.ads && !w.reloading && clock >= p.switchEnd ? 1 : 0;
  vmAnim.ads += (adsTarget - vmAnim.ads) * Math.min(1, dt * 14);
  const scoped = def.scope && vmAnim.ads > 0.85;

  const sensScale = 0.0022 * settings.sens * (fov / 75);
  p.yaw -= input.dx * sensScale;
  p.pitch -= input.dy * sensScale;
  // Pulling down against the kick counts toward recovery, so it doesn't overshoot.
  if (input.dy > 0 && p.recoilDebt > 0) p.recoilDebt = Math.max(0, p.recoilDebt - input.dy * sensScale);
  p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch));
  vmAnim.sway.x += input.dx * 0.00015;
  vmAnim.sway.y += input.dy * 0.00015;
  input.dx = input.dy = 0;

  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const crouch = keys.ControlLeft || keys.KeyC;
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && f > 0 && vmAnim.ads < 0.3 && !crouch;
  const speed = vmAnim.ads > 0.5 ? 3.6 : crouch ? 3 : sprint ? 8.6 : 6.2;
  const wish = new V3(-Math.sin(p.yaw) * f + Math.cos(p.yaw) * s, 0, -Math.cos(p.yaw) * f - Math.sin(p.yaw) * s);
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
  const k = Math.min(1, (p.onGround ? 14 : 2.5) * dt);
  p.vel.x += (wish.x - p.vel.x) * k;
  p.vel.z += (wish.z - p.vel.z) * k;
  if (keys.Space && p.onGround) { p.vel.y = JUMP; p.onGround = false; sfx.jump(); }
  const fallSpeed = p.vel.y;
  const wasGround = p.onGround;
  p.stepUp = 0;
  moveBody(p, dt);
  if (!wasGround && p.onGround && fallSpeed < -6) vmAnim.landDip = Math.min(0.12, -fallSpeed * 0.01);

  // Camera: smooth out stair steps, lower when crouching.
  eyeY -= p.stepUp || 0;
  eyeY += (0 - eyeY) * Math.min(1, dt * 14);
  const crouchDrop = crouch ? 0.45 : 0;
  vmAnim.crouch = (vmAnim.crouch || 0) + (crouchDrop - (vmAnim.crouch || 0)) * Math.min(1, dt * 12);
  camera.position.set(p.pos.x, p.pos.y + EYE + eyeY - vmAnim.crouch - vmAnim.landDip, p.pos.z);
  vmAnim.landDip *= Math.exp(-dt * 8);

  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround) vmAnim.bob += dt * hSpeed * 1.5;
  const bobAmt = Math.min(1, hSpeed / 6) * (1 - vmAnim.ads * 0.9) * (p.onGround ? 1 : 0.2);
  camera.rotation.set(p.pitch + vmAnim.kick * 0.006, p.yaw, Math.sin(vmAnim.bob) * 0.004 * bobAmt);

  // Shooting
  p.bloom = Math.max(0, p.bloom - dt * 0.12);
  const baseSpread = def.spread + (def.adsSpread - def.spread) * vmAnim.ads;
  const spread = baseSpread + p.bloom + def.moveSpread * Math.min(1, hSpeed / 6) + (p.onGround ? 0 : 0.04) - (crouch ? baseSpread * 0.3 : 0);
  if (input.fire && (def.auto || input.firePressed)) {
    if (w.mag === 0 && !w.reloading) { if (input.firePressed) sfx.empty(); startReload(p); }
    else if (canFire(p)) {
      const vm = viewModels[p.cur];
      const muzzle = scoped ? camera.localToWorld(new V3(0, -0.1, -0.5)) : camera.localToWorld(vm.muzzle.getWorldPosition(new V3()));
      shoot(p, camera.position.clone(), camera.getWorldDirection(new V3()), Math.max(0, spread), muzzle);
      p.bloom = Math.min(0.06, p.bloom + (def.auto ? 0.004 : 0.01));
      // Kick the aim up (less when aiming down sights); it settles back below.
      const kick = def.recoil * (0.8 + Math.random() * 0.4) * (1 - vmAnim.ads * 0.35);
      p.pitch += kick;
      p.recoilDebt = (p.recoilDebt || 0) + kick;
      p.yaw += (Math.random() - 0.5) * def.recoil * 0.3;
      vmAnim.kick = 1;
      vm.flash.visible = !scoped;
      vm.flash.rotation.z = Math.random() * Math.PI;
      vm.flashT = 0.05;
    }
  }
  input.firePressed = false;
  // Recoil recovery: pull the aim back toward where it was before firing.
  if (p.recoilDebt > 0 && clock >= w.next - 0.02) {
    const back = Math.min(p.recoilDebt, p.recoilDebt * dt * 8 + dt * 0.02);
    p.pitch -= back;
    p.recoilDebt -= back;
  }
  if (w.mag === 0 && !w.reloading && w.reserve > 0 && clock >= w.next + 0.2) startReload(p);

  if (p.hp < 100 && clock - p.lastHurt > REGEN_DELAY) p.hp = Math.min(100, p.hp + REGEN_RATE * dt);

  // FOV / scope
  const targetFov = 75 + (def.adsFov - 75) * vmAnim.ads + (sprint && hSpeed > 7 ? 6 : 0);
  fov += (targetFov - fov) * Math.min(1, dt * 16);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  $('scope').hidden = !scoped;

  // View model
  viewModels.forEach((v, i) => { v.group.visible = i === p.cur && !scoped; });
  const vm = viewModels[p.cur];
  if (vm.flashT !== undefined && (vm.flashT -= dt) <= 0) vm.flash.visible = false;
  vmAnim.kick *= Math.exp(-dt * 14);
  vmAnim.swap *= Math.exp(-dt * 10);
  vmAnim.sway.multiplyScalar(Math.exp(-dt * 10));
  const a = vmAnim.ads, hip = def.hip, ad = def.ads;
  const g = vm.group;
  g.position.set(
    hip[0] + (ad[0] - hip[0]) * a + Math.cos(vmAnim.bob * 0.5) * 0.012 * bobAmt - vmAnim.sway.x * (1 - a),
    hip[1] + (ad[1] - hip[1]) * a + Math.abs(Math.sin(vmAnim.bob * 0.5)) * 0.012 * bobAmt + vmAnim.sway.y * (1 - a) - vmAnim.swap * 0.3 - (sprint ? 0.04 : 0),
    hip[2] + (ad[2] - hip[2]) * a + vmAnim.kick * 0.06,
  );
  let rx = vmAnim.kick * 0.12 * (1 - a * 0.6), ry = sprint ? 0.5 : 0, rz = sprint ? 0.2 : 0;
  if (w.reloading) {
    const t = 1 - (w.reloadEnd - clock) / def.reload, dip = Math.sin(Math.min(1, t) * Math.PI);
    g.position.y -= dip * 0.12;
    rx -= dip * 0.5;
    rz += dip * 0.6;
  }
  g.rotation.set(rx, ry * (1 - a), rz * (1 - a));
  vmCamera.fov = 60 - a * 8;
  vmCamera.updateProjectionMatrix();
}

// ---------- HUD ----------
const hud = {
  hp: $('hp-num'), hpFill: $('hp-fill'), ammo: $('ammo-mag'), reserve: $('ammo-res'), wname: $('weapon-name'),
  timer: $('timer'), cross: $('crosshair'), hit: $('hitmarker'), feed: $('feed'), slots: $('slots'),
  lead: $('lead'), you: $('you'), vignette: $('vignette'), reload: $('reload-hint'),
};

function updateSlotsHud() {
  hud.slots.innerHTML = '';
  player.slots.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slot' + (i === player.cur ? ' on' : '');
    el.innerHTML = `<b>${i + 1}</b>${s.def.name}`;
    hud.slots.appendChild(el);
  });
  if (player.cur !== player.prevSlot) { player.lastSlot = player.prevSlot ?? 1; player.prevSlot = player.cur; }
}

let hitTimer = 0;
function showHitmarker(head, kill) {
  hud.hit.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
  hitTimer = kill ? 0.35 : 0.18;
  sfx.hit(head);
}

function damageIndicator(from) {
  const d = new V3().subVectors(from.pos, player.pos);
  const ang = Math.atan2(-d.x, -d.z) - player.yaw;
  const el = document.createElement('div');
  el.className = 'dmg';
  el.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
  $('dmg-layer').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function addFeed(killer, victim, head) {
  const el = document.createElement('div');
  el.className = 'feed-row' + (killer.isPlayer || victim.isPlayer ? ' me' : '');
  const icon = { pistol: 'PST', rifle: 'AR', shotgun: 'SG', sniper: 'SNP' }[killer.w.def.id];
  el.innerHTML = `<span style="color:${hex(killer.color)}"></span><i>${icon}${head ? ' ✹' : ''}</i><span style="color:${hex(victim.color)}"></span>`;
  el.children[0].textContent = killer.name;
  el.children[2].textContent = victim.name;
  hud.feed.prepend(el);
  while (hud.feed.children.length > 6) hud.feed.lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}

let announceTimer = 0;
function announce(text, small) {
  const el = $('announce');
  el.textContent = text;
  el.className = small ? 'small show' : 'show';
  announceTimer = 1.6;
  if (!small) sfx.streak();
}

function ranked() {
  return [...fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

function renderBoard() {
  const rows = ranked().map((f, i) => `<tr class="${f.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${hex(f.color)}"></i><span></span></td><td>${f.kills}</td><td>${f.deaths}</td><td>${(f.kills / Math.max(1, f.deaths)).toFixed(2)}</td></tr>`);
  $('board-body').innerHTML = rows.join('');
  const spans = $('board-body').querySelectorAll('span');
  ranked().forEach((f, i) => { spans[i].textContent = f.name; });
}

function updateHud(dt) {
  const p = player;
  const hp = Math.ceil(p.hp);
  hud.hp.textContent = hp;
  hud.hpFill.style.width = hp + '%';
  hud.hpFill.className = hp < 35 ? 'low' : '';
  hud.vignette.style.opacity = p.alive ? Math.max(0, (60 - p.hp) / 60) * 0.9 : 0.5;
  const w = p.w;
  hud.ammo.textContent = w.reloading ? '··' : w.mag;
  hud.ammo.className = w.mag <= w.def.mag * 0.25 ? 'low' : '';
  hud.reserve.textContent = w.reserve === Infinity ? '∞' : w.reserve;
  hud.wname.textContent = w.def.name;
  hud.reload.hidden = !(p.alive && !w.reloading && w.mag <= w.def.mag * 0.25 && w.reserve > 0);
  hud.reload.textContent = w.mag === 0 ? 'Press R to reload' : 'Low ammo · R';
  const left = Math.max(0, matchEnd - clock);
  hud.timer.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  hud.timer.className = left < 30 ? 'low' : '';

  // Crosshair gap follows the actual spread.
  const def = w.def, hSpeed = Math.hypot(p.vel.x, p.vel.z);
  const spread = def.spread + (def.adsSpread - def.spread) * vmAnim.ads + p.bloom + def.moveSpread * Math.min(1, hSpeed / 6) + (p.onGround ? 0 : 0.04);
  const px = (spread / Math.tan((fov * Math.PI) / 360)) * (innerHeight / 2);
  hud.cross.style.setProperty('--gap', `${Math.max(4, Math.min(80, px))}px`);
  hud.cross.style.opacity = p.alive && !(def.scope && vmAnim.ads > 0.85) && vmAnim.ads < 0.7 ? 1 : 0;

  if ((hitTimer -= dt) <= 0) hud.hit.className = '';
  if ((announceTimer -= dt) <= 0) $('announce').classList.remove('show');

  const top = ranked();
  const rank = top.indexOf(p) + 1;
  hud.lead.textContent = '';
  const leader = top[0];
  hud.lead.append(`Leader: `);
  const ln = document.createElement('b');
  ln.textContent = `${leader.name} · ${leader.kills}`;
  hud.lead.append(ln);
  hud.you.textContent = `You: ${p.kills} / ${settings.kills}  ·  #${rank}`;
  if (!$('board').hidden) renderBoard();
}

// ---------- match flow ----------
let state = 'menu';
let matchEnd = 0;
let matchOver = false;

function clearFighters() {
  for (const f of fighters) if (f.ch) scene.remove(f.ch.root);
  fighters = [];
}

function startMatch() {
  sfx.init();
  clearFighters();
  clock = 0;
  matchOver = false;
  matchEnd = settings.minutes * 60;
  player = new Fighter(settings.name.trim().slice(0, 16) || 'Player', 0x3b6fd1, true);
  fighters.push(player);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < settings.bots; i++) fighters.push(new Fighter(names[i], COLORS[i % COLORS.length], false));
  for (const f of fighters) respawn(f);
  $('feed').innerHTML = '';
  for (const h of holes) scene.remove(h);
  holes.length = 0;
  $('menu').hidden = $('results').hidden = $('pause').hidden = $('death').hidden = $('board').hidden = true;
  $('hud').hidden = false;
  state = 'playing';
  lock();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  input.fire = input.ads = false;
  $('pause').hidden = false;
}

function resume() {
  sfx.init();
  state = 'playing';
  $('pause').hidden = true;
  lock();
}

function endMatch() {
  if (matchOver) return;
  matchOver = true;
  setTimeout(() => {
    state = 'over';
    if (document.pointerLockElement) document.exitPointerLock();
    const top = ranked();
    const place = top.indexOf(player) + 1;
    $('result-title').textContent = place === 1 ? 'Victory!' : `You placed #${place}`;
    $('result-sub').textContent = `${player.kills} kills · ${player.deaths} deaths`;
    renderBoard();
    $('board').hidden = false;
    $('results').hidden = false;
    $('hud').hidden = true;
    $('scope').hidden = true;
  }, 1200);
}

function toMenu() {
  state = 'menu';
  clearFighters();
  player = null;
  $('pause').hidden = $('results').hidden = $('board').hidden = $('hud').hidden = $('death').hidden = true;
  $('menu').hidden = false;
}

// Menu wiring
const nameIn = $('opt-name'), botsIn = $('opt-bots'), diffIn = $('opt-diff'), sensIn = $('opt-sens'), killsIn = $('opt-kills');
nameIn.value = settings.name;
botsIn.value = settings.bots;
diffIn.value = settings.diff;
sensIn.value = settings.sens;
killsIn.value = settings.kills;
const sensLabel = () => { $('sens-val').textContent = (+sensIn.value).toFixed(1); };
sensLabel();
sensIn.addEventListener('input', sensLabel);
$('play').addEventListener('click', () => {
  settings.name = nameIn.value || 'Player';
  settings.bots = +botsIn.value;
  settings.diff = diffIn.value;
  settings.sens = +sensIn.value;
  settings.kills = +killsIn.value;
  saveSettings();
  startMatch();
});
$('resume').addEventListener('click', resume);
$('quit').addEventListener('click', toMenu);
$('again').addEventListener('click', startMatch);
$('menu-btn').addEventListener('click', toMenu);
$('pause-sens').addEventListener('input', (e) => { settings.sens = +e.target.value; sensIn.value = settings.sens; sensLabel(); saveSettings(); });

// ---------- loop ----------
// Menu backdrop: the camera slowly circles the arena.
let menuAngle = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'playing') {
    clock += dt;
    updatePlayer(dt);
    for (const f of fighters) {
      if (f.isPlayer) continue;
      if (f.alive) updateBot(f, dt);
      else if (clock >= f.respawnAt && !matchOver) respawn(f);
      else if (clock >= f.respawnAt - 1) f.ch.root.visible = false;
      animateCharacter(f.ch, f, dt);
      f.ch.tag.visible = f.alive && f.pos.distanceTo(camera.position) < 35;
    }
    updateFx(dt);
    updateHud(dt);
    if (clock >= matchEnd) endMatch();
  } else if (state === 'menu') {
    menuAngle += dt * 0.08;
    camera.position.set(Math.cos(menuAngle) * 38, 16, Math.sin(menuAngle) * 38);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (player && player.alive && state !== 'menu') {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
}
requestAnimationFrame(frame);

// For quick checks from the console.
window.__arena = { input, vmAnim, get state() { return state; }, get fighters() { return fighters; }, get player() { return player; } };
