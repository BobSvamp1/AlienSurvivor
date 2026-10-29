// Synthesized sound effects and procedural music (Web Audio). No audio files needed.
import { buildSoundBank } from './soundbank.js';

// How each alien sounds: size class, pitch and which idle noises it makes
const VOICES = {
  swarmling: { cls: 'S', pitch: 1.25, idle: ['chitterS', 'chitterS', 'hissS'] },
  drone: { cls: 'S', pitch: 1.0, idle: ['chitterS', 'chitterS', 'hissS'] },
  wasp: { cls: 'S', pitch: 1.3, idle: ['chitterS'] },
  spitter: { cls: 'M', pitch: 1.1, idle: ['chitterM', 'hissM'] },
  leaper: { cls: 'M', pitch: 1.2, idle: ['chitterM', 'chitterM', 'hissM'] },
  bloater: { cls: 'M', pitch: 0.7, idle: ['hissM', 'moan'] },
  serpent: { cls: 'M', pitch: 0.85, idle: ['hissM', 'hissM', 'chitterM'] },
  burrower: { cls: 'M', pitch: 0.75, idle: ['hissB', 'chitterM'] },
  ravager: { cls: 'M', pitch: 0.95, idle: ['chitterM', 'hissM'] },
  floater: { cls: 'B', pitch: 1.0, idle: ['moan'] },
  bulwark: { cls: 'B', pitch: 0.9, idle: ['growlB', 'hissB'] },
  brute: { cls: 'B', pitch: 0.85, idle: ['growlB', 'growlB', 'hissB'] },
  queen: { cls: 'X', pitch: 1.0, idle: ['roar', 'growlB', 'hissB'] },
  titan: { cls: 'X', pitch: 0.75, idle: ['roar', 'growlB'] },
  mender: { cls: 'M', pitch: 1.25, idle: ['moan', 'chitterM'] },
  splitter: { cls: 'M', pitch: 0.8, idle: ['hissM', 'chitterM'] },
  stalker: { cls: 'M', pitch: 1.35, idle: ['hissM'] },
  corroder: { cls: 'S', pitch: 0.85, idle: ['hissS', 'chitterS'] },
  charger: { cls: 'B', pitch: 1.05, idle: ['growlB', 'hissB'] },
  wyrm: { cls: 'X', pitch: 0.6, idle: ['roar', 'hissB'] },
  overseer: { cls: 'X', pitch: 1.3, idle: ['moan', 'roar'] },
};
const CLS = {
  S: { vol: 0.32, screech: 'screechS', death: 'deathS', every: [4, 9] },
  M: { vol: 0.45, screech: 'screechM', death: 'deathM', every: [3, 7] },
  B: { vol: 0.65, screech: 'screechB', death: 'deathB', every: [3, 6] },
  X: { vol: 0.95, screech: 'roar', death: 'deathB', every: [2.5, 5] },
};
const voiceOf = (e) => VOICES[e.type] || VOICES.drone;

const CHORDS = [
  [45, 52, 57, 60], // A minor
  [41, 48, 53, 57], // F
  [43, 50, 55, 59], // G
  [40, 47, 52, 55], // E minor
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.last = {};
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.combat = 0;
    this.combatTarget = 0;
    this.nextBeat = 0;
    this.beat = 0;
    this.chord = 0;
  }

  init(settings) {
    this.settings = settings;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    // simple reverb for space
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb.buffer = ir;
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.25;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    // pre-render the richer sound bank in the background; old synth sounds are used until it is ready
    this.bank = null;
    buildSoundBank().then((b) => { this.bank = b; }).catch((e) => console.warn('sound bank failed', e));
    // recorded sounds from public/sounds (decoded once)
    this.files = {};
    const base = (import.meta.env?.BASE_URL || '/') + 'sounds/';
    for (const [name, file] of [['magInRec', 'mag-in.mp3']]) {
      fetch(base + file).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a)).then((buf) => { this.files[name] = buf; })
        .catch((e) => console.warn('could not load sound', file, e));
    }
    this.voiceTokens = 4;
    this.loops = [];

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.applyVolume();
    this.startPad();
  }

  applyVolume() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.masterVolume * 0.9;
    this.music.gain.value = s.musicVolume * 0.55;
  }

  // ------------------------------------------------------------ music
  startPad() {
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 2;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.12;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.music);
    this.padGain.connect(this.verb);
    this.padOsc = [];
    for (let i = 0; i < 4; i++) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        o.frequency.value = mtof(CHORDS[0][i]);
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.35 : 0.2;
        o.connect(g);
        g.connect(this.padFilter);
        o.start();
        this.padOsc.push({ o, i });
      }
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg);
    lg.connect(this.padFilter.frequency);
    lfo.start();
    this.nextBeat = ctx.currentTime + 0.1;
  }

  setCombat(on) { this.combatTarget = on ? 1 : 0; }

  updateMusic(dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.combat += (this.combatTarget - this.combat) * Math.min(1, dt * 0.6);
    const now = ctx.currentTime;
    const step = 60 / 112 / 2; // eighth notes at 112 bpm
    while (this.nextBeat < now + 0.15) {
      const t = this.nextBeat;
      const b = this.beat;
      if (b % 32 === 0) {
        this.chord = (this.chord + 1) % CHORDS.length;
        const ch = CHORDS[this.chord];
        for (const p of this.padOsc) p.o.frequency.setTargetAtTime(mtof(ch[p.i]), t, 0.6);
      }
      if (this.combat > 0.05) {
        const c = this.combat;
        const root = CHORDS[this.chord][0] - 12;
        // kick
        if (b % 4 === 0) this.tone(120, 38, 0.32, { type: 'sine', vol: 0.55 * c, at: t, out: this.music });
        // bass pulse
        const notes = [0, 0, 12, 0, 0, 7, 0, 10];
        this.tone(mtof(root + notes[b % 8]), mtof(root + notes[b % 8]) * 0.99, step * 0.9, { type: 'sawtooth', vol: 0.11 * c, at: t, out: this.music, lp: 520 });
        // hats
        this.noise(0.04, { type: 'highpass', freq: 7000, vol: (b % 2 ? 0.05 : 0.09) * c, at: t, out: this.music });
        if (b % 8 === 4) this.noise(0.18, { type: 'bandpass', freq: 1800, q: 0.8, vol: 0.22 * c, at: t, out: this.music });
      }
      this.beat++;
      this.nextBeat += step;
    }
    this.padGain.gain.value = 0.12 * (1 - this.combat * 0.35);
  }

  // ------------------------------------------------------------ primitives
  throttle(name, gap) {
    if (!this.ctx) return true;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < gap) return true;
    this.last[name] = now;
    return false;
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // returns [volume, pan] for a world position
  spatial(pos) {
    if (!pos || typeof pos.x !== 'number') return [1, 0];
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const vol = 1 / (1 + d * 0.06);
    const ang = Math.atan2(dx, -dz) + this.listener.yaw;
    return [vol, Math.max(-1, Math.min(1, Math.sin(ang))) * 0.7 * Math.min(1, d / 4)];
  }

  route(pos, out) {
    const [vol, pan] = this.spatial(pos);
    if (out) return { node: out, vol };
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    if (pos && vol < 0.6) {
      const v = this.ctx.createGain();
      v.gain.value = 0.3;
      p.connect(v);
      v.connect(this.verb);
    }
    return { node: p, vol };
  }

  noise(dur, { type = 'bandpass', freq = 1000, q = 1, vol = 0.5, at = 0, pos = null, out = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = at || ctx.currentTime;
    const r = this.route(pos, out);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol * r.vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(r.node);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(f0, f1, dur, { type = 'sine', vol = 0.3, at = 0, pos = null, out = null, lp = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = at || ctx.currentTime;
    const r = this.route(pos, out);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol * r.vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = o;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f);
      last = f;
    }
    last.connect(g);
    g.connect(r.node);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // play a pre-rendered sound (random variant); returns false when the bank isn't ready
  play(name, { pos = null, vol = 1, rate = 1, at = 0, out = null } = {}) {
    const list = (this.files && this.files[name] && [this.files[name]]) || (this.bank && this.bank[name]);
    if (!this.ctx || !list || !list.length) return false;
    const ctx = this.ctx;
    const r = this.route(pos, out);
    if (pos && r.vol < 0.03) return true; // too far away to hear
    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol * r.vol;
    src.connect(g);
    g.connect(r.node);
    src.start(at || ctx.currentTime);
    return true;
  }

  // ------------------------------------------------------------ effects
  shot() {
    if (this.play('rifle', { vol: 0.62, rate: 0.97 + Math.random() * 0.06 })) return;
    this.noise(0.11, { type: 'highpass', freq: 700, vol: 0.5 });
    this.noise(0.06, { type: 'bandpass', freq: 3000, q: 1.5, vol: 0.3 });
    this.tone(160, 40, 0.13, { type: 'square', vol: 0.18, lp: 900 });
  }
  // class ability: a short radio chirp
  ability() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1200, 1600, 0.06, { type: 'square', vol: 0.08 });
    this.tone(1600, 1600, 0.06, { type: 'square', vol: 0.08, at: t + 0.09 });
    this.noise(0.25, { type: 'bandpass', freq: 2500, q: 2, vol: 0.06, at: t + 0.02 });
  }
  // a shell whistling down
  incoming(pos) {
    this.tone(2400, 500, 1.2, { type: 'sine', vol: 0.18, pos });
    this.noise(1.1, { type: 'bandpass', freq: 3000, q: 6, vol: 0.05, pos });
  }
  // gravity well: a deep, sucking hum
  well(pos) {
    this.tone(60, 140, 3.8, { type: 'sawtooth', vol: 0.18, pos, lp: 400 });
    this.tone(900, 120, 3.8, { type: 'sine', vol: 0.06, pos });
    this.noise(3.8, { type: 'lowpass', freq: 300, vol: 0.2, pos });
  }
  shotgun() {
    if (this.play('shotgun', { vol: 0.75, rate: 0.96 + Math.random() * 0.08 })) return;
    this.noise(0.25, { type: 'lowpass', freq: 1400, vol: 0.7 });
    this.tone(120, 35, 0.3, { type: 'sine', vol: 0.5 });
  }
  railgun() {
    if (this.play('railgun', { vol: 0.7, rate: 0.97 + Math.random() * 0.06 })) return;
    this.tone(4000, 200, 0.4, { type: 'sawtooth', vol: 0.2, lp: 6000 });
    this.noise(0.2, { type: 'highpass', freq: 1500, vol: 0.5 });
  }
  flamerFire(pos = null) {
    if (this.throttle(pos ? 'rflame' : 'flame1', 0.16)) return;
    if (!this.play('flameBurst', { pos, vol: pos ? 0.4 : 0.5, rate: 0.9 + Math.random() * 0.2 })) this.noise(0.25, { type: 'lowpass', freq: 800, vol: 0.4, pos });
  }
  // a teammate's weapon, heard from where they stand
  remoteShot(pos, kind = 'rifle') {
    if (kind === 'flamer') { this.flamerFire(pos); return; }
    if (this.throttle('rshot', 0.05)) return;
    const name = kind === 'shotgun' ? 'shotgun' : kind === 'railgun' ? 'railgun' : 'rifle';
    if (!this.play(name, { pos, vol: 0.5, rate: 0.95 + Math.random() * 0.08 })) this.noise(0.08, { type: 'highpass', freq: 800, vol: 0.3, pos });
  }
  dry() {
    if (this.throttle('dry', 0.15)) return;
    if (!this.play('dry', { vol: 0.5 })) this.tone(900, 700, 0.04, { type: 'square', vol: 0.08 });
  }
  turret(pos) {
    if (this.throttle('turret', 0.06)) return;
    if (this.play('gatling', { pos, vol: 0.5, rate: 0.95 + Math.random() * 0.1 })) return;
    this.noise(0.06, { type: 'bandpass', freq: 2400, q: 2, vol: 0.28, pos });
    this.tone(500, 160, 0.05, { type: 'square', vol: 0.06, pos });
  }
  // bullet hitting an alien body
  flesh(pos) {
    if (this.throttle('flesh', 0.04)) return;
    this.play('flesh', { pos, vol: 0.4, rate: 0.9 + Math.random() * 0.25 });
  }

  // ------------------------------------------------------------ aliens
  alienVoice(e, name, volK = 1, rateK = 1) {
    const v = voiceOf(e);
    const c = CLS[v.cls];
    return this.play(name, { pos: e.pos, vol: c.vol * volK, rate: v.pitch * rateK * (0.92 + Math.random() * 0.16) });
  }
  alienAggro(e) {
    if (this.throttle('aggro', 0.35)) return;
    this.alienVoice(e, CLS[voiceOf(e).cls].screech, 0.9);
  }
  alienHurt(e) {
    if (this.throttle('ahurt', 0.09)) return;
    const t = this.ctx ? this.ctx.currentTime : 0;
    if (e.hurtSnd && t - e.hurtSnd < 0.7) return;
    e.hurtSnd = t;
    const v = voiceOf(e);
    this.alienVoice(e, v.cls === 'S' ? 'screechS' : v.cls === 'M' ? 'screechS' : 'screechM', 0.45, v.cls === 'S' ? 1.15 : 0.8);
  }
  alienDeath(e) {
    if (this.throttle('adeath', 0.05)) return false;
    return this.alienVoice(e, CLS[voiceOf(e).cls].death, 1);
  }
  alienBite(e) {
    if (this.throttle('bite', 0.08)) return;
    const v = voiceOf(e);
    this.alienVoice(e, 'bite', 1.1, v.cls === 'S' ? 1.2 : v.cls === 'M' ? 1 : 0.75);
    if (Math.random() < 0.35) this.alienVoice(e, CLS[v.cls].screech, 0.5);
  }
  alienEmerge(pos) {
    if (this.throttle('emerge', 0.25)) return;
    this.play('emerge', { pos, vol: 0.45, rate: 0.85 + Math.random() * 0.3 });
  }
  alienRoar(e) { this.alienVoice(e, 'roar', 1.2); }

  // idle chatter and wing buzz, called every frame while playing
  updateAliens(dt, list) {
    if (!this.ctx || !this.bank) return;
    this.voiceTokens = Math.min(4, this.voiceTokens + dt * 3.5);
    const L = this.listener;
    const flyers = [];
    for (const e of list) {
      if (e.dead || e.hidden) continue;
      const d = Math.hypot(e.pos.x - L.x, e.pos.z - L.z);
      if (e.type === 'wasp' && d < 32) flyers.push([d, e]);
      if (e.voiceT === undefined) e.voiceT = Math.random() * 4;
      e.voiceT -= dt;
      if (e.voiceT > 0) continue;
      const v = voiceOf(e), c = CLS[v.cls];
      e.voiceT = c.every[0] + Math.random() * (c.every[1] - c.every[0]);
      if (d > 42 || this.voiceTokens < 1) continue;
      this.voiceTokens -= 1;
      this.alienVoice(e, v.idle[(Math.random() * v.idle.length) | 0], 0.8);
    }
    // wing buzz for the nearest few flying stingers
    flyers.sort((a, b) => a[0] - b[0]);
    const want = flyers.slice(0, 3).map((f) => f[1]);
    for (let i = this.loops.length - 1; i >= 0; i--) {
      const lp = this.loops[i];
      if (!want.includes(lp.e)) {
        lp.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        lp.src.stop(this.ctx.currentTime + 0.3);
        this.loops.splice(i, 1);
      }
    }
    for (const e of want) {
      let lp = this.loops.find((l) => l.e === e);
      if (!lp) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.bank.buzz[0];
        src.loop = true;
        src.playbackRate.value = 0.9 + Math.random() * 0.25;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        const p = this.ctx.createStereoPanner();
        src.connect(g); g.connect(p); p.connect(this.sfx);
        src.start(this.ctx.currentTime, Math.random());
        lp = { e, src, g, p };
        this.loops.push(lp);
      }
      const [vol, pan] = this.spatial(e.pos);
      lp.g.gain.setTargetAtTime(vol * 0.22, this.ctx.currentTime, 0.05);
      lp.p.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.05);
    }
  }

  stopLoops() {
    if (!this.ctx) return;
    for (const lp of this.loops) { try { lp.src.stop(); } catch { /* already stopped */ } }
    this.loops = [];
  }
  flame(pos) {
    if (this.throttle('flame', 0.12)) return;
    this.noise(0.22, { type: 'lowpass', freq: 900, vol: 0.35, pos });
  }
  jet(pos) {
    this.noise(0.12, { type: 'lowpass', freq: 520, vol: 0.09, pos });
    this.noise(0.1, { type: 'bandpass', freq: 2400, q: 0.8, vol: 0.025, pos });
  }
  stab(pos) {
    if (this.throttle('stab', 0.08)) return;
    this.noise(0.06, { type: 'highpass', freq: 2500, vol: 0.3, pos });
    this.tone(320, 90, 0.12, { type: 'square', vol: 0.12, pos, lp: 1800 });
    this.play('flesh', { pos, vol: 0.6, rate: 0.9 });
  }
  launch(pos) {
    if (this.throttle('launch', 0.1)) return;
    this.tone(90, 40, 0.18, { type: 'sine', vol: 0.5, pos });
    this.noise(0.35, { type: 'bandpass', freq: 700, q: 0.7, vol: 0.35, pos });
    this.tone(400, 1400, 0.3, { type: 'triangle', vol: 0.08, pos, at: 0.02 });
  }
  laser(pos) {
    if (this.throttle('laser', 0.07)) return;
    this.tone(2400, 600, 0.16, { type: 'sawtooth', vol: 0.1, pos, lp: 5000 });
    this.noise(0.1, { type: 'bandpass', freq: 5000, q: 4, vol: 0.12, pos });
  }
  zap(pos, big = false) {
    if (this.throttle(big ? 'zapb' : 'zap', big ? 0.05 : 0.12)) return;
    this.noise(big ? 0.25 : 0.08, { type: 'bandpass', freq: big ? 3200 : 4500, q: 3, vol: big ? 0.45 : 0.15, pos });
    if (big) this.tone(1800, 200, 0.2, { type: 'sawtooth', vol: 0.08, pos });
  }
  mortar(pos) {
    this.tone(90, 40, 0.4, { type: 'sine', vol: 0.6, pos });
    this.noise(0.3, { type: 'lowpass', freq: 600, vol: 0.4, pos });
  }
  explosion(pos, scale = 1) {
    if (this.throttle('boom', 0.04)) return;
    this.noise(0.9 * scale + 0.2, { type: 'lowpass', freq: 500, vol: 0.9 * scale, pos });
    this.tone(110, 30, 0.6, { type: 'sine', vol: 0.7 * scale, pos });
  }
  hit(head) {
    if (this.throttle('hit', 0.025)) return;
    this.tone(head ? 1700 : 1000, head ? 1500 : 850, 0.05, { type: 'triangle', vol: head ? 0.25 : 0.13 });
  }
  kill() {
    if (this.throttle('killc', 0.05)) return;
    this.tone(1300, 1900, 0.07, { type: 'triangle', vol: 0.12 });
  }
  squish(big, pos) {
    if (!big && this.throttle('squish', 0.04)) return;
    this.noise(big ? 1.0 : 0.25, { type: 'lowpass', freq: big ? 380 : 800, vol: big ? 0.9 : 0.35, pos });
    this.tone(big ? 150 : 300, 45, big ? 0.9 : 0.2, { type: 'sawtooth', vol: big ? 0.3 : 0.08, pos, lp: 1200 });
  }
  chew(pos) {
    if (this.throttle('chew', 0.09)) return;
    this.noise(0.08, { type: 'bandpass', freq: 1400, q: 4, vol: 0.18, pos });
  }
  spit(pos) {
    if (this.throttle('spit', 0.07)) return;
    if (this.play('spitHock', { pos, vol: 0.55, rate: 0.9 + Math.random() * 0.2 })) return;
    this.noise(0.2, { type: 'lowpass', freq: 1400, vol: 0.3, pos });
    this.tone(400, 120, 0.15, { type: 'sine', vol: 0.12, pos });
  }
  sting(pos) {
    if (this.throttle('sting', 0.1)) return;
    this.tone(900, 300, 0.12, { type: 'sawtooth', vol: 0.1, pos, lp: 2000 });
  }
  buzz(pos) {
    if (this.throttle('buzz', 0.4)) return;
    this.tone(210, 190, 0.4, { type: 'sawtooth', vol: 0.06, pos, lp: 900 });
  }
  rumble(pos) {
    if (this.throttle('rumble', 0.25)) return;
    this.noise(0.3, { type: 'lowpass', freq: 160, vol: 0.35, pos });
  }
  leap(pos) {
    if (this.play('screechM', { pos, vol: 0.5, rate: 1.2 + Math.random() * 0.15 })) return;
    this.tone(300, 900, 0.2, { type: 'sawtooth', vol: 0.12, pos, lp: 1500 }); }
  brood(pos) { this.noise(0.7, { type: 'lowpass', freq: 600, vol: 0.5, pos }); this.tone(80, 160, 0.7, { type: 'sawtooth', vol: 0.2, pos, lp: 500 }); }
  slam(pos) { this.explosion(pos, 1.3); }
  hurt() {
    if (this.throttle('hurt', 0.15)) return;
    this.tone(180, 70, 0.25, { type: 'sawtooth', vol: 0.25, lp: 1200 });
    this.noise(0.1, { type: 'lowpass', freq: 500, vol: 0.4 });
  }
  coreHit() {
    if (this.throttle('core', 0.3)) return;
    this.tone(100, 55, 0.4, { type: 'sine', vol: 0.4 });
    this.tone(1200, 900, 0.15, { type: 'square', vol: 0.05 });
  }
  alarm() {
    if (!this.ctx) return;
    if (this.throttle('alarm', 4)) return;
    for (let i = 0; i < 3; i++) this.tone(880, 660, 0.25, { type: 'square', vol: 0.08, at: this.ctx.currentTime + i * 0.3, lp: 2500 });
  }
  build(pos) {
    if (!this.ctx) return;
    this.tone(320, 640, 0.09, { type: 'square', vol: 0.1, pos, lp: 3000 });
    this.tone(640, 960, 0.1, { type: 'square', vol: 0.08, at: this.ctx?.currentTime + 0.08, pos, lp: 3000 });
    this.noise(0.25, { type: 'lowpass', freq: 700, vol: 0.3, pos });
  }
  upgrade(pos) {
    if (!this.ctx) return;
    [523, 659, 784].forEach((f, i) => this.tone(f, f * 1.01, 0.18, { type: 'triangle', vol: 0.18, at: this.ctx.currentTime + i * 0.07, pos }));
  }
  repair(pos) { this.tone(500, 900, 0.2, { type: 'triangle', vol: 0.18, pos }); }
  sell(pos) { this.tone(900, 450, 0.14, { type: 'triangle', vol: 0.16, pos }); }
  destroyed(pos) { this.explosion(pos, 0.7); }
  error() {
    if (this.throttle('error', 0.15)) return;
    this.tone(200, 140, 0.16, { type: 'square', vol: 0.1, lp: 1500 });
  }
  click() { this.tone(1200, 1000, 0.03, { type: 'square', vol: 0.06 }); }
  hover() { if (!this.throttle('hover', 0.04)) this.tone(1800, 1800, 0.02, { type: 'sine', vol: 0.03 }); }
  uiSelect() { this.tone(700, 1100, 0.07, { type: 'triangle', vol: 0.12 }); }
  reload(dur = 1.7) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.bank) {
      this.play('magOut', { vol: 0.5, at: t + 0.05 });
      // recorded mag-in: its main click (0.24 s into the file) lands when the magazine seats
      if (this.files.magInRec) this.play('magInRec', { vol: 0.9, at: t + Math.max(0.1, dur * 0.88 - 0.24) });
      else this.play('magIn', { vol: 0.6, at: t + dur * 0.55 });
      return;
    }
    this.noise(0.04, { type: 'highpass', freq: 3000, vol: 0.3 });
    this.noise(0.05, { type: 'highpass', freq: 2200, vol: 0.35, at: this.ctx?.currentTime + 0.45 });
    this.tone(500, 900, 0.05, { type: 'square', vol: 0.06, at: this.ctx?.currentTime + 0.55 });
  }
  wave(boss) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(110, 98, 2.0, { type: 'sawtooth', vol: 0.2, lp: 800 });
    this.tone(82, 73, 2.0, { type: 'sawtooth', vol: 0.2, lp: 600 });
    if (boss) this.tone(55, 40, 3, { type: 'sawtooth', vol: 0.3, at: t + 0.4, lp: 400 });
  }
  cleared() {
    if (!this.ctx) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.3, { type: 'triangle', vol: 0.15, at: this.ctx.currentTime + i * 0.1 }));
  }
  buy() {
    if (!this.ctx) return;
    this.tone(660, 990, 0.12, { type: 'triangle', vol: 0.18 });
    this.tone(990, 1320, 0.12, { type: 'triangle', vol: 0.14, at: this.ctx.currentTime + 0.09 });
  }
  heal(pos) { if (this.throttle('heal', 0.2)) return; this.tone(380, 920, 0.4, { type: 'sine', vol: 0.2, pos }); this.tone(570, 1380, 0.35, { type: 'triangle', vol: 0.07, pos }); }
  pulse(pos) { this.tone(200, 60, 0.6, { type: 'sine', vol: 0.5, pos }); this.noise(0.4, { type: 'bandpass', freq: 900, vol: 0.3, pos }); }
  footstep() {
    if (this.throttle('step', 0.2)) return;
    this.noise(0.06, { type: 'lowpass', freq: 400 + Math.random() * 200, vol: 0.12 });
  }
}
