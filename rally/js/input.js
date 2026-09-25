// Keyboard, gamepad and touch, merged into one set of driving controls.
// steer is -1..1 with + meaning LEFT, pedals are 0..1.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Keys are on or off, so the game shapes them into smooth inputs. Steering
// ramps in (more gently at speed, so a tap is a small correction), springs
// back when released and swings across quickly to catch a slide. Pedals
// squeeze on over a fraction of a second rather than slamming.
export function keySteer(current, want, dt, speed = 0) {
  const calm = 1 / (1 + Math.max(0, speed - 8) / 18);
  let rate;
  if (want === 0) rate = Math.max(3.5, 7 * calm);
  else if (current !== 0 && Math.sign(want) !== Math.sign(current)) rate = Math.max(4.5, 9 * calm);
  else rate = 4.5 * calm;
  return current + clamp(want - current, -rate * dt, rate * dt);
}

export function keyPedal(current, want, dt, up = 5, down = 10) {
  const rate = want > current ? up : down;
  return current + clamp(want - current, -rate * dt, rate * dt);
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();         // edge-triggered actions this frame
    this.onKey = null;
    this.touch = { left: false, right: false, gas: false, brake: false, hand: false };
    this.tilt = null;                 // steering from device tilt, -1..1
    this.useTilt = false;
    this.steerKey = 0;
    this.gasKey = 0;
    this.brakeKey = 0;
    this.usingPad = false;
    this.usingTouch = false;
    this.padSteer = 0;
    this._padPrev = [];

    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && (e.target === document.body || e.target.tagName === 'CANVAS')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.usingPad = false;
      const act = KEY_ACTIONS[e.code];
      if (act) this.pressed.add(act);
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null) return;
      // landscape: beta is the steering axis; portrait: gamma
      const landscape = Math.abs(window.orientation || screen.orientation?.angle || 0) === 90;
      const a = landscape ? e.beta * Math.sign(window.orientation || screen.orientation?.angle || 1) : e.gamma;
      this.tilt = clamp(-a / 28, -1, 1);
    });
  }

  // Wire up on-screen touch controls: each element holds a control while touched.
  bindTouch(map) {
    for (const [name, el] of Object.entries(map)) {
      if (!el) continue;
      const on = (e) => { e.preventDefault(); this.usingTouch = true; this.touch[name] = true; el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.touch[name] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    }
  }

  // Tap-once buttons (camera, recover, pause...).
  bindAction(el, action) {
    el?.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pressed.add(action); });
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const x = p.axes[0] || 0;
      const dz = Math.max(0, Math.abs(x) - 0.08) / 0.92;
      const steer = -Math.sign(x) * dz * (0.35 + 0.65 * dz);
      const gas = b(7);
      const brake = b(6);
      const any = Math.abs(steer) > 0.05 || gas > 0.05 || brake > 0.05 || p.buttons.some((bt) => bt.pressed);
      if (any) this.usingPad = true;
      // edge-triggered buttons
      const edges = { 3: 'camera', 1: 'recover', 9: 'pause', 5: 'shiftUp', 4: 'shiftDown', 2: 'lights', 8: 'restart' };
      p.buttons.forEach((bt, i) => {
        if (bt.pressed && !this._padPrev[i] && edges[i]) this.pressed.add(edges[i]);
        this._padPrev[i] = bt.pressed;
      });
      return { steer, gas, brake, hand: b(0) > 0.5 ? 1 : 0 };
    }
    return null;
  }

  // Shake the gamepad (hits and landings), if it can.
  rumble(strong, weak, ms) {
    if (!this.usingPad || !navigator.getGamepads) return;
    for (const p of navigator.getGamepads()) {
      const a = p && p.vibrationActuator;
      if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    }
  }

  // Poll once per frame. `speed` (m/s) shapes the keyboard steering.
  read(dt, speed = 0) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA') || this.touch.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || this.touch.right;
    const want = (left ? 1 : 0) - (right ? 1 : 0);
    this.steerKey = keySteer(this.steerKey, want, dt, speed);
    let steer = this.steerKey;
    this.gasKey = keyPedal(this.gasKey, (k.has('ArrowUp') || k.has('KeyW') || this.touch.gas) ? 1 : 0, dt);
    this.brakeKey = keyPedal(this.brakeKey, (k.has('ArrowDown') || k.has('KeyS') || this.touch.brake) ? 1 : 0, dt, 7, 10);
    let throttle = this.gasKey;
    let brake = this.brakeKey;
    let hand = (k.has('Space') || this.touch.hand) ? 1 : 0;
    let analog = false;
    const pad = this._pad();
    if (pad && this.usingPad) {
      if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
      throttle = Math.max(throttle, pad.gas);
      brake = Math.max(brake, pad.brake);
      hand = Math.max(hand, pad.hand);
      analog = true;
    }
    if (this.useTilt && this.tilt !== null && this.usingTouch) {
      steer = this.tilt;
      analog = true;
    }
    const actions = this.pressed;
    this.pressed = new Set();
    return { steer, throttle, brake, handbrake: hand, analog, actions };
  }
}

const KEY_ACTIONS = {
  KeyC: 'camera', KeyV: 'camera',
  KeyR: 'recover', Backspace: 'recover',
  Escape: 'pause', KeyP: 'pause',
  KeyE: 'shiftUp', ShiftRight: 'shiftUp',
  KeyQ: 'shiftDown', ControlRight: 'shiftDown',
  KeyL: 'lights', KeyM: 'mute', KeyG: 'ghost', KeyT: 'restart', KeyF: 'fullscreen',
};
