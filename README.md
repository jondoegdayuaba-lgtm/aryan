# Missile Run

A browser game. You steer a guided missile from a chase camera out of a launch hangar, across a test range and a brick town. Fly through hazard gates and the insides of orange lattice towers, and take out tanks. Each round gives you five missiles.

Everything is plain HTML, CSS and JavaScript with [three.js](https://threejs.org) (bundled in `vendor/three`). There is no build step and no image or sound files: textures are drawn on canvases and sounds are synthesised with the Web Audio API.

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
| Mouse to steer (the pointer locks after you click Launch) | Drag anywhere to steer |
| Hold click, Shift or Space to boost | Hold the Boost button |
| WASD / arrow keys also steer | |
| Esc or P to pause, M to mute | Pause button, top right |

## Scoring

| Action | Points |
| --- | --- |
| Hit a tank | 100 × your streak of consecutive hits |
| Long shot (a hit after flying 600 m) | +50 |
| Fly through a hazard gate | +25 and 2 s of fuel |
| Fly up or down the inside of a lattice tower | +50 |

Orange float rings give the missile an inflatable shield that absorbs one crash. Four extra missile skins unlock as your best score climbs.

## Customise

`js/config.js` holds the game's name, tagline, flight tuning, scoring, map bounds and skins. For example, change `GAME_TITLE` to rename the game; the second word is shown in the accent colour.

| File | What it does |
| --- | --- |
| `js/main.js` | Game loop, rounds, camera, HUD |
| `js/world.js` | The map: hangar, test range, town, towers, gates, trees |
| `js/missile.js` | Missile model, skins, flame, float pods |
| `js/targets.js` | Tanks and shield pickups |
| `js/effects.js` | Low-poly fire, smoke, debris and speed streaks |
| `js/audio.js` | Synthesised wind, engine and explosion sounds |
| `js/input.js` | Mouse, keyboard and touch input |
| `js/textures.js` | Canvas-drawn textures |
| `js/collision.js` | Simple collision shapes |

three.js is MIT licensed; see `vendor/three/LICENSE`.
