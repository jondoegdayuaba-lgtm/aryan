// Cameras: a chase camera that swings out when the car slides, cockpit,
// bonnet and bumper views, and a TV director for the menu and replays.
import * as THREE from 'three';
import { locate, wrap } from './road.js';

const clamp = THREE.MathUtils.clamp;
// Foliage by tree type (pine, spruce, birch): where the crown starts and how
// wide it is, per unit of tree scale. Replay cameras try not to hide behind it.
const CROWN = [[7.5, 1.6], [0.9, 1.9], [3.8, 1.4]];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

export const VIEWS = ['chase', 'far', 'cockpit', 'bonnet', 'bumper'];

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.view = 'chase';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.shake = 0;          // trauma 0..1, decays
    this.fovBase = 62;
    this.tv = null;
    this._init = false;
    this.eye = null;                       // driver's eye point, set per car
    this.head = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this._prevVel = new THREE.Vector3();
  }

  cycle() {
    this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
    this._init = false;
  }

  bump(amount) { this.shake = Math.min(1, this.shake + amount); }

  snap() { this._init = false; }

  // Chase / onboard views following the physics car.
  follow(car, dt) {
    const cam = this.camera;
    const F = car.F, U = car.U;
    const speed = car.speed;
    // heading we sit behind: mostly where the car points, partly where it goes
    const heading = Math.atan2(F.x, F.z);
    let target = heading;
    if (speed > 3) {
      const moving = Math.atan2(car.vel.x, car.vel.z);
      let d = moving - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2) target = heading + d * 0.45;
    }
    if (!this._init) this.yaw = target;
    let dy = target - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (this.view === 'far' ? 3.2 : 4.2));

    if (this.view === 'chase' || this.view === 'far') {
      const far = this.view === 'far';
      const dist = (far ? 8.2 : 5.9) + Math.min(speed, 45) * 0.018;
      const height = far ? 2.9 : 1.95;
      const want = _v.set(-Math.sin(this.yaw) * dist, height, -Math.cos(this.yaw) * dist).add(car.pos);
      // don't dig into the ground behind
      const gh = this.world.heightAt(want.x, want.z) + 0.9;
      if (want.y < gh) want.y = gh;
      if (!this._init) { this.pos.copy(want); this.vel.set(0, 0, 0); this._init = true; }
      // critically damped spring that moves with the car: it lags a touch
      // when the car speeds up or brakes, but never falls behind at speed
      const k = far ? 34 : 46, c = 2 * Math.sqrt(k);
      _w.subVectors(want, this.pos).multiplyScalar(k).addScaledVector(_u.subVectors(car.vel, this.vel), c);
      this.vel.addScaledVector(_w, dt);
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y < gh) this.pos.y = gh;
      cam.position.copy(this.pos);
      this.look.copy(car.pos).addScaledVector(F, 2.2);
      this.look.y += 0.75;
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else if (this.view === 'cockpit' && this.eye) {
      // the driver's eyes: the head is thrown about by braking, cornering
      // and bumps, a little behind the car's own movement
      if (!this._init) { this._prevVel.copy(car.vel); this.head.set(0, 0, 0); this.headVel.set(0, 0, 0); }
      const acc = _w.subVectors(car.vel, this._prevVel).divideScalar(Math.max(dt, 1e-3));
      this._prevVel.copy(car.vel);
      acc.y += 9.81;
      // acceleration in the car's frame, pushing the head the other way
      const want = _v.set(-acc.dot(car.L) * 0.0045, -(acc.dot(car.U) - 9.81) * 0.0022, -acc.dot(F) * 0.0032);
      want.clampLength(0, 0.07);
      const k = 90, c = 2 * Math.sqrt(k) * 0.7;
      this.headVel.addScaledVector(_u.subVectors(want, this.head).multiplyScalar(k).addScaledVector(this.headVel, -c), dt);
      this.head.addScaledVector(this.headVel, dt);
      cam.position.copy(this.eye).add(this.head).applyQuaternion(car.quat).add(car.pos);
      cam.quaternion.copy(car.quat).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI));
      // look a touch down the road, and lean into the corner
      cam.quaternion.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), -0.05));
      cam.quaternion.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), THREE.MathUtils.clamp(this.head.x * 1.5, -0.04, 0.04)));
      cam.up.set(0, 1, 0);
      this._init = true;
    } else {
      // onboard: rigidly attached, rolls and pitches with the car
      const off = this.view === 'bonnet' ? [0, 0.62, 0.35] : [0, 0.05, 2.15];
      const S = car.spec;
      if (S.id === 'truck') off[1] += 0.6;
      cam.position.set(off[0], off[1], off[2]).applyQuaternion(car.quat).add(car.pos);
      cam.quaternion.copy(car.quat).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI));
      cam.up.set(0, 1, 0);
      this._init = true;
    }
    // shake: rough roads, landings and hits
    if (this.shake > 0) {
      const s = this.shake * this.shake * (this.view === 'chase' || this.view === 'far' ? 0.25 : 0.12);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.3;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    const fov = this.view === 'cockpit' ? this.fovBase + 6 + Math.min(1, speed / 45) * 4 : this.fovBase + Math.min(1, speed / 45) * 12 + (this.view === 'bumper' ? 6 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  // ---- Replays: a director cutting between trackside, helicopter and on-car cameras ----
  startReplay() { this.shot = null; this._shotAge = 0; this._lastType = null; this._covered = new Map(); this._clock = 0; this._hidden = 0; this._losT = 0; }

  // `wide` keeps to cameras that show the whole car (behind the results
  // card); 'menu' keeps to the trackside and helicopter cameras.
  replay(car, dt, wide = false) {
    const road = this.world.road, n = road.count;
    const loc = locate(road, car.pos.x, car.pos.z, this._tvHint ?? -1, 60);
    this._tvHint = loc.i;
    this._shotAge += dt;
    this._clock = (this._clock || 0) + dt;
    if (!this._covered) this.startReplay();
    const sh = this.shot;
    let cut = !sh || (wide && !this._allowed(sh.type, wide));
    if (sh && sh.type === 'tv') {
      const past = (loc.s - sh.s + n) % n;
      cut ||= car.pos.distanceTo(sh.pos) > 95 || this._shotAge > 11 || (past > 28 && past < n / 2 && this._shotAge > 1.2);
    } else if (sh) cut ||= this._shotAge > sh.len;
    // a camera that has lost sight of the car gives up
    if (sh && (sh.type === 'tv' || sh.type === 'heli')) {
      this._losT += dt;
      if (this._losT > 0.2) {
        this._losT = 0;
        const p = sh.type === 'tv' ? sh.pos : this.pos;
        this._hidden = this._clear(p, car.pos.x, car.pos.y + 0.4, car.pos.z) ? 0 : this._hidden + 0.2;
      }
      if (this._hidden > 0.7 && this._shotAge > 1) cut = true;
    }
    // jumps get their own camera: cut early to catch the take-off
    if (!cut && sh && this._shotAge > 1 && !(sh.type === 'tv' && sh.jump) && this._jumpAhead(loc, car.speed)) cut = true;
    if (cut) this._cut(car, loc, wide);
    const cam = this.camera, s = this.shot;
    if (cut) this._hidden = 0;
    let fov = s.fov;
    switch (s.type) {
      case 'tv': {
        cam.position.copy(s.pos);
        this.look.lerp(_v.copy(car.pos).setY(car.pos.y + 0.45), cut ? 1 : Math.min(1, dt * 7));
        cam.up.set(0, 1, 0);
        cam.lookAt(this.look);
        // the operator zooms to keep the car the same size
        const d = cam.position.distanceTo(car.pos);
        fov = clamp(s.fov * s.frame / Math.max(d, 6), 7, 60);
        break;
      }
      case 'heli': {
        // high and wide, drifting round the car
        s.ang += dt * s.orbit;
        const want = _v.set(Math.sin(s.ang) * s.dist, s.height, Math.cos(s.ang) * s.dist).add(car.pos);
        if (cut) { this.pos.copy(want); this.vel.set(0, 0, 0); }
        const k = 3, c = 2 * Math.sqrt(k);
        _w.subVectors(want, this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
        this.vel.addScaledVector(_w, dt);
        this.pos.addScaledVector(this.vel, dt);
        cam.position.copy(this.pos);
        this.look.lerp(car.pos, cut ? 1 : Math.min(1, dt * 5));
        cam.up.set(0, 1, 0);
        cam.lookAt(this.look);
        break;
      }
      case 'chase': {
        const saved = this.view;
        this.view = 'chase';
        if (cut) this._init = false;
        this.follow(car, dt);
        this.view = saved;
        fov = null;
        break;
      }
      default: {
        // mounted on the car (low by a wheel, on the roof), or a tracking
        // vehicle ahead that follows the car's heading but not its roll
        const q = s.type === 'front' ? _q.setFromAxisAngle(_w.set(0, 1, 0), Math.atan2(car.F.x, car.F.z)) : car.quat;
        cam.position.copy(s.mount).applyQuaternion(q).add(car.pos);
        _w.copy(s.aim).applyQuaternion(q).add(car.pos);
        if (s.type === 'front') cam.up.set(0, 1, 0);
        else cam.up.copy(car.U);
        cam.lookAt(_w);
      }
    }
    if (fov !== null) {
      cam.fov = cut ? fov : cam.fov + (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    this._init = false;
  }

  _allowed(type, wide) {
    if (!wide) return true;
    return type === 'tv' || type === 'heli' || (wide !== 'menu' && type === 'chase');
  }

  _jumpAhead(loc, speed) {
    const n = this.world.road.count;
    for (const f of this.features || []) {
      if (f.type !== 'jump' || this._clock - (this._covered.get(f.s) ?? -1e9) < 45) continue;
      const ahead = (f.s - loc.s + n) % n;
      if (ahead > 20 && ahead < 25 + Math.max(55, speed * 3)) return f;
    }
    return null;
  }

  _cut(car, loc, wide) {
    this._shotAge = 0;
    this._hidden = 0;
    const speed = car.speed;
    // a jump coming up gets a low camera beside the landing
    const jump = this._jumpAhead(loc, speed);
    if (jump) {
      this._covered.set(jump.s, this._clock);
      const tv = this._placeTV(jump.s + 12 + speed * 0.15, [0.6, 1.4], [5.2, 8], jump.s - 12, jump.s + 30);
      if (tv) { tv.jump = true; tv.frame = 17; this.shot = tv; this._lastType = 'tv'; return; }
    }
    // the replay opens on a trackside camera watching the launch
    let type = 'tv';
    if (this.forceShot) { type = this.forceShot; this.forceShot = null; }
    else if (this._lastType) {
      const types = [['tv', 5], ['heli', 1.3], ['chase', 1], ['wheel', 1.1], ['roof', 1], ['front', 0.9]]
        .filter(([t]) => (t === 'tv' || t !== this._lastType) && this._allowed(t, wide));
      let r = Math.random() * types.reduce((a, [, w]) => a + w, 0);
      for (const [t, w] of types) { if ((r -= w) <= 0) { type = t; break; } }
    }
    if (type === 'tv') {
      const ahead = this._lastType ? clamp(speed * 2.4, 30, 75) : 45;
      // like the photographers and TV crews: at the roadside, a little above it
      const tv = this._placeTV(loc.s + ahead, [1.3, 4.5], [4.8, 10], loc.s + ahead - 25, loc.s + ahead + 25);
      if (tv) { this.shot = tv; this._lastType = 'tv'; return; }
      type = 'heli';
    }
    const len = 3.2 + Math.random() * 2.2;
    const S = car.spec, side = Math.random() < 0.5 ? -1 : 1;
    const hx = S.track / 2, rear = S.frontAxle - S.wheelbase;
    switch (type) {
      case 'heli': {
        // above the treetops, somewhere it can see the car
        const back = Math.atan2(-car.F.x, -car.F.z);
        let best = null;
        for (let k = 0; k < 8 && !best; k++) {
          const sh = { type, len: len + 1.5, fov: 24 + Math.random() * 10, ang: back + side * (0.5 + Math.random() * 1.2), orbit: side * (0.06 + Math.random() * 0.08), dist: 30 + Math.random() * 18, height: 34 + Math.random() * 18 };
          const p = new THREE.Vector3(Math.sin(sh.ang) * sh.dist, sh.height, Math.cos(sh.ang) * sh.dist).add(car.pos);
          if (this._clear(p, car.pos.x, car.pos.y + 0.4, car.pos.z) || k === 7) best = sh;
        }
        this.shot = best;
        break;
      }
      case 'wheel':
        this.shot = { type, len, fov: 58, mount: new THREE.Vector3(side * (hx + 0.95), 0.12, rear + 0.2), aim: new THREE.Vector3(side * (hx + 0.35), 0.0, 12) };
        break;
      case 'roof':
        // just above the front of the roof, ahead of the aerial
        this.shot = { type, len, fov: 62, mount: new THREE.Vector3(-0.15, S.body.centre[1] + S.body.half[1] + 0.32, 0.15), aim: new THREE.Vector3(-0.15, 0.25, 12) };
        break;
      case 'front':
        // a tracking shot from ahead and to the side, looking back at the car
        this.shot = { type, len, fov: 46, mount: new THREE.Vector3(side * 2.1, 0.5, S.frontAxle + 2.9), aim: new THREE.Vector3(0, 0.3, -0.4) };
        break;
      default:
        this.shot = { type: 'chase', len, fov: 62 };
    }
    this._lastType = type;
  }

  // Find a spot beside the road near distance `s` that can see the stretch s0..s1.
  _placeTV(s, heights, offsets, s0, s1) {
    const road = this.world.road, n = road.count;
    let best = null, bestScore = 0.55;
    for (let k = 0; k < 14; k++) {
      const i = wrap(Math.round(s + (Math.random() - 0.5) * 16), n);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = offsets[0] + Math.random() * (offsets[1] - offsets[0]);
      const lx = road.tz[i] * side, lz = -road.tx[i] * side;
      const p = new THREE.Vector3(road.x[i] + lx * off, 0, road.z[i] + lz * off);
      const ground = this.world.heightAt(p.x, p.z);
      p.y = Math.max(ground, road.y[i] - 0.5) + heights[0] + Math.random() * (heights[1] - heights[0]);
      if (this._inTree(p)) continue;
      let vis = 0, tot = 0;
      for (let t = s0; t <= s1; t += 5) {
        const j = wrap(Math.round(t), n);
        tot++;
        if (this._clear(p, road.x[j], road.y[j] + 0.7, road.z[j])) vis++;
      }
      const score = vis / tot + Math.random() * 0.05;
      if (score > bestScore) { bestScore = score; best = { type: 'tv', pos: p, s: i, fov: 30, frame: 14 + Math.random() * 10 }; }
      if (bestScore > 0.95) break;
    }
    return best;
  }

  _inTree(p) {
    let hit = false;
    this.world.forObstacles(p.x, p.z, 4, (o) => {
      if (o.kind === 'tree' && Math.hypot(o.x - p.x, o.z - p.z) < o.r + CROWN[o.tree.type][1] * o.tree.scale) hit = true;
      if (o.kind === 'rock' && Math.hypot(o.x - p.x, o.z - p.z) < o.r + 0.5) hit = true;
    });
    return hit;
  }

  // Line of sight from a to (bx, by, bz): terrain, trunks and crowns block it.
  _clear(a, bx, by, bz) {
    const w = this.world;
    const dx = bx - a.x, dy = by - a.y, dz = bz - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return true;
    const steps = Math.ceil(len / 2);
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      if (w.heightAt(a.x + dx * u, a.z + dz * u) > a.y + dy * u - 0.25) return false;
    }
    let blocked = false;
    const test = (o) => {
      if (blocked || o.kind !== 'tree') return;
      const t = clamp(((o.x - a.x) * dx + (o.z - a.z) * dz) / (len * len), 0, 1);
      const ex = a.x + dx * t - o.x, ez = a.z + dz * t - o.z;
      const hy = a.y + dy * t - o.y;
      // the visible tree: taller than its trunk's collision height, and bushy
      const [start, crown] = CROWN[o.tree.type];
      const r = hy > start * o.tree.scale ? crown * o.tree.scale : o.r + 0.1;
      if (hy < 17 * o.tree.scale && ex * ex + ez * ez < r * r) blocked = true;
    };
    for (let k = 0; k <= len / 6 && !blocked; k++) {
      const u = Math.min(1, (k * 6) / len);
      w.forObstacles(a.x + dx * u, a.z + dz * u, 4.5, test);
    }
    return !blocked;
  }

  // Slow orbit around a point (garage / title screen).
  orbit(center, radius, height, time, speed = 0.12) {
    const a = time * speed;
    this.camera.position.set(center.x + Math.sin(a) * radius, center.y + height, center.z + Math.cos(a) * radius);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center.x, center.y + 0.6, center.z);
    this._init = false;
  }
}
