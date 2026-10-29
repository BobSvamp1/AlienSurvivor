import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const FS_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Removes broken pixels (NaN / infinite brightness) before bloom spreads them as black blotches
const SafeColorShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: FS_VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 24.0), c.a);
    }`,
};

// Film-like color grading: contrast, split toning (cool shadows / warm highlights),
// saturation, vignette, slight chromatic aberration and film grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    contrast: { value: 1.12 },
    saturation: { value: 1.05 },
    shadowTint: { value: new THREE.Color('#1c3550') },
    highlightTint: { value: new THREE.Color('#ffd6a8') },
    split: { value: 0.18 },
    vignette: { value: 0.42 },
    grain: { value: 0.045 },
    aberration: { value: 0.0025 },
    lift: { value: 0.0 },
    hurt: { value: 0 },
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float contrast; uniform float saturation;
    uniform vec3 shadowTint; uniform vec3 highlightTint; uniform float split; uniform float vignette;
    uniform float grain; uniform float aberration; uniform float lift; uniform float hurt;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + time * 7.13) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // chromatic aberration grows towards the edges
      vec2 off = d * aberration * (1.0 + r2 * 4.0) * (1.0 + hurt * 3.0);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      // contrast around mid grey
      c = (c - 0.5) * contrast + 0.5 + lift;
      // saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      // split toning
      vec3 st = mix(shadowTint, highlightTint, smoothstep(0.0, 1.0, l));
      c = mix(c, c * st * 1.6, split);
      // vignette
      float v = smoothstep(0.85, 0.15, r2 * 2.2);
      c *= mix(1.0 - vignette, 1.0, v);
      c = mix(c, c * vec3(1.0, 0.35, 0.35), hurt * (1.0 - v) * 0.8);
      // grain
      c += (rand(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// Quality presets.
export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024, post: false, bloom: false, ao: false, samples: 0 },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, post: true, bloom: true, ao: false, samples: 2 },
  high: { pixelRatio: 1.25, shadows: true, shadowSize: 2048, post: true, bloom: true, ao: true, samples: 4 },
};

export class Renderer {
  constructor(container) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.domElement = r.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Soft reflections for metal surfaces
    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.35;

    this.composer = null;
    this.quality = null;
    this.gradeU = GradeShader.uniforms;
    window.addEventListener('resize', () => this.resize());
  }

  // Per-map color grade
  setGrade(g) {
    g = g || {};
    const u = this.gradeU;
    u.contrast.value = g.contrast ?? 1.12;
    u.saturation.value = g.saturation ?? 1.05;
    u.shadowTint.value.set(g.shadowTint ?? '#1c3550');
    u.highlightTint.value.set(g.highlightTint ?? '#ffd6a8');
    u.split.value = g.split ?? 0.18;
    u.vignette.value = g.vignette ?? 0.42;
    u.lift.value = g.lift ?? 0;
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    this.qualityName = name;
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) {
        o.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        if (o.shadow.map) {
          o.shadow.map.dispose();
          o.shadow.map = null;
        }
      }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.ao = null;
    if (q.post) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.samples });
      const composer = new EffectComposer(r, rt);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (q.ao) {
        const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
        ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.5, thickness: 1.5, scale: 1.25, samples: 12, distanceFallOff: 1.0 });
        ao.blendIntensity = 0.95;
        // transparent things (sky, fog, beams, splats) should not cast ambient occlusion
        const cache = ao._visibilityCache;
        ao._overrideVisibility = () => {
          this.scene.traverse((o) => {
            if (!o.visible) return;
            const m = o.material;
            const skip = o.isPoints || o.isLine || o.isSprite || o.userData.noAO || (m && !Array.isArray(m) && (m.transparent || m.depthWrite === false));
            if (skip) { o.visible = false; cache.push(o); }
          });
        };
        composer.addPass(ao);
        this.ao = ao;
      }
      composer.addPass(new ShaderPass(SafeColorShader));
      if (q.bloom) {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 1.4);
        composer.addPass(this.bloom);
      }
      composer.addPass(new OutputPass());
      // share uniforms so map grades apply live
      const grade = new ShaderPass(new THREE.ShaderMaterial({ uniforms: this.gradeU, vertexShader: GradeShader.vertexShader, fragmentShader: GradeShader.fragmentShader }));
      composer.addPass(grade);
      this.composer = composer;
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  render(time = 0) {
    this.gradeU.time.value = time % 100;
    // update all matrices once; the shadow, AO and color passes then reuse them
    const sc = this.scene;
    sc.updateMatrixWorld();
    sc.matrixWorldAutoUpdate = false;
    if (this.composer) this.composer.render();
    else this.renderer.render(sc, this.camera);
    sc.matrixWorldAutoUpdate = true;
  }
}
