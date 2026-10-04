// The arcade side of the dive: trails of floating gold coins that lead to
// every site, current rings that fling you along the routes, golden fish to
// chase down, and three missions per dive.
import * as THREE from 'three';
import { FUN } from './config.js';
import { patchMaterial, WATER_GLSL, U } from './ocean.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ coin trails

export class CoinTrails {
  constructor(scene, models, trails) {
    const src = [];
    models.coin.traverse((o) => { if (o.isMesh) src.push(o); });
    const mat = src[0].material.clone();
    mat.emissive.set('#ffb020');
    mat.emissiveIntensity = 0.9;
    patchMaterial(mat, { key: 'trailcoin' });
    this.coins = [];
    for (const t of trails) {
      t.coins.forEach((p, i) => this.coins.push({ home: new THREE.Vector3().fromArray(p), p: new THREE.Vector3().fromArray(p), state: 0, t: 0, phase: i * 0.45, trail: t.name }));
    }
    this.mesh = new THREE.InstancedMesh(src[0].geometry, mat, this.coins.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // A soft gold glow behind every coin so trails read from far away.
    const pos = new Float32Array(this.coins.length * 3);
    this.alpha = new Float32Array(this.coins.length).fill(1);
    this.coins.forEach((c, i) => pos.set(c.home.toArray(), i * 3));
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.glowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...U, tGlow: { value: glowTexture('rgba(255,240,170,1)', 'rgba(255,190,60,0.5)') }, uScale: { value: 600 } },
      vertexShader: `${WATER_GLSL}
        uniform float uScale; attribute float aAlpha; varying float vA;
        void main(){ vec4 mv = viewMatrix * vec4(position, 1.0); float d = -mv.z;
          vA = aAlpha * (1.0 - smoothstep(35.0, 70.0, d)) * smoothstep(1.5, 4.0, d) * (0.75 + 0.25 * sin(uTime * 3.0 + position.x + position.z));
          // Skip invisible glows entirely: a huge point right at the lens is all overdraw.
          if (vA < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          gl_PointSize = min(0.9 * uScale / max(d, 0.1), 220.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D tGlow; varying float vA;
        void main(){ vec4 g = texture2D(tGlow, gl_PointCoord); gl_FragColor = vec4(g.rgb * g.a * vA * 0.9, 1.0); }`,
    });
    this.glow = new THREE.Points(geo, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 9;
    scene.add(this.glow);
    this.reset();
  }

  reset() {
    for (const c of this.coins) { c.state = 0; c.t = 0; c.p.copy(c.home); }
    this.alpha.fill(1);
    this.alphaAttr.needsUpdate = true;
    this.sync(0);
  }

  sync(t) {
    this.coins.forEach((c, i) => {
      if (c.state === 2) tmpS.setScalar(0);
      else tmpS.setScalar(FUN.trailCoinScale);
      // Stand upright and spin, like a proper game coin.
      tmpQ.setFromAxisAngle(UP, t * 2.2 + c.phase).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      tmp.copy(c.p);
      if (c.state === 0) tmp.y += Math.sin(t * 1.6 + c.phase) * 0.08;
      tmpM.compose(tmp, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, t, eye, magnet, events) {
    const r2 = magnet * magnet;
    let changed = false;
    this.coins.forEach((c, i) => {
      if (c.state === 0) {
        if (c.home.distanceToSquared(eye) < r2) {
          c.state = 1;
          c.t = 0;
          this.alpha[i] = 0;
          changed = true;
        }
      } else if (c.state === 1) {
        c.t += dt;
        tmp.copy(eye).add(tmp2.set(0, -0.3, 0));
        c.p.lerp(tmp, Math.min(1, dt * (5 + c.t * 14)));
        if (c.p.distanceTo(tmp) < 0.3 || c.t > 1.2) {
          c.state = 2;
          events.push({ type: 'coin', value: FUN.trailCoinValue, trail: true });
        }
      }
    });
    if (changed) this.alphaAttr.needsUpdate = true;
    this.sync(t);
  }

  // Nearest coin still waiting, for the compass.
  nearest(p, maxD = 80) {
    let best = null, bd = maxD * maxD;
    for (const c of this.coins) {
      if (c.state) continue;
      const d = c.home.distanceToSquared(p);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}

// ------------------------------------------------------------------ current rings

export class CurrentRings {
  constructor(scene, trails) {
    this.rings = [];
    for (const t of trails) {
      for (const r of t.rings) {
        const dir = new THREE.Vector3(r[3], r[4], r[5]).normalize();
        this.rings.push({ c: new THREE.Vector3(r[0], r[1], r[2]), dir, side: 0, cool: 0, pulse: 0, spin: Math.random() * 6 });
      }
    }
    const geo = new THREE.TorusGeometry(FUN.ringRadius, 0.11, 10, 48);
    const mat = new THREE.MeshStandardMaterial({ color: '#0a3a44', emissive: '#5ff4ff', emissiveIntensity: 1.6, roughness: 0.3, transparent: true, opacity: 0.9 });
    patchMaterial(mat, { key: 'ring' });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.rings.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // Inner swirl: a faint disc that shows which way the current flows.
    const disc = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: U,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: `${WATER_GLSL}
        varying vec2 vUv;
        void main(){ vec2 c = vUv - 0.5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
          float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - uTime * 5.0);
          float alpha = smoothstep(1.0, 0.6, r) * (0.12 + 0.18 * swirl);
          gl_FragColor = vec4(vec3(0.45, 0.95, 1.0) * alpha, 1.0); }`,
    });
    this.disc = new THREE.InstancedMesh(new THREE.CircleGeometry(FUN.ringRadius * 0.95, 32), disc, this.rings.length);
    this.disc.frustumCulled = false;
    this.disc.renderOrder = 6;
    scene.add(this.disc);
    this.sync(0);
  }

  reset() {
    for (const r of this.rings) { r.side = 0; r.cool = 0; r.pulse = 0; }
  }

  sync(dt) {
    this.rings.forEach((r, i) => {
      r.spin += dt * 0.6;
      tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.dir);
      tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r.spin));
      tmpS.setScalar(1 + r.pulse * 0.35);
      tmpM.compose(r.c, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
      this.disc.setMatrixAt(i, tmpM);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.disc.instanceMatrix.needsUpdate = true;
  }

  // Returns the ring the diver just swam through, if any.
  update(dt, eye) {
    let hit = null;
    for (const r of this.rings) {
      r.cool = Math.max(0, r.cool - dt);
      r.pulse = Math.max(0, r.pulse - dt * 2);
      tmp.subVectors(eye, r.c);
      const along = tmp.dot(r.dir);
      const side = Math.sign(along);
      const radial = tmp.addScaledVector(r.dir, -along).length();
      if (r.side && side !== r.side && radial < FUN.ringRadius * 1.15 && Math.abs(along) < 2.5 && r.cool <= 0) {
        r.cool = 2;
        r.pulse = 1;
        hit = r;
      }
      r.side = Math.abs(along) < 6 ? side : 0;
    }
    this.sync(dt);
    return hit;
  }
}

// ------------------------------------------------------------------ golden fish

export class GoldenFish {
  constructor(scene, models, spawns, seabed) {
    this.seabed = seabed;
    this.fish = spawns.map((p, i) => {
      const uniforms = { uPhase: { value: i * 1.3 }, uRate: { value: 1 } };
      const obj = models.fish_tang.clone();
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.set('#ffd34a');
        o.material.emissive.set('#c07800');
        o.material.emissiveIntensity = 0.8;
        o.material.metalness = 0.6;
        o.material.roughness = 0.25;
        patchMaterial(o.material, { swim: { amp: 0.12, length: 0.2, freq: 12 }, uniforms, key: 'goldfish' });
      });
      obj.scale.setScalar(FUN.goldenScale);
      scene.add(obj);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,245,190,1)', 'rgba(255,190,60,0.45)'), transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
      halo.scale.setScalar(1.4);
      halo.renderOrder = 9;
      scene.add(halo);
      const home = new THREE.Vector3().fromArray(p);
      return { obj, halo, uniforms, home, pos: home.clone(), vel: new THREE.Vector3(1, 0, 0), t: Math.random() * 50, caught: false, scared: 0 };
    });
  }

  reset() {
    for (const f of this.fish) {
      f.caught = false;
      f.pos.copy(f.home);
      f.obj.visible = f.halo.visible = true;
    }
  }

  update(dt, t, player, events) {
    for (const f of this.fish) {
      if (f.caught) continue;
      f.t += dt;
      const toPlayer = tmp.subVectors(f.pos, player.pos);
      const d = toPlayer.length();
      let want, speed;
      if (d < FUN.goldenFear) {
        // Flee, jinking side to side; just a little slower than a boosting scooter.
        f.scared = 2;
        want = toPlayer.normalize().add(tmp2.set(Math.sin(f.t * 3.1) * 0.6, Math.sin(f.t * 1.7) * 0.25, Math.cos(f.t * 2.3) * 0.6)).normalize();
        speed = FUN.goldenSpeed;
      } else {
        f.scared = Math.max(0, f.scared - dt);
        // Lazy figure-eights around home.
        tmp2.set(Math.sin(f.t * 0.3) * 6, Math.sin(f.t * 0.5) * 1.2, Math.sin(f.t * 0.6) * 4).add(f.home).sub(f.pos);
        want = tmp2.normalize();
        speed = f.scared > 0 ? 2 : 1.1;
      }
      const g = this.seabed.heightAt(f.pos.x, f.pos.z);
      if (f.pos.y < g + 1.0) want.y += 1.5;
      if (f.pos.y > -2) want.y -= 1.5;
      if (f.pos.distanceTo(f.home) > 45) want.add(tmp2.subVectors(f.home, f.pos).normalize().multiplyScalar(0.8));
      want.normalize();
      f.vel.lerp(want.multiplyScalar(speed), Math.min(1, dt * 3));
      f.pos.addScaledVector(f.vel, dt);
      f.obj.position.copy(f.pos);
      f.obj.lookAt(tmp.copy(f.pos).sub(f.vel));
      f.halo.position.copy(f.pos);
      f.halo.material.opacity = 0.45 + 0.25 * Math.sin(t * 4 + f.t);
      f.uniforms.uRate.value = 0.8 + f.vel.length() * 0.6;
      if (d < FUN.goldenCatch) {
        f.caught = true;
        f.obj.visible = f.halo.visible = false;
        events.push({ type: 'golden', value: FUN.goldenValue, pos: f.pos.clone() });
      }
    }
  }

  nearest(p, maxD = 40) {
    let best = null, bd = maxD;
    for (const f of this.fish) {
      if (f.caught) continue;
      const d = f.pos.distanceTo(p);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
}

// ------------------------------------------------------------------ missions

const MISSIONS = [
  { type: 'coins', text: (n) => `Collect ${n} coins`, sizes: [[40, 150], [70, 250], [110, 400]] },
  { type: 'rings', text: (n) => `Ride ${n} current rings`, sizes: [[3, 150], [5, 250], [8, 400]] },
  { type: 'golden', text: (n) => (n > 1 ? `Catch ${n} golden fish` : 'Catch a golden fish'), sizes: [[1, 300], [2, 500], [3, 700]] },
  { type: 'chest', text: (n) => (n > 1 ? `Open ${n} treasure chests` : 'Open a treasure chest'), sizes: [[1, 250], [2, 450]] },
  { type: 'pearl', text: () => 'Take a pearl from a giant clam', sizes: [[1, 200]] },
  { type: 'depth', text: (n) => `Dive below ${n} m`, sizes: [[18, 150], [30, 250], [45, 400]] },
  { type: 'combo', text: (n) => `Reach a x${n} coin combo`, sizes: [[3, 200], [4, 300], [5, 450]] },
  { type: 'strobe', text: () => 'Scare off a shark with your strobe', sizes: [[1, 300]] },
];

export class Missions {
  constructor() {
    this.list = [];
  }

  // Three different missions, a little harder as you make more dives.
  roll(dives, chestsLeft) {
    const tier = Math.min(2, Math.floor(dives / 3));
    const pool = MISSIONS.filter((m) => !(m.type === 'chest' && chestsLeft < 1) && !(m.type === 'strobe' && dives < 2));
    const picks = [];
    const firstDive = dives === 0;
    const order = firstDive ? ['coins', 'rings', 'chest'] : pool.map((m) => m.type).sort(() => Math.random() - 0.5);
    for (const type of order) {
      if (picks.length >= 3) break;
      const m = pool.find((x) => x.type === type);
      if (!m) continue;
      const [n, reward] = m.sizes[Math.min(tier, m.sizes.length - 1)];
      picks.push({ type, n, reward, text: m.text(n), have: 0, done: false });
    }
    this.list = picks;
    return picks;
  }

  // Count progress; returns missions that just completed.
  bump(type, amount = 1, absolute = false) {
    const done = [];
    for (const m of this.list) {
      if (m.done || m.type !== type) continue;
      m.have = absolute ? Math.max(m.have, amount) : m.have + amount;
      if (m.have >= m.n) {
        m.have = m.n;
        m.done = true;
        done.push(m);
      }
    }
    return done;
  }
}
