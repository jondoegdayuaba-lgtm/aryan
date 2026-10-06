// Everything you might want to tweak lives here.

export const GAME_TITLE = ['APEX', 'RUSH'];            // second word gets the accent colour
export const TAGLINE = 'Low-poly time trials. Clear every checkpoint, then beat your own ghost.';

// Handling. Distances are metres, speeds metres per second (x 3.6 for km/h).
export const CAR = {
  topSpeed: 78,           // on tarmac, ~280 km/h
  grassTopSpeed: 26,      // off the road the car bogs down
  accel: 36,              // from a standstill; tails off toward top speed
  accelCurve: 0.7,        // lower = keeps pulling harder near top speed
  brake: 58,
  reverseSpeed: 14,
  reverseAccel: 18,
  steerRate: 2.4,         // turn rate (radians / second) at low speed
  steerRateTop: 1.3,      // ...and at top speed
  steerSpeed: 4.5,        // how fast the wheel turns to full lock (per second)
  steerReturn: 8,         // how fast it centres again
  grip: 10,               // how quickly sideways sliding is cancelled
  grassGrip: 0.55,        // multiplier on grass
  slideAt: 9,             // above this sideways speed the tyres let go a little...
  slideGrip: 0.75,        // ...by this factor, which keeps slides going
  driftGrip: 1.7,         // grip with the handbrake on
  driftSteer: 1.4,        // extra turn rate with the handbrake on
  airSteer: 0.6,          // turn rate in the air
  gravity: 30,            // a bit heavier than real life so jumps feel snappy
  halfWidth: 1.05,        // for wall collisions
  boostKick: 16,          // a boost pad adds this much over top speed...
  boostMax: 1.35,         // ...up to this times top speed
};

export const CAMERA = {
  modes: [
    { name: 'Chase', distance: 8.6, height: 3.1, look: 1.3 },
    { name: 'Far', distance: 13, height: 5.2, look: 1.6 },
    { name: 'Hood', hood: true },
  ],
  fov: 68,                // degrees at a standstill
  fovSpeed: 14,           // added at top speed
};

// Car colours: body, stripe.
export const PAINTS = [
  { name: 'Race red', body: '#e3262e', stripe: '#f4f4f4' },
  { name: 'Bubblegum', body: '#ec5fa8', stripe: '#ffffff' },
  { name: 'Signal blue', body: '#2f6ff0', stripe: '#ffd21f' },
  { name: 'Lime', body: '#7bd13a', stripe: '#1d2230' },
  { name: 'Tangerine', body: '#ff8a1f', stripe: '#1d2230' },
  { name: 'Graphite', body: '#2c3140', stripe: '#41d6ff' },
];

export const GHOST_RATE = 30;           // ghost samples per second
export const PHYSICS_HZ = 120;
