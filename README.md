# Canyon Rush and Missile Run

Two 3D browser games made with plain HTML, CSS and JavaScript and [three.js](https://threejs.org) (bundled in `vendor/three`). Neither has a build step or any image or sound files: the worlds, textures and models are generated in code, and every sound is synthesised with the Web Audio API.

## Canyon Rush

A trophy-truck rally through a red-rock desert at golden hour. Race a 4 km loop through a canyon, across a dry lake, over dunes and through an oasis, with 12 checkpoints, big jumps and medal times to beat. Or drive anywhere in free roam.

What's in it:

- **A generated desert you can drive anywhere in, about 2 km across, with terrain running out to the horizon.** Mesas with layered sandstone, buttes, a canyon, dunes, a cracked dry lake and an oasis pond. Terrain detail streams in around you, from 1 m near the truck to 64 m on the skyline.
- **Physically based lighting.** A simulated sky (sun, haze and clouds) lights the scene, and the terrain's soft shadows are computed on the GPU when the game loads. Four times of day: golden hour, morning, midday and sunset.
- **A simulated truck.** Long-travel suspension on each wheel, tyres that grip differently on packed dirt, gravel, sand, the dry lake and in water, a six-speed gearbox and a synthesised V8. Chassis damage is not modelled, so drive it hard.
- **Scenery you can hit.** Saguaros break when you smash through them; boulders, palms and dead trees don't.
- **Dust, tyre tracks, splashes and flying debris.**

### Play it

- **One file:** `desktop/canyon-rush.html` is the whole game. Save it anywhere and double-click it; it runs in your browser without a web server, offline too (the menu fonts fall back to system fonts).
- **From this folder:** serve the repo (`python3 -m http.server 8000`) and open <http://localhost:8000/canyon-rush/>.

The desert is built when the game starts, which takes a few seconds. Graphics quality is picked for your device automatically; change it under **Settings**. Low is meant for phones.

### Controls

| Action | Keyboard | Phone | Gamepad |
| --- | --- | --- | --- |
| Throttle | W / ↑ | Gas | Right trigger |
| Brake, hold to reverse | S / ↓ | Brake | Left trigger |
| Steer | A D / ← → | ◀ ▶ | Left stick |
| Handbrake (slides) | Space | E-brake | A or RB |
| Boost | Shift | Boost | B or LB |
| Change camera | C | | Y |
| Recover the truck | R | Circular-arrow button | Back |
| Look around | Drag with the mouse | Drag on the screen | Right stick |
| Pause | Esc / P | Pause button | Start |
| Mute | M | | |

In the air, throttle lifts the nose and brake drops it. Hold the handbrake in the air to flip and roll with the throttle, brake and steering.

### Rally and medals

Go through the 12 checkpoints in order; the timer shows your split against your best run at each one. Finish under **2:08** for gold, **2:25** for silver and **2:50** for bronze. Your best time is saved in the browser.

Style points come from air time, flips and barrel rolls, clean landings, drifts, splashing through the oasis and smashing cacti. Chaining tricks within four seconds raises the multiplier (up to ×5), and every trick tops up the boost bar.

The garage has four liveries.

### Files

| File | What it does |
| --- | --- |
| `canyon-rush/js/main.js` | Game states, loop, menus, rally flow |
| `canyon-rush/js/world/` | The stage layout, the road route and the terrain generator |
| `canyon-rush/js/render/terrain.js` | Streaming terrain and its desert surface shader |
| `canyon-rush/js/render/atmosphere.js` | Sky simulation, sun, image-based lighting |
| `canyon-rush/js/render/bake.js` | Soft terrain shadows and sky occlusion, baked on the GPU |
| `canyon-rush/js/render/post.js` | HDR, bloom, exposure and tone mapping |
| `canyon-rush/js/render/scatter.js` | Rocks, cacti, scrub, grass and palms |
| `canyon-rush/js/render/effects.js` | Dust, splashes, debris and tyre tracks |
| `canyon-rush/js/render/water.js` | The oasis pond |
| `canyon-rush/js/game/vehicle.js` | Truck physics |
| `canyon-rush/js/game/truck.js` | Truck model and liveries |
| `canyon-rush/js/game/audio.js` | Synthesised engine, gravel, wind and splash sounds |

To change the stage, edit `canyon-rush/js/world/stage.js`: the road's control points, jumps, checkpoints, mesas and buttes all live there. Medal times are in `canyon-rush/js/game/race.js`.

After changing the code, rebuild the one-file versions of both games with:

```sh
npm install
npm run build:desktop
```

## Missile Run

A browser game. You guide a missile out of a launch hangar, across a test range and a brick town. Fly through hazard gates and the insides of orange lattice towers, and take out tanks. Each round gives you five missiles.

### How the flying works

- The camera orbits the missile, and your mouse (or finger) turns the camera, not the missile.
- The missile always steers toward whatever the crosshair is pointing at, so swing the camera and the missile curves after it.
- Hold **Float** to inflate the life jacket. The engine cuts out, the missile coasts to a hover, and when you let go it relights and flies toward the crosshair again. You get 3 seconds of floating per missile, and orange float rings top it back up.
- Fuel lasts 25 seconds (boosting burns it faster). When it runs out, the nose drops and the missile falls.

### Play it from your desktop

`desktop/missile-run.html` is the whole game in one file. Save it to your desktop and double-click it; it opens in your browser and runs without a web server. It works offline, except the title fonts, which fall back to system fonts without internet.

After changing the code, rebuild it with `npm install && npm run build:desktop` (this rebuilds both games).

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
