// Armory upgrades, bought between waves. They change the global "mods".
import { classMods } from './classes.js';

export const UPGRADE_TABS = [
  { id: 'weapon', name: 'Weapon' },
  { id: 'survival', name: 'Survival' },
  { id: 'defense', name: 'Defenses' },
  { id: 'core', name: 'Core' },
];

export const UPGRADES = [
  { id: 'dmg', tab: 'weapon', icon: 'damage', name: 'Hollow Points', desc: '+15% weapon damage', base: 120, max: 4 },
  { id: 'rate', tab: 'weapon', icon: 'rate', name: 'Rapid Cycler', desc: '+10% fire rate', base: 130, max: 3 },
  { id: 'mag', tab: 'weapon', icon: 'mag', name: 'Extended Mag', desc: '+33% magazine / fuel', base: 90, max: 2 },
  { id: 'reload', tab: 'weapon', icon: 'reload', name: 'Speed Loader', desc: '−20% reload time', base: 90, max: 2 },
  { id: 'crit', tab: 'weapon', icon: 'crit', name: 'Weak Point Scanner', desc: '+50% headshot damage', base: 150, max: 2 },
  { id: 'armor', tab: 'survival', icon: 'armor', name: 'Exo Plating', desc: '+25 max health', base: 110, max: 3 },
  { id: 'regen', tab: 'survival', icon: 'regen', name: 'Nanite Regen', desc: '+60% health regeneration', base: 110, max: 2 },
  { id: 'speed', tab: 'survival', icon: 'speed', name: 'Servo Boots', desc: '+7% movement speed', base: 90, max: 2 },
  { id: 'jet', tab: 'survival', icon: 'jet', name: 'Jet Booster', desc: '+50% jetpack fuel', base: 100, max: 2 },
  { id: 'structHp', tab: 'defense', icon: 'wall', name: 'Composite Armor', desc: '+20% health for all buildings', base: 130, max: 3 },
  { id: 'buildCost', tab: 'defense', icon: 'discount', name: 'Fabricator', desc: '−10% building & upgrade cost', base: 180, max: 2 },
  { id: 'repairAll', tab: 'defense', icon: 'repair', name: 'Repair Drones', desc: 'Repair every building to full health (costs what repairing them one by one would, +15%)', base: 0, repeat: true },
  { id: 'reactor', tab: 'core', icon: 'power', name: 'Core Reactor', desc: '+5 power for your defenses', base: 150, max: 3 },
  { id: 'coreHp', tab: 'core', icon: 'core', name: 'Core Capacitors', desc: '+300 max core health', base: 150, max: 3 },
  { id: 'corePulse', tab: 'core', icon: 'pulse', name: 'Core Pulse', desc: 'The core blasts nearby aliens every few seconds', base: 220, max: 2 },
  { id: 'coreHeal', tab: 'core', icon: 'heal', name: 'Core Repair', desc: 'Restore 400 core health (gets pricier each time)', base: 120, repeat: true },
];

export function computeMods(levels, cls = null) {
  const L = (id) => levels[id] || 0;
  const mods = {
    weaponDmg: 1 + 0.15 * L('dmg'),
    fireRate: 1 + 0.1 * L('rate'),
    magMult: 1 + 0.33 * L('mag'),
    reloadMult: Math.pow(0.8, L('reload')),
    critMult: 2 + 0.5 * L('crit'),
    maxHpBonus: 25 * L('armor'),
    regenMult: 1 + 0.6 * L('regen'),
    speedMult: 1 + 0.07 * L('speed'),
    jetMult: 1 + 0.5 * L('jet'),
    turretDmg: 1, // defenses are upgraded one by one in the field (E), not globally
    structHp: 1 + 0.2 * L('structHp'),
    buildCost: 1 - 0.1 * L('buildCost'),
    coreMaxBonus: 300 * L('coreHp'),
    corePulse: L('corePulse'),
    reactor: 5 * L('reactor'),
  };
  return cls ? classMods(cls, mods) : mods;
}
