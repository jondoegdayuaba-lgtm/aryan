// Mouse (pointer lock or cursor-offset fallback), keyboard and touch input.
export class Input {
  constructor(canvas, boostButton) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;               // accumulated look deltas (pixels)
    this.lookY = 0;
    this.touchLookX = 0;
    this.touchLookY = 0;
    this.cursor = { x: 0, y: 0 }; // -1..1 from screen centre (fallback steering)
    this.mouseDown = false;
    this.touchBoost = false;
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
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; this.touchBoost = false; });

    addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
      this.cursor.x = (e.clientX / innerWidth) * 2 - 1;
      this.cursor.y = (e.clientY / innerHeight) * 2 - 1;
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 2) this.mouseDown = true; });
    addEventListener('mouseup', () => { this.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
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

    const boostOn = (e) => { e.preventDefault(); this.touchBoost = true; boostButton.classList.add('on'); };
    const boostOff = () => { this.touchBoost = false; boostButton.classList.remove('on'); };
    boostButton.addEventListener('touchstart', boostOn, { passive: false });
    boostButton.addEventListener('touchend', boostOff);
    boostButton.addEventListener('touchcancel', boostOff);
    boostButton.addEventListener('mousedown', boostOn);
    boostButton.addEventListener('mouseup', boostOff);
    boostButton.addEventListener('mouseleave', boostOff);
  }

  get boost() {
    return this.touchBoost || this.mouseDown || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Space');
  }

  // Keyboard steering axes (-1..1).
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
