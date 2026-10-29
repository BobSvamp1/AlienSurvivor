import * as THREE from 'three';
import { ENEMIES } from '../data/enemies.js';
import { BugRig, flushLegs } from './bugRig.js';
import { groundAt, CLIMB } from '../world/elevation.js';
import { PIT } from '../world/nav.js';
import { SegmentRig, BipedRig, JellyRig } from './rigs.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const HASH = 4;
const ROCK_CAP = 0.9; // big aliens squeeze past rocks instead of wedging
const _dir = { x: 0, z: 0, cell: -1 };
const barGeo = new THREE.PlaneGeometry(1, 0.1);
const barFgGeo = new THREE.PlaneGeometry(1, 0.1).translate(0.5, 0, 0);
const barBgMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
const barFgMat = new THREE.MeshBasicMaterial({ color: 0xff4a5a, depthWrite: false, fog: false, toneMapped: false });
const projGeo = new THREE.SphereGeometry(0.22, 12, 8);

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.projectiles = [];
    this.hitMeshes = [];
    this.projMat = new THREE.MeshStandardMaterial({ color: '#d8ff3d', emissive: '#b8ff2d', emissiveIntensity: 3 });
    this.clouds = [];
  }

  get scene() { return this.game.r.scene; }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (!e.dead) n++;
    return n;
  }

  byNid(n) {
    for (const e of this.list) if (e.nid === n) return e;
    return null;
  }

  get boss() {
    return this.list.find((e) => e.def.boss && !e.dead) || null;
  }

  clear() {
    for (const e of this.list) this.removeVisual(e);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.list = [];
    this.projectiles = [];
    this.hitMeshes = [];
    this.clouds = [];
    flushLegs();
  }

  removeVisual(e) {
    e.rig.dispose();
    this.scene.remove(e.bar);
  }

  rebuildHitList() {
    this.hitMeshes = [];
    for (const e of this.list) if (!e.dead && !e.hidden) for (const m of e.rig.hitMeshes) this.hitMeshes.push(m);
  }

  spawn(type, x, z, mult = { hp: 1, dmg: 1 }, fromHive = true, opts = {}) {
    const def = ENEMIES[type];
    const Rig = def.rigType === 'segment' ? SegmentRig : def.rigType === 'biped' ? BipedRig : def.rigType === 'jelly' ? JellyRig : BugRig;
    const rig = new Rig(type, def, this.scene);
    const gy = groundAt(x, z);
    rig.root.position.set(x, gy + (def.flying ? def.hover : 0), z);
    rig.root.rotation.y = Math.atan2(-(this.game.core.pos.x - x), -(this.game.core.pos.z - z));
    const e = {
      type, def, rig,
      pos: rig.root.position,
      vel: new THREE.Vector3(),
      yaw: rig.root.rotation.y,
      hp: def.hp * mult.hp, maxHp: def.hp * mult.hp, dmgMult: mult.dmg, spdMult: mult.spd || 1,
      attackCd: 0.5 + Math.random() * 0.5,
      slow: 0, burn: 0, burnDps: 0, shock: 0,
      spawnT: fromHive ? 0 : 1,
      dead: false, deadT: 0,
      leap: null, leapCd: 2 + Math.random() * 2,
      slamT: 0, slamCd: 4,
      broodCd: 6,
      stuckT: 0,
      target: null,
    };
    for (const m of rig.hitMeshes) m.userData.enemy = e;
    e.spawnY = gy;
    if (fromHive) rig.root.position.y = gy + (def.flying ? 0.5 : -1.2 * rig.s);

    const bar = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, barBgMat);
    const fg = new THREE.Mesh(barFgGeo, def.boss ? new THREE.MeshBasicMaterial({ color: 0xff3df0, depthWrite: false, fog: false, toneMapped: false }) : barFgMat);
    fg.position.set(-0.5, 0, 0.001);
    bar.add(bg, fg);
    const w = Math.max(0.8, def.radius * 1.6);
    bar.scale.set(w, Math.max(1, def.radius), 1);
    bar.visible = false;
    bar.renderOrder = 5;
    this.scene.add(bar);
    e.bar = bar;
    e.barFill = fg;
    e.barH = def.rigType === 'segment' ? rig.baseH + def.rig.head * rig.s + 0.6
      : def.rigType === 'biped' ? rig.baseH + 0.9 * rig.s
      : def.rigType === 'jelly' ? 1.2 * rig.s
      : (def.flying ? 0.9 : def.rig.bodyH * def.rig.legLen + def.rig.thorax[1] * 2.2) * def.rig.scale + 0.5;

    e.nid = opts.nid || (this.nidSeq = (this.nidSeq || 0) + 1);
    // some aliens take the second route, so the swarm splits up over several corridors
    e.route = false;
    if (fromHive && !opts.mirror && !def.flying && !def.boss) {
      const nav = this.game.world.nav;
      let hi = -1, hd = Infinity;
      nav.hives.forEach(([hx, hz], i) => { const d = Math.hypot(hx - x, hz - z); if (d < hd) { hd = d; hi = i; } });
      if (hi >= 0 && nav.routeOk[hi] && Math.random() < 0.42) e.route = true;
    }
    if (def.burrows && !opts.mirror) this.startBurrow(e);

    this.list.push(e);
    this.rebuildHitList();
    if (fromHive) this.game.audio.alienEmerge(e.pos);
    if (def.boss && fromHive) this.game.audio.alienRoar(e);
    if (opts.mirror) {
      e.mirror = { x, y: e.pos.y, z, yaw: e.yaw };
      e.hp = e.maxHp = 1;
    }
    return e;
  }

  damage(e, amount, opts = {}) {
    if (e.dead || e.hidden) return 0;
    if (this.game.net.isClient) {
      // co-op client: the host owns alien health; just show the hit
      if (opts.showNumber !== false) { e.rig.flash = 0.06; e.rig.hitKick = 1; this.game.fx.damageNumber(e.pos.x, e.pos.y + e.barH - 0.3, e.pos.z, amount, opts.crit); }
      return 0;
    }
    if (e.def.shield) {
      if (opts.explosive) amount *= 0.5;
      if (opts.from) {
        const dx = opts.from.x - e.pos.x, dz = opts.from.z - e.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const facing = (-Math.sin(e.yaw) * dx - Math.cos(e.yaw) * dz) / d; // 1 = straight in front
        if (facing > 0.45) {
          amount *= 0.25;
          if (opts.showNumber !== false && Math.random() < 0.5) this.game.fx.burst(_v.set(e.pos.x + dx / d * 1.5, e.pos.y + 1.2, e.pos.z + dz / d * 1.5), '#ffe0a0', 4, 4, 0.05);
        }
      }
    }
    const dealt = Math.min(e.hp, amount);
    e.hp -= amount;
    if (opts.showNumber !== false) {
      e.rig.flash = 0.06;
      e.rig.hitKick = 1;
    }
    this.game.stats.damage += dealt;
    if (opts.showNumber !== false) this.game.fx.damageNumber(e.pos.x, e.pos.y + e.barH - 0.3, e.pos.z, amount, opts.crit);
    if (e.hp <= 0) this.kill(e, opts);
    else if (opts.showNumber !== false) this.game.audio.alienHurt(e);
    return dealt;
  }

  kill(e, opts = {}) {
    const game = this.game;
    e.dead = true;
    e.deadT = 0;
    e.rig.die(Math.random() < 0.5 ? -1 : 1);
    e.bar.visible = false;
    game.addCredits(e.def.reward * 0.75);
    game.stats.kills++;
    const p = _v.set(e.pos.x, e.pos.y + e.rig.baseH, e.pos.z);
    game.fx.burst(p, e.def.colors.blood, e.def.boss ? 70 : 18, 7, 0.14);
    game.fx.burst(p, e.def.colors.shell, e.def.boss ? 30 : 6, 5, 0.18);
    game.fx.splat(e.pos.x, e.pos.z, e.def.colors.blood, e.def.rig.scale * 1.4);
    if (!game.audio.alienDeath(e) || e.def.boss) game.audio.squish(e.def.boss, e.pos);
    if (e.def.explodeRadius) this.explode(e);
    if (e.def.flying) e.fallV = 0;
    if (e.def.floater) this.clouds.push({ x: e.pos.x, z: e.pos.z, r: 3.6, t: 6, tick: 0 });
    this.rebuildHitList();
  }

  explode(e) {
    const game = this.game;
    const r = e.def.explodeRadius;
    const p = _w.set(e.pos.x, e.pos.y + 0.8, e.pos.z);
    game.fx.explosion(p, '#ff9a2a', r);
    game.audio.explosion(e.pos);
    game.shake(0.6, e.pos);
    // damage buildings and players around
    game.build.damageArea(e.pos.x, e.pos.z, r, e.def.structDmg * e.dmgMult);
    for (const pl of game.players) {
      if (pl.dead) continue;
      const d = Math.hypot(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z);
      if (d < r) pl.hurt(e.def.dmg * e.dmgMult * (1 - d / r * 0.5), e.pos);
    }
    const dc = Math.hypot(game.core.pos.x - e.pos.x, game.core.pos.z - e.pos.z);
    if (dc < r + game.core.radius) game.damageCore(e.def.dmg * e.dmgMult * 2, e.pos);
    // also hurts other aliens a little
    for (const o of this.list) {
      if (o === e || o.dead) continue;
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < r) this.damage(o, 40, { showNumber: false, explosive: true });
    }
  }

  // ------------------------------------------------------------ spatial hash
  // Ground aliens bucketed into 4 m cells so separation only checks close neighbours
  buildHash() {
    const H = this.hash || (this.hash = new Map());
    for (const b of H.values()) b.length = 0;
    for (const o of this.list) {
      if (o.dead || o.hidden || o.def.flying || o.leap) continue;
      const k = (Math.floor(o.pos.x / HASH) + 512) * 4096 + (Math.floor(o.pos.z / HASH) + 512);
      let b = H.get(k);
      if (!b) H.set(k, (b = []));
      b.push(o);
    }
  }

  neighbours(e) {
    const out = this._near || (this._near = []);
    out.length = 0;
    const span = e.def.radius > 1.2 ? 2 : 1;
    const ci = Math.floor(e.pos.x / HASH), cj = Math.floor(e.pos.z / HASH);
    for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
      const b = this.hash.get((i + 512) * 4096 + (j + 512));
      if (b) for (let n = 0; n < b.length; n++) out.push(b[n]);
    }
    return out;
  }

  // ------------------------------------------------------------ AI
  update(dt) {
    this.updateAI(dt);
    flushLegs();
  }

  updateLegs() { flushLegs(); }

  updateAI(dt) {
    const game = this.game;
    const nav = game.world.nav;
    const core = game.core;
    const list = this.list;
    this.frame = (this.frame || 0) + 1;
    this.buildHash();
    const cq = game.r.camera.quaternion;
    _v.set(0, 0, -1).applyQuaternion(cq);
    const fl = Math.hypot(_v.x, _v.z) || 1;
    this.camFx = _v.x / fl; this.camFz = _v.z / fl;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const def = e.def;

      if (e.dead) {
        e.deadT += dt;
        const gy = groundAt(e.pos.x, e.pos.z);
        if (e.pos.y > gy) {
          e.fallV = (e.fallV || 0) + 20 * dt;
          e.pos.y = Math.max(gy, e.pos.y - e.fallV * dt);
        }
        e.rig.update(dt, e.vel.multiplyScalar(0.9), 0);
        if (e.deadT > 4.5) {
          this.removeVisual(e);
          list.splice(i, 1);
        }
        continue;
      }

      if (e.burrow) {
        this.updateBurrow(e, dt);
        e.rig.update(dt, e.vel, 0, { lod: true });
        continue;
      }

      // spawn: crawl out of the hive
      if (e.spawnT < 1) {
        e.spawnT = Math.min(1, e.spawnT + dt * 1.6);
        const sy = e.spawnY || 0;
        if (def.flying) e.pos.y = sy + THREE.MathUtils.lerp(0.5, def.hover, e.spawnT);
        else e.pos.y = sy + THREE.MathUtils.lerp(-1.2 * e.rig.s, 0, 1 - Math.pow(1 - e.spawnT, 2));
      }

      // status effects
      e.slow = Math.max(0, e.slow - dt);
      if (e.flungT > 0) e.flungT -= dt; // just thrown: can't be thrown again right away
      if (e.slow <= 0) e.slowF = 1;
      e.shock = Math.max(0, e.shock - dt);
      if (e.oiled > 0) e.oiled -= dt;
      if (e.burn > 0) {
        e.burn -= dt;
        this.damage(e, e.burnDps * dt * (e.oiled > 0 ? 2 : 1), { showNumber: false });
        if (Math.random() < dt * 14) game.fx.fire(_v.set(e.pos.x + (Math.random() - 0.5) * def.radius, e.pos.y + e.rig.baseH + 0.2, e.pos.z + (Math.random() - 0.5) * def.radius));
        if (e.dead) continue;
      }
      e.attackCd -= dt;
      e.leapCd -= dt;

      const inPool = !def.flying && nav.poolAt(e.pos.x, e.pos.z);
      let speed = def.speed * e.spdMult * (e.slow > 0 ? (e.slowF || 0.45) : 1) * (inPool ? 0.75 : 1) * (e.shock > 0 ? 0.2 : 1);
      if (e.spawnT < 1) speed *= 0.3;

      let desiredX = 0, desiredZ = 0;
      let face = null;
      const prevYaw = e.yaw;

      if (e.leap) {
        this.updateLeap(e, dt);
      } else if (def.flying) {
        this.updateFlyer(e, dt, speed);
      } else {
        // --- choose target
        let tgtPlayer = null;
        let best = def.aggro;
        for (const p of game.players) {
          if (p.dead) continue;
          const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
          // a player up on a cliff can't be reached directly; only spitters still go for them
          if (!def.range && !def.leapRange && Math.abs(p.pos.y - e.pos.y) > 2.2) continue;
          if (d < best && (d < 4 || nav.lineOfSight(e.pos.x, e.pos.z, p.pos.x, p.pos.z))) { best = d; tgtPlayer = p; }
        }
        // screech when it first spots a player
        if (tgtPlayer && !e.aggro && e.spawnT >= 1) { e.aggro = true; game.audio.alienAggro(e); }
        else if (!tgtPlayer && e.aggro) e.aggro = false;
        const dCore = Math.hypot(core.pos.x - e.pos.x, core.pos.z - e.pos.z);

        if (def.range) {
          // Spitter: shoot from range at player, or the core
          const t = tgtPlayer && best < def.range ? tgtPlayer : dCore < def.range ? 'core' : null;
          if (t) {
            if (e.attackCd <= 0 && e.spawnT >= 1) {
              e.attackCd = def.rate;
              this.spit(e, t === 'core' ? null : t);
            }
            const tx = t === 'core' ? core.pos.x : t.pos.x;
            const tz = t === 'core' ? core.pos.z : t.pos.z;
            face = Math.atan2(-(tx - e.pos.x), -(tz - e.pos.z));
            speed = 0;
          }
        }

        if (speed > 0) {
          if (def.leapRange && tgtPlayer && best < def.leapRange && best > 3 && e.leapCd <= 0) {
            this.startLeap(e, tgtPlayer.pos.x, tgtPlayer.pos.z, tgtPlayer);
          } else if (tgtPlayer) {
            const reach = def.radius + tgtPlayer.radius + 0.5;
            if (best <= reach && Math.abs(tgtPlayer.pos.y - e.pos.y) < 2.2) {
              face = Math.atan2(-(tgtPlayer.pos.x - e.pos.x), -(tgtPlayer.pos.z - e.pos.z));
              if (e.attackCd <= 0) this.melee(e, tgtPlayer);
              speed = 0;
            } else {
              desiredX = (tgtPlayer.pos.x - e.pos.x) / best;
              desiredZ = (tgtPlayer.pos.z - e.pos.z) / best;
            }
          } else {
            const reach = core.radius + def.radius + 0.4;
            if (dCore <= reach) {
              face = Math.atan2(-(core.pos.x - e.pos.x), -(core.pos.z - e.pos.z));
              if (e.attackCd <= 0) this.melee(e, 'core');
              speed = 0;
            } else {
              const ok = nav.flowDir(e.pos.x, e.pos.z, _dir, e.pos.y, e.route);
              if (ok === true) {
                desiredX = _dir.x; desiredZ = _dir.z;
                // building in the next cell? attack it when touching
              } else {
                desiredX = (core.pos.x - e.pos.x) / dCore;
                desiredZ = (core.pos.z - e.pos.z) / dCore;
              }
            }
          }
        }

        // bosses
        if (def.boss) this.updateBoss(e, dt);

        // --- unstick: if an alien following the flow field makes no progress for a
        // while (wedged on a corner or in a crowd), it sidesteps for a moment
        if ((desiredX || desiredZ) && !e.touching && speed > 0.5) {
          e.stuckT += dt;
          if (e.stuckT > 1.2) {
            const dNow = nav.distAt(e.pos.x, e.pos.z);
            const moved = Math.hypot(e.pos.x - (e.stuckX ?? 1e9), e.pos.z - (e.stuckZ ?? 1e9));
            if (e.stuckD !== undefined && dNow >= e.stuckD - 0.5 && moved < 1.2 && !e.unstickT) {
              e.unstickT = 0.9;
              e.unstickS = Math.random() < 0.5 ? -1 : 1;
            }
            e.stuckT = 0; e.stuckD = dNow; e.stuckX = e.pos.x; e.stuckZ = e.pos.z;
          }
        } else e.stuckT = 0;
        if (e.unstickT > 0) {
          e.unstickT = Math.max(0, e.unstickT - dt);
          // slide sideways along the obstacle while still leaning forward
          const ux = -desiredZ * e.unstickS, uz = desiredX * e.unstickS;
          desiredX = desiredX * 0.35 + ux; desiredZ = desiredZ * 0.35 + uz;
          const l = Math.hypot(desiredX, desiredZ) || 1;
          desiredX /= l; desiredZ /= l;
        }

        // --- move with separation (neighbours from the spatial hash)
        let sx = 0, sz = 0;
        const near = this.neighbours(e);
        for (let n = 0; n < near.length; n++) {
          const o = near[n];
          if (o === e) continue;
          const ox = e.pos.x - o.pos.x;
          const oz = e.pos.z - o.pos.z;
          const min = def.radius + o.def.radius;
          const d2 = ox * ox + oz * oz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (min - d) / min;
            const w = o.def.radius / (def.radius + o.def.radius) * 2 * (e.unstickT > 0 ? 0.3 : 1);
            sx += (ox / d) * push * w;
            sz += (oz / d) * push * w;
          }
        }
        const tvx = desiredX * speed + sx * 3;
        const tvz = desiredZ * speed + sz * 3;
        const acc = Math.min(1, dt * 8);
        e.vel.x += (tvx - e.vel.x) * acc;
        e.vel.z += (tvz - e.vel.z) * acc;
        e.vel.y = 0;
        const ox = e.pos.x, oz = e.pos.z;
        e.pos.x += e.vel.x * dt;
        e.pos.z += e.vel.z * dt;
        const touched = nav.pushOut(e.pos, def.radius * 0.85, ROCK_CAP);
        e.touching = !!touched;
        // no walking up cliffs: slide along them instead
        if (e.spawnT >= 1) {
          const lim = e.pos.y + CLIMB + 0.2;
          if (groundAt(e.pos.x, e.pos.z) > lim) {
            if (groundAt(e.pos.x, oz) <= lim) e.pos.z = oz;
            else if (groundAt(ox, e.pos.z) <= lim) e.pos.x = ox;
            else { e.pos.x = ox; e.pos.z = oz; }
          }
          const gy = groundAt(e.pos.x, e.pos.z);
          if (e.pos.y > gy + 0.05) {
            // pushed off a ledge: fall
            e.fallV = (e.fallV || 0) + 20 * dt;
            e.pos.y = Math.max(gy, e.pos.y - e.fallV * dt);
          } else { e.pos.y = gy; e.fallV = 0; }
          if (e.pos.y < -2.5) { this.fallDeath(e); continue; } // shoved into a chasm
        }
        // keep out of the core
        const cdx = e.pos.x - core.pos.x, cdz = e.pos.z - core.pos.z;
        const cd = Math.hypot(cdx, cdz);
        const cmin = core.radius + def.radius * 0.8;
        if (cd < cmin && cd > 1e-4) { e.pos.x = core.pos.x + (cdx / cd) * cmin; e.pos.z = core.pos.z + (cdz / cd) * cmin; }

        // chew through buildings that block the way (also when chasing a player behind walls)
        if (def.explodeRadius) e.nearBoom = !!touched || dCore < 9 || (tgtPlayer && best < 5);
        if (touched && e.spawnT >= 1) {
          if (def.leapRange && e.leapCd <= 0 && this.tryLeapOver(e, touched)) {
            // leaped over it
          } else {
            face = Math.atan2(-(touched.x - e.pos.x), -(touched.z - e.pos.z));
            if (e.attackCd <= 0) this.melee(e, touched);
            if (def.explodeRadius) this.detonate(e);
          }
        } else if (def.explodeRadius && e.spawnT >= 1) {
          // bloaters blow up next to players or the core
          if ((tgtPlayer && best < def.radius + 1.2) || dCore < core.radius + def.radius + 0.8) this.detonate(e);
        }
        if (e.dead) continue;
      }

      // --- facing
      const mv = Math.hypot(e.vel.x, e.vel.z);
      const targetYaw = face !== null ? face : mv > 0.3 ? Math.atan2(-e.vel.x, -e.vel.z) : e.yaw;
      let diff = targetYaw - e.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      e.yaw += diff * Math.min(1, dt * (def.boss ? 3 : 7));
      e.rig.root.rotation.y = e.yaw;
      const turn = (e.yaw - prevYaw) / Math.max(dt, 1e-4);

      // level of detail: legs of far-away or off-screen aliens are animated less often
      const cam = game.r.camera.position;
      const ddx = e.pos.x - cam.x, ddz = e.pos.z - cam.z;
      const d2 = ddx * ddx + ddz * ddz;
      const behind = d2 > 100 && (ddx * this.camFx + ddz * this.camFz) < -0.3 * Math.sqrt(d2);
      const every = behind || d2 > 45 * 45 ? 3 : d2 > 22 * 22 ? 2 : 1;
      e.lodDt = (e.lodDt || 0) + dt;
      const skip = every > 1 && (this.frame + i) % every !== 0;
      e.rig.update(skip ? 0 : e.lodDt, e.vel, turn, {
        lod: skip,
        leaping: !!e.leap,
        slamT: e.slamT,
        explodeGlow: !!(def.explodeRadius && e.nearBoom),
      });

      if (!skip) e.lodDt = 0;
      // health bar
      if (e.hp < e.maxHp && !def.boss) {
        e.bar.visible = true;
        e.bar.position.set(e.pos.x, e.pos.y + e.barH, e.pos.z);
        e.bar.quaternion.copy(game.r.camera.quaternion);
        e.barFill.scale.x = Math.max(0.001, e.hp / e.maxHp);
      }
    }

    this.updateProjectiles(dt);
    this.updateClouds(dt);
  }

  // ------------------------------------------------------------ burrower
  startBurrow(e) {
    const game = this.game;
    const nav = game.world.nav;
    const c = game.core.pos;
    // surface somewhere random along the swarm's routes, a fair walk from the core
    // (path distance 12-30 cells), so it is a surprise but not an instant hit on the core
    let tx = c.x, tz = c.z + 7;
    const cand = [];
    for (let k = 0; k < nav.dist.length; k++) {
      const d = nav.dist[k];
      if (d < 12 || d > 30 || nav.blocked[k] || nav.struct[k] || nav.pool[k]) continue;
      cand.push(k);
    }
    if (cand.length) {
      const k = cand[Math.floor(Math.random() * cand.length)];
      tx = nav.cx(k % nav.cols) + (Math.random() - 0.5) * 0.8;
      tz = nav.cz((k / nav.cols) | 0) + (Math.random() - 0.5) * 0.8;
    }
    e.burrow = { tx, tz, trail: 0 };
    e.hidden = true;
    e.rig.setBurrowed(true);
    e.spawnT = 1;
    e.pos.y = groundAt(e.pos.x, e.pos.z);
    this.rebuildHitList();
  }

  updateBurrow(e, dt) {
    const game = this.game;
    const b = e.burrow;
    const dx = b.tx - e.pos.x, dz = b.tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = e.def.speed * 1.35;
    e.yaw = Math.atan2(-dx, -dz);
    e.rig.root.rotation.y = e.yaw;
    e.vel.set((dx / (d || 1)) * sp, 0, (dz / (d || 1)) * sp);
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    e.pos.y = groundAt(e.pos.x, e.pos.z);
    b.trail -= dt;
    if (b.trail <= 0) {
      b.trail = 0.09;
      game.fx.dust(e.pos.x, e.pos.z, 0.35);
      game.audio.rumble(e.pos);
    }
    if (d < 0.6) {
      // burst out of the ground
      e.burrow = null;
      e.hidden = false;
      e.rig.emerge();
      e.vel.set(0, 0, 0);
      game.fx.dust(e.pos.x, e.pos.z, 2.2);
      game.fx.burst(_v.set(e.pos.x, e.pos.y + 0.5, e.pos.z), '#5a4030', 30, 8, 0.2);
      game.audio.slam(e.pos);
      game.shake(0.5, e.pos);
      game.build.damageArea(e.pos.x, e.pos.z, 2.2, 60 * e.dmgMult);
      for (const p of game.players) if (!p.dead && Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < 2.2) p.hurt(15 * e.dmgMult, e.pos);
      game.world.nav.pushOut(e.pos, e.def.radius * 0.85, ROCK_CAP);
      game.hud.toast('A Burrower broke through inside the base!', 'bad');
      this.rebuildHitList();
    }
  }

  // ------------------------------------------------------------ toxic clouds (floaters)
  updateClouds(dt) {
    const game = this.game;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t -= dt;
      c.tick -= dt;
      if (Math.random() < dt * 25) game.fx.toxic(c.x + (Math.random() - 0.5) * c.r * 1.6, c.z + (Math.random() - 0.5) * c.r * 1.6);
      if (c.tick <= 0) {
        c.tick = 0.5;
        if (!game.net.isClient) for (const p of game.players) if (!p.dead && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < c.r) p.hurt(5);
      }
      if (c.t <= 0) this.clouds.splice(i, 1);
    }
  }

  melee(e, target) {
    const game = this.game;
    e.attackCd = e.def.rate;
    e.rig.attackT = 1;
    e.atkN = (e.atkN || 0) + 1;
    game.audio.alienBite(e);
    if (target === 'core') game.damageCore(e.def.dmg * e.dmgMult, e.pos);
    else if (target.isPlayer) target.hurt(e.def.dmg * e.dmgMult, e.pos);
    else {
      game.build.damage(target, e.def.structDmg * e.dmgMult, e);
      game.audio.chew(e.pos);
    }
  }

  detonate(e) {
    if (e.dead) return;
    e.hp = 0;
    this.kill(e);
  }

  updateFlyer(e, dt, speed) {
    const game = this.game;
    const def = e.def;
    if (def.floater) return this.updateFloater(e, dt, speed);
    // target: nearest player, else nearest turret, else core
    let tx = game.core.pos.x, tz = game.core.pos.z, ty = game.core.pos.y + 3.5, target = 'core', reach = game.core.radius + 1.5;
    let best = def.aggro;
    for (const p of game.players) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      if (d < best) { best = d; tx = p.pos.x; tz = p.pos.z; ty = p.pos.y + 1.6; target = p; reach = 1.6; }
    }
    if (target === 'core') {
      const t = game.build.nearestOfKind(e.pos.x, e.pos.z, 22, (s) => s.def.turret);
      if (t) { tx = t.x; tz = t.z; ty = (t.y || 0) + 2.6; target = t; reach = 1.8; }
    }
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const close = d < reach + 0.5;
    let vx = 0, vz = 0;
    if (!close) {
      vx = (dx / d) * speed;
      vz = (dz / d) * speed;
    } else {
      // circle while attacking
      vx = (-dz / d) * 1.5;
      vz = (dx / d) * 1.5;
      if (e.attackCd <= 0) {
        e.attackCd = def.rate;
        e.rig.attackT = 1;
        e.atkN = (e.atkN || 0) + 1;
        if (target === 'core') game.damageCore(def.dmg * e.dmgMult, e.pos);
        else if (target.isPlayer) target.hurt(def.dmg * e.dmgMult, e.pos);
        else game.build.damage(target, def.structDmg * e.dmgMult, e);
        game.audio.sting(e.pos);
        game.audio.alienBite(e);
      }
    }
    // separation between flyers
    for (const o of this.list) {
      if (o === e || o.dead || !o.def.flying) continue;
      const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z;
      const dd = Math.hypot(ox, oz);
      if (dd < 1.6 && dd > 0.01) { vx += (ox / dd) * 3; vz += (oz / dd) * 3; }
    }
    const acc = Math.min(1, dt * 3);
    e.vel.x += (vx - e.vel.x) * acc;
    e.vel.z += (vz - e.vel.z) * acc;
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    if (e.spawnT >= 1) {
      const wantY = close ? ty : Math.max(groundAt(e.pos.x, e.pos.z), groundAt(e.pos.x + e.vel.x * 0.6, e.pos.z + e.vel.z * 0.6)) + def.hover + Math.sin(e.rig.time * 1.3) * 0.5;
      e.pos.y += (wantY - e.pos.y) * Math.min(1, dt * 2.5);
    }
    // stay inside the map
    const nav = game.world.nav;
    e.pos.x = THREE.MathUtils.clamp(e.pos.x, -nav.halfX + 1, nav.halfX - 1);
    e.pos.z = THREE.MathUtils.clamp(e.pos.z, -nav.halfZ + 1, nav.halfZ - 1);
  }

  // Floater: drifts above a building (or the core) and drops acid on it
  updateFloater(e, dt, speed) {
    const game = this.game;
    const def = e.def;
    if (!e.ftarget || (e.ftarget !== 'core' && e.ftarget.hp <= 0) || Math.random() < dt * 0.1) {
      const t = game.build.nearestOfKind(e.pos.x, e.pos.z, 34, (s) => s.def.solid);
      e.ftarget = t || 'core';
    }
    const tx = e.ftarget === 'core' ? game.core.pos.x : e.ftarget.x;
    const tz = e.ftarget === 'core' ? game.core.pos.z : e.ftarget.z;
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const over = d < 1.6;
    const vx = over ? Math.sin(e.rig.time) * 0.6 : (dx / d) * speed;
    const vz = over ? Math.cos(e.rig.time * 0.8) * 0.6 : (dz / d) * speed;
    const acc = Math.min(1, dt * 1.5);
    e.vel.x += (vx - e.vel.x) * acc;
    e.vel.z += (vz - e.vel.z) * acc;
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    if (e.spawnT >= 1) e.pos.y += (Math.max(groundAt(e.pos.x, e.pos.z), e.ftarget === 'core' ? game.core.pos.y : e.ftarget.y || 0) + def.hover + Math.sin(e.rig.time * 0.9) * 0.4 - e.pos.y) * Math.min(1, dt * 1.5);
    if (d < 3 && e.attackCd <= 0 && e.spawnT >= 1) {
      e.attackCd = def.rate;
      e.rig.attackT = 1;
      const mesh = new THREE.Mesh(projGeo, this.projMat);
      mesh.position.set(e.pos.x, e.pos.y - 0.6, e.pos.z);
      mesh.scale.setScalar(1.4);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, vel: new THREE.Vector3(e.vel.x * 0.3, -1, e.vel.z * 0.3), life: 4, dmg: def.dmg * e.dmgMult, structDmg: def.structDmg * e.dmgMult, color: def.colors.blood, splash: 1.6 });
      e.atkN = (e.atkN || 0) + 1;
      game.net.event({ k: 'spit', p: [mesh.position.x, mesh.position.y, mesh.position.z], v: [e.vel.x * 0.3, -1, e.vel.z * 0.3], c: def.colors.blood, s: 1.4 });
      game.audio.spit(e.pos);
    }
    const nav = game.world.nav;
    e.pos.x = THREE.MathUtils.clamp(e.pos.x, -nav.halfX + 1, nav.halfX - 1);
    e.pos.z = THREE.MathUtils.clamp(e.pos.z, -nav.halfZ + 1, nav.halfZ - 1);
  }

  startLeap(e, x, z, player = null) {
    const d = Math.hypot(x - e.pos.x, z - e.pos.z);
    const sy = e.pos.y, ey = groundAt(x, z);
    e.leap = { sx: e.pos.x, sz: e.pos.z, sy, ex: x, ez: z, ey, t: 0, dur: 0.45 + d * 0.04 + Math.max(0, ey - sy) * 0.03, h: 1.5 + d * 0.18 + Math.max(0, ey - sy) * 0.6, player };
    e.leapCd = 3.5 + Math.random() * 1.5;
    e.vel.set((x - e.pos.x) / e.leap.dur, 0, (z - e.pos.z) / e.leap.dur);
    e.yaw = Math.atan2(-(x - e.pos.x), -(z - e.pos.z));
    this.game.audio.leap(e.pos);
  }

  tryLeapOver(e, s) {
    const nav = this.game.world.nav;
    const dx = s.x - e.pos.x, dz = s.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    for (const dist of [5, 6.5, 8]) {
      const x = e.pos.x + (dx / d) * dist;
      const z = e.pos.z + (dz / d) * dist;
      const i = nav.ci(x), j = nav.cj(z);
      if (!nav.solidAt(i, j) && !nav.solidAt(nav.ci(x + 0.6), j) && !nav.solidAt(i, nav.cj(z + 0.6))) {
        this.startLeap(e, x, z);
        return true;
      }
    }
    return false;
  }

  // Gravity Launcher: throw an alien up to `dist` metres along (dx, dz)
  fling(e, dx, dz, dist) {
    if (e.dead || e.leap || e.hidden || e.def.flying || e.flungT > 0) return false;
    const nav = this.game.world.nav;
    let ex = e.pos.x, ez = e.pos.z, pit = false;
    for (let t = 0.5; t <= dist; t += 0.5) {
      const x = e.pos.x + dx * t, z = e.pos.z + dz * t;
      const i = nav.ci(x), j = nav.cj(z);
      if (!nav.inside(i, j)) break;
      const k = nav.idx(i, j);
      const b = nav.blocked[k];
      const st = nav.struct[k];
      if (b === 1 || b === 2 || b === 3 || (st && st.def.solid)) break; // hits rock / a wall
      if (groundAt(x, z) > e.pos.y + 1.2) break; // a cliff face
      ex = x; ez = z;
      pit = b === PIT;
      if (pit) break;
    }
    const d = Math.hypot(ex - e.pos.x, ez - e.pos.z);
    if (d < 1.5) return false;
    const sy = e.pos.y, ey = pit ? sy : groundAt(ex, ez);
    e.leap = { sx: e.pos.x, sz: e.pos.z, sy, ex: pit ? ex + dx * 1.5 : ex, ez: pit ? ez + dz * 1.5 : ez, ey, t: 0, dur: 0.6 + d * 0.035, h: 2.2 + d * 0.18, fling: true, pit };
    e.yaw = Math.atan2(dx, dz); // tumbling backwards
    this.game.audio.leap(e.pos);
    return true;
  }

  // fell into a chasm
  fallDeath(e) {
    const game = this.game;
    if (e.dead) return;
    e.hp = 0;
    this.kill(e, { fell: true });
    game.fx.label(e.pos.x, e.pos.y + 1.5, e.pos.z, 'INTO THE ABYSS!', '#8aff5a');
    game.net.event({ k: 'label', x: e.pos.x, y: e.pos.y + 1.5, z: e.pos.z, t: 'INTO THE ABYSS!', c: '#8aff5a' });
  }

  updateLeap(e, dt) {
    const L = e.leap;
    L.t += dt / L.dur;
    const t = Math.min(1, L.t);
    e.pos.x = THREE.MathUtils.lerp(L.sx, L.ex, t);
    e.pos.z = THREE.MathUtils.lerp(L.sz, L.ez, t);
    e.pos.y = THREE.MathUtils.lerp(L.sy || 0, L.ey || 0, t) + Math.sin(Math.PI * t) * L.h;
    if (t >= 1 && L.fling) {
      // thrown by a Gravity Launcher
      e.leap = null;
      e.vel.set(0, 0, 0);
      if (L.pit) { this.fallDeath(e); return; }
      e.flungT = 3.5;
      e.pos.y = groundAt(e.pos.x, e.pos.z);
      e.rig.plantFeet();
      this.game.fx.dust(e.pos.x, e.pos.z, 1.0);
      e.shock = Math.max(e.shock, 0.5); // dazed for a moment
      this.damage(e, 15, { showNumber: false });
      this.game.world.nav.pushOut(e.pos, e.def.radius * 0.85, ROCK_CAP);
      return;
    }
    if (t >= 1) {
      e.pos.y = groundAt(e.pos.x, e.pos.z);
      e.leap = null;
      e.vel.multiplyScalar(0.2);
      e.rig.plantFeet();
      this.game.fx.dust(e.pos.x, e.pos.z, 1.0);
      // damage players near the landing spot
      for (const p of this.game.players) {
        if (p.dead) continue;
        if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < 2.0) p.hurt(e.def.dmg * e.dmgMult, e.pos);
      }
      this.game.world.nav.pushOut(e.pos, e.def.radius * 0.85, ROCK_CAP);
    }
  }

  updateBoss(e, dt) {
    const game = this.game;
    if (e.type === 'queen') {
      e.broodCd -= dt;
      if (e.broodCd <= 0 && e.spawnT >= 1) {
        e.broodCd = 7;
        e.rig.attackT = 1;
        for (let k = 0; k < 4; k++) {
          const a = e.yaw + Math.PI + (k - 1.5) * 0.5;
          const x = e.pos.x - Math.sin(a) * 3.5;
          const z = e.pos.z - Math.cos(a) * 3.5;
          const s = this.spawn('swarmling', x, z, game.enemyMult(), false);
          s.pos.y = groundAt(x, z);
          game.waveExtra++;
        }
        game.fx.burst(_v.set(e.pos.x, e.pos.y + 1.5, e.pos.z), '#ff6af5', 20, 6, 0.15);
        game.audio.brood(e.pos);
      }
    } else if (e.type === 'titan') {
      e.slamCd -= dt;
      if (e.slamT > 0) {
        e.slamT -= dt * 1.6;
        if (e.slamT <= 0) {
          e.slamT = 0;
          const r = e.def.slamRadius;
          game.fx.shockwave(e.pos.x, e.pos.z, r);
          game.net.event({ k: 'shock', x: e.pos.x, z: e.pos.z, r });
          game.audio.slam(e.pos);
          game.shake(1.2, e.pos);
          game.build.damageArea(e.pos.x, e.pos.z, r, e.def.structDmg * e.dmgMult);
          for (const p of game.players) {
            if (p.dead) continue;
            const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
            if (d < r) { p.hurt(e.def.dmg * e.dmgMult, e.pos); p.vel.y = 7; }
          }
          if (Math.hypot(game.core.pos.x - e.pos.x, game.core.pos.z - e.pos.z) < r + game.core.radius) game.damageCore(e.def.dmg * e.dmgMult * 3, e.pos);
        }
      } else if (e.slamCd <= 0) {
        // slam when something is close
        const near = game.players.some((p) => !p.dead && Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < e.def.slamRadius)
          || game.build.nearestOfKind(e.pos.x, e.pos.z, e.def.slamRadius, (s) => s.def.solid)
          || Math.hypot(game.core.pos.x - e.pos.x, game.core.pos.z - e.pos.z) < e.def.slamRadius + game.core.radius;
        if (near) { e.slamT = 1; e.slamCd = 5.5; }
      }
    }
  }

  spit(e, player) {
    const game = this.game;
    const from = new THREE.Vector3();
    e.rig.head.getWorldPosition(from);
    const to = player ? player.chest() : new THREE.Vector3(game.core.pos.x, game.core.pos.y + 2.5, game.core.pos.z);
    if (player) to.addScaledVector(player.vel, 0.4).setY(player.pos.y + 1.1);
    const flightTime = Math.max(0.35, from.distanceTo(to) / 17);
    const vel = to.clone().sub(from).divideScalar(flightTime);
    vel.y += 0.5 * 10 * flightTime;
    const mesh = new THREE.Mesh(projGeo, this.projMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel, life: 4, dmg: e.def.dmg * e.dmgMult, structDmg: e.def.structDmg * e.dmgMult, color: e.def.colors.blood });
    e.atkN = (e.atkN || 0) + 1;
    game.net.event({ k: 'spit', p: [from.x, from.y, from.z], v: [vel.x, vel.y, vel.z], c: e.def.colors.blood, s: 1 });
    e.rig.attackT = 1;
    game.audio.spit(e.pos);
  }

  updateProjectiles(dt) {
    const game = this.game;
    const core = game.core;
    const nav = game.world.nav;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.vel.y -= 10 * dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);
      pr.life -= dt;
      const p = pr.mesh.position;
      if (Math.random() < dt * 30) game.fx.trail(p, pr.color);
      let hit = false;
      if (pr.visual) {
        // co-op client copy of a host projectile: only looks, never hurts
        if (p.y <= groundAt(p.x, p.z) || pr.life <= 0 || Math.hypot(p.x - core.pos.x, p.z - core.pos.z) < core.radius && p.y < core.pos.y + 5) {
          game.fx.burst(p, pr.color, 12, 4, 0.1);
          if (p.y <= groundAt(p.x, p.z) + 0.3) game.fx.splat(p.x, p.z, pr.color, 0.6);
          this.scene.remove(pr.mesh);
          this.projectiles.splice(i, 1);
        }
        continue;
      }
      for (const pl of game.players) {
        if (pl.dead) continue;
        if (pl.chest(_v).distanceTo(p) < 0.9) { pl.hurt(pr.dmg, p); hit = true; }
      }
      const gy = groundAt(p.x, p.z);
      if (!hit && Math.hypot(p.x - core.pos.x, p.z - core.pos.z) < core.radius && p.y < core.pos.y + 5) {
        game.damageCore(pr.dmg, p);
        hit = true;
      }
      if (!hit && p.y - gy < 2.2) {
        const s = nav.structAt(p.x, p.z, 0.25);
        if (s) {
          if (pr.splash) game.build.damageArea(p.x, p.z, pr.splash, pr.structDmg);
          else game.build.damage(s, pr.structDmg);
          hit = true;
        }
        else if (nav.isBlocked(nav.ci(p.x), nav.cj(p.z)) && p.y - gy < 1.5) hit = true;
      }
      if (hit || p.y <= gy || pr.life <= 0) {
        game.fx.burst(p, pr.color, 12, 4, 0.1);
        if (p.y <= gy + 0.3) game.fx.splat(p.x, p.z, pr.color, 0.6);
        this.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------ co-op client mirror
  // en: [nid, type, x, y, z, yaw, hpFrac, flags, attackCount] from the host
  applyMirror(en) {
    const seen = new Set();
    for (const r of en) {
      const [nid, type, x, y, z, yaw, hp, f, atk] = r;
      seen.add(nid);
      let e = this.byNid(nid);
      if (!e) {
        if (f & 1) continue; // already dead when we first hear of it
        e = this.spawn(type, x, z, { hp: 1, dmg: 1 }, !!(f & 16), { mirror: true, nid });
        e.pos.y = y;
        e.yaw = yaw;
        e.rig.root.rotation.y = yaw;
        e.atkSeen = atk;
      }
      const m = e.mirror;
      m.x = x; m.y = y; m.z = z; m.yaw = yaw;
      if (!e.dead && hp < e.hp - 0.001) this.game.audio.alienHurt(e);
      e.hp = Math.max(0, hp);
      e.leapF = !!(f & 4);
      e.slamT = f & 8 ? 0.5 : 0;
      e.spawnT = f & 16 ? 0.5 : 1;
      e.nearBoom = !!(f & 32);
      if (atk !== e.atkSeen) { e.atkSeen = atk; e.rig.attackT = 1; if (!e.def.range) this.game.audio.alienBite(e); }
      const hidden = !!(f & 2);
      if (hidden !== !!e.hidden) {
        e.hidden = hidden;
        if (e.rig.setBurrowed) e.rig.setBurrowed(hidden);
        if (!hidden && e.rig.emerge) { e.rig.emerge(); this.game.fx.dust(x, z, 2.2); this.game.audio.slam(e.pos); }
        this.rebuildHitList();
      }
      if ((f & 1) && !e.dead) this.mirrorKill(e);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (seen.has(e.nid)) continue;
      if (!e.dead) this.mirrorKill(e);
      if (e.deadT > 0.2 || !e.dead) { this.removeVisual(e); this.list.splice(i, 1); }
    }
  }

  mirrorKill(e) {
    const game = this.game;
    e.dead = true;
    e.deadT = 0;
    e.rig.die(Math.random() < 0.5 ? -1 : 1);
    e.bar.visible = false;
    const p = _v.set(e.pos.x, e.pos.y + e.rig.baseH, e.pos.z);
    game.fx.burst(p, e.def.colors.blood, e.def.boss ? 70 : 18, 7, 0.14);
    game.fx.burst(p, e.def.colors.shell, e.def.boss ? 30 : 6, 5, 0.18);
    game.fx.splat(e.pos.x, e.pos.z, e.def.colors.blood, e.def.rig.scale * 1.4);
    if (!game.audio.alienDeath(e) || e.def.boss) game.audio.squish(e.def.boss, e.pos);
    if (e.def.explodeRadius) {
      game.fx.explosion(_w.set(e.pos.x, e.pos.y + 0.8, e.pos.z), '#ff9a2a', e.def.explodeRadius);
      game.audio.explosion(e.pos);
      game.shake(0.6, e.pos);
    }
    if (e.def.flying) e.fallV = 0;
    if (e.def.floater) this.clouds.push({ x: e.pos.x, z: e.pos.z, r: 3.6, t: 6, tick: 0 });
    this.rebuildHitList();
  }

  visualProjectile(ev) {
    const mesh = new THREE.Mesh(projGeo, this.projMat);
    mesh.position.set(ev.p[0], ev.p[1], ev.p[2]);
    if (ev.s) mesh.scale.setScalar(ev.s);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel: new THREE.Vector3(ev.v[0], ev.v[1], ev.v[2]), life: 4, color: ev.c, visual: true });
    this.game.audio.spit(mesh.position);
  }

  updateMirror(dt) {
    const game = this.game;
    this.frame = (this.frame || 0) + 1;
    const k = 1 - Math.exp(-dt * 12);
    const cam = game.r.camera.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const m = e.mirror;
      if (e.dead) {
        e.deadT += dt;
        const gy = groundAt(e.pos.x, e.pos.z);
        if (e.pos.y > gy) { e.fallV = (e.fallV || 0) + 20 * dt; e.pos.y = Math.max(gy, e.pos.y - e.fallV * dt); }
        e.rig.update(dt, e.vel.multiplyScalar(0.9), 0);
        if (e.deadT > 4.5) { this.removeVisual(e); this.list.splice(i, 1); }
        continue;
      }
      const px = e.pos.x, pz = e.pos.z;
      e.pos.x += (m.x - e.pos.x) * k;
      e.pos.y += (m.y - e.pos.y) * k;
      e.pos.z += (m.z - e.pos.z) * k;
      if (Math.hypot(m.x - e.pos.x, m.z - e.pos.z) > 8) { e.pos.x = m.x; e.pos.y = m.y; e.pos.z = m.z; }
      e.vel.set((e.pos.x - px) / Math.max(dt, 1e-4), 0, (e.pos.z - pz) / Math.max(dt, 1e-4));
      const prevYaw = e.yaw;
      let d = m.yaw - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * k;
      e.rig.root.rotation.y = e.yaw;
      const turn = (e.yaw - prevYaw) / Math.max(dt, 1e-4);
      const far = (e.pos.x - cam.x) ** 2 + (e.pos.z - cam.z) ** 2 > 40 * 40;
      e.lodDt = (e.lodDt || 0) + dt;
      const skip = far && ((this.frame + i) & 1) === 1;
      if (!e.hidden) e.rig.update(skip ? 0 : e.lodDt, e.vel, turn, { lod: skip, leaping: e.leapF, slamT: e.slamT, explodeGlow: !!(e.def.explodeRadius && e.nearBoom) });
      if (!skip) e.lodDt = 0;
      if (e.hp < 1 && !e.def.boss && !e.hidden) {
        e.bar.visible = true;
        e.bar.position.set(e.pos.x, e.pos.y + e.barH, e.pos.z);
        e.bar.quaternion.copy(game.r.camera.quaternion);
        e.barFill.scale.x = Math.max(0.001, e.hp);
      }
    }
    flushLegs();
    this.updateProjectiles(dt);
    this.updateClouds(dt);
  }
}
