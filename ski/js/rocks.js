// Boulders: instanced Blender rocks (4 kinds x 3 LODs) shaded with the same triplanar rock textures as the
// mountain, plus a snow cap that settles on upward-facing surfaces.
import * as THREE from 'three';
import { injectWorldLight } from './shader-patches.js';

const KINDS = 4;
const LODS = 3;
const UP = new THREE.Vector3(0, 1, 0);

const VERT_PARS = /* glsl */`
varying vec3 vRPos;
varying vec3 vRNor;
`;

const VERT_BODY = /* glsl */`
	{
		vec4 rp4 = vec4( transformed, 1.0 );
		vec3 rn = objectNormal;
		#ifdef USE_INSTANCING
			rp4 = instanceMatrix * rp4;
			mat3 rim = mat3( instanceMatrix );
			rn = transpose( inverse( rim ) ) * rn;
		#endif
		vRPos = ( modelMatrix * rp4 ).xyz;
		vRNor = normalize( mat3( modelMatrix ) * rn );
	}
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D uRockN;
uniform sampler2D uRockC;
varying vec3 vRPos;
varying vec3 vRNor;
`;

const SURFACE = /* glsl */`
	vec3 nGeo = normalize( vRNor );
	float rDist = length( vViewPosition );
	vec3 rw = pow( abs( nGeo ), vec3( 4.0 ) );
	rw /= ( rw.x + rw.y + rw.z );
	vec3 rp3 = vRPos * 0.16;
	vec3 rp4 = vRPos * 0.71 + 0.37;
	float rf4 = 1.0 - smoothstep( 25.0, 110.0, rDist );
	vec3 rx = texture2D( uRockN, rp3.zy ).xyz * 2.0 - 1.0;
	vec3 ry = texture2D( uRockN, rp3.xz ).xyz * 2.0 - 1.0;
	vec3 rz = texture2D( uRockN, rp3.xy ).xyz * 2.0 - 1.0;
	if ( rf4 > 0.0 ) {
		rx.xy += ( texture2D( uRockN, rp4.zy ).xy * 2.0 - 1.0 ) * 0.7 * rf4;
		ry.xy += ( texture2D( uRockN, rp4.xz ).xy * 2.0 - 1.0 ) * 0.7 * rf4;
		rz.xy += ( texture2D( uRockN, rp4.xy ).xy * 2.0 - 1.0 ) * 0.7 * rf4;
	}
	rx = vec3( rx.xy + nGeo.zy, abs( rx.z ) * nGeo.x );
	ry = vec3( ry.xy + nGeo.xz, abs( ry.z ) * nGeo.y );
	rz = vec3( rz.xy + nGeo.xy, abs( rz.z ) * nGeo.z );
	vec3 nRock = normalize( rx.zyx * rw.x + ry.xzy * rw.y + rz.xyz * rw.z );
	vec3 rc3 = texture2D( uRockC, rp3.zy ).rgb * rw.x + texture2D( uRockC, rp3.xz ).rgb * rw.y + texture2D( uRockC, rp3.xy ).rgb * rw.z;
	vec3 rc4 = texture2D( uRockC, rp4.zy ).rgb * rw.x + texture2D( uRockC, rp4.xz ).rgb * rw.y + texture2D( uRockC, rp4.xy ).rgb * rw.z;
	rc3 = mix( rc3, rc3 * rc4 * 1.5, 0.55 * rf4 );
	vec3 rockCol = vec3( 0.135, 0.118, 0.104 ) * rc3 * 1.55;
	float lowN = texture2D( uRockC, vRPos.xz * 0.045 ).r - 0.66;
	float snowA = smoothstep( 0.42, 0.78, nGeo.y + lowN * 1.1 + ( rc4.g - 0.66 ) * 0.5 );
	vec3 snowCol = vec3( 0.80, 0.84, 0.92 );
	diffuseColor.rgb = mix( rockCol, snowCol, snowA );
	vec3 nWorldR = normalize( mix( nRock, nGeo, snowA * 0.85 ) );
`;

const ROUGH = /* glsl */`
	float roughnessFactor = mix( 0.93, 0.78, snowA );
`;

const NORMAL = /* glsl */`
	float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
	vec3 normal = normalize( ( viewMatrix * vec4( nWorldR, 0.0 ) ).xyz );
	vec3 nonPerturbedNormal = normal;
`;

export function createRockMaterial(rockN, rockC) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRockN = { value: rockN };
    shader.uniforms.uRockC = { value: rockC };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    injectWorldLight(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAG_PARS}\nvoid main() {`)
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <roughnessmap_fragment>', ROUGH)
      .replace('#include <normal_fragment_begin>', NORMAL);
  };
  mat.customProgramCacheKey = () => 'rock-v1';
  return mat;
}

export class Rocks {
  /**
   * @param world WorldData
   * @param gltf  parsed rocks.glb (nodes rock<kind>_lod<level>)
   * @param rockN,rockC  tileable rock normal / tint textures
   */
  constructor(world, gltf, rockN, rockC, opts = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'rocks';
    this.lodDist = opts.lodDist || [70, 240, 950];
    this.shadowLods = 2;
    const material = this.material = createRockMaterial(rockN, rockC);

    this.geos = [];
    for (let k = 0; k < KINDS; k++) {
      this.geos[k] = [];
      for (let l = 0; l < LODS; l++) {
        const node = gltf.scene.getObjectByName(`rock${k}_lod${l}`);
        if (!node) throw new Error(`rocks.glb is missing rock${k}_lod${l}`);
        const mesh = node.isMesh ? node : node.children.find((c) => c.isMesh);
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        this.geos[k][l] = geo;
      }
    }

    // per-rock matrices: yaw, scale with a little stretch, tilt toward the ground normal, sunk by the slope
    const R = world.rocks;
    this.count = R.length / 6;
    this.matrices = new Float32Array(this.count * 16);
    this.kind = new Uint8Array(this.count);
    this.size = new Float32Array(this.count);
    const per = new Array(KINDS).fill(0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const n = new THREE.Vector3(), tgt = new THREE.Vector3();
    const tmp = { gx: 0, gz: 0 };
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const x = R[o], z = R[o + 1], s = R[o + 3], yaw = R[o + 4];
      const kind = (R[o + 5] | 0) % KINDS;
      this.kind[i] = kind;
      this.size[i] = s;
      per[kind]++;
      const y = world.sample(x, z, tmp);
      const slope = Math.hypot(tmp.gx, tmp.gz);
      n.set(-tmp.gx, 1, -tmp.gz).normalize();
      tgt.lerpVectors(UP, n, 0.55).normalize();
      qt.setFromUnitVectors(UP, tgt);
      q.setFromAxisAngle(UP, yaw);
      q.premultiply(qt);
      const h1 = ((i * 2654435761) >>> 0) / 4294967296, h2 = ((i * 40503 + 977) >>> 0) % 1000 / 1000, h3 = ((i * 69069 + 12345) >>> 0) % 1000 / 1000;
      sc.set(s * (0.86 + 0.3 * h1), s * (0.82 + 0.28 * h2), s * (0.86 + 0.3 * h3));
      p.set(x, y - 0.18 * s * Math.min(slope, 1.4), z);
      m.compose(p, q, sc);
      m.toArray(this.matrices, i * 16);
    }

    this.meshes = [];
    for (let k = 0; k < KINDS; k++) {
      this.meshes[k] = [];
      for (let l = 0; l < LODS; l++) {
        const im = new THREE.InstancedMesh(this.geos[k][l], material, Math.max(per[k], 1));
        im.frustumCulled = false;
        im.castShadow = l < this.shadowLods;
        im.receiveShadow = true;
        im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.name = `rocks-${k}-${l}`;
        this.group.add(im);
        this.meshes[k][l] = im;
      }
    }
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this._age = 1e9;
    this.triangles = 0;
  }

  update(camera, dt, force = false) {
    this._age += dt;
    const cp = camera.position;
    const moved = Math.hypot(cp.x - this._last.x, cp.z - this._last.z);
    if (!force && moved < 6 && this._age < 0.6) return;
    this._age = 0;
    this._last.copy(cp);
    const fwd = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fl, fz = fwd.z / fl;
    const [d0, d1, d2] = this.lodDist;
    const counts = this._counts || (this._counts = new Int32Array(KINDS * LODS));
    counts.fill(0);
    const R = this.world.rocks, M = this.matrices;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const dx = R[o] - cp.x, dz = R[o + 1] - cp.z;
      const s = this.size[i];
      const d = Math.sqrt(dx * dx + dz * dz) / (0.55 + 0.45 * s);
      if (d > d2) continue;
      if (d > 60 && (dx * fx + dz * fz) < -0.3 * Math.sqrt(dx * dx + dz * dz) - 5 * s) continue;   // behind the camera
      const lod = d < d0 ? 0 : d < d1 ? 1 : 2;
      const k = this.kind[i];
      const mesh = this.meshes[k][lod];
      mesh.instanceMatrix.array.set(M.subarray(i * 16, i * 16 + 16), counts[k * LODS + lod]++ * 16);
    }
    let tris = 0;
    for (let k = 0; k < KINDS; k++) {
      for (let l = 0; l < LODS; l++) {
        const mesh = this.meshes[k][l];
        const n = counts[k * LODS + l];
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        const g = this.geos[k][l];
        tris += n * (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
      }
    }
    this.triangles = tris;
  }
}

const _v = new THREE.Vector3();
