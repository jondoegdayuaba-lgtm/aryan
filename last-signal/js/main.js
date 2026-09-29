import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { GAME_TITLE, WORLD, QUALITY } from './config.js';
import { $, clamp, saturate, store, nextFrame } from './util.js';
import { generateWorld } from './world.js';
import { installFog, Atmosphere } from './atmosphere.js';
import { Sky } from './sky.js';
import { Post } from './post.js';
import { makeTerrainTextures, makeNoiseTexture, makeWaterNormal } from './textures.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { Flora } from './flora.js';
import { Grass } from './grass.js';
import { Structures } from './structures.js';
import { Input } from './input.js';
import { Collision } from './physics.js';
import { Player } from './player.js';
import { placeContent } from './content.js';
import { Play } from './play.js';
import { ATMO } from './atmosphere.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (coarse) document.body.classList.add('touch');

// three.js's fog code is replaced before any material is compiled.
installFog();

const game = {
  params, debug: DEBUG, coarse,
  renderer: null, scene: new THREE.Scene(), camera: null,
  atmo: null, sky: null, post: null, world: null, terrain: null, water: null,
  sun: null, hemi: null,
  systems: [],
  quality: null, qualityName: 'high',
  time: 0, clockSpeed: 1, paused: false,
};

const setLoading = (p, text) => {
  $('loading-fill').style.width = `${Math.round(p * 100)}%`;
  if (text) $('loading-text').textContent = text;
};

// ---------- Renderer ----------
function createRenderer() {
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  } catch (err) {
    $('loading-text').textContent = 'This game needs WebGL 2, which your browser could not start.';
    throw err;
  }
  renderer.toneMapping = THREE.NoToneMapping;   // the post pass tone maps
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 1);
  return renderer;
}

function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.high;
  game.qualityName = name;
  game.quality = q;
  const { renderer, post, sun, water, terrain } = game;
  const dprCap = game.coarse ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
  post.setQuality({ scale: q.scale, msaa: q.msaa, bloom: q.bloom, godRays: q.godRays });
  const shadowsOn = q.shadows > 0;
  renderer.shadowMap.enabled = shadowsOn;
  sun.castShadow = shadowsOn;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  terrain?.setShadows(shadowsOn);
  game.grass?.setDensity(q.grass);
  if (game.flora) { game.flora.lodScale = q.trees; game.flora.setShadows(shadowsOn); }
  water?.setReflection(q.reflections);
  game.camera.far = q.view * 2.2;
  game.camera.updateProjectionMatrix();
  resize();
}

function resize() {
  const { renderer, post, camera } = game;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.resize(renderer.domElement.width, renderer.domElement.height);
}
addEventListener('resize', () => game.renderer && resize());

// ---------- Lighting ----------
function createLights() {
  const sun = new SunLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.camera.far = 300;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.22;
  sun.shadow.radius = 2.4;
  game.scene.add(sun);
  // A faint sky/ground fill so shaded ground is never pitch black at night.
  const hemi = new THREE.HemisphereLight(0x8aa2d4, 0x141a22, 0.0);
  game.scene.add(hemi);
  game.sun = sun;
  game.hemi = hemi;
}

function updateLights() {
  const { atmo, sun, hemi, scene } = game;
  sun.position.copy(atmo.keyDir);
  sun.color.copy(atmo.keyColor);
  sun.intensity = atmo.keyIntensity;
  hemi.intensity = atmo.ambientFloor;
  scene.environmentIntensity = atmo.envIntensity;
}

// ---------- Frame ----------
const _v = new THREE.Vector3();
const _uv = new THREE.Vector2();

function update(dt) {
  const { renderer, scene, camera, atmo, sky, post, terrain, water } = game;
  dt = Math.min(dt, 0.1);
  game.time += dt;

  if (!game.paused) atmo.advance(dt, game.clockSpeed);
  const underwater = 0;
  atmo.update(dt, underwater);
  updateLights();
  if (game.play?.mode === 'play' && game.player) game.player.update(dt);
  for (const s of game.systems) s.update?.(dt, game);

  terrain.update(camera);
  game.flora?.update(camera);
  ATMO.uPlayer.value.copy(camera.position);
  game.grass?.update(camera);
  water.update(atmo);
  sky.refreshEnvironment(scene, atmo);

}

function render() {
  const { renderer, scene, camera, atmo, sky, post, terrain, water } = game;
  // Mirrored view of the valley for the lake. Shadow maps from the last frame are reused.
  renderer.shadowMap.autoUpdate = false;
  water.renderReflection(renderer, camera, (mirror) => {
    sky.update(atmo, mirror);
    water.group.visible = false;
    renderer.render(scene, mirror);
    water.group.visible = true;
  });
  renderer.shadowMap.autoUpdate = true;

  sky.update(atmo, camera);
  post.renderScene(scene, camera);

  // Sun shafts need the sun's place on screen.
  _v.copy(camera.position).addScaledVector(atmo.sunDir, 1000).project(camera);
  const onScreen = _v.z < 1 && atmo.elev > -2;
  _uv.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  const rays = onScreen ? saturate(atmo.elev / 8) * (1 - atmo.weather.overcast) * (1 - saturate(atmo.weather.storm)) : 0;
  post.u.uRayColor.value.copy(atmo.keyColor).multiplyScalar(0.9);
  post.finish({ time: game.time, exposure: atmo.exposure, sunUv: _uv, sunVisible: rays });
}
function frame(dt) { update(dt); render(); }
game.update = update;
game.frame = frame;

let last = performance.now();
// Keeps the frame rate up: lower the render resolution first, then the quality tier; creep back up when there is headroom.
const perf = { t: 0, frames: 0, slowFor: 0, fastFor: 0, scale: 1, cooldown: 5 };
function adapt(dt) {
  if (game.play?.mode !== 'play') { perf.t = 0; perf.frames = 0; return; }
  perf.t += dt; perf.frames++;
  if (perf.t < 1.5) return;
  const fps = perf.frames / perf.t;
  perf.t = 0; perf.frames = 0;
  perf.cooldown -= 1.5;
  if (perf.cooldown > 0) return;
  const q = game.quality;
  if (fps < 38) {
    perf.slowFor++; perf.fastFor = 0;
    if (perf.slowFor >= 2) {
      perf.slowFor = 0; perf.cooldown = 4;
      if (game.post.scale > 0.6) game.post.setScale(Math.max(0.55, game.post.scale - 0.12));
      else if (game.qualityName === 'high') { applyQuality('medium'); }
      else if (game.qualityName === 'medium') { applyQuality('low'); }
    }
  } else if (fps > 57 && game.post.scale < q.scale) {
    perf.fastFor++; perf.slowFor = 0;
    if (perf.fastFor >= 4) { perf.fastFor = 0; perf.cooldown = 6; game.post.setScale(Math.min(q.scale, game.post.scale + 0.08)); }
  } else { perf.slowFor = 0; perf.fastFor = 0; }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = (now - last) / 1000;
  last = now;
  if (game.holdFrames) return;
  frame(dt);
  if (!DEBUG) adapt(dt);
}

// ---------- Boot ----------
async function boot() {
  setLoading(0.02, 'Starting the renderer');
  const renderer = (game.renderer = createRenderer());
  game.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.12, 6500);
  game.scene.fog = new THREE.FogExp2(0xffffff, 0.0001);   // switches fog on; the atmosphere does the real work
  game.atmo = new Atmosphere();
  game.sky = new Sky(renderer);
  game.scene.add(game.sky.mesh);
  game.post = new Post(renderer);
  createLights();
  await nextFrame();

  setLoading(0.06, 'Raising mountains');
  game.world = await generateWorld({ onProgress: (p, m) => setLoading(0.06 + p * 0.3, m) });

  setLoading(0.38, 'Painting the ground');
  await nextFrame();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const layers = makeTerrainTextures(aniso);
  game.noiseTex = makeNoiseTexture();
  game.noiseTex.anisotropy = 2;
  game.terrain = new Terrain(game.world, layers, game.noiseTex, { anisotropy: aniso });
  game.scene.add(game.terrain.group);

  setLoading(0.55, 'Filling the lake');
  await nextFrame();
  game.water = new Water(game.world, game.terrain, makeWaterNormal());
  game.scene.add(game.water.group);

  setLoading(0.62, 'Planting the forest');
  await nextFrame();
  const flora = (game.flora = new Flora(game.world));
  await flora.load();
  const clears = Object.values(game.world.sites).filter((s) => s.clear);
  flora.scatter((x, z) => clears.some((s) => Math.hypot(x - s.x, z - s.z) < s.clear * 0.85));
  flora.index();
  game.scene.add(flora.group);
  console.log(`flora: ${flora.items.length} items`);
  const structures = (game.structures = new Structures(game.world));
  game.scene.add(structures.group);
  setLoading(0.7, 'Raising the cabin');
  game.content = await placeContent(game);
  game.coll = new Collision(flora.colliders, structures.colliders);
  game.input = new Input($('game'));
  game.player = new Player(game.world, game.coll, game.camera, game.input);
  game.grass = new Grass(game.terrain, game.world);
  game.scene.add(game.grass.group);
  game.camera.layers.enable(1);

  const start = params.get('q') || store.get('quality', coarse ? 'medium' : 'high');
  applyQuality(QUALITY[start] ? start : 'high');
  game.flora.lodScale = game.quality.trees;

  // Place the camera on the ground near the crash site until the game systems take over.
  const w = game.world, s = w.sites.wreck;
  game.camera.position.set(s.x, w.heightAt(s.x, s.z) + 1.7, s.z);
  game.camera.rotation.order = 'YXZ';
  game.camera.rotation.y = Math.PI * 0.75;
  game.applyQuality = applyQuality;
  setLoading(0.9, 'Loading the story');
  game.play = new Play(game, game.content);
  await game.play.init();

  setLoading(0.8, 'Warming up the sky');
  await nextFrame();
  game.sky.refreshEnvironment(game.scene, game.atmo, true);
  frame(0.016);
  setLoading(1, 'Ready');
  await nextFrame();
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), DEBUG ? 0 : 1000);
  game.ready = true;
  if (!DEBUG || !params.has('hold')) requestAnimationFrame(loop);
  else game.holdFrames = true;
}

// ---------- Debug hooks for testing from a script ----------
if (DEBUG) {
  window.LS = game;
  game.setCamera = (x, z, yawDeg = 0, pitchDeg = 0, above = 1.7) => {
    const c = game.camera;
    c.position.set(x, game.world.heightAt(x, z) + above, z);
    c.rotation.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ');
    c.updateMatrixWorld();
  };
  game.setLook = (x, y, z, tx, ty, tz) => {
    game.camera.position.set(x, y, z);
    game.camera.lookAt(tx, ty, tz);
    game.camera.updateMatrixWorld();
  };
  game.setWeather = (w) => Object.assign(game.atmo.weather, w);
  game.THREE = THREE;
}

boot().catch((err) => {
  console.error(err);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = 'Something went wrong while loading. Try reloading the page.';
  window.__bootError = String(err && err.stack || err);
});
