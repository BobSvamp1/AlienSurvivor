import * as THREE from 'three';
import { fbm, mulberry32 } from '../core/rng.js';

// Procedural textures, generated once on load so the game needs no image files.

export function detailTextures() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // tileable by sampling a torus-ish wrap of the noise
    const u = x / S, v = y / S;
    const n = fbm(Math.cos(u * Math.PI * 2) * 2 + 10, Math.sin(u * Math.PI * 2) * 2 + Math.cos(v * Math.PI * 2) * 2 + 5, 7, 5) * 0.6
      + fbm(Math.sin(v * Math.PI * 2) * 4 + 3, Math.cos(u * Math.PI * 2) * 4 + Math.cos(v * Math.PI * 2) * 3, 3, 3) * 0.4;
    h[y * S + x] = n;
  }
  const rng = mulberry32(5);
  for (let i = 0; i < S * S; i++) {
    const v = Math.min(255, Math.max(0, 150 + (h[i] - 0.5) * 220 + (rng() - 0.5) * 40));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // Normal map from the same height field (plus fine grain)
  const c2 = document.createElement('canvas');
  c2.width = c2.height = S;
  const g2 = c2.getContext('2d');
  const img2 = g2.createImageData(S, S);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)] + (rng() - 0.5) * 0.02;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 6;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 6;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * S + x) * 4;
    img2.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    img2.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
    img2.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    img2.data[i + 3] = 255;
  }
  g2.putImageData(img2, 0, 0);
  const normal = new THREE.CanvasTexture(c2);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  return { map, normal };
}

// Bumpy "chitin" normal map for the alien shells
export function chitinNormal() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const h = new Float32Array(S * S);
  const rng = mulberry32(11);
  // Voronoi-like plates
  const pts = [];
  for (let i = 0; i < 24; i++) pts.push([rng() * S, rng() * S]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d1 = 1e9, d2 = 1e9;
    for (const [px, py] of pts) for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const d = Math.hypot(x - px - ox, y - py - oy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    h[y * S + x] = Math.min(1, (d2 - d1) / 10);
  }
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.5;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 2.5;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * S + x) * 4;
    img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Soft round sprite used for glows, particles and goo splats
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function splatTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(99);
  g.fillStyle = '#fff';
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * S * 0.3;
    const r = 6 + rng() * 22;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const d = S * 0.3 + rng() * S * 0.15;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 2 + rng() * 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

// Branching bioluminescent veins (white on black) used as an emissive map on alien shells
let veinTex = null;
export function veinTexture() {
  if (veinTex) return veinTex;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const rng = mulberry32(1234);
  g.lineCap = 'round';
  g.strokeStyle = '#fff';
  g.shadowColor = '#fff';
  const vein = (x, y, a, w, len, depth) => {
    g.lineWidth = w;
    g.shadowBlur = w * 3;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      a += (rng() - 0.5) * 0.7;
      const nx = x + Math.cos(a) * 6, ny = y + Math.sin(a) * 6;
      // draw wrapped copies so the texture tiles
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if (ox || oy) { g.moveTo(x + ox, y + oy); g.lineTo(nx + ox, ny + oy); }
      }
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      x = (nx + S) % S; y = (ny + S) % S;
      if (depth < 3 && rng() < 0.07) vein(x, y, a + (rng() < 0.5 ? 1 : -1) * (0.6 + rng() * 0.6), w * 0.6, len * 0.5, depth + 1);
    }
    g.lineWidth = w;
    g.stroke();
  };
  for (let n = 0; n < 9; n++) vein(rng() * S, rng() * S, rng() * Math.PI * 2, 3 + rng() * 2.5, 40 + rng() * 40, 0);
  // small glowing pores
  g.shadowBlur = 6;
  g.fillStyle = '#fff';
  for (let n = 0; n < 60; n++) { g.beginPath(); g.arc(rng() * S, rng() * S, 0.8 + rng() * 1.6, 0, Math.PI * 2); g.fill(); }
  veinTex = new THREE.CanvasTexture(c);
  veinTex.wrapS = veinTex.wrapT = THREE.RepeatWrapping;
  veinTex.colorSpace = THREE.SRGBColorSpace;
  return veinTex;
}

// Shared clock for the pulsing veins
export const veinClock = { value: 0 };

// Adds pulsing veins + a hit-flash uniform to an alien material
export function applyVeins(mat, color, intensity = 1, repeat = 1.5) {
  const t = veinTexture();
  mat.emissiveMap = t;
  mat.emissive = new THREE.Color(color);
  mat.emissiveIntensity = intensity;
  const flash = { value: 0 };
  mat.userData.flash = flash;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.veinTime = veinClock;
    sh.uniforms.flashAmt = flash;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float veinTime; uniform float flashAmt;')
      .replace('#include <emissivemap_fragment>', `
        #ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv * ${repeat.toFixed(2)} );
          float veinPulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(veinTime * 2.4 - vEmissiveMapUv.y * 10.0 + vEmissiveMapUv.x * 4.0), 2.0);
          totalEmissiveRadiance *= emissiveColor.rgb * veinPulse;
        #endif
        totalEmissiveRadiance += vec3(flashAmt, flashAmt * 0.9, flashAmt * 0.8);`);
  };
  mat.customProgramCacheKey = () => 'veins' + repeat;
  return mat;
}
