// All sound is synthesised with the Web Audio API (no audio files): the
// electric motor's whine, chain and knobbly tyres, wind, gravel, slides,
// splashes, landings, crashes and UI chimes.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
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

    this._motor();
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

  // Electric drivetrain: the motor's whirr and whine rising with speed, the
  // inverter's buzz under load, the chain, and the hum of knobbly tyres.
  _motor() {
    const ctx = this.ctx;
    const E = (this.motor = {});
    const out = (E.out = ctx.createGain());
    out.gain.value = 0;
    out.connect(this.master);
    E.whirr = ctx.createOscillator();
    E.whirr.type = 'sawtooth';
    E.whirrF = ctx.createBiquadFilter();
    E.whirrF.type = 'lowpass';
    E.whirrF.Q.value = 2.5;
    E.whirrG = ctx.createGain();
    E.whirr.connect(E.whirrF).connect(E.whirrG).connect(out);
    E.whine = ctx.createOscillator();
    E.whine.type = 'sine';
    E.whineG = ctx.createGain();
    E.whine.connect(E.whineG).connect(out);
    E.whine2 = ctx.createOscillator();
    E.whine2.type = 'triangle';
    E.whine2G = ctx.createGain();
    E.whine2.connect(E.whine2G).connect(out);
    // Inverter buzz: a rough high tone that shows up when pulling hard from low speed.
    E.buzz = ctx.createOscillator();
    E.buzz.type = 'square';
    E.buzz.frequency.value = 2150;
    const buzzF = ctx.createBiquadFilter();
    buzzF.type = 'bandpass';
    buzzF.frequency.value = 2300;
    buzzF.Q.value = 3;
    E.buzzG = ctx.createGain();
    E.buzzG.gain.value = 0;
    E.buzz.connect(buzzF).connect(E.buzzG).connect(this.master);
    // Knobbly tyre hum: low noise chopped at the rate the knobs hit the ground.
    E.knobG = ctx.createGain();
    E.knobG.gain.value = 0;
    E.knobAm = ctx.createOscillator();
    E.knobAm.type = 'square';
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.5;
    const knobBody = ctx.createGain();
    knobBody.gain.value = 0.5;
    E.knobAm.connect(amDepth).connect(knobBody.gain);
    const knobSrc = this._loop(this.white);
    const knobF = ctx.createBiquadFilter();
    knobF.type = 'bandpass';
    knobF.frequency.value = 260;
    knobF.Q.value = 1.2;
    knobSrc.connect(knobF).connect(knobBody).connect(E.knobG).connect(this.master);
    for (const o of [E.whirr, E.whine, E.whine2, E.buzz, E.knobAm]) o.start();
    this.chain = this._noiseLayer(this.white, 'bandpass', 1400, 1.6);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Called every frame with the bike's state.
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const E = this.motor;
    const set = (param, v, tc = 0.03) => param.setTargetAtTime(v, t, tc);
    const w = Math.abs(s.motor || 0);                 // rear wheel, rad/s
    const load = s.running ? clamp(s.power * 1.3 + s.throttle * 0.25, 0, 1.2) : 0;
    const f = 38 + w * 6.2;
    set(E.whirr.frequency, f);
    set(E.whirrF.frequency, 300 + f * 2.2 + load * 900);
    set(E.whine.frequency, f * 3.02);
    set(E.whine2.frequency, f * 5.5);
    const spin = clamp(w / 20, 0, 1);
    set(E.whirrG.gain, (0.05 + 0.2 * load) * (0.3 + 0.7 * spin));
    set(E.whineG.gain, (0.012 + 0.07 * load) * spin);
    set(E.whine2G.gain, 0.02 * load * spin);
    set(E.out.gain, s.running ? 0.9 : 0, 0.08);
    set(E.buzzG.gain, s.running ? clamp(s.throttle * (1 - s.speed / 12), 0, 1) * 0.022 : 0, 0.05);
    set(E.knobAm.frequency, Math.max(5, s.speed / 0.06));
    set(E.knobG.gain, s.grounded ? clamp(s.speed / 18, 0, 1) * (0.07 + 0.1 * (1 - s.loose)) : 0, 0.05);
    set(this.chain.gain.gain, s.running ? clamp(w / 70, 0, 1) * (0.03 + 0.05 * load) : 0, 0.05);
    set(this.chain.filter.frequency, 900 + w * 14, 0.1);

    const sp = s.speed;
    set(this.wind.gain.gain, clamp((sp / 45) ** 2, 0, 1) * 0.3 + (s.air ? 0.05 : 0), 0.15);
    set(this.wind.filter.frequency, 300 + sp * 24, 0.2);
    set(this.gravelLayer.gain.gain, s.grounded ? clamp(sp / 18, 0, 1) * (0.03 + 0.14 * s.loose) : 0, 0.05);
    set(this.gravelLayer.filter.frequency, 1300 + sp * 30, 0.1);
    set(this.slide.gain.gain, s.grounded ? clamp(s.slip, 0, 1) * 0.18 : 0, 0.06);
    set(this.splash.gain.gain, s.water ? clamp(sp / 10, 0, 1) * 0.45 : 0, 0.05);
    set(this.boostLayer.gain.gain, s.boost ? 0.08 : 0, 0.08);
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

  crash(strength = 1) {
    this.thump(strength);
    this._burst(0.5 * strength, 'bandpass', 900, 0.6);     // sliding along the dirt
    this._burst(0.35 * strength, 'highpass', 3000, 0.25);  // plastic and metal
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
}
