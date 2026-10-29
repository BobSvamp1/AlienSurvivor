// Map definitions. Each map has a look (theme) and a layout.
// The layout marks grid cells (2x2 m) as blocked rocks/ice/trees or as acid pools.
// Builder helpers: rock(x, z, r), line(x1, z1, x2, z2, width), clear(x, z, r), pool(x, z, r)

// The maps are played in this order: each one unlocks the next (see unlocked()). The
// first ones have a single route to the core, later ones more and more ways in.
// shared looks
const CANYON = {
  grade: { contrast: 1.12, saturation: 1.0, shadowTint: '#3a2a48', highlightTint: '#ffd0a0', split: 0.2, vignette: 0.45 },
  atmosphere: { mist: 0.12 },
  materials: { ground: 'ground_canyon', groundTint: '#ece4dc', cliffTint: '#cc9478', cliffSide: 'cliff', rockTop: 'ground_canyon', rockSide: 'cliff', rockTint: '#c8846a', rockTopTint: '#ffffff' },
  day: { top: '#3f6aa6', horizon: '#ffb488', bottom: '#a8603f', sun: '#ffdcb4', sunI: 3.1, hemi: 0.62, fog: '#dc9c74' },
  night: { top: '#0a0820', horizon: '#3a2448', bottom: '#1a1020', sun: '#ffb0a0', sunI: 1.5, hemi: 0.8, fog: '#251428' },
  fogNear: 40, fogFar: 185,
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
};
const VOLCANIC = {
  ...CANYON,
  grade: { contrast: 1.18, saturation: 1.0, shadowTint: '#2a1a30', highlightTint: '#ffb070', split: 0.26, vignette: 0.52 },
  atmosphere: { mist: 0.2 },
  materials: { ground: 'ground_canyon', groundTint: '#a8968a', cliffTint: '#7a5a50', cliffSide: 'cliff', rockTop: 'ground_canyon', rockSide: 'cliff', rockTint: '#6a4a42', rockTopTint: '#c8b8b0' },
  day: { top: '#34365a', horizon: '#d8804a', bottom: '#6a3424', sun: '#ffc290', sunI: 3.1, hemi: 0.72, fog: '#8a4a30' },
  night: { top: '#08060f', horizon: '#3a1a12', bottom: '#140806', sun: '#ff9a70', sunI: 1.3, hemi: 0.75, fog: '#240c08' },
  fogNear: 40, fogFar: 170,
  particles: 'embers',
  planet: { color: '#ffb890', ring: true, pos: [200, 110, -260], size: 50 },
  sunDir: [0.4, 0.5, -0.55],
  lava: { glow: 2.4 },
};
const GLACIER = {
  grade: { contrast: 1.12, saturation: 0.88, shadowTint: '#1c3a5a', highlightTint: '#eaf4ff', split: 0.18, vignette: 0.46 },
  atmosphere: { mist: 0.2, mistCount: 44 },
  materials: { ground: 'ground_frost', groundTint: '#eef4fa', cliffTint: '#a9bdd2', rockTop: 'ground_frost', rockSide: 'rock', rockTint: '#93a8bd', rockTopTint: '#ffffff' },
  day: { top: '#2f5f9e', horizon: '#bcd8f2', bottom: '#8aa8c4', sun: '#f2f8ff', sunI: 2.6, hemi: 0.66, fog: '#a8c4dc' },
  night: { top: '#040a1c', horizon: '#1c3c6a', bottom: '#0c1a33', sun: '#a8ccff', sunI: 1.6, hemi: 0.82, fog: '#122744' },
  fogNear: 38, fogFar: 175,
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
};

// an octagonal plaza around the core
const octagon = (cx, cz, r) => Array.from({ length: 8 }, (_, i) => [cx + Math.cos(Math.PI / 8 + (i * Math.PI) / 4) * r, cz + Math.sin(Math.PI / 8 + (i * Math.PI) / 4) * r]);

// The maps are played in this order: each one unlocks the next (see unlocked()). The
// first ones have a single road to the core, later ones more and more ways in.
// Roads wind between rock walls the swarm can't climb; raised pads beside them can
// only be reached with the jetpack and make good spots for turrets.
export const MAPS = [
  {
    id: 'landing',
    name: 'Landing Zone',
    subtitle: 'One Road In',
    description: 'One winding road leads from the hive to your base, over a rock bridge and past an acid bog. Line it with traps and hold the high ground.',
    difficulty: 1,
    waves: 10,
    finalBosses: 1,
    ease: 0.95,
    halfX: 50,
    halfZ: 56,
    core: [8, 34],
    spawn: [8, 25],
    hives: [[-30, -42]],
    dressing: { light: '#ffe2b0', gateLight: '#ffb070' },
    theme: CANYON,
    elevation(e) {
      e.base(8.6);
      e.relief(1.2, 0.09); // tall rock walls: clearly nothing to climb
      // the hive cave
      e.poly([[-42, -54], [-30, -56], [-18, -50], [-17, -38], [-24, -31], [-38, -32], [-43, -42]], 0, { rough: 1.4 });
      // a chasm the road crosses on a natural bridge
      e.poly([[2, -30], [22, -34], [34, -22], [26, -10], [8, -12]], -18, { rough: 1.2 });
      // the road: down from the cave, a long bend east, over the bridge, back west, into the base
      e.path([[-26, -34], [-20, -22, 0.4], [-6, -18, 1.4], [12, -24, 1.6], [24, -20, 1.6], [34, -6, 0.8], [30, 6, 0], [10, 4, 0], [-12, 6, 0.6], [-22, 18, 1.2], [-14, 30, 0.4], [0, 32, 0]], 9);
      // the base yard
      e.poly(octagon(8, 34, 13), 0, { rough: 0.3 });
      // turret pads beside the road (jetpack up)
      e.platform(-14, -30, 4, 2.6);
      e.platform(18, -8, 3.6, 2.6);
      e.platform(-4, 16, 4, 2.6);
      e.platform(-30, 8, 3.6, 2.6);
    },
    layout(b, rng) {
      b.pool(22, 3, 3.2); // acid bog on the road
      for (const [x, z, r] of [[-34, -46, 1.2], [-24, -48, 1.1]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
    },
  },
  {
    id: 'gorge',
    name: 'Twin Gorge',
    subtitle: 'Two Hives, Two Roads',
    description: 'Two hives, two winding roads and a rope of rock across the gorge between them. The swarm can switch roads at the crossing: watch both sides.',
    difficulty: 1,
    waves: 12,
    finalBosses: 1,

    halfX: 58,
    halfZ: 58,
    core: [0, 36],
    spawn: [0, 27],
    hives: [[-40, -44], [40, -44]],
    dressing: { light: '#ffd8a8', gateLight: '#ff9a60' },
    theme: { ...CANYON, day: { ...CANYON.day, top: '#4a5a8e', horizon: '#ff9a6a', fog: '#cc8060', sunI: 2.8 }, planet: { color: '#cfe4ff', ring: true, pos: [240, 120, -240], size: 46 }, sunDir: [0.5, 0.45, -0.55] },
    elevation(e) {
      e.base(8.6);
      e.relief(1.2, 0.09); // tall rock walls: clearly nothing to climb
      e.poly([[-52, -56], [-40, -58], [-28, -54], [-27, -42], [-32, -34], [-48, -34], [-53, -44]], 0, { rough: 1.4 });
      e.poly([[52, -56], [40, -58], [28, -54], [27, -42], [32, -34], [48, -34], [53, -44]], 0, { rough: 1.4 });
      // the gorge down the middle
      e.poly([[-10, -40], [10, -42], [14, -8], [8, 10], [-8, 10], [-14, -8]], -18, { rough: 1.2 });
      // west and east roads
      e.path([[-38, -36], [-34, -22], [-42, -8], [-36, 6], [-24, 12], [-26, 24], [-14, 32]], 8);
      e.path([[38, -36], [34, -22], [42, -8], [36, 6], [24, 12], [26, 24], [14, 32]], 8);
      // the crossing over the gorge
      e.path([[-36, -14], [-20, -18], [0, -16], [20, -18], [36, -14]], 6);
      // the base yard
      e.poly(octagon(0, 36, 14), 0, { rough: 0.3 });
      e.platform(-20, -28, 3.8, 2.8);
      e.platform(20, -28, 3.8, 2.8);
      e.platform(-34, 18, 3.8, 2.8);
      e.platform(34, 18, 3.8, 2.8);
      e.platform(0, 20.5, 4, 2.8); // overlooks the base yard
    },
    layout(b, rng) {
      b.pool(-36, 0, 2.8);
      b.pool(36, 0, 2.8);
      for (const [x, z, r] of [[-44, -48, 1.2], [44, -48, 1.2]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
    },
  },
  {
    id: 'labyrinth',
    name: 'The Labyrinth',
    subtitle: 'Fire and Acid',
    description: 'Three hives around a walled base. The roads twist through acid bogs and over bridges above rivers of lava, and the east road splits in two. Raised pads overlook every choke point.',
    difficulty: 2,
    waves: 15,
    halfX: 62,
    halfZ: 56,
    core: [0, 0],
    spawn: [0, 9],
    hives: [[-50, -40], [-50, 38], [52, 32]],
    tightClutter: true,
    dressing: { light: '#ffc890', gateLight: '#ff8a50' },
    theme: VOLCANIC,
    elevation(e) {
      e.base(8.6);
      e.relief(1.2, 0.09); // tall rock walls: clearly nothing to climb
      // hive caves
      e.poly([[-60, -50], [-48, -54], [-38, -48], [-37, -36], [-44, -29], [-56, -31], [-61, -40]], 0, { rough: 1.4 });
      e.poly([[-60, 30], [-48, 26], [-38, 30], [-37, 42], [-44, 49], [-56, 48], [-61, 40]], 0, { rough: 1.4 });
      e.poly([[62, 22], [50, 20], [40, 26], [40, 38], [48, 45], [60, 44], [62, 34]], 0, { rough: 1.4 });
      // rivers of lava in the east
      e.poly([[16, -26], [34, -32], [50, -18], [54, 6], [46, 16], [30, 22], [18, 12], [22, -6]], -5, { rough: 1.6 });
      // north-west road: east along the top, then down into the north gate
      e.path([[-46, -34], [-34, -24], [-22, -32], [-8, -40], [6, -36], [10, -24], [2, -16]], 8);
      // south-west road: up past the acid bogs into the west gate
      e.path([[-46, 32], [-36, 22], [-40, 10], [-30, 2], [-22, 10], [-12, 4]], 8);
      // east road over the lava, splitting at the fork
      e.path([[46, 28], [38, 18], [40, 4], [32, -6], [22, 2], [12, 2]], 7);
      e.path([[32, -6], [30, -20], [18, -28], [8, -26]], 6);
      // the walled plaza and its yard
      e.poly(octagon(0, 0, 14), 0, { rough: 0 });
      e.rect(-5, 12, 5, 22, 0, { rough: 0.3 }); // south yard behind the base
      // turret pads at the choke points
      e.platform(-24, -20, 3.6, 2.8);
      e.platform(-14, -48, 3.6, 2.8);
      e.platform(-48, 12, 3.6, 2.8);
      e.platform(-24, 22, 3.6, 2.8);
      e.platform(26, -30, 3.6, 2.8);
      e.platform(34, 28, 3.6, 2.8);
      e.platform(-14, 22, 3.2, 2.8);
    },
    layout(b, rng) {
      b.pool(-38, 16, 3);
      b.pool(-14, -38, 2.4);
      for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) b.rock(x, z, 0.6);
      for (const [x, z, r] of [[-54, -44, 1.2], [-52, 44, 1.1], [56, 38, 1.2]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
    },
  },
  {
    id: 'aurora',
    name: 'Aurora Gorge',
    subtitle: 'Bridges of Ice',
    description: 'The swarm crawls down from the glacier caves over ice bridges and through a tunnel, then splits into a short road and a long decoy route to the core. Command it from the ice shelves above.',
    difficulty: 2,
    waves: 15,
    halfX: 60,
    halfZ: 58,
    core: [36, 36],
    spawn: [26, 30],
    hives: [[-46, -44], [-50, 10]],
    enemyBias: { swarmling: 1.3, serpent: 1.2, wasp: 1.2 },
    tightClutter: true,
    dressing: { light: '#d8f0ff', gateLight: '#7ad0ff' },
    theme: GLACIER,
    elevation(e) {
      e.base(8.6);
      e.relief(1.2, 0.09); // tall rock walls: clearly nothing to climb
      e.poly([[-58, -54], [-46, -57], [-34, -52], [-33, -40], [-40, -33], [-54, -34], [-59, -44]], 0, { rough: 1.4 });
      e.poly([[-60, 2], [-50, -2], [-40, 4], [-40, 16], [-48, 22], [-58, 18]], 0, { rough: 1.4 });
      // the abyss through the middle
      e.poly([[-30, -30], [-6, -36], [14, -24], [18, 0], [6, 16], [-18, 14], [-30, -6]], -20, { rough: 1.4 });
      // north road: down from the cave, over the first bridge (choke point A)
      e.path([[-42, -38], [-34, -26], [-22, -20], [-6, -16], [8, -8], [20, -4]], 7);
      // west road: the tunnel route, then across the second bridge
      e.path([[-44, 12], [-32, 18], [-18, 24], [-6, 22], [4, 8], [20, -4]], 7);
      // from the meeting point: the short road and the long decoy loop
      e.path([[20, -4], [28, 8], [30, 22], [34, 30]], 8);
      e.path([[20, -4], [36, -18], [50, -10], [52, 12], [46, 26], [40, 32]], 7);
      // the core receptacle
      e.circle(36, 36, 12, 0, { rough: 0.4 });
      // ice shelves: the player spawn terrace and observation posts
      e.platform(24, 47, 5, 2.8);
      e.platform(-14, -32, 3.6, 2.8);
      e.platform(-2, 32, 3.6, 2.8);
      e.platform(10, 18, 3.6, 2.8);
      e.platform(40, 4, 3.6, 2.8);
      e.platform(36, -32, 3.6, 2.8);
    },
    layout(b, rng) {
      for (const [x, z, r] of [[-50, -48, 1.2], [-52, 14, 1.0], [46, 12, 0.8]]) b.rock(x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.5, r);
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
      e.relief(1.0, 0.08);
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
      e.relief(1.0, 0.08);
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
