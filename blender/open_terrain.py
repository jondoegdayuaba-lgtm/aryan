"""
Height field of the open world (pure numpy / scipy): a 5.1 km x 5.1 km alpine basin.

The mountain is designed from its valleys: each valley is a 3-D polyline (x, z, floor elevation) with a floor width, and the
ground rises with the distance to the nearest valley along a profile that is gentle near the floor, skiable on the flanks
and steep near the ridges.  Domain warping, ridged noise, particle erosion and thermal erosion turn that into a believable
range.  Pistes, lifts and buildings are carved into the result by open_world.py.

Coordinates: metres, +Y up, x east, z south.  Height arrays are indexed [iz, ix]:  x = X0 + ix * DX,  z = Z0 + iz * DX.
"""
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import CubicSpline, PchipInterpolator
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from noise import smoothstep, spectral_noise, ridged  # noqa: E402
import erosion  # noqa: E402

DX = 2.5
N = 1857                     # 29 render chunks of 64 cells
X0 = Z0 = -2320.0
X1 = Z1 = X0 + (N - 1) * DX
H_MIN = 1100.0
H_QUANT = 16.0
SEED = 20261001


def grid():
    xs = X0 + np.arange(N) * DX
    zs = Z0 + np.arange(N) * DX
    return np.meshgrid(xs, zs)


# ------------------------------------------------------------------------------------------- valleys
# (x, z, floor elevation)  and  floor half-width by distance along the valley
VALLEYS = {
    "main": dict(
        ctrl=[(20, 2030, 1392), (10, 1780, 1405), (-30, 1480, 1462), (-95, 1180, 1548), (-175, 880, 1665),
              (-255, 560, 1795), (-335, 250, 1905), (-385, -70, 2015), (-375, -400, 2120), (-330, -730, 2255),
              (-270, -1050, 2400), (-225, -1350, 2545), (-205, -1650, 2690), (-230, -1950, 2760)],
        flat=[(0, 230), (300, 120), (900, 80), (1500, 150), (2100, 70), (2800, 140), (3300, 200), (4200, 250)]),
    "east": dict(
        ctrl=[(10, 1520, 1452), (200, 1280, 1515), (450, 1030, 1600), (750, 860, 1730), (1050, 640, 1890),
              (1350, 330, 2050), (1650, -60, 2220), (1900, -500, 2345), (2030, -900, 2450)],
        flat=[(0, 90), (700, 60), (1500, 110), (2300, 70), (3200, 130)]),
    "west": dict(
        ctrl=[(-40, 1420, 1485), (-330, 1320, 1528), (-650, 1130, 1605), (-950, 810, 1735), (-1250, 460, 1895),
              (-1500, 60, 2045), (-1700, -340, 2195), (-1850, -790, 2315)],
        flat=[(0, 90), (700, 60), (1500, 100), (2300, 80), (2900, 140)]),
    "adler": dict(          # the cirque north-east of the Kessel
        ctrl=[(-330, -730, 2255), (60, -930, 2340), (500, -1120, 2450), (900, -1400, 2550), (1250, -1730, 2640)],
        flat=[(0, 70), (500, 90), (1000, 130), (1700, 170)]),
    "nebel": dict(          # the valley north-west of the Kessel
        ctrl=[(-385, -70, 2015), (-700, -300, 2140), (-1050, -640, 2290), (-1400, -1050, 2440), (-1650, -1500, 2560)],
        flat=[(0, 70), (600, 80), (1300, 110), (1900, 150)]),
}

# height above the valley floor by distance from the floor edge (m)
PROFILE = [(0, 0), (100, 3), (300, 52), (600, 185), (1000, 410), (1500, 690), (2000, 920), (3000, 1250)]

# named summits: (name, x, z, height added on top of the terrain, radius, stretch angle deg, stretch)
PEAKS = [
    ("Kronhorn", -300, -2080, 520, 900, 20, 1.5),
    ("Adlerhorn", 1350, -2050, 460, 800, 60, 1.4),
    ("Wolfsgrat", -1550, -1500, 430, 850, -30, 1.4),
    ("Sonnenspitz", 2000, -350, 350, 800, 90, 1.3),
    ("Nebelhorn", -1950, -250, 340, 750, 10, 1.3),
    ("Rotstock", 800, -1200, 320, 620, 45, 1.3),
    ("Glasberg", -900, -850, 280, 560, 0, 1.2),
    ("Silberkamm", 1500, 500, 250, 560, 30, 1.3),
]


XZ_SCALE = 0.92         # the valley and peak layout below was drawn on a 5.1 km sheet
Y_SCALE = 0.78          # ... with floors climbing a little too steeply for this size
for _v in VALLEYS.values():
    _v["ctrl"] = [(x * XZ_SCALE, z * XZ_SCALE, 1392.0 + (e - 1392.0) * Y_SCALE) for x, z, e in _v["ctrl"]]
    _v["flat"] = [(sv * XZ_SCALE, w) for sv, w in _v["flat"]]
PEAKS[:] = [(n, x * XZ_SCALE, z * XZ_SCALE, h * 0.62, r * 1.25, a, st) for n, x, z, h, r, a, st in PEAKS]


def valley_samples(v, step=2.0):
    """dense samples of one valley: x, z, elevation, floor half-width, arc length"""
    c = np.array(v["ctrl"], dtype=np.float64)
    chord = np.r_[0.0, np.cumsum(np.hypot(*np.diff(c[:, :2], axis=0).T))]
    spl = CubicSpline(chord, c[:, :2], bc_type="natural")
    u = np.arange(0.0, chord[-1], step)
    xy = spl(u)
    seg = np.r_[0.0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    y = PchipInterpolator(chord, c[:, 2])(u)
    fw = PchipInterpolator(*zip(*v["flat"]))(np.clip(seg, v["flat"][0][0], v["flat"][-1][0]))
    return xy[:, 0], xy[:, 1], y, fw, seg


def valley_fields(X, Z, coarse=4):
    """Ground height from the valley network: the lower envelope of a cone profile hung on every sample of every valley floor,
    z = floor elevation + flank profile(distance to the floor edge).  It is continuous and never rises faster than the profile,
    so ridges form where two valleys' flanks meet and there are no cliffs.  Evaluated on a coarse grid and interpolated.
    X, Z are the (possibly warped) coordinates of the full grid.  Returns H and the distance to the nearest floor."""
    prof = PchipInterpolator(*zip(*PROFILE), extrapolate=True)
    table_d = np.arange(0.0, PROFILE[-1][0] + 1.0, 1.0)
    table_a = prof(table_d)
    Xc, Zc = X[::coarse, ::coarse], Z[::coarse, ::coarse]
    q = np.c_[Xc.ravel(), Zc.ravel()]
    per_valley, dists = [], []
    for name, v in VALLEYS.items():
        x, z, y, fw, seg = valley_samples(v, step=10.0)
        best = np.full(len(q), np.inf)
        dmin = np.full(len(q), np.inf)
        for i0 in range(0, len(q), 6000):
            qq = q[i0:i0 + 6000]
            d = np.hypot(qq[:, 0:1] - x[None, :], qq[:, 1:2] - z[None, :])
            dd = np.maximum(d - fw[None, :], 0.0)
            hh = y[None, :] + np.interp(dd, table_d, table_a)
            best[i0:i0 + 6000] = hh.min(axis=1)
            dmin[i0:i0 + 6000] = d.min(axis=1)
        per_valley.append(best.reshape(Xc.shape))
        dists.append(dmin.reshape(Xc.shape))
    H = np.stack(per_valley).min(axis=0)
    H = ndi.gaussian_filter(H, 2.0)                          # round the crests a little (coarse cells are 10 m)
    D = np.stack(dists).min(axis=0)
    n = X.shape[0]
    fzx = np.arange(n) / coarse
    zz, xx = np.meshgrid(fzx, fzx, indexing="ij")
    Hf = ndi.map_coordinates(H, [zz, xx], order=1, mode="nearest")
    Df = ndi.map_coordinates(D, [zz, xx], order=1, mode="nearest")
    return Hf, Df


def thermal_erosion(h, iterations, talus, rate=0.5, dx=DX):
    """Slump slopes steeper than talus (rise per metre) toward lower neighbours (8-neighbourhood)."""
    offs = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
            (-1, -1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (1, 1, 1.4142)]
    h = h.astype(np.float32)
    for _ in range(iterations):
        p = np.pad(h, 1, mode="edge")
        c = p[1:-1, 1:-1]
        out = np.zeros_like(h)
        gives = []
        for dz, dxo, dist in offs:
            n = p[1 + dz:p.shape[0] - 1 + dz, 1 + dxo:p.shape[1] - 1 + dxo]
            ex = np.maximum(c - n - talus * dx * dist, 0.0)
            g = rate * 0.125 * ex
            gives.append((dz, dxo, g))
            out += g
        recv = np.zeros_like(h)
        for dz, dxo, g in gives:
            gp = np.pad(g, 1, mode="constant")
            recv += gp[1 - dz:gp.shape[0] - 1 - dz, 1 - dxo:gp.shape[1] - 1 - dxo]
        h = h - out + recv
    return h


def build_heights(rng, drops=2_600_000, thermal=36, verbose=True):
    """returns dict(H, valley fields)"""
    X, Z = grid()
    shape = X.shape
    say = print if verbose else (lambda *a, **k: None)

    say("noise ...")
    n_w1 = spectral_noise(shape, DX, 500.0, 2400.0, 2.0, rng)
    n_w2 = spectral_noise(shape, DX, 500.0, 2400.0, 2.0, rng)
    n_a = spectral_noise(shape, DX, 280.0, 1500.0, 2.6, rng)
    n_b = spectral_noise(shape, DX, 100.0, 400.0, 2.5, rng)
    n_c = spectral_noise(shape, DX, 30.0, 120.0, 2.3, rng)
    n_r = spectral_noise(shape, DX, 220.0, 900.0, 2.1, rng)
    n_r2 = spectral_noise(shape, DX, 100.0, 320.0, 2.0, rng)

    say("valley network ...")
    Hv, D = valley_fields(X + 150.0 * n_w1, Z + 150.0 * n_w2)
    rough = 1.0 + 0.10 * np.tanh(n_a)                       # some flanks rise faster than others
    H = 1392.0 + (Hv - 1392.0) * rough
    dd = np.maximum(D - 60.0, 0.0)

    # crags: ridged noise, stronger with altitude and away from the valley floors
    alt = smoothstep(1900.0, 2900.0, H)
    away = smoothstep(120.0, 700.0, dd)
    H += (0.42 * n_a + 0.10 * n_b) * (7.0 + 20.0 * away) * (0.3 + alt)
    H += 46.0 * ridged(n_r) * away * (0.1 + alt) * (0.6 + 0.4 * np.tanh(n_a))
    H += 8.0 * ridged(n_r2) * away * alt
    H += n_c * (0.5 + 0.8 * away)

    # summits
    for name, px, pz, ph, pr, pa, ps in PEAKS:
        a = np.radians(pa)
        u = (X - px) * np.cos(a) + (Z - pz) * np.sin(a)
        v = -(X - px) * np.sin(a) + (Z - pz) * np.cos(a)
        r = np.hypot(u / ps, v * ps) * (1.0 + 0.16 * np.tanh(0.8 * n_b))
        bump = (1.0 - smoothstep(0.0, pr, r)) ** 1.5
        H += ph * bump * (0.72 + 0.34 * ridged(n_r2))

    # the basin is closed: a wall rises toward every edge
    edge = np.maximum(np.abs(X), np.abs(Z))
    # ... but only a low rim on the sun side (south): the sun stands 38 degrees high in the south-south-west, and a taller wall
    # there would keep the village and the whole basin in shade all day
    north = smoothstep(700.0, -700.0, Z)
    H += (170.0 + 250.0 * north) * smoothstep(1780.0, 2300.0, edge) ** 1.4
    # nothing lower than the village floor
    H = np.maximum(H, 1380.0)

    say("thermal erosion (pre) ...")
    H = thermal_erosion(H, 8, 0.95, 0.5)
    if drops:
        say(f"hydraulic erosion, {drops} drops ...")
        hard = smoothstep(0.55, 1.0, np.hypot(*np.gradient(ndi.gaussian_filter(H, 2.0), DX))).astype(np.float32)
        H = erosion.hydraulic(H.astype(np.float32), DX, drops=drops, seed=SEED % 100000, hardness=hard)
    say("thermal erosion (post) ...")
    H = thermal_erosion(H, thermal, 0.90, 0.5)
    H = ndi.gaussian_filter(H, 0.8)
    return dict(H=H.astype(np.float32), dd=dd, n_a=n_a, n_b=n_b, n_c=n_c, n_r=n_r)


# ---------------------------------------------------------------------------------- helpers
def bilinear(arr, x, z, order=1):
    scalar = np.ndim(x) == 0 and np.ndim(z) == 0
    fx = (np.atleast_1d(np.asarray(x, dtype=np.float64)) - X0) / DX
    fz = (np.atleast_1d(np.asarray(z, dtype=np.float64)) - Z0) / DX
    out = ndi.map_coordinates(arr, [fz, fx], order=order, mode="nearest")
    return float(out[0]) if scalar else out


def grad(h):
    gz, gx = np.gradient(h, DX)
    return gx, gz


def hillshade(H, sun=(-0.295, 0.6157, 0.7306), z=1.0):
    gx, gz = grad(H.astype(np.float64))
    nrm = np.dstack([-gx * z, np.ones_like(gx), -gz * z])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    return np.clip(nrm @ np.array(sun), 0, 1)


def preview_png(H, path, extra=None, scale=2):
    """quick look: hillshade tinted by elevation (row 0 = north = -z at the top)"""
    from PIL import Image
    sh = hillshade(H)
    gx, gz = grad(H.astype(np.float64))
    slope = np.hypot(gx, gz)
    t = smoothstep(1400.0, 3300.0, H)
    base = np.dstack([0.55 + 0.45 * t, 0.62 + 0.38 * t, 0.50 + 0.50 * t])
    rock = smoothstep(0.75, 1.15, slope)[..., None]
    col = base * (1 - rock) + np.array([0.42, 0.38, 0.35]) * rock
    img = col * (0.28 + 0.85 * sh[..., None])
    if extra is not None:
        img = extra(img)
    img8 = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    if scale > 1:
        img8 = img8[::scale, ::scale]
    Image.fromarray(img8).save(path)


if __name__ == "__main__":
    import time
    rng = np.random.default_rng(SEED)
    t0 = time.time()
    r = build_heights(rng, drops=int(os.environ.get("DROPS", 2_600_000)))
    H = r["H"]
    print(f"done in {time.time() - t0:.0f} s; height {H.min():.0f}..{H.max():.0f} m")
    gx, gz = grad(H)
    ang = np.degrees(np.arctan(np.hypot(gx, gz)))
    for lo, hi in ((0, 10), (10, 20), (20, 30), (30, 40), (40, 50), (50, 90)):
        print(f"  slope {lo}-{hi} deg: {((ang >= lo) & (ang < hi)).mean() * 100:.1f}%")
    out = os.path.join(HERE, "build")
    os.makedirs(out, exist_ok=True)
    np.save(os.path.join(out, "open_H_raw.npy"), H)
    preview_png(H, os.path.join(out, "open_preview.png"))
