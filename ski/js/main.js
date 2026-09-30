// Alpine Descent - bootstrap (development viewer for now)
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { WorldData } from './world-data.js';
import { Loader } from './assets.js';
import { TerrainRenderer } from './terrain-render.js';
import { Vegetation } from './vegetation.js';
import { setupSky } from './sky.js';
import { installFog, setWorldLightTexture } from './shader-patches.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

function fail(err) {
  console.error(err);
  const el = $('error');
  el.hidden = false;
  el.textContent = 'Sorry, the game could not start: ' + (err && err.message ? err.message : err);
}

async function boot() {
  const canvas = $('game');
  const gl2 = !!canvas.getContext('webgl2');
  if (!gl2) throw new Error('WebGL 2 is required. Please use a recent Chrome, Edge, Firefox or Safari.');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, params.has('dpr') ? +params.get('dpr') : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const fill = $('loading-fill'), label = $('loading-label');
  const loader = new Loader('assets/', (done, total, name) => {
    fill.style.width = `${Math.round((done / total) * 100)}%`;
    label.textContent = name;
  });

  const world = await WorldData.load('assets/world/');
  const atm = (await loader.json('world/atmosphere.json')) || {};
  const [treeGltf, treeAtlas, treeInfo] = await Promise.all([
    loader.gltf('models/trees.glb'), loader.texture('tex/tree_branches.png', { anisotropy: 8 }), loader.json('models/tree_info.json'),
  ]);
  const [color, mask, light, sky, skyIbl] = await Promise.all([
    loader.texture('tex/terrain_color.jpg'),
    loader.texture('tex/terrain_mask.png', { srgb: false }),
    loader.texture('tex/terrain_light.png', { srgb: false }),
    loader.hdr('tex/sky.hdr'),
    loader.hdr('tex/sky_ibl.hdr'),
  ]);
  if (!color || !mask) throw new Error('Terrain textures are missing - run blender/build.py');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 9000);
  scene.add(camera);

  const sunDir = world.sunDir;
  // physically measured sun / sky (Blender Cycles probe): irradiance in scene units
  const sunE = atm.sunIrradiance || [3.4, 3.1, 2.7];
  const sunLum = atm.sunLuminance || 3.3;
  const exposure = 1 / ((0.9 / Math.PI) * sunLum * 0.7);
  const sunColor = new THREE.Color(sunE[0] / sunLum, sunE[1] / sunLum, sunE[2] / sunLum);
  const fogRGB = (atm.fogColor || [0.55, 0.68, 0.88]).map((v) => v * (atm.fogColor ? exposure : 1));
  installFog({ sunDir, sunColor: [sunColor.r, sunColor.g, sunColor.b].map((v) => v * 0.9) });
  scene.fog = new THREE.Fog(0xb9cdee, 1, 10);
  scene.fog.color.setRGB(fogRGB[0], fogRGB[1], fogRGB[2]);
  renderer.toneMappingExposure = (params.has('exp') ? +params.get('exp') : exposure) * (params.has('expm') ? +params.get('expm') : 1);
  const TM = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, reinhard: THREE.ReinhardToneMapping, linear: THREE.LinearToneMapping, cineon: THREE.CineonToneMapping };
  if (params.has('tm')) renderer.toneMapping = TM[params.get('tm')] ?? renderer.toneMapping;
  console.log('[atmosphere] exposure', exposure.toFixed(4), 'sun', sunLum.toFixed(1));

  const skyHandle = setupSky(renderer, scene, { sky, skyIbl }, sunDir, { backgroundIntensity: params.has('bgi') ? +params.get('bgi') : 2.0, envIntensity: params.has('envi') ? +params.get('envi') : 1.0 });
  if (params.get('bg') === 'ibl' && skyIbl) scene.background = skyIbl;
  setWorldLightTexture(light, world);

  const sun = new SunLight(sunColor, sunLum);
  sun.position.set(sunDir[0], sunDir[1], sunDir[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const terrain = new TerrainRenderer(world, { color, mask });
  terrain.setSun(sunDir, new THREE.Vector3(sunE[0], sunE[1], sunE[2]));
  scene.add(terrain.group);

  let veg = null;
  if (treeGltf && treeAtlas && treeInfo) {
    veg = new Vegetation(world, treeGltf, treeAtlas, treeInfo);
    scene.add(veg.group);
  }

  // ---- debug camera from the query string
  const pathPos = {};
  const s = +(params.get('s') ?? 300);
  const t = +(params.get('t') ?? 0);
  const h = +(params.get('h') ?? 2.5);
  const yaw = (+(params.get('yaw') ?? 0) * Math.PI) / 180;
  const pitch = (+(params.get('pitch') ?? -8) * Math.PI) / 180;
  world.path.at(s, pathPos);
  const cx = pathPos.x + pathPos.rx * t, cz = pathPos.z + pathPos.rz * t;
  camera.position.set(cx, world.height(cx, cz) + h, cz);
  camera.fov = +(params.get('fov') ?? 60);
  camera.updateProjectionMatrix();
  const heading = Math.atan2(pathPos.tx, -pathPos.tz) - yaw;   // three.js: forward = -Z
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, -heading, 0);
  camera.updateMatrixWorld(true);
  if (params.get('look') === 'sun') { camera.lookAt(camera.position.clone().add(new THREE.Vector3(...sunDir))); camera.updateMatrixWorld(true); }

  function renderFrame() {
    if (skyHandle.background) {
      skyHandle.background.position.copy(camera.position);
      skyHandle.background.scale.setScalar(camera.far * 0.5);
    }
    terrain.update(camera);
    if (veg) veg.update(camera, 0.016, true);
    renderer.render(scene, camera);
  }
  window.__ski = { renderer, scene, camera, world, terrain, veg, renderFrame, params };
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  $('loading').classList.add('done');
  if (params.has('manual')) {
    renderFrame();
    window.__ready = true;
  } else {
    renderer.setAnimationLoop(renderFrame);
    window.__ready = true;
  }
}

boot().catch(fail);
