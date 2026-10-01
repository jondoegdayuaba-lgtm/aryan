// Synthesised sounds (Web Audio API): gunshots, reloads, hits, explosions,
// footsteps. No audio files. Sounds from other fighters get quieter with
// distance and are panned left/right.
const SHOTS = {
  rifle: { len: 0.14, freq: 1800, q: 0.7, thump: 120, vol: 0.55 },
  smg: { len: 0.09, freq: 2400, q: 0.7, thump: 150, vol: 0.45 },
  shotgun: { len: 0.32, freq: 900, q: 0.5, thump: 70, vol: 0.85 },
  sniper: { len: 0.5, freq: 1200, q: 0.6, thump: 60, vol: 0.95 },
  rocket: { len: 0.45, freq: 500, q: 0.4, thump: 50, vol: 0.7 },
  pistol: { len: 0.12, freq: 2200, q: 0.8, thump: 160, vol: 0.5 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  // vol 0..1, pan -1..1
  _out(vol, pan) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _noise(out, t, len, type, freq, q, vol, sweepTo) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  _tone(out, t, len, type, f0, f1, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  shot(kind, vol = 1, pan = 0) {
    if (!this.ctx || vol < 0.02) return;
    const t = this.ctx.currentTime;
    if (kind === 'knife') {
      this._noise(this._out(vol * 0.5, pan), t, 0.15, 'bandpass', 3000, 1.5, 0.6, 900);
      return;
    }
    const s = SHOTS[kind] || SHOTS.rifle;
    const out = this._out(vol * s.vol, pan);
    this._noise(out, t, s.len, 'lowpass', s.freq * 2, s.q, 1, s.freq * 0.25);
    this._noise(out, t, 0.03, 'highpass', 3000, 0.7, 0.6);
    this._tone(out, t, s.len * 0.7, 'sine', s.thump * 2, s.thump * 0.5, 0.9);
    if (kind === 'rocket') this._noise(out, t, 0.8, 'bandpass', 600, 1, 0.4, 200);
  }

  explosion(vol = 1, pan = 0) {
    if (!this.ctx || vol < 0.02) return;
    const t = this.ctx.currentTime;
    const out = this._out(vol, pan);
    this._noise(out, t, 1.1, 'lowpass', 1400, 0.5, 1.2, 80);
    this._tone(out, t, 0.6, 'sine', 110, 30, 1);
  }

  reload() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.35, 0);
    this._tone(out, t, 0.05, 'square', 900, 500, 0.25);
    this._tone(out, t + 0.35, 0.06, 'square', 600, 300, 0.3);
    this._noise(out, t + 0.36, 0.05, 'highpass', 2500, 1, 0.5);
  }

  dry() {
    if (!this.ctx) return;
    this._tone(this._out(0.3, 0), this.ctx.currentTime, 0.04, 'square', 1500, 1200, 0.2);
  }

  hitmarker(head) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.4, 0);
    this._tone(out, t, 0.06, 'triangle', head ? 2200 : 1500, head ? 2600 : 1400, 0.5);
  }

  killConfirm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.4, 0);
    this._tone(out, t, 0.12, 'triangle', 880, 880, 0.5);
    this._tone(out, t + 0.09, 0.18, 'triangle', 1320, 1320, 0.5);
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(this._out(0.5, 0), t, 0.12, 'lowpass', 500, 1, 0.8);
  }

  step(vol = 0.15) {
    if (!this.ctx) return;
    this._noise(this._out(vol, 0), this.ctx.currentTime, 0.06, 'lowpass', 700 + Math.random() * 300, 1, 0.8);
  }

  jump() {
    if (!this.ctx) return;
    this._noise(this._out(0.15, 0), this.ctx.currentTime, 0.1, 'bandpass', 900, 1, 0.6);
  }

  slide() {
    if (!this.ctx) return;
    this._noise(this._out(0.3, 0), this.ctx.currentTime, 0.5, 'bandpass', 1200, 0.8, 0.6, 400);
  }

  throwNade() {
    if (!this.ctx) return;
    this._noise(this._out(0.3, 0), this.ctx.currentTime, 0.18, 'bandpass', 1500, 1, 0.6, 600);
  }

  blip(f = 660) {
    if (!this.ctx) return;
    this._tone(this._out(0.3, 0), this.ctx.currentTime, 0.08, 'triangle', f, f, 0.5);
  }
}
