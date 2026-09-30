"""numpy geometry primitives (game coordinates: y up) shared by the Blender model scripts."""
import math

import numpy as np


def normalize(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


def frame_from_axis(axis):
    axis = normalize(axis)
    ref = np.array([0.0, 1.0, 0.0]) if abs(axis[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = normalize(np.cross(axis, ref))
    w = np.cross(axis, u)
    return u, axis, w


def rot_y(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])


def rot_x(deg):
    a = math.radians(deg)
    return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])


def rot_z(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])


class Mesh:
    """Flat-shaded triangle soup: per-face vertices, planar-projected UVs (metres * uv_scale)."""

    def __init__(self):
        self.v, self.t = [], []

    def add(self, verts, tris):
        base = sum(len(x) for x in self.v)
        self.v.append(np.asarray(verts, dtype=np.float64))
        self.t.append(np.asarray(tris, dtype=np.int64) + base)
        return self

    def merge(self, other, offset=(0, 0, 0), rot=None):
        v = other.arrays()[0]
        if rot is not None:
            v = v @ np.asarray(rot).T
        return self.add(v + np.asarray(offset), other.arrays()[1])

    def arrays(self):
        if not self.v:
            return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
        return np.concatenate(self.v), np.concatenate(self.t)

    def flat(self, uv_scale=1.0, uv_offset=(0.0, 0.0)):
        """expand to per-face vertices and compute planar UVs: returns verts (M*3,3), tris (M,3), uv (M,3,2)"""
        V, T = self.arrays()
        P = V[T]                                             # (M,3,3)
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        n = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
        ax = np.argmax(np.abs(n), axis=1)
        uv = np.zeros((len(T), 3, 2))
        for a in range(3):
            m = ax == a
            if not m.any():
                continue
            i, j = [(1, 2), (0, 2), (0, 1)][a]
            uu = P[m][:, :, i]
            vv = P[m][:, :, j]
            uv[m, :, 0] = uu * uv_scale + uv_offset[0]
            uv[m, :, 1] = vv * uv_scale + uv_offset[1]
        verts = P.reshape(-1, 3)
        tris = np.arange(len(verts)).reshape(-1, 3)
        return verts, tris, uv


def box(center, size, rot=None):
    """axis-aligned (optionally rotated about the centre) box, outward faces"""
    cx, cy, cz = center
    sx, sy, sz = [s / 2 for s in size]
    v = np.array([[-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz],
                  [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]])
    if rot is not None:
        v = v @ np.asarray(rot).T
    v = v + np.array([cx, cy, cz])
    t = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]]
    return orient_outward(v, np.array(t))


def tube(p0, p1, r0, r1, sides=10, rings=1, caps=(True, True), squash=(1.0, 1.0)):
    u, ax, w = frame_from_axis(np.asarray(p1, float) - np.asarray(p0, float))
    verts, tris = [], []
    for k in range(rings + 1):
        t = k / rings
        c = np.asarray(p0, float) + (np.asarray(p1, float) - np.asarray(p0, float)) * t
        r = r0 + (r1 - r0) * t
        for s in range(sides):
            a = 2 * math.pi * s / sides
            verts.append(c + u * math.cos(a) * r * squash[0] + w * math.sin(a) * r * squash[1])
    for k in range(rings):
        for s in range(sides):
            a = k * sides + s
            b = k * sides + (s + 1) % sides
            tris += [[a, b, a + sides], [b, b + sides, a + sides]]
    if caps[0]:
        c = len(verts)
        verts.append(np.asarray(p0, float))
        for s in range(sides):
            tris.append([c, (s + 1) % sides, s])
    if caps[1]:
        c = len(verts)
        verts.append(np.asarray(p1, float))
        base = rings * sides
        for s in range(sides):
            tris.append([c, base + s, base + (s + 1) % sides])
    return np.array(verts), np.array(tris)


def orient_outward(v, t):
    """flip triangles of a convex closed solid so every normal points away from its centre"""
    v = np.asarray(v, float)
    t = np.asarray(t).copy()
    c = v.mean(axis=0)
    P = v[t]
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    ctr = P.mean(axis=1) - c
    flip = (n * ctr).sum(axis=1) < 0
    t[flip] = t[flip][:, [0, 2, 1]]
    return v, t


def prism_roof(cx, y_eave, cz, length, half_width, rise, overhang=0.5, thickness=0.3, axis='x'):
    """gable roof slab (convex solid). The ridge runs along x (axis='x') or z (axis='z'); `length` is along the ridge, `half_width` across it."""
    L = length / 2 + overhang
    W = half_width + overhang * 0.6
    prof = np.array([[-W, y_eave], [0.0, y_eave + rise], [W, y_eave]])
    top = [[x, y, z] for (x, y) in prof for z in (-L, L)]
    bot = [[x, y - thickness, z] for (x, y) in prof for z in (-L, L)]
    v = np.array(top + bot, float)
    # a convex hull of the 12 points: triangulate via the known faces, then fix the winding
    def i(layer, p, e):
        return layer * 6 + p * 2 + e
    t = []
    for layer in (0, 1):
        for p in (0, 1):
            a_, b_, c_, d_ = i(layer, p, 0), i(layer, p, 1), i(layer, p + 1, 0), i(layer, p + 1, 1)
            t += [[a_, b_, c_], [b_, d_, c_]]
    for e in (0, 1):
        for p in (0, 1):
            t += [[i(0, p, e), i(0, p + 1, e), i(1, p, e)], [i(0, p + 1, e), i(1, p + 1, e), i(1, p, e)]]
    for p in (0, 2):
        t += [[i(0, p, 0), i(1, p, 0), i(0, p, 1)], [i(0, p, 1), i(1, p, 0), i(1, p, 1)]]
    v, t = orient_outward(v, np.array(t))
    if axis == 'x':                       # built with the ridge along z; swap to put it along x
        v = np.stack([v[:, 2], v[:, 1], v[:, 0]], 1)
        t = t[:, [0, 2, 1]]
    return v + np.array([cx, 0.0, cz]), t


def merge(parts):
    vs, ts, off = [], [], 0
    for v, t in parts:
        vs.append(np.asarray(v, float))
        ts.append(np.asarray(t) + off)
        off += len(v)
    return np.concatenate(vs), np.concatenate(ts)


def ellipsoid(center, radii, nu=16, nv=10):
    verts, tris = [], []
    for j in range(nv + 1):
        phi = math.pi * j / nv
        for i in range(nu):
            th = 2 * math.pi * i / nu
            verts.append([math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th)])
    v = np.array(verts) * np.asarray(radii) + np.asarray(center)
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            tris += [[a, b, a + nu], [b, b + nu, a + nu]]
    return v, np.array(tris)


def quad(p0, p1, p2, p3):
    """one quad, corners in order (outward = right hand rule)"""
    return np.array([p0, p1, p2, p3], float), np.array([[0, 1, 2], [0, 2, 3]])


def wave_strip(p0, p1, height, segs=8, amp=0.0, phase=0.0):
    """vertical cloth strip from p0 to p1 (a banner); optional sine ripple in depth"""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    length = np.linalg.norm(d)
    d /= length
    n = np.array([-d[2], 0, d[0]])                           # horizontal normal
    verts, tris = [], []
    for i in range(segs + 1):
        t = i / segs
        off = n * amp * math.sin(t * 6.28 * 1.5 + phase)
        base = p0 + d * length * t + off
        verts.append(base)
        verts.append(base + np.array([0, height, 0]))
    for i in range(segs):
        a = 2 * i
        tris += [[a, a + 2, a + 1], [a + 1, a + 2, a + 3]]
    return np.array(verts), np.array(tris)
