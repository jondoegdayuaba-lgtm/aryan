// AI drivers. Each bot reads the game state and fills in the same controls a
// player would. Difficulty sets speed, boost use, reaction time, aim and which
// moves it knows (jumps, flips, aerials).
import * as THREE from 'three';
import { DIFFICULTY, PHYSICS as P } from './config.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();

function emptyControls() {
  return { throttle: 0, steer: 0, pitch: 0, roll: 0, jump: false, jumpPressed: false, boost: false, slide: false };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Bot {
  constructor(car, difficulty) {
    this.car = car;
    this.skill = DIFFICULTY[difficulty];
    this.planTimer = 0;
    this.target = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.mode = 'attack';
    this.seq = null;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.error = 0;
  }

  reset() {
    this.seq = null;
    this.planTimer = 0;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
  }

  think(game, dt) {
    const car = this.car;
    const c = emptyControls();
    const sk = this.skill;
    const ball = game.ball;
    const ownZ = car.team === 'blue' ? game.arena.HZ : -game.arena.HZ;
    const attack = -Math.sign(ownZ); // direction of the opponent's goal along Z

    this.planTimer -= dt;
    if (this.planTimer <= 0) {
      this.planTimer = sk.reaction;
      this.plan(game, ownZ, attack);
    }

    // A jump, flip or aerial in progress takes over
    if (this.seq) return this.runSequence(game, c, dt);

    if (!car.grounded) {
      this.recover(c);
      return c;
    }

    // Steer towards the target on whatever surface we're on
    _d.subVectors(this.target, car.pos);
    _d.addScaledVector(car.up, -_d.dot(car.up));
    const dist = _d.length();
    const angle = Math.atan2(_d.dot(car.right), _d.dot(car.fwd));
    const speed = car.vel.dot(car.fwd);
    c.steer = clamp(angle * 2.6, -1, 1);
    c.throttle = sk.throttle;
    if (this.mode === 'support' && dist < 6) c.throttle = clamp(dist / 6, 0, 1) * sk.throttle;
    if (Math.abs(angle) > 1.7 && speed > 10) { c.throttle = 0.3; c.slide = true; }
    const wantSpeed = this.mode === 'support' ? 14 : P.maxCarSpeed;
    c.boost = (game.kickoffLive && sk.boost > 0.5)
      || (Math.abs(angle) < 0.35 && dist > 7 && speed < wantSpeed - 1 && car.boost > 0 && Math.random() < sk.boost);

    // Unstick: reverse out if pinned against something
    if (Math.abs(speed) < 1 && !game.frozen) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 1.2) { this.reverseTimer = 0.7; this.stuckTimer = 0; }
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      c.throttle = -1; c.steer = -c.steer; c.boost = false;
      return c;
    }

    // Jump shots, flips into the ball, aerials
    _t.subVectors(ball.pos, car.pos);
    const hd = Math.hypot(_t.x, _t.z);
    const ballAngle = Math.atan2(_t.dot(car.right), _t.dot(car.fwd));
    const facing = Math.abs(ballAngle) < 0.35;
    const goodSide = (ball.pos.z - car.pos.z) * attack > -1 || this.mode === 'clear';
    const onFloor = car.up.y > 0.9;
    if (onFloor && facing && goodSide && this.mode !== 'support') {
      const flipRange = 2.4 + Math.max(0, speed) * 0.12;
      if (game.kickoffLive && sk.kickoffFlip && hd < 4 + speed * 0.12) {
        this.startSeq('flip', ballAngle);
      } else if (sk.aerials && car.boost > 25 && ball.pos.y > 4.5 && hd < ball.pos.y * 1.3 && hd > 2) {
        this.startSeq('aerial', 0);
      } else if (sk.jumps && ball.pos.y > 1.7 && ball.pos.y < 3.8 && hd < 2.2 + ball.pos.y * 0.4) {
        this.startSeq(sk.flips && ball.pos.y < 2.6 ? 'jumpflip' : 'jump', ballAngle);
      } else if (sk.flips && ball.pos.y < 1.6 && hd < flipRange && speed > 7) {
        this.startSeq('flip', ballAngle);
      }
    }
    return c;
  }

  // Pick a target point: attack the ball, clear it, rotate back, or cover the goal
  plan(game, ownZ, attack) {
    const car = this.car;
    const ball = game.ball;
    const pred = game.prediction.length ? game.prediction : [{ t: 0, x: ball.pos.x, y: ball.pos.y, z: ball.pos.z }];
    this.error = (Math.random() - 0.5) * 2 * this.skill.aimError;

    // Earliest moment we could reach the ball
    const speed = Math.max(car.vel.length(), 10) + (car.boost > 10 ? 4 : 0);
    let hit = pred[pred.length - 1];
    for (const p of pred) {
      const dist = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
      if (dist <= p.t * speed + 1.5 && p.y < (this.skill.aerials ? 9 : 3.2)) { hit = p; break; }
    }
    const hitPos = _t.set(hit.x, hit.y, hit.z);

    // Teammates: the one who'd get there first goes; the rest cover
    const myEta = Math.hypot(hit.x - car.pos.x, hit.z - car.pos.z);
    let closerMate = false;
    for (const other of game.cars) {
      if (other === car || other.team !== car.team) continue;
      const eta = Math.hypot(hit.x - other.pos.x, hit.z - other.pos.z);
      if (eta + 4 < myEta && (other.pos.z - hit.z) * attack < 2) closerMate = true;
    }

    const danger = pred.some((p) => p.t < 3 && Math.abs(p.x) < game.arena.GW + 1 && p.z * Math.sign(ownZ) > game.arena.HZ - 2);
    const wrongSide = (car.pos.z - hitPos.z) * attack > 1.5;

    if (danger && !closerMate) {
      this.mode = 'clear';
      // Hit it from the goal side, pushing it away to the nearest side wall
      const side = hitPos.x >= 0 ? 1 : -1;
      this.target.set(hitPos.x - side * 0.8, 0, hitPos.z + Math.sign(ownZ) * 1.2);
    } else if (closerMate) {
      this.mode = 'support';
      this.target.set(hitPos.x * 0.35, 0, ownZ + (hitPos.z - ownZ) * 0.4);
    } else if (wrongSide) {
      this.mode = 'rotate';
      const side = car.pos.x >= hitPos.x ? 1 : -1;
      this.target.set(clamp(hitPos.x + side * 7, -28, 28), 0, hitPos.z - attack * 9);
    } else {
      this.mode = 'attack';
      const goal = _d.set(this.error * 6, 0, -ownZ);
      const shotDir = goal.sub(hitPos).setY(0).normalize();
      const dist = Math.hypot(hitPos.x - car.pos.x, hitPos.z - car.pos.z);
      this.target.copy(hitPos).addScaledVector(shotDir, -Math.min(dist * 0.35, 6) - 0.6);
      this.aimPoint.copy(hitPos);
    }
    if (game.kickoffLive) { this.mode = 'attack'; this.target.set(0, 0, 0); }
    this.target.y = 0;
  }

  startSeq(type, angle) {
    this.seq = { type, t: 0, flipped: false, dirX: Math.sin(angle), dirY: Math.cos(angle) };
  }

  runSequence(game, c, dt) {
    const s = this.seq;
    const car = this.car;
    s.t += dt;
    if (s.t === dt) c.jumpPressed = true;
    if (s.type === 'flip') {
      c.jump = s.t < 0.08;
      if (s.t > 0.1 && !s.flipped) {
        s.flipped = true;
        c.jumpPressed = true;
        c.pitch = s.dirY; c.steer = s.dirX;
        c.throttle = 1;
      }
      if (s.t > 1.2 || (s.t > 0.3 && car.grounded)) this.seq = null;
    } else if (s.type === 'jump' || s.type === 'jumpflip') {
      c.jump = s.t < 0.2;
      if (s.type === 'jumpflip' && s.t > 0.25 && !s.flipped) {
        _t.subVectors(game.ball.pos, car.pos);
        if (_t.length() < 2.6) {
          s.flipped = true;
          c.jumpPressed = true;
          const a = Math.atan2(_t.dot(car.right), _t.dot(car.fwd));
          c.pitch = Math.cos(a); c.steer = Math.sin(a);
        }
      }
      if (!s.flipped && s.t > 0.2) this.recover(c, game.ball.pos);
      if (s.t > 1.6 || (s.t > 0.3 && car.grounded)) this.seq = null;
    } else if (s.type === 'aerial') {
      c.jump = s.t < 0.22;
      if (s.t > 0.3 && s.t < 0.35 && !s.flipped) { s.flipped = true; c.jumpPressed = true; } // double jump
      const p = this.interceptAir(game);
      _t.subVectors(p, car.pos).normalize();
      this.aim(c, _t);
      c.boost = s.t > 0.15 && car.fwd.dot(_t) > 0.7 && car.boost > 0;
      if (s.t > 3 || (s.t > 0.4 && car.grounded) || game.ball.pos.distanceTo(car.pos) < 1.4) this.seq = null;
    }
    return c;
  }

  interceptAir(game) {
    const car = this.car;
    for (const p of game.prediction) {
      const dist = Math.hypot(p.x - car.pos.x, p.y - car.pos.y, p.z - car.pos.z);
      if (dist <= p.t * Math.max(car.vel.length(), 12) + 1) return _d.set(p.x, p.y, p.z);
    }
    return _d.copy(game.ball.pos);
  }

  // Turn in the air to face `dir`, keeping the roof up
  aim(c, dir) {
    const car = this.car;
    const w = car.angVel;
    const pitchErr = Math.atan2(dir.dot(car.up), dir.dot(car.fwd));
    const yawErr = Math.atan2(dir.dot(car.right), dir.dot(car.fwd));
    c.pitch = clamp(-(pitchErr * 4 - w.x * 0.6), -1, 1);
    c.steer = clamp(yawErr * 4 + w.y * 0.6, -1, 1);
    c.roll = clamp(car.right.dot(WORLD_UP) * 3 - w.z * 0.3, -1, 1);
  }

  // Land on the wheels: level out, nose along the direction of travel
  recover(c, lookAt) {
    const car = this.car;
    if (lookAt) _t.subVectors(lookAt, car.pos);
    else _t.copy(car.vel);
    _t.y = 0;
    if (_t.lengthSq() < 0.01) _t.set(car.fwd.x, 0, car.fwd.z);
    if (_t.lengthSq() < 0.01) _t.set(0, 0, 1);
    this.aim(c, _t.normalize());
  }
}
