// The drop airship: flies a straight line across the island; everyone jumps out along the way.
import * as THREE from 'three';
import { SKY, WORLD } from './config.js';

export class Airship {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.model = game.assets.flat('Airship');
    this.group.add(this.model);
    this.props = [];
    for (const name of ['Airship_Prop_L', 'Airship_Prop_R']) {
      if (!game.assets.has(name)) continue;
      const proto = game.assets.proto(name);
      const p = game.assets.flat(name);
      const pivot = new THREE.Group();
      pivot.position.copy(proto.position);
      pivot.quaternion.copy(proto.quaternion);
      pivot.add(p);
      this.group.add(pivot);
      this.props.push(p);
    }
    // the file's airship origin may not be at the file origin
    const ap = game.assets.proto('Airship');
    this.model.position.copy(ap.position || new THREE.Vector3());
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(1, 0, 0);
    this.velocity = new THREE.Vector3();
    this.dropPoint = new THREE.Vector3();
    this.camPoint = new THREE.Vector3();
    this.canDrop = false;
    this.forceDrop = false;
    this.active = false;
    this.t = 0;
    game.scene.add(this.group);
    this.group.visible = false;
  }

  start(rng) {
    this.startFrom(rng.float(0, Math.PI * 2), rng.float(-170, 170));
  }

  // Same flight path from its two numbers (online clients get them from the host).
  startFrom(ang, off) {
    this.route0 = [ang, off];
    this.dir.set(Math.cos(ang), 0, Math.sin(ang));
    const perp = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.length = WORLD.size * 1.25;
    this.startPos = perp.clone().multiplyScalar(off).addScaledVector(this.dir, -this.length / 2);
    this.startPos.y = SKY.busHeight;
    this.pos.copy(this.startPos);
    this.velocity.copy(this.dir).multiplyScalar(SKY.busSpeed);
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    this.active = true;
    this.forceDrop = false;
    this.canDrop = false;
    this.t = 0;
    this.group.visible = true;
    this.update(0);
  }

  // Straight-line route (for the map).
  route() {
    const a = this.startPos.clone();
    const b = this.startPos.clone().addScaledVector(this.dir, this.length);
    return [a, b];
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.pos.addScaledVector(this.velocity, dt);
    const travelled = this.pos.clone().sub(this.startPos).dot(this.dir);
    const fromCentre = Math.hypot(this.pos.x, this.pos.z);
    this.canDrop = this.t > 2.5 && fromCentre < WORLD.islandRadius + 60;
    // past the island and heading away: everyone out
    if (travelled > this.length * 0.5 && fromCentre > WORLD.islandRadius - 20) this.forceDrop = true;
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.t * 0.6) * 0.8;
    this.group.rotation.z = Math.sin(this.t * 0.4) * 0.02;
    for (const p of this.props) p.rotation.z += dt * 18;
    this.dropPoint.copy(this.pos).add(new THREE.Vector3(0, -7, 0));
    this.camPoint.copy(this.pos).add(new THREE.Vector3(0, 2, 0));
    if (travelled > this.length + 40) {
      this.active = false;
      this.group.visible = false;
    }
  }
}
