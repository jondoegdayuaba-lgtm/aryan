// Chunked LOD terrain. Every chunk of a given level shares one flat grid; the vertex
// shader lifts it onto the height texture, so the CPU only ever writes instance offsets.
import * as THREE from 'three';
import { injectWorldLight, WorldLight } from './shader-patches.js';
import { makeSnowNormalTexture, makeRockTextures } from './procedural-textures.js';

const CHUNK_CELLS = 64;
const LOD_COUNT = 5;

function gridGeometry(cells, chunkSize, skirt) {
  const n = cells + 1;
  const step = chunkSize / cells;
  const total = n * n + 4 * n;
  const pos = new Float32Array(total * 3);
  const skirtAttr = new Float32Array(total);
  const nor = new Float32Array(total * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    pos[k * 3] = i * step;
    pos[k * 3 + 2] = j * step;
  }
  const S = n * n;
  const edge = [];   // per edge, list of top vertex indices
  edge[0] = Array.from({ length: n }, (_, j) => j * n);                 // west  (i = 0)
  edge[1] = Array.from({ length: n }, (_, j) => j * n + cells);         // east
  edge[2] = Array.from({ length: n }, (_, i) => i);                     // north (j = 0)
  edge[3] = Array.from({ length: n }, (_, i) => cells * n + i);         // south
  const idx = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * n + i, b = (j + 1) * n + i, c = j * n + i + 1, d = (j + 1) * n + i + 1;
    idx.push(a, b, c, c, b, d);
  }
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n; k++) {
      const top = edge[e][k];
      const s = S + e * n + k;
      pos[s * 3] = pos[top * 3];
      pos[s * 3 + 2] = pos[top * 3 + 2];
      skirtAttr[s] = skirt;
    }
    for (let k = 0; k < cells; k++) {
      const t0 = edge[e][k], t1 = edge[e][k + 1];
      const s0 = S + e * n + k, s1 = s0 + 1;
      if (e === 0 || e === 3) idx.push(t0, s0, t1, t1, s0, s1);
      else idx.push(t0, t1, s0, t1, s1, s0);
    }
  }
  for (let k = 0; k < total; k++) nor[k * 3 + 1] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aSkirt', new THREE.BufferAttribute(skirtAttr, 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

function buildNormalTexture(world) {
  const { nx, nz, heights: H, invDx } = world;
  const data = new Uint8Array(nx * nz * 4);
  const half = 0.5 * invDx;
  for (let j = 0; j < nz; j++) {
    const jm = Math.max(j - 1, 0) * nx, jp = Math.min(j + 1, nz - 1) * nx, jc = j * nx;
    for (let i = 0; i < nx; i++) {
      const im = Math.max(i - 1, 0), ip = Math.min(i + 1, nx - 1);
      const gx = (H[jc + ip] - H[jc + im]) * half;
      const gz = (H[jp + i] - H[jm + i]) * half;
      const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      const o = (jc + i) * 4;
      data[o] = (-gx * inv * 0.5 + 0.5) * 255 + 0.5;
      data[o + 1] = (inv * 0.5 + 0.5) * 255 + 0.5;
      data[o + 2] = (-gz * inv * 0.5 + 0.5) * 255 + 0.5;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const VERT_PARS = /* glsl */`
uniform sampler2D uHeightTex;
uniform vec4 uGrid;        // x0, z0, dx, 0
uniform vec2 uGridDim;     // nx, nz
attribute float aSkirt;
varying vec3 vTPos;
`;

const VERT_DISPLACE = /* glsl */`
	{
		vec4 tw = instanceMatrix * vec4( transformed, 1.0 );
		vec2 gp = ( tw.xz - uGrid.xy ) / uGrid.z;
		ivec2 gi = ivec2( clamp( floor( gp + 0.5 ), vec2( 0.0 ), uGridDim - 1.0 ) );
		float th = texelFetch( uHeightTex, gi, 0 ).r;
		transformed.y = th - aSkirt;
		vTPos = vec3( tw.x, th, tw.z );
	}
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D uNormalTex;
uniform sampler2D uColorTex;
uniform sampler2D uMaskTex;
uniform sampler2D uSnowN;
uniform sampler2D uRockN;
uniform sampler2D uRockC;
uniform vec4 uGrid;
uniform vec2 uGridDim;
uniform vec3 uSunDir;
uniform vec3 uSunRadiance;
uniform float uSparkle;
uniform float uDetail;
uniform float uTime;
varying vec3 vTPos;

float hash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
`;

// Called from the light chunk hook so sparkle knows how much sun reaches the pixel.
const SURFACE = /* glsl */`
	vec3 tp = vTPos;
	vec2 tuvG = ( ( tp.xz - uGrid.xy ) / uGrid.z + 0.5 ) / uGridDim;
	vec3 nG = normalize( texture2D( uNormalTex, tuvG ).xyz * 2.0 - 1.0 );
	vec2 muv = ( tp.xz - uWorldRect.xy ) / uWorldRect.zw;
	vec4 tMask = texture2D( uMaskTex, muv );
	vec3 tMacro = texture2D( uColorTex, muv ).rgb;
	vec3 tLM = texture2D( uLightTex, muv ).rgb;
	float tDist = length( vViewPosition );

	float rockAmt = tMask.r;
	float litter = tMask.g;
	float groom = tMask.b;
	float drift = tMask.a;

	// snow micro relief: three scales, the fine ones fade with distance
	vec2 sp = tp.xz;
	vec3 sn1 = texture2D( uSnowN, sp * 0.137 ).xyz * 2.0 - 1.0;
	vec3 sn2 = texture2D( uSnowN, sp * 0.59 + 0.37 ).xyz * 2.0 - 1.0;
	vec3 sn3 = texture2D( uSnowN, sp * 2.3 + 0.71 ).xyz * 2.0 - 1.0;
	float f2 = 1.0 - smoothstep( 70.0, 220.0, tDist );
	float f3 = ( 1.0 - smoothstep( 8.0, 38.0, tDist ) ) * uDetail;
	vec2 dn = sn1.xy * 0.42 + sn2.xy * 0.38 * f2 + sn3.xy * 0.55 * f3;
	dn *= mix( 0.6, 1.0, drift ) * mix( 1.0, 0.45, groom );
	vec3 tT = normalize( vec3( 1.0, 0.0, 0.0 ) - nG * nG.x );
	vec3 tB = - cross( nG, tT );
	vec3 nSnow = normalize( nG + tT * dn.x + tB * dn.y );

	vec3 nW = nSnow;
	vec3 rockTint = vec3( 1.0 );
	rockAmt = smoothstep( 0.25, 0.75, rockAmt + ( sn2.x - 0.0 ) * 0.25 * ( 1.0 - f3 * 0.0 ) );
	if ( rockAmt > 0.01 ) {
		vec3 w = pow( abs( nG ), vec3( 4.0 ) );
		w /= ( w.x + w.y + w.z );
		vec3 p3 = tp * 0.16;
		vec3 rx = texture2D( uRockN, p3.zy ).xyz * 2.0 - 1.0;
		vec3 ry = texture2D( uRockN, p3.xz ).xyz * 2.0 - 1.0;
		vec3 rz = texture2D( uRockN, p3.xy ).xyz * 2.0 - 1.0;
		rx = vec3( rx.xy + nG.zy, abs( rx.z ) * nG.x );
		ry = vec3( ry.xy + nG.xz, abs( ry.z ) * nG.y );
		rz = vec3( rz.xy + nG.xy, abs( rz.z ) * nG.z );
		vec3 nR = normalize( rx.zyx * w.x + ry.xzy * w.y + rz.xyz * w.z );
		nW = normalize( mix( nSnow, nR, rockAmt ) );
		vec3 c3 = texture2D( uRockC, p3.zy ).rgb * w.x + texture2D( uRockC, p3.xz ).rgb * w.y + texture2D( uRockC, p3.xy ).rgb * w.z;
		rockTint = mix( vec3( 1.0 ), c3 * 1.55, rockAmt );
	}
	diffuseColor.rgb = tMacro * rockTint;
`;

const NORMAL = /* glsl */`
	float faceDirection = 1.0;
	vec3 normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
	vec3 nonPerturbedNormal = normal;
`;

const ROUGH = /* glsl */`
	float roughnessFactor = mix( 0.78, 0.66, groom );
	roughnessFactor = mix( roughnessFactor, 0.9, drift * 0.5 );
	roughnessFactor = mix( roughnessFactor, 0.93, max( rockAmt, litter * 0.8 ) );
`;

const AO = /* glsl */`
	{
		float tao = mix( 1.0, tLM.b, uWLAo );
		reflectedLight.indirectDiffuse *= tao;
		float tdotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( tdotNV, tao, material.roughness );
	}
`;

const SPARKLE = /* glsl */`
	{
		vec3 tSpark = vec3( 0.0 );
		float sparkFade = 1.0 - smoothstep( 14.0, 55.0, tDist );
		if ( uSparkle > 0.0 && sparkFade > 0.0 && rockAmt < 0.6 ) {
			vec3 tV = normalize( cameraPosition - tp );
			vec3 Lh = normalize( uSunDir + tV );
			float acc = 0.0;
			vec2 c1 = tp.xz * 34.0;
			vec2 id1 = floor( c1 );
			vec3 r1 = vec3( hash12( id1 ), hash12( id1 + 7.13 ), hash12( id1 + 3.71 ) ) - 0.5;
			acc += smoothstep( 0.9975, 1.0, dot( normalize( nW + r1 * 1.7 ), Lh ) ) * step( 0.45, hash12( id1 + 11.3 ) );
			vec2 c2 = tp.xz * 9.0 + 41.7;
			vec2 id2 = floor( c2 );
			vec3 r2 = vec3( hash12( id2 ), hash12( id2 + 5.31 ), hash12( id2 + 1.77 ) ) - 0.5;
			acc += 1.6 * smoothstep( 0.9985, 1.0, dot( normalize( nW + r2 * 1.5 ), Lh ) ) * step( 0.55, hash12( id2 + 9.1 ) );
			tSpark = uSunRadiance * acc * sparkFade * uSparkle * gWLVis * ( 1.0 - groom * 0.35 ) * saturate( dot( nW, uSunDir ) * 4.0 );
		}
		outgoingLight += tSpark;
	}
`;

export class TerrainRenderer {
  /**
   * @param world WorldData
   * @param tex { color, mask, light?, snowN?, rockN?, rockC? }
   */
  constructor(world, tex, opts = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunkSize = CHUNK_CELLS * world.dx;
    this.ncx = Math.ceil((world.nx - 1) / CHUNK_CELLS);
    this.ncz = Math.ceil((world.nz - 1) / CHUNK_CELLS);
    this.lodDist = opts.lodDist || [190, 430, 950, 2000];
    this._frustum = new THREE.Frustum();
    this._proj = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();

    const heightTex = new THREE.DataTexture(world.heights, world.nx, world.nz, THREE.RedFormat, THREE.FloatType);
    heightTex.minFilter = heightTex.magFilter = THREE.NearestFilter;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;
    this.heightTex = heightTex;
    this.normalTex = buildNormalTexture(world);

    const snowN = tex.snowN || makeSnowNormalTexture(256);
    const rock = tex.rockN && tex.rockC ? { normal: tex.rockN, color: tex.rockC } : makeRockTextures(256);
    [snowN, rock.normal, rock.color].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });

    const u = this.uniforms = {
      uHeightTex: { value: heightTex },
      uNormalTex: { value: this.normalTex },
      uColorTex: { value: tex.color },
      uMaskTex: { value: tex.mask },
      uSnowN: { value: snowN },
      uRockN: { value: rock.normal },
      uRockC: { value: rock.color },
      uGrid: { value: new THREE.Vector4(world.x0, world.z0, world.dx, 0) },
      uGridDim: { value: new THREE.Vector2(world.nx, world.nz) },
      uSunDir: { value: new THREE.Vector3(...world.sunDir) },
      uSunRadiance: { value: new THREE.Vector3(3, 2.8, 2.5) },
      uSparkle: { value: opts.sparkle ?? 1.0 },
      uDetail: { value: 1.0 },
      uTime: { value: 0 },
    };

    const material = this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    const lightsPhysical = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
      `float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.2 ) / 1.2 );
	reflectedLight.directDiffuse += ( wrapNL * directLight.color ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);
    if (lightsPhysical === THREE.ShaderChunk.lights_physical_pars_fragment) console.warn('[terrain] snow wrap patch not applied');

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.uWLAo = WorldLight.aoStrength;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_DISPLACE}`);
      injectWorldLight(shader, { terrain: true });
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `uniform float uWLAo;\n${FRAG_PARS}\nvoid main() {`)
        .replace('#include <map_fragment>', SURFACE)
        .replace('#include <roughnessmap_fragment>', ROUGH)
        .replace('#include <normal_fragment_begin>', NORMAL)
        .replace('#include <lights_physical_pars_fragment>', lightsPhysical)
        .replace('#include <aomap_fragment>', AO)
        .replace('#include <opaque_fragment>', `${SPARKLE}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'terrain-v1';

    // one instanced mesh per LOD
    this.meshes = [];
    this.counts = new Int32Array(LOD_COUNT);
    const maxInstances = this.ncx * this.ncz;
    for (let l = 0; l < LOD_COUNT; l++) {
      const cells = CHUNK_CELLS >> l;
      const skirtDepth = Math.max(2.0, 1.4 * (this.chunkSize / cells));
      const mesh = new THREE.InstancedMesh(gridGeometry(cells, this.chunkSize, skirtDepth), material, maxInstances);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.count = 0;
      mesh.name = `terrain-lod${l}`;
      const arr = mesh.instanceMatrix.array;
      for (let i = 0; i < maxInstances; i++) { arr[i * 16] = arr[i * 16 + 5] = arr[i * 16 + 10] = arr[i * 16 + 15] = 1; }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    // chunk bounds
    this.chunks = [];
    for (let cz = 0; cz < this.ncz; cz++) {
      for (let cx = 0; cx < this.ncx; cx++) {
        const i0 = cx * CHUNK_CELLS, j0 = cz * CHUNK_CELLS;
        let mn = Infinity, mx = -Infinity;
        for (let j = j0; j <= Math.min(j0 + CHUNK_CELLS, world.nz - 1); j += 2) {
          for (let i = i0; i <= Math.min(i0 + CHUNK_CELLS, world.nx - 1); i += 2) {
            const h = world.heights[j * world.nx + i];
            if (h < mn) mn = h;
            if (h > mx) mx = h;
          }
        }
        if (mn === Infinity) { mn = mx = 0; }
        const ox = world.x0 + i0 * world.dx, oz = world.z0 + j0 * world.dx;
        const half = this.chunkSize / 2;
        this.chunks.push({
          ox, oz, cx: ox + half, cz: oz + half, cy: (mn + mx) / 2,
          r: Math.hypot(half * 1.4143, (mx - mn) / 2) + 2,
        });
      }
    }
  }

  setSun(dir, radiance) {
    this.uniforms.uSunDir.value.set(dir[0], dir[1], dir[2]).normalize();
    this.uniforms.uSunRadiance.value.copy(radiance);
  }

  /** Cull and assign LODs for the given camera. */
  update(camera) {
    camera.updateMatrixWorld();
    this._proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._proj);
    const p = camera.position;
    this.counts.fill(0);
    const [d0, d1, d2, d3] = this.lodDist;
    let visible = 0;
    for (const c of this.chunks) {
      this._sphere.center.set(c.cx, c.cy, c.cz);
      this._sphere.radius = c.r;
      if (!this._frustum.intersectsSphere(this._sphere)) continue;
      const d = Math.hypot(c.cx - p.x, c.cz - p.z) - 0.5 * this.chunkSize;
      const lod = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : d < d3 ? 3 : 4;
      const mesh = this.meshes[lod];
      const k = this.counts[lod]++;
      const arr = mesh.instanceMatrix.array;
      arr[k * 16 + 12] = c.ox;
      arr[k * 16 + 14] = c.oz;
      visible++;
    }
    for (let l = 0; l < LOD_COUNT; l++) {
      this.meshes[l].count = this.counts[l];
      this.meshes[l].instanceMatrix.needsUpdate = true;
    }
    this.visibleChunks = visible;
  }

  get triangleCount() {
    let t = 0;
    for (let l = 0; l < LOD_COUNT; l++) t += this.counts[l] * (this.meshes[l].geometry.index.count / 3);
    return t;
  }
}
