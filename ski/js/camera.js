// Cameras: speed-aware chase, a far cinematic chase, a helmet cam and a menu fly-by.
import * as THREE from 'three';
import { clamp, damp, dampAngle, smoothstep, lerp } from './util.js';

const MODES = ['chase', 'far', 'helmet'];

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.fov = 62;
    this.roll = 0;
    this.shake = 0;
    this.kick = 0;
    this._t = 0;
    this._init = true;
    this.hideHead = null;      // callback(bool) to hide the helmet meshes in first person
    this.freeze = null;        // { pos, look, fov } to pin the camera
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this._init = true;
    return this.mode;
  }

  impulse(v) {
    this.kick = Math.max(this.kick, v);
  }

  /** follow the skier. rig = SkierRig (for the head position) */
  update(dt, sk, rig) {
    this._t += dt;
    const cam = this.camera;
    if (this.freeze) {                       // fixed viewpoint (screenshots / debugging)
      cam.position.copy(this.freeze.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.freeze.look);
      if (cam.fov !== this.freeze.fov) { cam.fov = this.freeze.fov; cam.updateProjectionMatrix(); }
      if (this.hideHead) this.hideHead(false);
      return;
    }
    const speed = sk.speed;
    // direction of travel, falling back to the ski heading when slow
    const vh = Math.hypot(sk.vx, sk.vz);
    const travelYaw = vh > 3 ? Math.atan2(sk.vx, -sk.vz) : sk.yaw;
    const blend = clamp((vh - 3) / 6, 0, 1);
    const targetYaw = sk.yaw + this._angleLerp(sk.yaw, travelYaw, 0.45 * blend);
    if (this._init) this.yaw = targetYaw;
    this.yaw = dampAngle(this.yaw, targetYaw, this.mode === 'helmet' ? 11 : 3.6, dt);
    const sy = Math.sin(this.yaw), cy = -Math.cos(this.yaw);   // camera forward (xz)

    let fovTarget, dist, height, lookAhead, lookHeight;
    if (this.mode === 'chase') {
      dist = 4.4 + speed * 0.05; height = 1.65 + speed * 0.014; lookAhead = 6 + speed * 0.22; lookHeight = 0.95;
      fovTarget = 60 + 24 * smoothstep(4, 38, speed) + 4 * sk.tuck;
    } else if (this.mode === 'far') {
      dist = 10 + speed * 0.09; height = 3.4 + speed * 0.02; lookAhead = 9; lookHeight = 1.1;
      fovTarget = 52 + 14 * smoothstep(4, 38, speed);
    } else {
      dist = 0; height = 0; lookAhead = 30; lookHeight = 0;
      fovTarget = 84 + 14 * smoothstep(5, 38, speed);
    }
    this.fov = damp(this.fov, fovTarget, 4, dt);

    const px = sk.x, py = sk.y, pz = sk.z;
    let desired = _d1, look = _d2;
    if (this.mode === 'helmet') {
      const head = rig && rig.bones ? rig.bones['Head'] : null;
      if (head) {
        head.getWorldPosition(desired);
        desired.x += sy * 0.13; desired.z += cy * 0.13; desired.y += 0.02;
      } else desired.set(px, py + 1.6, pz);
      look.set(desired.x + sy * lookAhead, desired.y - 1.2 - clamp(sk.tuck, 0, 1) * 0.6, desired.z + cy * lookAhead);
      // looking along the slope, not into the hill
      look.y += (sk.ny < 1 ? 0 : 0);
    } else {
      desired.set(px - sy * dist, py + height, pz - cy * dist);
      const ground = this.world.height(desired.x, desired.z);
      if (desired.y < ground + 0.75) desired.y = ground + 0.75;
      look.set(px + sy * lookAhead, py + lookHeight - 0.9 * smoothstep(0.0, 0.5, -sk.vy / Math.max(speed, 1)) , pz + cy * lookAhead);
    }

    if (this._init) { this.pos.copy(desired); this.look.copy(look); this._init = false; }
    const rate = this.mode === 'helmet' ? 40 : 7.5;
    this.pos.x = damp(this.pos.x, desired.x, rate, dt);
    this.pos.z = damp(this.pos.z, desired.z, rate, dt);
    this.pos.y = damp(this.pos.y, desired.y, rate * 1.15, dt);
    this.look.x = damp(this.look.x, look.x, 9, dt);
    this.look.y = damp(this.look.y, look.y, 7, dt);
    this.look.z = damp(this.look.z, look.z, 9, dt);

    // shake: speed, snow bumps and impacts
    this.kick = damp(this.kick, 0, 7, dt);
    const amp = (0.004 + 0.02 * (speed / 40) ** 2) * (this.mode === 'helmet' ? 1.8 : 1) + sk.bumpKick * 0.02 + this.kick * 0.06;
    const t = this._t;
    const nx = Math.sin(t * 43.1) + 0.6 * Math.sin(t * 91.7 + 1.3);
    const ny = Math.sin(t * 37.9 + 2.0) + 0.6 * Math.sin(t * 83.3);

    cam.position.copy(this.pos);
    cam.position.x += nx * amp * 0.5; cam.position.y += ny * amp;
    const ground = this.world.height(cam.position.x, cam.position.z);
    if (cam.position.y < ground + 0.35) cam.position.y = ground + 0.35;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    // bank into turns
    this.roll = damp(this.roll, -sk.lean * (this.mode === 'helmet' ? 0.5 : 0.14), 5, dt);
    cam.rotateZ(this.roll + nx * amp * 0.03);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    if (this.hideHead) this.hideHead(this.mode === 'helmet');
  }

  _angleLerp(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d * t;
  }
}

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
void lerp;
