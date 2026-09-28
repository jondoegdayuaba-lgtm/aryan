// The hand-placed layout of the map: the rally route, where the dunes, dry lake,
// oasis, mesas and buttes sit, and the jumps along the road. Units are metres;
// x runs east, z runs south (so "north" is -z).
//
// Route control point fields:
//   w     half width of the driven road
//   f     half width of the flat floor cut or filled around the road
//   cut   steepness of cut banks (rise per metre, 3 = near-vertical canyon wall)
//   fill  steepness of embankments where the road sits above the ground

export const STAGE = {
  seed: 2207,

  route: [
    { x: -60, z: 560, w: 4.6, f: 7, cut: 0.7, fill: 0.5 },     // 0  start / finish
    { x: 170, z: 548, w: 4.6, f: 7, cut: 0.7, fill: 0.5 },     // 1
    { x: 340, z: 470, w: 5.0, f: 8, cut: 0.7, fill: 0.4 },     // 2  onto the dry lake
    { x: 520, z: 385, w: 5.5, f: 9, cut: 0.6, fill: 0.4 },     // 3  dry lake
    { x: 690, z: 262, w: 5.5, f: 9, cut: 0.6, fill: 0.4 },     // 4  dry lake
    { x: 736, z: 90, w: 4.8, f: 7, cut: 0.8, fill: 0.5 },      // 5
    { x: 655, z: -18, w: 4.6, f: 7, cut: 0.8, fill: 0.5 },     // 6  oasis water crossing
    { x: 566, z: -150, w: 4.6, f: 8, cut: 1.2, fill: 0.6 },    // 7
    { x: 585, z: -318, w: 4.8, f: 14, cut: 3.2, fill: 0.7 },   // 8  canyon mouth
    { x: 480, z: -455, w: 4.8, f: 15, cut: 3.6, fill: 0.7 },   // 9  canyon
    { x: 330, z: -520, w: 4.8, f: 13, cut: 3.6, fill: 0.7 },   // 10 canyon
    { x: 195, z: -640, w: 4.8, f: 15, cut: 3.4, fill: 0.7 },   // 11 canyon
    { x: 20, z: -636, w: 4.8, f: 12, cut: 2.4, fill: 0.7 },    // 12 canyon exit
    { x: -150, z: -560, w: 4.8, f: 8, cut: 1.0, fill: 0.9 },   // 13 up onto the ledge
    { x: -330, z: -500, w: 5.0, f: 8, cut: 0.9, fill: 0.9 },   // 14 the big drop
    { x: -520, z: -380, w: 5.0, f: 8, cut: 0.6, fill: 0.5 },   // 15 dunes
    { x: -640, z: -150, w: 5.0, f: 8, cut: 0.6, fill: 0.5 },   // 16 dunes
    { x: -615, z: 110, w: 5.0, f: 8, cut: 0.6, fill: 0.5 },    // 17 dune whoops
    { x: -520, z: 330, w: 4.8, f: 8, cut: 0.6, fill: 0.5 },    // 18
    { x: -390, z: 500, w: 4.8, f: 7, cut: 0.8, fill: 0.5 },    // 19
    { x: -250, z: 585, w: 4.6, f: 7, cut: 0.8, fill: 0.5 },    // 20
  ],

  // Edits to the road's height profile. Positions are [control point index, metres offset].
  profile: [
    // Canyon floor runs straight through at basin level while the plateau rises around it.
    { type: 'level', from: [8, -40], to: [12, 30], h: 'bridge', blend: 60 },
    { type: 'whoops', from: [8, 10], to: [12, -20], amp: 1.6, wavelength: 85 },
    // Climb up onto the ledge, then launch off it.
    { type: 'level', from: [13, -10], to: [14, 0], h: 14, blendIn: 115, blendOut: 85 },
    { type: 'kicker', at: [14, 0], height: 1.2, up: 16, down: 10 },
    // Water crossing at the oasis.
    { type: 'level', from: [6, -12], to: [6, 12], h: 'water', blend: 22 },
    // Crest jumps.
    { type: 'kicker', at: [1, 40], height: 2.0, up: 24, down: 20 },
    { type: 'kicker', at: [4, 70], height: 2.4, up: 26, down: 22 },
    { type: 'kicker', at: [16, -30], height: 2.8, up: 26, down: 22 },
    { type: 'kicker', at: [19, 30], height: 2.2, up: 22, down: 20 },
    // Rhythm section in the dunes.
    { type: 'whoops', from: [17, -60], to: [17, 60], amp: 0.55, wavelength: 13 },
  ],

  // Checkpoint gates, as [control point index, metres offset]. The last one is the finish.
  checkpoints: [[2, 0], [4, 0], [5, 30], [7, 0], [9, 0], [11, 0], [13, 0], [15, 0], [16, 60], [18, 0], [19, 60], [0, 0]],

  playa: { x: 520, z: 330, rx: 262, rz: 200, h: -2.5 },
  oasis: { x: 635, z: -4, r: 52, depth: 3.2, level: -1.1 },
  dunes: { x: -600, z: -40, r: 400 },

  // Plateau blobs that raise the mesa field: [x, z, radius, strength].
  mesas: [
    // The northern plateau the canyon cuts through (the road runs down its middle).
    [470, -500, 170, 0.55],
    [320, -600, 190, 0.55],
    [170, -720, 170, 0.5],
    [360, -380, 190, 0.45],
    [130, -250, 90, 0.35],
    [-300, 240, 85, 0.32],
    [320, 140, 70, 0.3],
  ],

  // Low flat-topped shelves: [x, z, radius, height].
  ledges: [
    [-235, -540, 105, 14],
  ],

  // Monument-valley style buttes: [x, z, radius, height].
  buttes: [
    [-430, 710, 38, 120],
    [260, 700, 30, 95],
    [70, 330, 26, 80],
    [-200, 60, 34, 105],
    [390, -110, 24, 70],
    [-420, -210, 22, 64],
    [840, -320, 40, 130],
  ],
};
