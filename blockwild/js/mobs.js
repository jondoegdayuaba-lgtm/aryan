// Animals and night-time monsters: blocky models, simple AI, physics,
// spawning around the player, and getting hit.
import * as THREE from 'three';
import { B, BLOCKS, ITEM } from './blocks.js';
import { CH } from './world.js';

const SHADE = [0.8, 0.8, 1, 0.5, 0.65, 0.65];
const geoCache = new Map();
function boxGeo(w, h, d, hex) {
  const key = `${w},${h},${d},${hex}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const c = new THREE.Color(hex);
  const col = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    const s = SHADE[Math.floor(i / 6)];
    col.push(c.r * s, c.g * s, c.b * s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geoCache.set(key, g);
  return g;
}
function part(parent, mat, w, h, d, hex, x, y, z) {
  const m = new THREE.Mesh(boxGeo(w, h, d, hex), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// Four legs hanging from pivots at height `top`.
function legs(root, mat, w, top, dx, dz, hex) {
  return [[-dx, dz], [dx, dz], [-dx, -dz], [dx, -dz]].map(([x, z]) => {
    const p = pivot(root, x, top, z);
    part(p, mat, w, top, w, hex, 0, -top / 2, 0);
    return p;
  });
}

// Every model faces +z. `eye` is the glowing material for monsters.
const TYPES = {
  cow: {
    name: 'Cow', w: 0.9, h: 1.35, hp: 10, speed: 1.3, sound: 'moo',
    drops: [[ITEM.MEAT, 1, 3]], biomes: ['plains'],
    build(root, mat) {
      const l = legs(root, mat, 0.24, 0.6, 0.24, 0.38, 0x4a301f);
      part(root, mat, 0.72, 0.6, 1.1, 0x5e3d27, 0, 0.9, 0);
      part(root, mat, 0.74, 0.3, 0.4, 0xe9e4da, 0, 1.0, -0.2);
      part(root, mat, 0.3, 0.12, 0.3, 0xe9a5a5, 0, 0.56, -0.15);
      const head = pivot(root, 0, 1.08, 0.55);
      part(head, mat, 0.48, 0.46, 0.38, 0x5e3d27, 0, 0, 0.18);
      part(head, mat, 0.36, 0.2, 0.08, 0xd9b8a0, 0, -0.12, 0.4);
      part(head, mat, 0.3, 0.16, 0.02, 0xe9e4da, 0, 0.1, 0.375);
      part(head, mat, 0.06, 0.06, 0.02, 0x111111, -0.14, 0.04, 0.38);
      part(head, mat, 0.06, 0.06, 0.02, 0x111111, 0.14, 0.04, 0.38);
      part(head, mat, 0.08, 0.14, 0.08, 0xd8d0b8, -0.26, 0.24, 0.16);
      part(head, mat, 0.08, 0.14, 0.08, 0xd8d0b8, 0.26, 0.24, 0.16);
      return { legs: l, head };
    },
  },
  boar: {
    name: 'Boar', w: 0.8, h: 0.95, hp: 10, speed: 1.5, sound: 'grunt',
    drops: [[ITEM.MEAT, 1, 3]], biomes: ['plains', 'forest'],
    build(root, mat) {
      const l = legs(root, mat, 0.2, 0.35, 0.2, 0.3, 0x4f3b2c);
      part(root, mat, 0.62, 0.5, 0.95, 0x7a5a40, 0, 0.6, 0);
      part(root, mat, 0.16, 0.12, 0.8, 0x3e2c1f, 0, 0.9, -0.05);
      const head = pivot(root, 0, 0.66, 0.45);
      part(head, mat, 0.46, 0.42, 0.36, 0x6d4f37, 0, 0, 0.16);
      part(head, mat, 0.26, 0.18, 0.1, 0xc28a72, 0, -0.06, 0.38);
      part(head, mat, 0.05, 0.05, 0.02, 0x2b1a12, -0.06, -0.05, 0.435);
      part(head, mat, 0.05, 0.05, 0.02, 0x2b1a12, 0.06, -0.05, 0.435);
      part(head, mat, 0.05, 0.12, 0.05, 0xf2ead8, -0.16, -0.08, 0.36);
      part(head, mat, 0.05, 0.12, 0.05, 0xf2ead8, 0.16, -0.08, 0.36);
      part(head, mat, 0.06, 0.06, 0.02, 0x111111, -0.14, 0.08, 0.345);
      part(head, mat, 0.06, 0.06, 0.02, 0x111111, 0.14, 0.08, 0.345);
      part(head, mat, 0.1, 0.12, 0.06, 0x4f3b2c, -0.18, 0.24, 0.08);
      part(head, mat, 0.1, 0.12, 0.06, 0x4f3b2c, 0.18, 0.24, 0.08);
      return { legs: l, head };
    },
  },
  sheep: {
    name: 'Sheep', w: 0.85, h: 1.25, hp: 8, speed: 1.2, sound: 'baa',
    drops: [[B.WOOL, 1, 2], [ITEM.MEAT, 0, 1]], biomes: ['plains', 'cherry'],
    build(root, mat) {
      const l = legs(root, mat, 0.18, 0.5, 0.22, 0.32, 0x8f857c);
      part(root, mat, 0.78, 0.66, 1.0, 0xebe8e1, 0, 0.84, 0);
      const head = pivot(root, 0, 1.02, 0.5);
      part(head, mat, 0.36, 0.4, 0.4, 0x8f857c, 0, 0, 0.18);
      part(head, mat, 0.42, 0.16, 0.3, 0xebe8e1, 0, 0.2, 0.12);
      part(head, mat, 0.06, 0.06, 0.02, 0x1b1b1b, -0.1, 0.04, 0.385);
      part(head, mat, 0.06, 0.06, 0.02, 0x1b1b1b, 0.1, 0.04, 0.385);
      part(head, mat, 0.14, 0.08, 0.1, 0x8f857c, -0.24, 0.02, 0.1);
      part(head, mat, 0.14, 0.08, 0.1, 0x8f857c, 0.24, 0.02, 0.1);
      return { legs: l, head };
    },
  },
  chicken: {
    name: 'Chicken', w: 0.45, h: 0.75, hp: 4, speed: 1.1, sound: 'cluck',
    drops: [[ITEM.MEAT, 1, 1]], biomes: ['plains', 'forest', 'cherry'],
    build(root, mat) {
      const l = [-0.08, 0.08].map((x) => {
        const p = pivot(root, x, 0.28, 0);
        part(p, mat, 0.05, 0.28, 0.05, 0xe2a23a, 0, -0.14, 0);
        part(p, mat, 0.12, 0.03, 0.12, 0xe2a23a, 0, -0.27, 0.03);
        return p;
      });
      part(root, mat, 0.34, 0.32, 0.44, 0xf4f1ea, 0, 0.44, 0);
      part(root, mat, 0.2, 0.16, 0.1, 0xe7e2d8, 0, 0.54, -0.25);
      const wings = [-1, 1].map((s) => {
        const p = pivot(root, s * 0.18, 0.56, 0);
        part(p, mat, 0.05, 0.22, 0.32, 0xe0dbd0, s * 0.02, -0.1, 0);
        return p;
      });
      const head = pivot(root, 0, 0.62, 0.16);
      part(head, mat, 0.22, 0.3, 0.18, 0xf4f1ea, 0, 0.1, 0.06);
      part(head, mat, 0.14, 0.07, 0.1, 0xf0a72c, 0, 0.1, 0.19);
      part(head, mat, 0.07, 0.1, 0.05, 0xd6332e, 0, 0.01, 0.17);
      part(head, mat, 0.08, 0.06, 0.12, 0xd6332e, 0, 0.28, 0.06);
      part(head, mat, 0.04, 0.04, 0.02, 0x111111, -0.08, 0.16, 0.155);
      part(head, mat, 0.04, 0.04, 0.02, 0x111111, 0.08, 0.16, 0.155);
      return { legs: l, head, wings };
    },
  },
  gloom: {
    name: 'Gloomwalker', w: 0.6, h: 1.95, hp: 16, speed: 1.1, chase: 3.1, damage: 3,
    hostile: true, sound: 'groan', burns: true, drops: [],
    build(root, mat, eye) {
      const l = [-0.13, 0.13].map((x) => {
        const p = pivot(root, x, 0.78, 0);
        part(p, mat, 0.24, 0.78, 0.24, 0x2a2638, 0, -0.39, 0);
        return p;
      });
      part(root, mat, 0.52, 0.72, 0.3, 0x3b3552, 0, 1.14, 0);
      part(root, mat, 0.54, 0.14, 0.32, 0x5c3a6e, 0, 0.84, 0);
      const arms = [-0.37, 0.37].map((x) => {
        const p = pivot(root, x, 1.42, 0);
        part(p, mat, 0.2, 0.72, 0.2, 0x332d47, 0, -0.32, 0);
        part(p, mat, 0.22, 0.12, 0.22, 0x8a7fb0, 0, -0.66, 0);
        return p;
      });
      const head = pivot(root, 0, 1.5, 0);
      part(head, mat, 0.48, 0.46, 0.46, 0x463f61, 0, 0.23, 0);
      part(head, mat, 0.5, 0.12, 0.48, 0x2a2638, 0, 0.44, 0);
      part(head, eye, 0.1, 0.07, 0.02, 0xffc93a, -0.11, 0.26, 0.235);
      part(head, eye, 0.1, 0.07, 0.02, 0xffc93a, 0.11, 0.26, 0.235);
      return { legs: l, head, arms };
    },
  },
  bramble: {
    name: 'Bramble', w: 0.85, h: 0.85, hp: 8, speed: 0, chase: 3.6, damage: 2,
    hostile: true, hopper: true, sound: 'rustle', drops: [[B.LEAVES, 0, 1]],
    build(root, mat, eye) {
      const body = pivot(root, 0, 0, 0);
      part(body, mat, 0.8, 0.72, 0.8, 0x2f5a2a, 0, 0.36, 0);
      part(body, mat, 0.6, 0.14, 0.6, 0x3d7334, 0, 0.78, 0);
      const thorns = [[0.42, 0.5, 0.1], [-0.42, 0.3, -0.2], [0.1, 0.55, -0.42], [-0.2, 0.22, 0.42], [0.3, 0.2, -0.42], [-0.42, 0.6, 0.25], [0.42, 0.15, -0.25], [0, 0.88, 0.1]];
      for (const [x, y, z] of thorns) part(body, mat, 0.08, 0.08, 0.08, 0xcdb88c, x, y, z);
      part(body, eye, 0.12, 0.08, 0.02, 0xff4b3a, -0.16, 0.48, 0.405);
      part(body, eye, 0.12, 0.08, 0.02, 0xff4b3a, 0.16, 0.48, 0.405);
      return { legs: [], head: null, body };
    },
  },
};
export const MOB_TYPES = Object.keys(TYPES);
export const mobName = (type) => TYPES[type]?.name ?? type;
export const mobColors = { cow: ['#5e3d27', '#e9e4da'], boar: ['#7a5a40', '#c28a72'], sheep: ['#ebe8e1', '#8f857c'], chicken: ['#f4f1ea', '#d6332e'], gloom: ['#3b3552', '#ffc93a'], bramble: ['#2f5a2a', '#cdb88c'] };

const solid = (world, x, y, z) => BLOCKS[world.get(x, y, z)].solid;

class Mob {
  constructor(type, x, y, z, eyeMat) {
    this.type = type;
    this.t = TYPES[type];
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = this.t.hp;
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    this.model = this.t.build(this.group, this.mat, eyeMat);
    this.hurtT = 0;
    this.dying = 0;
    this.onGround = false;
    this.walk = 0;
    this.moving = false;
    this.aiT = Math.random() * 3;
    this.panic = 0;
    this.attackCd = 0;
    this.soundT = 5 + Math.random() * 15;
    this.burnT = 0;
  }

  moveAxis(world, axis, d) {
    if (!d) return false;
    const p = this.pos, hw = this.t.w / 2, h = this.t.h;
    p[axis] += d;
    const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw - 1e-6);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + h - 1e-6);
    const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw - 1e-6);
    let limit = d > 0 ? Infinity : -Infinity;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (!solid(world, x, y, z)) continue;
      const b = axis === 'x' ? x : axis === 'y' ? y : z;
      limit = d > 0 ? Math.min(limit, b) : Math.max(limit, b + 1);
    }
    if (!Number.isFinite(limit)) return false;
    const ext = axis === 'y' ? (d > 0 ? h : 0) : hw;
    p[axis] = d > 0 ? limit - ext - 1e-4 : limit + ext + 1e-4;
    return true;
  }

  // Is it safe to step towards yaw (ground within 3 blocks, no water)?
  safeAhead(world) {
    const ax = Math.floor(this.pos.x + Math.sin(this.yaw) * (this.t.w / 2 + 0.5));
    const az = Math.floor(this.pos.z + Math.cos(this.yaw) * (this.t.w / 2 + 0.5));
    const y = Math.floor(this.pos.y);
    if (world.get(ax, y, az) === B.WATER || world.get(ax, y - 1, az) === B.WATER) return false;
    for (let i = 0; i <= 3; i++) if (solid(world, ax, y - i, az) || solid(world, ax, y + 1 - i, az)) return true;
    return false;
  }
}

export class Mobs {
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks; // { sound(name, pos), hurtPlayer(n, why, from), puff(pos, hex), drop(id, n, pos) }
    this.list = [];
    this.spawnT = 2;
    this.eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  }

  clear() {
    for (const m of this.list) { this.scene.remove(m.group); m.mat.dispose(); }
    this.list = [];
  }

  spawn(type, x, y, z) {
    const m = new Mob(type, x, y, z, this.eyeMat);
    this.scene.add(m.group);
    this.list.push(m);
    return m;
  }

  // Highest standing spot at column x,z, or null.
  surfaceAt(world, x, z) {
    const top = Math.min(CH - 2, world.heightAt(x, z) + 14);
    for (let y = top; y > 1; y--) {
      const id = world.get(x, y, z);
      if (id === B.WATER) return null;
      if (BLOCKS[id].solid) {
        if (BLOCKS[world.get(x, y + 1, z)].solid || BLOCKS[world.get(x, y + 2, z)].solid) return null;
        return { y: y + 1, ground: id };
      }
    }
    return null;
  }

  trySpawn(world, player, daylight) {
    const animals = this.list.filter((m) => !m.t.hostile).length;
    const hostiles = this.list.length - animals;
    const night = daylight < 0.35;
    const wantHostile = night && hostiles < 10 && Math.random() < 0.8;
    if (!wantHostile && animals >= 14) return;
    const a = Math.random() * Math.PI * 2;
    const d = wantHostile ? 22 + Math.random() * 18 : 18 + Math.random() * 26;
    const x = Math.floor(player.pos.x + Math.cos(a) * d), z = Math.floor(player.pos.z + Math.sin(a) * d);
    const s = this.surfaceAt(world, x, z);
    if (!s) return;
    if (wantHostile) {
      if (s.ground === B.LEAVES || s.ground === B.BLOSSOM) return;
      this.spawn(Math.random() < 0.65 ? 'gloom' : 'bramble', x + 0.5, s.y, z + 0.5);
      return;
    }
    if (s.ground !== B.GRASS) return;
    const biome = world.biome(x, z);
    const options = MOB_TYPES.filter((k) => TYPES[k].biomes?.includes(biome));
    const type = options[Math.floor(Math.random() * options.length)];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ox = x + Math.floor(Math.random() * 5) - 2, oz = z + Math.floor(Math.random() * 5) - 2;
      const s2 = this.surfaceAt(world, ox, oz);
      if (s2 && s2.ground === B.GRASS) this.spawn(type, ox + 0.5, s2.y, oz + 0.5);
    }
  }

  // Nearest mob hit by a ray, as { mob, dist }.
  raycast(o, d, maxDist) {
    let best = null;
    for (const m of this.list) {
      if (m.dying) continue;
      const hw = m.t.w / 2 + 0.05;
      const min = [m.pos.x - hw, m.pos.y, m.pos.z - hw], max = [m.pos.x + hw, m.pos.y + m.t.h, m.pos.z + hw];
      const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      let t0 = 0, t1 = maxDist;
      for (let i = 0; i < 3 && t0 <= t1; i++) {
        if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < min[i] || oo[i] > max[i]) t0 = Infinity; continue; }
        let a = (min[i] - oo[i]) / dd[i], b = (max[i] - oo[i]) / dd[i];
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      if (t0 <= t1 && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
    }
    return best;
  }

  hit(m, damage, from) {
    if (m.dying) return;
    m.hp -= damage;
    m.hurtT = 0.35;
    const dx = m.pos.x - from.x, dz = m.pos.z - from.z, len = Math.hypot(dx, dz) || 1;
    m.vel.x += (dx / len) * 6;
    m.vel.z += (dz / len) * 6;
    m.vel.y = 5.5;
    if (!m.t.hostile) { m.panic = 5; m.yaw = Math.atan2(dx, dz); }
    this.hooks.sound('mobhurt', m.pos);
    if (m.hp <= 0) m.dying = 0.001;
  }

  update(dt, world, player, { daylight, targetable, brightness }) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 1.5; this.trySpawn(world, player, daylight); }
    const pp = player.pos;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      const t = m.t, p = m.pos, v = m.vel;
      const dist = Math.hypot(p.x - pp.x, p.z - pp.z);
      // Despawn far away, and monsters fade out in daylight.
      if (dist > 96 || (t.hostile && daylight > 0.6 && dist > 40)) { this.remove(i); continue; }
      if (t.hostile && daylight > 0.6 && !m.dying) {
        m.burnT -= dt;
        if (m.burnT <= 0) { m.burnT = 1; m.hp -= 2; m.hurtT = 0.2; this.hooks.puff(p.clone().setY(p.y + t.h), 0x777777); if (m.hp <= 0) m.dying = 0.001; }
      }

      if (m.dying) {
        m.dying += dt;
        m.group.rotation.z = Math.min(Math.PI / 2, m.dying * 4);
        if (m.dying > 0.6) {
          this.hooks.puff(p.clone().setY(p.y + t.h / 2), 0xdddddd);
          for (const [id, lo, hi] of t.drops) {
            const n = lo + Math.floor(Math.random() * (hi - lo + 1));
            if (n > 0) this.hooks.drop(id, n, p.clone().setY(p.y + 0.5));
          }
          this.hooks.sound('poof', p);
          this.remove(i);
          continue;
        }
      } else if (dist < 72) {
        this.think(m, dt, world, player, dist, targetable);
      }

      // Physics.
      const inWater = world.get(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z)) === B.WATER;
      if (inWater) { v.y += 14 * dt; v.y = Math.max(-2, Math.min(2.2, v.y)); }
      else v.y -= 28 * dt;
      if (m.type === 'chicken' && v.y < -2.5) v.y = -2.5;
      v.y = Math.max(v.y, -40);
      if (m.moving && !m.dying) {
        const sp = m.speedNow;
        const k = 1 - Math.exp(-(m.onGround || inWater ? 10 : 1.5) * dt);
        v.x += (Math.sin(m.yaw) * sp - v.x) * k;
        v.z += (Math.cos(m.yaw) * sp - v.z) * k;
      } else if (m.onGround) {
        const f = Math.exp(-10 * dt);
        v.x *= f; v.z *= f;
      }
      const dx = v.x * dt, dy = v.y * dt, dz = v.z * dt;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
      m.onGround = false;
      let wall = false;
      for (let s = 0; s < steps; s++) {
        if (m.moveAxis(world, 'y', dy / steps)) { if (v.y < 0) m.onGround = true; v.y = 0; }
        if (m.moveAxis(world, 'x', dx / steps)) { wall = true; v.x = 0; }
        if (m.moveAxis(world, 'z', dz / steps)) { wall = true; v.z = 0; }
      }
      if (wall && m.moving && (m.onGround || inWater) && !t.hopper) v.y = 8.2;
      if (p.y < -20) { this.remove(i); continue; }

      // Animation.
      const hs = Math.hypot(v.x, v.z);
      m.walk += hs * dt * 3.2;
      const swingA = Math.min(1, hs / 1.5) * 0.7;
      m.model.legs.forEach((l, k) => { l.rotation.x = Math.sin(m.walk + (k % 2 === (k < 2 ? 0 : 1) ? 0 : Math.PI)) * swingA; });
      if (m.model.arms) m.model.arms.forEach((a, k) => { a.rotation.x = -1.35 + Math.sin(m.walk * 0.5 + k * Math.PI) * 0.12; });
      if (m.model.wings) m.model.wings.forEach((w, k) => { w.rotation.z = (k ? -1 : 1) * (m.onGround ? 0 : Math.abs(Math.sin(performance.now() / 60)) * 0.9); });
      if (m.model.body) { const sq = m.onGround ? 1 : 0.9; m.model.body.scale.set(2 - sq, sq, 2 - sq); }
      m.group.position.copy(p);
      let dyaw = m.yaw - m.group.rotation.y;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      m.group.rotation.y += dyaw * Math.min(1, dt * 8);
      if (m.model.head && dist < 7 && !t.hostile && !m.panic) {
        let hy = Math.atan2(pp.x - p.x, pp.z - p.z) - m.group.rotation.y;
        hy = Math.atan2(Math.sin(hy), Math.cos(hy));
        m.model.head.rotation.y = Math.max(-0.8, Math.min(0.8, hy));
      } else if (m.model.head) m.model.head.rotation.y *= 0.9;

      m.hurtT = Math.max(0, m.hurtT - dt);
      m.mat.color.setRGB(brightness, m.hurtT > 0 ? brightness * 0.35 : brightness, m.hurtT > 0 ? brightness * 0.35 : brightness);

      m.soundT -= dt;
      if (m.soundT <= 0) { m.soundT = 8 + Math.random() * 16; if (dist < 20) this.hooks.sound(t.sound, p); }
    }
  }

  think(m, dt, world, player, dist, targetable) {
    const t = m.t, p = m.pos;
    m.attackCd -= dt;
    if (t.hostile && targetable && dist < 18) {
      m.yaw = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
      if (t.hopper) {
        m.moving = false;
        m.aiT -= dt;
        if (m.onGround && m.aiT <= 0) {
          m.aiT = 0.9 + Math.random() * 0.5;
          m.vel.y = 6.8;
          m.vel.x = Math.sin(m.yaw) * t.chase;
          m.vel.z = Math.cos(m.yaw) * t.chase;
          this.hooks.sound('rustle', p);
        }
      } else {
        m.moving = dist > 0.9;
        m.speedNow = t.chase;
      }
      const dy = player.pos.y - p.y;
      if (dist < 0.6 + t.w / 2 + 0.4 && dy > -1.6 && dy < t.h && m.attackCd <= 0) {
        m.attackCd = 1;
        this.hooks.hurtPlayer(t.damage, `were defeated by a ${t.name}`, p);
      }
      return;
    }
    // Wandering (and fleeing after being hit).
    m.panic = Math.max(0, m.panic - dt);
    m.aiT -= dt;
    if (t.hopper) {
      if (m.onGround && m.aiT <= 0) {
        m.aiT = 2 + Math.random() * 4;
        m.yaw = Math.random() * Math.PI * 2;
        m.vel.y = 5.5; m.vel.x = Math.sin(m.yaw) * 1.5; m.vel.z = Math.cos(m.yaw) * 1.5;
      }
      m.moving = false;
      return;
    }
    if (m.aiT <= 0) {
      m.aiT = m.panic ? 0.6 + Math.random() : 2 + Math.random() * 5;
      m.moving = m.panic > 0 || Math.random() < 0.55;
      m.yaw += m.panic ? (Math.random() - 0.5) * 1.5 : (Math.random() - 0.5) * Math.PI * 1.6;
    }
    m.speedNow = t.speed * (m.panic ? 2.3 : 1);
    if (m.moving && m.onGround && !m.panic && !m.safeAhead(world)) {
      m.yaw += Math.PI * (0.6 + Math.random() * 0.8);
      m.moving = false;
      m.aiT = 0.5 + Math.random();
    }
  }

  remove(i) {
    const m = this.list[i];
    this.scene.remove(m.group);
    m.mat.dispose();
    this.list.splice(i, 1);
  }
}
