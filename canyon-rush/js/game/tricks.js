// Freestyle tricks the rider can throw in the air. Hold the trick's button to
// stretch it out, and let go in time to get back on the bike before landing.
// Index 0 is "no trick"; the bike, the rider model and the scoring all use
// these indices.
export const TRICKS = [
  null,
  { id: 'superman', name: 'Superman', key: 'Q', codes: ['KeyQ', 'Digit1'], base: 450, rate: 450 },
  { id: 'nohander', name: 'No Hander', key: 'E', codes: ['KeyE', 'Digit2'], base: 300, rate: 350 },
  { id: 'heelclicker', name: 'Heel Clicker', key: 'F', codes: ['KeyF', 'Digit3'], base: 350, rate: 400 },
  { id: 'nacnac', name: 'Nac-Nac', key: 'G', codes: ['KeyG', 'Digit4'], base: 400, rate: 400 },
  { id: 'cancan', name: 'Can-Can', key: 'X', codes: ['KeyX', 'Digit5'], base: 350, rate: 400 },
];

// Gamepad: X for a Superman, the D-pad for the rest.
export const PAD_TRICKS = { 2: 1, 12: 2, 15: 3, 13: 4, 14: 5 };

// Stretching a trick out and pulling it back in (fraction of the full pose per second).
export const TRICK_OUT = 4.5;
export const TRICK_IN = 9;
// Still this far out when the wheels touch down: the rider bails.
export const TRICK_BAIL = 0.6;
