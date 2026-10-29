import * as THREE from 'three';
import { NavGrid, CELL, CLIFF, PIT, VOID } from './nav.js';
import { Elevation, setElevation } from './elevation.js';
import { PathPreview } from './paths.js';
import { mulberry32, fbm } from '../core/rng.js';
import { detailTextures, radialTexture } from './textures.js';
import { triplanar, pbr } from '../core/materials.js';
import { Mist, lightShaft } from './atmosphere.js';
import { planClutter, buildClutter, CLUTTER } from './clutter.js';

let shared = null;
function getShared() {
  if (shared) return shared;
  const detail = detailTextures();
  shared = {
    detail,
    glow: radialTexture(),
    beamAlpha: (() => {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 128, 0, 0);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.3, '#888');
      grad.addColorStop(1, '#000');
      g.fillStyle = grad;
      g.fillRect(0, 0, 4, 128);
      return new THREE.CanvasTexture(c);
    })(),
  };
  return shared;
}

// Lumpy low-poly rock
// Merge duplicated vertices so the rock can have smooth normals
function mergeVerts(g) {
  const pos = g.attributes.position;
  const map = new Map();
  const verts = [];
  const index = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = map.get(k);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(k, id);
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    index.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  return out;
}

// Natural-looking boulder: lumpy base shape + sharper ridges + a flat-ish bottom
export function rockGeometry(seed, detail = 3, squash = 0.85) {
  const g = mergeVerts(new THREE.IcosahedronGeometry(1, detail));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = fbm(v.x * 1.1 + seed * 3.1, v.z * 1.1 + v.y * 0.7, seed, 4);
    const b = fbm(v.y * 1.3 + seed, v.x * 1.3 - v.z * 0.6, seed + 5, 4);
    const ridge = 1 - Math.abs(fbm(v.x * 2.6 + seed, v.y * 2.6 + v.z * 1.9, seed + 9, 3) * 2 - 1);
    v.multiplyScalar(0.62 + a * 0.45 + b * 0.25 + ridge * 0.12);
    v.y *= squash;
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25; // flatten underside
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;
const skyFrag = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir; uniform float night;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.65, h), 0.65)) : mix(horizon, bottom, smoothstep(0.0, -0.2, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.18 + pow(s, 3.0) * 0.06) * (1.0 - night * 0.55);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const gridVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const gridFrag = /* glsl */ `
uniform vec3 center; uniform float opacity; uniform vec2 halfSize;
varying vec3 vW;
void main() {
  vec2 p = (vW.xz + halfSize) / 2.0;
  vec2 f = fract(p);
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 2.0;
  float line = 1.0 - smoothstep(0.03, 0.08, d);
  float fade = 1.0 - smoothstep(3.0, 13.0, distance(vW.xz, center.xz));
  gl_FragColor = vec4(0.24, 0.88, 1.0, line * fade * opacity * 0.7);
}`;

const shieldVert = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const shieldFrag = /* glsl */ `
uniform float strength; uniform vec3 color; uniform float time;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
  float bands = 0.5 + 0.5 * sin(vN.y * 30.0 + time * 4.0);
  gl_FragColor = vec4(color * (f * 1.6 + bands * 0.15) * strength, 1.0);
}`;


export class World {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.theme = map.theme;
    this.group = new THREE.Group();
    this.scene = game.r.scene;
    this.scene.add(this.group);
    this.rng = mulberry32(map.id.length * 977 + map.halfX * 13);
    this.animated = [];
    this.raycastables = [];
    this.night = 0;
    this.nightTarget = 0;

    // high ground (plateaus / ramps); flat maps get a zero height everywhere
    this.elev = new Elevation(map);
    setElevation(this.elev);

    this.nav = new NavGrid(map);
    map.layout(this.nav.builder(), this.rng);
    // keep spawn points free
    const b = this.nav.builder();
    b.clear(map.core[0], map.core[1], 7);
    b.clear(map.spawn[0], map.spawn[1], 2.5);
    for (const [x, z] of map.hives) b.clear(x, z, 6);
    this.markCliffs();
    this.clutterPlan = planClutter(this);
    this.coreRadius = 3.3;
    this.nav.computeFlow(map.core[0], map.core[1], this.coreRadius);
    this.ensureReachable();
    this.fillPockets();

    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildObstacles();
    if (this.theme.cave) this.buildCave();
    this.buildProps();
    this.clutter = buildClutter(this, this.clutterPlan);
    this.buildPools();
    this.buildPits();
    if (this.map.dressing) this.buildDressing();
    this.buildCore();
    this.buildHives();
    this.paths = new PathPreview(this);
    this.buildParticles();
    this.buildGridOverlay();
    this.buildAtmosphere();
    this.applyNight(0);
  }

  // Height of every grid cell, and cells that straddle a cliff edge become CLIFF:
  // nothing can be built there and the swarm's paths avoid them.
  markCliffs() {
    const nav = this.nav;
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      const k = nav.idx(i, j);
      const x = nav.cx(i), z = nav.cz(j);
      nav.h[k] = this.elev.at(x, z);
      if (this.elev.flat) continue;
      if (nav.blocked[k] === CLIFF || nav.blocked[k] === PIT) nav.blocked[k] = 0;
      if (nav.blocked[k]) continue;
      if (nav.h[k] < -2) { nav.blocked[k] = PIT; nav.pool[k] = 0; } // chasm
      else if (this.elev.span(x, z, 0.9) > 1.25) { nav.blocked[k] = CLIFF; nav.pool[k] = 0; }
    }
  }

  // Make sure every hive can reach the core; carve a path if not
  ensureReachable() {
    const nav = this.nav;
    for (const [hx, hz] of this.map.hives) {
      const k = nav.idx(nav.ci(hx), nav.cj(hz));
      if (isFinite(nav.dist[k])) continue;
      const [cx, cz] = this.map.core;
      const steps = Math.ceil(Math.hypot(cx - hx, cz - hz));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        nav.builder().clear(hx + (cx - hx) * t, hz + (cz - hz) * t, 1.6);
      }
      this.markCliffs();
      nav.computeFlow(cx, cz, this.coreRadius);
      if (!isFinite(nav.dist[k])) console.warn(`Hive at ${hx},${hz} cannot reach the core`);
    }
  }

  // Any open area the swarm can't reach becomes rock, so nothing can get stuck there
  fillPockets() {
    const nav = this.nav;
    let filled = 0;
    for (let k = 0; k < nav.dist.length; k++) {
      // unreachable: rock on flat maps, plain (rock-free) high ground on canyon maps
      if (!nav.blocked[k] && !isFinite(nav.dist[k])) { nav.blocked[k] = nav.h[k] > 1.5 ? VOID : 1; nav.pool[k] = 0; filled++; }
    }
    if (filled) nav.computeFlow(this.map.core[0], this.map.core[1], this.coreRadius);
  }

  color(hex) { return new THREE.Color(hex); }

  // ---------------------------------------------------------------- sky
  buildSky() {
    const t = this.theme;
    this.skyUniforms = {
      top: { value: this.color(t.day.top) },
      horizon: { value: this.color(t.day.horizon) },
      bottom: { value: this.color(t.day.bottom) },
      sunColor: { value: this.color(t.day.sun) },
      sunDir: { value: new THREE.Vector3(...t.sunDir).normalize() },
      night: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
    this.sky = sky;

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    const cols = [];
    const rng = mulberry32(42);
    for (let i = 0; i < 2500; i++) {
      const v = new THREE.Vector3(rng() * 2 - 1, rng() * 1.1 - 0.1, rng() * 2 - 1).normalize().multiplyScalar(700);
      pts.push(v.x, v.y, v.z);
      const w = 0.6 + rng() * 0.4;
      cols.push(w, w, w + rng() * 0.2);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    this.group.add(stars);

    // Planet / moon
    const p = t.planet;
    const planetCanvas = document.createElement('canvas');
    planetCanvas.width = 256; planetCanvas.height = 128;
    const g = planetCanvas.getContext('2d');
    const base = new THREE.Color(p.color);
    for (let y = 0; y < 128; y++) {
      const band = fbm(0, y * 0.08, 3, 3);
      const c = base.clone().multiplyScalar(0.75 + band * 0.4);
      g.fillStyle = `#${c.getHexString()}`;
      g.fillRect(0, y, 256, 1);
    }
    const ptex = new THREE.CanvasTexture(planetCanvas);
    ptex.colorSpace = THREE.SRGBColorSpace;
    this.planetMat = new THREE.MeshBasicMaterial({ map: ptex, fog: false });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(p.size, 48, 24), this.planetMat);
    planet.position.set(...p.pos);
    planet.rotation.set(0.3, 0, 0.4);
    planet.renderOrder = -8;
    this.group.add(planet);
    if (p.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(p.size * 1.35, p.size * 1.9, 96),
        new THREE.MeshBasicMaterial({ color: p.color, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false })
      );
      ring.position.copy(planet.position);
      ring.rotation.set(1.25, 0.25, 0.35);
      ring.renderOrder = -7;
      this.group.add(ring);
    }
    this.planet = planet;

    this.scene.fog = new THREE.Fog(this.color(t.day.fog), t.fogNear, t.fogFar);
  }

  buildLights() {
    const t = this.theme;
    this.hemi = new THREE.HemisphereLight(this.color(t.day.horizon), this.color(t.ground[1]), t.day.hemi);
    this.group.add(this.hemi);
    const sun = new THREE.DirectionalLight(this.color(t.day.sun), t.day.sunI);
    const dir = new THREE.Vector3(...t.sunDir).normalize();
    sun.position.copy(dir).multiplyScalar(120);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const ext = Math.max(this.map.halfX, this.map.halfZ) + 12;
    const sc = sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.near = 20; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.mapSize.set(2048, 2048);
    this.group.add(sun, sun.target);
    this.sun = sun;
  }

  // ---------------------------------------------------------------- terrain
  terrainHeight(x, z) {
    const { halfX, halfZ } = this.map;
    const ox = Math.max(Math.abs(x) - halfX, 0);
    const oz = Math.max(Math.abs(z) - halfZ, 0);
    const out = Math.hypot(ox, oz);
    const e = this.elev.flat ? 0 : this.elev.at(Math.max(-halfX, Math.min(halfX, x)), Math.max(-halfZ, Math.min(halfZ, z)));
    if (out <= 0) return e;
    return e + this.outerHeight(x, z, out);
  }

  // distance along a ray to the ground, or Infinity
  rayGround(o, d, maxD = 160) {
    let prev = 0;
    for (let t = 0.4; t <= maxD; t += t < 30 ? 0.4 : 1.2) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (o.y + d.y * t <= this.terrainHeight(x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m <= this.terrainHeight(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m;
        }
        return b;
      }
      prev = t;
    }
    return Infinity;
  }

  outerHeight(x, z, out) {
    const t = THREE.MathUtils.smoothstep(out, 0, 9);
    const ch = this.theme.cliffHeight || 1;
    const n = fbm(x * 0.035, z * 0.035, 4, 4);
    if (out <= 0) return 0;
    const ridge = 1 - Math.abs(fbm(x * 0.07, z * 0.07, 9, 3) * 2 - 1);
    return t * (3 + n * 16 * ch + ridge * 6 * ch) + Math.max(0, out - 9) * 0.35 * ch;
  }

  buildTerrain() {
    const { halfX, halfZ } = this.map;
    const t = this.theme;
    const ext = 110;
    const W = (halfX + ext) * 2;
    const D = (halfZ + ext) * 2;
    const sx = Math.min(260, Math.round(W / 1.5));
    const sz = Math.min(260, Math.round(D / 1.5));
    const nav = this.nav;
    const hilly = !this.elev.flat;
    const c = new THREE.Color();
    const colorAt = (x, z) => {
      // large-scale brightness variation hides texture tiling
      const n1 = fbm(x * 0.03, z * 0.03, 2, 4);
      const n2 = fbm(x * 0.11, z * 0.11, 5, 3);
      c.setScalar(0.78 + n1 * 0.35 + (n2 - 0.5) * 0.12);
      // darker ground around obstacles and pools
      const ci = nav.ci(x), cj = nav.cj(z);
      if (nav.inside(ci, cj)) {
        const k = nav.idx(ci, cj);
        if (nav.blocked[k] && nav.blocked[k] !== CLUTTER && nav.blocked[k] !== CLIFF) c.multiplyScalar(0.8);
        if (nav.pool[k]) c.multiplyScalar(0.55);
      }
      // scorched ring around core
      const dc = Math.hypot(x - this.map.core[0], z - this.map.core[1]);
      if (dc < 7) c.multiplyScalar(0.75 + (dc / 7) * 0.25);
      return c;
    };
    const M = t.materials;
    const mat = triplanar({
      top: M.ground, side: M.cliffSide || 'cliff', topScale: 1 / 5, sideScale: 1 / 9, vertexColors: true,
      topTint: M.groundTint, sideTint: M.cliffTint, normalStrength: 1.2,
    });

    // outer terrain (and the whole floor on flat maps)
    const geo = new THREE.PlaneGeometry(W, D, sx, sz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let h = this.terrainHeight(x, z);
      // on hilly maps the arena has its own detailed mesh; tuck this one underneath
      if (hilly && Math.abs(x) < halfX - 0.6 && Math.abs(z) < halfZ - 0.6) h = Math.min(h, this.elev.at(x, z)) - 0.8;
      pos.setY(i, h);
      colorAt(x, z);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrain = mesh;
    // (the terrain is not ray-cast as a mesh: rayGround() marches the height function instead,
    // which is far cheaper than testing 100k+ triangles per shot)

    if (hilly) {
      // detailed 0.5 m mesh for the arena so cliffs are crisp
      const ig = new THREE.PlaneGeometry(halfX * 2, halfZ * 2, halfX * 4, halfZ * 4);
      ig.rotateX(-Math.PI / 2);
      const ip = ig.attributes.position;
      for (let i = 0; i < ip.count; i++) ip.setY(i, this.elev.at(ip.getX(i), ip.getZ(i)));
      ig.computeVertexNormals();
      const nor = ig.attributes.normal;
      const icol = new Float32Array(ip.count * 3);
      for (let i = 0; i < ip.count; i++) {
        colorAt(ip.getX(i), ip.getZ(i));
        // cliff faces a little darker, with dark streaks
        const steep = 1 - THREE.MathUtils.smoothstep(nor.getY(i), 0.45, 0.85);
        if (steep > 0) c.multiplyScalar(1 - steep * (0.25 + fbm(ip.getX(i) * 0.6, ip.getY(i) * 0.9 + ip.getZ(i) * 0.6, 8, 2) * 0.25));
        icol[i * 3] = c.r; icol[i * 3 + 1] = c.g; icol[i * 3 + 2] = c.b;
      }
      ig.setAttribute('color', new THREE.BufferAttribute(icol, 3));
      const inner = new THREE.Mesh(ig, mat);
      inner.receiveShadow = true;
      inner.castShadow = true;
      inner.name = 'terrain-arena';
      this.group.add(inner);
      this.terrainInner = inner;
    }
  }

  // ---------------------------------------------------------------- obstacles
  freeCells(filter) {
    const nav = this.nav;
    const out = [];
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      const k = nav.idx(i, j);
      if (filter(k, i, j)) out.push([i, j, k]);
    }
    return out;
  }

  instanced(geo, mat, list, { shadow = true, receive = true, colors = null } = {}) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    if (colors) colors.forEach((cc, i) => m.setColorAt(i, cc));
    m.castShadow = shadow;
    m.receiveShadow = receive;
    m.instanceMatrix.needsUpdate = true;
    this.group.add(m);
    return m;
  }

  buildObstacles() {
    const before = this.group.children.length;
    this.buildObstacleMeshes();
    for (const m of this.group.children.slice(before)) if (m.isInstancedMesh) this.raycastables.push(m);
  }

  buildObstacleMeshes() {
    const nav = this.nav;
    const t = this.theme;
    const rng = this.rng;
    const style = t.obstacleStyle;
    const dummy = new THREE.Object3D();
    const elev = this.elev;
    const mk = (x, y, z, sx, sy, sz, ry = rng() * Math.PI * 2, rx = 0, rz = 0) => {
      dummy.position.set(x, y + elev.at(x, z), z);
      dummy.rotation.set(rx, ry, rz);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    };
    const tint = (base, v) => new THREE.Color(base).multiplyScalar(v);

    const rocks = [[], [], []];
    const rockColors = [[], [], []];
    const debris = [];
    const ribs = [];
    const glowBits = [];
    const spires = [];
    const spireColors = [];
    const stems = [];
    const caps = [];
    const capGlow = [];

    const cells = this.freeCells((k) => nav.blocked[k] !== 0);
    for (const [i, j, k] of cells) {
      const x = nav.cx(i) + (rng() - 0.5) * 0.5;
      const z = nav.cz(j) + (rng() - 0.5) * 0.5;
      const hn = fbm(x * 0.12, z * 0.12, 21, 2);
      const type = nav.blocked[k];
      if (type === CLUTTER || type === PIT || type === VOID) continue;
      if (type === CLIFF) {
        // loose boulders piled at the foot of cliffs
        if (rng() < 0.45) {
          let lx = x, lz = z, lo = Infinity;
          for (let q = 0; q < 6; q++) {
            const a = (q / 6) * Math.PI * 2;
            const px = x + Math.cos(a) * 0.9, pz = z + Math.sin(a) * 0.9;
            const h = elev.at(px, pz);
            if (h < lo) { lo = h; lx = px; lz = pz; }
          }
          const v = (rng() * 3) | 0;
          const s = 0.5 + rng() * 0.5;
          rocks[v].push(mk(lx, s * 0.2, lz, s, s * (0.6 + rng() * 0.5), s));
          rockColors[v].push(new THREE.Color().setScalar(0.75 + rng() * 0.3));
        }
        continue;
      }
      if (type === 2) {
        // ship debris: bent hull plates and ribs
        debris.push(mk(x, 0.6 + rng() * 0.8, z, 2.3, 0.9 + rng() * 1.8, 1.0 + rng() * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.6));
        if (rng() < 0.5) ribs.push(mk(x + (rng() - 0.5), 1.6, z + (rng() - 0.5), 0.25, 3 + rng() * 2.5, 0.35, rng() * Math.PI, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8));
        if (rng() < 0.25) glowBits.push(mk(x, 0.4 + rng(), z, 0.5, 0.12, 0.35, rng() * Math.PI, rng(), rng()));
        continue;
      }
      if (style === 'rock' || style === 'fungus') {
        const v = (rng() * 3) | 0;
        const s = 1.35 + rng() * 0.45;
        const h = style === 'fungus' ? 0.9 + rng() * 0.6 : 1.0 + hn * 2.2 + rng() * 0.6;
        rocks[v].push(mk(x, h * 0.25, z, s, h, s));
        rockColors[v].push(new THREE.Color().setScalar(0.8 + rng() * 0.35));
        if (style === 'fungus' && rng() < 0.4) {
          const sh = 3 + rng() * 5;
          stems.push(mk(x, sh / 2, z, 0.45 + rng() * 0.25, sh, 0.45 + rng() * 0.25, 0, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2));
          const cr = 1.8 + rng() * 1.8;
          caps.push(mk(x, sh, z, cr, cr * 0.45, cr, rng() * 6));
          capGlow.push(mk(x, sh - 0.05, z, cr * 0.85, 0.1, cr * 0.85, 0));
        }
      } else if (style === 'mesa') {
        const v = (rng() * 3) | 0;
        const s = 1.4 + rng() * 0.4;
        const h = 2.5 + hn * 6 + rng() * 2;
        rocks[v].push(mk(x, h * 0.4, z, s, h, s));
        rockColors[v].push(new THREE.Color().setScalar(0.8 + rng() * 0.35));
      } else if (style === 'ice') {
        const v = (rng() * 3) | 0;
        rocks[v].push(mk(x, 0.2, z, 1.4, 0.7 + rng() * 0.5, 1.4));
        rockColors[v].push(new THREE.Color().setScalar(0.85 + rng() * 0.25));
        const n = 1 + ((rng() * 2.2) | 0);
        for (let s = 0; s < n; s++) {
          const h = 2 + hn * 5 + rng() * 3;
          spires.push(mk(x + (rng() - 0.5) * 1.2, h / 2 - 0.3, z + (rng() - 0.5) * 1.2, 0.5 + rng() * 0.5, h, 0.5 + rng() * 0.5, rng() * 6, (rng() - 0.5) * 0.35, (rng() - 0.5) * 0.35));
          spireColors.push(tint(t.rock, 0.85 + rng() * 0.3));
        }
      }
    }

    const M = t.materials;
    const rockMat = triplanar({
      top: M.rockTop, side: M.rockSide, topScale: 1 / 3, sideScale: 1 / 3.5,
      topTint: M.rockTopTint, sideTint: M.rockTint, normalStrength: 1.4,
    });
    for (let v = 0; v < 3; v++) {
      this.instanced(rockGeometry(v * 7 + 3, 3, style === 'mesa' ? 0.9 : 0.85), rockMat, rocks[v], { colors: rockColors[v] });
    }
    if (debris.length) {
      const hull = pbr('rust', { color: '#b8b0a8' });
      this.instanced(new THREE.BoxGeometry(1, 1, 1), hull, debris);
      this.instanced(new THREE.BoxGeometry(1, 1, 1), pbr('metal', { color: '#6a6e76' }), ribs);
      this.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff6a1d', emissiveIntensity: 2.2 }), glowBits, { shadow: false });
    }
    if (spires.length) {
      const iceMat = new THREE.MeshPhysicalMaterial({
        color: '#ffffff', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
        emissive: '#1a7ad8', emissiveIntensity: 0.22, flatShading: true,
      });
      const geo = new THREE.ConeGeometry(1, 1, 5, 1);
      this.instanced(geo, iceMat, spires, { colors: spireColors });
    }
    if (stems.length) {
      const stemMat = new THREE.MeshStandardMaterial({ color: '#c9b8a8', roughness: 0.7 });
      this.instanced(new THREE.CylinderGeometry(0.7, 1, 1, 8), stemMat, stems);
      const capMat = new THREE.MeshStandardMaterial({ color: '#7a3a8f', roughness: 0.5, emissive: '#3a0a4a', emissiveIntensity: 0.4 });
      this.instanced(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat, caps);
      this.instanced(new THREE.CircleGeometry(1, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#b6ff3d', emissive: '#9aff2d', emissiveIntensity: 1.6, side: THREE.DoubleSide }), capGlow, { shadow: false });
    }
  }

  // ---------------------------------------------------------------- cave (ceiling, pillars, tunnels)
  buildCave() {
    const C = this.theme.cave;
    const M = this.theme.materials;
    const H = C.height;
    const { halfX, halfZ } = this.map;
    const rng = mulberry32(4242);
    const rockMat = triplanar({
      top: M.rockSide, side: M.rockSide, topScale: 1 / 4, sideScale: 1 / 4.5,
      topTint: M.rockTint, sideTint: M.rockTint, normalStrength: 1.5,
    });
    const holeR = (x, z, h) => h[2] * (0.85 + fbm(x * 0.3, z * 0.3, 77, 2) * 0.4);
    const ceilY = (x, z) => {
      let y = H + fbm(x * 0.045, z * 0.045, 61, 4) * 7 - 2.5 + (1 - Math.abs(fbm(x * 0.09, z * 0.09, 62, 3) * 2 - 1)) * 2.2;
      for (const h of C.holes) {
        const d = Math.hypot(x - h[0], z - h[1]);
        y += Math.max(0, 1 - d / (h[2] * 2.6)) * 4.5; // funnel up into the hole
      }
      return y;
    };
    this.ceilY = ceilY;
    // ---- ceiling with real holes (the sun shines and casts shadows through them)
    const W = (halfX + 60) * 2, D = (halfZ + 60) * 2;
    const seg = 150;
    const plane = new THREE.PlaneGeometry(W, D, seg, seg);
    plane.rotateX(Math.PI / 2); // normals face down
    const pos = plane.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, ceilY(pos.getX(i), pos.getZ(i)));
    const idx = plane.index.array;
    const keep = [];
    const tmp = new THREE.Vector3();
    for (let f = 0; f < idx.length; f += 3) {
      tmp.set(0, 0, 0);
      for (let k = 0; k < 3; k++) tmp.x += pos.getX(idx[f + k]) / 3, tmp.z += pos.getZ(idx[f + k]) / 3;
      let hole = false;
      for (const h of C.holes) if (Math.hypot(tmp.x - h[0], tmp.z - h[1]) < holeR(tmp.x, tmp.z, h)) { hole = true; break; }
      if (!hole) keep.push(idx[f], idx[f + 1], idx[f + 2]);
    }
    plane.setIndex(keep);
    plane.computeVertexNormals();
    const ceiling = new THREE.Mesh(plane, rockMat);
    ceiling.castShadow = true;
    ceiling.receiveShadow = true;
    ceiling.name = 'ceiling';
    this.group.add(ceiling);
    this.raycastables.push(ceiling);
    // thick rims around each hole so the opening has depth
    for (const h of C.holes) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(h[2] * 1.05, h[2] * 1.25, 5, 20, 3, true), rockMat);
      const rp = rim.geometry.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), z = rp.getZ(i), y = rp.getY(i);
        const n = 0.85 + fbm(x * 0.6 + h[0], z * 0.6 + y * 0.4, 9, 3) * 0.35;
        rp.setXYZ(i, x * n, y, z * n);
      }
      rim.geometry.computeVertexNormals();
      rim.material = rockMat;
      rim.position.set(h[0], ceilY(h[0], h[1]) + 0.5, h[1]);
      rim.castShadow = true;
      rim.receiveShadow = true;
      this.group.add(rim);
    }
    // ---- pillars from floor to ceiling
    for (const [x, z, r] of C.pillars) {
      const top = ceilY(x, z) + 3;
      const g = new THREE.CylinderGeometry(r, r, top + 2, 18, 18, true);
      const gp = g.attributes.position;
      for (let i = 0; i < gp.count; i++) {
        const px = gp.getX(i), py = gp.getY(i), pz = gp.getZ(i);
        const t = (py + (top + 2) / 2) / (top + 2); // 0 bottom .. 1 top
        const flare = 1 + Math.pow(Math.abs(t - 0.45) * 1.9, 2.4) * 0.9; // thin waist, wide foot and head
        const n = 0.75 + fbm(px * 0.35 + x, py * 0.12 + pz * 0.35, 13, 4) * 0.55;
        gp.setXYZ(i, px * flare * n, py, pz * flare * n);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rockMat);
      m.position.set(x, (top + 2) / 2 - 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.raycastables.push(m);
    }
    // ---- stalactites
    const dummy = new THREE.Object3D();
    const stal = [];
    for (let n = 0; n < 420 && stal.length < 170; n++) {
      const x = (rng() * 2 - 1) * (halfX + 8), z = (rng() * 2 - 1) * (halfZ + 8);
      if (C.holes.some((h) => Math.hypot(x - h[0], z - h[1]) < h[2] * 1.6)) continue;
      const len = 1 + rng() * rng() * 6;
      const w = 0.25 + rng() * 0.5 + len * 0.06;
      dummy.position.set(x, ceilY(x, z) - len / 2 + 0.4, z);
      dummy.rotation.set((rng() - 0.5) * 0.2, rng() * 6, Math.PI + (rng() - 0.5) * 0.2);
      dummy.scale.set(w, len, w);
      dummy.updateMatrix();
      stal.push(dummy.matrix.clone());
    }
    const sg = new THREE.ConeGeometry(1, 1, 7, 4);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      const n = 0.8 + fbm(x * 3, y * 3 + z * 3, 5, 2) * 0.4;
      sp.setXYZ(i, x * n, y, z * n);
    }
    sg.computeVertexNormals();
    this.instanced(sg, rockMat, stal, { shadow: true });
    // ---- light shafts through the holes
    const sd = new THREE.Vector3(...this.theme.sunDir).normalize();
    const shafts = this.theme.atmosphere.shafts = [];
    for (const h of C.holes) {
      const y0 = ceilY(h[0], h[1]) + 3;
      const k = y0 / sd.y;
      shafts.push({ from: [h[0] + sd.x * 2, y0, h[1] + sd.z * 2], to: [h[0] - sd.x * k, 0, h[1] - sd.z * k], r0: h[2] * 0.95, r1: h[2] * 1.3, color: '#ffe6bf', opacity: 0.16 });
    }
    // ---- tunnel mouths behind the hives
    const [cx, cz] = this.map.core;
    const tunnelMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#2a0a3a', emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 1 });
    for (const [hx, hz] of this.map.hives) {
      const dx = hx - cx, dz = hz - cz;
      const d = Math.hypot(dx, dz);
      const ux = dx / d, uz = dz / d;
      // walk outwards until we hit the wall
      let t = 0;
      while (t < 30 && this.terrainHeight(hx + ux * t, hz + uz * t) < 1.5) t += 0.5;
      const px = hx + ux * (t + 1.5), pz = hz + uz * (t + 1.5);
      const g = new THREE.Group();
      g.position.set(px, this.terrainHeight(px, pz) * 0.3, pz);
      g.rotation.y = Math.atan2(-ux, -uz);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24, 0, Math.PI), tunnelMat);
      mouth.scale.set(1, 1.15, 1);
      mouth.position.z = 0.4;
      g.add(mouth);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 14, 20, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: '#0b0a10', side: THREE.BackSide, roughness: 1 }));
      tube.rotation.x = Math.PI / 2;
      tube.position.z = -6.6;
      tube.scale.set(1, 1, 1.15);
      g.add(tube);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(5.8, 1.1, 8, 24, Math.PI), rockMat);
      arch.scale.set(1, 1.15, 1);
      arch.castShadow = true;
      g.add(arch);
      this.group.add(g);
    }
    // ---- catwalk ring hanging above the core
    const steel = pbr('metal', { color: '#8a929c' });
    const grate = pbr('milmetal', { color: '#7a8270', metalness: 0.7 });
    const cw = new THREE.Group();
    cw.position.set(cx, 7.2, cz);
    const ringR = 7.2;
    const deck = new THREE.Mesh(new THREE.RingGeometry(ringR - 0.7, ringR + 0.7, 48, 1).rotateX(-Math.PI / 2), grate);
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.material.side = THREE.DoubleSide;
    cw.add(deck);
    for (const rr of [ringR - 0.7, ringR + 0.7]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.04, 6, 64).rotateX(Math.PI / 2), steel);
      rail.position.y = 1.0;
      cw.add(rail);
      const edge = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.07, 4, 64).rotateX(Math.PI / 2), steel);
      cw.add(edge);
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const rr of [ringR - 0.7, ringR + 0.7]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), steel);
        post.position.set(Math.cos(a) * rr, 0.5, Math.sin(a) * rr);
        cw.add(post);
      }
    }
    // rods up into the rock
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
      const top = ceilY(cx + x, cz + z) - 7.2 + 1;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top, 6), steel);
      rod.position.set(x, top / 2, z);
      rod.castShadow = true;
      cw.add(rod);
    }
    // work lamps under the catwalk
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd9a0', emissiveIntensity: 3 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.25, 12), lampMat);
      lamp.position.set(Math.cos(a) * ringR, -0.2, Math.sin(a) * ringR);
      cw.add(lamp);
    }
    this.group.add(cw);
    // ---- cables hanging between points of the ceiling
    const cableMat = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.6 });
    for (let n = 0; n < 16; n++) {
      const a = rng() * Math.PI * 2;
      const r = 4 + rng() * 30;
      const x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r;
      const b = a + (rng() - 0.5) * 1.5;
      const L = 6 + rng() * 12;
      const x1 = x0 + Math.cos(b) * L, z1 = z0 + Math.sin(b) * L;
      const y0 = ceilY(x0, z0) + 0.6, y1 = ceilY(x1, z1) + 0.6; // ends disappear into the rock
      const sag = 2 + rng() * 4;
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag, z0 + (z1 - z0) * t));
      }
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05 + rng() * 0.04, 5), cableMat);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  // ---------------------------------------------------------------- props (decoration)
  buildProps() {
    const nav = this.nav;
    const t = this.theme;
    const rng = mulberry32(777 + this.map.halfZ);
    const dummy = new THREE.Object3D();
    const [cx, cz] = this.map.core;
    const ok = (x, z) => {
      const i = nav.ci(x), j = nav.cj(z);
      if (!nav.inside(i, j)) return true; // outside the arena is fine for decoration
      const k = nav.idx(i, j);
      if (nav.blocked[k] || nav.pool[k]) return false;
      if (Math.hypot(x - cx, z - cz) < 7) return false;
      for (const [hx, hz] of this.map.hives) if (Math.hypot(x - hx, z - hz) < 6) return false;
      return true;
    };
    const { halfX, halfZ } = this.map;
    const sample = (margin = 0) => [(rng() * 2 - 1) * (halfX + margin), (rng() * 2 - 1) * (halfZ + margin)];

    // Pebbles
    const pebbles = [];
    const pcol = [];
    for (let n = 0; n < 380; n++) {
      const [x, z] = sample(6);
      if (!ok(x, z)) continue;
      const s = 0.12 + rng() * 0.35;
      dummy.position.set(x, this.terrainHeight(x, z) + s * 0.2, z);
      dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      dummy.scale.set(s, s * 0.7, s);
      dummy.updateMatrix();
      pebbles.push(dummy.matrix.clone());
      pcol.push(new THREE.Color().setScalar(0.7 + rng() * 0.45));
    }
    this.instanced(rockGeometry(31, 1), triplanar({ top: t.materials.rockSide, topScale: 2, sideScale: 2, sideTint: t.materials.rockTint, topTint: t.materials.rockTint }), pebbles, { shadow: false, colors: pcol });

    // Grass / reeds / shards
    const blades = [];
    const bcol = [];
    const grassCol = {
      crystal: ['#9a6a5a', '#7a4f62'], ember: ['#6a3a2a', '#8a4a2a'],
      icecrystal: ['#cfe8ff', '#9fd0ff'], glowplant: ['#5d8a3a', '#7aa84a'],
    }[t.prop];
    for (let n = 0; n < 2600; n++) {
      const [x, z] = sample(4);
      if (!ok(x, z)) continue;
      if (fbm(x * 0.08, z * 0.08, 13, 2) < 0.45) continue; // clumps
      if (this.map.tightClutter && rng() < 0.6) continue;
      const h = 0.25 + rng() * 0.6;
      dummy.position.set(x, this.terrainHeight(x, z) + h / 2, z);
      dummy.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
      dummy.scale.set(0.05 + rng() * 0.04, h, 0.05 + rng() * 0.04);
      dummy.updateMatrix();
      blades.push(dummy.matrix.clone());
      bcol.push(new THREE.Color(grassCol[rng() < 0.5 ? 0 : 1]).multiplyScalar(0.8 + rng() * 0.4));
    }
    this.instanced(new THREE.ConeGeometry(1, 1, 3, 1), new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.8 }), blades, { shadow: false, colors: bcol });

    // Glowing feature props
    const glowMat = new THREE.MeshStandardMaterial({ color: t.propColor, emissive: t.propColor, emissiveIntensity: 1.8, roughness: 0.25 });
    const baseMat = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.6 });
    const glows = [];
    const bases = [];
    const bcolor = [];
    const count = t.prop === 'glowplant' ? 120 : 70;
    for (let n = 0; n < count * 3 && glows.length < count * 3; n++) {
      // prefer edges and near obstacles
      const [x, z] = rng() < 0.5 ? sample(10) : sample(-4);
      if (this.map.tightClutter) {
        // corridor maps: crystals grow on the rock above, not in the corridors you build in
        const i = nav.ci(x), j = nav.cj(z);
        if (nav.inside(i, j) && nav.blocked[nav.idx(i, j)] !== VOID) continue;
      } else if (!ok(x, z)) continue;
      const y = this.terrainHeight(x, z);
      if (t.prop === 'crystal' || t.prop === 'icecrystal') {
        const k = 2 + ((rng() * 3) | 0);
        for (let q = 0; q < k; q++) {
          const s = 0.15 + rng() * 0.3;
          const h = 0.6 + rng() * 1.6;
          dummy.position.set(x + (rng() - 0.5) * 0.8, y + h * 0.35, z + (rng() - 0.5) * 0.8);
          dummy.rotation.set((rng() - 0.5) * 0.9, rng() * 3, (rng() - 0.5) * 0.9);
          dummy.scale.set(s, h, s);
          dummy.updateMatrix();
          glows.push(dummy.matrix.clone());
        }
      } else if (t.prop === 'glowplant') {
        const h = 0.6 + rng() * 1.8;
        dummy.position.set(x, y + h / 2, z);
        dummy.rotation.set((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4);
        dummy.scale.set(0.05, h, 0.05);
        dummy.updateMatrix();
        bases.push(dummy.matrix.clone());
        bcolor.push(new THREE.Color('#4a6a2a'));
        const s = 0.12 + rng() * 0.18;
        dummy.position.set(x + Math.sin(dummy.rotation.z) * -h * 0.5, y + h, z + Math.sin(dummy.rotation.x) * h * 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s, s * 1.3, s);
        dummy.updateMatrix();
        glows.push(dummy.matrix.clone());
      } else {
        // ember rocks with glowing cracks
        const s = 0.3 + rng() * 0.5;
        dummy.position.set(x, y + s * 0.3, z);
        dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        dummy.scale.set(s, s * 0.6, s);
        dummy.updateMatrix();
        glows.push(dummy.matrix.clone());
      }
    }
    const glowGeo = t.prop === 'glowplant' ? new THREE.SphereGeometry(1, 10, 8) : t.prop === 'ember' ? rockGeometry(17, 0) : new THREE.OctahedronGeometry(1, 0).scale(1, 0.5, 1);
    this.instanced(glowGeo, glowMat, glows, { shadow: false });
    this.instanced(new THREE.CylinderGeometry(1, 1.4, 1, 5), baseMat, bases, { shadow: false, colors: bcolor });
    this.propGlowMat = glowMat;
  }

  // ---------------------------------------------------------------- acid pools
  buildPools() {
    const nav = this.nav;
    const list = [];
    const dummy = new THREE.Object3D();
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      if (!nav.pool[nav.idx(i, j)]) continue;
      dummy.position.set(nav.cx(i), this.elev.at(nav.cx(i), nav.cz(j)) + 0.04 + Math.random() * 0.01, nav.cz(j));
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1.55);
      dummy.updateMatrix();
      list.push(dummy.matrix.clone());
    }
    if (!list.length) return;
    this.poolMat = new THREE.MeshStandardMaterial({ color: '#3a7a10', emissive: '#7aff1d', emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.2 });
    const m = this.instanced(new THREE.CircleGeometry(1, 20), this.poolMat, list, { shadow: false });
    m.receiveShadow = false;
    this.poolCells = list.length;
  }

  // ---------------------------------------------------------------- chasms
  // glowing acid far down in every pit, so you can see where to throw aliens
  buildPits() {
    const nav = this.nav;
    const list = [];
    const dummy = new THREE.Object3D();
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      if (nav.blocked[nav.idx(i, j)] !== PIT) continue;
      dummy.position.set(nav.cx(i), nav.h[nav.idx(i, j)] + 1.2, nav.cz(j));
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(2.3);
      dummy.updateMatrix();
      list.push(dummy.matrix.clone());
    }
    if (!list.length) return;
    // deep down: a faint toxic glow far below, so the chasm reads as bottomless
    const mat = new THREE.MeshStandardMaterial({ color: '#06120a', emissive: '#3aff6a', emissiveIntensity: 0.35, roughness: 0.6, fog: false });
    const m = this.instanced(new THREE.PlaneGeometry(1, 1), mat, list, { shadow: false });
    m.receiveShadow = false;
    // a faint glow rising from the chasm
    for (let k = 0; k < Math.min(2, Math.ceil(list.length / 12)); k++) {
      const mx = list[Math.floor((k + 0.5) * list.length / Math.min(2, Math.ceil(list.length / 12)))];
      const p = new THREE.Vector3().setFromMatrixPosition(mx);
      const l = new THREE.PointLight('#7aff3a', 6, 12, 1.5);
      l.position.set(p.x, p.y + 1.5, p.z);
      this.group.add(l);
    }
  }

  // ---------------------------------------------------------------- station dressing
  // Corridor maps cut into the rock get an outpost look: pipes and lamps along the
  // straight walls, hazard stripes at chasm edges and lit door frames at the gates.
  buildDressing() {
    const nav = this.nav;
    const D = this.map.dressing;
    const dummy = new THREE.Object3D();
    const stripes = [];
    const at = (x, z) => this.elev.at(x, z);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const put = (list, x, y, z, ry, sx = 1, sy = 1, sz = 1) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      list.push(dummy.matrix.clone());
    };
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      const k = nav.idx(i, j);
      if (nav.blocked[k] || !isFinite(nav.dist[k])) continue;
      const x = nav.cx(i), z = nav.cz(j), h = nav.h[k];
      for (const [di, dj] of N4) {
        const ni = i + di, nj = j + dj;
        if (!nav.inside(ni, nj)) continue;
        const nb = nav.blocked[nav.idx(ni, nj)];
        // hazard stripes where the floor ends at a chasm
        if (nb === PIT) put(stripes, x + di * 0.86, h + 0.025, z + dj * 0.86, Math.atan2(di, dj));
      }
    }
    const dark = pbr('gunmetal', { color: '#40454c' });
    const glowMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: D.light || '#ffe2b0', emissiveIntensity: 2.6, toneMapped: false });
    // hazard stripes: yellow/black texture
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#16161a'; g2.fillRect(0, 0, 128, 16);
    g2.fillStyle = '#f2b51e';
    for (let x = -16; x < 128; x += 16) { g2.beginPath(); g2.moveTo(x, 16); g2.lineTo(x + 8, 16); g2.lineTo(x + 16, 0); g2.lineTo(x + 8, 0); g2.fill(); }
    const st = new THREE.CanvasTexture(c);
    st.colorSpace = THREE.SRGBColorSpace;
    st.anisotropy = 4;
    const stripeMat = new THREE.MeshStandardMaterial({ map: st, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    this.instanced(new THREE.PlaneGeometry(2, 0.26).rotateX(-Math.PI / 2), stripeMat, stripes, { shadow: false });

    // lit door frames at the gates
    const frame = [], frameGlow = [];
    for (const [x, z, axis, w] of this.map.gates || []) {
      const h = at(x, z);
      const ry = axis === 'x' ? Math.PI / 2 : 0; // 'x': aliens pass along x
      const ax = axis === 'x' ? 0 : 1, az = axis === 'x' ? 1 : 0; // across the gate
      for (const sgn of [-1, 1]) {
        put(frame, x + ax * sgn * (w / 2 + 0.15), h + 1.9, z + az * sgn * (w / 2 + 0.15), ry, 1, 1, 1);
        put(frameGlow, x + ax * sgn * (w / 2 - 0.02), h + 1.9, z + az * sgn * (w / 2 - 0.02), ry, 1, 1, 1);
      }
      put(frame, x, h + 3.95, z, ry + Math.PI / 2, 1, 1, (w + 0.9) / 0.5);
      const l = new THREE.PointLight(D.gateLight || '#ffb070', 5, 10, 1.6);
      l.position.set(x, h + 3.2, z);
      this.group.add(l);
    }
    this.instanced(new THREE.BoxGeometry(0.5, 3.8, 0.7), dark, frame.filter((_, i) => i % 3 !== 2), { shadow: true });
    this.instanced(new THREE.BoxGeometry(0.7, 0.5, 0.5), dark, frame.filter((_, i) => i % 3 === 2), { shadow: true });
    this.instanced(new THREE.BoxGeometry(0.06, 3.0, 0.12), glowMat, frameGlow, { shadow: false, receive: false });
  }

  // ---------------------------------------------------------------- core
  buildCore() {
    const g = new THREE.Group();
    const [cx, cz] = this.map.core;
    const coreY = this.elev.at(cx, cz);
    g.position.set(cx, coreY, cz);
    const dark = pbr('gunmetal', { color: '#4a4f58' });
    const metal = pbr('metal', { color: '#c4ccd6' });
    const mil = pbr('milmetal', { color: '#8a9480', metalness: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: '#b07aff', emissive: '#a35cff', emissiveIntensity: 2.2 });
    const cyan = new THREE.MeshStandardMaterial({ color: '#3de0ff', emissive: '#3de0ff', emissiveIntensity: 1.8 });
    const add = (geo, mat, x, y, z, shadow = true, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    // stepped mechanical base
    add(new THREE.CylinderGeometry(3.7, 4.1, 0.45, 8), dark, 0, 0.22, 0);
    add(new THREE.CylinderGeometry(3.15, 3.5, 0.4, 8), mil, 0, 0.65, 0);
    add(new THREE.TorusGeometry(3.32, 0.06, 4, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8), cyan, 0, 0.47, 0, false);
    add(new THREE.CylinderGeometry(1.7, 2.2, 0.7, 8), metal, 0, 1.15, 0);
    add(new THREE.CylinderGeometry(1.45, 1.55, 0.12, 8), glow, 0, 1.52, 0, false);
    // vents and small panels around the base
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const v = add(new THREE.BoxGeometry(0.9, 0.22, 0.12), dark, Math.cos(a) * 3.38, 0.66, Math.sin(a) * 3.38);
      v.rotation.y = -a + Math.PI / 2;
      if (i % 2 === 0) {
        const l = add(new THREE.BoxGeometry(0.14, 0.06, 0.04), i % 4 ? cyan : glow, Math.cos(a) * 3.46, 0.7, Math.sin(a) * 3.46, false);
        l.rotation.y = -a + Math.PI / 2;
      }
    }
    // hydraulic clamps that hold the crystal cluster
    const clampTips = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Group();
      arm.position.set(Math.cos(a) * 2.25, 0.85, Math.sin(a) * 2.25);
      arm.rotation.y = -a;
      g.add(arm);
      add(new THREE.BoxGeometry(0.7, 0.5, 0.7), dark, 0, 0.1, 0, true, arm);
      const up = add(new THREE.BoxGeometry(0.28, 2.6, 0.42), metal, -0.25, 1.45, 0, true, arm);
      up.rotation.z = 0.28;
      const top = add(new THREE.BoxGeometry(0.9, 0.24, 0.38), metal, -0.75, 2.75, 0, true, arm);
      top.rotation.z = -0.35;
      add(new THREE.BoxGeometry(0.12, 0.3, 0.44), glow, -1.18, 2.58, 0, false, arm);
      const piston = add(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8), pbr('metal', { color: '#e8ecf2' }), 0.18, 1.0, 0.0, true, arm);
      piston.rotation.z = -0.15;
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), dark, 0.25, 0.45, 0, true, arm);
      const tip = new THREE.Object3D();
      tip.position.set(-1.22, 2.58, 0);
      arm.add(tip);
      clampTips.push(tip);
    }
    // the crystal cluster
    const crystalGeo = (h, r) => new THREE.LatheGeometry([
      new THREE.Vector2(0, 0), new THREE.Vector2(r * 0.8, 0.02), new THREE.Vector2(r, h * 0.12), new THREE.Vector2(r * 0.92, h * 0.72), new THREE.Vector2(0, h),
    ], 6);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: '#9a6ad0', emissive: '#9a4dff', emissiveIntensity: 1.0, roughness: 0.25, metalness: 0, flatShading: true,
    });
    const innerMat = new THREE.MeshBasicMaterial({ color: '#d9a8ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const cluster = new THREE.Group();
    cluster.position.y = 1.5;
    g.add(cluster);
    const crystal = add(crystalGeo(3.6, 0.62), crystalMat, 0, 0, 0, false, cluster);
    const tips = [new THREE.Vector3(0, 3.6, 0)];
    const crng = mulberry32(99);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + crng() * 0.4;
      const h = 1.0 + crng() * 1.7;
      const r = 0.2 + crng() * 0.22;
      const tilt = 0.35 + crng() * 0.45;
      const c = add(crystalGeo(h, r), crystalMat, Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, false, cluster);
      c.rotation.set(Math.sin(a) * tilt, crng() * 3, -Math.cos(a) * tilt);
      c.updateMatrix();
      tips.push(new THREE.Vector3(0, h, 0).applyMatrix4(c.matrix));
    }
    // soft inner glow so the cluster reads as lit from inside
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getShared().glow, color: '#b26bff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(4.2, 5.2, 1);
    halo.position.y = 2.0;
    halo.userData.noAO = true;
    cluster.add(halo);
    add(new THREE.OctahedronGeometry(0.5, 0).scale(1, 2.2, 1), innerMat, 0, 1.5, 0, false, cluster);
    // floating rings
    const rings = [];
    for (let i = 0; i < 2; i++) rings.push(add(new THREE.TorusGeometry(1.9 + i * 0.4, 0.04, 6, 64), glow, 0, 3.6, 0, false));
    // energy beam into the sky
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#b07aff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
      alphaMap: getShared().beamAlpha, side: THREE.DoubleSide, fog: false,
    });
    const beamH = this.theme.beamHeight || 80;
    const beam = add(new THREE.CylinderGeometry(0.3, 0.7, beamH, 16, 1, true), beamMat, 0, beamH / 2 + 5, 0, false);
    beam.userData.noAO = true;
    // shield bubble
    this.shieldU = { strength: { value: 0.12 }, color: { value: new THREE.Color('#3de0ff') }, time: { value: 0 } };
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(4.6, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: shieldVert, fragmentShader: shieldFrag, uniforms: this.shieldU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    shield.position.y = 1.5;
    g.add(shield);
    // light sits above the core (not inside the crystal) to avoid extreme reflections
    const light = new THREE.PointLight('#a868ff', 25, 32, 1.5);
    light.position.y = 6.5;
    g.add(light);
    this.group.add(g);

    const hitMeshes = [];
    g.traverse((m) => { if (m.isMesh && m !== beam && m !== shield && m.material !== innerMat) hitMeshes.push(m); });
    this.core = {
      pos: new THREE.Vector3(cx, coreY, cz),
      radius: this.coreRadius,
      hp: 1500, maxHp: 1500,
      group: g, crystal, cluster, crystalMat, rings, beam, beamMat, light, shield, halo,
      tips, clampTips, arcT: 0.5,
      hitFlash: 0,
      hitMeshes,
    };
  }

  // ---------------------------------------------------------------- hives
  buildHives() {
    this.hives = this.map.hives.map(([x, z], idx) => {
      const g = new THREE.Group();
      const hy = this.elev.at(x, z);
      g.position.set(x, hy, z);
      const rng = mulberry32(idx * 31 + 7);
      const geo = new THREE.SphereGeometry(5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = geo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = fbm(v.x * 0.5 + idx, v.z * 0.5, 3, 3);
        const r = Math.hypot(v.x, v.z);
        // crater in the middle
        let y = v.y * 0.5 * (0.7 + n * 0.6);
        if (r < 2.2) y = 2.2 - (2.2 - r) * 1.2 + n * 0.3;
        p.setXYZ(i, v.x * (0.9 + n * 0.25), y, v.z * (0.9 + n * 0.25));
      }
      geo.computeVertexNormals();
      const moundMat = triplanar({ top: 'ground_marsh', side: 'rock', topScale: 1 / 3, sideScale: 1 / 3, topTint: '#7a4a8a', sideTint: '#5a3a68', normalStrength: 1.5, roughness: 0.7 });
      const mound = new THREE.Mesh(geo, moundMat);
      mound.castShadow = mound.receiveShadow = true;
      g.add(mound);
      const holeMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#c03dff', emissiveIntensity: 0.4 });
      const hole = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24).rotateX(-Math.PI / 2), holeMat);
      hole.position.y = 0.6;
      g.add(hole);
      const spikeMat = new THREE.MeshStandardMaterial({ color: '#24122a', roughness: 0.4, metalness: 0.2 });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rng() * 0.3;
        const h = 2.5 + rng() * 3;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.35, h, 6), spikeMat);
        sp.position.set(Math.cos(a) * 3.8, h * 0.35, Math.sin(a) * 3.8);
        sp.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
        sp.castShadow = true;
        g.add(sp);
      }
      const sacMat = new THREE.MeshStandardMaterial({ color: '#d58aff', emissive: '#b03dff', emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.92 });
      const sacs = [];
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rng() * 0.35, 16, 12), sacMat);
        s.position.set(Math.cos(a) * (2.6 + rng()), 1.6 + rng() * 0.6, Math.sin(a) * (2.6 + rng()));
        g.add(s);
        sacs.push({ m: s, ph: rng() * 6 });
      }
      const light = new THREE.PointLight('#b04dff', 0, 26, 1.6);
      light.position.y = 3;
      g.add(light);
      this.group.add(g);
      return { pos: new THREE.Vector3(x, hy, z), group: g, holeMat, sacMat, sacs, light, active: false };
    });
  }

  // ---------------------------------------------------------------- ambient particles
  buildParticles() {
    const type = this.theme.particles;
    const N = type === 'snow' ? 1400 : 600;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 25;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const cfg = {
      dust: { color: '#ffd8b0', size: 0.12, opacity: 0.5, fall: -0.05, drift: 1.2, add: false },
      embers: { color: '#ff8a3d', size: 0.12, opacity: 0.9, fall: -0.6, drift: 0.8, add: true },
      snow: { color: '#ffffff', size: 0.12, opacity: 0.9, fall: 1.4, drift: 0.9, add: false },
      spores: { color: '#c6ff5a', size: 0.14, opacity: 0.8, fall: -0.15, drift: 0.5, add: true },
    }[type];
    this.partCfg = cfg;
    const mat = new THREE.PointsMaterial({
      color: cfg.color, size: cfg.size, map: getShared().glow, transparent: true, opacity: cfg.opacity,
      depthWrite: false, blending: cfg.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.particles = pts;
  }

  buildGridOverlay() {
    const { halfX, halfZ } = this.map;
    this.gridU = { center: { value: new THREE.Vector3() }, opacity: { value: 0 }, halfSize: { value: new THREE.Vector2(halfX, halfZ) } };
    const geo = this.elev.flat ? new THREE.PlaneGeometry(halfX * 2, halfZ * 2) : new THREE.PlaneGeometry(halfX * 2, halfZ * 2, halfX * 2, halfZ * 2);
    geo.rotateX(-Math.PI / 2);
    if (!this.elev.flat) {
      // drape the build grid over the terrain
      const gp = geo.attributes.position;
      for (let i = 0; i < gp.count; i++) gp.setY(i, this.elev.at(gp.getX(i), gp.getZ(i)));
    }
    const m = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ vertexShader: gridVert, fragmentShader: gridFrag, uniforms: this.gridU, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    m.position.y = 0.05;
    m.renderOrder = 2;
    this.group.add(m);
    this.gridMesh = m;
  }

  showGrid(on, x = 0, z = 0) {
    this.gridTarget = on ? 1 : 0;
    if (on) this.gridU.center.value.set(x, 0, z);
  }

  // ---------------------------------------------------------------- atmosphere
  buildAtmosphere() {
    const t = this.theme;
    const { halfX, halfZ } = this.map;
    const a = t.atmosphere || {};
    this.mist = new Mist(this.group, {
      count: a.mistCount ?? 36, halfX: halfX + 10, halfZ: halfZ + 10,
      color: t.day.fog, opacity: a.mist ?? 0.14, height: a.mistHeight ?? 1.3, size: 15, rng: mulberry32(5),
    });
    this.shafts = [];
    if (this.clutter) for (const f of this.clutter.floods) this.shafts.push(f.shaft);
    for (const s of a.shafts || []) {
      const m = lightShaft(s);
      this.group.add(m);
      this.shafts.push(m);
    }
  }

  // ---------------------------------------------------------------- day / night
  applyNight(n) {
    const t = this.theme;
    const lerpC = (a, b, out) => out.copy(this.color(a)).lerp(this.color(b), n);
    const u = this.skyUniforms;
    lerpC(t.day.top, t.night.top, u.top.value);
    lerpC(t.day.horizon, t.night.horizon, u.horizon.value);
    lerpC(t.day.bottom, t.night.bottom, u.bottom.value);
    lerpC(t.day.sun, t.night.sun, u.sunColor.value);
    u.night.value = n;
    lerpC(t.day.fog, t.night.fog, this.scene.fog.color);
    lerpC(t.day.sun, t.night.sun, this.sun.color);
    this.sun.intensity = THREE.MathUtils.lerp(t.day.sunI, t.night.sunI, n);
    lerpC(t.day.horizon, t.night.horizon, this.hemi.color);
    this.hemi.intensity = THREE.MathUtils.lerp(t.day.hemi, t.night.hemi, n);
    this.starMat.opacity = n;
    this.planetMat.color.setScalar(1 - n * 0.35);
    this.game.r.scene.environmentIntensity = THREE.MathUtils.lerp(t.envIntensity ?? 0.35, (t.envIntensity ?? 0.35) * 0.5, n);
    if (this.mist) this.mist.setColor(this.scene.fog.color);
    if (this.clutter) for (const f of this.clutter.floods) {
      f.spot.intensity = THREE.MathUtils.lerp(35, 90, n);
      f.shaft.userData.shaftU.opacity.value = THREE.MathUtils.lerp(0.1, 0.32, n);
    }
    this.game.r.setGrade?.(this.theme.grade ? { ...this.theme.grade, lift: (this.theme.grade.lift || 0) + n * (this.theme.grade.nightLift ?? 0.015) } : null);
    this.game.r.renderer.toneMappingExposure = (t.exposure || 1) * THREE.MathUtils.lerp(1, 1.12, n);
    this.scene.fog.near = t.fogNear * THREE.MathUtils.lerp(1, 0.8, n);
  }

  update(dt, time) {
    const g = this.game;
    this.paths.update(dt, g.inGame && !g.over && g.phase === 'build', g.nextHives || []);
    if (Math.abs(this.night - this.nightTarget) > 0.001) {
      this.night += (this.nightTarget - this.night) * Math.min(1, dt * 0.7);
      this.applyNight(this.night);
    }
    const core = this.core;
    core.cluster.rotation.y += dt * 0.12;
    core.cluster.position.y = 1.5 + Math.sin(time * 1.1) * 0.06;
    core.rings[0].rotation.set(time * 0.6, time * 0.4, 0);
    core.rings[1].rotation.set(-time * 0.5, 0, time * 0.7);
    core.rings.forEach((r) => (r.position.y = 3.6 + Math.sin(time * 1.4) * 0.15));
    core.hitFlash = Math.max(0, core.hitFlash - dt * 2.5);
    const health = core.hp / core.maxHp;
    const hurt = 1 - health;
    core.crystalMat.emissive.setRGB(0.6 + hurt * 0.4 + core.hitFlash, 0.3 * health + core.hitFlash * 0.4, 1.0 * health + 0.15);
    core.crystalMat.emissiveIntensity = 0.9 + Math.sin(time * 2.2) * 0.2 + core.hitFlash;
    core.light.color.setRGB(0.66 + hurt * 0.34, 0.4 * health + 0.05, 1.0 * health + 0.1);
    core.light.intensity = 22 + Math.sin(time * 3) * 5 + core.hitFlash * 50;
    core.halo.material.opacity = 0.22 + Math.sin(time * 2.2) * 0.05 + core.hitFlash * 0.4;
    core.beamMat.opacity = 0.22 + Math.sin(time * 2) * 0.05 + core.hitFlash * 0.3;
    // electric arcs between the crystals and the clamps
    core.arcT -= dt * (1 + core.hitFlash * 4 + hurt * 2);
    if (core.arcT <= 0 && this.game.fx) {
      core.arcT = 0.25 + Math.random() * 0.9;
      const tip = core.tips[(Math.random() * core.tips.length) | 0];
      const from = core.cluster.localToWorld(tip.clone());
      const to = core.clampTips[(Math.random() * 4) | 0].getWorldPosition(new THREE.Vector3());
      this.game.fx.lightning(from, to, 0.45, '#d9a8ff', false);
    }
    this.shieldU.time.value = time;
    this.shieldU.strength.value = 0.03 + core.hitFlash * 1.2;
    this.shieldU.color.value.setRGB(0.24 + core.hitFlash, 0.88 - core.hitFlash * 0.5, 1);

    for (const h of this.hives) {
      const a = h.active ? 1 : 0;
      const pulse = Math.sin(time * (h.active ? 5 : 1.5));
      h.light.intensity += ((a ? 40 + pulse * 15 : 0) - h.light.intensity) * Math.min(1, dt * 3);
      h.holeMat.emissiveIntensity = 0.4 + a * (2.4 + pulse * 0.8);
      h.sacMat.emissiveIntensity = 0.5 + a * (1.5 + pulse * 0.6);
      for (const s of h.sacs) s.m.scale.setScalar(1 + Math.sin(time * (h.active ? 4 : 1.2) + s.ph) * 0.12);
    }

    if (this.mist) this.mist.update(dt, time, this.game.r.camera.position);
    for (const sh of this.shafts) sh.userData.shaftU.time.value = time;
    if (this.poolMat) this.poolMat.emissiveIntensity = 0.6 + Math.sin(time * 2) * 0.15;
    if (this.propGlowMat) this.propGlowMat.emissiveIntensity = 1.6 + Math.sin(time * 1.3) * 0.3;

    // grid overlay fade
    const gt = this.gridTarget || 0;
    this.gridU.opacity.value += (gt - this.gridU.opacity.value) * Math.min(1, dt * 10);
    this.gridMesh.visible = this.gridU.opacity.value > 0.01;

    // ambient particles follow the camera
    const cam = this.game.r.camera.position;
    const pos = this.particles.geometry.attributes.position;
    const arr = pos.array;
    const cfg = this.partCfg;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += Math.sin(time * 0.5 + i) * cfg.drift * dt + cfg.drift * 0.4 * dt;
      arr[i + 1] -= cfg.fall * dt;
      arr[i + 2] += Math.cos(time * 0.4 + i * 0.7) * cfg.drift * dt;
      let dx = arr[i] - cam.x, dz = arr[i + 2] - cam.z;
      if (dx > 40) arr[i] -= 80; else if (dx < -40) arr[i] += 80;
      if (dz > 40) arr[i + 2] -= 80; else if (dz < -40) arr[i + 2] += 80;
      if (arr[i + 1] < 0) arr[i + 1] += 25; else if (arr[i + 1] > 25) arr[i + 1] -= 25;
    }
    pos.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map && m.map !== getShared().glow && m.map !== getShared().detail.map) m.map.dispose?.();
          m.dispose();
        }
      }
    });
    this.scene.fog = null;
  }
}
