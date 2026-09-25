// All sound is synthesised with the Web Audio API. The engine is a small
// physical model in an AudioWorklet: a pressure pulse per cylinder firing,
// with cycle-to-cycle variation, through an exhaust pipe resonator and a
// muffler. Turbo, gearbox whine, gravel, skids, wind and crashes ride on top.

const ENGINE_WORKLET = `
class EngineVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 14000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.cyl = o.cylinders || 4;
    this.pipe = o.pipe || 0.0042;
    this.rough = o.rough || 0.16;
    this.bright = o.bright || 1;
    this.pops = o.pops || 0.05;
    this.phase = 0; this.fire = 0; this.e1 = 0; this.e2 = 0;
    this.len = Math.ceil(sampleRate * 0.03);
    this.buf = new Float32Array(this.len); this.w = 0;
    this.lp = 0; this.lp2 = 0; this.fbl = 0; this.hpx = 0; this.hpy = 0;
    this.seed = 1234567;
    this.var = new Float32Array(this.cyl);
    for (let i = 0; i < this.cyl; i++) this.var[i] = 0.82 + 0.36 * Math.random();
    this.popAmp = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.pop) this.popAmp = Math.max(this.popAmp, e.data.pop); };
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0], load = params.load[0], gain = params.gain[0];
    const dt = 1 / sampleRate;
    const fireHz = rpm / 60 * this.cyl / 2;
    const a1 = Math.exp(-dt / 0.00028), a2 = Math.exp(-dt / (0.0012 + 0.0009 * (1 - load)));
    const D = Math.max(8, Math.min(this.len - 2, Math.round(this.pipe * sampleRate)));
    const fb = 0.5 + 0.22 * load;
    const cut = (500 + 2600 * load + rpm * 0.28) * this.bright;
    const k = 1 - Math.exp(-2 * Math.PI * cut * dt);
    const k2 = 1 - Math.exp(-2 * Math.PI * cut * 1.7 * dt);
    const fbk = 1 - Math.exp(-2 * Math.PI * 1800 * dt);
    for (let i = 0; i < out.length; i++) {
      this.phase += fireHz * dt;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.fire = (this.fire + 1) % this.cyl;
        let amp = (0.3 + 0.7 * load) * this.var[this.fire] * (1 + (this.rnd() - 0.5) * 2 * this.rough * (1.15 - load));
        // unburnt fuel igniting in the exhaust on the overrun
        if (load < 0.05 && rpm > 3200 && this.rnd() < this.pops) this.popAmp = Math.max(this.popAmp, 1.5 + this.rnd() * 2);
        if (this.popAmp > 0) { amp += this.popAmp; this.popAmp = 0; }
        this.e1 += amp; this.e2 += amp;
      }
      this.e1 *= a1; this.e2 *= a2;
      let x = (this.e2 - this.e1) * 2.2;
      x += (this.rnd() - 0.5) * this.e2 * (0.35 + 0.5 * load);
      // exhaust pipe: feedback comb with a damped loop
      const r = this.buf[(this.w - D + this.len) % this.len];
      this.fbl += (r - this.fbl) * fbk;
      const y = x + fb * this.fbl;
      this.buf[this.w] = Math.max(-4, Math.min(4, y));
      this.w = (this.w + 1) % this.len;
      // muffler, then a DC blocker
      this.lp += (y - this.lp) * k;
      this.lp2 += (this.lp - this.lp2) * k2;
      const hy = this.lp2 - this.hpx + 0.995 * this.hpy;
      this.hpx = this.lp2; this.hpy = hy;
      out[i] = Math.tanh(hy * 0.6) * gain;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('engine-voice', EngineVoice);
`;

// Engine character per car.
const VOICES = {
  hatch: { cylinders: 4, pipe: 0.0039, rough: 0.14, bright: 1.15, pops: 0.07, gain: 0.8 },
  coupe: { cylinders: 4, pipe: 0.0052, rough: 0.2, bright: 0.95, pops: 0.05, gain: 0.85 },
  truck: { cylinders: 8, pipe: 0.0068, rough: 0.12, bright: 0.7, pops: 0.03, gain: 0.9 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.volume = 0.9;
  }

  // Browsers only allow audio after a user gesture.
  async init(carId = 'hatch') {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // the car's own bangs and knocks: quieter when a replay camera is far away
    this.carSfx = ctx.createGain();
    this.carSfx.connect(this.sfx);

    const sr = ctx.sampleRate;
    const mk = (sec, fn) => {
      const b = ctx.createBuffer(1, Math.floor(sr * sec), sr);
      const d = b.getChannelData(0);
      fn(d, sr);
      return b;
    };
    this.white = mk(2, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk(2, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    // gravel: dense random clicks, band-limited
    this.gravel = mk(2, (d, rate) => {
      let a = 0, b = 0;
      for (let i = 0; i < d.length; i++) {
        let x = Math.random() < 1400 / rate ? (Math.random() * 2 - 1) * (0.4 + Math.random()) : 0;
        x += (Math.random() * 2 - 1) * 0.04;
        a += (x - a) * 0.55; b += (a - b) * 0.08;
        d[i] = (a - b) * 2.2;
      }
    });

    // Loops whose gain and pitch follow the car.
    const loop = (buf, filterType, freq, q = 0.7) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.start(0, Math.random() * buf.duration);
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      return { src, f, g };
    };
    this.wind = loop(this.white, 'bandpass', 500, 0.5);
    this.roll = loop(this.brown, 'lowpass', 160, 0.7);
    this.crunch = loop(this.gravel, 'bandpass', 1500, 0.6);
    this.slideN = loop(this.gravel, 'highpass', 900, 0.5);
    this.water = loop(this.white, 'lowpass', 900, 0.6);
    // tarmac squeal: a wobbly tone
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'sawtooth';
    this.squealOsc.frequency.value = 900;
    const sqF = ctx.createBiquadFilter();
    sqF.type = 'bandpass'; sqF.frequency.value = 1100; sqF.Q.value = 6;
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    this.squealOsc.connect(sqF).connect(this.squealG).connect(this.master);
    this.squealOsc.start();
    // gearbox whine
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG).connect(this.master);
    this.whine.start();
    // turbo whistle
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG).connect(this.master);
    this.turbo.start();

    await this._makeEngine(carId);
    this.ready = true;
  }

  async _makeEngine(carId) {
    const ctx = this.ctx;
    const v = VOICES[carId] || VOICES.hatch;
    this.voice = v;
    if (this.engine) { try { this.engine.disconnect(); } catch { /* already gone */ } }
    this.engineOut = this.engineOut || ctx.createGain();
    this.engineOut.gain.value = v.gain;
    this.engineOut.connect(this.master);
    try {
      if (!this._workletLoaded) {
        const url = URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        this._workletLoaded = true;
      }
      this.engine = new AudioWorkletNode(ctx, 'engine-voice', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: v });
      this.engine.connect(this.engineOut);
      this.engineParams = { rpm: this.engine.parameters.get('rpm'), load: this.engine.parameters.get('load'), gain: this.engine.parameters.get('gain') };
      this.fallback = null;
    } catch {
      // no AudioWorklet: two oscillators through a shaper
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 800;
      const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g).connect(this.engineOut);
      o1.start(); o2.start();
      this.fallback = { o1, o2, f, g };
      this.engine = null;
    }
  }

  async setCar(carId) {
    if (!this.ctx || this.voice === VOICES[carId]) return;
    await this._makeEngine(carId);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  // Called every frame with the physics car (or null to fade everything).
  // `volume` and `doppler` let replay cameras hear the car pass by.
  update(car, dt, { active = true, cameraInside = false, volume = 1, doppler = 1, trackside = false } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const on = car && active;
    const tc = 0.04;
    if (!on) {
      for (const n of [this.wind, this.roll, this.crunch, this.slideN, this.water]) n.g.gain.setTargetAtTime(0, t, 0.1);
      this.squealG.gain.setTargetAtTime(0, t, 0.1);
      this.whineG.gain.setTargetAtTime(0, t, 0.1);
      this.turboG.gain.setTargetAtTime(0, t, 0.1);
      if (this.engineParams) this.engineParams.gain.setTargetAtTime(0, t, 0.15);
      if (this.fallback) this.fallback.g.gain.setTargetAtTime(0, t, 0.15);
      return;
    }
    const sp = car.speed;
    // engine
    let load = car.throttle;
    if (car.limiter) load = Math.random() < 0.5 ? 0 : load;     // limiter cut: brrap
    if (!car.engaged) load *= 0.6;
    const rpm = car.rpm * doppler;
    const vol = volume;
    this.carSfx.gain.setTargetAtTime(vol, t, 0.05);
    if (this.engineParams) {
      this.engineParams.rpm.setTargetAtTime(rpm, t, 0.012);
      this.engineParams.load.setTargetAtTime(load, t, 0.03);
      this.engineParams.gain.setTargetAtTime((0.55 + 0.45 * load) * vol, t, 0.05);
    } else if (this.fallback) {
      const hz = rpm / 60 * (this.voice?.cylinders || 4) / 2;
      this.fallback.o1.frequency.setTargetAtTime(hz, t, 0.02);
      this.fallback.o2.frequency.setTargetAtTime(hz / 2, t, 0.02);
      this.fallback.f.frequency.setTargetAtTime(400 + load * 1600 + rpm * 0.15, t, 0.05);
      this.fallback.g.gain.setTargetAtTime((0.12 + load * 0.15) * vol, t, 0.05);
    }
    // turbo whistle and gear whine
    const boost = car.boost || 0;
    this.turbo.frequency.setTargetAtTime((2200 + boost * 5200 + rpm * 0.25) * doppler, t, 0.05);
    this.turboG.gain.setTargetAtTime(car.spec.engine.turbo ? boost * 0.018 * vol : 0, t, 0.06);
    if (car.spec.engine.turbo && this._lastBoost > 0.55 && boost < this._lastBoost - 0.08 && car.throttle < 0.1) this.blowOff(this._lastBoost * vol);
    this._lastBoost = boost;
    this.whine.frequency.setTargetAtTime((90 + Math.abs(car.forwardSpeed) * 26) * doppler, t, 0.05);
    this.whineG.gain.setTargetAtTime(Math.min(0.03, sp * 0.0012) * (0.4 + car.throttle * 0.6) * vol, t, 0.08);

    // tyres and surfaces
    let crunch = 0, slide = 0, squeal = 0, water = 0, contact = 0;
    for (const w of car.wheels) {
      if (!w.contact) continue;
      contact++;
      const loose = w.surface === 0 || w.surface === 2 || w.surface === 4 || w.surface === 6;
      const s = Math.min(1, Math.max(0, w.slide - 0.25) * 1.3);
      if (w.surface === 1) squeal = Math.max(squeal, Math.max(0, w.slide - 0.55) * 1.5);
      else slide = Math.max(slide, s * (loose ? 1 : 0.5));
      crunch += loose ? 1 : w.surface === 3 ? 0.4 : 0.15;
      if (w.water > 0.03) water = Math.max(water, Math.min(1, w.water * 3));
    }
    crunch /= 4;
    const v = Math.min(1, sp / 30);
    this.crunch.g.gain.setTargetAtTime(crunch * v * 0.5 * vol, t, tc);
    this.crunch.src.playbackRate.setTargetAtTime(0.55 + v * 1.1, t, tc);
    this.slideN.g.gain.setTargetAtTime(slide * 0.55 * Math.min(1, sp / 6) * vol, t, tc);
    this.slideN.src.playbackRate.setTargetAtTime(0.8 + v * 0.5, t, tc);
    this.squealG.gain.setTargetAtTime(Math.min(1, squeal) * 0.09 * vol, t, tc);
    this.squealOsc.frequency.setTargetAtTime(850 + Math.sin(t * 23) * 60, t, 0.01);
    this.roll.g.gain.setTargetAtTime(contact ? v * 0.35 * vol : 0, t, tc);
    this.roll.f.frequency.setTargetAtTime(120 + v * 220, t, tc);
    this.water.g.gain.setTargetAtTime(water * Math.min(1, sp / 8) * 0.6 * vol, t, tc);
    const wv = Math.min(1, sp / 50);
    // wind is heard by the camera, not the car: trackside cameras only get a breeze
    this.wind.g.gain.setTargetAtTime(wv * wv * (cameraInside ? 0.18 : 0.3) * (trackside ? 0.25 : 1), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(350 + wv * 1400, t, 0.1);
  }

  // ---------- one-shots ----------

  _noise(dur, type, f0, f1, vol, q = 1, when = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this._bus || this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, vol, type = 'sine', f1 = null, when = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this._bus || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  backfire(power = 1) {
    if (!this.ready) return;
    this._bus = this.carSfx;
    this.engine?.port.postMessage({ pop: 2 + power * 2 });
    this._noise(0.18, 'lowpass', 2400, 200, 0.5 * power);
    this._tone(80, 0.15, 0.4 * power, 'sine', 40);
    this._bus = null;
  }

  blowOff(amount) {
    if (!this.ready) return;
    this._bus = this.carSfx;
    this._noise(0.35, 'bandpass', 3200, 1200, 0.12 * amount, 1.5);
    this._bus = null;
  }

  shift(up) {
    if (!this.ready) return;
    this._bus = this.carSfx;
    this._noise(0.05, 'bandpass', 1800, 900, 0.18, 2);
    this._tone(up ? 140 : 110, 0.06, 0.12, 'square', 70);
    this._bus = null;
  }

  impact(speed, kind = 'tree') {
    if (!this.ready) return;
    this._bus = this.carSfx;
    const p = Math.min(1, speed / 18);
    this._tone(70, 0.3, 0.7 * p + 0.1, 'sine', 32);
    this._noise(0.35, 'bandpass', 1400, 300, 0.6 * p + 0.1, 0.8);
    if (kind === 'rock') { this._tone(1650, 0.25, 0.05 * p, 'triangle'); this._tone(2230, 0.2, 0.04 * p, 'triangle'); }
    else this._noise(0.12, 'bandpass', 700, 400, 0.4 * p, 3);    // woody knock
    this._bus = null;
  }

  landing(power) {
    if (!this.ready) return;
    this._bus = this.carSfx;
    this._tone(60, 0.25, 0.6 * power, 'sine', 30);
    this._noise(0.2, 'lowpass', 900, 150, 0.4 * power);
    this._bus = null;
  }

  scrape(p) {
    if (!this.ready || this._scrapeT > this.ctx.currentTime) return;
    this._scrapeT = this.ctx.currentTime + 0.12;
    this._bus = this.carSfx;
    this._noise(0.15, 'bandpass', 3000, 2000, 0.12 * p, 2);
    this._bus = null;
  }

  splash(power) {
    if (!this.ready) return;
    this._bus = this.carSfx;
    this._noise(0.9, 'lowpass', 3000, 300, 0.5 * power);
    this._bus = null;
  }

  beep(high = false) {
    if (!this.ready) return;
    this._tone(high ? 880 : 440, high ? 0.5 : 0.18, 0.2, 'square');
  }

  chime() {
    if (!this.ready) return;
    [660, 880, 1320].forEach((f, i) => this._tone(f, 0.25, 0.12, 'triangle', null, i * 0.07));
  }

  star() {
    if (!this.ready) return;
    [880, 1109, 1319, 1760].forEach((f, i) => this._tone(f, 0.35, 0.12, 'sine', null, i * 0.06));
  }

  horn() {
    if (!this.ready) return;
    this._tone(415, 0.9, 0.12, 'sawtooth');
    this._tone(523, 0.9, 0.1, 'sawtooth');
  }

  click() {
    if (!this.ready) return;
    this._tone(1200, 0.04, 0.06, 'triangle');
  }
}
