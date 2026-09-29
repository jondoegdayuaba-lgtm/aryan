// Rally logic: countdown, checkpoints in order, split times against your best,
// medals, and a progress tracker along the route (also used for respawning).

// Medal times for each bike (seconds for a lap).
export const MEDALS = {
  volt: [{ name: 'Gold', time: 165 }, { name: 'Silver', time: 183 }, { name: 'Bronze', time: 212 }],
  sting: [{ name: 'Gold', time: 149 }, { name: 'Silver', time: 166 }, { name: 'Bronze', time: 192 }],
  storm: [{ name: 'Gold', time: 138 }, { name: 'Silver', time: 154 }, { name: 'Bronze', time: 178 }],
};

// Wheelie challenge: metres on one wheel.
export const WHEELIE_MEDALS = [{ name: 'Gold', dist: 500 }, { name: 'Silver', dist: 250 }, { name: 'Bronze', dist: 100 }];

export function formatTime(t, showMs = true) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = Math.floor(s).toString().padStart(2, '0');
  const cs = Math.floor((s % 1) * 100).toString().padStart(2, '0');
  return showMs ? `${m}:${ss}.${cs}` : `${m}:${ss}`;
}

export class Race {
  constructor(route, gates) {
    this.route = route;
    this.gates = gates;
    this.checkpoints = gates.gates.map((g) => g.s);
    this.reset();
  }

  reset() {
    this.state = 'idle';       // idle | countdown | running | finished
    this.time = 0;
    this.countdown = 0;
    this.next = 0;
    this.splits = [];
    this.progressS = null;
    this.lastSafe = null;
    this.gates.setNext(0);
  }

  startCountdown(seconds = 3) {
    this.reset();
    this.state = 'countdown';
    this.countdown = seconds;
  }

  // Track position along the route; returns events that happened this frame.
  update(dt, vehicle) {
    const ev = [];
    const R = this.route;
    const n = R.nearest(vehicle.pos.x, vehicle.pos.z, this.progressS, 90);
    const prev = this.progressS ?? n.s;
    this.progressS = n.s;
    this.lateral = n.d;
    // Remember recent safe spots on the road for respawning.
    if (n.d < 6 && vehicle.groundedWheels === vehicle.wheels.length && vehicle.speed > 3 && !vehicle.crashed && !vehicle.upsideDown) this.lastSafe = n.s;

    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) ev.push({ type: 'count', value: after });
      if (this.countdown <= 0) {
        this.state = 'running';
        this.time = 0;
        ev.push({ type: 'go' });
      }
      return ev;
    }
    if (this.state !== 'running') return ev;
    this.time += dt;

    // Checkpoint crossing: the route position swept past the gate this frame, near the road.
    const d = R.wrapS(n.s - prev);
    if (d > 0 && d < 120) {
      const cs = this.checkpoints[this.next];
      if (R.wrapS(cs - prev) <= d && n.d < 18) {
        this.splits.push(this.time);
        const idx = this.next;
        this.next++;
        const finished = this.next >= this.checkpoints.length;
        ev.push({ type: finished ? 'finish' : 'checkpoint', index: idx, time: this.time });
        if (finished) {
          this.state = 'finished';
          this.gates.setNext(-1);
        } else this.gates.setNext(this.next);
      }
    }
    return ev;
  }

  // Distance along the route to the next gate (for the HUD).
  distanceToNext() {
    if (this.state === 'finished' || this.progressS === null) return 0;
    return this.route.wrapS(this.checkpoints[this.next] - this.progressS);
  }

  nextGate() {
    return this.gates.gates[this.next] || null;
  }

  medalFor(t, bikeId) {
    for (const m of MEDALS[bikeId] || MEDALS.volt) if (t <= m.time) return m.name;
    return null;
  }

  static wheelieMedal(d) {
    for (const m of WHEELIE_MEDALS) if (d >= m.dist) return m.name;
    return null;
  }
}
