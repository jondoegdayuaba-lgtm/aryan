# The Blender pipeline of Alpine Descent

Every model, texture and lighting map in `ski/assets/` is produced by the scripts in this folder. They run headless with
Blender 4.5 as a Python module (`bpy`), so no Blender GUI is needed and the whole mountain can be rebuilt with one command.

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
| `world` | `world_gen.py` | numpy/scipy: designed run + ridged, eroded height field (2.9 km of piste, 1379–2883 m), tree and boulder scatter, courses | `world/heightmap.u16`, `trees.f32`, `rocks.f32`, `poles.f32`, `world.json` |
| `maps` | `world_maps.py` | numpy: macro snow / rock / needle-litter colour and the piste mask | `tex/terrain_color.jpg`, `terrain_mask.png` |
| `sky` | `make_sky.py` | **Cycles** panorama camera + **Nishita sky**, sun placed by measuring the rendered sun disc, a 64 km mountain range built as a mesh with a procedural rock/snow material and aerial perspective | `tex/sky.hdr`, `sky_ibl.hdr`, `world/atmosphere.json` |
| `branches` | `make_branches.py` | **Cycles** orthographic renders of snow-laden needle sprays, denoised, packed into one RGBA atlas | `tex/tree_branches.png` |
| `trees` | `make_trees.py` | mesh generation, 4 conifer species x 4 levels of detail, **glTF exporter** with vertex colours | `models/trees.glb` |
| `skier` | `make_skier.py` | **Skin modifier** body, **Subdivision**, helmet / goggles / boots / skis / poles, 18-bone **armature** with weights, glTF export with skinning | `models/skier.glb`, `skier_rig.json` |
| `props` | `make_props.py` | gates, banners, safety nets, timing hut, lodge, chairlift; procedural wood / stone / roof textures | `models/props.glb` |
| `rocks` | `make_rocks.py` | icospheres cut by random planes, **Decimate** for the LODs, smooth-by-angle shading | `models/rocks.glb` |
| `detail` | `make_detail.py` | tileable rock and snow normal maps | `tex/rock_n.png`, `rock_c.png`, `snow_n.png` |
| `bake` | `bake_terrain.py` | **Cycles bake** of sun shadows (trees, boulders, buildings) and ambient occlusion onto the terrain, combined with a ray-marched ridge-shadow term | `tex/terrain_light.jpg` |

## Lighting is measured, not guessed

`make_sky.py` renders the sky with the sun at the direction the game uses, measures the sun and sky irradiance on a white plane
and writes them to `world/atmosphere.json`. The game reads that file to set the sun light, the image-based light, the fog colour
and the camera exposure, so the game's lighting matches what Blender rendered.

The terrain light map has three channels: R = sun visibility from the mountain alone (ridge shadows, ray-marched on the height
field because Cycles' shadow bake never reports self-shadowing), G = R times the shadows of trees, boulders and buildings, and
B = ambient occlusion. Close to the camera the game uses live shadow cascades; further away it blends to G.

## Conventions

* Game space: metres, +Y up, the run heads toward -Z. Blender space: +Z up. The scripts convert with `(x, y, z) -> (x, -z, y)`
  and export glTF with +Y up, so the models load into the game unchanged.
* Every prop is written as one mesh per material, named `<prop>__<material>`; the origin sits on the ground.
* Randomness is seeded, so a rebuild reproduces the same mountain.
