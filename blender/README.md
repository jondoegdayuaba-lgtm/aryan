# The Blender pipeline of Alpine Descent

Every model, texture and lighting map in `ski/assets/` is produced by the scripts in this folder. They run headless with
Blender 4.5 as a Python module (`bpy`), so no Blender GUI is needed and the whole mountain can be rebuilt with one command.
The race mountain (three timed runs) and the open world (a free-roam valley) are both built here.

```sh
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r blender/requirements.txt

python blender/build.py --quick     # ~10 min: small sky and light map, good for iterating
python blender/build.py             # full quality, ~40 min on 4 cores (the light-map bake dominates)
python blender/build.py --only sky,props     # any subset:  python blender/build.py --list
```

Afterwards `npm run build:ski` packs everything into `desktop/alpine-descent.html`.

## What each step does

| Step | Script | Blender features used | Output (in `ski/assets/`) |
| --- | --- | --- | --- |
| `world` | `world_gen.py` | numpy/scipy: designed run + ridged, eroded height field (3.1 km of piste, 1379–2883 m), tree and boulder scatter, courses | `world/heightmap.pz`, `trees.f32`, `rocks.f32`, `poles.f32`, `world.json` |
| `maps` | `world_maps.py` | numpy: macro snow / rock / needle-litter colour and the piste mask | `tex/terrain_color.jpg`, `terrain_mask.webp` |
| `sky` | `make_sky.py` | **Cycles** panorama camera + **Nishita sky** with a procedural cirrus layer, sun placed by measuring the rendered sun disc, a 64 km mountain range built as a mesh (thermal erosion, ridged noise) with a procedural rock/snow material, bump and aerial perspective | `tex/sky.hdr`, `sky_ibl.hdr`, `world/atmosphere.json` |
| `branches` | `make_branches.py` | **Cycles** orthographic renders of snow-laden needle sprays, denoised, packed into one RGBA atlas | `tex/tree_branches.webp` |
| `trees` | `make_trees.py` | mesh generation, 4 conifer species x 4 levels of detail, **glTF exporter** with vertex colours | `models/trees.glb` |
| `skier` | `make_skier.py` | **Skin modifier** body with a modelled face (nose, lips, brows, ears), **Subdivision**, helmet / goggles / boots / skis / poles / backpack, 18-bone **armature** with weights, glTF export with skinning | `models/skier.glb`, `skier_rig.json` |
| `skier_free` | `make_skier.py --style free` | the freerider outfit (beanie, jacket, baggy trousers) on the same skeleton | `models/skier_free.glb` |
| `props` | `make_props.py` | gates, banners, safety nets, timing hut, lodge, chairlift, alpine chalets, chapel, mountain restaurant, summit cross, trail signs, piste poles and the flag; procedural wood / stone / roof textures | `models/props.glb` |
| `rocks` | `make_rocks.py` | icospheres cut by random planes, **Decimate** for the LODs, smooth-by-angle shading | `models/rocks.glb` |
| `detail` | `make_detail.py` | tileable rock and snow normal maps | `tex/rock_n.png`, `rock_c.png`, `snow_n.png` |
| `bake` | `bake_terrain.py` | **Cycles bake** of sun shadows (trees, boulders, buildings) and ambient occlusion onto the terrain, combined with a ray-marched ridge-shadow term | `tex/terrain_light.jpg` |

### The open world

| Step | Script | What it does | Output (in `ski/assets/open/`) |
| --- | --- | --- | --- |
| `open` | `open_terrain.py`, `erosion.py`, `open_world.py` | a 4.6 km basin from a network of valleys, named peaks, droplet erosion (a small C helper compiled on first use, NumPy fallback) and thermal erosion; then the ski area: a village with lodge, chalets, chapel and frozen lake, seven chairlifts that follow the pistes they serve with pylons raised where the ground falls away, nine pistes found by a slope-aware Dijkstra route search and carved in (descent profile limited to the difficulty class, corridor relaxed), a terrain park, forest and boulder scatter, 24 collectible flags and 10 landmarks | `heightmap.pz`, `groom.u8`, `trees.f32`, `rocks.f32`, `poles.f32`, `world.json` |
| `open_maps` | `open_maps.py`, `lightmap.py` | colour, mask and light-map textures and the map image, all numpy: streaked rock, needle litter, ice, ray-marched ridge shadows, tree-canopy shadows, horizon ambient occlusion | `color.jpg`, `mask.webp`, `light.jpg`, `map.jpg` |

`preview3d.py` is a small voxel renderer for looking at a height field from the side while tuning it. The height field is stored as
residuals of a 2-D predictor (`heightmap.pz`, both worlds), which gzip compresses four times better than raw heights;
`encode_heights()` in `imgio.py` and `decodePredictedHeights()` in `ski/js/world-data.js` are the two halves. The smooth mask textures
and the foliage atlas are lossy WebP (quality 92-95, lossless alpha) so the one-file desktop build stays under 30 MB.

## Lighting is measured, not guessed

`make_sky.py` renders the sky with the sun at the direction the game uses, measures the sun and sky irradiance on a white plane
and writes them to `world/atmosphere.json`. The game reads that file to set the sun light, the image-based light, the fog colour
and the camera exposure, so the game's lighting matches what Blender rendered.

The terrain light map has three channels: R = sun visibility from the mountain alone (ridge shadows, ray-marched on the height
field because Cycles' shadow bake never reports self-shadowing), G = R times the shadows of trees, boulders and buildings, and
B = ambient occlusion. Close to the camera the game uses live shadow cascades; further away it blends to G.
The open world's light map (`lightmap.py`) follows the same convention without Cycles: R is the same ray march, G multiplies it by the
shadows of a tree-canopy density map, and B is horizon-angle ambient occlusion measured relative to the local slope (the game looks
the sky light up by surface normal, so only what stands in front of a face may darken it).

## Conventions

* Game space: metres, +Y up, the run heads toward -Z. Blender space: +Z up. The scripts convert with `(x, y, z) -> (x, -z, y)`
  and export glTF with +Y up, so the models load into the game unchanged.
* Every prop is written as one mesh per material, named `<prop>__<material>`; the origin sits on the ground.
* Randomness is seeded, so a rebuild reproduces the same mountain.
