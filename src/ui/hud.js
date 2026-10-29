import { icon } from './icons.js';
import { BUILDINGS } from '../data/buildings.js';
import { getClass, WEAPONS } from '../data/classes.js';
import { ABILITIES } from '../entities/abilities.js';
const WEAPON_ICONS = { rifle: 'rifle', shotgun: 'shotgun', flamer: 'flamer', railgun: 'railgun' };

const $ = (id) => document.getElementById(id);
const SLOT_ICONS = { gun: 'rifle', barricade: 'barricade', gatling: 'gatling', flamer: 'flamer', tesla: 'tesla', mortar: 'mortar', trap: 'trap', generator: 'generator', shield: 'shield', spikes: 'spikes', goo: 'goo', vent: 'vent', launcher: 'launcher', laser: 'laser' };
const RADAR_RANGE = 42;

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      root: $('hud'),
      waveTitle: $('wave-title'), waveSub: $('wave-sub'), waveProg: $('wave-progress').firstElementChild,
      coreFill: $('core-fill'), coreGhost: $('core-ghost'), coreText: $('core-text'), coreBar: document.querySelector('.core-bar'),
      boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'),
      credits: $('credit-num'), kills: $('kill-num'), creditsRes: document.querySelector('.res.credits'),
      hpText: $('hp-text'), hpMax: $('hp-max'), hpFill: $('hp-fill'), health: $('health'), shFill: $('sh-fill'), shText: $('sh-text'), jetFill: $('jet-fill'),
      ammo: $('ammo'), ammoCur: $('ammo-cur'), ammoMax: $('ammo-max'), reloadBar: $('reload-bar'), reloadHint: $('reload-hint'),
      hotbar: $('hotbar'), buildHint: $('build-hint'),
      sp: $('struct-panel'), spIcon: $('sp-icon'), spName: $('sp-name'), spLevel: $('sp-level'), spFill: $('sp-fill'), spHp: $('sp-hp'), spStats: $('sp-stats'), spActions: $('sp-actions'),
      toasts: $('toasts'), center: $('center-msg'),
      crosshair: $('crosshair'), hit: $('hitmarker'), vignette: $('vignette'), lowhp: $('lowhp'), dirs: $('dmg-dirs'),
      dead: $('dead-screen'), radar: $('radar'), radarLabel: $('radar-label'),
    };
    $('ico-credits').innerHTML = icon('crystal');
    $('ico-kills').innerHTML = icon('skull');
    $('ico-hp').innerHTML = icon('heart');
    $('ico-power').innerHTML = icon('power');
    this.el.power = $('power-num');
    this.el.powerRes = document.querySelector('.res.power');

    this.buildHotbar('marine');

    this.dirEls = [];
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'dmg-dir';
      this.el.dirs.appendChild(d);
      this.dirEls.push({ el: d, life: 0, x: 0, z: 0 });
    }
    this.dirNext = 0;
    this.centerT = 0;
    this.hitT = 0;
    this.vigT = 0;
    this.coreHitT = 0;
    this.lastCredits = 0;
    this.radarCtx = this.el.radar.getContext('2d');
    this.radarT = 0;
    this.cache = {};
  }

  // hotbar: the class's weapon on 1, then its traps and defenses
  buildHotbar(clsId) {
    const cls = getClass(clsId);
    const wdef = WEAPONS[cls.weapon];
    const wName = { rifle: 'Rifle', shotgun: 'Scatter', flamer: 'Flamer', railgun: 'Rail' }[cls.weapon];
    const slots = ['gun', ...cls.build];
    this.el.hotbar.innerHTML = slots.map((m, i) => {
      const def = BUILDINGS[m];
      const pw = def && def.levels[0].power ? `<span class="pw">⚡${def.levels[0].power}</span>` : def && def.levels[0].supply ? `<span class="pw">+⚡${def.levels[0].supply}</span>` : '';
      const ic = m === 'gun' ? WEAPON_ICONS[cls.weapon] : SLOT_ICONS[m];
      return `<div class="slot" data-mode="${m}"><span class="key">${(i + 1) % 10}</span>${pw}${icon(ic)}<span class="nm">${def ? def.short : wName}</span>${def ? `<span class="cost">${def.cost}</span>` : '<span class="cost" style="color:var(--muted)">∞</span>'}</div>`;
    }).join('');
    this.slotEls = [...this.el.hotbar.children];
    const wn = document.getElementById('weapon-name');
    if (wn) wn.textContent = wdef.name;
    const ab = ABILITIES[clsId] || ABILITIES.marine;
    const ae = document.getElementById('ability');
    if (ae) {
      ae.querySelector('.ab-ico').innerHTML = icon(ab.icon);
      ae.querySelector('.ab-name').textContent = ab.name;
    }
    this.cache = {};
  }

  show(on) { this.el.root.classList.toggle('hidden', !on); }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  // style writes are cached too, so unchanged values never touch the DOM
  sty(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  }

  tog(key, el, cls, on) {
    on = !!on;
    if (this.cache[key] === on) return;
    this.cache[key] = on;
    el.classList.toggle(cls, on);
  }

  // A new alien type shows up: a card with its name and how to deal with it
  introAlien(type, def) {
    let card = document.getElementById('intro-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'intro-card';
      this.el.root.appendChild(card);
    }
    card.innerHTML = `<div class="ic-swatch" style="background:${def.colors.shell};color:${def.colors.eye}">${icon('bug')}</div>
      <div class="ic-body"><div class="ic-kicker">NEW ALIEN</div><div class="ic-name">${def.name.toUpperCase()}</div><div class="ic-desc">${def.desc}</div></div>`;
    card.classList.remove('show');
    void card.offsetWidth; // restart the slide-in (rare event, so the layout read is fine)
    card.classList.add('show');
    clearTimeout(this.introT);
    this.introT = setTimeout(() => card.classList.remove('show'), 10000);
  }

  // ------------------------------------------------------------ messages
  message(title, sub = '', { kicker = '', dur = 2.8, style = '' } = {}) {
    const c = this.el.center;
    c.querySelector('h1').textContent = title;
    c.querySelector('p').textContent = sub;
    c.querySelector('.cm-kicker').textContent = kicker;
    c.className = 'show ' + style;
    this.centerT = dur;
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 2300);
  }

  hitmarker(head, kill) {
    const h = this.el.hit;
    h.className = (head ? 'head ' : '') + (kill ? 'kill' : '');
    this.sty('s15', h, 'opacity', 1);
    this.hitT = kill ? 0.22 : 0.12;
  }

  damageFlash(k = 0.6) {
    this.sty('s16', this.el.vignette, 'opacity', Math.min(0.75, 0.25 + k * 0.5));
    this.vigT = 0.3;
  }

  damageDir(from) {
    const d = this.dirEls[this.dirNext];
    this.dirNext = (this.dirNext + 1) % this.dirEls.length;
    d.x = from.x; d.z = from.z;
    d.life = 1.2;
  }

  coreHit() { this.coreHitT = 0.4; }

  setDead(on) { this.el.dead.classList.toggle('hidden', !on); }
  setDeadTimer(t) { this.set('dead', this.el.dead.querySelector('p'), `Redeploying in ${Math.ceil(Math.max(0, t))}…`); }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    const el = this.el;
    const p = g.player;
    const w = g.weapon;

    // radar first: canvas drawing can make the browser bring styles up to date, which is
    // free now but costly after the style writes below
    this.radarT -= dt;
    if (this.radarT <= 0) { this.radarT = 1 / 30; this.drawRadar(); }

    // wave info
    if (g.phase === 'build') {
      const s = Math.ceil(g.phaseTimer);
      this.set('wt', el.waveTitle, g.wave === 0 ? 'PREPARE DEFENSES' : `WAVE ${g.wave} CLEARED`);
      const nextName = g.totalWaves && g.wave + 1 === g.totalWaves ? 'FINAL WAVE' : `Wave ${g.wave + 1}${g.totalWaves ? ' of ' + g.totalWaves : ''}`;
      this.set('ws', el.waveSub, `${nextName} in <b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b> &nbsp;·&nbsp; <kbd>G</kbd> start now &nbsp;·&nbsp; <kbd>B</kbd> armory`, 'innerHTML');
      this.sty('s1', el.waveProg, 'transform', `scaleX(${g.phaseTimer / g.phaseTotal})`);
    } else if (g.phase === 'wave') {
      this.set('wt', el.waveTitle, g.totalWaves ? (g.wave === g.totalWaves ? 'FINAL WAVE' : `WAVE ${g.wave} / ${g.totalWaves}`) : `WAVE ${g.wave}`);
      const rem = g.enemiesRemaining();
      this.set('ws', el.waveSub, `${rem} ${rem === 1 ? 'alien' : 'aliens'} remaining`);
      this.sty('s2', el.waveProg, 'transform', `scaleX(${Math.min(1, rem / Math.max(1, g.waveTotal))})`);
    }

    const coreK = Math.max(0, g.core.hp / g.core.maxHp);
    this.sty('s3', el.coreFill, 'transform', `scaleX(${coreK})`);
    this.sty('s4', el.coreGhost, 'transform', `scaleX(${coreK})`);
    this.set('core', el.coreText, `CORE ${Math.ceil(g.core.hp)} / ${g.core.maxHp}`);
    this.coreHitT -= dt;
    this.tog('t17', el.coreBar, 'hit', this.coreHitT > 0);

    // boss
    const boss = g.enemies.boss;
    this.tog('t18', el.boss, 'hidden', !boss);
    if (boss) {
      this.set('bossn', el.bossName, boss.def.name.toUpperCase());
      this.sty('s5', el.bossFill, 'transform', `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`);
    }

    // resources
    if (g.credits !== this.lastCredits) {
      // restart the bump animation without forcing a layout (no offsetWidth read)
      if (g.credits > this.lastCredits) el.credits.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)', color: '#fff', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 250 });
      this.lastCredits = g.credits;
      el.credits.textContent = g.credits;
    }
    this.set('kills', el.kills, g.stats.kills);
    const cap = g.build.powerCap, used = g.build.powerUsed;
    this.set('power', el.power, `${used} / ${cap}`);
    this.tog('t19', el.powerRes, 'full', used >= cap);
    const free = cap - used;

    // health
    const hpK = Math.max(0, p.hp / p.maxHp);
    this.sty('s6', el.hpFill, 'transform', `scaleX(${hpK})`);
    this.set('hp', el.hpText, Math.ceil(p.hp));
    this.set('hpm', el.hpMax, `/ ${p.maxHp}`);
    this.tog('t20', el.health, 'low', hpK < 0.3);
    const shK = Math.max(0, p.shield / p.maxShield);
    this.sty('s7', el.shFill, 'transform', `scaleX(${shK})`);
    this.set('sh', el.shText, `SHIELD ${Math.ceil(p.shield)}`);
    this.tog('t21', el.health, 'shield-down', shK <= 0.001 && !p.dead);
    this.sty('s7j', el.jetFill, 'transform', `scaleX(${Math.round(p.fuel * 50) / 50})`);
    this.tog('t21j', el.health, 'jet', p.fuel < 0.999 || p.jetting);
    this.sty('s8', el.lowhp, 'opacity', !p.dead && hpK < 0.3 ? (0.3 - hpK) * 3 : 0);

    // ammo
    this.set('ammo', el.ammoCur, w.reloading > 0 ? '—' : w.ammo);
    this.set('ammom', el.ammoMax, w.stats.mag);
    this.tog('t22', el.ammo, 'empty', w.ammo === 0);
    this.tog('t23', el.reloadBar, 'show', w.reloading > 0);
    if (w.reloading > 0) this.sty('s9', el.reloadBar.firstElementChild, 'transform', `scaleX(${1 - w.reloading / w.reloadTotal})`);
    this.tog('t24', el.reloadHint, 'show', w.reloading <= 0 && w.ammo < w.stats.mag * 0.25);

    // class ability
    const ab = g.abilities;
    if (ab) {
      const ae = this.el.ability || (this.el.ability = document.getElementById('ability'));
      const f = ab.cd > 0 ? ab.cd / ab.def.cd : 0;
      this.sty('sab', ae, '--p', Math.round(f * 100) / 100);
      this.set('abt', ae.querySelector('.ab-time'), ab.cd > 0 ? String(Math.ceil(ab.cd)) : '');
      this.tog('tab', ae, 'ready', ab.cd <= 0);
    }

    // hotbar
    const mode = g.build.mode || 'gun';
    for (const s of this.slotEls) {
      const m = s.dataset.mode;
      this.tog('ha' + m, s, 'active', m === mode);
      if (m !== 'gun') {
        const c = g.build.cost(m);
        this.tog('hc' + m, s, 'cant', g.credits < c);
        this.tog('hn' + m, s, 'nopower', (BUILDINGS[m].levels[0].power || 0) > free);
        const ce = s._cost || (s._cost = s.querySelector('.cost'));
        if (ce.textContent !== String(c)) ce.textContent = c;
      }
    }

    // crosshair
    const ch = el.crosshair;
    this.tog('chb', ch, 'build', g.build.mode);
    const gap = 4 + w.spread * 900;
    const ci = ch.children;
    this.sty('s10', ci[0], 'transform', `translateY(${-gap}px)`);
    this.sty('s11', ci[1], 'transform', `translateY(${gap}px)`);
    this.sty('s12', ci[2], 'transform', `translateX(${-gap}px)`);
    this.sty('s13', ci[3], 'transform', `translateX(${gap}px)`);
    this.sty('s14', ch, 'opacity', p.adsT > 0.5 || p.dead ? 0 : 1);

    // build hints
    if (g.build.mode) {
      const def = BUILDINGS[g.build.mode];
      const t = g.build.target;
      const reason = t && !t.valid ? `<span style="color:var(--danger)">${t.reason}</span><span class="sep">|</span>` : '';
      this.set('bh', el.buildHint, `<div class="bh-row">${reason}<span><kbd>LMB</kbd> place ${def.name}</span>${def.rotatable ? '<span class="sep">|</span><span><kbd>R</kbd> rotate</span>' : ''}<span class="sep">|</span><span><kbd>RMB</kbd> cancel</span></div><div class="bh-desc">${def.desc}</div>`, 'innerHTML');
    } else this.set('bh', el.buildHint, '', 'innerHTML');

    this.updateStructPanel();

    // timers
    this.centerT -= dt;
    if (this.centerT <= 0) el.center.classList.remove('show');
    this.hitT -= dt;
    if (this.hitT <= 0) this.sty('s15', el.hit, 'opacity', 0);
    this.vigT -= dt;
    if (this.vigT <= 0) this.sty('s16', el.vignette, 'opacity', Math.max(0, parseFloat(el.vignette.style.opacity || 0) - dt * 3));

    // damage direction indicators
    for (const d of this.dirEls) {
      if (d.life <= 0) { if (!d.off) { d.el.style.opacity = 0; d.off = true; } continue; }
      d.off = false;
      d.life -= dt;
      const ang = Math.atan2(d.x - p.pos.x, -(d.z - p.pos.z)) + p.yaw;
      d.el.style.transform = `rotate(${ang}rad)`;
      d.el.style.opacity = Math.min(1, d.life * 1.5);
    }
  }

  updateStructPanel() {
    const g = this.game;
    const s = g.build.aimed;
    const el = this.el;
    el.sp.classList.toggle('hidden', !s);
    if (!s) { this.cache.sp = null; return; }
    const b = g.build;
    const lv = s.def.levels[s.level];
    const key = `${s.i},${s.j},${s.level}`;
    if (this.cache.sp !== key) {
      this.cache.sp = key;
      el.spIcon.innerHTML = icon(SLOT_ICONS[s.type]);
      el.spName.textContent = s.def.name;
      el.spLevel.innerHTML = [0, 1, 2].map((i) => `<i class="${i <= s.level ? 'on' : ''}"></i>`).join('');
      const stats = [];
      if (lv.dmg) stats.push(`Damage <b>${lv.dmg}</b>`);
      if (lv.dps) stats.push(`Damage/s <b>${lv.dps}</b>`);
      if (lv.rate) stats.push(`Rate <b>${lv.rate}/s</b>`);
      if (lv.chains) stats.push(`Chains <b>${lv.chains}</b>`);
      if (lv.radius) stats.push(`Blast <b>${lv.radius}m</b>`);
      if (s.def.range) stats.push(`Range <b>${lv.range || s.def.range}m</b>`);
      if (lv.thorns) stats.push(`Thorns <b>${lv.thorns}</b>`);
      if (lv.slow) stats.push(`Slow <b>${Math.round((1 - lv.slow) * 100)}%</b>`);
      if (lv.power) stats.push(`Uses <b>⚡${lv.power}</b>`);
      if (lv.supply) stats.push(`Produces <b>⚡${lv.supply}</b>`);
      const next = s.def.levels[s.level + 1];
      el.spStats.innerHTML = stats.join(' · ') + (next ? `<br>Next: <b>${next.note}</b>` : '<br><b style="color:var(--good)">MAX LEVEL</b>');
    }
    if (isFinite(s.maxHp)) {
      el.spFill.parentElement.style.display = '';
      el.spFill.style.transform = `scaleX(${Math.max(0, s.hp / s.maxHp)})`;
      this.set('sphp', el.spHp, `${Math.ceil(s.hp)} / ${Math.round(s.maxHp)}`);
    } else el.spFill.parentElement.style.display = 'none';
    const offline = s.offline ? '<div class="sp-offline">⚡ OFFLINE: NOT ENOUGH POWER</div>' : '';
    const up = b.upgradeCost(s);
    const rep = b.repairCost(s);
    const sell = b.sellValue(s);
    const cr = g.credits;
    const html = `${offline}
      <div class="sp-act ${up === null ? 'dis' : cr < up ? 'cant' : ''}"><kbd>E</kbd> Upgrade <span class="c">${up === null ? 'MAX' : up + ' ⬢'}</span></div>
      <div class="sp-act ${!rep ? 'dis' : cr < rep ? 'cant' : ''}"><kbd>F</kbd> Repair <span class="c">${rep ? rep + ' ⬢' : '—'}</span></div>
      ${s.def.rotatable ? '<div class="sp-act"><kbd>T</kbd> Rotate <span class="c">free</span></div>' : ''}
      <div class="sp-act"><kbd>X</kbd> Sell <span class="c" style="color:var(--good)">+${sell} ⬢</span></div>`;
    this.set('spa', el.spActions, html, 'innerHTML');
  }

  // ------------------------------------------------------------ radar
  prepareRadar(world) {
    const nav = world.nav;
    const px = 4;
    const c = document.createElement('canvas');
    c.width = nav.cols * px;
    c.height = nav.rows * px;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(80, 110, 140, 0.25)';
    g.fillRect(0, 0, c.width, c.height);
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      const k = nav.idx(i, j);
      if (nav.blocked[k] === 4 || nav.blocked[k] === 6) { g.fillStyle = 'rgba(20, 30, 45, 0.75)'; g.fillRect(i * px, j * px, px, px); } // cliff edge / unreachable high ground
      else if (nav.blocked[k] === 5) { g.fillStyle = 'rgba(90, 255, 60, 0.35)'; g.fillRect(i * px, j * px, px, px); } // chasm
      else if (nav.blocked[k]) { g.fillStyle = 'rgba(190, 210, 235, 0.55)'; g.fillRect(i * px, j * px, px, px); }
      else if (nav.pool[k]) { g.fillStyle = 'rgba(150, 255, 60, 0.45)'; g.fillRect(i * px, j * px, px, px); }
      else if (nav.h[k] > 0.4) { g.fillStyle = `rgba(255, 240, 210, ${Math.min(0.28, nav.h[k] * 0.035)})`; g.fillRect(i * px, j * px, px, px); } // high ground
    }
    g.strokeStyle = 'rgba(61, 224, 255, 0.5)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, c.width - 2, c.height - 2);
    this.radarMap = c;
    this.radarPx = px;
    this.el.radarLabel.textContent = world.map.name.toUpperCase();
  }

  drawRadar() {
    const g = this.game;
    const ctx = this.radarCtx;
    const W = 200, R = 100;
    const p = g.player;
    const nav = g.world.nav;
    const scale = R / RADAR_RANGE; // px per meter
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(R, R);
    ctx.rotate(p.yaw);
    // map layer
    const mpx = scale * 2 / this.radarPx; // map canvas px -> radar px
    ctx.save();
    ctx.scale(mpx, mpx);
    ctx.drawImage(this.radarMap, (-nav.halfX - p.pos.x) / 2 * this.radarPx, (-nav.halfZ - p.pos.z) / 2 * this.radarPx);
    ctx.restore();
    const tx = (x) => (x - p.pos.x) * scale;
    const tz = (z) => (z - p.pos.z) * scale;
    // hives
    for (const h of g.world.hives) {
      ctx.fillStyle = h.active ? `rgba(200, 90, 255, ${0.6 + Math.sin(g.time * 6) * 0.3})` : 'rgba(150, 90, 190, 0.5)';
      ctx.beginPath();
      ctx.arc(tx(h.pos.x), tz(h.pos.z), 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // structures
    for (const s of g.build.structures) {
      ctx.fillStyle = s.def.turret ? '#ffb43d' : s.def.solid ? '#9fb8d0' : '#2a8cff';
      ctx.fillRect(tx(s.x) - 2.5, tz(s.z) - 2.5, 5, 5);
    }
    // core
    ctx.fillStyle = '#3de0ff';
    ctx.save();
    ctx.translate(tx(g.core.pos.x), tz(g.core.pos.z));
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    // enemies
    for (const e of g.enemies.list) {
      if (e.dead) continue;
      const r = e.def.boss ? 6 : e.def.radius > 1 ? 3.5 : 2.4;
      ctx.fillStyle = e.def.boss ? '#ff6af5' : e.def.flying ? '#ffe14d' : '#ff4a5a';
      ctx.beginPath();
      ctx.arc(tx(e.pos.x), tz(e.pos.z), r, 0, Math.PI * 2);
      ctx.fill();
    }
    // teammates (co-op)
    for (const q of g.players) {
      if (!q.isRemote) continue;
      ctx.fillStyle = q.dead ? 'rgba(255,255,255,0.35)' : q.color;
      ctx.beginPath();
      ctx.arc(tx(q.pos.x), tz(q.pos.z), 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    // player arrow + view cone
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.arc(R, R, R, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(R, R - 7);
    ctx.lineTo(R + 5, R + 5);
    ctx.lineTo(R, R + 2);
    ctx.lineTo(R - 5, R + 5);
    ctx.closePath();
    ctx.fill();
    // compass N
    // drawn as three strokes instead of text: fillText on a canvas in the page makes
    // the browser recalculate styles to resolve the font, which showed up as a stall
    const nx = R + Math.sin(-p.yaw) * (R - 10) * -1;
    const ny = R - Math.cos(p.yaw) * (R - 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(nx - 3, ny + 4);
    ctx.lineTo(nx - 3, ny - 4);
    ctx.lineTo(nx + 3, ny + 4);
    ctx.lineTo(nx + 3, ny - 4);
    ctx.stroke();
  }
}
