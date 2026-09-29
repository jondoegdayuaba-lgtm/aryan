// Style points: wheelies (by the metre, more near the balance point), big air,
// freestyle tricks, backflips and 360s, clean landings, slides, splashes and
// flattened cacti. Everything done in one jump pays out together on landing
// (nothing if you crash). Chaining tricks inside a few seconds builds a
// multiplier; a crash resets it.
import * as THREE from 'three';
import { TRICKS } from './tricks.js';

const TAU = Math.PI * 2;

export class Stunts {
  constructor() {
    this._r = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.total = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.air = 0;
    this.pitchAcc = 0;
    this.yawAcc = 0;
    this.wasAir = false;
    this.jumpTricks = [];
    this.trickN = -1;
    this.tricksLanded = 0;
    this.slide = 0;
    this.slideTime = 0;
    this.slideCool = 0;
    this.sliding = 0;
    this.inWater = false;
    this.crashes = 0;
    this.wheelie = { active: false, dist: 0, time: 0, sweet: 0, last: 0, lastT: 99 };
    this.best = { air: 0, wheelie: 0, slide: 0 };
  }

  _award(events, label, points, sub = '', extra = {}, step = 1) {
    const pts = Math.round(points * this.combo);
    this.total += pts;
    events.push({ type: 'stunt', label, points: pts, combo: this.combo, sub, ...extra });
    this.combo = Math.min(5, this.combo + step);
    this.comboTimer = 4;
  }

  update(dt, bike) {
    const ev = [];
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 1;
    this.wheelie.lastT += dt;
    if (bike.crashed) return ev;
    const right = this._r.set(1, 0, 0).applyQuaternion(bike.quat);
    const air = bike.groundedWheels === 0;

    // ---- Air: tricks, flips and spins, paid out together on landing.
    if (bike.trick) {
      if (bike.trickCount !== this.trickN) {
        this.trickN = bike.trickCount;
        this.jumpTricks.push({ id: bike.trick, n: bike.trickCount, held: 0 });
      }
      const last = this.jumpTricks[this.jumpTricks.length - 1];
      if (last && last.n === bike.trickCount) last.held = bike.trickHeld;
    }
    if (air) {
      this.air += dt;
      this.pitchAcc += bike.angVel.dot(right) * dt;
      this.yawAcc += bike.angVel.y * dt;
      this.wasAir = true;
    } else if (this.wasAir) {
      const t = this.air;
      const flips = Math.floor(Math.abs(this.pitchAcc) / (TAU * 0.85));
      const spins = Math.floor(Math.abs(this.yawAcc) / (TAU * 0.85));
      const names = [];
      let pts = 0;
      // A trick counts once it's been held all the way out for a moment.
      for (const tr of this.jumpTricks) {
        if (tr.held < 0.08) continue;
        const T = TRICKS[tr.id];
        names.push(T.name.toUpperCase());
        pts += T.base + T.rate * tr.held;
        this.tricksLanded++;
      }
      if (flips) { names.push((this.pitchAcc > 0 ? 'BACKFLIP' : 'FRONTFLIP') + (flips > 1 ? ` x${flips}` : '')); pts += 700 * flips; }
      if (spins) { names.push(spins > 1 ? `${spins * 360}` : '360'); pts += 500 * spins; }
      if (t > 0.55) {
        this.best.air = Math.max(this.best.air, t);
        pts += t * 120;
        if (!names.length) names.push(t > 2.4 ? 'HUGE AIR' : t > 1.4 ? 'BIG AIR' : 'AIR');
      }
      const clean = t > 0.8 && bike.groundedWheels === 2 && Math.abs(bike.angVel.dot(right)) < 1;
      if (clean) pts += 100;
      if (names.length) this._award(ev, names.join(' + '), pts, `${t.toFixed(1)} s${clean ? ' · clean landing' : ''}`, { tricks: names.length }, names.length);
      this.air = 0;
      this.pitchAcc = 0;
      this.yawAcc = 0;
      this.wasAir = false;
      this.jumpTricks.length = 0;
    }

    // ---- Wheelies: distance on the back wheel, with a bonus for time spent near the balance point.
    // A short hop off a bump (back wheel briefly off the ground, nose still up)
    // doesn't end it.
    const W = this.wheelie;
    const hop = W.active && air && bike.wheelieAngle > 0.2;
    if ((bike.inWheelie && !air) || hop) {
      W.grace = hop ? (W.grace || 0) + dt : 0;
      if (W.grace > 0.3) this._endWheelie(ev);
      else {
        W.active = true;
        W.dist += bike.speed * dt;
        W.time += dt;
        // The green band on the wheelie meter: just under the balance point.
        const off = bike.wheelieAngle - bike.balanceAngle;
        if (off > -0.28 && off < 0.05) W.sweet += dt;
      }
    } else if (W.active) {
      W.grace = (W.grace || 0) + dt;
      if (W.grace > 0.12 || bike.wheels[0].contact) this._endWheelie(ev);
    }

    // ---- Slides: rear stepped out at speed.
    const hs = Math.hypot(bike.vel.x, bike.vel.z);
    let slip = 0;
    if (hs > 8 && !air) {
      const f = this._f.set(0, 0, -1).applyQuaternion(bike.quat);
      f.y = 0;
      slip = Math.acos(THREE.MathUtils.clamp((f.x * bike.vel.x + f.z * bike.vel.z) / (hs * (f.length() || 1)), -1, 1));
    }
    if (slip > 0.35 && slip < 1.6) {
      this.slide += dt * (slip * 110 + hs * 4);
      this.slideTime += dt;
      this.slideCool = 0.4;
    } else if (this.slideTime > 0) {
      this.slideCool -= dt;
      if (this.slideCool <= 0 || air) {
        if (this.slideTime > 0.7 && this.slide > 60) {
          this.best.slide = Math.max(this.best.slide, this.slide);
          this._award(ev, this.slide > 800 ? 'MEGA SLIDE' : 'SLIDE', this.slide, `${this.slideTime.toFixed(1)} s`);
        }
        this.slide = 0;
        this.slideTime = 0;
      }
    }
    this.sliding = this.slideTime > 0.4 ? this.slide : 0;

    // ---- Splashing through the oasis.
    const wet = (bike.inWater || 0) > 0.02;
    if (wet && !this.inWater && bike.speed > 10) this._award(ev, 'SPLASH', 150);
    this.inWater = wet;
    return ev;
  }

  _endWheelie(ev) {
    const W = this.wheelie;
    if (W.dist >= 8) {
      const sweet = W.time > 0 ? W.sweet / W.time : 0;
      const label = W.dist > 300 ? 'MONSTER WHEELIE' : W.dist > 120 ? 'MEGA WHEELIE' : W.dist > 40 ? 'BIG WHEELIE' : 'WHEELIE';
      this.best.wheelie = Math.max(this.best.wheelie, W.dist);
      this._award(ev, label, W.dist * 4 * (1 + sweet), `${Math.round(W.dist)} m${sweet > 0.5 ? ' · balanced' : ''}`);
      ev.push({ type: 'wheelieEnd', wheelie: W.dist, crashed: false });
      W.last = W.dist;
      W.lastT = 0;
    }
    W.active = false;
    W.dist = 0;
    W.time = 0;
    W.sweet = 0;
    W.grace = 0;
  }

  // Crashing cancels whatever was in progress and resets the multiplier.
  crash(ev) {
    this.combo = 1;
    this.comboTimer = 0;
    const W = this.wheelie;
    if (W.active && W.dist >= 8) {
      // A wheelie that ends in a loop-out still measures as far as it got (no points).
      W.last = W.dist;
      W.lastT = 0;
      this.best.wheelie = Math.max(this.best.wheelie, W.dist);
      ev?.push({ type: 'wheelieEnd', wheelie: W.dist, crashed: true });
    }
    W.active = false;
    W.dist = W.time = W.sweet = 0;
    this.air = this.pitchAcc = this.yawAcc = 0;
    this.wasAir = false;
    this.jumpTricks.length = 0;
    this.slide = this.slideTime = 0;
    this.crashes++;
  }

  cactus(ev) {
    this._award(ev, 'CACTUS SMASH', 40);
  }
}
