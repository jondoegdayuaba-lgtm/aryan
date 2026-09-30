"""
Quick perspective preview of a height field (voxel-space renderer in numpy) for judging the shape of a mountain before
it goes into the game.  Not used by the game.

    voxel_view(H, x0, z0, dx, cam=(x, y, z), yaw_deg, fov=70, colour=(H-shaped RGB array) ...) -> uint8 image
yaw 0 looks toward -z (north), 90 toward +x (east), 180 toward +z (south).
"""
import math

import numpy as np
from scipy import ndimage as ndi


def voxel_view(H, x0, z0, dx, cam, yaw_deg, fov_deg=70.0, width=960, height=540, pitch_deg=0.0, max_dist=6000.0,
               colour=None, sun=(-0.295, 0.6157, 0.7306), fog=(0.72, 0.80, 0.93), fog_dist=4500.0):
    H = np.asarray(H, dtype=np.float32)
    gz, gx = np.gradient(H.astype(np.float64), dx)
    nrm = np.dstack([-gx, np.ones_like(gx), -gz])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    shade = np.clip(nrm @ np.array(sun), 0, 1).astype(np.float32)
    if colour is None:
        colour = np.ones(H.shape + (3,), np.float32) * np.array([0.93, 0.95, 0.98], np.float32)
    f = (width / 2) / math.tan(math.radians(fov_deg / 2))
    yaw = math.radians(yaw_deg)
    cols = np.arange(width)
    ang = np.arctan((cols - width / 2 + 0.5) / f)
    dirx = np.sin(yaw + ang)
    dirz = -np.cos(yaw + ang)
    cosa = np.cos(ang)
    horizon = height / 2 + f * math.tan(math.radians(pitch_deg))
    img = np.zeros((height, width, 3), np.float32)
    # sky gradient
    t = np.clip(np.arange(height)[:, None] / max(horizon, 1), 0, 1)
    sky_top = np.array([0.35, 0.52, 0.86], np.float32)
    sky_low = np.array(fog, np.float32)
    img[:] = (sky_top * (1 - t)[..., None] + sky_low * t[..., None])
    ymin = np.full(width, height, dtype=np.int64)
    cx, cy, cz = cam
    d = 2.0
    step = dx * 0.9
    ny, nx_ = H.shape
    while d < max_dist:
        px = cx + dirx * d
        pz = cz + dirz * d
        fx = (px - x0) / dx
        fz = (pz - z0) / dx
        inside = (fx >= 0) & (fx <= nx_ - 1) & (fz >= 0) & (fz <= ny - 1)
        if not inside.any():
            break
        cf = np.clip(fz, 0, ny - 1), np.clip(fx, 0, nx_ - 1)
        h = ndi.map_coordinates(H, cf, order=1, mode="nearest")
        sh = ndi.map_coordinates(shade, cf, order=1, mode="nearest")
        depth = d * cosa
        ys = (horizon - f * (h - cy) / depth).astype(np.int64)
        draw = inside & (ys < ymin)
        if draw.any():
            cc = np.stack([ndi.map_coordinates(colour[..., k], cf, order=1, mode="nearest") for k in range(3)], 1)
            fogk = 1.0 - np.exp(-(d / fog_dist) ** 1.6)
            lit = cc * (0.30 + 0.85 * sh[:, None])
            lit = lit * (1 - fogk) + np.array(fog, np.float32) * fogk
            for c in np.nonzero(draw)[0]:
                y0 = max(int(ys[c]), 0)
                y1 = int(ymin[c])
                if y1 > y0:
                    img[y0:y1, c] = lit[c]
                ymin[c] = y0 if ys[c] < ymin[c] else ymin[c]
        d += step
        step *= 1.0025
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def save_views(H, x0, z0, dx, views, path_prefix, colour=None, **kw):
    from PIL import Image
    out = []
    for i, v in enumerate(views):
        cam, yaw = v[0], v[1]
        pitch = v[2] if len(v) > 2 else 0.0
        im = voxel_view(H, x0, z0, dx, cam, yaw, colour=colour, pitch_deg=pitch, **kw)
        p = f"{path_prefix}_{i}.png"
        Image.fromarray(im).save(p)
        out.append(p)
    return out
