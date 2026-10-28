import * as THREE from 'three';
import { mergeStatic } from '../core/geomerge.js';
import { wornMetal } from '../core/materials.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _n = new THREE.Vector3();

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
    root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.root = root;
    this.gun = g;
    this.M = M;
    g.scale.setScalar(0.9);
    root.position.copy(HIP);
    root.visible = false;
    this.game.r.camera.add(root);

    this.sway = new THREE.Vector2();
    this.swayRot = new THREE.Vector2();
    this.recoilZ = 0;
    this.recoilRot = 0;
    this.recoilV = 0;
  }

  reset() {
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
    return {
      damage: 22 * m.weaponDmg,
      rate: 9 * m.fireRate,
      mag: 30 + m.magBonus,
      reload: 1.7 * m.reloadMult,
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

    if (p.mouse.left && !building && !p.dead && this.cooldown <= 0 && this.reloading <= 0) {
      if (this.ammo > 0) this.fire();
      else { this.startReload(); }
    }
    if (!p.mouse.left) this.shotsFired = 0;

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

    const pos = _n.copy(HIP).lerp(ADS, ads);
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

    // magazine out / in
    if (this.reloading > 0) {
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
      if (game.net.isClient) game.net.conn && game.net.conn.send({ t: 'hit', n: e.nid, d: Math.round(dmg * 10) / 10, c: head ? 1 : 0 });
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
    game.net.shot(_origin, _end);
    game.fx.tracer(_muzzle, _end, '#fff0b0', 0.02, 0.05);
    game.fx.flash(_muzzle, '#ffb15a', 4, 0.05);
    this.flash.material.opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    game.audio.shot();
  }
}
