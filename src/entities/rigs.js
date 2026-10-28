import * as THREE from 'three';
import { groundAt } from '../world/elevation.js';
import { chitinNormal, applyVeins } from '../world/textures.js';
import { texSet } from '../core/materials.js';

// Non-spider alien bodies: segmented worms/snakes, two-legged raptors and floating jellies.
// They share the same interface as BugRig so the EnemyManager can drive any of them.

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
const coneGeo = new THREE.ConeGeometry(1, 1, 8);
const cylGeo = new THREE.CylinderGeometry(1, 0.7, 1, 8).translate(0, 0.5, 0);

let chitin = null;
let rough = null;
function shared() {
  if (!chitin) chitin = chitinNormal();
  if (!rough) {
    rough = texSet('rock').arm.clone();
    rough.repeat.set(2, 2);
    rough.needsUpdate = true;
  }
}

class RigBase {
  constructor(def, scene) {
    shared();
    this.def = def;
    this.rig = def.rig;
    this.scene = scene;
    this.s = def.rig.scale;
    const C = def.colors;
    this.skin = new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.6, metalness: 0.05, normalMap: chitin, normalScale: new THREE.Vector2(0.35, 0.35) });
    this.shell = new THREE.MeshPhysicalMaterial({
      color: C.shell, roughness: 0.55, metalness: 0.1, clearcoat: 0.22, clearcoatRoughness: 0.55, roughnessMap: rough,
      normalMap: chitin, normalScale: new THREE.Vector2(0.7, 0.7),
    });
    // glowing bioluminescent veins in the eye colour
    applyVeins(this.shell, C.eye, 1.15, 1.5);
    applyVeins(this.skin, C.eye, 0.7, 2.5);
    this.eyeMat = new THREE.MeshStandardMaterial({ color: C.eye, emissive: C.eye, emissiveIntensity: 1.7 });
    this.mats = [this.skin, this.shell];
    this.hitMeshes = [];
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.extra = new THREE.Group(); // world-space parts (segments, legs, tentacles)
    scene.add(this.root);
    scene.add(this.extra);
    this.dead = false;
    this.deathT = 0;
    this.attackT = 0;
    this.hitKick = 0;
    this.flash = 0;
    this.lastFlash = -1;
    this.time = Math.random() * 10;
    this.baseH = 0.5;
  }

  mesh(geo, mat, parent, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  }

  setFlash(f) {
    const v = f > 0 ? 0.45 : 0;
    if (v === this.lastFlash) return;
    this.lastFlash = v;
    this.skin.userData.flash.value = v;
    this.shell.userData.flash.value = v;
  }

  updateMatrices() {
    const root = this.root;
    root.updateMatrix();
    root.matrixWorld.copy(root.matrix);
    this.body.updateMatrix();
    this.body.matrixWorld.multiplyMatrices(root.matrixWorld, this.body.matrix);
  }

  plantFeet() {}

  die(flipSide = 1) {
    this.dead = true;
    this.deathT = 0;
    this.flipSide = flipSide;
  }

  commonTick(dt) {
    this.time += dt;
    this.attackT = Math.max(0, this.attackT - dt * 3);
    this.hitKick = Math.max(0, this.hitKick - dt * 6);
    this.flash = Math.max(0, this.flash - dt);
    this.setFlash(this.flash);
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.extra);
    for (const m of [this.skin, this.shell, this.eyeMat, this.glowMat, this.bellMat]) m?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Worm / snake: a head followed by segments that trace the head's path
export class SegmentRig extends RigBase {
  constructor(type, def, scene) {
    super(def, scene);
    const r = this.rig;
    const s = this.s;
    this.n = r.segments;
    this.segLen = r.segLen * s;
    this.radius = r.radius * s;
    this.baseH = this.radius * 0.95;
    this.undulate = r.undulate ?? 1;
    // head (child of root, faces -Z)
    this.head = new THREE.Group();
    this.body.add(this.head);
    this.body.position.y = this.baseH;
    const hr = r.head * s;
    const headM = this.mesh(sphereGeo, this.shell, this.head);
    headM.scale.set(hr * 0.85, hr * 0.7, hr * 1.25);
    headM.userData.head = true;
    this.hitMeshes.push(headM);
    for (const side of [-1, 1]) {
      const eye = this.mesh(sphereGeo, this.eyeMat, this.head, false);
      eye.scale.setScalar(hr * 0.16);
      eye.position.set(side * hr * 0.55, hr * 0.28, -hr * 0.75);
    }
    this.jaws = [];
    if (r.maw) {
      // circular mouth full of teeth (burrower)
      const ring = this.mesh(new THREE.TorusGeometry(hr * 0.6, hr * 0.14, 8, 16), this.skin, this.head, false);
      ring.position.z = -hr * 1.15;
      for (let i = 0; i < 8; i++) {
        const piv = new THREE.Group();
        const a = (i / 8) * Math.PI * 2;
        piv.position.set(Math.cos(a) * hr * 0.6, Math.sin(a) * hr * 0.6, -hr * 1.15);
        piv.rotation.z = a - Math.PI / 2;
        this.head.add(piv);
        const t = this.mesh(coneGeo, this.eyeMat, piv, false);
        t.scale.set(hr * 0.09, hr * 0.5, hr * 0.09);
        t.position.y = -hr * 0.18;
        t.rotation.x = Math.PI;
        this.jaws.push({ piv, a });
      }
    } else {
      for (const side of [-1, 1]) {
        const piv = new THREE.Group();
        piv.position.set(side * hr * 0.3, -hr * 0.2, -hr * 1.0);
        this.head.add(piv);
        const j = this.mesh(coneGeo, this.skin, piv, false);
        j.scale.set(hr * 0.12, hr * 0.8, hr * 0.12);
        j.rotation.set(-Math.PI / 2 - 0.2, 0, side * 0.45);
        j.position.z = -hr * 0.3;
        this.jaws.push({ piv, side });
      }
    }
    if (r.frill) {
      for (const side of [-1, 1]) {
        const f = this.mesh(new THREE.CircleGeometry(hr * 0.9, 12, 0, Math.PI), this.shell, this.head, false);
        f.material = new THREE.MeshStandardMaterial({ color: def.colors.eye, emissive: def.colors.eye, emissiveIntensity: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        f.position.set(side * hr * 0.55, hr * 0.15, hr * 0.2);
        f.rotation.set(0, side * 1.2, side * 0.6);
      }
    }
    // body segments in world space
    this.segs = [];
    for (let i = 0; i < this.n; i++) {
      const k = 1 - i / this.n;
      const rad = this.radius * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (i + 2) / (this.n + 1))));
      const g = new THREE.Group();
      const m = this.mesh(sphereGeo, r.frill || i % 2 === 0 ? this.shell : this.skin, g, i < 4);
      m.scale.set(rad, rad * 0.85, this.segLen * 0.75);
      if (r.plates) {
        const p = this.mesh(sphereGeo, this.shell, g, false);
        p.scale.set(rad * 0.95, rad * 0.4, this.segLen * 0.55);
        p.position.y = rad * 0.55;
      }
      if (r.spines && i % 2 === 0) {
        const sp = this.mesh(coneGeo, this.shell, g, false);
        sp.scale.set(rad * 0.15, rad * 0.9, rad * 0.15);
        sp.position.y = rad * 1.05;
        sp.rotation.x = 0.4;
      }
      this.extra.add(g);
      this.hitMeshes.push(m);
      this.segs.push({ g, rad, k, pos: new THREE.Vector3(), yaw: 0 });
    }
    this.path = [];
    this.pathLen = 0;
    this.burrowed = false;
    this.emergeT = 1;
    this.initPath = false;
  }

  setBurrowed(on) {
    this.burrowed = on;
    this.root.visible = !on;
    this.extra.visible = !on;
  }

  emerge() {
    this.setBurrowed(false);
    this.emergeT = 0;
    this.initPath = false;
  }

  plantFeet() { this.initPath = false; }

  update(dt, vel, turn, opts = {}) {
    this.commonTick(dt);
    const root = this.root;
    const p = root.position;
    if (!this.initPath) {
      // lay the body out straight behind the head
      this.initPath = true;
      this.path = [];
      const yaw = root.rotation.y;
      const bx = Math.sin(yaw), bz = Math.cos(yaw);
      for (let i = 0; i <= this.n + 2; i++) this.path.push(new THREE.Vector3(p.x + bx * this.segLen * i, 0, p.z + bz * this.segLen * i));
    }
    // record path
    const headPt = _a.set(p.x, 0, p.z);
    if (headPt.distanceTo(this.path[0]) > this.segLen * 0.25) {
      this.path.unshift(headPt.clone());
      if (this.path.length > this.n * 6 + 10) this.path.pop();
    }
    const speed = Math.hypot(vel.x, vel.z);
    const t = this.time;

    if (this.dead) {
      this.deathT += dt;
      this.body.rotation.z = Math.min(1, this.deathT * 2.5) * Math.PI * 0.9 * this.flipSide;
      if (this.deathT > 2.2) { root.position.y -= dt * 0.4 * this.s; this.extra.position.y -= dt * 0.4 * this.s; }
    }

    // emerge animation: head bursts up out of the ground
    let rise = 0;
    if (this.emergeT < 1) {
      this.emergeT = Math.min(1, this.emergeT + dt * 1.4);
      rise = Math.sin(this.emergeT * Math.PI) * 2.2 * this.s;
      this.body.rotation.x = (1 - this.emergeT) * -1.2;
    } else if (!this.dead) {
      this.body.rotation.x = -this.attackT * 0.4;
    }
    this.body.position.y = this.baseH + rise + Math.sin(t * 3) * 0.03;
    this.body.position.z = this.hitKick * 0.12 - Math.sin(this.attackT * Math.PI) * 0.4 * this.s;
    this.head.rotation.y = Math.sin(t * 2.3) * 0.15;
    const open = this.attackT > 0 ? Math.sin(this.attackT * Math.PI) : Math.max(0, Math.sin(t * 3)) * 0.2;
    for (const j of this.jaws) {
      if (j.a !== undefined) j.piv.scale.setScalar(1 + open * 0.4);
      else j.piv.rotation.y = j.side * open * 0.8;
    }
    this.updateMatrices();
    if (opts.lod && !this.dead) return;

    // place segments along the path
    let dist = 0;
    let pi = 0;
    const amp = this.undulate * Math.min(1, speed / 4) * this.radius * 0.9;
    for (let i = 0; i < this.n; i++) {
      const want = (i + 1) * this.segLen;
      // walk the path until we reach the wanted distance
      while (pi < this.path.length - 1) {
        const segD = this.path[pi].distanceTo(this.path[pi + 1]);
        if (dist + segD >= want) {
          const f = (want - dist) / Math.max(segD, 1e-5);
          _b.lerpVectors(this.path[pi], this.path[pi + 1], f);
          _c.subVectors(this.path[pi], this.path[pi + 1]).normalize();
          break;
        }
        dist += segD;
        pi++;
      }
      if (pi >= this.path.length - 1) {
        _b.copy(this.path[this.path.length - 1]);
      }
      const sg = this.segs[i];
      // side-to-side slither
      const wave = Math.sin(t * 7 - i * 0.65) * amp * (0.3 + i / this.n);
      const nx = -_c.z, nz = _c.x;
      let y = groundAt(_b.x, _b.z) + sg.rad * 0.85;
      if (this.emergeT < 1) y += Math.max(0, rise - (i + 1) * this.segLen * 0.8);
      if (this.dead) y = Math.max(y - sg.rad * 0.35, y - Math.min(1, this.deathT) * sg.rad * 0.3);
      sg.g.position.set(_b.x + nx * wave, y + Math.sin(t * 7 - i * 0.65 + 1.2) * 0.02, _b.z + nz * wave);
      sg.g.rotation.set(0, Math.atan2(-_c.x, -_c.z), this.dead ? this.flipSide * Math.min(1, this.deathT * 2) * 1.2 : 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Two-legged raptor-like hunter with a balancing tail
export class BipedRig extends RigBase {
  constructor(type, def, scene) {
    super(def, scene);
    const r = this.rig;
    const s = this.s;
    const L = r.legLen * s;
    this.L = L;
    this.baseH = r.bodyH * L * 1.25;
    this.body.position.y = this.baseH;
    // torso
    const torso = this.mesh(sphereGeo, this.shell, this.body);
    torso.scale.set(0.38 * s, 0.42 * s, 0.75 * s);
    this.hitMeshes.push(torso);
    const belly = this.mesh(sphereGeo, this.skin, this.body);
    belly.scale.set(0.33 * s, 0.33 * s, 0.6 * s);
    belly.position.y = -0.12 * s;
    // neck + head
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.2 * s, -0.6 * s);
    this.body.add(this.neck);
    const neckM = this.mesh(sphereGeo, this.skin, this.neck);
    neckM.scale.set(0.18 * s, 0.2 * s, 0.38 * s);
    neckM.position.set(0, 0.12 * s, -0.2 * s);
    neckM.rotation.x = 0.6;
    this.head = new THREE.Group();
    this.head.position.set(0, 0.32 * s, -0.5 * s);
    this.neck.add(this.head);
    const skull = this.mesh(sphereGeo, this.shell, this.head);
    skull.scale.set(0.2 * s, 0.17 * s, 0.4 * s);
    skull.userData.head = true;
    this.hitMeshes.push(skull);
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.06 * s, -0.05 * s);
    this.head.add(this.jaw);
    const jawM = this.mesh(sphereGeo, this.skin, this.jaw);
    jawM.scale.set(0.16 * s, 0.07 * s, 0.34 * s);
    jawM.position.z = -0.12 * s;
    for (const side of [-1, 1]) {
      const eye = this.mesh(sphereGeo, this.eyeMat, this.head, false);
      eye.scale.setScalar(0.045 * s);
      eye.position.set(side * 0.13 * s, 0.07 * s, -0.18 * s);
      const crest = this.mesh(coneGeo, this.shell, this.head, false);
      crest.scale.set(0.04 * s, 0.32 * s, 0.04 * s);
      crest.position.set(side * 0.08 * s, 0.16 * s, 0.15 * s);
      crest.rotation.set(1.1, 0, side * 0.3);
    }
    // little claw arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(side * 0.28 * s, -0.05 * s, -0.4 * s);
      this.body.add(piv);
      const a = this.mesh(cylGeo, this.skin, piv, false);
      a.scale.set(0.05 * s, 0.32 * s, 0.05 * s);
      a.rotation.x = Math.PI * 0.75;
      const c = this.mesh(coneGeo, this.eyeMat, piv, false);
      c.scale.set(0.03 * s, 0.14 * s, 0.03 * s);
      c.position.set(0, -0.2 * s, -0.24 * s);
      c.rotation.x = -2.2;
      this.arms.push({ piv, side });
    }
    // tail segments (world space chain)
    this.tail = [];
    for (let i = 0; i < 7; i++) {
      const k = 1 - i / 7;
      const m = this.mesh(sphereGeo, i % 2 ? this.shell : this.skin, this.extra, i < 2);
      m.scale.set(0.2 * s * k + 0.03, 0.2 * s * k + 0.03, 0.3 * s);
      this.tail.push({ m, p: new THREE.Vector3(), k });
      this.hitMeshes.push(m);
    }
    // legs: thigh, shin and a long foot, knee bends backwards
    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = this.mesh(cylGeo, this.shell, this.extra);
      const shin = this.mesh(cylGeo, this.skin, this.extra, false);
      const foot = this.mesh(coneGeo, this.skin, this.extra, false);
      this.legs.push({
        side, thigh, shin, foot,
        hip: new THREE.Vector3(side * 0.3 * s, -0.1 * s, 0.1 * s),
        footPos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1,
        hipW: new THREE.Vector3(), knee: new THREE.Vector3(),
        group: side > 0 ? 1 : 0,
      });
    }
    this.planted = false;
  }

  plantFeet() {
    this.updateMatrices();
    for (const l of this.legs) {
      l.footPos.set(l.side * 0.35 * this.s, 0, 0.1 * this.s);
      this.root.localToWorld(l.footPos);
      l.footPos.y = groundAt(l.footPos.x, l.footPos.z);
      l.t = 1;
    }
    const back = _a.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    this.tail.forEach((tl, i) => tl.p.copy(this.root.position).addScaledVector(back, 0.8 * this.s + i * 0.3 * this.s).setY(this.root.position.y + this.baseH));
    this.planted = true;
  }

  update(dt, vel, turn, opts = {}) {
    this.commonTick(dt);
    if (!this.planted) this.plantFeet();
    const s = this.s;
    const t = this.time;
    const speed = Math.hypot(vel.x, vel.z);
    const body = this.body;
    let lift = 0;
    for (const l of this.legs) if (l.t < 1) lift += Math.sin(Math.PI * l.t);
    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.5);
      body.rotation.z = this.flipSide * k * Math.PI * 0.5;
      body.position.y = Math.max(0.3 * s, this.baseH * (1 - k * 0.75));
      if (this.deathT > 2.2) this.root.position.y -= dt * 0.4 * s;
    } else {
      body.position.y = this.baseH - 0.1 * s + lift * 0.12 * s * Math.min(1, speed / 4) + (opts.leaping ? 0.2 * s : 0);
      body.rotation.x += ((opts.leaping ? -0.4 : -Math.min(0.35, speed * 0.04)) - body.rotation.x) * Math.min(1, dt * 6);
      body.rotation.z += (THREE.MathUtils.clamp(-turn * 0.08, -0.25, 0.25) - body.rotation.z) * Math.min(1, dt * 5);
    }
    body.position.z = this.hitKick * 0.12;
    // head bobbing, roaring
    this.neck.rotation.x = Math.sin(t * 9) * 0.05 * Math.min(1, speed / 3) - this.attackT * 0.5;
    this.head.rotation.x = this.attackT * 0.6;
    this.jaw.rotation.x = (this.attackT > 0 ? Math.sin(this.attackT * Math.PI) : Math.max(0, Math.sin(t * 2)) * 0.15) * 0.7;
    for (const a of this.arms) a.piv.rotation.x = Math.sin(t * 6 + a.side) * 0.2 - this.attackT * 0.8;
    this.updateMatrices();

    // tail follows with lag and sway
    let prev = _b.set(0, 0.05 * s, 0.65 * s);
    body.localToWorld(prev);
    for (let i = 0; i < this.tail.length; i++) {
      const tl = this.tail[i];
      const segL = 0.28 * s;
      _c.subVectors(tl.p, prev);
      if (_c.lengthSq() < 1e-6) _c.set(0, 0, 1);
      _c.normalize();
      // sway
      _d.set(-_c.z, 0, _c.x).multiplyScalar(Math.sin(t * 6 - i * 0.6) * 0.04 * (i + 1) * Math.min(1, speed / 3 + 0.3));
      tl.p.copy(prev).addScaledVector(_c, segL).add(_d);
      tl.p.y = Math.max(groundAt(tl.p.x, tl.p.z) + 0.15 * s, prev.y + 0.02 * s - (this.dead ? 0.1 : 0));
      tl.m.position.copy(tl.p);
      tl.m.lookAt(prev);
      prev = _a.copy(tl.p);
    }
    if (opts.lod && !this.dead) return;

    // legs
    const fwd = _a.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    const L = this.L;
    const stepDur = 0.2 / Math.sqrt(THREE.MathUtils.clamp(speed / 3, 0.8, 3));
    const stepping = [false, false];
    for (const l of this.legs) if (l.t < 1) stepping[l.group] = true;
    // alternate gait: a group may not step twice in a row while the other group is waiting
    const wants = this.wants || [false, false];
    const nextWants = [false, false];
    let started = null;
    const mayStep = (g) => !stepping[1 - g] && (g !== this.lastGroup || !wants[1 - g] || started === g);
    for (const l of this.legs) {
      l.hipW.copy(l.hip);
      body.localToWorld(l.hipW);
      if (this.dead || opts.leaping) {
        _b.copy(l.hipW).addScaledVector(fwd, opts.leaping ? -0.4 * L : 0.2 * L);
        _b.y = l.hipW.y - L * (opts.leaping ? 0.7 : 0.4);
        l.footPos.lerp(_b, Math.min(1, dt * 10));
        l.t = 1;
      } else {
        _b.set(l.side * 0.3 * s, 0, 0.05 * s);
        this.root.localToWorld(_b);
        _b.y = 0;
        _b.addScaledVector(vel, stepDur * 1.1);
        _b.y = groundAt(_b.x, _b.z);
        if (l.t >= 1) {
          const d = Math.hypot(l.footPos.x - _b.x, l.footPos.z - _b.z);
          const over = d > (speed > 0.3 ? 0.45 * L : 0.12 * L);
          if (over) nextWants[l.group] = true;
          if (over && mayStep(l.group)) {
            started = l.group;
            l.from.copy(l.footPos);
            l.to.copy(_b).addScaledVector(vel, stepDur * 0.6);
            l.to.y = groundAt(l.to.x, l.to.z);
            l.t = 0;
            stepping[l.group] = true;
          }
        } else {
          l.t = Math.min(1, l.t + dt / stepDur);
          const e = l.t * l.t * (3 - 2 * l.t);
          l.footPos.lerpVectors(l.from, l.to, e);
          l.footPos.y += Math.sin(Math.PI * l.t) * L * 0.3;
        }
      }
      this.solveLeg(l, fwd);
    }
    this.wants = nextWants;
    if (started !== null) this.lastGroup = started;
  }

  solveLeg(l, fwd) {
    const s = this.s;
    const L = this.L;
    const a = L * 0.62, b = L * 0.72;
    // ankle sits a bit behind and above the toe
    const ankle = _c.copy(l.footPos).addScaledVector(fwd, -0.18 * L);
    ankle.y += 0.2 * L;
    const H = l.hipW;
    // never stretch the leg further than it can reach
    _d.subVectors(ankle, H);
    if (_d.length() > (a + b) * 0.98) ankle.copy(H).addScaledVector(_d.normalize(), (a + b) * 0.98);
    _d.subVectors(ankle, H);
    let d = THREE.MathUtils.clamp(_d.length(), Math.abs(a - b) + 0.01, a + b - 0.01);
    _d.normalize();
    // knee points forward-down for the thigh, giving a backwards ankle look
    const pole = _b.copy(fwd).addScaledVector(UP, -0.2);
    pole.addScaledVector(_d, -pole.dot(_d)).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    l.knee.copy(H).addScaledVector(_d, a * cosA).addScaledVector(pole, a * sinA);
    const th = Math.max(0.6, s);
    this.orient(l.thigh, H, l.knee, 0.11 * th);
    this.orient(l.shin, l.knee, ankle, 0.05 * th);
    // foot points forward from the ankle to the toe
    l.foot.position.copy(ankle).lerp(l.footPos, 0.5);
    l.foot.scale.set(0.05 * th, 0.3 * L, 0.05 * th);
    _q.setFromUnitVectors(UP, _a.subVectors(l.footPos, ankle).normalize());
    l.foot.quaternion.copy(_q);
    fwd.set(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  orient(m, from, to, thick) {
    _a.subVectors(to, from);
    const len = _a.length() || 0.001;
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(UP, _a.divideScalar(len));
    m.scale.set(thick, len, thick);
  }
}

// ---------------------------------------------------------------------------
// Floating jellyfish with trailing tentacles
export class JellyRig extends RigBase {
  constructor(type, def, scene) {
    super(def, scene);
    const s = this.s;
    const C = def.colors;
    this.baseH = 0;
    this.bellMat = new THREE.MeshPhysicalMaterial({
      color: C.shell, emissive: C.shell, emissiveIntensity: 0.35, roughness: 0.25, transmission: 0, transparent: true, opacity: 0.78,
      clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide, depthWrite: false,
    });
    this.glowMat = new THREE.MeshStandardMaterial({ color: C.eye, emissive: C.eye, emissiveIntensity: 1.6 });
    this.mats = [this.skin, this.shell];
    this.bell = new THREE.Group();
    this.body.add(this.bell);
    const bell = this.mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), this.bellMat, this.bell, false);
    bell.scale.set(0.9 * s, 0.75 * s, 0.9 * s);
    this.hitMeshes.push(bell);
    const rim = this.mesh(new THREE.TorusGeometry(0.82 * s, 0.06 * s, 8, 32).rotateX(Math.PI / 2), this.glowMat, this.bell, false);
    rim.position.y = -0.12 * s;
    const organ = this.mesh(sphereGeo, this.glowMat, this.bell, false);
    organ.scale.set(0.35 * s, 0.3 * s, 0.35 * s);
    organ.position.y = 0.15 * s;
    organ.userData.head = true;
    this.hitMeshes.push(organ);
    this.organ = organ;
    this.head = organ;
    // oral arms
    const arm = this.mesh(new THREE.ConeGeometry(0.3 * s, 1.2 * s, 8, 1, true), this.bellMat, this.bell, false);
    arm.position.y = -0.7 * s;
    arm.rotation.x = Math.PI;
    // tentacles: one instanced mesh for all segments
    this.tN = 9;
    this.tSeg = 7;
    const geo = new THREE.CylinderGeometry(0.5, 0.35, 1, 5).translate(0, -0.5, 0);
    this.tentMesh = new THREE.InstancedMesh(geo, this.skin, this.tN * this.tSeg);
    this.tentMesh.frustumCulled = false;
    this.extra.add(this.tentMesh);
    this.tents = [];
    for (let i = 0; i < this.tN; i++) {
      const a = (i / this.tN) * Math.PI * 2;
      const pts = [];
      for (let k = 0; k <= this.tSeg; k++) pts.push(new THREE.Vector3());
      this.tents.push({ a, pts, r: 0.75 * s });
    }
    this.init = false;
  }

  update(dt, vel, turn, opts = {}) {
    this.commonTick(dt);
    const s = this.s;
    const t = this.time;
    const pulse = Math.sin(t * 2.6);
    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT);
      this.bell.scale.set(1 + k * 0.3, 1 - k * 0.6, 1 + k * 0.3);
      this.bellMat.opacity = 0.78 * (1 - Math.max(0, this.deathT - 2) / 2);
    } else {
      // swimming pulse
      this.bell.scale.set(1 - pulse * 0.08, 1 + pulse * 0.1, 1 - pulse * 0.08);
      this.body.position.y = Math.max(0, -pulse) * 0.25;
      this.body.rotation.x = THREE.MathUtils.clamp(-Math.hypot(vel.x, vel.z) * 0.04, -0.3, 0.3);
    }
    this.organ.scale.setScalar(0.35 * s * (1 + Math.sin(t * 5) * 0.08 + this.attackT * 0.4));
    this.glowMat.emissiveIntensity = 1.4 + Math.sin(t * 5) * 0.4 + this.attackT * 2;
    this.updateMatrices();
    if (opts.lod && !this.dead) return;

    // tentacles: verlet-ish chain that hangs and trails behind
    const segL = 0.38 * s;
    let n = 0;
    for (const tn of this.tents) {
      _a.set(Math.cos(tn.a) * tn.r * (1 - pulse * 0.08), -0.12 * s, Math.sin(tn.a) * tn.r * (1 - pulse * 0.08));
      this.body.localToWorld(_a);
      if (!this.init) for (let k = 0; k <= this.tSeg; k++) tn.pts[k].copy(_a).y -= k * segL;
      tn.pts[0].copy(_a);
      for (let k = 1; k <= this.tSeg; k++) {
        const p = tn.pts[k];
        const prev = tn.pts[k - 1];
        // gravity + wave + drag
        p.y -= dt * 3;
        p.x += Math.sin(t * 2 + k * 0.7 + tn.a * 3) * dt * 0.6;
        p.z += Math.cos(t * 1.7 + k * 0.6 + tn.a * 2) * dt * 0.6;
        _b.subVectors(p, prev);
        const l = _b.length() || 1e-4;
        p.copy(prev).addScaledVector(_b, segL / l);
        // orient segment
        _c.subVectors(p, prev);
        _q.setFromUnitVectors(_d.set(0, -1, 0), _c.clone().normalize());
        const th = 0.07 * s * (1 - k / (this.tSeg + 2));
        _s.set(th, segL, th);
        _m.compose(prev, _q, _s);
        this.tentMesh.setMatrixAt(n++, _m);
      }
    }
    this.init = true;
    this.tentMesh.instanceMatrix.needsUpdate = true;
  }
}
