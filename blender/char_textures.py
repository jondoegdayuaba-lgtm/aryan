# The character texture atlas: one 2048x2048 image holding detail tiles for
# every material on the cowboy (cotton, canvas, denim, wool, leather, felt,
# bandana print, hair, skin, a flat white tile) and a painted face.
#
# Tiles are mostly light and greyish: each material's base colour multiplies
# them, so the game can recolour clothing per character. The face is painted
# in real colours and used as is.
import math
import os
import numpy as np
import bpy

from common import TEXTURES
from textures import fbm, hexc

N = 512
ATLAS = 2048
TILES = {
    'cotton': (0, 0), 'canvas': (1, 0), 'denim': (2, 0), 'wool': (3, 0),
    'leather': (0, 1), 'felt': (1, 1), 'bandana': (2, 1), 'hair': (3, 1),
    'skin': (0, 2), 'flat': (1, 2), 'plaid': (0, 3), 'suede': (1, 3),
}
FACE = (2, 2)       # top-left tile of the 2x2-tile face region

# Face layout in head space, shared with the head sculpt in characters.py.
# The head's UVs are cylindrical: u = 0.5 + angle/2pi (0.5 = straight ahead),
# v = (z - chin) / height.
HEAD_H = 0.25
EYE_Z, BROW_Z, NOSE_Z, MOUTH_Z = 0.141, 0.165, 0.098, 0.068   # above the chin
EYE_X = 0.033
SKIN = '#b67d5c'


def tile_rect(name):
    """UV rectangle (u0, v0, u1, v1) of a tile, inset to avoid bleeding."""
    if name == 'face':
        tx, ty = FACE
        w = 2
    else:
        tx, ty = TILES[name]
        w = 1
    inset = 6 / ATLAS
    u0 = tx * N / ATLAS + inset
    u1 = (tx + w) * N / ATLAS - inset
    v1 = 1 - ty * N / ATLAS - inset
    v0 = 1 - (ty + w) * N / ATLAS + inset
    return u0, v0, u1, v1


def grid(n):
    y, x = np.mgrid[0:n, 0:n] / n
    return x, y


def norm(a):
    a = a - a.min()
    return a / (a.max() or 1)


def gray(v):
    return np.repeat(v[..., None], 3, axis=2)


def cotton():
    x, y = grid(N)
    weave = 0.5 + 0.5 * np.sin(x * N * 1.4) * np.sin(y * N * 1.4)
    mott = fbm(N, 2.2, 601)
    fine = fbm(N, 1.0, 602)
    v = 0.9 + 0.05 * (weave - 0.5) + 0.12 * (mott - 0.5) + 0.04 * (fine - 0.5)
    # Faint sweat and dirt toward the bottom (hems) and in patches
    v -= 0.08 * np.clip(fbm(N, 2.8, 603) - 0.62, 0, 1) * 3
    return gray(np.clip(v, 0, 1))


def canvas():
    x, y = grid(N)
    warp = np.sin(x * N * 2.2 + 3 * fbm(N, 2.0, 611)) * 0.5 + 0.5
    weft = np.sin(y * N * 2.2) * 0.5 + 0.5
    weave = np.where((np.floor(x * N / 2) + np.floor(y * N / 2)) % 2 == 0, warp, weft)
    mott = fbm(N, 2.4, 612)
    v = 0.88 + 0.06 * (weave - 0.5) + 0.16 * (mott - 0.5)
    dirt = np.clip(y - 0.55, 0, 1) * 0.35 * (0.6 + 0.8 * fbm(N, 2.0, 613))   # dusty hem
    v -= dirt
    wear = np.clip(fbm(N, 2.8, 614) - 0.7, 0, 1) * 1.2
    v += wear * 0.15
    return gray(np.clip(v, 0, 1))


def denim():
    x, y = grid(N)
    twill = 0.5 + 0.5 * np.sin((x + y) * N * 1.6)
    mott = fbm(N, 2.2, 621)
    v = 0.86 + 0.07 * (twill - 0.5) + 0.14 * (mott - 0.5)
    v += 0.1 * np.clip(fbm(N, 2.6, 622) - 0.6, 0, 1) * 2.5     # faded patches
    v -= np.clip(y - 0.7, 0, 1) * 0.3                           # dust at the cuffs
    return gray(np.clip(v, 0, 1))


def wool():
    mott = fbm(N, 1.6, 631)
    big = fbm(N, 2.6, 632)
    v = 0.88 + 0.1 * (mott - 0.5) + 0.1 * (big - 0.5)
    return gray(np.clip(v, 0, 1))


def leather():
    grain = fbm(N, 1.3, 641)
    big = fbm(N, 2.6, 642)
    cracks = np.abs(fbm(N, 2.0, 643) - 0.5) < 0.012
    v = 0.86 + 0.1 * (grain - 0.5) + 0.18 * (big - 0.5)
    v = np.where(cracks, v * 0.75, v)
    scuff = np.clip(fbm(N, 2.9, 644) - 0.66, 0, 1) * 2.2
    v += scuff * 0.2
    return gray(np.clip(v, 0, 1))


def felt():
    mott = fbm(N, 1.9, 651)
    v = 0.9 + 0.12 * (mott - 0.5)
    sweat = np.clip(fbm(N, 2.7, 652) - 0.6, 0, 1) * 1.8
    v -= sweat * 0.18
    return gray(np.clip(v, 0, 1))


def bandana():
    """Paisley-ish print: light motifs on the base colour."""
    x, y = grid(N)
    v = np.full((N, N), 0.72)
    rng = np.random.default_rng(661)
    cell = 64
    for cy in range(0, N, cell):
        for cx in range(0, N, cell):
            ox = cx + cell / 2 + rng.uniform(-10, 10)
            oy = cy + cell / 2 + rng.uniform(-10, 10)
            a = rng.uniform(0, 6.28)
            px = x * N - ox
            py = y * N - oy
            r = np.hypot(px, py)
            ang = np.arctan2(py, px) - a
            # A teardrop outline with a dot inside
            shape = r < 14 * (0.55 + 0.45 * np.cos(ang / 2) ** 2)
            ring = shape & (r > 9 * (0.55 + 0.45 * np.cos(ang / 2) ** 2))
            v = np.where(ring, 1.0, v)
            v = np.where(r < 3, 1.0, v)
    v = v * (0.92 + 0.12 * fbm(N, 2.0, 662))
    return gray(np.clip(v, 0, 1))


def hair():
    x, y = grid(N)
    streak = fbm(N, 2.0, 671, aspect=(1.0, 0.04))
    fine = fbm(N, 1.2, 672, aspect=(1.0, 0.1))
    v = 0.72 + 0.25 * (streak - 0.5) + 0.25 * (fine - 0.5)
    return gray(np.clip(v, 0, 1))


def skin_tile():
    mott = fbm(N, 2.3, 681)
    pores = fbm(N, 0.8, 682)
    base = np.ones((N, N, 3))
    red = np.array([1.0, 0.93, 0.92])
    t = np.clip(mott, 0, 1)[..., None]
    out = base * (1 - 0.12 * t) + (red - 1) * 0.5 * t
    out *= (0.97 + 0.05 * (pores[..., None] - 0.5))
    return np.clip(out, 0, 1)


def plaid():
    x, y = grid(N)
    bx = (np.floor(x * 8) % 2 == 0).astype(float)
    by = (np.floor(y * 8) % 2 == 0).astype(float)
    thin = ((np.abs((x * 16) % 1 - 0.5) < 0.06) | (np.abs((y * 16) % 1 - 0.5) < 0.06)).astype(float)
    v = 0.6 + 0.18 * bx + 0.18 * by - 0.25 * thin
    v *= 0.92 + 0.12 * fbm(N, 1.5, 691)
    return gray(np.clip(v, 0, 1))


def gauss(d2):
    return np.exp(-d2)


def face():
    """The face, painted in real colours on the head's cylindrical unwrap."""
    n = 2 * N
    u, vv = grid(n)
    v = 1 - vv                       # image row 0 is the top of the head
    # Distances in metres on the face: around (via angle at ~0.09 m radius) and up
    du = (u - 0.5) * 2 * math.pi * 0.09
    dz = v * HEAD_H
    base = hexc(SKIN)
    col = np.ones((n, n, 3)) * base
    mott = fbm(n, 2.3, 701)[..., None]
    col *= 0.94 + 0.12 * mott
    # Warmer cheeks, nose and ears
    flush = (gauss(((np.abs(du) - 0.045) / 0.022) ** 2 + ((dz - 0.112) / 0.022) ** 2)
             + 0.8 * gauss((du / 0.012) ** 2 + ((dz - NOSE_Z) / 0.018) ** 2))[..., None]
    col = col * (1 - 0.18 * flush) + hexc('#b8584a') * 0.18 * flush
    # Stubble on jaw, chin and upper lip
    jaw = np.clip(1 - (dz - 0.02) / 0.075, 0, 1) * (np.abs(du) < 0.085)
    cheek_line = gauss(((dz - 0.11 + 0.25 * np.abs(du)) / 0.03) ** 2)
    stub_mask = np.clip(jaw + 0.6 * cheek_line * (np.abs(du) < 0.07), 0, 1)
    lip_hole = gauss((du / 0.026) ** 2 + ((dz - MOUTH_Z) / 0.008) ** 2)
    stub_mask = stub_mask * (1 - lip_hole) * (np.abs(du) < 0.1)
    speck = fbm(n, 0.6, 702)
    stub = (stub_mask * (0.5 + 0.7 * speck))[..., None]
    col = col * (1 - 0.32 * stub) + hexc('#3a2a20') * 0.32 * stub * 0.6
    # Lips
    lips = gauss((du / 0.024) ** 2 + ((dz - MOUTH_Z - 0.004) / 0.007) ** 2)
    lips += gauss((du / 0.022) ** 2 + ((dz - MOUTH_Z + 0.006) / 0.006) ** 2)
    lips = np.clip(lips, 0, 1)[..., None]
    col = col * (1 - 0.45 * lips) + hexc('#8e4a3e') * 0.45 * lips
    line = gauss((du / 0.025) ** 2 + ((dz - MOUTH_Z) / 0.0018) ** 2)[..., None]
    col = col * (1 - 0.55 * line) + hexc('#3a1e18') * 0.55 * line
    for k in (-1, 1):
        ex = k * EYE_X
        # Eye socket shadow and upper-lid crease
        sock = gauss(((du - ex) / 0.02) ** 2 + ((dz - EYE_Z) / 0.012) ** 2)[..., None]
        col = col * (1 - 0.25 * sock) + hexc('#6a4434') * 0.25 * sock
        crease = gauss(((du - ex) / 0.016) ** 2 + ((dz - EYE_Z - 0.008) / 0.0022) ** 2)[..., None]
        col = col * (1 - 0.35 * crease) + hexc('#5a3a2c') * 0.35 * crease
        # Eyebrow: a thick arc of short strokes
        bx = (du - ex) / 0.022
        arc = BROW_Z + 0.004 * (1 - bx ** 2) - 0.003 * k * bx * 0
        brow = (np.abs(bx) < 1.0) * gauss(((dz - arc) / (0.0042 * (1.1 - 0.4 * np.abs(bx + 0.3 * k)))) ** 2)
        strokes = 0.6 + 0.6 * fbm(n, 0.7, 710 + k, aspect=(0.3, 1.0))
        brow = np.clip(brow * strokes, 0, 1)[..., None]
        col = col * (1 - 0.85 * brow) + hexc('#2c1d14') * 0.85 * brow
    # Nostrils
    for k in (-1, 1):
        nos = gauss(((du - k * 0.009) / 0.004) ** 2 + ((dz - NOSE_Z + 0.012) / 0.003) ** 2)[..., None]
        col = col * (1 - 0.6 * nos) + hexc('#3a2018') * 0.6 * nos
    return np.clip(col, 0, 1)


def build_atlas():
    img = np.ones((ATLAS, ATLAS, 3))
    makers = {'cotton': cotton, 'canvas': canvas, 'denim': denim, 'wool': wool, 'leather': leather, 'felt': felt,
              'bandana': bandana, 'hair': hair, 'skin': skin_tile, 'flat': lambda: np.ones((N, N, 3)),
              'plaid': plaid, 'suede': wool}
    for name, (tx, ty) in TILES.items():
        img[ty * N:(ty + 1) * N, tx * N:(tx + 1) * N] = makers[name]()
    fx, fy = FACE
    img[fy * N:(fy + 2) * N, fx * N:(fx + 2) * N] = face()
    out = bpy.data.images.new('character', ATLAS, ATLAS, alpha=False)
    px = np.concatenate([img, np.ones((ATLAS, ATLAS, 1))], axis=2)[::-1]
    out.pixels.foreach_set(px.astype(np.float32).ravel())
    os.makedirs(TEXTURES, exist_ok=True)
    path = os.path.join(TEXTURES, 'character.jpg')
    out.filepath_raw = path
    out.file_format = 'JPEG'
    try:
        out.save(quality=90)
    except TypeError:
        out.save()
    return out
