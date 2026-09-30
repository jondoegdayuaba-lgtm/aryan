import * as THREE from 'three';
import { createWorld, LANES } from './world.js';
import { loadBike } from './bike.js';

// ---- tuning ---------------------------------------------------------------
const T = {
  balance: 0.92,        // rad: the wheelie's balance point (~53 degrees)
  looseOut: 0.42,       // rad past balance before the bike flips over backwards
  throttleTorque: 3.6,
  gravityTorque: 2.0,
  brakeTorque: 6,
  clutchKick: 1.7,
  sweet: 0.11,          // half-width of the sweet spot around the balance point
  minWheelie: 0.32,     // rad: front wheel counts as "up" above this
  roadHalf: 5.0,
};
const $ = (id) => document.getElementById(id);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

// ---- renderer / scene -----------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1400);
const world = createWorld(renderer, scene);
const bike = await loadBike();
scene.add(bike.root);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---- input ----------------------------------------------------------------
const keys = new Set();
const held = { gas: false, brake: false, left: false, right: false };
let kickQueued = false, touchSteer = 0;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') kickQueued = true;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') audio.toggleMute();
  if ((e.code === 'Enter' || e.code === 'Space') && state !== 'playing' && state !== 'paused' && state !== 'crashing') start();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (state === 'playing') togglePause(); });
const anyKey = (...c) => c.some((k) => keys.has(k));
function bindHold(el, key) {
  const on = (e) => { held[key] = true; e.preventDefault(); };
  const off = () => { held[key] = false; };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
bindHold($('btn-gas'), 'gas'); bindHold($('btn-brake'), 'brake');
$('btn-kick').addEventListener('pointerdown', (e) => { kickQueued = true; e.preventDefault(); });
let dragX = null;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') dragX = e.clientX; });
canvas.addEventListener('pointermove', (e) => { if (dragX !== null) touchSteer = Math.max(-1, Math.min(1, (e.clientX - dragX) / 70)); });
addEventListener('pointerup', () => { dragX = null; touchSteer = 0; });

// ---- audio: synthesised engine, wind, crash -------------------------------
const audio = (() => {
  let ctx, eng, eng2, engGain, wind, windGain, master, muted = store.get('wl-muted', false);
  const noiseBuf = () => { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  return {
    init() {
      if (ctx) { ctx.resume(); return; }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(master);
      engGain = ctx.createGain(); engGain.gain.value = 0; engGain.connect(lp);
      eng = ctx.createOscillator(); eng.type = 'sawtooth'; eng.connect(engGain); eng.start();
      eng2 = ctx.createOscillator(); eng2.type = 'square'; const g2 = ctx.createGain(); g2.gain.value = 0.4; eng2.connect(g2); g2.connect(engGain); eng2.start();
      wind = ctx.createBufferSource(); wind.buffer = noiseBuf(); wind.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.5;
      windGain = ctx.createGain(); windGain.gain.value = 0; wind.connect(bp); bp.connect(windGain); windGain.connect(master); wind.start();
    },
    update(speed, throttle, on) {
      if (!ctx) return;
      const t = ctx.currentTime, gear = Math.min(5, 1 + Math.floor(speed / 9)), rpm = ((speed % 9) / 9 + 0.25 + throttle * 0.3) * (gear === 5 ? 0.9 : 1);
      const f = 38 + rpm * 120 + gear * 4;
      eng.frequency.setTargetAtTime(f, t, 0.03); eng2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
      engGain.gain.setTargetAtTime(on ? 0.12 + throttle * 0.22 : 0, t, 0.05);
      windGain.gain.setTargetAtTime(on ? Math.min(0.5, speed / 90) : 0, t, 0.1);
    },
    crash() {
      if (!ctx) return;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf();
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 1.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(1, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4);
      s.connect(f); f.connect(g); g.connect(master); s.start(); s.stop(ctx.currentTime + 1.5);
    },
    toggleMute() { muted = !muted; store.set('wl-muted', muted); if (master) master.gain.value = muted ? 0 : 0.5; },
  };
})();

// ---- game state -----------------------------------------------------------
let state = 'menu';
const G = {};
let best = store.get('wl-best', 0);
function reset() {
  Object.assign(G, {
    x: 0, vx: 0, speed: 12, pitch: 0, omega: 0, throttle: 0, roll: 0,
    score: 0, wheelieDist: 0, wheelieTime: 0, mult: 1, sweetTime: 0, dist: 0, time: 0,
    nextSpawn: 4, crashT: 0, crashKind: '', crashVel: new THREE.Vector3(), spin: 0, popupT: 0,
  });
  world.reset();
  bike.root.position.set(0, 0, 0); bike.root.rotation.set(0, 0, 0); bike.pivot.rotation.set(0, 0, 0);
  bike.pivot.position.set(0, 0.32, 0);
}
reset();

function start() {
  audio.init(); reset();
  state = 'playing';
  $('menu').hidden = true; $('over').hidden = true; $('hud').hidden = false; $('pause').hidden = true;
  $('hint').classList.add('show'); setTimeout(() => $('hint').classList.remove('show'), 5000);
}
function togglePause() {
  if (state === 'playing') { state = 'paused'; $('pause').hidden = false; }
  else if (state === 'paused') { state = 'playing'; $('pause').hidden = true; last = performance.now(); }
}
$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', start);
$('btn-resume').addEventListener('click', togglePause);
$('btn-pause').addEventListener('click', togglePause);
$('btn-mute').addEventListener('click', () => audio.toggleMute());

function popup(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'popup ' + cls; el.textContent = text;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function crash(kind) {
  if (state !== 'playing') return;
  state = 'crashing';
  G.crashKind = kind; G.crashT = 0;
  G.crashVel.set((Math.random() - 0.5) * 6, 5 + Math.random() * 3, -G.speed * 0.6);
  G.crashSpeed = G.speed;
  audio.crash(); audio.update(0, 0, false);
}

function finish() {
  state = 'over';
  const score = Math.floor(G.score);
  const isBest = score > best;
  if (isBest) { best = score; store.set('wl-best', best); }
  $('over-score').textContent = score.toLocaleString();
  $('over-best').textContent = best.toLocaleString();
  $('over-title').textContent = G.crashKind === 'loop' ? 'Looped out' : 'Wrecked';
  $('over-new').hidden = !isBest || score === 0;
  $('over-wheelie').textContent = Math.floor(G.wheelieDist) + ' m';
  $('over-dist').textContent = Math.floor(G.dist) + ' m';
  $('over').hidden = false; $('hud').hidden = true;
}

// ---- simulation -----------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function step(dt) {
  G.time += dt;
  const gasIn = anyKey('Space', 'ArrowUp', 'KeyW') || held.gas;
  const brakeIn = anyKey('ArrowDown', 'KeyS') || held.brake;
  const steer = (anyKey('ArrowRight', 'KeyD') ? 1 : 0) - (anyKey('ArrowLeft', 'KeyA') ? 1 : 0) + touchSteer;

  // throttle eases in and out, which is what makes balancing a real skill
  G.throttle = clamp(G.throttle + ((gasIn ? 1 : 0) - G.throttle) * Math.min(1, dt * 9), 0, 1);

  // speed
  // cruise control ramps up with distance; gas adds a push, brake sheds speed
  const cruise = Math.min(38, 16 + G.dist / 45);
  let a = (cruise - G.speed) * 0.35 + G.throttle * 4;
  if (brakeIn) a -= 9;
  G.speed = clamp(G.speed + a * dt, 3, 70);

  // pitch: an inverted pendulum around the rear axle
  if (kickQueued) { if (G.pitch < 0.3) G.omega += T.clutchKick; kickQueued = false; }
  const stab = 2.2 + G.speed * 0.02;
  const alpha = T.throttleTorque * G.throttle
    + T.gravityTorque * Math.sin(G.pitch - T.balance)
    - (brakeIn ? T.brakeTorque : 0)
    - stab * G.omega;
  G.omega += alpha * dt;
  G.pitch += G.omega * dt;
  if (G.pitch <= 0) { G.pitch = 0; G.omega = Math.max(0, G.omega); }
  if (G.pitch > T.balance + T.looseOut) return crash('loop');

  // lateral movement
  const grip = clamp(1 - G.pitch * 0.35, 0.5, 1);
  const target = steer * (4.2 + G.speed * 0.05) * grip;
  G.vx += (target - G.vx) * Math.min(1, dt * 6);
  G.x += G.vx * dt;
  if (Math.abs(G.x) > T.roadHalf) { G.x = Math.sign(G.x) * T.roadHalf; G.vx = 0; }
  G.roll += (clamp(-G.vx * 0.055, -0.5, 0.5) - G.roll) * Math.min(1, dt * 8);

  // scoring
  G.dist += G.speed * dt;
  const wheelie = G.pitch > T.minWheelie;
  const sweet = wheelie && Math.abs(G.pitch - T.balance) < T.sweet;
  if (wheelie) {
    G.wheelieTime += dt;
    G.wheelieDist += G.speed * dt;
    G.sweetTime += sweet ? dt : 0;
    const newMult = Math.min(10, 1 + Math.floor(G.wheelieTime / 3) + Math.floor(G.sweetTime / 2));
    if (newMult > G.mult) popup('x' + newMult, 'mult');
    G.mult = newMult;
    G.score += G.speed * dt * G.mult * (sweet ? 1.6 : 1);
  } else if (G.wheelieTime > 0) {
    if (G.wheelieTime > 1) popup(`${Math.floor(G.wheelieDist)} m wheelie`);
    G.wheelieTime = 0; G.sweetTime = 0; G.mult = 1;
  }

  // traffic
  G.nextSpawn -= dt;
  if (G.nextSpawn <= 0 && G.time > 2.5) {
    const density = clamp(1.6 - G.dist / 1600, 0.55, 1.6);
    world.spawnCar(-(280 + Math.random() * 60), G.speed);
    G.nextSpawn = density * (0.6 + Math.random() * 0.7);
  }
  world.update(dt, G.speed, bike.root.position);
  for (const c of world.cars) {
    const hitX = Math.abs(c.x - G.x) < c.halfW + 0.32;
    const hitZ = c.z - c.halfL < 0.9 && c.z + c.halfL > -0.9;
    if (hitX && hitZ) return crash('hit');
    if (!c.passed && c.z - c.halfL > 1) {
      c.passed = true;
      if (Math.abs(c.x - G.x) < c.halfW + 0.9) { G.score += 60 * G.mult; popup('Close call +' + 60 * G.mult, 'close'); }
    }
  }

  // visuals
  bike.spin(G.speed * dt);
}

function stepCrash(dt) {
  G.crashT += dt;
  const v = G.crashVel;
  v.y -= 22 * dt;
  const p = bike.root.position;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  if (p.y < 0) { p.y = 0; v.y = -v.y * 0.35; v.x *= 0.7; v.z *= 0.7; }
  v.z *= Math.pow(0.45, dt);
  G.spin += dt * 9 * Math.max(0, 1 - G.crashT * 0.6);
  bike.root.rotation.z += dt * 5 * Math.max(0, 1 - G.crashT * 0.7);
  bike.pivot.rotation.x += dt * (G.crashKind === 'loop' ? 6 : 4) * Math.max(0, 1 - G.crashT * 0.7);
  world.update(dt, Math.max(0, (G.crashSpeed || 0) * Math.max(0, 1 - G.crashT * 0.6)) - v.z * 0.0, p);
  if (G.crashT > 1.9) finish();
}

// ---- HUD -------------------------------------------------------------------
const hud = { score: $('score'), speed: $('speed'), mult: $('mult'), needle: $('needle'), bal: $('balance'), best: $('hud-best') };
let lastScore = -1;
function updateHud() {
  const s = Math.floor(G.score);
  if (s !== lastScore) { hud.score.textContent = s.toLocaleString(); lastScore = s; }
  hud.speed.textContent = Math.round(G.speed * 3.6);
  hud.mult.textContent = G.mult > 1 ? 'x' + G.mult : '';
  const range = T.balance + T.looseOut;
  hud.needle.style.bottom = clamp(G.pitch / range, 0, 1) * 100 + '%';
  hud.bal.classList.toggle('sweet', G.pitch > T.minWheelie && Math.abs(G.pitch - T.balance) < T.sweet);
  hud.bal.classList.toggle('danger', G.pitch > T.balance + T.sweet * 1.5);
  hud.best.textContent = 'Best ' + best.toLocaleString();
}
const zone = $('zone');
{
  const range = T.balance + T.looseOut;
  zone.style.bottom = ((T.balance - T.sweet) / range) * 100 + '%';
  zone.style.height = ((T.sweet * 2) / range) * 100 + '%';
}

// ---- camera + render loop ---------------------------------------------------
const camPos = new THREE.Vector3(0, 2, 5), look = new THREE.Vector3(), shake = new THREE.Vector3();
function updateVisuals(dt) {
  const r = bike.root;
  if (state === 'playing') {
    r.position.set(G.x, 0, 0);
    r.rotation.z = G.roll;
    bike.pivot.rotation.x = G.pitch;
    // the rear tyre stays on the ground as the frame rotates
    bike.pivot.position.y = 0.32;
  }
  const spd = state === 'playing' ? G.speed : 0;
  const tx = r.position.x * 0.55, ty = 1.55 + G.pitch * 0.55, tz = 4.3 + G.pitch * 0.5;
  const k = 1 - Math.pow(0.001, dt);
  camPos.x += (tx - camPos.x) * k; camPos.y += (ty - camPos.y) * k; camPos.z += (tz - camPos.z) * k;
  const buzz = state === 'playing' ? spd * 0.0009 : 0;
  shake.set((Math.random() - 0.5) * buzz, (Math.random() - 0.5) * buzz, 0);
  camera.position.copy(camPos).add(shake);
  look.set(r.position.x * 0.8, 1.0 + G.pitch * 0.5, -7);
  camera.lookAt(look);
  const fov = 58 + Math.min(16, spd * 0.32);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'playing') {
    step(dt);
    updateHud();
    audio.update(G.speed, G.throttle, true);
  } else if (state === 'crashing') {
    stepCrash(dt);
  } else if (state === 'menu' || state === 'over') {
    world.update(dt, 14, bike.root.position);
    audio.update(0, 0, false);
    bike.spin(14 * dt);
    if (state === 'menu') { G.pitch = 0.62 + Math.sin(now / 900) * 0.04; bike.pivot.rotation.x = G.pitch; }
  }
  updateVisuals(dt);
  renderer.render(scene, camera);
}
$('best-menu').textContent = best.toLocaleString();
requestAnimationFrame(frame);
$('loading').remove();

// tiny test hook
window.__wl = { G, T, world, get state() { return state; }, start, crash };
