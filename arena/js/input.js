// Keyboard + mouse (pointer lock) and touch controls.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // keys pressed since last frame
    this.lookX = 0;
    this.lookY = 0;
    this.fire = false;
    this.aim = false;
    this.pointerLocked = false;
    this.lockTime = 0;
    this.touch = { moveId: null, ox: 0, oy: 0, x: 0, y: 0, lookId: null, lx: 0, ly: 0, fire: false, aim: false };
    this.onKey = null;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.pointerLocked) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.fire = this.aim = false;
    });
    addEventListener('mousemove', (e) => {
      // Ignore the bogus jump some browsers send right as the pointer locks.
      if (this.pointerLocked && performance.now() - this.lockTime > 120 &&
          Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) { this.fire = true; this.pressed.add('Mouse0'); }
      if (e.button === 2) this.aim = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    addEventListener('wheel', (e) => {
      if (this.pointerLocked) this.pressed.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
      if (!this.pointerLocked) this.fire = this.aim = false;
      this.onLockChange?.(this.pointerLocked);
    });

    this._setupTouch();
  }

  _setupTouch() {
    const tc = this.touch;
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.4 && tc.moveId === null) {
          tc.moveId = t.identifier;
          tc.ox = t.clientX; tc.oy = t.clientY; tc.x = tc.y = 0;
          stick.style.left = t.clientX + 'px';
          stick.style.top = t.clientY + 'px';
          stick.hidden = false;
        } else if (tc.lookId === null) {
          tc.lookId = t.identifier;
          tc.lx = t.clientX; tc.ly = t.clientY;
        }
      }
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === tc.moveId) {
          let dx = t.clientX - tc.ox, dy = t.clientY - tc.oy;
          const d = Math.hypot(dx, dy), max = 55;
          if (d > max) { dx *= max / d; dy *= max / d; }
          tc.x = dx / max; tc.y = dy / max;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === tc.lookId) {
          this.lookX += (t.clientX - tc.lx) * 1.6;
          this.lookY += (t.clientY - tc.ly) * 1.6;
          tc.lx = t.clientX; tc.ly = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === tc.moveId) {
          tc.moveId = null; tc.x = tc.y = 0;
          stick.hidden = true;
          knob.style.transform = '';
        }
        if (t.identifier === tc.lookId) tc.lookId = null;
      }
    };
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);

    // Buttons: hold ones set a flag, tap ones queue a key press.
    for (const btn of document.querySelectorAll('[data-touch]')) {
      const key = btn.dataset.touch;
      const hold = btn.hasAttribute('data-hold');
      const on = (e) => {
        e.preventDefault();
        btn.classList.add('on');
        if (key === 'fire') { tc.fire = true; this.pressed.add('Mouse0'); }
        else if (key === 'aim') tc.aim = !tc.aim;
        else if (hold) this.keys.add(key);
        else this.pressed.add(key);
        // Fire button also turns to look while held.
        if (key === 'fire') for (const t of e.changedTouches) { tc.fireId = t.identifier; tc.fx = t.clientX; tc.fy = t.clientY; }
      };
      const off = () => {
        btn.classList.remove('on');
        if (key === 'fire') tc.fire = false;
        else if (hold) this.keys.delete(key);
        if (key === 'aim') btn.classList.toggle('on', tc.aim);
      };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchmove', (e) => {
        if (key !== 'fire') return;
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier !== tc.fireId) continue;
          this.lookX += (t.clientX - tc.fx) * 1.6;
          this.lookY += (t.clientY - tc.fy) * 1.6;
          tc.fx = t.clientX; tc.fy = t.clientY;
        }
      }, { passive: false });
      btn.addEventListener('touchend', off);
      btn.addEventListener('touchcancel', off);
    }
  }

  get firing() { return this.fire || this.touch.fire; }
  get aiming() { return this.aim || this.touch.aim || this.keys.has('KeyE'); }

  // Movement axes: x right, y forward.
  get move() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.touch.moveId !== null) { x = this.touch.x; y = -this.touch.y; }
    return { x, y };
  }

  wasPressed(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.lookX = this.lookY = 0;
  }

  requestLock() {
    if (!this.canvas.requestPointerLock || matchMedia('(hover: none)').matches) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* not available */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
