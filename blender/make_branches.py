"""
Conifer branch card atlas rendered with Cycles (transparent background, unlit albedo x ambient occlusion).

Each branch is modelled from thousands of individual needles (numpy-built geometry) with snow
blobs on top. Four cells side by side (each 512 x 1024):
    [ light snow: top | light snow: underside | heavy snow: top | heavy snow: underside ]
Result: ski/assets/tex/tree_branches.webp  (RGBA, colour bled into transparent texels; lossy WebP q92 with lossless alpha)
        build/tree_branches.png    (the lossless master that make_trees.py renders its previews with)

usage: python make_branches.py [--samples 96] [--scale 1]
"""
import math
import os
import sys

import numpy as np

import common as C
from common import bpy

CELL_W, CELL_H = 512, 1024
SPRAY_LEN = 2.0            # metres, length of the card
SPRAY_W = 1.0              # metres, width of the card


def ico_template():
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    verts = np.array([v.co[:] for v in bm.verts], dtype=np.float32)
    bm.verts.ensure_lookup_table()
    tris = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int32)
    bm.free()
    return verts, tris


def spray_arrays(seed, snow, top=True):
    """Geometry of one branch spray. Returns dict of (verts, tris) per material key."""
    rng = np.random.default_rng(seed)               # needles & twigs (identical for top and underside)
    rng_s = np.random.default_rng(seed + 1000)      # snow only
    ns = 62
    s = np.linspace(0.035, 0.985, ns)
    stem_y = s * SPRAY_LEN
    stem_x = 0.018 * np.sin(s * 6.0 + 0.7)

    needle_v, needle_t = [], []
    twig_v, twig_t = [], []
    snow_blobs = []           # (cx, cy, cz, ax, ay, az, yaw)

    def add_strip(pts, width, vlist, tlist):
        """thin ribbon along a polyline of 3D points, width along +Z-perpendicular"""
        n = len(pts)
        d = np.gradient(pts, axis=0)
        d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
        side = np.cross(d, np.array([0, 0, 1.0]))
        side /= np.linalg.norm(side, axis=1, keepdims=True) + 1e-9
        a = pts - side * width * 0.5
        b = pts + side * width * 0.5
        base = sum(len(v) for v in vlist)
        vlist.append(np.concatenate([a, b]))
        i = np.arange(n - 1)
        tlist.append(np.concatenate([
            np.stack([base + i, base + n + i, base + i + 1], 1),
            np.stack([base + i + 1, base + n + i, base + n + i + 1], 1)]))

    # main stem
    stem_pts = np.stack([stem_x, stem_y, np.zeros_like(stem_y)], 1)
    add_strip(stem_pts, 0.022, twig_v, twig_t)

    for i in range(ns):
        for sd in (-1.0, 1.0):
            env = math.sin(math.pi * min(max(s[i] * 1.04, 0.0), 1.0)) ** 0.72
            length = (0.47 * env + 0.03) * (0.86 + 0.28 * rng.random())
            if length < 0.05:
                continue
            ang = math.radians(63 - 27 * s[i] + rng.uniform(-6, 6))
            dirx, diry = sd * math.sin(ang), math.cos(ang)
            nt = max(int(length / 0.0062), 6)
            t = np.linspace(0.08, 1.0, nt) * length
            droop = 0.22 * (rng.random() * 0.6 + 0.7)
            curl = rng.uniform(-0.05, 0.05)
            px = stem_x[i] + dirx * t + curl * t * t * sd
            py = stem_y[i] + diry * t
            pz = -droop * t * t + 0.05 * t
            pts = np.stack([px, py, pz], 1)
            add_strip(pts, 0.0035, twig_v, twig_t)
            tang = np.gradient(pts, axis=0)
            tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
            u = np.cross(tang, np.array([0, 0, 1.0]))
            u /= np.linalg.norm(u, axis=1, keepdims=True) + 1e-9
            w = np.cross(u, tang)
            for k in range(8):
                phi = k * 2 * math.pi / 8 + t * 23.0 + rng.uniform(0, 1)
                # spruce needles lie mostly in the plane of the spray and upward
                radial = u * np.cos(phi)[:, None] + w * (np.sin(phi) * 0.85 + 0.25)[:, None]
                radial /= np.linalg.norm(radial, axis=1, keepdims=True) + 1e-9
                nd = tang * 0.68 + radial * 0.73
                nd /= np.linalg.norm(nd, axis=1, keepdims=True) + 1e-9
                nl = (0.031 + 0.015 * rng.random(nt)) * (1.0 - 0.3 * (t / length))
                wd = np.cross(nd, tang)
                wd /= np.linalg.norm(wd, axis=1, keepdims=True) + 1e-9
                p0 = pts - wd * 0.0021
                p1 = pts + wd * 0.0021
                tip = pts + nd * nl[:, None]
                base = sum(len(v) for v in needle_v)
                needle_v.append(np.concatenate([p0, p1, tip]))
                idx = np.arange(nt)
                needle_t.append(np.stack([base + idx, base + nt + idx, base + 2 * nt + idx], 1))
            if top and snow > 0 and rng_s.random() < min(1.0, snow * (0.5 + 0.7 * env)):
                nb = 2 + int(rng_s.random() * 2.2)
                for b in range(nb):
                    f = (0.22 + 0.72 * (b + rng_s.random() * 0.6) / nb)
                    tt = f * length
                    cx = stem_x[i] + dirx * tt
                    cy = stem_y[i] + diry * tt
                    cz = -droop * tt * tt + 0.05 * tt + 0.014
                    half = (0.05 + 0.09 * rng_s.random()) * (0.6 + 0.6 * snow) * (0.5 + 0.7 * env)
                    snow_blobs.append((cx, cy, cz, half, 0.024 + 0.03 * rng_s.random() * (0.7 + snow),
                                       0.016 + 0.024 * snow * rng_s.random(), math.atan2(dirx, diry)))
    if top and snow > 0:
        # snow ridges along the stem
        for y in np.arange(0.10, 1.95, 0.17):
            if rng_s.random() < 0.25 + 0.6 * snow:
                snow_blobs.append((stem_x[int(min(ns - 1, y / SPRAY_LEN * ns))] + rng_s.uniform(-0.02, 0.02), y, 0.02,
                                   0.06 + 0.07 * rng_s.random(), 0.03 + 0.03 * snow, 0.02 + 0.02 * snow, math.pi / 2))

    out = {
        'needle': (np.concatenate(needle_v), np.concatenate(needle_t)),
        'twig': (np.concatenate(twig_v), np.concatenate(twig_t)),
    }
    if snow_blobs:
        iv, it = ico_template()
        verts, tris = [], []
        for n, (cx, cy, cz, ax, ay, az, yaw) in enumerate(snow_blobs):
            c, s_ = math.cos(yaw), math.sin(yaw)
            # blob is long along its local +Y (the direction the twig points)
            ph = rng_s.uniform(0, 6.28, 3)
            lump = 1.0 + 0.2 * np.sin(iv[:, 0] * 6.1 + ph[0]) * np.sin(iv[:, 1] * 4.7 + ph[1]) * np.sin(iv[:, 2] * 7.3 + ph[2])
            v = (iv * lump[:, None]) * np.array([ay, ax, az], dtype=np.float32)
            rx = v[:, 0] * c + v[:, 1] * s_
            ry = -v[:, 0] * s_ + v[:, 1] * c
            v = np.stack([rx + cx, ry + cy, v[:, 2] + cz], 1)
            verts.append(v)
            tris.append(it + n * len(iv))
        out['snow'] = (np.concatenate(verts), np.concatenate(tris))
    return out


def emission_material(name, color, ao_dist=0.09, ao_min=0.42, noise_amount=0.0, top_lit=None):
    """Unlit albedo x ambient occlusion (x speckle, x up-facing shading) as pure emission."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    new = nt.nodes.new
    out = new('ShaderNodeOutputMaterial')
    em = new('ShaderNodeEmission')
    ao = new('ShaderNodeAmbientOcclusion')
    ao.samples = 8
    ao.inputs['Distance'].default_value = ao_dist
    ao.inputs['Color'].default_value = (1, 1, 1, 1)
    shade = new('ShaderNodeMapRange')                  # AO 0..1 -> ao_min..1
    shade.inputs['To Min'].default_value = ao_min
    shade.inputs['To Max'].default_value = 1.0
    nt.links.new(ao.outputs['AO'], shade.inputs['Value'])
    rgb = new('ShaderNodeRGB')
    rgb.outputs[0].default_value = (*color, 1.0)
    cur = new('ShaderNodeVectorMath')
    cur.operation = 'SCALE'
    nt.links.new(rgb.outputs[0], cur.inputs[0])
    nt.links.new(shade.outputs['Result'], cur.inputs['Scale'])
    last = cur.outputs['Vector']

    def scale_by(last, factor_socket):
        vm = new('ShaderNodeVectorMath')
        vm.operation = 'SCALE'
        nt.links.new(last, vm.inputs[0])
        nt.links.new(factor_socket, vm.inputs['Scale'])
        return vm.outputs['Vector']

    if noise_amount > 0:
        geo = new('ShaderNodeNewGeometry')
        noi = new('ShaderNodeTexNoise')
        noi.inputs['Scale'].default_value = 85.0
        noi.inputs['Detail'].default_value = 2.0
        nt.links.new(geo.outputs['Position'], noi.inputs['Vector'])
        mr = new('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value = 1.0 - noise_amount
        mr.inputs['To Max'].default_value = 1.0 + noise_amount
        nt.links.new(noi.outputs['Fac'], mr.inputs['Value'])
        last = scale_by(last, mr.outputs['Result'])
    if top_lit is not None:
        geo2 = new('ShaderNodeNewGeometry')
        sep = new('ShaderNodeSeparateXYZ')
        nt.links.new(geo2.outputs['Normal'], sep.inputs['Vector'])
        mr2 = new('ShaderNodeMapRange')
        mr2.inputs['From Min'].default_value = 0.0
        mr2.inputs['From Max'].default_value = 1.0
        mr2.inputs['To Min'].default_value = top_lit
        mr2.inputs['To Max'].default_value = 1.0
        nt.links.new(sep.outputs['Z'], mr2.inputs['Value'])
        last = scale_by(last, mr2.outputs['Result'])
    nt.links.new(last, em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def build_spray(name, arrays, mats, flip_z=False):
    objs = []
    for key, (v, t) in arrays.items():
        v = v.copy()
        if flip_z:
            v[:, 2] *= -1
            t = t[:, ::-1]
        ob = C.mesh_from_arrays(f'{name}_{key}', v, t, smooth=key == 'snow')
        ob.data.materials.append(mats[key])
        objs.append(ob)
    return objs


def render_cell(objs, top, samples):
    sc = bpy.context.scene
    cam = sc.camera
    cam.location = (0.0, SPRAY_LEN / 2, 3.0 if top else -3.0)
    cam.rotation_euler = (0.0, 0.0, 0.0) if top else (math.pi, 0.0, 0.0)
    if not top:
        cam.rotation_euler = (math.pi, 0.0, math.pi)     # mirror so needles keep the same layout
    sc.cycles.samples = samples
    path = os.path.join(C.BUILD, 'cell.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    arr = C.image_to_numpy(img)
    bpy.data.images.remove(img)
    return arr


def bleed(arr, iters=10):
    """Copy colour outward into transparent texels (avoids dark fringes when mip-mapped)."""
    rgb = arr[..., :3].copy()
    a = arr[..., 3]
    filled = a > 0.02
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            f = np.roll(filled, (dy, dx), (0, 1))
            c = np.roll(rgb, (dy, dx), (0, 1))
            acc += c * f[..., None]
            cnt += f
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    out = arr.copy()
    out[..., :3] = rgb
    return out


def bark_cell(rng):
    """Vertical furrowed spruce bark (linear RGB + alpha 1), 512 x 1024"""
    from numpy.fft import rfft2, irfft2
    h, w = CELL_H, CELL_W
    kz = np.fft.fftfreq(h)[:, None]
    kx = np.fft.rfftfreq(w)[None, :]
    def band(fx, fz, seed):
        r = np.random.default_rng(seed)
        spec = rfft2(r.standard_normal((h, w))) * np.exp(-((kx / fx) ** 2 + (kz / fz) ** 2))
        o = irfft2(spec, s=(h, w))
        return o / o.std()
    n = band(0.09, 0.012, 1) * 0.6 + band(0.25, 0.04, 2) * 0.3 + band(0.5, 0.2, 3) * 0.1
    fur = np.clip(0.5 + 0.28 * n, 0.05, 1.0)
    col = np.stack([0.20 * fur, 0.135 * fur, 0.10 * fur], 2)
    return np.dstack([col, np.ones((h, w, 1))]).astype(np.float32)


def main():
    samples = 96
    if '--samples' in sys.argv:
        samples = int(sys.argv[sys.argv.index('--samples') + 1])
    C.reset_scene()
    sc = C.setup_cycles(samples=samples, denoise=False, res=(CELL_W, CELL_H))
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.cycles.filter_width = 1.2
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = SPRAY_LEN          # the long side; sensor fit follows the taller side
    cam.sensor_fit = 'VERTICAL'
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co

    rng = np.random.default_rng(11)
    atlas = np.zeros((CELL_H, CELL_W * 5, 4), dtype=np.float32)
    variants = [('light', 0.28), ('heavy', 0.85)]
    for vi, (vname, snow) in enumerate(variants):
        for side, top in enumerate((True, False)):
            with C.Timer(f'branch {vname} {"top" if top else "under"}'):
                # clear scene objects
                for ob in list(bpy.data.objects):
                    if ob.type == 'MESH':
                        bpy.data.objects.remove(ob)
                arrays = spray_arrays(100 + vi, snow if top else 0.0, top=top)
                dark = 0.62 if not top else 1.0
                mats = {
                    'needle': emission_material('needle', (0.055 * dark, 0.14 * dark, 0.065 * dark), 0.09, 0.34, 0.30),
                    'twig': emission_material('twig', (0.07 * dark, 0.045 * dark, 0.03 * dark), 0.05, 0.5),
                    'snow': emission_material('snow', (0.93, 0.955, 1.0), 0.07, 0.5, 0.04, top_lit=0.55),
                }
                objs = build_spray('spray', arrays, mats, flip_z=False)
                arr = render_cell(objs, top, samples)
                arr = bleed(arr)
                col = (vi * 2 + side) * CELL_W
                atlas[:, col:col + CELL_W] = arr
    atlas[:, 4 * CELL_W:] = bark_cell(np.random.default_rng(3))
    out = os.path.join(C.BUILD, 'tree_branches.png')                       # lossless master, read by make_trees.py
    web = os.path.join(C.ASSETS, 'tex', 'tree_branches.webp')              # what the game loads
    from PIL import Image
    from imgio import save_webp
    # the array from image_to_numpy is linear; the game and the PNG want display-referred sRGB
    lin = np.clip(atlas[..., :3], 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    rgba = np.dstack([srgb, atlas[..., 3:4]])
    img8 = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    img8.save(out, optimize=True)
    save_webp(img8, web, 92)
    print('wrote', web, os.path.getsize(web) // 1024, 'KB (PNG master', os.path.getsize(out) // 1024, 'KB)')


if __name__ == '__main__':
    main()
