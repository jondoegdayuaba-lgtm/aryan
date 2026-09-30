// Life in the valley: deer that graze, notice you and bolt; birds circling by day; fireflies at
// night; and fish rising in the lake at dusk.
import * as THREE from 'three';
import { loadModel } from './models.js';
import { patchMaterial } from './atmosphere.js';
import { clamp, damp, hash2, lerp, smoothstep, angDiff } from './util.js';

const _w = { depth: 0 }, _n = { x: 0, y: 1, z: 0 }, _s = { forest: 0, trail: 0, shore: 0, lush: 0 };

class Deer {
  constructor(root, parts, x, z, world) {
    this.root = root; this.parts = parts; this.world = world;
    this.x = x; this.z = z; this.yaw = Math.random() * 6.28; this.speed = 0;
    this.state = 'graze'; this.timer = 2 + Math.random() * 6; this.phase = Math.random() * 6; this.head = 0.9;
    this.home = { x, z }; this.pitch = 0;
  }

  free(x, z) {
    const w = this.world;
    w.waterAt(x, z, _w);
    if (_w.depth > 0.1) return false;
    w.normalAt(x, z, _n);
    return _n.y > 0.8 && Math.abs(x) < 960 && Math.abs(z) < 960;
  }

  update(dt, player, sprint, time) {
    const dx = this.x - player.x, dz = this.z - player.z, d = Math.hypot(dx, dz);
    const danger = d < 26 || (d < 55 && sprint);
    if (danger && this.state !== 'flee') { this.state = 'flee'; this.timer = 6 + Math.random() * 4; this.fleeYaw = Math.atan2(-dx, -dz) + Math.PI + (Math.random() - 0.5) * 0.7; this.spooked = true; }
    else if (d < 65 && this.state === 'graze') { this.state = 'alert'; this.timer = 3 + Math.random() * 3; }
    this.timer -= dt;
    let target = 0, headTarget = 0.9;
    if (this.state === 'graze') { headTarget = 0.1 + 0.1 * Math.sin(time * 0.7 + this.phase); target = 0; if (this.timer <= 0) { this.state = Math.random() < 0.5 ? 'walk' : 'graze'; this.timer = 4 + Math.random() * 8; this.walkYaw = this.yaw + (Math.random() - 0.5) * 2.4; } }
    else if (this.state === 'alert') { headTarget = 1.1; target = 0; if (d > 80 || this.timer <= 0) { this.state = 'graze'; this.timer = 4; } else this.yaw += angDiff(Math.atan2(-dx, -dz) + Math.PI, this.yaw) * Math.min(1, dt * 3) * 0; }
    else if (this.state === 'walk') { headTarget = 0.7; target = 0.9; this.yaw += angDiff(this.walkYaw, this.yaw) * Math.min(1, dt * 1.2); if (this.timer <= 0) { this.state = 'graze'; this.timer = 5 + Math.random() * 8; } }
    else if (this.state === 'flee') { headTarget = 1.15; target = 7.5; this.yaw += angDiff(this.fleeYaw, this.yaw) * Math.min(1, dt * 4); if (this.timer <= 0 && d > 90) { this.state = 'graze'; this.timer = 5; } }
    this.speed = damp(this.speed, target, 3, dt);
    this.head = damp(this.head, headTarget, 4, dt);
    // move if the way ahead is open, otherwise turn away
    const nx = this.x - Math.sin(this.yaw) * this.speed * dt, nz = this.z - Math.cos(this.yaw) * this.speed * dt;
    if (this.speed > 0.05) {
      if (this.free(nx, nz) && this.free(nx - Math.sin(this.yaw) * 1.5, nz - Math.cos(this.yaw) * 1.5)) { this.x = nx; this.z = nz; }
      else { this.yaw += 1.6 * dt * 3; this.fleeYaw = (this.fleeYaw || 0) + 1.2; this.walkYaw = (this.walkYaw || 0) + 1.2; }
    }
    const y = this.world.heightAt(this.x, this.z);
    this.world.normalAt(this.x, this.z, _n);
    this.phase += dt * (this.speed * (this.speed > 3 ? 1.5 : 3.2));
    const swing = clamp(this.speed / 2.4, 0, 1) * (this.speed > 3 ? 0.9 : 0.5);
    const p = this.parts;
    this.root.position.set(this.x, y + (this.speed > 3 ? Math.abs(Math.sin(this.phase * 2)) * 0.12 : 0), this.z);
    this.pitch = damp(this.pitch, Math.atan2(-Math.sin(this.yaw) * _n.x + -Math.cos(this.yaw) * _n.z, _n.y) * 0.8, 4, dt);
    this.root.rotation.set(this.pitch * -1, this.yaw + Math.PI, 0, 'YXZ');
    const gallop = this.speed > 3;
    p.FL.rotation.x = Math.sin(this.phase) * swing; p.FR.rotation.x = Math.sin(this.phase + (gallop ? 0.4 : Math.PI)) * swing;
    p.BL.rotation.x = Math.sin(this.phase + (gallop ? 3.4 : Math.PI)) * swing; p.BR.rotation.x = Math.sin(this.phase + (gallop ? 3.8 : 0)) * swing;
    const hp = -0.75 + this.head * 0.95;
    for (const k of ['head', 'nose', 'antlers']) if (p[k]) p[k].rotation.x = -hp + 0.2;
  }
}

class Birds {
  constructor(scene, world) {
    this.world = world;
    const g = new THREE.BufferGeometry();
    // a body triangle and two wing triangles
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 0.12, 0, 0.3, -0.12, 0, 0.3, 0, 0, -0.1, 1.1, 0, 0.35, 0.1, 0, 0.35, 0, 0, -0.1, -1.1, 0, 0.35, -0.1, 0, 0.35], 3));
    g.setIndex([0, 2, 1, 3, 5, 4, 6, 7, 8]);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, side: THREE.DoubleSide, roughness: 1 });
    patchMaterial(mat, 'birds', (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        transformed.y += abs( position.x ) * sin( uTime * 8.0 + ph ) * 0.55;`);
    });
    this.count = 26;
    this.mesh = new THREE.InstancedMesh(g, mat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.b = Array.from({ length: this.count }, (_, i) => ({ r: 90 + (i % 5) * 45, a: Math.random() * 6.28, h: 70 + Math.random() * 90, s: 0.12 + Math.random() * 0.08, cx: world.lake.cx + (i % 3 - 1) * 260, cz: world.lake.cz + ((i >> 1) % 3 - 1) * 200 }));
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.sc = new THREE.Vector3(1.4, 1.4, 1.4);
  }
  update(dt, day, cloud, storm) {
    this.mesh.visible = day > 0.4 && storm < 0.3;
    if (!this.mesh.visible) return;
    const up = new THREE.Vector3(0, 1, 0);
    this.b.forEach((b, i) => {
      b.a += b.s * dt;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      const y = this.world.lakeY + b.h + Math.sin(b.a * 3 + i) * 6;
      this.p.set(x, y, z);
      this.q.setFromAxisAngle(up, -b.a - Math.PI / 2 + Math.PI);
      this.m.compose(this.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Wildlife {
  constructor(game) { this.g = game; this.deer = []; this.time = 0; this.fishT = 5; this.fireflyT = 0; }

  async load() {
    const g = this.g, w = g.world;
    const proto = await loadModel('deer');
    // choose meadows: grassy, gentle, away from sites and water
    const rnd = (s) => { const x = Math.sin(s * 91.7) * 43758.5; return x - Math.floor(x); };
    let herds = 0, tries = 0;
    while (herds < 7 && tries++ < 400) {
      const x = (rnd(tries * 3) - 0.5) * 1700, z = (rnd(tries * 7 + 1) - 0.5) * 1700;
      w.splatAt(x, z, _s); w.waterAt(x, z, _w); w.normalAt(x, z, _n);
      if (_w.depth > 0 || _s.forest > 0.35 || _s.trail > 0.1 || _n.y < 0.9) continue;
      if (Object.values(w.sites).some((s) => s.clear && Math.hypot(s.x - x, s.z - z) < 140)) continue;
      const n = 2 + ((rnd(tries) * 3) | 0);
      for (let i = 0; i < n; i++) this._spawn(proto, x + (rnd(tries + i) - 0.5) * 14, z + (rnd(tries * 2 + i) - 0.5) * 14, i === 0 && rnd(tries) > 0.5);
      herds++;
    }
    this.birds = new Birds(g.scene, w);
    // fireflies share the additive particle system's style: little pulsing points near the player
    this.fly = [];
  }

  _spawn(proto, x, z, stag) {
    const g = this.g, root = new THREE.Group(), scene = proto.clone(true);
    g.structures.skin(scene);
    const parts = {};
    scene.traverse((o) => { if (o.name.startsWith('DEER_')) parts[o.name.slice(5).replace('leg', '')] = o; });
    if (parts.antlers) parts.antlers.visible = stag;
    // legs pivot at the hips: reparent nothing; the exported origins already sit at the joints
    scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    root.add(scene);
    root.scale.setScalar(1.05 + Math.random() * 0.15);
    g.scene.add(root);
    this.deer.push(new Deer(root, parts, x, z, g.world));
  }

  update(dt) {
    const g = this.g, p = g.player;
    this.time += dt;
    const sprint = p.sprinting;
    for (const d of this.deer) {
      const dist = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
      d.root.visible = dist < 500;
      if (dist < 320) d.update(dt, p.pos, sprint, this.time);
    }
    this.birds?.update(dt, g.atmo.day, 0, g.atmo.weather.storm);
    // fish rising near the shore at dusk and dawn
    const dusk = g.atmo.day < 0.8 && g.atmo.night < 0.8 && g.atmo.weather.rain < 0.3;
    if (dusk && (this.fishT -= dt) <= 0) {
      this.fishT = 4 + Math.random() * 8;
      const L = g.world.lake, a = Math.random() * 6.28, r = 0.4 + Math.random() * 0.5;
      const x = L.cx + Math.cos(a) * L.rx * r * 0.9, z = L.cz + Math.sin(a) * L.rz * r * 0.9;
      if (Math.hypot(x - p.pos.x, z - p.pos.z) < 120) {
        for (let i = 0; i < 10; i++) g.fires.smoke.emit({ x, y: g.world.lakeY + 0.05, z, vx: (Math.random() - 0.5) * 1.6, vy: 1.5 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 1.6, life: 0.7, size0: 0.15, size1: 0.35, alpha: 0.6, c0: [0.9, 0.95, 1], c1: [0.9, 0.95, 1], grav: 6, drag: 0.4 });
        g.audio?.splash?.(0.35);
      }
    }
    // fireflies: a few pulsing lights around the player near water on calm nights
    const ok = g.atmo.night > 0.7 && g.atmo.weather.rain < 0.15;
    if (ok && (this.fireflyT -= dt) <= 0) {
      this.fireflyT = 0.16;
      const a = Math.random() * 6.28, r = 3 + Math.random() * 16, x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
      g.world.waterAt(x, z, _w);
      g.world.splatAt(x, z, _s);
      if (_w.depth <= 0 && _s.lush > 0.5) g.fires.flames.emit({ x, y: g.world.heightAt(x, z) + 0.5 + Math.random() * 1.6, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.05, vz: (Math.random() - 0.5) * 0.4, life: 3 + Math.random() * 2, size0: 0.12, size1: 0.12, alpha: 0.9, c0: [0.5, 1.2, 0.3], c1: [0.4, 1.0, 0.2], drag: 0.2 });
    }
  }
}
