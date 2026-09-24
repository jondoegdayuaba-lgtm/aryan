// All sounds are synthesised with the Web Audio API: wind, engine rumble,
// explosions and little UI blips. No audio files needed.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Browsers only allow audio after a user gesture, so call this from a click/tap/key.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }

    // Wind: looping noise through a band-pass whose pitch follows speed.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this._loop(this.noise).connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Engine: low rumble.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this._loop(this.brown).connect(this.engineFilter).connect(this.engineGain).connect(this.master);
  }

  _loop(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // speed01: 0..1, engine01: 0..1.6 (boost), active: whether we are flying.
  flight(speed01, engine01, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(active ? 0.05 + speed01 * 0.32 : 0, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(350 + speed01 * 1400, t, 0.15);
    this.engineGain.gain.setTargetAtTime(active ? engine01 * 0.55 : 0, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(160 + engine01 * 260, t, 0.1);
  }

  explosion(big = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * big, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.6);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8 * big, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.75);
  }

  _blip(freqs, type = 'square', dur = 0.08, vol = 0.12, gap = 0.07) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    freqs.forEach((fr, i) => {
      const t = t0 + i * gap;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  gate() { this._blip([660, 990], 'triangle', 0.12, 0.2); }
  lock() { this._blip([1320], 'square', 0.05, 0.05); }
  shield() { this._blip([440, 660, 880], 'triangle', 0.14, 0.2, 0.06); }
  pop() { this._blip([520, 260], 'sawtooth', 0.12, 0.12, 0.05); }
  thread() { this._blip([784, 1046, 1318], 'triangle', 0.12, 0.18, 0.05); }
  click() { this._blip([880], 'triangle', 0.05, 0.08); }

  launch() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1);
  }
}
