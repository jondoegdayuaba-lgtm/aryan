// The island's named places. Coordinates are metres in the game's X/Z plane (-Z is north on the map).
// `flat` is the radius flattened for buildings; `kind` picks what gets built there (world.js).

export const POIS = [
  { name: 'Brickton', kind: 'city', x: 40, z: -130, flat: 74 },
  { name: 'Pinecrest', kind: 'suburb', x: -196, z: -92, flat: 62 },
  { name: 'Rustmill', kind: 'industrial', x: 214, z: 92, flat: 66 },
  { name: 'Sunny Acres', kind: 'farm', x: -204, z: 176, flat: 72 },
  { name: 'Harbor Point', kind: 'harbor', x: 64, z: 318, flat: 48 },
  { name: 'Lookout Peak', kind: 'peak', x: 250, z: -218, flat: 16 },
  { name: 'Mossy Hollow', kind: 'cabins', x: -56, z: -318, flat: 42 },
  { name: 'Crater Lake', kind: 'lake', x: 74, z: 96, flat: 0, lake: 58 },
  { name: 'Old Quarry', kind: 'quarry', x: -334, z: -18, flat: 46 },
  { name: 'Palm Cove', kind: 'beach', x: 296, z: 236, flat: 34 },
];

// Dirt roads between places (indices into POIS). Drawn as paths on the terrain.
export const ROADS = [
  [0, 1], [0, 2], [0, 7], [1, 3], [3, 7], [7, 4], [2, 9], [2, 5], [0, 6], [1, 8], [3, 8], [4, 9],
];

// Where the lobby shows your character: the beach at Palm Cove, looking out to sea.
export const LOBBY = { x: 318, z: 264, yaw: 0.67 };

export const POI_BY_NAME = Object.fromEntries(POIS.map((p) => [p.name, p]));
