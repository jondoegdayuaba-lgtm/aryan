"""
Snow-laden conifers: four species x four levels of detail, built from the Cycles-rendered branch atlas.

  species 0  spruce   tall, narrow, drooping tiers        light snow
  species 1  fir      broad and dense                     heavy snow
  species 2  pine     long bare trunk, crown up top       light snow
  species 3  small    twisted tree-line krummholz         heavy snow
  LOD 0..2: alpha-tested branch cards (fewer, larger cards each level)
  LOD 3:    stacked cones with vertex colours (no alpha), used beyond ~600 m

Geometry is written to ski/assets/models/trees.glb (position, uv in the atlas, COLOR_0 ambient
occlusion) and per-species numbers to ski/assets/models/tree_info.json.  The game supplies the
material (atlas, front/back face selection, wrap lighting) so no textures are embedded.

usage: python make_trees.py [--preview]
"""
import json
import math
import os
import sys

import numpy as np

import common as C
from common import bpy

CELLS = 5
CELL_W = 1.0 / CELLS
UP = np.array([0.0, 1.0, 0.0])

SPECIES = {
    0: dict(name='spruce', H=16.0, cb=1.6, R=2.7, tiers=28, per=(7, 9), droop=(16, 36), variant=0, trunk=0.27, lift=0.0),
    1: dict(name='fir', H=13.5, cb=1.2, R=3.4, tiers=24, per=(8, 10), droop=(10, 30), variant=1, trunk=0.32, lift=0.05),
    2: dict(name='pine', H=18.0, cb=8.0, R=2.5, tiers=11, per=(4, 6), droop=(-8, 22), variant=0, trunk=0.25, lift=0.15),
    3: dict(name='small', H=5.5, cb=0.3, R=1.7, tiers=13, per=(5, 7), droop=(4, 30), variant=1, trunk=0.10, lift=0.1),
}
LODS = {
    0: dict(dens=1.00, size=1.00, fill=True, seg=3, sides=8),
    1: dict(dens=0.42, size=1.38, fill=False, seg=2, sides=6),
    2: dict(dens=0.16, size=2.30, fill=False, seg=1, sides=4),
}


def normalize(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


def rotate_about(v, axis, ang):
    axis = normalize(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * np.dot(axis, v) * (1 - math.cos(ang))


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build_crown(sp, lod, seed):
    P, L = SPECIES[sp], LODS[lod]
    rng = np.random.default_rng(seed)
    H, cb, R = P['H'], P['cb'], P['R']
    tiers = max(int(round(P['tiers'] * (L['dens'] ** 0.5))), 5 if lod else 8)
    per_lo, per_hi = P['per']
    per_scale = L['dens'] ** 0.5
    seg = L['seg']
    cell0 = P['variant'] * 2 * CELL_W          # top cell of the variant in the atlas

    verts, uvs, cols, tris = [], [], [], []

    def add_card(base, b, w, length, width, ao0, ao1, curve, upturn):
        """One card of `seg` segments along b, `width` across w; curved by `curve` (drop) and `upturn`."""
        rows = seg + 1
        r_idx = np.arange(rows) / seg
        centre = (base[None, :] + b[None, :] * (length * r_idx)[:, None]
                  - UP[None, :] * (curve * length * r_idx ** 2)[:, None]
                  + UP[None, :] * (upturn * length * r_idx ** 3)[:, None])
        left = centre - w[None, :] * (width * 0.5)
        right = centre + w[None, :] * (width * 0.5)
        v = np.empty((rows * 2, 3))
        v[0::2], v[1::2] = left, right
        u_col = np.tile([0.012, 0.988], rows)
        v_row = np.repeat(0.995 - 0.99 * r_idx, 2)             # base at the bottom of the cell, tip at the top
        uv = np.stack([cell0 + u_col * CELL_W, v_row], 1)
        ao = np.repeat(ao0 + (ao1 - ao0) * r_idx, 2)
        base_i = sum(len(x) for x in verts)
        verts.append(v)
        uvs.append(uv)
        cols.append(np.repeat(ao[:, None], 3, axis=1))
        t = []
        for r in range(rows - 1):
            a, b_, c, d = base_i + r * 2, base_i + r * 2 + 1, base_i + r * 2 + 2, base_i + r * 2 + 3
            t += [[a, b_, c], [b_, d, c]]
        tris.append(np.array(t))

    n_branches = 0
    for i in range(tiers):
        t = (i + rng.random() * 0.6) / tiers                     # 0 low .. 1 top
        y = cb + t * (H - cb)
        reach = (R * (1 - t) ** 0.82 + 0.35) * (0.9 + 0.2 * rng.random())
        k = max(3, int(round(rng.integers(per_lo, per_hi + 1) * per_scale)))
        az0 = rng.uniform(0, 2 * math.pi)
        for j in range(k):
            az = az0 + j * 2 * math.pi / k + rng.normal(0, 0.16)
            drp = math.radians(rng.uniform(*P['droop'])) * (1 - 0.55 * t) - math.radians(14) * t ** 2
            b = np.array([math.cos(drp) * math.cos(az), -math.sin(drp), math.cos(drp) * math.sin(az)])
            w0 = normalize(np.cross(b, UP))
            length = max(reach * (0.92 + 0.28 * rng.random()), 0.7) * L['size'] * 1.05
            width = length * 0.5 * (0.85 + 0.3 * rng.random())
            r0 = 0.10 + 0.08 * rng.random()
            base = np.array([math.cos(az) * r0, y + rng.normal(0, 0.12), math.sin(az) * r0])
            ao_in = 0.34 + 0.16 * t
            ao_out = 0.78 + 0.22 * smooth(0.0, 0.5, t) * 0 + 0.18 * (1 - t)
            for roll in (-1, 1):
                ang = math.radians(rng.uniform(8, 32)) * roll
                w = rotate_about(w0, b, ang)
                add_card(base, b, w, length, width, ao_in, min(ao_out, 1.0), P['lift'] * 0 + 0.24 + 0.14 * rng.random() - 0.3 * P['lift'], P['lift'])
            n_branches += 1
            if L['fill']:
                bf = rotate_about(b, w0, math.radians(rng.uniform(22, 48)))    # steeper, upward fill card
                wf = normalize(np.cross(bf, UP))
                add_card(base + np.array([0, 0.05, 0]), bf, wf, length * 0.55, width * 0.6, ao_in * 0.8, ao_in + 0.3, 0.1, 0.0)

    # ---- trunk
    sides = L['sides']
    top = H * (0.96 if sp == 2 else 0.9)
    rings = max(int(top / 1.4), 4)
    ys = np.linspace(0, top, rings)
    rr = P['trunk'] * (1 - ys / (H * 1.02)) ** 0.75 + 0.025
    tv, tu, tc, tt = [], [], [], []
    for ring, (yy, r) in enumerate(zip(ys, rr)):
        for s_ in range(sides + 1):
            a = 2 * math.pi * s_ / sides
            tv.append([math.cos(a) * r, yy, math.sin(a) * r])
            tu.append([4 * CELL_W + (0.012 + 0.976 * s_ / sides) * CELL_W, 0.99 - 0.98 * yy / H])
            inside = smooth(cb - 0.5, cb + 2.5, yy)
            f = 1.0 - 0.55 * inside
            tc.append([f, f, f])
    for ring in range(rings - 1):
        for s_ in range(sides):
            a = ring * (sides + 1) + s_
            b_ = a + 1
            c = a + sides + 1
            d = c + 1
            tt += [[a, c, b_], [b_, c, d]]
    base_i = sum(len(x) for x in verts)
    verts.append(np.array(tv))
    uvs.append(np.array(tu))
    cols.append(np.array(tc))
    tris.append(np.array(tt) + base_i)

    V = np.concatenate(verts)
    UV = np.concatenate(uvs)
    CO = np.concatenate(cols)
    T = np.concatenate(tris)
    return V.astype(np.float32), UV.astype(np.float32), CO.astype(np.float32), T.astype(np.int32)


def build_cone(sp):
    """LOD 3: stacked cones, vertex coloured (dark green with a snow-white cap on each tier)."""
    P = SPECIES[sp]
    H, cb, R = P['H'], P['cb'], P['R']
    tiers = [(cb, 1.00, 0.52), (cb + 0.30 * (H - cb), 0.80, 0.55), (cb + 0.58 * (H - cb), 0.55, 0.60)]
    sides = 7
    verts, cols, tris = [], [], []
    green = np.array([0.045, 0.10, 0.05])
    white = np.array([0.80, 0.84, 0.90])
    snow = 0.55 if P['variant'] == 1 else 0.28
    for (y0, rs, hs) in tiers:
        y1 = min(H, y0 + hs * (H - cb) * 0.62 + 2.5)
        r = R * rs
        base_i = sum(len(v) for v in verts)
        ring = [[math.cos(2 * math.pi * s_ / sides) * r, y0, math.sin(2 * math.pi * s_ / sides) * r] for s_ in range(sides)]
        mid = [[math.cos(2 * math.pi * (s_ + 0.5) / sides) * r * 0.55, y0 + (y1 - y0) * 0.55, math.sin(2 * math.pi * (s_ + 0.5) / sides) * r * 0.55] for s_ in range(sides)]
        apex = [[0, y1, 0]]
        verts.append(np.array(ring + mid + apex))
        col_r = green * 0.7
        col_m = green * (1 - snow * 0.4) + white * snow * 0.4
        col_a = green * (1 - snow) + white * snow
        cols.append(np.array([col_r] * sides + [col_m] * sides + [col_a]))
        t = []
        for s_ in range(sides):
            n_ = (s_ + 1) % sides
            t += [[base_i + s_, base_i + n_, base_i + sides + s_], [base_i + n_, base_i + sides + n_, base_i + sides + s_]]
            t += [[base_i + sides + s_, base_i + sides + n_, base_i + 2 * sides]]
        tris.append(np.array(t))
    # trunk stub
    base_i = sum(len(v) for v in verts)
    verts.append(np.array([[0.2, 0, 0], [-0.1, 0, 0.17], [-0.1, 0, -0.17], [0.0, cb + 1.0, 0.0]]))
    cols.append(np.array([[0.1, 0.07, 0.05]] * 4))
    tris.append(np.array([[base_i, base_i + 1, base_i + 3], [base_i + 1, base_i + 2, base_i + 3], [base_i + 2, base_i, base_i + 3]]))
    V = np.concatenate(verts).astype(np.float32)
    CO = np.concatenate(cols).astype(np.float32)
    T = np.concatenate(tris).astype(np.int32)
    return V, np.zeros((len(V), 2), np.float32), CO, T


def to_blender(name, V, UV, CO, T):
    vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)               # game -> Blender
    uv_corner = UV[T]                                            # (M,3,2)
    ob = C.mesh_from_arrays(name, vb, T, uv=uv_corner, smooth=False)
    me = ob.data
    attr = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    rgba = np.concatenate([CO, np.ones((len(CO), 1), np.float32)], axis=1)
    attr.data.foreach_set('color', rgba.ravel())
    me.color_attributes.active_color = attr
    return ob


def main():
    C.reset_scene()
    objs = []
    info = {}
    tri_counts = {}
    for sp, P in SPECIES.items():
        info[str(sp)] = dict(name=P['name'], height=P['H'], crownBase=P['cb'], crownRadius=P['R'],
                             crownCenter=P['cb'] + 0.55 * (P['H'] - P['cb']), trunkRadius=P['trunk'], variant=P['variant'])
        for lod in (0, 1, 2):
            V, UV, CO, T = build_crown(sp, lod, seed=1000 * sp + lod * 17 + 3)
            objs.append(to_blender(f'tree{sp}_lod{lod}', V, UV, CO, T))
            tri_counts[f'{sp}_{lod}'] = len(T)
        V, UV, CO, T = build_cone(sp)
        objs.append(to_blender(f'tree{sp}_lod3', V, UV, CO, T))
        tri_counts[f'{sp}_3'] = len(T)
    print('triangles:', tri_counts)
    out = os.path.join(C.ASSETS, 'models', 'trees.glb')
    C.export_glb(out, objs, materials=False, vertex_colors=True)
    with open(os.path.join(C.ASSETS, 'models', 'tree_info.json'), 'w') as f:
        json.dump(dict(species=info, atlasCells=CELLS, triangles=tri_counts), f, indent=1)
    if '--preview' in sys.argv:
        preview(objs)


def preview(objs):
    """Cycles test render of the species on a snow field (uses the atlas, front cell only)."""
    from PIL import Image
    sc = bpy.context.scene
    C.setup_cycles(samples=48, denoise=True, res=(1600, 900))
    import make_sky
    make_sky.sun_rot_global, make_sky.sun_elev_global = -2.2686, math.radians(36)
    make_sky.build_world(-2.2686, math.radians(36), True)
    # foliage material
    img = bpy.data.images.load(os.path.join(C.ASSETS, 'tex', 'tree_branches.png'))
    img.colorspace_settings.name = 'sRGB'
    m = C.Mat('foliage', base=(1, 1, 1, 1), rough=0.9)
    tex = m.node('ShaderNodeTexImage', -600, 200)
    tex.image = img
    tex.interpolation = 'Smart'
    vc = m.node('ShaderNodeVertexColor', -600, -100)
    vc.layer_name = 'Col'
    mul = m.node('ShaderNodeMix', -300, 100, data_type='RGBA', blend_type='MULTIPLY')
    mul.inputs['Factor'].default_value = 1.0
    m.link(tex, 'Color', mul, 6)
    m.link(vc, 'Color', mul, 7)
    m.link_bsdf(mul, 2, 'Base Color')
    m.link_bsdf(tex, 'Alpha', 'Alpha')
    m.mat.blend_method = 'HASHED' if hasattr(m.mat, 'blend_method') else None
    ground = C.mesh_from_arrays('snow', [[-300, -300, 0], [300, -300, 0], [300, 300, 0], [-300, 300, 0]], [[0, 1, 2], [0, 2, 3]])
    gm = C.Mat('snowmat', base=(0.9, 0.93, 0.97, 1), rough=0.8)
    ground.data.materials.append(gm.mat)
    place = [(0, -9, 14), (1, -3, 15), (2, 3, 14), (3, 9, 13), (0, -6, 26), (1, 6, 27), (2, -12, 34), (0, 12, 36)]
    for k, (sp, x, z) in enumerate(place):
        src = bpy.data.objects[f'tree{sp}_lod0']
        ob = bpy.data.objects.new(f'inst{k}', src.data)
        sc.collection.objects.link(ob)
        ob.location = (x, z, 0)
        ob.rotation_euler = (0, 0, k * 1.3)
        if not ob.data.materials:
            ob.data.materials.append(m.mat)
    for ob in objs:
        ob.hide_render = True
    cam = bpy.data.cameras.new('cam')
    cam.lens = 38
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = (0, 4, 3.2)
    co.rotation_euler = (math.radians(88), 0, math.radians(180))
    co.location = (0, 3, 3.0)
    co.rotation_euler = (math.radians(86), 0, 0)
    sc.camera = co
    sc.render.film_transparent = False
    C.render_to(os.path.join(C.BUILD, 'trees_preview.png'), 'PNG', 'RGB')
    print('preview at', os.path.join(C.BUILD, 'trees_preview.png'))


if __name__ == '__main__':
    main()
