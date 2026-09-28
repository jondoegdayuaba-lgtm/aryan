// Heads-up display: speedometer with the motor's power, boost, the wheelie
// meter, race timer with split times, checkpoint count, a heading-up minimap,
// a pointer to the next gate, stunt pop-ups and the start countdown.
import { formatTime } from './race.js';

const $ = (id) => document.getElementById(id);
const ARC_LEN = 377;          // length of the 270 degree arc in the SVG
const deg = (r) => (r * 180) / Math.PI;

export class Hud {
  constructor(world, route, gates) {
    this.el = {
      hud: $('hud'), cp: $('cp'), timer: $('timer'), split: $('split'), style: $('style'), speed: $('speed'), unit: $('unit'),
      gear: $('gear'), power: $('power-fill'), boost: $('boost-fill'), popups: $('popups'), countdown: $('countdown'),
      message: $('message'), nav: $('nav'), navArrow: document.querySelector('#nav svg'), navDist: $('nav-dist'),
      minimap: $('minimap'), chipCp: $('chip-cp'), chal: $('chal'), chalBest: $('chal-best'), chalNext: $('chal-next'),
      wheelie: $('wheelie'), wNeedle: $('wheelie-needle'), wDist: $('wheelie-dist'), wZones: $('wheelie-zones'),
    };
    this.route = route;
    this.gates = gates;
    this.mapCtx = this.el.minimap.getContext('2d');
    this.map = this._buildMap(world, route);
    this.cache = {};
    this.units = 'kmh';
  }

  // Top-down shaded map of the basin with the route drawn on.
  _buildMap(world, route) {
    const size = 512, span = 2048, org = -1024;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const near = world.near, sp = world.splat, n = near.size;
    const step = span / size;
    const L = [-0.6, 0.55, 0.3];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wx = org + x * step, wz = org + y * step;
        const h = near.sample(wx, wz);
        const dx = near.sample(wx + 2, wz) - near.sample(wx - 2, wz);
        const dz = near.sample(wx, wz + 2) - near.sample(wx, wz - 2);
        const nl = Math.hypot(dx, 4, dz);
        const shade = Math.max(0.25, (-dx * L[0] + 4 * L[1] - dz * L[2]) / nl / 0.7);
        const i = Math.min(n - 1, Math.round(x * step)), j = Math.min(n - 1, Math.round(y * step));
        const k = (j * n + i) * 4;
        const dune = sp[k + 2] / 255, playa = sp[k + 3] / 255;
        const t = Math.min(1, Math.max(0, (h + 5) / 80));
        let r = 176 - 50 * t, gg = 118 - 45 * t, b = 76 - 30 * t;
        r += (222 - r) * dune * 0.5; gg += (180 - gg) * dune * 0.5; b += (118 - b) * dune * 0.5;
        r += (215 - r) * playa; gg += (205 - gg) * playa; b += (190 - b) * playa;
        const o = (y * size + x) * 4;
        img.data[o] = Math.min(255, r * shade);
        img.data[o + 1] = Math.min(255, gg * shade);
        img.data[o + 2] = Math.min(255, b * shade);
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Route.
    g.strokeStyle = 'rgba(255, 245, 225, 0.85)';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < route.count; i += 8) {
      const x = (route.xs[i] - org) / step, y = (route.zs[i] - org) / step;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.stroke();
    return { canvas: c, org, step };
  }

  setUnits(u) { this.units = u; this._text('unit', u === 'mph' ? 'mph' : 'km/h'); }

  _text(key, v) {
    if (this.cache[key] !== v) {
      this.cache[key] = v;
      this.el[key].textContent = v;
    }
  }

  show(on, { race = true, challenge = false } = {}) {
    this.el.hud.hidden = !on;
    this.race = race;
    this.el.chipCp.style.visibility = race ? 'visible' : 'hidden';
    this.el.timer.parentElement.style.visibility = race ? 'visible' : 'hidden';
    this.el.chal.hidden = !challenge;
    if (!on) this.el.popups.textContent = '';
  }

  // Colour the wheelie meter for this bike's balance point.
  setBalance(angle) {
    const b = deg(angle);
    const pt = (a) => `${(100 + 88 * Math.cos((a * Math.PI) / 180)).toFixed(1)} ${(108 - 88 * Math.sin((a * Math.PI) / 180)).toFixed(1)}`;
    const arc = (a0, a1, cls) => `<path class="${cls}" d="M ${pt(a0)} A 88 88 0 0 0 ${pt(a1)}"/>`;
    this.el.wZones.innerHTML = arc(4, b - 16, 'z-low') + arc(b - 16, b + 3, 'z-good') + arc(b + 3, b + 10, 'z-warn') + arc(b + 10, 88, 'z-bad');
  }

  challenge(best, next) {
    this._text('chalBest', best > 0 ? `${Math.round(best)} m` : '--');
    this._text('chalNext', next);
  }

  update(s) {
    const E = this.el;
    const speed = this.units === 'mph' ? s.speed * 2.23694 : s.speed * 3.6;
    this._text('speed', String(Math.round(Math.abs(speed))));
    this._text('gear', s.kw < 0.5 ? '0' : s.kw < 10 ? s.kw.toFixed(1) : String(Math.round(s.kw)));
    const f = Math.min(1, s.power);
    const dash = `${(f * ARC_LEN).toFixed(1)} 400`;
    if (this.cache.power !== dash) { this.cache.power = dash; E.power.style.strokeDasharray = dash; }
    E.power.classList.toggle('boost', !!s.boosting);
    const b = `scaleX(${s.boost.toFixed(3)})`;
    if (this.cache.boost !== b) { this.cache.boost = b; E.boost.style.transform = b; }
    this._text('style', s.style.toLocaleString());
    if (this.race) {
      this._text('timer', formatTime(s.time));
      this._text('cp', `${Math.min(s.cp, s.cpTotal)} / ${s.cpTotal}`);
    }
    // Pointer to the next gate, relative to where the camera looks.
    if (s.nav) {
      E.nav.style.visibility = 'visible';
      const deg = (s.nav.angle * 180) / Math.PI;
      E.navArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      this._text('navDist', s.nav.dist > 999 ? `${(s.nav.dist / 1000).toFixed(1)} km` : `${Math.round(s.nav.dist / 10) * 10} m`);
    } else E.nav.style.visibility = 'hidden';
    this._minimap(s);

    // Wheelie meter: angle against the balance point, and the distance so far.
    const W = s.wheelie;
    const showW = W && (W.active || W.lastT < 2.2);
    E.wheelie.classList.toggle('show', !!showW);
    if (showW) {
      const a = W.active ? Math.max(0, deg(s.pitch)) : 0;
      const r = `rotate(${(-Math.min(95, a)).toFixed(1)} 100 108)`;
      if (this.cache.needle !== r) { this.cache.needle = r; E.wNeedle.setAttribute('transform', r); }
      this._text('wDist', `${Math.round(W.active ? W.dist : W.last)} m`);
      E.wheelie.classList.toggle('done', !W.active);
    }
  }

  _minimap(s) {
    const g = this.mapCtx, W = this.el.minimap.width, M = this.map;
    const zoom = 1.6;                 // canvas px per map px
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    g.clip();
    g.translate(W / 2, W / 2);
    g.rotate(s.heading);
    g.scale(zoom, zoom);
    const px = (s.x - M.org) / M.step, pz = (s.z - M.org) / M.step;
    g.drawImage(M.canvas, -px, -pz);
    // Gates.
    this.gates.gates.forEach((gt, i) => {
      const x = (gt.pos.x - M.org) / M.step - px, y = (gt.pos.z - M.org) / M.step - pz;
      const next = i === s.cp;
      g.fillStyle = next ? '#ffb347' : i < s.cp ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(x, y, next ? 5 : 3, 0, Math.PI * 2);
      g.fill();
    });
    g.restore();
    // Player arrow (map is heading-up, so it always points up).
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2, W / 2 - 9);
    g.lineTo(W / 2 + 7, W / 2 + 8);
    g.lineTo(W / 2, W / 2 + 4);
    g.lineTo(W / 2 - 7, W / 2 + 8);
    g.closePath();
    g.fill();
    g.stroke();
  }

  popup(html, cls = '') {
    const box = this.el.popups;
    while (box.children.length > 3) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'popup ' + cls;
    d.innerHTML = html;
    box.appendChild(d);
    setTimeout(() => d.remove(), 1850);
  }

  split(delta, text) {
    const E = this.el.split;
    E.textContent = text ?? (delta === null ? '' : `${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}`);
    E.className = 'split ' + (delta === null ? '' : delta <= 0 ? 'good' : 'bad');
    clearTimeout(this._splitT);
    this._splitT = setTimeout(() => { E.textContent = ''; }, 3500);
  }

  countdown(text, go = false) {
    const E = this.el.countdown;
    E.textContent = text;
    E.className = 'countdown';
    void E.offsetWidth;
    E.className = 'countdown ' + (go ? 'go' : 'tick');
  }

  message(text) {
    const E = this.el.message;
    E.hidden = !text;
    if (text) this._text('message', text);
  }
}
