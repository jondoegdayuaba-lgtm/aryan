// Everything you might want to tweak lives here.

export const GAME_TITLE = ['LAST', 'SIGNAL'];              // second word gets the accent colour
export const TAGLINE = 'One radio. One flare. One night to get home.';

// The valley: a square of wilderness ringed by mountains, centred on 0,0.
// x runs east, z runs south (so north is -z), y is up. All distances are metres.
export const WORLD = {
  size: 2048,
  cell: 2,                  // metres between height samples
  seed: 7311,
  lakeY: 78,                // lake surface height
};

// Where the story places things. The generator nudges each one to level ground
// nearby, so these are targets rather than exact spots.
export const SITE_DEFS = {
  wreck:  { x: -330, z: 300,  flat: 14, clear: 34 },
  tower:  { x: -170, z: 96,   flat: 9,  clear: 26 },
  camp:   { x: -86,  z: -44,  flat: 16, clear: 30 },
  bridge: { x: -104, z: -318, flat: 0,  clear: 12 },
  mine:   { x: -330, z: -420, flat: 26, clear: 42 },
  cabin:  { x: 372,  z: -420, flat: 44, clear: 76, lift: 3 },
  lz:     { x: 322,  z: -352, flat: 34, clear: 52 },
  peak:   { x: 0,    z: 0,    flat: 0,  clear: 0 },   // placed by the generator
};

// Game clock: how the day passes and when the story begins.
export const TIME = {
  startHour: 17.5,          // hours, 24h clock
  secondsPerMinute: 4.2,     // real seconds per in-game minute
  sunrise: 6.6,
  sunset: 18.7,
};

// Player movement, in metres and seconds.
export const PLAYER = {
  eye: 1.62,
  eyeCrouch: 1.02,
  radius: 0.34,
  walk: 2.7,
  sprint: 5.6,
  crouch: 1.35,
  swim: 1.6,
  jump: 4.3,
  gravity: 9.81,
  accel: 14,
  airControl: 0.35,
  maxSlope: 0.62,           // steepest walkable slope, as a surface normal's y (about 52 degrees)
  fallSafe: 8.5,            // landing speed (m/s) that hurts nothing
  fallDeadly: 24,
  stepUp: 0.55,
  sensitivity: 0.0022,
  fov: 68,
};

// Survival rates, per in-game minute unless noted.
export const SURVIVAL = {
  hungerPerMin: 0.16,
  thirstPerMin: 0.30,
  staminaRegen: 22,          // per second when resting
  sprintDrain: 11,           // per second
  jumpCost: 9,
  swimDrain: 4.5,
  healRate: 0.35,            // health per second when fed and warm
  starveDamage: 0.35,        // health per second when a need hits zero
  bodyTempMax: 100,
  flashlightMinutes: 100,     // battery life in in-game minutes
};

// Graphics tiers: the game starts on one of these and steps down if the frame rate drops.
export const QUALITY = {
  low:    { scale: 0.7,  shadows: 0,    shadowMap: 1024, reflections: 0,   bloom: false, grass: 0.35, trees: 0.6, view: 1500, msaa: 0, godRays: false },
  medium: { scale: 0.72, shadows: 2,    shadowMap: 1024, reflections: 0,   bloom: false, grass: 0.45, trees: 0.6,  view: 1400, msaa: 0, godRays: false },
  high:   { scale: 0.9,  shadows: 2,    shadowMap: 2048, reflections: 256, bloom: true,  grass: 0.85, trees: 0.9,  view: 2600, msaa: 2, godRays: true },
};
