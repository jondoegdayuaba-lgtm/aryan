// Pace notes: corners graded 1 (tightest) to 6 (fastest), hairpins, crests,
// jumps and splashes, worked out from the road geometry and read out by the
// co-driver a few seconds before you get there.
import { wrap } from './road.js';
import { WATER } from './gen.js';

const GRADES = [[16, 'hairpin'], [28, 1], [45, 2], [70, 3], [110, 4], [170, 5], [260, 6]];

export function buildPaceNotes(road, features = []) {
  const n = road.count;
  // smoothed curvature
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = -6; d <= 6; d++) s += road.curv[wrap(i + d, n)];
    k[i] = s / 13;
  }
  const kMin = 1 / 260;
  // find corners: runs of |k| > kMin with a consistent sign
  const corners = [];
  let i = 0;
  // start scanning from a straight bit so we don't split a corner at the loop seam
  let start = 0;
  for (let t = 0; t < n; t++) if (Math.abs(k[t]) < kMin * 0.5) { start = t; break; }
  let cur = null;
  for (let t = 0; t < n; t++) {
    i = wrap(start + t, n);
    const on = Math.abs(k[i]) > kMin;
    const dir = Math.sign(k[i]);
    if (on && (!cur || cur.dir !== dir)) {
      if (cur) corners.push(cur);
      cur = { a: start + t, b: start + t, dir, minR: Infinity, angle: 0, radii: [] };
    }
    if (cur) {
      if (on && dir === cur.dir) {
        cur.b = start + t;
        const R = 1 / Math.abs(k[i]);
        cur.minR = Math.min(cur.minR, R);
        cur.angle += k[i];
        cur.radii.push(R);
      } else if (start + t - cur.b > 12) {
        corners.push(cur);
        cur = null;
      }
    }
  }
  if (cur) corners.push(cur);

  const notes = [];
  for (const c of corners) {
    const deg = Math.abs(c.angle) * 180 / Math.PI;
    if (deg < 14) continue;
    let grade = null;
    for (const [r, g] of GRADES) if (c.minR < r) { grade = g; break; }
    if (grade === null) continue;
    if (grade !== 'hairpin' && c.minR < 24 && deg > 75 && deg < 115) grade = 'square';
    if (grade === 6 && deg < 25) grade = 'kink';
    const len = c.b - c.a;
    const note = { s: wrap(c.a, n), end: wrap(c.b, n), dir: c.dir > 0 ? 'left' : 'right', grade, mods: [] };
    if (len > 90 && typeof grade === 'number') note.mods.push('long');
    if (c.radii.length > 10 && typeof grade === 'number') {
      const h = c.radii.length >> 1;
      const r1 = Math.min(...c.radii.slice(0, h)), r2 = Math.min(...c.radii.slice(h));
      if (r2 < r1 * 0.6) note.mods.push('tightens');
      else if (r2 > r1 * 1.7) note.mods.push('opens');
    }
    notes.push(note);
  }

  // Vertical features: crests and jumps from the height profile.
  const y = road.y;
  const vertical = [];
  for (let t = 8; t < n; t += 2) {
    const kv = (y[wrap(t + 8, n)] - 2 * y[t] + y[wrap(t - 8, n)]) / 64;
    if (kv < -1 / 170) {
      const lift = Math.sqrt(9.81 / -kv) * 3.6;
      const last = vertical[vertical.length - 1];
      if (last && t - last.s < 25) { if (lift < last.lift) { last.lift = lift; last.s = t; } }
      else vertical.push({ s: t, lift });
    }
  }
  const within = (x, a, b) => ((x - a + n) % n) <= ((b - a + n) % n);
  // designed jumps are always called as jumps
  for (const f of features) {
    if (f.type !== 'jump') continue;
    const near = vertical.find((v) => Math.abs(v.s - f.s) < 30);
    if (near) { near.lift = Math.min(near.lift, 60); near.s = f.s; } else vertical.push({ s: f.s, lift: 60 });
  }
  for (const v of vertical) {
    const kind = v.lift < 95 ? 'jump' : 'crest';
    // a crest just before or inside a corner becomes part of that call
    const c = notes.find((q) => typeof q.dir === 'string' && q.dir && (((q.s - v.s + n) % n) < 25 || within(v.s, q.s, q.end)));
    if (c) { if (!c.mods.some((m) => m.startsWith('over'))) c.mods.unshift(kind === 'jump' ? 'over jump' : 'over crest'); }
    else notes.push({ s: v.s, end: v.s, grade: kind, dir: '', mods: [] });
  }
  // Fords: the road dips into the water.
  let wet = false;
  for (let t = 0; t < n; t++) {
    const w = y[t] < WATER + 0.05;
    if (w && !wet) notes.push({ s: wrap(t - 10, n), end: t, grade: 'splash', dir: '', mods: [] });
    wet = w;
  }
  notes.sort((a, b) => a.s - b.s);
  // Link notes: "into" when the next comes straight after, otherwise a distance.
  for (let q = 0; q < notes.length; q++) {
    const a = notes[q], b = notes[(q + 1) % notes.length];
    let gap = (b.s - a.end + n) % n;
    if (gap > n / 2) gap = 0;          // overlapping notes
    a.gap = gap;
    a.link = gap < 22 ? 'into' : null;
  }
  return notes;
}

const WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };

// Words the co-driver says for a note.
export function noteText(note) {
  const parts = [];
  switch (note.grade) {
    case 'hairpin': parts.push(`hairpin ${note.dir}`); break;
    case 'square': parts.push(`square ${note.dir}`); break;
    case 'kink': parts.push(`${note.dir} kink`); break;
    case 'crest': parts.push('crest'); break;
    case 'jump': parts.push('jump'); break;
    case 'splash': parts.push('splash'); break;
    default: parts.push(`${note.dir} ${WORDS[note.grade]}`);
  }
  for (const m of note.mods) parts.push(m);
  if (note.link) parts.push(note.link);
  else if (note.gap > 120 && note.grade !== 'splash') parts.push(note.gap > 250 ? 'long straight' : String(Math.round(note.gap / 50) * 50));
  return parts.join(' ');
}

// Short label for the HUD icon.
export function noteLabel(note) {
  switch (note.grade) {
    case 'hairpin': return 'HP';
    case 'square': return 'SQ';
    case 'kink': return 'K';
    case 'crest': return 'CREST';
    case 'jump': return 'JUMP';
    case 'splash': return 'WATER';
    default: return String(note.grade);
  }
}

// The co-driver: queues notes and reads them with the browser's speech
// synthesis when it's available (silently skipped otherwise).
export class CoDriver {
  constructor() {
    this.enabled = true;
    this.voice = null;
    this.synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    if (this.synth) {
      const pick = () => {
        const vs = this.synth.getVoices();
        this.voice = vs.find((v) => /en-GB/i.test(v.lang) && /\bmale|daniel|arthur|oliver/i.test(v.name))
          || vs.find((v) => /en-GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
      };
      pick();
      this.synth.addEventListener?.('voiceschanged', pick);
    }
  }

  // Notes that arrive while the co-driver is still talking wait their turn,
  // but only the freshest few: a call for a corner already passed is no use.
  say(text, rate = 1.35) {
    if (!this.enabled || !this.synth) return;
    if (this.synth.speaking || this.synth.pending) {
      this.queue = (this.queue || []).concat(text).slice(-2);
      this.queueRate = rate;
      return;
    }
    this._speak(text, rate);
  }

  _speak(text, rate) {
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = rate;
    u.pitch = 0.95;
    u.volume = 0.9;
    u.onend = () => {
      if (!this.queue || !this.queue.length) return;
      const next = this.queue.join(', ');
      this.queue = [];
      this._speak(next, this.queueRate || rate);
    };
    this.synth.speak(u);
  }

  stop() { this.queue = []; this.synth?.cancel(); }
}
