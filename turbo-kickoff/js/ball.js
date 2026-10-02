// The ball: a cannon-es sphere that bounces off cars (via cannon-es contacts)
// and off the arena (via the arena's exact shape).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS as P } from './config.js';

const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Ball {
  constructor({ model, world, material, radius }) {
    this.radius = radius;
    this.mesh = model;
    this.body = new CANNON.Body({
      mass: P.ballMass,
      shape: new CANNON.Sphere(radius),
      material,
      linearDamping: 0,
      angularDamping: 0.02,
    });
    this.body.allowSleep = false;
    world.addBody(this.body);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.frozen = false;
    this.onBounce = null;
  }

  reset(x = 0, y = this.radius, z = 0) {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.quaternion.set(0, 0, 0, 1);
    this.sync();
  }

  sync() {
    const b = this.body;
    this.pos.set(b.position.x, b.position.y, b.position.z);
    this.vel.set(b.velocity.x, b.velocity.y, b.velocity.z);
  }

  // Before the cannon-es step: gravity and air drag
  preStep(dt) {
    const v = this.body.velocity;
    if (this.frozen) {
      v.set(0, 0, 0);
      this.body.angularVelocity.set(0, 0, 0);
      return;
    }
    v.y -= P.gravity * dt;
    const k = 1 - P.ballDrag * dt;
    v.x *= k; v.y *= k; v.z *= k;
  }

  // After the cannon-es step: bounce off the arena
  postStep(dt, arena) {
    const b = this.body;
    if (this.frozen) {
      b.velocity.set(0, 0, 0);
      return;
    }
    this.sync();
    const d = arena.distance(this.pos, _n);
    const r = this.radius;
    if (d < r) {
      this.pos.addScaledVector(_n, r - d);
      const vn = this.vel.dot(_n);
      if (vn < 0) {
        this.vel.addScaledVector(_n, -vn * (1 + P.ballRestitution));
        // Friction on impact, then spin it to match rolling on the surface
        _v.copy(this.vel).addScaledVector(_n, -this.vel.dot(_n));
        if (vn < -1) this.vel.addScaledVector(_v, -0.12);
        _w.crossVectors(_n, _v).divideScalar(r);
        const av = b.angularVelocity;
        av.x += (_w.x - av.x) * 0.5; av.y += (_w.y - av.y) * 0.5; av.z += (_w.z - av.z) * 0.5;
        if (vn < -2 && this.onBounce) this.onBounce(-vn);
      }
      b.position.set(this.pos.x, this.pos.y, this.pos.z);
    }
    const s = this.vel.length();
    if (s > P.ballMaxSpeed) this.vel.multiplyScalar(P.ballMaxSpeed / s);
    b.velocity.set(this.vel.x, this.vel.y, this.vel.z);
  }

  updateVisual() {
    const b = this.body;
    this.mesh.position.set(b.position.x, b.position.y, b.position.z);
    this.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }
}

// Where the ball will be over the next few seconds, ignoring cars.
// Returns an array of {t, x, y, z} every `every` seconds.
export function predictBall(ball, arena, seconds = 4, every = 0.1) {
  const dt = 1 / 60;
  const p = ball.pos.clone();
  const v = ball.vel.clone();
  const out = [{ t: 0, x: p.x, y: p.y, z: p.z }];
  const n = new THREE.Vector3();
  const stepsPer = Math.round(every / dt);
  const r = ball.radius;
  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    v.y -= P.gravity * dt;
    p.addScaledVector(v, dt);
    const d = arena.distance(p, n);
    if (d < r) {
      p.addScaledVector(n, r - d);
      const vn = v.dot(n);
      if (vn < 0) v.addScaledVector(n, -vn * (1 + P.ballRestitution));
    }
    if (i % stepsPer === 0) out.push({ t: i * dt, x: p.x, y: p.y, z: p.z });
  }
  return out;
}
