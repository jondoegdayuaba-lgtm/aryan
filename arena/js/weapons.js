import * as THREE from 'three';

// Low-poly gun models built from boxes and cylinders. Barrels point down -z and
// the origin is the grip. The same models are used in first person and in bots' hands.

const matCache = new Map();
const mat = (color) => {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
};
function part(group, w, h, d, color, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.rotation.x = rx;
  group.add(m);
  return m;
}
function tube(group, r, len, color, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

const DARK = 0x2a2d35, MID = 0x484d58, WOOD = 0x8a5a33, ACCENT = 0xff8a1f, STEEL = 0xc9d0da;

export function gunModel(id, accent = ACCENT) {
  const g = new THREE.Group();
  let muzzleZ = -0.5, sightY = 0.08;
  switch (id) {
    case 'rifle':
      part(g, 0.08, 0.12, 0.5, DARK, 0, 0.04, -0.2);
      part(g, 0.082, 0.03, 0.3, accent, 0, 0.075, -0.22);
      tube(g, 0.022, 0.32, MID, 0, 0.05, -0.6);
      part(g, 0.06, 0.18, 0.09, MID, 0, -0.08, -0.25, 0.25);
      part(g, 0.06, 0.13, 0.07, DARK, 0, -0.05, 0.0, -0.3);
      part(g, 0.07, 0.11, 0.24, DARK, 0, 0.03, 0.15);
      part(g, 0.03, 0.045, 0.12, 0x111111, 0, 0.12, -0.15);
      muzzleZ = -0.77; sightY = 0.145;
      break;
    case 'smg':
      part(g, 0.08, 0.11, 0.36, DARK, 0, 0.04, -0.15);
      part(g, 0.082, 0.03, 0.2, accent, 0, 0.07, -0.18);
      tube(g, 0.02, 0.14, MID, 0, 0.05, -0.4);
      part(g, 0.05, 0.24, 0.06, MID, 0, -0.12, -0.2);
      part(g, 0.06, 0.12, 0.07, DARK, 0, -0.05, 0.0, -0.3);
      part(g, 0.04, 0.05, 0.18, MID, 0, 0.05, 0.12);
      part(g, 0.03, 0.04, 0.06, 0x111111, 0, 0.115, -0.12);
      muzzleZ = -0.48; sightY = 0.135;
      break;
    case 'shotgun':
      tube(g, 0.03, 0.7, MID, 0, 0.07, -0.42);
      tube(g, 0.024, 0.55, DARK, 0, 0.02, -0.38);
      part(g, 0.09, 0.08, 0.2, WOOD, 0, 0.02, -0.38);
      part(g, 0.08, 0.12, 0.22, DARK, 0, 0.05, -0.03);
      part(g, 0.06, 0.13, 0.07, WOOD, 0, -0.06, 0.04, -0.3);
      part(g, 0.07, 0.12, 0.26, WOOD, 0, 0.02, 0.2);
      part(g, 0.02, 0.025, 0.02, accent, 0, 0.11, -0.75);
      muzzleZ = -0.78; sightY = 0.115;
      break;
    case 'sniper':
      part(g, 0.08, 0.11, 0.55, 0x3e4a3a, 0, 0.03, -0.2);
      tube(g, 0.02, 0.6, DARK, 0, 0.05, -0.75);
      tube(g, 0.035, 0.3, 0x111111, 0, 0.15, -0.15);
      part(g, 0.03, 0.05, 0.04, DARK, 0, 0.11, -0.25);
      part(g, 0.03, 0.05, 0.04, DARK, 0, 0.11, -0.05);
      part(g, 0.06, 0.13, 0.07, DARK, 0, -0.06, 0.03, -0.3);
      part(g, 0.07, 0.14, 0.28, 0x3e4a3a, 0, 0.0, 0.2);
      part(g, 0.082, 0.025, 0.2, accent, 0, 0.07, -0.3);
      muzzleZ = -1.05; sightY = 0.15;
      break;
    case 'rocket':
      tube(g, 0.085, 0.9, 0x4f6b3a, 0, 0.1, -0.42, 12);
      tube(g, 0.1, 0.08, DARK, 0, 0.1, -0.86, 12);
      tube(g, 0.1, 0.08, DARK, 0, 0.1, 0.0, 12);
      part(g, 0.05, 0.14, 0.06, DARK, 0, -0.03, -0.05, -0.2);
      part(g, 0.05, 0.12, 0.06, DARK, 0, -0.02, -0.4);
      part(g, 0.04, 0.09, 0.12, accent, -0.1, 0.17, -0.4);
      muzzleZ = -0.9; sightY = 0.24;
      break;
    case 'pistol':
      part(g, 0.05, 0.06, 0.22, DARK, 0, 0.06, -0.08);
      part(g, 0.052, 0.015, 0.16, accent, 0, 0.095, -0.08);
      part(g, 0.045, 0.14, 0.07, MID, 0, -0.02, 0.0, -0.25);
      part(g, 0.015, 0.02, 0.015, 0x111111, 0, 0.1, -0.18);
      muzzleZ = -0.2; sightY = 0.11;
      break;
    case 'knife':
      part(g, 0.03, 0.05, 0.13, 0x161616, 0, 0, 0.02);
      part(g, 0.06, 0.06, 0.02, MID, 0, 0, -0.05);
      part(g, 0.012, 0.05, 0.26, STEEL, 0, 0.005, -0.19);
      part(g, 0.013, 0.012, 0.22, accent, 0, 0.03, -0.17);
      muzzleZ = -0.3; sightY = 0;
      break;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, id === 'rocket' ? 0.1 : 0.05, muzzleZ);
  g.add(muzzle);
  g.userData = { muzzle, sightY, id };
  return g;
}

// First-person weapon, drawn in its own scene on top of the world so it never
// clips into walls.
export class ViewModel {
  constructor(color) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 1);
    this.scene.add(sun);
    this.rig = new THREE.Group();
    this.camera.add(this.rig);
    this.color = color;
    this.gun = null;
    this.id = null;
    this.kick = 0;
    this.kickRot = 0;
    this.bobT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.knifeT = 1;
    this.flash = this._flash();
  }

  _flash() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.3, 'rgba(255,200,80,0.9)');
    grad.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    s.scale.setScalar(0.22);
    s.visible = false;
    return s;
  }

  setWeapon(id) {
    if (this.id === id) return;
    this.id = id;
    if (this.gun) this.rig.remove(this.gun);
    this.gun = gunModel(id);
    this.gun.scale.setScalar(0.8);
    // Hands
    const skin = mat(0xe8b88a), sleeve = mat(this.color);
    const hand = (x, y, z) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.1), skin);
      h.position.set(x, y, z);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.3), sleeve);
      s.position.set(x * 1.6, y - 0.04, z + 0.2);
      this.gun.add(h, s);
    };
    hand(0.02, -0.05, 0.01);
    if (id !== 'pistol' && id !== 'knife') hand(-0.02, 0.0, id === 'smg' ? -0.3 : -0.42);
    this.gun.userData.muzzle.add(this.flash);
    this.rig.add(this.gun);
    this.raise = 1;  // weapon comes up from below
  }

  fire(recoil) {
    if (this.id === 'knife') { this.knifeT = 0; return; }
    this.kick = Math.min(this.kick + 0.05 + recoil, 0.12);
    this.kickRot = Math.min(this.kickRot + 0.08 + recoil * 3, 0.35);
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flashT = 0.05;
  }

  muzzleWorld(out) {
    return this.gun.userData.muzzle.getWorldPosition(out);
  }

  // ads: 0..1, reload: 0..1 progress or -1, moving: speed 0..1, look: mouse deltas
  update(dt, { ads, reload, moving, grounded, lookX, lookY, sliding }) {
    if (!this.gun) return;
    this.kick = Math.max(0, this.kick - dt * 0.6);
    this.kick *= Math.exp(-dt * 14);
    this.kickRot *= Math.exp(-dt * 12);
    this.raise = Math.max(0, (this.raise || 0) - dt * 4);
    this.knifeT = Math.min(1, this.knifeT + dt * 3.2);
    if (this.flashT !== undefined) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    if (grounded && moving > 0.1 && !sliding) this.bobT += dt * (6 + moving * 6);
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(-lookX * 0.0009, -0.05, 0.05), 1 - Math.exp(-dt * 10));
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(lookY * 0.0009, -0.05, 0.05), 1 - Math.exp(-dt * 10));

    const sy = this.gun.userData.sightY;
    const hip = new THREE.Vector3(0.17, -0.19, -0.5);
    const aim = new THREE.Vector3(0, -sy * this.gun.scale.y, -0.36);
    const bobAmt = (1 - ads * 0.85) * Math.min(moving, 1);
    const p = hip.lerp(aim, ads);
    p.x += Math.sin(this.bobT) * 0.012 * bobAmt + this.swayX * (1 - ads * 0.7);
    p.y += Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt + this.swayY * (1 - ads * 0.7);
    p.z += this.kick;
    let rx = this.kickRot, ry = 0, rz = 0;
    if (sliding) { rz = 0.3 * (1 - ads); p.y -= 0.03; }
    if (reload >= 0) {
      const k = Math.sin(Math.min(reload, 1) * Math.PI);
      rx -= k * 0.8; rz += k * 0.4; p.y -= k * 0.12;
    }
    if (this.id === 'knife') {
      const s = Math.sin(this.knifeT * Math.PI);
      ry = s * 1.1; rx -= s * 0.4; p.x -= s * 0.18; p.z -= s * 0.12;
      rz -= 0.3;
    }
    p.y -= this.raise * this.raise * 0.35;
    this.gun.position.copy(p);
    this.gun.rotation.set(rx, ry, rz);
  }

  render(renderer, fov, aspect) {
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
