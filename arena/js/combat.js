import * as THREE from 'three';
import { WEAPONS, MOVE, PLAYER } from './config.js';
import { rayBoxes, lineOfSight, pointInBoxes } from './map.js';
import { rocketMesh, grenadeMesh } from './effects.js';

// Shooting, damage, rockets, grenades and explosions, shared by the player and bots.

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
const HEAD = 0.44;

function rayAabb(o, d, minX, minY, minZ, maxX, maxY, maxZ, maxT) {
  let tmin = 0, tmax = maxT;
  const lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ];
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) {
      if (oo[a] < lo[a] || oo[a] > hi[a]) return Infinity;
      continue;
    }
    let t1 = (lo[a] - oo[a]) / dd[a], t2 = (hi[a] - oo[a]) / dd[a];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export const isEnemy = (a, b) => a !== b && a.team !== b.team;

export function chest(actor, out) {
  return out.set(actor.pos.x, actor.pos.y + actor.height * 0.6, actor.pos.z);
}

export class Combat {
  constructor({ scene, map, fx, sound, actors, listener }) {
    this.scene = scene;
    this.map = map;
    this.fx = fx;
    this.sound = sound;
    this.actors = actors;
    this.listener = listener;    // () => { pos, yaw } of the player's ears
    this.projectiles = [];
    this.onKill = null;          // (victim, killer, weaponId, headshot)
    this.onHit = null;           // (attacker, victim, damage, headshot, killed)
    this.now = 0;
  }

  // Volume and pan for a sound played at a world position.
  hear(pos) {
    const l = this.listener();
    const dx = pos.x - l.pos.x, dz = pos.z - l.pos.z;
    const dist = Math.hypot(dx, dz, pos.y - l.pos.y);
    const vol = 1 / (1 + dist * 0.07);
    const right = dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw);
    return [vol, dist > 0.5 ? (right / dist) * 0.8 : 0];
  }

  // Ray against every enemy's head and body boxes.
  rayActors(shooter, o, d, maxT) {
    let best = maxT, hitActor = null, head = false;
    for (const a of this.actors) {
      if (!a.alive || !isEnemy(shooter, a)) continue;
      const p = a.pos, h = a.height;
      const tb = rayAabb(o, d, p.x - 0.36, p.y, p.z - 0.36, p.x + 0.36, p.y + h - HEAD, p.z + 0.36, best);
      if (tb < best) { best = tb; hitActor = a; head = false; }
      const th = rayAabb(o, d, p.x - 0.25, p.y + h - HEAD, p.z - 0.25, p.x + 0.25, p.y + h + 0.06, p.z + 0.25, best);
      if (th < best) { best = th; hitActor = a; head = true; }
    }
    return hitActor ? { actor: hitActor, t: best, head } : null;
  }

  // Fires the actor's current weapon. origin/dir: the aim ray (eye and look direction).
  // muzzle: where tracers and rockets start. spread: cone in radians.
  fire(actor, origin, dir, muzzle, spread) {
    const id = actor.weapon, w = WEAPONS[id];
    const [vol, pan] = actor.isPlayer ? [1, 0] : this.hear(origin);
    this.sound.shot(w.sound, vol, pan);

    if (w.melee) {
      let target = null, bestD = Infinity;
      for (const a of this.actors) {
        if (!a.alive || !isEnemy(actor, a)) continue;
        chest(a, _v);
        const dist = _v.distanceTo(origin);
        if (dist > w.range + 0.5) continue;
        _w.subVectors(_v, origin).normalize();
        if (_w.dot(dir) < 0.75) continue;
        if (!lineOfSight(this.map.boxes, origin, _v)) continue;
        if (dist < bestD) { bestD = dist; target = a; }
      }
      if (target) {
        chest(target, _v);
        this.fx.hitPuff(_v, target.color);
        this.damage(target, w.dmg, actor, id, false, origin);
      }
      return;
    }

    _right.crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    _up.crossVectors(_right, dir).normalize();

    if (w.projectile) {
      _d.copy(dir).addScaledVector(_right, (Math.random() - 0.5) * spread).addScaledVector(_up, (Math.random() - 0.5) * spread).normalize();
      // Aim the rocket from the muzzle at whatever the crosshair is on.
      const wallT = rayBoxes(this.map.boxes, origin, dir, w.range);
      const aimPoint = _e.copy(origin).addScaledVector(_d, Math.min(wallT, w.range));
      const vel = new THREE.Vector3().subVectors(aimPoint, muzzle).normalize().multiplyScalar(w.speed);
      if (wallT < 2) vel.copy(_d).multiplyScalar(w.speed);
      const mesh = rocketMesh();
      mesh.position.copy(muzzle);
      mesh.lookAt(_v.copy(muzzle).sub(vel));
      this.scene.add(mesh);
      this.projectiles.push({ kind: 'rocket', owner: actor, weapon: id, pos: muzzle.clone(), vel, life: 5, mesh });
      return;
    }

    const pellets = w.pellets || 1;
    const hits = new Map();
    for (let i = 0; i < pellets; i++) {
      const r = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
      _d.copy(dir).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      const wallT = rayBoxes(this.map.boxes, origin, _d, w.range, _n);
      const floorT = _d.y < -1e-6 ? -origin.y / _d.y : Infinity;
      const envT = Math.min(wallT, floorT);
      const hit = this.rayActors(actor, origin, _d, Math.min(envT, w.range));
      const t = hit ? hit.t : Math.min(envT, w.range);
      _e.copy(origin).addScaledVector(_d, t);
      if (i < 3) this.fx.tracer(muzzle, _e);
      if (hit) {
        this.fx.hitPuff(_e, hit.actor.color);
        let dmg = w.dmg * (hit.head ? w.head : 1);
        if (w.falloff && t > w.falloff) dmg *= THREE.MathUtils.clamp(1 - (t - w.falloff) / (w.falloff * 2), 0.45, 1);
        const prev = hits.get(hit.actor) || { dmg: 0, head: false };
        hits.set(hit.actor, { dmg: prev.dmg + dmg, head: prev.head || hit.head });
      } else if (envT < w.range) {
        if (floorT < wallT) _n.set(0, 1, 0);
        this.fx.sparks(_e, _n, 0xffe2a0, pellets > 1 ? 2 : 5);
      }
    }
    for (const [victim, h] of hits) this.damage(victim, Math.round(h.dmg), actor, id, h.head, origin);
  }

  throwGrenade(actor, origin, dir) {
    const mesh = grenadeMesh();
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 4, 0)).add(_v.copy(actor.vel).multiplyScalar(0.5));
    this.projectiles.push({ kind: 'grenade', owner: actor, weapon: 'grenade', pos: origin.clone(), vel, life: 2.2, mesh });
    this.sound.throwNade();
  }

  damage(victim, amount, attacker, weaponId, head, fromPos) {
    if (!victim.alive || this.now < victim.protectUntil) return;
    victim.health -= amount;
    victim.lastHurt = this.now;
    victim.lastAttacker = attacker;
    victim.lastHurtFrom = fromPos.clone();
    const killed = victim.health <= 0;
    this.onHit?.(attacker, victim, amount, head, killed);
    if (killed) this.kill(victim, attacker, weaponId, head);
  }

  kill(victim, killer, weaponId, head) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.now + PLAYER.respawnTime;
    victim.triggerHeld = false;
    this.fx.shatter(victim.pos, [victim.color, 0x2d3140, 0xf1c27d]);
    if (killer && killer !== victim) {
      killer.kills++;
      killer.streak++;
    }
    this.onKill?.(victim, killer, weaponId, head);
  }

  explode(pos, owner, weaponId, radius, dmg) {
    this.fx.explosion(pos, radius);
    const [vol, pan] = this.hear(pos);
    this.sound.explosion(vol, pan);
    for (const a of this.actors) {
      if (!a.alive) continue;
      const self = a === owner;
      if (!self && !isEnemy(owner, a)) continue;
      chest(a, _v);
      const dist = _v.distanceTo(pos);
      if (dist > radius) continue;
      if (!lineOfSight(this.map.boxes, pos, _v)) continue;
      const k = 1 - dist / radius;
      // Knockback (rocket jumps!)
      _w.subVectors(_v, pos).normalize();
      _w.y = Math.max(_w.y, 0.35);
      a.vel.addScaledVector(_w.normalize(), 16 * k);
      a.onGround = false;
      const amount = Math.round(dmg * (0.25 + 0.75 * k) * (self ? 0.35 : 1));
      this.damage(a, amount, owner, weaponId, false, pos);
    }
  }

  update(dt, now) {
    this.now = now;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let boom = p.life <= 0;
      if (p.kind === 'rocket') {
        const step = p.vel.length() * dt;
        _d.copy(p.vel).normalize();
        const wallT = rayBoxes(this.map.boxes, p.pos, _d, step);
        const floorT = _d.y < 0 ? -p.pos.y / _d.y : Infinity;
        const hit = this.rayActors(p.owner, p.pos, _d, Math.min(wallT, floorT, step));
        const t = Math.min(wallT, floorT, step, hit ? hit.t : Infinity);
        p.pos.addScaledVector(_d, t);
        if (t < step) { boom = true; p.pos.addScaledVector(_d, -0.15); }
        if (hit && t === hit.t) boom = true;
        p.mesh.position.copy(p.pos);
        if (Math.random() < 0.7) this.fx.sparks(p.pos, null, 0xcccccc, 1);
      } else {
        p.vel.y -= MOVE.gravity * 0.9 * dt;
        for (const axis of ['x', 'y', 'z']) {
          const old = p.pos[axis];
          p.pos[axis] += p.vel[axis] * dt;
          if (pointInBoxes(this.map.boxes, p.pos, 0.1) || (axis === 'y' && p.pos.y < 0.11)) {
            p.pos[axis] = old;
            p.vel[axis] *= -0.4;
            p.vel.multiplyScalar(0.8);
          }
        }
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.x += dt * p.vel.length();
      }
      if (boom) {
        const w = WEAPONS[p.weapon];
        if (p.kind === 'rocket') this.explode(p.pos, p.owner, p.weapon, w.splash, w.dmg);
        else this.explode(p.pos, p.owner, 'grenade', 5.5, 120);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }
}
