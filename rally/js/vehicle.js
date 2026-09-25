// Vehicle dynamics. A rigid body on four ray-cast suspension struts with a
// combined-slip tyre model, a turbo engine, gearbox, limited-slip diffs,
// brakes with ABS, aerodynamics, and collisions against the ground, trees
// and rocks. Pure math: it runs the same in the browser and in Node tests.
import * as THREE from 'three';
import { SURF, WATER } from './gen.js';

const GRAVITY = 9.81;
const V_MIN = 2.5;            // slip denominators never go below this (m/s)

// Grip multiplier and rolling resistance for each surface.
export const SURFACES = {
  [SURF.GRAVEL]: { mu: 0.9, rr: 0.02 },
  [SURF.TARMAC]: { mu: 1.02, rr: 0.013 },
  [SURF.LOOSE]: { mu: 0.76, rr: 0.035 },
  [SURF.GRASS]: { mu: 0.64, rr: 0.05 },
  [SURF.DIRT]: { mu: 0.74, rr: 0.04 },
  [SURF.ROCK]: { mu: 0.86, rr: 0.02 },
  [SURF.SAND]: { mu: 0.58, rr: 0.12 },
  [SURF.WATER]: { mu: 0.55, rr: 0.09 },
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Vehicle {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.invMass = 1 / spec.mass;
    this.invI = new THREE.Vector3(1 / spec.inertia[0], 1 / spec.inertia[1], 1 / spec.inertia[2]);
    this.R = new THREE.Matrix4();
    this.L = new THREE.Vector3(); this.U = new THREE.Vector3(); this.F = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();

    const s = spec.suspension;
    const rearArm = spec.wheelbase - spec.frontAxle;
    this.cornerLoad = [
      spec.mass * GRAVITY * (rearArm / spec.wheelbase) / 2,
      spec.mass * GRAVITY * (spec.frontAxle / spec.wheelbase) / 2,
    ];
    const hx = spec.track / 2;
    this.wheels = [
      [hx, spec.frontAxle, 0], [-hx, spec.frontAxle, 0],
      [hx, spec.frontAxle - spec.wheelbase, 1], [-hx, spec.frontAxle - spec.wheelbase, 1],
    ].map(([x, z, axle], i) => {
      const k = s.stiffness[axle];
      const x0 = this.cornerLoad[axle] / k;                 // static compression
      const y = spec.wheelRadius - spec.cgHeight + (s.rest - x0);
      return {
        index: i, axle, left: x > 0, front: axle === 0,
        hp: new THREE.Vector3(x, y, z),
        k, bump: s.bump[axle], rebound: s.rebound[axle],
        driven: spec.drive === 'awd' || (spec.drive === 'rwd' ? axle === 1 : axle === 0),
        compression: x0, springLen: s.rest - x0, contact: false,
        omega: 0, spin: 0, steer: 0, load: 0, fz: 0,
        slipRatio: 0, slipAngle: 0, slide: 0, surface: SURF.GRAVEL, mu: 1,
        point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), center: new THREE.Vector3(),
        vLong: 0, vLat: 0, driveT: 0, brakeT: 0, suspF: 0, vComp: 0, water: 0,
      };
    });

    // Points on the body that touch the ground when the car bottoms out or rolls.
    const [bx, by, bz] = spec.body.half, [cx, cy, cz] = spec.body.centre;
    const floor = spec.wheelRadius - spec.cgHeight + 0.12;
    this.hull = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.hull.push(new THREE.Vector3(cx + sx * bx * 0.92, floor, cz + sz * bz * 0.95));
        this.hull.push(new THREE.Vector3(cx + sx * bx, cy + by * 0.1, cz + sz * bz));
        this.hull.push(new THREE.Vector3(cx + sx * bx * 0.72, cy + by, cz + sz * bz * 0.45));
      }
      this.hull.push(new THREE.Vector3(cx + sx * bx, cy, cz));
      this.hull.push(new THREE.Vector3(cx + sx * bx * 0.8, floor, cz));
    }
    this.bodyHalf = new THREE.Vector3(bx, by, bz);
    this.bodyCentre = new THREE.Vector3(cx, cy, cz);

    const B = Math.tan(Math.PI / (2 * spec.tire.shape));
    this.tireB = B;
    this.tireSlope = spec.tire.shape * B;                   // g'(0)
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, heading, groundY = null) {
    this.pos.copy(pos);
    const gy = groundY ?? this.world.heightAt(pos.x, pos.z);
    this.pos.y = gy + this.spec.cgHeight + 0.05;
    this.quat.setFromAxisAngle(_v1.set(0, 1, 0), heading);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.contact = false; }
    this.rpm = this.spec.engine.idle;
    this.gear = 1;
    this.targetGear = 1;
    this.shiftTimer = 0;
    this.boost = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.clutchSlip = false;
    this.limiter = false;
    this.airTime = 0;
    this.grounded = 4;
    this.events = [];         // gear shifts, backfires, landings, impacts for sound & effects
    this.stoppedTime = 0;
    this.damage = 0;
    this._updateBasis();
  }

  _updateBasis() {
    this.R.makeRotationFromQuaternion(this.quat);
    this.R.extractBasis(this.L, this.U, this.F);
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.dot(this.F); }

  // Ground under (x, z): height, normal, surface. Small rocks count as ground
  // so wheels can ride up over them.
  ground(x, z, out) {
    const w = this.world;
    out.h = w.heightAt(x, z);
    w.normalAt(x, z, out.n);
    out.surf = w.surfaceAt(x, z);
    out.rock = false;
    w.forObstacles(x, z, 2, (o) => {
      if (o.kind !== 'rock' || o.r > 1.3) return;
      const dx = x - o.x, dz = z - o.z, r2 = o.r * o.r - dx * dx - dz * dz;
      if (r2 <= 0) return;
      const top = o.y + Math.sqrt(r2);
      if (top > out.h) {
        out.h = top;
        out.n.set(dx, top - o.y, dz).normalize();
        out.surf = SURF.ROCK;
        out.rock = true;
      }
    });
    return out;
  }

  update(dt, input) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 480)));
    const h = dt / steps;
    this._controls(dt, input);
    for (let i = 0; i < steps; i++) this._step(h, input);
    for (const w of this.wheels) w.spin += w.omega * dt;
    // bookkeeping for effects
    this.airTime = this.grounded === 0 ? this.airTime + dt : 0;
    const sp = this.speed;
    this.stoppedTime = sp < 0.6 ? this.stoppedTime + dt : 0;
  }

  // Steering, gear selection and pedals: once per frame.
  _controls(dt, inp) {
    const S = this.spec;
    const fwd = this.forwardSpeed;
    // Steering: the wheels turn at a limited rate, and full lock shrinks with
    // speed so a keyboard tap doesn't throw the car off the road.
    const av = Math.max(Math.abs(fwd), 0.1);
    const speedLimit = THREE.MathUtils.clamp((inp.analog ? 11 : 6.5) / av, 0.17, 1);
    let target = inp.steer * S.steer.lock * speedLimit;
    // Stability assist: steer into slides a little so the car can be caught.
    if (inp.assist && Math.abs(fwd) > 5) {
      const vl = this.vel.dot(this.L), slip = Math.atan2(vl, Math.abs(fwd));
      target += THREE.MathUtils.clamp(slip * 0.6 * inp.assist, -0.35, 0.35) * Math.sign(fwd);
    }
    target = THREE.MathUtils.clamp(target, -S.steer.lock, S.steer.lock);
    const rate = S.steer.rate * (inp.analog ? 1.6 : 1) * dt;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -rate, rate);

    // Pedals. In reverse the brake pedal drives and the throttle brakes.
    let thr = inp.throttle, brk = inp.brake;
    if (this.gear < 0) [thr, brk] = [brk, thr];

    // Stability control: ease the throttle when the car is sliding too far.
    if (inp.assist && Math.abs(fwd) > 4) {
      const slip = Math.abs(Math.atan2(this.vel.dot(this.L), Math.abs(fwd)));
      if (slip > 0.35) thr *= THREE.MathUtils.clamp(1 - (slip - 0.35) * 2 * inp.assist, 0.25, 1);
    }

    // Automatic gearbox. Decisions use road speed, so wheelspin can't fool it.
    const E = S.engine;
    const ratioOf = (g) => S.gears[g - 1] * S.finalDrive;
    const roadRpm = (g) => (Math.abs(fwd) / S.wheelRadius) * ratioOf(g) * 60 / (2 * Math.PI);
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) this.gear = this.targetGear;
    } else if (inp.auto !== false) {
      if (this.gear >= 1) {
        const grounded = this.grounded >= 2;
        const now = Math.min(this.rpm, roadRpm(this.gear) * 1.1);
        if (now > S.shift.up && this.gear < S.gears.length && grounded && !this.clutchSlip) this._shift(this.gear + 1);
        else if (this.gear > 1) {
          const lower = roadRpm(this.gear - 1);
          const downAt = brk > 0.3 ? E.redline * 0.72 : S.shift.down;
          if (roadRpm(this.gear) < downAt && lower < E.redline * 0.9) this._shift(this.gear - 1);
        }
        if (!inp.hold && fwd < 0.8 && inp.brake > 0.4 && inp.throttle < 0.1 && this.stoppedTime > 0.25) this._shift(-1, 0.05);
      } else if (this.gear < 0 && inp.throttle > 0.4 && fwd > -0.8) {
        this._shift(1, 0.05);
      }
    }
    if (inp.shiftUp) this._shift(Math.min(this.gear + 1, S.gears.length) || 1);
    if (inp.shiftDown) this._shift(this.gear - 1 === 0 ? -1 : Math.max(this.gear - 1, -1));

    this.throttle = thr;
    this.brake = brk;
    this.handbrake = inp.handbrake || 0;
    this.assist = inp.assist || 0;

    // Turbo spools with throttle and revs; anti-lag keeps some boost off-throttle.
    if (E.turbo) {
      const want = thr * THREE.MathUtils.clamp((this.rpm - 1800) / 2200, 0, 1);
      this.boost += (want - this.boost) * Math.min(1, dt * (want > this.boost ? 2.4 : 1.1));
    }
  }

  _shift(g, time = this.spec.shift.time) {
    if (g === this.gear || g === 0) return;
    this.targetGear = g;
    this.shiftTimer = time;
    this.events.push({ type: 'shift', up: g > this.gear, gear: g });
    if (g > this.gear && this.throttle > 0.6 && this.rpm > this.spec.engine.redline * 0.7) this.events.push({ type: 'backfire', power: 0.7 });
  }

  _step(dt, inp) {
    const S = this.spec, E = S.engine;
    this._updateBasis();
    const { L, U, F } = this;
    const force = this.force.set(0, -GRAVITY * S.mass, 0);
    const torque = this.torque.set(0, 0, 0);
    const r = S.wheelRadius;
    const susp = S.suspension;
    const g = this._g || (this._g = { h: 0, n: new THREE.Vector3(), surf: 0, rock: false });

    // ---- Suspension: find where each wheel meets the ground ----
    let grounded = 0;
    for (const w of this.wheels) {
      const hp = _v1.copy(w.hp).applyMatrix4(this.R).add(this.pos);
      let len = susp.rest;
      const c = w.center.copy(hp).addScaledVector(U, -len);
      this.ground(c.x, c.z, g);
      let d = (c.y - g.h) * g.n.y;
      w.contact = false;
      w.water = Math.max(0, WATER - g.h);
      if (d < r) {
        const un = Math.max(0.35, U.dot(g.n));
        for (let it = 0; it < 2; it++) {
          len -= (r - d) / un;
          c.copy(hp).addScaledVector(U, -len);
          this.ground(c.x, c.z, g);
          d = (c.y - g.h) * g.n.y;
        }
        const comp = susp.rest - len;
        if (comp > 0) {
          w.contact = true;
          w.compression = comp;
          w.normal.copy(g.n);
          w.surface = g.surf;
          w.point.copy(c).addScaledVector(g.n, -r);
          // compression speed from how fast the hardpoint closes on the ground
          const rp = _v2.subVectors(hp, this.pos);
          const vhp = _v3.crossVectors(this.angVel, rp).add(this.vel);
          w.vComp = -vhp.dot(g.n) / un;
          grounded++;
        }
      }
      if (!w.contact) {
        w.compression = 0;
        w.vComp = 0;
      }
      w.springLen = susp.rest - Math.min(w.compression, susp.travel + 0.04);
      w.hpWorld = w.hpWorld || new THREE.Vector3();
      w.hpWorld.copy(hp);
    }
    this.grounded = grounded;

    // Spring, damper, bump stop and anti-roll bars.
    for (const w of this.wheels) {
      if (!w.contact) { w.suspF = 0; continue; }
      const over = Math.max(0, w.compression - susp.travel);
      let f = w.k * w.compression + over * w.k * 12 + (w.vComp > 0 ? w.bump : w.rebound) * w.vComp;
      const other = this.wheels[w.index ^ 1];
      f += susp.antiRoll[w.axle] * (w.compression - (other.contact ? other.compression : 0));
      w.suspF = Math.max(0, f);
      if (over > 0 && w.vComp > 2.5) this.events.push({ type: 'bottom', power: Math.min(1, w.vComp / 8) });
    }

    // ---- Drivetrain ----
    const driven = this.wheels.filter((w) => w.driven);
    const ratio = this.gear > 0 ? S.gears[this.gear - 1] * S.finalDrive : this.gear < 0 ? -S.reverse * S.finalDrive : 0;
    const engaged = this.shiftTimer <= 0 && ratio !== 0;
    this.engaged = engaged;
    let wAvg = 0;
    for (const w of driven) wAvg += w.omega;
    wAvg /= driven.length;
    const rpmWheel = wAvg * ratio * 60 / (2 * Math.PI);
    const thr = this.throttle;
    const lockRpm = E.idle * 1.6;
    this.clutchSlip = false;
    if (engaged && rpmWheel < lockRpm && (thr > 0.03 || rpmWheel < E.idle)) {
      // Pulling away: the clutch slips while the engine holds revs, and bites
      // fully once the wheels catch up.
      if (thr > 0.03) {
        const launch = THREE.MathUtils.lerp(E.idle * 1.3, E.redline * 0.5, thr);
        const want = THREE.MathUtils.lerp(launch, lockRpm, THREE.MathUtils.clamp(rpmWheel / lockRpm, 0, 1));
        this.rpm += (Math.max(want, rpmWheel) - this.rpm) * Math.min(1, dt * 8);
        this.clutchSlip = true;
      } else {
        this.rpm += (E.idle - this.rpm) * Math.min(1, dt * 5);
      }
    } else if (engaged) {
      this.rpm = rpmWheel;
    } else if (this.shiftTimer > 0 && this.targetGear > 0) {
      // mid-shift: the revs fall (or blip) to meet the next gear
      const next = S.gears[this.targetGear - 1] * S.finalDrive;
      const want = Math.max(E.idle, wAvg * next * 60 / (2 * Math.PI));
      this.rpm += (want - this.rpm) * Math.min(1, dt * 30);
    } else {
      const want = thr > 0.03 ? E.redline * (0.35 + 0.65 * thr) : E.idle;
      this.rpm += (want - this.rpm) * Math.min(1, dt * (want > this.rpm ? 9 : 5));
    }
    this.rpm = THREE.MathUtils.clamp(this.rpm, E.idle * 0.85, E.limiter + 100);
    const curve = E.curve;
    let cf = curve[curve.length - 1][1];
    for (let i = 1; i < curve.length; i++) {
      if (this.rpm <= curve[i][0]) {
        const [r0, v0] = curve[i - 1], [r1, v1] = curve[i];
        cf = v0 + (v1 - v0) * THREE.MathUtils.clamp((this.rpm - r0) / (r1 - r0), 0, 1);
        break;
      }
    }
    let tEngine = thr * E.torque * cf * (E.turbo ? 0.62 + 0.38 * this.boost : 1);
    if (thr < 0.05 && !this.clutchSlip) tEngine = -E.brake * E.torque * (0.25 + 0.75 * this.rpm / E.redline);
    if (this.rpm >= E.limiter) { tEngine = Math.min(tEngine, 0); this.limiter = true; }
    else if (this.rpm < E.limiter - 150) this.limiter = false;
    this.engineTorque = tEngine;
    let tDrive = engaged ? tEngine * ratio * 0.9 : 0;
    // AWD rally cars disconnect the rear axle when the handbrake is pulled.
    const rearCut = S.drive === 'awd' && this.handbrake > 0.3;
    const reflected = engaged && !this.clutchSlip ? (E.inertia * ratio * ratio) / driven.length : 0;
    for (const w of this.wheels) {
      w.driveT = 0;
      w.inertia = S.wheelInertia;
      if (!w.driven) continue;
      let share = S.drive === 'awd' ? (w.front ? S.frontBias : 1 - S.frontBias) / 2 : 0.5;
      if (rearCut) share = w.front ? 0.5 : 0;
      w.driveT = tDrive * share;
      // traction control trims wheelspin
      if (this.assist && w.slipRatio > 0.16 && w.driveT * Math.sign(w.omega || 1) > 0) w.driveT *= THREE.MathUtils.clamp(1 - (w.slipRatio - 0.16) * 3 * this.assist, 0.15, 1);
      if (!(rearCut && !w.front)) w.inertia += reflected;
    }

    // ---- Tyres ----
    const T = S.tire;
    // Ackermann: the inside wheel turns more.
    const ack = Math.tan(this.steerAngle) / S.wheelbase;
    for (const w of this.wheels) {
      if (w.front) w.steer = Math.atan(S.wheelbase * ack / (1 - ack * (w.left ? S.track / 2 : -S.track / 2) * 1)) || 0;
      else w.steer = 0;
      const bT = (w.front ? S.brakes.front : S.brakes.rear) * this.brake + (w.front ? 0 : S.brakes.handbrake * this.handbrake);
      w.brakeT = bT;
      if (!w.contact) {
        // wheel spins freely in the air
        w.omega += (w.driveT / w.inertia) * dt;
        const bd = (bT + 20) * dt / w.inertia;
        w.omega = Math.abs(w.omega) <= bd ? 0 : w.omega - Math.sign(w.omega) * bd;
        w.fz = 0; w.slide = 0;
        continue;
      }
      const n = w.normal;
      const s1 = Math.sin(w.steer), c1 = Math.cos(w.steer);
      const fw = _v1.copy(F).multiplyScalar(c1).addScaledVector(L, s1);
      const f = fw.addScaledVector(n, -fw.dot(n)).normalize();
      const sd = _v2.crossVectors(n, f);
      const rp = _v3.subVectors(w.point, this.pos);
      const vp = _v4.crossVectors(this.angVel, rp).add(this.vel);
      const vLong = vp.dot(f), vLat = vp.dot(sd);
      w.vLong = vLong; w.vLat = vLat;
      const fz = w.suspF * Math.max(0.3, U.dot(n));
      w.fz = fz;
      const surf = SURFACES[w.surface] || SURFACES[SURF.GRAVEL];
      const nominal = this.cornerLoad[w.axle];
      const mu = T.mu * surf.mu * (1 - T.loadSens * (fz / nominal - 1));
      w.mu = mu;
      const fmax = mu * fz;
      const vRef = Math.max(Math.abs(vLong), V_MIN);
      const sr = (w.omega * r - vLong) / vRef;
      const tanA = vLat / Math.max(Math.abs(vLong), V_MIN * 0.8);
      const sx = sr / T.slipRatio, sy = tanA / Math.tan(T.slipAngle);
      const st = Math.sqrt(sx * sx + sy * sy);
      let fx = 0, fy = 0;
      if (st > 1e-6) {
        const ft = fmax * Math.sin(T.shape * Math.atan(this.tireB * st));
        fx = ft * sx / st;
        fy = -ft * sy / st;
      }
      // rolling resistance
      fx -= surf.rr * fz * Math.tanh(vLong * 2);
      w.slipRatio = sr;
      w.slipAngle = Math.atan(tanA);
      w.slide = Math.min(1.5, st);
      // body force at the contact patch (lifted a little: acts like a roll centre)
      const fvec = _v1.copy(f).multiplyScalar(fx).addScaledVector(sd, fy).addScaledVector(U, w.suspF);
      const app = _v2.copy(w.point).addScaledVector(U, 0.12);
      force.add(fvec);
      torque.add(_v3.subVectors(app, this.pos).cross(fvec));
      // Wheel spin, integrated semi-implicitly so stiff tyres stay stable.
      const K = fmax * this.tireSlope / T.slipRatio * r / vRef;
      const denom = w.inertia + dt * r * K;
      let om = w.omega + dt * (w.driveT - fx * r) / denom;
      let bTe = bT;
      // ABS eases off a locking wheel
      if (this.assist && bT > 0 && sr < -0.14 && Math.abs(vLong) > 3 && !(w.axle === 1 && this.handbrake > 0.2)) bTe *= 0.3;
      const bd = bTe * dt / denom;
      om = Math.abs(om) <= bd ? 0 : om - Math.sign(om) * bd;
      w.omega = om;
      // water: drag through fords and lakes
      if (w.water > 0) {
        const depth = Math.min(1, w.water / 0.5);
        force.addScaledVector(this.vel, -depth * 55 * Math.min(this.vel.length(), 25));
      }
    }

    // Limited-slip differentials pull wheel speeds together (implicitly: stable).
    const couple = (a, b, k, weight = 1) => {
      if (k <= 0) return;
      const I = (a.inertia + b.inertia) / 2;
      const m = (a.omega + b.omega) / 2, d = a.omega - b.omega;
      const d2 = d / (1 + 2 * k * weight * dt / I);
      a.omega = m + d2 / 2; b.omega = m - d2 / 2;
    };
    const [fl, fr, rl, rr] = this.wheels;
    if (S.drive === 'awd') {
      couple(fl, fr, S.diff.front);
      couple(rl, rr, S.diff.rear);
      if (!rearCut) {
        const I = (fl.inertia + fr.inertia + rl.inertia + rr.inertia) / 4;
        const mf = (fl.omega + fr.omega) / 2, mr = (rl.omega + rr.omega) / 2;
        const m = (mf + mr) / 2, d = (mf - mr) / (1 + 2 * S.diff.centre * dt / I);
        fl.omega += m + d / 2 - mf; fr.omega += m + d / 2 - mf;
        rl.omega += m - d / 2 - mr; rr.omega += m - d / 2 - mr;
      }
    } else if (S.drive === 'rwd') {
      couple(rl, rr, S.diff.rear);
    } else {
      couple(fl, fr, S.diff.front);
    }

    // ---- Aerodynamics ----
    const sp = this.vel.length();
    force.addScaledVector(this.vel, -S.aero.drag * sp);
    const vf = this.vel.dot(F);
    force.addScaledVector(U, -S.aero.lift * vf * vf);

    // ---- In the air: a little control over pitch and roll ----
    if (grounded === 0) {
      const I = S.inertia;
      torque.addScaledVector(L, (this.throttle - this.brake) * I[0] * 1.1);
      torque.addScaledVector(F, -(inp.steer || 0) * I[2] * 1.3);
      this.angVel.multiplyScalar(1 - dt * 0.4);
    }

    // ---- Body against the ground (roofs, bumpers, sills) ----
    for (const hp of this.hull) {
      const p = _v1.copy(hp).applyMatrix4(this.R).add(this.pos);
      const gh = this.world.heightAt(p.x, p.z);
      if (p.y > gh + 0.05) continue;
      this.world.normalAt(p.x, p.z, _n);
      const pen = (gh - p.y) * _n.y;
      if (pen <= 0) continue;
      const rp = _v2.subVectors(p, this.pos);
      const vp = _v3.crossVectors(this.angVel, rp).add(this.vel);
      const vn = vp.dot(_n);
      const fn = Math.max(0, 260000 * pen - 14000 * vn);
      const vt = _v4.copy(vp).addScaledVector(_n, -vn);
      const vtl = vt.length();
      const fc = _v1.copy(_n).multiplyScalar(fn);
      if (vtl > 1e-3) fc.addScaledVector(vt, -Math.min(0.55 * fn, vtl * S.mass * 2) / vtl);
      force.add(fc);
      torque.add(rp.cross(fc));
      if (vtl > 3 && fn > 3000) this._scrape = Math.max(this._scrape || 0, Math.min(1, vtl / 15));
    }

    // ---- Integrate ----
    this.vel.addScaledVector(force, this.invMass * dt);
    this.angVel.addScaledVector(this._invIWorld(torque, _v1), dt);
    this.pos.addScaledVector(this.vel, dt);
    const av = this.angVel;
    const q = this.quat;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.x += 0.5 * dt * (av.x * qw + av.y * qz - av.z * qy);
    q.y += 0.5 * dt * (av.y * qw + av.z * qx - av.x * qz);
    q.z += 0.5 * dt * (av.z * qw + av.x * qy - av.y * qx);
    q.w += 0.5 * dt * (-av.x * qx - av.y * qy - av.z * qz);
    q.normalize();

    this._collideObstacles();
  }

  // World-space inverse inertia applied to v: R * diag(1/I) * R^T * v
  _invIWorld(v, out) {
    const { L, U, F } = this;
    const a = v.dot(L) * this.invI.x, b = v.dot(U) * this.invI.y, c = v.dot(F) * this.invI.z;
    return out.copy(L).multiplyScalar(a).addScaledVector(U, b).addScaledVector(F, c);
  }

  // Apply an impulse j at world point p.
  applyImpulse(j, p) {
    this.vel.addScaledVector(j, this.invMass);
    const rp = _v4.subVectors(p, this.pos);
    const t = rp.cross(j);
    this.angVel.add(this._invIWorld(t, _v4));
  }

  // Trees and boulders: the body is a box, trunks are upright cylinders, rocks spheres.
  _collideObstacles() {
    this._updateBasis();
    const c = _v1.copy(this.bodyCentre).applyMatrix4(this.R).add(this.pos);
    const he = this.bodyHalf;
    const center = this._center || (this._center = new THREE.Vector3());
    center.copy(c);
    const reach = Math.hypot(he.x, he.z) + 1.6;
    this.world.forObstacles(center.x, center.z, reach, (o) => {
      let nx, ny, nz, pen, px, py, pz;
      if (o.kind === 'tree') {
        if (center.y + he.y + 0.5 < o.y || center.y - he.y > o.y + o.h) return;
        const qy = THREE.MathUtils.clamp(center.y, o.y, o.y + o.h);
        // tree axis point in car space
        const dx = o.x - center.x, dy = qy - center.y, dz = o.z - center.z;
        const lx = dx * this.L.x + dy * this.L.y + dz * this.L.z;
        const ly = dx * this.U.x + dy * this.U.y + dz * this.U.z;
        const lz = dx * this.F.x + dy * this.F.y + dz * this.F.z;
        const bx = THREE.MathUtils.clamp(lx, -he.x, he.x), by = THREE.MathUtils.clamp(ly, -he.y, he.y), bz = THREE.MathUtils.clamp(lz, -he.z, he.z);
        px = center.x + this.L.x * bx + this.U.x * by + this.F.x * bz;
        py = center.y + this.L.y * bx + this.U.y * by + this.F.y * bz;
        pz = center.z + this.L.z * bx + this.U.z * by + this.F.z * bz;
        let hx = o.x - px, hz = o.z - pz;
        const dist = Math.hypot(hx, hz);
        if (dist >= o.r) return;
        if (dist < 1e-4) { hx = o.x - center.x; hz = o.z - center.z; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; pen = o.r; }
        else { hx /= dist; hz /= dist; pen = o.r - dist; }
        nx = hx; ny = 0; nz = hz;
      } else {
        const dx = o.x - center.x, dy = o.y - center.y, dz = o.z - center.z;
        const lx = dx * this.L.x + dy * this.L.y + dz * this.L.z;
        const ly = dx * this.U.x + dy * this.U.y + dz * this.U.z;
        const lz = dx * this.F.x + dy * this.F.y + dz * this.F.z;
        const bx = THREE.MathUtils.clamp(lx, -he.x, he.x), by = THREE.MathUtils.clamp(ly, -he.y, he.y), bz = THREE.MathUtils.clamp(lz, -he.z, he.z);
        px = center.x + this.L.x * bx + this.U.x * by + this.F.x * bz;
        py = center.y + this.L.y * bx + this.U.y * by + this.F.y * bz;
        pz = center.z + this.L.z * bx + this.U.z * by + this.F.z * bz;
        const ex = o.x - px, ey = o.y - py, ez = o.z - pz;
        const dist = Math.hypot(ex, ey, ez);
        if (dist >= o.r) return;
        if (dist < 1e-4) { nx = dx; ny = dy; nz = dz; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; pen = o.r; }
        else { nx = ex / dist; ny = ey / dist; nz = ez / dist; pen = o.r - dist; }
      }
      const n = _n.set(nx, ny, nz);
      const p = _v2.set(px, py, pz);
      const rp = _v3.subVectors(p, this.pos);
      const vp = _v4.crossVectors(this.angVel, rp).add(this.vel);
      const vn = vp.dot(n);
      // push out of the obstacle
      this.pos.addScaledVector(n, -Math.max(0, pen - 0.005) * 0.6);
      if (vn <= 0) return;
      const vt = new THREE.Vector3().copy(vp).addScaledVector(n, -vn);
      const vtl = vt.length();
      const rxn = _v4.copy(rp).cross(n);
      const k = this.invMass + this._invIWorld(rxn, _v4).cross(rp).dot(n);
      const e = o.kind === 'tree' ? 0.12 : 0.2;
      const jn = (1 + e) * vn / k;
      const J = new THREE.Vector3().copy(n).multiplyScalar(-jn);
      // friction along the contact
      if (vtl > 1e-3) J.addScaledVector(vt, -Math.min(0.35 * jn, vtl / k) / vtl);
      this.applyImpulse(J, p);
      if (vn > 1.5) {
        this.events.push({ type: 'impact', speed: vn, kind: o.kind, point: p.clone(), normal: n.clone(), obstacle: o });
        this.damage += Math.max(0, vn - 4) * 0.02;
      }
    });
  }

  // Engine and surface state summarised for sound, effects and the HUD.
  get telemetry() {
    const fl = this.wheels;
    let slide = 0, contact = 0;
    for (const w of fl) if (w.contact) { slide = Math.max(slide, w.slide); contact++; }
    return { rpm: this.rpm, gear: this.gear, speed: this.speed, slide, contact, boost: this.boost };
  }
}
