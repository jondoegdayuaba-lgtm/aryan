// Menus: lobby, locker, settings, how-to-play, pause, death and victory screens.
import { OUTFITS, SKIN_TONES } from './character.js';
import { GAME } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.dancing = false;
    $('title-a').textContent = GAME.title;
    $('title-b').textContent = GAME.subtitle;
    const click = (id, fn) => $(id).addEventListener('click', () => { game.audio.init(); game.audio.ui(); fn(); });
    click('btn-play', () => this.play());
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
      if (e.code === 'Enter' && game.state === 'lobby' && !this.openPanel) this.play();
    });
  }

  play() {
    const g = this.game;
    if (g.state !== 'lobby') return;
    $('menu').hidden = true;
    $('matchmaking').hidden = false;
    $('mm-text').textContent = 'Finding a match…';
    setTimeout(() => { $('mm-text').textContent = `${g.settings.bots + 1} players found — boarding the airship`; }, 700);
    setTimeout(() => {
      $('matchmaking').hidden = true;
      g.startMatch();
    }, 1500);
  }

  toLobby() {
    const g = this.game;
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
  }

  showLobby() {
    $('menu').hidden = false;
    $('death').hidden = true;
    $('victory').hidden = true;
    $('pause').hidden = true;
    this.refreshStats();
    this.refreshOutfit();
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
