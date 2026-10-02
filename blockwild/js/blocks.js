// Block and item definitions, plus the texture atlas, crack overlays and
// inventory icons. Every texture is painted pixel by pixel on a canvas.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7,
  BLOSSOM: 8, PLANKS: 9, COBBLE: 10, SNOW: 11, TALLGRASS: 12, FLOWER_RED: 13,
  FLOWER_YELLOW: 14, BEDROCK: 15, GLASS: 16, CHERRY_LOG: 17, GRAVEL: 18, BRICK: 19,
};
export const ITEM = { APPLE: 100 };

// Tile indices in the atlas.
const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG_SIDE: 6, LOG_TOP: 7,
  LEAVES: 8, BLOSSOM: 9, PLANKS: 10, COBBLE: 11, SNOW: 12, SNOW_SIDE: 13, TALLGRASS: 14,
  FLOWER_RED: 15, FLOWER_YELLOW: 16, BEDROCK: 17, GLASS: 18, CHERRY_SIDE: 19, CHERRY_TOP: 20,
  GRAVEL: 21, BRICK: 22, APPLE: 23,
};
const COLS = 8, ROWS = 4, TS = 16;

export const BLOCKS = [];
function def(id, o) {
  BLOCKS[id] = {
    id, name: '', tex: [0, 0, 0], solid: true, opaque: true, cross: false, liquid: false,
    occludes: true, hardness: 1, drop: id, sound: 'stone', ...o,
  };
}
def(B.AIR, { name: 'Air', solid: false, opaque: false, occludes: false, hardness: 0, drop: 0 });
def(B.GRASS, { name: 'Grass Block', tex: [T.GRASS_TOP, T.GRASS_SIDE, T.DIRT], hardness: 0.7, drop: B.DIRT, sound: 'grass' });
def(B.DIRT, { name: 'Dirt', tex: [T.DIRT, T.DIRT, T.DIRT], hardness: 0.65, sound: 'dirt' });
def(B.STONE, { name: 'Stone', tex: [T.STONE, T.STONE, T.STONE], hardness: 2.2, drop: B.COBBLE });
def(B.SAND, { name: 'Sand', tex: [T.SAND, T.SAND, T.SAND], hardness: 0.6, sound: 'sand' });
def(B.WATER, { name: 'Water', tex: [T.WATER, T.WATER, T.WATER], solid: false, opaque: false, occludes: false, liquid: true, hardness: Infinity, drop: 0 });
def(B.LOG, { name: 'Oak Log', tex: [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], hardness: 2, sound: 'wood' });
def(B.LEAVES, { name: 'Leaves', tex: [T.LEAVES, T.LEAVES, T.LEAVES], opaque: false, hardness: 0.3, drop: 0, sound: 'grass' });
def(B.BLOSSOM, { name: 'Blossom Leaves', tex: [T.BLOSSOM, T.BLOSSOM, T.BLOSSOM], opaque: false, hardness: 0.3, drop: 0, sound: 'grass' });
def(B.PLANKS, { name: 'Planks', tex: [T.PLANKS, T.PLANKS, T.PLANKS], hardness: 1.8, sound: 'wood' });
def(B.COBBLE, { name: 'Cobblestone', tex: [T.COBBLE, T.COBBLE, T.COBBLE], hardness: 2.4 });
def(B.SNOW, { name: 'Snowy Stone', tex: [T.SNOW, T.SNOW_SIDE, T.STONE], hardness: 1.2, drop: B.COBBLE, sound: 'snow' });
def(B.TALLGRASS, { name: 'Tall Grass', tex: [T.TALLGRASS, T.TALLGRASS, T.TALLGRASS], solid: false, opaque: false, occludes: false, cross: true, hardness: 0, drop: 0, sound: 'grass' });
def(B.FLOWER_RED, { name: 'Red Flower', tex: [T.FLOWER_RED, T.FLOWER_RED, T.FLOWER_RED], solid: false, opaque: false, occludes: false, cross: true, hardness: 0, sound: 'grass' });
def(B.FLOWER_YELLOW, { name: 'Yellow Flower', tex: [T.FLOWER_YELLOW, T.FLOWER_YELLOW, T.FLOWER_YELLOW], solid: false, opaque: false, occludes: false, cross: true, hardness: 0, sound: 'grass' });
def(B.BEDROCK, { name: 'Bedrock', tex: [T.BEDROCK, T.BEDROCK, T.BEDROCK], hardness: Infinity });
def(B.GLASS, { name: 'Glass', tex: [T.GLASS, T.GLASS, T.GLASS], opaque: false, occludes: false, hardness: 0.45, drop: 0, sound: 'glass' });
def(B.CHERRY_LOG, { name: 'Cherry Log', tex: [T.CHERRY_TOP, T.CHERRY_SIDE, T.CHERRY_TOP], hardness: 2, sound: 'wood' });
def(B.GRAVEL, { name: 'Gravel', tex: [T.GRAVEL, T.GRAVEL, T.GRAVEL], hardness: 0.7, sound: 'sand' });
def(B.BRICK, { name: 'Bricks', tex: [T.BRICK, T.BRICK, T.BRICK], hardness: 2.6 });

export const ITEMS = { [ITEM.APPLE]: { name: 'Apple', tile: T.APPLE, food: 4 } };

export const isBlock = (id) => id > 0 && id < 100 && !!BLOCKS[id];
export const itemName = (id) => (isBlock(id) ? BLOCKS[id].name : ITEMS[id]?.name ?? '');
// Blocks that show up in the creative palette.
export const PLACEABLE = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.LOG, B.CHERRY_LOG, B.PLANKS,
  B.LEAVES, B.BLOSSOM, B.GLASS, B.BRICK, B.SNOW, B.BEDROCK, B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW,
];

// ---------------------------------------------------------------- painting

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

function paintTile(ctx, tile, seed, fn) {
  const rand = mulberry32(seed);
  const img = ctx.createImageData(TS, TS);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const c = fn(x, y, rand);
      const i = (y * TS + x) * 4;
      if (!c) continue;
      img.data[i] = clamp255(c[0]);
      img.data[i + 1] = clamp255(c[1]);
      img.data[i + 2] = clamp255(c[2]);
      img.data[i + 3] = c[3] ?? 255;
    }
  }
  ctx.putImageData(img, (tile % COLS) * TS, Math.floor(tile / COLS) * TS);
}

const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const vary = (c, rand, lo, hi) => mul(c, lo + rand() * (hi - lo));

const GRASS = [96, 158, 54];
const DIRT = [134, 96, 67];
const dirtPx = (rand) => {
  const r = rand();
  if (r < 0.1) return vary([98, 68, 46], rand, 0.9, 1.05);
  if (r < 0.16) return vary([166, 124, 92], rand, 0.95, 1.05);
  return vary(DIRT, rand, 0.86, 1.1);
};

// Grid "pebble" pattern used by cobblestone and gravel.
function cells(rand, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rand() * 16, rand() * 16, 0.7 + rand() * 0.5]);
  return (x, y) => {
    let best = 1e9, second = 1e9, bi = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let ox = -16; ox <= 16; ox += 16) {
        for (let oy = -16; oy <= 16; oy += 16) {
          const dx = x + 0.5 - (pts[i][0] + ox), dy = y + 0.5 - (pts[i][1] + oy);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) { second = best; best = d; bi = i; } else if (d < second) second = d;
        }
      }
    }
    return { edge: second - best < 1.1, shade: pts[bi][2] };
  };
}

function drawTiles(ctx) {
  paintTile(ctx, T.GRASS_TOP, 11, (x, y, r) => (r() < 0.08 ? vary(GRASS, r, 0.7, 0.8) : vary(GRASS, r, 0.84, 1.12)));
  paintTile(ctx, T.DIRT, 12, (x, y, r) => dirtPx(r));
  {
    const drip = mulberry32(99);
    const depth = Array.from({ length: 16 }, () => 3 + Math.floor(drip() * 3) - (drip() < 0.3 ? 1 : 0));
    paintTile(ctx, T.GRASS_SIDE, 13, (x, y, r) => (y < depth[x] ? vary(GRASS, r, 0.78, 1.05) : dirtPx(r)));
  }
  paintTile(ctx, T.STONE, 14, (x, y, r) => {
    const v = r();
    if (v < 0.12) return vary([104, 104, 106], r, 0.95, 1.05);
    if (v < 0.18) return vary([150, 150, 152], r, 0.97, 1.03);
    return vary([127, 127, 129], r, 0.92, 1.06);
  });
  paintTile(ctx, T.SAND, 15, (x, y, r) => vary([219, 207, 160], r, 0.92, 1.05));
  paintTile(ctx, T.WATER, 16, (x, y, r) => {
    const w = Math.sin((x + y * 0.6) * 0.8) * 0.5 + 0.5;
    return mul([56, 98, 210], 0.85 + w * 0.2 + r() * 0.06);
  });
  {
    const colShade = Array.from({ length: 16 }, (_, i) => 0.85 + mulberry32(200 + i)() * 0.25);
    paintTile(ctx, T.LOG_SIDE, 17, (x, y, r) => {
      if ((x === 3 || x === 9 || x === 13) && r() < 0.8) return vary([74, 57, 34], r, 0.9, 1.05);
      return vary([108, 84, 52], r, 0.95, 1.05).map((v) => v * colShade[x]);
    });
  }
  paintTile(ctx, T.LOG_TOP, 18, (x, y, r) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return vary([108, 84, 52], r, 0.9, 1.05);
    return vary(Math.floor(d) % 2 ? [176, 141, 88] : [150, 117, 70], r, 0.95, 1.05);
  });
  paintTile(ctx, T.LEAVES, 19, (x, y, r) => {
    if (r() < 0.2) return null;
    return vary([58, 122, 36], r, 0.7, 1.15);
  });
  paintTile(ctx, T.BLOSSOM, 20, (x, y, r) => {
    const v = r();
    if (v < 0.16) return null;
    if (v < 0.35) return vary([250, 200, 222], r, 0.97, 1.02);
    if (v < 0.5) return vary([210, 118, 168], r, 0.95, 1.05);
    return vary([238, 160, 198], r, 0.95, 1.04);
  });
  paintTile(ctx, T.PLANKS, 21, (x, y, r) => {
    const band = Math.floor(y / 4);
    if (y % 4 === 3) return vary([104, 80, 48], r, 0.95, 1.05);
    if (x === (band % 2 ? 4 : 12)) return vary([118, 92, 56], r, 0.95, 1.05);
    return vary([164, 131, 80], r, 0.9, 1.06).map((v) => v * (1 - (band % 2) * 0.05));
  });
  {
    const cell = cells(mulberry32(7), 9);
    paintTile(ctx, T.COBBLE, 22, (x, y, r) => {
      const c = cell(x, y);
      if (c.edge) return vary([72, 72, 74], r, 0.9, 1.1);
      return vary([128, 128, 130], r, 0.92, 1.06).map((v) => v * c.shade);
    });
  }
  paintTile(ctx, T.SNOW, 23, (x, y, r) => vary([244, 249, 255], r, 0.93, 1));
  {
    const drip = mulberry32(98);
    const depth = Array.from({ length: 16 }, () => 3 + Math.floor(drip() * 3));
    paintTile(ctx, T.SNOW_SIDE, 24, (x, y, r) => (y < depth[x] ? vary([244, 249, 255], r, 0.92, 1) : vary([127, 127, 129], r, 0.9, 1.06)));
  }
  {
    // Tall grass: a few blades growing up from the bottom edge.
    const blades = new Set();
    const br = mulberry32(5);
    for (let b = 0; b < 9; b++) {
      let x = 1 + Math.floor(br() * 14);
      const h = 6 + Math.floor(br() * 9);
      const lean = br() < 0.5 ? -1 : 1;
      for (let i = 0; i < h; i++) {
        if (i > 3 && br() < 0.25) x = Math.max(0, Math.min(15, x + lean));
        blades.add(`${x},${15 - i}`);
      }
    }
    paintTile(ctx, T.TALLGRASS, 25, (x, y, r) => (blades.has(`${x},${y}`) ? vary(GRASS, r, 0.7, 1.15) : null));
  }
  const flower = (petal, center) => (x, y, r) => {
    const dx = x - 7.5, dy = y - 5.5;
    const d = dx * dx + dy * dy;
    if (d < 1.2) return center;
    if (d < 7.5 && !(Math.abs(dx) > 2 && Math.abs(dy) > 2)) return vary(petal, r, 0.88, 1.08);
    if ((x === 7 || x === 8) && y > 7) return vary([62, 130, 40], r, 0.9, 1.1);
    if ((y === 11 && (x === 5 || x === 6)) || (y === 12 && (x === 9 || x === 10))) return [70, 145, 46];
    return null;
  };
  paintTile(ctx, T.FLOWER_RED, 26, flower([212, 40, 44], [90, 30, 20]));
  paintTile(ctx, T.FLOWER_YELLOW, 27, flower([244, 214, 44], [214, 120, 30]));
  paintTile(ctx, T.BEDROCK, 28, (x, y, r) => {
    const g = mulberry32(((x >> 1) * 31 + (y >> 1) * 17) | 0)();
    return vary(g < 0.3 ? [40, 40, 40] : g < 0.6 ? [84, 84, 84] : g < 0.85 ? [118, 118, 118] : [24, 24, 24], r, 0.9, 1.1);
  });
  paintTile(ctx, T.GLASS, 29, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [206, 232, 240];
    if ((x + y === 9 || x + y === 10) && x > 2 && x < 7) return [236, 248, 252];
    if (x + y === 20 && x > 9 && x < 13) return [236, 248, 252];
    return null;
  });
  {
    const colShade = Array.from({ length: 16 }, (_, i) => 0.85 + mulberry32(300 + i)() * 0.25);
    paintTile(ctx, T.CHERRY_SIDE, 30, (x, y, r) => {
      if ((x === 2 || x === 7 || x === 12) && r() < 0.75) return vary([52, 30, 36], r, 0.9, 1.05);
      return vary([92, 54, 60], r, 0.95, 1.05).map((v) => v * colShade[x]);
    });
  }
  paintTile(ctx, T.CHERRY_TOP, 31, (x, y, r) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return vary([92, 54, 60], r, 0.9, 1.05);
    return vary(Math.floor(d) % 2 ? [222, 164, 156] : [196, 138, 132], r, 0.95, 1.05);
  });
  {
    const cell = cells(mulberry32(21), 14);
    const tones = [[132, 126, 122], [104, 98, 96], [160, 152, 146], [124, 108, 98]];
    paintTile(ctx, T.GRAVEL, 32, (x, y, r) => {
      const c = cell(x, y);
      if (c.edge) return vary([88, 84, 82], r, 0.9, 1.1);
      return vary(tones[Math.floor(c.shade * 7) % 4], r, 0.93, 1.06);
    });
  }
  paintTile(ctx, T.BRICK, 33, (x, y, r) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3 || x % 8 === (row % 2 ? 4 : 0)) return vary([186, 180, 170], r, 0.95, 1.03);
    return vary([152, 72, 56], r, 0.88, 1.08);
  });
  paintTile(ctx, T.APPLE, 34, (x, y, r) => {
    const dx = x - 7.5, dy = y - 9;
    const d = dx * dx * 1.1 + dy * dy;
    if (d < 30) {
      if (dx < -1 && dx > -4 && dy < -1 && dy > -4) return [250, 150, 150];
      return vary([200, 30, 40], r, 0.85 + (dx + dy < 0 ? 0.15 : 0), 1.0);
    }
    if (x === 8 && (y === 2 || y === 3)) return [92, 60, 30];
    if ((y === 2 && (x === 9 || x === 10)) || (y === 1 && x === 10)) return [70, 150, 50];
    return null;
  });
}

// ---------------------------------------------------------------- atlas

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TS;
  canvas.height = ROWS * TS;
  const ctx = canvas.getContext('2d');
  drawTiles(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  const eps = 0.0004;
  // [u0, v0, u1, v1] with v1 the top of the tile.
  const uv = (tile) => {
    const c = tile % COLS, r = Math.floor(tile / COLS);
    return [c / COLS + eps, 1 - (r + 1) / ROWS + eps, (c + 1) / COLS - eps, 1 - r / ROWS - eps];
  };

  // Average opaque colour of each tile, for break particles.
  const avg = [];
  for (let t = 0; t < COLS * ROWS; t++) {
    const d = ctx.getImageData((t % COLS) * TS, Math.floor(t / COLS) * TS, TS, TS).data;
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
    avg.push(n ? [rr / n / 255, gg / n / 255, bb / n / 255] : [1, 1, 1]);
  }

  const tileCanvas = (tile) => {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    c.getContext('2d').drawImage(canvas, (tile % COLS) * TS, Math.floor(tile / COLS) * TS, TS, TS, 0, 0, TS, TS);
    return c;
  };

  return { canvas, texture, uv, avg, tileCanvas };
}

// Tile used to draw an item (top face for blocks, sprite for items).
export function itemTile(id) {
  if (isBlock(id)) return BLOCKS[id].tex[BLOCKS[id].cross ? 1 : 1];
  return ITEMS[id]?.tile ?? 0;
}
export const isFlatItem = (id) => !isBlock(id) || BLOCKS[id].cross;

// ---------------------------------------------------------------- icons

export function buildIcons(atlas) {
  const icons = {};
  const make = (id) => {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (isFlatItem(id)) {
      ctx.drawImage(atlas.tileCanvas(itemTile(id)), 4, 4, 40, 40);
    } else {
      const [top, side] = BLOCKS[id].tex;
      const face = (tile, m, dark) => {
        ctx.setTransform(...m);
        ctx.drawImage(atlas.tileCanvas(tile), 0, 0);
        if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, 16, 16); }
      };
      // Isometric cube: top, left and right faces.
      face(top, [21 / 16, -11 / 16, 21 / 16, 11 / 16, 3, 13], 0);
      face(side, [21 / 16, 11 / 16, 0, 22 / 16, 3, 13], 0.2);
      face(side, [21 / 16, -11 / 16, 0, 22 / 16, 24, 24], 0.38);
    }
    return c.toDataURL();
  };
  for (const id of [...PLACEABLE, ...Object.keys(ITEMS).map(Number)]) icons[id] = make(id);
  return icons;
}

// ---------------------------------------------------------------- cracks

export function buildCrackTextures() {
  const rand = mulberry32(4242);
  const order = [];
  const seen = new Set();
  // Random-walk crack lines spreading out from near the centre.
  for (let line = 0; line < 9; line++) {
    let x = 6 + Math.floor(rand() * 4), y = 6 + Math.floor(rand() * 4);
    const dx = Math.round(Math.cos(line * 0.7 + rand()) * 1.4), dy = Math.round(Math.sin(line * 0.7 + rand()) * 1.4);
    for (let s = 0; s < 14; s++) {
      if (x < 0 || y < 0 || x > 15 || y > 15) break;
      const k = `${x},${y}`;
      if (!seen.has(k)) { seen.add(k); order.push([x, y, line + s]); }
      x += rand() < 0.6 ? dx : Math.round(rand() * 2 - 1);
      y += rand() < 0.6 ? dy : Math.round(rand() * 2 - 1);
    }
  }
  order.sort((a, b) => a[2] - b[2]);
  const textures = [];
  for (let stage = 0; stage < 10; stage++) {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const ctx = c.getContext('2d');
    const n = Math.floor(((stage + 1) / 10) * order.length);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(20,20,20,0.75)' : 'rgba(60,60,60,0.6)';
      ctx.fillRect(order[i][0], order[i][1], 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    textures.push(t);
  }
  return textures;
}

// ---------------------------------------------------------------- HUD icons

function pixelArt(rows, palette, scale = 3) {
  const c = document.createElement('canvas');
  c.width = rows[0].length * scale;
  c.height = rows.length * scale;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (palette[ch]) { ctx.fillStyle = palette[ch]; ctx.fillRect(x * scale, y * scale, scale, scale); }
  }));
  return c.toDataURL();
}

const HEART = [
  '.kk...kk.',
  'kaak.kaak',
  'kawaakaak',
  'kaaaaaaak',
  'kaaaaaaak',
  '.kaaaaak.',
  '..kaaak..',
  '...kak...',
  '....k....',
];
const FOOD = [
  '.....kkk.',
  '....kaaak',
  '...kawaak',
  '..kaaaaak',
  '.kaaaaak.',
  '.kaaaak..',
  'kbkkkk...',
  'kbbk.....',
  '.kk......',
];
const half = (rows) => rows.map((r) => [...r].map((ch, x) => (x > 4 && (ch === 'a' || ch === 'w') ? 'e' : ch)).join(''));
const empty = (rows) => rows.map((r) => r.replace(/[aw]/g, 'e'));

export function buildHudIcons() {
  const heart = { k: '#1b0b0b', a: '#e0262b', w: '#ffb4b4', e: '#3a2a2a' };
  const food = { k: '#2a1608', a: '#b36a32', w: '#e7b07a', b: '#ece2d0', e: '#3a2a22' };
  return {
    heartFull: pixelArt(HEART, heart),
    heartHalf: pixelArt(half(HEART), heart),
    heartEmpty: pixelArt(empty(HEART), heart),
    foodFull: pixelArt(FOOD, food),
    foodHalf: pixelArt(FOOD.map((r) => [...r].map((ch, x) => (x < 4 && (ch === 'a' || ch === 'w') ? 'e' : ch)).join('')), food),
    foodEmpty: pixelArt(empty(FOOD), food),
  };
}

export { T as TILES };
