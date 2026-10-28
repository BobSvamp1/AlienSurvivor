import * as THREE from 'three';
import { wornMetal } from '../core/materials.js';

// Third-person look of another player: an armoured space marine in the player's
// colour, holding a rifle, with walking legs, aim pitch and a floating name tag.

export const PLAYER_COLORS = ['#3de0ff', '#ffb43d', '#7dff6a', '#ff5ad1'];

const shared = {};
function mats(color) {
  const key = color;
  if (shared[key]) return shared[key];
  const c = new THREE.Color(color);
  shared[key] = {
    suit: new THREE.MeshStandardMaterial({ color: '#2a3038', roughness: 0.8, metalness: 0.1 }),
    armor: wornMetal('#' + new THREE.Color('#c8ccd2').lerp(c, 0.35).getHexString(), { metalness: 0.45, roughness: 0.5, scratches: 0.3 }),
    dark: wornMetal('#1a1d22', { metalness: 0.6, roughness: 0.6 }),
    accent: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.4 }),
    visor: new THREE.MeshStandardMaterial({ color: '#0a1218', emissive: c, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.9 }),
  };
  return shared[key];
}

function nameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(5, 10, 18, 0.6)';
  g.fillRect(8, 10, 240, 44);
  g.fillStyle = color;
  g.fillRect(8, 10, 6, 44);
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(name.slice(0, 14), 132, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  s.scale.set(1.3, 0.325, 1);
  s.renderOrder = 10;
  return s;
}

export class Avatar {
  constructor(scene, name, color) {
    this.scene = scene;
    const M = mats(color);
    const root = new THREE.Group();
    const box = (w, h, d, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const cap = (r, len, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // legs: hip pivot -> thigh -> knee pivot -> shin + boot
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0.92, 0);
      root.add(hip);
      cap(0.085, 0.3, M.suit, 0, -0.22, 0, hip);
      box(0.17, 0.2, 0.12, M.armor, 0, -0.18, -0.05, hip); // thigh plate
      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      hip.add(knee);
      cap(0.075, 0.3, M.suit, 0, -0.2, 0, knee);
      box(0.15, 0.24, 0.1, M.armor, 0, -0.18, -0.06, knee); // shin guard
      box(0.16, 0.1, 0.27, M.dark, 0, -0.43, -0.04, knee); // boot
      this.legs.push({ hip, knee, side });
    }

    // upper body (turns with the aim)
    const body = new THREE.Group();
    body.position.y = 0.95;
    root.add(body);
    this.body = body;
    box(0.36, 0.14, 0.22, M.dark, 0, 0.03, 0, body); // belt
    cap(0.17, 0.22, M.suit, 0, 0.3, 0, body);
    box(0.42, 0.34, 0.27, M.armor, 0, 0.36, -0.01, body); // chest plate
    box(0.2, 0.06, 0.02, M.accent, 0, 0.42, -0.15, body); // chest light
    box(0.34, 0.4, 0.17, M.dark, 0, 0.33, 0.2, body); // backpack
    box(0.05, 0.25, 0.04, M.accent, 0.12, 0.33, 0.29, body);
    box(0.05, 0.25, 0.04, M.accent, -0.12, 0.33, 0.29, body);
    for (const side of [-1, 1]) box(0.16, 0.1, 0.24, M.armor, side * 0.27, 0.53, 0, body); // shoulder pads

    // head with helmet, pitches with the aim
    const head = new THREE.Group();
    head.position.y = 0.66;
    body.add(head);
    this.head = head;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), M.armor);
    helm.scale.set(1, 1.08, 1.1);
    helm.position.y = 0.1;
    helm.castShadow = true;
    head.add(helm);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 18, 10, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.35, Math.PI * 0.28), M.visor);
    visor.scale.set(1.02, 1.1, 1.12);
    visor.position.y = 0.1;
    head.add(visor);
    box(0.03, 0.08, 0.05, M.accent, 0.15, 0.12, 0.02, head); // helmet lamp

    // arms + rifle (pitch with the aim too)
    const aim = new THREE.Group();
    aim.position.set(0, 0.48, 0);
    body.add(aim);
    this.aim = aim;
    const gun = new THREE.Group();
    gun.position.set(0.12, -0.08, -0.32);
    aim.add(gun);
    box(0.07, 0.11, 0.6, M.dark, 0, 0, 0, gun);
    box(0.08, 0.05, 0.3, M.armor, 0, 0.07, -0.05, gun);
    box(0.02, 0.03, 0.22, M.accent, 0.045, 0.0, -0.1, gun);
    box(0.06, 0.14, 0.06, M.dark, 0, -0.11, 0.1, gun); // grip
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12).rotateX(Math.PI / 2), M.dark);
    scope.position.set(0, 0.12, 0);
    gun.add(scope);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.34);
    gun.add(this.muzzle);
    // arms reaching to the gun
    const armR = cap(0.065, 0.3, M.suit, 0.2, -0.08, -0.12, aim);
    armR.rotation.set(1.2, 0, 0.2);
    const armL = cap(0.06, 0.38, M.suit, -0.06, -0.1, -0.28, aim);
    armL.rotation.set(1.35, 0, -0.9);
    box(0.08, 0.08, 0.1, M.dark, 0.13, -0.12, -0.2, aim); // right glove
    box(0.08, 0.08, 0.1, M.dark, 0.08, -0.06, -0.5, aim); // left glove

    // name tag
    this.tag = nameTag(name, color);
    this.tag.position.y = 2.25;
    root.add(this.tag);

    root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(root);
    this.root = root;
    this.walk = 0;
    this.downT = 0;
  }

  // pos: feet position; yaw/pitch: view angles; speed: horizontal speed
  update(dt, pos, yaw, pitch, speed, dead) {
    const r = this.root;
    r.position.copy(pos);
    r.rotation.y = yaw;
    this.aim.rotation.x = pitch * 0.9;
    this.head.rotation.x = pitch * 0.6;
    this.body.rotation.x = pitch * 0.15;
    // walking cycle
    const moving = Math.min(1, speed / 5);
    this.walk += dt * speed * 1.9;
    for (const l of this.legs) {
      const s = Math.sin(this.walk + (l.side > 0 ? Math.PI : 0));
      l.hip.rotation.x = s * 0.55 * moving;
      l.knee.rotation.x = Math.max(0, -Math.cos(this.walk + (l.side > 0 ? Math.PI : 0))) * 0.9 * moving;
    }
    this.body.position.y = 0.95 + Math.abs(Math.sin(this.walk)) * 0.04 * moving;
    // knocked down: lie on the ground
    this.downT += ((dead ? 1 : 0) - this.downT) * Math.min(1, dt * 5);
    r.rotation.x = -this.downT * 1.45;
    r.position.y = pos.y + this.downT * 0.25;
    this.tag.visible = this.downT < 0.5;
  }

  muzzleWorld(out) { this.muzzle.getWorldPosition(out); return out; }

  dispose() {
    this.scene.remove(this.root);
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}
