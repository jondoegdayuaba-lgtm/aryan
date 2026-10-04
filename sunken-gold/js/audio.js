// Every sound is synthesised with the Web Audio API: regulator breathing,
// exhaled bubbles, the crackle of snapping shrimp on the reef, the scooter
// motor, shark tension and heartbeat, dive-computer alarms and pickup chimes.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.nextBreath = 0;
    this.nextClick = 0;
    this.nextBeep = 0;
    this.nextBeat = 0;
    this.onExhale = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    // Everything underwater goes through a muffling filter.
    this.water = ctx.createBiquadFilter();
    this.water.type = 'lowpass';
    this.water.frequency.value = 2400;
    this.water.connect(this.master);
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
    this.click = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.004), ctx.sampleRate);
    const c = this.click.getChannelData(0);
    for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.length * 0.18));

    // Deep ocean rumble.
    const amb = ctx.createBiquadFilter();
    amb.type = 'lowpass';
    amb.frequency.value = 260;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.35;
    this.loop(this.brown).connect(amb).connect(this.ambGain).connect(this.water);

    // Surface: waves slapping.
    const wav = ctx.createBiquadFilter();
    wav.type = 'bandpass';
    wav.frequency.value = 700;
    wav.Q.value = 0.4;
    this.waveGain = ctx.createGain();
    this.waveGain.gain.value = 0;
    this.loop(this.noise).connect(wav).connect(this.waveGain).connect(this.master);

    // Scooter motor: a buzzy saw through a low-pass, pitch follows speed.
    this.motor = ctx.createOscillator();
    this.motor.type = 'sawtooth';
    this.motor.frequency.value = 90;
    this.motor2 = ctx.createOscillator();
    this.motor2.type = 'square';
    this.motor2.frequency.value = 181;
    const mf = ctx.createBiquadFilter();
    mf.type = 'lowpass';
    mf.frequency.value = 500;
    this.motorFilter = mf;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const m2g = ctx.createGain();
    m2g.gain.value = 0.25;
    this.motor.connect(mf);
    this.motor2.connect(m2g).connect(mf);
    mf.connect(this.motorGain).connect(this.water);
    this.motor.start();
    this.motor2.start();

    // Vent bubbling.
    const vf = ctx.createBiquadFilter();
    vf.type = 'bandpass';
    vf.frequency.value = 500;
    vf.Q.value = 2;
    this.ventGain = ctx.createGain();
    this.ventGain.gain.value = 0;
    this.ventLFO = ctx.createOscillator();
    this.ventLFO.frequency.value = 13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    this.ventLFO.connect(lfoGain).connect(vf.frequency);
    this.ventLFO.start();
    this.loop(this.noise).connect(vf).connect(this.ventGain).connect(this.water);

    // Shark tension drone.
    this.drone = [55, 58.3].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.start();
      return o;
    });
    const df = ctx.createBiquadFilter();
    df.type = 'lowpass';
    df.frequency.value = 220;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.drone.forEach((o) => o.connect(df));
    df.connect(this.droneGain).connect(this.master);
  }

  loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  env(node, t, peak, attack, hold, release) {
    const g = node.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  noiseBurst(t, dur, type, freq, q, peak, dest = this.water, attack = 0.02) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(dest);
    this.env(g, t, peak, attack, dur * 0.4, dur * 0.6);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.1);
    return { f, g };
  }

  tone(t, freq, dur, peak, type = 'sine', dest = this.master, glide = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    const g = ctx.createGain();
    o.connect(g).connect(dest);
    this.env(g, t, peak, 0.005, 0.01, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Called every frame with the dive state.
  update(dt, s) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const under = s.underwater;
    this.water.frequency.setTargetAtTime(under ? 2200 : 16000, now, 0.1);
    this.ambGain.gain.setTargetAtTime(under ? 0.32 : 0.05, now, 0.3);
    this.waveGain.gain.setTargetAtTime(under ? 0 : 0.09 + 0.05 * Math.sin(now * 0.9), now, 0.2);
    const motor = s.paused ? 0 : s.throttle;
    this.motorGain.gain.setTargetAtTime(motor * (s.boosting ? 0.07 : 0.045), now, 0.15);
    this.motor.frequency.setTargetAtTime(70 + motor * (s.boosting ? 120 : 70), now, 0.2);
    this.motor2.frequency.setTargetAtTime((70 + motor * (s.boosting ? 120 : 70)) * 2.01, now, 0.2);
    this.motorFilter.frequency.setTargetAtTime(300 + motor * (s.boosting ? 1400 : 700), now, 0.2);
    this.ventGain.gain.setTargetAtTime(s.inVent ? 0.25 : 0, now, 0.2);
    const threat = s.paused ? 0 : s.threat;
    this.droneGain.gain.setTargetAtTime(threat * 0.09, now, 0.4);

    if (s.paused || !s.diving) return;

    // Snapping shrimp: a constant faint crackle on the reef.
    if (under && this.nextClick < now + 0.2) {
      if (this.nextClick < now) this.nextClick = now;
      while (this.nextClick < now + 0.25) {
        this.nextClick += 0.008 + Math.random() * 0.05;
        const src = ctx.createBufferSource();
        src.buffer = this.click;
        const g = ctx.createGain();
        g.gain.value = 0.02 + Math.random() * 0.05 * Math.max(0.2, 1 - s.depth / 60);
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (p) { p.pan.value = Math.random() * 2 - 1; src.connect(g).connect(p).connect(this.master); } else src.connect(g).connect(this.master);
        src.start(this.nextClick);
      }
    }

    // Breathing: inhale through the regulator, exhale a burst of bubbles.
    if (under && now >= this.nextBreath) {
      const stress = Math.min(1, s.stress);
      const period = 4.6 - stress * 2.2;
      const t = Math.max(now, this.nextBreath);
      this.noiseBurst(t, 1.0 - stress * 0.3, 'bandpass', 2600, 0.9, 0.11 + stress * 0.05, this.master, 0.15);
      this.tone(t, 3200, 0.03, 0.02, 'square');
      const ex = t + 1.25 - stress * 0.35;
      const burble = this.noiseBurst(ex, 1.3, 'lowpass', 700, 3, 0.35, this.water, 0.05);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17 + Math.random() * 6;
      const lg = ctx.createGain();
      lg.gain.value = 350;
      lfo.connect(lg).connect(burble.f.frequency);
      lfo.start(ex);
      lfo.stop(ex + 1.5);
      this.exhaleAt = ex;
      this.nextBreath = t + period;
    }
    if (this.exhaleAt && now >= this.exhaleAt) {
      this.exhaleAt = 0;
      this.onExhale?.();
    }
    if (!under) this.nextBreath = now + 1;

    // Dive computer alarm when air runs low.
    if (s.airFrac < s.warn && now >= this.nextBeep) {
      const crit = s.airFrac < s.critical;
      this.tone(now, 2900, 0.07, 0.08, 'square');
      this.tone(now + 0.12, 2900, 0.07, 0.08, 'square');
      if (crit) this.tone(now + 0.24, 2900, 0.07, 0.08, 'square');
      this.nextBeep = now + (crit ? 1.1 : 2.6);
    }

    // Heartbeat while a shark is charging.
    if (s.charging && now >= this.nextBeat) {
      this.tone(now, 60, 0.12, 0.35, 'sine', this.master, 0.6);
      this.tone(now + 0.2, 55, 0.15, 0.25, 'sine', this.master, 0.6);
      this.nextBeat = now + 0.55;
    }
  }

  // Coins ring higher the longer your combo runs.
  coin(i = 0, combo = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + i * 0.035;
    const up = Math.pow(1.122, Math.min(12, combo - 1));
    this.tone(t, (1500 + Math.random() * 120) * up, 0.25, 0.08, 'sine');
    this.tone(t + 0.02, 2250 * up, 0.18, 0.04, 'sine');
  }

  ring() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = this.noiseBurst(t, 1.1, 'bandpass', 500, 1.2, 0.5, this.master, 0.05);
    w.f.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
    this.tone(t, 300, 0.6, 0.08, 'sine', this.master, 2.2);
  }

  golden() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [1047, 1319, 1568, 2093, 2637].forEach((f, i) => this.tone(t + i * 0.06, f, 0.5, 0.08, 'triangle'));
    for (let i = 0; i < 10; i++) this.tone(t + 0.3 + i * 0.04, 2000 + Math.random() * 1500, 0.25, 0.03);
  }

  mission() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.52], [1047, 0.62]].forEach(([f, d]) => {
      this.tone(t + d, f, 0.45, 0.09, 'square', this.water);
      this.tone(t + d, f / 2, 0.45, 0.06, 'triangle');
    });
  }

  pearl() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => this.tone(t + i * 0.08, f, 0.6, 0.09));
  }

  chest() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const creak = this.noiseBurst(t, 0.5, 'bandpass', 300, 8, 0.25, this.water, 0.05);
    creak.f.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    for (let i = 0; i < 14; i++) this.tone(t + 0.35 + i * 0.045 + Math.random() * 0.03, 1700 + Math.random() * 900, 0.3, 0.06);
  }

  relic() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      this.tone(t + i * 0.11, f, 1.4, 0.1, 'triangle');
      this.tone(t + i * 0.11 + 0.25, f, 1.2, 0.03, 'sine');
    });
  }

  grab() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 660, 0.25, 0.08, 'triangle');
    this.tone(t + 0.07, 990, 0.3, 0.07, 'triangle');
  }

  air() {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.7, 'highpass', 3000, 0.5, 0.15, this.master, 0.01);
  }

  bite() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.35, 'lowpass', 900, 1, 0.9, this.master, 0.005);
    this.tone(t, 90, 0.4, 0.6, 'sine', this.master, 0.4);
    this.noiseBurst(t + 0.1, 1.2, 'highpass', 2500, 0.5, 0.2, this.master, 0.01);
  }

  strobe() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 4000, 0.15, 0.06, 'sawtooth', this.master, 0.2);
    this.noiseBurst(t, 0.12, 'highpass', 5000, 0.5, 0.15, this.master, 0.002);
  }

  splash() {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.9, 'lowpass', 1600, 0.7, 0.5, this.master, 0.01);
  }

  bump() {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.18, 'lowpass', 300, 1, 0.25, this.water, 0.005);
  }

  ui() {
    if (!this.ctx) return;
    this.tone(this.ctx.currentTime, 1200, 0.06, 0.05, 'triangle');
  }

  buy() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [700, 1050, 1400].forEach((f, i) => this.tone(t + i * 0.06, f, 0.2, 0.07, 'triangle'));
  }
}
