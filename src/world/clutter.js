import * as THREE from 'three';
import { mergeGeos } from '../core/geomerge.js';
import { groundAt } from './elevation.js';
import { pbr } from '../core/materials.js';
import { lightShaft } from './atmosphere.js';

// Base dressing: sandbag walls, crates, concrete barriers, barrels, floodlight
// towers and scaffolding around the core. They block their grid cells, so they
// work as cover and the swarm paths around them.

export const CLUTTER = 3; // value in nav.blocked

const KINDS = ['sandbags', 'crates', 'barrier', 'flood', 'sandbags', 'barrels', 'crates', 'flood', 'scaffold', 'barrier', 'sandbags', 'barrels', 'crates'];

export function planClutter(world) {
  const nav = world.nav;
  const map = world.map;
  const rng = world.rng;
  const [cx, cz] = map.core;
  const hiveAngles = map.hives.map(([x, z]) => Math.atan2(z - cz, x - cx));
  const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const minR = 10, maxR = Math.min(18, Math.min(map.halfX, map.halfZ) * 0.42);
  const items = [];
  const used = new Set();
  const free = (i, j) => {
    if (!nav.inside(i, j)) return false;
    const k = nav.idx(i, j);
    if (nav.blocked[k] || nav.pool[k] || used.has(k)) return false;
    const x = nav.cx(i), z = nav.cz(j);
    if (world.elev.span(x, z, map.tightClutter ? 3.6 : 1.5) > 0.25) return false; // only on level ground (and not in narrow corridors)
    if (map.tightClutter && Math.abs(world.elev.at(x, z) - world.elev.at(cx, cz)) > 0.3) return false; // not on top of the rock walls
    if (Math.hypot(x - cx, z - cz) < 8.5) return false;
    if (Math.hypot(x - map.spawn[0], z - map.spawn[1]) < 4) return false;
    for (const [hx, hz] of map.hives) if (Math.hypot(x - hx, z - hz) < 10) return false;
    return true;
  };
  let kindIdx = 0;
  for (let attempt = 0; attempt < 200 && kindIdx < KINDS.length; attempt++) {
    const a = rng() * Math.PI * 2;
    if (hiveAngles.some((h) => angDist(a, h) < 0.32)) continue;
    const r = minR + rng() * (maxR - minR);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const i = nav.ci(x), j = nav.cj(z);
    if (!free(i, j)) continue;
    // keep groups apart
    if (items.some((it) => Math.hypot(it.x - nav.cx(i), it.z - nav.cz(j)) < 6)) continue;
    const kind = KINDS[kindIdx++];
    const tangent = a + Math.PI / 2;
    const cells = [[i, j]];
    if (kind === 'sandbags' || kind === 'barrier') {
      // a short wall along the tangent of the ring
      const ti = Math.round(Math.cos(tangent)), tj = Math.round(Math.sin(tangent));
      for (const s of [1, -1]) {
        const ni = i + ti * s, nj = j + tj * s;
        if ((ti || tj) && free(ni, nj)) cells.push([ni, nj]);
      }
    }
    for (const [ci, cj] of cells) {
      const k = nav.idx(ci, cj);
      used.add(k);
      nav.blocked[k] = CLUTTER;
      items.push({ kind, i: ci, j: cj, x: nav.cx(ci), z: nav.cz(cj), rot: tangent, toCore: a + Math.PI, seed: rng() });
    }
  }
  return items;
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    bag: pbr('fabric', { color: '#b9a57e', metalness: 0, repeat: 1 }),
    wood: pbr('wood', { color: '#c9a77a', metalness: 0 }),
    mil: pbr('milmetal', { color: '#9aa58a', metalness: 0.6 }),
    concrete: pbr('concrete', { color: '#c8c2b8', metalness: 0 }),
    barrel: pbr('rust', { color: '#8a5a3a', metalness: 0.7 }),
    pipe: pbr('metal', { color: '#9aa2ad' }),
    dark: pbr('gunmetal', { color: '#3a3e45' }),
    lamp: new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffe7b8', emissiveIntensity: 4 }),
    stripe: new THREE.MeshStandardMaterial({ color: '#d8a020', roughness: 0.7 }),
    hazardGlow: new THREE.MeshStandardMaterial({ color: '#ff5a1d', emissive: '#ff5a1d', emissiveIntensity: 1.6 }),
  };
  return MATS;
}

// Pillow-shaped sandbag
function bagGeometry() {
  const g = new THREE.SphereGeometry(1, 14, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // flatter top and bottom, boxier sides
    y = Math.sign(y) * Math.pow(Math.abs(y), 1.6);
    x = Math.sign(x) * Math.pow(Math.abs(x), 0.6);
    z = Math.sign(z) * Math.pow(Math.abs(z), 0.75);
    p.setXYZ(i, x * 0.34, y * 0.13, z * 0.2);
  }
  g.computeVertexNormals();
  return g;
}

// Jersey barrier cross-section extruded along its length
function barrierGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0);
  s.lineTo(0.32, 0);
  s.lineTo(0.32, 0.08);
  s.lineTo(0.2, 0.3);
  s.lineTo(0.09, 0.82);
  s.lineTo(-0.09, 0.82);
  s.lineTo(-0.2, 0.3);
  s.lineTo(-0.32, 0.08);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1 });
  g.translate(0, 0, -0.95);
  // ExtrudeGeometry UVs are in shape units; scale them so the texture is ~1.5 m
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.5, uv.getY(i) / 1.5);
  return g;
}

export function buildClutter(world, items) {
  const M = mats();
  const nav = world.nav;
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const lists = { bag: [], crate: [], mil: [], barrier: [], stripe: [], barrel: [], pipe: [], plank: [] };
  const push = (list, x, y, z, ry, sx, sy, sz, rx = 0, rz = 0) => {
    dummy.position.set(x, y + groundAt(x, z), z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    lists[list].push(dummy.matrix.clone());
  };
  const floods = [];
  const rnd = (seed) => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };

  for (const it of items) {
    if (nav.blocked[nav.idx(it.i, it.j)] !== CLUTTER) continue; // carved away by path finding
    const r = rnd(Math.floor(it.seed * 10000));
    const { x, z } = it;
    const ca = Math.cos(it.rot), sa = Math.sin(it.rot);
    const along = (d, side = 0) => [x + ca * d - sa * side, z + sa * d + ca * side];
    if (it.kind === 'sandbags') {
      // 3 staggered rows, slightly curved
      for (let layer = 0; layer < 4; layer++) {
        const n = layer === 3 ? 2 : 3;
        for (let b = 0; b < n; b++) {
          const d = (b - (n - 1) / 2) * 0.66 + (layer % 2) * 0.2;
          const [bx, bz] = along(d, (r() - 0.5) * 0.06);
          push('bag', bx, 0.12 + layer * 0.235, bz, -it.rot + (r() - 0.5) * 0.25, 1, 1 + (r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08);
        }
      }
      // a few loose bags on the ground
      if (r() < 0.5) {
        const [bx, bz] = along((r() - 0.5) * 1.4, 0.55);
        push('bag', bx, 0.1, bz, r() * 3, 1, 1, 1, 0, 0.15);
      }
    } else if (it.kind === 'barrier') {
      push('barrier', x, 0, z, -it.rot + Math.PI / 2 + (r() - 0.5) * 0.12, 1, 1, 1);
      push('stripe', x, 0.5, z, -it.rot + Math.PI / 2, 1.02, 0.08, 0.98);
    } else if (it.kind === 'crates') {
      const n = 1 + Math.floor(r() * 3);
      for (let c = 0; c < n; c++) {
        const s = 0.85 + r() * 0.35;
        const ox = (r() - 0.5) * 0.7, oz = (r() - 0.5) * 0.7;
        const y = c === 2 ? 1.1 : 0;
        if (r() < 0.65) push('crate', x + ox, y + s / 2, z + oz, r() * 0.5 + it.rot, s, s, s);
        else push('mil', x + ox, y + s * 0.3, z + oz, r() * 0.5 + it.rot, s * 1.3, s * 0.6, s * 0.7);
      }
      // ammo boxes
      for (let c = 0; c < 2; c++) push('mil', x + (r() - 0.5) * 1.4, 0.15, z + (r() - 0.5) * 1.4, r() * 3, 0.55, 0.3, 0.3);
    } else if (it.kind === 'barrels') {
      const n = 2 + Math.floor(r() * 3);
      for (let c = 0; c < n; c++) {
        const ox = (r() - 0.5) * 1.2, oz = (r() - 0.5) * 1.2;
        if (c === n - 1 && r() < 0.4) push('barrel', x + ox, 0.3, z + oz, r() * 3, 1, 1, 1, Math.PI / 2, 0); // tipped over
        else push('barrel', x + ox, 0.45, z + oz, r() * 3, 1, 1, 1);
      }
    } else if (it.kind === 'scaffold') {
      const h = 2.6;
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.85, 0.85]) {
        const [px, pz] = along(sx, sz);
        push('pipe', px, h / 2, pz, 0, 1, h, 1);
      }
      for (const y of [0.9, h]) for (const side of [-0.85, 0.85]) {
        const [px, pz] = along(0, side);
        push('pipe', px, y, pz, -it.rot, 1, 1.78, 1, 0, Math.PI / 2);
        const [qx, qz] = along(side, 0);
        push('pipe', qx, y, qz, -it.rot + Math.PI / 2, 1, 1.78, 1, 0, Math.PI / 2);
      }
      // diagonal brace
      // diagonal braces from corner to corner on two faces
      const diag = Math.hypot(1.7, h - 0.9);
      const ang = Math.atan2(1.7, h - 0.9);
      for (const side of [0.85, -0.85]) { const [px, pz] = along(0, side); push('pipe', px, (h + 0.9) / 2, pz, -it.rot, 1, diag, 1, 0, side > 0 ? ang : -ang); }
      // base plates under each foot
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.85, 0.85]) { const [px, pz] = along(sx, sz); push('mil', px, 0.03, pz, -it.rot, 0.24, 0.06, 0.24); }
      // deck: planks laid across the frame
      for (let p = 0; p < 4; p++) { const [px, pz] = along(-0.66 + p * 0.44, 0); push('plank', px, h + 0.075, pz, -it.rot, 0.4, 0.05, 1.86); }
      const [cx2, cz2] = along(0.3, 0.2);
      push('crate', cx2, h + 0.1 + 0.3, cz2, -it.rot + 0.3, 0.6, 0.6, 0.6);
    } else if (it.kind === 'flood') {
      floods.push(it);
    }
  }

  const inst = (geo, mat, list, shadow = true) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    world.raycastables.push(m);
  };
  inst(bagGeometry(), M.bag, lists.bag);
  inst(new THREE.BoxGeometry(1, 1, 1), M.wood, lists.crate);
  inst(new THREE.BoxGeometry(1, 1, 1), M.mil, lists.mil);
  inst(barrierGeometry(), M.concrete, lists.barrier);
  inst(new THREE.BoxGeometry(0.66, 1, 1.9), M.stripe, lists.stripe, false);
  inst(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), M.barrel, lists.barrel);
  inst(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), M.pipe, lists.pipe);
  inst(new THREE.BoxGeometry(1, 1, 1), M.wood, lists.plank);

  // Floodlight towers aimed at the core
  const lights = [];
  const [cx, cz] = world.map.core;
  for (const it of floods) {
    const t = new THREE.Group();
    const gy = groundAt(it.x, it.z);
    t.position.set(it.x, gy, it.z);
    const H = 5.4;
    const mesh = (geo, mat, px, py, pz, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = shadow;
      m.receiveShadow = true;
      t.add(m);
      return m;
    };
    mesh(new THREE.BoxGeometry(1.2, 0.25, 1.2), M.mil, 0, 0.125, 0);
    mesh(new THREE.CylinderGeometry(0.09, 0.12, H, 8), M.pipe, 0, H / 2, 0);
    for (let l = 0; l < 3; l++) {
      const a = (l / 3) * Math.PI * 2;
      const leg = mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 6), M.pipe, Math.cos(a) * 0.45, 1.05, Math.sin(a) * 0.45);
      leg.rotation.set(Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42);
    }
    // battery box
    mesh(new THREE.BoxGeometry(0.5, 0.6, 0.35), M.dark, 0.35, 0.55, 0);
    mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), M.hazardGlow, 0.35, 0.7, 0.18, false);
    // lamp head aimed at a point on the ground between tower and core
    const head = new THREE.Group();
    head.position.y = H;
    t.add(head);
    const dir = new THREE.Vector3(cx - it.x, 0, cz - it.z).normalize();
    const aim = new THREE.Vector3(it.x + dir.x * 9, 0, it.z + dir.z * 9);
    aim.y = groundAt(aim.x, aim.z);
    head.lookAt(aim); // world-space target
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), M.pipe);
    head.add(bar);
    for (const sx of [-0.45, 0.45]) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.28), M.dark);
      housing.position.set(sx, 0, 0.12);
      housing.castShadow = true;
      head.add(housing);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.34), M.lamp);
      lens.position.set(sx, 0, 0.265);
      head.add(lens);
    }
    group.add(t);
    // real light (no shadows, cheap) + visible beam
    const spot = new THREE.SpotLight('#ffe9c4', 70, 34, 0.55, 0.65, 1.4);
    spot.position.set(it.x, gy + H, it.z);
    spot.target.position.copy(aim);
    group.add(spot, spot.target);
    const shaft = lightShaft({ from: [it.x, gy + H, it.z], to: [aim.x + dir.x * 1.5, aim.y + 0.2, aim.z + dir.z * 1.5], r0: 0.35, r1: 3.2, color: '#ffe2b0', opacity: 0.22 });
    group.add(shaft);
    lights.push({ spot, shaft });
  }
  world.group.add(group);
  return { group, floods: lights };
}

// ---------------------------------------------------------------------------
// Power cables lying on the ground between two points
let cableTex = null;
export function cableEnergyTexture() {
  if (cableTex) return cableTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 4);
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.45, '#fff'); grad.addColorStop(0.55, '#fff'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(24, 0, 16, 4);
  cableTex = new THREE.CanvasTexture(c);
  cableTex.wrapS = cableTex.wrapT = THREE.RepeatWrapping;
  return cableTex;
}

export function cableGeometry(a, b, { radius = 0.05, liftA = 0.05, liftB = 0.05, wiggle = 0.6, seed = 1, sinkA = false, sinkB = false, ground = null } = {}) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(3, Math.ceil(len / (ground ? 0.6 : 1.6)));
  const px = -(b.z - a.z) / (len || 1), pz = (b.x - a.x) / (len || 1);
  const pts = [];
  let s = seed * 7.31;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const w = k === 0 || k === n ? 0 : Math.sin(t * Math.PI) * Math.sin(s + t * 5.3) * wiggle;
    const y = radius * 0.9 + Math.max(0, 1 - t * n) * (liftA - radius * 0.9) + Math.max(0, 1 - (1 - t) * n) * (liftB - radius * 0.9);
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + px * w, y, a.z + (b.z - a.z) * t + pz * w));
  }
  // an end that "sinks" dives into the ground instead of stopping in the air
  const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  if (sinkA) pts.unshift(pts[0].clone().addScaledVector(dir, -0.35).setY(-radius * 3));
  if (sinkB) pts.push(pts[pts.length - 1].clone().addScaledVector(dir, 0.35).setY(-radius * 3));
  // follow the terrain (hills, ramps)
  if (ground) for (const p of pts) p.y += ground(p.x, p.z);
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, pts.length * 6, radius, 8, false);
  const uv = tube.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 2.5);
  // close both ends so you never look into a hollow tube
  const caps = [];
  for (const t of [0, 1]) {
    const cap = new THREE.CircleGeometry(radius, 8);
    const tan = curve.getTangentAt(t);
    if (t === 0) tan.negate();
    const m = new THREE.Matrix4().compose(curve.getPointAt(t), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan), new THREE.Vector3(1, 1, 1));
    cap.userData.matrix = m;
    caps.push(cap);
  }
  return mergeGeos([tube, ...caps]);
}
