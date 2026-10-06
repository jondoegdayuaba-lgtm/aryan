import * as THREE from 'three';
import { GAME_TITLE, TAGLINE, CAR, CAMERA, PAINTS, GHOST_RATE, PHYSICS_HZ } from './config.js';
import { TRACKS } from './tracks.js';
import { TrackPath } from './path.js';
import { CarBody } from './physics.js';
import { Race, formatTime, formatDiff } from './race.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { Autopilot } from './autopilot.js';
import { makeTextures } from './textures.js';
import { buildTrack } from './trackmesh.js';
import { buildScenery } from './scenery.js';
import { CarModel, WHEELS } from './carmodel.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { Editor, savedTracks, savedDef } from './editor.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const DT = 1 / PHYSICS_HZ;

// localStorage can be unavailable (private windows, blocked storage); the game works without it.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('apex-rush:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('apex-rush:' + key, JSON.stringify(value)); } catch { /* ignore */ }
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
const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.2, 7000);

const T = makeTextures();
const scenery = buildScenery(scene, T, { mobile: coarse });

// ---------- Game state ----------
const S = {
  mode: 'menu',           // menu | ready | racing | finished | results | paused | editor
  prevMode: null,
  time: 0,
  acc: 0,                 // physics time not yet simulated
  menuId: String(store.get('track', TRACKS[0].id)),   // the track picked in the menu
  def: null,              // the track loaded now (a test drive loads the editor's)
  fromEditor: false,      // test-driving from the editor
  paint: clamp(store.get('paint', 0) | 0, 0, PAINTS.length - 1),
  ghostOn: store.get('ghost', true) !== false,
  muted: !!store.get('muted', false),
  camMode: clamp(store.get('camera', 0) | 0, 0, CAMERA.modes.length - 1),
  path: null, race: null, body: null, bot: null, built: null,
  record: null, ghostPlayer: null, result: null,
  lastDiff: null, offT: 0, finishT: 0, orbit: 0,
  camYaw: 0, camY: 0, shake: 0, lastSpeed: 0, accel: 0,
};

const model = new CarModel(PAINTS[S.paint]);
scene.add(model.root);
const ghost = model.makeGhost();
ghost.visible = false;
scene.add(ghost);
const fx = new Effects(scene, T);
const sound = new Sound();
const input = new Input($('touch-pad'));
const recorder = new GhostRecorder(GHOST_RATE);
const player = { throttle: 0, brake: 0, steer: 0, handbrake: false };   // what the player is pressing
const auto = { throttle: 0, brake: 0, steer: 0, handbrake: false };     // what the robot driver wants
const prevPos = new THREE.Vector3();    // car position before the latest physics step
const stepFrom = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmp = {
  v: new THREE.Vector3(), pos: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), l: new THREE.Vector3(),
  w: new THREE.Vector3(), r: new THREE.Vector3(), look: new THREE.Vector3(), want: new THREE.Vector3(),
  q: new THREE.Quaternion(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), m: new THREE.Matrix4(),
  pt: {}, probe: {},
};
const MENU_CAM = { distance: 11, height: 3.4, look: 1.2 };

// ---------- Records ----------
function loadRecord(id) {
  const r = store.get('best:' + id, null);
  if (!r || !(r.time > 0) || !Array.isArray(r.splits)) return null;
  if (!r.ghost || !(r.ghost.rate > 0) || !Array.isArray(r.ghost.d)) r.ghost = null;
  return r;
}

function medalFor(def, time) {
  const m = def.medals;
  if (!(time > 0) || !m.gold) return null;
  return time <= m.gold ? 'gold' : time <= m.silver ? 'silver' : time <= m.bronze ? 'bronze' : null;
}

// ---------- UI helpers ----------
const text = (el, value) => { if (el.textContent !== value) el.textContent = value; };

function setScreen(name) {
  $('menu').hidden = name !== 'menu';
  $('editor').hidden = name !== 'editor';
  $('paused').hidden = name !== 'paused';
  $('results').hidden = name !== 'results';
  $('hud').hidden = !(name === 'hud' || name === 'paused');
}

function banner(html, cls = '') {
  const box = $('banner');
  while (box.children.length > 1) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'banner-item ' + cls;
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function showSplit(main, label, diff) {
  if (diff === null) banner(`${main}<small>${label}</small>`);
  else banner(`${formatDiff(diff)}<small>${label}</small>`, diff < 0 ? 'good' : 'bad');
}

// ---------- Tracks ----------
// The built-in tracks, then any finished tracks saved from the editor.
function allTracks() {
  return [...TRACKS, ...savedTracks(store).map(savedDef).filter(Boolean)];
}

const lengths = new Map();
function trackLength(def) {
  if (!lengths.has(def.id)) lengths.set(def.id, new TrackPath(def).length);
  return lengths.get(def.id);
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function loadTrack(def) {
  S.def = def;
  if (S.built) {
    scene.remove(S.built.group);
    disposeGroup(S.built.group);
  }
  S.path = new TrackPath(def);
  S.built = buildTrack(S.path, T);
  scene.add(S.built.group);
  scenery.populate(S.path, def.scenery);
  S.race = new Race(S.path);
  S.body = new CarBody(S.path);
  S.bot = new Autopilot(S.path, { caution: 1.15 });
  S.record = loadRecord(def.id);
  S.ghostPlayer = S.record?.ghost ? new GhostPlayer(S.record.ghost) : null;
  fx.clear();
  spawnAt(S.path.spawnS);
}

function spawnAt(s) {
  const p = S.path.at(s, tmp.pt);
  S.body.reset(tmp.v.set(p.x, p.y, p.z), p.yaw);
  prevPos.copy(S.body.pos);
  S.body.pose(model.root.quaternion);
  model.root.position.copy(S.body.pos);
  S.camYaw = p.yaw;
  S.camY = S.body.pos.y + 3;
  S.offT = 0;
  S.acc = 0;
  fx.liftPens();
}

function resetGates() {
  for (const g of S.built.gates) g.beamMat.color.set('#ffd21f');
}

// ---------- Run flow ----------
function startRun() {
  sound.init();
  sound.setMuted(S.muted);
  S.race.reset();
  spawnAt(S.path.spawnS);
  recorder.reset();
  S.lastDiff = null;
  S.mode = 'ready';
  resetGates();
  fx.clear();
  $('banner').replaceChildren();
  setScreen('hud');
  canvas.focus?.();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

function go() {
  S.mode = 'racing';
  S.race.started = true;
  sound.go();
  banner('Go!', 'big');
}

function respawn() {
  if (S.mode !== 'racing') return;
  const g = S.race.respawn;
  spawnAt(g ? g.s + 3 : S.path.spawnS);
  sound.respawn();
}

function onRaceEvent(ev) {
  if (S.mode === 'menu') return;
  const ref = S.record ? S.record.splits[ev.index] : undefined;
  const diff = ref === undefined ? null : ev.at - ref;
  if (diff !== null) S.lastDiff = diff;
  if (ev.type === 'checkpoint') {
    const cps = S.path.checkpoints.length;
    S.built.gates[(S.race.passed - 1) % cps].beamMat.color.set('#46d483');
    sound.checkpoint(diff === null ? undefined : diff < 0);
    showSplit(formatTime(ev.at), `Checkpoint ${S.race.passed}/${S.race.total}`, diff);
  } else if (ev.type === 'lap') {
    resetGates();
    sound.checkpoint(diff === null ? undefined : diff < 0);
    showSplit(formatTime(ev.at), ev.lap === S.race.laps ? 'Final lap' : `Lap ${ev.lap}/${S.race.laps}`, diff);
  } else if (ev.type === 'finish') {
    finish(ev.at);
  }
}

function finish(t) {
  S.mode = 'finished';
  S.finishT = 0;
  S.orbit = 0;
  const def = S.def;
  const prev = S.record;
  const isRecord = !prev || t < prev.time;
  S.result = { time: t, prev: prev ? prev.time : null, isRecord };
  if (isRecord) {
    S.record = { time: t, splits: S.race.splits.slice(), ghost: recorder.export() };
    store.set('best:' + def.id, S.record);
    S.ghostPlayer = new GhostPlayer(S.record.ghost);
  }
  sound.finish(isRecord);
  banner(`${formatTime(t)}<small>${isRecord && prev ? 'New record' : 'Finish'}</small>`, 'big');
}

function showResults() {
  const def = S.def, r = S.result;
  S.mode = 'results';
  text($('result-track'), def.name);
  text($('result-title'), r.prev === null ? 'First finish!' : r.isRecord ? 'New record!' : 'Finished');
  text($('result-time'), formatTime(r.time));
  const diffEl = $('result-diff');
  if (r.prev === null) diffEl.textContent = 'Your time is now the one to beat.';
  else {
    const d = r.time - r.prev;
    diffEl.innerHTML = d < 0
      ? `<span class="good">${formatDiff(d)}</span> faster than your old record`
      : `<span class="bad">${formatDiff(d)}</span> off your record of ${formatTime(r.prev)}`;
  }
  const m = def.medals;
  $('medals').innerHTML = m.gold ? ['gold', 'silver', 'bronze'].map((k) => {
    const won = r.time <= m[k];
    return `<li class="${won ? 'won' : ''}"><span class="medal ${k}"></span>${k[0].toUpperCase() + k.slice(1)} ${formatTime(m[k])}</li>`;
  }).join('') : '';
  text($('btn-next'), S.fromEditor ? 'Edit track' : 'Next track');
  $('btn-next').hidden = !S.fromEditor && allTracks().length < 2;
  setScreen('results');
  $('btn-again').focus({ preventScroll: true });
}

function toMenu() {
  S.mode = 'menu';
  S.fromEditor = false;
  model.root.visible = true;
  // Reload unless the menu's track is still loaded and showing.
  if (!S.def || S.def.id !== S.menuId || !S.built.group.visible) loadTrack(allTracks().find((d) => d.id === S.menuId) || TRACKS[0]);
  startDemo();
  renderTracks();
  setScreen('menu');
}

function startDemo() {
  S.race.reset();
  S.race.started = true;
  spawnAt(S.path.spawnS);
  fx.clear();
  resetGates();
}

function pause() {
  if (S.mode !== 'racing' && S.mode !== 'ready') return;
  S.prevMode = S.mode;
  S.mode = 'paused';
  text($('btn-quit'), S.fromEditor ? 'Back to the editor' : 'Back to the menu');
  sound.drive({ speed: 0, throttle: 0, slip: 0, grounded: true, grass: false, active: false });
  setScreen('paused');
  $('btn-resume').focus({ preventScroll: true });
}

function resume() {
  if (S.mode !== 'paused') return;
  sound.init();
  S.mode = S.prevMode;
  setScreen('hud');
  document.activeElement?.blur();
}

function selectTrack(id) {
  S.menuId = id;
  store.set('track', id);
  if (S.def && S.def.id === id) return;
  loadTrack(allTracks().find((d) => d.id === id) || TRACKS[0]);
  if (S.mode === 'menu') startDemo();
  renderTracks();
}

function nextTrack() {
  if (S.fromEditor) { openEditor(); return; }
  const list = allTracks();
  const i = list.findIndex((d) => d.id === S.def.id);
  selectTrack(list[(i + 1) % list.length].id);
  startRun();
}

// ---------- Track editor ----------
const editor = new Editor({
  scene, camera, canvas, T, input, sound, store,
  onTest: testDrive,
  onExit: toMenu,
  onSaved: renderTracks,
});

function openEditor() {
  sound.init();
  sound.setMuted(S.muted);
  sound.drive({ speed: 0, throttle: 0, slip: 0, grounded: true, grass: false, active: false });
  S.mode = 'editor';
  S.fromEditor = true;
  if (S.built) S.built.group.visible = false;
  model.root.visible = false;
  ghost.visible = false;
  fx.clear();
  scenery.clear();
  setScreen('editor');
  editor.open();
}

function testDrive(def) {
  model.root.visible = true;
  loadTrack(def);
  startRun();
}

function setPaint(i) {
  S.paint = (i + PAINTS.length) % PAINTS.length;
  store.set('paint', S.paint);
  model.setPaint(PAINTS[S.paint]);
  renderPaints();
}

function cycleCamera() {
  S.camMode = (S.camMode + 1) % CAMERA.modes.length;
  store.set('camera', S.camMode);
  banner(`<small>Camera</small>${CAMERA.modes[S.camMode].name}`);
}

function toggleMute() {
  S.muted = !S.muted;
  store.set('muted', S.muted);
  sound.setMuted(S.muted);
  text($('btn-sound'), S.muted ? 'Sound off' : 'Sound on');
}

function toggleGhost() {
  S.ghostOn = !S.ghostOn;
  store.set('ghost', S.ghostOn);
  text($('btn-ghost'), S.ghostOn ? 'Ghost on' : 'Ghost off');
  if (S.mode === 'racing' || S.mode === 'ready') banner(`<small>Ghost</small>${S.ghostOn ? 'On' : 'Off'}`);
}

// ---------- Simulation ----------
function physicsStep() {
  const b = S.body;
  let ctl = player;
  if (S.mode === 'menu') ctl = S.bot.drive(b, auto);
  else if (S.mode === 'finished' || S.mode === 'results') {
    ctl = S.bot.drive(b, auto);
    ctl.throttle = 0;
    ctl.brake = b.forwardSpeed > 1 ? 0.4 : 0;
  } else if (S.mode === 'ready') {
    if (player.throttle > 0 || player.brake > 0) go();
    else return;
  }
  stepFrom.copy(b.pos);
  prevPos.copy(b.pos);
  b.step(DT, ctl);
  const ev = S.race.step(DT, stepFrom, b.pos);
  if (ev) onRaceEvent(ev);
  if (S.mode === 'racing') recorder.push(S.race.time, b.pos, model.root.quaternion);
  if (S.mode === 'menu' && (S.race.done || b.lost || (b.grounded && !b.probe.road && S.path.at(b.trackS, tmp.pt).y > 2))) startDemo();
}

// Car pose in the air: level, nose following the arc.
function airPose(q) {
  const b = S.body;
  const p = clamp(Math.atan2(b.vel.y, Math.max(1, Math.hypot(b.vel.x, b.vel.z))) * 0.6, -0.45, 0.45);
  const f = tmp.f.set(Math.sin(b.yaw) * Math.cos(p), Math.sin(p), Math.cos(b.yaw) * Math.cos(p));
  const u = tmp.u.copy(UP).addScaledVector(f, -f.y).normalize();
  tmp.l.crossVectors(u, f);
  tmp.m.makeBasis(tmp.l, u, f);
  return q.setFromRotationMatrix(tmp.m);
}

function updateCar(dt) {
  const b = S.body;
  const alpha = S.mode === 'ready' ? 1 : clamp(S.acc / DT, 0, 1);
  model.root.position.lerpVectors(prevPos, b.pos, alpha);
  if (b.grounded) b.pose(tmp.q); else airPose(tmp.q);
  model.root.quaternion.slerp(tmp.q, 1 - Math.exp(-dt * (b.grounded ? 16 : 4)));
  const sp = b.forwardSpeed;
  S.accel += ((sp - S.lastSpeed) / Math.max(dt, 1e-3) - S.accel) * (1 - Math.exp(-dt * 6));
  S.lastSpeed = sp;
  model.animate(dt, {
    speed: sp,
    steer: b.steer,
    roll: b.grounded ? clamp(b.yawRate * sp * 0.0011, -0.07, 0.07) : 0,
    pitch: b.grounded ? clamp(-S.accel * 0.0018, -0.05, 0.05) : 0,
  });
}

function updateEffects(dt) {
  const b = S.body;
  const root = model.root;
  root.updateMatrixWorld();
  const hard = ctl().brake > 0 && b.forwardSpeed > 22;
  const sliding = b.grounded && b.speed > 6 && (Math.abs(b.slip) > 4.5 || (ctl().handbrake && Math.abs(b.forwardSpeed) > 8) || hard);
  const grass = b.grounded && !b.onRoad && b.speed > 6;
  tmp.r.set(-1, 0, 0).applyQuaternion(root.quaternion);
  for (let i = 2; i < 4; i++) {
    tmp.w.set(WHEELS[i].x, 0, WHEELS[i].z).applyMatrix4(root.matrixWorld);
    fx.mark(i, tmp.w, tmp.r, sliding && b.onRoad);
    if (sliding && Math.random() < dt * 30 * (0.5 + Math.min(1, Math.abs(b.slip) / 12))) fx.puff(tmp.w, b.vel);
    if (grass && Math.random() < dt * 14) fx.puff(tmp.w, b.vel, { color: '#c9c48e', alpha: 0.45, size: 0.9, life: 0.8 });
  }
  if (b.landing > 7) {
    for (const w of WHEELS) {
      tmp.w.set(w.x, 0, w.z).applyMatrix4(root.matrixWorld);
      for (let k = 0; k < 3; k++) fx.puff(tmp.w, b.vel, { size: 1.4, grow: 4, life: 0.9, alpha: 0.5 });
    }
    sound.land(b.landing);
    S.shake = Math.max(S.shake, Math.min(0.5, b.landing * 0.025));
  }
  b.landing = 0;
  if (b.wallHit > 2.5) {
    tmp.w.set(b.wallNx, 0, b.wallNz);
    tmp.v.copy(root.position).addScaledVector(tmp.w, -1.1);
    tmp.v.y += 0.5;
    fx.sparkBurst(tmp.v, tmp.w, Math.min(24, 6 + b.wallHit));
    sound.wall(b.wallHit);
    S.shake = Math.max(S.shake, Math.min(0.4, b.wallHit * 0.02));
  }
  b.wallHit = 0;
}

const ctl = () => (S.mode === 'menu' || S.mode === 'finished' || S.mode === 'results' ? auto : player);

function updateGhost() {
  const show = S.ghostOn && S.ghostPlayer && (S.mode === 'ready' || S.mode === 'racing');
  if (!show) { ghost.visible = false; return; }
  const t = S.mode === 'ready' ? 0 : S.race.time;
  const alive = S.ghostPlayer.sample(t, ghost.position, ghost.quaternion, tmp.qa, tmp.qb);
  ghost.visible = alive || t < S.record.time + 1;
}

// The chase camera trails the car's heading, swinging toward the direction of
// travel in a slide, and never dips below whatever surface is under it.
function updateCamera(dt) {
  const b = S.body;
  const pos = model.root.position;
  const mode = S.mode === 'menu' ? MENU_CAM : CAMERA.modes[S.camMode];

  if (mode.hood && S.mode !== 'finished' && S.mode !== 'results') {
    camera.position.set(0, 1.32, 0.05).applyQuaternion(model.root.quaternion).add(pos);
    tmp.look.set(0, 1.0, 12).applyQuaternion(model.root.quaternion).add(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp.look);
  } else {
    const m = mode.hood ? CAMERA.modes[0] : mode;
    let target = b.yaw;
    if (b.speed > 6 && b.forwardSpeed > 0) target += angDiff(Math.atan2(b.vel.x, b.vel.z), b.yaw) * 0.45;
    let rate = 7;
    if (S.mode === 'menu') { target += 0.75 + Math.sin(S.time * 0.13) * 0.55; rate = 1.6; }
    if (S.mode === 'finished' || S.mode === 'results') { S.orbit += dt * 0.35; target += S.orbit; rate = 2.5; }
    S.camYaw += angDiff(target, S.camYaw) * (1 - Math.exp(-dt * rate));
    const fx_ = Math.sin(S.camYaw), fz = Math.cos(S.camYaw);
    S.camY += (pos.y + m.height - S.camY) * (1 - Math.exp(-dt * 5));
    const want = tmp.want.set(pos.x - fx_ * m.distance, S.camY, pos.z - fz * m.distance);
    const under = S.path.probe(want, tmp.probe).height;
    if (want.y < under + 0.9) want.y = under + 0.9;
    camera.position.copy(want);
    tmp.look.set(pos.x + fx_ * 3, pos.y + m.look, pos.z + fz * 3);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp.look);
  }

  if (S.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * S.shake;
    camera.position.y += (Math.random() - 0.5) * S.shake;
    S.shake *= Math.exp(-dt * 6);
  }
  const s = clamp(Math.abs(b.forwardSpeed) / CAR.topSpeed, 0, 1.2);
  const fov = CAMERA.fov + CAMERA.fovSpeed * Math.pow(s, 1.5) + (mode.hood ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 4));
    camera.updateProjectionMatrix();
  }
}

// Is the car on a stretch of road it shouldn't be on yet (or any more), say
// after dropping off a bridge onto the road below? Fine anywhere between the
// last gate passed and the next one.
function offCourse(b) {
  if (!b.probe.road) return false;
  const r = S.race, L = S.path.length;
  const from = r.respawn ? r.respawn.s : S.path.spawnS;
  let to = r.next < r.cps.length ? r.cps[r.next].s : S.path.finish.s;
  let s = b.trackS;
  if (S.path.closed) {
    if (to < from) to += L;
    if (s < from - 40) s += L;
  }
  return s < from - 40 || s > to + 40;
}

function update(dt) {
  S.time += dt;
  input.read(player);
  if (S.mode === 'paused') return;
  if (S.mode === 'editor') {
    editor.update(dt);
    scenery.follow(editor.cam.target);
    return;
  }

  S.acc = Math.min(S.acc + dt, 0.25);
  while (S.acc >= DT) {
    physicsStep();
    S.acc -= DT;
  }

  const b = S.body;
  if (S.mode === 'racing') {
    // Fell off, wandered far from the road or ended up on the wrong stretch:
    // offer (then force) a trip back to the last checkpoint.
    const roadY = S.path.at(b.trackS, tmp.pt).y;
    const fallen = b.lost || (b.grounded && !b.probe.road && roadY > 2) || offCourse(b);
    S.offT = fallen ? S.offT + dt : 0;
    if (S.offT > 3) respawn();
  }
  if (S.mode === 'finished') {
    S.finishT += dt;
    if (S.finishT > 1.8) showResults();
  }

  updateCar(dt);
  updateEffects(dt);
  fx.update(dt);
  updateGhost();
  updateCamera(dt);
  scenery.follow(model.root.position);
  const active = S.mode === 'racing' || S.mode === 'ready' || S.mode === 'finished';
  sound.drive({
    speed: Math.abs(b.forwardSpeed), throttle: ctl().throttle, slip: b.slip,
    grounded: b.grounded, grass: !b.onRoad, active,
  });
  updateHud();
}

// ---------- HUD ----------
const hud = {
  cp: $('hud-cp'), lap: $('hud-lap'), lapChip: $('lap-chip'), record: $('t-record'), current: $('t-current'),
  diff: $('t-diff'), speed: $('speed'), hint: $('hint'),
};

function updateHud() {
  if ($('hud').hidden) return;
  const r = S.race;
  text(hud.cp, `${r.passed}/${r.total}`);
  hud.lapChip.hidden = r.laps < 2;
  text(hud.lap, `${Math.min(r.lap, r.laps)}/${r.laps}`);
  text(hud.record, S.record ? formatTime(S.record.time) : '--:--.---');
  text(hud.current, formatTime(r.done ? r.finalTime : r.time));
  if (S.lastDiff === null) {
    text(hud.diff, '---');
    hud.diff.className = 'num';
  } else {
    text(hud.diff, formatDiff(S.lastDiff));
    hud.diff.className = 'num ' + (S.lastDiff < 0 ? 'good' : 'bad');
  }
  text(hud.speed, String(Math.round(Math.abs(S.body.forwardSpeed) * 3.6)));

  let hint = '';
  if (S.mode === 'ready') hint = input.usingTouch ? 'Hold Gas to go' : 'Press W or ↑ to go';
  else if (S.mode === 'racing' && S.offT > 0.6) hint = input.usingTouch ? 'Tap Checkpoint to get back on the road' : 'Press Enter to go back to the last checkpoint';
  hud.hint.hidden = !hint;
  if (hint) text(hud.hint, hint);
}

// ---------- Menu ----------
function renderTracks() {
  const list = $('track-list');
  list.replaceChildren(...allTracks().map((def) => {
    const rec = loadRecord(def.id);
    const medal = rec ? medalFor(def, rec.time) : null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track-card';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(def.id === S.menuId));
    const laps = def.closed && def.laps > 1 ? ` · ${def.laps} laps` : def.closed ? ' · 1 lap' : ' · A to B';
    btn.innerHTML = `
      <span class="track-name">${def.name}</span>
      <span class="track-meta"><span class="diff-tag ${def.difficulty.toLowerCase()}">${def.difficulty}</span>${(trackLength(def) / 1000).toFixed(2)} km${laps}</span>
      <span class="track-best"><span class="label">Best</span>
        <span class="time num">${medal ? `<span class="medal ${medal}" title="${medal} medal"></span> ` : ''}${rec ? formatTime(rec.time) : '--:--.---'}</span>
      </span>`;
    btn.title = def.blurb;
    btn.addEventListener('click', () => { sound.init(); sound.click(); selectTrack(def.id); });
    return btn;
  }));
}

function renderPaints() {
  $('paints').replaceChildren(...PAINTS.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = `linear-gradient(135deg, ${p.body} 0 62%, ${p.stripe} 62% 74%, ${p.body} 74%)`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === S.paint));
    b.setAttribute('aria-label', p.name);
    b.addEventListener('click', () => { sound.init(); sound.click(); setPaint(i); });
    return b;
  }));
  text($('paint-name'), PAINTS[S.paint].name);
}

text($('title-a'), GAME_TITLE[0]);
text($('title-b'), GAME_TITLE[1] ?? '');
document.title = GAME_TITLE.join(' ').replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase());
text($('tagline'), TAGLINE);
text($('btn-sound'), S.muted ? 'Sound off' : 'Sound on');
text($('btn-ghost'), S.ghostOn ? 'Ghost on' : 'Ghost off');

$('btn-race').addEventListener('click', startRun);
$('btn-again').addEventListener('click', startRun);
$('btn-next').addEventListener('click', nextTrack);
$('btn-menu').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-pause-restart').addEventListener('click', startRun);
$('btn-quit').addEventListener('click', () => (S.fromEditor ? openEditor() : toMenu()));
$('btn-editor').addEventListener('click', openEditor);
$('btn-pause').addEventListener('click', pause);
$('btn-respawn').addEventListener('click', respawn);
$('btn-restart').addEventListener('click', () => { if (S.mode === 'racing' || S.mode === 'ready') startRun(); });
$('btn-cam').addEventListener('click', cycleCamera);
$('btn-sound').addEventListener('click', () => { sound.init(); toggleMute(); });
$('btn-ghost').addEventListener('click', toggleGhost);

// HUD buttons are for the mouse and fingers: don't let them keep keyboard
// focus, or Space (handbrake) and Enter would press them again.
for (const b of $('hud').querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());

input.onKey = (code, e) => {
  if (e && (S.mode === 'ready' || S.mode === 'racing') && e.target.closest?.('#hud button')) {
    e.preventDefault();
    e.target.blur();
  }
  const onButton = document.activeElement?.tagName === 'BUTTON';
  const confirm = (!onButton && (code === 'Enter' || code === 'Space')) || code === 'PadStart';
  if (code === 'KeyM') { sound.init(); toggleMute(); return; }
  if (code === 'KeyG' && S.mode !== 'editor') { toggleGhost(); return; }
  switch (S.mode) {
    case 'editor':
      editor.onKey(code, e);
      break;
    case 'menu':
      if (confirm) startRun();
      if (code === 'ArrowUp' || code === 'PadUp' || code === 'ArrowDown' || code === 'PadDown') {
        const list = allTracks(), i = list.findIndex((d) => d.id === S.menuId);
        const d = code === 'ArrowUp' || code === 'PadUp' ? -1 : 1;
        selectTrack(list[(i + d + list.length) % list.length].id);
      }
      if (code === 'KeyE') openEditor();
      if (code === 'ArrowLeft') setPaint(S.paint - 1);
      if (code === 'ArrowRight' || code === 'PadRB') setPaint(S.paint + 1);
      break;
    case 'ready': case 'racing':
      if (code === 'Escape' || code === 'KeyP' || code === 'PadStart') pause();
      if (code === 'KeyR' || code === 'PadBack') startRun();
      if (code === 'Enter' || code === 'Backspace' || code === 'PadY') respawn();
      if (code === 'KeyC' || code === 'PadRB') cycleCamera();
      break;
    case 'finished': case 'results':
      // Not Space/Enter while the finish plays out: they're the handbrake and
      // respawn keys, easy to still be pressing as you cross the line.
      if ((confirm && S.mode === 'results') || code === 'KeyR' || code === 'PadBack') startRun();
      if (code === 'KeyN') nextTrack();
      if (code === 'Escape') (S.fromEditor ? openEditor() : toMenu());
      break;
    case 'paused':
      if (confirm || code === 'Escape' || code === 'KeyP') resume();
      if (code === 'KeyR') startRun();
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

// In the menu, shift the picture so the car sits beside (desktop) or below (phone) the panel.
function applyViewOffset() {
  const W = innerWidth, H = innerHeight;
  if (S.mode === 'menu') {
    if (W > 700) camera.setViewOffset(W, H, -Math.min(250, W * 0.2), 0, W, H);
    else camera.setViewOffset(W, H, 0, -H * 0.3, W, H);
  } else if (camera.view && camera.view.enabled) {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}

// ---------- Main loop ----------
loadTrack(allTracks().find((d) => d.id === S.menuId) || TRACKS[0]);
startDemo();
renderTracks();
renderPaints();
setScreen('menu');
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  applyViewOffset();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
update(0.016);
renderer.render(scene, camera);
$('loading').hidden = true;
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = { S, model, camera, scene, renderer, input, editor, startRun, selectTrack, spawnAt, openEditor };
