// Arcade car physics. Pure maths with no rendering, so the track checker can
// drive it headless. Positions are the point where the car meets the road.
import * as THREE from 'three';
import { CAR } from './config.js';
import { WALL_T } from './path.js';
import { obstaclesFor } from './obstacles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const _n = new THREE.Vector3();

export class CarBody {
  constructor(path) {
    this.path = path;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(-1, 0, 0);
    this.probe = {};
    this.wallProbe = {};
    this.obstacles = obstaclesFor(path);
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.steer = 0;
    this.grounded = true;
    this.air = 0;
    this.onRoad = true;
    this.slip = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.landing = 0;        // impact speed of the last landing (cleared by the game)
    this.wallHit = 0;        // strongest wall hit since last cleared...
    this.wallNx = 0;         // ...and the way that wall faces
    this.wallNz = 0;
    this.lost = false;       // no road anywhere near
    this.pad = null;         // the boost pad under the car, if any
    this.boostT = 0;         // seconds of boost glow left (for flames and sound)
    this.boosted = 0;        // set when a pad fires (cleared by the game)
    this.path.probe(this.pos, this.probe);
    this.pos.y = this.probe.height;
    this.normal.set(this.probe.nx, this.probe.ny, this.probe.nz);
    this.trackS = this.probe.road ? this.probe.s : this.probe.nearS;
    this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
  }

  // ctl: { throttle 0..1, brake 0..1, steer -1..1 (positive = right), handbrake }
  // t is the race clock, which moves the obstacles.
  step(dt, ctl, t = 0) {
    const c = CAR, pr = this.probe;

    // The steering wheel eases toward the input and centres faster than it turns.
    const want = clamp(ctl.steer, -1, 1);
    const ease = Math.abs(want) < Math.abs(this.steer) || want * this.steer < 0 ? c.steerReturn : c.steerSpeed;
    this.steer += clamp(want - this.steer, -ease * dt, ease * dt);

    this.path.probe(this.pos, pr);
    _n.set(pr.nx, pr.ny, pr.nz);
    const gap = this.pos.y - pr.height;
    const vn = this.vel.dot(_n);
    // Stay glued over gentle crests; leave the ground off ramp lips and big drops.
    // Over a crest taken fast enough, the road falls away quicker than gravity
    // can pull the car down after it: airtime.
    const crest = this.grounded && pr.road && pr.ky < 0 && this.vel.lengthSq() * -pr.ky > c.gravity * 1.3;
    const contact = !crest && (gap <= 0.02 || (this.grounded && gap < 0.5 && vn < 5));

    if (contact) {
      if (!this.grounded) this.landing = Math.max(this.landing, -vn);
      this.pos.y = pr.height;
      this.vel.addScaledVector(_n, -vn);
      this.grounded = true;
      this.air = 0;
      this.normal.copy(_n);
      this.onRoad = pr.onRoad;
      this.drive(dt, ctl, _n, pr.onRoad);
      // Boost pads kick the car past its top speed; the extra fades away.
      const pad = pr.road ? this.path.padAt(pr.s, pr.lat) : null;
      if (pad && pad !== this.pad) {
        const vF = this.vel.dot(this.forward);
        if (vF > -1) {
          const target = Math.min(c.topSpeed * c.boostMax, Math.max(vF, c.topSpeed) + c.boostKick);
          this.vel.addScaledVector(this.forward, target - vF);
          this.boostT = 1.2;
          this.boosted = target - vF;
        }
      }
      this.pad = pad;
    } else {
      this.grounded = false;
      this.air += dt;
      this.vel.y -= c.gravity * dt;
      this.yawRate += (-this.steer * c.airSteer - this.yawRate) * (1 - Math.exp(-dt * 4));
      this.yaw += this.yawRate * dt;
      this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.right.set(-this.forward.z, 0, this.forward.x);
      this.slip = 0;
      this.pad = null;
    }
    this.boostT = Math.max(0, this.boostT - dt);

    this.pos.addScaledVector(this.vel, dt);
    this.collideWalls();
    if (this.obstacles) this.obstacles.collide(this, t);

    this.speed = this.vel.length();
    this.forwardSpeed = this.vel.dot(this.forward);
    if (pr.road) this.trackS = pr.s;
    else if (pr.nearIndex >= 0) this.trackS = pr.nearS;
    this.lost = pr.nearIndex < 0;
  }

  drive(dt, ctl, n, road) {
    const c = CAR;
    const f = this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const r = this.right.crossVectors(f, n);
    let vF = this.vel.dot(f);
    let vR = this.vel.dot(r);
    const top = road ? c.topSpeed : c.grassTopSpeed;
    const gas = ctl.throttle, brk = ctl.brake;

    // Engine, brakes and reverse.
    if (brk > 0 && vF > 0.5) vF = Math.max(0, vF - c.brake * brk * dt);
    else if (gas > 0 && vF < -0.5) vF = Math.min(0, vF + c.brake * gas * dt);
    else if (gas > 0 && vF < top) vF = Math.min(top, vF + c.accel * Math.pow(1 - Math.max(0, vF) / top, c.accelCurve) * gas * dt);
    else if (brk > 0 && vF > -c.reverseSpeed) vF = Math.max(-c.reverseSpeed, vF - c.reverseAccel * brk * dt);

    // Rolling resistance and engine braking; grass slows you right down.
    const roll = ((gas > 0 ? 0.015 : 0.22) * vF + Math.sign(vF) * (road ? 0.5 : 3)) * dt;
    vF = Math.abs(roll) >= Math.abs(vF) ? 0 : vF - roll;
    if (Math.abs(vF) > top) vF -= (vF - Math.sign(vF) * top) * (road ? 0.6 : 2.5) * dt;
    vF -= c.gravity * f.y * dt;                 // hills

    // Tyres cancel sideways sliding. A car that's already sliding keeps sliding a bit.
    const hand = ctl.handbrake && Math.abs(vF) > 5;
    let grip = hand ? c.driftGrip : c.grip;
    if (!road) grip *= c.grassGrip;
    if (Math.abs(vR) > c.slideAt) grip *= c.slideGrip;
    vR *= Math.exp(-grip * dt);
    if (hand) vF -= Math.sign(vF) * 5 * dt;
    this.slip = vR;

    // Steering turns the car; the velocity follows through the tyres.
    const sp = Math.abs(vF);
    let rate = lerp(c.steerRate, c.steerRateTop, Math.min(1, sp / c.topSpeed)) * Math.min(1, sp / 6);
    if (hand) rate *= c.driftSteer;
    const target = -this.steer * rate * (vF < -0.5 ? -1 : 1);
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-dt * 12));
    this.yaw += this.yawRate * dt;

    this.vel.copy(f).multiplyScalar(vF).addScaledVector(r, vR);
  }

  collideWalls() {
    const w = this.wallProbe;
    this.path.probe(this.pos, w);
    const half = CAR.halfWidth;
    if (w.wall) {
      const inner = w.wallIn - half;            // furthest the centre can go inside
      const outer = w.wallIn + WALL_T + half;   // closest it can come from outside
      const a = Math.abs(w.wallLat);
      if (a > inner && a < outer) {
        const side = Math.sign(w.wallLat) || 1;
        const inside = a < (inner + outer) / 2;
        this.pushOff(w.wallRx, w.wallRz, side, (inside ? inner : outer) - a, inside ? -1 : 1, w.wallTx, w.wallTz);
      }
    }
    // The solid side of a raised stretch of road, hit from the grass beside it.
    if (w.side) {
      const a = Math.abs(w.sideLat), lim = w.sideW + half;
      if (a < lim) this.pushOff(w.sideRx, w.sideRz, Math.sign(w.sideLat) || 1, lim - a, 1, w.sideTx, w.sideTz);
    }
  }

  // Move the car `push` metres along the road's right vector (r) times `side`,
  // and bounce it off a surface facing r * side * facing.
  pushOff(rx, rz, side, push, facing, tx, tz) {
    this.pos.x += rx * side * push;
    this.pos.z += rz * side * push;
    const nx = rx * side * facing, nz = rz * side * facing;
    const into = this.vel.x * nx + this.vel.z * nz;
    if (into >= 0) return;
    this.vel.x -= nx * into * 1.3;
    this.vel.z -= nz * into * 1.3;
    const hit = -into;
    const keep = Math.max(0.55, 1 - hit * 0.012);
    this.vel.x *= keep;
    this.vel.z *= keep;
    this.wallHit = Math.max(this.wallHit, hit);
    this.wallNx = nx;
    this.wallNz = nz;
    // Glancing blows straighten the car up along the wall.
    let along = Math.atan2(tx, tz);
    if (Math.cos(angDiff(along, this.yaw)) < 0) along += Math.PI;
    this.yaw += angDiff(along, this.yaw) * Math.min(0.6, 0.15 + hit * 0.03);
    this.yawRate *= 0.5;
  }

  // Orientation for drawing: heading plus the surface (or level in the air).
  pose(outQuat, up = this.grounded ? this.normal : null) {
    const f = _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const u = _u.copy(up || UP);
    f.addScaledVector(u, -f.dot(u)).normalize();
    _l.crossVectors(u, f);
    _m.makeBasis(_l, u, f);
    return outQuat.setFromRotationMatrix(_m);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3(), _m = new THREE.Matrix4();
