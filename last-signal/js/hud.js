// The on-screen interface: compass, vitals, prompts, toasts, subtitles and every panel and menu.
import { $, clamp, formatClock } from './util.js';
import { ITEMS } from './items.js';

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), compass: $('compass'), objText: $('obj-text'), objDist: $('obj-dist'), clockTime: $('clock-time'), clockTemp: $('clock-temp'),
      prompt: $('prompt'), promptKey: $('prompt-key'), promptText: $('prompt-text'), hold: $('hold'), holdFill: $('hold-fill'),
      toasts: $('toasts'), subtitle: $('subtitle'), hint: $('hint'), reticle: $('reticle'), damage: $('fx-damage'), fade: $('fx-fade'), status: $('status'),
    };
    this.vitals = {};
    for (const k of ['health', 'stamina', 'hunger', 'thirst', 'warmth']) {
      const row = $('v-' + k);
      this.vitals[k] = { row, fill: row.querySelector('i'), last: -1 };
    }
    this.ctx = this.el.compass.getContext('2d');
    this.screens = ['title-screen', 'pause', 'settings', 'controls', 'panel-pack', 'panel-map', 'panel-journal', 'panel-note', 'death', 'ending'];
    this._subTimer = 0;
    this._hintTimer = 0;
  }

  showHud(on) { this.el.hud.hidden = !on; }

  // Shows exactly one full-screen panel (or none).
  screen(name) {
    for (const id of this.screens) $(id).hidden = id !== name;
    this.current = name;
  }

  toast(text, kind = '') {
    const box = this.el.toasts;
    while (box.children.length > 3) box.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  subtitle(who, text, secs = 5) {
    const s = this.el.subtitle;
    s.hidden = false;
    s.innerHTML = '';
    if (who) { const b = document.createElement('b'); b.textContent = who; s.appendChild(b); }
    s.appendChild(document.createTextNode(text));
    this._subTimer = secs;
  }

  hint(text, secs = 6) {
    if (!this.hintsOn) return;
    this.el.hint.hidden = false;
    this.el.hint.textContent = text;
    this._hintTimer = secs;
  }

  prompt(key, text, active = true) {
    const p = this.el.prompt;
    if (!text) { p.hidden = true; this.el.reticle.classList.remove('active'); return; }
    p.hidden = false;
    this.el.promptKey.textContent = key;
    this.el.promptText.textContent = text;
    this.el.reticle.classList.toggle('active', active);
  }

  holdProgress(p) {
    this.el.hold.hidden = p <= 0;
    this.el.holdFill.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
  }

  objective(text, dist) {
    this.el.objText.textContent = text;
    this.el.objDist.textContent = dist == null ? '' : dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  }

  clock(hour, tempC) {
    this.el.clockTime.textContent = formatClock(hour);
    this.el.clockTemp.textContent = `${Math.round(tempC)}°C`;
  }

  setVitals(S) {
    const set = (k, v, lowBelow) => {
      const r = this.vitals[k], p = Math.round(clamp(v, 0, 100));
      if (p !== r.last) { r.fill.style.width = p + '%'; r.last = p; }
      r.row.classList.toggle('low', p < lowBelow);
      r.row.classList.toggle('show', p < 70);
    };
    set('health', S.health, 30); set('stamina', S.stamina, 12); set('hunger', S.hunger, 18); set('thirst', S.thirst, 18); set('warmth', S.warmth, 25);
    const tags = [];
    if (S.sick > 0) tags.push('Sick');
    if (S.wet > 0.5) tags.push('Soaked');
    if (S.warmth < 30) tags.push('Freezing');
    if (S.exhausted) tags.push('Exhausted');
    if (S.injured) tags.push('Hurt');
    const key = tags.join('|');
    if (key !== this._tags) {
      this._tags = key;
      this.el.status.innerHTML = '';
      for (const t of tags) { const s = document.createElement('span'); s.textContent = t; this.el.status.appendChild(s); }
    }
  }

  damage(v) { this.el.damage.style.opacity = String(clamp(v, 0, 1)); }
  fade(v, ms = 1200) { this.el.fade.style.transition = `opacity ${ms}ms ease`; this.el.fade.style.opacity = String(v); }

  update(dt) {
    if (this._subTimer > 0 && (this._subTimer -= dt) <= 0) this.el.subtitle.hidden = true;
    if (this._hintTimer > 0 && (this._hintTimer -= dt) <= 0) this.el.hint.hidden = true;
  }

  // Compass strip: cardinal ticks and markers for places worth knowing about.
  compass(yaw, markers) {
    const c = this.ctx, w = this.el.compass.width, h = this.el.compass.height;
    c.clearRect(0, 0, w, h);
    const span = Math.PI * 0.9, px = w / span;
    const toX = (bearing) => {
      let d = bearing - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return Math.abs(d) < span / 2 ? w / 2 + d * px : null;
    };
    c.fillStyle = 'rgba(8,14,20,0.45)';
    c.fillRect(0, 0, w, 34);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 72; i++) {
      const b = (i / 72) * Math.PI * 2;
      const x = toX(b);
      if (x == null) continue;
      const major = i % 9 === 0;
      c.strokeStyle = major ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      c.lineWidth = major ? 2 : 1;
      c.beginPath(); c.moveTo(x, major ? 20 : 24); c.lineTo(x, 32); c.stroke();
      if (i % 9 === 0) {
        c.fillStyle = i === 0 ? '#ff6a2b' : '#eef2f4';
        c.font = '500 15px Oswald, sans-serif';
        c.fillText(CARD[i / 9], x, 11);
      }
    }
    // Bearing 0 is north, which is -z; compass angles run clockwise from north.
    for (const m of markers) {
      const x = toX(m.bearing);
      if (x == null) continue;
      c.fillStyle = m.color || '#ff6a2b';
      c.beginPath(); c.moveTo(x, 36); c.lineTo(x - 7, 46); c.lineTo(x, 54); c.lineTo(x + 7, 46); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke();
    }
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(w / 2, 34); c.lineTo(w / 2 - 5, 27); c.lineTo(w / 2 + 5, 27); c.fill();
  }

  // ----- panels -----
  renderPack(inv, water, onUse) {
    const list = $('pack-list');
    list.innerHTML = '';
    const items = inv.list();
    if (!items.length) list.innerHTML = '<li><span></span><b>Nothing yet</b><span></span></li>';
    for (const it of items) {
      const li = document.createElement('li');
      li.innerHTML = `${it.icon || ''}<div><b>${it.name}</b><small>${it.desc}</small></div><span class="count">${it.n > 1 ? '×' + it.n : ''}</span>`;
      if (it.use) li.addEventListener('click', () => onUse(it.id));
      list.appendChild(li);
    }
    const pw = $('pack-water');
    if (inv.flags.bottle) {
      const pct = Math.round(water.amount * 100);
      pw.textContent = water.amount <= 0.02 ? 'Water bottle: empty. Fill it at the lake or creek.' : `Water bottle: ${pct}% full, ${water.clean ? 'clean' : 'untreated (boil it over a fire or use a tablet)'}.`;
      pw.hidden = false;
    } else pw.hidden = true;
  }

  renderJournal(tasks, pages, onOpen) {
    const t = $('journal-tasks');
    t.innerHTML = '';
    for (const k of tasks) {
      const li = document.createElement('li');
      li.textContent = k.text;
      li.className = k.state;
      t.appendChild(li);
    }
    const p = $('journal-pages');
    p.innerHTML = '';
    if (!pages.length) p.innerHTML = '<p class="hint-line">You have not found any notes yet. Scraps of paper are scattered around the valley.</p>';
    for (const pg of pages) {
      const d = document.createElement('div');
      d.className = 'page';
      d.innerHTML = `<h4></h4><p></p>`;
      d.querySelector('h4').textContent = pg.title;
      d.querySelector('p').textContent = pg.body;
      d.addEventListener('click', () => onOpen(pg));
      p.appendChild(d);
    }
  }

  note(pg) {
    $('note-title').textContent = pg.title;
    $('note-body').textContent = pg.body;
  }
}
