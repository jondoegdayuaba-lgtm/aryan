import * as THREE from 'three';
import { MOVE, WEAPONS } from './config.js';
import { lineOfSight } from './map.js';
import { accelerate } from './physics.js';
import { isEnemy, chest } from './combat.js';

// Bot brains: spot enemies with line of sight, swing their aim toward them
// (with human-ish lag and wobble), strafe, jump and slide while shooting, and
// use A* paths on the map grid to hunt or wander when nobody is in view.

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Preferred fighting distance per weapon.
const RANGE = { rifle: 22, smg: 12, shotgun: 6, sniper: 45, rocket: 18, pistol: 15, knife: 0 };

export function initBrain(bot) {
  bot.ai = {
    path: null, pathIdx: 0, repathAt: 0, goal: new THREE.Vector3(),
    target: null, seenAt: -99, firstSeen: -99, lastSeen: new THREE.Vector3(),
    strafe: 1, strafeUntil: 0, scanAt: 0, stuck: 0, lastPos: new THREE.Vector3(),
    phase: Math.random() * 100, burstUntil: 0, pauseUntil: 0, wantJump: false,
    crouchUntil: 0, track: 0,
  };
}

export function updateBot(bot, dt, now, ctx) {
  const ai = bot.ai, skill = ctx.skill, w = WEAPONS[bot.weapon];
  bot.triggerHeld = false;
  bot.wantSlide = false;

  // --- Look for someone to shoot (a few times a second) ---
  if (now >= ai.scanAt) {
    ai.scanAt = now + 0.15 + Math.random() * 0.1;
    bot.eye(_a);
    let best = null, bestScore = Infinity;
    for (const e of ctx.actors) {
      if (!e.alive || !isEnemy(bot, e)) continue;
      chest(e, _b);
      const dist = _a.distanceTo(_b);
      if (dist > 75) continue;
      const toYaw = Math.atan2(-(_b.x - _a.x), -(_b.z - _a.z));
      const facing = Math.abs(angDiff(toYaw, bot.yaw));
      const aware = facing < 1.2 || dist < 10 || bot.lastAttacker === e && now - bot.lastHurt < 2;
      if (!aware) continue;
      if (!lineOfSight(ctx.map.boxes, _a, _b)) {
        e.eye(_c);
        if (!lineOfSight(ctx.map.boxes, _a, _c)) continue;
      }
      const score = dist + facing * 8 + (e === ai.target ? -8 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (best !== ai.target || now - ai.seenAt > 1) {
        ai.firstSeen = now;
        ai.track = 0;
      }
      ai.target = best;
      ai.seenAt = now;
      ai.lastSeen.copy(best.pos);
    } else if (ai.target && (!ai.target.alive || now - ai.seenAt > 0.4)) {
      ai.target = null;
    }
  }
  // Hunt toward whoever hurt us, even from behind.
  if (!ai.target && bot.lastAttacker?.alive && now - bot.lastHurt < 0.3) {
    ai.lastSeen.copy(bot.lastAttacker.pos);
    ai.seenAt = now;
    ai.repathAt = 0;
  }

  const t = ai.target;
  let wishX = 0, wishZ = 0, speed = MOVE.walk;

  if (t && t.alive) {
    // --- Combat ---
    ai.track += dt;
    bot.eye(_a);
    chest(t, _b);
    if (t.height < MOVE.height) _b.y -= 0.1;
    const dx = _b.x - _a.x, dy = _b.y - _a.y, dz = _b.z - _a.z;
    const flat = Math.hypot(dx, dz), dist = Math.hypot(flat, dy);
    // Aim wobble shrinks the longer they track the same target.
    const err = skill.aimError * (1 + 2.2 / (1 + ai.track * 3)) * (1 + Math.min(Math.hypot(t.vel.x, t.vel.z) / 8, 1) * 0.6);
    const wob = now * 2.3 + ai.phase;
    const wantYaw = Math.atan2(-dx, -dz) + Math.sin(wob) * err;
    const wantPitch = Math.atan2(dy, flat) + Math.cos(wob * 1.3) * err * 0.7;
    const turn = skill.turn * dt;
    const dyaw = angDiff(wantYaw, bot.yaw);
    bot.yaw += THREE.MathUtils.clamp(dyaw, -turn, turn);
    bot.pitch += THREE.MathUtils.clamp(wantPitch - bot.pitch, -turn, turn);
    const onTarget = Math.abs(dyaw) < 0.12 + 1 / Math.max(dist, 1) && Math.abs(wantPitch - bot.pitch) < 0.15;

    // Short bursts with pauses, like a person would.
    if (now > ai.burstUntil && now > ai.pauseUntil) {
      ai.burstUntil = now + 0.3 + Math.random() * 0.9 * skill.burst;
      ai.pauseUntil = ai.burstUntil + 0.15 + (1 - skill.burst) * Math.random() * 0.8;
    }
    const inBurst = now < ai.burstUntil || w.melee || dist < 8;
    const inRange = w.melee ? dist < w.range + 0.3 : dist < w.range * 0.9;
    if (now - ai.firstSeen > skill.reaction && onTarget && inBurst && inRange) bot.triggerHeld = true;

    // Strafe around the preferred range.
    if (now > ai.strafeUntil) {
      ai.strafe = Math.random() < 0.5 ? -1 : 1;
      ai.strafeUntil = now + 0.5 + Math.random() * 1.4;
      if (Math.random() < 0.18 && bot.onGround) ai.wantJump = true;
      if (Math.random() < 0.12) ai.crouchUntil = now + 0.8;
    }
    const fx = dx / (flat || 1), fz = dz / (flat || 1);
    const pref = RANGE[bot.weapon] ?? 15;
    const approach = flat > pref + 4 ? 1 : flat < pref - 4 ? -0.6 : 0;
    wishX = fx * approach + -fz * ai.strafe * 0.9;
    wishZ = fz * approach + fx * ai.strafe * 0.9;
    if ((bot.weapon === 'shotgun' || w.melee) && flat > 4 && flat < 12 && bot.onGround && Math.random() < 0.02) bot.wantSlide = true;
    if (w.melee || bot.weapon === 'shotgun') {
      // Rush in, ignoring the strafing.
      wishX = fx; wishZ = fz;
      if (flat > 3) ai.path = null;
    }
    ai.path = null;
    // Steer around obstacles toward the target if we bumped into something.
    if (ai.stuck > 0.3) ai.wantJump = true;
  } else {
    // --- Roam: chase the last place an enemy was seen, or wander/hunt ---
    if (!ai.path || ai.pathIdx >= ai.path.length || now > ai.repathAt) {
      if (now - ai.seenAt < 5) ai.goal.copy(ai.lastSeen);
      else if (Math.random() < 0.55) {
        const enemies = ctx.actors.filter((e) => e.alive && isEnemy(bot, e));
        if (enemies.length) ai.goal.copy(enemies[(Math.random() * enemies.length) | 0].pos);
        else ctx.map.nav.randomPoint(ai.goal);
      } else ctx.map.nav.randomPoint(ai.goal);
      ai.path = ctx.map.nav.findPath(bot.pos, ai.goal);
      ai.pathIdx = 0;
      ai.repathAt = now + 3 + Math.random() * 3;
      if (!ai.path) ai.repathAt = now + 0.5;
    }
    if (ai.path && ai.pathIdx < ai.path.length) {
      let wp = ai.path[ai.pathIdx];
      // Skip ahead along the path when we've reached a waypoint.
      while (Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z) < 0.9 && ai.pathIdx < ai.path.length - 1) wp = ai.path[++ai.pathIdx];
      if (Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z) < 0.9) ai.pathIdx++;
      // Look a few cells ahead for smoother turns.
      const look = ai.path[Math.min(ai.pathIdx + 3, ai.path.length - 1)];
      const dx = wp.x - bot.pos.x, dz = wp.z - bot.pos.z, d = Math.hypot(dx, dz) || 1;
      wishX = dx / d; wishZ = dz / d;
      const wantYaw = Math.atan2(-(look.x - bot.pos.x), -(look.z - bot.pos.z));
      bot.yaw += THREE.MathUtils.clamp(angDiff(wantYaw, bot.yaw), -6 * dt, 6 * dt);
      bot.pitch *= 1 - Math.min(dt * 4, 1);
      if (wp.y > bot.pos.y + MOVE.stepUp + 0.05 && bot.onGround) ai.wantJump = true;
    }
    if (ai.stuck > 0.5) ai.wantJump = true;
    if (ai.stuck > 1.5) { ai.path = null; ai.stuck = 0; }
    // Reload during quiet moments.
    const am = bot.ammo[bot.weapon];
    if (am && am.mag < w.mag * 0.4 && am.reserve > 0) bot.wantReload = true;
  }

  // Stuck detection
  const moved = Math.hypot(bot.pos.x - ai.lastPos.x, bot.pos.z - ai.lastPos.z);
  if ((wishX || wishZ) && moved < 1.2 * dt) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
  ai.lastPos.copy(bot.pos);

  const len = Math.hypot(wishX, wishZ);
  if (len > 1) { wishX /= len; wishZ /= len; }
  bot.crouching = now < ai.crouchUntil && !!t;
  if (bot.crouching) speed = MOVE.crouchWalk;
  accelerate(bot, wishX, wishZ, speed, dt);
  if (ai.wantJump && bot.onGround) {
    bot.vel.y = MOVE.jump;
    bot.onGround = false;
  }
  ai.wantJump = false;
}
