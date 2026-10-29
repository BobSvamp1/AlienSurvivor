// Player classes: each has its own weapon, its own set of traps / defenses and a perk.
// In co-op every player picks a class, so a team that mixes classes gets more tools.

export const CLASSES = {
  marine: {
    name: 'Marine',
    role: 'Assault',
    weapon: 'rifle',
    icon: 'rifle',
    desc: 'Frontline soldier. Holds the line with the Pulse Rifle and turns corridors into killing floors with spikes and launch pads.',
    perk: '+25 max health, 20% faster reload',
    build: ['barricade', 'spikes', 'launcher', 'gatling', 'mortar', 'generator'],
  },
  engineer: {
    name: 'Engineer',
    role: 'Builder',
    weapon: 'shotgun',
    icon: 'wrench',
    desc: 'Builds the heavy stuff: energy shields, laser fences and tesla coils. Close-range Scattergun for anything that gets through.',
    perk: 'Everything you build or upgrade costs 15% less',
    build: ['barricade', 'shield', 'laser', 'gatling', 'tesla', 'trap', 'generator'],
  },
  pyro: {
    name: 'Pyro',
    role: 'Area denial',
    weapon: 'flamer',
    icon: 'flamer',
    desc: 'Goo, fire and more fire. Sticky pools and flame vents for IGNITE combos, a flame turret and a Flamethrower that burns whole packs.',
    perk: 'Immune to acid pools and toxic clouds',
    build: ['barricade', 'goo', 'vent', 'spikes', 'flamer', 'tesla', 'generator'],
  },
  ranger: {
    name: 'Ranger',
    role: 'Sharpshooter',
    weapon: 'railgun',
    icon: 'crit',
    desc: 'Long-range specialist. The Rail Cannon pierces every alien in a line. Throws aliens into chasms and shells them with mortars.',
    perk: 'Double jetpack fuel, 8% faster',
    build: ['barricade', 'launcher', 'laser', 'spikes', 'mortar', 'gatling', 'generator'],
  },
};

export const CLASS_ORDER = ['marine', 'engineer', 'pyro', 'ranger'];

export function getClass(id) { return CLASSES[id] || CLASSES.marine; }

// what a class's perk changes in the local player's mods
export function classMods(id, mods) {
  if (id === 'marine') { mods.maxHpBonus += 25; mods.reloadMult *= 0.8; }
  if (id === 'ranger') { mods.jetMult *= 2; mods.speedMult *= 1.08; }
  if (id === 'pyro') mods.acidImmune = true;
  return mods;
}

// building cost factor of a class (the host applies it to whoever builds)
export function classCost(id) { return id === 'engineer' ? 0.85 : 1; }

// weapon stats; armory upgrades multiply them
export const WEAPONS = {
  rifle: { name: 'PULSE RIFLE', damage: 22, rate: 9, mag: 30, reload: 1.7, auto: true },
  shotgun: { name: 'SCATTERGUN', damage: 13, pellets: 9, rate: 1.5, mag: 8, reload: 2.3, auto: true, spread: 0.06, range: 34 },
  flamer: { name: 'FLAMETHROWER', damage: 95, rate: 20, mag: 100, reload: 1.9, auto: true, range: 9, cone: 0.32, burn: 14 },
  railgun: { name: 'RAIL CANNON', damage: 130, rate: 0.85, mag: 5, reload: 2.4, auto: false },
};
