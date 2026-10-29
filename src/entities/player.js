import * as THREE from 'three';
import { Avatar } from './avatar.js';
import { CLASSES } from '../data/classes.js';
import { saveSettings } from '../core/settings.js';
import { groundAt, CLIMB } from '../world/elevation.js';
import { VOID } from '../world/nav.js';

const EYE = 1.65;
const RADIUS = 0.42;
const RESPAWN_TIME = 6;
const JET_TIME = 2.6; // seconds of jetpack fuel
const JET_CEIL = 3.2; // max hover height above the ground you took off from
const STEEP = 2.2; // ground steeper than this is a cliff face you slide off

// steepness of the ground at (x, z)
function slopeAt(x, z, out) {
  const gx = (groundAt(x + 0.3, z) - groundAt(x - 0.3, z)) / 0.6;
  const gz = (groundAt(x, z + 0.3) - groundAt(x, z - 0.3)) / 0.6;
  if (out) { out.x = gx; out.z = gz; }
  return Math.hypot(gx, gz);
}
const _g = { x: 0, z: 0 };

const _h = new THREE.Vector3();
const _f = new THREE.Vector3();
const _o = new THREE.Vector3();
const _ray = new THREE.Raycaster();
export class Player {
  constructor(game) {
    this.game = game;
    this.isPlayer = true;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = RADIUS;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.look = { dx: 0, dy: 0 };
    this.reset(0, 0);

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // typing a name / code
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) game.onKey(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement || !game.running) return;
      const s = 0.0022 * game.settings.sensitivity * (this.ads ? 0.6 : 1);
      const dx = Math.max(-200, Math.min(200, e.movementX));
      const dy = Math.max(-200, Math.min(200, e.movementY));
      this.yaw -= dx * s;
      this.pitch -= dy * s * (game.settings.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
      this.look.dx += dx;
      this.look.dy += dy;
    });
    window.addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      game.onMouseDown(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('wheel', (e) => {
      if (document.pointerLockElement) game.onWheel(Math.sign(e.deltaY));
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.clearInput());
  }

  // ------------------------------------------------------------ third person (V)
  toggleView() {
    this.thirdPerson = !this.thirdPerson;
    this.game.settings.thirdPerson = this.thirdPerson;
    saveSettings(this.game.settings);
    this.game.hud.toast(this.thirdPerson ? 'Third person view' : 'First person view');
  }

  // our own body, seen in third person
  updateAvatar(dt) {
    const game = this.game;
    const want = this.thirdPerson && game.running;
    if (want && (!this.avatar || this.avatar.cls !== game.cls)) {
      if (this.avatar) this.avatar.dispose();
      const c = CLASSES[game.cls] || CLASSES.marine;
      this.avatar = new Avatar(game.r.scene, 'You', c.color, game.cls);
    }
    if (!this.avatar) return;
    this.avatar.root.visible = want;
    if (!want) return;
    this.avatar.update(dt, this.pos, this.yaw, this.pitch, this.speedNow, this.dead);
    this.avatar.tag.visible = false;
  }

  // where aim rays start: the camera, or (third person) level with the player
  aimOrigin(out) {
    const cam = this.game.r.camera;
    cam.getWorldPosition(out);
    if (this.thirdPerson && !this.dead) {
      cam.getWorldDirection(_f);
      out.addScaledVector(_f, this.tpDist || 0);
    }
    return out;
  }

  clearInput() {
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
  }

  reset(x, z) {
    this.spawnX = x;
    this.spawnZ = z;
    this.pos.set(x, groundAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.05;
    this.baseMaxHp = 100;
    this.maxHp = 100;
    this.hp = 100;
    this.maxShield = 50;
    this.shield = 50;
    this.shieldDelay = 0;
    this.dead = false;
    this.respawnT = 0;
    this.onGround = true;
    this.bobT = 0;
    this.bob = 0;
    this.speedNow = 0;
    this.regenDelay = 0;
    this.ads = false;
    this.adsT = 0;
    this.sprinting = false;
    this.landKick = 0;
    this.poolT = 0;
    this.fuel = 1;
    this.fuelDelay = 0;
    this.jetting = false;
    this.jetSnd = 0;
    this.lastGroundY = this.pos.y;
    this.safe = { x, z, t: 0 };
  }

  faceTowards(x, z) {
    this.yaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
  }

  // over-the-shoulder camera: behind and right of the head, pulled in when something
  // (a cliff, rock or wall) is in the way
  placeThirdPersonCam(cam, shake, dt) {
    const game = this.game;
    const ads = this.adsT;
    _h.set(this.pos.x, this.pos.y + 1.62 - this.landKick * 0.1, this.pos.z);
    _o.set(0.8 + 0.12 * ads, 0.2 + 0.04 * ads, 2.8 - 1.2 * ads).applyQuaternion(cam.quaternion);
    const len = _o.length();
    _o.divideScalar(len);
    let d = len;
    const gd = game.world.rayGround(_h, _o, len + 0.4);
    if (gd < d + 0.3) d = gd - 0.3;
    _ray.set(_h, _o);
    _ray.far = d + 0.3;
    const hit = _ray.intersectObjects(game.world.raycastables.concat(game.build.solidMeshes), false)[0];
    if (hit && hit.distance - 0.3 < d) d = hit.distance - 0.3;
    d = Math.max(0.25, d);
    // ease back out after being pushed in, snap in when blocked
    this.tpCur = d < (this.tpCur ?? d) ? d : (this.tpCur ?? d) + (d - (this.tpCur ?? d)) * Math.min(1, dt * 6);
    cam.position.copy(_h).addScaledVector(_o, this.tpCur);
    cam.position.x += shake.x; cam.position.y += shake.y; cam.position.z += shake.z;
    // shots start from where the player stands, not from behind them
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.tpDist = Math.max(0, -_o.dot(_f) * this.tpCur) + 0.4;
  }

  chest(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
  }

  hurt(amount, fromPos = null) {
    if (this.dead || this.game.over) return;
    // the personal energy shield soaks damage first
    const absorbed = Math.min(this.shield, amount);
    const hadShield = this.shield > 0;
    this.shield -= absorbed;
    this.shieldDelay = 3.5;
    if (hadShield && this.shield <= 0) { this.game.audio.error(); this.game.hud.toast('Shield down!', 'bad'); }
    amount -= absorbed;
    this.hp -= amount;
    if (amount > 0) this.regenDelay = 4;
    this.game.hud.damageFlash(Math.min(1, amount / 25 + absorbed / 80));
    if (fromPos) this.game.hud.damageDir(fromPos);
    this.game.audio.hurt();
    this.game.shake(Math.min(0.5, amount / 40));
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.respawnT = RESPAWN_TIME;
      this.clearInput();
      this.game.stats.deaths++;
      this.game.hud.setDead(true);
      this.game.build.setMode(null);
    }
  }

  update(dt) {
    const game = this.game;
    const cam = game.r.camera;
    const mods = game.mods;
    this.maxHp = this.baseMaxHp + mods.maxHpBonus;

    if (this.dead) {
      this.respawnT -= dt;
      game.hud.setDeadTimer(this.respawnT);
      const c = game.core.pos;
      const t = game.time * 0.15;
      cam.position.lerp(new THREE.Vector3(c.x + Math.sin(t) * 22, c.y + 16, c.z + Math.cos(t) * 22), Math.min(1, dt * 1.5));
      cam.lookAt(c.x, c.y + 2, c.z);
      if (this.respawnT <= 0) {
        this.dead = false;
        this.hp = this.maxHp;
        this.shield = this.maxShield;
        this.pos.set(this.spawnX, groundAt(this.spawnX, this.spawnZ), this.spawnZ);
        this.vel.set(0, 0, 0);
        this.lastGroundY = this.pos.y;
        this.fuel = 1;
        this.faceTowards(this.spawnX, this.spawnZ - 10);
        game.hud.setDead(false);
      } else return;
    }

    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.ads = this.mouse.right && game.build.mode === null && !game.weapon.reloading;
    this.sprinting = (k.has('ShiftLeft') || k.has('ShiftRight')) && f > 0 && !this.ads && !this.mouse.left;
    let speed = (this.sprinting ? 10.5 : 6.6) * mods.speedMult * (this.ads ? 0.6 : 1);
    if (game.world.nav.poolAt(this.pos.x, this.pos.z)) {
      speed *= 0.65;
      this.poolT -= dt;
      if (this.poolT <= 0 && this.onGround && !mods.acidImmune) {
        this.poolT = 0.5;
        this.hurt(5);
        game.fx.burst(new THREE.Vector3(this.pos.x, 0.2, this.pos.z), '#b6ff3d', 6, 2, 0.08);
      }
    }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    // jetpack: hold Space in the air to hover slowly (limited fuel, refills on the ground)
    const wantJet = k.has('Space') && !this.onGround && this.fuel > 0 && this.vel.y < 2.5;
    this.jetting = wantJet;
    const accel = this.onGround ? 12 : this.jetting ? 4.5 : 2.5;
    const a = Math.min(1, accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * a;
    this.vel.z += (wz * speed - this.vel.z) * a;
    if (k.has('Space') && this.onGround) {
      this.vel.y = 8.2;
      this.onGround = false;
    }
    if (this.jetting) {
      // rise gently up to a ceiling, then hover; never higher than JET_CEIL over where you took off
      const ceil = this.lastGroundY + JET_CEIL;
      const target = this.pos.y < ceil - 0.3 ? 2.4 : this.pos.y < ceil ? 0.4 : -0.6;
      this.vel.y += (target - this.vel.y) * Math.min(1, dt * 5);
      this.fuel = Math.max(0, this.fuel - dt / (JET_TIME * game.mods.jetMult));
      this.fuelDelay = 0.5;
      this.jetSnd -= dt;
      if (this.jetSnd <= 0) {
        this.jetSnd = 0.085;
        game.audio.jet(this.pos);
        if (Math.random() < 0.7) game.fx.fire(new THREE.Vector3(this.pos.x - Math.sin(this.yaw) * -0.35, this.pos.y + 0.6, this.pos.z - Math.cos(this.yaw) * -0.35));
      }
    } else {
      this.vel.y -= 24 * dt;
    }
    // horizontal move: you can walk up ramps and small steps, but not up a cliff
    const ox = this.pos.x, oz = this.pos.z;
    const nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
    const nav = game.world.nav;
    const canGo = (x, z) => {
      const g = groundAt(x, z);
      if (g > this.pos.y + CLIMB) return false;
      // places the swarm can never reach are off limits (tops of the rock walls)
      const i = nav.ci(x), j = nav.cj(z);
      if (nav.inside(i, j) && nav.blocked[nav.idx(i, j)] === VOID && g > this.lastGroundY + 1.2) return false;
      return true;
    };
    if (canGo(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else if (canGo(nx, oz)) { this.pos.x = nx; this.vel.z = 0; }
    else if (canGo(ox, nz)) { this.pos.z = nz; this.vel.x = 0; }
    else { this.vel.x = 0; this.vel.z = 0; }
    this.pos.y += this.vel.y * dt;
    // buildings only block you while you're below their top: jetpack over walls, stand on low ones
    const feet = this.pos.y;
    game.resolveCircle(this.pos, RADIUS, (st) => feet >= game.build.topOf(st) - 0.3);
    if (groundAt(this.pos.x, this.pos.z) > this.pos.y + CLIMB) { this.pos.x = ox; this.pos.z = oz; }
    const terrain = groundAt(this.pos.x, this.pos.z);
    const standOn = game.build.standTop(this.pos.x, this.pos.z, RADIUS * 0.7, this.pos.y);
    const onStruct = standOn > terrain;
    const ground = onStruct ? standOn : terrain;
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -6) { this.landKick = Math.min(1, -this.vel.y / 14); game.audio.footstep(); }
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && this.vel.y <= 0 && this.pos.y - ground < 0.45) {
      // stick to the ground when walking down a ramp
      this.pos.y = ground;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
    // a cliff face is too steep to stand on: slide down it (no jumping up walls)
    this.sliding = false;
    if (this.onGround && !onStruct && slopeAt(this.pos.x, this.pos.z, _g) > STEEP) {
      const l = Math.hypot(_g.x, _g.z) || 1;
      this.pos.x -= (_g.x / l) * 7 * dt;
      this.pos.z -= (_g.z / l) * 7 * dt;
      this.pos.y = Math.min(this.pos.y, groundAt(this.pos.x, this.pos.z) + 0.05);
      this.pos.y = Math.max(this.pos.y, groundAt(this.pos.x, this.pos.z));
      this.sliding = true;
      this.onGround = false;
    }
    if (this.onGround) {
      this.lastGroundY = onStruct ? terrain : this.pos.y; // the jetpack ceiling counts from the real ground
      this.fuelDelay -= dt;
      if (this.fuelDelay <= 0) this.fuel = Math.min(1, this.fuel + dt * 0.55);
      // remember a safe spot the swarm can reach too
      const i = nav.ci(this.pos.x), j = nav.cj(this.pos.z);
      const b = nav.inside(i, j) ? nav.blocked[nav.idx(i, j)] : VOID;
      this.safe.t -= dt;
      if (b !== VOID && this.safe.t <= 0) { this.safe.x = this.pos.x; this.safe.z = this.pos.z; this.safe.t = 0.4; }
      if (b === VOID && this.pos.y > 1.5 && this.pos.y > groundAt(this.safe.x, this.safe.z) + 1.5) {
        // somehow got on top of a wall: put them back where they were
        this.pos.set(this.safe.x, groundAt(this.safe.x, this.safe.z), this.safe.z);
        this.lastGroundY = this.pos.y;
        this.vel.set(0, 0, 0);
      }
    }

    // fell into a chasm: hurt and climb back out at the spawn point
    if (this.pos.y < -3.5) {
      this.pos.set(this.spawnX, groundAt(this.spawnX, this.spawnZ), this.spawnZ);
      this.vel.set(0, 0, 0);
      this.lastGroundY = this.pos.y;
      this.hurt(35);
      game.hud.toast('You fell into the abyss!', 'warn');
    }
    this.regenDelay -= dt;
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 5 * mods.regenMult * dt);
    this.shieldDelay -= dt;
    if (this.shieldDelay <= 0 && this.shield < this.maxShield) this.shield = Math.min(this.maxShield, this.shield + 18 * mods.regenMult * dt);

    // Camera
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    const prevBob = Math.sin(this.bobT);
    if (this.onGround && this.speedNow > 0.5) this.bobT += dt * this.speedNow * 1.25;
    if (Math.sign(Math.sin(this.bobT)) !== Math.sign(prevBob) && this.speedNow > 1) game.audio.footstep();
    const bobAmt = this.onGround ? Math.min(1, this.speedNow / 7) * (this.ads ? 0.3 : 1) : 0;
    const bobTarget = Math.abs(Math.sin(this.bobT)) * 0.07 * bobAmt - 0.035 * bobAmt;
    this.bob += (bobTarget - this.bob) * Math.min(1, dt * 14);
    this.landKick = Math.max(0, this.landKick - dt * 4);
    this.adsT += ((this.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);

    const shake = game.shakeOffset;
    cam.position.set(this.pos.x + shake.x, this.pos.y + 1.65 + this.bob - this.landKick * 0.18 + shake.y, this.pos.z + shake.z);
    const roll = Math.sin(this.bobT * 0.5) * 0.004 * bobAmt - (s * 0.012);
    cam.rotation.set(this.pitch + shake.p, this.yaw + shake.q, this.thirdPerson ? 0 : roll, 'YXZ');
    this.tpDist = 0;
    if (this.thirdPerson) this.placeThirdPersonCam(cam, shake, dt);
    const base = game.settings.fov;
    const targetFov = this.ads ? base * 0.68 : this.sprinting ? base + 7 : base;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    game.audio.setListener(this.pos.x, this.pos.z, this.yaw);
  }
}
