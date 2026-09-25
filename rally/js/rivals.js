// The field you race against. Their times are made up but steady: each
// driver has a pace relative to the stage's gold time, a feel for night
// stages, and a little stage-to-stage luck that never changes.

export const RIVALS = [
  { name: 'Eero Lahtinen', nat: 'FIN', pace: 0.981, night: 0.996 },
  { name: 'Maja Lindqvist', nat: 'SWE', pace: 0.991, night: 1.004 },
  { name: 'Tomás Ribeiro', nat: 'POR', pace: 1.003, night: 1.012 },
  { name: 'Rhys Pritchard', nat: 'GBR', pace: 1.017, night: 0.99 },
  { name: 'Anneli Saar', nat: 'EST', pace: 1.034, night: 1.0 },
  { name: 'Luca Moretti', nat: 'ITA', pace: 1.055, night: 1.016 },
  { name: 'Jonas Brekke', nat: 'NOR', pace: 1.08, night: 0.994 },
  { name: 'Hana Nováková', nat: 'CZE', pace: 1.11, night: 1.006 },
  { name: 'Kenji Arai', nat: 'JPN', pace: 1.15, night: 1.01 },
  { name: 'Sofía Ibarra', nat: 'ESP', pace: 1.2, night: 1.02 },
  { name: 'Dara Kelleher', nat: 'IRL', pace: 1.27, night: 1.0 },
];

// Small repeatable number in [-1, 1] from two strings.
function luck(a, b) {
  let h = 2166136261;
  for (const c of a + '|' + b) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

// The rivals drive the same car as you, so `pace` is your car's class pace.
export function rivalTimes(stage, night = false, pace = 1) {
  const gold = stage.medals[0] * pace;
  return RIVALS.map((r) => ({
    name: r.name, nat: r.nat,
    t: gold * r.pace * (night ? r.night : 1) * (1 + luck(r.name, stage.id) * 0.008),
  }));
}

// Everyone on the stage, you included, fastest first.
export function classify(stage, you, night = false, pace = 1) {
  const rows = rivalTimes(stage, night, pace);
  if (you) rows.push({ name: you.name, nat: you.nat, t: you.t, you: true });
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

// Overall times after the stages run so far (`yours` has one time per stage).
export function overall(stages, yours, nights, pace = 1) {
  const rows = RIVALS.map((r) => ({ name: r.name, nat: r.nat, t: 0 }));
  stages.forEach((st, k) => {
    rivalTimes(st, nights[k], pace).forEach((x, i) => { rows[i].t += x.t; });
  });
  rows.push({ name: 'You', nat: '', t: yours.reduce((a, b) => a + b, 0), you: true });
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
