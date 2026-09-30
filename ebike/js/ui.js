import { HEAT } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), score: $('score'), time: $('time'), stars: [...document.querySelectorAll('#stars .star')],
      speed: $('speed'), hp: $('hp-fill'), bat: $('bat-fill'), bust: $('bust'), bustFill: $('bust-fill'),
      popups: $('popups'), radar: $('radar'), status: $('status'), damage: $('damage'), lines: $('speedlines'),
      cool: $('cool'), coolFill: $('cool-fill'), hpWrap: $('hp-wrap'),
    };
    this.rctx = this.el.radar.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = 168;
    this.el.radar.width = size * dpr; this.el.radar.height = size * dpr;
    this.rctx.scale(dpr, dpr);
    this.size = size;
    this.lastHp = 100;
    this.dmgT = 0;
    this.lastStars = -1;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  popup(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'popup ' + cls;
    d.textContent = text;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1900);
    while (this.el.popups.children.length > 5) this.el.popups.firstChild.remove();
  }

  update(g, dt) {
    const e = this.el, b = g.bike;
    e.score.textContent = Math.floor(g.score).toLocaleString();
    const t = Math.floor(g.time);
    e.time.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    e.speed.textContent = Math.round(Math.max(0, b.speed) * 3.6);
    e.hp.style.width = `${b.hp}%`;
    e.hpWrap.classList.toggle('low', b.hp < 30);
    e.bat.style.width = `${b.battery}%`;
    e.bat.classList.toggle('boost', b.boosting);
    if (g.heat !== this.lastStars) {
      e.stars.forEach((s, i) => s.classList.toggle('on', i < g.heat));
      this.lastStars = g.heat;
    }
    const bust = g.vehicles.bust;
    e.bust.classList.toggle('hidden', bust < 0.02);
    e.bustFill.style.width = `${bust * 100}%`;
    const cool = g.unseen / HEAT.loseTime;
    e.cool.classList.toggle('hidden', cool < 0.08 || !g.playing);
    e.coolFill.style.width = `${Math.min(1, cool) * 100}%`;
    // status line
    const chasing = g.vehicles.activeCops.length;
    e.status.textContent = !g.playing ? '' : cool > 0.08 ? 'LOSING THEM…' : chasing ? (g.vehicles.nearCount ? 'THEY’RE ON YOU' : 'POLICE PURSUIT') : 'CLEAR';
    e.status.className = cool > 0.08 ? 'ok' : chasing ? 'alert' : 'ok';
    // damage flash
    if (b.hp < this.lastHp - 0.5) this.dmgT = Math.min(1, this.dmgT + (this.lastHp - b.hp) * 0.04);
    this.lastHp = b.hp;
    this.dmgT = Math.max(0, this.dmgT - dt * 1.8);
    e.damage.style.opacity = String(Math.min(0.85, this.dmgT + (b.hp < 30 ? 0.18 + 0.1 * Math.sin(g.time * 6) : 0)));
    e.lines.style.opacity = String(Math.max(0, Math.min(1, (b.speed - 22) / 14)));
    this.radar(g);
  }

  radar(g) {
    const c = this.rctx, S = this.size, R = 190, k = S / 2 / R, b = g.bike;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(8,12,22,0.82)'; c.fillRect(0, 0, S, S);
    const fx = b.fx0, fz = b.fz0, rx = Math.cos(b.h), rz = -Math.sin(b.h);
    const P = 100;
    const toS = (wx, wz) => { const dx = wx - b.x, dz = wz - b.z; return [S / 2 + (dx * rx + dz * rz) * k, S / 2 - (dx * fx + dz * fz) * k]; };
    // roads: grid lines every 100 m at 50 + 100k
    c.lineCap = 'butt';
    c.strokeStyle = 'rgba(120,140,190,0.32)';
    c.lineWidth = 20 * k;
    const i0 = Math.floor((b.x - R - 50) / P), i1 = Math.ceil((b.x + R - 50) / P);
    const j0 = Math.floor((b.z - R - 50) / P), j1 = Math.ceil((b.z + R - 50) / P);
    c.beginPath();
    for (let i = i0; i <= i1; i++) { const x = 50 + P * i; const a = toS(x, b.z - R * 1.5), d = toS(x, b.z + R * 1.5); c.moveTo(a[0], a[1]); c.lineTo(d[0], d[1]); }
    for (let j = j0; j <= j1; j++) { const z = 50 + P * j; const a = toS(b.x - R * 1.5, z), d = toS(b.x + R * 1.5, z); c.moveTo(a[0], a[1]); c.lineTo(d[0], d[1]); }
    c.stroke();
    // pickups
    c.fillStyle = '#39e6ff';
    for (const p of g.pickups.visible()) { const [x, y] = toS(p.x, p.z); c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill(); }
    // cops
    const blink = Math.floor(g.time * 4) % 2;
    for (const v of g.vehicles.cops) {
      if (!v.active) continue;
      const [x, y] = toS(v.x, v.z);
      if (v.disabled) { c.fillStyle = '#777'; c.fillRect(x - 2, y - 2, 4, 4); continue; }
      c.fillStyle = blink ? '#ff3b3b' : '#3b6bff';
      c.beginPath(); c.arc(x, y, 3.6, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1; c.stroke();
    }
    // player
    c.translate(S / 2, S / 2);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.restore();
  }
}
