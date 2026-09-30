// Menus: lobby, locker, settings, how-to-play, pause, death and victory screens.
import { OUTFITS, SKIN_TONES } from './character.js';
import { GAME, MAPS } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.dancing = false;
    $('title-a').textContent = GAME.title;
    $('title-b').textContent = GAME.subtitle;
    const click = (id, fn) => $(id).addEventListener('click', () => { game.audio.init(); game.audio.ui(); fn(); });
    click('btn-play', () => this.play());
    click('btn-online', () => this.panel('online'));
    for (const el of document.querySelectorAll('.map-card')) el.addEventListener('click', () => { game.audio.init(); game.audio.ui(); this.pickMap(el.dataset.map); });
    this.bindOnline();
    click('btn-settings', () => this.panel('settings'));
    click('btn-howto', () => this.panel('howto'));
    click('btn-dance', () => { this.dancing = !this.dancing; $('btn-dance').classList.toggle('on', this.dancing); });
    click('outfit-prev', () => this.outfit(-1));
    click('outfit-next', () => this.outfit(1));
    click('skin-btn', () => this.skin());
    for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', () => { game.audio.ui(); this.panel(null); });
    click('btn-resume', () => game.setPaused(false));
    click('btn-pause-settings', () => this.panel('settings'));
    click('btn-quit', () => this.toLobby());
    click('btn-death-lobby', () => this.toLobby());
    click('btn-spectate', () => { $('death').hidden = true; });
    click('btn-win-lobby', () => this.toLobby());
    document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => game.audio.ui('hover')));
    this.bindSettings();
    this.refreshOutfit();
    this.refreshStats();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.openPanel) { this.panel(null); e.preventDefault(); }
      if (e.code === 'Enter' && game.state === 'lobby' && !this.openPanel && !/INPUT|SELECT/.test(e.target.tagName)) this.play();
    });
  }

  play() {
    const g = this.game;
    if (g.state !== 'lobby' || this.starting) return;
    // in a friend's room only the host can start
    if (g.net.isClient) { this.panel('online'); return; }
    this.starting = true;
    const friends = g.net.isHost ? g.net.conns.size : 0;
    $('menu').hidden = true;
    this.panel(null);
    $('matchmaking').hidden = false;
    const duel = (MAPS[g.settings.map] || MAPS.island).mode === 'duel';
    $('mm-text').textContent = friends ? `Starting a match with ${friends} friend${friends > 1 ? 's' : ''}…` : duel ? 'Finding an opponent…' : 'Finding a match…';
    setTimeout(() => {
      $('mm-text').textContent = duel ? (friends ? `${friends + 1} players — heading to the Duel Grounds` : 'Opponent found — heading to the Duel Grounds')
        : `${Math.max(g.settings.bots + 1, friends + 1)} players found — boarding the airship`;
    }, 700);
    setTimeout(() => {
      $('matchmaking').hidden = true;
      this.starting = false;
      if (g.state === 'lobby') g.startMatch();
    }, 1500);
  }

  // Choose the map. The lobby backdrop moves to it right away (the island is rebuilt in a moment).
  pickMap(key) {
    const g = this.game;
    if (!MAPS[key] || g.state !== 'lobby' || g.net.isClient) return;
    g.settings.map = key;
    g.saveSettings();
    this.refreshMap();
    if (g.mapKey !== key) {
      $('matchmaking').hidden = false;
      $('mm-text').textContent = `Loading ${MAPS[key].name}…`;
      setTimeout(() => {
        g.switchMap(key);
        g.enterLobby();
        $('matchmaking').hidden = true;
      }, 60);
    }
    if (g.net.isHost) g.net.syncRoster();
  }

  refreshMap() {
    const g = this.game;
    const key = g.net.isClient ? (g.net.hostMap || 'island') : (MAPS[g.settings.map] ? g.settings.map : 'island');
    for (const el of document.querySelectorAll('.map-card')) {
      el.classList.toggle('on', el.dataset.map === key);
      el.setAttribute('aria-checked', el.dataset.map === key ? 'true' : 'false');
      el.disabled = g.net.isClient;
    }
    return key;
  }

  // ------------------------------------------------------------------ play with friends
  bindOnline() {
    const g = this.game;
    const net = g.net;
    const name = $('net-name');
    name.value = g.settings.name || '';
    name.addEventListener('input', () => {
      g.settings.name = name.value.replace(/[<>&"]/g, '').slice(0, 16);
      g.saveSettings();
    });
    const code = $('net-code');
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    code.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); $('net-join').click(); } });
    const busy = (on) => { $('net-host').disabled = on; $('net-join').disabled = on; };
    const click = (id, fn) => $(id).addEventListener('click', () => { g.audio.init(); g.audio.ui(); fn(); });
    click('net-host', async () => {
      busy(true);
      this.netStatus('Creating a room…');
      try {
        await net.host();
        this.netStatus('Room ready. Send the code to your friends.');
      } catch (e) {
        this.netStatus(netError(e), true);
      }
      busy(false);
    });
    click('net-join', async () => {
      const c = code.value.trim();
      if (c.length < 5) { this.netStatus('Type the 5-letter room code your friend gave you', true); return; }
      busy(true);
      this.netStatus('Joining…');
      try {
        await net.join(c);
        this.netStatus('Joined! Waiting for the host to start the match.');
      } catch (e) {
        net.leave();
        this.netStatus(netError(e), true);
      }
      busy(false);
    });
    click('net-leave', () => { net.leave(); this.netStatus(''); });
    click('net-go', () => this.play());
    click('net-copy', async () => {
      try { await navigator.clipboard.writeText(net.code); this.netStatus('Code copied'); } catch { this.netStatus('Select the code and copy it'); }
    });
    net.onChange = () => this.refreshOnline();
    net.onStatus = (t, err) => this.netStatus(t, err);
    this.refreshOnline();
  }

  netStatus(text, err = false) {
    const el = $('net-status');
    el.textContent = text;
    el.classList.toggle('err', !!err);
  }

  refreshOnline() {
    const g = this.game;
    const net = g.net;
    const inRoom = net.active && !!net.code;
    $('net-choose').hidden = inRoom;
    $('net-room').hidden = !inRoom;
    $('net-name').disabled = inRoom;
    $('net-code-show').textContent = net.code;
    $('net-go').hidden = !net.isHost;
    $('net-wait').hidden = !net.isClient;
    const ul = $('net-roster');
    ul.innerHTML = '';
    for (const r of net.roster) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = SKIN_TONES[r.skin ?? 1] || SKIN_TONES[1];
      li.appendChild(dot);
      li.appendChild(document.createTextNode(r.name));
      if (r.host) { const t = document.createElement('small'); t.textContent = 'host'; li.appendChild(t); }
      ul.appendChild(li);
    }
    const n = net.roster.length;
    if (net.isHost) $('net-go').textContent = n > 1 ? `Start match (${n} players)` : 'Start match (waiting for friends)';
    // the big buttons show the room too
    $('btn-online').classList.toggle('room', inRoom);
    $('online-sub').textContent = inRoom ? `Room ${net.code} · ${n} player${n === 1 ? '' : 's'}` : 'Online · share a room code';
    const mapName = MAPS[this.refreshMap()].name;
    $('play-sub').textContent = net.isHost ? (n > 1 ? `${mapName} · with ${n - 1} friend${n > 2 ? 's' : ''}` : `Solo · ${mapName}`)
      : net.isClient ? `Waiting for the host · ${mapName}` : `Solo · ${mapName}`;
  }

  toLobby(silent = false) {
    const g = this.game;
    g.leaveMatch(silent);
    $('death').hidden = true;
    $('victory').hidden = true;
    $('pause').hidden = true;
    g.paused = false;
    g.toggleMap(false);
    g.enterLobby();
  }

  panel(name) {
    this.openPanel = name;
    $('settings').hidden = name !== 'settings';
    $('howto').hidden = name !== 'howto';
    $('online').hidden = name !== 'online';
    if (name === 'online') this.refreshOnline();
  }

  showLobby() {
    $('menu').hidden = false;
    $('death').hidden = true;
    $('victory').hidden = true;
    $('pause').hidden = true;
    this.refreshStats();
    this.refreshOutfit();
    this.refreshOnline();
  }

  showMatch() {
    $('menu').hidden = true;
    this.panel(null);
  }

  showPause(on) {
    $('pause').hidden = !on;
    if (!on) this.panel(null);
  }

  outfit(d) {
    const g = this.game;
    g.settings.outfit = (g.settings.outfit + d + OUTFITS.length) % OUTFITS.length;
    g.saveSettings();
    this.refreshOutfit();
    if (g.lobbyChar) g.lobbyChar.setOutfit(g.settings.outfit, SKIN_TONES[g.settings.skin ?? 1]);
  }

  skin() {
    const g = this.game;
    g.settings.skin = ((g.settings.skin ?? 1) + 1) % SKIN_TONES.length;
    g.saveSettings();
    if (g.lobbyChar) g.lobbyChar.setOutfit(g.settings.outfit, SKIN_TONES[g.settings.skin]);
    this.refreshOutfit();
  }

  refreshOutfit() {
    const g = this.game;
    const o = OUTFITS[g.settings.outfit % OUTFITS.length];
    $('outfit-name').textContent = o.name;
    $('outfit-num').textContent = `${(g.settings.outfit % OUTFITS.length) + 1} / ${OUTFITS.length}`;
    $('skin-btn').style.background = SKIN_TONES[g.settings.skin ?? 1];
  }

  refreshStats() {
    const s = this.game.stats;
    $('stat-matches').textContent = s.matches;
    $('stat-wins').textContent = s.wins;
    $('stat-kills').textContent = s.kills;
  }

  bindSettings() {
    const g = this.game;
    const s = g.settings;
    const bind = (id, key, parse = (v) => v, fmt = null) => {
      const el = $(id);
      const out = $(id + '-v');
      el.value = s[key];
      if (el.type === 'checkbox') el.checked = !!s[key];
      const show = () => { if (out) out.textContent = fmt ? fmt(s[key]) : s[key]; };
      show();
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
        s[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
        show();
        if (g.renderer && g.props) g.applySettings();
        else g.saveSettings();
      });
    };
    bind('set-quality', 'quality');
    bind('set-sens', 'sensitivity', parseFloat, (v) => v.toFixed(2));
    bind('set-fov', 'fov', parseFloat, (v) => `${v}°`);
    bind('set-volume', 'volume', parseFloat, (v) => `${Math.round(v * 100)}%`);
    bind('set-music', 'music', parseFloat, (v) => `${Math.round(v * 100)}%`);
    bind('set-bots', 'bots', (v) => parseInt(v, 10), (v) => `${v + 1} players`);
    bind('set-difficulty', 'difficulty');
    bind('set-time', 'timeOfDay');
    bind('set-invert', 'invertY');
    bind('set-fps', 'showFps');
  }

  // ------------------------------------------------------------------ end screens
  stats(a) {
    const t = this.game.time;
    return `
      <div><dt>Eliminations</dt><dd>${a.kills}</dd></div>
      <div><dt>Damage dealt</dt><dd>${Math.round(a.damageDealt)}</dd></div>
      <div><dt>Materials gathered</dt><dd>${a.matsGathered}</dd></div>
      <div><dt>Structures built</dt><dd>${a.built}</dd></div>
      <div><dt>Time survived</dt><dd>${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</dd></div>`;
  }

  showDeath(killer) {
    const g = this.game;
    g.input.unlock();
    $('death').hidden = false;
    $('death-place').textContent = `#${g.placement}`;
    $('death-by').innerHTML = killer && killer !== g.player
      ? `Eliminated by <b>${killer.name}</b> <span class="hpleft">(${Math.ceil(killer.health)} health · ${Math.ceil(killer.shield)} shield left)</span>`
      : 'You were eliminated';
    $('death-stats').innerHTML = this.stats(g.player);
    $('death-winner').hidden = true;
    $('btn-spectate').hidden = !g.spectating;
    if (g.winner) this.updateDeathWinner(g.winner);
  }

  updateDeathWinner(w) {
    if (!w) return;
    const el = $('death-winner');
    el.hidden = false;
    el.textContent = `${w.name} won the match`;
  }

  showVictory() {
    const g = this.game;
    g.input.unlock();
    $('victory').hidden = false;
    $('win-stats').innerHTML = this.stats(g.player);
    this.confetti();
  }

  confetti() {
    const host = $('confetti');
    host.innerHTML = '';
    const colors = ['#ffcf56', '#3d9bff', '#ff5d8f', '#58c44a', '#b35cff', '#ffffff'];
    for (let i = 0; i < 120; i++) {
      const p = document.createElement('i');
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 2}s`;
      p.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      host.appendChild(p);
    }
  }
}

function netError(e) {
  const t = (e && e.type) || '';
  if (t === 'peer-unavailable') return 'No room with that code. Check the code, and that your friend is still in the room.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the matchmaking server. Check your internet connection and try again.';
  if (t === 'browser-incompatible') return 'This browser does not support online play (WebRTC).';
  return (e && e.message) || 'Something went wrong. Try again.';
}
