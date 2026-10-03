// Bullet traces and damage, for the player and for outlaws shooting back.
import * as THREE from 'three';
import { clamp } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
  }

  // Nearest thing a bullet hits: world, an NPC or an animal.
  trace(origin, dir, range, shooter) {
    const g = this.game;
    const w = g.collision.raycast(origin, dir, range);
    let best = w ? { point: w.point, dist: w.dist, kind: w.kind, normal: w.normal } : null;
    let maxD = best ? best.dist : range;
    for (const n of g.npcs) {
      if (n.dead || n === shooter || !n.char.root.visible) continue;
      if (n.pos.distanceToSquared(origin) > (maxD + 3) * (maxD + 3)) continue;
      const h = n.char.rayHit(origin, dir, maxD);
      if (h && h.dist < maxD) {
        maxD = h.dist;
        best = { point: h.point, dist: h.dist, kind: 'npc', target: n, part: h.part };
      }
    }
    for (const a of g.animals) {
      if (a.dead) continue;
      if (a.position.distanceToSquared(origin) > (maxD + 3) * (maxD + 3)) continue;
      const h = a.rayHit(origin, dir, maxD);
      if (h && h.dist < maxD) {
        maxD = h.dist;
        best = { point: h.point, dist: h.dist, kind: 'animal', target: a, part: h.part };
      }
    }
    return best;
  }

  applyPlayerHit(hit, spec, dir) {
    const g = this.game;
    if (!hit) return;
    if (hit.kind === 'npc') {
      const mult = hit.part === 'head' ? spec.headMult : hit.part === 'legs' || hit.part === 'arms' ? 0.65 : 1;
      const killed = hit.target.damage(spec.damage * mult, hit.part, dir);
      g.effects.impact(hit.point, dir.clone().negate(), 'blood');
      g.hud.hitmarker(killed);
      if (killed) {
        g.stats.kills++;
        if (hit.part === 'head') g.stats.headshots++;
        g.player.deadEye = Math.min(100, g.player.deadEye + 12);
      }
      g.stats.hits++;
    } else if (hit.kind === 'animal') {
      const killed = hit.target.hit(spec.damage * (hit.part === 'head' ? 2 : 1));
      g.effects.impact(hit.point, dir.clone().negate(), 'blood');
      g.hud.hitmarker(killed);
      if (killed) {
        g.stats.hunted++;
        g.events.emit('animalKilled', hit.target);
      } else hit.target.alarm(g.player.pos);
    } else {
      g.effects.impact(hit.point, hit.normal, hit.kind === 'ground' ? 'ground' : 'wood');
    }
  }

  // An outlaw fires at the player. Hit chance falls with distance and with
  // how fast the player is moving.
  npcShoot(npc) {
    const g = this.game;
    const p = g.player;
    if (p.dead) return;
    const muzzle = npc.char.muzzle(new THREE.Vector3());
    const target = _v.copy(p.pos).add(_v2.set(0, p.mounted ? 2.1 : 1.35, 0));
    const toT = target.clone().sub(muzzle);
    const dist = toT.length();
    toT.normalize();
    const rifle = npc.weapon === 'rifle';
    g.effects.muzzle(muzzle, toT, rifle);
    const camD = g.camera.position.distanceTo(muzzle);
    const rel = muzzle.clone().sub(g.camera.position).normalize();
    const pan = clamp(rel.dot(g.camRig.right(new THREE.Vector3())), -1, 1);
    g.audio.shot(npc.weapon, camD, pan);
    // Something in the way?
    const block = g.collision.raycast(muzzle, toT, dist - 0.5);
    let chance = npc.accuracy * clamp(1.25 - dist / 45, 0.25, 1.1);
    const sp = p.speed;
    chance *= sp > 8 ? 0.45 : sp > 3 ? 0.7 : 1;
    if (p.deadEyeOn) chance *= 0.35;
    if (g.difficultyEase) chance *= g.difficultyEase;
    if (block) {
      g.effects.impact(block.point, block.normal, block.kind === 'ground' ? 'ground' : 'wood');
      g.effects.tracer(muzzle, block.point);
      return;
    }
    if (Math.random() < chance) {
      const dmg = (rifle ? 15 : 9) + Math.random() * 6;
      p.hurt(dmg, npc.pos);
      g.effects.tracer(muzzle, target);
    } else {
      // Miss: kick up dirt near the player and whiz past
      const miss = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 3));
      const d2 = miss.clone().sub(muzzle).normalize();
      const end = g.collision.raycast(muzzle, d2, dist + 25);
      const endPoint = end ? end.point : muzzle.clone().addScaledVector(d2, dist + 25);
      if (end) g.effects.impact(end.point, end.normal, end.kind === 'ground' ? 'ground' : 'wood');
      g.effects.tracer(muzzle, endPoint);
      if (Math.random() < 0.6) g.audio.whiz(-pan * 0.5);
    }
  }
}
