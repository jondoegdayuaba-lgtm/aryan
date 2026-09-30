import * as THREE from 'three';
import { BIKE } from './config.js';
import { clamp, damp } from './collision.js';

export class Bike {
  constructor(assets, scene, fx, audio) {
    this.fx = fx;
    this.audio = audio;
    this.obj = new THREE.Group();
    this.leanG = new THREE.Group();
    this.obj.add(this.leanG);
    const model = assets.ebike.clone(true);
    this.leanG.add(model);
    this.model = model;
    this.steerN = model.getObjectByName('steer');
    this.wheelF = model.getObjectByName('wheel_f');
    this.wheelR = model.getObjectByName('wheel_r');
    this.rider = model.getObjectByName('rider_upper');
    // brake light material (shared by the whole model)
    this.tail = null;
    this.lens = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.name === 'taillight') this.tail = m;
        if (m.name === 'headlamp') this.lens = m;
      }
    });
    if (this.lens) this.lens.emissiveIntensity = 2.4;
    this.lensBase = 2.4;
    this.tailBase = this.tail ? this.tail.emissiveIntensity : 1;

    // headlight: a warm-white spot pointing down the road
    this.head = new THREE.SpotLight(0xdfe9ff, 520, 70, 0.55, 0.65, 1.6);
    this.head.castShadow = false;
    this.head.position.set(0, 1.0, -0.6);
    this.head.target.position.set(0, 0.2, -18);
    this.obj.add(this.head, this.head.target);
    scene.add(this.obj);

    this.circleOff = [0.55, -0.5];
    this.reset(0, 0, 0);
  }

  reset(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.vx = 0; this.vz = 0;
    this.steer = 0; this.roll = 0; this.pitch = 0;
    this.battery = BIKE.battery;
    this.hp = BIKE.hp;
    this.alive = true;
    this.boosting = false;
    this.braking = false;
    this.slip = 0;
    this.shake = 0;
    this.distance = 0;
    this.wheelSpin = 0;
    this.fall = 0;
    this.smokeT = 0;
    this.lastHit = 0;
    this.sync();
  }

  get fx0() { return -Math.sin(this.h); }
  get fz0() { return -Math.cos(this.h); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * this.fx0 + this.vz * this.fz0; }

  damage(amount, why = '') {
    if (!this.alive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.shake = Math.min(1.4, this.shake + amount * 0.04);
    if (this.hp <= 0) { this.alive = false; this.cause = why; }
  }

  update(dt, inp, world, time) {
    const fx = this.fx0, fz = this.fz0;
    const rx = Math.cos(this.h), rz = -Math.sin(this.h);
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;

    if (!this.alive) { inp = { throttle: 0, brake: 0.4, steer: 0, handbrake: false, boost: false }; }

    // --- steering input, smoothed ---
    this.steer += (inp.steer - this.steer) * damp(inp.steer !== 0 ? 9 : 14, dt);

    // --- longitudinal ---
    const dmgK = this.hp < 30 ? 0.75 + this.hp / 120 : 1;
    let maxV = BIKE.maxSpeed * dmgK;
    this.boosting = inp.boost && this.battery > 1 && inp.throttle > 0 && this.alive;
    if (this.boosting) { maxV = BIKE.boostSpeed; this.battery = Math.max(0, this.battery - BIKE.boostDrain * dt); }
    else this.battery = Math.min(BIKE.battery, this.battery + BIKE.batteryRegen * dt * (inp.throttle > 0 ? 1 : 0.4));

    if (inp.throttle > 0 && vf < maxV) {
      const a = (this.boosting ? BIKE.boostAccel : BIKE.accel) * (1 - Math.pow(Math.max(0, vf) / maxV, 2.2) * 0.9);
      vf += a * inp.throttle * dt * (vf < 0 ? 2.5 : 1);
    }
    this.braking = false;
    if (inp.brake > 0) {
      if (vf > 0.6) { vf = Math.max(0, vf - BIKE.brake * inp.brake * dt); this.braking = true; }
      else vf = Math.max(-5, vf - 7 * inp.brake * dt);
    }
    if (inp.handbrake) { vf *= Math.exp(-0.5 * dt); this.braking = true; }
    // drag + rolling resistance, and bleed off boost overspeed
    vf -= (BIKE.drag * vf * Math.abs(vf) + Math.sign(vf) * 0.5) * dt;
    if (vf > BIKE.maxSpeed * dmgK && !this.boosting) vf -= (vf - BIKE.maxSpeed * dmgK) * 1.1 * dt;

    // --- yaw ---
    const av = Math.abs(vf);
    const sf = clamp(av / 3, 0, 1) / (1 + Math.pow(av / 30, 1.5) * 1.5);
    const yaw = this.steer * BIKE.yawRate * sf * (inp.handbrake ? 1.7 : 1) * Math.sign(vf || 1);
    this.h += yaw * dt;

    // --- lateral grip (slide when hard cornering or handbraking) ---
    const latAcc = Math.abs(yaw * vf);
    let grip = inp.handbrake ? BIKE.driftGrip : BIKE.grip / (1 + Math.max(0, latAcc - 13) * 0.16);
    vl *= Math.exp(-grip * dt);
    this.slip = clamp(Math.abs(vl) / 5, 0, 1) * (av > 3 ? 1 : 0);

    // recompose the velocity in the rotated frame
    const nfx = -Math.sin(this.h), nfz = -Math.cos(this.h), nrx = Math.cos(this.h), nrz = -Math.sin(this.h);
    this.vx = nfx * vf + nrx * vl;
    this.vz = nfz * vf + nrz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.alive) this.distance += Math.max(0, vf) * dt;

    this.collide(world, time);
    this.visuals(dt, yaw, vf, inp, time);
  }

  collide(world, time) {
    const fx = this.fx0, fz = this.fz0;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const off of this.circleOff) {
        const cx = this.x + fx * off, cz = this.z + fz * off;
        for (const h of world.collide(cx, cz, 0.42)) {
          hit = true;
          this.x += h.nx * h.depth;
          this.z += h.nz * h.depth;
          const vn = this.vx * h.nx + this.vz * h.nz;
          if (vn < 0) {
            const impact = -vn;
            const e = h.kind === 'prop' ? 0.25 : 0.12;
            this.vx -= (1 + e) * vn * h.nx;
            this.vz -= (1 + e) * vn * h.nz;
            // scrape: shed a little tangential speed too
            const tx = -h.nz, tz = h.nx, vt = this.vx * tx + this.vz * tz;
            this.vx -= vt * 0.06 * tx; this.vz -= vt * 0.06 * tz;
            this.onImpact(impact, cx - h.nx * 0.42, cz - h.nz * 0.42, h.kind, time);
          }
        }
      }
      if (!hit) break;
    }
  }

  onImpact(impact, px, pz, kind, time) {
    if (impact < 1.2) return;
    const heavy = impact > BIKE.crashSpeed;
    if (heavy && time - this.lastHit > 0.15) {
      this.damage((impact - BIKE.crashSpeed) * (kind === 'prop' ? 1.2 : 2.0), 'crash');
      this.audio.crash(clamp(impact / 20, 0.25, 1));
      this.lastHit = time;
      this.shake = Math.min(1.4, this.shake + impact * 0.03);
      // a hard hit knocks the bike sideways
      this.h += (Math.random() - 0.5) * 0.25 * clamp(impact / 15, 0, 1);
    } else if (time - this.lastHit > 0.2) {
      this.audio.scrape();
      this.lastHit = time - 0.05;
    }
    const n = Math.min(26, Math.floor(impact * 1.6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 2 + Math.random() * 7;
      this.fx.sparks.emit(px, 0.4 + Math.random() * 0.6, pz, Math.cos(a) * s, 1 + Math.random() * 4, Math.sin(a) * s, 0.4 + Math.random() * 0.4, 0.14, 1, 0.75, 0.3, 1, 0, 14);
    }
  }

  /** External bump (car hit). n points away from the other body. */
  knock(nx, nz, strength, dmg, time) {
    this.vx += nx * strength; this.vz += nz * strength;
    if (dmg > 0) { this.damage(dmg, 'crash'); this.shake = Math.min(1.4, this.shake + dmg * 0.05); }
    this.lastHit = time;
  }

  visuals(dt, yaw, vf, inp, time) {
    const av = Math.abs(vf);
    const leanT = clamp(this.steer * clamp(av / 14, 0, 1) * 0.62 + (this.slip * Math.sign(this.steer || 1) * 0.1), -0.75, 0.75);
    if (!this.alive) { this.fall = Math.min(1, this.fall + dt * 2.2); }
    this.roll += (leanT - this.roll) * damp(8, dt);
    this.pitch += ((this.boosting ? 0.07 : 0) - (this.braking ? 0.05 : 0) - this.pitch) * damp(6, dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.sync();
    this.wheelSpin -= vf * dt / 0.33;
    if (this.wheelF) this.wheelF.rotation.x = this.wheelSpin;
    if (this.wheelR) this.wheelR.rotation.x = this.wheelSpin;
    if (this.steerN) this.steerN.rotation.y = this.steer * 0.33;
    if (this.rider) {
      this.rider.rotation.z = this.roll * 0.45;
      this.rider.rotation.x = -this.pitch * 2 + (this.boosting ? 0.12 : 0);
    }
    if (this.tail) this.tail.emissiveIntensity = this.tailBase * (this.braking ? 3 : 1);
    // looking back straight into our own headlight: tone it down
    const dim = inp.lookBack ? 0.18 : 1;
    if (this.lens) this.lens.emissiveIntensity += (this.lensBase * dim - this.lens.emissiveIntensity) * damp(10, dt);
    this.head.intensity += (520 * (inp.lookBack ? 0.3 : 1) - this.head.intensity) * damp(10, dt);

    // trail sparks from the rear of the bike while boosting or sliding
    const bx = this.x - this.fx0 * 0.9, bz = this.z - this.fz0 * 0.9;
    if (this.boosting && Math.random() < 0.9) {
      this.fx.sparks.emit(bx, 0.45, bz, -this.vx * 0.05 + (Math.random() - 0.5), 0.3, -this.vz * 0.05 + (Math.random() - 0.5), 0.35, 0.22, 0.2, 0.9, 1.0, 0.9);
    }
    if (this.slip > 0.45 && this.speed > 6) {
      this.fx.smoke.emit(bx, 0.15, bz, (Math.random() - 0.5) * 1.2, 0.6, (Math.random() - 0.5) * 1.2, 0.9, 0.5, 0.55, 0.57, 0.6, 0.35, 1.8);
    }
    if (this.hp < 40 && this.alive || !this.alive && this.speed > 0.5) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.05;
        this.fx.smoke.emit(this.x, 0.7, this.z, (Math.random() - 0.5) * 0.6, 1.4, (Math.random() - 0.5) * 0.6, 1.4, 0.45, 0.16, 0.16, 0.17, 0.55, 2.2);
      }
    }
  }

  sync() {
    this.obj.position.set(this.x, 0, this.z);
    this.obj.rotation.y = this.h;
    const fall = this.fall;
    this.leanG.rotation.z = this.roll + Math.sign(this.roll || 1) * fall * (1.45 - Math.abs(this.roll));
    this.leanG.rotation.x = this.pitch;
    this.leanG.position.y = -fall * 0.12;
  }
}
