// Plays Cluckworks headless with a simple greedy bot to check pacing.
// Usage: node tools/sim-cluckworks.mjs [mode] [clicksPerSecond]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(readFileSync(new URL('../cluckworks/logic.js', import.meta.url), 'utf8'));
const C = globalThis.Cluck;
const mode = process.argv[2] || 'normal';
const cps = +(process.argv[3] || 3);

const s = C.newGame(mode);
const dt = 0.1;
let clickAcc = 0, lastLog = -60;
const log = [];

while (!s.won && s.time < 3600) {
  C.tick(s, dt);
  s.events.length = 0;

  // Hands: tap hens, grab eggs, sell when the basket is full or nothing else to do.
  clickAcc += cps * dt;
  while (clickAcc >= 1) {
    clickAcc--;
    if (!s.lv.van && C.basketCount(s) >= C.val(s, 'basket')) C.sell(s, 'hand');
    else if (!s.lv.bot && C.floorCount(s) > 0) C.collect(s, C.HANDFUL);
    else if (C.canLay(s)) C.poke(s);
    else if (!s.lv.van && C.basketCount(s)) C.sell(s, 'hand');
  }
  if (s.feed < C.feedPerEgg(s) * 3) C.buyFeed(s);

  // Buy whatever raises income most per dollar. A stage that is at (or near) the
  // bottleneck is valued as if it were the only limit, so paired fixes still get bought.
  const hand = cps * 1.5;
  const f = C.flow(s, hand);
  const stageOf = { hen: 'lay', coop: 'lay', recipe: 'lay', bot: 'collect', van: 'sell', basket: 'sell' };
  const tight = st => f[st] <= f.eggs * 1.1;
  const value = (what) => {
    const t = structuredClone({ ...s, events: [] });
    if (what === 'hen') t.hens += 1; else t.lv[what]++;
    if (what === 'coop') t.hens += 4;
    const g = C.flow(t, hand);
    const st = stageOf[what];
    if (!st) return g.income - f.income;
    if (!tight(st)) return 0;
    return f.income * (g[st] / f[st] - 1);
  };
  const options = C.UPGRADES.filter(u => C.nextCost(s, u.id) !== undefined && !['nests', 'trough', 'feeder'].includes(u.id))
    .map(u => ({ what: u.id, cost: C.nextCost(s, u.id) }));
  if (s.hens < C.val(s, 'coop')) options.push({ what: 'hen', cost: C.henCost(s) });
  for (const o of options) o.score = value(o.what) / o.cost;
  // Buffers (nests, trough, feeder) have no flow value; buy them once they are cheap.
  for (const id of ['nests', 'trough', 'feeder']) {
    const c = C.nextCost(s, id);
    if (c !== undefined && c < s.money * 0.2) C.buyUpgrade(s, id);
  }
  const best = options.filter(o => o.score > 0).sort((x, y) => y.score - x.score)[0];
  if (best && s.money >= best.cost) {
    if (best.what === 'hen') C.buyHens(s, 1); else C.buyUpgrade(s, best.what);
  }
  if (C.canRetire(s)) C.retire(s);

  if (s.time - lastLog >= 60) {
    lastLog = s.time;
    log.push(`${(s.time / 60).toFixed(0).padStart(3)}m  $${Math.round(s.money).toLocaleString().padStart(11)}  hens ${String(s.hens).padStart(3)}  ` +
      Object.entries(s.lv).map(([k, v]) => `${k}${v}`).join(' '));
  }
}
console.log(log.join('\n'));
console.log(s.won ? `Retired in ${(s.time / 60).toFixed(1)} min (${mode}, ${cps} clicks/s)` : 'Did not finish in an hour');
