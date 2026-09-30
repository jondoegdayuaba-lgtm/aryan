// Duel Grounds: a small arena island for 1v1 (or a tight free-for-all with friends).
// Two brick forts face each other across a flattened arena with cover in the middle; a ring of trees,
// rocks and wrecks around it gives materials to harvest.
import { GRID } from './config.js';
import { World, CAR_COLORS } from './world.js';

const S = GRID.cell;
const H = GRID.level;

export class DuelWorld extends World {
  build() {
    const T = this.terrain;
    const rng = this.rng;
    const L = Math.round((T.poiHeights.get('Arena') ?? T.sample(0, 0)) / H);
    const y = L * H;
    this.spawns = [];
    T.markFlat(-30, -30, 30, 30, 0.55);
    // west and east forts, doors facing the middle
    this.house({ ox: -8, oz: -1, L, w: 2, d: 2, floors: 2, style: 'brick', roof: 'flat', door: 1, chests: 1, loot: 1,
      windows: 0.9, color: '#f2d6c8', roofColor: '#5a6470' });
    this.house({ ox: 6, oz: -1, L, w: 2, d: 2, floors: 2, style: 'brick', roof: 'flat', door: 3, chests: 1, loot: 1,
      windows: 0.9, color: '#d6dde6', roofColor: '#7a2f2f' });
    // centre: shipping containers and rocks to fight around
    this.prop('Container_A', -3, -9, Math.PI / 2, 1, { y, tint: '#c0392b' });
    this.prop('Container_A', 4, 9, Math.PI / 2, 1, { y, tint: '#2e86de' });
    this.prop('Rock_Big', 0, 0, rng.float(0, 6.28), 1.1, { sink: 0.5 });
    for (const [x, z] of [[-14, 14], [14, -14], [-16, -18], [16, 18]]) {
      this.prop(rng.pick(['Rock_A', 'Rock_B', 'Rock_C']), x, z, rng.float(0, 6.28), rng.float(1.1, 1.5), { sink: 0.3 });
    }
    for (const [x, z] of [[-9, 20], [10, -21]]) this.prop('HayBale', x, z, rng.float(0, 6.28), 1, { y });
    this.prop('Car_Wreck', -20, -24, 0.4, 1, { y });
    this.prop('Car_Sedan', 21, 24, 3.5, 1, { y, tint: rng.pick(CAR_COLORS) });
    this.prop('Tractor', 24, -26, 2.2, 1, { y });
    for (const [x, z] of [[-24, 26], [26, 0.5], [-26, 0.5]]) this.prop('LampPost', x, z, 0, 1, { y });
    for (const x of [-12, 12]) this.prop('Fence_Wood', x, -27, 0, 1, { y });
    this.ammoBoxes.push({ x: -1.5, y, z: 13, yaw: 0.3 }, { x: 1.5, y, z: -13, yaw: 2.9 });
    for (const [x, z] of [[-18, -8], [18, 8], [-6, 26], [6, -26], [0, 16], [0, -16]]) this.floorLoot.push({ x, y, z });
    this.block(-30, -30, 30, 30, 0);
    // spawn points: the two forts' doorsteps first, then a ring for bigger matches
    this.spawns.push({ x: -22, z: 0, yaw: Math.PI / 2 }, { x: 22, z: 0, yaw: -Math.PI / 2 });
    for (let k = 0; k < 14; k++) {
      const a = (k + 0.5) / 14 * Math.PI * 2;
      this.spawns.push({ x: Math.cos(a) * 25, z: Math.sin(a) * 25, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) });
    }
    for (const sp of this.spawns) sp.y = y;
    this.natureRing();
    return this;
  }

  // Trees, bushes and rocks on the ridge and slopes around the arena.
  natureRing() {
    const T = this.terrain;
    const rng = this.rng;
    for (let x = -110; x < 110; x += 5) {
      for (let z = -110; z < 110; z += 5) {
        const px = x + rng.float(0, 5), pz = z + rng.float(0, 5);
        const r = Math.hypot(px, pz);
        const h = T.heightAt(px, pz);
        if (r < 36 || h < 1.6 || !this.isFree(px, pz, 2)) continue;
        const slope = 1 - T.normalAt(px, pz).y;
        const dens = this.noise.fbm(px * 0.03, pz * 0.03, 3) * 0.5 + 0.5;
        if (dens > 0.5 && slope < 0.5 && rng.chance(0.55)) {
          const name = rng.pick(['Tree_Oak_A', 'Tree_Oak_B', 'Tree_Birch_A', 'Tree_Pine_A', 'Tree_Pine_B']);
          this.prop(name, px, pz, rng.float(0, 6.28), rng.float(0.8, 1.2), { sink: 0.25 });
        } else if (rng.chance(0.12)) {
          this.prop(rng.chance(0.5) ? 'Bush_A' : 'Bush_B', px, pz, rng.float(0, 6.28), rng.float(0.9, 1.3), { sink: 0.1 });
        } else if (rng.chance(0.05 + slope * 0.1)) {
          this.prop(rng.pick(['Rock_A', 'Rock_B', 'Rock_C', 'Rock_Big']), px, pz, rng.float(0, 6.28), rng.float(0.7, 1.2), { sink: 0.4 });
        }
        if (h < 3 && h > 1.6 && rng.chance(0.05)) this.prop('Tree_Palm_A', px, pz, rng.float(0, 6.28), 1, { sink: 0.2 });
      }
    }
  }
}
