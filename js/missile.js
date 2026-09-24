// The player's missile: model, skins, exhaust flame and inflatable float pods (shield).
import * as THREE from 'three';

const lambert = (o) => new THREE.MeshLambertMaterial(o);

export class Missile {
  constructor(scene, T) {
    this.T = T;
    this.root = new THREE.Group();        // position + flight orientation (nose = -Z)
    this.bank = new THREE.Group();        // visual roll only
    this.root.add(this.bank);
    scene.add(this.root);

    this.body = new THREE.Group();
    this.bank.add(this.body);

    this._buildFlame();
    this._buildFloats();

    this.bankAngle = 0;
    this.floatScale = 0;
    this.floatVel = 0;
    this.floatTarget = 0;
    this.throttle = 0;
  }

  setSkin(skin) {
    for (const c of [...this.body.children]) {
      this.body.remove(c);
      c.geometry.dispose();
    }
    const { bodyMat, noseMat, finMat, bandMat, dark } = this._materials(skin);

    const add = (geo, mat, z, rotZ = 0, y = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.z = z;
      if (rotZ) {
        m.rotation.z = rotZ;
        m.position.x = -Math.sin(rotZ) * y;
        m.position.y = Math.cos(rotZ) * y;
      } else if (y) {
        m.position.y = y;
      }
      m.castShadow = true;
      this.body.add(m);
      return m;
    };

    const r = 0.32;
    add(new THREE.CylinderGeometry(r, r, 3.3, 18).rotateX(Math.PI / 2), bodyMat, 0);
    add(new THREE.ConeGeometry(r, 1.15, 18).rotateX(-Math.PI / 2), noseMat, -1.65 - 0.575);
    add(new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.16, 18).rotateX(Math.PI / 2), bandMat, -1.05);
    add(new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.16, 18).rotateX(Math.PI / 2), bandMat, 0.95);
    add(new THREE.CylinderGeometry(0.22, 0.28, 0.35, 14).rotateX(Math.PI / 2), dark, 1.8);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      // Tail fins (swept) and small canards.
      const fin = new THREE.BoxGeometry(0.05, 0.62, 0.85);
      const pos = fin.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0 && pos.getZ(i) < 0) pos.setZ(i, pos.getZ(i) + 0.45);
      fin.computeVertexNormals();
      add(fin, finMat, 1.25, a, r + 0.28);
      add(new THREE.BoxGeometry(0.04, 0.3, 0.4), finMat, -0.55, a, r + 0.13);
    }
  }

  // Materials are cached per skin so flipping through skins in the menu doesn't leak textures.
  _materials(skin) {
    this._cache ??= new Map();
    if (this._cache.has(skin.id)) return this._cache.get(skin.id);
    const T = this.T;
    let bodyMat;
    if (skin.pattern === 'camo') bodyMat = lambert({ map: T.repeat(T.camo, 2, 1.5) });
    else if (skin.pattern === 'hazard') bodyMat = lambert({ map: T.repeat(T.hazard, 3, 3) });
    else bodyMat = lambert({ color: skin.body });
    const mats = {
      bodyMat,
      noseMat: skin.pattern === 'camo' ? bodyMat : lambert({ color: skin.nose }),
      finMat: lambert({ color: skin.fins }),
      bandMat: skin.glow ? new THREE.MeshBasicMaterial({ color: skin.band }) : lambert({ color: skin.band }),
      dark: lambert({ color: '#26252c' }),
    };
    this._cache.set(skin.id, mats);
    return mats;
  }

  _buildFlame() {
    const additive = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.flame = new THREE.Group();
    this.flame.position.z = 1.95;
    this.bank.add(this.flame);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.34, 3.2, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 1.6), additive('#ff6a1a', 0.85));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.8, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.9), additive('#fff0a0', 1));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(2.6, 2.6, 1);
    glow.position.z = 0.3;
    this.flameOuter = outer;
    this.flameInner = inner;
    this.flameGlow = glow;
    this.flame.add(outer, inner, glow);
    this.light = new THREE.PointLight('#ff8a2a', 0, 26, 1.6);
    this.light.position.z = 2.6;
    this.bank.add(this.light);
  }

  // Orange float pods that inflate around the missile when you pick up a shield.
  _buildFloats() {
    this.floats = new THREE.Group();
    const mat = lambert({ color: '#ff7a1a' });
    const strapMat = lambert({ color: '#2a2830' });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.9, 4, 10).rotateX(Math.PI / 2), mat);
      pod.position.set(Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0.05);
      pod.castShadow = true;
      this.floats.add(pod);
    }
    for (const z of [-0.55, 0.65]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 20), strapMat);
      strap.position.z = z;
      this.floats.add(strap);
    }
    this.floats.scale.setScalar(0.001);
    this.floats.visible = false;
    this.bank.add(this.floats);
  }

  setShield(on) {
    this.floatTarget = on ? 1 : 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  nozzleWorld(out = new THREE.Vector3()) {
    return out.set(0, 0, 2.05).applyQuaternion(this.root.quaternion).add(this.root.position);
  }

  update(dt, { throttle, bankTarget, time }) {
    // Visual roll eases toward the turn direction.
    this.bankAngle += (bankTarget - this.bankAngle) * (1 - Math.exp(-dt * 6));
    this.bank.rotation.z = this.bankAngle;

    // Flame flicker, scaled by throttle (0 = engine off, 1 = cruise, ~1.6 = boost).
    this.throttle += (throttle - this.throttle) * (1 - Math.exp(-dt * 10));
    const th = this.throttle;
    const flick = 0.85 + Math.sin(time * 61) * 0.08 + Math.random() * 0.12;
    this.flame.visible = th > 0.03;
    this.flame.scale.set(0.6 + th * 0.4, 0.6 + th * 0.4, th * flick);
    this.flameGlow.scale.setScalar((1.6 + th * 1.2) * flick);
    this.light.intensity = th * 26 * flick;

    // Float pods: springy inflate / deflate instead of popping in.
    const k = 140, damp = 13;
    this.floatVel += ((this.floatTarget - this.floatScale) * k - this.floatVel * damp) * dt;
    this.floatScale += this.floatVel * dt;
    const s = Math.max(0.001, this.floatScale);
    this.floats.visible = this.floatScale > 0.01;
    this.floats.scale.set(s, s, 0.4 + s * 0.6);
  }
}
