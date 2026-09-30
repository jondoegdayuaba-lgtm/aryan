// Tuning for Outbuild. Everything gameplay-related lives here so it is easy to tweak.

export const GAME = {
  title: 'OUTBUILD',
  subtitle: 'Island Royale',
  seed: 7741,               // island layout seed (the map is the same every match)
  botsDefault: 29,          // opponents (plus you = 30 players)
};

// World grid shared by player builds and houses.
export const GRID = {
  cell: 4,       // metres per build tile
  level: 3,      // metres per floor level (wall height)
  coneHeight: 1.5,
  wallHalfThick: 0.15,
  floorThick: 0.22,
  rampThick: 0.28,
  buildRange: 5.5,  // how far ahead (m) a build can land
};

export const WORLD = {
  size: 1024,          // square map, centred on the origin
  res: 2,              // terrain vertex spacing (m)
  islandRadius: 430,
  waterLevel: 0,
  maxHeight: 70,
};

export const PLAYER = {
  radius: 0.38,
  height: 1.8,
  crouchHeight: 1.25,
  eye: 1.58,
  walk: 6.2,
  sprint: 8.2,
  crouch: 3.2,
  adsWalk: 4.0,
  accel: 60,
  airAccel: 12,
  gravity: 24,
  jump: 8.2,
  stepUp: 0.55,
  maxHealth: 100,
  maxShield: 100,
  fallSafe: 9,          // metres you can fall without damage
  fallDmgPerM: 7,
  swimSpeed: 3.6,
};

export const SKY = {
  busHeight: 190,
  busSpeed: 30,
  diveSpeed: 48,
  fallSpeed: 30,
  airControl: 16,
  gliderAuto: 70,       // metres above ground where the glider opens by itself
  gliderManual: 150,    // may open it by hand below this height
  glideSink: 6.5,
  glideSpeed: 15,
  glideBoost: 20,
};

export const CAMERA = {
  fov: 72,
  adsFov: 52,
  scopeFov: 16,
  dist: 3.3,
  adsDist: 1.7,
  height: 1.62,
  shoulder: 0.62,
  buildDist: 3.8,
  skyDist: 7,
  sensitivity: 0.0022,
};

export const MATS = {
  wood: { hp: 150, buildTime: 3.2, startFrac: 0.1, label: 'Wood', color: '#c58b4f' },
  stone: { hp: 300, buildTime: 7, startFrac: 0.12, label: 'Stone', color: '#9aa7b3' },
  metal: { hp: 500, buildTime: 12, startFrac: 0.14, label: 'Metal', color: '#7f93a8' },
};
export const BUILD_COST = 10;
export const MAX_MATS = 999;
// Hit points of pieces as a fraction of the material hp, by piece kind.
export const PIECE_HP_SCALE = { wall: 1, floor: 1, ramp: 1, cone: 1 };

export const HARVEST = {
  swingTime: 0.72,
  damage: 50,
  weakDamage: 100,
  range: 2.6,
  // materials gained per hit, by source material
  yield: { wood: 10, stone: 9, metal: 7 },
};

export const RARITIES = [
  { key: 'common', label: 'Common', color: '#b6bcc2', glow: '#9aa0a6', mult: 1.0 },
  { key: 'uncommon', label: 'Uncommon', color: '#58c44a', glow: '#3fbf3f', mult: 1.05 },
  { key: 'rare', label: 'Rare', color: '#3d9bff', glow: '#3d8bff', mult: 1.1 },
  { key: 'epic', label: 'Epic', color: '#b35cff', glow: '#b04dff', mult: 1.16 },
  { key: 'legendary', label: 'Legendary', color: '#ffb52e', glow: '#ffae2b', mult: 1.22 },
];

// Storm: each phase waits, then shrinks to a fraction of the island.
export const STORM = {
  startDelay: 50,   // seconds after the airship takes off
  phases: [
    { wait: 70, shrink: 60, radius: 300, dps: 1 },
    { wait: 55, shrink: 50, radius: 175, dps: 2 },
    { wait: 45, shrink: 40, radius: 100, dps: 4 },
    { wait: 40, shrink: 35, radius: 55, dps: 7 },
    { wait: 30, shrink: 30, radius: 28, dps: 9 },
    { wait: 20, shrink: 25, radius: 12, dps: 11 },
    { wait: 15, shrink: 25, radius: 0, dps: 14 },
  ],
  startRadius: 620,
};

// A faster storm for the small duel island.
export const DUEL_STORM = {
  startDelay: 40,
  phases: [
    { wait: 25, shrink: 25, radius: 62, dps: 2 },
    { wait: 20, shrink: 20, radius: 36, dps: 4 },
    { wait: 15, shrink: 20, radius: 16, dps: 7 },
    { wait: 10, shrink: 20, radius: 0, dps: 10 },
  ],
  startRadius: 118,
};

// The maps you can pick in the lobby. `view` is how many metres the map screen covers.
export const MAPS = {
  island: { name: 'Island Royale', short: 'Island', desc: 'Drop from the airship onto the full island. Loot, build and outlast everyone.',
    view: 1024, mode: 'royale' },
  duel: { name: 'Duel Grounds', short: '1v1 Duel', desc: 'A small arena island. Spawn fully loaded, face one opponent, last one standing wins.',
    view: 280, mode: 'duel' },
};

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 1024, ao: false, bloom: false, aa: 'fxaa', grass: 0, drawDist: 420 },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 2048, ao: false, bloom: true, aa: 'fxaa', grass: 0.5, drawDist: 600 },
  high: { pixelRatio: 1, shadows: true, shadowSize: 2048, ao: false, bloom: true, aa: 'smaa', grass: 1, drawDist: 800 },
  epic: { pixelRatio: 1.25, shadows: true, shadowSize: 4096, ao: true, bloom: true, aa: 'smaa', grass: 1.4, drawDist: 1000 },
};

export const DEFAULT_SETTINGS = {
  quality: 'high',
  sensitivity: 1,
  fov: 72,
  volume: 0.8,
  music: 0.5,
  bots: GAME.botsDefault,
  invertY: false,
  showFps: false,
  timeOfDay: 'random',
  outfit: 0,
  difficulty: 'normal',
  map: 'island',
};
