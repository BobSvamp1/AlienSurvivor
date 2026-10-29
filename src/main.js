import * as THREE from 'three';
import './style.css';
import { Renderer } from './core/renderer.js';
import { installHeightFog } from './world/atmosphere.js';
installHeightFog();
import { loadSettings, saveRecord, bestWave, saveStars } from './core/settings.js';
import { Upgrades } from './core/upgrades.js';
import { computeMods } from './data/upgrades.js';
import { getMap, DIFFICULTIES } from './data/maps.js';
import { WavePlanner } from './data/waves.js';
import { ENEMIES } from './data/enemies.js';
import { BUILDINGS } from './data/buildings.js';
import { getClass, CLASSES } from './data/classes.js';
import { World } from './world/world.js';
import { Player } from './entities/player.js';
import { Weapon } from './entities/weapon.js';
import { EnemyManager } from './entities/enemies.js';
import { BuildSystem, buildModel } from './entities/buildings.js';
import { Effects } from './fx/effects.js';
import { Audio } from './fx/audio.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { veinClock } from './world/textures.js';
import { Net } from './net/net.js';
import { Showcase } from './ui/showcase.js';

const FIRST_BUILD_TIME = 180;
const BUILD_TIME = 180; // 3 minutes to build between waves (G starts the next wave early)

const game = {
  time: 0,
  credits: 0,
  wave: 0,
  phase: 'menu', // menu | build | wave
  phaseTimer: 0,
  phaseTotal: 1,
  inGame: false,
  over: false,
  paused: false,
  armoryOpen: false,
  spawnQueue: [],
  spawnTimer: 0,
  waveTotal: 1,
  waveExtra: 0,
  stats: null,
  mods: computeMods({}),
  settings: loadSettings(),
  shakeT: 0,
  shakeOffset: { x: 0, y: 0, z: 0, p: 0, q: 0 },
  mapId: null,
  difficulty: 'veteran',
  world: null,
  pulseT: 0,
  coreAlarmT: 0,
};
window.game = game; // handy for debugging in the browser console
game.cls = CLASSES[game.settings.cls] ? game.settings.cls : 'marine';

game.r = new Renderer(document.getElementById('app'));
game.r.setQuality(game.settings.quality);
game.audio = new Audio();
game.upgrades = new Upgrades(game);
game.fx = new Effects(game);
game.build = new BuildSystem(game);
game.enemies = new EnemyManager(game);
game.player = new Player(game);
game.players = [game.player]; // ready for co-op: more players go here
game.weapon = new Weapon(game);
game.hud = new Hud(game);
game.net = new Net(game);
game.showcase = new Showcase(game);
game.menus = new Menus(game);

// in co-op the world keeps running while someone is in a menu
Object.defineProperty(game, 'running', { get: () => game.inGame && !game.over && (game.net.active || (!game.paused && !game.armoryOpen)) });

const canvas = game.r.domElement;
const fade = document.getElementById('fade');
const clickToPlay = document.getElementById('click-to-play');

// ------------------------------------------------------------ helpers
game.addCredits = (n) => { game.credits += Math.round(n); };

// co-op: more players means a bigger and slightly tougher swarm
game.coopK = () => Math.max(0, game.players.length - 1);

game.enemyMult = () => {
  const d = DIFFICULTIES[game.difficulty];
  const w = game.wave - 1;
  // health keeps climbing, and from wave 12 the swarm also gets faster
  return {
    hp: (1 + 0.12 * w + 0.007 * w * w) * d.hp * (1 + 0.1 * game.coopK()),
    dmg: (1 + 0.05 * w) * d.dmg,
    spd: 1 + Math.min(0.45, Math.max(0, game.wave - 12) * 0.02),
  };
};

game.enemiesRemaining = () => (game.net.isClient ? game.netRemaining || 0 : game.spawnQueue.length + game.enemies.aliveCount);

game.damageCore = (n, fromPos) => {
  if (game.over) return;
  const core = game.core;
  core.hp -= n;
  core.hitFlash = 1;
  game.hud.coreHit();
  game.audio.coreHit();
  game.coreAlarmT -= 0;
  if (game.time - (game.lastAlarm || -99) > 6) {
    game.lastAlarm = game.time;
    game.hud.toast('The core is under attack!', 'bad');
    game.audio.alarm();
  }
  if (core.hp <= 0) {
    core.hp = 0;
    gameOver();
  }
};

game.shake = (amount, pos) => {
  if (!game.settings.screenShake) return;
  let k = amount;
  if (pos) k *= 1 / (1 + Math.hypot(pos.x - game.player.pos.x, pos.z - game.player.pos.z) * 0.08);
  game.shakeT = Math.min(1, game.shakeT + k);
};

game.resolveCircle = (pos, r) => {
  game.world.nav.pushOut(pos, r);
  const core = game.core;
  const dx = pos.x - core.pos.x, dz = pos.z - core.pos.z;
  const d = Math.hypot(dx, dz);
  const min = core.radius + r;
  if (d < min && d > 1e-4) { pos.x = core.pos.x + (dx / d) * min; pos.z = core.pos.z + (dz / d) * min; }
};

function lockPointer() {
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => showClickToPlay());
  } catch { showClickToPlay(); }
}
function showClickToPlay() {
  if (game.inGame && !game.over && !game.menus.open) clickToPlay.classList.remove('hidden');
}
clickToPlay.addEventListener('click', () => { clickToPlay.classList.add('hidden'); lockPointer(); });
document.addEventListener('pointerlockerror', showClickToPlay);

// ------------------------------------------------------------ world loading
function loadWorld(mapId) {
  if (game.world && game.world.map.id === mapId) return;
  if (game.world) game.world.dispose();
  game.enemies.clear();
  game.build.clear();
  game.fx.clear();
  game.world = new World(game, getMap(mapId));
  game.core = game.world.core;
  game.build.init();
  game.hud.prepareRadar(game.world);
  game.r.setQuality(game.settings.quality); // refresh shadow maps for the new lights
  warmup();
}

// Compile all shaders up front so the first alien / building doesn't cause a hitch
function warmup() {
  const temp = [];
  const wasInGame = game.inGame;
  for (const t of ['drone', 'spitter', 'bloater', 'queen', 'wasp', 'serpent', 'ravager', 'floater', 'bulwark']) temp.push(game.enemies.spawn(t, 0, -9999, { hp: 1, dmg: 1 }, false));
  const models = Object.keys(BUILDINGS).map((t) => { const P = buildModel(t, 2); P.group.position.set(0, 0, -9990); game.r.scene.add(P.group); return P.group; });
  game.fx.burst(new THREE.Vector3(0, -50, 0), '#fff', 4, 1, 0.1);
  game.enemies.updateLegs();
  try { game.r.renderer.compile(game.r.scene, game.r.camera); } catch { /* ignore */ }
  game.enemies.clear();
  for (const m of models) game.r.scene.remove(m);
  game.inGame = wasInGame;
}

game.previewMap = (mapId) => {
  if (game.inGame) return;
  fade.classList.remove('out');
  setTimeout(() => {
    loadWorld(mapId);
    game.world.nightTarget = 0.35;
    fade.classList.add('out');
  }, 180);
};

// ------------------------------------------------------------ waves
function startWave() {
  if (game.phase !== 'build') return;
  game.wave++;
  game.phase = 'wave';
  const d = DIFFICULTIES[game.difficulty];
  const final = !game.endless && game.wave === game.totalWaves;
  const plan = game.planner.plan(game.wave, d.count * (1 + 0.3 * game.coopK()), { final });
  game.spawnQueue = plan.list;
  game.waveTotal = game.spawnQueue.length;
  game.spawnTimer = 2;
  game.waveExtra = 0;
  const hives = game.world.hives;
  // the hives were picked in advance, so their paths could be shown while building
  game.activeHives = game.nextHives && game.nextHives.length ? game.nextHives : [0];
  const n = game.activeHives.length;
  hives.forEach((h, i) => (h.active = game.activeHives.includes(i)));
  game.world.nightTarget = 1;
  const info = { k: 'wave', w: game.wave, boss: plan.boss, n, total: game.waveTotal, theme: plan.themeName, intro: plan.intro, final };
  game.net.event(info);
  game.showWaveStart(info);
}

// which hives open on the next wave (shown as paths during the build phase)
function chooseNextHives() {
  const hives = game.world.hives;
  const w = game.wave + 1;
  const n = Math.min(hives.length, 1 + Math.floor((w - 1) / 2));
  const order = hives.map((_, i) => i).sort(() => Math.random() - 0.5);
  game.nextHives = order.slice(0, n);
  if (game.world.paths) game.world.paths.dirty = true;
}

// wave announcement (also shown on co-op clients when the host starts a wave)
game.showWaveStart = (e) => {
  game.wave = e.w;
  game.audio.setCombat(true);
  if (e.final) {
    game.hud.message('FINAL WAVE', 'Everything the hives have left is coming. Hold the core!', { kicker: 'WARNING', style: 'boss', dur: 4.5 });
  } else if (e.boss) {
    game.hud.message(`WAVE ${e.w}`, e.boss === 'queen' ? 'The Brood Queen approaches' : 'A Hive Titan is coming', { kicker: 'WARNING', style: 'boss', dur: 4 });
  } else {
    game.hud.message(`WAVE ${e.w}`, `${e.total} aliens from ${e.n} ${e.n === 1 ? 'hive' : 'hives'}`, { kicker: e.theme ? `${e.theme} WAVE` : 'NIGHT FALLS', style: 'danger', dur: 3.2 });
  }
  if (e.intro) game.hud.introAlien(e.intro, ENEMIES[e.intro]);

  game.audio.wave(!!e.boss);
  if (game.armoryOpen) game.closeArmory();
  if (game.build.mode) game.build.setMode(game.build.mode);
};

function endWave() {
  if (!game.endless && game.wave >= game.totalWaves) { victory(); return; }
  game.phase = 'build';
  game.phaseTimer = game.phaseTotal = BUILD_TIME;
  const bonus = 60 + game.wave * 10;
  game.addCredits(bonus);
  game.world.nightTarget = 0;
  game.world.hives.forEach((h) => (h.active = false));
  chooseNextHives();
  const info = { k: 'clear', w: game.wave, bonus };
  game.net.event(info);
  game.showWaveCleared(info);
}

game.showWaveCleared = (e) => {
  game.audio.setCombat(false);
  game.hud.message(`WAVE ${e.w} CLEARED`, `+${e.bonus} crystals · press B to open the armory`, { kicker: 'DAWN BREAKS', dur: 3.5 });
  if (game.bestAtStart && e.w === game.bestAtStart + 1) game.hud.toast(`New record on this map: wave ${e.w} survived!`, 'good');
  game.audio.cleared();
  saveRecord(game.mapId, game.difficulty, e.w);
};

// co-op client: the host says the core took damage
game.coreHitLocal = () => {
  game.core.hitFlash = 1;
  game.hud.coreHit();
  game.audio.coreHit();
  if (game.time - (game.lastAlarm || -99) > 6) {
    game.lastAlarm = game.time;
    game.hud.toast('The core is under attack!', 'bad');
    game.audio.alarm();
  }
};

function updateWave(dt) {
  if (game.phase === 'build') {
    game.phaseTimer -= dt;
    if (game.phaseTimer <= 0) startWave();
  } else if (game.phase === 'wave') {
    game.spawnTimer -= dt;
    if (game.spawnQueue.length && game.spawnTimer <= 0) {
      const type = game.spawnQueue.shift();
      game.spawnTimer = type === 'swarmling' ? 0.18 : Math.max(0.3, 1.15 - game.wave * 0.05);
      const hi = game.activeHives[Math.floor(Math.random() * game.activeHives.length)];
      const h = game.world.hives[hi];
      const a = Math.random() * Math.PI * 2;
      const x = h.pos.x + Math.cos(a) * 1.2;
      const z = h.pos.z + Math.sin(a) * 1.2;
      const mult = game.enemyMult();
      // bosses are scaled more gently than the swarm, so they are a challenge rather than a wall
      if (type === 'queen' || type === 'titan') {
        const w = game.wave;
        mult.hp *= w <= 5 ? 0.5 : w <= 10 ? 0.45 : w <= 15 ? 0.5 : w <= 20 ? 0.62 : 0.8;
        if (!game.endless && w === game.totalWaves) mult.hp *= 0.85; // the final wave has two of them
      }
      game.enemies.spawn(type, x, z, mult, true);
      game.fx.burst(new THREE.Vector3(x, h.pos.y + 1.5, z), '#b04dff', 6, 4, 0.12);
    }
    if (!game.spawnQueue.length && game.enemies.aliveCount === 0) endWave();
  }
}

function updateCorePulse(dt) {
  const lvl = game.mods.corePulse;
  if (!lvl || game.phase !== 'wave') return;
  game.pulseT -= dt;
  if (game.pulseT > 0) return;
  const c = game.core.pos;
  const near = game.enemies.list.some((e) => !e.dead && Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 10);
  if (!near) return;
  game.pulseT = 7 - lvl * 1.5;
  game.fx.ring(c.x, c.z, 11, '#3de0ff', 0.6);
  game.fx.flash(new THREE.Vector3(c.x, c.y + 3, c.z), '#3de0ff', 40, 0.3);
  game.audio.pulse(c);
  for (const e of game.enemies.list) {
    if (e.dead) continue;
    const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
    if (d < 10) { game.enemies.damage(e, 50 * lvl, { explosive: true }); e.shock = 0.8; }
  }
}

// ------------------------------------------------------------ game flow
game.startGame = (mapId, difficulty, opts = {}) => {
  // co-op: only the host starts games; friends follow the host's start message
  if (game.net.isClient && !opts.fromNet) return;
  game.audio.init(game.settings);
  lockPointer();
  fade.classList.remove('out');
  game.menus.hideAll();
  setTimeout(() => {
    game.mapId = mapId;
    game.difficulty = difficulty;
    game.endless = !!opts.endless;
    game.totalWaves = game.endless ? 0 : getMap(mapId).waves || 20;
    game.session = (game.session || 0) + 1;
    // always rebuild the world for a fresh round
    if (game.world) { game.world.dispose(); game.world = null; }
    loadWorld(mapId);
    if (!CLASSES[game.cls]) game.cls = 'marine';
    game.upgrades.reset(); // (also applies the class perk)
    game.weapon.setKind(getClass(game.cls).weapon);
    game.hud.buildHotbar(game.cls);
    // every run gets its own order of new aliens and wave themes
    game.planner = new WavePlanner((Math.random() * 2 ** 32) >>> 0, getMap(mapId).enemyBias || {});
    game.bestAtStart = bestWave(mapId, difficulty);
    const map = game.world.map;
    const [ox, oz] = game.net.active ? game.net.spawnOffset() : [0, 0];
    game.player.reset(map.spawn[0] + ox, map.spawn[1] + oz);
    game.player.faceTowards(map.core[0], map.core[1] - 30);
    if (map.id === 'canyon') game.player.faceTowards(0, -20);
    game.weapon.reset();
    game.core.maxHp = 1500;
    game.core.hp = game.core.maxHp;
    game.credits = DIFFICULTIES[difficulty].credits;
    game.wave = 0;
    game.time = 0;
    game.stats = { kills: 0, damage: 0, built: 0, deaths: 0 };
    game.phase = 'build';
    game.phaseTimer = game.phaseTotal = FIRST_BUILD_TIME;
    chooseNextHives();
    game.spawnQueue = [];
    game.inGame = true;
    game.over = false;
    game.paused = false;
    game.armoryOpen = false;
    game.world.nightTarget = 0;
    game.world.night = 0.001;
    game.audio.setCombat(false);
    game.hud.show(true);
    game.hud.setDead(false);
    game.hud.message('PREPARE DEFENSES', 'Red arrows show where the swarm will walk · build traps on their path (keys 2–8)', { kicker: game.world.map.name.toUpperCase(), dur: 4.5 });
    if (game.net.active) {
      game.net.beginSession();
      if (game.net.isHost) game.net.broadcast(game.net.startMsg());
    }
    fade.classList.add('out');
  }, 350);
};

// all waves survived: the mission is won
function victory() {
  if (game.over) return;
  const frac = game.core.hp / game.core.maxHp;
  const stars = frac >= 0.9 ? 3 : frac >= 0.5 ? 2 : 1;
  const info = { k: 'win', stats: { ...game.stats }, waves: game.wave, time: game.time, stars, core: Math.round(frac * 100) };
  game.net.event(info);
  if (game.net.isHost) game.net.broadcast(game.net.buildSnapshot());
  game.phase = 'won';
  game.showVictory(info);
}

game.showVictory = (e) => {
  if (game.over) return;
  game.over = true;
  game.audio.stopLoops();
  game.build.setMode(null);
  game.player.clearInput();
  game.audio.setCombat(false);
  game.audio.cleared();
  game.world.nightTarget = 0;
  game.hud.message('VICTORY', `The outpost holds! ${'★'.repeat(e.stars)}${'☆'.repeat(3 - e.stars)}`, { kicker: 'MISSION COMPLETE', dur: 3 });
  const better = saveStars(game.mapId, game.difficulty, e.stars);
  saveRecord(game.mapId, game.difficulty, e.waves);
  const session = game.session;
  setTimeout(() => {
    if (!game.over || game.session !== session) return;
    if (document.pointerLockElement) document.exitPointerLock();
    game.hud.show(false);
    game.weapon.root.visible = false;
    game.menus.showGameOver({ ...e.stats, waves: e.waves, time: e.time }, better, { win: true, stars: e.stars, core: e.core });
  }, 3200);
};

function gameOver() {
  const survived0 = Math.max(0, game.wave - 1);
  game.net.event({ k: 'over', stats: { ...game.stats }, waves: survived0, time: game.time });
  if (game.net.isHost) game.net.broadcast(game.net.buildSnapshot()); // send it right away
  game.over = true;
  game.audio.stopLoops();
  game.build.setMode(null);
  game.player.clearInput();
  game.audio.setCombat(false);
  game.audio.squish(true, game.core.pos);
  game.fx.explosion(new THREE.Vector3(game.core.pos.x, game.core.pos.y + 2, game.core.pos.z), '#3de0ff', 6);
  const survived = Math.max(0, game.wave - 1);
  const rec = saveRecord(game.mapId, game.difficulty, survived);
  const session = game.session;
  setTimeout(() => {
    if (!game.over || game.session !== session) return;
    if (document.pointerLockElement) document.exitPointerLock();
    game.hud.show(false);
    game.weapon.root.visible = false;
    game.menus.showGameOver({ ...game.stats, waves: survived, time: game.time }, rec && survived > 0);
  }, 1800);
}

// co-op client: the host lost
game.netGameOver = (e) => {
  if (game.over) return;
  game.over = true;
  game.audio.stopLoops();
  game.build.setMode(null);
  game.player.clearInput();
  game.audio.setCombat(false);
  game.audio.squish(true, game.core.pos);
  game.fx.explosion(new THREE.Vector3(game.core.pos.x, game.core.pos.y + 2, game.core.pos.z), '#3de0ff', 6);
  const session = game.session;
  setTimeout(() => {
    if (!game.over || game.session !== session) return;
    if (document.pointerLockElement) document.exitPointerLock();
    game.hud.show(false);
    game.weapon.root.visible = false;
    game.menus.showGameOver({ ...e.stats, waves: e.waves, time: e.time }, false);
  }, 1800);
};

// co-op: end the round but keep everybody in the lobby
game.backToLobby = () => {
  if (game.net.isHost) game.net.broadcast({ t: 'tolobby' });
  game.quitToMenu(true);
  game.menus.reset('lobby');
};

game.quitToMenu = (keepNet = false) => {
  if (game.net.active && keepNet !== true) game.net.leave();
  game.inGame = false;
  game.over = false;
  game.paused = false;
  game.armoryOpen = false;
  game.phase = 'menu';
  game.enemies.clear();
  game.build.clear();
  game.fx.clear();
  game.hud.show(false);
  game.weapon.root.visible = false;
  game.audio.stopLoops();
  game.player.clearInput();
  game.audio.setCombat(false);
  if (game.world) { game.world.nightTarget = 0.35; game.world.hives.forEach((h) => (h.active = false)); game.core.hp = game.core.maxHp; }
  game.menus.reset('main');
};

game.pause = () => {
  if (!game.inGame || game.over || game.armoryOpen || game.paused) return;
  game.paused = true;
  game.audio.stopLoops();
  game.player.clearInput();
  game.menus.reset('pause');
};

game.resume = () => {
  game.audio.init(game.settings);
  game.menus.hideAll();
  game.paused = false;
  clickToPlay.classList.add('hidden');
  lockPointer();
};

game.openArmory = () => {
  if (game.phase !== 'build' || game.over) {
    game.hud.toast('The armory is only open between waves', 'warn');
    game.audio.error();
    return;
  }
  game.armoryOpen = true;
  game.player.clearInput();
  game.menus.reset('armory');
  if (document.pointerLockElement) document.exitPointerLock();
};

game.closeArmory = () => {
  game.armoryOpen = false;
  game.menus.hideAll();
  lockPointer();
};

// ------------------------------------------------------------ input
// hotbar modes: the rifle (null), then the class's buildings
const modes = () => [null, ...getClass(game.cls).build];

game.onKey = (code) => {
  if (!game.inGame || game.over) return;
  if (code === 'KeyB' || code === 'Tab') {
    if (game.armoryOpen) game.closeArmory();
    else if (game.running) game.openArmory();
    return;
  }
  if (!game.running) return;
  const p = game.player;
  if (p.dead) return;
  let n = parseInt(code.replace('Digit', ''), 10);
  if (n === 0) n = 10; // key 0 is the 10th slot
  const MODES = modes();
  if (code.startsWith('Digit') && n >= 1 && n <= MODES.length) {
    game.build.setMode(MODES[n - 1]);
    if (n > 1) game.audio.click();
  }
  if (code === 'KeyQ') game.build.setMode(null);
  if (code === 'KeyR') {
    if (game.build.mode) game.build.rotate();
    else game.weapon.startReload();
  }
  if (code === 'KeyG' && game.phase === 'build') {
    if (game.net.isClient) game.net.request({ a: 'wave' });
    else startWave();
  }
  const s = game.build.aimed;
  if (s) {
    if (code === 'KeyE') game.build.upgrade(s);
    if (code === 'KeyF') game.build.repair(s);
    if (code === 'KeyX') game.build.sell(s);
    if (code === 'KeyT') game.build.turn(s);
  }
};

game.onMouseDown = (button) => {
  if (!game.running || game.player.dead) return;
  if (game.build.mode) {
    if (button === 0) game.build.tryPlace();
    if (button === 2) game.build.setMode(null);
  }
};

game.onWheel = (dir) => {
  if (!game.running || game.player.dead) return;
  const MODES = modes();
  const i = MODES.indexOf(game.build.mode);
  game.build.setMode(MODES[(i + dir + MODES.length) % MODES.length]);
};

canvas.addEventListener('click', () => {
  if (game.running && !document.pointerLockElement) lockPointer();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    clickToPlay.classList.add('hidden');
  } else if (game.inGame && !game.over && !game.armoryOpen && !game.paused) {
    game.pause();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.armoryOpen) game.closeArmory();
});

// ------------------------------------------------------------ main loop
let last = performance.now();
let menuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(dt);
  if (!window.__noRender) game.r.render(now / 1000);
}

function updateShake(dt) {
  game.shakeT = Math.max(0, game.shakeT - dt * 1.8);
  const s = game.shakeT * game.shakeT;
  const t = performance.now() / 1000;
  const o = game.shakeOffset;
  o.x = Math.sin(t * 37) * 0.08 * s;
  o.y = Math.sin(t * 43 + 1) * 0.08 * s;
  o.z = Math.sin(t * 31 + 2) * 0.08 * s;
  o.p = Math.sin(t * 29 + 3) * 0.03 * s;
  o.q = Math.sin(t * 33 + 4) * 0.03 * s;
}

function step(dt) {
  if (game.running) {
    game.time += dt;
    updateShake(dt);
    game.player.update(dt);
    game.weapon.update(dt);
    game.build.update(dt);
    veinClock.value += dt;
    if (game.net.isClient) {
      game.enemies.updateMirror(dt); // the host runs the aliens; we only show them
    } else {
      game.enemies.update(dt);
      updateWave(dt);
      updateCorePulse(dt);
    }
    game.audio.updateAliens(dt, game.enemies.list);
    game.hud.update(dt);
  } else if (!game.inGame && game.world) {
    game.weapon.root.visible = false; // no gun floating in front of the menu camera
    // slow camera flight behind the menu
    menuT += dt;
    if (game.showcase.update(dt)) { /* the squad line-up drives the camera */ } else {
    const c = game.core.pos;
    const t = menuT * 0.05;
    const cam = game.r.camera;
    cam.position.set(c.x + Math.sin(t) * 30, c.y + 11 + Math.sin(t * 0.7) * 2, c.z + Math.cos(t) * 30);
    cam.lookAt(c.x - Math.cos(t) * 8, c.y + 3, c.z + Math.sin(t) * 8);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    }
  }
  if (game.world) game.world.update(dt, game.inGame ? game.time : performance.now() / 1000);
  if (game.inGame && !game.running) {
    // keep the HUD values fresh while paused / in the armory
    game.hud.update(0);
  }
  game.net.update(dt);
  game.fx.update(game.running || !game.inGame ? dt : 0);
  game.audio.updateMusic(dt);
}

game.step = step; // used by automated tests
game.startWave = startWave;

// ------------------------------------------------------------ boot
loadWorld('crash');
game.world.nightTarget = 0.35;
game.menus.reset('main');
setTimeout(() => fade.classList.add('out'), 100);
document.addEventListener('pointerdown', () => game.audio.init(game.settings), { once: true });
requestAnimationFrame(frame);
