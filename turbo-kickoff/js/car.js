// A car: its cannon-es body (the hitbox), the driving model and the visuals.
// The body never rotates by itself (fixedRotation); the driving model sets its
// orientation so the car can stick to walls and the ceiling.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS as P, START_BOOST } from './config.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

// Turning circle tightens at low speed (curvature in 1/m against speed in m/s)
const CURVATURE = [[0, 0.69], [5, 0.398], [10, 0.235], [15, 0.1375], [17.5, 0.11], [23, 0.088]];
function curvature(speed) {
  for (let i = 1; i < CURVATURE.length; i++) {
    const [s1, c1] = CURVATURE[i];
    if (speed <= s1) {
      const [s0, c0] = CURVATURE[i - 1];
      return c0 + (c1 - c0) * (speed - s0) / (s1 - s0);
    }
  }
  return CURVATURE[CURVATURE.length - 1][1];
}

export class Car {
  constructor({ team, name, isPlayer, model, world, material }) {
    this.team = team;
    this.name = name;
    this.isPlayer = isPlayer;
    this.mesh = model;
    this.wheels = ['FL', 'FR', 'RL', 'RR'].map((k) => {
      const w = model.getObjectByName('Wheel_' + k);
      w.rotation.order = 'YXZ';
      return { obj: w, front: k[0] === 'F', radius: k[0] === 'F' ? 0.17 : 0.2 };
    });
    this.exits = [model.getObjectByName('BoostExit_L'), model.getObjectByName('BoostExit_R')];

    this.body = new CANNON.Body({
      mass: P.carMass,
      shape: new CANNON.Box(new CANNON.Vec3(...P.hitboxHalf)),
      material,
      fixedRotation: true,
      linearDamping: 0,
      angularDamping: 0,
    });
    this.body.allowSleep = false;
    this.body.userData = { car: this };
    world.addBody(this.body);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(-1, 0, 0);
    this.normal = new THREE.Vector3(0, 1, 0);
    this.angVel = new THREE.Vector3(); // pitch (about right), yaw (about up), roll (about forward)
    this.stats = { score: 0, goals: 0, assists: 0, saves: 0, shots: 0 };
    this.controls = null;
    this.reset([0, 0, 0], 0);
  }

  reset(position, yaw) {
    this.quat.setFromAxisAngle(WORLD_UP, yaw);
    this.updateAxes();
    this.pos.set(position[0], position[1] + P.rideHeight, position[2]);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.normal.set(0, 1, 0);
    this.grounded = true;
    this.jumped = false;
    this.jumpHold = false;
    this.jumpTimer = 10;
    this.airTime = 0;
    this.secondJumpUsed = false;
    this.dodgeTimer = 0;
    this.boost = START_BOOST;
    this.boosting = false;
    this.steerVisual = 0;
    this.wheelSpin = 0;
    this.lastTouch = -10;
    this.hitCooldown = 0;
    this.writeBody();
  }

  updateAxes() {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.crossVectors(this.fwd, this.up);
  }

  readBody() {
    const b = this.body;
    this.pos.set(b.position.x, b.position.y, b.position.z);
    this.vel.set(b.velocity.x, b.velocity.y, b.velocity.z);
  }

  writeBody() {
    const b = this.body;
    b.position.set(this.pos.x, this.pos.y, this.pos.z);
    b.velocity.set(this.vel.x, this.vel.y, this.vel.z);
    b.quaternion.set(this.quat.x, this.quat.y, this.quat.z, this.quat.w);
    b.angularVelocity.set(0, 0, 0);
  }

  get speed() { return this.vel.length(); }
  get supersonic() { return this.vel.length() > P.supersonic; }
  get dodging() { return this.dodgeTimer > 0; }

  rotateAbout(axis, angle) {
    _q.setFromAxisAngle(axis, angle);
    this.quat.premultiply(_q).normalize();
    this.updateAxes();
  }

  // One physics step (before cannon-es resolves car/ball/car contacts)
  step(dt, c, arena, opts) {
    this.readBody();
    this.controls = c;
    const frozen = opts.frozen;
    this.jumpTimer += dt;
    this.hitCooldown -= dt;

    const d = arena.distance(this.pos, _n);
    this.normal.copy(_n);
    const upDot = this.up.dot(_n);
    const wheelsDown = d < P.rideHeight + 0.15 && upDot > 0.5 && !(this.jumped && this.jumpTimer < 0.12);

    this.boosting = !frozen && c.boost && (this.boost > 0 || opts.unlimitedBoost);
    if (this.boosting && !opts.unlimitedBoost) this.boost = Math.max(0, this.boost - P.boostPerSecond * dt);

    if (frozen) {
      this.vel.set(0, 0, 0);
    } else if (wheelsDown) {
      this.groundStep(dt, c, d, _n);
    } else {
      this.airStep(dt, c);
    }

    // Keep the hitbox out of the floor, walls and ceiling when not driving on them
    if (!this.grounded) {
      const d2 = arena.distance(this.pos, _n);
      const [hx, hy, hz] = P.hitboxHalf;
      const support = Math.abs(hx * _n.dot(this.right)) + Math.abs(hy * _n.dot(this.up)) + Math.abs(hz * _n.dot(this.fwd));
      if (d2 < support) {
        this.pos.addScaledVector(_n, support - d2);
        const vn = this.vel.dot(_n);
        if (vn < 0) this.vel.addScaledVector(_n, -vn * 1.05);
        this.vel.multiplyScalar(1 - Math.min(1, 1.5 * dt));
        if (this.up.dot(_n) < 0.5) this.selfRight(dt, _n);
      }
    }

    const s = this.vel.length();
    if (s > P.maxCarSpeed) this.vel.multiplyScalar(P.maxCarSpeed / s);
    this.writeBody();
  }

  groundStep(dt, c, d, n) {
    if (!this.grounded) {
      this.grounded = true;
      this.jumped = false;
      this.jumpHold = false;
      this.secondJumpUsed = false;
      this.dodgeTimer = 0;
      this.airTime = 0;
      this.angVel.set(0, 0, 0);
    }
    // Line the car up with the surface and hold it at ride height
    _qi.setFromUnitVectors(this.up, n);
    _q.identity().slerp(_qi, Math.min(1, 14 * dt));
    this.quat.premultiply(_q).normalize();
    this.updateAxes();
    this.pos.addScaledVector(n, (P.rideHeight - d) * Math.min(1, 25 * dt));

    const v = this.vel;
    const vn = v.dot(n);
    if (vn < 0) {
      const speed = v.length();
      v.addScaledVector(n, -vn);
      if (-vn < 0.3 * speed) { // following a curve: keep the speed
        const l = v.length();
        if (l > 1e-3) v.multiplyScalar(speed / l);
      }
    }

    // Gravity slides the car down walls; fast cars stick, slow ones fall off
    const gn = -P.gravity * n.y;
    v.x -= -P.gravity * n.y * n.x * dt;
    v.y += (-P.gravity - gn * n.y) * dt;
    v.z -= -P.gravity * n.y * n.z * dt;
    const stick = v.length() > P.stickSpeed ? P.stickFast : P.stickSlow;
    if (gn - stick > 0) {
      v.addScaledVector(n, (gn - stick) * dt);
      this.grounded = false;
    }

    // Throttle, brakes and boost
    const fs = v.dot(this.fwd);
    const throttle = this.boosting ? 1 : c.throttle;
    let a = this.boosting ? P.boostAccel : 0;
    if (throttle !== 0) {
      if (throttle * fs >= -0.1) {
        const sp = Math.abs(fs);
        if (sp < P.maxDriveSpeed) a += throttle * P.throttleAccel * (1 - 0.9 * sp / P.maxDriveSpeed);
      } else {
        a += throttle * P.brakeAccel;
      }
    } else if (!this.boosting) {
      a -= Math.sign(fs) * Math.min(Math.abs(fs) / dt, P.coastDecel);
    }
    v.addScaledVector(this.fwd, a * dt);

    // Steering turns the car about the surface normal
    const fs2 = v.dot(this.fwd);
    const turn = -c.steer * curvature(Math.abs(fs2)) * fs2 * (c.slide ? 1.25 : 1);
    if (turn) this.rotateAbout(n, turn * dt);

    // Tyre grip removes sideways sliding (less when powersliding)
    const lat = v.dot(this.right);
    v.addScaledVector(this.right, -lat * Math.min(1, (c.slide ? P.slideGrip : P.grip) * dt));

    if (c.jumpPressed) {
      v.addScaledVector(this.up, P.jumpImpulse);
      this.jumped = true;
      this.jumpHold = true;
      this.jumpTimer = 0;
      this.grounded = false;
      this.onJump && this.onJump(this);
    }
    this.wheelSpin += (v.dot(this.fwd) / 0.19) * dt;
  }

  airStep(dt, c) {
    this.grounded = false;
    this.airTime += dt;
    const v = this.vel;
    v.y -= P.gravity * dt;
    if (this.jumpHold && c.jump && this.jumpTimer < P.jumpHoldTime) v.addScaledVector(this.up, P.jumpHoldAccel * dt);
    else this.jumpHold = false;
    if (this.boosting) v.addScaledVector(this.fwd, P.boostAccel * dt);

    // Second jump: straight up, or a flip in the stick's direction
    const window = this.jumped ? this.jumpTimer : this.airTime;
    if (c.jumpPressed && !this.secondJumpUsed && window < P.secondJumpWindow) {
      this.secondJumpUsed = true;
      const ix = c.steer, iy = c.pitch, len = Math.hypot(ix, iy);
      if (len < 0.35) {
        v.addScaledVector(this.up, P.doubleJumpImpulse);
      } else {
        const fx = iy / len, sx = ix / len;
        _a.set(this.fwd.x, 0, this.fwd.z);
        if (_a.lengthSq() < 1e-4) _a.set(this.up.x, 0, this.up.z).negate();
        _a.normalize();
        _b.crossVectors(_a, WORLD_UP);
        v.addScaledVector(_a, fx * P.dodgeImpulse * (fx < 0 ? 1.07 : 1));
        v.addScaledVector(_b, sx * P.dodgeImpulse);
        if (v.y < 0) v.y *= 0.3;
        const rate = (2 * Math.PI) / P.dodgeTime;
        this.angVel.set(-fx * rate, 0, sx * rate);
        this.dodgeTimer = P.dodgeTime;
      }
      this.onJump && this.onJump(this);
    }

    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      if (this.dodgeTimer <= 0) this.angVel.multiplyScalar(0.15);
    } else {
      const pitchIn = -c.pitch;
      const yawIn = c.slide ? 0 : -c.steer;
      const rollIn = c.roll;
      const w = this.angVel;
      w.x += (pitchIn * P.airPitchAccel - 2.8 * w.x * (1 - Math.abs(pitchIn))) * dt;
      w.y += (yawIn * P.airYawAccel - 1.9 * w.y * (1 - Math.abs(yawIn))) * dt;
      w.z += (rollIn * P.airRollAccel - 4.5 * w.z) * dt;
      if (w.length() > P.airMaxRate) w.setLength(P.airMaxRate);
    }
    _a.set(0, 0, 0)
      .addScaledVector(this.right, this.angVel.x)
      .addScaledVector(this.up, this.angVel.y)
      .addScaledVector(this.fwd, this.angVel.z);
    const rate = _a.length();
    if (rate > 1e-6) this.rotateAbout(_a.divideScalar(rate), rate * dt);
  }

  // Tip a car that landed on its roof or side back onto its wheels
  selfRight(dt, n) {
    _a.crossVectors(this.up, n);
    if (_a.lengthSq() < 1e-6) _a.copy(this.fwd);
    _a.normalize();
    this.rotateAbout(_a, Math.min(Math.acos(Math.max(-1, Math.min(1, this.up.dot(n)))), 4 * dt));
    this.angVel.multiplyScalar(0.8);
  }

  updateVisual(dt) {
    this.mesh.position.copy(this.pos).addScaledVector(this.up, -P.rideHeight);
    this.mesh.quaternion.copy(this.quat);
    const steer = this.controls && this.grounded ? this.controls.steer : 0;
    this.steerVisual += (steer - this.steerVisual) * Math.min(1, 10 * dt);
    for (const w of this.wheels) {
      w.obj.rotation.x = this.wheelSpin * (0.19 / w.radius);
      w.obj.rotation.y = w.front ? -this.steerVisual * 0.45 : 0;
    }
  }
}
