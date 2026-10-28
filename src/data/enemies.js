// All alien types. hp/damage are scaled by wave number and difficulty.
// rig: describes how the procedural model is built and animated.

export const ENEMIES = {
  swarmling: {
    name: 'Swarmling',
    desc: 'Tiny, fast and always in packs. Weak alone, deadly in numbers.',
    hp: 14, speed: 7.8, dmg: 4, rate: 0.6, reward: 4, radius: 0.35, structDmg: 6, aggro: 10,
    colors: { skin: '#7a4a12', shell: '#d4952a', eye: '#ff5a2a', blood: '#ffb43d' },
    rig: { scale: 0.48, legs: 6, legLen: 1.0, bodyH: 0.62, abdomen: [1.0, 0.55], thorax: [0.5, 0.42], head: 0.36, ridges: 5 },
    pack: 4,
  },
  drone: {
    name: 'Drone',
    desc: 'The backbone of the swarm. Rushes the core and chews through anything in the way.',
    hp: 36, speed: 6.0, dmg: 7, rate: 0.9, reward: 9, radius: 0.6, structDmg: 12, aggro: 12,
    colors: { skin: '#2c1a40', shell: '#5d3a8a', eye: '#7dff6a', blood: '#8dff5a' },
    rig: { scale: 0.9, legs: 6, legLen: 1.1, bodyH: 0.66, abdomen: [1.0, 0.58], thorax: [0.55, 0.44], head: 0.38, ridges: 6 },
  },
  spitter: {
    name: 'Spitter',
    desc: 'Stops at range and lobs acid at you and your defenses. Kill it before it settles in.',
    hp: 52, speed: 3.8, dmg: 9, rate: 2.2, reward: 15, radius: 0.7, structDmg: 14, aggro: 18, range: 16,
    colors: { skin: '#24401f', shell: '#4f7a32', eye: '#ffe14d', blood: '#d8ff3d' },
    rig: { scale: 1.0, legs: 6, legLen: 1.15, bodyH: 0.7, abdomen: [1.05, 0.6], thorax: [0.52, 0.42], head: 0.36, ridges: 5, sac: '#d8ff3d' },
  },
  leaper: {
    name: 'Leaper',
    desc: 'Long-legged hunter. Pounces on players from a distance and can jump over your walls.',
    hp: 60, speed: 5.4, dmg: 16, rate: 1.0, reward: 18, radius: 0.6, structDmg: 12, aggro: 16, leapRange: 10,
    colors: { skin: '#1a2a3a', shell: '#2e6a8a', eye: '#3dffe8', blood: '#3dffd0' },
    rig: { scale: 0.95, legs: 6, legLen: 1.6, bodyH: 0.95, abdomen: [0.85, 0.42], thorax: [0.6, 0.36], head: 0.34, ridges: 7, spikes: true },
  },
  bloater: {
    name: 'Bloater',
    desc: 'A walking bomb. Explodes on contact, wrecking walls. Shoot it from far away, not near your base.',
    hp: 110, speed: 2.7, dmg: 45, rate: 1, reward: 20, radius: 0.95, structDmg: 260, aggro: 8, explodeRadius: 4.5,
    colors: { skin: '#3a2a18', shell: '#6a4a24', eye: '#ffa03d', blood: '#ffcf5a' },
    rig: { scale: 1.15, legs: 6, legLen: 1.0, bodyH: 0.8, abdomen: [1.3, 0.95], thorax: [0.5, 0.42], head: 0.34, ridges: 3, bomb: '#ff9a2a' },
  },
  wasp: {
    name: 'Stinger',
    desc: 'Flies straight over your walls. Hunts players and turrets from the air.',
    hp: 40, speed: 7.2, dmg: 8, rate: 1.1, reward: 14, radius: 0.6, structDmg: 16, aggro: 30, flying: true, hover: 3.6,
    colors: { skin: '#3a2a0a', shell: '#e8b81d', eye: '#ff3d3d', blood: '#ffe14d' },
    rig: { scale: 0.85, legs: 4, legLen: 0.9, bodyH: 0, abdomen: [1.0, 0.45], thorax: [0.5, 0.38], head: 0.32, ridges: 6, wings: true, stinger: true },
  },
  serpent: {
    name: 'Serpent',
    desc: 'A fast, low snake that slithers through gaps in your defenses. Hard to hit, easy to kill.',
    hp: 46, speed: 8.4, dmg: 9, rate: 0.8, reward: 12, radius: 0.5, structDmg: 14, aggro: 10, rigType: 'segment',
    colors: { skin: '#16301f', shell: '#3d8a5a', eye: '#ffe14d', blood: '#9aff5a' },
    rig: { scale: 1.0, segments: 12, segLen: 0.42, radius: 0.3, head: 0.42, frill: true, undulate: 1.2 },
  },
  burrower: {
    name: 'Burrower',
    desc: 'A giant worm that tunnels underground, straight under your walls, and bursts up inside your base.',
    hp: 170, speed: 4.6, dmg: 18, rate: 1.1, reward: 32, radius: 0.85, structDmg: 45, aggro: 8, rigType: 'segment', burrows: true,
    colors: { skin: '#3a2216', shell: '#8a5a3a', eye: '#ff8a3d', blood: '#ffb43d' },
    rig: { scale: 1.6, segments: 10, segLen: 0.5, radius: 0.48, head: 0.6, maw: true, plates: true, undulate: 0.35 },
  },
  ravager: {
    name: 'Ravager',
    desc: 'A two-legged predator. Extremely fast, hunts players from far away and pounces.',
    hp: 95, speed: 8.6, dmg: 17, rate: 0.85, reward: 22, radius: 0.7, structDmg: 16, aggro: 26, leapRange: 9, rigType: 'biped',
    colors: { skin: '#24161f', shell: '#8a2a4a', eye: '#ff3d6a', blood: '#ff6a8a' },
    rig: { scale: 1.25, legLen: 1.0, bodyH: 1.0 },
  },
  floater: {
    name: 'Floater',
    desc: 'A drifting jelly that drops acid on your buildings from above. Bursts into a toxic cloud when killed.',
    hp: 85, speed: 2.8, dmg: 10, rate: 2.3, reward: 20, radius: 1.1, structDmg: 45, aggro: 30, flying: true, hover: 6.5, floater: true, rigType: 'jelly',
    colors: { skin: '#3a1a5a', shell: '#9a5aff', eye: '#ff9aff', blood: '#d08aff' },
    rig: { scale: 1.3 },
  },
  bulwark: {
    name: 'Bulwark',
    desc: 'A heavy beetle with a front shield: blocks 75% of damage from the front and half of all explosions. Flank it!',
    hp: 380, speed: 2.3, dmg: 30, rate: 1.5, reward: 50, radius: 1.4, structDmg: 70, aggro: 9, shield: true,
    colors: { skin: '#14191e', shell: '#4a6a7a', eye: '#7af0ff', blood: '#7af0ff' },
    rig: { scale: 1.9, legs: 6, legLen: 0.95, bodyH: 0.7, abdomen: [1.1, 0.72], thorax: [0.7, 0.55], head: 0.42, ridges: 4, plates: true, shield: true },
  },
  brute: {
    name: 'Crusher',
    desc: 'Armored tank. Slow, but it smashes walls and turrets in a few hits.',
    hp: 300, speed: 2.5, dmg: 26, rate: 1.4, reward: 45, radius: 1.3, structDmg: 80, aggro: 10,
    colors: { skin: '#3a1612', shell: '#9a3a22', eye: '#ff5a2e', blood: '#ff9a3d' },
    rig: { scale: 1.75, legs: 6, legLen: 1.05, bodyH: 0.72, abdomen: [1.05, 0.65], thorax: [0.7, 0.55], head: 0.45, ridges: 4, plates: true, horns: true },
  },
  queen: {
    name: 'Brood Queen',
    desc: 'Boss. A huge mother that constantly births swarmlings while marching on the core.',
    hp: 2400, speed: 1.8, dmg: 45, rate: 1.6, reward: 400, radius: 2.4, structDmg: 140, aggro: 14, boss: true,
    colors: { skin: '#1e1030', shell: '#7a2a9a', eye: '#ff3df0', blood: '#ff6af5' },
    rig: { scale: 3.2, legs: 6, legLen: 1.25, bodyH: 0.75, abdomen: [1.6, 0.8], thorax: [0.6, 0.48], head: 0.42, ridges: 8, crown: true, sac: '#ff6af5' },
  },
  titan: {
    name: 'Hive Titan',
    desc: 'Boss. A living siege engine. Its ground slam flattens everything nearby.',
    hp: 5200, speed: 1.6, dmg: 40, rate: 2.0, reward: 700, radius: 2.8, structDmg: 200, aggro: 12, boss: true, slamRadius: 7,
    colors: { skin: '#2a2c33', shell: '#46586b', eye: '#ff2a2a', blood: '#ff5a3d' },
    rig: { scale: 3.6, legs: 6, legLen: 1.15, bodyH: 0.8, abdomen: [1.1, 0.7], thorax: [0.8, 0.6], head: 0.5, ridges: 5, plates: true, horns: true },
  },
};

export const ENEMY_ORDER = ['swarmling', 'drone', 'spitter', 'leaper', 'bloater', 'wasp', 'serpent', 'burrower', 'ravager', 'floater', 'bulwark', 'brute', 'queen', 'titan'];

// Which enemies show up in a wave
export function waveComposition(wave, bias = {}, countMult = 1) {
  const list = [];
  const add = (type, n) => {
    const b = bias[type] || 1;
    const c = Math.round(n * b * countMult);
    for (let i = 0; i < c; i++) list.push(type);
  };
  add('drone', 4 + wave * 2.6);
  if (wave >= 2) add('swarmling', Math.floor(wave / 2) * 4);
  if (wave >= 2) add('spitter', (wave - 1) * 1.1);
  if (wave >= 3) add('leaper', (wave - 2) * 0.8);
  if (wave >= 4) add('wasp', (wave - 3) * 0.9);
  if (wave >= 4) add('bloater', (wave - 3) * 0.5);
  if (wave >= 3) add('brute', (wave - 2) * 0.45);
  if (wave >= 3) add('serpent', (wave - 2) * 1.2);
  if (wave >= 3) add('ravager', (wave - 2) * 0.5);
  if (wave >= 4) add('burrower', (wave - 3) * 0.45);
  if (wave >= 5) add('floater', (wave - 4) * 0.5);
  if (wave >= 5) add('bulwark', (wave - 4) * 0.4);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (wave % 10 === 0) list.splice(Math.floor(list.length * 0.4), 0, 'titan');
  else if (wave % 5 === 0) list.splice(Math.floor(list.length * 0.4), 0, 'queen');
  return list;
}
