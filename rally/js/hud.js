// The in-race heads-up display: timer, splits, speed and revs, pace notes,
// minimap, popups. Only touches the DOM when a value actually changes.
import { noteLabel } from './pacenotes.js';

const $ = (id) => document.getElementById(id);

export function formatTime(t, plus = false) {
  if (!isFinite(t)) return '--:--.--';
  const sign = t < 0 ? '-' : plus ? '+' : '';
  t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = s.toFixed(2).padStart(5, '0');
  return m > 0 ? `${sign}${m}:${ss}` : `${sign}${ss}`;
}

// Time differences: +0.39, -1.20, +1:02.50
export function formatGap(d) {
  if (!isFinite(d)) return '';
  if (Math.abs(d) >= 60) return formatTime(d, true);
  return (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2);
}

// Arc path on the tachometer dial.
function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;

// Corner arrow icons by severity.
function noteIcon(note) {
  const dir = note.dir === 'left' ? -1 : 1;
  let bend;
  switch (note.grade) {
    case 'hairpin': bend = 170; break;
    case 'square': bend = 90; break;
    case 1: bend = 120; break;
    case 2: bend = 95; break;
    case 3: bend = 72; break;
    case 4: bend = 52; break;
    case 5: bend = 34; break;
    case 6: case 'kink': bend = 20; break;
    default: bend = 0;
  }
  if (!note.dir) {
    // crest / jump / water
    if (note.grade === 'splash') return '<svg viewBox="0 0 32 32"><path d="M4 22c4-4 8 4 12 0s8 4 12 0" fill="none" stroke="#6fc3ff" stroke-width="3" stroke-linecap="round"/><path d="M16 5c3 5 5 8 5 11a5 5 0 0 1-10 0c0-3 2-6 5-11z" fill="#6fc3ff"/></svg>';
    const high = note.grade === 'jump' ? 10 : 15;
    return `<svg viewBox="0 0 32 32"><path d="M3 25 Q16 ${high - 12} 29 25" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>${note.grade === 'jump' ? '<path d="M12 9l4-5 4 5" fill="none" stroke="#ffc629" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`;
  }
  // arrow: straight up then curve toward the turn
  const rad = (bend * Math.PI) / 180;
  const r = 9;
  const sx = 16 - dir * 5, sy = 28;
  const cx = sx + dir * r, cy = 16;
  const ex = cx - dir * Math.cos(rad) * r, ey = cy - Math.sin(rad) * r;
  const hx = Math.cos(Math.PI / 2 - rad) * dir, hy = -Math.sin(Math.PI / 2 - rad);
  const tx = -hy * dir, ty = hx * dir;
  const head = `M${(ex + hx * 5 + tx * 4).toFixed(1)} ${(ey + hy * 5 + ty * 4).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex + hx * 5 - tx * 4).toFixed(1)} ${(ey + hy * 5 - ty * 4).toFixed(1)}`;
  const body = `M${sx} ${sy} L${sx} ${cy} A${r} ${r} 0 ${bend > 180 ? 1 : 0} ${dir > 0 ? 1 : 0} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const col = typeof note.grade === 'number' && note.grade <= 2 || note.grade === 'hairpin' || note.grade === 'square' ? '#ff8a5b' : '#fff';
  return `<svg viewBox="0 0 32 32"><path d="${body}" fill="none" stroke="${col}" stroke-width="3.2" stroke-linecap="round"/><path d="${head}" fill="none" stroke="${col}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export class Hud {
  constructor(world) {
    this.world = world;
    this.el = {
      root: $('hud'), time: $('hud-time'), delta: $('hud-delta'), speed: $('hud-speed'), unit: $('hud-unit'),
      gear: $('hud-gear'), progress: $('hud-progress'), ghost: $('hud-ghost-pos'), stage: $('hud-stage-name'),
      notes: $('pacenotes'), popups: $('popups'), countdown: $('countdown'), warning: $('warning'), hint: $('hint'),
      tachoFill: $('tacho-fill'), tachoBg: $('tacho-bg'), tachoRed: $('tacho-red'), minimap: $('minimap'),
    };
    this.el.tachoBg.setAttribute('d', arc(100, 100, 82, A0, A1));
    this.cache = {};
    this.mini = this.el.minimap.getContext('2d');
    this.units = 'kmh';
  }

  set(key, el, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  setStage(name, redFrac) {
    this.el.stage.textContent = name;
    this.el.tachoRed.setAttribute('d', arc(100, 100, 82, A0 + (A1 - A0) * redFrac, A1));
    this.cache = {};
  }

  dash(car) {
    const kmh = car.speed * 3.6;
    const v = this.units === 'mph' ? kmh * 0.6214 : kmh;
    this.set('speed', this.el.speed, String(Math.round(v)));
    this.set('unit', this.el.unit, this.units === 'mph' ? 'mph' : 'km/h');
    const g = car.shiftTimer > 0 ? '-' : car.gear < 0 ? 'R' : String(car.gear);
    this.set('gear', this.el.gear, g);
    const E = car.spec.engine;
    const f = Math.min(1, Math.max(0, (car.rpm - 0) / E.limiter));
    const q = Math.round(f * 120);
    if (this.cache.rpm !== q) {
      this.cache.rpm = q;
      this.el.tachoFill.setAttribute('d', q > 0 ? arc(100, 100, 82, A0, A0 + (A1 - A0) * (q / 120)) : '');
      this.el.tachoFill.classList.toggle('limit', car.rpm > E.redline);
    }
  }

  timer(t) { this.set('time', this.el.time, formatTime(t)); }

  delta(d) {
    const el = this.el.delta;
    if (d === null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = formatTime(d, true);
    el.classList.toggle('good', d < 0);
    el.classList.toggle('bad', d >= 0);
  }

  progress(frac, ghostFrac = null) {
    const p = Math.round(Math.min(1, Math.max(0, frac)) * 1000) / 10;
    if (this.cache.prog !== p) { this.cache.prog = p; this.el.progress.style.width = p + '%'; }
    if (ghostFrac === null) this.el.ghost.style.display = 'none';
    else { this.el.ghost.style.display = 'block'; this.el.ghost.style.left = (Math.min(1, Math.max(0, ghostFrac)) * 100).toFixed(1) + '%'; }
  }

  notes(list) {
    const key = list.map((n) => n.s).join(',');
    if (this.cache.notes === key) return;
    this.cache.notes = key;
    this.el.notes.innerHTML = list.map((n, i) => {
      const warn = n.grade === 'hairpin' || n.grade === 'square' || n.grade === 1;
      const mods = [...n.mods, n.link || ''].filter(Boolean).join(' ');
      return `<div class="note${i === 0 ? ' next' : ''}${warn ? ' warn' : ''}">${noteIcon(n)}<span class="n">${noteLabel(n)}</span>${mods ? `<span class="m">${mods}</span>` : ''}</div>`;
    }).join('');
  }

  popup(html, ms = 1800) {
    const box = this.el.popups;
    while (box.children.length > 2) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'popup';
    d.innerHTML = html;
    d.style.animationDuration = ms + 'ms';
    box.appendChild(d);
    setTimeout(() => d.remove(), ms);
  }

  countdown(text) {
    const el = this.el.countdown;
    if (text === null) { el.hidden = true; this.cache.cd = null; return; }
    el.hidden = false;
    if (this.cache.cd !== text) {
      this.cache.cd = text;
      el.textContent = text;
      el.classList.toggle('go', text === 'GO');
    }
  }

  // The how-to-drive card (null hides it).
  hint(html, single = false) {
    const el = this.el.hint;
    if (!html) { el.hidden = true; this.cache.hint = null; return; }
    if (this.cache.hint === html) return;
    this.cache.hint = html;
    el.innerHTML = html;
    el.classList.toggle('single', single);
    el.hidden = false;
  }

  warning(text) {
    const el = this.el.warning;
    el.hidden = !text;
    if (text && this.cache.warn !== text) { this.cache.warn = text; el.textContent = text; }
  }

  // Rotating road map around the car.
  minimap(car, ghost, markers = []) {
    const g = this.mini, W = 170, R = W / 2;
    const road = this.world.road, n = road.count;
    const scale = R / 260;
    const heading = Math.atan2(car.F.x, car.F.z);
    const cs = Math.cos(heading), sn = Math.sin(heading);
    const px = car.pos.x, pz = car.pos.z;
    const tf = (x, z) => {
      const dx = x - px, dz = z - pz;
      // forward (heading) is up, the car's left is left
      const f = dx * sn + dz * cs, l = dx * cs - dz * sn;
      return [R - l * scale, R - f * scale];
    };
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    let pen = false;
    for (let i = 0; i < n; i += 4) {
      const dx = road.x[i] - px, dz = road.z[i] - pz;
      if (dx * dx + dz * dz > 330 * 330) { pen = false; continue; }
      const [x, y] = tf(road.x[i], road.z[i]);
      if (pen) g.lineTo(x, y); else g.moveTo(x, y);
      pen = true;
    }
    g.stroke();
    for (const m of markers) {
      const [x, y] = tf(m.x, m.z);
      g.fillStyle = m.color;
      g.beginPath();
      g.arc(x, y, m.r || 4, 0, Math.PI * 2);
      g.fill();
    }
    if (ghost) {
      const [x, y] = tf(ghost.x, ghost.z);
      g.fillStyle = '#9fd8ff';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // the car
    g.fillStyle = '#ffc629';
    g.beginPath();
    g.moveTo(R, R - 9);
    g.lineTo(R + 6, R + 7);
    g.lineTo(R, R + 3);
    g.lineTo(R - 6, R + 7);
    g.closePath();
    g.fill();
  }
}
