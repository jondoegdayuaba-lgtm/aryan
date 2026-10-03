# Builds every game asset from scratch with Blender:
#
#   python blender/build_assets.py            (with `pip install bpy==4.5.4`)
#   blender -b -P blender/build_assets.py     (with a Blender 4.5 install)
#
# Writes western/assets/: cowboy.glb, horse.glb, deer.glb, props.glb,
# mountains.glb, terrain.bin, world.json, map.jpg and textures/.
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must come first: it makes mathutils importable)
import numpy as np  # noqa: E402

import animals  # noqa: E402
import buildings  # noqa: E402
import characters  # noqa: E402
import common  # noqa: E402
import nature  # noqa: E402
import terrain  # noqa: E402
import textures  # noqa: E402
import worldmesh  # noqa: E402
from common import ASSETS, export_glb  # noqa: E402


def to_game_box(box):
    """Blender local (minx, miny, maxx, maxy, h) -> game local (minx, minz, maxx, maxz, h)."""
    x0, y0, x1, y1, h = box
    return [round(x0, 2), round(-y1, 2), round(x1, 2), round(-y0, 2), round(h, 2)]


def build_characters():
    common.reset()
    col = common.new_collection('Cowboy')
    rig, objs = characters.build_cowboy(col)
    export_glb(os.path.join(ASSETS, 'cowboy.glb'), objs, animations=True)
    for P, name in ((animals.HORSE, 'horse'), (animals.DEER, 'deer')):
        common.reset()
        col = common.new_collection(name)
        rig, objs = animals.build_animal(P, col)
        export_glb(os.path.join(ASSETS, f'{name}.glb'), objs, animations=True)


def build_props():
    common.reset()
    T = textures.build_all()
    made = buildings.build_all(T)
    models = {}
    objs = []
    for name, (ob, colliders, platforms) in made.items():
        objs.append(ob)
        models[name] = dict(colliders=[to_game_box(c) for c in colliders],
                            platforms=[to_game_box(p) for p in platforms])
    for name, ob in nature.build_all(T).items():
        objs.append(ob)
    for o in objs:
        o.location = (0, 0, 0)
    common.select_only(objs)
    path = os.path.join(ASSETS, 'props.glb')
    common.select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_animations=False, export_skins=False, export_image_format='JPEG',
                              export_jpeg_quality=85, export_cameras=False, export_lights=False)
    print(f'  wrote western/assets/props.glb ({os.path.getsize(path) / 1024:.0f} KB)')
    return models


def build_world(models):
    common.reset()
    t = time.time()
    w = terrain.World()
    print(f'  world laid out in {time.time() - t:.1f}s')
    base = math.floor(float(w.h.min())) - 1
    scale = 0.02
    q = np.clip(np.round((w.h - base) / scale), 0, 65535).astype('<u2')
    with open(os.path.join(ASSETS, 'terrain.bin'), 'wb') as f:
        f.write(q.tobytes())
        for a in (w.dirt, w.field, w.forest):
            f.write(np.clip(np.round(a * 255), 0, 255).astype(np.uint8).tobytes())
    data = dict(
        size=terrain.SIZE, n=terrain.N, heightBase=base, heightScale=scale, play=terrain.PLAY,
        river=w.river, roads=w.roads, bridges=[{k: round(v, 3) for k, v in b.items()} for b in w.bridges],
        buildings=w.buildings, props=w.props, instances=w.instances, models=models, points=w.points,
    )
    with open(os.path.join(ASSETS, 'world.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  wrote world.json ({os.path.getsize(os.path.join(ASSETS, "world.json")) / 1024:.0f} KB), '
          f'{sum(len(v) for v in w.instances.values())} plants and rocks')
    worldmesh.paint_map(w)
    ob = worldmesh.mountains()
    common.select_only([ob])
    path = os.path.join(ASSETS, 'mountains.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False,
                              export_vertex_color='ACTIVE', export_cameras=False, export_lights=False)
    print(f'  wrote western/assets/mountains.glb ({os.path.getsize(path) / 1024:.0f} KB)')
    return w


def main():
    t = time.time()
    os.makedirs(ASSETS, exist_ok=True)
    print('Characters and animals')
    build_characters()
    print('Buildings, props and plants')
    models = build_props()
    print('Terrain and layout')
    build_world(models)
    print(f'Done in {time.time() - t:.0f}s')


if __name__ == '__main__':
    main()
