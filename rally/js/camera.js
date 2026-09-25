// Cameras: a chase camera that swings out when the car slides, bonnet and
// bumper views, and trackside "TV" cameras for the menu and replays.
import * as THREE from 'three';
import { locate, wrap } from './road.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export const VIEWS = ['chase', 'far', 'bonnet', 'bumper'];

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.view = 'chase';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.shake = 0;          // trauma 0..1, decays
    this.fovBase = 62;
    this.tv = null;
    this._init = false;
  }

  cycle() {
    this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
    this._init = false;
  }

  bump(amount) { this.shake = Math.min(1, this.shake + amount); }

  snap() { this._init = false; }

  // Chase / onboard views following the physics car.
  follow(car, dt) {
    const cam = this.camera;
    const F = car.F, U = car.U;
    const speed = car.speed;
    // heading we sit behind: mostly where the car points, partly where it goes
    const heading = Math.atan2(F.x, F.z);
    let target = heading;
    if (speed > 3) {
      const moving = Math.atan2(car.vel.x, car.vel.z);
      let d = moving - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2) target = heading + d * 0.45;
    }
    if (!this._init) this.yaw = target;
    let dy = target - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (this.view === 'far' ? 3.2 : 4.2));

    if (this.view === 'chase' || this.view === 'far') {
      const far = this.view === 'far';
      const dist = (far ? 8.2 : 5.9) + Math.min(speed, 45) * 0.018;
      const height = far ? 2.9 : 1.95;
      const want = _v.set(-Math.sin(this.yaw) * dist, height, -Math.cos(this.yaw) * dist).add(car.pos);
      // don't dig into the ground behind
      const gh = this.world.heightAt(want.x, want.z) + 0.9;
      if (want.y < gh) want.y = gh;
      if (!this._init) { this.pos.copy(want); this.vel.set(0, 0, 0); this._init = true; }
      // critically damped spring: lags a touch under acceleration
      const k = far ? 34 : 46, c = 2 * Math.sqrt(k);
      _w.subVectors(want, this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(_w, dt);
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y < gh) this.pos.y = gh;
      cam.position.copy(this.pos);
      this.look.copy(car.pos).addScaledVector(F, 2.2);
      this.look.y += 0.75;
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else {
      // onboard: rigidly attached, rolls and pitches with the car
      const off = this.view === 'bonnet' ? [0, 0.62, 0.35] : [0, 0.05, 2.15];
      const S = car.spec;
      if (S.id === 'truck') off[1] += 0.6;
      cam.position.set(off[0], off[1], off[2]).applyQuaternion(car.quat).add(car.pos);
      cam.quaternion.copy(car.quat).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI));
      cam.up.set(0, 1, 0);
      this._init = true;
    }
    // shake: rough roads, landings and hits
    if (this.shake > 0) {
      const s = this.shake * this.shake * (this.view === 'chase' || this.view === 'far' ? 0.25 : 0.12);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.3;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    const fov = this.fovBase + Math.min(1, speed / 45) * 12 + (this.view === 'bumper' ? 6 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  // TV coverage: pick a camera beside the road ahead of the car, stay until the
  // car has gone past, then cut to the next one.
  broadcast(car, dt, time) {
    const road = this.world.road, n = road.count;
    const loc = locate(road, car.pos.x, car.pos.z, this._tvHint ?? -1, 60);
    this._tvHint = loc.i;
    const cam = this.camera;
    const needNew = !this.tv || car.pos.distanceTo(this.tv.pos) > 70 || this._tvAge > 9 ||
      (this._tvAge > 2.5 && ((loc.s - this.tv.s + n) % n) > 45 && ((loc.s - this.tv.s + n) % n) < n / 2);
    this._tvAge = (this._tvAge || 0) + dt;
    if (needNew) {
      const ahead = 35 + Math.random() * 25;
      const i = wrap(Math.round(loc.s + ahead), n);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = 7 + Math.random() * 9;
      const lx = road.tz[i] * side, lz = -road.tx[i] * side;
      const p = new THREE.Vector3(road.x[i] + lx * off, 0, road.z[i] + lz * off);
      p.y = this.world.heightAt(p.x, p.z) + 1.4 + Math.random() * 3.5;
      this.tv = { pos: p, s: i, fov: 24 + Math.random() * 16 };
      this._tvAge = 0;
    }
    cam.position.copy(this.tv.pos);
    this.look.lerp(_v.copy(car.pos).setY(car.pos.y + 0.5), needNew ? 1 : Math.min(1, dt * 6));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    const d = cam.position.distanceTo(car.pos);
    const fov = THREE.MathUtils.clamp(this.tv.fov * 30 / Math.max(d, 8), 10, 55);
    cam.fov += (fov - cam.fov) * (needNew ? 1 : Math.min(1, dt * 2));
    cam.updateProjectionMatrix();
    this._init = false;
  }

  // Slow orbit around a point (garage / title screen).
  orbit(center, radius, height, time, speed = 0.12) {
    const a = time * speed;
    this.camera.position.set(center.x + Math.sin(a) * radius, center.y + height, center.z + Math.cos(a) * radius);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center.x, center.y + 0.6, center.z);
    this._init = false;
  }
}
