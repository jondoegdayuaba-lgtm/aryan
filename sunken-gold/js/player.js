// The diver: swimming with the scooter, collisions with the seabed and solid
// models, the surface, the first-person view model (scooter and gloved hands)
// and the dive lamp.
import * as THREE from 'three';
import { DIVE } from './config.js';
import { patchMaterial, U } from './ocean.js';

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);

export class Diver {
  constructor(camera, seabed, colliders, models) {
    this.camera = camera;
    this.seabed = seabed;
    this.colliders = colliders;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.speedLevel = DIVE.swimSpeed;
    this.boostSpeed = DIVE.boostSpeed;
    this.battery = DIVE.battery;
    this.batteryMax = DIVE.battery;
    this.boosting = false;
    this.underwater = true;
    this.safe = false;
    this.bob = 0;
    this.touching = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this._n = new THREE.Vector3();
    this.surgeDir = new THREE.Vector3();
    this.surgeSpeed = 0;
    this.surgeT = 0;
    this._t = new THREE.Vector3();

    // View model: scooter held in front, hands on the grips.
    this.view = new THREE.Group();
    const rig = new THREE.Group();
    const scooter = models.scooter.clone();
    const hands = models.hands.clone();
    rig.add(scooter, hands);
    rig.position.set(0, -0.42, -0.62);
    rig.rotation.x = 0.1;
    rig.scale.setScalar(0.78);
    this.view.add(rig);
    this.rig = rig;
    this.prop = scooter.getObjectByName('scooter_prop');
    rig.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => patchMaterial(m));
      }
    });
  }

  surge(dir, speed, time) {
    this.surgeDir.copy(dir).normalize();
    this.surgeSpeed = speed;
    this.surgeT = time;
  }

  spawn(p, yaw = Math.PI) {
    this.pos.fromArray(p);
    this.vel.set(0, 0, 0);
    this.surgeT = 0;
    this.yaw = yaw;
    this.pitch = -0.25;
  }

  get depth() { return Math.max(0, -this.pos.y); }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.45, 1.45);
  }

  update(dt, t, move, boost) {
    const cam = this.camera;
    const atSurface = this.pos.y > DIVE.surfaceY - 0.4;
    this.forward.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Boost drains the battery; it trickles back when you let go.
    const moving = Math.abs(move.x) + Math.abs(move.y) + Math.abs(move.z) > 0.05;
    this.boosting = boost && moving && this.battery > 0 && move.z > 0;
    if (this.boosting) this.battery = Math.max(0, this.battery - dt);
    else this.battery = Math.min(this.batteryMax, this.battery + DIVE.batteryRecharge * dt);
    const speed = this.boosting ? this.boostSpeed : this.speedLevel;

    const want = this._t.set(0, 0, 0);
    const fwd = this.forward.clone();
    if (atSurface && fwd.y > 0) fwd.y = 0;            // can't swim up out of the water
    want.addScaledVector(fwd.normalize(), move.z * speed);
    want.addScaledVector(this.right, move.x * speed * 0.7);
    want.y += move.y * DIVE.verticalSpeed;
    if (want.lengthSq() > speed * speed) want.setLength(speed);
    let k = 1 - Math.exp(-dt * (moving ? DIVE.accel : DIVE.accel * 0.6));
    // A current ring carries you along whatever you do, easing off at the end.
    if (this.surgeT > 0) {
      this.surgeT -= dt;
      const f = Math.min(1, this.surgeT / 0.5);
      want.multiplyScalar(0.35).addScaledVector(this.surgeDir, this.surgeSpeed * f);
      k = 1 - Math.exp(-dt * 6);
    }
    this.vel.lerp(want, k);
    // Slight negative buoyancy at depth, slight float near the surface.
    if (!moving) this.vel.y += (this.pos.y > -3 ? 0.05 : -0.02) * dt;
    this.pos.addScaledVector(this.vel, dt);

    // Surface: float at eye height with a gentle swell.
    const top = DIVE.surfaceY + Math.sin(t * 0.9) * 0.06;
    if (this.pos.y > top) {
      this.pos.y = top;
      if (this.vel.y > 0) this.vel.y = 0;
    }

    // Seabed and solids.
    const r = DIVE.radius;
    const g = this.seabed.heightAt(this.pos.x, this.pos.z);
    this.touching = Math.max(0, this.touching - dt);
    if (this.pos.y < g + r + 0.15) {
      this.pos.y = g + r + 0.15;
      if (this.vel.y < 0) this.vel.y *= -0.1;
      this.touching = 0.3;
    }
    for (let i = 0; i < 2; i++) {
      const n = this.colliders.resolve(this.pos, r, this._n);
      if (n.lengthSq() > 0) {
        n.normalize();
        const into = this.vel.dot(n);
        if (into < 0) this.vel.addScaledVector(n, -into * 1.1);
        this.touching = 0.3;
      }
    }
    // Soft edge of the dive site.
    const rad = Math.hypot(this.pos.x, this.pos.z);
    if (rad > DIVE.mapRadius) {
      const push = (rad - DIVE.mapRadius) * 2;
      this.vel.x -= (this.pos.x / rad) * push * dt;
      this.vel.z -= (this.pos.z / rad) * push * dt;
    }

    this.underwater = this.pos.y < -0.05;

    // Camera with a little swim sway.
    const sp = this.vel.length();
    this.bob += dt * (1 + sp * 1.5);
    cam.position.copy(this.pos);
    cam.position.y += Math.sin(this.bob * 1.1) * 0.02 * (0.3 + sp * 0.3);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * 0.55) * 0.01 + (atSurface ? Math.sin(t * 0.9) * 0.03 : 0), 'YXZ');
    cam.updateMatrixWorld();

    // View model follows the camera, lagging a touch for weight.
    this.view.position.copy(cam.position);
    this.view.quaternion.copy(cam.quaternion);
    const lag = this.vel.clone().applyQuaternion(cam.quaternion.clone().invert());
    this.rig.position.set(-0.01 * lag.x + Math.sin(this.bob * 0.8) * 0.006, -0.42 - 0.012 * lag.y + Math.sin(this.bob * 1.6) * 0.005, -0.62 + 0.012 * Math.max(0, -lag.z));
    this.rig.rotation.set(0.1 + lag.y * 0.01, -lag.x * 0.02, lag.x * 0.03);
    if (this.prop) this.prop.rotation.y += dt * (2 + (moving ? (this.boosting ? 60 : 30) : 0));
    this.view.updateMatrixWorld(true);

    // The scooter lamp.
    U.uLampPos.value.copy(cam.position).addScaledVector(UP, -0.25).addScaledVector(this.forward, 0.3);
    U.uLampDir.value.copy(this.forward);
  }

  // Where exhaled bubbles come out: either side of the mask, a little back.
  regulator(out) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return out.copy(this.camera.position).addScaledVector(this.right, side * 0.22).add(new THREE.Vector3(0, -0.05, 0))
      .addScaledVector(this.forward, -0.05);
  }
}
