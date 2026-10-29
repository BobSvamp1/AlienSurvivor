// Sound bank: richer sounds are synthesized once at start-up with an
// OfflineAudioContext (layers, distortion, formant filters, echo) and kept as
// AudioBuffers. Playing one is then a single cheap buffer source, and several
// variants per sound plus random pitch keep repeats from sounding identical.

const SR = 44100;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const curves = new Map();
function driveCurve(k) {
  if (curves.has(k)) return curves.get(k);
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
  curves.set(k, c);
  return c;
}

// A tiny toolkit bound to one offline context
function kit(c, r) {
  const noiseBuf = c.createBuffer(1, c.length, c.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
  const out = c.createGain();
  const glue = c.createWaveShaper();
  glue.curve = driveCurve(1.2);
  out.connect(glue);
  glue.connect(c.destination);
  const K = {
    c, r, out,
    noise(at = 0) { const s = c.createBufferSource(); s.buffer = noiseBuf; s.start(at); return s; },
    osc(type, f, at = 0, stop = c.length / c.sampleRate) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(at); o.stop(stop); return o; },
    filt(type, f, q = 1) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; },
    gain(v = 1) { const g = c.createGain(); g.gain.value = v; return g; },
    drive(k) { const w = c.createWaveShaper(); w.curve = driveCurve(k); w.oversample = '2x'; return w; },
    // envelope: [[time, value], ...] (first point set, then exponential ramps; 0 is treated as tiny)
    env(param, pts, linear = false) {
      param.setValueAtTime(Math.max(1e-4, pts[0][1]), pts[0][0]);
      for (let i = 1; i < pts.length; i++) {
        const v = Math.max(1e-4, pts[i][1]);
        if (linear) param.linearRampToValueAtTime(v, pts[i][0]); else param.exponentialRampToValueAtTime(v, pts[i][0]);
      }
      // a fade that ends near zero really ends at zero (no faint ringing left behind)
      const last = pts[pts.length - 1];
      if (last[1] <= 1e-3 && param.value !== undefined && param.maxValue > 1) param.setValueAtTime(0, last[0] + 0.002);
    },
    chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; },
    // amplitude modulation: returns a gain node whose gain wobbles base +- depth at rate
    am(rate, depth, base = 1, type = 'sine') {
      const g = c.createGain();
      g.gain.value = base;
      const lfo = K.osc(type, rate);
      const d = K.gain(depth);
      lfo.connect(d); d.connect(g.gain);
      return g;
    },
  };
  return K;
}

async function render(dur, seed, build, loop = false) {
  const c = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
  const K = kit(c, rng(seed));
  build(K);
  const buf = await c.startRendering();
  // normalise loudness (loudest 20 ms window) so clicks and drones mix evenly,
  // then soft-limit the peaks
  const d = buf.getChannelData(0);
  const W = Math.floor(SR * 0.02);
  let best = 0;
  for (let i = 0; i + W <= d.length; i += W >> 1) {
    let s = 0;
    for (let j = i; j < i + W; j++) s += d[j] * d[j];
    best = Math.max(best, s / W);
  }
  const rms = Math.sqrt(best);
  if (rms > 0) {
    const k = 0.3 / rms;
    for (let i = 0; i < d.length; i++) {
      const x = d[i] * k;
      d[i] = Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3));
    }
  }
  // short fade-out so nothing clicks at the end (loops must stay seamless)
  if (!loop) {
    const f = Math.min(d.length, 220);
    for (let i = 0; i < f; i++) d[d.length - 1 - i] *= i / f;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Recipes

// Pulse rifle: sharp crack + low punch + a short energy "zap", bolt clack and an echo off the terrain
function rifle(K, v = 0) {
  const { r, out } = K;
  const bus = K.gain(1);
  bus.connect(out);
  const p = 1 + (r() - 0.5) * 0.08;
  // transient
  const click = K.chain(K.noise(), K.filt('highpass', 3500), K.gain(0));
  K.env(click.gain, [[0, 0.0001], [0.0008, 0.9], [0.012, 0.0001]]);
  click.connect(bus);
  // crack: band-limited noise, driven
  const crack = K.chain(K.noise(), K.filt('bandpass', 1400 * p, 0.7), K.drive(4), K.gain(0));
  K.env(crack.gain, [[0, 1.4], [0.025, 0.8], [0.2, 0.0001]]);
  crack.connect(bus);
  // body: wide noise burst that fills out the shot
  const body = K.chain(K.noise(), K.filt('lowpass', 2600), K.gain(0));
  K.env(body.gain, [[0, 0.8], [0.06, 0.35], [0.28, 0.0001]]);
  body.connect(bus);
  // punch
  const th = K.osc('sine', 150 * p);
  K.env(th.frequency, [[0, 160 * p], [0.18, 42]]);
  const thg = K.chain(th, K.drive(1.8), K.gain(0));
  K.env(thg.gain, [[0, 0.8], [0.08, 0.4], [0.26, 0.0001]]);
  thg.connect(bus);
  // energy zap (gives it the sci-fi character)
  const z = K.osc('sawtooth', 2400);
  K.env(z.frequency, [[0, (2600 + v * 150) * p], [0.075, 240]]);
  const z2 = K.osc('square', 3700);
  K.env(z2.frequency, [[0, 3900 * p], [0.06, 380]]);
  const zf = K.filt('lowpass', 5200, 1.5);
  z.connect(zf); z2.connect(zf);
  const zg = K.chain(zf, K.gain(0));
  K.env(zg.gain, [[0, 0.32], [0.09, 0.0001]]);
  zg.connect(bus);
  // bolt clack
  for (const [f, a] of [[3150, 0.16], [4720, 0.1], [6100, 0.06]]) {
    const o = K.osc('sine', f * p, 0.03);
    const g = K.gain(0);
    K.env(g.gain, [[0.03, 0.0001], [0.0305, a], [0.07, 0.0001]]);
    o.connect(g); g.connect(bus);
  }
  // tail
  const tail = K.chain(K.noise(), K.filt('lowpass', 1100), K.gain(0));
  K.env(tail.gain, [[0, 0.0001], [0.02, 0.45], [0.7, 0.0001]]);
  tail.connect(bus);
  // echoes off the hills
  for (const [dt, g, lp] of [[0.14, 0.32, 1800], [0.31, 0.16, 1100], [0.52, 0.07, 800]]) {
    const d = K.c.createDelay(1); d.delayTime.value = dt + (r() - 0.5) * 0.02;
    const e = K.chain(bus, d, K.filt('lowpass', lp), K.gain(g));
    e.connect(out);
  }
}

function gatling(K) {
  const { r, out } = K;
  const p = 1 + (r() - 0.5) * 0.1;
  const crack = K.chain(K.noise(), K.filt('bandpass', 2200 * p, 1.1), K.drive(3), K.gain(0));
  K.env(crack.gain, [[0, 1], [0.06, 0.0001]]);
  crack.connect(out);
  const th = K.osc('sine', 220 * p);
  K.env(th.frequency, [[0, 230 * p], [0.07, 70]]);
  const g = K.gain(0);
  K.env(g.gain, [[0, 0.7], [0.09, 0.0001]]);
  th.connect(g); g.connect(out);
  const tick = K.chain(K.noise(), K.filt('highpass', 5000), K.gain(0));
  K.env(tick.gain, [[0, 0.5], [0.01, 0.0001]]);
  tick.connect(out);
}

function metal(K, freqs, at, len, amp) {
  for (const [f, a] of freqs) {
    const o = K.osc('sine', f, at);
    const g = K.gain(0);
    K.env(g.gain, [[at, 0.0001], [at + 0.001, a * amp], [at + len * (0.6 + K.r() * 0.6), 0.0001]]);
    o.connect(g); g.connect(K.out);
  }
}

function magOut(K) {
  const n = K.chain(K.noise(), K.filt('bandpass', 2600, 2), K.gain(0));
  K.env(n.gain, [[0, 0.8], [0.03, 0.0001]]);
  n.connect(K.out);
  metal(K, [[1850, 0.5], [2930, 0.35], [4400, 0.2]], 0.0, 0.12, 0.6);
  const slide = K.chain(K.noise(0.05), K.filt('bandpass', 1400, 1.5), K.gain(0));
  K.env(slide.gain, [[0.05, 0.0001], [0.08, 0.25], [0.2, 0.0001]]);
  slide.connect(K.out);
}

function magIn(K) {
  const thud = K.osc('sine', 180);
  K.env(thud.frequency, [[0, 200], [0.06, 90]]);
  const g = K.gain(0);
  K.env(g.gain, [[0, 0.9], [0.09, 0.0001]]);
  thud.connect(g); g.connect(K.out);
  const n = K.chain(K.noise(), K.filt('bandpass', 1800, 1.2), K.drive(2), K.gain(0));
  K.env(n.gain, [[0, 0.9], [0.04, 0.0001]]);
  n.connect(K.out);
  metal(K, [[2400, 0.5], [3550, 0.35]], 0.004, 0.08, 0.7);
}

function charge(K) {
  const o = K.osc('sawtooth', 300);
  K.env(o.frequency, [[0, 260], [0.3, 1500]]);
  const o2 = K.osc('sine', 600);
  K.env(o2.frequency, [[0, 520], [0.3, 3000]]);
  const f = K.filt('lowpass', 2500, 4);
  o.connect(f); o2.connect(f);
  const g = K.chain(f, K.gain(0));
  K.env(g.gain, [[0, 0.0001], [0.05, 0.3], [0.28, 0.4], [0.36, 0.0001]]);
  g.connect(K.out);
  metal(K, [[2100, 0.4], [3300, 0.3]], 0.3, 0.06, 0.8);
}

function dry(K) {
  metal(K, [[2800, 0.6], [4100, 0.4]], 0, 0.05, 1);
  const n = K.chain(K.noise(), K.filt('highpass', 2500), K.gain(0));
  K.env(n.gain, [[0, 0.5], [0.015, 0.0001]]);
  n.connect(K.out);
}

function fleshHit(K) {
  const { r } = K;
  const n = K.chain(K.noise(), K.filt('bandpass', 500 + r() * 300, 1.4), K.drive(2), K.gain(0));
  K.env(n.gain, [[0, 1], [0.08, 0.0001]]);
  n.connect(K.out);
  const s = K.chain(K.noise(), K.filt('highpass', 2500), K.gain(0));
  K.env(s.gain, [[0, 0.4], [0.03, 0.0001]]);
  s.connect(K.out);
  const o = K.osc('sine', 300);
  K.env(o.frequency, [[0, 320], [0.06, 90]]);
  const g = K.gain(0);
  K.env(g.gain, [[0, 0.5], [0.07, 0.0001]]);
  o.connect(g); g.connect(K.out);
}

// insect chitter: a burst of tiny resonant clicks
function chitter(K, fc, n, rate) {
  const { r, out } = K;
  let t = 0.01;
  for (let i = 0; i < n; i++) {
    const f = fc * (0.85 + r() * 0.3) * (1 - (i / n) * 0.15);
    const a = 0.5 + r() * 0.5;
    const cl = K.chain(K.noise(t), K.filt('bandpass', f, 9), K.gain(0));
    K.env(cl.gain, [[t, 0.0001], [t + 0.0015, a * 3], [t + 0.012 + r() * 0.01, 0.0001]]);
    cl.connect(out);
    const ping = K.osc('sine', f * 0.5, t, t + 0.04);
    const pg = K.gain(0);
    K.env(pg.gain, [[t, 0.0001], [t + 0.001, a * 0.25], [t + 0.02, 0.0001]]);
    ping.connect(pg); pg.connect(out);
    t += (1 / rate) * (0.7 + r() * 0.6);
    if (r() < 0.12) t += 0.05; // little pauses
  }
}

// screech: FM-synthesised scream through formant filters
function screech(K, f0, len, { glideTo = 0.75, rough = 3 } = {}) {
  const { r, out } = K;
  const car = K.osc('sawtooth', f0);
  K.env(car.frequency, [[0, f0 * 0.8], [len * 0.15, f0 * (1.1 + r() * 0.15)], [len, f0 * glideTo]]);
  const mod = K.osc('sine', f0 * 1.41);
  K.env(mod.frequency, [[0, f0 * 1.1], [len * 0.15, f0 * 1.55], [len, f0 * glideTo * 1.41]]);
  const mg = K.gain(f0 * 1.8);
  mod.connect(mg); mg.connect(car.frequency);
  const vib = K.osc('sine', 24 + r() * 14);
  const vg = K.gain(f0 * 0.06);
  vib.connect(vg); vg.connect(car.frequency);
  const pre = K.chain(car, K.drive(rough));
  const sum = K.gain(1);
  for (const [m, q, a] of [[2.1, 5, 0.9], [3.6, 4, 0.7], [1.0, 2, 0.4]]) {
    const b = K.filt('bandpass', f0 * m, q);
    const g = K.gain(a);
    pre.connect(b); b.connect(g); g.connect(sum);
  }
  // breath
  const br = K.chain(K.noise(), K.filt('bandpass', f0 * 3, 1.2), K.gain(0.35));
  br.connect(sum);
  const env = K.gain(0);
  K.env(env.gain, [[0, 0.0001], [0.025, 1], [len * 0.55, 0.6], [len, 0.0001]]);
  K.chain(sum, K.filt('highpass', 120), env, out);
}

function hiss(K, fc, len) {
  const n = K.chain(K.noise(), K.filt('bandpass', fc, 0.9));
  const am = K.am(28 + K.r() * 16, 0.35, 0.65);
  const g = K.gain(0);
  K.env(g.gain, [[0, 0.0001], [0.07, 1], [len * 0.4, 0.7], [len, 0.0001]]);
  K.chain(n, am, g, K.out);
  const hi = K.chain(K.noise(), K.filt('highpass', fc * 1.8), K.gain(0));
  K.env(hi.gain, [[0, 0.0001], [0.05, 0.35], [len * 0.7, 0.0001]]);
  hi.connect(K.out);
}

function growl(K, f0, len) {
  const { r, out } = K;
  const o = K.osc('sawtooth', f0);
  const o2 = K.osc('sawtooth', f0 * 1.025);
  const pts = [[0, f0 * 0.85]];
  for (let i = 1; i <= 6; i++) pts.push([(len * i) / 6, f0 * (0.85 + r() * 0.35)]);
  K.env(o.frequency, pts);
  K.env(o2.frequency, pts.map(([t, f]) => [t, f * 1.025]));
  // pitch jitter makes it sound like a throat, not a synth
  const jit = K.chain(K.noise(), K.filt('lowpass', 35), K.gain(f0 * 0.35));
  jit.connect(o.frequency); jit.connect(o2.frequency);
  const sub = K.osc('sine', f0 / 2);
  K.env(sub.frequency, pts.map(([t, f]) => [t, f / 2]));
  // rough, irregular amplitude (vocal fry)
  const rough = K.gain(0.2);
  const nmod = K.chain(K.noise(), K.filt('lowpass', 90), K.gain(3));
  nmod.connect(rough.gain);
  const lp = K.filt('lowpass', 500, 3);
  K.env(lp.frequency, [[0, 300], [len * 0.3, 1300], [len, 350]]);
  o.connect(rough); o2.connect(rough); sub.connect(rough);
  const mix = K.chain(rough, K.drive(2.2), lp);
  const sum = K.gain(1);
  mix.connect(sum);
  for (const [f, q] of [[420, 4], [950, 5]]) { const b = K.filt('bandpass', f * (f0 / 70), q); mix.connect(b); b.connect(sum); }
  const br = K.chain(K.noise(), K.filt('bandpass', 1200, 0.8), K.gain(0.25));
  br.connect(sum);
  const env = K.gain(0);
  K.env(env.gain, [[0, 0.0001], [0.12, 1], [len * 0.7, 0.8], [len, 0.0001]]);
  K.chain(sum, env, out);
}

function squelch(K, at, len, freq = 600) {
  const n = K.chain(K.noise(at), K.filt('lowpass', freq, 2));
  const am = K.am(30 + K.r() * 20, 0.6, 0.5, 'square');
  const g = K.gain(0);
  K.env(g.gain, [[at, 0.0001], [at + 0.02, 0.9], [at + len, 0.0001]]);
  K.chain(n, am, g, K.out);
  const o = K.osc('sine', 260, at);
  K.env(o.frequency, [[at, 280], [at + len, 50]]);
  const og = K.gain(0);
  K.env(og.gain, [[at, 0.0001], [at + 0.01, 0.6], [at + len * 0.8, 0.0001]]);
  o.connect(og); og.connect(K.out);
}

function bite(K) {
  const { r } = K;
  for (const t of [0, 0.06 + r() * 0.03]) {
    const cl = K.chain(K.noise(t), K.filt('bandpass', 2600 + r() * 800, 3), K.gain(0));
    K.env(cl.gain, [[t, 0.0001], [t + 0.001, 1.4], [t + 0.02, 0.0001]]);
    cl.connect(K.out);
  }
  const cr = K.chain(K.noise(0.05), K.filt('bandpass', 900, 1.5), K.drive(3), K.gain(0));
  K.env(cr.gain, [[0.05, 0.0001], [0.055, 0.8], [0.14, 0.0001]]);
  cr.connect(K.out);
}

function moan(K, f0, len) {
  const o = K.osc('sine', f0);
  K.env(o.frequency, [[0, f0], [len * 0.4, f0 * 1.35], [len, f0 * 0.8]]);
  const o2 = K.osc('triangle', f0 * 2.01);
  K.env(o2.frequency, [[0, f0 * 2.01], [len * 0.4, f0 * 2.7], [len, f0 * 1.6]]);
  const vib = K.osc('sine', 5);
  const vg = K.gain(f0 * 0.04);
  vib.connect(vg); vg.connect(o.frequency);
  const g = K.gain(0);
  K.env(g.gain, [[0, 0], [len * 0.25, 1], [len, 0]], true);
  const g2 = K.gain(0.35);
  o.connect(g); o2.connect(g2); g2.connect(g);
  const lp = K.filt('lowpass', 900, 6);
  K.chain(g, lp, K.out);
}

function buzzLoop(K) {
  // exactly 1 s with whole cycles so it loops seamlessly
  const o = K.osc('sawtooth', 190);
  const o2 = K.osc('sawtooth', 191);
  const am = K.am(14, 0.35, 0.7);
  const bp = K.filt('bandpass', 700, 0.8);
  const g = K.gain(0.5);
  o.connect(am); o2.connect(am);
  K.chain(am, bp, g, K.out);
  const hi = K.chain(K.osc('sawtooth', 380), K.filt('bandpass', 2400, 2), K.gain(0.12));
  hi.connect(K.out);
}

function emerge(K) {
  squelch(K, 0, 0.45, 500);
  hiss(K, 2000, 0.7);
}

function spitHock(K) {
  const n = K.chain(K.noise(), K.filt('bandpass', 700, 1.5), K.drive(2), K.gain(0));
  K.env(n.gain, [[0, 0.0001], [0.04, 1], [0.12, 0.0001]]);
  n.connect(K.out);
  const o = K.osc('sine', 700);
  K.env(o.frequency, [[0.05, 750], [0.25, 180]]);
  const g = K.gain(0);
  K.env(g.gain, [[0.05, 0.0001], [0.06, 0.6], [0.28, 0.0001]]);
  o.connect(g); g.connect(K.out);
  const w = K.chain(K.noise(0.06), K.filt('bandpass', 2400, 0.7), K.gain(0));
  K.env(w.gain, [[0.06, 0.0001], [0.1, 0.4], [0.35, 0.0001]]);
  w.connect(K.out);
}

// Scattergun: heavy boom, wide crack, pump clack-clack afterwards
function shotgun(K) {
  const { r, out } = K;
  const bus = K.gain(1);
  bus.connect(out);
  const p = 1 + (r() - 0.5) * 0.06;
  const crack = K.chain(K.noise(), K.filt('bandpass', 900 * p, 0.5), K.drive(5), K.gain(0));
  K.env(crack.gain, [[0, 1.6], [0.04, 0.9], [0.35, 0.0001]]);
  crack.connect(bus);
  const body = K.chain(K.noise(), K.filt('lowpass', 1600), K.gain(0));
  K.env(body.gain, [[0, 1.0], [0.1, 0.4], [0.5, 0.0001]]);
  body.connect(bus);
  const th = K.osc('sine', 110 * p);
  K.env(th.frequency, [[0, 120 * p], [0.25, 34]]);
  const thg = K.chain(th, K.drive(2.2), K.gain(0));
  K.env(thg.gain, [[0, 1.1], [0.12, 0.5], [0.4, 0.0001]]);
  thg.connect(bus);
  // pump: two metallic clacks
  for (const t of [0.42, 0.56]) {
    const c = K.chain(K.noise(t), K.filt('bandpass', 3200 + r() * 400, 4), K.gain(0));
    K.env(c.gain, [[t, 0.0001], [t + 0.002, 0.5], [t + 0.05, 0.0001]]);
    c.connect(bus);
    const o = K.osc('sine', 1900 + r() * 300, t);
    const og = K.chain(o, K.gain(0));
    K.env(og.gain, [[t, 0.0001], [t + 0.002, 0.12], [t + 0.07, 0.0001]]);
    og.connect(bus);
  }
}

// Rail cannon: rising capacitor whine, then a hard electric crack with a long ringing tail
function railgun(K) {
  const { r, out } = K;
  const bus = K.gain(1);
  bus.connect(out);
  const crack = K.chain(K.noise(), K.filt('highpass', 1800), K.drive(6), K.gain(0));
  K.env(crack.gain, [[0, 1.5], [0.03, 0.6], [0.25, 0.0001]]);
  crack.connect(bus);
  const z = K.osc('sawtooth', 5000);
  K.env(z.frequency, [[0, 5200], [0.4, 120]]);
  const zg = K.chain(z, K.filt('lowpass', 7000, 2), K.gain(0));
  K.env(zg.gain, [[0, 0.5], [0.45, 0.0001]]);
  zg.connect(bus);
  const th = K.osc('sine', 80);
  K.env(th.frequency, [[0, 95], [0.5, 30]]);
  const thg = K.chain(th, K.drive(2), K.gain(0));
  K.env(thg.gain, [[0, 1.0], [0.6, 0.0001]]);
  thg.connect(bus);
  // metallic ring
  for (const [f, a] of [[1840, 0.12], [2930, 0.08], [4410, 0.05]]) {
    const o = K.osc('sine', f * (1 + (r() - 0.5) * 0.02));
    const og = K.chain(o, K.gain(0));
    K.env(og.gain, [[0, a], [1.1, 0.0001]]);
    og.connect(bus);
  }
}

// Flamethrower burst (short, layered so it can be played back to back)
function flameBurst(K) {
  const roar = K.chain(K.noise(), K.filt('lowpass', 700), K.drive(1.5), K.gain(0));
  K.env(roar.gain, [[0, 0.0001], [0.03, 0.9], [0.18, 0.7], [0.3, 0.0001]]);
  roar.connect(K.out);
  const hiss = K.chain(K.noise(), K.filt('bandpass', 2600, 0.6), K.gain(0));
  K.env(hiss.gain, [[0, 0.0001], [0.02, 0.25], [0.3, 0.0001]]);
  hiss.connect(K.out);
}

// ---------------------------------------------------------------------------
const RECIPES = {
  shotgun: { n: 3, dur: 0.75, fn: shotgun },
  railgun: { n: 2, dur: 1.2, fn: railgun },
  flameBurst: { n: 3, dur: 0.32, fn: flameBurst },
  rifle: { n: 4, dur: 0.9, fn: (K, v) => rifle(K, v) },
  gatling: { n: 3, dur: 0.15, fn: gatling },
  magOut: { n: 1, dur: 0.25, fn: magOut },
  magIn: { n: 1, dur: 0.15, fn: magIn },
  charge: { n: 1, dur: 0.42, fn: charge },
  dry: { n: 1, dur: 0.08, fn: dry },
  flesh: { n: 3, dur: 0.12, fn: fleshHit },
  chitterS: { n: 3, dur: 0.6, fn: (K) => chitter(K, 4200, 10 + ((K.r() * 8) | 0), 32) },
  chitterM: { n: 3, dur: 0.7, fn: (K) => chitter(K, 2500, 8 + ((K.r() * 8) | 0), 24) },
  screechS: { n: 3, dur: 0.35, fn: (K) => screech(K, 1250 + K.r() * 300, 0.3) },
  screechM: { n: 3, dur: 0.55, fn: (K) => screech(K, 620 + K.r() * 160, 0.5) },
  screechB: { n: 2, dur: 0.9, fn: (K) => screech(K, 280 + K.r() * 60, 0.85, { glideTo: 0.6, rough: 5 }) },
  hissS: { n: 2, dur: 0.6, fn: (K) => hiss(K, 4200, 0.55) },
  hissM: { n: 2, dur: 0.9, fn: (K) => hiss(K, 2600, 0.85) },
  hissB: { n: 2, dur: 1.2, fn: (K) => hiss(K, 1300, 1.1) },
  growlB: { n: 3, dur: 1.3, fn: (K) => growl(K, 72 + K.r() * 14, 1.2) },
  roar: { n: 2, dur: 2.3, fn: (K) => { growl(K, 48 + K.r() * 8, 2.2); screech(K, 190, 1.6, { glideTo: 0.55, rough: 6 }); } },
  deathS: { n: 3, dur: 0.5, fn: (K) => { screech(K, 1400 + K.r() * 300, 0.25, { glideTo: 0.35 }); squelch(K, 0.05, 0.3, 900); } },
  deathM: { n: 3, dur: 0.85, fn: (K) => { screech(K, 650 + K.r() * 150, 0.5, { glideTo: 0.3 }); squelch(K, 0.1, 0.5, 600); } },
  deathB: { n: 2, dur: 1.5, fn: (K) => { screech(K, 300, 0.9, { glideTo: 0.3, rough: 5 }); growl(K, 60, 1.3); squelch(K, 0.3, 0.9, 400); } },
  bite: { n: 3, dur: 0.18, fn: bite },
  moan: { n: 2, dur: 1.8, fn: (K) => moan(K, 95 + K.r() * 40, 1.7) },
  buzz: { n: 1, dur: 1.0, fn: buzzLoop, loop: true },
  emerge: { n: 2, dur: 0.75, fn: emerge },
  spitHock: { n: 2, dur: 0.38, fn: spitHock },
};

export async function buildSoundBank() {
  const bank = {};
  let seed = 11;
  for (const [name, R] of Object.entries(RECIPES)) {
    bank[name] = [];
    for (let v = 0; v < R.n; v++) {
      try { bank[name].push(await render(R.dur, seed++ * 7919, (K) => R.fn(K, v), R.loop)); }
      catch (e) { console.warn('sound failed', name, e); }
    }
  }
  return bank;
}
