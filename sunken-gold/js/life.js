// Sea life: schooling reef fish (boids), clownfish in their anemones, lone
// groupers, sea turtles, eagle rays, glowing jellyfish and the sharks.
import * as THREE from 'three';
import { SHARK } from './config.js';
import { patchMaterial } from './ocean.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

const SPECIES = {
  //          len    speed range   school spacing   swim amplitude
  chromis:   { L: 0.11, speed: [0.7, 1.6], sep: 0.35, amp: 0.12, freq: 14 },
  tang:      { L: 0.2, speed: [0.5, 1.2], sep: 0.6, amp: 0.1, freq: 10 },
  sergeant:  { L: 0.17, speed: [0.5, 1.3], sep: 0.5, amp: 0.11, freq: 11 },
  clown:     { L: 0.1, speed: [0.2, 0.6], sep: 0.2, amp: 0.13, freq: 13 },
  grouper:   { L: 0.95, speed: [0.2, 0.6], sep: 2.0, amp: 0.07, freq: 4 },
  barracuda: { L: 1.25, speed: [0.25, 0.8], sep: 1.6, amp: 0.05, freq: 4 },
};

// Fish materials need the swim wave sized to each species, so each species
// gets its own patched copy of the shared fish/fin materials.
function speciesModel(models, kind) {
  const src = models[`fish_${kind}`];
  const sp = SPECIES[kind];
  const parts = [];
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material.clone();
    patchMaterial(m, { swim: { amp: sp.amp, length: sp.L, freq: sp.freq }, key: kind });
    parts.push({ geometry: o.geometry, material: m });
  });
  return parts;
}

class School {
  constructor(scene, models, colliders, seabed, kind, count, center, radius) {
    this.kind = kind;
    this.sp = SPECIES[kind];
    this.home = new THREE.Vector3().fromArray(center);
    this.radius = radius;
    this.seabed = seabed;
    this.colliders = colliders;
    this.n = count;
    this.p = [];
    this.v = [];
    this.speed = [];
    for (let i = 0; i < count; i++) {
      this.p.push(this.home.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).multiplyScalar(radius * 0.6)));
      this.v.push(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(this.sp.speed[0]));
      this.speed.push(rand(...this.sp.speed));
    }
    this.swim = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) { this.swim[i * 2] = Math.random() * 6.28; this.swim[i * 2 + 1] = 1; }
    this.swimAttr = new THREE.InstancedBufferAttribute(this.swim, 2);
    this.meshes = speciesModel(models, kind).map(({ geometry, material }) => {
      const g = geometry.clone();
      g.setAttribute('aSwim', this.swimAttr);
      const im = new THREE.InstancedMesh(g, material, count);
      im.castShadow = kind === 'grouper' || kind === 'barracuda';
      im.frustumCulled = false;
      scene.add(im);
      return im;
    });
    this.wander = new THREE.Vector3();
    this.t = Math.random() * 100;
  }

  update(dt, player, frame) {
    const { sp, p, v, n } = this;
    this.t += dt;
    // The school's focus drifts around its home so it never sits still.
    this.wander.set(Math.sin(this.t * 0.11) * this.radius * 0.5, Math.sin(this.t * 0.07) * 1.5, Math.cos(this.t * 0.09) * this.radius * 0.5).add(this.home);
    const near = player.distanceToSquared(this.home) < (this.radius + 60) ** 2;
    if (!near && frame % 4) return;           // far schools update every 4th frame
    const step = near ? dt : dt * 4;
    const sep2 = sp.sep * sp.sep;
    const acc = tmpV;
    for (let i = 0; i < n; i++) {
      const pi = p[i], vi = v[i];
      acc.set(0, 0, 0);
      let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0, cnt = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const pj = p[j];
        const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > sep2 * 16) continue;
        cnt++;
        cx += pj.x; cy += pj.y; cz += pj.z;
        ax += v[j].x; ay += v[j].y; az += v[j].z;
        if (d2 < sep2) {
          const k = (sep2 - d2) / sep2 * 3;
          acc.x += dx * k; acc.y += dy * k; acc.z += dz * k;
        }
      }
      if (cnt) {
        acc.x += (cx / cnt - pi.x) * 0.5 + (ax / cnt - vi.x) * 0.9;
        acc.y += (cy / cnt - pi.y) * 0.5 + (ay / cnt - vi.y) * 0.9;
        acc.z += (cz / cnt - pi.z) * 0.5 + (az / cnt - vi.z) * 0.9;
      }
      // Pull toward the wandering focus, harder the further out a fish strays.
      tmpW.subVectors(this.wander, pi);
      const far = tmpW.length() / this.radius;
      acc.addScaledVector(tmpW.normalize(), 0.3 + far * far * 1.5);
      // Scatter from the diver.
      tmpW.subVectors(pi, player);
      const pd = tmpW.length();
      const fear = sp.L > 0.5 ? 2.5 : 4.5;
      if (pd < fear) acc.addScaledVector(tmpW.normalize(), (fear - pd) * 6);
      // Stay off the bottom and below the surface.
      const g = this.seabed.heightAt(pi.x, pi.z);
      if (pi.y < g + 0.8) acc.y += (g + 0.8 - pi.y) * 6;
      if (pi.y > -1.5) acc.y -= 4;
      if ((i + frame) % 16 === 0) {
        const cd = this.colliders.distance(pi, 1.5);
        if (cd < 1.0) acc.y += 3;
      }
      vi.addScaledVector(acc, step);
      vi.y *= 0.96;
      const s = vi.length();
      const want = this.speed[i] * (pd < fear ? 2.2 : 1);
      if (s > 1e-4) vi.multiplyScalar(THREE.MathUtils.lerp(s, want, Math.min(1, step * 1.5)) / s);
      pi.addScaledVector(vi, step);
      this.swim[i * 2 + 1] = 0.6 + vi.length() / sp.speed[1];
      tmpW.copy(pi).add(vi);
      tmpM.lookAt(pi, tmpW, UP);
      tmpM.setPosition(pi);
      for (const im of this.meshes) im.setMatrixAt(i, tmpM);
    }
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
    this.swimAttr.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ turtle

class Turtle {
  constructor(scene, model, home) {
    this.obj = model.clone();
    this.obj.scale.setScalar(1.1);
    scene.add(this.obj);
    this.home = new THREE.Vector3().fromArray(home);
    this.pos = this.home.clone();
    this.heading = Math.random() * 6.28;
    this.t = Math.random() * 50;
    this.flippers = {};
    this.obj.traverse((o) => {
      if (o.name.startsWith('turtle_flipper')) this.flippers[o.name.slice(-2)] = o;
    });
    this.obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  update(dt, seabed, player) {
    this.t += dt;
    const toHome = tmpV.subVectors(this.home, this.pos);
    const want = Math.atan2(-toHome.x, -toHome.z) + Math.sin(this.t * 0.13) * 1.2;
    let diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
    if (toHome.length() < 12) diff = Math.sin(this.t * 0.21) * 0.6;
    this.heading += THREE.MathUtils.clamp(diff, -0.35, 0.35) * dt;
    const stroke = Math.sin(this.t * 1.6);
    const speed = 0.45 + 0.25 * Math.max(0, -stroke);
    this.pos.x += -Math.sin(this.heading) * speed * dt;
    this.pos.z += -Math.cos(this.heading) * speed * dt;
    const g = seabed.heightAt(this.pos.x, this.pos.z);
    const targetY = Math.min(-2, Math.max(g + 2.5, this.home.y + Math.sin(this.t * 0.05) * 3));
    this.pos.y += (targetY - this.pos.y) * dt * 0.3;
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(Math.sin(this.t * 0.4) * 0.05, this.heading, Math.sin(this.t * 0.31) * 0.06, 'YXZ');
    const f = this.flippers;
    if (f.fl) {
      // Front flippers: big flying strokes. Rear flippers: small rudder moves.
      f.fl.rotation.set(0, stroke * 0.25, stroke * 0.65);
      f.fr.rotation.set(0, -stroke * 0.25, -stroke * 0.65);
      f.rl.rotation.set(0, Math.sin(this.t * 0.8) * 0.2, 0);
      f.rr.rotation.set(0, -Math.sin(this.t * 0.8) * 0.2, 0);
    }
  }
}

// ------------------------------------------------------------------ ray

class Ray {
  constructor(scene, model, home) {
    this.obj = model.clone();
    this.obj.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        patchMaterial(o.material, { flap: { amp: 0.2, freq: 1.6 } });
        o.castShadow = true;
      }
    });
    this.obj.scale.setScalar(1.3);
    scene.add(this.obj);
    this.home = new THREE.Vector3().fromArray(home);
    this.t = Math.random() * 100;
  }

  update(dt) {
    this.t += dt;
    const a = this.t * 0.05;
    const r = 22 + 6 * Math.sin(this.t * 0.03);
    const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
    const y = this.home.y + Math.sin(this.t * 0.08) * 1.5;
    tmpW.set(x, y, z);
    this.obj.position.copy(tmpW);
    const dx = -Math.sin(a), dz = Math.cos(a);
    this.obj.rotation.set(0, Math.atan2(-dx, -dz), -0.25, 'YXZ');
  }
}

// ------------------------------------------------------------------ shark

class Shark {
  constructor(scene, model, path, scale, seabed, colliders) {
    this.uniforms = { uPhase: { value: Math.random() * 6 }, uRate: { value: 1 } };
    this.obj = model.clone();
    this.obj.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        patchMaterial(o.material, { swim: { amp: 0.09, length: 2.3, freq: 3.2 }, uniforms: this.uniforms, key: 'shark' });
        o.castShadow = true;
      }
    });
    this.obj.scale.setScalar(scale);
    this.scale = scale;
    scene.add(this.obj);
    this.path = path.map((p) => new THREE.Vector3().fromArray(p));
    this.k = 0;
    this.pos = this.path[0].clone();
    this.vel = new THREE.Vector3(0, 0, -1);
    this.state = 'patrol';
    this.timer = 0;
    this.cool = 8;
    this.angle = 0;
    this.seabed = seabed;
    this.colliders = colliders;
    this.target = new THREE.Vector3();
    this.biteAt = 0;
  }

  update(dt, player, events) {
    this.timer += dt;
    this.cool -= dt;
    const pp = player.pos;
    const dist = this.pos.distanceTo(pp);
    let speed = SHARK.cruiseSpeed;
    let turn = 1.0;
    const huntable = player.underwater && !player.safe;
    switch (this.state) {
      case 'patrol': {
        const wp = this.path[this.k];
        this.target.copy(wp);
        if (this.pos.distanceTo(wp) < 6) this.k = (this.k + 1) % this.path.length;
        if (huntable && this.cool <= 0 && dist < SHARK.noticeRange * this.scale) {
          this.state = 'circle';
          this.timer = 0;
          this.circleFor = rand(4, 7);
          this.angle = Math.atan2(this.pos.z - pp.z, this.pos.x - pp.x);
          events.onNotice?.(this);
        }
        break;
      }
      case 'circle': {
        this.angle += dt * 0.45;
        const r = 7 * this.scale;
        this.target.set(pp.x + Math.cos(this.angle) * r, pp.y + Math.sin(this.timer) * 0.8, pp.z + Math.sin(this.angle) * r);
        speed = 3.2;
        turn = 1.6;
        if (!huntable || dist > SHARK.noticeRange * 1.8) { this.state = 'patrol'; this.cool = 6; }
        else if (this.timer > this.circleFor) { this.state = 'charge'; this.timer = 0; events.onCharge?.(this); }
        break;
      }
      case 'charge': {
        this.target.copy(pp).addScaledVector(player.vel, 0.4);
        speed = SHARK.chargeSpeed;
        turn = 2.4;
        if (dist < 1.5 * this.scale + 0.4 && this.timer > 0.3) {
          events.onBite?.(this);
          this.flee(SHARK.fleeTime);
        } else if (this.timer > 5 || !huntable) {
          this.state = 'circle';
          this.timer = 0;
          this.circleFor = rand(3, 5);
        }
        break;
      }
      case 'flee': {
        tmpW.subVectors(this.pos, pp).setY(0).normalize();
        this.target.copy(this.pos).addScaledVector(tmpW, 20);
        this.target.y = Math.min(this.pos.y, pp.y - 2);
        speed = 5.5;
        turn = 2.0;
        if (this.timer > this.fleeFor) { this.state = 'patrol'; this.cool = 12; }
        break;
      }
    }
    // Steer toward the target with a limited turn rate.
    tmpV.subVectors(this.target, this.pos);
    const g = this.seabed.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < g + 1.5) tmpV.y += (g + 1.5 - this.pos.y) * 4;
    if (this.pos.y > -2) tmpV.y -= 3;
    if (this.colliders.distance(this.pos, 3) < 2) tmpV.y += 4;
    tmpV.normalize();
    const cur = tmpW.copy(this.vel).normalize();
    cur.lerp(tmpV, Math.min(1, dt * turn)).normalize();
    const s = THREE.MathUtils.lerp(this.vel.length(), speed, Math.min(1, dt * 1.2));
    this.vel.copy(cur).multiplyScalar(s);
    this.pos.addScaledVector(this.vel, dt);
    this.obj.position.copy(this.pos);
    tmpV.copy(this.pos).sub(this.vel);
    this.obj.lookAt(tmpV);
    this.uniforms.uRate.value = 0.6 + s / 3;
  }

  flee(t) {
    this.state = 'flee';
    this.timer = 0;
    this.fleeFor = t;
  }
}

// ------------------------------------------------------------------ jellies

function jellies(scene, model, spots) {
  const parts = [];
  model.traverse((o) => { if (o.isMesh) parts.push(o); });
  const list = spots.map((p) => ({ p: new THREE.Vector3().fromArray(p), ph: Math.random() * 6.28, s: rand(0.6, 1.3) }));
  const meshes = parts.map((o) => {
    const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
    im.frustumCulled = false;
    im.renderOrder = 4;
    scene.add(im);
    return im;
  });
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  return {
    update(dt, t) {
      list.forEach((j, i) => {
        tmpW.copy(j.p);
        tmpW.y += Math.sin(t * 0.3 + j.ph) * 1.2;
        tmpW.x += Math.sin(t * 0.05 + j.ph) * 2;
        q.setFromEuler(new THREE.Euler(Math.sin(t * 0.4 + j.ph) * 0.15, j.ph, Math.cos(t * 0.33 + j.ph) * 0.15));
        tmpM.compose(tmpW, q, s.setScalar(j.s));
        for (const im of meshes) im.setMatrixAt(i, tmpM);
      });
      for (const im of meshes) im.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ all

export class SeaLife {
  constructor(scene, assets, seabed, colliders) {
    const { world, models } = assets;
    const L = world.life;
    this.schools = L.schools.map((s) => new School(scene, models, colliders, seabed, s.species, s.count, s.center, s.radius));
    for (const l of L.loners) this.schools.push(new School(scene, models, colliders, seabed, 'grouper', 1, l.center, l.radius));
    // Three clownfish living in each anemone.
    for (const [x, z] of L.anemones) {
      const y = seabed.heightAt(x, z) + 0.35;
      this.schools.push(new School(scene, models, colliders, seabed, 'clown', 3, [x, y, z], 0.5));
    }
    this.turtles = L.turtles.map((p) => new Turtle(scene, models.turtle, p));
    this.rays = L.rays.map((p) => new Ray(scene, models.eagle_ray, p));
    this.sharks = L.sharks.map((s) => new Shark(scene, models.shark, s.path, s.scale, seabed, colliders));
    this.jellies = jellies(scene, models.jellyfish, L.jellies);
    this.seabed = seabed;
    this.frame = 0;
  }

  update(dt, t, player, events) {
    this.frame++;
    for (const s of this.schools) s.update(dt, player.pos, this.frame);
    for (const tt of this.turtles) tt.update(dt, this.seabed, player);
    for (const r of this.rays) r.update(dt);
    for (const s of this.sharks) s.update(dt, player, events);
    this.jellies.update(dt, t);
  }

  // Closest shark that is hunting the diver, for music and warnings.
  threat(player) {
    let best = null, bd = Infinity;
    for (const s of this.sharks) {
      if (s.state !== 'circle' && s.state !== 'charge') continue;
      const d = s.pos.distanceTo(player.pos);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { shark: best, dist: bd, charging: best.state === 'charge' } : null;
  }

  strobe(player, dir, range) {
    let scared = 0;
    for (const s of this.sharks) {
      tmpV.subVectors(s.pos, player.pos);
      const d = tmpV.length();
      if (d < range && tmpV.normalize().dot(dir) > 0.2) {
        s.flee(12);
        scared++;
      }
    }
    return scared;
  }
}
