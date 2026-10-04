// Everything you might want to tweak lives here.

export const GAME_TITLE = ['SUNKEN', 'GOLD'];            // second word gets the accent colour
export const TAGLINE = 'Dive the reef. Loot the wreck. Mind your air.';

// Diver and scooter. Speeds are metres per second.
export const DIVE = {
  swimSpeed: 2.6,          // scooter cruising speed at upgrade level 0
  boostSpeed: 5.0,         // with Shift held, burns battery
  verticalSpeed: 1.8,      // Space / C to rise and sink
  accel: 2.4,              // how quickly you reach the target speed (water drag)
  radius: 0.45,            // collision radius of the diver
  mouseSensitivity: 0.0022,
  touchSensitivity: 0.005,
  keyTurnSpeed: 1.8,
  battery: 8,              // seconds of boost at level 0
  batteryRecharge: 0.35,   // seconds of boost regained per second when not boosting
  surfaceY: 0.16,          // eye height when floating at the surface (just above the water)
  boatRadius: 9,           // surface within this distance of the boat to climb aboard
  mapRadius: 285,          // beyond this you are turned back
};

// Air is measured in surface-seconds. At depth you breathe faster:
// each breath takes (1 + depth / pressureDepth) times more air.
export const AIR = {
  tank: 210,               // tank size at level 0
  pressureDepth: 26,
  boostCost: 1.25,         // breathing harder while boosting
  ventRefill: 14,          // surface-seconds per second while inside a bubble vent
  spareTank: 45,           // spare air tank pickup
  warn: 0.3,               // fraction left when the warning starts
  critical: 0.15,
};

export const VALUES = {
  coin: 5,
  pearl: 60,
  chest: 400,
  amphora: 70,
  goblet: 120,
  ingot: 160,
  gem: 140,
  relic: 1500,
};

export const SHARK = {
  noticeRange: 26,
  chargeSpeed: 8.5,
  cruiseSpeed: 2.2,
  biteAir: 30,             // surface-seconds of air lost from a bite (punctured hose)
  biteLoot: 0.25,          // share of carried loot dropped
  fleeTime: 10,
};

// Arcade extras: coin trails, combos, current rings and golden fish.
export const FUN = {
  trailCoinScale: 3.2,     // trail coins are big, upright, spinning doubloons
  trailCoinValue: 5,
  comboWindow: 1.8,        // seconds between coins to keep a combo going
  comboStep: 8,            // coins per extra multiplier step
  comboMax: 5,
  ringRadius: 1.6,
  ringSpeed: 10,           // a current ring flings you along at this speed (m/s)
  ringTime: 1.5,
  goldenScale: 2.4,
  goldenFear: 10,          // golden fish bolt when you get this close
  goldenSpeed: 3.9,        // faster than cruising, slower than boosting
  goldenCatch: 1.4,
  goldenValue: 150,
};

// Strobe: a camera flash that scares sharks away.
export const STROBE = { range: 20, cooldown: 14 };

// Upgrades bought on the boat. Each level's cost and the value it sets.
export const UPGRADES = [
  { id: 'tank', name: 'Bigger tank', unit: 's of air', levels: [210, 280, 360, 460, 600], cost: [250, 600, 1200, 2400] },
  { id: 'scooter', name: 'Scooter motor', unit: 'm/s', levels: [2.6, 3.1, 3.6, 4.1, 4.7], cost: [200, 500, 1000, 2000] },
  { id: 'battery', name: 'Boost battery', unit: 's of boost', levels: [8, 12, 17, 23, 30], cost: [150, 400, 900, 1800] },
  { id: 'lamp', name: 'Dive lamp', unit: 'm beam', levels: [16, 24, 32, 42, 55], cost: [150, 400, 900, 1800] },
  { id: 'strobe', name: 'Shark strobe', unit: 's recharge', levels: [14, 11, 8.5, 6.5, 5], cost: [200, 450, 900, 1600] },
  { id: 'magnet', name: 'Coin magnet', unit: 'm pull', levels: [1.6, 2.6, 3.8, 5.2, 7], cost: [120, 350, 800, 1500] },
];

// Water look. Colours are linear-ish targets for the in-scatter (fog) colour.
export const WATER = {
  shallow: '#5fc4d4',      // looking up near the surface
  mid: '#1e7f99',
  deep: '#06293f',
  fogDensity: 0.028,       // visibility: about 60 m before things vanish
  absorb: [0.07, 0.022, 0.014],   // per metre along the view, per channel: red goes first
  sunAbsorb: [0.032, 0.011, 0.006], // per metre of depth for sunlight reaching a surface
};
