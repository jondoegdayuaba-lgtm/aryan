// The first-person body: walking, sprinting, crouching, jumping, wading and swimming, sliding
// down steep slopes, climbing ladders, taking fall damage, and the camera motion that goes with it.
import * as THREE from 'three';
import { PLAYER } from './config.js';
import { clamp, damp, lerp, smoothstep } from './util.js';

const _n = { x: 0, y: 1, z: 0 };
const _w = { depth: 0, y: 0, body: null };

export class Player {
  constructor(world, collision, camera, input) {
    this.world = world;
    this.coll = collision;
    this.camera = camera;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.moving = false;
    this.swimming = false;
    this.wading = 0;                   // 0..1 how deep the water is on the legs
    this.underwater = 0;
    this.ladder = null;                // { x, z, y0, y1 } while climbing
    this.eye = PLAYER.eye;
    this.bob = 0;
    this.stride = 0;
    this.landDip = 0;
    this.kick = new THREE.Vector2();   // camera flinch from damage, radians
    this.fovBoost = 0;
    this.fatigue = 0;                  // 0..1, from survival: heavy breathing sway
    this.speedMul = 1;                 // set by survival (cold, injury)
    this.canSprint = true;
    this.frozen = false;               // cutscenes and menus
    this.events = { step: null, land: null, jump: null, splash: null, hurt: null, swimStroke: null };
    this.surface = 'grass';
    this.groundY = 0;
    this.speed = 0;
    this.lastStep = 0;
    this.inWaterPrev = false;
  }

  teleport(x, z, y = null) {
    this.pos.set(x, y ?? this.world.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.ladder = null;
  }

  get eyeHeight() { return this.pos.y + this.eye; }

  update(dt) {
    const inp = this.input, w = this.world;
    if (!this.frozen) {
      const look = inp.consumeLook();
      const sens = (this.sensitivity ?? PLAYER.sensitivity) * (this.fovScale ?? 1);
      this.yaw -= look.x * sens;
      this.pitch = clamp(this.pitch - look.y * sens * (this.invertY ? -1 : 1), -1.5, 1.5);
    }

    const mx = this.frozen ? 0 : inp.moveX, my = this.frozen ? 0 : inp.moveY;
    this.moving = Math.hypot(mx, my) > 0.1;
    const wantCrouch = !this.frozen && inp.crouch && !this.swimming && !this.ladder;
    if (wantCrouch !== this.crouching) {
      // standing up needs headroom
      if (wantCrouch || !this._blockedAbove()) this.crouching = wantCrouch;
    }
    this.sprinting = !this.frozen && inp.sprint && this.canSprint && my > 0.3 && !this.crouching && !this.swimming;

    // ---- environment under the feet ----
    w.waterAt(this.pos.x, this.pos.z, _w);
    const depth = _w.depth;
    const wasSwimming = this.swimming;
    // Standing in water this deep is swimming; the eye must stay near the surface.
    this.swimming = depth > 1.25 && this.pos.y < _w.y - 0.6;
    this.wading = depth > 0.05 ? clamp(depth / 1.2, 0, 1) : 0;
    if (this.swimming && !wasSwimming) this.events.splash?.(Math.abs(this.vel.y));
    if (!this.swimming && wasSwimming && depth > 0.2) this.events.splash?.(1);

    // ---- horizontal intent ----
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * my + cy * mx, wz = -cy * my - sy * mx;         // forward is -z at yaw 0
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let speed = this.crouching ? PLAYER.crouch : this.sprinting ? PLAYER.sprint : PLAYER.walk;
    if (this.swimming) speed = PLAYER.swim * (this.sprinting ? 1.3 : 1);
    speed *= 1 - 0.45 * this.wading * (this.swimming ? 0 : 1);
    speed *= this.speedMul;
    if (this.ladder) speed = 0;

    w.normalAt(this.pos.x, this.pos.z, _n);
    const steep = _n.y < PLAYER.maxSlope;
    if (steep && this.onGround) {
      // cannot walk up: remove the uphill part of the wish; the slope pulls you down
      const dh = Math.hypot(_n.x, _n.z) || 1;
      const ux = -_n.x / dh, uz = -_n.z / dh;                       // uphill direction
      const up = wx * ux + wz * uz;
      if (up > 0) { wx -= ux * up; wz -= uz * up; }
      const slide = (PLAYER.maxSlope - _n.y) * 26 + 3;
      this.vel.x += (_n.x / dh) * slide * dt;
      this.vel.z += (_n.z / dh) * slide * dt;
    }

    const control = this.onGround || this.swimming ? 1 : PLAYER.airControl;
    const accel = PLAYER.accel * control;
    const tx = wx * speed, tz = wz * speed;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (tx - this.vel.x) * k * (steep && this.onGround ? 0.3 : 1);
    this.vel.z += (tz - this.vel.z) * k * (steep && this.onGround ? 0.3 : 1);

    // ---- creek current ----
    if (_w.body === 'river' && depth > 0.15 && !this.ladder) {
      const f = this._current();
      const push = Math.min(depth, 1.4) * 1.6;
      this.vel.x += f.x * push * dt * 2.2;
      this.vel.z += f.z * push * dt * 2.2;
    }

    // ---- vertical ----
    if (this.ladder) {
      this._climb(dt, my);
    } else if (this.swimming) {
      const target = _w.y - 1.05;                                  // feet this far below the surface keeps the head out
      let vy = (target - this.pos.y) * 2.4;
      if (!this.frozen && inp.jump) vy += 1.6;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-4 * dt));
      this.onGround = false;
    } else {
      if (this.onGround && !this.frozen && inp.jump && this.canJump !== false) {
        this.vel.y = PLAYER.jump * (this.crouching ? 0.6 : 1) * (this.speedMul < 0.8 ? 0.8 : 1);
        this.onGround = false;
        this.events.jump?.();
      }
      this.vel.y -= PLAYER.gravity * dt;
    }

    // ---- integrate in small steps so nothing tunnels through a wall ----
    const dist = Math.hypot(this.vel.x, this.vel.z, this.vel.y) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    const sdt = dt / steps;
    const headTop = this.crouching ? 1.15 : 1.75;
    for (let i = 0; i < steps; i++) {
      const prevY = this.pos.y;
      this.pos.x += this.vel.x * sdt;
      this.pos.z += this.vel.z * sdt;
      this.pos.y += this.vel.y * sdt;
      this.coll.resolve(this.pos, PLAYER.radius, this.pos.y, this.pos.y + headTop, PLAYER.stepUp);
      this._ground(prevY);
    }
    this._bounds();

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this._cameraMotion(dt);
    this._footsteps(dt);
    this.inWaterPrev = depth > 0.05;
  }

  _blockedAbove() {
    return false;
  }

  // The direction the creek flows at the player's position.
  _current() {
    const line = this.world.riverLine;
    let best = 0, bd = Infinity;
    for (let i = 0; i < line.length; i += 2) {
      const d = (line[i].x - this.pos.x) ** 2 + (line[i].z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const a = line[Math.max(0, best - 2)], b = line[Math.min(line.length - 1, best + 2)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }

  _ground(prevY) {
    const w = this.world;
    let g = w.heightAt(this.pos.x, this.pos.z);
    const bg = this.coll.boxGround(this.pos.x, this.pos.z, PLAYER.radius, prevY, PLAYER.stepUp);
    if (bg > g) g = bg;
    this.groundY = g;
    if (this.swimming || this.ladder) { this.onGround = false; return; }
    if (this.pos.y <= g + 0.001 || (this.onGround && this.vel.y <= 0 && this.pos.y < g + 0.28)) {
      if (!this.onGround && this.vel.y < -1.5) this._land(-this.vel.y);
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }

  _land(speed) {
    this.landDip = Math.min(0.32, speed * 0.032);
    this.world.waterAt(this.pos.x, this.pos.z, _w);
    const inWater = _w.depth > 1.0;
    if (!inWater && speed > PLAYER.fallSafe) {
      const dmg = (speed - PLAYER.fallSafe) * 7.5;
      this.events.hurt?.(dmg, 'fall');
    }
    this.events.land?.(speed, inWater);
    this.kick.y = Math.min(0.08, speed * 0.006);
  }

  _climb(dt, my) {
    const L = this.ladder;
    this.vel.set(0, 0, 0);
    this.pos.x = damp(this.pos.x, L.x, 8, dt);
    this.pos.z = damp(this.pos.z, L.z, 8, dt);
    this.pos.y += my * 1.7 * dt * this.speedMul;
    this.onGround = false;
    this.climbPhase = (this.climbPhase || 0) + Math.abs(my) * dt * 4;
    if (this.pos.y <= L.y0 - 0.05) { this.pos.y = L.y0; this.ladder = null; }
    else if (this.pos.y >= L.y1) { this.pos.y = L.y1; this.ladder = null; this.vel.set(-Math.sin(this.yaw) * 1.2, 0, -Math.cos(this.yaw) * 1.2); }
  }

  grabLadder(ladder) {
    this.ladder = ladder;
    this.crouching = false;
  }

  _bounds() {
    const lim = 985;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = Math.sign(this.pos.x) * lim; this.vel.x = 0; }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = Math.sign(this.pos.z) * lim; this.vel.z = 0; }
  }

  _cameraMotion(dt) {
    const cam = this.camera;
    // eye height eases between standing, crouching and swimming
    const targetEye = this.eyeOverride ?? (this.swimming ? 0.5 : this.crouching ? PLAYER.eyeCrouch : PLAYER.eye);
    this.eye = this.eyeOverride != null ? this.eyeOverride : damp(this.eye, targetEye, 9, dt);
    this.landDip = damp(this.landDip, 0, 7, dt);
    this.kick.multiplyScalar(Math.exp(-9 * dt));

    // head bob follows the stride, stronger when running or tired
    const moving = this.onGround && this.speed > 0.4;
    const rate = this.sprinting ? 2.6 : this.crouching ? 1.5 : 1.85;
    if (moving) this.bob += dt * this.speed * rate * 1.35;
    const amp = (this.sprinting ? 0.055 : 0.032) * (moving ? 1 : 0) * (1 + this.fatigue * 0.5);
    const bobY = Math.sin(this.bob * 2) * amp;
    const bobX = Math.cos(this.bob) * amp * 0.7;
    let swimBob = 0;
    if (this.swimming) swimBob = Math.sin(performance.now() * 0.0018) * 0.035;
    const breathe = Math.sin(performance.now() * 0.0032 * (1 + this.fatigue * 2)) * (0.004 + this.fatigue * 0.014);

    let climbY = 0;
    if (this.ladder) climbY = Math.sin((this.climbPhase || 0) * 3) * 0.02;

    const y = this.pos.y + this.eye - this.landDip + bobY + swimBob + breathe + climbY;
    const sideRoll = -this.input.moveX * 0.012 * Math.min(1, this.speed / 3);
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bobX, y, this.pos.z - Math.sin(this.yaw) * bobX);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.kick.y, this.yaw + this.kick.x, sideRoll + Math.sin(this.bob) * amp * 0.25);

    const wantFov = (this.baseFov ?? PLAYER.fov) + (this.sprinting && this.speed > 4 ? 7 : 0);
    this.fovBoost = damp(this.fovBoost, wantFov, 5, dt);
    if (Math.abs(cam.fov - this.fovBoost) > 0.02) { cam.fov = this.fovBoost; cam.updateProjectionMatrix(); }

    this.underwater = damp(this.underwater, cam.position.y < this._surfaceY() ? 1 : 0, 12, dt);
  }

  _surfaceY() {
    this.world.waterAt(this.camera.position.x, this.camera.position.z, _w);
    return _w.depth > 0.05 ? _w.y : -1e9;
  }

  _footsteps(dt) {
    if (!(this.onGround && this.speed > 0.5) && !(this.swimming && this.speed > 0.4)) return;
    this.stride += this.speed * dt;
    const len = this.sprinting ? 2.5 : this.crouching ? 1.15 : 1.55;
    if (this.stride >= len) {
      this.stride = 0;
      if (this.swimming) { this.events.swimStroke?.(); return; }
      this.surface = this.world.surfaceAt(this.pos.x, this.pos.z);
      const box = this.coll.boxGround(this.pos.x, this.pos.z, PLAYER.radius, this.pos.y, 0.6);
      if (box > -1e8 && Math.abs(box - this.pos.y) < 0.05) this.surface = 'wood';
      this.events.step?.(this.surface, this.sprinting ? 1 : this.crouching ? 0.35 : 0.6);
    }
  }
}
