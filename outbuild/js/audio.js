// Every sound is synthesised with the Web Audio API: no audio files.
import * as THREE from 'three';

const GUNS = {
  pistol: { thump: 140, body: 2200, decay: 0.12, crack: 0.5, tail: 0.25, gain: 0.8 },
  smg: { thump: 160, body: 2600, decay: 0.08, crack: 0.4, tail: 0.15, gain: 0.6 },
  ar: { thump: 120, body: 1800, decay: 0.14, crack: 0.7, tail: 0.35, gain: 0.85 },
  pump: { thump: 70, body: 900, decay: 0.3, crack: 0.3, tail: 0.6, gain: 1.1 },
  tactical: { thump: 85, body: 1100, decay: 0.24, crack: 0.3, tail: 0.5, gain: 1 },
  sniper: { thump: 60, body: 1400, decay: 0.35, crack: 1, tail: 1.2, gain: 1.2 },
  rocket: { thump: 50, body: 500, decay: 0.45, crack: 0, tail: 0.8, gain: 1 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.musicVol = 0.5;
    this.listener = new THREE.Vector3();
    this.listenerFwd = new THREE.Vector3(0, 0, -1);
    this.loops = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVol * 0.5;
    this.music.connect(this.master);
    // shared noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // simple reverb impulse
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain).connect(this.master);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(v) { this.musicVol = v; if (this.music) this.music.gain.value = v * 0.5; }

  setListener(pos, fwd) { this.listener.copy(pos); this.listenerFwd.copy(fwd); }

  // ------------------------------------------------------------------ building blocks
  get now() { return this.ctx.currentTime; }

  out(pos, vol = 1, maxDist = 120) {
    // returns a node to connect sources into: distance gain + stereo pan
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol;
    let pan = 0;
    let lp = 20000;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxDist) return null;
      v *= 1 / (1 + d * 0.06) * Math.max(0, 1 - d / maxDist) ** 0.5;
      const f = this.listenerFwd;
      const rx = -f.z, rz = f.x; // listener right on the ground plane
      const len = Math.hypot(dx, dz) || 1;
      pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len)) * Math.min(1, d / 3);
      lp = 20000 / (1 + d * 0.04);
    }
    g.gain.value = v;
    let node = g;
    if (lp < 19000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      g.connect(f);
      node = f;
    }
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      p.connect(this.sfx);
    } else node.connect(this.sfx);
    return g;
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  env(node, t, a, peak, d, sustain = 0.0001) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }

  tone(dest, t, freq, dur, type = 'sine', peak = 0.3, freqEnd = null, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  burst(dest, t, dur, type, freq, q, peak, attack = 0.002) {
    const ctx = this.ctx;
    const s = this.noiseSrc(t, dur + attack);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(dest);
  }

  // ------------------------------------------------------------------ sounds
  gun(kind, pos, own = false) {
    if (!this.ctx) return;
    const p = GUNS[kind] || GUNS.ar;
    const dest = this.out(own ? null : pos, p.gain * (own ? 0.55 : 1), 380);
    if (!dest) return;
    const t = this.now;
    const d = own ? 0 : pos.distanceTo(this.listener);
    const far = Math.min(1, d / 150);
    this.tone(dest, t, p.thump * (0.9 + Math.random() * 0.2), 0.12 + p.decay * 0.5, 'triangle', 0.9, p.thump * 0.4);
    this.burst(dest, t, p.decay, 'lowpass', p.body * (1 - far * 0.6), 0.7, 1);
    if (p.crack > 0 && far < 0.8) this.burst(dest, t, 0.03, 'highpass', 3500, 0.7, p.crack * (1 - far));
    this.burst(dest, t + 0.01, p.tail, 'lowpass', 600, 0.5, 0.25 + far * 0.3, 0.02);
    const r = this.ctx.createGain();
    r.gain.value = own ? 0.25 : 0.4;
    dest.connect(r).connect(this.reverb);
    if (kind === 'pump') this.mech(pos, own, 0.35);
  }

  mech(pos, own, delay = 0) {
    const dest = this.out(own ? null : pos, 0.35, 40);
    if (!dest) return;
    const t = this.now + delay;
    this.burst(dest, t, 0.03, 'bandpass', 2500, 3, 0.6);
    this.burst(dest, t + 0.12, 0.04, 'bandpass', 1800, 3, 0.7);
  }

  reload(pos, own) {
    if (!this.ctx) return;
    const dest = this.out(own ? null : pos, 0.35, 30);
    if (!dest) return;
    const t = this.now;
    this.burst(dest, t + 0.1, 0.03, 'bandpass', 2200, 4, 0.5);
    this.burst(dest, t + 0.5, 0.04, 'bandpass', 1500, 4, 0.6);
    this.burst(dest, t + 0.9, 0.03, 'bandpass', 3000, 4, 0.5);
  }

  empty() {
    if (!this.ctx) return;
    this.burst(this.out(null, 0.3), this.now, 0.02, 'bandpass', 3000, 5, 0.6);
  }

  footstep(pos, own, surface = 'ground', speed = 6) {
    if (!this.ctx) return;
    const dest = this.out(own ? null : pos, own ? 0.18 : 0.5, 45);
    if (!dest) return;
    const t = this.now;
    const f = surface === 'wood' ? 500 : surface === 'metal' ? 1600 : surface === 'stone' ? 900 : 700;
    this.burst(dest, t, 0.06, 'lowpass', f * (0.8 + Math.random() * 0.4), 1, 0.7 + speed * 0.03);
    if (surface === 'wood') this.tone(dest, t, 160 + Math.random() * 30, 0.06, 'triangle', 0.25);
    if (surface === 'metal') this.tone(dest, t, 900 + Math.random() * 200, 0.08, 'sine', 0.06);
  }

  jump(own) { if (this.ctx) this.burst(this.out(null, own ? 0.15 : 0.1), this.now, 0.15, 'bandpass', 900, 1, 0.5, 0.02); }

  land(pos, own, heavy = 0) {
    if (!this.ctx) return;
    const dest = this.out(own ? null : pos, 0.5 + heavy * 0.1, 40);
    if (!dest) return;
    this.burst(dest, this.now, 0.12 + heavy * 0.02, 'lowpass', 400, 1, 0.8);
    this.tone(dest, this.now, 90, 0.12, 'sine', 0.4, 50);
  }

  build(mat, pos, own) {
    if (!this.ctx) return;
    const dest = this.out(own ? null : pos, 0.55, 60);
    if (!dest) return;
    const t = this.now;
    if (mat === 'wood') {
      this.tone(dest, t, 220, 0.12, 'triangle', 0.5, 160);
      this.burst(dest, t, 0.06, 'bandpass', 1200, 2, 0.5);
    } else if (mat === 'stone') {
      this.tone(dest, t, 320, 0.1, 'square', 0.12, 200);
      this.burst(dest, t, 0.09, 'bandpass', 2200, 1.5, 0.6);
    } else {
      for (const [f, a] of [[420, 0.18], [1130, 0.1], [1840, 0.06]]) this.tone(dest, t, f, 0.5, 'sine', a);
      this.burst(dest, t, 0.05, 'highpass', 3000, 1, 0.3);
    }
    this.tone(dest, t + 0.02, 880, 0.08, 'sine', 0.05, 1320);
  }

  breakPiece(mat, pos) {
    if (!this.ctx) return;
    const dest = this.out(pos, 0.8, 90);
    if (!dest) return;
    const t = this.now;
    this.burst(dest, t, 0.35, 'lowpass', mat === 'metal' ? 2500 : 1200, 0.8, 0.9);
    for (let i = 0; i < 4; i++) this.burst(dest, t + i * 0.05 + Math.random() * 0.04, 0.05, 'bandpass', 600 + Math.random() * 1800, 3, 0.5);
    if (mat === 'metal') this.tone(dest, t, 300, 0.6, 'sine', 0.12, 200);
  }

  harvest(mat, pos, own, weak = false) {
    if (!this.ctx) return;
    const dest = this.out(own ? null : pos, 0.6, 50);
    if (!dest) return;
    const t = this.now;
    if (mat === 'wood') { this.tone(dest, t, 180, 0.1, 'triangle', 0.6, 120); this.burst(dest, t, 0.05, 'bandpass', 900, 2, 0.6); }
    else if (mat === 'stone') { this.tone(dest, t, 700, 0.08, 'triangle', 0.25, 500); this.burst(dest, t, 0.07, 'bandpass', 2600, 2, 0.6); }
    else { for (const [f, a] of [[520, 0.2], [1380, 0.1], [2150, 0.06]]) this.tone(dest, t, f, 0.35, 'sine', a); }
    if (weak) this.tone(this.out(null, 0.3), t, 1320, 0.15, 'sine', 0.4, 1760);
  }

  swing(own) { if (this.ctx && own) this.burst(this.out(null, 0.12), this.now, 0.18, 'bandpass', 700, 0.8, 0.6, 0.04); }

  pickup() {
    if (!this.ctx) return;
    const d = this.out(null, 0.35);
    const t = this.now;
    this.tone(d, t, 660, 0.08, 'triangle', 0.4);
    this.tone(d, t + 0.06, 990, 0.1, 'triangle', 0.35);
  }

  chestOpen(pos) {
    if (!this.ctx) return;
    const d = this.out(pos, 0.5, 40);
    if (!d) return;
    const t = this.now;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(d, t + i * 0.05, f, 0.5, 'sine', 0.22));
    this.burst(d, t, 0.6, 'highpass', 5000, 1, 0.15, 0.05);
  }

  hitmarker(head, shield) {
    if (!this.ctx) return;
    const d = this.out(null, 0.35);
    const t = this.now;
    if (head) { this.tone(d, t, 1600, 0.2, 'sine', 0.5); this.tone(d, t, 2400, 0.15, 'sine', 0.2); }
    else if (shield) { this.tone(d, t, 1250, 0.08, 'sine', 0.3); this.burst(d, t, 0.04, 'highpass', 4000, 1, 0.2); }
    else this.burst(d, t, 0.03, 'bandpass', 2400, 3, 0.6);
  }

  hurt(shieldHit, shieldBroken) {
    if (!this.ctx) return;
    const d = this.out(null, 0.45);
    const t = this.now;
    if (shieldBroken) {
      this.burst(d, t, 0.4, 'highpass', 2500, 0.7, 0.8);
      [1400, 1100, 800].forEach((f, i) => this.tone(d, t + i * 0.04, f, 0.25, 'sine', 0.2, f * 0.7));
    } else if (shieldHit) {
      this.tone(d, t, 1100 + Math.random() * 200, 0.15, 'sine', 0.2, 700);
      this.burst(d, t, 0.08, 'bandpass', 3200, 2, 0.4);
    } else {
      this.tone(d, t, 110, 0.18, 'sine', 0.6, 60);
      this.burst(d, t, 0.12, 'lowpass', 500, 1, 0.6);
    }
  }

  heal(shield) {
    if (!this.ctx) return;
    const d = this.out(null, 0.3);
    const t = this.now;
    const base = shield ? 740 : 523;
    [0, 4, 7, 12].forEach((s, i) => this.tone(d, t + i * 0.07, base * 2 ** (s / 12), 0.3, 'sine', 0.2));
  }

  eliminated(own) {
    if (!this.ctx) return;
    const d = this.out(null, 0.5);
    const t = this.now;
    if (own) {
      // we got the elimination: bright rising chord
      [392, 523, 659, 784].forEach((f, i) => this.tone(d, t + i * 0.06, f, 0.6, 'triangle', 0.18));
    } else {
      [440, 370, 294].forEach((f, i) => this.tone(d, t + i * 0.18, f, 0.5, 'triangle', 0.2));
    }
  }

  explosion(pos) {
    if (!this.ctx) return;
    const dest = this.out(pos, 1.2, 400);
    if (!dest) return;
    const t = this.now;
    this.tone(dest, t, 70, 0.8, 'sine', 1, 30);
    this.burst(dest, t, 1.2, 'lowpass', 1400, 0.6, 1);
    this.burst(dest, t, 0.25, 'highpass', 2000, 0.5, 0.4);
    const r = this.ctx.createGain();
    r.gain.value = 0.6;
    dest.connect(r).connect(this.reverb);
  }

  glider() { if (this.ctx) this.burst(this.out(null, 0.5), this.now, 0.4, 'bandpass', 500, 0.8, 0.8, 0.02); }

  ui(kind = 'click') {
    if (!this.ctx) return;
    const d = this.out(null, 0.25);
    if (kind === 'hover') this.tone(d, this.now, 1200, 0.04, 'sine', 0.08);
    else this.tone(d, this.now, 700, 0.06, 'triangle', 0.3, 900);
  }

  warning() {
    if (!this.ctx) return;
    const d = this.out(null, 0.35);
    const t = this.now;
    this.tone(d, t, 880, 0.15, 'square', 0.08);
    this.tone(d, t + 0.2, 660, 0.25, 'square', 0.08);
  }

  thunder() {
    if (!this.ctx) return;
    const d = this.out(null, 0.5);
    const t = this.now;
    this.burst(d, t, 2.5, 'lowpass', 300, 0.5, 0.9, 0.1);
    this.burst(d, t + 0.05, 0.3, 'lowpass', 1200, 0.5, 0.5);
  }

  victory() {
    if (!this.ctx) return;
    const d = this.out(null, 0.6);
    const t = this.now;
    // an original little fanfare
    const notes = [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [988, 0.75], [1047, 0.9], [1319, 1.05]];
    for (const [f, dt] of notes) { this.tone(d, t + dt, f, 0.45, 'triangle', 0.22); this.tone(d, t + dt, f / 2, 0.45, 'sine', 0.12); }
    [523, 659, 784, 1047].forEach((f) => this.tone(d, t + 1.35, f, 1.8, 'sawtooth', 0.05));
    [523, 659, 784, 1047].forEach((f) => this.tone(d, t + 1.35, f, 1.8, 'sine', 0.12));
  }

  defeat() {
    if (!this.ctx) return;
    const d = this.out(null, 0.5);
    const t = this.now;
    [[392, 0], [349, 0.3], [311, 0.6], [262, 0.9]].forEach(([f, dt]) => this.tone(d, t + dt, f, 0.6, 'triangle', 0.2));
  }

  // ------------------------------------------------------------------ loops
  loop(name, make) {
    if (!this.ctx) return null;
    if (!this.loops[name]) this.loops[name] = make();
    return this.loops[name];
  }

  noiseLoop(filterType, freq, q) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
    return { src: s, filter: f, gain: g };
  }

  setWind(level) {
    const l = this.loop('wind', () => this.noiseLoop('bandpass', 600, 0.6));
    if (!l) return;
    l.gain.gain.setTargetAtTime(level * 0.5, this.now, 0.2);
    l.filter.frequency.setTargetAtTime(400 + level * 900, this.now, 0.3);
  }

  setStorm(level) {
    const l = this.loop('storm', () => this.noiseLoop('lowpass', 250, 0.8));
    if (!l) return;
    l.gain.gain.setTargetAtTime(level * 0.6, this.now, 0.4);
  }

  setEngine(level) {
    const l = this.loop('engine', () => {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 55;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 18;
      const lg = ctx.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg).connect(g.gain);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(); lfo.start();
      return { gain: g };
    });
    if (!l) return;
    l.gain.gain.setTargetAtTime(level * 0.25, this.now, 0.3);
  }

  setChest(level) {
    const l = this.loop('chest', () => {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.sfx);
      for (const f of [523.25, 659.25, 783.99]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 3 + Math.random() * 2;
        const lg = ctx.createGain();
        lg.gain.value = 0.03;
        lfo.connect(lg).connect(og.gain);
        o.connect(og).connect(g);
        o.start(); lfo.start();
      }
      return { gain: g };
    });
    if (!l) return;
    l.gain.gain.setTargetAtTime(level * 0.8, this.now, 0.2);
  }

  // ------------------------------------------------------------------ music (original, procedural)
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const chords = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]]; // I V vi IV in C
    const root = 261.63;
    let bar = 0;
    const play = () => {
      const t = this.now + 0.05;
      const ch = chords[bar % chords.length];
      const beat = 0.5;
      // pad
      for (const s of ch) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = root * 2 ** (s / 12) / 2;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.4);
        g.gain.linearRampToValueAtTime(0.0001, t + beat * 8);
        o.connect(f).connect(g).connect(this.music);
        o.start(t); o.stop(t + beat * 8 + 0.1);
      }
      // plucked arpeggio
      const pattern = [0, 1, 2, 1, 2, 0, 2, 1];
      pattern.forEach((k, i) => {
        const f = root * 2 ** (ch[k] / 12) * (i % 4 === 3 ? 2 : 1);
        this.tone(this.music, t + i * beat, f, 0.4, 'triangle', 0.08);
      });
      // bass
      this.tone(this.music, t, root / 2 * 2 ** (ch[0] / 12), beat * 3, 'sine', 0.18);
      this.tone(this.music, t + beat * 4, root / 2 * 2 ** (ch[0] / 12), beat * 3, 'sine', 0.15);
      bar++;
    };
    play();
    this.musicTimer = setInterval(play, 4000);
  }

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  silenceLoops() {
    for (const k of Object.keys(this.loops)) {
      const l = this.loops[k];
      if (l && l.gain) l.gain.gain.setTargetAtTime(0, this.now, 0.1);
    }
  }
}
