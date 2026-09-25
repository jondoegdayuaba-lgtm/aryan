// Replays. The physics is deterministic, so a run is stored as the inputs
// fed to the car each frame (plus any resets) and played back by feeding
// them to the car again: dust, skids, sounds and crashes all come back
// exactly as they happened, from a fraction of the memory a state recording
// would take.

const MAX_FRAMES = 60 * 60 * 30;   // half an hour at 60 fps

export class Tape {
  constructor() { this.clear(); }

  clear() {
    this.dt = []; this.steer = []; this.throttle = []; this.brake = []; this.handbrake = [];
    this.assist = []; this.bits = [];
    this.pre = new Map();      // frame -> reset applied before the car moves
    this.post = new Map();     // frame -> reset applied after it moved
    this.start = null;         // the reset the run began from
    this.go = 0;               // frame the clock started on
    this.recording = false;
    this.open = false;         // a frame was recorded during the current update
  }

  get length() { return this.dt.length; }

  begin(reset) {
    this.clear();
    this.start = reset;
    this.recording = true;
  }

  markGo() { this.go = this.dt.length; }

  // Called before the car's physics step with exactly what it is given.
  frame(dt, inp) {
    if (!this.recording) return;
    if (this.dt.length >= MAX_FRAMES) { this.recording = false; return; }
    this.dt.push(dt);
    this.steer.push(inp.steer || 0);
    this.throttle.push(inp.throttle || 0);
    this.brake.push(inp.brake || 0);
    this.handbrake.push(inp.handbrake || 0);
    this.assist.push(inp.assist || 0);
    this.bits.push((inp.analog ? 1 : 0) | (inp.auto !== false ? 2 : 0) | (inp.shiftUp ? 4 : 0) | (inp.shiftDown ? 8 : 0) | (inp.hold ? 16 : 0));
    this.open = true;
  }

  // The car was put back on the road. Before this update's step or after it?
  reset(args) {
    if (!this.recording) return;
    if (this.open) this.post.set(this.dt.length - 1, args);
    else this.pre.set(this.dt.length, args);
  }

  input(k, out) {
    const b = this.bits[k];
    out.steer = this.steer[k];
    out.throttle = this.throttle[k];
    out.brake = this.brake[k];
    out.handbrake = this.handbrake[k];
    out.assist = this.assist[k];
    out.analog = !!(b & 1);
    out.auto = !!(b & 2);
    out.shiftUp = !!(b & 4);
    out.shiftDown = !!(b & 8);
    out.hold = !!(b & 16);
    return out;
  }

  // Seconds of recorded time from the start signal to frame k.
  timeAt(k) {
    let t = 0;
    for (let i = this.go; i < k; i++) t += this.dt[i];
    return t;
  }
}
