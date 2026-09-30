// Cameras: a steady chase camera that follows the slope, a far chase, a helmet cam and a mouse / touch orbit.
//
// The camera never chases the skier's absolute position (that lags and stretches at speed). Instead the offset
// from the skier is smoothed and added to the skier's own (interpolated) position, so the distance stays constant
// however fast you go. Only the vertical bounce of bumps is filtered, with a velocity predictor so nothing lags.
// There is no roll and no random shake; only landings and crashes give the camera a kick.
import * as THREE from 'three';
import { clamp, damp, dampAngle, smoothstep, angleDiff } from './util.js';

const MODES = ['chase', 'far', 'helmet'];

const _n = new THREE.Vector3(), _f = new THREE.Vector3(), _fs = new THREE.Vector3(), _off = new THREE.Vector3();
const _want = new THREE.Vector3(), _look = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.fov = 62;
    this.kick = 0;                     // landing / crash impulse (0..1)
    this._t = 0;
    this._init = true;
    this.hideHead = null;              // callback(bool) to hide the helmet meshes in first person
    this.freeze = null;                // { pos, look, fov } to pin the camera (screenshots / debugging)

    this.heading = 0;                  // smoothed travel heading (rad)
    this.normal = new THREE.Vector3(0, 1, 0);
    this.offset = new THREE.Vector3(); // smoothed camera offset from the skier
    this.lookOff = new THREE.Vector3();
    this.yBase = 0;                    // filtered skier height
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();

    // orbit (mouse drag / touch drag) and zoom (wheel)
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
    this._orbitIdle = 0;
    this._dragging = false;
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this._init = true;
    return this.mode;
  }

  impulse(v) {
    this.kick = Math.max(this.kick, v);
  }

  // ---------------------------------------------------------------- user look
  /** rotate the view around the skier (pixels of drag) */
  orbit(dx, dy) {
    this.orbitYaw -= dx * 0.0065;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.0045, -0.35, 1.05);
    this._orbitIdle = 0;
    this._dragging = true;
  }

  endOrbit() {
    this._dragging = false;
  }

  zoomBy(delta) {
    this.zoom = clamp(this.zoom * Math.exp(delta * 0.0012), 0.55, 2.4);
  }

  /** attach mouse / touch listeners to a canvas */
  bind(canvas) {
    let down = false, lx = 0, ly = 0, id = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.clientY > innerHeight * 0.5) return;      // the lower half steers
      down = true; lx = e.clientX; ly = e.clientY; id = e.pointerId;
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== id) return;
      this.orbit(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    const up = (e) => { if (e.pointerId === id) { down = false; this.endOrbit(); } };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { this.zoomBy(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------------ update
  /** follow the skier. v = interpolated skier state, rig = SkierRig (for the head position) */
  update(dt, v, rig) {
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
    const speed = v.speed;
    const vh = Math.hypot(v.vx, v.vz);

    // ---- orbit eases back to the default view a couple of seconds after you let go
    if (!this._dragging) {
      this._orbitIdle += dt;
      if (this._orbitIdle > 2.2 && this.mode !== 'helmet') {
        const k = 1 - Math.exp(-2.4 * dt);
        this.orbitYaw += (0 - this.orbitYaw) * k;
        this.orbitPitch += (0 - this.orbitPitch) * k;
      }
    }

    // ---- heading: mostly the direction of travel, a little toward where the skis point
    if (!v.crashed) {
      const travel = vh > 2.0 ? Math.atan2(v.vx, -v.vz) : v.yaw;
      const wT = smoothstep(2.0, 7.0, vh);
      const want = v.yaw + angleDiff(travel, v.yaw) * (0.45 + 0.5 * wT);
      if (this._init) this.heading = want;
      this.heading = dampAngle(this.heading, want, this.mode === 'helmet' ? 9 : 3.2, dt);
    }
    // slope normal, smoothed (blends toward world up in the air)
    _n.set(v.nx, v.ny, v.nz);
    if (!v.grounded) _n.lerp(UP, 0.7);
    _n.normalize();
    if (this._init) this.normal.copy(_n);
    this.normal.lerp(_n, 1 - Math.exp(-4 * dt)).normalize();

    // ---- vertical bounce filter with velocity prediction (no steady-state lag)
    if (this._init) this.yBase = v.y;
    this.yBase += v.vy * dt;
    this.yBase += (v.y - this.yBase) * (1 - Math.exp(-7 * dt));

    // ---- framing per mode
    let dist, height, lookAhead, lookUp, fovT;
    if (this.mode === 'chase') {
      dist = (5.9 + 0.022 * speed) * this.zoom;
      height = (2.15 + 0.008 * speed) * (0.85 + 0.15 * this.zoom);
      lookAhead = 8.5 + 0.14 * speed;
      lookUp = 1.05;
      fovT = 60 + 9 * smoothstep(10, 55, speed) + 2.5 * v.tuck;
    } else if (this.mode === 'far') {
      dist = (12.5 + 0.06 * speed) * this.zoom;
      height = (4.6 + 0.014 * speed) * (0.85 + 0.15 * this.zoom);
      lookAhead = 10 + 0.12 * speed;
      lookUp = 1.1;
      fovT = 52 + 8 * smoothstep(10, 55, speed);
    } else {
      dist = 0; height = 0; lookAhead = 36; lookUp = 0;
      fovT = 78 + 10 * smoothstep(10, 55, speed);
    }
    this.fov = damp(this.fov, fovT, 3, dt);
    this.kick = damp(this.kick, 0, 6, dt);

    if (this.mode === 'helmet') {
      const head = rig && rig.bones ? rig.bones['Head'] : null;
      const sy = Math.sin(this.heading), cy = -Math.cos(this.heading);
      if (head) head.getWorldPosition(_want); else _want.set(v.x, v.y + 1.6, v.z);
      _want.x += sy * 0.13; _want.z += cy * 0.13; _want.y += 0.02;
      if (this._init) this.pos.copy(_want);
      this.pos.x = _want.x; this.pos.z = _want.z;
      this.pos.y += (_want.y - this.pos.y) * (1 - Math.exp(-22 * dt));       // filter the head bob a little
      _look.set(_want.x + sy * lookAhead, _want.y - 1.5 - clamp(v.tuck, 0, 1) * 0.5, _want.z + cy * lookAhead);
      if (this._init) this.look.copy(_look);
      this.look.x = _look.x; this.look.z = _look.z;
      this.look.y += (_look.y - this.look.y) * (1 - Math.exp(-10 * dt));
      cam.position.copy(this.pos);
      cam.position.y -= this.kick * 0.10;
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      cam.rotateZ(-v.lean * 0.10);
    } else {
      // ---- slope-parallel offset behind the skier, rotated by the orbit angles
      const yaw = this.heading + this.orbitYaw;
      _f.set(Math.sin(yaw), 0, -Math.cos(yaw));
      _fs.copy(_f).addScaledVector(this.normal, -_f.dot(this.normal)).normalize();
      const pitch = this.orbitPitch;
      _off.copy(_fs).multiplyScalar(-dist * Math.cos(pitch)).addScaledVector(this.normal, height + dist * Math.sin(pitch));
      if (v.crashed) _off.multiplyScalar(1.25);
      if (this._init) this.offset.copy(_off);
      this.offset.lerp(_off, 1 - Math.exp(-5.5 * dt));

      // look target, smoothed in skier-relative space
      _look.copy(this.normal).multiplyScalar(lookUp).addScaledVector(_fs, lookAhead * (v.crashed ? 0.1 : 1) * Math.max(0.25, Math.cos(this.orbitYaw)));
      if (this._init) this.lookOff.copy(_look);
      this.lookOff.lerp(_look, 1 - Math.exp(-6.5 * dt));

      _p.set(v.x, this.yBase, v.z);
      cam.position.copy(_p).add(this.offset);
      // never dip into the snow, and clear the ridge between the camera and the skier
      const floor = this.world.height(cam.position.x, cam.position.z) + 1.0;
      if (cam.position.y < floor) cam.position.y = floor;
      const mx = (cam.position.x + v.x) * 0.5, mz = (cam.position.z + v.z) * 0.5;
      const lineY = (cam.position.y + v.y + 1.0) * 0.5;
      const gm = this.world.height(mx, mz) + 0.9;
      if (lineY < gm) cam.position.y += (gm - lineY) * 2.0;
      cam.position.y -= this.kick * 0.22;                 // landings and crashes nudge the view down for a moment

      cam.up.set(0, 1, 0);
      _look.copy(_p).add(this.lookOff);
      cam.lookAt(_look);
      this.pos.copy(cam.position);
      this.look.copy(_look);
    }
    this._init = false;

    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.hideHead) this.hideHead(this.mode === 'helmet');
  }
}
