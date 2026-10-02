// Small synthesised sound effects (Web Audio API, no sound files).
let ctx = null, master = null, noiseBuf = null;
let volume = 0.6;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

const FILTERS = {
  grass: ['lowpass', 1100, 0.7],
  dirt: ['lowpass', 750, 0.8],
  sand: ['highpass', 1800, 0.6],
  snow: ['lowpass', 1600, 0.5],
  stone: ['bandpass', 1900, 1.2],
  wood: ['bandpass', 520, 3],
  glass: ['highpass', 3000, 1],
};

function noise(dur, material, gain, rate = 1) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rate;
  const [type, freq, q] = FILTERS[material] || FILTERS.stone;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq * (0.9 + Math.random() * 0.2);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(type, f0, f1, dur, gain, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfx(name, material = 'stone') {
  if (!ctx || !volume) return;
  switch (name) {
    case 'break':
      noise(0.22, material, 0.55);
      if (material === 'glass') for (let i = 0; i < 4; i++) tone('sine', 2500 + Math.random() * 2000, 1800, 0.12, 0.05, i * 0.03);
      if (material === 'wood') tone('triangle', 160, 90, 0.12, 0.25);
      break;
    case 'place': noise(0.12, material, 0.45, 0.8); if (material === 'wood') tone('triangle', 200, 120, 0.08, 0.2); break;
    case 'hit': noise(0.07, material, 0.22); break;
    case 'step': noise(0.08, material, 0.1, 0.9); break;
    case 'hurt': tone('square', 240, 110, 0.22, 0.12); break;
    case 'pop': tone('sine', 520 + Math.random() * 200, 1300, 0.09, 0.18); break;
    case 'eat': for (let i = 0; i < 3; i++) setTimeout(() => noise(0.08, 'grass', 0.3, 1.3), i * 140); break;
    case 'click': tone('square', 700, 500, 0.04, 0.06); break;
    case 'splash': noise(0.4, 'snow', 0.3, 0.6); break;
  }
}
