// Tyre smoke, skid marks and sparks off the walls.
import * as THREE from 'three';

const SKIDS = 1200;          // skid-mark quads kept before the oldest are reused
const SPARKS = 80;

export class Effects {
  constructor(scene, T) {
    this.puffs = [];
    for (let i = 0; i < 160; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, life: 0, max: 1, vel: new THREE.Vector3(), size: 1, grow: 1, alpha: 0.6 });
    }
    this.nextPuff = 0;

    this.skidPos = new Float32Array(SKIDS * 18);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.skids = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: '#26272c', transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.skids.frustumCulled = false;
    this.skids.renderOrder = 1;
    scene.add(this.skids);
    this.skidNext = 0;
    this.skidDirty = false;
    this.lastMark = [];

    this.sparkPos = new Float32Array(SPARKS * 3).fill(-9999);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkPoints = new THREE.Points(sg, new THREE.PointsMaterial({
      color: '#ffc04a', size: 0.32, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparkPoints.frustumCulled = false;
    scene.add(this.sparkPoints);
    this.sparks = Array.from({ length: SPARKS }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() }));
    this.nextSpark = 0;
  }

  // One puff of smoke (or dust, with a colour).
  puff(pos, drift, { size = 1.1, grow = 3.2, life = 1.1, alpha = 0.55, color = '#f1f2f5' } = {}) {
    const p = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % this.puffs.length;
    p.sprite.position.copy(pos);
    p.sprite.position.y += 0.25;
    p.sprite.material.color.set(color);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
    p.vel.copy(drift).multiplyScalar(0.25);
    p.vel.x += (Math.random() - 0.5) * 1.6;
    p.vel.y += 0.8 + Math.random() * 0.9;
    p.vel.z += (Math.random() - 0.5) * 1.6;
    p.size = size * (0.8 + Math.random() * 0.4);
    p.grow = grow;
    p.life = 0;
    p.max = life * (0.8 + Math.random() * 0.4);
    p.alpha = alpha;
  }

  // Lay a strip of rubber behind wheel `i`. Pass on = false to lift the pen.
  mark(i, pos, right, on) {
    const last = this.lastMark[i];
    if (!on) { this.lastMark[i] = null; return; }
    if (!last) { this.lastMark[i] = { p: pos.clone(), r: right.clone() }; return; }
    if (last.p.distanceToSquared(pos) < 0.25) return;
    const w = 0.2;
    const a1 = [last.p.x + last.r.x * w, last.p.y + 0.02, last.p.z + last.r.z * w];
    const a2 = [last.p.x - last.r.x * w, last.p.y + 0.02, last.p.z - last.r.z * w];
    const b1 = [pos.x + right.x * w, pos.y + 0.02, pos.z + right.z * w];
    const b2 = [pos.x - right.x * w, pos.y + 0.02, pos.z - right.z * w];
    this.skidPos.set([...a2, ...a1, ...b1, ...a2, ...b1, ...b2], this.skidNext * 18);
    this.skidNext = (this.skidNext + 1) % SKIDS;
    this.skidDirty = true;
    last.p.copy(pos);
    last.r.copy(right);
  }

  sparkBurst(pos, dir, n = 10) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.nextSpark];
      this.nextSpark = (this.nextSpark + 1) % SPARKS;
      s.life = 0.25 + Math.random() * 0.3;
      s.p.copy(pos);
      s.v.copy(dir).multiplyScalar(4 + Math.random() * 8);
      s.v.x += (Math.random() - 0.5) * 6;
      s.v.y += 2 + Math.random() * 5;
      s.v.z += (Math.random() - 0.5) * 6;
    }
  }

  update(dt) {
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.life += dt;
      if (p.life >= p.max) { p.sprite.visible = false; continue; }
      const t = p.life / p.max;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * 1.5));
      const s = p.size + p.grow * t;
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 8);
    }
    for (let i = 0; i < SPARKS; i++) {
      const s = this.sparks[i];
      if (s.life > 0) {
        s.life -= dt;
        s.v.y -= 25 * dt;
        s.p.addScaledVector(s.v, dt);
      }
      const o = i * 3;
      if (s.life > 0) { this.sparkPos[o] = s.p.x; this.sparkPos[o + 1] = s.p.y; this.sparkPos[o + 2] = s.p.z; } else this.sparkPos[o + 1] = -9999;
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    if (this.skidDirty) {
      this.skids.geometry.attributes.position.needsUpdate = true;
      this.skidDirty = false;
    }
  }

  clear() {
    for (const p of this.puffs) p.sprite.visible = false;
    for (const s of this.sparks) s.life = 0;
    this.skidPos.fill(0);
    this.skidDirty = true;
    this.lastMark = [];
  }

  liftPens() {
    this.lastMark = [];
  }
}
