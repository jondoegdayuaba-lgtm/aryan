"""Reef scenery: corals, sponges, anemone, seagrass, kelp, boulders and a rock arch."""
import math

import numpy as np
from mathutils import Vector, noise

from geo import (Mesh, cells, frames, hexc, icosphere, lathe, lerp_colors, material, smoothstep, strip, sweep,
                 vnoise)


def decimate(ob, ratio):
    import bpy
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = ratio
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def coral_mat():
    return material('coral', '#c8b48c', rough=0.85)


def brain_coral(name, seed):
    m = Mesh()
    icosphere(m, 1.0, material('brain', '#c9b27a', rough=0.8), subdiv=4)
    off = (seed * 3.1, seed * 1.7, seed * 0.3)

    def shape(co):
        d = co.normalized()
        r = 1 + 0.14 * noise.fractal(d * 1.4 + Vector(off), 0.6, 2.0, 3)
        p = d * r
        p.z *= 0.72
        if p.z < -0.08:
            p.z = -0.08 + (p.z + 0.08) * 0.12
        return p
    m.displace(shape)

    def colors(P, N):
        t = vnoise(P, 1.3, 2, off) * 0.5 + 0.5
        c = lerp_colors(t, [(0.2, '#9c8a5a'), (0.5, '#c2ab72'), (0.8, '#d6c48e')])
        return c * (0.55 + 0.45 * smoothstep(-0.1, 0.4, P[:, 2]))[:, None]
    return m.build(name, smooth=80, colors=colors)


def branching_coral(name, seed):
    """Staghorn-style Acropora: thick upright antlers with pale growing tips."""
    rng = np.random.default_rng(seed)
    m = Mesh()
    mat = coral_mat()
    from mathutils import Matrix

    def branch(start, direction, length, radius, depth):
        d = Vector(direction).normalized()
        pts = [Vector(start)]
        bend = Vector(rng.normal(0, 0.2, 3))
        for i in range(1, 4):
            d = (d + bend * 0.08 + Vector((0, 0, 0.18))).normalized()
            pts.append(pts[-1] + d * (length / 3))
        end_r = radius * (0.85 if depth else 0.7)
        sweep(m, [tuple(p) for p in pts], np.linspace(radius, end_r, len(pts)), mat, sides=5,
              cap_start=False, cap_end=depth == 0)
        if depth == 0:
            return
        for _ in range(rng.integers(2, 4)):
            axis = Vector(rng.normal(0, 1, 3)).cross(d).normalized()
            nd = Matrix.Rotation(rng.uniform(0.3, 0.6), 3, axis) @ d
            at = pts[int(rng.integers(1, 4))]
            branch(at - d * radius * 0.5, nd, length * rng.uniform(0.7, 0.85), end_r, depth - 1)

    trunks = int(rng.integers(5, 8))
    for k in range(trunks):
        a = k / trunks * math.tau + rng.uniform(-0.3, 0.3)
        tilt = rng.uniform(0.25, 0.75)
        branch((math.cos(a) * 0.08, math.sin(a) * 0.08, -0.05),
               (math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)),
               rng.uniform(0.3, 0.42), 0.055, 2)
    tip = ['#d9cbe8', '#c5dde2', '#efe6c8'][seed % 3]

    def colors(P, N):
        h = P[:, 2] / max(P[:, 2].max(), 1e-3)
        base = lerp_colors(vnoise(P, 4, 2) * 0.5 + 0.5, [(0.2, '#8a7350'), (0.8, '#b39a6d')])
        return base + (hexc(tip) - base) * smoothstep(0.6, 1.0, h)[:, None]
    ob = m.build(name, smooth=70, colors=colors)
    decimate(ob, 0.5)        # hundreds of these on the reef: keep them light
    return ob


def table_coral(name, seed):
    m = Mesh()
    rng = np.random.default_rng(seed)
    prof = [(0.07, -0.05), (0.09, 0.3), (0.16, 0.42), (0.5, 0.5), (0.85, 0.56), (1.0, 0.6),
            (1.0, 0.64), (0.85, 0.63), (0.5, 0.6), (0.15, 0.58), (0.0, 0.58)]
    ph = rng.uniform(0, 10)

    def radial(a, i):
        if prof[i][0] < 0.3:
            return 1.0
        return 1 + 0.12 * np.sin(a * 5 + ph) + 0.06 * np.sin(a * 13 + ph * 2)
    lathe(m, prof, coral_mat(), seg=40, radial=radial)

    def colors(P, N):
        r = np.hypot(P[:, 0], P[:, 1])
        top = lerp_colors(vnoise(P, 3, 2) * 0.5 + 0.5, [(0.2, '#8b8a5c'), (0.8, '#b2a670')])
        rim = hexc('#d9cfa6')
        c = top + (rim - top) * smoothstep(0.75, 1.0, r)[:, None]
        under = N[:, 2] < 0
        c[under] *= 0.45
        return c
    return m.build(name, smooth=60, colors=colors)


def sea_fan(name, seed):
    """A sheet carrying the alpha-tested fan texture, gently curved, on a short stalk."""
    m = Mesh()
    w, h = 1.4, 1.25
    nu, nv = 9, 9
    P = np.zeros((nv, nu, 3))
    UV = np.zeros((nv, nu, 2))
    for i in range(nv):
        for j in range(nu):
            u, v = j / (nu - 1), i / (nv - 1)
            x = (u - 0.5) * w
            P[i, j] = (x, 0.12 * math.sin(u * math.pi * 1.3 + seed) + 0.08 * x * x, v * h)
            UV[i, j] = (u, v)
    m.grid(P, material('fan', '#8e3f86', rough=0.8), uv=UV)
    sweep(m, [(0, 0.1, -0.1), (0, 0.11, 0.12)], [0.03, 0.025], material('fanstalk', '#5b3046', rough=0.8), sides=6)
    return m.build(name, smooth=80, colors=lambda P, N: np.ones((len(P), 3)))


def tube_sponge(name, seed):
    rng = np.random.default_rng(seed)
    m = Mesh()
    mat = material('sponge', '#a05fb0', rough=0.9)
    from mathutils import Matrix
    for k in range(rng.integers(3, 6)):
        hgt = rng.uniform(0.35, 1.0)
        r0 = rng.uniform(0.06, 0.1)
        r1 = r0 * rng.uniform(1.1, 1.35)
        wall = 0.025
        prof = [(r0, -0.05), (r0 * 1.05, hgt * 0.5), (r1, hgt), (r1 - wall, hgt + 0.01), (r1 - wall * 1.6, hgt * 0.7),
                (0.001, hgt * 0.3)]
        sub = Mesh()
        lathe(sub, prof, mat, seg=14, radial=lambda a, i: 1 + 0.05 * np.sin(a * 3 + k))
        a = k * 2.2 + rng.uniform(-0.3, 0.3)
        spread = 0.0 if k == 0 else rng.uniform(0.2, 0.28)
        mtx = (Matrix.Translation((math.cos(a) * spread, math.sin(a) * spread, 0))
               @ Matrix.Rotation(rng.uniform(0.05, 0.3), 4, Vector((math.sin(a), -math.cos(a), 0))))
        m.add(sub, mtx)

    def colors(P, N):
        t = vnoise(P, 6, 2) * 0.5 + 0.5
        c = lerp_colors(t, [(0.2, '#d7cdd9'), (0.8, '#f2ecf2')])
        inner = (N[:, 2] > 0.2) | (vnoise(P * 0, 1) > 2)
        c[inner] *= 0.35
        return c
    return m.build(name, smooth=50, colors=colors)


def barrel_sponge(name, seed):
    m = Mesh()
    prof = [(0.28, -0.08), (0.42, 0.25), (0.58, 0.65), (0.62, 0.95), (0.58, 1.12), (0.52, 1.14), (0.5, 0.95),
            (0.42, 0.6), (0.2, 0.35), (0.001, 0.3)]
    lathe(m, prof, material('barrelsponge', '#8a4b3a', rough=0.9), seg=56,
          radial=lambda a, i: 1 + (0.07 * np.abs(np.sin(a * 9 + seed)) if i < 6 else 0))

    def colors(P, N):
        t = vnoise(P, 5, 3, (seed, 0, 0)) * 0.5 + 0.5
        c = lerp_colors(t, [(0.2, '#7a3d2e'), (0.5, '#985440'), (0.8, '#b0714f')])
        r = np.hypot(P[:, 0], P[:, 1])
        inside = (P[:, 2] > 0.3) & (N[:, 0] * P[:, 0] + N[:, 1] * P[:, 1] < 0)
        c[inside] *= 0.3
        return c * (0.6 + 0.4 * smoothstep(0, 0.6, P[:, 2]))[:, None] + 0 * r[:, None]
    return m.build(name, smooth=50, colors=colors)


def anemone(name, seed):
    rng = np.random.default_rng(seed)
    m = Mesh()
    mat = material('anemone', '#d6c9a6', rough=0.6)
    lathe(m, [(0.16, -0.05), (0.2, 0.06), (0.24, 0.1), (0.001, 0.1)], mat, seg=20)
    for k in range(90):
        a = rng.uniform(0, math.tau)
        rr = math.sqrt(rng.uniform(0.02, 1)) * 0.22
        base = np.array([math.cos(a) * rr, math.sin(a) * rr, 0.1])
        out = np.array([math.cos(a), math.sin(a), 0]) * (0.3 + rr * 2.5)
        L = rng.uniform(0.14, 0.24)
        curl = rng.uniform(0.5, 1.4)
        pts = [base + (out * (t ** curl) * 0.7 + np.array([0, 0, 1.0]) * math.sin(t * 1.3)) * L for t in np.linspace(0, 1, 6)]
        sweep(m, pts, np.linspace(0.016, 0.009, 6), mat, sides=4, cap_start=False)

    def colors(P, N):
        h = smoothstep(0.1, 0.3, P[:, 2])
        base = lerp_colors(vnoise(P, 8, 2) * 0.5 + 0.5, [(0, '#a8a37a'), (1, '#c9c09a')])
        tip = hexc('#c57fb7')
        return base + (tip - base) * smoothstep(0.6, 1.0, h)[:, None]
    return m.build(name, smooth=60, colors=colors)


def seagrass(name, seed):
    rng = np.random.default_rng(seed)
    m = Mesh()
    mat = material('seagrass', '#4f7a32', rough=0.6)
    for k in range(10):
        a = rng.uniform(0, math.tau)
        base = np.array([math.cos(a), math.sin(a), 0]) * rng.uniform(0, 0.07)
        L = rng.uniform(0.35, 0.75)
        lean = np.array([math.cos(a), math.sin(a), 0]) * rng.uniform(0.1, 0.35)
        pts = [base + lean * t * t * L + np.array([0, 0, t * L]) for t in np.linspace(0, 1, 7)]
        side = np.array([-math.sin(a + 0.6), math.cos(a + 0.6), 0])
        strip(m, pts, np.linspace(0.014, 0.008, 7), mat, up=side)

    def colors(P, N):
        h = P[:, 2] / max(P[:, 2].max(), 1e-3)
        c = lerp_colors(h, [(0, '#2d4a1c'), (0.5, '#5d8a36'), (0.85, '#7d9446'), (1, '#8b7f4a')])
        return c
    return m.build(name, smooth=80, colors=colors)


def kelp(name, seed, height=14.0):
    rng = np.random.default_rng(seed)
    m = Mesh()
    mat = material('kelp', '#7a6a2a', rough=0.55)
    n = 32
    zs = np.linspace(0, height, n)
    path = np.stack([0.4 * np.sin(zs * 0.35 + seed), 0.3 * np.sin(zs * 0.22 + seed * 2), zs], axis=1)
    sweep(m, path, np.linspace(0.03, 0.018, n), mat, sides=5, cap_start=False)
    T, N, B = frames(path)
    count = int(height / 0.55)
    for k in range(count):
        t = (k + 1.5) / (count + 1.5)
        i = min(int(t * (n - 1)), n - 2)
        p = path[i] + (path[i + 1] - path[i]) * (t * (n - 1) - i)
        a = k * 2.4 + rng.uniform(-0.3, 0.3)
        out = np.array([math.cos(a), math.sin(a), 0.0])
        L = rng.uniform(0.7, 1.1) * (1.2 if t > 0.85 else 1.0)
        pts = [p + out * s * L * 0.55 + np.array([0, 0, s * L]) + np.array([0, 0, 0.06]) * math.sin(s * 9) for s in np.linspace(0, 1, 6)]
        widths = 0.16 * np.sin(np.linspace(0.15, math.pi * 0.95, 6))
        strip(m, pts, widths, mat, up=np.array([-out[1], out[0], 0.0]), fold=0.25)
        icosphere(m, 0.035, mat, subdiv=1, center=tuple(p + out * 0.04))

    def colors(P, N):
        t = vnoise(P, 1.5, 2, (seed, 0, 0)) * 0.5 + 0.5
        c = lerp_colors(t, [(0.2, '#5c4d1d'), (0.6, '#7d6a2b'), (0.9, '#9a8838')])
        return c * (0.75 + 0.25 * smoothstep(0, height, P[:, 2]))[:, None]
    return m.build(name, smooth=80, colors=colors)


def boulder(name, seed, subdiv=4):
    m = Mesh()
    icosphere(m, 1.0, material('rock', '#8a8274', rough=0.85), subdiv=subdiv)
    off = Vector((seed * 5.3, seed * 2.1, seed * 7.7))
    stretch = Vector((1.0 + 0.3 * math.sin(seed), 1.0 + 0.25 * math.cos(seed * 1.3), 0.7))

    def shape(co):
        d = co.normalized()
        r = 1 + 0.32 * noise.fractal(d * 0.9 + off, 0.55, 2.0, 4)
        f1 = noise.voronoi(d * 1.6 + off, distance_metric="DISTANCE", exponent=2.5)[0][0]
        r -= 0.18 * f1
        p = Vector((d.x * stretch.x, d.y * stretch.y, d.z * stretch.z)) * r
        if p.z < -0.35:
            p.z = -0.35 + (p.z + 0.35) * 0.2
        return p
    m.displace(shape)

    def colors(P, N):
        t = vnoise(P, 1.2, 3, tuple(off)) * 0.5 + 0.5
        c = lerp_colors(t, [(0.2, '#c4bba8'), (0.8, '#ece5d6')])
        return c * (0.45 + 0.55 * smoothstep(-0.4, 0.3, P[:, 2]))[:, None]
    return m.build(name, smooth=55, colors=colors)


def rock_arch(name):
    """A natural limestone arch about 20 m across, chunky and eroded."""
    m = Mesh()
    rock = material('rock', '#8a8274', rough=0.85)
    n = 48
    a = np.linspace(-0.15, math.pi + 0.15, n)
    path = np.stack([-np.cos(a) * 10.0, 0.9 * np.sin(a * 2.3), np.sin(a) * 9.0 - 1.0], axis=1)
    radius = 2.2 + 2.0 * (np.abs(np.cos(a)) ** 4)
    sweep(m, path, radius, rock, sides=18, squash=1.5)
    for x, y, z, r in ((-11, 0.5, -1.0, 3.6), (11.5, -0.6, -1.2, 3.8), (-8.5, 2.4, -1.6, 2.4), (9, -2.6, -1.8, 2.6),
                       (-1, 0.0, 8.6, 2.3), (3, 0.5, 8.0, 2.0)):
        icosphere(m, r, rock, subdiv=3, center=(x, y, z))
    off = Vector((3.3, 1.1, 8.2))

    def bump(co):
        return (noise.fractal(co * 0.22 + off, 0.55, 2.0, 4) * 1.4
                + noise.fractal(co * 0.7 + off, 0.5, 2.0, 3) * 0.45
                - abs(noise.noise(co * 0.35 + off)) * 0.8)
    m.push(bump)

    def colors(P, N):
        t = vnoise(P, 0.25, 3) * 0.5 + 0.5
        c = lerp_colors(t, [(0.2, '#bdb3a0'), (0.8, '#e6dfcf')])
        return c * (0.5 + 0.5 * smoothstep(-2, 4, P[:, 2]))[:, None] * (0.7 + 0.3 * np.clip(N[:, 2], 0, 1))[:, None]
    return m.build(name, smooth=55, colors=colors)


def build():
    out = {}
    for i in range(2):
        out[f'brain_{i}'] = brain_coral(f'brain_{i}', i + 1)
        out[f'branch_{i}'] = branching_coral(f'branch_{i}', i + 3)
        out[f'table_{i}'] = table_coral(f'table_{i}', i + 5)
        out[f'fan_{i}'] = sea_fan(f'fan_{i}', i + 2)
        out[f'tube_{i}'] = tube_sponge(f'tube_{i}', i + 9)
        out[f'grass_{i}'] = seagrass(f'grass_{i}', i + 11)
        out[f'kelp_{i}'] = kelp(f'kelp_{i}', i + 13)
    out['branch_2'] = branching_coral('branch_2', 17)
    out['barrel_0'] = barrel_sponge('barrel_0', 1)
    out['anemone_0'] = anemone('anemone_0', 4)
    for i in range(4):
        out[f'boulder_{i}'] = boulder(f'boulder_{i}', i + 1)
    out['arch'] = rock_arch('arch')
    return out
