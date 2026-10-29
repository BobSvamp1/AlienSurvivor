import * as THREE from 'three';
import { wornMetal, texSet } from '../core/materials.js';
import { groundAt } from '../world/elevation.js';

// Third-person look of another player: a stranded astronaut in a hard-shell EVA suit
// with a jetpack, in the player's colour. Walks, strafes, aims, recoils, hovers on the
// jetpack and falls over when downed. A floating name tag shows who it is.

export const PLAYER_COLORS = ['#3de0ff', '#ffb43d', '#7dff6a', '#ff5ad1'];

const FLAME = new THREE.MeshBasicMaterial({ color: '#ffb44a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const FLAME_CORE = new THREE.MeshBasicMaterial({ color: '#fff4d0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

const shared = {};
function mats(color) {
  if (shared[color]) return shared[color];
  const c = new THREE.Color(color);
  const teamCol = new THREE.Color(color).lerp(new THREE.Color('#9aa0a8'), 0.25);
  // white suit fabric: only the cloth's bumps, not its brown colour
  const nor = texSet('fabric').nor.clone();
  nor.repeat.set(3, 3);
  nor.needsUpdate = true;
  shared[color] = {
    suit: new THREE.MeshStandardMaterial({ color: '#d9dce1', roughness: 0.88, metalness: 0, normalMap: nor, normalScale: new THREE.Vector2(0.9, 0.9) }),
    plate: wornMetal('#' + teamCol.getHexString(), { metalness: 0.35, roughness: 0.38, scratches: 0.3 }),
    white: wornMetal('#e9ebee', { metalness: 0.2, roughness: 0.4, scratches: 0.2 }),
    dark: wornMetal('#23272d', { metalness: 0.7, roughness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.9, metalness: 0 }),
    accent: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.4, toneMapped: false }),
    visor: new THREE.MeshPhysicalMaterial({ color: '#b08a3a', metalness: 1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.6, iridescence: 0.35, iridescenceIOR: 1.6 }),
    gold: new THREE.MeshPhysicalMaterial({ color: '#c99a3e', metalness: 1, roughness: 0.18, clearcoat: 0.6 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 3, toneMapped: false }),
  };
  return shared[color];
}

// box with rounded edges (extruded rounded rectangle), centred
function rbox(w, h, d, r) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const s = new THREE.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, W = w - 2 * r, H = h - 2 * r;
  s.moveTo(x, y - r);
  s.lineTo(x + W, y - r);
  s.quadraticCurveTo(x + W + r, y - r, x + W + r, y);
  s.lineTo(x + W + r, y + H);
  s.quadraticCurveTo(x + W + r, y + H + r, x + W, y + H + r);
  s.lineTo(x, y + H + r);
  s.quadraticCurveTo(x - r, y + H + r, x - r, y + H);
  s.lineTo(x - r, y);
  s.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.98, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.computeVertexNormals();
  return g;
}

// tapered limb segment from a to b
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function limbGeo(a, b, r1, r2) {
  _a.set(...a); _b.set(...b);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r2, r1, len, 14, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  g.applyQuaternion(q);
  g.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
  return g;
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

export class Avatar {
  constructor(scene, name, color, cls = 'marine') {
    this.scene = scene;
    const M = mats(color);
    this.M = M;
    const root = new THREE.Group();
    const add = (geo, mat, parent, x = 0, y = 0, z = 0, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const sph = (r, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 18, 14).scale(sx, sy, sz);

    // ---------------- hips + legs
    const hips = new THREE.Group();
    hips.position.y = 0.96;
    root.add(hips);
    this.hips = hips;
    add(sph(0.17, 1.15, 0.75, 0.85), M.suit, hips, 0, 0.0, 0);
    add(rbox(0.36, 0.1, 0.26, 0.04), M.dark, hips, 0, 0.06, 0); // belt
    add(rbox(0.1, 0.07, 0.03, 0.012), M.gold, hips, 0, 0.06, -0.135); // buckle
    for (const sx of [-1, 1]) add(rbox(0.05, 0.07, 0.09, 0.015), M.white, hips, sx * 0.19, 0.03, 0.02); // belt pouches

    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11, -0.04, 0);
      hips.add(hip);
      add(limbGeo([0, 0, 0], [0, -0.43, 0], 0.105, 0.082), M.suit, hip);
      add(rbox(0.15, 0.24, 0.1, 0.035), M.white, hip, side * 0.01, -0.2, -0.06); // thigh plate
      add(new THREE.TorusGeometry(0.078, 0.014, 6, 16).rotateX(Math.PI / 2), M.dark, hip, 0, -0.4, 0, false);
      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      hip.add(knee);
      add(sph(0.075), M.suit, knee);
      add(sph(0.07, 1.05, 0.95, 0.75), M.white, knee, 0, 0.0, -0.05); // knee cap
      add(limbGeo([0, 0, 0], [0, -0.4, 0], 0.08, 0.066), M.suit, knee);
      add(rbox(0.13, 0.26, 0.08, 0.03), M.plate, knee, 0, -0.18, -0.055); // shin guard
      add(new THREE.BoxGeometry(0.06, 0.012, 0.01), M.accent, knee, 0, -0.12, -0.097, false);
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.41, 0);
      knee.add(ankle);
      add(rbox(0.15, 0.13, 0.28, 0.04), M.white, ankle, 0, -0.03, -0.05); // boot
      add(rbox(0.16, 0.04, 0.3, 0.015), M.rubber, ankle, 0, -0.095, -0.05); // sole
      add(rbox(0.12, 0.05, 0.06, 0.02), M.dark, ankle, 0, 0.0, -0.17); // toe cap
      add(new THREE.TorusGeometry(0.066, 0.016, 6, 16).rotateX(Math.PI / 2), M.dark, ankle, 0, 0.05, 0, false);
      this.legs.push({ hip, knee, ankle, side });
    }

    // ---------------- torso (turns + leans with the aim)
    const torso = new THREE.Group();
    torso.position.y = 0.06;
    hips.add(torso);
    this.torso = torso;
    add(new THREE.CylinderGeometry(0.15, 0.16, 0.16, 16), M.suit, torso, 0, 0.1, 0); // waist
    for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.152, 0.012, 6, 20).rotateX(Math.PI / 2), M.dark, torso, 0, 0.05 + k * 0.05, 0, false);
    const chest = new THREE.Group();
    chest.position.y = 0.36;
    torso.add(chest);
    this.chest = chest;
    add(sph(0.2, 1.22, 1.05, 0.88), M.suit, chest, 0, 0, 0);
    add(rbox(0.36, 0.28, 0.12, 0.05), M.white, chest, 0, 0.0, -0.11); // chest plate
    add(rbox(0.37, 0.05, 0.11, 0.02), M.plate, chest, 0, 0.1, -0.115); // team stripe
    add(rbox(0.16, 0.08, 0.04, 0.015), M.dark, chest, 0, -0.06, -0.175); // display panel
    add(new THREE.BoxGeometry(0.11, 0.02, 0.01), M.accent, chest, 0, -0.05, -0.197, false);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.01), M.lamp, chest, 0.1, 0.07, -0.18, false);
    for (const sx of [-1, 1]) {
      // shoulder pads
      const pad = add(sph(0.11, 1.15, 0.8, 1.05), M.plate, chest, sx * 0.25, 0.1, 0);
      pad.rotation.z = -sx * 0.35;
      add(new THREE.BoxGeometry(0.02, 0.07, 0.012), M.accent, chest, sx * 0.33, 0.07, -0.05, false);
    }
    add(new THREE.TorusGeometry(0.12, 0.028, 8, 22).rotateX(Math.PI / 2), M.dark, chest, 0, 0.2, 0.0); // neck ring

    // ---------------- jetpack
    const pack = new THREE.Group();
    pack.position.set(0, 0.0, 0.2);
    chest.add(pack);
    add(rbox(0.38, 0.46, 0.17, 0.06), M.white, pack, 0, 0, 0);
    add(rbox(0.24, 0.26, 0.04, 0.02), M.plate, pack, 0, 0.04, 0.085);
    for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.16, 0.014, 0.01), M.dark, pack, 0, -0.04 + k * 0.05, 0.108, false);
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 14), M.plate, pack, sx * 0.16, -0.02, 0.1); // fuel tanks
      add(sph(0.06), M.plate, pack, sx * 0.16, 0.18, 0.1);
      add(new THREE.BoxGeometry(0.015, 0.22, 0.012), M.accent, pack, sx * 0.16, -0.02, 0.163, false);
    }
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), M.dark, pack, 0.13, 0.33, 0.02, false); // antenna
    add(sph(0.016), M.accent, pack, 0.13, 0.44, 0.02, false);
    this.flames = [];
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.045, 0.07, 0.1, 14), M.dark, pack, sx * 0.1, -0.28, 0.07);
      const fl = new THREE.Group();
      fl.position.set(sx * 0.1, -0.33, 0.07);
      pack.add(fl);
      fl.add(new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.5, 12).rotateX(Math.PI).translate(0, -0.25, 0), FLAME));
      fl.add(new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.28, 10).rotateX(Math.PI).translate(0, -0.14, 0), FLAME_CORE));
      fl.visible = false;
      this.flames.push(fl);
    }
    // air hoses from the pack to the helmet
    for (const sx of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.15, 0.2, 0.16), new THREE.Vector3(sx * 0.2, 0.3, 0.06), new THREE.Vector3(sx * 0.13, 0.3, -0.05)]);
      add(new THREE.TubeGeometry(curve, 12, 0.018, 6), M.dark, chest, 0, 0, 0, false);
    }

    // ---------------- helmet
    const head = new THREE.Group();
    head.position.y = 0.3;
    chest.add(head);
    this.head = head;
    add(sph(0.17, 1, 1.04, 1.05), M.white, head, 0, 0.1, 0.01);
    // (sphere phi = 1.5π faces -Z, the way the astronaut looks)
    const visor = add(new THREE.SphereGeometry(0.172, 26, 16, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.26, Math.PI * 0.38).scale(1.02, 1.06, 1.08), M.visor, head, 0, 0.1, 0.008);
    visor.castShadow = false;
    const brim = add(new THREE.SphereGeometry(0.176, 26, 4, Math.PI * 1.1, Math.PI * 0.8, Math.PI * 0.24, Math.PI * 0.03).scale(1.02, 1.06, 1.08), M.dark, head, 0, 0.1, 0.008, false); // visor brim
    brim.material = M.dark;
    for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14).rotateZ(Math.PI / 2), M.plate, head, sx * 0.17, 0.09, 0.02); // ear pods
    add(rbox(0.05, 0.05, 0.08, 0.015), M.dark, head, 0.19, 0.17, -0.02); // helmet lamp
    add(new THREE.CircleGeometry(0.018, 12), M.lamp, head, 0.19, 0.17, -0.062, false);
    add(new THREE.SphereGeometry(0.181, 22, 8, 0, Math.PI * 2, 0, Math.PI * 0.2).scale(1, 1.04, 1.05), M.plate, head, 0, 0.1, 0.01); // cap in the team colour
    add(new THREE.TorusGeometry(0.105, 0.006, 4, 24).rotateX(Math.PI / 2), M.accent, head, 0, 0.243, 0.01, false);

    // ---------------- arms + rifle (pitch with the aim)
    const aim = new THREE.Group();
    aim.position.set(0, 0.06, 0);
    chest.add(aim);
    this.aim = aim;
    const gun = new THREE.Group();
    gun.position.set(0.11, -0.1, -0.32);
    gun.scale.setScalar(1.25);
    aim.add(gun);
    this.gun = gun;
    const zr = (g) => g.rotateX(Math.PI / 2);
    const weapon = { marine: 'rifle', engineer: 'shotgun', pyro: 'flamer', ranger: 'railgun' }[cls] || 'rifle';
    let muzzleZ = -0.53;
    add(rbox(0.05, 0.16, 0.07, 0.015), M.dark, gun, 0, -0.12, 0.09); // grip
    add(rbox(0.06, 0.1, 0.2, 0.02), M.dark, gun, 0, -0.01, 0.33); // stock
    if (weapon === 'shotgun') {
      add(rbox(0.075, 0.12, 0.34, 0.025), M.dark, gun, 0, 0, 0.02);
      add(zr(new THREE.CylinderGeometry(0.026, 0.026, 0.46, 12)), M.dark, gun, 0, 0.03, -0.36); // barrel
      add(zr(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 10)), M.dark, gun, 0, -0.02, -0.31); // tube
      add(rbox(0.08, 0.07, 0.17, 0.025), M.plate, gun, 0, -0.012, -0.26); // pump in the team colour
      for (let k = 0; k < 3; k++) add(zr(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 8)), M.accent, gun, 0.042, 0.0, 0.0 - k * 0.03, false);
      muzzleZ = -0.6;
    } else if (weapon === 'flamer') {
      add(rbox(0.07, 0.1, 0.4, 0.02), M.dark, gun, 0, 0.0, -0.06);
      add(zr(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 16)), M.plate, gun, 0, -0.1, -0.06); // fuel tank
      for (const z of [0.08, -0.2]) add(zr(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 16)), M.dark, gun, 0, -0.1, z);
      add(zr(new THREE.CylinderGeometry(0.03, 0.042, 0.12, 14)), M.dark, gun, 0, 0.01, -0.33); // nozzle
      for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.03, 0.006, 6, 14), M.accent, gun, 0, 0.01, -0.22 - k * 0.04, false);
      muzzleZ = -0.4;
    } else if (weapon === 'railgun') {
      add(rbox(0.075, 0.12, 0.4, 0.02), M.dark, gun, 0, 0.0, 0.02);
      for (const sx of [-1, 1]) {
        add(rbox(0.016, 0.04, 0.46, 0.006), M.plate, gun, sx * 0.028, 0.02, -0.4);
        add(new THREE.BoxGeometry(0.006, 0.024, 0.42), M.accent, gun, sx * 0.019, 0.02, -0.4, false);
      }
      for (let k = 0; k < 4; k++) add(new THREE.TorusGeometry(0.04, 0.007, 6, 14), k % 2 ? M.accent : M.dark, gun, 0, 0.02, -0.24 - k * 0.09, false);
      add(zr(new THREE.CylinderGeometry(0.026, 0.026, 0.18, 12)), M.dark, gun, 0, 0.12, -0.02); // scope
      add(new THREE.CircleGeometry(0.022, 12), M.accent, gun, 0, 0.12, 0.072, false);
      muzzleZ = -0.66;
    } else {
      add(rbox(0.07, 0.11, 0.52, 0.02), M.dark, gun, 0, 0, 0);
      add(rbox(0.075, 0.06, 0.26, 0.02), M.plate, gun, 0, 0.06, -0.08); // top cover
      add(zr(new THREE.CylinderGeometry(0.022, 0.026, 0.26, 12)), M.dark, gun, 0, 0.01, -0.37); // barrel
      add(zr(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 12)), M.dark, gun, 0, 0.01, -0.48); // muzzle brake
      add(rbox(0.05, 0.18, 0.09, 0.015), M.dark, gun, 0, -0.13, -0.06); // magazine
      add(zr(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12)), M.dark, gun, 0, 0.12, 0.02); // scope
      add(new THREE.CircleGeometry(0.026, 12), M.accent, gun, 0, 0.12, 0.092, false);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.006, 0.02, 0.24), M.accent, gun, sx * 0.039, 0.0, -0.08, false);
    }
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.01, muzzleZ);
    gun.add(this.muzzle);
    // arms: shoulder -> elbow -> hand on the rifle (positions in the aim group)
    const arm = (sh, el, hand) => {
      add(sph(0.07), M.suit, aim, ...sh);
      add(limbGeo(sh, el, 0.07, 0.06), M.suit, aim);
      add(sph(0.062), M.white, aim, ...el); // elbow pad
      add(limbGeo(el, hand, 0.058, 0.05), M.suit, aim);
      const cuffAt = [hand[0] + (el[0] - hand[0]) * 0.22, hand[1] + (el[1] - hand[1]) * 0.22, hand[2] + (el[2] - hand[2]) * 0.22];
      add(limbGeo(cuffAt, [hand[0] + (el[0] - hand[0]) * 0.02, hand[1] + (el[1] - hand[1]) * 0.02, hand[2] + (el[2] - hand[2]) * 0.02], 0.064, 0.064), M.plate, aim);
      add(rbox(0.08, 0.09, 0.1, 0.03), M.white, aim, ...hand); // glove
    };
    arm([0.25, 0.02, 0.0], [0.28, -0.26, -0.04], [0.11, -0.24, -0.21]); // right hand on the grip
    arm([-0.25, 0.02, 0.0], [-0.15, -0.26, -0.28], [0.09, -0.17, -0.5]); // left hand under the barrel

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

    // aim: the arms + rifle pitch fully, the head most of the way, the chest a little
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
    // bob, lean into the run, breathe
    const bob = Math.abs(Math.sin(this.walk)) * 0.045 * moving;
    this.hips.position.y = 0.96 - 0.03 * moving + bob - this.airT * 0.05;
    this.torso.rotation.x = 0.12 * moving * Math.max(0, this.fwdS);
    this.torso.rotation.z = -this.sideS * 0.06 * moving;
    this.chest.scale.y = 1 + Math.sin(this.t * 1.7) * 0.012;

    // knocked down: lie on the ground
    this.downT += ((dead ? 1 : 0) - this.downT) * Math.min(1, dt * 5);
    r.rotation.x = -this.downT * 1.45;
    r.position.y = pos.y + this.downT * 0.25;
    this.tag.visible = this.downT < 0.5;
  }

  muzzleWorld(out) { this.muzzle.getWorldPosition(out); return out; }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}
