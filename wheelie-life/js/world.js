// Golden-hour highway: sky + image-based lighting, scrolling asphalt, roadside props, traffic.
import * as THREE from 'three';

export const LANES = [-3.5, 0, 3.5];
export const ROAD_HALF = 7;          // asphalt + shoulder
export const ROAD_LEN = 520;
const TEX_LEN = 12;                  // metres of road per texture repeat

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function noiseCanvas(w, h, base, spread, speckle = 0.15) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = base + (Math.random() - 0.5) * spread + (Math.random() < speckle ? (Math.random() - 0.3) * spread * 1.6 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, n));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, repeatX = 1, repeatY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roadTexture() {
  const W = 1024, H = 1024, mPerPx = (ROAD_HALF * 2) / W;
  const c = noiseCanvas(W, H, 46, 26, 0.12);
  const g = c.getContext('2d');
  const px = (x) => (x + ROAD_HALF) / mPerPx;
  // shoulders, lighter and dustier
  g.fillStyle = 'rgba(120,108,90,0.28)';
  g.fillRect(0, 0, px(-5.4), H); g.fillRect(px(5.4), 0, W, H);
  // polished, dark tyre tracks in each lane
  for (const lx of LANES) for (const off of [-0.85, 0.85]) {
    const grd = g.createLinearGradient(px(lx + off - 0.45), 0, px(lx + off + 0.45), 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.32)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(px(lx + off - 0.45), 0, 0.9 / mPerPx, H);
  }
  // oil drips and cracks
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 9; k++) { x += rand(-14, 14); y += rand(4, 22); g.lineTo(x, y); }
    g.stroke();
  }
  // markings: solid edge lines, dashed lane dividers
  g.fillStyle = 'rgba(232,232,222,0.94)';
  for (const x of [-5.3, 5.3]) g.fillRect(px(x) - 0.08 / mPerPx, 0, 0.16 / mPerPx, H);
  const dash = (4 / TEX_LEN) * H;
  for (const x of [-1.75, 1.75]) g.fillRect(px(x) - 0.075 / mPerPx, 0, 0.15 / mPerPx, dash);
  // wear on the paint
  const wear = g.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) if (Math.random() < 0.12) wear.data[i * 4 + 3] = 255, wear.data[i * 4] *= 0.9, wear.data[i * 4 + 1] *= 0.9, wear.data[i * 4 + 2] *= 0.9;
  g.putImageData(wear, 0, 0);
  return c;
}

function skyMaterial(hdr) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    defines: hdr ? {} : { VISIBLE: 1 },
    uniforms: { sunDir: { value: new THREE.Vector3(-0.55, 0.32, 0.77).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 sunDir;
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 horizon = vec3(1.0, 0.62, 0.34);
        vec3 mid = vec3(0.98, 0.78, 0.66);
        vec3 zenith = vec3(0.16, 0.34, 0.66);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.10, h));
        col = mix(col, zenith, smoothstep(0.06, 0.75, h));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.68, 0.36) * pow(s, 8.0) * 0.55;
        col += vec3(1.0, 0.9, 0.7) * pow(s, 400.0) * 12.0;
        col = mix(col, vec3(0.26, 0.2, 0.17), smoothstep(0.0, -0.05, d.y));
        gl_FragColor = vec4(col * 2.0, 1.0);
        #ifdef VISIBLE
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #endif
      }`,
  });
}

function skyScene() {
  const scene = new THREE.Scene();
  const mat = skyMaterial(true);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat));
  return { scene, sunDir: mat.uniforms.sunDir.value };
}

export function createWorld(renderer, scene) {
  const sky = skyScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky.scene, 0.02).texture;
  scene.environmentIntensity = 1.0;
  scene.background = null;
  const visSky = skyMaterial(false);
  visSky.uniforms.sunDir = sky.scene.children[0].material.uniforms.sunDir;
  const skyDome = new THREE.Mesh(sky.scene.children[0].geometry, visSky);
  skyDome.renderOrder = -1; skyDome.frustumCulled = false;
  scene.add(skyDome);

  const fogCol = new THREE.Color(0xf0b58a);
  scene.fog = new THREE.Fog(fogCol, 90, 460);

  // ---- lighting
  const sun = new THREE.DirectionalLight(0xffc48a, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xa8c4ff, 0x6a4a34, 0.9);
  scene.add(hemi);
  const sunDir = sky.sunDir.clone().multiplyScalar(-1); // light travels from the sun

  // ---- road
  const roadT = tex(roadTexture(), 1, ROAD_LEN / TEX_LEN);
  const bumpT = tex(noiseCanvas(256, 256, 128, 120, 0.3), 5, ROAD_LEN / 3, false);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_LEN).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: roadT, bumpMap: bumpT, bumpScale: 1.2, roughness: 0.78, metalness: 0 }));
  road.position.z = -ROAD_LEN / 2 + 40;
  road.receiveShadow = true;
  scene.add(road);

  const grassC = noiseCanvas(256, 256, 96, 60, 0.3);
  const gg = grassC.getContext('2d'); gg.globalCompositeOperation = 'multiply';
  gg.fillStyle = '#7d8a3c'; gg.fillRect(0, 0, 256, 256);
  const grassT = tex(grassC, 30, ROAD_LEN / 8);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassT, roughness: 1, color: 0xc8b070 });
  for (const s of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(240, ROAD_LEN).rotateX(-Math.PI / 2), grassMat);
    g.position.set(s * (ROAD_HALF + 120), -0.05, -ROAD_LEN / 2 + 40);
    g.receiveShadow = true;
    scene.add(g);
  }

  // guard rails: metal beam with posts
  const railC = noiseCanvas(64, 64, 170, 40, 0.1);
  const railMat = new THREE.MeshStandardMaterial({ map: tex(railC, 1, 1), metalness: 0.9, roughness: 0.35 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.6, roughness: 0.6 });
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, ROAD_LEN), railMat);
    beam.position.set(s * (ROAD_HALF + 0.5), 0.6, -ROAD_LEN / 2 + 40);
    beam.castShadow = true; scene.add(beam);
  }

  // ---- scrolling props
  const postGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.7, 8);

  // light poles + trees as instanced meshes
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 9, 8).translate(0, 4.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.7, roughness: 0.45 });
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 4, 7).translate(0, 2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.95 });
  const leafGeo = new THREE.IcosahedronGeometry(2.1, 2);
  const lp = leafGeo.attributes.position, ln = leafGeo.attributes.normal;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i);
    ln.setXYZ(i, x, y * 0.9, z); // smooth, sphere-like shading
    const k = 1 + 0.13 * Math.sin(x * 2.3 + z * 1.7) + 0.09 * Math.sin(y * 3.1 + x * 1.1);
    lp.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  const nn = ln; for (let i = 0; i < nn.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(nn, i).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x6f8f3a, roughness: 0.85 });
  const N_TREES = 64, N_POLES = 24, N_POSTS = 60;
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, N_POLES);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N_TREES);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, N_TREES);
  const posts2 = new THREE.InstancedMesh(postGeo, postMat, N_POSTS);
  for (const m of [poles, trunks, leaves, posts2]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }

  const treeData = Array.from({ length: N_TREES }, (_, i) => ({
    z: 40 - (i >> 1) * 15 - rand(0, 8), x: (i & 1 ? 1 : -1) * rand(ROAD_HALF + 4, ROAD_HALF + 38), s: rand(0.8, 1.7), r: rand(0, 6),
  }));
  const poleData = Array.from({ length: N_POLES }, (_, i) => ({ z: 40 - (i >> 1) * 45, x: (i & 1 ? 1 : -1) * (ROAD_HALF + 1.2) }));
  const postData = Array.from({ length: N_POSTS }, (_, i) => ({ z: 40 - (i >> 1) * 8, x: (i & 1 ? 1 : -1) * (ROAD_HALF + 0.5) }));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();

  // distant hills
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x6d5a6e, fog: true });
  for (let i = 0; i < 26; i++) {
    const w = rand(60, 160), h = rand(18, 60);
    const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 7, 1), hillMat.clone());
    m.material.color.setHSL(0.78 - Math.random() * 0.05, 0.18, rand(0.32, 0.5));
    m.position.set(-420 + i * 33 + rand(-15, 15), h / 2 - 4, -430 - rand(0, 40));
    scene.add(m);
  }

  // ---- traffic
  const paints = [0xb8b8bc, 0x111114, 0xf4f4f4, 0x9c1414, 0x1b3f7a, 0x2f5d3a, 0xc9a227, 0x5b5f66];
  const paintCache = new Map();
  const paint = (c) => {
    if (!paintCache.has(c)) paintCache.set(c, new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 }));
    return paintCache.get(c);
  };
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0c1218, metalness: 0.9, roughness: 0.05 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8c8cc, metalness: 1, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x990000, emissive: 0xff1010, emissiveIntensity: 1.6 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });

  function extrudeProfile(pts, width, bevel = 0.07) {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 6 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(width / 2 - bevel, 0, 0);
    return geo;
  }
  function addWheels(g, xs, zs, r = 0.32) {
    const geo = new THREE.CylinderGeometry(r, r, 0.24, 24).rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.26, 16).rotateZ(Math.PI / 2);
    for (const x of xs) for (const z of zs) {
      const w = new THREE.Mesh(geo, tyreMat), rm = new THREE.Mesh(rim, rimMat);
      w.position.set(x, r, z); rm.position.copy(w.position);
      w.castShadow = true; g.add(w, rm);
    }
  }
  function makeCar(kind) {
    const g = new THREE.Group();
    const col = pick(paints);
    if (kind === 'truck') {
      const cab = new THREE.Mesh(extrudeProfile([[-4, 0.5], [-4, 2.0], [-3.2, 3.0], [-2.3, 3.05], [-2.3, 0.5]], 2.4), paint(col));
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.9, 5.6), paint(pick([0xf4f4f4, 0xd8d8d8, 0x2b4c8c, 0xffffff])));
      box.position.set(0, 2.05, 1.3);
      const win = new THREE.Mesh(extrudeProfile([[-3.85, 2.05], [-3.15, 2.85], [-2.4, 2.85], [-2.4, 2.05]], 2.44, 0.02), glassMat);
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 8), trimMat); chassis.position.set(0, 0.6, 0);
      g.add(cab, box, win, chassis);
      addWheels(g, [-1.05, 1.05], [-2.9, 2.2, 3.5], 0.5);
      for (const x of [-0.95, 0.95]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, 0.05), tailMat); t.position.set(x, 0.85, 4.14); g.add(t); }
      g.userData = { halfW: 1.3, halfL: 4.0 };
    } else {
      const suv = kind === 'suv';
      const prof = suv
        ? [[2.25, 0.3], [2.3, 1.5], [1.9, 1.75], [-0.5, 1.75], [-1.25, 1.15], [-2.2, 0.95], [-2.3, 0.6], [-2.2, 0.3]]
        : [[2.2, 0.3], [2.25, 0.98], [1.5, 1.02], [0.9, 1.43], [-0.6, 1.43], [-1.2, 1.03], [-2.15, 0.92], [-2.25, 0.6], [-2.2, 0.3]];
      const body = new THREE.Mesh(extrudeProfile(prof, 1.85), paint(col)); body.castShadow = true;
      const glass = new THREE.Mesh(extrudeProfile(suv
        ? [[2.0, 1.15], [1.9, 1.68], [-0.45, 1.68], [-1.15, 1.18]]
        : [[1.45, 1.03], [0.88, 1.38], [-0.58, 1.38], [-1.15, 1.04]], 1.87, 0.02), glassMat);
      const bump = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.12), trimMat); bump.position.set(0, 0.42, suv ? 2.42 : 2.36);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.02), plateMat); plate.position.set(0, 0.62, suv ? 2.44 : 2.38);
      g.add(body, glass, bump, plate);
      for (const x of [-0.7, 0.7]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.05), tailMat); t.position.set(x, suv ? 1.2 : 0.86, suv ? 2.42 : 2.36); g.add(t); }
      addWheels(g, [-0.9, 0.9], [-1.4, 1.45]);
      g.userData = { halfW: 0.95, halfL: 2.3 };
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  const cars = [];
  function spawnCar(z, pace = 20) {
    const kind = pick(['sedan', 'sedan', 'suv', 'suv', 'truck']);
    const lane = (Math.random() * 3) | 0;
    for (const c of cars) if (c.lane === lane && Math.abs(c.z - z) < 38) return false;
    const mesh = makeCar(kind);
    const { halfW, halfL } = mesh.userData;
    const car = { mesh, lane, x: LANES[lane], z, speed: pace * (kind === 'truck' ? rand(0.4, 0.55) : rand(0.45, 0.72)), halfW, halfL, passed: false };
    mesh.position.set(car.x, 0, z);
    scene.add(mesh);
    cars.push(car);
    return true;
  }

  const world = {
    sun, sunDir, cars, dist: 0,
    update(dt, speed, focus) {
      const d = speed * dt;
      world.dist += d;
      roadT.offset.y = (world.dist / TEX_LEN) % 1;
      grassT.offset.y = (world.dist / 8) % 1;
      bumpT.offset.y = (world.dist / 3) % 1;
      for (let i = 0; i < N_TREES; i++) {
        const t = treeData[i];
        t.z += d;
        if (t.z > 40) { t.z -= (N_TREES >> 1) * 15 + rand(0, 20); t.x = (i & 1 ? 1 : -1) * rand(ROAD_HALF + 4, ROAD_HALF + 38); t.s = rand(0.8, 1.7); }
        Q.setFromEuler(E.set(0, t.r, 0)); S.set(t.s, t.s, t.s);
        trunks.setMatrixAt(i, M.compose(V.set(t.x, 0, t.z), Q, S));
        leaves.setMatrixAt(i, M.compose(V.set(t.x, 4.2 * t.s, t.z), Q, S));
      }
      for (let i = 0; i < N_POLES; i++) {
        const p = poleData[i]; p.z += d; if (p.z > 40) p.z -= (N_POLES >> 1) * 45;
        Q.setFromEuler(E.set(0, p.x < 0 ? 0 : Math.PI, 0));
        poles.setMatrixAt(i, M.compose(V.set(p.x, 0, p.z), Q, S.set(1, 1, 1)));
      }
      for (let i = 0; i < N_POSTS; i++) {
        const p = postData[i]; p.z += d; if (p.z > 40) p.z -= (N_POSTS >> 1) * 8;
        posts2.setMatrixAt(i, M.compose(V.set(p.x, 0.35, p.z), Q.identity(), S.set(1, 1, 1)));
      }
      for (const m of [trunks, leaves, poles, posts2]) m.instanceMatrix.needsUpdate = true;

      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        c.z += (speed - c.speed) * dt;
        c.mesh.position.z = c.z;
        if (c.z > 30 || c.z < -420) { scene.remove(c.mesh); cars.splice(i, 1); }
      }
      skyDome.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, -30);
      sun.target.position.copy(focus);
    },
    spawnCar, reset() { for (const c of cars) scene.remove(c.mesh); cars.length = 0; world.dist = 0; },
  };
  return world;
}
