// Buildable defenses. Each has 3 levels; level 1 is bought with `cost`,
// later levels cost `levels[i].cost`. Upgrade them in-game by aiming at them and pressing E.

export const BUILDINGS = {
  barricade: {
    name: 'Barricade', short: 'Wall', cost: 25, solid: true, navCost: 10, rotatable: true,
    desc: 'Cheap armored wall: build a maze the swarm has to walk through (you can never seal the road completely). Repaired for free after every wave.',
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
    desc: 'Holographic barrier. Blocks aliens, lets your own bullets through and slowly recharges after 5 s without being hit. Needs power.',
    levels: [
      { hp: 380, regen: 12, power: 2 },
      { hp: 650, regen: 22, power: 3, cost: 120, note: 'Stronger field, faster recharge' },
      { hp: 1000, regen: 36, thorns: 10, power: 4, cost: 220, note: 'Overcharged: shocks attackers' },
    ],
  },

  // ---------------- traps (Orcs Must Die style) ----------------
  spikes: {
    name: 'Plasma Spikes', short: 'Spikes', cost: 60, solid: false, floor: true, rotatable: false,
    desc: 'Floor plate that stabs everything walking over it. Great after a Goo Pool or at the end of a Launcher throw.',
    levels: [
      { dmg: 40, rate: 0.9, power: 1 },
      { dmg: 65, rate: 1.1, power: 1, cost: 60, note: '+dmg, faster' },
      { dmg: 95, rate: 1.35, power: 1, cost: 110, note: 'Barbed: even more damage' },
    ],
  },
  goo: {
    name: 'Goo Pool', short: 'Goo', cost: 40, solid: false, floor: true, rotatable: false,
    desc: 'Sticky slime: aliens wade through it slowly and come out covered in fuel. Fire from Flame Vents makes gooey aliens explode in flames.',
    levels: [
      { slow: 0.45 },
      { slow: 0.33, cost: 40, note: 'Stickier' },
      { slow: 0.25, acid: 14, cost: 80, note: 'Acidic: also burns them' },
    ],
  },
  vent: {
    name: 'Flame Vent', short: 'Vent', cost: 110, solid: false, floor: true, rotatable: false,
    desc: 'Blasts fire up from the floor when aliens step on it. Combo: aliens covered in Goo IGNITE for huge damage that spreads.',
    levels: [
      { dmg: 30, burn: 10, rate: 0.6, radius: 1.4, power: 1 },
      { dmg: 45, burn: 16, rate: 0.75, radius: 1.6, power: 1, cost: 100, note: 'Hotter' },
      { dmg: 65, burn: 24, rate: 0.9, radius: 2.3, power: 2, cost: 160, note: 'Wide blast' },
    ],
  },
  launcher: {
    name: 'Gravity Launcher', short: 'Launch', cost: 140, solid: false, floor: true, rotatable: true, directional: true,
    desc: 'Flings aliens through the air the way it points (R to rotate). Throw them into chasms, onto Spikes or back where they came from!',
    levels: [
      { dist: 9, rate: 0.45, power: 1 },
      { dist: 11, rate: 0.6, power: 1, cost: 110, note: 'Further, faster' },
      { dist: 12, rate: 0.75, heavy: true, power: 2, cost: 180, note: 'Strong enough for heavy aliens' },
    ],
  },
  laser: {
    name: 'Laser Fence', short: 'Laser', cost: 120, solid: false, wall: true, rotatable: false,
    desc: 'Mounts on a wall and fires a laser straight across the corridor, hitting every alien in the line. Must be placed next to a wall or cliff.',
    levels: [
      { dmg: 26, rate: 1.0, range: 14, power: 2 },
      { dmg: 38, rate: 1.3, range: 16, power: 2, cost: 110, note: '+dmg, faster' },
      { dmg: 52, rate: 1.7, range: 18, power: 3, cost: 180, note: 'Overcharged beam' },
    ],
  },
};

// the Engineer's Sentry Drop ability (temporary, free, not on the hotbar)
BUILDINGS.sentry = {
  name: 'Sentry', short: 'Sentry', cost: 0, solid: true, navCost: 12, turret: true, range: 19, air: true, rotatable: false,
  desc: 'Temporary auto-turret dropped by an Engineer.',
  levels: [{ hp: 380, dmg: 11, rate: 9 }],
};

// Power the core provides on its own (more from generators and the Core Reactor upgrade)
export const CORE_POWER = 15;

// hotbar: keys 2-9 and 0
export const BUILD_ORDER = ['barricade', 'spikes', 'goo', 'vent', 'launcher', 'laser', 'gatling', 'tesla', 'generator'];
