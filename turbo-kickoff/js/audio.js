// Every sound is synthesised with the Web Audio API, so there are no sound files.

let ctx = null;
let master = null;
let noiseBuf = null;
let engine = null;
let boostNoise = null;
let muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // Engine: two detuned saws through a low-pass filter
  const eg = ctx.createGain(); eg.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 12;
  o1.connect(lp); o2.connect(lp); lp.connect(eg); eg.connect(master);
  o1.start(); o2.start();
  engine = { gain: eg, o1, o2, lp };

  // Boost: looping filtered noise
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
  const bg = ctx.createGain(); bg.gain.value = 0;
  src.connect(bp); bp.connect(bg); bg.connect(master); src.start();
  boostNoise = { gain: bg, bp };
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}

export function setEngine(speed, boosting, active) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const f = 45 + speed * 6;
  engine.o1.frequency.setTargetAtTime(f, t, 0.05);
  engine.o2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
  engine.lp.frequency.setTargetAtTime(300 + speed * 60, t, 0.05);
  engine.gain.gain.setTargetAtTime(active ? 0.05 + speed * 0.002 : 0, t, 0.1);
  boostNoise.gain.gain.setTargetAtTime(active && boosting ? 0.18 : 0, t, 0.05);
  boostNoise.bp.frequency.setTargetAtTime(700 + speed * 40, t, 0.1);
}

function burst({ freq = 800, q = 1, dur = 0.2, vol = 0.4, type = 'bandpass', delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}

function tone({ freq, dur = 0.15, vol = 0.3, type = 'sine', slide = 0, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  hit(strength) {
    const v = Math.min(1, strength / 25);
    burst({ freq: 300 + v * 900, q: 0.8, dur: 0.18, vol: 0.2 + v * 0.5 });
    tone({ freq: 120, slide: -60, dur: 0.15, vol: 0.2 + v * 0.4 });
  },
  bounce(strength) {
    burst({ freq: 200, q: 1, dur: 0.12, vol: Math.min(0.25, strength * 0.02), type: 'lowpass' });
  },
  jump() { burst({ freq: 1400, q: 2, dur: 0.1, vol: 0.12 }); },
  pickup(big) { tone({ freq: big ? 520 : 880, slide: big ? 600 : 300, dur: big ? 0.25 : 0.1, vol: 0.12, type: 'triangle' }); },
  beep(go) { tone({ freq: go ? 880 : 440, dur: go ? 0.5 : 0.18, vol: 0.25, type: 'square' }); },
  goal() {
    burst({ freq: 120, q: 0.5, dur: 1.6, vol: 1.2, type: 'lowpass' });
    burst({ freq: 2000, q: 0.3, dur: 0.6, vol: 0.4 });
    burst({ freq: 1200, q: 0.4, dur: 3.5, vol: 0.25, delay: 0.2 }); // crowd roar
    tone({ freq: 60, slide: -30, dur: 1.2, vol: 0.6 });
  },
  whistle() {
    tone({ freq: 2100, dur: 0.35, vol: 0.15, type: 'triangle' });
    tone({ freq: 2100, dur: 0.6, vol: 0.15, type: 'triangle', delay: 0.4 });
  },
};
