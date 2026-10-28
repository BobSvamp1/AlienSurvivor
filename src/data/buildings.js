// Buildable defenses. Each has 3 levels; level 1 is bought with `cost`,
// later levels cost `levels[i].cost`. Upgrade them in-game by aiming at them and pressing E.

export const BUILDINGS = {
  barricade: {
    name: 'Barricade', short: 'Wall', cost: 25, solid: true, navCost: 10, rotatable: true,
    desc: 'Cheap armored wall. Aliens walk around it if they can, or chew through it if they must.',
    levels: [
      { hp: 420 },
      { hp: 800, cost: 45, note: 'Reinforced plating' },
      { hp: 1300, thorns: 14, cost: 90, note: 'Spiked: hurts attackers' },
    ],
  },
  gatling: {
    name: 'Gatling Turret', short: 'Gatling', cost: 150, solid: true, navCost: 12, turret: true, rotatable: true, range: 20, air: true,
    desc: 'Fast-firing all-round turret. Hits flying aliens too.',
    levels: [
      { hp: 260, dmg: 9, rate: 7, power: 3 },
      { hp: 340, dmg: 12, rate: 9, power: 4, cost: 130, note: '+dmg, +fire rate' },
      { hp: 440, dmg: 14, rate: 13, twin: true, power: 5, cost: 240, note: 'Twin barrels' },
    ],
  },
  flamer: {
    name: 'Flamethrower', short: 'Flamer', cost: 200, solid: true, navCost: 12, turret: true, rotatable: true, directional: true,
    range: 9, arc: 75,
    desc: 'Sprays fire in the direction it faces (rotate with R). Sets aliens on fire.',
    levels: [
      { hp: 320, dps: 55, burn: 12, power: 4 },
      { hp: 420, dps: 75, burn: 18, power: 5, cost: 160, note: '+dmg, longer burn' },
      { hp: 540, dps: 105, burn: 26, range: 11, power: 6, cost: 270, note: '+range, napalm' },
    ],
  },
  tesla: {
    name: 'Tesla Coil', short: 'Tesla', cost: 250, solid: true, navCost: 12, turret: true, range: 13, air: true,
    desc: 'Lightning that jumps between several aliens. Great against swarms.',
    levels: [
      { hp: 240, dmg: 26, chains: 3, rate: 1.0, power: 5 },
      { hp: 320, dmg: 36, chains: 4, rate: 1.25, power: 6, cost: 190, note: '+1 chain, faster' },
      { hp: 420, dmg: 48, chains: 6, rate: 1.5, stun: true, power: 8, cost: 320, note: '+2 chains, stuns' },
    ],
  },
  mortar: {
    name: 'Mortar', short: 'Mortar', cost: 350, solid: true, navCost: 12, turret: true, range: 42, minRange: 11,
    desc: 'Long-range artillery. Very slow shells and power hungry, but each hit blows up a group. Cannot hit anything close by.',
    levels: [
      { hp: 220, dmg: 60, radius: 3.4, rate: 0.22, power: 8 },
      { hp: 300, dmg: 85, radius: 3.9, rate: 0.28, power: 10, cost: 260, note: '+dmg, bigger blast' },
      { hp: 380, dmg: 115, radius: 4.6, rate: 0.34, cluster: true, power: 12, cost: 400, note: 'Cluster shells' },
    ],
  },
  trap: {
    name: 'Shock Trap', short: 'Trap', cost: 75, solid: false, rotatable: false,
    desc: 'Electric floor plate. Slows and shocks every alien that walks over it.',
    levels: [
      { dps: 30, slow: 0.45, power: 1 },
      { dps: 48, slow: 0.35, power: 2, cost: 70, note: '+dmg, stronger slow' },
      { dps: 70, slow: 0.25, power: 3, cost: 120, note: 'Overcharged' },
    ],
  },
  generator: {
    name: 'Generator', short: 'Power', cost: 120, solid: true, navCost: 12, rotatable: false,
    desc: 'Produces power for your defenses. Protect it: if it is destroyed, turrets shut down.',
    levels: [
      { hp: 200, supply: 6 },
      { hp: 280, supply: 10, cost: 140, note: '+4 power' },
      { hp: 380, supply: 15, cost: 220, note: '+5 power' },
    ],
  },
  shield: {
    name: 'Energy Shield', short: 'Shield', cost: 140, solid: true, navCost: 14, rotatable: true,
    desc: 'Holographic barrier. Blocks aliens, lets your own bullets through and recharges when it is not being hit. Needs power.',
    levels: [
      { hp: 380, regen: 30, power: 2 },
      { hp: 650, regen: 50, power: 3, cost: 120, note: 'Stronger field, faster recharge' },
      { hp: 1000, regen: 80, thorns: 10, power: 4, cost: 220, note: 'Overcharged: shocks attackers' },
    ],
  },
};

// Power the core provides on its own (more from generators and the Core Reactor upgrade)
export const CORE_POWER = 15;

export const BUILD_ORDER = ['barricade', 'gatling', 'flamer', 'tesla', 'mortar', 'trap', 'generator', 'shield'];
