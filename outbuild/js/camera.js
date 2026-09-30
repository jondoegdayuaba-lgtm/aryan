// Third-person over-the-shoulder camera with collision, ADS zoom and sky-dive framing.
import * as THREE from 'three';
import { CAMERA } from './config.js';
import { damp, clamp, lerp } from './util.js';

export class CameraRig {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = 0;
    this.pitch = -0.1;
    this.dist = CAMERA.dist;
    this.fov = CAMERA.fov;
    this.baseFov = CAMERA.fov;
    this.shake = 0;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.shoulder = CAMERA.shoulder;
    this.scoped = false;
    this.pivotY = 0;
    this._pivot = new THREE.Vector3();
    this._des = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  dirFrom(yaw, pitch, out) {
    const cp = Math.cos(pitch);
    return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  }

  // Follow an actor. mode: ground | sky | glide | bus | dead | spectate
  update(dt, actor, { ads = false, scope = false, build = false, busPos = null } = {}) {
    const cam = this.camera;
    const f = this.dirFrom(this.yaw, this.pitch, this.forward);
    const right = this._dir.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    let dist = CAMERA.dist, height = CAMERA.height, shoulder = CAMERA.shoulder, fov = this.baseFov;
    const mode = actor ? actor.mode : 'bus';
    if (mode === 'sky') { dist = CAMERA.skyDist; shoulder = 0; height = 1.2; fov = this.baseFov + 6; }
    else if (mode === 'glide') { dist = CAMERA.skyDist - 1.5; shoulder = 0; height = 2.0; fov = this.baseFov + 4; }
    else if (mode === 'bus') { dist = 58; shoulder = 0; height = 9; fov = this.baseFov + 4; }
    else if (mode === 'dead') { dist = 6; shoulder = 0; height = 1.5; }
    else {
      if (build) { dist = CAMERA.buildDist; }
      if (ads) { dist = CAMERA.adsDist; shoulder = 0.55; fov = CAMERA.adsFov * this.baseFov / CAMERA.fov; }
      if (scope) { fov = CAMERA.scopeFov; dist = 0.2; shoulder = 0.1; }
      if (actor.intent.crouch) height -= 0.45;
    }
    this.scoped = scope;
    this.dist = damp(this.dist, dist, 12, dt);
    this.shoulder = damp(this.shoulder, shoulder, 10, dt);
    this.fov = damp(this.fov, fov, scope ? 30 : 14, dt);
    // pivot
    const p = this._pivot;
    if (mode === 'bus' && busPos) p.copy(busPos);
    else p.copy(actor.pos);
    this.pivotY = damp(this.pivotY || p.y + height, p.y + height, mode === 'ground' ? 18 : 40, dt);
    if (Math.abs(this.pivotY - (p.y + height)) > 3) this.pivotY = p.y + height;
    p.y = this.pivotY;
    p.addScaledVector(right, this.shoulder);
    // desired camera position behind the pivot, pulled in by walls
    const back = this._des.copy(f).negate();
    const hit = this.physics.raycast(p, back, this.dist + 0.3, { shots: false });
    let d = this.dist;
    if (hit.kind !== 'none') d = Math.max(0.3, Math.min(d, hit.dist - 0.3));
    cam.position.copy(p).addScaledVector(back, d);
    // keep above the terrain
    const th = this.physics.terrain.heightAt(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < th) cam.position.y = th;
    // shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3);
      const s = this.shake * this.shake * 0.08;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    this.target.copy(cam.position).addScaledVector(f, 50);
    cam.lookAt(this.target);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.pos.copy(cam.position);
  }
}
