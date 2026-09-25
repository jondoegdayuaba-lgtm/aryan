// The cars you can drive. Units: metres, kilograms, newtons, seconds.
// Car-local axes: +z forward, +y up, +x to the driver's LEFT.

const hatch = {
  id: 'hatch',
  name: 'Kestrel R5',
  blurb: 'Four-wheel drive turbo hatchback. Grippy, quick and forgiving.',
  mass: 1230,
  inertia: [1350, 1560, 430],        // pitch (x), yaw (y), roll (z)
  wheelbase: 2.56,
  frontAxle: 1.2,                   // z of the front axle relative to the centre of mass
  track: 1.58,
  cgHeight: 0.5,                    // centre of mass above the ground at rest
  wheelRadius: 0.335,
  wheelWidth: 0.21,
  wheelInertia: 1.2,
  suspension: {
    rest: 0.36,                     // hardpoint to wheel centre, fully extended
    travel: 0.24,
    stiffness: [36000, 32000],      // front, rear (N/m)
    bump: [2900, 2600],             // damping N·s/m
    rebound: [4300, 3900],
    antiRoll: [14000, 9000],
  },
  engine: {
    idle: 950, redline: 7500, limiter: 7700,
    torque: 440,                    // Nm at peak
    curve: [[800, 0.42], [2000, 0.7], [3000, 0.94], [3800, 1], [5600, 1], [6600, 0.9], [7700, 0.74]],
    inertia: 0.18,
    turbo: true,
    brake: 0.13,                    // engine braking as a fraction of peak torque
  },
  gears: [3.1, 2.25, 1.75, 1.42, 1.18],
  reverse: 3.2,
  finalDrive: 4.2,
  drive: 'awd', frontBias: 0.48,
  diff: { front: 60, rear: 90, centre: 70 },   // limited-slip locking (Nm per rad/s)
  brakes: { front: 2700, rear: 1700, handbrake: 3600 },
  steer: { lock: 0.56, rate: 3.2 },
  tire: { mu: 1.08, slipRatio: 0.12, slipAngle: 0.13, shape: 1.45, loadSens: 0.09 },
  aero: { drag: 0.47, lift: 0.18 },
  body: { half: [0.9, 0.6, 2.02], centre: [0, 0.2, 0.03] },
  shift: { up: 7050, down: 3600, time: 0.09 },
};

const coupe = {
  id: 'coupe',
  name: 'Vantor RS',
  blurb: 'Classic rear-drive coupe. Light, loud and happiest going sideways.',
  mass: 1040,
  inertia: [1150, 1330, 360],
  wheelbase: 2.42,
  frontAxle: 1.08,
  track: 1.46,
  cgHeight: 0.49,
  wheelRadius: 0.32,
  wheelWidth: 0.19,
  wheelInertia: 1.0,
  suspension: {
    rest: 0.34, travel: 0.22,
    stiffness: [30000, 28000], bump: [2500, 2300], rebound: [3700, 3400], antiRoll: [16000, 6000],
  },
  engine: {
    idle: 1000, redline: 8200, limiter: 8400,
    torque: 285,
    curve: [[900, 0.5], [2500, 0.72], [4500, 0.9], [6500, 1], [7600, 0.97], [8400, 0.86]],
    inertia: 0.14, turbo: false, brake: 0.12,
  },
  gears: [3.35, 2.3, 1.72, 1.36, 1.1],
  reverse: 3.4,
  finalDrive: 4.1,
  drive: 'rwd', frontBias: 0,
  diff: { front: 0, rear: 220, centre: 0 },
  brakes: { front: 2300, rear: 1300, handbrake: 3200 },
  steer: { lock: 0.6, rate: 3.6 },
  tire: { mu: 1.04, slipRatio: 0.11, slipAngle: 0.12, shape: 1.42, loadSens: 0.09 },
  aero: { drag: 0.42, lift: 0.08 },
  body: { half: [0.84, 0.58, 1.95], centre: [0, 0.18, 0.02] },
  shift: { up: 7900, down: 4200, time: 0.1 },
};

const truck = {
  id: 'truck',
  name: 'Brute TT',
  blurb: 'Desert trophy truck. A V8, huge tyres and suspension that swallows jumps.',
  mass: 2400,
  inertia: [4300, 5200, 1500],
  wheelbase: 3.2,
  frontAxle: 1.55,
  track: 1.95,
  cgHeight: 0.85,
  wheelRadius: 0.47,
  wheelWidth: 0.32,
  wheelInertia: 4.5,
  suspension: {
    rest: 0.62, travel: 0.52,
    stiffness: [42000, 40000], bump: [5200, 5000], rebound: [7600, 7200], antiRoll: [14000, 9000],
  },
  engine: {
    idle: 800, redline: 6300, limiter: 6500,
    torque: 940,
    curve: [[700, 0.6], [2000, 0.86], [3500, 1], [4800, 0.98], [6000, 0.86], [6500, 0.78]],
    inertia: 0.35, turbo: false, brake: 0.16,
  },
  gears: [3.0, 1.95, 1.42, 1.1, 0.9],
  reverse: 3.0,
  finalDrive: 5.6,
  drive: 'rwd', frontBias: 0,
  diff: { front: 0, rear: 300, centre: 0 },
  brakes: { front: 5600, rear: 3800, handbrake: 6000 },
  steer: { lock: 0.52, rate: 2.8 },
  tire: { mu: 1.0, slipRatio: 0.14, slipAngle: 0.15, shape: 1.4, loadSens: 0.08 },
  aero: { drag: 0.85, lift: 0.1 },
  body: { half: [1.08, 0.72, 2.5], centre: [0, 0.35, 0.05] },
  shift: { up: 5900, down: 3100, time: 0.12 },
};

export const CARS = [hatch, coupe, truck];

// Paint schemes: base, stripe, accent (roof/wing), number colour.
export const LIVERIES = [
  { name: 'Arctic', base: '#f2f3f5', stripe: '#1f5fbf', accent: '#d32f2f', number: '#101318' },
  { name: 'Ember', base: '#c62828', stripe: '#f5f5f5', accent: '#1b1b1f', number: '#f5f5f5' },
  { name: 'Forest', base: '#1f4d36', stripe: '#e8c547', accent: '#e8c547', number: '#f5f0dd' },
  { name: 'Midnight', base: '#15171e', stripe: '#ff7a1a', accent: '#ff7a1a', number: '#ffffff' },
  { name: 'Sky', base: '#3d8fd6', stripe: '#ffffff', accent: '#ffd23f', number: '#0f2a44' },
  { name: 'Lime', base: '#9bd33a', stripe: '#15171e', accent: '#15171e', number: '#15171e' },
];
