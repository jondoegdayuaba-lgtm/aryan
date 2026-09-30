// Synthesised sound: wind, snow hiss, skid scrub, impacts and race jingles (Web Audio, no sample files).
import { clamp, damp } from './util.js';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.level = { wind: 0, hiss: 0, scrub: 0, chatter: 0 };
  }

  /** must be called from a user gesture */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // noise buffers
    const sr = ctx.sampleRate;
    const mk = (seconds, colour) => {
      const b = ctx.createBuffer(1, sr * seconds, sr);
      const d = b.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (colour === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else if (colour === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else d[i] = w;
      }
      return b;
    };
    this.pinkBuf = mk(4, 'pink');
    this.whiteBuf = mk(3, 'white');
    this.brownBuf = mk(4, 'brown');

    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // wind
    this.windSrc = loop(this.pinkBuf);
    this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 500; this.windBP.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windBP).connect(this.windGain).connect(this.master);
    // low rumble of the air
    this.rumbleSrc = loop(this.brownBuf);
    this.rumbleLP = ctx.createBiquadFilter(); this.rumbleLP.type = 'lowpass'; this.rumbleLP.frequency.value = 160;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumbleSrc.connect(this.rumbleLP).connect(this.rumbleGain).connect(this.master);
    // snow hiss (carving)
    this.hissSrc = loop(this.whiteBuf);
    this.hissHP = ctx.createBiquadFilter(); this.hissHP.type = 'highpass'; this.hissHP.frequency.value = 2400;
    this.hissBP = ctx.createBiquadFilter(); this.hissBP.type = 'bandpass'; this.hissBP.frequency.value = 5200; this.hissBP.Q.value = 0.4;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    this.hissSrc.connect(this.hissHP).connect(this.hissBP).connect(this.hissGain).connect(this.master);
    // skid scrub
    this.scrubSrc = loop(this.pinkBuf);
    this.scrubBP = ctx.createBiquadFilter(); this.scrubBP.type = 'bandpass'; this.scrubBP.frequency.value = 1100; this.scrubBP.Q.value = 0.9;
    this.scrubGain = ctx.createGain(); this.scrubGain.gain.value = 0;
    this.scrubSrc.connect(this.scrubBP).connect(this.scrubGain).connect(this.master);
    // groomed-snow chatter: noise chopped at a speed-dependent rate
    this.chatSrc = loop(this.whiteBuf);
    this.chatBP = ctx.createBiquadFilter(); this.chatBP.type = 'bandpass'; this.chatBP.frequency.value = 900; this.chatBP.Q.value = 1.2;
    this.chatGain = ctx.createGain(); this.chatGain.gain.value = 0;
    this.chatLFO = ctx.createOscillator(); this.chatLFO.type = 'square'; this.chatLFO.frequency.value = 40;
    this.chatLFOGain = ctx.createGain(); this.chatLFOGain.gain.value = 0;
    this.chatLFO.connect(this.chatLFOGain).connect(this.chatGain.gain);
    this.chatLFO.start();
    this.chatSrc.connect(this.chatBP).connect(this.chatGain).connect(this.master);
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  /** continuous sounds from the physics state */
  update(dt, sk, active) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = active ? (sk.seated > 0.5 ? (sk.windSpeed || 0) : sk.speed) : 0;      // on a chairlift only the wind is heard
    const air = sk.grounded ? 0 : 1;
    const target = { wind: clamp(sp / 34, 0, 1.3), hiss: 0, scrub: 0, chatter: 0 };
    if (sk.grounded && !sk.crashed) {
      const edge = clamp(Math.abs(sk.lean) / 0.9, 0, 1);
      target.hiss = clamp(sp / 30, 0, 1) * (0.25 + 0.75 * edge);
      target.scrub = sk.skidAmount * clamp(sp / 18, 0, 1);
      target.chatter = sk.surface === 'groomed' ? clamp(sp / 34, 0, 1) : 0.15 * clamp(sp / 20, 0, 1);
    } else if (sk.crashed) {
      target.scrub = clamp(sp / 10, 0, 1) * 0.9;
    }
    const L = this.level;
    for (const k of Object.keys(target)) L[k] = damp(L[k], target[k], 7, dt);
    const gust = 1 + 0.18 * Math.sin(t * 0.9) + 0.1 * Math.sin(t * 2.3 + 1.7);
    this.windGain.gain.setTargetAtTime(0.03 + 0.42 * L.wind * L.wind * gust * (1 + 0.25 * air), t, 0.06);
    this.windBP.frequency.setTargetAtTime(260 + 900 * L.wind, t, 0.08);
    this.rumbleGain.gain.setTargetAtTime(0.02 + 0.22 * L.wind, t, 0.1);
    this.hissGain.gain.setTargetAtTime(0.16 * L.hiss, t, 0.05);
    this.hissBP.frequency.setTargetAtTime(3800 + 3200 * clamp(sp / 35, 0, 1), t, 0.1);
    this.scrubGain.gain.setTargetAtTime(0.32 * L.scrub, t, 0.05);
    this.scrubBP.frequency.setTargetAtTime(700 + 500 * clamp(sp / 30, 0, 1), t, 0.1);
    this.chatGain.gain.setTargetAtTime(0.5 * L.chatter * 0.0 + 0.0, t, 0.05);
    this.chatLFOGain.gain.setTargetAtTime(0.06 * L.chatter, t, 0.05);
    this.chatLFO.frequency.setTargetAtTime(28 + 90 * clamp(sp / 34, 0, 1), t, 0.05);
    this.chatBP.frequency.setTargetAtTime(700 + 900 * clamp(sp / 34, 0, 1), t, 0.1);
  }

  // ------------------------------------------------------------------ one-shots
  _env(gain, t, a, d, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(freq, dur, type = 'sine', peak = 0.2, when = 0, slideTo = 0, pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); this._env(g, t, 0.006, dur, peak);
    let node = o;
    node.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.master); }
    else g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, freq, q, peak, when = 0, type = 'lowpass', buf = null) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = buf || this.whiteBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); this._env(g, t, 0.004, dur, peak);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  gate(ok, pan = 0) {
    if (ok) { this.tone(1046, 0.22, 'sine', 0.13, 0, 0, pan); this.tone(1568, 0.3, 'sine', 0.09, 0.04, 0, pan); }
    else { this.tone(200, 0.32, 'sawtooth', 0.12, 0, 90); this.noiseBurst(0.18, 400, 1, 0.1); }
  }

  split() { this.tone(880, 0.12, 'triangle', 0.1); this.tone(1320, 0.18, 'triangle', 0.09, 0.09); }
  beep(go) { this.tone(go ? 1175 : 587, go ? 0.5 : 0.16, 'square', 0.1); }
  pop() { this.tone(180, 0.12, 'sine', 0.18, 0, 420); this.noiseBurst(0.1, 1800, 0.7, 0.06, 0, 'bandpass'); }
  land(power) {
    const p = clamp(power, 0.1, 1);
    this.noiseBurst(0.28, 500, 0.7, 0.4 * p, 0, 'lowpass', this.brownBuf);
    this.tone(70, 0.22, 'sine', 0.5 * p, 0, 40);
    this.noiseBurst(0.2, 3000, 0.7, 0.16 * p, 0, 'highpass');
  }
  crash() {
    this.noiseBurst(0.6, 700, 0.6, 0.55, 0, 'lowpass', this.brownBuf);
    this.tone(55, 0.5, 'sine', 0.6, 0, 30);
    this.noiseBurst(0.5, 2500, 0.5, 0.28, 0.02, 'bandpass');
  }
  finish() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.14, i * 0.11));
    this.tone(1318, 0.9, 'sine', 0.1, 0.5);
  }
  medal(k) {
    const notes = k === 'gold' ? [659, 784, 988, 1318] : k === 'silver' ? [587, 740, 880] : [523, 659, 784];
    notes.forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.12, 0.7 + i * 0.13));
  }
  click() { this.tone(660, 0.06, 'triangle', 0.08); }
}
