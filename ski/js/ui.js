// DOM side of the game: menus, HUD, toasts and the results screen. Also the tiny save-game store.
import { clamp, formatTime, formatDelta } from './util.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'alpine-descent-v1';

export class SaveData {
  constructor() {
    this.data = { best: {}, medals: {}, quality: 'auto', camera: 'chase', muted: false };
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* private mode or blocked storage: play without saving */ }
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  best(runId) { return this.data.best[runId] ?? null; }

  /** returns true when it is a new record */
  submit(runId, time, medal) {
    const prev = this.data.best[runId];
    const rank = { gold: 3, silver: 2, bronze: 1 };
    if ((rank[medal] || 0) > (rank[this.data.medals[runId]] || 0)) this.data.medals[runId] = medal;
    if (prev == null || time < prev) { this.data.best[runId] = time; this.save(); return true; }
    this.save();
    return false;
  }
}

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), paused: $('paused'), results: $('results'), flash: $('flash'),
      time: $('hud-time'), penalty: $('hud-penalty'), split: $('hud-split'), runName: $('hud-run-name'), gates: $('hud-gates'),
      speed: $('speed'), speedoFill: $('speedo-fill'), alt: $('hud-alt'), drop: $('hud-drop'), remaining: $('hud-remaining'),
      countdown: $('countdown'), toasts: $('toasts'), hint: $('hint'), touch: $('touch'),
      profileArea: $('profile-area'), profileLine: $('profile-line'), profileCursor: $('profile-cursor'), profileDot: $('profile-dot'),
    };
    this._last = {};
    this._splitTimer = 0;
    this._penaltyTimer = 0;
    this.profile = null;
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) this.el.touch.hidden = false;
  }

  show(name) {
    const e = this.el;
    e.menu.hidden = name !== 'menu';
    e.paused.hidden = name !== 'paused';
    e.results.hidden = name !== 'results';
    e.hud.hidden = !(name === 'hud' || name === 'paused' || name === 'results');
  }

  // --------------------------------------------------------------------- menu
  buildRunList(runs, save, onPick) {
    const list = $('run-list');
    list.innerHTML = '';
    for (const r of runs) {
      const best = save.best(r.id);
      const medal = save.data.medals[r.id] || 'none';
      const len = r.sEnd - r.sStart;
      const b = document.createElement('button');
      b.className = 'run-card';
      b.type = 'button';
      b.setAttribute('role', 'listitem');
      const gates = r.mode === 'slalom' ? `${r.gates.length}` : r.mode === 'downhill' ? '4 jumps' : `${r.gates.length} checks`;
      b.innerHTML = `
        <div class="run-head"><span class="run-name">${r.name}</span><span class="chip ${r.level.toLowerCase()}">${r.level}</span></div>
        <div class="run-blurb">${r.blurb}</div>
        <div class="run-stats">
          <div><b>${(len / 1000).toFixed(2)} km</b><small>Length</small></div>
          <div><b>${Math.round(r.drop)} m</b><small>Vertical</small></div>
          <div><b>${gates}</b><small>${r.mode === 'slalom' ? 'Gates' : 'Features'}</small></div>
        </div>
        <div class="run-best"><span><span class="medal-dot ${medal}"></span>Best</span><b>${best != null ? formatTime(best) : '--:--.--'}</b></div>`;
      b.addEventListener('click', () => onPick(r));
      list.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------- HUD
  buildProfile(world, run) {
    const path = world.path;
    const pts = [];
    const n = 90;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= n; i++) {
      const s = run.sStart + (run.sEnd - run.sStart) * (i / n);
      const y = path.at(s, {}).y;
      pts.push(y);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const W = 300, H = 70, pad = 8;
    const xy = pts.map((y, i) => [pad + (W - 2 * pad) * (i / n), pad + (H - 2 * pad) * (1 - (y - lo) / Math.max(hi - lo, 1))]);
    const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    this.el.profileLine.setAttribute('d', line);
    this.el.profileArea.setAttribute('d', `${line} L${W - pad},${H - 2} L${pad},${H - 2} Z`);
    this.profile = { xy, lo, hi, W, H, pad, n };
  }

  startRun(run, world, quality) {
    this.run = run;
    this.el.runName.textContent = run.name;
    this.el.gates.textContent = run.mode === 'slalom' ? `Gates 0 / ${run.gates.length}` : `Checkpoint 0 / ${run.gates.length}`;
    this.el.time.textContent = '0:00.00';
    this.el.penalty.textContent = '';
    this.el.split.textContent = '';
    this.el.split.className = 'hud-split';
    this.el.toasts.innerHTML = '';
    this.buildProfile(world, run);
    this.startAltitude = null;
    this.quality = quality;
  }

  update(dt, s) {
    const e = this.el;
    const kmh = Math.round(s.speed * 3.6);
    if (kmh !== this._last.kmh) {
      this._last.kmh = kmh;
      e.speed.textContent = kmh;
      const frac = clamp(kmh / 150, 0, 1);
      e.speedoFill.style.strokeDashoffset = String(245 * (1 - frac));
      e.speedoFill.style.stroke = kmh > 110 ? '#ff8a5c' : kmh > 70 ? '#ffd166' : '';
    }
    const t = formatTime(s.time);
    if (t !== this._last.time) { this._last.time = t; e.time.textContent = t; }
    if (s.gatesText !== this._last.gates) { this._last.gates = s.gatesText; e.gates.textContent = s.gatesText; }
    const alt = Math.round(s.altitude);
    if (alt !== this._last.alt) { this._last.alt = alt; e.alt.textContent = alt; e.drop.textContent = Math.max(0, Math.round(s.descended)); }
    const rem = Math.max(0, Math.round(s.remaining));
    if (rem !== this._last.rem) { this._last.rem = rem; e.remaining.textContent = rem >= 1000 ? `${(rem / 1000).toFixed(2)} km` : `${rem} m`; }
    if (this.profile) {
      const P = this.profile;
      const f = clamp(s.progress, 0, 1) * P.n;
      const i = Math.min(Math.floor(f), P.n - 1);
      const u = f - i;
      const x = P.xy[i][0] + (P.xy[i + 1][0] - P.xy[i][0]) * u;
      const y = P.xy[i][1] + (P.xy[i + 1][1] - P.xy[i][1]) * u;
      e.profileDot.setAttribute('cx', x.toFixed(1));
      e.profileDot.setAttribute('cy', y.toFixed(1));
      e.profileCursor.setAttribute('x1', x.toFixed(1));
      e.profileCursor.setAttribute('x2', x.toFixed(1));
    }
    if (this._splitTimer > 0) { this._splitTimer -= dt; if (this._splitTimer <= 0) { e.split.textContent = ''; } }
    if (this._penaltyTimer > 0) { this._penaltyTimer -= dt; if (this._penaltyTimer <= 0) e.penalty.textContent = ''; }
  }

  penalty(total) {
    this.el.penalty.textContent = `+${total.toFixed(1)}s penalty`;
    this._penaltyTimer = 999;
  }

  split(text, ahead) {
    this.el.split.textContent = text;
    this.el.split.className = 'hud-split ' + (ahead == null ? '' : ahead ? 'ahead' : 'behind');
    this._splitTimer = 4;
  }

  countdown(text, go = false) {
    const c = this.el.countdown;
    c.textContent = text;
    c.classList.remove('show');
    c.classList.toggle('go', go);
    void c.offsetWidth;
    c.classList.add('show');
    clearTimeout(this._cdT);
    this._cdT = setTimeout(() => c.classList.remove('show'), go ? 900 : 800);
  }

  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 2500);
  }

  flashCrash() {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }

  hint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.classList.toggle('show', !!text);
  }

  // ------------------------------------------------------------------- results
  showResults(d) {
    $('result-title').textContent = d.title;
    $('result-time').textContent = formatTime(d.time);
    const medal = $('result-medal');
    medal.className = `medal ${d.medal || 'none'}`;
    medal.textContent = d.medal === 'gold' ? '1' : d.medal === 'silver' ? '2' : d.medal === 'bronze' ? '3' : '';
    const best = $('result-best');
    best.className = 'result-best' + (d.record ? ' record' : '');
    best.textContent = d.record ? 'New personal best!' : d.best != null ? `Best ${formatTime(d.best)}  (${formatDelta(d.time - d.best)})` : '';
    const rows = [
      ['Race time', formatTime(d.raw)],
      ['Penalties', d.penalty ? `+${d.penalty.toFixed(1)} s` : 'none'],
      ['Top speed', `${Math.round(d.topSpeed * 3.6)} km/h`],
      ['Longest air', d.maxAir > 0.2 ? `${d.maxAir.toFixed(1)} s` : '—'],
      [d.slalom ? 'Gates missed' : 'Checkpoints', d.slalom ? `${d.missed}` : `${d.passed} / ${d.gates}`],
      ['Crashes', `${d.crashes}`],
    ];
    $('result-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    $('btn-next').hidden = !d.hasNext;
    this.show('results');
  }
}
