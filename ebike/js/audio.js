// Fully synthesised sound: e-bike motor whine, wind, rain, sirens, crashes. No audio files.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const noiseBuf = (secs, brown = false) => {
      const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      return b;
    };
    this.noise = noiseBuf(2);
    const loopNoise = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // motor: whine (triangle + sine) + low hum
    this.motor = { a: ctx.createOscillator(), b: ctx.createOscillator(), c: ctx.createOscillator(), g: ctx.createGain(), f: ctx.createBiquadFilter() };
    this.motor.a.type = 'sawtooth'; this.motor.b.type = 'triangle'; this.motor.c.type = 'sine';
    this.motor.f.type = 'lowpass'; this.motor.f.frequency.value = 1400;
    for (const o of [this.motor.a, this.motor.b, this.motor.c]) { o.connect(this.motor.f); o.start(); }
    this.motor.g.gain.value = 0;
    this.motor.f.connect(this.motor.g).connect(this.master);

    // wind
    const wind = loopNoise(this.noise);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 700; this.windF.Q.value = 0.5;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    wind.connect(this.windF).connect(this.windG).connect(this.master);

    // rain + city rumble
    const rain = loopNoise(this.noise);
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 2600;
    const rg = ctx.createGain(); rg.gain.value = 0.05;
    rain.connect(rf).connect(rg).connect(this.master);
    const rumble = loopNoise(noiseBuf(4, true));
    const rmf = ctx.createBiquadFilter(); rmf.type = 'lowpass'; rmf.frequency.value = 220;
    const rmg = ctx.createGain(); rmg.gain.value = 0.35;
    rumble.connect(rmf).connect(rmg).connect(this.master);

    // tyre / drift hiss
    const sk = loopNoise(this.noise);
    this.skidF = ctx.createBiquadFilter(); this.skidF.type = 'bandpass'; this.skidF.frequency.value = 1800; this.skidF.Q.value = 2;
    this.skidG = ctx.createGain(); this.skidG.gain.value = 0;
    sk.connect(this.skidF).connect(this.skidG).connect(this.master);

    // three siren voices
    this.sirens = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.value = 1100;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(f); o2.connect(f);
      f.connect(g);
      if (pan) g.connect(pan).connect(this.master); else g.connect(this.master);
      o.start(); o2.start();
      this.sirens.push({ o, o2, g, pan });
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** speed m/s, boost bool, slip 0..1, sirens: [{dist, pan, vel}] nearest first */
  update(speed, throttle, boost, slip, sirens, time, alive = true) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = this.motor;
    const f = 140 + speed * 34 + (boost ? 60 : 0);
    m.a.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    m.b.frequency.setTargetAtTime(f, t, 0.05);
    m.c.frequency.setTargetAtTime(f * 2.02, t, 0.05);
    m.g.gain.setTargetAtTime(alive ? 0.045 + 0.05 * Math.min(1, speed / 25) * (0.5 + 0.5 * throttle) + (boost ? 0.03 : 0) : 0, t, 0.08);
    this.windG.gain.setTargetAtTime(Math.pow(Math.min(1, speed / 30), 2) * 0.22, t, 0.1);
    this.windF.frequency.setTargetAtTime(500 + speed * 45, t, 0.1);
    this.skidG.gain.setTargetAtTime(slip * 0.16, t, 0.05);
    this.skidF.frequency.setTargetAtTime(1400 + slip * 900, t, 0.1);

    this.sirens.forEach((s, i) => {
      const d = sirens[i];
      if (!d) { s.g.gain.setTargetAtTime(0, t, 0.1); return; }
      // wail: 550..1250 Hz, 3 s period, each voice out of phase; simple Doppler from closing speed
      const ph = ((time + i * 0.9) % 3) / 3;
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const freq = (560 + 720 * tri) * (1 - Math.max(-60, Math.min(60, d.vel)) / 343);
      s.o.frequency.setTargetAtTime(freq, t, 0.03);
      s.o2.frequency.setTargetAtTime(freq * 2.003, t, 0.03);
      const gain = 0.11 / (1 + d.dist / 22) * (i === 0 ? 1 : 0.7);
      s.g.gain.setTargetAtTime(gain, t, 0.08);
      if (s.pan) s.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, d.pan)), t, 0.05);
    });
  }

  burst(dur, f0, f1, gain, type = 'lowpass') {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  tone(freq, dur, gain = 0.15, type = 'sine', slideTo = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  crash(power = 1) {
    this.burst(0.35 + 0.3 * power, 2400, 90, 0.5 * power);
    this.tone(70, 0.3, 0.4 * power, 'sine', 35);
    if (power > 0.6) this.burst(0.5, 6000, 800, 0.15, 'highpass');
  }
  scrape() { this.burst(0.18, 5000, 1500, 0.08, 'bandpass'); }
  pickup() { this.tone(660, 0.12, 0.13, 'triangle'); setTimeout(() => this.tone(990, 0.18, 0.13, 'triangle'), 70); }
  heatUp() { this.tone(300, 0.5, 0.18, 'sawtooth', 600); }
  heatDown() { this.tone(700, 0.4, 0.14, 'triangle', 350); }
  takedown() { this.tone(180, 0.25, 0.25, 'square', 60); this.burst(0.3, 1800, 200, 0.25); }
  busted() { this.tone(520, 1.0, 0.25, 'square', 130); }
  nearMiss() { this.burst(0.25, 3000, 500, 0.1, 'bandpass'); }
}
