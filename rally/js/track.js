// The stage layout. Control points are [x, z] in metres; a point written as
// ['hp', x, z, side, radius, degrees] expands into a hairpin that turns
// `side` ('L' or 'R') around a corner of that radius, starting at (x, z).
// Everything along the road is placed by distance `s` in metres from the start.

export const ROUTE = [
  [-480, 470], [-530, 430], [-560, 380], [-565, 320], [-610, 280], [-640, 285], [-670, 250], [-672, 200],
  [-650, 160], [-665, 110], [-700, 80], [-725, 30], [-730, -20], [-705, -60], [-715, -100], [-730, -150],
  [-725, -185], [-705, -208], [-670, -214], [-625, -212], [-595, -225], [-588, -252], [-605, -270], [-640, -275],
  [-680, -285], [-700, -310], [-700, -350], [-690, -380], [-650, -420], [-600, -440], [-570, -480], [-520, -505],
  [-470, -500], [-420, -540], [-380, -600], [-330, -620], [-280, -650], [-230, -700], [-170, -715], [-110, -745],
  [-40, -735], [10, -700], [40, -660], [90, -640], [110, -590], [95, -540], [70, -500], [85, -455],
  [115, -420], [100, -370], [80, -320], [95, -270], [140, -235], [200, -205], [260, -180], [320, -175],
  [380, -190], [440, -160], [500, -175], [560, -130], [600, -80], [640, -30], [650, 30], [690, 80],
  [705, 140], [690, 200], [650, 240], [590, 262], [530, 290], [470, 290], [420, 320], [400, 370],
  [410, 420], [385, 470], [390, 520], [420, 560], [400, 610], [350, 640], [290, 630], [240, 600],
  [180, 610], [120, 640], [60, 655], [0, 630], [-50, 590], [-100, 600], [-150, 620], [-200, 590],
  [-250, 560], [-300, 570], [-350, 545], [-400, 560], [-430, 540],
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
export const FEATURES = [];

// Asphalt sections [from, to] in metres.
export const TARMAC = [];

// Stages are stretches of the loop. `start`/`end` are distances along it;
// medal times are in seconds (gold, silver, bronze).
export const STAGES = [
  { id: 'pine', name: 'Pine Crest', start: 40, end: 1720, time: 'morning', tint: '#34546b', medals: [95, 110, 130] },
  { id: 'lake', name: 'Lakeside Sprint', start: 1720, end: 3400, time: 'sunset', tint: '#7a4b2e', medals: [95, 110, 130] },
  { id: 'night', name: 'Midnight Ridge', start: 3400, end: 5040, time: 'night', tint: '#1b2447', medals: [95, 110, 130] },
  { id: 'loop', name: 'Grand Loop', start: 40, end: 40, full: true, time: 'noon', tint: '#3f5b2c', medals: [290, 330, 390] },
];
