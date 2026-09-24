// Mouse (pointer lock or cursor-offset fallback), keyboard and touch input.
export class Input {
  constructor(canvas, boostButton, floatButton) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;               // accumulated look deltas (pixels)
    this.lookY = 0;
    this.touchLookX = 0;
    this.touchLookY = 0;
    this.cursor = { x: 0, y: 0 }; // -1..1 from screen centre (fallback steering)
    this.mouseLeft = false;
    this.mouseRight = false;
    this.touchBoost = false;
    this.touchFloat = false;
    this.pointerLocked = false;
    this.usingTouch = false;
    this.steerTouch = null;
    this.onKey = null;            // (code, event) => void
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && e.target === document.body) e.preventDefault();
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseLeft = this.mouseRight = this.touchBoost = this.touchFloat = false;
    });

    addEventListener('mousemove', (e) => {
      // Browsers often send one huge bogus movement right as the pointer locks
      // (and occasionally afterwards), so ignore those jumps.
      const settled = performance.now() - this.lockTime > 150;
      if (this.pointerLocked && settled && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
      this.cursor.x = (e.clientX / innerWidth) * 2 - 1;
      this.cursor.y = (e.clientY / innerHeight) * 2 - 1;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) this.mouseRight = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.lockTime = 0;
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
      this.onLockChange?.(this.pointerLocked);
    });

    // Touch: drag anywhere on the canvas to steer.
    canvas.addEventListener('touchstart', (e) => {
      this.usingTouch = true;
      for (const t of e.changedTouches) {
        if (this.steerTouch === null) {
          this.steerTouch = t.identifier;
          this.lastTouch = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.steerTouch) {
          this.touchLookX += t.clientX - this.lastTouch.x;
          this.touchLookY += t.clientY - this.lastTouch.y;
          this.lastTouch = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.steerTouch) this.steerTouch = null;
    };
    canvas.addEventListener('touchend', endTouch);
    canvas.addEventListener('touchcancel', endTouch);

    // Hold-to-use touch buttons.
    const hold = (button, key) => {
      const on = (e) => { e.preventDefault(); this[key] = true; button.classList.add('on'); };
      const off = () => { this[key] = false; button.classList.remove('on'); };
      button.addEventListener('touchstart', on, { passive: false });
      button.addEventListener('touchend', off);
      button.addEventListener('touchcancel', off);
      button.addEventListener('mousedown', on);
      button.addEventListener('mouseup', off);
      button.addEventListener('mouseleave', off);
    };
    hold(boostButton, 'touchBoost');
    hold(floatButton, 'touchFloat');
  }

  get boost() {
    return this.touchBoost || this.mouseLeft || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Space');
  }

  // Life jacket: hold to inflate the floats and hover.
  get float() {
    return this.touchFloat || this.mouseRight || this.keys.has('KeyF') || this.keys.has('KeyE');
  }

  // Keyboard camera axes (-1..1).
  get keyAxes() {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    return { x, y };
  }

  consumeLook() {
    const r = { mx: this.lookX, my: this.lookY, tx: this.touchLookX, ty: this.touchLookY };
    this.lookX = this.lookY = this.touchLookX = this.touchLookY = 0;
    return r;
  }

  requestLock() {
    if (this.usingTouch || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable; cursor steering still works */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
