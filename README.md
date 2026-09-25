# Browser games

Two 3D games that run in any modern browser. Both are plain HTML, CSS and JavaScript with [three.js](https://threejs.org) (bundled in `vendor/three`), with no image or sound files: everything is generated in code.

- [Ridge Rally](#ridge-rally), in `rally/`: realistic gravel rally driving.
- [Missile Run](#missile-run), at the repo root: guide a missile through gates and towers.

## Ridge Rally

Flat out on gravel through lake forests. Four timed stages on a 4.8 km loop, each at a different time of day, with jumps, crests, hairpins and a water splash. A co-driver reads the pace notes, your best run comes back as a ghost, and every stage ends with a TV-style replay and your place against eleven rival drivers.

What makes it feel real:

- **Car physics**: a rigid body on four suspension struts, simulated 480 times a second. Tyres use a combined-slip model with load sensitivity and different grip on gravel, dirt, grass, sand, rock and water. The engine has a torque curve, turbo lag and a rev limiter; the gearbox, clutch, limited-slip diffs, ABS, traction and stability control are all modelled.
- **The world**: a 2 km × 2 km island with forests, lakes and ridges, generated from noise every time the game loads (the same island every time). The stage road is cut into the hillsides with ditches and embankments.
- **Replays**: runs are stored as the inputs you gave the car. Because the physics is deterministic, playing them back reproduces the run exactly, with trackside cameras, a helicopter, a tracking car and on-board angles.

### Play it

- **From your desktop**: `desktop/ridge-rally.html` is the whole game in one file. Save it and double-click it; it runs offline, except the fonts, which fall back to system fonts without internet.
- **Locally**: serve the repo root with `python3 -m http.server 8000` and open http://localhost:8000/rally/.
- **On a website**: upload `rally/` and `vendor/` side by side to any static host.

### Controls

| Keyboard | Gamepad | Phone |
| --- | --- | --- |
| W / Up: throttle | Right trigger | Gas button |
| S / Down: brake, then reverse | Left trigger | Brake button |
| A D / Left Right: steer | Left stick | Arrow buttons, or tilt (Settings) |
| Space: handbrake | A | Handbrake button |
| C: camera (chase, far, bonnet, bumper) | Y | Camera button |
| R: put the car back on the road | B | Reset button |
| E / Q: gear up / down (manual gearbox) | Bumpers | |
| L: lights, M: mute, T: restart stage | X: lights, Back: restart | |
| Esc / P: pause | Start | Pause button |

### Stages and cars

| Stage | Length | Time of day | Gold |
| --- | --- | --- | --- |
| SS1 Pine Crest | 1.52 km | Misty morning | 1:06.00 |
| SS2 Lakeside Sprint | 1.56 km | Golden hour | 1:02.00 |
| SS3 Midnight Ridge | 1.68 km | Night | 1:12.00 |
| SS4 Grand Loop | 4.81 km | Midday sun | 3:22.00 |

Three cars: the Kestrel R5 (four-wheel-drive turbo hatchback, the easiest to drive fast), the Vantor RS (rear-drive coupe that loves to slide) and the Brute TT (a trophy truck with huge suspension travel). Each has six paint schemes in the garage. Free roam lets you explore the whole island and hunt for 20 hidden stars.

Settings cover graphics quality, driving help (full, some or none), automatic or manual gears, the co-driver (voice, icons or off), km/h or mph, and tilt steering on phones.

### Files

| File | What it does |
| --- | --- |
| `rally/js/main.js` | Game loop, stages, timing, menus, replays |
| `rally/js/vehicle.js` | Car physics: suspension, tyres, engine, gearbox, collisions |
| `rally/js/cars.js` | The three cars' specs and the paint schemes |
| `rally/js/track.js` | Stage route, jumps and crests, stage list and medal times |
| `rally/js/gen.js`, `road.js`, `noise.js` | Island, road and surface generation |
| `rally/js/terrain.js`, `trees.js`, `rocks.js`, `grass.js`, `water.js`, `sky.js` | Rendering the world |
| `rally/js/carmodel.js`, `sdf.js` | Car bodies (signed-distance shapes) and paint |
| `rally/js/camera.js` | Chase and on-board cameras, replay director |
| `rally/js/ai.js` | The robot driver (menu demo) |
| `rally/js/pacenotes.js` | Pace notes and the co-driver's voice |
| `rally/js/replay.js`, `ghost.js` | Replays and ghost cars |
| `rally/js/rivals.js` | The rival drivers' stage times |
| `rally/js/sound.js`, `fx.js` | Synthesised engine and effects, dust, skids |
| `rally/js/config.js` | Title, lighting presets, graphics tiers |

After changing the code, rebuild the one-file versions with `npm install` and `npm run build:desktop`.

## Missile Run

A browser game. You guide a missile out of a launch hangar, across a test range and a brick town. Fly through hazard gates and the insides of orange lattice towers, and take out tanks. Each round gives you five missiles.

### How the flying works

- The camera orbits the missile, and your mouse (or finger) turns the camera, not the missile.
- The missile always steers toward whatever the crosshair is pointing at, so swing the camera and the missile curves after it.
- Hold **Float** to inflate the life jacket. The engine cuts out, the missile coasts to a hover, and when you let go it relights and flies toward the crosshair again. You get 3 seconds of floating per missile, and orange float rings top it back up.
- Fuel lasts 25 seconds (boosting burns it faster). When it runs out, the nose drops and the missile falls.

Everything is plain HTML, CSS and JavaScript with [three.js](https://threejs.org) (bundled in `vendor/three`). There is no build step and no image or sound files: textures are drawn on canvases and sounds are synthesised with the Web Audio API.

### Play it from your desktop

`desktop/missile-run.html` is the whole game in one file. Save it to your desktop and double-click it; it opens in your browser and runs without a web server. It works offline, except the title fonts, which fall back to system fonts without internet.

After changing the code, rebuild that file with:

```sh
npm install
npm run build:desktop
```

### Run it locally

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(`npx http-server` or any other static server works too.)

### Put it on your website

Upload the whole folder as-is (`index.html`, `css/`, `js/`, `vendor/`) to any static host: GitHub Pages, Netlify, Vercel, or your own server. To host it on GitHub Pages from this repo, go to **Settings → Pages**, choose the branch and the `/ (root)` folder, and save.

To embed it in a page you already have:

```html
<iframe src="/missile-run/index.html" style="width:100%;aspect-ratio:16/9;border:0"
        allow="fullscreen; pointer-lock" title="Missile Run"></iframe>
```

### Controls

| Desktop | Phone |
| --- | --- |
| Mouse to aim (the pointer locks after you click Launch) | Drag anywhere to aim |
| Hold click, Shift or Space to boost | Hold the Boost button |
| Hold right-click, F or E to float (life jacket) | Hold the Float button |
| WASD / arrow keys also aim | |
| Esc or P to pause, M to mute | Pause button, top right |

### Scoring

| Action | Points |
| --- | --- |
| Hit a tank | 100 × your streak of consecutive hits |
| Long shot (a hit after flying 600 m) | +50 |
| Fly through a hazard gate | +25 and 2 s of fuel |
| Fly up or down the inside of a lattice tower | +50 |

Four extra missile skins unlock as your best score climbs.

### Customise

`js/config.js` holds the game's name, tagline, flight tuning, scoring, map bounds and skins. For example, change `GAME_TITLE` to rename the game; the second word is shown in the accent colour. In `FLIGHT`, `steer` and `maxTurnRate` set how sharply the missile chases the crosshair, and `cameraDistance` and `crosshairY` set the camera framing.

| File | What it does |
| --- | --- |
| `js/main.js` | Game loop, rounds, camera, HUD |
| `js/world.js` | The map: hangar, test range, town, towers, gates, trees |
| `js/missile.js` | Missile model, skins, flame, life jacket floats |
| `js/targets.js` | Tanks and float-ring pickups |
| `js/effects.js` | Low-poly fire, smoke, debris and speed streaks |
| `js/audio.js` | Synthesised wind, engine and explosion sounds |
| `js/input.js` | Mouse, keyboard and touch input |
| `js/textures.js` | Canvas-drawn textures |
| `js/collision.js` | Simple collision shapes |

three.js is MIT licensed; see `vendor/three/LICENSE`.
