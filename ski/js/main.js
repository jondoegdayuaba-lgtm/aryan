// Alpine Descent - boot: create the game, wire the buttons, start the loop.
import * as THREE from 'three';
import { Game } from './game.js';
import { WorldLight } from './shader-patches.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

function fail(err) {
  console.error(err);
  const el = $('error');
  el.hidden = false;
  el.textContent = 'Sorry, the game could not start: ' + (err && err.message ? err.message : err);
}

async function boot() {
  // the single-file desktop build unpacks its embedded assets first
  if (window.__assetsReady) {
    $('loading-label').textContent = 'Unpacking the mountain...';
    await window.__assetsReady;
  }
  const canvas = $('game');
  const game = new Game(canvas, params);
  const fill = $('loading-fill'), label = $('loading-label');
  await game.init((done, total, name) => {
    fill.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
    label.textContent = name;
  });

  const ui = game.ui;
  const on = (id, fn) => $(id).addEventListener('click', () => { game.audio.start(); fn(); });
  on('btn-resume', () => game.pause(false));
  on('btn-restart', () => { game.screen = 'playing'; game.restart(); });
  on('btn-quit', () => game.toMenu());
  on('btn-again', () => game.restart());
  on('btn-next', () => game.nextRun());
  on('btn-menu', () => game.toMenu());
  on('btn-pause', () => game.pause(true));
  on('btn-cam', () => { game.save.data.camera = game.cameraRig.cycle(); game.save.save(); ui.toast(`Camera: ${game.cameraRig.mode}`); });
  on('btn-sound', () => { $('btn-sound').textContent = game.audio.toggleMute() ? 'Sound off' : 'Sound on'; game.save.data.muted = game.audio.muted; game.save.save(); });
  $('btn-sound').textContent = game.audio.muted ? 'Sound off' : 'Sound on';
  const qsel = $('opt-quality');
  qsel.value = game.save.data.quality || 'auto';
  qsel.addEventListener('change', () => { game.save.data.quality = qsel.value; game.save.save(); game.setQuality(qsel.value); });
  const csel = $('opt-camera');
  csel.value = game.save.data.camera || 'chase';
  csel.addEventListener('change', () => { game.save.data.camera = csel.value; game.save.save(); });
  game.input.bindButton($('tb-brake'), 'brake');
  game.input.bindButton($('tb-jump'), 'jump');
  game.input.bindButton($('tb-tuck'), 'tuck');
  // audio needs a user gesture
  addEventListener('pointerdown', () => game.audio.start(), { once: true });
  addEventListener('keydown', () => game.audio.start(), { once: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(true); });

  // developer / test hooks: ?run=downhill&autoplay=1&t=40&manual=1
  if (params.has('run')) {
    const run = game.world.runs.find((r) => r.id === params.get('run'));
    if (run) game.startRun(run);
  }
  if (params.has('t')) game.advance(+params.get('t'));
  if (params.has('s') && !params.has('run')) {
    // static viewpoint on the piste for screenshots
    const p = game.world.path.at(+params.get('s'), {});
    const t = +(params.get('t2') || 0);
    const x = p.x + p.rx * t, z = p.z + p.rz * t;
    const sk = game.session.skier;
    sk.reset(x, z, Math.atan2(p.tx, -p.tz));
    sk.hintS = p.s;
    game.rig._first = true;
    game.advance(0.2);
  }

  if (params.has('nolm')) WorldLight.useTex.value = 0;
  if (params.has('dbg')) game.terrain.uniforms.uDebug.value = +params.get('dbg');
  if (params.has('cs')) {
    // pinned camera in piste coordinates: cs=s,t,height above snow  cl=s,t,height  cf=fov
    const pt = (v) => { const [s, t, h] = v.split(',').map(Number); const p = game.world.path.at(s, {}); const x = p.x + p.rx * t, z = p.z + p.rz * t; return new THREE.Vector3(x, game.world.height(x, z) + h, z); };
    game.cameraRig.freeze = { pos: pt(params.get('cs')), look: pt(params.get('cl') || params.get('cs')), fov: +(params.get('cf') || 55) };
    game.step(0.001);
  }

  $('loading').classList.add('done');
  if (game.manual) {
    game.renderNow();
    window.__ready = true;
  } else {
    game.renderer.setAnimationLoop((t) => game.frame(t));
    window.__ready = true;
  }
}

boot().catch(fail);
