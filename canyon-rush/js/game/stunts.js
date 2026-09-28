// Style points: big air, flips and rolls, drifts, perfect landings, splashes and
// flattened cacti. Chaining tricks inside a few seconds builds a multiplier.
import * as THREE from 'three';

export class Stunts {
  constructor() {
    this.reset();
    this._v = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  reset() {
    this.total = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.air = 0;
    this.pitchAcc = 0;
    this.rollAcc = 0;
    this.drift = 0;
    this.driftTime = 0;
    this.driftCool = 0;
    this.wasAir = false;
    this.inWater = false;
    this.best = { air: 0, drift: 0 };
  }

  _award(events, label, points, sub = '') {
    const pts = Math.round(points * this.combo);
    this.total += pts;
    events.push({ type: 'stunt', label, points: pts, combo: this.combo, sub });
    this.combo = Math.min(5, this.combo + 1);
    this.comboTimer = 4;
  }

  update(dt, v) {
    const ev = [];
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 1;
    const up = this._v.set(0, 1, 0).applyQuaternion(v.quat);
    const right = this._r.set(1, 0, 0).applyQuaternion(v.quat);
    const fwd = this._f.set(0, 0, -1).applyQuaternion(v.quat);
    const air = v.groundedWheels === 0;

    if (air) {
      this.air += dt;
      this.pitchAcc += v.angVel.dot(right) * dt;
      this.rollAcc += v.angVel.dot(fwd) * dt;
      this.wasAir = true;
    } else if (this.wasAir) {
      // Landed.
      const t = this.air;
      const flips = Math.floor(Math.abs(this.pitchAcc) / (Math.PI * 1.7));
      const rolls = Math.floor(Math.abs(this.rollAcc) / (Math.PI * 1.7));
      const upright = up.y > 0.85;
      if (t > 0.55) {
        this.best.air = Math.max(this.best.air, t);
        const label = t > 2.6 ? 'HUGE AIR' : t > 1.5 ? 'BIG AIR' : 'AIR';
        this._award(ev, label, t * 120, `${t.toFixed(1)} s`);
      }
      if (upright && (flips || rolls)) {
        if (flips) this._award(ev, this.pitchAcc > 0 ? 'BACKFLIP' : 'FRONTFLIP', 600 * flips);
        if (rolls) this._award(ev, 'BARREL ROLL', 500 * rolls);
      }
      if (t > 0.8 && upright && v.groundedWheels === 4 && Math.abs(v.angVel.dot(right)) < 0.8) this._award(ev, 'CLEAN LANDING', 100);
      this.air = 0;
      this.pitchAcc = 0;
      this.rollAcc = 0;
      this.wasAir = false;
    }

    // Drifting: sliding sideways at speed.
    const hs = Math.hypot(v.vel.x, v.vel.z);
    let slip = 0;
    if (hs > 11 && !air) {
      const vf = v.vel.dot(fwd) / (v.vel.length() || 1);
      slip = Math.acos(Math.min(1, Math.max(-1, vf)));
    }
    if (slip > 0.3 && slip < 1.9 && !air) {
      this.drift += dt * (slip * 90 + hs * 3);
      this.driftTime += dt;
      this.driftCool = 0.45;
    } else if (this.driftTime > 0) {
      this.driftCool -= dt;
      if (this.driftCool <= 0 || air) {
        if (this.driftTime > 0.9 && this.drift > 60) {
          this.best.drift = Math.max(this.best.drift, this.drift);
          this._award(ev, this.drift > 900 ? 'MEGA DRIFT' : 'DRIFT', this.drift, `${this.driftTime.toFixed(1)} s`);
        }
        this.drift = 0;
        this.driftTime = 0;
      }
    }
    this.drifting = this.driftTime > 0.5 ? this.drift : 0;

    // Splash through the oasis.
    const wet = (v.inWater || 0) > 0.05;
    if (wet && !this.inWater && v.speed > 12) this._award(ev, 'SPLASH', 150);
    this.inWater = wet;
    return ev;
  }

  cactus(ev) {
    this._award(ev, 'CACTUS SMASH', 40);
  }
}
