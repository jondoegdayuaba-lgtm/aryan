// Chunky low-poly particles: exhaust fire, smoke puffs, explosions, debris, wind streaks.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

class Pool {
  constructor(scene, material, size, geometry) {
    this.mesh = new THREE.InstancedMesh(geometry, material, size);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set('#ffffff'));
    scene.add(this.mesh);
    this.size = size;
    this.parts = [];
  }

  spawn(p) {
    if (this.parts.length >= this.size) this.parts.shift();
    p.age = -(p.delay ?? 0);
    p.rot = p.rot ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, 0));
    this.parts.push(p);
  }

  update(dt, eye = null) {
    let n = 0;
    const keep = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      keep.push(p);
      if (p.age < 0) continue;  // delayed start
      if (p.gravity) p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.floor && p.pos.y < p.size * 0.5) { p.pos.y = p.size * 0.5; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7; }
      const t = p.age / p.life;
      // 'puff' grows fast then shrinks slowly; 'shrink' just shrinks.
      const k = p.curve === 'puff' ? Math.min(1, t * 6) * (1 - t) ** 0.8 * 1.25 : 1 - t;
      let s = p.size * k;
      // Shrink puffs that get close to the camera so they never fill the screen.
      if (eye) s *= Math.min(1, Math.max(0, (p.pos.distanceTo(eye) - 2 - s * 0.5) / 5));
      s = Math.max(0.001, s);
      _m.compose(p.pos, p.rot, _s.set(s, s, s));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.parts = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.parts = [];
    this.mesh.count = 0;
  }
}

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const ico = new THREE.IcosahedronGeometry(0.5, 0);
    this.fire = new Pool(scene, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), 500, ico);
    this.smoke = new Pool(scene, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), 700, ico);
    this.debris = new Pool(scene, new THREE.MeshLambertMaterial({ color: '#ffffff' }), 160, new THREE.BoxGeometry(0.5, 0.5, 0.5));
    this.smoke.mesh.castShadow = true;

    // Bright flash light used for explosions.
    this.flash = new THREE.PointLight('#ff9a3a', 0, 90, 1.4);
    scene.add(this.flash);
    this.flashT = 0;

    // Thin white streaks that rush past when flying fast.
    this.streakCount = 36;
    this.streaks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.035, 0.035, 5),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
      this.streakCount,
    );
    this.streaks.frustumCulled = false;
    this.streakData = [];
    for (let i = 0; i < this.streakCount; i++) this.streakData.push({ off: new THREE.Vector3(), z: 0 });
    scene.add(this.streaks);
    this.shake = 0;
    this._acc = 0;
  }

  // Called every frame while the engine burns. Just sparks off the flame, no smoke trail.
  exhaust(pos, backDir, speed, throttle, dt) {
    this._acc += dt * (60 + throttle * 80);
    while (this._acc > 1) {
      this._acc -= 1;
      const jitter = () => (Math.random() - 0.5) * 0.35;
      const p = pos.clone().add(new THREE.Vector3(jitter(), jitter(), jitter()));
      this.fire.spawn({
        pos: p, vel: backDir.clone().multiplyScalar(6 + Math.random() * 6),
        life: 0.07 + Math.random() * 0.08, size: 0.45 + throttle * 0.3, curve: 'shrink',
        color: new THREE.Color().setHSL(0.07 + Math.random() * 0.06, 1, 0.55 + Math.random() * 0.15),
      });
    }
  }

  explode(pos, scale = 1) {
    const rand = (a) => (Math.random() - 0.5) * a;
    const fireCols = ['#ff4a1a', '#ff7a1a', '#ffa21f', '#ffd27a', '#f23a1a'];
    for (let i = 0; i < 20; i++) {
      this.fire.spawn({
        pos: pos.clone().add(new THREE.Vector3(rand(4), rand(3) + 1, rand(4)).multiplyScalar(scale)),
        vel: new THREE.Vector3(rand(10), 3 + Math.random() * 6, rand(10)).multiplyScalar(scale), drag: 3,
        life: 0.8 + Math.random() * 0.8, size: (3.5 + Math.random() * 4) * scale, curve: 'puff',
        delay: i < 12 ? 0 : Math.random() * 0.15,
        color: new THREE.Color(fireCols[i % fireCols.length]),
      });
    }
    for (let i = 0; i < 12; i++) {
      const g = 0.05 + Math.random() * 0.1;
      this.smoke.spawn({
        pos: pos.clone().add(new THREE.Vector3(rand(6), 2 + Math.random() * 4, rand(6)).multiplyScalar(scale)),
        vel: new THREE.Vector3(rand(5), 5 + Math.random() * 5, rand(5)).multiplyScalar(scale), drag: 1.2,
        life: 2 + Math.random() * 1.2, size: (3 + Math.random() * 4) * scale, curve: 'puff',
        delay: 0.2 + Math.random() * 0.35,
        color: new THREE.Color(g, g * 0.95, g * 1.05),
      });
    }
    for (let i = 0; i < 22; i++) {
      this.debris.spawn({
        pos: pos.clone().add(new THREE.Vector3(0, 1, 0)),
        vel: new THREE.Vector3(rand(40), 10 + Math.random() * 22, rand(40)).multiplyScalar(Math.sqrt(scale)),
        gravity: 40, floor: true, life: 1.4 + Math.random() * 1.2, size: 0.4 + Math.random() * 0.9, curve: 'shrink',
        color: new THREE.Color(Math.random() < 0.5 ? '#2b2a30' : '#5a5560'),
      });
    }
    this.flash.position.copy(pos).y += 3;
    this.flashT = 1;
    this.shake = Math.max(this.shake, 0.9 * scale);
  }

  // Little burst of orange when the float pods pop.
  pop(pos) {
    for (let i = 0; i < 14; i++) {
      this.debris.spawn({
        pos: pos.clone(), vel: new THREE.Vector3().randomDirection().multiplyScalar(8 + Math.random() * 8),
        gravity: 20, life: 0.6 + Math.random() * 0.4, size: 0.3 + Math.random() * 0.3, curve: 'shrink',
        color: new THREE.Color('#ff7a1a'),
      });
    }
    this.shake = Math.max(this.shake, 0.35);
  }

  sparkle(pos, color) {
    for (let i = 0; i < 18; i++) {
      this.fire.spawn({
        pos: pos.clone(), vel: new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 6), drag: 2,
        life: 0.5 + Math.random() * 0.3, size: 0.5 + Math.random() * 0.4, curve: 'shrink', color: new THREE.Color(color),
      });
    }
  }

  // Streaks sit in a tube around the missile and slide backwards relative to it.
  updateStreaks(dt, origin, fwd, speedFactor) {
    const show = speedFactor > 0.05;
    this.streaks.visible = show;
    if (!show) return;
    this.streaks.material.opacity = 0.5 * speedFactor;
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);
    for (let i = 0; i < this.streakCount; i++) {
      const d = this.streakData[i];
      d.z += dt * (60 + 90 * speedFactor);
      if (d.z > 30 || d.off.lengthSq() === 0) {
        const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 6;
        d.off.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        d.z = -30 + Math.random() * 20;
      }
      _s.set(d.off.x, d.off.y, d.z).applyQuaternion(_q).add(origin);
      _m.compose(_s, _q, new THREE.Vector3(1, 1, 0.6 + speedFactor));
      this.streaks.setMatrixAt(i, _m);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this.fire.update(dt, this.camera.position);
    this.smoke.update(dt, this.camera.position);
    this.debris.update(dt);
    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    this.flash.intensity = this.flashT * this.flashT * 400;
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  clear() {
    this.fire.clear();
    this.smoke.clear();
    this.debris.clear();
  }
}
