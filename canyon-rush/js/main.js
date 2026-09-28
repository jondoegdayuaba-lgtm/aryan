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
import { Bike, BIKES } from './game/bike.js';
import { BikeModel, LOOKS } from './game/bikemodel.js';
import { CameraRig } from './game/camera.js';
import { Input } from './game/input.js';
import { Autopilot } from './game/autopilot.js';
import { Gates } from './game/gates.js';
import { Race, formatTime, WHEELIE_MEDALS } from './game/race.js';
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
  let bikeIndex = clamp(settings.bike | 0, 0, BIKES.length - 1);
  let spec = BIKES[bikeIndex];
  const bike = new Bike(phys, spec);
  const model = new BikeModel(tex, spec, LOOKS[spec.id]);
  scene.add(model.root);
  const heightAt = (x, z) => phys.heightAt(x, z);
  const fx = new Effects(scene, atmo, heightAt, { soft: Q.soft });
  const water = new Water(scene, STAGE, atmo, tex);
  const route = world.route;
  const gates = new Gates(scene, route, STAGE, heightAt);
  const race = new Race(route, gates);
  const stunts = new Stunts();
  const auto = new Autopilot(route, { maxSpeed: 30, wheelies: true });

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
  hud.setBalance(bike.balanceAngle);

  // Records are kept per bike: best lap and its splits, and the longest wheelie.
  const records = {};
  const rec = (id = spec.id) => records[id] || (records[id] = {
    best: store.get('best:' + id, null), splits: store.get('splits:' + id, null), wheelie: store.get('wheelie:' + id, 0),
  });

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
    stuckT: 0,
    lastLanding: 0,
    time: 0,
    topSpeed: 0,
    cacti: 0,
    recovers: 0,
    pausedFrom: null,
    crashes: 0,
  };
  const startPos = () => {
    const s = route.wrapS(-14);
    const p = route.pos(s), t = route.tangent(s);
    return { p, heading: Math.atan2(-t.x, -t.z), s };
  };
  const placeAt = (s) => {
    const p = route.pos(s), t = route.tangent(s);
    bike.placeOnGround(p.x, p.z, Math.atan2(-t.x, -t.z));
    rig.snap();
  };
  // The wheelie challenge starts where the road runs onto the dry lake: flat and wide open.
  const challengeS = route.sAtControl(2) + 45;
  const placeAtStart = () => {
    placeAt(startPos().s);
    auto.reset(startPos().s);
  };

  function showScreen(id) {
    for (const s of ['menu', 'garage', 'settings', 'help', 'pause', 'results']) $(s).hidden = s !== id;
  }

  function renderMenuBest() {
    const r = rec();
    $('best').textContent = r.best ? formatTime(r.best) : '--';
    $('best-wheelie').textContent = r.wheelie ? `${Math.round(r.wheelie)} m` : '--';
    $('menu-bike').textContent = spec.name;
    const m = r.best ? race.medalFor(r.best, spec.id) : null;
    $('best-medal').hidden = !m;
    if (m) {
      $('best-medal').textContent = m;
      $('best-medal').className = 'medal-chip ' + m.toLowerCase();
    }
  }

  const nextWheelieTarget = (d) => {
    const next = [...WHEELIE_MEDALS].reverse().find((m) => d < m.dist);
    return next ? `${next.name} at ${next.dist} m` : 'Gold! Keep going';
  };

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
    model.setDirt(0.1);
  }

  function resetRun() {
    audio.init();
    G.boost = 1;
    G.topSpeed = 0;
    G.cacti = 0;
    G.recovers = 0;
    G.crashes = 0;
    stunts.reset();
    fx.clear();
    model.setDirt(0.05);
    showScreen(null);
    post.resetAdaptation();
  }

  function startRace() {
    resetRun();
    G.mode = 'race';
    G.state = 'countdown';
    placeAtStart();
    race.startCountdown(3);
    hud.show(true, { race: true });
    hud.countdown('3');
    audio.beep();
  }

  function startFree() {
    resetRun();
    G.mode = 'free';
    G.state = 'free';
    placeAtStart();
    race.reset();
    gates.setNext(-1);
    hud.show(true, { race: false });
    hud.popup('Free <em>ride</em>');
  }

  function startWheelie() {
    resetRun();
    G.mode = 'wheelie';
    G.state = 'free';
    race.reset();
    gates.setNext(-1);
    placeAt(challengeS);
    hud.show(true, { race: false, challenge: true });
    hud.challenge(rec().wheelie, nextWheelieTarget(rec().wheelie));
    hud.popup('Wheelie <em>challenge</em>');
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

  function recover(quiet = false) {
    if (!['race', 'free'].includes(G.state)) return;
    fx.tracks.clear();
    if (G.mode === 'wheelie') {
      placeAt(challengeS);
      return;
    }
    const n = route.nearest(bike.pos.x, bike.pos.z, race.progressS, 200);
    let s = n.s;
    if (race.lastSafe !== null && Math.abs(route.wrapS(n.s - race.lastSafe + route.length / 2) - route.length / 2) < 250) s = race.lastSafe;
    placeAt(route.wrapS(s - 5));
    G.recovers++;
    if (!quiet) hud.popup('Back on <em>track</em>', 'cp');
  }

  function finishRace() {
    G.state = 'results';
    const t = race.time;
    const r = rec();
    const prevBest = r.best;
    const newBest = !prevBest || t < prevBest;
    if (newBest) {
      r.best = t;
      r.splits = race.splits.slice();
      store.set('best:' + spec.id, t);
      store.set('splits:' + spec.id, r.splits);
    }
    const medal = race.medalFor(t, spec.id);
    $('res-medal').textContent = medal || '';
    $('res-medal').className = 'medal ' + (medal ? medal.toLowerCase() : '');
    $('res-title').textContent = newBest && prevBest ? 'New record!' : medal ? `${medal} medal` : 'Stage complete';
    $('res-time').textContent = formatTime(t);
    const speedK = settings.units === 'mph' ? 2.23694 : 3.6;
    const stats = [
      [`Best on the ${spec.name}`, formatTime(r.best), newBest],
      ['Style points', stunts.total.toLocaleString()],
      ['Top speed', `${Math.round(G.topSpeed * speedK)} ${settings.units === 'mph' ? 'mph' : 'km/h'}`],
      ['Longest wheelie', `${Math.round(stunts.best.wheelie)} m`],
      ['Biggest air', `${stunts.best.air.toFixed(1)} s`],
      ['Crashes', String(G.crashes)],
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
  click('btn-wheelie', startWheelie);
  const renderGarage = () => {
    $('liv-name').textContent = spec.name;
    $('bike-blurb').textContent = spec.blurb;
    const st = spec.stats;
    for (const [k, v] of Object.entries(st)) $('stat-' + k).style.transform = `scaleX(${v.toFixed(2)})`;
    const r = rec();
    $('garage-best').textContent = `Best lap ${r.best ? formatTime(r.best) : '--'} · Longest wheelie ${r.wheelie ? Math.round(r.wheelie) + ' m' : '--'}`;
  };
  click('btn-garage', () => {
    G.state = 'garage';
    showScreen('garage');
    placeAtStart();
    renderGarage();
  });
  const setBike = (i) => {
    bikeIndex = (i + BIKES.length) % BIKES.length;
    spec = BIKES[bikeIndex];
    settings.bike = bikeIndex;
    store.set('bike', bikeIndex);
    bike.setSpec(spec);
    model.build(spec, LOOKS[spec.id]);
    hud.setBalance(bike.balanceAngle);
    placeAtStart();
    renderGarage();
  };
  const cycleLivery = (d) => setBike(bikeIndex + d);
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
  click('btn-restart', () => { showScreen(null); if (G.mode === 'race') startRace(); else if (G.mode === 'wheelie') startWheelie(); else startFree(); });
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
  const bodyPos = new THREE.Vector3(), bodyQuat = new THREE.Quaternion(), headPos = new THREE.Vector3();
  const tmpV = new THREE.Vector3(), camDir = new THREE.Vector3();
  const HOLD = { throttle: 0, brake: 1, steer: 0, lean: false, boost: false, hold: true, lookX: 0, lookY: 0 };

  function handleEvents(events) {
    for (const e of events) {
      if (e.type === 'count') { hud.countdown(String(e.value)); audio.beep(); }
      else if (e.type === 'go') { hud.countdown('GO!', true); audio.beep(true); G.state = 'race'; }
      else if (e.type === 'checkpoint') {
        const best = rec().splits?.[e.index];
        hud.split(best ? e.time - best : null, best ? undefined : formatTime(e.time));
        hud.popup(`Checkpoint <em>${e.index + 1}</em>`, 'cp');
        audio.checkpoint();
      } else if (e.type === 'finish') {
        hud.popup('<em>Finish!</em>', 'cp');
        finishRace();
      } else if (e.type === 'stunt') {
        hud.popup(`${e.label}${e.combo > 1 ? ` <em>x${e.combo}</em>` : ''}<span class="pts">+${e.points}</span>${e.sub ? `<span class="sub">${e.sub}</span>` : ''}`);
        G.boost = Math.min(1, G.boost + 0.12);
        audio.stunt();
      } else if (e.type === 'wheelieEnd') {
        const r = rec();
        const record = e.wheelie > r.wheelie + 0.5;
        if (record) {
          r.wheelie = e.wheelie;
          store.set('wheelie:' + spec.id, e.wheelie);
        }
        if (G.mode === 'wheelie') {
          const m = Race.wheelieMedal(e.wheelie);
          hud.popup(`${Math.round(e.wheelie)} m${record ? ' <em>New record!</em>' : m ? ` <em>${m}</em>` : ''}`, 'cp');
          if (record) audio.finish();
          hud.challenge(r.wheelie, nextWheelieTarget(r.wheelie));
        } else if (record && e.wheelie > 20) hud.popup(`Wheelie record <em>${Math.round(e.wheelie)} m</em>`, 'cp');
      }
    }
  }

  function update(dt) {
    G.time += dt;
    const S = G.state;
    let inp;
    auto.wheelies = S === 'menu' || S === 'results';
    if (S === 'menu' || S === 'results') inp = auto.drive(bike, dt);
    else if (S === 'garage' || S === 'countdown') inp = HOLD;
    else {
      inp = params.has('auto') ? auto.drive(bike, dt) : input.read();
      // Boost burns the boost bar; it refills slowly and with stunts.
      if (inp.boost && G.boost > 0.01) G.boost = Math.max(0, G.boost - dt * 0.22);
      else { inp.boost = false; G.boost = Math.min(1, G.boost + dt * 0.025); }
    }
    const playing = S === 'race' || S === 'free';

    bike.update(dt, inp);
    bike.renderTransform(bodyPos, bodyQuat);

    // Race logic and stunts.
    const ev = race.update(dt, bike);
    if (playing || S === 'countdown') handleEvents(ev);
    if (playing) {
      handleEvents(stunts.update(dt, bike));
      G.topSpeed = Math.max(G.topSpeed, bike.speed);
    }

    // Impacts: crashes, cacti, rocks, landings.
    for (const e of bike.impacts) {
      if (e.type === 'crash') {
        audio.crash(e.strength);
        rig.kick(settings.shake ? 0.8 : 0);
        fx.burst(tmpV.copy(bike.pos).setY(bike.pos.y - 0.6), 0.8);
        if (playing) {
          G.crashes++;
          const sev = [];
          stunts.crash(sev);
          handleEvents(sev);
          hud.popup(e.reason === 'loop' ? 'Looped <em>out!</em>' : '<em>Crash!</em>', 'bad');
        }
        continue;
      }
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
    bike.impacts.length = 0;
    if (bike.landing > G.lastLanding + 0.25 && !bike.crashed) {
      fx.burst(tmpV.copy(bike.pos).setY(bike.pos.y - 0.8), bike.landing * 0.7);
      audio.thump(bike.landing * 0.8);
      rig.kick(settings.shake ? bike.landing * 0.5 : 0);
    }
    G.lastLanding = bike.landing;

    // After a crash, pick yourself up where you were on the road.
    if (bike.crashed && bike.crashTime > 2.4) {
      if (playing) recover(true);
      else placeAt(auto.s ?? startPos().s);
      auto.reset(race.progressS);
    }
    // Recovery hints.
    if (playing) {
      G.stuckT = inp.throttle > 0.5 && bike.speed < 0.8 && !bike.crashed ? G.stuckT + dt : 0;
      const far = Math.hypot(bike.pos.x, bike.pos.z) > 1000;
      hud.message(G.stuckT > 3 ? (coarse ? 'Tap ↻ to recover' : 'Press R to recover') : far ? 'Head back into the canyon' : '');
    }

    // Bike and camera.
    model.update(dt, bike, bodyPos, bodyQuat, G.time, scene);
    if (playing && bike.speed > 5) model.setDirt(Math.min(0.9, model.shared.uDirt.value + dt * 0.004));
    const look = input.consumeLook();
    const camPos = bike.crashed ? model.riderCrashGroup.position : bodyPos;
    if (S === 'menu' || S === 'results') rig.cinematic(dt, bike, camPos, route, race.progressS ?? 0);
    else if (S === 'garage') rig.orbit(dt, bodyPos);
    else {
      const rumble = bike.groundedWheels && settings.shake ? clamp(bike.speed / 40, 0, 1) : 0;
      model.rider.head.getWorldPosition(headPos);
      rig.update(dt, bike, camPos, bodyQuat, look, { boost: inp.boost, stickX: inp.lookX, stickY: inp.lookY, rumble, head: bike.crashed ? null : headPos, lean: bike.lean });
    }
    const radial = post.composite.uniforms.uRadial;
    radial.value += ((inp.boost && playing ? 0.8 : 0) - radial.value) * (1 - Math.exp(-dt * 5));

    // Shadow camera over the bike, snapped to texels to stop shimmering.
    const sc = sun.shadow.camera;
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    sun.target.position.set(Math.round(bodyPos.x / texel) * texel, bodyPos.y, Math.round(bodyPos.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(atmo.sunDir, 600);

    fx.bike(dt, bike, bodyQuat);
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
        speed: bike.speed, power: bike.power, kw: (bike.power * spec.power) / 1000, boosting: inp.boost && playing, boost: G.boost, style: stunts.total,
        time: race.state === 'countdown' ? 0 : race.time, cp: race.next, cpTotal: gates.gates.length, nav,
        x: bike.pos.x, z: bike.pos.z, heading: bike.heading, pitch: bike.wheelieAngle, wheelie: stunts.wheelie,
      });
    }

    // Sound.
    let loose = 0, slip = 0, wet = false;
    for (const w of bike.wheels) {
      if (!w.contact || !w.surface) continue;
      loose += (w.surface.dust || 0) * 0.5;
      slip = Math.max(slip, w.slipLong, Math.min(1, w.slipLat / 5));
      if (w.surface.name === 'water') wet = true;
    }
    audio.update(dt, {
      running: !bike.crashed,
      motor: bike.motorOmega, power: Math.max(0, bike.power), throttle: bike.throttle || 0, speed: bike.speed, grounded: bike.groundedWheels > 0,
      loose: clamp(loose, 0, 1), slip, water: wet, boost: inp.boost && playing, air: bike.groundedWheels === 0,
    });
  }

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
  if (params.has('bike')) setBike(+params.get('bike'));
  const initialState = params.get('state');
  if (initialState === 'race') startRace();
  else if (initialState === 'free') startFree();
  else if (initialState === 'wheelie') startWheelie();
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
    renderer, scene, camera, terrain, world, atmo, post, sun, THREE, baked, bike, model, rig, phys, route, auto, scatter, fx, water,
    gates, race, stunts, hud, input, G, update, render, startRace, startFree, startWheelie, toMenu, setBike: (i) => setBike(i),
    renderOnce: () => render(0.016),
    stepFrames: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { update(dt); render(dt); } },
  };
  window.__ready = true;
}

boot().catch((err) => {
  console.error(err);
  $('load-label').textContent = 'Something went wrong while loading: ' + err.message;
});
