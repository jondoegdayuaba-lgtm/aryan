// Keyboard, on-screen touch pedals and gamepads, all mapped to one set of controls.
const DEAD = 0.14;

export class Input {
  constructor(pad) {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.usingTouch = false;
    this.onKey = null;            // (code, event) => void
    this.padPrev = [];

    addEventListener('keydown', (e) => {
      if (e.repeat || e.target.closest?.('input, textarea, select')) return;   // typing a track name
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code) && e.target === document.body) e.preventDefault();
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      for (const k in this.touch) this.touch[k] = false;
      pad.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
    });

    // On-screen pedals: hold to use. Pointer capture keeps a finger that slides
    // off the button from leaving it stuck down.
    for (const button of pad.querySelectorAll('[data-control]')) {
      const key = button.dataset.control;
      const on = (e) => {
        e.preventDefault();
        this.usingTouch = true;
        button.setPointerCapture?.(e.pointerId);
        this.touch[key] = true;
        button.classList.add('on');
      };
      const off = () => {
        this.touch[key] = false;
        button.classList.remove('on');
      };
      button.addEventListener('pointerdown', on);
      button.addEventListener('pointerup', off);
      button.addEventListener('pointercancel', off);
      button.addEventListener('lostpointercapture', off);
      button.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    addEventListener('touchstart', () => { this.usingTouch = true; }, { passive: true });
  }

  gamepad() {
    try {
      for (const p of navigator.getGamepads?.() || []) if (p && p.connected) return p;
    } catch { /* gamepads blocked, e.g. inside an iframe without permission */ }
    return null;
  }

  // Fills ctl with throttle/brake 0..1, steer -1..1 (right positive) and handbrake.
  read(ctl) {
    const k = this.keys, t = this.touch;
    let gas = k.has('KeyW') || k.has('ArrowUp') || t.gas ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') || t.brake ? 1 : 0;
    let steer = (k.has('KeyD') || k.has('ArrowRight') || t.right ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') || t.left ? 1 : 0);
    let hand = k.has('Space');

    const p = this.gamepad();
    if (p) {
      const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      gas = Math.max(gas, b(7), b(0));
      brake = Math.max(brake, b(6), b(2));
      hand = hand || b(1) > 0.5;
      const x = p.axes[0] || 0;
      if (Math.abs(x) > DEAD) steer = Math.sign(x) * (Math.abs(x) - DEAD) / (1 - DEAD);
      if (b(14) > 0.5) steer = -1;
      if (b(15) > 0.5) steer = 1;
      // Buttons that act once per press.
      [[3, 'PadY'], [9, 'PadStart'], [8, 'PadBack'], [12, 'PadUp'], [13, 'PadDown'], [5, 'PadRB']].forEach(([i, code]) => {
        const down = b(i) > 0.5;
        if (down && !this.padPrev[i]) this.onKey?.(code, null);
        this.padPrev[i] = down;
      });
    }
    ctl.throttle = gas;
    ctl.brake = brake;
    ctl.steer = Math.max(-1, Math.min(1, steer));
    ctl.handbrake = hand;
    return ctl;
  }
}
