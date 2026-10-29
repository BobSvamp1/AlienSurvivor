import { fbm } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Ground height for maps with high ground: plateaus, ramps and terraces.
//
// A map can describe its relief with an `elevation(e)` function:
//   e.base(h)                         default height of the whole map
//   e.circle(x, z, r, h, opts)        round plateau (or pit, if lower)
//   e.rect(x1, z1, x2, z2, h, opts)   rectangular plateau
//   e.poly([[x, z], ...], h, opts)    any outline
//   e.ramp(x1, z1, x2, z2, w, h1, h2) straight slope from (x1,z1) at h1 to (x2,z2) at h2
//   e.path([[x, z, h?], ...], w, opts) smooth winding road through the points (heights
//                                     blend along it; default 0), round ends
//   e.relief(amp, scale)              lumpy, uneven ground on everything not painted
//   e.platform(x, z, r, h)            raised pad only players reach (jetpack), buildable
// Shapes are painted in order, later ones on top. `opts.rough` wobbles the edge
// so cliffs look natural (0 = perfectly straight).
//
// The result is baked into a 0.5 m grid so lookups are fast and identical for
// rendering, walking, aliens and building.

const RES = 0.5;
export const STEP = 1.1; // max height difference between two neighbouring 2 m cells that can be walked
export const CLIMB = 0.6; // max height a walker can step up in one move

let current = null;
export function setElevation(e) { current = e; }
export function groundAt(x, z) { return current ? current.at(x, z) : 0; }
export function elevation() { return current; }

export class Elevation {
  constructor(map) {
    this.halfX = map.halfX;
    this.halfZ = map.halfZ;
    this.shapes = [];
    this.baseH = 0;
    this.reliefAmp = 0;
    this.reliefScale = 0.08;
    this.platforms = [];
    if (map.elevation) map.elevation(this.builder());
    this.flat = !this.shapes.length && this.baseH === 0;
    if (this.flat) return;
    this.nx = Math.round((this.halfX * 2) / RES) + 1;
    this.nz = Math.round((this.halfZ * 2) / RES) + 1;
    this.grid = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      this.grid[j * this.nx + i] = this.raw(-this.halfX + i * RES, -this.halfZ + j * RES);
    }
    // soften the cliff edges a little: a sheer one-cell drop renders as a sawtooth
    // staircase on the 0.5 m mesh; spread over ~1.5 m it's a clean, steep rock face
    if (map.smooth !== 0) this.blur(map.smooth ?? 2);
  }

  builder() {
    const S = this.shapes;
    return {
      base: (h) => { this.baseH = h; },
      circle: (x, z, r, h, o = {}) => S.push({ kind: 'circle', x, z, r, h, rough: o.rough ?? 0.8 }),
      rect: (x1, z1, x2, z2, h, o = {}) => S.push({ kind: 'rect', x1: Math.min(x1, x2), x2: Math.max(x1, x2), z1: Math.min(z1, z2), z2: Math.max(z1, z2), h, rough: o.rough ?? 0.8 }),
      poly: (pts, h, o = {}) => S.push({ kind: 'poly', pts, h, rough: o.rough ?? 0.8 }),
      ramp: (x1, z1, x2, z2, w, h1, h2) => {
        const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
        S.push({ kind: 'ramp', x1, z1, ux: dx / len, uz: dz / len, len, w, h1, h2 });
      },
      path: (pts, w, o = {}) => {
        // Catmull-Rom through the points, painted as short round-ended segments
        const P = pts.map((p) => [p[0], p[1], p[2] ?? o.h ?? 0]);
        const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
        const out = [];
        for (let i = 0; i < P.length - 1; i++) {
          const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
          const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.2));
          for (let k = 0; k < n; k++) {
            const t = k / n, t2 = t * t, t3 = t2 * t;
            const c = (a, b, cc, d) => 0.5 * (2 * b + (cc - a) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (3 * b - a - 3 * cc + d) * t3);
            out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), p1[2] + (p2[2] - p1[2]) * (t * t * (3 - 2 * t))]);
          }
        }
        out.push(P[P.length - 1]);
        const r = w / 2;
        for (let i = 0; i < out.length - 1; i++) {
          const [ax, az, ha] = out[i], [bx, bz, hb] = out[i + 1];
          S.push({ kind: 'seg', ax, az, bx, bz, ha, hb, r, rough: o.rough ?? 0.5,
            x1: Math.min(ax, bx) - r - 2, x2: Math.max(ax, bx) + r + 2, z1: Math.min(az, bz) - r - 2, z2: Math.max(az, bz) + r + 2 });
        }
      },
      relief: (amp, scale = 0.08) => { this.reliefAmp = amp; this.reliefScale = scale; },
      platform: (x, z, r, h) => {
        // snap it to the nearest road, overlapping its edge a little so you can jetpack
        // straight up onto it from the road
        let best = null;
        for (const sh of S) {
          if (sh.kind !== 'seg') continue;
          const ex = sh.bx - sh.ax, ez = sh.bz - sh.az, l2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((x - sh.ax) * ex + (z - sh.az) * ez) / l2));
          const qx = sh.ax + ex * t, qz = sh.az + ez * t, d = Math.hypot(x - qx, z - qz);
          if (!best || d < best.d) best = { d, qx, qz, rr: sh.r };
        }
        if (best && best.d > 1e-3 && best.d < best.rr + r + 8) {
          const k = (best.rr + r - 1.4) / best.d;
          x = best.qx + (x - best.qx) * k;
          z = best.qz + (z - best.qz) * k;
        }
        this.platforms.push({ x, z, r, h });
        S.push({ kind: 'circle', x, z, r, h, rough: 0.35 });
      },
    };
  }

  blur(passes) {
    const { nx, nz } = this;
    const tmp = new Float32Array(this.grid.length);
    for (let p = 0; p < passes; p++) {
      for (const [src, dst, dx, dy] of [[this.grid, tmp, 1, 0], [tmp, this.grid, 0, 1]]) {
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const a = src[Math.max(0, j - dy) * nx + Math.max(0, i - dx)];
          const b = src[j * nx + i];
          const c = src[Math.min(nz - 1, j + dy) * nx + Math.min(nx - 1, i + dx)];
          dst[j * nx + i] = (a + 2 * b + c) / 4;
        }
      }
    }
  }

  // exact (unbaked) height
  raw(x, z) {
    let h = this.baseH;
    if (this.reliefAmp) h += (fbm(x * this.reliefScale + 11, z * this.reliefScale - 7, 33, 4) - 0.5) * 2 * this.reliefAmp;
    // one shared wobble for all edges keeps neighbouring cliffs consistent
    const wx = (fbm(x * 0.13, z * 0.13, 71, 3) - 0.5) * 2;
    const wz = (fbm(x * 0.13 + 40, z * 0.13 - 17, 72, 3) - 0.5) * 2;
    for (const s of this.shapes) {
      if (s.kind === 'ramp') {
        const px = x - s.x1, pz = z - s.z1;
        const t = px * s.ux + pz * s.uz;
        const side = Math.abs(-px * s.uz + pz * s.ux);
        if (t >= -0.25 && t <= s.len + 0.25 && side <= s.w / 2) {
          const k = Math.min(1, Math.max(0, t / s.len));
          h = s.h1 + (s.h2 - s.h1) * k;
        }
        continue;
      }
      const qx = x + wx * s.rough, qz = z + wz * s.rough;
      if (s.kind === 'seg') {
        if (qx < s.x1 || qx > s.x2 || qz < s.z1 || qz > s.z2) continue;
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((qx - s.ax) * ex + (qz - s.az) * ez) / l2));
        const dx = qx - (s.ax + ex * t), dz = qz - (s.az + ez * t);
        if (dx * dx + dz * dz <= s.r * s.r) h = s.ha + (s.hb - s.ha) * t;
        continue;
      }
      let inside = false;
      if (s.kind === 'circle') inside = (qx - s.x) ** 2 + (qz - s.z) ** 2 <= s.r * s.r;
      else if (s.kind === 'rect') inside = qx >= s.x1 && qx <= s.x2 && qz >= s.z1 && qz <= s.z2;
      else inside = pointInPoly(qx, qz, s.pts);
      if (inside) h = s.h;
    }
    return h;
  }

  at(x, z) {
    if (this.flat) return 0;
    let fx = (x + this.halfX) / RES, fz = (z + this.halfZ) / RES;
    fx = Math.max(0, Math.min(this.nx - 1.001, fx));
    fz = Math.max(0, Math.min(this.nz - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const g = this.grid, n = this.nx;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // lowest ground in a square of half-size r around (x, z)
  minAt(x, z, r) {
    if (this.flat) return 0;
    let lo = Infinity;
    for (let dz = -r; dz <= r + 1e-6; dz += RES) for (let dx = -r; dx <= r + 1e-6; dx += RES) lo = Math.min(lo, this.at(x + dx, z + dz));
    return lo;
  }

  // height range over a square of half-size r around (x, z)
  span(x, z, r) {
    if (this.flat) return 0;
    let lo = Infinity, hi = -Infinity;
    for (let dz = -r; dz <= r + 1e-6; dz += RES) for (let dx = -r; dx <= r + 1e-6; dx += RES) {
      const h = this.at(x + dx, z + dz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return hi - lo;
  }
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
