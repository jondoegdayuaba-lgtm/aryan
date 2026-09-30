# Alpine Descent

A realistic 3D downhill skiing game for the browser. The mountain, forest, sky, skier, course furniture and the terrain's
light map were all built and lit in **Blender** (see [`blender/`](../blender/README.md)); the game itself is plain JavaScript on
[three.js](https://threejs.org) with a physically scaled lighting pipeline, so what you see is what Blender rendered.

## Play it

* **Desktop file:** save [`desktop/alpine-descent.html`](../desktop/alpine-descent.html) to your desktop and double-click it. It is the
  whole game (code and every model and texture) in one ~23 MB file and runs offline. It needs a browser with WebGL 2
  (current Chrome, Edge, Firefox or Safari) and benefits from a real GPU.
* **From source:** ES modules don't load from `file://`, so serve the repository and open the `ski/` folder:

  ```sh
  python3 -m http.server 8000
  # then open http://localhost:8000/ski/
  ```

## Controls

| | Keyboard | Touch |
| --- | --- | --- |
| Steer | A / D or ← / → | hold the left or right half of the lower screen |
| Tuck (faster) | W, ↑ or Shift (hold) | Tuck button |
| Brake | S or ↓ | Brake button |
| Jump | hold Space to crouch, release to pop | Jump button |
| Camera | C (chase, far, helmet) | camera button |
| Restart / pause / mute | R / Esc or P / M | on-screen buttons |

A gamepad works too (left stick, triggers, A).

## The runs

| Run | | What to expect |
| --- | --- | --- |
| **Sunrise Cruiser** | blue, 0.94 km | the open bowl above the tree line, wide checkpoints, learn to carve |
| **Giant Slalom** | red, 0.99 km, 22 gates | thread every gate through the forest; a missed gate costs 3 s |
| **The Long Descent** | black, 2.8 km, 721 m vertical | steep headwall, four jumps, the fastest snow on the mountain; a crash costs 4 s |

Each run has bronze, silver and gold times, split times at the checkpoints, and your best time is remembered in the browser.

## How it feels

* Point-mass ski physics with real gravity, air drag (tucking halves the drag area), snow friction, edge grip that limits how
  hard you can turn, skidding, hockey stops, jumps, hard landings and crashes.
* The world is a 3.7 km x 1.2 km height field sampled with bicubic interpolation, so the skis follow the same surface the
  renderer draws.
* Groomed corduroy, sparkling snow, wind-packed drifts, 28,000 trees in four species, boulders with snow caps, gates that
  swing when you brush them, banners in the wind, a working chairlift, snow spray and ski tracks.

## Graphics options

`Graphics` in the menu: Auto, Low, Medium, High, Ultra. The game also lowers its render resolution when the frame rate drops.
Useful URL parameters for testing: `?q=ultra`, `?run=gs&autoplay=1` (let the autopilot race), `?exp=1.1` (exposure).

## Code

| File | What it does |
| --- | --- |
| `js/main.js`, `js/game.js` | boot, scene, game loop, screens |
| `js/world-data.js` | height field, piste path, tree and boulder colliders (also used by the Node tests) |
| `js/physics.js`, `js/course.js`, `js/session.js`, `js/ai.js` | ski physics, gates and timing, a race attempt, the autopilot |
| `js/terrain-render.js` | chunked LOD terrain with vertex-texture displacement, snow and rock shading, corduroy |
| `js/shader-patches.js` | height-aware fog, baked light-map hook shared by every material |
| `js/vegetation.js`, `js/rocks.js`, `js/props.js` | trees, boulders, gates / banners / nets / lodge / chairlift |
| `js/skier-rig.js`, `js/camera.js` | the skinned skier posed by the physics, chase / far / helmet cameras |
| `js/postfx.js`, `js/effects.js`, `js/sky.js` | HDR post-processing, snow spray and tracks, sky and image-based light |
| `js/audio.js`, `js/input.js`, `js/ui.js` | synthesised sound, keyboard / touch / gamepad, menus and HUD |

Tests without a browser: `node tools/ski-sim.mjs all` lets the autopilot race every run and prints the times;
`npm run build:ski` rebuilds `desktop/alpine-descent.html`.

three.js is MIT licensed; see `vendor/three/LICENSE`.
