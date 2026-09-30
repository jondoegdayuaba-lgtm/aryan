import * as THREE from 'three';
import { CITY } from './config.js';
import { hash } from './world.js';

const P = CITY.period;

/** Battery cells scattered on the roads: ride through one to refill the boost tank. */
export class Pickups {
  constructor(scene, glowTex) {
    this.collected = new Set();
    this.list = [];
    this.cacheKey = '';
    this.pool = [];
    const cyl = new THREE.CylinderGeometry(0.28, 0.28, 0.85, 14);
    const ring = new THREE.TorusGeometry(0.62, 0.05, 8, 28);
    const mat = new THREE.MeshStandardMaterial({ color: 0x06222c, emissive: 0x18d8ff, emissiveIntensity: 1.5, roughness: 0.3 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x06222c, emissive: 0x9bf3ff, emissiveIntensity: 1.8, roughness: 0.3 });
    const sprMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x20d0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45, fog: false });
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const c = new THREE.Mesh(cyl, mat);
      const r = new THREE.Mesh(ring, ringMat);
      r.rotation.x = Math.PI / 2;
      const s = new THREE.Sprite(sprMat);
      s.scale.setScalar(3.2);
      g.add(c, r, s);
      g.visible = false;
      scene.add(g);
      this.pool.push({ g, r, id: null });
    }
  }

  reset() { this.collected.clear(); this.cacheKey = ''; }

  /** Rebuild the candidate list around the player's tile (deterministic per tile). */
  refresh(px, pz) {
    const cx = Math.round(px / P), cz = Math.round(pz / P);
    const key = cx + ',' + cz;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    const list = [];
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const tx = cx + dx, tz = cz + dz;
      for (let side = 0; side < 2; side++) {
        if (hash(tx, tz, 900 + side) > 0.32) continue;
        const lane = hash(tx, tz, 910 + side) < 0.5 ? 42.5 : 47.5;
        const t = -28 + hash(tx, tz, 920 + side) * 56;
        const x = tx * P + (side === 0 ? lane : t);
        const z = tz * P + (side === 0 ? t : lane);
        list.push({ id: `${tx},${tz},${side}`, x, z });
      }
    }
    this.list = list;
  }

  update(dt, time, player, onPickup) {
    this.refresh(player.x, player.z);
    const near = this.list.filter((p) => !this.collected.has(p.id))
      .map((p) => ({ p, d: Math.hypot(p.x - player.x, p.z - player.z) }))
      .filter((o) => o.d < 230).sort((a, b) => a.d - b.d).slice(0, this.pool.length);
    this.pool.forEach((slot, i) => {
      const o = near[i];
      if (!o) { slot.g.visible = false; slot.id = null; return; }
      slot.g.visible = true;
      slot.id = o.p.id;
      slot.g.position.set(o.p.x, 1.2 + Math.sin(time * 2 + i) * 0.15, o.p.z);
      slot.r.rotation.z = time * 2 + i;
      if (o.d < 2.6 && player.alive) {
        this.collected.add(o.p.id);
        slot.g.visible = false;
        onPickup(o.p);
      }
    });
  }

  /** Positions for the radar. */
  visible() { return this.pool.filter((s) => s.g.visible).map((s) => s.g.position); }
}
