// Shooting, projectiles, explosions and harvesting.
import * as THREE from 'three';
import { HARVEST, RARITIES, MAX_MATS } from './config.js';
import { WEAPONS, weaponDamage } from './items.js';
import { RayHit } from './physics.js';
import { clamp, lerp } from './util.js';

const _dir = new THREE.Vector3();
const _o = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Vector3();

function randomCone(dir, angle, out) {
  if (angle <= 0) return out.copy(dir);
  // uniform-ish within a cone
  const u = Math.random(), v = Math.random();
  const theta = angle * Math.sqrt(u);
  const phi = v * Math.PI * 2;
  const t = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(dir, t).normalize();
  const b = new THREE.Vector3().crossVectors(dir, a);
  return out.copy(dir).multiplyScalar(Math.cos(theta))
    .addScaledVector(a, Math.sin(theta) * Math.cos(phi))
    .addScaledVector(b, Math.sin(theta) * Math.sin(phi)).normalize();
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.hit = new RayHit();
    this.hit2 = new RayHit();
  }

  spreadFor(actor, def) {
    const it = actor.intent;
    let s = it.ads ? def.adsSpread : def.spread;
    const speed = Math.hypot(actor.vel.x, actor.vel.z);
    s += def.moveSpread * clamp(speed / 6, 0, 1.2);
    if (!actor.grounded && !actor.swimming) s += 0.06;
    if (it.crouch) s *= 0.7;
    s += actor.bloom;
    return s;
  }

  // Where the actor is aiming: a camera ray for the player, the eye ray for bots.
  aim(actor) {
    const it = actor.intent;
    const eye = actor.eye(new THREE.Vector3());
    if (it.aimOrigin && it.aimDir) {
      // start the camera ray level with the actor so we never hit things behind them
      const t = Math.max(0, _m.subVectors(eye, it.aimOrigin).dot(it.aimDir));
      const o = it.aimOrigin.clone().addScaledVector(it.aimDir, t);
      return { origin: o, dir: it.aimDir.clone(), eye, fromCamera: true };
    }
    const d = new THREE.Vector3(Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), Math.cos(actor.yaw) * Math.cos(actor.pitch));
    return { origin: eye.clone(), dir: d, eye, fromCamera: false };
  }

  fire(actor, w) {
    const g = this.game;
    const def = WEAPONS[w.id];
    const aim = this.aim(actor);
    const spread = this.spreadFor(actor, def);
    const pellets = def.pellets || 1;
    const muzzle = actor.model.muzzleWorld(new THREE.Vector3());
    // guard against a muzzle poking through a wall right in front of us
    const gunO = actor.eye(new THREE.Vector3());
    const dmg = weaponDamage(w);
    const opts = { actors: g.actors, ignoreActor: actor, water: true };
    for (let p = 0; p < pellets; p++) {
      randomCone(aim.dir, spread, _dir);
      if (def.projectile) {
        // find the aim point, then launch from the muzzle toward it
        const h = g.physics.raycast(aim.origin, _dir, def.range, opts, this.hit);
        const target = h.kind !== 'none' ? h.point.clone() : aim.origin.clone().addScaledVector(_dir, def.range);
        const d = target.clone().sub(muzzle).normalize();
        this.spawnProjectile(actor, w, muzzle.clone(), d, def);
        continue;
      }
      let h = g.physics.raycast(aim.origin, _dir, def.range, opts, this.hit);
      let end = h.kind !== 'none' ? _t.copy(h.point) : _t.copy(aim.origin).addScaledVector(_dir, def.range);
      if (aim.fromCamera) {
        // check the line from the gun to that point
        _o.subVectors(end, gunO);
        const len = _o.length();
        if (len > 0.5) {
          _o.divideScalar(len);
          const h2 = g.physics.raycast(gunO, _o, len - 0.1, opts, this.hit2);
          if (h2.kind !== 'none') { h = h2; end = _t.copy(h2.point); }
        }
      }
      const dist = aim.origin.distanceTo(end);
      if (h.kind !== 'none') this.applyHit(actor, h, def, w, dmg, dist);
      if (g.effects) g.effects.tracer(muzzle, end, def.id, h.kind !== 'none' ? h : null, actor.isPlayer || p === 0);
    }
    if (g.effects) g.effects.muzzleFlash(muzzle, aim.dir, def.id);
    if (g.onFire) g.onFire(actor, w, def, muzzle);
  }

  falloff(def, dist) {
    if (!def.falloff) return 1;
    const [a, b, min] = def.falloff;
    if (dist <= a) return 1;
    if (dist >= b) return min;
    return lerp(1, min, (dist - a) / (b - a));
  }

  applyHit(actor, h, def, w, dmg, dist) {
    const g = this.game;
    const f = this.falloff(def, dist);
    if (h.kind === 'actor') {
      const target = h.actor;
      const mult = h.head ? def.head : 1;
      const amount = Math.round(dmg * f * mult);
      const dealt = target.takeDamage(amount, actor, { head: h.head, weapon: def.id, point: h.point });
      actor.damageDealt += dealt;
      if (g.onHitConfirm) g.onHitConfirm(actor, target, amount, h.head, h.point, target.shield > 0);
    } else if (h.kind === 'collider') {
      const c = h.collider;
      const amount = Math.round(dmg * f * (def.structure ?? 1));
      if (c.kind === 'piece') {
        g.pieces.damage(c.owner, amount, actor);
        if (g.onStructureHit) g.onStructureHit(actor, c.owner, amount, h);
      } else if (c.kind === 'prop') {
        g.props.damage(c.owner, amount * 0.5);
      }
      if (g.effects) g.effects.impact(h.point, h.normal, c.kind === 'piece' ? c.owner.mat : c.owner.mat || 'stone');
    } else if (h.kind === 'terrain') {
      if (g.effects) g.effects.impact(h.point, h.normal, 'dirt');
    } else if (h.kind === 'water') {
      if (g.effects) g.effects.splash(h.point);
    }
  }

  // ------------------------------------------------------------------ grenades
  throwGrenade(actor, def) {
    const g = this.game;
    const aim = this.aim(actor);
    const start = actor.eye(new THREE.Vector3()).addScaledVector(actor.forward(new THREE.Vector3()), 0.4);
    const vel = aim.dir.clone().multiplyScalar(19);
    vel.y += 4.5;
    vel.add(actor.vel.clone().multiplyScalar(0.5));
    const mesh = g.assets.flat('Grenade', { shadows: true });
    mesh.scale.setScalar(1.3);
    mesh.position.copy(start);
    g.scene.add(mesh);
    this.grenades = this.grenades || [];
    this.grenades.push({ actor, def, pos: start, vel, t: def.fuse, mesh, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0) });
    if (g.onThrow) g.onThrow(actor);
  }

  updateGrenades(dt) {
    if (!this.grenades) return;
    const g = this.game;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const n = this.grenades[i];
      n.t -= dt;
      n.vel.y -= 20 * dt;
      const step = n.vel.length() * dt;
      if (step > 1e-4) {
        _dir.copy(n.vel).normalize();
        const h = g.physics.raycast(n.pos, _dir, step + 0.08, { water: true }, this.hit);
        if (h.kind !== 'none') {
          n.pos.copy(h.point).addScaledVector(h.normal, 0.08);
          // bounce
          const vn = n.vel.dot(h.normal);
          n.vel.addScaledVector(h.normal, -1.6 * vn).multiplyScalar(0.45);
          if (h.kind === 'water') n.vel.multiplyScalar(0.2);
          if (Math.abs(vn) > 2 && g.audio) g.audio.footstep(n.pos, false, 'metal', 2);
        } else n.pos.addScaledVector(n.vel, dt);
      }
      n.mesh.position.copy(n.pos);
      n.mesh.rotation.x += n.spin.x * dt * Math.min(1, n.vel.length() / 5);
      n.mesh.rotation.y += n.spin.y * dt * Math.min(1, n.vel.length() / 5);
      if (n.t <= 0) {
        g.scene.remove(n.mesh);
        this.grenades.splice(i, 1);
        this.explode(n.pos, n.def.radius, n.def.dmg, n.def.structure, n.actor);
      }
    }
  }

  // ------------------------------------------------------------------ projectiles
  spawnProjectile(actor, w, pos, dir, def) {
    const g = this.game;
    let mesh = null;
    if (def.id === 'rocket') {
      mesh = g.assets.flat('Projectile_Rocket', { shadows: false });
      mesh.lookAt(mesh.position.clone().sub(dir)); // model nose points +Z after export
    }
    const p = { actor, w, def, pos, vel: dir.clone().multiplyScalar(def.projectile.speed), grav: def.projectile.gravity,
      life: def.id === 'rocket' ? 8 : 3, mesh, dmg: weaponDamage(w), travelled: 0, trailT: 0 };
    if (mesh) { mesh.position.copy(pos); g.scene.add(mesh); }
    this.projectiles.push(p);
  }

  update(dt) {
    const g = this.game;
    this.updateGrenades(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      const step = p.vel.length() * dt;
      _dir.copy(p.vel).normalize();
      const h = g.physics.raycast(p.pos, _dir, step, { actors: g.actors, ignoreActor: p.travelled < 3 ? p.actor : null, water: true }, this.hit);
      const prev = p.pos.clone();
      if (h.kind !== 'none') {
        p.pos.copy(h.point);
        if (p.def.splash) this.explode(h.point, p.def.splash, p.dmg, p.def.structure, p.actor);
        else this.applyHit(p.actor, h, p.def, p.w, p.dmg, p.travelled + h.dist);
        if (g.effects && p.def.id === 'sniper') g.effects.tracer(prev, h.point, 'sniper', h, true);
        this.removeProjectile(i);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      p.travelled += step;
      if (g.effects) {
        if (p.def.id === 'sniper') g.effects.tracer(prev, p.pos, 'sniper', null, true);
        else if (p.def.id === 'rocket') { p.trailT -= dt; if (p.trailT <= 0) { p.trailT = 0.02; g.effects.rocketTrail(p.pos); } }
      }
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        p.mesh.lookAt(_m.copy(p.pos).sub(_dir));
      }
      if (p.life <= 0 || p.pos.y < -20) {
        if (p.def.splash && p.life <= 0) this.explode(p.pos, p.def.splash, p.dmg, p.def.structure, p.actor);
        this.removeProjectile(i);
      }
    }
  }

  removeProjectile(i) {
    const p = this.projectiles[i];
    if (p.mesh) this.game.scene.remove(p.mesh);
    this.projectiles.splice(i, 1);
  }

  explode(pos, radius, dmg, structMult, source) {
    const g = this.game;
    if (g.effects) g.effects.explosion(pos, radius);
    if (g.onExplosion) g.onExplosion(pos, radius, source);
    for (const a of g.actors) {
      if (!a.alive || !a.hittable) continue;
      const d = a.chest(new THREE.Vector3()).distanceTo(pos);
      if (d > radius + 0.5) continue;
      const f = clamp(1 - d / (radius + 0.5), 0.2, 1);
      const amount = Math.round(dmg * f * (a === source ? 0.5 : 1));
      const dealt = a.takeDamage(amount, source, { explosion: true, weapon: 'rocket', point: pos });
      if (a !== source && source) { source.damageDealt += dealt; if (g.onHitConfirm) g.onHitConfirm(source, a, amount, false, a.chest(new THREE.Vector3()), a.shield > 0); }
    }
    const list = g.physics.queryBox(pos.x - radius, pos.y - radius, pos.z - radius, pos.x + radius, pos.y + radius, pos.z + radius, []);
    const seen = new Set();
    for (const c of list) {
      if (seen.has(c.owner)) continue;
      seen.add(c.owner);
      if (c.kind === 'piece') g.pieces.damage(c.owner, dmg * structMult, source);
      else if (c.kind === 'prop') g.props.damage(c.owner, dmg * 2);
    }
  }

  // ------------------------------------------------------------------ harvesting
  harvestHit(actor) {
    const g = this.game;
    const aim = this.aim(actor);
    const eye = actor.eye(new THREE.Vector3());
    // short ray from the eye along the aim (use the camera ray's direction for the player)
    const h = g.physics.raycast(eye, aim.dir, HARVEST.range, { actors: g.actors, ignoreActor: actor, soft: true, terrain: true }, this.hit);
    let target = h;
    if (h.kind === 'none' || h.kind === 'terrain') {
      // forgiving: try a flatter ray at chest height
      const d = actor.forward(new THREE.Vector3());
      const h2 = g.physics.raycast(actor.chest(new THREE.Vector3()), d, HARVEST.range, { actors: g.actors, ignoreActor: actor, soft: true }, this.hit2);
      if (h2.kind !== 'none') target = h2;
    }
    if (target.kind === 'none') return;
    if (target.kind === 'actor') {
      target.actor.takeDamage(20, actor, { weapon: 'pickaxe', point: target.point });
      actor.damageDealt += 20;
      if (g.onHitConfirm) g.onHitConfirm(actor, target.actor, 20, false, target.point, target.actor.shield > 0);
      return;
    }
    if (target.kind !== 'collider') { if (g.effects) g.effects.impact(target.point, target.normal, 'dirt'); return; }
    const c = target.collider;
    const o = c.owner;
    let mat = o.mat;
    let gain = 0;
    const weak = actor.isPlayer && g.weakPoint && g.weakPoint.check(target.point, o);
    const dmg = weak ? HARVEST.weakDamage : HARVEST.damage;
    if (c.kind === 'piece') {
      // house pieces give materials; player builds don't
      if (o.house) gain = Math.round(HARVEST.yield[mat] * (weak ? 1.5 : 1));
      g.pieces.damage(o, dmg, actor);
    } else if (c.kind === 'prop') {
      if (o.harvest) gain = Math.round(HARVEST.yield[mat] * (weak ? 1.5 : 1));
      g.props.damage(o, dmg, { harvest: true });
    }
    if (gain > 0) {
      const before = actor.inv.mats[mat];
      actor.inv.mats[mat] = Math.min(MAX_MATS, before + gain);
      actor.matsGathered += actor.inv.mats[mat] - before;
      if (g.onHarvest) g.onHarvest(actor, mat, actor.inv.mats[mat] - before, target.point, weak);
    }
    if (g.effects) g.effects.impact(target.point, target.normal, mat, true);
    if (g.onHarvestHit) g.onHarvestHit(actor, mat, target.point, o, weak, target.normal);
  }
}

export { RARITIES };
