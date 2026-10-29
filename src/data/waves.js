// Wave planner: endless waves that get harder and differ from run to run.
//
// - New alien types are introduced one at a time (one per wave from wave 2), in a
//   shuffled order per run, so you learn them one by one.
// - Each wave has a theme (mixed, swarm, armored, air raid, hunters, siege) and only
//   uses a handful of the unlocked types, so waves feel different from each other.
// - A point budget grows every wave; bosses come every 5 waves and more of them later.

import { mulberry32 } from '../core/rng.js';

const COST = {
  swarmling: 0.6, drone: 1, serpent: 1.4, spitter: 2, wasp: 2, leaper: 2.4, bloater: 3, splitter: 3.4,
  ravager: 3.4, corroder: 3.2, charger: 5.5, burrower: 4, floater: 4, mender: 5, stalker: 4, bulwark: 6.5, brute: 6,
};

// introduction order is shuffled inside each tier
const TIERS = [
  ['swarmling', 'spitter', 'serpent', 'splitter'],
  ['leaper', 'wasp', 'bloater', 'ravager', 'corroder', 'charger'],
  ['burrower', 'floater', 'brute', 'bulwark', 'mender', 'stalker'],
];

//              wave: 0  1  2  3  4  5  6  7  8  9 10  11  12  13  14
const UNLOCK = [0, 0, 1, 2, 3, 3, 4, 5, 6, 8, 8, 10, 12, 14, 16];

export const THEMES = {
  mixed: { name: '', types: null, weight: 3 },
  swarm: { name: 'SWARM', types: ['swarmling', 'serpent', 'drone', 'leaper', 'ravager', 'splitter'], weight: 1, countBoost: 1.15 },
  heavy: { name: 'ARMORED', types: ['brute', 'bulwark', 'drone', 'bloater', 'spitter', 'charger', 'mender'], weight: 1 },
  air: { name: 'AIR RAID', types: ['wasp', 'floater', 'drone'], weight: 1 },
  hunters: { name: 'HUNTERS', types: ['leaper', 'ravager', 'serpent', 'wasp', 'drone', 'stalker'], weight: 1 },
  siege: { name: 'SIEGE', types: ['spitter', 'bloater', 'brute', 'burrower', 'floater', 'drone', 'corroder', 'charger'], weight: 1 },
  ghost: { name: 'PHANTOM', types: ['stalker', 'serpent', 'corroder', 'drone', 'mender'], weight: 0.7 },
};

export function waveBudget(wave) {
  return 6 + wave * 6.5 + 0.25 * wave * wave;
}

export class WavePlanner {
  constructor(seed, bias = {}) {
    this.rng = mulberry32(seed >>> 0);
    this.bias = bias;
    const r = this.rng;
    // types the map favours tend to show up earlier in their tier
    this.order = TIERS.flatMap((tier) => tier.map((t) => [t, r() * (bias[t] || 1)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]));
    // boss order: the Queen first (wave 5), then a heavy one, the Wyrm, and the last one
    const b = r() < 0.5 ? ['titan', 'overseer'] : ['overseer', 'titan'];
    this.bossOrder = ['queen', b[0], 'wyrm', b[1]];
    this.bossN = 0;
    this.lastTheme = 'mixed';
  }

  // how many alien types are unlocked by a wave: one new type per wave at first, two
  // per wave later, none on boss waves, so every type shows up within a 15-wave mission
  unlockedCount(wave) {
    const n = wave < UNLOCK.length ? UNLOCK[Math.max(0, wave)] : this.order.length;
    return Math.min(this.order.length, n);
  }

  // the alien types introduced on this wave
  introsOf(wave) {
    return this.order.slice(this.unlockedCount(wave - 1), this.unlockedCount(wave));
  }

  introOf(wave) { return this.introsOf(wave)[0] || null; }

  unlocked(wave) {
    return ['drone', ...this.order.slice(0, this.unlockedCount(wave))];
  }

  nextBoss() {
    const b = this.bossOrder[this.bossN % this.bossOrder.length];
    this.bossN++;
    return b;
  }

  plan(wave, countMult = 1, opts = {}) {
    const r = this.rng;
    const intros = this.introsOf(wave);
    const intro = intros[0] || null;
    const avail = this.unlocked(wave);
    let budget = waveBudget(wave) * countMult;

    // theme
    let theme = 'mixed';
    if (!intro && wave >= 4) {
      const options = Object.entries(THEMES).filter(([id, t]) => id !== this.lastTheme && (!t.types || t.types.filter((x) => x !== 'drone' && avail.includes(x)).length >= 2));
      let total = options.reduce((s, [, t]) => s + t.weight, 0);
      let pick = r() * total;
      for (const [id, t] of options) { pick -= t.weight; if (pick <= 0) { theme = id; break; } }
    }
    this.lastTheme = theme;
    const T = THEMES[theme];
    if (T.countBoost) budget *= T.countBoost;

    // which types take part: a few, not all of them
    let pool = (T.types ? avail.filter((t) => T.types.includes(t)) : avail.slice()).filter((t) => t !== 'drone');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const kinds = Math.min(pool.length, 2 + Math.floor(wave / 7) + (r() < 0.35 ? 1 : 0));
    const chosen = pool.slice(0, kinds).filter((t) => !intros.includes(t));

    const counts = {};
    const spend = (type, pts) => {
      const n = Math.max(1, Math.round((pts * (this.bias[type] || 1)) / COST[type]));
      counts[type] = (counts[type] || 0) + n;
    };
    // a new alien gets a big, clear group so you notice it
    const introShare = intros.length > 1 ? 0.2 : 0.28;
    for (const t of intros) spend(t, budget * introShare);
    const rest = budget * (1 - introShare * intros.length);
    const droneShare = theme === 'air' ? 0.15 : T.types && !T.types.includes('drone') ? 0 : chosen.length ? 0.3 : 1;
    if (droneShare) spend('drone', rest * droneShare);
    if (chosen.length) {
      const w = chosen.map(() => 0.5 + r());
      const ws = w.reduce((a, b) => a + b, 0);
      chosen.forEach((t, i) => spend(t, (rest * (1 - droneShare) * w[i]) / ws));
    }

    // spawn order: shuffled, with the new alien arriving as one pack near the start
    let list = [];
    for (const [t, n] of Object.entries(counts)) if (!intros.includes(t)) for (let i = 0; i < n; i++) list.push(t);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    intros.forEach((t, k) => list.splice(Math.min(list.length, 3 + k * 8), 0, ...Array(counts[t]).fill(t)));

    // bosses: every 5th wave, more of them deep into a run
    const bosses = [];
    if (opts.final) {
      // the last wave of a mission: two bosses (the ones not seen yet come first); the
      // short starter missions end with just one
      for (let i = 0; i < (opts.finalBosses ?? 2); i++) bosses.push(this.nextBoss());
      for (const b of bosses) list.splice(Math.floor(list.length * (0.3 + r() * 0.4)), 0, b);
    } else if (wave % 5 === 0) {
      const n = 1 + Math.floor(Math.max(0, wave - 15) / 10);
      for (let i = 0; i < n; i++) bosses.push(this.nextBoss());
      for (const b of bosses) list.splice(Math.floor(list.length * (0.35 + r() * 0.3)), 0, b);
    }
    return { list, theme, themeName: T.name, intro, intros, boss: bosses[0] || null, bosses };
  }
}
