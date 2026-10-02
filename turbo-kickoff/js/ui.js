// Menus, HUD and the end-of-match screen.

const $ = (id) => document.getElementById(id);
const ARC = 235.6;

export function createUI({ onStart, onResume, onRestart, onMenu }) {
  let difficulty = 'medium';
  let countdownTimer = 0;
  let bannerTimer = 0;
  let last = {};

  document.querySelectorAll('#difficulty button').forEach((b) => {
    b.addEventListener('click', () => {
      difficulty = b.dataset.diff;
      document.querySelectorAll('#difficulty button').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => onStart(b.dataset.mode, difficulty)));
  $('btn-resume').addEventListener('click', onResume);
  $('btn-restart').addEventListener('click', onRestart);
  $('btn-menu').addEventListener('click', onMenu);
  $('btn-rematch').addEventListener('click', onRestart);
  $('btn-end-menu').addEventListener('click', onMenu);

  const fmt = (s, ot) => {
    const t = Math.ceil(ot ? Math.floor(s) : s);
    return `${ot ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  return {
    loading(p, text) {
      $('load-fill').style.width = `${Math.round(p * 100)}%`;
      if (text) $('load-text').textContent = text;
    },
    loaded() { $('loading').hidden = true; },
    showMenu() {
      $('menu').hidden = false; $('hud').hidden = true; $('pause').hidden = true; $('end').hidden = true;
    },
    startMatch(mode) {
      $('menu').hidden = true; $('hud').hidden = false; $('pause').hidden = true; $('end').hidden = true;
      $('freeplay-help').hidden = mode !== 'freeplay';
      $('banner').hidden = true;
      $('popups').textContent = '';
      last = {};
    },
    pause(on) { $('pause').hidden = !on; },
    setBallCam(on) { $('ballcam').classList.toggle('off', !on); },

    countdown(text, go = false) {
      const el = $('countdown');
      el.textContent = text;
      el.classList.remove('go');
      if (go) { void el.offsetWidth; el.classList.add('go'); }
      clearTimeout(countdownTimer);
      if (go) countdownTimer = setTimeout(() => { el.textContent = ''; }, 900);
    },
    banner(title, color, sub = '') {
      $('banner-title').textContent = title;
      $('banner-title').style.color = color;
      $('banner-title').style.textShadow = `0 0 40px ${color}`;
      $('banner-sub').textContent = sub;
      $('banner').hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { $('banner').hidden = true; }, 2600);
    },
    popup(text) {
      const p = document.createElement('div');
      p.className = 'popup';
      p.textContent = text;
      $('popups').appendChild(p);
      setTimeout(() => p.remove(), 2300);
    },
    hud(s) {
      if (s.blue !== last.blue) $('score-blue').textContent = s.blue;
      if (s.orange !== last.orange) $('score-orange').textContent = s.orange;
      const clock = s.clock === null ? 'FREE' : fmt(s.clock, s.overtime);
      if (clock !== last.clock) { $('clock').textContent = clock; $('clock').classList.toggle('ot', s.overtime); }
      const boost = Math.floor(s.boost);
      if (boost !== last.boost) {
        $('boost-num').textContent = s.unlimited ? '∞' : boost;
        $('boost-ring').style.strokeDashoffset = ARC * (1 - s.boost / 100);
        $('boost-ring').classList.toggle('full', boost >= 100);
      }
      const kmh = Math.round(s.speed * 3.6);
      if (kmh !== last.kmh) $('speed').textContent = `${kmh} km/h`;
      if (s.supersonic !== last.supersonic) $('speed').classList.toggle('supersonic', s.supersonic);
      last = { blue: s.blue, orange: s.orange, clock, boost, kmh, supersonic: s.supersonic };
    },
    endScreen({ winner, score, players, mvp, playerWon }) {
      $('hud').hidden = true;
      $('end').hidden = false;
      $('end-title').textContent = playerWon ? 'Victory!' : 'Defeat';
      $('end-title').style.color = winner === 'blue' ? 'var(--blue)' : 'var(--orange)';
      $('end-score').innerHTML = `<span class="b">${score.blue}</span><span>–</span><span class="o">${score.orange}</span>`;
      const sorted = players.slice().sort((a, b) => (a.team === b.team ? b.score - a.score : a.team === 'blue' ? -1 : 1));
      const rows = sorted.map((p) => `<tr class="${p.team}${p.isPlayer ? ' you' : ''}">
        <td>${p.name}${p.name === mvp ? '<span class="badge">MVP</span>' : ''}</td>
        <td>${p.score}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.saves}</td><td>${p.shots}</td></tr>`).join('');
      $('end-table').innerHTML = `<tr><th>Player</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th></tr>${rows}`;
      $('end-mvp').innerHTML = mvp ? `MVP: <b>${mvp}</b>` : '';
    },
  };
}
