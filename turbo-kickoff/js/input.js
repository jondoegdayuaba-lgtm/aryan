// Keyboard and gamepad input, merged into one set of controls.

const keys = new Set();
const pressed = new Set();

addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const down = (...codes) => codes.some((c) => keys.has(c));
const hit = (...codes) => codes.some((c) => pressed.has(c));

let padPrev = [];
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

// Controls for the player's car this frame. "Pressed" flags are true for one frame.
export function readControls() {
  const c = {
    throttle: 0, steer: 0, pitch: 0, roll: 0,
    jump: false, jumpPressed: false, boost: false, slide: false,
    ballCamPressed: false, pausePressed: false, resetPressed: false, boostTogglePressed: false, mutePressed: false,
  };
  const fwd = down('KeyW', 'ArrowUp'), back = down('KeyS', 'ArrowDown');
  const left = down('KeyA', 'ArrowLeft'), right = down('KeyD', 'ArrowRight');
  c.throttle = (fwd ? 1 : 0) - (back ? 1 : 0);
  c.steer = (right ? 1 : 0) - (left ? 1 : 0);
  c.pitch = c.throttle;
  c.roll = (down('KeyE') ? 1 : 0) - (down('KeyQ') ? 1 : 0);
  c.jump = down('Space');
  c.jumpPressed = hit('Space');
  c.boost = down('ShiftLeft', 'ShiftRight');
  c.slide = down('KeyX');
  c.ballCamPressed = hit('KeyC');
  c.pausePressed = hit('Escape', 'KeyP');
  c.resetPressed = hit('KeyR');
  c.boostTogglePressed = hit('KeyB');
  c.mutePressed = hit('KeyM');

  const pad = readPad();
  if (pad) {
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const was = (i) => !!padPrev[i];
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0);
    const rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0;
    if (Math.abs(lx) > Math.abs(c.steer)) c.steer = lx;
    if (rt || lt) c.throttle = rt - lt;
    if (ly) c.pitch = -ly;
    else if (rt || lt) c.pitch = 0;
    if (b(4) || b(5)) c.roll = (b(5) ? 1 : 0) - (b(4) ? 1 : 0);
    c.jump = c.jump || b(0);
    c.jumpPressed = c.jumpPressed || (b(0) && !was(0));
    c.boost = c.boost || b(1);
    c.slide = c.slide || b(2);
    c.ballCamPressed = c.ballCamPressed || (b(3) && !was(3));
    c.pausePressed = c.pausePressed || (b(9) && !was(9));
    c.resetPressed = c.resetPressed || (b(8) && !was(8));
    padPrev = pad.buttons.map((x) => x.pressed);
  }
  // Air roll: hold powerslide and steer
  if (c.slide && c.roll === 0) c.roll = c.steer;
  pressed.clear();
  return c;
}

export function clearInput() {
  keys.clear();
  pressed.clear();
}
