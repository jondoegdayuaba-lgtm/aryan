# Last Signal

A first-person survival adventure in a browser. Your bush plane went down on a wooded slope in the Kestrel Valley at the end of a golden afternoon. A storm is coming, the radio is dead, and the only long-range set is in a ranger cabin across the creek. Find a battery and an antenna, call for help, then hold out until a rescue helicopter finds your signal fire in the storm.

It aims to look and feel realistic: a 2 km valley with a lake, a creek in a gorge, thousands of instanced trees, wildflower meadows, a day/night cycle with a moon and stars, and a storm with rain and lightning. Cold, hunger, thirst, wetness and dirty water are real problems, and fire, shelter and a flashlight are the tools.

**Play it:** `desktop/last-signal.html` is the whole game in one file (about 4 MB). Save it and double-click it; it runs offline. To run the folder instead, serve the repo (ES modules do not load from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/last-signal/
```

Best on a desktop GPU with headphones. It picks a graphics tier for you and lowers the render resolution if the frame rate drops; **Settings** lets you choose Low, Medium or High.

## Controls

| Key | Action |
| --- | --- |
| W A S D, mouse | Move, look (click the game to capture the mouse, Esc to release) |
| Shift / C / Space | Run / crouch / jump (and swim up) |
| E or click | Use, pick up, climb, drink (hold) |
| Q | Fill the bottle at water, boil water at a fire |
| F | Flashlight |
| G | Build a campfire (3 firewood and a match) |
| R (hold) | Rest by a fire, in the cabin or in the tent: time passes faster |
| Tab / M / J | Backpack / map / journal |
| P | Photo mode (hides the HUD) |

On a phone or tablet, drag the left half of the screen to move and the right half to look; buttons appear on screen.

## How a run goes

1. Search your backpack in the wreckage.
2. Climb Ridgeback Lookout for its spare antenna.
3. Find a truck battery at Halloran Mine (dusk is falling, keep to the trail).
4. Cross the creek bridge (two planks are missing) to Ranger Cabin and call for help.
5. Light the signal fire on Sunday Meadow in the storm, fire a flare, and get aboard.

Eight notes, a summit cache and a few surprises are scattered around the valley. Dying is not the end: you wake at your last camp.

## How it is built

- **Engine:** vanilla ES modules and the bundled [three.js](https://threejs.org) r186, no build step. Textures are drawn on canvases and every sound is synthesised with Web Audio, so the only binary assets are the models.
- **Models:** the plane, cabin, tower, bridge, camp, mine, helicopter, props, trees and rocks were made in Blender by scripts in `tools/blender/` and exported to `last-signal/models/*.glb`. They carry geometry, UVs and baked ambient-occlusion vertex colours; materials are picked by name and textured procedurally in the game. To regenerate them: `pip install bpy==5.0.1` then `cd tools/blender && python3 build_flora.py && python3 build_wreck.py && python3 build_structures.py && python3 build_props.py && python3 build_heli.py`.
- **Rendering:** a height-map world generator (`js/world.js`, also runs under Node), chunked terrain with level of detail, a sun-aware height fog patched into three's shaders, cascaded sun shadows (three's `SunLight` addon), planar-reflection water, GPU-driven grass, and an HDR post pass with bloom and filmic tone mapping.

To rebuild the one-file version after changing the code:

```sh
npm install
npm run build:last-signal
```

| File | What it does |
| --- | --- |
| `js/main.js` | Boot, render loop, quality scaling |
| `js/play.js` | Gameplay: interactions, items, story, saving, menus, ending |
| `js/world.js`, `terrain.js`, `water.js`, `sky.js`, `atmosphere.js`, `post.js` | The world and how it is drawn |
| `js/flora.js`, `grass.js`, `structures.js`, `content.js` | Trees, grass, buildings and where they go |
| `js/player.js`, `physics.js`, `input.js` | Walking, collision, controls |
| `js/survival.js`, `fire.js`, `weather.js`, `heli.js` | Vitals, fire and light, the storm, the rescue |
| `js/audio.js`, `map.js`, `hud.js`, `story.js`, `items.js` | Sound, the paper map, interface, notes, inventory |

three.js is MIT licensed; see `vendor/three/LICENSE`.

---

# Missile Run

A browser game. You guide a missile out of a launch hangar, across a test range and a brick town. Fly through hazard gates and the insides of orange lattice towers, and take out tanks. Each round gives you five missiles.

## How the flying works

- The camera orbits the missile, and your mouse (or finger) turns the camera, not the missile.
- The missile always steers toward whatever the crosshair is pointing at, so swing the camera and the missile curves after it.
- Hold **Float** to inflate the life jacket. The engine cuts out, the missile coasts to a hover, and when you let go it relights and flies toward the crosshair again. You get 3 seconds of floating per missile, and orange float rings top it back up.
- Fuel lasts 25 seconds (boosting burns it faster). When it runs out, the nose drops and the missile falls.

Everything is plain HTML, CSS and JavaScript with [three.js](https://threejs.org) (bundled in `vendor/three`). There is no build step and no image or sound files: textures are drawn on canvases and sounds are synthesised with the Web Audio API.

## Play it from your desktop

`desktop/missile-run.html` is the whole game in one file. Save it to your desktop and double-click it; it opens in your browser and runs without a web server. It works offline, except the title fonts, which fall back to system fonts without internet.

After changing the code, rebuild that file with:

```sh
npm install
npm run build:desktop
```

## Run it locally

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(`npx http-server` or any other static server works too.)

## Put it on your website

Upload the whole folder as-is (`index.html`, `css/`, `js/`, `vendor/`) to any static host: GitHub Pages, Netlify, Vercel, or your own server. To host it on GitHub Pages from this repo, go to **Settings → Pages**, choose the branch and the `/ (root)` folder, and save.

To embed it in a page you already have:

```html
<iframe src="/missile-run/index.html" style="width:100%;aspect-ratio:16/9;border:0"
        allow="fullscreen; pointer-lock" title="Missile Run"></iframe>
```

## Controls

| Desktop | Phone |
| --- | --- |
| Mouse to aim (the pointer locks after you click Launch) | Drag anywhere to aim |
| Hold click, Shift or Space to boost | Hold the Boost button |
| Hold right-click, F or E to float (life jacket) | Hold the Float button |
| WASD / arrow keys also aim | |
| Esc or P to pause, M to mute | Pause button, top right |

## Scoring

| Action | Points |
| --- | --- |
| Hit a tank | 100 × your streak of consecutive hits |
| Long shot (a hit after flying 600 m) | +50 |
| Fly through a hazard gate | +25 and 2 s of fuel |
| Fly up or down the inside of a lattice tower | +50 |

Four extra missile skins unlock as your best score climbs.

## Customise

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
