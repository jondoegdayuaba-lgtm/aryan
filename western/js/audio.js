// All sound is synthesised with the Web Audio API: gunshots with a canyon
// echo, hooves, steps, wind, river, fire, Dead Eye heartbeat and short
// plucked-guitar stings.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.loops = {};
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // Outdoor echo: a long, sparse impulse response
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.2);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.55;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.strings = {};
    this.startAmbience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  makeNoise(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        // Early slap off nearby hills, then a long rolling tail
        const slap = t > 0.18 && t < 0.24 ? 0.6 : 0;
        const slap2 = t > 0.55 && t < 0.62 ? 0.35 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 2.2) * 0.35 + slap + slap2) * (t < 0.03 ? 0 : 1);
      }
    }
    return b;
  }

  noise(dur, { freq = 1000, q = 0.7, type = 'lowpass', gain = 0.5, attack = 0.002, decay, verb = 0, pan = 0, when = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(f).connect(g);
    let out = g;
    if (p) {
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(this.master);
    if (verb) {
      const vg = ctx.createGain();
      vg.gain.value = verb;
      out.connect(vg).connect(this.verb);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, when = 0, verb = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    if (verb) {
      const vg = ctx.createGain();
      vg.gain.value = verb;
      g.connect(vg).connect(this.verb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // dist in metres from the listener; pan -1..1
  shot(kind = 'revolver', dist = 0, pan = 0) {
    if (!this.ctx) return;
    const far = Math.min(1, dist / 120);
    const vol = (kind === 'rifle' ? 1 : 0.85) * (1 - far * 0.75);
    this.noise(0.35, { freq: 5200 - far * 4200, q: 0.5, gain: 0.85 * vol, decay: 0.25, verb: 0.9, pan });
    this.noise(0.6, { freq: 900 - far * 400, q: 0.8, gain: 0.7 * vol, decay: 0.5, verb: 0.7, pan });
    this.tone(kind === 'rifle' ? 70 : 90, 0.25, { gain: 0.6 * vol, slide: -40 });
  }

  dryFire() {
    this.noise(0.05, { freq: 4000, type: 'highpass', gain: 0.3, decay: 0.04 });
  }

  reload(kind) {
    const n = kind === 'rifle' ? 4 : 6;
    for (let i = 0; i < n; i++) this.noise(0.05, { freq: 3000 + Math.random() * 1500, type: 'bandpass', q: 3, gain: 0.25, decay: 0.04, when: 0.2 + i * 0.22 });
    this.noise(0.08, { freq: 2200, type: 'bandpass', q: 2, gain: 0.35, decay: 0.07, when: 0.25 + n * 0.22 });
  }

  lever() {
    this.noise(0.06, { freq: 2600, type: 'bandpass', q: 2.5, gain: 0.35, decay: 0.05, when: 0.18 });
    this.noise(0.06, { freq: 1800, type: 'bandpass', q: 2.5, gain: 0.35, decay: 0.05, when: 0.32 });
  }

  cock() {
    this.noise(0.05, { freq: 3200, type: 'bandpass', q: 3, gain: 0.25, decay: 0.04, when: 0.12 });
  }

  whiz(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t);
    src.stop(t + 0.25);
  }

  thud() {
    this.tone(120, 0.12, { gain: 0.25, slide: -60 });
  }

  hurt() {
    this.tone(70, 0.3, { gain: 0.45, slide: -30 });
    this.noise(0.15, { freq: 500, gain: 0.25, decay: 0.12 });
  }

  step(soft = false) {
    this.noise(0.08, { freq: soft ? 700 : 1100, q: 0.9, gain: soft ? 0.05 : 0.08, decay: 0.07 });
  }

  hoof(loud = 1) {
    this.noise(0.1, { freq: 380, q: 1.2, gain: 0.25 * loud, decay: 0.09 });
    this.tone(85 + Math.random() * 20, 0.08, { gain: 0.18 * loud, slide: -30 });
  }

  whistle() {
    this.tone(1600, 0.18, { type: 'sine', gain: 0.18, slide: 500, verb: 0.3 });
    this.tone(2100, 0.3, { type: 'sine', gain: 0.18, slide: -700, when: 0.22, verb: 0.3 });
  }

  neigh() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(700, t);
    o.frequency.linearRampToValueAtTime(1100, t + 0.2);
    o.frequency.linearRampToValueAtTime(500, t + 0.9);
    lfo.frequency.value = 28;
    lg.gain.value = 60;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(f).connect(g).connect(this.master);
    g.connect(this.verb);
    o.start(t); lfo.start(t);
    o.stop(t + 1.05); lfo.stop(t + 1.05);
  }

  ui() {
    this.noise(0.04, { freq: 2500, type: 'bandpass', q: 2, gain: 0.15, decay: 0.03 });
  }

  // Karplus-Strong plucked string, cached per note
  pluck(freq, when = 0, gain = 0.35, dur = 2.2) {
    const ctx = this.ctx;
    if (!ctx) return;
    const key = Math.round(freq * 10);
    let buf = this.strings[key];
    if (!buf) {
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * dur);
      buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const period = Math.round(sr / freq);
      const ring = new Float32Array(period);
      for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const next = (idx + 1) % period;
        const v = (ring[idx] + ring[next]) * 0.4985;
        d[i] = ring[idx];
        ring[idx] = v;
        idx = next;
      }
      this.strings[key] = buf;
    }
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    const vg = ctx.createGain();
    vg.gain.value = 0.35;
    g.connect(vg).connect(this.verb);
    src.start(t);
  }

  sting(kind) {
    if (!this.ctx) return;
    const N = (n) => 82.41 * Math.pow(2, n / 12);   // semitones above E2
    const seqs = {
      start: [[0, 0], [7, 0.18], [12, 0.36], [15, 0.54], [19, 0.9], [12, 1.3]],
      complete: [[0, 0], [7, 0.15], [12, 0.3], [16, 0.45], [19, 0.6], [24, 0.85], [19, 1.4], [24, 1.6]],
      fail: [[12, 0], [11, 0.35], [10, 0.7], [3, 1.1]],
      death: [[0, 0], [3, 0.5], [6, 1.0]],
      discover: [[7, 0], [12, 0.2], [14, 0.4], [19, 0.7]],
    };
    for (const [n, w] of seqs[kind] || []) this.pluck(N(n), w, 0.32);
  }

  heartbeat(on) {
    if (!this.ctx) return;
    clearInterval(this._hb);
    if (!on) return;
    const beat = () => {
      this.tone(52, 0.16, { gain: 0.5, slide: -10 });
      this.tone(48, 0.14, { gain: 0.35, slide: -10, when: 0.2 });
    };
    beat();
    this._hb = setInterval(beat, 900);
  }

  deadEyeIn() {
    this.noise(0.6, { freq: 600, gain: 0.35, attack: 0.2, decay: 0.6, verb: 0.5 });
    this.tone(220, 0.6, { gain: 0.15, slide: -150 });
  }

  // Looped beds (wind, river, fire) whose gains the game sets every frame
  startAmbience() {
    const ctx = this.ctx;
    const mk = (freq, type, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { g, f };
    };
    this.loops.wind = mk(420, 'lowpass', 0.6);
    this.loops.river = mk(900, 'bandpass', 0.5);
    this.loops.fire = mk(1800, 'bandpass', 0.8);
    this.loops.gallop = mk(300, 'lowpass', 0.7);
  }

  ambience(dt, { wind = 0.15, river = 0, fire = 0, speed = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const L = this.loops;
    L.wind.g.gain.setTargetAtTime(wind * (0.7 + 0.3 * Math.sin(t * 0.3)), t, 0.4);
    L.wind.f.frequency.setTargetAtTime(300 + 250 * Math.sin(t * 0.17) + speed * 25, t, 0.4);
    L.river.g.gain.setTargetAtTime(river * 0.22, t, 0.3);
    L.fire.g.gain.setTargetAtTime(fire * 0.12 * (0.6 + Math.random() * 0.8), t, 0.05);
    if (fire > 0.05 && Math.random() < fire * dt * 18) this.noise(0.04, { freq: 2500 + Math.random() * 2000, type: 'bandpass', q: 4, gain: 0.25 * fire, decay: 0.03 });
    L.gallop.g.gain.setTargetAtTime(Math.min(0.12, speed * 0.008), t, 0.2);
  }
}
