import * as THREE from 'three';
import { chitinNormal, applyVeins } from '../world/textures.js';
import { texSet } from '../core/materials.js';
import { groundAt } from '../world/elevation.js';

// Procedural alien bug with inverse-kinematics legs.
// Feet stay planted on the ground and step forward in a tripod gait when the body moves,
// which gives natural insect-like walking without any pre-made animations.

const UP = new THREE.Vector3(0, 1, 0);
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _k = new THREE.Vector3();
const _d = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();

let chitin = null;
let _shellRough = null;
function shellRough() {
  if (!_shellRough) {
    _shellRough = texSet('rock').arm.clone();
    _shellRough.repeat.set(2, 2);
    _shellRough.needsUpdate = true;
  }
  return _shellRough;
}
const geoCache = new Map();

function segmentedLathe(len, rad, ridges, taperFront = 0.7) {
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const env = Math.pow(Math.sin(Math.PI * t), 0.75) * (t < 0.5 ? 1 : 1 - (t - 0.5) * (1 - taperFront));
    const ridge = 1 - 0.09 * (0.5 + 0.5 * Math.cos(t * ridges * Math.PI * 2));
    pts.push(new THREE.Vector2(Math.max(0.001, rad * env * ridge), (t - 0.5) * len));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateX(Math.PI / 2); // axis along Z
  return g;
}

function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

const legUpperGeo = new THREE.CylinderGeometry(0.075, 0.05, 1, 6).translate(0, 0.5, 0);
const legLowerGeo = new THREE.CylinderGeometry(0.05, 0.008, 1, 6).translate(0, 0.5, 0);
const jointGeo = new THREE.SphereGeometry(0.075, 8, 6);
const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
const coneGeo = new THREE.ConeGeometry(1, 1, 8);
const wingGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.35, 0.15, 1.1, 0.25, 1.25, 0.05);
  s.bezierCurveTo(1.1, -0.12, 0.4, -0.15, 0, 0);
  const g = new THREE.ShapeGeometry(s, 12);
  g.rotateX(-Math.PI / 2);
  return g;
})();

function bugMaterials(C) {
  if (!chitin) chitin = chitinNormal();
  const skin = new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.6, metalness: 0.05, normalMap: chitin, normalScale: new THREE.Vector2(0.35, 0.35) });
  const shell = new THREE.MeshPhysicalMaterial({
    color: C.shell, roughness: 0.55, metalness: 0.1, clearcoat: 0.22, clearcoatRoughness: 0.55, roughnessMap: shellRough(),
    normalMap: chitin, normalScale: new THREE.Vector2(0.7, 0.7),
  });
  // glowing bioluminescent veins in the eye colour
  applyVeins(shell, C.eye, 1.15, 1.5);
  applyVeins(skin, C.eye, 0.7, 2.5);
  return { skin, shell };
}

// ---------------------------------------------------------------------------
// Leg batching: every alien type gets two instanced meshes (upper and lower leg
// segments) that hold the legs of all living bugs of that type.
const batches = new Map();
function legBatch(type, C, shadow, scene) {
  let b = batches.get(type);
  if (b && b.scene !== scene) { b.upper.parent?.remove(b.upper); b.lower.parent?.remove(b.lower); b = null; }
  if (!b) {
    const m = bugMaterials(C);
    b = { scene, rigs: new Set(), cap: 0, upper: null, lower: null, mats: m, shadow };
    batches.set(type, b);
    growBatch(b, 48);
  }
  return b;
}

function growBatch(b, cap) {
  for (const k of ['upper', 'lower']) {
    if (b[k]) { b.scene.remove(b[k]); b[k].dispose(); }
    const m = new THREE.InstancedMesh(k === 'upper' ? legUpperGeo : legLowerGeo, k === 'upper' ? b.mats.shell : b.mats.skin, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = b.shadow;
    m.receiveShadow = true;
    m.frustumCulled = false; // instances are spread over the whole map
    m.count = 0;
    b.scene.add(m);
    b[k] = m;
  }
  b.cap = cap;
}

const _m = new THREE.Matrix4();
// Copy every visible leg transform into the instanced meshes. Called once per frame.
export function flushLegs() {
  for (const b of batches.values()) {
    let need = 0;
    for (const r of b.rigs) if (r.legsVisible()) need += r.legs.length;
    if (need > b.cap) growBatch(b, Math.ceil(need * 1.5));
    let n = 0;
    for (const r of b.rigs) {
      if (!r.legsVisible()) continue;
      for (const l of r.legs) {
        b.upper.setMatrixAt(n, _m.compose(l.upper.position, l.upper.quaternion, l.upper.scale));
        b.lower.setMatrixAt(n, _m.compose(l.lower.position, l.lower.quaternion, l.lower.scale));
        n++;
      }
    }
    b.upper.count = b.lower.count = n;
    b.upper.instanceMatrix.needsUpdate = b.lower.instanceMatrix.needsUpdate = true;
    b.upper.visible = b.lower.visible = n > 0;
  }
}

export class BugRig {
  constructor(type, def, scene) {
    if (!chitin) chitin = chitinNormal();
    this.def = def;
    this.rig = def.rig;
    this.scene = scene;
    const r = this.rig;
    const s = r.scale;
    this.s = s;
    const C = def.colors;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.body.scale.setScalar(s);
    this.baseH = def.flying ? 0 : r.bodyH * r.legLen * s * 0.78;
    this.body.position.y = this.baseH;

    const bm = bugMaterials(C);
    this.skin = bm.skin;
    this.shell = bm.shell;
    this.eyeMat = new THREE.MeshStandardMaterial({ color: C.eye, emissive: C.eye, emissiveIntensity: 1.7 });
    this.mats = [this.skin, this.shell];
    this.lastFlash = -1;
    this.hitMeshes = [];

    const add = (geo, mat, parent = this.body, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };

    const [tl, tr] = r.thorax;
    const [al, ar] = r.abdomen;
    const hr = r.head;
    // Thorax
    const thorax = add(cached(`${type}-th`, () => segmentedLathe(tl * 1.6, tr, 2, 0.9)), this.shell);
    this.hitMeshes.push(thorax);
    // Abdomen (behind, tilted up a bit)
    this.abdomenPivot = new THREE.Group();
    this.abdomenPivot.position.set(0, 0.05, tl * 0.7);
    this.body.add(this.abdomenPivot);
    const abdomen = add(cached(`${type}-ab`, () => segmentedLathe(al * 1.9, ar, r.ridges, 0.55)), this.shell, this.abdomenPivot);
    abdomen.position.z = al * 0.85;
    abdomen.rotation.x = -0.18;
    this.abdomen = abdomen;
    this.hitMeshes.push(abdomen);
    // Head
    this.head = new THREE.Group();
    this.head.position.set(0, 0.06, -tl * 0.75 - hr * 0.6);
    this.body.add(this.head);
    const headM = add(sphereGeo, this.skin, this.head);
    headM.scale.set(hr * 0.82, hr * 0.68, hr * 1.12);
    headM.userData.head = true;
    this.hitMeshes.push(headM);
    // shell plate over the head
    const cap = add(cached('cap', () => new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), this.shell, this.head);
    cap.scale.set(hr * 0.9, hr * 0.55, hr * 1.18);
    cap.position.set(0, hr * 0.08, hr * 0.05);
    cap.userData.head = true;
    this.hitMeshes.push(cap);
    for (const side of [-1, 1]) {
      const eye = add(sphereGeo, this.eyeMat, this.head, false);
      eye.scale.set(hr * 0.16, hr * 0.13, hr * 0.16);
      eye.position.set(side * hr * 0.5, hr * 0.12, -hr * 0.72);
      const eye2 = add(sphereGeo, this.eyeMat, this.head, false);
      eye2.scale.setScalar(hr * 0.08);
      eye2.position.set(side * hr * 0.28, hr * 0.3, -hr * 0.92);
      if (!r.horns) {
        const ant = add(coneGeo, this.skin, this.head, false);
        ant.scale.set(hr * 0.035, hr * 1.4, hr * 0.035);
        ant.position.set(side * hr * 0.25, hr * 0.75, -hr * 0.85);
        ant.rotation.set(-1.0, 0, side * -0.45);
        this.antennae = this.antennae || [];
        this.antennae.push({ m: ant, side, base: -1.0 });
      }
    }
    // Mandibles
    this.mandibles = [];
    for (const side of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(side * hr * 0.35, -hr * 0.25, -hr * 0.85);
      this.head.add(piv);
      const m = add(coneGeo, this.shell, piv, false);
      m.scale.set(hr * 0.12, hr * 0.9, hr * 0.12);
      m.rotation.set(-Math.PI / 2 - 0.2, 0, side * 0.5);
      m.position.set(side * hr * 0.1, 0, -hr * 0.35);
      this.mandibles.push({ piv, side });
    }

    // Extra parts per type
    if (r.sac) {
      this.sacMat = new THREE.MeshStandardMaterial({ color: r.sac, emissive: r.sac, emissiveIntensity: 0.55, roughness: 0.15, transparent: true, opacity: 0.92 });
      const sac = add(sphereGeo, this.sacMat, this.abdomenPivot, false);
      sac.scale.set(ar * 0.65, ar * 0.55, al * 0.6);
      sac.position.set(0, ar * 0.65, al * 0.9);
      this.sac = sac;
      this.hitMeshes.push(sac);
    }
    if (r.bomb) {
      this.sacMat = new THREE.MeshStandardMaterial({ color: r.bomb, emissive: r.bomb, emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.9 });
      const bomb = add(sphereGeo, this.sacMat, this.abdomenPivot, false);
      bomb.scale.set(ar * 0.85, ar * 0.8, al * 0.75);
      bomb.position.set(0, ar * 0.25, al * 0.85);
      this.sac = bomb;
      this.hitMeshes.push(bomb);
    }
    if (r.plates) {
      for (let i = 0; i < 4; i++) {
        const p = add(cached('plate', () => new THREE.BoxGeometry(1, 0.12, 0.45)), this.shell, this.abdomenPivot);
        p.scale.set(ar * 1.5 - i * 0.1, 1, 1);
        p.position.set(0, ar * 0.95 - i * 0.03, al * 0.2 + i * al * 0.42);
        p.rotation.x = -0.32;
      }
      const tp = add(cached('plate', () => new THREE.BoxGeometry(1, 0.12, 0.45)), this.shell);
      tp.scale.set(tr * 2.1, 1.3, 1.5);
      tp.position.set(0, tr * 0.95, 0);
    }
    if (r.horns) {
      for (const side of [-1, 1]) {
        const h = add(coneGeo, this.shell, this.head);
        h.scale.set(hr * 0.16, hr * 1.1, hr * 0.16);
        h.position.set(side * hr * 0.5, hr * 0.55, -hr * 0.2);
        h.rotation.set(-0.7, 0, side * -0.55);
      }
    }
    if (r.spikes) {
      for (let i = 0; i < 5; i++) {
        const sp = add(coneGeo, this.shell, this.abdomenPivot, false);
        sp.scale.set(0.06, 0.35, 0.06);
        sp.position.set(0, ar * 0.95, al * 0.2 + i * al * 0.32);
        sp.rotation.x = -0.6;
      }
    }
    if (r.crown) {
      for (let i = 0; i < 7; i++) {
        const sp = add(coneGeo, this.eyeMat, this.head, false);
        const a = (i / 6 - 0.5) * 2.2;
        sp.scale.set(hr * 0.08, hr * 0.7, hr * 0.08);
        sp.position.set(Math.sin(a) * hr * 0.6, hr * 0.75, Math.cos(a) * hr * 0.2);
        sp.rotation.z = -Math.sin(a) * 0.5;
      }
    }
    if (r.shield) {
      // big curved shield plate in front of the head
      const shMat = this.shell;
      const dome = new THREE.Mesh(cached('shield', () => new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.33).rotateX(-Math.PI / 2)), shMat);
      dome.scale.set(tr * 2.3, tr * 1.8, tr * 1.4);
      dome.position.set(0, tr * 0.25, -tl * 0.2);
      dome.castShadow = true;
      this.body.add(dome);
      this.hitMeshes.push(dome);
      dome.userData.shield = true;
      const edge = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40), this.eyeMat);
      edge.scale.set(tr * 2.3 * 0.86, tr * 1.8 * 0.86, 1);
      edge.position.set(0, tr * 0.25, -tl * 0.2 - tr * 1.4 * 0.5);
      this.body.add(edge);
    }
    if (r.stinger) {
      const st = add(coneGeo, this.skin, this.abdomenPivot);
      st.scale.set(0.08, 0.5, 0.08);
      st.position.set(0, -0.05, al * 1.75);
      st.rotation.x = Math.PI / 2 + 0.3;
    }
    this.wings = [];
    if (r.wings) {
      const wmat = new THREE.MeshStandardMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.1, metalness: 0.3, depthWrite: false });
      for (const side of [-1, 1]) for (const k of [0, 1]) {
        const piv = new THREE.Group();
        piv.position.set(side * tr * 0.5, tr * 0.6, -tl * 0.1 + k * tl * 0.5);
        this.body.add(piv);
        const w = new THREE.Mesh(wingGeo, wmat);
        w.scale.set(side * (k ? 1.1 : 1.4), 1, k ? 0.8 : 1);
        w.rotation.y = side * (0.4 + k * 0.4);
        piv.add(w);
        this.wings.push({ piv, side, k });
      }
    }

    // Legs (in world space)
    this.legGroup = new THREE.Group();
    this.legs = [];
    const n = r.legs;
    const L = r.legLen * s;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const rows = n / 2;
      const zf = rows === 1 ? 0 : row / (rows - 1) - 0.5; // -0.5 .. 0.5 front to back
      const hip = new THREE.Vector3(side * tr * 0.75, -tr * 0.15, zf * tl * 1.0);
      const rest = new THREE.Vector3(
        side * (tr * s + L * 0.68 - Math.abs(zf) * L * 0.1),
        0,
        zf * (tl * s * 1.0 + L * 1.4)
      );
      // legs are not meshes of their own: their transforms are gathered into one
      // instanced mesh per alien type (2 draw calls for all legs instead of 12 per bug)
      const upper = new THREE.Object3D();
      const lower = new THREE.Object3D();
      this.legs.push({
        hip, rest, side,
        group: (row + (side > 0 ? 1 : 0)) % 2,
        a: L * 0.7, b: L * 0.86,
        foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
        t: 1, hipW: new THREE.Vector3(), knee: new THREE.Vector3(),
        upper, lower,
      });
    }
    this.thick = Math.max(0.5, s);
    scene.add(this.root);
    this.batch = legBatch(type, C, n <= 6 && s > 1.2, scene);
    this.batch.rigs.add(this);

    this.dead = false;
    this.deathT = 0;
    this.attackT = 0;
    this.hitKick = 0;
    this.flash = 0;
    this.time = Math.random() * 10;
    this.planted = false;
  }

  // Place feet under the body immediately (used on spawn)
  updateMatrices() {
    const root = this.root;
    root.updateMatrix();
    root.matrixWorld.copy(root.matrix);
    this.body.updateMatrix();
    this.body.matrixWorld.multiplyMatrices(root.matrixWorld, this.body.matrix);
  }

  plantFeet() {
    this.updateMatrices();
    for (const l of this.legs) {
      l.foot.copy(l.rest);
      this.root.localToWorld(l.foot);
      l.foot.y = groundAt(l.foot.x, l.foot.z);
      l.t = 1;
    }
    this.planted = true;
  }

  setFlash(f) {
    const v = f > 0 ? 0.45 : 0;
    if (v === this.lastFlash) return;
    this.lastFlash = v;
    this.skin.userData.flash.value = v;
    this.shell.userData.flash.value = v;
  }

  die(flipSide = 1) {
    this.dead = true;
    this.deathT = 0;
    this.flipSide = flipSide;
  }

  // vel: world velocity, turn: yaw speed, opts: { flying, leaping, slamT, explodeGlow }
  update(dt, vel, turn, opts = {}) {
    this.time += dt;
    const s = this.s;
    const body = this.body;
    if (!this.planted) this.plantFeet();

    const speed = Math.hypot(vel.x, vel.z);
    const time = this.time;

    // --- body motion
    this.attackT = Math.max(0, this.attackT - dt * 3);
    this.hitKick = Math.max(0, this.hitKick - dt * 6);
    this.flash = Math.max(0, this.flash - dt);
    this.setFlash(this.flash);

    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.45);
      body.rotation.z = this.flipSide * Math.PI * (k * k * (3 - 2 * k)) * 0.95;
      body.position.y = this.baseH * (1 - k * 0.55) + Math.sin(k * Math.PI) * 0.5 * s + this.rig.thorax[1] * s * k * 0.6;
      body.rotation.x *= 0.9;
      if (this.deathT > 2.2) this.root.position.y -= dt * 0.45 * s;
    } else if (this.def.flying) {
      body.position.y = Math.sin(time * 2.2) * 0.18;
      body.rotation.x = THREE.MathUtils.clamp(-speed * 0.035, -0.4, 0.4) + Math.sin(time * 1.7) * 0.05;
      body.rotation.z = THREE.MathUtils.clamp(-turn * 0.25, -0.5, 0.5);
      for (const w of this.wings) {
        w.piv.rotation.z = w.side * (0.15 + Math.sin(time * 55 + w.k * 1.2) * 0.65);
      }
      this.abdomenPivot.rotation.x = -0.25 + Math.sin(time * 3) * 0.08 - this.attackT * 0.9;
    } else {
      let lift = 0;
      for (const l of this.legs) if (l.t < 1) lift += Math.sin(Math.PI * l.t);
      const bob = (lift / this.legs.length) * 0.07 * s;
      const slam = opts.slamT || 0;
      body.position.y = this.baseH + bob + Math.sin(time * 2) * 0.015 * s + slam * 0.8 * s;
      body.rotation.z += (THREE.MathUtils.clamp(-turn * 0.06, -0.15, 0.15) - body.rotation.z) * Math.min(1, dt * 6);
      const tiltTarget = opts.leaping ? -0.35 : THREE.MathUtils.clamp(speed * 0.012, 0, 0.1) - slam * 0.25;
      body.rotation.x += (tiltTarget - body.rotation.x) * Math.min(1, dt * 6);
      this.abdomenPivot.rotation.x = Math.sin(time * 2.4) * 0.04 + (opts.leaping ? 0.3 : 0);
    }
    body.position.z = this.hitKick * 0.15 - Math.sin(this.attackT * Math.PI) * 0.25;
    // breathing + head motion
    const breath = 1 + Math.sin(time * 3.1) * 0.025;
    this.abdomen.scale.set(breath, breath, 1);
    if (this.sac) {
      const p = 1 + Math.sin(time * (opts.explodeGlow ? 14 : 4)) * (opts.explodeGlow ? 0.12 : 0.05);
      this.sacMat.emissiveIntensity = (opts.explodeGlow ? 1.6 : 0.55) * p;
    }
    if (!this.dead) {
      this.head.rotation.y = Math.sin(time * 1.3) * 0.12;
      this.head.rotation.x = Math.sin(time * 0.9) * 0.06 - this.attackT * 0.3;
    }
    if (this.antennae) for (const a of this.antennae) a.m.rotation.x = a.base + Math.sin(time * 5 + a.side) * 0.12;
    const open = this.attackT > 0 ? Math.sin(this.attackT * Math.PI) : Math.max(0, Math.sin(time * 4)) * 0.15;
    for (const m of this.mandibles) m.piv.rotation.y = m.side * open * 0.7;

    this.updateMatrices();
    if (opts.lod && !this.dead) return; // far away: skip leg IK this frame

    // --- legs
    _right.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    _back.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    const L = this.rig.legLen * s;
    const speedF = THREE.MathUtils.clamp(speed / (2.5 * Math.sqrt(s)), 0.7, 3);
    const stepDur = 0.24 / Math.sqrt(speedF);
    const thresh = L * (speed > 0.3 ? 0.42 : 0.15);
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

      if (this.dead) {
        // legs curl up towards the body
        const k = Math.min(1, this.deathT / 0.5);
        _d.copy(l.hipW).addScaledVector(_right, l.side * L * 0.35).addScaledVector(UP, L * 0.25 * k);
        l.foot.lerp(_d, Math.min(1, dt * 6));
      } else if (this.def.flying || opts.leaping) {
        // dangling legs that swing with motion
        _d.copy(l.hipW).addScaledVector(_right, l.side * L * 0.25).addScaledVector(UP, -L * 0.85).addScaledVector(_back, L * 0.3);
        _d.addScaledVector(vel, -0.06);
        l.foot.lerp(_d, Math.min(1, dt * 9));
        l.t = 1;
      } else {
        // desired foot position on the ground, a bit ahead in the direction of travel
        _d.copy(l.rest);
        this.root.localToWorld(_d);
        _d.y = 0;
        _d.addScaledVector(vel, stepDur * 0.6);
        _d.y = groundAt(_d.x, _d.z);
        if (l.t >= 1) {
          const dist = Math.hypot(l.foot.x - _d.x, l.foot.z - _d.z);
          if (dist > thresh) nextWants[l.group] = true;
          if (dist > thresh && mayStep(l.group)) {
            started = l.group;
            l.from.copy(l.foot);
            l.to.copy(_d).addScaledVector(vel, stepDur * 0.4);
            l.to.y = groundAt(l.to.x, l.to.z);
            l.t = 0;
            stepping[l.group] = true;
          }
        } else {
          l.t = Math.min(1, l.t + dt / stepDur);
          const e = l.t * l.t * (3 - 2 * l.t);
          l.foot.lerpVectors(l.from, l.to, e);
          l.foot.y += Math.sin(Math.PI * l.t) * L * 0.35;
        }
      }
      this.solveLeg(l);
    }
    this.wants = nextWants;
    if (started !== null) this.lastGroup = started;
  }

  solveLeg(l) {
    const H = l.hipW;
    const F = l.foot;
    _u.subVectors(F, H);
    let d = _u.length();
    const a = l.a, b = l.b;
    d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 0.01, a + b - 0.01);
    _u.normalize();
    // pole: up and outwards so knees point up like a spider
    _v.set(0, 1, 0).addScaledVector(_right, l.side * 0.5);
    _v.addScaledVector(_u, -_v.dot(_u));
    if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
    _v.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _k.copy(H).addScaledVector(_u, a * cosA).addScaledVector(_v, a * sinA);
    l.knee.copy(_k);
    const th = this.thick;
    // upper segment
    _d.subVectors(_k, H);
    const lu = _d.length();
    l.upper.position.copy(H);
    l.upper.quaternion.setFromUnitVectors(UP, _d.divideScalar(lu || 1));
    l.upper.scale.set(th, lu, th);
    // lower segment: from knee to the actual foot (feet can be slightly out of reach)
    const realFoot = _u.copy(H).addScaledVector(_d.subVectors(F, H).normalize(), d);
    _d.subVectors(realFoot, _k);
    const ll = _d.length();
    l.lower.position.copy(_k);
    l.lower.quaternion.setFromUnitVectors(UP, _d.divideScalar(ll || 1));
    l.lower.scale.set(th, ll, th);
  }

  setOpacity(o) {
    // used for the very end of the death sink
    this.root.visible = o > 0;
    this.legGroup.visible = o > 0;
  }

  legsVisible() {
    return this.root.visible && this.legGroup.visible && this.root.position.y > -500;
  }

  dispose() {
    this.scene.remove(this.root);
    this.batch.rigs.delete(this);
    for (const m of [this.skin, this.shell, this.eyeMat, this.sacMat]) m?.dispose();
  }
}
