"""Loot: doubloons, a chest with a hinged lid and gold inside, a giant clam that
opens to show a pearl, amphora, goblet, gold bar, gem, spare air tank and the
five legendary relics."""
import math

import numpy as np
from mathutils import Matrix, Vector, noise

from geo import (Mesh, box, empty, hexc, icosphere, join, lathe, lerp_colors, material, paint, smoothstep, sweep,
                 vnoise)


def gold():
    return material('gold', '#e8b84a', metal=1.0, rough=0.28)


def gem_mat():
    return material('gem', '#d01f3c', rough=0.05)


def iron():
    return material('iron', '#3f3a35', metal=0.6, rough=0.75)


def wood():
    return material('wood', '#7b6a52', rough=0.85)


def white(P, N):
    return np.ones((len(P), 3))


def coin():
    m = Mesh()
    r, t = 0.045, 0.005
    lathe(m, [(0.001, -t), (r, -t), (r, t), (r * 0.86, t), (r * 0.82, t * 0.6), (0.001, t * 0.6)], gold(), seg=24)
    # Embossed cross on the face.
    box(m, (r * 1.1, 0.012, 0.004), gold(), center=(0, 0, t * 0.6 + 0.001))
    box(m, (0.012, r * 1.1, 0.004), gold(), center=(0, 0, t * 0.6 + 0.0015))
    return m.build('coin', smooth=30, colors=white)


def gold_pile():
    """A heap of coins filling the chest; reads as hundreds of doubloons."""
    m = Mesh()
    icosphere(m, 1.0, gold(), subdiv=3)

    def shape(co):
        d = co.normalized()
        p = Vector((d.x * 0.38, d.y * 0.2, max(d.z, 0) * 0.16 - 0.02))
        p.z += 0.015 * noise.noise(d * 9)
        return p
    m.displace(shape)
    rng = np.random.default_rng(7)
    for k in range(26):
        c = Mesh()
        lathe(c, [(0.001, -0.004), (0.04, -0.004), (0.04, 0.004), (0.001, 0.004)], gold(), seg=12)
        x, y = rng.uniform(-0.32, 0.32), rng.uniform(-0.16, 0.16)
        z = 0.16 * max(0, 1 - (x / 0.38) ** 2 - (y / 0.2) ** 2) ** 0.5
        mtx = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, 'X') @ Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, 'Y')
        m.add(c, mtx)
    return m.build('gold_pile', smooth=40, colors=white)


def chest():
    """Base and lid are separate; the lid's origin sits on the hinge line."""
    W, D, H = 0.9, 0.56, 0.42
    base = Mesh()
    w = wood()
    box(base, (W, D, 0.04), w, center=(0, 0, 0.02), uv_scale=1 / 1.8)
    # Walls sit on the floor and the end walls fit between the long ones, so no faces overlap.
    wh, wz = H - 0.04, 0.04 + (H - 0.04) / 2
    box(base, (W, 0.05, wh), w, center=(0, -D / 2 + 0.025, wz), uv_scale=1 / 1.8)
    box(base, (W, 0.05, wh), w, center=(0, D / 2 - 0.025, wz), uv_scale=1 / 1.8)
    box(base, (0.05, D - 0.1, wh), w, center=(-W / 2 + 0.025, 0, wz), uv_scale=1 / 1.8)
    box(base, (0.05, D - 0.1, wh), w, center=(W / 2 - 0.025, 0, wz), uv_scale=1 / 1.8)
    for x in (-0.3, 0.3):
        box(base, (0.06, D + 0.02, 0.02), iron(), center=(x, 0, H - 0.01))
        box(base, (0.06, 0.02, H), iron(), center=(x, -D / 2 - 0.006, H / 2))
        box(base, (0.06, 0.02, H), iron(), center=(x, D / 2 + 0.006, H / 2))
    box(base, (0.12, 0.03, 0.14), iron(), center=(0, -D / 2 - 0.012, H - 0.06))
    base_ob = base.build('chest_base', smooth=None, colors=lambda P, N: lerp_colors(vnoise(P, 4, 2) * 0.5 + 0.5, [(0, '#a49a83'), (1, '#d8cfb6')]))
    lid = Mesh()
    prof = []
    for a in np.linspace(0, math.pi, 10):
        prof.append((math.cos(a) * D / 2, math.sin(a) * 0.16))
    P = np.zeros((2, len(prof), 3))
    for i, x in enumerate((-W / 2, W / 2)):
        for j, (yy, zz) in enumerate(prof):
            P[i, j] = (x, yy, zz)
    UV = np.zeros((2, len(prof), 2))
    UV[..., 0] = np.array([-W / 2, W / 2])[:, None] / 1.8
    UV[..., 1] = np.linspace(0, 0.9, len(prof))[None, :] / 1.8
    V = lid.grid(P, w, uv=UV)
    lid.cap(V[0], w, flip=True)
    lid.cap(V[1], w)
    for x in (-0.3, 0.3):
        band = [(x, math.cos(a) * (D / 2 + 0.01), math.sin(a) * 0.17) for a in np.linspace(0, math.pi, 10)]
        sweep(lid, band, 0.012, iron(), sides=4, squash=3.0)
    # Hinge at the back top edge: shift so the hinge line is the origin.
    lid.transform(Matrix.Translation((0, -D / 2, 0)))
    lid_ob = lid.build('chest_lid', smooth=40, colors=lambda P, N: lerp_colors(vnoise(P, 4, 2) * 0.5 + 0.5, [(0, '#a49a83'), (1, '#d8cfb6')]))
    lid_ob.location = (0, D / 2, H)
    pile = gold_pile()
    pile.location = (0, 0, H - 0.08)
    return empty('chest', [base_ob, lid_ob, pile])


def clam():
    """Giant clam: ribbed valves with wavy lips. The top valve's origin is the
    hinge so the game can open it; the pearl sits on the mantle."""
    def valve(sign):
        m = Mesh()
        na, nr = 40, 12
        P = np.zeros((nr, na, 3))
        for i, r in enumerate(np.linspace(0.04, 1.0, nr)):
            for j, a in enumerate(np.linspace(0.05, math.pi - 0.05, na)):
                R = 0.55 * r
                x, y = math.cos(a) * R * 1.15, math.sin(a) * R
                bowl = -0.2 * math.sin(math.pi * min(r, 1.0) ** 0.8) ** 0.9 * (0.4 + 0.6 * math.sin(a))
                rib = 0.03 * abs(math.sin(a * 6)) * r
                lip = 0.045 * math.sin(a * 12) * smoothstep(0.75, 1.0, r)
                P[i, j] = (x, y, sign * (bowl - rib) + lip)
        m.grid(P, material('clam', '#d8d0bc', rough=0.7), flip=sign > 0)
        return m

    def shell_col(P, N):
        t = vnoise(P, 6, 2) * 0.5 + 0.5
        return lerp_colors(t, [(0, '#b9ad94'), (0.6, '#d9cfb8'), (1, '#efe7d4')])
    bottom = valve(1).build('clam_bottom', smooth=50, colors=shell_col)
    top = valve(-1)
    top_ob = top.build('clam_top', smooth=50, colors=shell_col)
    mantle = Mesh()
    na, nr = 36, 8
    P = np.zeros((nr, na, 3))
    for i, r in enumerate(np.linspace(0.02, 0.92, nr)):
        for j, a in enumerate(np.linspace(0.1, math.pi - 0.1, na)):
            R = 0.55 * r
            P[i, j] = (math.cos(a) * R * 1.15, math.sin(a) * R, -0.06 + 0.03 * math.sin(a * 9 + r * 6) * r)
    mantle.grid(P, material('mantle', '#2e8fb8', rough=0.35))

    def mantle_col(P, N):
        n = vnoise(P, 14, 2) * 0.5 + 0.5
        c = lerp_colors(n, [(0, '#16506e'), (0.5, '#2d9cc4'), (0.8, '#5fd0c8'), (1, '#9fe3b2')])
        spots = vnoise(P, 40, 1) > 0.45
        c[spots] = hexc('#b8f2ff')
        return c
    mantle_ob = mantle.build('clam_mantle', smooth=60, colors=mantle_col)
    pearl = Mesh()
    icosphere(pearl, 0.05, material('pearl', '#f4f1ea', rough=0.12), subdiv=3, center=(0, 0.2, -0.0))
    pearl_ob = pearl.build('pearl', smooth=80, colors=white)
    base = join([bottom, mantle_ob], 'clam_body')
    return empty('clam', [base, top_ob, pearl_ob])


def amphora():
    m = Mesh()
    prof = [(0.001, 0.0), (0.03, 0.0), (0.05, 0.06), (0.14, 0.22), (0.18, 0.4), (0.17, 0.56), (0.12, 0.7),
            (0.065, 0.76), (0.055, 0.9), (0.07, 0.94), (0.06, 0.97), (0.045, 0.95), (0.04, 0.8), (0.001, 0.7)]
    lathe(m, prof, material('terracotta', '#b0643c', rough=0.85), seg=22)
    for sx in (-1, 1):
        pts = [(sx * 0.06, 0, 0.88), (sx * 0.15, 0, 0.88), (sx * 0.17, 0, 0.78), (sx * 0.15, 0, 0.66)]
        sweep(m, pts, 0.018, material('terracotta', '#b0643c', rough=0.85), sides=6)

    def col(P, N):
        n = vnoise(P, 6, 3) * 0.5 + 0.5
        c = lerp_colors(n, [(0.2, '#8f4b2c'), (0.6, '#b56b42'), (0.9, '#c8865a')])
        crust = smoothstep(0.55, 0.65, vnoise(P, 3, 3, (5, 5, 5)) * 0.5 + 0.5)
        return c * (1 - crust[:, None]) + hexc('#cfc7b4') * crust[:, None]
    return m.build('amphora', smooth=50, colors=col)


def goblet():
    m = Mesh()
    prof = [(0.001, 0.0), (0.07, 0.0), (0.075, 0.012), (0.03, 0.03), (0.016, 0.06), (0.02, 0.1), (0.016, 0.13),
            (0.02, 0.15), (0.06, 0.18), (0.075, 0.25), (0.07, 0.26), (0.06, 0.2), (0.001, 0.17)]
    lathe(m, prof, gold(), seg=24)
    for k in range(5):
        a = k / 5 * math.tau
        icosphere(m, 0.011, gem_mat(), subdiv=1, center=(math.cos(a) * 0.072, math.sin(a) * 0.072, 0.215))
    return m.build('goblet', smooth=40, colors=white)


def ingot():
    m = Mesh()
    b, t = (0.24, 0.1), (0.2, 0.07)
    h = 0.06
    verts = [(-b[0] / 2, -b[1] / 2, 0), (b[0] / 2, -b[1] / 2, 0), (b[0] / 2, b[1] / 2, 0), (-b[0] / 2, b[1] / 2, 0),
             (-t[0] / 2, -t[1] / 2, h), (t[0] / 2, -t[1] / 2, h), (t[0] / 2, t[1] / 2, h), (-t[0] / 2, t[1] / 2, h)]
    m.tris(verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], gold())
    return m.build('ingot', smooth=None, colors=white)


def gem():
    """Brilliant-cut stone: crown, girdle and pavilion facets."""
    m = Mesh()
    lathe(m, [(0.001, -0.07), (0.07, 0.0), (0.075, 0.008), (0.05, 0.035), (0.001, 0.04)], gem_mat(), seg=8)
    return m.build('gem', smooth=None, colors=white)


def air_tank():
    m = Mesh()
    lathe(m, [(0.001, 0.0), (0.08, 0.005), (0.09, 0.03), (0.09, 0.5), (0.07, 0.58), (0.03, 0.62), (0.001, 0.62)],
          material('tank', '#f2c230', metal=0.3, rough=0.4), seg=20)
    lathe(m, [(0.001, 0.62), (0.025, 0.62), (0.025, 0.7), (0.001, 0.7)], material('chrome', '#d0d4d8', metal=1, rough=0.2), seg=12)
    sweep(m, [(0, 0, 0.68), (0.06, 0, 0.68)], 0.012, material('chrome', '#d0d4d8', metal=1, rough=0.2), sides=6)
    lathe(m, [(0.092, 0.42), (0.092, 0.46)], material('tankband', '#1f6fd1', rough=0.4), seg=20)
    return m.build('air_tank', smooth=40, colors=white)


# ---------------------------------------------------------------- relics

def idol():
    m = Mesh()
    g = gold()
    box(m, (0.3, 0.22, 0.06), g, center=(0, 0, 0.03))
    box(m, (0.07, 0.08, 0.16), g, center=(-0.05, 0, 0.14))
    box(m, (0.07, 0.08, 0.16), g, center=(0.05, 0, 0.14))
    lathe(m, [(0.08, 0.22), (0.1, 0.3), (0.085, 0.38), (0.06, 0.4)], g, seg=8)
    box(m, (0.05, 0.05, 0.14), g, center=(-0.11, 0.0, 0.31))
    box(m, (0.05, 0.05, 0.14), g, center=(0.11, 0.0, 0.31))
    box(m, (0.14, 0.12, 0.13), g, center=(0, 0, 0.47))
    for k in range(7):
        a = (k / 6 - 0.5) * 2.2
        box(m, (0.035, 0.015, 0.13), g, center=(math.sin(a) * 0.09, 0.02, 0.56 + math.cos(a) * 0.05))
    for x in (-0.03, 0.03):
        icosphere(m, 0.016, material('emerald', '#18b56a', rough=0.05), subdiv=1, center=(x, -0.062, 0.49))
    return m.build('relic_idol', smooth=None, colors=white)


def crown():
    m = Mesh()
    g = gold()
    lathe(m, [(0.11, 0.0), (0.12, 0.0), (0.12, 0.06), (0.11, 0.06)], g, seg=32)
    for k in range(8):
        a = k / 8 * math.tau
        c, s = math.cos(a), math.sin(a)
        verts = [(c * 0.12 - s * 0.03, s * 0.12 + c * 0.03, 0.06), (c * 0.12 + s * 0.03, s * 0.12 - c * 0.03, 0.06),
                 (c * 0.12, s * 0.12, 0.15)]
        m.tris(verts + [(v[0] * 0.92, v[1] * 0.92, v[2]) for v in verts], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], g)
        icosphere(m, 0.013, material('pearl', '#f4f1ea', rough=0.12), subdiv=2, center=(c * 0.12, s * 0.12, 0.16))
        icosphere(m, 0.012, gem_mat() if k % 2 else material('sapphire', '#2340c8', rough=0.05), subdiv=1,
                  center=(c * 0.124, s * 0.124, 0.03))
    return m.build('relic_crown', smooth=30, colors=white)


def trident():
    m = Mesh()
    g = gold()
    sweep(m, [(0, 0, 0), (0, 0, 1.3)], [0.018, 0.016], g, sides=10)
    lathe(m, [(0.02, 1.3), (0.035, 1.32), (0.035, 1.36), (0.02, 1.38)], g, seg=12)
    sweep(m, [(-0.12, 0, 1.38), (0.12, 0, 1.38)], 0.014, g, sides=8)
    for x in (-0.12, 0.0, 0.12):
        top = 1.62 if x == 0 else 1.56
        sweep(m, [(x, 0, 1.38), (x * 1.05, 0, top)], [0.013, 0.008], g, sides=8)
        m.tris([(x - 0.03, 0, top - 0.02), (x + 0.03, 0, top - 0.02), (x, 0, top + 0.07),
                (x, -0.01, top - 0.02), (x, 0.01, top - 0.02)], [(0, 1, 2), (3, 2, 4)], g)
    for z in (0.3, 0.6, 0.9):
        lathe(m, [(0.018, z), (0.026, z + 0.01), (0.018, z + 0.02)], g, seg=10)
    return m.build('relic_trident', smooth=30, colors=white)


def compass():
    m = Mesh()
    brass = material('brass', '#c9a04a', metal=1.0, rough=0.35)
    lathe(m, [(0.001, 0.0), (0.12, 0.0), (0.13, 0.015), (0.13, 0.04), (0.115, 0.045), (0.11, 0.025), (0.001, 0.025)], brass, seg=32)
    lathe(m, [(0.001, 0.026), (0.108, 0.026)], material('dial', '#efe4c8', rough=0.6), seg=32)
    m.tris([(0, 0.09, 0.03), (0.012, 0, 0.03), (-0.012, 0, 0.03)], [(0, 1, 2)], material('needle', '#c02020', rough=0.4))
    m.tris([(0, -0.09, 0.03), (-0.012, 0, 0.03), (0.012, 0, 0.03)], [(0, 1, 2)], material('needle_white', '#e8e8e8', rough=0.4))
    lathe(m, [(0.001, 0.03), (0.105, 0.03), (0.07, 0.05), (0.001, 0.055)], material('glass', '#cfe8ff', rough=0.02, alpha=0.3), seg=24)
    lid = Mesh()
    lathe(lid, [(0.001, 0.0), (0.13, 0.0), (0.13, 0.015), (0.001, 0.02)], brass, seg=32)
    m.add(lid, Matrix.Translation((0, 0.13, 0.04)) @ Matrix.Rotation(-1.9, 4, 'X') @ Matrix.Translation((0, -0.13, 0)))
    return m.build('relic_compass', smooth=30, colors=white)


def sun_disc():
    m = Mesh()
    g = gold()
    prof = [(0.001, 0.0), (0.3, 0.0), (0.3, 0.03), (0.27, 0.035), (0.26, 0.028), (0.2, 0.03), (0.19, 0.04), (0.18, 0.034),
            (0.12, 0.036), (0.11, 0.045), (0.08, 0.06), (0.001, 0.07)]
    lathe(m, prof, g, seg=48)
    for k in range(16):
        a = k / 16 * math.tau
        c, s = math.cos(a), math.sin(a)
        L = 0.42 if k % 2 == 0 else 0.37
        w = 0.05
        m.tris([(c * 0.29 - s * w, s * 0.29 + c * w, 0.0), (c * 0.29 + s * w, s * 0.29 - c * w, 0.0), (c * L, s * L, 0.0),
                (c * 0.29 - s * w, s * 0.29 + c * w, 0.025), (c * 0.29 + s * w, s * 0.29 - c * w, 0.025), (c * L, s * L, 0.012)],
               [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)], g)
    for x in (-0.035, 0.035):
        icosphere(m, 0.014, material('emerald', '#18b56a', rough=0.05), subdiv=1, center=(x, 0.02, 0.07))
    m.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    return m.build('relic_sundisc', smooth=30, colors=white)


def build():
    return {
        'coin': coin(), 'chest': chest(), 'clam': clam(), 'amphora': amphora(), 'goblet': goblet(),
        'ingot': ingot(), 'gem': gem(), 'air_tank': air_tank(),
        'relic_idol': idol(), 'relic_crown': crown(), 'relic_trident': trident(), 'relic_compass': compass(),
        'relic_sundisc': sun_disc(),
    }
