// Renders the scene in high dynamic range, adds bloom and sun shafts, then tone maps and grades
// it to the screen. Everything upstream works in linear light, which is what makes low sun,
// fire and the flashlight look right.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tSrc, vUv + o * uTexel ).rgb; }
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void main() {
  vec3 a = s( vec2( -2, 2 ) ), b = s( vec2( 0, 2 ) ), c = s( vec2( 2, 2 ) );
  vec3 d = s( vec2( -2, 0 ) ), e = s( vec2( 0, 0 ) ), f = s( vec2( 2, 0 ) );
  vec3 g = s( vec2( -2, -2 ) ), h = s( vec2( 0, -2 ) ), i = s( vec2( 2, -2 ) );
  vec3 j = s( vec2( -1, 1 ) ), k = s( vec2( 1, 1 ) ), l = s( vec2( -1, -1 ) ), m = s( vec2( 1, -1 ) );
  vec3 col;
  if ( uFirst > 0.5 ) {
    // First level: keep only what is brighter than the threshold, weighted so single hot pixels do not flicker.
    vec3 g0 = ( a + b + d + e ) * 0.25, g1 = ( b + c + e + f ) * 0.25, g2 = ( d + e + g + h ) * 0.25, g3 = ( e + f + h + i ) * 0.25, g4 = ( j + k + l + m ) * 0.25;
    float w0 = 1.0 / ( 1.0 + luma( g0 ) ), w1 = 1.0 / ( 1.0 + luma( g1 ) ), w2 = 1.0 / ( 1.0 + luma( g2 ) ), w3 = 1.0 / ( 1.0 + luma( g3 ) ), w4 = 1.0 / ( 1.0 + luma( g4 ) );
    col = ( g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
    float l0 = luma( col );
    col *= clamp( ( l0 - uThreshold ) / max( l0, 1e-4 ), 0.0, 1.0 );
  } else {
    col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
  }
  gl_FragColor = vec4( col, 1.0 );
}`;

const UP_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 r = uTexel * uRadius;
  vec3 a = texture2D( tSrc, vUv + vec2( -r.x, r.y ) ).rgb, b = texture2D( tSrc, vUv + vec2( 0.0, r.y ) ).rgb, c = texture2D( tSrc, vUv + vec2( r.x, r.y ) ).rgb;
  vec3 d = texture2D( tSrc, vUv + vec2( -r.x, 0.0 ) ).rgb, e = texture2D( tSrc, vUv ).rgb, f = texture2D( tSrc, vUv + vec2( r.x, 0.0 ) ).rgb;
  vec3 g = texture2D( tSrc, vUv + vec2( -r.x, -r.y ) ).rgb, h = texture2D( tSrc, vUv + vec2( 0.0, -r.y ) ).rgb, i = texture2D( tSrc, vUv + vec2( r.x, -r.y ) ).rgb;
  vec3 col = ( a + c + g + i ) * 0.0625 + ( b + d + f + h ) * 0.125 + e * 0.25;
  gl_FragColor = vec4( col, 1.0 );
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform vec2 uSunUv;
uniform float uRays;
uniform vec3 uRayColor;
uniform float uFade;
uniform float uDamage;
uniform float uCold;
uniform float uUnderwater;
uniform float uFlash;
uniform vec2 uResolution;
varying vec2 vUv;

float hash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 aces( vec3 x ) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
}

void main() {
  vec2 uv = vUv;
  vec2 fromCentre = uv - 0.5;
  float r2 = dot( fromCentre, fromCentre );

  // A touch of lens fringing toward the corners.
  vec2 ca = fromCentre * r2 * 0.012;
  vec3 col;
  col.r = texture2D( tScene, uv + ca ).r;
  col.g = texture2D( tScene, uv ).g;
  col.b = texture2D( tScene, uv - ca ).b;

  // Underwater: wobble and murk.
  if ( uUnderwater > 0.0 ) {
    vec2 wob = vec2( sin( uv.y * 40.0 + uTime * 2.0 ), cos( uv.x * 34.0 + uTime * 1.7 ) ) * 0.0035 * uUnderwater;
    col = texture2D( tScene, uv + wob ).rgb;
  }

  // Sun shafts: march toward the sun and gather the bright sky that is not blocked by terrain or trees.
  if ( uRays > 0.001 ) {
    vec2 delta = ( uSunUv - uv ) / 22.0;
    vec2 p = uv;
    float acc = 0.0, wt = 1.0;
    float jitter = hash( uv * uResolution + uTime );
    p += delta * jitter;
    for ( int i = 0; i < 22; i ++ ) {
      p += delta;
      vec3 sam = texture2D( tScene, p ).rgb;
      float l = dot( sam, vec3( 0.2126, 0.7152, 0.0722 ) );
      acc += clamp( l - 0.9, 0.0, 6.0 ) * wt;
      wt *= 0.94;
    }
    col += uRayColor * acc * uRays * 0.045;
  }

  col += texture2D( tBloom, uv ).rgb * uBloom;
  col += vec3( uFlash );

  col *= uExposure;
  // Contrast about middle grey, then a soft filmic curve.
  col = max( ( col - 0.18 ) * uContrast + 0.18, 0.0 );
  col = aces( col );
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, uSaturation );
  col *= mix( uShadowTint, uHighlightTint, smoothstep( 0.05, 0.85, l ) );

  if ( uUnderwater > 0.0 ) col = mix( col, col * vec3( 0.45, 0.85, 0.9 ) + vec3( 0.0, 0.03, 0.05 ), uUnderwater );

  // Vignette and the health and cold overlays.
  float vig = 1.0 - uVignette * smoothstep( 0.12, 0.62, r2 );
  col *= vig;
  if ( uDamage > 0.0 ) col = mix( col, col * vec3( 1.0, 0.35, 0.3 ) + vec3( 0.25, 0.0, 0.0 ) * smoothstep( 0.05, 0.4, r2 ), uDamage * smoothstep( 0.02, 0.35, r2 ) );
  if ( uCold > 0.0 ) {
    float frost = smoothstep( 0.05, 0.4, r2 ) * uCold;
    col = mix( col, vec3( 0.75, 0.88, 1.0 ) * ( l * 0.6 + 0.35 ), frost * 0.55 );
  }

  // Grain also breaks up 8-bit banding in the dark sky gradients.
  float n = hash( uv * uResolution + fract( uTime ) * 91.7 ) - 0.5;
  col += n * uGrain;

  col *= 1.0 - uFade;
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 4; this.height = 4;
    this.scale = 1;
    this.msaa = 4;
    this.bloomOn = true;
    this.bloomStrength = 0.16;
    this.raysOn = true;
    this.levels = 5;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(g, null);
    this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);

    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra,
    });
    this.downMat = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.0 } });
    this.upMat = mk(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.u = {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.16 }, uExposure: { value: 1 }, uTime: { value: 0 },
      uVignette: { value: 0.32 }, uGrain: { value: 0.012 }, uSaturation: { value: 1.06 }, uContrast: { value: 1.08 },
      uShadowTint: { value: new THREE.Color(0.96, 1.0, 1.05) }, uHighlightTint: { value: new THREE.Color(1.04, 1.0, 0.95) },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, uRays: { value: 0 }, uRayColor: { value: new THREE.Color(1, 0.8, 0.55) },
      uFade: { value: 0 }, uDamage: { value: 0 }, uCold: { value: 0 }, uUnderwater: { value: 0 }, uFlash: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    };
    this.compositeMat = mk(COMPOSITE_FRAG, this.u);
    this.sceneRT = null;
    this.mips = [];
  }

  setQuality({ scale, msaa, bloom, godRays }) {
    const changed = scale !== this.scale || msaa !== this.msaa;
    this.scale = scale; this.msaa = msaa; this.bloomOn = bloom; this.raysOn = godRays;
    if (changed) this.resize(this.width, this.height);
  }

  // width/height are the drawing buffer size in device pixels.
  resize(width, height) {
    this.width = width; this.height = height;
    const w = Math.max(2, Math.round(width * this.scale)), h = Math.max(2, Math.round(height * this.scale));
    this.sceneRT?.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: this.msaa, depthBuffer: true,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      const rt = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.mips.push(rt);
    }
    this.u.uResolution.value.set(w, h);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  // Renders the world into the HDR target.
  renderScene(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
  }

  // Bloom, then the composite to the screen.
  finish({ time, exposure, sunUv = null, sunVisible = 0 }) {
    const r = this.renderer;
    const tex = this.sceneRT.texture;
    if (this.bloomOn) {
      let src = tex, sw = this.sceneRT.width, sh = this.sceneRT.height;
      for (let i = 0; i < this.mips.length; i++) {
        this.downMat.uniforms.tSrc.value = src;
        this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
        this._pass(this.downMat, this.mips[i]);
        src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
      }
      for (let i = this.mips.length - 1; i > 0; i--) {
        this.upMat.uniforms.tSrc.value = this.mips[i].texture;
        this.upMat.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
        this._pass(this.upMat, this.mips[i - 1]);
      }
      this.u.tBloom.value = this.mips[0].texture;
    } else {
      this.u.tBloom.value = tex;
    }
    const u = this.u;
    u.tScene.value = tex;
    u.uBloom.value = this.bloomOn ? this.bloomStrength : 0;
    u.uExposure.value = exposure;
    u.uTime.value = time;
    if (sunUv && this.raysOn) { u.uSunUv.value.copy(sunUv); u.uRays.value = sunVisible; } else u.uRays.value = 0;
    this._pass(this.compositeMat, null);
  }

  dispose() {
    this.sceneRT?.dispose();
    for (const m of this.mips) m.dispose();
  }
}
