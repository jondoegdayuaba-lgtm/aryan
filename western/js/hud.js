// On-screen interface: cores, minimap, ammo, money, objective, subtitles,
// prompts, toasts, title cards and Dead Eye marks.
import * as THREE from 'three';
import { money, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const RING = 106.8;

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.cores = { health: $('core-health'), stamina: $('core-stamina'), deadeye: $('core-deadeye'), horse: $('core-horse') };
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.objectiveEl = $('objective');
    this.subEl = $('subtitle');
    this.promptEl = $('prompts');
    this.toastEl = $('toasts');
    this.card = $('title-card');
    this.cross = $('crosshair');
    this.hit = $('hitmarker');
    this.marksEl = $('marks');
    this.moneyEl = $('money');
    this.ammoEl = $('ammo');
    this.resEl = $('ammo-res');
    this.wnameEl = $('weapon-name');
    this.weaponEl = $('weapon');
    this.clockEl = $('clock');
    this.hurtEl = document.querySelector('#screen-fx .hurt');
    this.hurtLevel = 0;
    this.subTimer = 0;
    this.cardTimer = 0;
    this.lastPrompt = '';
    this.lastObjective = '';
    this.mapImg = game.assets.map;
    this.waypoint = null;
    this._v = new THREE.Vector3();
    this.cache = {};
  }

  show(on) {
    this.root.hidden = !on;
  }

  set(key, el, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(el, value);
  }

  ring(el, frac) {
    const f = clamp(frac, 0, 1);
    this.set(el.id, el, Math.round(f * 100), (e, v) => {
      e.querySelector('.ring').style.strokeDashoffset = String(RING * (1 - v / 100));
      e.classList.toggle('low', v < 25);
    });
  }

  horse(on) {
    this.cores.horse.hidden = !on;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.ring(this.cores.health, p.health / 100);
    this.ring(this.cores.stamina, p.stamina / 100);
    this.ring(this.cores.deadeye, p.deadEye / 100);
    if (p.mounted) this.ring(this.cores.horse, p.mounted.stamina / 100);
    this.set('money', this.moneyEl, g.money, (e, v) => { e.textContent = money(v); });
    const w = p.weapon;
    this.set('wvis', this.weaponEl, !!w, (e, v) => { e.style.visibility = v ? 'visible' : 'hidden'; });
    if (w) {
      const a = p.ammo[w];
      this.set('wname', this.wnameEl, w, (e, v) => { e.textContent = v === 'rifle' ? 'Rifle' : 'Revolver'; });
      this.set('clip', this.ammoEl, p.reloading > 0 ? '…' : a.clip, (e, v) => { e.textContent = v; });
      this.set('res', this.resEl, a.reserve, (e, v) => { e.textContent = v; });
    }
    this.set('clock', this.clockEl, g.env.clock, (e, v) => { e.textContent = v; });
    // Crosshair: only while a gun is out
    const cross = !w ? 'off' : p.aiming ? (this.aimTarget ? 'target' : '') : 'wide';
    this.set('cross', this.cross, cross, (e, v) => { e.className = v; });
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 0.6);
    const lowHealth = p.health < 35 ? 0.35 + 0.15 * Math.sin(g.time * 5) : 0;
    this.hurtEl.style.opacity = String(Math.min(1, this.hurtLevel + lowHealth));
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subEl.innerHTML = '';
    }
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.card.classList.remove('show');
    }
    this.drawMarks();
    this.drawMinimap();
  }

  objective(html) {
    if (html === this.lastObjective) return;
    this.lastObjective = html;
    this.objectiveEl.classList.remove('show');
    clearTimeout(this._objT);       // an objective set and cleared at once never shows
    if (!html) return;
    this._objT = setTimeout(() => {
      this.objectiveEl.innerHTML = html;
      this.objectiveEl.classList.add('show');
    }, 250);
  }

  subtitle(who, text, dur = 4) {
    this.subEl.innerHTML = who ? `<span class="who">${who}:</span>${text}` : text;
    this.subTimer = dur;
  }

  prompts(list) {
    const key = list.map((p) => p.join(':')).join('|');
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.promptEl.innerHTML = list.map(([k, label]) => `<div><kbd>${k}</kbd><span>${label}</span></div>`).join('');
  }

  toast(text, small = '') {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = (small ? `<small>${small}</small>` : '') + text;
    this.toastEl.appendChild(d);
    while (this.toastEl.children.length > 4) this.toastEl.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 4200);
    setTimeout(() => d.remove(), 5000);
  }

  titleCard(small, big, sub = '', dur = 4, fail = false) {
    this.card.querySelector('.tc-small').textContent = small;
    this.card.querySelector('.tc-big').textContent = big;
    this.card.querySelector('.tc-sub').textContent = sub;
    this.card.classList.toggle('fail', fail);
    this.card.classList.add('show');
    this.cardTimer = dur;
  }

  hurt(dmg) {
    this.hurtLevel = Math.min(1, this.hurtLevel + dmg / 30);
  }

  hitmarker(kill) {
    const h = this.hit;
    h.classList.toggle('kill', !!kill);
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => h.classList.remove('show'), 90);
    this.game.audio.thud();
  }

  drawMarks() {
    const p = this.game.player;
    const marks = p.deadEyeOn ? p.marks : p.firingMarks ? p.firingMarks.list : [];
    const el = this.marksEl;
    while (el.children.length < marks.length) el.appendChild(document.createElement('i'));
    while (el.children.length > marks.length) el.lastChild.remove();
    const cam = this.game.camera;
    marks.forEach((m, i) => {
      const v = m.point().project(cam);
      const c = el.children[i];
      c.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
      c.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
      c.style.display = v.z < 1 ? '' : 'none';
    });
  }

  // Minimap: the parchment map, rotated so the camera's view points up.
  drawMinimap() {
    const g = this.game;
    const ctx = this.mctx;
    const W = this.mini.width;
    const R = W / 2;
    const p = g.player.pos;
    const size = g.world.data.size;
    const img = this.mapImg;
    const viewR = g.player.mounted ? 170 : 110;      // metres from centre to edge
    const k = R / viewR;
    const yaw = g.camRig.yaw;
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(R, R);
    ctx.rotate(rot);
    if (img) {
      const pxPerM = img.width / size;
      ctx.filter = 'grayscale(0.7) sepia(0.15) brightness(0.62) contrast(1.35)';
      ctx.scale(k / pxPerM, k / pxPerM);
      ctx.drawImage(img, -(p.x + size / 2) * pxPerM, -(p.z + size / 2) * pxPerM);
      ctx.filter = 'none';
      ctx.scale(pxPerM / k, pxPerM / k);
    }
    // Blips, in metres relative to the player (still rotated)
    const blip = (x, z, color, r = 4, label = null, clampEdge = false) => {
      let dx = (x - p.x) * k;
      let dz = (z - p.z) * k;
      const d = Math.hypot(dx, dz);
      if (d > R - 8) {
        if (!clampEdge) return;
        dx *= (R - 8) / d;
        dz *= (R - 8) / d;
      }
      ctx.save();
      ctx.translate(dx, dz);
      ctx.rotate(-rot);
      ctx.beginPath();
      ctx.arc(0, 0, label ? 8 : r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.stroke();
      if (label) {
        ctx.fillStyle = '#1a1208';
        ctx.font = '600 11px Oswald, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 1);
      }
      ctx.restore();
    };
    for (const b of g.blips()) blip(b.x, b.z, b.color, b.r || 4, b.label, b.edge);
    if (this.waypoint) blip(this.waypoint.x, this.waypoint.z, '#c9a24a', 4, null, true);
    ctx.restore();
    // Player arrow: facing relative to the camera
    const rel = g.player.yaw - yaw;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-rel);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    // Rim shading
    const grd = ctx.createRadialGradient(R, R, R * 0.6, R, R, R);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.fill();
    // North marker on the rim
    const nAng = rot - Math.PI / 2;
    const n = document.querySelector('.minimap-n');
    if (n) {
      const rr = this.mini.clientWidth / 2;
      n.style.left = `${rr + Math.cos(nAng) * (rr - 9)}px`;
      n.style.top = `${rr + Math.sin(nAng) * (rr - 9) - 8}px`;
    }
  }
}
