// Camera rig: a springy chase camera that follows the direction of travel (so
// slides show the side of the bike), a wide one, the rider's helmet view and a
// low one off the front fender.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export const CAMERA_MODES = ['chase', 'far', 'helmet', 'front'];

export class CameraRig {
  constructor(camera, heightAt) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.mode = 'chase';
    this.yaw = 0;           // smoothed follow heading
    this.pitch = 0.16;
    this.orbitYaw = 0;      // free-look offset
    this.orbitPitch = 0;
    this.lookIdle = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.fov = 62;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.initialized = false;
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.initialized = false;
  }

  snap() { this.initialized = false; }

  update(dt, vehicle, bodyPos, bodyQuat, look, extra = {}) {
    const cam = this.camera;
    const speed = vehicle.speed;
    // Heading from the bike's right axis, which stays level even mid-backflip.
    const rt = this._v.set(1, 0, 0).applyQuaternion(bodyQuat);
    const bikeYaw = Math.atan2(-rt.z, rt.x);

    // Free look: drag / right stick orbits, then eases back behind the bike.
    const sens = 0.005;
    this.orbitYaw -= look.x * sens + (extra.stickX || 0) * dt * 2.5;
    this.orbitPitch = clamp(this.orbitPitch + look.y * sens * 0.6 + (extra.stickY || 0) * dt * 1.5, -0.25, 0.9);
    if (look.active || Math.abs(extra.stickX || 0) > 0 || Math.abs(extra.stickY || 0) > 0) this.lookIdle = 0;
    else this.lookIdle += dt;
    if (this.lookIdle > 0.8) {
      const k = 1 - Math.exp(-dt * 2.5);
      this.orbitYaw += angDiff(0, this.orbitYaw) * k;
      this.orbitPitch += (0 - this.orbitPitch) * k;
    }

    if (this.mode === 'helmet' || this.mode === 'front') {
      if (this.mode === 'helmet' && extra.head) {
        cam.position.copy(extra.head).add(this._w.set(0, 0.02, -0.12).applyQuaternion(bodyQuat));
      } else {
        cam.position.copy(this._w.set(0, -0.18, -1.05)).applyQuaternion(bodyQuat).add(bodyPos);
      }
      cam.quaternion.copy(bodyQuat);
      // The rider's head leans into turns, but less than the bike.
      cam.rotateZ((extra.lean || 0) * (this.mode === 'helmet' ? 0.55 : 1));
      cam.rotateY(this.orbitYaw);
      cam.rotateX(-this.orbitPitch * 0.5 - (this.mode === 'helmet' ? 0.12 : 0.02));
      this._fov(dt, speed, extra.boost, this.mode === 'helmet' ? 74 : 70);
      this._shake(dt, extra);
      cam.updateMatrixWorld();
      this.initialized = true;
      return;
    }

    // Follow the direction of travel when moving, the bike's nose otherwise.
    const vel = vehicle.vel;
    const hs = Math.hypot(vel.x, vel.z);
    let targetYaw = bikeYaw;
    if (hs > 4 && vehicle.forwardSpeed > 2) {
      const velYaw = Math.atan2(-vel.x, -vel.z);
      targetYaw = bikeYaw + angDiff(velYaw, bikeYaw) * clamp((hs - 4) / 10, 0, 1) * 0.65;
    }
    if (vehicle.forwardSpeed < -2) targetYaw = bikeYaw;
    if (!this.initialized) {
      this.yaw = targetYaw;
    } else {
      const air = vehicle.groundedWheels === 0;
      const rate = air ? 1.2 : 3.2 + clamp(speed / 20, 0, 1) * 1.5;
      this.yaw += angDiff(targetYaw, this.yaw) * (1 - Math.exp(-dt * rate));
    }

    const far = this.mode === 'far';
    const dist = (far ? 7 : 3.5) + clamp(speed * 0.035, 0, 1.4);
    const height = (far ? 2.4 : 1.3);
    const yaw = this.yaw + this.orbitYaw;
    const pitch = this.pitch + this.orbitPitch;
    const dir = this._w.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const target = this.look.copy(bodyPos);
    target.y += 0.5;
    const want = new THREE.Vector3().copy(target).addScaledVector(dir, -dist);
    want.y += height - dist * Math.sin(pitch) * 0.35;

    // Keep above the ground.
    const g = this.heightAt(want.x, want.z) + 0.8;
    if (want.y < g) want.y = g;

    if (!this.initialized) {
      this.pos.copy(want);
      this.initialized = true;
    } else {
      // Stiffer sideways than vertically, so bumps don't bounce the view.
      const kh = 1 - Math.exp(-dt * 9);
      const kv = 1 - Math.exp(-dt * 5.5);
      this.pos.x += (want.x - this.pos.x) * kh;
      this.pos.z += (want.z - this.pos.z) * kh;
      this.pos.y += (want.y - this.pos.y) * kv;
      const g2 = this.heightAt(this.pos.x, this.pos.z) + 0.7;
      if (this.pos.y < g2) this.pos.y = g2;
    }
    cam.position.copy(this.pos);
    // Look slightly ahead of the bike.
    const ahead = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(1.8 + clamp(speed * 0.07, 0, 3.5));
    cam.up.set(0, 1, 0);
    cam.lookAt(target.x + ahead.x, target.y + 0.2, target.z + ahead.z);
    this._fov(dt, speed, extra.boost, 62);
    this._shake(dt, extra);
    cam.updateMatrixWorld();
  }

  _fov(dt, speed, boost, base) {
    const want = base + clamp(speed * 0.22, 0, 16) + (boost ? 7 : 0);
    this.fov += (want - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _shake(dt, extra) {
    this.shake = Math.max(this.shake - dt * 2.2, extra.shake || 0);
    const s = this.shake * this.shake * 0.35 + (extra.rumble || 0) * 0.012;
    if (s > 0.0005) {
      const t = performance.now() / 1000;
      this.camera.position.x += (Math.sin(t * 37.1) + Math.sin(t * 59.3)) * s * 0.5;
      this.camera.position.y += (Math.sin(t * 43.7) + Math.sin(t * 71.9)) * s * 0.5;
    }
  }

  kick(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  // TV-style shots for the title screen: a roadside camera ahead of the bike
  // that tracks it going past, then cuts to the next one.
  cinematic(dt, vehicle, bodyPos, route, s) {
    const cam = this.camera;
    const C = this.cine || (this.cine = { t: 99, pos: new THREE.Vector3(), shot: 0 });
    C.t += dt;
    const d = C.pos.distanceTo(bodyPos);
    if (C.t > 9 || (C.t > 2 && d > 70) || !this.initialized) {
      C.shot++;
      C.t = 0;
      const ahead = 22 + vehicle.speed * 1.1 + Math.random() * 16;
      const p = route.pos(route.wrapS(s + ahead));
      const t = route.tangent(route.wrapS(s + ahead));
      const side = (C.shot % 2 ? 1 : -1) * (7 + Math.random() * 6);
      C.pos.set(p.x - t.z * side, 0, p.z + t.x * side);
      C.pos.y = this.heightAt(C.pos.x, C.pos.z) + (C.shot % 3 === 0 ? 5 : 0.8 + Math.random() * 1.2);
      C.fov = 30 + Math.random() * 12;
      this.initialized = true;
    }
    cam.position.copy(C.pos);
    cam.up.set(0, 1, 0);
    this.look.copy(bodyPos);
    this.look.y += 0.25;
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - C.fov) > 0.01) {
      cam.fov = C.fov;
      cam.updateProjectionMatrix();
    }
    this.fov = cam.fov;
    cam.updateMatrixWorld();
  }

  // Slow orbit around the parked bike (garage).
  orbit(dt, bodyPos) {
    const cam = this.camera;
    this.orbitT = (this.orbitT || 0) + dt * 0.3;
    const a = this.orbitT;
    cam.position.set(bodyPos.x + Math.sin(a) * 5.6, bodyPos.y + 0.6, bodyPos.z + Math.cos(a) * 5.6);
    const g = this.heightAt(cam.position.x, cam.position.z) + 0.6;
    if (cam.position.y < g) cam.position.y = g;
    cam.up.set(0, 1, 0);
    // Aim below the bike so it sits above the garage panel.
    cam.lookAt(bodyPos.x, bodyPos.y - 1.05, bodyPos.z);
    if (Math.abs(cam.fov - 40) > 0.01) {
      cam.fov = 40;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.initialized = false;
  }
}
