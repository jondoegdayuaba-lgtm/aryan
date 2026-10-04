// Outlaw Frontier: an open-world western. Everything you see was modelled,
// rigged and animated in Blender (see blender/), then loaded here.
import * as THREE from 'three';
import { loadAssets, meshParts } from './assets.js';
import { Terrain, Environment, Grass, buildRiver } from './env.js';
import { Collision } from './collision.js';
import { World } from './world.js';
import { CharacterFactory } from './character.js';
import { Horse } from './animals.js';
import { Player, CameraRig } from './player.js';
import { NPC } from './npc.js';
import { Combat } from './combat.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Menu } from './menu.js';
import { Missions } from './missions.js';
import { QUALITY, CAMERA } from './config.js';
import { store, damp, clamp, rng } from './util.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'outlaw-frontier-save';
const SETTINGS_KEY = 'outlaw-frontier-settings';

class Events {
  constructor() { this.map = {}; }
  on(name, fn) { (this.map[name] ||= []).push(fn); }
  emit(name, ...args) { for (const fn of this.map[name] || []) fn(...args); }
}

class Game {
  constructor() {
    this.canvas = $('game');
    const touch = matchMedia('(pointer: coarse)').matches;
    this.settings = {
      quality: touch ? 'low' : 'medium', sensitivity: 1, fov: CAMERA.fov, volume: 0.8, invert: false,
      ...store.get(SETTINGS_KEY, {}),
    };
    this.quality = QUALITY[this.settings.quality] || QUALITY.medium;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, this.quality.pixelRatio));
    r.setSize(innerWidth, innerHeight, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.25, this.quality.far);
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invert = this.settings.invert;
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.events = new Events();
    this.state = 'loading';
    this.time = 0;
    this.lockControls = false;
    this.npcs = [];
    this.animals = [];
    this.money = 0;
    this.pelts = 0;
    this.stats = { kills: 0, headshots: 0, shots: 0, hits: 0, hunted: 0, ridden: 0, walked: 0, deaths: 0, days: 0 };
    this.focus = new THREE.Vector3();
    this.lodTimer = 0;
    this.saveTimer = 0;
    addEventListener('resize', () => this.resize());
  }

  async init() {
    const fill = $('ld-fill');
    const text = $('ld-text');
    const assets = (this.assets = await loadAssets((f, label) => {
      fill.style.width = `${Math.round(f * 100)}%`;
      text.textContent = label + '…';
    }));
    text.textContent = 'Building the valley…';
    await new Promise((res) => setTimeout(res, 30));
    this.terrain = new Terrain(assets.world, assets.terrain);
    this.terrain.build(this.scene, assets.tex);
    this.collision = new Collision(this.terrain);
    this.world = new World(this.scene, assets, this.terrain, this.collision);
    this.river = buildRiver(this.scene, this.terrain);
    this.env = new Environment(this.scene, this.renderer, this.quality);
    const props = assets.props.scene;
    this.grass = new Grass(this.scene, this.terrain, ['Grass1', 'Grass2', 'Grass3'].map((n) => meshParts(props.getObjectByName(n))), this.quality.grass);
    this.world.lodDist = this.quality.treeLod;
    this.effects = new Effects(this.scene);
    this.chars = new CharacterFactory(assets.cowboy);
    this.camRig = new CameraRig(this.camera, this.collision);
    this.camRig.baseFov = this.settings.fov;
    this.combat = new Combat(this);
    this.hud = new HUD(this);
    this.menu = new Menu(this);
    for (const c of this.world.campfires || []) {
      this.effects.addFire(new THREE.Vector3(c.x, c.y + 0.1, c.z), 0.42, { smoke: true, spread: 0.25 });
    }
    this.player = new Player(this);
    this.horse = new Horse(assets.horse, '#2a1c14', 'Biscuit');
    this.scene.add(this.horse.root);
    this.populate();
    const save = store.get(SAVE_KEY, null);
    this.missions = new Missions(this, save);
    this.missions.spawnGivers();
    this.loadSave(save);
    this.respawnAtCamp();
    this.player.char.setWeapon(null);
    this.events.on('npcKilled', (n) => {
      if (n.role === 'civilian') this.hud.toast('A bystander was killed.', 'Careful');
    });
    this.input.onUnlock = () => {
      if (this.state === 'playing' && !this.player.dead) this.pause();
    };
    this.bindKeys();
    this.resize();
    // Warm up shaders and the first frame before revealing
    this.env.hour = 17.9;
    this.titleCam(0);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    $('loading').classList.add('done');
    setTimeout(() => { $('loading').hidden = true; }, 900);
    this.state = 'title';
    this.menu.showTitle(true, !!save);
    this.last = performance.now();
    // ?manual: no render loop; tests drive the game with step() instead
    if (!/[?&]manual\b/.test(location.search)) this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  step(dt = 1 / 30, n = 1) {
    for (let i = 0; i < n; i++) {
      // Only draw the HUD on the frame that gets rendered
      this.hudSkip = i < n - 1;
      this.last = performance.now() - dt * 1000;
      if (this.state === 'playing') this.update(dt);
      else if (this.state === 'title') this.titleCam(dt);
      this.input.endFrame();
    }
    this.renderer.render(this.scene, this.camera);
  }

  // Townsfolk, the gang at camp, and horses at the hitching posts
  populate() {
    const pts = this.assets.world.points;
    const rand = rng(31);
    const town = pts.town;
    for (let i = 0; i < 9; i++) {
      const x = town[0] - 45 + rand() * 90;
      const z = town[2] + (rand() < 0.5 ? -2 : 2) * (1 + rand());
      this.npcs.push(new NPC(this, { outfit: 'townsman', role: 'civilian', x, z, yaw: rand() * 6, wander: 22 }));
    }
    const camp = pts.camp;
    for (const [dx, dz] of [[-3.5, 2.5], [3, 3.2], [-6, -4]]) {
      this.npcs.push(new NPC(this, { outfit: 'townsman', role: 'civilian', x: camp[0] + dx, z: camp[2] + dz, yaw: rand() * 6, wander: 6 }));
    }
    this.extraHorses = [];
    const coats = ['#6b4a2f', '#cfc4b4', '#3b2a20', '#8a6a4a', '#1a1614'];
    const hitches = this.assets.world.props.filter((p) => p.model === 'HitchPost');
    hitches.slice(0, 6).forEach((h, i) => {
      if (i % 2 === 1 && i !== 5) return;
      const horse = new Horse(this.assets.horse, coats[i % coats.length], 'Horse');
      const yaw = h.yaw + Math.PI / 2;
      const off = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(-1.6);
      horse.position.set(h.x + off.x, this.collision.groundY(h.x + off.x, h.z + off.z), h.z + off.z);
      horse.yaw = yaw;
      horse.root.rotation.y = yaw;
      horse.mode = 'tethered';
      this.scene.add(horse.root);
      this.extraHorses.push(horse);
    });
  }

  hasSave() {
    return !!store.get(SAVE_KEY, null);
  }

  loadSave(save) {
    if (!save) return;
    this.money = save.money || 0;
    this.pelts = save.pelts || 0;
    Object.assign(this.stats, save.stats || {});
    if (save.hour) this.env.hour = save.hour;
  }

  save() {
    store.set(SAVE_KEY, {
      done: [...this.missions.done], money: this.money, pelts: this.pelts, stats: this.stats, hour: this.env.hour,
    });
  }

  respawnAtCamp() {
    const pts = this.assets.world.points;
    const s = pts.player_start;
    this.player.place(s[0], s[2], -0.9);
    const h = pts.horse_start;
    this.horse.position.set(h[0], this.collision.groundY(h[0], h[2]), h[2]);
    this.horse.yaw = -1.2;
    this.horse.speed = 0;
    this.horse.mode = 'idle';
  }

  startPlaying(fresh) {
    this.audio.start();
    if (fresh) {
      store.remove(SAVE_KEY);
      this.missions.done.clear();
      this.money = 0;
      this.pelts = 0;
      for (const k of Object.keys(this.stats)) this.stats[k] = 0;
      if (this.missions.givers.hollis) {
        this.missions.givers.hollis.remove();
        delete this.missions.givers.hollis;
      }
      this.env.hour = 8.2;
    } else if (!this.hasSave()) this.env.hour = 8.2;
    this.respawnAtCamp();
    this.menu.showTitle(false);
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.lock();
    this.camRig.cinematic = null;
    this.camRig.yaw = this.player.yaw;
    this.camRig.pitch = -0.15;
    const next = this.missions.available();
    if (next && next.id === 'ride') {
      this.hud.titleCard('Chapter I', 'Outlaw Frontier', 'The Dakota River valley, 1899', 5);
      setTimeout(() => this.hud.toast('Talk to <b>Gus</b> by the campfire (the yellow <b>G</b> on your map), or press <kbd>J</kbd> to start the mission right away.', 'Story'), 5500);
    } else if (next) {
      this.hud.toast(`Next: <b>${next.title}</b>. Talk to ${next.giverName} ${next.where}, or press <kbd>J</kbd> to start it now.`, 'Story');
    }
    this.save();
  }

  quitToTitle() {
    this.save();
    if (this.missions.active) {
      this.missions.active.cleanup(true);
      this.missions.active = null;
    }
    this.menu.closePause();
    this.hud.show(false);
    this.state = 'title';
    this.input.enabled = false;
    this.input.unlock();
    this.player.setWeapon(null);
    if (this.player.mounted) this.player.dismount();
    this.setDeadEye(false);
    this.menu.showTitle(true, true);
  }

  pause(page = null) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.input.enabled = false;
    this.audio.heartbeat(false);
    this.menu.openPause(page);
    this.save();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menu.closePause();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.lock();
    this.last = performance.now();
    if (this.player.deadEyeOn) this.audio.heartbeat(true);
  }

  bindKeys() {
    addEventListener('keydown', (e) => {
      if (this.state === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Backspace') this.menu.back();
        if (e.code === 'KeyM') this.menu.showPage(this.menu.page === 'map' ? null : 'map');
        return;
      }
      if (this.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) $('btn-play').click();
    });
  }

  setSetting(key, value) {
    this.settings[key] = value;
    store.set(SETTINGS_KEY, this.settings);
    if (key === 'quality') {
      this.quality = QUALITY[value];
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.pixelRatio));
      this.env.setQuality(this.quality);
      this.grass.setDensity(this.quality.grass);
      this.world.lodDist = this.quality.treeLod;
      this.camera.far = this.quality.far;
      this.resize();
    }
    if (key === 'sensitivity') this.input.sensitivity = value;
    if (key === 'invert') this.input.invert = value;
    if (key === 'fov') this.camRig.baseFov = value;
    if (key === 'volume') this.audio.setVolume(value);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.effects) this.effects.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  setDeadEye(on) {
    document.body.classList.toggle('deadeye', on);
    this.audio.heartbeat(on);
    if (on) this.audio.deadEyeIn();
  }

  // Gunfire frightens bystanders and wildlife and wakes up nearby outlaws.
  alertNear(pos, radius) {
    for (const n of this.npcs) {
      if (n.dead) continue;
      const d = n.pos.distanceTo(pos);
      if (n.role === 'civilian' && d < radius) n.panic(pos);
      if (n.role === 'outlaw' && d < radius) n.engage();
    }
    for (const a of this.animals) if (!a.dead && a.position.distanceTo(pos) < radius) a.alarm(pos);
  }

  // J: skip the walk or ride to the next mission (and start it), or the long
  // ride inside one. A short fade covers the jump.
  quickTravel() {
    const p = this.player;
    const t = this.missions.travelTarget();
    if (!t || this.traveling || this.lockControls || p.dead || p.mounting) return;
    const fight = this.npcs.some((n) => !n.dead && n.role === 'outlaw' && n.state === 'combat' && n.pos.distanceTo(p.pos) < 150);
    if (fight) {
      this.hud.toast('Not in the middle of a fight.');
      return;
    }
    this.traveling = true;
    $('fade').classList.add('on');
    setTimeout(() => {
      this.travelTo(t);
      $('fade').classList.remove('on');
      this.traveling = false;
      if (t.start && !this.missions.active) this.missions.start(t.start);
    }, 700);
  }

  travelTo(t) {
    const p = this.player;
    const h = this.horse;
    const free = (x, z, r) => {
      const v = new THREE.Vector3(x, this.collision.groundY(x, z), z);
      for (let i = 0; i < 4; i++) this.collision.resolve(v, r, 2);
      return v;
    };
    if (t.npc) {
      // On foot, a couple of steps in front of them, horse close by
      if (p.mounted) p.dismount();
      const n = t.npc;
      const v = free(n.pos.x + Math.sin(n.yaw) * 2.4, n.pos.z + Math.cos(n.yaw) * 2.4, 0.5);
      const yaw = Math.atan2(n.pos.x - v.x, n.pos.z - v.z);
      p.place(v.x, v.z, yaw);
      const hv = free(v.x + Math.sin(yaw + 2.3) * 5, v.z + Math.cos(yaw + 2.3) * 5, 1.4);
      h.position.set(hv.x, this.collision.groundY(hv.x, hv.z), hv.z);
      h.yaw = yaw;
    } else {
      let at = t.at;
      if (!at) {
        const d = new THREE.Vector3(t.to.x - p.pos.x, 0, t.to.z - p.pos.z).normalize();
        at = new THREE.Vector3(t.to.x - d.x * 14, 0, t.to.z - d.z * 14);
      }
      const v = free(at.x, at.z, 1.4);
      const yaw = Math.atan2(t.to.x - v.x, t.to.z - v.z);
      h.position.set(v.x, this.collision.groundY(v.x, v.z), v.z);
      h.yaw = yaw;
      if (p.mounted) {
        p.syncToHorse();
        this.camRig.yaw = yaw;
      } else {
        const pv = free(v.x + Math.sin(yaw + 1.6) * 2.2, v.z + Math.cos(yaw + 1.6) * 2.2, 0.5);
        p.place(pv.x, pv.z, yaw);
      }
    }
    h.speed = 0;
    h.mode = 'idle';
    this.camRig.pitch = -0.12;
  }

  onPlayerDeath() {
    this.stats.deaths++;
    document.body.classList.add('dying');
    this.audio.sting('death');
    this.setDeadEye(false);
    const retry = this.missions.onPlayerDeath();
    const lost = Math.min(this.money, Math.round(this.money * 0.1 * 100) / 100);
    this.money -= lost;
    setTimeout(() => {
      $('death').hidden = false;
      $('dead-sub').textContent = retry ? `Mission failed: ${retry.def.title}` : (lost > 0 ? `You lost $${lost.toFixed(2)}` : '');
    }, 1200);
    setTimeout(() => $('fade').classList.add('on'), 3600);
    setTimeout(() => {
      $('death').hidden = true;
      document.body.classList.remove('dying');
      const p = this.player;
      const pos = retry?.pos;
      if (pos) p.revive(pos.x, pos.z, p.yaw);
      else {
        const s = this.assets.world.points.player_start;
        p.revive(s[0], s[2], -0.9);
      }
      // Bring the horse along
      const h = this.horse;
      const hx = p.pos.x + 3;
      const hz = p.pos.z + 2;
      h.position.set(hx, this.collision.groundY(hx, hz), hz);
      h.speed = 0;
      h.mode = 'idle';
      h.rider = null;
      this.camRig.yaw = p.yaw;
      this.missions.resumeAfterDeath();
      $('fade').classList.remove('on');
    }, 4500);
  }

  // Everything the minimap and big map should show
  blips(full = false) {
    const out = [...this.missions.blips()];
    const h = this.horse;
    if (!this.player.mounted) out.push({ x: h.position.x, z: h.position.z, color: '#b07a3c', r: 4, edge: true });
    for (const n of this.npcs) {
      if (n.dead || n.role !== 'outlaw') continue;
      if (n.state === 'combat') out.push({ x: n.pos.x, z: n.pos.z, color: '#d8382c', r: 3.5 });
    }
    if (full) {
      const pts = this.assets.world.points;
      out.push({ x: pts.camp[0], z: pts.camp[2], color: '#e9dcc0', r: 5 });
    }
    return out;
  }

  // ---------------------------------------------------------------- loop
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0);
    this.last = now;
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'title') this.titleCam(dt);
    if (this.state !== 'paused' || !this.pausedRendered) {
      this.renderer.render(this.scene, this.camera);
      this.pausedRendered = this.state === 'paused';
    }
    if (this.state !== 'paused') this.pausedRendered = false;
    this.input.endFrame();
  }

  titleCam(dt) {
    this.time += dt;
    const c = this.assets.world.points.camp;
    const a = this.time * 0.05 + 2.2;
    const center = new THREE.Vector3(c[0], c[1] + 1.4, c[2]);
    this.camera.position.set(c[0] + Math.cos(a) * 19, c[1] + 5.5, c[2] + Math.sin(a) * 19);
    this.camera.lookAt(center);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.env.update(dt * 0.1, center, this.camera);
    this.effects.update(dt, this.camera.position);
    for (const n of this.npcs) if (n.pos.distanceTo(center) < 40) n.update(dt);
    this.horse.update(dt, this);
    this.player.char.update(dt);
    this.grass.update(dt, center);
    this.world.updateLod(this.camera.position);
    this.river.uniforms.uTime.value += dt;
  }

  interactionPrompt() {
    const p = this.player;
    if (p.dead || this.lockControls) return null;
    const m = this.missions.interaction();
    if (m) return m;
    if (!p.mounted) {
      for (const n of this.npcs) {
        if (!n.dead || n.looted || n.role !== 'outlaw') continue;
        if (Math.hypot(n.pos.x - p.pos.x, n.pos.z - p.pos.z) < 2) {
          return { label: 'Loot body', action: () => this.loot(n) };
        }
      }
    }
    return null;
  }

  loot(n) {
    n.looted = true;
    this.player.kneel(1.3, () => {
      const cash = Math.round((1 + Math.random() * 6) * 100) / 100;
      const r = 3 + Math.floor(Math.random() * 6);
      this.money += cash;
      const w = n.weapon === 'rifle' ? 'rifle' : 'revolver';
      this.player.ammo[w].reserve += r;
      this.hud.toast(`$${cash.toFixed(2)} and ${r} ${w} rounds`, 'Looted');
    });
  }

  update(dt) {
    const p = this.player;
    const input = this.input;
    this.time += dt;
    // Dead Eye slows the world, not the camera
    this.timeScale = damp(this.timeScale ?? 1, p.deadEyeOn ? 0.28 : 1, 8, dt);
    const gdt = dt * this.timeScale;

    if (input.pressed('Escape') || input.pressed('KeyP')) return this.pause();
    if (input.pressed('KeyM')) return this.pause('map');
    if (input.pressed('KeyN')) this.hud.toast(this.audio.toggleMute() ? 'Sound off' : 'Sound on');
    if (input.pressed('KeyJ')) this.quickTravel();

    // Interaction prompt + E
    this.interaction = this.interactionPrompt();
    if (this.interaction && input.pressed('KeyE') && !this.lockControls) {
      const it = this.interaction;
      this.interaction = null;
      input.edges.delete('KeyE');
      it.action();
    }

    const before = p.pos.clone();
    p.update(dt, gdt);
    this.horse.update(gdt, this);
    p.syncToHorse();
    for (const h of this.extraHorses) if (h.position.distanceToSquared(p.pos) < 200 * 200) h.update(gdt, this);
    for (const n of this.npcs) n.update(gdt);
    this.playerLoud = p.loud < 1.5;
    this.playerFast = p.speed > 5;
    for (const a of this.animals) a.update(gdt, this, p.pos);
    this.missions.update(gdt);
    this.effects.update(gdt, this.camera.position);

    // Camera
    const mode = p.mounted ? (p.aiming ? (p.weapon === 'rifle' ? 'aimHorseRifle' : 'aimHorse') : 'horse')
      : p.aiming ? (p.weapon === 'rifle' ? 'aimRifle' : 'aim') : 'foot';
    this.focus.x = p.pos.x;
    this.focus.z = p.pos.z;
    this.focus.y = damp(this.focus.y || p.pos.y, p.pos.y, p.mounted ? 7 : 16, dt);
    if (Math.abs(this.focus.y - p.pos.y) > 3) this.focus.y = p.pos.y;
    this.camRig.update(dt, this.focus, mode);
    p.char.model.visible = !this.camRig.tooClose || !!this.camRig.cinematic;

    const sp = p.pos.distanceTo(before);
    if (sp < 20) {
      if (p.mounted) this.stats.ridden += sp;
      else this.stats.walked += sp;
    }
    const lastHour = this.env.hour;
    this.env.update(gdt, p.pos, this.camera);
    if (this.env.hour < lastHour) this.stats.days++;
    this.grass.update(gdt, p.pos);
    this.river.uniforms.uTime.value += gdt;
    this.river.uniforms.uSky.value.copy(this.scene.fog.color);
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.3;
      this.world.updateLod(this.camera.position);
    }

    // HUD prompts
    const prompts = [];
    if (this.interaction) prompts.push(['E', this.interaction.label]);
    else if (!p.mounted && p.canMount() && !this.lockControls) prompts.push(['E', 'Mount']);
    if (p.mounted && !this.lockControls) {
      if (Math.abs(p.mounted.speed) < 3.5) prompts.push(['E', 'Dismount']);
      prompts.push(['Shift', 'Gallop']);
    }
    if (p.aiming && !p.deadEyeOn && p.deadEye > 15) prompts.push(['Q', 'Dead Eye']);
    if (p.deadEyeOn) prompts.push(['Click', 'Mark target'], ['Q', 'Fire']);
    if (p.weapon && p.ammo[p.weapon].clip === 0 && p.ammo[p.weapon].reserve > 0) prompts.push(['R', 'Reload']);
    if (!this.interaction && !this.lockControls && !this.traveling && !p.dead) {
      const t = this.missions.travelTarget();
      if (t) prompts.push(['J', t.label]);
    }
    this.hud.prompts(prompts);
    this.hud.aimTarget = p.aiming && this.aimingAtTarget();
    if (!this.hudSkip) this.hud.update(dt);

    // Ambience
    const river = this.terrain.riverAt(p.pos.z);
    const rd = Math.abs(p.pos.x - river.x);
    let fire = 0;
    for (const f of this.effects.fires) fire = Math.max(fire, clamp(1 - f.pos.distanceTo(p.pos) / (12 + 25 * f.size), 0, 1) * Math.min(1, f.size));
    this.audio.ambience(dt, { wind: 0.1 + clamp((p.pos.y - 120) / 300, 0, 0.2), river: clamp(1 - (rd - 15) / 90, 0, 1), fire, speed: p.speed });
    this.hoofTimer = (this.hoofTimer || 0) - gdt;
    if (p.mounted && Math.abs(p.mounted.speed) > 0.5 && this.hoofTimer <= 0) {
      const s = Math.abs(p.mounted.speed);
      this.audio.hoof(s > 8 ? 1 : 0.7);
      this.hoofTimer = s > 8 ? 0.13 : s > 4 ? 0.21 : 0.32;
      if (s > 8 && Math.random() < 0.5) this.effects.dust(p.mounted.position, 1);
    }

    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      this.save();
    }
  }

  aimingAtTarget() {
    this._aimCheck = (this._aimCheck || 0) + 1;
    if (this._aimCheck % 4 !== 0) return this._aimCached;
    const ray = this.camRig.aimRay(0);
    const hit = this.combat.trace(ray.origin, ray.dir, 150, this.player);
    this._aimCached = !!(hit && hit.target);
    return this._aimCached;
  }
}

const game = new Game();
window.__game = game;
game.init().catch((err) => {
  console.error(err);
  $('ld-text').textContent = 'Could not load the game: ' + err.message +
    (location.protocol === 'file:' ? ' (serve the folder over http, see README)' : '');
});
