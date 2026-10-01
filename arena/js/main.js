import * as THREE from 'three';
import {
  GAME_TITLE, TAGLINE, MOVE, PLAYER, WEAPONS, PRIMARIES, GUN_GAME, MODES, DIFFICULTY,
  BOT_NAMES, TEAM_COLORS, FFA_COLORS,
} from './config.js';
import { buildMap, HALF } from './map.js';
import { moveBody, accelerate } from './physics.js';
import { Actor, buildModel, setModelGun, animateModel } from './actors.js';
import { gunModel, ViewModel } from './weapons.js';
import { Effects } from './effects.js';
import { Combat, isEnemy } from './combat.js';
import { initBrain, updateBot } from './bots.js';
import { Sound } from './audio.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hex = (c) => '#' + new THREE.Color(c).getHexString();

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('block-brawl:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('block-brawl:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const touchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (touchDevice) document.body.classList.add('touch');

// ---------- Renderer & world ----------
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  $('loading').textContent = 'This game needs WebGL, which your browser could not start.';
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, touchDevice ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(PLAYER.fov, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
const map = buildMap(scene);
if (touchDevice) map.sun.shadow.mapSize.set(1024, 1024);
const fx = new Effects(scene);
const sound = new Sound();
const input = new Input(canvas);
const actors = [];
let player = null;
const combat = new Combat({
  scene, map, fx, sound, actors,
  listener: () => ({ pos: player ? player.pos : camera.position, yaw: player ? player.yaw : 0 }),
});

// ---------- Settings ----------
const settings = {
  mode: store.get('mode', 'ffa'),
  difficulty: store.get('difficulty', 'normal'),
  primary: store.get('primary', 'rifle'),
  bots: store.get('bots', 7),
  sens: store.get('sens', 1),
  muted: store.get('muted', false),
};
if (!MODES[settings.mode]) settings.mode = 'ffa';
if (!DIFFICULTY[settings.difficulty]) settings.difficulty = 'normal';
if (!PRIMARIES.includes(settings.primary)) settings.primary = 'rifle';
sound.setMuted(settings.muted);

// ---------- Match state ----------
let state = 'menu';          // menu | playing | paused | over
let now = 0;                 // match clock (seconds), only runs while playing
let matchEnd = 0;
let mode = MODES.ffa;
let modeId = 'ffa';
let skill = DIFFICULTY.normal;
const teamKills = [0, 0];
const stats = { shots: 0, hits: 0, heads: 0, bestStreak: 0 };
let viewmodel = null;
let camBob = 0, camStepY = 0, adsK = 0, recoilPitch = 0, bloom = 0, stepDist = 0, shake = 0;
let fireLatch = false;

function loadout(actor) {
  if (modeId === 'gungame') {
    const id = GUN_GAME[Math.min(actor.gunLevel, GUN_GAME.length - 1)];
    return id === 'knife' ? ['knife'] : [id, 'knife'];
  }
  const primary = actor.isPlayer ? settings.primary : actor.botPrimary;
  return [primary, 'pistol', 'knife'];
}

function equip(actor, keepSlot = false) {
  actor.weapons = loadout(actor);
  if (!keepSlot || actor.slot >= actor.weapons.length) actor.slot = 0;
  for (const id of actor.weapons) {
    const w = WEAPONS[id];
    const infinite = modeId === 'gungame';
    if (!actor.ammo[id] || !keepSlot) actor.ammo[id] = { mag: w.mag, reserve: infinite ? Infinity : w.reserve };
  }
  actor.reloadUntil = 0;
  actor.switchUntil = now + 0.3;
  onWeaponChanged(actor);
}

function onWeaponChanged(actor) {
  if (actor.isPlayer) viewmodel?.setWeapon(actor.weapon);
  else if (actor.model) setModelGun(actor, gunModel(actor.weapon));
}

function pickSpawn(actor) {
  const enemies = actors.filter((a) => a.alive && isEnemy(actor, a));
  const scored = map.spawns.map((s) => {
    let d = 999;
    for (const e of enemies) d = Math.min(d, s.distanceTo(e.pos));
    // In team modes, prefer your team's half of the map.
    if (mode.teams) d += (actor.team === 0 ? -s.z : s.z) * 0.6;
    return { s, d: d + Math.random() * 6 };
  }).sort((a, b) => b.d - a.d);
  return scored[(Math.random() * Math.min(3, scored.length)) | 0].s;
}

function spawn(actor) {
  const s = pickSpawn(actor);
  actor.pos.set(s.x + (Math.random() - 0.5) * 2, 0, s.z + (Math.random() - 0.5) * 2);
  actor.vel.set(0, 0, 0);
  actor.yaw = Math.atan2(actor.pos.x, actor.pos.z);   // face the middle
  actor.pitch = 0;
  actor.health = PLAYER.health;
  actor.alive = true;
  actor.protectUntil = now + PLAYER.spawnProtect;
  actor.grenades = PLAYER.grenades;
  actor.height = MOVE.height;
  actor.sliding = false;
  actor.lastAttacker = null;
  actor.triggerHeld = false;
  equip(actor);
  if (actor.ai) initBrain(actor);
}

function startMatch() {
  modeId = settings.mode;
  mode = MODES[modeId];
  skill = DIFFICULTY[settings.difficulty];
  for (const a of actors) if (a.model) scene.remove(a.model.root);
  actors.length = 0;
  combat.clear();
  teamKills[0] = teamKills[1] = 0;
  Object.assign(stats, { shots: 0, hits: 0, heads: 0, bestStreak: 0 });
  now = 0;
  matchEnd = mode.time;
  $('killfeed').innerHTML = '';

  const playerColor = mode.teams ? TEAM_COLORS[0] : 0x2f7bff;
  player = new Actor({ name: 'You', team: 0, color: playerColor, isPlayer: true });
  actors.push(player);
  viewmodel = new ViewModel(playerColor);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const count = mode.teams ? 7 : clamp(settings.bots, 1, 11);
  for (let i = 0; i < count; i++) {
    const team = mode.teams ? (i % 2 === 0 ? 1 : 0) : i + 1;
    const color = mode.teams ? TEAM_COLORS[team] : FFA_COLORS[i % FFA_COLORS.length];
    const bot = new Actor({ name: names[i], team, color });
    bot.botPrimary = PRIMARIES[(Math.random() * PRIMARIES.length) | 0];
    initBrain(bot);
    actors.push(bot);
  }
  for (const a of actors) {
    spawn(a);
    if (!a.isPlayer) {
      scene.add(buildModel(a, gunModel(a.weapon)));
      // Team-mates' names show through walls; enemies' don't.
      const friendly = mode.teams && a.team === player.team;
      a.model.tag.material.depthTest = !friendly;
      a.model.tag.renderOrder = friendly ? 10 : 0;
    }
  }
  player.protectUntil = now + 0.5;
  $('hud').hidden = false;
  showScreen(null);
  state = 'playing';
  input.requestLock();
  updateHud(true);
}

// ---------- Kill / hit events ----------
const weaponLabel = (id) => (id === 'grenade' ? 'Grenade' : WEAPONS[id]?.name || id);

combat.onHit = (attacker, victim, dmg, head, killed) => {
  if (attacker === player && victim !== player) {
    stats.hits++;
    if (head) stats.heads++;
    hitmarker(head, killed);
    sound.hitmarker(head);
  }
  if (victim === player) {
    shake = Math.min(shake + dmg / 60, 1);
    sound.hurt();
    if (attacker !== player) damageIndicator(attacker.pos);
  }
};

combat.onKill = (victim, killer, weaponId, head) => {
  addFeed(killer, victim, weaponId, head);
  if (killer && killer !== victim) {
    if (mode.teams) teamKills[killer.team]++;
    if (killer === player) {
      sound.killConfirm();
      stats.bestStreak = Math.max(stats.bestStreak, player.streak);
      const msgs = { 2: 'Double kill', 3: 'Triple kill', 5: 'Rampage', 7: 'Unstoppable', 10: 'Legendary' };
      banner(msgs[player.streak] || (head ? 'Headshot' : 'Eliminated ' + victim.name), head || msgs[player.streak]);
    }
    // Ammo for the kill.
    const am = killer.ammo[killer.weapon];
    if (am && Number.isFinite(am.reserve)) am.reserve += WEAPONS[killer.weapon].mag;
    if (modeId === 'gungame') {
      if (weaponId === 'knife' && victim.gunLevel > 0) victim.gunLevel--;
      if (weaponId === killer.weapon || weaponId === 'grenade') {
        killer.gunLevel++;
        if (killer.gunLevel >= GUN_GAME.length) return endMatch(killer);
        equip(killer);
        if (killer === player) banner('Next: ' + WEAPONS[killer.weapon].name, false);
      }
    }
  } else if (killer === victim && !mode.teams) {
    victim.kills = Math.max(0, victim.kills - 1);
  }
  if (victim === player) {
    $('death').hidden = false;
    $('death-by').innerHTML = killer && killer !== player
      ? `Eliminated by <b style="color:${hex(killer.color)}">${esc(killer.name)}</b> <span class="muted">· ${esc(weaponLabel(weaponId))}</span>`
      : 'You blew yourself up';
    input.fire = false;
  }
  checkWin();
};

function checkWin() {
  if (state !== 'playing' || modeId === 'gungame') return;
  if (mode.teams) {
    if (teamKills[0] >= mode.killLimit || teamKills[1] >= mode.killLimit) endMatch();
  } else if (actors.some((a) => a.kills >= mode.killLimit)) endMatch();
}

// ---------- Player control ----------
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _muzzle = new THREE.Vector3();
const _m = new THREE.Vector3();

function controlPlayer(dt) {
  const p = player;
  const w = WEAPONS[p.weapon];
  const aiming = p.alive && input.aiming && !w.melee && now >= p.switchUntil && p.reloadUntil === 0;
  adsK = clamp(adsK + (aiming ? dt : -dt) * 7, 0, 1);

  // Look
  const fovNow = camera.fov;
  const sens = settings.sens * 0.0022 * (fovNow / PLAYER.fov);
  p.yaw -= input.lookX * sens;
  p.pitch = clamp(p.pitch - input.lookY * sens, -1.5, 1.5);

  if (!p.alive) return;

  // Weapon switching
  let want = -1;
  if (input.wasPressed('Digit1')) want = 0;
  if (input.wasPressed('Digit2')) want = 1;
  if (input.wasPressed('Digit3')) want = 2;
  if (input.wasPressed('KeyQ')) want = p.lastSlot ?? (p.slot === 0 ? 1 : 0);
  if (input.wasPressed('WheelDown') || input.wasPressed('swap')) want = (p.slot + 1) % p.weapons.length;
  if (input.wasPressed('WheelUp')) want = (p.slot + p.weapons.length - 1) % p.weapons.length;
  if (want >= 0 && want < p.weapons.length && want !== p.slot) switchSlot(p, want);

  if (input.wasPressed('KeyR') || input.wasPressed('reload')) p.wantReload = true;
  if ((input.wasPressed('KeyG') || input.wasPressed('nade')) && p.grenades > 0) {
    p.grenades--;
    p.eye(_eye);
    p.aimDir(_dir);
    combat.throwGrenade(p, _eye.addScaledVector(_dir, 0.6), _dir);
  }

  // Movement
  const mv = input.move;
  let wx = 0, wz = 0;
  if (mv.x || mv.y) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    wx = rx * mv.x + fx * mv.y;
    wz = rz * mv.x + fz * mv.y;
    const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }
  }
  const slideKey = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || input.keys.has('KeyC') || input.keys.has('crouch');
  const slidePressed = input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight') || input.wasPressed('KeyC') || input.wasPressed('slide');
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  if (slidePressed && p.onGround && !p.sliding && p.slideCooldown <= 0 && hSpeed > 3.5) {
    p.sliding = true;
    p.slideTime = MOVE.slideTime;
    const boost = Math.max(MOVE.slideBoost, hSpeed);
    const dx = wx || p.vel.x / hSpeed, dz = wz || p.vel.z / hSpeed, dl = Math.hypot(dx, dz) || 1;
    p.vel.x = (dx / dl) * boost;
    p.vel.z = (dz / dl) * boost;
    sound.slide();
  }
  p.crouching = slideKey && !p.sliding;
  let speed = aiming ? MOVE.adsWalk : MOVE.walk;
  if (p.crouching) speed = MOVE.crouchWalk;
  accelerate(p, wx, wz, speed, dt);
  if ((input.keys.has('Space') || input.keys.has('jump')) && p.onGround) {
    p.vel.y = MOVE.jump;
    p.onGround = false;
    if (p.sliding) { p.sliding = false; p.slideCooldown = MOVE.slideCooldown; }   // slide-jump keeps the speed
    sound.jump();
  }

  // Trigger: semi-automatic weapons need a fresh click per shot.
  const firing = input.firing;
  p.triggerHeld = w.auto ? firing : (firing && !fireLatch);
  if (!firing) fireLatch = false;
}

function switchSlot(a, slot) {
  a.lastSlot = a.slot;
  a.slot = slot;
  a.reloadUntil = 0;
  a.switchUntil = now + 0.35;
  onWeaponChanged(a);
}

function updateBody(a, dt) {
  if (a.sliding) {
    a.slideTime -= dt;
    const k = Math.exp(-MOVE.slideFriction * dt);
    a.vel.x *= k; a.vel.z *= k;
    if (a.slideTime <= 0 || Math.hypot(a.vel.x, a.vel.z) < 3 || !a.onGround && a.vel.y > 0) {
      a.sliding = false;
      a.slideCooldown = MOVE.slideCooldown;
    }
  } else a.slideCooldown -= dt;
  if (a.wantSlide && !a.sliding && a.onGround && a.slideCooldown <= 0) {
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (hs > 3) {
      a.sliding = true;
      a.slideTime = MOVE.slideTime;
      a.vel.x *= MOVE.slideBoost / hs;
      a.vel.z *= MOVE.slideBoost / hs;
    }
  }
  const targetH = a.sliding || a.crouching ? MOVE.crouchHeight : MOVE.height;
  a.height += clamp(targetH - a.height, -dt * 7, dt * 7);
  a.vel.y -= MOVE.gravity * dt;
  moveBody(a, dt, map.boxes);
  // Keep inside the arena even after a big rocket jump.
  a.pos.x = clamp(a.pos.x, -HALF + 0.5, HALF - 0.5);
  a.pos.z = clamp(a.pos.z, -HALF + 0.5, HALF - 0.5);
}

function updateWeapon(a, dt) {
  const id = a.weapon, w = WEAPONS[id], am = a.ammo[id];
  if (a.reloadUntil && now >= a.reloadUntil) {
    const take = Math.min(w.mag - am.mag, am.reserve);
    am.mag += take;
    am.reserve -= take;
    a.reloadUntil = 0;
  }
  const canReload = !w.melee && !a.reloadUntil && am.mag < w.mag && am.reserve > 0;
  if (a.wantReload && canReload) startReload(a);
  a.wantReload = false;
  if (!a.alive || !a.triggerHeld || now < a.nextFire || now < a.switchUntil || a.reloadUntil) return;

  if (!w.melee && am.mag <= 0) {
    if (canReload) startReload(a);
    else if (a.weapons.length > 1) switchSlot(a, a.weapons.indexOf('pistol') >= 0 && a.weapon !== 'pistol' ? a.weapons.indexOf('pistol') : a.weapons.length - 1);
    if (a.isPlayer) { sound.dry(); fireLatch = true; }
    a.nextFire = now + 0.25;
    return;
  }
  a.nextFire = now + 60 / w.rpm;
  if (!w.melee) am.mag--;
  a.protectUntil = 0;   // shooting ends spawn protection
  a.eye(_eye);
  a.aimDir(_dir);
  let spread;
  if (a.isPlayer) {
    fireLatch = true;
    const move = Math.min(Math.hypot(a.vel.x, a.vel.z) / MOVE.walk, 1);
    spread = THREE.MathUtils.lerp(w.spread, w.adsSpread, adsK) + bloom;
    if (!w.scope || adsK < 0.9) spread += move * 0.025 * (1 - adsK * 0.6);
    if (!a.onGround) spread += 0.04;
    if (a.crouching) spread *= 0.75;
    if (w.scope && adsK < 0.9) spread = Math.max(spread, w.spread);
    viewmodel.fire(w.recoil);
    viewmodel.muzzleWorld(_muzzle);
    _muzzle.applyMatrix4(camera.matrixWorld);
    recoilPitch += w.recoil * (1 - adsK * 0.4);
    bloom = Math.min(bloom + w.recoil * 0.5, 0.06);
    stats.shots++;
  } else {
    spread = w.scope ? w.adsSpread + 0.004 : THREE.MathUtils.lerp(w.spread, w.adsSpread, 0.55);
    const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    _muzzle.copy(_eye).addScaledVector(_dir, 0.7);
    _muzzle.x += rx * 0.15; _muzzle.z += rz * 0.15; _muzzle.y -= 0.2;
  }
  combat.fire(a, _eye, _dir, _muzzle, spread);
  if (!w.melee && am.mag === 0 && am.reserve > 0) startReload(a, 0.15);
}

function startReload(a, delay = 0) {
  a.reloadUntil = now + delay + WEAPONS[a.weapon].reload;
  a.reloadStart = now + delay;
  if (a.isPlayer) sound.reload();
}

// ---------- Main loop ----------
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  if (state === 'playing') step(dt);
  else if (state === 'menu') menuCamera(t / 1000);
  render(dt);
  input.endFrame();
}

function step(dt) {
  now += dt;
  controlPlayer(dt);
  const ctx = { actors, map, skill };
  for (const a of actors) {
    if (!a.alive) {
      if (now >= a.respawnAt) {
        spawn(a);
        if (a === player) { $('death').hidden = true; adsK = 0; }
      }
      continue;
    }
    if (!a.isPlayer) updateBot(a, dt, now, ctx);
    updateBody(a, dt);
    updateWeapon(a, dt);
    if (now - a.lastHurt > PLAYER.regenDelay) a.health = Math.min(PLAYER.health, a.health + PLAYER.regenRate * dt);
  }
  combat.update(dt, now);
  fx.update(dt);
  for (const a of actors) if (a.model) animateModel(a, dt, now);

  // Footsteps
  if (player.alive && player.onGround && !player.sliding) {
    stepDist += Math.hypot(player.vel.x, player.vel.z) * dt;
    if (stepDist > 2.6) { stepDist = 0; sound.step(player.crouching ? 0.06 : 0.14); }
  }
  bloom = Math.max(0, bloom - dt * 0.12);
  if (now >= matchEnd) endMatch();
  updateHud(false);
}

const _look = new THREE.Vector3();
function render(dt) {
  if (state === 'playing' || state === 'paused' || state === 'over') {
    const p = player;
    // Smooth the camera over stair steps.
    camStepY = (camStepY - (p.stepped || 0)) * Math.exp(-dt * 14);
    p.stepped = 0;
    p.eye(camera.position);
    camera.position.y += camStepY;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && !p.sliding && state === 'playing') camBob += dt * speed * 1.7;
    camera.position.y += Math.sin(camBob) * 0.035 * Math.min(speed / MOVE.walk, 1) * (1 - adsK);
    if (!p.alive) {
      // Death cam: drop to the floor and look at the killer.
      camera.position.y = p.pos.y + 0.5;
      const k = p.lastAttacker;
      if (k && k !== p && k.alive) {
        _look.set(k.pos.x, k.pos.y + 1.4, k.pos.z);
        const dx = _look.x - camera.position.x, dz = _look.z - camera.position.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(_look.y - camera.position.y, Math.hypot(dx, dz));
      }
    }
    recoilPitch *= Math.exp(-dt * 9);
    shake *= Math.exp(-dt * 6);
    camera.rotation.set(p.pitch + recoilPitch + (Math.random() - 0.5) * shake * 0.03, p.yaw + (Math.random() - 0.5) * shake * 0.03, p.sliding ? 0.06 : 0);
    const w = WEAPONS[p.weapon];
    const targetFov = THREE.MathUtils.lerp(PLAYER.fov, w.adsFov, adsK) + (p.sliding ? 6 : 0);
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 18));
    camera.updateProjectionMatrix();
    const scoped = w.scope && adsK > 0.85;
    $('scope').hidden = !scoped;
    const reload = p.reloadUntil ? clamp((now - p.reloadStart) / w.reload, 0, 1) : -1;
    viewmodel.update(dt, {
      ads: adsK, reload, moving: speed / MOVE.walk, grounded: p.onGround, sliding: p.sliding,
      lookX: input.lookX, lookY: input.lookY,
    });
    renderer.clear();
    renderer.render(scene, camera);
    if (!scoped && p.alive) viewmodel.render(renderer, 62 - adsK * 8, camera.aspect);
  } else {
    renderer.clear();
    renderer.render(scene, camera);
  }
}

function menuCamera(t) {
  const r = 34;
  camera.position.set(Math.sin(t * 0.08) * r, 16, Math.cos(t * 0.08) * r);
  camera.fov = 60;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 2, 0);
}

// ---------- HUD ----------
let hudTimer = 0;
function updateHud(force) {
  const p = player;
  const w = WEAPONS[p.weapon], am = p.ammo[p.weapon];
  $('health-fill').style.width = clamp(p.health, 0, 100) + '%';
  $('health-fill').classList.toggle('low', p.health < 35);
  $('health-num').textContent = Math.ceil(Math.max(p.health, 0));
  $('vignette').style.opacity = p.alive ? clamp((60 - p.health) / 60, 0, 0.8) : 0;
  $('weapon-name').textContent = w.name;
  if (w.melee) {
    $('ammo-mag').textContent = '∞';
    $('ammo-res').textContent = '';
  } else {
    $('ammo-mag').textContent = am.mag;
    $('ammo-res').textContent = Number.isFinite(am.reserve) ? '/ ' + am.reserve : '/ ∞';
  }
  $('ammo-mag').classList.toggle('low', !w.melee && am.mag <= Math.ceil(w.mag * 0.25));
  $('reload-hint').hidden = !(!w.melee && am.mag === 0 && !p.reloadUntil && p.alive);
  $('reloading').hidden = !p.reloadUntil;
  $('nades').textContent = '● '.repeat(p.grenades).trim() || '—';

  // Crosshair gap follows the current spread.
  const move = Math.min(Math.hypot(p.vel.x, p.vel.z) / MOVE.walk, 1);
  let spread = THREE.MathUtils.lerp(w.spread, w.adsSpread, adsK) + bloom + move * 0.025 * (1 - adsK) + (p.onGround ? 0 : 0.04);
  if (w.melee) spread = 0.01;
  const gap = 4 + spread * innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const ch = $('crosshair');
  ch.style.setProperty('--gap', Math.min(gap, 120) + 'px');
  ch.style.opacity = !p.alive || (adsK > 0.6 && !w.melee) ? 0 : 1;

  if (state === 'playing' && player.alive === false) {
    $('death-timer').textContent = Math.max(0, Math.ceil(player.respawnAt - now));
  }

  hudTimer -= 1;
  if (!force && hudTimer > 0) return;
  hudTimer = 10;
  const left = Math.max(0, matchEnd - now);
  $('timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  const top = $('topscore');
  if (mode.teams) {
    top.innerHTML = `<span class="team blue">${teamKills[0]}</span><span class="vs">${mode.killLimit}</span><span class="team red">${teamKills[1]}</span>`;
  } else if (modeId === 'gungame') {
    const leader = [...actors].sort((a, b) => b.gunLevel - a.gunLevel || b.kills - a.kills)[0];
    top.innerHTML = `<span class="me">Level ${p.gunLevel + 1}/${GUN_GAME.length}</span><span class="vs">Leader: ${esc(leader.name)} ${leader.gunLevel + 1}</span>`;
  } else {
    const leader = [...actors].sort((a, b) => b.kills - a.kills)[0];
    top.innerHTML = `<span class="me">${p.kills}</span><span class="vs">First to ${mode.killLimit}</span><span class="lead" style="color:${hex(leader.color)}">${leader.kills === 0 ? 'No kills yet' : leader === p ? 'You lead' : esc(leader.name) + ' ' + leader.kills}</span>`;
  }
  if (!$('scoreboard').hidden) renderScoreboard($('scoreboard-body'));
}

function hitmarker(head, kill) {
  const h = $('hitmarker');
  h.className = 'hitmarker' + (head ? ' head' : '') + (kill ? ' kill' : '');
  void h.offsetWidth;
  h.classList.add('show');
}

function damageIndicator(from) {
  const p = player;
  const ang = Math.atan2(-(from.x - p.pos.x), -(from.z - p.pos.z)) - p.yaw;
  const el = document.createElement('div');
  el.className = 'dmg-arrow';
  el.style.transform = `rotate(${-ang}rad)`;
  $('dmg').append(el);
  setTimeout(() => el.remove(), 1100);
}

function addFeed(killer, victim, weaponId, head) {
  const row = document.createElement('div');
  row.className = 'feed-row' + (killer === player || victim === player ? ' mine' : '');
  const name = (a) => `<b style="color:${hex(a.color)}">${esc(a.name)}</b>`;
  row.innerHTML = killer && killer !== victim
    ? `${name(killer)} <span class="wpn">${esc(weaponLabel(weaponId))}</span>${head ? '<span class="hs">HS</span>' : ''} ${name(victim)}`
    : `${name(victim)} <span class="wpn">self-destructed</span>`;
  const feed = $('killfeed');
  feed.prepend(row);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => row.classList.add('fade'), 5000);
  setTimeout(() => row.remove(), 5600);
}

let bannerTimer;
function banner(text, big) {
  const b = $('banner');
  b.textContent = text;
  b.className = 'banner show' + (big ? ' big' : '');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 1400);
}

function ranked() {
  if (modeId === 'gungame') return [...actors].sort((a, b) => b.gunLevel - a.gunLevel || b.kills - a.kills);
  return [...actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

function renderScoreboard(el) {
  const rows = ranked().map((a, i) => `
    <tr class="${a === player ? 'me' : ''}">
      <td>${i + 1}</td>
      <td><span class="dot" style="background:${hex(a.color)}"></span>${esc(a.name)}</td>
      ${modeId === 'gungame' ? `<td>${a.gunLevel + 1}</td>` : ''}
      <td>${a.kills}</td><td>${a.deaths}</td>
    </tr>`).join('');
  el.innerHTML = `<table><thead><tr><th>#</th><th>Player</th>${modeId === 'gungame' ? '<th>Lvl</th>' : ''}<th>K</th><th>D</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- Screens ----------
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  showScreen('paused');
  input.releaseLock();
}

function resume() {
  if (state !== 'paused') return;
  sound.init();
  state = 'playing';
  showScreen(null);
  last = performance.now();
  input.requestLock();
}

function endMatch(gunGameWinner) {
  if (state !== 'playing') return;
  state = 'over';
  input.releaseLock();
  $('death').hidden = true;
  $('scoreboard').hidden = true;
  let won, title;
  const list = ranked();
  if (mode.teams) {
    won = teamKills[0] > teamKills[1];
    title = teamKills[0] === teamKills[1] ? 'Draw' : won ? 'Blue team wins' : 'Red team wins';
  } else {
    const winner = gunGameWinner || list[0];
    won = winner === player;
    title = won ? 'Victory!' : `${winner.name} wins`;
  }
  $('result-title').textContent = title;
  $('result-title').classList.toggle('win', !!won);
  const place = list.indexOf(player) + 1;
  const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
  $('result-stats').innerHTML = [
    ['Place', `${place} of ${actors.length}`],
    ['Kills', player.kills],
    ['Deaths', player.deaths],
    ['K/D', (player.kills / Math.max(1, player.deaths)).toFixed(2)],
    ['Accuracy', acc + '%'],
    ['Headshots', stats.heads],
    ['Best streak', stats.bestStreak],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  renderScoreboard($('result-board'));
  const totals = store.get('totals', { kills: 0, wins: 0, matches: 0 });
  totals.kills += player.kills;
  totals.matches += 1;
  if (won) totals.wins += 1;
  store.set('totals', totals);
  showScreen('results');
  $('hud').hidden = true;
  refreshMenu();
}

function toMenu() {
  state = 'menu';
  input.releaseLock();
  $('hud').hidden = true;
  $('death').hidden = true;
  for (const a of actors) if (a.model) scene.remove(a.model.root);
  actors.length = 0;
  combat.clear();
  showScreen('menu');
}

// ---------- Menu wiring ----------
function chips(containerId, options, current, onPick) {
  const el = $(containerId);
  el.innerHTML = '';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (value === current ? ' on' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', value === current);
    b.addEventListener('click', () => {
      onPick(value);
      sound.init();
      sound.blip();
      refreshMenu();
    });
    el.append(b);
  }
}

function refreshMenu() {
  chips('opt-mode', Object.entries(MODES).map(([k, m]) => [k, m.name]), settings.mode, (v) => { settings.mode = v; store.set('mode', v); });
  chips('opt-diff', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), settings.difficulty, (v) => { settings.difficulty = v; store.set('difficulty', v); });
  chips('opt-gun', PRIMARIES.map((id) => [id, WEAPONS[id].name]), settings.primary, (v) => { settings.primary = v; store.set('primary', v); });
  chips('opt-bots', [3, 5, 7, 9, 11].map((n) => [n, String(n)]), settings.bots, (v) => { settings.bots = v; store.set('bots', v); });
  $('row-gun').hidden = settings.mode === 'gungame';
  $('row-bots').hidden = MODES[settings.mode].teams;
  const m = MODES[settings.mode];
  $('mode-desc').textContent = {
    ffa: `Everyone for themselves. First to ${m.killLimit} kills wins.`,
    tdm: `4 vs 4. First team to ${m.killLimit} kills wins.`,
    gungame: 'Every kill swaps your gun for the next one. Get a knife kill on the last level to win. Knife kills knock the victim down a level.',
  }[settings.mode];
  const totals = store.get('totals', { kills: 0, wins: 0, matches: 0 });
  $('totals').textContent = `${totals.kills} kills · ${totals.wins} wins · ${totals.matches} matches`;
  $('btn-sound').textContent = settings.muted ? 'Sound off' : 'Sound on';
  $('sens').value = settings.sens;
  $('sens-val').textContent = Number(settings.sens).toFixed(1);
}

const [titleA, ...titleB] = GAME_TITLE.split(' ');
$('title-a').textContent = titleA;
$('title-b').textContent = titleB.join(' ');
$('tagline').textContent = TAGLINE;
document.title = GAME_TITLE;

$('btn-play').addEventListener('click', () => { sound.init(); startMatch(); });
$('btn-resume').addEventListener('click', resume);
$('btn-quit').addEventListener('click', toMenu);
$('btn-again').addEventListener('click', () => { sound.init(); startMatch(); });
$('btn-menu').addEventListener('click', toMenu);
$('btn-pause').addEventListener('click', pause);
$('btn-sound').addEventListener('click', () => {
  settings.muted = !settings.muted;
  store.set('muted', settings.muted);
  sound.setMuted(settings.muted);
  refreshMenu();
});
$('sens').addEventListener('input', (e) => {
  settings.sens = Number(e.target.value);
  store.set('sens', settings.sens);
  $('sens-val').textContent = settings.sens.toFixed(1);
});

input.onLockChange = (locked) => {
  if (!locked && state === 'playing' && !touchDevice) pause();
};
// Clicking the game while playing re-grabs the mouse if the browser dropped it.
canvas.addEventListener('click', () => {
  if (state === 'playing' && !input.pointerLocked) input.requestLock();
});
input.onKey = (code) => {
  if (code === 'KeyM') {
    settings.muted = !settings.muted;
    store.set('muted', settings.muted);
    sound.setMuted(settings.muted);
    refreshMenu();
  }
  if (code === 'KeyP' && state === 'playing') pause();
  else if (code === 'KeyP' && state === 'paused') resume();
  if (code === 'Tab' && state === 'playing') {
    $('scoreboard').hidden = false;
    renderScoreboard($('scoreboard-body'));
  }
};
addEventListener('keyup', (e) => { if (e.code === 'Tab') $('scoreboard').hidden = true; });
$('btn-board')?.addEventListener('click', () => {
  const sb = $('scoreboard');
  sb.hidden = !sb.hidden;
  if (!sb.hidden) renderScoreboard($('scoreboard-body'));
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

refreshMenu();
showScreen('menu');
$('loading').remove();
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = { get state() { return state; }, actors, player: () => player, combat, renderer, input, stats };
