// One race attempt: physics + course rules + crash handling. Shared by the game and the Node simulator.
import { SkierPhysics } from './physics.js';
import { Course, PENALTY_CRASH } from './course.js';

const STEP = 1 / 120;
const CRASH_TIME = 1.9;

export class RunSession {
  constructor(world, run) {
    this.world = world;
    this.run = run;
    this.skier = new SkierPhysics(world);
    this.course = new Course(world, run);
    this.acc = 0;
    this.events = [];
    this.time = 0;
    this.lastSafe = null;
    this.coasting = 0;
    this.restart();
  }

  restart() {
    const c = this.course;
    c.reset();
    const p = c.startPose();
    this.skier.hintS = this.run.sStart;
    this.skier.reset(p.x, p.z, p.yaw, 0);
    this.skier.maxAir = 0;
    this.skier.maxSpeed = 0;
    this.skier.distance = 0;
    this.skier._surface(p.x, p.z);
    this.events.length = 0;
    this.coasting = 0;
  }

  begin() {
    this.course.begin();
  }

  /**
   * @param dt frame time (s)
   * @param control () => input  called once per physics step
   * @returns events since the last call
   */
  update(dt, control) {
    const out = this.events;
    out.length = 0;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this._step(STEP, control, out);
    }
    return out;
  }

  _step(h, control, out) {
    const sk = this.skier, c = this.course;
    if (c.state === 'ready' || c.state === 'countdown') {
      const ev = c.update(h, sk);
      for (const e of ev) out.push(e);
      sk.step(h, { steer: 0, tuck: 0, brake: 1 });     // held in the gate
      sk.vx = sk.vy = sk.vz = 0;
      return;
    }
    let input = control(sk, c);
    if (c.state === 'finished') {                       // coast out and stop
      this.coasting += h;
      input = { steer: 0, tuck: 0, brake: 0.9 };
    }
    sk.step(h, input);
    for (const e of sk.events) {
      out.push(e);
      if (e.type === 'crash' && c.state === 'running') c.crashes++;
    }
    const ev = c.update(h, sk);
    for (const e of ev) out.push(e);
    if (sk.crashed && sk.crashTimer > CRASH_TIME && c.state === 'running') this.respawn(out);
    else if (sk.crashed && c.state === 'finished' && sk.crashTimer > CRASH_TIME) sk.crashed = false;
  }

  /** put the skier back on the piste behind the crash site */
  respawn(out = this.events) {
    const sk = this.skier, c = this.course;
    const path = this.world.path;
    const s = Math.max(c.run.sStart - 2, sk.pathS - 9);
    const p = path.at(s, {});
    const yaw = Math.atan2(p.tx, -p.tz);
    sk.reset(p.x, p.z, yaw, 0);
    sk.hintS = s;
    sk._surface(p.x, p.z);
    // gates skipped by falling behind them stay skipped; make sure we never re-count earlier ones
    out.push(c.addPenalty(PENALTY_CRASH, 'crash'));
    out.push({ type: 'respawn', s });
  }
}

export { STEP };
