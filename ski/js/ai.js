// Autopilot: follows the piste (and the gates) by pure pursuit. Used by the automated tests, by the
// title-screen demo skier and as the pace-setting rival.
import { clamp, angleDiff, smoothstep } from './util.js';
import { TUNING, G } from './physics.js';

const _p = {};
const _q = {};

export class Autopilot {
  /**
   * @param world WorldData
   * @param course Course
   * @param skill 0.6 (careful) .. 1.1 (attacking)
   */
  constructor(world, course, skill = 1.0) {
    this.world = world;
    this.course = course;
    this.skill = skill;
    this.aLatMax = (course.slalom ? 0.68 : 0.77) * (TUNING.gripBase + TUNING.gripEdge) * G * skill;
    this.tucking = false;
    this.jumpTimer = 0;
  }

  /** lateral offset of the racing line at distance s (cosine blend between gate offsets) */
  lineOffset(s) {
    const gates = this.course.gates;
    if (!gates.length || !this.course.slalom) return 0;
    if (s <= gates[0].s) return gates[0].t * smoothstep(gates[0].s - 60, gates[0].s, s);
    for (let i = 0; i < gates.length - 1; i++) {
      const a = gates[i], b = gates[i + 1];
      if (s >= a.s && s <= b.s) {
        const u = (s - a.s) / (b.s - a.s);
        const k = 0.5 - 0.5 * Math.cos(Math.PI * u);
        return a.t + (b.t - a.t) * k;
      }
    }
    return gates[gates.length - 1].t;
  }

  /** speed the corner ahead allows */
  safeSpeed(s, speed) {
    const path = this.world.path;
    let vmin = 60;
    const look = 10 + speed * 2.6;
    for (let d = 8; d <= look; d += 8) {
      path.at(s + d, _q);
      const curv = Math.abs(_q.curv);
      const v = Math.sqrt(this.aLatMax / Math.max(curv, 1e-4));
      if (v < vmin) vmin = v;
    }
    if (this.course.slalom) {
      // the zig-zag between two gates is a sine of amplitude A and half wavelength L: curvature A (pi/L)^2
      const g = this.course.gates;
      for (let i = 0; i < g.length - 1; i++) {
        if (g[i + 1].s < s - 5 || g[i].s > s + look) continue;
        const A = Math.abs(g[i + 1].t - g[i].t) / 2;
        const L = g[i + 1].s - g[i].s;
        const k = A * (Math.PI / L) ** 2;
        const v = Math.sqrt(this.aLatMax / Math.max(k, 1e-4));
        if (v < vmin) vmin = v;
      }
    }
    return vmin;
  }

  control(sk, time = 0) {
    const path = this.world.path;
    const speed = Math.hypot(sk.vx, sk.vz);
    const s = sk.pathS;
    const Ld = this.course.slalom ? clamp(4 + 0.5 * speed, 6.5, 26) : clamp(7 + 0.75 * speed, 9, 40);
    path.at(s + Ld, _p);
    const off = this.lineOffset(s + Ld);
    const tx = _p.x + _p.rx * off, tz = _p.z + _p.rz * off;
    const desired = Math.atan2(tx - sk.x, -(tz - sk.z));
    const err = angleDiff(desired, sk.yaw);
    let steer = clamp(2.6 * err, -1, 1);
    // stay off the edges when slipping
    const vheading = Math.atan2(sk.vx, -sk.vz);
    const drift = speed > 2 ? angleDiff(vheading, sk.yaw) : 0;
    steer = clamp(steer + 0.6 * drift, -1, 1);

    const vSafe = this.safeSpeed(s, speed);
    let brake = clamp((speed - vSafe - 0.8) / 5, 0, 1);
    const straight = Math.abs(err) < 0.10 && vSafe > speed + 3;
    const tuck = straight ? 1 : 0;

    // pre-jump at the lip of a kicker
    let jump = false;
    if (sk.crashed) { brake = 0; }
    return { steer, tuck, brake, jump, push: speed < 8.5 };
  }
}
