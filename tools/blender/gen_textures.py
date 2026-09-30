"""Procedural PBR textures for the city (albedo / emissive / ORM triplets).

Run through build_assets.py, or directly:  python gen_textures.py <out_dir>

Every facade texture tiles 4 columns x 4 floors = 16 m x 14 m (column pitch 4 m, floor
height 3.5 m), so the Blender building kit can UV in world metres and never stretch.
ORM convention (glTF): R = ambient occlusion, G = roughness, B = metalness.
"""
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "DejaVuSans-Bold.ttf",
]


def load_font(size):
    """Sign lettering: first bold sans we can find, else Pillow's built-in font."""
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)
S = 2  # supersampling for anti-aliased drawing


def fbm(h, w, scales=(4, 8, 16, 32, 64), seed=0, gain=0.55):
    """Cheap tileable-ish value noise in [0,1] built from upsampled random grids."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for s in scales:
        g = rng.random((s, s)).astype(np.float32)
        g = np.tile(g, (2, 2))  # wrap so the result tiles
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w * 2, h * 2), Image.BICUBIC)
        a = np.asarray(im, np.float32)[:h, :w] / 255.0
        out += a * amp
        tot += amp
        amp *= gain
    return out / tot


def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def save(img, path, quality=88):
    if path.endswith(".jpg"):
        img.convert("RGB").save(path, quality=quality, subsampling=0)
    else:
        img.save(path, optimize=True)
    print("  wrote", os.path.basename(path), img.size)


def orm_image(rough, metal=None, ao=None):
    h, w = rough.shape
    o = np.stack([
        np.full((h, w), 255, np.float32) if ao is None else ao * 255,
        rough * 255,
        np.zeros((h, w), np.float32) if metal is None else metal * 255,
    ], -1)
    return to_img(o)


# ---------------------------------------------------------------------------------------
# Facades
# ---------------------------------------------------------------------------------------
LIT_WARM = [(255, 205, 130), (255, 190, 100), (255, 225, 170), (250, 170, 90)]
LIT_COOL = [(190, 215, 255), (220, 235, 255), (150, 190, 255)]
LIT_ODD = [(255, 120, 200), (120, 255, 200), (140, 150, 255)]


def lit_color(rng, cool_bias=0.15):
    r = rng.random()
    if r < 0.04:
        return rng.choice(LIT_ODD)
    if r < 0.04 + cool_bias:
        return rng.choice(LIT_COOL)
    return rng.choice(LIT_WARM)


def new_layers(size, base):
    n = size * S
    alb = Image.new("RGB", (n, n), base)
    emi = Image.new("RGB", (n, n), (0, 0, 0))
    rgh = Image.new("L", (n, n), 215)  # 0.84 rough by default
    met = Image.new("L", (n, n), 0)
    return alb, emi, rgh, met


def window_glow(ed, box, col, rng, curtain=True):
    """Lit window: warm gradient with a curtain / blind hint."""
    x0, y0, x1, y1 = box
    h = y1 - y0
    for i in range(int(h)):
        t = i / max(h, 1)
        k = 0.65 + 0.35 * (1 - t) if rng.random() < 2 else 1.0
        ed.line([(x0, y0 + i), (x1, y0 + i)], fill=tuple(int(c * k) for c in col))
    if curtain and rng.random() < 0.6:
        cw = (x1 - x0) * rng.uniform(0.18, 0.38)
        shade = tuple(int(c * 0.35) for c in col)
        ed.rectangle([x0, y0, x0 + cw, y1], fill=shade)
        if rng.random() < 0.5:
            ed.rectangle([x1 - cw, y0, x1, y1], fill=shade)
    if rng.random() < 0.3:  # blind pulled part way down
        ed.rectangle([x0, y0, x1, y0 + h * rng.uniform(0.2, 0.6)], fill=tuple(int(c * 0.5) for c in col))


def sky_glass(ad, box, rng, dark=1.0):
    x0, y0, x1, y1 = box
    h = int(y1 - y0)
    top = np.array((26, 36, 52)) * dark
    bot = np.array((44, 58, 76)) * dark
    tint = rng.uniform(-6, 8)
    for i in range(h):
        t = i / max(h, 1)
        c = top * (1 - t) + bot * t
        ad.line([(x0, y0 + i), (x1, y0 + i)], fill=(int(c[0]), int(c[1]), int(c[2] + tint)))


def facade_brick(seed=1):
    rng = random.Random(seed)
    size = 1024
    alb, emi, rgh, met = new_layers(size, (120, 60, 48))
    n = size * S
    ad, ed, rd, md = ImageDraw.Draw(alb), ImageDraw.Draw(emi), ImageDraw.Draw(rgh), ImageDraw.Draw(met)
    # bricks
    bh, bw = 20, 50
    for r in range(n // bh + 1):
        off = (bw // 2) if r % 2 else 0
        for c in range(-1, n // bw + 2):
            j = rng.uniform(0.78, 1.14)
            col = (int(150 * j + rng.uniform(-10, 10)), int(68 * j), int(50 * j))
            x = c * bw + off
            ad.rectangle([x + 2, r * bh + 2, x + bw - 2, r * bh + bh - 2], fill=col)
    a = np.asarray(alb, np.float32)
    a *= (0.72 + 0.5 * fbm(n, n, seed=seed)[..., None])
    alb = to_img(a)
    ad = ImageDraw.Draw(alb)
    cell = n // 4
    for fy in range(4):
        for fx in range(4):
            cx, cy = fx * cell + cell // 2, fy * cell + cell // 2
            w, h = 150 * 2 // 2 * 1.0, 220
            w, h = 300, 340
            x0, y0, x1, y1 = cx - w // 2, cy - h // 2 + 10, cx + w // 2, cy + h // 2 + 10
            ad.rectangle([x0 - 26, y0 - 34, x1 + 26, y0 - 10], fill=(172, 160, 146))  # lintel
            ad.rectangle([x0 - 28, y1 + 4, x1 + 28, y1 + 26], fill=(190, 178, 164))  # sill
            ad.rectangle([x0 - 12, y0 - 12, x1 + 12, y1 + 6], fill=(214, 208, 196))  # frame
            sky_glass(ad, (x0, y0, x1, y1), rng, 0.8)
            ad.rectangle([cx - 5, y0, cx + 5, y1], fill=(214, 208, 196))  # mullion
            ad.rectangle([x0, cy - 30, x1, cy - 18], fill=(214, 208, 196))  # transom
            rd.rectangle([x0, y0, x1, y1], fill=80)
            rd.rectangle([x0 - 12, y0 - 12, x1 + 12, y0], fill=140)
            if rng.random() < 0.42:
                window_glow(ed, (x0, y0, x1, y1), lit_color(rng), rng)
                window_glow(ImageDraw.Draw(alb), (x0, y0, x1, y1), tuple(int(c * 0.12) for c in (200, 180, 150)), rng)
            ed.rectangle([cx - 5, y0, cx + 5, y1], fill=(0, 0, 0))
            ed.rectangle([x0, cy - 30, x1, cy - 18], fill=(0, 0, 0))
    return finish(alb, emi, rgh, met, size, rough_noise=0.12)


def facade_glass(seed=2):
    rng = random.Random(seed)
    size = 1024
    alb, emi, rgh, met = new_layers(size, (28, 34, 42))
    n = size * S
    ad, ed, rd, md = ImageDraw.Draw(alb), ImageDraw.Draw(emi), ImageDraw.Draw(rgh), ImageDraw.Draw(met)
    cell = n // 4
    panes_x = 2
    for fy in range(4):
        floor_lit = rng.random() < 0.7 or fy == 1
        for fx in range(4):
            for px in range(panes_x):
                w = cell // panes_x
                x0 = fx * cell + px * w
                y0 = fy * cell
                sp = int(cell * 0.30)  # opaque spandrel at bottom of the floor
                box = (x0 + 6, y0 + 6, x0 + w - 6, y0 + cell - sp - 6)
                sky_glass(ad, box, rng, rng.uniform(0.7, 1.5))
                rd.rectangle(box, fill=70)
                # spandrel
                ad.rectangle([x0 + 6, y0 + cell - sp, x0 + w - 6, y0 + cell - 6], fill=(46, 52, 58))
                rd.rectangle([x0 + 6, y0 + cell - sp, x0 + w - 6, y0 + cell - 6], fill=120)
                md.rectangle([x0 + 6, y0 + cell - sp, x0 + w - 6, y0 + cell - 6], fill=150)
                if floor_lit and rng.random() < 0.62:
                    col = tuple(int(c * rng.uniform(0.7, 1.0)) for c in rng.choice(LIT_COOL + LIT_WARM[:1]))
                    ed.rectangle([box[0], box[1], box[2], box[3] - 4], fill=col)
                    # ceiling strip lights
                    ed.rectangle([box[0], box[1], box[2], box[1] + 18], fill=(255, 255, 255))
        # floor slab line
        ad.rectangle([0, fy * cell + cell - 6, n, fy * cell + cell + 6], fill=(60, 66, 72))
    # mullions
    for i in range(4 * panes_x + 1):
        x = i * (n // (4 * panes_x))
        ad.rectangle([x - 6, 0, x + 6, n], fill=(58, 64, 70))
        md.rectangle([x - 6, 0, x + 6, n], fill=210)
        rd.rectangle([x - 6, 0, x + 6, n], fill=100)
    return finish(alb, emi, rgh, met, size, rough_noise=0.05)


def facade_concrete(seed=3):
    rng = random.Random(seed)
    size = 1024
    alb, emi, rgh, met = new_layers(size, (128, 128, 124))
    n = size * S
    a = np.asarray(alb, np.float32) * (0.75 + 0.45 * fbm(n, n, seed=seed)[..., None])
    # rain streaks
    st = fbm(n, n // 8, scales=(3, 40, 90), seed=seed + 9)
    st = np.asarray(Image.fromarray((st * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC), np.float32) / 255
    a *= (0.85 + 0.25 * st[..., None])
    alb = to_img(a)
    ad, ed, rd, md = ImageDraw.Draw(alb), ImageDraw.Draw(emi), ImageDraw.Draw(rgh), ImageDraw.Draw(met)
    cell = n // 4
    for fy in range(4):
        y0, y1 = fy * cell + int(cell * 0.18), fy * cell + int(cell * 0.72)
        ad.rectangle([0, y0 - 14, n, y0], fill=(150, 150, 146))
        ad.rectangle([0, y1, n, y1 + 26], fill=(96, 96, 92))
        for k in range(8):
            x0 = k * (n // 8) + 8
            x1 = (k + 1) * (n // 8) - 8
            sky_glass(ad, (x0, y0, x1, y1), rng, 1.1)
            rd.rectangle([x0, y0, x1, y1], fill=80)
            if rng.random() < 0.5:
                window_glow(ed, (x0, y0, x1, y1), lit_color(rng, 0.45), rng, curtain=False)
        for k in range(9):
            x = k * (n // 8)
            ad.rectangle([x - 8, y0, x + 8, y1], fill=(88, 90, 92))
    # formwork panel lines
    for k in range(0, n, n // 8):
        ad.line([(k, 0), (k, n)], fill=(104, 104, 100), width=2)
    return finish(alb, emi, rgh, met, size, rough_noise=0.15)


def facade_deco(seed=4):
    rng = random.Random(seed)
    size = 1024
    alb, emi, rgh, met = new_layers(size, (198, 182, 150))
    n = size * S
    a = np.asarray(alb, np.float32) * (0.72 + 0.5 * fbm(n, n, seed=seed)[..., None])
    alb = to_img(a)
    ad, ed, rd, md = ImageDraw.Draw(alb), ImageDraw.Draw(emi), ImageDraw.Draw(rgh), ImageDraw.Draw(met)
    cell = n // 4
    for fy in range(4):
        for fx in range(4):
            for k in range(3):
                w, h = 96, 330
                cx = fx * cell + int(cell * (k + 0.5) / 3)
                y0 = fy * cell + 60
                x0, x1, y1 = cx - w // 2, cx + w // 2, y0 + h
                ad.rectangle([x0 - 14, y0 - 14, x1 + 14, y1 + 8], fill=(60, 48, 34))  # bronze frame
                md.rectangle([x0 - 14, y0 - 14, x1 + 14, y1 + 8], fill=170)
                sky_glass(ad, (x0, y0, x1, y1), rng, 0.9)
                rd.rectangle([x0, y0, x1, y1], fill=80)
                if rng.random() < 0.45:
                    window_glow(ed, (x0, y0, x1, y1), lit_color(rng, 0.1), rng)
                ad.rectangle([x0 - 2, y0 + h // 2 - 5, x1 + 2, y0 + h // 2 + 5], fill=(60, 48, 34))
                ed.rectangle([x0 - 2, y0 + h // 2 - 5, x1 + 2, y0 + h // 2 + 5], fill=(0, 0, 0))
            # spandrel panel ornament
            sy = fy * cell + 60 + 330 + 30
            ad.rectangle([fx * cell + 40, sy, fx * cell + cell - 40, sy + 70], fill=(150, 132, 100))
            for k in range(6):
                xx = fx * cell + 60 + k * ((cell - 120) // 6)
                ad.polygon([(xx, sy + 10), (xx + 20, sy + 60), (xx - 20, sy + 60)], fill=(176, 160, 128))
    for k in range(5):  # piers
        x = k * (n // 4)
        ad.rectangle([x - 18, 0, x + 18, n], fill=(214, 198, 166))
    return finish(alb, emi, rgh, met, size, rough_noise=0.15)


def finish(alb, emi, rgh, met, size, rough_noise=0.1):
    n = size * S
    alb = alb.resize((size, size), Image.LANCZOS)
    emi = emi.resize((size, size), Image.LANCZOS)
    r = np.asarray(rgh.resize((size, size), Image.LANCZOS), np.float32) / 255
    m = np.asarray(met.resize((size, size), Image.LANCZOS), np.float32) / 255
    r = np.clip(r + (fbm(size, size, seed=77) - 0.5) * rough_noise, 0.03, 1)
    # a little grime AO
    ao = 0.82 + 0.18 * fbm(size, size, seed=55)
    return alb, emi, orm_image(r, m, ao)


# ---------------------------------------------------------------------------------------
# Storefront strip (2048 x 640 = 16 m x 5 m)
# ---------------------------------------------------------------------------------------
def storefront(seed=7):
    rng = random.Random(seed)
    W, H = 2048 * S // 2, 640 * S // 2
    W, H = 2048 * S, 640 * S
    alb = Image.new("RGB", (W, H), (40, 40, 44))
    emi = Image.new("RGB", (W, H), (0, 0, 0))
    rgh = Image.new("L", (W, H), 200)
    met = Image.new("L", (W, H), 0)
    ad, ed, rd, md = ImageDraw.Draw(alb), ImageDraw.Draw(emi), ImageDraw.Draw(rgh), ImageDraw.Draw(met)
    bay = W // 4
    names = ["PIZZA", "24H MART", "NOODLES", "PHARMACY", "BAR", "CAFE", "BOOKS", "TACOS", "VAPE", "HOTEL"]
    fnt = load_font(150)
    kinds = ["shop", "shop", "shutter", "shop"]
    rng.shuffle(kinds)
    for b in range(4):
        x0 = b * bay
        kind = kinds[b]
        # pilaster
        ad.rectangle([x0, 0, x0 + 40, H], fill=(70, 70, 74))
        # sign band
        band = int(H * 0.22)
        hue = rng.choice([(200, 30, 40), (20, 90, 170), (230, 170, 20), (30, 130, 80), (240, 240, 240), (120, 40, 150)])
        ad.rectangle([x0 + 40, 0, x0 + bay, band], fill=tuple(int(c * 0.5) for c in hue))
        ed.rectangle([x0 + 40, 0, x0 + bay, band], fill=tuple(int(c * 0.55) for c in hue))
        txt = rng.choice(names)
        bb = ed.textbbox((0, 0), txt, font=fnt)
        tx = x0 + 40 + (bay - 40 - (bb[2] - bb[0])) // 2
        ed.text((tx, (band - (bb[3] - bb[1])) // 2 - bb[1]), txt, font=fnt, fill=(255, 250, 240))
        ad.text((tx, (band - (bb[3] - bb[1])) // 2 - bb[1]), txt, font=fnt, fill=(235, 230, 220))
        wy0, wy1 = band + 40, H - 40
        if kind == "shop":
            gx0, gx1 = x0 + 90, x0 + bay - 50
            # interior
            tint = np.array(rng.choice([(255, 190, 110), (255, 225, 180), (190, 215, 255)]))
            for i in range(wy1 - wy0):
                t = i / (wy1 - wy0)
                c = tint * (0.25 + 0.4 * (1 - t))
                ed.line([(gx0, wy0 + i), (gx1, wy0 + i)], fill=tuple(int(v) for v in c))
            # shelves / silhouettes
            for k in range(rng.randint(3, 8)):
                sx = rng.randint(gx0 + 20, gx1 - 120)
                sw, sh = rng.randint(50, 160), rng.randint(60, 220)
                ed.rectangle([sx, wy1 - sh - 20, sx + sw, wy1 - 20], fill=tuple(rng.randint(30, 140) for _ in range(3)))
            ad.rectangle([gx0, wy0, gx1, wy1], fill=(20, 26, 34))
            ad.rectangle([gx0 - 14, wy0 - 14, gx1 + 14, wy0], fill=(30, 30, 34))
            ad.rectangle([gx0 - 14, wy1, gx1 + 14, wy1 + 20], fill=(30, 30, 34))
            rd.rectangle([gx0, wy0, gx1, wy1], fill=70)
            if rng.random() < 0.7:  # door mullion
                dx = gx0 + int((gx1 - gx0) * 0.62)
                ad.rectangle([dx - 8, wy0, dx + 8, wy1], fill=(30, 30, 34))
                ed.rectangle([dx - 8, wy0, dx + 8, wy1], fill=(0, 0, 0))
            # neon OPEN sign
            if rng.random() < 0.6:
                ed.rounded_rectangle([gx0 + 30, wy0 + 30, gx0 + 260, wy0 + 100], 14, outline=(255, 60, 90), width=8)
        else:  # rolled shutter
            gx0, gx1 = x0 + 90, x0 + bay - 50
            ad.rectangle([gx0, wy0, gx1, wy1], fill=(96, 98, 102))
            for y in range(wy0, wy1, 14):
                ad.line([(gx0, y), (gx1, y)], fill=(70, 72, 76), width=3)
            rd.rectangle([gx0, wy0, gx1, wy1], fill=120)
            md.rectangle([gx0, wy0, gx1, wy1], fill=200)
            # graffiti tag
            col = tuple(rng.randint(60, 255) for _ in range(3))
            ad.line([(gx0 + 60, wy1 - 100), (gx0 + 200, wy0 + 120), (gx0 + 340, wy1 - 120), (gx1 - 60, wy0 + 160)], fill=col, width=18)
    a = np.asarray(alb, np.float32) * (0.85 + 0.3 * fbm(H, W, seed=seed)[..., None])
    alb = to_img(a).resize((2048, 640), Image.LANCZOS)
    emi = emi.resize((2048, 640), Image.LANCZOS)
    r = np.asarray(rgh.resize((2048, 640), Image.LANCZOS), np.float32) / 255
    m = np.asarray(met.resize((2048, 640), Image.LANCZOS), np.float32) / 255
    return alb, emi, orm_image(np.clip(r, 0.03, 1), m)


# ---------------------------------------------------------------------------------------
# Ground
# ---------------------------------------------------------------------------------------
def asphalt(size=2048, seed=11):
    n = size
    base = 0.16 + 0.05 * fbm(n, n, seed=seed)
    rng = np.random.default_rng(seed)
    grain = rng.random((n, n)).astype(np.float32)
    grain = np.asarray(Image.fromarray((grain * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255
    base = base * (0.78 + 0.5 * grain)
    # aggregate speckles
    sp = (rng.random((n, n)) > 0.985).astype(np.float32) * rng.random((n, n)).astype(np.float32) * 0.22
    base = base + np.asarray(Image.fromarray((sp * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    # tyre-wear bands are baked in geometry later; here: cracks & patches
    im = to_img(np.stack([base * 255 * 0.98, base * 255 * 1.0, base * 255 * 1.06], -1))
    d = ImageDraw.Draw(im)
    for _ in range(26):
        x, y = rng.integers(0, n, 2)
        pts = [(x, y)]
        for _ in range(int(rng.integers(6, 20))):
            x += rng.integers(-60, 60)
            y += rng.integers(-60, 60)
            pts.append((int(x % n), int(y % n)))
        # avoid wrap lines: only draw consecutive close points
        for p, q in zip(pts, pts[1:]):
            if abs(p[0] - q[0]) < 200 and abs(p[1] - q[1]) < 200:
                d.line([p, q], fill=(14, 14, 16), width=2)
    for _ in range(7):  # darker patches
        x, y, w, h = rng.integers(0, n - 300, 1)[0], rng.integers(0, n - 300, 1)[0], rng.integers(120, 300), rng.integers(80, 240)
        d.rectangle([x, y, x + w, y + h], fill=(28, 28, 31))
    alb = im.filter(ImageFilter.GaussianBlur(0.6))
    # wet roughness with puddles
    puddle = fbm(n, n, scales=(2, 3, 5, 8), seed=seed + 5)
    wet = np.clip((puddle - 0.52) * 5, 0, 1)
    rough = 0.62 - 0.5 * wet - 0.12 * grain
    orm = orm_image(np.clip(rough, 0.05, 1))
    # darken puddles a touch
    a = np.asarray(alb, np.float32) * (1 - 0.35 * wet[..., None])
    return to_img(a), orm


def sidewalk(size=1024, seed=21):
    n = size
    base = 0.42 + 0.14 * fbm(n, n, seed=seed)
    rng = np.random.default_rng(seed)
    grain = rng.random((n, n)).astype(np.float32)
    base *= 0.85 + 0.3 * grain
    im = to_img(np.stack([base * 255 * 0.95, base * 255 * 0.96, base * 255 * 0.94], -1))
    d = ImageDraw.Draw(im)
    step = n // 4  # 1.5 m slabs on a 6 m tile
    for i in range(0, n + 1, step):
        d.line([(i, 0), (i, n)], fill=(52, 52, 50), width=4)
        d.line([(0, i), (n, i)], fill=(52, 52, 50), width=4)
    for _ in range(30):  # gum / stains
        x, y = rng.integers(0, n, 2)
        r = int(rng.integers(3, 14))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(int(rng.integers(40, 90)),) * 3)
    r = 0.78 - 0.25 * fbm(n, n, seed=seed + 4) - 0.1 * grain
    return im, orm_image(np.clip(r, 0.2, 1))


def roof(size=512, seed=31):
    n = size
    base = 0.2 + 0.1 * fbm(n, n, seed=seed)
    rng = np.random.default_rng(seed)
    g = rng.random((n, n)).astype(np.float32)
    base *= 0.7 + 0.6 * g
    im = to_img(np.stack([base * 255, base * 255, base * 255 * 1.04], -1))
    return im, orm_image(np.full((n, n), 0.9, np.float32))


def neon_atlas(size=1024):
    """4x4 grid of neon signs on dark backing; emissive carries the tubes."""
    n = size * S
    alb = Image.new("RGB", (n, n), (18, 18, 22))
    emi = Image.new("RGB", (n, n), (0, 0, 0))
    ad, ed = ImageDraw.Draw(alb), ImageDraw.Draw(emi)
    words = [("OPEN", (255, 70, 90)), ("HOTEL", (255, 60, 200)), ("BAR", (70, 200, 255)), ("PIZZA", (255, 170, 40)),
             ("24/7", (90, 255, 160)), ("KARAOKE", (200, 90, 255)), ("SUSHI", (255, 90, 60)), ("TAXI", (255, 220, 60)),
             ("PHO", (90, 255, 220)), ("ARCADE", (120, 140, 255)), ("CAFE", (255, 130, 90)), ("BOWL", (255, 80, 160)),
             ("LIQUOR", (80, 255, 120)), ("GYM", (255, 240, 90)), ("SPA", (255, 120, 220)), ("MOTEL", (255, 60, 60))]
    cell = n // 4
    for i, (w, col) in enumerate(words):
        cx0, cy0 = (i % 4) * cell, (i // 4) * cell
        f = load_font(160 if len(w) <= 5 else 120)
        bb = ed.textbbox((0, 0), w, font=f)
        tx = cx0 + (cell - (bb[2] - bb[0])) // 2 - bb[0]
        ty = cy0 + (cell - (bb[3] - bb[1])) // 2 - bb[1]
        ed.text((tx, ty), w, font=f, fill=col, stroke_width=3, stroke_fill=tuple(min(255, c + 60) for c in col))
        ad.text((tx, ty), w, font=f, fill=(30, 30, 34))
        ed.rounded_rectangle([cx0 + 20, cy0 + 20, cx0 + cell - 20, cy0 + cell - 20], 40, outline=tuple(int(c * 0.9) for c in col), width=7)
    emi = emi.filter(ImageFilter.GaussianBlur(1.2))
    return alb.resize((size, size), Image.LANCZOS), emi.resize((size, size), Image.LANCZOS)


def tyre_tread(size=256):
    """Small tiling knobby tread albedo for tyres."""
    im = Image.new("RGB", (size, size), (26, 26, 28))
    d = ImageDraw.Draw(im)
    for i in range(0, size, 32):
        d.polygon([(i, 0), (i + 14, 0), (i + 30, size // 2), (i + 14, size // 2)], fill=(14, 14, 15))
        d.polygon([(i + 16, size // 2), (i + 30, size // 2), (i + 46, size), (i + 30, size)], fill=(14, 14, 15))
    return im


def generate(out):
    os.makedirs(out, exist_ok=True)
    print("textures ->", out)
    for name, fn in [("brick", facade_brick), ("glass", facade_glass), ("concrete", facade_concrete), ("deco", facade_deco)]:
        a, e, o = fn()
        save(a, f"{out}/{name}_a.jpg")
        save(e, f"{out}/{name}_e.jpg", 90)
        save(o, f"{out}/{name}_orm.jpg", 90)
    a, e, o = storefront()
    save(a, f"{out}/store_a.jpg")
    save(e, f"{out}/store_e.jpg", 90)
    save(o, f"{out}/store_orm.jpg", 90)
    a, o = asphalt()
    save(a, f"{out}/asphalt_a.jpg")
    save(o, f"{out}/asphalt_orm.jpg", 90)
    a, o = sidewalk()
    save(a, f"{out}/sidewalk_a.jpg")
    save(o, f"{out}/sidewalk_orm.jpg", 90)
    a, o = roof()
    save(a, f"{out}/roof_a.jpg")
    save(o, f"{out}/roof_orm.jpg", 90)
    a, e = neon_atlas()
    save(a, f"{out}/neon_a.jpg")
    save(e, f"{out}/neon_e.jpg", 92)
    save(tyre_tread(), f"{out}/tread_a.jpg")


if __name__ == "__main__":
    generate(sys.argv[1] if len(sys.argv) > 1 else "build/tex")
