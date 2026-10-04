"""Builds every asset Sunken Gold uses, with Blender:

    pip install bpy            # Blender as a Python module (Python 3.11)
    python blender/build.py    # or: blender -b -P blender/build.py

Writes into assets/: models.glb, colliders.bin, terrain.bin, world.json and
tex/*.jpg|png."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must come before bmesh/mathutils)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import common  # noqa: E402
import creatures  # noqa: E402
import gear  # noqa: E402
import reef  # noqa: E402
import seabed  # noqa: E402
import textures  # noqa: E402
import treasure  # noqa: E402
import wreck  # noqa: E402

# Solid models the diver can bump into, with the distance-field cell size (m).
COLLIDERS = {
    'wreck': 0.3, 'mast_fallen': 0.2, 'arch': 0.4, 'boat': 0.25, 'cannon': 0.1, 'anchor': 0.12,
    'boulder_0': 0.12, 'boulder_1': 0.12, 'boulder_2': 0.12, 'boulder_3': 0.12,
    'brain_0': 0.08, 'brain_1': 0.08, 'table_0': 0.08, 'table_1': 0.08, 'barrel_0': 0.08,
}
MAX_DIST = 2.55            # stored as centimetres in a byte


def distance_field(root, cell):
    """Unsigned distance to the model's surface on a grid in three.js local
    space (x, y up, z = -blender y). Thin walls work because the game keeps the
    diver a radius away from the surface rather than testing inside/outside."""
    bm = bmesh.new()
    for part in [root] + list(root.children_recursive):
        if part.type != 'MESH':
            continue
        tmp = part.data.copy()
        tmp.transform(part.matrix_world)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    bvh = BVHTree.FromBMesh(bm)
    co = np.array([v.co[:] for v in bm.verts])
    bm.free()
    three = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
    margin = 1.2
    lo = three.min(0) - margin
    hi = three.max(0) + margin
    dims = np.ceil((hi - lo) / cell).astype(int) + 1
    data = np.empty(int(np.prod(dims)), dtype=np.uint8)
    k = 0
    for iz in range(dims[2]):
        tz = lo[2] + iz * cell
        for iy in range(dims[1]):
            ty = lo[1] + iy * cell
            for ix in range(dims[0]):
                tx = lo[0] + ix * cell
                hit = bvh.find_nearest(Vector((tx, -tz, ty)), MAX_DIST)
                d = hit[3] if hit[0] is not None else MAX_DIST
                data[k] = min(255, int(round(d * 100)))
                k += 1
    return {'min': lo.round(3).tolist(), 'dims': dims.tolist(), 'cell': cell}, data


def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        for p in [o] + list(o.children_recursive):
            p.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_texcoords=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_materials='EXPORT', export_image_format='NONE', export_extras=False, export_animations=False)
    print(f'  wrote models.glb {os.path.getsize(path) / 1024:.0f} KB')


def main():
    t0 = time.time()
    common.reset_scene()
    textures.build()
    models = {}
    for mod in (reef, creatures, wreck, treasure, gear):
        print(f'Modelling: {mod.__name__}')
        models.update(mod.build())
    world = seabed.build(models)

    print('Collision distance fields')
    index, blobs, offset = {}, [], 0
    for name, cell in COLLIDERS.items():
        meta, data = distance_field(models[name], cell)
        meta['offset'] = offset
        index[name] = meta
        blobs.append(data)
        offset += len(data)
        print(f'  {name}: {meta["dims"]} cells')
    with open(os.path.join(common.OUT, 'colliders.bin'), 'wb') as f:
        for b in blobs:
            f.write(b.tobytes())
    world['colliders'] = index
    with open(os.path.join(common.OUT, 'world.json'), 'w') as f:
        json.dump(world, f, separators=(',', ':'))

    export_glb(os.path.join(common.OUT, 'models.glb'), [o for o in models.values() if o.parent is None])
    print(f'Done in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
