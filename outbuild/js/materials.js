// Shared materials, looked up by the material names used in the Blender scripts.
//
// Props and gear carry two extra vertex attributes (converted from their colour attribute in assets.js):
//   aAO   baked ambient occlusion (1 = open)
//   aWind how much the vertex sways in the wind (0 trunk .. 1 leaf tips)
import * as THREE from 'three';

export const shared = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

const texCache = {};
let textures = null;

export function setTextures(t) { textures = t; }

function tex(name) { return textures && textures[name]; }

// ----------------------------------------------------------------------------- shader patches

function patchAO(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aAO;\nvarying float vAO;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vAO;')
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= mix(1.0, vAO, 0.9);
      reflectedLight.indirectSpecular *= mix(1.0, vAO, 0.7);
      reflectedLight.directDiffuse *= mix(1.0, vAO, 0.35);`);
}

function patchWind(sh, amount) {
  Object.assign(sh.uniforms, { uTime: shared.uTime, uWind: shared.uWind });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aWind;
      uniform float uTime;
      uniform vec2 uWind;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 base = vec3(0.0);
        #ifdef USE_INSTANCING
          base = instanceMatrix[3].xyz;
        #endif
        base += modelMatrix[3].xyz;
        float ph = base.x * 0.13 + base.z * 0.11;
        float sway = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.1 + ph * 1.7) * 0.3;
        float flutter = sin(uTime * 7.0 + position.x * 3.0 + position.y * 2.0 + ph) * 0.05;
        float w = aWind * ${amount.toFixed(3)};
        transformed.x += (uWind.x * sway + flutter) * w;
        transformed.z += (uWind.y * sway + flutter) * w;
        transformed.y -= abs(sway) * 0.1 * w;
      }`);
}

// Triplanar mapping in object space for meshes without UVs.
function patchTriplanar(sh, scale, normalStrength) {
  sh.uniforms.tTriA = { value: sh.__triA };
  sh.uniforms.tTriN = { value: sh.__triN };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vTriP;\nvarying vec3 vTriN;\nvarying vec3 vNM0;\nvarying vec3 vNM1;\nvarying vec3 vNM2;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vTriP = position;
      vTriN = normal;
      {
        mat3 nm = normalMatrix;
        #ifdef USE_INSTANCING
          nm = nm * mat3(instanceMatrix);
        #endif
        vNM0 = nm[0]; vNM1 = nm[1]; vNM2 = nm[2];
      }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vTriP;
      varying vec3 vTriN;
      varying vec3 vNM0;
      varying vec3 vNM1;
      varying vec3 vNM2;
      uniform sampler2D tTriA;
      uniform sampler2D tTriN;
      vec3 triW;`)
    .replace('#include <map_fragment>', `
      {
        vec3 p = vTriP * ${scale.toFixed(4)};
        triW = pow(abs(normalize(vTriN)), vec3(4.0));
        triW /= triW.x + triW.y + triW.z;
        vec3 c = texture2D(tTriA, p.zy).rgb * triW.x + texture2D(tTriA, p.xz).rgb * triW.y + texture2D(tTriA, p.xy).rgb * triW.z;
        diffuseColor.rgb *= c;
      }`)
    .replace('#include <normal_fragment_maps>', `
      {
        vec3 p = vTriP * ${scale.toFixed(4)};
        vec3 nx = texture2D(tTriN, p.zy).xyz * 2.0 - 1.0;
        vec3 ny = texture2D(tTriN, p.xz).xyz * 2.0 - 1.0;
        vec3 nz = texture2D(tTriN, p.xy).xyz * 2.0 - 1.0;
        vec3 on = normalize(vTriN);
        // whiteout blend of the three projections in object space
        float ns = ${normalStrength.toFixed(3)};
        vec3 tx = vec3(nx.xy * ns + on.zy, abs(nx.z) * on.x);
        vec3 ty = vec3(ny.xy * ns + on.xz, abs(ny.z) * on.y);
        vec3 tz = vec3(nz.xy * ns + on.xy, abs(nz.z) * on.z);
        vec3 wn = normalize(tx.zyx * triW.x + ty.xzy * triW.y + tz.xyz * triW.z);
        vec3 objN = normalize(mix(on, wn, 0.9));
        normal = normalize(mat3(vNM0, vNM1, vNM2) * objN);
      }`);
}

// ----------------------------------------------------------------------------- library

function make(name, opts) {
  const {
    color = '#ffffff', rough = 0.8, metal = 0, map, normal, normalScale = 1, emissive, emissiveI = 1,
    wind = 0, ao = true, triplanar = 0, triNormal = 0.6, transparent = false, opacity = 1, side,
    envI = 1, clearcoat = 0, physical = false, flat = false,
  } = opts;
  const P = physical || clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new P({ color: new THREE.Color(color), roughness: rough, metalness: metal });
  m.name = name;
  m.envMapIntensity = envI;
  if (clearcoat) { m.clearcoat = clearcoat; m.clearcoatRoughness = 0.15; }
  if (flat) m.flatShading = true;
  if (map && !triplanar) { m.map = map; }
  if (normal && !triplanar) { m.normalMap = normal; m.normalScale.set(normalScale, normalScale); }
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveI; }
  if (transparent) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
  if (side) m.side = side;
  const key = [name, wind, ao, triplanar].join('|');
  m.onBeforeCompile = (sh) => {
    if (triplanar) {
      sh.__triA = map; sh.__triN = normal;
      patchTriplanar(sh, triplanar, triNormal);
    }
    if (ao) patchAO(sh);
    if (wind) patchWind(sh, wind);
    if (m.userData.extraPatch) m.userData.extraPatch(sh);
  };
  m.customProgramCacheKey = () => key;
  m.userData.usesAO = ao;
  m.userData.usesWind = !!wind;
  return m;
}

const LIB = {};

// Material names -> factories. `ao: false` for things with no aAO attribute (build pieces).
export function buildLibrary() {
  const t = tex;
  const defs = {
    // ---- build pieces (UV mapped, box projection at 2 m per repeat)
    BuildWood: { map: t('wood'), normal: t('wood_n'), rough: 0.85 },
    BuildWoodFrame: { map: t('wood'), normal: t('wood_n'), color: '#9b7458', rough: 0.85 },
    BuildStone: { map: t('stone'), normal: t('stone_n'), rough: 0.9, normalScale: 1.2 },
    BuildStoneTrim: { map: t('stone'), normal: t('stone_n'), color: '#c9ccd2', rough: 0.9 },
    BuildMetal: { map: t('metal'), normal: t('metal_n'), rough: 0.45, metal: 0.7 },
    BuildMetalFrame: { map: t('metal'), normal: t('metal_n'), color: '#7b8390', rough: 0.4, metal: 0.8 },
    Siding: { map: t('siding'), normal: t('siding_n'), rough: 0.75 },
    Trim: { color: '#f4f1ea', rough: 0.6 },
    Brick: { map: t('brick'), normal: t('brick_n'), rough: 0.9 },
    BrickTrim: { map: t('concrete'), normal: t('concrete_n'), color: '#e6e0d4', rough: 0.85 },
    Corrugated: { map: t('corrugated'), normal: t('corrugated_n'), rough: 0.45, metal: 0.55 },
    MetalDark: { color: '#59616b', rough: 0.45, metal: 0.7 },
    Concrete: { map: t('concrete'), normal: t('concrete_n'), rough: 0.92 },
    FloorBoards: { map: t('floorboards'), normal: t('floorboards_n'), rough: 0.55 },
    Plaster: { map: t('plaster'), normal: t('plaster_n'), rough: 0.9 },
    Shingles: { map: t('shingles'), normal: t('shingles_n'), rough: 0.8 },
    Glass: { color: '#a8d8f0', rough: 0.05, metal: 0.1, transparent: true, opacity: 0.32, envI: 2 },
    WoodDark: { map: t('wood'), normal: t('wood_n'), color: '#6e4b33', rough: 0.8 },
    DoorFrame: { color: '#f4f1ea', rough: 0.6 },

    // ---- nature props (no UVs: triplanar in object space)
    Bark: { map: t('bark'), normal: t('bark_n'), triplanar: 1.3, color: '#b89a7e', rough: 0.95 },
    BarkBirch: { map: t('bark'), normal: t('bark_n'), triplanar: 1.6, color: '#f1ece2', rough: 0.9 },
    Leaves: { color: '#5d9a3a', rough: 0.75, wind: 0.35 },
    LeavesPine: { color: '#2f6b45', rough: 0.8, wind: 0.22 },
    LeavesLight: { color: '#9cc152', rough: 0.75, wind: 0.4 },
    PalmLeaf: { color: '#5aa33b', rough: 0.7, wind: 0.5, side: THREE.DoubleSide },
    Rock: { map: t('rock'), normal: t('rock_n'), triplanar: 0.2, color: '#d6d6d2', rough: 0.92, triNormal: 0.8 },
    RockMoss: { map: t('grass'), normal: t('grass_n'), triplanar: 0.3, color: '#b9d19a', rough: 0.95 },
    Hay: { map: t('bark'), normal: t('bark_n'), triplanar: 2.5, color: '#f0d27a', rough: 0.95 },
    Wood: { map: t('wood'), normal: t('wood_n'), triplanar: 0.5, rough: 0.85 },
    WoodPlain: { map: t('wood'), normal: t('wood_n'), triplanar: 0.5, rough: 0.85 },

    // ---- man-made props
    Metal: { color: '#8f98a3', rough: 0.4, metal: 0.85 },
    MetalPainted: { color: '#ffffff', rough: 0.55, metal: 0.25 },
    Rust: { map: t('metal'), normal: t('metal_n'), triplanar: 0.6, color: '#9a5a36', rough: 0.85, metal: 0.3 },
    Rubber: { color: '#26272b', rough: 0.9 },
    Chrome: { color: '#e8ecf0', rough: 0.12, metal: 1 },
    CarPaint: { color: '#ffffff', rough: 0.35, metal: 0.2, clearcoat: 1 },
    LightEmit: { color: '#fff3d6', emissive: '#ffd79a', emissiveI: 2.2, rough: 0.3 },
    RedLight: { color: '#ff4a3a', emissive: '#ff2a1a', emissiveI: 3, rough: 0.3 },
    Plastic: { color: '#d8d8d8', rough: 0.5 },
    RedPaint: { color: '#c93a2e', rough: 0.5, metal: 0.1, clearcoat: 0.4 },
    WhitePaint: { color: '#f2f2ee', rough: 0.55 },
    Cloth: { color: '#efeae0', rough: 0.9 },

    // ---- items / gear
    ChestWood: { map: t('wood'), normal: t('wood_n'), triplanar: 1.2, color: '#c79a6a', rough: 0.7 },
    ChestGold: { color: '#f2c14e', rough: 0.3, metal: 1, envI: 1.4 },
    ChestGlow: { color: '#ffe08a', emissive: '#ffc640', emissiveI: 3.5, rough: 0.3 },
    AmmoGreen: { color: '#5b6b3a', rough: 0.6, metal: 0.3 },
    CrateBlue: { color: '#3d8bff', rough: 0.5, metal: 0.2 },
    ShieldLiquid: { color: '#6fd6ff', emissive: '#2aa8ff', emissiveI: 2.2, rough: 0.1 },
    AmmoLight: { color: '#d9d2b0', rough: 0.4, metal: 0.6 },
    AmmoMedium: { color: '#6c8f4e', rough: 0.5, metal: 0.3 },
    AmmoHeavy: { color: '#3c5a78', rough: 0.5, metal: 0.4 },
    AmmoShells: { color: '#c0392b', rough: 0.5, metal: 0.2 },
    RocketTip: { color: '#e04a2a', rough: 0.4, metal: 0.3 },
    GunBody: { color: '#2b2f36', rough: 0.55, metal: 0.1 },
    GunMetal: { color: '#70757d', rough: 0.35, metal: 1 },
    GunWood: { map: t('wood'), normal: t('wood_n'), triplanar: 3, color: '#b07a4a', rough: 0.6 },
    Rarity: { color: '#a7adb3', rough: 0.45, metal: 0.3 },
    GunGlass: { color: '#ff4040', emissive: '#ff2020', emissiveI: 2.5, rough: 0.1 },
    AirshipSkin: { color: '#efe6d2', rough: 0.7 },
    AirshipStripe: { color: '#e8553d', rough: 0.6 },
    AirshipCabin: { map: t('wood'), normal: t('wood_n'), triplanar: 0.5, color: '#b58a62', rough: 0.7 },
    GliderFabric: { color: '#f2c14e', rough: 0.8, side: THREE.DoubleSide },
    GliderTrim: { color: '#2e86de', rough: 0.7, side: THREE.DoubleSide },
    GliderFrame: { color: '#c9d0d8', rough: 0.3, metal: 1 },
  };
  for (const [k, v] of Object.entries(defs)) LIB[k] = make(k, v);
  return LIB;
}

export function libMaterial(name, fallback) {
  if (LIB[name]) return LIB[name];
  // unknown name: keep the file's own material but make it use our AO attribute
  if (fallback) {
    const key = 'fb:' + name;
    if (!LIB[key]) {
      const m = fallback.clone();
      m.vertexColors = false;
      m.onBeforeCompile = (sh) => patchAO(sh);
      m.customProgramCacheKey = () => 'fbao';
      m.userData.usesAO = true;
      LIB[key] = m;
    }
    return LIB[key];
  }
  return null;
}

// A tinted copy of a library material (for per-object colours such as rarity or car paint).
const tintCache = new Map();
export function tinted(name, color, extra = {}) {
  const k = name + '|' + color + '|' + JSON.stringify(extra);
  let m = tintCache.get(k);
  if (!m) {
    const base = LIB[name];
    m = base.clone();
    m.onBeforeCompile = base.onBeforeCompile;
    m.customProgramCacheKey = base.customProgramCacheKey;
    m.color = new THREE.Color(color);
    Object.assign(m, extra);
    tintCache.set(k, m);
  }
  return m;
}

export function updateShared(time, renderer) {
  shared.uTime.value = time;
  shared.uSunDir.value.copy(renderer.sunDir);
  const w = shared.uWind.value;
  w.set(0.8 + Math.sin(time * 0.13) * 0.3, 0.35 + Math.cos(time * 0.09) * 0.2);
}
