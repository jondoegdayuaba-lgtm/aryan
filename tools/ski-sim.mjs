// Headless simulation of Alpine Descent runs with the autopilot (no browser needed).
//   node tools/ski-sim.mjs [run-id|all] [skill]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WorldData, decodePredictedHeights } from '../ski/js/world-data.js';
import { RunSession } from '../ski/js/session.js';
import { Autopilot } from '../ski/js/ai.js';
import { formatTime } from '../ski/js/util.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, 'ski/assets/world') + '/';
const f32 = (n) => { const b = fs.readFileSync(base + n); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const info = JSON.parse(fs.readFileSync(base + 'world.json', 'utf8'));
const hb = fs.readFileSync(base + 'heightmap.pz');
const heights = decodePredictedHeights(new Uint16Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength)), info.grid.nx, info.grid.nz);
const world = new WorldData(info, heights, f32('trees.f32'), f32('rocks.f32'), f32('poles.f32'));

export function simulate(runId, skill = 1.0, opts = {}) {
  const run = world.runs.find((r) => r.id === runId);
  const session = new RunSession(world, run);
  const ai = new Autopilot(world, session.course, skill);
  session.begin();
  const log = { crashes: [], events: [] };
  let t = 0;
  const dt = 1 / 60;
  while (t < 400 && !(session.course.state === 'finished' && session.coasting > 3)) {
    const ev = session.update(dt, (sk) => ai.control(sk, t));
    for (const e of ev) {
      if (e.type === 'crash') log.crashes.push({ t: +t.toFixed(1), cause: e.cause, s: Math.round(session.skier.pathS), speed: +(e.speed * 3.6).toFixed(0) });
      if (opts.verbose && ['gate', 'split', 'finish', 'go', 'land', 'takeoff'].includes(e.type)) log.events.push({ t: +t.toFixed(2), ...e });
    }
    t += dt;
    if (opts.trace && Math.floor(t * 60) % (opts.trace * 60) === 0) {
      const sk = session.skier;
      console.log(`t=${t.toFixed(0).padStart(3)} s=${sk.pathS.toFixed(0).padStart(4)} v=${(sk.speed * 3.6).toFixed(0).padStart(3)}km/h off=${sk.pathT.toFixed(1).padStart(6)} slip=${(sk.slip * 57.3).toFixed(0).padStart(4)} ${sk.grounded ? 'gnd' : 'air'} ${sk.crashed ? 'CRASHED' : ''}`);
    }
  }
  const c = session.course, sk = session.skier;
  return {
    run: runId, state: c.state, time: c.finishTime, clock: c.clock, penalty: c.penalty,
    passed: c.passed, missed: c.missed, gates: c.gates.length, crashes: c.crashes,
    maxKmh: +(sk.maxSpeed * 3.6).toFixed(0), maxAir: +sk.maxAir.toFixed(2), progress: +c.progress.toFixed(2),
    crashLog: log.crashes, events: log.events,
  };
}

if (process.argv[1] && process.argv[1].endsWith('ski-sim.mjs')) {
  const which = process.argv[2] || 'all';
  const skill = +(process.argv[3] || 1.0);
  const trace = process.argv.includes('--trace') ? +process.argv[process.argv.indexOf('--trace') + 1] : 0;
  const ids = which === 'all' ? world.runs.map((r) => r.id) : [which];
  for (const id of ids) {
    const r = simulate(id, skill, { trace, verbose: process.argv.includes('--verbose') });
    console.log(`${id.padEnd(9)} ${r.state.padEnd(9)} time ${r.time != null ? formatTime(r.time) : '--'} (clock ${formatTime(r.clock)} +${r.penalty.toFixed(0)}s) gates ${r.passed}/${r.gates} missed ${r.missed} crashes ${r.crashes} top ${r.maxKmh} km/h air ${r.maxAir}s progress ${r.progress}`);
    if (r.crashLog.length) console.log('   crashes:', JSON.stringify(r.crashLog));
  }
}
