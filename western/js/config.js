// Tuning numbers in one place.
export const GAME_TITLE = 'Outlaw Frontier';

export const PLAYER = {
  radius: 0.35,
  walkSpeed: 1.7,
  runSpeed: 4.4,
  sprintSpeed: 6.6,
  aimSpeed: 1.9,
  turnRate: 10,
  health: 100,
  staminaDrain: 14,      // per second while sprinting
  staminaRegen: 9,
  healthRegen: 2.5,      // per second, after a few seconds without damage
  deadEyeMax: 100,
  deadEyeDrain: 12,
};

export const HORSE = {
  radius: 0.75,
  speeds: { walk: 2.1, trot: 5.2, canter: 9.0, gallop: 13.5 },
  accel: 6,
  brake: 10,
  turnRate: 1.9,
  staminaMax: 100,
  gallopDrain: 7,
  regen: 6,
};

export const WEAPONS = {
  revolver: {
    name: 'Revolver', clip: 6, reserve: 48, damage: 42, headMult: 3, interval: 0.42, reload: 2.1,
    range: 90, spread: 0.012, hipSpread: 0.05, fov: 52, sound: 'revolver',
  },
  rifle: {
    name: 'Rifle', clip: 8, reserve: 32, damage: 80, headMult: 2.5, interval: 0.95, reload: 2.8,
    range: 220, spread: 0.004, hipSpread: 0.06, fov: 38, sound: 'rifle',
  },
};

export const CAMERA = {
  fov: 62,
  footDist: 3.6,
  horseDist: 6.2,
  aimDist: 1.6,
  shoulder: 0.55,
  height: 1.55,
  minPitch: -1.05,
  maxPitch: 1.2,
};

export const QUALITY = {
  low: { shadow: 1024, grass: 0.35, treeLod: 160, pixelRatio: 0.75, shadows: true, far: 9000 },
  medium: { shadow: 2048, grass: 0.7, treeLod: 260, pixelRatio: 1, shadows: true, far: 12000 },
  high: { shadow: 4096, grass: 1.0, treeLod: 380, pixelRatio: 1.5, shadows: true, far: 14000 },
};
