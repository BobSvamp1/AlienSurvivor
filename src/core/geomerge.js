import * as THREE from 'three';

// Merge several geometries (position / normal / uv, optional color) into one.
// Each geometry may carry a world-space matrix in `geo.userData.matrix`.
export function mergeGeos(geos) {
  const parts = geos.map((g) => {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (g.userData.matrix) geo.applyMatrix4(g.userData.matrix);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    return geo;
  });
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// Collapse all static meshes below `root` that share a material into one mesh per material.
// Meshes listed in `keep` (or below a kept object) are left alone.
export function mergeStatic(root, keep = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const keepSet = new Set();
  for (const k of keep) k.traverse((o) => keepSet.add(o));
  const groups = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || keepSet.has(o) || Array.isArray(o.material) || o.isInstancedMesh || o.isSkinnedMesh) return;
    const list = groups.get(o.material) || [];
    const g = o.geometry.clone();
    g.userData.matrix = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    list.push(g);
    groups.set(o.material, list);
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  const made = [];
  for (const [mat, list] of groups) {
    const m = new THREE.Mesh(mergeGeos(list), mat);
    root.add(m);
    made.push(m);
  }
  return made;
}
