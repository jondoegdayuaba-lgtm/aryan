"""
Numpy-only light-map terms for a height field (no Blender needed):

  sun_visibility   soft ray-marched ridge shadows for a sun direction (the terrain's own shadow)
  sky_visibility   horizon based ambient occlusion (how much sky each point sees)
  canopy_shadow    the shadow trees throw on the snow, from a canopy density map

Used by open_maps.py for the open world.  The race mountain's light map is baked in Cycles (bake_terrain.py); this
file follows the same conventions (R = terrain sun visibility, G = R x tree shadow, B = ambient occlusion).
"""
import math

import numpy as np
from scipy import ndimage as ndi


def _sample(H, fz, fx):
    return ndi.map_coordinates(H, [fz, fx], order=1, mode="nearest")


def sun_visibility(H, x0, z0, dx, sun_az_deg, sun_el_deg, out_size, disc_deg=1.0, taps=7, max_dist=5200.0, verbose=True):
    """visibility (0..1) of the sun for out_size x out_size points spread over the height field"""
    ny, nx = H.shape
    H = np.asarray(H, dtype=np.float32)
    w2 = out_size // 2
    xs = x0 + (np.arange(w2) + 0.5) / w2 * ((nx - 1) * dx)
    zs = z0 + (np.arange(w2) + 0.5) / w2 * ((ny - 1) * dx)
    X, Z = np.meshgrid(xs, zs)
    fx0 = ((X - x0) / dx).astype(np.float32)
    fz0 = ((Z - z0) / dx).astype(np.float32)
    y0 = _sample(H, fz0, fx0) + 0.4
    hmax = float(H.max())
    az0 = math.radians(sun_az_deg)
    el0 = math.radians(sun_el_deg)
    dirs = [(0.0, 0.0)] + [(disc_deg * math.cos(2 * math.pi * k / (taps - 1)), disc_deg * math.sin(2 * math.pi * k / (taps - 1)))
                           for k in range(taps - 1)]
    vis = np.zeros_like(y0, dtype=np.float32)
    for n, (da, de) in enumerate(dirs):
        az = az0 + math.radians(da) / max(math.cos(el0), 0.2)
        el = el0 + math.radians(de)
        d = np.array([-math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el)])
        blocked = np.zeros(y0.shape, dtype=bool)
        t = 2.0
        while t < max_dist:
            ray_y = y0 + d[1] * t
            if ray_y.min() > hmax:
                break
            fx = fx0 + d[0] * t / dx
            fz = fz0 + d[2] * t / dx
            inside = (fx >= 0) & (fx <= nx - 1) & (fz >= 0) & (fz <= ny - 1)
            hh = _sample(H, np.clip(fz, 0, ny - 1), np.clip(fx, 0, nx - 1))
            blocked |= (hh > ray_y) & inside
            t = t * 1.06 + 1.2
        vis += (~blocked).astype(np.float32)
        if verbose:
            print(f"    sun tap {n + 1}/{len(dirs)}")
    vis /= len(dirs)
    return ndi.zoom(vis, out_size / w2, order=1)[:out_size, :out_size]


def sky_visibility(H, x0, z0, dx, out_size, directions=12, radii=(6, 12, 22, 40, 70, 110, 170, 250, 360)):
    """ambient occlusion: the fraction of the sky above the terrain's own tangent plane that is open, from horizon angles in
    `directions` directions.  It is measured relative to the local slope (like Cycles' cosine-weighted AO about the surface
    normal) because the game already looks the sky light up by the surface normal: a steep face in the open must not be darkened
    for tilting away from the zenith, only for what stands in front of it."""
    ny, nx = H.shape
    H = np.asarray(H, dtype=np.float32)
    xs = x0 + (np.arange(out_size) + 0.5) / out_size * ((nx - 1) * dx)
    zs = z0 + (np.arange(out_size) + 0.5) / out_size * ((ny - 1) * dx)
    X, Z = np.meshgrid(xs, zs)
    fx0 = ((X - x0) / dx).astype(np.float32)
    fz0 = ((Z - z0) / dx).astype(np.float32)
    y0 = _sample(H, fz0, fx0)
    Hs = ndi.gaussian_filter(H, 1.5)
    gz_, gx_ = np.gradient(Hs, dx)
    gxs = _sample(gx_.astype(np.float32), fz0, fx0)
    gzs = _sample(gz_.astype(np.float32), fz0, fx0)
    acc = np.zeros_like(y0)
    for k in range(directions):
        a = 2 * math.pi * (k + 0.5) / directions
        ca, sa = math.cos(a), math.sin(a)
        rise = gxs * ca + gzs * sa                     # slope of the ground toward this direction
        best = np.zeros_like(y0)
        for r in radii:
            fx = np.clip(fx0 + ca * r / dx, 0, nx - 1)
            fz = np.clip(fz0 + sa * r / dx, 0, ny - 1)
            h = _sample(H, fz, fx)
            best = np.maximum(best, (h - y0) / r - rise)
        acc += 1.0 - np.sin(np.arctan(best)) * 0.92
    return np.clip(acc / directions, 0, 1)


def canopy_shadow(canopy, sun_dir, texel_m, distances=(5.0, 9.0, 13.0, 18.0, 24.0)):
    """shadow (0..1) that a canopy density map (0..1) casts on the ground toward the anti-sun direction: sample the canopy
    toward the sun at the horizontal distance a 12 m crown casts a shadow"""
    sx, sz = sun_dir[0], sun_dir[2]
    n = math.hypot(sx, sz) or 1.0
    sx, sz = sx / n, sz / n
    rows, cols = np.mgrid[0:canopy.shape[0], 0:canopy.shape[1]].astype(np.float32)
    acc = np.zeros_like(canopy, dtype=np.float32)
    for d in distances:
        acc += ndi.map_coordinates(canopy, [rows + sz * d / texel_m, cols + sx * d / texel_m], order=1, mode="nearest")
    return np.clip(acc / len(distances) * 1.25, 0, 1)
