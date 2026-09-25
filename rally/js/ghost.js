// Ghost cars: your best run on each stage is recorded ten times a second and
// replayed as a translucent car the next time you drive it.

const RATE = 10;
const STRIDE = 8;   // x y z qx qy qz qw steer

export class GhostRecorder {
  constructor() { this.data = []; this.next = 0; }

  start() { this.data = []; this.next = 0; }

  sample(t, car) {
    while (t >= this.next) {
      const q = car.quat, p = car.pos;
      this.data.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, car.steerAngle);
      this.next += 1 / RATE;
    }
  }

  // Compact string for localStorage: float32 packed as base64.
  pack(meta) {
    const f = new Float32Array(this.data);
    const bytes = new Uint8Array(f.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return JSON.stringify({ ...meta, rate: RATE, f: btoa(bin) });
  }
}

export function unpackGhost(str) {
  try {
    const o = JSON.parse(str);
    const bin = atob(o.f);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    o.frames = new Float32Array(bytes.buffer);
    return o.frames.length >= STRIDE * 2 ? o : null;
  } catch {
    return null;
  }
}

// Drives a CarVisual from recorded frames.
export class GhostPlayer {
  constructor(ghost, visual) {
    this.g = ghost;
    this.visual = visual;
    this.count = ghost.frames.length / STRIDE;
    this.pos = { x: 0, y: 0, z: 0 };
  }

  get duration() { return (this.count - 1) / this.g.rate; }

  update(t) {
    const f = this.g.frames;
    const u = Math.min(this.count - 1.001, Math.max(0, t * this.g.rate));
    const i = Math.floor(u), a = u - i;
    const o = i * STRIDE, o2 = o + STRIDE;
    const lerp = (k) => f[o + k] + (f[o2 + k] - f[o + k]) * a;
    const root = this.visual.root;
    root.position.set(lerp(0), lerp(1), lerp(2));
    // nlerp is fine at 10 Hz
    let qx = lerp(3), qy = lerp(4), qz = lerp(5), qw = lerp(6);
    if (f[o + 3] * f[o2 + 3] + f[o + 4] * f[o2 + 4] + f[o + 5] * f[o2 + 5] + f[o + 6] * f[o2 + 6] < 0) {
      qx = f[o + 3] - (f[o2 + 3] + f[o + 3]) * a; qy = f[o + 4] - (f[o2 + 4] + f[o + 4]) * a;
      qz = f[o + 5] - (f[o2 + 5] + f[o + 5]) * a; qw = f[o + 6] - (f[o2 + 6] + f[o + 6]) * a;
    }
    root.quaternion.set(qx, qy, qz, qw).normalize();
    const steer = lerp(7);
    // wheels: roll with the distance covered
    const speed = Math.hypot(f[o2] - f[o], f[o2 + 2] - f[o + 2]) * this.g.rate;
    this.visual.wheels.forEach((w, k) => {
      if (k < 2) w.pivot.rotation.y = steer;
      w.spin.rotation.x += speed / this.visual.spec.wheelRadius / 60;
    });
    this.pos.x = root.position.x; this.pos.y = root.position.y; this.pos.z = root.position.z;
    return this.pos;
  }
}
