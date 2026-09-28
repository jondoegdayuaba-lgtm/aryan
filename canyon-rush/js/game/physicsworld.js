// What the truck's physics needs to know about the world: ground height and
// slope, what the surface is made of, where the water is, and the obstacles.
import * as THREE from 'three';

// Grip (mu), rolling resistance (roll) and how much dust wheels kick up.
export const SURFACES = {
  road: { mu: 0.98, roll: 0.022, dust: 0.8, name: 'road' },
  dirt: { mu: 0.9, roll: 0.032, dust: 1.0, name: 'dirt' },
  sand: { mu: 0.74, roll: 0.075, dust: 1.5, name: 'sand' },
  playa: { mu: 1.0, roll: 0.018, dust: 0.9, name: 'playa' },
  rock: { mu: 1.05, roll: 0.02, dust: 0.25, name: 'rock' },
  water: { mu: 0.62, roll: 0.12, dust: 0, name: 'water' },
};

const CELL = 16;

export class PhysicsWorld {
  constructor(world, stage) {
    this.near = world.near;
    this.mid = world.mid;
    this.far = world.far;
    this.splat = world.splat;
    this.oasis = stage.oasis;
    this.cells = new Map();
    this.maxObstacleRadius = 1;
  }

  heightAt(x, z) {
    if (this.near.contains(x, z)) return this.near.sample(x, z);
    if (this.mid.contains(x, z)) return this.mid.sample(x, z);
    return this.far.sample(x, z);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  // Raw splat channels at (x, z): road, lateral offset, dune, playa (0..1).
  splatAt(x, z, out) {
    const n = this.near.size;
    const i = Math.round(x - this.near.origin), j = Math.round(z - this.near.origin);
    if (i < 0 || j < 0 || i >= n || j >= n) { out.road = 0; out.dune = 0; out.playa = 0; out.lat = 0; return out; }
    const k = (j * n + i) * 4;
    out.road = this.splat[k] / 255;
    out.lat = (this.splat[k + 1] / 255 * 2 - 1) * 8;
    out.dune = this.splat[k + 2] / 255;
    out.playa = this.splat[k + 3] / 255;
    return out;
  }

  waterLevelAt(x, z) {
    const o = this.oasis;
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz > (o.r * 1.8) ** 2) return null;
    return o.level;
  }

  // Blended surface properties at a contact point.
  surfaceAt(x, z, y, out = {}) {
    const s = this.splatAt(x, z, this._sp || (this._sp = {}));
    const wl = this.waterLevelAt(x, z);
    if (wl !== null && y < wl - 0.03) {
      Object.assign(out, SURFACES.water);
      out.depth = wl - y;
      return out;
    }
    const ny = this.normalAt(x, z, this._n || (this._n = new THREE.Vector3())).y;
    const rock = THREE.MathUtils.smoothstep(0.82, 0.7, ny) * (1 - s.road);
    const sand = Math.min(1, s.dune * 1.2) * (1 - s.road) * (1 - rock);
    const playa = s.playa * (1 - s.road);
    const road = s.road;
    const dirt = Math.max(0, 1 - rock - sand - playa - road);
    const D = SURFACES;
    out.mu = dirt * D.dirt.mu + sand * D.sand.mu + playa * D.playa.mu + road * D.road.mu + rock * D.rock.mu;
    out.roll = dirt * D.dirt.roll + sand * D.sand.roll + playa * D.playa.roll + road * D.road.roll + rock * D.rock.roll;
    out.dust = dirt * D.dirt.dust + sand * D.sand.dust + playa * D.playa.dust + road * D.road.dust + rock * D.rock.dust;
    const best = Math.max(dirt, sand, playa, road, rock);
    out.name = best === road ? 'road' : best === sand ? 'sand' : best === playa ? 'playa' : best === rock ? 'rock' : 'dirt';
    out.sand = sand;
    out.playa = playa;
    out.depth = 0;
    return out;
  }

  addObstacle(ob) {
    const cx = Math.floor(ob.x / CELL), cz = Math.floor(ob.z / CELL);
    const key = cx * 100003 + cz;
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(ob);
    this.maxObstacleRadius = Math.max(this.maxObstacleRadius, ob.radius);
  }

  // Calls fn(ob) for every intact obstacle within r (+ its own radius) of (x, z).
  queryObstacles(x, z, r, fn) {
    const R = r + this.maxObstacleRadius;
    const c0 = Math.floor((x - R) / CELL), c1 = Math.floor((x + R) / CELL);
    const d0 = Math.floor((z - R) / CELL), d1 = Math.floor((z + R) / CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const list = this.cells.get(cx * 100003 + cz);
        if (!list) continue;
        for (const ob of list) {
          if (ob.broken) continue;
          const dx = ob.x - x, dz = ob.z - z;
          const lim = r + ob.radius;
          if (dx * dx + dz * dz > lim * lim) continue;
          fn(ob);
        }
      }
    }
  }
}
