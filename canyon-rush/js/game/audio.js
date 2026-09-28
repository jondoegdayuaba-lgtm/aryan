// All sound is synthesised with the Web Audio API (no audio files):
// a lumpy cross-plane V8 with exhaust crackle on lift-off, wind, gravel crunch,
// tyre slide, splashes, landing thumps and UI chimes.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.lastThrottle = 0;
    this.crackle = 0;
    this.crackleTimer = 0;
  }

  // Browsers only allow audio after a click / tap / key press.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);

    // Noise buffers.
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    // Gravel: sparse clicks of different sizes over a noise bed.
    this.gravel = ctx.createBuffer(1, len, ctx.sampleRate);
    const g = this.gravel.getChannelData(0);
    for (let i = 0; i < len; i++) g[i] = (Math.random() * 2 - 1) * 0.15;
    for (let k = 0; k < 2600; k++) {
      const at = Math.floor(Math.random() * (len - 400));
      const amp = Math.pow(Math.random(), 2) * 0.9;
      const dur = 30 + Math.floor(Math.random() * 250);
      for (let i = 0; i < dur; i++) g[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (dur * 0.25));
    }

    this._engine();
    this.wind = this._noiseLayer(this.white, 'bandpass', 500, 0.6);
    this.gravelLayer = this._noiseLayer(this.gravel, 'bandpass', 2200, 0.5);
    this.slide = this._noiseLayer(this.white, 'bandpass', 900, 2.2);
    this.splash = this._noiseLayer(this.white, 'lowpass', 900, 0.7);
    this.boostLayer = this._noiseLayer(this.white, 'highpass', 2500, 0.7);
  }

  _loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = 0;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  _noiseLayer(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = this._loop(buffer);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(f).connect(gain).connect(this.master);
    return { src, filter: f, gain };
  }

  _engine() {
    const ctx = this.ctx;
    const E = (this.engine = {});
    E.saw = ctx.createOscillator();
    E.saw.type = 'sawtooth';
    E.sub = ctx.createOscillator();
    E.sub.type = 'square';
    E.lope = ctx.createOscillator();
    E.lope.type = 'sine';
    const sawG = ctx.createGain(); sawG.gain.value = 0.55;
    const subG = ctx.createGain(); subG.gain.value = 0.32;
    const lopeG = ctx.createGain(); lopeG.gain.value = 0.4;
    // Amplitude wobble at a quarter of the firing rate gives the V8 burble.
    E.am = ctx.createOscillator();
    E.am.type = 'sine';
    E.amDepth = ctx.createGain();
    E.amDepth.gain.value = 0.25;
    const body = ctx.createGain();
    body.gain.value = 0.75;
    E.am.connect(E.amDepth).connect(body.gain);
    E.saw.connect(sawG).connect(body);
    E.sub.connect(subG).connect(body);
    E.lope.connect(lopeG).connect(body);
    // Exhaust hiss riding on the pulses.
    const hiss = this._loop(this.white);
    const hissF = ctx.createBiquadFilter();
    hissF.type = 'bandpass';
    hissF.frequency.value = 1400;
    hissF.Q.value = 0.7;
    E.hissG = ctx.createGain();
    E.hissG.gain.value = 0.08;
    hiss.connect(hissF).connect(E.hissG).connect(body);
    // Grit.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    // Fixed resonances of the exhaust and intake.
    const peak = (f, g, q) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = f;
      b.gain.value = g;
      b.Q.value = q;
      return b;
    };
    E.lp = ctx.createBiquadFilter();
    E.lp.type = 'lowpass';
    E.lp.frequency.value = 900;
    E.lp.Q.value = 0.9;
    E.out = ctx.createGain();
    E.out.gain.value = 0;
    E.limiter = ctx.createGain();
    E.limiter.gain.value = 1;
    body.connect(shaper).connect(peak(115, 7, 1.2)).connect(peak(430, 4, 1.4)).connect(peak(1150, 2.5, 1.6)).connect(E.lp).connect(E.limiter).connect(E.out).connect(this.master);
    for (const o of [E.saw, E.sub, E.lope, E.am]) o.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Called every frame with the truck's state.
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const E = this.engine;
    const rpm = s.running ? clamp(s.rpm, 700, 7400) : 0;
    const fire = (rpm / 60) * 4;
    const th = s.running ? s.throttle : 0;
    const set = (param, v, tc = 0.03) => param.setTargetAtTime(v, t, tc);
    set(E.saw.frequency, Math.max(20, fire));
    set(E.sub.frequency, Math.max(10, fire * 0.5));
    set(E.lope.frequency, Math.max(8, fire * 0.25 + Math.sin(t * 7) * 1.5));
    set(E.am.frequency, Math.max(4, fire * 0.125));
    set(E.amDepth.gain, 0.12 + 0.28 * (1 - clamp(rpm / 4000, 0, 1)));
    set(E.lp.frequency, 380 + th * 2600 + rpm * 0.28);
    set(E.hissG.gain, 0.04 + th * 0.14);
    const load = 0.28 + 0.72 * th;
    set(E.out.gain, s.running ? (0.1 + 0.2 * (rpm / 7000)) * load * (s.shifting ? 0.45 : 1) : 0, 0.05);
    // Rev limiter stutter.
    if (s.limiter) E.limiter.gain.setValueAtTime(Math.sin(t * 130) > 0 ? 1 : 0.25, t);
    else set(E.limiter.gain, 1, 0.01);

    // Crackle when lifting off at high revs.
    if (this.lastThrottle > 0.6 && th < 0.2 && rpm > 3500) this.crackle = 1.1;
    this.lastThrottle = th;
    if (this.crackle > 0) {
      this.crackle -= dt;
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.03 + Math.random() * 0.12;
        this.pop(0.25 + Math.random() * 0.35);
      }
    }

    const sp = s.speed;
    set(this.wind.gain.gain, clamp((sp / 55) ** 2, 0, 1) * 0.28 + (s.air ? 0.05 : 0), 0.15);
    set(this.wind.filter.frequency, 300 + sp * 22, 0.2);
    set(this.gravelLayer.gain.gain, s.grounded ? clamp(sp / 20, 0, 1) * (0.05 + 0.2 * s.loose) : 0, 0.05);
    set(this.gravelLayer.filter.frequency, 1300 + sp * 30, 0.1);
    set(this.slide.gain.gain, s.grounded ? clamp(s.slip, 0, 1) * 0.22 : 0, 0.06);
    set(this.splash.gain.gain, s.water ? clamp(sp / 12, 0, 1) * 0.5 : 0, 0.05);
    set(this.boostLayer.gain.gain, s.boost ? 0.1 : 0, 0.08);
  }

  pop(amp = 0.4) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 + Math.random() * 1400;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.04);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.12);
  }

  thump(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
    this._burst(0.5 * strength, 'lowpass', 500, 0.35);
    this._burst(0.25 * strength, 'bandpass', 1800, 0.2);   // suspension clank
  }

  crunch() {
    this._burst(0.6, 'bandpass', 1500, 0.35);
    this._burst(0.4, 'lowpass', 300, 0.25);
  }

  _burst(amp, type, freq, dur) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  _tones(freqs, { type = 'triangle', dur = 0.14, vol = 0.22, gap = 0.08 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    freqs.forEach((fr, i) => {
      const t = t0 + i * gap;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  beep(high = false) { this._tones([high ? 1320 : 660], { type: 'square', dur: high ? 0.45 : 0.18, vol: 0.12 }); }
  checkpoint() { this._tones([880, 1175, 1568], { dur: 0.18, gap: 0.07 }); }
  finish() { this._tones([523, 659, 784, 1047, 1319, 1568], { dur: 0.3, gap: 0.09, vol: 0.2 }); }
  stunt() { this._tones([988, 1319], { dur: 0.12, gap: 0.06, vol: 0.12 }); }
  click() { this._tones([900], { dur: 0.05, vol: 0.08 }); }
  shift() { this.pop(0.18); }
}
