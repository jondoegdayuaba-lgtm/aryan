// Keyboard, mouse (pointer lock) and touch input, reduced to what the game asks for.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.pointerLocked = false;
    this.usingTouch = false;
    this.lockTime = 0;
    this.onKey = null;              // (code, event) => void, fired once per press
    this.onLockChange = null;
    this.onClick = null;            // primary click while playing
    this.touch = { moveX: 0, moveY: 0, sprint: false, crouch: false, jump: false, use: false };
    this.stick = null;              // { id, x0, y0 }
    this.lookTouch = null;          // { id, x, y }
    this.enabled = false;           // set true while the game is being played

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.onKey?.(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touch.sprint = this.touch.crouch = this.touch.jump = false; });

    addEventListener('mousemove', (e) => {
      // Browsers can send one huge bogus movement as the pointer locks; ignore those jumps.
      const settled = performance.now() - this.lockTime > 150;
      if (this.pointerLocked && settled && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0 && this.pointerLocked) this.onClick?.(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
      this.onLockChange?.(this.pointerLocked);
    });

    // Touch: left half of the screen is a movement stick, right half turns the view.
    canvas.addEventListener('touchstart', (e) => {
      this.usingTouch = true;
      document.body.classList.add('touch');
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && !this.stick) this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        else if (!this.lookTouch) this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) {
          const dx = (t.clientX - this.stick.x0) / 60, dy = (t.clientY - this.stick.y0) / 60;
          const l = Math.hypot(dx, dy) || 1, k = Math.min(1, l) / l;
          this.touch.moveX = dx * k;
          this.touch.moveY = -dy * k;
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          this.lookX += (t.clientX - this.lookTouch.x) * 1.6;
          this.lookY += (t.clientY - this.lookTouch.y) * 1.6;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) { this.stick = null; this.touch.moveX = this.touch.moveY = 0; }
        if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  has(...codes) { return codes.some((c) => this.keys.has(c)); }

  get moveX() {
    const k = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    return k || this.touch.moveX;
  }
  get moveY() {
    const k = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    return k || this.touch.moveY;
  }
  get sprint() { return this.has('ShiftLeft', 'ShiftRight') || this.touch.sprint; }
  get crouch() { return this.has('KeyC', 'ControlLeft') || this.touch.crouch; }
  get jump() { return this.has('Space') || this.touch.jump; }

  consumeLook() {
    const r = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return r;
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
