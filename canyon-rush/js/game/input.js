// Keyboard, gamepad and touch controls, merged into one set of riding inputs.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0, lean: false, boost: false };
    this.look = { x: 0, y: 0, active: false };
    this.onKey = null;
    this.onPad = null;
    this.padPrev = [];
    this.usingTouch = false;
    this.usingPad = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && e.target === document.body) e.preventDefault();
      this.usingTouch = false;
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      Object.assign(this.touch, { steer: 0, throttle: 0, brake: 0, lean: false, boost: false });
    });

    // Drag on the view (mouse or a spare finger) to look around the bike.
    let dragId = null, lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (dragId !== null) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      this.look.active = true;
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      this.look.x += e.clientX - lastX;
      this.look.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const end = (e) => {
      if (e.pointerId !== dragId) return;
      dragId = null;
      this.look.active = false;
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('touchstart', () => { this.usingTouch = true; }, { passive: true });
  }

  // Hook up the on-screen touch controls (see index.html).
  bindTouch(root) {
    const hold = (el, on, off) => {
      const start = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add('on'); on(e); };
      const stop = (e) => { el.classList.remove('on'); off(e); };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('lostpointercapture', stop);
    };
    const T = this.touch;
    const q = (s) => root.querySelector(s);
    hold(q('[data-touch=left]'), () => { T.left = true; }, () => { T.left = false; });
    hold(q('[data-touch=right]'), () => { T.right = true; }, () => { T.right = false; });
    hold(q('[data-touch=gas]'), () => { T.throttle = 1; }, () => { T.throttle = 0; });
    hold(q('[data-touch=brake]'), () => { T.brake = 1; }, () => { T.brake = 0; });
    hold(q('[data-touch=lean]'), () => { T.lean = true; }, () => { T.lean = false; });
    hold(q('[data-touch=boost]'), () => { T.boost = true; }, () => { T.boost = false; });
  }

  _pad() {
    let pads = [];
    // Embedded pages (iframes) can be denied gamepad access, which throws.
    try { pads = navigator.getGamepads?.() || []; } catch { return null; }
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Current inputs: throttle/brake 0..1, steer -1..1 (right positive), lean back (wheelie), boost.
  read() {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let lean = k.has('Space');
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');
    let lookX = 0, lookY = 0;

    const T = this.touch;
    throttle = Math.max(throttle, T.throttle);
    brake = Math.max(brake, T.brake);
    if (T.left || T.right) steer = (T.right ? 1 : 0) - (T.left ? 1 : 0);
    lean ||= T.lean;
    boost ||= T.boost;

    const pad = this._pad();
    if (pad) {
      const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
      const b = (i) => pad.buttons[i] || { pressed: false, value: 0 };
      const sx = dz(pad.axes[0] || 0);
      if (Math.abs(sx) > 0) { steer = Math.sign(sx) * Math.pow(Math.abs(sx), 1.4); this.usingPad = true; }
      const rt = b(7).value, lt = b(6).value;
      if (rt > 0.02) { throttle = Math.max(throttle, rt); this.usingPad = true; }
      if (lt > 0.02) brake = Math.max(brake, lt);
      if (b(0).pressed || b(5).pressed) lean = true;
      if (b(1).pressed || b(4).pressed) boost = true;
      lookX = dz(pad.axes[2] || 0, 0.2);
      lookY = dz(pad.axes[3] || 0, 0.2);
      // Edge-triggered buttons: 3 = camera (Y), 9 = start (pause), 8 = back (reset).
      for (const i of [3, 8, 9, 12, 13]) {
        const now = b(i).pressed;
        if (now && !this.padPrev[i]) this.onPad?.(i);
        this.padPrev[i] = now;
      }
    }
    return { throttle: clamp(throttle, 0, 1), brake: clamp(brake, 0, 1), steer: clamp(steer, -1, 1), lean, boost, lookX, lookY };
  }

  consumeLook() {
    const r = { x: this.look.x, y: this.look.y, active: this.look.active };
    this.look.x = this.look.y = 0;
    return r;
  }
}
