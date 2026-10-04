// Mouse look (pointer lock), keyboard, touch (left-thumb joystick, right-side
// drag to look, buttons) and gamepad.
export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.mouseLeft = false;
    this.mouseRight = false;
    this.pointerLocked = false;
    this.usingTouch = false;
    this.stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.lookTouch = null;
    this.held = {};               // touch buttons currently held
    this.taps = new Set();        // presses since the game last looked (so quick taps aren't missed)
    this.onKey = null;            // (code, event) => void
    this.onLockChange = null;
    this.lockTime = 0;
    this.pad = null;

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && e.target === document.body) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.taps.add(e.code);
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseLeft = this.mouseRight = false;
      this.held = {};
    });
    addEventListener('mousemove', (e) => {
      const settled = performance.now() - this.lockTime > 150;
      if (this.pointerLocked && settled && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) { this.mouseRight = true; this.onKey?.('MouseRight', e); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
      this.onLockChange?.(this.pointerLocked);
    });

    // Touch: the left third of the screen is a floating joystick, the rest looks around.
    canvas.addEventListener('touchstart', (e) => {
      this.usingTouch = true;
      document.body.classList.add('touch');
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.38 && this.stick.id === null) {
          Object.assign(this.stick, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
          ui.stick?.(true, t.clientX, t.clientY, 0, 0);
        } else if (this.lookTouch === null) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          const dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
          const r = 55, len = Math.hypot(dx, dy), k = len > r ? r / len : 1;
          this.stick.x = (dx * k) / r;
          this.stick.y = (dy * k) / r;
          ui.stick?.(true, this.stick.ox, this.stick.oy, dx * k, dy * k);
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          this.lookX += (t.clientX - this.lookTouch.x) * 2.2;
          this.lookY += (t.clientY - this.lookTouch.y) * 2.2;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          Object.assign(this.stick, { id: null, x: 0, y: 0 });
          ui.stick?.(false);
        }
        if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);

    // On-screen buttons: data-hold buttons are held, data-tap buttons fire once.
    for (const b of document.querySelectorAll('[data-hold]')) {
      const key = b.dataset.hold;
      const on = (e) => { e.preventDefault(); this.held[key] = true; this.taps.add(`Touch${key}`); b.classList.add('on'); this.onKey?.(`Touch${key}`, e); };
      const off = () => { this.held[key] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off);
      b.addEventListener('touchcancel', off);
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    }
    addEventListener('gamepadconnected', () => document.body.classList.add('pad'));
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((g) => g && g.connected);
    if (!p) { this.pad = null; return; }
    const prev = this.pad?.buttons || [];
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const btn = p.buttons.map((b) => b.pressed);
    this.pad = { lx: dz(p.axes[0]), ly: dz(p.axes[1]), rx: dz(p.axes[2] || 0), ry: dz(p.axes[3] || 0),
      lt: p.buttons[6]?.value || 0, rt: p.buttons[7]?.value || 0, buttons: btn };
    const pressed = (i) => btn[i] && !prev[i];
    if (pressed(0)) { this.taps.add('PadA'); this.onKey?.('PadA'); }
    if (pressed(1)) this.onKey?.('PadB');
    if (pressed(2)) this.onKey?.('PadX');
    if (pressed(3)) this.onKey?.('PadY');
    if (pressed(9)) this.onKey?.('PadStart');
  }

  // Movement intent: x strafe, y up/down, z forward (all -1..1).
  get move() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let y = (k.has('Space') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight') ? 1 : 0);
    x += this.stick.x;
    z -= this.stick.y;
    y += (this.held.Up ? 1 : 0) - (this.held.Down ? 1 : 0);
    if (this.pad) {
      x += this.pad.lx;
      z -= this.pad.ly;
      y += this.pad.rt - this.pad.lt;
    }
    const c = (v) => Math.max(-1, Math.min(1, v));
    return { x: c(x), y: c(y), z: c(z) };
  }

  get boost() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.mouseLeft || !!this.held.Boost || !!this.pad?.buttons[5];
  }

  get grab() {
    return this.keys.has('KeyE') || !!this.held.Grab || !!this.pad?.buttons[0];
  }

  // True once per press of the grab control, even if it was released before this frame.
  takeGrabTap() {
    const hit = this.taps.has('KeyE') || this.taps.has('TouchGrab') || this.taps.has('PadA');
    this.taps.clear();
    return hit;
  }

  consumeLook(dt) {
    let x = this.lookX, y = this.lookY;
    this.lookX = this.lookY = 0;
    if (this.pad) {
      x += this.pad.rx * 900 * dt;
      y += this.pad.ry * 700 * dt;
    }
    return { x, y };
  }

  requestLock() {
    if (this.usingTouch || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
