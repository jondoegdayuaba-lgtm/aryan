// Blockwild: game loop, rendering, input, inventory, HUD and menus.
import * as THREE from 'three';
import {
  B, ITEM, BLOCKS, ITEMS, PLACEABLE, TILES, isBlock, itemName, isFlatItem, itemTile,
  buildAtlas, buildIcons, buildCrackTextures, buildHudIcons,
} from './blocks.js';
import { World, CH } from './world.js';
import { Player } from './player.js';
import { initAudio, sfx, setVolume } from './audio.js';
import { seedFrom } from './noise.js';

THREE.ColorManagement.enabled = false;

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'blockwild-save-v1';
const SETTINGS_KEY = 'blockwild-settings-v1';
const DAY_LENGTH = 1200; // seconds for a full day/night cycle
const STACK = 64;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const settings = { rd: 6, fov: 70, sens: 100, vol: 60, bob: true, clouds: true, ...(store.get(SETTINGS_KEY) || {}) };
const isTouch = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

// ------------------------------------------------------------ renderer

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd6ff, 50, 96);
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1500);
camera.rotation.order = 'YXZ';

const atlas = buildAtlas();
const materials = {
  solid: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 }),
  plants: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  water: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
};
const icons = buildIcons(atlas);
const cracks = buildCrackTextures();
const hudIcons = buildHudIcons();
const tileURL = (t) => atlas.tileCanvas(t).toDataURL();
document.documentElement.style.setProperty('--dirt-bg', `url(${tileURL(TILES.DIRT)})`);
document.documentElement.style.setProperty('--stone-bg', `url(${tileURL(TILES.STONE)})`);

// ------------------------------------------------------------ sky

const skyUniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 24, 12),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(horizon, top, smoothstep(-0.02, 0.4, h)), 1.0); }',
  }),
);
sky.renderOrder = -10;
scene.add(sky);

function pixelTexture(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const col = fn(x, y);
    if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
const sunTex = pixelTexture(8, (x, y) => (x === 0 || y === 0 || x === 7 || y === 7 ? '#ffd76a' : '#fffbe0'));
const moonTex = pixelTexture(8, (x, y) => ((x * 7 + y * 3) % 5 === 0 && x > 0 && y > 0 && x < 7 && y < 7 ? '#a9b0bd' : '#e3e8f0'));
const skyBody = (tex, size) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
  m.renderOrder = -9;
  scene.add(m);
  return m;
};
const sun = skyBody(sunTex, 80);
const moon = skyBody(moonTex, 60);

// Clouds: one big plane whose texture scrolls; faded out with distance.
const cloudCanvas = document.createElement('canvas');
cloudCanvas.width = cloudCanvas.height = 64;
{
  const ctx = cloudCanvas.getContext('2d');
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let grid = Array.from({ length: 64 * 64 }, () => rnd() < 0.42);
  for (let pass = 0; pass < 4; pass++) {
    grid = grid.map((_, i) => {
      const x = i % 64, y = Math.floor(i / 64);
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += grid[((y + dy + 64) % 64) * 64 + ((x + dx + 64) % 64)];
      return n >= 5;
    });
  }
  ctx.fillStyle = '#fff';
  grid.forEach((on, i) => on && ctx.fillRect(i % 64, Math.floor(i / 64), 1, 1));
}
const cloudTex = new THREE.CanvasTexture(cloudCanvas);
cloudTex.magFilter = cloudTex.minFilter = THREE.NearestFilter;
cloudTex.generateMipmaps = false;
cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
const CLOUD_PX = 12, CLOUD_SIZE = 1600;
const cloudUniforms = {
  map: { value: cloudTex }, offset: { value: new THREE.Vector2() }, rep: { value: CLOUD_SIZE / (64 * CLOUD_PX) },
  color: { value: new THREE.Color(1, 1, 1) }, cam: { value: new THREE.Vector3() },
};
const clouds = new THREE.Mesh(
  new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE),
  new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: 'uniform vec2 offset; uniform float rep; varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv * rep + offset; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 color; uniform vec3 cam; varying vec2 vUv; varying vec3 vW; void main(){ if (texture2D(map, vUv).a < 0.5) discard; float d = length(vW.xz - cam.xz); gl_FragColor = vec4(color, 0.82 * (1.0 - smoothstep(220.0, 700.0, d))); }',
  }),
);
clouds.rotation.x = -Math.PI / 2;
clouds.renderOrder = 3;
scene.add(clouds);

// ------------------------------------------------------------ selection + cracks

const selection = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }),
);
selection.visible = false;
scene.add(selection);
const crackMat = new THREE.MeshBasicMaterial({ map: cracks[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), crackMat);
crack.visible = false;
scene.add(crack);

// ------------------------------------------------------------ item meshes

const FACE_SLOT = [1, 1, 0, 2, 1, 1];
const FACE_SHADE = [0.8, 0.8, 1, 0.5, 0.65, 0.65];
const geoCache = new Map();
function itemGeometry(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  let g;
  if (isFlatItem(id)) {
    g = new THREE.PlaneGeometry(1, 1);
    const [u0, v0, u1, v1] = atlas.uv(itemTile(id));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(uv.count * 3).fill(1), 3));
  } else {
    g = new THREE.BoxGeometry(1, 1, 1);
    const uv = g.attributes.uv;
    const col = [];
    for (let i = 0; i < uv.count; i++) {
      const f = Math.floor(i / 4);
      const [u0, v0, u1, v1] = atlas.uv(BLOCKS[id].tex[FACE_SLOT[f]]);
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      col.push(FACE_SHADE[f], FACE_SHADE[f], FACE_SHADE[f]);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  geoCache.set(id, g);
  return g;
}
const itemMesh = (id) => new THREE.Mesh(itemGeometry(id), isFlatItem(id) ? materials.plants : materials.solid);

// ------------------------------------------------------------ first-person hand

const handScene = new THREE.Scene();
const handCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
const handRoot = new THREE.Group();
handScene.add(handRoot);
function shadedBox(w, h, d, hex) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const c = new THREE.Color(hex);
  const col = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    const s = FACE_SHADE[Math.floor(i / 6)];
    col.push(c.r * s, c.g * s, c.b * s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const handMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const arm = new THREE.Group();
{
  const skin = new THREE.Mesh(shadedBox(0.13, 0.13, 0.36, 0xd9a07a), handMat);
  skin.position.z = -0.18;
  const sleeve = new THREE.Mesh(shadedBox(0.14, 0.14, 0.2, 0xc9822e), handMat);
  sleeve.position.z = 0.08;
  arm.add(skin, sleeve);
}
let handItem = null, handItemId = -1;
let swingT = 1, equipT = 1, bobPhase = 0;
function setHand(id) {
  if (id === handItemId) return;
  handItemId = id;
  handRoot.clear();
  equipT = 0;
  if (!id) {
    arm.position.set(0.4, -0.4, -0.62);
    arm.rotation.set(0.35, 0.28, 0.05);
    handRoot.add(arm);
    handItem = null;
  } else {
    handItem = itemMesh(id);
    if (isFlatItem(id)) {
      handItem.scale.setScalar(0.36);
      handItem.position.set(0.46, -0.32, -0.75);
      handItem.rotation.set(0, -0.5, 0.1);
    } else {
      handItem.scale.setScalar(0.26);
      handItem.position.set(0.48, -0.4, -0.8);
      handItem.rotation.set(0.12, Math.PI / 4 + 0.2, 0);
    }
    handRoot.add(handItem);
  }
}

// ------------------------------------------------------------ game state

let world = null;
let state = 'title';
let mode = 'survival';
let worldSeed = 0;
const player = new Player();
let spawn = { x: 0.5, y: 40, z: 0.5 };
let health = 20, hunger = 20, regenTimer = 0, timeOfDay = 0.03;
let inv = new Array(36).fill(null);
let selected = 0;
let held = null; // stack picked up in the inventory screen
let target = null;
let breaking = null, breakCooldown = 0, useCooldown = 0, hitSoundT = 0;
let items = [], particles = [];
let invVersion = 0, debugOn = false, autosaveT = 0, wasInWater = false;
const keys = new Set();
let mouseL = false, mouseR = false, locked = false, lastTouch = 0;
let lastSpace = 0, lastW = 0, sprintLatch = false;
const touch = { x: 0, y: 0, jump: false, sneak: false, breakHeld: false };

const START_CREATIVE = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.GLASS, B.BRICK, B.BLOSSOM];

// ------------------------------------------------------------ inventory

function addItem(id, count) {
  for (let pass = 0; pass < 2 && count > 0; pass++) {
    for (let i = 0; i < 36 && count > 0; i++) {
      const s = inv[i];
      if (pass === 0 && s && s.id === id && s.count < STACK) {
        const n = Math.min(count, STACK - s.count);
        s.count += n; count -= n;
      } else if (pass === 1 && !s) {
        const n = Math.min(count, STACK);
        inv[i] = { id, count: n }; count -= n;
      }
    }
  }
  invVersion++;
  return count;
}
const countOf = (id) => inv.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
function take(id, n) {
  for (let i = 35; i >= 0 && n > 0; i--) {
    const s = inv[i];
    if (s && s.id === id) {
      const k = Math.min(n, s.count);
      s.count -= k; n -= k;
      if (!s.count) inv[i] = null;
    }
  }
  invVersion++;
}
function useSelected() {
  if (mode === 'creative') return;
  const s = inv[selected];
  if (!s) return;
  if (--s.count <= 0) inv[selected] = null;
  invVersion++;
}

const RECIPES = [
  { out: B.PLANKS, n: 4, need: [[B.LOG, 1]] },
  { out: B.PLANKS, n: 4, need: [[B.CHERRY_LOG, 1]] },
  { out: B.GLASS, n: 1, need: [[B.SAND, 2]] },
  { out: B.STONE, n: 1, need: [[B.COBBLE, 2]] },
  { out: B.BRICK, n: 2, need: [[B.GRAVEL, 1], [B.SAND, 1]] },
];

// ------------------------------------------------------------ HUD

const hotbarEl = $('hotbar');
const hotSlots = [];
for (let i = 0; i < 9; i++) {
  const s = document.createElement('div');
  s.className = 'slot';
  s.innerHTML = '<img alt=""><span class="count"></span>';
  s.addEventListener('pointerdown', (e) => { if (state === 'playing') { e.stopPropagation(); select(i); } });
  hotbarEl.append(s);
  hotSlots.push(s);
}
function fillSlot(el, stack) {
  const img = el.querySelector('img'), cnt = el.querySelector('.count');
  if (stack) {
    img.src = icons[stack.id];
    img.hidden = false;
    cnt.textContent = stack.count > 1 && mode !== 'creative' ? stack.count : '';
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    cnt.textContent = '';
  }
}
let shownInv = -1, shownSel = -1;
function renderHotbar() {
  if (shownInv === invVersion && shownSel === selected) return;
  shownInv = invVersion; shownSel = selected;
  hotSlots.forEach((el, i) => { fillSlot(el, inv[i]); el.classList.toggle('sel', i === selected); });
}

const heartEls = [], foodEls = [];
for (let i = 0; i < 10; i++) {
  const h = document.createElement('div'); h.className = 'ico'; $('hearts').append(h); heartEls.push(h);
  const f = document.createElement('div'); f.className = 'ico'; $('hunger').append(f); foodEls.push(f);
}
let shownBars = '';
function renderBars() {
  const hv = Math.ceil(health), fv = Math.ceil(hunger);
  const key = `${hv},${fv},${mode}`;
  if (key === shownBars) return;
  shownBars = key;
  $('bars').style.visibility = mode === 'creative' ? 'hidden' : 'visible';
  $('bars').classList.toggle('low', hv <= 4);
  for (let i = 0; i < 10; i++) {
    const a = hv - i * 2, b = fv - i * 2;
    heartEls[i].style.backgroundImage = `url(${a >= 2 ? hudIcons.heartFull : a === 1 ? hudIcons.heartHalf : hudIcons.heartEmpty})`;
    foodEls[i].style.backgroundImage = `url(${b >= 2 ? hudIcons.foodFull : b === 1 ? hudIcons.foodHalf : hudIcons.foodEmpty})`;
  }
}

let nameTimer = 0;
function select(i) {
  selected = (i + 9) % 9;
  const s = inv[selected];
  const el = $('item-name');
  el.textContent = s ? itemName(s.id) : '';
  el.classList.remove('fade');
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => el.classList.add('fade'), 1500);
}

function flashHurt() {
  const el = $('hurt-flash');
  el.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
}

function hurt(n, why) {
  if (mode === 'creative' || state !== 'playing') return;
  health = Math.max(0, health - n);
  flashHurt();
  sfx('hurt');
  if (health <= 0) die(why);
}

// ------------------------------------------------------------ screens

const SCREENS = ['title', 'play-menu', 'controls-menu', 'settings-menu', 'pause-menu', 'death-menu', 'inventory', 'loading'];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  $('hud').hidden = !(state === 'playing' || state === 'paused' || state === 'inventory' || state === 'dead');
  canvas.classList.toggle('blur', state === 'title');
  $('touch').hidden = !isTouch || state !== 'playing';
  updateClickHint();
}
function updateClickHint() {
  $('click-hint').hidden = isTouch || state !== 'playing' || locked;
}
let backTo = 'title';

const SPLASHES = [
  'Now with cherry blossoms!', 'Hand-painted pixels!', 'Never dig straight down!', 'Made of blocks!',
  'Seeds included!', 'Try creative mode!', 'Apples grow on trees!', 'Zero image files!', 'Watch your step!',
];
$('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];

function goTitle() {
  state = 'title';
  if (!world || !world.isTitle) {
    world?.dispose();
    clearEntities();
    world = new World(seedFrom('blockwild'), atlas, materials, scene);
    world.isTitle = true;
    const s = world.findSpawn();
    titleCam.set(s.x, world.heightAt(Math.floor(s.x), Math.floor(s.z)) + 14, s.z);
  }
  timeOfDay = 0.12;
  selection.visible = crack.visible = false;
  show('title');
}
const titleCam = new THREE.Vector3();
let titleYaw = 0;

function refreshPlayMenu() {
  const save = store.get(SAVE_KEY);
  const btn = $('btn-continue');
  btn.hidden = !save;
  if (save) btn.textContent = `Continue World (${save.mode === 'creative' ? 'Creative' : 'Survival'})`;
  $('btn-mode').textContent = `Game Mode: ${mode === 'creative' ? 'Creative' : 'Survival'}`;
  $('mode-help').textContent = mode === 'creative'
    ? 'Unlimited blocks, instant breaking and flying.'
    : 'Gather blocks, craft, and keep your health and hunger up.';
}

function clearEntities() {
  for (const it of items) scene.remove(it.mesh);
  for (const p of particles) { scene.remove(p.mesh); p.mesh.material.dispose(); }
  items = []; particles = [];
}

function startWorld(save, seedText) {
  world?.dispose();
  clearEntities();
  if (save) {
    worldSeed = save.seed;
    mode = save.mode;
  } else {
    worldSeed = seedText ? seedFrom(seedText) : (Math.random() * 2 ** 31) | 0;
  }
  world = new World(worldSeed, atlas, materials, scene);
  player.vel.set(0, 0, 0);
  player.fallTop = null;
  if (save) {
    world.loadEdits(save.edits);
    spawn = save.spawn;
    player.pos.set(...save.pos);
    player.yaw = save.yaw; player.pitch = save.pitch;
    player.flying = !!save.flying && mode === 'creative';
    health = save.health; hunger = save.hunger;
    inv = save.inv; selected = save.selected || 0;
    timeOfDay = save.time ?? 0.03;
  } else {
    spawn = world.findSpawn();
    player.pos.set(spawn.x, spawn.y, spawn.z);
    player.yaw = Math.random() * Math.PI * 2; player.pitch = -0.1;
    player.flying = false;
    health = 20; hunger = 20;
    inv = new Array(36).fill(null);
    if (mode === 'creative') START_CREATIVE.forEach((id, i) => { inv[i] = { id, count: STACK }; });
    selected = 0;
    timeOfDay = 0.03;
  }
  invVersion++;
  state = 'loading';
  $('loading-bar').style.width = '0%';
  show('loading');
}

function beginPlay() {
  // Nudge the player up if they would spawn inside a block.
  for (let i = 0; i < CH && (BLOCKS[world.get(Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z))].solid
    || BLOCKS[world.get(Math.floor(player.pos.x), Math.floor(player.pos.y + 1), Math.floor(player.pos.z))].solid); i++) player.pos.y += 1;
  state = 'playing';
  shownBars = '';
  shownInv = -1;
  show(null);
  select(selected);
  requestLock();
  saveGame();
}

function saveGame() {
  if (!world || world.isTitle) return;
  store.set(SAVE_KEY, {
    seed: worldSeed, mode, spawn, pos: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch,
    flying: player.flying, health, hunger, inv, selected, time: timeOfDay, edits: world.serializeEdits(),
  });
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  keys.clear(); mouseL = mouseR = false;
  show('pause-menu');
  saveGame();
}
function resume() {
  state = 'playing';
  show(null);
  requestLock();
}
function die(why) {
  state = 'dead';
  keys.clear(); mouseL = mouseR = false;
  $('death-why').textContent = why ? `You ${why}.` : '';
  if (document.pointerLockElement) document.exitPointerLock();
  show('death-menu');
}
function respawn() {
  health = 20; hunger = 20;
  player.pos.set(spawn.x, spawn.y, spawn.z);
  player.vel.set(0, 0, 0);
  player.fallTop = null;
  beginPlay();
}

// ------------------------------------------------------------ inventory screen

const cursorEl = $('cursor-item');
function makeSlot(stack, onPick) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML = '<img alt=""><span class="count"></span>';
  fillSlot(el, stack);
  if (stack) el.title = itemName(stack.id);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); onPick(e.button === 2); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}
function clickSlot(i, right) {
  const s = inv[i];
  if (!held) {
    if (!s) return;
    if (right && s.count > 1) {
      const half = Math.ceil(s.count / 2);
      held = { id: s.id, count: half };
      s.count -= half;
    } else { held = s; inv[i] = null; }
  } else if (!s) {
    if (right) { inv[i] = { id: held.id, count: 1 }; if (!--held.count) held = null; }
    else { inv[i] = held; held = null; }
  } else if (s.id === held.id) {
    const n = Math.min(right ? 1 : held.count, STACK - s.count);
    s.count += n; held.count -= n;
    if (!held.count) held = null;
  } else {
    inv[i] = held; held = s;
  }
  invVersion++;
  sfx('click');
  renderInventory();
}
function renderInventory() {
  const bp = $('backpack'), hr = $('inv-hotbar');
  bp.replaceChildren(...Array.from({ length: 27 }, (_, k) => makeSlot(inv[9 + k], (r) => clickSlot(9 + k, r))));
  hr.replaceChildren(...Array.from({ length: 9 }, (_, k) => makeSlot(inv[k], (r) => clickSlot(k, r))));
  $('inv-creative').hidden = mode !== 'creative';
  $('inv-crafting').hidden = mode === 'creative';
  if (mode === 'creative') {
    $('palette').replaceChildren(...[...PLACEABLE, ITEM.APPLE].map((id) => makeSlot({ id, count: 1 }, () => {
      held = held && held.id !== id ? null : { id, count: STACK };
      sfx('click');
      renderInventory();
    })));
  } else {
    $('recipes').replaceChildren(...RECIPES.map((r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recipe';
      b.disabled = !r.need.every(([id, n]) => countOf(id) >= n);
      b.innerHTML = r.need.map(([id, n]) => `${n}<img src="${icons[id]}" alt="${itemName(id)}">`).join('+') + ` &rarr; ${r.n}<img src="${icons[r.out]}" alt="${itemName(r.out)}">`;
      b.title = `Make ${r.n} ${itemName(r.out)}`;
      b.addEventListener('click', () => {
        if (!r.need.every(([id, n]) => countOf(id) >= n)) return;
        r.need.forEach(([id, n]) => take(id, n));
        const left = addItem(r.out, r.n);
        if (left) dropStack(r.out, left);
        sfx('place', 'wood');
        renderInventory();
      });
      return b;
    }));
  }
  cursorEl.hidden = !held;
  if (held) {
    cursorEl.querySelector('img').src = icons[held.id];
    cursorEl.querySelector('span').textContent = held.count > 1 ? held.count : '';
  }
}
function openInventory() {
  if (state !== 'playing') return;
  state = 'inventory';
  keys.clear(); mouseL = mouseR = false;
  if (document.pointerLockElement) document.exitPointerLock();
  renderInventory();
  show('inventory');
}
function closeInventory() {
  if (held) {
    const left = addItem(held.id, held.count);
    if (left) dropStack(held.id, left);
    held = null;
  }
  cursorEl.hidden = true;
  state = 'playing';
  show(null);
  requestLock();
}
window.addEventListener('pointermove', (e) => {
  if (!cursorEl.hidden) { cursorEl.style.left = `${e.clientX}px`; cursorEl.style.top = `${e.clientY}px`; }
});

// ------------------------------------------------------------ world actions

const particleGeo = new THREE.BoxGeometry(1, 1, 1);
function burst(id, x, y, z) {
  const c = atlas.avg[BLOCKS[id].tex[1]];
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]) });
  mat.userData.n = 0;
  const bright = materials.solid.color.r;
  mat.color.multiplyScalar(bright);
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(particleGeo, mat);
    m.scale.setScalar(0.06 + Math.random() * 0.07);
    m.position.set(x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7);
    scene.add(m);
    mat.userData.n++;
    particles.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3), life: 0.5 + Math.random() * 0.6 });
  }
}

function spawnItem(id, count, x, y, z, vel, delay = 0.5) {
  const mesh = itemMesh(id);
  mesh.scale.setScalar(isFlatItem(id) ? 0.35 : 0.25);
  scene.add(mesh);
  items.push({
    id, count, mesh, pos: new THREE.Vector3(x, y, z),
    vel: vel || new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2),
    age: 0, delay, spin: Math.random() * 6,
  });
  if (items.length > 300) { const old = items.shift(); scene.remove(old.mesh); }
}
function dropStack(id, count) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  spawnItem(id, count, player.pos.x + dir.x * 0.4, player.eyeY() - 0.3, player.pos.z + dir.z * 0.4, dir.multiplyScalar(5).add(new THREE.Vector3(0, 1.5, 0)), 1.5);
}

const swing = () => { if (swingT >= 0.5) swingT = 0; };
const isWaterAround = (x, y, z) => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([a, b, c]) => world.get(x + a, y + b, z + c) === B.WATER);

function breakBlock(t) {
  const { x, y, z } = t;
  const id = world.get(x, y, z);
  if (!id || BLOCKS[id].hardness === Infinity && mode !== 'creative') return;
  if (id === B.BEDROCK && mode !== 'creative') return;
  const above = world.get(x, y + 1, z);
  if (BLOCKS[above].cross) {
    world.set(x, y + 1, z, B.AIR);
    if (mode === 'survival' && BLOCKS[above].drop) spawnItem(BLOCKS[above].drop, 1, x + 0.5, y + 1.5, z + 0.5);
  }
  world.set(x, y, z, isWaterAround(x, y, z) ? B.WATER : B.AIR);
  burst(id, x, y, z);
  sfx('break', BLOCKS[id].sound);
  swing();
  if (mode === 'survival') {
    const drop = BLOCKS[id].drop;
    if (drop) spawnItem(drop, 1, x + 0.5, y + 0.5, z + 0.5);
    if (id === B.LEAVES && Math.random() < 0.1) spawnItem(ITEM.APPLE, 1, x + 0.5, y + 0.5, z + 0.5);
  }
}

function useAction() {
  const s = inv[selected];
  if (s && ITEMS[s.id]?.food) {
    if (mode === 'survival' && hunger < 20) {
      hunger = Math.min(20, hunger + ITEMS[s.id].food);
      useSelected();
      sfx('eat');
      swing();
    }
    return;
  }
  if (!target || !s || !isBlock(s.id)) return;
  const d = BLOCKS[s.id];
  let px = target.x, py = target.y, pz = target.z;
  if (!BLOCKS[target.id].cross) { px += target.normal[0]; py += target.normal[1]; pz += target.normal[2]; }
  if (py < 0 || py >= CH) return;
  const cur = world.get(px, py, pz);
  if (!(cur === B.AIR || cur === B.WATER || BLOCKS[cur].cross)) return;
  if (d.cross) {
    const below = world.get(px, py - 1, pz);
    if (cur === B.WATER || !(below === B.GRASS || below === B.DIRT)) return;
  }
  if (d.solid && player.intersectsBlock(px, py, pz)) return;
  world.set(px, py, pz, s.id);
  sfx('place', d.sound);
  swing();
  useSelected();
}

function pickBlock() {
  if (!target) return;
  const id = target.id === B.GRASS && mode === 'survival' ? B.DIRT : target.id;
  const at = inv.slice(0, 9).findIndex((s) => s && s.id === id);
  if (at >= 0) { select(at); return; }
  if (mode === 'creative' && PLACEABLE.includes(id)) {
    inv[selected] = { id, count: STACK };
    invVersion++;
    select(selected);
  }
}

// ------------------------------------------------------------ input

function requestLock() {
  if (isTouch || state !== 'playing') return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch { /* needs a click */ }
}
document.addEventListener('pointerlockchange', () => {
  const was = locked;
  locked = document.pointerLockElement === canvas;
  if (was && !locked && state === 'playing') pause();
  updateClickHint();
});

window.addEventListener('keydown', (e) => {
  initAudio();
  if (e.target instanceof HTMLInputElement) return;
  const c = e.code;
  if (state === 'playing') {
    if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'ControlLeft'].includes(c)) e.preventDefault();
    if (e.repeat) { keys.add(c); return; }
    keys.add(c);
    if (/^Digit[1-9]$/.test(c)) select(Number(c.slice(5)) - 1);
    else if (c === 'KeyE') openInventory();
    else if (c === 'KeyQ') {
      const s = inv[selected];
      if (s) { dropStack(s.id, 1); useSelected(); }
    } else if (c === 'F3') { debugOn = !debugOn; $('debug').hidden = !debugOn; }
    else if (c === 'Escape' || c === 'KeyP') pause();
    else if (c === 'Space') {
      const now = performance.now();
      if (mode === 'creative' && now - lastSpace < 300) { player.flying = !player.flying; player.vel.y = 0; }
      lastSpace = now;
    } else if (c === 'KeyW') {
      const now = performance.now();
      if (now - lastW < 280) sprintLatch = true;
      lastW = now;
    }
  } else if (state === 'inventory') {
    if (c === 'KeyE' || c === 'Escape') { e.preventDefault(); closeInventory(); }
  } else if (state === 'paused') {
    if (c === 'Escape') resume();
  } else if (c === 'Escape') {
    const back = document.querySelector('.screen:not([hidden]) [data-back]');
    if (back) back.click();
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyW' || e.code === 'ArrowUp') sprintLatch = false;
});
window.addEventListener('blur', () => { keys.clear(); mouseL = mouseR = false; });

canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (performance.now() - lastTouch < 800 || state !== 'playing') return;
  if (!locked) { requestLock(); return; }
  if (e.button === 0) { mouseL = true; if (mode === 'creative' && target) { breakBlock(target); breakCooldown = 0.25; } }
  else if (e.button === 1) { e.preventDefault(); pickBlock(); }
  else if (e.button === 2) { mouseR = true; useAction(); useCooldown = 0.25; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseL = false;
  if (e.button === 2) mouseR = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (!locked || state !== 'playing') return;
  const mx = e.movementX, my = e.movementY;
  if (Math.abs(mx) > 300 || Math.abs(my) > 300) return; // browser pointer-lock spikes
  const k = 0.0022 * (settings.sens / 100);
  player.yaw -= mx * k;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - my * k));
});
window.addEventListener('wheel', (e) => {
  if (state !== 'playing') return;
  select(selected + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });

// Touch: drag to look, tap to place, press and hold to break.
const looks = new Map();
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  lastTouch = performance.now();
  initAudio();
  if (state !== 'playing') return;
  e.preventDefault();
  looks.set(e.pointerId, { x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0, breaking: false });
});
canvas.addEventListener('pointermove', (e) => {
  const l = looks.get(e.pointerId);
  if (!l) return;
  const dx = e.clientX - l.x, dy = e.clientY - l.y;
  l.x = e.clientX; l.y = e.clientY;
  l.moved += Math.abs(dx) + Math.abs(dy);
  const k = 0.006 * (settings.sens / 100);
  player.yaw -= dx * k;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - dy * k));
});
const endLook = (e) => {
  const l = looks.get(e.pointerId);
  if (!l) return;
  looks.delete(e.pointerId);
  if (!l.breaking && l.moved < 14 && performance.now() - l.t0 < 300 && state === 'playing') useAction();
};
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);

{
  const joy = $('joy'), knob = $('joy-knob');
  let id = null;
  const setJoy = (e) => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = r.width * 0.36;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.x = dx / max; touch.y = -dy / max;
  };
  joy.addEventListener('pointerdown', (e) => { e.preventDefault(); lastTouch = performance.now(); id = e.pointerId; joy.setPointerCapture(id); setJoy(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) setJoy(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; touch.x = touch.y = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
  const hold = (el, key) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); lastTouch = performance.now(); touch[key] = true;
      if (key === 'jump') {
        const now = performance.now();
        if (mode === 'creative' && now - lastSpace < 300) { player.flying = !player.flying; player.vel.y = 0; }
        lastSpace = now;
      }
    });
    const up = () => { touch[key] = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  };
  hold($('t-jump'), 'jump');
  hold($('t-sneak'), 'sneak');
  $('t-inv').addEventListener('click', openInventory);
  $('t-pause').addEventListener('click', pause);
}

// ------------------------------------------------------------ menus

const click = (id, fn) => $(id).addEventListener('click', () => { initAudio(); sfx('click'); fn(); });
click('btn-play', () => { refreshPlayMenu(); show('play-menu'); });
click('btn-controls', () => { backTo = 'title'; show('controls-menu'); });
click('btn-settings', () => { backTo = 'title'; $('settings-menu').classList.remove('over-game'); show('settings-menu'); });
click('btn-mode', () => { mode = mode === 'survival' ? 'creative' : 'survival'; refreshPlayMenu(); });
click('btn-create', () => startWorld(null, $('seed').value));
click('btn-continue', () => { const s = store.get(SAVE_KEY); if (s) startWorld(s); });
click('btn-resume', resume);
click('btn-pause-settings', () => { backTo = 'pause-menu'; $('settings-menu').classList.add('over-game'); show('settings-menu'); });
click('btn-quit', () => { saveGame(); goTitle(); });
click('btn-respawn', respawn);
click('btn-death-quit', () => { saveGame(); goTitle(); });
click('btn-inv-close', closeInventory);
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
  sfx('click');
  if (backTo === 'pause-menu' && state === 'paused') show('pause-menu');
  else show('title');
  backTo = 'title';
}));
$('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create').click(); });

function bindSettings() {
  const bind = (id, key, fmt) => {
    const input = $(`s-${id}`), label = $(`v-${id}`);
    input.value = settings[key];
    label.textContent = fmt(settings[key]);
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      label.textContent = fmt(settings[key]);
      applySettings();
    });
  };
  bind('rd', 'rd', (v) => `${v} chunks`);
  bind('fov', 'fov', (v) => `${v}`);
  bind('sens', 'sens', (v) => `${v}%`);
  bind('vol', 'vol', (v) => (v ? `${v}%` : 'Off'));
  const toggle = (id, key, label) => {
    const b = $(id);
    const paint = () => { b.textContent = `${label}: ${settings[key] ? 'On' : 'Off'}`; };
    paint();
    b.addEventListener('click', () => { settings[key] = !settings[key]; paint(); applySettings(); sfx('click'); });
  };
  toggle('s-bob', 'bob', 'View bobbing');
  toggle('s-clouds', 'clouds', 'Clouds');
}
function applySettings() {
  setVolume(settings.vol / 100);
  clouds.visible = settings.clouds;
  store.set(SETTINGS_KEY, settings);
}
bindSettings();
applySettings();

// ------------------------------------------------------------ per-frame updates

const NIGHT_TOP = new THREE.Color(0.01, 0.012, 0.04), DAY_TOP = new THREE.Color(0.44, 0.63, 1.0);
const NIGHT_HOR = new THREE.Color(0.03, 0.04, 0.09), DAY_HOR = new THREE.Color(0.74, 0.84, 1.0);
const SUNSET = new THREE.Color(1.0, 0.58, 0.32);
const WATER_FOG = new THREE.Color(0.08, 0.18, 0.45);
const tmpC = new THREE.Color();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function updateSky(underwater) {
  const ang = timeOfDay * Math.PI * 2;
  const sunH = Math.sin(ang);
  const day = smooth(-0.18, 0.25, sunH);
  const bright = 0.18 + 0.82 * day;
  for (const m of Object.values(materials)) m.color.setScalar(bright);
  handMat.color.setScalar(Math.max(0.35, bright));
  skyUniforms.top.value.copy(NIGHT_TOP).lerp(DAY_TOP, day);
  const hor = skyUniforms.horizon.value.copy(NIGHT_HOR).lerp(DAY_HOR, day);
  const dusk = Math.max(0, 1 - Math.abs(sunH) / 0.3) * (Math.cos(ang) > -2 ? 1 : 0);
  hor.lerp(SUNSET, dusk * 0.55);
  cloudUniforms.color.value.setScalar(0.25 + 0.75 * day).lerp(SUNSET, dusk * 0.25);

  const far = settings.rd * 16;
  if (underwater) {
    scene.fog.color.copy(WATER_FOG).multiplyScalar(0.4 + 0.6 * day);
    scene.fog.near = 0.5; scene.fog.far = 18;
  } else {
    scene.fog.color.copy(hor);
    scene.fog.near = far * 0.55; scene.fog.far = far;
  }
  renderer.setClearColor(scene.fog.color);

  const cp = camera.position;
  sky.position.copy(cp);
  const dir = tmpV.set(Math.cos(ang), sunH, 0.18).normalize();
  sun.position.copy(cp).addScaledVector(dir, 600);
  moon.position.copy(cp).addScaledVector(dir, -600);
  sun.lookAt(cp); moon.lookAt(cp);

  clouds.position.set(cp.x, 128, cp.z);
  const drift = performance.now() / 1000 * 0.8;
  const tile = 64 * CLOUD_PX;
  cloudUniforms.offset.value.set((cp.x + drift) / tile - cloudUniforms.rep.value / 2, -cp.z / tile - cloudUniforms.rep.value / 2);
  cloudUniforms.cam.value.copy(cp);
}
const tmpV = new THREE.Vector3();

function updateTitle(dt) {
  titleYaw += dt * 0.035;
  camera.position.copy(titleCam);
  camera.rotation.set(-0.12, titleYaw, 0);
  world.update(titleCam.x, titleCam.z, Math.min(settings.rd, 6), 8, 1);
  updateSky(false);
}

function updateLoading() {
  const need = Math.min(3, settings.rd);
  const r = world.update(player.pos.x, player.pos.z, settings.rd, 45, need);
  const pct = r.need ? r.have / r.need : 1;
  $('loading-bar').style.width = `${Math.round(pct * 100)}%`;
  $('loading-text').textContent = `Building terrain ${Math.round(pct * 100)}%`;
  camera.position.set(player.pos.x, player.eyeY(), player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  updateSky(false);
  if (r.have >= r.need) beginPlay();
}

const dirV = new THREE.Vector3();
let fps = 0, fpsAcc = 0, fpsN = 0;

function updatePlay(dt) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
  const fwd = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + touch.y;
  const strafe = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + touch.x;
  const canSprint = mode === 'creative' || hunger > 6;
  const input = {
    fwd: Math.max(-1, Math.min(1, fwd)),
    strafe: Math.max(-1, Math.min(1, strafe)),
    jump: keys.has('Space') || touch.jump,
    sneak: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sneak,
    sprint: canSprint && (keys.has('ControlLeft') || sprintLatch || touch.y > 0.95),
  };
  player.jumped = false;
  const fall = player.update(world, dt, input);
  if (fall > 0) { hurt(fall, 'fell from a high place'); sfx('step', 'dirt'); }
  if (player.pos.y < -30) {
    if (mode === 'creative') { player.pos.set(spawn.x, spawn.y + 2, spawn.z); player.vel.set(0, 0, 0); }
    else hurt(100, 'fell out of the world');
  }
  if (player.inWater && !wasInWater && player.vel.y < -4) sfx('splash');
  wasInWater = player.inWater;
  if (player.walked > 1.9) {
    player.walked = 0;
    const under = world.get(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
    if (under) sfx('step', BLOCKS[under].sound);
  }

  // Hunger and health.
  if (mode === 'survival') {
    const moving = Math.hypot(player.vel.x, player.vel.z) > 1;
    hunger = Math.max(0, hunger - dt * (0.012 + (player.sprinting && moving ? 0.07 : 0)) - (player.jumped ? (player.sprinting ? 0.15 : 0.04) : 0));
    regenTimer += dt;
    if (regenTimer >= 4) {
      regenTimer = 0;
      if (hunger >= 17 && health < 20) { health = Math.min(20, health + 1); hunger = Math.max(0, hunger - 0.6); }
      else if (hunger <= 0 && health > 1) hurt(1, 'starved');
    }
  }

  // Camera with view bobbing.
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const bobAmt = settings.bob && player.onGround ? Math.min(1, hs / 4.3) : 0;
  bobPhase += hs * dt * 1.9;
  camera.position.set(player.pos.x, player.eyeY() + Math.abs(Math.sin(bobPhase)) * 0.07 * bobAmt, player.pos.z);
  camera.position.x += Math.cos(player.yaw) * Math.cos(bobPhase) * 0.035 * bobAmt;
  camera.position.z -= Math.sin(player.yaw) * Math.cos(bobPhase) * 0.035 * bobAmt;
  camera.rotation.set(player.pitch, player.yaw, 0);
  const fovTarget = settings.fov * (player.sprinting && hs > 4 ? 1.12 : 1) * (player.flying && player.sprinting ? 1.05 : 1);
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();

  // Target block.
  camera.getWorldDirection(dirV);
  target = world.raycast(camera.position, dirV, mode === 'creative' ? 6 : 4.5);
  selection.visible = !!target;
  if (target) {
    const d = BLOCKS[target.id];
    selection.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    selection.scale.set(d.cross ? 0.7 : 1, d.cross ? 0.8 : 1, d.cross ? 0.7 : 1);
    if (d.cross) selection.position.y -= 0.1;
  }

  // Breaking.
  breakCooldown -= dt;
  useCooldown -= dt;
  let breakHeld = mouseL;
  for (const l of looks.values()) {
    if (!l.breaking && l.moved < 14 && performance.now() - l.t0 > 300) l.breaking = true;
    if (l.breaking) breakHeld = true;
  }
  if (breakHeld && target) {
    if (mode === 'creative') {
      if (breakCooldown <= 0) { breakBlock(target); breakCooldown = 0.25; }
      breaking = null;
    } else if (breakCooldown <= 0) {
      if (!breaking || breaking.x !== target.x || breaking.y !== target.y || breaking.z !== target.z) {
        breaking = { x: target.x, y: target.y, z: target.z, progress: 0 };
      }
      const hard = BLOCKS[target.id].hardness;
      breaking.progress += hard === 0 ? 1 : dt / hard;
      swingT = swingT >= 1 ? 0 : swingT;
      hitSoundT -= dt;
      if (hitSoundT <= 0 && hard !== Infinity) { sfx('hit', BLOCKS[target.id].sound); hitSoundT = 0.25; }
      if (breaking.progress >= 1) { breakBlock(target); breaking = null; breakCooldown = 0.2; }
    }
  } else breaking = null;
  crack.visible = !!breaking && breaking.progress > 0;
  if (crack.visible) {
    crack.position.set(breaking.x + 0.5, breaking.y + 0.5, breaking.z + 0.5);
    crackMat.map = cracks[Math.min(9, Math.floor(breaking.progress * 10))];
  }
  if (mouseR && useCooldown <= 0) { useAction(); useCooldown = 0.22; }

  updateEntities(dt);
  world.update(player.pos.x, player.pos.z, settings.rd, 5, 2);

  $('water-tint').hidden = !player.headInWater;
  renderHotbar();
  renderBars();
  setHand(inv[selected]?.id ?? 0);

  autosaveT += dt;
  if (autosaveT > 30) { autosaveT = 0; saveGame(); }

  if (debugOn) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    const p = player.pos;
    const facing = ['north', 'west', 'south', 'east'][Math.round((((player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4];
    const hour = Math.floor(((timeOfDay + 0.25) % 1) * 24);
    $('debug').innerHTML = [
      `Blockwild Beta 1.0 (${fps} fps)`,
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Facing: ${facing}`,
      `Biome: ${world.biome(Math.floor(p.x), Math.floor(p.z))}`,
      `Chunks loaded: ${world.chunks.size}`,
      `Time: ${String(hour).padStart(2, '0')}:00`,
      `Seed: ${worldSeed}`,
      target ? `Looking at: ${BLOCKS[target.id].name} ${target.x} ${target.y} ${target.z}` : '',
    ].filter(Boolean).map((l) => `<span>${l}</span>`).join('\n');
  }
}

function updateEntities(dt) {
  const center = tmpV.set(player.pos.x, player.pos.y + 0.8, player.pos.z);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.age += dt;
    const p = it.pos, v = it.vel;
    const inside = world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    if (inside === B.WATER) { v.y += 20 * dt; v.y = Math.min(v.y, 1.2); }
    v.y -= 18 * dt;
    p.addScaledVector(v, dt);
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    if (BLOCKS[world.get(bx, Math.floor(p.y), bz)].solid) { p.y = Math.floor(p.y) + 1.12; v.y = 0; }
    if (BLOCKS[world.get(bx, Math.floor(p.y - 0.12), bz)].solid && v.y <= 0) {
      p.y = Math.floor(p.y - 0.12) + 1.12; v.y = 0;
      const f = Math.exp(-8 * dt); v.x *= f; v.z *= f;
    }
    it.mesh.position.set(p.x, p.y + 0.06 + Math.sin(it.age * 2.6 + it.spin) * 0.05, p.z);
    it.mesh.rotation.y = it.age * 1.3 + it.spin;
    const d = p.distanceTo(center);
    if (it.age > it.delay && d < 1.7 && state === 'playing') {
      const left = addItem(it.id, it.count);
      if (left < it.count) sfx('pop');
      it.count = left;
    }
    if (!it.count || it.age > 300) { scene.remove(it.mesh); items.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    pt.vel.y -= 18 * dt;
    pt.mesh.position.addScaledVector(pt.vel, dt);
    const m = pt.mesh.position;
    if (BLOCKS[world.get(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))].solid) {
      m.y = Math.floor(m.y) + 1.02; pt.vel.set(pt.vel.x * 0.4, 0, pt.vel.z * 0.4);
    }
    if (pt.life <= 0) {
      scene.remove(pt.mesh);
      if (--pt.mesh.material.userData.n <= 0) pt.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
}

function updateHand(dt) {
  if (swingT < 1) swingT = Math.min(1, swingT + dt / 0.28);
  equipT = Math.min(1, equipT + dt / 0.2);
  const s = swingT < 1 ? Math.sin(swingT * Math.PI) : 0;
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const bob = settings.bob && player.onGround ? Math.min(1, hs / 4.3) : 0;
  handRoot.position.set(
    Math.cos(bobPhase) * 0.025 * bob - s * 0.18,
    -Math.abs(Math.sin(bobPhase)) * 0.03 * bob + s * 0.1 - (1 - equipT) * 0.4,
    -s * 0.15,
  );
  handRoot.rotation.set(s * 0.6, s * 0.4, 0);
}

// ------------------------------------------------------------ loop

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = handCam.aspect = w / h;
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  handCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'title') updateTitle(dt);
  else if (state === 'loading') updateLoading();
  else if (state === 'playing') { updatePlay(dt); updateSky(player.headInWater); }
  else updateSky(player.headInWater);
  updateHand(dt);

  renderer.clear();
  renderer.render(scene, camera);
  if (state === 'playing' || state === 'paused' || state === 'inventory' || state === 'dead') {
    renderer.clearDepth();
    renderer.render(handScene, handCam);
  }
}

window.addEventListener('beforeunload', () => { if (state !== 'title' && state !== 'loading') saveGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });

// Test hook, only with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) {
  window.blockwild = {
    get state() { return state; }, get world() { return world; }, get target() { return target; }, get inv() { return inv; },
    get health() { return health; }, player, breakTarget: () => target && breakBlock(target), use: useAction,
    setMode: (m) => { mode = m; }, hold: (b) => { mouseL = b; }, openInventory, closeInventory,
  };
}

goTitle();
requestAnimationFrame(frame);
