// Keyboard, mouse (with pointer lock) and touch, collected into one state the
// game polls each frame. Edge-triggered presses are read with `pressed()`.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftEdge: false, wheel: 0 };
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 1;
    this.invert = false;
    this.touch = { active: false, mx: 0, mz: 0, lookId: null, lastX: 0, lastY: 0, stickId: null };
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.edges.add(k);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(k) && this.enabled) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.isTouch) this.lock();
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftEdge = true;
      }
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      // Without pointer lock (blocked in some embeds), drag with a button held to look
      if (!this.enabled || (!this.locked && !(e.buttons && e.target === this.canvas))) return;
      // Browsers occasionally report a huge jump when the lock engages; drop it.
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', (e) => {
      if (this.enabled) this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.onUnlock) this.onUnlock();
    });
    this.setupTouch();
  }

  lock() {
    if (this.isTouch) return;
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      p?.catch?.(() => this.canvas.requestPointerLock?.());
    } catch {
      this.canvas.requestPointerLock?.();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  pressed(code) {
    return this.edges.has(code);
  }

  // Movement axes in -1..1 (x right, y forward).
  move() {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.touch.active) {
      x += this.touch.mx;
      y += this.touch.mz;
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  look() {
    const s = 0.0022 * this.sensitivity;
    const out = { x: this.mouse.dx * s, y: this.mouse.dy * s * (this.invert ? -1 : 1) };
    this.mouse.dx = this.mouse.dy = 0;
    return out;
  }

  get aim() {
    return this.mouse.right || this.down('KeyK') || this.touch.aim;
  }

  get fire() {
    return this.mouse.left || this.touch.fire;
  }

  // Call once per frame after the game has read the edges.
  endFrame() {
    this.edges.clear();
    this.mouse.leftEdge = false;
    this.mouse.wheel = 0;
    this.touch.fireEdge = false;
  }

  setupTouch() {
    const root = document.getElementById('touch');
    if (!this.isTouch || !root) return;
    root.hidden = false;
    const stick = document.getElementById('stick');
    const knob = stick.querySelector('i');
    const t = this.touch;
    const center = () => {
      const r = stick.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    };
    stick.addEventListener('touchstart', (e) => {
      t.stickId = e.changedTouches[0].identifier;
      t.active = true;
      e.preventDefault();
    }, { passive: false });
    const moveStick = (e) => {
      for (const tt of e.changedTouches) {
        if (tt.identifier === t.stickId) {
          const c = center();
          let dx = (tt.clientX - c.x) / c.r;
          let dy = (tt.clientY - c.y) / c.r;
          const l = Math.hypot(dx, dy);
          if (l > 1) { dx /= l; dy /= l; }
          t.mx = dx;
          t.mz = -dy;
          knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        } else if (tt.identifier === t.lookId) {
          this.mouse.dx += (tt.clientX - t.lastX) * 1.6;
          this.mouse.dy += (tt.clientY - t.lastY) * 1.6;
          t.lastX = tt.clientX;
          t.lastY = tt.clientY;
        }
      }
    };
    addEventListener('touchmove', moveStick, { passive: true });
    const end = (e) => {
      for (const tt of e.changedTouches) {
        if (tt.identifier === t.stickId) {
          t.stickId = null;
          t.mx = t.mz = 0;
          knob.style.transform = '';
        }
        if (tt.identifier === t.lookId) t.lookId = null;
      }
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
    this.canvas.addEventListener('touchstart', (e) => {
      const tt = e.changedTouches[0];
      if (t.lookId == null) {
        t.lookId = tt.identifier;
        t.lastX = tt.clientX;
        t.lastY = tt.clientY;
      }
    }, { passive: true });
    const hold = (id, prop, edge) => {
      const b = document.getElementById(id);
      b.addEventListener('touchstart', (e) => {
        t[prop] = true;
        if (edge) this.edges.add(edge);
        if (prop === 'fire') this.mouse.leftEdge = true;
        e.preventDefault();
      }, { passive: false });
      b.addEventListener('touchend', () => { t[prop] = false; });
    };
    hold('t-fire', 'fire');
    hold('t-aim', 'aim');
    hold('t-act', 'act', 'KeyE');
    hold('t-pause', 'pause', 'Escape');
    const sprint = document.getElementById('t-sprint');
    sprint.addEventListener('touchstart', (e) => {
      this.keys.add('ShiftLeft');
      e.preventDefault();
    }, { passive: false });
    sprint.addEventListener('touchend', () => this.keys.delete('ShiftLeft'));
  }
}
