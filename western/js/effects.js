// Particles and flashes: gun smoke, muzzle flashes, dust, blood, fire, and
// bullet tracers. Point sprites updated on the CPU.
import * as THREE from 'three';

function puffTexture(soft = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35 + soft, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // Lumps so puffs don't look like perfect circles
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 12;
    const x = 32 + Math.cos(a) * r;
    const y = 32 + Math.sin(a) * r;
    const gg = g.createRadialGradient(x, y, 0, x, y, 12);
    gg.addColorStop(0, 'rgba(255,255,255,0.35)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gg;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Pool {
  constructor(scene, max, additive, texture) {
    this.max = max;
    this.count = 0;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 }, ...THREE.UniformsLib.fog },
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; attribute float aRot;
        uniform float scale; varying vec4 vColor; varying float vRot;
        #include <fog_pars_vertex>
        void main(){
          vColor = aColor; vRot = aRot;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vColor; varying float vRot;
        #include <fog_pars_fragment>
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), co = cos(vRot);
          c = mat2(co, -s, s, co) * c + 0.5;
          vec4 t = texture2D(map, c);
          gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.004) discard;
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
    scene.add(this.points);
  }

  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.pos.x, y: o.pos.y, z: o.pos.z,
      vx: o.vel?.x || 0, vy: o.vel?.y || 0, vz: o.vel?.z || 0,
      life: o.life, age: 0, s0: o.size0, s1: o.size1 ?? o.size0,
      r: o.color.r, g: o.color.g, b: o.color.b, a0: o.alpha ?? 1, fadeIn: o.fadeIn || 0,
      drag: o.drag ?? 1, grav: o.gravity || 0, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * (o.spin || 0.6),
    });
  }

  update(dt) {
    const arr = this.p;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy = q.vy * k + q.grav * dt; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      arr[w++] = q;
    }
    arr.length = w;
    for (let i = 0; i < w; i++) {
      const q = arr[i];
      const t = q.age / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      const fade = (q.fadeIn ? Math.min(1, t / q.fadeIn) : 1) * (1 - t) * (1 - t * 0.3);
      this.col[i * 4] = q.r; this.col[i * 4 + 1] = q.g; this.col[i * 4 + 2] = q.b; this.col[i * 4 + 3] = q.a0 * fade;
      this.size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(t);
      this.rot[i] = q.rot;
    }
    this.geo.setDrawRange(0, w);
    for (const n of ['position', 'aColor', 'aSize', 'aRot']) this.geo.attributes[n].needsUpdate = true;
  }
}

const col = (s) => new THREE.Color(s);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const puff = puffTexture();
    const soft = puffTexture(0.15);
    this.smoke = new Pool(scene, 1600, false, puff);
    this.glow = new Pool(scene, 900, true, soft);
    this.fires = [];
    this.flash = new THREE.PointLight('#ffb060', 0, 14, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    this._v = new THREE.Vector3();
    this.smokeTint = col('#c9c4bb');
  }

  setViewport(height, fov) {
    const s = height / (2 * Math.tan((fov * Math.PI) / 360));
    this.smoke.mat.uniforms.scale.value = s;
    this.glow.mat.uniforms.scale.value = s;
  }

  muzzle(pos, dir, big = false) {
    for (let i = 0; i < 3; i++) {
      this.glow.emit({ pos: pos.clone().addScaledVector(dir, 0.08 + i * 0.12), vel: dir.clone().multiplyScalar(2),
        life: 0.06, size0: (big ? 0.55 : 0.42) - i * 0.1, size1: 0.1, color: col('#ffc46a'), alpha: 1, drag: 4 });
    }
    // Black-powder smoke: a thick cloud that hangs in the air
    for (let i = 0; i < (big ? 9 : 7); i++) {
      const v = dir.clone().multiplyScalar(1.5 + Math.random() * 3.5);
      v.x += (Math.random() - 0.5) * 0.8; v.y += 0.2 + Math.random() * 0.5; v.z += (Math.random() - 0.5) * 0.8;
      const g = 0.72 + Math.random() * 0.2;
      this.smoke.emit({ pos: pos.clone().addScaledVector(dir, 0.15), vel: v, life: 2.4 + Math.random() * 2.2,
        size0: 0.25, size1: 1.6 + Math.random() * 1.4, color: new THREE.Color(g, g * 0.98, g * 0.95), alpha: 0.42,
        drag: 2.2, gravity: 0.12, fadeIn: 0.05 });
    }
    this.flash.position.copy(pos);
    this.flash.intensity = big ? 40 : 28;
    this.flashT = 0.06;
  }

  impact(pos, normal, kind) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    const c = kind === 'ground' ? col('#8a7356') : kind === 'blood' ? col('#5a0d0b') : col('#9a8a74');
    const count = kind === 'blood' ? 5 : 6;
    for (let i = 0; i < count; i++) {
      const v = n.clone().multiplyScalar(1 + Math.random() * 2.5);
      v.x += (Math.random() - 0.5) * 1.6; v.y += Math.random() * 1.6; v.z += (Math.random() - 0.5) * 1.6;
      this.smoke.emit({ pos, vel: v, life: kind === 'blood' ? 0.45 : 0.9 + Math.random() * 0.6,
        size0: 0.08, size1: kind === 'blood' ? 0.45 : 0.9, color: c, alpha: kind === 'blood' ? 0.85 : 0.6, drag: 3, gravity: kind === 'blood' ? -3 : 0.2 });
    }
  }

  dust(pos, amount = 1, color = '#9c8566') {
    for (let i = 0; i < amount; i++) {
      this.smoke.emit({ pos: this._v.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.1, pos.z + (Math.random() - 0.5) * 0.6),
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2),
        life: 1.0 + Math.random() * 0.8, size0: 0.3, size1: 1.5, color: col(color), alpha: 0.28, drag: 1.5 });
    }
  }

  splash(pos) {
    for (let i = 0; i < 3; i++) {
      this.smoke.emit({ pos, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
        life: 0.5, size0: 0.15, size1: 0.6, color: col('#dfe8ec'), alpha: 0.6, drag: 1, gravity: -6 });
    }
  }

  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, t: 0.07 });
  }

  // A persistent fire; returns a handle with .stop().
  addFire(pos, size = 1, opts = {}) {
    const light = new THREE.PointLight('#ff8a3a', 0, size * 18, 1.6);
    light.position.copy(pos).add(new THREE.Vector3(0, size * 1.2, 0));
    this.scene.add(light);
    const f = { pos: pos.clone(), size, acc: 0, light, alive: true, smoke: opts.smoke ?? true, spread: opts.spread || size * 0.6,
      stop: () => { f.alive = false; light.removeFromParent(); } };
    this.fires.push(f);
    return f;
  }

  update(dt, camPos) {
    for (const f of this.fires) {
      if (!f.alive) continue;
      const near = !camPos || camPos.distanceTo(f.pos) < 420;
      f.light.intensity = (8 + Math.random() * 6) * f.size * f.size * (near ? 1 : 0);
      if (!near) continue;
      f.acc += dt * (14 + 26 * f.size);
      while (f.acc > 1) {
        f.acc -= 1;
        const sp = f.spread;
        const p = this._v.set(f.pos.x + (Math.random() - 0.5) * sp * 2, f.pos.y + Math.random() * 0.3 * f.size,
          f.pos.z + (Math.random() - 0.5) * sp * 2);
        const hot = Math.random();
        this.glow.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 2.2 * f.size, (Math.random() - 0.5) * 0.5),
          life: 0.5 + Math.random() * 0.5, size0: (0.5 + Math.random() * 0.6) * f.size, size1: 0.1 * f.size,
          color: hot > 0.6 ? col('#ffd27a') : hot > 0.25 ? col('#ff8a2a') : col('#e0481a'), alpha: 0.9, drag: 0.6 });
        if (f.smoke && Math.random() < 0.28) {
          const g = 0.12 + Math.random() * 0.12;
          this.smoke.emit({ pos: p.clone().add(new THREE.Vector3(0, f.size * 1.5, 0)),
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.6 + 0.4, 1.8 + Math.random() * 1.6, (Math.random() - 0.5) * 0.6),
            life: 5 + Math.random() * 4, size0: 0.8 * f.size, size1: 6 * f.size, color: new THREE.Color(g, g * 0.95, g * 0.9),
            alpha: 0.42, drag: 0.15, fadeIn: 0.1 });
        }
        if (Math.random() < 0.08) {
          this.glow.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2),
            life: 1.5, size0: 0.06, size1: 0.03, color: col('#ffb050'), alpha: 1, drag: 0.4, gravity: -0.5 });
        }
      }
    }
    this.fires = this.fires.filter((f) => f.alive);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.intensity = 0;
    }
    for (const t of this.tracers) {
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.07) * 0.6;
      if (t.t <= 0) {
        t.line.removeFromParent();
        t.line.geometry.dispose();
        t.line.material.dispose();
      }
    }
    this.tracers = this.tracers.filter((t) => t.t > 0);
    this.smoke.update(dt);
    this.glow.update(dt);
  }
}
