// A simple robot driver, used for the demo laps behind the menu and by the
// track checker. It chases a point on the centre line ahead and brakes for
// corners it can't take flat out.
import { CAR, PHYSICS_HZ } from './config.js';
import { CarBody } from './physics.js';
import { Race } from './race.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const turnRate = (v) => lerp(CAR.steerRate, CAR.steerRateTop, Math.min(1, v / CAR.topSpeed));

// Fastest speed at which the car can still turn as tightly as curvature k needs.
function cornerSpeed(k, margin) {
  if (k < 1e-4) return CAR.topSpeed;
  for (let v = CAR.topSpeed; v > 8; v -= 0.5) if (turnRate(v) >= k * v * margin) return v;
  return 8;
}

export class Autopilot {
  constructor(path, { margin = 1.25, caution = 1 } = {}) {
    this.path = path;
    this.caution = caution;
    this.limit = path.samples.map((o) => cornerSpeed(Math.abs(o.curv), margin));
    this.pt = {};
  }

  drive(body, ctl) {
    const path = this.path, S = path.samples;
    const v = Math.max(0, body.forwardSpeed);
    const s = body.trackS;

    // Speed: brake now if any corner ahead can't be reached slowly enough.
    const decel = CAR.brake * 0.75 / this.caution;
    let allowed = CAR.topSpeed;
    const k0 = Math.floor(s / path.step);
    const look = Math.ceil((v * v / (2 * decel) + 30) / path.step);
    for (let j = 0; j <= look; j++) {
      let k = k0 + j;
      if (path.closed) k %= S.length; else if (k >= S.length) break;
      const d = Math.max(0, j * path.step - (s - k0 * path.step));
      allowed = Math.min(allowed, Math.sqrt(this.limit[k] ** 2 + 2 * decel * d));
    }

    // Steering: pure pursuit toward a point ahead on the centre line.
    const L = 7 + v * 0.42;
    const p = path.at(s + L, this.pt);
    const dx = p.x - body.pos.x, dz = p.z - body.pos.z;
    const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw);
    const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);   // positive = target on the right
    const want = (2 * Math.max(v, 6) * Math.sin(ang)) / L;
    ctl.steer = clamp(want / (turnRate(Math.max(v, 6)) * Math.min(1, Math.max(v, 6) / 6)), -1, 1);
    ctl.handbrake = false;

    if (!body.grounded) {
      ctl.throttle = 1;
      ctl.brake = 0;
      ctl.steer = 0;
    } else if (v > allowed + 0.5) {
      ctl.throttle = 0;
      ctl.brake = 1;
    } else {
      ctl.throttle = v > allowed - 1 ? 0.4 : 1;
      ctl.brake = 0;
    }
    return ctl;
  }
}

// A whole robot run round a track, advanced a slice at a time so a browser
// can spread it over several frames. Like a player, the robot goes back to
// the last checkpoint if it falls off or gets stuck.
export class RobotRun {
  constructor(path, { margin, maxTime = 240, trace = false } = {}) {
    this.path = path;
    this.maxTime = maxTime;
    this.body = new CarBody(path);
    this.race = new Race(path);
    this.bot = new Autopilot(path, margin ? { margin } : {});
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.prev = { x: 0, y: 0, z: 0 };
    this.at = {};
    this.respawns = 0;
    this.fails = [];
    this.top = 0;
    this.airMax = 0;
    this.trace = trace ? [] : null;
    this.low = 0;
    this.stuck = 0;
    this.spawn(path.spawnS);
    this.race.started = true;
  }

  spawn(s) {
    const p = this.path.at(s, this.at);
    this.body.reset({ x: p.x, y: p.y + 0.5, z: p.z }, p.yaw);
  }

  get finished() { return this.race.done || this.race.time >= this.maxTime; }

  // Simulate up to `steps` physics steps; returns true once the run is over.
  advance(steps) {
    const dt = 1 / PHYSICS_HZ, body = this.body, race = this.race;
    for (let n = 0; n < steps && !this.finished; n++) {
      this.bot.drive(body, this.ctl);
      this.prev.x = body.pos.x; this.prev.y = body.pos.y; this.prev.z = body.pos.z;
      body.step(dt, this.ctl);
      race.step(dt, this.prev, body.pos);
      this.top = Math.max(this.top, body.speed);
      this.airMax = Math.max(this.airMax, body.air);
      if (this.trace && Math.round(race.time * PHYSICS_HZ) % 12 === 0) this.trace.push([body.pos.x, body.pos.z, body.speed]);
      // Fell off (on the grass while the road here is up in the air) or stuck.
      const roadY = this.path.at(body.trackS, this.at).y;
      this.low = body.grounded && !body.probe.road && roadY > 2 ? this.low + dt : 0;
      this.stuck = body.speed < 2 ? this.stuck + dt : 0;
      if (this.low > 0.5 || this.stuck > 3 || body.lost) {
        this.respawns++;
        this.fails.push({ why: body.lost ? 'lost' : this.low > 0.5 ? 'fell' : 'stuck', s: body.trackS, t: race.time });
        const g = race.respawn;
        this.spawn(g ? g.s + 4 : this.path.spawnS);
        this.low = this.stuck = 0;
      }
    }
    return this.finished;
  }

  get result() {
    const race = this.race;
    return {
      done: race.done, time: race.done ? race.finalTime : race.time, respawns: this.respawns, fails: this.fails,
      top: this.top, airMax: this.airMax, splits: race.splits, trace: this.trace,
    };
  }
}
