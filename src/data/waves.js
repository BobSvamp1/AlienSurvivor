// Wave planner: endless waves that get harder and differ from run to run.
//
// - New alien types are introduced one at a time (one per wave from wave 2), in a
//   shuffled order per run, so you learn them one by one.
// - Each wave has a theme (mixed, swarm, armored, air raid, hunters, siege) and only
//   uses a handful of the unlocked types, so waves feel different from each other.
// - A point budget grows every wave; bosses come every 5 waves and more of them later.

import { mulberry32 } from '../core/rng.js';

const COST = {
  swarmling: 0.6, drone: 1, serpent: 1.4, spitter: 2, wasp: 2, leaper: 2.4, bloater: 3,
  ravager: 3.4, burrower: 4, floater: 4, bulwark: 6.5, brute: 6,
};

// introduction order is shuffled inside each tier
const TIERS = [
  ['swarmling', 'spitter', 'serpent'],
  ['leaper', 'wasp', 'bloater', 'ravager'],
  ['burrower', 'floater', 'brute', 'bulwark'],
];

export const THEMES = {
  mixed: { name: '', types: null, weight: 3 },
  swarm: { name: 'SWARM', types: ['swarmling', 'serpent', 'drone', 'leaper', 'ravager'], weight: 1, countBoost: 1.15 },
  heavy: { name: 'ARMORED', types: ['brute', 'bulwark', 'drone', 'bloater', 'spitter'], weight: 1 },
  air: { name: 'AIR RAID', types: ['wasp', 'floater', 'drone'], weight: 1 },
  hunters: { name: 'HUNTERS', types: ['leaper', 'ravager', 'serpent', 'wasp', 'drone'], weight: 1 },
  siege: { name: 'SIEGE', types: ['spitter', 'bloater', 'brute', 'burrower', 'floater', 'drone'], weight: 1 },
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
    this.firstBoss = r() < 0.5 ? 'queen' : 'titan';
    this.lastTheme = 'mixed';
  }

  // the alien type introduced on this wave (or null)
  introOf(wave) {
    const i = wave - 2;
    return i >= 0 && i < this.order.length ? this.order[i] : null;
  }

  unlocked(wave) {
    return ['drone', ...this.order.slice(0, Math.max(0, wave - 1))];
  }

  plan(wave, countMult = 1, opts = {}) {
    const r = this.rng;
    const intro = this.introOf(wave);
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
    const chosen = pool.slice(0, kinds).filter((t) => t !== intro);

    const counts = {};
    const spend = (type, pts) => {
      const n = Math.max(1, Math.round((pts * (this.bias[type] || 1)) / COST[type]));
      counts[type] = (counts[type] || 0) + n;
    };
    // a new alien gets a big, clear group so you notice it
    if (intro) spend(intro, budget * 0.28);
    const rest = budget * (intro ? 0.72 : 1);
    const droneShare = theme === 'air' ? 0.15 : T.types && !T.types.includes('drone') ? 0 : chosen.length ? 0.3 : 1;
    if (droneShare) spend('drone', rest * droneShare);
    if (chosen.length) {
      const w = chosen.map(() => 0.5 + r());
      const ws = w.reduce((a, b) => a + b, 0);
      chosen.forEach((t, i) => spend(t, (rest * (1 - droneShare) * w[i]) / ws));
    }

    // spawn order: shuffled, with the new alien arriving as one pack near the start
    let list = [];
    for (const [t, n] of Object.entries(counts)) if (t !== intro) for (let i = 0; i < n; i++) list.push(t);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    if (intro) list.splice(Math.min(list.length, 3), 0, ...Array(counts[intro]).fill(intro));

    // bosses: every 5th wave, more of them deep into a run
    const bosses = [];
    if (opts.final) {
      // the last wave of a mission: both bosses
      bosses.push(this.firstBoss, this.firstBoss === 'queen' ? 'titan' : 'queen');
      for (const b of bosses) list.splice(Math.floor(list.length * (0.3 + r() * 0.4)), 0, b);
    } else if (wave % 5 === 0) {
      const n = 1 + Math.floor(Math.max(0, wave - 15) / 10);
      for (let i = 0; i < n; i++) {
        const k = wave / 5 + i;
        // the Queen comes first (wave 5), the Titan at wave 10, then it varies
        bosses.push(wave === 5 ? 'queen' : wave === 10 ? 'titan' : k % 2 === 1 ? this.firstBoss : this.firstBoss === 'queen' ? 'titan' : 'queen');
      }
      for (const b of bosses) list.splice(Math.floor(list.length * (0.35 + r() * 0.3)), 0, b);
    }
    return { list, theme, themeName: T.name, intro, boss: bosses[0] || null };
  }
}
