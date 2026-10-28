import * as THREE from 'three';
import { PeerTransport, LocalTransport } from './transport.js';
import { Avatar, PLAYER_COLORS } from '../entities/avatar.js';
import { computeMods } from '../data/upgrades.js';

// ---------------------------------------------------------------------------
// Co-op networking. The host runs the real game (aliens, waves, buildings, the
// core) and sends snapshots ~15 times a second. Friends ("clients") move and
// shoot on their own computer, send their position and hits to the host, and
// show the aliens and buildings the host tells them about.

const SNAP_HZ = 15;
const INPUT_HZ = 20;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const r2 = (v) => Math.round(v * 100) / 100;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// Another player, seen from this computer
class RemotePlayer {
  constructor(game, id, name, color) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.color = color;
    this.isPlayer = true;
    this.isRemote = true;
    this.radius = 0.42;
    this.pos = new THREE.Vector3(0, -50, 0);
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.tyaw = 0; this.tpitch = 0;
    this.dead = false;
    this.hp = 100; this.maxHp = 100;
    this.fresh = true;
    this.avatar = new Avatar(game.r.scene, name, color);
  }

  chest(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.1, this.pos.z); }

  // only the host decides damage; it is sent to the player's own computer
  hurt(amount, fromPos = null) {
    if (this.dead || !this.game.net.isHost) return;
    this.game.net.sendTo(this.id, { t: 'hurt', a: Math.round(amount * 10) / 10, f: fromPos ? [r2(fromPos.x), r2(fromPos.z)] : null });
  }

  setState(s) {
    this.target.set(s[1], s[2], s[3]);
    this.tyaw = s[4];
    this.tpitch = s[5];
    this.dead = !!s[6];
    this.hp = s[7];
    if (this.fresh) { this.pos.copy(this.target); this.yaw = this.tyaw; this.fresh = false; }
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 14);
    _v.copy(this.pos);
    this.pos.lerp(this.target, k);
    if (this.pos.distanceTo(this.target) > 6) this.pos.copy(this.target); // teleport (respawn)
    this.vel.subVectors(this.pos, _v).divideScalar(Math.max(dt, 1e-4));
    let d = this.tyaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    this.pitch += (this.tpitch - this.pitch) * k;
    this.avatar.update(dt, this.pos, this.yaw, this.pitch, Math.hypot(this.vel.x, this.vel.z), this.dead);
  }

  dispose() { this.avatar.dispose(); }
}

export class Net {
  constructor(game) {
    this.game = game;
    this.role = 'off'; // off | host | client
    this.players = []; // lobby list: { id, name, color }
    this.remotes = new Map(); // id -> RemotePlayer (in a running game)
    this.conns = new Map(); // host: id -> connection
    this.conn = null; // client: connection to the host
    this.myId = 0;
    this.events = [];
    this.snapT = 0;
    this.upT = 0;
    this.structDirty = false;
    this.onLobby = null; // UI callback
    this.lobbyMap = null;
    this.lobbyDiff = null;
    try { this.name = localStorage.getItem('as-name') || ''; } catch { this.name = ''; }
  }

  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }
  get active() { return this.role !== 'off'; }

  setName(n) {
    this.name = (n || '').trim().slice(0, 14) || 'Player';
    try { localStorage.setItem('as-name', this.name); } catch { /* ignore */ }
  }

  makeTransport() {
    return /[?&]net=local/.test(location.search) ? new LocalTransport() : new PeerTransport();
  }

  colorOf(id) { return PLAYER_COLORS[id % PLAYER_COLORS.length]; }
  nameOf(id) { const p = this.players.find((q) => q.id === id); return p ? p.name : 'Player ' + (id + 1); }
  lobbyChanged() { if (this.onLobby) this.onLobby(); }

  // ------------------------------------------------------------ host
  async host(name) {
    this.setName(name);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
      const t = this.makeTransport();
      try {
        await t.host(code, (c) => this.onClientConn(c));
        this.t = t;
        this.code = code;
        this.role = 'host';
        this.myId = 0;
        this.players = [{ id: 0, name: this.name, color: this.colorOf(0) }];
        this.lobbyChanged();
        return code;
      } catch (e) { lastErr = e; t.close(); }
    }
    throw lastErr;
  }

  onClientConn(c) {
    c.onData = (m) => this.onHostData(c, m);
    c.onClose = () => this.dropClient(c);
  }

  onHostData(c, m) {
    const game = this.game;
    if (m.t === 'hello') {
      if (this.players.length >= 4) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
      let id = 1;
      while (this.players.some((p) => p.id === id)) id++;
      c.pid = id;
      this.conns.set(id, c);
      const name = String(m.name || 'Player').slice(0, 14);
      this.players.push({ id, name, color: this.colorOf(id) });
      c.send({ t: 'welcome', id, code: this.code, players: this.players, map: this.lobbyMap, diff: this.lobbyDiff });
      this.broadcast({ t: 'lobby', players: this.players, map: this.lobbyMap, diff: this.lobbyDiff });
      if (game.inGame) {
        // joining a game in progress
        c.send(this.startMsg());
        this.addRemote(id);
        this.structDirty = true;
        game.hud.toast(`${name} joined the fight`, 'good');
      } else game.hud.toast(`${name} joined the lobby`, 'good');
      this.lobbyChanged();
      return;
    }
    const id = c.pid;
    if (id === undefined) return;
    if (m.t === 'in') {
      const r = this.remotes.get(id);
      if (r) r.setState([id, m.p[0], m.p[1], m.p[2], m.p[3], m.p[4], m.d, m.hp]);
    } else if (m.t === 'hit') {
      const e = game.enemies.byNid(m.n);
      const r = this.remotes.get(id);
      if (e && !e.dead) game.enemies.damage(e, m.d, { crit: !!m.c, from: r ? r.pos : null, showNumber: false });
    } else if (m.t === 'tr') {
      this.showTracer(id, m.f, m.to);
      this.event({ k: 'tr', id, f: m.f, to: m.to });
    } else if (m.t === 'act') {
      this.hostAction(id, m);
    }
  }

  hostAction(id, m) {
    const game = this.game;
    const b = game.build;
    const nav = game.world && game.world.nav;
    if (!game.inGame || game.over || !nav) return;
    const sAt = () => (nav.inside(m.i, m.j) ? nav.struct[nav.idx(m.i, m.j)] : null);
    const who = this.nameOf(id);
    if (m.a === 'build') {
      const prevMode = b.mode;
      b.mode = m.type;
      const reason = b.invalidReason(m.i, m.j, nav.cx(m.i), nav.cz(m.j));
      const cost = b.cost(m.type);
      const need = b.powerOf(m.type, 0);
      b.mode = prevMode;
      if (reason || game.credits < cost || need > b.powerFree()) { this.sendTo(id, { t: 'toast', m: reason || (game.credits < cost ? 'Not enough crystals' : `Needs ${need} ⚡ power`), k: 'warn' }); return; }
      game.credits -= cost;
      const s = b.place(m.type, m.i, m.j, m.rot || 0);
      s.invested = cost;
      game.stats.built++;
      game.audio.build(s.group.position);
      game.fx.dust(s.x, s.z, 1.2);
    } else if (m.a === 'upgrade') { const s = sAt(); if (s) b.upgrade(s, true); }
    else if (m.a === 'repair') { const s = sAt(); if (s) b.repair(s, true); }
    else if (m.a === 'sell') { const s = sAt(); if (s) b.sell(s, true); }
    else if (m.a === 'turn') { const s = sAt(); if (s) b.turn(s); }
    else if (m.a === 'wave') { if (game.phase === 'build') { game.startWave(); game.hud.toast(`${who} started the wave`); } }
    else if (m.a === 'buy') { game.upgrades.buy(m.id, true); }
    this.structDirty = true;
  }

  dropClient(c) {
    const id = c.pid;
    if (id === undefined) return;
    this.conns.delete(id);
    const name = this.nameOf(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.removeRemote(id);
    this.broadcast({ t: 'lobby', players: this.players, map: this.lobbyMap, diff: this.lobbyDiff });
    this.game.hud.toast(`${name} left`, 'warn');
    this.lobbyChanged();
  }

  // host picked a map in the lobby
  setLobbyMission(map, diff) {
    this.lobbyMap = map;
    this.lobbyDiff = diff;
    if (this.isHost) this.broadcast({ t: 'lobby', players: this.players, map, diff });
  }

  startMsg() {
    const g = this.game;
    return { t: 'start', map: g.mapId, diff: g.difficulty, players: this.players };
  }

  broadcast(m, exceptId = -1) {
    for (const [id, c] of this.conns) if (id !== exceptId) c.send(m);
  }

  sendTo(id, m) { const c = this.conns.get(id); if (c) c.send(m); }

  // host: something every client should see happen
  event(e) { if (this.isHost && this.conns.size) this.events.push(e); }

  // ------------------------------------------------------------ client
  async join(code, name) {
    this.setName(name);
    code = code.trim().toUpperCase();
    const t = this.makeTransport();
    const conn = await t.join(code);
    this.t = t;
    this.conn = conn;
    this.code = code;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The host did not answer')), 8000);
      conn.onData = (m) => {
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.role = 'client';
          this.myId = m.id;
          this.players = m.players;
          this.lobbyMap = m.map;
          this.lobbyDiff = m.diff;
          conn.onData = (mm) => this.onClientData(mm);
          this.lobbyChanged();
          resolve();
        } else if (m.t === 'full') {
          clearTimeout(timer);
          reject(new Error('That game is full (4 players)'));
        }
      };
      conn.onClose = () => { if (this.role === 'client') this.lostHost('Lost connection to the host'); };
      conn.send({ t: 'hello', name: this.name });
    });
  }

  onClientData(m) {
    const game = this.game;
    if (m.t === 'lobby') {
      this.players = m.players;
      this.lobbyMap = m.map;
      this.lobbyDiff = m.diff;
      for (const [id] of this.remotes) if (!this.players.some((p) => p.id === id)) this.removeRemote(id);
      this.lobbyChanged();
    } else if (m.t === 'start') {
      this.players = m.players;
      game.startGame(m.map, m.diff, { fromNet: true });
    } else if (m.t === 's') {
      if (game.inGame && game.world) this.applySnapshot(m);
    } else if (m.t === 'hurt') {
      if (game.inGame) game.player.hurt(m.a, m.f ? { x: m.f[0], z: m.f[1] } : null);
    } else if (m.t === 'toast') {
      game.hud.toast(m.m, m.k);
      game.audio.error();
    } else if (m.t === 'tolobby') {
      if (game.inGame || game.over) game.backToLobby();
    } else if (m.t === 'end') {
      this.lostHost('The host closed the game');
    }
  }

  request(a) { if (this.conn) this.conn.send({ t: 'act', ...a }); }

  lostHost(msg) {
    const game = this.game;
    this.leave(true);
    if (game.inGame || game.menus.current === 'lobby') {
      game.quitToMenu();
    }
    game.hud.toast(msg, 'bad');
    game.menus.showNotice(msg);
  }

  leave(silent = false) {
    if (this.isHost) this.broadcast({ t: 'end' });
    for (const [id] of this.remotes) this.removeRemote(id);
    const t = this.t;
    if (this.conn && !silent) this.conn.close();
    setTimeout(() => t && t.close(), 300);
    this.t = null;
    this.conn = null;
    this.conns.clear();
    this.role = 'off';
    this.players = [];
    this.events = [];
    this.lobbyChanged();
  }

  // ------------------------------------------------------------ in game
  addRemote(id) {
    if (id === this.myId || this.remotes.has(id)) return this.remotes.get(id);
    const r = new RemotePlayer(this.game, id, this.nameOf(id), this.colorOf(id));
    this.remotes.set(id, r);
    this.game.players.push(r);
    return r;
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    const i = this.game.players.indexOf(r);
    if (i >= 0) this.game.players.splice(i, 1);
  }

  // called by startGame: avatars for everybody else
  beginSession() {
    for (const [id] of this.remotes) this.removeRemote(id);
    for (const p of this.players) if (p.id !== this.myId) this.addRemote(p.id);
    this.events = [];
    this.structDirty = true;
    this.lastUp = '';
  }

  // spawn spot so players don't start inside each other
  spawnOffset() {
    const a = this.myId * 1.7;
    return this.myId ? [Math.cos(a) * 1.8, Math.sin(a) * 1.8] : [0, 0];
  }

  update(dt) {
    if (!this.active) return;
    const game = this.game;
    for (const r of this.remotes.values()) r.update(dt);
    if (!game.inGame || !game.world) return;
    this.snapT -= dt;
    if (this.isHost) {
      if (this.snapT <= 0 && this.conns.size) {
        this.snapT = 1 / SNAP_HZ;
        this.broadcast(this.buildSnapshot());
      }
    } else if (this.isClient && this.snapT <= 0 && this.conn) {
      this.snapT = 1 / INPUT_HZ;
      const p = game.player;
      this.conn.send({ t: 'in', p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.yaw), r2(p.pitch)], d: p.dead ? 1 : 0, hp: Math.round(p.hp) });
    }
  }

  buildSnapshot() {
    const g = this.game;
    const p = g.player;
    const pl = [[0, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.yaw), r2(p.pitch), p.dead ? 1 : 0, Math.round(p.hp)]];
    for (const r of this.remotes.values()) pl.push([r.id, r2(r.target.x), r2(r.target.y), r2(r.target.z), r2(r.tyaw), r2(r.tpitch), r.dead ? 1 : 0, r.hp]);
    const en = [];
    for (const e of g.enemies.list) {
      let f = 0;
      if (e.dead) f |= 1;
      if (e.hidden) f |= 2;
      if (e.leap) f |= 4;
      if (e.slamT > 0) f |= 8;
      if (e.spawnT < 1) f |= 16;
      if (e.nearBoom) f |= 32;
      en.push([e.nid, e.type, r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), r2(e.yaw), Math.round((e.hp / e.maxHp) * 1000) / 1000, f, e.atkN || 0]);
    }
    const sh = [];
    for (const s of g.build.structures) if (isFinite(s.hp)) sh.push([s.i, s.j, Math.round(s.hp)]);
    const m = {
      t: 's', ph: g.phase, w: g.wave, pt: r2(g.phaseTimer), pT: g.phaseTotal, wt: g.waveTotal, rem: g.enemiesRemaining(),
      cr: g.credits, k: g.stats.kills, core: [Math.round(g.core.hp), g.core.maxHp],
      hv: g.world.hives.reduce((a, h, i) => a | (h.active ? 1 << i : 0), 0), pl, en, sh,
    };
    this.stT = (this.stT || 0) - 1 / SNAP_HZ;
    if (this.structDirty || this.stT <= 0) {
      // full building list on every change, and every 2 s for anyone who just (re)loaded
      this.structDirty = false;
      this.stT = 2;
      m.st = g.build.structures.map((s) => [s.i, s.j, s.type, s.level, s.rotation, s.invested]);
    }
    this.upT -= 1 / SNAP_HZ;
    if (this.upT <= 0) { this.upT = 1; m.up = g.upgrades.levels; }
    if (this.events.length) { m.ev = this.events; this.events = []; }
    return m;
  }

  applySnapshot(m) {
    const g = this.game;
    g.phase = m.ph;
    if (m.w !== g.wave) g.wave = m.w;
    g.phaseTimer = m.pt;
    g.phaseTotal = m.pT;
    g.waveTotal = m.wt;
    g.netRemaining = m.rem;
    g.credits = m.cr;
    g.stats.kills = m.k;
    const core = g.core;
    if (m.core[0] < core.hp - 0.5) g.coreHitLocal();
    core.hp = m.core[0];
    core.maxHp = m.core[1];
    g.world.hives.forEach((h, i) => (h.active = !!(m.hv & (1 << i))));
    g.world.nightTarget = m.ph === 'wave' ? 1 : 0;
    for (const s of m.pl) {
      if (s[0] === this.myId) continue;
      const r = this.remotes.get(s[0]) || this.addRemote(s[0]);
      if (r) r.setState(s);
    }
    g.enemies.applyMirror(m.en);
    if (m.st) g.build.applyState(m.st);
    for (const [i, j, hp] of m.sh) {
      const nav = g.world.nav;
      const s = nav.inside(i, j) ? nav.struct[nav.idx(i, j)] : null;
      if (s) { if (hp < s.hp - 0.5) { s.flash = 0.12; s.lastHit = g.time; } s.hp = hp; }
    }
    if (m.up) {
      const key = JSON.stringify(m.up);
      if (key !== this.lastUp) {
        this.lastUp = key;
        g.upgrades.levels = { ...m.up };
        g.mods = computeMods(g.upgrades.levels);
      }
    }
    if (m.ev) for (const e of m.ev) this.onEvent(e);
  }

  // ------------------------------------------------------------ shared events
  // the local player fired: everybody else sees the tracer
  shot(from, to) {
    if (!this.active) return;
    const f = [r2(from.x), r2(from.y), r2(from.z)], t = [r2(to.x), r2(to.y), r2(to.z)];
    if (this.isHost) this.event({ k: 'tr', id: 0, f, to: t });
    else if (this.conn) this.conn.send({ t: 'tr', f, to: t });
  }

  showTracer(id, f, to) {
    const g = this.game;
    const r = this.remotes.get(id);
    const from = r ? r.avatar.muzzleWorld(_v) : _v.set(f[0], f[1], f[2]);
    _w.set(to[0], to[1], to[2]);
    g.fx.tracer(from, _w, '#fff0b0', 0.03, 0.06);
    g.fx.muzzle(from, '#ffd27a', 0.5);
    g.audio.remoteShot(from);
  }

  onEvent(e) {
    const g = this.game;
    switch (e.k) {
      case 'tr': if (e.id !== this.myId) this.showTracer(e.id, e.f, e.to); break;
      case 'wave': g.showWaveStart(e); break;
      case 'clear': g.showWaveCleared(e); break;
      case 'over': g.netGameOver(e); break;
      case 'spit': g.enemies.visualProjectile(e); break;
      case 'shock': g.fx.shockwave(e.x, e.z, e.r); g.audio.slam(_v.set(e.x, 0, e.z)); g.shake(1.2, _v); break;
      case 'boom': g.fx.explosion(_v.set(e.x, e.y, e.z), e.c || '#ffb43d', e.r); g.audio.explosion(_v, e.s || 1); break;
      case 'toast': g.hud.toast(e.m, e.kind); break;
      case 'sound': if (g.audio[e.n]) g.audio[e.n](e.p ? _v.set(e.p[0], 0, e.p[1]) : undefined); break;
      default: break;
    }
  }
}
