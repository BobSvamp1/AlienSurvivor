import * as THREE from 'three';

// Realistic PBR materials using photo-scanned textures from Poly Haven (CC0).
// Each set has: _diff (color), _nor (normal, OpenGL), _arm (R = ambient occlusion, G = roughness, B = metalness).

const BASE = (import.meta.env?.BASE_URL || '/') + 'textures/';
const loader = new THREE.TextureLoader();
const cache = new Map();

function tex(name, srgb) {
  const key = name + (srgb ? ':s' : '');
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(BASE + name + '.jpg');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function texSet(name) {
  return { diff: tex(name + '_diff', true), nor: tex(name + '_nor', false), arm: tex(name + '_arm', false) };
}

// A standard material that uses the object's own UVs (for buildings, weapon, debris)
export function pbr(name, { color = '#ffffff', repeat = 1, normalScale = 1, roughness = 1, metalness = 1, emissive, emissiveIntensity } = {}) {
  const s = texSet(name);
  const clone = (t) => {
    if (repeat === 1) return t;
    const c = t.clone();
    c.repeat.set(repeat, repeat);
    c.needsUpdate = true;
    return c;
  };
  const arm = clone(s.arm);
  const m = new THREE.MeshStandardMaterial({
    color, map: clone(s.diff), normalMap: clone(s.nor), normalScale: new THREE.Vector2(normalScale, normalScale),
    aoMap: arm, roughnessMap: arm, metalnessMap: arm, roughness, metalness,
  });
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity ?? 1; }
  return m;
}

// ---------------------------------------------------------------------------
// Triplanar materials: textures are projected in world space from three sides,
// so rocks and terrain never show stretched or seamed textures.
// top = texture set for upward-facing surfaces, side = for steep surfaces.

const TRI_PARS = /* glsl */ `
uniform sampler2D tTopD; uniform sampler2D tTopN; uniform sampler2D tTopA;
uniform sampler2D tSideD; uniform sampler2D tSideN; uniform sampler2D tSideA;
uniform float topScale; uniform float sideScale; uniform float sharp; uniform float normalStrength;
uniform vec3 topTint; uniform vec3 sideTint;
varying vec3 vTriPos; varying vec3 vTriNormal;
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(sharp)); return w / (w.x + w.y + w.z); }
`;

export function triplanar({ top, side = top, topScale = 0.25, sideScale = 0.25, color = '#ffffff', topTint = '#ffffff', sideTint = '#ffffff', sharp = 4, vertexColors = false, normalStrength = 1, roughness = 1, metalness = 0, slopeBlend = true } = {}) {
  const T = texSet(top);
  const S = texSet(side);
  const m = new THREE.MeshStandardMaterial({ color, vertexColors, roughness, metalness });
  const uniforms = {
    tTopD: { value: T.diff }, tTopN: { value: T.nor }, tTopA: { value: T.arm },
    tSideD: { value: S.diff }, tSideN: { value: S.nor }, tSideA: { value: S.arm },
    topScale: { value: topScale }, sideScale: { value: sideScale }, sharp: { value: sharp },
    normalStrength: { value: normalStrength },
    topTint: { value: new THREE.Color(topTint) }, sideTint: { value: new THREE.Color(sideTint) },
  };
  m.userData.tri = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 triWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          triWorld = instanceMatrix * triWorld;
        #endif
        triWorld = modelMatrix * triWorld;
        vTriPos = triWorld.xyz;
        vec3 triN = objectNormal;
        #ifdef USE_INSTANCING
          triN = mat3(instanceMatrix) * triN;
        #endif
        vTriNormal = normalize(mat3(modelMatrix) * triN);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TRI_PARS)
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 tN = normalize(vTriNormal);
        vec3 tw = triW(tN);
        // the top texture only where the actual triangle is flat enough: on tall cliffs one
        // triangle spans metres of height, and blending by the smoothed vertex normal
        // smeared the ground texture up the wall in long pale spikes
        float faceY = abs(normalize(cross(dFdx(vTriPos), dFdy(vTriPos))).y);
        ${slopeBlend ? 'float topK = smoothstep(0.55, 0.85, min(tN.y, faceY));' : 'float topK = tw.y;'}
        vec2 uvX = vTriPos.zy * sideScale; vec2 uvZ = vTriPos.xy * sideScale;
        vec2 uvYt = vTriPos.xz * topScale; vec2 uvYs = vTriPos.xz * sideScale;
        // side texture projected three ways
        vec3 sideCol = (texture2D(tSideD, uvX).rgb * tw.x + texture2D(tSideD, uvYs).rgb * tw.y + texture2D(tSideD, uvZ).rgb * tw.z) * sideTint;
        vec3 sideArm = texture2D(tSideA, uvX).rgb * tw.x + texture2D(tSideA, uvYs).rgb * tw.y + texture2D(tSideA, uvZ).rgb * tw.z;
        vec3 topCol = texture2D(tTopD, uvYt).rgb * topTint;
        vec3 topArm = texture2D(tTopA, uvYt).rgb;
        vec3 triCol = mix(sideCol, topCol, topK);
        vec3 triArm = mix(sideArm, topArm, topK);
        diffuseColor.rgb *= triCol;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * triArm.g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * triArm.b;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        {
          // whiteout-blended triplanar normal mapping (world space)
          vec3 nx = texture2D(tSideN, uvX).xyz * 2.0 - 1.0;
          vec3 ny = mix(texture2D(tSideN, uvYs).xyz, texture2D(tTopN, uvYt).xyz, topK) * 2.0 - 1.0;
          vec3 nz = texture2D(tSideN, uvZ).xyz * 2.0 - 1.0;
          nx.xy *= normalStrength; ny.xy *= normalStrength; nz.xy *= normalStrength;
          nx = vec3(nx.xy + tN.zy, abs(nx.z) * tN.x);
          ny = vec3(ny.xy + tN.xz, abs(ny.z) * tN.y);
          nz = vec3(nz.xy + tN.xy, abs(nz.z) * tN.z);
          vec3 wn = normalize(nx.zyx * tw.x + ny.xzy * tw.y + nz.xyz * tw.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <aomap_fragment>', /* glsl */ `
        {
          float ambientOcclusion = mix(1.0, triArm.r, 0.85);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            reflectedLight.indirectSpecular *= ambientOcclusion;
          #endif
        }`);
  };
  m.customProgramCacheKey = () => `tri-${top}-${side}-${slopeBlend}-${vertexColors}`;
  return m;
}

// Smooth painted / bare metal with subtle wear (for the rifle)
export function wornMetal(color, { metalness = 0.75, roughness = 0.55, repeat = 2, scratches = 0.18 } = {}) {
  const r = texSet('rust');
  const arm = r.arm.clone(); arm.repeat.set(repeat, repeat); arm.needsUpdate = true;
  const nor = r.nor.clone(); nor.repeat.set(repeat, repeat); nor.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, roughnessMap: arm, normalMap: nor, normalScale: new THREE.Vector2(scratches, scratches) });
  // the map has near-mirror spots that catch the sun as blinding, blooming highlights
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = max(roughnessFactor, 0.32);');
  };
  m.customProgramCacheKey = () => 'wornMetal';
  return m;
}
