// Tuning knobs and the city layout contract shared with tools/blender/city.py.

export const GAME_TITLE = 'NIGHT RUN';

export const CITY = {
  period: 100,        // one tile: a 80 m block plus half of each surrounding road
  block: 80,
  roadHalf: 10,       // road half-width around x,z = 50 + 100k
  sidewalk: 6,
  lotCenter: 18,      // building lots sit at (+-18, +-18) inside the tile
  viewRadius: 2,      // tiles kept alive around the player (5 x 5)
  laneOffsets: [2.5, 7.5],
};

// footprint half-sizes of the building archetypes in city.glb
export const BUILDINGS = [
  { name: 'bld_glass', half: 16 },
  { name: 'bld_brick', half: 15 },
  { name: 'bld_concrete', half: 16 },
  { name: 'bld_deco', half: 15 },
  { name: 'bld_lowrise', half: 16 },
  { name: 'bld_resi', half: 15 },
];

export const BIKE = {
  radius: 0.55,
  maxSpeed: 27,          // m/s  (97 km/h)
  boostSpeed: 36,
  accel: 17,
  boostAccel: 26,
  brake: 34,
  drag: 0.0085,
  yawRate: 1.9,          // rad/s at full lock
  grip: 9,               // 1/s: how fast sideways slip is killed
  driftGrip: 1.6,
  battery: 100,          // boost tank
  boostDrain: 24,        // per second
  batteryRegen: 5,
  hp: 100,
  crashSpeed: 5,         // impact speed (m/s) above which walls hurt
};

export const COP = {
  radius: 1.05,
  baseSpeed: 22,
  speedPerHeat: 1.8,
  accel: 13,
  spawnMin: 95,
  spawnMax: 145,
  despawn: 320,
  hp: 45,
  bustRange: 7.5,
  bustRate: 0.30,        // per second while touching-close
  bustDecay: 0.35,
};

export const HEAT = {
  max: 5,
  start: 2,
  escalateEvery: 45,     // seconds chased before the next star
  copsPerHeat: [0, 2, 3, 4, 5, 6],
  loseTime: 8,           // seconds with every cruiser 150 m+ away to drop a star
  loseDistance: 150,
  grace: 12,             // no star can drop this early in a run
};

export const TRAFFIC = {
  count: 16,
  spawnMin: 60,
  spawnMax: 220,
  despawn: 280,
  speed: [7, 12],
};

export const SCORE = {
  perMeter: 0.5,
  nearMiss: 60,
  copCrash: 500,
  pickup: 150,
  escapeStar: 1500,
};
