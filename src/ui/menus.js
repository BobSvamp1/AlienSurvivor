import { icon } from './icons.js';
import { MAPS, DIFFICULTIES } from '../data/maps.js';
import { ENEMIES, ENEMY_ORDER } from '../data/enemies.js';
import { BUILDINGS, BUILD_ORDER } from '../data/buildings.js';
import { UPGRADES, UPGRADE_TABS } from '../data/upgrades.js';
import { NavGrid } from '../world/nav.js';
import { Elevation } from '../world/elevation.js';
import { mulberry32 } from '../core/rng.js';
import { bestWave, saveSettings } from '../core/settings.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['main', 'coop', 'lobby', 'maps', 'settings', 'howto', 'pause', 'armory', 'over'];
const B_ICONS = { barricade: 'barricade', gatling: 'gatling', flamer: 'flamer', tesla: 'tesla', mortar: 'mortar', trap: 'trap', generator: 'generator', shield: 'shield' };

export class Menus {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.current = null;
    this.selectedMap = MAPS[0].id;
    this.difficulty = 'veteran';
    this.armoryTab = 'weapon';
    this.howtoTab = 'controls';

    document.querySelectorAll('.ico-slot').forEach((s) => (s.innerHTML = icon(s.dataset.icon)));
    $('ico-credits2').innerHTML = icon('crystal');

    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (!b.disabled) game.audio.click();
      if (b.dataset.go) this.go(b.dataset.go);
      if (b.hasAttribute('data-back')) this.back();
    });
    document.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button, .map-card');
      if (b && b !== this.lastHover) { this.lastHover = b; game.audio.hover(); }
    });

    $('start-btn').addEventListener('click', () => game.startGame(this.selectedMap, this.difficulty));
    this.setupCoop();
    $('resume-btn').addEventListener('click', () => game.resume());
    $('restart-btn').addEventListener('click', () => game.startGame(game.mapId, game.difficulty));
    $('quit-btn').addEventListener('click', () => game.quitToMenu());
    $('retry-btn').addEventListener('click', () => game.startGame(game.mapId, game.difficulty));
    $('change-map-btn').addEventListener('click', () => {
      if (game.net.isHost) { game.backToLobby(); this.go('maps'); return; }
      game.quitToMenu();
      this.go('maps');
    });
    $('menu-btn').addEventListener('click', () => game.quitToMenu());
    $('armory-close').addEventListener('click', () => game.closeArmory());

    this.buildMapCards();
    this.buildDifficulty();
    this.buildSettings();
    this.buildHowto();
  }

  get open() { return this.current !== null; }

  showOnly(name) {
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
    this.current = name;
    $('menu-bg').classList.toggle('hidden', !(name === 'main'));
    if (name === 'maps') { this.refreshMapCards(); this.refreshCoopBanner(); }
    if (name === 'armory') this.renderArmory();
    if (name === 'lobby') this.renderLobby();
    if (name === 'coop') { $('coop-name').value = this.game.net.name; this.coopStatus(''); }
    if (name === 'pause' || name === 'over') this.refreshCoopButtons();
  }

  go(name) {
    if (this.current) this.stack.push(this.current);
    this.showOnly(name);
  }

  back() {
    const prev = this.stack.pop();
    if (prev) this.showOnly(prev);
    else if (this.game.inGame) this.game.resume();
    else this.showOnly('main');
  }

  reset(name) {
    this.stack = [];
    if (name) this.showOnly(name);
  }

  hideAll() {
    for (const s of SCREENS) $('screen-' + s).classList.add('hidden');
    $('menu-bg').classList.add('hidden');
    this.current = null;
    this.stack = [];
  }

  // ------------------------------------------------------------ maps
  drawPreview(canvas, map) {
    const nav = new NavGrid(map);
    map.layout(nav.builder(), mulberry32(map.id.length * 977 + map.halfX * 13));
    const W = canvas.width, H = canvas.height;
    const g = canvas.getContext('2d');
    const t = map.theme;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, t.night.top);
    grad.addColorStop(1, t.night.horizon);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const scale = Math.min((W - 20) / (map.halfX * 2), (H - 20) / (map.halfZ * 2));
    const ox = W / 2 - map.halfX * scale;
    const oz = H / 2 - map.halfZ * scale;
    g.fillStyle = t.ground[1];
    g.globalAlpha = 0.85;
    g.fillRect(ox, oz, map.halfX * 2 * scale, map.halfZ * 2 * scale);
    g.globalAlpha = 1;
    const cs = 2 * scale;
    if (map.elevation) {
      // high ground drawn lighter, cliff edges dark
      const el = new Elevation(map);
      for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
        const x = nav.cx(i), z = nav.cz(j);
        const h = el.at(x, z);
        if (el.span(x, z, 0.9) > 1.25) g.fillStyle = 'rgba(0,0,0,0.45)';
        else if (h > 0.3) g.fillStyle = `rgba(255,240,215,${Math.min(0.4, h * 0.045)})`;
        else continue;
        g.fillRect(ox + i * cs, oz + j * cs, cs + 0.5, cs + 0.5);
      }
    }
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      const k = nav.idx(i, j);
      if (nav.blocked[k]) { g.fillStyle = t.rock; g.fillRect(ox + i * cs, oz + j * cs, cs + 0.5, cs + 0.5); }
      else if (nav.pool[k]) { g.fillStyle = '#8aff3d'; g.fillRect(ox + i * cs, oz + j * cs, cs + 0.5, cs + 0.5); }
    }
    const P = (x, z) => [ox + (x + map.halfX) * scale, oz + (z + map.halfZ) * scale];
    for (const [x, z] of map.hives) {
      const [px, pz] = P(x, z);
      g.fillStyle = '#c46bff';
      g.shadowColor = '#c46bff';
      g.shadowBlur = 12;
      g.beginPath(); g.arc(px, pz, 6, 0, Math.PI * 2); g.fill();
    }
    const [cx, cz] = P(...map.core);
    g.fillStyle = '#3de0ff';
    g.shadowColor = '#3de0ff';
    g.save(); g.translate(cx, cz); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.restore();
    g.shadowBlur = 0;
  }

  buildMapCards() {
    const wrap = $('map-cards');
    wrap.innerHTML = '';
    for (const m of MAPS) {
      const card = document.createElement('div');
      card.className = 'map-card';
      card.dataset.id = m.id;
      const c = document.createElement('canvas');
      c.width = 360; c.height = 240;
      card.appendChild(c);
      const body = document.createElement('div');
      body.className = 'mc-body';
      body.innerHTML = `<div class="mc-name">${m.name}</div><div class="mc-sub">${m.subtitle}</div><div class="mc-desc">${m.description}</div>
        <div class="mc-meta"><span class="mc-stars">${'★'.repeat(m.difficulty)}${'☆'.repeat(3 - m.difficulty)}</span><span class="mc-best"></span></div>`;
      card.appendChild(body);
      this.drawPreview(c, m);
      card.addEventListener('click', () => {
        this.selectedMap = m.id;
        this.refreshMapCards();
        this.game.net.setLobbyMission(this.selectedMap, this.difficulty);
        this.game.audio.uiSelect();
        this.game.previewMap(m.id);
      });
      card.addEventListener('dblclick', () => this.game.startGame(m.id, this.difficulty));
      wrap.appendChild(card);
    }
  }

  refreshMapCards() {
    for (const card of $('map-cards').children) {
      card.classList.toggle('sel', card.dataset.id === this.selectedMap);
      const b = bestWave(card.dataset.id);
      card.querySelector('.mc-best').textContent = b ? `Best: wave ${b}` : 'Not played yet';
    }
  }

  buildDifficulty() {
    const wrap = $('diff-buttons');
    wrap.innerHTML = '';
    for (const [id, d] of Object.entries(DIFFICULTIES)) {
      const b = document.createElement('button');
      b.className = 'diff-btn';
      b.textContent = d.name.toUpperCase();
      b.dataset.id = id;
      b.addEventListener('click', () => { this.difficulty = id; this.refreshDifficulty(); this.game.net.setLobbyMission(this.selectedMap, this.difficulty); });
      wrap.appendChild(b);
    }
    this.refreshDifficulty();
  }

  refreshDifficulty() {
    for (const b of $('diff-buttons').children) b.classList.toggle('sel', b.dataset.id === this.difficulty);
    $('diff-desc').textContent = DIFFICULTIES[this.difficulty].desc;
  }

  // ------------------------------------------------------------ settings
  buildSettings() {
    const s = this.game.settings;
    const list = $('settings-list');
    const rows = [
      { key: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
      { key: 'fov', label: 'Field of view', type: 'range', min: 65, max: 105, step: 1, fmt: (v) => Math.round(v) },
      { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'musicVolume', label: 'Music volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'quality', label: 'Graphics quality', type: 'seg', options: [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']] },
      { key: 'damageNumbers', label: 'Damage numbers', type: 'seg', options: [[true, 'ON'], [false, 'OFF']] },
      { key: 'screenShake', label: 'Screen shake', type: 'seg', options: [[true, 'ON'], [false, 'OFF']] },
      { key: 'invertY', label: 'Invert mouse Y', type: 'seg', options: [[false, 'OFF'], [true, 'ON']] },
    ];
    list.innerHTML = '';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<label>${r.label}</label><div class="ctl"></div>`;
      const ctl = row.querySelector('.ctl');
      if (r.type === 'range') {
        const inp = document.createElement('input');
        inp.type = 'range';
        Object.assign(inp, { min: r.min, max: r.max, step: r.step, value: s[r.key] });
        const out = document.createElement('output');
        out.textContent = r.fmt(s[r.key]);
        inp.addEventListener('input', () => {
          s[r.key] = parseFloat(inp.value);
          out.textContent = r.fmt(s[r.key]);
          this.applySettings(r.key);
        });
        ctl.append(inp, out);
      } else {
        const seg = document.createElement('div');
        seg.className = 'seg';
        for (const [val, lab] of r.options) {
          const b = document.createElement('button');
          b.textContent = lab;
          b.classList.toggle('sel', s[r.key] === val);
          b.addEventListener('click', () => {
            s[r.key] = val;
            for (const x of seg.children) x.classList.toggle('sel', x === b);
            this.applySettings(r.key);
          });
          seg.appendChild(b);
        }
        ctl.appendChild(seg);
      }
      list.appendChild(row);
    }
  }

  applySettings(key) {
    const g = this.game;
    saveSettings(g.settings);
    if (key === 'quality') g.r.setQuality(g.settings.quality);
    if (key === 'masterVolume' || key === 'musicVolume') g.audio.applyVolume();
  }

  // ------------------------------------------------------------ how to play
  buildHowto() {
    const tabs = $('howto-tabs');
    const T = [['controls', 'CONTROLS'], ['enemies', 'ALIENS'], ['defenses', 'DEFENSES']];
    tabs.innerHTML = '';
    for (const [id, name] of T) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = name;
      b.dataset.id = id;
      b.addEventListener('click', () => { this.howtoTab = id; this.renderHowto(); });
      tabs.appendChild(b);
    }
    this.renderHowto();
  }

  renderHowto() {
    for (const b of $('howto-tabs').children) b.classList.toggle('sel', b.dataset.id === this.howtoTab);
    const body = $('howto-body');
    if (this.howtoTab === 'controls') {
      const K = (...k) => k.map((x) => `<kbd>${x}</kbd>`).join('');
      body.innerHTML = `<div class="keys">
        <div><span class="k">${K('W', 'A', 'S', 'D')}</span>Move</div>
        <div><span class="k">${K('Shift')}</span>Sprint</div>
        <div><span class="k">${K('Space')}</span>Jump</div>
        <div><span class="k">${K('LMB')}</span>Shoot / place building</div>
        <div><span class="k">${K('RMB')}</span>Aim down sights / cancel build</div>
        <div><span class="k">${K('R')}</span>Reload / rotate building</div>
        <div><span class="k">${K('1')}</span>Rifle</div>
        <div><span class="k">${K('2')}–${K('9')}</span>Choose a building</div>
        <div><span class="k">${K('Wheel')}</span>Cycle buildings</div>
        <div><span class="k">${K('E')}</span>Upgrade aimed building</div>
        <div><span class="k">${K('F')}</span>Repair aimed building</div>
        <div><span class="k">${K('T')}</span>Rotate aimed building</div>
        <div><span class="k">${K('X')}</span>Sell aimed building</div>
        <div><span class="k">${K('B')}</span>Armory (between waves)</div>
        <div><span class="k">${K('G')}</span>Start the next wave now</div>
        <div><span class="k">${K('Esc')}</span>Pause</div>
      </div>
      <div class="tips">
        <b>Goal:</b> keep the core in the middle of your base alive. Aliens crawl out of the hives when night falls.<br>
        <b>Endless:</b> the waves never stop, they just get harder. A new kind of alien shows up every wave until you have met them all, in a different order every game. Every 5th wave brings a boss. How far can you get?<br>
        <b>Crystals</b> come from kills and from clearing waves. Spend them on buildings, building upgrades and the armory.<br>
        <b>Red arrows</b> on the ground show where the next wave will walk. Build your traps on that path.<br>
        <b>Traps:</b> <b>Spikes</b> stab everything standing on them. <b>Goo</b> slows aliens and covers them in fuel. A <b>Flame Vent</b> sets goo-covered aliens on fire for a big <b>IGNITE</b> combo. A <b>Launch Pad</b> throws aliens in the arrow's direction, straight into a chasm if you aim it right (they die instantly). A <b>Laser Fence</b> mounts on a wall and shoots across the corridor.<br>
        <b>Power:</b> some traps and turrets need ⚡ power. The core gives 15; build <b>Generators</b> (key 0) for more, and protect them.<br>
        <b>Barricades</b> are cheap and need no power. They block your bullets and must be repaired with crystals. Your suit has an energy shield (blue bar) that recharges when you avoid hits for a few seconds.<br>
        <b>Rotate</b> buildings in 45° steps: <kbd>R</kbd> while placing, <kbd>T</kbd> on a placed one. Launch Pads throw aliens in the direction their arrow points.<br>
        <b>Walls change the path</b> the swarm takes: aliens walk around walls when they can, so you can build mazes and choke points. If there is no way around, they chew through.<br>
        <b>High ground:</b> on hilly maps the swarm can only climb up ramps, so ramps are natural choke points. Turrets on a cliff edge see far, and most aliens can't reach you up there (Leapers can jump up, Spitters shoot up).<br>
        <b>Upgrade in the field:</b> aim at a building and press <kbd>E</kbd>. Each building has three levels with new abilities.<br>
        <b>Headshots</b> deal double damage. Shoot Bloaters before they reach your walls!
      </div>`;
    } else if (this.howtoTab === 'enemies') {
      body.innerHTML = '<div class="cards">' + ENEMY_ORDER.map((id) => {
        const e = ENEMIES[id];
        return `<div class="info-card"><div class="swatch" style="background:${e.colors.shell};color:${e.colors.eye}">${icon('bug')}</div>
          <div><div class="t">${e.name}${e.boss ? '<em>BOSS</em>' : ''}</div><div class="d">${e.desc}</div>
          <div class="s">HP ${e.hp} · Speed ${e.speed}${e.flying ? ' · Flying' : ''}</div></div></div>`;
      }).join('') + '</div>';
    } else {
      body.innerHTML = '<div class="cards">' + BUILD_ORDER.map((id, i) => {
        const b = BUILDINGS[id];
        return `<div class="info-card"><div class="swatch" style="background:rgba(61,224,255,.12);color:var(--accent)">${icon(B_ICONS[id])}</div>
          <div><div class="t">${b.name} <kbd>${i + 2}</kbd></div><div class="d">${b.desc}</div>
          <div class="s">Cost ${b.cost} ⬢${b.levels[0].power ? ' · ⚡' + b.levels[0].power : ''}${b.levels[0].supply ? ' · +⚡' + b.levels[0].supply : ''}${b.range ? ' · Range ' + b.range + 'm' : ''}${b.rotatable ? ' · Rotatable' : ''}</div></div></div>`;
      }).join('') + '</div>';
    }
  }

  // ------------------------------------------------------------ armory
  renderArmory() {
    const g = this.game;
    const tabs = $('armory-tabs');
    tabs.innerHTML = '';
    for (const t of UPGRADE_TABS) {
      const b = document.createElement('button');
      b.className = 'tab' + (t.id === this.armoryTab ? ' sel' : '');
      b.textContent = t.name.toUpperCase();
      b.addEventListener('click', () => { this.armoryTab = t.id; this.renderArmory(); });
      tabs.appendChild(b);
    }
    $('armory-credit-num').textContent = g.credits;
    const grid = $('armory-grid');
    grid.innerHTML = '';
    for (const u of UPGRADES.filter((x) => x.tab === this.armoryTab)) {
      const lvl = g.upgrades.level(u.id);
      const maxed = !u.repeat && lvl >= u.max;
      const cost = g.upgrades.cost(u.id);
      const can = g.upgrades.canBuy(u.id);
      const b = document.createElement('button');
      b.className = 'upg' + (maxed ? ' maxed' : '') + (!maxed && g.credits < cost ? ' poor' : '');
      b.disabled = !can;
      const pips = u.repeat ? '<span style="color:var(--muted);font-size:13px">REPEATABLE</span>' : `<div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>`;
      b.innerHTML = `<div class="top">${icon(u.icon)}<div class="n">${u.name}</div></div><div class="d">${u.desc}</div>
        <div class="row">${pips}<span class="c">${maxed ? 'MAX' : cost + ' ⬢'}</span></div>`;
      b.addEventListener('click', () => { if (g.upgrades.buy(u.id)) this.renderArmory(); });
      grid.appendChild(b);
    }
  }

  // ------------------------------------------------------------ game over
  // ------------------------------------------------------------ co-op
  setupCoop() {
    const game = this.game;
    const net = game.net;
    net.onLobby = () => {
      if (this.current === 'lobby') this.renderLobby();
      if (this.current === 'maps') this.refreshCoopBanner();
    };
    const busy = (on) => { $('host-btn').disabled = on; $('join-btn').disabled = on; };
    $('host-btn').addEventListener('click', async () => {
      busy(true);
      this.coopStatus('Creating room…');
      try {
        await net.host($('coop-name').value);
        net.setLobbyMission(this.selectedMap, this.difficulty);
        this.coopStatus('');
        this.go('lobby');
      } catch (e) { this.coopStatus(e.message || String(e), true); }
      busy(false);
    });
    const join = async () => {
      const code = $('join-code').value.trim().toUpperCase();
      if (code.length < 5) { this.coopStatus('Type the 5-letter room code', true); return; }
      busy(true);
      this.coopStatus('Connecting…');
      try {
        await net.join(code, $('coop-name').value);
        this.coopStatus('');
        this.go('lobby');
      } catch (e) { this.coopStatus(e.message || String(e), true); net.leave(true); }
      busy(false);
    };
    $('join-btn').addEventListener('click', join);
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('coop-name').addEventListener('change', (e) => net.setName(e.target.value));
    $('lobby-leave').addEventListener('click', () => { net.leave(); this.reset('main'); });
    $('copy-code').addEventListener('click', () => {
      try { navigator.clipboard.writeText(net.code); this.game.hud.toast('Room code copied', 'good'); } catch { /* ignore */ }
      $('copy-code').textContent = 'COPIED!';
      setTimeout(() => ($('copy-code').textContent = 'COPY CODE'), 1500);
    });
    $('lobby-start').addEventListener('click', () => this.go('maps'));
  }

  coopStatus(msg, bad = false) {
    const el = $('coop-status');
    el.textContent = msg;
    el.classList.toggle('bad', bad);
  }

  renderLobby() {
    const net = this.game.net;
    $('lobby-code').textContent = net.code || '-----';
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const p = net.players[i];
      if (p) rows.push(`<div class="lp" style="--c:${p.color}"><i></i>${escapeHtml(p.name)}${p.id === net.myId ? ' (you)' : ''}<em>${p.id === 0 ? 'HOST' : 'READY'}</em></div>`);
      else rows.push('<div class="lp empty">waiting for player…</div>');
    }
    $('lobby-players').innerHTML = rows.join('');
    const map = MAPS.find((m) => m.id === net.lobbyMap);
    const diff = DIFFICULTIES[net.lobbyDiff];
    if (net.isHost) {
      $('lobby-info').innerHTML = `Share the room code with your friends. They choose <b>CO-OP → JOIN</b> and type it in.<br>When everybody is here, pick a mission and press <b>DEPLOY</b>.`;
      $('lobby-start').classList.remove('hidden');
    } else {
      $('lobby-info').innerHTML = `Waiting for <b>${escapeHtml(net.nameOf(0))}</b> to start the mission…` + (map ? `<br>Mission: <b>${map.name}</b>${diff ? ' · ' + diff.name : ''}` : '');
      $('lobby-start').classList.add('hidden');
    }
  }

  refreshCoopBanner() {
    const net = this.game.net;
    const el = $('coop-banner');
    el.classList.toggle('hidden', !net.isHost);
    if (net.isHost) el.textContent = `CO-OP · ${net.players.length} PLAYER${net.players.length === 1 ? '' : 'S'} · ROOM ${net.code}`;
  }

  refreshCoopButtons() {
    const client = this.game.net.isClient;
    $('restart-btn').classList.toggle('hidden', client);
    $('retry-btn').classList.toggle('hidden', client);
    $('change-map-btn').classList.toggle('hidden', client);
    $('over-wait').classList.toggle('hidden', !client);
    $('quit-btn').lastChild.textContent = this.game.net.active ? 'LEAVE GAME' : 'QUIT TO MENU';
  }

  showNotice(msg) {
    const el = $('notice');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => el.classList.add('hidden'), 5000);
  }

  showGameOver(stats, newRecord) {
    $('record-badge').classList.toggle('hidden', !newRecord);
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60);
    const items = [
      ['Waves survived', stats.waves],
      ['Aliens killed', stats.kills],
      ['Damage dealt', Math.round(stats.damage).toLocaleString('en-US')],
      ['Buildings built', stats.built],
      ['Times downed', stats.deaths],
      ['Time', `${mins}:${String(secs).padStart(2, '0')}`],
    ];
    $('over-stats').innerHTML = items.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l.toUpperCase()}</div></div>`).join('');
    this.reset('over');
  }
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
