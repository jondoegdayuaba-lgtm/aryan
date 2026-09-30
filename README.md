# Block Wars

`block-wars.html` is a separate game in this repo: a first-person voxel bed-defence game in one self-contained HTML file. Double-click it to play in your browser. It needs an internet connection the first time, because it loads three.js (r128) from cdnjs. Everything else (blocky textures, models, sounds) is generated in code.

You play Red against three AI teams (Blue, Green, Yellow). In Doubles mode each team has two players and a bot is your teammate. Each team has a floating island with a bed, a generator, an Item Shop and a Team Upgrades NPC. While your bed stands, you respawn 5 seconds after dying. Once it's broken, your next death is a final kill. The last team standing wins.

| Control | Action |
| --- | --- |
| WASD, mouse | Move and look (you sprint automatically when moving forward) |
| Space / Shift | Jump / sneak (sneaking stops you walking off edges) |
| Left click | Hit, or hold to break placed blocks and beds |
| Right click | Place blocks, draw the bow, throw or use items |
| 1–9, mouse wheel | Pick a hotbar slot |
| E | Open the Item Shop or Team Upgrades when standing next to the NPC |
| Esc / P | Pause (sensitivity, field of view, shadows, FPS counter) |

- **Map:** four team islands, four diamond islands on the diagonals, and a middle island with two emerald generators. Map blocks can't be broken, only blocks that players place and the beds.
- **Resources:** team generators drop iron and gold. Diamond generators spawn every 30 s (23 s, then 15 s after upgrades) and emerald generators every 60 s (45 s, then 30 s). Walk over a pile to collect it. When you kill someone, you get their resources.
- **Item Shop:** wool, hardened clay, planks, end stone and obsidian. Stone, iron and diamond swords, and a knockback stick. Chainmail, iron and diamond armor, which you keep when you die. Pickaxe and axe tiers, which drop one tier when you die. Bow and arrows. Golden apple, fireball, TNT, warp pearl and bridge egg.
- **Team Upgrades (diamonds):** Sharpened Swords, Reinforced Armor I–IV, Iron Forge I–IV, Heal Pool and Alarm Trap.
- **Timeline:** Diamond II at 5:00, Emerald II at 10:00, Diamond III at 15:00, Emerald III at 20:00. All beds break at 25:00, and the game ends in a draw at 30:00.
- **Bots:** they collect resources, shop, wall in their bed, bridge across the void, fight (strafing and jump crits), shoot bows, throw fireballs, defend when their trap goes off, and break beds. Difficulty (Easy, Normal or Hard) changes their reaction time, aim, bridging speed and how soon they rush.

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
