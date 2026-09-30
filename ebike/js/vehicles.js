import * as THREE from 'three';
import { COP, HEAT, CITY, TRAFFIC } from './config.js';
import { nodePos, nearestNode, hash } from './world.js';
import { circleCircle, clamp, wrap } from './collision.js';

const OFFS = [-1.55, 0, 1.55];            // three circles along the car's length
const P = CITY.period;
const CIV_COLORS = [0x7a0f14, 0x0e2c5a, 0x1d3d2a, 0xb7b9bc, 0x2b2c30, 0xd8d3c4, 0x4a2f5a, 0x8a5a1c, 0x0f5b6b];

const BIKE_OFFS = [-0.55, 0, 0.55];

class Vehicle {
  constructor(kind, model, scene, isBike = false) {
    this.isBike = isBike;
    this.offs = isBike ? BIKE_OFFS : OFFS;
    this.kind = kind;                       // 'cop' | 'civ'
    this.obj = new THREE.Group();
    this.model = model;
    this.obj.add(model);
    this.obj.visible = false;
    scene.add(this.obj);
    this.wheels = (isBike ? ['wheel_f', 'wheel_r'] : ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']).map((n) => model.getObjectByName(n));
    this.active = false;
    this.mats = {};
    // per-vehicle material copies so lights / paint can differ between instances
    model.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => {
        if (['pl_red', 'pl_blue', 'taillight', 'paint', 'hoodie', 'delivery_pack', 'helmet', 'underglow', 'hivis'].includes(m.name)) {
          if (!this.mats[m.name]) this.mats[m.name] = m.clone();
          return this.mats[m.name];
        }
        return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      o.castShadow = true;
    });
    this.tailBase = this.mats.taillight ? this.mats.taillight.emissiveIntensity : 1;
    if (isBike) {   // police e-bike rider: navy jacket, white helmet, flashing underglow
      this.mats.hoodie.color.setHex(0x0b1a44);
      this.mats.delivery_pack.color.setHex(0xe8ecf5);
      this.mats.hivis.color.setHex(0x1b4dff);
      this.mats.underglow.emissive.setHex(0xff2020);
    }
    this.radius = isBike ? 0.55 : kind === 'cop' ? COP.radius : 1.0;
    this.mass = isBike ? 1.4 : kind === 'cop' ? 3 : 2.6;
    this.flashPhase = Math.random() * 6;
    this.sprites = [];
    if (kind === 'cop') this.addFlashSprites();
  }

  addFlashSprites() {
    const mk = (color, x) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: Vehicle.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
      }));
      s.position.set(this.isBike ? x * 0.8 : x, this.isBike ? 1.95 : 1.7, this.isBike ? 0.05 : 0.25);
      s.scale.setScalar(this.isBike ? 1.5 : 2.4);
      this.obj.add(s);
      return s;
    };
    this.sRed = mk(0xff1a1a, -0.3);
    this.sBlue = mk(0x2a5bff, 0.3);
  }

  reset(x, z, h, speed) {
    this.x = x; this.z = z; this.h = h;
    this.vx = -Math.sin(h) * speed; this.vz = -Math.cos(h) * speed;
    this.hp = this.isBike ? 22 : this.kind === 'cop' ? COP.hp : 40;
    this.disabled = false;
    this.deadT = 0;
    this.active = true;
    this.obj.visible = true;
    this.dir = { dx: Math.round(-Math.sin(h)), dz: Math.round(-Math.cos(h)) };
    this.pending = null;
    this.node = null;
    this.lane = 0;
    this.mode = 'route';
    this.stuckT = 0;
    this.reverseT = 0;
    this.spin = 0;
    this.contactT = -99;            // last time the player touched this car
    this.nearMin = 99;
    this.smokeT = 0;
    this.brake = false;
    this.wheelSpin = 0;
    this.sync();
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fx() { return -Math.sin(this.h); }
  get fz() { return -Math.cos(this.h); }

  circle(i) { return [this.x + this.fx * this.offs[i], this.z + this.fz * this.offs[i]]; }

  /** Point the nav state at the road we are on (after pursuit or spawn). */
  snapToRoad() {
    const fx = this.fx, fz = this.fz;
    if (Math.abs(fx) > Math.abs(fz)) {
      const u = (this.x - 50) / P;
      this.dir = { dx: Math.sign(fx), dz: 0 };
      this.node = { i: fx > 0 ? Math.ceil(u + 0.02) : Math.floor(u - 0.02), j: Math.round((this.z - 50) / P) };
    } else {
      const u = (this.z - 50) / P;
      this.dir = { dx: 0, dz: Math.sign(fz) };
      this.node = { i: Math.round((this.x - 50) / P), j: fz > 0 ? Math.ceil(u + 0.02) : Math.floor(u - 0.02) };
    }
    this.pending = null;
  }

  /** Physics: drive toward a speed and a heading. */
  drive(dt, targetSpeed, wantH, grip = 6.5) {
    const fx = this.fx, fz = this.fz;
    const rx = Math.cos(this.h), rz = -Math.sin(this.h);
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const accel = this.isBike ? 18 : this.kind === 'cop' ? COP.accel : 6;
    const dv = targetSpeed - vf;
    vf += clamp(dv, -30 * dt, accel * dt);
    this.brake = dv < -2;
    const err = wrap(wantH - this.h);
    const maxYaw = clamp((this.isBike ? 22 : 16) / Math.max(Math.abs(vf), 4), 0.4, this.isBike ? 2.6 : 1.9);
    const yaw = clamp(err * 3.2, -maxYaw, maxYaw) * (vf < -0.5 ? -1 : 1);
    this.h += (yaw + this.spin) * dt;
    this.spin *= Math.exp(-3 * dt);
    vl *= Math.exp(-grip * dt);
    const nfx = -Math.sin(this.h), nfz = -Math.cos(this.h), nrx = Math.cos(this.h), nrz = -Math.sin(this.h);
    this.vx = nfx * vf + nrx * vl;
    this.vz = nfz * vf + nrz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.wheelSpin -= vf * dt / 0.37;
  }

  sync() {
    this.obj.position.set(this.x, 0, this.z);
    this.obj.rotation.y = this.h;
    for (const w of this.wheels) if (w) w.rotation.x = this.wheelSpin;
    if (this.mats.taillight) this.mats.taillight.emissiveIntensity = this.tailBase * (this.brake || this.disabled ? 3.2 : 1);
  }
}

export class Vehicles {
  constructor(assets, scene, world, fx, audio, events) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.events = events;
    Vehicle.glowTex = world.glowTex;
    this.cops = [];
    this.civs = [];
    for (let i = 0; i < 6; i++) this.cops.push(new Vehicle('cop', assets.police.clone(true), scene));
    for (let i = 0; i < 3; i++) this.cops.push(new Vehicle('cop', assets.ebike.clone(true), scene, true));
    const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sedan', 'sedan', 'van'];
    for (let i = 0; i < TRAFFIC.count + 4; i++) {
      const v = new Vehicle('civ', assets[kinds[i % kinds.length]].clone(true), scene);
      if (v.mats.paint && kinds[i % kinds.length] !== 'taxi') v.mats.paint.color.setHex(CIV_COLORS[(i * 5 + 3) % CIV_COLORS.length]);
      if (kinds[i % kinds.length] === 'taxi') v.mats.paint.color.setHex(0xd9a400);
      this.civs.push(v);
    }
    this.all = [...this.cops, ...this.civs];
    // point lights that ride on the nearest police cars
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(i % 2 ? 0x2a5bff : 0xff2020, 0, 30, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.copSpawnT = 0;
    this.bust = 0;
    this.nearest = [];
    this.diff = { speed: 1, cops: 0, score: 1, bust: 1 };
  }

  reset(player) {
    for (const v of this.all) { v.active = false; v.obj.visible = false; }
    this.bust = 0;
    this.copSpawnT = 0.5;
  }

  get activeCops() { return this.cops.filter((c) => c.active && !c.disabled); }

  // ---------------------------------------------------------------- spawning
  /** Pick a spot on the road grid. where: 'any' | 'behind' | 'ahead'. `face` makes the car point at the player. */
  roadSpawn(player, dMin, dMax, where = 'any', face = false) {
    for (let tries = 0; tries < 12; tries++) {
      const d = dMin + Math.random() * (dMax - dMin);
      let a = Math.random() * Math.PI * 2;
      if (where === 'behind') a = Math.atan2(-player.fz0, -player.fx0) + (Math.random() - 0.5) * 2.2;
      if (where === 'ahead') a = Math.atan2(player.fz0, player.fx0) + (Math.random() - 0.5) * 1.0;
      const px = player.x + Math.cos(a) * d, pz = player.z + Math.sin(a) * d;
      const alongZ = Math.random() < 0.5;
      let x, z, dir, h;
      const lane = CITY.laneOffsets[Math.floor(Math.random() * 2)];
      if (alongZ) {
        const rx = 50 + P * Math.round((px - 50) / P);
        dir = face ? (player.z > pz ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
        x = rx + lane * -dir; z = pz;                // right-hand traffic: heading +z drives on -x side
        h = Math.atan2(0, -dir);
      } else {
        const rz = 50 + P * Math.round((pz - 50) / P);
        dir = face ? (player.x > px ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
        x = px; z = rz + lane * dir;
        h = Math.atan2(-dir, 0);
      }
      const dd = Math.hypot(x - player.x, z - player.z);
      if (dd < dMin * 0.85) continue;
      if (dd < 115) {   // don't pop in front of the camera
        const dot = ((x - player.x) * player.fx0 + (z - player.z) * player.fz0) / dd;
        if (dot > 0.1) continue;
      }
      if (this.all.some((v) => v.active && Math.hypot(v.x - x, v.z - z) < 9)) continue;
      return { x, z, h };
    }
    return null;
  }

  spawnCop(player, heat) {
    // from 3 stars up, police riders on e-bikes join the pursuit (nimble, fragile)
    const wantBike = heat >= 3 && Math.random() < 0.4;
    const v = this.cops.find((c) => !c.active && c.isBike === wantBike) || this.cops.find((c) => !c.active);
    if (!v) return false;
    // at high heat some cruisers come at you head-on from ahead
    const ahead = heat >= 3 && Math.random() < 0.12 * heat;
    const s = ahead ? this.roadSpawn(player, 140, 200, 'ahead', true) : this.roadSpawn(player, COP.spawnMin, COP.spawnMax, 'behind', true);
    if (!s) return false;
    v.reset(s.x, s.z, s.h, 12);
    v.snapToRoad();
    v.lane = 0;
    this.events('cop-spawn', v);
    return true;
  }

  spawnCiv(player) {
    const v = this.civs.find((c) => !c.active);
    if (!v) return;
    const s = this.roadSpawn(player, TRAFFIC.spawnMin, TRAFFIC.spawnMax, 'any');
    if (!s) return;
    v.reset(s.x, s.z, s.h, 8);
    v.snapToRoad();
    v.lane = Math.random() < 0.5 ? 0 : 1;
    v.cruise = TRAFFIC.speed[0] + Math.random() * (TRAFFIC.speed[1] - TRAFFIC.speed[0]);
  }

  // ---------------------------------------------------------------- AI
  routeAim(v, player, heat) {
    if (!v.node) v.snapToRoad();
    const n = nodePos(v.node.i, v.node.j);
    const d = v.dir;
    const dist = Math.hypot(n.x - v.x, n.z - v.z);
    const laneOff = CITY.laneOffsets[v.lane];
    const right = (dd) => ({ x: -dd.dz, z: dd.dx });
    if (!v.pending && dist < 30) {
      const opts = [{ dx: d.dx, dz: d.dz }, { dx: -d.dz, dz: d.dx }, { dx: d.dz, dz: -d.dx }];
      if (v.kind === 'cop') {
        // greedy: pick the exit whose next node is nearest to where the player is heading
        const tx = player.x + player.vx * 2, tz = player.z + player.vz * 2;
        const scored = opts.map((o) => {
          const nx = n.x + o.dx * P, nz = n.z + o.dz * P;
          return { o, s: Math.hypot(nx - tx, nz - tz) + (o === opts[0] ? -6 : 0) + Math.random() * 30 };
        }).sort((a, b) => a.s - b.s);
        v.pending = scored[0].o;
      } else {
        const r = Math.random();
        v.pending = r < 0.62 ? opts[0] : r < 0.81 ? opts[1] : opts[2];
      }
    }
    let ax, az, turn = 0;
    if (v.pending) {
      const p = v.pending;
      const rr = right(p);
      const lane2 = CITY.laneOffsets[v.lane];
      ax = n.x + p.dx * 26 + rr.x * lane2;
      az = n.z + p.dz * 26 + rr.z * lane2;
      turn = (p.dx !== d.dx || p.dz !== d.dz) ? 1 : 0;
      if (dist < 9) {
        v.dir = p; v.node = { i: v.node.i + p.dx, j: v.node.j + p.dz }; v.pending = null;
      }
    } else {
      const rr = right(d);
      ax = n.x + rr.x * laneOff;
      az = n.z + rr.z * laneOff;
    }
    return { ax, az, turn, dist };
  }

  updateCop(v, dt, player, world, time, heat) {
    const dx = player.x - v.x, dz = player.z - v.z;
    const dist = Math.hypot(dx, dz);
    // rubber band: cruisers that fall far behind gun it to rejoin the chase
    const vmax = (COP.baseSpeed + heat * COP.speedPerHeat) * (v.isBike ? 1.1 : 1) * this.diff.speed * (dist > 110 ? 1 + Math.min(0.4, (dist - 110) / 150) : 1);
    let wantH, ax, az, tSpeed;
    const los = dist < 130 && world.lineClear(v.x, v.z, player.x, player.z);
    v.hasLos = los;
    if (los) {
      if (v.mode !== 'pursue') v.mode = 'pursue';
      const lead = Math.min(0.9, dist / 30);
      ax = player.x + player.vx * lead; az = player.z + player.vz * lead;
      const gap = dist - 12;
      tSpeed = clamp(player.speed + (gap > 0 ? gap * 0.35 : gap * 0.5), 5, vmax);
      if (dist < 6) tSpeed = Math.max(tSpeed, player.speed * 0.9);
    } else {
      if (v.mode === 'pursue') { v.mode = 'route'; v.snapToRoad(); }
      const r = this.routeAim(v, player, heat);
      ax = r.ax; az = r.az;
      tSpeed = vmax * (r.turn && r.dist < 42 ? 0.64 : 1);
    }
    wantH = Math.atan2(-(ax - v.x), -(az - v.z));
    const err = Math.abs(wrap(wantH - v.h));
    tSpeed *= 1 - 0.6 * Math.min(1, err / 1.4);
    // stuck: back up and re-aim
    if (v.reverseT > 0) {
      v.reverseT -= dt;
      v.drive(dt, -6, wantH + Math.PI * 0.0);
      return;
    }
    if (v.speed < 1.4 && tSpeed > 4) { v.stuckT += dt; if (v.stuckT > 1.4) { v.reverseT = 1.1; v.stuckT = 0; if (v.mode === 'route') v.snapToRoad(); } }
    else v.stuckT = Math.max(0, v.stuckT - dt);
    v.drive(dt, tSpeed, wantH);
  }

  updateCiv(v, dt, player, world) {
    const r = this.routeAim(v, player, 1);
    const wantH = Math.atan2(-(r.ax - v.x), -(r.az - v.z));
    let ts = (v.cruise || 10) * (r.turn && r.dist < 40 ? 0.6 : 1);
    // slow for whatever is in front of us
    const fx = v.fx, fz = v.fz;
    const check = (ox, oz, ovx, ovz) => {
      const rx = ox - v.x, rz = oz - v.z;
      const ahead = rx * fx + rz * fz;
      if (ahead < 1 || ahead > 22) return;
      const side = Math.abs(rx * -fz + rz * fx);
      if (side > 2.6) return;
      const lim = Math.max(0, (ahead - 6) * 0.9);
      ts = Math.min(ts, ovx * fx + ovz * fz + lim);
    };
    for (const o of this.all) if (o !== v && o.active) check(o.x, o.z, o.vx, o.vz);
    check(player.x, player.z, player.vx, player.vz);
    v.drive(dt, Math.max(0, ts), wantH, 7);
  }

  // ---------------------------------------------------------------- update
  update(dt, player, world, time, heat, wantCops) {
    // spawn management
    const cops = this.activeCops;
    if (player.alive) {
      this.copSpawnT -= dt;
      if (cops.length < wantCops && this.copSpawnT <= 0) {
        if (this.spawnCop(player, heat)) this.copSpawnT = 1.4;
        else this.copSpawnT = 0.4;
      }
    }
    const civs = this.civs.filter((c) => c.active).length;
    if (civs < TRAFFIC.count && Math.random() < dt * 8) this.spawnCiv(player);

    for (const v of this.all) {
      if (!v.active) continue;
      const dist = Math.hypot(v.x - player.x, v.z - player.z);
      if (dist > (v.kind === 'cop' ? COP.despawn : TRAFFIC.despawn)) { v.active = false; v.obj.visible = false; continue; }
      if (v.disabled) {
        v.deadT += dt;
        v.drive(dt, 0, v.h, 3);
        v.brake = true;
        this.smoke(v, dt);
        if (v.deadT > 14 && dist > 60) { v.active = false; v.obj.visible = false; }
      } else if (v.kind === 'cop') {
        this.updateCop(v, dt, player, world, time, heat);
      } else {
        this.updateCiv(v, dt, player, world);
      }
      this.collideWorld(v, world, time, player);
    }

    this.collideVehicles(time, player);
    if (player.alive) this.collidePlayer(player, time);
    this.nearMisses(player, time);

    this.bustUpdate(dt, player);
    for (const v of this.all) if (v.active) v.sync();
    this.flash(time, player);
  }

  smoke(v, dt) {
    v.smokeT -= dt;
    if (v.smokeT > 0) return;
    v.smokeT = 0.06;
    this.fx.smoke.emit(v.x + v.fx * 1.6, 0.9, v.z + v.fz * 1.6, (Math.random() - 0.5) * 0.8, 1.8, (Math.random() - 0.5) * 0.8, 1.8, 0.7, 0.18, 0.18, 0.2, 0.6, 2.8);
  }

  hurt(v, dmg, byPlayer, time) {
    if (v.disabled || dmg <= 0) return;
    v.hp -= dmg;
    if (v.hp <= 0) {
      v.disabled = true;
      v.deadT = 0;
      v.hp = 0;
      if (v.kind === 'cop') this.events('cop-down', { v, byPlayer: byPlayer || time - v.contactT < 3.5 });
      else this.events('civ-wreck', { v });
    }
  }

  collideWorld(v, world, time, player) {
    for (let iter = 0; iter < 2; iter++) {
      let any = false;
      for (let i = 0; i < 3; i++) {
        const [cx, cz] = v.circle(i);
        for (const h of world.collide(cx, cz, v.radius * 0.95, false)) {
          any = true;
          v.x += h.nx * h.depth; v.z += h.nz * h.depth;
          const vn = v.vx * h.nx + v.vz * h.nz;
          if (vn < 0) {
            v.vx -= 1.25 * vn * h.nx; v.vz -= 1.25 * vn * h.nz;
            const impact = -vn;
            // scraping along a wall bends the heading away from it
            const side = (h.nx * v.fz - h.nz * v.fx);
            v.spin += clamp(side, -1, 1) * Math.min(1.2, impact * 0.08) * (i === 0 ? -1 : 1);
            if (impact > 4) {
              this.hurt(v, (impact - 4) * 2.2, false, time);
              this.impactFx(cx - h.nx * v.radius, cz - h.nz * v.radius, impact, player);
            }
          }
        }
      }
      if (!any) break;
    }
  }

  impactFx(x, z, impact, player) {
    const n = Math.min(14, Math.floor(impact));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 2 + Math.random() * 6;
      this.fx.sparks.emit(x, 0.4 + Math.random() * 0.6, z, Math.cos(a) * s, 1 + Math.random() * 4, Math.sin(a) * s, 0.35 + Math.random() * 0.3, 0.13, 1, 0.75, 0.3, 1, 0, 14);
    }
    const d = Math.hypot(x - player.x, z - player.z);
    if (d < 45 && impact > 6) this.audio.crash(clamp(impact / 22, 0.15, 0.7) * (1 - d / 60));
  }

  collideVehicles(time, player) {
    const list = this.all.filter((v) => v.active);
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a], B = list[b];
        const dx = A.x - B.x, dz = A.z - B.z;
        if (dx * dx + dz * dz > 36) continue;
        let best = null;
        for (let i = 0; i < 3; i++) {
          const [ax, az] = A.circle(i);
          for (let j = 0; j < 3; j++) {
            const [bx, bz] = B.circle(j);
            const h = circleCircle(ax, az, A.radius, bx, bz, B.radius);
            if (h && (!best || h.depth > best.depth)) { best = h; best.px = (ax + bx) / 2; best.pz = (az + bz) / 2; }
          }
        }
        if (!best) continue;
        const wa = B.mass / (A.mass + B.mass), wb = 1 - wa;
        A.x += best.nx * best.depth * wa; A.z += best.nz * best.depth * wa;
        B.x -= best.nx * best.depth * wb; B.z -= best.nz * best.depth * wb;
        const rv = (A.vx - B.vx) * best.nx + (A.vz - B.vz) * best.nz;
        if (rv < 0) {
          const j = -(1.3) * rv;
          A.vx += best.nx * j * wa; A.vz += best.nz * j * wa;
          B.vx -= best.nx * j * wb; B.vz -= best.nz * j * wb;
          const impact = -rv;
          A.spin += (Math.random() - 0.5) * impact * 0.05;
          B.spin += (Math.random() - 0.5) * impact * 0.05;
          if (impact > 5) {
            this.hurt(A, (impact - 5) * 1.8, false, time);
            this.hurt(B, (impact - 5) * 1.8, false, time);
            this.impactFx(best.px, best.pz, impact, player);
          }
        }
      }
    }
  }

  collidePlayer(p, time) {
    for (const v of this.all) {
      if (!v.active) continue;
      const dx = v.x - p.x, dz = v.z - p.z;
      if (dx * dx + dz * dz > 25) continue;
      let best = null;
      for (const off of p.circleOff) {
        const bx = p.x + p.fx0 * off, bz = p.z + p.fz0 * off;
        for (let i = 0; i < 3; i++) {
          const [cx, cz] = v.circle(i);
          const h = circleCircle(bx, bz, 0.42, cx, cz, v.radius);
          if (h && (!best || h.depth > best.depth)) { best = h; best.px = (bx + cx) / 2; best.pz = (bz + cz) / 2; }
        }
      }
      if (!best) continue;
      v.contactT = time;
      const wp = v.mass / (v.mass + 1), wv = 1 - wp;
      p.x += best.nx * best.depth * wp; p.z += best.nz * best.depth * wp;
      v.x -= best.nx * best.depth * wv; v.z -= best.nz * best.depth * wv;
      const rv = (p.vx - v.vx) * best.nx + (p.vz - v.vz) * best.nz;
      if (rv < 0) {
        const j = -(1.25) * rv;
        p.vx += best.nx * j * wp; p.vz += best.nz * j * wp;
        v.vx -= best.nx * j * wv; v.vz -= best.nz * j * wv;
        const impact = -rv;
        v.spin += (Math.random() - 0.5) * impact * 0.08;
        if (impact > 2.5 && time - p.lastHit > 0.12) {
          p.damage((impact - 2.5) * 1.9, v.kind === 'cop' ? 'cop' : 'crash');
          p.lastHit = time;
          p.h += best.nx * p.fz0 * 0.0 + (Math.random() - 0.5) * 0.25;
          this.hurt(v, (impact - 2.5) * (p.boosting ? 2.6 : 1.7), true, time);
          this.audio.crash(clamp(impact / 18, 0.25, 1));
          this.impactFx(best.px, best.pz, impact * 1.4, p);
          if (v.kind === 'cop') this.events('cop-hit', v);
        }
      }
    }
  }

  nearMisses(p, time) {
    if (!p.alive) return;
    const sp = p.speed;
    for (const v of this.all) {
      if (!v.active) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < 5.5) { v.nearMin = Math.min(v.nearMin, d); }
      else if (v.nearMin < 99) {
        if (v.nearMin < 3.4 && sp > 12 && time - v.contactT > 2) this.events('near-miss', { v, d: v.nearMin });
        v.nearMin = 99;
      }
    }
  }

  bustUpdate(dt, p) {
    let n = 0;
    for (const c of this.cops) {
      if (!c.active || c.disabled) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < COP.bustRange) n++;
    }
    if (n > 0 && p.alive) {
      const slow = p.speed < 10 ? 1.7 : 0.55;
      this.bust += COP.bustRate * this.diff.bust * dt * slow * (1 + 0.5 * (n - 1));
    } else {
      this.bust = Math.max(0, this.bust - COP.bustDecay * dt);
    }
    this.bust = Math.min(1, this.bust);
    this.nearCount = n;
  }

  /** Flash the light bars, drive the point lights, and report nearest sirens for audio. */
  flash(time, player) {
    const list = this.cops.filter((c) => c.active && !c.disabled);
    list.sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    this.nearest = list;
    for (const c of this.cops) {
      if (!c.active) continue;
      const on = !c.disabled;
      const t = time * 7 + c.flashPhase;
      const a = on ? (Math.sin(t) > 0 ? 1 : 0) : 0;
      const b = on ? (Math.sin(t + 2.2) > 0 ? 1 : 0) : 0;
      if (c.isBike) {
        c.mats.underglow.emissive.setHex(a ? 0xff2020 : 0x2a50ff);
        c.mats.underglow.emissiveIntensity = on ? 7 : 0;
      } else {
        c.mats.pl_red.emissiveIntensity = 0.4 + a * 9;
        c.mats.pl_blue.emissiveIntensity = 0.4 + b * 9;
      }
      c.sRed.material.opacity = a * 0.6; c.sBlue.material.opacity = b * 0.6;
      c.sRed.visible = c.sBlue.visible = on;
      c._a = a; c._b = b;
    }
    this.lights.forEach((l, i) => {
      const c = list[Math.floor(i / 2)];
      if (!c) { l.intensity = 0; return; }
      const f = i % 2 ? c._b : c._a;
      l.intensity = f * 170;
      const side = i % 2 ? 0.6 : -0.6;
      l.position.set(c.x + side * Math.cos(c.h), 2.6, c.z - side * Math.sin(c.h));
    });
  }
}
