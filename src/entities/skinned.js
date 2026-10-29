import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Rigged character models (Mixamo skeletons). Each class can have a skinned model in
// models/<cls>.glb with its animation set in anim/<cls>.json: the Mixamo clips
// retargeted offline onto that model's own skeleton (per-bone local quaternions plus
// the hip position, 30 fps). Classes without a model keep the procedural avatar.

export const SKINNED = ['marine'];

const BASE = import.meta.env?.BASE_URL || '/';
const READY = {};
const loader = new GLTFLoader();

for (const cls of SKINNED) {
  Promise.all([
    loader.loadAsync(BASE + 'models/' + cls + '.glb'),
    fetch(BASE + 'anim/' + cls + '.json').then((r) => (r.ok ? r.json() : null)),
  ]).then(([gltf, data]) => {
    if (!gltf || !data) return;
    for (const c of Object.values(data.clips)) c.fps = data.fps;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // the skinned bounds don't follow the animation
      if (o.material.map) o.material.map.anisotropy = 4;
    });
    READY[cls] = { scene: gltf.scene, data };
  }).catch((e) => console.warn('model', cls, e));
}

export const skinnedReady = (cls) => READY[cls] || null;

// a fresh copy of the model (own skeleton, shared geometry + materials)
export function cloneSkinned(cls) {
  const R = READY[cls];
  if (!R) return null;
  const scene = SkeletonUtils.clone(R.scene);
  const bones = {};
  scene.traverse((o) => { if (o.isBone) bones[o.name.replace('mixamorig', '')] = o; });
  return { scene, bones, data: R.data };
}
