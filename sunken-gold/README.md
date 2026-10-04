# Sunken Gold

A 3D underwater treasure-diving game for the browser. You're a scuba diver with an underwater scooter, diving from a boat over a coral reef. Explore the reef, the wreck of a Spanish galleon, a kelp forest, a stone arch and a 66 m deep trench. Grab doubloons, pearls, chests and five legendary relics, then get back to the boat before your air runs out. Sharks patrol the wreck.

Every 3D model, texture and the whole dive site were built with **Blender**: the scripts in [`blender/`](blender) generate them, and the game draws them with [three.js](https://threejs.org).

## How to play

- Your **air** drains faster the deeper you go. At the surface you breathe for free.
- Loot goes into your **bag**. It only counts once you surface next to the boat and climb aboard to **bank** it. Black out from lack of air and the bag sinks back to the bottom.
- **Bubble vents** (◎ on your compass) top up your air, and **spare tanks** lie around the deeper sites.
- **Sharks** circle, then charge. A bite punctures your hose (you lose air) and makes you drop some loot. Flash your **strobe** at them to scare them off.
- Below about 25 m it gets dark. Your **lamp** lights the way and brings back the colours that the water filters out.
- Spend banked gold on **upgrades** on the boat: a bigger tank, a faster scooter, boost battery, lamp range, strobe recharge and a coin magnet.
- The **captain's log** on the boat tells you roughly where each relic lies. Bank all five to become a Legend of the Deep.

| Desktop | Phone / tablet | Gamepad |
| --- | --- | --- |
| Mouse to look (click to lock the pointer) | Drag on the right to look | Right stick |
| W A S D to swim | Left-thumb joystick | Left stick |
| Space / C to rise / sink | Up / Down buttons | Triggers |
| Shift or left click to boost | Boost button | RB |
| E (hold for chests) to grab | Grab button | A |
| F lamp, Q or right click strobe | Lamp, Strobe buttons | Y, X |
| Esc / P pause, M mute | Pause button | Start |

## Play it

**From your desktop:** [`../desktop/sunken-gold.html`](../desktop/sunken-gold.html) is the whole game in one file (about 14 MB, everything embedded). Save it and double-click it. It runs offline, except the title fonts.

**From this folder:** ES modules and the asset files don't load from `file://`, so serve the repository root and open the game:

```sh
python3 -m http.server 8000      # from the repository root
# then open http://localhost:8000/sunken-gold/
```

**On a website:** run `npm install && npm run build:sunken-gold` and upload `sunken-gold/dist/` to any static host (GitHub Pages, Netlify, your own server).

Add `?q=low` to the URL for the lighter graphics setting (phones pick it automatically) or `?q=high` to force the full one.

## How it's made

### Blender builds the world (`blender/`)

```sh
pip install bpy              # Blender 5 as a Python module (needs Python 3.11)
python sunken-gold/blender/build.py
```

or, with Blender installed: `blender -b -P sunken-gold/blender/build.py`. It takes about 80 seconds and rewrites `assets/`.

| Script | What it builds |
| --- | --- |
| `textures.py` | Tileable PBR textures baked with Cycles from procedural node trees: rippled sand, coral rubble, porous reef rock, silt, ship planks, brain-coral grooves, the sea-fan lattice and the water's normal map |
| `reef.py` | Brain, staghorn and table corals, sea fans, tube and barrel sponges, an anemone, seagrass, kelp, boulders and the rock arch |
| `creatures.py` | Six reef fish species (tang, chromis, sergeant major, clownfish, grouper, barracuda), a blacktip reef shark, a green sea turtle with separate flippers, a spotted eagle ray and a moon jellyfish |
| `wreck.py` | The galleon, plank by plank: a raked bow, high stern castle, a breach in the hull, gunports, ribs, decks, the captain's cabin and snapped masts. Plus cannons, an admiralty anchor and cargo barrels |
| `treasure.py` | Doubloons, a chest with a hinged lid, a giant clam and pearl, amphora, goblet, gold bar, gems, a spare tank and the five relics |
| `gear.py` | The underwater scooter, gloved hands with a dive computer, and the dive boat |
| `seabed.py` | The dive site's height field, the material splat map, every placement (corals, fish schools, treasure, sharks' patrol routes) and ambient occlusion baked with Cycles so things sit in soft contact shadows |
| `build.py` | Runs everything, computes collision distance fields for solid models and exports `models.glb` |
| `preview.py` | Renders contact sheets of models with Cycles, for checking them |

### three.js draws it (`js/`)

| File | What it does |
| --- | --- |
| `main.js` | Game loop, dive rules, boat and shop, HUD, post-processing |
| `ocean.js` | The water: light absorbed per colour channel with depth and distance, scattering haze, animated caustics, Snell's window on the surface, god rays, marine snow, bubbles and the lamp |
| `seabed.js` | Seabed mesh with four blended materials, triplanar rock and baked AO |
| `scenery.js` | Puts the Blender models in the world, instanced and culled in chunks; swaying kelp, seagrass and fans |
| `life.js` | Schooling fish (boids), turtles, rays, jellyfish and shark behaviour |
| `treasure.js` | Coins, clams, chests, artifacts, relics, tanks and vents |
| `player.js` | Swimming, collisions, the view model and the lamp |
| `collide.js` | Collision against the Blender-baked distance fields |
| `audio.js` | Synthesised sound: regulator breathing, bubbles, snapping shrimp, the scooter motor, alarms and shark tension |
| `input.js` | Mouse, keyboard, touch and gamepad |
| `config.js` | Tuning: speeds, air, values, sharks, upgrades and the water's look |

There are no image or sound files beyond what Blender produced: every sound is synthesised with the Web Audio API.

## Customise

Everything you might want to tweak is in `js/config.js`. For example, `AIR.tank` and `AIR.pressureDepth` set how long you can stay down, `UPGRADES` sets prices and levels, `SHARK` sets how dangerous sharks are, and `WATER` sets the water's colour and clarity. To change the dive site itself (where the wreck lies, how deep the trench is, how many corals there are), edit `blender/seabed.py` and rebuild the assets.

three.js is MIT licensed; see `../vendor/three/LICENSE`.
