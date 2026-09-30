// Race logic: countdown, gate-plane crossings, splits, penalties and the finish line.
// Pure JS (no three.js).
import { clamp } from './util.js';

export const PENALTY_MISSED_GATE = 3.0;
export const PENALTY_CRASH = 4.0;
const COUNTDOWN = 3.0;

export class Course {
  /** @param world WorldData  @param run entry of world.runs */
  constructor(world, run) {
    this.world = world;
    this.run = run;
    this.gates = run.gates.map((g, i) => ({
      ...g,
      index: i,
      rx: -g.tz,
      rz: g.tx,
      state: 'pending',      // pending | passed | missed
      hit: false,
    }));
    const path = world.path;
    const fin = path.at(run.sEnd, {});
    this.finish = { x: fin.x, z: fin.z, tx: fin.tx, tz: fin.tz, rx: -fin.tz, rz: fin.tx, half: fin.width * 0.5 + 25 };
    const st = path.at(run.sStart, {});
    this.start = { x: st.x, z: st.z, tx: st.tx, tz: st.tz };
    this.length = run.sEnd - run.sStart;
    this.slalom = run.mode === 'slalom';
    this.reset();
  }

  reset() {
    this.state = 'ready';            // ready | countdown | running | finished
    this.clock = 0;                  // seconds since GO
    this.countdown = COUNTDOWN;
    this.penalty = 0;
    this.nextGate = 0;
    this.passed = 0;
    this.missed = 0;
    this.splits = [];
    this.crashes = 0;
    this.progress = 0;
    this.finishTime = null;
    this._prev = null;
    this._counted = -1;
    for (const g of this.gates) { g.state = 'pending'; g.hit = false; }
  }

  /** start position and heading for the skier */
  startPose() {
    const back = 5.0;
    const yaw = Math.atan2(this.start.tx, -this.start.tz);
    return { x: this.start.x - this.start.tx * back, z: this.start.z - this.start.tz * back, yaw };
  }

  begin() {
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this._counted = -1;
  }

  get time() {
    return this.finishTime ?? this.clock + this.penalty;
  }

  addPenalty(sec, reason) {
    this.penalty += sec;
    return { type: 'penalty', sec, reason };
  }

  /** advance; returns a list of events */
  update(dt, sk) {
    const ev = [];
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const whole = Math.ceil(this.countdown);
      if (whole !== this._counted && whole > 0) { this._counted = whole; ev.push({ type: 'count', n: whole }); }
      if (this.countdown <= 0) { this.state = 'running'; this.clock = -this.countdown; ev.push({ type: 'go' }); }
    } else if (this.state === 'running') {
      this.clock += dt;
    }
    if (this.state === 'running' || this.state === 'finished') {
      this._gates(sk, ev);
    }
    if (this.state === 'running') {
      this.progress = clamp((sk.pathS - this.run.sStart) / this.length, 0, 1);
      this._finishLine(sk, ev);
    }
    this._prev = { x: sk.x, z: sk.z };
    return ev;
  }

  _gates(sk, ev) {
    if (!this._prev || this.state !== 'running') return;
    const p0 = this._prev;
    while (this.nextGate < this.gates.length) {
      const g = this.gates[this.nextGate];
      const d0 = (p0.x - g.x) * g.tx + (p0.z - g.z) * g.tz;
      const d1 = (sk.x - g.x) * g.tx + (sk.z - g.z) * g.tz;
      if (d1 < 0) break;                                     // not there yet
      // crossed (or skipped) this gate
      let lateral = 999;
      if (d0 < 0 && d1 >= 0) {
        const a = -d0 / (d1 - d0);
        const cx = p0.x + (sk.x - p0.x) * a, cz = p0.z + (sk.z - p0.z) * a;
        lateral = (cx - g.x) * g.rx + (cz - g.z) * g.rz;
      } else {
        lateral = (sk.x - g.x) * g.rx + (sk.z - g.z) * g.rz;
      }
      const ok = Math.abs(lateral) <= g.open;
      this.nextGate++;
      if (ok) {
        g.state = 'passed';
        this.passed++;
        if (this.slalom) ev.push({ type: 'gate', index: g.index, ok: true });
        else {
          const split = { index: g.index, time: this.clock + this.penalty, s: g.s };
          this.splits.push(split);
          ev.push({ type: 'split', ...split, total: this.gates.length });
        }
      } else {
        g.state = 'missed';
        this.missed++;
        if (this.slalom) {
          ev.push({ type: 'gate', index: g.index, ok: false });
          ev.push(this.addPenalty(PENALTY_MISSED_GATE, 'missed gate'));
        } else {
          ev.push({ type: 'checkpoint-missed', index: g.index });
        }
      }
    }
  }

  _finishLine(sk, ev) {
    const f = this.finish;
    const p0 = this._prev;
    if (!p0) return;
    const d0 = (p0.x - f.x) * f.tx + (p0.z - f.z) * f.tz;
    const d1 = (sk.x - f.x) * f.tx + (sk.z - f.z) * f.tz;
    if (d0 < 0 && d1 >= 0) {
      const lateral = (sk.x - f.x) * f.rx + (sk.z - f.z) * f.rz;
      if (Math.abs(lateral) < f.half) {
        // sub-step interpolation of the crossing time
        this.state = 'finished';
        this.progress = 1;
        this.finishTime = this.clock + this.penalty;
        ev.push({ type: 'finish', time: this.finishTime, raw: this.clock, penalty: this.penalty });
      }
    }
  }

  medal(time = this.finishTime) {
    if (time == null) return null;
    const [bronze, silver, gold] = this.run.medals;
    if (time <= gold) return 'gold';
    if (time <= silver) return 'silver';
    if (time <= bronze) return 'bronze';
    return null;
  }
}
