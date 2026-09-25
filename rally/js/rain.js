// Rain: thin streaks falling through a box that travels with the camera.
// Each streak is stretched along the way it moves relative to the camera, so
// standing still the rain falls, and at speed it flies at the windscreen.
import * as THREE from 'three';
import { G } from './shading.js';

const VS = /* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam, uCamVel, uBox, uFall;
uniform float uNear;
varying float vAlpha;
varying float vAcross;
void main() {
  vec3 fall = uFall * aSeed.w;
  vec3 origin = uCam - uBox * 0.5;
  vec3 p = aSeed.xyz * uBox + fall * uTime;
  p = origin + mod( p - origin, uBox );
  // streak length: how far the drop moves relative to the camera in ~1/25 s
  vec3 rel = fall - uCamVel;
  float speed = length( rel );
  vec3 dir = rel / max( speed, 1e-3 );
  float len = clamp( speed * 0.028, 0.22, 0.85 );
  vec3 toCam = normalize( cameraPosition - p );
  float d = distance( p, cameraPosition );
  // at least about a pixel wide, dimmer when widened
  float w = max( 0.01, d * 0.0014 );
  vec3 side = normalize( cross( dir, toCam ) ) * w;
  vec3 wp = p + side * position.x * 2.0 + dir * position.y * len;
  vAcross = position.x * 4.0;
  // fade in past the car (or the cockpit), fade out toward the edge of the box
  vAlpha = smoothstep( uNear, uNear + 1.2, d ) * ( 1.0 - smoothstep( uBox.x * 0.32, uBox.x * 0.5, d ) ) * clamp( 0.012 / w, 0.35, 1.0 );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

const FS = /* glsl */`
uniform vec3 uColor;
uniform float uAmount;
varying float vAlpha;
varying float vAcross;
void main() {
  float a = ( 1.0 - abs( vAcross ) ) * vAlpha * uAmount;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uColor * a, a );
}`;

export class Rain {
  constructor(count = 6000) {
    const quad = new THREE.PlaneGeometry(0.5, 1);   // x across the streak, y along it
    quad.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = 0.85 + Math.random() * 0.3;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    this.uniforms = {
      uTime: G.uTime,
      uCam: { value: new THREE.Vector3() },
      uCamVel: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(34, 20, 34) },
      uFall: { value: new THREE.Vector3(1.4, -9.2, 0.7) },
      uNear: { value: 0.4 },
      uColor: { value: new THREE.Color(0.62, 0.66, 0.7) },
      uAmount: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this._prev = new THREE.Vector3();
    this._vel = new THREE.Vector3();
    this._init = false;
  }

  set amount(a) {
    this.uniforms.uAmount.value = a * 0.22;
    this.mesh.visible = a > 0;
  }

  // Follow the camera; `inside` hides the drops that would fall through the cabin.
  update(camera, dt, inside = false) {
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uCam.value.copy(camera.position);
    if (this._init && dt > 0) {
      const v = this._prev.sub(camera.position).multiplyScalar(-1 / dt);
      if (v.length() < 90) this._vel.lerp(v, Math.min(1, dt * 8));
    } else this._vel.set(0, 0, 0);
    this._init = true;
    this._prev.copy(camera.position);
    u.uCamVel.value.copy(this._vel);
    u.uNear.value = inside ? 2.2 : 0.4;
  }
}
