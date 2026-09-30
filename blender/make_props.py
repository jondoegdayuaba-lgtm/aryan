"""
Course furniture and buildings for Alpine Descent -> ski/assets/models/props.glb

  gate_red / gate_blue    slalom gate pole with hinge and flag panel (panel extends toward +X)
  marker                  orange-topped piste edge pole
  start_post / finish_post   gantry posts;  banner_start / banner_finish  1 m x 2.2 m banner strips (tiling texture)
  net_orange / net_blue   6 m safety-net panel with posts
  hut                     timing cabin at the start        lodge  base-area chalet with warm windows
  lift_pylon, lift_chair, lift_station   chairlift furniture
  chalet_a / _b / _c      alpine chalets of the village      chapel   stone chapel with a bell tower
  alp_hut                 mountain restaurant with a sun terrace      summit_cross   wooden summit cross on a cairn
  sign_green/blue/red/black   trail signs      marker_green/blue/red/black   coloured piste poles      flag   collectible flag

Every prop is written as one mesh per material named <prop>__<material>; the origin of each prop is on the
ground at its centre (gates / poles / nets / posts) so the game only has to place and rotate them.
Procedural tileable textures (wood, stone, slate, plaster, banners, nets) are generated here with numpy.
usage: python make_props.py [--preview]
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import common as C
from common import bpy
import geo
from geo import Mesh

TEXDIR = os.path.join(C.BUILD, 'props_tex')
os.makedirs(TEXDIR, exist_ok=True)


# ============================================================================ textures
def periodic_noise(size, scale, seed):
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft2(rng.standard_normal((size, size)))
    kx = np.fft.rfftfreq(size)[None, :] * size
    ky = np.fft.fftfreq(size)[:, None] * size
    k = np.sqrt(kx ** 2 + ky ** 2) + 1e-6
    spec *= np.exp(-((k / scale) ** 2)) * k ** -0.4
    n = np.fft.irfft2(spec, s=(size, size))
    return (n - n.mean()) / (n.std() + 1e-9)


def save_png(name, arr, srgb_encode=True):
    a = np.clip(arr, 0, 1)
    if srgb_encode:
        rgb = a[..., :3]
        a = np.concatenate([np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055), a[..., 3:]], axis=2) if a.shape[2] == 4 \
            else np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    img = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA' if a.shape[2] == 4 else 'RGB')
    path = os.path.join(TEXDIR, name)
    img.save(path)
    return path


def tex_wood(size=512):
    h = w = size
    rows = 8
    ph = h // rows
    img = np.zeros((h, w, 3))
    gr = periodic_noise(size, 12, 1)
    fine = periodic_noise(size, 90, 2)
    for r in range(rows):
        base = np.array([0.33, 0.19, 0.095]) * (0.75 + 0.5 * np.random.default_rng(r).random())
        y0, y1 = r * ph, (r + 1) * ph
        streak = 0.85 + 0.12 * gr[y0:y1] * 0.5 + 0.10 * np.sin(np.arange(w)[None, :] * 0.05 + r) * 0.2
        img[y0:y1] = base[None, None, :] * streak[..., None]
        img[y0:y1] *= (1 + 0.18 * fine[y0:y1, :, None])
        img[y0:y0 + 3] *= 0.35                                                  # gaps between boards
    return save_png('wood.png', img)


def tex_stone(size=512):
    from scipy.spatial import cKDTree
    rng = np.random.default_rng(4)
    n = 46
    seeds = rng.random((n, 2)) * size
    off = np.array([[dx, dy] for dx in (-size, 0, size) for dy in (-size, 0, size)])
    pts = (seeds[None] + off[:, None]).reshape(-1, 2)
    tree = cKDTree(pts)
    yy, xx = np.mgrid[0:size, 0:size]
    d, idx = tree.query(np.stack([xx.ravel(), yy.ravel()], 1), k=2)
    edge = (d[:, 1] - d[:, 0]).reshape(size, size)
    cell = (idx[:, 0] % n).reshape(size, size)
    shade = rng.random(n)
    col = np.array([0.42, 0.40, 0.37])[None, None, :] * (0.7 + 0.5 * shade[cell])[..., None]
    col *= (1 + 0.12 * periodic_noise(size, 60, 5)[..., None])
    mortar = np.clip(edge / 6.0, 0, 1)[..., None]
    col = col * (0.25 + 0.75 * mortar ** 0.6)
    return save_png('stone.png', col)


def tex_roof(size=512):
    rng = np.random.default_rng(6)
    rows, cols = 12, 10
    ph, pw = size // rows, size // cols
    img = np.zeros((size, size, 3))
    for r in range(rows):
        for c in range(cols):
            x0 = (c * pw + (pw // 2 if r % 2 else 0)) % size
            base = np.array([0.075, 0.08, 0.095]) * (0.7 + 0.7 * rng.random())
            ys = slice(r * ph, (r + 1) * ph)
            xs = np.arange(x0, x0 + pw) % size
            img[ys, xs[:, None].T[0]] = base
            img[ys, xs[0]] *= 0.4                                              # left seam
            img[(r + 1) * ph - 3:(r + 1) * ph, xs] *= 0.4                     # lower edge shadow
    img *= (1 + 0.15 * periodic_noise(size, 70, 7)[..., None])
    return save_png('roof.png', img)


def tex_plaster(size=256):
    n = periodic_noise(size, 40, 8) * 0.05
    col = np.array([0.78, 0.72, 0.60])[None, None, :] * (1 + n[..., None])
    return save_png('plaster.png', col)


def font(px):
    try:
        return ImageFont.load_default(size=px)
    except TypeError:
        return ImageFont.load_default()


def tex_banner(name, text, bg, fg, checker=True, w=1024, h=256):
    img = Image.new('RGB', (w, h), bg)
    d = ImageDraw.Draw(img)
    if checker:
        sq = h // 6
        for y in range(6):
            for x in range(w // sq + 1):
                if (x + y) % 2 == 0:
                    if y in (0, 5):
                        d.rectangle([x * sq, y * sq, (x + 1) * sq, (y + 1) * sq], fill=(20, 22, 28))
                    elif y == 1 or y == 4:
                        d.rectangle([x * sq, y * sq, (x + 1) * sq, (y + 1) * sq], fill=(235, 238, 245))
    f = font(int(h * 0.44))
    tw = d.textlength(text, font=f)
    d.text((w / 2 - tw / 2, h * 0.5), text, fill=fg, font=f, anchor='lm')
    a = np.asarray(img).astype(np.float64) / 255
    return save_png(name, a)


def tex_net(name, color, size=128, cells=4, line=3):
    """square-cell netting, one tile = 1 m x 1 m (alpha cut-out). The colour is kept in the transparent
    texels too, so mip-mapping fades the net out instead of darkening it."""
    a = np.zeros((size, size, 4))
    a[..., :3] = color
    step = size // cells
    for k in range(cells):
        x = k * step
        a[:, x:x + line, 3] = 1
        a[x:x + line, :, 3] = 1
    return save_png(name, a)


# ============================================================================ materials
_MATS = {}


def material(name, base=(0.5, 0.5, 0.5), rough=0.6, metal=0.0, image=None, emission=None, alpha_image=None, sheen=0.0):
    if name in _MATS:
        return _MATS[name]
    m = C.Mat(name, base=(*base, 1.0), rough=rough, metal=metal)
    if image or alpha_image:
        img = bpy.data.images.load(image or alpha_image)
        img.colorspace_settings.name = 'sRGB'
        tex = m.node('ShaderNodeTexImage', -400, 200)
        tex.image = img
        tex.interpolation = 'Smart'
        m.link_bsdf(tex, 'Color', 'Base Color')
        if alpha_image:
            m.link_bsdf(tex, 'Alpha', 'Alpha')
    if emission:
        m.set('Emission Color', (*emission[:3], 1.0))
        m.set('Emission Strength', emission[3])
    _MATS[name] = m
    return m


def build_materials():
    tex = {'wood': tex_wood(), 'stone': tex_stone(), 'roof': tex_roof(), 'plaster': tex_plaster(),
           'finish': tex_banner('banner_finish.png', 'FINISH', (215, 35, 40), (255, 255, 255)),
           'start': tex_banner('banner_start.png', 'START', (25, 95, 200), (255, 255, 255)),
           'check': tex_banner('banner_check.png', 'CHECKPOINT', (20, 140, 84), (255, 255, 255)),
           'net_orange': tex_net('net_orange.png', (1.0, 0.36, 0.05)), 'net_blue': tex_net('net_blue.png', (0.10, 0.35, 0.95))}
    M = {}
    M['pole_red'] = material('pole_red', (0.72, 0.04, 0.035), 0.32)
    M['pole_blue'] = material('pole_blue', (0.04, 0.18, 0.72), 0.32)
    M['panel_red'] = material('panel_red', (0.85, 0.06, 0.05), 0.7)
    M['panel_blue'] = material('panel_blue', (0.06, 0.22, 0.85), 0.7)
    M['panel_white'] = material('panel_white', (0.9, 0.9, 0.92), 0.7)
    M['rubber'] = material('rubber', (0.02, 0.02, 0.022), 0.75)
    M['marker_dark'] = material('marker_dark', (0.06, 0.065, 0.07), 0.5)
    M['marker_orange'] = material('marker_orange', (0.95, 0.30, 0.03), 0.4)
    M['steel'] = material('steel', (0.62, 0.64, 0.68), 0.35, metal=1.0)
    M['metal_dark'] = material('metal_dark', (0.06, 0.065, 0.075), 0.45, metal=0.8)
    M['wood'] = material('wood', (1, 1, 1), 0.78, image=tex['wood'])
    M['stone'] = material('stone', (1, 1, 1), 0.92, image=tex['stone'])
    M['roof'] = material('roof', (1, 1, 1), 0.7, image=tex['roof'])
    M['plaster'] = material('plaster', (1, 1, 1), 0.9, image=tex['plaster'])
    M['snow'] = material('snow', (0.93, 0.95, 0.98), 0.85)
    M['glass'] = material('glass', (0.05, 0.08, 0.12), 0.08, metal=0.0, emission=(1.0, 0.72, 0.42, 3.0))
    M['glass_dark'] = material('glass_dark', (0.03, 0.05, 0.08), 0.06)
    M['banner_start'] = material('banner_start', (1, 1, 1), 0.92, image=tex['start'])
    M['banner_finish'] = material('banner_finish', (1, 1, 1), 0.92, image=tex['finish'])
    M['banner_check'] = material('banner_check', (1, 1, 1), 0.92, image=tex['check'])
    M['net_orange'] = material('net_orange', (1, 1, 1), 0.8, alpha_image=tex['net_orange'])
    M['net_blue'] = material('net_blue', (1, 1, 1), 0.8, alpha_image=tex['net_blue'])
    M['marker_green'] = material('marker_green', (0.05, 0.55, 0.16), 0.4)
    M['marker_blue'] = material('marker_blue', (0.05, 0.22, 0.85), 0.4)
    M['marker_red'] = material('marker_red', (0.85, 0.06, 0.05), 0.4)
    M['marker_black'] = material('marker_black', (0.03, 0.03, 0.035), 0.4)
    M['marker_white'] = material('marker_white', (0.9, 0.9, 0.92), 0.5)
    M['flag_cloth'] = material('flag_cloth', (0.95, 0.06, 0.03), 0.6, emission=(1.0, 0.10, 0.04, 0.9))
    M['flag_pole'] = material('flag_pole', (0.85, 0.86, 0.9), 0.35, metal=0.6)
    M['wood_dark'] = material('wood_dark', (0.12, 0.07, 0.04), 0.7)
    M['chair_red'] = material('chair_red', (0.7, 0.05, 0.05), 0.45)
    M['chair_dark'] = material('chair_dark', (0.04, 0.045, 0.05), 0.5)
    return M


# ============================================================================ building blocks
class Prop:
    """collects meshes by material name for one prop"""

    def __init__(self, name):
        self.name = name
        self.parts = {}

    def add(self, mat, v, t, uv_scale=None):
        self.parts.setdefault(mat, []).append((np.asarray(v, float), np.asarray(t), uv_scale))
        return self

    def box(self, mat, center, size, rot=None, uv=None):
        v, t = geo.box(center, size, rot)
        return self.add(mat, v, t, uv)

    def tube(self, mat, p0, p1, r0, r1, sides=8, rings=1, caps=(True, True)):
        v, t = geo.tube(p0, p1, r0, r1, sides, rings, caps)
        v, t = geo.orient_outward(v, t)
        return self.add(mat, v, t)


def to_objects(prop, M, uv_default=0.25, flat=True):
    objs = []
    for mat, plist in prop.parts.items():
        verts, tris, uvs = [], [], []
        off = 0
        for v, t, uvs_scale in plist:
            mesh = Mesh().add(v, t)
            vv, tt, uv = mesh.flat(uv_scale=(uvs_scale if uvs_scale is not None else uv_default))
            verts.append(vv)
            tris.append(tt + off)
            uvs.append(uv)
            off += len(vv)
        V = np.concatenate(verts)
        T = np.concatenate(tris)
        UV = np.concatenate(uvs)
        vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
        ob = C.mesh_from_arrays(f'{prop.name}__{mat}', vb, T, uv=UV, smooth=False)
        ob.data.materials.append(M[mat].mat)
        objs.append(ob)
    return objs


# ============================================================================ the props
def gate(color):
    p = Prop(f'gate_{color}')
    p.tube(f'pole_{color}', (0, 0.4, 0), (0, 2.35, 0), 0.024, 0.017, sides=8)
    p.tube('rubber', (0, 0.0, 0), (0, 0.44, 0), 0.034, 0.03, sides=8)
    # flag panel extends toward +X (away from the gate opening once mirrored)
    w, h = 0.9, 0.62
    y0 = 1.62
    v = np.array([[0.02, y0, 0.0], [0.02 + w, y0, 0.0], [0.02 + w, y0 + h, 0.0], [0.02, y0 + h, 0.0]])
    t = np.array([[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]])
    p.add(f'panel_{color}', v, t)
    # white stripe
    v2 = np.array([[0.02, y0 + h * 0.42, 0.003], [0.02 + w, y0 + h * 0.42, 0.003], [0.02 + w, y0 + h * 0.58, 0.003], [0.02, y0 + h * 0.58, 0.003]])
    p.add('panel_white', v2, np.array([[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]]))
    return p


def marker():
    p = Prop('marker')
    p.tube('marker_dark', (0, 0, 0), (0, 1.55, 0), 0.019, 0.017, sides=6)
    p.tube('marker_orange', (0, 1.55, 0), (0, 2.15, 0), 0.022, 0.02, sides=6)
    return p


def post(name, height, half=0.22):
    p = Prop(name)
    p.box('metal_dark', (0, height / 2, 0), (half * 2, height, half * 2))
    p.box('steel', (0, 0.15, 0), (half * 2 + 0.16, 0.3, half * 2 + 0.16))
    p.box('steel', (0, height + 0.06, 0), (half * 2 + 0.1, 0.12, half * 2 + 0.1))
    return p


def banner(name, mat, height=2.2):
    p = Prop(name)
    # 1 m long strip along +X, hanging from y = 0 to `height`, double sided
    v = np.array([[0, 0, 0], [1, 0, 0], [1, height, 0], [0, height, 0]], float)
    p.add(mat, v, np.array([[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]]), uv_scale=None)
    return p


def net(color):
    p = Prop(f'net_{color}')
    v = np.array([[-3, 0.15, 0], [3, 0.15, 0], [3, 2.35, 0], [-3, 2.35, 0]], float)
    p.add(f'net_{color}', v, np.array([[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]]), uv_scale=1.0)
    for x in (-3.0, 3.0):
        p.tube('metal_dark', (x, 0, 0), (x, 2.7, 0), 0.05, 0.045, sides=6)
    p.tube('marker_dark', (-3, 2.3, 0), (3, 2.3, 0), 0.012, 0.012, sides=4)
    return p


def hut():
    p = Prop('hut')
    L, D, H = 10.0, 6.0, 3.0
    p.box('wood', (0, H / 2 + 0.4, 0), (L, H, D), uv=0.35)
    p.box('stone', (0, 0.2, 0), (L + 0.3, 0.4, D + 0.3), uv=0.25)
    v, t = geo.prism_roof(0, H + 0.4, 0, L, D / 2, 1.7, overhang=0.7, thickness=0.28, axis='x')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(0, H + 0.4 + 0.30, 0, L, D / 2 - 0.1, 1.55, overhang=0.7, thickness=0.22, axis='x')
    p.add('snow', v, t, 0.3)
    # front (+z): big timing window, door, deck
    p.box('glass', (-1.6, 2.2, D / 2 + 0.03), (3.6, 1.3, 0.08))
    p.box('metal_dark', (-1.6, 2.2, D / 2 + 0.05), (3.8, 0.06, 0.1))
    p.box('wood', (3.0, 1.5, D / 2 + 0.05), (1.1, 2.2, 0.1), uv=0.5)
    p.box('wood', (0, 0.55, D / 2 + 1.4), (L + 0.6, 0.18, 2.6), uv=0.4)
    for x in (-L / 2 - 0.2, L / 2 + 0.2):
        p.box('wood', (x, 1.0, D / 2 + 2.5), (0.14, 1.0, 0.14))
    p.box('wood', (0, 1.1, D / 2 + 2.62), (L + 0.6, 0.09, 0.09))
    p.box('stone', (-L / 2 + 1.4, H + 2.2, -D / 2 + 1.0), (0.9, 2.4, 0.9), uv=0.3)
    p.tube('steel', (L / 2 - 0.3, H + 0.5, 0), (L / 2 - 0.3, H + 5.2, 0), 0.05, 0.04, sides=6)
    return p


def lodge():
    p = Prop('lodge')
    L, D = 34.0, 15.0
    h1, h2 = 2.3, 5.2
    p.box('stone', (0, h1 / 2, 0), (L, h1, D), uv=0.22)
    p.box('wood', (0, h1 + h2 / 2, 0), (L - 1.0, h2, D - 1.0), uv=0.3)
    # gable roof (ridge along x) with a snow blanket
    v, t = geo.prism_roof(0, h1 + h2, 0, L, D / 2 + 0.2, 4.8, overhang=1.2, thickness=0.4, axis='x')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(0, h1 + h2 + 0.36, 0, L, D / 2 + 0.1, 4.55, overhang=1.15, thickness=0.3, axis='x')
    p.add('snow', v, t, 0.3)
    # windows, front (+z) and back
    for zs in (1, -1):
        zc = zs * (D / 2 + 0.02)
        for i in range(7):
            x = -13.5 + i * 4.5
            p.box('glass', (x, h1 + 1.3, zc - zs * 0.55), (2.3, 1.7, 0.1))
            p.box('wood', (x, h1 + 0.35, zc - zs * 0.55 + zs * 0.12), (2.6, 0.2, 0.22), uv=0.4)
            p.box('glass', (x, h1 + h2 - 1.3, zc - zs * 0.55), (2.3, 1.5, 0.1))
        for i in range(4):
            x = -11.0 + i * 7.5
            p.box('glass', (x, 1.15, zc), (3.0, 1.3, 0.1))
        p.box('wood', (0, 1.1, zc + zs * 0.02), (3.4, 2.0, 0.14), uv=0.5)
    # balcony on the front
    p.box('wood', (0, h1 + 0.05 + 0.0, D / 2 + 1.2), (L - 2, 0.22, 2.4), uv=0.4)
    for i in range(0, 34, 2):
        p.box('wood', (-L / 2 + 1 + i, h1 + 0.65, D / 2 + 2.3), (0.08, 1.0, 0.08))
    p.box('wood', (0, h1 + 1.2, D / 2 + 2.3), (L - 2, 0.1, 0.12))
    # chimneys, entrance porch
    p.box('stone', (-9.0, h1 + h2 + 5.6, -1.5), (1.4, 3.0, 1.4), uv=0.3)
    p.box('stone', (8.0, h1 + h2 + 5.2, 2.0), (1.3, 2.6, 1.3), uv=0.3)
    v, t = geo.prism_roof(0, 3.4, D / 2 + 1.7, 6.0, 1.9, 1.2, overhang=0.5, thickness=0.2, axis='z')
    p.add('roof', v, t, 0.3)
    for x in (-2.6, 2.6):
        p.box('wood', (x, 1.7, D / 2 + 2.9), (0.26, 3.4, 0.26), uv=0.4)
    # side wing
    p.box('wood', (-L / 2 - 4.0, 2.1, 0.5), (8, 4.2, 9), uv=0.3)
    v, t = geo.prism_roof(-L / 2 - 4.0, 4.2, 0.5, 9, 4.0, 2.4, overhang=0.8, thickness=0.3, axis='z')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(-L / 2 - 4.0, 4.5, 0.5, 9, 3.9, 2.2, overhang=0.7, thickness=0.22, axis='z')
    p.add('snow', v, t, 0.3)
    p.box('glass', (-L / 2 - 4.0, 2.0, 5.02), (2.4, 1.4, 0.1))
    # flag mast
    p.tube('steel', (L / 2 - 2, h1 + h2 + 4.4, -D / 2 + 1), (L / 2 - 2, h1 + h2 + 12.0, -D / 2 + 1), 0.07, 0.05, sides=6)
    return p


def lift_pylon():
    p = Prop('lift_pylon')
    H = 9.0
    p.tube('steel', (0, 0, 0), (0, H, 0), 0.2, 0.15, sides=10)
    p.box('metal_dark', (0, 0.25, 0), (0.9, 0.5, 0.9))
    p.box('metal_dark', (0, H - 0.4, 0), (5.2, 0.28, 0.3))                       # cross arm along x
    for x in (-2.3, 2.3):
        p.tube('steel', (x, H - 0.25, 0), (x, H + 0.5, 0), 0.09, 0.09, sides=8)
        p.box('metal_dark', (x, H + 0.55, 0), (0.7, 0.16, 0.34))
        p.tube('steel', (x, H + 0.6, -0.16), (x, H + 0.6, 0.16), 0.24, 0.24, sides=12)
    return p


def lift_chair():
    p = Prop('lift_chair')
    p.tube('steel', (0, 0, 0), (0, -1.5, 0), 0.025, 0.025, sides=6)                # hanger from the cable (origin at the cable)
    p.box('chair_dark', (0, -1.55, 0), (1.5, 0.08, 0.05))
    p.box('chair_red', (0, -1.98, 0.02), (1.4, 0.1, 0.5))                        # seat
    p.box('chair_red', (0, -1.72, -0.24), (1.4, 0.55, 0.08))                     # back
    for x in (-0.7, 0.7):
        p.box('chair_dark', (x, -1.8, 0), (0.05, 0.55, 0.05))
    p.box('chair_dark', (0, -2.05, 0.4), (1.4, 0.05, 0.06))                      # foot rest
    return p


def lift_station():
    """open lift terminal. Origin on the ground under the bull wheel (radius 2.3 m, cable height 4.6 m);
    +z points along the cable line (away from the wheel), the shed covers z in [-5.5, 2.5]"""
    p = Prop('lift_station')
    p.box('stone', (0, 0.25, -1.5), (9.0, 0.5, 9.0), uv=0.3)                       # plinth
    for x in (-4.0, 4.0):
        for z in (-5.2, 2.2):
            p.tube('steel', (x, 0.5, z), (x, 5.0, z), 0.16, 0.16, sides=8)
    for z in (-5.2, 2.2):
        p.box('metal_dark', (0, 5.05, z), (8.6, 0.28, 0.3))                        # cross beams
    for x in (-4.0, 4.0):
        p.box('metal_dark', (x, 5.05, -1.5), (0.3, 0.28, 7.6))                     # long beams
    v, t = geo.prism_roof(0, 5.1, -1.5, 8.4, 4.4, 1.5, overhang=0.6, thickness=0.22, axis='z')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(0, 5.3, -1.5, 8.4, 4.3, 1.35, overhang=0.55, thickness=0.2, axis='z')
    p.add('snow', v, t, 0.3)
    p.box('wood', (0, 1.3, -5.3), (8.0, 1.6, 0.16), uv=0.4)                        # back wall boards
    for x in (-4.0, 4.0):
        p.box('wood', (x, 1.05, -1.5), (0.1, 0.2, 7.4))                            # side rails
    # bull wheel: ring, hub, spokes
    n = 28
    R = 2.3
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        p.tube('steel', (R * math.cos(a0), 4.42, R * math.sin(a0)), (R * math.cos(a1), 4.42, R * math.sin(a1)), 0.14, 0.14, sides=6, caps=(False, False))
    p.tube('metal_dark', (0, 0.5, 0), (0, 4.6, 0), 0.25, 0.25, sides=10)
    for k in range(6):
        a = math.pi * k / 3
        p.tube('metal_dark', (R * math.cos(a), 4.42, R * math.sin(a)), (-R * math.cos(a), 4.42, -R * math.sin(a)), 0.05, 0.05, sides=4, caps=(False, False))
    # boarding rail and a small control cabin
    p.box('wood', (-2.3, 0.75, 4.2), (0.12, 0.5, 3.0))
    p.box('wood', (3.2, 1.6, -3.4), (2.2, 2.2, 2.0), uv=0.4)
    p.box('glass', (2.1, 1.9, -3.4), (0.06, 0.9, 1.3))
    return p


# ============================================================================ village and trail furniture
def marker_lvl(level):
    """piste pole coloured by difficulty (black runs get a white band so they read against dark rock)"""
    p = Prop(f'marker_{level}')
    p.tube('marker_dark', (0, 0, 0), (0, 1.5, 0), 0.019, 0.017, sides=6)
    p.tube(f'marker_{level}', (0, 1.5, 0), (0, 2.2, 0), 0.024, 0.021, sides=6)
    if level == 'black':
        p.tube('marker_white', (0, 1.82, 0), (0, 1.94, 0), 0.026, 0.026, sides=6, caps=(False, False))
    return p


def sign(level):
    """trail sign: a post with a rounded difficulty board and a small roof of snow"""
    p = Prop(f'sign_{level}')
    p.box('wood_dark', (0, 1.1, 0), (0.12, 2.2, 0.12))
    p.box(f'marker_{level}', (0, 1.75, 0.08), (0.95, 0.62, 0.05))
    p.box('marker_white', (0, 1.75, 0.112), (0.8, 0.47, 0.02))
    p.box(f'marker_{level}', (0, 1.75, 0.125), (0.66, 0.33, 0.02))
    p.box('marker_white', (0.0, 1.75, 0.14), (0.42, 0.06, 0.02))
    p.box('marker_white', (0.14, 1.75, 0.14), (0.08, 0.2, 0.02), rot=geo.rot_z(45))
    p.box('snow', (0, 2.24, 0), (0.32, 0.06, 0.2))
    return p


def flag_prop():
    p = Prop('flag')
    p.tube('metal_dark', (0, 0, 0), (0, 0.55, 0), 0.10, 0.05, sides=8)
    p.tube('flag_pole', (0, 0.4, 0), (0, 5.2, 0), 0.032, 0.024, sides=6)
    p.tube('flag_pole', (0, 5.2, 0), (0, 5.32, 0), 0.06, 0.02, sides=8)
    # swallow-tailed pennant, double sided
    v = np.array([[0.02, 4.95, 0.0], [1.7, 4.95, 0.0], [1.35, 4.5, 0.0], [1.7, 4.05, 0.0], [0.02, 4.05, 0.0]])
    t = np.array([[0, 1, 2], [0, 2, 4], [2, 3, 4]])
    p.add('flag_cloth', v, np.vstack([t, t[:, ::-1]]))
    for zz in (0.004, -0.004):
        stripe = np.array([[0.02, 4.55, zz], [1.6, 4.55, zz], [1.6, 4.66, zz], [0.02, 4.66, zz]])
        p.add('marker_white', stripe, np.array([[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]]))
    return p


def chalet(name, L=10.0, D=8.0, wall_h=5.2, rise=2.5, dormer=False, lean_to=False, seed=1):
    """alpine chalet: stone plinth, timber walls, deep gable roof with a snow blanket, balcony, shuttered windows.
    The front (balcony, door) faces +z; the ridge runs along x."""
    rng = np.random.default_rng(seed)
    p = Prop(name)
    b = 0.95
    p.box('stone', (0, b / 2, 0), (L + 0.3, b, D + 0.3), uv=0.25)
    p.box('wood', (0, b + wall_h / 2, 0), (L, wall_h, D), uv=0.3)
    p.box('wood', (0, b + wall_h * 0.66, 0), (L + 0.44, wall_h * 0.34, D + 0.44), uv=0.3)      # jettied upper storey
    eave = b + wall_h
    v, t = geo.prism_roof(0, eave, 0, L, D / 2 + 0.4, rise, overhang=1.35, thickness=0.36, axis='x')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(0, eave + 0.33, 0, L, D / 2 + 0.3, rise - 0.15, overhang=1.3, thickness=0.28, axis='x')
    p.add('snow', v, t, 0.3)
    n = max(2, int(L // 3.4))
    xs = np.linspace(-L / 2 + 1.7, L / 2 - 1.7, n)
    for zs in (1, -1):
        zc = zs * (D / 2 + 0.24 * 0)
        for i, x in enumerate(xs):
            for yy, hh in ((b + 1.35, 1.25), (b + wall_h - 1.05, 1.1)):
                if zs > 0 and i == n // 2 and yy < b + 2:
                    continue                                                                # the door
                p.box('glass', (x, yy, zc + zs * (D / 2 * 0 + 0.02) + 0 * zs), (1.0, hh, 0.06))
                p.box('wood_dark', (x - 0.62, yy, zc + zs * 0.03), (0.28, hh + 0.1, 0.08))   # shutters
                p.box('wood_dark', (x + 0.62, yy, zc + zs * 0.03), (0.28, hh + 0.1, 0.08))
    # gable end windows
    for xs_ in (1, -1):
        p.box('glass', (xs_ * (L / 2 + 0.02), b + wall_h * 0.5, 0), (0.06, 1.2, 1.0))
    # front door, steps
    p.box('wood_dark', (xs[n // 2], b + 1.05, D / 2 + 0.05), (1.3, 2.1, 0.1))
    p.box('stone', (xs[n // 2], 0.2, D / 2 + 0.6), (1.8, 0.4, 1.0), uv=0.3)
    # balcony on the jetty, with a railing
    by = b + wall_h * 0.46
    p.box('wood', (0, by, D / 2 + 0.95), (L - 0.4, 0.14, 1.5), uv=0.4)
    for i in range(int(L * 2) - 1):
        p.box('wood_dark', (-L / 2 + 0.5 + i * 0.5, by + 0.5, D / 2 + 1.68), (0.05, 0.9, 0.05))
    p.box('wood_dark', (0, by + 0.98, D / 2 + 1.68), (L - 0.4, 0.07, 0.1))
    for x in (-L / 2 + 0.3, L / 2 - 0.3):
        p.box('wood_dark', (x, by + 0.5, D / 2 + 1.68), (0.1, 1.0, 0.1))
    if dormer:
        p.box('wood', (L * 0.18, eave + rise * 0.28, D * 0.18), (2.4, 1.6, 2.2), uv=0.3)
        v, t = geo.prism_roof(L * 0.18, eave + rise * 0.28 + 0.8, D * 0.18, 2.4, 1.3, 0.9, overhang=0.35, thickness=0.2, axis='z')
        p.add('roof', v, t, 0.3)
        p.box('glass', (L * 0.18, eave + rise * 0.28, D * 0.18 + 1.12), (1.2, 0.9, 0.06))
    if lean_to:
        p.box('wood', (-L / 2 - 1.6, b + 1.6, -0.5), (3.2, 3.2, D * 0.6), uv=0.3)
        v, t = geo.prism_roof(-L / 2 - 1.6, b + 3.2, -0.5, D * 0.6, 1.9, 0.9, overhang=0.4, thickness=0.2, axis='z')
        p.add('roof', v, t, 0.3)
        p.box('stone', (-L / 2 - 1.6, 0.4, -0.5), (3.5, 0.8, D * 0.6 + 0.3), uv=0.3)
    # chimney
    p.box('stone', (L * (0.28 if seed % 2 else -0.28), eave + rise * 0.75, -D * 0.12), (0.9, rise * 1.1 + 0.6, 0.9), uv=0.3)
    # woodpile against the wall
    p.box('wood', (-L / 2 + 1.2, 0.55, -D / 2 - 0.35), (1.8, 1.0, 0.5), uv=0.5)
    return p


def chapel():
    p = Prop('chapel')
    W, L, H = 6.6, 11.0, 5.0
    p.box('stone', (0, 0.4, -1.0), (W + 0.4, 0.8, L + 0.4), uv=0.25)
    p.box('plaster', (0, 0.8 + H / 2, -1.0), (W, H, L), uv=0.3)
    v, t = geo.prism_roof(0, 0.8 + H, -1.0, L, W / 2 + 0.2, 3.2, overhang=0.7, thickness=0.3, axis='z')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(0, 0.8 + H + 0.28, -1.0, L, W / 2 + 0.1, 3.0, overhang=0.65, thickness=0.24, axis='z')
    p.add('snow', v, t, 0.3)
    for xs in (1, -1):
        for k in range(3):
            p.box('glass', (xs * (W / 2 + 0.02), 0.8 + 2.7, -4.5 + k * 3.5), (0.06, 2.0, 0.9))
            p.box('stone', (xs * (W / 2 + 0.04), 0.8 + 3.75, -4.5 + k * 3.5), (0.05, 0.3, 1.1), uv=0.3)
    # bell tower over the front (+z) end
    tz = L / 2 - 1.0 + 1.2
    p.box('plaster', (0, 0.8 + 5.5, tz), (3.6, 11.0, 3.6), uv=0.3)
    p.box('stone', (0, 0.4, tz), (4.0, 0.8, 4.0), uv=0.25)
    p.box('glass_dark', (0, 0.8 + 9.6, tz), (2.0, 1.8, 3.7))
    p.box('glass_dark', (0, 0.8 + 9.6, tz), (3.7, 1.8, 2.0))
    p.tube('roof', (0, 0.8 + 11.0, tz), (0, 0.8 + 16.5, tz), 2.55, 0.06, sides=4, caps=(True, False))
    p.tube('roof', (0, 0.8 + 11.0, tz), (0, 0.8 + 16.5, tz), 2.55, 0.06, sides=4, caps=(False, False))
    p.box('snow', (0, 0.8 + 11.05, tz), (3.9, 0.1, 3.9))
    p.box('metal_dark', (0, 0.8 + 17.0, tz), (0.1, 1.2, 0.1))
    p.box('metal_dark', (0, 0.8 + 17.2, tz), (0.6, 0.1, 0.1))
    # door with a stone surround, steps
    p.box('stone', (0, 0.8 + 1.7, tz + 1.82), (2.2, 3.4, 0.1), uv=0.3)
    p.box('wood_dark', (0, 0.8 + 1.5, tz + 1.86), (1.6, 3.0, 0.1))
    p.box('stone', (0, 0.2, tz + 2.6), (2.6, 0.4, 1.6), uv=0.3)
    p.box('glass', (0, 0.8 + 6.4, tz + 1.82), (0.8, 1.4, 0.06))
    return p


def alp_hut():
    """mountain restaurant: long timber house, big roof, terrace with parasols (front = +z)"""
    p = Prop('alp_hut')
    L, D, H = 16.0, 9.0, 3.6
    p.box('stone', (0, 0.5, 0), (L + 0.3, 1.0, D + 0.3), uv=0.25)
    p.box('wood', (0, 1.0 + H / 2, 0), (L, H, D), uv=0.3)
    v, t = geo.prism_roof(0, 1.0 + H, 0, L, D / 2 + 0.5, 2.6, overhang=1.5, thickness=0.36, axis='x')
    p.add('roof', v, t, 0.3)
    v, t = geo.prism_roof(0, 1.0 + H + 0.32, 0, L, D / 2 + 0.4, 2.45, overhang=1.45, thickness=0.28, axis='x')
    p.add('snow', v, t, 0.3)
    for i in range(6):
        x = -6.5 + i * 2.6
        p.box('glass', (x, 1.0 + 1.9, D / 2 + 0.02), (1.7, 1.5, 0.06))
        p.box('wood_dark', (x, 1.0 + 1.1, D / 2 + 0.04), (1.9, 0.12, 0.1))
        p.box('glass', (x, 1.0 + 1.9, -D / 2 - 0.02), (1.7, 1.5, 0.06))
    p.box('wood_dark', (0, 1.0 + 1.1, D / 2 + 0.05), (1.5, 2.2, 0.1))
    # terrace
    p.box('wood', (0, 0.95, D / 2 + 2.0), (L + 1.0, 0.16, 4.0), uv=0.4)
    for i in range(int(L) + 1):
        p.box('wood_dark', (-L / 2 - 0.4 + i * 1.0, 1.45, D / 2 + 3.92), (0.05, 0.9, 0.05))
    p.box('wood_dark', (0, 1.9, D / 2 + 3.92), (L + 1.0, 0.07, 0.1))
    for x in (-L / 2 - 0.4, L / 2 + 0.4):
        p.box('wood_dark', (x, 1.45, D / 2 + 3.92), (0.1, 1.0, 0.1))
    for x in (-5.0, 0.0, 5.0):                                                       # parasols
        p.tube('steel', (x, 0.95, D / 2 + 2.4), (x, 3.3, D / 2 + 2.4), 0.04, 0.035, sides=6)
        p.tube('panel_red' if x == 0 else 'panel_blue', (x, 2.7, D / 2 + 2.4), (x, 3.35, D / 2 + 2.4), 1.55, 0.05, sides=8, caps=(False, True))
        p.box('wood', (x - 0.6, 1.4, D / 2 + 2.0), (0.9, 0.06, 0.5), uv=0.4)
        p.box('wood', (x + 0.6, 1.4, D / 2 + 2.9), (0.9, 0.06, 0.5), uv=0.4)
    p.box('stone', (-5.0, 1.0 + H + 2.6, -1.0), (1.1, 2.6, 1.1), uv=0.3)
    p.box('wood_dark', (0, 1.0 + H + 0.05, D / 2 + 0.1), (4.0, 0.8, 0.12))
    return p


def summit_cross():
    p = Prop('summit_cross')
    p.box('stone', (0, 0.45, 0), (2.4, 0.9, 2.4), uv=0.3)
    p.box('stone', (0, 1.1, 0), (1.6, 0.5, 1.6), uv=0.3)
    p.box('wood', (0, 3.5, 0), (0.26, 4.8, 0.26), uv=0.4)
    p.box('wood', (0, 4.6, 0), (1.9, 0.24, 0.24), uv=0.4)
    p.box('marker_white', (0, 0.85, 0.85), (0.5, 0.35, 0.05))
    return p


# ============================================================================ main
def main():
    C.reset_scene()
    M = build_materials()
    props = [gate('red'), gate('blue'), marker(), post('start_post', 6.5, 0.24), post('finish_post', 7.5, 0.26),
             banner('banner_start', 'banner_start'), banner('banner_finish', 'banner_finish'), banner('banner_check', 'banner_check'),
             net('orange'), net('blue'), hut(), lodge(), lift_pylon(), lift_chair(), lift_station(),
             chalet('chalet_a', 10.0, 8.0, 5.2, 2.5, dormer=True, seed=1), chalet('chalet_b', 12.5, 9.0, 5.6, 2.8, lean_to=True, seed=2),
             chalet('chalet_c', 8.5, 7.0, 4.8, 2.2, seed=3), chapel(), alp_hut(), summit_cross(), flag_prop(),
             marker_lvl('green'), marker_lvl('blue'), marker_lvl('red'), marker_lvl('black'),
             sign('green'), sign('blue'), sign('red'), sign('black')]
    objs = []
    stats = {}
    for pr in props:
        o = to_objects(pr, M)
        stats[pr.name] = sum(len(x.data.polygons) for x in o)
        objs += o
    print('triangles per prop:', stats)
    out = os.path.join(C.ASSETS, 'models', 'props.glb')
    C.export_glb(out, objs, materials=True, jpeg=True, jpeg_quality=90)
    if '--preview' in sys.argv:
        preview(objs)


def preview(objs):
    """Cycles stills of the buildings and the gate for a quick check"""
    import math
    sc = bpy.context.scene
    C.setup_cycles(samples=32, denoise=True, res=(900, 560))
    w = bpy.data.worlds.new('studio')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.68, 0.8, 1)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    ground = C.mesh_from_arrays('g', [[-80, -80, 0], [80, -80, 0], [80, 80, 0], [-80, 80, 0]], [[0, 1, 2], [0, 2, 3]])
    gm = C.Mat('gm', base=(0.9, 0.93, 0.97, 1), rough=0.8)
    ground.data.materials.append(gm.mat)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 35
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    # move props into a row: lodge at origin, hut and gates beside
    shots = {'lodge': ('lodge', (-8, -55, 9), 88), 'hut': ('hut', (-6, -22, 4), 84)}
    for name, (prefix, pos, pitch) in shots.items():
        for ob in bpy.data.objects:
            if ob.type == 'MESH' and ob.name not in ('g',):
                ob.hide_render = not ob.name.startswith(prefix + '__')
        co.location = pos
        co.rotation_euler = (math.radians(pitch), 0, 0)
        C.render_to(os.path.join(C.BUILD, f'props_{name}.png'), 'PNG', 'RGB')
    print('previews written')


if __name__ == '__main__':
    main()
