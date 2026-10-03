# Meshes and images made from the world data: the distant mountain ring, and
# the parchment map the game shows in its minimap and pause menu.
import math
import os
import numpy as np
import bpy
import bmesh

from common import mat, TEXTURES, ASSETS
from textures import fbm, hexc
import terrain as T


def sample(grid, u, v):
    """Bilinear sample of a periodic grid at fractional coords (arrays)."""
    n = grid.shape[0]
    u = np.mod(u, n)
    v = np.mod(v, n)
    i0 = np.floor(v).astype(int) % n
    j0 = np.floor(u).astype(int) % n
    i1 = (i0 + 1) % n
    j1 = (j0 + 1) % n
    tv = v - np.floor(v)
    tu = u - np.floor(u)
    return (grid[i0, j0] * (1 - tu) * (1 - tv) + grid[i0, j1] * tu * (1 - tv)
            + grid[i1, j0] * (1 - tu) * tv + grid[i1, j1] * tu * tv)


def mountains(collection=None):
    """Ring of mountains from just outside the map to the horizon. Snow-capped
    peaks to the north, lower bluffs and mesas elsewhere. Vertex coloured."""
    segs, rings = 480, 64
    r0, r1 = 1080.0, 11000.0
    n1 = fbm(512, 2.4, 301)
    n2 = fbm(512, 1.9, 302)
    span = 20000.0
    ang = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    rad = r0 * (r1 / r0) ** (np.linspace(0, 1, rings) ** 1.15)
    A, R = np.meshgrid(ang, rad)               # [ring, seg]
    X = R * np.cos(A)
    Z = R * np.sin(A)
    u = (X / span + 0.5) * 512
    v = (Z / span + 0.5) * 512
    ridge = 1 - np.abs(2 * sample(n1, u * 2.6, v * 2.6) - 1)
    broad = sample(n1, u * 0.8 + 50, v * 0.8 + 50)
    detail = sample(n2, u * 7, v * 7)
    north = np.clip(-np.sin(A), 0, 1) ** 1.3
    west = np.clip(-np.cos(A), 0, 1)
    amp = 420 + 1500 * north + 260 * west + 160 * sample(n2, u, v)
    env = T.sstep(1500, 4600, R) * (1 - 0.3 * T.sstep(7500, 11000, R))
    H = 30 + env * amp * (0.3 + 0.7 * broad ** 1.3) * (0.72 + 0.28 * ridge) + env * 30 * detail
    # Flat-topped mesas to the south-east
    mesa = T.sstep(0.25, 0.6, -np.cos(A + 0.9)) * T.sstep(1600, 2600, R) * (1 - T.sstep(4200, 5200, R))
    H = np.maximum(H, mesa * np.minimum(300 + 120 * ridge, 160 + 600 * sample(n1, u * 4, v * 4)))
    H[0, :] = 0
    # Colours by height and slope, snow line wobbling with noise
    snowline = 820 + 260 * (sample(n2, u * 3, v * 3) - 0.5)
    gz, gx = np.gradient(H)
    steep = np.clip(np.hypot(gx, gz) / (np.gradient(R, axis=0) + 1e-3), 0, 2)
    c_forest = hexc('#2f3b2a')
    c_grass = hexc('#6a6a3e')
    c_rock = hexc('#8d8780')
    c_rock2 = hexc('#a08c70')
    c_snow = hexc('#eef1f5')
    col = np.zeros(H.shape + (3,))
    t_forest = (1 - T.sstep(250, 650, H)) * (1 - 0.6 * mesa)
    col[:] = c_rock
    col = col * (1 - (mesa > 0.3)[..., None] * 0.0) + (c_rock2 - c_rock) * mesa[..., None]
    col = col * (1 - t_forest[..., None]) + (c_forest * (0.8 + 0.4 * detail[..., None])) * t_forest[..., None]
    grass = (1 - T.sstep(80, 200, H)) * 0.7
    col = col * (1 - grass[..., None]) + c_grass * grass[..., None]
    snow = T.sstep(snowline - 60, snowline + 80, H) * (1 - T.sstep(0.8, 1.6, steep) * 0.5)
    col = col * (1 - snow[..., None]) + c_snow * snow[..., None]

    me = bpy.data.meshes.new('Mountains')
    verts = [(float(X[i, j]), float(-Z[i, j]), float(H[i, j])) for i in range(rings) for j in range(segs)]
    faces = []
    for i in range(rings - 1):
        for j in range(segs):
            k = (j + 1) % segs
            a, b, c, d = i * segs + j, i * segs + k, (i + 1) * segs + k, (i + 1) * segs + j
            faces.append((a, d, c, b))
    me.from_pydata(verts, [], faces)
    me.update()
    lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    flat = np.concatenate([lin.reshape(-1, 3), np.ones((rings * segs, 1))], axis=1).astype(np.float32).ravel()
    attr.data.foreach_set('color', flat)
    me.color_attributes.active_color = attr
    for p in me.polygons:
        p.use_smooth = True
    m = bpy.data.materials.new('MountainMat')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    bsdf = nodes['Principled BSDF']
    ca = nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'Col'
    m.node_tree.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.95
    m.use_backface_culling = True
    me.materials.append(m)
    ob = bpy.data.objects.new('Mountains', me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def upsample(a, n):
    src = a.shape[0]
    f = np.linspace(0, src - 1, n)
    i0 = np.floor(f).astype(int)
    i1 = np.minimum(i0 + 1, src - 1)
    t = f - i0
    rows = a[i0] * (1 - t)[:, None] + a[i1] * t[:, None]
    return rows[:, i0] * (1 - t)[None, :] + rows[:, i1] * t[None, :]


def paint_map(world, n=1024):
    """Parchment map with hill shading, contours, forests, river and roads."""
    h = upsample(world.h, n)
    forest = upsample(world.forest, n)
    dirt = upsample(world.dirt, n)
    px = T.SIZE / n
    gz, gx = np.gradient(h, px)
    shade = np.clip(0.75 + (-gx - gz) * 0.35, 0.35, 1.25)
    paper = hexc('#d9c9a2') * (0.92 + 0.12 * fbm(n, 2.2, 401)[..., None])
    elev = np.clip((h - 50) / 500, 0, 1)
    col = paper * (1 - 0.25 * elev[..., None]) + hexc('#9c8a68') * 0.25 * elev[..., None]
    col = col * (1 - 0.1 * T.sstep(0.0, 0.3, (h - 600) / 200)[..., None]) + 0.1 * T.sstep(0, 0.3, (h - 600) / 200)[..., None]
    col = col * shade[..., None]
    fblur = forest
    for _ in range(3):
        fblur = (fblur + np.roll(fblur, 1, 0) + np.roll(fblur, -1, 0) + np.roll(fblur, 1, 1) + np.roll(fblur, -1, 1)) / 5
    f = np.clip(fblur * 1.6, 0, 1)
    col = col * (1 - 0.35 * f[..., None]) + hexc('#5d6b48') * 0.35 * f[..., None]
    # Contours every 20 m
    band = np.floor(h / 20)
    edge = (band != np.roll(band, 1, 0)) | (band != np.roll(band, 1, 1))
    col[edge] = col[edge] * 0.82
    # River
    xs = (np.arange(n) + 0.5) * px - T.HALF
    X, Z = np.meshgrid(xs, xs)
    rd = np.abs(X - T.river_x(Z))
    water = 1 - T.sstep(10, 15, rd)
    col = col * (1 - water[..., None]) + hexc('#5f7f92') * water[..., None]
    bankline = (rd > 14) & (rd < 17)
    col[bankline] = col[bankline] * 0.75
    # Roads
    road = T.sstep(0.35, 0.6, dirt)
    col = col * (1 - 0.55 * road[..., None]) + hexc('#6b4a2c') * 0.55 * road[..., None]
    # Edge vignette
    r = np.hypot(X, Z) / T.HALF
    col = col * (1 - 0.35 * T.sstep(0.95, 1.4, r))[..., None]
    out = np.clip(col, 0, 1)
    img = bpy.data.images.new('map', n, n, alpha=False)
    px4 = np.concatenate([out, np.ones((n, n, 1))], axis=2)[::-1]
    img.pixels.foreach_set(px4.astype(np.float32).ravel())
    path = os.path.join(ASSETS, 'map.jpg')
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save()
    return path
