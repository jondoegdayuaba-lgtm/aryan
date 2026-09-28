// The trophy truck's 3D model, built from code: extruded body panels with wheel
// arches, a glass cab, fibreglass fender flares, light bar, bed with two spare
// tyres, long-travel suspension that moves with the wheels, and knobbly tyres
// with real tread blocks. Paint is a clear-coated livery that gathers dust.
import * as THREE from 'three';
import { canvasTexture } from '../render/textures.js';
import { useTerrainLight } from '../render/shaderpatch.js';
import { mergeGeometries } from '../render/geomutil.js';

export const LIVERIES = [
  { name: 'Desert Fox', base: '#eeebe4', stripe: '#ff5f14', stripe2: '#1a1a1d', number: '27', flare: '#1a1a1d', metal: 0.05, sponsor: 'DUNE FUEL' },
  { name: 'Red Mesa', base: '#a8121b', stripe: '#f1eee8', stripe2: '#141414', number: '7', flare: '#141414', metal: 0.45, sponsor: 'RED MESA' },
  { name: 'Blue Streak', base: '#1846a8', stripe: '#ffcf33', stripe2: '#0b1631', number: '12', flare: '#0b1631', metal: 0.5, sponsor: 'SANDGRIP' },
  { name: 'Night Rider', base: '#16171a', stripe: '#86e03b', stripe2: '#3a3d42', number: '99', flare: '#0d0d0f', metal: 0.3, sponsor: 'CANYON RUSH' },
];

const Z_FRONT = -3.1, Z_LEN = 6.0;   // livery canvas spans z in [-3.1, 2.9]
const Y_LOW = -0.3, Y_LEN = 1.0;     // and y in [-0.3, 0.7]

// ---------- Geometry helpers ----------

// Extrudes a side profile (shape in z/y) across the truck's width along x.
function extrudeX(shape, width, bevel = 0.03, curveSegments = 14) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 3, curveSegments,
  });
  g.rotateY(-Math.PI / 2);
  g.translate((width - 2 * bevel) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

// Livery UVs: side faces map the (z, y) position onto the canvas; the right side
// reads from the lower half with the design mirrored so text stays readable.
function liveryUVs(g) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nrm.getX(i);
    const v = THREE.MathUtils.clamp((y - Y_LOW) / Y_LEN, 0, 1);
    if (nx < -0.6) uv.setXY(i, (z - Z_FRONT) / Z_LEN, 0.5 + v * 0.5);
    else if (nx > 0.6) uv.setXY(i, 1 - (z - Z_FRONT) / Z_LEN, v * 0.5);
    else uv.setXY(i, 0.002, 0.998);   // a pixel of plain base colour
    void x;
  }
  uv.needsUpdate = true;
  return g;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// A cylinder mesh stretched between two points (updated every frame for suspension).
class Strut {
  constructor(material, radius, segments = 10) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, segments, 1), material);
    this.mesh.castShadow = true;
  }
  set(a, b) {
    const m = this.mesh;
    m.position.addVectors(a, b).multiplyScalar(0.5);
    const d = Strut._d.subVectors(b, a);
    const len = d.length();
    m.scale.set(1, Math.max(1e-3, len), 1);
    m.quaternion.setFromUnitVectors(Strut._up, d.multiplyScalar(1 / (len || 1)));
  }
}
Strut._d = new THREE.Vector3();
Strut._up = new THREE.Vector3(0, 1, 0);

function helixGeometry(radius, turns, tube, height = 1) {
  const pts = [];
  const n = turns * 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t * height - height / 2, Math.sin(a) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tube, 6, false);
}

// ---------- Textures ----------

function drawLivery(L) {
  return canvasTexture(2048, 1024, (g, W, H) => {
    const half = H / 2;
    for (const side of [0, 1]) {
      g.save();
      g.translate(0, side * half);
      g.beginPath();
      g.rect(0, 0, W, half);
      g.clip();
      // Right side (bottom half) is mirrored so the design runs front-to-back on both sides.
      if (side === 1) { g.translate(W, 0); g.scale(-1, 1); }
      g.fillStyle = L.base;
      g.fillRect(0, 0, W, half);
      // Sweeping stripes from the front wheel back along the doors.
      const sweep = (col, y0, y1, slant) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(W * 0.1, y0);
        g.lineTo(W * 0.93, y0 - slant);
        g.lineTo(W * 0.93, y1 - slant);
        g.lineTo(W * 0.1 - 60, y1);
        g.closePath();
        g.fill();
      };
      sweep(L.stripe, half * 0.58, half * 0.8, half * 0.12);
      sweep(L.stripe2, half * 0.81, half * 0.87, half * 0.12);
      sweep(L.stripe2, half * 0.52, half * 0.555, half * 0.12);
      g.restore();

      // Text is drawn unmirrored on both sides.
      g.save();
      g.translate(0, side * half);
      const X = (fz) => (side === 0 ? fz : 1 - fz) * W;   // fz = fraction along the truck from the front
      // Number panel on the door.
      const nx = X(0.43), ny = half * 0.33;
      g.fillStyle = '#ffffff';
      g.strokeStyle = L.stripe2;
      g.lineWidth = 10;
      g.beginPath();
      g.roundRect(nx - 130, ny - 95, 260, 190, 26);
      g.fill();
      g.stroke();
      g.fillStyle = '#111';
      g.font = 'italic 900 170px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(L.number, nx, ny + 8);
      // Sponsor on the bed side.
      g.font = 'italic 800 92px "Arial Black", Impact, sans-serif';
      g.fillStyle = L.stripe2;
      g.fillText(L.sponsor, X(0.75), half * 0.36);
      // Small decals by the front wheel.
      g.font = 'bold 44px Arial, sans-serif';
      g.fillStyle = L.stripe2;
      g.fillText('SANDGRIP', X(0.2), half * 0.3);
      g.fillText('OFF-ROAD', X(0.2), half * 0.38);
      g.restore();
    }
  }, { mipmaps: true });
}

function drawSidewall() {
  return canvasTexture(2048, 128, (g, W, H) => {
    g.fillStyle = '#161616';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#6b6b6b';
    g.font = 'bold 30px Arial, sans-serif';
    g.textBaseline = 'middle';
    for (const y of [H * 0.2, H * 0.8]) {
      for (let i = 0; i < 3; i++) {
        g.fillText('SANDGRIP  M/T  40x15.50R17  LT', (i / 3) * W + 40, y);
      }
    }
  }, { repeat: true });
}

// ---------- Materials ----------

// Dust that collects low on the truck. uDirt 0..1 is raised as you drive.
function addDirt(material, shared) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.uniforms.uDirt = shared.uDirt;
    shader.uniforms.uBodyInv = shared.uBodyInv;
    shader.uniforms.tDirtNoise = shared.tNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uBodyInv;\nvarying vec3 vBodyPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyPos = (uBodyInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDirt;\nuniform sampler2D tDirtNoise;\nvarying vec3 vBodyPos;\nfloat dirtAmt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 dn = texture2D(tDirtNoise, vBodyPos.xz * 0.35 + vBodyPos.y * 0.2);
          float h = vBodyPos.y + (dn.r - 0.5) * 0.5 + (dn.b - 0.5) * 0.15;
          dirtAmt = clamp(uDirt * 1.3 - smoothstep(-0.55, 0.9, h), 0.0, 1.0) * (0.55 + 0.45 * dn.g);
          dirtAmt = max(dirtAmt, uDirt * 0.18 * dn.a);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.29, 0.19), dirtAmt);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, dirtAmt);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, dirtAmt);');
    if (shader.fragmentShader.includes('#include <clearcoat_normal_fragment_begin>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - dirtAmt;\n#endif');
    }
  };
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + '|dirt';
  return material;
}

export class TruckModel {
  constructor(tex, liveryIndex = 0) {
    this.root = new THREE.Group();
    this.shared = {
      uDirt: { value: 0.05 },
      uBodyInv: { value: new THREE.Matrix4() },
      tNoise: { value: tex.noise },
    };
    const S = this.shared;
    const prep = (m, dirt = true) => {
      if (dirt) addDirt(m, S);
      useTerrainLight(m);
      return m;
    };

    this.mat = {
      paint: prep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.045 })),
      paintPlain: prep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.045 })),
      flare: prep(new THREE.MeshPhysicalMaterial({ color: 0x1a1a1d, roughness: 0.45, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.2 })),
      glass: prep(new THREE.MeshPhysicalMaterial({ color: 0x07090b, roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }), false),
      trim: prep(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.2 })),
      chassis: prep(new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.5, metalness: 0.6 })),
      alu: prep(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.28, metalness: 1.0 })),
      rim: prep(new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.32, metalness: 0.85 })),
      rubber: prep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 })),
      tread: prep(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.93, metalness: 0 })),
      spring: prep(new THREE.MeshStandardMaterial({ color: 0xff7a14, roughness: 0.35, metalness: 0.3 }), false),
      shock: prep(new THREE.MeshStandardMaterial({ color: 0xd9b56a, roughness: 0.25, metalness: 1.0 }), false),
      arm: prep(new THREE.MeshStandardMaterial({ color: 0x2e3035, roughness: 0.4, metalness: 0.8 })),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 6, roughness: 0.2 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a0a, emissiveIntensity: 3.5, roughness: 0.3 }),
      amber: new THREE.MeshStandardMaterial({ color: 0x553300, emissive: 0xff8a1a, emissiveIntensity: 2.5, roughness: 0.3 }),
      flag: new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.8, side: THREE.DoubleSide }),
      caliper: prep(new THREE.MeshStandardMaterial({ color: 0xc81d1d, roughness: 0.35, metalness: 0.4 }), false),
    };
    this.mat.rubber.map = drawSidewall();

    this._buildBody();
    this._buildWheels();
    this._buildSuspension();
    this.setLivery(liveryIndex);

    this._mergeStatic();
    for (const w of this.wheels) this._mergeGroup(w.spinner);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this._v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() };
    this.flagPhase = 0;
  }

  // Fewer draw calls: bake every static part of the body into one mesh per
  // material. Moving parts (wheels, suspension, antenna) are left alone.
  _mergeStatic() {
    const moving = new Set();
    for (const w of this.wheels) moving.add(w.pivot);
    for (const s of this.struts) moving.add(s.mesh);
    for (const f of this.front) moving.add(f.coil);
    for (const c of this.rear.coils) moving.add(c);
    moving.add(this.rear.diff);
    moving.add(this.whip);
    this._mergeGroup(this.body, moving);
  }

  _mergeGroup(group, skip = new Set()) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    const remove = [];
    const visit = (o) => {
      if (skip.has(o)) return;
      if (o.isMesh && !o.isInstancedMesh) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(g);
        remove.push(o);
      }
      for (const c of o.children) visit(c);
    };
    for (const c of group.children) visit(c);
    for (const o of remove) o.parent.remove(o);
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list);
      merged.computeBoundingSphere();
      group.add(new THREE.Mesh(merged, mat));
    }
  }

  setLivery(i) {
    this.liveryIndex = i;
    const L = LIVERIES[i];
    this.mat.paint.map?.dispose();
    this.mat.paint.map = drawLivery(L);
    this.mat.paint.metalness = L.metal;
    this.mat.paint.needsUpdate = true;
    this.mat.paintPlain.color.set(L.base);
    this.mat.paintPlain.metalness = L.metal;
    this.mat.flare.color.set(L.flare);
  }

  add(parent, geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  _buildBody() {
    const M = this.mat;
    const body = new THREE.Group();
    this.body = body;
    this.root.add(body);

    // ---- Main body: hood, doors and bed sides in one extruded profile.
    const s = new THREE.Shape();
    s.moveTo(-2.84, -0.12);
    s.lineTo(-2.98, 0.08);
    s.lineTo(-3.03, 0.3);
    s.quadraticCurveTo(-3.02, 0.45, -2.88, 0.49);
    s.bezierCurveTo(-2.3, 0.56, -1.7, 0.63, -1.22, 0.64);
    s.lineTo(0.52, 0.63);
    s.lineTo(0.56, 0.3);
    s.lineTo(2.66, 0.3);
    s.lineTo(2.74, 0.18);
    s.lineTo(2.76, -0.02);
    s.lineTo(2.62, -0.12);
    const a0 = Math.asin(0.04 / 0.64);
    s.lineTo(2.46, -0.12);
    s.absarc(1.76, -0.16, 0.64, a0, Math.PI - a0, false);
    s.lineTo(-1.04, -0.12);
    s.absarc(-1.74, -0.16, 0.64, a0, Math.PI - a0, false);
    s.lineTo(-2.84, -0.12);
    const bodyGeo = liveryUVs(extrudeX(s, 1.86, 0.035));
    this.add(body, bodyGeo, M.paint);

    // Bed walls and tailgate (painted), with the bed floor left open.
    this.add(body, liveryUVs(box(0.06, 0.34, 2.12, -0.9, 0.46, 1.62)), M.paint);
    this.add(body, liveryUVs(box(0.06, 0.34, 2.12, 0.9, 0.46, 1.62)), M.paint);
    this.add(body, box(1.8, 0.34, 0.06, 0, 0.46, 2.7), M.paintPlain);
    this.add(body, box(1.8, 0.36, 0.06, 0, 0.47, 0.6), M.paintPlain);
    this.add(body, box(1.74, 0.02, 2.05, 0, 0.31, 1.64), M.trim);

    // ---- Cab.
    const c = new THREE.Shape();
    c.moveTo(-1.2, 0.6);
    c.lineTo(-0.5, 1.15);
    c.quadraticCurveTo(-0.42, 1.21, -0.3, 1.215);
    c.lineTo(0.3, 1.205);
    c.quadraticCurveTo(0.4, 1.2, 0.43, 1.13);
    c.lineTo(0.55, 0.6);
    c.lineTo(-1.2, 0.6);
    this.add(body, liveryUVs(extrudeX(c, 1.66, 0.04)), M.paint);

    // Windows: windshield, side glass (split by the B pillar), rear window.
    // A quad whose winding is chosen so it faces `out`.
    const glassQuad = (a, b, c2, d, out) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), vc = new THREE.Vector3(...c2);
      const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
      const flip = n.dot(new THREE.Vector3(...out)) < 0;
      const tris = flip ? [...a, ...c2, ...b, ...a, ...d, ...c2] : [...a, ...b, ...c2, ...a, ...c2, ...d];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      g.computeVertexNormals();
      return g;
    };
    const ws = 0.012;
    this.add(body, glassQuad([-0.72, 0.66 + ws, -1.12 - ws], [0.72, 0.66 + ws, -1.12 - ws], [0.72, 1.12 + ws, -0.54 - ws], [-0.72, 1.12 + ws, -0.54 - ws], [0, 0.6, -0.8]), M.glass);
    this.add(body, glassQuad([0.7, 0.68 + ws, 0.49 + ws], [-0.7, 0.68 + ws, 0.49 + ws], [-0.7, 1.11 + ws, 0.39 + ws], [0.7, 1.11 + ws, 0.39 + ws], [0, 0.25, 1]), M.glass);
    const sideWin = (pts, x) => {
      const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
      const g = new THREE.ShapeGeometry(sh);
      // ShapeGeometry lies in the xy plane facing +z; turn it so shape x runs along z
      // (it then faces -x) and mirror the right-hand windows to face +x.
      g.rotateY(-Math.PI / 2);
      if (x > 0) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      }
      g.translate(x, 0, 0);
      g.computeVertexNormals();
      return g;
    };
    for (const sx of [-1, 1]) {
      const x = sx * 0.842;
      this.add(body, sideWin([[-1.08, 0.68], [-0.54, 1.11], [-0.12, 1.12], [-0.12, 0.68]], x), M.glass);
      this.add(body, sideWin([[-0.02, 0.68], [-0.02, 1.12], [0.3, 1.11], [0.44, 0.68]], x), M.glass);
    }

    // ---- Fender flares (black fibreglass) around all four wheels.
    for (const zc of [-1.74, 1.76]) {
      const f = new THREE.Shape();
      const r0 = 0.64, r1 = zc < 0 ? 0.79 : 0.81;
      f.absarc(0, 0, r1, -0.08, Math.PI + 0.08, false);
      f.absarc(0, 0, r0, Math.PI + 0.08, -0.08, true);
      const g = extrudeX(f, 0.2, 0.02, 20);
      for (const sx of [-1, 1]) {
        const m = this.add(body, g, M.flare);
        m.position.set(sx * 1.02, -0.16, zc);
      }
      // Inner wheel-well liners close off the body behind the tyres.
      const liner = new THREE.CylinderGeometry(0.66, 0.66, 1.7, 24, 1, true, -0.05, Math.PI + 0.1);
      liner.rotateZ(Math.PI / 2);
      const lm = this.add(body, liner, M.trim);
      lm.position.set(0, -0.16, zc);
      lm.material = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9, side: THREE.BackSide });
      useTerrainLight(lm.material);
    }

    // ---- Front end: grille, headlights, bumper tube, skid plate.
    this.add(body, box(1.2, 0.22, 0.03, 0, 0.3, -3.035), M.trim);
    for (const sx of [-1, 1]) {
      this.add(body, box(0.34, 0.045, 0.03, sx * 0.62, 0.43, -3.02), M.lamp);          // LED eyebrow
      const pod = new THREE.CylinderGeometry(0.085, 0.09, 0.07, 20);
      pod.rotateX(Math.PI / 2);
      pod.translate(sx * 0.46, 0.14, -3.08);
      this.add(body, pod, M.trim);
      const lens = new THREE.CircleGeometry(0.07, 20);
      lens.rotateY(Math.PI);
      lens.translate(sx * 0.46, 0.14, -3.117);
      this.add(body, lens, M.lamp);
    }
    const bumperPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.95, -0.05, -2.7), new THREE.Vector3(-0.85, -0.02, -3.08), new THREE.Vector3(0, 0.0, -3.16),
      new THREE.Vector3(0.85, -0.02, -3.08), new THREE.Vector3(0.95, -0.05, -2.7),
    ]);
    this.add(body, new THREE.TubeGeometry(bumperPath, 40, 0.04, 10, false), M.arm);
    this.add(body, box(1.2, 0.03, 0.7, 0, -0.16, -2.72), M.alu);                            // skid plate
    // Hood vents and pins.
    this.add(body, box(0.72, 0.035, 0.42, 0, 0.6, -1.95), M.trim);
    for (const sx of [-1, 1]) {
      const pin = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12);
      pin.translate(sx * 0.62, 0.53, -2.75);
      this.add(body, pin, M.alu);
    }

    // ---- Roof: light bar, scoop, antenna.
    this.add(body, box(1.46, 0.1, 0.13, 0, 1.3, -0.36), M.trim);
    this.add(body, box(1.38, 0.055, 0.02, 0, 1.3, -0.43), M.lamp);
    for (const sx of [-1, 1]) this.add(body, box(0.05, 0.1, 0.08, sx * 0.5, 1.245, -0.35), M.trim);
    this.add(body, box(0.46, 0.14, 0.62, 0, 1.28, 0.08), M.paintPlain);
    this.add(body, box(0.4, 0.09, 0.02, 0, 1.29, -0.235), M.trim);
    // Mirrors.
    for (const sx of [-1, 1]) {
      this.add(body, box(0.05, 0.13, 0.2, sx * 0.97, 0.8, -1.02), M.trim);
      this.add(body, box(0.12, 0.03, 0.03, sx * 0.9, 0.76, -1.02), M.trim);
    }

    // ---- Rear: tail lights, bumper, bed cage, exhausts, mud flaps.
    for (const sx of [-1, 1]) {
      this.add(body, box(0.2, 0.07, 0.02, sx * 0.72, 0.52, 2.745), M.tail);
      this.add(body, box(0.06, 0.06, 0.02, sx * 0.86, 0.12, 2.785), M.amber);
      const ex = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 14, 1, true);
      ex.rotateX(Math.PI / 2);
      ex.translate(sx * 0.55, -0.16, 2.68);
      this.add(body, ex, M.alu);
      this.add(body, box(0.36, 0.26, 0.012, sx * 1.0, -0.4, 2.52), M.trim);
    }
    const rearBar = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.92, 0.0, 2.6), new THREE.Vector3(-0.9, 0.02, 2.86), new THREE.Vector3(0.9, 0.02, 2.86), new THREE.Vector3(0.92, 0.0, 2.6),
    ]);
    this.add(body, new THREE.TubeGeometry(rearBar, 30, 0.04, 10, false), M.arm);
    const cage = [
      [[-0.86, 0.62, 0.7], [-0.86, 1.18, 0.9], [-0.86, 1.14, 2.4], [-0.86, 0.62, 2.62]],
      [[0.86, 0.62, 0.7], [0.86, 1.18, 0.9], [0.86, 1.14, 2.4], [0.86, 0.62, 2.62]],
    ];
    for (const pts of cage) {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.1);
      this.add(body, new THREE.TubeGeometry(curve, 40, 0.032, 8, false), M.arm);
    }
    for (const z of [0.9, 2.4]) {
      const bar = new THREE.CylinderGeometry(0.032, 0.032, 1.72, 8);
      bar.rotateZ(Math.PI / 2);
      bar.translate(0, z === 0.9 ? 1.18 : 1.14, z);
      this.add(body, bar, M.arm);
    }

    // Chassis rails and belly.
    this.add(body, box(1.3, 0.2, 5.0, 0, -0.1, -0.05), M.chassis);

    // Whip antenna with a flag.
    this.whip = new THREE.Group();
    this.whip.position.set(0.84, 1.14, 2.4);
    body.add(this.whip);
    const pole = new THREE.CylinderGeometry(0.008, 0.012, 1.9, 6);
    pole.translate(0, 0.95, 0);
    this.add(this.whip, pole, M.trim);
    const flag = new THREE.PlaneGeometry(0.34, 0.22, 6, 1);
    flag.translate(0.17, 1.75, 0);
    flag.rotateY(-Math.PI / 2);
    this.flagMesh = this.add(this.whip, flag, M.flag);
    this.flagBase = Float32Array.from(flag.attributes.position.array);
  }

  _makeWheel() {
    const M = this.mat;
    const R = 0.5, W = 0.38, rIn = 0.235, carcass = R - 0.03;
    const g = new THREE.Group();
    // Tyre carcass: rounded cross-section spun around the axle.
    const pts = [];
    const c = 0.07;
    const side = (t, y0) => pts.push(new THREE.Vector2(THREE.MathUtils.lerp(rIn, carcass - c, t), y0 * (W / 2 + 0.012 * Math.sin(t * Math.PI))));
    for (let i = 0; i <= 6; i++) side(i / 6, -1);
    for (let i = 1; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(carcass - c + c * Math.cos(a), -(W / 2 - c) + c * Math.sin(a)));
    }
    pts.push(new THREE.Vector2(carcass, -(W / 2 - c)), new THREE.Vector2(carcass, W / 2 - c));
    for (let i = 1; i < 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(carcass - c + c * Math.cos(a), (W / 2 - c) + c * Math.sin(a)));
    }
    for (let i = 6; i >= 0; i--) side(i / 6, 1);
    const tyre = new THREE.LatheGeometry(pts, 64);
    tyre.rotateZ(Math.PI / 2);
    this.add(g, tyre, M.rubber);

    // Tread lugs: two staggered centre rows and chunky shoulder blocks.
    const lugs = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      lugs.push([a, 0.075, 0.12, 0.034, 0.088, 0.12]);
      lugs.push([a + Math.PI / N, -0.075, 0.12, 0.034, 0.088, -0.12]);
      lugs.push([a, W / 2 - 0.045, 0.1, 0.036, 0.1, 0.05]);
      lugs.push([a + Math.PI / N, -(W / 2 - 0.045), 0.1, 0.036, 0.1, -0.05]);
    }
    const lugGeo = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const lugParts = lugs.map(([a, x, w, h, l, skew]) => {
      const r = carcass + h / 2 - 0.006;
      p.set(x, Math.cos(a) * r, Math.sin(a) * r);
      e.set(a, skew, 0, 'XYZ');
      q.setFromEuler(e);
      sc.set(w, h, l);
      return lugGeo.clone().applyMatrix4(m4.compose(p, q, sc));
    });
    this.add(g, mergeGeometries(lugParts), M.tread);

    // Beadlock wheel: barrel, spoked face, bolt ring, cap.
    const barrel = new THREE.CylinderGeometry(0.215, 0.215, 0.3, 32, 1, true);
    barrel.rotateZ(Math.PI / 2);
    this.add(g, barrel, M.rim);
    const faceShape = new THREE.Shape();
    faceShape.absarc(0, 0, 0.215, 0, Math.PI * 2, false);
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2 + 0.24, a1 = ((i + 1) / 6) * Math.PI * 2 - 0.24;
      const hole = new THREE.Path();
      hole.absarc(0, 0, 0.175, a0, a1, false);
      hole.absarc(0, 0, 0.085, a1 - 0.1, a0 + 0.1, true);
      faceShape.holes.push(hole);
    }
    const face = new THREE.ExtrudeGeometry(faceShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
    face.rotateY(Math.PI / 2);
    face.translate(0.06, 0, 0);
    this.add(g, face, M.rim);
    const ring = new THREE.TorusGeometry(0.228, 0.02, 8, 40);
    ring.rotateY(Math.PI / 2);
    ring.translate(0.15, 0, 0);
    this.add(g, ring, M.alu);
    const boltGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6);
    boltGeo.rotateZ(Math.PI / 2);
    const boltParts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      boltParts.push(boltGeo.clone().applyMatrix4(m4.makeTranslation(0.17, Math.cos(a) * 0.228, Math.sin(a) * 0.228)));
    }
    this.add(g, mergeGeometries(boltParts), M.alu);
    const cap = new THREE.CylinderGeometry(0.055, 0.06, 0.05, 16);
    cap.rotateZ(Math.PI / 2);
    cap.translate(0.09, 0, 0);
    this.add(g, cap, M.alu);
    return g;
  }

  _buildWheels() {
    const M = this.mat;
    this.wheels = [];
    const spec = [
      { x: -1.03, z: -1.74, front: true }, { x: 1.03, z: -1.74, front: true },
      { x: -1.03, z: 1.76, front: false }, { x: 1.03, z: 1.76, front: false },
    ];
    for (const s of spec) {
      const pivot = new THREE.Group();          // moves with suspension, steers
      const spinner = this._makeWheel();        // spins
      if (s.x < 0) spinner.scale.x = -1;        // rim faces outward on both sides
      pivot.add(spinner);
      // Brake disc and caliper (steer but don't spin).
      const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 28);
      disc.rotateZ(Math.PI / 2);
      disc.translate(Math.sign(s.x) * -0.04, 0, 0);
      this.add(pivot, disc, M.alu);
      this.add(pivot, box(0.07, 0.12, 0.1, Math.sign(s.x) * -0.02, 0.12, 0.1), M.caliper);
      this.body.add(pivot);
      this.wheels.push({ ...s, pivot, spinner });
    }

    // Two spares standing in the bed.
    this.spares = [];
    for (const sx of [-0.45, 0.45]) {
      const sp = this._makeWheel();
      sp.position.set(sx, 0.31 + 0.5, 1.72);
      sp.rotation.set(0, 0, 0);
      if (sx < 0) sp.scale.x = -1;
      this.body.add(sp);
      this.spares.push(sp);
    }
    // Strap over the spares.
    this.add(this.body, box(1.3, 0.02, 0.06, 0, 1.24, 1.72), this.mat.trim);
  }

  _buildSuspension() {
    const M = this.mat;
    this.struts = [];
    const mk = (mat, r) => {
      const s = new Strut(mat, r);
      this.body.add(s.mesh);
      this.struts.push(s);
      return s;
    };
    // Coil springs: unit-height helices stretched to the shock length.
    const coilGeo = helixGeometry(0.075, 7, 0.013, 1);
    this.front = [];
    for (let i = 0; i < 2; i++) {
      this.front.push({
        upperF: mk(M.arm, 0.022), upperR: mk(M.arm, 0.022),
        lowerF: mk(M.arm, 0.026), lowerR: mk(M.arm, 0.026),
        shock: mk(M.shock, 0.042), shaft: mk(M.alu, 0.018),
        bypass: mk(M.shock, 0.035),
        tie: mk(M.arm, 0.014),
        coil: this.add(this.body, coilGeo, M.spring),
      });
    }
    this.rear = {
      axle: mk(M.arm, 0.07),
      diff: this.add(this.body, new THREE.SphereGeometry(0.19, 20, 14), M.arm),
      links: [mk(M.arm, 0.03), mk(M.arm, 0.03), mk(M.arm, 0.026), mk(M.arm, 0.026)],
      shocks: [mk(M.shock, 0.045), mk(M.shock, 0.045), mk(M.shock, 0.038), mk(M.shock, 0.038)],
      coils: [this.add(this.body, coilGeo, M.spring), this.add(this.body, coilGeo, M.spring)],
    };
    this.rear.diff.scale.set(1, 0.9, 1.2);
  }

  // Sync the model with the physics state. `pos`/`quat` are the interpolated body transform.
  update(dt, vehicle, pos, quat, time) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    this.root.updateMatrixWorld(true);
    this.shared.uBodyInv.value.copy(this.root.matrixWorld).invert();

    const spec = vehicle.spec;
    const V = this._v;
    const centers = [];
    vehicle.wheels.forEach((w, i) => {
      const vis = this.wheels[i];
      const ext = spec.restLength - Math.min(w.comp, spec.maxTravel + 0.06);
      const y = w.mount.y - ext;
      vis.pivot.position.set(w.mount.x, y, w.mount.z);
      vis.pivot.rotation.set(0, w.steer, 0);
      vis.spinner.rotation.x = -w.spin;
      centers.push(new THREE.Vector3(w.mount.x, y, w.mount.z));
    });

    // Front: double A-arms, coilover, bypass shock, tie rod.
    for (let i = 0; i < 2; i++) {
      const s = Math.sign(this.wheels[i].x);
      const c = centers[i];
      const z = c.z;
      const F = this.front[i];
      const up = V.a.set(s * 0.82, c.y + 0.16, z), lo = V.b.set(s * 0.86, c.y - 0.14, z);
      F.upperF.set(V.c.set(s * 0.36, 0.08, z - 0.22), up);
      F.upperR.set(V.c.set(s * 0.36, 0.08, z + 0.22), up);
      F.lowerF.set(V.c.set(s * 0.3, -0.24, z - 0.26), lo);
      F.lowerR.set(V.c.set(s * 0.3, -0.24, z + 0.26), lo);
      const top = V.c.set(s * 0.44, 0.62, z + 0.06), bot = V.d.set(s * 0.72, c.y - 0.08, z + 0.06);
      const len = top.distanceTo(bot);
      F.shock.set(top, V.a.lerpVectors(top, bot, 0.55));
      F.shaft.set(V.a, bot);
      F.coil.position.lerpVectors(top, bot, 0.42);
      F.coil.quaternion.setFromUnitVectors(Strut._up, V.b.subVectors(bot, top).normalize());
      F.coil.scale.set(1, len * 0.62, 1);
      F.bypass.set(V.a.set(s * 0.5, 0.58, z - 0.12), V.b.set(s * 0.76, c.y - 0.04, z - 0.12));
      F.tie.set(V.a.set(s * 0.28, -0.08, z + 0.2), V.b.set(s * 0.84, c.y - 0.02, z + 0.18));
    }

    // Rear: solid axle on a four-link with two coilovers and two bypass shocks per side.
    const L = centers[2], Rr = centers[3];
    const R = this.rear;
    R.axle.set(V.a.set(L.x + 0.1, L.y, L.z), V.b.set(Rr.x - 0.1, Rr.y, Rr.z));
    R.diff.position.set(0.1, (L.y + Rr.y) / 2, L.z - 0.05);
    for (const [k, s] of [[0, -1], [1, 1]]) {
      const c = s < 0 ? L : Rr;
      R.links[k].set(V.a.set(s * 0.55, -0.2, 0.25), V.b.set(s * 0.62, c.y - 0.06, c.z));
      R.links[k + 2].set(V.a.set(s * 0.25, 0.1, 0.55), V.b.set(s * 0.3, c.y + 0.1, c.z));
      const top = V.c.set(s * 0.62, 0.62, c.z - 0.16), bot = V.d.set(s * 0.74, c.y + 0.06, c.z - 0.16);
      R.shocks[k].set(top, bot);
      R.coils[k].position.lerpVectors(top, bot, 0.45);
      R.coils[k].quaternion.setFromUnitVectors(Strut._up, V.a.subVectors(bot, top).normalize());
      R.coils[k].scale.set(1, top.distanceTo(bot) * 0.62, 1);
      R.shocks[k + 2].set(V.a.set(s * 0.64, 0.6, c.z + 0.18), V.b.set(s * 0.76, c.y + 0.04, c.z + 0.18));
    }

    // Flag flutters with speed.
    this.flagPhase += dt * (4 + vehicle.speed * 0.6);
    const fp = this.flagMesh.geometry.attributes.position;
    const base = this.flagBase;
    for (let i = 0; i < fp.count; i++) {
      const along = base[i * 3 + 2];
      const wave = Math.sin(this.flagPhase - along * 18) * 0.04 * Math.min(1, 0.2 + vehicle.speed / 20) * along * 3;
      fp.setX(i, base[i * 3] + wave);
    }
    fp.needsUpdate = true;
    // Antenna sways back under drag and bounces with the body.
    this.whip.rotation.x = THREE.MathUtils.lerp(this.whip.rotation.x, Math.min(0.5, vehicle.forwardSpeed * 0.012) + Math.sin(time * 9) * 0.02, 1 - Math.exp(-dt * 6));
  }

  setDirt(v) {
    this.shared.uDirt.value = v;
  }
}
