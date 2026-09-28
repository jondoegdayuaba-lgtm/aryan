// Drives the truck along the route by itself: used for the menu's attract mode
// and for automated testing.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Autopilot {
  constructor(route, { maxSpeed = 38, aggression = 1 } = {}) {
    this.route = route;
    this.s = null;
    this.maxSpeed = maxSpeed;
    this.aggression = aggression;
  }

  reset(s = null) { this.s = s; }

  drive(vehicle) {
    const R = this.route;
    const p = vehicle.pos;
    const n = R.nearest(p.x, p.z, this.s, 60);
    this.s = n.s;
    const speed = vehicle.speed;
    const look = 7 + speed * 0.75;
    const t = R.pos(n.s + look);
    // Aim back toward the centre line when off to one side.
    const desired = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    const err = angDiff(desired, vehicle.heading);
    const steer = vehicle.groundedWheels > 0 ? clamp(-err * 2.4, -1, 1) : 0;

    // Slow for bends ahead.
    let bend = 0;
    const a = R.tangent(n.s + 5);
    for (let d = 15; d <= 25 + speed * 2.2; d += 10) {
      const b = R.tangent(n.s + d);
      bend = Math.max(bend, Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1)) / (d / 40));
    }
    let vmax = clamp(this.maxSpeed * this.aggression - bend * 26, 12, this.maxSpeed * this.aggression);
    // Well off the line or pointing the wrong way: slow right down and turn back.
    vmax = Math.min(vmax, Math.max(8, 40 - Math.abs(err) * 45 - Math.max(0, n.d - 6) * 1.2));
    const throttle = speed < vmax ? 1 : speed < vmax + 2 ? 0.3 : 0;
    const brake = speed > vmax + 5 ? clamp((speed - vmax) / 10, 0, 1) : 0;
    return { throttle, brake, steer, handbrake: false, boost: false, lookX: 0, lookY: 0 };
  }
}
