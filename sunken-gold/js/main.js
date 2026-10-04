import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GAME_TITLE, TAGLINE, DIVE, AIR, SHARK, UPGRADES, FUN } from './config.js';
import { loadAssets } from './assets.js';
import { U, makeEnvironment, makeBackdrop, makeSurface, GodRays, makeMarineSnow, Bubbles, makeLampBeam } from './ocean.js';
import { Seabed } from './seabed.js';
import { Colliders } from './collide.js';
import { prepareMaterials, buildScenery } from './scenery.js';
import { SeaLife } from './life.js';
import { Treasure } from './treasure.js';
import { CoinTrails, CurrentRings, GoldenFish, Missions } from './fun.js';
import { Diver } from './player.js';
import { Sound } from './audio.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const text = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const fmt = (n) => Math.round(n).toLocaleString();

// ---------- Save data (localStorage may be unavailable; the game still runs) ----------
const SAVE_KEY = 'sunken-gold:save';
const freshSave = () => ({ gold: 0, upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])), relics: [], taken: {},
  dives: 0, best: 0, total: 0, hints: {}, won: false, muted: false });
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') return { ...freshSave(), ...s, upgrades: { ...freshSave().upgrades, ...s.upgrades } };
  } catch { /* ignore */ }
  return freshSave();
}
const save = loadSave();
function storeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

// ---------- Renderer ----------
const params = new URLSearchParams(location.search);
const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (coarse) document.body.classList.add('touch');
const quality = params.get('q') || (coarse || Math.min(innerWidth, innerHeight) < 500 ? 'low' : 'high');
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  $('load-text').textContent = 'This game needs WebGL 2, which your browser could not start.';
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.75 : 1.25));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const vmScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 420);

// ---------- Boot ----------
$('title-a').textContent = GAME_TITLE[0];
$('title-b').textContent = GAME_TITLE[1];
$('tagline').textContent = TAGLINE;

let A, seabed, colliders, world, life, treasure, trails, rings, golden, diver, godRays, snow, bubbles, beam, sun, vmSun, composer, post, bloom, vmPass;
const sound = new Sound();
sound.setMuted(save.muted);
const input = new Input(canvas, {
  stick(on, x, y, dx, dy) {
    const s = $('stick');
    s.hidden = !on;
    if (on) {
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      $('stick-knob').style.transform = `translate(${dx}px, ${dy}px)`;
    }
  },
});

async function boot() {
  A = await loadAssets(renderer, (p) => { $('load-fill').style.width = `${(p * 100).toFixed(0)}%`; });
  $('load-text').textContent = 'Flooding the reef…';
  await new Promise((r) => setTimeout(r, 30));
  world = A.world;

  const env = makeEnvironment(renderer);
  scene.environment = env;
  vmScene.environment = env;
  scene.environmentIntensity = 0.7;
  vmScene.environmentIntensity = 0.9;

  sun = new THREE.DirectionalLight('#fff3dc', 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -32;
  sc.right = sc.top = 32;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#c4ecff', '#0d2b36', 0.3));
  vmSun = new THREE.DirectionalLight('#fff3dc', 2.4);
  vmScene.add(vmSun, vmSun.target, new THREE.HemisphereLight('#c4ecff', '#0d2b36', 0.6));

  scene.add(makeBackdrop());
  scene.add(makeSurface(A.textures.water_normal));
  prepareMaterials(A.models, A.textures);
  seabed = new Seabed(A, quality);
  scene.add(seabed.group);
  colliders = new Colliders(world.colliders, A.colliders);
  const built = buildScenery(scene, A, seabed, colliders, quality);
  world.built = built;
  life = new SeaLife(scene, A, seabed, colliders);
  treasure = new Treasure(scene, A, seabed, save);
  trails = new CoinTrails(scene, A.models, world.treasure.trails);
  rings = new CurrentRings(scene, world.treasure.trails);
  golden = new GoldenFish(scene, A.models, world.life.golden, seabed);
  diver = new Diver(camera, seabed, colliders, A.models);
  vmScene.add(diver.view);
  godRays = new GodRays(quality === 'high' ? 24 : 12);
  scene.add(godRays.mesh);
  snow = makeMarineSnow(quality === 'high' ? 2200 : 900);
  scene.add(snow);
  bubbles = new Bubbles(quality === 'high' ? 1200 : 600);
  scene.add(bubbles.points);
  beam = makeLampBeam();
  scene.add(beam);

  // Post-processing: world, then the view model on top, bloom, the mask/water pass, tone mapping.
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  vmPass = new RenderPass(vmScene, camera);
  vmPass.clear = false;
  vmPass.clearDepth = true;
  composer.addPass(vmPass);
  if (quality !== 'low') {
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.55, 0.95);
    composer.addPass(bloom);
  }
  post = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uUnder: { value: 1 }, uDamage: { value: 0 }, uDark: { value: 0 }, uVignette: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uUnder, uDamage, uDark, uVignette; varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        uv += uUnder * vec2(sin(uv.y * 17.0 + uTime * 1.3), cos(uv.x * 13.0 + uTime * 1.1)) * 0.0011;
        vec2 c = uv - 0.5;
        float r2 = dot(c, c);
        vec2 off = c * r2 * 0.02 * uUnder;
        vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
        float vig = smoothstep(0.95, 0.3, length(c * vec2(1.0, 0.82)));
        col *= mix(1.0, vig, uVignette * 0.75);
        col = mix(col, col * vec3(1.6, 0.35, 0.35) + vec3(0.08, 0.0, 0.0), uDamage * smoothstep(0.1, 0.5, r2 * 2.0 + 0.1));
        col *= 1.0 - uDark;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(post);
  composer.addPass(new OutputPass());
  resize();

  applyUpgrades();
  setupUI();
  diver.spawn(world.spawn, 0);
  // Compile shaders up front so the first dive doesn't stutter.
  $('load-text').textContent = 'Warming up the lamp…';
  placeTitleCamera(0);
  envUpdate(0);
  try { await renderer.compileAsync(scene, camera); } catch { /* older browsers: compile lazily */ }
  $('loading').hidden = true;
  toMenu();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  $('load-text').textContent = location.protocol === 'file:'
    ? 'Open this game through a web server (see README), or use the single-file desktop version.'
    : `Could not start: ${err.message}`;
});

// ---------- State ----------
const S = {
  mode: 'loading',     // menu | diving | boat | paused | blackout | win
  time: 0,
  dive: null,
  lamp: false,
  strobeCool: 0,
  strobeMax: 14,
  magnet: 1.6,
  airMax: AIR.tank,
  damage: 0,
  dark: 0,
  zone: null,
  hold: 0,
  promptFor: null,
  breathT: 0,
  hintUntil: 0,
};

const missions = new Missions();

function newDive() {
  return { air: S.airMax, bag: 0, coins: 0, pearls: 0, chests: 0, artifacts: 0, relics: [], pending: [], lostToShark: 0, time: 0, maxDepth: 0,
    golden: 0, rings: 0, missionGold: 0, missionsDone: 0, bestCombo: 1, combo: 0, comboAt: -9 };
}

function level(id) { return save.upgrades[id] || 0; }
function upValue(id) { const u = UPGRADES.find((x) => x.id === id); return u.levels[level(id)]; }

function applyUpgrades() {
  S.airMax = upValue('tank');
  diver.speedLevel = upValue('scooter');
  diver.boostSpeed = upValue('scooter') * 1.9;
  diver.batteryMax = upValue('battery');
  diver.battery = diver.batteryMax;
  U.uLampRange.value = upValue('lamp');
  S.strobeMax = upValue('strobe');
  S.magnet = upValue('magnet');
}

// ---------- UI ----------
function setScreen(name) {
  for (const id of ['menu', 'boat', 'paused', 'blackout', 'win']) $(id).hidden = id !== name;
  $('hud').hidden = !(name === 'hud' || name === 'paused');
}

function popup(html, cls = '') {
  const box = $('popups');
  while (box.children.length > 3) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

function hint(key, html, secs = 7) {
  if (save.hints[key]) return;
  save.hints[key] = true;
  storeSave();
  $('hint').innerHTML = html;
  $('hint').hidden = false;
  S.hintUntil = S.time + secs;
}

const RELIC_IDS = ['compass', 'idol', 'trident', 'sundisc', 'crown'];
const RELIC_ICONS = { compass: '✦', idol: '♜', trident: 'Ψ', sundisc: '☀', crown: '♛' };

function setupUI() {
  $('relics').innerHTML = RELIC_IDS.map((id) => `<div class="relic" data-id="${id}" title="">${RELIC_ICONS[id]}</div>`).join('');
  const strip = $('compass-strip');
  const marks = [];
  for (let d = 0; d < 360; d += 15) {
    const el = document.createElement('div');
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    el.className = names[d] ? `tick ${d % 90 ? '' : 'major'}` : 'tick minor';
    el.textContent = names[d] || '';
    strip.appendChild(el);
    marks.push({ el, deg: d });
  }
  const boatMark = document.createElement('div');
  boatMark.className = 'marker boat';
  boatMark.textContent = '⛵';
  strip.appendChild(boatMark);
  const ventMarks = treasure.vents.map(() => {
    const el = document.createElement('div');
    el.className = 'marker vent';
    el.textContent = '◎';
    strip.appendChild(el);
    return el;
  });
  const mk = (cls, txt) => {
    const el = document.createElement('div');
    el.className = `marker ${cls}`;
    el.textContent = txt;
    strip.appendChild(el);
    return el;
  };
  const chestMarks = treasure.items.filter((i) => i.kind === 'chest').map((it) => ({ it, el: mk('chest', '★') }));
  const relicMarks = treasure.items.filter((i) => i.kind === 'relic').map((it) => ({ it, el: mk('relic', '✦') }));
  const fishMarks = golden.fish.map((f) => ({ f, el: mk('fish', '◆') }));
  const coinMark = mk('coin', '●');
  S.compass = { marks, boatMark, ventMarks, chestMarks, relicMarks, fishMarks, coinMark };

  $('btn-dive').addEventListener('click', () => { sound.init(); startDive(); });
  $('btn-redive').addEventListener('click', () => { sound.init(); startDive(); });
  $('btn-boat-menu').addEventListener('click', () => { sound.ui(); toMenu(); });
  $('btn-resume').addEventListener('click', resume);
  $('btn-surface').addEventListener('click', () => { resume(); blackout('abort'); });
  $('btn-blackout').addEventListener('click', () => { sound.ui(); toBoat(); });
  $('btn-win').addEventListener('click', () => { sound.ui(); toBoat(true); });
  $('btn-pause').addEventListener('click', pause);
  const soundBtns = [$('btn-sound'), $('btn-pause-sound')];
  const renderSound = () => soundBtns.forEach((b) => text(b, save.muted ? 'Sound off' : 'Sound on'));
  soundBtns.forEach((b) => b.addEventListener('click', () => {
    save.muted = !save.muted;
    sound.init();
    sound.setMuted(save.muted);
    storeSave();
    renderSound();
  }));
  renderSound();
  // Two taps to wipe progress (a confirm() dialog isn't available everywhere the game runs).
  let resetArmed = 0;
  $('btn-reset').addEventListener('click', () => {
    const b = $('btn-reset');
    if (performance.now() - resetArmed > 4000) {
      resetArmed = performance.now();
      b.textContent = 'Tap again to erase all progress';
      setTimeout(() => { if (performance.now() - resetArmed >= 3900) b.textContent = 'New game'; }, 4000);
      return;
    }
    resetArmed = 0;
    b.textContent = 'New game';
    Object.assign(save, freshSave(), { muted: save.muted });
    storeSave();
    applyUpgrades();
    treasure.resetDive();
    toMenu();
  });

  input.onKey = (code) => {
    if (S.mode === 'menu' && (code === 'Enter' || code === 'PadA' || code === 'PadStart')) { sound.init(); startDive(); return; }
    if (S.mode === 'boat' && (code === 'Enter' || code === 'PadStart')) { sound.init(); startDive(); return; }
    if (S.mode === 'diving') {
      if (code === 'Escape' || code === 'KeyP' || code === 'PadStart') pause();
      else if (code === 'KeyF' || code === 'TouchLamp' || code === 'PadY') toggleLamp();
      else if (code === 'KeyQ' || code === 'MouseRight' || code === 'TouchStrobe' || code === 'PadX') strobe();
      else if (code === 'KeyM') { save.muted = !save.muted; sound.setMuted(save.muted); storeSave(); }
    } else if (S.mode === 'paused' && (code === 'Escape' || code === 'KeyP' || code === 'PadStart')) resume();
  };
  input.onLockChange = (locked) => {
    if (!locked && S.mode === 'diving' && !input.usingTouch) pause();
  };
  canvas.addEventListener('click', () => {
    if (S.mode === 'diving' && !input.pointerLocked) input.requestLock();
  });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'diving') pause(); });
  sound.onExhale = () => exhale();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer?.setSize(w, h);
  bloom?.setSize(w, h);
}

// ---------- Flow ----------
function toMenu() {
  S.mode = 'menu';
  input.releaseLock();
  text($('menu-gold'), fmt(save.gold));
  text($('menu-relics'), `${save.relics.length} / 5`);
  text($('btn-dive'), save.dives ? 'Continue' : 'Dive');
  vmPass.enabled = false;
  setScreen('menu');
}

function startDive() {
  sound.splash();
  treasure.resetDive();
  trails.reset();
  rings.reset();
  golden.reset();
  applyUpgrades();
  S.dive = newDive();
  missions.roll(save.dives, treasure.items.filter((i) => i.kind === 'chest' && !i.taken).length);
  renderMissions();
  S.lamp = false;
  S.strobeCool = 0;
  S.damage = 0;
  S.dark = 0.6;
  S.zone = null;
  diver.spawn(world.spawn, 0);
  input.taps.clear();
  life.sharks.forEach((s) => { s.state = 'patrol'; s.cool = 10; });
  S.mode = 'diving';
  vmPass.enabled = true;
  setScreen('hud');
  input.requestLock();
  bubbles.emit(diver.pos.clone().add(new THREE.Vector3(0, -0.6, 0)), 120, 1.2, [0.01, 0.06], 0.3);
  if (!save.dives) {
    hint('start', input.usingTouch
      ? '<b>Follow the trails of floating gold coins!</b> Left thumb to swim, drag to look. Bank your loot back at the boat before your <b>air</b> runs out.'
      : '<b>Follow the trails of floating gold coins!</b> W to swim, mouse to look, Space / C to rise and sink. Bank your loot back at the boat before your <b>air</b> runs out.', 12);
  }
}

function pause() {
  if (S.mode !== 'diving') return;
  S.mode = 'paused';
  input.releaseLock();
  setScreen('paused');
}

function resume() {
  if (S.mode !== 'paused') return;
  sound.init();
  S.mode = 'diving';
  setScreen('hud');
  input.requestLock();
}

function board() {
  const d = S.dive;
  sound.splash();
  save.gold += d.bag;
  save.total += d.bag;
  save.best = Math.max(save.best, d.bag);
  for (const id of d.pending) save.taken[id] = save.dives;
  for (const r of d.relics) if (!save.relics.includes(r)) save.relics.push(r);
  save.dives++;
  storeSave();
  const rows = [];
  if (d.coins) rows.push(['Doubloons', `${d.coins}`]);
  if (d.pearls) rows.push(['Pearls', `${d.pearls}`]);
  if (d.chests) rows.push(['Chests', `${d.chests}`]);
  if (d.artifacts) rows.push(['Artifacts', `${d.artifacts}`]);
  for (const r of d.relics) rows.push(['Relic', treasure.items.find((i) => i.id === r).name]);
  if (d.lostToShark) rows.push(['Lost to sharks', `−${fmt(d.lostToShark)}`, 'lost']);
  if (d.golden) rows.push(['Golden fish', `${d.golden}`]);
  if (d.missionsDone) rows.push(['Missions', `${d.missionsDone} (+${fmt(d.missionGold)})`]);
  if (d.bestCombo > 1) rows.push(['Best combo', `x${d.bestCombo}`]);
  rows.push(['Deepest point', `${d.maxDepth.toFixed(1)} m`]);
  $('boat-report').innerHTML = `<div class="row"><span>Banked this dive</span><b>+${fmt(d.bag)}</b></div>` +
    rows.map(([k, v, c]) => `<div class="row ${c || ''}"><span>${k}</span><span>${v}</span></div>`).join('');
  S.mode = 'boat';
  input.releaseLock();
  if (save.relics.length === 5 && !save.won) {
    save.won = true;
    storeSave();
    $('win-stats').innerHTML = [['Dives', save.dives], ['Gold banked', fmt(save.total)], ['Best haul', fmt(save.best)]]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    sound.relic();
    S.mode = 'win';
    setScreen('win');
    return;
  }
  toBoat(true);
}

function toBoat(keepReport = false) {
  S.mode = 'boat';
  vmPass.enabled = false;
  input.releaseLock();
  if (!keepReport) $('boat-report').innerHTML = '<div class="row"><span>The crew hauled you aboard.</span></div>';
  renderShop();
  renderJournal();
  setScreen('boat');
}

function blackout(reason) {
  if (S.mode !== 'diving') return;
  const d = S.dive;
  save.dives++;
  storeSave();
  S.mode = 'blackout';
  input.releaseLock();
  text($('blackout-title'), reason === 'abort' ? 'Dive aborted' : 'You blacked out');
  const lost = d.bag + d.relics.length;
  $('blackout-text').textContent = reason === 'abort'
    ? 'You signalled the boat and were pulled out. Anything in your bag sank back to the bottom.'
    : `Your tank ran dry and the crew hauled you up just in time. ${lost ? `The ${fmt(d.bag)} gold${d.relics.length ? ' and the relic' : ''} in your bag went back to the deep.` : ''}`;
  setScreen('blackout');
  vmPass.enabled = false;
}

function renderShop() {
  text($('boat-gold'), fmt(save.gold));
  $('shop').innerHTML = UPGRADES.map((u) => {
    const lv = level(u.id), max = lv >= u.cost.length;
    const cost = max ? 0 : u.cost[lv];
    const pips = u.levels.slice(1).map((_, i) => `<span class="pip ${i < lv ? 'on' : ''}"></span>`).join('');
    const next = max ? 'Maxed out' : `Next: ${u.levels[lv + 1]} ${u.unit}`;
    return `<div class="up"><span class="name">${u.name}</span>
      <button type="button" data-up="${u.id}" ${max || save.gold < cost ? 'disabled' : ''}>${max ? 'Max' : fmt(cost)}</button>
      <span class="val">${u.levels[lv]} ${u.unit} · ${next}</span><span class="pips">${pips}</span></div>`;
  }).join('');
  for (const b of $('shop').querySelectorAll('button[data-up]')) {
    b.addEventListener('click', () => {
      const u = UPGRADES.find((x) => x.id === b.dataset.up);
      const lv = level(u.id);
      if (lv >= u.cost.length || save.gold < u.cost[lv]) return;
      save.gold -= u.cost[lv];
      save.upgrades[u.id] = lv + 1;
      storeSave();
      applyUpgrades();
      sound.buy();
      renderShop();
    });
  }
}

function bearingName(dx, dz) {
  const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
}

function renderJournal() {
  const relics = treasure.items.filter((i) => i.kind === 'relic');
  $('journal').innerHTML = relics.map((r) => {
    const done = save.relics.includes(r.id);
    const dx = r.pos.x - world.boat[0], dz = r.pos.z - world.boat[2];
    const where = `${bearingName(dx, dz)} of the boat, about ${Math.round(Math.hypot(dx, dz) / 10) * 10} m, ${Math.round(-r.pos.y)} m deep`;
    return `<li class="${done ? 'done' : ''}"><b>${r.name}</b>: ${done ? 'recovered' : `${r.hint}, ${where}`}</li>`;
  }).join('');
}

// ---------- Actions ----------
function toggleLamp() {
  S.lamp = !S.lamp;
  sound.ui();
}

function strobe() {
  if (S.strobeCool > 0) return;
  S.strobeCool = S.strobeMax;
  U.uFlash.value = 1.2;
  $('flash').style.opacity = '0.55';
  sound.strobe();
  const n = life.strobe(diver, diver.forward, 20);
  if (n) {
    popup(`Shark <em>scared off</em>`);
    completeMissions(missions.bump('strobe'));
  }
}

function exhale() {
  if (S.mode !== 'diving' || !diver.underwater) return;
  const p = new THREE.Vector3();
  for (let i = 0; i < 2; i++) bubbles.emit(diver.regulator(p), 14, 0.06, [0.01, 0.045], 0.5);
}

function grab(it) {
  const d = S.dive;
  treasure.take(it);
  d.pending.push(it.id);
  d.bag += it.value;
  if (it.kind === 'pearl') {
    d.pearls++;
    completeMissions(missions.bump('pearl'));
    sound.pearl();
    popup(`Pearl <em>+${it.value}</em>`);
  } else if (it.kind === 'chest') {
    d.chests++;
    completeMissions(missions.bump('chest'));
    sound.chest();
    popup(`Treasure chest <em>+${it.value}</em>`, 'big');
    const p = it.pos.clone();
    bubbles.emit(p, 60, 0.6, [0.01, 0.05], 0.8);
  } else if (it.kind === 'relic') {
    d.relics.push(it.id);
    sound.relic();
    popup(`${it.name}!`, 'big');
    popup(`Bring it to the boat <em>+${it.value}</em>`);
    hint('relic', 'Relics only count once they are <b>banked on the boat</b>. Don\'t run out of air on the way back!', 8);
  } else {
    d.artifacts++;
    sound.grab();
    const names = { amphora: 'Amphora', goblet: 'Golden goblet', ingot: 'Gold bar', gem: 'Gemstone' };
    popup(`${names[it.kind] || 'Treasure'} <em>+${it.value}</em>`);
  }
}

function completeMissions(done) {
  for (const m of done) {
    const d = S.dive;
    d.bag += m.reward;
    d.missionGold += m.reward;
    d.missionsDone++;
    sound.mission();
    popup(`Mission complete! <em>+${m.reward}</em>`, 'big');
  }
  if (done.length) renderMissions();
}

function renderMissions() {
  $('missions').innerHTML = missions.list.map((m) => `<li class="${m.done ? 'done' : ''}"><span class="tick">${m.done ? '✓' : ''}</span>` +
    `<span class="mt">${m.text}</span><span class="mp num">${m.done ? `+${m.reward}` : m.n > 1 ? `${m.have}/${m.n}` : ''}</span></li>`).join('');
}

function bite(shark) {
  const d = S.dive;
  sound.bite();
  S.damage = 1;
  d.air -= SHARK.biteAir;
  const lost = Math.round(d.bag * SHARK.biteLoot);
  d.bag -= lost;
  d.lostToShark += lost;
  popup(`Shark bite! <em>−${SHARK.biteAir}s air</em>`, 'bad');
  if (lost) popup(`Dropped <em>${fmt(lost)} gold</em>`, 'bad');
  diver.vel.addScaledVector(new THREE.Vector3().subVectors(diver.pos, shark.pos).normalize(), 4);
}

// ---------- Per-mode updates ----------
const tmpV = new THREE.Vector3();

function placeTitleCamera(t) {
  const a = t * 0.04;
  const c = new THREE.Vector3(-4, -9.5, -26);
  camera.position.set(c.x + Math.cos(a) * 16, -4.2 + Math.sin(t * 0.13) * 0.6, c.z + Math.sin(a) * 16);
  camera.lookAt(c.x, c.y + 1.5, c.z);
}

function placeBoatCamera(t) {
  const b = new THREE.Vector3().fromArray(world.boat);
  // Stand off the boat's quarter with it on the right of the screen, clear of the shop panel.
  camera.position.set(b.x - 4, 2.4 + Math.sin(t * 0.9) * 0.15, b.z + 17);
  camera.lookAt(b.x - 9, 1.0, b.z - 2);
}

function diveUpdate(dt) {
  const d = S.dive;
  d.time += dt;
  const look = input.consumeLook(dt);
  diver.look(look.x, look.y, input.usingTouch ? DIVE.touchSensitivity : DIVE.mouseSensitivity);
  const move = input.move;
  const wasTouching = diver.touching > 0;
  diver.update(dt, S.time, move, input.boost);
  if (!wasTouching && diver.touching > 0 && diver.vel.length() > 1.2) sound.bump();
  d.maxDepth = Math.max(d.maxDepth, diver.depth);

  // Air: deeper means denser air, so every breath costs more.
  const rate = diver.underwater ? (1 + diver.depth / AIR.pressureDepth) * (diver.boosting ? AIR.boostCost : 1) : 0;
  d.air -= rate * dt;
  d.rate = rate;

  // Pickups and vents.
  let inVent = false;
  const events = treasure.update(dt, S.time, diver, S.magnet);
  trails.update(dt, S.time, diver.pos, Math.max(S.magnet, 1.9), events);
  golden.update(dt, S.time, diver, events);
  completeMissions(missions.bump('depth', Math.floor(diver.depth), true));
  for (const e of events) {
    if (e.type === 'coin') {
      // Grab coins quickly one after another to build a combo multiplier.
      d.combo = S.time - d.comboAt < FUN.comboWindow ? d.combo + 1 : 1;
      d.comboAt = S.time;
      const mult = Math.min(FUN.comboMax, 1 + Math.floor((d.combo - 1) / FUN.comboStep));
      d.bestCombo = Math.max(d.bestCombo, mult);
      d.bag += e.value * mult;
      d.coins++;
      sound.coin(Math.random() * 2, d.combo);
      if (mult > (d.lastMult || 1)) popup(`Combo <em>x${mult}</em>`, 'combo');
      d.lastMult = mult;
      completeMissions(missions.bump('coins'));
      completeMissions(missions.bump('combo', mult, true));
    } else if (e.type === 'golden') {
      d.bag += e.value;
      d.golden++;
      sound.golden();
      popup(`Golden fish! <em>+${e.value}</em>`, 'big');
      bubbles.emit(e.pos, 50, 0.5, [0.01, 0.04], 0.6);
      completeMissions(missions.bump('golden'));
    } else if (e.type === 'tank') {
      d.air = Math.min(S.airMax, d.air + AIR.spareTank);
      sound.air();
      popup(`Spare air <em>+${AIR.spareTank}s</em>`);
    } else if (e.type === 'vent') {
      inVent = true;
    }
  }
  if (S.time - d.comboAt > FUN.comboWindow) { d.combo = 0; d.lastMult = 1; }
  // Current rings fling you along the route.
  const ring = rings.update(dt, diver.pos);
  if (ring) {
    diver.surge(ring.dir, FUN.ringSpeed, FUN.ringTime);
    d.rings++;
    sound.ring();
    bubbles.emit(ring.c, 40, FUN.ringRadius, [0.01, 0.05], 0.4);
    completeMissions(missions.bump('rings'));
    if (d.rings === 1) hint('ring', 'Current rings shoot you along the trail. Line up the next one!', 6);
  }
  if (inVent && d.air < S.airMax) {
    d.air = Math.min(S.airMax, d.air + AIR.ventRefill * dt);
    hint('vent', 'Bubble vents top up your <b>air</b>. They show on your compass as <b>◎</b>.', 7);
  }
  S.inVent = inVent;

  // Grab / open.
  const target = treasure.target(diver, diver.forward);
  const grabbing = input.grab;
  const tapped = input.takeGrabTap();
  let prompt = '';
  if (target) {
    if (target.kind === 'chest') {
      prompt = input.usingTouch ? 'Hold <b>Grab</b> to pry open the chest' : 'Hold <b>E</b> to pry open the chest';
      S.hold = grabbing || tapped ? S.hold + dt : Math.max(0, S.hold - dt * 2);
      if (S.hold >= target.hold) { S.hold = 0; grab(target); }
    } else if (target.kind === 'pearl' && target.open < 0.6) {
      prompt = 'The clam is closed. Back off and wait for it to open…';
      S.hold = 0;
    } else {
      const names = { pearl: 'pearl', relic: target.name, amphora: 'amphora', goblet: 'goblet', ingot: 'gold bar', gem: 'gem' };
      prompt = `${input.usingTouch ? '<b>Grab</b>' : 'Press <b>E</b>'}: take the ${names[target.kind]}`;
      if (tapped) grab(target);
      S.hold = 0;
    }
  } else S.hold = 0;
  // Climb aboard at the surface next to the boat.
  const toBoat = Math.hypot(diver.pos.x - world.boat[0], diver.pos.z - world.boat[2]);
  if (!diver.underwater && toBoat < DIVE.boatRadius) {
    prompt = `${input.usingTouch ? '<b>Grab</b>' : 'Press <b>E</b>'}: climb aboard and bank ${fmt(d.bag)} gold`;
    if (tapped) { board(); return; }
  } else if (!diver.underwater && d.time > 5) {
    hint('surface', 'You\'re at the surface: no air used up here. Swim to the <b>boat ⛵</b> to bank your loot.', 7);
  }
  $('prompt').hidden = !prompt;
  if (prompt) {
    $('prompt-text').innerHTML = prompt;
    $('hold-fill').parentElement.hidden = !(target && target.kind === 'chest' && prompt.includes('chest'));
    $('hold-fill').style.width = `${clamp(S.hold / 1.3, 0, 1) * 100}%`;
  }

  S.strobeCool = Math.max(0, S.strobeCool - dt);
  if (diver.depth > 24 && !S.lamp) hint('lamp', 'It\'s getting dark down here. Press <b>F</b> for your lamp: it brings back the colours.', 7);
  if (d.air / S.airMax < 0.4 && diver.underwater) hint('lowair', 'Air is getting low. Head back up toward the <b>boat ⛵</b> on your compass, or find a <b>bubble vent ◎</b>.', 8);
  if (d.air <= 0) blackout('air');
}

const sharkEvents = {
  onNotice: () => {
    if (S.mode === 'diving') hint('shark', 'A <b>shark</b> is circling you! Press <b>Q</b> (or right-click) to blind it with your strobe, or get out of there.', 8);
  },
  onCharge: () => { if (S.mode === 'diving') popup('Shark <em>charging!</em>', 'bad'); },
  onBite: (shark) => { if (S.mode === 'diving') bite(shark); },
};

// ---------- HUD ----------
function hud() {
  const d = S.dive;
  text($('bag'), fmt(d.bag));
  const mult = d.combo ? Math.min(FUN.comboMax, 1 + Math.floor((d.combo - 1) / FUN.comboStep)) : 0;
  $('combo').hidden = mult < 2;
  if (mult >= 2) text($('combo'), `x${mult}`);
  if (S.missionsAt === undefined || S.time - S.missionsAt > 0.25) {
    S.missionsAt = S.time;
    const shown = $('missions').querySelectorAll('.mp');
    missions.list.forEach((m, i) => { if (shown[i] && !m.done && m.n > 1) text(shown[i], `${m.have}/${m.n}`); });
  }
  text($('banked'), fmt(save.gold));
  const frac = clamp(d.air / S.airMax, 0, 1);
  $('air-arc').style.strokeDashoffset = `${264 * (1 - frac)}`;
  text($('air-pct'), `${Math.ceil(frac * 100)}`);
  const comp = document.querySelector('.computer');
  comp.classList.toggle('warn', frac < AIR.warn && frac >= AIR.critical);
  comp.classList.toggle('crit', frac < AIR.critical);
  text($('depth'), diver.depth.toFixed(1));
  const secs = d.rate > 0 ? d.air / d.rate : Infinity;
  text($('air-time'), Number.isFinite(secs) ? `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}` : 'surface');
  $('battery-fill').style.width = `${(diver.battery / diver.batteryMax) * 100}%`;
  $('strobe-fill').style.width = `${(1 - S.strobeCool / S.strobeMax) * 100}%`;
  $('strobe').classList.toggle('ready', S.strobeCool <= 0);
  $('lamp').classList.toggle('on', S.lamp);
  for (const el of $('relics').children) {
    const id = el.dataset.id;
    el.className = `relic ${save.relics.includes(id) ? 'banked' : d.relics.includes(id) ? 'carried' : ''}`;
  }
  // Compass.
  const heading = ((-diver.yaw * 180 / Math.PI) % 360 + 360) % 360;
  const width = $('compass-strip').clientWidth || 400;
  const ppd = width / 180;
  const place = (el, deg) => {
    const rel = ((deg - heading + 540) % 360) - 180;
    el.style.left = `${width / 2 + rel * ppd}px`;
    el.style.display = Math.abs(rel) > 95 ? 'none' : '';
  };
  for (const m of S.compass.marks) place(m.el, m.deg);
  const bdx = world.boat[0] - diver.pos.x, bdz = world.boat[2] - diver.pos.z;
  place(S.compass.boatMark, (Math.atan2(bdx, -bdz) * 180 / Math.PI + 360) % 360);
  const bearing = (p) => (Math.atan2(p.x - diver.pos.x, -(p.z - diver.pos.z)) * 180 / Math.PI + 360) % 360;
  const within = (p, r) => Math.hypot(p.x - diver.pos.x, p.z - diver.pos.z) < r;
  for (const { it, el } of S.compass.chestMarks) {
    if (it.taken || !within(it.pos, 90)) el.style.display = 'none';
    else place(el, bearing(it.pos));
  }
  for (const { it, el } of S.compass.relicMarks) {
    if (it.taken || save.relics.includes(it.id) || !within(it.pos, 70)) el.style.display = 'none';
    else place(el, bearing(it.pos));
  }
  for (const { f, el } of S.compass.fishMarks) {
    if (f.caught || !within(f.pos, 45)) el.style.display = 'none';
    else place(el, bearing(f.pos));
  }
  const nc = trails.nearest(diver.pos, 160);
  if (nc) place(S.compass.coinMark, bearing(nc.home));
  else S.compass.coinMark.style.display = 'none';
  treasure.vents.forEach((v, i) => {
    const dx = v.x - diver.pos.x, dz = v.z - diver.pos.z;
    const el = S.compass.ventMarks[i];
    if (Math.hypot(dx, dz) > 70) { el.style.display = 'none'; return; }
    place(el, (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360);
  });
  // Warnings.
  const threat = life.threat(diver);
  let warn = '';
  if (frac < AIR.critical) warn = 'Air critical: surface now';
  else if (threat?.charging) warn = 'Shark!';
  else if (Math.hypot(diver.pos.x, diver.pos.z) > DIVE.mapRadius - 10) warn = 'Open ocean: turn back';
  $('warning').hidden = !warn;
  if (warn) text($('warning'), warn);
  if (S.hintUntil && S.time > S.hintUntil) { $('hint').hidden = true; S.hintUntil = 0; }
  // Zone banner.
  const z = zoneAt(diver.pos);
  if (z !== S.zone) {
    S.zone = z;
    if (z) {
      text($('zone'), z);
      $('zone').classList.add('show');
      clearTimeout(S.zoneTimer);
      S.zoneTimer = setTimeout(() => $('zone').classList.remove('show'), 3200);
    }
  }
}

function zoneAt(p) {
  for (const z of world.zones) {
    if (z.trench) {
      const tr = world.trench;
      const zc = tr.center + tr.amp[0] * Math.sin(p.x / tr.amp[1]) + tr.amp[2] * Math.sin(p.x / tr.amp[3] + 1);
      if (Math.abs(p.z - zc) < tr.width + 6 && p.y < -38) return z.name;
    } else if (z.band) {
      if (Math.abs(p.z - z.z) < 12 && p.y < -12 && Math.abs(p.x) < 250) return z.name;
    } else if (Math.hypot(p.x - z.x, p.z - z.z) < z.r) {
      return z.name;
    }
  }
  return null;
}

// ---------- Environment (every frame) ----------
const sunDir = U.uSunDir.value;
function envUpdate(dt) {
  const cam = camera.position;
  const under = cam.y < 0;
  U.uUnderwater.value = under ? 1 : 0;
  U.uCamDepth.value = Math.max(0, -cam.y);
  const fov = under ? 62 : 70;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4 || 1);
    camera.updateProjectionMatrix();
  }
  // Keep the sun's shadow box centred on the camera, snapped to texels to stop shimmer.
  const snap = 64 / sun.shadow.mapSize.x;
  tmpV.set(Math.round(cam.x / snap) * snap, Math.round(cam.y / snap) * snap, Math.round(cam.z / snap) * snap);
  sun.target.position.copy(tmpV);
  sun.position.copy(tmpV).addScaledVector(sunDir, 80);
  vmSun.position.copy(cam).addScaledVector(sunDir, 10);
  vmSun.target.position.copy(cam);
  const range = under ? 125 : 220;
  seabed.cull(cam, range);
  world.built.inst.cull(cam, range);
  godRays.update(cam, U.uCamDepth.value);
  const h = renderer.getDrawingBufferSize(tmpV).y;
  const scale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  snow.material.uniforms.uScale.value = scale;
  trails.glowMat.uniforms.uScale.value = scale;
  bubbles.mat.uniforms.uScale.value = scale;
  const lampOn = S.mode === 'diving' && S.lamp;
  U.uLampOn.value = lampOn ? 1 : 0;
  beam.visible = lampOn && under;
  if (beam.visible) {
    beam.position.copy(U.uLampPos.value);
    beam.quaternion.copy(camera.quaternion);
    beam.material.uniforms.uOn.value = clamp(U.uCamDepth.value / 25, 0.35, 1);
  }
  post.uniforms.uUnder.value = under ? 1 : 0;
  post.uniforms.uVignette.value = under ? 1 : 0.35;
  post.uniforms.uTime.value = S.time;
  post.uniforms.uDamage.value = S.damage;
  post.uniforms.uDark.value = S.dark;
  U.uFlash.value = Math.max(0, U.uFlash.value - (dt || 0) * 4);
  const fl = $('flash');
  if (fl.style.opacity !== '0') fl.style.opacity = String(Math.max(0, Number(fl.style.opacity) - (dt || 0) * 3));
  if (bloom) bloom.strength = under ? 0.45 : 0.25;
}

// ---------- Loop ----------
let last = performance.now();
let ventTimer = 0;
// Longest step per frame. Tests on slow software renderers can raise it with ?debug&dtcap=0.3.
const DT_CAP = params.has('debug') ? Number(params.get('dtcap') || 0.05) : 0.05;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(DT_CAP, (now - last) / 1000);
  last = now;
  input.pollPad();
  if (S.mode !== 'paused') S.time += dt;
  U.uTime.value = S.time;
  const t = S.time;

  if (S.mode === 'diving') {
    diveUpdate(dt);
    if (S.mode === 'diving') hud();
    S.damage = Math.max(0, S.damage - dt * 1.2);
    S.dark = Math.max(0, S.dark - dt * 0.8);
  } else if (S.mode === 'menu') {
    placeTitleCamera(t);
    input.consumeLook(dt);
  } else if (S.mode === 'boat' || S.mode === 'win') {
    placeBoatCamera(t);
    input.consumeLook(dt);
  } else if (S.mode === 'blackout') {
    S.dark = Math.min(0.85, S.dark + dt * 1.5);
  }

  if (S.mode !== 'paused') {
    const watcher = S.mode === 'diving' ? diver : { pos: camera.position, vel: new THREE.Vector3(), underwater: false, safe: true };
    life.update(dt, t, watcher, sharkEvents);
    if (S.mode !== 'diving') {
      const far = new THREE.Vector3(1e5, 0, 0);
      treasure.update(dt, t, { pos: far }, 0);
      trails.update(dt, t, far, 0, []);
      golden.update(dt, t, { pos: far }, []);
      rings.update(dt, far);
    }
    // Vents bubble continuously near the camera.
    ventTimer += dt;
    if (ventTimer > 0.05) {
      ventTimer = 0;
      for (const v of treasure.vents) {
        if (v.distanceToSquared(camera.position) < 80 * 80) bubbles.emit(tmpV.copy(v).add(new THREE.Vector3(0, 0.2, 0)), 2, 0.5, [0.015, 0.07], 0.6);
      }
    }
    // Without audio there's no breath clock, so keep the bubbles coming anyway.
    if (!sound.ctx && S.mode === 'diving') {
      S.breathT -= dt;
      if (S.breathT <= 0) { S.breathT = 4.2; exhale(); }
    }
    bubbles.update(dt, t);
  }

  const threat = S.mode === 'diving' ? life.threat(diver) : null;
  sound.update(dt, {
    underwater: camera.position.y < 0, diving: S.mode === 'diving', paused: S.mode === 'paused',
    depth: diver.depth, throttle: S.mode === 'diving' ? clamp(diver.vel.length() / 3, 0, 1) : 0, boosting: diver.boosting,
    inVent: S.inVent && S.mode === 'diving', threat: threat ? clamp(1 - threat.dist / 30, 0, 1) : 0, charging: !!threat?.charging,
    stress: (threat ? 0.6 : 0) + (S.dive && S.dive.air / S.airMax < 0.25 ? 0.5 : 0) + (diver.boosting ? 0.3 : 0),
    airFrac: S.dive && S.mode === 'diving' ? S.dive.air / S.airMax : 1, warn: AIR.warn, critical: AIR.critical,
  });

  envUpdate(dt);
  composer.render(dt);
}

// Expose a few handles for automated testing (?debug in the URL).
if (params.has('debug')) {
  window.SG = { get S() { return S; }, get diver() { return diver; }, get life() { return life; }, get treasure() { return treasure; },
    save, startDive: () => startDive(), board: () => board(), camera, renderer, U, scene, get sun() { return sun; },
    get trails() { return trails; }, get rings() { return rings; }, get golden() { return golden; }, missions };
}
