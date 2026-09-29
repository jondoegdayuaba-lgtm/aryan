// All sound is synthesised with the Web Audio API: ambience that follows the weather and where you
// stand, footsteps for each surface, fire, thunder, the helicopter, radio effects and a slow
// generative score. No audio files.
import { clamp, lerp, smoothstep, rng } from './util.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicOn = true;
    this.muted = false;
    this.t = { bird: 3, owl: 20, wolf: 60, crackle: 0, heart: 0, breath: 0, music: 0, drip: 0 };
    this.chordIndex = 0;
    this.mood = 'calm';
    this.heli = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.master);

    const sr = ctx.sampleRate, len = sr * 3;
    const mk = (fn) => { const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0); fn(d); return b; };
    this.white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.pink = mk((d) => { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; } });
    this.brown = mk((d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });

    // A shared reverb: decaying noise as an impulse response.
    const irLen = sr * 2.6, ir = ctx.createBuffer(2, irLen, sr);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.5;
    this.reverb.connect(this.reverbSend).connect(this.master);

    // Continuous layers.
    const loop = (buf, filterType, freq, q = 0.7) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = Math.random() * 1.5; src.start();
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.amb);
      return { f, g };
    };
    this.wind = loop(this.brown, 'bandpass', 420, 0.5);
    this.windHigh = loop(this.pink, 'highpass', 1400, 0.4);
    this.rain = loop(this.white, 'highpass', 900);
    this.rainLow = loop(this.pink, 'lowpass', 700);
    this.creek = loop(this.pink, 'bandpass', 1300, 0.6);
    this.lake = loop(this.brown, 'lowpass', 350);
    this.fireRoar = loop(this.brown, 'lowpass', 260);
    this.engine = loop(this.brown, 'lowpass', 300);
    this.under = loop(this.brown, 'lowpass', 200);

    // Helicopter: rotor chop (gated noise) and a turbine whine, spatialised.
    const panner = ctx.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 40; panner.rolloffFactor = 1.4; panner.maxDistance = 4000;
    const rotor = ctx.createBufferSource(); rotor.buffer = this.brown; rotor.loop = true; rotor.start();
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 520;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 11.5; const lfoG = ctx.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG).connect(chop.gain); lfo.start();
    const whine = ctx.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 1180; const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1180; wf.Q.value = 6; const wg = ctx.createGain(); wg.gain.value = 0.03;
    whine.connect(wf).connect(wg); whine.start();
    const hg = ctx.createGain(); hg.gain.value = 0;
    rotor.connect(rf).connect(chop).connect(hg); wg.connect(hg);
    hg.connect(panner).connect(this.master);
    this.heli = { panner, gain: hg, lfo, whine };
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05); }
  setVolume(v) { this.volume = v; if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(on) { this.musicOn = on; }
  pause(on) { if (this.ctx) (on ? this.ctx.suspend() : this.ctx.resume()); }

  // ---------- helpers ----------
  _burst({ buf = this.white, type = 'bandpass', freq = 1500, q = 1, dur = 0.1, vol = 0.3, attack = 0.005, out = this.sfx, pan = 0, sweep = 0, delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = src.connect(f).connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(out);
    src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
  }

  _tone({ type = 'sine', freq = 440, dur = 0.2, vol = 0.2, attack = 0.005, sweepTo = 0, out = this.sfx, delay = 0, pan = 0, verb = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(out);
    if (verb) node.connect(this.reverb);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- one-shot sounds ----------
  step(surface, k = 0.6) {
    if (!this.ctx) return;
    const v = 0.5 * k * (0.8 + Math.random() * 0.4), p = (Math.random() - 0.5) * 0.15;
    switch (surface) {
      case 'wood': this._tone({ freq: 150 + Math.random() * 30, dur: 0.13, vol: v * 0.55, sweepTo: 90 }); this._burst({ freq: 700, q: 1.2, dur: 0.07, vol: v * 0.5 }); break;
      case 'rock': this._burst({ type: 'bandpass', freq: 1900, q: 2.5, dur: 0.05, vol: v * 0.7, attack: 0.001 }); this._tone({ freq: 240, dur: 0.06, vol: v * 0.3 }); break;
      case 'gravel': for (let i = 0; i < 4; i++) this._burst({ type: 'highpass', freq: 2200 + Math.random() * 1600, dur: 0.045, vol: v * 0.5, delay: i * 0.03 + Math.random() * 0.02 }); break;
      case 'dirt': this._burst({ type: 'lowpass', freq: 800, dur: 0.11, vol: v * 0.7 }); this._tone({ freq: 90, dur: 0.1, vol: v * 0.4 }); break;
      case 'forest': this._burst({ type: 'bandpass', freq: 2600, q: 0.8, dur: 0.16, vol: v * 0.55, pan: p }); this._burst({ type: 'lowpass', freq: 500, dur: 0.1, vol: v * 0.5 }); break;
      case 'snow': this._burst({ type: 'bandpass', freq: 3200, q: 1.4, dur: 0.14, vol: v * 0.5 }); break;
      case 'water': this.splash(k); break;
      default: this._burst({ type: 'bandpass', freq: 1700, q: 0.7, dur: 0.12, vol: v * 0.6, pan: p }); this._tone({ freq: 100, dur: 0.09, vol: v * 0.3 }); // grass
    }
  }
  land(speed, inWater) { if (!this.ctx) return; if (inWater) return this.splash(1); const k = clamp(speed / 10, 0.2, 1.4); this._tone({ freq: 80, sweepTo: 40, dur: 0.25, vol: 0.5 * k }); this._burst({ type: 'lowpass', freq: 600, dur: 0.18, vol: 0.5 * k }); }
  splash(k = 1) { if (!this.ctx) return; this._burst({ type: 'lowpass', freq: 3200, dur: 0.5, vol: 0.4 * k, sweep: 0.3 }); this._burst({ type: 'bandpass', freq: 800, dur: 0.35, vol: 0.3 * k, delay: 0.04 }); }
  stroke() { if (!this.ctx) return; this._burst({ type: 'lowpass', freq: 1500, dur: 0.35, vol: 0.18, sweep: 0.5 }); }
  jump() { if (!this.ctx) return; this._burst({ type: 'bandpass', freq: 1300, dur: 0.09, vol: 0.12 }); }
  hurt(amount) {
    if (!this.ctx) return;
    this._tone({ freq: 130, sweepTo: 70, dur: 0.3, vol: clamp(amount / 30, 0.15, 0.6), type: 'triangle' });
    this._burst({ type: 'lowpass', freq: 900, dur: 0.25, vol: clamp(amount / 30, 0.1, 0.5) });
  }
  click() { if (!this.ctx) return; this._tone({ type: 'square', freq: 1900, dur: 0.025, vol: 0.06 }); }
  torch() { if (!this.ctx) return; this._burst({ type: 'bandpass', freq: 2400, q: 3, dur: 0.03, vol: 0.2, attack: 0.001 }); this._tone({ type: 'square', freq: 320, dur: 0.03, vol: 0.05, delay: 0.03 }); }
  pickup() { if (!this.ctx) return; this._tone({ type: 'triangle', freq: 660, dur: 0.12, vol: 0.14 }); this._tone({ type: 'triangle', freq: 990, dur: 0.16, vol: 0.12, delay: 0.07 }); }
  paper() { if (!this.ctx) return; this._burst({ type: 'highpass', freq: 3500, dur: 0.22, vol: 0.14, attack: 0.03 }); this._burst({ type: 'bandpass', freq: 5200, q: 1, dur: 0.16, vol: 0.09, delay: 0.1 }); }
  eat() { if (!this.ctx) return; for (let i = 0; i < 4; i++) this._burst({ type: 'bandpass', freq: 900 + Math.random() * 500, q: 1.5, dur: 0.06, vol: 0.28, delay: i * 0.13 }); }
  drink() { if (!this.ctx) return; for (let i = 0; i < 3; i++) this._tone({ freq: 280, sweepTo: 130, dur: 0.16, vol: 0.2, delay: i * 0.22 }); }
  match() { if (!this.ctx) return; this._burst({ type: 'highpass', freq: 2200, dur: 0.3, vol: 0.25, attack: 0.01, sweep: 0.6 }); this._burst({ type: 'lowpass', freq: 500, dur: 0.6, vol: 0.12, delay: 0.25 }); }
  ignite() { if (!this.ctx) return; this._burst({ type: 'lowpass', freq: 900, dur: 1.1, vol: 0.4, attack: 0.05, sweep: 0.3 }); }
  fizzle() { if (!this.ctx) return; this._burst({ type: 'highpass', freq: 3000, dur: 0.4, vol: 0.2, sweep: 0.4 }); }
  door() { if (!this.ctx) return; this._burst({ type: 'bandpass', freq: 400, q: 6, dur: 0.9, vol: 0.18, attack: 0.1, sweep: 2.4 }); this._tone({ type: 'sawtooth', freq: 90, dur: 0.8, vol: 0.05, sweepTo: 130 }); }
  ladder() { if (!this.ctx) return; this._burst({ type: 'bandpass', freq: 1800, q: 6, dur: 0.12, vol: 0.2 }); this._tone({ freq: 420, dur: 0.1, vol: 0.05, type: 'triangle' }); }
  flare() { if (!this.ctx) return; this._burst({ type: 'lowpass', freq: 1400, dur: 0.6, vol: 0.5, sweep: 0.2 }); this._burst({ type: 'highpass', freq: 1500, dur: 4, vol: 0.12, attack: 0.3, delay: 0.3 }); }
  radioOn() { if (!this.ctx) return; this._burst({ type: 'highpass', freq: 1500, dur: 0.25, vol: 0.22, attack: 0.005 }); this._tone({ type: 'sine', freq: 1200, dur: 0.08, vol: 0.06, delay: 0.25 }); }
  radioOff() { if (!this.ctx) return; this._burst({ type: 'highpass', freq: 2500, dur: 0.15, vol: 0.2 }); }
  beeps(n = 3) { if (!this.ctx) return; for (let i = 0; i < n; i++) this._tone({ type: 'sine', freq: 880, dur: 0.12, vol: 0.13, delay: i * 0.25 }); }
  static_(dur = 1.5) { if (!this.ctx) return; this._burst({ type: 'bandpass', freq: 2200, q: 0.4, dur, vol: 0.12, attack: 0.05 }); }
  thunder(distance = 1000) {
    if (!this.ctx) return;
    const near = clamp(1 - distance / 2600, 0.1, 1);
    const dur = 3 + near * 4;
    this._burst({ buf: this.brown, type: 'lowpass', freq: 380 + near * 500, dur, vol: 0.6 + near * 0.6, attack: 0.05 + (1 - near) * 0.4, sweep: 0.12, out: this.amb });
    this._burst({ buf: this.brown, type: 'lowpass', freq: 200, dur: dur * 1.2, vol: 0.5, attack: 0.3, delay: 0.3, out: this.amb });
    if (near > 0.55) this._burst({ type: 'highpass', freq: 1800, dur: 0.25, vol: near * 0.5, attack: 0.001, out: this.amb });
  }
  bird() {
    if (!this.ctx) return;
    const p = (Math.random() - 0.5) * 1.6, base = 2200 + Math.random() * 1800, n = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) this._tone({ freq: base * (1 + Math.random() * 0.25), sweepTo: base * (0.7 + Math.random() * 0.8), dur: 0.09 + Math.random() * 0.08, vol: 0.05, delay: i * 0.13, pan: p, out: this.amb, verb: 0.3 });
  }
  owl() { if (!this.ctx) return; const p = (Math.random() - 0.5) * 1.6; this._tone({ freq: 420, sweepTo: 380, dur: 0.5, vol: 0.09, attack: 0.08, pan: p, out: this.amb, verb: 0.6 }); this._tone({ freq: 350, sweepTo: 300, dur: 0.7, vol: 0.09, attack: 0.08, delay: 0.7, pan: p, out: this.amb, verb: 0.6 }); }
  wolf() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, p = (Math.random() - 0.5) * 1.8;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t); o.frequency.linearRampToValueAtTime(520, t + 1.2); o.frequency.linearRampToValueAtTime(470, t + 3.2); o.frequency.linearRampToValueAtTime(300, t + 5.2);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 1); g.gain.linearRampToValueAtTime(0.07, t + 3.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) pan.pan.value = p;
    o.connect(f).connect(g); (pan ? g.connect(pan) : g).connect(this.amb); g.connect(this.reverb);
    o.start(t); vib.start(t); o.stop(t + 5.6); vib.stop(t + 5.6);
  }
  crackle(vol) { if (!this.ctx) return; this._burst({ type: 'highpass', freq: 2500 + Math.random() * 3000, dur: 0.02 + Math.random() * 0.03, vol: vol * (0.3 + Math.random() * 0.7), attack: 0.001, out: this.amb, pan: (Math.random() - 0.5) * 0.4 }); }
  heartbeat(v) { if (!this.ctx) return; this._tone({ freq: 62, sweepTo: 42, dur: 0.16, vol: v }); this._tone({ freq: 56, sweepTo: 40, dur: 0.16, vol: v * 0.75, delay: 0.2 }); }
  breath(v, tired) { if (!this.ctx) return; this._burst({ type: 'bandpass', freq: 900 + tired * 300, q: 0.7, dur: 0.5 - tired * 0.15, vol: v, attack: 0.15 }); }

  // ---------- music: a slow pad on a four-chord loop with occasional plucked notes ----------
  _musicChord() {
    const ctx = this.ctx, t = ctx.currentTime;
    const minor = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];       // Am F C G
    const major = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]];
    const tense = [[57, 60, 63], [56, 59, 63], [53, 56, 60], [55, 58, 62]];
    const set = this.mood === 'triumph' ? major : this.mood === 'danger' ? tense : minor;
    const chord = set[this.chordIndex++ % 4];
    const bright = this.mood === 'danger' ? 1100 : this.mood === 'triumph' ? 1600 : 700;
    for (const note of chord) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (note - 69) / 12); o.detune.value = detune;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = bright; f.Q.value = 0.5;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.022, t + 3); g.gain.linearRampToValueAtTime(0.018, t + 6); g.gain.linearRampToValueAtTime(0.0001, t + 9.5);
        o.connect(f).connect(g).connect(this.musicBus); g.connect(this.reverb);
        o.start(t); o.stop(t + 10);
      }
    }
    // a low drone under the chord
    const d = ctx.createOscillator(); d.type = 'sine'; d.frequency.value = 440 * Math.pow(2, (chord[0] - 12 - 69) / 12);
    const dg = ctx.createGain(); dg.gain.setValueAtTime(0.0001, t); dg.gain.linearRampToValueAtTime(0.05, t + 2); dg.gain.linearRampToValueAtTime(0.0001, t + 9.5);
    d.connect(dg).connect(this.musicBus); d.start(t); d.stop(t + 10);
    this.pluckScale = chord.map((n) => n + 12).concat(chord.map((n) => n + 24));
  }
  _pluck() {
    if (!this.pluckScale) return;
    const note = this.pluckScale[(Math.random() * this.pluckScale.length) | 0];
    this._tone({ type: 'triangle', freq: 440 * Math.pow(2, (note - 69) / 12), dur: 2.2, vol: 0.05, attack: 0.01, out: this.musicBus, verb: 1 });
  }

  // ---------- per-frame mix ----------
  // s: { wind, rain, indoor, creek (0..1 nearness), lake, fireVol, night, day, underwater, stamina, health, hour, storm, tension,
  //      heli: {pos, vol, on}, camera, dt }
  update(s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime, dt = s.dt;
    const set = (param, v, tc = 0.25) => param.setTargetAtTime(v, t, tc);
    const shelter = s.indoor, open = 1 - shelter * 0.8;

    set(this.wind.g.gain, (0.02 + s.wind * 0.42) * (1 - shelter * 0.75));
    set(this.wind.f.frequency, 260 + s.wind * 900 + Math.sin(t * 0.4) * 80);
    set(this.windHigh.g.gain, (s.wind > 0.55 ? (s.wind - 0.55) * 0.35 : 0) * open);
    set(this.rain.g.gain, s.rain * 0.13 * (1 - shelter * 0.85));
    set(this.rainLow.g.gain, s.rain * 0.3 * (0.5 + shelter * 0.6));
    set(this.rainLow.f.frequency, shelter > 0.5 ? 380 : 800);
    set(this.creek.g.gain, s.creek * 0.28 * open);
    set(this.lake.g.gain, s.lake * (0.1 + 0.05 * Math.sin(t * 0.7)) * open);
    set(this.fireRoar.g.gain, s.fireVol * 0.22);
    set(this.under.g.gain, s.underwater * 0.5);
    set(this.master.gain, this.muted ? 0 : this.volume * (1 - s.underwater * 0.45), 0.15);

    // life in the valley: birds by day, owls and wolves after dark
    const calm = 1 - clamp(s.rain * 1.4 + s.storm, 0, 1);
    if ((this.t.bird -= dt) <= 0) { this.t.bird = 2 + Math.random() * 7; if (s.day > 0.4 && calm > 0.4 && shelter < 0.5) this.bird(); }
    if ((this.t.owl -= dt) <= 0) { this.t.owl = 14 + Math.random() * 30; if (s.night > 0.6 && calm > 0.5 && shelter < 0.5) this.owl(); }
    if ((this.t.wolf -= dt) <= 0) { this.t.wolf = 50 + Math.random() * 70; if (s.night > 0.6 && s.storm < 0.7 && shelter < 0.9 && s.wolves) this.wolf(); }
    if ((this.t.crackle -= dt) <= 0 && s.fireVol > 0.03) { this.t.crackle = 0.05 + Math.random() * 0.25; this.crackle(0.35 * s.fireVol); }

    // body
    if (s.health < 32 && (this.t.heart -= dt) <= 0) { const k = 1 - s.health / 32; this.t.heart = 1.15 - 0.4 * k; this.heartbeat(0.18 + 0.4 * k); }
    if (s.stamina < 28 && (this.t.breath -= dt) <= 0) { const k = 1 - s.stamina / 28; this.t.breath = 1.5 - 0.7 * k; this.breath(0.06 + 0.12 * k, k); }

    // helicopter
    if (this.heli) {
      const H = this.heli;
      set(H.gain.gain, s.heli?.on ? s.heli.vol : 0, 0.3);
      if (s.heli?.on) {
        H.panner.positionX.value = s.heli.pos.x; H.panner.positionY.value = s.heli.pos.y; H.panner.positionZ.value = s.heli.pos.z;
        H.lfo.frequency.setTargetAtTime(11 + (s.heli.load || 0) * 2, t, 0.5);
      }
    }
    const L = ctx.listener, c = s.camera;
    if (L.positionX) {
      L.positionX.value = c.pos.x; L.positionY.value = c.pos.y; L.positionZ.value = c.pos.z;
      L.forwardX.value = c.fwd.x; L.forwardY.value = c.fwd.y; L.forwardZ.value = c.fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    }

    // score
    if (this.musicOn) {
      this.musicBus.gain.setTargetAtTime(0.5 * (1 - shelter * 0.2), t, 1);
      if ((this.t.music -= dt) <= 0) { this.t.music = 9; this._musicChord(); }
      if (Math.random() < dt * 0.22) this._pluck();
    } else this.musicBus.gain.setTargetAtTime(0, t, 0.4);
  }
}
