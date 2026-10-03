// The player: on-foot movement, riding, the third-person camera, shooting
// and Dead Eye.
import * as THREE from 'three';
import { PLAYER, WEAPONS, CAMERA } from './config.js';
import { clamp, damp, dampAngle, wrapAngle } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.yaw = 0;
    this.pitch = -0.12;
    this.dist = CAMERA.footDist;
    this.shoulder = CAMERA.shoulder;
    this.height = CAMERA.height;
    this.fov = CAMERA.fov;
    this.baseFov = CAMERA.fov;
    this.pivot = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.kick = 0;
    this.shake = 0;
    this.cinematic = null;   // { from, to, look, t, dur }
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, CAMERA.minPitch, CAMERA.maxPitch);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  update(dt, focus, mode) {
    const cam = this.camera;
    if (this.cinematic) {
      const c = this.cinematic;
      c.t = Math.min(c.dur, c.t + dt);
      const k = c.ease ? 0.5 - 0.5 * Math.cos(Math.PI * (c.t / c.dur)) : c.t / c.dur;
      cam.position.lerpVectors(c.from, c.to, k);
      _v.lerpVectors(c.lookFrom || c.look, c.look, k);
      cam.lookAt(_v);
      this.fov = damp(this.fov, c.fov || this.baseFov, 3, dt);
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
      return;
    }
    const want = {
      foot: [CAMERA.footDist, CAMERA.shoulder, CAMERA.height, this.baseFov],
      horse: [CAMERA.horseDist, 0.7, 2.6, this.baseFov + 4],
      aim: [CAMERA.aimDist, 0.62, 1.58, WEAPONS.revolver.fov],
      aimRifle: [1.25, 0.55, 1.6, WEAPONS.rifle.fov],
      aimHorse: [2.6, 0.8, 2.45, WEAPONS.revolver.fov + 4],
      aimHorseRifle: [2.2, 0.75, 2.5, WEAPONS.rifle.fov + 4],
    }[mode];
    this.dist = damp(this.dist, want[0], 9, dt);
    this.shoulder = damp(this.shoulder, want[1], 9, dt);
    this.height = damp(this.height, want[2], 9, dt);
    this.fov = damp(this.fov, want[3], 9, dt);
    this.kick = damp(this.kick, 0, 10, dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    const pitch = this.pitch + this.kick;
    this.dir.set(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    this.right(_v2);
    this.pivot.copy(focus).addScaledVector(UP, this.height).addScaledVector(_v2, this.shoulder);
    // Pull in when something is between the pivot and the camera
    const back = _v.copy(this.dir).negate();
    let d = this.dist;
    const hit = this.collision.raycast(this.pivot, back, d + 0.3);
    if (hit) d = Math.max(0.4, hit.dist - 0.3);
    cam.position.copy(this.pivot).addScaledVector(back, d);
    const g = this.collision.terrain.heightAt(cam.position.x, cam.position.z) + 0.35;
    if (cam.position.y < g) cam.position.y = g;
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.15;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.15;
    }
    cam.lookAt(_v.copy(this.pivot).addScaledVector(this.dir, 30));
    this.tooClose = d < 0.75;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }

  // Ray from the camera through the crosshair, starting just past the player.
  aimRay(spread = 0) {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    if (spread) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    const origin = cam.position.clone().addScaledVector(dir, this.dist + 0.4);
    return { origin, dir };
  }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.char = game.chars.create('player');
    game.scene.add(this.char.root);
    this.pos = this.char.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.vy = 0;
    this.health = PLAYER.health;
    this.stamina = 100;
    this.deadEye = PLAYER.deadEyeMax;
    this.weapon = null;
    this.ammo = {
      revolver: { clip: WEAPONS.revolver.clip, reserve: WEAPONS.revolver.reserve },
      rifle: { clip: WEAPONS.rifle.clip, reserve: WEAPONS.rifle.reserve },
    };
    this.cool = 0;
    this.reloading = 0;
    this.switching = 0;
    this.mounted = null;
    this.mounting = null;
    this.aiming = false;
    this.deadEyeOn = false;
    this.marks = [];
    this.firingMarks = null;
    this.lastHurt = -99;
    this.stepAcc = 0;
    this.dead = false;
    this.loud = 0;          // seconds since our last shot, for scaring animals
    this.char.setWeapon(null);
  }

  get speed() {
    return this.mounted ? Math.abs(this.mounted.speed) : Math.hypot(this.vel.x, this.vel.z);
  }

  place(x, z, yaw = 0) {
    const g = this.game.collision.groundY(x, z);
    this.pos.set(x, g, z);
    this.yaw = yaw;
    this.char.root.rotation.set(0, yaw, 0);
    this.vel.set(0, 0, 0);
    this.game.camRig.yaw = yaw;
  }

  setWeapon(kind) {
    if (this.weapon === kind || this.reloading > 0) return;
    this.weapon = kind;
    this.switching = 0.35;
    this.char.setWeapon(kind);
    if (kind) this.game.audio.cock();
  }

  update(dt, gdt) {
    const g = this.game;
    const input = g.input;
    if (this.dead) {
      this.char.update(gdt);
      return;
    }
    const look = input.look();
    if (!g.camRig.cinematic) g.camRig.look(look.x * (this.deadEyeOn ? 0.6 : 1), look.y * (this.deadEyeOn ? 0.6 : 1));

    this.cool -= gdt;
    this.switching -= gdt;
    this.loud += gdt;
    if (this.reloading > 0) {
      this.reloading -= gdt;
      if (this.reloading <= 0) this.finishReload();
    }

    // Weapon selection
    if (!g.lockControls) {
      if (input.pressed('Digit1')) this.setWeapon('revolver');
      if (input.pressed('Digit2')) this.setWeapon('rifle');
      if (input.pressed('Digit3')) this.setWeapon(null);
      if (input.mouse.wheel) {
        const order = [null, 'revolver', 'rifle'];
        const i = order.indexOf(this.weapon);
        this.setWeapon(order[(i + input.mouse.wheel + 3) % 3]);
      }
      if (input.pressed('KeyR')) this.reload();
      if (input.pressed('KeyH')) this.callHorse();
    }

    const wantsAim = !g.lockControls && input.aim && !this.mounting;
    if (wantsAim && !this.weapon) this.setWeapon(this.lastWeapon || 'revolver');
    this.aiming = wantsAim && !!this.weapon && this.switching <= 0;
    if (this.weapon) this.lastWeapon = this.weapon;

    this.updateDeadEye(dt, input);

    if (this.mounting) this.updateMounting(gdt);
    else if (this.mounted) this.updateRiding(gdt, input);
    else this.updateOnFoot(gdt, input);

    // Shooting
    if (!g.lockControls && this.weapon && !this.mounting) {
      if (this.deadEyeOn) {
        if (input.mouse.leftEdge || input.touch.fireEdge) this.markTarget();
      } else if (!this.firingMarks && input.mouse.leftEdge) {
        this.shoot();
      }
    }
    if (this.firingMarks) this.fireMarks(dt);

    // Upper-body pose
    const c = this.char;
    if (this.aiming || this.firingMarks) {
      c.setOverlay(this.weapon === 'rifle' ? 'aim_rifle' : 'aim_pistol');
      c.aimPitch = g.camRig.pitch;
      // On horseback, twist at the waist to aim off the horse's heading
      c.aimTwist = this.mounted ? clamp(wrapAngle(g.camRig.yaw - this.mounted.yaw), -1.9, 1.9) : 0;
    } else {
      c.setOverlay(null);
      c.aimPitch = 0;
      c.aimTwist = 0;
    }
    c.update(gdt);

    // Regeneration
    if (g.time - this.lastHurt > 4) this.health = Math.min(PLAYER.health, this.health + PLAYER.healthRegen * gdt);
    if (!this.deadEyeOn) this.deadEye = Math.min(PLAYER.deadEyeMax, this.deadEye + 1.2 * gdt);
  }

  // Crouch over something (skinning, looting) for `dur` seconds.
  kneel(dur, done) {
    this.kneeling = { t: dur, done };
    this.game.lockControls = true;
    this.vel.set(0, 0, 0);
    this.char.setBase('kneel', 0.3);
  }

  updateOnFoot(dt, input) {
    const g = this.game;
    if (this.kneeling) {
      const k = this.kneeling;
      k.t -= dt;
      this.char.root.rotation.set(0, this.yaw, 0);
      if (k.t <= 0) {
        this.kneeling = null;
        g.lockControls = false;
        this.char.setBase('idle', 0.3);
        k.done();
      }
      return;
    }
    const rig = g.camRig;
    const mv = g.lockControls ? { x: 0, y: 0 } : input.move();
    const f = rig.forward(_v);
    const r = rig.right(_v2);
    const wish = new THREE.Vector3().addScaledVector(f, mv.y).addScaledVector(r, mv.x);
    const mag = Math.min(1, wish.length());
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const walk = input.down('AltLeft') || input.down('KeyC');
    let speed = PLAYER.runSpeed;
    if (this.aiming) speed = PLAYER.aimSpeed;
    else if (walk) speed = PLAYER.walkSpeed;
    else if (sprint && this.stamina > 1 && mag > 0.1) speed = PLAYER.sprintSpeed;
    const water = g.terrain.waterDepth(this.pos.x, this.pos.z, this.pos.y);
    if (water > 0.6) speed *= 0.55;
    if (speed === PLAYER.sprintSpeed) this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
    else this.stamina = Math.min(100, this.stamina + PLAYER.staminaRegen * dt);
    if (mag > 0.01) wish.normalize();
    const target = wish.multiplyScalar(speed * mag);
    const accel = mag > 0.01 ? 12 : 14;
    this.vel.x = damp(this.vel.x, target.x, accel, dt);
    this.vel.z = damp(this.vel.z, target.z, accel, dt);

    // Facing
    if (this.aiming || this.firingMarks) this.yaw = dampAngle(this.yaw, rig.yaw, 18, dt);
    else if (mag > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(target.x, target.z), PLAYER.turnRate, dt);

    const p = this.pos;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    const pl = g.terrain.play;
    p.x = clamp(p.x, -pl, pl);
    p.z = clamp(p.z, -pl, pl);
    g.collision.resolve(p, PLAYER.radius, 1.8);
    for (const n of g.npcs) {
      if (n.dead || !n.char.root.visible) continue;
      const dx = p.x - n.pos.x;
      const dz = p.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 1e-4) {
        p.x = n.pos.x + (dx / d) * 0.7;
        p.z = n.pos.z + (dz / d) * 0.7;
      }
    }
    // Ground: step up small ledges, fall off bigger ones
    const ground = g.collision.groundY(p.x, p.z, p.y);
    if (ground >= p.y - 0.05) {
      p.y = ground > p.y + 0.6 ? p.y : damp(p.y, ground, 25, dt);
      if (ground > p.y + 0.6) p.y = ground;
      this.vy = 0;
    } else {
      this.vy -= 22 * dt;
      p.y += this.vy * dt;
      if (p.y < ground) {
        p.y = ground;
        this.vy = 0;
      }
    }
    if (water > 0.3 && this.speed > 1 && Math.random() < dt * 6) g.effects.splash(_v.set(p.x, p.y + water, p.z));

    this.char.root.rotation.set(0, this.yaw, 0);
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.char.locomote(spd, { aiming: this.aiming || !!this.firingMarks });
    this.stepAcc += spd * dt;
    const stride = spd > 3 ? 1.6 : 0.9;
    if (this.stepAcc > stride) {
      this.stepAcc = 0;
      g.audio.step(spd < 3);
    }
    // Mount
    const h = g.horse;
    if (!g.lockControls && h && input.pressed('KeyE') && !g.interaction) {
      const d = Math.hypot(h.position.x - p.x, h.position.z - p.z);
      if (d < 3.2 && Math.abs(h.speed) < 4) this.startMount(h);
    }
  }

  canMount() {
    const h = this.game.horse;
    if (!h || this.mounted || this.mounting) return false;
    return Math.hypot(h.position.x - this.pos.x, h.position.z - this.pos.z) < 3.2 && Math.abs(h.speed) < 4;
  }

  startMount(h) {
    this.mounting = { horse: h, t: 0, from: this.pos.clone(), fromYaw: this.yaw, up: true };
    h.speed = 0;
    h.mode = 'idle';
    this.vel.set(0, 0, 0);
  }

  dismount() {
    const h = this.mounted;
    if (!h) return;
    h.rider = null;
    this.mounted = null;
    const side = new THREE.Vector3(Math.cos(h.yaw), 0, -Math.sin(h.yaw));   // horse's left
    let x = h.position.x + side.x * 1.2;
    let z = h.position.z + side.z * 1.2;
    const test = new THREE.Vector3(x, h.position.y, z);
    this.game.collision.resolve(test, PLAYER.radius, 1.8);
    x = test.x;
    z = test.z;
    this.pos.set(x, this.game.collision.groundY(x, z, h.position.y + 1), z);
    this.yaw = h.yaw;
    this.char.locomote(0);
    this.game.hud.horse(false);
  }

  updateMounting(dt) {
    const m = this.mounting;
    m.t += dt / 0.55;
    const h = m.horse;
    const seat = h.seatWorld(_v).sub(_v2.set(0, 0.98, 0));
    const k = Math.min(1, m.t);
    const e = k * k * (3 - 2 * k);
    this.pos.lerpVectors(m.from, seat, e);
    this.pos.y += Math.sin(Math.PI * k) * 0.5;
    this.yaw = dampAngle(this.yaw, h.yaw, 10, dt);
    this.char.root.rotation.set(0, this.yaw, 0);
    this.char.locomote(0, { mounted: k > 0.5 });
    if (k >= 1) {
      this.mounting = null;
      this.mounted = h;
      h.rider = this;
      this.game.hud.horse(true);
      if (Math.random() < 0.4) this.game.audio.neigh();
    }
  }

  updateRiding(dt, input) {
    const g = this.game;
    const h = this.mounted;
    const rig = g.camRig;
    const mv = g.lockControls ? { x: 0, y: 0 } : input.move();
    const gallop = input.down('ShiftLeft') || input.down('ShiftRight');
    if (mv.y < -0.3 && Math.abs(mv.x) < 0.3) h.drive(null, false, true);
    else if (Math.hypot(mv.x, mv.y) > 0.2) {
      const dir = new THREE.Vector3().addScaledVector(rig.forward(_v), mv.y).addScaledVector(rig.right(_v2), mv.x);
      h.drive(dir, gallop, false);
    } else h.drive(null, false, false);
    // The horse moves in Game.update; we sit on it afterwards (see syncToHorse).
    if (!g.lockControls && input.pressed('KeyE') && Math.abs(h.speed) < 3.5 && !g.interaction) this.dismount();
  }

  syncToHorse() {
    if (!this.mounted) return;
    const h = this.mounted;
    const seat = h.seatWorld(_v);
    this.pos.copy(seat).sub(_v2.set(0, 0.98, 0));
    this.yaw = h.yaw;
    this.char.root.rotation.set(0, h.yaw, 0);
    this.char.root.rotation.order = 'YXZ';
    this.char.root.rotation.x = h.root.rotation.x;
    this.char.locomote(h.speed, { mounted: true, aiming: this.aiming || !!this.firingMarks });
  }

  callHorse() {
    const h = this.game.horse;
    if (!h || this.mounted) return;
    this.game.audio.whistle();
    const d = Math.hypot(h.position.x - this.pos.x, h.position.z - this.pos.z);
    if (d > 350) {
      // Too far to hear: it trots in from just out of sight
      const a = Math.random() * Math.PI * 2;
      const x = this.pos.x + Math.cos(a) * 60;
      const z = this.pos.z + Math.sin(a) * 60;
      h.position.set(x, this.game.collision.groundY(x, z), z);
    }
    h.call(this.pos);
    setTimeout(() => this.game.audio.neigh(), 600);
  }

  // ---------------------------------------------------------------- shooting
  reload() {
    const w = this.weapon;
    if (!w || this.reloading > 0) return;
    const a = this.ammo[w];
    if (a.clip >= WEAPONS[w].clip || a.reserve <= 0) return;
    this.reloading = WEAPONS[w].reload;
    this.reloadKind = w;
    this.game.audio.reload(w);
  }

  finishReload() {
    const w = this.reloadKind;
    const a = this.ammo[w];
    const need = WEAPONS[w].clip - a.clip;
    const take = Math.min(need, a.reserve);
    a.clip += take;
    a.reserve -= take;
  }

  shoot(guaranteed = null) {
    const g = this.game;
    const w = this.weapon;
    if (!w || this.reloading > 0 || this.switching > 0) return false;
    if (!guaranteed && this.cool > 0) return false;
    const a = this.ammo[w];
    if (a.clip <= 0) {
      g.audio.dryFire();
      this.reload();
      return false;
    }
    const spec = WEAPONS[w];
    a.clip--;
    this.cool = spec.interval;
    this.loud = 0;
    const moving = this.speed > 2;
    let spread = this.aiming ? spec.spread : spec.hipSpread;
    if (moving) spread *= this.mounted ? 2.2 : 1.6;
    const ray = g.camRig.aimRay(guaranteed ? 0 : spread);
    if (guaranteed) {
      // Dead Eye: straight at the marked spot
      ray.dir.copy(guaranteed.point()).sub(ray.origin).normalize();
    }
    const hit = g.combat.trace(ray.origin, ray.dir, spec.range, this);
    const muzzle = this.char.muzzle(new THREE.Vector3());
    const end = hit ? hit.point : ray.origin.clone().addScaledVector(ray.dir, spec.range);
    const shotDir = end.clone().sub(muzzle).normalize();
    g.effects.muzzle(muzzle, shotDir, w === 'rifle');
    g.effects.tracer(muzzle, end);
    g.audio.shot(w, 0, 0);
    if (w === 'rifle') g.audio.lever();
    g.camRig.kick += w === 'rifle' ? 0.045 : 0.03;
    g.camRig.yaw += (Math.random() - 0.5) * 0.01;
    g.combat.applyPlayerHit(hit, spec, ray.dir);
    g.stats.shots++;
    g.alertNear(this.pos, 80);
    if (a.clip === 0 && a.reserve > 0) setTimeout(() => this.reload(), 350);
    return true;
  }

  // -------------------------------------------------------------- Dead Eye
  updateDeadEye(dt, input) {
    const g = this.game;
    if (this.deadEyeOn) {
      this.deadEye -= PLAYER.deadEyeDrain * dt;
      const end = this.deadEye <= 0 || input.pressed('KeyQ') || !this.aiming;
      if (end) this.endDeadEye();
    } else if (!g.lockControls && input.pressed('KeyQ') && this.aiming && this.deadEye > 15 && !this.firingMarks) {
      this.deadEyeOn = true;
      this.marks = [];
      g.setDeadEye(true);
    }
  }

  markTarget() {
    const g = this.game;
    const w = this.weapon;
    const a = this.ammo[w];
    if (this.marks.length >= a.clip) {
      g.audio.dryFire();
      return;
    }
    const ray = g.camRig.aimRay(0);
    const hit = g.combat.trace(ray.origin, ray.dir, WEAPONS[w].range, this);
    if (!hit || !hit.target) return;
    // Remember where on the target, relative to its root, so the mark follows it
    const t = hit.target;
    const local = hit.point.clone().sub(t.position);
    const mark = { target: t, part: hit.part, point: () => new THREE.Vector3().copy(t.position).add(local) };
    this.marks.push(mark);
    g.audio.cock();
  }

  endDeadEye() {
    this.deadEyeOn = false;
    this.game.setDeadEye(false);
    if (this.marks.length) {
      this.firingMarks = { list: this.marks.slice(), t: 0 };
      this.cool = 0;
    }
    this.marks = [];
  }

  fireMarks(dt) {
    const fm = this.firingMarks;
    fm.t -= dt;
    if (fm.t > 0) return;
    const m = fm.list.shift();
    if (!m) {
      this.firingMarks = null;
      return;
    }
    // Aim the camera at the mark so the shot reads on screen
    const p = m.point();
    const rig = this.game.camRig;
    const to = p.clone().sub(rig.camera.position);
    rig.yaw = Math.atan2(to.x, to.z);
    rig.pitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -1, 1);
    this.cool = 0;
    this.shoot(m);
    fm.t = 0.16;
  }

  hurt(dmg, from) {
    const g = this.game;
    if (this.dead || g.invulnerable) return;
    this.health -= dmg;
    this.lastHurt = g.time;
    g.hud.hurt(dmg);
    g.audio.hurt();
    g.camRig.shake = 0.35;
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  }

  die() {
    this.dead = true;
    if (this.deadEyeOn) this.endDeadEye();
    this.firingMarks = null;
    if (this.mounted) {
      const h = this.mounted;
      h.rider = null;
      this.mounted = null;
      this.pos.y = this.game.collision.groundY(this.pos.x, this.pos.z);
    }
    this.char.die();
    this.game.onPlayerDeath();
  }

  revive(x, z, yaw) {
    this.dead = false;
    this.health = PLAYER.health;
    this.stamina = 100;
    this.char.dead = false;
    this.char.actions.die.stop();
    this.char.base = null;
    this.char.setBase('idle', 0);
    this.place(x, z, yaw);
    for (const w of ['revolver', 'rifle']) {
      const a = this.ammo[w];
      a.reserve = Math.max(a.reserve, Math.floor(WEAPONS[w].reserve / 2));
      a.clip = WEAPONS[w].clip;
    }
  }
}

