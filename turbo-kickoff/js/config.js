// Tuning for Turbo Kickoff. Distances in metres, times in seconds, speeds in m/s.
// The car and ball are Rocket League sized, so most numbers follow its feel.

export const MATCH_SECONDS = 300;
export const KICKOFF_COUNTDOWN = 3;
export const GOAL_REPLAY_SECONDS = 3.2;
export const START_BOOST = 33;

export const PHYSICS = {
  step: 1 / 120,
  gravity: 6.5,

  // Car
  carMass: 180,
  hitboxHalf: [0.42, 0.18, 0.59], // x (width), y (height), z (length)
  rideHeight: 0.30,               // hitbox centre above the surface when driving
  maxDriveSpeed: 14.1,
  maxCarSpeed: 23,
  supersonic: 22,
  throttleAccel: 16,
  brakeAccel: 35,
  coastDecel: 5.25,
  boostAccel: 9.9,
  boostPerSecond: 33.3,
  grip: 12,
  slideGrip: 2.2,
  stickFast: 9,                   // pull towards walls/ceiling when moving fast
  stickSlow: 2,
  stickSpeed: 6,
  jumpImpulse: 2.92,
  jumpHoldAccel: 14.6,
  jumpHoldTime: 0.2,
  secondJumpWindow: 1.25,
  doubleJumpImpulse: 3.2,
  dodgeImpulse: 5.0,
  dodgeTime: 0.62,
  airPitchAccel: 12.5,
  airYawAccel: 9.1,
  airRollAccel: 38,
  airMaxRate: 5.5,

  // Ball
  ballMass: 30,
  ballRestitution: 0.6,
  ballDrag: 0.03,
  ballMaxSpeed: 60,
};

export const DIFFICULTY = {
  easy: { label: 'Easy', throttle: 0.72, boost: 0.15, reaction: 0.35, aimError: 0.45, jumps: false, flips: false, aerials: false, kickoffFlip: false },
  medium: { label: 'Medium', throttle: 0.9, boost: 0.45, reaction: 0.2, aimError: 0.25, jumps: true, flips: true, aerials: false, kickoffFlip: true },
  hard: { label: 'Hard', throttle: 1, boost: 1, reaction: 0.06, aimError: 0.05, jumps: true, flips: true, aerials: true, kickoffFlip: true },
};

export const BOT_NAMES = ['Blitz', 'Nova', 'Turbo', 'Comet', 'Rocket', 'Vortex', 'Pulse', 'Echo'];

export const TEAM_COLORS = { blue: '#3fd0ff', orange: '#ffae2b' };
