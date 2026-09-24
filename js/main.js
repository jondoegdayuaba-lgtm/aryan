import * as THREE from 'three';
import { GAME_TITLE, TAGLINE, FLIGHT, SCORING, BOUNDS, SKINS } from './config.js';
import { makeTextures } from './textures.js';
import { buildWorld } from './world.js';
import { Missile } from './missile.js';
import { Effects } from './effects.js';
import { Tanks, ShieldPickups } from './targets.js';
import { Sound } from './audio.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// localStorage can be unavailable (private windows, blocked storage); the game works without it.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('missile-run:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('missile-run:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (coarse) document.body.classList.add('touch');

// ---------- Renderer, scene, camera ----------
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  $('loading').textContent = 'This game needs WebGL, which your browser could not start.';
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 4000);

const T = makeTextures();
const world = buildWorld(scene, T);
if (coarse) world.sun.shadow.mapSize.set(1024, 1024);
const missile = new Missile(scene, T);
const fx = new Effects(scene, camera);
const tanks = new Tanks(scene, world, 9);
const pickups = new ShieldPickups(scene, world.shieldSpots);
const sound = new Sound();
const input = new Input(canvas, $('btn-boost'));

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();
const tmp = {
  v: new THREE.Vector3(), aim: new THREE.Vector3(), fwd: new THREE.Vector3(), nose: new THREE.Vector3(),
  n: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), nz: new THREE.Vector3(),
  back: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(),
};

function aimDir(yaw, pitch, out) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

// ---------- Game state ----------
const S = {
  mode: 'menu',           // menu | ready | flying | dead | results | paused
  prevMode: null,
  time: 0,
  skin: clamp(store.get('skin', 0) | 0, 0, SKINS.length - 1),
  best: Number(store.get('best', 0)) || 0,
  muted: !!store.get('muted', false),
  round: null,
  aimYaw: 0, aimPitch: 0, speed: 0, fuel: 0, fallV: 0, engineOn: true,
  shield: false, invuln: 0, flightT: 0, readyT: 0, distance: 0, oob: 0,
  gatePrev: [], passed: new Set(), threaded: new Set(),
  lockTarget: null, locked: false, lockAngle: 0, lockDist: 0,
  deadT: 0, deadAt: new THREE.Vector3(), camDir: new THREE.Vector3(0, 0, -1), camLook: new THREE.Vector3(),
  boosting: false, throttle: 0, bankTarget: 0,
  cursorSteer: false, hadLock: false,
};
if (S.best < SKINS[S.skin].unlock) S.skin = 0;

// ---------- UI helpers ----------
const text = (el, value) => { if (el.textContent !== value) el.textContent = value; };

function setScreen(name) {
  $('menu').hidden = name !== 'menu';
  $('paused').hidden = name !== 'paused';
  $('results').hidden = name !== 'results';
  $('hud').hidden = !(name === 'hud' || name === 'paused');
}

function popup(html) {
  const box = $('popups');
  while (box.children.length > 2) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'popup';
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function renderSkin() {
  const skin = SKINS[S.skin];
  const ok = S.best >= skin.unlock;
  text($('skin-name'), skin.name);
  text($('skin-lock'), ok ? (skin.unlock ? 'Unlocked' : 'Starter skin') : `Reach a best of ${skin.unlock.toLocaleString()} to unlock`);
  $('btn-launch').disabled = !ok;
  text($('btn-launch'), ok ? 'Launch' : 'Locked');
  missile.setSkin(skin);
  if (ok) store.set('skin', S.skin);
  text($('best-menu'), S.best.toLocaleString());
}

function cycleSkin(d) {
  S.skin = (S.skin + d + SKINS.length) % SKINS.length;
  sound.click();
  renderSkin();
}

function renderSound() {
  text($('btn-sound'), S.muted ? 'Sound off' : 'Sound on');
}

function toggleMute() {
  S.muted = !S.muted;
  store.set('muted', S.muted);
  sound.setMuted(S.muted);
  renderSound();
}

// ---------- Pointer lock ----------
function wantLock() {
  if (input.usingTouch || coarse) return;
  input.requestLock();
  setTimeout(() => {
    if (!input.pointerLocked && ['ready', 'flying', 'dead'].includes(S.mode)) S.cursorSteer = true;
  }, 700);
}
document.addEventListener('pointerlockerror', () => { S.cursorSteer = true; });
input.onLockChange = (locked) => {
  if (locked) {
    S.cursorSteer = false;
    S.hadLock = true;
  } else if (S.hadLock && ['ready', 'flying', 'dead'].includes(S.mode)) {
    pause();
  }
};
canvas.addEventListener('click', () => {
  if (['ready', 'flying', 'dead'].includes(S.mode) && !input.pointerLocked) wantLock();
});
canvas.addEventListener('touchstart', () => document.body.classList.add('touch'), { passive: true });

// ---------- Round flow ----------
function startRound() {
  if (S.mode !== 'menu' && S.mode !== 'results') return;
  if (S.best < SKINS[S.skin].unlock) return;
  sound.init();
  sound.setMuted(S.muted);
  S.round = { missile: 0, score: 0, tanks: 0, gates: 0, threads: 0, streak: 0, bestStreak: 0 };
  tanks.reset();
  pickups.reset();
  fx.clear();
  setScreen('hud');
  nextMissile();
  wantLock();
}

function nextMissile() {
  const r = S.round;
  r.missile++;
  const sp = world.spawn;
  missile.root.position.copy(sp.pos);
  missile.root.quaternion.identity();
  missile.root.visible = true;
  missile.setShield(false);
  missile.floatScale = missile.floatVel = 0;
  Object.assign(S, {
    aimYaw: 0, aimPitch: 0, speed: 0, fuel: FLIGHT.fuelSeconds, fallV: 0, engineOn: true,
    shield: false, invuln: 0, flightT: 0, readyT: 0, distance: 0, oob: 0,
    lockTarget: null, locked: false, mode: 'ready',
  });
  S.passed.clear();
  S.threaded.clear();
  S.gatePrev = world.gates.map((g) => tmp.v.subVectors(sp.pos, g.center).dot(g.normal));
  world.gates.forEach((g) => g.mesh.material.emissive.set('#221400'));
  S.camDir.set(0, 0, -1);
  popup(`Missile <em>${r.missile}</em> of ${SCORING.missilesPerRound}`);
}

function endMissile(at) {
  missile.root.visible = false;
  S.deadAt.copy(at);
  S.mode = 'dead';
  S.deadT = 0;
  S.lockTarget = null;
  S.locked = false;
  S.throttle = 0;
}

function hitTank(tank) {
  const r = S.round;
  const at = tank.group.position.clone().setY(1.6);
  tanks.destroy(tank);
  r.tanks++;
  r.streak++;
  r.bestStreak = Math.max(r.bestStreak, r.streak);
  let pts = SCORING.tank * r.streak;
  popup(`Tank <em>down</em><span class="pts">+${pts}</span>`);
  if (r.streak > 1) popup(`Streak <em>x${r.streak}</em>`);
  if (S.distance > SCORING.longShotDistance) {
    pts += SCORING.longShot;
    popup(`Long <em>shot</em><span class="pts">+${SCORING.longShot}</span>`);
  }
  r.score += pts;
  fx.explode(at, 1.6);
  sound.explosion(1.2);
  endMissile(at);
}

function crash(message = 'Missile <em>lost</em>') {
  S.round.streak = 0;
  const at = missile.root.position.clone();
  fx.explode(at, 0.9);
  sound.explosion(0.8);
  popup(message);
  endMissile(at);
}

function bounce(normal, fwd) {
  const m = missile.root;
  const out = fwd.clone().reflect(normal);
  if (out.dot(normal) < 0.3) out.addScaledVector(normal, 0.5).normalize();
  m.position.addScaledVector(normal, 1.6);
  S.aimYaw = Math.atan2(-out.x, -out.z);
  S.aimPitch = clamp(Math.asin(clamp(out.y, -1, 1)), -FLIGHT.maxPitch, FLIGHT.maxPitch);
  tmp.m.lookAt(ZERO, out, UP);
  m.quaternion.setFromRotationMatrix(tmp.m);
  S.camDir.copy(out);
  S.speed *= 0.7;
  S.shield = false;
  S.invuln = 0.4;
  missile.setShield(false);
  fx.pop(m.position);
  sound.pop();
  popup('Shield <em>popped</em>');
}

function showResults() {
  const r = S.round;
  const prevBest = S.best;
  const newBest = r.score > S.best;
  if (newBest) {
    S.best = r.score;
    store.set('best', S.best);
  }
  S.mode = 'results';
  S.hadLock = false;
  input.releaseLock();
  text($('result-title'), newBest && r.score > 0 ? 'New best!' : 'Round over');
  text($('result-score'), r.score.toLocaleString());
  const stats = [
    ['Tanks', `${r.tanks} / ${SCORING.missilesPerRound}`],
    ['Gates', String(r.gates)],
    ['Towers threaded', String(r.threads)],
    ['Best streak', `x${r.bestStreak}`],
    ['Best', S.best.toLocaleString()],
  ];
  $('result-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const fresh = SKINS.filter((s) => s.unlock > prevBest && s.unlock <= S.best);
  $('result-unlock').hidden = !fresh.length;
  if (fresh.length) text($('result-unlock'), `New skin unlocked: ${fresh.map((s) => s.name).join(', ')}`);
  setScreen('results');
  $('btn-again').focus({ preventScroll: true });
}

function toMenu() {
  S.mode = 'menu';
  S.round = null;
  S.hadLock = false;
  input.releaseLock();
  missile.root.visible = true;
  missile.root.position.copy(world.spawn.pos);
  missile.root.quaternion.identity();
  missile.setShield(false);
  fx.clear();
  tanks.reset();
  renderSkin();
  setScreen('menu');
}

function pause() {
  if (!['ready', 'flying', 'dead'].includes(S.mode)) return;
  S.prevMode = S.mode;
  S.mode = 'paused';
  S.hadLock = false;
  input.releaseLock();
  sound.flight(0, 0, false);
  setScreen('paused');
  $('btn-resume').focus({ preventScroll: true });
}

function resume() {
  if (S.mode !== 'paused') return;
  sound.init();
  S.mode = S.prevMode;
  setScreen('hud');
  wantLock();
}

// ---------- Per-mode updates ----------
function steer(dt, look) {
  const control = S.engineOn ? 1 : 0.25;
  if (input.pointerLocked) {
    S.aimYaw -= look.mx * FLIGHT.mouseSensitivity * control;
    S.aimPitch -= look.my * FLIGHT.mouseSensitivity * control;
  }
  S.aimYaw -= look.tx * FLIGHT.touchSensitivity * control;
  S.aimPitch -= look.ty * FLIGHT.touchSensitivity * control;
  if (S.cursorSteer && !input.usingTouch) {
    // No pointer lock: steer toward wherever the cursor sits relative to the centre.
    const dz = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.06) / 0.94;
    S.aimYaw -= dz(input.cursor.x) * 2.2 * dt * control;
    S.aimPitch -= dz(input.cursor.y) * 1.8 * dt * control;
  }
  const ax = input.keyAxes;
  S.aimYaw -= ax.x * FLIGHT.keyTurnSpeed * dt * control;
  S.aimPitch += ax.y * FLIGHT.keyTurnSpeed * dt * control;
  if (!S.engineOn) S.aimPitch -= 0.55 * dt;   // nose drops once the fuel is gone

  // Lock-on assist gently pulls the aim onto a locked tank.
  if (S.locked && S.lockTarget && S.engineOn) {
    tmp.v.copy(S.lockTarget.group.position);
    tmp.v.y += 1.6;
    tmp.v.sub(missile.root.position).normalize();
    const k = Math.min(1, dt * 2.4);
    S.aimYaw += angDiff(Math.atan2(-tmp.v.x, -tmp.v.z), S.aimYaw) * k;
    S.aimPitch += (Math.asin(clamp(tmp.v.y, -1, 1)) - S.aimPitch) * k;
  }
  S.aimPitch = clamp(S.aimPitch, -FLIGHT.maxPitch, FLIGHT.maxPitch);

  // Keep the aim within ~60 degrees of where the missile actually points.
  const fwd = missile.forward(tmp.fwd);
  aimDir(S.aimYaw, S.aimPitch, tmp.aim);
  const off = tmp.aim.angleTo(fwd);
  if (off > 1.05) {
    tmp.q.setFromUnitVectors(fwd, tmp.aim);
    tmp.q.slerp(new THREE.Quaternion(), 1 - 1.05 / off);
    tmp.aim.copy(fwd).applyQuaternion(tmp.q);
    S.aimYaw = Math.atan2(-tmp.aim.x, -tmp.aim.z);
    S.aimPitch = Math.asin(clamp(tmp.aim.y, -1, 1));
  }
}

function updateLock() {
  const prev = S.lockTarget;
  const wasLocked = S.locked;
  let best = null, bestScore = Infinity, bestAng = 0, bestDist = 0;
  aimDir(S.aimYaw, S.aimPitch, tmp.aim);
  for (const t of tanks.list) {
    if (!t.alive) continue;
    tmp.v.copy(t.group.position);
    tmp.v.y += 1.6;
    tmp.v.sub(missile.root.position);
    const d = tmp.v.length();
    if (d > 480 || d < 1) continue;
    const ang = tmp.v.angleTo(tmp.aim);
    if (ang > 0.42) continue;
    const score = ang * 3 + d / 400;
    if (score < bestScore) { bestScore = score; best = t; bestAng = ang; bestDist = d; }
  }
  S.lockTarget = best;
  S.lockAngle = bestAng;
  S.lockDist = bestDist;
  S.locked = !!best && bestAng < 0.14 && bestDist < 320;
  if (S.locked && (!wasLocked || prev !== best)) sound.lock();
}

function flyUpdate(dt, look) {
  const m = missile.root;
  const r = S.round;
  S.flightT += dt;
  S.invuln = Math.max(0, S.invuln - dt);

  steer(dt, look);

  // Engine and fuel.
  S.boosting = S.engineOn && input.boost;
  if (S.engineOn) {
    S.fuel -= dt * (S.boosting ? FLIGHT.boostDrain : 1);
    if (S.fuel <= 0) {
      S.fuel = 0;
      S.engineOn = false;
      S.boosting = false;
      popup('Out of <em>fuel</em>');
    }
  }
  const target = !S.engineOn ? 40 : S.boosting ? FLIGHT.boostSpeed : FLIGHT.cruiseSpeed;
  const ramp = Math.min(1, 0.3 + S.flightT * 1.6);
  S.speed += (target * ramp - S.speed) * (1 - Math.exp(-dt * (target > S.speed ? 2.6 : 1.2)));
  S.throttle = S.engineOn ? (S.boosting ? 1.6 : 1) : 0;

  // Turn toward the aim direction at a limited rate.
  aimDir(S.aimYaw, S.aimPitch, tmp.aim);
  tmp.m.lookAt(ZERO, tmp.aim, UP);
  tmp.q.setFromRotationMatrix(tmp.m);
  const rate = (S.boosting ? FLIGHT.boostTurnRate : FLIGHT.turnRate) * (S.engineOn ? 1 : 0.4);
  m.quaternion.rotateTowards(tmp.q, rate * dt);
  const fwd = missile.forward(tmp.fwd);
  S.bankTarget = clamp(angDiff(S.aimYaw, Math.atan2(-fwd.x, -fwd.z)) * 1.8, -1.2, 1.2);

  // Move in small steps so thin beams can't be skipped at high speed.
  if (!S.engineOn) S.fallV += 9.8 * dt;
  const dist = S.speed * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  for (let i = 0; i < steps; i++) {
    m.position.addScaledVector(fwd, dist / steps);
    m.position.y -= (S.fallV * dt) / steps;
    S.distance += dist / steps;
    tmp.nose.copy(m.position).addScaledVector(fwd, 2.1);
    const tank = tanks.hitTest(tmp.nose, 0.8);
    if (tank) return hitTank(tank);
    if (S.invuln > 0) continue;
    const n = world.colliders.test(tmp.nose, 0.45, tmp.n) || world.colliders.test(m.position, 0.5, tmp.n);
    if (n) {
      if (S.shield) { bounce(n, fwd); break; }
      return crash();
    }
  }

  // Gates: count a pass when we cross the ring's plane inside the ring.
  world.gates.forEach((g, i) => {
    tmp.v.subVectors(m.position, g.center);
    const d = tmp.v.dot(g.normal);
    const prev = S.gatePrev[i];
    S.gatePrev[i] = d;
    if (S.passed.has(i) || Math.sign(d) === Math.sign(prev)) return;
    tmp.v.addScaledVector(g.normal, -d);
    if (tmp.v.length() < g.R - g.r) {
      S.passed.add(i);
      r.gates++;
      r.score += SCORING.gate;
      S.fuel = Math.min(FLIGHT.fuelSeconds, S.fuel + SCORING.gateFuel);
      g.mesh.material.emissive.set('#0c7d86');
      fx.sparkle(g.center, '#5ff0ff');
      sound.gate();
      popup(`Gate <em>clear</em><span class="pts">+${SCORING.gate}</span>`);
    }
  });

  // Threading a lattice tower from the inside.
  world.towers.forEach((t, i) => {
    if (S.threaded.has(i)) return;
    const p = m.position;
    if (p.y < 3 || p.y > t.h - 1) return;
    const half = THREE.MathUtils.lerp(t.baseHalf, t.topHalf, p.y / t.h) - 1.2;
    if (Math.abs(p.x - t.x) < half && Math.abs(p.z - t.z) < half) {
      S.threaded.add(i);
      r.threads++;
      r.score += SCORING.thread;
      sound.thread();
      popup(`Threaded <em>the tower</em><span class="pts">+${SCORING.thread}</span>`);
    }
  });

  if (!S.shield && pickups.collect(m.position, 5.5)) {
    S.shield = true;
    missile.setShield(true);
    sound.shield();
    popup('Shield <em>on</em>');
  }

  // Leaving the map starts a self-destruct countdown.
  const p = m.position;
  const out = p.x < BOUNDS.minX || p.x > BOUNDS.maxX || p.z < BOUNDS.minZ || p.z > BOUNDS.maxZ || p.y > BOUNDS.maxY;
  S.oob = out ? S.oob + dt : 0;
  if (S.oob > 3) return crash('Self <em>destructed</em>');

  updateLock();
  fx.exhaust(missile.nozzleWorld(tmp.nz), tmp.back.copy(fwd).negate(), S.speed, S.throttle, dt);
}

function chaseCamera(dt) {
  const m = missile.root;
  const want = S.engineOn ? aimDir(S.aimYaw, S.aimPitch, tmp.aim) : missile.forward(tmp.aim);
  S.camDir.lerp(want, 1 - Math.exp(-dt * 9)).normalize();
  const right = tmp.r.crossVectors(S.camDir, UP).normalize();
  const camUp = tmp.u.crossVectors(right, S.camDir).normalize();
  camera.position.copy(m.position).addScaledVector(S.camDir, -9).addScaledVector(camUp, 2.3);
  if (camera.position.y < 0.8) camera.position.y = 0.8;
  S.camLook.copy(m.position).addScaledVector(S.camDir, 60);
  camera.up.copy(camUp);
  camera.lookAt(S.camLook);
}

function orbitCamera(center, radius, height) {
  const a = S.time * 0.22;
  camera.up.set(0, 1, 0);
  camera.position.set(
    center.x + Math.sin(a) * radius,
    center.y + height + Math.sin(S.time * 0.5) * 0.4,
    center.z + Math.cos(a) * radius,
  );
  camera.lookAt(center);
}

function update(dt) {
  S.time += dt;
  const look = input.consumeLook();
  let focus = world.spawn.pos;

  switch (S.mode) {
    case 'menu':
      missile.root.position.copy(world.spawn.pos);
      S.throttle = 0;
      S.bankTarget = 0;
      // Pull back on tall, narrow screens so the whole missile fits.
      orbitCamera(world.spawn.pos, 7.5 / Math.min(1, Math.max(camera.aspect, 0.55)), 2.2);
      break;
    case 'results':
      orbitCamera(S.deadAt, 55, 34);
      focus = S.deadAt;
      break;
    case 'ready':
      S.readyT += dt;
      S.throttle = Math.min(1, S.readyT / 0.7) * 0.7;
      S.bankTarget = 0;
      chaseCamera(dt);
      fx.exhaust(missile.nozzleWorld(tmp.nz), tmp.back.set(0, 0, 1), 0, S.throttle, dt);
      if (S.readyT > 0.7) {
        S.mode = 'flying';
        sound.launch();
      }
      focus = missile.root.position;
      break;
    case 'flying':
      flyUpdate(dt, look);
      if (S.mode === 'flying') chaseCamera(dt);
      focus = S.mode === 'flying' ? missile.root.position : S.deadAt;
      break;
    case 'dead': {
      S.deadT += dt;
      tmp.v.subVectors(camera.position, S.deadAt).normalize();
      camera.position.addScaledVector(tmp.v, dt * 5);
      if (camera.position.y < 1) camera.position.y = 1;
      S.camLook.lerp(S.deadAt, 1 - Math.exp(-dt * 4));
      camera.lookAt(S.camLook);
      focus = S.deadAt;
      if (S.deadT > 2.4) {
        if (S.round.missile >= SCORING.missilesPerRound) showResults();
        else nextMissile();
      }
      break;
    }
  }

  // Camera shake from explosions.
  if (fx.shake > 0 && S.mode !== 'menu') {
    const s = fx.shake * 0.5;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }

  const flying = S.mode === 'flying' || S.mode === 'ready';
  const boostF = clamp((S.speed - FLIGHT.cruiseSpeed) / (FLIGHT.boostSpeed - FLIGHT.cruiseSpeed), 0, 1);
  const fov = flying || S.mode === 'dead' ? 72 + boostF * 12 : 50;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 4));
  }

  missile.update(dt, { throttle: S.throttle, bankTarget: S.bankTarget, time: S.time });
  tanks.update(dt, S.mode === 'flying' ? missile.root.position : null);
  pickups.update(dt, S.time);
  fx.updateStreaks(dt, missile.root.position, S.camDir, S.mode === 'flying' ? boostF : 0);
  fx.update(dt);
  world.followShadow(focus);
  sound.flight(S.speed / FLIGHT.boostSpeed, S.throttle, S.mode === 'flying');
  updateHud();
}

// ---------- HUD ----------
const hud = {
  score: $('score'), missile: $('hud-missile'), combo: $('combo'), fuel: $('fuel-fill'),
  speed: $('speed'), lock: $('lock'), lockDist: $('lock-dist'), warning: $('warning'),
};
const projected = new THREE.Vector3();

function updateHud() {
  const r = S.round;
  if (!r || $('hud').hidden) return;
  text(hud.score, r.score.toLocaleString());
  text(hud.missile, `Missile ${r.missile} / ${SCORING.missilesPerRound}`);
  hud.combo.hidden = r.streak < 1;
  text(hud.combo, `Next hit x${r.streak + 1}`);
  const f = S.fuel / FLIGHT.fuelSeconds;
  hud.fuel.style.transform = `scaleX(${f.toFixed(3)})`;
  hud.fuel.classList.toggle('low', f < 0.25);
  text(hud.speed, String(Math.round(S.speed * 3.6)));

  const show = S.mode === 'flying' && S.lockTarget;
  if (show) {
    projected.copy(S.lockTarget.group.position);
    projected.y += 1.6;
    projected.project(camera);
    const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
    hud.lock.classList.toggle('show', onScreen);
    hud.lock.classList.toggle('locked', S.locked);
    if (onScreen) {
      const x = ((projected.x + 1) / 2) * innerWidth;
      const y = ((1 - projected.y) / 2) * innerHeight;
      hud.lock.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      text(hud.lockDist, S.locked ? `LOCKED ${Math.round(S.lockDist)}m` : `${Math.round(S.lockDist)}m`);
    }
  } else {
    hud.lock.classList.remove('show', 'locked');
  }

  hud.warning.hidden = !(S.mode === 'flying' && S.oob > 0);
  if (S.oob > 0) text(hud.warning, `Return to the area ${Math.ceil(3 - S.oob)}`);
}

// ---------- Menu wiring ----------
text($('title-a'), GAME_TITLE[0]);
text($('title-b'), GAME_TITLE[1] ?? '');
document.title = GAME_TITLE.join(' ').replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase());
text($('tagline'), TAGLINE);

$('skin-prev').addEventListener('click', () => cycleSkin(-1));
$('skin-next').addEventListener('click', () => cycleSkin(1));
$('btn-launch').addEventListener('click', startRound);
$('btn-again').addEventListener('click', startRound);
$('btn-menu').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-quit').addEventListener('click', toMenu);
$('btn-pause').addEventListener('click', pause);
$('btn-sound').addEventListener('click', () => { sound.init(); toggleMute(); });

input.onKey = (code) => {
  const onButton = document.activeElement?.tagName === 'BUTTON';
  if (code === 'KeyM') { sound.init(); toggleMute(); return; }
  switch (S.mode) {
    case 'menu':
      if (!onButton && (code === 'Enter' || code === 'Space')) startRound();
      if (code === 'ArrowLeft') cycleSkin(-1);
      if (code === 'ArrowRight') cycleSkin(1);
      break;
    case 'results':
      if (!onButton && (code === 'Enter' || code === 'Space')) startRound();
      if (code === 'Escape') toMenu();
      break;
    case 'paused':
      if (!onButton && (code === 'Enter' || code === 'Space')) resume();
      break;
    case 'ready': case 'flying': case 'dead':
      if (code === 'Escape' || code === 'KeyP') pause();
      break;
  }
};

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// In the menu, shift the picture so the missile sits beside (desktop) or above (phone) the panel.
function applyViewOffset() {
  const W = innerWidth, H = innerHeight;
  if (S.mode === 'menu') {
    if (W > 640) camera.setViewOffset(W, H, -Math.min(240, W * 0.2), 0, W, H);
    else camera.setViewOffset(W, H, 0, H * 0.32, W, H);
  } else if (camera.view && camera.view.enabled) {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}

// ---------- Main loop ----------
renderSkin();
renderSound();
setScreen('menu');
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.mode !== 'paused') update(dt);
  applyViewOffset();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
update(0.016);
renderer.render(scene, camera);
$('loading').hidden = true;
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = { S, world, missile, tanks, camera };
