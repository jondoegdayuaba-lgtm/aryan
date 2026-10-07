// Checks every Apex Rush track and times a robot driver round it.
//   npm run check:tracks              summary table
//   npm run check:tracks -- --svg out writes a top-down map of each track to out/
// It also checks the track editor's example track.
// Reports tight corners, steep slopes, roads that overlap without enough
// headroom, and whether the robot can finish (it has to clear every jump).
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = resolve(root, 'apex-rush');
const svgDir = process.argv.includes('--svg') ? resolve(process.argv[process.argv.indexOf('--svg') + 1]) : null;
const only = process.argv.includes('--track') ? process.argv[process.argv.indexOf('--track') + 1] : null;

const result = await build({
  stdin: {
    contents: `
      export { TrackPath, KERB } from './js/path.js';
      export { formatTime } from './js/race.js';
      export { RobotRun } from './js/autopilot.js';
      export { TRACKS } from './js/tracks.js';
      export { traceTrack, exampleTrack } from './js/pieces.js';`,
    resolveDir: game,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { three: resolve(root, 'vendor/three/three.module.js') },
  write: false,
  logLevel: 'warning',
});
const lib = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const { TrackPath, KERB, formatTime, RobotRun, TRACKS, traceTrack, exampleTrack } = lib;

function inspect(path) {
  const S = path.samples, issues = [];
  let maxCurv = 0, maxGrade = 0;
  S.forEach((o, k) => {
    maxCurv = Math.max(maxCurv, Math.abs(o.curv));
    const b = S[(k + 1) % S.length];
    if (k < path.segCount && !o.gap) maxGrade = Math.max(maxGrade, Math.abs(b.y - o.y) / path.step);
    if (!o.gap && Math.abs(o.curv) > 0 && 1 / Math.abs(o.curv) < o.hw + KERB + 2) {
      issues.push(`corner tighter than the road is wide at s=${o.s.toFixed(0)}`);
    }
  });
  // Overlaps: two stretches of road far apart along the track but close on the map.
  const seen = new Set();
  for (let i = 0; i < S.length; i += 2) {
    for (let j = i + 2; j < S.length; j += 2) {
      const a = S[i], b = S[j];
      let ds = Math.abs(a.s - b.s);
      if (path.closed) ds = Math.min(ds, path.length - ds);
      if (ds < 60 || a.gap || b.gap) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > a.hw + b.hw + 2 * KERB + 4) continue;
      const dy = Math.abs(a.y - b.y);
      const tag = `${Math.round(a.s / 50)}-${Math.round(b.s / 50)}`;
      if (dy < 7 && !seen.has(tag)) {
        seen.add(tag);
        issues.push(`roads overlap at s=${a.s.toFixed(0)} and s=${b.s.toFixed(0)} (height gap ${dy.toFixed(1)} m)`);
      }
    }
  }
  for (const L of path.loops) issues.push(...L.check(2 * (L.hw + KERB) + 1));
  return { minRadius: 1 / maxCurv, maxGrade, issues };
}

function drive(path, opts = {}) {
  const run = new RobotRun(path, { ...opts, trace: true });
  while (!run.advance(5000));
  return run.result;
}

function svg(path, run) {
  const S = path.samples, b = path.bounds, pad = 40;
  const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
  const X = (x) => (x - b.minX + pad).toFixed(1), Z = (z) => (z - b.minZ + pad).toFixed(1);
  const parts = [];
  const maxY = Math.max(1, ...S.map((o) => o.y));
  for (let k = 0; k < path.segCount; k++) {
    const a = S[k], c = S[(k + 1) % S.length];
    const t = a.y / maxY;
    const col = a.gap ? '#ffffff' : a.tunnel ? '#7a3bd8' : a.y < 0.5 ? '#80838c' : `hsl(${200 - t * 180}, 75%, 50%)`;
    parts.push(`<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(c.x)}" y2="${Z(c.z)}" stroke="${col}" stroke-width="${(a.hw * 2).toFixed(1)}" stroke-linecap="round" ${a.gap ? 'stroke-dasharray="2 4" stroke-opacity="0.5"' : ''}/>`);
    if (a.walls) parts.push(`<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(c.x)}" y2="${Z(c.z)}" stroke="#222" stroke-width="2"/>`);
  }
  const gate = (g, col) => parts.push(`<line x1="${X(g.x + g.rx * (g.hw + 4))}" y1="${Z(g.z + g.rz * (g.hw + 4))}" x2="${X(g.x - g.rx * (g.hw + 4))}" y2="${Z(g.z - g.rz * (g.hw + 4))}" stroke="${col}" stroke-width="4"/>`);
  path.checkpoints.forEach((g) => gate(g, '#ffd21f'));
  gate(path.finish, '#000');
  if (!path.closed) gate(path.start, '#0a0');
  path.points.forEach((p, i) => parts.push(`<text x="${X(p.x) - -6}" y="${Z(p.z)}" font-size="11" fill="#000">${i}${p.y ? ` y${p.y}` : ''}</text>`));
  if (run) parts.push(`<polyline fill="none" stroke="#e00" stroke-width="1" points="${run.trace.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${(w * 2).toFixed(0)}" height="${(h * 2).toFixed(0)}"><rect width="100%" height="100%" fill="#7cc576"/>${parts.join('')}</svg>`;
}

// The editor's example track is checked too, built from its pieces.
const example = exampleTrack();
const traced = traceTrack(example.pieces, example);
if (!traced.ok) throw new Error(`Editor example track: ${traced.message}`);
traced.def.name = 'Editor example';

let failed = false;
for (const def of [...TRACKS, traced.def]) {
  if (only && def.id !== only) continue;
  const path = new TrackPath(def);
  const info = inspect(path);
  const run = drive(path);
  const fast = drive(path, { margin: 1.05 });
  const lap = path.closed ? ` x ${path.laps} laps` : '';
  console.log(`\n${def.name} (${def.difficulty}) - ${(path.length / 1000).toFixed(2)} km${lap}, ${path.checkpoints.length} checkpoints`);
  console.log(`  tightest corner radius ${info.minRadius.toFixed(0)} m, steepest grade ${(info.maxGrade * 100).toFixed(0)}%`);
  console.log(`  robot: ${run.done ? 'finished' : 'DID NOT FINISH'} in ${formatTime(run.time)}, top speed ${(run.top * 3.6).toFixed(0)} km/h, longest jump ${run.airMax.toFixed(2)} s, ${run.respawns} respawns${path.loops.length ? `, ${run.loopsRidden} loops ridden` : ''}`);
  console.log(`  bolder robot: ${fast.done ? formatTime(fast.time) : 'did not finish'}${fast.respawns ? `, ${fast.respawns} respawns` : ''}`);
  const m = def.medals;
  if (m.gold) console.log(`  medals: gold ${formatTime(m.gold)}, silver ${formatTime(m.silver)}, bronze ${formatTime(m.bronze)}`);
  for (const f of run.fails.slice(0, 6)) console.log(`  ! ${f.why} at s=${f.s.toFixed(0)} t=${f.t.toFixed(1)}`);
  for (const i of info.issues) console.log(`  ! ${i}`);
  if (!run.done || run.respawns || info.issues.length) failed = true;
  if (svgDir) {
    mkdirSync(svgDir, { recursive: true });
    writeFileSync(resolve(svgDir, `${def.id}.svg`), svg(path, run));
  }
}
if (failed) process.exitCode = 1;
