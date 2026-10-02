// Chase camera behind the car, or ball cam (C) that keeps the ball in view.
import * as THREE from 'three';

const DIST = 3.4;
const HEIGHT = 1.25;
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _n = new THREE.Vector3();

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.ballCam = true;
    this.up = new THREE.Vector3(0, 1, 0);
    this.lookAt = new THREE.Vector3();
    this.shake = 0;
    this.baseFov = camera.fov;
  }

  snap(car, ball, arena) {
    this.up.set(0, 1, 0);
    this.update(car, ball, arena, 1, true);
  }

  update(car, ball, arena, dt, instant = false) {
    const cam = this.camera;
    // Follow the car's "up" while it drives on walls, the world's up in the air
    const targetUp = car.grounded ? car.up : _n.set(0, 1, 0);
    this.up.lerp(targetUp, instant ? 1 : 1 - Math.exp(-dt * 4)).normalize();

    if (this.ballCam && ball.mesh.visible) {
      _dir.subVectors(ball.pos, car.pos);
      if (_dir.lengthSq() < 0.01) _dir.copy(car.fwd);
    } else {
      _dir.copy(car.grounded ? car.fwd : car.vel.lengthSq() > 4 ? car.vel : car.fwd);
    }
    // Keep the view direction mostly level relative to "up"
    const vert = _dir.dot(this.up);
    _dir.addScaledVector(this.up, -vert);
    if (_dir.lengthSq() < 1e-4) _dir.copy(car.fwd).addScaledVector(this.up, -car.fwd.dot(this.up));
    _dir.normalize();
    _want.copy(car.pos).addScaledVector(_dir, -DIST).addScaledVector(this.up, HEIGHT);

    // Don't let the camera slip outside the arena
    const d = arena.distance(_want, _n);
    if (d < 0.5) _want.addScaledVector(_n, 0.5 - d);

    const k = instant ? 1 : 1 - Math.exp(-dt * 12);
    cam.position.lerp(_want, k);
    if (this.ballCam && ball.mesh.visible) {
      _look.copy(car.pos).lerp(ball.pos, 0.5);
      // Keep the car low in the frame
      const maxUp = car.pos.clone().addScaledVector(_dir, 8).addScaledVector(this.up, 4);
      if (_look.dot(this.up) > maxUp.dot(this.up)) _look.lerp(maxUp, 0.5);
    } else {
      _look.copy(car.pos).addScaledVector(_dir, 4).addScaledVector(this.up, 0.6);
    }
    this.lookAt.lerp(_look, instant ? 1 : 1 - Math.exp(-dt * 10));
    cam.up.copy(this.up);
    cam.lookAt(this.lookAt);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const s = this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    const fov = this.baseFov + (car.supersonic ? 6 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }
}
