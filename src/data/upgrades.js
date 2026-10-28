// Armory upgrades, bought between waves. They change the global "mods".

export const UPGRADE_TABS = [
  { id: 'weapon', name: 'Weapon' },
  { id: 'survival', name: 'Survival' },
  { id: 'defense', name: 'Defenses' },
  { id: 'core', name: 'Core' },
];

export const UPGRADES = [
  { id: 'dmg', tab: 'weapon', icon: 'damage', name: 'Hollow Points', desc: '+20% rifle damage', base: 100, max: 8 },
  { id: 'rate', tab: 'weapon', icon: 'rate', name: 'Rapid Cycler', desc: '+12% fire rate', base: 120, max: 6 },
  { id: 'mag', tab: 'weapon', icon: 'mag', name: 'Extended Mag', desc: '+8 rounds per magazine', base: 80, max: 5 },
  { id: 'reload', tab: 'weapon', icon: 'reload', name: 'Speed Loader', desc: '−15% reload time', base: 90, max: 4 },
  { id: 'crit', tab: 'weapon', icon: 'crit', name: 'Weak Point Scanner', desc: '+50% headshot damage', base: 140, max: 4 },
  { id: 'armor', tab: 'survival', icon: 'armor', name: 'Exo Plating', desc: '+25 max health', base: 100, max: 6 },
  { id: 'regen', tab: 'survival', icon: 'regen', name: 'Nanite Regen', desc: '+60% health regeneration', base: 110, max: 4 },
  { id: 'speed', tab: 'survival', icon: 'speed', name: 'Servo Boots', desc: '+7% movement speed', base: 90, max: 4 },
  { id: 'turretDmg', tab: 'defense', icon: 'turret', name: 'Overclocked Defenses', desc: '+18% damage for all defenses', base: 160, max: 6 },
  { id: 'structHp', tab: 'defense', icon: 'wall', name: 'Composite Armor', desc: '+20% health for all buildings', base: 130, max: 5 },
  { id: 'buildCost', tab: 'defense', icon: 'discount', name: 'Fabricator', desc: '−10% building & upgrade cost', base: 150, max: 3 },
  { id: 'repairAll', tab: 'defense', icon: 'repair', name: 'Repair Drones', desc: 'Repair every building to full health', base: 80, repeat: true },
  { id: 'reactor', tab: 'core', icon: 'power', name: 'Core Reactor', desc: '+5 power for your defenses', base: 140, max: 4 },
  { id: 'coreHp', tab: 'core', icon: 'core', name: 'Core Capacitors', desc: '+300 max core health', base: 140, max: 5 },
  { id: 'corePulse', tab: 'core', icon: 'pulse', name: 'Core Pulse', desc: 'The core blasts nearby aliens every few seconds', base: 220, max: 3 },
  { id: 'coreHeal', tab: 'core', icon: 'heal', name: 'Core Repair', desc: 'Restore 400 core health', base: 120, repeat: true },
];

export function computeMods(levels) {
  const L = (id) => levels[id] || 0;
  return {
    weaponDmg: 1 + 0.2 * L('dmg'),
    fireRate: 1 + 0.12 * L('rate'),
    magBonus: 8 * L('mag'),
    reloadMult: Math.pow(0.85, L('reload')),
    critMult: 2 + 0.5 * L('crit'),
    maxHpBonus: 25 * L('armor'),
    regenMult: 1 + 0.6 * L('regen'),
    speedMult: 1 + 0.07 * L('speed'),
    turretDmg: 1 + 0.18 * L('turretDmg'),
    structHp: 1 + 0.2 * L('structHp'),
    buildCost: 1 - 0.1 * L('buildCost'),
    coreMaxBonus: 300 * L('coreHp'),
    corePulse: L('corePulse'),
    reactor: 5 * L('reactor'),
  };
}
