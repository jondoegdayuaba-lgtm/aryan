// Cluckworks game rules. No DOM here, so tools/sim-cluckworks.mjs can play it headless.
(function (root) {
  'use strict';

  const GOAL = 1_000_000;

  // Each upgrade is a list of levels. values[level] is the current effect,
  // costs[level] is the price of the next level.
  const UPGRADES = [
    { id: 'coop', name: 'Bigger coop', desc: 'Room for more hens',
      values: [6, 15, 40, 100, 250], costs: [15, 180, 1800, 15000], fmt: v => `${v} hens` },
    { id: 'nests', name: 'Nesting boxes', desc: 'Eggs the floor can hold',
      values: [20, 60, 200, 600, 2000], costs: [10, 110, 1100, 10000], fmt: v => `${v} eggs` },
    { id: 'basket', name: 'Basket', desc: 'Eggs you can carry to market',
      values: [10, 30, 100, 400, 1500, 6000], costs: [6, 65, 650, 5500, 35000], fmt: v => `${v} eggs` },
    { id: 'trough', name: 'Feed trough', desc: 'Feed it holds',
      values: [40, 150, 600, 2500, 10000], costs: [8, 80, 800, 7000], fmt: v => `${v} feed` },
    { id: 'recipe', name: 'Feed recipe', desc: 'Seconds per egg, per hen',
      values: [6, 4.5, 3.5, 2.6, 2, 1.5], costs: [25, 280, 2300, 18000, 95000], fmt: v => `${v}s` },
    { id: 'quality', name: 'Egg quality', desc: 'Market price multiplier',
      values: [1, 1.5, 2.5, 4, 7, 12, 20], costs: [15, 130, 1100, 8000, 45000, 180000], fmt: v => `×${v}` },
    { id: 'golden', name: 'Golden breed', desc: 'Chance of a golden egg (×20)',
      values: [0, 0.02, 0.05, 0.1, 0.15], costs: [600, 5500, 38000, 150000], fmt: v => `${Math.round(v * 100)}%` },
    { id: 'bot', name: 'Egg collector bot', desc: 'Eggs it picks up per second',
      values: [0, 3, 10, 30, 100, 300, 900], costs: [40, 330, 2400, 15000, 75000, 230000], fmt: v => v ? `${v}/s` : 'none' },
    { id: 'van', name: 'Delivery van', desc: 'Sells your basket every trip',
      values: [0, 10, 6, 3, 1.5, 0.75], costs: [100, 800, 5000, 30000, 130000], fmt: v => v ? `every ${v}s` : 'none' },
    { id: 'feeder', name: 'Auto feeder', desc: 'Buys feed when the trough runs low',
      values: [0, 1], costs: [60], fmt: v => v ? 'on' : 'off' },
  ];
  const UPG = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

  const MODES = {
    normal:  { name: 'Normal', desc: 'Save $1M and retire.', goal: GOAL },
    speed:   { name: 'Speedrun', desc: 'Normal, against the clock. Best times are kept.', goal: GOAL, timer: true },
    endless: { name: 'Endless', desc: 'No finish line. Just eggs.', goal: 0 },
    pricey:  { name: 'Pricey Hens', desc: 'Challenge: hens cost twice as much.', goal: GOAL, timer: true, henMult: 2 },
    hungry:  { name: 'Hungry Hens', desc: 'Challenge: every egg eats 3 feed.', goal: GOAL, timer: true, feedPerEgg: 3 },
  };

  const EGG_PRICE = 1;
  const GOLDEN_MULT = 20;
  const FEED_PRICE = 0.15;
  const FEED_BAG = 25;
  const HANDFUL = 5;
  const POKE_COOLDOWN = 0.25;

  function newGame(mode) {
    return {
      v: 1, mode, money: 15, earned: 0, time: 0, won: false,
      hens: 2, feed: 25,
      floorN: 0, floorG: 0, basketN: 0, basketG: 0,
      lv: Object.fromEntries(UPGRADES.map(u => [u.id, 0])),
      layAcc: 0, botAcc: 0, vanT: 0, pokeT: 0,
      stats: { eggs: 0, golden: 0, sold: 0, clicks: 0 },
      events: [],
    };
  }

  const val = (s, id) => UPG[id].values[s.lv[id]];
  const nextCost = (s, id) => UPG[id].costs[s.lv[id]];
  const modeOf = s => MODES[s.mode] || MODES.normal;
  const feedPerEgg = s => modeOf(s).feedPerEgg || 1;
  const floorCount = s => s.floorN + s.floorG;
  const basketCount = s => s.basketN + s.basketG;
  const eggValue = (s, golden) => EGG_PRICE * val(s, 'quality') * (golden ? GOLDEN_MULT : 1);

  function henCost(s, n = s.hens) {
    return Math.ceil(8 * Math.pow(1.035, n) * (modeOf(s).henMult || 1));
  }

  // Price and count for buying up to `want` hens (Infinity = as many as affordable).
  function henQuote(s, want) {
    const room = val(s, 'coop') - s.hens;
    let n = 0, cost = 0;
    while (n < Math.min(want, room)) {
      const c = henCost(s, s.hens + n);
      if (want === Infinity && cost + c > s.money) break;
      cost += c; n++;
    }
    return { n, cost };
  }

  function buyHens(s, want) {
    const q = henQuote(s, want);
    if (!q.n || q.cost > s.money) return false;
    s.money -= q.cost; s.hens += q.n;
    s.events.push({ t: 'hen', n: q.n });
    return true;
  }

  function feedBagCost(s) {
    const room = val(s, 'trough') - s.feed;
    const amt = Math.min(FEED_BAG, room);
    return { amt, cost: +(amt * FEED_PRICE).toFixed(2) };
  }

  function buyFeed(s) {
    const { amt, cost } = feedBagCost(s);
    if (amt <= 0 || cost > s.money) return false;
    s.money -= cost; s.feed += amt;
    s.events.push({ t: 'feed', n: amt });
    return true;
  }

  function buyUpgrade(s, id) {
    const c = nextCost(s, id);
    if (c === undefined || c > s.money) return false;
    s.money -= c; s.lv[id]++;
    s.events.push({ t: 'upgrade', id });
    return true;
  }

  // Move up to n eggs from floor to basket, golden first. Returns [normal, golden] moved.
  function collect(s, n, golden) {
    const space = val(s, 'basket') - basketCount(s);
    n = Math.min(n, space);
    let g = 0, k = 0;
    if (golden === undefined || golden) { g = Math.min(n, s.floorG); }
    if (golden === undefined || !golden) { k = Math.min(n - g, s.floorN); }
    s.floorG -= g; s.basketG += g;
    s.floorN -= k; s.basketN += k;
    return [k, g];
  }

  function sell(s, by) {
    const n = s.basketN, g = s.basketG;
    if (!n && !g) return 0;
    const amount = n * eggValue(s, false) + g * eggValue(s, true);
    s.basketN = 0; s.basketG = 0;
    s.money += amount; s.earned += amount; s.stats.sold += n + g;
    s.events.push({ t: 'sell', amount, n: n + g, by });
    return amount;
  }

  function canLay(s) { return s.feed >= feedPerEgg(s) && floorCount(s) < val(s, 'nests'); }

  function layEggs(s, n) {
    n = Math.min(n, val(s, 'nests') - floorCount(s), Math.floor(s.feed / feedPerEgg(s)));
    if (n <= 0) return 0;
    const chance = val(s, 'golden');
    let g = 0;
    if (chance) {
      if (n <= 200) { for (let i = 0; i < n; i++) if (Math.random() < chance) g++; }
      else g = Math.round(n * chance);
    }
    s.floorN += n - g; s.floorG += g;
    s.feed -= n * feedPerEgg(s);
    s.stats.eggs += n; s.stats.golden += g;
    s.events.push({ t: 'lay', n: n - g, g });
    return n;
  }

  // Tapping a hen makes her lay right away (if she has feed and a nest).
  function poke(s) {
    s.stats.clicks++;
    if (s.pokeT > 0 || !s.hens || !canLay(s)) return 0;
    s.pokeT = POKE_COOLDOWN;
    return layEggs(s, 1);
  }

  function tick(s, dt) {
    if (!s.won) s.time += dt;
    s.pokeT = Math.max(0, s.pokeT - dt);

    // Hens lay on their own clock.
    s.layAcc += s.hens / val(s, 'recipe') * dt;
    const whole = Math.floor(s.layAcc);
    if (whole > 0) {
      const laid = layEggs(s, whole);
      s.layAcc -= whole;
      if (laid < whole) s.layAcc = Math.min(s.layAcc, 1);
    }

    if (s.lv.feeder && s.feed < val(s, 'trough') * 0.5) {
      const want = val(s, 'trough') - s.feed;
      const amt = Math.min(want, Math.floor(s.money / FEED_PRICE));
      if (amt > 0) { s.money -= amt * FEED_PRICE; s.feed += amt; }
    }

    const botRate = val(s, 'bot');
    if (botRate) {
      s.botAcc = Math.min(s.botAcc + botRate * dt, botRate + 1);
      const n = Math.floor(s.botAcc);
      if (n > 0) {
        const [k, g] = collect(s, n);
        s.botAcc -= k + g;
        if (k + g) s.events.push({ t: 'bot', n: k, g });
        else s.botAcc = Math.min(s.botAcc, 1);
      }
    }

    const trip = val(s, 'van');
    if (trip) {
      s.vanT += dt;
      if (s.vanT >= trip) { s.vanT = 0; sell(s, 'van'); }
    }
  }

  function goal(s) { return modeOf(s).goal; }
  function canRetire(s) { return !s.won && goal(s) > 0 && s.money >= goal(s); }
  function retire(s) {
    if (!canRetire(s)) return false;
    s.won = true;
    s.events.push({ t: 'win' });
    return true;
  }

  // Steady-state flow through the chain (lay -> collect -> sell), per second.
  // handRate is how many eggs/s the player moves by hand where there is no machine.
  function flow(s, handRate = 0) {
    const lay = s.hens / val(s, 'recipe');
    const collectRate = val(s, 'bot') + handRate;
    const sellRate = (val(s, 'van') ? val(s, 'basket') / val(s, 'van') : 0) + handRate;
    const eggs = Math.min(lay, collectRate, sellRate);
    const chance = val(s, 'golden');
    const avg = eggValue(s, false) * (1 - chance) + eggValue(s, true) * chance;
    return { lay, collect: collectRate, sell: sellRate, eggs, income: eggs * (avg - FEED_PRICE * feedPerEgg(s)) };
  }

  root.Cluck = {
    GOAL, UPGRADES, UPG, MODES, FEED_BAG, HANDFUL, GOLDEN_MULT,
    newGame, tick, val, nextCost, henCost, henQuote, buyHens, feedBagCost, buyFeed,
    buyUpgrade, collect, sell, poke, canLay, floorCount, basketCount, eggValue,
    feedPerEgg, goal, canRetire, retire, flow, modeOf, FEED_PRICE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
