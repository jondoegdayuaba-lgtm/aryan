// Boulders and stones: a few noise-sculpted shapes instanced around the camera,
// shaded with the same granite texture as the terrain (sampled in world space).
import * as THREE from 'three';
import { patch } from './shading.js';
import { makeSimplex } from './noise.js';
import { LAYER } from './bake.js';

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const n = makeSimplex(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + 0.28 * n(v.x * 1.3 + seed, v.z * 1.3) + 0.12 * n(v.y * 3.1, v.x * 3.1 - seed) + 0.05 * n(v.z * 7, v.y * 7);
    v.multiplyScalar(d);
    v.y *= 0.62;                                  // squat, glacial boulders
    if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.3;  // flattish underside
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Rocks {
  constructor(world, textures, max = 1400) {
    this.world = world;
    this.variants = [11, 23, 37, 51].map(rockGeometry);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    patch(mat, {
      uniforms: { uAlb: { value: textures.ground.albedo }, uNrm: { value: textures.ground.normal } },
      vertexPars: 'varying vec3 vRockN;',
      vertex: { '#include <beginnormal_vertex>': '$&\nvRockN = normalize( mat3( instanceMatrix ) * normal );' },
      fragmentPars: 'uniform mediump sampler2DArray uAlb; uniform mediump sampler2DArray uNrm; varying vec3 vRockN;',
      fragment: {
        '#include <map_fragment>': /* glsl */`
          // triplanar granite with moss on the tops
          vec3 wp = vWorldPosG;
          vec3 bw = pow( abs( normalize( vRockN ) ), vec3( 4.0 ) );
          bw /= bw.x + bw.y + bw.z;
          vec4 a = texture( uAlb, vec3( wp.zy / 3.0, ${LAYER.ROCK}.0 ) ) * bw.x
                 + texture( uAlb, vec3( wp.xz / 3.0, ${LAYER.ROCK}.0 ) ) * bw.y
                 + texture( uAlb, vec3( wp.xy / 3.0, ${LAYER.ROCK}.0 ) ) * bw.z;
          vec4 moss = texture( uAlb, vec3( wp.xz / 2.0, ${LAYER.FOREST}.0 ) );
          float up = smoothstep( 0.55, 0.9, normalize( vRockN ).y );
          diffuseColor.rgb = mix( a.rgb, moss.rgb * 0.9, up * 0.55 );`,
      },
    });
    this.meshes = this.variants.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      return m;
    });
    this.group = new THREE.Group();
    this.group.add(...this.meshes);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._last = new THREE.Vector3(1e9, 0, 0);
  }

  update(camera, range = 450) {
    const c = camera.position;
    if (c.distanceToSquared(this._last) < 16) return;
    this._last.copy(c);
    const counts = [0, 0, 0, 0];
    const r2 = range * range;
    this.world.rocks.forEach((r, i) => {
      const dx = r.x - c.x, dz = r.z - c.z;
      if (dx * dx + dz * dz > r2) return;
      const k = i & 3, mesh = this.meshes[k];
      if (counts[k] >= mesh.instanceMatrix.count) return;
      this._e.set((r.tilt - 0.5) * 0.4, r.rot, (r.tilt - 0.5) * 0.3);
      this._q.setFromEuler(this._e);
      this._s.setScalar(r.r);
      this._p.set(r.x, r.y - r.r * 0.35, r.z);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(counts[k]++, this._m);
    });
    this.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
