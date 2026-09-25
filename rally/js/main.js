import * as THREE from 'three';
import { GAME_TITLE, TAGLINE, TIMES, QUALITY } from './config.js';
import { generateWorldAsync, WATER } from './gen.js';
import { STAGES, FEATURES } from './track.js';
import { CARS, LIVERIES } from './cars.js';
import { Vehicle } from './vehicle.js';
import { CarVisual } from './carmodel.js';
import { WorldView } from './scene.js';
import { Post } from './post.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud, formatTime } from './hud.js';
import { Driver } from './ai.js';
import { locate, wrap } from './road.js';
import { buildPaceNotes, noteText, CoDriver } from './pacenotes.js';
import { patch, G } from './shading.js';
import { Sound } from './sound.js';
import { Effects } from './fx.js';
import { GhostRecorder, GhostPlayer, unpackGhost } from './ghost.js';
import { Props } from './props.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const tick = () => new Promise((r) => setTimeout(r, 0));
const MENU_SPOT = 2380;   // the demo car starts on the lake shore

// localStorage may be unavailable (private windows, blocked storage); the game works without it.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('ridge-rally:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('ridge-rally:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  raw(key, value) {
    try {
      if (value === undefined) return localStorage.getItem('ridge-rally:' + key);
      localStorage.setItem('ridge-rally:' + key, value);
    } catch { return null; }
    return null;
  },
};

const params = new URLSearchParams(location.search);
const touchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (touchDevice) document.body.classList.add('touch');

const settings = Object.assign({
  quality: 'auto', gearbox: 'auto', assists: 'full', codriver: 'voice', units: 'kmh', tilt: 'off', sound: true, view: 'chase',
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

function pickQuality() {
  const q = params.get('q') || settings.quality;
  if (q !== 'auto' && QUALITY[q]) return q;
  if (touchDevice) return (navigator.hardwareConcurrency || 4) >= 8 ? 'medium' : 'low';
  return 'high';
}

// ---------- Loading screen ----------
function progress(f, text) {
  $('loading-fill').style.width = `${Math.round(f * 100)}%`;
  if (text) $('loading-text').textContent = text;
}

// ---------- Game state ----------
const S = {
  mode: 'loading',   // menu | stages | garage | settings | prestart | countdown | racing | finishing | results | free | paused
  prevMode: null,
  modeT: 0,
  time: 0,
  car: clamp(store.get('car', 0) | 0, 0, CARS.length - 1),
  livery: clamp(store.get('livery', 0) | 0, 0, LIVERIES.length - 1),
  stage: null,
  run: null,
  preset: null,
  stars: store.get('stars', []),
  best: store.get('best', {}),
  lights: false,
  demo: true,
};

let renderer, world, view, post, camera, rig, input, hud, sound, codriver, fx, props, notes;
let vehicle, visual, ai, ghostVisual = null, ghostPlayer = null, recorder = new GhostRecorder();
let heads = [];

async function boot() {
  progress(0.02, 'Warming up');
  const canvas = $('game');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (err) {
    $('loading-text').textContent = 'This game needs WebGL 2, which your browser could not start.';
    throw err;
  }
  const qName = pickQuality();
  const quality = QUALITY[qName];
  S.quality = qName;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  world = await generateWorldAsync((p) => progress(0.04 + p * 0.36, 'Shaping the island'));
  progress(0.42, 'Painting the ground');
  await tick();
  view = new WorldView(renderer, world, quality);
  progress(0.7, 'Walking the stages');
  await tick();
  notes = buildPaceNotes(world.road, FEATURES);
  props = new Props(world, notes, STAGES);
  view.scene.add(props.group);
  fx = new Effects(renderer, view.scene, world, { dust: qName === 'low' ? 700 : 1600 });
  progress(0.8, 'Building the car');
  await tick();

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 5200);
  rig = new CameraRig(camera, world);
  rig.view = settings.view;
  post = new Post(renderer, { msaa: quality.msaa, bloom: quality.bloom });
  resize();
  input = new Input();
  hud = new Hud(world);
  hud.units = settings.units;
  sound = new Sound();
  codriver = new CoDriver();
  setupCar();
  setupTouch();
  wireMenus();

  progress(0.9, 'Lighting the sky');
  await tick();
  // The menu backdrop: golden hour by the lake.
  applyTime('sunset');
  placeOnRoad(MENU_SPOT);
  ai = new Driver(world, vehicle, { grip: 0.8 });
  progress(0.97, 'Almost there');
  await tick();
  renderer.compile(view.scene, camera);
  $('loading').hidden = true;
  toMenu();
  if (params.has('manual')) {
    // test harness: step the simulation and draw frames on demand
    window.__step = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) update(dt); };
    window.__draw = () => post.render(view.scene, camera, S.time);
  } else requestAnimationFrame(frame);
  window.__game = { S, world, vehicle: () => vehicle, view, rig, camera, notes, props, fx, sound, settings, startStage, startFree, TIMES, STAGES, renderer };
}

// ---------- Car ----------
function setupCar() {
  const spec = CARS[S.car];
  if (visual) {
    view.scene.remove(visual.root);
  }
  vehicle = new Vehicle(spec, world);
  visual = new CarVisual(spec, LIVERIES[S.livery], { noiseTex: view.textures.noise, patch, number: 7 });
  view.scene.add(visual.root);
  if (ai) ai.car = vehicle;
  // headlights
  heads.forEach((h) => { h.parent?.remove(h); h.target.parent?.remove(h.target); });
  heads = [];
  const y = spec.id === 'truck' ? 0.35 : 0.18, z = spec.frontAxle + 0.75;
  for (const s of [-1, 1, 0]) {
    // two headlights plus a wide rally light pod on the bonnet
    const pod = s === 0;
    const L = new THREE.SpotLight(pod ? 0xf4f6ff : 0xfff1dd, 0, pod ? 160 : 230, pod ? 0.85 : 0.5, pod ? 0.7 : 0.45, 1.25);
    L.position.set(s * 0.55, pod ? y + 0.55 : y, pod ? z - 0.9 : z);
    L.target.position.set(s * 0.8, pod ? -2 : -1.1, z + 30);
    L.userData.pod = pod;
    L.castShadow = s > 0 && S.quality !== 'low';
    L.shadow.mapSize.set(1024, 1024);
    L.shadow.camera.near = 0.5;
    L.shadow.camera.far = 120;
    L.shadow.bias = -0.0005;
    visual.root.add(L, L.target);
    heads.push(L);
  }
  store.set('car', S.car);
  store.set('livery', S.livery);
  sound?.setCar(spec.id);
}

function placeOnRoad(s, back = 0) {
  const road = world.road, n = road.count;
  const i = wrap(Math.round(s - back), n);
  vehicle.reset(new THREE.Vector3(road.x[i], 0, road.z[i]), Math.atan2(road.tx[i], road.tz[i]), road.y[i]);
  rig.snap();
  ai?.reset();
}

function applyTime(name) {
  if (S.preset === name) return;
  S.preset = name;
  const t = TIMES[name];
  view.setTime(t);
  post.comp.uniforms.uExposure.value = t.exposure;
  S.lights = !!t.night;
  const ambient = new THREE.Color(t.fogColor).multiplyScalar(t.night ? 0.3 : 0.6);
  fx.setLighting(G.uSunCol.value, ambient);
  // grading: cool nights, warm evenings
  const gr = post.comp.uniforms;
  gr.uSaturation.value = t.night ? 0.9 : name === 'sunset' ? 1.1 : 1.05;
  gr.uGain.value.set(...(name === 'sunset' ? [1.03, 1.0, 0.95] : name === 'morning' ? [0.98, 1.0, 1.03] : [1, 1, 1]));
}

function setLights(on) {
  S.lights = on;
  const night = TIMES[S.preset]?.night;
  heads.forEach((h) => { h.intensity = on ? (night ? (h.userData.pod ? 1400 : 2600) : 400) : 0; });
  visual.paint.userData.u.uLights.value = on ? 1 : 0;
}

// ---------- Screens ----------
const SCREENS = ['menu-main', 'menu-stages', 'menu-garage', 'menu-settings', 'menu-pause', 'menu-results'];
function show(name) {
  for (const id of SCREENS) $(id).hidden = id !== name;
  const inRace = ['prestart', 'countdown', 'racing', 'finishing', 'free', 'paused'].includes(S.mode);
  $('hud').hidden = !inRace && S.mode !== 'results';
  $('touch').hidden = !(inRace && (touchDevice || input?.usingTouch)) || S.mode === 'paused';
}

function toMenu() {
  S.mode = 'menu';
  S.demo = true;
  codriver?.stop();
  clearGhost();
  props.setStarsVisible(false);
  if (S.preset !== 'sunset') applyTime('sunset');
  placeOnRoad(MENU_SPOT);
  fx.clear();
  S.run = null;
  setLights(false);
  refreshMenu();
  show('menu-main');
  $('btn-rally').focus({ preventScroll: true });
}

function refreshMenu() {
  $('title-a').textContent = GAME_TITLE[0];
  $('title-b').textContent = GAME_TITLE[1];
  $('tagline').textContent = TAGLINE;
  const got = S.stars.filter(Boolean).length;
  $('foot-stars').textContent = `★ ${got} / ${props.stars.length} stars found`;
  $('garage-sub').textContent = `${CARS[S.car].name}, ${LIVERIES[S.livery].name}`;
  $('btn-sound').textContent = settings.sound ? 'Sound on' : 'Sound off';
}

function medalFor(stage, t) {
  if (!isFinite(t)) return null;
  const [g, s, b] = stage.medals;
  return t <= g ? 'gold' : t <= s ? 'silver' : t <= b ? 'bronze' : null;
}

function stageLength(st) { return st.full ? world.road.count : (st.end - st.start + world.road.count) % world.road.count; }

function renderStages() {
  $('stage-list').innerHTML = STAGES.map((st, i) => {
    const best = S.best[st.id];
    const medal = best ? medalFor(st, best) : null;
    const km = (stageLength(st) / 1000).toFixed(2);
    return `<button class="stage-card" data-stage="${i}" style="--tint:${st.tint}">
      <span class="stage-num">SS${i + 1}</span>
      <span class="stage-name">${st.name}</span>
      <span class="stage-meta">${km} km · ${TIMES[st.time].name}</span>
      <span class="stage-meta">Gold ${formatTime(st.medals[0])}</span>
      <span class="stage-best"><span>${best ? formatTime(best) : 'No time yet'}</span>${medal ? `<i class="medal-dot ${medal}" title="${medal}"></i>` : ''}</span>
    </button>`;
  }).join('');
  for (const b of $('stage-list').querySelectorAll('.stage-card')) {
    b.addEventListener('click', () => { sound.click(); startStage(STAGES[+b.dataset.stage]); });
  }
  $('stage-list').querySelector('.stage-card')?.focus({ preventScroll: true });
}

function renderGarage() {
  const spec = CARS[S.car], liv = LIVERIES[S.livery];
  $('car-name').textContent = spec.name;
  $('car-blurb').textContent = spec.blurb;
  const hp = Math.round((spec.engine.torque * spec.engine.curve.reduce((m, [r, v]) => Math.max(m, r * v), 0)) / 7121);
  $('car-stats').innerHTML = [
    ['Power', `${hp} hp`], ['Weight', `${spec.mass} kg`], ['Drive', spec.drive.toUpperCase()],
    ['Gears', `${spec.gears.length}-speed`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('liv-name').textContent = liv.name;
  $('liv-swatch').innerHTML = [liv.base, liv.stripe, liv.accent].map((c) => `<i style="background:${c}"></i>`).join('');
}

function renderSettings() {
  const rows = [
    ['quality', 'Graphics', 'Auto picks for your device', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']]],
    ['assists', 'Driving help', 'Traction, ABS and slide assist', [['full', 'Full'], ['some', 'Some'], ['off', 'Off']]],
    ['gearbox', 'Gearbox', 'Manual: E / Q or bumpers', [['auto', 'Auto'], ['manual', 'Manual']]],
    ['codriver', 'Co-driver', 'Pace notes read aloud', [['voice', 'Voice'], ['icons', 'Icons'], ['off', 'Off']]],
    ['units', 'Speed', '', [['kmh', 'km/h'], ['mph', 'mph']]],
    ['tilt', 'Tilt to steer', 'Phones and tablets', [['off', 'Off'], ['on', 'On']]],
  ];
  $('settings-list').innerHTML = rows.map(([key, label, sub, opts]) => `
    <div class="setting"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>
      <div class="seg" data-key="${key}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${settings[key] === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    </div>`).join('');
  for (const seg of $('settings-list').querySelectorAll('.seg')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[seg.dataset.key] = b.dataset.v;
      saveSettings();
      sound.click();
      hud.units = settings.units;
      input.useTilt = settings.tilt === 'on';
      if (settings.tilt === 'on' && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
      renderSettings();
    });
  }
}

function wireMenus() {
  const gesture = () => { sound.init(CARS[S.car].id).then(() => sound.setMuted(!settings.sound)); };
  addEventListener('pointerdown', gesture, { once: false });
  addEventListener('keydown', gesture);
  $('btn-rally').addEventListener('click', () => { sound.click(); S.mode = 'stages'; renderStages(); show('menu-stages'); });
  $('btn-free').addEventListener('click', () => { sound.click(); startFree(); });
  $('btn-garage').addEventListener('click', () => { sound.click(); S.mode = 'garage'; renderGarage(); show('menu-garage'); garageView(); });
  $('btn-settings').addEventListener('click', () => { sound.click(); S.mode = 'settings'; renderSettings(); show('menu-settings'); });
  $('btn-sound').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); sound.setMuted(!settings.sound); refreshMenu(); });
  $('stages-back').addEventListener('click', toMenu);
  $('settings-back').addEventListener('click', toMenu);
  $('garage-done').addEventListener('click', toMenu);
  const cycleCar = (d) => { S.car = (S.car + d + CARS.length) % CARS.length; setupCar(); garageView(); renderGarage(); sound.click(); };
  const cycleLiv = (d) => { S.livery = (S.livery + d + LIVERIES.length) % LIVERIES.length; setupCar(); garageView(); renderGarage(); sound.click(); };
  $('car-prev').addEventListener('click', () => cycleCar(-1));
  $('car-next').addEventListener('click', () => cycleCar(1));
  $('liv-prev').addEventListener('click', () => cycleLiv(-1));
  $('liv-next').addEventListener('click', () => cycleLiv(1));
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', () => { resume(); restart(); });
  $('btn-recover').addEventListener('click', () => { resume(); recover('manual'); });
  $('btn-quit').addEventListener('click', toMenu);
  $('btn-pause').addEventListener('click', pause);
  $('btn-cam').addEventListener('click', () => { rig.cycle(); settings.view = rig.view; saveSettings(); });
  $('btn-again').addEventListener('click', () => startStage(S.stage));
  $('btn-next').addEventListener('click', () => startStage(STAGES[(STAGES.indexOf(S.stage) + 1) % STAGES.length]));
  $('btn-menu').addEventListener('click', toMenu);
  input.useTilt = settings.tilt === 'on';
  input.onKey = (code) => {
    const onButton = document.activeElement?.tagName === 'BUTTON';
    if ((code === 'Enter' || code === 'Space') && !onButton) {
      if (S.mode === 'menu') $('btn-rally').click();
      else if (S.mode === 'results') $('btn-again').click();
      else if (S.mode === 'paused') resume();
    }
    if (code === 'Escape') {
      if (['stages', 'garage', 'settings'].includes(S.mode)) toMenu();
      else if (S.mode === 'results') toMenu();
      else if (S.mode === 'paused') resume();
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
}

function setupTouch() {
  input.bindTouch({ left: $('t-left'), right: $('t-right'), gas: $('t-gas'), brake: $('t-brake'), hand: $('t-hand') });
  input.bindAction($('t-recover'), 'recover');
}

function garageView() {
  const road = world.road;
  placeOnRoad(MENU_SPOT);
  S.demo = false;
}

// ---------- Stages ----------
function startStage(stage) {
  S.stage = stage;
  S.demo = false;
  applyTime(stage.time);
  setLights(!!TIMES[stage.time].night);
  props.setStarsVisible(false);
  props.resetBales();
  fx.clear();
  const n = world.road.count;
  placeOnRoad(stage.start, 5);
  const len = stageLength(stage);
  S.run = {
    t: 0, dist: -5, lastS: wrap(stage.start - 5, n), hint: wrap(stage.start - 5, n), len,
    splits: [], nextSplit: 0, noteIdx: 0, stageNotes: stageNotes(stage), finished: false,
    topSpeed: 0, maxAir: 0, hits: 0, resets: 0, offT: 0, flipT: 0, lastGood: null, wrongT: 0, airT: 0,
  };
  // ghost of the best run on this stage
  clearGhost();
  const g = unpackGhost(store.raw('ghost:' + stage.id) || '');
  if (g) {
    ghostVisual = new CarVisual(CARS.find((c) => c.id === g.car) || CARS[0], LIVERIES[0], { noiseTex: view.textures.noise, patch, ghost: true, lowDetail: true });
    view.scene.add(ghostVisual.root);
    ghostPlayer = new GhostPlayer(g, ghostVisual);
    ghostPlayer.update(0);
    S.run.bestSplits = g.splits || null;
  }
  recorder.start();
  hud.setStage(`SS${STAGES.indexOf(stage) + 1} · ${stage.name}`, vehicle.spec.engine.redline / vehicle.spec.engine.limiter);
  hud.delta(null);
  hud.timer(0);
  S.mode = 'prestart';
  S.modeT = 0;
  rig.view = settings.view;
  rig.snap();
  codriver.enabled = settings.codriver === 'voice';
  codriver.stop();
  show(null);
  $('hud').hidden = false;
  $('touch').hidden = !(touchDevice || input.usingTouch);
}

function stageNotes(stage) {
  const n = world.road.count, len = stageLength(stage);
  return notes.map((nt) => ({ ...nt, d: (nt.s - stage.start + n) % n }))
    .filter((nt) => nt.d > 2 && nt.d < len - 10)
    .sort((a, b) => a.d - b.d);
}

function clearGhost() {
  if (ghostVisual) view.scene.remove(ghostVisual.root);
  ghostVisual = null;
  ghostPlayer = null;
}

function restart() {
  if (S.stage) startStage(S.stage);
  else if (S.run?.free) startFree();
}

function startFree() {
  S.demo = false;
  S.stage = null;
  applyTime(params.get('t') || 'noon');
  setLights(!!TIMES[S.preset].night);
  props.setStarsVisible(true, S.stars);
  props.resetBales();
  fx.clear();
  clearGhost();
  placeOnRoad(40, 5);
  S.run = { free: true, t: 0, topSpeed: 0, maxAir: 0, airT: 0, flipT: 0, hits: 0, lastGood: null, hint: -1 };
  hud.setStage(`Free roam · ★ ${S.stars.filter(Boolean).length} / ${props.stars.length}`, vehicle.spec.engine.redline / vehicle.spec.engine.limiter);
  hud.delta(null);
  hud.progress(0);
  S.mode = 'free';
  rig.view = settings.view;
  rig.snap();
  codriver.stop();
  show(null);
  $('hud').hidden = false;
  $('touch').hidden = !(touchDevice || input.usingTouch);
}

function pause() {
  if (!['prestart', 'countdown', 'racing', 'free', 'finishing'].includes(S.mode)) return;
  S.prevMode = S.mode;
  S.mode = 'paused';
  codriver.stop();
  sound.update(null, 0);
  show('menu-pause');
  $('hud').hidden = false;
  $('btn-resume').focus({ preventScroll: true });
}

function resume() {
  if (S.mode !== 'paused') return;
  S.mode = S.prevMode;
  show(null);
  $('hud').hidden = false;
  $('touch').hidden = !(touchDevice || input.usingTouch);
}

// Put the car back on the road near where it left it.
function recover(reason) {
  const road = world.road, n = road.count;
  const loc = locate(road, vehicle.pos.x, vehicle.pos.z, S.run?.hint ?? -1, 80);
  let s = loc.s;
  if (S.run?.lastGood && (reason === 'water' || loc.dist > 20)) s = S.run.lastGood;
  if (S.stage) {
    // never behind the start line
    const d = (s - S.stage.start + n) % n;
    if (d > S.run.len + 20) s = S.stage.start;
  }
  placeOnRoad(s, 3);
  if (S.run) {
    S.run.resets = (S.run.resets || 0) + 1;
    S.run.hint = wrap(Math.round(s - 3), n);
    S.run.flipT = 0; S.run.offT = 0;
    if (S.run.lastS !== undefined) S.run.lastS = S.run.hint;
  }
  fx.skids.last = [null, null, null, null];
  hud.popup(reason === 'water' ? 'Too deep! <em>Car recovered</em>' : 'Car <em>reset</em>', 1400);
}

// ---------- Per-frame ----------
const controls = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false, assist: 1, auto: true };

function playerControls(ctl) {
  controls.steer = ctl.steer;
  controls.throttle = ctl.throttle;
  controls.brake = ctl.brake;
  controls.handbrake = ctl.handbrake;
  controls.analog = ctl.analog;
  controls.assist = settings.assists === 'full' ? 1 : settings.assists === 'some' ? 0.5 : 0;
  controls.auto = settings.gearbox !== 'manual';
  controls.shiftUp = ctl.actions.has('shiftUp');
  controls.shiftDown = ctl.actions.has('shiftDown');
  return controls;
}

let last = performance.now();
let lastFps = 0, fpsFrames = 0, fps = 60;
// Adaptive resolution: keep the frame rate up by trading pixels.
const dyn = { scale: 1, ema: 1 / 60, lastChange: 0 };
function adaptResolution(now, rawDt) {
  if (rawDt > 0.25) return;                       // tab switch or hitch: ignore
  dyn.ema += (rawDt - dyn.ema) * 0.05;
  if (now - dyn.lastChange < 2500) return;
  let next = dyn.scale;
  if (dyn.ema > 1 / 44 && dyn.scale > 0.55) next = Math.max(0.55, dyn.scale - 0.1);
  else if (dyn.ema < 1 / 57 && dyn.scale < 1) next = Math.min(1, dyn.scale + 0.05);
  if (next !== dyn.scale) {
    dyn.scale = next;
    dyn.lastChange = now;
    resize();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, Math.max(0.001, rawDt));
  last = now;
  fpsFrames++;
  if (now - lastFps > 1000) { fps = fpsFrames * 1000 / (now - lastFps); fpsFrames = 0; lastFps = now; }
  if (!params.has('fixedres')) adaptResolution(now, rawDt);
  try {
    update(dt);
    post.render(view.scene, camera, S.time);
  } catch (err) {
    console.error(err);
  }
}

function update(dt) {
  S.time += dt;
  S.modeT += dt;
  const ctl = input.read(dt);
  if (ctl.actions.has('pause')) (S.mode === 'paused' ? resume() : pause());
  if (ctl.actions.has('mute')) { settings.sound = !settings.sound; saveSettings(); sound.setMuted(!settings.sound); }
  if (S.mode === 'paused') return;

  const driving = ['racing', 'free', 'prestart', 'countdown'].includes(S.mode);
  if (driving) {
    if (ctl.actions.has('camera')) { rig.cycle(); settings.view = rig.view; saveSettings(); }
    if (ctl.actions.has('lights')) setLights(!S.lights);
    if (ctl.actions.has('restart') && S.stage) { restart(); return; }
  }

  let inp;
  switch (S.mode) {
    case 'prestart':
    case 'countdown': {
      // held on the line: throttle revs the engine against the brakes
      const c = playerControls(ctl);
      inp = { ...c, brake: 1, handbrake: 1, steer: c.steer * 0.3, hold: true };
      if (vehicle.gear !== 1 && vehicle.shiftTimer <= 0) { vehicle.gear = vehicle.targetGear = 1; }
      countdownUpdate();
      break;
    }
    case 'racing':
    case 'free':
      inp = params.has('autodrive') ? ai.control(dt) : playerControls(ctl);
      if (ctl.actions.has('recover')) recover('manual');
      break;
    case 'finishing':
    case 'results': {
      // the co-driver takes the wheel and slows down
      const a = ai.control(dt);
      inp = { ...a, throttle: 0, brake: vehicle.speed > 2 ? 0.45 : 0.1 };
      break;
    }
    default:
      // menu backdrop: the robot drives the loop (and picks itself up after a crash)
      if (S.demo) {
        inp = ai.control(dt);
        S.demoStuck = (vehicle.U.y < 0.4 || vehicle.speed < 1) ? (S.demoStuck || 0) + dt : 0;
        if (S.demoStuck > 3) { S.demoStuck = 0; placeOnRoad(ai.progress ?? MENU_SPOT); }
      } else inp = { steer: 0, throttle: 0, brake: 1, handbrake: 1 };
  }

  vehicle.update(dt, inp);
  handleEvents(dt);
  visual.sync(vehicle, dt);
  if (S.run) runUpdate(dt);

  // camera
  if (['menu', 'stages', 'settings'].includes(S.mode)) rig.broadcast(vehicle, dt, S.time);
  else if (S.mode === 'garage') {
    const c = vehicle.pos.clone();
    rig.orbit(c, 7.2 / Math.min(1, Math.max(camera.aspect, 0.6)), 1.4, S.time, 0.25);
  } else if (S.mode === 'results') rig.broadcast(vehicle, dt, S.time);
  else rig.follow(vehicle, dt);
  viewOffset();

  // effects & world
  const fxOn = true;
  if (fxOn) fx.fromCar(vehicle, dt);
  fx.update(dt, camera, view.scene);
  const hits = props.update(dt, vehicle, S.time);
  for (const h of hits) { sound.impact(h.speed * 0.5, 'bale'); fx.debris(h.point, '#c9a85a', h.speed); }
  view.update(camera, vehicle.pos, dt);
  if (ghostPlayer && S.run && !S.run.free) {
    const gp = ghostPlayer.update(S.mode === 'racing' || S.mode === 'finishing' ? S.run.t : 0);
    ghostVisual.root.visible = S.mode !== 'prestart' || S.modeT > 0.3;
    S.run.ghostPos = gp;
  }
  const cameraInside = rig.view === 'bonnet' || rig.view === 'bumper';
  const audible = ['prestart', 'countdown', 'racing', 'free', 'finishing', 'results'].includes(S.mode);
  sound.update(vehicle, dt, { active: audible, cameraInside });
  hudUpdate();
  // debug stats
  if (params.has('debug')) document.title = `${fps.toFixed(0)} fps · res ${Math.round(dyn.scale * 100)}%`;
}

// Countdown: 3, 2, 1, GO.
function countdownUpdate() {
  const t = S.modeT;
  if (S.mode === 'prestart') {
    hud.countdown(null);
    if (t > 1.2) { S.mode = 'countdown'; S.modeT = 0; sound.beep(false); }
    return;
  }
  const k = 3 - Math.floor(t);
  if (k >= 1) {
    hud.countdown(String(k));
    if (Math.floor(t) !== Math.floor(t - 1 / 60) && t > 0.05) sound.beep(false);
  }
  if (t >= 3) {
    hud.countdown('GO');
    sound.beep(true);
    S.mode = 'racing';
    S.modeT = 0;
    S.run.t = 0;
    setTimeout(() => { if (S.mode === 'racing') hud.countdown(null); }, 700);
    callNotes(true);
  }
}

// Physics events: sounds, effects, camera shake.
function handleEvents(dt) {
  for (const e of vehicle.events) {
    switch (e.type) {
      case 'shift': sound.shift(e.up); break;
      case 'backfire': sound.backfire(e.power); fx.backfire(exhaustPos(), exhaustDir()); break;
      case 'impact': {
        if (e.speed < 2) break;
        sound.impact(e.speed, e.kind);
        rig.bump(Math.min(1, e.speed / 14));
        fx.debris(e.point, e.kind === 'tree' ? '#5a4030' : '#8a8580', e.speed);
        if (e.kind === 'rock' && e.speed > 5) fx.sparks(e.point, e.normal, e.speed);
        if (S.run) S.run.hits = (S.run.hits || 0) + 1;
        break;
      }
      case 'bottom': break;
    }
  }
  vehicle.events.length = 0;
  // landings: suspension slamming after airtime
  if (vehicle.grounded > 0 && S._airborne > 0.35) {
    const power = Math.min(1, S._airborne / 1.2);
    sound.landing(power);
    rig.bump(power * 0.8);
    fx.landing(vehicle, power);
  }
  S._airborne = vehicle.grounded === 0 ? (S._airborne || 0) + dt : 0;
  if (vehicle._scrape) { sound.scrape(vehicle._scrape); vehicle._scrape = 0; }
  // overrun pops at high revs when lifting off
  if (vehicle.throttle < 0.05 && vehicle.rpm > vehicle.spec.engine.redline * 0.65 && vehicle.engaged && Math.random() < dt * 3) {
    sound.backfire(0.5);
    fx.backfire(exhaustPos(), exhaustDir());
  }
  // rough roads shake the camera a little
  let comp = 0;
  for (const w of vehicle.wheels) comp = Math.max(comp, Math.abs(w.vComp));
  rig.shake = Math.max(rig.shake, Math.min(0.25, comp * 0.05) * Math.min(1, vehicle.speed / 15));
}

function exhaustPos() {
  const ex = visual.exhaust;
  return ex ? ex.getWorldPosition(new THREE.Vector3()) : vehicle.pos.clone();
}
function exhaustDir() { return vehicle.F.clone().negate(); }

// Stage timing, splits, finish, recovery, pace notes.
function runUpdate(dt) {
  const run = S.run, road = world.road, n = road.count;
  const loc = locate(road, vehicle.pos.x, vehicle.pos.z, run.hint, 50);
  run.hint = loc.i;
  run.topSpeed = Math.max(run.topSpeed || 0, vehicle.speed);
  if (vehicle.grounded === 0) run.airT += dt;
  else { if (run.airT > 0.6 && ['racing', 'free'].includes(S.mode)) hud.popup(`Big air <em>${run.airT.toFixed(1)} s</em>`, 1400); run.maxAir = Math.max(run.maxAir || 0, run.airT); run.airT = 0; }
  const onRoad = loc.dist < road.halfWidth + 1.5 && vehicle.U.y > 0.7;
  if (onRoad && vehicle.speed > 2) run.lastGood = loc.s;

  // flipped or stuck in deep water: put the car back
  const deep = WATER - world.heightAt(vehicle.pos.x, vehicle.pos.z);
  if (deep > 0.75 && vehicle.pos.y - vehicle.spec.cgHeight < WATER - 0.3) { recover('water'); return; }
  run.flipT = vehicle.U.y < 0.35 && vehicle.speed < 3 ? run.flipT + dt : 0;
  if (run.flipT > 2.2) { recover('flip'); return; }

  if (run.free) {
    run.t += dt;
    const k = props.collectStar(vehicle.pos);
    if (k >= 0) {
      S.stars[k] = true;
      store.set('stars', S.stars);
      sound.star();
      const got = S.stars.filter(Boolean).length;
      hud.popup(`★ Star <em>${got} / ${props.stars.length}</em>`, 2000);
      hud.setStage(`Free roam · ★ ${got} / ${props.stars.length}`, vehicle.spec.engine.redline / vehicle.spec.engine.limiter);
    }
    return;
  }

  // distance along the stage
  let ds = loc.s - run.lastS;
  if (ds > n / 2) ds -= n;
  if (ds < -n / 2) ds += n;
  if (Math.abs(ds) < 60) run.dist += ds;
  run.lastS = loc.s;

  if (S.mode === 'racing') {
    run.t += dt;
    recorder.sample(run.t, vehicle);
    // splits
    const splitAt = [run.len / 3, (2 * run.len) / 3];
    if (run.nextSplit < 2 && run.dist >= splitAt[run.nextSplit]) {
      run.splits.push(run.t);
      const best = run.bestSplits?.[run.nextSplit];
      if (best) {
        const d = run.t - best;
        hud.delta(d);
        hud.popup(`Split ${run.nextSplit + 1} <span class="${d < 0 ? 'good' : 'bad'}">${formatTime(d, true)}</span>`, 2200);
      } else hud.popup(`Split ${run.nextSplit + 1} <em>${formatTime(run.t)}</em>`, 2000);
      sound.chime();
      run.nextSplit++;
    }
    // off the route: warn, then pull the car back
    const off = loc.dist > road.halfWidth + 22;
    run.offT = off ? run.offT + dt : 0;
    if (loc.dist > 60 || run.offT > 5) { recover('off'); return; }
    // wrong way
    const dirDot = vehicle.vel.x * road.tx[loc.i] + vehicle.vel.z * road.tz[loc.i];
    run.wrongT = dirDot < -3 ? run.wrongT + dt : 0;
    hud.warning(run.offT > 1 ? `Back to the stage ${Math.ceil(5 - run.offT)}` : run.wrongT > 1.5 ? 'Wrong way!' : '');
    callNotes(false);
    // finish line
    if (run.dist >= run.len) finish();
  }
}

// Read out the notes a few seconds ahead.
function callNotes(first) {
  const run = S.run;
  const list = run.stageNotes;
  const ahead = Math.max(55, vehicle.speed * 3.6);
  let said = [];
  while (run.noteIdx < list.length && list[run.noteIdx].d < run.dist + ahead + (first ? 60 : 0)) {
    said.push(noteText(list[run.noteIdx]));
    run.noteIdx++;
    if (said.length >= 2) break;
  }
  if (said.length && settings.codriver === 'voice') codriver.say(said.join(', '));
  // HUD shows the next two corners still ahead of us
  if (settings.codriver !== 'off') {
    const show = [];
    for (let k = Math.max(0, run.noteIdx - 3); k < list.length && show.length < 2; k++) if (list[k].d > run.dist - 4 && list[k].d < run.dist + 260) show.push(list[k]);
    hud.notes(show);
  } else hud.notes([]);
}

function finish() {
  const run = S.run;
  run.finished = true;
  const t = run.t;
  S.mode = 'finishing';
  S.modeT = 0;
  sound.horn();
  codriver.stop();
  if (settings.codriver === 'voice') codriver.say('Stop, stop. Good job!', 1.15);
  hud.warning('');
  hud.notes([]);
  ai.reset();
  const prev = S.best[S.stage.id];
  const isBest = !prev || t < prev;
  hud.popup(`Stage <em>finished</em>`, 2200);
  if (isBest) {
    S.best[S.stage.id] = t;
    store.set('best', S.best);
    store.raw('ghost:' + S.stage.id, recorder.pack({ car: vehicle.spec.id, splits: run.splits, time: t }));
  }
  run.result = { t, prev, isBest };
  setTimeout(() => showResults(), 2600);
}

function showResults() {
  if (S.mode !== 'finishing') return;
  const run = S.run, st = S.stage;
  S.mode = 'results';
  const { t, prev, isBest } = run.result;
  $('result-stage').textContent = `SS${STAGES.indexOf(st) + 1} · ${st.name}`;
  $('result-title').textContent = isBest && prev ? 'New stage record!' : isBest ? 'Stage complete' : 'Stage complete';
  $('result-time').textContent = formatTime(t);
  const medal = medalFor(st, t);
  const m = $('result-medal');
  m.hidden = !medal;
  if (medal) { m.className = `medal ${medal}`; m.textContent = `${medal} medal`; }
  const kmh = (run.len / t) * 3.6;
  const conv = (v) => (settings.units === 'mph' ? `${Math.round(v * 0.6214)} mph` : `${Math.round(v)} km/h`);
  const rows = [
    ['Best', formatTime(Math.min(t, prev ?? Infinity))],
    [prev ? 'vs best' : 'First run', prev ? formatTime(t - prev, true) : '—'],
    ['Average', conv(kmh)],
    ['Top speed', conv(run.topSpeed * 3.6)],
    ['Longest jump', `${(run.maxAir || 0).toFixed(1)} s`],
    ['Resets', String(run.resets || 0)],
    ['Next medal', nextMedal(st, t)],
  ];
  $('result-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  show('menu-results');
  $('hud').hidden = true;
  $('btn-again').focus({ preventScroll: true });
}

function nextMedal(st, t) {
  const names = ['gold', 'silver', 'bronze'];
  for (let i = 2; i >= 0; i--) if (t > st.medals[i]) return `${names[i]} ${formatTime(st.medals[i])}`;
  for (let i = 1; i >= 0; i--) if (t > st.medals[i]) return `${names[i]} ${formatTime(st.medals[i])}`;
  return 'All won!';
}

function hudUpdate() {
  if ($('hud').hidden) return;
  hud.dash(vehicle);
  const run = S.run;
  if (run && !run.free) {
    hud.timer(S.mode === 'finishing' || S.mode === 'results' ? run.result?.t ?? run.t : run.t);
    const frac = run.dist / run.len;
    let gFrac = null;
    if (ghostPlayer && run.ghostPos) {
      const gl = locate(world.road, run.ghostPos.x, run.ghostPos.z, run.ghostHint ?? -1, 60);
      run.ghostHint = gl.i;
      gFrac = ((gl.s - S.stage.start + world.road.count) % world.road.count) / run.len;
      if (gFrac > 1.2) gFrac = 0;
    }
    hud.progress(frac, gFrac);
  } else if (run?.free) {
    hud.timer(run.t);
  }
  const markers = run?.free ? props.stars.filter((s) => !s.got).map((s) => ({ x: s.x, z: s.z, color: '#ffcf40', r: 4 })) : [];
  hud.minimap(vehicle, ghostPlayer && run && !run.free ? run.ghostPos : null, markers);
}

// Menus sit on the left: shift the picture so the car sits in the clear space.
function viewOffset() {
  const W = innerWidth, H = innerHeight;
  const menu = ['menu', 'stages', 'garage', 'settings'].includes(S.mode);
  if (menu && W > 640) camera.setViewOffset(W, H, -Math.min(260, W * 0.2), 0, W, H);
  else if (menu) camera.setViewOffset(W, H, 0, H * 0.22, W, H);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITY[S.quality].pixelRatio) * dyn.scale);
  renderer.setSize(w, h, false);
  const pr = renderer.getPixelRatio();
  post.setSize(Math.floor(w * pr), Math.floor(h * pr));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => { if (renderer && post) resize(); });

boot().catch((err) => {
  console.error(err);
  $('loading-text').textContent = 'Something went wrong while loading: ' + (err?.message || err);
});
