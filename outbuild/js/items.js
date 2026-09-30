// Item definitions, loot tables, the inventory, and pickups/chests lying in the world.
import * as THREE from 'three';
import { RARITIES, MAX_MATS } from './config.js';
import { tinted } from './materials.js';

// ----------------------------------------------------------------------------- definitions
// Damage is for the Common version; rarer versions multiply it by RARITIES[r].mult.
export const WEAPONS = {
  pistol: { name: 'Sidearm', model: 'W_Pistol', hold: 'pistol', ammo: 'light', dmg: 25, rate: 6.5, mag: 16, reload: 1.3,
    spread: 0.035, adsSpread: 0.01, moveSpread: 0.03, bloom: 0.012, head: 2, range: 140, auto: false, recoil: 0.35,
    kick: 0.012, falloff: [35, 120, 0.6], rarities: [0, 1, 2], sound: 'pistol', structure: 1 },
  smg: { name: 'Swift SMG', model: 'W_SMG', hold: 'rifle', ammo: 'light', dmg: 17, rate: 12, mag: 30, reload: 2.0,
    spread: 0.045, adsSpread: 0.028, moveSpread: 0.02, bloom: 0.004, head: 1.75, range: 110, auto: true, recoil: 0.16,
    kick: 0.006, falloff: [20, 90, 0.55], rarities: [0, 1, 2, 3], sound: 'smg', structure: 1 },
  ar: { name: 'Assault Rifle', model: 'W_AR', hold: 'rifle', ammo: 'medium', dmg: 30, rate: 5.5, mag: 30, reload: 2.2,
    spread: 0.038, adsSpread: 0.006, moveSpread: 0.03, bloom: 0.006, head: 1.5, range: 250, auto: true, recoil: 0.3,
    kick: 0.01, falloff: [60, 250, 0.7], rarities: [0, 1, 2, 3, 4], sound: 'ar', structure: 1 },
  pump: { name: 'Pump Shotgun', model: 'W_Pump', hold: 'rifle', ammo: 'shells', dmg: 9.5, pellets: 10, rate: 0.85, mag: 5,
    reload: 4.4, spread: 0.1, adsSpread: 0.085, moveSpread: 0.01, bloom: 0, head: 1.6, range: 45, auto: false, recoil: 1,
    kick: 0.05, falloff: [6, 30, 0.25], rarities: [1, 2, 3, 4], sound: 'pump', structure: 0.5, pumpAction: true },
  tactical: { name: 'Combat Shotgun', model: 'W_Tactical', hold: 'rifle', ammo: 'shells', dmg: 7.5, pellets: 9, rate: 1.5,
    mag: 8, reload: 5.2, spread: 0.12, adsSpread: 0.1, moveSpread: 0.01, bloom: 0, head: 1.6, range: 40, auto: false,
    recoil: 0.7, kick: 0.035, falloff: [6, 28, 0.25], rarities: [0, 1, 2, 3], sound: 'tactical', structure: 0.5 },
  sniper: { name: 'Bolt Sniper', model: 'W_Sniper', hold: 'rifle', ammo: 'heavy', dmg: 105, rate: 0.36, mag: 1,
    reload: 2.4, spread: 0.09, adsSpread: 0, moveSpread: 0.05, bloom: 0, head: 2.5, range: 800, auto: false, recoil: 1.3,
    kick: 0.08, falloff: null, rarities: [2, 3, 4], sound: 'sniper', structure: 1.5, projectile: { speed: 420, gravity: 7 },
    scope: true },
  rocket: { name: 'Rocket Launcher', model: 'W_Rocket', hold: 'rocket', ammo: 'rockets', dmg: 100, rate: 0.8, mag: 1,
    reload: 2.8, spread: 0.01, adsSpread: 0, moveSpread: 0.01, bloom: 0, head: 1, range: 500, auto: false, recoil: 1.5,
    kick: 0.06, falloff: null, rarities: [3, 4], sound: 'rocket', structure: 6, projectile: { speed: 65, gravity: 0 },
    splash: 4.5 },
};
for (const [id, w] of Object.entries(WEAPONS)) w.id = id;

export const CONSUMABLES = {
  bandage: { name: 'Bandage Roll', model: 'Bandage', hp: 15, cap: 75, time: 3.5, max: 15, pickup: 5 },
  medkit: { name: 'Med Kit', model: 'Medkit', hp: 100, cap: 100, time: 9, max: 3, pickup: 1 },
  shieldSmall: { name: 'Shield Flask', model: 'ShieldSmall', shield: 25, cap: 50, time: 2, max: 6, pickup: 3 },
  shieldBig: { name: 'Shield Jug', model: 'ShieldBig', shield: 50, cap: 100, time: 5, max: 3, pickup: 1 },
};
for (const [id, c] of Object.entries(CONSUMABLES)) c.id = id;

export const AMMO = {
  light: { name: 'Light Ammo', model: 'Ammo_Light', pickup: [18, 30], max: 999 },
  medium: { name: 'Medium Ammo', model: 'Ammo_Medium', pickup: [15, 30], max: 999 },
  heavy: { name: 'Heavy Ammo', model: 'Ammo_Heavy', pickup: [3, 6], max: 999 },
  shells: { name: 'Shells', model: 'Ammo_Shells', pickup: [4, 8], max: 999 },
  rockets: { name: 'Rockets', model: 'Ammo_Rockets', pickup: [2, 4], max: 999 },
};

export const MATERIAL_ITEMS = {
  wood: { name: 'Wood', model: 'Mat_Wood' },
  stone: { name: 'Stone', model: 'Mat_Stone' },
  metal: { name: 'Metal', model: 'Mat_Metal' },
};

export function itemName(it) {
  if (it.type === 'weapon') return WEAPONS[it.id].name;
  if (it.type === 'consumable') return CONSUMABLES[it.id].name;
  if (it.type === 'ammo') return AMMO[it.id].name;
  if (it.type === 'mat') return MATERIAL_ITEMS[it.id].name;
  return '?';
}

export function itemModel(it) {
  if (it.type === 'weapon') return WEAPONS[it.id].model;
  if (it.type === 'consumable') return CONSUMABLES[it.id].model;
  if (it.type === 'ammo') return AMMO[it.id].model;
  return MATERIAL_ITEMS[it.id].model;
}

export function weaponDamage(it) {
  const w = WEAPONS[it.id];
  return w.dmg * RARITIES[it.rarity].mult;
}

export function makeWeapon(id, rarity) {
  const w = WEAPONS[id];
  return { type: 'weapon', id, rarity, mag: w.mag };
}

// ----------------------------------------------------------------------------- loot tables
const WEAPON_TABLE = [
  { id: 'ar', w: 26 }, { id: 'smg', w: 16 }, { id: 'pump', w: 16 }, { id: 'tactical', w: 12 }, { id: 'pistol', w: 16 },
  { id: 'sniper', w: 6 }, { id: 'rocket', w: 3 },
];
const CONSUMABLE_TABLE = [
  { id: 'bandage', w: 30 }, { id: 'medkit', w: 10 }, { id: 'shieldSmall', w: 28 }, { id: 'shieldBig', w: 14 },
];
const RARITY_WEIGHTS = [40, 30, 18, 9, 3];

function rollRarity(rng, allowed, boost = 0) {
  const items = allowed.map((r) => ({ r, w: RARITY_WEIGHTS[r] * (1 + boost * r) }));
  return rng.weighted(items).r;
}

export function rollWeapon(rng, boost = 0) {
  const pick = rng.weighted(WEAPON_TABLE);
  const w = WEAPONS[pick.id];
  return makeWeapon(pick.id, rollRarity(rng, w.rarities, boost));
}

export function ammoFor(weaponId, rng, mult = 1) {
  const kind = WEAPONS[weaponId].ammo;
  const [a, b] = AMMO[kind].pickup;
  return { type: 'ammo', id: kind, count: Math.round(rng.int(a, b) * mult) };
}

export function rollConsumable(rng) {
  const id = rng.weighted(CONSUMABLE_TABLE).id;
  return { type: 'consumable', id, count: CONSUMABLES[id].pickup };
}

export function floorLoot(rng) {
  const r = rng.next();
  if (r < 0.62) {
    const w = rollWeapon(rng);
    return [w, ammoFor(w.id, rng)];
  }
  if (r < 0.85) return [rollConsumable(rng)];
  const kinds = Object.keys(AMMO).filter((k) => k !== 'rockets' || rng.chance(0.2));
  const k = rng.pick(kinds);
  const [a, b] = AMMO[k].pickup;
  return [{ type: 'ammo', id: k, count: rng.int(a, b) }];
}

export function chestLoot(rng) {
  const w = rollWeapon(rng, 0.45);
  const out = [w, ammoFor(w.id, rng, 1.5)];
  out.push(rng.chance(0.55) ? rollConsumable(rng) : rollWeapon(rng, 0.2));
  if (out[2].type === 'weapon') out.push(ammoFor(out[2].id, rng));
  out.push({ type: 'mat', id: rng.pick(['wood', 'wood', 'stone', 'metal']), count: 30 });
  return out;
}

export function ammoBoxLoot(rng) {
  const kinds = ['light', 'medium', 'heavy', 'shells', 'medium', 'light', 'shells'];
  const out = [];
  for (let i = 0; i < 2; i++) {
    const k = rng.pick(kinds);
    const [a, b] = AMMO[k].pickup;
    out.push({ type: 'ammo', id: k, count: Math.round(rng.int(a, b) * 1.3) });
  }
  return out;
}

// ----------------------------------------------------------------------------- inventory
export class Inventory {
  constructor() {
    this.slots = [null, null, null, null, null];
    this.selected = -1; // -1 = harvesting tool
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 };
    this.mats = { wood: 0, stone: 0, metal: 0 };
  }

  current() { return this.selected >= 0 ? this.slots[this.selected] : null; }

  freeSlot() { return this.slots.findIndex((s) => !s); }

  // Returns a list of items that could not be taken (to drop back into the world).
  add(item, { swap = true } = {}) {
    const left = [];
    if (item.type === 'ammo') {
      this.ammo[item.id] = Math.min(AMMO[item.id].max, this.ammo[item.id] + item.count);
      return left;
    }
    if (item.type === 'mat') {
      const room = MAX_MATS - this.mats[item.id];
      const take = Math.min(room, item.count);
      this.mats[item.id] += take;
      if (item.count - take > 0) left.push({ ...item, count: item.count - take });
      return left;
    }
    if (item.type === 'consumable') {
      const def = CONSUMABLES[item.id];
      let count = item.count;
      for (const s of this.slots) {
        if (s && s.type === 'consumable' && s.id === item.id && s.count < def.max) {
          const t = Math.min(def.max - s.count, count);
          s.count += t;
          count -= t;
          if (!count) return left;
        }
      }
      if (count > 0) {
        const f = this.freeSlot();
        if (f >= 0) { this.slots[f] = { ...item, count }; return left; }
        if (swap && this.selected >= 0) {
          left.push(this.slots[this.selected]);
          this.slots[this.selected] = { ...item, count };
          return left;
        }
        left.push({ ...item, count });
      }
      return left;
    }
    // weapon
    const f = this.freeSlot();
    if (f >= 0) { this.slots[f] = item; return left; }
    if (swap && this.selected >= 0) {
      left.push(this.slots[this.selected]);
      this.slots[this.selected] = item;
      return left;
    }
    left.push(item);
    return left;
  }

  hasRoomFor(item) {
    if (item.type === 'ammo' || item.type === 'mat') return true;
    if (this.freeSlot() >= 0) return true;
    if (item.type === 'consumable') {
      return this.slots.some((s) => s && s.type === 'consumable' && s.id === item.id && s.count < CONSUMABLES[item.id].max);
    }
    return false;
  }

  // Everything, for dropping on death.
  dump() {
    const out = this.slots.filter(Boolean);
    for (const [k, v] of Object.entries(this.ammo)) if (v > 0) out.push({ type: 'ammo', id: k, count: v });
    for (const [k, v] of Object.entries(this.mats)) if (v > 0) out.push({ type: 'mat', id: k, count: Math.min(v, 999) });
    this.slots = [null, null, null, null, null];
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 };
    this.mats = { wood: 0, stone: 0, metal: 0 };
    return out;
  }

  // Rough power score, used by bots to pick weapons.
  static score(it) {
    if (!it || it.type !== 'weapon') return 0;
    const base = { ar: 10, pump: 9.5, smg: 8, tactical: 8.5, sniper: 7, rocket: 7.5, pistol: 5 }[it.id];
    return base + it.rarity * 1.2;
  }
}

// ----------------------------------------------------------------------------- world pickups
const GLOW_GEO = new THREE.RingGeometry(0.28, 0.5, 32).rotateX(-Math.PI / 2);
const BEAM_GEO = new THREE.CylinderGeometry(0.06, 0.18, 2.2, 12, 1, true).translate(0, 1.1, 0);

function glowMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: true });
}
const glowMats = new Map();
function glowMat(color, kind) {
  const k = color + kind;
  if (!glowMats.has(k)) glowMats.set(k, glowMaterial(new THREE.Color(color).multiplyScalar(kind === 'beam' ? 0.5 : 1), kind === 'beam' ? 0.45 : 0.8));
  return glowMats.get(k);
}

let pickupId = 1;

export class PickupSystem {
  constructor(scene, assets, terrain, physics) {
    this.scene = scene;
    this.assets = assets;
    this.terrain = terrain;
    this.physics = physics;
    this.list = [];
    this.chests = [];
    this.time = 0;
  }

  spawn(item, x, y, z, { toss = false } = {}) {
    const group = new THREE.Group();
    const model = this.assets.instance(itemModel(item), { shadows: false,
      override: (mn) => (mn === 'Rarity' && item.type === 'weapon' ? tinted('Rarity', RARITIES[item.rarity].color) : null) });
    const scale = item.type === 'weapon' ? 0.9 : 1.1;
    model.scale.setScalar(scale);
    // weapons lie on their side, floating a bit
    if (item.type === 'weapon') { model.rotation.set(0, 0, Math.PI / 2); model.position.y = 0.35; }
    else model.position.y = 0.15;
    group.add(model);
    const color = item.type === 'weapon' ? RARITIES[item.rarity].glow : item.type === 'consumable' ? '#58c4ff' : '#c9c9c9';
    const ring = new THREE.Mesh(GLOW_GEO, glowMat(color, 'ring'));
    ring.position.y = 0.04;
    group.add(ring);
    if (item.type === 'weapon' && item.rarity >= 2) {
      const beam = new THREE.Mesh(BEAM_GEO, glowMat(color, 'beam'));
      group.add(beam);
    }
    group.position.set(x, y, z);
    this.scene.add(group);
    const p = { id: pickupId++, item, group, model, x, y, z, vy: toss ? 5 + Math.random() * 2 : 0,
      vx: toss ? (Math.random() - 0.5) * 5 : 0, vz: toss ? (Math.random() - 0.5) * 5 : 0, settled: !toss, phase: Math.random() * 6,
      alive: true, baseY: model.position.y };
    this.list.push(p);
    return p;
  }

  spawnMany(items, x, y, z, toss = true) {
    return items.map((it) => this.spawn(it, x, y + 0.5, z, { toss }));
  }

  remove(p) {
    p.alive = false;
    this.scene.remove(p.group);
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  nearest(pos, maxDist, filter = null) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const p of this.list) {
      if (filter && !filter(p)) continue;
      const d = (p.x - pos.x) ** 2 + ((p.y - pos.y) * 0.6) ** 2 + (p.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // Chests and ammo boxes
  addContainer(kind, x, y, z, yaw) {
    const isChest = kind === 'chest';
    const body = this.assets.instance(isChest ? 'Chest' : 'AmmoBox');
    const lidName = isChest ? 'Chest_Lid' : 'AmmoBox_Lid';
    const group = new THREE.Group();
    group.add(body);
    let lid = null;
    if (this.assets.has(lidName)) {
      const lp = this.assets.proto(lidName);
      lid = this.assets.instance(lidName);
      const pivot = new THREE.Group();
      pivot.position.copy(lp.position);
      pivot.quaternion.copy(lp.quaternion);
      pivot.add(lid);
      group.add(pivot);
      lid = pivot;
    }
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    this.scene.add(group);
    let light = null;
    if (isChest) {
      light = new THREE.PointLight(0xffc860, 2.5, 6, 2);
      light.position.set(0, 0.8, 0);
      light.castShadow = false;
      group.add(light);
    }
    const c = { kind, group, lid, x, y, z, yaw, opened: false, open: 0, light, sparkle: Math.random() * 6 };
    this.chests.push(c);
    return c;
  }

  nearestContainer(pos, maxDist) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const c of this.chests) {
      if (c.opened) continue;
      const d = (c.x - pos.x) ** 2 + ((c.y - pos.y) * 0.7) ** 2 + (c.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  update(dt, camPos) {
    this.time += dt;
    for (const p of this.list) {
      if (!p.settled) {
        p.vy -= 20 * dt;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.y += p.vy * dt;
        const g = this.physics.groundAt(p.x, p.z, p.y + 0.3, 0.2, 0.6);
        if (p.y <= g) {
          p.y = g;
          if (Math.abs(p.vy) < 2) { p.settled = true; p.vx = p.vz = p.vy = 0; } else { p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
        }
        p.group.position.set(p.x, p.y, p.z);
      }
      // gentle bob and spin (skip far ones)
      const d2 = (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2;
      p.group.visible = d2 < 160 * 160;
      if (d2 < 60 * 60) {
        p.model.position.y = p.baseY + Math.sin(this.time * 2 + p.phase) * 0.06;
        p.model.rotation.y += dt * 0.8;
      }
    }
    for (const c of this.chests) {
      if (c.opened && c.open < 1) {
        c.open = Math.min(1, c.open + dt * 3);
        if (c.lid) c.lid.rotation.x = -c.open * 1.9;
        if (c.light) c.light.intensity = 2.5 * (1 - c.open);
      } else if (!c.opened && c.light) {
        c.light.intensity = 2 + Math.sin(this.time * 3 + c.sparkle) * 0.6;
        c.light.visible = (c.x - camPos.x) ** 2 + (c.z - camPos.z) ** 2 < 70 * 70;
      }
    }
  }

  clear() {
    for (const p of [...this.list]) this.remove(p);
    for (const c of this.chests) this.scene.remove(c.group);
    this.chests.length = 0;
  }
}
