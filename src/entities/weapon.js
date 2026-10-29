import * as THREE from 'three';
import { mergeStatic } from '../core/geomerge.js';
import { wornMetal } from '../core/materials.js';
import { WEAPONS } from '../data/classes.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// --- small canvas textures for the scope
function lensDirtTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  // a smudge (thumb print) off to one side
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(200,230,240,${0.05 + Math.random() * 0.04})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(170, 80, 12 + i * 2.4, 9 + i * 1.8, 0.6, 0.3, Math.PI * 1.7);
    g.stroke();
  }
  // dust specks
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(230,240,245,${0.15 + Math.random() * 0.4})`;
    const r = Math.random() < 0.9 ? 0.6 + Math.random() * 1.2 : 2 + Math.random() * 2;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  // fine scratches
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(220,240,250,${0.12 + Math.random() * 0.2})`;
    g.lineWidth = 0.7;
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI, l = 20 + Math.random() * 60;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // darker edge where the glass meets the tube
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(90,170,190,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 0-9 and '-' in cyan (row 0) and red (row 1), drawn once
let _atlas = null;
function digitAtlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas');
  c.width = 32 * 11; c.height = 96;
  const g = c.getContext('2d');
  g.font = 'bold 40px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let row = 0; row < 2; row++) {
    g.fillStyle = row ? '#ff5a4a' : '#5af0ff';
    for (let k = 0; k < 11; k++) g.fillText(k === 10 ? '-' : String(k), k * 32 + 16, row * 48 + 26);
  }
  _atlas = c;
  return c;
}

function reticleGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)');
  gr.addColorStop(0.42, 'rgba(255,255,255,0.0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function scopeLabelTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 54;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(210,225,235,0.75)';
  g.font = 'bold 34px monospace';
  g.textBaseline = 'middle';
  g.fillText('HX-4  1x', 6, 22);
  g.font = '18px monospace';
  g.fillStyle = 'rgba(210,225,235,0.45)';
  g.fillText('TAU-4 ARMORY  N2 ', 8, 45);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HIP = new THREE.Vector3(0.19, -0.19, -0.34);
const ADS = new THREE.Vector3(0, -0.1143, -0.15); // puts the scope axis (y 0.127 × scale 0.9) in the screen centre

export class Weapon {
  constructor(game) {
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 220;
    this.buildModel();
    this.reset();
  }

  buildModel() {
    const root = new THREE.Group(); // sway / recoil
    const g = new THREE.Group(); // the gun
    root.add(g);
    const M = {
      body: wornMetal('#2c3036', { metalness: 0.65, roughness: 0.55, scratches: 0.25 }),
      panel: wornMetal('#4d5547', { metalness: 0.3, roughness: 0.6, scratches: 0.3 }),
      dark: wornMetal('#16181c', { metalness: 0.55, roughness: 0.7 }),
      mid: wornMetal('#7a8088', { metalness: 0.9, roughness: 0.4 }),
      scope: wornMetal('#202328', { metalness: 0.6, roughness: 0.5 }),
      lens: new THREE.MeshStandardMaterial({ color: '#7af0ff', transparent: true, opacity: 0.07, roughness: 0.02, metalness: 1, depthWrite: false }),
      reticle: new THREE.MeshBasicMaterial({ color: '#5af0ff', toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }),
      glow: new THREE.MeshStandardMaterial({ color: '#3de0ff', emissive: '#3de0ff', emissiveIntensity: 1.1 }),
      cable: new THREE.MeshStandardMaterial({ color: '#1a6a80', emissive: '#3de0ff', emissiveIntensity: 0.55, roughness: 0.4 }),
      orange: wornMetal('#e8742e', { metalness: 0.2, roughness: 0.55 }),
      glove: new THREE.MeshStandardMaterial({ color: '#1b1e24', roughness: 0.75 }),
      sleeve: new THREE.MeshStandardMaterial({ color: '#34434e', roughness: 0.85 }),
      glass: new THREE.MeshStandardMaterial({ color: '#3de0ff', transparent: true, opacity: 0.1, roughness: 0, metalness: 0.5, depthWrite: false }),
      dot: new THREE.MeshBasicMaterial({ color: '#ff3d3d', toneMapped: false }),
      rubber: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.95, metalness: 0 }),
      glowText: new THREE.MeshBasicMaterial({ color: '#d8e6ee', toneMapped: false }),
    };
    // extrude a side profile (points as [z, y]) into a beveled solid of width w
    const profile = (pts, w, mat, bevel = 0.006, x = 0, parent = g) => {
      const sh = new THREE.Shape();
      pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
      sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: w - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
      geo.translate(0, 0, -(w - bevel * 2) / 2);
      geo.rotateY(-Math.PI / 2);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.x = x;
      parent.add(m);
      return m;
    };
    const box = (w, h, d, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const cyl = (r1, r2, h, mat, x, y, z, parent = g, seg = 16) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg).rotateX(Math.PI / 2), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    // profile points are [z, y] in gun space (forward is negative z)
    const P = (arr) => arr;
    // lower receiver + stock
    profile(P([[0.3, -0.015], [0.3, 0.055], [0.2, 0.045], [0.12, 0.06], [-0.16, 0.06], [-0.2, 0.035], [-0.2, -0.035], [0.02, -0.04], [0.1, -0.02], [0.2, -0.035]]), 0.058, M.body);
    // white top cover
    profile(P([[0.1, 0.055], [0.1, 0.072], [0.04, 0.08], [-0.17, 0.08], [-0.21, 0.065], [-0.2, 0.05]]), 0.062, M.panel, 0.008);
    // handguard
    profile(P([[-0.19, 0.06], [-0.42, 0.055], [-0.45, 0.03], [-0.44, -0.02], [-0.19, -0.035]]), 0.066, M.dark, 0.008);
    // glowing vents along the handguard
    for (const x of [-1, 1]) for (let i = 0; i < 5; i++) box(0.006, 0.03, 0.024, M.glow, x * 0.034, 0.012, -0.23 - i * 0.04);
    // barrel + muzzle brake
    cyl(0.013, 0.013, 0.1, M.mid, 0, 0.012, -0.49);
    cyl(0.022, 0.02, 0.055, M.dark, 0, 0.012, -0.55, g, 8);
    // stock pad and cheek rest
    box(0.064, 0.085, 0.022, M.dark, 0, 0.02, 0.305);
    box(0.02, 0.03, 0.1, M.orange, 0.03, 0.045, 0.2);
    // grip
    const grip = profile(P([[0.05, -0.03], [0.1, -0.03], [0.13, -0.13], [0.07, -0.135]]), 0.042, M.dark, 0.006);
    grip.position.z = 0;
    // energy cell on the side
    box(0.012, 0.028, 0.09, M.glow, 0.034, 0.02, 0.0);
    // picatinny rail
    box(0.026, 0.01, 0.2, M.mid, 0, 0.085, -0.05);
    for (let i = 0; i < 9; i++) box(0.03, 0.006, 0.01, M.dark, 0, 0.092, 0.04 - i * 0.022);
    // compact holographic scope; its axis (y = 0.127) lines up with the camera when aiming
    const SY = 0.127;
    for (const z of [-0.012, -0.075]) {
      box(0.022, 0.012, 0.014, M.dark, 0, 0.093, z);
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.004, 6, 20), M.dark);
      clamp.position.set(0, SY, z);
      g.add(clamp);
    }
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.078, 28, 1, true).rotateX(Math.PI / 2), M.scope);
    tube.material = M.scope.clone();
    tube.material.side = THREE.DoubleSide;
    tube.position.set(0, SY, -0.044);
    g.add(tube);
    for (const z of [-0.004, -0.083]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0045, 6, 28), M.scope);
      lip.position.set(0, SY, z);
      g.add(lip);
    }
    const knob = cyl(0.008, 0.008, 0.012, M.mid, 0, SY + 0.036, -0.044);
    knob.rotation.x = 0;
    const sideKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 12).rotateZ(Math.PI / 2), M.mid);
    sideKnob.position.set(0.036, SY, -0.044);
    g.add(sideKnob);
    // --- lens: coated glass with a little dust, smudges and fine scratches
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 28), M.lens);
    lens.position.set(0, SY, -0.08);
    g.add(lens);
    const dirtMat = new THREE.MeshBasicMaterial({ map: lensDirtTexture(), color: '#bfe8f0', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.03, 28), dirtMat);
    dirt.position.set(0, SY, -0.0798);
    g.add(dirt);
    // faint coloured coating reflection at the rim of the glass
    const coat = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.03, 32), new THREE.MeshBasicMaterial({ color: '#7a3cff', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
    coat.position.set(0, SY, -0.0799);
    g.add(coat);
    // reticle: circle, centre dot, ranging ticks and a chevron, with a soft glow
    const ret = new THREE.Mesh(new THREE.RingGeometry(0.0058, 0.0066, 32), M.reticle);
    ret.position.set(0, SY, -0.0795);
    g.add(ret);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 12), M.reticle);
    dot.position.set(0, SY, -0.0794);
    g.add(dot);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]]) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(dx ? 0.004 : 0.0007, dy ? 0.004 : 0.0007), M.reticle);
      tick.position.set(dx * 0.0098, SY + dy * 0.0098, -0.0794);
      g.add(tick);
    }
    // bullet-drop marks below the centre
    for (let k = 1; k <= 3; k++) {
      const w = 0.0024 - k * 0.0004;
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.0005), M.reticle);
      mark.position.set(0, SY - 0.0075 - k * 0.0022, -0.0794);
      g.add(mark);
    }
    const glowTex = reticleGlowTexture();
    const retGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.024), new THREE.MeshBasicMaterial({ map: glowTex, color: '#5af0ff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    retGlow.position.set(0, SY, -0.0796);
    g.add(retGlow);
    // rubber eye piece at the back
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.0352, 0.0042, 8, 28), M.rubber);
    eye.position.set(0, SY, -0.006);
    g.add(eye);
    // sunshade at the front, a bit wider than the tube
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.033, 0.022, 28, 1, true).rotateX(Math.PI / 2), tube.material);
    shade.position.set(0, SY, -0.094);
    g.add(shade);
    const shadeLip = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.003, 6, 28), M.scope);
    shadeLip.position.set(0, SY, -0.105);
    g.add(shadeLip);
    // flip-up lens cap: hinged on top of the front sunshade, standing open
    const hingeY = SY + 0.038, hingeZ = -0.104;
    box(0.014, 0.006, 0.01, M.dark, 0, hingeY - 0.002, hingeZ); // hinge block on the shade
    const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.018, 8).rotateZ(Math.PI / 2), M.mid);
    hingePin.position.set(0, hingeY + 0.002, hingeZ);
    g.add(hingePin);
    const capPivot = new THREE.Group();
    capPivot.position.set(0, hingeY + 0.002, hingeZ);
    capPivot.rotation.x = -0.45; // tipped forward, away from the shooter
    g.add(capPivot);
    const capArm = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.004), M.rubber);
    capArm.position.set(0, 0.006, 0);
    capPivot.add(capArm);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 24).rotateX(Math.PI / 2), M.rubber);
    cap.position.set(0, 0.012 + 0.036, 0);
    capPivot.add(cap);
    // turrets: elevation on top, windage on the side, each knurled with an index line
    for (const [px, py, rot] of [[0, SY + 0.037, 0], [0.037, SY, Math.PI / 2]]) {
      const tur = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 20).rotateZ(rot ? -Math.PI / 2 : 0), M.dark);
      tur.position.set(px, py, -0.03);
      g.add(tur);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.012, 0.0022), M.mid);
        if (rot) rib.position.set(px, py + Math.cos(a) * 0.011, -0.03 + Math.sin(a) * 0.011), rib.rotation.z = Math.PI / 2;
        else rib.position.set(px + Math.cos(a) * 0.011, py, -0.03 + Math.sin(a) * 0.011);
        g.add(rib);
      }
      const line = new THREE.Mesh(new THREE.BoxGeometry(rot ? 0.001 : 0.0018, rot ? 0.0018 : 0.001, 0.008), M.glowText);
      line.position.set(px + (rot ? 0.0062 : 0), py + (rot ? 0 : 0.0062), -0.03);
      g.add(line);
    }
    // battery compartment and brightness buttons on the left
    const batt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 16).rotateX(Math.PI / 2), M.dark);
    batt.position.set(-0.037, SY + 0.012, -0.045);
    g.add(batt);
    box(0.004, 0.008, 0.008, M.glow, -0.0345, SY - 0.012, -0.03);
    box(0.004, 0.008, 0.008, M.mid, -0.0345, SY - 0.012, -0.044);
    // engraved label on the right side of the tube
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.0085), new THREE.MeshStandardMaterial({ map: scopeLabelTexture(), transparent: true, roughness: 0.6, metalness: 0.4 }));
    label.rotation.y = Math.PI / 2;
    label.position.set(0.0315, SY - 0.014, -0.045);
    label.rotation.x = 0;
    g.add(label);
    // ammo counter on the left side of the receiver
    const ac = document.createElement('canvas');
    ac.width = 128; ac.height = 64;
    this.ammoCanvas = ac;
    digitAtlas();
    this.ammoTex = new THREE.CanvasTexture(ac);
    this.ammoTex.colorSpace = THREE.SRGBColorSpace;
    box(0.004, 0.034, 0.062, M.dark, -0.031, 0.028, 0.085);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.054, 0.027), new THREE.MeshBasicMaterial({ map: this.ammoTex, toneMapped: false }));
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-0.0335, 0.028, 0.085);
    g.add(screen);
    this.shownAmmo = -1;
    // glowing energy cable from the power cell to the handguard
    const cablePts = [[-0.03, -0.005, 0.03], [-0.045, -0.03, -0.03], [-0.046, -0.02, -0.12], [-0.036, 0.0, -0.2]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 24, 0.0045, 6), M.cable);
    g.add(cable);
    for (const z of [0.03, -0.2]) box(0.014, 0.018, 0.018, M.mid, -0.034, z === 0.03 ? -0.005 : 0.0, z);
    // energy cell on the left side as well
    box(0.012, 0.028, 0.07, M.glow, -0.034, -0.008, 0.02);
    // magazine (animated on reload)
    this.mag = new THREE.Group();
    this.mag.position.set(0, -0.035, -0.11);
    g.add(this.mag);
    profile(P([[-0.03, 0.0], [0.03, 0.0], [0.04, -0.12], [-0.02, -0.125]]), 0.038, M.orange, 0.005, 0, this.mag);
    box(0.04, 0.012, 0.064, M.dark, 0, -0.123, 0.01, this.mag);
    this.magHome = this.mag.position.clone();

    // gloved hands and sleeves
    const rh = box(0.062, 0.055, 0.085, M.glove, 0.004, -0.085, 0.085);
    rh.rotation.x = 0.35;
    const lh = box(0.08, 0.05, 0.1, M.glove, -0.012, -0.045, -0.3);
    lh.rotation.z = 0.2;
    const sleeveR = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.055, 0.5, 12), M.sleeve);
    sleeveR.position.set(0.07, -0.21, 0.31);
    sleeveR.rotation.set(1.05, 0, -0.4);
    g.add(sleeveR);
    const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 12), M.sleeve);
    sleeveL.position.set(-0.15, -0.21, -0.1);
    sleeveL.rotation.set(1.15, 0, 0.85);
    g.add(sleeveL);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -0.58);
    g.add(this.muzzle);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    this.flash.position.copy(this.muzzle.position);
    g.add(this.flash);
    this.flash2 = this.flash.clone();
    this.flash2.rotation.y = Math.PI / 2;
    this.flash2.scale.set(1, 1, 1);
    this.flash2.position.z -= 0.04;
    g.add(this.flash2);

    // collapse the ~50 static parts into one mesh per material (far fewer draw calls)
    mergeStatic(g, [this.mag, this.flash, this.flash2, screen]);
    g.scale.setScalar(0.9);
    this.models = {
      rifle: { g, mag: this.mag, magHome: this.magHome, muzzle: this.muzzle, flash: this.flash, flash2: this.flash2, ads: ADS, screen: true },
    };
    // the other classes' weapons
    const helpers = { profile, box, cyl, M };
    this.models.shotgun = this.buildShotgun(root, helpers);
    this.models.flamer = this.buildFlamer(root, helpers);
    this.models.railgun = this.buildRailgun(root, helpers);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.root = root;
    this.gun = g;
    this.M = M;
    root.position.copy(HIP);
    root.visible = false;
    this.game.r.camera.add(root);

    this.sway = new THREE.Vector2();
    this.swayRot = new THREE.Vector2();
    this.recoilZ = 0;
    this.recoilRot = 0;
    this.recoilV = 0;
  }

  // ------------------------------------------------------------ other weapons
  makeFlash(g, at) {
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    flash.position.copy(at);
    g.add(flash);
    const flash2 = flash.clone();
    flash2.rotation.y = Math.PI / 2;
    flash2.position.z -= 0.04;
    g.add(flash2);
    return [flash, flash2];
  }

  hands(g, { box }, M, right, left, leftParent = g) {
    const rh = box(0.062, 0.055, 0.085, M.glove, right[0], right[1], right[2], g);
    rh.rotation.x = 0.35;
    const lh = box(0.08, 0.05, 0.1, M.glove, left[0], left[1], left[2], leftParent);
    lh.rotation.z = 0.2;
    const sleeveR = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.055, 0.5, 12), M.sleeve);
    sleeveR.position.set(right[0] + 0.066, right[1] - 0.125, right[2] + 0.225);
    sleeveR.rotation.set(1.05, 0, -0.4);
    g.add(sleeveR);
    const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 12), M.sleeve);
    sleeveL.position.set(left[0] - 0.14, left[1] - 0.165, left[2] + 0.2);
    sleeveL.rotation.set(1.15, 0, 0.85);
    leftParent.add(sleeveL);
  }

  // Scattergun: pump-action, short and heavy, orange pump grip
  buildShotgun(root, H) {
    const { profile, box, cyl, M } = H;
    const g = new THREE.Group();
    root.add(g);
    profile([[0.12, -0.03], [0.12, 0.055], [-0.02, 0.065], [-0.15, 0.06], [-0.17, 0.01], [-0.15, -0.045], [0.02, -0.045]], 0.064, M.body, 0.007, 0, g);
    profile([[0.11, 0.045], [0.33, 0.03], [0.34, -0.075], [0.28, -0.08], [0.12, -0.02]], 0.052, M.dark, 0.008, 0, g); // stock
    box(0.064, 0.09, 0.022, M.rubber, 0, -0.02, 0.335, g); // butt pad
    profile([[0.05, -0.03], [0.1, -0.03], [0.13, -0.13], [0.07, -0.135]], 0.042, M.dark, 0.006, 0, g); // grip
    cyl(0.019, 0.019, 0.44, M.mid, 0, 0.038, -0.36, g); // barrel
    cyl(0.026, 0.024, 0.05, M.dark, 0, 0.038, -0.6, g, 10); // choke
    cyl(0.016, 0.016, 0.36, M.dark, 0, -0.008, -0.33, g); // magazine tube
    // vented heat shield over the barrel
    profile([[-0.18, 0.058], [-0.52, 0.058], [-0.53, 0.046], [-0.18, 0.046]], 0.046, M.panel, 0.004, 0, g);
    for (let i = 0; i < 6; i++) box(0.048, 0.004, 0.018, M.glow, 0, 0.06, -0.22 - i * 0.05, g);
    // shell carrier on the side: glowing orange shells
    for (let i = 0; i < 4; i++) cyl(0.009, 0.009, 0.05, M.orange, 0.036, 0.012, 0.0 - i * 0.026, g, 8);
    box(0.006, 0.012, 0.11, M.dark, 0.032, -0.004, -0.04, g);
    // sights: rear notch and a bright front bead
    box(0.03, 0.014, 0.012, M.dark, 0, 0.072, -0.03, g);
    box(0.006, 0.014, 0.006, M.dot, 0, 0.068, -0.56, g);
    // pump (slides back and forth when racked)
    const pump = new THREE.Group();
    g.add(pump);
    profile([[-0.17, 0.006], [-0.33, 0.006], [-0.335, -0.03], [-0.32, -0.042], [-0.18, -0.042], [-0.165, -0.03]], 0.072, M.orange, 0.01, 0, pump);
    for (let i = 0; i < 5; i++) box(0.076, 0.006, 0.008, M.dark, 0, -0.018, -0.19 - i * 0.03, pump);
    this.hands(g, H, M, [0.004, -0.085, 0.085], [-0.012, -0.05, -0.26], pump);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.038, -0.63);
    g.add(muzzle);
    const [flash, flash2] = this.makeFlash(g, muzzle.position);
    flash.scale.setScalar(1.6);
    mergeStatic(g, [pump, flash, flash2]);
    mergeStatic(pump);
    g.scale.setScalar(0.9);
    g.visible = false;
    return { g, pump, muzzle, flash, flash2, ads: new THREE.Vector3(0.07, -0.135, -0.26) }; // no scope: pulled in tight, sights under the crosshair
  }

  // Flamethrower: fuel canister under the gun, wide nozzle with a blue pilot flame
  buildFlamer(root, H) {
    const { profile, box, cyl, M } = H;
    const g = new THREE.Group();
    root.add(g);
    profile([[0.1, -0.03], [0.1, 0.05], [-0.06, 0.06], [-0.22, 0.05], [-0.24, 0.0], [-0.22, -0.035], [0.0, -0.04]], 0.07, M.body, 0.008, 0, g);
    profile([[0.1, 0.04], [0.28, 0.035], [0.28, -0.06], [0.22, -0.065], [0.1, -0.02]], 0.05, M.dark, 0.008, 0, g); // stock
    profile([[0.05, -0.03], [0.1, -0.03], [0.13, -0.13], [0.07, -0.135]], 0.042, M.dark, 0.006, 0, g); // grip
    // fuel canister (orange) with caps and a pressure gauge
    cyl(0.045, 0.045, 0.24, M.orange, 0, -0.09, -0.08, g, 20);
    for (const z of [0.04, -0.2]) cyl(0.048, 0.048, 0.016, M.dark, 0, -0.09, z, g, 20);
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 16).rotateZ(Math.PI / 2), M.mid);
    gauge.position.set(0.05, -0.08, -0.06);
    g.add(gauge);
    box(0.002, 0.02, 0.003, M.dot, 0.056, -0.076, -0.06, g);
    // feed hose
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.02, -0.06, -0.19], [0.05, -0.04, -0.25], [0.03, 0.0, -0.3]].map((v) => new THREE.Vector3(...v))), 12, 0.009, 6), M.cable);
    g.add(hose);
    // barrel + nozzle with heat rings
    cyl(0.022, 0.022, 0.18, M.mid, 0, 0.015, -0.32, g);
    cyl(0.03, 0.036, 0.07, M.dark, 0, 0.015, -0.44, g, 18);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.005, 6, 18), M.orange);
      ring.position.set(0, 0.015, -0.27 - i * 0.035);
      g.add(ring);
    }
    // igniter under the nozzle
    cyl(0.007, 0.007, 0.08, M.mid, 0, -0.02, -0.42, g, 8);
    box(0.024, 0.04, 0.03, M.dark, 0, 0.0, -0.37, g);
    // front handle
    const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.11, 10), M.rubber);
    fh.position.set(0, -0.06, -0.28);
    g.add(fh);
    for (const x of [-1, 1]) box(0.006, 0.026, 0.07, M.glow, x * 0.037, 0.02, -0.1, g);
    this.hands(g, H, M, [0.004, -0.085, 0.085], [-0.004, -0.09, -0.28]);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.015, -0.49);
    g.add(muzzle);
    // pilot light: a small blue flame that flickers at the nozzle
    const pilot = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5ab0ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pilot.position.set(0, -0.02, -0.475);
    g.add(pilot);
    const [flash, flash2] = this.makeFlash(g, muzzle.position);
    flash.material.color.set('#ff9a3d');
    mergeStatic(g, [pilot, flash, flash2]);
    g.scale.setScalar(0.9);
    g.visible = false;
    return { g, pilot, muzzle, flash, flash2, ads: new THREE.Vector3(0.08, -0.15, -0.27) };
  }

  // Rail cannon: long twin rails with glowing coils and a compact scope
  buildRailgun(root, H) {
    const { profile, box, cyl, M } = H;
    const g = new THREE.Group();
    root.add(g);
    const SY = 0.118;
    profile([[0.14, -0.03], [0.14, 0.06], [-0.04, 0.07], [-0.2, 0.06], [-0.22, 0.0], [-0.2, -0.04], [0.02, -0.045]], 0.07, M.body, 0.008, 0, g);
    profile([[0.13, 0.05], [0.33, 0.04], [0.34, -0.07], [0.27, -0.07], [0.14, -0.02]], 0.05, M.panel, 0.008, 0, g); // stock
    box(0.06, 0.085, 0.022, M.rubber, 0, -0.012, 0.335, g);
    profile([[0.05, -0.03], [0.1, -0.03], [0.13, -0.13], [0.07, -0.135]], 0.042, M.dark, 0.006, 0, g); // grip
    // capacitor bank under the body
    for (let i = 0; i < 3; i++) cyl(0.016, 0.016, 0.12, M.dark, -0.02 + i * 0.02, -0.06, -0.08, g, 10);
    box(0.07, 0.03, 0.15, M.dark, 0, -0.05, -0.08, g);
    // twin rails with glowing coils between them
    for (const x of [-1, 1]) {
      box(0.012, 0.034, 0.4, M.mid, x * 0.024, 0.018, -0.42, g);
      box(0.004, 0.02, 0.38, M.glow, x * 0.017, 0.018, -0.42, g);
    }
    for (let i = 0; i < 6; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 6, 16), i % 2 ? M.glow : M.dark);
      coil.position.set(0, 0.018, -0.26 - i * 0.055);
      g.add(coil);
    }
    box(0.07, 0.012, 0.42, M.panel, 0, 0.05, -0.42, g); // top strap
    box(0.07, 0.012, 0.42, M.dark, 0, -0.016, -0.42, g); // bottom strap
    // energy cells on both sides
    for (const x of [-1, 1]) box(0.01, 0.03, 0.12, M.glow, x * 0.036, 0.022, 0.02, g);
    // scope
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 20, 1, true).rotateX(Math.PI / 2), M.scope.clone());
    tube.material.side = THREE.DoubleSide;
    tube.position.set(0, SY, -0.06);
    g.add(tube);
    for (const z of [0.02, -0.14]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 22), M.scope);
      lip.position.set(0, SY, z);
      g.add(lip);
    }
    for (const z of [-0.02, -0.1]) box(0.018, 0.03, 0.014, M.dark, 0, SY - 0.042, z, g);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), M.lens);
    lens.position.set(0, SY, -0.139);
    g.add(lens);
    const ret = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.0089, 32), M.reticle);
    ret.position.set(0, SY, -0.138);
    g.add(ret);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(dx ? 0.009 : 0.0008, dy ? 0.009 : 0.0008), M.reticle);
      tick.position.set(dx * 0.0145, SY + dy * 0.0145, -0.138);
      g.add(tick);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0013, 10), M.dot);
    dot.position.set(0, SY, -0.1375);
    g.add(dot);
    this.hands(g, H, M, [0.004, -0.085, 0.085], [-0.012, -0.03, -0.3]);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.018, -0.63);
    g.add(muzzle);
    const [flash, flash2] = this.makeFlash(g, muzzle.position);
    flash.material.color.set('#7ad8ff');
    flash.scale.setScalar(1.4);
    mergeStatic(g, [flash, flash2]);
    g.scale.setScalar(0.9);
    g.visible = false;
    return { g, muzzle, flash, flash2, ads: new THREE.Vector3(0, -SY * 0.9, -0.2) };
  }

  // choose the weapon of the player's class
  setKind(kind) {
    if (!this.models[kind]) kind = 'rifle';
    this.kind = kind;
    this.def = WEAPONS[kind];
    for (const [k, m] of Object.entries(this.models)) m.g.visible = k === kind;
    const m = this.models[kind];
    this.cur = m;
    this.gun = m.g;
    this.mag = m.mag || null;
    this.magHome = m.magHome || null;
    this.muzzle = m.muzzle;
    this.flash = m.flash;
    this.flash2 = m.flash2;
    this.adsPos = m.ads;
    this.pendingHits = new Map();
    this.pendingT = 0;
    this.reset();
  }

  reset() {
    if (!this.kind) { this.kind = 'rifle'; this.def = WEAPONS.rifle; this.adsPos = ADS; this.cur = this.models.rifle; }
    this.ammo = this.stats.mag;
    this.reloading = 0;
    this.reloadTotal = 1;
    this.cooldown = 0;
    this.lower = 1;
    this.spread = 0;
    this.shotsFired = 0;
  }

  get stats() {
    const m = this.game.mods;
    const d = this.def || WEAPONS.rifle;
    return {
      damage: d.damage * m.weaponDmg,
      rate: d.rate * m.fireRate,
      mag: Math.round(d.mag * m.magMult),
      reload: d.reload * m.reloadMult,
      crit: m.critMult,
    };
  }

  startReload() {
    if (this.reloading > 0 || this.ammo >= this.stats.mag) return;
    this.reloading = this.stats.reload;
    this.reloadTotal = this.reloading;
    this.game.audio.reload(this.reloading);
  }

  drawAmmo() {
    const g = this.ammoCanvas.getContext('2d');
    const mag = this.stats.mag;
    const low = this.ammo <= mag * 0.25;
    g.fillStyle = '#031014';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = low ? '#ff5a4a' : '#5af0ff';
    // digits come from a pre-drawn atlas: drawing text every shot made the browser
    // recalculate page styles (to resolve the font) in the middle of a frame
    const atlas = digitAtlas();
    const txt = this.reloading > 0 ? '--' : String(Math.min(99, this.ammo)).padStart(2, '0');
    for (let i = 0; i < 2; i++) {
      const k = txt[i] === '-' ? 10 : +txt[i];
      g.drawImage(atlas, k * 32, low ? 48 : 0, 32, 48, 32 + i * 32, 4, 32, 48);
    }
    // bar of remaining rounds
    g.fillRect(8, 54, 112 * Math.max(0, this.ammo / mag), 5);
    g.globalAlpha = 0.25;
    g.fillRect(8, 54, 112, 5);
    g.globalAlpha = 1;
    this.ammoTex.needsUpdate = true;
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    const key = this.reloading > 0 ? -2 : this.ammo;
    if (key !== this.shownAmmo) { this.shownAmmo = key; this.drawAmmo(); }
    const building = game.build.mode !== null;
    this.cooldown -= dt;
    this.root.visible = game.running;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = this.stats.mag;
      }
    }

    const auto = this.def ? this.def.auto : true;
    if (p.mouse.left && !building && !p.dead && this.cooldown <= 0 && this.reloading <= 0 && (auto || !this.held)) {
      if (this.ammo > 0) this.fire();
      else { this.startReload(); }
      this.held = true;
    }
    if (!p.mouse.left) { this.shotsFired = 0; this.held = false; }
    this.flushHits(dt);

    // --- animation
    const lowerTarget = building || p.dead ? 1 : p.sprinting ? 0.35 : 0;
    this.lower += (lowerTarget - this.lower) * Math.min(1, dt * 9);
    const ads = p.adsT;

    // recoil spring
    this.recoilV += (-this.recoilZ * 220 - this.recoilV * 22) * dt;
    this.recoilZ += this.recoilV * dt;
    this.recoilRot += (0 - this.recoilRot) * Math.min(1, dt * 14);

    // sway lags behind mouse movement
    const swayK = 1 - ads * 0.8;
    this.sway.x += (-p.look.dx * 0.00025 * swayK - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (p.look.dy * 0.00025 * swayK - this.sway.y) * Math.min(1, dt * 10);
    this.sway.x = THREE.MathUtils.clamp(this.sway.x, -0.04, 0.04);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y, -0.04, 0.04);
    p.look.dx = 0;
    p.look.dy = 0;

    const bobK = Math.min(1, p.speedNow / 7) * (p.onGround ? 1 : 0) * (1 - ads * 0.85);
    const bx = Math.cos(p.bobT) * 0.012 * bobK;
    const by = -Math.abs(Math.sin(p.bobT)) * 0.012 * bobK;
    const breathe = Math.sin(game.time * 1.6) * 0.002 * (1 - ads);

    const reloadK = this.reloading > 0 ? 1 - this.reloading / this.reloadTotal : 0;
    const reloadTilt = this.reloading > 0 ? Math.sin(reloadK * Math.PI) : 0;

    const pos = _n.copy(HIP).lerp(this.adsPos || ADS, ads);
    this.root.position.set(
      pos.x + this.sway.x + bx - this.lower * 0.05 + p.landKick * 0.0,
      pos.y + this.sway.y + by + breathe - this.lower * 0.22 - reloadTilt * 0.04 - p.landKick * 0.04,
      pos.z + this.recoilZ
    );
    this.root.rotation.set(
      this.recoilRot + this.sway.y * 2 + reloadTilt * 0.35 + (p.sprinting ? -0.25 : 0) * this.lower * 2,
      this.sway.x * 3 + (p.sprinting ? 0.6 : 0) * this.lower * 2,
      reloadTilt * 0.55 + this.sway.x * 2
    );

    // pump action / pilot light
    if (this.cur && this.cur.pump) {
      const k = this.pumpT > 0 ? Math.sin(Math.min(1, this.pumpT) * Math.PI) : 0;
      this.cur.pump.position.z = k * 0.07;
      this.pumpT = Math.max(0, (this.pumpT || 0) - dt * 2.4);
    }
    if (this.cur && this.cur.pilot) {
      const s = 0.8 + Math.random() * 0.5;
      this.cur.pilot.scale.set(s, s, 0.8 + Math.random() * 0.8);
    }
    // magazine out / in
    if (!this.mag) {
      // no magazine to animate
    } else if (this.reloading > 0) {
      const out = reloadK < 0.3 ? reloadK / 0.3 : reloadK < 0.6 ? 1 : 1 - (reloadK - 0.6) / 0.3;
      this.mag.position.set(this.magHome.x, this.magHome.y - Math.max(0, out) * 0.2, this.magHome.z + Math.max(0, out) * 0.05);
      this.mag.visible = !(reloadK > 0.28 && reloadK < 0.45);
    } else {
      this.mag.position.copy(this.magHome);
      this.mag.visible = true;
    }

    const fl = this.flash.material;
    fl.opacity = Math.max(0, fl.opacity - dt * 25);
    this.flash2.material = fl;

    // crosshair spread
    const moving = Math.min(1, p.speedNow / 7);
    this.spread = THREE.MathUtils.lerp(this.spread, (0.004 + moving * 0.014 + (p.onGround ? 0 : 0.03)) * (1 - ads * 0.85), Math.min(1, dt * 10));
  }

  fire() {
    if (this.kind === 'shotgun') return this.fireShotgun();
    if (this.kind === 'flamer') return this.fireFlamer();
    if (this.kind === 'railgun') return this.fireRailgun();
    return this.fireRifle();
  }

  // co-op client: damage goes to the host (flamethrower ticks are bundled)
  sendHit(e, dmg, head = false, burn = 0) {
    const net = this.game.net;
    if (!net.isClient || !net.conn) return;
    if (burn) {
      const h = this.pendingHits.get(e.nid) || { d: 0, b: burn };
      h.d += dmg;
      this.pendingHits.set(e.nid, h);
    } else net.conn.send({ t: 'hit', n: e.nid, d: Math.round(dmg * 10) / 10, c: head ? 1 : 0 });
  }

  flushHits(dt) {
    if (!this.pendingHits || !this.pendingHits.size) return;
    this.pendingT -= dt;
    if (this.pendingT > 0) return;
    this.pendingT = 0.15;
    const net = this.game.net;
    for (const [n, h] of this.pendingHits) if (net.conn) net.conn.send({ t: 'hit', n, d: Math.round(h.d * 10) / 10, c: 0, b: h.b });
    this.pendingHits.clear();
  }

  // ray from the camera: closest hit (enemy, building, rock or ground)
  aimRay(spread) {
    const game = this.game;
    const cam = game.r.camera;
    cam.getWorldPosition(_origin);
    cam.getWorldDirection(_dir);
    _dir.x += (Math.random() - 0.5) * spread * 2;
    _dir.y += (Math.random() - 0.5) * spread * 2;
    _dir.z += (Math.random() - 0.5) * spread * 2;
    _dir.normalize();
    this.raycaster.set(_origin, _dir);
    const gd = game.world.rayGround(_origin, _dir, 160);
    this.raycaster.far = Math.min(220, gd);
    const targets = game.enemies.hitMeshes.concat(game.build.solidMeshes, game.world.raycastables, game.core.hitMeshes);
    const hits = this.raycaster.intersectObjects(targets, false);
    this.raycaster.far = 220;
    return { hits, gd };
  }

  kick(amount, side = 0.004) {
    const p = this.game.player;
    const ads = p.adsT;
    p.pitch = Math.min(1.5, p.pitch + amount * (1 - ads * 0.45));
    p.yaw += (Math.random() - 0.45) * side * (1 - ads * 0.5);
  }

  hitEnemy(e, point, dmg, head) {
    const game = this.game;
    game.enemies.damage(e, dmg, { crit: head, from: game.player.pos });
    this.sendHit(e, dmg, head);
    game.fx.burst(point, e.def.colors.blood, head ? 10 : 6, 4, 0.08);
    game.hud.hitmarker(head, e.dead);
    game.audio.hit(head);
    game.audio.flesh(point);
    if (e.dead) game.audio.kill();
  }

  fireShotgun() {
    const game = this.game;
    const st = this.stats;
    const p = game.player;
    this.ammo--;
    this.cooldown = 1 / st.rate;
    this.pumpT = 1;
    this.kick(0.05, 0.02);
    this.recoilV -= 3.2;
    this.recoilRot += 0.16;
    const spread = this.def.spread * (1 - p.adsT * 0.35) + this.spread;
    const per = new Map();
    this.muzzle.getWorldPosition(_muzzle);
    let center = null;
    for (let k = 0; k < this.def.pellets; k++) {
      const { hits, gd } = this.aimRay(k === 0 ? this.spread : spread);
      let hit = hits[0];
      if (!hit && isFinite(gd)) hit = { point: _origin.clone().addScaledVector(_dir, gd), object: game.world.terrain };
      const end = hit ? hit.point.clone() : _origin.clone().addScaledVector(_dir, 60);
      if (!center) center = end.clone();
      if (hit && hit.object.userData.enemy) {
        const e = hit.object.userData.enemy;
        const head = !!hit.object.userData.head;
        const dist = hit.distance || end.distanceTo(_origin);
        const fall = Math.max(0.25, 1 - Math.max(0, dist - 10) / this.def.range);
        const r = per.get(e) || { dmg: 0, head: false, point: end };
        r.dmg += st.damage * fall * (head ? 1.5 : 1) * (0.9 + Math.random() * 0.2);
        r.head = r.head || head;
        per.set(e, r);
      } else if (hit && k % 2 === 0) {
        game.fx.burst(end, hit.object.userData.structure ? '#ffd27a' : '#c9b8a0', 2, 3, 0.04);
      }
      if (k < 4) game.fx.tracer(_muzzle, end, '#ffe0a0', 0.012, 0.04);
    }
    for (const [e, r] of per) this.hitEnemy(e, r.point, r.dmg, r.head);
    game.net.shot(_origin, center, 'shotgun');
    game.fx.flash(_muzzle, '#ffb15a', 7, 0.06);
    this.flash.material.opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
    game.audio.shotgun();
  }

  fireFlamer() {
    const game = this.game;
    const st = this.stats;
    const p = game.player;
    this.ammo--;
    this.cooldown = 1 / st.rate;
    const cam = game.r.camera;
    cam.getWorldPosition(_origin);
    cam.getWorldDirection(_dir);
    this.muzzle.getWorldPosition(_muzzle);
    const range = this.def.range;
    const cosCone = Math.cos(this.def.cone);
    const dmg = st.damage / st.rate;
    const gd = game.world.rayGround(_origin, _dir, range + 2);
    for (const e of game.enemies.list) {
      if (e.dead || e.hidden) continue;
      _p.set(e.pos.x, e.pos.y + e.barH * 0.45, e.pos.z).sub(_origin);
      const d = _p.length();
      if (d > range + e.def.radius || d < 0.01) continue;
      if (_p.dot(_dir) / d < cosCone - e.def.radius / Math.max(d, 1) * 0.3) continue;
      if (d > gd + 1) continue; // behind a wall
      game.enemies.damage(e, dmg, { showNumber: Math.random() < 0.25, from: p.pos });
      if (!game.net.isClient) { e.burn = Math.max(e.burn, 2); e.burnDps = Math.max(e.burnDps || 0, this.def.burn); }
      this.sendHit(e, dmg, false, this.def.burn);
      if (Math.random() < 0.15) game.hud.hitmarker(false, e.dead);
    }
    game.fx.flameStream(_muzzle, _dir.x, _dir.y, _dir.z, Math.min(range, gd), 3);
    if (Math.random() < 0.3) game.fx.flash(_muzzle, '#ff8a3d', 5, 0.05);
    this.recoilV -= 0.15;
    this.shotsFired++;
    if (this.shotsFired % 3 === 0) game.net.shot(_origin, _end.copy(_origin).addScaledVector(_dir, range), 'flamer');
    game.audio.flamerFire();
  }

  fireRailgun() {
    const game = this.game;
    const st = this.stats;
    const p = game.player;
    this.ammo--;
    this.cooldown = 1 / st.rate;
    this.kick(0.07, 0.01);
    this.recoilV -= 4;
    this.recoilRot += 0.2;
    const { hits, gd } = this.aimRay(this.spread * 0.3);
    // pierces every alien on the line, stops at the first building, rock or the ground
    const done = new Set();
    let stop = isFinite(gd) ? gd : 160;
    for (const h of hits) {
      const e = h.object.userData.enemy;
      if (!e) { stop = Math.min(stop, h.distance); break; }
      if (done.has(e)) continue;
      done.add(e);
      const head = !!h.object.userData.head;
      this.hitEnemy(e, h.point, st.damage * (head ? st.crit : 1) * (1 - done.size * 0.06), head);
    }
    _end.copy(_origin).addScaledVector(_dir, stop);
    this.muzzle.getWorldPosition(_muzzle);
    game.fx.tracer(_muzzle, _end, '#7ad8ff', 0.09, 0.28);
    game.fx.tracer(_muzzle, _end, '#ffffff', 0.025, 0.18);
    game.fx.flash(_muzzle, '#7ad8ff', 9, 0.1);
    game.fx.burst(_end, '#7ad8ff', 8, 4, 0.07);
    game.net.shot(_origin, _end, 'railgun');
    this.flash.material.opacity = 1;
    game.audio.railgun();
    game.shake(0.15);
  }

  // what a teammate's shot looks like
  remoteEffect(w, from, to) {
    const game = this.game;
    if (w === 'flamer') {
      _q.subVectors(to, from).normalize();
      for (let i = 0; i < 3; i++) game.fx.flameStream(from, _q.x, _q.y, _q.z, this.models && WEAPONS.flamer.range, 3);
    } else if (w === 'railgun') {
      game.fx.tracer(from, to, '#7ad8ff', 0.09, 0.28);
      game.fx.muzzle(from, '#7ad8ff', 0.7);
    } else if (w === 'shotgun') {
      for (let i = 0; i < 4; i++) {
        _q.set(to.x + (Math.random() - 0.5) * 1.5, to.y + (Math.random() - 0.5) * 1.5, to.z + (Math.random() - 0.5) * 1.5);
        game.fx.tracer(from, _q, '#ffe0a0', 0.015, 0.05);
      }
      game.fx.muzzle(from, '#ffd27a', 0.8);
    } else {
      game.fx.tracer(from, to, '#fff0b0', 0.03, 0.06);
      game.fx.muzzle(from, '#ffd27a', 0.5);
    }
    game.audio.remoteShot(from, w);
  }

  fireRifle() {
    const game = this.game;
    const st = this.stats;
    const p = game.player;
    this.ammo--;
    this.cooldown = 1 / st.rate;
    this.shotsFired++;
    // recoil: kick up with a small random sideways pull
    const ads = p.adsT;
    const kick = (0.009 + Math.min(this.shotsFired, 10) * 0.0007) * (1 - ads * 0.45);
    p.pitch = Math.min(1.5, p.pitch + kick);
    p.yaw += (Math.random() - 0.45) * 0.004 * (1 - ads * 0.5);
    this.recoilV -= 1.6;
    this.recoilRot += 0.07 * (1 - ads * 0.5);

    const cam = game.r.camera;
    cam.getWorldPosition(_origin);
    cam.getWorldDirection(_dir);
    const sp = this.spread + Math.min(this.shotsFired, 12) * 0.0007 * (1 - ads);
    _dir.x += (Math.random() - 0.5) * sp * 2;
    _dir.y += (Math.random() - 0.5) * sp * 2;
    _dir.z += (Math.random() - 0.5) * sp * 2;
    _dir.normalize();

    this.raycaster.set(_origin, _dir);
    // the ground (hills, cliffs) stops bullets; found by marching the height map
    const gd = game.world.rayGround(_origin, _dir, 160);
    this.raycaster.far = Math.min(220, gd);
    const targets = game.enemies.hitMeshes.concat(game.build.solidMeshes, game.world.raycastables, game.core.hitMeshes);
    const hits = this.raycaster.intersectObjects(targets, false);
    this.raycaster.far = 220;
    let hit = hits[0];
    if (!hit && isFinite(gd)) hit = { point: _origin.clone().addScaledVector(_dir, gd), object: game.world.terrain };
    if (hit) _end.copy(hit.point);
    else _end.copy(_origin).addScaledVector(_dir, 160);

    if (hit && hit.object.userData.enemy) {
      const e = hit.object.userData.enemy;
      const head = !!hit.object.userData.head;
      const dmg = st.damage * (head ? st.crit : 1) * (0.92 + Math.random() * 0.16);
      game.enemies.damage(e, dmg, { crit: head, from: p.pos });
      this.sendHit(e, dmg, head);
      game.fx.burst(hit.point, e.def.colors.blood, head ? 10 : 6, 4, 0.08);
      game.hud.hitmarker(head, e.dead);
      game.audio.hit(head);
      game.audio.flesh(hit.point);
      if (e.dead) game.audio.kill();
    } else if (hit) {
      game.fx.burst(hit.point, hit.object.userData.structure ? '#ffd27a' : '#c9b8a0', 4, 3, 0.05);
      if (!hit.object.userData.structure) game.fx.smoke(hit.point, 1);
    }

    this.muzzle.getWorldPosition(_muzzle);
    game.net.shot(_origin, _end, 'rifle');
    game.fx.tracer(_muzzle, _end, '#fff0b0', 0.02, 0.05);
    game.fx.flash(_muzzle, '#ffb15a', 4, 0.05);
    this.flash.material.opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    game.audio.shot();
  }
}
