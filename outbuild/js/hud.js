// In-match HUD (DOM) plus the minimap and full map drawn on canvases.
import * as THREE from 'three';
import { RARITIES, MATS, WORLD, BUILD_COST, STORM } from './config.js';
import { WEAPONS, CONSUMABLES, AMMO, itemName } from './items.js';
import { POIS } from './layout.js';
import { formatTime, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

const PIECE_ICONS = {
  wall: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5"/></svg>',
  floor: '<svg viewBox="0 0 24 24"><path d="M3 15l9-5 9 5-9 5z"/></svg>',
  ramp: '<svg viewBox="0 0 24 24"><path d="M4 19h16V6z"/></svg>',
  cone: '<svg viewBox="0 0 24 24"><path d="M12 5l9 13H3z"/></svg>',
};
const MAT_ICONS = {
  wood: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="4" rx="1"/><rect x="3" y="11" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="3" rx="1"/></svg>',
  stone: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="6" rx="1"/><rect x="13" y="5" width="8" height="6" rx="1"/><rect x="7" y="13" width="10" height="6" rx="1"/></svg>',
  metal: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="7.5" cy="7.5" r="1.2" fill="#0006"/><circle cx="16.5" cy="7.5" r="1.2" fill="#0006"/><circle cx="7.5" cy="16.5" r="1.2" fill="#0006"/><circle cx="16.5" cy="16.5" r="1.2" fill="#0006"/></svg>',
};

export class Hud {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.icons = {};
    this.feed = [];
    this.numbers = [];
    this.msgT = 0;
    this.hitT = 0;
    this.lastHp = -1;
    this.mapImg = null;
    this.mini = $('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.big = $('bigmap');
    this.bigCtx = this.big.getContext('2d');
    this.slotEls = [...document.querySelectorAll('#hotbar .slot')];
    this.buildEls = [...document.querySelectorAll('#buildbar .piece')];
    this.buildEls.forEach((el) => { el.querySelector('.ico').innerHTML = PIECE_ICONS[el.dataset.kind]; });
    for (const m of ['wood', 'stone', 'metal']) $('mat-' + m).querySelector('.ico').innerHTML = MAT_ICONS[m];
    this._v = new THREE.Vector3();
  }

  show(on) { this.root.hidden = !on; }

  // ------------------------------------------------------------------ icons (rendered from the 3D models)
  renderIcons(renderer, assets) {
    const r = renderer.renderer;
    const size = 128;
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.environment = renderer.scene.environment;
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(2, 3, 4);
    scene.add(key, new THREE.AmbientLight(0xffffff, 0.8));
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    const buf = new Uint8Array(size * size * 4);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const names = [...Object.values(WEAPONS).map((w) => w.model), 'W_Pickaxe', ...Object.values(CONSUMABLES).map((c) => c.model),
      ...Object.values(AMMO).map((a) => a.model)];
    const prevTM = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    for (const name of names) {
      if (!assets.has(name)) continue;
      const obj = assets.instance(name, { shadows: false });
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const isGun = name.startsWith('W_') && name !== 'W_Pickaxe';
      const pivot = new THREE.Group();
      obj.position.sub(c);
      pivot.add(obj);
      // guns side-on with the barrel pointing right, other things at three-quarters
      if (isGun) pivot.rotation.set(0, -Math.PI / 2, 0);
      else if (name === 'W_Pickaxe') pivot.rotation.set(0, -Math.PI / 2, -0.6);
      else pivot.rotation.set(0.35, 0.6, 0);
      scene.add(pivot);
      const radius = Math.max(s.x, s.y, s.z) * 0.62;
      cam.position.set(0, 0, radius / Math.tan(THREE.MathUtils.degToRad(15)));
      cam.lookAt(0, 0, 0);
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      for (let y = 0; y < size; y++) {
        img.data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      }
      ctx.putImageData(img, 0, 0);
      this.icons[name] = canvas.toDataURL();
      scene.remove(pivot);
    }
    r.setRenderTarget(null);
    r.toneMapping = prevTM;
    r.setClearColor(0x000000, 1);
    rt.dispose();
  }

  iconFor(item) {
    if (!item) return this.icons.W_Pickaxe;
    if (item.type === 'weapon') return this.icons[WEAPONS[item.id].model];
    if (item.type === 'consumable') return this.icons[CONSUMABLES[item.id].model];
    if (item.type === 'ammo') return this.icons[AMMO[item.id].model];
    return null;
  }

  // ------------------------------------------------------------------ map image
  // Map image of the square of `view` metres around the centre (the whole island, or just the duel island).
  buildMap(terrain, pieces, view = WORLD.size) {
    const N = 512;
    this.mapSize = view;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    const cell = view / N;
    const half = view / 2;
    const mcell = WORLD.size / 512, mhalf = WORLD.size / 2;
    const nrm = new THREE.Vector3();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
        const h = terrain.heightAt(x, z);
        let col;
        if (h < 0) {
          const d = clamp(-h / 12, 0, 1);
          col = [60 - d * 30, 170 - d * 70, 200 - d * 40];
        } else {
          const mi = Math.floor((x + mhalf) / mcell), mj = Math.floor((z + mhalf) / mcell);
          const k = mj * 512 + mi;
          const road = terrain.roadMask[k] || 0;
          const flat = terrain.flatMask[k] || 0;
          if (h < 1.8) col = [226, 208, 158];
          else if (h > 52) col = [150, 148, 140];
          else col = [96 + h * 0.6, 160 - h * 0.4, 70];
          if (road > 0.3 || flat > 0.5) col = [176, 150, 116];
          terrain.normalAt(x, z, nrm);
          if (1 - nrm.y > 0.35) col = [130, 128, 122];
          const shade = clamp(0.75 + (nrm.x * -0.6 + nrm.z * -0.4) * 1.2, 0.5, 1.2);
          col = col.map((v) => v * shade);
        }
        const o = (j * N + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // buildings
    ctx.fillStyle = 'rgba(70,64,72,0.85)';
    for (const p of pieces.pieces.values()) {
      if (p.kind !== 'floor') continue;
      const x = (p.ix * 4 + half) / cell, z = (p.iz * 4 + half) / cell;
      ctx.fillRect(x, z, 4 / cell + 0.5, 4 / cell + 0.5);
    }
    this.mapImg = c;
  }

  // ------------------------------------------------------------------ frame update
  update(dt) {
    const g = this.game;
    const a = g.player;
    if (!a) return;
    // health & shield
    const hp = Math.ceil(a.health), sh = Math.ceil(a.shield);
    $('hp-fill').style.width = `${a.health}%`;
    $('sh-fill').style.width = `${a.shield}%`;
    $('hp-num').textContent = hp;
    $('sh-num').textContent = sh;
    if (hp < this.lastHp) { $('hp-bar').classList.remove('flash'); void $('hp-bar').offsetWidth; $('hp-bar').classList.add('flash'); }
    this.lastHp = hp;
    // info
    $('alive').textContent = g.aliveCount();
    $('kills').textContent = a.kills;
    const st = g.storm.status();
    $('storm-label').textContent = st.label;
    $('storm-time').textContent = st.time > 0 ? formatTime(st.time) : '';
    // hotbar
    const inv = a.inv;
    this.slotEls.forEach((el, i) => {
      const item = i === 0 ? null : inv.slots[i - 1];
      const sel = !a.buildMode && ((i === 0 && inv.selected === -1) || inv.selected === i - 1);
      el.classList.toggle('sel', sel);
      const sig = i === 0 ? 'pick' : item ? `${item.type}:${item.id}:${item.rarity}:${item.count ?? ''}:${item.mag ?? ''}` : 'empty';
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        const icon = i === 0 ? this.icons.W_Pickaxe : item ? this.iconFor(item) : null;
        el.querySelector('.ico').style.backgroundImage = icon ? `url(${icon})` : 'none';
        const r = item && item.type === 'weapon' ? RARITIES[item.rarity] : null;
        el.style.setProperty('--rar', r ? r.color : item ? '#4ab0e6' : 'transparent');
        el.classList.toggle('has', !!item || i === 0);
        el.querySelector('.cnt').textContent = item ? (item.type === 'weapon' ? item.mag : `×${item.count}`) : '';
      }
    });
    // weapon info
    const cur = a.current();
    if (a.buildMode) {
      $('weapon-name').textContent = 'Build';
      $('weapon-ammo').textContent = `${a.inv.mats[g.controller.buildMat]} ${MATS[g.controller.buildMat].label}`;
    } else if (cur && cur.type === 'weapon') {
      const def = WEAPONS[cur.id];
      $('weapon-name').textContent = `${RARITIES[cur.rarity].label} ${def.name}`;
      $('weapon-name').style.color = RARITIES[cur.rarity].color;
      $('weapon-ammo').textContent = `${cur.mag} / ${inv.ammo[def.ammo]}`;
    } else if (cur && cur.type === 'consumable') {
      $('weapon-name').textContent = CONSUMABLES[cur.id].name;
      $('weapon-name').style.color = '#9fdcff';
      $('weapon-ammo').textContent = `×${cur.count}`;
    } else {
      $('weapon-name').textContent = 'Harvesting Tool';
      $('weapon-name').style.color = '#e8e8e8';
      $('weapon-ammo').textContent = '';
    }
    // mats
    for (const m of ['wood', 'stone', 'metal']) {
      const el = $('mat-' + m);
      el.querySelector('.num').textContent = inv.mats[m];
      el.classList.toggle('sel', g.controller.buildMat === m);
    }
    // build bar takes the hotbar's place while building
    $('buildbar').classList.toggle('on', a.buildMode);
    $('hud').classList.toggle('building', !!a.buildMode);
    this.updateWhere(dt);
    this.updateSquad();
    this.buildEls.forEach((el) => {
      el.classList.toggle('sel', el.dataset.kind === g.controller.buildKind);
      el.classList.toggle('poor', inv.mats[g.controller.buildMat] < BUILD_COST);
    });
    // progress ring (reload / heal)
    let prog = 0, progLabel = '';
    if (a.reloadT > 0) { prog = 1 - a.reloadT / a.reloadTotal; progLabel = 'Reloading'; }
    if (a.useT > 0) { prog = a.useT / a.useTotal; progLabel = cur ? CONSUMABLES[cur.id]?.name || '' : ''; }
    $('progress').hidden = prog <= 0;
    if (prog > 0) {
      $('progress-ring').style.setProperty('--p', prog);
      $('progress-label').textContent = progLabel;
    }
    // crosshair spread
    let spread = 0.02;
    if (cur && cur.type === 'weapon') spread = g.combat.spreadFor(a, WEAPONS[cur.id]);
    const px = clamp(spread / Math.tan(THREE.MathUtils.degToRad(g.camera.fov / 2)) * window.innerHeight / 2, 4, 90);
    $('crosshair').style.setProperty('--gap', `${px}px`);
    $('crosshair').classList.toggle('build', a.buildMode);
    $('crosshair').hidden = g.controller.scope || a.mode === 'bus';
    // hit marker
    this.hitT = Math.max(0, this.hitT - dt);
    $('hitmarker').style.opacity = this.hitT > 0 ? 1 : 0;
    // prompt
    this.updatePrompt();
    // messages
    this.msgT -= dt;
    if (this.msgT <= 0) $('announce').classList.remove('on');
    this.updateNumbers(dt);
    this.updateFeed(dt);
    this.drawMinimap();
    this.drawCompass();
    if (g.mapOpen) this.drawBigMap();
    // storm warning edge + sky-dive speed lines
    $('speedlines').classList.toggle('on', a.mode === 'sky' && (a.dive || 0) > 0.4);
    $('jump-hint').hidden = a.mode !== 'bus';
    if (a.mode === 'bus') $('jump-hint').innerHTML = g.airship.canDrop ? '<kbd>Space</kbd> Jump' : 'You can jump once the airship is over the island';
    const inStorm = a.alive && a.mode === 'ground' && g.storm.isOutside(a.pos.x, a.pos.z);
    $('storm-warn').hidden = !inStorm;
    if (inStorm) {
      const d = Math.max(0, Math.round(g.storm.distOutside(a.pos.x, a.pos.z)));
      $('storm-dist').textContent = `Safe zone ${d} m away`;
    }
    const spec = !a.alive && g.spectating && g.spectating.alive && $('death').hidden;
    $('spectate').hidden = !spec;
    if (spec) $('spectate-name').textContent = g.spectating.name;
    $('glide-hint').hidden = !(a.mode === 'sky' && a.pos.y - g.terrain.heightAt(a.pos.x, a.pos.z) < 150);
  }

  // Name of the place you're in, under the minimap.
  updateWhere(dt) {
    this.whereT = (this.whereT || 0) - dt;
    if (this.whereT > 0) return;
    this.whereT = 0.5;
    const g = this.game;
    const a = g.player;
    const x = a.mode === 'bus' ? g.airship.pos.x : a.pos.x, z = a.mode === 'bus' ? g.airship.pos.z : a.pos.z;
    let name = '';
    let best = Infinity;
    for (const p of g.terrain.pois || POIS) {
      const d = Math.hypot(p.x - x, p.z - z) - (p.flat || p.lake || 30);
      if (d < 35 && d < best) { best = d; name = p.name; }
    }
    if (!name && g.mapKey === 'duel') name = 'Duel Grounds';
    if ($('where').textContent !== name) $('where').textContent = name;
  }

  // Your friends (online) with their shield and health.
  updateSquad() {
    const g = this.game;
    const el = $('squad');
    const list = g.net && g.net.active ? g.actors.filter((x) => x.human && x !== g.player) : [];
    const sig = list.map((x) => `${x.id}:${x.alive ? 1 : 0}:${Math.ceil(x.health)}:${Math.ceil(x.shield)}`).join('|');
    if (sig === this.squadSig) return;
    this.squadSig = sig;
    el.innerHTML = '';
    for (const x of list) {
      const d = document.createElement('div');
      d.className = 'sq' + (x.alive ? '' : ' dead');
      const n = document.createElement('span');
      n.textContent = x.name;
      d.appendChild(n);
      for (const [cls, v] of [['s', x.shield], ['h', x.health]]) {
        const i = document.createElement('i');
        i.className = cls;
        const b = document.createElement('b');
        b.style.width = `${x.alive ? Math.max(0, Math.min(100, v)) : 0}%`;
        i.appendChild(b);
        d.appendChild(i);
      }
      el.appendChild(d);
    }
  }

  updatePrompt() {
    const g = this.game;
    const a = g.player;
    const el = $('prompt');
    const t = g.interactTarget(a);
    if (!t && !a.buildMode && g.controller.editPiece && a.mode === 'ground') {
      el.hidden = false;
      const p = g.controller.editPiece;
      const what = p.kind === 'ramp' ? 'Turn ramp' : { null: 'Add window', bwindow: 'Make door', bdoor: 'Close wall' }[p.opening];
      el.innerHTML = `<kbd>F</kbd> ${what}`;
      return;
    }
    if (!t || a.mode !== 'ground' || a.buildMode) { el.hidden = true; return; }
    el.hidden = false;
    if (t.kind === 'container') {
      el.innerHTML = `<kbd>E</kbd> ${t.obj.kind === 'chest' ? 'Open chest' : t.obj.kind === 'supply' ? 'Open supply drop' : 'Open ammo box'}`;
      el.style.removeProperty('--rar');
    } else {
      const it = t.obj.item;
      const r = it.type === 'weapon' ? RARITIES[it.rarity] : null;
      const icon = this.iconFor(it);
      const full = !a.inv.hasRoomFor(it) && a.inv.selected < 0;
      el.innerHTML = `${icon ? `<span class="pico" style="background-image:url(${icon})"></span>` : ''}
        <span class="pname" style="color:${r ? r.color : '#fff'}">${r ? r.label + ' ' : ''}${itemName(it)}${it.count && it.type !== 'weapon' ? ' ×' + it.count : ''}</span>
        <span class="pkey">${full ? 'Select a slot to swap' : '<kbd>E</kbd> Pick up'}</span>`;
    }
  }

  // ------------------------------------------------------------------ events
  hitMarker(head) {
    this.hitT = 0.18;
    $('hitmarker').classList.toggle('head', head);
  }

  damageNumber(pos, amount, head, shield) {
    const el = document.createElement('div');
    el.className = 'dmg' + (head ? ' head' : '') + (shield ? ' shield' : '');
    el.textContent = amount;
    $('numbers').appendChild(el);
    this.numbers.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5)),
      t: 0, vx: (Math.random() - 0.5) * 40 });
  }

  updateNumbers(dt) {
    const cam = this.game.camera;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      if (n.t > 0.9) { n.el.remove(); this.numbers.splice(i, 1); continue; }
      const p = this._v.copy(n.pos).project(cam);
      if (p.z > 1) { n.el.style.opacity = 0; continue; }
      const x = (p.x * 0.5 + 0.5) * window.innerWidth + n.vx * n.t;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight - n.t * 60;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${n.t < 0.1 ? 1.4 - n.t * 4 : 1})`;
      n.el.style.opacity = n.t > 0.6 ? (0.9 - n.t) / 0.3 : 1;
    }
  }

  killFeed(html) {
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.innerHTML = html;
    $('killfeed').prepend(el);
    this.feed.push({ el, t: 0 });
    while (this.feed.length > 6) this.feed.shift().el.remove();
  }

  updateFeed(dt) {
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t += dt;
      if (f.t > 7) { f.el.remove(); this.feed.splice(i, 1); }
      else if (f.t > 6) f.el.style.opacity = 7 - f.t;
    }
  }

  announce(text, sub = '', time = 3.5, kind = '') {
    const el = $('announce');
    el.className = 'on ' + kind;
    $('announce-text').textContent = text;
    $('announce-sub').textContent = sub;
    this.msgT = time;
  }

  // Red arc toward whoever hit us.
  damageFrom(srcPos, victim) {
    const rig = this.game.rig;
    const ang = Math.atan2(srcPos.x - victim.pos.x, srcPos.z - victim.pos.z) - rig.yaw;
    const el = document.createElement('div');
    el.className = 'dmgdir';
    el.style.transform = `rotate(${-ang}rad)`;
    $('dmgdirs').appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  matGain(mat, amount) {
    const el = document.createElement('div');
    el.className = 'matgain ' + mat;
    el.textContent = `+${amount}`;
    $('matgains').appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  elimBanner(name) {
    const el = $('elim');
    el.textContent = `Eliminated ${name}`;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  // ------------------------------------------------------------------ compass
  drawCompass() {
    const g = this.game;
    const strip = $('compass-strip');
    const W = $('compass').clientWidth;
    const yaw = g.rig.yaw;
    // heading in degrees, 0 = north (-Z), clockwise
    const heading = ((Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) * 180 / Math.PI) + 360) % 360;
    const pxPerDeg = W / 120;
    const parts = [];
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -60; d <= 60; d += 5) {
      const deg = Math.round((heading + d) / 5) * 5;
      const off = deg - heading;
      const x = W / 2 + off * pxPerDeg;
      const n = ((deg % 360) + 360) % 360;
      if (labels[n] !== undefined) parts.push(`<span class="major" style="left:${x}px">${labels[n]}</span>`);
      else if (n % 15 === 0) parts.push(`<span class="tick" style="left:${x}px">${n}</span>`);
    }
    const a = g.player;
    const bearing = (tx, tz) => {
      const b = (Math.atan2(tx - a.pos.x, -(tz - a.pos.z)) * 180 / Math.PI + 360) % 360;
      let off = b - heading;
      if (off > 180) off -= 360;
      if (off < -180) off += 360;
      return off;
    };
    if (g.marker) {
      const off = bearing(g.marker.x, g.marker.z);
      if (Math.abs(off) < 60) parts.push(`<span class="mark" style="left:${W / 2 + off * pxPerDeg}px">&#9660;</span>`);
    }
    const s = g.storm;
    if (s.state !== 'idle' && s.state !== 'pre' && s.distOutside(a.pos.x, a.pos.z) > -20) {
      const off = bearing(s.next.c.x, s.next.c.y);
      if (Math.abs(off) < 60) parts.push(`<span class="storm" style="left:${W / 2 + off * pxPerDeg}px">&#9679;</span>`);
    }
    strip.innerHTML = parts.join('');
  }

  // ------------------------------------------------------------------ maps
  worldToMap(x, z, size, cx = 0, cz = 0, scale = 1) {
    return [(x - cx) * scale + size / 2, (z - cz) * scale + size / 2];
  }

  drawCircles(ctx, map) {
    const s = this.game.storm;
    if (s.state === 'idle') return;
    // storm outside the current circle
    const [cx, cy] = map(s.center.x, s.center.y);
    const r = s.radius * map.scale;
    ctx.save();
    ctx.fillStyle = 'rgba(120, 40, 200, 0.38)';
    ctx.beginPath();
    ctx.rect(-10, -10, 4000, 4000);
    ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,120,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
    ctx.stroke();
    if (s.state === 'wait' || s.state === 'shrink' || s.state === 'pre') {
      const [nx, ny] = map(s.next.c.x, s.next.c.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, s.next.r * map.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawPlayer(ctx, x, y, yaw, size = 9) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-yaw + Math.PI);
    ctx.fillStyle = '#ffe14d';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.7, size * 0.8);
    ctx.lineTo(0, size * 0.4);
    ctx.lineTo(-size * 0.7, size * 0.8);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  drawMinimap() {
    const g = this.game;
    const a = g.player;
    const ctx = this.miniCtx;
    const S = this.mini.width;
    const scale = (this.mapSize || WORLD.size) < 500 ? 2.2 : 1.25; // pixels per metre
    const cx = a.mode === 'bus' ? g.airship.pos.x : a.pos.x, cz = a.mode === 'bus' ? g.airship.pos.z : a.pos.z;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    ctx.fillStyle = '#2a6f9a';
    ctx.fillRect(0, 0, S, S);
    if (this.mapImg) {
      const M = this.mapSize || WORLD.size;
      const px = this.mapImg.width / M; // map px per metre
      const sw = S / scale * px;
      const sx = (cx + M / 2) * px - sw / 2, sy = (cz + M / 2) * px - sw / 2;
      ctx.drawImage(this.mapImg, sx, sy, sw, sw, 0, 0, S, S);
    }
    const map = (x, z) => [(x - cx) * scale + S / 2, (z - cz) * scale + S / 2];
    map.scale = scale;
    this.drawCircles(ctx, map);
    // airship route
    if (g.airship && g.airship.active) this.drawRoute(ctx, map);
    this.drawDrops(ctx, map);
    if (g.marker) {
      const [mx, my] = map(g.marker.x, g.marker.z);
      ctx.fillStyle = '#ffe14d';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    const [px, py] = map(a.pos.x, a.pos.z);
    this.drawPlayer(ctx, px, py, a.mode === 'bus' ? g.rig.yaw : g.rig.yaw);
    ctx.restore();
    // compass letters
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px Chakra Petch, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 12);
  }

  drawDrops(ctx, map) {
    for (const d of this.game.drops || []) {
      if (d.container && d.container.opened) continue;
      const [x, y] = map(d.x, d.z);
      ctx.fillStyle = '#3d9bff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
  }

  drawRoute(ctx, map) {
    const [a, b] = this.game.airship.route();
    const [x0, y0] = map(a.x, a.z), [x1, y1] = map(b.x, b.z);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    const p = this.game.airship.pos;
    const [sx, sy] = map(p.x, p.z);
    ctx.fillStyle = '#ff7a4a';
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBigMap() {
    const g = this.game;
    const ctx = this.bigCtx;
    const S = Math.min(window.innerWidth, window.innerHeight) * 0.86 | 0;
    if (this.big.width !== S) { this.big.width = S; this.big.height = S; }
    ctx.clearRect(0, 0, S, S);
    if (this.mapImg) ctx.drawImage(this.mapImg, 0, 0, S, S);
    const M = this.mapSize || WORLD.size;
    const scale = S / M;
    const map = (x, z) => [(x + M / 2) * scale, (z + M / 2) * scale];
    map.scale = scale;
    // grid
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * S / 8, 0); ctx.lineTo(i * S / 8, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * S / 8); ctx.lineTo(S, i * S / 8); ctx.stroke();
    }
    this.drawCircles(ctx, map);
    if (g.airship && g.airship.active) this.drawRoute(ctx, map);
    // place names
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(11, S / 60) | 0}px Chakra Petch, sans-serif`;
    for (const p of g.terrain.pois || POIS) {
      const [x, y] = map(p.x, p.z);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(p.name.toUpperCase(), x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name.toUpperCase(), x, y);
    }
    this.drawDrops(ctx, map);
    if (g.marker) {
      const [mx, my] = map(g.marker.x, g.marker.z);
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill();
    }
    const a = g.player;
    const [px, py] = map(a.mode === 'bus' ? g.airship.pos.x : a.pos.x, a.mode === 'bus' ? g.airship.pos.z : a.pos.z);
    this.drawPlayer(ctx, px, py, g.rig.yaw, 11);
  }
}

export { STORM };
