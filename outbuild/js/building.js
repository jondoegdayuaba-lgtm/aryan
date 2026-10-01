// Turns an aim ray into a build slot on the grid, shows the preview ghost, and places pieces.
import * as THREE from 'three';
import { GRID, MATS, BUILD_COST } from './config.js';
import { BUILD_MODEL, slotTransform, tileCount } from './pieces.js';
import { clamp } from './util.js';
import { RAMP, RAMP_DIRS } from './physics.js';
export const RAMP_TILE_DIR = { 7: 0, 5: 1, 1: 2, 3: 3 };

const S = GRID.cell;
const H = GRID.level;

export class Building {
  constructor(game) {
    this.game = game;
    this.ghosts = new Map();
    this.ghost = null;
    this.ghostModel = null;
    this.valid = false;
    this.lastPlace = new Map();
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5ab0ff, transparent: true, opacity: 0.35, depthWrite: false,
      fog: false });
    this.ghostEdge = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9 });
  }

  // Slot for a piece kind from an aim ray. Returns {ix, iy, iz, axis|dir} or null.
  target(actor, kind, origin, dir) {
    const g = this.game;
    const eye = actor.eye(new THREE.Vector3());
    const R = GRID.buildRange;
    // point along the ray no further than R from the eye
    const oe = new THREE.Vector3().subVectors(origin, eye);
    const b = dir.dot(oe);
    const c = oe.lengthSq() - R * R;
    const disc = b * b - c;
    let tR = disc > 0 ? -b + Math.sqrt(disc) : 12;
    const hit = g.physics.raycast(origin, dir, tR + 0.1, { shots: false });
    let t = tR;
    if (hit.kind !== 'none') t = Math.min(t, hit.dist - 0.05);
    t = Math.max(t, Math.max(0, -b));
    const P = origin.clone().addScaledVector(dir, t);
    const fx = dir.x, fz = dir.z;
    const pcx = Math.floor(actor.pos.x / S), pcz = Math.floor(actor.pos.z / S);
    let cx = clamp(Math.floor(P.x / S), pcx - 1, pcx + 1);
    let cz = clamp(Math.floor(P.z / S), pcz - 1, pcz + 1);
    const feet = Math.floor((actor.pos.y + 0.25) / H);
    const clampLvl = (v) => clamp(v, feet - 1, feet + 2);
    if (kind === 'wall') {
      const iy = clampLvl(Math.floor((P.y + 0.1) / H));
      const dx = cx - pcx, dz = cz - pcz;
      const alongX = Math.abs(fx) > Math.abs(fz);
      if (dx === 0 && dz === 0) {
        if (alongX) return { ix: pcx + (fx > 0 ? 1 : 0), iy, iz: pcz, axis: 1 };
        return { ix: pcx, iy, iz: pcz + (fz > 0 ? 1 : 0), axis: 0 };
      }
      if (dx !== 0 && (dz === 0 || alongX)) return { ix: dx > 0 ? cx : cx + 1, iy, iz: cz, axis: 1 };
      return { ix: cx, iy, iz: dz > 0 ? cz : cz + 1, axis: 0 };
    }
    if (kind === 'floor') return { ix: cx, iy: clampLvl(Math.floor((P.y + 1.0) / H)), iz: cz };
    if (kind === 'ramp') {
      const dirI = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2);
      // on a ramp going the same way: the next one starts where this one ends
      const gc = actor.groundCollider;
      if (gc && gc.type === RAMP && gc.dir === dirI) {
        const lvl = Math.round(gc.y0 / H);
        const rx = Math.floor((gc.minX + 0.1) / S), rz = Math.floor((gc.minZ + 0.1) / S);
        const d = RAMP_DIRS[dirI];
        return { ix: rx + d[0], iy: lvl + 1, iz: rz + d[1], dir: dirI };
      }
      // otherwise start at our feet (or one up when looking up)
      let iy = Math.floor((actor.pos.y + 0.3) / H);
      if (P.y - actor.pos.y > 3.2) iy++;
      return { ix: cx, iy, iz: cz, dir: dirI };
    }
    return { ix: cx, iy: clampLvl(Math.floor((P.y + 1.2) / H)), iz: cz, dir: 0 };
  }

  canAfford(actor, mat) { return actor.inv.mats[mat] >= BUILD_COST; }

  // The actor's own wall or ramp under the crosshair, within reach.
  editTarget(actor, origin, dir) {
    const g = this.game;
    const ok = (p) => p && p.alive && p.owner === actor && !p.house && (p.kind === 'wall' || p.kind === 'ramp' || p.kind === 'floor');
    const h = g.physics.raycast(origin, dir, 12, { shots: false, terrain: false });
    if (h.kind === 'collider' && h.collider.kind === 'piece' && ok(h.collider.owner) &&
      h.point.distanceTo(actor.eye(new THREE.Vector3())) <= 6) return h.collider.owner;
    // looking through a window or door: use the grid slot the crosshair points at instead
    const ws = this.target(actor, 'wall', origin, dir);
    const w = ws && g.pieces.get('wall', ws);
    if (ok(w)) return w;
    const rs = this.target(actor, 'ramp', origin, dir);
    const r = rs && g.pieces.get('ramp', rs);
    if (ok(r)) return r;
    const fs = this.target(actor, 'floor', origin, dir);
    const f = fs && g.pieces.get('floor', fs);
    return ok(f) ? f : null;
  }

  // Apply an edit: walls and floors get a mask of cut-out tiles, ramps a new direction. Free, own builds only.
  applyEdit(actor, p, { mask, dir } = {}) {
    const g = this.game;
    if (!p || !p.alive || p.owner !== actor || p.house) return null;
    let n = null;
    if (p.kind === 'ramp') {
      if (dir === undefined || dir === null) return null;
      const d = (((dir | 0) % 4) + 4) % 4;
      if (d === (p.dir || 0)) return p;
      n = g.pieces.replace(p, p.model, { dir: d });
    } else if (tileCount(p.kind)) {
      const full = (1 << tileCount(p.kind)) - 1;
      const m = (mask | 0) & full;
      if (m === full) return null;      // something has to stay
      if (m === (p.mask || 0) && !p.opening) return p;
      n = g.pieces.replace(p, BUILD_MODEL(p.kind, p.mat), { mask: m });
    }
    if (n && g.onEdit) g.onEdit(actor, n);
    return n;
  }

  // Quick edit (used by bots): walls cycle solid -> window -> door, ramps turn a quarter.
  edit(actor, p) {
    if (p.kind === 'ramp') return this.applyEdit(actor, p, { dir: (p.dir || 0) + 1 });
    if (p.kind !== 'wall') return null;
    const cycle = [0, 1 << 4, (1 << 1) | (1 << 4)];
    const i = cycle.indexOf(p.mask || 0);
    return this.applyEdit(actor, p, { mask: cycle[(i + 1) % cycle.length] });
  }

  // ------------------------------------------------------------------ edit grid (player only)
  // Which tile of the piece the aim ray points at (-1 for none). Ramps use a 3x3 grid on their slope.
  editHover(p, origin, dir) {
    const S = GRID.cell, H = GRID.level;
    const M = slotTransform(p.kind, p, new THREE.Matrix4());
    let n, p0;
    if (p.kind === 'wall') { n = new THREE.Vector3(0, 0, 1).transformDirection(M); p0 = new THREE.Vector3(0, H / 2, 0).applyMatrix4(M); }
    else if (p.kind === 'floor') { n = new THREE.Vector3(0, 1, 0); p0 = new THREE.Vector3().setFromMatrixPosition(M); }
    else { n = this.rampNormal(p); p0 = new THREE.Vector3(p.ix * S + S / 2, p.iy * H + H / 2, p.iz * S + S / 2); }
    const den = n.dot(dir);
    if (Math.abs(den) < 1e-4) return -1;
    const t = p0.clone().sub(origin).dot(n) / den;
    if (t < 0 || t > 14) return -1;
    const hit = origin.clone().addScaledVector(dir, t);
    if (p.kind === 'ramp') {
      const c = Math.floor((hit.x - p.ix * S) / (S / 3)), r = Math.floor((hit.z - p.iz * S) / (S / 3));
      return c >= 0 && c < 3 && r >= 0 && r < 3 ? r * 3 + c : -1;
    }
    const l = hit.applyMatrix4(M.clone().invert());
    if (p.kind === 'wall') {
      const c = Math.floor((l.x + S / 2) / (S / 3)), r = Math.floor(l.y / (H / 3));
      return c >= 0 && c < 3 && r >= 0 && r < 3 ? r * 3 + c : -1;
    }
    const c = Math.floor((l.x + S / 2) / (S / 2)), r = Math.floor((l.z + S / 2) / (S / 2));
    return c >= 0 && c < 2 && r >= 0 && r < 2 ? r * 2 + c : -1;
  }

  rampNormal(p) {
    const d = RAMP_DIRS[p.dir || 0];
    return new THREE.Vector3(-d[0] * GRID.level, GRID.cell, -d[1] * GRID.level).normalize();
  }

  // Draw the grid: plain tiles blue, the hovered one bright, tiles to cut red; a ramp's edge tiles pick its direction.
  showEditGrid(p, sel, hover, rampDir, viewer) {
    const S = GRID.cell, H = GRID.level;
    if (!this.editGroup) {
      this.editGroup = new THREE.Group();
      this.editTiles = [];
      for (let i = 0; i < 9; i++) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
          new THREE.LineBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.9 }));
        q.add(edge);
        q.renderOrder = 25;
        this.editGroup.add(q);
        this.editTiles.push(q);
      }
      this.game.scene.add(this.editGroup);
    }
    this.editGroup.visible = true;
    const M = slotTransform(p.kind, p, new THREE.Matrix4());
    const n = p.kind === 'wall' ? 9 : p.kind === 'floor' ? 4 : 9;
    for (let i = 0; i < 9; i++) {
      const q = this.editTiles[i];
      q.visible = i < n;
      if (i >= n) continue;
      let pos, normal, w, h;
      if (p.kind === 'wall') {
        const c = i % 3, r = Math.floor(i / 3);
        normal = new THREE.Vector3(0, 0, 1).transformDirection(M);
        pos = new THREE.Vector3(-S / 2 + (c + 0.5) * S / 3, (r + 0.5) * H / 3, 0).applyMatrix4(M);
        if (normal.dot(viewer.clone().sub(pos)) < 0) normal.negate();
        pos.addScaledVector(normal, 0.2);
        w = S / 3 - 0.08; h = H / 3 - 0.08;
      } else if (p.kind === 'floor') {
        const c = i % 2, r = Math.floor(i / 2);
        normal = new THREE.Vector3(0, viewer.y > p.iy * H ? 1 : -1, 0);
        pos = new THREE.Vector3(-S / 4 + c * S / 2, 0, -S / 4 + r * S / 2).applyMatrix4(M).addScaledVector(normal, 0.06);
        w = h = S / 2 - 0.1;
      } else {
        const c = i % 3, r = Math.floor(i / 3);
        normal = this.rampNormal(p);
        const x = p.ix * S + (c + 0.5) * S / 3, z = p.iz * S + (r + 0.5) * S / 3;
        const d = RAMP_DIRS[p.dir || 0];
        const u = ((x - p.ix * S) / S - 0.5) * d[0] + ((z - p.iz * S) / S - 0.5) * d[1] + 0.5;
        pos = new THREE.Vector3(x, p.iy * H + u * H + 0.12, z);
        w = h = S / 3 - 0.12;
      }
      q.position.copy(pos);
      q.scale.set(w, h, 1);
      q.lookAt(pos.clone().add(normal));
      // colour
      let col = 0x5ab0ff, op = 0.28;
      if (p.kind === 'ramp') {
        const dirOf = { 7: 0, 5: 1, 1: 2, 3: 3 }[i];
        if (dirOf === undefined) { col = 0x5ab0ff; op = 0.12; }
        else if (dirOf === rampDir) { col = 0xffd34d; op = 0.6; }
        if (i === hover && dirOf !== undefined) { col = 0xffffff; op = 0.55; }
      } else {
        if (sel & (1 << i)) { col = 0xff4a4a; op = 0.5; }
        if (i === hover) { op += 0.25; if (!(sel & (1 << i))) col = 0xcfeeff; }
      }
      q.material.color.set(col);
      q.material.opacity = op;
    }
  }

  hideEditGrid() { if (this.editGroup) this.editGroup.visible = false; }

  tryPlace(actor, slot, kind, mat) {
    const g = this.game;
    const now = g.time;
    const last = this.lastPlace.get(actor);
    if (last !== undefined && now - last < 0.1) return false;
    if (!this.canAfford(actor, mat)) {
      if (g.onNoMats) g.onNoMats(actor, mat);
      this.lastPlace.set(actor, now);
      return false;
    }
    if (!g.pieces.canPlace(kind, slot)) return false;
    const model = BUILD_MODEL(kind, mat);
    const p = g.pieces.add(model, slot, { build: MATS[mat].buildTime, owner: actor });
    if (!p) return false;
    actor.inv.mats[mat] -= BUILD_COST;
    actor.built++;
    this.lastPlace.set(actor, now);
    if (g.onBuild) g.onBuild(actor, p);
    return true;
  }

  // ------------------------------------------------------------------ preview ghost (player only)
  ghostFor(model) {
    let gh = this.ghosts.get(model);
    if (!gh) {
      const proto = this.game.assets.proto(model);
      gh = new THREE.Group();
      for (const part of proto.parts) {
        const m = new THREE.Mesh(part.geometry, this.ghostMat);
        m.renderOrder = 20;
        gh.add(m);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(part.geometry, 35), this.ghostEdge);
        e.renderOrder = 21;
        gh.add(e);
      }
      gh.visible = false;
      this.game.scene.add(gh);
      this.ghosts.set(model, gh);
    }
    return gh;
  }

  showGhost(kind, mat, slot) {
    const model = BUILD_MODEL(kind, mat);
    if (this.ghost && this.ghostModel !== model) this.ghost.visible = false;
    if (!slot) { if (this.ghost) this.ghost.visible = false; this.valid = false; return; }
    const gh = this.ghostFor(model);
    this.ghost = gh;
    this.ghostModel = model;
    const m = slotTransform(kind, slot, new THREE.Matrix4());
    m.decompose(gh.position, gh.quaternion, gh.scale);
    gh.visible = true;
    this.valid = this.game.pieces.canPlace(kind, slot);
    const t = this.game.time;
    const ok = this.valid;
    this.ghostMat.color.set(ok ? 0x5ab0ff : 0xff5a5a);
    this.ghostMat.opacity = 0.28 + Math.sin(t * 6) * 0.06;
    this.ghostEdge.color.set(ok ? 0xcfeeff : 0xffb3b3);
  }

  hideGhost() { if (this.ghost) this.ghost.visible = false; }
}
