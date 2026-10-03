# Tileable textures, painted with numpy and saved through Blender's image API.
# Each is periodic, so it repeats without seams on walls, floors and ground.
import os
import numpy as np
import bpy

from common import TEXTURES


def fbm(n, beta=2.2, seed=0, aspect=(1.0, 1.0)):
    """Periodic fractal noise in 0..1: white noise shaped by 1/f^beta in Fourier space."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((n, n))
    fy = np.fft.fftfreq(n)[:, None] * aspect[1]
    fx = np.fft.fftfreq(n)[None, :] * aspect[0]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spec = np.fft.fft2(white) / f ** (beta / 2)
    spec[0, 0] = 0
    out = np.real(np.fft.ifft2(spec))
    out -= out.min()
    return out / out.max()


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def save(name, rgb, alpha=None):
    """rgb: (h, w, 3) in sRGB 0..1, row 0 at the top."""
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    a = np.ones((h, w, 1)) if alpha is None else alpha[..., None]
    px = np.concatenate([np.clip(rgb, 0, 1), a], axis=2)[::-1]   # Blender stores bottom row first
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    os.makedirs(TEXTURES, exist_ok=True)
    path = os.path.join(TEXTURES, name + '.jpg')
    img.filepath_raw = path
    img.file_format = 'JPEG'
    try:
        img.save(quality=88)
    except TypeError:
        img.save()
    return img


def hash2(i, j, seed):
    """Per-cell random value in 0..1 for integer arrays i, j."""
    i = np.asarray(i, dtype=np.uint64)
    j = np.asarray(j, dtype=np.uint64)
    m = np.uint64(0xFFFFFFFF)
    x = (i * np.uint64(374761393) + j * np.uint64(668265263) + np.uint64(seed * 2246822519)) & m
    x = ((x ^ (x >> np.uint64(13))) * np.uint64(1274126177)) & m
    return ((x ^ (x >> np.uint64(16))) & np.uint64(0xFFFF)).astype(np.float64) / 65535.0


def brick(n=512):
    # 5 bricks across, 15 rows per tile (tile = 1.2 m)
    cols, rows = 5, 15
    y, x = np.mgrid[0:n, 0:n] / n
    row = np.floor(y * rows).astype(int)
    xo = x * cols + (row % 2) * 0.5
    col = np.floor(xo).astype(int) % cols
    fx = xo - np.floor(xo)
    fy = y * rows - row
    mortar = np.maximum(np.clip((0.045 - np.minimum(fx, 1 - fx) * 1.0) * 60, 0, 1),
                        np.clip((0.09 - np.minimum(fy, 1 - fy)) * 40, 0, 1))
    hv = hash2(col, row, 3)
    hv2 = hash2(col, row, 9)
    base = mix(hexc('#6e3a2a'), hexc('#8a4c35'), hv)
    base = mix(base, hexc('#4a2a22'), (hv2 > 0.82) * 0.7)
    base = mix(base, hexc('#9a6a52'), (hv2 < 0.08) * 0.6)
    grit = fbm(n, 1.2, 4)
    soot = fbm(n, 2.6, 5)
    base = base * (0.82 + 0.3 * grit[..., None])
    base = mix(base, hexc('#2c2420'), np.clip(soot - 0.55, 0, 1) * 1.2)
    mort = hexc('#8d857a') * (0.85 + 0.25 * grit[..., None])
    out = mix(base, mort, mortar)
    return save('brick', out)


def boards(name, n, count, colors, gap_color, seed, vertical=False, gap=0.05, lap=False, worn=0.0):
    y, x = np.mgrid[0:n, 0:n] / n
    if vertical:
        x, y = y, x
    idx = np.floor(y * count).astype(int)
    fy = y * count - idx
    hv = hash2(idx, idx * 7, seed)
    base = mix(hexc(colors[0]), hexc(colors[1]), hv)
    grain = fbm(n, 2.0, seed + 1, aspect=(0.08, 1.0) if not vertical else (1.0, 0.08))
    fine = fbm(n, 1.0, seed + 2)
    base = base * (0.78 + 0.35 * grain[..., None]) * (0.92 + 0.12 * fine[..., None])
    # Board ends every so often
    cut = (hash2(idx, 1, seed) * 0.8 + 0.1)
    xe = np.abs(((x - cut) % 0.5) - 0.0)
    endline = np.clip((0.006 - np.minimum(xe, 0.5 - xe)) * 300, 0, 1)
    edge = np.clip((gap - np.minimum(fy, 1 - fy)) * (1 / gap) * 1.5, 0, 1)
    if lap:
        # Clapboard: shadow under each board's lower edge
        edge = np.clip((0.22 - fy) / 0.22, 0, 1) ** 2 * 0.8
    out = mix(base, hexc(gap_color), np.maximum(edge, endline * 0.8))
    if worn:
        w = fbm(n, 2.4, seed + 3)
        out = mix(out, hexc('#a39a8a'), np.clip((w - 0.6) * 3, 0, 1) * worn)
    return save(name, out)


def shingles(n=512):
    rows, cols = 10, 6
    y, x = np.mgrid[0:n, 0:n] / n
    row = np.floor(y * rows).astype(int)
    xo = x * cols + (row % 2) * 0.5
    col = np.floor(xo).astype(int) % cols
    fx = xo - np.floor(xo)
    fy = y * rows - row
    hv = hash2(col, row, 11)
    base = mix(hexc('#4b4038'), hexc('#6a5a4c'), hv)
    grain = fbm(n, 2.0, 12, aspect=(1.0, 0.1))
    base = base * (0.75 + 0.4 * grain[..., None])
    shade = np.clip((fy - 0.65) / 0.35, 0, 1) * 0.6 + np.clip((0.03 - np.minimum(fx, 1 - fx)) * 40, 0, 1) * 0.7
    out = mix(base, hexc('#1e1814'), shade)
    moss = fbm(n, 2.8, 13)
    out = mix(out, hexc('#5a5a3a'), np.clip(moss - 0.7, 0, 1) * 1.5)
    return save('shingles', out)


def ground(name, n, a, b, c, seed, speck=0.0, beta=1.8):
    big = fbm(n, 2.6, seed)
    mid = fbm(n, 1.8, seed + 1)
    fine = fbm(n, beta - 1.0, seed + 2)
    out = mix(hexc(a), hexc(b), np.clip(big * 1.4 - 0.2, 0, 1))
    out = mix(out, hexc(c), np.clip(mid - 0.55, 0, 1) * 2)
    out = out * (0.8 + 0.4 * fine[..., None])
    if speck:
        rng = np.random.default_rng(seed + 9)
        s = rng.random((n, n)) > 1 - speck
        out[s] = out[s] * 1.3 + 0.05
    return save(name, out)


def canvas(n=256):
    y, x = np.mgrid[0:n, 0:n] / n
    weave = 0.5 + 0.25 * np.sin(x * n * np.pi) * np.sin(y * n * np.pi)
    stain = fbm(n, 2.4, 21)
    out = mix(hexc('#cfc2a2'), hexc('#a8987a'), stain)
    out = out * (0.9 + 0.12 * weave[..., None])
    return save('canvas', out)


def bark(n=256):
    y, x = np.mgrid[0:n, 0:n] / n
    ridges = fbm(n, 2.0, 31, aspect=(1.0, 0.12))
    out = mix(hexc('#2e241c'), hexc('#5d4a3a'), ridges)
    return save('bark', out)


def build_all():
    return {
        'brick': brick(),
        'clapboard': boards('clapboard', 512, 8, ('#8a7962', '#9d8a70'), '#3a3028', 41, lap=True, worn=0.5),
        'whiteboard': boards('whiteboard', 512, 8, ('#c9c0ac', '#d6cdb8'), '#5d564c', 42, lap=True, worn=0.8),
        'planks': boards('planks', 512, 6, ('#6d5843', '#86705a'), '#1d1612', 43),
        'barnboard': boards('barnboard', 512, 6, ('#7a2f22', '#8d3a2a'), '#2a1612', 44, vertical=True, worn=0.9),
        'logs': boards('logs', 512, 4, ('#5e4a36', '#6e5840'), '#241a12', 45, gap=0.18),
        'shingles': shingles(),
        'canvas': canvas(),
        'bark': bark(),
        'grass': ground('grass', 512, '#5f6b32', '#7c7a3c', '#4d5a2a', 51, 0.02),
        'dirt': ground('dirt', 512, '#7a6448', '#8d7556', '#5e4c38', 52, 0.04),
        'rock': ground('rock', 512, '#6d6a64', '#8a857c', '#4e4b47', 53, 0.03, beta=2.2),
        'snow': ground('snow', 256, '#dfe4ea', '#f2f4f7', '#c8d0da', 54),
    }
