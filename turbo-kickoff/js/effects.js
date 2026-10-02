// Particles, boost flames, the goal explosion and blob shadows.
import * as THREE from 'three';

function dotTexture(soft) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(soft ? 0.35 : 0.6, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Particles {
  constructor(scene, max, size) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: dotTexture(true), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
  }

  emit(p, v, color, life, { drag = 1, gravity = 0, intensity = 1 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r * intensity, color.g * intensity, color.b * intensity], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = gravity;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { this.pos[k + 1] = -1000; this.col.fill(0, k, k + 3); continue; }
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= damp; this.vel[k + 1] = this.vel[k + 1] * damp - this.grav[i] * dt; this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[k] = this.base[k] * f; this.col[k + 1] = this.base[k + 1] * f; this.col[k + 2] = this.base[k + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.small = new Particles(scene, 2500, 0.28);
    this.big = new Particles(scene, 900, 1.1);
    this.rings = [];
    this.flash = new THREE.PointLight(0xffffff, 0, 60, 1.5);
    scene.add(this.flash);
    this.shadowTex = dotTexture(false);
  }

  // Twin flames that hang off a car's BoostExit points
  addFlames(car, color) {
    const outerGeo = new THREE.ConeGeometry(0.075, 0.55, 10, 1, true);
    outerGeo.rotateX(-Math.PI / 2);
    outerGeo.translate(0, 0, -0.275);
    const innerGeo = new THREE.ConeGeometry(0.045, 0.32, 8, 1, true);
    innerGeo.rotateX(-Math.PI / 2);
    innerGeo.translate(0, 0, -0.16);
    const outerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const innerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    car.flames = car.exits.map((exit) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(outerGeo, outerMat), new THREE.Mesh(innerGeo, innerMat));
      g.visible = false;
      exit.add(g);
      return g;
    });
    car.flameColor = new THREE.Color(color);
  }

  addShadow(object, size) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    m.material.blending = THREE.NormalBlending;
    m.renderOrder = 1;
    this.scene.add(m);
    return m;
  }

  // Shadow straight down onto the floor; fades with height
  placeShadow(shadow, pos, size) {
    const h = pos.y;
    shadow.visible = h < 18;
    shadow.position.set(pos.x, 0.025, pos.z);
    const s = size * (1 + h * 0.05);
    shadow.scale.set(s, 1, s);
    shadow.material.opacity = Math.max(0, 0.6 - h * 0.03);
  }

  carFrame(car, dt, time) {
    if (!car.flames) return;
    for (const f of car.flames) {
      f.visible = car.boosting;
      if (car.boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.5 + (car.supersonic ? 0.4 : 0));
    }
    if (car.boosting) {
      for (const exit of car.exits) {
        exit.getWorldPosition(_p);
        _v.copy(car.fwd).multiplyScalar(-4 - Math.random() * 3).addScaledVector(car.vel, 0.6);
        _v.x += (Math.random() - 0.5) * 1.2; _v.y += (Math.random() - 0.5) * 1.2; _v.z += (Math.random() - 0.5) * 1.2;
        this.small.emit(_p, _v, car.flameColor, 0.35 + Math.random() * 0.2, { drag: 3, intensity: 1.6 });
      }
    }
    if (car.supersonic && Math.random() < 0.8) {
      _p.copy(car.pos).addScaledVector(car.right, (Math.random() - 0.5) * 0.9);
      this.small.emit(_p, _v.copy(car.vel).multiplyScalar(0.2), _c.set(0xffffff), 0.4, { drag: 2, intensity: 0.9 });
    }
  }

  sparks(pos, dir, strength, color = 0xffd27a) {
    const n = Math.min(60, 8 + strength * 2);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * strength * 0.4);
      _v.addScaledVector(dir, strength * 0.25);
      this.small.emit(pos, _v, _c, 0.4 + Math.random() * 0.4, { drag: 2.5, gravity: 4, intensity: 2 });
    }
  }

  pickup(pos, big) {
    _c.set(0xffb02b);
    for (let i = 0; i < (big ? 40 : 14); i++) {
      _v.set(Math.random() - 0.5, Math.random() * 1.5, Math.random() - 0.5).multiplyScalar(big ? 6 : 3);
      this.small.emit(pos, _v, _c, 0.5, { drag: 3, intensity: 2 });
    }
  }

  goalExplosion(pos, color) {
    const team = new THREE.Color(color);
    for (let i = 0; i < 420; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 22);
      const big = i % 3 === 0;
      (big ? this.big : this.small).emit(pos, _v, i % 5 === 0 ? _c.set(0xffffff) : team, 1 + Math.random() * 1.4,
        { drag: 1.6, gravity: 3, intensity: big ? 0.9 : 1.6 });
    }
    for (let k = 0; k < 2; k++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.12, 8, 64),
        new THREE.MeshBasicMaterial({ color: team.clone().multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.position.copy(pos);
      if (k === 1) ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      this.rings.push({ mesh: ring, t: 0 });
    }
    this.flash.color.copy(team);
    this.flash.position.copy(pos);
    this.flash.intensity = 120;
  }

  update(dt) {
    this.small.update(dt);
    this.big.update(dt);
    this.flash.intensity *= Math.exp(-dt * 4);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const s = 1 + r.t * 28;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, 1 - r.t / 1.1);
      if (r.t > 1.1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
