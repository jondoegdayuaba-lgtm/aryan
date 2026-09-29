// The game itself: interactions, items, fire-building, resting, the quest chain and radio, saving,
// death, the rescue and every menu. Everything else (rendering, physics, weather...) is a system it drives.
import * as THREE from 'three';
import { $, clamp, damp, lerp, saturate, smoothstep, store, formatClock } from './util.js';
import { TIME, WORLD } from './config.js';
import { ITEMS, Inventory, newWater } from './items.js';
import { NOTES, RADIO, OBJECTIVES, HINTS } from './story.js';
import { Survival } from './survival.js';
import { Fires } from './fire.js';
import { Weather } from './weather.js';
import { Audio } from './audio.js';
import { MapView } from './map.js';
import { Hud } from './hud.js';
import { Helicopter } from './heli.js';

const V3 = THREE.Vector3;
const _fwd = new V3(), _tmp = new V3(), _w = { depth: 0, y: 0, body: null };

export class Play {
  constructor(game, content) {
    this.g = game;
    this.content = content;
    this.hud = new Hud();
    this.audio = new Audio();
    this.survival = new Survival();
    this.inv = new Inventory();
    this.water = newWater();
    this.map = new MapView(game.world);
    this.fires = new Fires(game.scene);
    this.weather = new Weather(game.scene, game.atmo);
    this.heli = new Helicopter(game);
    game.fires = this.fires;
    game.weather = this.weather;
    game.survival = this.survival;
    game.hud = this.hud;
    game.audio = this.audio;

    this.mode = 'title';
    this.prevPanel = null;
    this.objIndex = 0;
    this.flags = {};
    this.pages = [];                 // found note ids
    this.hintsSeen = new Set();
    this.interactables = [];
    this.current = null;
    this.holding = 0;
    this.deaths = 0;
    this.steps = 0;
    this.startTime = 0;
    this.playTime = 0;
    this.checkpoint = null;
    this.saveTimer = 0;
    this.sheltered = false;
    this.zoom = 0;
    this.titleAngle = 0;
    this.lastSay = 0;
    this.heliHeard = false;
    this.speech = 'speechSynthesis' in window;
    this.settings = { fov: 68, sens: 1, vol: 0.8, music: true, voice: true, invert: false, hints: true, quality: game.qualityName, ...(store.get('settings', {}) || {}) };
  }

  // ---------- setup ----------
  async init() {
    const g = this.g;
    await this.heli.load();
    this.heli.onPhase = (p) => this._heliPhase(p);
    g.scene.add(g.camera);
    // flashlight rides on the camera
    this.torch = new THREE.SpotLight(0xffe6c0, 0, 70, 0.5, 0.65, 1.5);
    this.torch.position.set(0.16, -0.14, 0.05);
    this.torch.target.position.set(0, -0.2, -6);
    g.camera.add(this.torch, this.torch.target);

    // fires that already exist in the world
    const A = g.structures.anchors;
    const wf = A.wreck;
    this.wreckFires = [
      this.fires.add('wreck', wf.FIRE_engine.pos.x, wf.FIRE_engine.pos.y, wf.FIRE_engine.pos.z, { fuel: Infinity, size: 1.1, range: 22 }),
      this.fires.add('wreck', wf.FIRE_wing.pos.x, wf.FIRE_wing.pos.y, wf.FIRE_wing.pos.z, { fuel: Infinity, size: 0.6, range: 14 }),
    ];
    const ca = A.cabin;
    this.stove = this.fires.add('stove', ca.FIRE_stove.pos.x, ca.FIRE_stove.pos.y, ca.FIRE_stove.pos.z, { fuel: 1e9, size: 0.45, lit: false, range: 9 });
    this.lantern = this.fires.add('lantern', ca.LIGHT_lantern.pos.x, ca.LIGHT_lantern.pos.y, ca.LIGHT_lantern.pos.z, { lit: false, range: 8 });
    const lz = g.world.sites.lz;
    this.signalFire = this.fires.add('signal', lz.x, lz.y + 0.1, lz.z, { fuel: 1500, size: 1.5, lit: false, range: 30 });
    this.campPit = null;

    this._buildInteractables();
    this._scatterPickups();
    this._wireUi();
    this._wirePlayer();
    this._applySettings(true);

    // input
    g.input.onKey = (code, e) => this._key(code, e);
    g.input.onClick = () => this._use();
    g.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'play') this.pause();
    };
    this.audio.setVolume(this.settings.vol);
    g.systems.push(this);
    this.showTitle();
  }

  _applySettings(first) {
    const s = this.settings, g = this.g;
    g.player.baseFov = s.fov;
    g.player.sensitivity = 0.0022 * s.sens;
    g.player.invertY = s.invert;
    this.hud.hintsOn = s.hints;
    this.audio.setVolume(s.vol);
    this.audio.setMusic(s.music);
    if (!first && s.quality !== g.qualityName) { g.applyQuality(s.quality); store.set('quality', s.quality); }
    store.set('settings', s);
  }

  _wirePlayer() {
    const p = this.g.player, a = this.audio;
    p.events.step = (surface, k) => { a.step(surface, k); this.steps++; };
    p.events.land = (v, water) => a.land(v, water);
    p.events.jump = () => { a.jump(); this.survival.stamina -= 9; };
    p.events.splash = (k) => a.splash(clamp(k / 4, 0.4, 1.4));
    p.events.swimStroke = () => a.stroke();
    p.events.hurt = (amt, cause) => this.survival.hurt(amt, cause === 'fall' ? 'You fell too far.' : 'You were badly hurt.');
    this.survival.onHurt = (amt) => {
      a.hurt(amt);
      p.kick.set((Math.random() - 0.5) * 0.06, 0.05);
      this._damageFlash = Math.min(1, 0.35 + amt / 30);
    };
    this.survival.onDeath = (cause) => this._die(cause);
    this.weather.onThunder = (delay, dist) => setTimeout(() => this.audio.thunder(dist), delay * 1000);
  }

  // ---------- content ----------
  _anchor(model, name) { return this.g.structures.anchors[model]?.[name]?.pos; }

  _add(o) { this.interactables.push({ range: 2.6, key: 'E', ...o }); return o; }

  _buildInteractables() {
    const g = this.g, S = g.world.sites, C = this.content;
    const A = (m, n) => this._anchor(m, n);
    const note = (id, pos, spawnName = 'paper') => {
      const root = C.spawn(spawnName, pos.x, pos.z, { y: pos.y - 0.02, yaw: Math.random() * 6, lift: 0.02, scale: 1.4 });
      this._add({ id: 'note-' + id, pos: pos.clone(), range: 2.2, obj: root, label: () => (this.pages.includes(id) ? null : 'Read the note'), action: () => { this._readNote(id); root.visible = false; } });
    };

    // -- wreck: the survival kit
    const bp = A('wreck', 'ANCHOR_backpack');
    const pack = C.spawn('backpack', bp.x, bp.z, { y: bp.y - 0.45, yaw: 1, scale: 1.2 });
    this._add({ id: 'kit', pos: bp.clone().add(new V3(0, 0.1, 0)), range: 2.8, label: () => (this.flags.kit ? null : 'Search your backpack'), action: () => this._takeKit(pack) });
    const wp = A('wreck', 'ANCHOR_wake');
    note('log', new V3(wp.x + 2.2, g.world.heightAt(wp.x + 2.2, wp.z + 1.4) + 0.05, wp.z + 1.4));

    // -- tower: ladder, antenna, binoculars, note
    const tl = A('tower', 'ANCHOR_ladder_bottom'), tt = A('tower', 'ANCHOR_ladder_top');
    this._add({ id: 'ladder', pos: tl.clone(), range: 2.4, label: () => (this.g.player.ladder ? null : 'Climb the ladder'), action: () => { this.g.player.grabLadder({ x: tl.x, z: tl.z, y0: g.world.heightAt(tl.x, tl.z), y1: tt.y }); this.audio.ladder(); } });
    const tr = A('tower', 'ANCHOR_tower_radio');
    const ant = C.spawn('antenna', tr.x, tr.z, { y: tr.y - 0.02, yaw: 0.4, scale: 1.3 });
    this._add({ id: 'antenna', pos: tr.clone(), range: 2.4, obj: ant, label: () => (this.flags.antenna ? null : 'Take the antenna wire'), action: () => this._takeAntenna(ant) });
    const bino = A('tower', 'ANCHOR_binoculars');
    this._add({ id: 'binoculars', pos: bino.clone(), range: 2.2, label: () => (this.zoom ? 'Lower the binoculars' : 'Look through the binoculars'), action: () => { this.zoom = this.zoom ? 0 : 1; this.audio.click(); if (this.zoom) { this.map.reveal(this.g.player.pos.x, this.g.player.pos.z, 700); this._discover(); } } });
    note('tower', new V3(tr.x - 1.1, tr.y - 0.02, tr.z + 0.3));

    // -- camp
    const cp = A('camp', 'ANCHOR_camp_pack');
    const cpack = C.spawn('backpack', cp.x, cp.z, { y: cp.y - 0.28, yaw: 2.2, scale: 1.1 });
    this._add({ id: 'camp-pack', pos: cp.clone(), range: 2.4, obj: cpack, label: () => (this.flags.campPack ? null : 'Search the abandoned pack'), action: () => { this.flags.campPack = true; cpack.visible = false; this._give('beans', 1); this._give('cells', 1); this._give('pills', 3); this._give('berries', 2); this.audio.pickup(); } });
    note('camp', A('camp', 'ANCHOR_camp_note'));
    const fp = A('camp', 'ANCHOR_firepit');
    this.campPitPos = fp.clone();
    for (let i = 0; i < 3; i++) C.spawn('wood', fp.x + 0.9 + i * 0.15, fp.z + 0.7, { yaw: i, lift: 0.1 + i * 0.1 });
    this._add({ id: 'camp-wood', pos: new V3(fp.x + 0.9, fp.y + 0.2, fp.z + 0.7), range: 2.2, label: () => (this.flags.campWood ? null : 'Take the firewood'), action: () => { this.flags.campWood = true; this._give('wood', 3); this.audio.pickup(); } });
    const tent = A('camp', 'ANCHOR_tent');
    this._add({ id: 'tent', pos: tent.clone(), range: 2.6, label: () => 'Rest in the tent (hold R)', action: () => this.toast('Hold R to rest here.') });

    // -- mine
    const bat = A('mine', 'ANCHOR_battery');
    const batt = C.spawn('battery', bat.x, bat.z, { y: bat.y - 0.03, yaw: 0.5, scale: 1.4 });
    this._add({ id: 'battery', pos: bat.clone(), range: 2.4, obj: batt, label: () => (this.flags.battery ? null : 'Take the truck battery'), action: () => this._takeBattery(batt) });
    note('mine', A('mine', 'ANCHOR_mine_note'));

    // -- bridge note on the west post
    const br = S.bridge;
    const bx = br.x - br.nx * (br.half + 1.6), bz = br.z - br.nz * (br.half + 1.6);
    note('bridge', new V3(bx, g.world.heightAt(bx, bz) + 0.9, bz));

    // -- cabin
    const cab = (n) => A('cabin', n);
    const door = g.structures.placed.cabin.getObjectByName('DOOR_main');
    this.door = { obj: door, open: 0, target: 0 };
    this._add({ id: 'door', pos: cab('ANCHOR_door').clone(), range: 2.6, label: () => (this.door.target ? 'Close the door' : 'Open the door'), action: () => { this.door.target = this.door.target ? 0 : 1; this.audio.door(); } });
    const rad = cab('ANCHOR_radio');
    this._add({ id: 'radio', pos: rad.clone(), range: 2.4, label: () => this._radioLabel(), action: () => this._useRadio() });
    const wood = cab('ANCHOR_wood');
    this._add({ id: 'cabin-wood', pos: wood.clone(), range: 2.6, label: () => (this.flags.cabinWood ? null : 'Take the firewood'), action: () => { this.flags.cabinWood = true; this._give('wood', 6); this.audio.pickup(); } });
    const sup = cab('ANCHOR_supplies');
    this._add({ id: 'supplies', pos: sup.clone(), range: 2.6, label: () => (this.flags.supplies ? null : 'Check the shelf'), action: () => { this.flags.supplies = true; this._give('beans', 2); this._give('bar', 2); this._give('matches', 4); this._give('cells', 1); this.audio.pickup(); } });
    const mk = cab('ANCHOR_medkit');
    this._add({ id: 'cabin-medkit', pos: mk.clone(), range: 2.6, label: () => (this.flags.cabinMed ? null : 'Take the first-aid kit'), action: () => { this.flags.cabinMed = true; this._give('medkit', 1); this.audio.pickup(); } });
    const bark = cab('ANCHOR_dryfire');
    this._add({ id: 'cabin-bark', pos: bark.clone(), range: 2.6, label: () => (this.flags.cabinBark ? null : 'Open the tinder box'), action: () => { this.flags.cabinBark = true; this._give('bark', 3); this._give('flare', 1); this.audio.pickup(); this.hud.subtitle('', 'Dry birch bark, and a spare flare. Someone thought of everything.', 4); } });
    this._add({ id: 'stove', pos: this.stove.pos.clone(), range: 2.4, label: () => (this.stove.lit ? (this.inv.has('wood') ? 'Add wood to the stove' : null) : this.inv.has('wood', 2) && this.inv.has('matches') ? 'Light the stove' : 'The stove is cold (needs 2 wood and a match)'), action: () => this._stove() });
    this._add({ id: 'bed', pos: cab('ANCHOR_bed').clone(), range: 2.6, label: () => 'Rest on the bed (hold R)', action: () => this.toast('Hold R to rest here.') });
    note('cabin', new V3(rad.x + 0.45, rad.y - 0.12, rad.z + 0.05));

    // -- landing zone: the laid signal fire
    const lz = S.lz;
    this._add({ id: 'signal', pos: new V3(lz.x, lz.y + 0.4, lz.z), range: 3.4, label: () => (this.signalFire.lit ? (this.inv.has('wood') ? 'Add wood to the signal fire' : null) : this.inv.has('matches') ? 'Light the signal fire' : 'The signal fire is laid, but you have no matches'), action: () => this._lightSignal() });

    // -- summit cache and register
    const pk = S.peak;
    this._add({ id: 'cache', pos: new V3(pk.x, pk.y + 0.6, pk.z), range: 3, label: () => (this.flags.cache ? null : 'Open the summit cache'), action: () => { this.flags.cache = true; this._give('medkit', 1); this._give('cells', 2); this._give('bar', 2); this.audio.pickup(); this.toast('A tin box left by hikers. Supplies!', 'good'); } });
    note('peak', new V3(pk.x + 0.9, pk.y + 0.02, pk.z + 0.5));

    // -- lakeshore note: walk east of the lake until the ground rises out of the water
    const L = g.world.lake;
    let lx = L.cx, lz2 = L.cz;
    for (let d = 40; d < 500; d += 3) { lx = L.cx + d; if (g.world.heightAt(lx, lz2) > g.world.lakeY + 0.9 && g.world.lakeE(lx, lz2) > 1.02) break; }
    note('lake', new V3(lx + 1.5, g.world.heightAt(lx + 1.5, lz2) + 0.03, lz2));
  }

  // Firewood bundles beside the trails, and berries on shrubs.
  _scatterPickups() {
    const g = this.g, w = g.world, C = this.content;
    let n = 0;
    const rnd = (s) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
    for (const line of Object.values(w.trails)) {
      for (let i = 20; i < line.length - 20; i += 38) {
        const p = line[i], a = line[i + 2], side = rnd(i + n) < 0.5 ? -1 : 1;
        let tx = a.x - p.x, tz = a.z - p.z; const l = Math.hypot(tx, tz) || 1;
        const off = 5 + rnd(i * 3 + n) * 9;
        const x = p.x - (tz / l) * off * side, z = p.z + (tx / l) * off * side;
        w.waterAt(x, z, _w);
        if (_w.depth > 0 || Math.abs(x) > 950 || Math.abs(z) > 950) continue;
        const nm = w.normalAt(x, z, { x: 0, y: 1, z: 0 });
        if (nm.y < 0.85) continue;
        n++;
        const obj = C.spawn('wood', x, z, { yaw: rnd(n) * 6, lift: 0.05, scale: 1.3 });
        const pos = new V3(x, w.heightAt(x, z) + 0.2, z);
        const it = this._add({ id: 'wood-' + n, pos, range: 2.4, obj, label: () => (it.taken ? null : 'Gather firewood'), action: () => { it.taken = true; obj.visible = false; this._give('wood', 2); this.audio.pickup(); } });
      }
    }
    // berries: a handful of bushes near water and meadows
    const fl = g.flora, berry = new THREE.MeshStandardMaterial({ color: 0x1d2a63, roughness: 0.35 });
    berry.color.multiplyScalar(1.6);
    const geo = new THREE.IcosahedronGeometry(0.035, 1);
    let bcount = 0;
    for (const it of fl.items) {
      if (bcount >= 22) break;
      if (it.kind !== 'shrub' || rnd(it.x * 3.1 + it.z) > 0.035) continue;
      w.waterAt(it.x, it.z, _w);
      if (_w.depth > 0) continue;
      const grp = new THREE.Group();
      for (let k = 0; k < 14; k++) {
        const m = new THREE.Mesh(geo, berry);
        const a = rnd(k + it.x) * 6.28, r = 0.25 + rnd(k * 2 + it.z) * 0.4 * it.scale;
        m.position.set(Math.cos(a) * r, 0.35 + rnd(k * 5 + it.x) * 0.5 * it.scale, Math.sin(a) * r);
        m.castShadow = false;
        grp.add(m);
      }
      grp.position.set(it.x, it.y, it.z);
      g.scene.add(grp);
      bcount++;
      const pos = new V3(it.x, it.y + 0.6, it.z);
      const b = this._add({ id: 'berry-' + bcount, pos, range: 2.4, label: () => (b.taken ? null : 'Pick berries'), action: () => { b.taken = true; grp.visible = false; this._give('berries', 2 + ((Math.random() * 2) | 0)); this.audio.pickup(); } });
    }
  }

  // ---------- UI wiring ----------
  _wireUi() {
    const g = this.g, hud = this.hud, on = (id, fn) => $(id).addEventListener('click', () => { this.audio.init(); this.audio.click(); fn(); });
    on('btn-new', () => this.newGame());
    on('btn-continue', () => this.continueGame());
    on('btn-controls', () => this._openInfo('controls', 'title-screen'));
    on('btn-settings', () => this._openInfo('settings', 'title-screen'));
    on('btn-resume', () => this.resume());
    on('btn-pause-settings', () => this._openInfo('settings', 'pause'));
    on('btn-pause-controls', () => this._openInfo('controls', 'pause'));
    on('btn-quit', () => { this._save(); this.showTitle(); });
    on('btn-settings-back', () => hud.screen(this.infoBack));
    on('btn-controls-back', () => hud.screen(this.infoBack));
    on('btn-note-close', () => { hud.screen(this.notePrev || null); if (!this.notePrev) this.resume(); });
    on('btn-respawn', () => this._respawn());
    on('btn-keep', () => this._keepExploring());
    on('btn-ending-title', () => this.showTitle());
    $('pack-water').addEventListener('click', () => this._drinkBottle());
    const bind = (id, key, out, fmt = (v) => v) => {
      const el = $(id);
      el.addEventListener('input', () => { const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value); this.settings[key] = v; if (out) $(out).textContent = fmt(v); this._applySettings(); });
    };
    bind('set-quality', 'quality'); bind('set-fov', 'fov', 'out-fov'); bind('set-sens', 'sens', 'out-sens', (v) => v.toFixed(1)); bind('set-vol', 'vol', 'out-vol', (v) => Math.round(v * 100));
    $('set-vol').addEventListener('input', () => { this.settings.vol = Number($('set-vol').value) / 100; $('out-vol').textContent = $('set-vol').value; this._applySettings(); });
    bind('set-music', 'music'); bind('set-voice', 'voice'); bind('set-invert', 'invert'); bind('set-hints', 'hints');
    const s = this.settings;
    $('set-quality').value = s.quality; $('set-fov').value = s.fov; $('out-fov').textContent = s.fov; $('set-sens').value = s.sens; $('out-sens').textContent = s.sens.toFixed(1);
    $('set-vol').value = Math.round(s.vol * 100); $('out-vol').textContent = Math.round(s.vol * 100); $('set-music').checked = s.music; $('set-voice').checked = s.voice; $('set-invert').checked = s.invert; $('set-hints').checked = s.hints;
    // touch buttons
    const hold = (id, fn) => { const b = $(id); const dn = (e) => { e.preventDefault(); fn(true); b.classList.add('on'); }; const up = () => { fn(false); b.classList.remove('on'); }; b.addEventListener('touchstart', dn, { passive: false }); b.addEventListener('touchend', up); b.addEventListener('touchcancel', up); b.addEventListener('mousedown', dn); b.addEventListener('mouseup', up); };
    hold('t-jump', (v) => (g.input.touch.jump = v)); hold('t-sprint', (v) => (g.input.touch.sprint = v)); hold('t-crouch', (v) => (g.input.touch.crouch = v));
    hold('t-use', (v) => { if (v) this._use(); }); hold('t-light', (v) => { if (v) this._toggleTorch(); }); hold('t-menu', (v) => { if (v) this.pause(); });
    if (store.get('save', null)) $('btn-continue').hidden = false;
  }

  _openInfo(name, back) { this.infoBack = back; this.hud.screen(name); }

  // ---------- flow ----------
  showTitle() {
    this.mode = 'title';
    this.g.paused = true;
    this.g.input.releaseLock();
    this.hud.showHud(false);
    this.hud.screen('title-screen');
    $('btn-continue').hidden = !store.get('save', null);
    this.g.atmo.setHour(17.9);
    this.weather.set({ cover: 0.34, overcast: 0.12, storm: 0, rain: 0, wind: 0.2, fog: 0 });
    this.fires.sources.forEach((f) => { if (f.kind === 'signal' || f.kind === 'camp' || f.kind === 'stove') f.lit = false; });
    this.heli.phase = 'idle'; this.heli.group.visible = false;
    this.g.player.frozen = true;
    this.hud.fade(0, 300);
  }

  _startCommon() {
    const g = this.g;
    this.audio.init();
    this.audio.setMusic(this.settings.music);
    this.hud.screen(null);
    this.hud.showHud(true);
    this.weather.auto();
    this.mode = 'play';
    g.paused = false;
    g.player.frozen = false;
    g.player.eyeOverride = null;
    g.input.requestLock();
  }

  newGame() {
    store.remove('save');
    const g = this.g;
    Object.assign(this, { objIndex: 0, flags: {}, pages: [], deaths: 0, steps: 0, playTime: 0, hintsSeen: new Set() });
    this.inv = new Inventory();
    this.water = newWater();
    this.survival.reset();
    this.fires.sources.filter((f) => f.kind === 'camp').forEach((f) => (f.lit = false));
    this.signalFire.lit = false; this.signalFire.fuel = 1500; this.signalFire.intensity = 0;
    this.stove.lit = false; this.lantern.lit = false;
    this.wreckFires.forEach((f) => { f.lit = true; f.size = f === this.wreckFires[0] ? 1.1 : 0.6; });
    g.atmo.setHour(TIME.startHour);
    this.weather.hoursSince = 0;
    // restore world pickups
    for (const it of this.interactables) { it.taken = false; if (it.obj) it.obj.visible = true; }
    this.content.lzWood.forEach((o) => (o.visible = true));
    const wk = this._anchor('wreck', 'ANCHOR_wake');
    const x = wk.x + 2.4, z = wk.z - 1.2;
    g.player.teleport(x, z);
    g.player.yaw = Math.atan2(-(wk.x - x), -(wk.z - z));
    g.player.pitch = 0.9;
    this.checkpoint = { x, z };
    this.startHour = TIME.startHour;
    this._startCommon();
    // waking up: on the ground, vision swimming back
    this.intro = 0;
    g.player.frozen = true;
    g.player.eyeOverride = 0.28;
    this.hud.fade(1, 0);
    setTimeout(() => this.hud.fade(0, 4200), 300);
    this.hud.subtitle('', 'Cold. Smoke. The engine is still ticking...', 5);
    this._objective(0, true);
  }

  continueGame() {
    const s = store.get('save', null);
    if (!s) return this.newGame();
    const g = this.g;
    this.objIndex = s.obj; this.flags = s.flags || {}; this.pages = s.pages || []; this.deaths = s.deaths || 0; this.steps = s.steps || 0; this.playTime = s.playTime || 0;
    this.hintsSeen = new Set(s.hints || []);
    this.inv.load(s.inv); this.water = s.water || newWater(); this.survival.load(s.vitals);
    g.atmo.setHour(s.hour);
    for (const it of this.interactables) { it.taken = !!(s.taken || []).includes(it.id); if (it.obj) it.obj.visible = !it.taken && !(it.id.startsWith('note-') && this.pages.includes(it.id.slice(5))); }
    this.map.load(s.fog);
    g.player.teleport(s.pos[0], s.pos[2]);
    g.player.pos.y = Math.max(g.player.pos.y, s.pos[1]);
    g.player.yaw = s.yaw;
    this.checkpoint = { x: s.pos[0], z: s.pos[2] };
    if (s.signal) this.fires.light(this.signalFire);
    if (s.stove) this.fires.light(this.stove);
    this._startCommon();
    this._objective(this.objIndex, true);
    this.hud.toast('Game loaded');
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.g.paused = true;
    this.hud.screen('pause');
    this.g.input.releaseLock();
    this.audio.pause(true);
  }

  resume() {
    this.audio.pause(false);
    this.hud.screen(null);
    this.mode = 'play';
    this.g.paused = false;
    this.g.input.requestLock();
  }

  _panel(name, fill) {
    if (this.mode === 'play') {
      this.mode = 'panel'; this.panel = name; this.g.paused = true;
      fill?.();
      this.hud.screen(name);
      this.g.input.releaseLock();
      this.audio.paper();
    } else if (this.mode === 'panel' && this.panel === name) this._closePanel();
  }
  _closePanel() { this.hud.screen(null); this.mode = 'play'; this.g.paused = false; this.g.input.requestLock(); this.panel = null; }

  // ---------- keys ----------
  _key(code, e) {
    if (this.mode === 'title' || this.mode === 'dead') return;
    if (code === 'Escape') { if (this.mode === 'play') this.pause(); else if (this.mode === 'panel') this._closePanel(); else if (this.mode === 'paused') this.resume(); return; }
    if (this.mode === 'panel') {
      const map = { Tab: 'panel-pack', KeyM: 'panel-map', KeyJ: 'panel-journal' };
      if (map[code] === this.panel) this._closePanel();
      return;
    }
    if (this.mode !== 'play') return;
    switch (code) {
      case 'KeyE': this._use(); break;
      case 'KeyQ': this._useSecondary(); break;
      case 'KeyF': this._toggleTorch(); break;
      case 'KeyG': this._buildFire(); break;
      case 'Tab': this._panel('panel-pack', () => this.hud.renderPack(this.inv, this.water, (id) => this._useItem(id))); break;
      case 'KeyM': if (!this.inv.flags.map && !this.flags.kit) { this.toast('You have no map yet.'); break; } this._panel('panel-map', () => this._renderMap()); break;
      case 'KeyJ': this._panel('panel-journal', () => this._renderJournal()); break;
      case 'KeyP': this._photo(); break;
    }
  }

  // ---------- inventory & items ----------
  _give(id, n = 1, quiet = false) {
    this.inv.add(id, n);
    if (!quiet) this.toast(`+${n > 1 ? n + ' ' : ''}${ITEMS[id].name}`, 'good');
  }

  toast(t, kind = '') { this.hud.toast(t, kind); }

  _useItem(id) {
    const s = this.survival;
    if (id === 'beans') { this.inv.remove(id); s.eat(38); this.audio.eat(); this.toast('Beans. Cold and glorious.', 'good'); }
    else if (id === 'bar') { this.inv.remove(id); s.eat(20); s.stamina = Math.min(100, s.stamina + 25); this.audio.eat(); }
    else if (id === 'berries') { this.inv.remove(id); s.eat(9, 5); this.audio.eat(); }
    else if (id === 'medkit') { this.inv.remove(id); s.heal(50); this.audio.paper(); this.toast('You patch yourself up.', 'good'); }
    else if (id === 'cells') { this.inv.remove(id); s.battery = 100; this.audio.click(); this.toast('Fresh cells in the flashlight.', 'good'); }
    else if (id === 'pills') { if (!this.inv.flags.bottle || this.water.amount < 0.05) return this.toast('You need water in your bottle first.'); this.inv.remove(id); this.water.clean = true; this.audio.click(); this.toast('The water is safe to drink now.', 'good'); }
    this.hud.renderPack(this.inv, this.water, (i) => this._useItem(i));
  }

  _drinkBottle() {
    if (!this.inv.flags.bottle || this.water.amount < 0.03) return this.toast('The bottle is empty.');
    const sip = Math.min(this.water.amount, 0.3);
    this.water.amount -= sip;
    this.survival.drink(sip * 110);
    this.audio.drink();
    if (!this.water.clean && Math.random() < 0.5) { this.survival.sick = 80; this.toast('That water did not agree with you...', 'bad'); }
    this.hud.renderPack(this.inv, this.water, (i) => this._useItem(i));
  }

  _toggleTorch() {
    if (!this.inv.flags.flashlight) return this.toast('You have no flashlight.');
    const s = this.survival;
    if (!s.torch && s.battery <= 0) { if (this.inv.has('cells')) this._useItem('cells'); else return this.toast('The flashlight is dead.', 'bad'); }
    s.torch = !s.torch;
    this.audio.torch();
  }

  _takeKit(obj) {
    this.flags.kit = true;
    obj.visible = false;
    this.inv.flags.flashlight = true; this.inv.flags.bottle = true; this.inv.flags.map = true;
    this.water.amount = 0.8; this.water.clean = true;
    this._give('matches', 4, true); this._give('bar', 2, true); this._give('medkit', 1, true); this._give('flare', 2, true); this._give('radio', 1, true); this._give('cells', 1, true); this._give('pills', 2, true); this._give('map', 1, true);
    this.audio.pickup();
    this.toast('Survival kit: flashlight, water bottle, matches, first aid, two flares, chart, radio.', 'good');
    this.hud.subtitle('', 'Radio is cracked and dead. The valley is huge. But there is a lookout tower on the ridge, that is where I start.', 6);
    this._complete('kit');
  }

  _takeAntenna(obj) {
    this.flags.antenna = true; obj.visible = false;
    this._give('antenna', 1); this.audio.pickup();
    this._readNote('tower', true);
    this._complete('tower');
    setTimeout(() => this._say(RADIO.advisory, 1), 2500);
  }

  _takeBattery(obj) {
    this.flags.battery = true; obj.visible = false;
    this._give('battery', 1); this.audio.pickup();
    this._complete('battery');
  }

  _stove() {
    const s = this.stove;
    if (s.lit) { if (this.inv.remove('wood')) { this.fires.feed(s, 120); this.audio.pickup(); } return; }
    if (!this.inv.has('wood', 2) || !this.inv.has('matches')) return this.toast('You need 2 firewood and a match.');
    this.inv.remove('wood', 2); this.inv.remove('matches');
    this.audio.match();
    setTimeout(() => { this.fires.light(s); this.fires.feed(s, 400); this.audio.ignite(); this.toast('The stove roars to life.', 'good'); }, 500);
  }

  // ---------- fire ----------
  _fireChance(tinder, sheltered) {
    const w = this.g.atmo.weather;
    let p = 0.95 - w.rain * 0.55 - w.wind * 0.12 + (tinder ? 0.35 : 0) + (sheltered ? 0.4 : 0);
    return clamp(p, 0.08, 0.99);
  }

  _buildFire() {
    const g = this.g, p = g.player;
    if (this.inv.count('wood') < 3) return this.toast('A fire needs 3 firewood.');
    if (!this.inv.has('matches')) return this.toast('You have no matches.', 'bad');
    if (p.swimming || p.wading > 0.2) return this.toast('Not in the water.');
    if (this.fires.nearestLit(p.pos, 3)) return this.toast('There is already a fire here.');
    if (this.sheltered) return this.toast('Not indoors. Use the stove.');
    this.inv.remove('wood', 3); this.inv.remove('matches');
    _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const x = p.pos.x + _fwd.x * 1.4, z = p.pos.z + _fwd.z * 1.4;
    this.audio.match();
    const tinder = this.inv.has('bark') && this.inv.remove('bark');
    const ok = Math.random() < this._fireChance(tinder, false);
    setTimeout(() => {
      if (!ok) { this.audio.fizzle(); return this.toast('The match sputters out. Too wet. Birch bark would help, or shelter.', 'bad'); }
      const f = this.fires.add('camp', x, g.world.heightAt(x, z) + 0.05, z, { fuel: 260, size: 1 });
      this.fires.light(f); this.audio.ignite();
      this.toast('Fire lit. Warmth at last.', 'good');
      this._hint('rest');
    }, 600);
  }

  _lightSignal() {
    const f = this.signalFire, g = this.g;
    if (f.lit) { if (this.inv.remove('wood')) { this.fires.feed(f, 100); this.audio.pickup(); } return; }
    if (!this.inv.has('matches')) return this.toast('You have no matches.', 'bad');
    this.inv.remove('matches');
    this.audio.match();
    const tinder = this.inv.has('bark') && this.inv.remove('bark');
    const ok = Math.random() < this._fireChance(tinder, true) + 0.05;
    setTimeout(() => {
      if (!ok) { this.audio.fizzle(); return this.toast('It will not catch in this rain. Try birch bark as tinder.', 'bad'); }
      this.fires.light(f); this.audio.ignite();
      this.content.lzWood.forEach((o) => (o.visible = false));
      this.toast('The signal fire blazes up.', 'good');
      this.heli.signal(90);
      this._complete('fire');
    }, 700);
  }

  // ---------- water ----------
  _waterAhead() {
    const p = this.g.player, w = this.g.world;
    for (let d = 0.6; d <= 2.6; d += 0.5) {
      const x = p.pos.x - Math.sin(p.yaw) * d, z = p.pos.z - Math.cos(p.yaw) * d;
      w.waterAt(x, z, _w);
      if (_w.depth > 0.12) return { body: _w.body };
    }
    w.waterAt(p.pos.x, p.pos.z, _w);
    return _w.depth > 0.12 ? { body: _w.body } : null;
  }

  _drinkFrom(body) {
    const risk = body === 'lake' ? 0.5 : 0.22;
    this.survival.drink(32);
    this.audio.drink();
    if (Math.random() < risk) { this.survival.sick = 80; this.toast('The water tastes of mud... you may regret that.', 'bad'); }
  }

  _fillBottle() {
    if (!this.inv.flags.bottle) return this.toast('You have no bottle.');
    this.water.amount = 1; this.water.clean = false;
    this.audio.drink();
    this.toast('Bottle filled (untreated). Boil it or use a tablet.', 'good');
  }

  // ---------- interaction ----------
  _findInteractable() {
    const cam = this.g.camera;
    cam.getWorldDirection(_fwd);
    let best = null, bs = -1;
    for (const it of this.interactables) {
      const d = it.pos.distanceTo(cam.position);
      if (d > it.range + 0.3) continue;
      const label = it.label();
      if (!label) continue;
      _tmp.copy(it.pos).sub(cam.position).normalize();
      const dot = _fwd.dot(_tmp);
      if (dot < 0.6 && d > 1.2) continue;
      const score = dot * 2 - d * 0.25;
      if (score > bs) { bs = score; best = { it, label }; }
    }
    return best;
  }

  _use() {
    if (this.mode !== 'play') return;
    if (this.holdAction) return;
    const cur = this.current;
    if (cur?.kind === 'water') { this.holding = 0; this.holdAction = { t: 0, len: 2.1, done: () => this._drinkFrom(cur.body), label: 'drink' }; return; }
    if (cur?.kind === 'fire') { return this._fireUse(cur.fire); }
    if (cur?.kind === 'heli') return this._board();
    if (cur?.it) { this.audio.click(); cur.it.action(); }
  }

  _useSecondary() {
    const cur = this.current;
    if (cur?.kind === 'water') this._fillBottle();
    else if (cur?.kind === 'fire' && this.inv.flags.bottle && !this.water.clean && this.water.amount > 0.05) {
      this.holdAction = { t: 0, len: 4, done: () => { this.water.clean = true; this.toast('Boiled. Safe to drink.', 'good'); }, label: 'boil' };
    }
  }

  _fireUse(f) {
    if (this.inv.remove('wood')) { this.fires.feed(f, 90); this.audio.pickup(); this.toast('Fire fed.'); }
    else this.toast('You have no firewood.');
  }

  // ---------- notes & story ----------
  _readNote(id, quiet) {
    const n = NOTES[id];
    if (!this.pages.includes(id)) { this.pages.push(id); this.toast(`Journal: ${n.title}`, 'good'); }
    this.audio.paper();
    if (quiet) return;
    this.notePrev = null;
    this.hud.note({ title: n.title, body: n.body });
    this.mode = 'panel'; this.panel = 'panel-note'; this.g.paused = true;
    this.hud.screen('panel-note');
    this.g.input.releaseLock();
    this._noteClose = true;
  }

  _renderJournal() {
    const tasks = OBJECTIVES.map((o, i) => ({ text: o.text, state: i < this.objIndex ? 'done' : i === this.objIndex ? 'now' : '' }));
    tasks.push({ text: `Find the notes scattered around the valley (${this.pages.length}/${Object.keys(NOTES).length})`, state: this.pages.length === Object.keys(NOTES).length ? 'done' : '' });
    tasks.push({ text: 'Reach Kestrel Point, the summit.', state: this.flags.cache ? 'done' : '' });
    this.hud.renderJournal(tasks, this.pages.map((id) => NOTES[id]), (pg) => { this.notePrev = 'panel-journal'; this.hud.note(pg); this.hud.screen('panel-note'); });
  }

  _renderMap() {
    const g = this.g, S = g.world.sites, p = g.player;
    const marks = [{ x: S.wreck.x, z: S.wreck.z, label: 'Crash site' }];
    if (this.inv.flags.map) marks.push({ x: S.tower.x, z: S.tower.z, label: 'Ridgeback Lookout' }, { x: S.cabin.x, z: S.cabin.z, label: 'Ranger Cabin' });
    if (this.flags.antenna || this.pages.includes('tower')) marks.push({ x: S.mine.x, z: S.mine.z, label: 'Halloran Mine' });
    if (this.pages.includes('camp') || this.objIndex >= 2) marks.push({ x: S.camp.x, z: S.camp.z, label: 'Creekside Camp' });
    if (this.objIndex >= 3) marks.push({ x: S.lz.x, z: S.lz.z, label: 'Sunday Meadow' });
    if (this.pages.includes('bridge') || this.objIndex >= 3) marks.push({ x: S.bridge.x, z: S.bridge.z, label: 'Bridge' });
    const t = this._objTarget();
    if (t) marks.push({ x: t.x, z: t.z, kind: 'objective', label: '' });
    this.map.reveal(p.pos.x, p.pos.z, 90);
    this.map.render($('map-canvas'), { x: p.pos.x, z: p.pos.z, yaw: p.yaw }, marks);
  }

  _objTarget() {
    const S = this.g.world.sites, o = OBJECTIVES[this.objIndex];
    if (!o) return null;
    if (o.target === 'wreck') { const a = this._anchor('wreck', 'ANCHOR_backpack'); return a; }
    if (o.target === 'tower') return this._anchor('tower', 'ANCHOR_tower_deck') || S.tower;
    if (o.target === 'cabin') return this._anchor('cabin', 'ANCHOR_radio') || S.cabin;
    return S[o.target];
  }

  _objective(i, silent) {
    this.objIndex = i;
    const o = OBJECTIVES[i];
    if (!o) return;
    this.hud.objective(o.text, null);
    if (!silent) this.toast('New objective', 'good');
  }

  _complete(id) {
    const i = OBJECTIVES.findIndex((o) => o.id === id);
    if (i !== this.objIndex) return;
    this.toast('Objective complete', 'good');
    this._objective(i + 1);
    this.checkpoint = { x: this.g.player.pos.x, z: this.g.player.pos.z };
    this._save();
  }

  _radioLabel() {
    if (this.flags.called) return 'The radio crackles softly';
    if (!this.inv.has('battery') || !this.inv.has('antenna')) return `Radio: ${!this.inv.has('battery') ? 'needs a battery' : ''}${!this.inv.has('battery') && !this.inv.has('antenna') ? ' and ' : ''}${!this.inv.has('antenna') ? 'needs an antenna' : ''}`;
    return 'Connect the battery and antenna, then call for help';
  }

  _useRadio() {
    if (this.flags.called || !this.inv.has('battery') || !this.inv.has('antenna')) return;
    this.flags.called = true;
    this.inv.remove('battery'); this.inv.remove('antenna');
    this.audio.radioOn(); this.audio.static_(3);
    setTimeout(() => this.audio.beeps(3), 1200);
    setTimeout(() => this._say(RADIO.call, 1, () => {
      this._complete('radio');
      this.heliAt = Math.max(22.5, this.g.atmo.hour + 1.5);
      this.hud.hint('The helicopter is due around 22:30. Rest by the stove, then get to the meadow with a fire.', 9);
    }), 2600);
  }

  // Plays a scripted exchange with subtitles (and, if enabled, a synthetic radio voice).
  _say(lines, speed = 1, done) {
    let t = 0;
    lines.forEach(([who, text], i) => {
      const len = Math.max(3, text.length * 0.065) / speed;
      setTimeout(() => {
        this.hud.subtitle(who, text, len + 0.6);
        if (who !== 'You') this.audio.radioOn();
        this._speak(who, text);
      }, t * 1000);
      t += len + 0.9;
    });
    if (done) setTimeout(done, t * 1000);
  }

  _speak(who, text) {
    if (!this.speech || !this.settings.voice || this.audio.muted) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[.]{3}/g, ','));
      u.rate = 1.02; u.pitch = who === 'You' ? 0.9 : who === 'Dispatch' ? 1.05 : 0.75; u.volume = 0.7;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  }

  _hint(key) {
    if (this.hintsSeen.has(key)) return;
    this.hintsSeen.add(key);
    this.hud.hint(HINTS[key], 7);
  }

  _discover() { /* placeholder for future discoveries */ }

  // ---------- helicopter & ending ----------
  _heliPhase(p) {
    if (p === 'approach') this.hud.subtitle('', 'Is that... rotors? Somewhere out there in the storm?', 5);
    if (p === 'search') this.hud.hint('Light the signal fire, or fire a flare from your backpack!', 8);
    if (p === 'descend') { this._say(this.flags.flareSeen ? RADIO.heliFlare : RADIO.heliClose, 1); this._complete('fire'); }
    if (p === 'landed') { this.hud.toast('The helicopter has landed. Get aboard!', 'good'); this.audio.mood = 'triumph'; }
    if (p === 'gone') this.hud.toast('The helicopter gave up and left. Try again soon.', 'bad');
  }

  _fireFlare() {
    if (!this.inv.remove('flare')) return;
    const g = this.g;
    _fwd.set(-Math.sin(g.player.yaw), 0.3, -Math.cos(g.player.yaw)).normalize();
    this.fires.fireFlare(g.camera.position.clone().add(_fwd.clone().multiplyScalar(0.8)), _fwd);
    this.audio.flare();
    this.flags.flareSeen = true;
    this.heli.signal(150);
    if (this.objIndex < 5) this.flags.flareEarly = true;
    this.toast('Flare fired!', 'good');
  }

  _board() {
    if (this.mode !== 'play') return;
    this.mode = 'ending';
    this.g.player.frozen = true;
    this.hud.fade(1, 1500);
    this.audio.mood = 'triumph';
    setTimeout(() => this._ending(), 1600);
  }

  _ending() {
    const g = this.g;
    this.hud.showHud(false);
    this.heli.liftOff();
    this.weather.auto();
    g.atmo.setHour(6.1);
    for (const f of this.fires.sources) if (f.kind === 'wreck') f.lit = false;
    // fly a slow arc over the valley from the helicopter's door
    this.endT = 0;
    this.hud.fade(0, 2500);
    this.hud.subtitle('', 'You watch the lake go by below, silver in the dawn. The storm is over. The valley is quiet.', 8);
    setTimeout(() => this.hud.subtitle('Kestrel Two', 'Base, one survivor on board. Cold, tired... and smiling. Heading home.', 8), 9000);
    setTimeout(() => this._showEnding(), 22000);
  }

  _showEnding() {
    const mins = Math.round((this.playTime / TIME.secondsPerMinute));
    const stats = [['Time in the valley', `${Math.floor(this.playTime / 60)} min ${Math.round(this.playTime % 60)} s`], ['Notes found', `${this.pages.length} / ${Object.keys(NOTES).length}`], ['Steps taken', this.steps.toLocaleString()], ['Times you did not make it', String(this.deaths)]];
    $('ending-text').textContent = 'Hours later, in a warm blanket, you finally let yourself breathe. The signal got through. One radio, one flare, one very long night.';
    $('ending-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    this.hud.subtitle('', '', 0);
    this.hud.screen('ending');
    this.g.input.releaseLock();
    this.mode = 'ended';
    store.remove('save');
  }

  _keepExploring() {
    const g = this.g;
    this.hud.screen(null); this.hud.showHud(true);
    this.mode = 'play'; g.paused = false; g.player.frozen = false;
    const S = g.world.sites;
    g.player.teleport(S.lz.x + 6, S.lz.z);
    this.heli.phase = 'idle'; this.heli.group.visible = false;
    this.hud.objective('Free roam: the valley is yours. Kestrel Point and the last notes are waiting.', null);
    this.objIndex = OBJECTIVES.length;
    g.input.requestLock();
  }

  // ---------- death ----------
  _die(cause) {
    if (this.mode !== 'play') return;
    this.mode = 'dead';
    this.deaths++;
    this.g.paused = true;
    this.g.input.releaseLock();
    $('death-text').textContent = cause;
    this.hud.fade(1, 900);
    setTimeout(() => this.hud.screen('death'), 1000);
  }

  _respawn() {
    const g = this.g, s = this.survival, c = this.checkpoint || { x: g.world.sites.wreck.x, z: g.world.sites.wreck.z };
    s.reset(); s.health = 70; s.hunger = Math.max(40, s.hunger); s.thirst = 60; s.warmth = 70;
    g.atmo.setHour(g.atmo.hour + 0.2);
    g.player.teleport(c.x, c.z);
    g.player.frozen = false;
    this.hud.damage(0);
    this.hud.screen(null); this.mode = 'play'; g.paused = false;
    this.hud.fade(0, 1500);
    this.audio.init();
    g.input.requestLock();
    this.toast('You wake with a pounding head, back where you last rested.', 'bad');
  }

  // ---------- save ----------
  _save() {
    if (this.mode === 'title' || this.mode === 'ended') return;
    const g = this.g, p = g.player;
    store.set('save', {
      obj: this.objIndex, flags: this.flags, pages: this.pages, deaths: this.deaths, steps: this.steps, playTime: this.playTime,
      inv: this.inv.toJSON(), water: this.water, vitals: this.survival.save(), hour: g.atmo.hour, pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw,
      taken: this.interactables.filter((i) => i.taken || (i.obj && !i.obj.visible)).map((i) => i.id), fog: this.map.toJSON(),
      signal: this.signalFire.lit, stove: this.stove.lit, hints: [...this.hintsSeen],
    });
  }

  _photo() {
    const hidden = !this.g.hud || document.body.classList.toggle('photo');
    this.hud.showHud(!document.body.classList.contains('photo'));
    if (document.body.classList.contains('photo')) this.hud.hint('Photo mode: press P to return, click to save an image.', 4);
  }

  // ---------- per-frame ----------
  update(dt) {
    const g = this.g;
    if (this.mode === 'title') return this._titleCamera(dt);
    // the sky and audio keep going in menus (audio only when running)
    if (this.mode === 'paused' || this.mode === 'panel' || this.mode === 'dead' || this.mode === 'ended') { this.hud.update(dt); return; }
    const p = g.player, s = this.survival, atmo = g.atmo;
    const resting = this.mode === 'play' && g.input.has('KeyR') && this._canRest();
    g.clockSpeed = resting ? 26 : 1;
    const gdt = dt * g.clockSpeed;
    if (this.mode === 'play') this.playTime += dt;

    // intro: rise from the ground
    if (this.intro !== undefined && this.intro < 6 && this.mode === 'play') {
      this.intro += dt;
      const k = smoothstep(1.5, 5.8, this.intro);
      p.eyeOverride = lerp(0.28, 1.62, k);
      p.pitch = lerp(0.9, 0, k);
      if (this.intro >= 5.8) { p.eyeOverride = null; p.frozen = false; this.intro = 99; this._hint('move'); setTimeout(() => this._hint('interact'), 7000); }
    }

    // shelter: under a roof (cabin, mine shed, tent) or up in the tower cab
    this.sheltered = this._isSheltered();
    p.sheltered = this.sheltered;

    // fires, weather, heat
    const w = atmo.weather;
    this.weather.update(dt, g.camera, atmo.hour, p);
    ATMO_wind.set(this);
    const heat = this.fires.heatAt(p.pos);
    for (const f of this.fires.sources) if (f.kind !== 'wreck' && f.lit && g.clockSpeed > 1) f.fuel -= dt * (g.clockSpeed - 1);
    this.fires.update(dt, g.camera, innerHeight * g.renderer.getPixelRatio(), atmo.day, ATMO_windVec, w.rain);
    // wreck fires die down after a while
    const since = ((atmo.hour - TIME.startHour + 24) % 24);
    if (since > 0.5 && since < 20) this.wreckFires.forEach((f, i) => { if (f.lit) f.size = Math.max(0.15, (i ? 0.6 : 1.1) * (1 - (since - 0.5) / 2.2)); if (since > 3) f.lit = false; });
    // the cabin lantern is lit after dark
    if (atmo.night > 0.2 || w.storm > 0.3) this.lantern.lit = true; else this.lantern.lit = false;

    // survival
    if (this.mode === 'play') {
      s.update({ dt, gameDt: gdt, player: p, hour: atmo.hour, weather: w, heat, sheltered: this.sheltered ? 1 : 0, jacket: this.inv.flags.jacket, resting });
      this._effects(dt);
    }
    this.torch.intensity = s.torch ? 85 * clamp(0.25 + s.battery / 40, 0.3, 1) * (s.battery < 10 ? 0.6 + 0.4 * Math.sin(g.time * 40) : 1) : 0;

    // interactions
    if (this.mode === 'play' && !p.frozen) this._interaction(dt);
    if (this.zoom) { g.camera.fov = damp(g.camera.fov, 26, 8, dt); g.camera.updateProjectionMatrix(); if (p.moving) this.zoom = 0; }

    // door animation, windsock, map, heli
    if (this.door) { this.door.open = damp(this.door.open, this.door.target, 4, dt); if (this.door.obj) this.door.obj.rotation.y = this.door.open * 1.8; }
    if (this.content.windsock) { const a = Math.atan2(-ATMO_windVec.x, -ATMO_windVec.y); this.content.windsock.rotation.y = damp(this.content.windsock.rotation.y, a, 2, dt); }
    this.map.update(p.pos.x, p.pos.y, p.pos.z);
    if (this.heliAt !== undefined && atmo.hour >= this.heliAt && this.heli.phase === 'idle') this.heli.start();
    this.heli.update(dt, w.storm);

    // hud
    this._hud(dt, resting);
    // audio
    this._audio(dt);
    // autosave
    if ((this.saveTimer += dt) > 60 && this.mode === 'play') { this.saveTimer = 0; this._save(); }
    if (this.mode === 'ending') this._endingCamera(dt);
  }

  _canRest() {
    const p = this.g.player;
    return this.sheltered || !!this.fires.nearestLit(p.pos, 5) || p.pos.distanceTo(this.campPitPos) < 6;
  }

  _isSheltered() {
    const p = this.g.player.pos, st = this.g.structures;
    for (const id of ['cabin', 'mine']) {
      const s = st.placed[id];
      if (!s) continue;
      const box = st.colliders.find((c) => c.id === id && (c.name === 'floor' || c.name === 'back'));
      if (!box) continue;
      if (id === 'cabin') { const dx = p.x - box.x, dz = p.z - box.z; const lx = dx * box.cos - dz * box.sin, lz = dx * box.sin + dz * box.cos; if (Math.abs(lx) < box.hx - 0.1 && Math.abs(lz) < box.hz - 0.1 && p.y < box.y1 + 2.5) return true; }
    }
    const tent = this.g.structures.anchors.camp?.ANCHOR_tent?.pos;
    if (tent && Math.hypot(p.x - tent.x, p.z - tent.z) < 1.0) return true;
    const t = this._anchor('tower', 'ANCHOR_tower_deck');
    if (t && Math.hypot(p.x - t.x, p.z - t.z) < 1.5 && p.y > t.y - 0.3) return true;
    return false;
  }

  _effects(dt) {
    const s = this.survival, post = this.g.post.u;
    this._damageFlash = Math.max(0, (this._damageFlash || 0) - dt * 1.4);
    const low = s.health < 30 ? 0.3 * (1 - s.health / 30) : 0;
    this.hud.damage(Math.max(this._damageFlash, low));
    post.uCold.value = damp(post.uCold.value, s.shiver, 2, dt);
    post.uUnderwater.value = this.g.player.underwater;
    post.uFlash.value = this.weather.flash * 0.12;
    // shivering shakes the camera a little
    if (s.shiver > 0.15) { const t = this.g.time * 22; this.g.player.kick.x += Math.sin(t) * 0.0009 * s.shiver; this.g.player.kick.y += Math.cos(t * 1.3) * 0.0007 * s.shiver; }
    if (s.warmth < 50) this._hint('cold');
    if (s.wet > 0.6) this._hint('wet');
    if (s.thirst < 30) this._hint('thirst');
    if (s.hunger < 30) this._hint('hunger');
    if (this.g.atmo.night > 0.3) { this._hint('night'); if (this.inv.flags.flashlight) this._hint('torch'); }
    if (s.torch && s.battery < 12) { if (!this._lowBat) { this._lowBat = true; this.toast('Flashlight battery is low.', 'bad'); } } else this._lowBat = false;
  }

  _interaction(dt) {
    const p = this.g.player;
    let cur = null;
    const found = this._findInteractable();
    if (found) cur = { it: found.it, label: found.label, key: 'E' };
    // water and fires, when nothing more specific is close
    if (!cur) {
      const f = this.fires.nearestLit(p.pos, 2.6, ['camp']);
      if (f) cur = { kind: 'fire', fire: f, label: this.inv.has('wood') ? 'Feed the fire' : (this.inv.flags.bottle && !this.water.clean && this.water.amount > 0.05 ? 'Boil water (Q)' : null) };
      else {
        const wa = this._waterAhead();
        if (wa && !p.swimming) cur = { kind: 'water', body: wa.body, label: wa.body === 'lake' ? 'Drink from the lake (Q to fill bottle)' : 'Drink from the creek (Q to fill bottle)' };
      }
      if (!cur && this.heli.phase === 'landed' && this.heli.doorPos.distanceTo(this.g.camera.position) < 6) cur = { kind: 'heli', label: 'Board the helicopter' };
    }
    this.current = cur && cur.label ? cur : null;
    // holding an action (drink, boil)
    if (this.holdAction) {
      const held = this.g.input.has('KeyE', 'KeyQ');
      if (!held || !this.current) { this.holdAction = null; this.hud.holdProgress(0); }
      else {
        this.holdAction.t += dt;
        this.hud.holdProgress(this.holdAction.t / this.holdAction.len);
        if (this.holdAction.t >= this.holdAction.len) { const d = this.holdAction.done; this.holdAction = null; this.hud.holdProgress(0); d(); }
      }
    }
    if (this.current) this.hud.prompt(this.current.kind === 'water' ? 'E' : 'E', this.current.label);
    else this.hud.prompt('', null);
    // fire key on hold-less action
    if (!this.holdAction) this.hud.holdProgress(0);
    if (this.current && this.current.kind === 'water' && this.g.input.has('KeyE') && !this.holdAction) this._use();
  }

  _hud(dt, resting) {
    const g = this.g, hud = this.hud, p = g.player, s = this.survival;
    hud.update(dt);
    hud.setVitals({ health: s.health, stamina: s.stamina, hunger: s.hunger, thirst: s.thirst, warmth: s.warmth, wet: s.wet, sick: s.sick, exhausted: s.exhausted, injured: s.injured });
    hud.clock(g.atmo.hour, s.ambient);
    const t = this._objTarget();
    const markers = [];
    if (t) {
      const dx = t.x - p.pos.x, dz = t.z - p.pos.z;
      markers.push({ bearing: Math.atan2(dx, -dz), color: '#ff6a2b' });
      hud.objective(OBJECTIVES[this.objIndex]?.text || '', Math.hypot(dx, dz));
    }
    hud.compass(-p.yaw, markers);
    if (resting) hud.subtitle('', 'Resting...', 0.2);
  }

  _audio(dt) {
    const g = this.g, a = this.audio, p = g.player, w = g.atmo.weather, world = g.world;
    const i = Math.max(0, Math.min(world.v - 1, Math.round((p.pos.x + world.half) / world.cell))), j = Math.max(0, Math.min(world.v - 1, Math.round((p.pos.z + world.half) / world.cell)));
    const rd = world.riverDist[j * world.v + i];
    const creek = clamp(1 - Math.max(0, rd - 4) / 45, 0, 1);
    const le = world.lakeE(p.pos.x, p.pos.z);
    const lake = clamp(1 - (le - 1) / 0.6, 0, 1);
    const fire = this.fires.nearestLit(p.pos, 30, ['camp', 'stove', 'signal', 'wreck']);
    const fireVol = fire ? clamp(1 - fire.pos.distanceTo(p.pos) / 30, 0, 1) * fire.intensity : 0;
    g.camera.getWorldDirection(_fwd);
    const heliOn = this.heli.phase !== 'idle' && this.heli.phase !== 'gone' && this.heli.group.visible;
    const hd = heliOn ? this.heli.pos.distanceTo(p.pos) : 9999;
    a.mood = this.mood || (this.survival.health < 35 ? 'danger' : 'calm');
    a.update({
      dt, wind: w.wind, rain: w.rain, storm: w.storm, indoor: this.sheltered ? 1 : 0, creek, lake, fireVol, night: g.atmo.night, day: g.atmo.day,
      underwater: p.underwater, stamina: this.survival.stamina, health: this.survival.health, wolves: this.objIndex >= 2,
      heli: { on: heliOn, pos: this.heli.pos, vol: clamp(1.4 - hd / 1400, 0, 1) * 0.9, load: this.heli.phase === 'landed' ? 0 : 1 },
      camera: { pos: g.camera.position, fwd: _fwd },
    });
  }

  _titleCamera(dt) {
    const g = this.g, w = g.world, c = g.camera;
    this.titleAngle += dt * 0.03;
    const L = w.lake, r = 330;
    const a = this.titleAngle + 2.2;
    const x = L.cx + Math.cos(a) * r, z = L.cz + Math.sin(a) * r * 0.8;
    c.position.set(x, Math.max(w.heightAt(x, z) + 22, w.lakeY + 26), z);
    c.lookAt(L.cx + Math.cos(a + 0.9) * 60, w.lakeY + 24, L.cz + Math.sin(a + 0.9) * 60);
    c.fov = 60; c.updateProjectionMatrix();
    this.weather.update(dt, c, 17.9, { sheltered: false });
    this.fires.update(dt, c, innerHeight, g.atmo.day, ATMO_windVec, 0);
  }

  _endingCamera(dt) {
    const g = this.g, h = this.heli;
    this.endT = (this.endT || 0) + dt;
    const door = h.doorPos;
    g.camera.position.copy(door).add(new V3(0, 0.3, 0));
    const yaw = h.group.rotation.y;
    g.camera.rotation.set(-0.25 + Math.sin(this.endT * 0.4) * 0.05, yaw - 1.5 + Math.sin(this.endT * 0.3) * 0.25, 0, 'YXZ');
    g.camera.fov = 62; g.camera.updateProjectionMatrix();
  }
}

// The wind direction the fire and windsock code uses, kept in one place.
const ATMO_windVec = new THREE.Vector2(0.6, 0.2);
const ATMO_wind = { set(play) { const w = play.g.atmo.weather; ATMO_windVec.set(0.86, 0.5).multiplyScalar(0.4 + 2.6 * w.wind); } };
