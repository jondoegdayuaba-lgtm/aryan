# Alpine Descent

A realistic 3D skiing game for the browser: three timed runs on a race mountain, and an **open world**, a whole alpine valley to
explore with chairlifts you can ride. The mountain, forest, sky, skier, buildings, course furniture and the terrain's
light map were all built and lit in **Blender** (see [`blender/`](../blender/README.md)); the game itself is plain JavaScript on
[three.js](https://threejs.org) with a physically scaled lighting pipeline, so what you see is what Blender rendered.

## Play it

* **Desktop file:** save [`desktop/alpine-descent.html`](../desktop/alpine-descent.html) to your desktop and double-click it. It is the
  whole game (code and every model and texture) in one ~41 MB file and runs offline (the open world unpacks when you choose it). It needs a browser with WebGL 2
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
| Tuck (faster) | W or ↑ (hold) | Tuck button |
| Skate / push | Shift (hold) | Push button |
| Brake | S or ↓ | Brake button |
| Jump | hold Space to crouch, release to pop | Jump button |
| Look around / zoom | drag the mouse / wheel (the view eases back) | drag in the upper half |
| Camera | C (chase, far, helmet) | camera button |
| Restart / pause / mute | R / Esc or P / M | on-screen buttons |
| Ride a chairlift (open world) | E next to a lift station; hold Shift on the chair to speed it up | Lift button |
| Map (open world) | Tab | Map button |

A gamepad works too (left stick, triggers, A). The menu also lets you pick the skier (race suit or freerider) and one of six colours.

## The runs

| Run | | What to expect |
| --- | --- | --- |
| **Sunrise Cruiser** | blue, 0.94 km | the open bowl above the tree line, wide checkpoints, learn to carve |
| **Giant Slalom** | red, 0.99 km, 22 gates | thread every gate through the forest; a missed gate costs 3 s |
| **The Long Descent** | black, 2.8 km, 721 m vertical | steep headwall, four jumps, the fastest snow on the mountain; a crash costs 4 s |

Each run has bronze, silver and gold times, split times at the checkpoints, and your best time is remembered in the browser.

## The open world

Choose **Open World** on the title screen. There is no timer and no rule: ski wherever you like.

* **The valley:** a 4.6 km x 4.6 km basin, 1,390 to 3,400 m, with a village (lodge, chalets, chapel, mountain restaurant), a frozen lake,
  83,000 trees, boulder fields, cliffs and named peaks.
* **Nine pistes** in four colours (green, blue, red, black), from a 1.3 km family run to the 3.5 km Grand Descent (744 m vertical),
  groomed with corduroy; snow beside them is slower, deeper powder. A terrain park with six kickers sits on the Sonnenalp piste.
* **Seven chairlifts** that follow the pistes they serve. Stand near a station, press **E**, wait for a chair, hop on, look around,
  and hop off at the top. Hold Shift on the chair to fast-forward.
* **24 flags** to collect (ski through them) and **10 places** to discover (a chapel, the lake, the Kessel amphitheatre, the summit cross...).
  A compass at the top of the screen points to the nearest flag and the minimap shows the pistes, lifts and what you have found.
* **Tab** opens the full map, with fast travel to the village and every lift station. Your progress is saved in the browser.
* Crash into a tree, rock or building and you are put back on your feet at the last safe spot. **R** does the same on demand.

## The runs

| Run | | What to expect |
| --- | --- | --- |
| **Sunrise Cruiser** | blue, 0.94 km | the open bowl above the tree line, wide checkpoints, learn to carve |
| **Giant Slalom** | red, 0.99 km, 22 gates | thread every gate through the forest; a missed gate costs 3 s |
| **The Long Descent** | black, 2.8 km, 721 m vertical | steep headwall, four jumps, the fastest snow on the mountain; a crash costs 4 s |

Each run has bronze, silver and gold times, split times at the checkpoints, and your best time is remembered in the browser.

## How it feels

* Point-mass ski physics with real gravity (a little boosted for arcade speed: 180 km/h is reachable on the long descents), air drag
  (tucking halves the drag area), snow friction, edge grip that limits how hard you can turn, skidding, hockey stops, jumps, hard
  landings and crashes. The physics runs at a fixed 120 Hz and the picture is interpolated between steps, so it is smooth at any frame rate.
* The camera follows the skier's own motion instead of chasing a world position, so it stays steady at any speed: no roll, no shake.
* The world is a height field sampled with bicubic interpolation, so the skis follow the same surface the renderer draws.
* Groomed corduroy, sparkling snow, wind-packed drifts, trees in four species, boulders with snow caps, gates that swing when you
  brush them, banners in the wind, a working chairlift, snow spray and ski tracks.

## Graphics options

`Graphics` in the menu: Auto, Low, Medium, High, Ultra. The game also lowers its render resolution when the frame rate drops.
Useful URL parameters for testing: `?q=ultra`, `?run=gs&autoplay=1` (let the autopilot race), `?exp=1.1` (exposure), `?open=1&ox=0&oz=1700` (start in the open world at a position).

## Code

| File | What it does |
| --- | --- |
| `js/main.js`, `js/game.js` | boot, scene, game loop, screens |
| `js/world-data.js` | height field, piste paths, groom raster, tree / boulder / building colliders (also used by the Node tests) |
| `js/physics.js`, `js/course.js`, `js/session.js`, `js/ai.js` | ski physics, gates and timing, a race attempt, the autopilot |
| `js/terrain-render.js` | chunked LOD terrain with vertex-texture displacement, snow and rock shading, corduroy |
| `js/shader-patches.js` | height-aware fog, baked light-map hook shared by every material |
| `js/vegetation.js`, `js/rocks.js`, `js/props.js`, `js/props-kit.js` | trees (five LODs), boulders, gates / banners / nets / lodge, shared prop helpers |
| `js/open-world.js`, `js/open-props.js`, `js/chairlift.js`, `js/map-ui.js` | the open-world mode (free session, lifts, flags, places), its village and lifts, the rideable chairlift, minimap / map / compass |
| `js/skier-rig.js`, `js/camera.js` | the skinned skier posed by the physics, chase / far / helmet cameras |
| `js/postfx.js`, `js/effects.js`, `js/sky.js` | HDR post-processing, snow spray and tracks, sky and image-based light |
| `js/audio.js`, `js/input.js`, `js/ui.js` | synthesised sound, keyboard / touch / gamepad, menus and HUD |

Tests without a browser: `node tools/ski-sim.mjs all` lets the autopilot race every run and prints the times,
`node tools/open-sim.mjs all` skis every piste of the open world; `npm run build:ski` rebuilds `desktop/alpine-descent.html`.

three.js is MIT licensed; see `vendor/three/LICENSE`.
