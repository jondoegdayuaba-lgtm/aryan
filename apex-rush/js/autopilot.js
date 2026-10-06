// A simple robot driver, used for the demo laps behind the menu and by the
// track checker. It chases a point on the centre line ahead and brakes for
// corners it can't take flat out.
import { CAR } from './config.js';

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
