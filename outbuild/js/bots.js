// Bot opponents. Each bot has a small state machine: drop -> loot -> rotate with the storm -> fight.
import * as THREE from 'three';
import { GRID, WORLD } from './config.js';
import { POIS } from './layout.js';
import { WEAPONS, CONSUMABLES, Inventory } from './items.js';
import { clamp, wrapAngle, lerp } from './util.js';

const ADJ = ['Swift', 'Lucky', 'Quiet', 'Bold', 'Rusty', 'Sunny', 'Mossy', 'Frosty', 'Brave', 'Sly', 'Jolly', 'Nimble',
  'Stormy', 'Dusty', 'Sparky', 'Crafty', 'Plucky', 'Zippy', 'Grumpy', 'Mellow', 'Witty', 'Hasty', 'Fuzzy', 'Tiny'];
const NOUN = ['Falcon', 'Badger', 'Otter', 'Comet', 'Pickle', 'Walrus', 'Maple', 'Pebble', 'Lynx', 'Heron', 'Bison',
  'Taco', 'Nugget', 'Gecko', 'Rocket', 'Beacon', 'Marmot', 'Puffin', 'Moose', 'Cobalt', 'Waffle', 'Kiwi', 'Yeti', 'Koala'];

export function botName(rng) {
  const n = rng.pick(ADJ) + rng.pick(NOUN);
  return rng.chance(0.5) ? n + rng.int(1, 99) : n;
}

const DIFF = {
  easy: { aim: 0.11, react: 0.9, build: 0.25, burst: 0.6, sight: 80 },
  normal: { aim: 0.065, react: 0.55, build: 0.5, burst: 0.8, sight: 110 },
  hard: { aim: 0.035, react: 0.3, build: 0.8, burst: 1, sight: 140 },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class BotBrain {
  constructor(game, actor, rng, difficulty = 'normal') {
    this.game = game;
    this.a = actor;
    this.rng = rng;
    const base = DIFF[difficulty] || DIFF.normal;
    // every bot is a little different
    const k = rng.float(0.7, 1.35);
    this.skill = { aim: base.aim * k, react: base.react * rng.float(0.8, 1.3), build: base.build * rng.float(0.5, 1.5),
      burst: base.burst, sight: base.sight };
    this.state = 'bus';
    this.target = null;
    this.goal = null;
    this.goalKind = null;
    this.goalTimer = 0;
    this.thinkT = rng.float(0, 0.3);
    this.strafe = 1;
    this.strafeT = 0;
    this.burstT = 0;
    this.pauseT = 0;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.blacklist = new Set();
    this.reactT = 0;
    this.lastBuild = -99;
    this.lastSeen = -99;
    this.seenPos = new THREE.Vector3();
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.jumpAt = Infinity;
    this.landing = null;
    this.healCooldown = 0;
    this.switchT = 0;
    this._wp = new THREE.Vector3();
    this.goalHouse = null;
    this.progT = 1;
    this.curWp = null;
    this.breaking = false;
  }

  // Called when the airship takes off: choose where to land and when to jump.
  planDrop(ship) {
    const rng = this.rng;
    const hot = POIS.map((p) => ({ p, w: p.kind === 'city' ? 3 : p.kind === 'peak' ? 0.6 : 1.3 }));
    let spot;
    if (rng.chance(0.8)) {
      const p = rng.weighted(hot).p;
      spot = new THREE.Vector3(p.x + rng.float(-35, 35), 0, p.z + rng.float(-35, 35));
    } else {
      const a = rng.float(0, Math.PI * 2), r = rng.float(40, WORLD.islandRadius - 60);
      spot = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    this.landing = spot;
    // jump when the ship is closest to the spot, a bit early if it's far off the route
    const rel = spot.clone().sub(ship.startPos);
    const along = rel.dot(ship.dir);
    const off = Math.abs(rel.x * -ship.dir.z + rel.z * ship.dir.x);
    const jumpDist = along - Math.min(off * 0.6, 220) + rng.float(-40, 20);
    this.jumpAt = clamp(jumpDist / ship.velocity.length(), 3, 60);
  }

  update(dt) {
    const a = this.a;
    const g = this.game;
    const it = a.intent;
    it.jump = false;
    it.firePressed = false;
    it.fire = false;
    it.reload = false;
    it.interact = false;
    it.place = false;
    it.buildMode = false;
    it.aimOrigin = null;
    it.aimDir = null;
    if (!a.alive) return;
    if (a.mode === 'bus') {
      if (g.airship && g.airship.t >= this.jumpAt) it.jump = true;
      return;
    }
    if (a.mode === 'sky' || a.mode === 'glide') { this.fly(dt); return; }
    if (this.landedAt === undefined) this.landedAt = g.time;
    this.thinkT -= dt;
    this.goalTimer -= dt;
    this.switchT -= dt;
    this.healCooldown -= dt;
    if (this.thinkT <= 0) { this.think(); this.thinkT = 0.25 + this.rng.float(0, 0.15); }
    switch (this.state) {
      case 'fight': this.fight(dt); break;
      case 'heal': this.healUp(dt); break;
      default: this.travel(dt);
    }
    this.unstick(dt);
    it.yaw = this.aimYaw;
    it.pitch = this.aimPitch;
  }

  fly(dt) {
    const a = this.a;
    const it = a.intent;
    const t = this.landing || a.pos;
    const dx = t.x - a.pos.x, dz = t.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    this.aimYaw = Math.atan2(dx, dz);
    const h = a.pos.y - this.game.terrain.heightAt(a.pos.x, a.pos.z);
    // dive if the spot is close relative to the height, otherwise glide far
    this.aimPitch = d < h * 0.9 ? -1.2 : -0.2;
    it.moveZ = d > 6 ? 1 : 0;
    it.moveX = 0;
    it.yaw = this.aimYaw;
    it.pitch = this.aimPitch;
  }

  // ------------------------------------------------------------------ decisions
  think() {
    const a = this.a;
    const g = this.game;
    // who can we see?
    this.target = this.pickTarget();
    const now = g.time;
    const hurt = a.health + a.shield < 90;
    const armed = this.bestWeaponSlot() >= 0;
    if (this.target && armed) {
      // freshly landed and badly equipped: keep looting unless someone is close or shooting at us
      const d = a.pos.distanceTo(this.target.pos);
      const early = now - (this.landedAt ?? now) < 45;
      const attacked = now - a.lastDamageTime < 4;
      if (early && !this.target.human && this.lootNeed() >= 2 && d > 45 && !attacked && this.goalKind === 'loot' && this.goalTimer > 0) {
        this.state = 'travel';
        return;
      }
      // patch up behind cover when the enemy is out of sight (they stay put, they don't run)
      if (hurt && now - this.lastSeen > 3 && now - a.lastDamageTime > 3 && this.healSlot() >= 0 && this.healCooldown <= 0) { this.state = 'heal'; return; }
      if (this.state !== 'fight') this.reactT = this.skill.react;
      this.state = 'fight';
      return;
    }
    if (this.target && !armed && a.pos.distanceTo(this.target.pos) < 4 && now - a.lastDamageTime < 3) { this.state = 'fight'; return; }
    if (hurt && now - a.lastDamageTime > 4 && this.healSlot() >= 0 && this.healCooldown <= 0) { this.state = 'heal'; return; }
    this.state = 'travel';
    // storm first
    const s = g.storm;
    if (s.state !== 'idle' && s.state !== 'pre') {
      const outNow = s.distOutside(a.pos.x, a.pos.z) > -5;
      const nx = s.next.c.x, nz = s.next.c.y;
      const outNext = Math.hypot(a.pos.x - nx, a.pos.z - nz) > s.next.r * 0.85;
      const urgent = outNow || (outNext && (s.state === 'shrink' || s.timer < 35));
      if (urgent) {
        if (this.goalKind !== 'storm' || this.goalTimer <= 0) {
          const ang = this.rng.float(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * s.next.r * 0.6;
          this.setGoal(new THREE.Vector3(nx + Math.cos(ang) * r, 0, nz + Math.sin(ang) * r), 'storm', 40);
        }
        return;
      }
    }
    // loot
    if (this.goalKind === 'loot' && this.goalTimer > 0 && this.goalRef && this.goalRef.alive !== false && !this.goalRef.opened) return;
    const need = this.lootNeed();
    if (need > 0) {
      const target = this.findLoot(need);
      if (target) { this.setGoal(new THREE.Vector3(target.x, target.y, target.z), 'loot', 18, target); return; }
    }
    // wander inside the safe zone
    if (!this.goal || this.goalTimer <= 0 || this.goalKind === 'loot') {
      const c = s.state === 'idle' || s.state === 'pre' ? { x: a.pos.x, y: a.pos.z } : s.next.c;
      const r = s.state === 'idle' || s.state === 'pre' ? 90 : s.next.r * 0.7;
      for (let i = 0; i < 8; i++) {
        const ang = this.rng.float(0, Math.PI * 2);
        const rr = Math.sqrt(this.rng.next()) * r;
        const x = c.x + Math.cos(ang) * rr, z = c.y + Math.sin(ang) * rr;
        if (g.terrain.heightAt(x, z) > 1) { this.setGoal(new THREE.Vector3(x, 0, z), 'roam', 25); break; }
      }
    }
  }

  setGoal(p, kind, time, ref = null) {
    this.goalHouse = this.game.world.houseAt(p.x, p.z);
    this.atDoor = false;
    this.onStairs = false;
    this.goal = p;
    this.goalKind = kind;
    this.goalTimer = time;
    this.goalRef = ref;
    this.stuckT = 0;
  }

  pickTarget() {
    const a = this.a;
    const g = this.game;
    const now = g.time;
    const eye = a.eye(_v);
    // someone just shot us: turn on them
    if (a.lastHitBy && a.lastHitBy.alive && now - a.lastDamageTime < 3) {
      this.lastSeen = now;
      this.seenPos.copy(a.lastHitBy.pos);
      return a.lastHitBy;
    }
    // keep the current target while we remember it
    // in a duel, or once only a few are left, bots always know where their opponent is and go after them
    const hunt = g.mapKey === 'duel' || g.aliveCount() <= 4;
    // keep hunting the current target for a while after losing sight of it
    if (this.target && this.target.alive && (hunt || now - this.lastSeen < 12) && this.target.mode !== 'bus') {
      if (g.physics.lineOfSight(eye, this.target.chest(_w))) { this.lastSeen = now; this.seenPos.copy(this.target.pos); }
      else if (hunt) this.seenPos.copy(this.target.pos);
      return this.target;
    }
    let best = null, bd = this.skill.sight;
    const fwdX = Math.sin(a.yaw), fwdZ = Math.cos(a.yaw);
    for (const o of g.actors) {
      if (o === a || !o.alive || o.mode === 'bus') continue;
      const dx = o.pos.x - a.pos.x, dz = o.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      // narrower awareness behind us
      const facing = (dx * fwdX + dz * fwdZ) / (d || 1);
      if (facing < -0.2 && d > 25) continue;
      if (o.mode === 'sky' || o.mode === 'glide') { if (d > 60) continue; }
      if (!g.physics.lineOfSight(eye, o.chest(_w))) continue;
      best = o;
      bd = d;
    }
    if (best) { this.lastSeen = now; this.seenPos.copy(best.pos); }
    else if (hunt) {
      // nobody in sight: track down the nearest opponent
      let nd = Infinity;
      for (const o of g.actors) {
        if (o === a || !o.alive || o.mode === 'bus') continue;
        const d = o.pos.distanceTo(a.pos);
        if (d < nd) { nd = d; best = o; }
      }
      if (best) { this.seenPos.copy(best.pos); this.lastSeen = Math.min(this.lastSeen, now - 1); }
    }
    return best;
  }

  lootNeed() {
    const inv = this.a.inv;
    let weapons = 0;
    let best = 0;
    for (const s of inv.slots) if (s && s.type === 'weapon') { weapons++; best = Math.max(best, Inventory.score(s)); }
    const heals = inv.slots.some((s) => s && s.type === 'consumable' && !CONSUMABLES[s.id].throw);
    if (weapons === 0) return 3;
    if (weapons < 2 || best < 9) return 2;
    if (!heals) return 1;
    return 0;
  }

  findLoot(need) {
    const a = this.a;
    const g = this.game;
    let best = null, bd = need >= 3 ? 95 : 50;
    for (const c of g.pickups.chests) {
      if (c.opened || this.blacklist.has(c)) continue;
      let d = Math.hypot(c.x - a.pos.x, c.z - a.pos.z) + Math.abs(c.y - a.pos.y) * 2;
      if (c.kind === 'supply') d *= 0.3;
      if (d < bd) { bd = d; best = c; }
    }
    for (const p of g.pickups.list) {
      if (!p.settled || this.blacklist.has(p)) continue;
      if (p.item.type === 'weapon' && !this.wants(p.item)) continue;
      if (p.item.type === 'consumable' && need < 1) continue;
      if (p.item.type === 'mat' || (p.item.type === 'ammo' && need > 2)) continue;
      const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z) + Math.abs(p.y - a.pos.y) * 2;
      if (d < bd * 0.8) { bd = d; best = p; }
    }
    return best;
  }

  wants(item) {
    const inv = this.a.inv;
    if (inv.freeSlot() >= 0) return true;
    let worst = Infinity;
    for (const s of inv.slots) if (s && s.type === 'weapon') worst = Math.min(worst, Inventory.score(s));
    return Inventory.score(item) > worst + 0.5;
  }

  // ------------------------------------------------------------------ moving
  lookAt(p, dt, rate = 7) {
    const a = this.a;
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const ty = Math.atan2(dx, dz);
    const eyeY = a.pos.y + a.eyeHeight;
    const tp = Math.atan2(p.y - eyeY, Math.hypot(dx, dz));
    const dy = wrapAngle(ty - this.aimYaw);
    this.aimYaw += clamp(dy, -rate * dt, rate * dt);
    this.aimPitch += clamp(tp - this.aimPitch, -rate * 0.6 * dt, rate * 0.6 * dt);
    return Math.abs(wrapAngle(ty - this.aimYaw)) + Math.abs(tp - this.aimPitch);
  }

  steer(target, dt, sprint = true) {
    const a = this.a;
    const it = a.intent;
    const dx = target.x - a.pos.x, dz = target.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) { it.moveZ = 0; it.moveX = 0; return d; }
    // look where we walk, flatten the pitch
    const look = _v.set(target.x, a.pos.y + a.eyeHeight, target.z);
    this.lookAt(look, dt, 5);
    it.moveZ = 1;
    it.moveX = 0;
    it.sprint = sprint && d > 8;
    // obstacle probe
    const px = a.pos.x + Math.sin(this.aimYaw) * 1.3, pz = a.pos.z + Math.cos(this.aimYaw) * 1.3;
    const list = this.game.physics.query(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4);
    for (const c of list) {
      if (!c.blocksMove || !this.game.physics.overlapsFootprint(c, px, pz, 0.4)) continue;
      const top = this.game.physics.topUnder(c, px, pz, 0.3);
      if (top > a.pos.y + 0.5 && top < a.pos.y + 1.3 && a.grounded) it.jump = true; // hop over fences
    }
    return d;
  }

  // Route into houses through the front door and up the stairs instead of walking into walls.
  waypoint(goal) {
    const a = this.a;
    const h = this.goalHouse;
    if (!h || !h.nav) return goal;
    const n = h.nav;
    const inside = a.pos.x > n.x0 + 0.3 && a.pos.x < n.x1 - 0.3 && a.pos.z > n.z0 + 0.3 && a.pos.z < n.z1 - 0.3;
    if (!inside) {
      if (a.pos.y > n.y + 2) return goal; // came in over the roof or through a window: carry on
      const dOut = Math.hypot(a.pos.x - n.door.ox, a.pos.z - n.door.oz);
      if (!this.atDoor && dOut > 1.4) return this._wp.set(n.door.ox, n.y, n.door.oz);
      this.atDoor = true;
      return this._wp.set(n.door.ix, n.y, n.door.iz);
    }
    this.atDoor = false;
    if (goal.y > a.pos.y + 1.6 && n.stairs) {
      const s = n.stairs;
      const dLow = Math.hypot(a.pos.x - s.lx, a.pos.z - s.lz);
      if (!this.onStairs && dLow > 1.1) return this._wp.set(s.lx, a.pos.y, s.lz);
      this.onStairs = true;
      return this._wp.set(s.tx, a.pos.y + 3, s.tz);
    }
    this.onStairs = false;
    return goal;
  }

  travel(dt) {
    const a = this.a;
    const it = a.intent;
    it.crouch = false;
    if (!this.goal) { it.moveZ = 0; return; }
    const wp = this.waypoint(this.goal);
    this.curWp = wp;
    const d0 = this.breaking ? Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z) : this.steer(wp, dt, true);
    if (this.breaking) { it.moveZ = 0.2; }
    const d = wp === this.goal ? d0 : Math.hypot(this.goal.x - a.pos.x, this.goal.z - a.pos.z);
    // keep the best gun out while walking
    if (!this.breaking) this.holdBest();
    if (this.goalKind === 'loot' && d < 2.2 && Math.abs(this.goal.y - a.pos.y) < 2.2) {
      const ref = this.goalRef;
      if (ref && ref.item && ref.item.type === 'weapon' && this.a.inv.freeSlot() < 0) {
        // drop the worst weapon's slot selection so the pickup swaps with it
        let worst = -1, ws = Infinity;
        this.a.inv.slots.forEach((s, i) => { if (s && s.type === 'weapon' && Inventory.score(s) < ws) { ws = Inventory.score(s); worst = i; } });
        if (worst >= 0) a.select(worst);
      }
      it.interact = true;
      this.blacklist.add(ref);
      this.goal = null;
      this.goalTimer = 0;
    } else if (this.goalKind === 'loot' && d < 5 && this.goal.y - a.pos.y > 2.2) {
      // loot is upstairs: build a ramp up to it
      this.buildRampToward(this.goal);
    }
    if (this.goalTimer <= 0 && this.goalKind === 'loot' && this.goalRef) this.blacklist.add(this.goalRef);
  }

  // Progress-based stuck detection: if we are not getting closer to where we are walking, hop, then
  // smash whatever is in the way with the harvesting tool, then give up on that goal.
  unstick(dt) {
    const a = this.a;
    const it = a.intent;
    const target = this.state === 'travel' ? this.curWp : null;
    this.progT -= dt;
    if (!target || it.moveZ <= 0) { this.stuckT = 0; this.lastD = undefined; this.breaking = false; return; }
    const d = Math.hypot(target.x - a.pos.x, target.z - a.pos.z);
    if (this.progT <= 0) {
      if (this.lastD !== undefined && this.lastD - d < 0.6) this.stuckT += 1; else { this.stuckT = 0; this.breaking = false; }
      this.lastD = d;
      this.progT = 1;
    }
    if (this.stuckT >= 1 && this.stuckT < 2 && a.grounded && this.rng.chance(dt * 3)) it.jump = true;
    if (this.stuckT >= 2) {
      // break through whatever is in front of us
      let c = a.blockedBy;
      if (!c) {
        const px = a.pos.x + Math.sin(this.aimYaw) * 1.0, pz = a.pos.z + Math.cos(this.aimYaw) * 1.0;
        for (const q of this.game.physics.query(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5)) {
          if (q.blocksMove && q.owner && q.maxY > a.pos.y + 0.4 && q.minY < a.pos.y + 1.8) { c = q; break; }
        }
      }
      if (c && c.owner && c.owner.alive !== false) {
        this.breaking = true;
        if (a.inv.selected !== -1) a.select(-1);
        it.fire = true;
        it.moveZ = 0.2;
        const cx = clamp(a.pos.x, c.minX, c.maxX), cz = clamp(a.pos.z, c.minZ, c.maxZ);
        this.aimYaw = Math.atan2(cx - a.pos.x, cz - a.pos.z);
        const cy = clamp(a.pos.y + 1.1, c.minY, c.maxY);
        this.aimPitch = Math.atan2(cy - (a.pos.y + a.eyeHeight), Math.max(0.3, Math.hypot(cx - a.pos.x, cz - a.pos.z)));
      }
    }
    const limit = this.breaking ? 14 : 5;
    if (this.stuckT > limit) {
      this.stuckT = 0;
      this.breaking = false;
      if (this.goalRef) this.blacklist.add(this.goalRef);
      this.goal = null;
      this.goalTimer = 0;
    }
  }

  // ------------------------------------------------------------------ inventory helpers
  bestWeaponSlot(dist = 30) {
    const inv = this.a.inv;
    let best = -1, bs = -1;
    inv.slots.forEach((s, i) => {
      if (!s || s.type !== 'weapon') return;
      const def = WEAPONS[s.id];
      if (s.mag <= 0 && inv.ammo[def.ammo] <= 0) return;
      let score = Inventory.score(s);
      if (dist < 12 && (s.id === 'pump' || s.id === 'tactical')) score += 6;
      if (dist < 25 && s.id === 'smg') score += 3;
      if (dist > 50 && (s.id === 'pump' || s.id === 'tactical')) score -= 8;
      if (dist > 70 && s.id === 'sniper') score += 5;
      if (dist < 20 && s.id === 'sniper') score -= 6;
      if (dist < 8 && s.id === 'rocket') score -= 10;
      if (score > bs) { bs = score; best = i; }
    });
    return best;
  }

  holdBest(dist = 30) {
    if (this.switchT > 0) return;
    const i = this.bestWeaponSlot(dist);
    if (i !== this.a.inv.selected) { this.a.select(i); this.switchT = 0.6; }
  }

  healSlot() {
    const a = this.a;
    let best = -1;
    a.inv.slots.forEach((s, i) => {
      if (!s || s.type !== 'consumable') return;
      const def = CONSUMABLES[s.id];
      if (def.throw) return;
      if (def.shield && a.shield < def.cap) best = i;
      else if (def.hp && a.health < def.cap && best < 0) best = i;
    });
    return best;
  }

  healUp(dt) {
    const a = this.a;
    const it = a.intent;
    const i = this.healSlot();
    it.moveZ = 0;
    it.moveX = 0;
    it.crouch = true;
    if (i < 0) { this.state = 'travel'; this.healCooldown = 3; return; }
    if (a.inv.selected !== i) a.select(i);
    it.fire = true;
  }

  // ------------------------------------------------------------------ fighting
  fight(dt) {
    const a = this.a;
    const g = this.game;
    const it = a.intent;
    const t = this.target;
    if (!t || !t.alive) { this.state = 'travel'; this.target = null; return; }
    const tp = t.alive && g.time - this.lastSeen < 0.6 ? t.pos : this.seenPos;
    const dist = a.pos.distanceTo(tp);
    this.holdBest(dist);
    const cur = a.current();
    // aim point: chest, with the occasional headshot attempt, plus error that shrinks as we keep tracking
    const aimP = _w.set(tp.x, tp.y + (t.height || 1.8) * (this.rng.chance(0.25) ? 0.9 : 0.62), tp.z);
    const err = this.skill.aim * (1 + Math.min(dist, 120) / 60) * (0.6 + Math.hypot(t.vel.x, t.vel.z) / 12);
    const wob = g.time * 1.7 + a.id;
    aimP.x += Math.sin(wob) * err * dist * 0.6;
    aimP.y += Math.cos(wob * 1.3) * err * dist * 0.4;
    aimP.z += Math.cos(wob * 0.9) * err * dist * 0.6;
    const off = this.lookAt(aimP, dt, 6);
    this.reactT -= dt;
    // movement: strafe, keep a sensible distance for the weapon
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = this.rng.chance(0.5) ? 1 : -1; this.strafeT = this.rng.float(0.5, 1.5); }
    // close in to the weapon's fighting range and stay there: bots push, they don't back off
    const pref = !cur ? 1.5 : cur.id === 'pump' || cur.id === 'tactical' ? 3.5 : cur.id === 'smg' ? 8 : cur.id === 'sniper' ? 45 : 12;
    const seen = g.time - this.lastSeen < 0.6;
    if (!seen) {
      // lost sight: go where they were last seen
      it.moveX = 0;
      it.moveZ = dist > 2.5 ? 1 : 0;
      it.sprint = dist > 12;
    } else {
      it.moveX = this.strafe * (cur && cur.id === 'sniper' ? 0.3 : 0.8);
      it.moveZ = dist > pref ? 1 : dist < 1.6 && cur && cur.id !== 'pump' && cur.id !== 'tactical' ? -0.4 : 0;
      it.sprint = dist > pref * 2.5 && !this.rng.chance(0.3);
    }
    it.crouch = cur && cur.id === 'sniper' && dist > 50;
    if (a.grounded && this.rng.chance(dt * 0.35)) it.jump = true;
    // defensive build when getting hit
    if (g.time - a.lastDamageTime < 0.3 && g.time - this.lastBuild > 1.6 && this.rng.chance(this.skill.build)) {
      this.buildCover(t);
    }
    // now and then lob a grenade at mid range
    const gi = a.inv.slots.findIndex((s) => s && s.type === 'consumable' && CONSUMABLES[s.id].throw);
    if (gi >= 0 && dist > 8 && dist < 26 && this.rng.chance(dt * 0.18) && g.time - this.lastSeen < 1) {
      a.select(gi);
      this.switchT = 0.8;
      this.aimPitch += 0.25;
      it.firePressed = true;
      it.fire = true;
      return;
    }
    if (cur && cur.type === 'consumable') { this.switchT = 0; this.holdBest(dist); return; }
    if (!cur) {
      // no gun: swing the pickaxe up close
      it.fire = dist < 2.8;
      return;
    }
    const def = WEAPONS[cur.id];
    if (cur.mag === 0) { it.reload = true; return; }
    const visible = g.time - this.lastSeen < 0.5;
    // blocked by a build? shoot the build
    let shoot = visible && off < 0.12 + 1.5 / Math.max(dist, 1) && this.reactT <= 0;
    if (!visible && g.time - this.lastSeen < 3 && dist < 40) {
      const eye = a.eye(new THREE.Vector3());
      const dir = aimP.clone().sub(eye).normalize();
      const h = g.physics.raycast(eye, dir, dist, {});
      if (h.kind === 'collider' && h.collider.kind === 'piece' && h.dist < 15) shoot = off < 0.2;
    }
    if (dist > def.range * 0.9) shoot = false;
    if (def.scope || cur.id === 'ar') it.ads = dist > 25;
    // bursts
    if (shoot) {
      if (this.pauseT > 0) { this.pauseT -= dt; shoot = false; }
      else {
        this.burstT += dt;
        if (this.burstT > 0.6 * this.skill.burst + (def.auto ? 0.4 : 0)) { this.burstT = 0; this.pauseT = this.rng.float(0.15, 0.5); }
      }
    }
    it.fire = shoot;
    it.firePressed = shoot && (this.rng.chance(0.5) || !def.auto);
    if (shoot) it.sprint = false;
  }

  // Wall between us and the enemy, sometimes with a ramp to climb behind it.
  buildCover(enemy) {
    const a = this.a;
    const g = this.game;
    const mat = a.inv.mats.wood >= 10 ? 'wood' : a.inv.mats.stone >= 10 ? 'stone' : a.inv.mats.metal >= 10 ? 'metal' : null;
    if (!mat) return;
    const eye = a.eye(new THREE.Vector3());
    const dir = enemy.chest(new THREE.Vector3()).sub(eye);
    dir.y = 0;
    dir.normalize();
    const slot = g.building.target(a, 'wall', eye, dir);
    if (slot && g.building.tryPlace(a, slot, 'wall', mat)) {
      this.lastBuild = g.time;
      if (a.inv.mats[mat] >= 10 && this.rng.chance(0.5)) {
        const rs = g.building.target(a, 'ramp', eye, dir);
        if (rs) setTimeout(() => { if (a.alive) g.building.tryPlace(a, rs, 'ramp', mat); }, 120);
      }
    }
  }

  buildRampToward(p) {
    const a = this.a;
    const g = this.game;
    if (g.time - this.lastBuild < 0.8) return;
    const mat = a.inv.mats.wood >= 10 ? 'wood' : a.inv.mats.stone >= 10 ? 'stone' : null;
    if (!mat) return;
    const eye = a.eye(new THREE.Vector3());
    const dir = new THREE.Vector3(p.x - a.pos.x, 0, p.z - a.pos.z).normalize();
    const slot = g.building.target(a, 'ramp', eye, dir);
    if (slot && g.building.tryPlace(a, slot, 'ramp', mat)) this.lastBuild = g.time;
  }
}

export { lerp };
