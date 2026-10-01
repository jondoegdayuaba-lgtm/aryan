import { MOVE } from './config.js';

// Moves a body (feet position, velocity, radius, height) through the box world.
// Each axis is moved and resolved separately; low ledges (stairs) are stepped up.
const EPS = 0.001;

function hit(boxes, px, py, pz, r, h) {
  for (const b of boxes) {
    if (px + r > b.min.x && px - r < b.max.x && pz + r > b.min.z && pz - r < b.max.z &&
        py + h > b.min.y && py < b.max.y) return b;
  }
  return null;
}

export function moveBody(body, dt, boxes) {
  const p = body.pos, v = body.vel, r = MOVE.radius, h = body.height;
  const steps = Math.max(1, Math.ceil((Math.hypot(v.x, v.y, v.z) * dt) / 0.25));
  const sdt = dt / steps;
  const wasGrounded = body.onGround;
  body.stepped = 0;
  for (let s = 0; s < steps; s++) {
    for (const axis of ['x', 'z']) {
      p[axis] += v[axis] * sdt;
      for (let it = 0; it < 3; it++) {
        const b = hit(boxes, p.x, p.y, p.z, r, h);
        if (!b) break;
        const rise = b.max.y - p.y;
        if (wasGrounded && rise > 0 && rise <= MOVE.stepUp && !hit(boxes, p.x, b.max.y + EPS, p.z, r, h)) {
          p.y = b.max.y + EPS;
          body.stepped += rise;
          continue;
        }
        p[axis] = v[axis] > 0 ? b.min[axis] - r - EPS : b.max[axis] + r + EPS;
        v[axis] = 0;
      }
    }
    p.y += v.y * sdt;
    body.onGround = false;
    const b = hit(boxes, p.x, p.y, p.z, r, h);
    if (b) {
      if (v.y <= 0) { p.y = b.max.y + EPS; body.onGround = true; }
      else p.y = b.min.y - h - EPS;
      v.y = 0;
    }
    if (p.y <= 0) { p.y = 0; v.y = 0; body.onGround = true; }
  }
  // Stay grounded when walking down stairs instead of hopping off each step.
  if (!body.onGround && wasGrounded && v.y <= 0) {
    for (let d = 0.05; d <= MOVE.stepUp + 0.05; d += 0.1) {
      if (p.y - d <= 0) { p.y = 0; body.onGround = true; break; }
      const b = hit(boxes, p.x, p.y - d, p.z, r, h);
      if (b) { p.y = b.max.y + EPS; body.onGround = true; v.y = 0; break; }
    }
  }
}

// Ground movement shared by the player and the bots.
// wish: desired horizontal direction (x,z, length <= 1), speed: target speed.
export function accelerate(body, wishX, wishZ, speed, dt) {
  const v = body.vel;
  if (body.onGround && !body.sliding) {
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0) {
      const drop = Math.max(sp - MOVE.friction * dt * Math.max(sp, 3), 0) / sp;
      v.x *= drop; v.z *= drop;
    }
  }
  const accel = body.onGround ? (body.sliding ? 4 : MOVE.accel) : MOVE.airAccel;
  const cur = v.x * wishX + v.z * wishZ;
  const add = Math.min(Math.max(speed - cur, 0), accel * dt * speed / 7);
  v.x += wishX * add;
  v.z += wishZ * add;
}
