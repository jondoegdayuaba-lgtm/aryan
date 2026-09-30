// The open world game mode: free roaming physics session, rideable chairlifts, collectible flags, landmarks to discover
// and the bookkeeping the HUD and the map need.  The renderer side (terrain, forest, buildings, lifts) lives in
// open-props.js and the shared world classes; this file is pure game logic on top of them.
import * as THREE from 'three';
import { SkierPhysics } from './physics.js';
import { clamp, smoothstep } from './util.js';

const STEP = 1 / 120;
const CRASH_TIME = 1.9;
const FLAG_RADIUS = 4.2;
const BOARD_DIST = 7.0;             // metres into the up line where the chair is boarded
const SEAT_TO_SOLES = 0.66;         // the skis hang this far below the seat
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** fixed 120 Hz physics of a free roaming skier (same interface the game uses for a race session) */
export class OpenSession {
  constructor(world) {
    this.world = world;
    this.skier = new SkierPhysics(world);
    this.skier.tune = { drag: 1, mu: 1, grip: 1 };
    this.acc = 0;
    this.alpha = 0;
    this.events = [];
    this.coasting = 0;
    // what the race HUD code reads; a free ride never starts, finishes or penalises
    this.course = { state: 'running', clock: 999, time: 0, passed: 0, gates: [], progress: 0, slalom: false, crashes: 0, splits: [], penalty: 0, run: { mode: 'free' } };
    this.lastSafe = null;
    this._safeTimer = 0;
  }

  update(dt, control) {
    const out = this.events;
    out.length = 0;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this._step(STEP, control, out);
    }
    this.alpha = this.acc / STEP;
    return out;
  }

  _step(h, control, out) {
    const sk = this.skier;
    sk.step(h, control(sk));
    for (const e of sk.events) out.push(e);
    if (sk.crashed) {
      if (sk.crashTimer > CRASH_TIME) this.respawn(out);
      return;
    }
    // remember where the skier last stood safely: upright, slow, on gentle ground
    this._safeTimer += h;
    if (this._safeTimer > 0.6 && sk.grounded && sk.ny > 0.9 && sk.speed < 20) {
      this._safeTimer = 0;
      this.lastSafe = { x: sk.x, z: sk.z, yaw: sk.yaw };
    }
  }

  respawn(out = this.events, pose = this.lastSafe) {
    const sk = this.skier;
    const p = pose || this.world.info.spawn;
    sk.reset(p.x, p.z, p.yaw || 0, 0);
    out.push({ type: 'respawn' });
  }
}

/** everything that happens in the open world besides the physics */
export class OpenMode {
  constructor(game, bundle) {
    this.game = game;
    this.bundle = bundle;
    this.world = bundle.world;
    this.props = bundle.props;
    const info = this.world.info;
    this.flags = info.flags || [];
    this.landmarks = info.landmarks || [];
    this.lifts = this.props.lifts;
    const d = game.save.data.open || (game.save.data.open = { flags: [], found: [], km: 0, top: 0 });
    this.data = d;
    this.taken = new Set(d.flags || []);
    this.found = new Set(d.found || []);
    this.session = new OpenSession(this.world);
    this.ride = null;
    this.prompt = null;
    this._t = 0;
    this._lastDistance = 0;
    this._sinceSave = 0;
    this._edgeCool = 0;
    this.nearest = null;
  }

  get skier() { return this.session.skier; }

  begin() {
    const p = this.data.pose || this.world.info.spawn;
    const sk = this.skier;
    sk.reset(p.x, p.z, p.yaw || 0, 0);
    sk.distance = 0;
    sk.maxSpeed = 0;
    sk.maxAir = 0;
    this._lastDistance = 0;
    this.session.lastSafe = { x: p.x, z: p.z, yaw: p.yaw || 0 };
    this.ride = null;
    this.props.setCollected(this.taken);
  }

  // ---------------------------------------------------------------------------- frame
  /** advance the game one frame; returns the physics events */
  step(dt, inp) {
    const sk = this.skier;
    let events = [];
    if (this.ride) this._stepRide(dt, inp);
    else {
      events = this.session.update(dt, () => inp);
      for (const e of events) {
        if (e.type === 'edge' && this._edgeCool <= 0) { this.game.ui.toast('The edge of the map', 'info'); this._edgeCool = 4; }
      }
    }
    this._edgeCool -= dt;
    this._t += dt;
    if (this._t > 0.1) {
      this._t = 0;
      this._proximity(sk);
    }
    this._sinceSave += dt;
    if (this._sinceSave > 8) this.persist();
    return events;
  }

  persist() {
    const d = this.data, sk = this.skier;
    this._sinceSave = 0;
    d.flags = [...this.taken];
    d.found = [...this.found];
    d.km = (d.km || 0) + (sk.distance - this._lastDistance) / 1000;
    this._lastDistance = sk.distance;
    d.top = Math.max(d.top || 0, sk.maxSpeed);
    if (!this.ride && !sk.crashed) d.pose = { x: sk.x, z: sk.z, yaw: sk.yaw };
    this.game.save.save();
  }

  // ------------------------------------------------------------------------ flags and places
  _proximity(sk) {
    const g = this.game;
    if (this.ride && this.ride.phase !== 'wait') { this.prompt = null; return; }
    // flags
    for (let i = 0; i < this.flags.length; i++) {
      if (this.taken.has(i)) continue;
      const f = this.flags[i];
      const dx = f.x - sk.x, dz = f.z - sk.z;
      if (dx * dx + dz * dz < FLAG_RADIUS * FLAG_RADIUS && Math.abs(f.y - sk.y) < 5) {
        this.taken.add(i);
        this.props.hideFlag(i);
        g.audio.gate(true, 0);
        g._burst(sk, 40);
        g.ui.toast(`Flag ${this.taken.size} / ${this.flags.length}`, 'good');
        if (this.taken.size === this.flags.length) g.ui.toast('All flags collected!', 'good');
        this.persist();
      }
    }
    // places
    for (const lm of this.landmarks) {
      if (this.found.has(lm.id)) continue;
      const dx = lm.x - sk.x, dz = lm.z - sk.z;
      if (dx * dx + dz * dz < lm.radius * lm.radius) {
        this.found.add(lm.id);
        g.audio.split();
        g.ui.discover(lm.name, lm.text, this.found.size, this.landmarks.length);
        this.persist();
      }
    }
    // the closest chairlift base, and the closest flag for the compass
    this.prompt = null;
    if (!this.ride) {
      for (const lift of this.lifts) {
        lift.boardingSpot(_v, BOARD_DIST);
        const dx = _v.x - sk.x, dz = _v.z - sk.z;
        if (dx * dx + dz * dz < 24 * 24 && Math.abs(_v.y - sk.y) < 10 && sk.speed < 10 && !sk.crashed) {
          this.prompt = { text: `Ride the ${lift.name}`, lift, kind: 'lift' };
          break;
        }
      }
    } else if (this.ride.phase === 'wait') {
      this.prompt = { text: 'Waiting for a chair...  (E to cancel)', kind: 'wait' };
    }
    let best = null, bd = 1e12;
    for (let i = 0; i < this.flags.length; i++) {
      if (this.taken.has(i)) continue;
      const f = this.flags[i];
      const d2 = (f.x - sk.x) ** 2 + (f.z - sk.z) ** 2;
      if (d2 < bd) { bd = d2; best = f; }
    }
    this.nearest = best ? { x: best.x, z: best.z, dist: Math.sqrt(bd) } : null;
  }

  /** E pressed: board a lift in reach, or cancel a wait */
  interact() {
    if (this.ride) {
      if (this.ride.phase === 'wait') { this.ride = null; this.prompt = null; }
      return;
    }
    if (this.prompt && this.prompt.kind === 'lift') this.startRide(this.prompt.lift);
  }

  // ------------------------------------------------------------------------------ chairlift
  startRide(lift) {
    const sk = this.skier;
    lift.boardingSpot(_v, BOARD_DIST);
    const yaw = Math.atan2(lift.base.dx, -lift.base.dz);
    sk.reset(_v.x, _v.z, yaw, 0);
    sk.seated = 0;
    const { c } = lift.nextChair(BOARD_DIST, 14);
    this.ride = { lift, phase: 'wait', chair: c, t: 0, from: new THREE.Vector3(_v.x, _v.y, _v.z), to: new THREE.Vector3(), yaw };
    this.game.tracks.breakTrack();
    this.game.cameraRig._init = true;
    this.game.ui.toast(`${lift.name}: hold Shift to speed up`, 'info');
  }

  _stepRide(dt, inp) {
    const R = this.ride, lift = R.lift, sk = this.skier, sess = this.session;
    sk.savePrev();
    sess.alpha = 1;
    sk.crashed = false;
    lift.speedMul = R.phase === 'ride' && inp && inp.push ? 2.5 : 1;
    const c = R.chair;
    const speed = lift.speed * lift.speedMul;
    if (R.phase === 'wait') {
      sk.speed = 0; sk.vx = sk.vy = sk.vz = 0; sk.grounded = true;
      if (inp && (Math.abs(inp.steer) > 0.5 || inp.brake > 0.5)) { this.ride = null; return; }
      let ahead = BOARD_DIST - lift.u[c];
      if (ahead < 0) ahead += lift.total;
      if (ahead < speed * 0.85 || ahead > lift.total * 0.5) { R.phase = 'hop'; R.t = 0; }
    } else if (R.phase === 'hop') {
      R.t += dt / 0.85;
      const e = smoothstep(0, 1, R.t);
      lift.seatPosition(c, _v);
      _v.y -= SEAT_TO_SOLES;
      sk.x = R.from.x + (_v.x - R.from.x) * e;
      sk.z = R.from.z + (_v.z - R.from.z) * e;
      sk.y = R.from.y + (_v.y - R.from.y) * e + 0.5 * Math.sin(Math.PI * e);
      sk.yaw = R.yaw;
      sk.seated = e;
      sk.grounded = false;
      this._ridePose(sk, lift, c, speed);
      if (R.t >= 1) { R.phase = 'ride'; this.game.ui.toast('Enjoy the ride', 'info'); }
    } else if (R.phase === 'ride') {
      lift.seatPosition(c, _v);
      sk.x = _v.x; sk.y = _v.y - SEAT_TO_SOLES; sk.z = _v.z;
      sk.yaw = lift.chairYaw(c);
      sk.seated = 1;
      sk.grounded = false;
      this._ridePose(sk, lift, c, speed);
      if (lift.u[c] >= lift.upEndDist - 2.5 && lift.u[c] < lift.upEndDist + 40) {
        R.phase = 'unload'; R.t = 0;
        R.from.set(sk.x, sk.y, sk.z);
        const sm = lift.summit;
        const ex = sm.x + sm.dx * 12 + sm.dz * 1.5, ez = sm.z + sm.dz * 12 - sm.dx * 1.5;
        R.to.set(ex, this.world.height(ex, ez), ez);
        R.yaw = Math.atan2(sm.dx, -sm.dz);
      }
    } else if (R.phase === 'unload') {
      R.t += dt / 0.8;
      const e = smoothstep(0, 1, R.t);
      sk.x = R.from.x + (R.to.x - R.from.x) * e;
      sk.z = R.from.z + (R.to.z - R.from.z) * e;
      sk.y = R.from.y + (R.to.y - R.from.y) * e + 0.35 * Math.sin(Math.PI * e);
      sk.seated = 1 - e;
      sk.grounded = false;
      if (R.t >= 1) {
        lift.speedMul = 1;
        sk.seated = 0;
        sk.reset(R.to.x, R.to.z, R.yaw, 3.5);
        this.ride = null;
        this.game.tracks.breakTrack();
        this.game.ui.toast(`${Math.round(sk.y)} m`, 'info');
        this.game.rig._first = true;
        sess.lastSafe = { x: R.to.x, z: R.to.z, yaw: R.yaw };
      }
    }
  }

  /** fill in the fields the camera, rig and audio read while the skier is carried */
  _ridePose(sk, lift, c, speed) {
    const yaw = sk.yaw;
    sk.vx = Math.sin(yaw) * speed * 0.9; sk.vz = -Math.cos(yaw) * speed * 0.9; sk.vy = 0;
    sk.speed = 0;                                       // no wind or ski noise on the chair
    sk.nx = 0; sk.ny = 1; sk.nz = 0;
    sk.tuck = 0; sk.brake = 0; sk.steer = 0; sk.lean = 0; sk.slip = 0; sk.skidAmount = 0; sk.compress = 0;
  }

  // ------------------------------------------------------------------------------- misc
  respawn() {
    if (this.ride) return;
    const out = [];
    this.session.respawn(out);
    this.game.tracks.breakTrack();
    this.game.rig._first = true;
    this.game.cameraRig._init = true;
    this.game.ui.toast('Back on your feet', 'info');
  }

  teleport(x, z, yaw = 0) {
    this.ride = null;
    const sk = this.skier;
    sk.reset(x, z, yaw, 0);
    this.session.lastSafe = { x, z, yaw };
    this.game.tracks.breakTrack();
    this.game.rig._first = true;
    this.game.cameraRig._init = true;
  }

  get progress() {
    return { flags: this.taken.size, flagTotal: this.flags.length, found: this.found.size, foundTotal: this.landmarks.length };
  }
}
