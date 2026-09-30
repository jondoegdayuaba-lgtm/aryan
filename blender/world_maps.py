#!/usr/bin/env python3
"""
Terrain macro maps for Alpine Descent (numpy + Pillow, no Blender needed).

Reads build/world.npz (from world_gen.py) and writes into ski/assets/tex/:
    terrain_color.jpg   macro albedo (snow, rock, needle litter)   1024 x 4096
    terrain_mask.webp   R rock  G litter  B groomed piste  A wind drift  (lossy WebP q95, lossless alpha)
The texture rows run from z = Z0 (row 0) to z = Z1, columns from x = X0 to X1.
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world_gen as wg  # noqa: E402

TW, TH = 1024, 4096
OUT_TEX = os.path.join(wg.ROOT, "ski", "assets", "tex")


def texel_grid(tw=TW, th=TH):
    x = wg.X0 + (np.arange(tw) + 0.5) / tw * (wg.X1 - wg.X0)
    z = wg.Z0 + (np.arange(th) + 0.5) / th * (wg.Z1 - wg.Z0)
    return np.meshgrid(x, z)


def resample(arr, X, Z):
    return wg.bilinear(arr.astype(np.float64), X, Z)


def srgb(*c):
    return np.array(c, dtype=np.float32)


def build_maps():
    data = np.load(os.path.join(wg.BUILD, "world.npz"))
    H, slope = data["H"], data["slope"]
    w_piste, trees = data["w_piste"], data["trees"]
    rng = np.random.default_rng(wg.SEED + 7)
    X, Z = texel_grid()
    shape = X.shape

    groom = np.clip(resample(w_piste, X, Z), 0, 1)
    sl = resample(slope, X, Z)
    y = resample(H, X, Z)

    # ---- exposed rock: steep faces, streaked along the fall line (couloirs and ledges) instead of round blobs
    dxm = (wg.X1 - wg.X0) / TW
    dzm = (wg.Z1 - wg.Z0) / TH
    gzr, gxr = np.gradient(ndi.gaussian_filter(y, 1.2), dzm, dxm)
    mag = np.hypot(gxr, gzr) + 1e-6
    fall_x, fall_z = -gxr / mag, -gzr / mag
    base = wg.spectral_noise(shape, dxm, 5.0, 45.0, 1.6, rng)
    rows, cols = np.mgrid[0:TH, 0:TW].astype(np.float32)
    streak = np.zeros(shape, dtype=np.float32)
    taps = 9
    for k in range(-taps, taps + 1):
        streak += ndi.map_coordinates(base, [rows + fall_z * k * 2.2 / dzm, cols + fall_x * k * 2.2 / dxm], order=1, mode='nearest')
    streak /= 2 * taps + 1
    streak /= streak.std() + 1e-6
    sl_s = ndi.gaussian_filter(sl, 1.2)
    alt_r = wg.smoothstep(1900.0, 2450.0, y)
    rock = wg.smoothstep(0.70 - 0.30 * alt_r, 1.06 - 0.30 * alt_r, sl_s + 0.11 * streak)
    rock *= wg.smoothstep(0.40, 0.62, ndi.gaussian_filter(sl, 5.0))          # no isolated specks on gentle ground
    rock = ndi.gaussian_filter(rock, 0.7) * (1 - groom)
    rock = np.clip(rock, 0, 1)

    # ---- needle litter under the forest: splat tree crowns then blur
    cov = np.zeros(shape, dtype=np.float32)
    ix = np.clip(((trees[:, 0] - wg.X0) / dxm).astype(int), 0, TW - 1)
    iz = np.clip(((trees[:, 1] - wg.Z0) / dzm).astype(int), 0, TH - 1)
    np.add.at(cov, (iz, ix), trees[:, 3])
    litter = ndi.gaussian_filter(cov, (2.4 / dzm, 2.4 / dxm)) * 2.4
    litter = np.clip(litter, 0, 1) * (1 - rock * 0.7)
    litter = litter ** 0.9 * 0.85

    # ---- noise for the macro variation
    n1 = wg.spectral_noise(shape, dxm, 12.0, 90.0, 2.0, rng)
    n2 = wg.spectral_noise(shape, dxm, 3.0, 14.0, 1.6, rng)
    n_drift = wg.spectral_noise(shape, dxm, 40.0, 260.0, 2.0, rng)

    # wind drift: exposed shoulders and open bowl above the trees, never on the groomed piste
    high = wg.smoothstep(1850.0, 2100.0, y)
    drift = wg.smoothstep(-0.2, 0.9, n_drift) * (0.35 + 0.65 * high) * (1 - groom) * (1 - rock)
    drift = np.clip(drift, 0, 1)

    # ---- albedo (sRGB)
    snow = srgb(0.925, 0.945, 0.975)
    snow_shade = srgb(0.86, 0.90, 0.96)
    rock_a = srgb(0.43, 0.40, 0.37)
    rock_b = srgb(0.30, 0.28, 0.27)
    needles = srgb(0.20, 0.16, 0.11)
    col = np.empty(shape + (3,), dtype=np.float32)
    var = (0.5 + 0.5 * np.tanh(n1 * 0.9))[..., None]
    snow_c = snow * (0.965 + 0.035 * var) + (snow_shade - snow) * (0.25 * (1 - var))
    snow_c = snow_c * (1 + 0.012 * n2[..., None])
    rock_c = rock_a * var + rock_b * (1 - var)
    rock_c = rock_c * (0.85 + 0.15 * (0.5 + 0.5 * np.tanh(n2))[..., None])
    col[:] = snow_c * (1 - rock[..., None]) + rock_c * rock[..., None]
    lit = np.clip(litter * (1 - groom), 0, 1)[..., None]
    col = col * (1 - lit * 0.75) + needles * (lit * 0.75) * (0.8 + 0.2 * var)
    # a whisper of blue on the groomed piste (denser, more compact snow)
    col = col * (1 - 0.06 * groom[..., None]) + srgb(0.86, 0.91, 1.0) * 0.06 * groom[..., None]
    col = np.clip(col, 0, 1)

    mask = np.dstack([rock, litter * (1 - groom), groom, drift])
    return col, mask


def main():
    os.makedirs(OUT_TEX, exist_ok=True)
    col, mask = build_maps()
    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(
        os.path.join(OUT_TEX, "terrain_color.jpg"), quality=92, subsampling=0)
    from imgio import save_webp
    save_webp(Image.fromarray((np.clip(mask, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA"), os.path.join(OUT_TEX, "terrain_mask.webp"), 95)
    print("wrote terrain_color.jpg and terrain_mask.webp to", OUT_TEX)


if __name__ == "__main__":
    main()
