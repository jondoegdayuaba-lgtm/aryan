// First-person player physics: walking, jumping, swimming, flying and
// axis-by-axis collision against solid blocks.
import * as THREE from 'three';
import { BLOCKS, B } from './blocks.js';

export const HALF_W = 0.3;
export const HEIGHT = 1.8;
export const EYE = 1.62;

const solidAt = (world, x, y, z) => BLOCKS[world.get(x, y, z)].solid;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.sneaking = false;
    this.sprinting = false;
    this.fallTop = null;
    this.walked = 0;
  }

  eyeY() { return this.pos.y + (this.sneaking && !this.flying ? EYE - 0.15 : EYE); }

  intersectsBlock(x, y, z) {
    const p = this.pos;
    return p.x + HALF_W > x && p.x - HALF_W < x + 1 && p.y + HEIGHT > y && p.y < y + 1 && p.z + HALF_W > z && p.z - HALF_W < z + 1;
  }

  moveAxis(world, axis, d) {
    if (!d) return false;
    const p = this.pos;
    p[axis] += d;
    const x0 = Math.floor(p.x - HALF_W), x1 = Math.floor(p.x + HALF_W - 1e-6);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + HEIGHT - 1e-6);
    const z0 = Math.floor(p.z - HALF_W), z1 = Math.floor(p.z + HALF_W - 1e-6);
    let limit = d > 0 ? Infinity : -Infinity;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (!solidAt(world, x, y, z)) continue;
          const b = axis === 'x' ? x : axis === 'y' ? y : z;
          limit = d > 0 ? Math.min(limit, b) : Math.max(limit, b + 1);
        }
      }
    }
    if (!Number.isFinite(limit)) return false;
    const ext = axis === 'y' ? (d > 0 ? HEIGHT : 0) : HALF_W;
    p[axis] = d > 0 ? limit - ext - 1e-4 : limit + ext + 1e-4;
    return true;
  }

  // input: { fwd, strafe, jump, sneak, sprint }. Returns fall damage taken on landing.
  update(world, dt, input) {
    const p = this.pos, v = this.vel;
    this.inWater = world.get(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z)) === B.WATER;
    this.headInWater = world.get(Math.floor(p.x), Math.floor(this.eyeY()), Math.floor(p.z)) === B.WATER;
    this.sneaking = input.sneak && !this.flying;
    this.sprinting = input.sprint && input.fwd > 0 && !this.sneaking;

    let speed = this.flying ? (this.sprinting ? 21 : 10.9) : this.sneaking ? 1.4 : this.sprinting ? 5.6 : 4.3;
    if (this.inWater && !this.flying) speed *= 0.5;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * input.fwd + cos * input.strafe;
    let wz = -cos * input.fwd - sin * input.strafe;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    const accel = this.flying ? 8 : this.onGround ? 16 : this.inWater ? 6 : 3;
    const k = 1 - Math.exp(-accel * dt);
    v.x += (wx * speed - v.x) * k;
    v.z += (wz * speed - v.z) * k;

    if (this.flying) {
      const ty = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * 8;
      v.y += (ty - v.y) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      v.y -= 10 * dt;
      v.y *= Math.exp(-3 * dt);
      if (input.jump) v.y = Math.min(v.y + 22 * dt, 3.6);
      v.y = Math.max(v.y, -4);
    } else {
      v.y -= 32 * dt;
      v.y = Math.max(v.y, -60);
      if (input.jump && this.onGround) {
        v.y = 9.0;
        this.jumped = true;
      }
    }

    const dx = v.x * dt, dy = v.y * dt, dz = v.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
    const wasGround = this.onGround;
    this.onGround = false;
    let hitWall = false;
    for (let s = 0; s < steps; s++) {
      if (this.moveAxis(world, 'y', dy / steps)) {
        if (v.y < 0) this.onGround = true;
        v.y = 0;
      }
      // Sneaking keeps you from walking off edges.
      const ox = p.x, oz = p.z;
      if (this.moveAxis(world, 'x', dx / steps)) { v.x = 0; hitWall = true; }
      if (this.sneaking && wasGround && !this.groundBelow(world)) { p.x = ox; v.x = 0; }
      if (this.moveAxis(world, 'z', dz / steps)) { v.z = 0; hitWall = true; }
      if (this.sneaking && wasGround && !this.groundBelow(world)) { p.z = oz; v.z = 0; }
    }
    if (this.inWater && hitWall && input.jump) v.y = 5; // climb out onto banks

    if (this.onGround) this.walked += Math.hypot(dx, dz);

    let damage = 0;
    if (this.flying || this.inWater) this.fallTop = null;
    else if (!this.onGround) this.fallTop = Math.max(this.fallTop ?? p.y, p.y);
    else if (this.fallTop !== null) {
      damage = Math.max(0, Math.floor(this.fallTop - p.y - 3));
      this.fallTop = null;
    }
    return damage;
  }

  groundBelow(world) {
    const p = this.pos, y = Math.floor(p.y - 0.05);
    for (const ox of [-HALF_W, HALF_W]) for (const oz of [-HALF_W, HALF_W]) {
      if (solidAt(world, Math.floor(p.x + ox), y, Math.floor(p.z + oz))) return true;
    }
    return false;
  }
}
