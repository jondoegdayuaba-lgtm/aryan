# Outbuild

An original island battle royale for the browser. You drop from an airship with 29 bots, grab weapons from chests and the floor, harvest wood, stone and metal, build walls, ramps and roofs, and try to be the last one standing while the storm shrinks the island.

Everything here is original: the characters, weapons, map, place names, models, textures, sounds and music. It is not affiliated with any other game.

- **Models:** made with Blender's Python API (`blender/`) and exported as GLB.
- **Rendering:** [three.js](https://threejs.org) with ACES tone mapping, sun shadows, bloom and SMAA. The Epic setting adds ambient occlusion.
- **Sound:** synthesised live with the Web Audio API. There are no audio files.

## Play

Serve the repository root with any static server, then open `/outbuild/` (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000/outbuild/
```

Or open `desktop/outbuild.html`. It is the whole game in one file (about 11 MB) and runs by double-clicking it. Rebuild it with `npm install && npm run build:outbuild`.

A mouse and keyboard are needed. Click the game to lock the pointer.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** | Move |
| **Mouse** | Look |
| **Left click** | Shoot, swing, use, or place a build |
| **Right click** | Aim down sights (the sniper has a scope) |
| **Space** | Jump; leave the airship; open the glider |
| **Shift** | Sprint |
| **Ctrl** | Crouch |
| **1** | Harvesting tool |
| **2 – 6** | Inventory slots (the mouse wheel cycles) |
| **E** | Pick up or open |
| **G** | Drop the held item |
| **R** | Reload; in build mode, change material |
| **Q** | Toggle build mode |
| **Z / X / C / V** | Wall / floor / ramp / roof (also enters build mode) |
| **M** or **Tab** | Map |
| **B** | Dance |
| **Esc** | Pause |

## How a match goes

1. **Drop.** The airship crosses the island on a random line. Jump with Space. Look down while holding W to dive faster. The glider opens by itself near the ground, or earlier with Space.
2. **Loot.** Golden chests hum and glow. They hold a weapon, ammo, a heal or a second weapon, and materials. Ammo boxes and floor loot are everywhere. Rarity runs from Common (grey) to Uncommon (green), Rare (blue), Epic (purple) and Legendary (gold); rarer weapons hit harder and reload faster.
3. **Harvest and build.** Hit trees, rocks, cars and house walls with the harvesting tool for materials, and aim for the glowing blue spot for a bonus. Each piece costs 10 materials:

   | Material | Hit points | Build time |
   | --- | --- | --- |
   | Wood | 150 | 3 s |
   | Stone | 300 | 7 s |
   | Metal | 500 | 12 s |

   Pieces start weak and grow to full strength while they build. Anything no longer connected to the ground collapses.
4. **The storm.** It forms about 50 s after take-off and then shrinks in seven phases. Stay inside the white circle on the map; the storm hurts more each phase. Supply drops float down under balloons in the middle phases and carry epic and legendary loot.
5. **Win.** Be the last one standing.

**Weapons:** Sidearm, Swift SMG, Assault Rifle, Pump Shotgun, Combat Shotgun, Bolt Sniper (bullet drop) and Rocket Launcher.

**Items:** grenades, Bandage Rolls and Med Kits (health), and Shield Flasks and Shield Jugs (shield).

## Settings

The Settings menu has these options:

- **Graphics:** Low, Medium, High or Epic. Use Medium or Low on laptops with integrated graphics.
- **Time of day:** midday, golden hour, sunset, or random.
- **Controls:** mouse sensitivity, field of view and inverted Y.
- **Sound:** volume and menu music.
- **Match:** size (5–50 players) and bot skill.

Settings, outfit and your career stats are saved in the browser.

For testing you can add URL options, for example `?q=low&time=sunset&bots=10`.

## Rebuild the assets with Blender

Every model and texture comes from the scripts in `blender/`:

```sh
python3.11 -m venv blenv && blenv/bin/pip install bpy==4.5.3 pillow
blenv/bin/python outbuild/blender/build_all.py
```

| Script | Makes |
| --- | --- |
| `characters.py` | The rigged character (19 bones) and every outfit part: hair styles, hats, helmet, hood, masks, vest, jacket, backpack and cape. |
| `pieces.py` | Build pieces in wood, stone and metal, plus the houses' walls, windows, doors, floors, roofs and stairs. |
| `props.py` | Trees, rocks, bushes, cars, containers, fences, crates, hay, the windmill, water tower and radio mast. |
| `gear.py` | Weapons, the harvesting tool, grenade, rocket, chests, ammo boxes, supply drop, heals, ammo, the airship and the glider. |
| `textures.py` | The tileable textures and normal maps (numpy): planks, stone, metal, brick, siding, shingles, grass, dirt, rock, sand and more. |
| `common.py` | Shared helpers: mesh building, UVs, baked vertex ambient occlusion, GLB export and Cycles preview renders. |

The game swaps materials by name for its own shaders, which add triplanar texturing, wind sway and baked AO. Custom properties on the Blender objects (`col`, `hp`, `mat`) become collision shapes and hit points in the game.

## Code map

| File | What it does |
| --- | --- |
| `js/main.js` | Game orchestration: loading, lobby, match flow, events, supply drops |
| `js/renderer.js` | Renderer, sky with clouds, sun and shadows, fog, post-processing, quality presets |
| `js/terrain.js` | Island heightmap, towns flattened to the build grid, roads, splat-blended terrain shader, chunk LOD |
| `js/water.js`, `js/grass.js` | Sea shader (depth colour, foam, sun glints); instanced grass that follows the camera |
| `js/world.js`, `js/layout.js` | Town, farm, factory, harbour, cabin and beach layouts, forests, loot spots |
| `js/pieces.js`, `js/building.js` | Grid building: instanced pieces, build-up, damage, collapse, aiming and placement |
| `js/physics.js` | Spatial hash, character movement against boxes, ramps, roofs and trees, raycasts |
| `js/character.js` | Outfits merged into one skinned mesh, procedural animation, two-bone arm IK |
| `js/actor.js`, `js/player.js`, `js/camera.js` | Shared player/bot logic, keyboard and mouse control, third-person camera |
| `js/bots.js` | Bot AI: drop planning, looting through doors and stairs, storm rotation, fighting, building cover |
| `js/combat.js`, `js/items.js` | Weapons, projectiles, explosions, harvesting; items, loot tables, inventory, pickups and chests |
| `js/storm.js`, `js/airship.js` | The storm circle and wall; the drop airship |
| `js/hud.js`, `js/ui.js` | HUD, minimap and full map, item icons rendered from the models; menus and end screens |
| `js/audio.js`, `js/effects.js` | Synthesised sound and music; particles, debris, tracers, explosions |

three.js is MIT licensed (`../vendor/three/LICENSE`).
