import * as THREE from 'three';
import { groundAt } from '../world/elevation.js';
import { CLASSES } from '../data/classes.js';

// Class special abilities (key Q). The host runs everything that hurts aliens and
// tells the others what to show; a client only asks the host to cast.

export const ABILITIES = {
  marine: { id: 'airstrike', name: 'AIRSTRIKE', icon: 'airstrike', cd: 45, desc: 'Marks a spot: five heavy shells hit in a line across it a moment later.' },
  engineer: { id: 'sentry', name: 'SENTRY DROP', icon: 'sentry', cd: 50, desc: 'Drops a free auto-turret on the marked spot. It fights for 25 seconds.' },
  pyro: { id: 'napalm', name: 'NAPALM STRIKE', icon: 'napalm', cd: 40, desc: 'A fire shell hits the marked spot and leaves the ground burning for 8 seconds.' },
  ranger: { id: 'gravity', name: 'GRAVITY WELL', icon: 'gravity', cd: 45, desc: 'A singularity pulls every alien nearby into one spot for 4 seconds, then implodes. Pull them into a chasm!' },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class Abilities {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.cd = 0;
    this.timers = []; // host: delayed effects
    this.zones = []; // burning ground (host does damage, everyone shows it)
    this.wells = []; // gravity wells
    this.marks = []; // target markers
  }

  get def() { return ABILITIES[this.game.cls] || ABILITIES.marine; }
  get ready() { return this.cd <= 0; }

  // a scale so abilities keep up with tougher waves
  power() {
    const m = this.game.enemyMult ? this.game.enemyMult().hp : 1;
    return 0.55 + 0.45 * m;
  }

  // local player pressed Q
  use() {
    const game = this.game;
    const p = game.player;
    if (p.dead || !game.running) return;
    if (this.cd > 0) {
      game.hud.toast(`${this.def.name} ready in ${Math.ceil(this.cd)} s`, 'warn');
      game.audio.error();
      return;
    }
    // where the player aims (on the ground, up to 45 m away)
    _ray.setFromCamera({ x: 0, y: 0 }, game.r.camera);
    const hit = game.build.groundHit(_ray.ray, _v, 45);
    if (!hit) { game.audio.error(); return; }
    const dx = _v.x - p.pos.x, dz = _v.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 45) { _v.x = p.pos.x + (dx / d) * 45; _v.z = p.pos.z + (dz / d) * 45; }
    this.cd = this.def.cd;
    game.audio.ability(this.def.id);
    const msg = { a: 'ability', c: game.cls, x: Math.round(_v.x * 10) / 10, z: Math.round(_v.z * 10) / 10, yaw: Math.round(p.yaw * 100) / 100 };
    if (game.net.isClient) game.net.request(msg);
    else this.cast(game.cls, msg.x, msg.z, msg.yaw, 0);
  }

  // host: run an ability for a player of class cls at (x, z)
  cast(cls, x, z, yaw) {
    const game = this.game;
    const id = (ABILITIES[cls] || ABILITIES.marine).id;
    const color = CLASSES[cls] ? CLASSES[cls].color : '#ffb43d';
    const k = this.power();
    const mark = (t) => this.event({ k: 'abm', x, z, c: color, t });
    if (id === 'airstrike') {
      mark(1.6);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // along the player's view
      for (let i = 0; i < 5; i++) {
        const px = x + fx * (i - 2) * 3.2, pz = z + fz * (i - 2) * 3.2;
        this.timers.push({ t: 1.4 + i * 0.16, fn: () => this.boom(px, pz, 4, 150 * k, '#ffb43d', 1.2) });
      }
      this.event({ k: 'sound', n: 'incoming', p: [x, z] });
      this.sound('incoming', x, z);
    } else if (id === 'napalm') {
      mark(1.3);
      this.event({ k: 'sound', n: 'incoming', p: [x, z] });
      this.sound('incoming', x, z);
      this.timers.push({ t: 1.2, fn: () => {
        this.boom(x, z, 3.5, 60 * k, '#ff7a2a', 0.9);
        this.addZone({ x, z, r: 4.3, t: 8, dps: 38 * k });
      } });
    } else if (id === 'sentry') {
      const s = this.dropSentry(x, z);
      if (!s) { game.hud.toast('No room for a sentry there', 'warn'); this.cd = 0; return; }
      this.event({ k: 'boom', x: s.x, y: s.y + 0.5, z: s.z, r: 1.6, c: '#3de0ff', s: 0.4 });
      game.fx.explosion(_v.set(s.x, s.y + 0.5, s.z), '#3de0ff', 1.6);
      game.audio.build(s.group.position);
    } else if (id === 'gravity') {
      this.addWell({ x, z, t: 4, k });
    }
  }

  // ------------------------------------------------------------ effects
  event(e) { this.game.net.event(e); if (e.k === 'abm') this.marks.push({ x: e.x, z: e.z, c: e.c, t: e.t, t0: e.t }); }

  sound(n, x, z) { const a = this.game.audio; if (a[n]) a[n](_w.set(x, 0, z)); }

  boom(x, z, r, dmg, color, size) {
    const game = this.game;
    const y = groundAt(x, z);
    game.build.blast(x, z, dmg, r);
    this.event({ k: 'boom', x, y: y + 0.5, z, r, c: color, s: size });
    if (color !== '#ffb43d') game.fx.explosion(_v.set(x, y + 0.5, z), color, r * 0.8);
  }

  addZone(zn) {
    zn.t0 = zn.t;
    zn.tick = 0;
    this.zones.push(zn);
    if (this.game.net.isHost) this.event({ k: 'zone', x: zn.x, z: zn.z, r: zn.r, t: zn.t });
  }

  addWell(w) {
    w.t0 = w.t;
    this.wells.push(w);
    if (this.game.net.isHost) this.event({ k: 'well', x: w.x, z: w.z, t: w.t });
    this.sound('well', w.x, w.z);
  }

  // co-op client: show what the host says happened
  onEvent(e) {
    if (e.k === 'abm') this.marks.push({ x: e.x, z: e.z, c: e.c, t: e.t, t0: e.t });
    if (e.k === 'zone') this.zones.push({ x: e.x, z: e.z, r: e.r, t: e.t, t0: e.t, visual: true });
    if (e.k === 'well') { this.wells.push({ x: e.x, z: e.z, t: e.t, t0: e.t, visual: true }); this.sound('well', e.x, e.z); }
  }

  dropSentry(x, z) {
    const b = this.game.build;
    const nav = this.game.world.nav;
    const i0 = nav.ci(x), j0 = nav.cj(z);
    const prev = b.mode;
    b.mode = 'sentry';
    let best = null, bd = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = i0 + di, j = j0 + dj;
      if (!nav.inside(i, j) || b.invalidReason(i, j, nav.cx(i), nav.cz(j))) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = [i, j]; }
    }
    b.mode = prev;
    if (!best) return null;
    const s = b.place('sentry', best[0], best[1], 0);
    s.invested = 0;
    s.temp = 25;
    return s;
  }

  update(dt) {
    const game = this.game;
    if (this.cd > 0) this.cd = Math.max(0, this.cd - dt);
    const host = !game.net.isClient;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    // target markers: a shrinking ring and a beam of light
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t -= dt;
      if (m.t <= 0) { this.marks.splice(i, 1); continue; }
      if (Math.random() < dt * 12) game.fx.ring(m.x, m.z, 1 + 3 * (m.t / m.t0), m.c, 0.25);
      if (Math.random() < dt * 30) game.fx.trail(_v.set(m.x + (Math.random() - 0.5) * 0.4, groundAt(m.x, m.z) + Math.random() * 6, m.z + (Math.random() - 0.5) * 0.4), m.c);
    }
    // burning ground
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      zn.t -= dt;
      if (zn.t <= 0) { this.zones.splice(i, 1); continue; }
      const n = Math.ceil(dt * 40 * Math.min(1, zn.t));
      for (let q = 0; q < n; q++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * zn.r;
        const x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        game.fx.fire(_v.set(x, groundAt(x, z) + 0.1, z));
      }
      if (Math.random() < dt * 4) game.fx.flash(_v.set(zn.x, groundAt(zn.x, zn.z) + 1, zn.z), '#ff7a2a', 6, 0.3);
      if (host && !zn.visual) {
        zn.tick -= dt;
        if (zn.tick <= 0) {
          zn.tick = 0.25;
          for (const e of game.enemies.list) {
            if (e.dead || e.hidden) continue;
            if (e.def.flying && e.pos.y - groundAt(e.pos.x, e.pos.z) > 3) continue;
            if (Math.hypot(e.pos.x - zn.x, e.pos.z - zn.z) > zn.r + e.def.radius * 0.5) continue;
            game.enemies.damage(e, zn.dps * 0.25, { showNumber: Math.random() < 0.3 });
            e.burn = Math.max(e.burn, 2.5);
            e.burnDps = Math.max(e.burnDps || 0, 12);
          }
        }
      }
    }
    // gravity wells
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.t -= dt;
      const y = groundAt(w.x, w.z) + 1.2;
      // swirl
      for (let q = 0; q < 4; q++) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 8;
        game.fx.trail(_v.set(w.x + Math.cos(a) * r, y + (Math.random() - 0.3) * 1.5, w.z + Math.sin(a) * r), '#b07aff');
      }
      if (Math.random() < dt * 8) game.fx.ring(w.x, w.z, 9, '#b07aff', 0.3);
      game.fx.trail(_v.set(w.x, y, w.z), '#ffffff');
      if (host && !w.visual) {
        for (const e of game.enemies.list) {
          if (e.dead || e.hidden || e.def.boss || e.leap) continue;
          const dx = w.x - e.pos.x, dz = w.z - e.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 10 || d < 0.6) continue;
          const pull = (2.5 + 7 * (1 - d / 10)) * dt;
          e.pos.x += (dx / d) * pull;
          e.pos.z += (dz / d) * pull;
          e.slow = 0.3; e.slowF = Math.min(e.slowF || 1, 0.2);
          game.world.nav.pushOut(e.pos, e.def.radius * 0.85, 0.9);
        }
      }
      if (w.t <= 0) {
        this.wells.splice(i, 1);
        if (host && !w.visual) this.boom(w.x, w.z, 4.5, 170 * w.k, '#b07aff', 1.1);
      }
    }
  }
}
