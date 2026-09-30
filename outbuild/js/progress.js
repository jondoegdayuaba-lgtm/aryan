// Season level, XP and daily challenges (all stored in the browser with the other stats).

export const XP_PER_LEVEL = 1000;

export const CHALLENGES = [
  { id: 'elim', text: 'Eliminate opponents', goal: 5, xp: 500, stat: 'kills' },
  { id: 'chests', text: 'Open chests', goal: 7, xp: 400, stat: 'chests' },
  { id: 'build', text: 'Build structures', goal: 40, xp: 400, stat: 'built' },
  { id: 'mats', text: 'Gather materials', goal: 500, xp: 300, stat: 'mats' },
  { id: 'damage', text: 'Deal damage to opponents', goal: 1000, xp: 500, stat: 'damage' },
  { id: 'outlast', text: 'Outlast opponents', goal: 60, xp: 400, stat: 'outlast' },
  { id: 'duel', text: 'Win a duel on Duel Grounds', goal: 1, xp: 600, stat: 'duelWins' },
  { id: 'top10', text: 'Finish in the top 10', goal: 2, xp: 400, stat: 'top10' },
];

export const level = (xp) => Math.floor((xp || 0) / XP_PER_LEVEL) + 1;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Three challenges a day, the same for everyone on a given date.
export function dailyChallenges(stats) {
  const day = today();
  if (!stats.daily || stats.daily.day !== day) {
    let h = 2166136261;
    for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const pool = CHALLENGES.slice();
    const list = [];
    while (list.length < 3) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      list.push({ id: pool.splice(h % pool.length, 1)[0].id, prog: 0, done: false });
    }
    stats.daily = { day, list };
  }
  return stats.daily.list.map((c) => ({ ...CHALLENGES.find((d) => d.id === c.id), prog: c.prog, done: c.done, ref: c }));
}

// Score a finished match. r: { kills, chests, built, mats, damage, placement, players, duel, won, time }.
export function awardMatch(stats, r) {
  const values = {
    kills: r.kills, chests: r.chests, built: r.built, mats: r.mats, damage: r.damage,
    outlast: Math.max(0, r.players - r.placement), duelWins: r.duel && r.won ? 1 : 0, top10: r.placement <= 10 && r.players > 10 ? 1 : 0,
  };
  const lines = [];
  let xp = 0;
  const add = (label, v) => { if (v > 0) { xp += v; lines.push([label, v]); } };
  add('Eliminations', r.kills * 60);
  add('Survival', Math.round(Math.min(r.time, 1200) / 60 * 15));
  add('Placement', r.won ? 300 : r.placement <= 5 ? 150 : r.placement <= 10 ? 80 : 0);
  for (const c of dailyChallenges(stats)) {
    if (c.done) continue;
    c.ref.prog = Math.min(c.goal, c.ref.prog + (values[c.stat] || 0));
    if (c.ref.prog >= c.goal) { c.ref.done = true; add(`Challenge: ${c.text}`, c.xp); }
  }
  const before = level(stats.xp);
  stats.xp = (stats.xp || 0) + xp;
  return { xp, lines, levelUp: level(stats.xp) > before, level: level(stats.xp) };
}
