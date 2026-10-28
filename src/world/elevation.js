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
    if (map.elevation) map.elevation(this.builder());
    this.flat = !this.shapes.length && this.baseH === 0;
    if (this.flat) return;
    this.nx = Math.round((this.halfX * 2) / RES) + 1;
    this.nz = Math.round((this.halfZ * 2) / RES) + 1;
    this.grid = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      this.grid[j * this.nx + i] = this.raw(-this.halfX + i * RES, -this.halfZ + j * RES);
    }
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
    };
  }

  // exact (unbaked) height
  raw(x, z) {
    let h = this.baseH;
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
