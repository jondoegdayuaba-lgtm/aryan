"""
Boulders for Alpine Descent -> ski/assets/models/rocks.glb

Four kinds (rounded boulder, angular block, flat slab, tall shard), three levels of detail each.
Every rock is a convex-ish body cut from a Blender icosphere by random planes (soft-min, so the edges
are chipped rather than razor sharp), roughened with layered noise, flat-bottomed so it can sit in the
snow, then given angle-based smooth shading; the coarser levels come from Blender's Decimate modifier.
Origin: centre of the base on the ground, +Y up, roughly 0.8 m half width and 0.9 m tall at scale 1.
The game supplies colour and normal detail from the same triplanar rock textures as the mountain.

usage: python make_rocks.py [--preview]
"""
import math
import os
import sys

import numpy as np

import common as C
from common import bpy

KINDS = {
    #        planes  offset range   soft-min k  axes (x, y, z)         chip noise
    'boulder': dict(n=7,  d=(0.70, 0.92), k=9.0,  axes=(0.95, 0.98, 0.90), noise=0.045, seed=3),
    'block':   dict(n=11, d=(0.62, 0.86), k=38.0, axes=(0.92, 1.00, 0.88), noise=0.030, seed=8),
    'slab':    dict(n=9,  d=(0.60, 0.90), k=26.0, axes=(1.22, 0.60, 1.00), noise=0.030, seed=13),
    'shard':   dict(n=10, d=(0.58, 0.85), k=30.0, axes=(0.70, 1.42, 0.66), noise=0.035, seed=21),
}
LODS = (1.0, 0.24, 0.07)          # Decimate ratios of the three levels


def wave_noise(points, rng, scales, amps):
    """cheap 3D noise: sums of random plane waves"""
    out = np.zeros(len(points))
    for sc, amp in zip(scales, amps):
        k = rng.normal(size=(9, 3))
        k /= np.linalg.norm(k, axis=1, keepdims=True)
        ph = rng.uniform(0, 2 * math.pi, 9)
        f = sc * rng.uniform(0.8, 1.25, 9)
        out += amp * np.sin(points @ (k * f[:, None]).T + ph).mean(axis=1) * 3.0
    return out


def rock_vertices(kind, dirs, rng_seed):
    p = KINDS[kind]
    rng = np.random.default_rng(p['seed'] * 100 + rng_seed)
    normals = rng.normal(size=(p['n'], 3))
    normals[:, 1] = np.abs(normals[:, 1]) * 0.9 + 0.1 if kind != 'slab' else np.abs(normals[:, 1]) * 1.8 + 0.4
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    # always a few planes below the equator so the base gets flat facets
    normals[-2:, 1] = -np.abs(normals[-2:, 1])
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    offs = rng.uniform(*p['d'], p['n'])
    cosang = dirs @ normals.T                                   # (V, n)
    r_i = np.where(cosang > 0.02, offs[None, :] / np.maximum(cosang, 0.02), 4.0)
    r = -np.log(np.exp(-p['k'] * np.minimum(r_i, 4.0)).sum(axis=1) + 1e-30) / p['k']
    r = np.minimum(r, 2.2)
    pts = dirs * r[:, None]
    n = wave_noise(pts * 1.0, rng, (5.0, 11.0, 24.0), (p['noise'] * 1.2, p['noise'], p['noise'] * 0.55))
    pts = pts * (1.0 + n)[:, None]
    pts = pts * np.array(p['axes'])
    pts[:, 1] = np.maximum(pts[:, 1], -0.34)                    # flat, buried base
    pts[:, 1] += 0.0
    return pts


def build_kind(kind, variant):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    dirs = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    # game frame: y up. Blender frame: z up. dirs are generic so treat their y as "up" then swap.
    pts = rock_vertices(kind, dirs, variant)
    for v, q in zip(bm.verts, pts):
        v.co = (q[0], -q[2], q[1])                                # game (x, y, z) -> Blender (x, -z, y)
    me = bpy.data.meshes.new(f'{kind}_mesh')
    bm.to_mesh(me)
    bm.free()
    return me


def make_lods(kind, variant):
    objs = []
    for lod, ratio in enumerate(LODS):
        me = build_kind(kind, variant).copy()
        ob = bpy.data.objects.new(f'{kind}{variant}_lod{lod}', me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        if ratio < 1.0:
            mod = ob.modifiers.new('decimate', 'DECIMATE')
            mod.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38 if lod == 0 else 55))
        ob.select_set(False)
        objs.append(ob)
    return objs


def main():
    C.reset_scene()
    mat = C.Mat('rock', base=(0.4, 0.38, 0.35, 1.0), rough=0.92)
    objs = []
    order = ['boulder', 'block', 'slab', 'shard']
    for idx, kind in enumerate(order):
        for ob in make_lods(kind, 0):
            ob.name = ob.name.replace(f'{kind}0_', f'rock{idx}_')
            ob.data.materials.append(mat.mat)
            objs.append(ob)
    for ob in objs:
        print(f'  {ob.name}: {len(ob.data.polygons)} faces')
    out = os.path.join(C.ASSETS, 'models', 'rocks.glb')
    C.export_glb(out, objs, materials=True, jpeg=True)
    if '--preview' in sys.argv:
        preview(objs)


def preview(objs):
    sc = bpy.context.scene
    C.setup_cycles(samples=32, denoise=True, res=(1200, 500))
    w = bpy.data.worlds.new('studio')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.68, 0.8, 1)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.0
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    ground = C.mesh_from_arrays('g', [[-40, -40, 0], [40, -40, 0], [40, 40, 0], [-40, 40, 0]], [[0, 1, 2], [0, 2, 3]])
    gm = C.Mat('gm', base=(0.9, 0.93, 0.97, 1), rough=0.8)
    ground.data.materials.append(gm.mat)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 45
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    for i, ob in enumerate(objs):
        idx, lod = int(ob.name[4]), int(ob.name[-1])
        ob.location = (idx * 2.2 - 3.3, -lod * 2.2 + 2.2, 0)
    co.location = (0, -9.5, 4.2)
    co.rotation_euler = (math.radians(66), 0, 0)
    C.render_to(os.path.join(C.BUILD, 'rocks_preview.png'), 'PNG', 'RGB')
    print('preview written')


if __name__ == '__main__':
    main()
