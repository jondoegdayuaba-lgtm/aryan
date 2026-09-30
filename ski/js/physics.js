// Ski physics on the heightfield. Pure JS (no three.js) so an autopilot can drive it in Node tests.
//
// Model in short:
//   * full 3D point mass with gravity, air drag (tuck lowers CdA) and snow friction
//   * on the snow the skis have a heading. The player turns the heading; grip pulls the velocity
//     toward it at a limited rate (grip depends on how hard the edges are engaged and on the snow),
//     so carved turns, skids, drifts and speed-scrubbing hockey stops all fall out of one rule
//   * leaves the ground when the terrain falls away faster than the legs can follow (jumps)
//   * landings, tree / rock hits and cliffs end in a crash and a respawn on the piste
import { clamp, damp, angleDiff, smoothstep } from './util.js';

export const G = 9.81;

export const TUNING = {
  mass: 80,
  rho: 1.0,                 // air density at altitude
  cdaUpright: 0.60,
  cdaTuck: 0.30,
  muGroomed: 0.042,         // kinetic friction, groomed piste
  muPowder: 0.105,
  plowPowder: 0.010,        // extra drag off piste  (m/s^2 per (m/s)^2)
  gripGroomed: 1.0,
  gripPowder: 0.62,
  gripBase: 0.16,           // lateral grip (in g) with flat skis
  gripEdge: 0.98,           // extra lateral grip (in g) with fully engaged edges
  skidFriction: 0.42,
  brakeDecel: 0.42,         // g
  yawRateMax: 1.75,
  snapHeight: 0.24,         // legs absorb small bumps up to this height
  snapUpSpeed: 2.1,         // ...unless leaving the surface faster than this
  crashImpact: 13.5,        // m/s into the snow
  hardImpact: 8.5,
  treeSpeed: 3.5,
};

const _n = { x: 0, y: 1, z: 0 };

export class SkierPhysics {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0;                    // heading: forward = (sin yaw, 0, -cos yaw)
    this.grounded = true;
    this.nx = 0; this.ny = 1; this.nz = 0;
    // smoothed inputs
    this.steer = 0; this.tuck = 0; this.brake = 0;
    this.jumpCharge = 0;
    // derived (read by the renderer / audio / HUD)
    this.speed = 0;
    this.slip = 0;                   // signed slip angle (rad) between heading and velocity
    this.aLat = 0;                   // lateral acceleration actually achieved (m/s^2, + = turning right)
    this.lean = 0;                   // body lean angle (rad, + = right)
    this.compress = 0;               // 0..1 leg compression (visual)
    this.airTime = 0;
    this.airStart = null;
    this.maxAir = 0;
    this.maxSpeed = 0;
    this.distance = 0;
    this.surface = 'groomed';
    this.crashed = false;
    this.crashTimer = 0;
    this.crashCause = '';
    this.events = [];
    this.spin = 0;                   // accumulated air rotation (rad)
    this.pitchRate = 0;
    this.grindVolume = 0;
    this.skidAmount = 0;
    this.bumpKick = 0;
    this.hintS = 0;
    this.pathT = 0;
    this.pathS = 0;
    this.pathDist = 0;
    this._proj = {};
  }

  reset(x, z, yaw, speed = 0) {
    this.x = x; this.z = z;
    this.y = this.world.normal(x, z, _n);
    this.nx = _n.x; this.ny = _n.y; this.nz = _n.z;
    this.yaw = yaw;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    this.vx = fx * speed; this.vz = fz * speed; this.vy = 0;
    const vn = this.vx * this.nx + this.vy * this.ny + this.vz * this.nz;
    this.vx -= vn * this.nx; this.vy -= vn * this.ny; this.vz -= vn * this.nz;
    this.grounded = true;
    this.crashed = false;
    this.crashTimer = 0;
    this.steer = this.tuck = this.brake = 0;
    this.jumpCharge = 0;
    this.airTime = 0;
    this.airStart = null;
    this.spin = 0;
    this.slip = 0;
    this.aLat = 0;
    this.lean = 0;
    this.compress = 0;
    this.events.length = 0;
  }

  get forward() {
    return [Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
  }

  /** surface under the skier: friction, grip and drag from the distance to the groomed piste */
  _surface(x, z) {
    const p = this.world.path.project(x, z, this.hintS, this._proj);
    this.hintS = p.s;
    this.pathS = p.s;
    this.pathT = p.t;
    this.pathDist = p.dist;
    const half = this.world.path.at(p.s, _pathTmp).width * 0.5;
    const on = 1 - smoothstep(half - 1.5, half + 5.0, Math.abs(p.t));
    return on;                       // 1 = groomed piste, 0 = powder
  }

  /**
   * Advance by dt seconds.
   * input: { steer -1..1 (right +), tuck 0..1, brake 0..1, jump bool, push bool }
   */
  step(dt, input) {
    const T = TUNING;
    const w = this.world;
    this.events.length = 0;

    if (this.crashed) return this._stepCrashed(dt);

    // ---- smooth the inputs (legs and edges take time)
    this.steer = damp(this.steer, clamp(input.steer, -1, 1), this.grounded ? 9 : 4, dt);
    this.tuck = damp(this.tuck, clamp(input.tuck || 0, 0, 1), 5, dt);
    this.brake = damp(this.brake, clamp(input.brake || 0, 0, 1), 10, dt);

    // ---- pre-jump: hold to compress, release to pop
    if (input.jump) {
      this.jumpCharge = Math.min(1, this.jumpCharge + dt * 2.6);
    } else if (this.jumpCharge > 0) {
      if (this.grounded && this.speed > 2.5 && this.jumpCharge > 0.12) {
        const pop = 1.4 + 2.9 * this.jumpCharge;
        this.vx += this.nx * pop; this.vy += this.ny * pop; this.vz += this.nz * pop;
        this.grounded = false;
        this.airStart = { x: this.x, y: this.y, z: this.z };
        this.events.push({ type: 'pop', power: this.jumpCharge });
      }
      this.jumpCharge = Math.max(0, this.jumpCharge - dt * 5);
      if (this.jumpCharge < 0.02) this.jumpCharge = 0;
    }

    const onPiste = this._surface(this.x, this.z);
    const mu = T.muPowder + (T.muGroomed - T.muPowder) * onPiste;
    const gripMul = T.gripPowder + (T.gripGroomed - T.gripPowder) * onPiste;
    const plow = T.plowPowder * (1 - onPiste);
    this.surface = onPiste > 0.5 ? 'groomed' : 'powder';

    const cda = T.cdaUpright + (T.cdaTuck - T.cdaUpright) * this.tuck;
    const dragK = 0.5 * T.rho * cda / T.mass;

    if (this.grounded) this._stepGround(dt, input, mu, gripMul, plow, dragK);
    else this._stepAir(dt, input, dragK);

    // ---- integrate
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.distance += Math.hypot(this.vx, this.vz) * dt;

    // ---- contact with the terrain
    const h = w.normal(this.x, this.z, _n);
    const d = this.y - h;
    const vn = this.vx * _n.x + this.vy * _n.y + this.vz * _n.z;
    if (d <= 0) {
      if (!this.grounded) this._land(-vn, h, input);
      this.y = h;
      if (vn < 0) { this.vx -= vn * _n.x; this.vy -= vn * _n.y; this.vz -= vn * _n.z; }
      this.grounded = true;
    } else if (this.grounded && d < T.snapHeight && vn < T.snapUpSpeed) {
      this.y = h;
      this.vx -= vn * _n.x; this.vy -= vn * _n.y; this.vz -= vn * _n.z;
      this.bumpKick += Math.abs(vn) * 0.25;
    } else if (this.grounded) {
      this.grounded = false;
      this.airStart = { x: this.x, y: this.y, z: this.z };
      this.airTime = 0;
      this.spin = 0;
      this.events.push({ type: 'takeoff', speed: Math.hypot(this.vx, this.vy, this.vz), rise: vn });
    }
    this.nx = _n.x; this.ny = _n.y; this.nz = _n.z;

    this.speed = Math.hypot(this.vx, this.vy, this.vz);
    if (this.speed > this.maxSpeed) this.maxSpeed = this.speed;
    this.bumpKick = damp(this.bumpKick, 0, 6, dt);

    // ---- hazards
    this._collide();
    if (!this.crashed && this.grounded && this.ny < 0.70) this.crash('cliff');   // steeper than ~45 degrees
    if (!w.inside(this.x, this.z, 12)) this.crash('boundary');
    // visual compression: crouch charge + absorbing bumps
    this.compress = damp(this.compress, Math.max(this.jumpCharge * 0.9, clamp(this.bumpKick, 0, 0.8)), 12, dt);
  }

  // ------------------------------------------------------------------- on the snow
  _stepGround(dt, input, mu, gripMul, plow, dragK) {
    const T = TUNING;
    const nx = this.nx, ny = this.ny, nz = this.nz;
    // tangent-plane velocity
    const vn = this.vx * nx + this.vy * ny + this.vz * nz;
    let tx = this.vx - vn * nx, ty = this.vy - vn * ny, tz = this.vz - vn * nz;
    let speed = Math.hypot(tx, ty, tz);
    const gN = G * Math.max(ny, 0.2);

    // heading frame on the slope
    let fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw), fy = 0;
    const fn = fx * nx + fy * ny + fz * nz;
    fx -= fn * nx; fy -= fn * ny; fz -= fn * nz;
    let fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fy * nz - fz * ny, ry = fz * nx - fx * nz, rz = fx * ny - fy * nx;    // f x n = right hand side
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;

    // ---- steering: yaw rate the player asks for, limited by what the grip could follow
    const engage = Math.abs(this.steer);
    const gripFull = (T.gripBase + T.gripEdge) * gripMul * gN * (1 - 0.18 * this.tuck);
    const yawCap = Math.min(T.yawRateMax, 1.3 * gripFull / Math.max(speed, 2.6));
    const pivot = 1 + 0.9 * this.brake + (speed < 4 ? 0.7 : 0);
    let yawRate = this.steer * yawCap * pivot;
    // the skis can only get so far ahead of the direction of travel unless the player is braking
    if (yawRate * this.slip < 0) {
      const lim = 0.30 + 0.55 * this.brake + (speed < 4 ? 0.6 : 0);
      yawRate *= 1 - smoothstep(lim, lim + 0.65, Math.abs(this.slip));
    }
    this.yaw += yawRate * dt;

    // ---- grip: rotate the velocity toward the (new) heading, at a limited rate
    fx = Math.sin(this.yaw); fz = -Math.cos(this.yaw); fy = 0;
    const fn2 = fx * nx + fy * ny + fz * nz;
    fx -= fn2 * nx; fy -= fn2 * ny; fz -= fn2 * nz;
    fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    rx = fy * nz - fz * ny; ry = fz * nx - fx * nz; rz = fx * ny - fy * nx;
    const rl2 = Math.hypot(rx, ry, rz) || 1; rx /= rl2; ry /= rl2; rz /= rl2;

    const aGrip = (T.gripBase + T.gripEdge * engage) * gripMul * gN * (1 - 0.18 * this.tuck) * (1 + 0.15 * this.compress);
    if (speed > 0.05) {
      const vf = tx * fx + ty * fy + tz * fz;
      const vr = tx * rx + ty * ry + tz * rz;
      let beta = Math.atan2(vr, vf);                        // velocity angle relative to the heading
      const omega = aGrip / Math.max(speed, 1.2);
      const dBeta = clamp(beta, -omega * dt, omega * dt);
      const applied = dBeta / dt;                           // rad/s of velocity turning actually delivered
      beta -= dBeta;
      this.aLat = -applied * speed;                         // + = accelerating toward +r
      // rebuild the velocity from the new angle, speed unchanged (grip does no work)
      const cb = Math.cos(beta), sb = Math.sin(beta);
      tx = speed * (cb * fx + sb * rx); ty = speed * (cb * fy + sb * ry); tz = speed * (cb * fz + sb * rz);
      this.slip = beta;
      // sideways sliding scrubs speed
      const skid = T.skidFriction * gN * Math.min(1, Math.abs(Math.sin(beta)) * 2.2) * (1 + 0.6 * this.brake);
      this.skidAmount = Math.min(1, Math.abs(Math.sin(beta)) * 2.2);
      const s2 = Math.max(speed - skid * dt, 0);
      const k = speed > 1e-6 ? s2 / speed : 0;
      tx *= k; ty *= k; tz *= k; speed = s2;
    } else {
      this.slip = 0; this.aLat = 0; this.skidAmount = 0;
    }

    // ---- gravity along the slope, friction, drag, braking, pushing
    const gn = -G * ny;                                     // g . n
    tx += (0 - gn * nx) * dt;                               // gravity projected on the tangent plane
    ty += (-G - gn * ny) * dt;
    tz += (0 - gn * nz) * dt;
    speed = Math.hypot(tx, ty, tz);
    if (speed > 1e-4) {
      const ux = tx / speed, uy = ty / speed, uz = tz / speed;
      let dec = mu * gN + dragK * speed * speed + plow * speed * speed;
      dec += T.brakeDecel * G * this.brake * (this.surface === 'groomed' ? 1 : 1.15);
      dec += 0.012 * engage * speed;                        // edges ploughing
      const ns = Math.max(speed - dec * dt, 0);
      tx = ux * ns; ty = uy * ns; tz = uz * ns; speed = ns;
    }
    if (input.push && speed < 9.5) {                        // skating / double poling out of the gate
      const push = 3.4 * (1 - speed / 9.5);
      tx += fx * push * dt; ty += fy * push * dt; tz += fz * push * dt;
    }
    if (input.autoPush && speed < input.autoPush) {
      const push = 2.2;
      tx += fx * push * dt; ty += fy * push * dt; tz += fz * push * dt;
    }
    this.vx = tx; this.vy = ty; this.vz = tz;
    this.speed = speed;
    // body lean follows the lateral acceleration
    const targetLean = Math.atan2(this.aLat, gN) * 0.92;               // into the turn
    this.lean = damp(this.lean, clamp(targetLean, -1.15, 1.15), 14, dt);
    this.grindVolume = clamp(speed / 30, 0, 1);
  }

  // ---------------------------------------------------------------------- in the air
  _stepAir(dt, input, dragK) {
    const spin = clamp(input.steer, -1, 1) * 2.6;
    this.yaw += spin * dt;
    this.spin += spin * dt;
    this.vy -= G * dt;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    const dec = dragK * speed;
    const k = Math.max(0, 1 - dec * dt);
    this.vx *= k; this.vy *= k; this.vz *= k;
    this.airTime += dt;
    this.lean = damp(this.lean, 0, 3, dt);
    this.skidAmount = 0;
    this.aLat = 0;
    this.slip = damp(this.slip, 0, 2, dt);
  }

  _land(impact, h, input) {
    const T = TUNING;
    const t = this.airTime;
    // ski heading against the direction of travel over the ground
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const sp = Math.hypot(this.vx, this.vz) || 1;
    const beta = Math.abs(Math.atan2(fx * this.vz - fz * this.vx, fx * this.vx + fz * this.vz));
    const absorb = 1 + 0.35 * this.jumpCharge + 0.15 * this.tuck;
    const hard = T.hardImpact * absorb;
    const crash = T.crashImpact * absorb;
    const dist = this.airStart ? Math.hypot(this.x - this.airStart.x, this.z - this.airStart.z) : 0;
    this.maxAir = Math.max(this.maxAir, t);
    if (t > 0.25 || impact > 4) {
      if (impact > crash || beta > 1.05) {
        this.events.push({ type: 'land', impact, air: t, dist, clean: false });
        this.crash(beta > 1.05 ? 'edge' : 'impact');
        return;
      }
      const clean = impact < 5.5 && beta < 0.35;
      if (impact > hard || beta > 0.7) {
        const k = 0.78;
        this.vx *= k; this.vz *= k; this.vy *= k;
        this.bumpKick += 1.2;
      } else {
        this.bumpKick += impact * 0.12;
      }
      this.events.push({ type: 'land', impact, air: t, dist, clean, spin: this.spin });
    }
    this.airTime = 0;
    this.airStart = null;
    this.spin = 0;
    void sp; void h; void input;
  }

  // ------------------------------------------------------------------- hazards
  _collide() {
    if (this.crashed) return;
    const T = TUNING;
    const speed = Math.hypot(this.vx, this.vz);
    this.world.queryColliders(this.x, this.z, 0.42, (kind, i, cx, cz, rad, height) => {
      if (this.crashed) return;
      const groundY = this.world.height(cx, cz);
      if (this.y > groundY + height * 0.85) return;          // flying over it
      if (kind === 1 && !this.grounded && this.y > groundY + rad * 1.4) return;
      const dx = this.x - cx, dz = this.z - cz;
      const dist = Math.hypot(dx, dz) || 1e-3;
      if (speed > T.treeSpeed) this.crash(kind === 0 ? 'tree' : 'rock');
      else {
        // gentle bump: push out and lose speed
        const push = rad + 0.42 - dist;
        this.x += (dx / dist) * push; this.z += (dz / dist) * push;
        this.vx *= 0.3; this.vz *= 0.3;
      }
    });
  }

  crash(cause) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = 0;
    this.crashCause = cause;
    this.events.push({ type: 'crash', cause, speed: this.speed });
  }

  _stepCrashed(dt) {
    // tumbling and sliding to a stop
    this.crashTimer += dt;
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    if (this.grounded) {
      const dec = (0.55 * G + 0.02 * sp * sp) * dt;
      const ns = Math.max(sp - dec, 0);
      const k = sp > 1e-4 ? ns / sp : 0;
      this.vx *= k; this.vy *= k; this.vz *= k;
    } else {
      this.vy -= G * dt;
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    const h = this.world.normal(this.x, this.z, _n);
    if (this.y <= h) {
      const vn = this.vx * _n.x + this.vy * _n.y + this.vz * _n.z;
      this.y = h;
      if (vn < 0) { this.vx -= vn * _n.x; this.vy -= vn * _n.y; this.vz -= vn * _n.z; }
      this.grounded = true;
    } else if (this.y - h > 0.3) this.grounded = false;
    this.nx = _n.x; this.ny = _n.y; this.nz = _n.z;
    this.speed = Math.hypot(this.vx, this.vy, this.vz);
    this.compress = damp(this.compress, 0.3, 4, dt);
    this.lean = damp(this.lean, 0, 3, dt);
    this.skidAmount = this.speed > 1 ? 1 : 0;
  }
}

const _pathTmp = {};
