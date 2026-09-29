// Fire and light: campfires (with fuel, heat and drying), burning wreckage, the cabin stove and
// lantern, the signal flare, and a small pool of real lights handed to the nearest sources.
import * as THREE from 'three';
import { ParticleSystem } from './particles.js';
import { clamp, hash2 } from './util.js';

const POOL = 3;

export class Fires {
  constructor(scene) {
    this.scene = scene;
    this.flames = new ParticleSystem({ max: 900, additive: true, sprite: 'flame' });
    this.smoke = new ParticleSystem({ max: 700, additive: false, sprite: 'smoke', fog: true });
    scene.add(this.flames.points, this.smoke.points);
    this.sources = [];              // everything that can light the world
    this.lights = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 20, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    this.flares = [];
    this.time = 0;
  }

  // kind: 'camp' (player fire), 'wreck', 'stove', 'lantern', 'signal'
  add(kind, x, y, z, { fuel = 240, size = 1, lit = true, range = 16 } = {}) {
    const f = { kind, pos: new THREE.Vector3(x, y, z), fuel, size, lit, range, intensity: lit ? 1 : 0, id: this.sources.length, seed: Math.random() * 100, embers: 0 };
    this.sources.push(f);
    return f;
  }

  light(f) { if (!f.lit) { f.lit = true; f.intensity = Math.max(f.intensity, 0.05); } }
  douse(f) { f.lit = false; }
  feed(f, seconds) { f.fuel += seconds; if (!f.lit) this.light(f); }

  fireFlare(from, dir) {
    this.flares.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(60).add(new THREE.Vector3(0, 30, 0)), age: 0, life: 45 });
  }

  // Warmth (0..1) felt at a point, from every burning source nearby.
  heatAt(p) {
    let h = 0;
    for (const f of this.sources) {
      if (!f.lit || f.kind === 'lantern' || f.kind === 'wreck') continue;
      const d = f.pos.distanceTo(p);
      h += f.intensity * clamp(1 - d / 6.5, 0, 1) * (f.kind === 'stove' ? 1.1 : 1);
    }
    return Math.min(1.4, h);
  }

  nearestLit(p, max = 4.5, kinds = ['camp', 'stove', 'signal']) {
    let best = null, bd = max;
    for (const f of this.sources) {
      if (!f.lit || !kinds.includes(f.kind)) continue;
      const d = f.pos.distanceTo(p);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  update(dt, camera, viewportHeight, dayLight, wind, rain) {
    this.time += dt;
    const cam = camera.position;
    for (const f of this.sources) {
      if (f.lit && (f.kind === 'camp' || f.kind === 'signal')) {
        f.fuel -= dt * (1 + rain * 0.8);
        if (f.fuel <= 0) { f.lit = false; f.embers = 25; }
      }
      // ramp the flames up and down smoothly
      const target = f.lit ? 1 : 0;
      f.intensity += (target - f.intensity) * (1 - Math.exp(-(f.lit ? 1.5 : 0.6) * dt));
      if (f.intensity < 0.01 && !f.lit) f.intensity = 0;
      if (f.embers > 0) f.embers -= dt;
      const dist = f.pos.distanceTo(cam);
      if (dist > 220) continue;
      const strength = f.intensity * (f.kind === 'camp' && f.fuel < 40 ? 0.4 + f.fuel / 70 : 1);
      // flames
      if (f.kind !== 'lantern' && strength > 0.04) {
        const rate = strength * f.size * (f.kind === 'wreck' ? 34 : 24);
        let n = rate * dt + (Math.random() < (rate * dt) % 1 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.283, r = Math.random() * 0.22 * f.size;
          this.flames.emit({
            x: f.pos.x + Math.cos(a) * r, y: f.pos.y, z: f.pos.z + Math.sin(a) * r,
            vx: (Math.random() - 0.5) * 0.25 + wind.x * 0.2, vy: (0.9 + Math.random() * 0.9) * f.size, vz: (Math.random() - 0.5) * 0.25 + wind.y * 0.2,
            life: 0.55 + Math.random() * 0.5, size0: (0.55 + Math.random() * 0.3) * f.size, size1: 0.06 * f.size, alpha: 0.85,
            c0: [1.6, 0.85, 0.22], c1: [1.2, 0.16, 0.02], drag: 1.2,
          });
        }
        // a few sparks
        if (Math.random() < strength * dt * 3) {
          this.flames.emit({ x: f.pos.x, y: f.pos.y + 0.3, z: f.pos.z, vx: (Math.random() - 0.5) * 1.4, vy: 1.6 + Math.random() * 2, vz: (Math.random() - 0.5) * 1.4, life: 1.2 + Math.random(), size0: 0.05, size1: 0.02, alpha: 1, c0: [3, 1.4, 0.4], c1: [1.5, 0.2, 0.0], grav: 0.5, drag: 0.3 });
        }
      }
      // smoke
      const smokeRate = f.kind === 'wreck' ? 7 * strength : f.kind === 'lantern' ? 0 : (f.lit ? 4 : f.embers > 0 ? 2 : 0) * f.size;
      if (smokeRate > 0 && dist < 180) {
        let n = smokeRate * dt + (Math.random() < (smokeRate * dt) % 1 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const big = f.kind === 'wreck';
          this.smoke.emit({
            x: f.pos.x + (Math.random() - 0.5) * 0.4, y: f.pos.y + 0.6 * f.size, z: f.pos.z + (Math.random() - 0.5) * 0.4,
            vx: wind.x * 1.2 + (Math.random() - 0.5) * 0.3, vy: (big ? 2.2 : 1.1) + Math.random() * 0.8, vz: wind.y * 1.2 + (Math.random() - 0.5) * 0.3,
            life: big ? 9 + Math.random() * 5 : 4 + Math.random() * 2.5, size0: big ? 1.2 : 0.4, size1: big ? 8 : 2.2, alpha: big ? 0.5 : 0.2,
            c0: big ? [0.16, 0.15, 0.14] : [0.32, 0.31, 0.3], c1: big ? [0.3, 0.3, 0.3] : [0.5, 0.5, 0.5], drag: 0.25,
          });
        }
      }
    }

    // flares: a fast climbing red star with a trail, hanging on a parachute, then falling
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const fl = this.flares[i];
      fl.age += dt;
      if (fl.age > fl.life) { this.flares.splice(i, 1); continue; }
      if (fl.age < 2.2) { fl.vel.y -= 9.8 * dt * 0.4; } else { fl.vel.multiplyScalar(Math.exp(-2 * dt)); fl.vel.y = -3.2; fl.vel.x += wind.x * dt; fl.vel.z += wind.y * dt; }
      fl.pos.addScaledVector(fl.vel, dt);
      this.flames.emit({ x: fl.pos.x, y: fl.pos.y, z: fl.pos.z, life: 0.12, size0: 4.5, size1: 3.5, alpha: 1, c0: [4, 0.4, 0.25], c1: [3, 0.2, 0.1] });
      if (Math.random() < 0.5) this.smoke.emit({ x: fl.pos.x, y: fl.pos.y, z: fl.pos.z, vy: -0.4, life: 3, size0: 0.4, size1: 2.5, alpha: 0.25, c0: [0.6, 0.55, 0.55], c1: [0.7, 0.7, 0.7] });
    }

    this._assignLights(cam);
    this.flames.update(dt, camera, viewportHeight, 1);
    this.smoke.update(dt, camera, viewportHeight, 0.35 + 0.65 * dayLight);
  }

  // The three brightest sources near the camera get real lights, with flicker.
  _assignLights(cam) {
    const cands = [];
    for (const f of this.sources) {
      if (f.intensity < 0.02) continue;
      cands.push({ f, d: f.pos.distanceTo(cam) - f.range * 0.3 });
    }
    for (const fl of this.flares) cands.push({ f: { pos: fl.pos, intensity: 1, kind: 'flare', range: 90, seed: 1, size: 1 }, d: fl.pos.distanceTo(cam) * 0.3 });
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const l = this.lights[i], c = cands[i];
      if (!c) { l.intensity = 0; continue; }
      const f = c.f, t = this.time * 9 + f.seed;
      const flick = 0.82 + 0.18 * Math.sin(t) * Math.sin(t * 2.3 + 1) + 0.08 * Math.sin(t * 5.7);
      l.position.copy(f.pos); l.position.y += f.kind === 'lantern' ? 0 : 0.6 * f.size;
      if (f.kind === 'lantern') { l.color.set(0xffc27a); l.intensity = 9 * f.intensity; l.distance = 9; }
      else if (f.kind === 'flare') { l.color.set(0xff3a2a); l.intensity = 900; l.distance = 160; }
      else { l.color.set(0xff8a3a); l.intensity = 34 * f.intensity * f.size * flick * (f.kind === 'wreck' ? 1.4 : 1); l.distance = f.range * (0.8 + 0.4 * f.size); }
      l.decay = 1.6;
    }
  }
}
