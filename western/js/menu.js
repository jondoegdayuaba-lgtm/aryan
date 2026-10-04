// Title screen and the pause menu (red panel over a frozen black-and-white
// frame) with its pages: map, help, progress, player, story, settings.
import { money } from './util.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  constructor(game) {
    this.game = game;
    this.pause = $('pause');
    this.page = null;
    this.buildWatch();
    this.jaggedEdge();
    for (const b of document.querySelectorAll('#pause-nav button')) {
      b.addEventListener('click', () => this.select(b.dataset.page));
      b.addEventListener('mouseenter', () => game.audio.ui());
    }
    $('btn-play').addEventListener('click', () => game.startPlaying(false));
    $('btn-new').addEventListener('click', () => {
      if (game.hasSave() && !confirm('Start a new game? Your current progress will be lost.')) return;
      game.startPlaying(true);
    });
    const big = $('bigmap-over');
    big.addEventListener('click', (e) => {
      const r = big.getBoundingClientRect();
      const s = game.world.data.size;
      const x = ((e.clientX - r.left) / r.width) * s - s / 2;
      const z = ((e.clientY - r.top) / r.height) * s - s / 2;
      const hud = game.hud;
      hud.waypoint = hud.waypoint && Math.hypot(hud.waypoint.x - x, hud.waypoint.z - z) < 40 ? null : { x, z };
      this.drawMap();
    });
    $('bigmap-img').src = game.assets.map ? game.assets.map.src : 'assets/map.jpg';
    this.bindSettings();
  }

  buildWatch() {
    const g = document.querySelector('.watch .ticks');
    let html = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 26 : 29;
      html += `<line x1="${50 + Math.sin(a) * r0}" y1="${68 - Math.cos(a) * r0}" x2="${50 + Math.sin(a) * 33}" y2="${68 - Math.cos(a) * 33}"/>`;
    }
    g.innerHTML = html;
  }

  // A brush-stroke right edge for the red panel
  jaggedEdge() {
    const pts = ['0 0'];
    let x = 100;
    for (let i = 0; i <= 40; i++) {
      const y = i * 2.5;
      x = 92 + Math.sin(i * 1.7) * 2 + Math.random() * 6 - (y / 100) * 4;
      pts.push(`${x.toFixed(1)}% ${y}%`);
      if (Math.random() < 0.3) pts.push(`${(x - 2 - Math.random() * 3).toFixed(1)}% ${(y + 1).toFixed(1)}%`);
    }
    pts.push('0 100%');
    document.querySelector('.pause-panel').style.clipPath = `polygon(${pts.join(',')})`;
  }

  updateWatch() {
    const h = this.game.env.hour;
    const ha = ((h % 12) / 12) * 360;
    const ma = ((h % 1) * 360);
    $('watch-h').setAttribute('transform', `rotate(${ha} 50 68)`);
    $('watch-m').setAttribute('transform', `rotate(${ma - 90} 50 68)`);
  }

  openPause(page = null) {
    this.pause.hidden = false;
    document.body.classList.add('paused');
    this.updateWatch();
    this.showPage(page);
  }

  closePause() {
    this.pause.hidden = true;
    document.body.classList.remove('paused');
    this.showPage(null);
  }

  get open() {
    return !this.pause.hidden;
  }

  select(name) {
    const g = this.game;
    g.audio.ui();
    if (name === 'resume') return g.resume();
    if (name === 'quit') return g.quitToTitle();
    this.showPage(this.page === name ? null : name);
  }

  back() {
    if (this.page) this.showPage(null);
    else this.game.resume();
  }

  showPage(name) {
    this.page = name;
    for (const s of document.querySelectorAll('.pause-page')) s.hidden = s.id !== 'page-' + name;
    for (const b of document.querySelectorAll('#pause-nav button')) b.classList.toggle('sel', b.dataset.page === name);
    if (name === 'map') requestAnimationFrame(() => this.drawMap());
    if (name === 'progress') this.drawProgress();
    if (name === 'player') this.drawPlayer();
    if (name === 'story') this.drawStory();
    if (name === 'settings') this.loadSettings();
  }

  drawMap() {
    const g = this.game;
    const c = $('bigmap-over');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = Math.max(1, r.width * dpr);
    c.height = Math.max(1, r.height * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const s = g.world.data.size;
    const P = (x, z) => [((x + s / 2) / s) * r.width, ((z + s / 2) / s) * r.height];
    const pts = g.world.data.points;
    ctx.textAlign = 'center';
    const label = (text, x, z, size = 15) => {
      const [px, py] = P(x, z);
      ctx.font = `${size}px Rye, Georgia, serif`;
      ctx.fillStyle = 'rgba(40, 24, 10, .85)';
      ctx.fillText(text, px, py);
    };
    label('Copper Bluff', pts.town[0], pts.town[2] - 60, 17);
    label('Hollis Farm', pts.farm[0], pts.farm[2] + 75);
    label('Camp', pts.camp[0], pts.camp[2] - 30);
    label('Eagle Ridge', pts.eagle_ridge[0], pts.eagle_ridge[2] - 30);
    label('Lookout', pts.lookout[0], pts.lookout[2] - 28, 13);
    label('Dakota River', -260, -120, 13);
    label('Grizzly Heights', 0, -1020, 18);
    const dot = (x, z, color, rad = 6, text) => {
      const [px, py] = P(x, z);
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1a1208';
      ctx.stroke();
      if (text) {
        ctx.font = '600 12px Oswald, sans-serif';
        ctx.fillStyle = '#1a1208';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, px, py + 1);
        ctx.textBaseline = 'alphabetic';
      }
    };
    for (const b of g.blips(true)) dot(b.x, b.z, b.color, b.label ? 9 : 6, b.label);
    if (g.hud.waypoint) {
      const [px, py] = P(g.hud.waypoint.x, g.hud.waypoint.z);
      ctx.strokeStyle = '#7a1a10';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7);
      ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7);
      ctx.stroke();
    }
    const p = g.player;
    const [px, py] = P(p.pos.x, p.pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-p.yaw + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawProgress() {
    const g = this.game;
    const s = g.stats;
    const done = g.missions.doneCount();
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const rows = [
      ['Story', `${done} / ${g.missions.list.length}`], ['Money', money(g.money)], ['Outlaws killed', s.kills],
      ['Headshots', s.headshots], ['Accuracy', acc + '%'], ['Deer hunted', s.hunted],
      ['Distance ridden', (s.ridden / 1000).toFixed(1) + ' km'], ['Distance on foot', (s.walked / 1000).toFixed(1) + ' km'],
      ['Deaths', s.deaths], ['Days passed', Math.floor(s.days)],
    ];
    $('progress-body').innerHTML = `<div class="stat-grid">${rows.map(([a, b]) => `<div class="stat"><span>${a}</span><span>${b}</span></div>`).join('')}</div>`;
  }

  drawPlayer() {
    const g = this.game;
    const p = g.player;
    const h = g.horse;
    $('player-body').innerHTML = `
      <p><b>Cole Brennan</b>, rides with Gus Hale's outfit, camped on the west bank of the Dakota.</p>
      <div class="stat-grid">
        <div class="stat"><span>Health</span><span>${Math.round(p.health)}</span></div>
        <div class="stat"><span>Stamina</span><span>${Math.round(p.stamina)}</span></div>
        <div class="stat"><span>Dead Eye</span><span>${Math.round(p.deadEye)}</span></div>
        <div class="stat"><span>Revolver</span><span>${p.ammo.revolver.clip} + ${p.ammo.revolver.reserve}</span></div>
        <div class="stat"><span>Rifle</span><span>${p.ammo.rifle.clip} + ${p.ammo.rifle.reserve}</span></div>
        <div class="stat"><span>Pelts</span><span>${g.pelts}</span></div>
        <div class="stat"><span>Horse</span><span>${h ? h.name : '-'}</span></div>
        <div class="stat"><span>Horse stamina</span><span>${h ? Math.round(h.stamina) : '-'}</span></div>
      </div>`;
  }

  drawStory() {
    const m = this.game.missions;
    const t = m.travelTarget();
    const travel = t ? `<button class="go-btn">${m.active ? 'Travel to objective' : 'Start this mission'} <kbd>J</kbd></button>` : '';
    const items = m.list.map((def, i) => {
      const done = m.isDone(def.id);
      const active = m.active && m.active.def.id === def.id;
      const avail = m.available() === def;
      const cls = done ? 'done' : active ? 'active' : avail ? '' : 'locked';
      const text = done || active || avail ? def.blurb : 'Locked.';
      const who = avail && !active ? `<p><i>Talk to ${def.giverName} (${def.where}).</i></p>` : '';
      const go = (avail && !m.active) || active ? travel : '';
      return `<li class="${cls}"><span class="num">${i + 1}</span><div><h3>${def.title}</h3><p>${text}</p>${who}${go}</div></li>`;
    });
    $('story-body').innerHTML = `<ul class="mission-list">${items.join('')}</ul>`;
    const btn = $('story-body').querySelector('.go-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        this.game.resume();
        this.game.quickTravel();
      });
    }
  }

  bindSettings() {
    const g = this.game;
    $('set-quality').addEventListener('change', (e) => g.setSetting('quality', e.target.value));
    $('set-sens').addEventListener('input', (e) => g.setSetting('sensitivity', +e.target.value));
    $('set-fov').addEventListener('input', (e) => g.setSetting('fov', +e.target.value));
    $('set-vol').addEventListener('input', (e) => g.setSetting('volume', +e.target.value));
    $('set-invert').addEventListener('change', (e) => g.setSetting('invert', e.target.checked));
  }

  loadSettings() {
    const s = this.game.settings;
    $('set-quality').value = s.quality;
    $('set-sens').value = s.sensitivity;
    $('set-fov').value = s.fov;
    $('set-vol').value = s.volume;
    $('set-invert').checked = s.invert;
  }

  showTitle(on, hasSave) {
    $('title-screen').hidden = !on;
    $('btn-play').textContent = hasSave ? 'Continue' : 'Start';
    $('btn-new').hidden = !hasSave;
  }
}
