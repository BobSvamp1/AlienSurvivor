import * as THREE from 'three';
import { mocap, Pose, clipDuration } from './mocap.js';
import { wornMetal, texSet } from '../core/materials.js';
import { mergeGeos } from '../core/geomerge.js';
import { groundAt } from '../world/elevation.js';

// Third-person look of a player: a hard-surface EVA soldier with a jetpack.
// Every class has its own silhouette: the Marine wears layered heavy armour, the
// Engineer a utility rig with a robot arm, the Pyro a gas mask and fuel tanks, the
// Ranger a slim suit, cape and T-visor. The player's colour is used for paint and
// lights. Walks, strafes, aims, recoils, hovers on the jetpack, falls over when downed.

export const PLAYER_COLORS = ['#3de0ff', '#ffb43d', '#7dff6a', '#ff5ad1'];

const FLAME = new THREE.MeshBasicMaterial({ color: '#ffb44a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const FLAME_CORE = new THREE.MeshBasicMaterial({ color: '#fff4d0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

// base colours of each class's kit
const KIT = {
  marine: { armor: '#e6e7e4', armor2: '#3a3f47', suit: '#8b9097', strap: '#2a2d32', bulk: 1.0 },
  engineer: { armor: '#e4d9bd', armor2: '#454a52', suit: '#6f7c8b', strap: '#3a3226', bulk: 1.0 },
  pyro: { armor: '#5d4b42', armor2: '#25262a', suit: '#3a3c41', strap: '#1f1d1c', bulk: 1.12 },
  ranger: { armor: '#a8ab8b', armor2: '#373c31', suit: '#5a5f50', strap: '#2b2e25', bulk: 0.93 },
};

const cache = {};
function mats(cls, color) {
  const key = cls + color;
  if (cache[key]) return cache[key];
  const K = KIT[cls] || KIT.marine;
  const c = new THREE.Color(color);
  const nor = texSet('fabric').nor.clone();
  nor.repeat.set(3, 3);
  nor.needsUpdate = true;
  const fabric = (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, metalness: 0, normalMap: nor, normalScale: new THREE.Vector2(0.9, 0.9) });
  cache[key] = {
    suit: fabric(K.suit),
    strap: fabric(K.strap),
    armor: wornMetal(K.armor, { metalness: 0.2, roughness: 0.42, scratches: 0.35 }),
    armor2: wornMetal(K.armor2, { metalness: 0.55, roughness: 0.5, scratches: 0.3 }),
    dark: wornMetal('#1d2025', { metalness: 0.7, roughness: 0.5 }),
    metal: wornMetal('#9aa1aa', { metalness: 0.9, roughness: 0.35 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.92, metalness: 0 }),
    // team paint (stripes, panels): offset so it never fights with the plate under it
    paint: new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.9), roughness: 0.5, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    accent: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.4, roughness: 0.4, toneMapped: false }),
    visor: new THREE.MeshPhysicalMaterial({ color: '#b08a3a', metalness: 1, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.6, iridescence: 0.35, iridescenceIOR: 1.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#0b1a22', metalness: 0.8, roughness: 0.05, clearcoat: 1, emissive: c, emissiveIntensity: 0.25, envMapIntensity: 2 }),
    lens: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: c, emissiveIntensity: 2.2, roughness: 0.2, toneMapped: false }),
    gold: new THREE.MeshPhysicalMaterial({ color: '#c99a3e', metalness: 1, roughness: 0.2, clearcoat: 0.6 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 3, toneMapped: false }),
    hazard: hazardMat(),
  };
  return cache[key];
}

let HAZ = null;
function hazardMat() {
  if (HAZ) return HAZ;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = '#1a1a1d'; g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#e8a91c';
  for (let x = -16; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 16); g.lineTo(x + 16, 0); g.lineTo(x + 8, 0); g.fill(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  HAZ = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return HAZ;
}

// ---------------------------------------------------------------- shapes
// extruded polygon (x, y) with chamfered edges: the hard-surface armour look
function ext(pts, depth, bevel = 0.007) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const b = Math.min(bevel, depth * 0.4);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, depth - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 3 });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  g.computeVertexNormals();
  return g;
}
// box with cut corners (front view octagon) and chamfered edges
function cbox(w, h, d, c = 0.01) {
  const x = w / 2, y = h / 2, k = Math.min(c * 1.6, x * 0.45, y * 0.45);
  return ext([[-x + k, -y], [x - k, -y], [x, -y + k], [x, y - k], [x - k, y], [-x + k, y], [-x, y - k], [-x, -y + k]], d, c);
}
// tapered tube from a to b
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function limb(a, b, r1, r2, seg = 12) {
  _a.set(...a); _b.set(...b);
  const g = new THREE.CylinderGeometry(r2, r1, _a.distanceTo(_b), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, _b.clone().sub(_a).normalize()));
  g.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
  return g;
}
// faceted ball (pads, joints)
const facet = (r, sx = 1, sy = 1, sz = 1, detail = 1) => new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz);
const ring = (r, t) => new THREE.TorusGeometry(r, t, 6, 18).rotateX(Math.PI / 2);
// turn a geometry so its Y axis points from a towards b (place it at their midpoint)
function along(geo, a, b) {
  _a.set(...a); _b.set(...b);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, _b.clone().sub(_a).normalize()));
  return geo;
}

// merge the static meshes that sit directly in a group (fewer draw calls)
function mergeDirect(group) {
  const by = new Map();
  for (const o of [...group.children]) {
    if (!o.isMesh || o.userData.keep) continue;
    o.updateMatrix();
    const g = o.geometry;
    g.userData.matrix = o.matrix.clone();
    const k = o.material.uuid + (o.castShadow ? 's' : '');
    if (!by.has(k)) by.set(k, { mat: o.material, shadow: o.castShadow, list: [] });
    by.get(k).list.push(g);
    group.remove(o);
  }
  for (const { mat, shadow, list } of by.values()) {
    const m = new THREE.Mesh(mergeGeos(list), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
  }
}

function nameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 54px "Rajdhani", "Segoe UI", sans-serif';
  const text = name.slice(0, 14).toUpperCase();
  const tw = Math.min(440, g.measureText(text).width + 70);
  const x0 = 256 - tw / 2;
  g.fillStyle = 'rgba(6, 12, 20, 0.62)';
  g.beginPath();
  g.moveTo(x0 + 14, 22); g.lineTo(x0 + tw, 22); g.lineTo(x0 + tw - 14, 106); g.lineTo(x0, 106); g.closePath();
  g.fill();
  g.fillStyle = color;
  g.fillRect(x0 + 6, 22, 10, 84);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.fillText(text, 256 + 8, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  s.scale.set(1.5, 0.375, 1);
  s.renderOrder = 10;
  return s;
}

const _pq = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _I = new THREE.Quaternion();

export class Avatar {
  constructor(scene, name, color, cls = 'marine') {
    this.scene = scene;
    this.cls = KIT[cls] ? cls : 'marine';
    cls = this.cls;
    const K = KIT[cls];
    const M = mats(cls, color);
    this.M = M;
    const root = new THREE.Group();
    const add = (geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const B = K.bulk;

    // ================= hips + legs
    const hips = new THREE.Group();
    hips.position.y = 0.96;
    root.add(hips);
    this.hips = hips;
    add(cbox(0.32 * B, 0.17, 0.23 * B, 0.02), M.suit, hips, 0, -0.01, 0);
    add(cbox(0.37 * B, 0.07, 0.27 * B, 0.012), M.strap, hips, 0, 0.06, 0); // belt
    add(cbox(0.09, 0.06, 0.02, 0.006), M.metal, hips, 0, 0.06, -0.14 * B); // buckle
    add(ext([[-0.13, 0.02], [0.13, 0.02], [0.1, -0.12], [-0.1, -0.12]], 0.04), M.armor2, hips, 0, -0.01, -0.12 * B); // groin plate

    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11 * B, -0.05, 0);
      hips.add(hip);
      add(limb([0, 0.02, 0], [0, -0.44, 0], 0.1 * B, 0.078 * B), M.suit, hip);
      add(ring(0.08 * B, 0.012), M.strap, hip, 0, -0.38, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      hip.add(knee);
      add(facet(0.072 * B, 1, 1, 1, 1), M.suit, knee);
      add(limb([0, 0, 0], [0, -0.4, 0], 0.076 * B, 0.062 * B), M.suit, knee);
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.41, 0);
      knee.add(ankle);
      // angular boot (side profile extruded across the foot)
      const boot = ext([[0.075, -0.115], [-0.19, -0.115], [-0.215, -0.07], [-0.16, -0.01], [-0.06, 0.03], [0.07, 0.09], [0.085, -0.03]], 0.15 * B, 0.012);
      boot.rotateY(-Math.PI / 2);
      add(boot, cls === 'pyro' ? M.armor2 : M.armor, ankle, 0, 0.0, 0);
      add(cbox(0.16 * B, 0.035, 0.31, 0.008).rotateX(Math.PI / 2).rotateX(-Math.PI / 2), M.rubber, ankle, 0, -0.115, -0.065);
      add(cbox(0.155 * B, 0.03, 0.08, 0.008), M.armor2, ankle, 0, -0.05, -0.17); // toe cap
      add(ring(0.066 * B, 0.016), M.strap, ankle, 0, 0.07, 0);
      this.legGear(cls, M, add, hip, knee, ankle, side, B);
      mergeDirect(ankle);
      mergeDirect(knee);
      mergeDirect(hip);
      this.legs.push({ hip, knee, ankle, side });
    }

    // ================= torso (turns + leans with the aim)
    const torso = new THREE.Group();
    torso.position.y = 0.06;
    hips.add(torso);
    this.torso = torso;
    add(new THREE.CylinderGeometry(0.145 * B, 0.155 * B, 0.18, 12), M.suit, torso, 0, 0.1, 0); // waist
    for (let k = 0; k < 3; k++) add(ring(0.15 * B, 0.011), M.strap, torso, 0, 0.04 + k * 0.05, 0);
    const chest = new THREE.Group();
    chest.position.y = 0.36;
    torso.add(chest);
    this.chest = chest;
    // under-suit torso: an angular barrel
    add(new THREE.CylinderGeometry(0.21 * B, 0.17 * B, 0.4, 8).scale(1.1, 1, 0.82).rotateY(Math.PI / 8), M.suit, chest, 0, -0.02, 0);
    add(ring(0.115, 0.03), M.armor2, chest, 0, 0.2, 0); // neck seal

    // ================= jetpack nozzles (every class has one; looks differ)
    this.flames = [];
    const pack = new THREE.Group();
    pack.position.set(0, 0.0, 0.2 * B);
    chest.add(pack);
    this.pack = pack;
    const nozzle = (x, y, z, r = 0.05) => {
      add(new THREE.CylinderGeometry(r * 0.8, r * 1.3, 0.09, 8), M.dark, pack, x, y, z);
      add(ring(r * 1.25, 0.008), M.accent, pack, x, y - 0.04, z, 0, 0, 0, false);
      const fl = new THREE.Group();
      fl.position.set(x, y - 0.05, z);
      fl.userData.keep = true;
      pack.add(fl);
      fl.add(new THREE.Mesh(new THREE.ConeGeometry(r * 1.05, 0.5, 10).rotateX(Math.PI).translate(0, -0.25, 0), FLAME));
      fl.add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, 0.28, 8).rotateX(Math.PI).translate(0, -0.14, 0), FLAME_CORE));
      fl.visible = false;
      this.flames.push(fl);
    };

    // ================= helmet
    const head = new THREE.Group();
    head.position.y = 0.3;
    chest.add(head);
    this.head = head;

    // ================= class kit: chest armour, shoulders, back, helmet
    this.kit(cls, M, add, chest, pack, head, nozzle, B);

    // ================= arms + weapon (pitch with the aim)
    const aim = new THREE.Group();
    aim.position.set(0, 0.06, 0);
    chest.add(aim);
    this.aim = aim;
    const gun = new THREE.Group();
    gun.position.set(0.11, -0.1, -0.32);
    gun.scale.setScalar(1.25);
    aim.add(gun);
    this.gun = gun;
    this.buildGun(cls, M, add, gun);
    const sh = 0.26 * B;
    const arm = (s, el, hand, side) => {
      add(facet(0.07 * B, 1, 1, 1, 1), M.suit, aim, ...s);
      add(limb(s, el, 0.068 * B, 0.058 * B), M.suit, aim);
      // upper-arm plate
      const mid = [(s[0] + el[0]) / 2, (s[1] + el[1]) / 2, (s[2] + el[2]) / 2];
      if (cls !== 'ranger' || side < 0) add(along(cbox(0.1 * B, 0.15, 0.05, 0.01), s, el), cls === 'pyro' ? M.armor2 : M.armor, aim, mid[0] + side * 0.035, mid[1], mid[2] - 0.01);
      add(facet(0.062 * B, 1.05, 0.9, 1.05, 0), cls === 'engineer' ? M.armor2 : M.armor, aim, ...el); // elbow pad
      add(limb(el, hand, 0.056 * B, 0.05 * B), M.suit, aim);
      // gauntlet
      const g0 = [el[0] + (hand[0] - el[0]) * 0.3, el[1] + (hand[1] - el[1]) * 0.3, el[2] + (hand[2] - el[2]) * 0.3];
      const g1 = [el[0] + (hand[0] - el[0]) * 0.92, el[1] + (hand[1] - el[1]) * 0.92, el[2] + (hand[2] - el[2]) * 0.92];
      add(limb(g0, g1, 0.062 * B, 0.068 * B, 8), cls === 'pyro' ? M.armor2 : M.armor, aim);
      add(limb([g0[0] + (g1[0] - g0[0]) * 0.55, g0[1] + (g1[1] - g0[1]) * 0.55, g0[2] + (g1[2] - g0[2]) * 0.55], [g0[0] + (g1[0] - g0[0]) * 0.65, g0[1] + (g1[1] - g0[1]) * 0.65, g0[2] + (g1[2] - g0[2]) * 0.65], 0.07 * B, 0.07 * B, 8), M.paint, aim);
      add(cbox(0.085 * (cls === 'pyro' ? 1.15 : 1), 0.09, 0.1, 0.012), cls === 'pyro' ? M.armor2 : M.strap, aim, ...hand); // glove
    };
    arm([sh, 0.04, 0.0], [0.29 * B, -0.24, -0.03], [0.11, -0.24, -0.21], 1); // right hand on the grip
    arm([-sh, 0.04, 0.0], [-0.15 * B, -0.25, -0.28], [0.09, -0.17, -0.5], -1); // left hand forward

    mergeDirect(aim);
    mergeDirect(gun);
    mergeDirect(head);
    mergeDirect(pack);
    mergeDirect(chest);
    mergeDirect(torso);
    mergeDirect(hips);

    // name tag
    this.tag = nameTag(name, color);
    this.tag.position.y = 2.32;
    root.add(this.tag);

    scene.add(root);
    this.root = root;
    this.walk = 0;
    this.downT = 0;
    this.kick = 0;
    this.t = Math.random() * 10;
    this.prev = null;
    this.airT = 0;
  }

  // ------------------------------------------------------------ leg armour per class
  legGear(cls, M, add, hip, knee, ankle, side, B) {
    if (cls === 'marine') {
      add(ext([[-0.07, 0.11], [0.07, 0.11], [0.08, -0.06], [0.04, -0.13], [-0.04, -0.13], [-0.08, -0.06]], 0.05), M.armor, hip, side * 0.012, -0.19, -0.075 * B);
      add(cbox(0.03, 0.12, 0.006, 0.002), M.paint, hip, side * 0.03, -0.17, -0.105 * B);
      add(ext([[-0.06, 0.05], [0.06, 0.05], [0.065, -0.14], [0.0, -0.19], [-0.065, -0.14]], 0.045), M.armor, knee, 0, -0.12, -0.065 * B);
      add(facet(0.062, 1.1, 1, 0.8, 0), M.armor2, knee, 0, 0.0, -0.055);
    } else if (cls === 'engineer') {
      add(cbox(0.13, 0.17, 0.045, 0.01), M.armor, hip, side * 0.01, -0.2, -0.075);
      add(cbox(0.08, 0.1, 0.06, 0.01), M.strap, hip, side * 0.105, -0.17, 0.0); // thigh pouch
      add(cbox(0.06, 0.012, 0.065, 0.003), M.metal, hip, side * 0.105, -0.11, 0.0);
      add(facet(0.085, 1.15, 1.0, 0.75, 0), M.armor2, knee, 0, 0.0, -0.06); // big knee pad
      add(cbox(0.12, 0.2, 0.04, 0.01), M.armor, knee, 0, -0.2, -0.06);
    } else if (cls === 'pyro') {
      add(ext([[-0.08, 0.12], [0.08, 0.12], [0.09, -0.12], [-0.09, -0.12]], 0.06), M.armor, hip, side * 0.012, -0.19, -0.08 * B);
      for (let k = 0; k < 3; k++) add(cbox(0.15, 0.04, 0.055, 0.008), M.armor, knee, 0, -0.08 - k * 0.075, -0.06 * B);
      add(facet(0.075, 1.2, 1.1, 0.8, 0), M.armor2, knee, 0, 0.0, -0.06);
      add(cbox(0.16, 0.025, 0.05, 0.006).rotateY(0), M.hazard, knee, 0, -0.34, -0.06 * B);
    } else {
      add(cbox(0.1, 0.18, 0.035, 0.008), M.armor, hip, side * 0.01, -0.2, -0.07);
      if (side > 0) { // holster
        add(cbox(0.07, 0.16, 0.08, 0.012), M.strap, hip, 0.11, -0.16, 0.01);
        add(cbox(0.045, 0.06, 0.06, 0.008), M.dark, hip, 0.11, -0.04, 0.01);
      }
      add(ext([[-0.05, 0.05], [0.05, 0.05], [0.055, -0.15], [0.0, -0.19], [-0.055, -0.15]], 0.035), M.armor, knee, 0, -0.12, -0.06);
      add(cbox(0.012, 0.1, 0.004, 0.002), M.accent, knee, 0, -0.12, -0.08, 0, 0, 0, false);
    }
  }

  // ------------------------------------------------------------ chest, shoulders, back, helmet per class
  kit(cls, M, add, chest, pack, head, nozzle, B) {
    const helmShell = (sx = 1, sy = 1.04, sz = 1.06, mat = M.armor) => add(new THREE.SphereGeometry(0.17, 16, 12).scale(sx, sy, sz), mat, head, 0, 0.1, 0.01);
    if (cls === 'marine') {
      // --- layered chest armour
      add(ext([[-0.15, 0.16], [0.15, 0.16], [0.2, 0.06], [0.16, -0.12], [0.07, -0.18], [-0.07, -0.18], [-0.16, -0.12], [-0.2, 0.06]], 0.07), M.armor, chest, 0, 0.0, -0.15);
      add(ext([[-0.035, 0.15], [0.035, 0.15], [0.02, -0.16], [-0.02, -0.16]], 0.006), M.paint, chest, 0.07, 0.0, -0.19); // paint stripe
      for (const sx of [-1, 1]) add(cbox(0.1, 0.25, 0.05, 0.01), M.armor, chest, sx * 0.21, -0.02, -0.07, 0, sx * 0.75, 0);
      add(cbox(0.4, 0.36, 0.06, 0.012), M.armor2, chest, 0, 0.0, 0.15);
      // harness straps + mag pouches
      for (const sx of [-1, 1]) {
        add(cbox(0.045, 0.34, 0.02, 0.005), M.strap, chest, sx * 0.1, 0.03, -0.19);
        add(cbox(0.055, 0.035, 0.03, 0.005), M.metal, chest, sx * 0.1, 0.11, -0.2);
      }
      for (const x of [-0.08, 0, 0.08]) {
        add(cbox(0.07, 0.095, 0.05, 0.008), M.strap, chest, x, -0.2, -0.16);
        add(cbox(0.072, 0.02, 0.052, 0.004), M.armor2, chest, x, -0.152, -0.16);
      }
      // big layered pauldrons
      for (const sx of [-1, 1]) {
        // (front-view profile of the pauldron, extruded front to back)
        add(ext([[-0.1, 0.035], [0.1, 0.035], [0.12, -0.02], [0.1, -0.06], [-0.1, -0.06], [-0.12, -0.02]], 0.25), M.armor, chest, sx * 0.27 * B, 0.15, 0, 0, 0, -sx * 0.42);
        add(ext([[-0.085, 0.02], [0.085, 0.02], [0.095, -0.03], [-0.095, -0.03]], 0.21), M.armor2, chest, sx * 0.33 * B, 0.06, 0, 0, 0, -sx * 0.8);
        add(cbox(0.17, 0.028, 0.006, 0.002), M.paint, chest, sx * 0.275 * B, 0.15, -0.128, 0, 0, -sx * 0.42);
      }
      // jetpack: angular block, two thruster pods
      add(cbox(0.36, 0.44, 0.15, 0.02), M.armor, pack, 0, 0, 0);
      add(cbox(0.26, 0.2, 0.03, 0.008), M.armor2, pack, 0, 0.06, 0.08);
      add(cbox(0.18, 0.03, 0.006, 0.002), M.paint, pack, 0, -0.07, 0.097);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.065, 0.065, 0.38, 8), M.armor2, pack, sx * 0.17, -0.04, 0.07);
        add(cbox(0.012, 0.2, 0.004, 0.002), M.accent, pack, sx * 0.17, -0.04, 0.138, 0, 0, 0, false);
        nozzle(sx * 0.17, -0.25, 0.07, 0.055);
      }
      // --- helmet: shell, gold visor in an angular frame, chin guard, ear module
      helmShell();
      add(new THREE.SphereGeometry(0.173, 24, 14, Math.PI * 1.13, Math.PI * 0.74, Math.PI * 0.27, Math.PI * 0.36).scale(1.02, 1.06, 1.08), M.visor, head, 0, 0.1, 0.008, 0, 0, 0, false);
      add(ext([[-0.12, 0.0], [0.12, 0.0], [0.09, -0.07], [-0.09, -0.07]], 0.05), M.armor, head, 0, 0.0, -0.145, -0.25, 0, 0); // chin guard
      add(cbox(0.05, 0.035, 0.26, 0.008), M.armor2, head, 0, 0.27, 0.02); // ridge
      add(cbox(0.06, 0.006, 0.2, 0.002), M.paint, head, 0, 0.29, 0.02);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 8).rotateZ(Math.PI / 2), M.armor2, head, sx * 0.175, 0.09, 0.02);
        add(ring(0.04, 0.006).rotateZ(Math.PI / 2), M.accent, head, sx * 0.197, 0.09, 0.02, 0, 0, 0, false);
      }
      add(cbox(0.04, 0.04, 0.07, 0.008), M.dark, head, 0.19, 0.18, -0.03);
      add(new THREE.CircleGeometry(0.014, 10), M.lamp, head, 0.19, 0.18, -0.066, 0, Math.PI, 0, false);
    } else if (cls === 'engineer') {
      // --- utility vest with lots of pouches
      add(ext([[-0.16, 0.15], [0.16, 0.15], [0.18, 0.02], [0.14, -0.06], [-0.14, -0.06], [-0.18, 0.02]], 0.05), M.armor, chest, 0, 0.05, -0.15);
      add(cbox(0.3, 0.035, 0.006, 0.002), M.paint, chest, 0, 0.13, -0.178);
      for (const [x, y] of [[-0.12, -0.1], [-0.04, -0.1], [0.04, -0.1], [0.12, -0.1], [-0.12, -0.2], [0.12, -0.2]]) {
        add(cbox(0.07, 0.08, 0.05, 0.008), M.strap, chest, x, y, -0.16);
        add(cbox(0.072, 0.018, 0.052, 0.004), M.armor2, chest, x, y + 0.035, -0.16);
      }
      add(cbox(0.06, 0.09, 0.04, 0.008), M.armor2, chest, -0.17, 0.17, -0.08); // radio
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5), M.dark, chest, -0.19, 0.3, -0.07);
      for (const sx of [-1, 1]) {
        add(facet(0.105, 1.1, 0.72, 1.0, 0), M.armor, chest, sx * 0.27 * B, 0.13, 0);
        add(cbox(0.045, 0.3, 0.02, 0.005), M.strap, chest, sx * 0.1, 0.05, 0.18);
      }
      add(cbox(0.38, 0.34, 0.05, 0.01), M.armor2, chest, 0, 0.0, 0.15);
      // tool rig on the back with a robot arm over the right shoulder
      add(cbox(0.3, 0.38, 0.13, 0.015), M.armor2, pack, 0, 0, 0);
      add(cbox(0.24, 0.16, 0.12, 0.012), M.armor, pack, 0, -0.08, 0.1); // toolbox
      add(cbox(0.25, 0.025, 0.122, 0.004), M.hazard, pack, 0, -0.01, 0.1);
      add(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 8), M.dark, pack, 0.13, 0.22, 0.0);
      add(along(cbox(0.05, 0.3, 0.05, 0.008), [0.13, 0.24, 0.0], [0.22, 0.45, -0.12]), M.armor, pack, 0.175, 0.345, -0.06);
      add(facet(0.035, 1, 1, 1, 0), M.metal, pack, 0.22, 0.45, -0.12);
      add(along(cbox(0.04, 0.22, 0.04, 0.008), [0.22, 0.45, -0.12], [0.26, 0.38, -0.32]), M.armor, pack, 0.24, 0.415, -0.22);
      for (const sx of [-1, 1]) add(along(cbox(0.012, 0.07, 0.02, 0.003), [0.26, 0.38, -0.32], [0.26 + sx * 0.03, 0.34, -0.38]), M.metal, pack, 0.26 + sx * 0.015, 0.36, -0.35);
      add(new THREE.CircleGeometry(0.012, 8), M.lens, pack, 0.265, 0.4, -0.335, 0, Math.PI, 0, false);
      for (const sx of [-1, 1]) nozzle(sx * 0.1, -0.21, 0.02, 0.045);
      // --- helmet: hard shell, flat visor, twin lamps, big ear muffs
      helmShell(1.04, 1.0, 1.04);
      add(cbox(0.27, 0.1, 0.035, 0.01), M.armor2, head, 0, 0.1, -0.16, -0.12, 0, 0); // visor frame
      add(cbox(0.235, 0.075, 0.02, 0.006), M.glass, head, 0, 0.1, -0.178, -0.12, 0, 0, false); // flat visor
      add(ext([[-0.19, 0.0], [0.19, 0.0], [0.17, 0.03], [-0.17, 0.03]], 0.3), M.armor, head, 0, 0.19, 0.0, 0, 0, 0); // hard-hat brim
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 10).rotateZ(Math.PI / 2), M.armor2, head, sx * 0.18, 0.08, 0.02);
        add(cbox(0.035, 0.03, 0.05, 0.006), M.dark, head, sx * 0.07, 0.235, -0.15);
        add(new THREE.CircleGeometry(0.012, 10), M.lamp, head, sx * 0.07, 0.235, -0.176, 0, Math.PI, 0, false);
      }
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 5), M.dark, head, -0.17, 0.25, 0.05);
      add(facet(0.012, 1, 1, 1, 0), M.accent, head, -0.17, 0.36, 0.05, 0, 0, 0, false);
    } else if (cls === 'pyro') {
      // --- heavy segmented heat armour and an apron
      for (let k = 0; k < 4; k++) add(cbox((0.38 - k * 0.025) * B, 0.065, 0.07, 0.01), M.armor, chest, 0, 0.12 - k * 0.075, -0.15 * B + k * 0.006, 0.08, 0, 0);
      add(cbox(0.3, 0.025, 0.006, 0.002), M.hazard, chest, 0, -0.17, -0.18 * B);
      add(cbox(0.42 * B, 0.38, 0.07, 0.012), M.armor2, chest, 0, 0, 0.14 * B);
      for (const sx of [-1, 1]) {
        add(facet(0.125, 1.25, 0.8, 1.15, 0), M.armor, chest, sx * 0.29 * B, 0.13, 0);
        add(ring(0.12, 0.012), M.armor2, chest, sx * 0.29 * B, 0.11, 0, 0, 0, sx * 0.4);
      }
      // two big fuel tanks with hazard bands and a feed hose
      add(cbox(0.36, 0.38, 0.08, 0.012), M.armor2, pack, 0, 0, -0.02);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.09, 0.09, 0.46, 12), M.armor, pack, sx * 0.1, 0.02, 0.08);
        add(new THREE.SphereGeometry(0.09, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.armor, pack, sx * 0.1, 0.25, 0.08);
        add(new THREE.CylinderGeometry(0.092, 0.092, 0.04, 12), M.hazard, pack, sx * 0.1, 0.12, 0.08);
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 6), M.metal, pack, sx * 0.1, 0.36, 0.08);
      }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.1, -0.2, 0.1], [0.2, -0.36, 0.05], [0.24, -0.42, -0.12], [0.2, -0.38, -0.25]].map((v) => new THREE.Vector3(...v))), 16, 0.022, 6), M.rubber, pack);
      for (const sx of [-1, 1]) nozzle(sx * 0.1, -0.24, 0.08, 0.06);
      // --- gas-mask helmet: hood, goggles, respirator, filters
      add(new THREE.SphereGeometry(0.178, 16, 12).scale(1.04, 1.06, 1.06), M.strap, head, 0, 0.1, 0.01);
      add(ext([[-0.13, 0.06], [0.13, 0.06], [0.14, -0.04], [0.06, -0.12], [-0.06, -0.12], [-0.14, -0.04]], 0.07), M.armor2, head, 0, 0.09, -0.135); // mask
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).rotateX(Math.PI / 2), M.dark, head, sx * 0.065, 0.13, -0.175);
        add(new THREE.CircleGeometry(0.04, 12), M.lens, head, sx * 0.065, 0.13, -0.191, 0, Math.PI, 0, false);
        add(along(new THREE.CylinderGeometry(0.042, 0.042, 0.08, 10), [sx * 0.05, 0.02, -0.17], [sx * 0.15, -0.06, -0.15]), M.armor, head, sx * 0.1, -0.02, -0.16); // filter
        add(along(ring(0.043, 0.007).rotateX(-Math.PI / 2).rotateX(Math.PI / 2), [sx * 0.05, 0.02, -0.17], [sx * 0.15, -0.06, -0.15]), M.hazard, head, sx * 0.12, -0.035, -0.158);
      }
      add(new THREE.CylinderGeometry(0.04, 0.05, 0.07, 10).rotateX(Math.PI / 2), M.armor, head, 0, 0.02, -0.2); // respirator
      add(cbox(0.42, 0.08, 0.32, 0.015), M.armor, head, 0, -0.06, 0.02); // heat collar
    } else {
      // --- ranger: light armour, bandolier, one pauldron, cape
      add(ext([[-0.13, 0.15], [0.13, 0.15], [0.17, 0.05], [0.12, -0.1], [-0.12, -0.1], [-0.17, 0.05]], 0.05), M.armor, chest, 0, 0.02, -0.135);
      add(cbox(0.36, 0.32, 0.05, 0.01), M.armor2, chest, 0, 0, 0.13);
      // bandolier with glowing cells, from the left shoulder to the right hip
      const bA = [-0.17, 0.2, -0.16], bB = [0.19, -0.22, -0.15];
      add(along(cbox(0.045, 0.62, 0.018, 0.004), bA, bB), M.strap, chest, (bA[0] + bB[0]) / 2, (bA[1] + bB[1]) / 2, -0.175);
      for (let k = 0; k < 6; k++) {
        const t = 0.15 + k * 0.14;
        add(cbox(0.035, 0.05, 0.03, 0.006), M.dark, chest, bA[0] + (bB[0] - bA[0]) * t, bA[1] + (bB[1] - bA[1]) * t, -0.19, 0, 0, -0.71);
        add(cbox(0.012, 0.03, 0.004, 0.002), M.accent, chest, bA[0] + (bB[0] - bA[0]) * t, bA[1] + (bB[1] - bA[1]) * t, -0.207, 0, 0, -0.71, false);
      }
      add(ext([[-0.1, 0.03], [0.1, 0.03], [0.12, -0.03], [0.0, -0.08], [-0.12, -0.03]], 0.22), M.armor, chest, -0.27 * B, 0.15, 0, 0, 0, 0.45);
      add(cbox(0.12, 0.024, 0.006, 0.002), M.paint, chest, -0.27 * B, 0.15, -0.115, 0, 0, 0.45);
      add(facet(0.075, 1, 0.8, 1, 0), M.strap, chest, 0.27 * B, 0.12, 0);
      // slim jetpack with fins
      add(cbox(0.24, 0.4, 0.1, 0.015), M.armor2, pack, 0, 0, 0);
      for (const sx of [-1, 1]) {
        add(ext([[0, 0.2], [0.16, -0.05], [0.16, -0.15], [0, -0.1]], 0.02), M.armor, pack, sx * 0.12, 0, 0.02, 0, sx < 0 ? Math.PI : 0, 0);
        add(cbox(0.01, 0.14, 0.004, 0.002), M.accent, pack, sx * 0.08, 0.02, 0.052, 0, 0, 0, false);
        nozzle(sx * 0.07, -0.22, 0.01, 0.04);
      }
      // cape hanging from the shoulders (sways when running)
      const capeGeo = new THREE.PlaneGeometry(0.46, 0.85, 4, 8);
      const p = capeGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, Math.cos((x / 0.23) * 1.3) * -0.05 + (0.425 - y) * 0.05);
        p.setX(i, x * (1 + (0.425 - y) * 0.25));
      }
      capeGeo.translate(0, -0.425, 0);
      capeGeo.computeVertexNormals();
      const capeMat = M.strap.clone();
      capeMat.side = THREE.DoubleSide;
      const cape = add(capeGeo, capeMat, chest, 0, 0.17, 0.27);
      cape.userData.keep = true;
      this.cape = cape;
      // --- sleek helmet with a glowing T-visor, sensor and fin; hood around it
      helmShell(0.98, 1.0, 1.15);
      add(ext([[-0.12, 0.07], [0.12, 0.07], [0.13, -0.03], [0.05, -0.12], [-0.05, -0.12], [-0.13, -0.03]], 0.05), M.armor2, head, 0, 0.1, -0.16); // face plate
      add(cbox(0.2, 0.03, 0.012, 0.004), M.lens, head, 0, 0.13, -0.188, 0, 0, 0, false);
      add(cbox(0.03, 0.09, 0.012, 0.004), M.lens, head, 0, 0.075, -0.188, 0, 0, 0, false);
      add(new THREE.CylinderGeometry(0.028, 0.028, 0.07, 8).rotateX(Math.PI / 2), M.dark, head, 0.12, 0.15, -0.17);
      add(new THREE.CircleGeometry(0.02, 10), M.lens, head, 0.12, 0.15, -0.206, 0, Math.PI, 0, false);
      add(ext([[0, 0], [0.16, 0], [0.04, 0.09]], 0.02), M.armor, head, 0, 0.24, 0.05, 0, Math.PI / 2, 0); // fin
      add(new THREE.SphereGeometry(0.2, 16, 8, Math.PI * -0.05, Math.PI * 1.1, Math.PI * 0.32, Math.PI * 0.36).scale(1.05, 1.0, 1.1), capeMat, head, 0, 0.05, 0.02); // cowl
    }
  }

  // ------------------------------------------------------------ weapons
  buildGun(cls, M, add, gun) {
    const zr = (g) => g.rotateX(Math.PI / 2);
    let muzzleZ = -0.53;
    add(cbox(0.05, 0.16, 0.07, 0.01), M.dark, gun, 0, -0.12, 0.09); // grip
    add(cbox(0.06, 0.1, 0.2, 0.012), M.dark, gun, 0, -0.01, 0.33); // stock
    if (cls === 'engineer') {
      add(cbox(0.075, 0.12, 0.34, 0.014), M.dark, gun, 0, 0, 0.02);
      add(zr(new THREE.CylinderGeometry(0.026, 0.026, 0.46, 10)), M.dark, gun, 0, 0.03, -0.36);
      add(zr(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 8)), M.dark, gun, 0, -0.02, -0.31);
      add(cbox(0.08, 0.07, 0.17, 0.014), M.paint, gun, 0, -0.012, -0.26); // pump
      for (let k = 0; k < 3; k++) add(zr(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 6)), M.accent, gun, 0.042, 0.0, 0.0 - k * 0.03, 0, 0, 0, false);
      muzzleZ = -0.6;
    } else if (cls === 'pyro') {
      add(cbox(0.07, 0.1, 0.4, 0.012), M.dark, gun, 0, 0.0, -0.06);
      add(zr(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 12)), M.armor, gun, 0, -0.1, -0.06);
      for (const z of [0.08, -0.2]) add(zr(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 12)), M.dark, gun, 0, -0.1, z);
      add(zr(new THREE.CylinderGeometry(0.03, 0.042, 0.12, 10)), M.dark, gun, 0, 0.01, -0.33);
      for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.03, 0.006, 6, 12), M.accent, gun, 0, 0.01, -0.22 - k * 0.04, 0, 0, 0, false);
      muzzleZ = -0.4;
    } else if (cls === 'ranger') {
      add(cbox(0.075, 0.12, 0.4, 0.012), M.dark, gun, 0, 0.0, 0.02);
      for (const sx of [-1, 1]) {
        add(cbox(0.016, 0.04, 0.46, 0.004), M.armor, gun, sx * 0.028, 0.02, -0.4);
        add(new THREE.BoxGeometry(0.006, 0.024, 0.42), M.accent, gun, sx * 0.019, 0.02, -0.4, 0, 0, 0, false);
      }
      for (let k = 0; k < 4; k++) add(new THREE.TorusGeometry(0.04, 0.007, 6, 12), k % 2 ? M.accent : M.dark, gun, 0, 0.02, -0.24 - k * 0.09, 0, 0, 0, false);
      add(zr(new THREE.CylinderGeometry(0.026, 0.026, 0.18, 10)), M.dark, gun, 0, 0.12, -0.02);
      add(new THREE.CircleGeometry(0.022, 10), M.accent, gun, 0, 0.12, 0.072, 0, 0, 0, false);
      muzzleZ = -0.66;
    } else {
      // pulse rifle in the style of the first-person one: white top, dark body
      add(cbox(0.07, 0.11, 0.52, 0.012), M.dark, gun, 0, 0, 0);
      add(cbox(0.075, 0.06, 0.3, 0.01), M.armor, gun, 0, 0.06, -0.06);
      add(cbox(0.02, 0.03, 0.12, 0.004), M.paint, gun, 0.039, 0.02, -0.2);
      add(zr(new THREE.CylinderGeometry(0.022, 0.026, 0.26, 10)), M.dark, gun, 0, 0.01, -0.37);
      add(zr(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 8)), M.dark, gun, 0, 0.01, -0.48);
      add(cbox(0.05, 0.18, 0.09, 0.01), M.paint, gun, 0, -0.13, -0.06); // magazine
      add(zr(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10)), M.dark, gun, 0, 0.12, 0.02);
      add(new THREE.CircleGeometry(0.026, 10), M.accent, gun, 0, 0.12, 0.092, 0, 0, 0, false);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.006, 0.02, 0.24), M.accent, gun, sx * 0.039, 0.0, -0.08, 0, 0, 0, false);
    }
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.01, muzzleZ);
    gun.add(this.muzzle);
  }

  // a shot: recoil
  fire() { this.kick = 1; }

  // pos: feet position; yaw/pitch: view angles; speed: horizontal speed
  update(dt, pos, yaw, pitch, speed, dead) {
    const r = this.root;
    this.t += dt;
    // movement direction relative to where the player looks (forwards / backwards / strafing)
    let fwd = 1, side = 0;
    if (this.prev && dt > 0) {
      const vx = (pos.x - this.prev.x) / dt, vz = (pos.z - this.prev.z) / dt;
      const sp = Math.hypot(vx, vz);
      if (sp > 0.3) {
        fwd = (-Math.sin(yaw) * vx - Math.cos(yaw) * vz) / sp;
        side = (Math.cos(yaw) * vx - Math.sin(yaw) * vz) / sp;
      }
    }
    this.prev = this.prev || new THREE.Vector3();
    this.prev.copy(pos);
    this.fwdS = (this.fwdS ?? 1) + (fwd - (this.fwdS ?? 1)) * Math.min(1, dt * 8);
    this.sideS = (this.sideS ?? 0) + (side - (this.sideS ?? 0)) * Math.min(1, dt * 8);

    r.position.copy(pos);
    // the hips turn a little towards a strafe, the torso keeps facing the aim
    const hipTurn = this.sideS * 0.5 * Math.sign(this.fwdS || 1);
    r.rotation.y = yaw;
    this.hips.rotation.y = -hipTurn;
    this.torso.rotation.y = hipTurn;

    // aim: the arms + weapon pitch fully, the head most of the way, the chest a little
    this.kick = Math.max(0, this.kick - dt * 9);
    this.aim.rotation.x = pitch * 0.85 + this.kick * 0.08;
    this.gun.position.z = -0.32 + this.kick * 0.05;
    this.head.rotation.x = pitch * 0.5;
    this.chest.rotation.x = pitch * 0.15;

    // air: jetpack or falling
    const air = pos.y - groundAt(pos.x, pos.z);
    this.vy = ((pos.y - (this.lastY ?? pos.y)) / Math.max(dt, 1e-4)) * 0.3 + (this.vy || 0) * 0.7;
    this.lastY = pos.y;
    const inAir = !dead && air > 0.35;
    this.airT += ((inAir ? 1 : 0) - this.airT) * Math.min(1, dt * 6);
    const jet = inAir && this.vy > -3.5;
    for (const f of this.flames) {
      f.visible = jet;
      if (jet) f.scale.set(1, 0.75 + Math.random() * 0.5, 1);
    }

    const M = mocap();
    if (M) {
      this.animate(dt, M, speed, pitch, dead);
      this.downT += ((dead ? 1 : 0) - this.downT) * Math.min(1, dt * 5);
      r.rotation.x = 0;
      r.position.y = pos.y;
      this.tag.visible = this.downT < 0.5;
      return;
    }
    // walking cycle (backwards when walking backwards)
    const moving = Math.min(1, speed / 5) * (1 - this.airT);
    const dir = this.fwdS < -0.3 ? -1 : 1;
    this.walk += dt * speed * 1.75 * dir;
    for (const l of this.legs) {
      const ph = this.walk + (l.side > 0 ? Math.PI : 0);
      const s = Math.sin(ph);
      const lift = Math.max(0, -Math.cos(ph));
      // +x swings a leg forward; the knee bends backwards (negative)
      l.hip.rotation.x = s * 0.55 * moving * (1 - Math.abs(this.sideS) * 0.5) + this.airT * 0.3 + lift * 0.15 * moving;
      l.hip.rotation.z = l.side * (0.04 + Math.abs(this.sideS) * 0.12 * moving);
      l.knee.rotation.x = -(lift * 1.05 * moving + this.airT * 0.75 + 0.05);
      l.ankle.rotation.x = -(l.hip.rotation.x + l.knee.rotation.x) * 0.8;
    }
    // bob, lean into the run (no scaling: scaled armour shimmers)
    const bob = Math.abs(Math.sin(this.walk)) * 0.045 * moving;
    this.hips.position.y = 0.96 - 0.03 * moving + bob - this.airT * 0.05 + Math.sin(this.t * 1.7) * 0.004;
    this.torso.rotation.x = 0.12 * moving * Math.max(0, this.fwdS);
    this.torso.rotation.z = -this.sideS * 0.06 * moving;
    if (this.cape) this.cape.rotation.x = 0.08 + moving * 0.55 * Math.max(0, this.fwdS) + this.airT * 0.7 + Math.sin(this.t * 2.3) * 0.04;

    // knocked down: lie on the ground
    this.downT += ((dead ? 1 : 0) - this.downT) * Math.min(1, dt * 5);
    r.rotation.x = -this.downT * 1.45;
    r.position.y = pos.y + this.downT * 0.25;
    this.tag.visible = this.downT < 0.5;
  }

  // motion-capture driven pose: locomotion blended by move direction, jump and death
  animate(dt, M, speed, pitch, dead) {
    const C = M.clips;
    const P = this.pose || (this.pose = new Pose());
    P.reset();
    // knocked down: the death clip plays once (and runs backwards when revived)
    this.deadT = dead ? (this.deadT || 0) + dt : Math.max(0, (this.deadT || 0) - dt * 3);
    const wDead = C.death ? Math.min(1, this.deadT * 6) : 0;
    const alive = 1 - wDead;
    // locomotion: all cycles share one phase; cadence rises with speed
    const mv = Math.min(1, speed / 2.2) * (1 - this.airT);
    this.phase = ((this.phase || 0) + dt * (0.55 + speed * 0.16)) % 1;
    const f = this.fwdS, sd = this.sideS;
    let wf = Math.max(0, f), wb = Math.max(0, -f), wl = Math.max(0, -sd), wr = Math.max(0, sd);
    const sum = wf + wb + wl + wr || 1;
    wf /= sum; wb /= sum; wl /= sum; wr /= sum;
    const cyc = (clip, w) => { const c = clip || C.walk; P.add(c, this.phase * clipDuration(c), true, w * mv * alive); };
    // forwards: walk blends into a run with speed
    const wRun = C.run ? THREE.MathUtils.clamp((speed - 3) / 2.5, 0, 1) : 0;
    cyc(C.walk, wf * (1 - wRun)); cyc(C.run, wf * wRun);
    cyc(C.back, wb); cyc(C.strafe_l, wl); cyc(C.strafe_r, wr);
    P.add(C.idle, this.t, true, (1 - mv) * (1 - this.airT) * alive);
    // in the air: hold a frame of the jump (tucked going up, reaching down when falling)
    if (C.jump) P.add(C.jump, (this.vy > 0.5 ? 0.32 : 0.5) * clipDuration(C.jump), false, this.airT * alive);
    if (wDead) P.add(C.death, this.deadT, false, wDead);
    P.finish();
    // longer strides when running fast
    const k = 1 + (C.run ? 0.25 * (1 - wf) : 0.55) * THREE.MathUtils.clamp((speed - 3) / 6, 0, 1) * mv;
    const L = 0.93;
    this.hips.quaternion.copy(P.q.hips);
    this.hips.position.set(P.hx * L, 0.96 + P.hy * L, P.hz * L);
    this.torso.quaternion.copy(P.q.torso);
    _pq.setFromAxisAngle(_X, pitch * 0.15 * alive);
    this.chest.quaternion.copy(P.q.chest).multiply(_pq);
    _pq.setFromAxisAngle(_X, pitch * 0.5 * alive);
    this.head.quaternion.copy(P.q.head).multiply(_pq);
    const [lL, lR] = this.legs[0].side < 0 ? this.legs : [this.legs[1], this.legs[0]];
    const set = (obj, q, kk = 1) => { if (kk === 1) obj.quaternion.copy(q); else obj.quaternion.slerpQuaternions(_I, q, kk); };
    set(lL.hip, P.q.lhip, k); set(lL.knee, P.q.lknee, k); set(lL.ankle, P.q.lankle);
    set(lR.hip, P.q.rhip, k); set(lR.knee, P.q.rknee, k); set(lR.ankle, P.q.rankle);
    if (this.cape) this.cape.rotation.x = 0.08 + mv * 0.55 * Math.max(0, f) + this.airT * 0.7 + Math.sin(this.t * 2.3) * 0.04;
  }

  muzzleWorld(out) { this.muzzle.getWorldPosition(out); return out; }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}
