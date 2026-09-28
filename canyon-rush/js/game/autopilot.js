// Rides the bike along the route by itself: used for the menu's attract mode
// (which throws in the odd wheelie on the straights) and for automated testing.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Autopilot {
  constructor(route, { maxSpeed = 30, aggression = 1, wheelies = false } = {}) {
    this.route = route;
    this.s = null;
    this.maxSpeed = maxSpeed;
    this.aggression = aggression;
    this.wheelies = wheelies;
    this.wheelieT = 0;
    this.nextWheelie = 3;
    this._r = new THREE.Vector3();
  }

  reset(s = null) {
    this.s = s;
    this.wheelieT = 0;
  }

  drive(bike, dt = 1 / 60) {
    const R = this.route;
    const p = bike.pos;
    const n = R.nearest(p.x, p.z, this.s, 60);
    this.s = n.s;
    const speed = bike.speed;
    const look = 6 + speed * 0.7;
    const t = R.pos(n.s + look);
    // Aim back toward the centre line when off to one side.
    const desired = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    const err = angDiff(desired, bike.heading);
    const steer = bike.groundedWheels > 0 ? clamp(-err * 2.4, -1, 1) : 0;

    // Slow for bends ahead.
    let bend = 0;
    const a = R.tangent(n.s + 5);
    for (let d = 15; d <= 25 + speed * 2.2; d += 10) {
      const b = R.tangent(n.s + d);
      bend = Math.max(bend, Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1)) / (d / 40));
    }
    let vmax = clamp(this.maxSpeed * this.aggression - bend * 24, 10, this.maxSpeed * this.aggression);
    // Well off the line or pointing the wrong way: slow right down and turn back.
    vmax = Math.min(vmax, Math.max(7, 36 - Math.abs(err) * 40 - Math.max(0, n.d - 6) * 1.2));
    let throttle = speed < vmax ? 1 : speed < vmax + 2 ? 0.3 : 0;
    let brake = speed > vmax + 4 ? clamp((speed - vmax) / 10, 0, 1) : 0;

    // Show-off wheelies on the straights: balance on the throttle and rear brake.
    let lean = false;
    if (this.wheelies && !bike.crashed) {
      this.nextWheelie -= dt;
      const straight = bend < 0.12 && Math.abs(err) < 0.12 && n.d < 4;
      if (this.wheelieT > 0) {
        this.wheelieT -= dt;
        if (!straight || speed > 23 || bike.groundedWheels === 0) this.wheelieT = Math.min(this.wheelieT, 0.15);
        lean = this.wheelieT > 0;
        if (lean) {
          const rate = bike.angVel.dot(this._r.set(1, 0, 0).applyQuaternion(bike.quat));
          const target = bike.balanceAngle - 0.28;
          const k = clamp(650 / bike.spec.force, 0.25, 0.6);    // gentler on the big bike
          throttle = clamp(k + (target - bike.wheelieAngle) * 5 * k - rate * 1.2 * k, 0, 1);
          brake = bike.wheelieAngle > bike.balanceAngle - 0.06 ? 0.7 : 0;
        }
      } else if (this.nextWheelie <= 0 && straight && speed > 9 && speed < 21) {
        this.wheelieT = 2.5 + Math.random() * 3.5;
        this.nextWheelie = 6 + Math.random() * 6;
      }
    }
    return { throttle, brake, steer, lean, boost: false, lookX: 0, lookY: 0 };
  }
}
