// Synthesised sounds (Web Audio API): gunshots, hits, reloads. No audio files.
let ctx = null, master = null, noiseBuf = null;
let muted = false;

export function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.03);
}
export const isMuted = () => muted;

function out(vol, pan) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(master);
  } else g.connect(master);
  return g;
}

const SHOT = {
  pistol: { f: 2600, decay: 0.12, thump: 140, v: 0.7 },
  rifle: { f: 2000, decay: 0.1, thump: 110, v: 0.6 },
  shotgun: { f: 1300, decay: 0.3, thump: 80, v: 1 },
  sniper: { f: 1700, decay: 0.45, thump: 70, v: 1 },
};

// vol 0..1 (already attenuated for distance), pan -1..1
export function shot(kind, vol = 1, pan = 0) {
  if (!ctx || vol < 0.02) return;
  const s = SHOT[kind], t = ctx.currentTime, o = out(vol * s.v, pan);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(s.f * (0.6 + vol * 0.6), t);
  f.frequency.exponentialRampToValueAtTime(300, t + s.decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + s.decay);
  src.connect(f).connect(g).connect(o);
  src.start(t, Math.random() * 0.5, s.decay + 0.05);

  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(s.thump, t);
  osc.frequency.exponentialRampToValueAtTime(35, t + 0.12);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.9, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  osc.connect(og).connect(o);
  osc.start(t);
  osc.stop(t + 0.15);
}

function tone(freq, dur, vol, type = 'sine', delay = 0, slide = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function click(delay, freq = 3000, vol = 0.25) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, 0.06);
}

export const hit = (head) => head ? tone(1900, 0.12, 0.25, 'triangle') : tone(1100, 0.06, 0.18, 'square');
export const kill = () => { tone(880, 0.1, 0.25, 'triangle'); tone(1320, 0.18, 0.25, 'triangle', 0.08); };
export const hurt = () => tone(160, 0.2, 0.5, 'sawtooth', 0, 0.5);
export const empty = () => click(0, 4000, 0.3);
export const reload = (dur) => { click(0.05, 1800); click(dur * 0.55, 2500); click(dur * 0.9, 3200, 0.35); };
export const swap = () => click(0, 2200, 0.2);
export const jump = () => click(0, 600, 0.15);
export const death = () => tone(300, 0.6, 0.4, 'sawtooth', 0, 0.3);
export const streak = () => { tone(660, 0.12, 0.2, 'square'); tone(990, 0.2, 0.2, 'square', 0.1); tone(1320, 0.3, 0.2, 'square', 0.2); };
