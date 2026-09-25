// Ground textures are painted by GPU shaders at load time: no image files.
// Each material layer gets an albedo+roughness map and a normal+AO+height map,
// all tiling seamlessly, packed into two texture arrays for the terrain shader.
import * as THREE from 'three';

export const LAYERS = ['grass', 'meadow', 'forest', 'dirt', 'gravel', 'rock', 'sand', 'asphalt'];
export const LAYER = Object.fromEntries(LAYERS.map((n, i) => [n.toUpperCase(), i]));

// Periodic noise helpers shared by every bake shader. Coordinates are uv in 0..1;
// `per` is how many cells fit across the tile, so everything wraps seamlessly.
export const NOISE_GLSL = /* glsl */`
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 h32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

float gn(vec2 uv, vec2 per) {
  vec2 p = uv * per;
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  float a = dot(h22(mod(i, per)) * 2. - 1., f);
  float b = dot(h22(mod(i + vec2(1., 0.), per)) * 2. - 1., f - vec2(1., 0.));
  float c = dot(h22(mod(i + vec2(0., 1.), per)) * 2. - 1., f - vec2(0., 1.));
  float d = dot(h22(mod(i + vec2(1., 1.), per)) * 2. - 1., f - vec2(1., 1.));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.45;
}
float fbm(vec2 uv, float per, int oct) {
  float s = 0., a = .5, n = 0.;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * gn(uv + float(i) * 0.137, vec2(per));
    n += a; per *= 2.; a *= .5;
  }
  return s / n;
}
// x = distance to nearest feature point, y = second nearest, z = cell id
vec3 vor(vec2 uv, float per, float jit) {
  vec2 p = uv * per;
  vec2 i = floor(p), f = fract(p);
  float F1 = 9., F2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, per);
    vec2 r = g + (h22(c) - .5) * jit + .5 - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = h12(c + 17.1); } else if (d < F2) { F2 = d; }
  }
  return vec3(sqrt(F1), sqrt(F2), id);
}
// Voronoi with different cell counts across u and v (elongated cells).
vec3 vor2(vec2 uv, vec2 per, float jit) {
  vec2 p = uv * per;
  vec2 i = floor(p), f = fract(p);
  float F1 = 9., F2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, per);
    vec2 r = g + (h22(c) - .5) * jit + .5 - f;
    r *= per.yx / max(per.x, per.y);
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = h12(c + 17.1); } else if (d < F2) { F2 = d; }
  }
  return vec3(sqrt(F1), sqrt(F2), id);
}
// Short tapered strokes scattered one per cell: blades of grass, needles, twigs.
// x = coverage, y = height, z = stroke id
vec3 strokes(vec2 uv, float per, float len, float wid, float spread, float baseAngle, float density) {
  vec2 p = uv * per;
  vec2 i = floor(p), f = fract(p);
  vec3 best = vec3(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, per);
    vec3 r = h32(c);
    if (h12(c + 5.3) > density) continue;
    vec2 o = g + r.xy - f;
    float a = baseAngle + (r.z - .5) * spread;
    vec2 dir = vec2(cos(a), sin(a));
    float t = clamp(dot(-o, dir), -len, len);
    float d = length(o + dir * t);
    float taper = 1. - abs(t) / len;
    float w = wid * (0.25 + 0.75 * taper);
    float cov = smoothstep(w, w * 0.35, d);
    float hh = cov * (0.55 + 0.45 * h12(c + 3.7)) * (0.5 + 0.5 * taper);
    if (hh > best.y) best = vec3(cov, hh, h12(c + 7.9));
  }
  return best;
}
`;

// Height (0..1) and sRGB albedo + roughness for each layer.
const LAYER_GLSL = {
  grass: /* glsl */`
    float H(vec2 uv) {
      float clump = fbm(uv, 6., 4) * .5 + .5;
      vec3 a = strokes(uv, 48., .9, .10, 3.1, 1.57, .95);
      vec3 b = strokes(uv + .31, 72., .8, .09, 3.1, 0.5, .9);
      vec3 c = strokes(uv + .67, 30., 1.1, .08, 3.1, 2.4, .8);
      return clamp(max(max(a.y, b.y * .9), c.y * .8) * (.55 + .5 * clump) + clump * .12, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      float clump = fbm(uv, 6., 4) * .5 + .5;
      float hue = fbm(uv + 3.3, 4., 3);
      vec3 a = strokes(uv, 48., .9, .10, 3.1, 1.57, .95);
      vec3 b = strokes(uv + .31, 72., .8, .09, 3.1, 0.5, .9);
      float id = a.y > b.y ? a.z : b.z;
      vec3 soil = mix(vec3(.20, .17, .10), vec3(.28, .25, .14), clump);
      vec3 green = mix(vec3(.26, .40, .13), vec3(.40, .52, .18), id);
      green = mix(green, vec3(.52, .52, .24), smoothstep(.55, .95, id) * .6);      // dry blades
      green = mix(green, vec3(.20, .33, .12), smoothstep(.2, -.4, hue) * .6);
      vec3 col = mix(soil, green, smoothstep(.05, .35, h));
      col *= .78 + .35 * h;
      return vec4(col, .88);
    }`,
  meadow: /* glsl */`
    float H(vec2 uv) {
      vec3 a = strokes(uv, 40., 1.1, .09, 3.1, 1.57, .95);
      vec3 b = strokes(uv + .51, 64., .9, .08, 3.1, 0.3, .9);
      float clump = fbm(uv, 5., 4) * .5 + .5;
      return clamp(max(a.y, b.y * .9) * (.6 + .45 * clump) + clump * .1, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      vec3 a = strokes(uv, 40., 1.1, .09, 3.1, 1.57, .95);
      vec3 b = strokes(uv + .51, 64., .9, .08, 3.1, 0.3, .9);
      float id = a.y > b.y ? a.z : b.z;
      float patchy = fbm(uv + 7.7, 5., 3) * .5 + .5;
      vec3 soil = vec3(.26, .21, .13);
      vec3 straw = mix(vec3(.55, .50, .30), vec3(.68, .62, .40), id);
      vec3 green = mix(vec3(.33, .43, .17), vec3(.45, .50, .22), id);
      vec3 col = mix(soil, mix(green, straw, smoothstep(.35, .75, patchy)), smoothstep(.05, .35, h));
      // tiny flowers
      vec3 fl = vor(uv, 90., 1.);
      float flower = step(.965, fl.z) * smoothstep(.16, .08, fl.x);
      vec3 fcol = fl.z > .988 ? vec3(.62, .45, .78) : fl.z > .977 ? vec3(.92, .80, .25) : vec3(.93, .92, .88);
      col = mix(col, fcol, flower);
      col *= .8 + .3 * h;
      return vec4(col, .9);
    }`,
  forest: /* glsl */`
    float H(vec2 uv) {
      float humus = fbm(uv, 5., 5) * .5 + .5;
      vec3 n1 = strokes(uv, 60., .9, .06, 6.28, 0., .95);
      vec3 n2 = strokes(uv + .27, 90., .8, .05, 6.28, 0., .9);
      vec3 tw = strokes(uv + .63, 9., .9, .07, 6.28, 0., .35);
      float moss = smoothstep(.1, .35, fbm(uv + 4.1, 4., 5));
      return clamp(max(max(n1.y * .7, n2.y * .6), tw.y) * .7 + humus * .3 + moss * .25, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      float humus = fbm(uv, 5., 5) * .5 + .5;
      vec3 n1 = strokes(uv, 60., .9, .06, 6.28, 0., .95);
      vec3 n2 = strokes(uv + .27, 90., .8, .05, 6.28, 0., .9);
      vec3 tw = strokes(uv + .63, 9., .9, .07, 6.28, 0., .35);
      float moss = smoothstep(.1, .35, fbm(uv + 4.1, 4., 5));
      float mossDetail = fbm(uv + 9., 40., 3) * .5 + .5;
      vec3 col = mix(vec3(.13, .09, .06), vec3(.22, .15, .09), humus);
      float nid = n1.y > n2.y ? n1.z : n2.z;
      vec3 needle = mix(vec3(.45, .30, .17), vec3(.62, .45, .27), nid);
      col = mix(col, needle, max(n1.x, n2.x) * .85);
      col = mix(col, vec3(.30, .22, .14) * (.7 + .5 * tw.z), tw.x);
      col = mix(col, mix(vec3(.20, .30, .10), vec3(.34, .42, .16), mossDetail), moss);
      col *= .8 + .3 * h;
      return vec4(col, mix(.92, .8, moss));
    }`,
  dirt: /* glsl */`
    float H(vec2 uv) {
      float base = fbm(uv, 6., 6) * .5 + .5;
      vec3 v = vor(uv, 34., .9);
      float peb = step(.62, v.z) * smoothstep(.36, .12, v.x);
      vec3 c = vor(uv + .5, 7., 1.);
      float crack = smoothstep(.035, .0, c.y - c.x) * smoothstep(.0, .3, fbm(uv + 2., 3., 3));
      return clamp(base * .55 + peb * .45 - crack * .35, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      float base = fbm(uv, 6., 6) * .5 + .5;
      float tone = fbm(uv + 5.5, 3., 3) * .5 + .5;
      vec3 v = vor(uv, 34., .9);
      float peb = step(.62, v.z) * smoothstep(.36, .12, v.x);
      vec3 col = mix(vec3(.30, .22, .14), vec3(.42, .32, .21), base);
      col = mix(col, vec3(.36, .30, .24), tone * .5);
      col = mix(col, mix(vec3(.45, .43, .40), vec3(.32, .28, .24), fract(v.z * 13.)), peb);
      col *= .82 + .3 * h;
      return vec4(col, .93);
    }`,
  gravel: /* glsl */`
    float stones(vec2 uv, float per, float fill, float size) {
      vec3 v = vor(uv, per, .95);
      float on = step(1. - fill, fract(v.z * 7.13));
      return on * smoothstep(size, size * .25, v.x) * (.7 + .3 * fract(v.z * 3.7));
    }
    float H(vec2 uv) {
      float grit = fbm(uv, 64., 3) * .5 + .5;
      float s1 = stones(uv, 26., .55, .42);
      float s2 = stones(uv + .37, 58., .6, .40);
      float s3 = stones(uv + .71, 110., .7, .38);
      return clamp(max(max(s1, s2 * .8), s3 * .6) * .85 + grit * .18, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      float dust = fbm(uv, 5., 4) * .5 + .5;
      vec3 base = mix(vec3(.50, .45, .38), vec3(.60, .55, .46), dust);
      vec3 v1 = vor(uv, 26., .95), v2 = vor(uv + .37, 58., .95), v3 = vor(uv + .71, 110., .95);
      float s1 = stones(uv, 26., .55, .42), s2 = stones(uv + .37, 58., .6, .40), s3 = stones(uv + .71, 110., .7, .38);
      float id = s1 > .01 ? v1.z : s2 > .01 ? v2.z : v3.z;
      vec3 rock = mix(vec3(.42, .40, .38), vec3(.66, .63, .58), fract(id * 17.3));
      rock = mix(rock, vec3(.55, .42, .32), step(.8, fract(id * 5.1)));       // rusty stones
      rock = mix(rock, vec3(.30, .29, .28), step(.9, fract(id * 9.7)));       // dark stones
      float cover = max(max(step(.01, s1), step(.01, s2)), step(.01, s3));
      vec3 col = mix(base, rock, cover * .9);
      col *= .72 + .45 * h;
      return vec4(col, .9);
    }`,
  rock: /* glsl */`
    float cracks(vec2 uv) {
      vec2 w = vec2(fbm(uv, 3., 3), fbm(uv + 4.3, 3., 3)) * .09;
      vec3 c = vor(uv + w, 4., 1.);
      float mask = smoothstep(.05, .25, fbm(uv + 9.1, 2., 3));
      return smoothstep(.045, .0, c.y - c.x) * mask;
    }
    float H(vec2 uv) {
      float big = fbm(uv, 3., 6) * .5 + .5;
      float fine = fbm(uv, 40., 3) * .5 + .5;
      return clamp(big * .75 + fine * .2 - cracks(uv) * .4, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      float speck = h12(floor(uv * 512.));
      float tone = fbm(uv + 1.7, 4., 4) * .5 + .5;
      vec3 col = mix(vec3(.43, .41, .40), vec3(.56, .52, .50), tone);
      col = mix(col, vec3(.62, .50, .46), smoothstep(.75, .95, speck) * .6);   // pink feldspar
      col = mix(col, vec3(.16, .16, .17), smoothstep(.9, 1., speck) * .7);     // dark mica
      float lichen = smoothstep(.15, .3, fbm(uv + 8.2, 6., 5));
      vec3 lc = mix(vec3(.55, .58, .45), vec3(.66, .55, .30), step(.7, fbm(uv + 3.3, 3., 2) * .5 + .5));
      col = mix(col, lc, lichen * .75);
      col *= .7 + .45 * h;
      return vec4(col, mix(.78, .92, lichen));
    }`,
  sand: /* glsl */`
    float H(vec2 uv) {
      float grain = h12(floor(uv * 512.)) * .15;
      float ripple = sin((uv.x * 6.2831 * 14.) + fbm(uv, 3., 3) * 6.) * .5 + .5;
      vec3 v = vor(uv, 20., 1.);
      float peb = step(.85, v.z) * smoothstep(.3, .1, v.x);
      return clamp(ripple * .35 + grain + fbm(uv, 12., 4) * .2 + .3 + peb * .4, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      float tone = fbm(uv + 2.2, 4., 4) * .5 + .5;
      vec3 col = mix(vec3(.58, .52, .42), vec3(.70, .64, .52), tone);
      vec3 v = vor(uv, 20., 1.);
      float peb = step(.85, v.z) * smoothstep(.3, .1, v.x);
      col = mix(col, vec3(.45, .43, .41), peb);
      col *= .85 + .25 * h;
      return vec4(col, .95);
    }`,
  asphalt: /* glsl */`
    float crack(vec2 uv) {
      vec2 w = vec2(fbm(uv, 2., 3), fbm(uv + 2.7, 2., 3)) * .12;
      vec3 c = vor(uv + w + .3, 3., 1.);
      return smoothstep(.018, .0, c.y - c.x) * smoothstep(.2, .35, fbm(uv + 6., 2., 3));
    }
    float H(vec2 uv) {
      vec3 v = vor(uv, 160., 1.);
      float agg = smoothstep(.5, .15, v.x) * (.5 + .5 * v.z);
      return clamp(agg * .6 + fbm(uv, 16., 3) * .15 + .25 - crack(uv) * .4, 0., 1.);
    }
    vec4 A(vec2 uv, float h) {
      vec3 v = vor(uv, 160., 1.);
      float agg = smoothstep(.5, .15, v.x);
      float tone = fbm(uv + 1., 3., 4) * .5 + .5;
      vec3 col = mix(vec3(.20, .20, .21), vec3(.27, .27, .28), tone);
      col = mix(col, mix(vec3(.16, .16, .17), vec3(.46, .45, .43), v.z), agg * .6);
      col = mix(col, vec3(.1), crack(uv) * .8);
      return vec4(col, .82);
    }`,
};

// How tall each layer's relief is compared to its tile, for the normal maps.
const RELIEF = { grass: 7, meadow: 7, forest: 6, dirt: 5, gravel: 9, rock: 4, sand: 2, asphalt: 3 };

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

function makeBaker(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  return function bake(fragmentShader, size, uniforms = {}) {
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, type: THREE.UnsignedByteType });
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    quad.material = mat;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    renderer.setRenderTarget(prev);
    rt.dispose();
    mat.dispose();
    return px;
  };
}

function layerShader(name, mode) {
  return /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform float uRes, uRelief;
    ${NOISE_GLSL}
    ${LAYER_GLSL[name]}
    void main() {
      vec2 uv = vUv;
      float h = H(uv);
      ${mode === 0 ? 'gl_FragColor = A(uv, h);' : `
      float e = 1. / uRes;
      float hx = H(uv + vec2(e, 0.)) - H(uv - vec2(e, 0.));
      float hy = H(uv + vec2(0., e)) - H(uv - vec2(0., e));
      vec3 n = normalize(vec3(-hx * uRelief * .5, 1., -hy * uRelief * .5));
      float blur = (H(uv + vec2(3. * e, 0.)) + H(uv - vec2(3. * e, 0.)) + H(uv + vec2(0., 3. * e)) + H(uv - vec2(0., 3. * e))) * .25;
      float ao = clamp(1. - (blur - h) * 2.2, .35, 1.);
      gl_FragColor = vec4(n.x * .5 + .5, n.z * .5 + .5, ao, h);`}
    }`;
}

// Bakes every ground layer. Returns two DataArrayTextures:
//   albedo: sRGB colour + roughness in alpha
//   normal: normal.x/.z in rg, ambient occlusion in b, height in a
export function bakeGroundTextures(renderer, size = 512) {
  const bake = makeBaker(renderer);
  const layers = LAYERS.length;
  const albedo = new Uint8Array(size * size * 4 * layers);
  const normal = new Uint8Array(size * size * 4 * layers);
  LAYERS.forEach((name, i) => {
    const u = { uRes: { value: size }, uRelief: { value: RELIEF[name] * size / 512 } };
    albedo.set(bake(layerShader(name, 0), size, u), i * size * size * 4);
    normal.set(bake(layerShader(name, 1), size, u), i * size * size * 4);
  });
  const make = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, size, size, layers);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: make(albedo, true), normal: make(normal, false), size, raw: { albedo, normal } };
}

// A general-purpose tiling noise texture: r = smooth fbm, g = fine fbm,
// b = cellular, a = white noise. Used for variation all over the place.
export function bakeNoiseTexture(renderer, size = 256) {
  const bake = makeBaker(renderer);
  const px = bake(/* glsl */`
    precision highp float;
    varying vec2 vUv;
    ${NOISE_GLSL}
    void main() {
      float a = fbm(vUv, 4., 6) * .5 + .5;
      float b = fbm(vUv + .5, 16., 4) * .5 + .5;
      vec3 v = vor(vUv, 8., 1.);
      float w = h12(floor(vUv * ${size.toFixed(1)}));
      gl_FragColor = vec4(a, b, v.x, w);
    }`, size);
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Bakes several fragment shader bodies (each writing gl_FragColor from vUv)
// into the layers of one texture array.
export function bakeLayers(renderer, bodies, size, { srgb = true, wrap = true } = {}) {
  const bake = makeBaker(renderer);
  const data = new Uint8Array(size * size * 4 * bodies.length);
  bodies.forEach((body, i) => {
    data.set(bake(`precision highp float;\nvarying vec2 vUv;\n${NOISE_GLSL}\n${body}`, size), i * size * size * 4);
  });
  const t = new THREE.DataArrayTexture(data, size, size, bodies.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Bakes a one-off texture from a fragment shader body that writes gl_FragColor
// from vUv. Returns an sRGB or linear DataTexture.
export function bakeTexture(renderer, body, size, { srgb = true, uniforms = {}, wrap = true, mip = true } = {}) {
  const bake = makeBaker(renderer);
  const px = bake(`precision highp float;\nvarying vec2 vUv;\n${NOISE_GLSL}\n${body}`, size, uniforms);
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = mip;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
