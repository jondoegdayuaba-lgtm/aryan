// Checkpoints, laps and the clock. The clock counts physics steps, so a run
// times the same at any frame rate, and each crossing is interpolated within
// its step for millisecond precision.
import { KERB } from './path.js';

// Did the car cross gate g between positions a and b (forwards)? Returns the
// fraction of the step at which it crossed, or -1.
export function crossing(g, a, b) {
  const da = (a.x - g.x) * g.tx + (a.z - g.z) * g.tz;
  const db = (b.x - g.x) * g.tx + (b.z - g.z) * g.tz;
  if (!(da < 0 && db >= 0)) return -1;
  const f = da / (da - db);
  const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
  const lat = (x - g.x) * g.rx + (z - g.z) * g.rz;
  const h = y - (g.y + lat * Math.tan(g.bank));
  if (Math.abs(lat) > g.hw + KERB + 2.5 || h < -3 || h > 12) return -1;
  return f;
}

export class Race {
  constructor(path) {
    this.path = path;
    this.cps = path.checkpoints;
    this.laps = path.laps;
    this.total = this.cps.length * this.laps;     // checkpoints in the whole run
    this.reset();
  }

  reset() {
    this.time = 0;
    this.started = false;
    this.done = false;
    this.lap = 1;
    this.next = 0;          // next checkpoint within this lap
    this.passed = 0;        // checkpoints passed in the whole run
    this.splits = [];       // time at every checkpoint, lap line and the finish
    this.respawn = null;    // the last gate passed
    this.finalTime = 0;
  }

  // Advance the clock by one physics step in which the car moved from a to b.
  step(dt, a, b) {
    if (!this.started || this.done) return null;
    const t0 = this.time;
    this.time += dt;
    if (this.next < this.cps.length) {
      const g = this.cps[this.next];
      const f = crossing(g, a, b);
      if (f < 0) return null;
      const at = t0 + f * dt;
      this.next++;
      this.passed++;
      this.splits.push(at);
      this.respawn = g;
      return { type: 'checkpoint', at, index: this.splits.length - 1 };
    }
    const f = crossing(this.path.finish, a, b);
    if (f < 0) return null;
    const at = t0 + f * dt;
    this.splits.push(at);
    if (this.lap < this.laps) {
      this.lap++;
      this.next = 0;
      this.respawn = this.path.finish;
      return { type: 'lap', at, index: this.splits.length - 1, lap: this.lap };
    }
    this.done = true;
    this.finalTime = at;
    return { type: 'finish', at, index: this.splits.length - 1 };
  }
}

// mm:ss.mmm
export function formatTime(t) {
  if (!(t >= 0) || !isFinite(t)) return '--:--.---';
  const ms = Math.floor(t * 1000 + 1e-6);
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

// +1.234 / -0.056
export function formatDiff(d) {
  const sign = d < 0 ? '-' : '+';
  const ms = Math.floor(Math.abs(d) * 1000 + 1e-6);
  const s = Math.floor(ms / 1000), r = ms % 1000;
  return `${sign}${s}.${String(r).padStart(3, '0')}`;
}
