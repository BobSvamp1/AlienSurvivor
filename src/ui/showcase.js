import * as THREE from 'three';
import { Avatar } from '../entities/avatar.js';
import { CLASSES, CLASS_ORDER } from '../data/classes.js';
import { groundAt } from '../world/elevation.js';

// The squad shown in the menus, hero-shooter style: the four classes stand in the
// world next to the core. On the main menu the chosen one stands in front of the
// line-up; on the hero screen the camera moves in close and the hero slowly turns.

const SLOTS = [[1.0, 0, 0.6], [2.45, 0, -0.35], [3.85, 0, -1.25], [2.25, 0, -2.3]]; // anchor space: x right, z towards the camera

export class Showcase {
  constructor(game) {
    this.game = game;
    this.avatars = null;
    this.mode = 'off'; // off | lineup | hero
    this.t = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.fresh = true;
    // a warm key light for the heroes (kept in the scene so shaders don't recompile)
    this.key = new THREE.PointLight('#ffd9b0', 0, 14, 1.6);
    this.rim = new THREE.PointLight('#7ad8ff', 0, 12, 1.6);
    game.r.scene.add(this.key, this.rim);
  }

  ensure() {
    if (this.avatars) return;
    this.avatars = {};
    for (const id of CLASS_ORDER) {
      const a = new Avatar(this.game.r.scene, CLASSES[id].name, CLASSES[id].color, id);
      a.tag.visible = false;
      this.avatars[id] = a;
    }
  }

  // anchor: an open, level spot near the core where the squad can stand and the
  // camera has a clear view (searched once per map: corridors and caves are tight)
  anchor(out) {
    const w = this.game.world;
    if (this.anchorWorld !== w) {
      this.anchorWorld = w;
      this.spot = this.findSpot(w);
    }
    if (!this.spot) return null;
    this.dir = this.spot.dir; // the squad faces away from the core
    return out.copy(this.spot.p);
  }

  findSpot(w) {
    const nav = w.nav;
    const [cx, cz] = w.map.core;
    const [sx, sz] = w.map.spawn;
    const base = Math.atan2(sx - cx, sz - cz);
    const free = (x, z, h0, tol, coreCheck = false) => {
      const i = nav.ci(x), j = nav.cj(z);
      if (!nav.inside(i, j) || nav.blocked[nav.idx(i, j)] || nav.struct[nav.idx(i, j)]) return false;
      if (coreCheck && Math.hypot(x - cx, z - cz) < 5) return false; // the camera must not sit in the core
      return Math.abs(groundAt(x, z) - h0) < tol;
    };
    const p = new THREE.Vector3(), q = new THREE.Vector3(), d = new THREE.Vector3();
    // candidates: first spots in front of the core, then any open floor nearby in any direction
    const cands = [];
    for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
      for (const dist of [10, 8, 12, 6.5]) {
        const dir = base + da;
        cands.push([cx + Math.sin(dir) * dist, cz + Math.cos(dir) * dist, dir]);
      }
    }
    const far = [];
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      const x = nav.cx(i), z = nav.cz(j);
      const dd = Math.hypot(x - cx, z - cz);
      if (dd < 6 || dd > 40 || nav.blocked[nav.idx(i, j)]) continue;
      far.push([x, z, dd]);
    }
    far.sort((a, b2) => a[2] - b2[2]);
    for (const [x, z] of far) for (let k = 0; k < 8; k++) cands.push([x, z, (k / 8) * Math.PI * 2]);
    for (const [ax, az, dir] of cands) {
      {
        const sin = Math.sin(dir), cos = Math.cos(dir);
        const h0 = groundAt(ax, az);
        const tw = (x, z, out) => out.set(ax + x * cos + z * sin, 0, az - x * sin + z * cos);
        let ok = true;
        for (const [x, , z] of SLOTS) {
          tw(x, z, q);
          if (!free(q.x, q.z, h0, 0.45)) { ok = false; break; }
        }
        if (!ok) continue;
        // the whole stage (squad + camera) must be open ground: no rocks, crates or sandbags
        for (let z = -1.8; z <= 7.0 && ok; z += 0.8) {
          // around the squad the stage is wide, towards the camera a corridor is enough
          const x0 = z > 2.5 ? -1.0 : -1.2, x1 = z > 2.5 ? 2.2 : 4.4;
          for (let x = x0; x <= x1; x += 0.8) {
            tw(x, z, q);
            if (!free(q.x, q.z, h0, 0.5, z > 1)) { ok = false; break; }
          }
        }
        if (!ok) continue;
        tw(-0.4, 6.6, q); q.y = h0 + 1.5;
        tw(SLOTS[0][0], SLOTS[0][2], p); p.y = h0 + 1.2;
        d.subVectors(p, q);
        const len = d.length();
        d.normalize();
        if (w.rayGround(q, d, len + 1) < len - 0.3) continue;
        return { p: new THREE.Vector3(ax, h0, az), dir };
      }
    }
    return null;
  }

  set(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'off') this.fresh = true;
    this.mode = mode;
    if (mode === 'off' && this.avatars) for (const a of Object.values(this.avatars)) a.root.visible = false;
    this.key.intensity = mode === 'off' ? 0 : 22;
    this.rim.intensity = mode === 'off' ? 0 : 14;
  }

  update(dt) {
    if (this.mode === 'off' || !this.game.world) return false;
    this.ensure();
    this.t += dt;
    const A = this.anchor(_anchor);
    if (!A) {
      // no room for the squad on this map: the menu flies around the core instead
      for (const a of Object.values(this.avatars)) a.root.visible = false;
      return false;
    }
    const rot = this.dir;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    // anchor space -> world (z of the anchor space points away from the core)
    const toWorld = (x, y, z, out) => out.set(A.x + x * cos + z * sin, A.y + y, A.z - x * sin + z * cos);
    const sel = this.game.cls;
    const order = [sel, ...CLASS_ORDER.filter((c) => c !== sel)];
    order.forEach((id, i) => {
      const a = this.avatars[id];
      const [x, , z] = SLOTS[i];
      toWorld(x, 0, z, _p);
      _p.y = groundAt(_p.x, _p.z);
      const show = this.mode === 'lineup' || id === sel;
      a.root.visible = show;
      if (!show) return;
      // face the camera, each one a little differently
      const turn = this.mode === 'hero' ? Math.sin(this.t * 0.45) * 0.55 + 0.25 : [0.25, -0.15, 0.45, -0.3][i];
      a.update(dt, _p, rot + Math.PI + turn, -0.32 + Math.sin(this.t * 0.7 + i) * 0.03, 0, false);
      a.tag.visible = false;
    });
    // camera
    const front = this.avatars[sel];
    const fp = front.root.position;
    if (this.mode === 'lineup') {
      toWorld(-0.4, 1.35, 6.6, _c);
      toWorld(0.55, 1.6, -0.8, _l);
    } else {
      toWorld(SLOTS[0][0] - 1.0, 1.35, 3.0, _c);
      toWorld(SLOTS[0][0] - 1.2, 1.05, 0, _l);
    }
    _c.y = Math.max(_c.y, groundAt(_c.x, _c.z) + 0.6);
    const k = this.fresh ? 1 : Math.min(1, dt * 3.5);
    this.fresh = false;
    this.camPos.lerp(_c, k);
    this.camLook.lerp(_l, k);
    const cam = this.game.r.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (cam.fov !== 42) { cam.fov = 42; cam.updateProjectionMatrix(); }
    // lights: warm key from the front-left, cool rim from behind
    toWorld(-1.5, 3.2, 3.2, this.key.position);
    toWorld(3.0, 2.6, -3.5, this.rim.position);
    void fp;
    return true;
  }
}

const _anchor = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _l = new THREE.Vector3();
