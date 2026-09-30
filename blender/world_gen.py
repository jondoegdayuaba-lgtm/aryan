#!/usr/bin/env python3
"""
World generator for Alpine Descent (pure numpy / scipy, no Blender needed).

Builds the mountain heightfield around a designed ski run, the snow / rock / litter
masks, the tree / rock / pole scatter and the course data (runs, gates, jumps).
Everything is written to build/world.npz for the Blender scripts (which model, light
and bake on top of it) and to ski/assets/world/ for the game.

Coordinates: metres, Y up (same as the game).  The run heads toward -Z, so +X is the
skier's right hand side.  Height arrays are indexed [iz, ix]:
    x = X0 + ix * DX,  z = Z0 + iz * DX
"""
import json
import math
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import CubicSpline, PchipInterpolator
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build")
OUT_WORLD = os.path.join(ROOT, "ski", "assets", "world")

# ----------------------------------------------------------------------------- grid
DX = 1.5
X0, X1 = -576.0, 576.0          # 768 cells = 12 render chunks of 64 cells
Z0, Z1 = -3300.0, 444.0         # 2496 cells = 39 chunks
NXV = int(round((X1 - X0) / DX)) + 1
NZV = int(round((Z1 - Z0) / DX)) + 1
H_MIN = 1200.0          # height quantisation origin (metres)
H_QUANT = 16.0          # 1/16 m steps -> uint16

# sun (toward the sun): behind-left of the direction of travel, low in the sky
SUN_AZIMUTH_DEG = 158.0   # angle from the travel direction (-Z), turning toward -X (sun behind-left)
SUN_ELEVATION_DEG = 38.0

SEED = 20260929


from noise import smoothstep, spectral_noise, ridged  # noqa: E402


def sun_direction():
    az = math.radians(SUN_AZIMUTH_DEG)
    el = math.radians(SUN_ELEVATION_DEG)
    hx, hz = -math.sin(az), -math.cos(az)
    return np.array([hx * math.cos(el), math.sin(el), hz * math.cos(el)])


# ------------------------------------------------------------------------ the piste
# (x, z) control points of the piste centre line, start at the top (z = 0)
CTRL = [
    (0, 90), (0, 40), (20, -200), (-28, -470), (-112, -760), (-148, -1050),
    (-76, -1340), (44, -1610), (132, -1890), (120, -2190), (36, -2470),
    (-12, -2720), (-12, -2960), (-12, -3040),
]
# pitch (degrees) along the piste, by path distance s (metres)
PITCH = [
    (-60, 3), (0, 3.5), (110, 6), (250, 15), (500, 17), (650, 23), (800, 20), (950, 11),
    (1150, 24), (1250, 26), (1400, 14), (1550, 8.5), (1750, 16), (2000, 18),
    (2200, 13), (2450, 10), (2650, 5), (2800, 2.5), (2960, 1.5), (3100, 1.5),
]
# piste width (metres) by s
WIDTH = [
    (-60, 46), (0, 50), (300, 44), (700, 36), (1000, 46), (1250, 32), (1500, 54),
    (1900, 42), (2300, 46), (2600, 62), (2800, 92), (2950, 124), (3100, 124),
]
START_ELEVATION = 2110.0
FINISH_S = 2800.0      # downhill finish line
TOTAL_S_HINT = 3000.0

# jumps: (s, height m, ramp length m, half width as a fraction of the piste width, lane centre as a
# signed fraction of the width: + = right).  They sit in the side lanes: an optional stunt line
# beside the racing line, so slalom gates and the downhill line stay clear of them.
JUMPS = [
    (1610, 1.7, 12.0, 0.13, 0.30),
    (1795, 2.6, 14.0, 0.13, -0.30),
    (2350, 3.4, 15.0, 0.14, 0.30),
    (2585, 2.2, 13.0, 0.16, -0.28),
]
# rolling bump fields: (s0, s1, amplitude m)
BUMPS = [
    (880, 1010, 0.32), (1450, 1560, 0.28), (1990, 2140, 0.34), (2440, 2560, 0.26),
]


def build_path(rng):
    ctrl = np.array(CTRL, dtype=np.float64)
    chord = np.r_[0.0, np.cumsum(np.hypot(*np.diff(ctrl, axis=0).T))]
    spl = CubicSpline(chord, ctrl, bc_type="natural")
    u = np.linspace(0, chord[-1], 20000)
    xy = spl(u)
    seg = np.r_[0.0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    # arclength measured from the first control point at z=40 -> re-zero at z = 0 crossing
    s_all = np.arange(0.0, seg[-1], 1.0)
    px = np.interp(s_all, seg, xy[:, 0])
    pz = np.interp(s_all, seg, xy[:, 1])
    # re-zero so that s = 0 at the start line (z == 0)
    i0 = int(np.argmin(np.abs(pz)))
    s = s_all - s_all[i0]
    keep = s >= -60.0
    px, pz, s = px[keep], pz[keep], s[keep]
    # tangent & curvature
    dx = np.gradient(px, s)
    dz = np.gradient(pz, s)
    n = np.hypot(dx, dz)
    tx, tz = dx / n, dz / n
    dtx, dtz = np.gradient(tx, s), np.gradient(tz, s)
    rx, rz = -tz, tx                      # right-hand normal
    K = dtx * rx + dtz * rz               # >0: path bends toward the right
    K = ndi.gaussian_filter1d(K, 12.0)
    pitch = PchipInterpolator(*zip(*PITCH))(np.clip(s, PITCH[0][0], PITCH[-1][0]))
    slope = np.tan(np.radians(pitch))
    y = START_ELEVATION - np.r_[0.0, np.cumsum(0.5 * (slope[1:] + slope[:-1]) * np.diff(s))]
    y = y - np.interp(0.0, s, y) + START_ELEVATION
    width = PchipInterpolator(*zip(*WIDTH))(np.clip(s, WIDTH[0][0], WIDTH[-1][0]))
    bank = np.clip(K * 26.0, -0.11, 0.11)   # cross slope (outside is higher)
    return dict(s=s, x=px, z=pz, y=y, tx=tx, tz=tz, rx=rx, rz=rz, K=K, width=width,
                bank=bank, pitch=pitch)


def nearest_path_fields(path, X, Z):
    """distance, signed lateral t, projected s and path elevation for every grid node"""
    pts = np.c_[path["x"], path["z"]]
    tree = cKDTree(pts)
    q = np.c_[X.ravel(), Z.ravel()]
    d, idx = tree.query(q, workers=-1)
    dxp = q[:, 0] - path["x"][idx]
    dzp = q[:, 1] - path["z"][idx]
    t = dxp * path["rx"][idx] + dzp * path["rz"][idx]
    along = dxp * path["tx"][idx] + dzp * path["tz"][idx]
    s = path["s"][idx] + along
    shp = X.shape
    return d.reshape(shp), t.reshape(shp), s.reshape(shp), idx.reshape(shp)


def thermal_erosion(h, iterations, talus, rate=0.5):
    """Slump slopes steeper than talus (rise per metre) toward lower neighbours (8-neighbourhood)."""
    offs = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
            (-1, -1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (1, 1, 1.4142)]
    for _ in range(iterations):
        p = np.pad(h, 1, mode="edge")
        c = p[1:-1, 1:-1]
        gives = []
        out = np.zeros_like(h)
        for dz, dx, dist in offs:
            n = p[1 + dz:p.shape[0] - 1 + dz, 1 + dx:p.shape[1] - 1 + dx]
            ex = np.maximum(c - n - talus * DX * dist, 0.0)
            g = rate * 0.125 * ex
            gives.append((dz, dx, g))
            out += g
        recv = np.zeros_like(h)
        for dz, dx, g in gives:
            gp = np.pad(g, 1, mode="constant")
            # the neighbour at (dz, dx) received g from us; we receive what our neighbour gave toward us
            recv += gp[1 - dz:gp.shape[0] - 1 - dz, 1 - dx:gp.shape[1] - 1 - dx]
        h = h - out + recv
    return h


def grad(h):
    gz, gx = np.gradient(h, DX)
    return gx, gz


def bilinear(arr, x, z):
    scalar = np.ndim(x) == 0 and np.ndim(z) == 0
    fx = (np.atleast_1d(np.asarray(x, dtype=np.float64)) - X0) / DX
    fz = (np.atleast_1d(np.asarray(z, dtype=np.float64)) - Z0) / DX
    out = ndi.map_coordinates(arr, [fz, fx], order=1, mode="nearest")
    return float(out[0]) if scalar else out


def flatten_disc(h, cx, cz, radius, blend, target=None, ellipse=None):
    """Level a disc of ground (buildings, start area). Returns the level used."""
    xs = X0 + np.arange(NXV) * DX
    zs = Z0 + np.arange(NZV) * DX
    ix0, ix1 = int((cx - radius - blend - X0) / DX), int((cx + radius + blend - X0) / DX) + 2
    iz0, iz1 = int((cz - radius - blend - Z0) / DX), int((cz + radius + blend - Z0) / DX) + 2
    ix0, iz0 = max(ix0, 0), max(iz0, 0)
    ix1, iz1 = min(ix1, NXV), min(iz1, NZV)
    XX, ZZ = np.meshgrid(xs[ix0:ix1], zs[iz0:iz1])
    if ellipse is None:
        d = np.hypot(XX - cx, ZZ - cz)
    else:
        c, s_, ax, az = ellipse
        u = (XX - cx) * c + (ZZ - cz) * s_
        v = -(XX - cx) * s_ + (ZZ - cz) * c
        d = np.hypot(u / ax, v / az) * radius
    sub = h[iz0:iz1, ix0:ix1]
    w = 1.0 - smoothstep(radius, radius + blend, d)
    if target is None:
        target = float(bilinear(h, cx, cz))
    sub += (target - sub) * w
    return target


# ------------------------------------------------------------------------ main build
def build_world():
    rng = np.random.default_rng(SEED)
    os.makedirs(BUILD, exist_ok=True)
    path = build_path(rng)
    L = float(path["s"][-1])
    print(f"path length {L:.0f} m, drop {path['y'][0] - path['y'][-1]:.0f} m")

    xs = X0 + np.arange(NXV) * DX
    zs = Z0 + np.arange(NZV) * DX
    X, Z = np.meshgrid(xs, zs)
    shape = X.shape

    d, t, sproj, idx = nearest_path_fields(path, X, Z)
    y_near = np.interp(sproj, path["s"], path["y"])
    half_w = np.interp(sproj, path["s"], path["width"]) * 0.5
    bank = np.interp(sproj, path["s"], path["bank"])

    # ---- base mountain --------------------------------------------------------
    Y = ndi.gaussian_filter(y_near, 20.0 / 1.0)          # smooth away medial-axis steps
    dS = ndi.gaussian_filter(d, 3.0)
    n_a = spectral_noise(shape, DX, 300.0, 1500.0, 2.6, rng)   # massing
    n_b = spectral_noise(shape, DX, 90.0, 400.0, 2.4, rng)
    n_c = spectral_noise(shape, DX, 25.0, 120.0, 2.2, rng)
    n_r = spectral_noise(shape, DX, 150.0, 900.0, 2.0, rng)
    n_v = spectral_noise(shape, DX, 400.0, 2500.0, 2.0, rng)
    far = smoothstep(40.0, 420.0, dS)
    amp = 5.0 + 70.0 * far ** 1.2
    A_v = 150.0 * (0.85 + 0.15 * np.tanh(n_v))
    bowl = A_v * (1.0 - np.exp(-(dS / 380.0) ** 1.4))
    wall_far = 190.0 * smoothstep(300.0, 640.0, dS) ** 1.25 * (0.85 + 0.25 * np.tanh(n_a))
    M = Y + bowl + wall_far
    M += amp * (0.45 * n_a + 0.28 * n_b + 0.10 * n_c) * 0.6
    M += 75.0 * smoothstep(0.55, 1.0, far) * ridged(n_r) * (0.5 + 0.5 * np.tanh(n_a))
    # enclosing walls, the summit headwall above the start and the rise behind the lodge
    M += 170.0 * smoothstep(400.0, 560.0, np.abs(X)) ** 1.3
    M += 190.0 * smoothstep(20.0, 440.0, Z) ** 1.15      # headwall behind the start: kept below the sun's elevation
    M += 110.0 * smoothstep(-3080.0, -3300.0, Z) ** 1.3
    M = thermal_erosion(M.astype(np.float64), int(os.environ.get('WG_EROSION', '24')), 0.85, 0.5)
    M = ndi.gaussian_filter(M, 0.9)

    # ---- the piste --------------------------------------------------------------
    ts = t
    P = y_near - bank * ts
    # gentle undulation everywhere on the piste
    n_p = spectral_noise(shape, DX, 8.0, 40.0, 2.2, rng)
    P += 0.05 * n_p
    # rolling bumps
    n_m = spectral_noise(shape, DX, 7.0, 16.0, 1.5, rng)
    bump_amp = np.zeros(shape)
    for s0, s1, a in BUMPS:
        bump_amp += a * smoothstep(s0, s0 + 25.0, sproj) * (1.0 - smoothstep(s1 - 25.0, s1, sproj))
    lateral_win = 1.0 - smoothstep(0.55, 0.95, np.abs(ts) / np.maximum(half_w, 1.0))
    P += bump_amp * lateral_win * (n_m * 0.5)
    # jumps
    for s_j, hgt, ramp, lat, lane in JUMPS:
        sp = sproj - s_j
        up = smoothstep(-ramp, 0.0, sp) * (sp <= 0.0)
        lip = (1.0 - smoothstep(0.0, 3.0, sp)) * (sp > 0.0) * 0.55
        prof = hgt * (up ** 1.15 + lip)
        # a flat-ish landing zone below the lip: carve the slope so flight lands smoothly
        land = -0.5 * hgt * smoothstep(4.0, 10.0, sp) * (1.0 - smoothstep(10.0, 34.0, sp))
        win = np.exp(-(np.abs(ts - lane * 2.0 * half_w) / (lat * 2.0 * half_w)) ** 4)
        P += (prof + land) * win
    blend_w = 26.0 + 44.0 * smoothstep(2700.0, 3000.0, sproj)      # the finish plaza fades out gently
    w_piste = 1.0 - smoothstep(half_w, half_w + blend_w, d)
    H = M * (1.0 - w_piste) + P * w_piste
    H = ndi.gaussian_filter(H, 0.6)
    H = H.astype(np.float64)

    # ---- buildings platforms -----------------------------------------------------
    def path_point(s_, t_):
        i = int(np.argmin(np.abs(path["s"] - s_)))
        return (path["x"][i] + path["rx"][i] * t_, path["z"][i] + path["rz"][i] * t_, i)

    props = {}
    hx, hz, hi = path_point(24.0, 44.0)
    heading = math.atan2(-path["tx"][hi], -path["tz"][hi])  # placeholder, set below
    def yaw_of(i):
        return math.atan2(-path["tz"][i], path["tx"][i])      # three.js rotation about +Y aligning local +X with the piste

    props["startHut"] = dict(s=24.0, t=44.0, x=hx, z=hz, size=[10.0, 4.5, 6.0], yaw=yaw_of(hi) + math.pi)
    fx, fz, fi = path_point(3000.0, -70.0)
    props["lodge"] = dict(s=3000.0, t=-70.0, x=fx, z=fz, size=[36.0, 12.0, 16.0], yaw=yaw_of(fi))
    lx, lz, li = path_point(2935.0, 88.0)
    props["liftStation"] = dict(s=2935.0, t=88.0, x=lx, z=lz, size=[10.0, 8.0, 12.0], yaw=yaw_of(li) + math.pi)
    for name, radius, blend in (("startHut", 16.0, 22.0), ("lodge", 30.0, 70.0), ("liftStation", 18.0, 45.0)):
        p = props[name]
        p["y"] = float(flatten_disc(H, p["x"], p["z"], radius, blend))
    # flatten the start area on the piste too
    H = np.asarray(H)

    # ---- derived maps ------------------------------------------------------------
    gx, gz = grad(H)
    slope = np.hypot(gx, gz)
    n_rock = spectral_noise(shape, DX, 8.0, 60.0, 1.6, rng)
    alt = smoothstep(1900.0, 2450.0, H)
    rock = smoothstep(0.72 - 0.30 * alt, 1.10 - 0.30 * alt, slope + 0.12 * n_rock) * (1.0 - w_piste)
    ridge_rock = smoothstep(0.70, 0.95, ridged(n_r) + 0.05 * n_c) * smoothstep(2150.0, 2450.0, H)
    rock = np.clip(np.maximum(rock, ridge_rock * 0.6 * (1.0 - w_piste)), 0.0, 1.0)
    for lo, hi in ((60, 150), (150, 300), (300, 480)):
        band = (d > lo) & (d < hi) & (Z < 0) & (Z > -3000)
        ang = np.degrees(np.arctan(slope[band]))
        print(f"slope deg d {lo}-{hi}: p10 {np.percentile(ang, 10):.0f} p50 {np.percentile(ang, 50):.0f} "
              f"p90 {np.percentile(ang, 90):.0f}; rock {rock[band].mean() * 100:.0f}%")

    # chairlift: bottom station beside the finish plaza, climbing the right side of the piste
    lift = []
    s_ = 2935.0
    while s_ > 1350.0:
        t_ = 92.0 + 10.0 * math.sin(s_ / 260.0)
        px_, pz_, _i = path_point(s_, t_)
        lift.append([float(px_), float(pz_)])
        s_ -= 92.0
    props["lift"] = dict(points=lift)

    world = dict(
        H=H.astype(np.float32), slope=slope.astype(np.float32), rock=rock.astype(np.float32),
        d=d.astype(np.float32), sproj=sproj.astype(np.float32), t=t.astype(np.float32),
        half_w=half_w.astype(np.float32), w_piste=w_piste.astype(np.float32),
        n_c=n_c, n_v=n_v,
    )
    return path, world, props


def sample_h(H, x, z):
    return bilinear(H.astype(np.float64), x, z)


def scatter(path, world, props, rng):
    H, slope, rock = world["H"], world["slope"], world["rock"]
    d, half_w = world["d"], world["half_w"]
    n_forest = spectral_noise(H.shape, DX, 50.0, 220.0, 2.0, rng)
    n_line = spectral_noise(H.shape, DX, 60.0, 500.0, 2.0, rng)

    # ---- trees
    step = 4.6
    gx = np.arange(X0 + 6.0, X1 - 6.0, step)
    gz = np.arange(Z0 + 6.0, Z1 - 6.0, step)
    GX, GZ = np.meshgrid(gx, gz)
    x = GX + rng.uniform(-2.0, 2.0, GX.shape)
    z = GZ + rng.uniform(-2.0, 2.0, GX.shape)
    x, z = x.ravel(), z.ravel()
    y = sample_h(H, x, z)
    sl = bilinear(slope, x, z)
    dd = bilinear(d, x, z)
    hw = bilinear(half_w, x, z)
    nf = bilinear(n_forest, x, z)
    nl = bilinear(n_line, x, z)
    rk = bilinear(rock, x, z)
    treeline = 1985.0 + 45.0 * np.tanh(nl)
    f_alt = 1.0 - smoothstep(treeline - 130.0, treeline + 55.0, y)
    f_slope = 1.0 - smoothstep(0.52, 0.86, sl)
    f_dist = smoothstep(hw + 4.0, hw + 30.0, dd)
    f_clump = smoothstep(-0.35, 0.75, nf)
    f_rock = 1.0 - smoothstep(0.15, 0.5, rk)
    prob = np.clip(0.97 * f_alt * f_slope * f_dist * (0.10 + 0.90 * f_clump) * f_rock, 0.0, 1.0)
    # keep-out around buildings
    for name, r in (("startHut", 30.0), ("lodge", 52.0), ("liftStation", 30.0)):
        p = props[name]
        prob *= smoothstep(r * 0.7, r * 1.15, np.hypot(x - p["x"], z - p["z"]))
    lp = np.array(props["lift"]["points"], dtype=np.float64)
    if len(lp) > 1:
        dmin = np.full(x.shape, 1e9)
        for a_, b_ in zip(lp[:-1], lp[1:]):
            ab = b_ - a_
            u = np.clip(((x - a_[0]) * ab[0] + (z - a_[1]) * ab[1]) / (ab @ ab), 0, 1)
            dmin = np.minimum(dmin, np.hypot(x - (a_[0] + u * ab[0]), z - (a_[1] + u * ab[1])))
        prob *= smoothstep(6.0, 12.0, dmin)
    keep = rng.random(x.shape) < prob
    tx, tz, ty = x[keep], z[keep], y[keep]
    tnf, tnl = nf[keep], nl[keep]
    n = tx.size
    # species: 0 spruce 1 snowy fir 2 pine 3 small/twisted
    u = rng.random(n)
    high = smoothstep(1780.0, 1980.0, ty)
    species = np.where(u < 0.5 - 0.25 * high, 0, np.where(u < 0.86 - 0.20 * high, 1, 2))
    species = np.where(rng.random(n) < 0.10 + 0.75 * high, 3, species)
    scale = rng.uniform(0.78, 1.30, n) * np.where(species == 3, 0.9, 1.0) \
        * (1.0 - 0.25 * high) * (0.9 + 0.12 * np.tanh(tnf))
    yaw = rng.uniform(0.0, 2.0 * np.pi, n)
    trees = np.c_[tx, tz, ty, scale, yaw, species].astype(np.float32)
    print(f"trees: {n}")

    # ---- rocks
    rocks = []
    step_r = 10.0
    rx_ = np.arange(X0 + 6.0, X1 - 6.0, step_r)
    rz_ = np.arange(Z0 + 6.0, Z1 - 6.0, step_r)
    RX, RZ = np.meshgrid(rx_, rz_)
    x = (RX + rng.uniform(-3.5, 3.5, RX.shape)).ravel()
    z = (RZ + rng.uniform(-3.5, 3.5, RX.shape)).ravel()
    sl = bilinear(slope, x, z)
    rk = bilinear(rock, x, z)
    dd = bilinear(d, x, z)
    hw = bilinear(half_w, x, z)
    y = sample_h(H, x, z)
    p = smoothstep(0.35, 0.85, rk) * 0.30 + smoothstep(0.55, 0.9, sl) * 0.10
    p *= smoothstep(hw + 6.0, hw + 20.0, dd) * 0.85
    keep = rng.random(x.shape) < p
    for xi, zi, yi, ki in zip(x[keep], z[keep], y[keep], sl[keep]):
        rocks.append((xi, zi, yi, rng.uniform(0.6, 3.2) * (1.0 + 1.2 * float(ki)),
                      rng.uniform(0, 2 * np.pi), rng.integers(0, 4)))
    # boulders along the piste edge
    for _ in range(90):
        s_ = rng.uniform(150.0, 2900.0)
        i = int(np.argmin(np.abs(path["s"] - s_)))
        side = 1.0 if rng.random() < 0.5 else -1.0
        off = path["width"][i] * 0.5 + rng.uniform(1.5, 12.0)
        xx = path["x"][i] + side * off * path["rx"][i]
        zz = path["z"][i] + side * off * path["rz"][i]
        rocks.append((xx, zz, float(sample_h(H, xx, zz)), rng.uniform(0.7, 2.2),
                      rng.uniform(0, 2 * np.pi), rng.integers(0, 4)))
    # marked obstacles inside the piste of the downhill
    for s_, t_, sc in ((735, -13.0, 1.5), (1215, 8.0, 1.3), (1975, -15.0, 1.6), (2140, 11.0, 1.4)):
        i = int(np.argmin(np.abs(path["s"] - s_)))
        xx = path["x"][i] + t_ * path["rx"][i]
        zz = path["z"][i] + t_ * path["rz"][i]
        rocks.append((xx, zz, float(sample_h(H, xx, zz)), sc, rng.uniform(0, 2 * np.pi), rng.integers(0, 4)))
    rocks = np.array(rocks, dtype=np.float32)
    print(f"rocks: {len(rocks)}")
    return trees, rocks


def make_courses(path):
    """Runs, gates and checkpoints (all measured along the piste)"""
    def at(s_):
        i = int(np.argmin(np.abs(path["s"] - s_)))
        return i

    def gate_pose(s_, t_center, half_open):
        i = at(s_)
        cx = path["x"][i] + t_center * path["rx"][i]
        cz = path["z"][i] + t_center * path["rz"][i]
        return dict(s=float(s_), t=float(t_center), open=float(half_open),
                    x=float(cx), z=float(cz), tx=float(path["tx"][i]), tz=float(path["tz"][i]))

    runs = []
    # 1 -- Sunrise Cruiser: relaxed run from the summit, wide gates as checkpoints
    cru = [gate_pose(s_, 0.0, 12.0) for s_ in range(150, 900, 150)]
    runs.append(dict(
        id="cruiser", name="Sunrise Cruiser", level="Blue", colour="#2f7dff", sStart=0.0, sEnd=940.0,
        blurb="Wide open alpine bowl above the tree line. Learn to carve.",
        mode="cruise", gates=cru, medals=[66.0, 52.0, 43.0]))
    # 2 -- Giant slalom in the middle forest
    gs = []
    s_ = 1545.0
    side = 1.0
    k = 0
    while s_ < 2440.0:
        gs.append(gate_pose(s_, side * 6.0, 3.6))
        gs[-1]["colour"] = "red" if k % 2 == 0 else "blue"
        side = -side
        s_ += 42.0
        k += 1
    runs.append(dict(
        id="gs", name="Giant Slalom", level="Red", colour="#e0352b", sStart=1480.0, sEnd=2470.0,
        blurb="Thread every gate. Each missed gate costs three seconds.",
        mode="slalom", gates=gs, medals=[100.0, 80.0, 66.0]))
    # 3 -- the full downhill with speed checkpoints
    dh = [gate_pose(s_, 0.0, 16.0) for s_ in range(250, 2800, 250)]
    runs.append(dict(
        id="downhill", name="The Long Descent", level="Black", colour="#1c1c1f", sStart=0.0, sEnd=FINISH_S,
        blurb="Full 2.8 km downhill: a steep wall, four jumps and the fastest snow on the mountain.",
        mode="downhill", gates=dh, medals=[135.0, 106.0, 88.0]))
    return runs


def make_poles(path, world):
    """Marker poles along both piste edges every 28 m"""
    poles = []
    s_ = 10.0
    while s_ < path["s"][-1] - 40.0:
        i = int(np.argmin(np.abs(path["s"] - s_)))
        for side in (-1.0, 1.0):
            off = side * (path["width"][i] * 0.5 - 0.8)
            x = path["x"][i] + off * path["rx"][i]
            z = path["z"][i] + off * path["rz"][i]
            poles.append((x, z, float(sample_h(world["H"], x, z)), 0 if side < 0 else 1))
        s_ += 28.0
    return np.array(poles, dtype=np.float32)


def make_nets(path):
    """Safety fences: (s0, s1, side, offset from centre line)"""
    return [
        (700, 830, 1, 1.0), (1120, 1290, -1, 1.0), (1150, 1290, 1, 1.0), (1740, 1830, 1, 1.0),
        (2000, 2180, 1, 1.0), (2200, 2340, -1, 1.0), (2600, 2800, 1, 1.0), (2600, 2800, -1, 1.0),
        (2800, 2960, 1, 1.0), (2800, 2960, -1, 1.0),
    ]


def save_outputs(path, world, props, trees, rocks, runs, poles, nets):
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(OUT_WORLD, exist_ok=True)
    np.savez_compressed(
        os.path.join(BUILD, "world.npz"),
        H=world["H"], slope=world["slope"], rock=world["rock"], d=world["d"],
        sproj=world["sproj"], t=world["t"], half_w=world["half_w"], w_piste=world["w_piste"],
        trees=trees, rocks=rocks, poles=poles,
    )
    # heights -> uint16
    q = np.clip(np.round((world["H"].astype(np.float64) - H_MIN) * H_QUANT), 0, 65535).astype("<u2")
    from imgio import encode_heights
    encode_heights(q).tofile(os.path.join(OUT_WORLD, "heightmap.pz"))
    if os.path.exists(os.path.join(OUT_WORLD, "heightmap.u16")):
        os.remove(os.path.join(OUT_WORLD, "heightmap.u16"))
    trees.astype("<f4").tofile(os.path.join(OUT_WORLD, "trees.f32"))
    rocks.astype("<f4").tofile(os.path.join(OUT_WORLD, "rocks.f32"))
    poles.astype("<f4").tofile(os.path.join(OUT_WORLD, "poles.f32"))

    step = 4
    sel = slice(0, None, step)
    pdata = np.c_[path["s"][sel], path["x"][sel], path["y"][sel], path["z"][sel], path["tx"][sel],
                  path["tz"][sel], path["width"][sel], path["bank"][sel], path["K"][sel],
                  path["pitch"][sel]]
    sd = sun_direction()
    info = dict(
        version=1,
        grid=dict(nx=NXV, nz=NZV, dx=DX, x0=X0, z0=Z0, hMin=H_MIN, hQuant=H_QUANT),
        sun=dict(azimuthDeg=SUN_AZIMUTH_DEG, elevationDeg=SUN_ELEVATION_DEG, dir=[float(v) for v in sd]),
        path=dict(step=float(step), columns=["s", "x", "y", "z", "tx", "tz", "width", "bank", "curv", "pitch"],
                  data=[[round(float(v), 4) for v in row] for row in pdata]),
        runs=runs, props=props, nets=[dict(s0=a, s1=b, side=c, off=e) for a, b, c, e in nets],
        counts=dict(trees=int(len(trees)), rocks=int(len(rocks)), poles=int(len(poles))),
        finishS=FINISH_S, jumps=[dict(s=a, height=b, ramp=c, lat=e, lane=l) for a, b, c, e, l in JUMPS],
    )
    with open(os.path.join(OUT_WORLD, "world.json"), "w") as f:
        json.dump(info, f, separators=(",", ":"))
    print("wrote", OUT_WORLD)


def preview(world, path, trees, rocks):
    """Hillshade + overview PNGs into build/preview for a quick look"""
    from PIL import Image
    pdir = os.path.join(BUILD, "preview")
    os.makedirs(pdir, exist_ok=True)
    H = world["H"].astype(np.float64)
    gx, gz = grad(H)
    L = sun_direction()
    nrm = np.dstack([-gx, np.ones_like(gx), -gz])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    shade = np.clip(nrm @ L, 0, 1)
    rock = world["rock"]
    base = np.dstack([0.93 * np.ones_like(H), 0.95 * np.ones_like(H), 1.0 * np.ones_like(H)])
    rk = np.dstack([0.42 * np.ones_like(H), 0.38 * np.ones_like(H), 0.35 * np.ones_like(H)])
    col = base * (1 - rock[..., None]) + rk * rock[..., None]
    img = col * (0.25 + 0.85 * shade[..., None])
    # piste tint
    wp = world["w_piste"][..., None]
    img = img * (1 - 0.12 * wp) + np.array([0.7, 0.8, 1.0]) * 0.12 * wp * shade[..., None]
    # trees as dark dots
    ix = np.clip(((trees[:, 0] - X0) / DX).astype(int), 0, NXV - 1)
    iz = np.clip(((trees[:, 1] - Z0) / DX).astype(int), 0, NZV - 1)
    img[iz, ix] = [0.08, 0.22, 0.10]
    for dz_ in (-1, 0, 1):
        for dx_ in (-1, 0, 1):
            img[np.clip(iz + dz_, 0, NZV - 1), np.clip(ix + dx_, 0, NXV - 1)] = [0.08, 0.22, 0.10]
    img = np.clip(img, 0, 1)
    img8 = (np.flipud(img) * 255).astype(np.uint8)          # +z up
    Image.fromarray(img8).save(os.path.join(pdir, "overview_full.png"))
    # chop into three vertical strips laid out side by side
    h = img8.shape[0]
    third = h // 3
    strips = [img8[i * third:(i + 1) * third] for i in range(3)]
    Image.fromarray(np.concatenate(strips, axis=1)).save(os.path.join(pdir, "overview.png"))
    print("preview written")


def main():
    rng = np.random.default_rng(SEED + 1)
    path, world, props = build_world()
    trees, rocks = scatter(path, world, props, rng)
    runs = make_courses(path)
    poles = make_poles(path, world)
    nets = make_nets(path)
    H = world["H"]
    print(f"height range {H.min():.0f}..{H.max():.0f} m, mean piste slope "
          f"{np.degrees(np.arctan(world['slope'][world['w_piste'] > 0.99])).mean():.1f} deg")
    save_outputs(path, world, props, trees, rocks, runs, poles, nets)
    if "--no-preview" not in sys.argv:
        preview(world, path, trees, rocks)


if __name__ == "__main__":
    main()
