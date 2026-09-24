# Browser games

Two games that run in any modern browser, on desktop or phone. Both are plain HTML, CSS and JavaScript with no build step.

| Game | File | What you do |
| --- | --- | --- |
| **Jelly Jar** | `jelly-jar/index.html` | Drop jellies into a jar and squish matching ones together into bigger ones. |
| **Missile Run** | `index.html` | Steer a guided missile through a test range and a brick town. |

## Jelly Jar

A drop-and-merge physics puzzle. Jellies with faces fall from a dropper into a glass jar. When two of the same kind touch, they squish into the next size up, and chain reactions climb a musical scale. Keep the jar under the MAX line: if jellies rest above it for 3 seconds, the jar overflows and the game ends.

There are 11 jellies to find, each with its own face:

Pip → Bean → Gumdrop → Jujube → Pudding → Mochi → Wobbles → Blobert → Chonk → Opal → Jelly King

The dropper only hands out the first five. Everything bigger has to be merged, and two Jelly Kings burst in a royal pop.

### Controls

| Desktop | Phone |
| --- | --- |
| Move the mouse, or use ← → (A / D), to aim | Drag left and right to aim |
| Click, Space or ↓ to drop | Let go to drop (a quick tap works too) |
| Esc or P to pause, M to mute | Pause button, top right |

### Scoring

| Action | Points |
| --- | --- |
| Make a Bean, Gumdrop, Jujube, Pudding, Mochi, Wobbles, Blobert, Chonk, Opal or Jelly King | 10, 30, 60, 100, 150, 210, 280, 360, 450, 550 |
| Merge again within 0.8 s (a chain) | × the chain count |
| Royal pop (two Jelly Kings) | 1,500 × the chain count |

The game remembers your best score, which jellies you have found, the sound setting and a game in progress (in the browser's local storage), so a visitor can close the tab and come back to **Continue**.

### Put it on your website

`jelly-jar/index.html` is the whole game in one file: the physics, the drawing and the sounds are all built in, so there are no images or other files to copy. Upload that file (renamed however you like) to any static host, or open it straight from your desktop with a double-click. The rounded fonts come from Google Fonts and fall back to system fonts when offline.

To embed it in a page you already have:

```html
<iframe src="/jelly-jar/index.html" style="width:100%;max-width:480px;aspect-ratio:9/16;border:0"
        title="Jelly Jar"></iframe>
```

The game fits whatever box it is given: a tall box gets the phone layout, and a wide one moves the score and the jelly list to the sides of the jar.

### Customise

The settings are at the top of the script in `jelly-jar/index.html`:

- `KINDS` lists the 11 jellies: name, size, colours, face and the line shown when you find one.
- `SPAWN_WEIGHTS` sets how often the dropper hands out each of the first five jellies.
- `GRAVITY`, `BOUNCE` and `FRICTION` change how the jellies fall and settle; `OVERFLOW_TIME` is how long jellies may sit above the MAX line.
- `W` and `H` are the size of the jar, and `COOLDOWN` is the wait between drops.

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
