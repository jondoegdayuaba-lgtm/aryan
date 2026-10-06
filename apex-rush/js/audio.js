// All sounds are synthesised with the Web Audio API: an engine that runs up
// through the gears, tyre squeal, wind, and little chimes. No audio files.
const GEARS = [0, 13, 25, 37, 50, 63, 90];   // top of each gear, m/s

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
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Engine: a sawtooth and a square an octave down, through a low-pass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc = ['sawtooth', 'square'].map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = i ? 0.35 : 0.6;
      o.connect(g).connect(this.engineFilter);
      o.start();
      return o;
    });

    // Tyres: band-passed noise.
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 1100;
    this.tyreFilter.Q.value = 3;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this._loop(this.noise).connect(this.tyreFilter).connect(this.tyreGain).connect(this.master);

    // Wind and road roar.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this._loop(this.noise).connect(this.windFilter).connect(this.windGain).connect(this.master);
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
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  // Called every frame. speed in m/s, throttle 0..1, slip = sideways speed.
  drive({ speed, throttle, slip, grounded, grass, active }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    let rpm;
    if (grounded) {
      let g = 1;
      while (g < GEARS.length - 1 && speed > GEARS[g]) g++;
      rpm = Math.min(1, (speed - GEARS[g - 1]) / (GEARS[g] - GEARS[g - 1]));
      rpm = 0.3 + rpm * 0.7;
    } else {
      rpm = Math.min(1, 0.55 + throttle * 0.45);
    }
    const f = 55 + rpm * 105 + throttle * 10;
    this.osc[0].frequency.setTargetAtTime(f, t, 0.03);
    this.osc[1].frequency.setTargetAtTime(f / 2, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(300 + throttle * 900 + rpm * 500, t, 0.05);
    this.engineGain.gain.setTargetAtTime(active ? 0.06 + throttle * 0.07 : 0, t, 0.06);

    const squeal = grounded && !grass ? Math.min(1, Math.max(0, Math.abs(slip) - 4) / 10) : 0;
    this.tyreGain.gain.setTargetAtTime(active ? squeal * 0.12 : 0, t, 0.05);
    this.tyreFilter.frequency.setTargetAtTime(900 + squeal * 500, t, 0.1);

    const s = Math.min(1, speed / 80);
    this.windGain.gain.setTargetAtTime(active ? s * s * 0.09 + (grass && grounded ? s * 0.12 : 0) : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(grass ? 260 : 380 + s * 900, t, 0.1);
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

  _thud(vol, cutoff = 400, dur = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.9, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  checkpoint(faster) {
    if (faster === undefined) this._blip([880, 1175], 'triangle', 0.14, 0.18, 0.08);
    else if (faster) this._blip([988, 1319, 1568], 'triangle', 0.14, 0.18, 0.06);
    else this._blip([740, 622], 'triangle', 0.16, 0.18, 0.09);
  }

  finish(record) {
    const notes = record ? [784, 988, 1175, 1568, 1976] : [659, 784, 988, 1319];
    this._blip(notes, 'triangle', 0.22, 0.2, 0.09);
  }

  go() { this._blip([1047], 'square', 0.16, 0.08); }
  click() { this._blip([880], 'triangle', 0.05, 0.08); }
  wall(strength) { this._thud(0.15 + strength * 0.03, 900, 0.25); }
  land(strength) { this._thud(0.2 + strength * 0.03, 300, 0.35); }
  respawn() { this._blip([523, 392], 'triangle', 0.1, 0.12, 0.06); }
}
