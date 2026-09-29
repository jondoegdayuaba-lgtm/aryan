// The rescue helicopter: flies in through the storm with a searchlight, circles until it sees your
// fire or flare, lands in the meadow, and carries you out.
import * as THREE from 'three';
import { loadModel } from './models.js';
import { surfaceMaterial } from './textures.js';
import { patchMaterial } from './atmosphere.js';
import { softSprite } from './particles.js';
import { clamp, damp, lerp } from './util.js';

export class Helicopter {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';            // idle | approach | search | descend | landed | lift
    this.group = new THREE.Group();
    this.group.visible = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0; this.roll = 0;
    this.rpm = 0;
    this.time = 0;
    this.orbit = 0;
    this.searchSince = 0;
    this.signalUntil = 0;
    this.onPhase = null;
    this.door = null;
  }

  async load() {
    const scene = (await loadModel('helicopter')).clone(true);
    const mats = {};
    scene.traverse((o) => {
      if (o.isMesh) {
        const src = o.material;
        let m = surfaceMaterial(src.name);
        if (!m) {
          m = src.name === 'Glass' ? new THREE.MeshStandardMaterial({ color: 0x9db8c4, transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false })
            : new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.8, vertexColors: true });
          patchMaterial(m, 'heli-' + src.name, null);
        }
        o.material = m; o.castShadow = false; o.receiveShadow = false;
      }
      if (o.name === 'ROTOR_main') this.rotor = o;
      if (o.name === 'ROTOR_tail') this.tail = o;
      if (o.name === 'LIGHT_search') this.searchAnchor = o;
      if (o.name === 'NAV_red') this.navRed = o;
      if (o.name === 'NAV_green') this.navGreen = o;
      if (o.name === 'NAV_white') this.navWhite = o;
      if (o.name === 'STROBE') this.strobeAnchor = o;
      if (o.name === 'ANCHOR_door') this.doorAnchor = o;
    });
    this.body = new THREE.Group();
    this.body.add(scene);
    this.group.add(this.body);
    this.game.scene.add(this.group);

    // searchlight and its visible beam
    this.light = new THREE.SpotLight(0xfff3dc, 0, 600, 0.13, 0.5, 1.4);
    this.light.target = new THREE.Object3D();
    this.game.scene.add(this.light, this.light.target);
    const cone = new THREE.ConeGeometry(1, 1, 24, 1, true);
    cone.translate(0, -0.5, 0);
    cone.rotateX(Math.PI / 2);                       // apex at the origin, opening toward +z
    this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 22;
    this.game.scene.add(this.beam);

    const tex = softSprite('flame');
    const mk = (color) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.setScalar(0.9); s.renderOrder = 23; this.body.add(s); return s; };
    this.spr = { red: mk(0xff2010), green: mk(0x20ff50), white: mk(0xffffff), strobe: mk(0xffffff) };
    for (const [k, a] of [['red', this.navRed], ['green', this.navGreen], ['white', this.navWhite], ['strobe', this.strobeAnchor]]) if (a) this.spr[k].position.copy(a.position);
  }

  get lz() { return this.game.world.sites.lz; }

  // Begins the flight in from the south-east.
  start() {
    if (this.phase !== 'idle' && this.phase !== 'gone') return;
    const lz = this.lz;
    this.pos.set(lz.x + 900, lz.y + 240, lz.z + 950);
    this.heading = Math.atan2(-(lz.x - this.pos.x), -(lz.z - this.pos.z));
    this.rpm = 1;
    this.group.visible = true;
    this.phase = 'approach';
    this.time = 0;
    this.onPhase?.('approach');
  }

  // Called when the player fires a flare or lights the signal fire.
  signal(seconds = 120) { this.signalUntil = this.time + seconds; }

  _steer(target, speed, dt, climb = 1) {
    const d = target.clone().sub(this.pos);
    const dist = d.length();
    const want = d.clone().normalize().multiplyScalar(Math.min(speed, dist * 0.6 + 1));
    this.vel.lerp(want, 1 - Math.exp(-0.8 * dt));
    return dist;
  }

  update(dt, storm) {
    if (this.phase === 'idle' || this.phase === 'gone') return;
    this.time += dt;
    const g = this.game, lz = this.lz;
    const prev = this.pos.clone();

    if (this.phase === 'approach') {
      const target = new THREE.Vector3(lz.x + 200, lz.y + 110, lz.z + 200);
      const dist = this._steer(target, 46, dt);
      if (dist < 70) { this.phase = 'search'; this.searchSince = this.time; this.onPhase?.('search'); }
    } else if (this.phase === 'search') {
      // circle the meadow with the light sweeping the ground
      this.orbit += dt * 0.11;
      const target = new THREE.Vector3(lz.x + Math.cos(this.orbit) * 190, lz.y + 105 + Math.sin(this.orbit * 0.7) * 14, lz.z + Math.sin(this.orbit) * 190);
      this._steer(target, 34, dt);
      const seen = this.time < this.signalUntil || this._fireVisible();
      if (seen) { this.phase = 'descend'; this.onPhase?.('descend'); }
      else if (this.time - this.searchSince > 420) { this.phase = 'gone'; this.group.visible = false; this.onPhase?.('gone'); }
    } else if (this.phase === 'descend') {
      const above = new THREE.Vector3(lz.x, lz.y + 60, lz.z);
      const flat = Math.hypot(this.pos.x - lz.x, this.pos.z - lz.z);
      if (flat > 22) { this._steer(above, 30, dt); }
      else {
        const gy = g.world.heightAt(lz.x, lz.z);
        const target = new THREE.Vector3(lz.x, gy + 0.05, lz.z);
        this.vel.lerp(new THREE.Vector3((target.x - this.pos.x) * 0.5, -Math.min(6, Math.max(0.8, (this.pos.y - gy) * 0.22)), (target.z - this.pos.z) * 0.5), 1 - Math.exp(-1.6 * dt));
        if (this.pos.y - gy < 0.15) { this.pos.y = gy; this.vel.set(0, 0, 0); this.phase = 'landed'; this.landedAt = this.time; this.onPhase?.('landed'); }
      }
    } else if (this.phase === 'landed') {
      this.vel.set(0, 0, 0);
      this.rpm = damp(this.rpm, 0.55, 0.15, dt);
    } else if (this.phase === 'lift') {
      this.rpm = damp(this.rpm, 1, 0.8, dt);
      this.vel.y = damp(this.vel.y, 7, 0.6, dt);
      this.vel.x = damp(this.vel.x, -Math.sin(this.heading) * 24 * clamp((this.time - this.liftAt - 3) / 5, 0, 1), 0.6, dt);
      this.vel.z = damp(this.vel.z, -Math.cos(this.heading) * 24 * clamp((this.time - this.liftAt - 3) / 5, 0, 1), 0.6, dt);
    }

    this.pos.addScaledVector(this.vel, dt);
    if (this.phase !== 'landed' && this.phase !== 'lift') this.rpm = damp(this.rpm, 1, 0.5, dt);

    // heading follows travel; the body leans into speed and turns, and the storm shakes it
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 3 && this.phase !== 'lift') {
      const h = Math.atan2(-this.vel.x, -this.vel.z);
      let d = h - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-0.9 * dt));
      this.roll = damp(this.roll, clamp(-d * 1.2, -0.4, 0.4), 1.5, dt);
    } else this.roll = damp(this.roll, 0, 1.5, dt);
    this.pitch = damp(this.pitch, clamp(speed * 0.008, 0, 0.22), 1.2, dt);
    const shake = (this.phase === 'landed' ? 0 : 1) * (0.006 + 0.03 * storm);
    const tt = this.time;
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch + Math.sin(tt * 2.3) * shake, this.heading, this.roll + Math.sin(tt * 1.7 + 1) * shake, 'YXZ');
    this.group.updateMatrixWorld(true);

    if (this.rotor) this.rotor.rotation.y -= dt * 46 * this.rpm;
    if (this.tail) this.tail.rotation.x += dt * 60 * this.rpm;

    // lights
    const blink = Math.sin(tt * 5.2) > 0.85 ? 1 : 0.05;
    this.spr.strobe.material.opacity = blink;
    this.spr.red.material.opacity = this.spr.green.material.opacity = this.spr.white.material.opacity = 0.9;
    const night = g.atmo.night;
    this._searchlight(dt, night, storm);
    this._wash(dt);
    this.spr.red.scale.setScalar(0.5 + 0.5 * night); this.spr.green.scale.setScalar(0.5 + 0.5 * night);
  }

  _fireVisible() {
    const lz = this.lz;
    for (const f of this.game.fires.sources) if (f.lit && f.kind === 'signal' && f.intensity > 0.5) return true;
    return false;
  }

  _searchlight(dt, night, storm) {
    const g = this.game, on = this.phase !== 'landed' || this.time - this.landedAt < 400;
    const origin = new THREE.Vector3();
    (this.searchAnchor || this.group).getWorldPosition(origin);
    // sweep: aim at the meadow, wandering, or straight down when landing
    const lz = this.lz;
    let aim;
    if (this.phase === 'search') {
      const a = this.time * 0.35;
      aim = new THREE.Vector3(lz.x + Math.cos(a) * 60 + Math.cos(this.orbit) * -30, lz.y, lz.z + Math.sin(a * 1.3) * 60);
    } else if (this.phase === 'approach') aim = new THREE.Vector3(lz.x + 60, lz.y, lz.z + 60);
    else aim = new THREE.Vector3(lz.x + Math.sin(this.time) * 4, lz.y, lz.z + Math.cos(this.time * 0.8) * 4);
    this.aim = this.aim ? this.aim.lerp(aim, 1 - Math.exp(-1.5 * dt)) : aim;
    const strength = clamp(0.25 + night * 0.9, 0.25, 1.1);
    this.light.position.copy(origin);
    this.light.target.position.copy(this.aim);
    this.light.intensity = on ? 2600 * strength : 0;
    this.light.updateMatrixWorld();
    // beam mesh
    const dir = this.aim.clone().sub(origin);
    const len = Math.min(dir.length(), 420);
    dir.normalize();
    this.beam.position.copy(origin);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.beam.scale.set(len * 0.13, len * 0.13, len);
    const haze = 0.012 + 0.03 * g.atmo.weather.rain + 0.02 * g.atmo.weather.fog;
    this.beam.material.opacity = on ? haze * strength : 0;
  }

  // Dust and spray blown off the ground while low.
  _wash(dt) {
    const g = this.game;
    const gy = g.world.heightAt(this.pos.x, this.pos.z);
    const h = this.pos.y - gy;
    if (h > 45 || this.rpm < 0.4) return;
    const n = (1 - h / 45) * 40 * dt;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 4;
      g.fires.smoke.emit({ x: this.pos.x + Math.cos(a) * r, y: gy + 0.4, z: this.pos.z + Math.sin(a) * r, vx: Math.cos(a) * (6 + Math.random() * 5), vy: 0.6 + Math.random(), vz: Math.sin(a) * (6 + Math.random() * 5), life: 1.4, size0: 0.8, size1: 5, alpha: 0.28, c0: [0.5, 0.5, 0.5], c1: [0.6, 0.6, 0.6], drag: 0.8 });
    }
  }

  liftOff() { this.phase = 'lift'; this.liftAt = this.time; this.onPhase?.('lift'); }
  get doorPos() { const v = new THREE.Vector3(); (this.doorAnchor || this.group).getWorldPosition(v); return v; }
}
