// Online play with friends over WebRTC (PeerJS). No game server: one player hosts and runs the match
// (bots, storm, loot, damage, builds); friends join with a room code. Each player's own movement is
// simulated on their machine for responsiveness; everything else comes from the host.
//
// Messages (JSON):
//   client -> host  hello {name, outfit, skin} | i (input packet, ~30/s)
//   host -> client  roster | start | s (snapshot, 15/s) | e (event batch) | inv (your inventory) | end | back
import * as THREE from 'three';
import { WEAPONS } from './items.js';

const PREFIX = 'outbuild-room-';
const MODES = ['bus', 'sky', 'glide', 'ground', 'dead'];
const r2 = (v) => Math.round(v * 100) / 100;
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Effects the host mirrors to everyone (the rest are produced locally by each game).
const FX = ['tracer', 'muzzleFlash', 'impact', 'splash', 'explosion', 'landingDust', 'eliminate'];

function enc(x) {
  if (x && x.isVector3) return { v: v3(x) };
  if (x && typeof x === 'object' && !Array.isArray(x) && ('kind' in x || 'collider' in x)) return null; // ray hits
  return x;
}
function dec(x) { return x && typeof x === 'object' && x.v ? toV(x.v) : x; }

function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '../vendor/peerjs.min.js';
    s.onload = () => (window.Peer ? res(window.Peer) : rej(new Error('PeerJS did not load')));
    s.onerror = () => rej(new Error('Could not load the networking library'));
    document.head.appendChild(s);
  });
}

// Signalling server: the free public PeerJS server by default. `?peer=host:port` (or window.OUTBUILD_PEER)
// points at your own `peerjs` server instead, e.g. for a LAN party without internet.
function peerOptions() {
  const o = { debug: 0 };
  const spec = new URLSearchParams(location.search).get('peer') || window.OUTBUILD_PEER;
  if (spec) {
    const u = new URL(spec.includes('://') ? spec : `http://${spec}`);
    o.host = u.hostname;
    o.port = +u.port || (u.protocol === 'https:' ? 443 : 80);
    o.secure = u.protocol === 'https:';
    o.path = u.pathname && u.pathname !== '/' ? u.pathname : '/';
  }
  return o;
}

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.role = null;      // 'host' | 'client'
    this.peer = null;
    this.conns = new Map(); // host: peerId -> { conn, name, outfit, skin, actor, input, edges }
    this.hostConn = null;
    this.roster = [];
    this.code = '';
    this.out = [];
    this.mute = 0;
    this.snapT = 0;
    this.invT = 0;
    this.sendT = 0;
    this.edges = this.freshEdges();
    this.onChange = null;   // UI refresh
    this.onStatus = null;   // (text, isError)
  }

  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }
  get active() { return !!this.role; }

  status(t, err = false) { if (this.onStatus) this.onStatus(t, err); }
  changed() { if (this.onChange) this.onChange(); }

  me() {
    const s = this.game.settings;
    return { name: (s.name || 'Player').slice(0, 16), outfit: s.outfit, skin: s.skin ?? 1 };
  }

  // ------------------------------------------------------------------ connection setup
  async host() {
    const Peer = await loadPeer();
    this.leave();
    this.role = 'host';
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = roomCode();
      try {
        this.peer = await new Promise((res, rej) => {
          const p = new Peer(PREFIX + code.toLowerCase(), peerOptions());
          let open = false;
          p.on('open', () => { open = true; res(p); });
          p.on('error', (e) => {
            if (!open) { p.destroy(); rej(e); return; }
            if (e.type === 'network' || e.type === 'server-error') this.status('Lost the matchmaking server; friends already in the room stay connected', true);
          });
        });
        this.code = code;
        break;
      } catch (e) {
        if (e.type !== 'unavailable-id') { this.role = null; throw e; }
      }
    }
    if (!this.peer) { this.role = null; throw new Error('Could not create a room'); }
    this.peer.on('connection', (conn) => this.acceptClient(conn));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* ignore */ } });
    this.roster = [{ id: 'host', ...this.me(), host: true }];
    this.changed();
    return this.code;
  }

  acceptClient(conn) {
    conn.on('open', () => {
      if (this.game.state === 'match') {
        conn.send({ t: 'busy' });
        setTimeout(() => conn.close(), 500);
        return;
      }
      if (this.conns.size >= 15) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
      this.conns.set(conn.peer, { conn, name: 'Player', outfit: 0, skin: 1, actor: null, input: null, edges: this.freshEdges() });
    });
    conn.on('data', (m) => { m = this.receive(conn.peer, m); if (m) this.hostMessage(conn.peer, m); });
    conn.on('close', () => this.dropClient(conn.peer));
    conn.on('error', () => this.dropClient(conn.peer));
  }

  dropClient(id) {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    this.killLeaver(c.actor);
    this.syncRoster();
  }

  killLeaver(a) {
    if (!a || !a.alive || this.game.state !== 'match' || !this.game.actors.includes(a)) return;
    a.lastHitBy = null;
    a.takeDamage(1e6, null, { left: true });
  }

  syncRoster() {
    this.roster = [{ id: 'host', ...this.me(), host: true },
      ...[...this.conns.entries()].map(([id, c]) => ({ id, name: c.name, outfit: c.outfit, skin: c.skin }))];
    this.broadcast({ t: 'roster', roster: this.roster, map: this.game.settings.map || 'island' });
    this.changed();
  }

  async join(code) {
    const Peer = await loadPeer();
    this.leave();
    this.role = 'client';
    code = code.trim().toUpperCase();
    this.code = code;
    const peer = await new Promise((res, rej) => {
      const p = new Peer(peerOptions());
      p.on('open', () => res(p));
      p.on('error', (e) => { p.destroy(); rej(e); });
    });
    this.peer = peer;
    await new Promise((res, rej) => {
      let done = false;
      const fail = (e) => { if (!done) { done = true; clearTimeout(t); rej(e); } };
      const t = setTimeout(() => fail(new Error('Could not reach that room. Check the code, or the host may be behind a strict firewall.')), 15000);
      peer.on('error', (e) => {
        if (!done) fail(e);
        else if (e.type !== 'peer-unavailable') this.status('Connection problem: ' + e.type, true);
      });
      const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        this.hostConn = conn;
        conn.send({ t: 'hello', ...this.me() });
        res();
      });
      conn.on('data', (m) => { m = this.receive('host', m); if (m) this.clientMessage(m); });
      conn.on('close', () => { if (this.hostConn === conn) this.hostLost(); });
      conn.on('error', () => { if (this.hostConn === conn) this.hostLost(); });
    });
    this.changed();
  }

  hostLost() {
    if (!this.isClient) return;
    const g = this.game;
    this.leave();
    if (g.state === 'match') { g.ui.toLobby(true); g.ui.panel('online'); }
    this.status('The host left the game', true);
    this.changed();
  }

  leave() {
    const peer = this.peer;
    this.peer = null;
    this.hostConn = null;
    this.role = null;
    if (peer) { try { peer.destroy(); } catch { /* ignore */ } }
    this.conns.clear();
    this.role = null;
    this.roster = [];
    this.code = '';
    this.out = [];
    this.changed();
  }

  // PeerJS's JSON channel takes messages up to ~16 KB, so big ones (the match start, busy frames) go in parts.
  send(conn, m) {
    if (!conn || !conn.open) return;
    try {
      const s = JSON.stringify(m);
      if (s.length < 7000) { conn.send(m); return; }
      const id = this.partSeq = (this.partSeq || 0) + 1;
      const n = Math.ceil(s.length / 7000);
      for (let i = 0; i < n; i++) conn.send({ t: 'part', id, i, n, d: s.slice(i * 7000, (i + 1) * 7000) });
    } catch { /* dropped */ }
  }

  // Reassemble split messages; returns the whole message once every part is in.
  receive(from, m) {
    if (!m || m.t !== 'part') return m;
    const parts = this.parts || (this.parts = new Map());
    const key = from + ':' + m.id;
    let p = parts.get(key);
    if (!p) { p = { n: m.n, got: 0, d: [] }; parts.set(key, p); }
    if (p.d[m.i] === undefined) { p.d[m.i] = m.d; p.got++; }
    if (p.got < p.n) return null;
    parts.delete(key);
    try { return JSON.parse(p.d.join('')); } catch { return null; }
  }
  broadcast(m) { for (const c of this.conns.values()) this.send(c.conn, m); }

  freshEdges() { return { fp: 0, rl: 0, it: 0, dr: 0, ed: null, sel: null, jump: 0, fall: 0 }; }

  // ------------------------------------------------------------------ host side
  hostMessage(id, m) {
    const c = this.conns.get(id);
    if (!c) return;
    if (m.t === 'hello') {
      c.name = String(m.name || 'Player').slice(0, 16).replace(/[<>&"]/g, '');
      c.outfit = m.outfit | 0;
      c.skin = m.skin | 0;
      this.syncRoster();
    } else if (m.t === 'i') {
      c.input = m;
      const e = c.edges;
      if (m.fp) e.fp++;
      if (m.rl) e.rl++;
      if (m.it) e.it++;
      if (m.dr) e.dr++;
      if (m.ed) e.ed = m.ed;
      if (m.sel !== null && m.sel !== undefined) e.sel = m.sel;
      if (m.fall) e.fall += m.fall;
    } else if (m.t === 'quit') {
      this.killLeaver(c.actor);
    }
  }

  // Remote players become actors driven by their input packets.
  hostCreateRemotes(makeActor) {
    for (const [id, c] of this.conns) {
      c.actor = makeActor(c);
      c.actor.remote = true;
      c.actor.peerId = id;
      c.input = null;
      c.edges = this.freshEdges();
    }
  }

  // Before an actor updates on the host: copy the latest input from its client.
  hostApplyInput(a) {
    const c = this.conns.get(a.peerId);
    if (!c || !c.input) return false;
    const m = c.input;
    const e = c.edges;
    const it = a.intent;
    a.pos.set(m.p[0], m.p[1], m.p[2]);
    a.vel.set(m.v[0], m.v[1], m.v[2]);
    const mode = m.mode;
    if (mode !== a.mode && a.alive) {
      if (mode === 'glide') a.setGlider(true);
      else if (a.mode === 'glide') a.setGlider(false);
      a.mode = mode;
    }
    a.grounded = !!m.g;
    a.swimming = !!m.sw;
    a.dive = m.dv || 0;
    a.hittable = a.mode !== 'bus';
    a.dancing = !!m.dn;
    it.yaw = m.yaw; it.pitch = m.pitch;
    it.moveX = m.mx; it.moveZ = m.mz;
    it.crouch = !!m.c; it.sprint = !!m.s; it.ads = !!m.ads;
    it.fire = !!m.fire;
    it.firePressed = e.fp > 0;
    it.reload = e.rl > 0;
    it.interact = e.it > 0;
    if (e.sel !== null) it.select = e.sel;
    it.buildMode = !!m.bmo;
    it.place = !!m.pl;
    it.buildSlot = m.bs || null;
    it.buildKind = m.bk;
    it.buildMat = m.bm || 'wood';
    it.aimOrigin = m.ao ? toV(m.ao) : null;
    it.aimDir = m.ad ? toV(m.ad).normalize() : null;
    const g = this.game;
    if (e.dr) g.dropCurrent(a);
    if (e.ed) {
      const p = g.pieces.pieces.get(e.ed);
      if (p && p.owner === a) g.building.edit(a, p);
    }
    if (e.fall > 0) a.takeDamage(e.fall, null, { fall: true });
    c.edges = this.freshEdges();
    return true;
  }

  emit(...ev) { if (this.isHost && !this.mute && this.conns.size) this.out.push(ev); }

  // Wrap effect calls so clients see the same tracers, flashes and explosions.
  installHostProxies() {
    const g = this.game;
    const fx = g.effects;
    if (!fx.__proxied) {
      fx.__proxied = true;
      for (const name of FX) {
        const orig = fx[name].bind(fx);
        fx[name] = (...args) => { this.emit('fx', name, args.map(enc)); return orig(...args); };
      }
    }
    // builds: placed, edited, damaged and destroyed pieces (the island's houses are identical everywhere, so keys match)
    const P = g.pieces;
    if (!P.__proxied) {
      P.__proxied = true;
      const add = P.add.bind(P), damage = P.damage.bind(P), destroy = P.destroy.bind(P), replace = P.replace.bind(P);
      P.add = (model, slot, opts = {}) => {
        const p = add(model, slot, opts);
        if (p && !opts.house) this.emit('pa', model, p.ix, p.iy, p.iz, p.axis ?? null, p.dir ?? null, p.owner ? p.owner.id : 0, opts.build || 0);
        return p;
      };
      P.replace = (p, model, changes = {}) => {
        const key = p.key;
        this.mute++;
        let n = null;
        try { n = replace(p, model, changes); } finally { this.mute--; }
        if (n) this.emit('pr', key, model, changes);
        return n;
      };
      P.damage = (p, amount, source) => {
        const r = damage(p, amount, source);
        if (p.alive) this.emit('pd', p.key, Math.round(p.hp));
        return r;
      };
      P.destroy = (p, cause = null, cascade = true) => {
        const was = p.alive;
        destroy(p, cause, cascade);
        if (was && cause !== 'clear') this.emit('px', p.key);
      };
    }
    // trees, rocks, cars... (a new PropSystem is made for every match)
    const R = g.props;
    if (!R.__proxied) {
      R.__proxied = true;
      const index = new Map(R.all.map((p, i) => [p, i]));
      const damage = R.damage.bind(R), destroy = R.destroy.bind(R);
      R.damage = (prop, amount, o) => {
        const r = damage(prop, amount, o);
        if (prop.alive) this.emit('prd', index.get(prop), Math.round(prop.hp));
        return r;
      };
      R.destroy = (prop) => {
        const was = prop.alive;
        destroy(prop);
        if (was) this.emit('prx', index.get(prop));
      };
    }
    // loot on the ground: announced at the end of the frame, once its toss velocity is known
    const K = g.pickups;
    this.newPickups = [];
    K.onSpawn = (p) => { if (this.isHost && !this.mute && this.conns.size) this.newPickups.push(p); };
    K.onRemove = (p) => { if (p.netSent) this.emit('kr', p.id); };
  }

  hostTick(dt) {
    const g = this.game;
    if (!this.conns.size) return;
    if (this.newPickups && this.newPickups.length) {
      for (const p of this.newPickups) {
        if (!p.alive) continue;
        p.netSent = true;
        this.out.push(['ks', p.id, p.item, r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz), p.settled ? 1 : 0]);
      }
      this.newPickups = [];
    }
    if (this.out.length) { this.broadcast({ t: 'e', l: this.out }); this.out = []; }
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 1 / 15;
      this.broadcast(this.snapshot());
    }
    this.invT -= dt;
    if (this.invT <= 0) {
      this.invT = 0.1;
      for (const c of this.conns.values()) if (c.actor) this.send(c.conn, this.invState(c.actor));
    }
  }

  snapshot() {
    const g = this.game;
    const s = g.storm;
    const a = g.actors.map((x) => {
      const flags = (x.grounded ? 1 : 0) | (x.intent.crouch ? 2 : 0) | (x.intent.sprint ? 4 : 0) | (x.alive ? 8 : 0) |
        (x.dancing ? 16 : 0) | (x.swimming ? 32 : 0);
      return [x.id, r2(x.pos.x), r2(x.pos.y), r2(x.pos.z), r2(x.yaw), r2(x.pitch), r2(x.vel.x), r2(x.vel.y), r2(x.vel.z),
        MODES.indexOf(x.alive ? x.mode : 'dead'), flags, Math.ceil(x.health), Math.ceil(x.shield), x.heldSignature(),
        r2(x.harvestT), x.reloadT > 0 ? r2(1 - x.reloadT / x.reloadTotal) : 0, x.useT > 0 ? r2(x.useT / x.useTotal) : 0,
        r2(x.intent.moveX), r2(x.intent.moveZ), r2(x.dive || 0)];
    });
    const pr = [];
    for (const p of g.combat.projectiles) if (p.def.id === 'rocket') pr.push(['r', ...v3(p.pos), ...v3(p.vel)]);
    for (const n of g.combat.grenades || []) pr.push(['g', ...v3(n.pos), ...v3(n.vel)]);
    return {
      t: 's', time: r2(g.time), a, pr,
      st: { state: s.state, timer: r2(s.timer), phase: s.phase, cx: r2(s.center.x), cz: r2(s.center.y), r: r2(s.radius),
        nx: r2(s.next.c.x), nz: r2(s.next.c.y), nr: r2(s.next.r), dps: s.dps },
    };
  }

  invState(a) {
    return {
      t: 'inv', slots: a.inv.slots, ammo: a.inv.ammo, mats: a.inv.mats, sel: a.inv.selected,
      rl: [r2(a.reloadT), r2(a.reloadTotal)], use: [r2(a.useT), r2(a.useTotal)], hv: r2(a.harvestT),
      k: a.kills, dd: Math.round(a.damageDealt), mg: a.matsGathered, b: a.built,
    };
  }

  // ------------------------------------------------------------------ client side
  clientMessage(m) {
    const g = this.game;
    switch (m.t) {
      case 'roster': this.roster = m.roster; this.hostMap = m.map; this.changed(); break;
      case 'busy': this.status('That match has already started. Wait for it to finish and join again.', true); this.leave(); break;
      case 'full': this.status('That room is full', true); this.leave(); break;
      case 'start': g.startClientMatch(m); break;
      case 'abort':
        if (g.state === 'match') { g.ui.toLobby(true); g.ui.panel('online'); this.status('The host ended the match'); }
        break;
      case 's': if (g.state === 'match') this.applySnapshot(m); break;
      case 'e': if (g.state === 'match') for (const ev of m.l) this.applyEvent(ev); break;
      case 'inv': if (g.state === 'match') this.applyInv(m); break;
      default:
    }
  }

  applySnapshot(m) {
    const g = this.game;
    this.lastSnap = m;
    for (const s of m.a) {
      const a = g.actorById.get(s[0]);
      if (!a) continue;
      if (a === g.player) {
        a.health = s[11];
        a.shield = s[12];
        continue;
      }
      a.netState = s;
      a.netT = performance.now();
    }
    const st = m.st;
    g.storm.applyNet(st);
    g.netProjectiles(m.pr);
  }

  applyInv(m) {
    const a = this.game.player;
    if (!a || !a.alive) return;
    a.inv.slots = m.slots;
    a.inv.ammo = m.ammo;
    a.inv.mats = m.mats;
    if (a.inv.selected !== m.sel && !(this.pendingSel !== null && performance.now() - this.pendingSelT < 400)) a.inv.selected = m.sel;
    a.reloadT = m.rl[0]; a.reloadTotal = m.rl[1] || 1;
    a.useT = m.use[0]; a.useTotal = m.use[1] || 1;
    a.kills = m.k; a.damageDealt = m.dd; a.matsGathered = m.mg; a.built = m.b;
  }

  applyEvent(ev) {
    const g = this.game;
    const [type, ...x] = ev;
    const me = g.player ? g.player.id : -1;
    switch (type) {
      case 'fx': g.effects[x[0]](...x[1].map(dec)); break;
      case 'pa': g.netPieceAdd(x); break;
      case 'pd': { const p = g.pieces.pieces.get(x[0]); if (p) { p.hp = x[1]; p.flash = 1; g.pieces.active.add(p); } break; }
      case 'px': { const p = g.pieces.pieces.get(x[0]); if (p) g.pieces.destroy(p, 'net', false); break; }
      case 'prd': { const p = g.props.all[x[0]]; if (p && p.alive) { p.hp = x[1]; p.shake = 1; g.props.shaking.add(p); } break; }
      case 'prx': { const p = g.props.all[x[0]]; if (p && p.alive) g.props.destroy(p); break; }
      case 'ks': g.netPickupSpawn(x); break;
      case 'kr': { const p = g.pickups.byId(x[0]); if (p) g.pickups.remove(p); break; }
      case 'co': { const c = g.pickups.containerById(x[0]); if (c && !c.opened) { c.opened = true; g.audio.chestOpen(new THREE.Vector3(c.x, c.y, c.z)); } break; }
      case 'drop': g.spawnSupplyDrop(x[0], x[1], x[2]); break;
      case 'pr': {
        const p = g.pieces.pieces.get(x[0]);
        if (!p) break;
        const n = g.pieces.replace(p, x[1], x[2]);
        if (n && n.owner === g.player) g.onEdit(g.player, n);
        break;
      }
      case 'fire': {
        const a = g.actorById.get(x[0]);
        const def = WEAPONS[x[1]];
        g.audio.gun(x[1], toV(x[2]), x[0] === me);
        if (a && def) {
          if (a === g.player) g.kick(def); else a.netFired = def.recoil;
        }
        break;
      }
      case 'snd': g.netSound(x, me); break;
      case 'throw': { const a = g.actorById.get(x[0]); if (a) a.model.state.throwT = 0.26; break; }
      case 'hit': if (x[0] === me) g.onHitConfirm(g.player, null, x[1], x[2], toV(x[3]), x[4]); break;
      case 'hurt': if (x[0] === me) g.onDamage(g.player, x[1], x[2] ? { pos: toV(x[2]) } : null, { toShield: x[3], shieldBroken: x[4], storm: x[5] }); break;
      case 'harv': if (x[0] === me) g.hud.matGain(x[1], x[2]); break;
      case 'msg': if (x[0] === me) g.netPrivate(x.slice(1)); break;
      case 'death': g.netDeath(x); break;
      case 'end': g.netEnd(x[0]); break;
      default:
    }
  }

  // Our input for the host.
  clientTick(dt) {
    const g = this.game;
    const a = g.player;
    if (!a || !this.hostConn) return;
    const it = a.intent;
    const e = this.edges;
    if (it.firePressed) e.fp = 1;
    if (it.reload) e.rl = 1;
    if (it.interact) e.it = 1;
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / 30;
    this.send(this.hostConn, {
      t: 'i', p: v3(a.pos), v: v3(a.vel), mode: a.alive ? a.mode : 'dead', g: a.grounded ? 1 : 0, sw: a.swimming ? 1 : 0,
      dv: r2(a.dive || 0), dn: a.dancing ? 1 : 0, yaw: r2(it.yaw), pitch: r2(it.pitch), mx: it.moveX, mz: it.moveZ,
      c: it.crouch ? 1 : 0, s: it.sprint ? 1 : 0, ads: it.ads ? 1 : 0, fire: it.fire ? 1 : 0, fp: e.fp, rl: e.rl, it: e.it,
      dr: e.dr, ed: e.ed, sel: e.sel, fall: r2(e.fall), bmo: it.buildMode ? 1 : 0, pl: it.place ? 1 : 0, bs: it.buildSlot,
      bk: it.buildKind, bm: it.buildMat, ao: it.aimOrigin ? v3(it.aimOrigin) : null, ad: it.aimDir ? v3(it.aimDir) : null,
    });
    this.edges = this.freshEdges();
    it.interact = false;
  }

  // Edge-triggered client actions that are not part of the intent.
  clientAction(kind, value) {
    if (kind === 'drop') this.edges.dr = 1;
    else if (kind === 'edit') this.edges.ed = value;
    else if (kind === 'select') { this.edges.sel = value; this.pendingSel = value; this.pendingSelT = performance.now(); }
    else if (kind === 'fall') this.edges.fall += value;
  }
}

export { MODES, v3, toV };
