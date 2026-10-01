# Outbuild

An original island battle royale for the browser. You drop from an airship with 29 bots (or with your friends online), grab weapons from chests and the floor, harvest wood, stone and metal, build walls, ramps and roofs, and try to be the last one standing while the storm shrinks the island.

Everything here is original: the characters, weapons, map, place names, models, textures, sounds and music. It is not affiliated with any other game.

- **Models and animations:** made with Blender's Python API (`blender/`) and exported as GLB. Character clips (idle, walk, run, sprint, crouch, jump, fall, skydive, glide, death, dance, pickaxe swing, throw) are keyframed on the rig; guns have moving magazines, bolts, slides and pumps with keyframed Fire and Reload clips.
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

## Maps

Pick a map on the right of the lobby:

- **Island Royale:** the full island. Drop from the airship with up to 49 others, loot, build and outlast everyone while the storm closes in.
- **Duel Grounds:** a small arena island for 1v1. Everyone spawns on the ground with an assault rifle, a pump shotgun, an SMG, heals, shields and materials. A 3-second countdown starts the fight, and a faster storm keeps it short. Solo, you face one bot; online, the host's friends all join the duel.

## Level and challenges

Each match earns XP for eliminations, survival time and placement. Every day brings three new challenges (open chests, build structures, win a duel and so on) worth bonus XP. Your season level, XP and challenges show on the lobby's left; everything is saved in your browser.

## Play with friends

Online play is peer-to-peer (WebRTC through [PeerJS](https://peerjs.com)). There is no game server to run.

1. One player clicks **Play with friends → Host a room** and shares the 5-letter room code.
2. Everyone else types the code under **Play with friends** and clicks **Join**. Up to 16 players can be in a room.
3. The host clicks **Start match**. Bots fill the rest of the match size set in Settings.

The host picks the map. Friends show up next to you in the lobby. The host's computer runs the match: bots, loot, the storm, damage and builds. Each player's own movement runs on their own computer, so moving feels instant, and shots and builds take one trip to the host. The player with the fastest computer and connection should host.

Notes:

- Rooms are found through the free public PeerJS server, so you need an internet connection. For a LAN or a private server, run `npx peerjs --port 9000` and open the game with `?peer=your-server:9000` on every computer.
- Some strict company or school networks block peer-to-peer connections. If joining keeps timing out, try another network.
- Opening the menu with Esc does not pause an online match. If the host leaves, the match ends for everyone.
- Each player can use either version: `desktop/outbuild.html` or the served `/outbuild/` page.

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
| **F** | Edit your own build: click or drag tiles on the grid to cut them out (walls 3×3, floors 2×2) or click a ramp edge to turn it; **F** again confirms, **R** resets |
| **M** or **Tab** | Map |
| **B** | Dance |
| **Esc** | Pause (online: menu; the match keeps going) |

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
| `animations.py` | The character's keyframed clips, one NLA track each, exported inside `character.glb`. |
| `gun_anims.py` | Fire and Reload clips on the guns' moving parts and on the left-hand grip point, exported inside `weapons.glb`. |
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
| `js/duel.js`, `js/progress.js` | The Duel Grounds arena; season level, XP and daily challenges |
| `js/net.js` | Online play: rooms, host snapshots and events, client input, split messages |
| `js/hud.js`, `js/ui.js` | HUD, minimap and full map, item icons rendered from the models; menus and end screens |
| `js/audio.js`, `js/effects.js` | Synthesised sound and music; particles, debris, tracers, explosions |

three.js is MIT licensed (`../vendor/three/LICENSE`). PeerJS is MIT licensed (`../vendor/peerjs.LICENSE`).
