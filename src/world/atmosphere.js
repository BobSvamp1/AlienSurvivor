import * as THREE from 'three';
import { fbm } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Height fog: patches three.js' built-in fog so every lit material also gets a
// thick, slightly uneven ground haze that hugs the floor. Installed once,
// before any material compiles.
let fogInstalled = false;
export function installHeightFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    float fogRange = 1.0 / max(fogDensity, 0.0001);
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    float fogRange = fogFar;
  #endif
  // low-lying haze, thickest at the floor, broken up by slow large-scale variation
  vec3 fw = vFogWorld;
  float fogVar = 0.6 + 0.4 * sin(fw.x * 0.061 + sin(fw.z * 0.043) * 2.3) * sin(fw.z * 0.057 + fw.x * 0.021 + 1.7);
  float fogHeight = exp(-max(fw.y, 0.0) * 0.42);
  float fogGround = fogHeight * fogVar * (1.0 - exp(-vFogDepth / (fogRange * 0.24))) * 0.62;
  fogFactor = clamp(fogFactor + fogGround * (1.0 - fogFactor), 0.0, 1.0);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// ---------------------------------------------------------------------------
// Soft noise "puff" texture used for drifting mist cards
let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S - 0.5, dy = y / S - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const n = fbm(x * 0.045, y * 0.045, 11, 5);
    const a = Math.max(0, 1 - r) ** 1.6 * (0.35 + n * 0.9);
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.min(255, a * 255);
  }
  g.putImageData(img, 0, 0);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

// Drifting mist cards near the ground. They fade out as the camera gets close
// so you never see the flat edge of a card.
export class Mist {
  constructor(group, { count = 40, halfX = 50, halfZ = 50, color = '#ffffff', opacity = 0.16, height = 1.4, size = 14, rng = Math.random }) {
    this.items = [];
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.color = new THREE.Color(color);
    this.base = opacity;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: puffTexture(), color: this.color, transparent: true, opacity: 0, depthWrite: false, fog: true });
      const s = new THREE.Sprite(mat);
      const sc = size * (0.7 + rng() * 0.7);
      s.scale.set(sc, sc * 0.38, 1);
      s.position.set((rng() * 2 - 1) * halfX, height * (0.5 + rng() * 0.8), (rng() * 2 - 1) * halfZ);
      s.material.rotation = rng() * 6;
      s.renderOrder = 3;
      s.userData.noAO = true;
      group.add(s);
      this.items.push({ s, mat, vx: 0.4 + rng() * 0.5, vz: (rng() - 0.5) * 0.4, ph: rng() * 6, k: 0.6 + rng() * 0.6 });
    }
  }

  setColor(c) {
    this.color.copy(c);
  }

  update(dt, time, cam) {
    for (const it of this.items) {
      const p = it.s.position;
      p.x += it.vx * dt;
      p.z += it.vz * dt;
      if (p.x > this.halfX) p.x -= this.halfX * 2;
      if (p.z > this.halfZ) p.z -= this.halfZ * 2; else if (p.z < -this.halfZ) p.z += this.halfZ * 2;
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      const near = THREE.MathUtils.smoothstep(d, 4, 14);
      it.mat.opacity = this.base * it.k * near * (0.75 + 0.25 * Math.sin(time * 0.3 + it.ph));
      it.mat.color.copy(this.color);
    }
  }
}

// ---------------------------------------------------------------------------
// Volumetric-looking light shaft: an open cone with soft edges (fresnel), a
// fade along its length and slowly moving dust streaks.
const shaftVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const shaftFrag = /* glsl */ `
uniform vec3 color; uniform float opacity; uniform float time;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.75, vUv.y); // fade at both ends
  float streak = 0.65 + 0.35 * sin(vUv.x * 40.0 + time * 0.4) * sin(vUv.x * 17.0 - time * 0.25 + vUv.y * 3.0);
  float dust = 0.85 + 0.15 * sin(vW.y * 2.0 + time * 0.8 + vW.x);
  float a = edge * along * streak * dust * opacity;
  gl_FragColor = vec4(color * a, 1.0);
}`;

export function lightShaft({ from, to, r0 = 0.3, r1 = 2.5, color = '#ffe9c4', opacity = 0.35 }) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  // uv.y = 1 at the top (source), 0 at the bottom
  const geo = new THREE.CylinderGeometry(r0, r1, len, 24, 1, true);
  const u = { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, time: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: shaftVert, fragmentShader: shaftFrag, uniforms: u,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize());
  m.renderOrder = 4;
  m.userData.noAO = true;
  m.userData.shaftU = u;
  return m;
}
