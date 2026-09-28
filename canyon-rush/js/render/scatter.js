// Everything that grows or lies on the ground: sandstone boulders, pebbles,
// saguaro cacti (which break when you hit them), desert scrub, dry grass, the
// oasis palms and a few dead trees. All modelled in code, drawn with instancing,
// and streamed in around the camera by distance.
import * as THREE from 'three';
import { mergeGeometries, weld, noise3, fbm3, fillAttribute } from './geomutil.js';
import { canvasTexture } from './textures.js';
import { useTerrainLight } from './shaderpatch.js';
import { rng } from '../noise.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;

function lin(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

// Shared world-space varyings for the shader patches below.
const WPOS_VERT = /* glsl */ `
  vec4 sWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sWp = instanceMatrix * sWp;
  #endif
  sWp = modelMatrix * sWp;
  vSWorld = sWp.xyz;
  vec3 sN = objectNormal;
  #ifdef USE_INSTANCING
    sN = mat3(instanceMatrix) * sN;
  #endif
  vSNormal = normalize(mat3(modelMatrix) * sN);
`;

const PERTURB_GLSL = /* glsl */ `
  vec3 perturbNormalH(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
    vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
    vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
    vec3 vN = surf_norm;
    vec3 R1 = cross(vSigmaY, vN);
    vec3 R2 = cross(vN, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDir;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
`;

// ---------- Textures ----------

function bushTexture() {
  const r = rng(31);
  return canvasTexture(512, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    // Twigs radiating from the base.
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.6;
      const len = (0.35 + r() * 0.6) * H;
      let x = W / 2 + (r() - 0.5) * 40, y = H - 4;
      g.strokeStyle = `rgba(${70 + r() * 30},${55 + r() * 20},${40 + r() * 15},1)`;
      g.lineWidth = 2 + r() * 2.5;
      g.beginPath();
      g.moveTo(x, y);
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        x += Math.cos(a + (r() - 0.5) * 0.6) * len / steps;
        y += Math.sin(a + (r() - 0.5) * 0.6) * len / steps;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Small leaves in clumps, denser toward the dome's edge.
    for (let i = 0; i < 2600; i++) {
      const a = Math.PI + r() * Math.PI;
      const d = Math.pow(r(), 0.45);
      const x = W / 2 + Math.cos(a) * d * W * 0.47;
      const y = H - 8 + Math.sin(a) * d * H * 0.9;
      const t = r();
      g.fillStyle = t < 0.62 ? `rgba(${88 + r() * 40},${100 + r() * 35},${48 + r() * 20},1)` : t < 0.85 ? `rgba(${120 + r() * 30},${118 + r() * 20},${70 + r() * 20},1)` : `rgba(${140 + r() * 30},${110 + r() * 20},${70},1)`;
      g.beginPath();
      g.ellipse(x, y, 2.5 + r() * 3.5, 1.5 + r() * 2, r() * TAU, 0, TAU);
      g.fill();
    }
  }, { repeat: false });
}

function grassTexture() {
  const r = rng(47);
  return canvasTexture(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x0 = W / 2 + (r() - 0.5) * W * 0.35;
      const lean = (r() - 0.5) * W * 0.9;
      const h = H * (0.45 + r() * 0.55);
      const c = r();
      g.strokeStyle = c < 0.5 ? `rgb(${190 + r() * 40},${160 + r() * 30},${95 + r() * 30})` : c < 0.85 ? `rgb(${160 + r() * 30},${130 + r() * 25},${80 + r() * 20})` : `rgb(${120},${120 + r() * 20},${70})`;
      g.lineWidth = 1.2 + r() * 1.6;
      g.beginPath();
      g.moveTo(x0, H);
      g.quadraticCurveTo(x0 + lean * 0.3, H - h * 0.6, x0 + lean, H - h);
      g.stroke();
    }
  }, { repeat: false });
}

function frondTexture() {
  const r = rng(53);
  // Left half: a live green frond; right half: a dead, dry one. Canvas top is the
  // frond tip (v = 1), the bottom its base.
  return canvasTexture(512, 1024, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    for (const dead of [false, true]) {
      const cx = dead ? W * 0.75 : W * 0.25;
      const n = 150;
      for (let i = 0; i < n; i++) {
        const t = 0.06 + (i / n) * 0.92;              // 0 at the base, 1 at the tip
        const y = (1 - t) * H;
        const len = W * 0.29 * Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI), 0.6) * (0.85 + r() * 0.25);
        for (const s of [-1, 1]) {
          const ang = (dead ? 0.42 : 0.62) + (r() - 0.5) * 0.2;   // angle away from the rib, toward the tip
          const ex = cx + s * Math.sin(ang) * len, ey = y - Math.cos(ang) * len;
          g.strokeStyle = dead
            ? `rgb(${135 + r() * 40},${105 + r() * 30},${62 + r() * 20})`
            : `rgb(${58 + r() * 34},${92 + r() * 36},${38 + r() * 18})`;
          g.lineWidth = 5 + r() * 3;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(cx, y);
          g.quadraticCurveTo(cx + s * Math.sin(ang) * len * 0.55, y - Math.cos(ang) * len * 0.3, ex, ey + (dead ? 18 : 6));
          g.stroke();
        }
      }
      g.strokeStyle = dead ? 'rgb(150,125,85)' : 'rgb(125,125,72)';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(cx, H);
      g.lineTo(cx, H * 0.02);
      g.stroke();
    }
  }, { repeat: false });
}

function barkTexture() {
  const r = rng(61);
  return canvasTexture(256, 512, (g, W, H) => {
    g.fillStyle = '#806b56';
    g.fillRect(0, 0, W, H);
    // Palm trunk: overlapping leaf-base scales in a diamond pattern.
    for (let y = 0; y < H + 32; y += 28) {
      for (let x = (y / 28) % 2 ? 0 : 16; x < W + 32; x += 32) {
        const l = 92 + r() * 42;
        g.fillStyle = `rgb(${l + 28},${l + 14},${l - 6})`;
        g.beginPath();
        g.moveTo(x, y - 14);
        g.lineTo(x + 16, y);
        g.lineTo(x, y + 14);
        g.lineTo(x - 16, y);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(45,34,24,0.75)';
        g.lineWidth = 3;
        g.stroke();
      }
    }
  }, { repeat: true });
}

// ---------- Geometry ----------

// A sandstone boulder: a blobby, slightly blocky rock with a flat base.
function rockGeometry(seed, detail = 2) {
  const n = noise3(seed * 13 + 1);
  const g = weld(new THREE.IcosahedronGeometry(1, detail));
  const pos = g.attributes.position;
  const ao = new Float32Array(pos.count);
  const r = rng(seed);
  const sx = 0.85 + r() * 0.5, sy = 0.55 + r() * 0.35, sz = 0.8 + r() * 0.45;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Squarer silhouette, then noisy.
    const p = 0.72;
    x = Math.sign(x) * Math.pow(Math.abs(x), p);
    y = Math.sign(y) * Math.pow(Math.abs(y), p);
    z = Math.sign(z) * Math.pow(Math.abs(z), p);
    const d = 1 + 0.28 * fbm3(n, x * 1.6, y * 1.6, z * 1.6, 3) + 0.06 * n(x * 7, y * 7, z * 7);
    x *= d * sx; y *= d * sy; z *= d * sz;
    if (y < -0.25) y = -0.25 + (y + 0.25) * 0.25;
    pos.setXYZ(i, x, y, z);
    ao[i] = clamp(0.55 + (d - 1) * 1.6 + (y + 0.3) * 0.35, 0.3, 1);
  }
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.computeVertexNormals();
  return g;
}

// A saguaro: ribbed trunk and up-curving arms. `aRib` carries the angle around
// each column so the shader can draw ribs.
function saguaroGeometry(variant, low) {
  const r = rng(variant * 97 + 5);
  const radial = low ? 8 : 20;
  const H = 6 + r() * 1.5;
  const R = 0.3;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(R * 0.96, R, H, radial, low ? 3 : 10, false);
  trunk.translate(0, H / 2, 0);
  // Rounded crown.
  const cap = new THREE.SphereGeometry(R * 0.96, radial, low ? 3 : 8, 0, TAU, 0, Math.PI / 2);
  cap.translate(0, H, 0);
  for (const g of [trunk, cap]) {
    fillAttribute(g, 'aRib', 1, (i) => {
      const x = g.attributes.position.getX(i), z = g.attributes.position.getZ(i);
      return Math.atan2(z, x) / TAU;
    });
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const arms = [0, 1, 2, 2, 3][variant % 5];
  for (let a = 0; a < arms; a++) {
    const ang = (a / Math.max(1, arms)) * TAU + r() * 1.2;
    const h0 = H * (0.35 + r() * 0.3);
    const out = 0.55 + r() * 0.35;
    const up = 1.2 + r() * 1.6;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const pts = [
      new THREE.Vector3(0, h0, 0),
      dir.clone().multiplyScalar(out * 0.6).setY(h0 + 0.05),
      dir.clone().multiplyScalar(out).setY(h0 + 0.35),
      dir.clone().multiplyScalar(out).setY(h0 + up),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const ar = R * (0.62 + r() * 0.15);
    const tube = new THREE.TubeGeometry(curve, low ? 5 : 16, ar, radial, false);
    fillAttribute(tube, 'aRib', 1, (i) => tube.attributes.uv.getY(i));
    tube.deleteAttribute('uv');
    parts.push(tube);
    const tip = new THREE.SphereGeometry(ar, radial, low ? 2 : 6, 0, TAU, 0, Math.PI / 2);
    tip.translate(pts[3].x, pts[3].y, pts[3].z);
    fillAttribute(tip, 'aRib', 1, (i) => {
      const x = tip.attributes.position.getX(i) - pts[3].x, z = tip.attributes.position.getZ(i) - pts[3].z;
      return Math.atan2(z, x) / TAU;
    });
    tip.deleteAttribute('uv');
    parts.push(tip);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  g.userData.height = H;
  return g;
}

// Scrub bush: a fan of crossing cards whose normals point out from the centre,
// so they light like a rounded shrub rather than flat planes.
function bushGeometry() {
  const cards = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const p = new THREE.PlaneGeometry(1.7, 1.1, 2, 2);
    p.translate(0, 0.52, 0);
    p.rotateY((i / n) * Math.PI);
    cards.push(p);
  }
  const top = new THREE.PlaneGeometry(1.4, 1.4, 1, 1);
  top.rotateX(-Math.PI / 2);
  top.translate(0, 0.72, 0);
  const g = mergeGeometries([...cards, top]);
  const pos = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i) - 0.15, pos.getZ(i)).normalize();
    v.y = v.y * 0.7 + 0.45;
    v.normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function grassGeometry() {
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(0.9, 0.6, 1, 1);
    p.translate(0, 0.3, 0);
    p.rotateY((i / 3) * Math.PI);
    cards.push(p);
  }
  const g = mergeGeometries(cards);
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

// Date palm: curved trunk plus a crown of arching fronds and a skirt of dead ones.
function palmGeometry(seed) {
  const r = rng(seed * 7 + 3);
  const H = 8 + r() * 3;
  const lean = new THREE.Vector3((r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6);
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(lean.x * t * t, t * H, lean.z * t * t));
  }
  const spine = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(spine, 18, 0.26, 12, false);
  // Taper toward the top.
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const t = clamp(y / H, 0, 1);
    const c = spine.getPoint(t);
    const k = 1.15 - 0.35 * t;
    tp.setXYZ(i, c.x + (tp.getX(i) - c.x) * k, y, c.z + (tp.getZ(i) - c.z) * k);
  }
  trunk.computeVertexNormals();
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * H / 1.2);
  const top = spine.getPoint(1);
  // The crown sits on a bulky boot of old leaf bases.
  const boot = new THREE.CylinderGeometry(0.48, 0.24, 1.6, 12, 2, true);
  boot.translate(top.x, top.y - 0.75, top.z);
  const trunkAll = mergeGeometries([trunk, boot]);

  const fronds = [];
  const count = 28;
  for (let i = 0; i < count; i++) {
    const dead = i >= 22;
    const young = i < 6;
    const ang = i * 2.39996 + r() * 0.3;
    const len = dead ? 2.4 + r() : young ? 2.8 + r() : 3.6 + r() * 1.4;
    const rise = dead ? -1.1 : young ? 1.3 + r() * 0.5 : 0.5 + r() * 0.5;
    const segs = 8;
    const geo = new THREE.PlaneGeometry(1.3, len, 2, segs);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const along = (p.getY(k) + len / 2) / len;
      const x = p.getX(k);
      const d = along * len;
      const droop = dead ? -d * 0.9 : rise * d - (young ? 0.12 : 0.22) * d * d;
      const fold = Math.abs(x) * 0.45;
      p.setXYZ(k, x * (1 - along * 0.45), droop + fold, d);
    }
    geo.rotateY(ang);
    geo.translate(top.x, top.y - 0.2, top.z);
    const uvs = geo.attributes.uv;
    for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * 0.5 + (dead ? 0.5 : 0), uvs.getY(k));
    geo.computeVertexNormals();
    fronds.push(geo);
  }
  const frond = mergeGeometries(fronds);
  // Normals mostly up so the crown lights evenly.
  const fn = frond.attributes.normal;
  for (let i = 0; i < fn.count; i++) {
    const v = new THREE.Vector3(fn.getX(i), Math.abs(fn.getY(i)) + 0.6, fn.getZ(i)).normalize();
    fn.setXYZ(i, v.x, v.y, v.z);
  }
  return { trunk: trunkAll, frond, height: H };
}

// Gnarled dead tree: recursive branches of tapering tubes.
function deadTreeGeometry(seed) {
  const r = rng(seed * 11 + 7);
  const parts = [];
  const branch = (start, dir, len, rad, depth) => {
    const pts = [start.clone()];
    let p = start.clone(), d = dir.clone();
    for (let i = 0; i < 4; i++) {
      d.add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.3) * 0.3, (r() - 0.5) * 0.5)).normalize();
      p = p.clone().addScaledVector(d, len / 4);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 8, rad, 6, false);
    const tp = tube.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const t = Math.floor(i / 7) / 8;
      const c = curve.getPoint(Math.min(1, t));
      const k = 1 - t * 0.6;
      tp.setXYZ(i, c.x + (tp.getX(i) - c.x) * k, c.y + (tp.getY(i) - c.y) * k, c.z + (tp.getZ(i) - c.z) * k);
    }
    tube.computeVertexNormals();
    parts.push(tube);
    if (depth > 0) {
      const kids = 2 + Math.floor(r() * 2);
      for (let k = 0; k < kids; k++) {
        const at = curve.getPoint(0.45 + r() * 0.5);
        const nd = d.clone().add(new THREE.Vector3((r() - 0.5) * 1.6, 0.3 + r() * 0.6, (r() - 0.5) * 1.6)).normalize();
        branch(at, nd, len * (0.55 + r() * 0.2), rad * 0.55, depth - 1);
      }
    }
  };
  branch(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 1, 0), 2.6 + r(), 0.2, 2);
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }));
  return g;
}

// ---------- Materials ----------

function rockMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: tex.noise };
    shader.uniforms.tCell = { value: tex.cell };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO;\nvarying float vAO;\nvarying vec3 vSWorld;\nvarying vec3 vSNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;\n' + WPOS_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tNoise;
        uniform sampler2D tCell;
        varying float vAO;
        varying vec3 vSWorld;
        varying vec3 vSNormal;
        ${PERTURB_GLSL}
        vec4 tri(sampler2D t, vec3 p, vec3 w, float s) {
          return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
        }`)
      .replace('#include <map_fragment>', `
        vec3 tw = pow(abs(vSNormal), vec3(4.0));
        tw /= tw.x + tw.y + tw.z;
        vec4 ra = tri(tNoise, vSWorld, tw, 0.21);
        vec4 rb = tri(tNoise, vSWorld, tw, 0.9);
        vec4 rc = tri(tCell, vSWorld, tw, 0.35);
        float hy = vSWorld.y + (ra.r - 0.5) * 3.0;
        vec3 rock = mix(${lin('#8e5438')}, ${lin('#a66a45')}, 0.5 + 0.5 * sin(hy * 0.21));
        rock = mix(rock, ${lin('#bf9d7c')}, smoothstep(0.7, 0.95, ra.a) * 0.35);
        rock *= 0.76 + 0.42 * rb.r;
        // Desert varnish: a dark patina streaking the steep sides.
        float varnish = smoothstep(0.4, 0.8, ra.g + (rb.b - 0.5) * 0.3) * (1.0 - smoothstep(0.2, 0.75, vSNormal.y));
        rock = mix(rock, ${lin('#3b2a21')}, varnish * 0.5);
        rock *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, rc.g));
        // Dust settles on top surfaces.
        rock = mix(rock, ${lin('#c29563')}, smoothstep(0.55, 0.9, vSNormal.y + (rb.g - 0.5) * 0.4) * 0.55);
        diffuseColor.rgb *= rock * mix(0.55, 1.0, vAO);
        float rockH = (ra.g * 0.6 + rb.b * 0.4 + rc.r * 0.3);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = perturbNormalH(-vViewPosition, normal, vec2(dFdx(rockH), dFdy(rockH)) * 2.4, faceDirection);`);
  };
  m.customProgramCacheKey = () => 'rock';
  return useTerrainLight(m);
}

function cactusMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: tex.noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRib;\nvarying float vRib;\nvarying vec3 vSWorld;\nvarying vec3 vSNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRib = aRib;\n' + WPOS_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tNoise;
        varying float vRib;
        varying vec3 vSWorld;
        varying vec3 vSNormal;
        ${PERTURB_GLSL}`)
      .replace('#include <map_fragment>', `
        float ribPhase = vRib * 6.2831853 * 18.0;
        float rib = cos(ribPhase);
        vec4 cn = texture2D(tNoise, vec2(vRib * 3.0, vSWorld.y * 0.35));
        vec3 green = mix(${lin('#3f5a34')}, ${lin('#6f8452')}, smoothstep(-0.6, 0.9, rib) * 0.8 + cn.r * 0.25);
        // Spines as tiny bright flecks on the ridges.
        float spines = smoothstep(0.82, 0.95, texture2D(tNoise, vec2(vRib * 40.0, vSWorld.y * 5.0)).b) * smoothstep(0.3, 0.9, rib);
        green = mix(green, ${lin('#cdbf9a')}, spines * 0.7);
        diffuseColor.rgb *= green;
        float ribH = rib * 0.02;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = perturbNormalH(-vViewPosition, normal, vec2(dFdx(ribH), dFdy(ribH)) * 6.0, faceDirection);`);
  };
  m.customProgramCacheKey = () => 'cactus';
  return useTerrainLight(m);
}

// Foliage cards: alpha-tested, wind-swayed, and glowing a little when backlit by the sun.
function foliageMaterial(map, shared, { sway = 0.08, backlight = 0.5, mipAlpha = 0, key }) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uSunDir = shared.uSunDir;
    shader.uniforms.uSunCol = shared.uSunCol;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vSWorld;\nvarying vec3 vSNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float ph = uTime * 1.7 + ip.x * 0.13 + ip.z * 0.17;
          float amt = ${sway.toFixed(3)} * max(transformed.y, 0.0);
          transformed.x += (sin(ph) + 0.4 * sin(ph * 2.7)) * amt;
          transformed.z += (cos(ph * 0.8) + 0.4 * sin(ph * 3.1)) * amt * 0.6;
        }
        ` + WPOS_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunCol;\nvarying vec3 vSWorld;\nvarying vec3 vSNormal;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        #if defined(USE_MAP) && ${mipAlpha > 0 ? 1 : 0}
        {
          // Mipmapping averages thin leaves away; scale alpha back up with the mip level.
          vec2 tsz = vec2(textureSize(map, 0));
          vec2 ddx = dFdx(vMapUv * tsz), ddy = dFdy(vMapUv * tsz);
          float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
          diffuseColor.a *= 1.0 + mip * ${mipAlpha.toFixed(2)};
        }
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 vdir = normalize(vSWorld - cameraPosition);
          float back = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * back * ${backlight.toFixed(2)};
        }`);
  };
  m.customProgramCacheKey = () => 'foliage-' + key;
  return useTerrainLight(m);
}

// ---------- Streaming layer ----------

class Layer {
  // lods: [{ geometry, material, maxDist, shadow }], matrices: Float32Array(n * 16)
  constructor(scene, lods, matrices, colors = null, { cell = 48, radius = 2 } = {}) {
    this.n = matrices.length / 16;
    this.matrices = matrices;
    this.colors = colors;
    this.radius = radius;
    this.hidden = new Uint8Array(this.n);
    this.lods = lods.map((l) => {
      const mesh = new THREE.InstancedMesh(l.geometry, l.material, this.n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = !!l.shadow;
      mesh.receiveShadow = true;
      if (colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
      scene.add(mesh);
      return { ...l, mesh, max2: l.maxDist * l.maxDist };
    });
    this.maxDist = Math.max(...lods.map((l) => l.maxDist));
    // Spatial grid.
    this.cell = cell;
    this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const x = matrices[i * 16 + 12], z = matrices[i * 16 + 14];
      const key = Math.floor(x / cell) * 100003 + Math.floor(z / cell);
      let a = this.grid.get(key);
      if (!a) this.grid.set(key, (a = []));
      a.push(i);
    }
    this.lastPos = new THREE.Vector3(1e9, 0, 0);
    this.lastDir = new THREE.Vector3();
    this._s = new THREE.Sphere();
  }

  update(cam, frustum, force = false, keepNear = 0) {
    const p = cam.position;
    const dir = cam.getWorldDirection(Layer._d);
    if (!force && p.distanceToSquared(this.lastPos) < 16 && dir.dot(this.lastDir) > 0.985) return;
    this.lastPos.copy(p);
    this.lastDir.copy(dir);
    const counts = this.lods.map(() => 0);
    const c = this.cell;
    const R = this.maxDist;
    const cx0 = Math.floor((p.x - R) / c), cx1 = Math.floor((p.x + R) / c);
    const cz0 = Math.floor((p.z - R) / c), cz1 = Math.floor((p.z + R) / c);
    const M = this.matrices;
    const S = this._s;
    const keep2 = keepNear * keepNear;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(cx * 100003 + cz);
        if (!list) continue;
        for (const i of list) {
          if (this.hidden[i]) continue;
          const o = i * 16;
          const dx = M[o + 12] - p.x, dz = M[o + 14] - p.z;
          const d2 = dx * dx + dz * dz;
          let li = -1;
          for (let k = 0; k < this.lods.length; k++) if (d2 < this.lods[k].max2) { li = k; break; }
          if (li < 0) continue;
          if (d2 > keep2) {
            S.center.set(M[o + 12], M[o + 13], M[o + 14]);
            S.radius = this.radius * Math.hypot(M[o], M[o + 1], M[o + 2]) + 2;
            if (!frustum.intersectsSphere(S)) continue;
          }
          const L = this.lods[li];
          const j = counts[li]++;
          L.mesh.instanceMatrix.array.set(M.subarray(o, o + 16), j * 16);
          if (this.colors) L.mesh.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), j * 3);
        }
      }
    }
    this.lods.forEach((L, k) => {
      L.mesh.count = counts[k];
      L.mesh.instanceMatrix.clearUpdateRanges();
      L.mesh.instanceMatrix.addUpdateRange(0, counts[k] * 16);
      L.mesh.instanceMatrix.needsUpdate = true;
      if (this.colors) {
        L.mesh.instanceColor.clearUpdateRanges();
        L.mesh.instanceColor.addUpdateRange(0, counts[k] * 3);
        L.mesh.instanceColor.needsUpdate = true;
      }
    });
  }
}
Layer._d = new THREE.Vector3();

// ---------- Scatter manager ----------

export class Scatter {
  constructor(scene, world, phys, tex, atmo, quality = {}) {
    const S = world.scatter;
    const q = { dist: 1, density: 1, ...quality };
    this.scene = scene;
    this.shared = {
      uTime: { value: 0 },
      uSunDir: { value: atmo.sunDir },
      uSunCol: { value: atmo.sunColor.clone().multiplyScalar(4) },
    };
    this.layers = [];
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this.cacti = [];

    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);

    // --- Boulders (4 shapes) and pebbles.
    const rockMat = rockMaterial(tex);
    const rockHi = [0, 1, 2, 3].map((k) => rockGeometry(k + 1, 3));
    const rockLo = [0, 1, 2, 3].map((k) => rockGeometry(k + 1, 1));
    const byVar = (arr, stride, varIdx, fn) => {
      const lists = [[], [], [], []];
      for (let i = 0; i < arr.length; i += stride) lists[arr[i + varIdx] & 3].push(i);
      return lists.map((l) => l.map(fn));
    };
    const boulderMats = byVar(S.boulders, 8, 7, (i) => {
      const B = S.boulders;
      const size = B[i + 3];
      e.set((B[i + 5] - 0.5) * 0.5, B[i + 4], (B[i + 6] - 0.5) * 0.5);
      q4.setFromEuler(e);
      v.set(B[i], B[i + 1] + size * 0.12, B[i + 2]);
      s.set(size, size, size);
      m4.compose(v, q4, s);
      // Big ones are obstacles.
      if (size > 0.9) phys.addObstacle({ kind: 'sphere', x: B[i], z: B[i + 2], center: new THREE.Vector3(B[i], B[i + 1] + size * 0.2, B[i + 2]), radius: size * 0.72 });
      return m4.toArray();
    });
    boulderMats.forEach((list, k) => {
      if (!list.length) return;
      this.layers.push(new Layer(scene, [
        { geometry: rockHi[k], material: rockMat, maxDist: 140 * q.dist, shadow: true },
        { geometry: rockLo[k], material: rockMat, maxDist: 650 * q.dist, shadow: false },
      ], Float32Array.from(list.flat()), null, { radius: 1.3 }));
    });
    const pebbleMats = [], pebbleCols = [];
    const stoneTints = [[0.78, 0.74, 0.72], [0.55, 0.5, 0.48], [0.95, 0.9, 0.86], [0.7, 0.62, 0.56]];
    for (let i = 0; i < S.rocks.length; i += 8) {
      if (q.density < 1 && (i / 8) % 2) continue;
      const R = S.rocks;
      const size = R[i + 3];
      e.set(R[i + 5] * 2, R[i + 4], R[i + 6] * 2);
      q4.setFromEuler(e);
      v.set(R[i], R[i + 1] - size * 0.04, R[i + 2]);
      s.set(size, size * 0.7, size);
      pebbleMats.push(...m4.compose(v, q4, s).toArray());
      pebbleCols.push(...stoneTints[R[i + 7] & 3]);
    }
    this.layers.push(new Layer(scene, [{ geometry: rockLo[1], material: rockMat, maxDist: 70 * q.dist, shadow: false }], Float32Array.from(pebbleMats), Float32Array.from(pebbleCols), { radius: 1.2 }));

    // --- Saguaros: five shapes, detailed up close and simple further out.
    const cactusMat = cactusMaterial(tex);
    const cacHi = [0, 1, 2, 3, 4].map((k) => saguaroGeometry(k, false));
    const cacLo = [0, 1, 2, 3, 4].map((k) => saguaroGeometry(k, true));
    this.cactusLayers = [];
    for (let k = 0; k < 5; k++) {
      const mats = [];
      const idx = [];
      for (let i = 0; i < S.cacti.length; i += 6) {
        if ((S.cacti[i + 5] | 0) !== k) continue;
        const C = S.cacti;
        const sc = C[i + 3];
        q4.setFromAxisAngle(Y, C[i + 4]);
        v.set(C[i], C[i + 1] - 0.15, C[i + 2]);
        s.set(sc, sc, sc);
        mats.push(...m4.compose(v, q4, s).toArray());
        idx.push(i);
      }
      if (!mats.length) continue;
      const layer = new Layer(scene, [
        { geometry: cacHi[k], material: cactusMat, maxDist: 220 * q.dist, shadow: true },
        { geometry: cacLo[k], material: cactusMat, maxDist: 900 * q.dist, shadow: false },
      ], Float32Array.from(mats), null, { radius: 5 });
      this.cactusLayers.push(layer);
      this.layers.push(layer);
      idx.forEach((i, j) => {
        const C = S.cacti;
        const ob = {
          kind: 'cyl', x: C[i], z: C[i + 2], base: C[i + 1] - 0.2, height: cacHi[k].userData.height * C[i + 3],
          radius: 0.34 * C[i + 3], breakable: true, type: 'cactus', layer, index: j, scale: C[i + 3], variant: k,
        };
        phys.addObstacle(ob);
        this.cacti.push(ob);
      });
    }
    this.cactusGeos = cacHi;
    this.cactusMat = cactusMat;

    // --- Scrub bushes with per-instance tints (green, grey-green, dry).
    const bushMat = foliageMaterial(bushTexture(), this.shared, { sway: 0.05, backlight: 0.45, key: 'bush' });
    const bushGeo = bushGeometry();
    const bm = [], bc = [];
    const tints = [[0.85, 0.95, 0.75], [0.95, 0.98, 0.9], [1.1, 0.95, 0.72], [0.8, 0.9, 0.85]];
    for (let i = 0; i < S.bushes.length; i += 6) {
      if (q.density < 1 && (i / 6) % 2) continue;
      const B = S.bushes;
      const sc = B[i + 3];
      q4.setFromAxisAngle(Y, B[i + 4]);
      v.set(B[i], B[i + 1] - 0.08, B[i + 2]);
      s.set(sc * 1.1, sc * (0.8 + (B[i + 4] % 1) * 0.4), sc * 1.1);
      bm.push(...m4.compose(v, q4, s).toArray());
      bc.push(...tints[B[i + 5] & 3]);
    }
    this.layers.push(new Layer(scene, [{ geometry: bushGeo, material: bushMat, maxDist: 320 * q.dist, shadow: false }], Float32Array.from(bm), Float32Array.from(bc), { radius: 1.2 }));

    // --- Dry grass tufts near the camera.
    const grassMat = foliageMaterial(grassTexture(), this.shared, { sway: 0.18, backlight: 0.9, mipAlpha: 0.1, key: 'grass' });
    const gm = [];
    for (let i = 0; i < S.grass.length; i += 6) {
      if (q.density < 1 && (i / 6) % 2) continue;
      const G = S.grass;
      const sc = G[i + 3];
      q4.setFromAxisAngle(Y, G[i + 4]);
      v.set(G[i], G[i + 1] - 0.03, G[i + 2]);
      s.set(sc, sc * (0.7 + (G[i + 5] % 3) * 0.2), sc);
      gm.push(...m4.compose(v, q4, s).toArray());
    }
    this.layers.push(new Layer(scene, [{ geometry: grassGeometry(), material: grassMat, maxDist: 110 * q.dist, shadow: false }], Float32Array.from(gm), null, { radius: 0.8 }));

    // --- Oasis palms (a handful, so plain meshes).
    const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95, color: 0xd8c8b4 });
    useTerrainLight(bark);
    const frondTex = frondTexture();
    frondTex.wrapS = THREE.ClampToEdgeWrapping;
    const frondMat = foliageMaterial(frondTex, this.shared, { sway: 0.03, backlight: 0.7, mipAlpha: 0.3, key: 'frond' });
    frondMat.color.set(0xffffff);
    for (let i = 0; i < S.palms.length; i += 6) {
      const P = S.palms;
      const pg = palmGeometry(i + 3);
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(pg.trunk, bark);
      const frond = new THREE.Mesh(pg.frond, frondMat);
      trunk.castShadow = frond.castShadow = true;
      trunk.receiveShadow = frond.receiveShadow = true;
      g.add(trunk, frond);
      g.position.set(P[i], P[i + 1] - 0.2, P[i + 2]);
      g.rotation.y = P[i + 4];
      g.scale.setScalar(P[i + 3]);
      scene.add(g);
      phys.addObstacle({ kind: 'cyl', x: P[i], z: P[i + 2], base: P[i + 1] - 0.5, height: pg.height * P[i + 3], radius: 0.32 * P[i + 3], breakable: false, type: 'palm' });
    }

    // --- Dead trees.
    const deadMat = new THREE.MeshStandardMaterial({ color: 0x8a8076, roughness: 0.9 });
    useTerrainLight(deadMat);
    const deadGeo = [0, 1, 2].map((k) => deadTreeGeometry(k));
    for (let k = 0; k < 3; k++) {
      const mats = [];
      for (let i = 0; i < S.deadTrees.length; i += 6) {
        if ((S.deadTrees[i + 5] | 0) !== k) continue;
        const D = S.deadTrees;
        q4.setFromAxisAngle(Y, D[i + 4]);
        v.set(D[i], D[i + 1], D[i + 2]);
        s.setScalar(D[i + 3]);
        mats.push(...m4.compose(v, q4, s).toArray());
        phys.addObstacle({ kind: 'cyl', x: D[i], z: D[i + 2], base: D[i + 1] - 0.2, height: 3 * D[i + 3], radius: 0.22 * D[i + 3], breakable: false, type: 'tree' });
      }
      if (mats.length) this.layers.push(new Layer(scene, [{ geometry: deadGeo[k], material: deadMat, maxDist: 600 * q.dist, shadow: true }], Float32Array.from(mats), null, { radius: 4 }));
    }
  }

  // Hide a smashed cactus.
  breakCactus(ob) {
    ob.layer.hidden[ob.index] = 1;
    ob.layer.update(this._lastCam, this.frustum, true, 60);
  }

  update(dt, camera) {
    this.shared.uTime.value += dt;
    this._lastCam = camera;
    // Gather with a wider view than the camera's, so turning doesn't reveal gaps
    // before the next refresh.
    const cam = camera;
    const near = 0.5, far = 2000;
    const fov = THREE.MathUtils.degToRad(Math.min(170, cam.fov + 28));
    const top = near * Math.tan(fov / 2);
    const right = top * Math.max(cam.aspect, 1) * 1.15;
    this._proj = this._proj || new THREE.Matrix4();
    this._proj.makePerspective(-right, right, top, -top, near, far);
    this._m.multiplyMatrices(this._proj, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    for (const L of this.layers) L.update(cam, this.frustum, false, 60);
  }
}

export { saguaroGeometry };
