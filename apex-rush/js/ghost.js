// Records the car's pose a few times a second and plays it back as a
// see-through ghost. Stored as one flat list of rounded numbers.
const POS = 100, ROT = 1000;    // rounding: centimetres, thousandths

export class GhostRecorder {
  constructor(rate) {
    this.rate = rate;
    this.reset();
  }

  reset() {
    this.data = [];
    this.next = 0;
  }

  // Call every physics step with the race time and the car's drawn pose.
  push(time, pos, quat) {
    if (time + 1e-9 < this.next) return;
    this.next += 1 / this.rate;
    this.data.push(
      Math.round(pos.x * POS) / POS, Math.round(pos.y * POS) / POS, Math.round(pos.z * POS) / POS,
      Math.round(quat.x * ROT) / ROT, Math.round(quat.y * ROT) / ROT, Math.round(quat.z * ROT) / ROT, Math.round(quat.w * ROT) / ROT,
    );
  }

  export() {
    return { rate: this.rate, d: this.data.slice() };
  }
}

export class GhostPlayer {
  constructor(ghost) {
    this.rate = ghost.rate;
    this.d = ghost.d;
    this.frames = Math.floor(this.d.length / 7);
  }

  // Pose at race time t. Returns false once the ghost has finished.
  sample(t, pos, quat, qa, qb) {
    if (this.frames < 2) return false;
    const f = t * this.rate;
    let i = Math.floor(f);
    if (i >= this.frames - 1) i = this.frames - 2;
    const k = Math.min(1, f - i), d = this.d, a = i * 7, b = a + 7;
    pos.set(d[a] + (d[b] - d[a]) * k, d[a + 1] + (d[b + 1] - d[a + 1]) * k, d[a + 2] + (d[b + 2] - d[a + 2]) * k);
    qa.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]).normalize();
    qb.set(d[b + 3], d[b + 4], d[b + 5], d[b + 6]).normalize();
    quat.slerpQuaternions(qa, qb, k);
    return f < this.frames;
  }
}
