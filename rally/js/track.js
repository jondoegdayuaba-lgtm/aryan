// The stage layout. Control points are [x, z] in metres; a point written as
// ['hp', x, z, side, radius, degrees] expands into a hairpin that turns
// `side` ('L' or 'R') around a corner of that radius, starting at (x, z).
// Everything along the road is placed by distance `s` in metres from the start.

export const ROUTE = [
  // ---- SS1 Pine Crest: up the west side into the hills
  [-470, 470], ['head', 205],
  ['go', 260],                      // start straight with a jump
  ['arc', 'R', 160, 25],            // fast right
  ['go', 100],
  ['arc', 'L', 60, 50],
  ['arc', 'R', 60, 50],
  ['go', 180],                      // straight north, a crest
  ['arc', 'R', 45, 55],
  ['arc', 'L', 45, 55],             // esses
  ['go', 110],
  ['arc', 'R', 13, 170],            // hairpin right
  ['go', 80],
  ['arc', 'L', 13, 170],            // hairpin left
  ['go', 120],
  ['arc', 'R', 80, 45],
  ['go', 200],                      // along the ridge
  ['arc', 'R', 110, 40],
  // ---- SS2 Lakeside Sprint: across the north and down the big lake
  ['go', 230],                      // fast straight east, jump
  ['arc', 'L', 60, 35],
  ['arc', 'R', 50, 80],
  ['go', 90],
  ['arc', 'R', 30, 60],             // tight right
  ['go', 150],                      // down toward the lake
  ['arc', 'L', 50, 35],
  ['arc', 'R', 60, 35],
  ['go', 150],                      // west shore
  ['arc', 'L', 100, 50],
  ['go', 150],
  ['arc', 'L', 70, 40],             // round the lake's south end
  ['go', 200],                      // flat out east: two jumps
  ['go', 220],
  // ---- SS3 Midnight Ridge: the east side, a splash, the southern ridges
  ['arc', 'R', 55, 80],             // turn south down the east side
  ['go', 170],
  ['arc', 'L', 60, 30],
  ['arc', 'R', 60, 30],
  ['go', 140],
  ['arc', 'R', 70, 70],             // round the east lake
  ['go', 110],                      // along its shore: water splash
  ['arc', 'R', 60, 22],
  ['go', 150],
  ['arc', 'R', 22, 75],             // tight right
  ['arc', 'L', 30, 80],             // tight left
  ['go', 120],
  ['arc', 'R', 80, 30],
  ['go', 230],                      // over the ridges: jump
  ['arc', 'L', 80, 38],
  ['go', 170],                      // crest
  ['arc', 'L', 60, 25],
  ['go', 70],
  ['arc', 'R', 85, 101],            // long right onto the start straight
];

export const ROAD = {
  halfWidth: 3.6,      // gravel is 7.2 m wide
  shoulder: 1.0,       // loose gravel berm beyond the edge
  ditch: 2.2,          // ditch width in cuttings
  ditchDepth: 0.55,
  cutSlope: 0.9,       // rise per metre of cutting walls
  fillSlope: 0.45,     // drop per metre of embankments
  maxGrade: 0.13,
  minAboveWater: 0.9,
};

// Designed features along the road, by distance from the start.
// jump: a kicker whose far side falls away, `h` metres high.
// crest: a smooth rounded hump that lightens the car.
// ford: the road dips into the water for a splash.
export const FEATURES = [
  { type: 'jump', s: 115, h: 1.4 },
  { type: 'crest', s: 640, h: 1.0, len: 24 },
  { type: 'jump', s: 1595, h: 1.5 },
  { type: 'jump', s: 2740, h: 1.25 },
  { type: 'crest', s: 2905, h: 0.8, len: 22 },
  { type: 'ford', s: 3655, len: 26, depth: 0.3, ramp: 32 },
  { type: 'jump', s: 4170, h: 1.5 },
  { type: 'crest', s: 4470, h: 1.1, len: 26 },
];

// Asphalt sections [from, to] in metres.
export const TARMAC = [];

// Stages are stretches of the loop. `start`/`end` are distances along it;
// medal times are in seconds (gold, silver, bronze).
export const STAGES = [
  { id: 'pine', name: 'Pine Crest', start: 20, end: 1540, time: 'morning', tint: '#34546b', medals: [66, 74, 86] },
  { id: 'lake', name: 'Lakeside Sprint', start: 1540, end: 3100, time: 'sunset', tint: '#7a4b2e', medals: [62, 70, 81] },
  { id: 'night', name: 'Midnight Ridge', start: 3100, end: 4780, time: 'night', tint: '#1b2447', medals: [72, 81, 94] },
  { id: 'loop', name: 'Grand Loop', start: 20, end: 20, full: true, time: 'noon', tint: '#3f5b2c', medals: [202, 226, 262] },
  { id: 'rain', name: 'Lakeside Downpour', start: 1540, end: 3100, time: 'rain', tint: '#3b4a56', medals: [65, 73, 85] },
];
