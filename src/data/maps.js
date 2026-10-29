// Map definitions. Each map has a look (theme) and a layout.
// The layout marks grid cells (2x2 m) as blocked rocks/ice/trees or as acid pools.
// Builder helpers: rock(x, z, r), line(x1, z1, x2, z2, width), clear(x, z, r), pool(x, z, r)

// The maps are played in this order: each one unlocks the next (see unlocked()). The
// first ones have a single route to the core, later ones more and more ways in.
export const MAPS = [
  {
    id: 'landing',
    name: 'Landing Zone',
    subtitle: 'One Way In',
    description: 'Your dropship came down at the end of a long, winding canyon. The swarm has only one way to the core: line the corridor with traps and hold it.',
    difficulty: 1,
    waves: 10,
    finalBosses: 1,
    ease: 0.8,
    enemyBias: { wasp: 0.5, floater: 0.5, drone: 1.3 },
    halfX: 34,
    halfZ: 58,
    core: [0, 40],
    spawn: [0, 31],
    hives: [[0, -46]],
    tightClutter: true,
    dressing: { light: '#ffe2b0', gateLight: '#ffb070' },
    theme: {
      grade: { contrast: 1.12, saturation: 1.0, shadowTint: '#3a2a48', highlightTint: '#ffd0a0', split: 0.2, vignette: 0.45 },
      atmosphere: { mist: 0.12 },
      materials: { ground: 'ground_canyon', groundTint: '#ece4dc', cliffTint: '#cc9478', cliffSide: 'cliff', rockTop: 'ground_canyon', rockSide: 'cliff', rockTint: '#c8846a', rockTopTint: '#ffffff' },
      day: { top: '#3f6aa6', horizon: '#ffb488', bottom: '#a8603f', sun: '#ffdcb4', sunI: 3.1, hemi: 0.62, fog: '#dc9c74' },
      night: { top: '#0a0820', horizon: '#3a2448', bottom: '#1a1020', sun: '#ffb0a0', sunI: 1.5, hemi: 0.8, fog: '#251428' },
      fogNear: 35, fogFar: 175,
      ground: ['#8c5a40', '#6e4630', '#a87050'],
      cliff: '#6a3a28',
      rock: '#7a4a34',
      obstacleStyle: 'rock',
      prop: 'crystal',
      propColor: '#3de0ff',
      particles: 'dust',
      planet: { color: '#ffe0c8', ring: false, pos: [-180, 150, -300], size: 40 },
      sunDir: [-0.4, 0.62, -0.45],
      exposure: 1.0,
      cliffHeight: 1.6,
    },
    elevation(e) {
      e.base(7);
      // the hive cave at the far end
      e.poly([[-12, -57], [0, -60], [12, -56], [14, -46], [9, -37], [-9, -37], [-14, -46]], 0, { rough: 1.4 });
      // one long switchback corridor
      const C = (x1, z1, x2, z2, w = 7) => e.ramp(x1, z1, x2, z2, w, 0, 0);
      C(0, -40, 0, -23);
      C(-3.5, -26, 23.5, -26);
      C(20, -29.5, 20, -2.5);
      C(23.5, -6, -23.5, -6);
      C(-20, -9.5, -20, 17.5);
      C(-23.5, 14, 3.5, 14);
      C(0, 10.5, 0, 31);
      // the core yard
      e.circle(0, 40, 11, 0, { rough: 0.6 });
    },
    layout(b, rng) {
      for (const [x, z, r] of [[-6, -50, 1.3], [7, -52, 1.2]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
    },
  },
  {
    id: 'gorge',
    name: 'Twin Gorge',
    subtitle: 'Two Hives, Two Roads',
    description: 'Two hives, two canyons and a crossing between them. The swarm splits up and can switch roads halfway: watch both sides.',
    difficulty: 1,
    waves: 12,
    finalBosses: 1,
    ease: 0.85,
    enemyBias: { wasp: 0.6, floater: 0.6 },
    halfX: 46,
    halfZ: 58,
    core: [0, 38],
    spawn: [0, 29],
    hives: [[-32, -46], [32, -46]],
    tightClutter: true,
    dressing: { light: '#ffd8a8', gateLight: '#ff9a60' },
    theme: {
      grade: { contrast: 1.15, saturation: 0.92, shadowTint: '#40283a', highlightTint: '#ffb880', split: 0.24, vignette: 0.5 },
      atmosphere: { mist: 0.16 },
      materials: { ground: 'ground_canyon', groundTint: '#e2d4c8', cliffTint: '#b8785e', cliffSide: 'cliff', rockTop: 'ground_canyon', rockSide: 'cliff', rockTint: '#b87a62', rockTopTint: '#ffffff' },
      day: { top: '#4a5a8e', horizon: '#ff9a6a', bottom: '#9a5038', sun: '#ffc490', sunI: 2.8, hemi: 0.58, fog: '#cc8060' },
      night: { top: '#0a0820', horizon: '#3a2448', bottom: '#1a1020', sun: '#ffb0a0', sunI: 1.5, hemi: 0.8, fog: '#251428' },
      fogNear: 35, fogFar: 175,
      ground: ['#8c5a40', '#6e4630', '#a87050'],
      cliff: '#6a3a28',
      rock: '#7a4a34',
      obstacleStyle: 'rock',
      prop: 'crystal',
      propColor: '#3de0ff',
      particles: 'dust',
      planet: { color: '#cfe4ff', ring: true, pos: [240, 120, -240], size: 46 },
      sunDir: [0.5, 0.45, -0.55],
      exposure: 1.0,
      cliffHeight: 1.6,
    },
    elevation(e) {
      e.base(7);
      // two hive caves
      e.poly([[-44, -56], [-32, -60], [-20, -56], [-19, -45], [-24, -36], [-40, -36], [-45, -45]], 0, { rough: 1.4 });
      e.poly([[44, -56], [32, -60], [20, -56], [19, -45], [24, -36], [40, -36], [45, -45]], 0, { rough: 1.4 });
      const C = (x1, z1, x2, z2, w = 7) => e.ramp(x1, z1, x2, z2, w, 0, 0);
      // the west and east canyons
      C(-32, -39, -32, 20);
      C(32, -39, 32, 20);
      // the crossing halfway down, so the swarm can change sides
      C(-35, -8, 35, -8, 6);
      // into the core yard from both sides
      C(-34, 18, -8, 36);
      C(34, 18, 8, 36);
      e.circle(0, 38, 12, 0, { rough: 0.6 });
    },
    layout(b, rng) {
      for (const [x, z, r] of [[-36, -50, 1.3], [-27, -52, 1.1], [36, -50, 1.3], [27, -52, 1.1], [0, -8, 0.6]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
    },
  },
  {
    id: 'outpost',
    name: 'Kepler Outpost',
    subtitle: 'The Stranded Crew',
    description: 'Your wrecked outpost is cut deep into the rock. Three hive caves, winding corridors and bottomless chasms surround the cross-shaped core hall. Four gates lead in: block some, trap the others.',
    difficulty: 2,
    halfX: 56,
    halfZ: 62,
    core: [0, 20],
    spawn: [0, 11],
    hives: [[-27, -47], [27, -48], [-43, 33]],
    enemyBias: { leaper: 1.2, brute: 1.2, serpent: 1.2 },
    tightClutter: true,
    waves: 15,
    dressing: { light: '#ffe2b0', gateLight: '#ffb070' },
    gates: [[0, 6, 'z', 4], [0, 34, 'z', 4], [-16, 20, 'x', 4], [16, 20, 'x', 4]],
    theme: {
      grade: { contrast: 1.16, saturation: 0.95, shadowTint: '#3a2a48', highlightTint: '#ffc090', split: 0.22, vignette: 0.5 },
      atmosphere: { mist: 0.14 },
      materials: { ground: 'ground_canyon', groundTint: '#e8e0d8', cliffTint: '#c88a70', cliffSide: 'cliff', rockTop: 'ground_canyon', rockSide: 'cliff', rockTint: '#c8846a', rockTopTint: '#ffffff' },
      day: { top: '#3a5f96', horizon: '#ffa77a', bottom: '#a8603f', sun: '#ffd0a8', sunI: 3.0, hemi: 0.6, fog: '#d8906a' },
      night: { top: '#0a0820', horizon: '#3a2448', bottom: '#1a1020', sun: '#ffb0a0', sunI: 1.5, hemi: 0.8, fog: '#251428' },
      fogNear: 35, fogFar: 175,
      ground: ['#8c5a40', '#6e4630', '#a87050'],
      cliff: '#6a3a28',
      rock: '#7a4a34',
      obstacleStyle: 'rock',
      prop: 'crystal',
      propColor: '#3de0ff',
      particles: 'dust',
      planet: { color: '#cfe4ff', ring: true, pos: [200, 130, -280], size: 44 },
      sunDir: [0.45, 0.6, -0.5],
      exposure: 1.0,
      cliffHeight: 1.6,
    },
    elevation(e) {
      e.base(7); // solid rock; every room and corridor is cut into it
      // --- hive caves (rough, natural walls)
      e.poly([[-44, -56], [-30, -60], [-16, -57], [-13, -46], [-15, -36], [-17, -29], [-28, -28], [-38, -31], [-43, -40]], 0, { rough: 1.4 });
      e.poly([[13, -58], [26, -61], [40, -58], [43, -47], [40, -36], [32, -29], [18, -29], [14, -38]], 0, { rough: 1.4 });
      e.poly([[-54, 22], [-44, 18], [-33, 21], [-30, 30], [-33, 42], [-40, 47], [-50, 45], [-55, 34]], 0, { rough: 1.4 });
      // --- chasms (Launch Pads can throw aliens in)
      e.rect(-8, -38, 8, -30, -18, { rough: 0.3 }); // north of the connector
      e.rect(-12, 42, 4, 48, -18, { rough: 0.3 }); // between the south corridors
      e.rect(24, 8, 32, 22, -18, { rough: 0.3 }); // east of the ring
      e.rect(-32, -16, -24, -4, -18, { rough: 0.3 }); // west of the ring
      // --- corridors (straight, so wall traps fit along them)
      const C = (x1, z1, x2, z2, w = 6) => e.ramp(x1, z1, x2, z2, w, 0, 0);
      C(-24, -27, 24, -27); // connector between the two northern caves
      C(-21, -33, -21, 42); // west corridor + west side of the ring
      C(21, -33, 21, 42); // east corridor + east side of the ring
      C(-24, 1, 24, 1); // north side of the ring
      C(-24, 39, 24, 39); // south side of the ring
      C(-36, 28, -18, 28, 4); // narrow pass from the south-west cave
      C(-44, 51, 14, 51); // long south corridor
      C(11, 54, 11, 36); // up into the ring
      C(-43, 40, -43, 54); // from the south-west cave down to it
      // --- the cross-shaped core hall and its four gates
      e.rect(-6, 8, 6, 32, 0, { rough: 0 });
      e.rect(-14, 14, 14, 26, 0, { rough: 0 });
      e.rect(-2, 3, 2, 9, 0, { rough: 0 }); // north gate
      e.rect(-2, 31, 2, 37, 0, { rough: 0 }); // south gate
      e.rect(-19, 18, -13, 22, 0, { rough: 0 }); // west gate
      e.rect(13, 18, 19, 22, 0, { rough: 0 }); // east gate
    },
    layout(b, rng) {
      // pillars in the core hall and in the caves
      for (const [x, z] of [[-9, 15], [9, 15], [-9, 25], [9, 25]]) b.rock(x, z, 0.6);
      for (const [x, z, r] of [[-35, -40, 1.8], [-21, -52, 1.4], [33, -41, 1.8], [21, -54, 1.4], [-48, 28, 1.6]]) b.rock(x + (rng() - 0.5), z + (rng() - 0.5), r);
    },
  },
  {
    id: 'rift',
    name: "Hadley's Rift",
    subtitle: 'Bridges over the Abyss',
    description: 'A research station on the edge of a bottomless rift. Three narrow bridges lead straight to the core, long tunnels go around. Throw them off the bridges!',
    difficulty: 2,
    waves: 15,
    halfX: 52,
    halfZ: 60,
    core: [0, 37],
    spawn: [0, 28],
    hives: [[0, -49], [-40, -24], [40, -24]],
    enemyBias: { swarmling: 1.3, serpent: 1.3, ravager: 1.2, wasp: 1.2 },
    tightClutter: true,
    dressing: { light: '#d8f0ff', gateLight: '#7ad0ff' },
    gates: [[-8, 25, 'z', 4], [8, 25, 'z', 4]],
    theme: {
      grade: { contrast: 1.12, saturation: 0.85, shadowTint: '#1c3a5a', highlightTint: '#eaf4ff', split: 0.18, vignette: 0.48 },
      atmosphere: { mist: 0.22, mistCount: 44 },
      materials: { ground: 'ground_frost', groundTint: '#e6eef6', cliffTint: '#a9bdd2', rockTop: 'ground_frost', rockSide: 'rock', rockTint: '#93a8bd', rockTopTint: '#ffffff' },
      day: { top: '#2f5f9e', horizon: '#bcd8f2', bottom: '#8aa8c4', sun: '#f2f8ff', sunI: 2.6, hemi: 0.66, fog: '#a8c4dc' },
      night: { top: '#040a1c', horizon: '#1c3c6a', bottom: '#0c1a33', sun: '#a8ccff', sunI: 1.6, hemi: 0.82, fog: '#122744' },
      fogNear: 35, fogFar: 170,
      ground: ['#c9d6e2', '#a8bacb', '#e0e8f0'],
      cliff: '#6f88a3',
      rock: '#9fb8d0',
      obstacleStyle: 'ice',
      prop: 'icecrystal',
      propColor: '#5ad8ff',
      particles: 'snow',
      planet: { color: '#c9d8ff', ring: true, pos: [-220, 150, -260], size: 52 },
      sunDir: [-0.35, 0.55, -0.6],
      exposure: 0.95,
      cliffHeight: 1.6,
    },
    elevation(e) {
      e.base(7);
      // the rift: a bottomless chasm across the whole station
      e.rect(-34, -9, 34, 15, -22, { rough: 1.2 });
      // hive caves
      e.poly([[-12, -58], [0, -60], [12, -57], [14, -46], [8, -38], [-8, -38], [-14, -46]], 0, { rough: 1.3 });
      e.poly([[-50, -32], [-40, -36], [-30, -32], [-28, -20], [-34, -13], [-46, -14], [-51, -22]], 0, { rough: 1.3 });
      e.poly([[50, -32], [40, -36], [30, -32], [28, -20], [34, -13], [46, -14], [51, -22]], 0, { rough: 1.3 });
      const C = (x1, z1, x2, z2, w = 6) => e.ramp(x1, z1, x2, z2, w, 0, 0);
      // north landing above the rift, with tunnels from the three caves
      e.rect(-24, -16, 24, -9, 0, { rough: 0.3 });
      C(0, -40, 0, -14);
      C(-37, -13, -18, -13, 6);
      C(37, -13, 18, -13, 6);
      // three bridges over the abyss
      C(-14, -12, -14, 18, 4);
      C(0, -12, 0, 18, 4);
      C(14, -12, 14, 18, 4);
      // south landing and two gates into the core yard
      e.rect(-24, 15, 24, 22, 0, { rough: 0.3 });
      e.circle(0, 37, 11, 0, { rough: 0.5 });
      e.rect(-10, 21, -6, 29, 0, { rough: 0 });
      e.rect(6, 21, 10, 29, 0, { rough: 0 });
      // long tunnels around the rift (the slow way)
      C(-43, -14, -43, 50); C(-43, 47, -3, 47, 6);
      C(43, -14, 43, 50); C(43, 47, 3, 47, 6);
    },
    layout(b, rng) {
      for (const [x, z, r] of [[-5, -50, 1.4], [6, -54, 1.2], [-44, -27, 1.4], [44, -27, 1.4], [-43, 22, 0.6], [43, 22, 0.6]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
    },
  },
  {
    id: 'frost',
    name: 'Frost Moon',
    subtitle: 'Outpost Glacier-7',
    description: 'A ring of ice spires guards the core, with four gaps the swarm will pour through. Hives wake in every corner.',
    difficulty: 3,
    waves: 20,
    halfX: 56,
    halfZ: 56,
    core: [0, 0],
    spawn: [0, 8],
    hives: [[-46, -46], [46, -46], [46, 46], [-46, 46]],
    enemyBias: { wasp: 1.5, swarmling: 1.3, floater: 1.6, bulwark: 1.3 },
    theme: {
      grade: { contrast: 1.1, saturation: 0.85, shadowTint: '#1c3a5a', highlightTint: '#eaf4ff', split: 0.18, vignette: 0.42 },
      atmosphere: { mist: 0.18, mistCount: 44 },
      materials: { ground: 'ground_frost', groundTint: '#f4f9ff', cliffTint: '#a9bdd2', rockTop: 'ground_frost', rockSide: 'rock', rockTint: '#93a8bd', rockTopTint: '#ffffff' },
      day: { top: '#3a6fb8', horizon: '#cfe6ff', bottom: '#a9c4dd', sun: '#f2f8ff', sunI: 2.6, hemi: 0.68, fog: '#c4dcf2' },
      night: { top: '#040a1c', horizon: '#1c3c6a', bottom: '#0c1a33', sun: '#a8ccff', sunI: 1.6, hemi: 0.82, fog: '#122744' },
      fogNear: 35, fogFar: 170,
      ground: ['#dfe9f2', '#b8cadb', '#f4f8fc'],
      cliff: '#8aa4bf',
      rock: '#9fc3e6',
      obstacleStyle: 'ice',
      prop: 'icecrystal',
      propColor: '#5ad8ff',
      particles: 'snow',
      planet: { color: '#c9d8ff', ring: true, pos: [220, 150, 260], size: 58 },
      sunDir: [0.3, 0.5, 0.7],
      exposure: 0.95,
    },
    layout(b, rng) {
      // Ring of ice with four gaps
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const gap = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.16);
        if (gap) continue;
        b.rock(Math.cos(a) * 22, Math.sin(a) * 22, 1.6);
      }
      // Outer spires
      for (let i = 0; i < 22; i++) {
        const a = rng() * Math.PI * 2;
        const d = 30 + rng() * 18;
        b.rock(Math.cos(a) * d, Math.sin(a) * d, 1.3 + rng() * 1.8);
      }
    },
  },];

export const DIFFICULTIES = {
  recruit: { name: 'Recruit', hp: 0.7, dmg: 0.6, credits: 450, count: 0.75, desc: 'Weaker swarm, more starting crystals.' },
  veteran: { name: 'Veteran', hp: 1.0, dmg: 1.0, credits: 350, count: 1.0, desc: 'The intended experience.' },
  nightmare: { name: 'Nightmare', hp: 1.35, dmg: 1.3, credits: 250, count: 1.25, desc: 'Tougher, larger swarms. Good luck.' },
};

// a map is open once the one before it has been won (on any difficulty), or once it
// has been played already
export function unlocked(id, bestStars, bestWave) {
  const i = MAPS.findIndex((m) => m.id === id);
  if (i <= 0) return true;
  return bestStars(MAPS[i - 1].id) > 0 || bestStars(id) > 0 || bestWave(id) > 0;
}

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
