"""Tileable stylised PBR textures for Outbuild, generated with numpy.

Each texture is written as <name>.jpg (albedo, sRGB) and <name>_n.jpg (tangent-space
normal map, OpenGL convention). Most cover 2 m x 2 m of surface; the models' UVs are
box-projected at that scale (see pieces.py), terrain tiles are sized in terrain.js.

    python textures.py [name ...]
"""
import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets', 'textures'))


# ----------------------------------------------------------------------------- noise

def value_noise(n, freq, rng):
    """Periodic value noise on an n x n grid with `freq` cells per tile (smooth, wraps)."""
    lat = rng.random((freq, freq))
    x = np.arange(n) * freq / n
    i0 = np.floor(x).astype(int)
    f = x - i0
    f = f * f * f * (f * (f * 6 - 15) + 10)
    i1 = (i0 + 1) % freq
    i0 %= freq
    a = lat[np.ix_(i0, i0)]
    b = lat[np.ix_(i0, i1)]
    c = lat[np.ix_(i1, i0)]
    d = lat[np.ix_(i1, i1)]
    fy = f[:, None]
    fx = f[None, :]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(n, base, octaves, rng, gain=0.5, aniso=(1, 1)):
    """Fractal periodic noise. aniso=(fy, fx) multiplies frequency per axis (integers)."""
    out = np.zeros((n, n))
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        fq = base * 2 ** o
        fy, fx = max(1, fq * aniso[0]), max(1, fq * aniso[1])
        lat = rng.random((fy, fx))
        yy = np.arange(n) * fy / n
        xx = np.arange(n) * fx / n
        y0 = np.floor(yy).astype(int)
        x0 = np.floor(xx).astype(int)
        ty = yy - y0
        tx = xx - x0
        ty = ty * ty * (3 - 2 * ty)
        tx = tx * tx * (3 - 2 * tx)
        y1 = (y0 + 1) % fy
        x1 = (x0 + 1) % fx
        y0 %= fy
        x0 %= fx
        a = lat[np.ix_(y0, x0)]
        b = lat[np.ix_(y0, x1)]
        c = lat[np.ix_(y1, x0)]
        d = lat[np.ix_(y1, x1)]
        v = (a * (1 - tx[None]) + b * tx[None]) * (1 - ty[:, None]) + (c * (1 - tx[None]) + d * tx[None]) * ty[:, None]
        out += v * amp
        tot += amp
        amp *= gain
    return out / tot


def voronoi(n, count, rng, jitter=1.0, aspect=(1.0, 1.0)):
    """Periodic Voronoi: returns (F1 distance, F2-F1 edge distance, cell id). Distances in tile units."""
    pts = rng.random((count, 2))
    ys, xs = np.mgrid[0:n, 0:n] / n
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    cid = np.zeros((n, n), dtype=int)
    for k, (py, px) in enumerate(pts):
        dy = np.abs(ys - py)
        dx = np.abs(xs - px)
        dy = np.minimum(dy, 1 - dy) * aspect[0]
        dx = np.minimum(dx, 1 - dx) * aspect[1]
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, k, cid)
        f1 = np.where(closer, d, f1)
    return f1, f2 - f1, cid


def blur(a, r=1):
    out = a.copy()
    for _ in range(r):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5
    return out


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    t = np.asarray(t)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1 - t) + b * t


def col(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def normal_from_height(h, strength):
    """Height in [0,1] -> OpenGL tangent-space normal map. `strength` ~ relief in texels."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength  # rows go down the image = -v
    nx = -dx
    ny = dy  # +v is up in the image
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5


def save(name, albedo, height=None, strength=8.0, normal=None, quality=88):
    os.makedirs(OUT, exist_ok=True)
    a = np.clip(albedo, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name + '.jpg'), quality=quality,
                                                          optimize=True, subsampling=0)
    if normal is None and height is not None:
        normal = normal_from_height(height, strength)
    if normal is not None:
        Image.fromarray((np.clip(normal, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
            os.path.join(OUT, name + '_n.jpg'), quality=90, subsampling=0)
    print('texture', name, a.shape)


# ----------------------------------------------------------------------------- materials

def planks(n, rng, count, horizontal, base_cols, gap=0.0035, seams=True, grain_scale=1.0, knots=True,
           bevel=0.25, plank_var=0.12):
    """Generic plank field. Returns (albedo, height). Tile covers 1 unit; `count` planks per tile."""
    ys, xs = np.mgrid[0:n, 0:n] / n
    across = ys if horizontal else xs   # coordinate across the planks
    along = xs if horizontal else ys
    idx = np.floor(across * count).astype(int) % count
    local = across * count - np.floor(across * count)  # 0..1 within plank
    # seams along each plank at a random offset
    off = rng.random(count)
    seg_len = rng.integers(1, 3, count)
    a2 = (along + off[idx]) * seg_len[idx]
    seg = np.floor(a2).astype(int)
    seg_local = a2 - seg
    plank_id = idx * 7 + seg
    rnd = np.random.default_rng(12345)
    tone = rnd.random(count * 7 + 10)
    t = tone[plank_id % len(tone)]
    # grain: noise stretched along the plank
    aniso = (1, 16) if horizontal else (16, 1)
    g = fbm(n, 4, 5, rng, aniso=(aniso[1] // 16 * 1 or 1, aniso[0] // 16 * 1 or 1))
    streaks = fbm(n, 2, 4, rng, aniso=((1, 24) if horizontal else (24, 1)))
    grain = np.sin((streaks * 30 + g * 6) * grain_scale) * 0.5 + 0.5
    c0, c1, c2 = (col(c) for c in base_cols)
    base = lerp(c0, c1, t)
    albedo = lerp(base, c2, grain * 0.35 + (fbm(n, 8, 3, rng) - 0.5) * 0.3)
    albedo *= (1 - plank_var / 2 + plank_var * t)[..., None]
    # edges
    edge = np.minimum(local, 1 - local)
    h = smoothstep(0, bevel / count * count * 0.12 + 0.02, edge)
    if seams:
        send = np.minimum(seg_local, 1 - seg_local) * (1.0 / seg_len[idx])
        h = np.minimum(h, smoothstep(0.0, 0.012, send))
    gap_mask = edge < gap * count
    h = np.where(gap_mask, 0.0, h)
    h = h * 0.8 + grain * 0.12 + g * 0.08
    if knots:
        kf, _, _ = voronoi(n, 10, rng, aspect=((1, 3) if horizontal else (3, 1)))
        km = smoothstep(0.035, 0.0, kf)
        albedo = lerp(albedo, albedo * 0.55, km * 0.8)
        h -= km * 0.15
    shade = smoothstep(0.0, 0.12, edge)
    albedo *= (0.86 + 0.14 * shade)[..., None]
    albedo = np.where(gap_mask[..., None], albedo * 0.45, albedo)
    return albedo, np.clip(h, 0, 1)


def tex_wood(n=1024):
    rng = np.random.default_rng(1)
    albedo, h = planks(n, rng, 8, False, ('#b98552', '#9c6a3e', '#6b4526'))
    # nails near seams
    return save('wood', albedo, h, strength=10)


def tex_floorboards(n=512):
    rng = np.random.default_rng(2)
    albedo, h = planks(n, rng, 10, True, ('#a8744a', '#8a5a36', '#5f3b22'), knots=False)
    albedo = albedo * 1.05
    return save('floorboards', albedo, h, strength=6)


def tex_siding(n=512):
    """Horizontal lap siding, painted near-white so the game can tint it."""
    rng = np.random.default_rng(3)
    ys, xs = np.mgrid[0:n, 0:n] / n
    count = 10
    v = ys * count
    local = v - np.floor(v)
    # lap: each board thicker at the bottom, casting a small shadow under
    h = 0.35 + 0.55 * local ** 0.8
    h = np.where(local > 0.93, 0.15, h)
    shadow = smoothstep(0.93, 1.0, local) * 0.5 + (local > 0.965) * 0.25
    paint = fbm(n, 6, 5, rng)
    streak = fbm(n, 3, 4, rng, aniso=(24, 1))
    albedo = np.ones((n, n, 3)) * col('#f0ede6')
    albedo *= (0.9 + 0.1 * paint)[..., None]
    albedo *= (0.95 + 0.05 * streak)[..., None]
    albedo *= (1 - shadow)[..., None]
    # a few paint chips showing wood underneath
    chips = smoothstep(0.78, 0.83, fbm(n, 10, 4, rng))
    albedo = lerp(albedo, col('#8a6a4a'), chips * 0.8)
    h = h - chips * 0.1 + paint * 0.05
    return save('siding', albedo, h, strength=8)


def brick_field(n, rng, rows, cols, mortar, cols_hex, chip=0.004, var=0.25, tile=2.0):
    """Running-bond bricks. `mortar` is the mortar half-width in metres; the tile covers `tile` metres."""
    ys, xs = np.mgrid[0:n, 0:n] / n
    r = np.floor(ys * rows).astype(int)
    offset = (r % 2) * 0.5
    x = xs * cols + offset
    c = np.floor(x).astype(int) % cols
    lx = x - np.floor(x)
    ly = ys * rows - r
    nz = fbm(n, 16, 4, rng) - 0.5
    ex = np.minimum(lx, 1 - lx) * tile / cols
    ey = np.minimum(ly, 1 - ly) * tile / rows
    edge = np.minimum(ex, ey) + nz * chip
    brick = smoothstep(mortar, mortar + 0.006, edge)
    bid = (r * 131 + c * 17) % 997
    tone = np.random.default_rng(99).random(1000)[bid]
    b0, b1, b2, m = (col(h) for h in cols_hex)
    base = lerp(b0, b1, tone)
    speck = fbm(n, 24, 3, rng)
    base = lerp(base, b2, smoothstep(0.55, 0.8, speck) * 0.6)
    base *= (1 - var / 2 + var * np.random.default_rng(7).random(1000)[bid])[..., None]
    albedo = lerp(m * (0.85 + 0.2 * speck[..., None]), base, brick)
    h = brick * (0.75 + 0.25 * fbm(n, 12, 4, rng)) + (1 - brick) * 0.1
    ao = smoothstep(0.0, mortar + 0.02, edge)
    albedo *= (0.72 + 0.28 * ao)[..., None]
    return albedo, h


def tex_brick(n=512):
    rng = np.random.default_rng(4)
    albedo, h = brick_field(n, rng, 24, 8, 0.006, ('#b2553b', '#8e3a2a', '#c8765a', '#cfc6b8'))
    return save('brick', albedo, h, strength=7)


def tex_stone(n=1024):
    """Big cut stone blocks for the stone build material."""
    rng = np.random.default_rng(5)
    rows = 6
    ys, xs = np.mgrid[0:n, 0:n] / n
    r = np.floor(ys * rows).astype(int)
    # variable block widths per row
    widths = []
    rr = np.random.default_rng(55)
    for i in range(rows):
        ws = []
        tot = 0
        while tot < 1 - 1e-6:
            w = rr.choice([0.25, 0.25, 0.375, 0.5])
            w = min(w, 1 - tot)
            ws.append(w)
            tot += w
        widths.append(np.cumsum([0] + ws))
    lx = np.zeros((n, n))
    bw = np.zeros((n, n))
    bid = np.zeros((n, n), dtype=int)
    for i in range(rows):
        edges = widths[i]
        m = r == i
        sh = (i * 0.37) % 1.0
        x = (xs[m] + sh) % 1.0
        k = np.searchsorted(edges, x, side='right') - 1
        k = np.clip(k, 0, len(edges) - 2)
        lx[m] = (x - edges[k]) / (edges[k + 1] - edges[k])
        bw[m] = edges[k + 1] - edges[k]
        bid[m] = i * 13 + k
    ly = ys * rows - r
    nz = fbm(n, 12, 5, rng) - 0.5
    ex = np.minimum(lx, 1 - lx) * bw * rows
    ey = np.minimum(ly, 1 - ly)
    edge = np.minimum(ex, ey) + nz * 0.06
    block = smoothstep(0.03, 0.12, edge)
    tone = np.random.default_rng(9).random(200)[bid % 200]
    b0, b1, m = col('#9aa3ad'), col('#7d8793'), col('#5c5a55')
    base = lerp(b0, b1, tone)
    grit = fbm(n, 32, 3, rng)
    cracks = voronoi(n, 40, rng)[1]
    crack = smoothstep(0.012, 0.0, cracks) * smoothstep(0.55, 0.7, fbm(n, 4, 3, rng))
    base *= (0.85 + 0.25 * grit)[..., None]
    base = lerp(base, base * 0.6, crack)
    moss = smoothstep(0.62, 0.8, fbm(n, 5, 5, rng)) * (1 - block * 0.6)
    base = lerp(base, col('#6f8a4a'), moss * 0.5)
    albedo = lerp(m, base, block)
    ao = smoothstep(0.0, 0.2, edge)
    albedo *= (0.65 + 0.35 * ao)[..., None]
    # pillowed blocks
    pillow = smoothstep(0.0, 0.35, edge)
    h = block * (0.55 + 0.35 * pillow + 0.1 * grit) - crack * 0.2
    return save('stone', albedo, np.clip(h, 0, 1), strength=12)


def tex_metal(n=1024):
    """Riveted steel panels for the metal build material."""
    rng = np.random.default_rng(6)
    ys, xs = np.mgrid[0:n, 0:n] / n
    p = 2  # 2x2 panels per tile (1 m panels)
    lx = xs * p - np.floor(xs * p)
    ly = ys * p - np.floor(ys * p)
    pid = (np.floor(xs * p) * 3 + np.floor(ys * p)).astype(int)
    edge = np.minimum(np.minimum(lx, 1 - lx), np.minimum(ly, 1 - ly))
    seam = smoothstep(0.004, 0.02, edge)
    lip = smoothstep(0.02, 0.05, edge)
    # rivets along the edges
    rv = np.zeros((n, n))
    step = 1 / 8
    for axis in (0, 1):
        a = lx if axis else ly
        b = ly if axis else lx
        dist_edge = np.minimum(a, 1 - a) - 0.06
        along = (b / step) - np.floor(b / step) - 0.5
        d = np.sqrt((dist_edge * 8) ** 2 + along ** 2) * step * 2.2
        rv = np.maximum(rv, smoothstep(0.03, 0.012, d))
    brushed = fbm(n, 2, 5, rng, aniso=(1, 32))
    scratches = smoothstep(0.985, 1.0, fbm(n, 6, 3, rng, aniso=(32, 1)))
    tone = np.random.default_rng(10).random(20)[pid % 20]
    base = lerp(col('#8d99a6'), col('#76828f'), tone)
    base *= (0.9 + 0.12 * brushed)[..., None]
    rust = smoothstep(0.66, 0.85, fbm(n, 6, 5, rng)) * (1 - lip * 0.5)
    base = lerp(base, col('#8a5a3a'), rust * 0.55)
    base = lerp(base, col('#d8dde2'), scratches * 0.5)
    base = lerp(base, col('#aab4bf'), rv * 0.7)
    base *= (0.55 + 0.45 * seam)[..., None]
    base *= (0.85 + 0.15 * lip)[..., None]
    # diagonal cross-brace embossing on each panel
    diag = np.minimum(np.abs(lx - ly), np.abs(lx - (1 - ly)))
    brace = smoothstep(0.035, 0.02, diag) * (edge > 0.05)
    base = lerp(base, base * 1.12, brace)
    h = 0.5 * seam + 0.15 * lip + 0.35 * rv + 0.12 * brace + brushed * 0.03 - rust * 0.03
    return save('metal', base, np.clip(h, 0, 1), strength=10)


def tex_shingles(n=512):
    rng = np.random.default_rng(7)
    ys, xs = np.mgrid[0:n, 0:n] / n
    rows = 10
    r = np.floor(ys * rows).astype(int)
    ly = ys * rows - r
    x = xs * 8 + (r % 2) * 0.5 + np.random.default_rng(3).random(rows)[r % rows] * 0.3
    lx = x - np.floor(x)
    sid = (r * 31 + np.floor(x).astype(int) * 7) % 500
    tone = np.random.default_rng(11).random(500)[sid]
    # each shingle thick at the bottom edge (image down = roof down)
    h = 0.3 + 0.6 * ly
    gapx = smoothstep(0.0, 0.03, np.minimum(lx, 1 - lx))
    h *= 0.6 + 0.4 * gapx
    base = lerp(col('#e9e4de'), col('#cfc8c0'), tone)
    grit = fbm(n, 24, 3, rng)
    base *= (0.85 + 0.2 * grit)[..., None]
    shadow = smoothstep(0.75, 1.0, ly) * 0.35
    base *= (1 - shadow)[..., None] * (0.7 + 0.3 * gapx)[..., None]
    return save('shingles', base, h + grit * 0.05, strength=8)


def tex_corrugated(n=512):
    rng = np.random.default_rng(8)
    ys, xs = np.mgrid[0:n, 0:n] / n
    ridges = 16
    h = 0.5 + 0.5 * np.sin(xs * ridges * 2 * np.pi)
    streak = fbm(n, 4, 5, rng, aniso=(1, 1)) * 0.5 + fbm(n, 2, 4, rng, aniso=(16, 1)) * 0.5
    base = np.ones((n, n, 3)) * col('#e6e9ec')
    base *= (0.75 + 0.25 * h)[..., None]
    base *= (0.85 + 0.2 * streak)[..., None]
    rust = smoothstep(0.62, 0.8, fbm(n, 5, 5, rng)) * smoothstep(0.5, 0.0, ys)
    base = lerp(base, col('#9a6a48'), rust * 0.35)
    return save('corrugated', base, h, strength=14)


def tex_concrete(n=512):
    rng = np.random.default_rng(9)
    g = fbm(n, 4, 6, rng)
    speck = fbm(n, 64, 2, rng)
    base = np.ones((n, n, 3)) * col('#b8b6b0')
    base *= (0.85 + 0.25 * g)[..., None]
    base *= (0.92 + 0.12 * speck)[..., None]
    _, e, _ = voronoi(n, 12, rng)
    crack = smoothstep(0.006, 0.0, e) * smoothstep(0.5, 0.75, fbm(n, 3, 3, rng))
    base = lerp(base, base * 0.55, crack)
    # expansion joints on the tile edge
    ys, xs = np.mgrid[0:n, 0:n] / n
    j = np.minimum(np.minimum(xs, 1 - xs), np.minimum(ys, 1 - ys))
    joint = smoothstep(0.006, 0.0, j)
    base = lerp(base, base * 0.5, joint)
    h = 0.6 + 0.1 * g + 0.05 * speck - crack * 0.3 - joint * 0.4
    return save('concrete', base, np.clip(h, 0, 1), strength=5)


def tex_plaster(n=256):
    rng = np.random.default_rng(10)
    g = fbm(n, 8, 5, rng)
    base = np.ones((n, n, 3)) * col('#efe9df') * (0.92 + 0.1 * g)[..., None]
    return save('plaster', base, g, strength=2)


# ---- terrain (tiles are sized in terrain.js)

def tex_grass(n=1024):
    rng = np.random.default_rng(20)
    big = fbm(n, 3, 5, rng)
    mid = fbm(n, 12, 4, rng)
    ys, xs = np.mgrid[0:n, 0:n] / n
    # blades: many short strokes from a Voronoi of small cells
    f1, e, cid = voronoi(n, 900, rng, aspect=(1, 1))
    tone = np.random.default_rng(21).random(900)[cid]
    blade = smoothstep(0.012, 0.0, f1) * 0.0
    strokes = fbm(n, 64, 2, rng, aniso=(3, 1))
    c_dark, c_mid, c_light, c_yel = col('#3f7a2e'), col('#5c9a36'), col('#86bf4a'), col('#b3c25a')
    base = lerp(c_mid, c_dark, smoothstep(0.35, 0.65, big) * 0.8)
    base = lerp(base, c_light, smoothstep(0.45, 0.75, mid) * 0.6)
    base = lerp(base, c_yel, smoothstep(0.7, 0.9, fbm(n, 6, 4, rng)) * 0.35)
    base *= (0.82 + 0.3 * strokes)[..., None]
    base *= (0.9 + 0.16 * tone)[..., None]
    h = strokes * 0.6 + mid * 0.2 + tone * 0.2
    return save('grass', base, h, strength=6)


def tex_dirt(n=512):
    rng = np.random.default_rng(22)
    g = fbm(n, 4, 6, rng)
    f1, e, cid = voronoi(n, 160, rng)
    pebble = smoothstep(0.02, 0.0, f1 - 0.012) * (np.random.default_rng(23).random(160)[cid] > 0.55)
    base = lerp(col('#8a6a48'), col('#6d5238'), g)
    base = lerp(base, col('#a38b6d'), pebble * 0.8)
    base *= (0.85 + 0.2 * fbm(n, 32, 2, rng))[..., None]
    h = g * 0.5 + pebble * 0.5
    return save('dirt', base, h, strength=8)


def tex_rock(n=1024):
    rng = np.random.default_rng(24)
    g = fbm(n, 3, 7, rng)
    strata = np.sin((np.mgrid[0:n, 0:n][0] / n * 9 + g * 3) * 2 * np.pi) * 0.5 + 0.5
    f1, e, cid = voronoi(n, 36, rng, aspect=(1.6, 1))
    facets = smoothstep(0.0, 0.06, e)
    base = lerp(col('#8c8e8f'), col('#6b6e72'), g)
    base = lerp(base, col('#9d9486'), strata * 0.35)
    base *= (0.7 + 0.3 * facets)[..., None]
    base *= (0.9 + 0.15 * fbm(n, 48, 2, rng))[..., None]
    h = facets * 0.5 + g * 0.3 + strata * 0.2
    return save('rock', base, h, strength=14)


def tex_sand(n=512):
    rng = np.random.default_rng(25)
    g = fbm(n, 4, 5, rng)
    ys, xs = np.mgrid[0:n, 0:n] / n
    ripples = np.sin((ys * 18 + g * 2.5 + xs * 3) * 2 * np.pi) * 0.5 + 0.5
    base = lerp(col('#e7d3a2'), col('#d4bb86'), g)
    base *= (0.92 + 0.08 * ripples)[..., None]
    base *= (0.94 + 0.1 * fbm(n, 64, 2, rng))[..., None]
    return save('sand', base, ripples * 0.6 + g * 0.4, strength=4)


def tex_bark(n=512):
    rng = np.random.default_rng(26)
    ridges = fbm(n, 3, 5, rng, aniso=(1, 6))
    ys, xs = np.mgrid[0:n, 0:n] / n
    r = np.abs(np.sin((xs * 10 + ridges * 1.5) * np.pi))
    base = lerp(col('#4b3524'), col('#7a5a3e'), r ** 0.7)
    base *= (0.85 + 0.25 * fbm(n, 16, 3, rng, aniso=(4, 1)))[..., None]
    return save('bark', base, r, strength=10)


def tex_fabric(n=256):
    """Fine woven detail used as a normal map on clothes."""
    rng = np.random.default_rng(27)
    ys, xs = np.mgrid[0:n, 0:n] / n
    w = 48
    a = np.sin(xs * w * 2 * np.pi) * 0.5 + 0.5
    b = np.sin(ys * w * 2 * np.pi) * 0.5 + 0.5
    check = ((np.floor(xs * w) + np.floor(ys * w)) % 2)
    h = np.where(check > 0, a, b) * 0.7 + fbm(n, 8, 3, rng) * 0.3
    base = np.ones((n, n, 3)) * (0.9 + 0.1 * h)[..., None]
    return save('fabric', base, h, strength=3)


def tex_water(n=512):
    """Wave normal map for the sea (no albedo needed, a flat blue is written anyway)."""
    rng = np.random.default_rng(28)
    h = fbm(n, 4, 6, rng, gain=0.55) * 0.6 + fbm(n, 2, 4, rng, aniso=(1, 2)) * 0.4
    save('water', np.ones((n, n, 3)) * col('#2a6f9a'), h, strength=18)


ALL = {
    'wood': tex_wood, 'stone': tex_stone, 'metal': tex_metal, 'siding': tex_siding, 'brick': tex_brick,
    'shingles': tex_shingles, 'floorboards': tex_floorboards, 'corrugated': tex_corrugated,
    'concrete': tex_concrete, 'plaster': tex_plaster, 'grass': tex_grass, 'dirt': tex_dirt, 'rock': tex_rock,
    'sand': tex_sand, 'bark': tex_bark, 'fabric': tex_fabric, 'water': tex_water,
}


def build(names=None):
    for k in (names or ALL):
        ALL[k]()


if __name__ == '__main__':
    build([a for a in sys.argv[1:] if a in ALL] or None)
