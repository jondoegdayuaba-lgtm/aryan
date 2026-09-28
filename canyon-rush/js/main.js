import * as THREE from 'three';
import { STAGE } from './world/stage.js';
import { generateWorld } from './world/worldgen.js';
import { Atmosphere, makeSkyDome } from './render/atmosphere.js';
import { installShaderChunks } from './render/shaderpatch.js';
import { Terrain } from './render/terrain.js';
import { bakeTerrainLight } from './render/bake.js';
import { PostPipeline } from './render/post.js';
import { makeNoiseTexture, makeCellTexture } from './render/textures.js';
import { Scatter } from './render/scatter.js';
import { Effects } from './render/effects.js';
import { Water } from './render/water.js';
import { PhysicsWorld } from './game/physicsworld.js';
import { Vehicle } from './game/vehicle.js';
import { TruckModel, LIVERIES } from './game/truck.js';
import { CameraRig } from './game/camera.js';
import { Input } from './game/input.js';
import { Autopilot } from './game/autopilot.js';
import { Gates } from './game/gates.js';
import { Race, formatTime } from './game/race.js';
import { Stunts } from './game/stunts.js';
import { Hud } from './game/hud.js';
import { Audio } from './game/audio.js';
import { loadSettings, store } from './settings.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function setProgress(p, label) {
  $('load-fill').style.width = `${Math.round(p * 100)}%`;
  if (label) $('load-label').textContent = label;
}

async function runGenerator(gen, onProgress) {
  let t0 = performance.now();
  for (;;) {
    const { value, done } = gen.next();
    if (done) return value;
    if (performance.now() - t0 > 40) {
      onProgress(value);
      await nextFrame();
      t0 = performance.now();
    }
  }
}

async function boot() {
  const settings = loadSettings();
  const Q = settings.q;
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (coarse) document.body.classList.add('touch');

  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is not available');
  } catch (err) {
    $('load-label').textContent = 'This game needs WebGL 2, which your browser could not start.';
    throw err;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // ---- World.
  const t0 = performance.now();
  const world = await runGenerator(generateWorld(STAGE), (v) => setProgress(v.progress * 0.68, v.label));
  console.log(`world generated in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  setProgress(0.7, 'Painting the sky');
  await nextFrame();
  const tex = { noise: makeNoiseTexture(), cell: makeCellTexture() };
  const atmo = new Atmosphere(renderer, settings.time);
  installShaderChunks(atmo);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.00011);
  scene.environment = atmo.envMap;
  scene.add(makeSkyDome(atmo));

  const sun = new THREE.DirectionalLight(atmo.sunColor, atmo.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const SH = Q.shadow >= 4096 ? 55 : 45;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 1600 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  const terrain = new Terrain(world, tex, { stage: STAGE, gridDim: Q.grid });
  scene.add(terrain.mesh);
  const baked = await bakeTerrainLight(renderer, world, atmo.sunDir, {
    nearStep: params.has('fastbake') ? 2 : Q.bakeStep,
    onProgress: (f) => setProgress(0.72 + 0.2 * f, 'Lighting the canyon'),
  });

  setProgress(0.94, 'Planting cacti');
  await nextFrame();
  const phys = new PhysicsWorld(world, STAGE);
  const scatter = new Scatter(scene, world, phys, tex, atmo, Q.scatter);
  const vehicle = new Vehicle(phys);
  const truck = new TruckModel(tex, clamp(settings.livery | 0, 0, LIVERIES.length - 1));
  scene.add(truck.root);
  const heightAt = (x, z) => phys.heightAt(x, z);
  const fx = new Effects(scene, atmo, heightAt, { soft: Q.soft });
  const water = new Water(scene, STAGE, atmo, tex);
  const route = world.route;
  const gates = new Gates(scene, route, STAGE, heightAt);
  const race = new Race(route, gates);
  const stunts = new Stunts();
  const auto = new Autopilot(route, { maxSpeed: 34 });

  const post = new PostPipeline(renderer, {
    samples: params.has('msaa') ? +params.get('msaa') : Q.msaa,
    renderScale: params.has('scale') ? +params.get('scale') : Q.renderScale,
  });
  post.composite.uniforms.uExposure.value = atmo.time.exposure;

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 30000);
  const rig = new CameraRig(camera, heightAt);
  const input = new Input(canvas);
  input.bindTouch($('touch'));
  const audio = new Audio();
  audio.volume = settings.volume;
  audio.muted = settings.muted;
  const hud = new Hud(world, route, gates);
  hud.setUnits(settings.units);

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    const pr = renderer.getPixelRatio();
    post.setSize(Math.floor(innerWidth * pr), Math.floor(innerHeight * pr));
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // ---- Game state.
  const G = {
    state: 'menu',
    mode: 'race',
    boost: 1,
    upsideT: 0,
    stuckT: 0,
    lastLanding: 0,
    time: 0,
    topSpeed: 0,
    cacti: 0,
    recovers: 0,
    pausedFrom: null,
  };
  const startPos = () => {
    const s = route.wrapS(-14);
    const p = route.pos(s), t = route.tangent(s);
    return { p, heading: Math.atan2(-t.x, -t.z), s };
  };
  const placeAt = (s) => {
    const p = route.pos(s), t = route.tangent(s);
    vehicle.placeOnGround(p.x, p.z, Math.atan2(-t.x, -t.z));
    rig.snap();
  };
  const placeAtStart = () => {
    placeAt(startPos().s);
    auto.reset(startPos().s);
  };

  function showScreen(id) {
    for (const s of ['menu', 'garage', 'settings', 'help', 'pause', 'results']) $(s).hidden = s !== id;
  }

  function renderMenuBest() {
    const b = settings.best;
    $('best').textContent = b ? formatTime(b) : '--';
    const m = b ? race.medalFor(b) : null;
    $('best-medal').hidden = !m;
    if (m) {
      $('best-medal').textContent = m;
      $('best-medal').className = 'medal-chip ' + m.toLowerCase();
    }
  }

  function toMenu() {
    G.state = 'menu';
    race.reset();
    gates.setNext(-1);
    hud.show(false);
    showScreen('menu');
    renderMenuBest();
    placeAt(route.wrapS(startPos().s + 180));
    auto.reset(null);
    fx.clear();
    truck.setDirt(0.1);
  }

  function startRace() {
    audio.init();
    G.mode = 'race';
    G.state = 'countdown';
    G.boost = 1;
    G.topSpeed = 0;
    G.cacti = 0;
    G.recovers = 0;
    stunts.reset();
    fx.clear();
    placeAtStart();
    race.startCountdown(3);
    truck.setDirt(0.05);
    showScreen(null);
    hud.show(true, { race: true });
    hud.countdown('3');
    audio.beep();
    post.resetAdaptation();
  }

  function startFree() {
    audio.init();
    G.mode = 'free';
    G.state = 'free';
    G.boost = 1;
    stunts.reset();
    fx.clear();
    placeAtStart();
    race.reset();
    gates.setNext(-1);
    truck.setDirt(0.05);
    showScreen(null);
    hud.show(true, { race: false });
    hud.popup('Free <em>roam</em>');
    post.resetAdaptation();
  }

  function pause() {
    if (!['race', 'free', 'countdown'].includes(G.state)) return;
    G.pausedFrom = G.state;
    G.state = 'paused';
    showScreen('pause');
    $('btn-resume').focus({ preventScroll: true });
  }

  function resume() {
    if (G.state !== 'paused') return;
    G.state = G.pausedFrom;
    showScreen(null);
    audio.init();
  }

  function recover() {
    if (!['race', 'free'].includes(G.state)) return;
    const n = route.nearest(vehicle.pos.x, vehicle.pos.z, race.progressS, 200);
    let s = n.s;
    if (race.lastSafe !== null && Math.abs(route.wrapS(n.s - race.lastSafe + route.length / 2) - route.length / 2) < 250) s = race.lastSafe;
    placeAt(route.wrapS(s - 5));
    G.recovers++;
    hud.popup('Back on <em>track</em>', 'cp');
  }

  function finishRace() {
    G.state = 'results';
    const t = race.time;
    const prevBest = settings.best;
    const newBest = !prevBest || t < prevBest;
    if (newBest) {
      settings.best = t;
      settings.bestSplits = race.splits.slice();
      store.set('best', t);
      store.set('bestSplits', settings.bestSplits);
    }
    const medal = race.medalFor(t);
    $('res-medal').textContent = medal || '';
    $('res-medal').className = 'medal ' + (medal ? medal.toLowerCase() : '');
    $('res-title').textContent = newBest && prevBest ? 'New record!' : medal ? `${medal} medal` : 'Stage complete';
    $('res-time').textContent = formatTime(t);
    const speedK = settings.units === 'mph' ? 2.23694 : 3.6;
    const stats = [
      ['Best time', formatTime(settings.best), newBest],
      ['Style points', stunts.total.toLocaleString()],
      ['Top speed', `${Math.round(G.topSpeed * speedK)} ${settings.units === 'mph' ? 'mph' : 'km/h'}`],
      ['Biggest air', `${stunts.best.air.toFixed(1)} s`],
      ['Cacti flattened', String(G.cacti)],
      ['Recoveries', String(G.recovers)],
    ];
    $('res-stats').innerHTML = stats.map(([k, v, good]) => `<div><dt>${k}</dt><dd class="${good ? 'good' : ''}">${v}</dd></div>`).join('');
    setTimeout(() => {
      if (G.state !== 'results') return;
      hud.show(false);
      showScreen('results');
      $('btn-again').focus({ preventScroll: true });
    }, 1600);
    audio.finish();
    auto.reset(race.progressS);
  }

  // ---- UI wiring.
  const click = (id, fn) => $(id).addEventListener('click', () => { audio.init(); audio.click(); fn(); });
  click('btn-rally', startRace);
  click('btn-free', startFree);
  click('btn-garage', () => {
    G.state = 'garage';
    showScreen('garage');
    placeAtStart();
    $('liv-name').textContent = LIVERIES[truck.liveryIndex].name;
  });
  const cycleLivery = (d) => {
    const i = (truck.liveryIndex + d + LIVERIES.length) % LIVERIES.length;
    truck.setLivery(i);
    settings.livery = i;
    store.set('livery', i);
    $('liv-name').textContent = LIVERIES[i].name;
  };
  click('liv-prev', () => cycleLivery(-1));
  click('liv-next', () => cycleLivery(1));
  click('garage-done', toMenu);
  click('btn-help', () => showScreen('help'));
  click('help-back', () => showScreen('menu'));
  click('btn-settings', () => {
    $('set-quality').value = settings.quality;
    $('set-time').value = settings.time;
    $('set-units').value = settings.units;
    $('set-volume').value = settings.volume;
    $('set-shake').checked = settings.shake;
    showScreen('settings');
  });
  $('set-volume').addEventListener('input', (e) => { audio.init(); audio.setVolume(+e.target.value); });
  click('set-back', () => showScreen('menu'));
  click('set-apply', () => {
    const q = $('set-quality').value, t = $('set-time').value;
    settings.units = $('set-units').value;
    settings.volume = +$('set-volume').value;
    settings.shake = $('set-shake').checked;
    store.set('units', settings.units);
    store.set('volume', settings.volume);
    store.set('shake', settings.shake);
    hud.setUnits(settings.units);
    const reload = q !== settings.quality || t !== settings.time;
    store.set('quality', q);
    store.set('time', t);
    if (reload) {
      const u = new URL(location.href);
      u.searchParams.delete('quality');
      u.searchParams.delete('time');
      location.href = u.toString();
    } else showScreen('menu');
  });
  click('btn-resume', resume);
  click('btn-restart', () => { showScreen(null); if (G.mode === 'race') startRace(); else startFree(); });
  click('btn-quit', toMenu);
  click('btn-again', startRace);
  click('btn-menu', toMenu);
  $('btn-pause').addEventListener('click', () => { audio.init(); pause(); });
  $('btn-recover').addEventListener('click', recover);

  input.onKey = (code) => {
    audio.init();
    const onButton = document.activeElement?.tagName === 'BUTTON';
    if (code === 'KeyM') {
      audio.setMuted(!audio.muted);
      store.set('muted', audio.muted);
      return;
    }
    switch (G.state) {
      case 'menu':
        if (!onButton && code === 'Enter') startRace();
        break;
      case 'garage':
        if (code === 'ArrowLeft' || code === 'KeyA') cycleLivery(-1);
        if (code === 'ArrowRight' || code === 'KeyD') cycleLivery(1);
        if (code === 'Escape' || code === 'Enter') toMenu();
        break;
      case 'race': case 'free': case 'countdown':
        if (code === 'Escape' || code === 'KeyP') pause();
        if (code === 'KeyC') rig.cycle();
        if (code === 'KeyR' && G.state !== 'countdown') recover();
        break;
      case 'paused':
        if (code === 'Escape' || code === 'KeyP') resume();
        break;
      case 'results':
        if (!onButton && code === 'Enter') startRace();
        if (code === 'Escape') toMenu();
        break;
    }
  };
  input.onPad = (b) => {
    audio.init();
    if (b === 9) {
      if (G.state === 'paused') resume();
      else if (G.state === 'menu') startRace();
      else pause();
    }
    if (b === 3 && ['race', 'free'].includes(G.state)) rig.cycle();
    if (b === 8) recover();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ---- Per-frame.
  const bodyPos = new THREE.Vector3(), bodyQuat = new THREE.Quaternion();
  const tmpV = new THREE.Vector3(), camDir = new THREE.Vector3();
  const HOLD = { throttle: 0, brake: 1, steer: 0, handbrake: true, boost: false, lookX: 0, lookY: 0 };

  function handleEvents(events) {
    for (const e of events) {
      if (e.type === 'count') { hud.countdown(String(e.value)); audio.beep(); }
      else if (e.type === 'go') { hud.countdown('GO!', true); audio.beep(true); G.state = 'race'; }
      else if (e.type === 'checkpoint') {
        const best = settings.bestSplits?.[e.index];
        hud.split(best ? e.time - best : null, best ? undefined : formatTime(e.time));
        hud.popup(`Checkpoint <em>${e.index + 1}</em>`, 'cp');
        audio.checkpoint();
      } else if (e.type === 'finish') {
        hud.popup('<em>Finish!</em>', 'cp');
        finishRace();
      } else if (e.type === 'stunt') {
        hud.popup(`${e.label}${e.combo > 1 ? ` <em>x${e.combo}</em>` : ''}<span class="pts">+${e.points}</span>`);
        G.boost = Math.min(1, G.boost + 0.12);
        audio.stunt();
      }
    }
  }

  function update(dt) {
    G.time += dt;
    const S = G.state;
    let inp;
    if (S === 'menu' || S === 'results') inp = auto.drive(vehicle);
    else if (S === 'garage' || S === 'countdown') inp = HOLD;
    else {
      inp = params.has('auto') ? auto.drive(vehicle) : input.read();
      // Boost burns the boost bar; it refills slowly and with stunts.
      if (inp.boost && G.boost > 0.01) G.boost = Math.max(0, G.boost - dt * 0.22);
      else { inp.boost = false; G.boost = Math.min(1, G.boost + dt * 0.025); }
    }
    const playing = S === 'race' || S === 'free';

    if (S === 'countdown') {
      // The truck holds on the line; throttle revs the engine.
      const rev = input.read().throttle;
      vehicle.rpm += (900 + rev * 5200 - vehicle.rpm) * (1 - Math.exp(-dt * (rev > 0.1 ? 6 : 3)));
      vehicle.throttleInput = rev;
    } else {
      vehicle.update(dt, inp);
    }
    vehicle.renderTransform(bodyPos, bodyQuat);

    // Race logic and stunts.
    const ev = race.update(dt, vehicle);
    if (playing || S === 'countdown') handleEvents(ev);
    if (playing) {
      handleEvents(stunts.update(dt, vehicle));
      G.topSpeed = Math.max(G.topSpeed, vehicle.speed);
    }

    // Impacts: cacti, rocks, landings.
    for (const e of vehicle.impacts) {
      if (e.type === 'break' && e.target.type === 'cactus') {
        scatter.breakCactus(e.target);
        fx.cactusBreak(e.target, e.velocity);
        audio.crunch();
        rig.kick(settings.shake ? 0.35 : 0);
        if (playing) {
          const sev = [];
          stunts.cactus(sev);
          handleEvents(sev);
          G.cacti++;
        }
      } else if (e.type === 'hit') {
        audio.thump(e.strength * 0.6);
        rig.kick(settings.shake ? e.strength : 0);
      }
    }
    vehicle.impacts.length = 0;
    if (vehicle.landing > G.lastLanding + 0.25) {
      fx.burst(tmpV.copy(vehicle.pos).setY(vehicle.pos.y - 0.8), vehicle.landing);
      audio.thump(vehicle.landing);
      rig.kick(settings.shake ? vehicle.landing * 0.6 : 0);
    }
    G.lastLanding = vehicle.landing;

    // Recovery hints.
    if (playing) {
      G.upsideT = vehicle.upsideDown ? G.upsideT + dt : 0;
      G.stuckT = inp.throttle > 0.5 && vehicle.speed < 0.8 ? G.stuckT + dt : 0;
      if (G.upsideT > 3.5) { recover(); G.upsideT = 0; }
      const far = Math.hypot(vehicle.pos.x, vehicle.pos.z) > 1000;
      hud.message(G.upsideT > 1 || G.stuckT > 3 ? (coarse ? 'Tap ↻ to recover' : 'Press R to recover') : far ? 'Head back into the canyon' : '');
    }

    // Truck and camera.
    truck.update(dt, vehicle, bodyPos, bodyQuat, G.time);
    if (playing && vehicle.speed > 5) truck.setDirt(Math.min(0.9, truck.shared.uDirt.value + dt * 0.004));
    const look = input.consumeLook();
    if (S === 'menu' || S === 'results') rig.cinematic(dt, vehicle, bodyPos, route, race.progressS ?? 0);
    else if (S === 'garage') rig.orbit(dt, bodyPos);
    else {
      const rumble = vehicle.groundedWheels && settings.shake ? clamp(vehicle.speed / 40, 0, 1) : 0;
      rig.update(dt, vehicle, bodyPos, bodyQuat, look, { boost: inp.boost, stickX: inp.lookX, stickY: inp.lookY, rumble });
    }
    const radial = post.composite.uniforms.uRadial;
    radial.value += ((inp.boost && playing ? 0.8 : 0) - radial.value) * (1 - Math.exp(-dt * 5));

    // Shadow camera over the truck, snapped to texels to stop shimmering.
    const sc = sun.shadow.camera;
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    sun.target.position.set(Math.round(bodyPos.x / texel) * texel, bodyPos.y, Math.round(bodyPos.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(atmo.sunDir, 600);

    fx.truck(dt, vehicle, bodyQuat, inp.boost);
    gates.update(dt);

    // HUD.
    if (!$('hud').hidden) {
      let nav = null;
      const gate = race.nextGate();
      if (gate && G.mode === 'race') {
        tmpV.subVectors(gate.pos, camera.position);
        camera.getWorldDirection(camDir);
        const camYaw = Math.atan2(-camDir.x, -camDir.z);
        const gateYaw = Math.atan2(-tmpV.x, -tmpV.z);
        nav = { angle: -angDiff(gateYaw, camYaw), dist: Math.hypot(tmpV.x, tmpV.z) };
      }
      hud.update({
        speed: vehicle.speed, gear: vehicle.gear, rpm: vehicle.rpm, boost: G.boost, style: stunts.total,
        time: race.state === 'countdown' ? 0 : race.time, cp: race.next, cpTotal: gates.gates.length, nav,
        x: vehicle.pos.x, z: vehicle.pos.z, heading: vehicle.heading,
      });
    }

    // Sound.
    let loose = 0, slip = 0, wet = false;
    for (const w of vehicle.wheels) {
      if (!w.contact || !w.surface) continue;
      loose += (w.surface.dust || 0) * 0.25;
      slip = Math.max(slip, w.slipLong, Math.min(1, w.slipLat / 6));
      if (w.surface.name === 'water') wet = true;
    }
    audio.update(dt, {
      running: true,
      rpm: vehicle.rpm, throttle: vehicle.throttleInput || 0, speed: vehicle.speed, grounded: vehicle.groundedWheels > 0,
      loose: clamp(loose, 0, 1), slip, water: wet, boost: inp.boost && playing, air: vehicle.groundedWheels === 0,
      limiter: vehicle.rpm > 6850 && (vehicle.throttleInput || 0) > 0.5, shifting: vehicle.shiftTimer > 0,
    });
  }
  vehicle.onShift = (d) => { if (d > 0) audio.shift(); };

  // Second pass into the same HDR target: soft particles and water, which read the scene depth.
  function renderExtras() {
    camera.layers.set(1);
    renderer.render(scene, camera);
    camera.layers.set(0);
  }

  function render(dt) {
    terrain.update(camera);
    scatter.update(dt, camera);
    fx.update(dt, camera, post);
    water.update(dt, camera, post);
    post.render(scene, camera, dt, renderExtras);
  }

  // Dynamic resolution: keep the frame rate up on slower devices.
  const perf = { acc: 0, n: 0, cool: 3, scale: post.renderScale };
  function adapt(dt) {
    if (params.has('scale') || params.has('still')) return;
    perf.acc += dt;
    perf.n++;
    perf.cool -= dt;
    if (perf.acc < 2) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0;
    perf.n = 0;
    if (perf.cool > 0) return;
    let s = perf.scale;
    if (avg > 1 / 40) s = Math.max(Q.minScale, s - 0.08);
    else if (avg < 1 / 57) s = Math.min(Q.renderScale, s + 0.04);
    if (s !== perf.scale) {
      perf.scale = s;
      post.renderScale = s;
      resize();
      perf.cool = 2;
    }
  }

  // ---- Start.
  const initialState = params.get('state');
  if (initialState === 'race') startRace();
  else if (initialState === 'free') startFree();
  else toMenu();
  if (params.has('sim')) {
    const secs = +params.get('sim');
    for (let t = 0; t < secs; t += 1 / 60) update(1 / 60);
  }

  $('loading').classList.add('done');
  if (params.has('still')) $('loading').style.display = 'none';
  setTimeout(() => { $('loading').hidden = true; }, 900);

  let last = performance.now();
  let frames = 0;
  const still = params.has('still') ? +params.get('still') || 1 : 0;
  function frame(now) {
    const dt = still ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.state !== 'paused') update(dt);
    render(G.state === 'paused' ? 0 : dt);
    adapt(dt);
    frames++;
    if (still && frames >= still) { window.__frameDone = true; return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__canyon = {
    renderer, scene, camera, terrain, world, atmo, post, sun, THREE, baked, vehicle, truck, rig, phys, route, auto, scatter, fx, water,
    gates, race, stunts, hud, G, update, render, startRace, startFree, toMenu,
    renderOnce: () => render(0.016),
    stepFrames: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { update(dt); render(dt); } },
  };
  window.__ready = true;
}

boot().catch((err) => {
  console.error(err);
  $('load-label').textContent = 'Something went wrong while loading: ' + err.message;
});
