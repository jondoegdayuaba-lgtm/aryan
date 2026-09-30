"""
Bake the terrain light map with Cycles.

  R  sun visibility from the terrain alone   (ridge shadows; applied to every object in the game)
  G  sun visibility incl. trees, rocks, buildings  (far-field forest shadows on the snow)
  B  ambient occlusion incl. trees / rocks       (sky visibility, multiplies the image based light)

Cycles' SHADOW bake type never reports an object shadowing itself (checked on a test ridge), so R is
ray-marched on the heightfield in numpy (soft sun disc), G = R x the Cycles shadow of the occluders
(trees, rocks, buildings) and B is the Cycles AO bake, which does include the terrain.

The terrain is rebuilt from ski/assets/world/heightmap.u16 (the exact heights the game uses),
trees are cone proxies (the same shapes as the LOD 3 meshes), rocks are lumpy ellipsoids and the
buildings are boxes from world.json.  Output: ski/assets/tex/terrain_light.png (2048 x 4096).

usage: python bake_terrain.py [--res 2048] [--samples 64] [--ao-samples 96] [--coarse 1] [--no-trees]
"""
import json
import math
import os
import sys

import numpy as np

import common as C
from common import bpy
import world_gen as wg

TEX_W_DEFAULT = 2048


def load_world():
    info = json.load(open(os.path.join(C.ASSETS, 'world', 'world.json')))
    g = info['grid']
    u16 = np.fromfile(os.path.join(C.ASSETS, 'world', 'heightmap.u16'), dtype='<u2').reshape(g['nz'], g['nx'])
    H = g['hMin'] + u16.astype(np.float32) / g['hQuant']
    trees = np.fromfile(os.path.join(C.ASSETS, 'world', 'trees.f32'), dtype='<f4').reshape(-1, 6)
    rocks = np.fromfile(os.path.join(C.ASSETS, 'world', 'rocks.f32'), dtype='<f4').reshape(-1, 6)
    return info, H, trees, rocks


def build_terrain(info, H, coarse):
    g = info['grid']
    Hs = H[::coarse, ::coarse]
    nz, nx = Hs.shape
    xs = g['x0'] + np.arange(nx) * g['dx'] * coarse
    zs = g['z0'] + np.arange(nz) * g['dx'] * coarse
    X, Z = np.meshgrid(xs, zs)
    verts = np.stack([X.ravel(), -Z.ravel(), Hs.ravel()], 1).astype(np.float32)   # game -> Blender
    tris = C.grid_triangles(nx, nz)[:, [0, 2, 1]]                                   # +Z facing
    x_min, x_max = g['x0'], g['x0'] + (g['nx'] - 1) * g['dx']
    z_min, z_max = g['z0'], g['z0'] + (g['nz'] - 1) * g['dx']
    u = (X - x_min) / (x_max - x_min)
    v = (Z - z_min) / (z_max - z_min)                       # v = 0 at z0 (row 0 of the output)
    uv = np.stack([u.ravel(), v.ravel()], 1)[tris]          # (M,3,2)
    ob = C.mesh_from_arrays('Terrain', verts, tris, uv=uv, smooth=True)
    return ob


def cone_proxy(species_h, species_r, cb):
    """Stacked-cone occluder (same idea as the LOD 3 tree)"""
    import make_trees as MT
    sp = {0: 0, 1: 1, 2: 2, 3: 3}
    return None


def make_tree_proxies(trees):
    import make_trees as MT
    meshes = {}
    for sp in range(4):
        V, _, _, T = MT.build_cone(sp)
        V = V * np.array([1.05, 1.0, 1.05], np.float32)
        vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
        me = bpy.data.meshes.new(f'proxy{sp}')
        me.from_pydata(vb.tolist(), [], T.tolist())
        me.update()
        meshes[sp] = me
    objs = []
    coll = bpy.context.scene.collection
    for (x, z, y, s, yaw, sp) in trees:
        ob = bpy.data.objects.new('t', meshes[int(sp)])
        ob.location = (float(x), float(-z), float(y) - 0.2)
        ob.rotation_euler = (0.0, 0.0, float(yaw))
        ob.scale = (float(s), float(s), float(s))
        coll.objects.link(ob)
        objs.append(ob)
    return objs


def make_rock_proxies(rocks):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    me = bpy.data.meshes.new('rockproxy')
    bm.to_mesh(me)
    bm.free()
    objs = []
    for (x, z, y, s, yaw, kind) in rocks:
        ob = bpy.data.objects.new('r', me)
        ob.location = (float(x), float(-z), float(y) + 0.25 * s)
        ob.rotation_euler = (0.0, 0.0, float(yaw))
        ob.scale = (s * 0.85, s * 0.7, s * 0.6)
        bpy.context.scene.collection.objects.link(ob)
        objs.append(ob)
    return objs


def make_building_boxes(info):
    objs = []
    import bmesh
    for name, p in info['props'].items():
        size = p.get('size')
        if not size:
            continue
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        sx, sy, sz = size            # width (x), height (y), depth (z) in game space
        ob.scale = (sx, sz, sy)
        ob.location = (p['x'], -p['z'], p['y'] + sy / 2)
        ob.rotation_euler = (0, 0, p.get('yaw', 0.0))
        bpy.context.scene.collection.objects.link(ob)
        objs.append(ob)
    return objs



def terrain_sun_visibility(info, H, width, height, disc_deg=1.0, taps=9):
    """Exact terrain-only sun visibility on the light-map grid (ray-march on the height field)."""
    from scipy import ndimage as ndi
    g = info['grid']
    x0, z0, dx = g['x0'], g['z0'], g['dx']
    x1 = x0 + (g['nx'] - 1) * dx
    z1 = z0 + (g['nz'] - 1) * dx
    # work at half the light-map resolution, then upsample (terrain shadows are smooth)
    w2, h2 = width // 2, height // 2
    xs = x0 + (np.arange(w2) + 0.5) / w2 * (x1 - x0)
    zs = z0 + (np.arange(h2) + 0.5) / h2 * (z1 - z0)
    X, Z = np.meshgrid(xs, zs)
    fx0 = (X - x0) / dx
    fz0 = (Z - z0) / dx
    y0 = ndi.map_coordinates(H, [fz0, fx0], order=1, mode='nearest') + 0.4
    hmax = float(H.max())
    az0 = math.radians(info['sun']['azimuthDeg'])
    el0 = math.radians(info['sun']['elevationDeg'])
    vis = np.zeros_like(y0, dtype=np.float32)
    dirs = [(0.0, 0.0)] + [(disc_deg * math.cos(2 * math.pi * k / (taps - 1)), disc_deg * math.sin(2 * math.pi * k / (taps - 1)))
                           for k in range(taps - 1)]
    for (da, de) in dirs:
        az = az0 + math.radians(da) / max(math.cos(el0), 0.2)
        el = el0 + math.radians(de)
        d = np.array([-math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el)])
        blocked = np.zeros(y0.shape, dtype=bool)
        t = 2.0
        while t < 5000.0:
            ray_y = y0 + d[1] * t
            if ray_y.min() > hmax:
                break
            fx = fx0 + d[0] * t / dx
            fz = fz0 + d[2] * t / dx
            inside = (fx >= 0) & (fx <= g['nx'] - 1) & (fz >= 0) & (fz <= g['nz'] - 1)
            hh = ndi.map_coordinates(H, [np.clip(fz, 0, g['nz'] - 1), np.clip(fx, 0, g['nx'] - 1)], order=1, mode='nearest')
            blocked |= (hh > ray_y) & inside
            t = t * 1.055 + 0.9
        vis += (~blocked).astype(np.float32)
    vis /= len(dirs)
    return ndi.zoom(vis, 2, order=1)[:height, :width]


def bake(terrain, kind, image, samples, margin=6):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    C.select_only([terrain])
    for n in terrain.data.materials[0].node_tree.nodes:
        n.select = False
    tex = terrain.data.materials[0].node_tree.nodes['bake_target']
    tex.image = image
    tex.select = True
    terrain.data.materials[0].node_tree.nodes.active = tex
    bpy.ops.object.bake(type=kind, margin=margin, margin_type='EXTEND', use_clear=True)
    arr = C.image_to_numpy(image, top_first=False)      # row 0 = z0
    return arr[..., :3].mean(axis=2)


def main():
    args = sys.argv[1:]
    def opt(name, default):
        return type(default)(args[args.index(name) + 1]) if name in args else default
    width = opt('--res', TEX_W_DEFAULT)
    height = width * 2
    samples = opt('--samples', 64)
    ao_samples = opt('--ao-samples', 96)
    coarse = opt('--coarse', 1)
    use_trees = '--no-trees' not in args

    C.reset_scene()
    sc = C.setup_cycles(samples=samples, denoise=False, res=(64, 64))
    info, H, trees, rocks = load_world()

    with C.Timer('terrain mesh'):
        terrain = build_terrain(info, H, coarse)
        mat = bpy.data.materials.new('bake')
        mat.use_nodes = True
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.name = 'bake_target'
        terrain.data.materials.append(mat)

    # sun
    sd = info['sun']['dir']
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    sun.angle = math.radians(0.9)
    so = bpy.data.objects.new('sun', sun)
    bpy.context.scene.collection.objects.link(so)
    d = np.array([sd[0], -sd[2], sd[1]])                    # toward the sun, Blender coords
    so.rotation_euler = zaxis_to_euler(d)                   # the lamp shines along its local -Z, i.e. away from d
    # world: uniform white so AO / shadow bakes are unaffected by colour
    world = bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    world.light_settings.distance = 45.0

    occluders = []
    if use_trees:
        with C.Timer(f'{len(trees)} tree proxies'):
            occluders += make_tree_proxies(trees)
    with C.Timer(f'{len(rocks)} rock proxies'):
        occluders += make_rock_proxies(rocks)
    occluders += make_building_boxes(info)

    def show(flag):
        for o in occluders:
            o.hide_render = not flag
            o.hide_viewport = not flag

    out = np.zeros((height, width, 3), dtype=np.float32)
    img = bpy.data.images.new('lm', width, height, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'

    with C.Timer('sun visibility of the terrain alone (numpy ray-march)'):
        out[..., 0] = terrain_sun_visibility(info, H, width, height)
    show(True)
    with C.Timer('sun shadows of trees, rocks and buildings (Cycles)'):
        occ = bake(terrain, 'SHADOW', img, samples)
        out[..., 1] = out[..., 0] * np.clip(occ, 0, 1)
    with C.Timer('ambient occlusion (Cycles)'):
        out[..., 2] = bake(terrain, 'AO', img, ao_samples)

    from PIL import Image
    rgb = np.clip(out, 0, 1)
    path = os.path.join(C.ASSETS, 'tex', 'terrain_light.png')
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), 'RGB').save(path, optimize=True)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')
    print('mean R,G,B:', rgb.reshape(-1, 3).mean(axis=0))


def zaxis_to_euler(z):
    """Euler XYZ that rotates the local +Z axis onto vector z"""
    import mathutils
    z = mathutils.Vector(z).normalized()
    q = mathutils.Vector((0, 0, 1)).rotation_difference(z)
    return q.to_euler()


if __name__ == '__main__':
    main()
