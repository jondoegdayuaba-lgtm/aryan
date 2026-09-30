// Lays out the island: towns built from grid pieces, landmarks, forests, rocks and loot spots.
import { GRID, WORLD } from './config.js';
import { Rng, Noise2D, smoothstep, clamp } from './util.js';
import { POIS, LOBBY } from './layout.js';

const S = GRID.cell;
const H = GRID.level;
const cellOf = (v) => Math.floor(v / S);

const SIDING = ['#f3e6c4', '#cfe3f1', '#f2cfc7', '#d7ecd0', '#e8e0f3', '#fff4d6', '#e3d5c3', '#bfe0dc', '#f6d7a8'];
const ROOFS = ['#8a4b3a', '#5a6470', '#3f5a7a', '#6b4a3a', '#7a2f2f', '#4a6b4a', '#60506e'];
const BRICKS = ['#ffffff', '#f2d6c8', '#e0c9b0', '#d6dde6', '#f0e2d0'];
const CAR_COLORS = ['#d8342c', '#2d6fd1', '#f2c14e', '#3a9d5d', '#e8e8e8', '#2b2b30', '#e67e22', '#8e44ad', '#16a2b8'];
const METAL_COLORS = ['#c0392b', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085', '#d35400', '#7f8c8d'];

export class World {
  constructor({ seed, terrain, pieces, props }) {
    this.rng = new Rng(seed);
    this.noise = new Noise2D(seed + 99);
    this.terrain = terrain;
    this.pieces = pieces;
    this.props = props;
    this.chests = [];
    this.ammoBoxes = [];
    this.floorLoot = [];
    this.landmarks = [];
    this.houses = [];
    this.occupied = []; // rectangles (x0, z0, x1, z1) no nature should grow in
  }

  // ------------------------------------------------------------------ piece helpers
  wall(model, ix, iy, iz, axis, color) {
    return this.pieces.add(model, { ix, iy, iz, axis }, { house: true, color });
  }
  floor(model, ix, iy, iz, color) {
    return this.pieces.add(model, { ix, iy, iz }, { house: true, color });
  }
  mid(model, ix, iy, iz, dir, color) {
    return this.pieces.add(model, { ix, iy, iz, dir }, { house: true, color });
  }

  block(x0, z0, x1, z1, margin = 1) {
    this.occupied.push([x0 - margin, z0 - margin, x1 + margin, z1 + margin]);
    this.terrain.markFlat(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1);
  }

  isFree(x, z, pad = 0) {
    for (const [x0, z0, x1, z1] of this.occupied) {
      if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ houses
  /**
   * A rectangular building of w x d cells and `floors` storeys starting at level L.
   * style: 'siding' | 'brick' | 'metal'; roof: 'gable' | 'flat' | 'cone'
   */
  house({ ox, oz, L, w, d, floors = 1, style = 'siding', roof = 'gable', color, roofColor, door = 0, windows = 0.6,
    chests = 1, loot = 2, stairs = true, interiorFloor = true }) {
    const rng = this.rng;
    const wallModel = { siding: 'HouseWall', brick: 'BrickWall', metal: 'MetalWall' }[style];
    const floorModel = style === 'siding' ? 'HouseFloor' : 'ConcreteFloor';
    const tint = color || (style === 'siding' ? rng.pick(SIDING) : style === 'brick' ? rng.pick(BRICKS) : rng.pick(METAL_COLORS));
    const roofTint = roofColor || rng.pick(ROOFS);
    // door side: 0 = -Z, 1 = +X, 2 = +Z, 3 = -X
    const doorCell = door % 2 === 0 ? Math.floor(w / 2) : Math.floor(d / 2);
    let stairCell = null;
    if (floors > 1 && stairs) {
      // stairs against the back wall, away from the door
      const sx = rng.int(0, w - 1);
      stairCell = { ix: ox + sx, iz: door === 0 ? oz + d - 1 : oz, dir: door === 0 ? 2 : 0 };
      if (w === 1 && d > 1) stairCell = { ix: ox, iz: door === 0 ? oz + d - 1 : oz, dir: door === 0 ? 2 : 0 };
    }
    for (let f = 0; f < floors; f++) {
      const y = L + f;
      // walls along X (axis 0) at the -Z and +Z sides
      for (let i = 0; i < w; i++) {
        for (const [iz, side] of [[oz, 0], [oz + d, 2]]) {
          let model = wallModel;
          if (f === 0 && door === side && i === doorCell) model += style === 'metal' && w >= 3 ? 'Garage' : 'Door';
          else if (style !== 'metal' && rng.chance(windows)) model += 'Window';
          this.wall(model, ox + i, y, iz, 0, tint);
        }
      }
      for (let j = 0; j < d; j++) {
        for (const [ix, side] of [[ox, 3], [ox + w, 1]]) {
          let model = wallModel;
          if (f === 0 && door === side && j === doorCell) model += 'Door';
          else if (style !== 'metal' && rng.chance(windows)) model += 'Window';
          this.wall(model, ix, y, oz + j, 1, tint);
        }
      }
      // floor of this storey
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < d; j++) {
          const ix = ox + i, iz = oz + j;
          if (f > 0 && stairCell && stairCell.ix === ix && stairCell.iz === iz) continue;
          if (f > 0 && !interiorFloor) continue;
          this.floor(floorModel, ix, y, iz);
        }
      }
      if (stairCell && f < floors - 1) this.mid('Stairs', stairCell.ix, y, stairCell.iz, stairCell.dir);
    }
    // roof
    const top = L + floors;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this.floor(roof === 'flat' ? floorModel : 'HouseFloor', ox + i, top, oz + j);
    if (roof === 'gable' && (w >= 2 || d >= 2)) {
      // ridge along the longer side; ramps climb from both eaves
      const alongX = w >= d;
      const span = alongX ? d : w;
      const half = Math.floor(span / 2);
      for (let k = 0; k < span; k++) {
        const odd = span % 2 === 1 && k === half;
        for (let m = 0; m < (alongX ? w : d); m++) {
          const ix = alongX ? ox + m : ox + k;
          const iz = alongX ? oz + k : oz + m;
          if (odd) { this.floor('HouseFloor', ix, top + 1, iz); continue; }
          const low = k < half;
          const dir = alongX ? (low ? 0 : 2) : (low ? 1 : 3);
          this.mid('Roof', ix, top, iz, dir, roofTint);
        }
      }
    } else if (roof === 'cone' || roof === 'gable') {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this.mid('RoofCone', ox + i, top, oz + j, 0, roofTint);
    }
    const x0 = ox * S, z0 = oz * S, x1 = (ox + w) * S, z1 = (oz + d) * S;
    this.block(x0, z0, x1, z1, 2);
    // loot inside
    const spots = [];
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
        const ix = ox + i, iz = oz + j;
        if (stairCell && stairCell.ix === ix && stairCell.iz === iz) continue;
        spots.push({ x: ix * S + S / 2, y: (L + f) * H, z: iz * S + S / 2, level: f });
      }
    }
    // attic under a gable roof
    if (roof === 'gable' && rng.chance(0.5)) spots.push({ x: (ox + w / 2) * S, y: top * H, z: (oz + d / 2) * S, attic: true });
    for (let c = 0; c < chests && spots.length; c++) {
      const s = spots.splice(rng.int(0, spots.length - 1), 1)[0];
      const jx = rng.float(-1, 1), jz = rng.float(-1, 1);
      this.chests.push({ x: s.x + jx, y: s.y, z: s.z + jz, yaw: rng.int(0, 3) * Math.PI / 2 });
    }
    for (let c = 0; c < loot && spots.length; c++) {
      const s = spots.splice(rng.int(0, spots.length - 1), 1)[0];
      this.floorLoot.push({ x: s.x + rng.float(-1.2, 1.2), y: s.y, z: s.z + rng.float(-1.2, 1.2) });
    }
    if (rng.chance(0.4) && spots.length) {
      const s = spots[rng.int(0, spots.length - 1)];
      this.ammoBoxes.push({ x: s.x + rng.float(-1, 1), y: s.y, z: s.z + rng.float(-1, 1), yaw: rng.float(0, 6.28) });
    }
    this.houses.push({ ox, oz, w, d, L, floors });
    return { x0, z0, x1, z1 };
  }

  prop(name, x, z, yaw = 0, scale = 1, opts = {}) {
    const y = (opts.y !== undefined ? opts.y : this.terrain.heightAt(x, z)) - (opts.sink || 0);
    return this.props.add(name, x, y, z, yaw, scale, opts);
  }

  // ------------------------------------------------------------------ places
  build() {
    // keep the lobby backdrop clear
    this.occupied.push([LOBBY.x - 9, LOBBY.z - 9, LOBBY.x + 9, LOBBY.z + 9]);
    for (const poi of POIS) {
      const L = Math.round((this.terrain.poiHeights.get(poi.name) ?? this.terrain.sample(poi.x, poi.z)) / H);
      const cx = cellOf(poi.x), cz = cellOf(poi.z);
      if (poi.kind === 'city' || poi.kind === 'industrial') {
        // paved town centre: no tall grass
        this.terrain.markFlat(poi.x - poi.flat + 6, poi.z - poi.flat + 6, poi.x + poi.flat - 6, poi.z + poi.flat - 6, 0.85);
      }
      const fn = this['build_' + poi.kind];
      if (fn) fn.call(this, poi, cx, cz, L);
    }
    this.scatterHouses();
    this.roadside();
    this.nature();
    return this;
  }

  build_city(poi, cx, cz, L) {
    const rng = this.rng;
    const blocks = [-15, -5, 5];
    for (const bx of blocks) {
      for (const bz of blocks) {
        const centre = bx === -5 && bz === -5;
        if (centre) {
          // town hall tower in the middle block
          this.house({ ox: cx - 3, oz: cz - 3, L, w: 3, d: 3, floors: 4, style: 'brick', roof: 'flat', door: 0, chests: 3, loot: 5, windows: 0.8 });
          // plaza
          for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) this.prop('LampPost', poi.x + dx * 2.5, poi.z + dz * 2.5, 0, 1, { y: L * H });
          this.prop('Bench', poi.x - 10, poi.z + 12, 0, 1, { y: L * H });
          this.prop('Bench', poi.x + 10, poi.z + 12, 0, 1, { y: L * H });
          continue;
        }
        // 2-3 buildings per block
        const quads = [[0, 0], [4, 0], [0, 4], [4, 4]];
        const count = rng.int(2, 4);
        const order = quads.sort(() => rng.next() - 0.5).slice(0, count);
        for (const [qx, qz] of order) {
          const w = rng.int(2, 3), d = rng.int(2, 3);
          const floors = rng.int(1, 3);
          this.house({ ox: cx + bx + qx, oz: cz + bz + qz, L, w, d, floors, style: rng.chance(0.75) ? 'brick' : 'siding',
            roof: rng.chance(0.7) ? 'flat' : 'gable', door: rng.int(0, 3), chests: rng.chance(0.6) ? 1 : 0, loot: 2 });
        }
        // dumpster / car in the block
        const px = (cx + bx) * S + rng.float(4, 28), pz = (cz + bz) * S + rng.float(4, 28);
        if (this.isFree(px, pz, 2)) this.prop(rng.chance(0.5) ? 'Dumpster' : 'Car_Sedan', px, pz, rng.int(0, 3) * Math.PI / 2, 1,
          { y: L * H, tint: rng.pick(CAR_COLORS) });
      }
    }
    // cars parked along the streets
    for (let k = 0; k < 10; k++) {
      const alongX = rng.chance(0.5);
      const s = rng.pick([-6.5, 3.5, 13.5]) * S + (rng.chance(0.5) ? 2.5 : 5.5);
      const t = rng.float(-60, 60);
      const x = poi.x + (alongX ? t : s - 8 * S + 20), z = poi.z + (alongX ? s - 8 * S + 20 : t);
      if (this.isFree(x, z, 2.5)) this.prop('Car_Sedan', x, z, alongX ? Math.PI / 2 : 0, 1, { y: L * H, tint: rng.pick(CAR_COLORS) });
    }
    this.lampRow(poi.x - 64, poi.z - 8, poi.x + 64, poi.z - 8, L * H, 16);
  }

  build_suburb(poi, cx, cz, L) {
    const rng = this.rng;
    for (let k = -2; k <= 2; k++) {
      const ox = cx + k * 6 - 1;
      // north row (door faces the street to the south: +Z)
      const w1 = rng.int(2, 3), d1 = rng.int(2, 3);
      this.house({ ox, oz: cz - 3 - d1, L, w: w1, d: d1, floors: rng.int(1, 2), door: 2, chests: 1, loot: 2 });
      this.prop('Mailbox', (ox + 1) * S, (cz - 2) * S + 1.5, 0, 1, { y: L * H });
      if (rng.chance(0.6)) this.prop('Car_Sedan', (ox + w1 + 0.6) * S, (cz - 3) * S - 3, 0, 1, { y: L * H, tint: rng.pick(CAR_COLORS) });
      // south row
      const w2 = rng.int(2, 3), d2 = rng.int(2, 3);
      this.house({ ox, oz: cz + 3, L, w: w2, d: d2, floors: rng.int(1, 2), door: 0, chests: 1, loot: 2 });
      this.prop('Mailbox', (ox + 1) * S, (cz + 3) * S - 1.5, Math.PI, 1, { y: L * H });
      if (rng.chance(0.5)) this.prop('Car_Pickup', (ox + w2 + 0.6) * S, (cz + 3) * S + 3.5, 0, 1, { y: L * H, tint: rng.pick(CAR_COLORS) });
      // back fences
      for (let f = 0; f < 5; f++) {
        this.prop('Fence_Wood', (ox + f * 1.2) * S, (cz - 9) * S, 0, 1, { y: L * H });
        this.prop('Fence_Wood', (ox + f * 1.2) * S, (cz + 9) * S, 0, 1, { y: L * H });
      }
    }
    this.lampRow(poi.x - 58, poi.z + 1, poi.x + 58, poi.z + 1, L * H, 20);
  }

  build_industrial(poi, cx, cz, L) {
    const rng = this.rng;
    // two warehouses (tall single hall + mezzanine)
    for (const [ox, oz] of [[cx - 12, cz - 9], [cx + 3, cz - 9]]) {
      this.house({ ox, oz, L, w: 5, d: 4, floors: 2, style: 'metal', roof: 'flat', door: 2, chests: 2, loot: 4, interiorFloor: false });
      // mezzanine along the back
      for (let i = 0; i < 5; i++) this.floor('ConcreteFloor', ox + i, L + 1, oz);
      this.mid('Stairs', ox + 4, L, oz + 1, 2);
      this.chests.push({ x: (ox + 1.5) * S, y: (L + 1) * H, z: oz * S + 2, yaw: 0 });
    }
    // office
    this.house({ ox: cx - 4, oz: cz + 5, L, w: 2, d: 2, floors: 2, style: 'brick', roof: 'flat', door: 0, chests: 1, loot: 2 });
    // container yard
    for (let k = 0; k < 14; k++) {
      const x = poi.x + rng.float(10, 58) * (rng.chance(0.5) ? 1 : -1);
      const z = poi.z + rng.float(12, 55);
      if (!this.isFree(x, z, 5)) continue;
      const yaw = rng.chance(0.7) ? 0 : Math.PI / 2;
      const col = rng.pick(METAL_COLORS);
      this.prop('Container_A', x, z, yaw, 1, { y: L * H, tint: col });
      if (rng.chance(0.35)) this.prop('Container_A', x, z, yaw, 1, { y: L * H + 2.6, tint: rng.pick(METAL_COLORS) });
      this.block(x - 3.5, z - 3.5, x + 3.5, z + 3.5, 0);
    }
    this.prop('WaterTower', poi.x + 30, poi.z - 48, 0, 1, { y: L * H });
    this.block(poi.x + 26, poi.z - 52, poi.x + 34, poi.z - 44, 1);
    this.landmarks.push({ name: 'WaterTower', x: poi.x + 30, z: poi.z - 48 });
    for (let k = 0; k < 16; k++) {
      const x = poi.x + rng.float(-60, 60), z = poi.z + rng.float(-60, 60);
      if (!this.isFree(x, z, 1.5)) continue;
      this.prop(rng.pick(['Crate_A', 'Crate_Stack', 'Barrel_A', 'Pallets', 'Tires', 'Barrel_A']), x, z, rng.float(0, 6.28), 1,
        { y: L * H, tint: rng.pick(METAL_COLORS) });
    }
  }

  build_farm(poi, cx, cz, L) {
    const rng = this.rng;
    // big red barn
    this.house({ ox: cx - 2, oz: cz - 8, L, w: 3, d: 4, floors: 2, style: 'siding', color: '#b8453a', roofColor: '#5a4a44',
      roof: 'gable', door: 2, chests: 2, loot: 3, windows: 0.2 });
    // farmhouse
    this.house({ ox: cx + 5, oz: cz - 3, L, w: 3, d: 2, floors: 2, style: 'siding', color: '#fff4d6', roof: 'gable', door: 0,
      chests: 1, loot: 3 });
    this.prop('Windmill', poi.x - 30, poi.z + 16, 0.4, 1, { y: L * H });
    this.landmarks.push({ name: 'Windmill', x: poi.x - 30, z: poi.z + 16, y: L * H, yaw: 0.4 });
    this.block(poi.x - 34, poi.z + 12, poi.x - 26, poi.z + 20, 1);
    this.prop('Well', poi.x + 12, poi.z + 10, 0, 1, { y: L * H });
    this.prop('Tractor', poi.x - 8, poi.z + 6, 1.1, 1, { y: L * H });
    this.prop('WaterTower', poi.x + 34, poi.z - 30, 0, 0.8, { y: L * H });
    // hay bales in the field
    for (let k = 0; k < 14; k++) {
      const x = poi.x + rng.float(-60, 60), z = poi.z + rng.float(20, 62);
      if (this.isFree(x, z, 2)) this.prop('HayBale', x, z, rng.float(0, 6.28), 1, { y: L * H });
    }
    // field fences
    for (let k = -8; k < 8; k++) {
      this.prop('Fence_Wood', poi.x + k * 4 + 2, poi.z + 66, 0, 1);
      this.prop('Fence_Wood', poi.x + k * 4 + 2, poi.z - 40, 0, 1);
    }
    for (let k = -6; k < 16; k++) {
      this.prop('Fence_Wood', poi.x - 66, poi.z + k * 4 + 2, Math.PI / 2, 1);
      this.prop('Fence_Wood', poi.x + 66, poi.z + k * 4 + 2, Math.PI / 2, 1);
    }
  }

  build_harbor(poi, cx, cz, L) {
    const rng = this.rng;
    const spots = [[-8, -6], [-2, -7], [4, -6], [-7, 0], [5, 0]];
    for (const [dx, dz] of spots) {
      this.house({ ox: cx + dx, oz: cz + dz, L, w: rng.int(1, 2), d: 2, floors: 1, roof: rng.chance(0.5) ? 'cone' : 'gable',
        door: 2, chests: rng.chance(0.7) ? 1 : 0, loot: 2 });
    }
    // pier out to sea (south)
    let iz = cz + 4;
    const pierX = cx - 1;
    for (let k = 0; k < 12; k++, iz++) {
      const p1 = this.floor('HouseFloor', pierX, L, iz);
      const p2 = this.floor('HouseFloor', pierX + 1, L, iz);
      for (const p of [p1, p2]) if (p) p.grounded = true;
    }
    this.block(pierX * S, (cz + 4) * S, (pierX + 2) * S, iz * S, 0);
    this.house({ ox: pierX, oz: iz, L, w: 2, d: 2, floors: 1, roof: 'cone', door: 0, chests: 1, loot: 1 });
    for (const p of this.pieces.pieces.values()) if (p.house && p.iy === L && Math.abs(p.ix - pierX) <= 3 && p.iz >= cz + 4) p.grounded = true;
    for (let k = 0; k < 10; k++) {
      const x = poi.x + rng.float(-40, 40), z = poi.z + rng.float(-30, 12);
      if (!this.isFree(x, z, 4)) continue;
      if (rng.chance(0.4)) { this.prop('Container_A', x, z, rng.chance(0.5) ? 0 : Math.PI / 2, 1, { y: L * H, tint: rng.pick(METAL_COLORS) }); this.block(x - 3.5, z - 3.5, x + 3.5, z + 3.5, 0); }
      else this.prop(rng.pick(['Crate_A', 'Crate_Stack', 'Barrel_A', 'Pallets']), x, z, rng.float(0, 6), 1, { y: L * H, tint: rng.pick(METAL_COLORS) });
    }
  }

  build_peak(poi, cx, cz, L) {
    this.prop('RadioTower', poi.x + 6, poi.z + 4, 0, 1, { y: L * H });
    this.landmarks.push({ name: 'RadioTower', x: poi.x + 6, z: poi.z + 4 });
    this.block(poi.x + 3, poi.z + 1, poi.x + 9, poi.z + 7, 0);
    // lookout: three storeys of floors and stairs, open sides
    const ox = cx - 2, oz = cz - 2;
    for (let f = 0; f < 3; f++) {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        if (f > 0 && i === 1 && j === 1) continue;
        this.floor('HouseFloor', ox + i, L + f, oz + j);
      }
      if (f < 2) this.mid('Stairs', ox + 1, L + f, oz + 1, 2);
      this.wall('HouseWallWindow', ox, L + f, oz, 0);
      this.wall('HouseWallWindow', ox + 1, L + f, oz, 0);
      this.wall('HouseWallWindow', ox, L + f, oz, 1);
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) this.mid('RoofCone', ox + i, L + 3, oz + j, 0, '#5a6470');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) this.floor('HouseFloor', ox + i, L + 3, oz + j);
    this.block(ox * S, oz * S, (ox + 2) * S, (oz + 2) * S, 1);
    this.chests.push({ x: ox * S + 2, y: (L + 2) * H, z: oz * S + 2, yaw: 0 });
    this.chests.push({ x: ox * S + 2, y: L * H, z: oz * S + 6, yaw: 1.57 });
    this.floorLoot.push({ x: ox * S + 6, y: (L + 1) * H, z: oz * S + 2 });
  }

  build_cabins(poi, cx, cz, L) {
    const rng = this.rng;
    for (const [dx, dz] of [[-6, -4], [2, -6], [5, 1], [-5, 3], [0, 5]]) {
      this.house({ ox: cx + dx, oz: cz + dz, L, w: rng.int(1, 2), d: 2, floors: 1, color: rng.pick(['#8a5a3a', '#7a4a2e', '#9c6b43']),
        roof: rng.chance(0.5) ? 'gable' : 'cone', door: rng.int(0, 3), chests: 1, loot: 1, windows: 0.5 });
    }
    this.prop('Campfire', poi.x, poi.z, 0, 1, { y: L * H });
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + 0.3;
      this.prop('Tent', poi.x + Math.cos(a) * 9, poi.z + Math.sin(a) * 9, -a + Math.PI / 2, 1, { y: L * H });
      this.prop('Log_A', poi.x + Math.cos(a + 0.8) * 4, poi.z + Math.sin(a + 0.8) * 4, a, 0.6, { y: L * H });
    }
  }

  build_lake(poi, cx, cz, L) {
    // lodge on the north shore
    const sx = poi.x, sz = poi.z - poi.lake - 16;
    const lvl = this.terrain.flattenRect(sx - 12, sz - 10, sx + 12, sz + 6, 12);
    const ox = cellOf(sx) - 1, oz = cellOf(sz) - 1;
    this.house({ ox, oz, L: lvl, w: 3, d: 3, floors: 2, style: 'siding', color: '#c9a27a', roof: 'gable', door: 2, chests: 2, loot: 3 });
    // dock into the lake
    for (let k = 0; k < 6; k++) {
      const p = this.floor('HouseFloor', ox + 1, lvl - 1 < 1 ? lvl : lvl, oz + 3 + k);
      if (p) p.grounded = true;
    }
    this.prop('Campfire', sx + 12, sz + 8, 0, 1);
    this.prop('Bench', sx - 10, sz + 9, 0.3, 1);
  }

  build_quarry(poi, cx, cz, L) {
    const rng = this.rng;
    for (let k = 0; k < 10; k++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(poi.flat - 12, poi.flat + 8);
      this.prop('Rock_Big', poi.x + Math.cos(a) * r, poi.z + Math.sin(a) * r, rng.float(0, 6.28), rng.float(0.8, 1.4), { sink: 0.5 });
    }
    for (let k = 0; k < 18; k++) {
      const x = poi.x + rng.float(-40, 40), z = poi.z + rng.float(-40, 40);
      this.prop(rng.pick(['Rock_A', 'Rock_B', 'Rock_C']), x, z, rng.float(0, 6.28), rng.float(0.8, 1.3), { sink: 0.3 });
    }
    this.house({ ox: cx - 3, oz: cz - 2, L, w: 2, d: 2, floors: 1, style: 'metal', roof: 'flat', door: 2, chests: 1, loot: 2 });
    this.house({ ox: cx + 2, oz: cz + 1, L, w: 3, d: 2, floors: 1, style: 'metal', roof: 'flat', door: 0, chests: 1, loot: 2 });
    for (let k = 0; k < 8; k++) {
      const x = poi.x + rng.float(-25, 25), z = poi.z + rng.float(-25, 25);
      if (this.isFree(x, z, 2)) this.prop(rng.pick(['Crate_A', 'Barrel_A', 'Pallets', 'Tires']), x, z, rng.float(0, 6), 1, { tint: rng.pick(METAL_COLORS) });
    }
    this.prop('Container_A', poi.x + 18, poi.z - 14, 0.3, 1, { tint: '#d35400' });
  }

  build_beach(poi, cx, cz, L) {
    const rng = this.rng;
    for (const [dx, dz] of [[-4, -3], [1, -4], [3, 1]]) {
      this.house({ ox: cx + dx, oz: cz + dz, L, w: 1, d: 2, floors: 1, color: rng.pick(['#bfe0dc', '#f6d7a8', '#f2cfc7']),
        roof: 'cone', door: rng.int(0, 3), chests: 1, loot: 1 });
    }
    this.prop('Campfire', poi.x - 4, poi.z + 12, 0, 1);
    for (let k = 0; k < 14; k++) {
      const a = rng.float(0, 6.28), r = rng.float(18, 48);
      const x = poi.x + Math.cos(a) * r, z = poi.z + Math.sin(a) * r;
      if (this.terrain.heightAt(x, z) > 0.8 && this.isFree(x, z, 2)) this.prop('Tree_Palm_A', x, z, rng.float(0, 6.28), rng.float(0.85, 1.2), { sink: 0.2 });
    }
  }

  // Lone houses and cabins between the towns.
  scatterHouses() {
    const rng = this.rng;
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 14; tries++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(60, 360);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.terrain.sample(x, z);
      if (h < 3 || h > 45) continue;
      if (POIS.some((p) => Math.hypot(p.x - x, p.z - z) < (p.flat || p.lake || 20) + 45)) continue;
      if (!this.isFree(x, z, 30)) continue;
      // not on a steep hillside
      const hs = [this.terrain.sample(x - 8, z - 8), this.terrain.sample(x + 8, z - 8), this.terrain.sample(x - 8, z + 8), this.terrain.sample(x + 8, z + 8)];
      if (Math.max(...hs) - Math.min(...hs) > 5) continue;
      const w = rng.int(1, 3), d = rng.int(2, 3);
      const ox = cellOf(x), oz = cellOf(z);
      const lvl = this.terrain.flattenRect(ox * S, oz * S, (ox + w) * S, (oz + d) * S, 10);
      this.house({ ox, oz, L: lvl, w, d, floors: rng.chance(0.4) ? 2 : 1, roof: rng.chance(0.6) ? 'gable' : 'cone', door: rng.int(0, 3),
        chests: 1, loot: 2 });
      if (rng.chance(0.5)) this.prop('Car_Wreck', x + (w + 1.5) * S, z + rng.float(0, d * S), rng.float(0, 6.28), 1);
      placed++;
    }
  }

  lampRow(x0, z0, x1, z1, y, step) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let d = 0; d <= len; d += step) {
      const t = d / len;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (this.isFree(x, z, 1)) this.prop('LampPost', x, z, 0, 1, { y });
    }
  }

  // Wrecks and crates along the dirt roads.
  roadside() {
    const rng = this.rng;
    for (const [x0, z0, x1, z1] of this.terrain.roadSegs) {
      if (!rng.chance(0.18)) continue;
      const t = rng.float(0.2, 0.8);
      const x = x0 + (x1 - x0) * t + rng.float(-6, 6), z = z0 + (z1 - z0) * t + rng.float(-6, 6);
      if (!this.isFree(x, z, 3) || this.terrain.heightAt(x, z) < 1) continue;
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      this.prop(rng.pick(['Car_Wreck', 'Car_Sedan', 'Car_Pickup']), x, z, yaw + rng.float(-0.3, 0.3), 1, { tint: rng.pick(CAR_COLORS) });
      this.floorLoot.push({ x: x + 3, y: this.terrain.heightAt(x + 3, z), z });
    }
  }

  // ------------------------------------------------------------------ forests, rocks, bushes
  nature() {
    const rng = this.rng;
    const T = this.terrain;
    const nz = this.noise;
    const step = 8;
    const half = WORLD.size / 2 - 10;
    const nearPOI = (x, z, pad) => POIS.some((p) => p.kind !== 'cabins' && Math.hypot(p.x - x, p.z - z) < (p.flat || 0) + (p.lake || 0) + pad);
    const roadNear = (x, z) => {
      const R = 512, cell = WORLD.size / R;
      const i = Math.floor((x + WORLD.size / 2) / cell), j = Math.floor((z + WORLD.size / 2) / cell);
      if (i < 0 || j < 0 || i >= R || j >= R) return false;
      return T.roadMask[j * R + i] > 0.05 || T.flatMask[j * R + i] > 0.5;
    };
    const slopeAt = (x, z) => 1 - T.normalAt(x, z).y;
    for (let x = -half; x < half; x += step) {
      for (let z = -half; z < half; z += step) {
        const px = x + rng.float(0, step), pz = z + rng.float(0, step);
        const h = T.heightAt(px, pz);
        if (h < 1.6) continue;
        const forest = nz.fbm(px * 0.006, pz * 0.006, 4) * 0.5 + 0.5;
        const detail = nz.noise(px * 0.05, pz * 0.05) * 0.15;
        const slope = slopeAt(px, pz);
        if (roadNear(px, pz) || !this.isFree(px, pz, 3)) continue;
        const cabins = POIS[6];
        const nearCabins = Math.hypot(px - cabins.x, pz - cabins.z) < 90;
        if (nearPOI(px, pz, 8)) continue;
        const dens = forest + detail + (nearCabins ? 0.25 : 0);
        if (dens > 0.62 && slope < 0.45) {
          // trees
          let name;
          const r = rng.next();
          if (h > 34) name = r < 0.7 ? 'Tree_Pine_A' : 'Tree_Pine_B';
          else if (pz < -150 && px < 100) name = r < 0.45 ? 'Tree_Pine_A' : r < 0.75 ? 'Tree_Pine_B' : 'Tree_Birch_A';
          else if (h < 4.5 && pz > 120) name = 'Tree_Palm_A';
          else name = r < 0.4 ? 'Tree_Oak_A' : r < 0.65 ? 'Tree_Oak_B' : r < 0.85 ? 'Tree_Birch_A' : 'Tree_Pine_B';
          if (Math.hypot(px + 334, pz + 18) < 110 && rng.chance(0.5)) name = 'Tree_Dead_A';
          this.prop(name, px, pz, rng.float(0, Math.PI * 2), rng.float(0.8, 1.25), { sink: 0.25 });
          if (rng.chance(0.25)) {
            const bx = px + rng.float(-3, 3), bz = pz + rng.float(-3, 3);
            if (!roadNear(bx, bz)) this.prop(rng.chance(0.5) ? 'Bush_A' : 'Bush_B', bx, bz, rng.float(0, 6.28), rng.float(0.8, 1.3), { sink: 0.1 });
          }
          if (rng.chance(0.04)) this.prop(rng.chance(0.5) ? 'Stump_A' : 'Log_A', px + 3, pz + 2, rng.float(0, 6.28), 1, { sink: 0.1 });
        } else if (dens > 0.52 && rng.chance(0.18) && slope < 0.5) {
          this.prop(rng.chance(0.5) ? 'Bush_A' : 'Bush_B', px, pz, rng.float(0, 6.28), rng.float(0.8, 1.3), { sink: 0.1 });
        } else if (rng.chance(0.012 + slope * 0.08)) {
          const big = slope > 0.3 && rng.chance(0.3);
          this.prop(big ? 'Rock_Big' : rng.pick(['Rock_A', 'Rock_B', 'Rock_C']), px, pz, rng.float(0, 6.28), rng.float(0.7, 1.3), { sink: 0.4 });
        }
      }
    }
    // outdoor loot near places
    for (const p of POIS) {
      for (let k = 0; k < 4; k++) {
        const a = rng.float(0, 6.28), r = (p.flat || 20) + rng.float(-10, 20);
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const h = T.heightAt(x, z);
        if (h > 0.8 && this.isFree(x, z, 1)) this.floorLoot.push({ x, y: h, z });
      }
    }
  }
}

export { SIDING, ROOFS, CAR_COLORS, METAL_COLORS, clamp, smoothstep };
