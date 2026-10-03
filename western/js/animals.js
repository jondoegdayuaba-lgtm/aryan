// Horses and deer, from horse.glb and deer.glb.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { HORSE } from './config.js';
import { clamp, damp, dampAngle, wrapAngle, approach } from './util.js';
import { raySphere } from './character.js';
import { mergeSkinned } from './assets.js';

const _v = new THREE.Vector3();

class Quadruped {
  constructor(gltf, coatName, coatColor) {
    this.root = new THREE.Group();
    this.model = skeletonClone(gltf.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (coatColor && o.material.name === coatName) {
          o.material = o.material.clone();
          o.material.color.set(coatColor);
        }
      }
    });
    mergeSkinned(this.model);
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'die' || clip.name === 'rear') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[clip.name] = a;
    }
    this.current = null;
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 0;
    this.play('idle', 0);
  }

  get position() {
    return this.root.position;
  }

  play(name, fade = 0.3, ts = 1) {
    const a = this.actions[name];
    if (!a) return;
    a.timeScale = ts;
    if (this.current === name) return;
    const prev = this.current && this.actions[this.current];
    a.reset();
    a.play();
    if (prev && fade > 0) prev.crossFadeTo(a, fade, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  // Follow the ground: height from the collision world, pitch from the slope.
  settle(dt, ctx, len) {
    const p = this.root.position;
    const fx = Math.sin(this.yaw) * len;
    const fz = Math.cos(this.yaw) * len;
    const gF = ctx.collision.groundY(p.x + fx, p.z + fz, p.y + 1);
    const gB = ctx.collision.groundY(p.x - fx, p.z - fz, p.y + 1);
    const g = ctx.collision.groundY(p.x, p.z, p.y + 0.8);
    const water = ctx.terrain.waterDepth(p.x, p.z, g);
    p.y = damp(p.y, Math.max(g, (gF + gB) / 2) - Math.min(water, 0.6) * 0.15, 14, dt);
    this.pitch = damp(this.pitch, Math.atan2(gF - gB, len * 2), 8, dt);
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = -this.pitch;
    return water;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
}

export class Horse extends Quadruped {
  constructor(gltf, coat = '#2e2119', name = 'Horse') {
    super(gltf, 'HorseCoat', coat);
    this.name = name;
    this.seat = this.model.getObjectByName('Seat');
    this.stamina = HORSE.staminaMax;
    this.rider = null;
    this.mode = 'idle';      // idle | come | tethered
    this.target = new THREE.Vector3();
    this.inputDir = null;
    this.gallop = false;
    this.idleTime = 0;
  }

  seatWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.seat ? this.seat.getWorldPosition(out) : out.copy(this.root.position).add(_v.set(0, 1.62, 0));
  }

  // dir: desired world heading (x, z) when ridden, or null to stop.
  drive(dir, gallop, back) {
    this.inputDir = dir;
    this.gallop = gallop;
    this.back = back;
  }

  update(dt, ctx) {
    let target = 0;
    if (this.rider) {
      if (this.inputDir) {
        const want = Math.atan2(this.inputDir.x, this.inputDir.z);
        const diff = wrapAngle(want - this.yaw);
        const turn = HORSE.turnRate * (1.2 - Math.min(this.speed, 13) / 22);
        this.yaw += clamp(diff, -turn * dt, turn * dt);
        const canGallop = this.gallop && this.stamina > 2;
        target = canGallop ? HORSE.speeds.gallop : HORSE.speeds.canter;
        if (Math.abs(diff) > 2.2) target = HORSE.speeds.walk;
      } else if (this.back) target = -1.5;
    } else if (this.mode === 'come') {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.2) this.mode = 'idle';
      else {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 3, dt);
        target = d > 30 ? HORSE.speeds.gallop : d > 10 ? HORSE.speeds.canter : HORSE.speeds.walk;
      }
    }
    const rate = target > this.speed ? HORSE.accel : HORSE.brake;
    this.speed = approach(this.speed, target, rate * dt);
    if (this.rider && this.gallop && this.speed > HORSE.speeds.canter + 0.5) {
      this.stamina = Math.max(0, this.stamina - HORSE.gallopDrain * dt);
    } else this.stamina = Math.min(HORSE.staminaMax, this.stamina + HORSE.regen * dt);

    const p = this.position;
    const old = p.clone();
    p.x += Math.sin(this.yaw) * this.speed * dt;
    p.z += Math.cos(this.yaw) * this.speed * dt;
    const pl = ctx.terrain.play;
    p.x = clamp(p.x, -pl, pl);
    p.z = clamp(p.z, -pl, pl);
    // Too steep to climb: refuse to go up
    const gNew = ctx.collision.groundY(p.x, p.z, p.y + 1);
    if (gNew - old.y > Math.max(0.6, this.speed * dt * 1.4) && this.speed > 0) {
      p.x = old.x;
      p.z = old.z;
      this.speed *= 0.5;
    }
    if (ctx.collision.resolve(p, HORSE.radius, 2.2)) this.speed *= 0.96;
    for (const dx of [0.9, -0.9]) {
      // Front and rear of the body too, so the horse doesn't poke through walls
      const fx = Math.sin(this.yaw) * dx;
      const fz = Math.cos(this.yaw) * dx;
      _v.set(p.x + fx, p.y, p.z + fz);
      if (ctx.collision.resolve(_v, 0.5, 2.0)) {
        p.x = _v.x - fx;
        p.z = _v.z - fz;
        this.speed *= 0.9;
      }
    }
    const water = this.settle(dt, ctx, 1.0);
    if (water > 0.7) this.speed = Math.min(this.speed, 4.5);

    // Gait from speed
    const s = Math.abs(this.speed);
    if (s < 0.3) {
      this.idleTime += dt;
      this.play('idle', 0.4);
    } else if (s < 3.6) this.play('walk', 0.3, clamp(s / 2.1, 0.5, 1.6));
    else if (s < 7.5) this.play('trot', 0.3, clamp(s / 5.2, 0.7, 1.4));
    else this.play('gallop', 0.3, clamp(s / 12.5, 0.75, 1.25));
    if (s >= 0.3) this.idleTime = 0;
    this.mixer.update(dt);
  }

  call(to) {
    if (this.rider) return;
    this.mode = 'come';
    this.target.copy(to);
  }
}

export class Deer extends Quadruped {
  constructor(gltf, rand) {
    super(gltf, null, null);
    this.health = 60;
    this.dead = false;
    this.state = 'graze';
    this.timer = rand() * 4;
    this.rand = rand;
    this.fleeDir = new THREE.Vector3();
    this.skinned = false;
    this.home = new THREE.Vector3();
  }

  alarm(from) {
    if (this.dead) return;
    this.state = 'flee';
    this.timer = 7 + this.rand() * 4;
    this.fleeDir.set(this.position.x - from.x, 0, this.position.z - from.z).normalize();
  }

  hit(dmg) {
    if (this.dead) return false;
    this.health -= dmg;
    if (this.health <= 0) {
      this.dead = true;
      this.speed = 0;
      this.play('die', 0.15);
      return true;
    }
    return false;
  }

  update(dt, ctx, player) {
    if (!this.dead) {
      const toP = _v.set(player.x - this.position.x, 0, player.z - this.position.z);
      const dp = toP.length();
      const scare = ctx.playerLoud ? 70 : ctx.playerFast ? 45 : 22;
      if (dp < scare && this.state !== 'flee') this.alarm(player);
      this.timer -= dt;
      let target = 0;
      if (this.state === 'flee') {
        const want = Math.atan2(this.fleeDir.x, this.fleeDir.z);
        this.yaw = dampAngle(this.yaw, want, 2.5, dt);
        target = 11;
        if (this.timer <= 0 && dp > 60) {
          this.state = 'graze';
          this.timer = 3 + this.rand() * 5;
        }
      } else if (this.state === 'walk') {
        target = 1.4;
        if (this.timer <= 0) {
          this.state = 'graze';
          this.timer = 4 + this.rand() * 6;
        }
      } else if (this.timer <= 0) {
        this.state = 'walk';
        this.timer = 2 + this.rand() * 3;
        const back = Math.hypot(this.position.x - this.home.x, this.position.z - this.home.z) > 50;
        this.yaw = back ? Math.atan2(this.home.x - this.position.x, this.home.z - this.position.z)
          : this.yaw + (this.rand() - 0.5) * 2.5;
      }
      this.speed = approach(this.speed, target, (target > this.speed ? 8 : 6) * dt);
      const p = this.position;
      const ox = p.x;
      const oz = p.z;
      p.x += Math.sin(this.yaw) * this.speed * dt;
      p.z += Math.cos(this.yaw) * this.speed * dt;
      const pl = ctx.terrain.play - 10;
      if (Math.abs(p.x) > pl || Math.abs(p.z) > pl) {
        p.x = ox;
        p.z = oz;
        this.fleeDir.multiplyScalar(-1);
        this.yaw += Math.PI;
      }
      ctx.collision.resolve(p, 0.4, 1.4);
      if (this.speed < 0.2) this.play(this.state === 'graze' ? 'graze' : 'idle', 0.5);
      else if (this.speed < 4) this.play('walk', 0.3, clamp(this.speed / 1.3, 0.6, 1.5));
      else this.play('gallop', 0.25, clamp(this.speed / 10, 0.8, 1.3));
    }
    this.settle(dt, ctx, 0.5);
    this.mixer.update(dt);
  }

  rayHit(origin, dir, maxDist) {
    if (this.dead) return null;
    const f = this.forward();
    const p = this.position;
    let best = null;
    const spheres = [[p.x - f.x * 0.3, p.y + 0.82, p.z - f.z * 0.3, 0.26], [p.x + f.x * 0.15, p.y + 0.84, p.z + f.z * 0.15, 0.27],
      [p.x + f.x * 0.55, p.y + 1.05, p.z + f.z * 0.55, 0.16], [p.x + f.x * 0.75, p.y + 1.3, p.z + f.z * 0.75, 0.13]];
    for (const [x, y, z, r] of spheres) {
      const t = raySphere(origin, dir, _v.set(x, y, z), r);
      if (t >= 0 && t < maxDist && (!best || t < best.dist)) {
        best = { dist: t, part: r < 0.15 ? 'head' : 'body', point: origin.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }
}
