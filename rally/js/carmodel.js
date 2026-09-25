// Car visuals: bodies are signed-distance shapes meshed with surface nets and
// painted by a shader (livery, glass, lights, panel gaps, dirt). Wheels,
// wings, mirrors and mud flaps are ordinary meshes. Model space: y up from
// the ground, z forward, x to the left, z = 0 at the centre of mass.
import * as THREE from 'three';
import { smin, smax, roundBox, ellipsoid, cylX, polygon, surfaceNets } from './sdf.js';

// ---------- Body shapes ----------

function flatten(pts) { return pts.flat(); }

const HATCH = {
  profile: flatten([
    [2.02, 0.28], [2.1, 0.4], [2.1, 0.57], [2.02, 0.69], [1.7, 0.785], [1.0, 0.955], [0.93, 0.975],
    [0.05, 1.43], [-0.25, 1.465], [-1.05, 1.445], [-1.3, 1.405], [-1.82, 1.04], [-1.95, 0.98],
    [-2.0, 0.8], [-2.03, 0.52], [-1.98, 0.28], [-1.65, 0.21], [1.72, 0.21],
  ]),
  belt: 0.975,
  halfWidth(y, z) {
    let w = 0.87;
    if (z > 1.6) w -= (z - 1.6) ** 2 * 0.85;
    if (z < -1.7) w -= (-1.7 - z) ** 2 * 1.2;
    if (y > 0.975) w -= (y - 0.975) * 0.46;
    if (y < 0.36) w -= (0.36 - y) * 0.3;
    return w;
  },
  round: 0.07,
  arches: { x: 0.8, halfX: 0.13, top: 0.5, halfY: 0.27, halfZ: 0.52, well: 0.395, blend: 0.12 },
  extra(x, y, z, d) {
    // roof scoop
    d = smin(d, ellipsoid(x, y - 1.462, z + 0.02, 0.12, 0.05, 0.2), 0.03);
    // bonnet vent bulge
    d = smin(d, ellipsoid(x, y - 0.88, z - 1.3, 0.34, 0.03, 0.3), 0.05);
    return d;
  },
};

const COUPE = {
  profile: flatten([
    [2.0, 0.3], [2.07, 0.42], [2.06, 0.65], [1.98, 0.74], [0.95, 0.8], [0.86, 0.82],
    [0.32, 1.29], [0.12, 1.335], [-0.82, 1.33], [-1.1, 1.25], [-1.42, 0.87], [-1.96, 0.85],
    [-2.05, 0.8], [-2.07, 0.6], [-2.02, 0.3], [-1.7, 0.24], [1.72, 0.24],
  ]),
  belt: 0.83,
  halfWidth(y, z) {
    let w = 0.85;
    if (z > 1.8) w -= (z - 1.8) ** 2 * 0.6;
    if (z < -1.85) w -= (-1.85 - z) ** 2 * 0.7;
    if (y > 0.84) w -= (y - 0.84) * 0.32;
    if (y < 0.38) w -= (0.38 - y) * 0.25;
    return w;
  },
  round: 0.035,
  arches: { x: 0.78, halfX: 0.11, top: 0.46, halfY: 0.23, halfZ: 0.48, well: 0.375, blend: 0.05 },
  extra(x, y, z, d) {
    // bonnet bulge
    return smin(d, roundBox(x, y - 0.8, z - 1.4, 0.3, 0.03, 0.5, 0.03), 0.04);
  },
};

const TRUCK = {
  profile: flatten([
    [2.6, 0.62], [2.68, 0.85], [2.62, 1.22], [2.42, 1.3], [1.15, 1.42], [1.05, 1.46],
    [0.45, 2.02], [0.25, 2.06], [-0.55, 2.05], [-0.72, 1.95], [-0.75, 1.42], [-2.55, 1.38],
    [-2.72, 1.3], [-2.75, 0.7], [-2.5, 0.55], [2.3, 0.55],
  ]),
  belt: 1.46,
  halfWidth(y, z) {
    let w = 0.98;
    if (z > 2.2) w -= (z - 2.2) ** 2 * 0.6;
    if (y > 1.46) w -= (y - 1.46) * 0.3;
    return w;
  },
  round: 0.06,
  arches: { x: 0.95, halfX: 0.16, top: 0.72, halfY: 0.34, halfZ: 0.7, well: 0.56, blend: 0.12 },
  extra(x, y, z, d) {
    // open bed: hollow out behind the cab
    const bed = roundBox(x, y - 1.55, z + 1.62, 0.84, 0.5, 0.88, 0.04);
    return smax(d, -bed, 0.03);
  },
};

export const BODIES = { hatch: HATCH, coupe: COUPE, truck: TRUCK };

function bodySDF(shape, spec) {
  const P = shape.profile;
  const A = shape.arches;
  const axles = [spec.frontAxle, spec.frontAxle - spec.wheelbase];
  const r = spec.wheelRadius;
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = smax(polygon(z, y, P), ax - shape.halfWidth(y, z), shape.round);
    for (const za of axles) {
      // flared arch around the wheel, then the wheel well cut out of it
      const flare = roundBox(ax - A.x, y - A.top, z - za, A.halfX, A.halfY, A.halfZ, A.halfX * 0.9);
      d = smin(d, flare, A.blend);
      const well = cylX(ax - A.x, y - r, z - za, A.well, A.halfX + 0.3);
      d = smax(d, -well, 0.025);
    }
    // keep the underside flat
    d = smax(d, -(y - 0.18), 0.02);
    return shape.extra ? shape.extra(x, y, z, d) : d;
  };
}

// Cache meshes: surface nets take a moment.
const cache = new Map();
export function bodyGeometry(spec, cell = 0.03) {
  const key = spec.id + ':' + cell;
  if (cache.has(key)) return cache.get(key);
  const shape = BODIES[spec.id];
  const sdf = bodySDF(shape, spec);
  const P = shape.profile;
  let z0 = Infinity, z1 = -Infinity, y1 = 0;
  for (let i = 0; i < P.length; i += 2) { z0 = Math.min(z0, P[i]); z1 = Math.max(z1, P[i]); y1 = Math.max(y1, P[i + 1]); }
  const snap = (v) => Math.ceil(v / cell) * cell;
  const hw = snap(shape.arches.x + shape.arches.halfX + 0.12);
  const g = surfaceNets(sdf, [-hw, 0.12, -snap(-z0 + 0.12)], [hw, y1 + 0.12, snap(z1 + 0.12)], cell, { mirror: true, relax: 2 });
  cache.set(key, g);
  return g;
}

// ---------- Body paint shader ----------

// Where the details sit on each body (model space).
const DETAILS = {
  hatch: {
    belt: 0.975, beltRise: 0.05, glassRear: -1.18, bPillar: -0.3, roofEdge: 1.4,
    head: [0.58, 0.675, 0.19, 0.055], tail: [0.64, 0.9, 0.16, 0.09], grille: [0.5, 0.37, 0.58],
    doors: [0.86, -0.28], numberBox: [-0.2, 0.58, 0.5, 0.83], hoodSeam: 0.62, cowl: 1.0,
    rear: [0.42, 0.6],
  },
  coupe: {
    belt: 0.83, beltRise: 0.0, glassRear: -0.95, bPillar: -0.2, roofEdge: 1.3,
    head: [0.58, 0.64, 0.1, 0.1], tail: [0.6, 0.72, 0.18, 0.06], grille: [0.46, 0.44, 0.66],
    doors: [0.8, -0.35], numberBox: [-0.25, 0.5, 0.42, 0.73], hoodSeam: 0.58, cowl: 0.92,
    roundLamps: 1, rear: [0.37, 0.56],
  },
  truck: {
    belt: 1.46, beltRise: 0.0, glassRear: -0.62, bPillar: -0.1, roofEdge: 2.0,
    head: [0.72, 1.12, 0.16, 0.07], tail: [0.8, 1.2, 0.08, 0.14], grille: [0.6, 0.72, 1.1],
    doors: [0.95, -0.55], numberBox: [-0.5, 0.95, 0.75, 1.35], hoodSeam: 0.7, cowl: 1.1,
    rear: [0.74, 0.86],
  },
};

const BODY_VS_PARS = /* glsl */`
varying vec3 vObj;
varying vec3 vObjN;`;
const BODY_VS = /* glsl */`
vec3 transformed = vec3( position );
vObj = position;
vObjN = normal;`;

const BODY_FS_PARS = /* glsl */`
uniform vec3 uBase, uStripe, uAccent, uNumCol;
uniform sampler2D uNumTex;
uniform sampler2D uNoiseTex;
uniform float uDirt, uWet, uLights, uBrake, uReverse, uGhost;
uniform float uBelt, uBeltRise, uGlassRear, uBPillar, uRoofEdge, uHoodSeam, uCowl, uRoundLamps;
uniform vec4 uHead, uTail, uNumBox;
uniform vec3 uGrille;
uniform vec2 uDoors, uRear;
uniform sampler2D uPlateTex;
varying vec3 vObj;
varying vec3 vObjN;
float carMetal, carRough, carClear, carEmitGlass;
vec3 carEmit;
float aa( float d ) { float w = fwidth( d ) * 0.75 + 1e-4; return smoothstep( w, -w, d ); }
float box2( vec2 p, vec2 lo, vec2 hi ) { vec2 d = max( lo - p, p - hi ); return max( d.x, d.y ); }
`;

const BODY_FS_MAP = /* glsl */`
{
  vec3 p = vObj;
  vec3 n = normalize( vObjN );
  float ax = abs( p.x );
  vec3 col = uBase;
  carMetal = 0.0; carRough = 0.32; carClear = 1.0; carEmit = vec3( 0.0 ); carEmitGlass = 0.0;

  // ----- livery: lower side band, a swoosh, roof in the accent colour, bonnet stripes
  float side = smoothstep( 0.35, 0.6, abs( n.x ) );
  float band = aa( abs( p.y - 0.42 ) - 0.055 ) * side;
  float sw = ( p.y - 0.34 ) - ( p.z + 1.4 ) * 0.2;
  float swoosh = aa( abs( sw - 0.16 ) - 0.05 ) * side * step( p.y, uBelt + 0.02 );
  col = mix( col, uStripe, max( band, swoosh ) );
  float top = smoothstep( 0.55, 0.8, n.y );
  col = mix( col, uAccent, top * step( uRoofEdge - 0.08, p.y ) );
  float bon = aa( abs( ax - 0.13 ) - 0.045 ) * top * step( uCowl - 0.05, p.z );
  col = mix( col, uStripe, bon );

  // ----- door number panel
  vec2 nb = vec2( p.z, p.y );
  float panel = aa( box2( nb, uNumBox.xy, uNumBox.zw ) ) * side;
  if ( panel > 0.0 ) {
    vec2 uv = ( nb - uNumBox.xy ) / ( uNumBox.zw - uNumBox.xy );
    if ( p.x > 0.0 ) uv.x = 1.0 - uv.x;
    float glyph = texture2D( uNumTex, uv ).a;
    col = mix( col, mix( vec3( 0.93 ), vec3( 0.05 ), glyph ), panel );
  }

  // ----- black plastics: lower bumpers, sills, the underside
  float lowBlack = aa( p.y - 0.3 ) * ( 1.0 - smoothstep( 0.5, 0.8, abs( n.x ) ) * 0.0 );
  float under = smoothstep( -0.3, -0.7, n.y );
  float plastic = max( max( lowBlack, under ), aa( p.y - 0.25 ) );
  col = mix( col, vec3( 0.035 ), plastic );
  carRough = mix( carRough, 0.7, plastic );
  carClear = mix( carClear, 0.0, plastic );

  // ----- rear: a finned diffuser under the bumper and a number plate
  float back = smoothstep( -0.35, -0.6, n.z );
  float diff = aa( p.y - uRear.x ) * back;
  if ( diff > 0.0 ) {
    float fin = aa( abs( fract( p.x * 5.0 ) - 0.5 ) - 0.05 ) * aa( p.y - uRear.x + 0.03 );
    col = mix( col, mix( vec3( 0.04 ), vec3( 0.012 ), fin ), diff );
    carRough = mix( carRough, 0.65, diff );
    carClear = mix( carClear, 0.0, diff );
  }
  float plate = aa( box2( vec2( p.x, p.y ), vec2( -0.25, uRear.y - 0.055 ), vec2( 0.25, uRear.y + 0.055 ) ) ) * back;
  if ( plate > 0.0 ) {
    vec2 uv = vec2( ( 0.25 - p.x ) / 0.5, ( p.y - uRear.y + 0.055 ) / 0.11 );
    float ink = texture2D( uPlateTex, uv ).a;
    col = mix( col, mix( vec3( 0.95, 0.94, 0.9 ), vec3( 0.03 ), ink ), plate );
    carRough = mix( carRough, 0.4, plate );
  }

  // ----- grille
  float front = smoothstep( 0.35, 0.6, n.z );
  float grille = aa( box2( vec2( ax, p.y ), vec2( 0.0, uGrille.y ), vec2( uGrille.x, uGrille.z ) ) ) * front;
  if ( grille > 0.0 ) {
    vec2 g = vec2( p.x * 28.0, p.y * 32.0 );
    g.x += step( 1.0, mod( g.y, 2.0 ) ) * 0.5;
    float mesh = smoothstep( 0.32, 0.22, length( fract( g ) - 0.5 ) );
    col = mix( col, mix( vec3( 0.12 ), vec3( 0.008 ), mesh ), grille );
    carRough = mix( carRough, 0.55, grille );
    carClear = mix( carClear, 0.0, grille );
  }

  // ----- glass: side windows, windscreen, rear window
  float belt = uBelt + max( 0.0, -p.z ) * uBeltRise;
  float above = aa( belt + 0.015 - p.y );
  float sideG = aa( 0.6 - abs( n.x ) ) * 0.0 + smoothstep( 0.52, 0.66, abs( n.x ) );
  float rearLimit = aa( uGlassRear + ( p.y - belt ) * 0.55 - p.z );
  float sideGlass = above * sideG * rearLimit * aa( p.y - uRoofEdge + 0.02 );
  float bp = aa( abs( p.z - uBPillar ) - 0.045 );
  float wind = above * smoothstep( 0.2, 0.34, n.z ) * smoothstep( 0.2, 0.3, n.y ) * aa( ax - 0.66 + ( p.y - belt ) * 0.28 );
  float rearW = above * smoothstep( -0.22, -0.36, n.z ) * aa( ax - 0.6 ) * aa( belt + 0.05 - p.y );
  float glass = max( max( sideGlass * ( 1.0 - bp ), wind ), rearW );
  float trim = max( sideGlass * bp, 0.0 );
  col = mix( col, vec3( 0.02 ), trim );
  col = mix( col, vec3( 0.012, 0.014, 0.016 ), glass );
  carRough = mix( carRough, 0.04, glass );
  carClear = mix( carClear, 0.0, glass );
  carEmitGlass = glass;

  // ----- panel gaps
  float gapW = 0.0035;
  float gaps = 0.0;
  gaps = max( gaps, aa( abs( p.z - uDoors.x ) - gapW ) * side * aa( p.y - belt ) * step( 0.3, p.y ) );
  gaps = max( gaps, aa( abs( p.z - uDoors.y ) - gapW ) * side * aa( p.y - belt ) * step( 0.3, p.y ) );
  gaps = max( gaps, aa( abs( ax - uHoodSeam ) - gapW ) * top * step( uCowl, p.z ) );
  gaps = max( gaps, aa( abs( p.z - uCowl ) - gapW ) * top * aa( ax - uHoodSeam ) );
  // door handles
  gaps = max( gaps, aa( box2( vec2( p.z, p.y ), vec2( uDoors.y + 0.12, belt - 0.12 ), vec2( uDoors.y + 0.26, belt - 0.09 ) ) ) * side * 0.8 );
  col = mix( col, col * 0.08, gaps * ( 1.0 - glass ) );

  // ----- lamps
  vec2 hl = ( vec2( ax, p.y ) - uHead.xy ) / uHead.zw;
  float head = aa( length( hl ) - 1.0 ) * smoothstep( 0.1, 0.3, n.z );
  if ( uRoundLamps > 0.5 ) {
    vec2 h2 = ( vec2( ax, p.y ) - vec2( uHead.x - 0.24, uHead.y ) ) / uHead.zw;
    head = max( head, aa( length( h2 ) - 1.0 ) * smoothstep( 0.1, 0.3, n.z ) );
  }
  float housing = aa( length( hl * vec2( 0.85, 0.7 ) ) - 1.0 ) * smoothstep( 0.1, 0.3, n.z ) * ( 1.0 - head );
  col = mix( col, vec3( 0.03 ), housing );
  if ( head > 0.0 ) {
    float ring = smoothstep( 0.5, 0.9, length( hl ) );
    col = mix( col, mix( vec3( 0.9 ), vec3( 0.55 ), ring ), head );
    carMetal = mix( carMetal, 1.0, head );
    carRough = mix( carRough, 0.08, head );
    carEmit += vec3( 1.0, 0.95, 0.85 ) * head * uLights * 18.0 * ( 1.0 - ring * 0.7 );
  }
  vec2 tl = ( vec2( ax, p.y ) - uTail.xy ) / uTail.zw;
  float tail = aa( length( tl ) - 1.0 ) * smoothstep( -0.15, -0.35, n.z );
  if ( tail > 0.0 ) {
    // deep red lens: a little glow of its own so it reads red in daylight
    float lens = smoothstep( 1.0, 0.3, length( tl ) );
    col = mix( col, mix( vec3( 0.22, 0.01, 0.01 ), vec3( 0.42, 0.02, 0.02 ), lens ), tail );
    carRough = mix( carRough, 0.22, tail );
    carClear = mix( carClear, 0.25, tail );
    carEmit += vec3( 1.0, 0.05, 0.03 ) * tail * ( 0.12 + uLights * 2.5 + uBrake * 14.0 );
    float rev = aa( length( tl + vec2( 0.55, 0.0 ) ) - 0.35 ) * tail;
    carEmit += vec3( 1.0 ) * rev * uReverse * 10.0;
    col = mix( col, vec3( 0.8 ), rev * 0.6 );
  }

  // ----- dirt: dust thrown up from the wheels, heavier low down and at the back
  if ( uDirt > 0.001 ) {
    float nz = texture2D( uNoiseTex, p.xz * 0.9 + p.y * 0.4 ).r * 0.6 + texture2D( uNoiseTex, p.zy * 3.1 ).g * 0.4;
    float low = smoothstep( 1.1, 0.25, p.y );
    float rear = smoothstep( 0.5, -1.8, p.z ) * 0.35;
    float amount = clamp( uDirt * ( low * 1.1 + rear + 0.1 ) - ( 1.0 - nz ) * 0.7, 0.0, 1.0 );
    amount *= mix( 1.0, 0.35, glass );
    vec3 dust = mix( vec3( 0.40, 0.35, 0.28 ), vec3( 0.17, 0.13, 0.09 ), uWet );
    col = mix( col, dust, amount * 0.85 );
    carRough = mix( carRough, 0.85, amount );
    carClear = mix( carClear, 0.0, amount );
    carMetal *= 1.0 - amount;
  }
  diffuseColor.rgb = col;
}`;

function numberTexture(num) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = '#fff';
  g.font = 'bold 104px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 128, 70);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function plateTexture(num) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 48);
  g.fillStyle = '#fff';
  g.font = 'bold 40px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`RDG ${String(num).padStart(3, '2')}`, 128, 30);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function bodyMaterial(spec, livery, noiseTex, patch, number = 7) {
  const D = DETAILS[spec.id];
  const u = {
    uBase: { value: new THREE.Color(livery.base) },
    uStripe: { value: new THREE.Color(livery.stripe) },
    uAccent: { value: new THREE.Color(livery.accent) },
    uNumCol: { value: new THREE.Color(livery.number) },
    uNumTex: { value: typeof document !== 'undefined' ? numberTexture(number) : null },
    uNoiseTex: { value: noiseTex },
    uDirt: { value: 0 }, uWet: { value: 0 }, uLights: { value: 0 }, uBrake: { value: 0 }, uReverse: { value: 0 }, uGhost: { value: 0 },
    uBelt: { value: D.belt }, uBeltRise: { value: D.beltRise }, uGlassRear: { value: D.glassRear }, uBPillar: { value: D.bPillar },
    uRoofEdge: { value: D.roofEdge }, uHoodSeam: { value: D.hoodSeam }, uCowl: { value: D.cowl }, uRoundLamps: { value: D.roundLamps || 0 },
    uHead: { value: new THREE.Vector4(...D.head) }, uTail: { value: new THREE.Vector4(...D.tail) },
    uNumBox: { value: new THREE.Vector4(...D.numberBox) }, uGrille: { value: new THREE.Vector3(...D.grille) },
    uDoors: { value: new THREE.Vector2(...D.doors) },
    uRear: { value: new THREE.Vector2(...D.rear) },
    uPlateTex: { value: typeof document !== 'undefined' ? plateTexture(number) : null },
  };
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
  patch(m, {
    uniforms: u,
    vertexPars: BODY_VS_PARS,
    vertex: { '#include <begin_vertex>': BODY_VS },
    fragmentPars: BODY_FS_PARS,
    fragment: {
      '#include <map_fragment>': BODY_FS_MAP,
      '#include <roughnessmap_fragment>': 'float roughnessFactor = carRough;',
      '#include <metalnessmap_fragment>': 'float metalnessFactor = carMetal;',
      '#include <lights_physical_fragment>': '$&\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= carClear;\n#endif',
      '#include <emissivemap_fragment>': '$&\ntotalEmissiveRadiance += carEmit;',
    },
  });
  m.userData.u = u;
  return m;
}

// ---------- Wheels ----------

function tireGeometry(r, w) {
  const pts = [];
  const rim = r * 0.6;
  const prof = [
    [rim, -w * 0.46], [r * 0.78, -w * 0.5], [r * 0.93, -w * 0.5], [r * 0.985, -w * 0.46], [r, -w * 0.36],
    [r, w * 0.36], [r * 0.985, w * 0.46], [r * 0.93, w * 0.5], [r * 0.78, w * 0.5], [rim, w * 0.46],
  ];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(Math.PI / 2);    // axle along x
  return g;
}

function rimGeometry(r, w, spokes = 6) {
  const R = r * 0.58;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  for (let i = 0; i < spokes; i++) {
    const a0 = (i / spokes) * Math.PI * 2 + 0.2, a1 = a0 + (Math.PI * 2 / spokes) - 0.4;
    const hole = new THREE.Path();
    hole.absarc(0, 0, R * 0.82, a0, a1, false);
    hole.absarc(0, 0, R * 0.36, a1 - 0.08, a0 + 0.08, true);
    hole.closePath();
    shape.holes.push(hole);
  }
  const face = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 12 });
  face.rotateY(Math.PI / 2);
  face.translate(w * 0.28, 0, 0);
  const barrel = new THREE.CylinderGeometry(R, R, w * 0.9, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(R * 0.22, R * 0.26, 0.05, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(w * 0.3, 0, 0);
  return [face, barrel, hub];
}

function treadTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 64);
  // chunky gravel tread blocks, staggered
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 3; j++) {
      const x = i * 16 + (j % 2) * 8, y = 6 + j * 19;
      g.fillStyle = '#e0e0e0';
      g.fillRect(x + 1, y, 11, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

// ---------- Cockpit ----------

// Where the inside of each body is (model space, metres). eye: driver's eyes
// (left-hand drive, so x > 0); dash: rear edge, front edge and top of the
// dashboard; ws: windscreen base and top (z, y); roof height, cabin half-width,
// B-pillar and how far back the roof lining goes.
const COCKPITS = {
  hatch: { eye: [0.37, 1.13, -0.36], dash: [0.3, 0.9, 0.955], ws: [0.93, 0.975, 0.08, 1.42], roof: 1.405, halfW: 0.75, bPillar: -0.3, rear: -1.45 },
  coupe: { eye: [0.36, 1.05, -0.3], dash: [0.3, 0.84, 0.81], ws: [0.86, 0.82, 0.2, 1.31], roof: 1.295, halfW: 0.72, bPillar: -0.2, rear: -1.0 },
  truck: { eye: [0.42, 1.8, -0.2], dash: [0.45, 1.02, 1.44], ws: [1.05, 1.46, 0.4, 2.02], roof: 2.0, halfW: 0.86, bPillar: -0.1, rear: -0.7 },
};

// Rev counter face: dark dial, white ticks, red line from 7000.
function dialTexture(maxK, redK) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#08090a';
  g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  for (let k = 0; k <= maxK * 2; k++) {
    const a = a0 + (a1 - a0) * (k / (maxK * 2)), major = k % 2 === 0;
    g.strokeStyle = k / 2 >= redK ? '#ff3b30' : '#e8e8e8';
    g.lineWidth = major ? 3 : 1.5;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * (major ? 44 : 50), 64 + Math.sin(a) * (major ? 44 : 50));
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g.stroke();
    if (major) {
      g.fillStyle = '#e8e8e8';
      g.font = 'bold 13px Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(k / 2), 64 + Math.cos(a) * 33, 64 + Math.sin(a) * 33);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Mud flap artwork: accent colour, a white sponsor block and a black foot.
function flapTexture(livery) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = livery.accent;
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#121214';
  g.fillRect(0, 104, 64, 24);
  // the top of the flap hides behind the bumper, so the logo sits low
  g.fillStyle = '#f4f4f2';
  g.fillRect(6, 62, 52, 30);
  g.fillStyle = '#121214';
  g.font = 'bold italic 21px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('RIDGE', 32, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- The whole car ----------

export class CarVisual {
  constructor(spec, livery, { noiseTex, patch, number = 7, ghost = false, lowDetail = false } = {}) {
    this.spec = spec;
    this.patch = patch;
    this.livery = livery;
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // everything that moves with the chassis
    this.body.position.y = -spec.cgHeight;  // model space has the ground at y = 0
    this.root.add(this.body);

    const geo = bodyGeometry(spec, lowDetail ? 0.045 : 0.03);
    this.paint = bodyMaterial(spec, livery, noiseTex, patch, number);
    const shell = new THREE.Mesh(geo, this.paint);
    shell.castShadow = !ghost;
    shell.receiveShadow = true;
    this.body.add(shell);
    this.shell = shell;

    const black = patch(new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.6, metalness: 0.2 }), {});
    const accent = patch(new THREE.MeshPhysicalMaterial({ color: livery.accent, roughness: 0.35, clearcoat: 0.8 }), {});
    this.metal = patch(new THREE.MeshStandardMaterial({ color: '#8a8a8a', metalness: 0.95, roughness: 0.3, side: THREE.DoubleSide }), {});
    this.chrome = patch(new THREE.MeshStandardMaterial({ color: '#dfe3e8', metalness: 1, roughness: 0.15 }), {});
    this._addExtras(spec, black, accent);
    if (!ghost) this._interior(spec, livery);

    // wheels
    const r = spec.wheelRadius, w = spec.wheelWidth;
    const tread = typeof document !== 'undefined' ? treadTexture() : null;
    const tireMat = patch(new THREE.MeshStandardMaterial({ color: '#1b1b1c', roughness: 0.92, bumpMap: tread, bumpScale: 2.5 }), {});
    const rimMat = patch(new THREE.MeshStandardMaterial({ color: livery.rim || (spec.id === 'coupe' ? '#c9a23b' : '#e8e8e8'), roughness: 0.35, metalness: 0.6 }), {});
    const discMat = patch(new THREE.MeshStandardMaterial({ color: '#555', roughness: 0.45, metalness: 0.9 }), {});
    const calMat = patch(new THREE.MeshStandardMaterial({ color: '#d32f2f', roughness: 0.4, metalness: 0.2 }), {});
    const tire = tireGeometry(r, w);
    const [face, barrel, hub] = rimGeometry(r, w, spec.id === 'truck' ? 8 : 6);
    const disc = new THREE.CylinderGeometry(r * 0.46, r * 0.46, 0.025, 28);
    disc.rotateZ(Math.PI / 2);
    const cal = new THREE.BoxGeometry(0.06, r * 0.28, r * 0.3);
    this.wheels = [];
    const hx = spec.track / 2;
    const axles = [spec.frontAxle, spec.frontAxle - spec.wheelbase];
    for (let i = 0; i < 4; i++) {
      const left = i % 2 === 0;
      const pivot = new THREE.Group();
      pivot.position.set(left ? hx : -hx, r - spec.cgHeight, axles[i >> 1]);
      const spin = new THREE.Group();
      const outward = new THREE.Group();
      if (!left) outward.rotation.y = Math.PI;       // rim faces outward on both sides
      const tm = new THREE.Mesh(tire, tireMat);
      tm.castShadow = !ghost;
      const fm = new THREE.Mesh(face, rimMat);
      const bm = new THREE.Mesh(barrel, rimMat);
      const hm = new THREE.Mesh(hub, rimMat);
      outward.add(tm, fm, bm, hm);
      spin.add(outward);
      const dm = new THREE.Mesh(disc, discMat);
      dm.position.x = (left ? 1 : -1) * 0.02;
      spin.add(dm);
      const cm = new THREE.Mesh(cal, calMat);
      cm.position.set((left ? 1 : -1) * 0.02, r * 0.28, r * 0.12);
      pivot.add(spin, cm);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, rest: pivot.position.y });
    }
    if (ghost) this.makeGhost();
  }

  _addExtras(spec, black, accent) {
    const b = this.body;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      b.add(m);
      return m;
    };
    if (spec.id === 'hatch') {
      // roof wing with end plates
      const foil = new THREE.Shape();
      foil.moveTo(0, 0); foil.quadraticCurveTo(0.18, 0.07, 0.42, 0.02); foil.lineTo(0.42, 0.005); foil.quadraticCurveTo(0.2, 0.02, 0, -0.015); foil.closePath();
      const wingGeo = new THREE.ExtrudeGeometry(foil, { depth: 1.34, bevelEnabled: false });
      wingGeo.translate(0, 0, -0.67);
      wingGeo.rotateY(Math.PI / 2);
      add(wingGeo, accent, 0, 1.5, -1.36, 0, 0, 0).rotation.x = 0;
      const plate = new THREE.BoxGeometry(0.012, 0.16, 0.46);
      add(plate, accent, 0.67, 1.49, -1.52);
      add(plate, accent, -0.67, 1.49, -1.52);
      const stand = new THREE.BoxGeometry(0.02, 0.12, 0.16);
      add(stand, black, 0.35, 1.44, -1.42);
      add(stand, black, -0.35, 1.44, -1.42);
      // front splitter
      add(new THREE.BoxGeometry(1.52, 0.025, 0.12), black, 0, 0.27, 2.02);
      // mirrors: a housing on a short stalk at the base of the A-pillar
      const mir = new THREE.SphereGeometry(0.08, 14, 10);
      mir.scale(0.55, 0.62, 1.0);
      for (const sx of [-1, 1]) {
        add(mir, accent, sx * 0.93, 1.03, 0.78);
        add(new THREE.BoxGeometry(0.1, 0.025, 0.05), black, sx * 0.87, 1.0, 0.8);
      }
      // exhaust
      const ex = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 14, 1, true);
      ex.rotateX(Math.PI / 2);
      this.exhaust = add(ex, this.metal, -0.55, 0.3, -2.02);
      // mud flaps
      this._mudFlaps(0.8, [spec.frontAxle - 0.46, spec.frontAxle - spec.wheelbase - 0.46], 0.06, 0.42, 0.34);
      // antenna
      add(new THREE.CylinderGeometry(0.004, 0.006, 0.5, 5), black, 0.2, 1.7, -0.7, -0.25);
    } else if (spec.id === 'coupe') {
      // chrome bumpers and a small ducktail
      const chrome = this.chrome;
      add(new THREE.BoxGeometry(1.64, 0.1, 0.1), chrome, 0, 0.42, 2.07);
      add(new THREE.BoxGeometry(1.6, 0.1, 0.1), chrome, 0, 0.44, -2.07);
      add(new THREE.BoxGeometry(1.35, 0.03, 0.2), accent, 0, 0.9, -1.85, -0.2);
      const mir = new THREE.SphereGeometry(0.08, 12, 8);
      add(mir, chrome, 0.88, 0.9, 0.62);
      add(mir, chrome, -0.88, 0.9, 0.62);
      // roof light pod with four lamps
      this._mudFlaps(0.76, [spec.frontAxle - 0.44, spec.frontAxle - spec.wheelbase - 0.44], 0.07, 0.4, 0.3);
      const ex = new THREE.CylinderGeometry(0.045, 0.045, 0.2, 14, 1, true);
      ex.rotateX(Math.PI / 2);
      this.exhaust = add(ex, this.metal, -0.5, 0.3, -2.08);
    } else {
      // trophy truck: roll cage in the bed, spare tyre, light bar
      const tube = (x0, y0, z0, x1, y1, z1, rad = 0.035) => {
        const a = new THREE.Vector3(x0, y0, z0), c = new THREE.Vector3(x1, y1, z1);
        const len = a.distanceTo(c);
        const g = new THREE.CylinderGeometry(rad, rad, len, 8);
        const m = add(g, black, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      };
      for (const s of [-1, 1]) {
        tube(s * 0.8, 1.38, -0.8, s * 0.7, 2.0, -0.75);
        tube(s * 0.7, 2.0, -0.75, s * 0.75, 1.4, -2.5);
        tube(s * 0.55, 2.06, 0.3, s * 0.7, 2.0, -0.75);
      }
      tube(-0.7, 2.0, -0.75, 0.7, 2.0, -0.75);
      tube(-0.6, 1.9, -1.7, 0.6, 1.9, -1.7);
      const spare = new THREE.Mesh(tireGeometry(0.44, 0.3), black);
      spare.rotation.z = Math.PI / 2;
      spare.position.set(0, 1.62, -1.55);
      b.add(spare);
      const bar = new THREE.BoxGeometry(1.2, 0.08, 0.1);
      add(bar, black, 0, 2.12, 0.28);
      this.lightBar = add(new THREE.BoxGeometry(1.1, 0.05, 0.02), this.patch(new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#000' }), {}), 0, 2.12, 0.34);
      add(new THREE.BoxGeometry(1.9, 0.12, 0.2), black, 0, 0.62, 2.62);
      const ex = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 14, 1, true);
      ex.rotateX(Math.PI / 2);
      this.exhaust = add(ex, this.metal, 0.6, 0.62, -2.72);
    }
  }

  // The cabin, seen only from the cockpit camera: dashboard with a rev counter
  // and shift lights, a steering wheel that turns, pillars, roof lining and a
  // roll cage. The body shell is invisible from inside, so these frame the view.
  _interior(spec, livery) {
    const C = COCKPITS[spec.id];
    if (!C) return;
    const P = this.patch;
    const plastic = P(new THREE.MeshStandardMaterial({ color: '#1e2024', roughness: 0.8 }), {});
    const fabric = P(new THREE.MeshStandardMaterial({ color: '#2b2c2f', roughness: 0.95, side: THREE.DoubleSide }), {});
    const cage = P(new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.35, metalness: 0.7 }), {});
    const tape = P(new THREE.MeshStandardMaterial({ color: livery.accent === '#1b1b1f' || livery.accent === '#15171e' ? '#ffc629' : livery.accent, roughness: 0.6 }), {});
    const cab = (this.interior = new THREE.Group());
    cab.visible = false;
    this.body.add(cab);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); cab.add(m); return m; };
    const bar = (a, b, mat, r) => {
      const len = a.distanceTo(b);
      const m = add(r ? new THREE.CylinderGeometry(r, r, len, 10) : new THREE.BoxGeometry(0.075, len, 0.055), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      return m;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const [ex, ey, ez] = C.eye, [d0, d1, top] = C.dash, [wz0, wy0, wz1, wy1] = C.ws, W = C.halfW;
    const floorY = spec.wheelRadius + 0.02;
    this.eye = V(ex, ey - spec.cgHeight, ez);

    // dashboard, the hood over the instruments, door cards, and the floor
    // and bulkhead below (the shell is invisible from inside, so they close
    // the cabin off from the road)
    add(new THREE.BoxGeometry(W * 2, 0.18, d1 - d0), plastic, 0, top - 0.09, (d0 + d1) / 2);
    add(new THREE.BoxGeometry(W * 2, top - 0.18 - floorY, 0.04), plastic, 0, (top - 0.18 + floorY) / 2, d0 + 0.35);
    add(new THREE.BoxGeometry(W * 2.1, 0.04, d1 - C.rear), fabric, 0, floorY, (d1 + C.rear) / 2);
    add(new THREE.BoxGeometry(0.44, 0.08, 0.2), plastic, ex, top + 0.035, d0 + 0.1);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, top - floorY, d1 - C.rear * 0.6), fabric, s * W, (top + floorY) / 2, (d1 + C.rear * 0.6) / 2);

    // rev counter with a needle, and a row of shift lights above it
    const face = dialTexture(Math.ceil(spec.engine.limiter / 1000), Math.floor(spec.engine.redline / 1000));
    const dial = add(new THREE.CircleGeometry(0.06, 32), P(new THREE.MeshStandardMaterial({ map: face, emissiveMap: face, roughness: 0.5, emissive: '#ffe2b8', emissiveIntensity: 0 }), {}), ex, top + 0.02, d0 - 0.003);
    dial.rotation.y = Math.PI;
    this.dialMat = dial.material;
    const needle = new THREE.Group();
    needle.position.set(ex, top + 0.02, d0 - 0.006);
    const nm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.002), P(new THREE.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff6a1a', emissiveIntensity: 0.6 }), {}));
    nm.position.y = 0.022;
    needle.add(nm);
    cab.add(needle);
    this.needle = needle;
    this.shiftLights = [];
    const lc = ['#35e05a', '#35e05a', '#35e05a', '#ffd21f', '#ffd21f', '#ff3b30', '#ff3b30'];
    lc.forEach((col, k) => {
      const m = add(new THREE.BoxGeometry(0.018, 0.012, 0.006), new THREE.MeshStandardMaterial({ color: '#111', emissive: col, emissiveIntensity: 0 }), ex + (k - 3) * 0.024, top + 0.085, d0 + 0.02);
      this.shiftLights.push(m.material);
    });

    // steering wheel: rim, three spokes, hub and the straight-ahead marker
    const pivot = new THREE.Group();
    pivot.position.set(ex, ey - 0.3, ez + 0.44);
    pivot.rotation.x = 0.33;
    const wheel = new THREE.Group();
    const suede = P(new THREE.MeshStandardMaterial({ color: '#26272b', roughness: 0.75 }), {});
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.021, 10, 44), suede));
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.012), plastic);
      sp.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0);
      sp.rotation.z = a;
      wheel.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 16), plastic);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.046, 0.046), tape);
    mark.position.y = 0.175;
    wheel.add(mark);
    pivot.add(wheel);
    cab.add(pivot);
    this.steeringWheel = wheel;
    bar(V(ex, ey - 0.3, ez + 0.44), V(ex, top - 0.2, d0 + 0.3), plastic, 0.028);   // column, down into the dash

    // pillars, windscreen header, roof lining, B-pillars
    for (const s of [-1, 1]) {
      bar(V(s * W * 0.97, wy0 - 0.02, wz0 - 0.03), V(s * W * 0.86, wy1 - 0.03, wz1 + 0.03), plastic);
      bar(V(s * W, top - 0.05, C.bPillar), V(s * W * 0.9, C.roof - 0.03, C.bPillar), plastic);
    }
    bar(V(-W * 0.9, wy1 - 0.04, wz1), V(W * 0.9, wy1 - 0.04, wz1), plastic);
    const liner = add(new THREE.PlaneGeometry(W * 1.85, wz1 - C.rear), fabric, 0, C.roof - 0.035, (wz1 + C.rear) / 2);
    liner.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.19, 0.05, 0.02), plastic, 0, wy1 - 0.11, wz1 + 0.05);   // mirror

    // roll cage: tubes along the pillars, over the roof, a main hoop behind
    // the seats with a diagonal, and door bars
    const r = 0.021, hz = ez - 0.45;
    for (const s of [-1, 1]) {
      const x = s * W * 0.8;
      bar(V(s * W * 0.9, top - 0.25, wz0 - 0.08), V(x, C.roof - 0.07, wz1 + 0.02), cage, r);
      bar(V(x, C.roof - 0.07, wz1 + 0.02), V(x, C.roof - 0.07, hz), cage, r);
      bar(V(s * W * 0.9, 0.4, hz), V(x, C.roof - 0.07, hz), cage, r);
      bar(V(s * W * 0.93, 0.45, d0), V(s * W * 0.93, top - 0.12, hz + 0.1), cage, r);
      bar(V(s * W * 0.93, top - 0.12, d0), V(s * W * 0.93, 0.45, hz + 0.1), cage, r);
    }
    bar(V(-W * 0.8, C.roof - 0.07, wz1 + 0.02), V(W * 0.8, C.roof - 0.07, wz1 + 0.02), cage, r);
    bar(V(-W * 0.8, C.roof - 0.07, hz), V(W * 0.8, C.roof - 0.07, hz), cage, r);
    bar(V(W * 0.85, C.roof - 0.1, hz), V(-W * 0.88, 0.45, hz), cage, r);

    // the co-driver's seat back, over on the right
    add(new THREE.BoxGeometry(0.46, 0.62, 0.1), fabric, -ex, top - 0.18, ez - 0.12);
    // light through the windows: the dash, wheel and cage catch the sun; the
    // lining and door cards sit under the roof's shadow
    cab.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = o.material === fabric; } });
  }

  // Needle, shift lights, steering wheel and gauge lights for the cockpit view.
  syncInterior(vehicle, lights) {
    if (!this.interior || !this.interior.visible) return;
    const E = this.spec.engine;
    const f = Math.min(1, vehicle.rpm / (Math.ceil(E.limiter / 1000) * 1000));
    this.needle.rotation.z = Math.PI * (1.5 * f - 0.75);
    const on = (vehicle.rpm - E.redline * 0.72) / (E.limiter - E.redline * 0.72);
    this.shiftLights.forEach((m, k) => { m.emissiveIntensity = on * 7 > k ? (on > 0.97 && Math.floor(performance.now() / 70) % 2 ? 0.2 : 3) : 0; });
    this.steeringWheel.rotation.z = -vehicle.steerAngle * 9;
    this.dialMat.emissiveIntensity = lights ? 1.6 : 0;
  }

  // Rally mud flaps in the livery's accent colour, hanging almost to the ground.
  _mudFlaps(x, zs, bottom, height, width) {
    this.flaps = [];
    const mat = this.patch(new THREE.MeshStandardMaterial({ map: flapTexture(this.livery), roughness: 0.75 }), {});
    for (const z of zs) {
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * x, bottom + height, z);
        const flap = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.012), mat);
        flap.position.y = -height / 2;
        flap.castShadow = true;
        pivot.add(flap);
        this.body.add(pivot);
        this.flaps.push(pivot);
      }
    }
  }

  makeGhost() {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.22, depthWrite: false });
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  // Place the car from the physics state.
  sync(vehicle, dt = 0) {
    this.root.position.copy(vehicle.pos);
    this.root.quaternion.copy(vehicle.quat);
    const S = this.spec;
    vehicle.wheels.forEach((w, i) => {
      const v = this.wheels[i];
      // wheel centre sits springLen below its hardpoint
      v.pivot.position.y = w.hp.y - w.springLen;
      v.pivot.rotation.y = w.steer;
      v.spin.rotation.x = w.spin;
    });
    if (this.flaps) {
      const sp = vehicle.forwardSpeed;
      // stiff rubber: the air pushes the bottom edge back a little at speed
      for (const f of this.flaps) f.rotation.x = THREE.MathUtils.lerp(f.rotation.x, Math.min(0.45, Math.abs(sp) * 0.012), Math.min(1, dt * 6));
    }
    const u = this.paint.userData.u;
    u.uBrake.value = vehicle.brake > 0.05 ? 1 : 0;
    u.uReverse.value = vehicle.gear < 0 ? 1 : 0;
  }
}
