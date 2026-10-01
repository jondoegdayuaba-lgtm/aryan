# Powder Line

An endless, relaxing snowboard ride down a huge procedural mountain, tuned to look like a real valley at golden hour. Everything is in one file, `powder-line.html`. three.js is loaded from cdnjs, and every texture, model and sound is generated in code.

**Play:** open `powder-line.html` in a browser (double-click works, no server needed; it needs internet once to fetch three.js). Press **Start riding** or Space.

| Keys | Touch |
| --- | --- |
| A / D or ← / →: carve | ◀ ▶ buttons, or turn on *Tilt to steer* in the menu |
| W or ↑: tuck (go faster) | Tuck |
| S or ↓: brake by sliding sideways | Brake |
| Space: jump (hold for a bigger pop) | Jump (hold) |
| In the air: A / D spin, W / S flip | Same buttons |
| C: switch between chase cam and goggles view | Menu |
| Esc or P: pause and settings, M: mute | Pause button |

Land straight (spins settle onto the nearest 180° if you let go in time) to score the trick; land sideways or upside down and you tumble. Trees and big rocks knock you over too. The HUD shows speed, distance and trick score.

What's inside:

- **Sky:** single-scattering Rayleigh, Mie and ozone atmosphere baked into a sky-view LUT every frame, with a sun, moon and stars, plus a drifting cloud layer. A full day lasts about 6 minutes and lingers in the golden hours. The same LUT colours the fog of every surface, so distant ridges fade into the sky the way they do in photos.
- **Terrain:** one long winding valley: ridged peaks, cliff bands, kickers and rolling bumps. It is built from CDLOD quadtree tiles with geomorphing and skirts. Web workers generate the tiles ahead of you, and tiles behind are recycled. A floating origin keeps precision forever.
- **Snow:** generated normal maps for bumps and wind ripples, macro relief, sun sparkle, and rock on steep faces.
- **Lighting:** PCF sun shadows plus a terrain shadow map, so ridges throw the valley into shade at sunset. Sky lighting comes from a PMREM environment, with ACES tone mapping.
- **Forest:** thousands of instanced spruces with snow on the branches, two levels of detail, and individual fade-out at range.
- **Rider and effects:** the rider is built from primitives with IK legs and arms; it leans, crouches, tucks and grabs. There is a powder spray that grows on hard turns and braking, a carved track, light snowfall, bloom, radial motion blur at speed, and a vignette.
- **Sound:** Web Audio wind, carving crunch, landing thuds and a soft chime for landed tricks.
- **Settings:** the pause menu offers graphics quality (low, medium, high), shadows, volume, camera and tilt steering. Settings are remembered in the browser. Resolution adapts automatically if the frame rate drops.

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
