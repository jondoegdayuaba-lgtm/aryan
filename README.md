# Missile Run

A browser game. You guide a missile out of a launch hangar, across a test range and a brick town. Fly through hazard gates and the insides of orange lattice towers, and take out tanks. Each round gives you five missiles.

## Also in this repo: Blockwild

`blockwild/` is a second game: a blocky sandbox you explore, dig and build in. It has its own name, logo and code-drawn textures, so it's an original game that plays like the block-building games you know.

- Endless generated terrain with plains, forests, pink cherry-blossom groves, beaches, lakes and snowy mountain peaks
- **Survival**: hold left-click to mine (blocks crack and drop items you pick up), right-click to place, 10 hearts and a hunger bar, fall damage, apples from oak leaves, and a crafting list in the inventory (E)
- **Creative**: unlimited blocks, instant breaking, a block palette in the inventory, and flying (double-tap Space)
- Day and night cycle, drifting clouds, smooth block shading, a hotbar with 1-9 and the mouse wheel, F3 debug info, and saving to the browser
- Phone controls: a move stick, drag to look, tap to place, press and hold to break

Play it at `blockwild/index.html` (served the same way as below), or save `desktop/blockwild.html` to your desktop and double-click it. `npm run build:desktop` rebuilds both one-file games.

| File | What it does |
| --- | --- |
| `blockwild/js/main.js` | Game loop, sky, hand, inventory, HUD, menus and input |
| `blockwild/js/world.js` | Chunks, terrain and trees, meshing, ray casting |
| `blockwild/js/blocks.js` | Block list, pixel textures, icons and crack overlays |
| `blockwild/js/player.js` | Walking, jumping, swimming, flying and collisions |
| `blockwild/js/noise.js` | Seeded noise for terrain |
| `blockwild/js/audio.js` | Synthesised dig, place, step and hurt sounds |

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
