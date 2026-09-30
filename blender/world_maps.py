#!/usr/bin/env python3
"""
Terrain macro maps for Alpine Descent (numpy + Pillow, no Blender needed).

Reads build/world.npz (from world_gen.py) and writes into ski/assets/tex/:
    terrain_color.jpg   macro albedo (snow, rock, needle litter)   1024 x 4096
    terrain_mask.png    R rock  G litter  B groomed piste  A wind drift
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
    H, slope, rock_h = data["H"], data["slope"], data["rock"]
    w_piste, trees = data["w_piste"], data["trees"]
    rng = np.random.default_rng(wg.SEED + 7)
    X, Z = texel_grid()
    shape = X.shape

    rock = np.clip(resample(rock_h, X, Z), 0, 1)
    groom = np.clip(resample(w_piste, X, Z), 0, 1)
    sl = resample(slope, X, Z)
    y = resample(H, X, Z)

    # ---- needle litter under the forest: splat tree crowns then blur
    dxm = (wg.X1 - wg.X0) / TW
    dzm = (wg.Z1 - wg.Z0) / TH
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
    Image.fromarray((np.clip(mask, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(
        os.path.join(OUT_TEX, "terrain_mask.png"), optimize=True)
    print("wrote terrain_color.jpg and terrain_mask.png to", OUT_TEX)


if __name__ == "__main__":
    main()
