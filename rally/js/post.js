// Post-processing: the scene renders in HDR (half float, MSAA), then bloom,
// filmic tone mapping, a touch of colour grading, vignette, grain and a radial
// speed blur are applied on the way to the screen.
import * as THREE from 'three';

const FS_TRI = new THREE.BufferGeometry();
FS_TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
FS_TRI.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const DOWN_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold, uKnee, uPrefilter;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  // 13-tap filter (Jimenez 2014): stable, no fireflies.
  vec3 a = s(vec2(-2., 2.)), b = s(vec2(0., 2.)), c = s(vec2(2., 2.));
  vec3 d = s(vec2(-2., 0.)), e = s(vec2(0., 0.)), f = s(vec2(2., 0.));
  vec3 g = s(vec2(-2., -2.)), h = s(vec2(0., -2.)), i = s(vec2(2., -2.));
  vec3 j = s(vec2(-1., 1.)), k = s(vec2(1., 1.)), l = s(vec2(-1., -1.)), m = s(vec2(1., -1.));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    col = min(col, vec3(60.0));
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const UP_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 col = s(vec2(0.)) * 4.0 + (s(vec2(-1., 0.)) + s(vec2(1., 0.)) + s(vec2(0., -1.)) + s(vec2(0., 1.))) * 2.0
    + s(vec2(-1., -1.)) + s(vec2(1., -1.)) + s(vec2(-1., 1.)) + s(vec2(1., 1.));
  gl_FragColor = vec4(col / 16.0 * uWeight, 1.0);
}`;

const COMP_FS = /* glsl */`
precision highp float;
uniform sampler2D tScene, tBloom;
uniform float uExposure, uBloom, uVignette, uGrain, uTime, uRadial, uSaturation, uContrast, uBloomOn;
uniform vec3 uLift, uGain;
uniform vec2 uCenter;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = outM * RRTAndODTFit(inM * (color / 0.6));
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col;
  if (uRadial > 0.001) {
    // speed blur toward the edges of the screen
    vec2 dir = vUv - uCenter;
    float edge = smoothstep(0.1, 0.7, length(dir));
    col = vec3(0.0);
    for (int i = 0; i < 6; i++) col += texture2D(tScene, vUv - dir * float(i) * uRadial * edge * 0.012).rgb;
    col /= 6.0;
  } else {
    col = texture2D(tScene, vUv).rgb;
  }
  if (uBloomOn > 0.5) col += texture2D(tBloom, vUv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  // grade
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col = col * uGain + uLift * (1.0 - col);
  col = clamp(col, 0.0, 1.0);
  // vignette
  vec2 q = vUv - 0.5;
  col *= mix(1.0, smoothstep(0.95, 0.25, length(q * vec2(1.0, 0.8))), uVignette);
  col = toSRGB(col);
  col += (hash(vUv * 1000.0 + fract(uTime) * 91.7) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer, { msaa = 4, bloom = true } = {}) {
    this.renderer = renderer;
    this.bloomOn = bloom;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(FS_TRI);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa, depthBuffer: true });
    this.mips = [];
    for (let i = 0; i < 6; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    this.down = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: DOWN_FS, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.4 }, uKnee: { value: 0.6 }, uPrefilter: { value: 0 } },
    });
    this.up = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: UP_FS, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
    });
    this.comp = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture }, tBloom: { value: this.mips[0].texture },
        uExposure: { value: 1 }, uBloom: { value: 0.06 }, uBloomOn: { value: bloom ? 1 : 0 },
        uVignette: { value: 0.35 }, uGrain: { value: 0.018 }, uTime: { value: 0 },
        uRadial: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.45) },
        uSaturation: { value: 1.05 }, uContrast: { value: 1.04 },
        uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      },
    });
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    let mw = w, mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene, camera, time = 0) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    if (this.bloomOn) {
      let src = this.target.texture, sw = this.target.width, sh = this.target.height;
      this.mips.forEach((m, i) => {
        this.down.uniforms.tSrc.value = src;
        this.down.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        this.down.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
        this._pass(this.down, m);
        src = m.texture; sw = m.width; sh = m.height;
      });
      for (let i = this.mips.length - 1; i > 0; i--) {
        const s = this.mips[i];
        this.up.uniforms.tSrc.value = s.texture;
        this.up.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
        this.up.uniforms.uWeight.value = 1;
        r.autoClear = false;
        this._pass(this.up, this.mips[i - 1]);
        r.autoClear = true;
      }
    }
    this.comp.uniforms.uTime.value = time;
    this._pass(this.comp, null);
  }
}
