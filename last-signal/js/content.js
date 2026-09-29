// Fills the valley with its story places: the wreck, tower, bridge, cabin, camp and mine, plus
// signs, a cairn, the windsock and the signal fire's woodpile. Returns handles the game logic needs.
import * as THREE from 'three';
import { loadModel } from './models.js';
import { makeCanvas, canvasTexture } from './textures.js';

export const yawFacing = (dx, dz) => Math.atan2(-dx, -dz);

function signTexture(title, detail) {
  const [c, g] = makeCanvas(512, 164);
  g.fillStyle = '#a98a5f'; g.fillRect(0, 0, 512, 164);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(70,45,20,${Math.random() * 0.12})`; g.fillRect(0, Math.random() * 164, 512, 1 + Math.random() * 3); }
  g.strokeStyle = '#4b3520'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 152);
  g.fillStyle = '#2b1e10'; g.textAlign = 'center';
  g.font = '600 46px Oswald, Impact, sans-serif'; g.fillText(title.toUpperCase(), 256, 76);
  g.font = '500 34px Oswald, sans-serif'; g.fillStyle = '#4b3520'; g.fillText(detail, 256, 128);
  const t = canvasTexture(c, { anisotropy: 4 });
  t.repeat.set(1 / 0.56, 1 / 0.18);
  t.offset.set(-0.02 / 0.56, -1.31 / 0.18);
  return t;
}

export async function placeContent(game) {
  const w = game.world, S = w.sites, st = game.structures;
  const out = { props: {}, signs: [] };

  // ----- big structures -----
  const wr = S.wreck;
  const wreckYaw = 2.3;
  await st.place('wreck', 'wreck', wr.x, wr.z, { yaw: wreckYaw, lift: 0.1, align: 0.8 });
  await st.place('cabin', 'cabin', S.cabin.x, S.cabin.z, { yaw: 2.5, lift: -0.05 });
  await st.place('tower', 'tower', S.tower.x, S.tower.z, { yaw: 0.4 });
  const b = S.bridge;
  await st.place('bridge', 'bridge', b.x, b.z, { yaw: Math.atan2(b.nx, b.nz) + 0, y: b.deckY });
  await st.place('camp', 'camp', S.camp.x, S.camp.z, { yaw: yawFacing(w.lake.cx - S.camp.x, w.lake.cz - S.camp.z), lift: 0.02 });
  await st.place('mine', 'mine', S.mine.x, S.mine.z, { yaw: -2.36, lift: 0.02 });

  // ----- props -----
  const propScene = await loadModel('props');
  const cloneProp = (name) => {
    const src = propScene.getObjectByName('P_' + name);
    if (!src) throw new Error('missing prop ' + name);
    const o = src.clone(true);
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
    return o;
  };
  out.spawn = (name, x, z, { yaw = 0, scale = 1, y = null, lift = 0, tilt = 0, parent = st.group } = {}) => {
    const root = new THREE.Group();
    const o = cloneProp(name);
    root.add(o);
    st.skin(root);
    root.position.set(x, (y ?? w.heightAt(x, z)) + lift, z);
    root.rotation.set(tilt, yaw, 0, 'YXZ');
    root.scale.setScalar(scale);
    parent.add(root);
    root.name = 'prop-' + name;
    return root;
  };

  // signs at trail junctions, lettered on canvases
  const signAt = (trail, index, side, title, detail) => {
    const line = w.trails[trail];
    if (!line || line.length < 20) return;
    const i = THREE.MathUtils.clamp(index < 0 ? line.length + index : index, 2, line.length - 3);
    const p = line[i], a = line[i - 2], c = line[i + 2];
    let tx = c.x - a.x, tz = c.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const x = p.x - tz * 2.4 * side, z = p.z + tx * 2.4 * side;
    const root = out.spawn('sign', x, z, { yaw: yawFacing(-tx, -tz) + 0.15 * side });
    root.traverse((m) => {
      if (m.isMesh && m.material && m.material.name === 'Sign') {
        m.material = new THREE.MeshStandardMaterial({ map: signTexture(title, detail), roughness: 0.9 });
      }
    });
    out.signs.push(root);
  };
  signAt('wreckToTower', 110, 1, 'Ridgeback Lookout', '0.2 km');
  signAt('towerToCamp', -8, -1, 'Creekside Camp', '0.1 km');
  signAt('campToMine', 12, 1, 'Halloran Mine', '0.5 km');
  signAt('mineToBridge', -10, -1, 'Creek Bridge', '0.1 km');
  signAt('bridgeToCabin', 14, 1, 'Ranger Cabin', 'Sunday Meadow 0.6 km');
  signAt('cabinToPeak', 12, -1, 'Kestrel Point', '0.6 km');

  // summit cairn
  const pk = S.peak;
  out.cairn = out.spawn('cairn', pk.x, pk.z, { yaw: 0.6, scale: 1.3 });
  // windsock at the landing zone
  const lz = S.lz;
  const wsx = lz.x + 14, wsz = lz.z - 10;
  const pole = out.spawn('windsock_pole', wsx, wsz);
  const sock = out.spawn('windsock_sock', wsx, wsz);
  out.windsock = sock;
  // the laid signal fire: a ring of stones and a pile of kindling
  out.lzRing = out.spawn('firering', lz.x, lz.z, { scale: 1.2 });
  out.lzWood = [];
  for (let i = 0; i < 4; i++) out.lzWood.push(out.spawn('wood', lz.x + Math.cos(i * 1.7) * 0.25, lz.z + Math.sin(i * 1.7) * 0.25, { yaw: i * 1.1, lift: 0.18 + i * 0.1, scale: 1.4 }));

  return out;
}
