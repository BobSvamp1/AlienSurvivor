import * as THREE from 'three';
import { groundAt } from '../world/elevation.js';
import { splatTexture } from '../world/textures.js';

const pVert = /* glsl */ `
attribute float size;
attribute vec4 pcolor;
uniform float scale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const pFrag = /* glsl */ `
varying vec4 vColor;
uniform float soft;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, soft, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

// A pool of soft round particles drawn as GPU points
class ParticlePool {
  constructor(scene, max, additive, soft = 0.0) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { scale: { value: 500 }, soft: { value: soft } };
    const m = new THREE.ShaderMaterial({
      vertexShader: pVert, fragmentShader: pFrag, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
    scene.add(this.points);
    this.geo = g;
  }

  emit(x, y, z, vx, vy, vz, color, life, s0, s1, alpha = 1, grav = 0, drag = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = alpha;
    this.life[i] = this.maxLife[i] = life;
    this.size0[i] = s0; this.size1[i] = s1;
    this.alpha0[i] = alpha;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.size[i] = s0;
  }

  clear() { this.life.fill(0); this.size.fill(0); }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.2; }
      this.size[i] = this.size1[i] + (this.size0[i] - this.size1[i]) * k;
      this.col[i * 4 + 3] = this.alpha0[i] * Math.min(1, k * 2.5);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _w0 = new THREE.Color();
const _v = new THREE.Vector3();

let viewW = window.innerWidth, viewH = window.innerHeight;
window.addEventListener('resize', () => { viewW = window.innerWidth; viewH = window.innerHeight; });

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.r.scene;
    this.glow = new ParticlePool(scene, 2500, true, 0.0);
    this.soft = new ParticlePool(scene, 1500, false, 0.05);

    // Chunky lit debris
    this.chunkMax = 300;
    this.chunks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), this.chunkMax);
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunks.frustumCulled = false;
    this.chunkData = [];
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.chunkMax; i++) {
      this.chunks.setMatrixAt(i, m);
      this.chunks.setColorAt(i, _c.set('#fff'));
      this.chunkData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), life: 0, s: 0.1 });
    }
    this.chunkNext = 0;
    scene.add(this.chunks);

    // Tracers / lightning segments
    this.tracers = [];
    const tGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    for (let i = 0; i < 160; i++) {
      const mesh = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, max: 0.06 });
    }
    this.tNext = 0;

    // Pooled flash lights (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb15a', 0, 14, 2);
      scene.add(l);
      this.lights.push({ l, life: 0, max: 0.1, i0: 0 });
    }
    this.lNext = 0;

    // Ground splats
    this.splatTex = splatTexture();
    this.splats = [];
    const sGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.splatTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(sGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.splats.push({ mesh, life: 0 });
    }
    this.sNext = 0;

    // Shockwave rings
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 0.5, r: 1 });
    }
    this.rNext = 0;

    // Damage numbers (HTML)
    this.numbers = [];
    const layer = document.getElementById('dmg-layer');
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      layer.appendChild(el);
      this.numbers.push({ el, life: 0, p: new THREE.Vector3(), vx: 0 });
    }
    this.nNext = 0;
  }

  clear() {
    this.glow.clear();
    this.soft.clear();
    for (const c of this.chunkData) c.life = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const s of this.splats) { s.life = 0; s.mesh.visible = false; }
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    for (const n of this.numbers) { n.life = 0; n.el.style.opacity = 0; }
    for (const l of this.lights) { l.life = 0; l.l.intensity = 0; }
  }

  rand(s = 1) { return (Math.random() - 0.5) * 2 * s; }

  // ---------------------------------------------------------------- emitters
  burst(p, color, count = 8, speed = 5, size = 0.12) {
    _c.set(color);
    for (let i = 0; i < count; i++) {
      _v.set(this.rand(), Math.random() * 1.2 + 0.1, this.rand()).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.8));
      this.soft.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, _c, 0.4 + Math.random() * 0.5, size * 2.2, size * 0.8, 1, 16, 1.5);
    }
    const n = Math.ceil(count / 3);
    for (let i = 0; i < n; i++) this.chunk(p, color, size * 0.8, speed);
  }

  chunk(p, color, size, speed) {
    const i = this.chunkNext;
    this.chunkNext = (i + 1) % this.chunkMax;
    const c = this.chunkData[i];
    c.p.copy(p);
    c.v.set(this.rand(), Math.random() * 1.5 + 0.3, this.rand()).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.life = 1.2 + Math.random() * 0.8;
    c.s = size * (0.6 + Math.random() * 0.8);
    this.chunks.setColorAt(i, _c.set(color));
    this.chunks.instanceColor.needsUpdate = true;
  }

  muzzle(p, color = '#ffd27a', size = 0.6) {
    _c.set(color).multiplyScalar(3);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, _c, 0.05, size * 1.4, size * 0.6, 1);
    this.flash(p, color, 6 * size, 0.06);
  }

  flash(p, color, intensity, dur) {
    const L = this.lights[this.lNext];
    this.lNext = (this.lNext + 1) % this.lights.length;
    L.l.position.copy(p);
    L.l.color.set(color);
    L.l.intensity = intensity;
    L.i0 = intensity;
    L.life = L.max = dur;
  }

  tracer(from, to, color = '#fff0b0', width = 0.035, life = 0.06) {
    const t = this.tracers[this.tNext];
    this.tNext = (this.tNext + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, len);
    t.mesh.material.color.set(color).multiplyScalar(2.5);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = t.max = life;
  }

  lightning(from, to, scale = 1, color = '#9fe8ff', light = true) {
    const segs = 7;
    const dir = _v.subVectors(to, from);
    const len = dir.length();
    let prev = from.clone();
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = from.clone().lerp(to, t);
      if (i < segs) {
        const j = len * 0.08 * scale;
        p.x += this.rand(j); p.y += this.rand(j); p.z += this.rand(j);
      }
      this.tracer(prev, p, color, 0.05 * scale, 0.11);
      prev = p;
    }
    _c.set(color).lerp(_w0.set('#ffffff'), 0.4).multiplyScalar(2);
    this.glow.emit(to.x, to.y, to.z, 0, 0, 0, _c, 0.15, 1.2 * scale, 0.3, 1);
    if (light) this.flash(to, color, 5 * scale, 0.08);
  }

  explosion(p, color = '#ffb43d', radius = 3) {
    const big = Math.min(2.5, radius / 2.5);
    _c.set(color);
    for (let i = 0; i < 26 * big; i++) {
      _v.set(this.rand(), Math.random() * 0.9 + 0.2, this.rand()).normalize().multiplyScalar(radius * (1 + Math.random() * 2));
      _c2.copy(_c).lerp(_c.clone().set('#fff3c0'), Math.random() * 0.6).multiplyScalar(2.5);
      this.glow.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, _c2, 0.35 + Math.random() * 0.35, radius * 0.7, radius * 0.2, 1, -1, 4);
    }
    _c2.set('#3a3430');
    for (let i = 0; i < 14 * big; i++) {
      _v.set(this.rand(), Math.random() + 0.3, this.rand()).normalize().multiplyScalar(radius * (0.5 + Math.random()));
      this.soft.emit(p.x, p.y + 0.5, p.z, _v.x, _v.y, _v.z, _c2, 1.2 + Math.random(), radius * 0.6, radius * 1.4, 0.55, -0.8, 2);
    }
    for (let i = 0; i < 8 * big; i++) this.chunk(p, '#3a3632', 0.18, radius * 3);
    this.flash(_v.set(p.x, p.y + 1, p.z), color, 30 * big, 0.2);
    this.ring(p.x, p.z, radius * 1.3, color, 0.4);
  }

  ring(x, z, r, color = '#fff', life = 0.5) {
    const R = this.rings[this.rNext];
    this.rNext = (this.rNext + 1) % this.rings.length;
    R.mesh.position.set(x, groundAt(x, z) + 0.15, z);
    R.mesh.material.color.set(color).multiplyScalar(2);
    R.mesh.visible = true;
    R.life = R.max = life;
    R.r = r;
  }

  shockwave(x, z, r) {
    this.ring(x, z, r, '#ffcf8a', 0.6);
    this.dust(x, z, r * 0.8);
    this.flash(_v.set(x, groundAt(x, z) + 1, z), '#ffb46a', 20, 0.2);
  }

  dust(x, z, r = 1) {
    _c.set(this.game.world?.theme.ground[2] || '#a08070');
    const gy = groundAt(x, z);
    for (let i = 0; i < 10 + r * 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3 * r;
      this.soft.emit(x + Math.cos(a) * r * 0.5, gy + 0.2, z + Math.sin(a) * r * 0.5, Math.cos(a) * s, 0.4 + Math.random(), Math.sin(a) * s, _c, 0.7 + Math.random() * 0.6, 0.6 + r * 0.3, 1.6 + r * 0.6, 0.5, 0, 3);
    }
  }

  smoke(p, n = 3) {
    _c.set('#55504a');
    for (let i = 0; i < n; i++) this.soft.emit(p.x, p.y, p.z, this.rand(0.4), 0.8 + Math.random(), this.rand(0.4), _c, 1 + Math.random(), 0.4, 1.4, 0.45, -0.3, 1);
  }

  toxic(x, z) {
    _c.set('#9aff5a');
    this.soft.emit(x, groundAt(x, z) + 0.3 + Math.random() * 0.8, z, this.rand(0.3), 0.4 + Math.random() * 0.4, this.rand(0.3), _c, 1.4 + Math.random(), 0.8, 2.6, 0.35, -0.05, 0.5);
  }

  trail(p, color) {
    _c.set(color).multiplyScalar(1.5);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, _c, 0.3, 0.35, 0.05, 0.8);
  }

  fire(p) {
    _c.setHSL(0.05 + Math.random() * 0.06, 1, 0.55).multiplyScalar(2.5);
    this.glow.emit(p.x, p.y, p.z, this.rand(0.3), 1.5 + Math.random(), this.rand(0.3), _c, 0.35 + Math.random() * 0.2, 0.45, 0.1, 1, -2);
  }

  flame(from, fx, fz, range, dt) {
    const n = Math.ceil(dt * 120);
    for (let i = 0; i < n; i++) {
      const sp = range * (1.6 + Math.random() * 0.6);
      const spread = 0.28;
      const vx = (fx + this.rand(spread)) * sp;
      const vz = (fz + this.rand(spread)) * sp;
      _c.setHSL(0.03 + Math.random() * 0.08, 1, 0.5 + Math.random() * 0.2).multiplyScalar(2.2);
      this.glow.emit(from.x, from.y, from.z, vx, this.rand(0.6) + 0.5, vz, _c, 0.38 + Math.random() * 0.15, 0.3, 1.8, 0.9, -3, 1.6);
    }
    if (Math.random() < dt * 20) {
      _c.set('#3a3430');
      this.soft.emit(from.x + fx * range * 0.8, from.y + 0.5, from.z + fz * range * 0.8, fx, 1.5, fz, _c, 1.2, 0.8, 2.2, 0.35, -0.5, 1);
    }
    this.flash(from, '#ff8a3d', 5, 0.05);
  }

  splat(x, z, color, size = 1) {
    const s = this.splats[this.sNext];
    this.sNext = (this.sNext + 1) % this.splats.length;
    s.mesh.position.set(x, groundAt(x, z) + 0.035 + Math.random() * 0.01, z);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mesh.scale.setScalar(size * (1.4 + Math.random() * 0.8));
    s.mesh.material.color.set(color).multiplyScalar(0.55);
    s.mesh.material.opacity = 0.85;
    s.mesh.visible = true;
    s.life = 25;
  }

  damageNumber(x, y, z, amount, crit = false) {
    if (!this.game.settings.damageNumbers) return;
    const n = this.numbers[this.nNext];
    this.nNext = (this.nNext + 1) % this.numbers.length;
    n.p.set(x + this.rand(0.3), y, z + this.rand(0.3));
    n.life = 0.8;
    n.vx = this.rand(20);
    n.el.textContent = Math.round(amount);
    n.el.className = crit ? 'dmg crit' : 'dmg';
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const r = this.game.r;
    const h = r.renderer.getDrawingBufferSize(_v).y;
    const scale = h / (2 * Math.tan((r.camera.fov * Math.PI) / 360));
    this.glow.uniforms.scale.value = scale;
    this.soft.uniforms.scale.value = scale;
    this.glow.update(dt);
    this.soft.update(dt);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < this.chunkMax; i++) {
      const c = this.chunkData[i];
      if (c.life <= 0) {
        if (c.s !== 0) { c.s = 0; m.makeScale(0, 0, 0); this.chunks.setMatrixAt(i, m); }
        continue;
      }
      c.life -= dt;
      c.v.y -= 22 * dt;
      c.p.addScaledVector(c.v, dt);
      const fl = groundAt(c.p.x, c.p.z) + c.s * 0.5;
      if (c.p.y < fl) {
        c.p.y = fl;
        c.v.multiplyScalar(0.45);
        c.v.y = Math.abs(c.v.y) * 0.3;
      } else {
        c.r.x += dt * 8; c.r.y += dt * 6;
      }
      const k = Math.min(1, c.life * 2);
      q.setFromEuler(c.r);
      s.setScalar(c.s * k);
      m.compose(c.p, q, s);
      this.chunks.setMatrixAt(i, m);
    }
    this.chunks.instanceMatrix.needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const L of this.lights) {
      if (L.life <= 0) continue;
      L.life -= dt;
      L.l.intensity = Math.max(0, (L.life / L.max) * L.i0);
    }
    for (const sp of this.splats) {
      if (sp.life <= 0) continue;
      sp.life -= dt;
      if (sp.life < 5) sp.mesh.material.opacity = Math.max(0, sp.life / 5) * 0.85;
      if (sp.life <= 0) sp.mesh.visible = false;
    }
    for (const R of this.rings) {
      if (R.life <= 0) continue;
      R.life -= dt;
      const k = 1 - R.life / R.max;
      R.mesh.scale.setScalar(0.2 + k * R.r);
      R.mesh.material.opacity = (1 - k) * 0.9;
      if (R.life <= 0) R.mesh.visible = false;
    }

    // damage numbers
    const cam = r.camera;
    // window size is cached on resize: reading innerWidth here, right after the HUD
    // has written styles, forced the browser to recalculate layout every frame
    const w = viewW, hh = viewH;
    for (const n of this.numbers) {
      if (n.life <= 0) continue;
      n.life -= dt;
      n.p.y += dt * 1.6;
      _v.copy(n.p).project(cam);
      if (_v.z > 1 || n.life <= 0) { n.el.style.opacity = 0; continue; }
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * hh;
      n.el.style.transform = `translate(${x + n.vx * (0.8 - n.life)}px, ${y}px) translate(-50%, -50%) scale(${0.8 + n.life * 0.4})`;
      n.el.style.opacity = Math.min(1, n.life * 3);
    }
  }
}
