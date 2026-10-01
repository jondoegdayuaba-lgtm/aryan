// Everything you might want to tune: name, movement, weapons, modes and bots.

export const GAME_TITLE = 'Block Brawl';
export const TAGLINE = 'Fast arena shooter. Slide, aim, frag the bots.';

export const MOVE = {
  walk: 7.2,          // m/s
  adsWalk: 4.2,
  crouchWalk: 3.6,
  accel: 60,          // ground acceleration
  airAccel: 14,
  friction: 9,
  jump: 8.2,
  gravity: 23,
  slideBoost: 12.5,   // speed at the start of a slide
  slideTime: 0.85,
  slideCooldown: 0.5,
  slideFriction: 2.2,
  height: 1.8,
  crouchHeight: 1.1,
  eye: 0.16,          // eye sits this far under the top of the head
  radius: 0.38,
  stepUp: 0.55,
};

export const PLAYER = {
  health: 100,
  regenDelay: 4,      // seconds without damage before health regenerates
  regenRate: 30,      // hp per second
  respawnTime: 3,
  spawnProtect: 1.5,
  grenades: 2,
  fov: 78,
};

// auto: hold to fire. pellets: shots per trigger pull. dmg is per pellet.
// spread values are radians of random cone. adsFov: field of view while aiming.
export const WEAPONS = {
  rifle: {
    name: 'Assault Rifle', slot: 'primary', auto: true, dmg: 24, head: 1.7, rpm: 620,
    mag: 30, reserve: 150, reload: 1.9, spread: 0.035, adsSpread: 0.005, recoil: 0.011,
    range: 160, adsFov: 52, falloff: 60, sound: 'rifle',
  },
  smg: {
    name: 'SMG', slot: 'primary', auto: true, dmg: 17, head: 1.5, rpm: 920,
    mag: 32, reserve: 160, reload: 1.6, spread: 0.045, adsSpread: 0.018, recoil: 0.008,
    range: 90, adsFov: 60, falloff: 25, sound: 'smg',
  },
  shotgun: {
    name: 'Shotgun', slot: 'primary', auto: false, pellets: 9, dmg: 13, head: 1.3, rpm: 78,
    mag: 6, reserve: 36, reload: 2.2, spread: 0.1, adsSpread: 0.075, recoil: 0.05,
    range: 45, adsFov: 64, falloff: 12, sound: 'shotgun',
  },
  sniper: {
    name: 'Sniper', slot: 'primary', auto: false, dmg: 100, head: 2, rpm: 46,
    mag: 5, reserve: 30, reload: 2.4, spread: 0.12, adsSpread: 0, recoil: 0.06,
    range: 300, adsFov: 18, scope: true, falloff: 999, sound: 'sniper',
  },
  rocket: {
    name: 'Rocket Launcher', slot: 'primary', auto: false, projectile: true, dmg: 115, rpm: 55,
    mag: 1, reserve: 8, reload: 2.1, spread: 0.01, adsSpread: 0, recoil: 0.07,
    splash: 4.8, speed: 42, range: 200, adsFov: 60, sound: 'rocket',
  },
  pistol: {
    name: 'Pistol', slot: 'secondary', auto: false, dmg: 30, head: 1.7, rpm: 400,
    mag: 12, reserve: 72, reload: 1.3, spread: 0.022, adsSpread: 0.006, recoil: 0.018,
    range: 100, adsFov: 62, falloff: 30, sound: 'pistol',
  },
  knife: {
    name: 'Knife', slot: 'melee', auto: true, melee: true, dmg: 55, rpm: 110,
    mag: Infinity, reserve: Infinity, range: 2.6, adsFov: 78, sound: 'knife',
  },
};

export const PRIMARIES = ['rifle', 'smg', 'shotgun', 'sniper', 'rocket'];

// Gun Game: every kill moves you to the next weapon; a knife kill on the last level wins.
export const GUN_GAME = ['smg', 'rifle', 'shotgun', 'pistol', 'sniper', 'rocket', 'knife'];

export const MODES = {
  ffa: { name: 'Free for All', teams: false, killLimit: 25, time: 300 },
  tdm: { name: 'Team Deathmatch', teams: true, killLimit: 50, time: 360 },
  gungame: { name: 'Gun Game', teams: false, killLimit: GUN_GAME.length, time: 420 },
};

// reaction: seconds before a bot starts shooting at someone it just spotted.
// aimError: radians of aim wobble. turn: how fast it swings its aim (rad/s).
export const DIFFICULTY = {
  easy: { name: 'Easy', reaction: 0.75, aimError: 0.075, turn: 3.2, burst: 0.45 },
  normal: { name: 'Normal', reaction: 0.45, aimError: 0.045, turn: 5, burst: 0.65 },
  hard: { name: 'Hard', reaction: 0.25, aimError: 0.025, turn: 8, burst: 0.85 },
};

export const BOT_NAMES = [
  'Pixel', 'Nugget', 'Rusty', 'Blip', 'Waffle', 'Tango', 'Comet', 'Gizmo', 'Mango',
  'Sprocket', 'Bolt', 'Pepper', 'Noodle', 'Ziggy', 'Turbo', 'Biscuit', 'Echo', 'Fizz',
];

export const TEAM_COLORS = [0x2f7bff, 0xff4b3e];
export const FFA_COLORS = [0xff4b3e, 0xffb020, 0x37c871, 0xb45cff, 0x22c3e6, 0xff6fb5, 0x8fd14f, 0xf27f1b, 0x5f7cff, 0xe0e0e0, 0x9b6b43];
