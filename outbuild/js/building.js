// Turns an aim ray into a build slot on the grid, shows the preview ghost, and places pieces.
import * as THREE from 'three';
import { GRID, MATS, BUILD_COST } from './config.js';
import { BUILD_MODEL, slotTransform } from './pieces.js';
import { clamp } from './util.js';

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
      return { ix: cx, iy: clamp(Math.floor(P.y / H), feet - 1, feet + 1), iz: cz, dir: dirI };
    }
    return { ix: cx, iy: clampLvl(Math.floor((P.y + 1.2) / H)), iz: cz, dir: 0 };
  }

  canAfford(actor, mat) { return actor.inv.mats[mat] >= BUILD_COST; }

  tryPlace(actor, slot, kind, mat) {
    const g = this.game;
    const now = g.time;
    const last = this.lastPlace.get(actor) || 0;
    if (now - last < 0.1) return false;
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
