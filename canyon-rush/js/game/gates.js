// Checkpoint arches: inflatable gates across the road, a banner on each, and a
// tall beam of light over the next one so you can find it from far away.
import * as THREE from 'three';
import { canvasTexture } from '../render/textures.js';
import { useTerrainLight } from '../render/shaderpatch.js';

function stripeTexture(a, b, label) {
  return canvasTexture(1024, 64, (g, W, H) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect((i / n) * W, 0, W / n + 1, H);
    }
    if (label) {
      g.fillStyle = '#ffffff';
      g.font = 'italic 900 40px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, W / 2, H / 2 + 2);
    }
  }, { repeat: false });
}

function checkerTexture() {
  return canvasTexture(1024, 64, (g, W, H) => {
    const s = 16;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      g.fillStyle = ((x + y) / s) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x, y, s, s);
    }
  });
}

function bannerTexture(text, sub, color) {
  return canvasTexture(1024, 256, (g, W, H) => {
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, H - 26, W, 26);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 900 118px "Arial Black", Impact, sans-serif';
    g.fillText(text, W / 2, H * 0.44);
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText(sub, W / 2, H - 13);
  });
}

const BEAM_VERT = /* glsl */ `
  varying float vH;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vH = position.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHeight;
  uniform float uTime;
  varying float vH;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float t = vH / uHeight;
    float edge = pow(1.0 - abs(dot(normalize(vN.xz), normalize(vV.xz))), 1.5);
    float a = (1.0 - edge) * (1.0 - t) * (1.0 - t) * (0.75 + 0.25 * sin(vH * 0.08 - uTime * 3.0));
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Gates {
  constructor(scene, route, stage, heightAt) {
    this.scene = scene;
    this.gates = [];
    const cps = stage.checkpoints;
    const R = 7.5;
    const torus = new THREE.TorusGeometry(R, 0.55, 14, 56, Math.PI);
    const foot = new THREE.CylinderGeometry(0.75, 0.9, 0.5, 16);
    const post = new THREE.CylinderGeometry(0.08, 0.08, R + 1.5, 6);
    this.passedMat = useTerrainLight(new THREE.MeshStandardMaterial({ color: 0x9a948c, map: stripeTexture('#b8b2aa', '#8f8a84'), roughness: 0.65 }));
    this.footMat = useTerrainLight(new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.8 }));
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: new THREE.Color(2.2, 0.75, 0.12) }, uHeight: { value: 260 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.CylinderGeometry(2.6, 2.6, 260, 24, 1, true);
    beamGeo.translate(0, 130, 0);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.frustumCulled = false;
    scene.add(this.beam);

    cps.forEach(([ci, off], i) => {
      const s = route.wrapS(route.sAtControl(ci) + off);
      const p = route.pos(s), t = route.tangent(s);
      const finish = i === cps.length - 1;
      const g = new THREE.Group();
      const y = heightAt(p.x, p.z);
      g.position.set(p.x, y - 0.4, p.z);
      g.rotation.y = Math.atan2(t.x, t.z);
      const label = finish ? 'FINISH' : `CHECKPOINT ${i + 1}`;
      const mat = useTerrainLight(new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.55, metalness: 0,
        map: finish ? checkerTexture() : stripeTexture('#ff5a14', '#f2f0ea', ''),
        emissive: 0x000000,
      }));
      const arch = new THREE.Mesh(torus, mat);
      arch.castShadow = true;
      g.add(arch);
      for (const sx of [-1, 1]) {
        const f = new THREE.Mesh(foot, this.footMat);
        f.position.set(sx * R, 0.25, 0);
        g.add(f);
      }
      // Banner hanging under the top of the arch.
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), useTerrainLight(new THREE.MeshStandardMaterial({
        map: bannerTexture(finish ? 'FINISH' : `${i + 1}`, finish ? 'CANYON RUSH RALLY' : 'CHECKPOINT', finish ? '#141414' : '#e8480f'),
        side: THREE.DoubleSide, roughness: 0.7,
      })));
      banner.position.set(0, R - 1.6, 0);
      banner.castShadow = true;
      g.add(banner);
      for (const sx of [-1, 1]) {
        const rope = new THREE.Mesh(post, this.footMat);
        rope.position.set(sx * 3.2, R - 0.3, 0);
        rope.scale.y = 0.08;
        g.add(rope);
      }
      scene.add(g);
      this.gates.push({ group: g, arch, mat, s, pos: new THREE.Vector3(p.x, y, p.z), tangent: new THREE.Vector3(t.x, 0, t.z), finish, label, baseMap: mat.map });
    });
    this.next = 0;
    this.time = 0;
  }

  // Highlight state: `next` is the index of the gate to go through next (-1 for none).
  setNext(next) {
    this.next = next;
    this.gates.forEach((g, i) => {
      const passed = next >= 0 && i < next;
      g.arch.material = passed ? this.passedMat : g.mat;
      g.mat.emissive.set(i === next ? 0x331000 : 0x000000);
    });
    const g = this.gates[next];
    this.beam.visible = !!g;
    if (g) this.beam.position.copy(g.pos);
  }

  update(dt) {
    this.time += dt;
    this.beamMat.uniforms.uTime.value = this.time;
  }
}
