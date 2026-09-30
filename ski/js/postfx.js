// HDR post-processing: exposure + speed blur -> bloom -> grade (vignette, grain, tint) -> tone map.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp } from './util.js';

const EXPOSE = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 0.04 },
    uSpeed: { value: 0 },
    uAberration: { value: 0.0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uSpeed;
    uniform float uAberration;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot( c * vec2( uAspect, 1.0 ), c * vec2( uAspect, 1.0 ) );
      vec3 col;
      // radial speed blur toward the edges + tiny chromatic split
      float blur = uSpeed * smoothstep( 0.02, 0.35, r2 ) * 0.055;
      vec2 ab = c * uAberration * ( 0.4 + r2 * 3.0 );
      if ( blur > 0.0005 ) {
        vec3 acc = vec3( 0.0 );
        for ( int i = 0; i < 6; i ++ ) {
          float k = float( i ) / 5.0;
          vec2 o = c * blur * k;
          acc += vec3( texture2D( tDiffuse, vUv - o + ab ).r, texture2D( tDiffuse, vUv - o ).g, texture2D( tDiffuse, vUv - o - ab ).b );
        }
        col = acc / 6.0;
      } else {
        col = vec3( texture2D( tDiffuse, vUv + ab ).r, texture2D( tDiffuse, vUv ).g, texture2D( tDiffuse, vUv - ab ).b );
      }
      gl_FragColor = vec4( col * uExposure, 1.0 );
    }`,
};

const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.028 },
    uSat: { value: 1.06 },
    uContrast: { value: 1.05 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uAspect: { value: 1 },
  },
  vertexShader: EXPOSE.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uSat, uContrast, uFlash, uAspect;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    float hash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
    void main() {
      vec4 t = texture2D( tDiffuse, vUv );
      vec3 c = t.rgb;
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      // cool shadows / warm highlights
      c *= mix( vec3( 0.94, 0.99, 1.07 ), vec3( 1.03, 1.0, 0.95 ), smoothstep( 0.04, 0.9, l ) );
      c = mix( vec3( l ), c, uSat );
      c = ( c - 0.18 ) * uContrast + 0.18;
      vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
      c *= 1.0 - uVignette * smoothstep( 0.25, 0.95, dot( q, q ) * 1.6 );
      c += ( hash( vUv * 1234.0 + uTime ) - 0.5 ) * uGrain * ( 0.4 + 0.6 * smoothstep( 0.0, 0.5, 1.0 - l ) );
      c = mix( c, uFlashColor, uFlash );
      gl_FragColor = vec4( max( c, 0.0 ), t.a );
    }`,
};

export const QUALITY = {
  low:    { pixelRatio: 0.75, shadow: 1024, bloom: false, msaa: 0, trees: 0.6, sparkle: 0.0, speedFx: false, sun: true },
  medium: { pixelRatio: 1.0,  shadow: 1536, bloom: true,  msaa: 0, trees: 0.8, sparkle: 0.7, speedFx: true,  sun: true },
  high:   { pixelRatio: 1.5,  shadow: 2048, bloom: true,  msaa: 4, trees: 1.0, sparkle: 1.0, speedFx: true,  sun: true },
  ultra:  { pixelRatio: 2.0,  shadow: 3072, bloom: true,  msaa: 4, trees: 1.25, sparkle: 1.0, speedFx: true, sun: true },
};

export class PostFX {
  constructor(renderer, scene, camera, exposure) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.exposure = exposure;
    this.quality = 'high';
    this.q = QUALITY.high;
    this.scale = 1;              // dynamic resolution multiplier
    this._ema = 16.7;
    this._lowFor = 0;
    this._highFor = 0;
    this.adaptive = true;
    this.maxRatio = 1.5;
    this._build();
  }

  _build() {
    const { renderer, scene, camera } = this;
    const w = Math.max(2, Math.floor(innerWidth * this.ratio)), h = Math.max(2, Math.floor(innerHeight * this.ratio));
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.msaa, depthBuffer: true });
    if (this.composer) this.composer.dispose();
    const c = this.composer = new EffectComposer(renderer, target);
    c.setPixelRatio(1);
    this.renderPass = new RenderPass(scene, camera);
    c.addPass(this.renderPass);
    this.expose = new ShaderPass(EXPOSE);
    this.expose.uniforms.uExposure.value = this.exposure;
    c.addPass(this.expose);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.34, 0.6, 1.15);
    this.bloom.enabled = this.q.bloom;
    c.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    c.addPass(this.grade);
    this.output = new OutputPass();
    c.addPass(this.output);
    this.setSize(innerWidth, innerHeight);
  }

  get ratio() {
    return Math.min(devicePixelRatio || 1, this.q.pixelRatio * 1.0) * this.scale;
  }

  setQuality(name) {
    this.quality = name;
    this.q = QUALITY[name];
    this.maxRatio = this.q.pixelRatio;
    this.scale = 1;
    this._build();
  }

  setSize(w, h) {
    const r = this.ratio;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.floor(w * r), Math.floor(h * r), false);
    this.composer.setSize(Math.floor(w * r), Math.floor(h * r));
    this.expose.uniforms.uAspect.value = w / h;
    this.grade.uniforms.uAspect.value = w / h;
    this.bloom.resolution.set(Math.floor(w * r) / 2, Math.floor(h * r) / 2);
    this.width = w; this.height = h;
  }

  /** adapt the render resolution to keep ~60 fps */
  adapt(frameMs) {
    if (!this.adaptive) return;
    this._ema += (frameMs - this._ema) * 0.08;
    if (this._ema > 21) { this._lowFor += frameMs; this._highFor = 0; }
    else if (this._ema < 13.5) { this._highFor += frameMs; this._lowFor = 0; }
    else { this._lowFor = this._highFor = 0; }
    let changed = false;
    if (this._lowFor > 900 && this.scale > 0.5) { this.scale = Math.max(0.5, this.scale * 0.88); this._lowFor = 0; changed = true; }
    if (this._highFor > 2500 && this.scale < 1) { this.scale = Math.min(1, this.scale * 1.08); this._highFor = 0; changed = true; }
    if (changed) this.setSize(this.width, this.height);
  }

  /** speed 0..1 drives the radial blur; flash 0..1 for impacts */
  render(dt, time, speed01, flash = 0, flashColor = null) {
    const u = this.expose.uniforms;
    u.uSpeed.value = this.q.speedFx ? speed01 : 0;
    u.uAberration.value = this.q.speedFx ? 0.0012 + 0.003 * speed01 : 0;
    u.uExposure.value = this.exposure;
    const g = this.grade.uniforms;
    g.uTime.value = time % 100;
    g.uFlash.value = flash;
    if (flashColor) g.uFlashColor.value.copy(flashColor);
    this.composer.render(dt);
  }
}

void clamp;
