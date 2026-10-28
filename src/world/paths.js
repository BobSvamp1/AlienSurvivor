import * as THREE from 'three';
import { groundAt } from './elevation.js';

// Path preview: glowing, moving arrows on the ground from each hive that opens next
// wave to the core, following the same flow field the aliens use. It is redrawn
// whenever buildings change, so you can see how a wall re-routes the swarm.

let arrowTex = null;
function arrowTexture() {
  if (arrowTex) return arrowTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 64);
  // soft edges across the ribbon
  const edge = g.createLinearGradient(0, 0, 0, 64);
  edge.addColorStop(0, 'rgba(255,255,255,0)');
  edge.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  edge.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, 128, 64);
  // chevron pointing along +u
  g.fillStyle = '#fff';
  g.beginPath();
  for (const [x, y] of [[36, 8], [56, 8], [88, 32], [56, 56], [36, 56], [68, 32]]) g.lineTo(x, y);
  g.closePath();
  g.fill();
  arrowTex = new THREE.CanvasTexture(c);
  arrowTex.wrapS = THREE.RepeatWrapping;
  arrowTex.colorSpace = THREE.SRGBColorSpace;
  return arrowTex;
}

function smooth(pts, iterations = 2) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export class PathPreview {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.renderOrder = 3;
    world.group.add(this.group);
    this.meshes = [];
    this.dirty = true;
    this.opacity = 0;
    this.target = 0;
    this.tex = arrowTexture();
  }

  // follow the flow field from (x, z) to the core
  trace(x, z) {
    const nav = this.world.nav;
    const pts = [[x, z]];
    const out = { x: 0, z: 0, cell: -1 };
    let cx = x, cz = z;
    const seen = new Set();
    for (let s = 0; s < 600; s++) {
      const ok = nav.flowDir(cx, cz, out);
      if (ok !== true) break;
      const i = out.cell % nav.cols, j = (out.cell / nav.cols) | 0;
      if (seen.has(out.cell)) break;
      seen.add(out.cell);
      cx = nav.cx(i); cz = nav.cz(j);
      pts.push([cx, cz]);
      if (nav.dist[out.cell] === 0) break;
    }
    const c = this.world.core.pos;
    pts.push([c.x + (pts[pts.length - 1][0] - c.x) * 0.6, c.z + (pts[pts.length - 1][1] - c.z) * 0.6]);
    return smooth(pts, 2);
  }

  ribbon(pts, width) {
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const alpha = new Float32Array(n * 2);
    let len = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const px = -tz * width * 0.5, pz = tx * width * 0.5;
      if (i > 0) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [x, z] = pts[i];
      const y1 = groundAt(x + px, z + pz), y2 = groundAt(x - px, z - pz), y0 = groundAt(x, z);
      pos.set([x + px, Math.max(y1, y0) + 0.12, z + pz, x - px, Math.max(y2, y0) + 0.12, z - pz], i * 6);
      uv.set([len / 1.5, 1, len / 1.5, 0], i * 4);
    }
    // fade in at the hive and out at the core
    let acc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const f = Math.min(1, acc / 4) * Math.min(1, (len - acc) / 5);
      alpha[i * 2] = alpha[i * 2 + 1] = f;
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    g.setIndex(idx);
    return g;
  }

  rebuild(nextHives) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const hives = this.world.hives;
    hives.forEach((h, i) => {
      const next = nextHives.includes(i);
      if (!next) return;
      const pts = this.trace(h.pos.x, h.pos.z);
      if (pts.length < 3) return;
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.tex }, color: { value: new THREE.Color('#ff5a7a') }, opacity: { value: 0 }, shift: { value: 0 } },
        vertexShader: `attribute float alpha; varying float vA; varying vec2 vUv;
          void main() { vA = alpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; uniform float shift; varying float vA; varying vec2 vUv;
          void main() { vec4 t = texture2D(map, vec2(vUv.x - shift, vUv.y)); gl_FragColor = vec4(color * t.rgb * 1.6, t.a * vA * opacity); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const m = new THREE.Mesh(this.ribbon(pts, 1.25), mat);
      m.userData.noAO = true;
      m.frustumCulled = false;
      this.group.add(m);
      this.meshes.push(m);
    });
    this.dirty = false;
  }

  update(dt, show, nextHives) {
    if (this.dirty) this.rebuild(nextHives);
    this.target = show ? 1 : 0;
    this.opacity += (this.target - this.opacity) * Math.min(1, dt * 4);
    this.group.visible = this.opacity > 0.01;
    if (!this.group.visible) return;
    this.shift = ((this.shift || 0) + dt * 0.9) % 1000; // arrows crawl towards the core
    const pulse = 0.75 + Math.sin(performance.now() / 300) * 0.1;
    for (const m of this.meshes) { m.material.uniforms.opacity.value = this.opacity * pulse; m.material.uniforms.shift.value = this.shift; }
  }
}
