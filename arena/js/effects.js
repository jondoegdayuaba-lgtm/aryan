import * as THREE from 'three';

// Pooled visual effects: bullet tracers, impact sparks, hit puffs, explosions,
// rockets and grenades.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.bits = [];
    this.booms = [];

    // Tracers are pooled, never disposed: freeing the last line material would
    // make three.js drop its shader and recompile it on the next shot.
    for (let i = 0; i < 48; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIndex = 0;
    const bitGeo = new THREE.BoxGeometry(1, 1, 1);
    this.bitMats = new Map();
    for (let i = 0; i < 140; i++) {
      const m = new THREE.Mesh(bitGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false;
      scene.add(m);
      this.bits.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.1, gravity: 0 });
    }
    this.bitIndex = 0;
    const boomGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.booms.push({ mesh: m, life: 0, size: 1 });
    }
    this.boomIndex = 0;
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.07;
  }

  _bit(pos, vel, color, size, life, gravity) {
    const b = this.bits[this.bitIndex];
    this.bitIndex = (this.bitIndex + 1) % this.bits.length;
    b.mesh.position.copy(pos);
    b.mesh.material.color.setHex(color);
    b.mesh.material.opacity = 1;
    b.mesh.visible = true;
    b.mesh.scale.setScalar(size);
    b.vel.copy(vel);
    b.life = b.max = life;
    b.size = size;
    b.gravity = gravity;
  }

  sparks(pos, normal, color = 0xffd27a, n = 5) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4);
      if (normal) v.addScaledVector(normal, 3);
      this._bit(pos, v, color, 0.05 + Math.random() * 0.04, 0.25 + Math.random() * 0.2, 12);
    }
  }

  hitPuff(pos, color) {
    const v = new THREE.Vector3();
    for (let i = 0; i < 7; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(5);
      this._bit(pos, v, color, 0.08 + Math.random() * 0.06, 0.4 + Math.random() * 0.2, 14);
    }
  }

  // Death: the body pops into cubes of its colours.
  shatter(pos, colors) {
    const v = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      p.copy(pos).add(v.set(Math.random() - 0.5, Math.random() * 1.6, Math.random() - 0.5));
      v.set(Math.random() - 0.5, Math.random() * 1.2, Math.random() - 0.5).multiplyScalar(7);
      this._bit(p, v, colors[i % colors.length], 0.12 + Math.random() * 0.1, 0.8 + Math.random() * 0.4, 18);
    }
  }

  explosion(pos, radius) {
    const b = this.booms[this.boomIndex];
    this.boomIndex = (this.boomIndex + 1) % this.booms.length;
    b.mesh.position.copy(pos);
    b.mesh.visible = true;
    b.life = 0;
    b.size = radius;
    const v = new THREE.Vector3();
    for (let i = 0; i < 18; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 10);
      this._bit(pos, v, i % 3 ? 0x333333 : 0xffb030, 0.12 + Math.random() * 0.15, 0.6 + Math.random() * 0.5, 16);
    }
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.line.visible) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(t.life / 0.07, 0) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const b of this.bits) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      b.vel.y -= b.gravity * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.mesh.position.y < b.size / 2) { b.mesh.position.y = b.size / 2; b.vel.multiplyScalar(0.4); b.vel.y *= -0.5; }
      b.mesh.material.opacity = Math.min(1, b.life / b.max * 2);
    }
    for (const b of this.booms) {
      if (!b.mesh.visible) continue;
      b.life += dt;
      const k = b.life / 0.45;
      if (k >= 1) { b.mesh.visible = false; continue; }
      b.mesh.scale.setScalar(b.size * (0.3 + Math.sqrt(k) * 0.9));
      b.mesh.material.opacity = 1 - k;
      b.mesh.material.color.setHSL(0.09 - k * 0.07, 1, 0.6 - k * 0.3);
    }
  }
}

export function rocketMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x5b6b4a }));
  body.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), new THREE.MeshLambertMaterial({ color: 0xff5a2a }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.34;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 8), new THREE.MeshBasicMaterial({ color: 0xffc040 }));
  flame.rotation.x = Math.PI / 2;
  flame.position.z = 0.45;
  g.add(body, tip, flame);
  return g;
}

export function grenadeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f5a2e }));
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.06), new THREE.MeshLambertMaterial({ color: 0x888888 }));
  cap.position.y = 0.12;
  g.add(body, cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
