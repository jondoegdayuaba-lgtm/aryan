// Proves each built-in level of pulse-vector.html can be completed.
// It loads the game's own physics and level code out of the HTML and runs a
// beam-search bot through it with the real fixed-step simulation.
//
//   node pulse-vector/tools/verify-levels.cjs            # all levels
//   node pulse-vector/tools/verify-levels.cjs hard       # one level by id
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'pulse-vector.html'), 'utf8');
const start = html.indexOf('// ==CORE START==');
const end = html.indexOf('// ==LEVELS END==');
if (start < 0 || end < 0) throw new Error('Could not find the core/levels markers in pulse-vector.html');
const api = new Function('module', html.slice(start, end) + '\nreturn { compileLevel, newState, cloneState, step, LEVELS };')({});

function key(st) {
  let k = st.mode + (st.mini ? 'm' : '') + (st.dual ? 'd' : '') + st.speed + ':' + Math.round(st.x * 8) + (st.held ? 'h' : '');
  for (const p of st.players) k += '|' + Math.round(p.y * 30) + ',' + Math.round(p.vy * 3) + ',' + p.grav + (p.onGround ? 'g' : '') + (p.buf ? 'b' : '') + (p.boostT > 0 ? 'r' + Math.round(p.boostT * 50) : '');
  return k;
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

// Every 4 physics ticks the bot tries both "held" and "released", keeps up to
// `beam` distinct states, spread across heights so it doesn't tunnel-vision.
function solve(L, beam = 300, D = 4) {
  let nodes = [api.newState(L)], best = 0, n = 0;
  while (nodes.length) {
    const next = new Map();
    for (const s of nodes) for (const h of [false, true]) {
      const st = api.cloneState(s);
      for (let i = 0; i < D && !st.dead && !st.done; i++) api.step(st, h, L);
      if (st.done) return { ok: true };
      if (st.dead) continue;
      best = Math.max(best, st.x);
      const k = key(st);
      if (!next.has(k)) next.set(k, st);
    }
    nodes = [...next.values()];
    if (nodes.length > beam) {
      n++;
      const buckets = new Map();
      for (const st of nodes) {
        const bk = Math.round(st.players[0].y * 3) + ':' + st.players[0].grav + ':' + st.mode;
        if (!buckets.has(bk)) buckets.set(bk, []);
        buckets.get(bk).push(st);
      }
      const lists = [...buckets.values()];
      for (const l of lists) l.sort((a, b) => ((hash(key(a)) + n) % 997) - ((hash(key(b)) + n) % 997));
      const out = [];
      for (let i = 0; out.length < beam; i++) {
        let any = false;
        for (const l of lists) if (i < l.length) { out.push(l[i]); any = true; if (out.length >= beam) break; }
        if (!any) break;
      }
      nodes = out;
    }
  }
  return { ok: false, best };
}

let failed = false;
for (const def of api.LEVELS) {
  if (process.argv[2] && def.id !== process.argv[2]) continue;
  const L = api.compileLevel(def);
  const r = solve(L);
  let where = '';
  if (!r.ok) {
    const ci = L.starts.reduce((acc, s, i) => (r.best >= s ? i : acc), 0);
    where = ` — stuck in chunk ${ci}, column ${(r.best - L.starts[ci]).toFixed(1)}`;
    failed = true;
  }
  console.log(`${def.id.padEnd(8)} ${L.duration.toFixed(1)}s  ${L.bpm.toFixed(1)} BPM  ${r.ok ? 'beatable' : 'NOT beatable' + where}`);
}
process.exit(failed ? 1 : 0);
