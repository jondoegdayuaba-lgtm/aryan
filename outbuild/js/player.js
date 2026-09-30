// Turns keyboard/mouse into the local player's intent, and runs the camera and build preview.
import * as THREE from 'three';
import { CAMERA } from './config.js';
import { WEAPONS } from './items.js';
import { clamp } from './util.js';

const PIECE_KEYS = { KeyZ: 'wall', KeyX: 'floor', KeyC: 'ramp', KeyV: 'cone', F1: 'wall', F2: 'floor', F3: 'ramp', F4: 'cone' };
const MAT_ORDER = ['wood', 'stone', 'metal'];

export class PlayerController {
  constructor(game, actor, input, rig) {
    this.game = game;
    this.actor = actor;
    this.input = input;
    this.rig = rig;
    this.buildMode = false;
    this.buildKind = 'wall';
    this.buildMat = 'wood';
    this.crouchToggle = false;
    this.ads = false;
    this.sens = 1;
    this.invertY = false;
    this.aimOrigin = new THREE.Vector3();
    this.aimDir = new THREE.Vector3();
    this.lastSlot = 0;
    this.dropHeld = 0;
  }

  update(dt) {
    const a = this.actor;
    const inp = this.input;
    const it = a.intent;
    const rig = this.rig;
    const g = this.game;
    const active = inp.locked && !g.paused && !g.mapOpen;

    // ---- look
    if (active) {
      const s = CAMERA.sensitivity * this.sens * (rig.scoped ? 0.3 : this.ads ? 0.65 : 1);
      rig.yaw -= inp.mouse.dx * s;
      rig.pitch -= inp.mouse.dy * s * (this.invertY ? -1 : 1);
      rig.pitch = clamp(rig.pitch, -1.4, 1.35);
    }
    it.yaw = rig.yaw;
    it.pitch = rig.pitch;

    // ---- movement
    const k = (c) => active && inp.down(c);
    it.moveZ = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    it.moveX = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    it.jump = active && inp.hit('Space');
    it.glide = it.jump;
    it.sprint = k('ShiftLeft') || k('ShiftRight');
    it.crouch = k('ControlLeft') || k('ControlRight');
    if (a.mode !== 'ground') it.crouch = false;

    // ---- slots / build mode
    if (active) {
      const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
      digits.forEach((d, i) => {
        if (inp.hit(d)) { this.buildMode = false; it.select = i - 1; }
      });
      if (inp.mouse.wheel && !this.buildMode) {
        const cur = a.inv.selected;
        let n = cur + inp.mouse.wheel;
        if (n > 4) n = -1;
        if (n < -1) n = 4;
        it.select = n;
      }
      if (inp.hit('KeyQ')) this.buildMode = !this.buildMode;
      for (const [code, kind] of Object.entries(PIECE_KEYS)) {
        if (inp.hit(code)) { this.buildMode = true; this.buildKind = kind; }
      }
      if (this.buildMode && inp.hit('KeyR')) {
        this.buildMat = MAT_ORDER[(MAT_ORDER.indexOf(this.buildMat) + 1) % 3];
        if (g.onBuildMat) g.onBuildMat(this.buildMat);
      }
      if (this.buildMode && inp.mouse.wheel) {
        const kinds = ['wall', 'floor', 'ramp', 'cone'];
        this.buildKind = kinds[(kinds.indexOf(this.buildKind) + inp.mouse.wheel + 4) % 4];
      }
      if (inp.hit('KeyE')) it.interact = true;
      if (inp.hit('KeyF') && this.editPiece) g.building.edit(a, this.editPiece);
      if (inp.hit('KeyG')) g.dropCurrent(a);
      if (inp.hit('KeyB') && a.mode === 'ground') a.dancing = !a.dancing;
    }
    if (a.mode !== 'ground') this.buildMode = false;
    if (a.dancing && (it.moveX || it.moveZ || inp.mouse.left || it.jump)) a.dancing = false;
    it.buildMode = this.buildMode;
    it.reload = active && !this.buildMode && inp.hit('KeyR');

    // ---- fire / ADS
    it.fire = active && inp.mouse.left;
    it.firePressed = active && inp.mouse.leftPressed;
    const cur = a.current();
    const canAds = !this.buildMode && cur && cur.type === 'weapon' && a.mode === 'ground' && !it.sprint;
    this.ads = !!(canAds && active && inp.mouse.right);
    it.ads = this.ads;
    const scope = this.ads && cur && WEAPONS[cur.id].scope;
    if (it.sprint && (it.fire || this.ads)) it.sprint = false;

    // ---- aim ray from the camera (last frame's camera, which is what the player sees)
    rig.dirFrom(rig.yaw, rig.pitch, this.aimDir);
    this.aimOrigin.copy(rig.camera.position);
    it.aimOrigin = this.aimOrigin;
    it.aimDir = this.aimDir;

    // ---- editable piece under the crosshair
    this.editPiece = a.mode === 'ground' && a.alive ? g.building.editTarget(a, this.aimOrigin, this.aimDir) : null;

    // ---- build preview
    if (this.buildMode && a.mode === 'ground' && a.alive) {
      const slot = g.building.target(a, this.buildKind, this.aimOrigin, this.aimDir);
      g.building.showGhost(this.buildKind, this.buildMat, slot);
      it.buildSlot = slot;
      it.buildKind = this.buildKind;
      it.buildMat = this.buildMat;
      it.place = active && inp.mouse.left;
    } else {
      g.building.hideGhost();
      it.place = false;
      it.buildSlot = null;
    }
    this.scope = !!scope;
  }

  updateCamera(dt) {
    const a = this.actor;
    const g = this.game;
    this.rig.update(dt, a.alive ? a : a, { ads: this.ads && !this.scope, scope: this.scope, build: this.buildMode,
      busPos: g.airship ? g.airship.camPoint : null });
  }
}
