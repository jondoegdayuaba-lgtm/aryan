// Keyboard, gamepad and touch input -> one { throttle, brake, steer, handbrake, boost } state.
// steer: +1 = left, -1 = right (matches yaw direction in three.js).

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, boost: false, brake: false, drift: false, look: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lookBack: false };
    this.onPause = () => {};
    this.onMute = () => {};
    this.onRestart = () => {};
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
      if (e.code === 'KeyM') this.onMute();
      if (e.code === 'KeyR') this.onRestart();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });

    // on-screen buttons (created in index.html)
    for (const el of document.querySelectorAll('[data-touch]')) {
      const k = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[k] = true; el.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.touch[k] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** Read the current frame's state. Touch users get automatic throttle. */
  poll() {
    const k = this.keys, t = this.touch, s = this.state;
    const down = (...c) => c.some((x) => k.has(x));
    let throttle = down('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = down('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (down('KeyA', 'ArrowLeft') ? 1 : 0) - (down('KeyD', 'ArrowRight') ? 1 : 0);
    let handbrake = down('Space');
    let boost = down('ShiftLeft', 'ShiftRight');

    const gp = (navigator.getGamepads && navigator.getGamepads()[0]) || null;
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = -ax;
      throttle = Math.max(throttle, gp.buttons[7]?.value || 0);
      brake = Math.max(brake, gp.buttons[6]?.value || 0);
      handbrake = handbrake || !!gp.buttons[2]?.pressed || !!gp.buttons[1]?.pressed;
      boost = boost || !!gp.buttons[0]?.pressed || !!gp.buttons[5]?.pressed;
    }
    if (this.isTouch || t.left || t.right || t.boost || t.brake || t.drift) {
      if (t.left) steer = 1;
      if (t.right) steer = -1;
      if (this.isTouch) throttle = Math.max(throttle, t.brake ? 0 : 1);
      if (t.brake) brake = 1;
      if (t.boost) boost = true;
      if (t.drift) handbrake = true;
    }
    s.lookBack = down('KeyC', 'KeyQ') || !!gp?.buttons[3]?.pressed || t.look;
    s.throttle = throttle; s.brake = brake; s.steer = steer; s.handbrake = handbrake; s.boost = boost;
    return s;
  }
}
