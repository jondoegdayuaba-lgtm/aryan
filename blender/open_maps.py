#!/usr/bin/env python3
"""
Terrain textures of the open world (numpy + Pillow, no Blender needed).  Reads build/open.npz written by open_world.py
and writes into ski/assets/open/:

    color.jpg    macro albedo (snow, rock, needle litter, lake ice)          2048 x 2048
    mask.webp    R rock  G litter  B groomed piste  A wind drift              2048 x 2048 (lossy WebP q95, lossless alpha)
    light.jpg    R terrain sun visibility, G x tree shadow, B ambient occlusion
    map.jpg      hillshaded base map for the in-game map and minimap          1024 x 1024

Rows run from z = Z0 (row 0) to Z1, columns from x = X0 to X1.
usage: python open_maps.py [--size 2048] [--quick]
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import open_terrain as ot  # noqa: E402
import open_world as ow  # noqa: E402
import lightmap as lm  # noqa: E402
from noise import smoothstep, spectral_noise  # noqa: E402

OUT = ow.OUT
DX, N, X0, Z0, X1, Z1 = ot.DX, ot.N, ot.X0, ot.Z0, ot.X1, ot.Z1


def srgb(*c):
    return np.array(c, dtype=np.float32)


def resample(arr, size):
    """resample a height-field sized array onto the texture grid (texel centres)"""
    ny, nx = arr.shape
    fx = (np.arange(size) + 0.5) / size * (nx - 1)
    fz = (np.arange(size) + 0.5) / size * (ny - 1)
    zz, xx = np.meshgrid(fz, fx, indexing="ij")
    return ndi.map_coordinates(arr.astype(np.float32), [zz, xx], order=1, mode="nearest")


def build(size):
    d = np.load(os.path.join(ow.BUILD, "open.npz"))
    H, groom, trees, lake = d["H"], d["groom"], d["trees"], d["lake"]
    rng = np.random.default_rng(ow.SEED + 7)
    TW = size
    tex_m = (X1 - X0) / TW
    shape = (TW, TW)

    y = resample(H, TW)
    sl = resample(d["slope"], TW)
    gr = np.clip(resample(groom, TW), 0, 1)
    lk = np.clip(resample(lake, TW), 0, 1)

    # ---- exposed rock, streaked along the fall line (couloirs and ledges) instead of round blobs
    gzr, gxr = np.gradient(ndi.gaussian_filter(y, 1.2), tex_m)
    mag = np.hypot(gxr, gzr) + 1e-6
    fall_x, fall_z = -gxr / mag, -gzr / mag
    base = spectral_noise(shape, tex_m, 6.0, 55.0, 1.6, rng)
    rows, cols = np.mgrid[0:TW, 0:TW].astype(np.float32)
    streak = np.zeros(shape, dtype=np.float32)
    taps = 9
    for k in range(-taps, taps + 1):
        streak += ndi.map_coordinates(base, [rows + fall_z * k * 2.0 / tex_m, cols + fall_x * k * 2.0 / tex_m], order=1, mode="nearest")
    streak /= 2 * taps + 1
    streak /= streak.std() + 1e-6
    sl_s = ndi.gaussian_filter(sl, 1.0)
    alt_r = smoothstep(2000.0, 2700.0, y)
    rock = smoothstep(0.66 - 0.14 * alt_r, 1.04 - 0.14 * alt_r, sl_s + 0.12 * streak)
    rock *= smoothstep(0.36, 0.60, ndi.gaussian_filter(sl, 4.0))
    rock = np.clip(ndi.gaussian_filter(rock, 0.7) * (1 - gr) * (1 - lk), 0, 1)

    # ---- tree canopy density (needle litter, and the tree shadows of the light map)
    cov = np.zeros(shape, dtype=np.float32)
    ix = np.clip(((trees[:, 0] - X0) / tex_m).astype(int), 0, TW - 1)
    iz = np.clip(((trees[:, 1] - Z0) / tex_m).astype(int), 0, TW - 1)
    np.add.at(cov, (iz, ix), trees[:, 3] ** 2)
    canopy = np.clip(ndi.gaussian_filter(cov, 2.6 / tex_m * 2.2) * 5.5, 0, 1)
    litter = np.clip(ndi.gaussian_filter(cov, 3.2 / tex_m * 2.0) * 9.0, 0, 1) * (1 - rock * 0.7)
    litter = litter ** 0.9 * 0.85

    n1 = spectral_noise(shape, tex_m, 14.0, 110.0, 2.0, rng)
    n2 = spectral_noise(shape, tex_m, 4.0, 18.0, 1.6, rng)
    n_drift = spectral_noise(shape, tex_m, 45.0, 300.0, 2.0, rng)
    high = smoothstep(1900.0, 2300.0, y)
    drift = smoothstep(-0.2, 0.9, n_drift) * (0.35 + 0.65 * high) * (1 - gr) * (1 - rock) * (1 - lk)
    drift = np.clip(drift, 0, 1)

    snow = srgb(0.925, 0.945, 0.975)
    snow_shade = srgb(0.86, 0.90, 0.96)
    rock_a = srgb(0.52, 0.49, 0.45)          # pale dolomite: a little lighter than the race mountain's granite
    rock_b = srgb(0.37, 0.35, 0.33)
    needles = srgb(0.20, 0.16, 0.11)
    ice = srgb(0.74, 0.86, 0.96)
    col = np.empty(shape + (3,), dtype=np.float32)
    var = (0.5 + 0.5 * np.tanh(n1 * 0.9))[..., None]
    snow_c = snow * (0.965 + 0.035 * var) + (snow_shade - snow) * (0.25 * (1 - var))
    snow_c = snow_c * (1 + 0.012 * n2[..., None])
    rock_c = rock_a * var + rock_b * (1 - var)
    rock_c = rock_c * (0.85 + 0.15 * (0.5 + 0.5 * np.tanh(n2))[..., None])
    col[:] = snow_c * (1 - rock[..., None]) + rock_c * rock[..., None]
    lit = np.clip(litter * (1 - gr), 0, 1)[..., None]
    col = col * (1 - lit * 0.75) + needles * (lit * 0.75) * (0.8 + 0.2 * var)
    col = col * (1 - 0.06 * gr[..., None]) + srgb(0.86, 0.91, 1.0) * 0.06 * gr[..., None]
    col = col * (1 - lk[..., None]) + (ice * (0.94 + 0.06 * np.tanh(n2))[..., None]) * lk[..., None]
    col = np.clip(col, 0, 1)
    mask = np.dstack([rock, litter * (1 - gr), gr, drift])
    return dict(col=col, mask=mask, y=y, canopy=canopy, rock=rock, lake=lk, gr=gr, litter=litter, H=H, trees=trees)


def light_map(b, size, quick):
    H = b["H"]
    out = np.zeros((size, size, 3), np.float32)
    print("  terrain sun visibility ...")
    out[..., 0] = lm.sun_visibility(H, X0, Z0, DX, ow.SUN_AZIMUTH_DEG, ow.SUN_ELEVATION_DEG, size, taps=5 if quick else 7)
    print("  tree shadows ...")
    shade = lm.canopy_shadow(b["canopy"], ow.sun_direction(), (X1 - X0) / size)
    out[..., 1] = out[..., 0] * (1 - 0.62 * shade)
    print("  ambient occlusion ...")
    ao = lm.sky_visibility(H, X0, Z0, DX, size, directions=8 if quick else 12)
    ao = ao ** 1.1 * (1 - 0.40 * b["canopy"])
    out[..., 2] = np.clip(ao * 1.08, 0, 1)
    return out


def hillshade_map(b, size=1024):
    """the base map of the in-game map screen"""
    H = b["H"]
    Hs = ndi.zoom(ndi.gaussian_filter(H, 1.2), size / H.shape[0], order=1)
    dxm = (X1 - X0) / size
    gz, gx = np.gradient(Hs, dxm)
    sun = ow.sun_direction()
    nrm = np.dstack([-gx, np.ones_like(gx), -gz])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    sh = np.clip(nrm @ sun, 0, 1)
    sl = np.hypot(gx, gz)
    t = smoothstep(1400.0, 3300.0, Hs)
    low = srgb(0.62, 0.72, 0.60)
    mid = srgb(0.86, 0.90, 0.94)
    hi = srgb(0.98, 0.99, 1.0)
    base = np.where(t[..., None] < 0.35, low + (mid - low) * (t[..., None] / 0.35), mid + (hi - mid) * ((t[..., None] - 0.35) / 0.65))
    rock = smoothstep(0.70, 1.05, sl)[..., None]
    base = base * (1 - rock * 0.75) + srgb(0.50, 0.46, 0.42) * rock * 0.75
    forest = ndi.zoom(b["canopy"], size / b["canopy"].shape[0], order=1)[..., None]
    base = base * (1 - forest * 0.55) + srgb(0.26, 0.40, 0.27) * forest * 0.55
    lk = ndi.zoom(b["lake"], size / b["lake"].shape[0], order=1)[..., None]
    base = base * (1 - lk) + srgb(0.62, 0.78, 0.95) * lk
    img = base * (0.42 + 0.78 * sh[..., None])
    return np.clip(img, 0, 1)


def main():
    args = sys.argv[1:]
    size = int(args[args.index("--size") + 1]) if "--size" in args else 2048
    quick = "--quick" in args
    os.makedirs(OUT, exist_ok=True)
    print("maps ...")
    b = build(size)
    Image.fromarray((b["col"] * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "color.jpg"), quality=90, subsampling=0)
    from imgio import save_webp
    save_webp(Image.fromarray((np.clip(b["mask"], 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA"), os.path.join(OUT, "mask.webp"), 95)
    print("light map ...")
    rgb = np.clip(light_map(b, size, quick), 0, 1)
    rgb[..., 1] = ndi.gaussian_filter(rgb[..., 1], 0.8)
    rgb[..., 2] = ndi.gaussian_filter(rgb[..., 2], 1.0)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, "light.jpg"), quality=90, subsampling=0, optimize=True)
    print("map ...")
    m = hillshade_map(b, 1024)
    Image.fromarray((m * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "map.jpg"), quality=88)
    print("mean light R,G,B:", rgb.reshape(-1, 3).mean(axis=0), "rock mean", b["rock"].mean())
    print("wrote", OUT)


if __name__ == "__main__":
    main()
