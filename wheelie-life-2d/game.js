(() => {
'use strict';
const W = 960, H = 720;
const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- tuning (same feel as the 3D version) -----------------------------------
const T = { balance: 0.92, looseOut: 0.42, throttleTorque: 3.6, gravityTorque: 2.0, brakeTorque: 6, sweet: 0.11, minWheelie: 0.3 };
const PX_PER_M = 60;          // scenery scroll scale
const RX = 380, GROUND = 677, R = 70, WHEELBASE = 340; // rear axle x, road contact y, wheel radius, wheelbase (px)

// ---- seeded random so pre-rendered tiles are stable --------------------------
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rr = (a, b) => a + rnd() * (b - a);

// ---- pre-rendered parallax layers -------------------------------------------
function layer(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }

const bushes = layer(1400, 330, (g, w, h) => {
  const blobs = [];
  for (let x = 40; x < w - 120; x += rr(170, 230)) blobs.push({ x: x + 100, y: h - rr(70, 130), r: rr(95, 130) });
  const parts = (b) => { const out = []; for (let i = 0; i < 7; i++) out.push({ x: b.x + rr(-b.r, b.r) * 0.9, y: b.y - rr(0, b.r * 0.7), r: b.r * rr(0.45, 0.7) }); out.push({ x: b.x, y: b.y - b.r * 0.2, r: b.r * 0.85 }); return out; };
  const all = blobs.flatMap(parts);
  g.fillStyle = '#1a0f08';
  for (const p of all) { g.beginPath(); g.arc(p.x, p.y, p.r + 4, 0, 6.3); g.fill(); }
  g.fillStyle = '#a8672c';
  for (const p of all) { g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.3); g.fill(); }
  g.fillStyle = 'rgba(255,190,110,.18)';
  for (const p of all) { g.beginPath(); g.arc(p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.55, 0, 6.3); g.fill(); }
  const branch = (x, y, len, ang, wd) => {
    if (len < 12 || wd < 1) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.strokeStyle = '#2a1408'; g.lineWidth = wd; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    branch(x2, y2, len * rr(0.68, 0.8), ang - rr(0.35, 0.7), wd * 0.68);
    branch(x2, y2, len * rr(0.68, 0.8), ang + rr(0.35, 0.7), wd * 0.68);
  };
  for (const b of blobs) branch(b.x + rr(-20, 20), h - 10, rr(60, 80), -Math.PI / 2, 15);
});

const fence = layer(240, 120, (g, w, h) => {
  const rails = [30, 70];
  g.fillStyle = '#a06a1c';
  for (const x of [20, 120, 220]) g.fillRect(x - 9, 0, 18, h - 6);
  g.fillStyle = '#e2b866';
  for (const x of [20, 120, 220]) g.fillRect(x - 9, 0, 18, 26);
  for (const y of rails) { g.fillStyle = '#d9ad5a'; g.fillRect(0, y, w, 22); g.fillStyle = '#b98a3e'; g.fillRect(0, y + 17, w, 5); g.fillStyle = '#f0cf8a'; g.fillRect(0, y, w, 3); }
});

const road = layer(240, 340, (g, w, h) => {
  g.fillStyle = '#454545'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.06)';
  for (let i = 0; i < 260; i++) g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(1, 2));
  g.fillStyle = 'rgba(255,255,255,.05)';
  for (let i = 0; i < 160; i++) g.fillRect(rr(0, w), rr(0, h), rr(1, 2), 1);
});

const BILLS = [
  { x: 0, w: 220, h: 170, bg: '#0b0b0b', draw: (g, x, y) => { g.fillStyle = '#fff'; g.font = 'italic 800 34px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('WHEELIE', x + 110, y + 82); g.fillStyle = '#ffb02e'; g.fillText('LIFE', x + 110, y + 120); } },
  { x: 520, w: 210, h: 190, bg: '#3d5a80', draw: (g, x, y) => { g.fillStyle = '#e9f1fc'; g.font = '800 30px Arial'; g.textAlign = 'center'; g.fillText('BALANCE', x + 105, y + 90); g.fillText('CO.', x + 105, y + 126); } },
  { x: 1000, w: 200, h: 200, bg: '#1d3b1f', draw: (g, x, y) => { g.fillStyle = '#9fe6a4'; g.font = 'italic 800 34px Arial'; g.textAlign = 'center'; g.fillText('TRAIL', x + 100, y + 90); g.fillText('RIDE', x + 100, y + 128); } },
];
const BILL_LOOP = 1500;

// ---- bike + rider (drawn facing right, rear axle at origin, up = -y) -------------
const C = { frame: '#52a85a', frameDk: '#1d4a24', black: '#151515', fork: '#c39a5c', skin: '#e3a15c', shirt: '#b5b5b5', shorts: '#4b4b4b', shoe: '#8a8a8a', line: '#101010' };
function poly(g, pts, fill, stroke = C.line, w = 3) {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = w; g.lineJoin = 'round'; g.stroke(); }
}
function seg(g, a, b, wd, col, outline = true) {
  g.lineCap = 'round';
  if (outline) { g.strokeStyle = C.line; g.lineWidth = wd + 5; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
}
function wheel(g, cx, cy, ang) {
  g.save(); g.translate(cx, cy); g.rotate(ang);
  g.fillStyle = C.line; g.beginPath(); g.arc(0, 0, R + 3, 0, 6.3); g.fill();
  g.fillStyle = '#242424';
  for (let i = 0; i < 40; i++) { g.save(); g.rotate((i / 40) * 6.283); g.fillRect(-3.5, -R - 6, 7, 9); g.restore(); }
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 13; g.beginPath(); g.arc(0, 0, R - 6, 0, 6.3); g.stroke();
  g.strokeStyle = '#8b96a8'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R - 15, 0, 6.3); g.stroke();
  g.strokeStyle = 'rgba(150,165,190,.75)'; g.lineWidth = 1.2;
  for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283; g.beginPath(); g.moveTo(Math.cos(a + 0.5) * 13, Math.sin(a + 0.5) * 13); g.lineTo(Math.cos(a) * (R - 16), Math.sin(a) * (R - 16)); g.stroke(); }
  g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(0, 0, 15, 0, 6.3); g.fill(); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#666'; g.beginPath(); g.arc(0, 0, 5, 0, 6.3); g.fill();
  g.restore();
}
function bikeAndRider(g, pitch, wheelAng, gas) {
  const FX = WHEELBASE;
  // front wheel + fork + fender (behind the frame)
  wheel(g, FX, 0, wheelAng);
  seg(g, [242, -150], [FX, 0], 14, '#2a2a2a');
  seg(g, [242, -150], [284, -92], 15, C.fork);
  poly(g, [[FX - 62, -R + 8], [FX - 20, -R - 14], [FX + 34, -R + 2], [FX + 10, -R + 14], [FX - 30, -R + 2]], C.black);
  // swingarm + rear wheel
  wheel(g, 0, 0, wheelAng);
  seg(g, [0, 0], [112, -22], 13, C.frame);
  // shock + tail
  seg(g, [70, -30], [120, -108], 7, '#333');
  poly(g, [[14, -137], [70, -150], [186, -130], [222, -114], [178, -100], [80, -108], [24, -120]], C.black);
  // frame
  poly(g, [[70, -28], [148, -146], [214, -138], [246, -96], [176, -40], [122, -14]], C.frame);
  poly(g, [[124, -48], [164, -112], [204, -104], [164, -46]], C.black, C.frameDk, 2);
  poly(g, [[112, -22], [176, -36], [188, -18], [130, -4]], C.frame);
  // head tube + bars
  seg(g, [238, -158], [250, -136], 16, '#2a2a2a');
  seg(g, [232, -166], [226, -176], 8, '#222');
  g.fillStyle = C.black; g.beginPath(); g.arc(231, -169, 14, 0, 6.3); g.fill(); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
  // rider; leans back as the wheel lifts
  const L = pitch * 0.12, cos = Math.cos(L), sin = Math.sin(L);
  const rot = ([x, y]) => [127 + (x - 127) * cos + (y + 135) * sin, -135 + -(x - 127) * sin + (y + 135) * cos];
  const shoulder = rot([150, -227]), head = rot([166, -284]), hip = [127, -135];
  const knee = [152, -88], foot = [156, -22], grip = [231, -169];
  // far leg
  seg(g, hip, [knee[0] + 8, knee[1]], 30, C.shorts);
  seg(g, [knee[0] + 8, knee[1]], [foot[0] + 8, foot[1]], 18, C.skin);
  // torso
  seg(g, hip, shoulder, 46, C.shirt);
  seg(g, hip, [hip[0], hip[1] + 6], 46, C.shorts);
  // near leg
  seg(g, hip, knee, 32, C.shorts);
  seg(g, knee, foot, 20, C.skin);
  poly(g, [[foot[0] - 14, foot[1] - 4], [foot[0] + 28, foot[1] - 2], [foot[0] + 30, foot[1] + 14], [foot[0] - 14, foot[1] + 14]], C.shoe);
  // arm
  const mid = [(shoulder[0] + grip[0]) / 2, (shoulder[1] + grip[1]) / 2 + 14];
  seg(g, shoulder, mid, 16, C.skin);
  seg(g, mid, grip, 14, C.skin);
  seg(g, shoulder, [(shoulder[0] + mid[0]) / 2, (shoulder[1] + mid[1]) / 2], 20, C.shirt);
  // head + helmet
  g.fillStyle = C.skin; g.beginPath(); g.arc(head[0] + 4, head[1] + 4, 22, 0, 6.3); g.fill(); g.strokeStyle = C.line; g.lineWidth = 3; g.stroke();
  poly(g, [[head[0] - 30, head[1] + 2], [head[0] - 24, head[1] - 26], [head[0] + 6, head[1] - 34], [head[0] + 34, head[1] - 14], [head[0] + 46, head[1] - 8], [head[0] + 22, head[1] - 2], [head[0] + 16, head[1] + 6], [head[0] - 8, head[1] + 14], [head[0] - 22, head[1] + 18]], '#161616');
  seg(g, [head[0] + 4, head[1] - 10], [head[0] + 36, head[1] - 10], 3, '#5a5a5a', false);
}

// ---- audio --------------------------------------------------------------------
const audio = (() => {
  let ctx, o1, o2, gn, master, muted = store.get('wl2d-muted', false);
  return {
    init() {
      if (ctx) { ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.35; master.connect(ctx.destination);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.connect(master);
      gn = ctx.createGain(); gn.gain.value = 0; gn.connect(lp);
      o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.connect(gn); o1.start();
      o2 = ctx.createOscillator(); o2.type = 'square'; const g2 = ctx.createGain(); g2.gain.value = 0.4; o2.connect(g2); g2.connect(gn); o2.start();
    },
    update(v, gas, on) {
      if (!ctx) return; const t = ctx.currentTime, gear = Math.min(4, 1 + Math.floor(v / 7)), f = 40 + (((v % 7) / 7) * 0.7 + 0.2 + gas * 0.35) * 110 + gear * 5;
      o1.frequency.setTargetAtTime(f, t, 0.04); o2.frequency.setTargetAtTime(f / 2, t, 0.04);
      gn.gain.setTargetAtTime(on ? 0.1 + gas * 0.22 : 0, t, 0.06);
    },
    crash() {
      if (!ctx) return;
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2500, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.9);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1); s.connect(f); f.connect(g); g.connect(master); s.start();
    },
    toggleMute() { muted = !muted; store.set('wl2d-muted', muted); if (master) master.gain.value = muted ? 0 : 0.35; },
  };
})();

// ---- state ---------------------------------------------------------------------
let state = 'idle';          // idle | run | crash | over
let best = store.get('wl2d-best', 0);
const S = {};
const puffs = [];
function reset() {
  Object.assign(S, { v: 0, pitch: 0, omega: 0, gas: 0, score: 0, wheelieTime: 0, sweetTime: 0, mult: 1, scroll: 0, wheelAng: 0, crashT: 0, time: 0 });
  puffs.length = 0;
}
reset();

const keys = new Set(); let holdGas = false, holdBrake = false;
const gasOn = () => keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW') || holdGas;
const brakeOn = () => keys.has('ArrowDown') || keys.has('KeyS') || holdBrake;

const msg = $('msg');
function say(html) { msg.innerHTML = html || ''; }
function begin() {
  audio.init(); reset(); state = 'run'; say('');
}
function halt() { state = 'idle'; reset(); audio.update(0, 0, false); showIdle(); }
function showIdle() { say('Press the green flag or Enter<small>Hold Space to lift the front wheel</small>'); }
showIdle();

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'Enter' || (e.code === 'Space' && (state === 'idle' || state === 'over'))) { if (state !== 'run' && state !== 'crash') begin(); }
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); holdGas = holdBrake = false; });
$('flag').addEventListener('click', () => { if (state !== 'crash') begin(); });
$('stop').addEventListener('click', halt);
$('stage').addEventListener('pointerdown', (e) => { if (e.target.id === 'brake') return; if (state === 'idle' || state === 'over') begin(); else holdGas = true; });
addEventListener('pointerup', () => { holdGas = false; holdBrake = false; });
$('brake').addEventListener('pointerdown', (e) => { holdBrake = true; e.stopPropagation(); });
$('full').addEventListener('click', () => { const el = $('player'); if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); });

// ---- simulation -----------------------------------------------------------------
function step(dt) {
  const gas = gasOn(), brake = brakeOn();
  S.gas = clamp(S.gas + ((gas ? 1 : 0) - S.gas) * Math.min(1, dt * 9), 0, 1);
  S.time += dt;
  // a gentle cruise that builds over the ride; gas adds a push, brake sheds a little speed
  S.v = clamp(S.v + ((Math.min(30, 9 + S.time * 0.25) - S.v) * 0.3 + S.gas * 3.5 - (brake ? 2.5 : 0)) * dt, 0, 34);
  const stab = 2.6 + S.v * 0.02;
  S.omega += (T.throttleTorque * S.gas + T.gravityTorque * Math.sin(S.pitch - T.balance) - (brake ? T.brakeTorque : 0) - stab * S.omega) * dt;
  S.pitch += S.omega * dt;
  if (S.pitch <= 0) { S.pitch = 0; S.omega = Math.max(0, S.omega); }
  if (S.pitch > T.balance + T.looseOut) return crash();

  const mph = S.v * 2.237;
  const wheelie = S.pitch > T.minWheelie;
  const sweet = wheelie && Math.abs(S.pitch - T.balance) < T.sweet;
  if (wheelie) {
    S.wheelieTime += dt; if (sweet) S.sweetTime += dt;
    S.mult = Math.min(10, 1 + Math.floor(S.wheelieTime / 6) + Math.floor(S.sweetTime / 3));
    S.score += mph * S.mult * dt * (sweet ? 0.9 : 0.6);
  } else if (S.wheelieTime > 0) { S.wheelieTime = 0; S.sweetTime = 0; S.mult = 1; }

  const dx = S.v * PX_PER_M * dt;
  S.scroll += dx; S.wheelAng += dx / R;
  if (S.gas > 0.3 && S.v > 1 && Math.random() < 0.6) puffs.push({ x: RX - 40, y: GROUND - 6, vx: -60 - Math.random() * 60, vy: -20 - Math.random() * 30, r: 6 + Math.random() * 8, a: 0.5 });
}
function crash() {
  state = 'crash'; S.crashT = 0; S.omega = Math.max(S.omega, 1.6); audio.crash(); audio.update(0, 0, false);
}
function stepCrash(dt) {
  S.crashT += dt;
  S.v *= Math.pow(0.02, dt);
  S.pitch = Math.min(S.pitch + S.omega * dt, 2.75);
  S.omega *= Math.pow(0.5, dt);
  S.scroll += S.v * PX_PER_M * dt; S.wheelAng += S.v * PX_PER_M * dt / R;
  if (S.crashT > 1.7) {
    state = 'over';
    const sc = Math.floor(S.score);
    const isBest = sc > best; if (isBest) { best = sc; store.set('wl2d-best', best); }
    say(`Wiped out!<small>Score ${sc.toLocaleString()}${isBest ? ' — new high score' : ''} · press Enter to ride again</small>`);
  }
}

// ---- render ------------------------------------------------------------------------
function drawScene() {
  const g = ctx, sc = S.scroll;
  const sky = g.createLinearGradient(0, 0, 0, 470); sky.addColorStop(0, '#2c1a0d'); sky.addColorStop(1, '#6b4322'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
  // billboards (slow parallax)
  const bo = (sc * 0.1) % BILL_LOOP;
  for (const b of BILLS) for (const k of [-1, 0, 1]) {
    const x = b.x - bo + k * BILL_LOOP; if (x > W || x + b.w < 0) continue;
    const y = 120 + (200 - b.h) * 0.2;
    g.fillStyle = '#7a7a7a'; g.fillRect(x + b.w / 2 - 8, y + b.h, 16, 200);
    g.fillStyle = '#cfcfcf'; g.fillRect(x - 4, y + b.h, b.w + 8, 6);
    g.fillStyle = b.bg; g.fillRect(x, y, b.w, b.h); g.strokeStyle = '#1a1a1a'; g.lineWidth = 4; g.strokeRect(x, y, b.w, b.h);
    b.draw(g, x, y);
  }
  // bushes and trees
  const bx = -((sc * 0.28) % bushes.width); g.drawImage(bushes, bx, 195); g.drawImage(bushes, bx + bushes.width, 195);
  // fence
  const fx = -((sc * 0.7) % fence.width);
  for (let x = fx; x < W; x += fence.width) g.drawImage(fence, x, 318);
  // orange grass strip with wavy top edge
  g.fillStyle = '#d97a12'; g.fillRect(0, 418, W, 60);
  g.fillStyle = '#b8600b'; g.fillRect(0, 418, W, 6);
  g.strokeStyle = '#3a2410'; g.lineWidth = 4; g.beginPath();
  for (let x = 0; x <= W; x += 20) { const y = 452 + Math.sin((x + sc * 0.9) * 0.02) * 10 + Math.sin((x + sc * 0.9) * 0.05) * 4; x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  // road
  g.fillStyle = '#454545'; g.fillRect(0, 462, W, H - 462);
  const rx = -(sc % road.width); for (let x = rx; x < W; x += road.width) g.drawImage(road, x, 462, road.width, H - 462 > 340 ? 340 : H - 462);
  g.fillStyle = '#b7b7b7'; g.fillRect(0, 490, W, 16);
  g.fillStyle = '#b9a53a'; g.fillRect(0, 561, W, 10); g.fillRect(0, 585, W, 10);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 506, W, 6);
}
function drawBike() {
  const g = ctx, lift = clamp(S.pitch / 0.5, 0, 1);
  // shadow under the wheels
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(RX + 160 * (1 - lift * 0.6), GROUND + 6, 230 - lift * 110, 12, 0, 0, 6.3); g.fill();
  for (const p of puffs) { g.fillStyle = `rgba(210,190,160,${p.a})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.3); g.fill(); }
  g.save();
  g.translate(RX, GROUND - R);
  g.rotate(-S.pitch);
  bikeAndRider(g, S.pitch, S.wheelAng, S.gas);
  g.restore();
}
function updateHud() {
  $('score').textContent = Math.floor(S.score);
  $('mph').textContent = Math.round(S.v * 2.237);
  $('mult').textContent = S.mult;
  $('high').textContent = Math.max(best, Math.floor(S.score)).toLocaleString();
}
function fitHud() { const st = $('stage').getBoundingClientRect(); $('hud').style.transform = `scale(${st.width / 1248})`; }
addEventListener('resize', fitHud); fitHud();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'run') { step(dt); audio.update(S.v, S.gas, true); }
  else if (state === 'crash') stepCrash(dt);
  else audio.update(0, 0, false);
  for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 14 * dt; p.a -= dt * 0.9; if (p.a <= 0) puffs.splice(i, 1); }
  drawScene(); drawBike(); updateHud();
}
requestAnimationFrame(frame);
window.__wl2 = { S, T, get state() { return state; }, begin };
})();
