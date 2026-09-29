// Everything you can carry: what it is, what it does, and how the bottle's water is tracked.
const ico = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;

export const ITEMS = {
  beans:   { name: 'Canned beans', desc: 'Cold, salty, wonderful. Restores a lot of hunger.', icon: ico('M7 5h10v2H7zm-1 3h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zm3 3v6h6v-6z'), use: true },
  bar:     { name: 'Energy bar', desc: 'Chewy and sweet. A little hunger, a little stamina.', icon: ico('M3 9h18v6H3zm2 2v2h14v-2z'), use: true },
  berries: { name: 'Wild berries', desc: 'Tart alpine blueberries. Small, but they help.', icon: ico('M8 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 -2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2c0 2-1 3-3 3'), use: true },
  medkit:  { name: 'First-aid kit', desc: 'Bandages, tape and antiseptic. Heals a good chunk of health.', icon: ico('M4 7h16v13H4zM9 4h6v3H9zm2 7v2H9v2h2v2h2v-2h2v-2h-2v-2z'), use: true },
  matches: { name: 'Matches', desc: 'Dry ones, thank goodness. Each fire uses one.', icon: ico('M11 2h2v14h-2zm-1 15h4v5h-4z'), use: false },
  wood:    { name: 'Firewood', desc: 'Dry sticks and split logs. You need three to start a fire.', icon: ico('M2 10h20v4H2zm3-4h14v3H5zm0 8h14v3H5z'), use: false },
  bark:    { name: 'Birch bark', desc: 'Papery tinder. It lights even when damp.', icon: ico('M5 4l10 2 4 14-10-2z'), use: false },
  cells:   { name: 'Torch cells', desc: 'Fresh batteries for the flashlight.', icon: ico('M9 3h6v2H9zm-1 3h8v15H8z'), use: true },
  pills:   { name: 'Purification tablets', desc: 'Drop one in the bottle: dirty water becomes safe to drink.', icon: ico('M9 3a6 6 0 0 0 0 12l6 6a6 6 0 0 0 0-12z'), use: true },
  flare:   { name: 'Signal flare', desc: 'Bright red, visible for miles. Save it for the helicopter.', icon: ico('M11 2h2v3h-2zM8 6h8v3H8zm1 3h6v13H9z'), use: false },
  radio:   { name: 'Handheld radio', desc: 'Cracked antenna, dead battery. It is your only way to call for help.', icon: ico('M8 2h2v5h5a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3z'), use: false },
  battery: { name: 'Truck battery', desc: 'Heavy, but it holds a charge. Could run a radio.', icon: ico('M3 8h18v12H3zM6 5h3v3H6zm9 0h3v3h-3z'), use: false },
  antenna: { name: 'Antenna wire', desc: 'A coil of copper wire and a whip antenna.', icon: ico('M12 2v12m-5-3a5 5 0 0 1 10 0M9 16h6v6H9z'), use: false },
  map:     { name: 'Flight chart', desc: 'Your pilot chart of the Kestrel Valley. Press M.', icon: ico('M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-1v14m6-12v14'), use: false },
};

// Bottle: how full (0..1, one litre) and whether the water is safe.
export function newWater() { return { amount: 0, clean: true }; }

export class Inventory {
  constructor() { this.items = {}; this.flags = { flashlight: false, bottle: false, jacket: false }; }
  count(id) { return this.items[id] || 0; }
  add(id, n = 1) { this.items[id] = (this.items[id] || 0) + n; }
  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    this.items[id] -= n;
    if (this.items[id] <= 0) delete this.items[id];
    return true;
  }
  has(id, n = 1) { return this.count(id) >= n; }
  list() { return Object.entries(this.items).map(([id, n]) => ({ id, n, ...ITEMS[id] })); }
  toJSON() { return { items: this.items, flags: this.flags }; }
  load(d) { this.items = { ...(d?.items || {}) }; this.flags = { flashlight: false, bottle: false, jacket: false, ...(d?.flags || {}) }; }
}
