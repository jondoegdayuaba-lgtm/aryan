// Trophy-truck physics: a rigid body on four ray-cast wheels with long-travel
// suspension, a tyre model with a friction circle, a torque-curve engine with an
// automatic six-speed gearbox, aerodynamic drag, chassis-to-ground collisions,
// obstacle impacts and a little air control for landing jumps.
import * as THREE from 'three';

const V = () => new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const GRAVITY = 9.81;

export const TRUCK = {
  mass: 2350,
  inertia: new THREE.Vector3(5600, 6400, 2100),   // body axes: x = pitch, y = yaw, z = roll
  comHeight: 0.3,                                 // centre of mass above the wheel centres at rest
  wheels: [
    { x: -1.03, z: -1.74, front: true, left: true },
    { x: 1.03, z: -1.74, front: true, left: false },
    { x: -1.03, z: 1.76, front: false, left: true },
    { x: 1.03, z: 1.76, front: false, left: false },
  ],
  radius: 0.5,
  restLength: 0.64,       // suspension length at full droop
  maxTravel: 0.52,        // compression where the bump stops start
  spring: 36000,
  bump: 3600,
  rebound: 5600,
  arbFront: 16000,
  arbRear: 9000,
  tyreGrip: 1.02,
  engine: {
    idle: 900,
    redline: 6900,
    torque: [[600, 480], [1500, 760], [2600, 930], [3800, 1040], [4800, 1060], [5800, 990], [6600, 900], [7200, 760]],
    brakeTorque: 190,
  },
  gears: [-4.2, 4.83, 3.83, 3.03, 2.4, 1.9, 1.5],   // index 0 = reverse
  finalDrive: 4.0,
  efficiency: 0.9,
  shiftUp: 6450,
  shiftDown: 3000,
  shiftTime: 0.2,
  frontShare: 0.38,
  brakeForce: 15500,
  handbrakeForce: 13000,
  steerMaxLow: 0.62,
  steerMaxHigh: 0.12,
  dragArea: 1.5,
  downforce: 0.35,
  boostTorque: 1.4,
  airControl: 2.2,
  rollCentre: 0.45,       // tyre forces act this fraction of the way up to the centre of mass
};

function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1], [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

// Magic-formula-like curve, normalised to peak 1 near 0.2 rad of slip.
function lateralCurve(alpha) {
  const a = Math.abs(alpha);
  const v = Math.sin(1.55 * Math.atan(8.5 * a));
  return v;
}

export class Vehicle {
  constructor(world, spec = TRUCK) {
    this.world = world;
    this.spec = spec;
    this.pos = V();
    this.vel = V();
    this.quat = new THREE.Quaternion();
    this.angVel = V();
    this.invInertia = new THREE.Vector3(1 / spec.inertia.x, 1 / spec.inertia.y, 1 / spec.inertia.z);

    // Wheel mount points (top of suspension) relative to the centre of mass.
    const corner = (spec.mass * GRAVITY) / 4;
    this.staticComp = corner / spec.spring;
    this.wheels = spec.wheels.map((w) => ({
      ...w,
      mount: new THREE.Vector3(w.x, -spec.comHeight + spec.restLength - this.staticComp, w.z),
      comp: this.staticComp,
      prevComp: this.staticComp,
      compVel: 0,
      contact: false,
      point: V(),
      normal: new THREE.Vector3(0, 1, 0),
      surface: null,
      surfBuf: {},
      load: 0,
      steer: 0,
      spin: 0,           // rotation angle, radians
      omega: 0,          // spin rate, rad/s
      slipLong: 0,       // 0..1 wheelspin / lock amount
      slipLat: 0,        // lateral sliding speed, m/s
      driveTorque: 0,
      airTime: 0,
    }));

    this.gear = 1;
    this.rpm = spec.engine.idle;
    this.shiftTimer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.steerInput = 0;
    this.handbrake = false;
    this.boost = false;
    this.reverseHold = 0;
    this.airTime = 0;
    this.groundedWheels = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.impacts = [];       // collision events for effects / sound, drained by the game
    this.landing = 0;        // impact strength of the last landing, decays
    this.acc = 0;
    this.stepDt = 1 / 120;
    this.lastStepDt = this.stepDt;

    this._force = V();
    this._torque = V();
    this._qInv = new THREE.Quaternion();
    this._qd = new THREE.Quaternion();
    this._tmp = { a: V(), b: V(), c: V(), d: V(), e: V(), f: V(), g: V(), h: V() };
    this._axes = { right: V(), up: V(), fwd: V() };

    // Previous state for render interpolation.
    this.prevPos = V();
    this.prevQuat = new THREE.Quaternion();
  }

  reset(position, heading) {
    this.pos.copy(position);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.gear = 1;
    this.rpm = this.spec.engine.idle;
    this.shiftTimer = 0;
    this.airTime = 0;
    for (const w of this.wheels) {
      w.comp = w.prevComp = this.staticComp;
      w.compVel = 0;
      w.omega = 0;
      w.steer = 0;
    }
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  // Place the truck resting on the ground at (x, z) facing `heading` (radians, 0 = -z).
  placeOnGround(x, z, heading) {
    const h = this.world.heightAt(x, z);
    this.reset(new THREE.Vector3(x, h + this.spec.radius + this.spec.comHeight + 0.05, z), heading);
  }

  axes() {
    const A = this._axes;
    A.right.set(1, 0, 0).applyQuaternion(this.quat);
    A.up.set(0, 1, 0).applyQuaternion(this.quat);
    A.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    return A;
  }

  // Heading angle on the ground plane (0 = -z, positive = turning left).
  get heading() {
    const f = this._tmp.h.set(0, 0, -1).applyQuaternion(this.quat);
    return Math.atan2(-f.x, -f.z);
  }

  _addForceAt(F, P) {
    this._force.add(F);
    const r = this._tmp.g.subVectors(P, this.pos);
    this._torque.add(r.cross(F));
  }

  // Apply the world-space inverse inertia to a world-space vector.
  _invInertiaWorld(v, out) {
    return out.copy(v).applyQuaternion(this._qInv).multiply(this.invInertia).applyQuaternion(this.quat);
  }

  // Terrain ray from `o` along `d` (unit, mostly downward). Returns distance or Infinity.
  _groundRay(o, d, maxT, outPoint, outNormal) {
    const W = this.world;
    if (d.y > -0.25) return Infinity;
    let t = 0;
    let h = W.heightAt(o.x, o.z);
    let f = o.y - h;
    if (f <= 0) {
      outPoint.set(o.x, h, o.z);
      W.normalAt(o.x, o.z, outNormal);
      return 0;
    }
    for (let i = 0; i < 5; i++) {
      t += f / -d.y;
      if (t > maxT + 0.5) return Infinity;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      h = W.heightAt(x, z);
      f = y - h;
      if (Math.abs(f) < 0.002) break;
    }
    if (t > maxT) return Infinity;
    outPoint.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    W.normalAt(outPoint.x, outPoint.z, outNormal);
    return t;
  }

  update(dt, input) {
    // Smooth the driver's inputs (keyboards are all-or-nothing).
    const S = this.spec;
    const k = (rate) => 1 - Math.exp(-dt * rate);
    this.throttleInput = input.throttle;
    this.brakeInput = input.brake;
    this.steerInput += (input.steer - this.steerInput) * k(Math.abs(input.steer) > Math.abs(this.steerInput) ? 7 : 11);
    this.handbrake = input.handbrake;
    this.boost = input.boost;

    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= this.stepDt && steps < 12) {
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      this._step(this.stepDt);
      this.acc -= this.stepDt;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    this.alpha = this.acc / this.stepDt;
    this.landing = Math.max(0, this.landing - dt * 2);
  }

  // Interpolated transform for rendering.
  renderTransform(outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.pos, this.alpha ?? 1);
    outQuat.slerpQuaternions(this.prevQuat, this.quat, this.alpha ?? 1);
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

    // ---- Gear selection and driver intent (forward / reverse).
    let throttle = this.throttleInput;
    let brake = this.brakeInput;
    if (this.gear > 0) {
      if (brake > 0.1 && vFwd < 0.6 && throttle < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.25) { this.gear = 0; this.reverseHold = 0; }
      } else this.reverseHold = 0;
    } else {
      // In reverse the pedals swap: "brake" drives backwards, "throttle" brakes.
      if (throttle > 0.1 && vFwd > -0.6) { this.gear = 1; }
      else { const t = throttle; throttle = brake; brake = t; }
    }

    // ---- Steering: less lock at speed, and wheels ease toward the target.
    const speedK = clamp(Math.abs(vFwd) / 48, 0, 1);
    const maxSteer = THREE.MathUtils.lerp(S.steerMaxLow, S.steerMaxHigh, Math.pow(speedK, 0.7));
    const steerTarget = -this.steerInput * maxSteer;

    // ---- Engine and gearbox.
    const E = S.engine;
    const ratio = S.gears[this.gear] * S.finalDrive;
    const toRpm = 60 / (2 * Math.PI);
    // Road speed sets the gearbox's idea of rpm; wheelspin and clutch slip add revs on top.
    const rollRpm = Math.abs((vFwd / S.radius) * ratio) * toRpm;
    let spin = 0, airborne = 0;
    for (const w of this.wheels) { spin += w.slipLong; if (!w.contact) airborne++; }
    spin /= 4;
    const launch = clamp(1 - Math.abs(vFwd) / 7, 0, 1);
    let rpm = Math.max(rollRpm, E.idle + throttle * 3400 * launch);
    rpm += throttle * (spin * 1800 + (airborne / 4) * 2600);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.gear > 0 && this.shiftTimer === 0) {
      if (rollRpm > S.shiftUp && this.gear < S.gears.length - 1 && this.groundedWheels > 1) {
        this.gear++;
        this.shiftTimer = S.shiftTime;
        this.onShift?.(1);
      } else if (rollRpm < S.shiftDown && this.gear > 1) {
        const lower = Math.abs((vFwd / S.radius) * S.gears[this.gear - 1] * S.finalDrive) * toRpm;
        if (lower < S.shiftUp - 600) {
          this.gear--;
          this.shiftTimer = S.shiftTime * 0.8;
          this.onShift?.(-1);
        }
      }
    }
    this.rpm += (Math.min(rpm, E.redline + 150) - this.rpm) * (1 - Math.exp(-dt * 18));
    let engineTorque = 0;
    if (this.shiftTimer === 0) {
      if (this.rpm < E.redline) engineTorque = torqueAt(E.torque, this.rpm) * throttle * (this.boost ? S.boostTorque : 1);
      else engineTorque = 0;
      if (throttle < 0.05) engineTorque = -E.brakeTorque * clamp((this.rpm - E.idle) / 3000, 0, 1);
    }
    const axleTorque = engineTorque * ratio * S.efficiency;

    // ---- Wheels: suspension, then tyre forces.
    let grounded = 0;
    const travel = S.restLength + S.radius;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.steer = w.front ? w.steer + (steerTarget - w.steer) * (1 - Math.exp(-dt * 12)) : 0;
      const mountW = T.a.copy(w.mount).applyQuaternion(this.quat).add(this.pos);
      const dir = T.b.copy(up).negate();
      const t = this._groundRay(mountW, dir, travel, w.point, w.normal);
      w.prevComp = w.comp;
      if (t < travel) {
        w.comp = travel - t;
        w.contact = true;
        grounded++;
      } else {
        w.comp = 0;
        w.contact = false;
      }
      w.compVel = (w.comp - w.prevComp) / dt;
      if (w.contact) w.surface = W.surfaceAt(w.point.x, w.point.z, w.point.y, w.surfBuf);
    }
    const wasAir = this.groundedWheels === 0;
    this.groundedWheels = grounded;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const other = this.wheels[i ^ 1];
      const driveShare = (w.front ? S.frontShare : 1 - S.frontShare) * 0.5;
      // The signed gear ratio makes reverse push backwards and engine braking oppose motion.
      w.driveTorque = axleTorque * driveShare;

      if (!w.contact) {
        // Free wheel: spins up under power, slows with brakes.
        if (brake > 0.1 || (this.handbrake && !w.front)) w.omega *= Math.exp(-dt * 12);
        else if (throttle > 0.05) w.omega += (Math.sign(ratio) * 85 * throttle - w.omega) * (1 - Math.exp(-dt * 1.8));
        else w.omega *= Math.exp(-dt * 0.4);
        w.spin += w.omega * dt;
        w.load = 0;
        w.slipLong = 0;
        w.slipLat = 0;
        w.airTime += dt;
        continue;
      }

      // Suspension force.
      const arb = (w.front ? S.arbFront : S.arbRear) * (w.comp - other.comp);
      let F = S.spring * w.comp + (w.compVel > 0 ? S.bump : S.rebound) * w.compVel + arb;
      if (w.comp > S.maxTravel) {
        const ex = w.comp - S.maxTravel;
        F += 260000 * ex + 14000 * Math.max(0, w.compVel);
      }
      F = Math.max(0, Math.min(F, 120000));
      w.load = F;
      if (w.airTime > 0.35 && w.compVel > 2) this.landing = Math.max(this.landing, Math.min(1, w.compVel / 9));
      w.airTime = 0;
      this._addForceAt(T.c.copy(up).multiplyScalar(F), w.point);

      // Tyre frame on the ground plane.
      const n = w.normal;
      const wf = T.d.copy(fwd).applyAxisAngle(up, w.steer);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const ws = T.e.crossVectors(wf, n).normalize();
      const rel = T.f.subVectors(w.point, this.pos);
      const vc = T.g.crossVectors(this.angVel, rel).add(this.vel);
      const vLong = vc.dot(wf);
      const vLat = vc.dot(ws);

      const surf = w.surface;
      const mu = S.tyreGrip * surf.mu;
      const Fmax = mu * F;
      const mEff = S.mass * 0.25;

      // Longitudinal: drive, brakes, rolling resistance.
      let Fx = w.driveTorque / S.radius;
      const brakeAmt = brake * S.brakeForce + (this.handbrake && !w.front ? S.handbrakeForce : 0);
      if (brakeAmt > 0) Fx -= Math.sign(vLong) * Math.min(brakeAmt, (Math.abs(vLong) * mEff) / dt);
      Fx -= Math.sign(vLong) * Math.min(surf.roll * F, (Math.abs(vLong) * mEff) / dt);

      // Lateral: slip-angle curve, but never more than it takes to stop sliding this step.
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.5));
      let FyCurve = Fmax * lateralCurve(alpha);
      const FyStop = (Math.abs(vLat) * mEff) / dt;
      let Fy = -Math.sign(vLat) * Math.min(FyCurve, FyStop);
      if (this.handbrake && !w.front) Fy *= 0.38;

      // Friction circle: lateral grip keeps priority over wheelspin.
      let demand = Math.hypot(Fx, Fy);
      let spinning = 0;
      if (demand > Fmax) {
        const fyAbs = Math.abs(Fy);
        const fxRoom = Math.sqrt(Math.max(0, Fmax * Fmax - Math.min(fyAbs, Fmax) ** 2));
        const fxLimited = Math.max(fxRoom, Math.abs(Fx) * 0.35);
        spinning = clamp((Math.abs(Fx) - fxLimited) / (Fmax + 1), 0, 1);
        Fx = Math.sign(Fx) * Math.min(Math.abs(Fx), fxLimited);
        demand = Math.hypot(Fx, Fy);
        if (demand > Fmax) {
          const s = Fmax / demand;
          Fx *= s;
          Fy *= s;
        }
      }
      // Applied part-way up toward the centre of mass: tames the roll-over tendency.
      const app = T.a.copy(w.point).addScaledVector(up, (S.radius + S.comHeight) * S.rollCentre);
      this._addForceAt(T.c.copy(wf).multiplyScalar(Fx).addScaledVector(ws, Fy), app);

      // Wheel spin for visuals, sound and effects.
      const locked = (this.handbrake && !w.front) || (brake > 0.6 && Math.abs(vLong) > 3 && Fmax < brakeAmt);
      const rollOmega = vLong / S.radius;
      const spinOmega = rollOmega + Math.sign(w.driveTorque || 1) * spinning * 55;
      w.omega = locked ? w.omega * 0.8 : spinOmega;
      w.spin += w.omega * dt;
      w.slipLong = Math.max(spinning, locked ? clamp(Math.abs(vLong) / 8, 0, 1) : 0);
      w.slipLat = Math.abs(vLat);
    }

    // ---- Aerodynamics.
    const sp = this.speed;
    if (sp > 0.1) {
      this._force.addScaledVector(this.vel, -0.5 * 1.2 * S.dragArea * sp);
      this._force.addScaledVector(up, -0.5 * 1.2 * S.downforce * sp * sp * (grounded ? 1 : 0));
    }

    // ---- Water: heavy drag when wading.
    const wl = W.waterLevelAt?.(this.pos.x, this.pos.z);
    if (wl !== undefined && wl !== null) {
      const depth = wl - (this.pos.y - S.comHeight - S.radius * 0.6);
      if (depth > 0) {
        this._force.addScaledVector(this.vel, -Math.min(depth, 1.2) * 900);
        this.inWater = depth;
      } else this.inWater = 0;
    } else this.inWater = 0;

    // ---- Chassis against the ground (roll-overs, bottoming out).
    this._chassisGround(dt, right, up, fwd);

    // ---- Air control: nudge pitch and roll to land jumps.
    if (grounded === 0) {
      this.airTime += dt;
      const ac = S.airControl;
      // Pitch with throttle/brake, yaw with steering; roll levels itself.
      const pitchIn = this.throttleInput - this.brakeInput;
      const w = this.angVel;
      const pitchRate = w.dot(right), yawRate = w.dot(up), rollRate = w.dot(fwd);
      // With no pitch input the nose eases toward the flight path, like a dart.
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const pathPitch = Math.atan2(this.vel.y, vh) * 0.6;
      const noseUp = Math.asin(clamp(fwd.y, -1, 1));
      const auto = pitchIn === 0 && vh > 5 ? (pathPitch - noseUp) * 2.2 : 0;
      const T1 = T.a.copy(right).multiplyScalar((pitchIn * -ac + auto - pitchRate * (pitchIn === 0 ? 2.4 : 0.8)) * S.inertia.x);
      T1.addScaledVector(up, (-this.steerInput * ac * 0.6 - yawRate * 0.8) * S.inertia.y);
      // Roll: angle of the right axis above the horizon, pulled back toward level.
      const roll = Math.asin(clamp(right.y, -1, 1));
      T1.addScaledVector(fwd, (-roll * 5.5 - rollRate * 2.6) * S.inertia.z * (up.y > 0 ? 1 : 0.4));
      this._torque.add(T1);
    } else {
      if (wasAir && this.airTime > 0.3) this.lastAirTime = this.airTime;
      this.airTime = 0;
    }

    // ---- Integrate.
    this.vel.addScaledVector(this._force, dt / S.mass);
    const dw = this._invInertiaWorld(this._torque, T.b).multiplyScalar(dt);
    this.angVel.add(dw);
    // Gentle damping; a little extra yaw damping keeps high-speed driving calm.
    this.angVel.multiplyScalar(Math.exp(-dt * (grounded ? 0.35 : 0.08)));
    if (grounded >= 3) {
      const yawRate = this.angVel.dot(up);
      this.angVel.addScaledVector(up, -yawRate * (1 - Math.exp(-dt * 0.6 * clamp(sp / 30, 0, 1))));
    }
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    const q = this.quat;
    const dq = T.h.set(w.x, w.y, w.z);
    const ang = dq.length() * dt;
    if (ang > 1e-9) {
      dq.normalize();
      q.premultiply(this._qd.setFromAxisAngle(dq, ang)).normalize();
    }

    this._obstacles(dt);
  }

  // Sample points around the body; any below ground get pushed out with friction.
  _chassisGround(dt, right, up, fwd) {
    const W = this.world;
    const T = this._tmp;
    const pts = Vehicle.BODY_POINTS;
    for (let i = 0; i < pts.length; i++) {
      const p = T.a.copy(pts[i]).applyQuaternion(this.quat).add(this.pos);
      const h = W.heightAt(p.x, p.z);
      if (p.y >= h) continue;
      const n = W.normalAt(p.x, p.z, T.b);
      const depth = (h - p.y) * n.y;
      const rel = T.c.subVectors(p, this.pos);
      const vp = T.d.crossVectors(this.angVel, rel).add(this.vel);
      const vn = vp.dot(n);
      let Fn = 180000 * depth - 9000 * Math.min(vn, 0) * 1.0;
      Fn = Math.max(0, Math.min(Fn, 400000));
      const F = T.e.copy(n).multiplyScalar(Fn);
      // Sliding friction.
      const vt = T.f.copy(vp).addScaledVector(n, -vn);
      const vtl = vt.length();
      if (vtl > 0.01) F.addScaledVector(vt, (-Math.min(0.55 * Fn, (vtl * this.spec.mass * 0.2) / dt)) / vtl);
      this._addForceAt(F, p);
      if (-vn > 3) this.impacts.push({ type: 'scrape', strength: Math.min(1, -vn / 12), point: p.clone() });
    }
  }

  // Boulders, cacti and trees.
  _obstacles(dt) {
    const W = this.world;
    if (!W.queryObstacles) return;
    const T = this._tmp;
    const spheres = Vehicle.BODY_SPHERES;
    W.queryObstacles(this.pos.x, this.pos.z, 6, (ob) => {
      for (const s of spheres) {
        const c = T.a.copy(s).applyQuaternion(this.quat).add(this.pos);
        let n, depth;
        if (ob.kind === 'sphere') {
          const d = T.b.subVectors(c, ob.center);
          const dist = d.length();
          depth = ob.radius + s.r - dist;
          if (depth <= 0) continue;
          n = d.multiplyScalar(1 / (dist || 1));
        } else {
          // Vertical cylinder.
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
        if (ob.breakable && (Math.abs(vn) > 2.5 || this.speed > 4)) {
          ob.broken = true;
          this.impacts.push({ type: 'break', target: ob, strength: Math.min(1, this.speed / 25), point: c.clone(), velocity: this.vel.clone() });
          this.vel.multiplyScalar(0.94);
          return true;   // stop iterating this obstacle
        }
        // Push out and bounce with a little restitution.
        this.pos.addScaledVector(n, depth * 0.8);
        if (vn < 0) {
          const rn = T.e.crossVectors(rel, n);
          const k = this._invInertiaWorld(rn, T.f).cross(rel).dot(n);
          const j = (-(1 + 0.15) * vn) / (1 / this.spec.mass + k);
          this.vel.addScaledVector(n, j / this.spec.mass);
          this.angVel.add(this._invInertiaWorld(rn.multiplyScalar(j), T.f));
          // Friction along the contact.
          const vt = T.g.copy(vp).addScaledVector(n, -vn);
          this.vel.addScaledVector(vt, -0.25);
          if (-vn > 2) this.impacts.push({ type: 'hit', strength: Math.min(1, -vn / 14), point: c.clone() });
        }
      }
      return false;
    });
  }

  get upsideDown() {
    return this._tmp.h.set(0, 1, 0).applyQuaternion(this.quat).y < 0.2;
  }
}

// Body collision samples (relative to the centre of mass).
Vehicle.BODY_POINTS = [];
for (const x of [-0.98, 0.98]) {
  for (const z of [-2.8, -1.0, 1.0, 2.7]) Vehicle.BODY_POINTS.push(new THREE.Vector3(x, -0.12, z));
  for (const z of [-0.9, 0.7]) Vehicle.BODY_POINTS.push(new THREE.Vector3(x * 0.8, 1.25, z));
  Vehicle.BODY_POINTS.push(new THREE.Vector3(x, 0.55, -2.9), new THREE.Vector3(x, 0.55, 2.8));
}
Vehicle.BODY_POINTS.push(new THREE.Vector3(0, -0.2, -2.0), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 2.0));

Vehicle.BODY_SPHERES = [
  Object.assign(new THREE.Vector3(0, 0.38, -1.95), { r: 0.95 }),
  Object.assign(new THREE.Vector3(0, 0.5, 0), { r: 1.0 }),
  Object.assign(new THREE.Vector3(0, 0.38, 1.95), { r: 0.95 }),
];
