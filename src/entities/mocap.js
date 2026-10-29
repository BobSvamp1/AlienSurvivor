import * as THREE from 'three';

// Motion-capture clips (Mixamo, retargeted offline onto the avatar's joints).
// anim/avatar.json holds, per clip, a quaternion track for every joint (hips in world
// space, the rest relative to their parent) and the hip height in leg lengths.

export const JOINTS = ['hips', 'torso', 'chest', 'head', 'lhip', 'lknee', 'lankle', 'rhip', 'rknee', 'rankle'];

let DATA = null;
const url = (import.meta.env?.BASE_URL || '/') + 'anim/avatar.json';
export const mocapReady = fetch(url)
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { DATA = d; return d; })
  .catch(() => null);
export const mocap = () => DATA;

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();

// a weighted blend of clip samples
export class Pose {
  constructor(joints = JOINTS) {
    this.joints = joints;
    this.q = {};
    for (const j of joints) this.q[j] = new THREE.Quaternion();
    this.reset();
  }

  reset() {
    for (const j of this.joints) this.q[j].set(0, 0, 0, 0);
    this.hy = 0; this.hx = 0; this.hz = 0; this.w = 0;
  }

  // add clip sampled at time t (seconds) with weight w
  add(clip, t, loop, w) {
    if (!clip || w <= 0.001) return;
    const n = clip.n;
    let f = t * clip.fps, i0, i1;
    if (loop) {
      f = ((f % n) + n) % n;
      i0 = Math.floor(f); i1 = (i0 + 1) % n;
    } else {
      f = Math.min(n - 1, Math.max(0, f));
      i0 = Math.floor(f); i1 = Math.min(n - 1, i0 + 1);
    }
    const a = f - i0;
    for (const j of this.joints) {
      const tr = clip.tr[j];
      _a.set(tr[i0 * 4], tr[i0 * 4 + 1], tr[i0 * 4 + 2], tr[i0 * 4 + 3]);
      _b.set(tr[i1 * 4], tr[i1 * 4 + 1], tr[i1 * 4 + 2], tr[i1 * 4 + 3]);
      _a.slerp(_b, a);
      const acc = this.q[j];
      const s = acc.x * _a.x + acc.y * _a.y + acc.z * _a.z + acc.w * _a.w < 0 ? -w : w;
      acc.set(acc.x + _a.x * s, acc.y + _a.y * s, acc.z + _a.z * s, acc.w + _a.w * s);
    }
    if (clip.hp) { // skinned rigs: hip position in model space, xyz per frame
      const h = clip.hp, k0 = i0 * 3, k1 = i1 * 3;
      this.hx += (h[k0] + (h[k1] - h[k0]) * a) * w;
      this.hy += (h[k0 + 1] + (h[k1 + 1] - h[k0 + 1]) * a) * w;
      this.hz += (h[k0 + 2] + (h[k1 + 2] - h[k0 + 2]) * a) * w;
    } else {
      const lerp = (arr) => (arr ? arr[i0] + (arr[i1] - arr[i0]) * a : 0);
      this.hy += lerp(clip.tr.hy) * w;
      this.hx += lerp(clip.tr.hx) * w;
      this.hz += lerp(clip.tr.hz) * w;
    }
    this.w += w;
  }

  finish() {
    for (const j of this.joints) {
      const q = this.q[j];
      if (q.lengthSq() < 1e-8) q.identity();
      else q.normalize();
    }
    if (this.w > 0) { this.hy /= this.w; this.hx /= this.w; this.hz /= this.w; }
  }
}

export function clipDuration(clip) { return clip ? clip.n / clip.fps : 1; }
