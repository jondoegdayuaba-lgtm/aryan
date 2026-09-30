// Headless test of the open world: loads ski/assets/open, lets a piste follower ski every piste and reports the results.
//   node tools/open-sim.mjs [piste-id|all] [skill]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WorldData, decodePredictedHeights } from '../ski/js/world-data.js';
import { SkierPhysics } from '../ski/js/physics.js';
import { PisteFollower } from '../ski/js/ai.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, 'ski/assets/open') + '/';
const buf = (n) => { const b = fs.readFileSync(base + n); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

export function loadOpen() {
  const info = JSON.parse(fs.readFileSync(base + 'world.json', 'utf8'));
  return new WorldData(info, decodePredictedHeights(new Uint16Array(buf('heightmap.pz')), info.grid.nx, info.grid.nz), new Float32Array(buf('trees.f32')), new Float32Array(buf('rocks.f32')),
    new Float32Array(buf('poles.f32')), new Uint8Array(buf('groom.u8')));
}

export function skiPiste(world, piste, skill = 0.9, opts = {}) {
  const sk = new SkierPhysics(world);
  const ai = new PisteFollower(world, piste, skill);
  const p = piste.sampler.at(piste.sampler.s0 + 4, {});
  sk.reset(p.x, p.z, Math.atan2(p.tx, -p.tz), 0);
  const dt = 1 / 120;
  let t = 0, crashes = 0, respawns = 0, groomedTime = 0, air = 0;
  const log = [];
  while (t < 700 && !ai.done) {
    const inp = ai.control(sk, t);
    inp.autoPush = t < 7 ? 14 : 0;
    sk.step(dt, inp);
    for (const e of sk.events) {
      if (e.type === 'crash') { crashes++; log.push({ t: +t.toFixed(1), s: Math.round(ai.s), cause: e.cause, kmh: Math.round(e.speed * 3.6) }); }
      if (e.type === 'edge') log.push({ t: +t.toFixed(1), edge: true });
    }
    if (sk.crashed && sk.crashTimer > 1.9) {                      // respawn on the piste a little behind the crash
      const q = piste.sampler.at(Math.max(piste.sampler.s0, ai.s - 8), {});
      sk.reset(q.x, q.z, Math.atan2(q.tx, -q.tz), 0);
      ai.hint = Math.max(piste.sampler.s0, ai.s - 8);
      respawns++;
    }
    if (sk.surface === 'groomed') groomedTime += dt;
    t += dt;
    if (opts.trace && Math.floor(t * 120) % (opts.trace * 120) === 0) {
      console.log(`  t=${t.toFixed(0).padStart(3)} s=${ai.s.toFixed(0).padStart(5)} v=${(sk.speed * 3.6).toFixed(0).padStart(3)} km/h off=${ai.off.toFixed(1).padStart(6)} ${sk.surface} ${sk.grounded ? 'gnd' : 'air'}`);
    }
  }
  return { id: piste.id, level: piste.level, finished: ai.done, time: +t.toFixed(1), length: Math.round(piste.sampler.sEnd - piste.sampler.s0), crashes, respawns,
    maxKmh: Math.round(sk.maxSpeed * 3.6), groomedPct: Math.round(100 * groomedTime / Math.max(t, 1)), log };
}

if (process.argv[1] && process.argv[1].endsWith('open-sim.mjs')) {
  const world = loadOpen();
  const which = process.argv[2] || 'all';
  const skill = +(process.argv[3] || 0.9);
  const trace = process.argv.includes('--trace') ? +process.argv[process.argv.indexOf('--trace') + 1] : 0;
  console.log(`open world ${world.nx}x${world.nz} at ${world.dx} m, ${world.trees.length / 6} trees, ${world.rocks.length / 6} rocks, ${world.pistes.length} pistes`);
  for (const p of world.pistes) {
    if (which !== 'all' && p.id !== which) continue;
    const r = skiPiste(world, p, skill, { trace });
    console.log(`${r.id.padEnd(11)} ${r.level.padEnd(5)} ${r.finished ? 'finished' : 'TIMEOUT '} ${String(r.time).padStart(6)} s  ${String(r.length).padStart(5)} m  top ${String(r.maxKmh).padStart(3)} km/h  groomed ${String(r.groomedPct).padStart(3)}%  crashes ${r.crashes}`);
    if (r.log.length) console.log('   ', JSON.stringify(r.log));
  }
}
