// Forests: Scots pines, Norway spruces and birches built from bark-textured
// trunks and alpha-cut branch cards, instanced around the camera. Distant
// trees swap to pre-rendered billboards. Wind sways every tree.
import * as THREE from 'three';
import { patch, G } from './shading.js';
import { bakeLayers } from './bake.js';
import { rng } from './noise.js';

// ---------- Textures ----------

const FOLIAGE_GLSL = [
  // 0: spruce branch. u runs from the trunk to the tip, v across.
  /* glsl */`void main() {
    vec2 uv = vUv; float u = uv.x, v = uv.y - 0.5;
    float w = 0.46 * smoothstep(0.0, 0.22, u) * (1.0 - 0.75 * smoothstep(0.45, 1.0, u)) + 0.05;
    float edge = gn(uv, vec2(6.)) * 0.06 + gn(uv, vec2(19.)) * 0.03;
    float env = smoothstep(w + edge, w + edge - 0.07, abs(v)) * smoothstep(1.0, 0.9, u);
    float core = smoothstep(w * 0.7, w * 0.2, abs(v)) * smoothstep(0.3, 0.6, fbm(uv, 9., 3) * .5 + .5);
    vec3 a = strokes(uv, 26., .9, .16, 6.28, 0., 1.);
    vec3 b = strokes(uv + .37, 38., .85, .15, 6.28, 0., 1.);
    vec3 c = strokes(uv + .71, 18., .95, .15, 6.28, 0., 1.);
    float cov = max(max(max(a.x, b.x), c.x), core * 0.8);
    float id = a.x > b.x ? a.z : b.z;
    float stem = smoothstep(0.022, 0.006, abs(v + gn(uv, vec2(3.)) * 0.02)) * step(u, 0.9);
    vec3 col = mix(vec3(.10, .18, .08), vec3(.18, .28, .12), id);
    col = mix(col, vec3(.30, .41, .18), smoothstep(.6, 1., u) * .55 * step(.45, id));
    col *= mix(.5, 1.0, smoothstep(0., .9, abs(v) / w));
    col = mix(col, vec3(.22, .15, .09), stem * (1. - core * .7));
    gl_FragColor = vec4(col, max(cov * env, stem));
  }`,
  // 1: Scots pine needle tufts on twigs.
  /* glsl */`void main() {
    vec2 uv = vUv;
    float cov = 0., id = 0., twig = 0.;
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      vec2 c = vec2(0.18 + 0.64 * h12(vec2(fk, 1.3)), 0.34 + 0.5 * h12(vec2(fk, 7.9)));
      float L = 0.13 + 0.07 * h12(vec2(fk, 3.1));
      vec2 r = uv - c;
      float d = length(r);
      float ang = atan(r.y, r.x);
      float sectors = 38.;
      float fi = ang / 6.2832 * sectors;
      for (int q = 0; q < 2; q++) {
        float ii = floor(fi) + float(q);
        float th = (ii + (h12(vec2(ii, fk + .5)) - .5) * .8) / sectors * 6.2832;
        float perp = d * abs(sin(ang - th));
        float len = L * (0.65 + 0.35 * h12(vec2(ii, fk + 9.)));
        float wid = 0.0075 * (1.0 - d / len);
        float c1 = step(d, len) * smoothstep(wid, wid * 0.25, perp);
        if (c1 > cov) { cov = c1; id = h12(vec2(fk, 2.2)) * .6 + d / len * .4; }
      }
      // twig from the tuft down to the card base
      vec2 a = vec2(0.5, 0.02), b = c;
      vec2 ab = b - a; float t = clamp(dot(uv - a, ab) / dot(ab, ab), 0., 1.);
      float td = length(uv - (a + ab * t));
      twig = max(twig, smoothstep(0.009, 0.004, td) * step(t, 0.93));
    }
    vec3 col = mix(vec3(.21, .31, .19), vec3(.34, .44, .26), id);
    col = mix(col, vec3(.33, .22, .13), twig * (1. - cov));
    gl_FragColor = vec4(col, max(cov, twig));
  }`,
  // 2: birch: small pointed leaves on drooping twigs.
  /* glsl */`void main() {
    vec2 uv = vUv;
    vec2 cc = uv - vec2(0.5, 0.47);
    float env = smoothstep(0.5, 0.36, length(cc * vec2(1.1, 0.95)) + gn(uv, vec2(5.)) * 0.09);
    vec2 p = uv * 10.;
    vec2 ip = floor(p), fp = fract(p);
    float cov = 0., id = 0., shade = 1.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec3 r = h32(ip + g);
      for (int k = 0; k < 2; k++) {
        vec2 off = k == 0 ? r.xy : fract(r.yx * 3.7 + .3);
        vec2 o = g + off - fp;
        float a = (r.z + float(k) * .37) * 6.2832;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (-o);
        float s = 0.4 + 0.2 * fract(r.z * 7. + float(k) * .5);
        float lx = q.x / s, ly = q.y / (s * 0.6);
        float inside = step(abs(lx), 1.) * step(abs(ly), pow(max(1. - lx * lx, 0.), .8));
        if (inside > .5) { cov = 1.; id = fract(r.z * 13. + float(k) * .41); shade = .72 + .28 * (1. - abs(ly)); }
      }
    }
    vec3 col = mix(vec3(.30, .45, .14), vec3(.45, .59, .21), id);
    col = mix(col, vec3(.62, .60, .24), step(.94, id));
    col *= shade;
    gl_FragColor = vec4(col, cov * env);
  }`,
  // 3: shrub leaves (juniper-dark, dense).
  /* glsl */`void main() {
    vec2 uv = vUv;
    vec2 cc = uv - 0.5;
    float env = smoothstep(0.5, 0.3, length(cc) + gn(uv, vec2(6.)) * 0.12);
    vec3 a = strokes(uv, 26., .7, .16, 6.28, 0., 1.);
    vec3 b = strokes(uv + .5, 38., .7, .15, 6.28, 0., 1.);
    float cov = max(a.x, b.x);
    vec3 col = mix(vec3(.13, .22, .11), vec3(.24, .34, .15), a.x > b.x ? a.z : b.z);
    gl_FragColor = vec4(col, cov * env);
  }`,
];

const BARK_GLSL = [
  // 0: pine, lower trunk: grey-brown plates split by deep vertical fissures
  /* glsl */`void main() {
    vec2 uv = vUv;
    float warp = fbm(vec2(uv.x * 0.5, uv.y), 3., 3) * 0.35;
    float lane = fract(uv.x * 5. + warp);
    float fiss = smoothstep(0.02, 0.16, abs(lane - 0.5) * 2. - 0.0) ;
    fiss = 1. - smoothstep(0.78, 0.98, abs(lane - 0.5) * 2.);
    float cellId = floor(uv.x * 5. + warp);
    float breaks = smoothstep(0.03, 0.0, abs(fract(uv.y * 3. + h12(vec2(cellId, 1.)) ) - 0.5) - 0.47);
    float plate = fbm(uv, 8., 4) * .5 + .5;
    vec3 col = mix(vec3(.36, .30, .26), vec3(.49, .40, .33), plate) * (0.8 + 0.2 * h12(vec2(cellId, floor(uv.y * 3.))));
    col = mix(col, vec3(.52, .32, .20), smoothstep(.62, .9, plate) * .35);
    col = mix(vec3(.12, .09, .07), col, fiss * (1. - breaks * .7));
    gl_FragColor = vec4(col, 1.);
  }`,
  // 1: pine, upper trunk: thin orange flaking bark
  /* glsl */`void main() {
    vec3 v = vor2(vUv, vec2(10., 14.), .9);
    float flake = smoothstep(.02, .12, v.y - v.x);
    float tone = fbm(vUv, 6., 4) * .5 + .5;
    vec3 col = mix(vec3(.62, .34, .18), vec3(.78, .50, .30), tone);
    col = mix(col * .7, col, flake);
    col = mix(col, vec3(.85, .62, .42), step(.8, v.z) * flake * .5);
    gl_FragColor = vec4(col, 1.);
  }`,
  // 2: spruce: grey-brown with small scales
  /* glsl */`void main() {
    vec3 v = vor(vUv, 18., .9);
    float sc = smoothstep(.0, .15, v.y - v.x);
    float tone = fbm(vUv, 5., 4) * .5 + .5;
    vec3 col = mix(vec3(.24, .19, .16), vec3(.38, .31, .26), tone) * mix(.6, 1., sc);
    gl_FragColor = vec4(col, 1.);
  }`,
  // 3: birch: white with thin dark horizontal lenticels and a few black knots
  /* glsl */`void main() {
    vec2 uv = vUv;
    float tone = fbm(uv, 4., 4) * .5 + .5;
    vec3 col = mix(vec3(.78, .76, .71), vec3(.93, .91, .87), tone);
    float rows = 38.;
    float row = floor(uv.y * rows), fy = fract(uv.y * rows);
    float dash = 0.;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float on = step(.35, h12(vec2(row, 1. + fk)));
      float c = h12(vec2(row, 2. + fk));
      float len = .03 + .09 * h12(vec2(row, 3. + fk));
      float du = abs(fract(uv.x - c + .5) - .5);
      dash = max(dash, on * smoothstep(len, len * .5, du) * smoothstep(.32, .12, abs(fy - .5)));
    }
    col = mix(col, vec3(.14, .12, .1), dash * .8);
    float knot = smoothstep(.72, .8, fbm(vec2(uv.x * 2., uv.y * .5) + 7., 3., 4) * .5 + .5);
    col = mix(col, vec3(.08, .07, .07), knot * .85);
    gl_FragColor = vec4(col, 1.);
  }`,
];

// ---------- Geometry ----------

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.layer = []; this.ao = []; this.idx = []; }
  vert(p, n, u, v, layer, ao) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.layer.push(layer);
    this.ao.push(ao);
    return this.pos.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(this.layer, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Tapered, slightly bent trunk. layerAt(t) picks the bark layer by height.
function trunk(b, r, { height, r0, r1, sides = 7, rings = 7, bend = 0.4, layerAt, uRepeat = 2 }) {
  const bx = (r() - 0.5) * bend, bz = (r() - 0.5) * bend;
  const circ = 2 * Math.PI * r0;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = t * height;
    const rad = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.8)) * (j === 0 ? 1.25 : 1);
    const cx = bx * Math.sin(t * Math.PI), cz = bz * Math.sin(t * Math.PI);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const n = V(Math.cos(a), 0.15, Math.sin(a)).normalize();
      b.vert(V(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad), n, (i / sides) * uRepeat, y / (circ * 1.2), layerAt(t), 0.55 + 0.45 * t);
    }
  }
  const row = sides + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * row + i, c = a + row;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  return (t) => V(bx * Math.sin(t * Math.PI), t * height, bz * Math.sin(t * Math.PI));
}

// A card: quad from `o` along `dir` (length) and `side` (width). Normals bend
// toward `outward` so the crown lights like a soft volume.
function card(b, o, dir, side, len, wid, layer, center, ao, uvFlip = false) {
  const p = [
    o.clone().addScaledVector(side, -wid / 2),
    o.clone().addScaledVector(side, wid / 2),
    o.clone().addScaledVector(dir, len).addScaledVector(side, wid / 2),
    o.clone().addScaledVector(dir, len).addScaledVector(side, -wid / 2),
  ];
  const uvs = uvFlip ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
  const ids = p.map((q, k) => {
    const n = q.clone().sub(center);
    n.y = n.y * 0.6 + 0.4 * Math.max(0.3, n.length());
    n.normalize();
    return b.vert(q, n, uvs[k][0], uvs[k][1], layer, ao * (k < 2 ? 0.8 : 1));
  });
  b.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
}

function crossCard(b, o, dir, len, wid, layer, center, ao, r) {
  const up = Math.abs(dir.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  const s1 = new THREE.Vector3().crossVectors(dir, up).normalize();
  const twist = (r() - 0.5) * 1.2;
  s1.applyAxisAngle(dir, twist);
  const s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
  card(b, o, dir, s1, len, wid, layer, center, ao);
  card(b, o, dir, s2, len, wid * 0.85, layer, center, ao);
}

function makeSpruce(seed) {
  const r = rng(seed);
  const H = 20;
  const bark = new Builder(), leaves = new Builder();
  const axis = trunk(bark, r, { height: H, r0: 0.3, r1: 0.03, bend: 0.25, layerAt: () => 2 });
  const whorls = 24;
  for (let k = 0; k < whorls; k++) {
    const t = 0.06 + 0.91 * Math.pow(k / whorls, 0.95);
    const y = t * H;
    const len = Math.pow(1 - t, 0.9) * 3.5 + 0.45;
    const n = 5 + (r() < 0.4 ? 1 : 0);
    const off = k * 2.39996 + r();
    const c = axis(t);
    const center = V(c.x, y - 1.2, c.z);
    for (let j = 0; j < n; j++) {
      const az = off + (j / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
      const droop = 0.28 + 0.4 * r() + 0.15 * (1 - t);
      const dir = V(Math.cos(az) * Math.cos(droop), -Math.sin(droop), Math.sin(az) * Math.cos(droop)).normalize();
      const o = c.clone().add(V(0, 0.15, 0));
      const up = V(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, up).normalize().applyAxisAngle(dir, (r() - 0.5) * 1.8);
      card(leaves, o, dir, side, len, len * 0.58, 0, center, 0.4 + 0.6 * t);
      if (t < 0.6) {
        const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();
        card(leaves, o, dir, side2, len * 0.9, len * 0.45, 0, center, 0.35 + 0.6 * t);
      }
    }
  }
  const top = axis(0.93);
  crossCard(leaves, top, V(0, 1, 0), H * 0.1, 1.1, 0, top, 1, r);
  return { bark: bark.geometry(), leaves: leaves.geometry(), height: H, width: 8 };
}

function makePine(seed) {
  const r = rng(seed);
  const H = 19;
  const bark = new Builder(), leaves = new Builder();
  const axis = trunk(bark, r, {
    height: H * 0.93, r0: 0.3, r1: 0.06, bend: 0.8, rings: 8,
    layerAt: (t) => THREE.MathUtils.clamp((t - 0.35) / 0.3, 0, 1),
  });
  const clusters = 24;
  for (let k = 0; k < clusters; k++) {
    const t = 0.58 + 0.38 * Math.pow(r(), 0.7);
    const c = axis(Math.min(t, 0.93));
    const az = k * 2.39996 + r() * 0.8;
    const reach = (1 - (t - 0.55) / 0.45) * 2.3 + 0.6;
    const tip = c.clone().add(V(Math.cos(az) * reach, 0.5 + r() * 0.8, Math.sin(az) * reach));
    // a bare branch out to the tuft cluster
    const dir = tip.clone().sub(c);
    const L = dir.length();
    dir.normalize();
    const s = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize();
    const u2 = new THREE.Vector3().crossVectors(s, dir).normalize();
    const base = bark.pos.length / 3;
    for (let q = 0; q <= 1; q++) {
      const p = c.clone().addScaledVector(dir, q * L);
      const rad = q ? 0.015 : 0.045;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const n = s.clone().multiplyScalar(Math.cos(a)).addScaledVector(u2, Math.sin(a));
        bark.vert(p.clone().addScaledVector(n, rad), n, i / 4, q, 0, 0.5);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = base + i, b2 = base + ((i + 1) % 4);
      bark.idx.push(a, a + 4, b2, b2, a + 4, b2 + 4);
    }
    const center = V(axis(0.78).x, H * 0.8, axis(0.78).z);
    for (let q = 0; q < 3; q++) {
      const d = V(r() - 0.5, 0.5 + r() * 0.6, r() - 0.5).normalize();
      const sz = 2.4 + r() * 1.0;
      crossCard(leaves, tip.clone().addScaledVector(d, -sz * 0.55), d, sz, sz * 1.1, 1, center, 0.55 + 0.45 * t, r);
    }
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), height: H, width: 7 };
}

function makeBirch(seed) {
  const r = rng(seed);
  const H = 15;
  const bark = new Builder(), leaves = new Builder();
  const axis = trunk(bark, r, { height: H * 0.9, r0: 0.17, r1: 0.04, bend: 0.9, layerAt: () => 3, uRepeat: 1 });
  const center = V(axis(0.65).x, H * 0.66, axis(0.65).z);
  const clusters = 22;
  for (let k = 0; k < clusters; k++) {
    const t = 0.32 + 0.64 * r();
    const c = axis(Math.min(t, 0.9));
    const az = r() * Math.PI * 2;
    const reach = Math.sin(Math.PI * (t - 0.2) / 0.8) * 2.3 + 0.4;
    const top = c.clone().add(V(Math.cos(az) * reach, 0.8 + r() * 0.8, Math.sin(az) * reach));
    const sz = 2.1 + r() * 0.9;
    // drooping cards hang from the twig tip
    const d = V((r() - 0.5) * 0.5, -1, (r() - 0.5) * 0.5).normalize();
    crossCard(leaves, top, d, sz * 1.1, sz, 2, center, 0.55 + 0.45 * t, r);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), height: H, width: 6.5 };
}

// ---------- Materials ----------

function foliageMaterial(tex, depth = false) {
  const opts = {
    uniforms: { uFoliage: { value: tex } },
    vertexPars: /* glsl */`
      attribute float aLayer;
      attribute float aAO;
      varying vec2 vFUv;
      varying float vFLayer;
      varying float vFAO;`,
    vertex: {
      '#include <begin_vertex>': /* glsl */`
        vec3 transformed = vec3( position );
        vFUv = uv; vFLayer = aLayer; vFAO = aAO;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = dot( ip.xz, vec2( 0.131, 0.173 ) );
          float hN = max( position.y, 0.0 ) / 20.0;
          float sway = ( sin( uTime * 1.1 + ph ) * 0.6 + sin( uTime * 2.3 + ph * 1.7 ) * 0.3 ) * hN * hN;
          transformed.xz += uWind * sway * 0.5;
          transformed += normal * sin( uTime * 6.0 + dot( position, vec3( 3.1, 2.3, 1.7 ) ) + ph ) * 0.04 * hN;
        #endif`,
    },
    fragmentPars: /* glsl */`
      uniform mediump sampler2DArray uFoliage;
      varying vec2 vFUv;
      varying float vFLayer;
      varying float vFAO;`,
    fragment: {
      '#include <map_fragment>': /* glsl */`
        vec4 ftex = texture( uFoliage, vec3( vFUv, vFLayer ) );
        // keep leaves from thinning out in the distance (alpha fades with mipmaps)
        vec2 dd = fwidth( vFUv * 512.0 );
        ftex.a *= 1.0 + max( log2( max( dd.x, dd.y ) ), 0.0 ) * 0.33;
        diffuseColor.rgb *= ftex.rgb * vFAO;
        diffuseColor.a = ftex.a;`,
    },
  };
  if (depth) {
    delete opts.fragmentPars;
    opts.fragmentPars = /* glsl */`
      uniform mediump sampler2DArray uFoliage;
      varying vec2 vFUv;
      varying float vFLayer;`;
    opts.fragment = {
      '#include <map_fragment>': /* glsl */`
        vec4 ftex = texture( uFoliage, vec3( vFUv, vFLayer ) );
        vec2 dd = fwidth( vFUv * 512.0 );
        ftex.a *= 1.0 + max( log2( max( dd.x, dd.y ) ), 0.0 ) * 0.33;
        if ( ftex.a < 0.45 ) discard;`,
    };
    opts.vertexPars = opts.vertexPars.replace('varying float vFAO;', 'varying float vFAO;');
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    return patch(m, opts);
  }
  // Leaves glow when the sun shines through them.
  opts.fragment['#include <emissivemap_fragment>'] = /* glsl */`
    vec3 toCam = normalize( cameraPosition - vWorldPosG );
    float through = pow( max( dot( -toCam, uSunDir ), 0.0 ), 4.0 );
    totalEmissiveRadiance += diffuseColor.rgb * uSunCol * through * 0.35 * bakedSun();`;
  // Keep the crown normals facing outward on both sides of each card.
  opts.fragment['#include <normal_fragment_begin>'] = /* glsl */`
    float faceDirection = 1.0;
    vec3 normal = normalize( vNormal );
    vec3 nonPerturbedNormal = normal;`;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45, envMapIntensity: 0.8 });
  return patch(m, opts);
}

function barkMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  return patch(m, {
    uniforms: { uBark: { value: tex } },
    vertexPars: 'attribute float aLayer;\nattribute float aAO;\nvarying vec2 vBUv;\nvarying float vBLayer;\nvarying float vBAO;',
    vertex: {
      '#include <begin_vertex>': /* glsl */`
        vec3 transformed = vec3( position );
        vBUv = uv; vBLayer = aLayer; vBAO = aAO;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = dot( ip.xz, vec2( 0.131, 0.173 ) );
          float hN = max( position.y, 0.0 ) / 20.0;
          transformed.xz += uWind * ( sin( uTime * 1.1 + ph ) * 0.6 + sin( uTime * 2.3 + ph * 1.7 ) * 0.3 ) * hN * hN * 0.5;
        #endif`,
    },
    fragmentPars: 'uniform mediump sampler2DArray uBark;\nvarying vec2 vBUv;\nvarying float vBLayer;\nvarying float vBAO;',
    fragment: {
      '#include <map_fragment>': /* glsl */`
        float l0 = floor( vBLayer );
        vec4 b0 = texture( uBark, vec3( vBUv, l0 ) );
        vec4 b1 = texture( uBark, vec3( vBUv, l0 + 1.0 ) );
        diffuseColor.rgb *= mix( b0.rgb, b1.rgb, fract( vBLayer ) ) * vBAO;`,
    },
  });
}

// Capture shaders write sRGB so the result can be stored as an sRGB texture.
const SRGB_OUT = 'precision highp sampler2DArray; vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); } ';

// Spread edge colours into transparent texels so mipmaps don't grow dark halos.
function bleed(px, W, H, passes = 8) {
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X;
          if (!filled[j]) continue;
          r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; n++;
        }
        if (n) { px[i * 4] = r / n; px[i * 4 + 1] = g / n; px[i * 4 + 2] = b / n; next[i] = 1; }
      }
    }
    filled.set(next);
  }
}

// ---------- Forest ----------

const KINDS = [
  { make: makePine, seed: 11 }, { make: makePine, seed: 23 },
  { make: makeSpruce, seed: 31 }, { make: makeSpruce, seed: 47 },
  { make: makeBirch, seed: 53 }, { make: makeBirch, seed: 67 },
];
// world tree type (0 pine, 1 spruce, 2 birch) -> kinds
const TYPE_KINDS = [[0, 1], [2, 3], [4, 5]];

export class Forest {
  constructor(renderer, world, { maxNear = 2600, maxFar = 16000, nearRange = 260, farRange = 820 } = {}) {
    this.world = world;
    this.nearRange = nearRange;
    this.farRange = farRange;
    this.foliageTex = bakeLayers(renderer, FOLIAGE_GLSL, 512, { wrap: false });
    this.barkTex = bakeLayers(renderer, BARK_GLSL, 256);
    this.group = new THREE.Group();

    const leafMat = foliageMaterial(this.foliageTex);
    const leafDepth = foliageMaterial(this.foliageTex, true);
    const barkMat = barkMaterial(this.barkTex);
    this.kinds = KINDS.map((k) => {
      const t = k.make(k.seed);
      const bark = new THREE.InstancedMesh(t.bark, barkMat, maxNear);
      const leaves = new THREE.InstancedMesh(t.leaves, leafMat, maxNear);
      leaves.instanceMatrix = bark.instanceMatrix;     // shared transforms
      leaves.customDepthMaterial = leafDepth;
      for (const m of [bark, leaves]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.group.add(m);
      }
      return { ...t, bark, leaves, count: 0 };
    });

    // Billboards for distant trees.
    this.impostors = this._makeImpostors(renderer, leafMat, barkMat, maxFar);
    this.group.add(this.impostors);

    // Spatial grid of all trees.
    const trees = world.trees;
    this.count = trees.length;
    this.tx = new Float32Array(trees.length);
    this.ty = new Float32Array(trees.length);
    this.tz = new Float32Array(trees.length);
    this.ts = new Float32Array(trees.length);
    this.tr = new Float32Array(trees.length);
    this.tk = new Uint8Array(trees.length);
    const CELL = 64, CN = Math.ceil(world.N / CELL);
    const buckets = Array.from({ length: CN * CN }, () => []);
    trees.forEach((t, i) => {
      this.tx[i] = t.x; this.ty[i] = t.y - 0.15; this.tz[i] = t.z;
      this.ts[i] = t.scale; this.tr[i] = t.rot;
      const kinds = TYPE_KINDS[t.type];
      this.tk[i] = kinds[(i * 2654435761 >>> 0) % kinds.length];
      const cx = Math.min(CN - 1, Math.max(0, Math.floor((t.x + world.HALF) / CELL)));
      const cz = Math.min(CN - 1, Math.max(0, Math.floor((t.z + world.HALF) / CELL)));
      buckets[cz * CN + cx].push(i);
    });
    this.CELL = CELL;
    this.CN = CN;
    this.cellStart = new Uint32Array(CN * CN + 1);
    this.cellItems = new Uint32Array(trees.length);
    this.cellMinY = new Float32Array(CN * CN);
    this.cellMaxY = new Float32Array(CN * CN);
    let o = 0;
    buckets.forEach((b, c) => {
      this.cellStart[c] = o;
      let lo = Infinity, hi = -Infinity;
      for (const i of b) {
        this.cellItems[o++] = i;
        lo = Math.min(lo, this.ty[i]);
        hi = Math.max(hi, this.ty[i] + 26 * this.ts[i]);
      }
      this.cellMinY[c] = lo;
      this.cellMaxY[c] = hi;
    });
    this.cellStart[CN * CN] = o;

    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._last = new THREE.Vector3(1e9, 0, 0);
    this._lastDir = new THREE.Vector3();
  }

  // Render each tree kind from two sides into a texture array for billboards.
  _makeImpostors(renderer, leafMat, barkMat, max) {
    const W = 256, H = 512;
    const layers = KINDS.length * 2;
    const data = new Uint8Array(W * H * 4 * layers);
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    // Unlit albedo capture: reuse the textures with basic materials.
    const albedoLeaf = new THREE.ShaderMaterial({
      uniforms: { uFoliage: { value: this.foliageTex } },
      vertexShader: 'attribute float aLayer; attribute float aAO; varying vec2 vUv; varying float vL; varying float vAO; void main(){ vUv = uv; vL = aLayer; vAO = aAO; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SRGB_OUT + 'uniform sampler2DArray uFoliage; varying vec2 vUv; varying float vL; varying float vAO; void main(){ vec4 t = texture(uFoliage, vec3(vUv, vL)); if (t.a < 0.4) discard; gl_FragColor = vec4(srgb(t.rgb * vAO), 1.0); }',
      side: THREE.DoubleSide,
    });
    const albedoBark = new THREE.ShaderMaterial({
      uniforms: { uBark: { value: this.barkTex } },
      vertexShader: 'attribute float aLayer; attribute float aAO; varying vec2 vUv; varying float vL; varying float vAO; void main(){ vUv = uv; vL = aLayer; vAO = aAO; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SRGB_OUT + 'uniform sampler2DArray uBark; varying vec2 vUv; varying float vL; varying float vAO; void main(){ float l0 = floor(vL); vec4 a = texture(uBark, vec3(vUv, l0)); vec4 b = texture(uBark, vec3(vUv, l0 + 1.0)); gl_FragColor = vec4(srgb(mix(a.rgb, b.rgb, fract(vL)) * vAO), 1.0); }',
    });
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    this.impostorSize = [];
    KINDS.forEach((_, k) => {
      const t = this.kinds[k];
      const hw = t.width / 2;
      cam.left = -hw; cam.right = hw; cam.top = t.height * 1.02; cam.bottom = 0;
      cam.updateProjectionMatrix();
      this.impostorSize.push([t.width, t.height * 1.02]);
      const bark = new THREE.Mesh(t.bark.geometry, albedoBark), leaves = new THREE.Mesh(t.leaves.geometry, albedoLeaf);
      scene.add(bark, leaves);
      for (let v = 0; v < 2; v++) {
        const a = v * Math.PI / 2;
        cam.position.set(Math.sin(a) * 40, 0, Math.cos(a) * 40);
        cam.lookAt(0, 0, 0);
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
        const px = new Uint8Array(W * H * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
        bleed(px, W, H);
        data.set(px, (k * 2 + v) * W * H * 4);
      }
      scene.remove(bark, leaves);
    });
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    const tex = new THREE.DataArrayTexture(data, W, H, layers);
    tex.format = THREE.RGBAFormat;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.impostorTex = tex;

    // Two crossed unit quads (0..1 high); the per-instance matrix scales them.
    const g = new THREE.BufferGeometry();
    const pos = [], uv = [], nrm = [], face = [];
    for (let v = 0; v < 2; v++) {
      const ax = v ? V(0, 0, 1) : V(1, 0, 0);
      const n = v ? V(1, 0, 0) : V(0, 0, 1);
      const quad = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
      for (const [s, y] of quad) {
        pos.push(ax.x * s, y, ax.z * s);
        uv.push(s + 0.5, y);
        nrm.push(n.x, 0.3, n.z);
        face.push(v);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    kindAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aKind', kindAttr);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4 });
    patch(mat, {
      uniforms: { uImp: { value: tex } },
      vertexPars: 'attribute float aFace; attribute float aKind; varying vec2 vIUv; varying float vIL;',
      vertex: { '#include <begin_vertex>': 'vec3 transformed = vec3( position ); vIUv = uv; vIL = aKind * 2.0 + aFace;' },
      fragmentPars: 'uniform mediump sampler2DArray uImp; varying vec2 vIUv; varying float vIL;',
      fragment: {
        '#include <map_fragment>': 'vec4 it = texture( uImp, vec3( vIUv, vIL ) ); diffuseColor.rgb *= it.rgb; diffuseColor.a = it.a;',
        '#include <normal_fragment_begin>': 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;',
      },
    });
    const mesh = new THREE.InstancedMesh(g, mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this._kindAttr = kindAttr;
    return mesh;
  }

  update(camera, force = false) {
    const cam = camera.position;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    if (!force && cam.distanceToSquared(this._last) < 1 && dir.dot(this._lastDir) > 0.9995) return;
    this._last.copy(cam);
    this._lastDir.copy(dir);
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);

    for (const k of this.kinds) k.count = 0;
    let far = 0;
    const farMax = this._kindAttr.count;
    const near2 = this.nearRange * this.nearRange, far2 = this.farRange * this.farRange;
    const shadowR2 = 90 * 90;
    const { CELL, CN } = this;
    const H = this.world.HALF;
    const c0x = Math.max(0, Math.floor((cam.x - this.farRange + H) / CELL)), c1x = Math.min(CN - 1, Math.floor((cam.x + this.farRange + H) / CELL));
    const c0z = Math.max(0, Math.floor((cam.z - this.farRange + H) / CELL)), c1z = Math.min(CN - 1, Math.floor((cam.z + this.farRange + H) / CELL));
    const imp = this.impostors.instanceMatrix.array;
    const kindArr = this._kindAttr.array;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = cz * CN + cx;
        const s0 = this.cellStart[c], s1 = this.cellStart[c + 1];
        if (s0 === s1) continue;
        const x0 = -H + cx * CELL, z0 = -H + cz * CELL;
        this._box.min.set(x0 - 6, this.cellMinY[c], z0 - 6);
        this._box.max.set(x0 + CELL + 6, this.cellMaxY[c], z0 + CELL + 6);
        const dBox = this._box.distanceToPoint(cam);
        if (dBox > this.farRange) continue;
        const visible = this._frustum.intersectsBox(this._box);
        if (!visible && dBox > 90) continue;
        for (let s = s0; s < s1; s++) {
          const i = this.cellItems[s];
          const dx = this.tx[i] - cam.x, dz = this.tz[i] - cam.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > far2) continue;
          const sc = this.ts[i], rot = this.tr[i];
          const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
          if (d2 < near2) {
            if (!visible && d2 > shadowR2) continue;
            const k = this.kinds[this.tk[i]];
            if (k.count >= k.bark.instanceMatrix.count) continue;
            const a = k.bark.instanceMatrix.array, o = k.count * 16;
            a[o] = cs; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
            a[o + 4] = 0; a[o + 5] = sc; a[o + 6] = 0; a[o + 7] = 0;
            a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = cs; a[o + 11] = 0;
            a[o + 12] = this.tx[i]; a[o + 13] = this.ty[i]; a[o + 14] = this.tz[i]; a[o + 15] = 1;
            k.count++;
          } else if (visible && far < farMax) {
            // billboards turn to face the camera (only around y)
            const kind = this.tk[i];
            const [w, h] = this.impostorSize[kind];
            const ang = Math.atan2(dx, dz) + (i & 1 ? Math.PI / 2 : 0);
            const c2 = Math.cos(ang) * sc, s2 = Math.sin(ang) * sc;
            const o = far * 16;
            imp[o] = c2 * w; imp[o + 1] = 0; imp[o + 2] = -s2 * w; imp[o + 3] = 0;
            imp[o + 4] = 0; imp[o + 5] = sc * h; imp[o + 6] = 0; imp[o + 7] = 0;
            imp[o + 8] = s2 * w; imp[o + 9] = 0; imp[o + 10] = c2 * w; imp[o + 11] = 0;
            imp[o + 12] = this.tx[i]; imp[o + 13] = this.ty[i]; imp[o + 14] = this.tz[i]; imp[o + 15] = 1;
            kindArr[far] = kind;
            far++;
          }
        }
      }
    }
    for (const k of this.kinds) {
      k.bark.count = k.leaves.count = k.count;
      k.bark.instanceMatrix.clearUpdateRanges();
      k.bark.instanceMatrix.addUpdateRange(0, k.count * 16);
      k.bark.instanceMatrix.needsUpdate = true;
    }
    this.impostors.count = far;
    this.impostors.instanceMatrix.clearUpdateRanges();
    this.impostors.instanceMatrix.addUpdateRange(0, far * 16);
    this.impostors.instanceMatrix.needsUpdate = true;
    this._kindAttr.clearUpdateRanges();
    this._kindAttr.addUpdateRange(0, far);
    this._kindAttr.needsUpdate = true;
    this.stats = { near: this.kinds.reduce((s, k) => s + k.count, 0), far };
  }
}
