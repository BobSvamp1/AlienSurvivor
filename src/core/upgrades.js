import { UPGRADES, computeMods } from '../data/upgrades.js';

export class Upgrades {
  constructor(game) {
    this.game = game;
    this.levels = {};
  }

  reset() {
    this.levels = {};
    this.game.mods = computeMods(this.levels, this.game.cls);
  }

  level(id) { return this.levels[id] || 0; }
  def(id) { return UPGRADES.find((u) => u.id === id); }

  cost(id) {
    const u = this.def(id);
    if (u.repeat) return Math.round((u.base * (1 + 0.35 * this.level(id))) / 5) * 5;
    return Math.round((u.base * Math.pow(1.55, this.level(id))) / 5) * 5;
  }

  canBuy(id) {
    const u = this.def(id);
    const g = this.game;
    if (!u.repeat && this.level(id) >= u.max) return false;
    if (id === 'coreHeal' && g.core.hp >= g.core.maxHp) return false;
    if (id === 'repairAll' && !g.build.structures.some((s) => isFinite(s.hp) && s.hp < s.maxHp)) return false;
    return g.credits >= this.cost(id);
  }

  buy(id) {
    const g = this.game;
    if (!this.canBuy(id)) { g.audio.error(); return false; }
    if (g.net.isClient) {
      // co-op: the team shares crystals and upgrades; the host applies the purchase
      g.net.request({ a: 'buy', id });
      g.credits -= this.cost(id);
      this.levels[id] = this.level(id) + 1;
      g.mods = computeMods(this.levels, g.cls);
      if (id === 'mag') g.weapon.ammo = g.weapon.stats.mag;
      g.audio.buy();
      return true;
    }
    const cost = this.cost(id);
    g.credits -= cost;
    this.levels[id] = this.level(id) + 1;
    const before = g.mods;
    g.mods = computeMods(this.levels, g.cls);
    if (id === 'armor') g.player.hp += 25;
    if (id === 'coreHp') { g.core.maxHp += 300; g.core.hp += 300; }
    if (id === 'coreHeal') g.core.hp = Math.min(g.core.maxHp, g.core.hp + 400);
    if (id === 'repairAll') for (const s of g.build.structures) if (isFinite(s.hp)) s.hp = s.maxHp;
    if (id === 'structHp') {
      const k = g.mods.structHp / before.structHp;
      for (const s of g.build.structures) if (isFinite(s.maxHp)) { s.maxHp *= k; s.hp *= k; }
    }
    if (id === 'mag') g.weapon.ammo = g.weapon.stats.mag;
    if (id === 'reactor') g.build.updatePower();
    g.audio.buy();
    return true;
  }
}
