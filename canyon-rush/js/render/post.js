// HDR pipeline: the scene renders into a half-float multisampled target, then
// bloom (a mip-chain blur), eye adaptation, filmic tone mapping, colour grading,
// vignette and film grain are applied on the way to the screen.
import * as THREE from 'three';

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
TRI.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

class FullscreenPass {
  constructor(fragmentShader, uniforms = {}, blending = THREE.NoBlending) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(TRI, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  get uniforms() { return this.material.uniforms; }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
}

const DOWN = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  uniform float karis;
  varying vec2 vUv;
  vec3 S(vec2 o) { return texture2D(src, vUv + o * texel).rgb; }
  float W(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
  void main() {
    vec3 a = S(vec2(-2.0, 2.0)), b = S(vec2(0.0, 2.0)), c = S(vec2(2.0, 2.0));
    vec3 d = S(vec2(-2.0, 0.0)), e = S(vec2(0.0, 0.0)), f = S(vec2(2.0, 0.0));
    vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
    vec3 j = S(vec2(-1.0, 1.0)), k = S(vec2(1.0, 1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
    vec3 col;
    if (karis > 0.5) {
      vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
      vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
      float w0 = W(g0) * 0.5, w1 = W(g1) * 0.125, w2 = W(g2) * 0.125, w3 = W(g3) * 0.125, w4 = W(g4) * 0.125;
      col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
      col = min(col, vec3(4000.0));
    } else {
      col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const UP = /* glsl */ `
  uniform sampler2D src;
  uniform sampler2D cur;
  uniform vec2 texel;
  uniform float mixLow;
  varying vec2 vUv;
  vec3 S(vec2 o) { return texture2D(src, vUv + o * texel).rgb; }
  void main() {
    vec3 up = S(vec2(0.0)) * 4.0;
    up += (S(vec2(-1.0, 0.0)) + S(vec2(1.0, 0.0)) + S(vec2(0.0, -1.0)) + S(vec2(0.0, 1.0))) * 2.0;
    up += S(vec2(-1.0, -1.0)) + S(vec2(1.0, -1.0)) + S(vec2(-1.0, 1.0)) + S(vec2(1.0, 1.0));
    up /= 16.0;
    gl_FragColor = vec4(mix(texture2D(cur, vUv).rgb, up, mixLow), 1.0);
  }
`;

// Log-average luminance of the small bloom mip, blended over time (eye adaptation).
const ADAPT = /* glsl */ `
  uniform sampler2D src;
  uniform sampler2D prev;
  uniform float blend;
  varying vec2 vUv;
  void main() {
    float s = 0.0, wsum = 0.0;
    for (int y = 0; y < 8; y++) {
      for (int x = 0; x < 8; x++) {
        vec2 uv = (vec2(float(x), float(y)) + 0.5) / 8.0;
        float w = 1.0 - 0.6 * length(uv - 0.5);        // centre-weighted metering
        vec3 c = texture2D(src, uv).rgb;
        s += w * log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
        wsum += w;
      }
    }
    float lum = exp(s / wsum);
    float old = texture2D(prev, vec2(0.5)).r;
    gl_FragColor = vec4(mix(old, lum, blend), 0.0, 0.0, 1.0);
  }
`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tLum;
  uniform float uBloom;
  uniform float uExposure;
  uniform float uKey;
  uniform vec2 uAdaptRange;
  uniform float uTime;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uSaturation;
  uniform float uContrast;
  uniform vec3 uTint;
  uniform float uRadial;
  uniform vec2 uRes;
  varying vec2 vUv;

  // AgX tone mapping (Blender / three.js constants) with a mildly punchy look.
  const mat3 LIN_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 LIN_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 AGX_INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AGX_OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 AgX(vec3 color, float power, float sat) {
    color = AGX_INSET * (LIN_SRGB_TO_REC2020 * color);
    color = clamp((log2(max(color, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
    color = agxContrast(color);
    float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = pow(max(color, 0.0), vec3(power));
    color = l + sat * (color - l);
    color = AGX_OUTSET * color;
    color = pow(max(color, 0.0), vec3(2.2));
    return clamp(LIN_REC2020_TO_SRGB * color, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec3 col = texture2D(tScene, uv).rgb;
    // Speed blur: a few taps toward the centre of the screen.
    if (uRadial > 0.001) {
      vec2 dir = (uv - 0.5) * uRadial * 0.06;
      vec3 acc = col;
      for (int i = 1; i < 6; i++) acc += texture2D(tScene, uv - dir * float(i) / 5.0).rgb;
      col = mix(col, acc / 6.0, smoothstep(0.1, 0.6, length(uv - 0.5)));
    }
    col += texture2D(tBloom, uv).rgb * uBloom;

    float avgLum = texture2D(tLum, vec2(0.5)).r;
    float adapt = clamp(uKey / max(avgLum, 1e-4), uAdaptRange.x, uAdaptRange.y);
    col *= uExposure * adapt;

    col *= uTint;
    // Contrast pivots around middle grey in log space, so shadows keep their detail.
    col = pow(max(col, 0.0) / 0.18, vec3(uContrast)) * 0.18;
    col = AgX(col, 1.08, uSaturation);

    vec2 q = uv - 0.5;
    q.x *= uRes.x / uRes.y;
    col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));

    col = toSRGB(col);
    float n = hash(uv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
    col += n * uGrain;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PostPipeline {
  constructor(renderer, { samples = 4, bloom = true, renderScale = 1 } = {}) {
    this.renderer = renderer;
    this.samples = samples;
    this.bloomOn = bloom;
    this.bloomStrength = 0.045;
    this.renderScale = renderScale;
    this.width = 1;
    this.height = 1;

    this.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.hdr = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: Math.max(1, samples),
      depthTexture: this.depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.hdr.texture.minFilter = THREE.LinearFilter;
    this.hdr.texture.generateMipmaps = false;

    this.mips = [];
    this.down = new FullscreenPass(DOWN, { src: { value: null }, texel: { value: new THREE.Vector2() }, karis: { value: 0 } });
    this.up = new FullscreenPass(UP, { src: { value: null }, cur: { value: null }, texel: { value: new THREE.Vector2() }, mixLow: { value: 0.7 } });

    const lumRT = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.lum = [lumRT(), lumRT()];
    this.lumIndex = 0;
    this.adapt = new FullscreenPass(ADAPT, { src: { value: null }, prev: { value: null }, blend: { value: 1 } });
    this.firstAdapt = true;

    this.composite = new FullscreenPass(COMPOSITE, {
      tScene: { value: this.hdr.texture },
      tBloom: { value: null },
      tLum: { value: null },
      uBloom: { value: 0.045 },
      uExposure: { value: 1 },
      uKey: { value: 0.22 },
      uAdaptRange: { value: new THREE.Vector2(0.55, 2.4) },
      uTime: { value: 0 },
      uVignette: { value: 0.28 },
      uGrain: { value: 0.018 },
      uSaturation: { value: 1.22 },
      uContrast: { value: 1.04 },
      uTint: { value: new THREE.Vector3(1.0, 0.985, 0.96) },
      uRadial: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    });
  }

  setSize(w, h) {
    const sw = Math.max(1, Math.round(w * this.renderScale));
    const sh = Math.max(1, Math.round(h * this.renderScale));
    this.width = sw;
    this.height = sh;
    this.hdr.setSize(sw, sh);
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = sw, mh = sh;
    for (let i = 0; i < 6; i++) {
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
      const rt = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = false;
      this.mips.push(rt);
    }
    this.upMips = this.mips.slice(0, -1).map((m) => {
      const rt = new THREE.WebGLRenderTarget(m.width, m.height, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = false;
      return rt;
    });
    this.composite.uniforms.uRes.value.set(w, h);
  }

  // Draws `scene` with `camera`, then any extra passes (soft particles, water) that
  // need the resolved depth, then post-processing to the screen.
  render(scene, camera, dt, extra = null) {
    const r = this.renderer;
    r.setRenderTarget(this.hdr);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (extra) extra(this.hdr);

    // Bloom chain.
    let src = this.hdr.texture, sw = this.width, sh = this.height;
    const D = this.down.uniforms;
    for (let i = 0; i < this.mips.length; i++) {
      D.src.value = src;
      D.texel.value.set(1 / sw, 1 / sh);
      D.karis.value = i === 0 ? 1 : 0;
      this.down.render(r, this.mips[i]);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }
    const U = this.up.uniforms;
    let low = this.mips[this.mips.length - 1];
    for (let i = this.mips.length - 2; i >= 0; i--) {
      U.src.value = low.texture;
      U.cur.value = this.mips[i].texture;
      U.texel.value.set(1 / low.width, 1 / low.height);
      this.up.render(r, this.upMips[i]);
      low = this.upMips[i];
    }

    // Eye adaptation from the smallest mip.
    const A = this.adapt.uniforms;
    const prev = this.lum[this.lumIndex], next = this.lum[1 - this.lumIndex];
    A.src.value = this.mips[this.mips.length - 1].texture;
    A.prev.value = prev.texture;
    A.blend.value = this.firstAdapt ? 1 : 1 - Math.exp(-dt * 1.6);
    this.firstAdapt = false;
    this.adapt.render(r, next);
    this.lumIndex = 1 - this.lumIndex;

    const C = this.composite.uniforms;
    C.tBloom.value = low.texture;
    C.uBloom.value = this.bloomOn ? this.bloomStrength : 0;
    C.tLum.value = next.texture;
    C.uTime.value += dt;
    this.composite.render(r, null);
  }

  resetAdaptation() {
    this.firstAdapt = true;
  }
}
