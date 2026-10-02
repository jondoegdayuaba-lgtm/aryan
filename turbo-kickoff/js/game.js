// A match: sets up the physics world, cars, bots, ball and boost pads, and runs
// the rules (kickoff countdown, clock, goals, overtime, stats).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS as P, MATCH_SECONDS, KICKOFF_COUNTDOWN, GOAL_REPLAY_SECONDS, BOT_NAMES, TEAM_COLORS } from './config.js';
import { ArenaShape } from './arena.js';
import { Car } from './car.js';
import { Ball, predictBall } from './ball.js';
import { Bot } from './ai.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const KICKOFF_PAIRS = [[0, 1], [2, 3], [0, 4], [1, 4]];
const POINTS = { goal: 100, assist: 50, save: 50, shot: 20 };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Match {
  constructor({ scene, assets, mode, difficulty, effects, ui, chase }) {
    this.scene = scene;
    this.assets = assets;
    this.layout = assets.layout;
    this.mode = mode;
    this.difficulty = difficulty;
    this.effects = effects;
    this.ui = ui;
    this.chase = chase;
    this.arena = new ArenaShape(this.layout);
    this.freePlay = mode === 'freeplay';
    this.unlimitedBoost = this.freePlay;
    this.objects = [];

    // Physics: cannon-es handles car/ball and car/car contacts; the arena is
    // handled by its exact shape in Car and Ball.
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
    this.world.broadphase = new CANNON.NaiveBroadphase();
    const carMat = new CANNON.Material('car');
    const ballMat = new CANNON.Material('ball');
    this.world.addContactMaterial(new CANNON.ContactMaterial(carMat, ballMat, { friction: 0.05, restitution: 0.45 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(carMat, carMat, { friction: 0.05, restitution: 0.25 }));

    const ballModel = assets.models.ball.clone();
    this.add(ballModel);
    this.ball = new Ball({ model: ballModel, world: this.world, material: ballMat, radius: this.layout.ball.radius });
    this.ball.onBounce = (s) => sfx.bounce(s);
    this.ballShadow = effects.addShadow(ballModel, 2.4);
    this.objects.push(this.ballShadow);

    // Teams
    const names = shuffle(BOT_NAMES.slice());
    const roster = mode === '2v2'
      ? [['blue', 'You', true], ['blue', names[0], false], ['orange', names[1], false], ['orange', names[2], false]]
      : mode === '1v1'
        ? [['blue', 'You', true], ['orange', names[0], false]]
        : [['blue', 'You', true]];
    this.cars = [];
    this.bots = [];
    for (const [team, name, isPlayer] of roster) {
      const model = assets.models['car_' + team].clone();
      this.add(model);
      const car = new Car({ team, name, isPlayer, model, world: this.world, material: carMat });
      effects.addFlames(car, TEAM_COLORS[team]);
      car.shadow = effects.addShadow(model, 1.6);
      this.objects.push(car.shadow);
      car.onJump = (c) => { if (c.isPlayer) sfx.jump(); };
      car.pendingJump = false;
      this.cars.push(car);
      if (isPlayer) this.player = car;
      else this.bots.push(new Bot(car, difficulty));
    }

    // Boost pads
    this.pads = this.layout.boost_pads.map((p) => {
      const big = p.size === 'big';
      const mesh = (big ? assets.models.boost_pad_big : assets.models.boost_pad_small).clone();
      mesh.position.fromArray(p.position);
      this.add(mesh);
      return {
        big, mesh, pos: new THREE.Vector3().fromArray(p.position), active: true, timer: 0,
        glow: mesh.getObjectByName(big ? 'BoostPad_Big_Orb' : 'BoostPad_Small_Glow'),
        radius: big ? 2.08 : 1.44, amount: big ? 100 : 12, respawn: big ? 10 : 4,
      };
    });

    this.score = { blue: 0, orange: 0 };
    this.clock = MATCH_SECONDS;
    this.overtime = false;
    this.time = 0;
    this.acc = 0;
    this.touches = [];
    this.pendingTouches = [];
    this.threat = { blue: false, orange: false };
    this.prediction = [];
    this.kickoff();
  }

  add(obj) {
    this.scene.add(obj);
    this.objects.push(obj);
  }

  dispose() {
    for (const o of this.objects) this.scene.remove(o);
  }

  get frozen() { return this.state === 'countdown'; }

  kickoff() {
    const spots = this.layout.kickoff_spawns;
    const blue = this.cars.filter((c) => c.team === 'blue');
    const orange = this.cars.filter((c) => c.team === 'orange');
    let idx;
    if (this.freePlay) idx = [4];
    else if (blue.length === 1) idx = [Math.floor(Math.random() * 5)];
    else idx = shuffle(KICKOFF_PAIRS[Math.floor(Math.random() * KICKOFF_PAIRS.length)].slice());
    blue.forEach((c, i) => c.reset(spots.blue[idx[i]].position, spots.blue[idx[i]].yaw));
    orange.forEach((c, i) => c.reset(spots.orange[idx[i]].position, spots.orange[idx[i]].yaw));
    for (const b of this.bots) b.reset();
    this.ball.reset();
    this.ball.frozen = !this.freePlay;
    this.ball.mesh.visible = true;
    this.ball.body.collisionResponse = true;
    this.kickoffLive = !this.freePlay;
    this.touches = [];
    this.state = this.freePlay ? 'playing' : 'countdown';
    this.stateTime = 0;
    this.lastBeep = -1;
    if (this.chase) this.chase.snap(this.player, this.ball, this.arena);
    this.ui.countdown(this.freePlay ? '' : String(KICKOFF_COUNTDOWN));
  }

  resetFreePlay() {
    this.kickoff();
  }

  // One frame. `controls` are the player's.
  update(frameDt, controls) {
    if (this.state === 'ended') return;
    if (controls.jumpPressed) this.player.pendingJump = true;
    if (this.freePlay && controls.resetPressed) this.resetFreePlay();
    if (this.freePlay && controls.boostTogglePressed) {
      this.unlimitedBoost = !this.unlimitedBoost;
      this.ui.popup(this.unlimitedBoost ? 'Unlimited boost ON' : 'Unlimited boost OFF');
    }

    this.prediction = predictBall(this.ball, this.arena, 4, 0.1);
    const botControls = this.bots.map((b) => {
      const c = b.think(this, frameDt);
      if (c.jumpPressed) b.car.pendingJump = true;
      return c;
    });

    this.stateTime += frameDt;
    this.updateState(frameDt);

    this.acc = Math.min(this.acc + frameDt, 0.1);
    while (this.acc >= P.step) {
      this.acc -= P.step;
      this.substep(P.step, controls, botControls);
    }

    this.updateThreats();
    for (const t of this.pendingTouches) this.scoreTouch(t);
    this.pendingTouches.length = 0;

    for (const pad of this.pads) {
      if (!pad.active) {
        pad.timer -= frameDt;
        if (pad.timer <= 0) { pad.active = true; pad.glow.visible = true; }
      }
      if (pad.big && pad.glow.visible) {
        pad.glow.rotation.y += frameDt * 1.5;
        pad.glow.position.y = 0.85 + Math.sin(this.time * 2.5) * 0.08;
      }
    }
    this.render(frameDt);
  }

  updateState(dt) {
    if (this.state === 'countdown') {
      const left = KICKOFF_COUNTDOWN - this.stateTime;
      const n = Math.ceil(left);
      if (n !== this.lastBeep && n > 0) { this.lastBeep = n; this.ui.countdown(String(n)); sfx.beep(false); }
      if (left <= 0) {
        this.state = 'playing';
        this.stateTime = 0;
        this.ball.frozen = false;
        this.ui.countdown('GO!', true);
        sfx.beep(true);
      }
    } else if (this.state === 'playing') {
      this.time += dt;
      if (!this.freePlay) {
        if (this.overtime) this.clock += dt;
        else this.clock = Math.max(0, this.clock - dt);
        if (!this.overtime && this.clock <= 0 && this.ball.pos.y < this.ball.radius + 0.4) this.timeUp();
      }
    } else if (this.state === 'goal') {
      if (this.stateTime > GOAL_REPLAY_SECONDS) {
        if (this.freePlay) { this.ball.reset(); this.ball.frozen = false; this.ball.mesh.visible = true; this.ball.body.collisionResponse = true; this.state = 'playing'; }
        else if (this.overtime || this.clock <= 0) this.finish();
        else this.kickoff();
      }
    } else if (this.state === 'overtime') {
      if (this.stateTime > 2.5) { this.overtime = true; this.clock = 0; this.kickoff(); }
    }
  }

  timeUp() {
    if (this.score.blue !== this.score.orange) { this.finish(); return; }
    this.state = 'overtime';
    this.stateTime = 0;
    this.ball.frozen = true;
    sfx.whistle();
    this.ui.banner('OVERTIME', '#ffffff', 'Next goal wins');
  }

  finish() {
    this.state = 'ended';
    sfx.whistle();
    const winner = this.score.blue > this.score.orange ? 'blue' : 'orange';
    const players = this.cars.map((c) => ({ name: c.name, team: c.team, isPlayer: c.isPlayer, ...c.stats }));
    const winners = players.filter((p) => p.team === winner).sort((a, b) => b.score - a.score);
    const mvp = winners[0];
    this.ui.endScreen({ winner, score: { ...this.score }, players, mvp: mvp && mvp.name, playerWon: this.player.team === winner });
  }

  substep(dt, playerControls, botControls) {
    const frozen = this.frozen;
    const opts = { frozen, unlimitedBoost: this.unlimitedBoost };
    this.cars.forEach((car) => {
      const src = car.isPlayer ? playerControls : botControls[this.bots.findIndex((b) => b.car === car)];
      const c = { ...src, jumpPressed: car.pendingJump && !frozen };
      car.pendingJump = false;
      car.step(dt, c, this.arena, opts);
    });
    this.ball.preStep(dt);
    this.world.step(dt);
    for (const car of this.cars) car.readBody();
    this.ball.postStep(dt, this.arena);

    // Ball touches: cannon-es did the bounce; add a Rocket League style "hit".
    // All hits in a step use the same ball state so no car is favoured.
    const hitters = new Set();
    for (const eq of this.world.contacts) {
      const a = eq.bi, b = eq.bj;
      const carBody = a === this.ball.body ? b : b === this.ball.body ? a : null;
      if (carBody && carBody.userData) hitters.add(carBody.userData.car);
    }
    if (hitters.size) this.touchBall([...hitters]);

    if (this.state === 'playing' || this.state === 'goal') this.pickUpBoost();
    if (this.state === 'playing') {
      const goal = this.arena.goalFor(this.ball.pos, this.ball.radius);
      if (goal) this.goalScored(goal);
    }
  }

  touchBall(cars) {
    if (this.ball.frozen) return;
    const ball = this.ball;
    ball.sync();
    const kick = new THREE.Vector3();
    let strongest = 0;
    for (const car of cars) {
      if (car.hitCooldown > 0) continue;
      car.hitCooldown = 0.1;
      const rel = _v.subVectors(car.vel, ball.vel).length();
      const scale = rel <= 5 ? 0.65 : rel <= 23 ? 0.65 - 0.1 * (rel - 5) / 18 : Math.max(0.3, 0.55 - 0.25 * (rel - 23) / 23);
      _d.subVectors(ball.pos, car.pos);
      _d.y *= 0.35;
      _d.normalize();
      kick.addScaledVector(_d, rel * scale * 0.8 * (car.dodging ? 1.2 : 1));
      this.touches.push({ car, time: this.time });
      this.pendingTouches.push({ car, threatBefore: { ...this.threat } });
      strongest = Math.max(strongest, rel);
    }
    if (!strongest) return;
    // Two cars hitting head-on pop the ball up instead of trapping it
    if (cars.length > 1) kick.y += 2 + Math.random() * 2;
    ball.body.velocity.x += kick.x;
    ball.body.velocity.y += kick.y;
    ball.body.velocity.z += kick.z;
    ball.sync();
    this.kickoffLive = false;
    if (strongest > 2) {
      sfx.hit(strongest);
      _d.copy(kick).normalize();
      _v.copy(ball.pos).addScaledVector(_d, -ball.radius);
      this.effects.sparks(_v, _d, strongest);
    }
  }

  // Is the ball heading into a goal in the next 2.5 s?
  updateThreats() {
    const pred = predictBall(this.ball, this.arena, 2.5, 0.05);
    const { GW, GH, HZ } = this.arena;
    this.threat.blue = pred.some((p) => p.z > HZ && Math.abs(p.x) < GW && p.y < GH);
    this.threat.orange = pred.some((p) => p.z < -HZ && Math.abs(p.x) < GW && p.y < GH);
  }

  scoreTouch(t) {
    if (this.freePlay) return;
    const car = t.car;
    const opp = car.team === 'blue' ? 'orange' : 'blue';
    if (t.threatBefore[car.team] && !this.threat[car.team]) {
      car.stats.saves++; car.stats.score += POINTS.save;
      if (car.isPlayer) this.ui.popup('SAVE! +50');
    }
    if (!t.threatBefore[opp] && this.threat[opp]) {
      car.stats.shots++; car.stats.score += POINTS.shot;
      car.lastShotTime = this.time;
      if (car.isPlayer) this.ui.popup('Shot on goal +20');
    }
  }

  goalScored(goalOf) {
    const scoring = goalOf === 'blue' ? 'orange' : 'blue';
    this.score[scoring]++;
    const mine = this.touches.filter((t) => t.car.team === scoring);
    const scorer = mine.length ? mine[mine.length - 1].car : null;
    let assister = null;
    if (scorer) {
      scorer.stats.goals++;
      scorer.stats.score += POINTS.goal;
      if (!(scorer.lastShotTime > this.time - 6)) { scorer.stats.shots++; scorer.stats.score += POINTS.shot; }
      for (let i = mine.length - 2; i >= 0; i--) {
        const t = mine[i];
        if (t.car !== scorer && this.time - t.time < 6) { assister = t.car; break; }
      }
      if (assister) { assister.stats.assists++; assister.stats.score += POINTS.assist; }
    }

    const pos = this.ball.pos.clone();
    this.effects.goalExplosion(pos, TEAM_COLORS[scoring]);
    if (this.chase) this.chase.shake = 1;
    sfx.goal();
    // The blast throws nearby cars around
    for (const car of this.cars) {
      _v.subVectors(car.pos, pos);
      const d = _v.length();
      if (d < 18) {
        car.vel.addScaledVector(_v.normalize(), (18 - d) * 1.2).y += (18 - d) * 0.5;
        car.grounded = false;
        car.writeBody();
      }
    }
    this.ball.frozen = true;
    this.ball.mesh.visible = false;
    this.ball.body.collisionResponse = false;
    this.ball.body.position.set(0, -50, 0);
    this.state = 'goal';
    this.stateTime = 0;
    const who = scorer ? scorer.name : (scoring === 'blue' ? 'Blue' : 'Orange');
    const sub = scorer ? (assister ? `Assist: ${assister.name}` : '') : 'Own goal';
    this.ui.banner('GOAL!', TEAM_COLORS[scoring], scorer ? `${who} scores! ${sub}` : sub);
    if (!this.freePlay && this.overtime) this.stateTime = GOAL_REPLAY_SECONDS - 2.5;
  }

  pickUpBoost() {
    for (const pad of this.pads) {
      if (!pad.active) continue;
      for (const car of this.cars) {
        if (car.boost >= 100 || car.pos.y > 2.5) continue;
        if (Math.hypot(car.pos.x - pad.pos.x, car.pos.z - pad.pos.z) > pad.radius) continue;
        car.boost = Math.min(100, car.boost + pad.amount);
        pad.active = false;
        pad.timer = pad.respawn;
        pad.glow.visible = false;
        this.effects.pickup(pad.pos, pad.big);
        if (car.isPlayer) sfx.pickup(pad.big);
        break;
      }
    }
  }

  render(dt) {
    for (const car of this.cars) {
      car.updateVisual(dt);
      this.effects.carFrame(car, dt, this.time);
      this.effects.placeShadow(car.shadow, car.pos, 1.6);
      car.shadow.visible = car.shadow.visible && car.pos.y < 6 && (car.up.y > 0.3 || !car.grounded);
    }
    this.ball.updateVisual();
    this.effects.placeShadow(this.ballShadow, this.ball.pos, 2.4);
    this.ballShadow.visible = this.ballShadow.visible && this.ball.mesh.visible;
    this.ui.hud({
      blue: this.score.blue, orange: this.score.orange,
      clock: this.freePlay ? null : this.clock, overtime: this.overtime,
      boost: this.unlimitedBoost ? 100 : this.player.boost, unlimited: this.unlimitedBoost,
      speed: this.player.speed, supersonic: this.player.supersonic,
    });
  }
}
