import * as THREE from 'three';
import { BUILDINGS, BUILD_ORDER, CORE_POWER } from '../data/buildings.js';
import { CELL } from '../world/nav.js';
import { pbr } from '../core/materials.js';
import { cableGeometry, cableEnergyTexture } from '../world/clutter.js';
import { groundAt, elevation } from '../world/elevation.js';

const REACH = 15;
const TRIM = ['#3de0ff', '#ffb43d', '#ff4d6d'];
const _v = new THREE.Vector3();
// buildings turn in 45° steps (R while placing, T on a placed one)
const ROT_STEPS = 8;
const ROT_ANGLE = (Math.PI * 2) / ROT_STEPS;
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

let M = null;
function mats() {
  if (M) return M;
  const stripes = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1d1f24';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffb43d';
    for (let i = -64; i < 128; i += 22) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 11, 0); g.lineTo(i + 11 - 64, 64); g.lineTo(i - 64, 64);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  M = {
    metal: pbr('metal', { color: '#d4dbe6' }),
    plate: pbr('metal', { color: '#9aa3b0' }),
    dark: pbr('gunmetal', { color: '#4a4f58' }),
    hazard: new THREE.MeshStandardMaterial({ map: stripes, metalness: 0.4, roughness: 0.6 }),
    copper: pbr('metal', { color: '#e0904a' }),
    orange: pbr('gunmetal', { color: '#ff8a50' }),
    trims: TRIM.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.3 })),
    tesla: new THREE.MeshStandardMaterial({ color: '#bff6ff', emissive: '#5ad8ff', emissiveIntensity: 3 }),
    pilot: new THREE.MeshStandardMaterial({ color: '#7ab8ff', emissive: '#3d8aff', emissiveIntensity: 3 }),
    pad: new THREE.MeshStandardMaterial({ color: '#2a8cff', emissive: '#2a8cff', emissiveIntensity: 0.8, roughness: 0.2 }),
    shell: new THREE.MeshStandardMaterial({ color: '#30343c', emissive: '#ff6a1d', emissiveIntensity: 0.6 }),
  };
  return M;
}

const SHIELD_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHIELD_FRAG = /* glsl */ `
uniform float time; uniform float strength; uniform float hit; uniform float hurt; uniform vec3 color; uniform vec3 color2;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
void main() {
  vec2 p = vUv * vec2(1.56, 2.35) * 4.2;
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float edge = smoothstep(0.42, 0.5, hexDist(gv));
  vec2 id = p - gv;
  float cell = 0.5 + 0.5 * sin(id.x * 3.1 + id.y * 1.7 + time * 2.0);
  float scan = smoothstep(0.0, 0.04, abs(fract(vUv.y * 1.5 - time * 0.35) - 0.5) - 0.44);
  float border = 1.0 - smoothstep(0.0, 0.05, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float flicker = 0.9 + 0.1 * sin(time * 37.0) * sin(time * 13.0);
  vec3 col = mix(color, color2, hurt);
  float a = (0.16 + edge * 0.8 + cell * 0.1 + (1.0 - scan) * 0.3 + border * 0.7 + fres * 0.3) * strength * flicker;
  a += hit * (0.6 + edge);
  gl_FragColor = vec4(col * a, 1.0);
}`;

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);

function part(parent, geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function turretBase(g, level) {
  const m = mats();
  part(g, cyl(1.0, 1.05, 0.3, 6), m.dark, 0, 0.15, 0);
  part(g, cyl(0.85, 0.95, 0.35, 6), m.hazard, 0, 0.45, 0);
  part(g, new THREE.TorusGeometry(0.88, 0.04, 4, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6), m.trims[level], 0, 0.63, 0, false);
  part(g, cyl(0.45, 0.6, 0.35, 10), m.metal, 0, 0.8, 0);
}

// Builds the 3D model for a building at a given level (0-2)
export function buildModel(type, level) {
  const m = mats();
  const g = new THREE.Group();
  const P = { group: g, solid: [], muzzles: [] };
  const trim = m.trims[level];

  if (type === 'barricade') {
    P.solid.push(part(g, box(2.0, 0.3, 1.9), m.dark, 0, 0.15, 0));
    P.solid.push(part(g, box(1.96, 1.6, 1.25), m.plate, 0, 1.1, 0));
    part(g, box(2.0, 0.18, 1.4), m.dark, 0, 1.98, 0);
    for (const z of [-0.66, 0.66]) {
      for (const x of [-0.82, 0, 0.82]) part(g, box(0.22, 1.7, 0.1), m.metal, x, 1.1, z);
      part(g, box(1.9, 0.08, 0.06), trim, 0, 1.55, z * 1.03, false);
    }
    if (level >= 1) {
      for (const z of [-0.72, 0.72]) {
        const b1 = part(g, box(0.12, 2.1, 0.08), m.dark, 0, 1.0, z);
        b1.rotation.z = 0.75;
        const b2 = part(g, box(0.12, 2.1, 0.08), m.dark, 0, 1.0, z);
        b2.rotation.z = -0.75;
      }
      part(g, box(2.04, 0.35, 1.5), m.hazard, 0, 0.45, 0);
    }
    if (level >= 2) {
      const sg = new THREE.ConeGeometry(0.09, 0.6, 6);
      for (const z of [-1, 1]) for (const x of [-0.6, 0, 0.6]) for (const y of [0.7, 1.4]) {
        const s = part(g, sg, m.metal, x, y, z * 0.85, false);
        s.rotation.x = z * Math.PI / 2;
      }
    }
  } else if (type === 'gatling') {
    turretBase(g, level);
    P.solid.push(g.children[1]);
    const head = new THREE.Group();
    head.position.y = 1.15;
    g.add(head);
    const pitch = new THREE.Group();
    head.add(pitch);
    P.solid.push(part(pitch, box(0.85, 0.55, 0.9), m.metal, 0, 0, 0.05));
    part(pitch, box(0.87, 0.12, 0.6), trim, 0, 0.3, 0.1, false);
    part(pitch, box(0.3, 0.4, 0.55), m.dark, 0.58, -0.05, 0.1);
    if (level >= 1) part(pitch, box(1.0, 0.5, 0.08), m.plate, 0, 0.05, -0.42);
    P.spinners = [];
    const xs = level >= 2 ? [-0.24, 0.24] : [0];
    for (const x of xs) {
      const spin = new THREE.Group();
      spin.position.set(x, 0, -0.45);
      pitch.add(spin);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = part(spin, cyl(0.035, 0.035, 1.0, 6), m.dark, Math.cos(a) * 0.09, Math.sin(a) * 0.09, -0.5, false);
        b.rotation.x = Math.PI / 2;
      }
      part(spin, cyl(0.15, 0.15, 0.08, 12).rotateX(Math.PI / 2), m.metal, 0, 0, -0.9, false);
      part(spin, cyl(0.13, 0.13, 0.08, 12).rotateX(Math.PI / 2), m.metal, 0, 0, -0.35, false);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0, -1.05);
      spin.add(muzzle);
      P.muzzles.push(muzzle);
      P.spinners.push(spin);
    }
    P.head = head;
    P.pitch = pitch;
  } else if (type === 'flamer') {
    turretBase(g, level);
    P.solid.push(g.children[1]);
    const head = new THREE.Group();
    head.position.y = 1.12;
    g.add(head);
    P.solid.push(part(head, box(0.75, 0.55, 0.8), m.metal, 0, 0, 0));
    part(head, box(0.77, 0.1, 0.5), trim, 0, 0.3, 0.05, false);
    const tanks = level >= 1 ? [-0.25, 0.25] : [0];
    for (const x of tanks) part(head, cyl(0.2, 0.2, 0.7, 12).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), m.orange, x, 0.12, 0.55);
    const nozzleLen = level >= 2 ? 1.2 : 0.95;
    part(head, cyl(0.09, 0.16, nozzleLen, 10).rotateX(-Math.PI / 2), m.dark, 0, -0.02, -0.4 - nozzleLen / 2, false);
    if (level >= 2) for (let i = 0; i < 4; i++) part(head, box(0.5, 0.04, 0.04), m.metal, 0, -0.02 + (i - 1.5) * 0.08, -0.6, false);
    const pilot = part(head, new THREE.SphereGeometry(0.06, 8, 6), m.pilot, 0, 0.1, -0.42 - nozzleLen, false);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.02, -0.45 - nozzleLen);
    head.add(muzzle);
    P.muzzles.push(muzzle);
    P.head = head;
    P.pilot = pilot;
  } else if (type === 'tesla') {
    turretBase(g, level);
    P.solid.push(g.children[1]);
    P.solid.push(part(g, cyl(0.28, 0.36, 1.8, 10), m.dark, 0, 1.8, 0));
    const rings = 4 + level * 2;
    for (let i = 0; i < rings; i++) {
      const r = 0.5 - (i / rings) * 0.18;
      part(g, new THREE.TorusGeometry(r, 0.06, 6, 20).rotateX(Math.PI / 2), m.copper, 0, 1.15 + i * (1.3 / rings), 0, false);
    }
    const orbR = 0.32 + level * 0.06;
    const orb = part(g, new THREE.SphereGeometry(orbR, 20, 14), m.tesla, 0, 2.85, 0, false);
    if (level >= 2) for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = part(g, cyl(0.03, 0.05, 0.7, 6), m.copper, Math.cos(a) * 0.4, 2.95, Math.sin(a) * 0.4, false);
      p.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 2.85, 0);
    g.add(muzzle);
    P.muzzles.push(muzzle);
    P.orb = orb;
  } else if (type === 'mortar') {
    turretBase(g, level);
    P.solid.push(g.children[1]);
    const head = new THREE.Group();
    head.position.y = 1.0;
    g.add(head);
    P.solid.push(part(head, box(0.9, 0.4, 0.9), m.metal, 0, 0, 0));
    part(head, box(0.92, 0.08, 0.6), trim, 0, 0.22, 0, false);
    const xs = level >= 2 ? [-0.22, 0.22] : [0];
    for (const x of xs) {
      const tube = new THREE.Group();
      tube.position.set(x, 0.25, 0);
      tube.rotation.x = -0.75;
      head.add(tube);
      part(tube, cyl(0.2 + level * 0.03, 0.26 + level * 0.03, 1.4, 14), m.dark, 0, 0.5, 0);
      part(tube, new THREE.TorusGeometry(0.25 + level * 0.03, 0.04, 6, 16).rotateX(Math.PI / 2), m.metal, 0, 1.18, 0, false);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 1.25, 0);
      tube.add(muzzle);
      P.muzzles.push(muzzle);
    }
    P.head = head;
  } else if (type === 'generator') {
    P.solid.push(part(g, box(1.9, 0.5, 1.9), m.dark, 0, 0.25, 0));
    P.solid.push(part(g, box(1.5, 1.1, 1.5), m.plate, 0, 1.0, 0));
    part(g, box(1.54, 0.08, 1.54), trim, 0, 1.2, 0, false);
    // glowing reactor cylinder in the middle
    const coreMat = m.tesla;
    const rc = part(g, cyl(0.32, 0.32, 1.1 + level * 0.25, 16), coreMat, 0, 1.9 + level * 0.12, 0, false);
    P.reactor = rc;
    // cage bars
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part(g, cyl(0.05, 0.05, 1.3 + level * 0.25, 6), m.metal, Math.cos(a) * 0.5, 1.95 + level * 0.12, Math.sin(a) * 0.5, false);
    }
    const ring = new THREE.Group();
    ring.position.y = 2.0 + level * 0.12;
    g.add(ring);
    for (let i = 0; i < 1 + level; i++) {
      const r = part(ring, new THREE.TorusGeometry(0.62 + i * 0.12, 0.035, 6, 32).rotateX(Math.PI / 2), m.copper, 0, (i - level / 2) * 0.35, 0, false);
      r.userData.k = i;
    }
    P.ring = ring;
    // side vents
    for (const sx of [-1, 1]) part(g, box(0.06, 0.5, 1.0), trim, sx * 0.77, 0.95, 0, false);
  } else if (type === 'shield') {
    // two emitter pylons with a hexagonal energy field between them
    for (const sx of [-0.88, 0.88]) {
      P.solid.push(part(g, box(0.42, 0.35, 0.6), m.dark, sx, 0.175, 0));
      P.solid.push(part(g, box(0.2, 2.5, 0.3), m.metal, sx, 1.5, 0));
      part(g, box(0.05, 2.1, 0.32), trim, sx - Math.sign(sx) * 0.11, 1.5, 0, false);
      part(g, box(0.3, 0.16, 0.4), m.hazard, sx, 2.78, 0);
      if (level >= 1) part(g, cyl(0.07, 0.07, 0.5, 8), m.copper, sx, 3.05, 0, false);
      if (level >= 2) part(g, new THREE.SphereGeometry(0.1, 10, 8), m.tesla, sx, 3.35, 0, false);
    }
    part(g, box(1.6, 0.12, 0.22), m.dark, 0, 0.12, 0);
    const u = {
      time: { value: 0 }, strength: { value: 1 }, hit: { value: 0 },
      color: { value: new THREE.Color('#4ac8ff') }, color2: { value: new THREE.Color('#ff8a3d') }, hurt: { value: 0 },
    };
    const field = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 2.35), new THREE.ShaderMaterial({
      uniforms: u, vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    field.position.y = 1.5;
    field.userData.noAO = true;
    g.add(field);
    P.field = field;
    P.fieldU = u;
  } else if (type === 'trap') {
    part(g, box(1.9, 0.12, 1.9), m.dark, 0, 0.06, 0, false);
    const padMat = m.pad.clone();
    P.padMat = padMat;
    part(g, box(1.5, 0.14, 1.5), padMat, 0, 0.08, 0, false);
    const posts = level >= 1 ? [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8], [0, -0.85], [0, 0.85], [-0.85, 0], [0.85, 0]] : [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
    for (const [x, z] of posts) {
      part(g, cyl(0.05, 0.07, 0.5, 6), m.metal, x, 0.3, z, false);
      part(g, new THREE.SphereGeometry(0.08, 8, 6), trim, x, 0.58, z, false);
    }
  }
  return P;
}

export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.mode = null;
    this.rotation = 0;
    this.structures = [];
    this.solidMeshes = [];
    this.allMeshes = [];
    this.shells = [];
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.target = null;
    this.aimed = null;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x3dff8a, transparent: true, opacity: 0.4, depthWrite: false });
    this.ghosts = {};
    this.indicatorMat = new THREE.MeshBasicMaterial({ color: 0x3de0ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  }

  get scene() { return this.game.r.scene; }
  get nav() { return this.game.world.nav; }

  init() {
    // ghosts are recreated per map (scene is shared, so just once is fine)
    if (Object.keys(this.ghosts).length) return;
    for (const t of BUILD_ORDER) {
      const P = buildModel(t, 0);
      P.group.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; o.receiveShadow = false; } });
      P.group.visible = false;
      this.scene.add(P.group);
      this.ghosts[t] = P.group;
    }
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), this.indicatorMat);
    this.rangeRing.visible = false;
    this.rangeRing.renderOrder = 3;
    this.scene.add(this.rangeRing);
    this.arcMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 32, 0, 1).rotateX(-Math.PI / 2), this.indicatorMat);
    this.arcMesh.visible = false;
    this.arcMesh.renderOrder = 3;
    this.scene.add(this.arcMesh);
  }

  // Power cables from the core / nearest generator to every powered building
  rebuildCables() {
    if (!this.cableMats) {
      const tex = cableEnergyTexture();
      this.cableMats = {
        on: new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.5, metalness: 0.1, emissive: '#3de0ff', emissiveMap: tex, emissiveIntensity: 0.9 }),
        off: new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.5, metalness: 0.1 }),
      };
      this.cableTex = tex;
    }
    for (const c of this.cables || []) { this.scene.remove(c); c.geometry.dispose(); }
    this.cables = [];
    const core = this.game.core;
    if (!core) return;
    const gens = this.structures.filter((s) => s.type === 'generator');
    for (const s of this.structures) {
      const need = this.powerOf(s.type, s.level);
      if (s.type !== 'generator' && !need) continue;
      // source: generator feeds nearby buildings, everything else connects to the core
      let src = null, best = Infinity;
      if (s.type !== 'generator') for (const gnr of gens) {
        const d = Math.hypot(gnr.x - s.x, gnr.z - s.z);
        if (d < best && d < 14) { best = d; src = gnr; }
      }
      const a = src ? { x: src.x, z: src.z } : { x: core.pos.x, z: core.pos.z };
      const b = { x: s.x, z: s.z };
      // start at the edge of the source, end at the edge of the building
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 1;
      const r0 = src ? 0.9 : 3.4;
      const A = { x: a.x + (dx / d) * r0, z: a.z + (dz / d) * r0 };
      const B = { x: b.x - (dx / d) * 0.85, z: b.z - (dz / d) * 0.85 };
      if (Math.hypot(B.x - A.x, B.z - A.z) < 0.5) continue;
      const geo = cableGeometry(A, B, { radius: 0.055, liftA: src ? 0.3 : 0.45, liftB: 0.35, wiggle: 0.5, seed: s.i * 13 + s.j, ground: groundAt });
      const m = new THREE.Mesh(geo, s.offline ? this.cableMats.off : this.cableMats.on);
      m.receiveShadow = true;
      this.scene.add(m);
      this.cables.push(m);
    }
  }

  clear() {
    for (const c of this.cables || []) { this.scene.remove(c); c.geometry.dispose(); }
    this.cables = [];
    for (const s of this.structures) this.disposeStructure(s);
    for (const sh of this.shells) this.scene.remove(sh.mesh);
    this.structures = [];
    this.shells = [];
    this.rebuildLists();
    this.setMode(null);
  }

  disposeStructure(s) {
    this.scene.remove(s.group);
    if (s.bar) this.scene.remove(s.bar);
  }

  setMode(mode) {
    this.mode = mode;
    for (const t of BUILD_ORDER) if (this.ghosts[t]) this.ghosts[t].visible = false;
    if (this.rangeRing) this.rangeRing.visible = false;
    if (this.arcMesh) this.arcMesh.visible = false;
    if (this.game.world) this.game.world.showGrid(!!mode);
  }

  rotate() {
    this.rotation = (this.rotation + 1) % ROT_STEPS;
    this.game.audio.click();
  }

  rebuildLists() {
    this.solidMeshes = [];
    this.allMeshes = [];
    for (const s of this.structures) {
      s.group.traverse((o) => { if (o.isMesh) { o.userData.structure = s; this.allMeshes.push(o); } });
      if (s.def.solid) this.solidMeshes.push(...s.parts.solid);
    }
  }

  cost(type) {
    return Math.round(BUILDINGS[type].cost * this.game.mods.buildCost);
  }

  stat(s, key) {
    const lv = s.def.levels[s.level];
    return lv[key] !== undefined ? lv[key] : s.def[key];
  }

  maxHpFor(type, level) {
    const lv = BUILDINGS[type].levels[level];
    return lv.hp ? lv.hp * this.game.mods.structHp : Infinity;
  }

  // ------------------------------------------------------------ placement
  // where the view ray hits the ground (works on hills: steps along the ray)
  groundHit(ray, out, maxD = 40) {
    const o = ray.origin, d = ray.direction;
    let prev = 0;
    for (let t = 0.25; t <= maxD; t += 0.25) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= groundAt(x, z)) {
        // refine between the last two samples
        let a = prev, b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m <= groundAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m;
        }
        return out.set(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prev = t;
    }
    // looking far / at the sky: fall back to the floor plane under the player
    this.plane.constant = -this.game.player.pos.y;
    return ray.intersectPlane(this.plane, out);
  }

  computeTarget() {
    const game = this.game;
    this.raycaster.setFromCamera({ x: 0, y: 0 }, game.r.camera);
    const p = new THREE.Vector3();
    if (!this.groundHit(this.raycaster.ray, p)) return null;
    const pl = game.player.pos;
    const dx = p.x - pl.x, dz = p.z - pl.z;
    const d = Math.hypot(dx, dz);
    if (d > REACH) { p.x = pl.x + (dx / d) * REACH; p.z = pl.z + (dz / d) * REACH; }
    const nav = this.nav;
    const i = nav.ci(p.x), j = nav.cj(p.z);
    const x = nav.cx(i), z = nav.cz(j);
    const reason = this.invalidReason(i, j, x, z);
    return { i, j, x, z, valid: !reason, reason };
  }

  invalidReason(i, j, x, z) {
    const game = this.game;
    const nav = this.nav;
    const def = BUILDINGS[this.mode];
    if (!nav.inside(i, j)) return 'Out of bounds';
    const k = nav.idx(i, j);
    if (nav.blocked[k]) return 'Blocked';
    if (nav.struct[k]) return 'Occupied';
    if (nav.pool[k]) return 'Cannot build in acid';
    if (game.world.elev.span(x, z, 0.9) > 0.8) return 'Too steep';
    if (Math.hypot(x - game.core.pos.x, z - game.core.pos.z) < game.core.radius + 1.8) return 'Too close to the core';
    for (const h of game.world.hives) if (Math.hypot(x - h.pos.x, z - h.pos.z) < 7) return 'Too close to a hive';
    if (def.solid) {
      const inside = (px, pz, r) => Math.abs(px - x) < CELL / 2 + r && Math.abs(pz - z) < CELL / 2 + r;
      for (const p of game.players) if (!p.dead && inside(p.pos.x, p.pos.z, p.radius)) return 'Something is in the way';
      for (const e of game.enemies.list) if (!e.dead && !e.def.flying && inside(e.pos.x, e.pos.z, e.def.radius)) return 'Something is in the way';
    }
    return null;
  }

  // ------------------------------------------------------------ power
  powerOf(type, level) { return BUILDINGS[type].levels[level].power || 0; }
  supplyOf(type, level) { return BUILDINGS[type].levels[level].supply || 0; }

  get powerCap() {
    let cap = CORE_POWER + this.game.mods.reactor;
    for (const s of this.structures) cap += this.supplyOf(s.type, s.level);
    return cap;
  }

  get powerUsed() {
    let u = 0;
    for (const s of this.structures) u += this.powerOf(s.type, s.level);
    return u;
  }

  // Decide which buildings get power. Oldest buildings are served first.
  updatePower() {
    let left = this.powerCap;
    let offline = 0;
    for (const s of this.structures) {
      const need = this.powerOf(s.type, s.level);
      const was = s.offline;
      s.offline = need > left;
      if (!s.offline) left -= need;
      else offline++;
      if (s.offline && !was && this.game.running) this.game.fx.burst(_v.set(s.x, s.y + 2, s.z), '#ff4a5a', 8, 3, 0.08);
    }
    if (offline > this.lastOffline && this.game.running) {
      this.game.hud.toast(`${offline} defense${offline > 1 ? 's' : ''} offline: not enough power!`, 'bad');
      this.game.audio.error();
    }
    this.lastOffline = offline;
    this.rebuildCables();
  }

  powerFree() { return this.powerCap - this.powerUsed; }

  tryPlace() {
    const game = this.game;
    const t = this.target;
    if (!this.mode || !t) return;
    if (!t.valid) { game.audio.error(); game.hud.toast(t.reason, 'warn'); return; }
    const cost = this.cost(this.mode);
    if (game.credits < cost) { game.audio.error(); game.hud.toast('Not enough crystals', 'warn'); return; }
    const need = this.powerOf(this.mode, 0);
    if (need > this.powerFree()) { game.audio.error(); game.hud.toast(`Needs ${need} ⚡ power. Build a Generator!`, 'warn'); return; }
    if (game.net.isClient) {
      // co-op: ask the host to build it (shared crystals)
      game.net.request({ a: 'build', type: this.mode, i: t.i, j: t.j, rot: this.rotation });
      game.audio.click();
      return;
    }
    game.credits -= cost;
    const s = this.place(this.mode, t.i, t.j, this.rotation);
    s.invested = cost;
    game.stats.built++;
    game.audio.build(s.group.position);
    game.fx.dust(s.x, s.z, 1.2);
  }

  place(type, i, j, rotation = 0) {
    const nav = this.nav;
    const def = BUILDINGS[type];
    const x = nav.cx(i), z = nav.cz(j);
    const parts = buildModel(type, 0);
    const y = elevation().minAt(x, z, 0.9); // on a slope it sits on the low side and digs into the high side
    parts.group.position.set(x, y, z);
    parts.group.rotation.y = rotation * ROT_ANGLE;
    this.scene.add(parts.group);
    const hp = this.maxHpFor(type, 0);
    const s = {
      type, def, parts, group: parts.group, i, j, x, y, z, rotation, level: 0,
      hp, maxHp: hp, cd: 0, flash: 0, rise: 0, target: null, spin: 0, fx: 0, invested: def.cost, firing: false,
      baseYaw: rotation * ROT_ANGLE, yaw: rotation * ROT_ANGLE,
    };
    if (parts.head) parts.head.rotation.y = 0;
    if (isFinite(hp)) this.makeBar(s);
    this.structures.push(s);
    nav.struct[nav.idx(i, j)] = s;
    this.afterChange();
    return s;
  }

  makeBar(s) {
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.13), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.13).translate(0.8, 0, 0), new THREE.MeshBasicMaterial({ color: 0x3de0ff, depthWrite: false, fog: false, toneMapped: false }));
    fg.position.set(-0.8, 0, 0.001);
    bar.add(bg, fg);
    bar.visible = false;
    bar.renderOrder = 5;
    bar.position.set(s.x, s.y + (s.type === 'tesla' ? 3.6 : 2.6), s.z);
    this.scene.add(bar);
    s.bar = bar;
    s.barFill = fg;
  }

  afterChange() {
    const game = this.game;
    game.net.structDirty = true;
    this.rebuildLists();
    this.updatePower();
    const c = game.core;
    this.nav.computeFlow(c.pos.x, c.pos.z, c.radius);
  }

  remove(s) {
    this.disposeStructure(s);
    this.structures.splice(this.structures.indexOf(s), 1);
    this.nav.struct[this.nav.idx(s.i, s.j)] = null;
    if (this.aimed === s) this.aimed = null;
    this.afterChange();
  }

  // ------------------------------------------------------------ actions on existing buildings
  upgradeCost(s) {
    const next = s.def.levels[s.level + 1];
    return next ? Math.round(next.cost * this.game.mods.buildCost) : null;
  }

  repairCost(s) {
    if (!isFinite(s.maxHp) || s.hp >= s.maxHp) return 0;
    return Math.max(1, Math.ceil(((s.maxHp - s.hp) / s.maxHp) * s.invested * 0.4));
  }

  sellValue(s) {
    const frac = isFinite(s.maxHp) ? Math.max(0, s.hp / s.maxHp) : 1;
    return Math.floor(s.invested * 0.6 * frac);
  }

  upgrade(s) {
    const game = this.game;
    if (game.net.isClient) { game.net.request({ a: 'upgrade', i: s.i, j: s.j }); return; }
    const cost = this.upgradeCost(s);
    if (cost === null) { game.audio.error(); game.hud.toast('Already max level', 'warn'); return; }
    if (game.credits < cost) { game.audio.error(); game.hud.toast('Not enough crystals', 'warn'); return; }
    const extra = this.powerOf(s.type, s.level + 1) - this.powerOf(s.type, s.level);
    if (extra > this.powerFree()) { game.audio.error(); game.hud.toast(`Needs ${extra} more ⚡ power`, 'warn'); return; }
    game.credits -= cost;
    s.invested += cost;
    const frac = isFinite(s.maxHp) ? s.hp / s.maxHp : 1;
    this.setLevel(s, s.level + 1);
    s.hp = isFinite(s.maxHp) ? Math.max(s.hp, s.maxHp * frac) + s.maxHp * 0.25 : Infinity;
    s.hp = Math.min(s.hp, s.maxHp);
    game.net.structDirty = true;
    game.fx.burst(_v.set(s.x, s.y + 1.5, s.z), TRIM[s.level], 24, 5, 0.1);
    game.audio.upgrade(s.group.position);
    game.hud.toast(`${s.def.name} upgraded to level ${s.level + 1}`, 'good');
  }

  // rebuild the model at another level
  setLevel(s, level) {
    s.level = level;
    this.scene.remove(s.group);
    const parts = buildModel(s.type, s.level);
    parts.group.position.set(s.x, s.y, s.z);
    parts.group.rotation.y = s.rotation * ROT_ANGLE;
    this.scene.add(parts.group);
    s.parts = parts;
    s.group = parts.group;
    s.maxHp = this.maxHpFor(s.type, s.level);
    if (!isFinite(s.maxHp)) s.hp = Infinity;
    s.rise = 0.6;
    this.rebuildLists();
    this.updatePower();
  }

  // co-op client: make our buildings match the host's list [[i, j, type, level, rotation, invested], ...]
  applyState(list) {
    const game = this.game;
    const nav = this.nav;
    const want = new Set();
    for (const [i, j, type, level, rot, invested] of list) {
      want.add(i + ',' + j);
      let s = nav.struct[nav.idx(i, j)];
      if (s && s.type !== type) { this.remove(s); s = null; }
      if (!s) {
        s = this.place(type, i, j, rot);
        game.audio.build(s.group.position);
        game.fx.dust(s.x, s.z, 1.2);
      }
      if (s.level !== level) {
        this.setLevel(s, level);
        game.fx.burst(_v.set(s.x, s.y + 1.5, s.z), TRIM[s.level], 24, 5, 0.1);
        game.audio.upgrade(s.group.position);
      }
      if (s.rotation !== rot) {
        s.rotation = rot;
        s.baseYaw = s.yaw = rot * ROT_ANGLE;
        s.group.rotation.y = s.baseYaw;
        if (s.parts.head) s.parts.head.rotation.y = 0;
      }
      s.invested = invested;
    }
    for (const s of [...this.structures]) if (!want.has(s.i + ',' + s.j)) this.remove(s);
  }

  repair(s) {
    const game = this.game;
    if (game.net.isClient) { game.net.request({ a: 'repair', i: s.i, j: s.j }); return; }
    const cost = this.repairCost(s);
    if (!cost) { game.hud.toast('Already at full health'); return; }
    if (game.credits < cost) { game.audio.error(); game.hud.toast('Not enough crystals', 'warn'); return; }
    game.credits -= cost;
    s.hp = s.maxHp;
    game.fx.burst(_v.set(s.x, s.y + 1.2, s.z), '#6dff8a', 16, 4, 0.08);
    game.audio.repair(s.group.position);
  }

  sell(s) {
    const game = this.game;
    if (game.net.isClient) { game.net.request({ a: 'sell', i: s.i, j: s.j }); return; }
    const v = this.sellValue(s);
    game.addCredits(v);
    game.fx.burst(_v.set(s.x, s.y + 1, s.z), '#3de0ff', 16, 4, 0.12);
    game.hud.toast(`Sold for ${v} ⬢`);
    game.audio.sell(s.group.position);
    this.remove(s);
  }

  turn(s) {
    if (!s.def.rotatable) return;
    if (this.game.net.isClient) { this.game.net.request({ a: 'turn', i: s.i, j: s.j }); this.game.audio.click(); return; }
    this.game.net.structDirty = true;
    s.rotation = (s.rotation + 1) % ROT_STEPS;
    s.baseYaw = s.rotation * ROT_ANGLE;
    s.group.rotation.y = s.baseYaw;
    if (s.parts.head) s.parts.head.rotation.y = 0;
    s.yaw = s.baseYaw;
    this.game.audio.click();
  }

  damage(s, amount, attacker = null) {
    const game = this.game;
    if (game.net.isClient) return; // the host decides building damage
    if (!isFinite(s.hp) || s.hp <= 0) return;
    s.hp -= amount;
    s.flash = 0.12;
    s.lastHit = game.time;
    const thorns = s.def.levels[s.level].thorns;
    if (thorns && attacker && !attacker.dead) game.enemies.damage(attacker, thorns, { showNumber: false });
    if (s.hp <= 0) {
      _v.set(s.x, s.y + 1, s.z);
      game.net.event({ k: 'boom', x: _v.x, y: _v.y, z: _v.z, r: 2.2, s: 0.7 });
      if (s.def.turret) game.net.event({ k: 'toast', m: `${s.def.name} destroyed!`, kind: 'bad' });
      game.fx.explosion(_v, '#ffb43d', 2.2);
      game.fx.burst(_v, '#8592a6', 20, 7, 0.2);
      game.audio.destroyed(_v);
      if (s.def.turret) game.hud.toast(`${s.def.name} destroyed!`, 'bad');
      this.remove(s);
    }
  }

  damageArea(x, z, r, amount) {
    for (const s of [...this.structures]) {
      if (!isFinite(s.hp)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < r + 1) this.damage(s, amount * (1 - Math.max(0, d - 1) / r * 0.5));
    }
  }

  nearestOfKind(x, z, maxD, filter) {
    let best = null, bd = maxD;
    for (const s of this.structures) {
      if (!filter(s)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const game = this.game;
    const cam = game.r.camera;
    if (this.cableTex) this.cableTex.offset.x -= dt * 0.8;

    // aimed building (for upgrade / repair / sell)
    this.aimed = null;
    if (!game.player.dead && this.allMeshes.length) {
      this.raycaster.setFromCamera({ x: 0, y: 0 }, cam);
      this.raycaster.far = 9;
      const hit = this.raycaster.intersectObjects(this.allMeshes, false)[0];
      this.raycaster.far = Infinity;
      if (hit) this.aimed = hit.object.userData.structure;
    }
    if (!this.aimed && this.mode === null && !game.player.dead) {
      // aiming at the ground under a trap?
      this.raycaster.setFromCamera({ x: 0, y: 0 }, cam);
      const p = new THREE.Vector3();
      if (this.groundHit(this.raycaster.ray, p, 9) && p.distanceTo(game.player.pos) < 7) {
        const nav = this.nav;
        const i = nav.ci(p.x), j = nav.cj(p.z);
        if (nav.inside(i, j)) {
          const s = nav.struct[nav.idx(i, j)];
          if (s && !s.def.solid) this.aimed = s;
        }
      }
    }

    // ghost preview
    if (this.mode && !game.player.dead) {
      this.target = this.computeTarget();
      const ghost = this.ghosts[this.mode];
      const def = BUILDINGS[this.mode];
      if (this.target) {
        const { x, z } = this.target;
        ghost.visible = true;
        const gy = elevation().minAt(x, z, 0.9);
        ghost.position.set(x, gy + 0.02, z);
        ghost.rotation.y = this.rotation * ROT_ANGLE;
        const ok = this.target.valid && game.credits >= this.cost(this.mode);
        this.ghostMat.color.set(ok ? 0x3dff8a : 0xff3d5a);
        this.ghostMat.opacity = 0.32 + Math.sin(game.time * 6) * 0.08;
        game.world.showGrid(true, x, z);
        const range = def.levels[0].range || def.range;
        this.rangeRing.visible = !!def.turret && !def.directional;
        if (this.rangeRing.visible) {
          this.rangeRing.position.set(x, gy + 0.06, z);
          this.rangeRing.scale.setScalar(range);
        }
        this.arcMesh.visible = !!def.directional;
        if (def.directional) {
          const arc = (def.arc * Math.PI) / 180;
          if (this.arcRange !== range) {
            this.arcRange = range;
            this.arcMesh.geometry.dispose();
            this.arcMesh.geometry = new THREE.CircleGeometry(range, 24, -arc / 2, arc).rotateX(-Math.PI / 2);
          }
          this.arcMesh.position.set(x, gy + 0.06, z);
          // CircleGeometry theta 0 points +X; rotate so the arc points forward (-Z)
          this.arcMesh.rotation.y = this.rotation * ROT_ANGLE + Math.PI / 2;
        }
      } else ghost.visible = false;
    } else {
      this.target = null;
      for (const t of BUILD_ORDER) if (this.ghosts[t]) this.ghosts[t].visible = false;
      if (this.rangeRing) this.rangeRing.visible = false;
      if (this.arcMesh) this.arcMesh.visible = false;
    }

    for (const s of this.structures) {
      if (s.rise < 1) {
        s.rise = Math.min(1, s.rise + dt * 3.5);
        const k = 1 - Math.pow(1 - s.rise, 3);
        s.group.scale.set(1, Math.max(0.02, k), 1);
        s.group.updateMatrixWorld(true);
      }
      if (s.offline) {
        this.updateOffline(s, dt);
      } else if (s.type === 'gatling') this.updateGatling(s, dt);
      else if (s.type === 'generator') this.updateGenerator(s, dt);
      else if (s.type === 'flamer') this.updateFlamer(s, dt);
      else if (s.type === 'tesla') this.updateTesla(s, dt);
      else if (s.type === 'mortar') this.updateMortar(s, dt);
      else if (s.type === 'trap') this.updateTrap(s, dt);
      if (s.type === 'shield') this.updateShield(s, dt);

      if (s.bar) {
        const show = s.hp < s.maxHp || this.aimed === s;
        s.bar.visible = show;
        if (show) {
          s.bar.quaternion.copy(cam.quaternion);
          s.barFill.scale.x = Math.max(0.001, s.hp / s.maxHp);
          s.barFill.material.color.set(s.hp / s.maxHp < 0.35 ? 0xff4a5a : 0x3de0ff);
        }
      }
      if (s.flash > 0) {
        s.flash -= dt;
        s.group.position.x = s.x + (Math.random() - 0.5) * 0.06;
      } else s.group.position.x = s.x;
    }
    this.updateShells(dt);
  }

  updateOffline(s, dt) {
    const g = this.game;
    if (s.parts.pitch) s.parts.pitch.rotation.x += (-0.45 - s.parts.pitch.rotation.x) * Math.min(1, dt * 3);
    if (s.parts.head && s.type !== 'gatling') s.parts.head.rotation.x += (0.25 - s.parts.head.rotation.x) * Math.min(1, dt * 3);
    if (s.parts.spinners) for (const sp of s.parts.spinners) sp.rotation.z += 0;
    s.fx -= dt;
    if (s.fx <= 0) {
      s.fx = 0.8;
      g.fx.burst(_v.set(s.x, s.y + 2.2, s.z), '#ff4a5a', 2, 1, 0.07);
    }
  }

  updateShield(s, dt) {
    const g = this.game;
    const u = s.parts.fieldU;
    if (!u) return;
    if (!s.offline && g.time - (s.lastHit || -99) > 2.5 && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + this.stat(s, 'regen') * dt);
    const frac = s.hp / s.maxHp;
    u.time.value = g.time + s.x;
    u.strength.value = s.offline ? 0.15 + Math.random() * 0.1 : 0.45 + frac * 0.55;
    u.hurt.value = THREE.MathUtils.smoothstep(1 - frac, 0.45, 0.85);
    u.hit.value = Math.max(0, s.flash) * 5;
  }

  updateGenerator(s, dt) {
    const t = this.game.time;
    if (s.parts.ring) {
      s.parts.ring.rotation.y += dt * 1.5;
      s.parts.ring.children.forEach((r, i) => (r.rotation.z = Math.sin(t * 2 + i) * 0.15));
    }
    if (s.parts.reactor) s.parts.reactor.scale.set(1 + Math.sin(t * 6 + s.x) * 0.06, 1, 1 + Math.sin(t * 6 + s.x) * 0.06);
    if (s.parts.head) s.parts.head.rotation.x = 0;
  }

  // target helpers
  enemyAim(e, out) {
    return out.set(e.pos.x, e.def.flying ? e.pos.y : e.pos.y + e.rig.baseH + 0.15 * e.rig.s, e.pos.z);
  }

  findTarget(s, range, opts = {}) {
    let best = null, bd = range;
    const minR = opts.minRange || 0;
    for (const e of this.game.enemies.list) {
      if (e.dead || e.hidden || e.spawnT < 0.6) continue;
      if (e.def.flying && !opts.air) continue;
      const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z);
      if (d < minR || d >= bd) continue;
      if (opts.arc !== undefined) {
        const a = Math.atan2(-(e.pos.x - s.x), -(e.pos.z - s.z));
        const diff = Math.abs(Math.atan2(Math.sin(a - s.baseYaw), Math.cos(a - s.baseYaw)));
        if (diff > opts.arc / 2) continue;
      }
      bd = d;
      best = e;
    }
    return best;
  }

  aimHead(s, e, dt, speed = 8) {
    const want = Math.atan2(-(e.pos.x - s.x), -(e.pos.z - s.z)) - s.baseYaw;
    const head = s.parts.head;
    let diff = want - head.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    head.rotation.y += THREE.MathUtils.clamp(diff, -speed * dt, speed * dt);
    return Math.abs(diff);
  }

  updateGatling(s, dt) {
    const game = this.game;
    s.cd -= dt;
    const lv = s.def.levels[s.level];
    const range = s.def.range;
    if (!s.target || s.target.dead || Math.hypot(s.target.pos.x - s.x, s.target.pos.z - s.z) > range) s.target = this.findTarget(s, range, { air: true });
    const e = s.target;
    if (e) {
      const off = this.aimHead(s, e, dt, 7);
      this.enemyAim(e, _v);
      const h = _v.y - (s.y + 1.15);
      const d = Math.hypot(_v.x - s.x, _v.z - s.z);
      s.parts.pitch.rotation.x += (Math.atan2(h, d) - s.parts.pitch.rotation.x) * Math.min(1, dt * 8);
      s.spin = Math.min(1, s.spin + dt * 3);
      if (off < 0.12 && s.cd <= 0 && s.spin > 0.5) {
        s.cd = 1 / lv.rate;
        const muzzle = s.parts.muzzles[(s.shotN = (s.shotN || 0) + 1) % s.parts.muzzles.length];
        muzzle.getWorldPosition(_w);
        game.enemies.damage(e, lv.dmg * game.mods.turretDmg, { showNumber: false, from: s });
        game.fx.tracer(_w, _v, '#9ff4ff');
        game.fx.muzzle(_w, '#ffd27a', 0.5);
        game.fx.burst(_v, e.def.colors.blood, 2, 3, 0.07);
        game.audio.turret(_w);
      }
    } else {
      s.spin = Math.max(0, s.spin - dt);
      s.parts.head.rotation.y += Math.atan2(Math.sin(-s.parts.head.rotation.y), Math.cos(-s.parts.head.rotation.y)) * Math.min(1, dt * 1.5);
      s.parts.pitch.rotation.x *= 1 - Math.min(1, dt * 2);
    }
    for (const sp of s.parts.spinners) sp.rotation.z += s.spin * dt * 30;
  }

  updateFlamer(s, dt) {
    const game = this.game;
    const lv = s.def.levels[s.level];
    const range = lv.range || s.def.range;
    const arc = (s.def.arc * Math.PI) / 180;
    const e = this.findTarget(s, range, { arc });
    s.firing = false;
    if (e) {
      this.aimHead(s, e, dt, 4);
      s.firing = true;
      const yaw = s.baseYaw + s.parts.head.rotation.y;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      for (const o of game.enemies.list) {
        if (o.dead || o.hidden || (o.def.flying && o.pos.y - groundAt(o.pos.x, o.pos.z) > 3)) continue;
        const dx = o.pos.x - s.x, dz = o.pos.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > range + o.def.radius || d < 0.5) continue;
        const dot = (dx * fx + dz * fz) / d;
        if (dot < Math.cos(0.3) && d > 1.5) continue;
        game.enemies.damage(o, lv.dps * dt * game.mods.turretDmg, { showNumber: false, from: s });
        o.burn = 2.5;
        o.burnDps = Math.max(o.burnDps || 0, lv.burn * game.mods.turretDmg);
      }
      s.parts.muzzles[0].getWorldPosition(_w);
      game.fx.flame(_w, fx, fz, range, dt);
      game.audio.flame(_w);
    }
    s.parts.pilot.scale.setScalar(s.firing ? 1.8 : 1 + Math.sin(game.time * 20) * 0.15);
  }

  updateTesla(s, dt) {
    const game = this.game;
    s.cd -= dt;
    const lv = s.def.levels[s.level];
    s.parts.orb.scale.setScalar(1 + Math.sin(game.time * 9 + s.x) * 0.06 + (s.cd > 1 / lv.rate - 0.1 ? 0.3 : 0));
    if (s.cd > 0) return;
    const first = this.findTarget(s, s.def.range, { air: true });
    if (!first) return;
    s.cd = 1 / lv.rate;
    const hit = new Set([first]);
    s.parts.muzzles[0].getWorldPosition(_w);
    let from = _w.clone();
    let cur = first;
    let dmg = lv.dmg * game.mods.turretDmg;
    for (let n = 0; n < lv.chains && cur; n++) {
      const to = this.enemyAim(cur, new THREE.Vector3());
      game.fx.lightning(from, to);
      game.enemies.damage(cur, dmg, { showNumber: false, from: s });
      if (lv.stun) cur.shock = 0.6;
      game.fx.burst(to, '#bff6ff', 5, 4, 0.06);
      from = to;
      dmg *= 0.85;
      let next = null, nd = 7;
      for (const o of game.enemies.list) {
        if (o.dead || o.hidden || hit.has(o)) continue;
        const d = Math.hypot(o.pos.x - cur.pos.x, o.pos.z - cur.pos.z);
        if (d < nd) { nd = d; next = o; }
      }
      if (next) hit.add(next);
      cur = next;
    }
    game.audio.zap(_w, true);
  }

  updateMortar(s, dt) {
    const game = this.game;
    s.cd -= dt;
    const lv = s.def.levels[s.level];
    // pick the target with the most neighbours
    let best = null, bestScore = 0;
    for (const e of game.enemies.list) {
      if (e.dead || e.hidden || e.def.flying || e.spawnT < 1) continue;
      const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z);
      if (d < s.def.minRange || d > s.def.range) continue;
      let score = 1;
      for (const o of game.enemies.list) {
        if (o === e || o.dead || o.def.flying) continue;
        if (Math.abs(o.pos.x - e.pos.x) < lv.radius && Math.abs(o.pos.z - e.pos.z) < lv.radius) score++;
      }
      score += e.def.boss ? 4 : 0;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) return;
    const off = this.aimHead(s, best, dt, 3);
    if (s.cd > 0 || off > 0.2) return;
    s.cd = 1 / lv.rate;
    const flight = 2.1 + Math.hypot(best.pos.x - s.x, best.pos.z - s.z) * 0.03;
    const tx = best.pos.x + best.vel.x * flight;
    const tz = best.pos.z + best.vel.z * flight;
    for (const muzzle of s.parts.muzzles) {
      muzzle.getWorldPosition(_w);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mats().shell);
      mesh.position.copy(_w);
      this.scene.add(mesh);
      const ex = tx + (Math.random() - 0.5) * 3, ez = tz + (Math.random() - 0.5) * 3;
      this.shells.push({
        mesh, sx: _w.x, sy: _w.y, sz: _w.z, ex, ez, ey: groundAt(ex, ez),
        t: 0, dur: flight, h: 10 + flight * 4, dmg: lv.dmg * game.mods.turretDmg, radius: lv.radius, cluster: lv.cluster,
      });
      game.fx.muzzle(_w, '#ffb43d', 1.2);
      game.fx.smoke(_w, 4);
    }
    game.audio.mortar(_w);
  }

  updateShells(dt) {
    const game = this.game;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt / sh.dur;
      const t = Math.min(1, sh.t);
      sh.mesh.position.set(
        THREE.MathUtils.lerp(sh.sx, sh.ex, t),
        THREE.MathUtils.lerp(sh.sy, sh.ey, t) + Math.sin(Math.PI * t) * sh.h,
        THREE.MathUtils.lerp(sh.sz, sh.ez, t)
      );
      if (Math.random() < dt * 40) game.fx.trail(sh.mesh.position, '#ff9a3d');
      if (t >= 1) {
        this.scene.remove(sh.mesh);
        sh.mesh.geometry.dispose();
        this.shells.splice(i, 1);
        this.blast(sh.ex, sh.ez, sh.dmg, sh.radius);
        if (sh.cluster) {
          for (let k = 0; k < 3; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = sh.radius * 0.9;
            setTimeout(() => this.blast(sh.ex + Math.cos(a) * r, sh.ez + Math.sin(a) * r, sh.dmg * 0.35, sh.radius * 0.6), 150 + k * 120);
          }
        }
      }
    }
  }

  blast(x, z, dmg, radius) {
    const game = this.game;
    if (!game.running) return;
    game.fx.explosion(_v.set(x, groundAt(x, z) + 0.5, z), '#ffb43d', radius);
    game.fx.splat(x, z, '#1a1410', radius * 0.6);
    game.audio.explosion(_v, 0.6);
    game.shake(0.25, _v);
    for (const e of game.enemies.list) {
      if (e.dead || e.hidden || (e.def.flying && e.pos.y - groundAt(e.pos.x, e.pos.z) > 2.5)) continue;
      if (Math.abs(e.pos.y - groundAt(x, z)) > radius + 1.5) continue; // blast on a different level
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < radius + e.def.radius) game.enemies.damage(e, dmg * (1 - (d / (radius + e.def.radius)) * 0.6), { explosive: true });
    }
  }

  updateTrap(s, dt) {
    const game = this.game;
    const lv = s.def.levels[s.level];
    s.fx -= dt;
    let any = false;
    for (const e of game.enemies.list) {
      if (e.dead || e.hidden || e.def.flying) continue;
      const r = 1 + e.def.radius * 0.5;
      if (Math.abs(e.pos.x - s.x) < r && Math.abs(e.pos.z - s.z) < r) {
        any = true;
        e.slow = 0.35;
        e.slowF = Math.min(e.slowF || 1, lv.slow);
        game.enemies.damage(e, lv.dps * dt * game.mods.turretDmg, { showNumber: false });
        if (s.fx <= 0) {
          s.fx = 0.12;
          _v.set(s.x + (Math.random() - 0.5) * 1.6, s.y + 0.25, s.z + (Math.random() - 0.5) * 1.6);
          game.fx.lightning(_v, this.enemyAim(e, _w), 0.4);
          game.audio.zap(_v);
        }
      }
    }
    s.parts.padMat.emissiveIntensity = any ? 1.5 + Math.random() * 2.5 : 0.6 + Math.sin(game.time * 3 + s.x) * 0.25;
  }
}
