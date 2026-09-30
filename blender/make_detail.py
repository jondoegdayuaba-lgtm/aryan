"""
Tileable surface detail for the terrain shader -> ski/assets/tex/{rock_n,rock_c,snow_n}.png

  rock_n.png   tangent-space normal map of blocky, cracked alpine rock (one tile = 6.25 m)
  rock_c.png   its albedo tint (multiplied with the baked macro colour; ~0.65 = neutral)
  snow_n.png   wind-packed snow micro relief (grains, sastrugi ripples)

Everything is built from periodic (FFT) noise and a wrapped Voronoi so the tiles repeat without seams.
usage: python make_detail.py [--size 512]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

import common as C


def periodic_noise(size, scale, seed, slope=-0.4, aniso=(1.0, 1.0)):
    """band-limited periodic noise, unit variance. `scale` = cutoff frequency (cycles per tile)."""
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft2(rng.standard_normal((size, size)))
    kx = np.fft.rfftfreq(size)[None, :] * size / aniso[0]
    ky = np.fft.fftfreq(size)[:, None] * size / aniso[1]
    k = np.sqrt(kx ** 2 + ky ** 2) + 1e-6
    spec *= np.exp(-((k / scale) ** 2)) * k ** slope
    n = np.fft.irfft2(spec, s=(size, size))
    return (n - n.mean()) / (n.std() + 1e-9)


def voronoi(size, cells, seed, k=1.0, warp=0.0):
    """wrapped Voronoi: nearest-cell id, distance to the nearest and second nearest seed (tile units).
    k > 1 squashes the cells vertically (bedded rock); warp jitters the borders with noise."""
    rng = np.random.default_rng(seed)
    seeds = rng.random((cells, 2))
    off = np.array([[dx, dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1)], float)
    pts = (seeds[None] + off[:, None]).reshape(-1, 2) * np.array([1.0, k])
    tree = cKDTree(pts)
    yy, xx = (np.mgrid[0:size, 0:size] + 0.5) / size
    if warp:
        xx = (xx + warp * periodic_noise(size, 7, seed + 1)) % 1.0
        yy = (yy + warp * periodic_noise(size, 7, seed + 2)) % 1.0
    d, idx = tree.query(np.stack([xx.ravel(), yy.ravel() * k], 1), k=2)
    return (idx[:, 0] % cells).reshape(size, size), d[:, 0].reshape(size, size), d[:, 1].reshape(size, size), seeds


def normal_from_height(h, strength, metres_per_tile=6.25):
    size = h.shape[0]
    px = metres_per_tile / size
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px)
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], 2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def save(name, arr):
    path = os.path.join(C.ASSETS, 'tex', name)
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, optimize=True)
    print(f'wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)')


def rock(size):
    cell, d1, d2, seeds = voronoi(size, 34, 11, k=1.9, warp=0.012)
    edge = (d2 - d1) * size / 1.6                                                     # pixels from the nearest cell border
    rng = np.random.default_rng(5)
    # every block is a tilted facet with its own brightness
    tilt = rng.normal(0, 1, (len(seeds), 2)) * 0.22
    bright = 0.86 + 0.30 * rng.random(len(seeds))
    yy, xx = (np.mgrid[0:size, 0:size] + 0.5) / size
    dxs = xx - seeds[cell, 0]
    dys = yy - seeds[cell, 1]
    dxs -= np.round(dxs)
    dys -= np.round(dys)
    facet = (tilt[cell, 0] * dxs + tilt[cell, 1] * dys) * 6.25
    n1 = periodic_noise(size, 10, 21)
    n2 = periodic_noise(size, 40, 22)
    n3 = periodic_noise(size, 130, 23)
    crack = 1.0 - np.clip(edge / 5.0, 0, 1)                                     # 1 in the joint, 0 inside the block
    strata = np.sin((yy + 0.06 * n1) * 2 * np.pi * 7.0) * 0.5 + 0.5             # faint horizontal bedding
    h = facet * 0.9 + 0.016 * n1 + 0.0075 * n2 + 0.0026 * n3 - 0.035 * crack ** 0.8 + 0.006 * strata
    normal = normal_from_height(h, 1.0)
    # albedo
    streak = periodic_noise(size, 60, 24, aniso=(1.0, 0.16))                    # long vertical water streaks
    lum = bright[cell] * (1 + 0.10 * n1 + 0.10 * n2 + 0.09 * n3 - 0.07 * streak)
    lum *= 1 - 0.50 * crack ** 1.2
    lum *= 0.94 + 0.10 * strata
    lum = 0.66 * lum / lum.mean()
    warm = 1 + 0.018 * periodic_noise(size, 14, 25)
    col = np.stack([lum * 1.015 * warm, lum, lum * 0.975 / warm], 2)
    return normal, np.clip(col, 0, 1)


def snow(size):
    h = np.zeros((size, size))
    for k, (scale, gain) in enumerate([(6, 1.0), (14, 0.6), (34, 0.32), (80, 0.16), (170, 0.07)]):
        h += gain * periodic_noise(size, scale, 40 + k)
    # wind-formed ripples: fine sastrugi lines drifting diagonally
    rip = periodic_noise(size, 30, 60, aniso=(0.35, 1.0))
    h += 0.35 * rip
    return normal_from_height(h * 0.012, 1.0, 6.25)


def main():
    size = 512
    if '--size' in sys.argv:
        size = int(sys.argv[sys.argv.index('--size') + 1])
    n, c = rock(size)
    save('rock_n.png', n)
    save('rock_c.png', c)
    save('snow_n.png', snow(size))


if __name__ == '__main__':
    main()
