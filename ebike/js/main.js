import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CITY, HEAT, SCORE, GAME_TITLE } from './config.js';
import { loadAssets } from './assets.js';
import { World } from './world.js';
import { Bike } from './bike.js';
import { Vehicles } from './vehicles.js';
import { Pickups } from './pickups.js';
import { Particles, Rain } from './effects.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { clamp, damp, wrap } from './collision.js';

const $ = (id) => document.getElementById(id);
document.title = `${GAME_TITLE} — E-Bike Police Chase`;

// --------------------------------------------------------------------------------------
// Quality presets
// --------------------------------------------------------------------------------------
const QUALITY = {
  high: { pr: 1.5, shadow: 2048, bloom: true, radius: 2 },
  medium: { pr: 1.0, shadow: 1024, bloom: true, radius: 2 },
  low: { pr: 0.7, shadow: 0, bloom: false, radius: 1 },
};
const params = new URLSearchParams(location.search);
let qualityName = params.get('q') || (() => { try { return localStorage.getItem('nightrun.q'); } catch { return null; } })() || 'high';
if (!QUALITY[qualityName]) qualityName = 'high';

// --------------------------------------------------------------------------------------
// Renderer, scene, sky, lights
// --------------------------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.info.autoReset = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

window.__renderer = renderer;   // debugging hooks (used by automated screenshots)
const scene = new THREE.Scene();
const FOG = 0x151b2e;
scene.fog = new THREE.FogExp2(FOG, 0.0072);
scene.background = new THREE.Color(FOG);

const camera = new THREE.PerspectiveCamera(64, 1, 0.15, 900);
window.__camera = camera;

function skyMaterial(strong) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uMoon: { value: new THREE.Vector3(-55, 95, -38).normalize() }, uStrong: { value: strong } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uMoon; uniform float uStrong;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5453), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5453);
        float c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5453), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5453);
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 zenith = vec3(0.012, 0.022, 0.06), mid = vec3(0.05, 0.065, 0.13), hor = vec3(0.30, 0.20, 0.22);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.12, 0.85, h));
        // low cloud deck lit orange from the city below
        vec2 cp = d.xz / (0.25 + abs(d.y)) * 1.6;
        float cl = vn(cp * 1.3) * 0.6 + vn(cp * 3.1) * 0.3 + vn(cp * 7.0) * 0.1;
        float band = smoothstep(0.02, 0.35, d.y) * (1.0 - smoothstep(0.35, 0.8, d.y));
        col += vec3(0.20, 0.11, 0.09) * pow(cl, 2.0) * band * 1.6;
        // moon
        float md = max(dot(d, uMoon), 0.0);
        col += vec3(0.75, 0.85, 1.0) * (pow(md, 900.0) * 40.0 + pow(md, 60.0) * 0.35) * (1.0 - cl * 0.7);
        // stars in the gaps
        float st = step(0.9975, hash(floor(d * 260.0)));
        col += st * smoothstep(0.2, 0.7, h) * (1.0 - cl) * 0.9;
        gl_FragColor = vec4(col * uStrong, 1.0);
      }`,
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMaterial(1));
sky.renderOrder = -10;
scene.add(sky);

/** PMREM env: the same sky plus a ring of coloured window-lights, so glass, paint and wet asphalt reflect a city. */
function buildEnvironment() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(1.2)));
  const cols = [0xff9a4a, 0xffd9a0, 0x6fa8ff, 0xff3a6a, 0x5ff5d0, 0xffffff, 0xff7a2a];
  const g = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * Math.PI * 2, h = Math.random() * 30 - 2;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(2 + Math.random() * 7) }));
    m.position.set(Math.cos(a) * 70, h, Math.sin(a) * 70);
    m.scale.set(1 + Math.random() * 5, 0.8 + Math.random() * 3, 1);
    m.lookAt(0, h, 0);
    s.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 0.85;

const hemi = new THREE.HemisphereLight(0x3a4f88, 0x1a1410, 0.75);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8fa8ff, 0.55);
moon.castShadow = true;
moon.shadow.camera.left = moon.shadow.camera.bottom = -70;
moon.shadow.camera.right = moon.shadow.camera.top = 70;
moon.shadow.camera.near = 10; moon.shadow.camera.far = 260;
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.06;
scene.add(moon, moon.target);
const MOON_OFF = new THREE.Vector3(-55, 95, -38);

// --------------------------------------------------------------------------------------
// Post-processing
// --------------------------------------------------------------------------------------
let composer, bloom;
function setupComposer() {
  const q = QUALITY[qualityName];
  const pr = Math.min(devicePixelRatio || 1, q.pr);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: qualityName === 'low' ? 0 : 4 });
  if (composer) composer.dispose?.();
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 1.05);
  bloom.enabled = q.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  renderer.shadowMap.enabled = q.shadow > 0;
  moon.castShadow = q.shadow > 0;
  if (q.shadow > 0) {
    moon.shadow.mapSize.set(q.shadow, q.shadow);
    if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
  }
  CITY.viewRadius = q.radius;
  scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => { if (composer) setupComposer(); });

// --------------------------------------------------------------------------------------
// Game
// --------------------------------------------------------------------------------------
class Game {
  constructor(assets) {
    this.assets = assets;
    this.input = new Input();
    this.audio = new Audio();
    this.ui = new UI();
    this.fx = { sparks: new Particles(scene, 900, true), smoke: new Particles(scene, 500, false) };
    this.rain = new Rain(scene);
    this.world = new World(scene, assets);
    this.bike = new Bike(assets, scene, this.fx, this.audio);
    this.vehicles = new Vehicles(assets, scene, this.world, this.fx, this.audio, (t, d) => this.onEvent(t, d));
    this.pickups = new Pickups(scene, this.world.glowTex);
    this.state = 'title';     // title | playing | paused | over
    this.time = 0;            // game clock (only while playing)
    this.clock = 0;           // real clock (title animation, etc.)
    this.camH = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.best = 0;
    try { this.best = +localStorage.getItem('nightrun.best') || 0; } catch { /* private mode */ }
    this.resetRun();
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => { this.audio.setMuted(!this.audio.muted); this.ui.popup(this.audio.muted ? 'SOUND OFF' : 'SOUND ON'); };
    this.input.onRestart = () => { if (this.state === 'playing' || this.state === 'over') this.start(); };
  }

  get playing() { return this.state === 'playing'; }

  resetRun() {
    this.score = 0; this.time = 0;
    this.heat = HEAT.start;
    this.chaseT = 0; this.unseen = 0;
    this.stats = { takedowns: 0, near: 0, pickups: 0, top: 0 };
    this.combo = 0; this.comboT = 0;
    this.spawnHold = 0;
    this.endT = 0;
    this.result = null;
  }

  start() {
    this.audio.start();
    this.resetRun();
    this.bike.reset(47.5, 30, 0);
    this.vehicles.reset(this.bike);
    this.pickups.reset();
    this.world.update(this.bike.x, this.bike.z, true);
    this.camH = this.bike.h;
    this.state = 'playing';
    document.body.classList.add('playing');
    $('screen-title').classList.add('hidden');
    $('screen-over').classList.add('hidden');
    $('screen-pause').classList.add('hidden');
    this.ui.show(true);
    this.ui.popup('GO! LOSE THE POLICE', 'big');
    this.snapCamera();
  }

  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; $('screen-pause').classList.remove('hidden'); }
    else if (this.state === 'paused') { this.state = 'playing'; $('screen-pause').classList.add('hidden'); this.audio.start(); }
  }

  onEvent(type, d) {
    const b = this.bike;
    if (!this.playing) return;
    if (type === 'cop-down') {
      this.stats.takedowns++;
      const pts = SCORE.copCrash * (d.byPlayer ? 1.5 : 1);
      this.addScore(pts);
      this.ui.popup(d.byPlayer ? `TAKEDOWN  +${Math.round(pts)}` : `COP CRASHED  +${Math.round(pts)}`, 'good');
      this.audio.takedown();
    } else if (type === 'near-miss') {
      this.combo = Math.min(8, this.combo + 1);
      this.comboT = 3;
      const pts = SCORE.nearMiss * this.combo;
      this.stats.near++;
      this.addScore(pts);
      this.ui.popup(this.combo > 1 ? `CLOSE CALL x${this.combo}  +${pts}` : `CLOSE CALL  +${pts}`, 'near');
      this.audio.nearMiss();
    }
  }

  addScore(n) { this.score += n; }

  end(kind) {
    this.state = 'over';
    document.body.classList.remove('playing');
    this.result = kind;
    this.endT = 0;
    if (kind === 'escaped') { this.addScore(SCORE.escapeStar * 2 + Math.max(0, 240 - this.time) * 8); }
    const total = Math.floor(this.score);
    if (total > this.best) { this.best = total; try { localStorage.setItem('nightrun.best', String(total)); } catch { /* ignore */ } }
    if (kind === 'busted') this.audio.busted();
    setTimeout(() => {
      if (this.state !== 'over') return;
      const T = { busted: ['BUSTED', 'They boxed you in.'], wrecked: ['WRECKED', 'The bike is scrap metal.'], escaped: ['YOU ESCAPED', 'Lost them in the rain. Clean getaway.'] }[kind];
      $('over-title').textContent = T[0];
      $('over-title').className = kind === 'escaped' ? 'win' : 'lose';
      $('over-sub').textContent = T[1];
      const t = Math.floor(this.time);
      $('over-stats').innerHTML = [
        ['Score', total.toLocaleString()], ['Best', this.best.toLocaleString()],
        ['Time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
        ['Distance', `${(this.bike.distance / 1000).toFixed(2)} km`],
        ['Top speed', `${Math.round(this.stats.top * 3.6)} km/h`],
        ['Takedowns', this.stats.takedowns], ['Close calls', this.stats.near], ['Batteries', this.stats.pickups],
      ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      $('screen-over').classList.remove('hidden');
      this.ui.show(false);
    }, kind === 'escaped' ? 900 : 1700);
  }

  // ------------------------------------------------------------------------- per frame
  step(dt) {
    const b = this.bike, inp = this.input.poll();
    this.clock += dt;
    if (this.state === 'playing' || this.state === 'over') {
      const live = this.state === 'playing';
      if (live) this.time += dt;
      const t = this.state === 'playing' ? this.time : this.time + this.endT;
      if (!live) this.endT += dt;
      const control = live && b.alive ? inp : { throttle: 0, brake: 0.3, steer: 0, handbrake: false, boost: false };
      b.update(dt, control, this.world, t);
      this.world.update(b.x, b.z);

      // heat & escape logic
      if (live) this.heatLogic(dt);
      const want = this.spawnHold > 0 ? this.vehicles.activeCops.length : HEAT.copsPerHeat[this.heat];
      if (this.spawnHold > 0) this.spawnHold -= dt;
      this.vehicles.update(dt, b, this.world, t, this.heat, live ? want : 0);
      this.pickups.update(dt, t, b, () => {
        b.battery = Math.min(100, b.battery + 35);
        this.stats.pickups++;
        this.addScore(SCORE.pickup);
        this.ui.popup(`BATTERY  +${SCORE.pickup}`, 'near');
        this.audio.pickup();
      });
      if (live) {
        this.score += Math.max(0, b.forwardSpeed) * dt * SCORE.perMeter * (0.4 + 0.2 * this.heat);
        this.stats.top = Math.max(this.stats.top, b.speed);
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
        if (!b.alive) this.end('wrecked');
        else if (this.vehicles.bust >= 1) { b.alive = false; this.end('busted'); }
      }
    }
    this.updateCamera(dt);
    this.updateEffects(dt);
    if (this.state === 'playing' || this.state === 'over') this.ui.update(this, dt);
    this.updateAudio();
  }

  heatLogic(dt) {
    const b = this.bike, veh = this.vehicles;
    const cops = veh.activeCops;
    let nearest = 1e9, seen = false;
    for (const c of cops) {
      const d = Math.hypot(c.x - b.x, c.z - b.z);
      nearest = Math.min(nearest, d);
      if (d < HEAT.loseDistance) seen = true;
    }
    if (nearest < 110) this.chaseT += dt; else this.chaseT = Math.max(0, this.chaseT - dt * 0.5);
    if (this.chaseT >= HEAT.escalateEvery && this.heat < HEAT.max) {
      this.heat++; this.chaseT = 0;
      this.ui.popup(`HEAT LEVEL ${this.heat}`, 'bad');
      this.audio.heatUp();
    }
    if (this.time < HEAT.grace) seen = true;
    if (!seen) this.unseen += dt; else this.unseen = Math.max(0, this.unseen - dt * 2.5);
    if (this.unseen > 2.5) this.spawnHold = 0.5;
    if (this.unseen >= HEAT.loseTime) {
      this.unseen = 0;
      this.heat--;
      this.addScore(SCORE.escapeStar);
      this.audio.heatDown();
      for (const c of veh.cops) if (c.active && !c.disabled && Math.hypot(c.x - b.x, c.z - b.z) > 60) { c.active = false; c.obj.visible = false; }
      if (this.heat <= 0) { this.heat = 0; this.end('escaped'); return; }
      this.ui.popup(`HEAT DOWN  +${SCORE.escapeStar}`, 'good');
      this.spawnHold = 5;
      this.chaseT = 0;
    }
  }

  // ------------------------------------------------------------------------- camera
  snapCamera() {
    const b = this.bike;
    this.camH = b.h;
    this.placeCamera(0, true);
  }

  placeCamera(dt, snap = false) {
    const b = this.bike;
    const back = this.input.state.lookBack && b.alive ? Math.PI : 0;
    if (!snap) this.camH += wrap(b.h + back - this.camH) * damp(back ? 7 : 4.2, dt);
    const sp = b.speed;
    const dist = 4.5 + sp * 0.03 + (b.boosting ? 0.8 : 0);
    const height = 1.85 + sp * 0.008;
    const fx = -Math.sin(this.camH), fz = -Math.cos(this.camH);
    let cx = b.x - fx * dist, cz = b.z - fz * dist;
    // keep the camera out of walls
    for (let i = 0; i < 2; i++) for (const h of this.world.collide(cx, cz, 0.9, false)) { cx += h.nx * h.depth; cz += h.nz * h.depth; }
    const sh = b.shake * 0.22;
    const tgt = new THREE.Vector3(cx + (Math.random() - 0.5) * sh, height + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
    if (snap) this.camPos.copy(tgt); else this.camPos.lerp(tgt, 1 - Math.exp(-14 * dt));
    camera.position.copy(this.camPos);
    const look = new THREE.Vector3(b.x + fx * 6 + b.vx * 0.05, 1.1, b.z + fz * 6 + b.vz * 0.05);
    camera.lookAt(look);
    const fov = 62 + clamp(sp, 0, 36) * 0.62 + (b.boosting ? 7 : 0);
    camera.fov += (fov - camera.fov) * (snap ? 1 : damp(4, dt));
    camera.updateProjectionMatrix();
  }

  titleCamera(dt) {
    // slow orbit around the parked bike with the city glowing behind it
    const b = this.bike;
    const a = this.clock * 0.18 + 0.6;
    const R = 6.2;
    camera.position.set(b.x + Math.sin(a) * R, 1.6 + Math.sin(this.clock * 0.3) * 0.25, b.z + Math.cos(a) * R);
    camera.lookAt(b.x, 0.95, b.z);
    camera.fov = 44;
    camera.updateProjectionMatrix();
  }

  updateCamera(dt) {
    if (this.state === 'title') this.titleCamera(dt);
    else if (this.state === 'playing' || this.state === 'over') {
      if (this.state === 'over' && this.result !== 'escaped') { /* keep following the wreck */ }
      this.placeCamera(dt);
    }
  }

  updateEffects(dt) {
    const b = this.bike;
    sky.position.copy(camera.position);
    moon.position.set(b.x + MOON_OFF.x, MOON_OFF.y, b.z + MOON_OFF.z);
    moon.target.position.set(b.x, 0, b.z);
    const rainT = (this.state === 'title' ? this.clock : this.clock);
    this.rain.update(rainT, camera.position, b.vx, b.vz, b.speed);
    if (this.state !== 'paused') {
      this.fx.sparks.update(dt, camera, renderer.domElement.height / renderer.getPixelRatio());
      this.fx.smoke.update(dt, camera, renderer.domElement.height / renderer.getPixelRatio());
    }
    // bloom breathes with speed
    if (bloom) bloom.strength = 0.5 + clamp(b.speed / 40, 0, 1) * 0.2 + (b.boosting ? 0.12 : 0);
  }

  updateAudio() {
    if (!this.audio.ctx) return;
    const b = this.bike;
    const sirens = [];
    for (const c of this.vehicles.nearest.slice(0, 3)) {
      const dx = c.x - b.x, dz = c.z - b.z, d = Math.hypot(dx, dz);
      const rx = Math.cos(b.h), rz = -Math.sin(b.h);
      const closing = -((c.vx - b.vx) * dx + (c.vz - b.vz) * dz) / (d || 1);
      sirens.push({ dist: d, pan: (dx * rx + dz * rz) / (d || 1) * 0.9, vel: closing });
    }
    const active = this.state === 'playing' || this.state === 'over';
    this.audio.update(active ? b.speed : 0, this.input.state.throttle, b.boosting, b.slip * (active ? 1 : 0), this.state === 'paused' ? [] : sirens, this.clock, b.alive);
  }
}

// --------------------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------------------
async function boot() {
  setupComposer();
  const bar = $('load-fill');
  let assets;
  try {
    assets = await loadAssets(renderer, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
  } catch (err) {
    $('load-text').textContent = 'Could not load the 3D assets. Serve this folder over http (not file://).';
    console.error(err);
    return;
  }
  const game = new Game(assets);
  window.__game = game;      // handy for debugging / automated tests
  game.bike.reset(47.5, 30, 0);
  game.world.update(game.bike.x, game.bike.z, true);
  $('loading').classList.add('hidden');
  $('screen-title').classList.remove('hidden');
  $('best').textContent = game.best ? `Best: ${game.best.toLocaleString()}` : '';

  const q = $('quality');
  q.value = qualityName;
  q.addEventListener('change', () => {
    qualityName = q.value;
    try { localStorage.setItem('nightrun.q', qualityName); } catch { /* ignore */ }
    setupComposer();
  });
  $('btn-start').addEventListener('click', () => game.start());
  $('btn-again').addEventListener('click', () => game.start());
  $('btn-resume').addEventListener('click', () => game.togglePause());
  $('btn-menu').addEventListener('click', () => { location.reload(); });
  $('btn-pause').addEventListener('click', () => game.togglePause());
  $('btn-mute').addEventListener('click', () => { game.audio.start(); game.audio.setMuted(!game.audio.muted); $('btn-mute').classList.toggle('off', game.audio.muted); });
  addEventListener('keydown', (e) => { if ((e.code === 'Enter' || e.code === 'Space') && game.state === 'title') { e.preventDefault(); game.start(); } });
  if (params.has('autostart')) game.start();

  let last = performance.now();
  let slow = 0, frames = 0, adapt = 3;
  const loop = (now) => {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 0.1);
    if (game.state !== 'paused') {
      // fixed sub-steps keep the physics stable at low frame rates
      const n = Math.max(1, Math.ceil(dt / (1 / 50)));
      for (let i = 0; i < n; i++) game.step(dt / n);
    }
    renderer.info.reset();
    composer.render();
    // adaptive quality: if the first seconds run slowly, step the preset down once
    if (game.state === 'playing' && adapt > 0) {
      frames++; slow += dt;
      if (slow > 4) {
        const fps = frames / slow;
        if (fps < 28 && qualityName !== 'low') {
          qualityName = qualityName === 'high' ? 'medium' : 'low';
          q.value = qualityName;
          setupComposer();
          game.ui.popup(`Graphics: ${qualityName}`);
          adapt--;
        } else adapt = 0;
        slow = 0; frames = 0;
      }
    }
  };
  requestAnimationFrame(loop);
}
boot();
