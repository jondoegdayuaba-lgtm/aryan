// People other than the player: outlaws who fight, townsfolk who wander and
// run from gunfire, and mission characters who stand and talk.
import * as THREE from 'three';
import { clamp, damp, dampAngle, approach, rng } from './util.js';

const rand = rng(1234);

export class NPC {
  constructor(game, o) {
    this.game = game;
    this.char = game.chars.create(o.outfit);
    this.root = this.char.root;
    game.scene.add(this.root);
    this.pos = this.root.position;
    this.name = o.name || null;
    this.role = o.role || 'outlaw';
    this.weapon = o.weapon || 'revolver';
    this.health = o.health || 100;
    this.maxHealth = this.health;
    this.accuracy = o.accuracy ?? 0.32;
    this.dead = false;
    this.yaw = o.yaw || 0;
    this.speed = 0;
    this.state = this.role === 'outlaw' ? (o.engaged ? 'combat' : 'idle') : this.role === 'civilian' ? 'wander' : 'stand';
    this.dest = null;
    this.timer = rand() * 2;
    this.shootTimer = 1 + rand() * 2;
    this.clip = this.weapon === 'rifle' ? 8 : 6;
    this.reload = 0;
    this.stagger = 0;
    this.stuck = 0;
    this.home = new THREE.Vector3(o.x, 0, o.z);
    this.wanderRadius = o.wander ?? 10;
    this.looted = false;
    this.tag = o.tag || null;
    this.keepRange = o.range || (this.weapon === 'rifle' ? 24 : 13);
    this.aggro = o.aggro ?? 1;
    this.pos.set(o.x, game.collision.groundY(o.x, o.z), o.z);
    this.root.rotation.y = this.yaw;
    this.char.setWeapon(this.state === 'combat' ? this.weapon : null);
    if (o.anim) this.char.setBase(o.anim, 0);
    this.fixedAnim = o.anim || null;
  }

  get position() {
    return this.pos;
  }

  engage() {
    if (this.dead || this.role !== 'outlaw') return;
    if (this.state !== 'combat') {
      this.state = 'combat';
      this.char.setWeapon(this.weapon);
      this.timer = 0;
      this.shootTimer = 0.6 + rand() * 1.4;
      this.tauntTimer = 5 + rand() * 8;
      if (rand() < 0.7) this.game.voices.bark(this, 'spot');
    }
  }

  damage(dmg, part, dir) {
    if (this.dead) return false;
    this.health -= dmg;
    this.stagger = 0.35;
    if (this.role === 'outlaw') this.engage();
    else if (this.role === 'civilian') this.panic(this.game.player.pos);
    if (this.health <= 0) {
      this.kill(dir);
      return true;
    }
    if (this.role === 'outlaw' && rand() < 0.45) this.game.voices.bark(this, 'hurt');
    return false;
  }

  kill(dir) {
    this.dead = true;
    this.speed = 0;
    if (dir) this.yaw = Math.atan2(-dir.x, -dir.z);
    this.root.rotation.y = this.yaw;
    this.char.die();
    this.game.events.emit('npcKilled', this);
  }

  panic(from) {
    if (this.dead || this.role !== 'civilian') return;
    const d = Math.hypot(this.pos.x - from.x, this.pos.z - from.z);
    this.state = d < 12 ? 'cower' : 'flee';
    this.timer = 8 + rand() * 6;
    this.fleeFrom = from.clone();
  }

  update(dt) {
    const g = this.game;
    const far = this.pos.distanceToSquared(g.camera.position) > 260 * 260;
    if (this.dead) {
      if (!far) this.char.update(dt);
      return;
    }
    this.stagger -= dt;
    if (this.state === 'combat') this.combat(dt);
    else if (this.role === 'civilian') this.civilian(dt);
    else this.stand(dt);

    // Move
    if (this.speed > 0.01 && this.stagger <= 0) {
      const p = this.pos;
      const ox = p.x;
      const oz = p.z;
      p.x += Math.sin(this.moveYaw ?? this.yaw) * this.speed * dt;
      p.z += Math.cos(this.moveYaw ?? this.yaw) * this.speed * dt;
      g.collision.resolve(p, 0.35, 1.8);
      const moved = Math.hypot(p.x - ox, p.z - oz);
      this.stuck = moved < this.speed * dt * 0.3 ? this.stuck + dt : 0;
    }
    for (const o of g.npcs) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = dx * dx + dz * dz;
      if (d < 0.6 && d > 1e-6) {
        const k = (0.78 - Math.sqrt(d)) * 0.5;
        this.pos.x += (dx / Math.sqrt(d)) * k;
        this.pos.z += (dz / Math.sqrt(d)) * k;
      }
    }
    const gy = g.collision.groundY(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y = damp(this.pos.y, gy, 20, dt);
    this.root.rotation.y = this.yaw;
    if (!this.fixedAnim) {
      const aiming = this.state === 'combat' && this.speed < 2.5 && this.reload <= 0;
      this.char.locomote(this.stagger > 0 ? 0 : this.speed, { aiming });
      this.char.setOverlay(aiming ? (this.weapon === 'rifle' ? 'aim_rifle' : 'aim_pistol') : null);
      if (aiming) {
        const p = g.player.pos;
        const dy = p.y + 1.3 - (this.pos.y + 1.45);
        this.char.aimPitch = clamp(Math.atan2(dy, Math.hypot(p.x - this.pos.x, p.z - this.pos.z)), -0.8, 0.8);
      }
    }
    if (!far) this.char.update(dt);
  }

  combat(dt) {
    const g = this.game;
    const P = g.player.pos;
    const dx = P.x - this.pos.x;
    const dz = P.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const facePlayer = Math.atan2(dx, dz);
    this.timer -= dt;
    this.reload -= dt;
    const reached = this.dest && Math.hypot(this.dest.x - this.pos.x, this.dest.z - this.pos.z) < 0.9;
    if (!this.dest || this.timer <= 0 || this.stuck > 1.2 || (reached && this.timer < 1.5)) {
      // Pick a new spot around the player, roughly where we are now
      const bearing = Math.atan2(this.pos.x - P.x, this.pos.z - P.z) + (rand() - 0.5) * 1.3;
      const r = clamp(this.keepRange + (rand() - 0.5) * 8, 5, 45);
      this.dest = new THREE.Vector3(P.x + Math.sin(bearing) * r, 0, P.z + Math.cos(bearing) * r);
      this.timer = 2.5 + rand() * 3.5;
      this.mode = rand() < 0.45 || dist > this.keepRange + 15 ? 'run' : 'strafe';
      this.stuck = 0;
    }
    const tdx = this.dest.x - this.pos.x;
    const tdz = this.dest.z - this.pos.z;
    const td = Math.hypot(tdx, tdz);
    let speed = 0;
    if (td > 0.8) {
      speed = this.mode === 'run' ? 4.4 : 1.7;
      this.moveYaw = Math.atan2(tdx, tdz);
    }
    if (this.reload > 0 && this.reload < 1.8) speed = Math.max(speed, 1.6);
    this.speed = approach(this.speed, speed, 10 * dt);
    if (this.speed > 2.5) this.yaw = dampAngle(this.yaw, this.moveYaw, 10, dt);
    else this.yaw = dampAngle(this.yaw, facePlayer, 8, dt);

    // Shoot when standing or strafing, facing the player, in range
    this.shootTimer -= dt;
    const facing = Math.abs(((facePlayer - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5;
    if (this.reload <= 0 && this.shootTimer <= 0 && this.speed < 2.5 && facing && dist < (this.weapon === 'rifle' ? 120 : 70)
        && !g.player.dead && this.stagger <= 0) {
      g.combat.npcShoot(this);
      this.clip--;
      this.shootTimer = (this.weapon === 'rifle' ? 1.7 : 1.05) + rand() * 1.4 / this.aggro;
      if (this.clip <= 0) {
        this.reload = 2.4;
        this.clip = this.weapon === 'rifle' ? 8 : 6;
        if (rand() < 0.5) g.voices.bark(this, 'reload');
      }
    }
    this.tauntTimer = (this.tauntTimer ?? 6) - dt;
    if (this.tauntTimer <= 0) {
      this.tauntTimer = 7 + rand() * 9;
      if (rand() < 0.55 && dist < 60) g.voices.bark(this, 'taunt');
    }
  }

  civilian(dt) {
    this.timer -= dt;
    if (this.state === 'cower') {
      this.speed = 0;
      this.char.setBase('handsup', 0.3);
      this.fixedAnim = 'handsup';
      if (this.timer <= 0) {
        this.state = 'wander';
        this.fixedAnim = null;
      }
      return;
    }
    if (this.state === 'flee') {
      const away = Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z);
      this.yaw = dampAngle(this.yaw, away + (this.stuck > 0.5 ? 1.2 : 0), 5, dt);
      this.moveYaw = this.yaw;
      this.speed = approach(this.speed, 5.2, 8 * dt);
      if (this.timer <= 0) this.state = 'wander';
      return;
    }
    // Wander near home
    if (!this.dest || this.timer <= 0 || this.stuck > 2) {
      if (rand() < 0.45) {
        this.dest = null;
        this.timer = 3 + rand() * 6;
      } else {
        const a = rand() * Math.PI * 2;
        const r = rand() * this.wanderRadius;
        this.dest = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        this.timer = 12;
      }
      this.stuck = 0;
    }
    if (this.dest) {
      const dx = this.dest.x - this.pos.x;
      const dz = this.dest.z - this.pos.z;
      if (Math.hypot(dx, dz) < 0.7) {
        this.dest = null;
        this.timer = 2 + rand() * 6;
      } else {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
        this.moveYaw = this.yaw;
      }
    }
    this.speed = approach(this.speed, this.dest ? 1.4 : 0, 4 * dt);
  }

  // Mission characters: stand still, turn to face the player when close.
  stand(dt) {
    const P = this.game.player.pos;
    const d = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    this.speed = 0;
    if (d < 7 && !this.fixedAnim) this.yaw = dampAngle(this.yaw, Math.atan2(P.x - this.pos.x, P.z - this.pos.z), 3, dt);
  }

  remove() {
    this.char.dispose();
    const i = this.game.npcs.indexOf(this);
    if (i >= 0) this.game.npcs.splice(i, 1);
  }
}
