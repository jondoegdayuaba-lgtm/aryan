// Forest: instanced trees with four levels of detail per species.
import * as THREE from 'three';
import { injectWorldLight } from './shader-patches.js';

const SPECIES = 4;
const LOD_COUNT = 5;                 // 0-2 foliage, 3 stacked cones, 4 a four-sided pyramid for the far forest

const MAP_FRAG = /* glsl */`
#ifdef USE_MAP
	vec2 fuv = vMapUv;
	if ( ! gl_FrontFacing ) {
		float c0 = floor( fuv.x * 2.5 ) * 0.4;
		float ul = ( fuv.x - c0 ) * 5.0;
		fuv.x = c0 + 0.2 + ( 1.0 - ul ) * 0.2;
	}
	vec4 sampledDiffuseColor = texture2D( map, fuv );
	diffuseColor *= sampledDiffuseColor;
	if ( ! gl_FrontFacing ) diffuseColor.rgb *= 0.78;
#endif
`;

const NORMAL_NOFLIP = /* glsl */`
	float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
	vec3 normal = normalize( vNormal );
	vec3 nonPerturbedNormal = normal;
`;

function wrapChunk(wrap) {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const out = src.replace(
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
    `float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + ${wrap.toFixed(2)} ) / ${(1 + wrap).toFixed(2)} );
	reflectedLight.directDiffuse += ( wrapNL * directLight.color ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);
  if (out === src) console.warn('[vegetation] wrap lighting patch not applied');
  return out;
}

// gentle wind: the crown sways more the higher a vertex sits, each tree with its own phase
const SWAY_VERT = /* glsl */`
	{
		float swayH = clamp( transformed.y / 12.0, 0.0, 1.5 );
		float swayK = swayH * swayH;
		#ifdef USE_INSTANCING
			float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
			float sc = length( instanceMatrix[0].xyz );
		#else
			float ph = 0.0;
			float sc = 1.0;
		#endif
		float gust = 0.6 + 0.4 * sin( uWindTime * 0.37 + ph * 0.3 );
		transformed.x += sin( uWindTime * 1.35 + ph ) * 0.075 * swayK * gust;
		transformed.z += cos( uWindTime * 1.12 + ph * 1.3 ) * 0.05 * swayK * gust;
	}
`;

export function createFoliageMaterial(atlas, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: 0.88, metalness: 0,
    alphaTest: opts.alphaTest ?? 0.45, side: THREE.DoubleSide, alphaToCoverage: opts.alphaToCoverage ?? true,
  });
  const wrap = wrapChunk(0.5);
  const uWindTime = opts.windTime || { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uWindTime;
    injectWorldLight(shader);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uWindTime;\nvoid main() {')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', MAP_FRAG)
      .replace('#include <normal_fragment_begin>', NORMAL_NOFLIP)
      .replace('#include <lights_physical_pars_fragment>', wrap);
  };
  mat.customProgramCacheKey = () => 'foliage-v2';
  return mat;
}

export function createConeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const wrap = wrapChunk(0.5);
  mat.onBeforeCompile = (shader) => {
    injectWorldLight(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', NORMAL_NOFLIP)
      .replace('#include <lights_physical_pars_fragment>', wrap);
  };
  mat.customProgramCacheKey = () => 'cone-v1';
  return mat;
}

/** Crown-like normals: radial from the trunk with an upward tilt, blended with the card normal. */
function foliageNormals(geo, info) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const nor = geo.attributes.normal;
  const yc = info.crownCenter;
  const n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (uv && uv.getX(i) >= 0.79) continue;               // trunk keeps its own normals
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rl = Math.hypot(x, z) + 1e-4;
    const t = THREE.MathUtils.clamp((y - info.crownBase) / (info.height - info.crownBase), 0, 1);
    n.set(x / rl * 0.9, 0.42 + 0.35 * t, z / rl * 0.9);
    c.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    if (c.y < 0) c.negate();
    n.multiplyScalar(0.72).addScaledVector(c, 0.28).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
  void yc;
}

/** four triangles that stand in for a whole tree beyond ~1 km: same height, width and average colour as its cone LOD */
function farPyramid(cone) {
  cone.computeBoundingBox();
  const bb = cone.boundingBox;
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5;
  const g = new THREE.ConeGeometry(w * 1.05, bb.max.y * 0.98, 4, 1, true);
  g.translate(0, bb.max.y * 0.49, 0);
  const c = cone.attributes.color;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < c.count; i++) { r += c.getX(i); gg += c.getY(i); b += c.getZ(i); }
  r /= c.count; gg /= c.count; b /= c.count;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const tip = g.attributes.position.getY(i) > bb.max.y * 0.9 ? 1.25 : 0.9;
    col[i * 3] = r * tip; col[i * 3 + 1] = gg * tip; col[i * 3 + 2] = b * tip;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Vegetation {
  /**
   * @param world WorldData
   * @param gltf  parsed trees.glb
   * @param atlas branch atlas texture
   * @param info  tree_info.json
   */
  constructor(world, gltf, atlas, info, opts = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.lodDist = opts.lodDist || [46, 150, 430, 2100];
    this.shadowLods = opts.shadowLods ?? 2;      // LODs below this cast shadows
    this.windTime = { value: 0 };
    const foliage = this.foliageMat = createFoliageMaterial(atlas, { windTime: this.windTime });
    const cone = this.coneMat = createConeMaterial();

    // ---- geometries by species & lod
    this.geos = [];
    for (let s = 0; s < SPECIES; s++) {
      this.geos[s] = [];
      for (let l = 0; l < LOD_COUNT - 1; l++) {
        const node = gltf.scene.getObjectByName(`tree${s}_lod${l}`);
        if (!node) throw new Error(`trees.glb is missing tree${s}_lod${l}`);
        const mesh = node.isMesh ? node : node.children.find((c) => c.isMesh);
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld.identity());       // nodes are at the origin
        if (l < 3) foliageNormals(geo, info.species[s]);
        this.geos[s][l] = geo;
      }
      this.geos[s][4] = farPyramid(this.geos[s][3]);
    }

    // ---- per-tree matrices
    const T = world.trees;
    this.count = T.length / 6;
    this.matrices = new Float32Array(this.count * 16);
    this.species = new Uint8Array(this.count);
    this.pop = new Float32Array(this.count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const ay = new THREE.Vector3(0, 1, 0);
    const perSpecies = new Array(SPECIES).fill(0);
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const s = T[o + 5] | 0;
      this.species[i] = s;
      perSpecies[s]++;
      const k = T[o + 3];
      p.set(T[o], T[o + 2] - 0.18 * k, T[o + 1]);
      q.setFromAxisAngle(ay, T[o + 4]);
      sc.set(k, k * (0.94 + 0.12 * ((i * 2654435761 >>> 0) % 1000) / 1000), k);
      m.compose(p, q, sc);
      m.toArray(this.matrices, i * 16);
      this.pop[i] = 0.88 + 0.24 * (((i * 40503) >>> 0) % 1000) / 1000;
    }

    // ---- instanced meshes
    this.meshes = [];
    for (let s = 0; s < SPECIES; s++) {
      this.meshes[s] = [];
      for (let l = 0; l < LOD_COUNT; l++) {
        const im = new THREE.InstancedMesh(this.geos[s][l], l < 3 ? foliage : cone, Math.max(perSpecies[s], 1));
        im.frustumCulled = false;
        im.castShadow = l < this.shadowLods;
        im.receiveShadow = true;
        im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.name = `trees-${s}-${l}`;
        this.group.add(im);
        this.meshes[s][l] = im;
      }
    }
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this._age = 1e9;
    this.triangles = 0;
  }

  /** Re-bucket trees into LODs when the camera has moved. */
  update(camera, dt, force = false) {
    this.windTime.value += dt;
    this._age += dt;
    const cp = camera.position;
    const moved = Math.hypot(cp.x - this._last.x, cp.z - this._last.z);
    if (!force && moved < 5 && this._age < 0.5) return;
    this._age = 0;
    this._last.copy(cp);
    const fwd = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fl, fz = fwd.z / fl;
    const [d0, d1, d2, d3] = this.lodDist;
    const dFar = Math.min(d2 * 1.9, d3);
    const dThin = d3 * 0.5;
    const counts = this._counts || (this._counts = new Int32Array(SPECIES * LOD_COUNT));
    counts.fill(0);
    const T = this.world.trees;
    const M = this.matrices;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const dx = T[o] - cp.x, dz = T[o + 1] - cp.z;
      const d = Math.sqrt(dx * dx + dz * dz) * this.pop[i];
      if (d > d3) continue;
      let lod;
      if (d < d0) lod = 0;
      else if (d < d1) lod = 1;
      else if (d < d2) lod = 2;
      else if (d < dFar) lod = 3;
      else { lod = 4; if ((i & 1) && d > dThin) continue; }                  // the far forest is thinned to half the trees
      if (lod >= 2 && d > 90 && (dx * fx + dz * fz) < -0.25 * d) continue;   // behind the camera and not casting shadows
      const s = this.species[i];
      const mesh = this.meshes[s][lod];
      const k = counts[s * LOD_COUNT + lod]++;
      mesh.instanceMatrix.array.set(M.subarray(i * 16, i * 16 + 16), k * 16);
    }
    let tris = 0;
    for (let s = 0; s < SPECIES; s++) {
      for (let l = 0; l < LOD_COUNT; l++) {
        const mesh = this.meshes[s][l];
        const n = counts[s * LOD_COUNT + l];
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        tris += n * (this.geos[s][l].index ? this.geos[s][l].index.count / 3 : this.geos[s][l].attributes.position.count / 3);
      }
    }
    this.triangles = tris;
  }
}

const _v = new THREE.Vector3();
