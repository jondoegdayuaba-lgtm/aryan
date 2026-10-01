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

---

# Breach Point

`breach-point.html` is a second game in this repo: a 5v5 tactical bomb-defusal shooter in one self-contained HTML file. You play with four bots against five bots on Sandline, an original desert-town map. It uses three.js r128 from cdnjs. Open the file in a browser (double-click works) and press **Play**.

- **Teams:** Strikers plant the bomb on site A or B. Wardens defend and defuse. First to 13 rounds wins, and sides swap after round 12.
- **Rounds:** 12 s freeze time, 20 s buy time, 1:55 round timer. The bomb takes 3 s to plant and goes off after 40 s. Defusing takes 10 s, or 5 s with a kit.
- **Economy:** you start with $800, money is capped at $16,000, kill rewards depend on the weapon, the loss bonus grows with each round lost, and there is a plant bonus.
- **Weapons:** G-9 and P-12 pistols, Hawk .50, Vex-9 SMG, Breacher-12 shotgun, AR-K7 and M-4R rifles, Longshot sniper, Talon Knife. Each gun has its own recoil pattern, headshots multiply damage, armor reduces it, and bullets go through wooden walls and crates.
- **Utility:** smoke, flashbang, HE grenade, and firebomb/incendiary. Left click throws far, right click throws short.
- **Bots:** Easy, Normal or Hard. They buy, split between sites, hold angles, use utility, rotate, plant, retake and defuse.

Controls: WASD, mouse, Shift walk, Ctrl or C crouch, Space jump, R reload, 1–5 / wheel / Q weapons, G drop, E use / plant / defuse, B buy, Tab scoreboard, Esc pause.

The characters, weapons and props (crates, barrels, cars, palms, doors, windows, awnings, lamps, plants) were modelled in Blender with the script `breach-point/models.py`. They are embedded in the HTML as a GLB. To change them:

```sh
pip install bpy==4.2.0            # Blender as a Python module (Python 3.11)
python breach-point/models.py breach-point/models.glb
python breach-point/embed_models.py breach-point/models.glb
```
