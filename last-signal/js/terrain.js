// Turns the height grid into meshes and shades them: chunked terrain with four levels of detail,
// a far ring of mountains, and one material that blends grass, forest floor, trail dirt, gravel,
// rock and snow from slope, height and the splat map, with a wet look in the rain.
import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';

const CHUNK = 128;                       // metres per chunk side
const RING = 5184;                       // how far the far mountains reach

// Shared with the grass shader so blades match the ground colour where they meet it.
export const TERRAIN_COMMON_GLSL = /* glsl */`
uniform sampler2D uNoiseTex;
uniform sampler2D uSplatTex;
uniform vec4 uWorld;      // x: half size, y: lake level, z: snow line above the lake, w: unused
uniform vec2 uMapT;       // scale, offset from world metres to map uv

vec2 worldUv( vec2 xz ) { return ( xz + uWorld.x ) * uMapT.x + uMapT.y; }

vec3 grassTint( vec2 xz, float lush ) {
  float macro = texture2D( uNoiseTex, xz * 0.0031 ).r;
  float mid = texture2D( uNoiseTex, xz * 0.017 + 0.3 ).g;
  vec3 dry = vec3( 1.28, 1.08, 0.72 ), wet = vec3( 0.86, 1.06, 0.84 );
  vec3 t = mix( dry, wet, clamp( lush * 1.15, 0.0, 1.0 ) );
  return t * mix( 0.86, 1.14, macro ) * ( 0.9 + 0.2 * mid );
}
`;

const VERT_PARS = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNormal;
`;

const FRAG_PARS = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNormal;
uniform float uTime;
uniform float uWet;
uniform sampler2D uNormalTex;
uniform sampler2DArray uAlbedoArr;
uniform sampler2DArray uNormalArr;
${TERRAIN_COMMON_GLSL}

struct Layer { vec4 alb; vec4 nrm; };

Layer sampleLayer( int L, float tile, vec2 uvw, vec2 dx, vec2 dy, float farMix ) {
  Layer r;
  vec2 uv = uvw / tile;
  r.alb = textureGrad( uAlbedoArr, vec3( uv, float( L ) ), dx / tile, dy / tile );
  r.nrm = textureGrad( uNormalArr, vec3( uv, float( L ) ), dx / tile, dy / tile );
  if ( farMix > 0.001 ) {
    vec2 uv2 = uvw / ( tile * 7.3 ) + 0.37;
    vec4 a2 = textureGrad( uAlbedoArr, vec3( uv2, float( L ) ), dx / ( tile * 7.3 ), dy / ( tile * 7.3 ) );
    vec4 n2 = textureGrad( uNormalArr, vec3( uv2, float( L ) ), dx / ( tile * 7.3 ), dy / ( tile * 7.3 ) );
    r.alb = mix( r.alb, a2, farMix );
    r.nrm = mix( r.nrm, n2, farMix );
  }
  return r;
}

vec2 unpackXY( vec4 n ) { return n.xy * 2.0 - 1.0; }

float blendW( float w, float hTop, float hBot ) {
  float t = w + ( hTop - hBot ) * 0.5 * ( w * ( 1.0 - w ) * 4.0 );
  return smoothstep( 0.3, 0.7, t );
}

vec3 tAlbedo;
vec3 tNormalW;
float tRough;
float tAO;

void shadeTerrain() {
  vec2 uvw = worldUv( vWPos.xz );
  bool inside = uvw.x > 0.0 && uvw.y > 0.0 && uvw.x < 1.0 && uvw.y < 1.0;
  vec3 nW;
  vec4 sp;
  float macroAO = 1.0;
  if ( inside ) {
    vec4 nt = texture2D( uNormalTex, uvw );
    nW = normalize( nt.xyz * 2.0 - 1.0 );
    macroAO = clamp( nt.a / 0.87, 0.5, 1.15 );
    sp = texture2D( uSplatTex, uvw );
  } else {
    nW = normalize( vWNormal );
    sp = vec4( 0.0, 0.0, 0.0, 0.35 );
  }

  // Screen-space derivatives are taken once, up front, so texture lookups inside branches stay well defined.
  vec2 xz = vWPos.xz;
  vec3 dPx = dFdx( vWPos ), dPy = dFdy( vWPos );
  vec2 dx = dPx.xz, dy = dPy.xz;
  float dist = length( vWPos - cameraPosition );
  float farMix = smoothstep( 22.0, 110.0, dist );
  vec4 nzF = texture2D( uNoiseTex, xz * 0.09 );
  vec4 nzL = texture2D( uNoiseTex, xz * 0.0011 );
  float yAbove = vWPos.y - uWorld.y;
  float slope = nW.y;

  float wRock = 1.0 - smoothstep( 0.60, 0.80, slope + ( nzF.g - 0.5 ) * 0.12 );
  float wSnow = smoothstep( uWorld.z - 35.0, uWorld.z + 25.0, yAbove + ( nzL.b - 0.5 ) * 90.0 ) * smoothstep( 0.5, 0.75, slope );
  float jitter = ( nzF.a - 0.5 ) * 0.45;
  float wTrail = clamp( sp.r + jitter * sp.r * ( 1.0 - sp.r ) * 2.0, 0.0, 1.0 );
  float wForest = clamp( sp.g + jitter * 0.5, 0.0, 1.0 );
  float wShore = clamp( sp.b + jitter * 0.5, 0.0, 1.0 );

  // Layer 0: grass is the base everything is blended over.
  Layer g = sampleLayer( 0, 2.6, xz, dx, dy, farMix );
  vec3 col = g.alb.rgb * grassTint( xz, sp.a );
  float h = g.alb.a, rough = g.nrm.b, ao = g.nrm.a;
  vec3 dn = vec3( unpackXY( g.nrm ).x, 0.0, unpackXY( g.nrm ).y );

  if ( wForest > 0.02 ) {
    Layer f = sampleLayer( 1, 3.2, xz, dx, dy, farMix );
    float t = blendW( wForest, f.alb.a, h );
    col = mix( col, f.alb.rgb * 1.05, t ); rough = mix( rough, f.nrm.b, t ); ao = mix( ao, f.nrm.a, t );
    dn = mix( dn, vec3( unpackXY( f.nrm ).x, 0.0, unpackXY( f.nrm ).y ), t ); h = mix( h, f.alb.a, t );
  }
  if ( wShore > 0.02 ) {
    Layer s = sampleLayer( 3, 2.0, xz, dx, dy, farMix );
    float t = blendW( wShore, s.alb.a, h );
    col = mix( col, s.alb.rgb, t ); rough = mix( rough, s.nrm.b, t ); ao = mix( ao, s.nrm.a, t );
    dn = mix( dn, vec3( unpackXY( s.nrm ).x, 0.0, unpackXY( s.nrm ).y ), t ); h = mix( h, s.alb.a, t );
  }
  if ( wTrail > 0.02 ) {
    Layer d = sampleLayer( 2, 2.4, xz, dx, dy, farMix );
    float t = blendW( wTrail, d.alb.a, h );
    col = mix( col, d.alb.rgb, t ); rough = mix( rough, d.nrm.b, t ); ao = mix( ao, d.nrm.a, t );
    dn = mix( dn, vec3( unpackXY( d.nrm ).x, 0.0, unpackXY( d.nrm ).y ), t ); h = mix( h, d.alb.a, t );
  }
  if ( wRock > 0.02 ) {
    // Triplanar so cliffs are not smeared: one projection along each axis, weighted by the normal.
    vec3 w3 = pow( abs( nW ), vec3( 4.0 ) );
    w3 /= w3.x + w3.y + w3.z;
    float tile = 4.2;
    Layer ry = sampleLayer( 4, tile, xz, dx, dy, farMix );
    vec2 zy = vec2( vWPos.z, vWPos.y ), zyDx = vec2( dPx.z, dPx.y ), zyDy = vec2( dPy.z, dPy.y );
    vec2 xy = vec2( vWPos.x, vWPos.y ), xyDx = vec2( dPx.x, dPx.y ), xyDy = vec2( dPy.x, dPy.y );
    Layer rx = sampleLayer( 4, tile, zy, zyDx, zyDy, farMix );
    Layer rz = sampleLayer( 4, tile, xy, xyDx, xyDy, farMix );
    vec3 rc = ry.alb.rgb * w3.y + rx.alb.rgb * w3.x + rz.alb.rgb * w3.z;
    float rh = ry.alb.a * w3.y + rx.alb.a * w3.x + rz.alb.a * w3.z;
    float rr = ry.nrm.b * w3.y + rx.nrm.b * w3.x + rz.nrm.b * w3.z;
    float ra = ry.nrm.a * w3.y + rx.nrm.a * w3.x + rz.nrm.a * w3.z;
    vec2 ty = unpackXY( ry.nrm ), tx = unpackXY( rx.nrm ), tz = unpackXY( rz.nrm );
    vec3 rdn = vec3( ty.x, 0.0, ty.y ) * w3.y + vec3( 0.0, tx.y, tx.x ) * w3.x + vec3( tz.x, tz.y, 0.0 ) * w3.z;
    float t = blendW( wRock, rh, h );
    // Rock takes a little colour from the ground above it: dust and lichen on the flatter ledges.
    rc *= 0.92 + 0.16 * nzF.r;
    col = mix( col, rc, t ); rough = mix( rough, rr, t ); ao = mix( ao, ra, t );
    dn = mix( dn, rdn, t ); h = mix( h, rh, t );
  }
  if ( wSnow > 0.02 ) {
    Layer s = sampleLayer( 5, 5.0, xz, dx, dy, farMix );
    float t = blendW( wSnow, s.alb.a, h );
    col = mix( col, s.alb.rgb, t ); rough = mix( rough, s.nrm.b, t ); ao = mix( ao, s.nrm.a, t );
    dn = mix( dn, vec3( unpackXY( s.nrm ).x, 0.0, unpackXY( s.nrm ).y ), t );
  }

  // Wet ground is darker and glossier.
  float wet = uWet * ( 1.0 - wSnow ) + wShore * 0.5;
  col *= mix( 1.0, 0.68, clamp( wet, 0.0, 1.0 ) );
  rough = mix( rough, 0.3, clamp( wet, 0.0, 1.0 ) * 0.75 );

  // The lake bed: dappled with moving light in the shallows.
  float below = uWorld.y - vWPos.y;
  if ( below > 0.0 && inside ) {
    float c1 = texture2D( uNoiseTex, xz * 0.05 + vec2( uTime * 0.012, 0.0 ) ).g;
    float c2 = texture2D( uNoiseTex, xz * 0.043 - vec2( 0.0, uTime * 0.01 ) ).a;
    float caustic = pow( clamp( 1.0 - abs( c1 - c2 ) * 2.6, 0.0, 1.0 ), 7.0 );
    col *= 1.0 + 2.2 * caustic * exp( -below * 0.45 ) * max( uSunDir.y, 0.0 );
  }

  float fade = 1.0 - farMix * 0.55;
  vec3 n = normalize( nW + dn * fade * 0.95 );
  tAlbedo = col;
  tNormalW = n;
  tRough = clamp( rough, 0.2, 1.0 );
  tAO = clamp( macroAO * mix( 1.0, ao, 0.8 ), 0.3, 1.1 );
}
`;

export class Terrain {
  constructor(world, textures, noiseTex, { anisotropy = 8 } = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = [];
    this.lodScale = 1;
    this.castShadows = true;

    const V = world.v;
    this.heightTex = new THREE.DataTexture(world.heights, V, V, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    const mapTex = (data, mip) => {
      const t = new THREE.DataTexture(data, V, V, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.generateMipmaps = !!mip;
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
      return t;
    };
    this.normalTex = mapTex(world.normalTex, true);
    this.splatTex = mapTex(world.splat, true);

    this.uniforms = {
      uNormalTex: { value: this.normalTex },
      uSplatTex: { value: this.splatTex },
      uNoiseTex: { value: noiseTex },
      uAlbedoArr: { value: textures.albedo },
      uNormalArr: { value: textures.normal },
      uWorld: { value: new THREE.Vector4(world.half, world.lakeY, 300, 0) },
      uMapT: { value: new THREE.Vector2((V - 1) / (world.size * V), 0.5 / V) },
    };

    this.material = this._makeMaterial();
    this._buildRing();
    this._buildChunks();
  }

  _makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    patchMaterial(m, 'terrain', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  vWNormal = normalize( mat3( modelMatrix ) * objectNormal );');
      // The terrain functions go after the fog and light declarations, which they rely on.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_pars_fragment>', '#include <roughnessmap_pars_fragment>\n' + FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n  shadeTerrain();\n  diffuseColor.rgb = tAlbedo;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize( ( viewMatrix * vec4( tNormalW, 0.0 ) ).xyz );')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tAO;\n  reflectedLight.indirectSpecular *= tAO;');
    });
    return m;
  }

  // Builds one chunk's geometry at a level of detail: a grid with a skirt hiding cracks against neighbours.
  _chunkGeometry(cx, cz, lod) {
    const w = this.world, V = w.v, cell = w.cell;
    const cells = CHUNK / cell;                 // 64
    const step = 1 << lod;
    const n = cells / step;
    const ix0 = cx * cells, iz0 = cz * cells;
    const skirt = [3, 5, 9, 16][lod];
    const inner = (n + 1) * (n + 1), edge = (n + 1) * 4;
    const pos = new Float32Array((inner + edge) * 3);
    const nor = new Float32Array((inner + edge) * 3);
    const H = (ix, iz) => w.heights[Math.min(V - 1, Math.max(0, iz)) * V + Math.min(V - 1, Math.max(0, ix))];
    let k = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++, k++) {
        const ix = ix0 + i * step, iz = iz0 + j * step;
        pos[k * 3] = -w.half + ix * cell; pos[k * 3 + 1] = H(ix, iz); pos[k * 3 + 2] = -w.half + iz * cell;
        const dx = (H(ix - 1, iz) - H(ix + 1, iz)) / (2 * cell), dz = (H(ix, iz - 1) - H(ix, iz + 1)) / (2 * cell);
        const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        nor[k * 3] = dx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = dz * il;
      }
    }
    // Skirt vertices: copies of the border, dropped down.
    const border = [];
    for (let i = 0; i <= n; i++) border.push(i);                                       // north edge (j = 0)
    for (let i = 0; i <= n; i++) border.push(n * (n + 1) + i);                         // south edge (j = n)
    for (let j = 0; j <= n; j++) border.push(j * (n + 1));                             // west edge (i = 0)
    for (let j = 0; j <= n; j++) border.push(j * (n + 1) + n);                         // east edge (i = n)
    border.forEach((src, b) => {
      const d = inner + b;
      pos[d * 3] = pos[src * 3]; pos[d * 3 + 1] = pos[src * 3 + 1] - skirt; pos[d * 3 + 2] = pos[src * 3 + 2];
      nor[d * 3] = nor[src * 3]; nor[d * 3 + 1] = nor[src * 3 + 1]; nor[d * 3 + 2] = nor[src * 3 + 2];
    });
    const idx = [];
    const quad = (a, b, c, d) => { idx.push(a, c, b, b, c, d); };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        quad(a, a + 1, a + n + 1, a + n + 2);
      }
    }
    // Skirts: each edge strip joins the border row to its dropped copy, facing outward.
    const strip = (offset, rev) => {
      for (let i = 0; i < n; i++) {
        const a = border[offset + i], b = border[offset + i + 1];
        const da = inner + offset + i, db = inner + offset + i + 1;
        if (rev) idx.push(a, b, da, b, db, da); else idx.push(a, da, b, b, da, db);
      }
    };
    strip(0, true);              // north edge faces north
    strip(n + 1, false);         // south
    strip(2 * (n + 1), false);   // west
    strip(3 * (n + 1), true);    // east
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    return g;
  }

  _buildChunks() {
    const per = this.world.size / CHUNK;
    for (let cz = 0; cz < per; cz++) {
      for (let cx = 0; cx < per; cx++) {
        const x0 = -this.world.half + cx * CHUNK, z0 = -this.world.half + cz * CHUNK;
        const center = new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
        let lo = Infinity, hi = -Infinity;
        for (let dz = 0; dz <= CHUNK; dz += 16) for (let dx = 0; dx <= CHUNK; dx += 16) {
          const h = this.world.heightAt(x0 + dx, z0 + dz);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
        center.y = (lo + hi) / 2;
        this.chunks.push({ cx, cz, center, lod: -1, meshes: [null, null, null, null], radius: CHUNK * 0.72 + (hi - lo) / 2, x0, z0 });
      }
    }
  }

  // Far mountains beyond the playable valley: coarse flaps along each side, sampled from the natural terrain.
  _buildRing() {
    const w = this.world, R = RING, E = w.half, step = 64;
    const flaps = [
      [-R, -R, R, -E], [-R, E, R, R], [-R, -E, -E, E], [E, -E, R, E],
    ];
    const ring = new THREE.Group();
    flaps.forEach(([x0, z0, x1, z1]) => {
      const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
      const count = (nx + 1) * (nz + 1);
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
      let k = 0;
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++, k++) {
          const x = x0 + i * step, z = z0 + j * step;
          const h = w.farHeight(x, z);
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
          const dx = (w.farHeight(x - 12, z) - w.farHeight(x + 12, z)) / 24, dz = (w.farHeight(x, z - 12) - w.farHeight(x, z + 12)) / 24;
          const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
          nor[k * 3] = dx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = dz * il;
        }
      }
      const idx = [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      ring.add(mesh);
    });
    ring.name = 'far-mountains';
    this.ring = ring;
    this.group.add(ring);
  }

  // Picks each chunk's level of detail from its distance to the camera.
  update(camera) {
    const cp = camera.position;
    const s = this.lodScale;
    const limits = [230 * s, 520 * s, 1250 * s];
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cp.x, c.center.z - cp.z) - CHUNK * 0.4;
      let lod = d < limits[0] ? 0 : d < limits[1] ? 1 : d < limits[2] ? 2 : 3;
      // Hysteresis: stay on the current level until clearly past its edge.
      if (c.lod >= 0 && lod !== c.lod) {
        const edge = c.lod < lod ? limits[lod - 1] : limits[lod];
        if (Math.abs(d - edge) < 18) lod = c.lod;
      }
      if (lod !== c.lod) {
        if (c.lod >= 0 && c.meshes[c.lod]) c.meshes[c.lod].visible = false;
        if (!c.meshes[lod]) {
          const mesh = new THREE.Mesh(this._chunkGeometry(c.cx, c.cz, lod), this.material);
          mesh.receiveShadow = true;
          mesh.castShadow = this.castShadows && lod <= 1;
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
          c.meshes[lod] = mesh;
        }
        c.meshes[lod].visible = true;
        c.lod = lod;
      }
    }
    // Free the finest geometry once it is far behind us.
    for (const c of this.chunks) {
      if (c.meshes[0] && c.lod > 1) {
        const d = Math.hypot(c.center.x - cp.x, c.center.z - cp.z);
        if (d > 900) { c.meshes[0].geometry.dispose(); this.group.remove(c.meshes[0]); c.meshes[0] = null; }
      }
    }
  }

  // Turns terrain shadow casting on or off (off on the lowest quality tier).
  setShadows(on) {
    this.castShadows = on;
    for (const c of this.chunks) c.meshes.forEach((m, lod) => { if (m) m.castShadow = on && lod <= 1; });
  }
}
