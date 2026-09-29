// The e-bikes' 3D models, built in code: an aluminium frame around the battery
// pack, the motor and chain drive, a fork that steers and compresses, a
// swingarm that follows the rear wheel, spoked wheels with knobbly tyres, disc
// brakes, lights, plastics in each bike's colours that gather dust, and the rider.
import * as THREE from 'three';
import { canvasTexture } from '../render/textures.js';
import { useTerrainLight } from '../render/shaderpatch.js';
import { mergeGeometries } from '../render/geomutil.js';
import { Rider } from './rider.js';
import { TRICKS } from './tricks.js';

// Colours and style for each bike (keyed by the physics spec's id).
export const LOOKS = {
  volt: {
    style: 'bee', plastic: '#1f2124', accent: '#86ff3c', frame: '#2c2f33', frameMetal: 0.75, battery: '#17181a',
    fork: '#141416', stanchion: '#d7b15f', spring: '#86ff3c', rim: '#151515', seat: '#26272a', logo: 'VOLT', number: '38',
    jersey: '#202226', jersey2: '#86ff3c', pants: '#2b2d31', boots: '#ededeb', gloves: '#1a1a1c', helmet: '#f1f1ef', helmet2: '#86ff3c',
  },
  sting: {
    style: 'bee', plastic: '#ffc316', accent: '#141414', frame: '#1b1b1c', frameMetal: 0.6, battery: '#141414',
    fork: '#101012', stanchion: '#e4e4e4', spring: '#ff4f1a', rim: '#d9a322', seat: '#161616', logo: 'STING', number: '21',
    jersey: '#ffc316', jersey2: '#141414', pants: '#171717', boots: '#151515', gloves: '#ffc316', helmet: '#141414', helmet2: '#ffc316',
  },
  storm: {
    style: 'mx', plastic: '#f3f3f1', accent: '#1d58d6', frame: '#1d58d6', frameMetal: 0.5, battery: '#18191c',
    fork: '#1d58d6', stanchion: '#d7b15f', spring: '#1d58d6', rim: '#18191c', seat: '#1b1d22', logo: 'STORM', number: '7',
    jersey: '#1d58d6', jersey2: '#f3f3f1', pants: '#f3f3f1', boots: '#f3f3f1', gloves: '#1d58d6', helmet: '#f3f3f1', helmet2: '#1d58d6',
  },
};

const Yv = new THREE.Vector3(0, 1, 0);

// Dust that collects low on the bike. uDirt 0..1 rises as you ride.
function addDirt(material, shared) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.uniforms.uDirt = shared.uDirt;
    shader.uniforms.uBodyInv = shared.uBodyInv;
    shader.uniforms.tDirtNoise = shared.tNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uBodyInv;\nvarying vec3 vBodyPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyPos = (uBodyInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDirt;\nuniform sampler2D tDirtNoise;\nvarying vec3 vBodyPos;\nfloat dirtAmt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 dn = texture2D(tDirtNoise, vBodyPos.xz * 0.9 + vBodyPos.y * 0.5);
          float h = vBodyPos.y + (dn.r - 0.5) * 0.3 + (dn.b - 0.5) * 0.1;
          dirtAmt = clamp(uDirt * 1.3 - smoothstep(0.1, 1.1, h), 0.0, 1.0) * (0.55 + 0.45 * dn.g);
          dirtAmt = max(dirtAmt, uDirt * 0.15 * dn.a);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.29, 0.19), dirtAmt);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, dirtAmt);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, dirtAmt);');
  };
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + '|dirt';
  return material;
}

// A cylinder stretched between two points each frame (shock absorber parts).
class Strut {
  constructor(material, radius, segments = 10) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, segments, 1), material);
    this.mesh.castShadow = true;
  }
  set(a, b) {
    const m = this.mesh;
    m.position.addVectors(a, b).multiplyScalar(0.5);
    const d = Strut._d.subVectors(b, a);
    const len = d.length();
    m.scale.set(1, Math.max(1e-3, len), 1);
    m.quaternion.setFromUnitVectors(Yv, d.multiplyScalar(1 / (len || 1)));
  }
}
Strut._d = new THREE.Vector3();

function helixGeometry(radius, turns, tube) {
  const pts = [];
  const n = turns * 20;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t - 0.5, Math.sin(a) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tube, 6, false);
}

// Tube along a polyline of [z, y] points at a given x.
function tubePath(points, x, r, segs = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map(([z, y]) => new THREE.Vector3(x, y, z)), false, 'catmullrom', 0.2);
  return new THREE.TubeGeometry(curve, segs, r, 8, false);
}

// A flat side profile (shape in z/y) extruded across x, centred on x0, with side-on UVs.
function slab(shape, width, x0 = 0, bevel = 0.008) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate(x0 + (width - 2 * bevel) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function shapeFrom(points) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  return s;
}

// Planar side UVs over the given z/y box (for the livery canvas).
function sideUVs(g, z0, z1, y0, y1) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getZ(i) - z0) / (z1 - z0), v = (p.getY(i) - y0) / (y1 - y0);
    uv.setXY(i, p.getX(i) < 0 ? u : 1 - u, v);
  }
  uv.needsUpdate = true;
  return g;
}

function panelTexture(look) {
  return canvasTexture(1024, 512, (g, W, H) => {
    g.fillStyle = look.plastic;
    g.fillRect(0, 0, W, H);
    // Two sweeping accent flashes.
    g.fillStyle = look.accent;
    g.beginPath();
    g.moveTo(0, H * 0.62);
    g.lineTo(W, H * 0.38);
    g.lineTo(W, H * 0.5);
    g.lineTo(0, H * 0.78);
    g.closePath();
    g.fill();
    g.globalAlpha = 0.55;
    g.beginPath();
    g.moveTo(0, H * 0.84);
    g.lineTo(W, H * 0.58);
    g.lineTo(W, H * 0.62);
    g.lineTo(0, H * 0.89);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = look.style === 'mx' ? look.accent : '#ffffff';
    if (look.plastic.toLowerCase() === '#ffc316') g.fillStyle = '#141414';
    g.font = 'italic 900 118px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(look.logo, W * 0.36, H * 0.34);
  });
}

function plateTexture(look) {
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = look.style === 'mx' ? '#f7f7f5' : look.plastic;
    g.fillRect(0, 0, W, H);
    g.fillStyle = look.style === 'mx' ? '#141414' : look.accent;
    g.font = 'italic 900 160px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(look.number, W / 2, H / 2 + 8);
  });
}

function sidewallTexture() {
  return canvasTexture(1024, 64, (g, W, H) => {
    g.fillStyle = '#151515';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#5c5c5c';
    g.font = 'bold 22px Arial, sans-serif';
    g.textBaseline = 'middle';
    for (let i = 0; i < 2; i++) g.fillText('SANDGRIP  MX  KNOBBY  TUBE TYPE', (i / 2) * W + 30, H / 2);
  }, { repeat: true });
}

export class BikeModel {
  constructor(tex, spec, look) {
    this.root = new THREE.Group();
    this.leanPivot = new THREE.Group();
    this.root.add(this.leanPivot);
    this.shared = { uDirt: { value: 0.05 }, uBodyInv: { value: new THREE.Matrix4() }, tNoise: { value: tex.noise } };
    this._v = Array.from({ length: 10 }, () => new THREE.Vector3());
    this._q = new THREE.Quaternion();
    this._tv = new THREE.Vector3();
    this._footQ = new THREE.Quaternion();
    // Boot angles for tricks: toes pointed back (Superman), toes up (heel clicker).
    this._trickFeet = {
      superman: new THREE.Quaternion().setFromEuler(new THREE.Euler(2.6, 0, 0)),
      heelclicker: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, 0)),
    };
    this.build(spec, look);
  }

  prep(m, dirt = true) {
    if (dirt) addDirt(m, this.shared);
    useTerrainLight(m);
    return m;
  }

  // (Re)build for a bike; used by the garage to switch.
  build(spec, look) {
    if (this.model) {
      this.leanPivot.remove(this.model);
      this.model.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.spec = spec;
    this.look = look;
    const P = (m, dirt) => this.prep(m, dirt);
    const std = (color, rough, metal = 0, extra = {}) => P(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
    this.mat = {
      panel: P(new THREE.MeshPhysicalMaterial({ map: panelTexture(look), roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 })),
      plastic: P(new THREE.MeshPhysicalMaterial({ color: look.plastic, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 })),
      accent: P(new THREE.MeshPhysicalMaterial({ color: look.accent, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 })),
      plate: P(new THREE.MeshStandardMaterial({ map: plateTexture(look), roughness: 0.5 })),
      black: std(0x161618, 0.55, 0.1),
      frame: std(look.frame, 0.35, look.frameMetal),
      battery: std(look.battery, 0.6, 0.2),
      alu: std(0xc6c9ce, 0.3, 1),
      steel: std(0x9a9ea5, 0.35, 1),
      fork: std(look.fork, 0.35, 0.6),
      stanchion: P(new THREE.MeshStandardMaterial({ color: look.stanchion, roughness: 0.18, metalness: 1 }), false),
      spring: P(new THREE.MeshStandardMaterial({ color: look.spring, roughness: 0.35, metalness: 0.3 }), false),
      rim: std(look.rim, 0.3, 0.9),
      seat: std(look.seat, 0.85, 0),
      rubber: P(new THREE.MeshStandardMaterial({ map: sidewallTexture(), roughness: 0.92 })),
      tread: std(0x131313, 0.95, 0),
      chain: std(0x2e2c2a, 0.45, 0.8),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dd, emissiveIntensity: 5, roughness: 0.2 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a0a, emissiveIntensity: 3, roughness: 0.3 }),
      caliper: P(new THREE.MeshStandardMaterial({ color: look.style === 'mx' ? 0xd7a23a : 0xc81d1d, roughness: 0.35, metalness: 0.5 }), false),
    };
    useTerrainLight(this.mat.lamp);
    useTerrainLight(this.mat.tail);

    const S = spec;
    const mx = look.style === 'mx';
    const R = S.radius;
    const zf = -(S.wheelbase - S.cgBack), zr = S.cgBack;
    const k = S.wheelbase / 1.26;                 // everything scales a little with the bike
    // Key points in model space (ground at y = 0, forward is -z).
    const seatY = mx ? 0.96 : 0.86 * Math.min(1.05, k);
    const D = (this.dims = {
      R, zf, zr, k, seatY,
      rake: 0.44,
      offset: 0.035,
      pivot: new THREE.Vector3(0, mx ? 0.5 : 0.44, 0.12 * k),
      peg: new THREE.Vector3(0.19, mx ? 0.4 : 0.36, 0.14 * k),
      shockTop: new THREE.Vector3(0, mx ? 0.86 : 0.78, 0.2 * k),
    });
    // Steering axis: through a point just behind the front axle, raked back.
    D.axisDir = new THREE.Vector3(0, Math.cos(D.rake), Math.sin(D.rake));
    D.axisBase = new THREE.Vector3(0, R, zf + D.offset / Math.cos(D.rake));
    const onAxis = (t) => D.axisBase.clone().addScaledVector(D.axisDir, t);
    D.forkLen = mx ? 0.86 : 0.76;               // axle to top clamp
    D.headTop = onAxis(D.forkLen);
    D.headBot = onAxis(D.forkLen - (mx ? 0.2 : 0.17));
    const barT = D.forkLen + 0.06;
    D.bar = onAxis(barT);

    const model = (this.model = new THREE.Group());
    this.leanPivot.add(model);
    model.position.y = 0;
    const body = (this.body = new THREE.Group());
    model.add(body);
    const add = (parent, geo, mat) => {
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      return m;
    };
    const M = this.mat;
    const W = mx ? 1.1 : 1;

    // ---- Frame: twin spars from the head tube round the battery to the swingarm pivot.
    const head = new THREE.CylinderGeometry(0.038, 0.04, D.headTop.distanceTo(D.headBot) + 0.04, 14);
    head.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Yv, D.axisDir));
    head.translate(...D.headTop.clone().add(D.headBot).multiplyScalar(0.5).toArray());
    add(body, head, M.frame);
    const hz = D.headBot.z, hy = D.headBot.y, tz = D.headTop.z, ty = D.headTop.y;
    const pz = D.pivot.z, py = D.pivot.y;
    for (const sx of [-1, 1]) {
      const x = sx * 0.1 * W;
      // Upper spar: head tube back and down to the pivot.
      add(body, tubePath([[tz + 0.02, ty - 0.03], [tz + 0.25, seatY - 0.06], [pz - 0.02, seatY - 0.16], [pz + 0.02, py + 0.12], [pz + 0.02, py]], x, 0.024 * W), M.frame);
      // Down tube and cradle under the battery.
      add(body, tubePath([[hz, hy + 0.02], [hz + 0.08, 0.5], [hz + 0.14, 0.32 + (mx ? 0.03 : 0)], [pz - 0.12, 0.3 + (mx ? 0.04 : 0)], [pz, py - 0.04]], x * 0.92, 0.02 * W), M.frame);
      // Rear subframe up to the seat.
      add(body, tubePath([[pz + 0.03, py + 0.1], [zr - 0.12, seatY - 0.1], [zr + 0.1, seatY - 0.06]], x * 0.85, 0.013), M.frame);
      add(body, tubePath([[pz - 0.02, seatY - 0.16], [zr - 0.06, seatY - 0.08]], x * 0.85, 0.013), M.frame);
    }
    // Battery pack between the spars.
    const bz0 = hz + 0.1, bz1 = pz - 0.06, by0 = mx ? 0.36 : 0.33, by1 = seatY - (mx ? 0.12 : 0.1);
    const batt = new THREE.BoxGeometry(0.19 * W, by1 - by0, bz1 - bz0, 1, 1, 1);
    batt.translate(0, (by0 + by1) / 2, (bz0 + bz1) / 2);
    add(body, batt, M.battery);
    // Motor, low behind the battery, and its controller.
    const motor = new THREE.CylinderGeometry(0.105 * W, 0.105 * W, 0.15, 24);
    motor.rotateZ(Math.PI / 2);
    motor.translate(0.02, py - 0.06, pz - 0.06);
    add(body, motor, M.alu);
    const fins = [];
    for (let i = 0; i < 8; i++) {
      const f = new THREE.BoxGeometry(0.16, 0.012, 0.21 * W);
      f.rotateX((i / 8) * Math.PI);
      f.translate(0.02, py - 0.06, pz - 0.06);
      fins.push(f);
    }
    add(body, mergeGeometries(fins), M.black);
    const ctrl = new THREE.BoxGeometry(0.12, 0.08, 0.2);
    ctrl.translate(0, by0 - 0.03, (bz0 + bz1) / 2 - 0.05);
    add(body, ctrl, M.black);

    // ---- Plastics: side panels over the battery (with the logo), tail, seat.
    const panelShape = mx
      ? shapeFrom([[tz + 0.06, ty - 0.06], [tz + 0.34, seatY + 0.02], [pz + 0.02, seatY - 0.02], [pz - 0.02, by0 + 0.2], [hz + 0.08, by0 + 0.16], [hz - 0.02, hy - 0.08]])
      : shapeFrom([[tz + 0.08, ty - 0.08], [tz + 0.3, seatY - 0.02], [pz - 0.02, seatY - 0.05], [pz - 0.06, by0 + 0.1], [hz + 0.1, by0 + 0.08], [hz + 0.02, hy - 0.06]]);
    for (const sx of [-1, 1]) {
      const g = slab(panelShape, 0.018, sx * 0.108 * W, 0.006);
      sideUVs(g, hz - 0.05, pz + 0.05, by0, seatY + 0.05);
      add(body, g, M.panel);
    }
    // Tail section / rear fender, short and swept up.
    const tailEnd = zr + (mx ? 0.3 : 0.22);
    const tail = shapeFrom([[pz + 0.02, seatY - 0.12], [zr - 0.02, seatY - 0.1], [tailEnd - 0.02, seatY + 0.02], [tailEnd, seatY + 0.06], [zr + 0.02, seatY - 0.01], [pz + 0.02, seatY - 0.05]]);
    add(body, slab(tail, 0.16 * W, 0, 0.01), M.plastic);
    // Tail light.
    const tl = new THREE.BoxGeometry(0.09, 0.028, 0.03);
    tl.rotateX(-0.5);
    tl.translate(0, seatY + 0.03, tailEnd - 0.03);
    add(body, tl, M.tail);
    if (mx) {
      // Side number plates under the seat.
      for (const sx of [-1, 1]) {
        const plate = shapeFrom([[pz + 0.06, seatY - 0.09], [zr + 0.22, seatY - 0.06], [zr - 0.02, seatY - 0.3], [pz + 0.1, seatY - 0.3]]);
        const g = slab(plate, 0.012, sx * 0.14, 0.004);
        sideUVs(g, pz + 0.06, zr + 0.22, seatY - 0.3, seatY - 0.06);
        add(body, g, M.plate);
      }
    }
    // Seat: long and flat, rounded edges.
    const seat = shapeFrom([[tz + 0.3, seatY - 0.04], [tz + 0.34, seatY + 0.01], [zr - 0.02, seatY + 0.025], [zr + 0.06, seatY + 0.01], [zr + 0.04, seatY - 0.05], [tz + 0.34, seatY - 0.06]]);
    add(body, slab(seat, 0.22 * W, 0, 0.025), M.seat);
    // Foot pegs.
    for (const sx of [-1, 1]) {
      const peg = new THREE.BoxGeometry(0.09, 0.025, 0.05);
      peg.translate(sx * (D.peg.x + 0.01), D.peg.y, D.peg.z);
      add(body, peg, M.steel);
      const mount = new THREE.BoxGeometry(0.06, 0.1, 0.05);
      mount.translate(sx * 0.13, D.peg.y + 0.05, D.peg.z);
      add(body, mount, M.black);
    }
    // Rear shock mount on the frame.
    const sm = new THREE.BoxGeometry(0.1, 0.06, 0.06);
    sm.translate(0, D.shockTop.y, D.shockTop.z);
    add(body, sm, M.frame);

    // ---- Fork and bars: a group whose Y axis is the steering axis.
    const fork = (this.fork = new THREE.Group());
    fork.position.copy(D.axisBase);
    this.forkBase = new THREE.Quaternion().setFromUnitVectors(Yv, D.axisDir);
    fork.quaternion.copy(this.forkBase);
    model.add(fork);
    const fl = D.forkLen;
    const spread = 0.085 * W;
    // Triple clamps.
    for (const t of [fl - (mx ? 0.2 : 0.17), fl]) {
      const c = new THREE.BoxGeometry(spread * 2 + 0.07, 0.035, 0.07);
      c.translate(0, t, 0.0);
      add(fork, c, M.alu);
    }
    // Stanchions (upper tubes, fixed to the clamps).
    for (const sx of [-1, 1]) {
      const st = new THREE.CylinderGeometry(0.024, 0.024, 0.5, 14);
      st.translate(sx * spread, fl - 0.23, -D.offset);
      add(fork, st, M.stanchion);
    }
    // Bars, grips, levers, and a little display.
    const barW = mx ? 0.4 : 0.37;
    const bar = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-barW, 0.1, 0.06), new THREE.Vector3(-barW * 0.55, 0.08, 0.04), new THREE.Vector3(-0.08, 0.06, 0),
      new THREE.Vector3(0.08, 0.06, 0), new THREE.Vector3(barW * 0.55, 0.08, 0.04), new THREE.Vector3(barW, 0.1, 0.06),
    ]);
    const barGeo = new THREE.TubeGeometry(bar, 30, 0.0125, 8, false);
    barGeo.translate(0, fl, 0);
    add(fork, barGeo, M.black);
    for (const sx of [-1, 1]) {
      const grip = new THREE.CylinderGeometry(0.019, 0.019, 0.12, 10);
      grip.rotateZ(Math.PI / 2);
      grip.translate(sx * (barW - 0.05), fl + 0.098, 0.058);
      add(fork, grip, M.black);
      const lever = new THREE.BoxGeometry(0.14, 0.008, 0.02);
      lever.rotateY(sx * 0.25);
      lever.translate(sx * (barW - 0.1), fl + 0.1, -0.02);
      add(fork, lever, M.alu);
    }
    const disp = new THREE.BoxGeometry(0.1, 0.04, 0.06);
    disp.rotateX(-0.5);
    disp.translate(0, fl + 0.09, 0.03);
    add(fork, disp, M.black);
    // Grip positions (fork space) for the rider's hands.
    this.gripLocal = [new THREE.Vector3(-(barW - 0.06), fl + 0.098, 0.058), new THREE.Vector3(barW - 0.06, fl + 0.098, 0.058)];
    // Front number plate and headlight.
    const plate = new THREE.PlaneGeometry(mx ? 0.26 : 0.22, mx ? 0.24 : 0.2);
    plate.rotateY(Math.PI);
    plate.rotateX(0.18);
    plate.translate(0, fl - 0.1, -0.09);
    add(fork, plate, M.plate).material.side = THREE.DoubleSide;
    const plateBack = new THREE.BoxGeometry(mx ? 0.27 : 0.23, mx ? 0.25 : 0.21, 0.012);
    plateBack.rotateX(-0.18);
    plateBack.translate(0, fl - 0.1, -0.08);
    add(fork, plateBack, M.black);
    const lamp = new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20);
    lamp.rotateX(Math.PI / 2 - 0.18);
    lamp.translate(0, fl - (mx ? 0.22 : 0.18), -0.1);
    add(fork, lamp, M.lamp);
    // Front fender, high enough above the tyre to clear full compression.
    const fenderCurve = new THREE.Shape();
    const fr = R + 0.05;
    fenderCurve.absarc(0, 0, fr, Math.PI * 0.3, Math.PI * 0.85, false);
    fenderCurve.absarc(0, 0, fr + 0.022, Math.PI * 0.85, Math.PI * 0.3, true);
    const fender = new THREE.ExtrudeGeometry(fenderCurve, { depth: 0.12 * W, bevelEnabled: false, curveSegments: 18 });
    fender.translate(0, 0, -0.06 * W);
    fender.rotateY(-Math.PI / 2);
    fender.translate(0, S.travelF + 0.03, -D.offset);
    add(fork, fender, M.plastic);

    // Slider: lower fork legs and the front wheel; moves along the axis.
    const slider = (this.slider = new THREE.Group());
    fork.add(slider);
    for (const sx of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.034, 0.03, 0.4, 14);
      leg.translate(sx * spread, 0.2, -D.offset);
      add(slider, leg, M.fork);
      const guard = new THREE.BoxGeometry(0.02, 0.26, 0.06);
      guard.translate(sx * (spread + 0.035), 0.18, -D.offset - 0.02);
      add(slider, guard, M.black);
    }
    const axle = new THREE.CylinderGeometry(0.012, 0.012, spread * 2 + 0.08, 8);
    axle.rotateZ(Math.PI / 2);
    axle.translate(0, 0, -D.offset);
    add(slider, axle, M.alu);
    const cal = new THREE.BoxGeometry(0.035, 0.09, 0.07);
    cal.translate(-spread + 0.03, 0.09, -D.offset + 0.07);
    add(slider, cal, M.caliper);
    this.frontWheel = this._wheel(R, mx ? 0.085 : 0.075, true);
    this.frontWheel.position.set(0, 0, -D.offset);
    slider.add(this.frontWheel);

    // ---- Swingarm and rear wheel.
    const arm = (this.swingarm = new THREE.Group());
    arm.position.copy(D.pivot);
    model.add(arm);
    const armLen = Math.hypot(zr - D.pivot.z, D.pivot.y - R);
    this.armLen = armLen;
    for (const sx of [-1, 1]) {
      const a = new THREE.BoxGeometry(0.035, 0.07, armLen + 0.06, 1, 1, 4);
      const p = a.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - 0.35 * ((p.getZ(i) + armLen / 2) / armLen)));
      a.computeVertexNormals();
      a.translate(sx * 0.1 * W, 0, armLen / 2);
      add(arm, a, M.alu);
    }
    const brace = new THREE.BoxGeometry(0.2 * W, 0.05, 0.05);
    brace.translate(0, 0.02, 0.12);
    add(arm, brace, M.alu);
    const pivotBolt = new THREE.CylinderGeometry(0.022, 0.022, 0.28 * W, 10);
    pivotBolt.rotateZ(Math.PI / 2);
    add(arm, pivotBolt, M.steel);
    // Chain run: motor sprocket at the pivot to the rear sprocket.
    const cr0 = 0.045, cr1 = 0.105;
    const chainPath = new THREE.Shape();
    chainPath.absarc(0, 0, cr0, Math.PI / 2, -Math.PI / 2, false);
    chainPath.absarc(armLen, 0, cr1, -Math.PI / 2, Math.PI / 2, false);
    const chainPts = chainPath.getSpacedPoints(80).map((q) => new THREE.Vector3(-0.075 * W, q.y, q.x));
    add(arm, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(chainPts, true), 120, 0.007, 5, true), M.chain);
    const sprocket = new THREE.CylinderGeometry(cr1 - 0.005, cr1 - 0.005, 0.008, 36);
    sprocket.rotateZ(Math.PI / 2);
    sprocket.translate(-0.075 * W, 0, armLen);
    add(arm, sprocket, M.steel);
    const rcal = new THREE.BoxGeometry(0.035, 0.07, 0.08);
    rcal.translate(0.09 * W, 0.07, armLen - 0.05);
    add(arm, rcal, M.caliper);
    this.rearWheel = this._wheel(R, mx ? 0.105 : 0.09, false);
    this.rearWheel.position.set(0, 0, armLen);
    arm.add(this.rearWheel);
    this.armRestAngle = Math.atan2(D.pivot.y - R, zr - D.pivot.z);

    // ---- Rear shock: body, shaft and coil between frame and swingarm link.
    this.shockBody = new Strut(M.black, 0.03);
    this.shockShaft = new Strut(M.stanchion, 0.012);
    this.coil = new THREE.Mesh(helixGeometry(0.045, 8, 0.009), M.spring);
    this.coil.castShadow = true;
    for (const m of [this.shockBody.mesh, this.shockShaft.mesh, this.coil]) model.add(m);
    this.shockArmPoint = new THREE.Vector3(0, 0.07, armLen * 0.38);

    // ---- Rider.
    this.rider = new Rider(look, (m, dirt = true) => this.prep(m, dirt));
    model.add(this.rider.root);
    this.riderCrashGroup = new THREE.Group();

    // Fewer draw calls: merge the static frame per material.
    this._mergeGroup(body);
    this._mergeGroup(fork, new Set([slider]));
    this._mergeGroup(slider, new Set([this.frontWheel]));
    this._mergeGroup(arm, new Set([this.rearWheel]));
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.standT = 0;
    this.footDown = 0;
    this.landT = 0;
    this.wheelieT = 0;
    this.riderAttached = true;
  }

  // Spoked wheel with a knobbly tyre, hub and brake disc; spins about x.
  _wheel(R, width, front) {
    const M = this.mat;
    const g = new THREE.Group();
    const rimR = R - (front ? 0.075 : 0.085);
    // Tyre carcass: a rounded cross-section turned about the axle.
    const prof = [];
    const tw = width, th = R - rimR;
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      prof.push(new THREE.Vector2(rimR + th * 0.5 + Math.cos(a) * th * 0.5, Math.sin(a) * tw * 0.5));
    }
    const tyre = new THREE.LatheGeometry(prof, 48);
    tyre.rotateZ(Math.PI / 2);
    // Sidewall text: spread the canvas round the wheel.
    {
      const uv = tyre.attributes.uv, pos = tyre.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (Math.atan2(pos.getZ(i), pos.getY(i)) / (Math.PI * 2) + 0.5) * 2, 0.5 + pos.getX(i) * 4);
    }
    const parts = { rubber: [tyre], tread: [], rim: [], steel: [], alu: [] };
    // Knobs in three staggered rows.
    const knob = new THREE.BoxGeometry(0.022, 0.018, 0.026);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const n = Math.round((R * Math.PI * 2) / 0.05);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const [x, rowA, tilt] of [[0, 0, 0], [-tw * 0.32, 0.5, 0.45], [tw * 0.32, 0.5, -0.45]]) {
        const aa = a + (rowA * Math.PI * 2) / n;
        const r = R - 0.006 - Math.abs(tilt) * 0.012;
        q.setFromEuler(new THREE.Euler(-aa, 0, tilt));
        m4.compose(new THREE.Vector3(x, Math.cos(aa) * r, Math.sin(aa) * r), q, s);
        parts.tread.push(knob.clone().applyMatrix4(m4));
      }
    }
    // Rim: a shallow channel.
    const rimProf = [new THREE.Vector2(rimR - 0.018, -0.022), new THREE.Vector2(rimR, -0.024), new THREE.Vector2(rimR + 0.004, -0.02), new THREE.Vector2(rimR - 0.004, 0), new THREE.Vector2(rimR + 0.004, 0.02), new THREE.Vector2(rimR, 0.024), new THREE.Vector2(rimR - 0.018, 0.022)];
    const rim = new THREE.LatheGeometry(rimProf, 48);
    rim.rotateZ(Math.PI / 2);
    parts.rim.push(rim);
    // Hub and spokes (crossed, from two flanges).
    const hub = new THREE.CylinderGeometry(0.035, 0.035, 0.13, 14);
    hub.rotateZ(Math.PI / 2);
    parts.alu.push(hub);
    for (const fx of [-0.045, 0.045]) {
      const fl = new THREE.CylinderGeometry(0.052, 0.052, 0.008, 18);
      fl.rotateZ(Math.PI / 2);
      fl.translate(fx, 0, 0);
      parts.alu.push(fl);
    }
    const spokes = 32;
    const a0 = new THREE.Vector3(), a1 = new THREE.Vector3();
    for (let i = 0; i < spokes; i++) {
      const side = i % 2 ? 1 : -1;
      const a = (i / spokes) * Math.PI * 2;
      const cross = ((i % 4 < 2 ? 1 : -1) * Math.PI * 2 * 1.5) / spokes;
      a0.set(side * 0.045, Math.cos(a + cross) * 0.048, Math.sin(a + cross) * 0.048);
      a1.set(side * 0.006, Math.cos(a) * (rimR - 0.012), Math.sin(a) * (rimR - 0.012));
      const len = a0.distanceTo(a1);
      const sp = new THREE.CylinderGeometry(0.0022, 0.0022, len, 4, 1);
      sp.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Yv, a1.clone().sub(a0).normalize()));
      sp.translate((a0.x + a1.x) / 2, (a0.y + a1.y) / 2, (a0.z + a1.z) / 2);
      parts.steel.push(sp);
    }
    // Brake disc with cut-outs, on the left in front and the right at the back.
    const discR = front ? 0.12 : 0.1;
    const ds = new THREE.Shape();
    const lobes = 12;
    for (let i = 0; i <= lobes * 8; i++) {
      const a = (i / (lobes * 8)) * Math.PI * 2;
      const r = discR * (1 - 0.05 * (0.5 + 0.5 * Math.cos(a * lobes)));
      i ? ds.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ds.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.05, 0, Math.PI * 2, true);
    ds.holes.push(hole);
    const disc = new THREE.ExtrudeGeometry(ds, { depth: 0.004, bevelEnabled: false, curveSegments: 8 });
    disc.rotateY(Math.PI / 2);
    disc.translate(front ? -0.07 : 0.07, 0, 0);
    parts.steel.push(disc);

    for (const [key, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const geos = list.map((x) => {
        const y = x.index ? x.toNonIndexed() : x;
        for (const name of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(name)) y.deleteAttribute(name);
        if (!y.attributes.uv) y.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2));
        return y;
      });
      const merged = mergeGeometries(geos);
      merged.computeBoundingSphere();
      const mat = key === 'rubber' ? M.rubber : key === 'tread' ? M.tread : key === 'rim' ? M.rim : key === 'steel' ? M.steel : M.alu;
      g.add(new THREE.Mesh(merged, mat));
    }
    return g;
  }

  _mergeGroup(group, skip = new Set()) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    const remove = [];
    const visit = (o) => {
      if (skip.has(o)) return;
      if (o.isMesh && !o.isInstancedMesh) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(g);
        remove.push(o);
      }
      for (const c of o.children) visit(c);
    };
    for (const c of group.children) visit(c);
    for (const o of remove) o.parent.remove(o);
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list);
      merged.computeBoundingSphere();
      group.add(new THREE.Mesh(merged, mat));
    }
  }

  setDirt(v) { this.shared.uDirt.value = v; }

  // Sync with the physics. `pos`/`quat` are the interpolated body transform.
  update(dt, bike, pos, quat, time, scene) {
    const S = this.spec, D = this.dims, V = this._v;
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    // Lean about the tyres' contact line: the pivot sits on the ground under the centre of mass.
    this.leanPivot.position.set(0, -S.cgHeight, 0);
    const stopped = !bike.crashed && bike.speed < 0.8 && bike.groundedWheels === 2 && bike.throttleInput < 0.1;
    this.footDown += ((stopped ? 1 : 0) - this.footDown) * (1 - Math.exp(-dt * 5));
    this.leanPivot.rotation.z = bike.crashed ? 0 : bike.lean + this.footDown * 0.09;
    this.root.updateMatrixWorld(true);
    this.shared.uBodyInv.value.copy(this.root.matrixWorld).invert();

    const [fw, rw] = bike.wheels;
    // Front: slide the lower legs up the fork so the axle sits where the physics has it.
    const frontY = fw.center.y + S.cgHeight;          // model space
    const slide = (frontY - D.R) / Math.cos(D.rake);
    this.slider.position.set(0, slide, 0);
    this.fork.quaternion.copy(this.forkBase).multiply(this._q.setFromAxisAngle(Yv, fw.steer));
    this.frontWheel.rotation.x = -fw.spin;
    // Rear: swing the arm down to the wheel.
    const rearY = rw.center.y + S.cgHeight;
    const ang = Math.asin(THREE.MathUtils.clamp((D.pivot.y - rearY) / this.armLen, -0.95, 0.95));
    this.swingarm.rotation.x = ang;
    this.rearWheel.rotation.x = -rw.spin;
    // Shock between the frame and the arm.
    this.swingarm.updateMatrix();
    const bot = V[0].copy(this.shockArmPoint).applyMatrix4(this.swingarm.matrix);
    const top = D.shockTop;
    this.shockBody.set(top, V[1].lerpVectors(top, bot, 0.6));
    this.shockShaft.set(V[1], bot);
    this.coil.position.lerpVectors(top, bot, 0.45);
    this.coil.quaternion.setFromUnitVectors(Yv, V[2].subVectors(bot, top).normalize());
    this.coil.scale.set(1, top.distanceTo(bot) * 0.62, 1);

    // ---- Rider.
    if (bike.crashed) {
      if (this.riderAttached) {
        this.model.remove(this.rider.root);
        this.riderCrashGroup.add(this.rider.root);
        scene?.add(this.riderCrashGroup);
        this.riderAttached = false;
      }
      bike.riderTransform(this.riderCrashGroup.position, this.riderCrashGroup.quaternion);
      this.riderCrashGroup.position.y -= 0.05;
      this.rider.poseTumble(dt, bike.riderBody.onGround);
      return;
    }
    if (!this.riderAttached) {
      this.riderCrashGroup.remove(this.rider.root);
      this.riderCrashGroup.parent?.remove(this.riderCrashGroup);
      this.model.add(this.rider.root);
      this.riderAttached = true;
    }
    const air = bike.groundedWheels === 0;
    const wheelie = bike.inWheelie ? THREE.MathUtils.clamp(bike.wheelieAngle, 0, 1) : 0;
    this.wheelieT += (wheelie - this.wheelieT) * (1 - Math.exp(-dt * 6));
    const standWant = air ? 1 : bike.landing > 0.25 ? 0.9 : bike.speed > 17 && !bike.inWheelie ? 0.45 : 0;
    this.standT += (standWant - this.standT) * (1 - Math.exp(-dt * (standWant > this.standT ? 5 : 2.5)));
    this.landT = Math.max(this.landT - dt * 2.5, bike.landing);
    const st = this.standT * (1 - this.wheelieT);
    const hip = V[3].set(0, D.seatY + 0.07 + st * 0.26 - this.landT * 0.1, D.pivot.z + 0.1 - st * 0.14 + this.wheelieT * 0.06);
    this.fork.updateMatrix();
    const handL = V[4].copy(this.gripLocal[0]).applyMatrix4(this.fork.matrix);
    const handR = V[5].copy(this.gripLocal[1]).applyMatrix4(this.fork.matrix);
    let footL = V[6].set(-D.peg.x, D.peg.y + 0.05, D.peg.z - 0.03);
    const footR = V[7].set(D.peg.x, D.peg.y + 0.05, D.peg.z - 0.03);
    if (this.footDown > 0.02) {
      // Stopped: left boot down on the ground.
      footL = V[8].lerpVectors(footL, V[9].set(-0.36, 0.06, D.peg.z - 0.12), this.footDown);
    }
    // In a wheelie the rider stays roughly upright in the world (so leans
    // forward relative to the bike), arms straight, hanging just behind balance.
    const wk = THREE.MathUtils.clamp(this.wheelieT / 0.35, 0, 1);
    const ride = 0.45 + st * 0.35 + Math.min(0.15, bike.power * 0.1);
    const pose = {
      hip,
      torsoPitch: ride * (1 - wk) + (this.wheelieT - 0.12) * wk,
      torsoRoll: bike.lean * 0.25,
      headPitch: (0.1 + st * 0.2) * (1 - wk) + (this.wheelieT - 0.05) * wk,
      handL, handR, footL, footR, footQuat: null,
    };
    if (bike.trick && bike.trickExt > 0) this._trickPose(TRICKS[bike.trick].id, THREE.MathUtils.smoothstep(bike.trickExt, 0, 1), pose);
    this.rider.pose(pose);
    void time;
  }

  // Blend the riding pose toward a freestyle trick; e runs from 0 (on the bike)
  // to 1 (all the way out). Legs lift on the way so they swing clear of the bike.
  _trickPose(id, e, P) {
    const D = this.dims, T = this._tv;
    const gy = (P.handL.y + P.handR.y) / 2, gz = (P.handL.z + P.handR.z) / 2;   // the grips
    const lift = Math.sin(Math.PI * e);
    const mix = (a, b) => a + (b - a) * e;
    const to = (v, x, y, z) => v.lerp(T.set(x, y, z), e);
    const seat = D.seatY, pz = D.pivot.z;
    if (id === 'superman') {
      // Flat out behind the bike, hanging on to the bars.
      to(P.hip, 0, gy + 0.03, gz + 0.9);
      P.torsoPitch = mix(P.torsoPitch, 1.35);
      P.torsoRoll *= 1 - e;
      P.headPitch = mix(P.headPitch, 0.55);
      to(P.footL, -0.13, gy + 0.13, gz + 1.74).y += lift * 0.15;
      to(P.footR, 0.13, gy + 0.13, gz + 1.74).y += lift * 0.15;
    } else if (id === 'nohander') {
      // Standing tall, knees gripping the seat, both arms out wide.
      to(P.hip, 0, seat + 0.26, pz + 0.02);
      P.torsoPitch = mix(P.torsoPitch, 0.12);
      P.headPitch = mix(P.headPitch, -0.1);
      to(P.handL, -0.72, seat + 0.88, pz + 0.04);
      to(P.handR, 0.72, seat + 0.88, pz + 0.04);
    } else if (id === 'heelclicker') {
      // Sat back, both boots up over the bars, heels together.
      to(P.hip, 0, seat + 0.16, pz + 0.16);
      P.torsoPitch = mix(P.torsoPitch, -0.3);
      P.headPitch = mix(P.headPitch, 0.05);
      const out = lift * 0.26;
      to(P.footL, -0.05, gy + 0.16, gz - 0.28).add(T.set(-out, lift * 0.25, 0));
      to(P.footR, 0.05, gy + 0.16, gz - 0.28).add(T.set(out, lift * 0.25, 0));
    } else if (id === 'nacnac') {
      // Left leg swung over the back of the bike, both legs off the right side.
      to(P.hip, 0.1, seat + 0.2, pz + 0.06);
      P.torsoPitch = mix(P.torsoPitch, 0.45);
      P.torsoRoll = mix(P.torsoRoll, 0.2);
      P.headPitch = mix(P.headPitch, 0.2);
      to(P.footL, 0.5, seat + 0.05, pz + 0.62).add(T.set(0, lift * 0.45, lift * 0.2));
    } else if (id === 'cancan') {
      // Left leg kicked over the top of the bike and out to the right, in front.
      to(P.hip, 0.04, seat + 0.18, pz + 0.08);
      P.torsoPitch = mix(P.torsoPitch, 0.3);
      P.torsoRoll = mix(P.torsoRoll, -0.15);
      to(P.footL, 0.48, seat + 0.3, pz - 0.55).y += lift * 0.35;
    }
    const fq = this._trickFeet[id];
    if (fq) P.footQuat = this._footQ.identity().slerp(fq, e);
  }
}
