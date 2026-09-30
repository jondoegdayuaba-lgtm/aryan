// Cluckworks front end: canvas farm, HUD, shop, saving and sound.
(function () {
  'use strict';
  const C = window.Cluck;
  const $ = id => document.getElementById(id);

  // The farm is drawn in an 800×500 world, scaled to fit the canvas.
  const W = 800, H = 500;
  const PEN = { x: 200, y: 232, w: 400, h: 196 };
  const TROUGH = { x: 240, y: 196, w: 150, h: 26 };
  const COOP = { x: 22, y: 120, w: 160, h: 230 };
  const MARKET = { x: 628, y: 128, w: 158, h: 222 };
  const ROAD_Y = 462;
  const MAX_HENS = 60, MAX_EGGS = 240;
  const SAVE_KEY = 'cluckworks-save', BEST_KEY = 'cluckworks-best', MUTE_KEY = 'cluckworks-mute';

  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };

  let s = null;
  let running = false;
  let hens = [], eggs = [], floaters = [], puffs = [];
  let bot = null;
  let henQty = '1';
  let clock = 0, last = 0, saveT = 0, uiT = 0;
  let incomeWin = [];

  // ---------- storage (never trusted to exist) ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function save() {
    if (!s) return;
    const { events, ...rest } = s;
    store.set(SAVE_KEY, rest);
  }

  function loadSave() {
    const raw = store.get(SAVE_KEY);
    if (!raw || raw.v !== 1 || !C.MODES[raw.mode]) return null;
    const fresh = C.newGame(raw.mode);
    return { ...fresh, ...raw, lv: { ...fresh.lv, ...raw.lv }, stats: { ...fresh.stats, ...raw.stats }, events: [] };
  }

  // ---------- sound ----------
  const audio = {
    ctx: null, muted: !!store.get(MUTE_KEY), last: {},
    ensure() {
      if (this.ctx) return;
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    },
    tone(freq, dur, type = 'sine', vol = 0.12, slide = 0, delay = 0) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur);
    },
    // Rate-limit each sound so a busy farm stays pleasant.
    play(name) {
      const now = performance.now();
      if (now - (this.last[name] || 0) < 90) return;
      this.last[name] = now;
      switch (name) {
        case 'cluck': this.tone(700 + Math.random() * 200, 0.09, 'square', 0.04, 0.55); break;
        case 'pop': this.tone(520, 0.07, 'triangle', 0.1, 1.6); break;
        case 'coin': this.tone(990, 0.08, 'square', 0.05); this.tone(1320, 0.14, 'square', 0.05, 1, 0.07); break;
        case 'buy': this.tone(440, 0.08, 'triangle', 0.12); this.tone(660, 0.12, 'triangle', 0.12, 1, 0.08); break;
        case 'no': this.tone(180, 0.12, 'sawtooth', 0.05, 0.8); break;
        case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.14, 1, i * 0.12)); break;
      }
    },
  };

  // ---------- formatting ----------
  function money(n) {
    if (n < 10) return '$' + n.toFixed(2).replace(/\.00$/, '');
    if (n < 1000) return '$' + Math.floor(n);
    const units = ['K', 'M', 'B', 'T'];
    let i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return '$' + (n < 100 ? n.toFixed(n < 10 ? 2 : 1) : Math.floor(n)) + units[i];
  }
  const count = n => n >= 10000 ? money(n).slice(1) : String(Math.floor(n));
  function clockText(t) {
    const m = Math.floor(t / 60), sec = Math.floor(t % 60), cs = Math.floor((t % 1) * 10);
    return `${m}:${String(sec).padStart(2, '0')}.${cs}`;
  }

  // ---------- canvas sizing and input ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const sc = Math.min(r.width / W, r.height / H);
    view = { s: sc * dpr, ox: (r.width - W * sc) / 2 * dpr, oy: (r.height - H * sc) / 2 * dpr, w: canvas.width, h: canvas.height, dpr };
  }

  function toWorld(ev) {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) * view.dpr, y = (ev.clientY - r.top) * view.dpr;
    return { x: (x - view.ox) / view.s, y: (y - view.oy) / view.s };
  }

  const inside = (p, b, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

  canvas.addEventListener('pointerdown', ev => {
    if (!running) return;
    audio.ensure();
    const p = toWorld(ev);
    // Eggs first (they are small and sit on top), then hens, then buildings.
    let best = null, bd = 18 * 18;
    for (const e of eggs) {
      const d = (e.x - p.x) ** 2 + (e.y - 6 - p.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { pickEgg(best); return; }
    let hen = null; bd = 22 * 22;
    for (const h of hens) {
      const d = (h.x - p.x) ** 2 + (h.y - 12 - p.y) ** 2;
      if (d < bd) { bd = d; hen = h; }
    }
    if (hen) { pokeHen(hen); return; }
    if (inside(p, MARKET)) { doSell(); return; }
    if (inside(p, TROUGH, 8)) { doFeed(); return; }
    if (inside(p, COOP)) { doHen(); return; }
    if (inside(p, PEN)) { doGather(); }
  });

  // ---------- actions ----------
  function float(x, y, text, color = '#3a2a1a', size = 18) {
    floaters.push({ x, y, text, color, size, t: 0 });
  }

  function pickEgg(e) {
    const [k, g] = C.collect(s, 1, e.g);
    s.stats.clicks++;
    if (k + g) {
      eggs.splice(eggs.indexOf(e), 1);
      audio.play('pop');
      puff(e.x, e.y - 6, e.g ? '#f5b82e' : '#fff6e0');
    } else {
      hint('Your basket is full. Tap the market to sell.');
      audio.play('no');
    }
  }

  function pokeHen(h) {
    h.hop = 0.3;
    audio.play('cluck');
    if (C.poke(s)) placeNewEggs(h);
    else if (s.feed < C.feedPerEgg(s)) { hint('The hens are hungry. Tap the trough to buy feed.'); h.hungry = 1.2; }
    else if (C.floorCount(s) >= C.val(s, 'nests')) hint('No room for more eggs. Pick some up first.');
  }

  function doGather() {
    s.stats.clicks++;
    const [k, g] = C.collect(s, C.HANDFUL);
    if (k + g) audio.play('pop');
    else if (C.basketCount(s) >= C.val(s, 'basket')) { hint('Your basket is full. Sell at the market.'); audio.play('no'); }
  }

  function doSell() {
    s.stats.clicks++;
    if (!C.sell(s, 'hand')) { audio.play('no'); hint('Your basket is empty. Pick up some eggs first.'); }
  }

  function doFeed() {
    if (C.buyFeed(s)) { audio.play('buy'); float(TROUGH.x + TROUGH.w / 2, TROUGH.y - 8, `+${C.feedBagCost(s).amt || C.FEED_BAG} feed`, '#8a5a12', 15); }
    else audio.play('no');
  }

  function doHen() {
    const want = henQty === 'max' ? Infinity : +henQty;
    if (C.buyHens(s, want)) audio.play('buy');
    else {
      audio.play('no');
      if (s.hens >= C.val(s, 'coop')) hint('The coop is full. Upgrade it for more room.');
    }
  }

  let hintT = 0;
  function hint(text) { $('hint').textContent = text; hintT = 3.5; }

  // ---------- farm scene state ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  function penPoint() {
    return { x: rand(PEN.x + 18, PEN.x + PEN.w - 18), y: rand(PEN.y + 26, PEN.y + PEN.h - 8) };
  }

  function syncHens() {
    const want = Math.min(s.hens, MAX_HENS);
    const goldShare = C.val(s, 'golden') * 4;
    while (hens.length < want) {
      const p = { x: COOP.x + COOP.w - 10, y: COOP.y + COOP.h - 20 };
      const t = penPoint();
      hens.push({ x: p.x, y: p.y, tx: t.x, ty: t.y, wait: 0, dir: 1, phase: Math.random() * 7,
        speed: rand(22, 38), peck: 0, hop: 0, hungry: 0, gold: false, tint: Math.random() });
    }
    hens.length = want;
    for (const h of hens) h.gold = h.tint < goldShare;
  }

  // Eggs on screen follow the floor counts; new ones appear under hens.
  function placeNewEggs(near) {
    const cap = MAX_EGGS;
    let vg = eggs.filter(e => e.g).length, vn = eggs.length - vg;
    const wantG = Math.min(s.floorG, cap), wantN = Math.min(s.floorN, cap - wantG);
    const spawn = g => {
      const h = near || hens[Math.floor(Math.random() * hens.length)];
      const x = h ? h.x + rand(-6, 6) : rand(PEN.x + 20, PEN.x + PEN.w - 20);
      const y = h ? h.y + rand(-2, 4) : rand(PEN.y + 30, PEN.y + PEN.h - 10);
      eggs.push({ x: Math.max(PEN.x + 10, Math.min(PEN.x + PEN.w - 10, x)), y: Math.max(PEN.y + 20, Math.min(PEN.y + PEN.h - 4, y)),
        g, born: 0, rot: rand(-0.4, 0.4) });
    };
    while (vg < wantG) { spawn(true); vg++; }
    while (vn < wantN) { spawn(false); vn++; }
  }

  function trimEggs() {
    const wantG = Math.min(s.floorG, MAX_EGGS), wantN = Math.min(s.floorN, MAX_EGGS - wantG);
    let vg = eggs.filter(e => e.g).length, vn = eggs.length - vg;
    // Remove the eggs closest to the bot when it is working, oldest otherwise.
    const pickOne = g => {
      let idx = -1, bd = Infinity;
      for (let i = 0; i < eggs.length; i++) {
        if (eggs[i].g !== g) continue;
        const d = bot ? (eggs[i].x - bot.x) ** 2 + (eggs[i].y - bot.y) ** 2 : i;
        if (d < bd) { bd = d; idx = i; }
      }
      if (idx >= 0) eggs.splice(idx, 1);
    };
    while (vg > wantG) { pickOne(true); vg--; }
    while (vn > wantN) { pickOne(false); vn--; }
  }

  function puff(x, y, color) {
    for (let i = 0; i < 6; i++) puffs.push({ x, y, vx: rand(-40, 40), vy: rand(-70, -20), t: 0, color });
  }

  function handleEvents() {
    for (const e of s.events) {
      switch (e.t) {
        case 'lay': if (e.g) { audio.play('cluck'); } break;
        case 'sell': {
          audio.play('coin');
          incomeWin.push({ t: clock, a: e.amount });
          float(MARKET.x + MARKET.w / 2, MARKET.y - 36, '+' + money(e.amount), '#2f7a2b', e.by === 'van' ? 18 : 22);
          break;
        }
        case 'hen': syncHens(); break;
        case 'upgrade': audio.play('buy'); buildShop(); break;
        case 'win': audio.play('win'); showWin(); break;
      }
    }
    s.events.length = 0;
  }

  // ---------- simulation of the little animals ----------
  function updateScene(dt) {
    const hungry = s.feed < C.feedPerEgg(s);
    for (const h of hens) {
      h.hop = Math.max(0, h.hop - dt);
      h.hungry = Math.max(0, h.hungry - dt);
      if (h.wait > 0) {
        h.wait -= dt;
        h.peck = (h.peck + dt * 5) % (Math.PI * 2);
        continue;
      }
      const dx = h.tx - h.x, dy = h.ty - h.y, d = Math.hypot(dx, dy);
      if (d < 2) {
        h.wait = rand(0.6, 3);
        // Hungry hens gather at the trough; fed ones sometimes wander over to eat.
        const t = hungry || Math.random() < 0.15
          ? { x: rand(TROUGH.x + 10, TROUGH.x + TROUGH.w - 10), y: TROUGH.y + TROUGH.h + rand(14, 24) }
          : penPoint();
        h.tx = t.x; h.ty = t.y;
      } else {
        const step = Math.min(d, h.speed * dt * (hungry ? 1.4 : 1));
        h.x += dx / d * step; h.y += dy / d * step;
        if (Math.abs(dx) > 1) h.dir = dx > 0 ? 1 : -1;
      }
    }

    const botRate = C.val(s, 'bot');
    if (botRate && !bot) bot = { x: PEN.x + PEN.w / 2, y: PEN.y + PEN.h / 2, t: 0 };
    if (bot) {
      bot.t += dt;
      let target = null, bd = Infinity;
      for (const e of eggs) {
        const d = (e.x - bot.x) ** 2 + (e.y - bot.y) ** 2;
        if (d < bd) { bd = d; target = e; }
      }
      const goal = target || { x: PEN.x + PEN.w / 2, y: PEN.y + PEN.h - 30 };
      const dx = goal.x - bot.x, dy = goal.y - bot.y, d = Math.hypot(dx, dy);
      const sp = 50 + Math.min(botRate, 300) * 0.8;
      if (d > 1) { const st = Math.min(d, sp * dt); bot.x += dx / d * st; bot.y += dy / d * st; }
    }

    for (const e of eggs) e.born = Math.min(1, e.born + dt * 5);
    for (const f of floaters) { f.t += dt; f.y -= 28 * dt; }
    floaters = floaters.filter(f => f.t < 1.3);
    for (const p of puffs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; }
    puffs = puffs.filter(p => p.t < 0.5);
  }

  // ---------- drawing ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  function ell(x, y, rx, ry, fill, rot = 0) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }
  const INK = '#3a2a1a';

  function drawBackground() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#8fcf5b';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);

    // Sky that fades into the grass at the horizon, extended sideways past the world.
    const g = ctx.createLinearGradient(0, 0, 0, 150);
    g.addColorStop(0, '#9fd8ff'); g.addColorStop(1, '#d9f1ff');
    ctx.fillStyle = g; ctx.fillRect(-400, -400, W + 800, 550);
    ell(700, 60, 34, 34, '#fff3b0');
    for (const [x, y, k] of [[120, 50, 1], [390, 80, 0.8], [560, 36, 0.6]]) {
      const drift = (clock * 6 * k) % (W + 200);
      const cx = ((x + drift) % (W + 200)) - 100;
      ell(cx, y, 38 * k, 14 * k, '#ffffff'); ell(cx + 22 * k, y - 8 * k, 24 * k, 14 * k, '#ffffff'); ell(cx - 20 * k, y - 4 * k, 20 * k, 11 * k, '#ffffff');
    }
    // Hills
    ctx.fillStyle = '#a8dc74';
    ctx.beginPath(); ctx.moveTo(-400, 150);
    for (let x = -400; x <= W + 400; x += 40) ctx.lineTo(x, 132 + Math.sin(x / 90) * 14);
    ctx.lineTo(W + 400, 170); ctx.lineTo(-400, 170); ctx.fill();
    ctx.fillStyle = '#8fcf5b'; ctx.fillRect(-400, 150, W + 800, 500);
    // Grass tufts (fixed pattern)
    ctx.strokeStyle = '#7bbd4a'; ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % W, y = 170 + ((i * 53) % 280);
      if (inside({ x, y }, PEN, 6) || inside({ x, y }, COOP) || inside({ x, y }, MARKET)) continue;
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 2, y - 7); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 9); ctx.moveTo(x + 4, y); ctx.lineTo(x + 5, y - 6); ctx.stroke();
    }
    // Road
    ctx.fillStyle = '#c9b48a'; ctx.fillRect(-400, ROAD_Y - 14, W + 800, 40);
    ctx.fillStyle = '#b39d72'; ctx.fillRect(-400, ROAD_Y - 14, W + 800, 4);
  }

  function drawCoop() {
    const { x, y, w, h } = COOP;
    const lv = s.lv.coop;
    // Bigger coop levels get a wider body and a loft window.
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
    rr(x, y + 70, w, h - 70, 6); ctx.fillStyle = '#c8423b'; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(x + i * w / 8, y + 72); ctx.lineTo(x + i * w / 8, y + h - 2); ctx.stroke(); }
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 10, y + 74); ctx.lineTo(x + w / 2, y + 8); ctx.lineTo(x + w + 10, y + 74); ctx.closePath();
    ctx.fillStyle = '#95302b'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 14, y + 72); ctx.lineTo(x + w / 2, y + 26); ctx.lineTo(x + w - 14, y + 72); ctx.closePath();
    ctx.fillStyle = '#c8423b'; ctx.fill();
    // Loft window
    ell(x + w / 2, y + 56, 13, 13, lv >= 2 ? '#ffe9a8' : '#fff6e0'); ctx.stroke();
    // Door with a cross brace
    const dx = x + w / 2 - 30, dy = y + h - 82;
    rr(dx, dy, 60, 82, 4); ctx.fillStyle = '#fff6e0'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dx + 4, dy + 4); ctx.lineTo(dx + 56, dy + 78); ctx.moveTo(dx + 56, dy + 4); ctx.lineTo(dx + 4, dy + 78); ctx.strokeStyle = '#c8423b'; ctx.lineWidth = 4; ctx.stroke();
    // Level stars on the roof
    ctx.fillStyle = '#f5b82e';
    for (let i = 0; i < lv; i++) star(x + w / 2 - (lv - 1) * 9 + i * 18, y + 92, 6);
    // Label
    label(x + w / 2, y + h + 18, `${s.hens} hen${s.hens === 1 ? '' : 's'} / ${C.val(s, 'coop')}`);
  }

  function star(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  }

  function label(x, y, text, bg = 'rgba(255,250,240,.92)') {
    ctx.font = '600 14px Fredoka, Trebuchet MS, sans-serif';
    const w = ctx.measureText(text).width + 16;
    rr(x - w / 2, y - 12, w, 22, 11); ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function drawPen() {
    ctx.fillStyle = '#d9c28e';
    rr(PEN.x, PEN.y, PEN.w, PEN.h, 18); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.05)';
    for (let i = 0; i < 30; i++) ell(PEN.x + 20 + (i * 131) % (PEN.w - 40), PEN.y + 20 + (i * 71) % (PEN.h - 30), 6, 2.5);
    ctx.fill();
  }

  function drawFence() {
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.fillStyle = '#f7e7c4';
    const x0 = PEN.x - 6, x1 = PEN.x + PEN.w + 6, y1 = PEN.y + PEN.h + 6;
    // Front rails and posts (the back fence is hidden behind the trough row)
    for (const yy of [y1 - 14, y1 - 4]) { rr(x0, yy, x1 - x0, 6, 3); ctx.fill(); ctx.stroke(); }
    for (let x = x0; x <= x1; x += 40) { rr(x - 4, y1 - 24, 8, 30, 3); ctx.fill(); ctx.stroke(); }
  }

  function drawTrough() {
    const { x, y, w, h } = TROUGH;
    const cap = C.val(s, 'trough'), f = Math.min(1, s.feed / cap);
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    rr(x - 4, y + h - 4, 8, 14, 2); ctx.fillStyle = '#8a5a2b'; ctx.fill(); ctx.stroke();
    rr(x + w - 4, y + h - 4, 8, 14, 2); ctx.fill(); ctx.stroke();
    rr(x, y, w, h, 6); ctx.fillStyle = '#a86b33'; ctx.fill(); ctx.stroke();
    if (f > 0) {
      ctx.fillStyle = '#e9b949';
      rr(x + 5, y + 5 + (h - 10) * (1 - f), w - 10, (h - 10) * f, 3); ctx.fill();
      ctx.fillStyle = '#cf9a2a';
      for (let i = 0; i < 12; i++) ell(x + 12 + i * 11, y + 7 + (h - 10) * (1 - f) + (i % 3), 2, 1.3);
      ctx.fill();
    }
    const low = s.feed < C.feedPerEgg(s);
    label(x + w / 2, y - 14, low ? 'Out of feed! Tap to buy' : `Feed ${Math.floor(s.feed)} / ${cap}`, low ? '#ffd9d4' : undefined);
  }

  function drawMarket() {
    const { x, y, w, h } = MARKET;
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    // Posts
    ctx.fillStyle = '#a86b33';
    rr(x + 8, y + 40, 10, h - 40, 3); ctx.fill(); ctx.stroke();
    rr(x + w - 18, y + 40, 10, h - 40, 3); ctx.fill(); ctx.stroke();
    // Counter with egg crates
    rr(x, y + h - 80, w, 80, 6); ctx.fillStyle = '#d99a52'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x + 3, y + h - 50, w - 6, 3);
    for (let i = 0; i < 3; i++) {
      const cx = x + 18 + i * 44;
      rr(cx, y + h - 100, 36, 22, 3); ctx.fillStyle = '#f0e1bd'; ctx.fill(); ctx.stroke();
      for (let j = 0; j < 3; j++) ell(cx + 8 + j * 10, y + h - 102, 5, 6.5, i === 1 && j === 1 && s.lv.golden ? '#f5b82e' : '#fff6e0');
    }
    // Striped awning
    const aw = y + 20;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#fff6e0' : '#3f9a3a';
      ctx.beginPath(); ctx.moveTo(x - 8 + i * (w + 16) / 6, aw); ctx.lineTo(x - 8 + (i + 1) * (w + 16) / 6, aw);
      ctx.lineTo(x - 8 + (i + 1) * (w + 16) / 6, aw + 34); ctx.arc(x - 8 + (i + 0.5) * (w + 16) / 6, aw + 34, (w + 16) / 12, 0, Math.PI); ctx.fill();
    }
    rr(x - 8, aw, w + 16, 34, 4); ctx.stroke();
    // Sign
    rr(x + 24, y - 14, w - 48, 30, 8); ctx.fillStyle = '#fff6e0'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = '700 17px Fredoka, Trebuchet MS, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MARKET', x + w / 2, y + 1);
    const price = C.eggValue(s, false);
    label(x + w / 2, y + h + 18, `${money(price)} / egg`);
    // Basket on the counter shows how full you are
    const b = C.basketCount(s) / C.val(s, 'basket');
    drawBasket(x + w / 2, y + h - 36, b);
  }

  function drawBasket(cx, cy, fill) {
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, cy - 14, 22, 20, 0, Math.PI, 0); ctx.stroke();
    if (fill > 0) {
      const n = Math.ceil(fill * 6);
      for (let i = 0; i < n; i++) ell(cx - 14 + (i % 3) * 14, cy - 2 - Math.floor(i / 3) * 8, 6, 7.5, s.basketG && i === n - 1 ? '#f5b82e' : '#fff6e0');
    }
    rr(cx - 26, cy - 4, 52, 20, 6); ctx.fillStyle = '#c98a4a'; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(58,42,26,.35)'; ctx.lineWidth = 1.5;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(cx - 26 + i * 10.4, cy - 3); ctx.lineTo(cx - 26 + i * 10.4, cy + 15); ctx.stroke(); }
  }

  function drawEgg(e) {
    const k = 0.4 + 0.6 * e.born;
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot); ctx.scale(k, k);
    ell(0, 1, 6, 2.2, 'rgba(0,0,0,.18)');
    ell(0, -6, 5.5, 7, e.g ? '#f5b82e' : '#fff6e0');
    ctx.strokeStyle = e.g ? '#b77c06' : '#b9a27a'; ctx.lineWidth = 1.4; ctx.stroke();
    ell(-2, -9, 1.6, 2.4, 'rgba(255,255,255,.8)');
    if (e.g) { ctx.fillStyle = 'rgba(255,255,255,.9)'; star(4, -12 - Math.sin(clock * 5 + e.x) * 1.5, 2.2); }
    ctx.restore();
  }

  function drawHen(h) {
    const moving = h.wait <= 0;
    const bob = moving ? Math.sin(clock * 14 + h.phase) * 1.2 : 0;
    const hop = h.hop > 0 ? -Math.sin((h.hop / 0.3) * Math.PI) * 7 : 0;
    const peck = !moving ? Math.max(0, Math.sin(h.peck)) * 5 : 0;
    const body = h.gold ? '#f7cf5e' : '#ffffff';
    const shade = h.gold ? '#dba531' : '#e6ddd0';
    ctx.save(); ctx.translate(h.x, h.y); ell(0, 1, 11, 3.2, 'rgba(0,0,0,.16)');
    ctx.translate(0, hop); ctx.scale(h.dir, 1);
    ctx.strokeStyle = '#e8892b'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const step = moving ? Math.sin(clock * 14 + h.phase) * 2 : 0;
    ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(-3 + step, 0); ctx.moveTo(3, -5); ctx.lineTo(3 - step, 0); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    // Tail
    ctx.beginPath(); ctx.moveTo(-9, -12 + bob); ctx.lineTo(-16, -21 + bob); ctx.lineTo(-11, -9 + bob); ctx.closePath();
    ctx.fillStyle = shade; ctx.fill(); ctx.stroke();
    // Body and wing
    ell(0, -11 + bob, 12, 9, body); ctx.stroke();
    ell(-2, -11 + bob, 6, 4.5, shade, -0.2);
    // Head and neck
    const hx = 9, hy = -19 + bob + peck;
    ell(hx, hy, 5.8, 5.8, body); ctx.stroke();
    ctx.fillStyle = '#d93b2e';
    ell(hx - 2, hy - 5.5, 2.2, 2.4); ctx.fill(); ell(hx + 1, hy - 6.2, 2.2, 2.6); ctx.fill();
    ell(hx + 4, hy + 3, 1.5, 2.2); ctx.fill();
    ctx.fillStyle = '#f09a26';
    ctx.beginPath(); ctx.moveTo(hx + 5, hy - 1.5); ctx.lineTo(hx + 10, hy + 0.5); ctx.lineTo(hx + 5, hy + 2); ctx.closePath(); ctx.fill();
    ell(hx + 1.8, hy - 1.2, 1.2, 1.2, INK);
    ctx.restore();
    if (h.hungry > 0 || (s.feed < C.feedPerEgg(s) && h.phase < 2.2)) {
      ctx.fillStyle = '#d93b2e'; ctx.font = '700 14px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', h.x, h.y - 36 + Math.sin(clock * 6 + h.phase) * 2);
    }
  }

  function drawBot() {
    if (!bot) return;
    const lv = s.lv.bot, b = Math.sin(bot.t * 10) * 1.5;
    ctx.save(); ctx.translate(bot.x, bot.y);
    ell(0, 2, 13, 3.5, 'rgba(0,0,0,.18)');
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    rr(-11, -20 + b, 22, 18, 6); ctx.fillStyle = '#9fc6d9'; ctx.fill(); ctx.stroke();
    rr(-7, -16 + b, 14, 8, 3); ctx.fillStyle = '#2f4a57'; ctx.fill();
    ell(-3, -12 + b, 1.6, 1.6, '#8ff0ff'); ell(3, -12 + b, 1.6, 1.6, '#8ff0ff');
    ctx.beginPath(); ctx.moveTo(0, -20 + b); ctx.lineTo(0, -27 + b); ctx.stroke();
    ell(0, -28 + b, 2.6, 2.6, lv >= 4 ? '#f5b82e' : '#d93b2e');
    ell(-7, 0, 3.5, 3.5, INK); ell(7, 0, 3.5, 3.5, INK);
    ctx.restore();
  }

  function drawVan() {
    const trip = C.val(s, 'van');
    if (!trip) return;
    // Out to the market and back along the road during each trip.
    const p = s.vanT / trip;
    const from = PEN.x + 80, to = MARKET.x + 60;
    const x = p < 0.5 ? from + (to - from) * (p * 2) : to - (to - from) * ((p - 0.5) * 2);
    const dir = p < 0.5 ? 1 : -1;
    ctx.save(); ctx.translate(x, ROAD_Y + 4); ctx.scale(dir, 1);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ell(0, 10, 34, 4, 'rgba(0,0,0,.18)');
    rr(-32, -26, 44, 30, 5); ctx.fillStyle = '#fff6e0'; ctx.fill(); ctx.stroke();
    rr(12, -18, 22, 22, 5); ctx.fillStyle = '#3f9a3a'; ctx.fill(); ctx.stroke();
    rr(17, -14, 12, 8, 2); ctx.fillStyle = '#bfe6ff'; ctx.fill();
    ell(-10, -12, 7, 8.5, '#fff'); ctx.stroke();
    ell(-19, 5, 6, 6, INK); ell(22, 5, 6, 6, INK);
    ell(-19, 5, 2.2, 2.2, '#ccc'); ell(22, 5, 2.2, 2.2, '#ccc');
    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawCoop();
    drawPen();
    drawTrough();
    drawMarket();
    // Depth sort hens, eggs and the bot together so they overlap sensibly.
    const things = [];
    for (const e of eggs) things.push({ y: e.y - 3, d: () => drawEgg(e) });
    for (const h of hens) things.push({ y: h.y, d: () => drawHen(h) });
    if (bot) things.push({ y: bot.y, d: drawBot });
    things.sort((a, b) => a.y - b.y);
    for (const t of things) t.d();
    if (s.hens > MAX_HENS) label(PEN.x + PEN.w - 70, PEN.y + 22, `+${s.hens - MAX_HENS} more hens`);
    const hidden = C.floorCount(s) - eggs.length;
    if (hidden > 0) label(PEN.x + 70, PEN.y + 22, `+${count(hidden)} more eggs`);
    drawFence();
    drawVan();
    for (const p of puffs) { ctx.globalAlpha = 1 - p.t / 0.5; ell(p.x, p.y, 3, 3, p.color); }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, 2.5 - f.t * 1.9);
      ctx.font = `700 ${f.size}px Fredoka, Trebuchet MS, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#fffaf0'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD and shop ----------
  const shopCards = {};
  function revealed(u) {
    const c = C.nextCost(s, u.id);
    return s.lv[u.id] > 0 || c === undefined || s.earned + 15 >= c * 0.35;
  }

  function buildShop() {
    const box = $('shop');
    let added = false;
    for (const u of C.UPGRADES) {
      if (shopCards[u.id] || !revealed(u)) continue;
      added = true;
      const el = document.createElement('div');
      el.className = 'upg';
      el.innerHTML = `<div><span class="name"></span><span class="lv"></span></div><div class="desc"></div><div class="eff"></div><button type="button"></button>`;
      el.querySelector('.name').textContent = u.name;
      el.querySelector('.desc').textContent = u.desc;
      el.querySelector('button').addEventListener('click', () => {
        audio.ensure();
        if (!C.buyUpgrade(s, u.id)) audio.play('no');
        refresh();
      });
      shopCards[u.id] = el;
    }
    // Keep the shop in the upgrade list's order (re-inserting restarts the fade-in, so only when needed).
    if (added) for (const u of C.UPGRADES) if (shopCards[u.id]) box.appendChild(shopCards[u.id]);
    const hiddenCount = C.UPGRADES.filter(u => !shopCards[u.id]).length;
    $('shop-more').textContent = hiddenCount ? `${hiddenCount} more upgrade${hiddenCount > 1 ? 's' : ''} to discover` : '';
  }

  function setBar(id, frac) { $(id).style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }

  function refresh() {
    buildShop();
    $('money').textContent = money(s.money);
    // Income over the last 10 seconds of real sales.
    incomeWin = incomeWin.filter(x => clock - x.t < 10);
    const inc = incomeWin.reduce((a, x) => a + x.a, 0) / Math.min(10, Math.max(1, clock - (incomeWin[0]?.t ?? clock) + 1));
    $('income').textContent = `${money(inc)}/s · ${s.hens} hens`;

    const goal = C.goal(s);
    $('goal').style.visibility = goal ? 'visible' : 'hidden';
    if (goal) {
      setBar('goal-fill', s.money / goal);
      $('goal-text').textContent = s.won ? 'Retired! Keep going as long as you like.' : `Retirement fund: ${money(s.money)} of ${money(goal)}`;
    }
    const mode = C.modeOf(s);
    $('timer').hidden = !mode.timer;
    if (mode.timer) $('timer').textContent = clockText(s.time);
    $('btn-retire').hidden = !C.canRetire(s);

    const feedCap = C.val(s, 'trough'), floorCap = C.val(s, 'nests'), bCap = C.val(s, 'basket');
    setBar('m-feed', s.feed / feedCap); $('t-feed').textContent = `${count(s.feed)} / ${count(feedCap)}`;
    setBar('m-floor', C.floorCount(s) / floorCap); $('t-floor').textContent = `${count(C.floorCount(s))} / ${count(floorCap)}`;
    setBar('m-basket', C.basketCount(s) / bCap); $('t-basket').textContent = `${count(C.basketCount(s))} / ${count(bCap)}`;
    $('m-feed').parentElement.parentElement.classList.toggle('warn', s.feed < C.feedPerEgg(s));
    $('m-floor').parentElement.parentElement.classList.toggle('warn', C.floorCount(s) >= floorCap);
    $('m-basket').parentElement.parentElement.classList.toggle('warn', C.basketCount(s) >= bCap);

    const bSpace = bCap - C.basketCount(s);
    $('c-gather').textContent = s.lv.bot ? `bot: ${C.val(s, 'bot')}/s` : `up to ${C.HANDFUL} at a time`;
    $('btn-gather').disabled = !C.floorCount(s) || bSpace <= 0;
    const worth = s.basketN * C.eggValue(s, false) + s.basketG * C.eggValue(s, true);
    $('c-sell').textContent = worth ? `for ${money(worth)}` : (s.lv.van ? 'van is on it' : 'basket is empty');
    $('btn-sell').disabled = !worth;
    const fb = C.feedBagCost(s);
    $('c-feed').textContent = fb.amt > 0 ? `${fb.amt} for ${money(fb.cost)}${s.lv.feeder ? ' · auto' : ''}` : 'trough is full';
    $('btn-feed').disabled = fb.amt <= 0 || fb.cost > s.money;
    const want = henQty === 'max' ? Infinity : +henQty;
    const q = C.henQuote(s, want);
    const room = C.val(s, 'coop') - s.hens;
    if (room <= 0) { $('l-hen').textContent = 'Coop full'; $('c-hen').textContent = 'upgrade the coop'; }
    else {
      const n = q.n || 1;
      $('l-hen').textContent = n > 1 ? `Buy ${n} hens` : 'Buy hen';
      $('c-hen').textContent = money(q.n ? q.cost : C.henCost(s));
    }
    $('btn-hen').disabled = room <= 0 || !q.n || q.cost > s.money;

    for (const u of C.UPGRADES) {
      const el = shopCards[u.id];
      if (!el) continue;
      const lv = s.lv[u.id], cost = C.nextCost(s, u.id), maxed = cost === undefined;
      el.classList.toggle('maxed', maxed);
      el.querySelector('.lv').textContent = u.values.length > 2 ? `Lv ${lv + 1}/${u.values.length}` : '';
      el.querySelector('.eff').innerHTML = maxed ? `${u.fmt(u.values[lv])}` : `${u.fmt(u.values[lv])} → <i>${u.fmt(u.values[lv + 1])}</i>`;
      const btn = el.querySelector('button');
      btn.textContent = maxed ? 'Max' : money(cost);
      btn.disabled = maxed || cost > s.money;
    }
  }

  // ---------- flow between screens ----------
  function bestTimes() { return store.get(BEST_KEY) || {}; }

  function buildTitle() {
    const saved = loadSave();
    $('btn-continue').hidden = !saved;
    if (saved) $('btn-continue').textContent = `Continue (${C.MODES[saved.mode].name}, ${money(saved.money)})`;
    const best = bestTimes();
    const box = $('modes'); box.textContent = '';
    for (const [id, m] of Object.entries(C.MODES)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mode';
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = m.name;
      b.querySelector('small').textContent = m.desc;
      if (best[id]) {
        const t = document.createElement('small'); t.className = 'best'; t.textContent = `Best: ${clockText(best[id])}`; b.appendChild(t);
      }
      b.addEventListener('click', () => {
        if (saved && !confirm('Start a new farm? Your saved farm will be replaced.')) return;
        start(C.newGame(id));
      });
      box.appendChild(b);
    }
  }

  function start(state) {
    audio.ensure();
    s = state;
    hens = []; eggs = []; floaters = []; puffs = []; bot = null; incomeWin = [];
    for (const k in shopCards) { shopCards[k].remove(); delete shopCards[k]; }
    syncHens();
    for (const h of hens) { const p = penPoint(); h.x = p.x; h.y = p.y; }
    placeNewEggs();
    $('title').hidden = true; $('win').hidden = true;
    running = true;
    refresh();
    save();
    if (s.stats.eggs === 0) hint('Tap a hen to make her lay an egg.');
  }

  function showWin() {
    running = false;
    save();
    const m = C.modeOf(s);
    const best = bestTimes();
    const isBest = !best[s.mode] || s.time < best[s.mode];
    if (isBest) { best[s.mode] = s.time; store.set(BEST_KEY, best); }
    $('win-text').textContent = `You saved ${money(s.money)} and hung up your boots${isBest ? ' — a new best time!' : '.'}`;
    const rows = [
      ['Mode', m.name], ['Time', clockText(s.time)], ['Best', clockText(best[s.mode])],
      ['Hens', s.hens], ['Eggs laid', count(s.stats.eggs)], ['Golden eggs', count(s.stats.golden)], ['Clicks', count(s.stats.clicks)],
    ];
    const dl = $('win-stats'); dl.textContent = '';
    for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); }
    $('win').hidden = false;
  }

  $('btn-continue').addEventListener('click', () => { const saved = loadSave(); if (saved) start(saved); });
  $('btn-retire').addEventListener('click', () => { C.retire(s); handleEvents(); });
  $('btn-keep').addEventListener('click', () => { $('win').hidden = true; running = true; });
  $('btn-again').addEventListener('click', () => { $('win').hidden = true; buildTitle(); $('title').hidden = false; });
  $('btn-menu').addEventListener('click', () => { save(); running = false; buildTitle(); $('title').hidden = false; });
  $('btn-gather').addEventListener('click', () => { audio.ensure(); doGather(); refresh(); });
  $('btn-sell').addEventListener('click', () => { audio.ensure(); doSell(); handleEvents(); refresh(); });
  $('btn-feed').addEventListener('click', () => { audio.ensure(); doFeed(); refresh(); });
  $('btn-hen').addEventListener('click', () => { audio.ensure(); doHen(); handleEvents(); refresh(); });
  for (const b of document.querySelectorAll('.qty button')) {
    b.addEventListener('click', () => {
      henQty = b.dataset.qty;
      for (const o of document.querySelectorAll('.qty button')) o.classList.toggle('on', o === b);
      refresh();
    });
  }
  function setMute(m) {
    audio.muted = m; store.set(MUTE_KEY, m);
    $('mute-waves').style.display = m ? 'none' : '';
    $('btn-mute').setAttribute('aria-label', m ? 'Unmute' : 'Mute');
  }
  $('btn-mute').addEventListener('click', () => setMute(!audio.muted));
  setMute(audio.muted);

  window.addEventListener('keydown', ev => {
    if (!running || ev.repeat && !'gs'.includes(ev.key.toLowerCase())) return;
    const k = ev.key.toLowerCase();
    if (k === 'g') $('btn-gather').click();
    else if (k === 's') $('btn-sell').click();
    else if (k === 'f') $('btn-feed').click();
    else if (k === 'h') $('btn-hen').click();
    else if (k === 'm') setMute(!audio.muted);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('resize', resize);

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min(0.25, (now - (last || now)) / 1000);
    last = now;
    if (s) {
      if (running) {
        clock += dt;
        C.tick(s, dt);
        placeNewEggs();
        trimEggs();
        handleEvents();
        updateScene(dt);
        uiT -= dt; if (uiT <= 0) { uiT = 0.1; refresh(); }
        saveT += dt; if (saveT > 5) { saveT = 0; save(); }
        if (hintT > 0 && (hintT -= dt) <= 0) $('hint').textContent = '';
      }
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  buildTitle();
  // Draw a farm behind the title screen.
  s = loadSave() || C.newGame('normal');
  syncHens();
  for (const h of hens) { const p = penPoint(); h.x = p.x; h.y = p.y; }
  requestAnimationFrame(frame);
})();
