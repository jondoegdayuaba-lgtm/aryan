// Keyboard, touch and gamepad input -> {steer, tuck, brake, jump}. Steering ramps so keys feel analogue.
import { clamp, damp } from './util.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.steerKey = 0;
    this.touch = { left: false, right: false, tuck: false, brake: false, jump: false, push: false, steerAnalog: 0, active: false };
    this.pad = { steer: 0, tuck: 0, brake: 0, jump: false, push: false };
    this.pressed = new Set();      // one-shot presses since the last consume()
    this.enabled = true;
    this.captureTab = false;
    this.handlers = {};
    addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._isGame(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this._isGame(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.touch.left = this.touch.right = false; });
    this._bindTouch(canvas);
  }

  _isGame(code) {
    if (code === 'Tab') return this.captureTab;            // the open-world map key; the menu keeps normal tabbing
    return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code);
  }

  _bindTouch(canvas) {
    const set = (e, down) => {
      for (const t of e.changedTouches) {
        const x = t.clientX / innerWidth, y = t.clientY / innerHeight;
        this.touch.active = true;
        const id = t.identifier;
        if (down) {
          if (y > 0.55 && x < 0.5) this.touch.left = id;
          else if (y > 0.55 && x >= 0.5) this.touch.right = id;
        } else {
          if (this.touch.left === id) this.touch.left = false;
          if (this.touch.right === id) this.touch.right = false;
        }
      }
    };
    canvas.addEventListener('touchstart', (e) => { set(e, true); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', (e) => { set(e, false); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchcancel', (e) => { set(e, false); }, { passive: false });
  }

  /** hook up an on-screen hold button */
  bindButton(el, prop) {
    const on = (e) => { this.touch[prop] = true; this.touch.active = true; e.preventDefault(); };
    const off = (e) => { this.touch[prop] = false; e.preventDefault(); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }

  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  clearPressed() { this.pressed.clear(); }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((g) => g && g.connected);
    if (!p) { this.pad.steer = this.pad.tuck = this.pad.brake = 0; this.pad.jump = false; this.pad.push = false; return; }
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    this.pad.steer = dz(p.axes[0] || 0);
    this.pad.tuck = clamp((p.buttons[7] ? p.buttons[7].value : 0) + (p.buttons[12] && p.buttons[12].pressed ? 1 : 0), 0, 1);
    this.pad.brake = clamp((p.buttons[6] ? p.buttons[6].value : 0) + (p.buttons[13] && p.buttons[13].pressed ? 1 : 0), 0, 1);
    this.pad.jump = !!(p.buttons[0] && p.buttons[0].pressed);
    this.pad.push = !!(p.buttons[2] && p.buttons[2].pressed);
    if (p.buttons[9] && p.buttons[9].pressed) this.pressed.add('Escape');
  }

  read(dt) {
    this._pollPad();
    const k = this.keys;
    let target = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) target -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) target += 1;
    if (this.touch.left !== false) target -= 1;
    if (this.touch.right !== false) target += 1;
    // keyboard steering ramps up and snaps back quicker
    this.steerKey = target === 0 ? damp(this.steerKey, 0, 14, dt) : clamp(this.steerKey + Math.sign(target - this.steerKey) * dt * 5.5, -1, 1);
    if (target !== 0 && Math.sign(target) !== Math.sign(this.steerKey)) this.steerKey = 0;
    const steer = clamp(this.steerKey + this.pad.steer, -1, 1);
    const tuck = k.has('ArrowUp') || k.has('KeyW') || this.touch.tuck ? 1 : this.pad.tuck;
    const push = k.has('ShiftLeft') || k.has('ShiftRight') || this.touch.push || this.pad.push;
    const brake = k.has('ArrowDown') || k.has('KeyS') || this.touch.brake ? 1 : this.pad.brake;
    const jump = k.has('Space') || this.touch.jump || this.pad.jump;
    return { steer, tuck, brake, jump, push: !!push };
  }
}
