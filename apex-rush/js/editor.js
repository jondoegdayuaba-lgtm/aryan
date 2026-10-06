// The track editor: lay road pieces on a grid, test-drive, save and share.
// Following the road from the Start piece gives a normal track definition,
// so a custom track races exactly like the built-in ones.
import * as THREE from 'three';
import { TrackPath } from './path.js';
import { buildTrack } from './trackmesh.js';
import { RobotRun } from './autopilot.js';
import { formatTime } from './race.js';
import {
  CELL, LEVEL, MAX_LEVEL, DIRS, PIECES, footprint, exitOf, centreLine, clash,
  traceTrack, encodeTrack, decodeTrack, exampleTrack, robotMedals,
} from './pieces.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const PALETTE = ['start', 'road', 'turnL', 'turnR', 'wideL', 'wideR', 'up', 'down', 'jump', 'cp', 'finish',
  'boost', 'hammer', 'sweeper', 'pistons', 'bollards'];
const DIGITS = ['road', 'turnL', 'turnR', 'wideL', 'wideR', 'up', 'down', 'jump', 'cp', 'finish'];   // keys 1..9, 0
const C = {
  route: new THREE.Color('#e8f4ff'), loose: new THREE.Color('#ff5a4f'), start: new THREE.Color('#3ddc84'),
  cp: new THREE.Color('#ffd21f'), finish: new THREE.Color('#f3f5fa'), ghost: new THREE.Color('#ffd21f'),
  erase: new THREE.Color('#ff5a4f'), open: new THREE.Color('#ff9a3d'),
};

// ---------- Saved tracks (shared with the menu) ----------
export function savedTracks(store) {
  const list = store.get('tracks', []);
  return Array.isArray(list) ? list.filter((t) => t && typeof t.code === 'string' && t.id) : [];
}

const defCache = new Map();
// A raceable track definition for a saved entry, or null if it isn't finished.
export function savedDef(entry) {
  const key = entry.code + '|' + entry.robot;
  if (!defCache.has(key)) {
    let def = null;
    try {
      const data = decodeTrack(entry.code);
      const res = traceTrack(data.pieces, { name: entry.name, laps: data.laps });
      if (res.ok) def = { ...res.def, name: entry.name, medals: robotMedals(entry.robot) };
    } catch { /* a damaged entry just isn't listed */ }
    defCache.set(key, def);
  }
  return defCache.get(key);
}

// ---------- Piece icons for the palette (top down, forward is up) ----------
function icon(t) {
  const road = (d) => `<path d="${d}" fill="none" stroke="#80848e" stroke-width="11"/><path d="${d}" fill="none" stroke="#eef0f4" stroke-width="1.4" stroke-dasharray="3 3"/>`;
  const straight = road('M20 40V0');
  const bar = (color) => `<path d="M7 20H33" stroke="${color}" stroke-width="5"/>`;
  const body = {
    road: straight,
    start: straight + bar('#3ddc84'),
    finish: straight + '<path d="M7 20H33" stroke="#15171c" stroke-width="5"/><path d="M7 20H33" stroke="#f3f5fa" stroke-width="5" stroke-dasharray="4 4"/>',
    cp: straight + bar('#ffd21f'),
    turnL: road('M20 40A20 20 0 0 0 0 20'),
    turnR: road('M20 40A20 20 0 0 1 40 20'),
    wideL: road('M30 40A30 30 0 0 0 0 10'),
    wideR: road('M10 40A30 30 0 0 1 40 10'),
    up: straight + '<path d="M12 24L20 13L28 24Z" fill="#f3f5fa"/>',
    down: straight + '<path d="M12 16L20 27L28 16Z" fill="#f3f5fa"/>',
    jump: road('M20 40V22') + road('M20 9V0') + '<path d="M14 26L26 26L20 19Z" fill="#ffd21f"/>',
    boost: straight + '<path d="M11 26L20 15L29 26L25 28L20 22L15 28Z" fill="#5ff3ff"/>',
    hammer: straight + '<path d="M7 8H33" stroke="#2b2f3a" stroke-width="3"/><path d="M20 8L13 22" stroke="#9aa0ab" stroke-width="2"/><rect x="7" y="20" width="12" height="8" fill="#ffc21a" stroke="#15171c" stroke-width="1.5"/>',
    sweeper: straight + '<path d="M8 30L32 10" stroke="#e2342d" stroke-width="3.5"/><circle cx="20" cy="20" r="4.5" fill="#ffc21a" stroke="#15171c" stroke-width="1.5"/>',
    pistons: straight + '<rect x="2" y="9" width="14" height="7" fill="#ffc21a" stroke="#15171c" stroke-width="1.5"/><rect x="24" y="24" width="14" height="7" fill="#ffc21a" stroke="#15171c" stroke-width="1.5"/>',
    bollards: straight + [[23, 13], [27, 13], [31, 13], [9, 27], [13, 27], [17, 27]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#ff7a1a"/>`).join(''),
  }[t];
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
}

// ---------- Overlay geometry: square outlines, centre-line ribbons, arrows ----------
class Lines {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, col) {
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  // A flat strip of width w from a to b (the material is double-sided).
  strip(a, b, w, col) {
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
    this.quad([a[0] + nx, a[1], a[2] + nz], [a[0] - nx, a[1], a[2] - nz], [b[0] - nx, b[1], b[2] - nz], [b[0] + nx, b[1], b[2] + nz], col);
  }
  square(i, j, y, col, inset = 0.8, w = 0.7) {
    const h = CELL / 2 - inset, x = i * CELL, z = j * CELL;
    const c = [[x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h]];
    for (let k = 0; k < 4; k++) this.strip(c[k], c[(k + 1) % 4], w, col);
  }
  arrow(at, dir, y, col, size = 3) {
    const [dx, dz] = DIRS[dir];
    const tip = [at[0] + dx * size, y, at[1] + dz * size];
    const l = [at[0] - dz * size * 0.8, y, at[1] + dx * size * 0.8], r = [at[0] + dz * size * 0.8, y, at[1] - dx * size * 0.8];
    this.tri(l, r, tip, col);
  }
  // A thin upright marker from y0 to y1, as two crossed quads.
  post(x, z, y0, y1, col) {
    this.quad([x - 0.25, y0, z], [x + 0.25, y0, z], [x + 0.25, y1, z], [x - 0.25, y1, z], col);
    this.quad([x, y0, z - 0.25], [x, y0, z + 0.25], [x, y1, z + 0.25], [x, y1, z - 0.25], col);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// World points along a piece's centre line, entry to exit, a little above the road.
function pieceLine(p, lift) {
  const F = DIRS[p.r], L = DIRS[(p.r + 1) % 4];
  const at = (f, l, h) => [p.i * CELL + F[0] * f + L[0] * l, (p.l + h) * LEVEL + lift, p.j * CELL + F[1] * f + L[1] * l];
  const pts = centreLine(p).map(([f, l, h]) => at(f, l, h));
  const def = PIECES[p.t];
  if (def.turn) pts.push(at(-CELL / 2 + def.radius * CELL, def.turn * def.radius * CELL, 0));
  else pts.push(at(CELL / 2, 0, def.rise || 0));
  return pts;
}

function drawPiece(lines, p, col, lift = 0.35) {
  for (const [i, j] of footprint(p)) lines.square(i, j, p.l * LEVEL + 0.12, col);
  const pts = pieceLine(p, lift);
  for (let k = 0; k < pts.length - 1; k++) lines.strip(pts[k], pts[k + 1], 1.1, col);
  const end = pts[pts.length - 1], ex = exitOf(p);
  lines.arrow([end[0] - DIRS[ex.r][0] * 3, end[2] - DIRS[ex.r][1] * 3], ex.r, end[1], col, 3.2);
}

export class Editor {
  constructor({ scene, camera, canvas, T, input, sound, store, onTest, onExit, onSaved }) {
    Object.assign(this, { scene, camera, canvas, T, input, sound, store, onTest, onExit, onSaved });
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.overlayMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.ghostMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.openMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.overlay = new THREE.Mesh(new THREE.BufferGeometry(), this.overlayMat);
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.openMark = new THREE.Mesh(new THREE.BufferGeometry(), this.openMat);
    for (const m of [this.overlay, this.ghost, this.openMark]) {
      m.renderOrder = 3;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.grid = new THREE.GridHelper(CELL * 48, 48, '#ffffff', '#ffffff');
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.22;
    this.grid.material.depthWrite = false;
    this.group.add(this.grid);
    this.road = null;

    this.tool = 'road';
    this.rot = 0;
    this.level = 0;
    this.walls = false;
    this.tunnel = false;
    this.hover = null;
    this.undoStack = [];
    this.redoStack = [];
    this.cam = { target: new THREE.Vector3(36, 0, 24), yaw: 0.7, pitch: 0.95, dist: 230 };
    this.ray = new THREE.Raycaster();
    this.pointers = new Map();
    this.robot = null;
    this.flashUntil = 0;

    const saved = store.get('editor', null);
    let data = null;
    try { if (saved && saved.code) data = decodeTrack(saved.code); } catch { data = null; }
    if (!data) data = exampleTrack();
    this.pieces = data.pieces;
    this.name = (saved && saved.name) || data.name;
    this.laps = data.laps;
    this.saveId = saved && saved.id ? saved.id : null;

    this.result = traceTrack(this.pieces, { name: this.name, laps: this.laps });
    this.buildUi();
    this.bindPointer();
    this.dirty = true;
  }

  // Bring the road and its check up to date now rather than next frame.
  fresh() {
    if (this.dirty) this.rebuild();
  }

  // ---------- UI ----------
  buildUi() {
    const pal = $('ed-palette');
    pal.replaceChildren(...PALETTE.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-piece';
      b.dataset.tool = t;
      b.setAttribute('role', 'radio');
      const key = DIGITS.indexOf(t);
      b.innerHTML = `${icon(t)}<span>${PIECES[t].label}</span>${key >= 0 ? `<kbd>${(key + 1) % 10}</kbd>` : ''}`;
      b.addEventListener('click', () => this.setTool(t));
      return b;
    }));
    $('ed-erase').addEventListener('click', () => this.setTool(this.tool === 'erase' ? 'road' : 'erase'));
    $('ed-rotate').addEventListener('click', () => this.rotate(1));
    $('ed-up').addEventListener('click', () => this.setLevel(this.level + 1));
    $('ed-down').addEventListener('click', () => this.setLevel(this.level - 1));
    $('ed-walls').addEventListener('click', () => { this.walls = !this.walls; if (!this.walls) this.tunnel = false; this.renderTools(); });
    $('ed-tunnel').addEventListener('click', () => { this.tunnel = !this.tunnel; this.renderTools(); });
    $('ed-undo').addEventListener('click', () => this.undo());
    $('ed-redo').addEventListener('click', () => this.redo());
    $('ed-test').addEventListener('click', () => this.test());
    $('ed-save').addEventListener('click', () => this.save());
    $('ed-tracks').addEventListener('click', () => this.showTracks());
    $('ed-share').addEventListener('click', () => this.showShare());
    $('ed-exit').addEventListener('click', () => this.exit());
    $('ed-panel-close').addEventListener('click', () => this.closePanel());
    const name = $('ed-name');
    name.addEventListener('input', () => { this.name = name.value.slice(0, 32) || 'My track'; this.autosave(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') name.blur(); });
    const laps = $('ed-laps');
    laps.addEventListener('change', () => { this.laps = clamp(+laps.value | 0, 1, 5); this.changed(false); laps.blur(); });
    // Buttons shouldn't keep focus, or Space/Enter would press them again.
    for (const b of $('editor').querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
  }

  renderTools() {
    for (const b of $('ed-palette').children) b.setAttribute('aria-checked', String(b.dataset.tool === this.tool));
    $('ed-erase').setAttribute('aria-pressed', String(this.tool === 'erase'));
    $('ed-walls').setAttribute('aria-pressed', String(this.walls));
    $('ed-tunnel').setAttribute('aria-pressed', String(this.tunnel));
    $('ed-level').textContent = String(this.level);
    $('ed-undo').disabled = !this.undoStack.length;
    $('ed-redo').disabled = !this.redoStack.length;
    $('ed-name').value = this.name;
    $('ed-laps').value = String(this.laps);
    this.ghostDirty = true;
  }

  setTool(t) {
    this.tool = t;
    this.sound.click();
    this.renderTools();
  }

  rotate(d) {
    this.rot = (this.rot + d + 4) % 4;
    this.renderTools();
  }

  setLevel(l) {
    this.level = clamp(l, 0, MAX_LEVEL);
    this.renderTools();
  }

  flash(message) {
    $('ed-status').textContent = message;
    $('ed-status').classList.add('warn');
    this.flashUntil = performance.now() + 3200;
  }

  status() {
    if (performance.now() < this.flashUntil) return;
    const r = this.result;
    const el = $('ed-status');
    el.classList.toggle('warn', !r.ok);
    if (!r.ok) { if (el.textContent !== r.message) el.textContent = r.message; return; }
    const km = (this.path.length / 1000).toFixed(2);
    const kind = r.closed ? `Circuit, ${km} km, ${this.laps} lap${this.laps > 1 ? 's' : ''}` : `A to B, ${km} km`;
    const cps = `${r.checkpoints} checkpoint${r.checkpoints === 1 ? '' : 's'}`;
    const robot = !this.robot ? '' : this.robot.busy ? ' Robot test lap running…'
      : this.robot.done ? ` Robot lap ${formatTime(this.robot.time)} sets the medals.` : ' The robot couldn’t finish it: a jump may be too long, or a corner too tight.';
    const text = `${kind}, ${cps}. Ready to test drive.${robot}`;
    if (el.textContent !== text) el.textContent = text;
  }

  // ---------- Opening and closing ----------
  open() {
    this.group.visible = true;
    $('editor').hidden = false;
    this.closePanel();
    this.renderTools();
    this.dirty = true;
    this.camera.clearViewOffset();
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
  }

  close() {
    this.group.visible = false;
    $('editor').hidden = true;
    this.autosave();
  }

  exit() {
    this.close();
    this.onExit();
  }

  test() {
    this.fresh();
    if (!this.result.ok) { this.flash(this.result.message); return; }
    const def = { ...this.result.def, name: this.name };
    if (this.robot && this.robot.done && this.robot.id === def.id) def.medals = robotMedals(this.robot.time);
    this.close();
    this.onTest(def);
  }

  // ---------- Editing ----------
  snapshot() {
    this.undoStack.push(JSON.stringify(this.pieces));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.pieces));
    this.pieces = JSON.parse(this.undoStack.pop());
    this.changed();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.pieces));
    this.pieces = JSON.parse(this.redoStack.pop());
    this.changed();
  }

  changed(sound = true) {
    this.dirty = true;
    if (sound) this.sound.click();
    this.renderTools();
    this.autosave();
  }

  autosave() {
    this.store.set('editor', { id: this.saveId, name: this.name, code: encodeTrack(this) });
  }

  place(i, j) {
    const t = this.tool, def = PIECES[t];
    const piece = { t, i, j, l: this.level, r: this.rot, w: this.walls || this.tunnel, u: this.tunnel };
    const top = piece.l + (def.rise || 0);
    if (top < 0) { this.flash('A Slope down has to start at height 1 or more.'); return; }
    if (top > MAX_LEVEL) { this.flash(`Height ${MAX_LEVEL} is as high as the road goes.`); return; }
    const same = this.pieces.find((p) => p.t === t && p.i === i && p.j === j && p.l === piece.l && p.r === piece.r);
    if (same && same.w === piece.w && same.u === piece.u) return;
    this.snapshot();
    this.pieces = this.pieces.filter((p) => !clash(p, piece) && !(t === 'start' && p.t === 'start'));
    this.pieces.push(piece);
    // Carry on from where this piece leaves off.
    const ex = exitOf(piece);
    this.rot = ex.r;
    if (!def.jump) this.level = clamp(ex.l, 0, MAX_LEVEL);
    this.changed();
  }

  erase(i, j) {
    let best = null, bestD = Infinity;
    for (const p of this.pieces) {
      if (!footprint(p).some(([a, b]) => a === i && b === j)) continue;
      const d = Math.abs(p.l - this.level);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || bestD > 3) return;
    this.snapshot();
    this.pieces = this.pieces.filter((p) => p !== best);
    this.changed();
  }

  // Tap or click on square (i, j).
  apply(i, j, eraseInstead = false) {
    if (eraseInstead || this.tool === 'erase') this.erase(i, j);
    else this.place(i, j);
  }

  // ---------- Saving and sharing ----------
  save() {
    this.fresh();
    const list = savedTracks(this.store);
    if (!this.saveId) this.saveId = 'u' + Date.now().toString(36);
    const robot = this.robot && this.robot.done && this.result.ok && this.robot.id === this.result.def.id ? this.robot.time : null;
    const entry = { id: this.saveId, name: this.name, code: encodeTrack(this), robot };
    const i = list.findIndex((t) => t.id === this.saveId);
    if (i >= 0) list[i] = entry; else list.push(entry);
    this.store.set('tracks', list);
    this.autosave();
    this.onSaved();
    this.flash(this.result.ok ? 'Saved. It’s in the menu’s track list too.' : 'Saved. Finish the road to race it from the menu.');
  }

  // Keep a saved copy's robot time up to date once the robot finishes.
  storeRobotTime() {
    if (!this.saveId) return;
    const list = savedTracks(this.store);
    const entry = list.find((t) => t.id === this.saveId);
    if (!entry || entry.code !== encodeTrack(this)) return;
    entry.robot = this.robot.time;
    this.store.set('tracks', list);
    this.onSaved();
  }

  load(data, id = null) {
    this.snapshot();
    this.pieces = data.pieces;
    this.name = data.name;
    this.laps = data.laps;
    this.saveId = id;
    this.frame();
    this.changed(false);
  }

  panel(title, body) {
    $('ed-panel-title').textContent = title;
    $('ed-panel-body').replaceChildren(...body);
    $('ed-panel').hidden = false;
  }

  closePanel() {
    $('ed-panel').hidden = true;
  }

  showTracks() {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const btn = (text, fn, cls = 'pill-btn') => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    const list = savedTracks(this.store);
    const rows = list.map((t) => {
      const row = el('div', 'ed-row');
      row.append(el('span', 'ed-row-name', t.name));
      row.append(btn('Open', () => {
        try { this.load(decodeTrack(t.code), t.id); this.name = t.name; this.renderTools(); this.closePanel(); } catch (err) { this.flash(err.message); }
      }));
      const del = btn('Delete', () => {
        if (del.dataset.armed) {
          this.store.set('tracks', savedTracks(this.store).filter((x) => x.id !== t.id));
          if (this.saveId === t.id) this.saveId = null;
          this.onSaved();
          this.showTracks();
        } else {
          del.dataset.armed = '1';
          del.textContent = 'Delete for good?';
          setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete'; }, 3000);
        }
      }, 'pill-btn danger');
      row.append(del);
      return row;
    });
    const empty = el('p', 'ed-note', 'Nothing saved yet. Press Save to keep the track you’re building.');
    const actions = el('div', 'ed-row ed-actions');
    actions.append(
      btn('New empty track', () => { this.load({ name: 'My track', laps: 1, pieces: [] }); this.closePanel(); }),
      btn('Example circuit', () => { this.load(exampleTrack()); this.closePanel(); }),
    );
    this.panel('My tracks', [...(rows.length ? rows : [empty]), actions]);
  }

  showShare() {
    const code = encodeTrack(this);
    const out = document.createElement('textarea');
    out.id = 'ed-code-out';
    out.className = 'ed-code';
    out.readOnly = true;
    out.value = code;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'pill-btn';
    copy.textContent = 'Copy code';
    copy.addEventListener('click', () => {
      const done = () => { copy.textContent = 'Copied'; };
      const fallback = () => { out.focus(); out.select(); copy.textContent = 'Selected: press Ctrl+C'; };
      try { navigator.clipboard.writeText(code).then(done, fallback); } catch { fallback(); }
    });
    const inp = document.createElement('textarea');
    inp.id = 'ed-code-in';
    inp.className = 'ed-code';
    inp.placeholder = 'Paste a track code (APEX1:…)';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'pill-btn';
    load.textContent = 'Load this code';
    const msg = document.createElement('p');
    msg.className = 'ed-note';
    load.addEventListener('click', () => {
      try {
        this.load(decodeTrack(inp.value));
        this.closePanel();
      } catch (err) { msg.textContent = err.message; }
    });
    const p1 = document.createElement('p');
    p1.className = 'ed-note';
    p1.textContent = 'Send this code to a friend. They paste it here to drive your track.';
    this.panel('Share', [p1, out, copy, inp, load, msg]);
  }

  // Point the camera at the whole track.
  frame() {
    if (!this.pieces.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of this.pieces) for (const [i, j] of footprint(p)) {
      x0 = Math.min(x0, i * CELL); x1 = Math.max(x1, i * CELL); z0 = Math.min(z0, j * CELL); z1 = Math.max(z1, j * CELL);
    }
    this.cam.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.cam.dist = clamp(Math.max(x1 - x0, z1 - z0) * 1.3 + 120, 120, 700);
  }

  // ---------- Pointer and keys ----------
  cellAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.level * LEVEL);
    const hit = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? { i: Math.round(hit.x / CELL), j: Math.round(hit.z / CELL) } : null;
  }

  bindPointer() {
    const cv = this.canvas;
    const active = () => this.group.visible && $('ed-panel').hidden;
    cv.addEventListener('pointerdown', (e) => {
      if (!active()) return;
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, moved: false, type: e.pointerType });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        a.moved = b.moved = true;
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!active()) return;
      const p = this.pointers.get(e.pointerId);
      if (e.pointerType === 'mouse') {
        const c = this.cellAt(e.clientX, e.clientY);
        if (!this.hover || !c || c.i !== this.hover.i || c.j !== this.hover.j) { this.hover = c; this.ghostDirty = true; }
      }
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 7) p.moved = true;
      if (!p.moved) return;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.cam.dist = clamp(this.cam.dist * this.pinch.d / Math.max(d, 1), 40, 700);
        this.cam.yaw -= ang - this.pinch.ang;
        this.pinch = { d, ang };
      } else if (p.button === 2 || p.button === 1) {
        this.cam.yaw -= dx * 0.006;
        this.cam.pitch = clamp(this.cam.pitch + dy * 0.005, 0.3, 1.45);
      } else {
        this.pan(-dx, -dy);
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || !active() || p.moved || this.pointers.size) return;
      const c = this.cellAt(e.clientX, e.clientY);
      if (c) this.apply(c.i, c.j, p.button === 2);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    cv.addEventListener('wheel', (e) => {
      if (!active()) return;
      e.preventDefault();
      this.cam.dist = clamp(this.cam.dist * Math.exp(e.deltaY * 0.001), 40, 700);
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => { if (active()) e.preventDefault(); });
    cv.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.ghostDirty = true; } });
  }

  // Move the camera target by a screen-space drag (pixels).
  pan(dx, dy) {
    const k = this.cam.dist * 0.0016;
    const s = Math.sin(this.cam.yaw), c = Math.cos(this.cam.yaw);
    // Screen right is (c, -s) on the ground; screen up is (-s, -c).
    this.cam.target.x += (c * dx + s * dy) * k;
    this.cam.target.z += (-s * dx + c * dy) * k;
  }

  onKey(code, e) {
    if (!$('ed-panel').hidden) {
      if (code === 'Escape') this.closePanel();
      return;
    }
    const ctrl = e && (e.ctrlKey || e.metaKey);
    if (ctrl && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (ctrl && code === 'KeyY') { e.preventDefault(); this.redo(); return; }
    if (ctrl && code === 'KeyS') { e.preventDefault(); this.save(); return; }
    if (ctrl) return;
    const digit = /^Digit(\d)$/.exec(code);
    if (digit) { this.setTool(DIGITS[(+digit[1] + 9) % 10]); return; }
    switch (code) {
      case 'KeyR': this.rotate(e && e.shiftKey ? -1 : 1); break;
      case 'KeyE': case 'PageUp': this.setLevel(this.level + 1); break;
      case 'KeyQ': case 'PageDown': this.setLevel(this.level - 1); break;
      case 'KeyX': case 'Delete': this.setTool(this.tool === 'erase' ? 'road' : 'erase'); break;
      case 'KeyT': this.test(); break;
      case 'KeyF': this.frame(); break;
      case 'Escape': this.exit(); break;
    }
  }

  // ---------- Per frame ----------
  update(dt) {
    // Keyboard panning (not while typing in the name box).
    const k = this.input.keys;
    if (!document.activeElement || !document.activeElement.closest('input, textarea, select')) {
      const fx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const fz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
      if (fx || fz) this.pan(fx * dt * 700, fz * dt * 700);
    }

    if (this.dirty) this.rebuild();
    if (this.ghostDirty) this.rebuildGhost();
    this.advanceRobot();

    const { target, yaw, pitch, dist } = this.cam;
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.grid.position.set(Math.round(target.x / CELL) * CELL + CELL / 2, this.level * LEVEL + 0.06, Math.round(target.z / CELL) * CELL + CELL / 2);
    this.openMat.opacity = 0.5 + 0.4 * Math.sin(performance.now() / 180);
    if (this.road) this.road.update(performance.now() / 1000);    // obstacles swing in the preview too
    this.status();
  }

  // Rebuild the road and the overlays after an edit.
  rebuild() {
    this.dirty = false;
    this.result = traceTrack(this.pieces, { name: this.name, laps: this.laps });
    if (this.road) {
      this.group.remove(this.road.group);
      this.road.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      this.road = null;
    }
    this.path = null;
    const pts = this.result.ok ? this.result.def.points : this.result.preview;
    if (pts && pts.length >= 2) {
      const def = this.result.ok ? this.result.def : { closed: false, width: 14, points: pts };
      this.path = new TrackPath(def);
      this.road = buildTrack(this.path, this.T, { finish: this.result.ok });
      this.group.add(this.road.group);
    }

    const lines = new Lines();
    const onRoute = new Set(this.result.route);
    for (const p of this.pieces) {
      const def = PIECES[p.t];
      const col = !onRoute.has(p) ? C.loose : def.cp ? C.cp : p.t === 'start' ? C.start : def.finish ? C.finish : C.route;
      drawPiece(lines, p, col);
      if (p.l > 0) for (const [i, j] of footprint(p)) lines.post(i * CELL, j * CELL, 0, p.l * LEVEL, col);
    }
    this.overlay.geometry.dispose();
    this.overlay.geometry = lines.geometry();

    const open = new Lines();
    const ex = this.result.openEnd;
    if (ex) {
      open.square(ex.i, ex.j, ex.l * LEVEL + 0.15, C.open, 0.4, 1.4);
      open.arrow([ex.i * CELL - DIRS[ex.r][0] * 4, ex.j * CELL - DIRS[ex.r][1] * 4], ex.r, ex.l * LEVEL + 0.4, C.open, 5);
    }
    this.openMark.geometry.dispose();
    this.openMark.geometry = open.geometry();

    // Robot test lap for finished tracks, run a slice per frame.
    this.robot = null;
    if (this.result.ok) {
      this.robot = { id: this.result.def.id, run: new RobotRun(this.path, { maxTime: 300 }), busy: true };
    }
  }

  advanceRobot() {
    const r = this.robot;
    if (!r || !r.busy) return;
    if (r.run.advance(700)) {
      const res = r.run.result;
      r.busy = false;
      r.done = res.done && res.respawns === 0;
      r.time = res.time;
      r.run = null;
      if (r.done) this.storeRobotTime();
    }
  }

  rebuildGhost() {
    this.ghostDirty = false;
    const g = new Lines();
    if (this.hover) {
      if (this.tool === 'erase') {
        g.square(this.hover.i, this.hover.j, this.level * LEVEL + 0.2, C.erase, 0.3, 1.2);
      } else {
        const p = { t: this.tool, i: this.hover.i, j: this.hover.j, l: this.level, r: this.rot };
        drawPiece(g, p, C.ghost, 0.5);
        if (p.l > 0) for (const [i, j] of footprint(p)) g.post(i * CELL, j * CELL, 0, p.l * LEVEL, C.ghost);
      }
    }
    this.ghost.geometry.dispose();
    this.ghost.geometry = g.geometry();
  }
}
