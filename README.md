# Canyon Rush and Missile Run

Two 3D browser games made with plain HTML, CSS and JavaScript and [three.js](https://threejs.org) (bundled in `vendor/three`). Neither needs a build step to run, and neither has any image or sound files: the worlds and textures are generated in code, and every sound is synthesised with the Web Audio API. Most models are built in code too; Canyon Rush's rider is modelled in [Blender](https://www.blender.org) by a script (see below).

## Canyon Rush

An e-bike rally through a red-rock desert at golden hour. Pick one of three electric dirt bikes and race a 4 km loop through a canyon, across a dry lake, over dunes and through an oasis. Pull wheelies, throw tricks and backflips off the jumps, or see how far you can ride on the back wheel in the wheelie challenge.

What's in it:

- **Three e-bikes.** The Volt LX is light and the easiest to wheelie, the Sting R is quicker everywhere, and the Storm MX is a full-size electric motocross bike: the fastest, and the hardest to hold up.
- **Real wheelie physics.** Each bike has a balance point, the angle where its weight sits right over the back axle. Hold a wheelie with the throttle and the rear brake. Go past the balance point and you loop out.
- **A simulated bike.** Long-travel suspension on both wheels, a motor with full torque from a standstill, and tyres that grip differently on packed dirt, gravel, sand, the dry lake and in water. The bike leans into turns, and the rider stands up over jumps, hangs back in wheelies and gets thrown clear in a crash.
- **Fifteen jumps and five freestyle tricks.** Tabletops with a steep face, a flat top and a long landing give one to two and a half seconds of air. Up there the rider can throw a Superman, No Hander, Heel Clicker, Nac-Nac or Can-Can, on top of backflips and 360s.
- **A generated desert you can ride anywhere in, about 2 km across, with terrain running out to the horizon.** Mesas with layered sandstone, buttes, a canyon, dunes, a cracked dry lake and an oasis pond. Terrain detail streams in around you, from 1 m near the bike to 64 m on the skyline.
- **Physically based lighting.** A simulated sky (sun, haze and clouds) lights the scene, and the terrain's soft shadows are computed on the GPU when the game loads. Four times of day: golden hour, morning, midday and sunset.
- **Dust, dirt flung off the back tyre, tyre tracks, splashes, and cacti that break when you ride through them.**

### Play it

- **One file:** `desktop/canyon-rush.html` is the whole game. Save it anywhere and double-click it; it runs in your browser without a web server, offline too (the menu fonts fall back to system fonts).
- **From this folder:** serve the repo (`python3 -m http.server 8000`) and open <http://localhost:8000/canyon-rush/>.

The desert is built when the game starts, which takes a few seconds. Graphics quality is picked for your device automatically; change it under **Settings**. Low is meant for phones.

On graphics chips that can't run the full lighting pipeline, the game switches to a simpler **compatible graphics** mode by itself (it also checks that the first frames aren't black). You can turn it on by hand under **Settings** too.

### Controls

| Action | Keyboard | Phone | Gamepad |
| --- | --- | --- | --- |
| Throttle | W / ↑ | Gas | Right trigger |
| Brake | S / ↓ | Brake | Left trigger |
| Steer | A D / ← → | ◀ ▶ | Left stick |
| Wheelie (hold) | Space | Wheelie | A or RB |
| Boost | Shift | Boost | B or LB |
| Trick (hold, in the air) | Q Superman, E No Hander, F Heel Clicker, G Nac-Nac, X Can-Can (or 1 to 5) | Trick (each press does the next trick) | X, or the D-pad |
| Change camera (chase, wide, helmet, front) | C | | Y |
| Back on the road | R | Circular-arrow button | Back |
| Look around | Drag with the mouse | Drag on the screen | Right stick |
| Pause | Esc / P | Pause button | Start |
| Mute | M | | |

**Wheelies:** hold Space to pull the front up. While it's up, throttle lifts it higher and the brake brings it down. Keep the needle on the wheelie meter in the green, near the balance point, for bonus points. Let go of Space to set the front down. Boosting in a wheelie is the quickest way to loop out.

**In the air:** hold Space for a backflip, hold A or D to turn the bike, all the way round for a 360. Let go and the rider lines the bike up for landing. Land upside down or sideways and you crash.

**Tricks:** hold a trick button in the air and the rider stretches out into it; the longer you hold it, the more it's worth. Let go in time to get back on the bike: still stretched out when the wheels touch down and you bail. The trick's name turns red with a **Let go!** warning just before landing. Tricks only start on jumps with enough air to finish them, and you can mix them with a backflip or a 360 in the same jump.

Brake while steering at speed to slide the back out. Hold the brake at a standstill to walk the bike backwards.

### Modes and medals

- **Rally:** go through the 12 checkpoints in order; the timer shows your split against your best run at each one. Each bike has its own medal times: gold is 2:45 on the Volt, 2:29 on the Sting and 2:18 on the Storm.
- **Wheelie challenge:** start on the dry lake and wheelie as far as you can. Bronze at 100 m, silver at 250 m, gold at 500 m.
- **Free ride:** the whole desert, no clock.

Style points come from wheelies, air time, tricks, backflips, 360s, clean landings, slides, splashing through the oasis and smashing cacti. Everything done in one jump pays out together when you land, and nothing if you crash. Chaining tricks within four seconds raises the multiplier (up to ×5), and every trick tops up the boost bar. A crash resets the multiplier. Best laps and longest wheelies are saved in the browser, per bike.

### Files

| File | What it does |
| --- | --- |
| `canyon-rush/js/main.js` | Game states, loop, menus, garage, rally and wheelie challenge |
| `canyon-rush/js/game/bike.js` | E-bike physics: suspension, motor, tyres, wheelies, air control, crashes; the three bikes' specs |
| `canyon-rush/js/game/bikemodel.js` | The bikes' 3D models and colours |
| `canyon-rush/js/game/rider.js` | The rider, posed with IK on the Blender model's skeleton |
| `canyon-rush/js/game/models.js` | Loads the Blender models |
| `canyon-rush/models/` | The Blender models, as glTF (`.glb`) files |
| `tools/blender/rider.py` | Builds the rider in Blender and exports `rider.glb` |
| `canyon-rush/js/game/stunts.js` | Style points |
| `canyon-rush/js/game/tricks.js` | The freestyle tricks: names, buttons, points and timing |
| `canyon-rush/js/world/` | The stage layout, the road route and the terrain generator |
| `canyon-rush/js/render/terrain.js` | Streaming terrain and its desert surface shader |
| `canyon-rush/js/render/atmosphere.js` | Sky simulation, sun, image-based lighting |
| `canyon-rush/js/render/bake.js` | Soft terrain shadows and sky occlusion, baked on the GPU |
| `canyon-rush/js/render/post.js` | HDR, bloom, exposure and tone mapping |
| `canyon-rush/js/render/scatter.js` | Rocks, cacti, scrub, grass and palms |
| `canyon-rush/js/render/effects.js` | Dust, roost, splashes, debris and tyre tracks |
| `canyon-rush/js/render/water.js` | The oasis pond |
| `canyon-rush/js/game/audio.js` | Synthesised motor, chain, tyres, wind and crash sounds |

To change the stage, edit `canyon-rush/js/world/stage.js`: the road's control points, jumps, checkpoints, mesas and buttes all live there. Medal times are in `canyon-rush/js/game/race.js`; bike power, weight and wheelie handling are in `canyon-rush/js/game/bike.js`.

After changing the code, rebuild the one-file versions of both games with:

```sh
npm install
npm run build:desktop
```

The rider is made by a Blender script: a body grown over a skeleton with Blender's Skin modifier and smoothed, then weighted to an armature so it bends at the joints, in motocross kit with a helmet, goggles, neck brace and buckled boots. To change it, edit `tools/blender/rider.py` and run it with Blender's Python module (Python 3.11), or inside Blender, then rebuild the one-file game:

```sh
pip install bpy==4.2.0
python tools/blender/rider.py                       # writes canyon-rush/models/rider.glb
python tools/blender/rider.py --preview /tmp/rider  # also renders /tmp/rider_front.png etc.
blender -b -P tools/blender/rider.py                # the same, from an installed Blender
```

Open `canyon-rush/models/rider.glb` in Blender (File → Import → glTF) to look at it or edit it by hand. The material names (jersey, jersey2, pants, boots, gloves, helmet, helmet2, lens, dark) are how the game recolours the rider for each bike.

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
