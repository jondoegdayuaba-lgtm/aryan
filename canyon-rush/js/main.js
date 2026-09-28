import * as THREE from 'three';
import { STAGE } from './world/stage.js';
import { generateWorld } from './world/worldgen.js';
import { Atmosphere, makeSkyDome } from './render/atmosphere.js';
import { installShaderChunks } from './render/shaderpatch.js';
import { Terrain } from './render/terrain.js';
import { bakeTerrainLight } from './render/bake.js';
import { PostPipeline } from './render/post.js';
import { makeNoiseTexture, makeCellTexture } from './render/textures.js';
import { PhysicsWorld } from './game/physicsworld.js';
import { Vehicle } from './game/vehicle.js';
import { TruckModel } from './game/truck.js';
import { CameraRig } from './game/camera.js';
import { Input } from './game/input.js';
import { Autopilot } from './game/autopilot.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function setProgress(p, label) {
  $('load-fill').style.width = `${Math.round(p * 100)}%`;
  if (label) $('load-label').textContent = label;
}

async function runGenerator(gen, onProgress) {
  let t0 = performance.now();
  for (;;) {
    const { value, done } = gen.next();
    if (done) return value;
    if (performance.now() - t0 > 40) {
      onProgress(value);
      await nextFrame();
      t0 = performance.now();
    }
  }
}

async function boot() {
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (err) {
    $('load-label').textContent = 'This game needs WebGL 2, which your browser could not start.';
    throw err;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const t0 = performance.now();
  const world = await runGenerator(generateWorld(STAGE), (v) => setProgress(v.progress * 0.7, v.label));
  console.log(`world generated in ${((performance.now() - t0) / 1000).toFixed(2)} s`);

  setProgress(0.72, 'Painting the sky');
  await nextFrame();
  const tex = { noise: makeNoiseTexture(), cell: makeCellTexture() };
  const atmo = new Atmosphere(renderer, params.get('time') || 'golden');
  installShaderChunks(atmo);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.00011);
  scene.environment = atmo.envMap;
  scene.add(makeSkyDome(atmo));

  const sun = new THREE.DirectionalLight(atmo.sunColor, atmo.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 1600 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  const terrain = new Terrain(world, tex, { stage: STAGE, gridDim: 32 });
  scene.add(terrain.mesh);

  const baked = await bakeTerrainLight(renderer, world, atmo.sunDir, {
    nearStep: params.has('fastbake') ? 2 : 1,
    onProgress: (f) => setProgress(0.75 + 0.2 * f, 'Lighting the canyon'),
  });

  // ---- Physics world, truck, camera, controls.
  const phys = new PhysicsWorld(world, STAGE);
  const vehicle = new Vehicle(phys);
  const truck = new TruckModel(tex, +(params.get('livery') || 0));
  scene.add(truck.root);
  const route = world.route;
  const start = route.pos(0), dir = route.tangent(0);
  vehicle.placeOnGround(start.x, start.z, Math.atan2(-dir.x, -dir.z));

  const post = new PostPipeline(renderer, {
    samples: params.has('msaa') ? +params.get('msaa') : 4,
    renderScale: params.has('scale') ? +params.get('scale') : 1,
  });
  post.composite.uniforms.uExposure.value = atmo.time.exposure;

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 30000);
  const rig = new CameraRig(camera, (x, z) => phys.heightAt(x, z));
  const input = new Input(canvas);
  const auto = new Autopilot(route);
  const autoDrive = params.has('auto');

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    const pr = renderer.getPixelRatio();
    post.setSize(Math.floor(innerWidth * pr), Math.floor(innerHeight * pr));
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  input.onKey = (code) => {
    if (code === 'KeyC') rig.cycle();
    if (code === 'KeyR') {
      const n = route.nearest(vehicle.pos.x, vehicle.pos.z);
      const p = route.pos(n.s), t = route.tangent(n.s);
      vehicle.placeOnGround(p.x, p.z, Math.atan2(-t.x, -t.z));
      rig.snap();
    }
  };

  const bodyPos = new THREE.Vector3(), bodyQuat = new THREE.Quaternion();
  let time = 0;
  function step(dt, render = true) {
    time += dt;
    const inp = autoDrive || !render ? auto.drive(vehicle) : input.read();
    vehicle.update(dt, inp);
    vehicle.renderTransform(bodyPos, bodyQuat);
    if (!render) return;
    truck.update(dt, vehicle, bodyPos, bodyQuat, time);
    const look = input.consumeLook();
    rig.update(dt, vehicle, bodyPos, bodyQuat, look, { boost: inp.boost, stickX: inp.lookX, stickY: inp.lookY, shake: vehicle.landing });

    // Shadow camera sits over the truck, snapped to texels to stop shimmering.
    const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
    const f = bodyPos;
    sun.target.position.set(Math.round(f.x / texel) * texel, f.y, Math.round(f.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(atmo.sunDir, 600);

    terrain.update(camera);
    post.render(scene, camera, dt);
  }

  // Headless testing: simulate some seconds of autopilot driving before the first frame.
  if (params.has('sim')) {
    const secs = +params.get('sim');
    for (let t = 0; t < secs; t += 1 / 60) step(1 / 60, false);
  }

  $('loading').classList.add('done');
  if (params.has('still')) $('loading').style.display = 'none';
  let last = performance.now();
  let frames = 0;
  const still = params.has('still') ? +params.get('still') || 1 : 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(still ? 1 / 60 : dt);
    frames++;
    if (still && frames >= still) { window.__frameDone = true; return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const renderOnce = () => { terrain.update(camera); post.render(scene, camera, 0.016); };
  const stepFrames = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt); };
  window.__canyon = { renderer, scene, camera, terrain, world, atmo, post, sun, renderOnce, stepFrames, THREE, baked, vehicle, truck, rig, phys, route, auto, step };
  window.__ready = true;
}

boot().catch((err) => {
  console.error(err);
  $('load-label').textContent = 'Something went wrong while loading: ' + err.message;
});
