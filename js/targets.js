// Tanks that drive around their patrol areas, plus the float-ring pickups.
import * as THREE from 'three';

const lambert = (color) => new THREE.MeshLambertMaterial({ color });

function buildTank() {
  const g = new THREE.Group();
  const olive = lambert('#56623f');
  const dark = lambert('#3b442c');
  const track = lambert('#26262a');
  const parts = [];
  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    m.userData.mat = mat;
    parent.add(m);
    parts.push(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.3, 1.3, 7.6), track, -2.05, 0.65, 0);
  add(new THREE.BoxGeometry(1.3, 1.3, 7.6), track, 2.05, 0.65, 0);
  add(new THREE.BoxGeometry(3.4, 1.1, 7.2), olive, 0, 1.45, 0);
  const glacis = add(new THREE.BoxGeometry(3.4, 0.9, 1.6), dark, 0, 1.35, -3.7);
  glacis.rotation.x = -0.5;
  add(new THREE.BoxGeometry(4.5, 0.25, 7.4), dark, 0, 1.95, 0);
  const turret = new THREE.Group();
  turret.position.set(0, 2.1, 0.4);
  g.add(turret);
  add(new THREE.BoxGeometry(3, 1.1, 3.6), olive, 0, 0.55, 0, turret);
  add(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 8), dark, 0.7, 1.3, 0.5, turret);
  const barrel = add(new THREE.CylinderGeometry(0.17, 0.2, 5.2, 8).rotateX(Math.PI / 2), dark, 0, 0.55, -4.2, turret);
  add(new THREE.BoxGeometry(0.6, 0.35, 0.8), dark, -0.8, 1.2, 1.2, turret);
  add(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), dark, -1.1, 2.1, 1.3, turret);
  return { group: g, turret, barrel, parts };
}

export class Tanks {
  constructor(scene, world, count = 9) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.charred = lambert('#1d1b1f');
    for (let i = 0; i < count; i++) {
      const t = buildTank();
      scene.add(t.group);
      const tank = { ...t, alive: true, respawn: 0, speed: 3 + Math.random() * 2.5, spawnAnim: 1, wreckT: 0 };
      this._place(tank, i % world.tankAreas.length);
      this.list.push(tank);
    }
  }

  _randomPoint(area) {
    const [x, z, r] = area;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      const p = new THREE.Vector3(x + Math.cos(a) * d, 5, z + Math.sin(a) * d);
      if (!this.world.colliders.test(p, 4.6)) return p.setY(0);
    }
    return new THREE.Vector3(x, 0, z);
  }

  _place(tank, areaIndex) {
    const busy = new Set(this.list.filter((t) => t !== tank && t.alive).map((t) => t.area));
    let idx = areaIndex ?? Math.floor(Math.random() * this.world.tankAreas.length);
    for (let i = 0; i < this.world.tankAreas.length && busy.has(idx); i++) idx = (idx + 1) % this.world.tankAreas.length;
    tank.area = idx;
    tank.group.position.copy(this._randomPoint(this.world.tankAreas[idx]));
    tank.group.rotation.y = Math.random() * Math.PI * 2;
    tank.goal = this._randomPoint(this.world.tankAreas[idx]);
    tank.alive = true;
    tank.spawnAnim = 0;
    tank.group.visible = true;
    tank.group.position.y = 0;
    tank.parts.forEach((m) => { m.material = m.userData.mat; });
  }

  // Returns the tank hit by a sphere at `p`, if any.
  hitTest(p, radius) {
    for (const t of this.list) {
      if (!t.alive) continue;
      const c = t.group.position;
      const dx = p.x - c.x, dz = p.z - c.z, dy = p.y - 1.6;
      if (dx * dx + dz * dz + dy * dy < (4.3 + radius) ** 2) return t;
    }
    return null;
  }

  // Distance along a ray to the nearest live tank, or Infinity.
  raycast(origin, dir) {
    let best = Infinity;
    for (const t of this.list) {
      if (!t.alive) continue;
      const c = t.group.position;
      const ox = c.x - origin.x, oy = c.y + 1.6 - origin.y, oz = c.z - origin.z;
      const tc = ox * dir.x + oy * dir.y + oz * dir.z;
      const d2 = ox * ox + oy * oy + oz * oz - tc * tc;
      if (tc > 0 && d2 < 4.3 * 4.3) best = Math.min(best, tc - Math.sqrt(4.3 * 4.3 - d2));
    }
    return best;
  }

  destroy(t) {
    t.alive = false;
    t.wreckT = 0;
    t.respawn = 7;
    t.parts.forEach((m) => { m.material = this.charred; });
    t.turret.rotation.z = 0.35;
  }

  update(dt, missilePos) {
    for (const t of this.list) {
      const g = t.group;
      if (!t.alive) {
        t.wreckT += dt;
        t.respawn -= dt;
        if (t.respawn < 1.2) g.position.y = -((1.2 - t.respawn) / 1.2) * 3.2;  // sink away
        if (t.respawn <= 0) {
          t.turret.rotation.z = 0;
          this._place(t);
        }
        continue;
      }
      // Rise out of the ground when (re)spawning.
      if (t.spawnAnim < 1) {
        t.spawnAnim = Math.min(1, t.spawnAnim + dt * 1.2);
        g.position.y = -3 * (1 - t.spawnAnim) ** 2;
      }
      // Drive toward the current waypoint, turning smoothly.
      const to = new THREE.Vector3().subVectors(t.goal, g.position).setY(0);
      if (to.length() < 3) t.goal = this._randomPoint(this.world.tankAreas[t.area]);
      const want = Math.atan2(-to.x, -to.z);
      let d = want - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += THREE.MathUtils.clamp(d, -dt * 0.9, dt * 0.9);
      if (Math.abs(d) < 0.8) g.translateZ(-t.speed * dt);
      // Turret tracks the missile when it gets close.
      if (missilePos) {
        const rel = new THREE.Vector3().subVectors(missilePos, g.position);
        if (rel.length() < 220) {
          const a = Math.atan2(-rel.x, -rel.z) - g.rotation.y;
          let da = Math.atan2(Math.sin(a - t.turret.rotation.y), Math.cos(a - t.turret.rotation.y));
          t.turret.rotation.y += THREE.MathUtils.clamp(da, -dt * 1.2, dt * 1.2);
        }
      }
    }
  }

  reset() {
    this.list.forEach((t, i) => this._place(t, i % this.world.tankAreas.length));
  }
}

// Orange-and-white float rings that refill the life jacket.
export class ShieldPickups {
  constructor(scene, spots) {
    this.items = spots.map((p) => {
      const g = new THREE.Group();
      g.position.copy(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.7, 10, 24), new THREE.MeshLambertMaterial({ color: '#ff7a1a', emissive: '#401800' }));
      g.add(ring);
      for (let k = 0; k < 4; k++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.05, 6, 12), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        band.position.set(Math.cos(a) * 2.1, Math.sin(a) * 2.1, 0);
        band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-Math.sin(a), Math.cos(a), 0));
        ring.add(band);
      }
      ring.castShadow = true;
      scene.add(g);
      return { group: g, base: p.clone(), active: true, cooldown: 0 };
    });
  }

  update(dt, time) {
    for (const it of this.items) {
      if (!it.active) {
        it.cooldown -= dt;
        if (it.cooldown <= 0) it.active = true;
      }
      const target = it.active ? 1 : 0.001;
      const s = it.group.scale.x + (target - it.group.scale.x) * (1 - Math.exp(-dt * 8));
      it.group.scale.setScalar(s);
      it.group.visible = s > 0.02;
      it.group.rotation.y = time * 1.4;
      it.group.position.y = it.base.y + Math.sin(time * 2 + it.base.x) * 0.8;
    }
  }

  collect(p, radius = 5) {
    for (const it of this.items) {
      if (it.active && it.group.position.distanceTo(p) < radius) {
        it.active = false;
        it.cooldown = 20;
        return it;
      }
    }
    return null;
  }

  reset() {
    for (const it of this.items) { it.active = true; it.cooldown = 0; }
  }
}
