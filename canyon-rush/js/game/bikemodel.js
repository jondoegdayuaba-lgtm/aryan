// The e-bikes' 3D models, built in code: an aluminium frame around the battery
// pack, the motor and chain drive, a fork that steers and compresses, a
// swingarm that follows the rear wheel, spoked wheels with knobbly tyres, disc
// brakes, lights, plastics in each bike's colours that gather dust, and the rider.
import * as THREE from 'three';
import { canvasTexture } from '../render/textures.js';
import { useTerrainLight } from '../render/shaderpatch.js';
import { getModel } from './models.js';
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
    const M = this.mat;

    // The parts are modelled in Blender (tools/blender/bikes.py), each in its
    // own frame; the groups here move them the way the physics says.
    const src = getModel(`bike-${spec.id}.glb`).scene;
    const fill = (group, part) => {
      src.getObjectByName(part).traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry;
        if (g.attributes.uv && !g.userData.uvFlipped) {
          // glTF counts texture rows from the top; the livery canvases count from the bottom.
          const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
          g.userData.uvFlipped = true;
        }
        group.add(new THREE.Mesh(g, M[o.material.name] || M.black));
      });
    };
    const body = (this.body = new THREE.Group());
    model.add(body);
    fill(body, 'body');

    // Fork and bars: a group whose Y axis is the steering axis.
    const fork = (this.fork = new THREE.Group());
    fork.position.copy(D.axisBase);
    this.forkBase = new THREE.Quaternion().setFromUnitVectors(Yv, D.axisDir);
    fork.quaternion.copy(this.forkBase);
    model.add(fork);
    fill(fork, 'fork');
    const fl = D.forkLen;
    const barW = mx ? 0.4 : 0.37;
    // Grip positions (fork space) for the rider's hands.
    this.gripLocal = [new THREE.Vector3(-(barW - 0.06), fl + 0.098, 0.058), new THREE.Vector3(barW - 0.06, fl + 0.098, 0.058)];

    // Slider: lower fork legs and the front wheel; moves along the axis.
    const slider = (this.slider = new THREE.Group());
    fork.add(slider);
    fill(slider, 'slider');
    this.frontWheel = new THREE.Group();
    fill(this.frontWheel, 'wheelF');
    this.frontWheel.position.set(0, 0, -D.offset);
    slider.add(this.frontWheel);

    // Swingarm and rear wheel.
    const arm = (this.swingarm = new THREE.Group());
    arm.position.copy(D.pivot);
    model.add(arm);
    fill(arm, 'swingarm');
    const armLen = Math.hypot(zr - D.pivot.z, D.pivot.y - R);
    this.armLen = armLen;
    this.rearWheel = new THREE.Group();
    fill(this.rearWheel, 'wheelR');
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
