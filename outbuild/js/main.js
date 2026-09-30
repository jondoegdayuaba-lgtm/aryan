// Outbuild — an original island battle royale with building. Game orchestration: lobby, match, results.
import * as THREE from 'three';
import { GAME, DEFAULT_SETTINGS, QUALITY, WORLD, PLAYER, RARITIES, MATS } from './config.js';
import { Rng, clamp, damp, formatTime } from './util.js';
import { Renderer, TIMES } from './renderer.js';
import { Assets } from './assets.js';
import { Terrain } from './terrain.js';
import { Physics } from './physics.js';
import { PieceSystem } from './pieces.js';
import { PropSystem } from './props.js';
import { World } from './world.js';
import { createWater } from './water.js';
import { createGrass } from './grass.js';
import { updateShared } from './materials.js';
import { Input } from './input.js';
import { Actor } from './actor.js';
import { CameraRig } from './camera.js';
import { PlayerController } from './player.js';
import { BotBrain, botName } from './bots.js';
import { Combat } from './combat.js';
import { Building } from './building.js';
import { Airship } from './airship.js';
import { Storm } from './storm.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { PickupSystem, floorLoot, chestLoot, ammoBoxLoot, supplyLoot, WEAPONS, CONSUMABLES, itemName } from './items.js';
import { OUTFITS, SKIN_TONES, CharacterModel } from './character.js';
import { UI } from './ui.js';
import { LOBBY } from './layout.js';

const $ = (id) => document.getElementById(id);

class WeakPoint {
  constructor(scene) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3.2), fog: false }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 2.6), transparent: true, opacity: 0.8, fog: false }));
    g.add(core, ring);
    g.visible = false;
    g.renderOrder = 30;
    scene.add(g);
    this.group = g;
    this.ring = ring;
    this.owner = null;
    this.pos = new THREE.Vector3();
    this.t = 0;
  }
  check(point, owner) { return this.group.visible && owner === this.owner && point.distanceTo(this.pos) < 0.5; }
  place(point, normal, owner) {
    const n = normal.clone().normalize();
    const t1 = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, t1).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.45;
    this.pos.copy(point).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).addScaledVector(n, 0.06);
    this.group.position.copy(this.pos);
    this.group.lookAt(this.pos.clone().add(n));
    this.group.visible = true;
    this.owner = owner;
    this.t = 5;
  }
  update(dt) {
    if (!this.group.visible) return;
    this.t -= dt;
    this.ring.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.12);
    if (this.t <= 0 || (this.owner && this.owner.alive === false)) this.group.visible = false;
  }
}

class Game {
  constructor() {
    this.state = 'loading';
    this.time = 0;
    this.actors = [];
    this.paused = false;
    this.mapOpen = false;
    this.settings = this.loadSettings();
    this.stats = this.loadStats();
  }

  loadSettings() {
    let s;
    try { s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('outbuild.settings') || '{}') }; } catch { s = { ...DEFAULT_SETTINGS }; }
    // URL overrides, handy for testing: ?q=low&time=sunset&bots=10
    const u = new URLSearchParams(location.search);
    if (u.get('q')) s.quality = u.get('q');
    if (u.get('time')) s.timeOfDay = u.get('time');
    if (u.get('bots')) s.bots = +u.get('bots');
    return s;
  }
  saveSettings() { try { localStorage.setItem('outbuild.settings', JSON.stringify(this.settings)); } catch { /* private mode */ } }
  loadStats() {
    try { return { matches: 0, wins: 0, kills: 0, best: 0, ...JSON.parse(localStorage.getItem('outbuild.stats') || '{}') }; } catch { return { matches: 0, wins: 0, kills: 0, best: 0 }; }
  }
  saveStats() { try { localStorage.setItem('outbuild.stats', JSON.stringify(this.stats)); } catch { /* ignore */ } }

  async init() {
    const canvas = $('game');
    this.renderer = new Renderer(canvas);
    this.scene = this.renderer.scene;
    this.camera = this.renderer.camera;
    this.renderer.setTime(this.pickTime());
    this.renderer.setQuality(this.settings.quality);
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusic(this.settings.music);
    this.ui = new UI(this);
    const bar = $('load-fill');
    this.assets = new Assets();
    await this.assets.load((p) => { bar.style.width = `${(p * 80) | 0}%`; });
    await this.tick();
    this.terrain = new Terrain(GAME.seed);
    this.physics = new Physics(this.terrain);
    this.pieces = new PieceSystem(this.scene, this.physics, this.terrain, this.assets);
    this.pickups = new PickupSystem(this.scene, this.assets, this.terrain, this.physics);
    this.buildLevel();
    bar.style.width = '88%';
    await this.tick();
    this.terrain.buildSplat();
    this.terrain.buildHeightTexture();
    this.scene.add(this.terrain.buildMesh(this.assets.textures));
    this.water = createWater(this.terrain, this.assets.textures.water_n, this.renderer);
    this.scene.add(this.water);
    this.makeGrass();
    bar.style.width = '94%';
    await this.tick();
    this.input = new Input(canvas);
    this.rig = new CameraRig(this.camera, this.physics);
    this.combat = new Combat(this);
    this.building = new Building(this);
    this.airship = new Airship(this);
    this.storm = new Storm(this);
    this.effects = new Effects(this);
    this.weakPoint = new WeakPoint(this.scene);
    this.hud = new Hud(this);
    this.hud.renderIcons(this.renderer, this.assets);
    this.hud.buildMap(this.terrain, this.pieces);
    this.pieces.onDestroyed = (p, cause, b) => {
      if (cause === 'clear') return;
      this.effects.debris(b, p.mat);
      this.audio.breakPiece(p.mat, new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2));
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'match' && !this.mapOpen && !this.over) this.setPaused(true);
    };
    bar.style.width = '100%';
    // warm up shaders so the first frames don't hitch
    this.renderer.renderer.compile(this.scene, this.camera);
    this.enterLobby();
    $('loading-screen').classList.add('done');
    setTimeout(() => $('loading-screen').remove(), 800);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  tick() { return new Promise((r) => setTimeout(r, 0)); }

  pickTime() {
    const t = this.settings.timeOfDay;
    if (t && t !== 'random' && TIMES[t]) return t;
    const r = Math.random();
    return r < 0.5 ? 'day' : r < 0.8 ? 'golden' : 'sunset';
  }

  makeGrass() {
    if (this.grass) { this.scene.remove(this.grass); this.grass.geometry.dispose(); }
    this.grass = createGrass(this.terrain, this.renderer.quality.grass);
    if (this.grass) this.scene.add(this.grass);
  }

  applySettings() {
    const s = this.settings;
    if (this.renderer.qualityKey !== s.quality) {
      this.renderer.setQuality(s.quality);
      this.makeGrass();
    }
    this.props.setDrawDist(QUALITY[s.quality].drawDist);
    this.rig.baseFov = s.fov;
    this.audio.setVolume(s.volume);
    this.audio.setMusic(s.music);
    if (this.controller) { this.controller.sens = s.sensitivity; this.controller.invertY = s.invertY; }
    $('fps').hidden = !s.showFps;
    this.saveSettings();
  }

  // ------------------------------------------------------------------ level
  buildLevel() {
    if (this.drops) { for (const d of this.drops) this.scene.remove(d.group); this.drops = []; }
    if (this.props) { this.props.dispose(); this.pieces.clear(); this.pickups.clear(); }
    this.props = new PropSystem(this.scene, this.physics, this.assets);
    this.props.onDestroyed = (p) => {
      if (this.effects) this.effects.propBreak(p);
      if (this.audio) this.audio.breakPiece(p.mat, new THREE.Vector3(p.x, p.y + 1, p.z));
    };
    this.world = new World({ seed: GAME.seed, terrain: this.terrain, pieces: this.pieces, props: this.props }).build();
    this.props.finalize();
    this.props.setDrawDist(QUALITY[this.settings.quality].drawDist);
    this.windmill = null;
    const wm = this.world.landmarks.find((l) => l.name === 'Windmill');
    if (wm && this.assets.has('Windmill_Blades')) {
      const proto = this.assets.proto('Windmill');
      const blades = this.assets.instance('Windmill_Blades');
      const pivot = new THREE.Group();
      pivot.position.set(wm.x, wm.y, wm.z);
      pivot.rotation.y = wm.yaw;
      const hub = new THREE.Group();
      const bp = this.assets.proto('Windmill_Blades');
      hub.position.copy(bp.position);
      if (!bp.position.lengthSq()) hub.position.y = proto.userData.hub_z || 12;
      hub.add(blades);
      pivot.add(hub);
      this.scene.add(pivot);
      this.windmill = { pivot, blades };
    }
  }

  spawnLoot(rng) {
    for (const c of this.world.chests) if (rng.chance(0.9)) this.pickups.addContainer('chest', c.x, c.y, c.z, c.yaw);
    for (const c of this.world.ammoBoxes) this.pickups.addContainer('ammo', c.x, c.y, c.z, c.yaw);
    for (const f of this.world.floorLoot) {
      if (!rng.chance(0.78)) continue;
      const items = floorLoot(rng);
      items.forEach((it, i) => this.pickups.spawn(it, f.x + i * 0.7, f.y + 0.02, f.z + (i ? 0.4 : 0)));
    }
  }

  // ------------------------------------------------------------------ lobby
  enterLobby() {
    this.state = 'lobby';
    this.over = false;
    this.hud.show(false);
    this.input.enabled = false;
    this.input.unlock();
    this.audio.silenceLoops();
    this.storm.reset();
    this.airship.group.visible = false;
    this.airship.active = false;
    for (const a of this.actors) a.dispose();
    this.actors = [];
    this.player = null;
    // a scenic spot on the slope of Lookout Peak, looking over the island
    const spot = this.lobbySpot || (this.lobbySpot = this.findLobbySpot());
    if (!this.lobbyChar) {
      this.lobbyChar = new CharacterModel(this.assets.gltf.character, this.settings.outfit, SKIN_TONES[1]);
      this.scene.add(this.lobbyChar.root);
    }
    this.lobbyChar.root.visible = true;
    this.lobbyChar.setOutfit(this.settings.outfit, SKIN_TONES[this.settings.skin ?? 1]);
    this.lobbyChar.root.position.copy(spot.pos);
    this.lobbyChar.root.rotation.y = spot.yaw;
    this.lobbyChar.hold(null, 'none');
    this.lobbyT = 0;
    this.lobbySnap = true;
    this.ui.showLobby();
    this.audio.startMusic();
  }

  findLobbySpot() {
    const h = this.terrain.heightAt(LOBBY.x, LOBBY.z);
    return { pos: new THREE.Vector3(LOBBY.x, h, LOBBY.z), yaw: LOBBY.yaw };
  }

  updateLobby(dt) {
    this.lobbyT += dt;
    const c = this.lobbyChar;
    const spot = this.lobbySpot;
    c.update(dt, { vel: new THREE.Vector3(), yaw: spot.yaw, aimPitch: -0.1, grounded: true, crouch: false, sprint: false,
      mode: 'ground', harvest: -1, dance: this.ui.dancing });
    // camera to the front-right of the character, which stands on the left third of the screen
    const f = new THREE.Vector3(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const orbit = Math.sin(this.lobbyT * 0.15) * 0.25;
    const camPos = spot.pos.clone().addScaledVector(f, 3.4).addScaledVector(r, -1.3 + orbit).add(new THREE.Vector3(0, 1.45, 0));
    if (this.lobbySnap) { this.camera.position.copy(camPos); this.lobbySnap = false; }
    this.camera.position.lerp(camPos, 1 - Math.exp(-dt * 3));
    const look = spot.pos.clone().addScaledVector(r, -1.05).add(new THREE.Vector3(0, 1.05, 0));
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - 42) > 0.1) { this.camera.fov = 42; this.camera.updateProjectionMatrix(); }
    this.renderer.updateShadow(spot.pos);
  }

  // ------------------------------------------------------------------ match
  startMatch() {
    this.audio.init();
    this.audio.stopMusic();
    const seed = (Math.random() * 1e9) | 0;
    this.rng = new Rng(seed);
    if (this.played) this.buildLevel();
    this.played = true;
    this.lobbyChar.root.visible = false;
    this.spawnLoot(this.rng);
    this.time = 0;
    this.over = false;
    this.placement = 0;
    this.winner = null;
    this.marker = null;
    // actors
    const s = this.settings;
    this.player = new Actor(this, { name: 'You', isPlayer: true, outfit: s.outfit, skin: SKIN_TONES[s.skin ?? 1] });
    this.actors = [this.player];
    this.bots = [];
    for (let i = 0; i < s.bots; i++) {
      const a = new Actor(this, { name: botName(this.rng), outfit: this.rng.int(0, OUTFITS.length - 1), skin: this.rng.pick(SKIN_TONES) });
      const b = new BotBrain(this, a, new Rng(seed + i * 31 + 7), s.difficulty);
      a.brain = b;
      this.actors.push(a);
      this.bots.push(b);
    }
    this.controller = new PlayerController(this, this.player, this.input, this.rig);
    this.controller.sens = s.sensitivity;
    this.controller.invertY = s.invertY;
    this.rig.baseFov = s.fov;
    this.airship.start(this.rng);
    for (const b of this.bots) b.planDrop(this.airship);
    this.rig.yaw = Math.atan2(this.airship.dir.x, this.airship.dir.z);
    this.rig.pitch = -0.25;
    this.storm.reset();
    this.storm.start(this.rng);
    this.stormTick = 1;
    this.state = 'match';
    this.ui.showMatch();
    this.hud.show(true);
    this.input.enabled = true;
    this.input.lock();
    this.paused = false;
    this.hud.announce('Board the airship', 'Press SPACE to jump when you are over a place you like', 4);
  }

  aliveCount() { let n = 0; for (const a of this.actors) if (a.alive) n++; return n; }

  setPaused(p) {
    if (this.over) return;
    this.paused = p;
    this.ui.showPause(p);
    if (!p) this.input.lock();
    else this.input.unlock();
  }

  toggleMap(open = !this.mapOpen) {
    this.mapOpen = open;
    $('bigmap-wrap').hidden = !open;
  }

  // ------------------------------------------------------------------ interaction
  interactTarget(actor) {
    const eye = actor.eye(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(actor.yaw), 0, Math.cos(actor.yaw));
    let best = null, bs = Infinity;
    for (const c of this.pickups.chests) {
      if (c.opened) continue;
      const d = Math.hypot(c.x - actor.pos.x, c.z - actor.pos.z);
      if (d > 2.4 || Math.abs(c.y - actor.pos.y) > 1.6) continue;
      const facing = ((c.x - actor.pos.x) * fwd.x + (c.z - actor.pos.z) * fwd.z) / (d || 1);
      const score = d - facing * 1.2;
      if (score < bs) { bs = score; best = { kind: 'container', obj: c }; }
    }
    for (const p of this.pickups.list) {
      const d = Math.hypot(p.x - actor.pos.x, p.z - actor.pos.z);
      if (d > 2.2 || Math.abs(p.y - actor.pos.y) > 1.8) continue;
      const facing = ((p.x - actor.pos.x) * fwd.x + (p.z - actor.pos.z) * fwd.z) / (d || 1);
      const score = d - facing * 1.2 + (p.item.type === 'weapon' ? -0.3 : 0);
      if (score < bs) { bs = score; best = { kind: 'pickup', obj: p }; }
    }
    return best;
  }

  interact(actor) {
    const t = this.interactTarget(actor);
    if (!t) return;
    if (t.kind === 'container') {
      const c = t.obj;
      c.opened = true;
      const items = c.kind === 'chest' ? chestLoot(this.rng) : c.kind === 'supply' ? supplyLoot(this.rng) : ammoBoxLoot(this.rng);
      const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      items.forEach((it) => {
        const p = this.pickups.spawn(it, c.x + fwd.x * 0.6, c.y + 0.6, c.z + fwd.z * 0.6, { toss: true });
        p.vx = fwd.x * 2.5 + (Math.random() - 0.5) * 3;
        p.vz = fwd.z * 2.5 + (Math.random() - 0.5) * 3;
      });
      this.audio.chestOpen(new THREE.Vector3(c.x, c.y, c.z));
      return;
    }
    const p = t.obj;
    const inv = actor.inv;
    if (!inv.hasRoomFor(p.item) && inv.selected < 0) {
      if (actor.isPlayer) this.hud.announce('Inventory full', 'Select a slot to swap it out', 1.5, 'small');
      return;
    }
    const left = inv.add(p.item);
    this.pickups.remove(p);
    for (const it of left) this.pickups.spawn(it, actor.pos.x, actor.pos.y + 0.3, actor.pos.z, { toss: true });
    // picking a weapon into an empty inventory: hold it
    if (p.item.type === 'weapon' && (inv.selected < 0 || !inv.current())) {
      const i = inv.slots.indexOf(p.item);
      if (i >= 0) actor.select(i);
    }
    if (actor.isPlayer) this.audio.pickup();
  }

  autoPickup(actor) {
    for (let i = this.pickups.list.length - 1; i >= 0; i--) {
      const p = this.pickups.list[i];
      if (!p.settled || (p.item.type !== 'ammo' && p.item.type !== 'mat')) continue;
      if (Math.abs(p.x - actor.pos.x) > 1.5 || Math.abs(p.z - actor.pos.z) > 1.5 || Math.abs(p.y - actor.pos.y) > 1.6) continue;
      const left = actor.inv.add(p.item);
      this.pickups.remove(p);
      for (const it of left) this.pickups.spawn(it, p.x, p.y, p.z);
      if (actor.isPlayer) this.audio.pickup();
    }
  }

  dropCurrent(actor) {
    const inv = actor.inv;
    if (inv.selected < 0 || !inv.current()) return;
    const it = inv.current();
    inv.slots[inv.selected] = null;
    const f = actor.forward(new THREE.Vector3());
    const p = this.pickups.spawn(it, actor.pos.x + f.x * 1.2, actor.pos.y + 0.8, actor.pos.z + f.z * 1.2, { toss: true });
    p.vx = f.x * 3;
    p.vz = f.z * 3;
    actor.select(-1);
  }

  // ------------------------------------------------------------------ events
  onFire(actor, w, def, muzzle) {
    this.audio.gun(def.id, muzzle, actor.isPlayer);
    if (actor.isPlayer) {
      const kick = def.kick * (this.controller.ads ? 0.6 : 1);
      this.rig.pitch += kick;
      this.rig.yaw += (Math.random() - 0.5) * kick * 0.5;
      this.rig.addShake(def.recoil * 0.25);
    }
  }

  onHitConfirm(attacker, target, amount, head, point, shield) {
    if (!attacker || !attacker.isPlayer) return;
    this.hud.hitMarker(head);
    this.hud.damageNumber(point, amount, head, shield);
    this.audio.hitmarker(head, shield);
  }

  onDamage(victim, amount, source, opts) {
    if (!victim.isPlayer) return;
    this.damageFlash = Math.min(1, (this.damageFlash || 0) + amount / 40);
    if (!opts.storm) this.audio.hurt(opts.toShield > 0, opts.shieldBroken);
    if (source && source !== victim) this.hud.damageFrom(source.pos, victim);
  }

  onDeath(victim, killer, opts) {
    const items = victim.inv.dump();
    this.pickups.spawnMany(items, victim.pos.x, victim.pos.y, victim.pos.z);
    this.effects.eliminate(victim.pos);
    const place = this.aliveCount() + 1;
    victim.placement = place;
    const nm = (a) => `<b class="${a.isPlayer ? 'me' : ''}">${a.name}</b>`;
    let msg;
    if (opts.storm) msg = `${nm(victim)} was lost in the storm`;
    else if (opts.fall) msg = `${nm(victim)} fell too far`;
    else if (killer && killer !== victim) {
      const wname = opts.weapon === 'pickaxe' ? 'a harvesting tool' : WEAPONS[opts.weapon] ? WEAPONS[opts.weapon].name : 'something';
      msg = `${nm(killer)} eliminated ${nm(victim)} <span class="w">${wname}${opts.head ? ' · headshot' : ''}</span>`;
    } else msg = `${nm(victim)} was eliminated`;
    this.hud.killFeed(msg);
    if (killer && killer.isPlayer && killer !== victim) {
      this.hud.elimBanner(victim.name);
      this.audio.eliminated(true);
    }
    if (victim.isPlayer) {
      this.audio.eliminated(false);
      this.playerDied(killer);
    }
    const alive = this.aliveCount();
    if (!victim.isPlayer && this.player && this.player.alive && [50, 25, 10, 5, 3, 2].includes(alive)) {
      this.hud.announce(`${alive} players left`, '', 2.5, 'small');
    }
    if (alive <= 1) this.finish();
  }

  playerDied(killer) {
    this.placement = this.aliveCount() + 1;
    this.stats.matches++;
    this.stats.kills += this.player.kills;
    this.saveStats();
    this.spectating = killer && killer.alive ? killer : null;
    setTimeout(() => { if (this.state === 'match') this.ui.showDeath(killer); }, 1600);
  }

  finish() {
    if (this.over) return;
    const winner = this.actors.find((a) => a.alive);
    this.winner = winner;
    this.over = true;
    if (winner && winner.isPlayer) {
      this.placement = 1;
      this.stats.matches++;
      this.stats.wins++;
      this.stats.kills += winner.kills;
      this.saveStats();
      winner.dancing = true;
      this.audio.victory();
      setTimeout(() => this.ui.showVictory(), 1200);
    } else if (this.player && !this.player.alive) {
      this.ui.updateDeathWinner(winner);
    }
  }

  onFootstep(actor, speed) {
    const gc = actor.groundCollider;
    const surface = gc && gc.kind === 'piece' ? gc.owner.mat : 'ground';
    this.audio.footstep(actor.pos, actor.isPlayer, surface, speed);
  }
  onJump(actor) { if (actor.isPlayer) this.audio.jump(true); }
  onJumpGround(actor) { if (actor.isPlayer) this.audio.jump(true); }
  onGlide(actor) { if (actor.isPlayer) this.audio.glider(); }
  onLand(actor, fall = 0) {
    if (fall === 0 || fall > 20) this.effects.landingDust(actor.pos);
    if (actor.isPlayer || actor.pos.distanceTo(this.camera.position) < 30) this.audio.land(actor.pos, actor.isPlayer, Math.min(3, fall / 4));
  }
  onBuild(actor, piece) {
    const b = { minX: piece.ix * 4, maxX: piece.ix * 4 + 4, minY: piece.iy * 3, maxY: piece.iy * 3 + 3, minZ: piece.iz * 4, maxZ: piece.iz * 4 + 4 };
    if (actor.isPlayer) this.effects.buildPuff(b);
    this.audio.build(piece.mat, new THREE.Vector3((b.minX + b.maxX) / 2, b.minY + 1, (b.minZ + b.maxZ) / 2), actor.isPlayer);
  }
  onNoMats(actor, mat) { if (actor.isPlayer) this.hud.announce(`Not enough ${MATS[mat].label.toLowerCase()}`, 'Harvest more with your harvesting tool', 1.2, 'small'); }
  onBuildMat(mat) { this.audio.ui(); }
  onSwing(actor) { if (actor.isPlayer) this.audio.swing(true); }
  onHarvest(actor, mat, amount, point, weak) {
    if (actor.isPlayer) this.hud.matGain(mat, amount);
  }
  onHarvestHit(actor, mat, point, owner, weak, normal) {
    this.audio.harvest(mat, point, actor.isPlayer, weak);
    if (actor.isPlayer && owner && owner.alive !== false && normal) this.weakPoint.place(point, normal, owner);
  }
  onReload(actor, w) { this.audio.reload(actor.pos, actor.isPlayer); }
  onEmpty(actor) { if (actor.isPlayer) { this.audio.empty(); this.hud.announce('Out of ammo', '', 1, 'small'); } }
  onUse(actor, item) { if (actor.isPlayer) this.audio.heal(!!CONSUMABLES[item.id].shield); }
  onConsumed(actor, item) { if (actor.isPlayer) this.healFlash = 1; }
  onCantUse(actor, item) {
    if (actor.isPlayer) this.hud.announce(CONSUMABLES[item.id].shield ? 'Shield is full' : 'Health is full', '', 1, 'small');
  }
  onExplosion(pos) { this.audio.explosion(pos); }
  // A crate that floats down under a balloon with top-tier loot.
  spawnSupplyDrop() {
    const s = this.storm;
    let x = 0, z = 0;
    for (let i = 0; i < 30; i++) {
      const a = this.rng.float(0, Math.PI * 2), r = Math.sqrt(this.rng.next()) * s.next.r * 0.7;
      x = s.next.c.x + Math.cos(a) * r;
      z = s.next.c.y + Math.sin(a) * r;
      if (this.terrain.heightAt(x, z) > 1.5 && this.world.isFree(x, z, 3)) break;
    }
    const group = new THREE.Group();
    const crate = this.assets.flat('SupplyCrate');
    const balloon = this.assets.flat('SupplyBalloon');
    const bp = this.assets.proto('SupplyBalloon');
    balloon.position.copy(bp.position.lengthSq() > 0 ? bp.position : new THREE.Vector3(0, 1.52, 0));
    group.add(crate, balloon);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 400, 12, 1, true).translate(0, 200, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.7, 2.2), transparent: true, opacity: 0.28, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false }));
    group.add(beam);
    const ground = this.physics.groundAt(x, z, 400, 0.6, 500);
    group.position.set(x, ground + 150, z);
    this.scene.add(group);
    const drop = { group, crate, balloon, beam, x, z, y: ground + 150, ground, landed: false, t: 0 };
    this.drops = this.drops || [];
    this.drops.push(drop);
    this.hud.announce('Supply drop incoming', 'Look for the blue beam', 3, 'small');
  }

  updateDrops(dt) {
    if (!this.drops) return;
    for (const d of this.drops) {
      d.t += dt;
      if (!d.landed) {
        d.y = Math.max(d.ground, d.y - 5.5 * dt);
        d.group.position.set(d.x + Math.sin(d.t * 0.7) * 0.4, d.y, d.z);
        d.group.rotation.y += dt * 0.3;
        if (d.y <= d.ground + 0.01) {
          d.landed = true;
          d.group.position.set(d.x, d.ground, d.z);
          this.effects.landingDust(d.group.position);
          // becomes a container anyone can open
          const c = { kind: 'supply', group: d.group, lid: null, x: d.x, y: d.ground, z: d.z, yaw: d.group.rotation.y, opened: false,
            open: 0, light: null, sparkle: 0, drop: d };
          this.pickups.chests.push(c);
          d.container = c;
        }
      } else if (d.balloon.visible) {
        // the balloon lets go and drifts away
        d.balloon.position.y += dt * 6;
        d.balloon.scale.multiplyScalar(1 - dt * 0.25);
        if (d.balloon.position.y > 40) d.balloon.visible = false;
      }
      if (d.container && d.container.opened) {
        d.beam.visible = false;
        d.crate.scale.multiplyScalar(Math.max(0.001, 1 - dt * 3));
      }
    }
  }

  onStorm(phase, storm) {
    if (phase === 'wait' && storm.phase >= 1 && storm.phase <= 4) setTimeout(() => { if (this.state === 'match' && !this.over) this.spawnSupplyDrop(); }, 6000);
    if (phase === 'wait') {
      this.hud.announce('Storm eye forming', `Shrinks in ${formatTime(storm.timer)} — get inside the white circle`, 4, 'storm');
    } else if (phase === 'shrink') {
      this.hud.announce('The storm is closing in!', 'Move to the safe zone', 3.5, 'storm');
      this.audio.warning();
    }
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.fpsAcc = (this.fpsAcc || 0) + dt;
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) {
      $('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps · ${this.renderer.renderer.info.render.calls} draws`;
      this.fpsAcc = 0; this.fpsN = 0;
    }
    try {
      if (this.state === 'match') this.updateMatch(dt);
      else if (this.state === 'lobby') this.updateLobby(dt);
      this.updateWorld(dt);
      this.renderer.render(dt, this.worldTime || 0);
    } catch (e) {
      console.error(e);
      if (!this.errorShown) { this.errorShown = true; $('fps').hidden = false; $('fps').textContent = 'Error: ' + e.message; }
    }
    this.input.endFrame && this.input.endFrame();
    window.__frames = (window.__frames || 0) + 1;
  }

  // Debug helper: run the match logic for a while without rendering (used by the automated tests).
  simulate(seconds, step = 1 / 30) {
    let t = 0;
    const cam = this.camera.position;
    while (t < seconds && this.state === 'match') {
      this.updateMatch(step);
      this.props.update(step, cam);
      this.pieces.update(step);
      this.pickups.update(step, cam);
      this.effects.update(step);
      this.input.endFrame();
      t += step;
    }
    const bots = this.bots.map((b) => b.a.alive ? b.state : 'dead');
    const count = (k) => bots.filter((x) => x === k).length;
    return {
      time: +this.time.toFixed(1), alive: this.aliveCount(), storm: this.storm.state, phase: this.storm.phase,
      radius: +this.storm.radius.toFixed(0), states: { bus: count('bus'), travel: count('travel'), fight: count('fight'), heal: count('heal') },
      modes: this.actors.reduce((m, a) => { const k = a.alive ? a.mode : 'dead'; m[k] = (m[k] || 0) + 1; return m; }, {}),
      kills: this.actors.filter((a) => a.kills).map((a) => a.name + ':' + a.kills).join(' '),
      armed: this.actors.filter((a) => a.alive && a.inv.slots.some((x) => x && x.type === 'weapon')).length,
      pieces: [...this.pieces.pieces.values()].filter((p) => !p.house).length,
      chestsOpened: this.pickups.chests.filter((c) => c.opened).length,
      over: this.over, winner: this.winner ? this.winner.name : null,
    };
  }

  updateWorld(dt) {
    this.worldTime = (this.worldTime || 0) + dt;
    updateShared(this.worldTime, this.renderer);
    const cam = this.camera.position;
    this.water.userData.update(this.worldTime, this.renderer);
    this.terrain.updateLod(cam);
    if (this.grass) this.grass.userData.update(cam);
    this.props.update(dt, cam);
    this.pieces.update(dt);
    this.pickups.update(dt, cam);
    this.effects.update(dt);
    this.storm.update(this.state === 'match' && !this.paused ? 0 : 0); // time advances in updateMatch
    if (this.windmill) this.windmill.blades.rotation.z += dt * 0.8;
    // chest hum and sparkles near the camera
    let chestD = 99;
    for (const c of this.pickups.chests) {
      if (c.opened) continue;
      const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
      if (d < chestD) chestD = d;
      if (d < 25 && Math.random() < dt * 6) this.effects.sparkle(new THREE.Vector3(c.x, c.y, c.z));
    }
    if (this.state === 'match') this.audio.setChest(clamp(1 - chestD / 14, 0, 1));
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    this.audio.setListener(cam, f);
  }

  updateMatch(dt) {
    const inp = this.input;
    // menus
    if (inp.hit('Escape') || inp.hit('KeyP')) { if (this.mapOpen) this.toggleMap(false); else this.setPaused(!this.paused); }
    if (inp.hit('KeyM') || inp.hit('Tab')) this.toggleMap();
    if (this.paused) { this.rig.update(0, this.player); return; }
    this.time += dt;
    const p = this.player;
    // controllers
    if (p.alive) this.controller.update(dt);
    for (const b of this.bots) b.update(dt);
    this.airship.update(dt);
    for (const a of this.actors) {
      a.update(dt);
      if (a.alive && a.mode === 'ground') this.autoPickup(a);
    }
    this.combat.update(dt);
    this.storm.update(dt);
    this.stormTick -= dt;
    if (this.stormTick <= 0) {
      this.stormTick = 1;
      for (const a of this.actors) {
        if (a.alive && a.mode !== 'bus' && this.storm.isOutside(a.pos.x, a.pos.z)) a.takeDamage(this.storm.dps, null, { storm: true });
      }
    }
    this.weakPoint.update(dt);
    this.updateDrops(dt);
    // camera
    if (this.photo) {
      this.camera.position.copy(this.photo.pos);
      this.camera.lookAt(this.photo.target);
      if (this.photo.fov) { this.camera.fov = this.photo.fov; this.camera.updateProjectionMatrix(); }
    } else if (p.alive || !this.spectating) {
      this.controller.updateCamera(dt);
    } else {
      if (!this.spectating.alive) this.spectating = this.actors.find((a) => a.alive && a !== p) || null;
      if (this.spectating) {
        this.rig.yaw = damp(this.rig.yaw, this.spectating.yaw, 3, dt);
        this.rig.pitch = damp(this.rig.pitch, -0.2, 3, dt);
        this.rig.update(dt, this.spectating, {});
      }
    }
    const focus = p.alive ? p.pos : this.spectating ? this.spectating.pos : p.pos;
    this.renderer.updateShadow(p.mode === 'bus' ? this.airship.pos.clone().setY(this.terrain.heightAt(this.airship.pos.x, this.airship.pos.z)) : focus);
    // screen effects
    const grade = this.renderer.grade;
    if (grade) {
      const inStorm = this.storm.isOutside(this.camera.position.x, this.camera.position.z);
      this.stormFx = damp(this.stormFx || 0, inStorm ? 1 : 0, 3, dt);
      grade.uniforms.uStorm.value = this.stormFx;
      this.damageFlash = Math.max(0, (this.damageFlash || 0) - dt * 2.2);
      grade.uniforms.uDamage.value = this.damageFlash * 0.7 + (p.alive && p.health < 30 ? 0.18 + Math.sin(this.time * 5) * 0.06 : 0);
      this.healFlash = Math.max(0, (this.healFlash || 0) - dt * 1.5);
      grade.uniforms.uHeal.value = this.healFlash;
      grade.uniforms.uScope.value = this.controller.scope && p.alive ? 1 : 0;
      const fog = this.scene.fog;
      fog.color.copy(this.renderer.baseFog).lerp(new THREE.Color('#6b3fa8'), this.stormFx * 0.8);
      fog.density = this.renderer.baseFogD * (1 + this.stormFx * 6);
    }
    // audio beds
    const inStormP = p.alive && this.storm.isOutside(p.pos.x, p.pos.z);
    const stormD = this.storm.state !== 'idle' ? this.storm.distOutside(this.camera.position.x, this.camera.position.z) : -999;
    this.audio.setStorm(inStormP ? 1 : clamp(1 - Math.abs(stormD) / 60, 0, 0.5));
    this.audio.setWind(p.mode === 'sky' ? 0.6 + (p.dive || 0) * 0.4 : p.mode === 'glide' ? 0.35 : 0);
    const shipD = this.airship.active ? this.airship.pos.distanceTo(this.camera.position) : 999;
    this.audio.setEngine(p.mode === 'bus' ? 1 : clamp(1 - shipD / 250, 0, 1));
    if (inStormP && Math.random() < dt * 0.1) this.audio.thunder();
    this.hud.update(dt);
  }
}

// ----------------------------------------------------------------------------- boot
const game = new Game();
window.__game = game;
game.init().catch((e) => {
  console.error(e);
  const el = $('load-tip');
  if (el) el.textContent = 'Could not start the game: ' + e.message;
});
