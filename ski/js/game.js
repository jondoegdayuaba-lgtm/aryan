// Alpine Descent: builds the scene and runs the game.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { WorldData } from './world-data.js';
import { Loader } from './assets.js';
import { TerrainRenderer } from './terrain-render.js';
import { Vegetation } from './vegetation.js';
import { Rocks } from './rocks.js';
import { setupSky } from './sky.js';
import { installFog, setWorldLightTexture } from './shader-patches.js';
import { SkierRig, OUTFIT_HUES } from './skier-rig.js';
import { RunSession } from './session.js';
import { Autopilot } from './ai.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { PostFX, QUALITY } from './postfx.js';
import { SnowSpray, SkiTracks } from './effects.js';
import { GameAudio } from './audio.js';
import { UI, SaveData } from './ui.js';
import { Props } from './props.js';
import { OpenProps } from './open-props.js';
import { OpenMode } from './open-world.js';
import { MapUI } from './map-ui.js';
import { clamp, damp, formatTime, formatDelta } from './util.js';

const AUTO_PUSH_SECONDS = 7;
const $id = (id) => document.getElementById(id);

export class Game {
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.ui = new UI();
    this.save = new SaveData();
    this.audio = new GameAudio();
    this.audio.muted = !!this.save.data.muted;
    this.input = new Input(canvas);
    this.screen = 'loading';
    this.time = 0;
    this.frameInput = { steer: 0, tuck: 0, brake: 0, jump: false, autoPush: 0 };
    this.session = null;
    this.autopilot = null;
    this.finishTimer = -1;
    this.flash = 0;
    this.demoTimer = 0;
    this.hintTimer = 0;
    this.manual = params.has('manual');
    this._view = {};            // interpolated skier state for drawing
    this.mode = 'race';         // 'race' | 'free' (open world)
    this.bundles = {};          // per map: world, terrain, forest, boulders, props (the active one is aliased on the game)
    this.mapId = 'race';
    this.open = null;
  }

  // ==================================================================== loading
  async init(onProgress) {
    const params = this.params;
    const gl = this.canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL 2 is required. Please use a recent Chrome, Edge, Firefox or Safari.');
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;

    const loader = new Loader('assets/', onProgress);
    const world = this.world = await WorldData.load('assets/world/');
    for (const r of world.runs) {
      r.drop = world.path.at(r.sStart, {}).y - world.path.at(r.sEnd, {}).y;
    }
    const atm = this.atm = (await loader.json('world/atmosphere.json')) || {};
    const [rigInfo, treeInfo] = await Promise.all([loader.json('models/skier_rig.json'), loader.json('models/tree_info.json')]);
    const [color, mask, light, sky, skyIbl, atlas, treeGltf, skierGltf, propsGltf, rockN, rockC, snowN, rockGltf, skierFreeGltf] = await Promise.all([
      loader.texture('tex/terrain_color.jpg'),
      loader.texture('tex/terrain_mask.png', { srgb: false }),
      loader.texture('tex/terrain_light.jpg', { srgb: false }),
      loader.hdr('tex/sky.hdr'),
      loader.hdr('tex/sky_ibl.hdr'),
      loader.texture('tex/tree_branches.png', { anisotropy: 8 }),
      loader.gltf('models/trees.glb'),
      loader.gltf('models/skier.glb'),
      loader.gltf('models/props.glb'),
      loader.texture('tex/rock_n.png', { srgb: false, repeat: true }),
      loader.texture('tex/rock_c.png', { srgb: false, repeat: true }),
      loader.texture('tex/snow_n.png', { srgb: false, repeat: true }),
      loader.gltf('models/rocks.glb'),
      loader.gltf('models/skier_free.glb'),
    ]);
    if (!color || !mask) throw new Error('The terrain textures are missing. Run blender/build.py to generate the assets.');
    if (!treeGltf || !skierGltf) throw new Error('The 3D models are missing. Run blender/build.py to generate the assets.');

    // ------------------------------------------------------------------ atmosphere
    const sunDir = world.sunDir;
    const sunE = atm.sunIrradiance || [154, 128, 103];
    const sunLum = atm.sunLuminance || 132;
    const sunCol = new THREE.Color(sunE[0] / sunLum, sunE[1] / sunLum, sunE[2] / sunLum);
    sunCol.lerp(new THREE.Color(1, 1, 1), 0.42);
    const lum = sunCol.r * 0.2126 + sunCol.g * 0.7152 + sunCol.b * 0.0722;
    sunCol.multiplyScalar(1 / lum);
    this.sunLum = sunLum;
    this.snowRadiance = (0.9 / Math.PI) * sunLum * 0.7;        // radiance of sunlit snow at a slight angle
    this.exposure = (params.has('exp') ? +params.get('exp') : 0.92) / this.snowRadiance;
    installFog({ sunDir, sunColor: [sunCol.r * 9, sunCol.g * 9, sunCol.b * 9] });

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xb9cdee, 1, 10);
    const fog = atm.fogColor || [8, 8.2, 8.7];
    scene.fog.color.setRGB(fog[0] * 0.92, fog[1] * 0.93, fog[2] * 0.98);

    this.skyHandle = setupSky(renderer, scene, { sky, skyIbl }, sunDir, {
      backgroundIntensity: params.has('bgi') ? +params.get('bgi') : 5.0,
      envIntensity: params.has('envi') ? +params.get('envi') : 1.25,
    });
    setWorldLightTexture(light, world);

    const camera = this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 9000);
    scene.add(camera);

    const sun = this.sun = new SunLight(sunCol, sunLum);
    sun.position.set(sunDir[0], sunDir[1], sunDir[2]);
    sun.castShadow = true;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
    scene.add(sun);

    // ------------------------------------------------------------------- world
    this.terrain = new TerrainRenderer(world, { color, mask, rockN, rockC, snowN });
    this.terrain.setSun(sunDir, new THREE.Vector3(sunE[0] * 0.9, sunE[1] * 0.9, sunE[2] * 0.9));
    scene.add(this.terrain.group);
    this.veg = new Vegetation(world, treeGltf, atlas, treeInfo);
    scene.add(this.veg.group);
    this.rocks = rockGltf && rockN && rockC ? new Rocks(world, rockGltf, rockN, rockC) : null;
    if (this.rocks) scene.add(this.rocks.group);
    this.props = propsGltf ? new Props(world, propsGltf, { glow: this.snowRadiance * 0.32, radiance: this.snowRadiance, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) }) : null;
    if (this.props) scene.add(this.props.group);
    // what the open world reuses (models and detail textures are shared, the terrain data is loaded on demand)
    this.shared = { treeGltf, atlas, treeInfo, rockGltf, propsGltf, rockN, rockC, snowN, sunE, sunDir };
    this.bundles.race = { id: 'race', world, terrain: this.terrain, veg: this.veg, rocks: this.rocks, props: this.props, light, mapTex: null };

    // ------------------------------------------------------------------ skier
    this.rigs = { race: new SkierRig(skierGltf, rigInfo) };
    if (skierFreeGltf) this.rigs.free = new SkierRig(skierFreeGltf, rigInfo);
    for (const r of Object.values(this.rigs)) { r.group.visible = false; scene.add(r.group); }
    this.rig = this.rigs.race;

    // ---------------------------------------------------------------- effects
    const sr = this.snowRadiance;
    this.spray = new SnowSpray([sr * 0.98, sr * 1.0, sr * 1.04]);
    scene.add(this.spray.points);
    this.tracks = new SkiTracks(world, [sr * 0.52, sr * 0.58, sr * 0.72]);
    scene.add(this.tracks.mesh);

    this.cameraRig = new CameraRig(camera, world);
    this.cameraRig.bind(this.canvas);
    this.cameraRig.mode = this.save.data.camera || 'chase';
    this.cameraRig.hideHead = (hide) => { for (const m of this.headMeshes) m.visible = !hide; };
    this.setCharacter(this.save.data.outfit || 'race', this.save.data.hue | 0);

    // ------------------------------------------------------------------ quality
    this.post = new PostFX(renderer, scene, camera, this.exposure);
    const q = params.get('q') || this.save.data.quality || 'auto';
    this.setQuality(q);
    addEventListener('resize', () => this.resize());
    this.resize();

    this.ui.buildRunList(world.runs, this.save, (r) => this.startRun(r), () => this.startOpenWorld());
    this.startAttract();
    this.screen = 'menu';
    this.ui.show('menu');
    window.__game = this;
    return this;
  }

  /** choose the skier: outfit ('race' | 'free') and colour (index into OUTFIT_HUES) */
  setCharacter(style, hueIndex = 0) {
    if (!this.rigs[style]) style = 'race';
    for (const [k, r] of Object.entries(this.rigs)) r.group.visible = k === style;
    this.rig = this.rigs[style];
    this.rig.setHue(OUTFIT_HUES[hueIndex % OUTFIT_HUES.length].hue);
    this.rig._first = true;
    this.headMeshes = this.rig.meshes.filter((m) => /skull|face|lips|hair|helmet|ears|goggle|strap/.test(m.name));
    this.save.data.outfit = style;
    this.save.data.hue = hueIndex;
    this.save.save();
    if (this.cameraRig) this.cameraRig._init = true;
  }

  pickQuality() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    // integrated / mobile / software renderers start one step down; the adaptive resolution handles the rest
    let weak = false;
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      weak = /intel|mali|adreno|powervr|videocore|llvmpipe|swiftshader|software|microsoft basic/i.test(name);
    } catch (e) { weak = false; }
    if (coarse || cores <= 4 || weak) return 'medium';
    return 'high';
  }

  setQuality(name) {
    const auto = name === 'auto';
    const q = auto ? this.pickQuality() : name;
    this.qualityName = q;
    this.qualityChoice = name;
    const Q = QUALITY[q];
    this.post.adaptive = auto || q === 'ultra' ? true : true;
    this.post.setQuality(q);
    const s = Q.shadow;
    this.sun.shadow.mapSize.set(s, s);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    for (const b of Object.values(this.bundles)) this._applyQuality(b, q);
    this.resize();
  }

  _applyQuality(b, q = this.qualityName) {
    const Q = QUALITY[q];
    const base = b.id === 'open' ? [46, 150, 430, 1500] : [46, 150, 430, 2100];
    b.veg.lodDist = base.map((d, i) => d * (i < 3 ? Q.trees : 1));
    b.terrain.uniforms.uSparkle.value = Q.sparkle;
    b.terrain.uniforms.uDetail.value = q === 'low' ? 0 : 1;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  // ============================================================= maps (race mountain, open world)
  /** load the open world's height field, textures and forest the first time it is chosen */
  async loadOpenWorld() {
    if (this.bundles.open) return this.bundles.open;
    const ui = this.ui;
    ui.setLoading('Loading the open world...', 0.02);
    if (window.__assetsEnsure) await window.__assetsEnsure('open/');
    await new Promise((r) => setTimeout(r, 30));              // let the loading screen paint
    const loader = new Loader('assets/', (done, total, name) => ui.setLoading(name, 0.1 + 0.6 * done / Math.max(total, 1)));
    const world = await WorldData.load('assets/open/');
    ui.setLoading('Painting the mountain...', 0.72);
    const [color, mask, light, mapTex] = await Promise.all([
      loader.texture('open/color.jpg'),
      loader.texture('open/mask.png', { srgb: false }),
      loader.texture('open/light.jpg', { srgb: false }),
      loader.texture('open/map.jpg', { mip: false }),
    ]);
    if (!color || !mask) throw new Error('The open world textures are missing. Run blender/build.py to generate the assets.');
    const sh = this.shared;
    ui.setLoading('Raising the terrain...', 0.8);
    await new Promise((r) => setTimeout(r, 30));
    const terrain = new TerrainRenderer(world, { color, mask, rockN: sh.rockN, rockC: sh.rockC, snowN: sh.snowN },
      { lodDist: [260, 600, 1300, 2600], pisteSize: [1152, 1152] });
    terrain.setSun(sh.sunDir, new THREE.Vector3(sh.sunE[0] * 0.9, sh.sunE[1] * 0.9, sh.sunE[2] * 0.9));
    ui.setLoading('Planting the forest...', 0.9);
    await new Promise((r) => setTimeout(r, 30));
    const veg = new Vegetation(world, sh.treeGltf, sh.atlas, sh.treeInfo);
    const rocks = sh.rockGltf ? new Rocks(world, sh.rockGltf, sh.rockN, sh.rockC, { lodDist: [70, 240, 720] }) : null;
    const props = new OpenProps(world, sh.propsGltf, { glow: this.snowRadiance * 0.32, radiance: this.snowRadiance, anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) });
    const b = { id: 'open', world, terrain, veg, rocks, props, light, mapTex, map: new MapUI(world, mapTex.image) };
    for (const g of [terrain.group, veg.group, rocks && rocks.group, props.group]) if (g) { g.visible = false; this.scene.add(g); }
    this.bundles.open = b;
    this._applyQuality(b);
    ui.hideLoading();
    return b;
  }

  /** make one of the loaded maps the visible, active one */
  setMap(id) {
    const b = this.bundles[id];
    if (!b) return;
    for (const [k, o] of Object.entries(this.bundles)) {
      for (const g of [o.terrain.group, o.veg.group, o.rocks && o.rocks.group, o.props && o.props.group]) if (g) g.visible = k === id;
    }
    this.mapId = id;
    this.world = b.world;
    this.terrain = b.terrain;
    this.veg = b.veg;
    this.rocks = b.rocks;
    this.props = b.props;
    setWorldLightTexture(b.light, b.world);
    this.tracks.world = b.world;
    this.cameraRig.world = b.world;
    this.veg.update(this.camera, 0, true);
    if (this.rocks) this.rocks.update(this.camera, 0, true);
  }

  // =================================================================== state
  startAttract() {
    if (this.mapId !== 'race') this.setMap('race');
    this.mode = 'race';
    const runs = this.world.runs;
    const run = runs[Math.floor(Math.random() * runs.length)];
    this.session = new RunSession(this.world, run);
    this.autopilot = new Autopilot(this.world, this.session.course, 0.9);
    this.session.begin();
    // the title-screen demo starts somewhere on the piste, already moving, so the start gantry stays out of the shot
    const len = run.sEnd - run.sStart;
    const s0 = run.sStart + 40 + Math.random() * len * 0.55;
    const p = this.world.path.at(s0, {});
    const off = (Math.random() - 0.5) * Math.min(p.width * 0.4, 12);
    const sk0 = this.session.skier;
    sk0.reset(p.x + p.rx * off, p.z + p.rz * off, Math.atan2(p.tx, -p.tz), 15);
    sk0.hintS = s0;
    if (this.props) this.props.setRun(run);
    this.demoTimer = 0;
    this.attract = true;
    this._resetVisuals();
    this.cameraRig.mode = 'chase';
  }

  _resetVisuals() {
    this.rig._first = true;
    this.cameraRig._init = true;
    this.tracks.reset();
    this.finishTimer = -1;
  }

  startRun(run) {
    this.audio.start();
    this.audio.click();
    if (this.mode === 'free') this._leaveOpen();
    if (this.mapId !== 'race') this.setMap('race');
    this.mode = 'race';
    this.ui.setFreeMode(false);
    this.attract = false;
    this.run = run;
    this.session = new RunSession(this.world, run);
    this.autopilot = this.params.has('autoplay') ? new Autopilot(this.world, this.session.course, +(this.params.get('autoplay') || 0.95) || 0.95) : null;
    this.session.begin();
    if (this.props) this.props.setRun(run);
    this.startY = this.session.skier.y;
    this._resetVisuals();
    this.ui.startRun(run, this.world, this.qualityName);
    this.cameraRig.mode = this.save.data.camera || 'chase';
    this.screen = 'playing';
    this.ui.show('hud');
    this.hintTimer = 9;
    this.ui.hint(this.ui.el.touch.hidden ? 'A / D steer · W tuck for speed · Shift skate · S brake · Space to jump' : 'Touch left / right to steer');
    this.input.clearPressed();
  }

  restart() {
    if (this.mode === 'free') { this.screen = 'playing'; this.ui.show('hud'); this.open.respawn(); return; }
    if (this.run) this.startRun(this.run);
  }

  /** menu -> open world */
  async startOpenWorld() {
    this.audio.start();
    this.audio.click();
    this.attract = false;
    try {
      const b = await this.loadOpenWorld();
      this.setMap('open');
      if (!this.open) this.open = new OpenMode(this, b);
      this.mode = 'free';
      this.open.begin();
      this.session = this.open.session;
      this.autopilot = null;
      this.run = { id: 'open', name: 'Open World', mode: 'free', gates: [] };
      this.startY = this.session.skier.y;
      this.ui.setFreeMode(true);
      this.ui.el.runName.textContent = 'Open World';
      this.ui.el.gates.textContent = 'Alpine valley';
      $id('btn-restart').textContent = 'Back on your feet';
      this.input.captureTab = true;
      this._resetVisuals();
      this.cameraRig.mode = this.save.data.camera || 'chase';
      this.cameraRig.world = b.world;
      this.screen = 'playing';
      this.ui.show('hud');
      this.ui.toast('Welcome to the mountain', 'info');
      this.hintTimer = 12;
      this.ui.hint(this.ui.el.touch.hidden ? 'W tuck · Shift skate · E ride the lift · Tab map · R back on your feet' : 'Touch left / right to steer · walk to a lift and tap Lift');
      this.input.clearPressed();
    } catch (err) {
      this.ui.hideLoading();
      console.error(err);
      this.ui.toast('Could not load the open world', 'bad');
      this.toMenu();
    }
  }

  _leaveOpen() {
    $id('btn-restart').textContent = 'Restart run';
    if (this.open) this.open.persist();
    this.input.captureTab = false;
    this.ui.setFreeMode(false);
  }

  toMenu() {
    if (this.mode === 'free') this._leaveOpen();
    this.mode = 'race';
    if (this.mapId !== 'race') this.setMap('race');
    this.ui.buildRunList(this.world.runs, this.save, (r) => this.startRun(r), () => this.startOpenWorld());
    this.startAttract();
    this.screen = 'menu';
    this.ui.show('menu');
    this.ui.hint('');
  }

  nextRun() {
    const runs = this.world.runs;
    const i = runs.findIndex((r) => r.id === this.run.id);
    this.startRun(runs[(i + 1) % runs.length]);
  }

  pause(on) {
    if (this.screen === 'playing' && on) { this.screen = 'paused'; this.ui.show('paused'); }
    else if (this.screen === 'paused' && !on) { this.screen = 'playing'; this.ui.show('hud'); }
  }

  // ==================================================================== frame
  frame(nowMs) {
    const dtRaw = this._last ? (nowMs - this._last) / 1000 : 0.016;
    this._last = nowMs;
    const dt = clamp(dtRaw, 0.001, 0.05);
    this.post.adapt(dtRaw * 1000);
    this.step(dt);
    this.renderNow(dt);
  }

  /** advance the simulation by dt (also used by the headless test hooks) */
  step(dt) {
    this.time += dt;
    const sk = this.session.skier;
    const c = this.session.course;

    // ---- keys that work everywhere
    if (this.input.consume('KeyM')) { this.save.data.muted = this.audio.toggleMute(); this.save.save(); this.ui.toast(this.audio.muted ? 'Sound off' : 'Sound on'); }
    if (this.screen === 'map') {
      if (this.input.consume('Escape') || this.input.consume('Tab') || this.input.consume('KeyP')) this.closeMap();
    } else if (this.screen === 'playing' || this.screen === 'paused') {
      if (this.input.consume('Escape') || this.input.consume('KeyP')) this.pause(this.screen === 'playing');
      if (this.input.consume('KeyR') && this.screen === 'playing') this.restart();
      if (this.input.consume('KeyC')) { this.save.data.camera = this.cameraRig.cycle(); this.save.save(); this.ui.toast(`Camera: ${this.cameraRig.mode}`); }
      if (this.mode === 'free' && this.screen === 'playing') {
        if (this.input.consume('KeyE')) this.open.interact();
        if (this.input.consume('Tab')) this.openMap();
      }
    }
    const frozen = this.screen === 'paused' || this.screen === 'map';

    if (!frozen && this.mode === 'free') {
      // ---- open world: free roaming physics, chairlifts, flags
      const inp = this.screen === 'playing' ? this.input.read(dt) : this.frameInput;
      inp.autoPush = 0;
      this.frameInput = inp;
      const events = this.open.step(dt, this.frameInput);
      for (const e of events) this._onEvent(e, sk);
    } else if (!frozen) {
      // ---- input -> physics
      let inp;
      if (this.autopilot && !sk.crashed) inp = this.autopilot.control(sk, this.time);
      else if (this.autopilot) inp = { steer: 0, tuck: 0, brake: 0, jump: false };
      else inp = this.screen === 'playing' ? this.input.read(dt) : this.frameInput;
      inp.autoPush = c.state === 'running' && c.clock < AUTO_PUSH_SECONDS ? 14 : 0;
      this.frameInput = inp;
      const events = this.session.update(dt, () => this.frameInput);
      if (this.screen === 'playing') for (const e of events) this._onEvent(e, sk);
      else if (this.attract) for (const e of events) this._onDemoEvent(e);

      if (this.attract) {
        this.demoTimer += dt;
        if ((c.state === 'finished' && this.session.coasting > 4) || this.demoTimer > 150) this.startAttract();
        else if (this.demoTimer > 0 && Math.floor(this.demoTimer / 11) !== Math.floor((this.demoTimer - dt) / 11)) this.cameraRig.mode = ['chase', 'far', 'chase', 'helmet'][Math.floor(this.demoTimer / 11) % 4];
      }
    }

    // ---- visuals (also while paused so the picture stays alive). The physics runs at a fixed 120 Hz, so
    // everything that is drawn uses the pose interpolated to the frame time: smooth at any refresh rate.
    const v = sk.interp(this.session.alpha, this._view);
    this.rig.update(v, frozen ? 0 : dt);
    this.cameraRig.update(dt, v, this.rig);
    if (!frozen) this._effects(dt, v);
    this.audio.update(dt, sk, this.screen === 'playing' || this.attract);
    if (this.props) this.props.update(dt, this.time, c, sk);
    this.flash = damp(this.flash, 0, 5, dt);

    // ---- HUD
    if (this.mode === 'free') {
      if (this.screen === 'playing' || this.screen === 'paused') this.ui.updateFree(dt, this._freeHud(v));
      if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) { this.ui.hint(''); this.hintTimer = 0; } }
    } else if (this.screen === 'playing' || this.screen === 'paused' || this.screen === 'results') {
      const run = this.run;
      const remaining = Math.max(0, run.sEnd - sk.pathS);
      this.ui.update(dt, {
        speed: sk.speed, time: c.state === 'running' || c.state === 'finished' ? c.time : 0,
        gatesText: run.mode === 'slalom' ? `Gates ${c.passed} / ${c.gates.length}` : `Checkpoint ${c.passed} / ${c.gates.length}`,
        altitude: sk.y, descended: this.startY - sk.y, remaining, progress: c.progress,
      });
      if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0 || c.clock > 8) { this.ui.hint(''); this.hintTimer = 0; } }
    }
    if (this.finishTimer >= 0 && this.screen === 'playing') {
      this.finishTimer -= dt;
      if (this.finishTimer < 0) this._showResults();
    }
  }

  // ============================================================== open world screens
  _freeHud(v) {
    const o = this.open, b = this.bundles.open, cr = this.cameraRig, prog = o.progress;
    const sk = this.session.skier;
    return {
      speed: sk.speed, altitude: sk.y, descended: Math.max(0, this.startY - sk.y),
      flags: prog.flags, flagTotal: prog.flagTotal, found: prog.found, foundTotal: prog.foundTotal,
      nearest: o.nearest, prompt: o.prompt, yaw: cr.heading + cr.orbitYaw, x: v.x, z: v.z,
      map: b.map, taken: o.taken, flagList: o.flags, landmarks: o.landmarks, foundSet: o.found,
    };
  }

  _mapState() {
    const o = this.open, sk = this.session.skier;
    return { x: sk.x, z: sk.z, yaw: sk.yaw, taken: o.taken, flagList: o.flags, landmarks: o.landmarks, foundSet: o.found, nearest: null };
  }

  openMap() {
    if (this.mode !== 'free' || this.screen !== 'playing') return;
    const o = this.open, b = this.bundles.open, ui = this.ui;
    this.screen = 'map';
    ui.show('map');
    b.map.drawFull(ui.el.mapCanvas, this._mapState());
    const p = o.progress;
    ui.el.mapProgress.textContent = `Flags ${p.flags} / ${p.flagTotal}  ·  Places ${p.found} / ${p.foundTotal}  ·  ${(o.data.km || 0).toFixed(1)} km skied`;
    // fast travel to the village and the lift bases
    const box = ui.el.mapTravel;
    box.innerHTML = '';
    const add = (label, x, z, yaw) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => { o.teleport(x, z, yaw); this.closeMap(); ui.toast(`${label}`, 'info'); });
      box.appendChild(btn);
    };
    const sp = o.world.info.spawn;
    add('Village', sp.x, sp.z, sp.yaw || 0);
    for (const lf of o.lifts) add(lf.name, lf.base.x - lf.base.dx * 14 + lf.base.dz * 8, lf.base.z - lf.base.dz * 14 - lf.base.dx * 8, Math.atan2(lf.base.dx, -lf.base.dz));
  }

  closeMap() {
    if (this.screen !== 'map') return;
    this.screen = 'playing';
    this.ui.show('hud');
    this.input.clearPressed();
  }

  _onDemoEvent(e) {
    void e;
  }

  _onEvent(e, sk) {
    const c = this.session.course;
    const ui = this.ui, audio = this.audio;
    switch (e.type) {
      case 'count': ui.countdown(String(e.n)); audio.beep(false); break;
      case 'go': ui.countdown('GO', true); audio.beep(true); ui.hint(''); break;
      case 'gate': {
        const g = c.gates[e.index];
        if (e.ok) { audio.gate(true, clamp(g.t / 12, -1, 1)); if (c.passed % 5 === 0) ui.toast(`${c.passed} gates`, 'good'); }
        else { audio.gate(false); ui.toast('Missed gate  +3 s', 'bad'); }
        if (this.props) this.props.gateResult(e.index, e.ok);
        break;
      }
      case 'split': {
        audio.split();
        const bestSplits = this.save.data.splits && this.save.data.splits[this.run.id];
        let txt = `Checkpoint ${e.index + 1}  ${formatTime(e.time)}`;
        let ahead = null;
        if (bestSplits && bestSplits[e.index] != null) { const d = e.time - bestSplits[e.index]; txt += `  ${formatDelta(d)}`; ahead = d <= 0; }
        ui.split(txt, ahead);
        break;
      }
      case 'checkpoint-missed': ui.toast('Checkpoint missed', 'bad'); break;
      case 'penalty': ui.penalty(c.penalty); break;
      case 'pop': audio.pop(); break;
      case 'takeoff': this.cameraRig.impulse(0.15); break;
      case 'land': {
        audio.land(e.impact / 12);
        this.cameraRig.impulse(clamp(e.impact / 14, 0, 1));
        if (e.impact > 4) this._burst(sk, clamp(e.impact * 6, 10, 70));
        if (e.clean && e.air > 0.7) ui.toast(`Clean landing · ${e.air.toFixed(1)} s air`, 'good');
        else if (e.air > 1.2 && !e.clean && e.impact <= 13) ui.toast('Rough landing', 'info');
        break;
      }
      case 'crash': {
        audio.crash(); ui.flashCrash(); this.cameraRig.impulse(1);
        this.flash = 0.35;
        const why = { tree: 'Hit a tree', rock: 'Hit a rock', cliff: 'Too steep', impact: 'Hard landing', edge: 'Caught an edge', boundary: 'Out of bounds', net: 'Into the safety net', edge2: 'Edge of the map' }[e.cause] || 'Crash';
        ui.toast(`${why}!`, 'bad');
        this._burst(sk, 90);
        break;
      }
      case 'respawn': ui.toast(this.mode === 'free' ? 'Back on your feet' : 'Back on the piste  +4 s', 'info'); this.tracks.breakTrack(); this.rig._first = true; this.cameraRig._init = true; break;
      case 'finish': {
        audio.finish();
        this.finishTimer = 2.6;
        this.finishInfo = e;
        break;
      }
      default: break;
    }
  }

  _showResults() {
    const c = this.session.course, sk = this.session.skier, run = this.run;
    const time = c.finishTime;
    const medal = c.medal(time);
    const prevBest = this.save.best(run.id);
    const record = this.save.submit(run.id, time, medal);
    if (record) {
      this.save.data.splits = this.save.data.splits || {};
      this.save.data.splits[run.id] = c.splits.map((s) => s.time);
      this.save.save();
    }
    this.screen = 'results';
    this.ui.showResults({
      title: run.name, time, raw: c.clock, penalty: c.penalty, medal, record: record && prevBest != null || (record && prevBest == null),
      best: record ? null : this.save.best(run.id), topSpeed: sk.maxSpeed, maxAir: sk.maxAir, missed: c.missed, passed: c.passed,
      gates: c.gates.length, crashes: c.crashes, slalom: c.slalom, hasNext: true,
    });
    if (medal) this.audio.medal(medal);
  }

  // =================================================================== effects
  _burst(sk, n) {
    const f = [Math.sin(sk.yaw), -Math.cos(sk.yaw)];
    this.spray.emit(sk.x, sk.y + 0.1, sk.z, -f[0] * sk.speed * 0.25, 2.2, -f[1] * sk.speed * 0.25, n, 3.8, 0.24, 1.3);
  }

  _effects(dt, sk) {
    const sy = Math.sin(sk.yaw), cy = -Math.cos(sk.yaw);
    const rx = -cy, rz = sy;                        // right-hand direction
    const spd = sk.speed;
    if (sk.grounded && !sk.crashed && spd > 2.5) {
      const skid = sk.skidAmount;
      const carve = clamp(Math.abs(sk.lean) / 0.9, 0, 1) * clamp(spd / 26, 0, 1);
      const pow = sk.surface === 'powder' ? 2.6 : 1;
      const rate = (6 + 140 * skid + 46 * carve) * pow * clamp(spd / 20, 0.3, 1.4);
      let n = rate * dt;
      const side = sk.slip !== 0 ? Math.sign(-sk.slip) : Math.sign(sk.lean || 1);
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        const k = Math.random() < 0.5 ? -1 : 1;
        const tx = sk.x - sy * 0.55 + rx * 0.115 * k;
        const tz = sk.z - cy * 0.55 + rz * 0.115 * k;
        const out = (0.9 + 2.6 * skid + 1.6 * carve) * (Math.random() * 0.8 + 0.4);
        this.spray.emit(tx, sk.y + 0.05, tz, -sy * spd * 0.12 + rx * side * out, 0.6 + 1.3 * skid + 0.6 * carve, -cy * spd * 0.12 + rz * side * out, 1, 1.0 + skid, 0.11 + 0.1 * skid + 0.05 * pow, 0.7 + 0.5 * pow);
      }
      // tracks
      const strength = 0.5 + 0.4 * clamp(Math.abs(sk.lean) / 0.8, 0, 1) + 0.3 * skid;
      this.tracks.add(0, sk.x - rx * 0.115, sk.z - rz * 0.115, rx, rz, 0.05 + 0.05 * skid, strength);
      this.tracks.add(1, sk.x + rx * 0.115, sk.z + rz * 0.115, rx, rz, 0.05 + 0.05 * skid, strength);
    } else if (!sk.grounded) this.tracks.breakTrack();
    this.spray.update(dt);
    this.spray.setViewport(this.post.height * this.post.ratio, this.camera.fov);
  }

  // =================================================================== render
  renderNow(dt = 0.016) {
    const sk = this.session.skier;
    if (this.skyHandle.background) {
      this.skyHandle.background.position.copy(this.camera.position);
      this.skyHandle.background.scale.setScalar(this.camera.far * 0.5);
    }
    this.terrain.update(this.camera);
    this.veg.update(this.camera, dt);
    if (this.rocks) this.rocks.update(this.camera, dt);
    const speed01 = clamp((sk.speed - 16) / 36, 0, 1);
    this.post.render(dt, this.time, speed01, this.flash);
  }

  /** deterministic stepping for tests: advance `seconds` at 60 Hz without drawing */
  advance(seconds, viaInput = null) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      if (viaInput) this.frameInput = { ...this.frameInput, ...viaInput };
      this.step(1 / 60);
    }
  }

  run_() { return this.session; }
}

export { formatTime };
