// Electric dirt-bike physics. Bike and rider are one rigid body on two wheels;
// each wheel is a sphere on its own suspension (fork in front, swingarm at the
// back). The motor gives full torque from standstill up to a power limit, and
// the tyres use a slip-angle curve inside a friction circle.
//
// The rider keeps the bike from toppling sideways, so the physics body never
// rolls while riding: lean in corners is worked out from speed and turn rate
// and shown by the model (`lean`). Pitch is fully simulated, which is where
// wheelies, jumps, flips and loop-outs come from. A crash lets go of all that:
// the bike tumbles freely and the rider is thrown off.
//
// In the air the rider can also throw freestyle tricks (see tricks.js): only
// the pose changes, but still being stretched out when the wheels touch down
// means a bail.
import * as THREE from 'three';
import { TRICK_OUT, TRICK_IN, TRICK_BAIL } from './tricks.js';

const V = () => new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const GRAVITY = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Tyres grip harder sideways than straight on: game tyres, so the bikes corner
// hard and forgive a lot.
const CORNER_GRIP = 1.3;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Masses include the rider. Lengths in metres, forces in newtons, power in watts.
export const BIKES = [
  {
    id: 'volt', name: 'Volt LX', blurb: 'Light and flickable. The easiest bike to wheelie.',
    mass: 130, inertia: new THREE.Vector3(30, 26, 14),
    wheelbase: 1.26, cgBack: 0.62, cgHeight: 0.84, radius: 0.32,
    travelF: 0.22, travelR: 0.24,
    force: 1150, power: 11000, topSpeed: 28, regen: 150,
    brakeF: 1400, brakeR: 800,
    grip: 1.0, dragArea: 0.55,
    wheelieAssist: 0.82, wheelieMax: 650,
    stats: { speed: 0.55, accel: 0.62, weight: 0.3, wheelie: 1.0 },
  },
  {
    id: 'sting', name: 'Sting R', blurb: 'More power and a longer swingarm. Quick everywhere.',
    mass: 140, inertia: new THREE.Vector3(34, 30, 16),
    wheelbase: 1.3, cgBack: 0.64, cgHeight: 0.86, radius: 0.33,
    travelF: 0.24, travelR: 0.25,
    force: 1350, power: 15500, topSpeed: 32, regen: 170,
    brakeF: 1550, brakeR: 880,
    grip: 1.02, dragArea: 0.56,
    wheelieAssist: 0.76, wheelieMax: 950,
    stats: { speed: 0.72, accel: 0.74, weight: 0.42, wheelie: 0.8 },
  },
  {
    id: 'storm', name: 'Storm MX', blurb: 'Full-size electric motocross. Brutal, and harder to hold up.',
    mass: 192, inertia: new THREE.Vector3(52, 46, 24),
    wheelbase: 1.48, cgBack: 0.72, cgHeight: 0.95, radius: 0.36,
    travelF: 0.3, travelR: 0.31,
    force: 2150, power: 42000, topSpeed: 38, regen: 220,
    brakeF: 2100, brakeR: 1150,
    grip: 1.05, dragArea: 0.62,
    wheelieAssist: 0.7, wheelieMax: 1750,
    stats: { speed: 1.0, accel: 1.0, weight: 0.9, wheelie: 0.55 },
  },
];

// Slip-angle curve, peak 1 near 0.2 rad.
function lateralCurve(alpha) {
  return Math.sin(1.55 * Math.atan(8.5 * Math.abs(alpha)));
}

export class Bike {
  constructor(world, spec = BIKES[0]) {
    this.world = world;
    this.pos = V();
    this.vel = V();
    this.quat = new THREE.Quaternion();
    this.angVel = V();
    this.prevPos = V();
    this.prevQuat = new THREE.Quaternion();
    this.impacts = [];         // hits, scrapes, cactus breaks and crashes, drained by the game
    this.stepDt = 1 / 120;
    this.acc = 0;
    this.alpha = 1;

    this._force = V();
    this._torque = V();
    this._qInv = new THREE.Quaternion();
    this._qd = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._tmp = { a: V(), b: V(), c: V(), d: V(), e: V(), f: V(), g: V(), h: V(), i: V() };
    this._axes = { right: V(), up: V(), fwd: V() };

    this.riderBody = { pos: V(), vel: V(), quat: new THREE.Quaternion(), angVel: V(), prevPos: V(), prevQuat: new THREE.Quaternion() };
    this.setSpec(spec);
  }

  // Also used by the garage to swap bikes.
  setSpec(spec) {
    const S = (this.spec = spec);
    this.invInertia = new THREE.Vector3(1 / S.inertia.x, 1 / S.inertia.y, 1 / S.inertia.z);
    const c = S.cgHeight - S.radius;               // centre of mass above the axles
    const a = S.wheelbase - S.cgBack;              // centre of mass behind the front axle
    this.axleDrop = c;
    // Balance point: the angle where the centre of mass sits right over the rear axle.
    this.balanceAngle = Math.atan2(S.cgBack, c);
    this.pivotArm = Math.hypot(S.cgBack, c);
    const shareF = S.cgBack / S.wheelbase;
    this.wheels = [
      { front: true, z: -a, travel: S.travelF, share: shareF },
      { front: false, z: S.cgBack, travel: S.travelR, share: 1 - shareF },
    ].map((w) => {
      const load = S.mass * GRAVITY * w.share;
      const sag = w.travel * 0.3;
      const spring = load / sag;
      const crit = 2 * Math.sqrt(spring * S.mass * w.share);
      return {
        ...w,
        spring, bump: crit * 0.32, rebound: crit * 0.55,
        // Top of the travel: the wheel centre sits `travel - sag` below it at rest.
        mount: new THREE.Vector3(0, -c + (w.travel - sag), w.z),
        rest: new THREE.Vector3(0, -c, w.z),
        center: new THREE.Vector3(0, -c, w.z),     // current wheel centre in body space (for the model)
        centerW: V(),
        comp: sag, prevComp: sag, compVel: 0, sag,
        contact: false, point: V(), normal: new THREE.Vector3(0, 1, 0),
        surface: null, surfBuf: {}, load: 0, steer: 0, spin: 0, omega: 0,
        slipLong: 0, slipLat: 0, airTime: 0,
      };
    });
    this._buildContactPoints();
    this.reset(this.pos, this.heading || 0);
  }

  _buildContactPoints() {
    const S = this.spec;
    const c = this.axleDrop, R = S.radius;
    const zf = this.wheels[0].z, zr = this.wheels[1].z;
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const h = S.cgHeight;
    // While riding: things that can scrape the ground without hurting anyone.
    this.scrapePoints = [P(0, 0.27 - h, -0.05), P(-0.2, 0.33 - h, 0.14), P(0.2, 0.33 - h, 0.14)];
    // ...and the ones that mean you've crashed: rider's head and back, the tail
    // and the front number plate.
    this.crashPoints = [P(0, 0.9, -0.12), P(0, 0.6, 0.2), P(0, 0.72 - h + 0.06, zr + 0.34), P(0, 0.95 - h, zf - 0.16)];
    // After a crash, the whole bike: rims, bars, pegs, seat and fenders.
    const pts = [];
    for (const z of [zf, zr]) {
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * Math.PI * 2;
        pts.push(P(0, -c + Math.cos(t) * R, z + Math.sin(t) * R));
      }
      pts.push(P(-0.09, -c, z), P(0.09, -c, z));
    }
    pts.push(P(-0.38, 0.24, zf + 0.36), P(0.38, 0.24, zf + 0.36), P(-0.21, 0.33 - h, 0.14), P(0.21, 0.33 - h, 0.14));
    pts.push(P(0, 0.02, 0.25), P(-0.12, -0.1, -0.05), P(0.12, -0.1, -0.05), P(0, 0.72 - h, zr + 0.34), P(0, 0.9 - h, zf - 0.2), P(0, 0.27 - h, -0.05));
    this.tumblePoints = pts;
    // Obstacle spheres: both wheels, the frame and the rider.
    this.spheres = [
      Object.assign(P(0, -c, zf), { r: R + 0.02, rider: false }),
      Object.assign(P(0, -c, zr), { r: R + 0.02, rider: false }),
      Object.assign(P(0, -0.12, -0.02), { r: 0.42, rider: false }),
      Object.assign(P(0, 0.55, 0.04), { r: 0.34, rider: true }),
    ];
  }

  reset(position, heading) {
    this.pos.copy(position);
    this.quat.setFromAxisAngle(WORLD_UP, heading);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.throttle = this.brake = this.steerInput = this.leanInput = 0;
    this.throttleInput = 0;
    this.boost = false;
    this.lean = 0;
    this.airTime = 0;
    this.lastAirTime = 0;
    this.landAssist = 0;
    this.groundedWheels = 2;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.power = 0;
    this.motorOmega = 0;
    this.landing = 0;
    this.popTimer = 0;
    this.leanBlocked = false;
    this.airSteerHold = 0;
    this.trick = 0;             // index into TRICKS, 0 when not doing one
    this.trickExt = 0;          // 0 on the bike .. 1 fully stretched out
    this.trickHeld = 0;         // seconds held at full stretch
    this.trickCount ??= 0;      // tricks started so far (tells repeats apart; never goes back)
    this.trickInput = 0;
    this.trickBlocked = false;
    this.yawI = 0;
    this.slideAngle = 0;
    this.reverseHold = 0;
    this.reversing = false;
    this.inWater = 0;
    this.crashed = false;
    this.crashTime = 0;
    this.pitch = 0;
    this.wheelieAngle = 0;
    this.inWheelie = false;
    this.acc = 0;
    for (const w of this.wheels || []) {
      w.comp = w.prevComp = w.sag;
      w.compVel = 0;
      w.omega = 0;
      w.steer = 0;
      w.center.copy(w.rest);
      // Contact (and what the tyre sits on) is only known after the first physics
      // step; until then nothing should try to draw dust or tracks for it.
      w.contact = false;
      w.airTime = 0;
    }
  }

  // Rest the bike on the ground at (x, z), facing `heading` (radians, 0 = -z).
  placeOnGround(x, z, heading) {
    const h = this.world.heightAt(x, z);
    this.reset(new THREE.Vector3(x, h + this.spec.cgHeight + 0.03, z), heading);
  }

  axes() {
    const A = this._axes;
    A.right.set(1, 0, 0).applyQuaternion(this.quat);
    A.up.set(0, 1, 0).applyQuaternion(this.quat);
    A.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    return A;
  }

  // Heading on the ground plane (0 = -z, positive = turned left).
  get heading() {
    if (!this._tmp) return 0;
    const r = this._tmp.h.set(1, 0, 0).applyQuaternion(this.quat);
    return Math.atan2(-r.z, r.x);
  }

  get upsideDown() {
    return this._tmp.h.set(0, 1, 0).applyQuaternion(this.quat).y < 0.2;
  }

  // Driver inputs: throttle, brake 0..1, steer -1..1 (right positive), lean (wheelie) 0..1, boost.
  update(dt, input) {
    const k = (rate) => 1 - Math.exp(-dt * rate);
    this.throttleInput = input.throttle;
    this.throttle += (input.throttle - this.throttle) * k(input.throttle > this.throttle ? 7 : 12);
    this.brake += (input.brake - this.brake) * k(10);
    this.steerInput += (input.steer - this.steerInput) * k(Math.abs(input.steer) > Math.abs(this.steerInput) ? 9 : 12);
    this.leanInput = input.lean ? 1 : 0;
    this.trickInput = input.trick || 0;
    this.boost = !!input.boost;
    this.holding = !!input.hold;        // held on the brakes (start line, garage): don't walk backwards

    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= this.stepDt && steps < 12) {
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      const RB = this.riderBody;
      RB.prevPos.copy(RB.pos);
      RB.prevQuat.copy(RB.quat);
      if (this.crashed) this._tumble(this.stepDt);
      else this._step(this.stepDt);
      this.acc -= this.stepDt;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    this.alpha = this.acc / this.stepDt;
    this.landing = Math.max(0, this.landing - dt * 2);
    if (this.crashed) this.crashTime += dt;
  }

  renderTransform(outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.pos, this.alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.quat, this.alpha);
  }

  riderTransform(outPos, outQuat) {
    const R = this.riderBody;
    outPos.lerpVectors(R.prevPos, R.pos, this.alpha);
    outQuat.slerpQuaternions(R.prevQuat, R.quat, this.alpha);
  }

  _addForceAt(F, P) {
    this._force.add(F);
    const r = this._tmp.i.subVectors(P, this.pos);
    this._torque.add(r.cross(F));
  }

  _invInertiaWorld(v, out) {
    return out.copy(v).applyQuaternion(this._qInv).multiply(this.invInertia).applyQuaternion(this.quat);
  }

  // Pitch angle over the full circle: 0 level, +PI/2 nose straight up, +-PI upside down.
  _fullPitch(right, fwd) {
    const hf = this._tmp.h.crossVectors(WORLD_UP, right);
    return Math.atan2(fwd.y, fwd.dot(hf));
  }

  _step(dt) {
    const S = this.spec;
    const W = this.world;
    const T = this._tmp;
    const { right, up, fwd } = this.axes();
    this._qInv.copy(this.quat).invert();
    this._force.set(0, -GRAVITY * S.mass, 0);
    this._torque.set(0, 0, 0);

    const vFwd = this.vel.dot(fwd);
    this.forwardSpeed = vFwd;
    this.speed = this.vel.length();
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const pitch = this._fullPitch(right, fwd);
    this.pitch = pitch;
    const pitchRate = this.angVel.dot(right);
    const yawRate = this.angVel.dot(WORLD_UP);

    let throttle = this.throttle;
    let brake = this.brake;

    // Brake held at a standstill: after a moment, walk the bike backwards.
    if (!this.reversing) {
      if (brake > 0.5 && vFwd < 0.4 && this.throttleInput < 0.1 && !this.holding) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.35) this.reversing = true;
      } else this.reverseHold = 0;
    } else if (brake < 0.5 || this.throttleInput > 0.1) {
      this.reversing = false;
      this.reverseHold = 0;
    }

    this.sliding = brake > 0.55 && Math.abs(this.steerInput) > 0.3 && Math.abs(vFwd) > 6;

    // ---- Steering: full lock turns as quickly as the tyres can hold (a bit
    // under the limit, so there's grip left for the gas and brakes): lots of
    // lock when slow, just a touch at speed.
    const muHere = S.grip * (this.wheels[0].surface?.mu ?? 0.9);
    const rtMax = (0.9 * CORNER_GRIP * muHere * GRAVITY) / Math.max(hs, 3);
    const maxSteer = Math.min(0.55, Math.atan((S.wheelbase * rtMax) / Math.max(Math.abs(vFwd), 1)));
    const steerTarget = -this.steerInput * maxSteer;

    // ---- Motor: full force from standstill, then limited by power and top speed.
    const top = S.topSpeed * (this.boost ? 1.1 : 1);
    let drive = 0;
    if (this.reversing) {
      drive = -clamp((2 + vFwd) * 250, 0, 320);
      brake = 0;
    } else if (throttle > 0.01) {
      const v = vFwd > 0 ? this.speed : 0;          // road speed, even with the nose in the air
      const f = Math.min(S.force * (this.boost ? 1.15 : 1), (S.power * (this.boost ? 1.45 : 1)) / Math.max(v, 0.5));
      drive = f * throttle * clamp((top - v) / 2.5, 0, 1);
    } else if (vFwd > 1) {
      drive = -S.regen * clamp(vFwd / 6, 0, 1);      // regenerative braking off the throttle
    }

    // ---- Wheels: where they touch, and how hard.
    let grounded = 0;
    for (const w of this.wheels) {
      w.steer = w.front ? w.steer + (steerTarget - w.steer) * (1 - Math.exp(-dt * 14)) : 0;
      const mountW = T.a.copy(w.mount).applyQuaternion(this.quat).add(this.pos);
      const droop = T.b.copy(mountW).addScaledVector(up, -w.travel);
      const gh = W.heightAt(droop.x, droop.z);
      W.normalAt(droop.x, droop.z, w.normal);
      const n = w.normal;
      const dist = (droop.y - gh) * n.y;
      const upn = up.dot(n);
      w.prevComp = w.comp;
      const comp = upn > 0.2 ? (S.radius - dist) / upn : -1;
      if (comp > 0) {
        w.comp = Math.min(comp, w.travel + 0.12);
        w.contact = true;
        grounded++;
        w.centerW.copy(droop).addScaledVector(up, w.comp);
        w.point.copy(w.centerW).addScaledVector(n, -S.radius);
      } else {
        w.comp = Math.max(0, w.comp - dt * 4);           // shown extending, not snapping
        w.contact = false;
        w.centerW.copy(droop);
      }
      w.compVel = (w.comp - w.prevComp) / dt;
      w.center.copy(w.mount).addScaledVector(WORLD_UP, -(w.travel - Math.min(w.comp, w.travel + 0.05)));
      if (w.contact) w.surface = W.surfaceAt(w.point.x, w.point.z, w.point.y, w.surfBuf);
    }
    const wasAir = this.groundedWheels === 0;
    this.groundedWheels = grounded;
    const [front, rear] = this.wheels;

    // A landing that doesn't end well: still mid-trick, or at a bad angle.
    if (wasAir && grounded > 0) {
      if (this.trickExt > TRICK_BAIL) { this._crash('bail'); return; }
      if (this.airTime > 0.25 && this._badLanding(right, up, fwd, pitch)) return;
    }

    // ---- Suspension and tyres.
    let power = 0;
    this.drivePitch = 0;
    // Front wheel alone on the ground (landing nose-first): a real front wheel
    // steers itself back in line (trail), so it barely pushes sideways.
    const frontOnly = grounded === 1 && front.contact;
    for (const w of this.wheels) {
      if (!w.contact) {
        if (brake > 0.1) w.omega *= Math.exp(-dt * 10);
        else if (!w.front && throttle > 0.05) w.omega += (95 * throttle - w.omega) * (1 - Math.exp(-dt * 2.5));
        else w.omega *= Math.exp(-dt * 0.35);
        w.spin += w.omega * dt;
        w.load = 0;
        w.slipLong = 0;
        w.slipLat = 0;
        w.airTime += dt;
        continue;
      }
      let F = w.spring * w.comp + (w.compVel > 0 ? w.bump : w.rebound) * w.compVel;
      if (w.comp > w.travel) F += 150000 * (w.comp - w.travel) + 4000 * Math.max(0, w.compVel);
      F = clamp(F, 0, 60000);
      const n = w.normal;
      const N = F / Math.max(up.dot(n), 0.3);
      w.load = N;
      if (w.airTime > 0.3 && w.compVel > 2) this.landing = Math.max(this.landing, Math.min(1, w.compVel / 8));
      w.airTime = 0;
      this._addForceAt(T.c.copy(n).multiplyScalar(N), w.point);

      // Tyre frame on the ground.
      const wf = T.d.copy(fwd);
      if (w.steer) wf.applyAxisAngle(up, w.steer);
      wf.addScaledVector(n, -wf.dot(n));
      const wfl = wf.length();
      if (wfl < 0.2) continue;          // standing on its tail: no rolling direction
      wf.multiplyScalar(1 / wfl);
      const ws = T.e.crossVectors(wf, n).normalize();
      const rel = T.f.subVectors(w.point, this.pos);
      const vc = T.g.crossVectors(this.angVel, rel).add(this.vel);
      const vLong = vc.dot(wf), vLat = vc.dot(ws);
      const surf = w.surface;
      const Fmax = S.grip * surf.mu * N;
      const FmaxY = Fmax * CORNER_GRIP;
      const mEff = S.mass * 0.5;
      const stopLong = (Math.abs(vLong) * mEff) / dt;

      let Fx = w.front ? 0 : drive;
      // Brakes stop short of locking (like ABS), except the rear when you brake
      // hard while steering at speed: then it locks and the back steps out.
      const rearSlide = !w.front && this.sliding;
      const brakeAmt = rearSlide ? brake * S.brakeR : Math.min(brake * (w.front ? S.brakeF : S.brakeR), Fmax * (w.front ? 0.95 : 0.8));
      if (brakeAmt > 0) Fx -= Math.sign(vLong) * Math.min(brakeAmt, stopLong);
      Fx -= Math.sign(vLong) * Math.min(surf.roll * N, stopLong);

      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.5));
      let Fy = -Math.sign(vLat) * Math.min(FmaxY * lateralCurve(alpha), (Math.abs(vLat) * mEff) / dt);
      if (rearSlide) Fy *= 0.5;
      if (w.front && frontOnly) Fy *= 0.25;

      // Friction ellipse, lateral grip first.
      let spinning = 0;
      const ux = Fx / Fmax, uy = Fy / FmaxY;
      if (ux * ux + uy * uy > 1) {
        const fxRoom = Fmax * Math.sqrt(Math.max(0, 1 - Math.min(1, uy * uy)));
        const fxLimited = Math.max(fxRoom, Math.abs(Fx) * 0.35);
        spinning = clamp((Math.abs(Fx) - fxLimited) / (Fmax + 1), 0, 1);
        Fx = Math.sign(Fx) * Math.min(Math.abs(Fx), fxLimited);
        const e = Math.hypot(Fx / Fmax, Fy / FmaxY);
        if (e > 1) { Fx /= e; Fy /= e; }
      }
      // Drive and brake forces act partway up toward the centre of mass: the
      // bike squats and dives, but only the rider pulls the front up (and the
      // brakes can't stand it on its nose).
      const lift = Fx < 0 ? 0.62 : this.inWheelie ? 0.58 : 0.45;
      const app = T.a.copy(w.point).addScaledVector(up, S.cgHeight * lift);
      this._addForceAt(T.c.copy(wf).multiplyScalar(Fx).addScaledVector(ws, Fy), app);
      if (!w.front) {
        power = Math.max(0, drive) * Math.max(0, vLong);
        // How hard the motor is pulling the nose up (the rider can lean against it).
        const Fd = T.d.copy(wf).multiplyScalar(Math.max(0, Math.min(Fx, drive)));
        this.drivePitch = T.e.subVectors(app, this.pos).cross(Fd).dot(right);
      }

      const locked = rearSlide || (brake > 0.6 && Math.abs(vLong) > 3 && brakeAmt > Fmax);
      w.omega = locked ? w.omega * 0.8 : vLong / S.radius + (w.front ? 0 : Math.sign(drive || 1) * spinning * 50);
      w.spin += w.omega * dt;
      w.slipLong = Math.max(spinning, locked ? clamp(Math.abs(vLong) / 8, 0, 1) : 0);
      w.slipLat = Math.abs(vLat) + (rearSlide ? 2 : 0);
    }
    this.power = power / S.power;
    this.motorOmega = rear.omega;

    // The rider steers the bike where it's pointed: yaw follows the bars (never
    // faster than the tyres can hold), and if the bike ends up pointing a
    // different way from where it's going, the rider steers it back in line.
    // That keeps it from swapping ends when you brake or let off mid-turn.
    // Deliberate slides (brake hard while steering) get a lot more rope, but
    // are caught before the bike goes fully sideways.
    this.slideAngle = 0;
    if (grounded === 2 || frontOnly) {
      const rtSteer = clamp((vFwd * Math.tan(front.steer)) / S.wheelbase, -rtMax, rtMax);
      const slide = hs > 3 && vFwd > 0 ? angDiff(Math.atan2(-this.vel.x, -this.vel.z), this.heading) : 0;
      this.slideAngle = slide;
      const allow = this.sliding ? 0.7 : 0.1;
      const excess = Math.sign(slide) * Math.max(0, Math.abs(slide) - allow);
      const rt = rtSteer + excess * (this.sliding ? 6 : 4);
      const loose = this.sliding && Math.abs(slide) < allow;
      // Proportional plus a little integral, so weight shifts (the rear squats
      // under power) don't leave it turning wider than the bars say.
      const err = rt - yawRate;
      this.yawI = loose ? 0 : clamp(this.yawI + err * dt, -0.15, 0.15);
      const cmd = loose ? err * 2 : err * 40 + this.yawI * 250;
      this._torque.addScaledVector(WORLD_UP, clamp(cmd, -80, 80) * S.inertia.y);
    } else this.yawI = 0;

    // ---- Air resistance and water.
    const sp = this.speed;
    if (sp > 0.1) this._force.addScaledVector(this.vel, -0.5 * 1.2 * S.dragArea * sp);
    const wl = W.waterLevelAt?.(this.pos.x, this.pos.z);
    if (wl !== undefined && wl !== null) {
      const depth = wl - (this.pos.y - S.cgHeight + 0.15);
      this.inWater = Math.max(0, depth);
      if (depth > 0) this._force.addScaledVector(this.vel, -Math.min(depth, 1) * 260);
    } else this.inWater = 0;

    // ---- The rider: wheelies, balance and air control.
    const I = S.inertia;
    this.inWheelie = false;
    if (grounded === 0) {
      if (this.airTime === 0) this.leanBlocked = this.leanInput > 0.5;   // still holding a wheelie from the ground
      if (this.leanInput < 0.5) this.leanBlocked = false;
      this.airTime += dt;
      this.popTimer = 0;
      // Left alone, the rider levels the bike to its flight path and lines it up
      // with the direction of travel, finishing any half-done flip or spin. Gas
      // and brake tip the landing angle up or down; leaning back (the wheelie
      // button) throws a backflip; steering turns it, all the way round for a 360.
      const flip = this.leanInput > 0.5 && !this.leanBlocked;
      let ap;
      if (flip) ap = clamp((6.5 - pitchRate) * 9, -14, 14);
      else if (hs > 4) {
        const target = clamp(Math.atan2(this.vel.y, hs) * 0.45, -0.4, 0.25) + (this.throttle - this.brake) * 0.22;
        ap = clamp(angDiff(target, pitch) * 7 - pitchRate * 5, -22, 22);
      } else ap = -pitchRate * 0.8;
      // Steering in the air: a gentle turn to line up, which winds up into a
      // fast spin if you keep holding it (long enough that lining up for the
      // landing doesn't set one off by accident).
      if (Math.abs(this.steerInput) > 0.5) this.airSteerHold += dt;
      else this.airSteerHold = 0;
      let ay;
      if (Math.abs(this.steerInput) > 0.05) {
        const rate = -Math.sign(this.steerInput) * (1.6 + 6 * clamp((this.airSteerHold - 0.35) / 0.3, 0, 1)) * Math.min(1, Math.abs(this.steerInput) * 1.5);
        ay = clamp((rate - yawRate) * 9, -16, 16);
      } else if (hs > 4) ay = clamp(angDiff(Math.atan2(-this.vel.x, -this.vel.z), this.heading) * 7 - yawRate * 5, -24, 24);
      else ay = -yawRate * 1.5;
      this._torque.addScaledVector(right, ap * I.x).addScaledVector(WORLD_UP, ay * I.y);
    } else {
      if (wasAir && this.airTime > 0.25) {
        this.lastAirTime = this.airTime;
        this.landAssist = 0.35;
      }
      this.airTime = 0;
      this._rider(dt, front, rear, pitch, pitchRate, yawRate, right, vFwd);
    }
    this._trick(dt, grounded === 0);
    if (this.landAssist > 0) {
      this.landAssist -= dt;
      const pr = this.angVel.dot(right);
      this.angVel.addScaledVector(right, pr * (Math.exp(-dt * 6) - 1));
    }

    // ---- Ground scrapes, and crashes.
    if (this._bodyGround(dt, up)) return;

    // ---- Integrate.
    this.vel.addScaledVector(this._force, dt / S.mass);
    this.angVel.add(this._invInertiaWorld(this._torque, T.b).multiplyScalar(dt));
    this.angVel.multiplyScalar(Math.exp(-dt * (grounded ? 0.3 : 0.05)));
    if (grounded === 2) {
      // A little extra yaw damping keeps it calm at speed.
      const yr = this.angVel.dot(WORLD_UP);
      this.angVel.addScaledVector(WORLD_UP, -yr * (1 - Math.exp(-dt * 0.8 * clamp(sp / 25, 0, 1))));
    }
    // The rider holds it upright: no roll about the horizontal forward axis.
    const hf = T.c.crossVectors(WORLD_UP, right).normalize();
    this.angVel.addScaledVector(hf, -this.angVel.dot(hf));
    this.pos.addScaledVector(this.vel, dt);
    this._integrateQuat(this.quat, this.angVel, dt);
    this._levelRoll();

    this._obstacles();

    // Loop-outs and endos.
    if (rear.contact && !front.contact && pitch > this.balanceAngle + 0.5) { this._crash('loop'); return; }
    if (front.contact && !rear.contact && pitch < -1.0) { this._crash('endo'); return; }
    // Sliding out sideways.
    if (grounded && hs > 8) {
      const slip = Math.abs(angDiff(Math.atan2(-this.vel.x, -this.vel.z), this.heading));
      if (slip > 1.4 && slip < Math.PI - 0.6) { this._crash('lowside'); return; }
    }

    // What the model should show: lean into the turn from speed and turn rate.
    let targetLean = grounded ? Math.atan((hs * yawRate) / GRAVITY) : 0;
    targetLean = clamp(targetLean, -0.9, 0.9) * (this.inWheelie ? 0.5 : 1);
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt * 7));
    this.wheelieAngle = pitch;
  }

  // Freestyle tricks: only in the air, one at a time, and only with time to
  // finish it (not off every little bump). Holding the button keeps it out.
  _trick(dt, air) {
    const want = this.trickInput;
    if (this.trick) {
      const out = air && want === this.trick;
      this.trickExt = out ? Math.min(1, this.trickExt + dt * TRICK_OUT) : Math.max(0, this.trickExt - dt * TRICK_IN);
      if (this.trickExt > 0.9) this.trickHeld += dt;
      if (this.trickExt === 0) this.trick = 0;
    } else if (air && want && this.airTime > 0.1 && !this.trickBlocked) {
      if (this.airLeft() > 0.45) {
        this.trick = want;
        this.trickExt = 0;
        this.trickHeld = 0;
        this.trickCount++;
      } else this.trickBlocked = true;     // too late for this one: let go and try the next jump
    }
    if (!want || !air) this.trickBlocked = false;
  }

  // Seconds until the wheels come back down, flying ballistic from here (erring
  // on the early side: the wheels hang down on their suspension, and whichever
  // end is over higher ground touches first).
  airLeft(maxT = 3) {
    const p = this.pos, v = this.vel;
    const clear = this.spec.cgHeight + 0.12;
    const h = Math.hypot(v.x, v.z) || 1;
    const ax = (v.x / h) * this.spec.wheelbase * 0.5, az = (v.z / h) * this.spec.wheelbase * 0.5;
    const W = this.world;
    for (let t = 0.025; t <= maxT; t += 0.025) {
      const y = p.y + v.y * t - 0.5 * GRAVITY * t * t - clear;
      const x = p.x + v.x * t, z = p.z + v.z * t;
      if (y < Math.max(W.heightAt(x, z), W.heightAt(x + ax, z + az), W.heightAt(x - ax, z - az))) return t;
    }
    return maxT;
  }

  // The rider's pitch control on the ground: popping and holding wheelies.
  _rider(dt, front, rear, pitch, pitchRate, yawRate, right, vFwd) {
    const S = this.spec;
    const I = S.inertia;
    const Ic = I.x + S.mass * this.pivotArm * this.pivotArm;   // about the rear axle
    const g = S.mass * GRAVITY * this.pivotArm;
    const lean = this.leanInput > 0.5;
    const frontUp = !front.contact && rear.contact;
    // Ground angle under the bike, to tell a wheelie from riding over a crest.
    const groundPitch = Math.atan2(this.world.heightAt(front.centerW.x, front.centerW.z) - this.world.heightAt(rear.centerW.x, rear.centerW.z), this.spec.wheelbase);
    const rel = pitch - groundPitch;
    let tau = 0;
    if (lean && rear.contact && (Math.abs(vFwd) > 1.5 || this.throttle > 0.3)) {
      // Target a comfortable angle below the balance point; gas pushes it higher
      // (through the drive force), the rear brake brings it down.
      const target = this.balanceAngle - 0.26 - this.brake * 0.35 - this.throttle * 0.1;
      if (!frontUp) this.popTimer += dt;
      const popping = !frontUp && this.popTimer < 0.6;
      if (frontUp || popping) {
        const ff = S.wheelieAssist * g * Math.sin(this.balanceAngle - pitch);
        const pd = Ic * (14 * (target - pitch) - 3.2 * pitchRate);
        tau = ff + clamp(pd, -S.wheelieMax, S.wheelieMax);
      }
      if (frontUp && rel > 0.1) {
        this.inWheelie = true;
        // Steering on one wheel: the rider leans the bike round.
        const rt = -this.steerInput * clamp(7 / (Math.abs(vFwd) + 4), 0.2, 1.1);
        this._torque.addScaledVector(WORLD_UP, clamp((rt - yawRate) * 6, -8, 8) * I.y);
      }
    } else {
      if (!lean) this.popTimer = 0;
      if (frontUp && rel > 0.05) {
        // Let go: the rider leans forward and sets the front down gently, even
        // with the throttle still pinned.
        tau = 0.45 * S.wheelieAssist * g * Math.sin(this.balanceAngle - pitch) - S.mass * GRAVITY * 0.08 - Ic * 1.6 * pitchRate
          - Math.max(0, this.drivePitch) * 1.1;
        this.inWheelie = rel > 0.14;
      }
    }
    this._torque.addScaledVector(right, tau);
  }

  // Landed upside down, sideways or too far off the ground's angle?
  _badLanding(right, up, fwd, pitch) {
    const S = this.spec;
    const [front, rear] = this.wheels;
    const p = front.contact ? front : rear;
    const n = p.normal;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (up.dot(n) < 0.3) return this._crash('landing');
    const groundPitch = Math.atan2(this.world.heightAt(front.centerW.x, front.centerW.z) - this.world.heightAt(rear.centerW.x, rear.centerW.z), S.wheelbase);
    const rel = pitch - groundPitch;
    if (rel > 1.0 || rel < -0.75) return this._crash('landing');
    if (hs > 6) {
      const slip = Math.abs(angDiff(Math.atan2(-this.vel.x, -this.vel.z), this.heading));
      if (slip > 1.0 && slip < Math.PI - 0.5) return this._crash('landing');
    }
    return false;
  }

  // Frame and pegs scraping; head, back, tail or number plate touching down is a crash.
  _bodyGround(dt, up) {
    const W = this.world;
    const T = this._tmp;
    for (const pt of this.crashPoints) {
      const p = T.a.copy(pt).applyQuaternion(this.quat).add(this.pos);
      if (p.y < W.heightAt(p.x, p.z)) { this._crash('fall'); return true; }
    }
    for (const pt of this.scrapePoints) {
      const p = T.a.copy(pt).applyQuaternion(this.quat).add(this.pos);
      const h = W.heightAt(p.x, p.z);
      if (p.y >= h) continue;
      const n = W.normalAt(p.x, p.z, T.b);
      const depth = (h - p.y) * n.y;
      const rel = T.c.subVectors(p, this.pos);
      const vp = T.d.crossVectors(this.angVel, rel).add(this.vel);
      const vn = vp.dot(n);
      const Fn = clamp(90000 * depth - 2500 * Math.min(vn, 0), 0, 200000);
      const F = T.e.copy(n).multiplyScalar(Fn);
      const vt = T.f.copy(vp).addScaledVector(n, -vn);
      const vtl = vt.length();
      if (vtl > 0.01) F.addScaledVector(vt, -Math.min(0.5 * Fn, (vtl * this.spec.mass * 0.2) / dt) / vtl);
      this._addForceAt(F, p);
      if (-vn > 2.5) this.impacts.push({ type: 'scrape', strength: Math.min(1, -vn / 10), point: p.clone() });
    }
    void up;
    return false;
  }

  _obstacles() {
    const W = this.world;
    if (!W.queryObstacles) return;
    const T = this._tmp;
    const S = this.spec;
    W.queryObstacles(this.pos.x, this.pos.z, 3, (ob) => {
      for (const s of this.spheres) {
        const c = T.a.copy(s).applyQuaternion(this.quat).add(this.pos);
        let n, depth;
        if (ob.kind === 'sphere') {
          const d = T.b.subVectors(c, ob.center);
          const dist = d.length();
          depth = ob.radius + s.r - dist;
          if (depth <= 0) continue;
          n = d.multiplyScalar(1 / (dist || 1));
        } else {
          if (c.y - s.r > ob.base + ob.height || c.y + s.r < ob.base) continue;
          const dx = c.x - ob.x, dz = c.z - ob.z;
          const dist = Math.hypot(dx, dz);
          depth = ob.radius + s.r - dist;
          if (depth <= 0) continue;
          n = T.b.set(dx / (dist || 1), 0, dz / (dist || 1));
        }
        const rel = T.c.subVectors(c, this.pos).addScaledVector(n, -s.r);
        const vp = T.d.crossVectors(this.angVel, rel).add(this.vel);
        const vn = vp.dot(n);
        if (ob.breakable && (Math.abs(vn) > 2 || this.speed > 3)) {
          ob.broken = true;
          this.impacts.push({ type: 'break', target: ob, strength: Math.min(1, this.speed / 20), point: c.clone(), velocity: this.vel.clone() });
          this.vel.multiplyScalar(0.9);
          return true;
        }
        this.pos.addScaledVector(n, depth * 0.8);
        if (vn < 0) {
          if (-vn > (s.rider ? 6 : 9)) {
            this.impacts.push({ type: 'hit', strength: 1, point: c.clone() });
            this._crash('hit');
            return true;
          }
          const j = (-(1 + 0.1) * vn) * S.mass * 0.7;
          this.vel.addScaledVector(n, j / S.mass);
          const vt = T.g.copy(vp).addScaledVector(n, -vn);
          this.vel.addScaledVector(vt, -0.2);
          if (-vn > 1.5) this.impacts.push({ type: 'hit', strength: Math.min(1, -vn / 10), point: c.clone() });
        }
      }
      return false;
    });
  }

  _integrateQuat(q, w, dt) {
    const d = this._tmp.h.copy(w);
    const ang = d.length() * dt;
    if (ang > 1e-9) q.premultiply(this._qd.setFromAxisAngle(d.normalize(), ang)).normalize();
  }

  // Remove any roll the integration let in: keep the bike's right axis level.
  _levelRoll() {
    const T = this._tmp;
    const r = T.a.set(1, 0, 0).applyQuaternion(this.quat);
    const f = T.b.set(0, 0, -1).applyQuaternion(this.quat);
    r.y = 0;
    if (r.lengthSq() < 1e-6) return;
    r.normalize();
    f.addScaledVector(r, -f.dot(r)).normalize();
    const u = T.c.crossVectors(r, f);
    this._m.makeBasis(r, u, f.negate());
    this.quat.setFromRotationMatrix(this._m);
  }

  // ---- Crashing.

  _crash(reason) {
    if (this.crashed) return true;
    const T = this._tmp;
    const { right, up, fwd } = this.axes();
    // Hand the shown lean over to the physics, pivoting on the tyres' contact line.
    const lean = this.lean;
    if (Math.abs(lean) > 0.01) {
      const pivot = T.a.copy(this.pos).addScaledVector(up, -this.spec.cgHeight);
      const q = this._qd.setFromAxisAngle(fwd.clone().negate(), lean);
      this.pos.sub(pivot).applyQuaternion(q).add(pivot);
      this.quat.premultiply(q);
    }
    this.lean = 0;
    // Tip it over a bit more and let go.
    const side = Math.sign(lean || this.steerInput || 1);
    this.angVel.addScaledVector(fwd, -side * 1.5);
    this.crashed = true;
    this.crashTime = 0;
    this.crashReason = reason;
    this.inWheelie = false;
    this.power = 0;
    // The rider comes off: thrown forward and up, tumbling.
    const R = this.riderBody;
    R.pos.set(0, 0.3, 0.08).applyQuaternion(this.quat).add(this.pos);
    R.vel.copy(this.vel).addScaledVector(WORLD_UP, 1.6 + this.speed * 0.05).addScaledVector(fwd, reason === 'loop' ? -1.5 : 1.2);
    R.quat.copy(this.quat);
    R.angVel.copy(right).multiplyScalar(reason === 'loop' ? 4 : -5).addScaledVector(fwd, side * 2);
    R.prevPos.copy(R.pos);
    R.prevQuat.copy(R.quat);
    R.onGround = false;
    this.impacts.push({ type: 'crash', reason, strength: Math.min(1, 0.4 + this.speed / 25), point: this.pos.clone() });
    return true;
  }

  // Free tumbling after a crash: penalty contacts all round the bike, and the rider as a ball.
  _tumble(dt) {
    const S = this.spec;
    const W = this.world;
    const T = this._tmp;
    this._qInv.copy(this.quat).invert();
    this._force.set(0, -GRAVITY * S.mass, 0);
    this._torque.set(0, 0, 0);
    this.speed = this.vel.length();
    this.forwardSpeed = this.vel.dot(T.a.set(0, 0, -1).applyQuaternion(this.quat));
    let touching = 0;
    for (const pt of this.tumblePoints) {
      const p = T.a.copy(pt).applyQuaternion(this.quat).add(this.pos);
      const h = W.heightAt(p.x, p.z);
      if (p.y >= h) continue;
      touching++;
      const n = W.normalAt(p.x, p.z, T.b);
      const depth = (h - p.y) * n.y;
      const rel = T.c.subVectors(p, this.pos);
      const vp = T.d.crossVectors(this.angVel, rel).add(this.vel);
      const vn = vp.dot(n);
      const Fn = clamp(40000 * depth - 1400 * Math.min(vn, 0), 0, 60000);
      const F = T.e.copy(n).multiplyScalar(Fn);
      const vt = T.f.copy(vp).addScaledVector(n, -vn);
      const vtl = vt.length();
      if (vtl > 0.01) F.addScaledVector(vt, -Math.min(0.65 * Fn, (vtl * S.mass * 0.1) / dt) / vtl);
      this._addForceAt(F, p);
    }
    if (this.speed > 0.1) this._force.addScaledVector(this.vel, -0.5 * 1.2 * S.dragArea * this.speed);
    this.vel.addScaledVector(this._force, dt / S.mass);
    this.angVel.add(this._invInertiaWorld(this._torque, T.b).multiplyScalar(dt));
    this.angVel.multiplyScalar(Math.exp(-dt * (touching ? 1.2 : 0.1)));
    this.pos.addScaledVector(this.vel, dt);
    this._integrateQuat(this.quat, this.angVel, dt);
    this.groundedWheels = 0;
    for (const w of this.wheels) {
      w.contact = false;
      w.omega *= Math.exp(-dt * 0.8);
      w.spin += w.omega * dt;
      w.comp = Math.max(0, w.comp - dt * 2);
      w.center.copy(w.mount).addScaledVector(WORLD_UP, -(w.travel - w.comp));
    }
    this.lean *= Math.exp(-dt * 5);

    // Rider.
    const R = this.riderBody;
    R.vel.y -= GRAVITY * dt;
    R.pos.addScaledVector(R.vel, dt);
    const gh = W.heightAt(R.pos.x, R.pos.z) + 0.22;
    if (R.pos.y < gh) {
      const n = W.normalAt(R.pos.x, R.pos.z, T.a);
      R.pos.y = gh;
      const vn = R.vel.dot(n);
      if (vn < 0) R.vel.addScaledVector(n, -vn * 1.25);
      const k = Math.exp(-dt * 2.2);
      const vn2 = R.vel.dot(n);
      R.vel.sub(T.b.copy(n).multiplyScalar(vn2)).multiplyScalar(k).addScaledVector(n, vn2);
      R.angVel.multiplyScalar(Math.exp(-dt * 2.5));
      R.onGround = true;
    }
    this._integrateQuat(R.quat, R.angVel, dt);
  }
}
