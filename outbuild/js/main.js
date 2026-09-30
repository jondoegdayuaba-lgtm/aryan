// Outbuild — an original island battle royale with building. Game orchestration: lobby, match, results.
import * as THREE from 'three';
import { GAME, DEFAULT_SETTINGS, QUALITY, WORLD, PLAYER, RARITIES, MATS, MAPS, DUEL_STORM, STORM } from './config.js';
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
import { LOBBY, DUEL_LOBBY } from './layout.js';
import { DuelWorld } from './duel.js';
import { Net, v3, toV } from './net.js';

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
    this.actorById = new Map();
    this.bots = [];
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
    if (u.get('map')) s.map = u.get('map');
    return s;
  }
  saveSettings() { try { localStorage.setItem('outbuild.settings', JSON.stringify(this.settings)); } catch { /* private mode */ } }
  loadStats() {
    try { return { matches: 0, wins: 0, kills: 0, best: 0, ...JSON.parse(localStorage.getItem('outbuild.stats') || '{}') }; } catch { return { matches: 0, wins: 0, kills: 0, best: 0 }; }
  }
  saveStats() { try { localStorage.setItem('outbuild.stats', JSON.stringify(this.stats)); } catch { /* ignore */ } }

  async init() {
    const canvas = $('game');
    // tips while the island is generated
    const tips = [
      'Hit the glowing blue spot while harvesting for bonus materials.',
      'Wood builds fastest; metal is the strongest.',
      'Press F on your own wall to add a window or a door.',
      'Look down and hold W while skydiving to dive faster.',
      'Supply drops float down with epic and legendary loot. Follow the blue beam.',
      'Shield Flasks stack up to 50 shield. Shield Jugs go all the way to 100.',
      'Running up ramps while placing more is the fastest way to high ground.',
      'Headshots deal extra damage, especially with the Bolt Sniper.',
      'Click the map (M) to place a marker; it shows on your compass.',
    ];
    let tipI = Math.floor(Math.random() * tips.length);
    const showTip = () => { const el = $('load-tip'); if (el) el.textContent = tips[tipI++ % tips.length]; };
    showTip();
    this.tipTimer = setInterval(showTip, 2600);
    if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
      const el = document.createElement('p');
      el.className = 'touch-note';
      el.textContent = 'Outbuild is made for a keyboard and mouse. On a touch screen you can look around the lobby, but you will need a computer to play.';
      $('loading-screen').appendChild(el);
    }
    this.renderer = new Renderer(canvas);
    this.scene = this.renderer.scene;
    this.camera = this.renderer.camera;
    this.renderer.setTime(this.pickTime());
    this.renderer.setQuality(this.settings.quality);
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusic(this.settings.music);
    this.net = new Net(this);
    this.ui = new UI(this);
    const bar = $('load-fill');
    this.assets = new Assets();
    await this.assets.load((p) => { bar.style.width = `${(p * 80) | 0}%`; });
    await this.tick();
    this.mapKey = MAPS[this.settings.map] ? this.settings.map : 'island';
    this.terrain = new Terrain(GAME.seed, this.mapKey);
    this.physics = new Physics(this.terrain);
    this.pieces = new PieceSystem(this.scene, this.physics, this.terrain, this.assets);
    this.pickups = new PickupSystem(this.scene, this.assets, this.terrain, this.physics);
    this.buildLevel();
    bar.style.width = '88%';
    await this.tick();
    this.terrain.buildSplat();
    this.terrain.buildHeightTexture();
    this.scene.add(this.terrain.buildMesh(this.assets.textures));
    this.textures = this.assets.textures;
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
    this.hud.buildMap(this.terrain, this.pieces, MAPS[this.mapKey].view);
    this.pieces.onDestroyed = (p, cause, b) => {
      if (cause === 'clear') return;
      this.effects.debris(b, p.mat);
      this.audio.breakPiece(p.mat, new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2));
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'match' && !this.mapOpen && !this.over && this.player && this.player.alive) this.setPaused(true);
    };
    $('bigmap').addEventListener('mousedown', (e) => { e.preventDefault(); this.placeMarker(e, e.button === 2); });
    $('bigmap').addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      // the map must close with M/Tab/Esc even while the pointer is free
      if (this.state === 'match' && this.mapOpen && ['KeyM', 'Tab', 'Escape'].includes(e.code)) {
        e.preventDefault();
        this.input.pressed.delete(e.code);
        this.toggleMap(false);
      }
    });
    bar.style.width = '100%';
    // warm up shaders so the first frames don't hitch
    this.renderer.renderer.compile(this.scene, this.camera);
    this.enterLobby();
    clearInterval(this.tipTimer);
    $('loading-screen').classList.add('done');
    setTimeout(() => $('loading-screen').remove(), 800);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // online: a hidden tab gets no animation frames, but friends still need the match to run
    this.bgLast = performance.now();
    setInterval(() => this.backgroundTick(), 50);
  }

  backgroundTick() {
    const now = performance.now();
    let el = Math.min(1, (now - this.bgLast) / 1000);
    this.bgLast = now;
    if (!document.hidden || this.state !== 'match' || !this.net.active) return;
    const cam = this.camera.position;
    while (el > 1e-3) {
      const step = Math.min(0.05, el);
      el -= step;
      this.updateMatch(step);
      this.pieces.update(step);
      this.pickups.update(step, cam);
    }
    this.last = now;
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
    // start from the untouched heightmap so every build of the island (on every player's computer) is identical
    this.terrain.heights.set(this.terrain.base);
    this.props = new PropSystem(this.scene, this.physics, this.assets);
    this.props.onDestroyed = (p) => {
      if (this.effects) this.effects.propBreak(p);
      if (this.audio) this.audio.breakPiece(p.mat, new THREE.Vector3(p.x, p.y + 1, p.z));
    };
    const WorldType = this.mapKey === 'duel' ? DuelWorld : World;
    this.world = new WorldType({ seed: GAME.seed, terrain: this.terrain, pieces: this.pieces, props: this.props }).build();
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
    this.actorById = new Map();
    this.bots = [];
    this.player = null;
    this.clearNetProjectiles();
    this.building.hideGhost();
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
    const L = this.mapKey === 'duel' ? DUEL_LOBBY : LOBBY;
    const h = this.physics.groundAt(L.x, L.z, 200, 0.3, 300);
    return { pos: new THREE.Vector3(L.x, h, L.z), yaw: L.yaw };
  }

  // Swap the whole world for another map: heightmap, ground textures, buildings, props, grass and the map screen.
  switchMap(key) {
    if (!MAPS[key] || key === this.mapKey) return;
    this.mapKey = key;
    this.terrain.setMap(key);
    this.buildLevel();
    this.scene.add(this.terrain.rebuildMesh(this.textures));
    this.makeGrass();
    this.hud.buildMap(this.terrain, this.pieces, MAPS[key].view);
    this.lobbySpot = null;
    this.played = false;
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
    const net = this.net;
    if (net.isClient || this.state !== 'lobby') return;
    this.audio.init();
    this.audio.stopMusic();
    const seed = (Math.random() * 1e9) | 0;
    this.rng = new Rng(seed);
    const online = net.isHost && net.conns.size > 0;
    net.mute++;
    const mapKey = MAPS[this.settings.map] ? this.settings.map : 'island';
    if (mapKey !== this.mapKey) this.switchMap(mapKey);
    else if (this.played) this.buildLevel();
    const duel = MAPS[this.mapKey].mode === 'duel';
    this.played = true;
    this.prepareMatch();
    this.spawnLoot(this.rng);
    // actors
    const s = this.settings;
    this.player = new Actor(this, { name: online ? net.me().name : 'You', isPlayer: true, outfit: s.outfit, skin: SKIN_TONES[s.skin ?? 1] });
    this.player.human = true;
    this.actors = [this.player];
    if (online) {
      net.hostCreateRemotes((c) => {
        const a = new Actor(this, { name: c.name, outfit: Math.abs(c.outfit) % OUTFITS.length, skin: SKIN_TONES[Math.abs(c.skin) % SKIN_TONES.length] });
        a.human = true;
        this.actors.push(a);
        return a;
      });
    }
    // bots fill the match up to the chosen size (a duel needs just one opponent)
    const nBots = duel ? Math.max(0, 2 - this.actors.length) : Math.max(0, s.bots - (this.actors.length - 1));
    this.bots = [];
    for (let i = 0; i < nBots; i++) {
      const a = new Actor(this, { name: botName(this.rng), outfit: this.rng.int(0, OUTFITS.length - 1), skin: this.rng.pick(SKIN_TONES) });
      const b = new BotBrain(this, a, new Rng(seed + i * 31 + 7), s.difficulty);
      a.brain = b;
      this.actors.push(a);
      this.bots.push(b);
    }
    this.actorById = new Map(this.actors.map((a) => [a.id, a]));
    this.makeController();
    const spawns = [];
    if (duel) {
      // everyone starts on the ground, fully equipped, with a short countdown
      this.airship.active = false;
      this.airship.group.visible = false;
      const extra = this.world.spawns.slice(2).sort(() => this.rng.next() - 0.5);
      const order = this.world.spawns.slice(0, 2).concat(extra);
      this.actors.forEach((a, i) => {
        const sp = order[i % order.length];
        this.placeOnGround(a, sp.x, sp.z, sp.yaw);
        this.giveLoadout(a);
        spawns.push([a.id, sp.x, sp.z, sp.yaw]);
      });
      this.freezeT = 3.5;
      this.rig.yaw = this.player.intent.yaw;
      this.rig.pitch = -0.1;
      this.storm.reset(DUEL_STORM);
    } else {
      this.freezeT = 0;
      this.airship.start(this.rng);
      for (const b of this.bots) b.planDrop(this.airship);
      this.rig.yaw = Math.atan2(this.airship.dir.x, this.airship.dir.z);
      this.rig.pitch = -0.25;
      this.storm.reset(STORM);
    }
    this.storm.start(this.rng);
    this.stormTick = 1;
    net.mute--;
    if (online) {
      net.installHostProxies();
      const msg = {
        t: 'start', tod: this.renderer.timeKey, map: this.mapKey, ship: duel ? null : this.airship.route0, spawns,
        freeze: this.freezeT,
        actors: this.actors.map((a) => [a.id, a.name, a.look.outfit, a.look.skin, a.human ? 1 : 0]),
        containers: this.pickups.chests.map((c) => [c.id, c.kind, c.x, c.y, c.z, c.yaw]),
        pickups: this.pickups.list.map((p) => [p.id, p.item, p.x, p.y, p.z]),
      };
      for (const c of net.conns.values()) if (c.actor) net.send(c.conn, { ...msg, you: c.actor.id });
    }
    this.beginMatch();
  }

  // Shared by the host and online clients.
  prepareMatch() {
    this.lobbyChar.root.visible = false;
    this.time = 0;
    this.over = false;
    this.placement = 0;
    this.winner = null;
    this.marker = null;
    this.spectating = null;
  }

  makeController() {
    const s = this.settings;
    this.controller = new PlayerController(this, this.player, this.input, this.rig);
    this.controller.sens = s.sensitivity;
    this.controller.invertY = s.invertY;
    this.rig.baseFov = s.fov;
  }

  beginMatch() {
    this.state = 'match';
    this.ui.showMatch();
    this.hud.show(true);
    this.input.enabled = true;
    this.input.lock();
    this.paused = false;
    if (this.freezeT > 0) {
      const n = this.actors.length;
      this.hud.announce(MAPS[this.mapKey].name, n > 2 ? `${n} players · last one standing wins` : 'One opponent · last one standing wins', 2.5);
      this.countdown = -1;
    } else this.hud.announce('Board the airship', 'Press SPACE to jump when you are over a place you like', 4);
  }

  // Duel start: stand on the ground at a spawn point, facing the middle.
  placeOnGround(a, x, z, yaw) {
    a.mode = 'ground';
    a.pos.set(x, this.physics.groundAt(x, z, 200, 0.3, 300), z);
    a.vel.set(0, 0, 0);
    a.grounded = true;
    a.hittable = true;
    a.fallStartY = a.pos.y;
    a.yaw = yaw;
    a.intent.yaw = yaw;
    a.intent.pitch = 0;
    a.model.root.visible = true;
    if (a.brain) { a.brain.aimYaw = yaw; a.brain.landedAt = 0; }
  }

  giveLoadout(a) {
    const inv = a.inv;
    const w = (id, rarity) => ({ type: 'weapon', id, rarity, mag: WEAPONS[id].mag });
    inv.slots = [w('ar', 3), w('pump', 3), w('smg', 2), { type: 'consumable', id: 'shieldSmall', count: 4 },
      { type: 'consumable', id: 'medkit', count: 2 }];
    inv.selected = 0;
    inv.ammo = { light: 240, medium: 240, heavy: 0, shells: 40, rockets: 0 };
    inv.mats = { wood: 500, stone: 400, metal: 300 };
    a.shield = 100;
  }

  // Online client: the host started a match. Build the same island, loot and players, then follow the host.
  startClientMatch(m) {
    const ui = this.ui;
    if (this.state === 'match') ui.toLobby(true);
    ui.starting = false;
    $('matchmaking').hidden = true;
    $('death').hidden = true;
    $('victory').hidden = true;
    this.audio.init();
    this.audio.stopMusic();
    this.rng = new Rng((Math.random() * 1e9) | 0);
    const mapKey = MAPS[m.map] ? m.map : 'island';
    if (mapKey !== this.mapKey) this.switchMap(mapKey);
    else if (this.played) this.buildLevel();
    this.played = true;
    if (m.tod && TIMES[m.tod] && this.renderer.timeKey !== m.tod) this.renderer.setTime(m.tod);
    this.prepareMatch();
    for (const c of m.containers) this.pickups.addContainer(c[1], c[2], c[3], c[4], c[5], c[0]);
    for (const p of m.pickups) this.pickups.spawn(p[1], p[2], p[3], p[4], { id: p[0] });
    this.actors = [];
    this.player = null;
    for (const [id, name, outfit, skin, human] of m.actors) {
      const me = id === m.you;
      const a = new Actor(this, { id, name, isPlayer: me, outfit, skin });
      a.human = !!human;
      if (me) { a.netLocal = true; this.player = a; } else a.puppet = true;
      this.actors.push(a);
    }
    this.actorById = new Map(this.actors.map((a) => [a.id, a]));
    this.bots = [];
    this.makeController();
    this.freezeT = m.freeze || 0;
    if (m.ship) {
      this.airship.startFrom(m.ship[0], m.ship[1]);
      this.rig.yaw = Math.atan2(this.airship.dir.x, this.airship.dir.z);
      this.rig.pitch = -0.25;
    } else {
      this.airship.active = false;
      this.airship.group.visible = false;
      for (const [id, x, z, yaw] of m.spawns || []) {
        const a = this.actorById.get(id);
        if (a) this.placeOnGround(a, x, z, yaw);
      }
      this.rig.yaw = this.player.intent.yaw;
      this.rig.pitch = -0.1;
    }
    this.storm.reset(MAPS[mapKey].mode === 'duel' ? DUEL_STORM : STORM);
    this.storm.net = true;
    this.stormTick = 1;
    this.beginMatch();
    // the match started from the network, not a click, so the mouse may still be free
    setTimeout(() => { if (this.state === 'match' && !this.input.locked && !this.mapOpen) this.setPaused(true); }, 400);
  }

  // Leaving a match early (or the host starting a new one): tell the others.
  leaveMatch(silent = false) {
    const net = this.net;
    if (this.state !== 'match') return;
    if (net.isHost && !this.over && net.conns.size) net.broadcast({ t: 'abort' });
    else if (net.isClient && !silent && this.player && this.player.alive) net.send(net.hostConn, { t: 'quit' });
  }

  aliveCount() { let n = 0; for (const a of this.actors) if (a.alive) n++; return n; }

  setPaused(p) {
    if (this.over) return;
    this.paused = p;
    $('pause-title').textContent = this.net.active ? 'Menu' : 'Paused';
    this.ui.showPause(p);
    if (!p) this.input.lock();
    else this.input.unlock();
  }

  toggleMap(open = !this.mapOpen) {
    this.mapOpen = open;
    $('bigmap-wrap').hidden = !open;
    // free the mouse so a marker can be placed; take it back when the map closes
    if (this.state === 'match' && !this.over) {
      if (open) this.input.unlock();
      else if (!this.paused && (!this.player || this.player.alive)) this.input.lock();
    }
  }

  placeMarker(e, clear = false) {
    if (clear) { this.marker = null; return; }
    const c = $('bigmap');
    const r = c.getBoundingClientRect();
    const M = this.hud.mapSize || WORLD.size;
    const x = (e.clientX - r.left) / r.width * M - M / 2;
    const z = (e.clientY - r.top) / r.height * M - M / 2;
    this.marker = { x, z };
    this.audio.ui();
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
      this.net.emit('co', c.id);
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
      this.tell(actor, 'full');
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
    this.tell(actor, 'pickup');
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
      this.tell(actor, 'pickup');
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
  // A private message for a friend's player (hosting online).
  tell(actor, ...msg) { if (actor.remote) this.net.emit('msg', actor.id, ...msg); }

  kick(def) {
    const kick = def.kick * (this.controller.ads ? 0.6 : 1);
    this.rig.pitch += kick;
    this.rig.yaw += (Math.random() - 0.5) * kick * 0.5;
    this.rig.addShake(def.recoil * 0.25);
  }

  onFire(actor, w, def, muzzle) {
    this.audio.gun(def.id, muzzle, actor.isPlayer);
    if (actor.isPlayer) this.kick(def);
    this.net.emit('fire', actor.id, def.id, v3(muzzle));
  }

  onHitConfirm(attacker, target, amount, head, point, shield) {
    if (attacker && attacker.remote) this.net.emit('hit', attacker.id, amount, head, v3(point), shield);
    if (!attacker || !attacker.isPlayer) return;
    this.hud.hitMarker(head);
    this.hud.damageNumber(point, amount, head, shield);
    this.audio.hitmarker(head, shield);
  }

  onDamage(victim, amount, source, opts) {
    if (victim.remote) {
      this.net.emit('hurt', victim.id, amount, source && source !== victim && source.pos ? v3(source.pos) : null,
        opts.toShield || 0, !!opts.shieldBroken, !!opts.storm);
    }
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
    this.net.emit('death', victim.id, killer ? killer.id : 0,
      { storm: !!opts.storm, fall: !!opts.fall, left: !!opts.left, weapon: opts.weapon || null, head: !!opts.head }, place);
    this.announceDeath(victim, killer, opts);
    if (this.aliveCount() <= 1) this.finish();
  }

  // Kill feed, banners and the death screen; the same on the host and on online clients.
  announceDeath(victim, killer, opts) {
    const nm = (a) => `<b class="${a.isPlayer ? 'me' : ''}">${a.name}</b>`;
    let msg;
    if (opts.left) msg = `${nm(victim)} left the match`;
    else if (opts.storm) msg = `${nm(victim)} was lost in the storm`;
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
  }

  // Online client: someone was eliminated on the host.
  netDeath([vid, kid, opts, place]) {
    const v = this.actorById.get(vid);
    if (!v || !v.alive) return;
    const k = kid ? this.actorById.get(kid) || null : null;
    v.health = 0;
    v.alive = false;
    v.mode = 'dead';
    v.deathTime = this.time;
    v.vel.set(0, 0, 0);
    v.buildMode = false;
    v.setGlider(false);
    v.placement = place;
    if (v === this.player) this.building.hideGhost();
    this.announceDeath(v, k, opts || {});
  }

  netEnd(wid) { this.finish(this.actorById.get(wid) || null); }

  playerDied(killer) {
    this.placement = this.aliveCount() + 1;
    this.stats.matches++;
    this.stats.kills += this.player.kills;
    this.saveStats();
    this.spectating = killer && killer.alive ? killer : null;
    setTimeout(() => { if (this.state === 'match') this.ui.showDeath(killer); }, 1600);
  }

  finish(winnerIn) {
    if (this.over) return;
    const winner = winnerIn !== undefined ? winnerIn : this.actors.find((a) => a.alive);
    this.winner = winner;
    this.over = true;
    this.net.emit('end', winner ? winner.id : 0);
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
  onEdit(actor, piece) {
    if (actor.isPlayer) this.audio.build(piece.mat, new THREE.Vector3(piece.ix * 4 + 2, piece.iy * 3 + 1.5, piece.iz * 4 + 2), true);
  }
  onNoMats(actor, mat) {
    if (actor.isPlayer) this.hud.announce(`Not enough ${MATS[mat].label.toLowerCase()}`, 'Harvest more with your harvesting tool', 1.2, 'small');
    this.tell(actor, 'nomats', mat);
  }
  onBuildMat(mat) { this.audio.ui(); }
  onSwing(actor) { if (actor.isPlayer) this.audio.swing(true); }
  onHarvest(actor, mat, amount, point, weak) {
    if (actor.isPlayer) this.hud.matGain(mat, amount);
    if (actor.remote) this.net.emit('harv', actor.id, mat, amount);
  }
  onHarvestHit(actor, mat, point, owner, weak, normal) {
    this.audio.harvest(mat, point, actor.isPlayer, weak);
    this.net.emit('snd', 'hv', mat, v3(point), actor.id, !!weak);
    if (actor.isPlayer && owner && owner.alive !== false && normal) this.weakPoint.place(point, normal, owner);
  }
  onReload(actor, w) {
    this.audio.reload(actor.pos, actor.isPlayer);
    this.net.emit('snd', 'rl', v3(actor.pos), actor.id);
  }
  onEmpty(actor) {
    if (actor.isPlayer) { this.audio.empty(); this.hud.announce('Out of ammo', '', 1, 'small'); }
    this.tell(actor, 'empty');
  }
  onUse(actor, item) {
    if (actor.isPlayer) this.audio.heal(!!CONSUMABLES[item.id].shield);
    this.tell(actor, 'use', !!CONSUMABLES[item.id].shield);
  }
  onConsumed(actor, item) { if (actor.isPlayer) this.healFlash = 1; this.tell(actor, 'healed'); }
  onCantUse(actor, item) {
    if (actor.isPlayer) this.hud.announce(CONSUMABLES[item.id].shield ? 'Shield is full' : 'Health is full', '', 1, 'small');
    this.tell(actor, 'cantuse', !!CONSUMABLES[item.id].shield);
  }
  onThrow(actor) {
    actor.model.state.throwT = 0.26;
    this.net.emit('throw', actor.id);
  }
  onExplosion(pos) {
    this.audio.explosion(pos);
    this.net.emit('snd', 'ex', v3(pos));
  }

  // ------------------------------------------------------------------ online client: what the host tells us
  netPieceAdd([model, ix, iy, iz, axis, dir, ownerId, build]) {
    const slot = { ix, iy, iz };
    if (axis !== null) slot.axis = axis;
    if (dir !== null) slot.dir = dir;
    const owner = this.actorById.get(ownerId) || null;
    const p = this.pieces.add(model, slot, { build, owner });
    if (p && owner) this.onBuild(owner, p);
  }

  netPickupSpawn([id, item, x, y, z, vx, vy, vz, settled]) {
    if (this.pickups.byId(id)) return;
    const p = this.pickups.spawn(item, x, y, z, { id, toss: !settled });
    if (!settled) { p.vx = vx; p.vy = vy; p.vz = vz; }
  }

  netSound([kind, a, b, c, d], me) {
    if (kind === 'hv') this.audio.harvest(a, toV(b), c === me, d);
    else if (kind === 'rl') { if (b !== me) this.audio.reload(toV(a), false); }
    else if (kind === 'ex') this.audio.explosion(toV(a));
  }

  netPrivate([kind, arg]) {
    const hud = this.hud;
    switch (kind) {
      case 'pickup': this.audio.pickup(); break;
      case 'full': hud.announce('Inventory full', 'Select a slot to swap it out', 1.5, 'small'); break;
      case 'nomats': if (MATS[arg]) hud.announce(`Not enough ${MATS[arg].label.toLowerCase()}`, 'Harvest more with your harvesting tool', 1.2, 'small'); break;
      case 'empty': this.audio.empty(); hud.announce('Out of ammo', '', 1, 'small'); break;
      case 'use': this.audio.heal(!!arg); break;
      case 'healed': this.healFlash = 1; break;
      case 'cantuse': hud.announce(arg ? 'Shield is full' : 'Health is full', '', 1, 'small'); break;
      default:
    }
  }

  // Rockets and grenades in flight, drawn from the host's snapshots.
  netProjectiles(list) {
    const np = this.netProj || (this.netProj = []);
    while (np.length > list.length) this.scene.remove(np.pop().mesh);
    list.forEach((q, i) => {
      let p = np[i];
      if (!p || p.kind !== q[0]) {
        if (p) this.scene.remove(p.mesh);
        const mesh = this.assets.flat(q[0] === 'r' ? 'Projectile_Rocket' : 'Grenade', { shadows: false });
        if (q[0] === 'g') mesh.scale.setScalar(1.3);
        this.scene.add(mesh);
        p = np[i] = { kind: q[0], mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), trail: 0 };
      }
      p.pos.set(q[1], q[2], q[3]);
      p.vel.set(q[4], q[5], q[6]);
    });
  }

  updateNetProjectiles(dt) {
    if (!this.netProj) return;
    const d = new THREE.Vector3();
    for (const p of this.netProj) {
      if (p.kind === 'g') p.vel.y -= 20 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind === 'r') {
        d.copy(p.vel).normalize();
        p.mesh.lookAt(p.pos.clone().sub(d));
        p.trail -= dt;
        if (p.trail <= 0) { p.trail = 0.02; this.effects.rocketTrail(p.pos); }
      } else {
        p.mesh.rotation.x += dt * 6;
      }
    }
  }

  clearNetProjectiles() {
    if (this.netProj) for (const p of this.netProj) this.scene.remove(p.mesh);
    this.netProj = [];
  }

  // A crate that floats down under a balloon with top-tier loot.
  spawnSupplyDrop(cid = null, x = 0, z = 0) {
    const s = this.storm;
    if (cid === null) {
      for (let i = 0; i < 30; i++) {
        const a = this.rng.float(0, Math.PI * 2), r = Math.sqrt(this.rng.next()) * s.next.r * 0.7;
        x = s.next.c.x + Math.cos(a) * r;
        z = s.next.c.y + Math.sin(a) * r;
        if (this.terrain.heightAt(x, z) > 1.5 && this.world.isFree(x, z, 3)) break;
      }
      cid = this.pickups.nextContainerId();
      this.net.emit('drop', cid, x, z);
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
    const drop = { cid, group, crate, balloon, beam, x, z, y: ground + 150, ground, landed: false, t: 0 };
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
          const c = { id: d.cid, kind: 'supply', group: d.group, lid: null, x: d.x, y: d.ground, z: d.z, yaw: d.group.rotation.y, opened: false,
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
    if (phase === 'wait' && storm.phase >= 1 && storm.phase <= 4 && !this.net.isClient && MAPS[this.mapKey].mode === 'royale') setTimeout(() => { if (this.state === 'match' && !this.over) this.spawnSupplyDrop(); }, 6000);
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
    if ((inp.hit('KeyM') || inp.hit('Tab')) && !this.mapOpen) this.toggleMap(true);
    // online the match keeps going while the menu is open
    if (this.paused && !this.net.active) { this.rig.update(0, this.player); return; }
    const client = this.net.isClient;
    this.time += dt;
    const p = this.player;
    // duel countdown: nobody moves until it ends
    let frozen = false;
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      const n = Math.ceil(this.freezeT);
      if (n !== this.countdown && this.freezeT < 3) {
        this.countdown = n;
        if (n > 0) { this.hud.announce(String(n), '', 0.9, 'count'); this.audio.ui('hover'); } else { this.hud.announce('FIGHT!', '', 1.2, 'count'); this.audio.warning(); }
      }
      frozen = this.freezeT > 0;
    }
    // controllers
    if (p.alive) this.controller.update(dt);
    for (const b of this.bots) b.update(dt);
    if (frozen) {
      for (const a of this.actors) {
        const it = a.intent;
        it.moveX = it.moveZ = 0; it.fire = it.firePressed = it.jump = it.place = it.interact = false; it.buildMode = false;
      }
    }
    this.airship.update(dt);
    for (const a of this.actors) {
      a.update(dt);
      if (!client && a.alive && a.mode === 'ground') this.autoPickup(a);
    }
    if (client) this.updateNetProjectiles(dt);
    else this.combat.update(dt);
    this.storm.update(dt);
    this.stormTick -= dt;
    if (this.stormTick <= 0 && !client && !this.over) {
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
    this.updateNameTags();
    if (this.net.isHost) this.net.hostTick(dt);
    else if (client) this.net.clientTick(dt);
  }

  // Friends' names over their heads (online).
  updateNameTags() {
    const host = $('nametags');
    const tags = this.nameTags || (this.nameTags = new Map());
    const seen = new Set();
    if (this.net.active) {
      const v = new THREE.Vector3();
      const cam = this.camera.position;
      for (const a of this.actors) {
        if (!a.human || a === this.player || !a.alive || a.mode === 'bus' || !a.model.root.visible) continue;
        const d = a.pos.distanceTo(cam);
        if (d > 150) continue;
        v.copy(a.model.root.position).y += a.height + 0.45;
        v.project(this.camera);
        if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
        let el = tags.get(a);
        if (!el) { el = document.createElement('div'); el.className = 'nametag'; el.textContent = a.name; host.appendChild(el); tags.set(a, el); }
        el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
        el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
        el.style.opacity = d > 90 ? String(1 - (d - 90) / 60) : '1';
        seen.add(a);
      }
    }
    for (const [a, el] of tags) if (!seen.has(a)) { el.remove(); tags.delete(a); }
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
