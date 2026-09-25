// A robot driver that follows the stage road: pure-pursuit steering toward a
// point on the racing line ahead, and a speed plan that brakes for corners
// it can see coming. Drives the demo car and sets reference times.
import * as THREE from 'three';
import { locate, wrap } from './road.js';
import { racingLine } from './terrain.js';

export class Driver {
  constructor(world, car, { skill = 1, grip = 0.9 } = {}) {
    this.world = world;
    this.car = car;
    this.skill = skill;
    this.grip = grip;
    this.hint = -1;
    this.line = world.road.racing || (world.road.racing = racingLine(world.road));
    this.prevErr = 0;
    this.stuck = 0;
  }

  reset() { this.hint = -1; this.stuck = 0; }

  control(dt) {
    const road = this.world.road, car = this.car, n = road.count;
    const loc = locate(road, car.pos.x, car.pos.z, this.hint, 40);
    this.hint = loc.i;
    this.progress = loc.s;
    const S = car.spec;
    const v = car.forwardSpeed;
    const av = Math.max(Math.abs(v), 1);

    // Stanley-style steering: follow the road's curvature, then correct
    // heading and distance from the racing line.
    const ahead = wrap(loc.i + Math.round(3 + av * 0.25), n);
    let kap = 0;
    for (let k = -3; k <= 3; k++) kap += road.curv[wrap(ahead + k, n)];
    kap /= 7;
    const line = this.line[wrap(loc.i + Math.round(av * 0.4), n)] * 0.8;
    const cross = loc.lateral - line;                     // + means we're left of the line
    const hc = Math.atan2(car.F.x, car.F.z), hr = Math.atan2(road.tx[ahead], road.tz[ahead]);
    let he = hc - hr;
    he = Math.atan2(Math.sin(he), Math.cos(he));          // + means pointing left of the road
    // body slip: steer where the car is going, not where it points
    const slip = Math.atan2(car.vel.dot(car.L), av);
    let delta = Math.atan(S.wheelbase * kap) - he * 0.9 - Math.atan(0.9 * cross / (av + 2)) - slip * 0.5;
    const limit = S.steer.lock * THREE.MathUtils.clamp(11 / av, 0.17, 1);
    let steer = THREE.MathUtils.clamp(delta / limit, -1, 1);

    // Speed plan: the slowest corner within braking range sets the target.
    const g = 9.81 * this.grip * this.skill;
    let vt = 60;
    for (let k = 0; k < 160; k += 2) {
      const idx = wrap(loc.i + k, n);
      let kk = 0;
      for (let q = -4; q <= 4; q += 2) kk += Math.abs(road.curv[wrap(idx + q, n)]);
      kk = Math.max(kk / 5, 1e-4);
      const vc = Math.sqrt(g / kk);
      vt = Math.min(vt, Math.sqrt(vc * vc + 2 * g * 0.7 * Math.max(0, k - av * 0.3)));
    }
    // ease off when well off line or sliding
    vt *= THREE.MathUtils.clamp(1.15 - Math.abs(cross) * 0.08 - Math.abs(slip) * 0.8, 0.5, 1);
    let throttle = 0, brake = 0;
    const dv = vt - v;
    if (dv > 0) throttle = THREE.MathUtils.clamp(dv * 0.4, 0.15, 1);
    else brake = THREE.MathUtils.clamp(-dv * 0.2, 0, 1);
    // back up if wedged against something
    if (Math.abs(v) < 0.5 && throttle > 0.5) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 0.5);
    if (this.stuck > 2.5) { throttle = 0; brake = 1; steer = -steer; if (this.stuck > 5) this.stuck = 0; }
    return { steer, throttle, brake, handbrake: 0, assist: 1, auto: true, analog: true };
  }
}
