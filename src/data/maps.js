// Map definitions. Each map has a look (theme) and a layout.
// The layout marks grid cells (2x2 m) as blocked rocks/ice/trees or as acid pools.
// Builder helpers: rock(x, z, r), line(x1, z1, x2, z2, width), clear(x, z, r), pool(x, z, r)

export const MAPS = [
  {
    id: 'crash',
    name: 'Crash Site',
    subtitle: 'Wreck of the Odyssey',
    description: 'Open sand flats around the crashed colony ship. Four hives, lots of room to build. A good first stand.',
    difficulty: 1,
    halfX: 54,
    halfZ: 54,
    core: [0, 0],
    spawn: [0, 9],
    hives: [[0, -46], [46, 0], [0, 46], [-46, 0]],
    enemyBias: { ravager: 1.3 },
    theme: {
      grade: { contrast: 1.14, saturation: 0.92, shadowTint: '#2a3a52', highlightTint: '#ffd2a0', split: 0.2, vignette: 0.45 },
      atmosphere: { mist: 0.12 },
      materials: { ground: 'ground_crash', groundTint: '#e2bfa2', cliffTint: '#c8987a', rockTop: 'rock', rockSide: 'rock', rockTint: '#c99e86', rockTopTint: '#d6ad92' },
      day: { top: '#3d6fa8', horizon: '#f2b38a', bottom: '#c98a68', sun: '#ffe2bd', sunI: 2.8, hemi: 0.62, fog: '#e0a585' },
      night: { top: '#070b20', horizon: '#33305e', bottom: '#1a1630', sun: '#9fb0ff', sunI: 1.6, hemi: 0.82, fog: '#221e40' },
      fogNear: 40, fogFar: 190,
      ground: ['#8a6450', '#6c4a3c', '#a3785c'],
      cliff: '#5b3d33',
      rock: '#6e4a3d',
      obstacleStyle: 'rock',
      debris: true,
      prop: 'crystal',
      propColor: '#7b5cff',
      particles: 'dust',
      planet: { color: '#f6cfa8', ring: true, pos: [-200, 140, -320], size: 46 },
      sunDir: [0.55, 0.62, 0.35],
      exposure: 1.0,
    },
    layout(b, rng) {
      // The crashed ship hull, broken into pieces
      b.line(-24, 14, -10, 26, 2.6, 2);
      b.line(-7, 28, -2, 31, 2.2, 2);
      b.rock(-28, 10, 3.2, 2);
      b.line(18, -26, 28, -12, 2.4, 2);
      // Rock formations
      const spots = [[22, 20], [-22, -22], [30, 30], [-32, -36], [12, -36], [-38, 22], [36, -34], [-14, 40], [38, 14], [-40, -8]];
      for (const [x, z] of spots) b.rock(x + (rng() - 0.5) * 4, z + (rng() - 0.5) * 4, 2.5 + rng() * 2.5);
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const d = 16 + rng() * 30;
        b.rock(Math.cos(a) * d, Math.sin(a) * d, 1.2 + rng() * 1.2);
      }
    },
  },
  {
    id: 'canyon',
    name: 'Red Canyon',
    subtitle: 'The Serpent Pass',
    description: 'A long, narrow gorge. The swarm must snake through rock walls to reach your core. Perfect for choke points.',
    difficulty: 2,
    halfX: 28,
    halfZ: 62,
    core: [0, 48],
    spawn: [0, 39],
    hives: [[-15, -54], [0, -56], [15, -54]],
    enemyBias: { brute: 1.3, leaper: 1.3, burrower: 1.8, serpent: 1.3 },
    theme: {
      grade: { contrast: 1.16, saturation: 0.95, shadowTint: '#3a2a48', highlightTint: '#ffc090', split: 0.22, vignette: 0.48 },
      atmosphere: { mist: 0.1 },
      materials: { ground: 'ground_canyon', groundTint: '#ffffff', cliffTint: '#e09070', rockTop: 'ground_canyon', rockSide: 'cliff', rockTint: '#e0906c', rockTopTint: '#ffffff' },
      day: { top: '#4a78b0', horizon: '#ff9a6a', bottom: '#b8603f', sun: '#ffc79a', sunI: 3.0, hemi: 0.59, fog: '#e88b62' },
      night: { top: '#0a0820', horizon: '#4a2448', bottom: '#221020', sun: '#ffaa9a', sunI: 1.5, hemi: 0.78, fog: '#2b1428' },
      fogNear: 30, fogFar: 170,
      ground: ['#9c5536', '#7a3e28', '#b86a42'],
      cliff: '#7a3a24',
      rock: '#8a4630',
      obstacleStyle: 'mesa',
      prop: 'ember',
      propColor: '#ff7a3d',
      particles: 'embers',
      planet: { color: '#ffd0b0', ring: false, pos: [160, 110, -300], size: 30 },
      sunDir: [-0.4, 0.55, -0.6],
      exposure: 1.0,
      cliffHeight: 1.6,
    },
    layout(b, rng) {
      // Zig-zag walls that force a winding path
      b.line(-28, -24, 8, -24, 3.2);
      b.line(-8, -2, 28, -2, 3.2);
      b.line(-28, 20, 6, 20, 3.2);
      // Pillars
      for (const [x, z] of [[-14, -40], [12, -36], [16, -14], [-16, -12], [-14, 8], [14, 10], [-16, 32], [14, 30]]) {
        b.rock(x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3, 1.8 + rng() * 1.6);
      }
    },
  },
  {
    id: 'frost',
    name: 'Frost Moon',
    subtitle: 'Outpost Glacier-7',
    description: 'A ring of ice spires guards the core, with four gaps the swarm will pour through. Hives wake in every corner.',
    difficulty: 2,
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
  },
  {
    id: 'marsh',
    name: 'Toxic Marsh',
    subtitle: 'Spore Fields of Kepler-b',
    description: 'Acid pools, giant fungus and thick fog. Five hives, poor visibility and acid that burns anyone who wades in.',
    difficulty: 3,
    halfX: 52,
    halfZ: 52,
    core: [0, 0],
    spawn: [0, 8],
    hives: [[-42, -40], [10, -46], [44, -20], [40, 38], [-44, 30]],
    enemyBias: { spitter: 1.3, bloater: 1.6, serpent: 1.6, floater: 1.4 },
    theme: {
      grade: { contrast: 1.15, saturation: 0.9, shadowTint: '#12302a', highlightTint: '#e8ffc0', split: 0.22, vignette: 0.5 },
      atmosphere: { mist: 0.22, mistCount: 50, mistHeight: 1.0 },
      materials: { ground: 'ground_marsh', groundTint: '#9fb08a', cliffTint: '#7a8a72', rockTop: 'ground_marsh', rockSide: 'rock', rockTint: '#7d8a7a', rockTopTint: '#8fa080' },
      day: { top: '#3d6a5a', horizon: '#9fc79a', bottom: '#4f6a48', sun: '#e9ffc8', sunI: 2.2, hemi: 0.62, fog: '#8db38a' },
      night: { top: '#03100c', horizon: '#1a4232', bottom: '#0a1a12', sun: '#aaffcc', sunI: 1.3, hemi: 0.78, fog: '#0f2a1f' },
      fogNear: 18, fogFar: 120,
      ground: ['#4a5a35', '#3a4728', '#5d6e3e'],
      cliff: '#33402a',
      rock: '#4a3a52',
      obstacleStyle: 'fungus',
      prop: 'glowplant',
      propColor: '#b6ff3d',
      particles: 'spores',
      planet: { color: '#e6ffd0', ring: false, pos: [-120, 160, 300], size: 26 },
      sunDir: [0.2, 0.7, -0.5],
      exposure: 1.05,
    },
    layout(b, rng) {
      for (const [x, z, r] of [[-20, -16, 4.5], [22, 14, 5], [-14, 28, 3.5], [26, -30, 4], [-34, -2, 3.5], [8, 38, 3]]) b.pool(x, z, r);
      for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2;
        const d = 14 + rng() * 32;
        b.rock(Math.cos(a) * d, Math.sin(a) * d, 1.2 + rng() * 2.2);
      }
    },
  },
  {
    id: 'caverns',
    name: 'Hive Caverns',
    subtitle: 'Deep Under Tau-4',
    description: 'A huge cave lit only by shafts of sunlight and the core. Stone pillars split the hall and four tunnels pour the swarm in from the dark.',
    difficulty: 3,
    halfX: 50,
    halfZ: 50,
    core: [0, 0],
    spawn: [0, 9],
    hives: [[-44, -22], [44, -22], [28, 44], [-28, 44]],
    enemyBias: { burrower: 1.6, leaper: 1.3, serpent: 1.3, swarmling: 1.2 },
    theme: {
      grade: { contrast: 1.18, saturation: 0.95, shadowTint: '#1a2a4a', highlightTint: '#ffdcae', split: 0.24, vignette: 0.55, lift: 0.01 },
      atmosphere: { mist: 0.16, mistCount: 46, mistHeight: 1.2 },
      materials: { ground: 'ground_cave', groundTint: '#b9aca0', cliffTint: '#8a8290', rockTop: 'ground_cave', rockSide: 'cave_rock', rockTint: '#a49aa8', rockTopTint: '#b0a49a' },
      day: { top: '#7aa6d8', horizon: '#d8e6f4', bottom: '#52586a', sun: '#ffe6c0', sunI: 4.2, hemi: 0.32, fog: '#1d2233' },
      night: { top: '#0a1030', horizon: '#2a3a6a', bottom: '#10121c', sun: '#a8bcff', sunI: 2.2, hemi: 0.42, fog: '#121626' },
      fogNear: 14, fogFar: 115,
      ground: ['#5a5450', '#45403e', '#6a625c'],
      cliff: '#3a3640',
      rock: '#4a4450',
      obstacleStyle: 'rock',
      prop: 'crystal',
      propColor: '#3de0ff',
      particles: 'dust',
      planet: { color: '#ffffff', ring: false, pos: [0, 300, 0], size: 1 },
      sunDir: [0.22, 1, 0.12],
      exposure: 1.05,
      cliffHeight: 1.8,
      envIntensity: 0.18,
      cave: {
        height: 17,
        holes: [[0, 0, 4.5], [-22, 16, 3.5], [20, -8, 4], [-10, -26, 3], [14, 26, 3], [32, 6, 2.5], [-34, -6, 2.5]],
        pillars: [[-20, -12, 3.6], [22, 14, 3.4], [-6, 26, 3], [8, -28, 3.4], [-32, 22, 2.8], [34, -8, 2.6]],
      },
    },
    layout(b, rng) {
      for (const [x, z, r] of [[-20, -12, 3.6], [22, 14, 3.4], [-6, 26, 3], [8, -28, 3.4], [-32, 22, 2.8], [34, -8, 2.6]]) b.rock(x, z, r);
      // rubble ridges that break the hall into lanes
      b.line(-38, -36, -26, -30, 2.4);
      b.line(26, -38, 36, -34, 2.2);
      b.line(-14, 38, -4, 42, 2.2);
      b.line(40, 26, 44, 14, 2.4);
      b.line(-44, 8, -40, 14, 2.2);
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const d = 16 + rng() * 26;
        b.rock(Math.cos(a) * d, Math.sin(a) * d, 1 + rng() * 1.6);
      }
    },
  },
  {
    id: 'terraces',
    name: 'Highland Terraces',
    subtitle: 'The Steps of Veyra',
    description: 'Your core sits in a sunken basin. The hives nest on high shelves and the swarm must wind down the terraces to four ramps. Hold the high ground.',
    difficulty: 2,
    halfX: 60,
    halfZ: 60,
    core: [0, 0],
    spawn: [0, 9],
    hives: [[0, -50], [50, 0], [0, 50], [-50, 0]],
    enemyBias: { leaper: 1.4, spitter: 1.3, wasp: 1.2 },
    theme: {
      grade: { contrast: 1.14, saturation: 1.0, shadowTint: '#1a3a48', highlightTint: '#ffe0b0', split: 0.2, vignette: 0.45 },
      atmosphere: { mist: 0.2, mistCount: 46, mistHeight: 1.1 },
      materials: { ground: 'ground_marsh', groundTint: '#c9c08a', cliffTint: '#9aa49a', cliffSide: 'cliff', rockTop: 'ground_marsh', rockSide: 'rock', rockTint: '#9aa094', rockTopTint: '#b8b48a' },
      day: { top: '#2f7a9a', horizon: '#ffd9a8', bottom: '#7a8a6a', sun: '#ffe6c0', sunI: 3.0, hemi: 0.6, fog: '#c9c8a8' },
      night: { top: '#06101c', horizon: '#2a3a5a', bottom: '#101a18', sun: '#a8c4ff', sunI: 1.6, hemi: 0.8, fog: '#18222e' },
      fogNear: 40, fogFar: 190,
      ground: ['#6a7048', '#555a3a', '#7e8458'],
      cliff: '#4a4e44',
      rock: '#6a6e62',
      obstacleStyle: 'rock',
      prop: 'crystal',
      propColor: '#3df0c0',
      particles: 'dust',
      planet: { color: '#ffe8c8', ring: true, pos: [-240, 120, -260], size: 40 },
      sunDir: [0.5, 0.55, -0.45],
      exposure: 1.0,
      cliffHeight: 1.4,
    },
    elevation(e) {
      e.base(4.5); // the highland
      e.circle(0, 0, 24, 0, { rough: 1.6 }); // the basin around the core
      // two lookout mesas the defenders can climb
      for (const [x, z, dx, dz] of [[33, 14, 0.92, 0.39], [-33, -14, -0.92, -0.39]]) {
        e.circle(x, z, 5.5, 8.5, { rough: 0.8 });
        e.ramp(x + dz * 3, z - dx * 3, x + dz * 3 + dx * 12, z - dx * 3 + dz * 12, 3.6, 8.5, 4.5);
      }
      // hive shelves high up, each with a ramp that runs sideways along the edge
      const hives = [[0, -50], [50, 0], [0, 50], [-50, 0]];
      for (const [x, z] of hives) {
        e.circle(x, z, 9.5, 9, { rough: 1.2 });
        const l = Math.hypot(x, z), rx = x / l, rz = z / l;
        const tx = -rz, tz = rx; // tangent (clockwise around the map)
        e.ramp(x + tx * 3 - rx * 2, z + tz * 3 - rz * 2, x + tx * 17 - rx * 4, z + tz * 17 - rz * 4, 7, 9, 4.5);
      }
      // four ramps down into the basin, on the diagonals
      for (const a of [45, 135, 225, 315]) {
        const c = Math.cos((a * Math.PI) / 180), sn = Math.sin((a * Math.PI) / 180);
        e.ramp(c * 31, sn * 31, c * 15, sn * 15, 8, 4.5, 0);
      }
    },
    layout(b, rng) {
      // boulder fields on the highland, right under each hive (the swarm has to go around)
      for (const [x, z] of [[0, -33], [33, 0], [0, 33], [-33, 0]]) {
        b.rock(x, z, 3.4);
        b.rock(x + (rng() - 0.5) * 8, z + (rng() - 0.5) * 8, 1.8);
      }
      // scattered rocks for cover
      for (const [x, z] of [[18, -44], [44, 18], [-18, 44], [-44, -18], [40, -30], [-40, 30], [26, 40], [-26, -40]]) b.rock(x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3, 1.4 + rng() * 1.2);
      // a few rocks in the basin
      for (const [x, z] of [[12, -4], [-12, 5], [4, 16], [-5, -15]]) b.rock(x, z, 1.1 + rng() * 0.6);
    },
  },
  {
    id: 'citadel',
    name: 'Iron Citadel',
    subtitle: 'Last Bastion of Ashfall',
    description: 'The core stands on a fortified plateau with three ramps. Below, broken walls split the ash plains into lanes. The swarm must climb to reach you.',
    difficulty: 3,
    halfX: 58,
    halfZ: 58,
    core: [0, 0],
    spawn: [0, 8],
    hives: [[0, -48], [41.6, 24], [-41.6, 24]],
    enemyBias: { brute: 1.4, bulwark: 1.4, bloater: 1.3, floater: 1.3 },
    theme: {
      grade: { contrast: 1.18, saturation: 0.9, shadowTint: '#2a1a2a', highlightTint: '#ffc08a', split: 0.24, vignette: 0.5 },
      atmosphere: { mist: 0.16, mistCount: 40, mistHeight: 1.0 },
      materials: { ground: 'ground_cave', groundTint: '#b8aaa0', cliffTint: '#c8bcb0', cliffSide: 'concrete', rockTop: 'ground_cave', rockSide: 'rock', rockTint: '#8a807a', rockTopTint: '#a89c92' },
      day: { top: '#4a4a6a', horizon: '#ff9a6a', bottom: '#5a4040', sun: '#ffb889', sunI: 2.6, hemi: 0.55, fog: '#b0786a' },
      night: { top: '#08060f', horizon: '#3a1a28', bottom: '#120a10', sun: '#ff9a8a', sunI: 1.4, hemi: 0.78, fog: '#1e0f16' },
      fogNear: 30, fogFar: 160,
      ground: ['#5a5050', '#463e3e', '#6a5e5a'],
      cliff: '#3a3434',
      rock: '#4a4040',
      obstacleStyle: 'mesa',
      prop: 'ember',
      propColor: '#ff6a2d',
      particles: 'embers',
      planet: { color: '#ffb08a', ring: false, pos: [180, 90, -300], size: 34 },
      sunDir: [-0.5, 0.5, 0.6],
      exposure: 1.0,
      cliffHeight: 1.5,
    },
    elevation(e) {
      e.base(0);
      e.circle(0, 0, 17, 5, { rough: 0.35 }); // the citadel
      for (const a of [90, 210, 330]) {
        const c = Math.cos((a * Math.PI) / 180), sn = Math.sin((a * Math.PI) / 180);
        e.ramp(c * 12, sn * 12, c * 29, sn * 29, 7, 5, 0);
      }
      // low ridges in the plains that give the defenders a second line
      for (const a of [270, 30, 150]) {
        const c = Math.cos((a * Math.PI) / 180), sn = Math.sin((a * Math.PI) / 180);
        const x = c * 27, z = sn * 27;
        e.circle(x, z, 4.5, 2.6, { rough: 0.8 });
        // ramp runs along the ridge's side (tangent)
        e.ramp(x - sn * 2, z + c * 2, x - sn * 11, z + c * 11, 4, 2.6, 0);
      }
    },
    layout(b, rng) {
      // broken wall ring around the citadel: gaps away from the ramps make the swarm walk around
      const gaps = [60, 180, 300];
      for (let a = 0; a < 360; a += 3) {
        if (gaps.some((g) => Math.abs(((a - g + 540) % 360) - 180) < 9)) continue;
        const r = 37 + Math.sin(a * 0.11) * 1.5;
        b.rock(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r, 1.5);
      }
      // rubble and pillars in the lanes
      for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2;
        const d = 42 + rng() * 10;
        b.rock(Math.cos(a) * d, Math.sin(a) * d, 1.2 + rng() * 1.6);
      }
      for (const [x, z] of [[22, 4], [-22, 4], [10, -24], [-10, -24], [14, 22], [-14, 22]]) b.rock(x + (rng() - 0.5) * 2, z + (rng() - 0.5) * 2, 1.3 + rng() * 0.8);
    },
  },
];

export const DIFFICULTIES = {
  recruit: { name: 'Recruit', hp: 0.7, dmg: 0.6, credits: 450, count: 0.75, desc: 'Weaker swarm, more starting crystals.' },
  veteran: { name: 'Veteran', hp: 1.0, dmg: 1.0, credits: 350, count: 1.0, desc: 'The intended experience.' },
  nightmare: { name: 'Nightmare', hp: 1.35, dmg: 1.3, credits: 250, count: 1.25, desc: 'Tougher, larger swarms. Good luck.' },
};

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
