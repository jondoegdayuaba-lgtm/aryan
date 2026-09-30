// An actor is anyone in the match: the player or a bot. Controllers fill in `intent`; the actor moves,
// fights, builds, heals and animates the same way whoever drives it.
import * as THREE from 'three';
import { PLAYER, SKY, HARVEST, MATS, BUILD_COST, WORLD, RARITIES } from './config.js';
import { Inventory, WEAPONS, CONSUMABLES } from './items.js';
import { CharacterModel } from './character.js';
import { clamp, damp } from './util.js';
import { tinted } from './materials.js';

let actorId = 1;

export function newIntent() {
  return {
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false,
    fire: false, firePressed: false, ads: false, reload: false, select: null, interact: false,
    glide: false, place: false, buildSlot: null, buildKind: null, buildMat: 'wood', buildMode: false,
    aimOrigin: null, aimDir: null, fromCamera: false,
  };
}

export class Actor {
  constructor(game, { name, isPlayer = false, outfit = 0, skin = null, id = null }) {
    this.id = id ?? actorId++;
    if (this.id >= actorId) actorId = this.id + 1;
    // online play: `remote` = a friend's player simulated on the host from their input,
    // `puppet` = anyone shown on a client from host snapshots, `netLocal` = a client's own player
    this.remote = false;
    this.puppet = false;
    this.netLocal = false;
    this.netFired = 0;
    this.human = isPlayer;
    this.look = { outfit, skin };
    this.game = game;
    this.name = name;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = PLAYER.radius;
    this.height = PLAYER.height;
    this.yaw = 0;
    this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.shield = 0;
    this.alive = true;
    this.hittable = true;
    this.mode = 'bus';
    this.grounded = false;
    this.inv = new Inventory();
    this.intent = newIntent();
    this.kills = 0;
    this.damageDealt = 0;
    this.matsGathered = 0;
    this.built = 0;
    this.fireCooldown = 0;
    this.reloadT = 0;
    this.reloadTotal = 0;
    this.bloom = 0;
    this.harvestT = -1;
    this.harvestHit = false;
    this.useT = 0;
    this.useTotal = 0;
    this.fired = 0;
    this.lastHitBy = null;
    this.lastDamageTime = -99;
    this.fallStartY = 0;
    this.deathTime = 0;
    this.swimming = false;
    this.buildMode = false;
    this.spawnTime = 0;
    this.heldSig = '';
    this.model = new CharacterModel(game.assets.gltf.character, outfit, skin);
    this.model.root.visible = false;
    this.model.onFootstep = (side, speed) => game.onFootstep && game.onFootstep(this, speed);
    game.scene.add(this.model.root);
    this.glider = null;
  }

  get eyeHeight() { return this.intent.crouch && this.mode === 'ground' ? 1.12 : PLAYER.eye; }

  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }
  chest(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height * 0.62, this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  current() { return this.inv.current(); }

  // ------------------------------------------------------------------ damage
  takeDamage(amount, source = null, opts = {}) {
    if (!this.alive || amount <= 0) return 0;
    let dmg = amount;
    let toShield = 0;
    if (!opts.storm && this.shield > 0) {
      toShield = Math.min(this.shield, dmg);
      this.shield -= toShield;
      dmg -= toShield;
    }
    const toHealth = Math.min(this.health, dmg);
    this.health -= toHealth;
    this.lastDamageTime = this.game.time;
    if (source && source !== this) this.lastHitBy = source;
    this.model.state.hit = 1;
    const total = toShield + toHealth;
    if (this.game.onDamage) this.game.onDamage(this, total, source, { ...opts, shieldBroken: toShield > 0 && this.shield <= 0, toShield });
    if (this.health <= 0) this.die(source, opts);
    return total;
  }

  heal(hp, cap, sh, shCap) {
    if (hp) this.health = Math.min(cap, this.health + hp);
    if (sh) this.shield = Math.min(shCap, this.shield + sh);
  }

  die(source, opts) {
    if (!this.alive) return;
    this.alive = false;
    this.mode = 'dead';
    this.deathTime = this.game.time;
    this.vel.set(0, 0, 0);
    this.buildMode = false;
    this.setGlider(false);
    const killer = source && source !== this ? source : this.lastHitBy;
    if (killer && killer !== this && killer.alive) killer.kills++;
    if (this.game.onDeath) this.game.onDeath(this, killer, opts);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const it = this.intent;
    if (this.puppet) { this.updatePuppet(dt); return; }
    if (!this.alive) {
      this.updateVisual(dt);
      return;
    }
    this.fired = this.netFired;
    this.netFired = 0;
    if (this.remote) {
      // a friend's player: they move on their own machine, the host runs everything else
      this.game.net.hostApplyInput(this);
      this.yaw = it.yaw;
      this.pitch = clamp(it.pitch, -1.45, 1.45);
      if (this.mode === 'ground') {
        this.height = it.crouch && !it.sprint ? PLAYER.crouchHeight : PLAYER.height;
        this.actGround(dt);
      }
      this.updateVisual(dt);
      return;
    }
    this.yaw = it.yaw;
    this.pitch = clamp(it.pitch, -1.45, 1.45);
    switch (this.mode) {
      case 'bus': this.updateBus(dt); break;
      case 'sky': this.updateSky(dt); break;
      case 'glide': this.updateGlide(dt); break;
      default:
        this.moveGround(dt);
        if (this.netLocal) this.actGroundLocal(dt); else this.actGround(dt);
    }
    this.updateVisual(dt);
  }

  // Someone else in an online match, placed from the host's snapshots.
  updatePuppet(dt) {
    const s = this.netState;
    if (s && this.alive) {
      const age = clamp((performance.now() - this.netT) / 1000, 0, 0.2);
      const tx = s[1] + s[6] * age, ty = s[2] + s[7] * age, tz = s[3] + s[8] * age;
      const d2 = (tx - this.pos.x) ** 2 + (ty - this.pos.y) ** 2 + (tz - this.pos.z) ** 2;
      if (!this.netSeen || d2 > 64) this.pos.set(tx, ty, tz);
      else {
        const k = 1 - Math.exp(-dt * 14);
        this.pos.x += (tx - this.pos.x) * k; this.pos.y += (ty - this.pos.y) * k; this.pos.z += (tz - this.pos.z) * k;
      }
      this.netSeen = true;
      this.vel.set(s[6], s[7], s[8]);
      let dy = s[4] - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 16);
      this.pitch = s[5];
      const mode = ['bus', 'sky', 'glide', 'ground', 'dead'][s[9]];
      if (mode !== 'dead' && mode !== this.mode) {
        this.setGlider(mode === 'glide');
        this.mode = mode;
      }
      const f = s[10];
      this.grounded = !!(f & 1);
      this.intent.crouch = !!(f & 2);
      this.intent.sprint = !!(f & 4);
      this.dancing = !!(f & 16);
      this.swimming = !!(f & 32);
      this.health = s[11];
      this.shield = s[12];
      this.netHeld = s[13];
      this.harvestT = s[14];
      this.netReload = s[15];
      this.netUse = s[16];
      this.intent.moveX = s[17];
      this.intent.moveZ = s[18];
      this.dive = s[19];
    }
    this.fired = this.netFired;
    this.netFired = 0;
    this.updateVisual(dt);
  }

  updateBus() {
    const ship = this.game.airship;
    this.hittable = false;
    this.pos.copy(ship.dropPoint);
    this.vel.copy(ship.velocity);
    this.model.root.visible = false;
    if ((this.intent.jump && ship.canDrop) || ship.forceDrop) this.jumpFromBus();
  }

  jumpFromBus() {
    const ship = this.game.airship;
    this.mode = 'sky';
    this.hittable = true;
    this.pos.copy(ship.dropPoint).add(new THREE.Vector3((Math.random() - 0.5) * 2, -3, (Math.random() - 0.5) * 2));
    this.vel.copy(ship.velocity).multiplyScalar(0.5);
    this.vel.y = -8;
    this.model.root.visible = true;
    if (this.game.onJump) this.game.onJump(this);
  }

  groundBelow() { return this.game.physics.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.3, 0.5); }

  updateSky(dt) {
    const it = this.intent;
    const fwd = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).negate();
    // looking down (or pushing forward while looking down) dives faster
    const dive = clamp(-this.pitch * 1.3, 0, 1) * (it.moveZ > 0 ? 1 : 0.4);
    this.dive = dive;
    const targetFall = -(SKY.fallSpeed + (SKY.diveSpeed - SKY.fallSpeed) * dive);
    this.vel.y = damp(this.vel.y, targetFall, 1.5, dt);
    const hs = SKY.airControl * (1 + dive * 0.6);
    const tx = (fwd.x * it.moveZ - right.x * it.moveX) * hs;
    const tz = (fwd.z * it.moveZ - right.z * it.moveX) * hs;
    this.vel.x = damp(this.vel.x, tx, 1.4, dt);
    this.vel.z = damp(this.vel.z, tz, 1.4, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.clampMap();
    const ground = this.groundBelow();
    const h = this.pos.y - ground;
    if (h < SKY.gliderAuto || (it.glide && h < SKY.gliderManual)) this.startGlide();
    if (this.pos.y <= ground) this.land(ground);
  }

  startGlide() {
    this.mode = 'glide';
    this.setGlider(true);
    this.vel.y = Math.max(this.vel.y, -12);
    if (this.game.onGlide) this.game.onGlide(this);
  }

  setGlider(on) {
    if (on && !this.glider) {
      this.glider = this.game.assets.flat('Glider', { tints: { GliderFabric: this.model.outfit.colors.Accent } });
      this.model.setGlider(this.glider);
    } else if (!on && this.glider) {
      this.model.setGlider(null);
      this.glider = null;
    }
  }

  updateGlide(dt) {
    const it = this.intent;
    const fwd = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const boost = it.moveZ > 0 ? 1 : it.moveZ < 0 ? -0.6 : 0;
    const speed = SKY.glideSpeed + boost * (SKY.glideBoost - SKY.glideSpeed);
    const tx = fwd.x * speed + right.x * it.moveX * 6;
    const tz = fwd.z * speed + right.z * it.moveX * 6;
    this.vel.x = damp(this.vel.x, tx, 1.2, dt);
    this.vel.z = damp(this.vel.z, tz, 1.2, dt);
    this.vel.y = damp(this.vel.y, -SKY.glideSink * (boost > 0 ? 1.25 : 1), 2, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.clampMap();
    const ground = this.game.physics.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.3, 0.2);
    if (this.pos.y <= ground + 0.02) this.land(ground);
    else {
      // hitting a wall while gliding: slide along it
      const hit = this.game.physics.query(this.pos.x - 0.4, this.pos.z - 0.4, this.pos.x + 0.4, this.pos.z + 0.4);
      for (const c of hit) {
        if (!c.blocksMove) continue;
        if (this.pos.y + 1.7 > c.minY && this.pos.y < c.maxY - 0.3 && this.game.physics.overlapsFootprint(c, this.pos.x, this.pos.z, 0.4)) {
          const res = { x: 0, z: 0 };
          if (this.game.physics.footprintPush(c, this.pos.x, this.pos.z, 0.4, res)) { this.pos.x += res.x; this.pos.z += res.z; }
        }
      }
    }
  }

  land(ground) {
    this.pos.y = ground;
    this.vel.y = 0;
    this.mode = 'ground';
    this.grounded = true;
    this.fallStartY = ground;
    this.setGlider(false);
    if (this.game.onLand) this.game.onLand(this);
  }

  clampMap() {
    const b = WORLD.size / 2 - 5;
    this.pos.x = clamp(this.pos.x, -b, b);
    this.pos.z = clamp(this.pos.z, -b, b);
  }

  moveGround(dt) {
    const g = this.game;
    const it = this.intent;
    const usingItem = this.useT > 0;
    const crouch = it.crouch && !it.sprint;
    this.height = crouch ? PLAYER.crouchHeight : PLAYER.height;
    let speed = crouch ? PLAYER.crouch : it.sprint && it.moveZ > 0.1 ? PLAYER.sprint : PLAYER.walk;
    if (it.ads && !this.buildMode && !it.sprint) speed = Math.min(speed, PLAYER.adsWalk);
    if (usingItem) speed *= 0.55;
    if (this.swimming) speed = PLAYER.swimSpeed;
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    // right = forward x up = (-cos, 0, sin)
    const rX = -fwdZ, rZ = fwdX;
    let mx = it.moveX, mz = it.moveZ;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const tx = (fwdX * mz + rX * mx) * speed;
    const tz = (fwdZ * mz + rZ * mx) * speed;
    const accel = this.grounded ? PLAYER.accel : PLAYER.airAccel;
    const k = 1 - Math.exp(-accel * dt / Math.max(speed, 1));
    this.vel.x += (tx - this.vel.x) * Math.min(1, k * 2.2);
    this.vel.z += (tz - this.vel.z) * Math.min(1, k * 2.2);
    if (it.jump && (this.grounded || this.swimming)) {
      this.vel.y = PLAYER.jump;
      this.grounded = false;
      this.fallStartY = this.pos.y;
      if (g.onJumpGround) g.onJumpGround(this);
    }
    if (!this.grounded) this.vel.y -= PLAYER.gravity * dt;
    else if (this.vel.y < 0) this.vel.y = 0;
    const wasGrounded = this.grounded;
    const prevY = this.pos.y;
    g.physics.move(this, dt);
    if (wasGrounded && !this.grounded) this.fallStartY = Math.max(prevY, this.pos.y);
    if (!this.grounded) this.fallStartY = Math.max(this.fallStartY, this.pos.y);
    // water: float at the surface
    const water = WORLD.waterLevel;
    this.swimming = false;
    if (this.pos.y < water - 1.15) {
      this.pos.y = water - 1.15;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
      this.swimming = true;
      this.fallStartY = this.pos.y;
    }
    if (this.landed) {
      const fall = this.fallStartY - this.pos.y;
      if (fall > PLAYER.fallSafe) {
        const dmg = (fall - PLAYER.fallSafe) * PLAYER.fallDmgPerM;
        if (this.netLocal) g.net.clientAction('fall', dmg);
        else this.takeDamage(dmg, null, { fall: true });
      }
      if (g.onLand && fall > 1.5) g.onLand(this, fall);
      this.fallStartY = this.pos.y;
    }
    this.hittable = true;
  }

  actGround(dt) {
    const g = this.game;
    const it = this.intent;
    const cur = this.current();

    // ---- selection
    if (it.select !== null && it.select !== undefined) this.select(it.select);
    it.select = null;
    this.buildMode = !!it.buildMode;

    // ---- timers
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }

    if (this.buildMode) {
      this.cancelUse();
      this.harvestT = -1;
      if (it.place && it.buildSlot) g.building.tryPlace(this, it.buildSlot, it.buildKind, it.buildMat);
    } else if (!cur) {
      this.updateHarvest(dt);
    } else if (cur.type === 'weapon') {
      this.updateWeapon(dt, cur);
    } else if (cur.type === 'consumable') {
      this.updateConsumable(dt, cur);
    }
    if (it.interact) g.interact(this);
    it.interact = false;
  }

  // A client's own player: the host decides what happens; we only predict what is cheap to predict.
  actGroundLocal(dt) {
    const g = this.game;
    const it = this.intent;
    if (it.select !== null && it.select !== undefined) {
      g.net.clientAction('select', it.select);
      this.select(it.select);
    }
    it.select = null;
    this.buildMode = !!it.buildMode;
    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt);
    if (this.useT > 0) this.useT += dt;
    const cur = this.current();
    if (!this.buildMode && !cur) {
      if (this.harvestT >= 0) {
        this.harvestT += dt / HARVEST.swingTime;
        if (this.harvestT >= 1) this.harvestT = -1;
      }
      if (this.harvestT < 0 && it.fire) {
        this.harvestT = 0;
        if (g.onSwing) g.onSwing(this);
      }
    } else this.harvestT = -1;
  }

  select(i) {
    if (i === this.inv.selected) return;
    this.inv.selected = i;
    this.cancelUse();
    this.reloadT = 0;
    this.harvestT = -1;
    this.fireCooldown = Math.max(this.fireCooldown, 0.25);
  }

  cancelUse() { this.useT = 0; }

  updateHarvest(dt) {
    const it = this.intent;
    if (this.harvestT >= 0) {
      this.harvestT += dt / HARVEST.swingTime;
      if (!this.harvestHit && this.harvestT >= 0.42) {
        this.harvestHit = true;
        this.game.combat.harvestHit(this);
      }
      if (this.harvestT >= 1) this.harvestT = -1;
    }
    if (this.harvestT < 0 && it.fire) {
      this.harvestT = 0;
      this.harvestHit = false;
      if (this.game.onSwing) this.game.onSwing(this);
    }
  }

  updateWeapon(dt, w) {
    const it = this.intent;
    const def = WEAPONS[w.id];
    if (it.reload && this.reloadT <= 0 && w.mag < def.mag && this.inv.ammo[def.ammo] > 0) this.startReload(w);
    const trigger = def.auto ? it.fire : it.firePressed;
    if (trigger && this.fireCooldown <= 0) {
      if (w.mag > 0 && (this.reloadT <= 0 || def.pumpAction)) {
        if (this.reloadT > 0) this.reloadT = 0; // shotguns can interrupt their reload
        w.mag--;
        this.fireCooldown = 1 / def.rate;
        this.fired = def.recoil;
        this.game.combat.fire(this, w);
        this.bloom = Math.min(0.08, this.bloom + def.bloom);
        if (w.mag === 0 && this.inv.ammo[def.ammo] > 0) this.startReload(w, 0.25);
      } else if (w.mag === 0 && this.reloadT <= 0) {
        if (this.inv.ammo[def.ammo] > 0) this.startReload(w);
        else if (this.game.onEmpty) this.game.onEmpty(this);
        this.fireCooldown = 0.3;
      }
    }
  }

  startReload(w, delay = 0) {
    const def = WEAPONS[w.id];
    const speed = 1 - w.rarity * 0.04;
    this.reloadTotal = def.reload * speed + delay;
    this.reloadT = this.reloadTotal;
    if (this.game.onReload) this.game.onReload(this, w);
  }

  finishReload() {
    const w = this.current();
    this.reloadT = 0;
    if (!w || w.type !== 'weapon') return;
    const def = WEAPONS[w.id];
    const need = def.mag - w.mag;
    const take = Math.min(need, this.inv.ammo[def.ammo]);
    w.mag += take;
    this.inv.ammo[def.ammo] -= take;
  }

  updateConsumable(dt, item) {
    const it = this.intent;
    const def = CONSUMABLES[item.id];
    if (def.throw) {
      // throwables: click to throw toward the aim point
      if (it.firePressed && this.fireCooldown <= 0) {
        this.fireCooldown = 0.9;
        this.fired = 0.6;
        this.game.combat.throwGrenade(this, def);
        item.count--;
        if (item.count <= 0) {
          this.inv.slots[this.inv.selected] = null;
          this.select(this.inv.slots.findIndex((s) => s));
        }
      }
      return;
    }
    const canUse = (def.hp && this.health < def.cap) || (def.shield && this.shield < def.cap);
    if (this.useT > 0) {
      this.useT += dt;
      if (this.useT >= this.useTotal) {
        this.heal(def.hp, def.cap, def.shield, def.cap);
        item.count--;
        this.useT = 0;
        if (this.game.onConsumed) this.game.onConsumed(this, item);
        if (item.count <= 0) {
          this.inv.slots[this.inv.selected] = null;
          // fall back to another item
          const next = this.inv.slots.findIndex((s) => s);
          this.select(next);
        }
      }
    } else if (it.fire && canUse) {
      this.useT = 1e-4;
      this.useTotal = def.time;
      if (this.game.onUse) this.game.onUse(this, item);
    } else if (it.firePressed && !canUse && this.game.onCantUse) this.game.onCantUse(this, item);
  }

  // ------------------------------------------------------------------ visuals
  heldSignature() {
    if (this.puppet) return this.netHeld || 'tool';
    if (this.buildMode) return 'build';
    const c = this.current();
    if (!c) return 'tool';
    return c.type + ':' + c.id + ':' + (c.rarity ?? '');
  }

  refreshHeld() {
    const sig = this.heldSignature();
    if (sig === this.heldSig) return;
    this.heldSig = sig;
    const a = this.game.assets;
    if (sig === 'build') { this.model.hold(null, 'build'); return; }
    const [type, id, rarity] = sig.split(':');
    if (type === 'weapon' && WEAPONS[id]) {
      const def = WEAPONS[id];
      const obj = a.flat(def.model, { tints: { Rarity: RARITIES[+rarity || 0].color } });
      this.model.hold(obj, def.hold);
      return;
    }
    if (type === 'consumable' && CONSUMABLES[id]) {
      this.model.hold(a.flat(CONSUMABLES[id].model), 'item');
      return;
    }
    const obj = a.flat('W_Pickaxe', { tints: { Rarity: this.model.outfit.colors.Accent } });
    this.model.hold(obj, 'tool');
  }

  updateVisual(dt) {
    const m = this.model;
    const g = this.game;
    if (this.mode === 'bus') { m.root.visible = false; return; }
    if (!this.alive) {
      const t = g.time - this.deathTime;
      if (t > 3.5) m.root.visible = false;
      else if (t > 2.5) m.root.scale.setScalar(Math.max(0.001, 1 - (t - 2.5)));
    } else {
      m.root.visible = true;
    }
    // skip animation work for far-away actors that are off screen
    const cam = g.camera.position;
    const d2 = this.pos.distanceToSquared(cam);
    // a friend's player arrives in steps (their input rate): smooth what we draw
    if (this.remote && m.root.position.distanceToSquared(this.pos) < 25) m.root.position.lerp(this.pos, 1 - Math.exp(-dt * 20));
    else m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    // off-screen far away: skip the animation (the root still moves so muzzles and effects start in the right place)
    if (!this.isPlayer && d2 > 260 * 260) { m.root.visible = false; return; }
    m.setLod(d2 > 32 * 32);
    m.socket.userData.far = d2 > 70 * 70;
    this.refreshHeld();
    const reload = this.puppet ? this.netReload || 0 : this.reloadT > 0 ? 1 - this.reloadT / this.reloadTotal : 0;
    const use = this.puppet ? this.netUse || 0 : this.useT > 0 ? this.useT / this.useTotal : 0;
    m.update(dt, {
      vel: this.vel, yaw: this.yaw, aimPitch: this.pitch, grounded: this.grounded || this.swimming,
      crouch: this.intent.crouch && this.mode === 'ground', sprint: this.intent.sprint, mode: this.alive ? this.mode : 'dead',
      fired: this.fired, harvest: this.harvestT, reload, use,
      dive: this.dive || 0, dance: this.dancing,
    });
    if (this.glider) {
      this.glider.rotation.z = damp(this.glider.rotation.z, -this.intent.moveX * 0.3, 4, dt);
      this.glider.rotation.x = damp(this.glider.rotation.x, this.intent.moveZ * -0.15, 4, dt);
    }
    // swimming: sink the model a bit
    if (this.swimming) m.root.position.y = this.pos.y - 0.2;
  }

  dispose() {
    this.game.scene.remove(this.model.root);
  }
}

export { MATS, BUILD_COST };
