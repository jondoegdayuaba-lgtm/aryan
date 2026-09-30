// Weapon stats and the first-person gun models.
import * as THREE from 'three';

// spread values are cone radii in radians. rpm = rounds per minute.
export const WEAPONS = [
  { id: 'pistol', name: 'Pistol', dmg: 26, head: 2, rpm: 380, auto: false, mag: 12, reserve: Infinity, reload: 1.1,
    spread: 0.012, adsSpread: 0.004, moveSpread: 0.02, pellets: 1, range: 60, recoil: 0.022, adsFov: 62,
    pref: 14, pitch: 0.9, hip: [0.15, -0.13, -0.36], ads: [0, -0.105, -0.34] },
  { id: 'rifle', name: 'Assault Rifle', dmg: 21, head: 1.8, rpm: 620, auto: true, mag: 30, reserve: 150, reload: 1.9,
    spread: 0.022, adsSpread: 0.005, moveSpread: 0.03, pellets: 1, range: 90, recoil: 0.016, adsFov: 52,
    pref: 20, pitch: 0.75, hip: [0.14, -0.12, -0.36], ads: [0, -0.125, -0.3] },
  { id: 'shotgun', name: 'Shotgun', dmg: 12, head: 1.5, rpm: 75, auto: false, mag: 6, reserve: 30, reload: 2.2,
    spread: 0.075, adsSpread: 0.06, moveSpread: 0.01, pellets: 9, range: 22, recoil: 0.08, adsFov: 64,
    pref: 6, pitch: 0.45, hip: [0.14, -0.12, -0.38], ads: [0, -0.12, -0.34] },
  { id: 'sniper', name: 'Sniper Rifle', dmg: 95, head: 2.5, rpm: 46, auto: false, mag: 5, reserve: 20, reload: 2.6,
    spread: 0.09, adsSpread: 0, moveSpread: 0.07, pellets: 1, range: 250, recoil: 0.09, adsFov: 22,
    pref: 35, pitch: 0.55, scope: true, hip: [0.14, -0.12, -0.38], ads: [0, -0.16, -0.3] },
];

const mat = (color) => new THREE.MeshLambertMaterial({ color });
const M = {
  dark: mat(0x2a2d33), mid: mat(0x454a54), accent: mat(0xff7a1a), wood: mat(0x8a5a2b),
  skin: mat(0xf1c9a0), sleeve: mat(0x3b6fd1), glass: new THREE.MeshBasicMaterial({ color: 0x66c8ff }),
};

function part(g, w, h, d, x, y, z, m, rx = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.rotation.x = rx;
  g.add(b);
  return b;
}

function cyl(g, r, len, x, y, z, m) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
  c.rotation.x = Math.PI / 2;
  c.position.set(x, y, z);
  g.add(c);
  return c;
}

function hands(g, gripZ, frontZ, frontY = -0.03) {
  part(g, 0.06, 0.07, 0.08, 0, -0.07, gripZ, M.skin);
  part(g, 0.09, 0.09, 0.4, 0.03, -0.12, gripZ + 0.22, M.sleeve, -0.25);
  if (frontZ !== undefined) {
    part(g, 0.07, 0.06, 0.08, -0.02, frontY, frontZ, M.skin);
    part(g, 0.09, 0.09, 0.45, -0.1, -0.1, frontZ + 0.25, M.sleeve, -0.2);
  }
}

// Each model points down -z with its sight line at y = 0. Returns {group, muzzle}.
const BUILD = {
  pistol(g) {
    part(g, 0.05, 0.05, 0.22, 0, -0.03, -0.05, M.dark);
    part(g, 0.045, 0.03, 0.2, 0, -0.07, -0.04, M.mid);
    part(g, 0.04, 0.11, 0.055, 0, -0.12, 0.03, M.dark, 0.25);
    part(g, 0.01, 0.015, 0.01, 0, -0.0, -0.14, M.accent);
    hands(g, 0.04, -0.06, -0.08);
    return -0.17;
  },
  rifle(g) {
    part(g, 0.06, 0.08, 0.4, 0, -0.06, -0.1, M.dark);
    part(g, 0.05, 0.05, 0.22, 0, -0.06, -0.38, M.mid);
    cyl(g, 0.012, 0.18, 0, -0.05, -0.56, M.dark);
    part(g, 0.04, 0.14, 0.06, 0, -0.15, -0.14, M.accent, 0.2);
    part(g, 0.04, 0.1, 0.05, 0, -0.13, 0.04, M.dark, 0.3);
    part(g, 0.05, 0.08, 0.18, 0, -0.07, 0.18, M.mid);
    part(g, 0.03, 0.03, 0.1, 0, -0.005, -0.05, M.dark);
    part(g, 0.02, 0.015, 0.02, 0, 0.0, -0.4, M.accent);
    hands(g, 0.04, -0.34, -0.1);
    return -0.66;
  },
  shotgun(g) {
    cyl(g, 0.022, 0.7, 0, -0.04, -0.3, M.dark);
    cyl(g, 0.018, 0.55, 0, -0.085, -0.25, M.mid);
    part(g, 0.06, 0.06, 0.16, 0, -0.085, -0.35, M.wood);
    part(g, 0.06, 0.09, 0.2, 0, -0.06, 0.02, M.dark);
    part(g, 0.05, 0.11, 0.26, 0, -0.1, 0.22, M.wood, 0.15);
    part(g, 0.012, 0.015, 0.012, 0, -0.01, -0.63, M.accent);
    hands(g, 0.1, -0.35, -0.12);
    return -0.66;
  },
  sniper(g) {
    part(g, 0.06, 0.08, 0.45, 0, -0.1, -0.1, M.dark);
    cyl(g, 0.014, 0.5, 0, -0.08, -0.55, M.dark);
    cyl(g, 0.035, 0.28, 0, 0, -0.1, M.mid);
    part(g, 0.05, 0.05, 0.03, 0, -0.05, -0.1, M.mid);
    const lens = cyl(g, 0.03, 0.005, 0, 0, -0.245, M.glass);
    lens.material = M.glass;
    part(g, 0.05, 0.1, 0.28, 0, -0.12, 0.25, M.accent);
    part(g, 0.04, 0.1, 0.05, 0, -0.17, 0.05, M.dark, 0.3);
    hands(g, 0.06, -0.3, -0.14);
    return -0.82;
  },
};

export function buildViewModel(def) {
  const group = new THREE.Group();
  const mz = BUILD[def.id](group);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, def.id === 'shotgun' ? -0.04 : def.id === 'sniper' ? -0.08 : def.id === 'rifle' ? -0.05 : -0.03, mz);
  group.add(muzzle);

  // Muzzle flash: two crossed additive quads.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
    q.rotation.set(i === 2 ? 0 : Math.PI / 2, i === 1 ? Math.PI / 2 : 0, Math.PI / 4);
    flash.add(q);
  }
  flash.position.copy(muzzle.position);
  flash.position.z -= 0.05;
  flash.visible = false;
  group.add(flash);
  return { group, muzzle, flash };
}
