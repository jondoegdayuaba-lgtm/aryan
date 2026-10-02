// Turbo Kickoff: renderer, menus and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadAssets } from './assets.js';
import { Match } from './game.js';
import { Effects } from './effects.js';
import { ChaseCamera } from './camera.js';
import { readControls, clearInput } from './input.js';
import { initAudio, setEngine, toggleMute } from './audio.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a14);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1d2a, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(30, 60, 20);
scene.add(sun);

// A starry sky far outside the stadium
{
  const n = 1500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 600;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * r, Math.abs(u) * r * 0.9 + 20, Math.sin(a) * s * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb4e6, size: 1.6, sizeAttenuation: false })));
}

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1500);
const chase = new ChaseCamera(camera);
const effects = new Effects(scene);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let assets = null;
let match = null;
let lastMode = '1v1';
let lastDifficulty = 'medium';
let paused = false;

const ui = createUI({
  onStart: (mode, difficulty) => startMatch(mode, difficulty),
  onResume: () => setPaused(false),
  onRestart: () => startMatch(lastMode, lastDifficulty),
  onMenu: () => toMenu(),
});

function startMatch(mode, difficulty) {
  initAudio();
  lastMode = mode;
  lastDifficulty = difficulty;
  if (match) match.dispose();
  paused = false;
  clearInput();
  ui.startMatch(mode);
  match = new Match({ scene, assets, mode, difficulty, effects, ui, chase });
  ui.setBallCam(chase.ballCam);
}

function toMenu() {
  if (match) match.dispose();
  match = null;
  paused = false;
  setEngine(0, false, false);
  ui.showMenu();
}

function setPaused(on) {
  if (!match || match.state === 'ended') return;
  paused = on;
  ui.pause(on);
  if (on) setEngine(0, false, false);
  clearInput();
}

loadAssets((p) => ui.loading(p)).then((a) => {
  assets = a;
  scene.add(a.models.arena);
  ui.loaded();
  ui.showMenu();
}).catch((err) => {
  console.error(err);
  ui.loading(0, 'Could not load the models. Run the game from a web server (see README), or use the one-file version.');
});

// Handy for tinkering from the browser console: turboKickoff.match.ball.vel, etc.
window.turboKickoff = { get match() { return match; }, scene, camera };

let lastTime = performance.now();
let menuAngle = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  const c = readControls();
  if (c.mutePressed) ui.popup(toggleMute() ? 'Sound off' : 'Sound on');

  if (match && match.state !== 'ended') {
    if (c.pausePressed) setPaused(!paused);
    if (!paused) {
      if (c.ballCamPressed) { chase.ballCam = !chase.ballCam; ui.setBallCam(chase.ballCam); }
      match.update(dt, c);
      chase.update(match.player, match.ball, match.arena, dt);
      effects.update(dt);
      setEngine(match.player.speed, match.player.boosting, true);
    }
  } else if (match && match.state === 'ended') {
    setEngine(0, false, false);
    effects.update(dt);
  } else {
    // Menu: slow fly-around of the stadium
    menuAngle += dt * 0.08;
    camera.up.set(0, 1, 0);
    camera.position.set(Math.cos(menuAngle) * 55, 26, Math.sin(menuAngle) * 70);
    camera.lookAt(0, 2, 0);
  }
  composer.render();
});
