// Everything you might want to tweak lives here.

export const GAME_TITLE = ['MISSILE', 'RUN'];            // second word gets the accent colour
export const TAGLINE = 'Steer a guided missile. Blow up tanks. Don\'t hit the walls.';

// Flight model: the camera orbits the missile and the missile always steers
// toward whatever the crosshair is pointing at.
export const FLIGHT = {
  cruiseSpeed: 45,        // units / second
  boostSpeed: 80,
  steer: 5,               // how eagerly the missile turns toward the crosshair (higher = snappier)
  maxTurnRate: 3.2,       // radians / second cap
  boostMaxTurnRate: 2.4,
  fuelSeconds: 25,        // full tank
  boostDrain: 2.6,        // fuel burns this much faster while boosting
  floatSeconds: 3,        // life jacket: how long you can hover per missile
  cameraDistance: 16,     // how far the camera sits from the missile
  crosshairY: 0.355,      // crosshair height as a fraction of the screen from the top
  mouseSensitivity: 0.0022,
  touchSensitivity: 0.006,
  keyTurnSpeed: 1.9,      // radians / second when turning the camera with the keyboard
  maxPitch: 1.4,          // camera pitch limit, ~80 degrees
};

export const SCORING = {
  missilesPerRound: 5,
  tank: 100,              // multiplied by your streak of consecutive hits
  gate: 25,
  gateFuel: 2,            // seconds of fuel refunded per gate
  thread: 50,             // flying through the inside of a lattice tower
  longShot: 50,           // bonus for hitting a tank after flying this far
  longShotDistance: 600,
};

export const BOUNDS = { minX: -520, maxX: 520, minZ: -1060, maxZ: 150, maxY: 320 };

// Skins unlock when your best score reaches `unlock`.
export const SKINS = [
  { id: 'classic',  name: 'Classic',  unlock: 0,    body: '#d8262e', nose: '#d8262e', fins: '#2b2b33', band: '#f2f2f2' },
  { id: 'camo',     name: 'Desert Camo', unlock: 300, pattern: 'camo', fins: '#3b3527', band: '#2a2620' },
  { id: 'arctic',   name: 'Arctic',   unlock: 900, body: '#f4f6fb', nose: '#2c6fd6', fins: '#2c6fd6', band: '#2c6fd6' },
  { id: 'hornet',   name: 'Hornet',   unlock: 1800, pattern: 'hazard', nose: '#1b1b1f', fins: '#1b1b1f', band: '#1b1b1f' },
  { id: 'midnight', name: 'Midnight', unlock: 3000, body: '#1d1a2b', nose: '#ff8a1f', fins: '#ff8a1f', band: '#ff8a1f', glow: true },
];
