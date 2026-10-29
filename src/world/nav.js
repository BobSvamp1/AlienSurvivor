// Grid for the map: obstacles, acid pools, buildings and the "flow field"
// that tells every alien the shortest way to the core.

import { STEP } from './elevation.js';

export const CELL = 2;
export const CLIFF = 4; // value in blocked: cell on a cliff edge (not walkable, not buildable, but not a solid box)
export const PIT = 5; // a chasm: anything that falls in dies
export const VOID = 6; // high ground nobody can reach (tops of canyon walls)
const SOFT = (b) => b === CLIFF || b === PIT || b === VOID; // blocks walking/building but is not a solid box
const HALF = CELL / 2;
const SQRT2 = Math.SQRT2;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export class NavGrid {
  constructor(map) {
    this.halfX = map.halfX;
    this.halfZ = map.halfZ;
    this.cols = Math.round((map.halfX * 2) / CELL);
    this.rows = Math.round((map.halfZ * 2) / CELL);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n); // 0 = free, 1 = rock, 2 = debris, 3 = clutter, 4 = cliff edge
    this.h = new Float32Array(n); // ground height of each cell
    this.pool = new Uint8Array(n);
    this.struct = new Array(n).fill(null);
    this.dist = new Float32Array(n).fill(Infinity);
    // a second flow field that avoids the main routes: some aliens take it, so the
    // swarm spreads over several corridors when the map has them
    this.dist2 = new Float32Array(n).fill(Infinity);
    this.pen = new Float32Array(n);
    this.hives = map.hives || [];
    this.routeOk = this.hives.map(() => false);
    this.dirty = true;
  }

  ci(x) { return Math.floor((x + this.halfX) / CELL); }
  cj(z) { return Math.floor((z + this.halfZ) / CELL); }
  cx(i) { return -this.halfX + i * CELL + HALF; }
  cz(j) { return -this.halfZ + j * CELL + HALF; }
  idx(i, j) { return j * this.cols + i; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.cols && j < this.rows; }

  isBlocked(i, j) {
    if (!this.inside(i, j)) return true;
    return this.blocked[this.idx(i, j)] !== 0;
  }

  solidAt(i, j) {
    if (!this.inside(i, j)) return true;
    const k = this.idx(i, j);
    if (this.blocked[k]) return true;
    const s = this.struct[k];
    return !!(s && s.def.solid);
  }

  poolAt(x, z) {
    const i = this.ci(x), j = this.cj(z);
    return this.inside(i, j) && this.pool[this.idx(i, j)] === 1;
  }

  // Helpers used by map layouts
  builder() {
    const self = this;
    const forCells = (x, z, r, fn) => {
      const i0 = self.ci(x - r - CELL), i1 = self.ci(x + r + CELL);
      const j0 = self.cj(z - r - CELL), j1 = self.cj(z + r + CELL);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!self.inside(i, j)) continue;
        if (Math.hypot(self.cx(i) - x, self.cz(j) - z) <= r) fn(self.idx(i, j));
      }
    };
    return {
      rock: (x, z, r, type = 1) => forCells(x, z, r, (k) => { self.blocked[k] = type; self.pool[k] = 0; }),
      clear: (x, z, r) => forCells(x, z, r, (k) => { self.blocked[k] = 0; }),
      pool: (x, z, r) => forCells(x, z, r, (k) => { if (!self.blocked[k]) self.pool[k] = 1; }),
      line(x1, z1, x2, z2, w, type = 1) {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const steps = Math.ceil(len / 0.8);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          this.rock(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, w / 2, type);
        }
      },
    };
  }

  // Cost to walk into a cell. Buildings are "walkable" but expensive,
  // so aliens go around walls when they can, and chew through when they can't.
  enterCost(k) {
    let c = 1;
    if (this.pool[k]) c += 1.5;
    const s = this.struct[k];
    if (s && s.def.solid) c += s.def.navCost || 10;
    return c;
  }

  computeFlow(coreX, coreZ, coreRadius) {
    this.dijkstra(this.dist, coreX, coreZ, coreRadius, null);
    this.computeAlt(coreX, coreZ, coreRadius);
    this.dirty = false;
  }

  // follow a field from (x, z) to the core: list of cells and walked length
  traceCells(field, x, z, max = 800) {
    const cells = [];
    let i = this.ci(x), j = this.cj(z);
    if (!this.inside(i, j)) return { cells, len: Infinity };
    let k = this.idx(i, j), len = 0;
    if (!isFinite(field[k])) return { cells, len: Infinity };
    for (let s = 0; s < max; s++) {
      cells.push(k);
      if (field[k] === 0) return { cells, len };
      let best = field[k], bk = -1;
      for (const [di, dj] of N8) {
        const ni = i + di, nj = j + dj;
        if (!this.inside(ni, nj)) continue;
        const nk = this.idx(ni, nj);
        if (this.blocked[nk]) continue;
        if (Math.abs(this.h[nk] - this.h[k]) > STEP) continue;
        if (di !== 0 && dj !== 0 && (this.solidAt(i + di, j) || this.solidAt(i, j + dj))) continue;
        if (field[nk] < best) { best = field[nk]; bk = nk; }
      }
      if (bk < 0) return { cells, len: Infinity };
      const ni = bk % this.cols, nj = (bk / this.cols) | 0;
      len += Math.hypot(ni - i, nj - j) * CELL;
      i = ni; j = nj; k = bk;
    }
    return { cells, len: Infinity };
  }

  computeAlt(coreX, coreZ, coreRadius) {
    const pen = this.pen;
    pen.fill(0);
    const main = this.hives.map(([x, z]) => this.traceCells(this.dist, x, z));
    const cols = this.cols;
    for (const m of main) for (const k of m.cells) {
      const i = k % cols, j = (k / cols) | 0;
      if (this.dist[k] < 6) continue; // everyone meets at the core anyway
      pen[k] = Math.max(pen[k], 4);
      for (const [di, dj] of N8) {
        if (!this.inside(i + di, j + dj)) continue;
        const nk = this.idx(i + di, j + dj);
        pen[nk] = Math.max(pen[nk], 2.5);
      }
    }
    this.dijkstra(this.dist2, coreX, coreZ, coreRadius, pen);
    // only use the other route when it is really different and not a huge detour
    this.routeOk = this.hives.map(([x, z], h) => {
      const a = this.traceCells(this.dist2, x, z);
      const m = main[h];
      if (!isFinite(a.len) || !isFinite(m.len) || m.len < 1) return false;
      const set = new Set(m.cells);
      const shared = a.cells.filter((k) => set.has(k)).length / Math.max(1, a.cells.length);
      return shared < 0.6 && a.len <= m.len * 1.75;
    });
  }

  dijkstra(dist, coreX, coreZ, coreRadius, pen) {
    dist.fill(Infinity);
    const heap = new MinHeap();
    const cols = this.cols;
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < cols; i++) {
      const d = Math.hypot(this.cx(i) - coreX, this.cz(j) - coreZ);
      if (d <= coreRadius + 2.2) {
        const k = this.idx(i, j);
        dist[k] = 0;
        heap.push(k, 0);
      }
    }
    while (heap.size) {
      const k = heap.pop();
      const i = k % cols;
      const j = (k / cols) | 0;
      const base = dist[k];
      for (const [di, dj] of N8) {
        const ni = i + di, nj = j + dj;
        if (!this.inside(ni, nj)) continue;
        const nk = this.idx(ni, nj);
        if (this.blocked[nk]) continue;
        if (Math.abs(this.h[nk] - this.h[k]) > STEP) continue; // too steep
        const diag = di !== 0 && dj !== 0;
        if (diag && (this.solidAt(i + di, j) || this.solidAt(i, j + dj))) continue;
        const nd = base + (this.enterCost(nk) + (pen ? pen[nk] : 0)) * (diag ? SQRT2 : 1);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          heap.push(nk, nd);
        }
      }
    }
  }

  distAt(x, z) {
    const i = this.ci(x), j = this.cj(z);
    return this.inside(i, j) ? this.dist[this.idx(i, j)] : Infinity;
  }

  // Direction (into out.x/out.z) towards the core along the flow field.
  // Returns false if the position has no path.
  flowDir(x, z, out, y = null, alt = false) {
    const i = this.ci(x), j = this.cj(z);
    if (!this.inside(i, j)) return false;
    const field = alt ? this.dist2 : this.dist;
    const here = field[this.idx(i, j)];
    // standing height: only neighbours reachable from here count (no walking up cliffs)
    const yy = y === null ? this.h[this.idx(i, j)] : y;
    let best = here, bi = -1, bj = -1;
    for (const [di, dj] of N8) {
      const ni = i + di, nj = j + dj;
      if (!this.inside(ni, nj)) continue;
      const nk = this.idx(ni, nj);
      if (this.blocked[nk]) continue;
      if (this.h[nk] - yy > STEP + 0.3) continue;
      if (di !== 0 && dj !== 0 && (this.solidAt(i + di, j) || this.solidAt(i, j + dj))) continue;
      const d = field[nk];
      if (d < best) { best = d; bi = ni; bj = nj; }
    }
    if (bi < 0) return here === 0 ? 'core' : false;
    out.x = this.cx(bi) - x;
    out.z = this.cz(bj) - z;
    const l = Math.hypot(out.x, out.z) || 1;
    out.x /= l; out.z /= l;
    out.cell = this.idx(bi, bj);
    return true;
  }

  // Push a circle out of rocks and solid buildings. Returns the building it touched, if any.
  // rockCap limits the radius used against rocks / clutter, so big aliens can squeeze
  // through narrow gaps (they still collide with buildings using their full size).
  pushOut(pos, r, rockCap = Infinity) {
    let touched = null;
    const i0 = this.ci(pos.x - r) , i1 = this.ci(pos.x + r);
    const j0 = this.cj(pos.z - r), j1 = this.cj(pos.z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let s = null;
      if (this.inside(i, j)) {
        const k = this.idx(i, j);
        s = this.struct[k];
        if ((!this.blocked[k] || SOFT(this.blocked[k])) && !(s && s.def.solid)) continue;
      }
      const cx = this.cx(i), cz = this.cz(j);
      const nx = Math.max(cx - HALF, Math.min(pos.x, cx + HALF));
      const nz = Math.max(cz - HALF, Math.min(pos.z, cz + HALF));
      let dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      const rr = s && s.def.solid ? r : Math.min(r, rockCap);
      if (d2 >= rr * rr) continue;
      if (s && s.def.solid) touched = s;
      if (d2 < 1e-8) {
        const ox = pos.x - cx, oz = pos.z - cz;
        if (Math.abs(ox) > Math.abs(oz)) pos.x = cx + Math.sign(ox || 1) * (HALF + rr);
        else pos.z = cz + Math.sign(oz || 1) * (HALF + rr);
      } else {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rr - d);
        pos.z += (dz / d) * (rr - d);
      }
    }
    return touched;
  }

  // First solid building overlapping a circle (used by aliens to know what to attack)
  structAt(x, z, r) {
    const i0 = this.ci(x - r), i1 = this.ci(x + r);
    const j0 = this.cj(z - r), j1 = this.cj(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.inside(i, j)) continue;
      const s = this.struct[this.idx(i, j)];
      if (!s || !s.def.solid) continue;
      const cx = this.cx(i), cz = this.cz(j);
      const nx = Math.max(cx - HALF, Math.min(x, cx + HALF));
      const nz = Math.max(cz - HALF, Math.min(z, cz + HALF));
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) return s;
    }
    return null;
  }

  // Simple line of sight across the grid (rocks block it)
  lineOfSight(x1, z1, x2, z2) {
    const d = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.ceil(d / 1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const i = this.ci(x1 + (x2 - x1) * t), j = this.cj(z1 + (z2 - z1) * t);
      if (!this.inside(i, j)) return false;
      const b = this.blocked[this.idx(i, j)];
      if (b && !SOFT(b)) return false;
    }
    return true;
  }
}
