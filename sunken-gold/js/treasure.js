// Everything worth picking up: coin piles, pearls in giant clams, chests,
// artifacts, the five relics, spare air tanks and bubbling air vents.
import * as THREE from 'three';
import { VALUES } from './config.js';
import { patchMaterial } from './ocean.js';

const tmp = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();

const GEM_COLORS = ['#d01f3c', '#18b56a', '#2340c8', '#a23bd6'];

function glintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.15, 'rgba(255,230,150,0.8)');
  grd.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,250,230,0.9)';
  g.fillRect(30, 2, 4, 60);
  g.fillRect(2, 30, 60, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Treasure {
  constructor(scene, assets, seabed, save) {
    const { world, models } = assets;
    const W = world.treasure;
    this.scene = scene;
    this.seabed = seabed;
    this.save = save;
    this.items = [];          // interactables: { kind, pos, value, obj, id, ... }
    this.glintTex = glintTexture();

    // ---- coins: one instanced mesh for every doubloon
    const coinSrc = models.coin;
    const coinMeshes = [];
    coinSrc.traverse((o) => { if (o.isMesh) coinMeshes.push(o); });
    const total = W.coins.reduce((s, c) => s + c[3], 0);
    this.coinMesh = new THREE.InstancedMesh(coinMeshes[0].geometry, coinMeshes[0].material, total);
    this.coinMesh.castShadow = false;
    this.coinMesh.frustumCulled = false;
    scene.add(this.coinMesh);
    this.coinPiles = [];
    let k = 0;
    W.coins.forEach(([x, y, z, count], i) => {
      const coins = [];
      for (let c = 0; c < count; c++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.35;
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
        const ground = Math.abs(y - seabed.heightAt(x, z)) < 0.5 ? seabed.heightAt(cx, cz) : y;
        coins.push({ i: k++, home: new THREE.Vector3(cx, ground + 0.006 + c * 0.004, cz),
          rot: new THREE.Euler((Math.random() - 0.5) * 0.4, Math.random() * 6.3, (Math.random() - 0.5) * 0.4), fly: -1, p: new THREE.Vector3() });
      }
      this.coinPiles.push({ id: `c${i}`, center: new THREE.Vector3(x, y + 0.1, z), coins, taken: false, glint: this.glint(new THREE.Vector3(x, y + 0.15, z), 0.5) });
    });

    // ---- clams with pearls
    W.clams.forEach(([x, y, z], i) => {
      const obj = models.clam.clone();
      obj.position.set(x, y - 0.05, z);
      obj.rotation.y = Math.random() * 6.28;
      obj.scale.setScalar(1.2);
      const n = seabed.normalAt(x, z);
      obj.quaternion.premultiply(tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize()));
      scene.add(obj);
      const top = obj.getObjectByName('clam_top');
      const pearl = obj.getObjectByName('pearl');
      this.items.push({ kind: 'pearl', id: `p${i}`, pos: new THREE.Vector3(x, y + 0.15, z), value: VALUES.pearl, obj, top, pearl,
        phase: Math.random() * 10, open: 0, has: true, radius: 2.2 });
    });

    // ---- chests
    W.chests.forEach(([x, y, z], i) => {
      const obj = models.chest.clone();
      obj.position.set(x, y, z);
      obj.rotation.y = i < 2 ? new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(world.wreck.quat), 'YXZ').y + Math.PI / 2 : Math.random() * 6.28;
      if (i >= 2) {
        const n = seabed.normalAt(x, z);
        obj.quaternion.premultiply(tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize()));
        obj.position.y -= 0.08;
      }
      scene.add(obj);
      const lid = obj.getObjectByName('chest_lid');
      const pile = obj.getObjectByName('gold_pile');
      const it = { kind: 'chest', id: `h${i}`, pos: new THREE.Vector3(x, y + 0.4, z), value: VALUES.chest, obj, lid, pile, radius: 2.4, hold: 1.3, progress: 0 };
      this.items.push(it);
    });

    // ---- artifacts
    W.artifacts.forEach((a, i) => {
      const obj = models[a.kind].clone();
      obj.position.fromArray(a.pos);
      obj.rotation.y = a.yaw;
      if (a.kind === 'amphora') {
        obj.rotation.set(Math.PI / 2 - 0.25, a.yaw, 0, 'YXZ');
        obj.position.y += 0.1;
      } else if (a.kind === 'goblet') {
        obj.rotation.set(Math.random() < 0.5 ? Math.PI / 2 : 0, a.yaw, 0, 'YXZ');
        obj.position.y += obj.rotation.x ? 0.07 : 0;
      } else if (a.kind === 'gem') {
        obj.scale.setScalar(1.3);
        obj.position.y += 0.06;
        const c = GEM_COLORS[i % GEM_COLORS.length];
        obj.traverse((o) => {
          if (o.isMesh) {
            o.material = o.material.clone();
            o.material.color.set(c);
            o.material.emissive.set(c).multiplyScalar(0.35);
            patchMaterial(o.material, { key: 'gem' });
          }
        });
      }
      scene.add(obj);
      this.items.push({ kind: a.kind, id: `a${i}`, pos: new THREE.Vector3().fromArray(a.pos).add(new THREE.Vector3(0, 0.15, 0)), value: VALUES[a.kind], obj,
        radius: 2.2, glint: a.kind !== 'amphora' ? this.glint(new THREE.Vector3().fromArray(a.pos).add(new THREE.Vector3(0, 0.2, 0)), 0.45) : null });
    });

    // ---- relics: slowly turning, with a soft halo
    W.relics.forEach((r) => {
      const obj = models[r.model].clone();
      obj.position.fromArray(r.pos);
      obj.scale.setScalar(r.id === 'trident' ? 1.2 : 1.8);
      scene.add(obj);
      const halo = this.glint(new THREE.Vector3().fromArray(r.pos).add(new THREE.Vector3(0, 0.5, 0)), 2.6, 1.0);
      this.items.push({ kind: 'relic', id: r.id, name: r.name, hint: r.hint, pos: new THREE.Vector3().fromArray(r.pos).add(new THREE.Vector3(0, 0.3, 0)),
        value: VALUES.relic, obj, base: obj.position.clone(), radius: 2.6, glint: halo, spin: Math.random() * 6 });
    });

    // ---- spare air tanks
    this.tanks = W.tanks.map((p, i) => {
      const obj = models.air_tank.clone();
      obj.position.fromArray(p);
      obj.rotation.set(Math.PI / 2, Math.random() * 6.28, 0.1, 'YXZ');
      obj.position.y += 0.1;
      scene.add(obj);
      return { id: `t${i}`, pos: new THREE.Vector3().fromArray(p).add(new THREE.Vector3(0, 0.2, 0)), obj, taken: false, glint: this.glint(new THREE.Vector3().fromArray(p).add(new THREE.Vector3(0, 0.3, 0)), 0.6, 0.6, '#9fe8ff') };
    });

    // ---- air vents: just positions, the bubbles are drawn by the bubble system
    this.vents = W.vents.map((p) => new THREE.Vector3().fromArray(p));
    this.resetDive();
  }

  glint(pos, size, strength = 0.6, color = '#ffe6a0') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glintTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.userData.strength = strength;
    s.userData.phase = Math.random() * 10;
    s.renderOrder = 9;
    this.scene.add(s);
    return s;
  }

  // Called at the start of each dive: coins and tanks come back, pearls regrow
  // slowly, chests, artifacts and relics stay taken.
  resetDive() {
    const taken = this.save.taken;
    for (const pile of this.coinPiles) {
      pile.taken = false;
      for (const c of pile.coins) { c.fly = -1; c.p.copy(c.home); }
      pile.glint.visible = true;
    }
    for (const t of this.tanks) { t.taken = false; t.obj.visible = true; t.glint.visible = true; }
    for (const it of this.items) {
      it.taken = !!taken[it.id] && (it.kind !== 'pearl' || this.save.dives - taken[it.id] < 3);
      if (it.kind === 'pearl') { it.has = !it.taken; it.pearl.visible = it.has; continue; }
      if (it.kind === 'chest') {
        it.lid.rotation.x = it.taken ? -1.9 : 0;
        it.pile.visible = !it.taken;
        it.progress = 0;
        continue;
      }
      it.obj.visible = !it.taken;
      if (it.glint) it.glint.visible = !it.taken;
    }
    this.syncCoins(0);
  }

  syncCoins(t) {
    for (const pile of this.coinPiles) {
      for (const c of pile.coins) {
        if (c.fly >= 99) tmpS.setScalar(0);
        else tmpS.setScalar(1);
        tmpQ.setFromEuler(c.rot);
        if (c.fly >= 0 && c.fly < 99) tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 12 + c.i));
        tmpM.compose(c.p, tmpQ, tmpS);
        this.coinMesh.setMatrixAt(c.i, tmpM);
      }
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  // Per-frame: animations, automatic pickups (coins, tanks, vents).
  // Returns events for the game: [{ type, value, ... }]
  update(dt, t, player, magnet) {
    const events = [];
    const eye = player.pos;
    // Coin piles: inside the magnet radius the coins fly to you one by one.
    for (const pile of this.coinPiles) {
      if (pile.taken) continue;
      const d = pile.center.distanceTo(eye);
      if (d < magnet) {
        pile.taken = true;
        pile.glint.visible = false;
        pile.coins.forEach((c, j) => { c.fly = -j * 0.05; });
      }
    }
    let flying = false;
    for (const pile of this.coinPiles) {
      if (!pile.taken) continue;
      for (const c of pile.coins) {
        if (c.fly >= 99) continue;
        c.fly += dt;
        if (c.fly < 0) continue;
        flying = true;
        const target = tmp.copy(eye).add(new THREE.Vector3(0, -0.35, 0));
        c.p.lerp(target, Math.min(1, dt * (3 + c.fly * 10)));
        if (c.p.distanceTo(target) < 0.25 || c.fly > 2) {
          c.fly = 99;
          events.push({ type: 'coin', value: VALUES.coin });
        }
      }
    }
    if (flying || t < 0.1) this.syncCoins(t);

    // Tanks.
    for (const tk of this.tanks) {
      if (tk.taken) continue;
      tk.obj.rotation.y += dt * 0.3;
      if (tk.pos.distanceTo(eye) < 1.5) {
        tk.taken = true;
        tk.obj.visible = false;
        tk.glint.visible = false;
        events.push({ type: 'tank' });
      }
    }

    // Clams breathe open and shut; relics turn; glints twinkle.
    for (const it of this.items) {
      if (it.kind === 'pearl') {
        const cyc = (t + it.phase) % 9;
        const near = it.pos.distanceTo(eye) < 1.6;
        const want = near && it.open < 0.2 ? 0 : (cyc < 5.5 ? 1 : 0);   // snaps shut if you crowd it
        it.open += (want - it.open) * Math.min(1, dt * (want ? 0.8 : 3));
        it.top.rotation.x = -it.open * 0.75;
      } else if (it.kind === 'relic' && !it.taken) {
        it.spin += dt * 0.6;
        if (it.id === 'trident') {
          it.obj.rotation.set(0.35, 0.8, 0.25);        // stuck in the sand at an angle
        } else {
          it.obj.rotation.y = it.spin;
          it.obj.position.y = it.base.y + 0.08 + Math.sin(t * 1.3) * 0.06;
        }
      } else if (it.kind === 'chest' && it.opening) {
        it.lid.rotation.x += (-1.9 - it.lid.rotation.x) * Math.min(1, dt * 3);
      }
      if (it.glint && it.glint.visible) this.twinkle(it.glint, t, eye);
    }
    for (const pile of this.coinPiles) if (pile.glint.visible) this.twinkle(pile.glint, t, eye);
    for (const tk of this.tanks) if (tk.glint.visible) this.twinkle(tk.glint, t, eye);

    // Vents: hovering in the bubble column refills air.
    let inVent = false;
    for (const v of this.vents) {
      const dx = eye.x - v.x, dz = eye.z - v.z;
      if (dx * dx + dz * dz < 2.2 * 2.2 && eye.y > v.y - 0.5 && eye.y < v.y + 14) inVent = true;
    }
    if (inVent) events.push({ type: 'vent' });
    return events;
  }

  twinkle(s, t, eye) {
    const d = s.position.distanceTo(eye);
    const tw = 0.5 + 0.5 * Math.sin(t * 2.3 + s.userData.phase) * Math.sin(t * 1.7 + s.userData.phase * 2);
    s.material.opacity = s.userData.strength * (0.3 + 0.7 * tw) * THREE.MathUtils.smoothstep(d, 45, 3) * Math.min(1, d / 2);
  }

  // The thing you could grab right now, if any.
  target(player, look) {
    let best = null, bestScore = Infinity;
    for (const it of this.items) {
      if (it.taken) continue;
      if (it.kind === 'pearl' && (!it.has || it.open < 0.6)) {
        if (it.has && it.pos.distanceTo(player.pos) < it.radius) {
          const s = it.pos.distanceTo(player.pos) + 5;
          if (s < bestScore) { bestScore = s; best = it; }
        }
        continue;
      }
      const d = it.pos.distanceTo(player.pos);
      if (d > it.radius) continue;
      tmp.subVectors(it.pos, player.pos).normalize();
      const s = d + (1 - tmp.dot(look)) * 3;
      if (s < bestScore) { bestScore = s; best = it; }
    }
    return best;
  }

  take(it) {
    it.taken = true;
    this.save.taken[it.id] = this.save.dives;
    if (it.kind === 'pearl') {
      it.has = false;
      it.pearl.visible = false;
      it.open = 0;
    } else if (it.kind === 'chest') {
      it.opening = true;
      it.pile.visible = false;
    } else {
      it.obj.visible = false;
    }
    if (it.glint) it.glint.visible = false;
  }

  // Relics still out there, for hints.
  missingRelics() {
    return this.items.filter((it) => it.kind === 'relic' && !this.save.relics.includes(it.id));
  }
}
