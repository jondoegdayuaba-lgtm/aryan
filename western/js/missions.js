// Story missions. Each mission is a generator that yields what it is waiting
// for (a condition or a delay); the runner steps it every frame. Mission
// characters, fires and markers are tracked so a failed attempt can be
// cleaned up and restarted from its last checkpoint.
import * as THREE from 'three';
import { NPC } from './npc.js';
import { Deer } from './animals.js';
import { rng } from './util.js';

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

export const MISSIONS = [
  {
    id: 'ride', title: 'Morning Ride', giver: 'gus', giverName: 'Gus', where: 'at camp', reward: 15,
    blurb: 'Gus wants eyes on the valley. Ride up to the lookout on the north ridge and see what the Lockhart gang is up to.',
    run: morningRide,
  },
  {
    id: 'hunt', title: 'Fresh Meat', giver: 'gus', giverName: 'Gus', where: 'at camp', reward: 20,
    blurb: 'The stew pot is empty. Take your rifle to the meadow below Eagle Ridge and bring back two deer.',
    run: freshMeat,
  },
  {
    id: 'bank', title: 'Trouble in Copper Bluff', giver: 'gus', giverName: 'Gus', where: 'at camp', reward: 40,
    blurb: 'Ride into Copper Bluff to see Sheriff Dawes. Lockhart\'s masked men have other plans for the bank.',
    run: bankJob,
  },
  {
    id: 'farm', title: 'Smoke on the Horizon', giver: 'sheriff', giverName: 'Sheriff Dawes', where: 'in Copper Bluff', reward: 35,
    blurb: 'Raiders have set the Hollis farm alight. Drive them out of the tobacco field and find Eli Hollis.',
    run: burningFarm,
  },
  {
    id: 'bounty', title: 'Dead or Alive', giver: 'sheriff', giverName: 'Sheriff Dawes', where: 'in Copper Bluff', reward: 200,
    blurb: 'Red Lockhart is holed up in a cabin in the northern pines. Two hundred dollars, dead or alive.',
    run: deadOrAlive,
  },
];

class Run {
  constructor(missions, def, from = 0) {
    this.missions = missions;
    this.g = missions.game;
    this.def = def;
    this.from = from;
    this.checkpoint = from;
    this.cpPos = null;
    this.spawned = [];
    this.fires = [];
    this.markers = [];
    this.travel = null;
    this.interactions = [];
    this.wait = null;
    this.pts = {};
    for (const [k, v] of Object.entries(this.g.world.data.points)) this.pts[k] = V(v);
    this.giver = missions.givers[def.giver];
    this.gen = def.run(this);
  }

  // -- yieldables
  until(pred) { return { until: pred }; }
  delay(sec) { return { wait: sec }; }

  *say(lines) {
    for (const [who, text, dur] of lines) {
      const d = dur || Math.max(2.6, text.length * 0.058);
      this.g.hud.subtitle(who, text, d);
      yield this.delay(d);
    }
  }

  // A conversation with the camera framing both speakers.
  *talk(lines, npc = this.giver) {
    const g = this.g;
    const p = g.player;
    this.lock(true);
    if (npc && !p.mounted) {
      const n = npc.pos;
      const toN = Math.atan2(n.x - p.pos.x, n.z - p.pos.z);
      p.yaw = toN;
      p.char.root.rotation.y = toN;
      npc.yaw = toN + Math.PI;
      const mid = new THREE.Vector3().addVectors(p.pos, n).multiplyScalar(0.5);
      const side = new THREE.Vector3(Math.cos(toN), 0, -Math.sin(toN));
      const d = Math.max(2.4, p.pos.distanceTo(n) * 1.1);
      const from = mid.clone().addScaledVector(side, d).add(new THREE.Vector3(0, 1.75, 0));
      const to = from.clone().addScaledVector(side, -0.4);
      const look = mid.clone().add(new THREE.Vector3(0, 1.5, 0));
      let total = 0;
      for (const [, t, dd] of lines) total += dd || Math.max(2.6, t.length * 0.058);
      g.camRig.cinematic = { from, to, look, t: 0, dur: total, ease: true, fov: 45 };
    }
    yield* this.say(lines);
    this.endCinematic();
    this.lock(false);
  }

  lock(on) {
    this.g.lockControls = on;
  }

  endCinematic() {
    const g = this.g;
    if (g.camRig.cinematic) {
      // Pick up the player camera from roughly where the shot ended
      g.camRig.yaw = g.player.yaw;
      g.camRig.pitch = -0.12;
    }
    g.camRig.cinematic = null;
  }

  objective(html) {
    this.g.hud.objective(html);
  }

  hint(html) {
    this.g.hud.toast(html, 'Tip');
  }

  marker(...pts) {
    this.markers = pts.map((p) => (p.isVector3 ? p : V(p)));
    this.travel = null;
  }

  // A long trip the player can skip with J: head for `to`, arriving at `at`
  // (default: a little short of it), or in front of `npc` on foot.
  go(to, at = null, npc = null) {
    this.marker(to);
    this.travel = { to: this.markers[0], at: at && (at.isVector3 ? at : V(at)), npc };
  }

  near(pt, r) {
    const p = this.g.player.pos;
    return Math.hypot(p.x - pt.x, p.z - pt.z) < r;
  }

  setCheckpoint(n, pos) {
    this.checkpoint = n;
    this.cpPos = pos ? pos.clone() : this.g.player.pos.clone();
  }

  spawn(o) {
    const n = new NPC(this.g, o);
    this.g.npcs.push(n);
    this.spawned.push(n);
    return n;
  }

  fire(pos, size, opts) {
    const f = this.g.effects.addFire(pos, size, opts);
    this.fires.push(f);
    return f;
  }

  interact(o) {
    this.interactions.push(o);
    return o;
  }

  alive(list) {
    return list.filter((n) => !n.dead).length;
  }

  step(dt) {
    const w = this.wait;
    if (w) {
      if (w.wait !== undefined) {
        w.wait -= dt;
        if (w.wait > 0) return;
      } else if (w.until && !w.until()) return;
    }
    this.travel = null;             // a trip only lasts until the step that set it is over
    const r = this.gen.next();
    if (r.done) this.missions.complete(this);
    else this.wait = r.value || null;
  }

  cleanup(removeAll) {
    for (const n of this.spawned) {
      if (removeAll || !n.dead) n.remove();
    }
    for (const f of this.fires) f.stop();
    this.fires = [];
    this.interactions = [];
    this.markers = [];
    this.g.hud.objective('');
    this.lock(false);
    this.endCinematic();
    this.g.env.hazeTarget = 0;
  }
}

export class Missions {
  constructor(game, saved) {
    this.game = game;
    this.list = MISSIONS;
    this.done = new Set(saved?.done || []);
    this.active = null;
    this.givers = {};
    this.leftovers = [];
    this.rand = rng(77);
  }

  isDone(id) {
    return this.done.has(id);
  }

  doneCount() {
    return this.done.size;
  }

  available() {
    return this.list.find((m) => !this.done.has(m.id)) || null;
  }

  // People who hand out missions
  spawnGivers() {
    const g = this.game;
    const pts = g.world.data.points;
    const camp = pts.camp;
    const gus = new NPC(g, { outfit: 'gus', role: 'giver', x: camp[0] + 2.6, z: camp[2] - 1.4, yaw: -2.0, name: 'Gus' });
    const sd = pts.sheriff_door;
    const sheriff = new NPC(g, { outfit: 'sheriff', role: 'giver', x: sd[0] + 1.2, z: sd[2] - 2.2, yaw: 0, name: 'Sheriff Dawes' });
    g.npcs.push(gus, sheriff);
    this.givers = { gus, sheriff };
    if (this.done.has('farm')) this.spawnHollis(false);
  }

  spawnHollis(cowering) {
    const g = this.game;
    if (this.givers.hollis) return this.givers.hollis;
    const fh = g.world.data.points.farmhouse;
    const h = new NPC(g, cowering
      ? { outfit: 'farmer', role: 'giver', x: 213, z: 668, yaw: -1.3, name: 'Eli Hollis', anim: 'handsup' }
      : { outfit: 'farmer', role: 'giver', x: fh[0] + 4, z: fh[2] + 9, yaw: 0, name: 'Eli Hollis' });
    g.npcs.push(h);
    this.givers.hollis = h;
    return h;
  }

  start(def, from = 0) {
    const g = this.game;
    this.active = new Run(this, def, from);
    if (from === 0) {
      g.hud.titleCard('Mission', def.title, '', 3.5);
      g.audio.sting('start');
    }
    g.save();
  }

  complete(run) {
    const g = this.game;
    const def = run.def;
    this.done.add(def.id);
    g.money += def.reward;
    g.hud.titleCard('Mission complete', def.title, `+ $${def.reward}.00`, 4.5);
    g.audio.sting('complete');
    run.interactions = [];
    run.markers = [];
    g.hud.objective('');
    // Bodies stay for a while; tidy them up later
    this.leftovers.push({ list: run.spawned.filter((n) => n.dead), t: 90 });
    for (const n of run.spawned) if (!n.dead && n.role === 'outlaw') n.remove();
    for (const f of run.fires) this.leftoverFires.push({ f, t: 120 });
    this.active = null;
    g.save();
    if (def.id === 'bounty') {
      setTimeout(() => g.hud.titleCard('The End', 'Outlaw Frontier', 'The valley is yours to roam. Thanks for playing.', 7), 5000);
    } else {
      const next = this.available();
      if (next) setTimeout(() => g.hud.toast(`Next: <b>${next.title}</b>. Talk to ${next.giverName} ${next.where}, or press <kbd>J</kbd> to start it now.`, 'Story'), 5200);
    }
  }

  leftoverFires = [];

  onPlayerDeath() {
    const r = this.active;
    if (!r) return null;
    r.cleanup(true);
    this.active = null;
    this.retry = { def: r.def, from: r.checkpoint, pos: r.cpPos };
    return this.retry;
  }

  resumeAfterDeath() {
    const r = this.retry;
    this.retry = null;
    if (r) this.start(r.def, r.from);
  }

  // What the E key does near a mission character or mission object
  interaction() {
    const g = this.game;
    const p = g.player.pos;
    if (this.active) {
      for (const it of this.active.interactions) {
        if (it.enabled && !it.enabled()) continue;
        const q = it.pos();
        if (Math.hypot(q.x - p.x, q.z - p.z) < (it.r || 2.2)) return it;
      }
      return null;
    }
    const next = this.available();
    if (!next || g.player.mounted) return null;
    const giver = this.givers[next.giver];
    if (giver && Math.hypot(giver.pos.x - p.x, giver.pos.z - p.z) < 3.2) {
      return { label: `Talk to ${next.giverName}: ${next.title}`, action: () => this.start(next) };
    }
    return null;
  }

  // Where J (quick travel) would take the player right now, if anywhere:
  // to the next mission's giver (starting it), or along a long ride in one.
  travelTarget() {
    const g = this.game;
    const p = g.player.pos;
    if (this.active) {
      const t = this.active.travel;
      if (!t || Math.hypot(t.to.x - p.x, t.to.z - p.z) < 80) return null;
      return { label: 'Travel to objective', ...t };
    }
    const next = this.available();
    const giver = next && this.givers[next.giver];
    if (!giver) return null;
    return { label: `Start mission: ${next.title}`, to: giver.pos, npc: giver, start: next };
  }

  blips() {
    const out = [];
    if (this.active) {
      for (const m of this.active.markers) out.push({ x: m.x, z: m.z, color: '#f2c94c', r: 5, edge: true });
    } else {
      const next = this.available();
      if (next) {
        const gv = this.givers[next.giver];
        if (gv) out.push({ x: gv.pos.x, z: gv.pos.z, color: '#f2c94c', label: next.giverName[0], edge: true });
      }
    }
    return out;
  }

  update(dt) {
    if (this.active && !this.game.player.dead) this.active.step(dt);
    for (const l of this.leftovers) {
      l.t -= dt;
      const far = l.list.every((n) => n.pos.distanceTo(this.game.player.pos) > 120);
      if (l.t <= 0 && far) for (const n of l.list) n.remove();
    }
    this.leftovers = this.leftovers.filter((l) => l.t > 0 || l.list.some((n) => n.char.root.parent));
    for (const lf of this.leftoverFires) {
      lf.t -= dt;
      if (lf.t <= 0) lf.f.stop();
    }
    this.leftoverFires = this.leftoverFires.filter((l) => l.t > 0);
  }
}

// ===========================================================================
// 1. Morning Ride: mount up, ride to the lookout, take in the view.
// ===========================================================================
function* morningRide(m) {
  const g = m.g;
  const P = m.pts;
  if (m.from <= 0) {
    yield* m.talk([
      ['Gus', 'Morning, Cole. Sleep any?'],
      ['Cole', 'Like a stone on a stone.'],
      ['Gus', 'Lockhart\'s boys were seen crossing the river last night, headed for the hills.'],
      ['Gus', 'Take Biscuit up to the lookout on the north ridge. Tell me what you see.'],
    ]);
  }
  if (!g.player.mounted) {
    m.objective('Mount your <b>horse</b>');
    m.markers = [g.horse.position];
    m.hint('Walk up to your horse and press <kbd>E</kbd>. Whistle for it any time with <kbd>H</kbd>.');
    yield m.until(() => g.player.mounted);
  }
  m.hint('Steer with the mouse and <kbd>W A S D</kbd>. Hold <kbd>Shift</kbd> to gallop, but watch the horse\'s stamina ring.');
  m.objective('Ride to the <b>lookout</b>');
  m.go(P.lookout);
  yield m.until(() => m.near(P.lookout, 24));
  m.objective('');
  m.markers = [];
  // The view: the rider turns to the valley and the camera drifts past him,
  // looking north-east over the river toward the pines and the peaks.
  m.lock(true);
  const dir = new THREE.Vector3(0.88, 0, -0.47).normalize();
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const h = g.horse;
  h.drive(null, false, false);
  h.speed = 0;
  const want = Math.atan2(dir.x, dir.z);
  for (let i = 0; i < 40; i++) {
    h.yaw += Math.max(-0.08, Math.min(0.08, ((want - h.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
    yield m.delay(0.025);
  }
  const pp = g.player.pos.clone();
  const from = pp.clone().addScaledVector(dir, -7.5).addScaledVector(side, 2.6).add(new THREE.Vector3(0, 2.6, 0));
  const to = pp.clone().addScaledVector(dir, -4.2).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 3.2, 0));
  const vista = pp.clone().addScaledVector(dir, 600).add(new THREE.Vector3(0, -40, 0));
  g.camRig.cinematic = { from, to, look: vista, lookFrom: pp.clone().addScaledVector(dir, 40).add(new THREE.Vector3(0, 1, 0)), t: 0, dur: 10, ease: true, fov: 52 };
  g.audio.sting('discover');
  yield m.delay(2.5);
  yield* m.say([
    ['Cole', 'The Dakota, running high... and smoke over Copper Bluff.'],
    ['Cole', 'Riders heading north into the pines. Lockhart\'s lot, sure as sunrise.'],
  ]);
  m.endCinematic();
  m.lock(false);
  m.setCheckpoint(1, P.lookout);
  m.objective('Return to <b>camp</b>');
  m.go(P.camp);
  yield m.until(() => m.near(P.camp, 16));
  if (g.player.mounted) {
    m.objective('Get off your horse and talk to <b>Gus</b>');
    yield m.until(() => !g.player.mounted);
  }
  m.objective('Talk to <b>Gus</b>');
  m.markers = [m.giver.pos];
  yield m.until(() => m.near(m.giver.pos, 4));
  m.objective('');
  yield* m.talk([
    ['Cole', 'Riders going up into the northern pines. And smoke over town.'],
    ['Gus', 'Lockhart. I knew that snake would crawl back.'],
    ['Gus', 'Good work. Get yourself some coffee.'],
  ]);
}

// ===========================================================================
// 2. Fresh Meat: hunt and skin two deer (screenshot 3, the rifle on the back)
// ===========================================================================
function* freshMeat(m) {
  const g = m.g;
  const P = m.pts;
  if (m.from <= 0) {
    yield* m.talk([
      ['Gus', 'Pearson\'s stew pot is empty and the boys are getting mean about it.'],
      ['Gus', 'There\'s deer grazing in the meadow below Eagle Ridge. Bring back two.'],
      ['Cole', 'I\'ll take the rifle.'],
    ]);
  }
  if (g.player.weapon !== 'rifle') {
    m.objective('Draw your <b>rifle</b> <kbd>2</kbd>');
    yield m.until(() => g.player.weapon === 'rifle');
  }
  m.objective('Ride to the <b>deer meadow</b>');
  m.go(P.deer_meadow, P.deer_meadow.clone().add(new THREE.Vector3(120, 0, 30)));
  yield m.until(() => m.near(P.deer_meadow, 170));
  m.setCheckpoint(1, P.deer_meadow.clone().add(new THREE.Vector3(120, 0, 30)));
  const herd = [];
  const rand = rng(5);
  const addDeer = () => {
    const a = rand() * Math.PI * 2;
    const r = 15 + rand() * 45;
    const x = P.deer_meadow.x + Math.cos(a) * r;
    const z = P.deer_meadow.z + Math.sin(a) * r;
    const d = new Deer(g.assets.deer, rand);
    d.position.set(x, g.collision.groundY(x, z), z);
    d.home.set(P.deer_meadow.x, 0, P.deer_meadow.z);
    d.yaw = rand() * 6.28;
    g.scene.add(d.root);
    g.animals.push(d);
    herd.push(d);
    m.spawned.push({ dead: false, remove: () => { d.root.removeFromParent(); g.animals.splice(g.animals.indexOf(d), 1); }, pos: d.position, char: { root: d.root } });
  };
  for (let i = 0; i < 6; i++) addDeer();
  m.hint('Deer spook easily. Get down off your horse, creep closer (<kbd>C</kbd> to walk) and aim with the right mouse button.');
  let skinned = 0;
  for (const d of herd) registerSkin(d);
  function registerSkin(d) {
    m.interact({
      pos: () => d.position, r: 2.4, label: 'Skin the deer', enabled: () => d.dead && !d.skinned && !g.player.mounted,
      action: () => {
        d.skinned = true;
        g.player.kneel(2.2, () => {
          skinned++;
          g.pelts++;
          g.hud.toast('Deer pelt and venison', 'Skinned');
          d.root.visible = false;
        });
      },
    });
  }
  while (skinned < 2) {
    const dead = herd.filter((d) => d.dead && !d.skinned);
    m.objective(`Hunt and skin <b>deer</b> (${skinned}/2)`);
    m.markers = (dead.length ? dead : herd.filter((d) => !d.dead)).map((d) => d.position);
    if (herd.filter((d) => !d.dead).length + dead.length + skinned < 2) {
      addDeer();
      registerSkin(herd[herd.length - 1]);
    }
    yield m.delay(0.25);
  }
  m.objective('Bring the meat back to <b>camp</b>');
  m.go(P.camp);
  yield m.until(() => m.near(P.camp, 16));
  if (g.player.mounted) {
    m.objective('Get off your horse and talk to <b>Gus</b>');
    yield m.until(() => !g.player.mounted);
  }
  m.objective('Talk to <b>Gus</b>');
  m.markers = [m.giver.pos];
  yield m.until(() => m.near(m.giver.pos, 4));
  m.objective('');
  yield* m.talk([
    ['Gus', 'Now that is a supper. You\'ve still got the eye, Cole.'],
    ['Gus', 'Tomorrow you ride into Copper Bluff. Dawes owes me.'],
  ]);
}

// ===========================================================================
// 3. Trouble in Copper Bluff: masked outlaws rob the bank (screenshot 1)
// ===========================================================================
function* bankJob(m) {
  const g = m.g;
  const P = m.pts;
  if (m.from <= 0) {
    yield* m.talk([
      ['Gus', 'Sheriff Dawes owes me a favour or three.'],
      ['Gus', 'Ride into Copper Bluff and find out what he knows about Lockhart.'],
    ]);
    m.objective('Ride to <b>Copper Bluff</b>');
    m.go(P.town, new THREE.Vector3(318, 0, 112));
    yield m.until(() => m.near(P.town, 150));
    m.setCheckpoint(1, new THREE.Vector3(318, 0, 112));
  }
  // The robbery
  const bank = P.bank_door;
  const robbers = [];
  const spots = [[-3, 2.5], [2.5, 3.4], [-6, 6.5], [5, 7.2]];
  for (const [dx, dz] of spots) {
    robbers.push(m.spawn({ outfit: 'outlaw', x: bank.x + dx, z: bank.z + dz, yaw: Math.PI, engaged: true, accuracy: 0.28 }));
  }
  robbers.push(m.spawn({ outfit: 'outlaw', x: bank.x + 22, z: bank.z + 4, engaged: true, weapon: 'rifle', accuracy: 0.24 }));
  robbers.push(m.spawn({ outfit: 'outlaw', x: bank.x - 16, z: bank.z + 6, engaged: true, accuracy: 0.28 }));
  for (const n of g.npcs) if (n.role === 'civilian' && n.pos.distanceTo(bank) < 80) n.panic(bank);
  g.audio.shot('revolver', 90, 0.3);
  setTimeout(() => g.audio.shot('revolver', 90, 0.2), 400);
  m.objective('Kill the <b>bank robbers</b>');
  m.markers = [];
  yield* m.say([['Sheriff Dawes', 'Cole! Lockhart\'s boys are hitting the bank! Help me run \'em off!']]);
  let wave2 = null;
  while (true) {
    const left = m.alive(robbers) + (wave2 ? m.alive(wave2) : 0);
    m.objective(`Kill the <b>bank robbers</b> (${left} left)`);
    if (!wave2 && m.alive(robbers) <= 2) {
      wave2 = [];
      for (const [dx, dz] of [[-1, 1.2], [1.2, 1.5], [0, 2.4]]) {
        wave2.push(m.spawn({ outfit: 'outlaw', x: bank.x + dx, z: bank.z + dz, yaw: 0, engaged: true, accuracy: 0.3 }));
      }
      yield* m.say([['Robber', 'Grab the money and shoot your way out!']]);
      continue;
    }
    if (wave2 && left === 0) break;
    yield m.delay(0.3);
  }
  m.setCheckpoint(2, P.town);
  m.objective('Speak to <b>Sheriff Dawes</b>');
  const sheriff = m.missions.givers.sheriff;
  m.markers = [sheriff.pos];
  yield m.until(() => m.near(sheriff.pos, 4) && !g.player.mounted);
  m.objective('');
  yield* m.talk([
    ['Sheriff Dawes', 'Obliged, stranger. Gus said you were handy.'],
    ['Sheriff Dawes', 'Those were Red Lockhart\'s men. They\'ve been bleeding this valley dry.'],
    ['Sheriff Dawes', 'Here, the bank\'s reward. Come see me when you\'re ready for more.'],
  ], sheriff);
}

// ===========================================================================
// 4. Smoke on the Horizon: raiders burn the Hollis farm (screenshot 4)
// ===========================================================================
function* burningFarm(m) {
  const g = m.g;
  const P = m.pts;
  const sheriff = m.missions.givers.sheriff;
  if (m.from <= 0) {
    yield* m.talk([
      ['Sheriff Dawes', 'A rider just came in, half dead. Lockhart\'s men are burning the Hollis farm.'],
      ['Sheriff Dawes', 'It\'s south of town. Ride, Cole!'],
    ], sheriff);
  }
  // Golden, smoky evening light for the farm
  if (g.env.hour < 17.6 || g.env.hour > 19) g.env.hour = 17.8;
  g.env.hazeTarget = 0.6;
  const fh = g.world.tagged.farmhouse.place;
  const fy = fh.y;
  const base = new THREE.Vector3(fh.x, fy, fh.z);
  m.fire(base.clone().add(new THREE.Vector3(0, 6.2, -4.5)), 2.4, { spread: 3.2 });
  m.fire(base.clone().add(new THREE.Vector3(-2.5, 1.0, 1.4)), 1.3);
  m.fire(base.clone().add(new THREE.Vector3(2.8, 4.8, -7)), 1.8, { spread: 2.0 });
  m.fire(base.clone().add(new THREE.Vector3(3.6, 1.6, -2)), 1.1);
  m.objective('Ride to the <b>Hollis farm</b>');
  m.go(P.farm, new THREE.Vector3(232, 0, 620));
  yield m.until(() => m.near(P.farm, 110));
  m.setCheckpoint(1, new THREE.Vector3(232, 0, 620));
  g.env.hazeTarget = 1;
  const raiders = [];
  const field = P.field;
  for (const [dx, dz, w] of [[-18, 6, 'revolver'], [-5, -4, 'revolver'], [10, 8, 'revolver'], [22, -2, 'rifle'], [0, 14, 'revolver']]) {
    raiders.push(m.spawn({ outfit: 'raider', x: field.x + dx, z: field.z + dz, yaw: Math.PI, engaged: true, weapon: w, accuracy: 0.27 }));
  }
  const hollis = m.missions.spawnHollis(true);
  m.spawned.push({ dead: false, remove: () => {}, pos: hollis.pos, char: hollis.char });
  yield* m.say([['Cole', 'There they are, in the tobacco!']]);
  let wave2 = null;
  while (true) {
    const left = m.alive(raiders) + (wave2 ? m.alive(wave2) : 0);
    m.objective(`Kill the <b>raiders</b> (${left} left)`);
    if (!wave2 && m.alive(raiders) <= 1) {
      wave2 = [];
      const barn = g.world.tagged.barn.place;
      for (const [dx, dz] of [[-6, 3], [-3, 5]]) {
        wave2.push(m.spawn({ outfit: 'raider', x: barn.x + dx, z: barn.z + dz, engaged: true, accuracy: 0.3 }));
      }
      yield* m.say([['Raider', 'He\'s alone! Cut him down!']]);
      continue;
    }
    if (wave2 && left === 0) break;
    yield m.delay(0.3);
  }
  m.setCheckpoint(2, P.farm);
  m.objective('Find <b>Eli Hollis</b>');
  m.markers = [hollis.pos];
  yield m.until(() => m.near(hollis.pos, 4) && !g.player.mounted);
  hollis.fixedAnim = null;
  hollis.char.setBase('idle', 0.4);
  m.objective('');
  yield* m.talk([
    ['Eli Hollis', 'Lord... I thought I was a dead man.'],
    ['Eli Hollis', 'They took my horses and set the house alight. Laughing the whole time.'],
    ['Eli Hollis', 'The red-masked one, Lockhart, he said they\'re holed up at the old cabin in the northern pines.'],
    ['Cole', 'Then that\'s where I\'m going.'],
  ], hollis);
  g.env.hazeTarget = 0.25;
}

// ===========================================================================
// 5. Dead or Alive: the Lockhart hideout in the pines
// ===========================================================================
function* deadOrAlive(m) {
  const g = m.g;
  const P = m.pts;
  const sheriff = m.missions.givers.sheriff;
  if (m.from <= 0) {
    yield* m.talk([
      ['Sheriff Dawes', 'Eli Hollis says Lockhart\'s up at the old trapper\'s cabin, north in the pines.'],
      ['Sheriff Dawes', 'There\'s two hundred dollars on Red Lockhart. Dead or alive, I don\'t much care which.'],
      ['Cole', 'Keep the coffee warm, Sheriff.'],
    ], sheriff);
    g.env.hazeTarget = 0;
    m.objective('Ride to the <b>Lockhart hideout</b>');
    m.go(P.hideout, P.hideout.clone().add(new THREE.Vector3(30, 0, 160)));
    yield m.until(() => m.near(P.hideout, 150));
    m.setCheckpoint(1, P.hideout.clone().add(new THREE.Vector3(30, 0, 160)));
  }
  const H = P.hideout;
  const gang = [];
  for (const [dx, dz, w] of [[-6, 6, 'revolver'], [4, 8, 'revolver'], [-14, 4, 'rifle'], [13, 5, 'rifle'], [-2, -3, 'revolver'], [8, -6, 'revolver']]) {
    gang.push(m.spawn({ outfit: 'outlaw', x: H.x + dx, z: H.z + dz, yaw: 0, accuracy: 0.3, weapon: w }));
  }
  m.objective('Clear out the <b>Lockhart gang</b>');
  m.marker(H);
  yield m.until(() => m.near(H, 70) || gang.some((n) => n.state === 'combat' || n.dead));
  for (const n of gang) n.engage();
  yield* m.say([['Outlaw', 'It\'s the bounty man! Light him up!']]);
  while (m.alive(gang) > 0) {
    m.objective(`Clear out the <b>Lockhart gang</b> (${m.alive(gang)} left)`);
    m.markers = [];
    yield m.delay(0.3);
  }
  m.setCheckpoint(2, H.clone().add(new THREE.Vector3(0, 0, 30)));
  const cab = g.world.tagged.cabin.place;
  const boss = m.spawn({ outfit: 'boss', x: cab.x + 0.8, z: cab.z + 1.5, yaw: 0, engaged: true, weapon: 'rifle', health: 320, accuracy: 0.4, range: 16, aggro: 1.5, name: 'Red Lockhart' });
  yield* m.say([['Red Lockhart', 'You\'ve got some nerve, coming up my mountain alone!']]);
  while (!boss.dead) {
    m.objective(`Kill <b>Red Lockhart</b> (${Math.max(0, Math.ceil((boss.health / boss.maxHealth) * 100))}%)`);
    yield m.delay(0.2);
  }
  yield* m.say([['Cole', 'Dead it is.']]);
  m.setCheckpoint(3, P.hideout);
  m.objective('Collect the bounty from <b>Sheriff Dawes</b>');
  m.go(sheriff.pos, null, sheriff);
  yield m.until(() => m.near(sheriff.pos, 4) && !g.player.mounted);
  m.objective('');
  yield* m.talk([
    ['Sheriff Dawes', 'Red Lockhart. Well, I\'ll be.'],
    ['Sheriff Dawes', 'Two hundred dollars, as promised. This valley owes you, Cole Brennan.'],
    ['Cole', 'Tell Gus to save me a plate.'],
  ], sheriff);
}
