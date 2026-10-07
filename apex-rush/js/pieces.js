// Track editor pieces. A custom track is a set of pieces on a grid; following
// the road from the Start piece, piece to piece, gives the list of points that
// TrackPath turns into a drivable road (see tracks.js for the point format).
// No rendering here, so the track checker can use it headless.

export const CELL = 24;          // metres per grid square
export const LEVEL = 2;          // metres per height step
export const MAX_LEVEL = 12;
export const MIN_GAP_LEVELS = 3; // pieces stacked closer than this replace each other

// Directions as [x, z] steps. Heading +z, your left is +x, so turning left
// is dir + 1 and turning right is dir + 3.
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// The order here is part of the share-code format: only ever append.
export const TYPES = ['road', 'turnL', 'turnR', 'wideL', 'wideR', 'up', 'down', 'jump', 'cp', 'start', 'finish',
  'boost', 'hammer', 'sweeper', 'pistons', 'bollards', 'pad', 'kicker', 'bumps', 'mega', 'loopL', 'loopR'];
// Pieces that were taken out of the game load as plain straights.
const RETIRED = { hammer: 'road', sweeper: 'road', pistons: 'road', bollards: 'road' };

export const PIECES = {
  start: { label: 'Start' },
  road: { label: 'Straight' },
  turnL: { label: 'Turn left', turn: 1, radius: 0.5 },
  turnR: { label: 'Turn right', turn: -1, radius: 0.5 },
  wideL: { label: 'Wide left', turn: 1, radius: 1.5 },
  wideR: { label: 'Wide right', turn: -1, radius: 1.5 },
  up: { label: 'Slope up', rise: 1 },
  down: { label: 'Slope down', rise: -1 },
  jump: { label: 'Jump ramp', rise: 1, jump: true },
  cp: { label: 'Checkpoint', cp: true },
  finish: { label: 'Finish', finish: true },
  boost: { label: 'Boost pad', feature: { boost: true } },
  pad: { label: 'Jump pad', feature: { launch: true } },
  kicker: { label: 'Kicker' },
  bumps: { label: 'Bumps' },
  mega: { label: 'Big ramp', rise: 2, jump: true, lip: 0.2 },
  loopL: { label: 'Loop left', loop: 13, side: 1 },
  loopR: { label: 'Loop right', loop: 13, side: -1 },
};

const JUMP_REACH = 4;            // a jump can clear up to this many empty squares
const JUMP_DROP = 6;             // ...and land up to this many levels lower
const LIP_SLOPE = 0.12;

// Local frame of a piece: f forward along its heading, l to the left, in metres
// from the centre of its first square.
function frame(p) {
  const F = DIRS[p.r], L = DIRS[(p.r + 1) % 4];
  return (f, l) => [p.i * CELL + F[0] * f + L[0] * l, p.j * CELL + F[1] * f + L[1] * l];
}

// Squares a piece covers, as [i, j].
export function footprint(p) {
  const def = PIECES[p.t];
  const F = DIRS[p.r], L = DIRS[(p.r + 1) % 4];
  const cells = [[p.i, p.j]];
  if (def.loop) cells.push([p.i + L[0] * def.side, p.j + L[1] * def.side]);
  if (def.radius === 1.5) {
    const s = def.turn;
    cells.push([p.i + F[0], p.j + F[1]], [p.i + F[0] + L[0] * s, p.j + F[1] + L[1] * s]);
  }
  return cells;
}

// Where the road leaves a piece: the next piece's square, heading and level.
export function exitOf(p) {
  const def = PIECES[p.t];
  const F = DIRS[p.r], L = DIRS[(p.r + 1) % 4];
  const level = p.l + (def.rise || 0);
  if (def.loop) return { i: p.i + F[0] + L[0] * def.side, j: p.j + F[1] + L[1] * def.side, r: p.r, l: level };
  if (!def.turn) return { i: p.i + F[0], j: p.j + F[1], r: p.r, l: level };
  const s = def.turn;
  const r = (p.r + (s > 0 ? 1 : 3)) % 4;
  if (def.radius === 0.5) return { i: p.i + L[0] * s, j: p.j + L[1] * s, r, l: level };
  return { i: p.i + F[0] + L[0] * 2 * s, j: p.j + F[1] + L[1] * 2 * s, r, l: level };
}

// Where the road leaves a piece, as [f, l] in its frame.
export function exitPoint(p) {
  const def = PIECES[p.t];
  if (def.turn) return [-CELL / 2 + def.radius * CELL, def.turn * def.radius * CELL];
  if (def.loop) return [CELL / 2, def.side * CELL];
  return [CELL / 2, 0];
}

// The road's centre line through a piece, from its entry edge up to (not
// including) its exit edge: [f, l, height in levels, options?] in its frame.
export function centreLine(p) {
  const def = PIECES[p.t];
  const h = CELL / 2;
  // A loop: a short straight in, the loop itself, and a short straight out,
  // so it lines up with the road whatever comes before and after it.
  if (def.loop) return [[-h, 0, 0], [-h + 4, 0, 0, { loop: def.loop }], [h - 4, def.side * CELL, 0]];
  if (p.t === 'kicker') return [[-h, 0, 0], [2, 0, 0.75, { slope: 0.32 }]];      // sharp crest: you fly off it
  if (p.t === 'bumps') return [[-h, 0, 0], [-6, 0, 0.35], [0, 0, 0], [6, 0, 0.35]];
  if (def.turn) {
    const R = def.radius * CELL, n = def.radius === 0.5 ? 3 : 5;
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI / 2;
      out.push([-h + R * Math.sin(a), def.turn * (R - R * Math.cos(a)), 0]);
    }
    return out;
  }
  if (def.rise) return [[-h, 0, 0], [0, 0, def.rise * (def.jump ? 0.4 : 0.5)]];
  if (def.cp || def.feature) return [[-h, 0, 0], [0, 0, 0]];
  return [[-h, 0, 0]];
}

const cellKey = (i, j) => `${i},${j}`;
const levels = (p) => [Math.min(p.l, p.l + (PIECES[p.t].rise || 0)), Math.max(p.l, p.l + (PIECES[p.t].rise || 0))];

// Do two pieces fight over the same space?
export function clash(a, b) {
  const [a0, a1] = levels(a), [b0, b1] = levels(b);
  if (a0 - b1 >= MIN_GAP_LEVELS || b0 - a1 >= MIN_GAP_LEVELS) return false;
  const cells = new Set(footprint(a).map(([i, j]) => cellKey(i, j)));
  return footprint(b).some(([i, j]) => cells.has(cellKey(i, j)));
}

// Follow the road from the Start piece. Returns the route and either a track
// definition ready to race (ok) or a message saying what's missing.
export function traceTrack(pieces, { name = 'My track', laps = 1 } = {}) {
  const res = { ok: false, message: '', route: [], openEnd: null, def: null };
  const start = pieces.find((p) => p.t === 'start');
  if (!start) {
    res.message = 'Place a Start piece to begin.';
    return res;
  }
  const byOrigin = new Map();
  const occupied = new Map();
  for (const p of pieces) {
    const k = cellKey(p.i, p.j);
    if (!byOrigin.has(k)) byOrigin.set(k, []);
    byOrigin.get(k).push(p);
    for (const [i, j] of footprint(p)) {
      const c = cellKey(i, j);
      if (!occupied.has(c)) occupied.set(c, []);
      occupied.get(c).push(p);
    }
  }

  const route = res.route;
  const gaps = new Map();        // piece -> true when a jump gap follows it
  const seen = new Set();
  let p = start, closed = false;
  for (;;) {
    route.push(p);
    seen.add(p);
    if (PIECES[p.t].finish) break;
    const ex = exitOf(p);
    const jump = PIECES[p.t].jump;
    let next = null, k = 0;
    for (; k < (jump ? JUMP_REACH + 1 : 1); k++) {
      const i = ex.i + DIRS[ex.r][0] * k, j = ex.j + DIRS[ex.r][1] * k;
      next = (byOrigin.get(cellKey(i, j)) || []).find((q) => q.r === ex.r && (jump
        ? q.l <= ex.l && q.l >= ex.l - JUMP_DROP
        : q.l === ex.l));
      if (next) break;
      // Anything else in the way at about this height blocks the jump.
      if ((occupied.get(cellKey(i, j)) || []).some((q) => Math.abs(q.l - ex.l) < MIN_GAP_LEVELS)) break;
    }
    if (next === start) { closed = true; break; }
    if (!next) {
      res.openEnd = ex;
      res.preview = routePoints(route, gaps, false);
      res.message = route.length === 1
        ? 'Now lay road on from the Start piece, following its arrow.'
        : `The road stops after ${route.length} pieces. Carry on from the marked square, or end it with a Finish piece.`;
      return res;
    }
    if (seen.has(next)) {
      res.openEnd = ex;
      res.preview = routePoints(route, gaps, false);
      res.message = 'The road runs back into itself. Make it loop back into the Start piece, or end it with a Finish.';
      return res;
    }
    if (k > 0) gaps.set(p, true);
    p = next;
  }

  const cps = route.filter((q) => PIECES[q.t].cp).length;
  if (route.length < 3) {
    res.message = 'Make the road at least 3 pieces long.';
    return res;
  }
  if (closed && !cps) {
    res.message = 'A circuit needs at least one Checkpoint so laps can be counted.';
    return res;
  }

  const points = routePoints(route, gaps, closed);

  const id = 'custom-' + hash(JSON.stringify(pieces.map(packPiece).sort()) + '|' + (closed ? laps : 1));
  res.ok = true;
  res.closed = closed;
  res.checkpoints = cps;
  res.def = {
    id, name, custom: true, difficulty: 'Custom',
    blurb: closed ? `Your circuit, ${laps} lap${laps > 1 ? 's' : ''}.` : 'Your track, A to B.',
    closed, laps: closed ? laps : 1, width: 14,
    medals: { gold: 0, silver: 0, bronze: 0 },
    scenery: { seed: parseInt(id.slice(-6), 16) || 1, trees: 170, stands: false, buildings: 6 },
    points,
  };
  return res;
}

// Points for TrackPath along a route. Open routes end at the last piece's exit.
function routePoints(route, gaps, closed) {
  const points = [];
  for (const q of route) {
    const at = frame(q);
    const def = PIECES[q.t];
    const opts = { walls: !!(q.w || def.walls), tunnel: !!q.u };
    centreLine(q).forEach(([f, l, dh, extra], n) => {
      const [x, z] = at(f, l);
      const o = { ...opts, ...extra };
      if (def.cp && n === 1) o.cp = true;
      if (def.feature && n === 1) Object.assign(o, def.feature);
      points.push([x, z, (q.l + dh) * LEVEL, o]);
    });
    if (gaps.has(q)) {
      const [x, z] = at(CELL / 2, 0);
      points.push([x, z, (q.l + def.rise) * LEVEL, { ...opts, gap: true, slope: def.lip || LIP_SLOPE, hoop: true }]);
    }
  }
  if (!closed) {
    const last = route[route.length - 1];
    const [x, z] = frame(last)(...exitPoint(last));
    points.push([x, z, exitOf(last).l * LEVEL, {}]);
  }
  return points;
}

// Medal times from a robot driver's time round the track.
export function robotMedals(time) {
  const r = (t) => Math.round(t * 10) / 10;
  return time > 0 ? { gold: r(time * 0.985), silver: r(time * 1.08), bronze: r(time * 1.22) } : { gold: 0, silver: 0, bronze: 0 };
}

// ---------- Share codes ----------
const packPiece = (p) => [TYPES.indexOf(p.t), p.i, p.j, p.l, p.r, (p.w ? 1 : 0) | (p.u ? 2 : 0)];

export function encodeTrack({ name, laps, pieces }) {
  const json = JSON.stringify({ n: name, l: laps, p: pieces.map(packPiece) });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return 'APEX1:' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Returns { name, laps, pieces } or throws with a readable message.
export function decodeTrack(code) {
  const m = /^\s*APEX1:([A-Za-z0-9_-]+)\s*$/.exec(code || '');
  if (!m) throw new Error('That isn’t an Apex Rush track code. Codes start with APEX1:');
  let data;
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    throw new Error('That track code is damaged. Check it was copied in full.');
  }
  if (!data || !Array.isArray(data.p)) throw new Error('That track code has no pieces in it.');
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const pieces = data.p.filter((a) => Array.isArray(a) && int(a[0], 0, TYPES.length - 1) && int(a[1], -500, 500) && int(a[2], -500, 500)
    && int(a[3], 0, MAX_LEVEL) && int(a[4], 0, 3)).slice(0, 2000)
    .map(([t, i, j, l, r, f]) => ({ t: RETIRED[TYPES[t]] || TYPES[t], i, j, l, r, w: !!(f & 1), u: !!(f & 2) }));
  return {
    name: String(data.n || 'Shared track').slice(0, 32),
    laps: int(data.l, 1, 5) ? data.l : 1,
    pieces,
  };
}

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// A small circuit to start from: a kicker, bumps, two wide hairpins, a
// checkpoint, and a boost pad into a jump.
export function exampleTrack() {
  const P = (t, i, j, r, l = 0) => ({ t, i, j, l, r, w: false, u: false });
  return {
    name: 'Example circuit',
    laps: 2,
    pieces: [
      P('start', 1, 0, 0), P('bumps', 1, 1, 0), P('cp', 1, 2, 0), P('road', 1, 3, 0),
      P('wideL', 1, 4, 0), P('wideL', 3, 5, 1),
      P('boost', 4, 3, 2), P('jump', 4, 2, 2), P('road', 4, 0, 2), P('road', 4, -1, 2), P('loopL', 4, -2, 2),
      P('road', 3, -3, 2), P('wideL', 3, -4, 2), P('wideL', 1, -5, 3),
      P('loopL', 0, -3, 0), P('road', 1, -2, 0), P('road', 1, -1, 0),
    ],
  };
}
