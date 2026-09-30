#!/usr/bin/env python3
"""
Open world generator for Alpine Descent (pure numpy / scipy, no Blender needed).

Starts from the eroded basin of open_terrain.py and builds the ski area on top of it:

  * the village (flattened plaza, lodge, chalets, chapel, a frozen lake),
  * five chairlifts (rideable in the game) with their stations and pylons,
  * a network of groomed pistes found by a slope-aware route search, then carved into the mountain
    (smoothed along the run, cross slope kept close to the hillside so the cuts stay small),
  * a terrain park of kickers,
  * forest and boulder scatter, piste marker poles,
  * 24 collectible flags and 10 landmarks to discover.

Writes  ski/assets/open/{heightmap.u16, groom.u8, trees.f32, rocks.f32, poles.f32, world.json}
and     build/open.npz  (read by open_maps.py, which paints the colour / mask / light-map textures).

usage: python open_world.py [--redo-terrain] [--drops N] [--no-preview]
"""
import json
import math
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import PchipInterpolator
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build")
OUT = os.path.join(ROOT, "ski", "assets", "open")

import open_terrain as ot  # noqa: E402
from open_terrain import DX, N, X0, Z0, X1, Z1, H_MIN, H_QUANT, bilinear, grad  # noqa: E402
from noise import smoothstep, spectral_noise  # noqa: E402

SEED = 20261002
SUN_AZIMUTH_DEG = 158.0
SUN_ELEVATION_DEG = 38.0

# piste classes: (name, colour, lo pitch, hi pitch, base width)
LEVELS = {
    "green": dict(colour="#2fa84f", lo=4.0, hi=11.0, width=52.0, idx=0, cap=14.0),
    "blue": dict(colour="#2f7dff", lo=8.0, hi=17.0, width=44.0, idx=1, cap=23.0),
    "red": dict(colour="#e0352b", lo=13.0, hi=24.0, width=36.0, idx=2, cap=30.0),
    "black": dict(colour="#1c1c1f", lo=20.0, hi=32.0, width=28.0, idx=3, cap=36.0),
}


def sun_direction():
    az = math.radians(SUN_AZIMUTH_DEG)
    el = math.radians(SUN_ELEVATION_DEG)
    hx, hz = -math.sin(az), -math.cos(az)
    return np.array([hx * math.cos(el), math.sin(el), hz * math.cos(el)])


def smooth1d(a, sigma):
    return ndi.gaussian_filter1d(np.asarray(a, dtype=np.float64), sigma, mode="nearest")


# ============================================================================ the sites
# Everything is placed by name; positions are (x, z) in metres and are snapped to the ground afterwards.
# The valley layout is in open_terrain.py (main valley runs north from the village).
VILLAGE = (18.0, 1800.0)
LAKE = dict(x=-300.0, z=1830.0, rx=170.0, rz=105.0, yaw=0.25)

LIFTS = [
    # id, name, bottom (x, z), top (x, z), chair speed m/s
    dict(id="express", name="Alpenrose Express", bottom=(-22.0, 1676.0), top=(-150.0, 800.0), speed=9.5),
    dict(id="kessel", name="Kessel Sechser", bottom=(-215.0, 640.0), top=(-110.0, -300.0), speed=9.5),
    dict(id="eisfeld", name="Eisfeld Bahn", bottom=(-110.0, -380.0), top=(-215.0, -1290.0), speed=10.0),
    dict(id="sonnenalp", name="Sonnenalp Chair", bottom=(140.0, 1290.0), top=(700.0, 800.0), speed=9.0),
    dict(id="wolfstal", name="Wolfstal Chair", bottom=(-250.0, 1250.0), top=(-790.0, 850.0), speed=9.0),
]

# pistes: id, name, level, waypoints (route search goes through them in order). A waypoint may be "top:<lift>" (the alighting
# point beside a top station) or "base:<lift>" (the queue in front of a bottom station).
PISTES = [
    dict(id="grand", name="Grand Descent", level="red",
         via=["top:eisfeld", (-200, -800), "base:eisfeld", "top:kessel", (-215, 300), "top:express", (-90, 1200), "base:express", (18, 1780)]),
    dict(id="eisbowl", name="Eisfeld Bowl", level="red",
         via=["top:eisfeld", (-60, -1000), (-160, -700), "base:eisfeld"]),
    dict(id="talabfahrt", name="Talabfahrt", level="blue",
         via=["top:express", (-60, 1000), (-20, 1350), "base:express", (18, 1780)]),
    dict(id="familie", name="Familienpiste", level="green",
         via=["top:express", (120, 950), "base:sonnenalp", (60, 1560), (18, 1780)]),
    dict(id="sonne", name="Sonnenalp", level="blue",
         via=["top:sonnenalp", (420, 950), "base:sonnenalp", (60, 1560), (18, 1780)]),
    dict(id="wolf", name="Wolfstal", level="blue",
         via=["top:wolfstal", (-520, 1020), "base:wolfstal", (-90, 1580), (18, 1780)]),
    dict(id="kessel_run", name="Kessel Run", level="blue",
         via=["top:kessel", (-200, 80), "base:kessel"]),
    dict(id="nebel", name="Nebelgrat", level="black",
         via=["top:nebel", (-620, -520), "base:nebel"]),
    dict(id="adler", name="Adlerkamm", level="black",
         via=["top:adler", (350, -900), (-100, -730), "base:adler"]),
]

# lifts serving the north bowls (the route search is what decides the actual lines)
EXTRA_LIFTS = [
    dict(id="nebel", name="Nebelgrat Lift", bottom=(-140.0, -390.0), top=(-1000.0, -820.0), speed=9.5),
    dict(id="adler", name="Adler Sechser", bottom=(-280.0, -720.0), top=(760.0, -1140.0), speed=10.0),
]


def station_points(lifts):
    """alighting point beside each top station and queue point in front of each bottom station"""
    out = {}
    for lf in lifts:
        pts = lf["points"]
        bx, bz = pts[0]
        ex, ez = pts[1]
        d = np.array([ex - bx, ez - bz])
        d /= np.hypot(*d)
        r = np.array([-d[1], d[0]])
        tx, tz = pts[-1]
        px, pz = pts[-2]
        dt = np.array([tx - px, tz - pz])
        dt /= np.hypot(*dt)
        rt = np.array([-dt[1], dt[0]])
        out["base:" + lf["id"]] = (bx - d[0] * 24.0 + r[0] * 12.0, bz - d[1] * 24.0 + r[1] * 12.0)
        out["top:" + lf["id"]] = (tx + dt[0] * 20.0 - rt[0] * 12.0, tz + dt[1] * 20.0 - rt[1] * 12.0)
    return out


# ============================================================================ router
class Router:
    """Least-cost route over a coarse copy of the ground: the cost punishes climbing, flats, terrain steeper than
    the piste class allows and steep side slopes, so the route winds down the hill the way a piste would."""

    def __init__(self, H, coarse=4):
        self.c = coarse
        self.Hc = H[::coarse, ::coarse].astype(np.float64)
        self.ny, self.nx = self.Hc.shape
        self.cell = DX * coarse
        Hs = ndi.gaussian_filter(self.Hc, 1.0)
        gz, gx = np.gradient(Hs, self.cell)
        self.slope = np.degrees(np.arctan(np.hypot(gx, gz)))
        self.blocked = np.zeros(self.Hc.shape, dtype=bool)
        self.extra = np.zeros(self.Hc.shape)          # additive cost: keeps new pistes off the ones already routed
        self._graphs = {}
        self._extra_version = 0

    def node(self, x, z):
        i = int(round((x - X0) / self.cell))
        j = int(round((z - Z0) / self.cell))
        return min(max(j, 0), self.ny - 1) * self.nx + min(max(i, 0), self.nx - 1)

    def xz(self, node):
        j, i = divmod(int(node), self.nx)
        return X0 + i * self.cell, Z0 + j * self.cell

    def graph(self, lo, hi, cap=36.0, strict_down=False):
        key = (lo, hi, cap, strict_down, self._extra_version)
        if key in self._graphs:
            return self._graphs[key]
        ny, nx = self.ny, self.nx
        ids = np.arange(ny * nx).reshape(ny, nx)
        H = self.Hc
        src, dst, cost = [], [], []
        for dz, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            z0, z1 = max(0, -dz), ny - max(0, dz)
            x0, x1 = max(0, -dx), nx - max(0, dx)
            a = ids[z0:z1, x0:x1]
            b = ids[z0 + dz:z1 + dz, x0 + dx:x1 + dx]
            L = self.cell * math.hypot(dz, dx)
            dh = H[z0 + dz:z1 + dz, x0 + dx:x1 + dx] - H[z0:z1, x0:x1]
            pitch = np.degrees(np.arctan2(-dh, L))
            slope_b = self.slope[z0 + dz:z1 + dz, x0 + dx:x1 + dx]
            cross = np.sqrt(np.maximum(slope_b ** 2 - pitch ** 2, 0.0))
            c = np.ones_like(pitch)
            up = pitch < 0
            if strict_down:
                c += np.where(pitch < -6.0, 1e4, 0.0)
                c += np.where(slope_b > cap, 1e4, 0.0)
            else:
                c += np.where(up, 2.5 + 0.7 * (-pitch), 0.0)
                c += np.where(slope_b > cap, 0.5 * np.maximum(slope_b - cap, 0.0) ** 1.2, 0.0)
                flat = (~up) & (pitch < lo)
                c += np.where(flat, 1.2 * (lo - pitch) / max(lo, 1.0), 0.0)
                c += np.where(pitch > hi, 0.18 * np.maximum(pitch - hi, 0.0) ** 1.3, 0.0)
                c += 0.012 * np.maximum(cross - 7.0, 0.0) ** 2
            c += np.where(self.blocked[z0 + dz:z1 + dz, x0 + dx:x1 + dx], 500.0, 0.0)
            c += self.extra[z0 + dz:z1 + dz, x0 + dx:x1 + dx]
            src.append(a.ravel())
            dst.append(b.ravel())
            cost.append((L * c).ravel())
        G = csr_matrix((np.concatenate(cost), (np.concatenate(src), np.concatenate(dst))), shape=(ny * nx, ny * nx))
        self._graphs[key] = G
        return G

    def claim(self, pts, half=60.0, cost=3.0, free=(), free_radius=230.0):
        """make the cells near a routed line expensive for later routes (except near the given shared end points)"""
        tree = cKDTree(pts)
        xs = X0 + np.arange(self.nx) * self.cell
        zs = Z0 + np.arange(self.ny) * self.cell
        XC, ZC = np.meshgrid(xs, zs)
        d, _ = tree.query(np.c_[XC.ravel(), ZC.ravel()], distance_upper_bound=half, workers=-1)
        near = np.isfinite(d).reshape(XC.shape)
        dg = np.where(np.isfinite(d), d, half).reshape(XC.shape)
        w = np.where(near, 1.0 - smoothstep(0.35 * half, half, dg), 0.0)
        for fx, fz in free:
            w *= smoothstep(free_radius * 0.4, free_radius, np.hypot(XC - fx, ZC - fz))
        self.extra += cost * w
        self._extra_version += 1

    def route(self, points, lo, hi):
        G = self.graph(lo, hi)
        out = []
        for a, b in zip(points[:-1], points[1:]):
            s, t = self.node(*a), self.node(*b)
            dist, pred = dijkstra(G, directed=True, indices=s, return_predecessors=True)
            chain = [t]
            while chain[-1] != s:
                p = pred[chain[-1]]
                if p < 0:
                    raise RuntimeError(f"no route from {a} to {b}")
                chain.append(p)
            chain.reverse()
            pts = [self.xz(n) for n in chain]
            out += pts if not out else pts[1:]
        return np.array(out)

    def reachable(self, sources, cap=36.0):
        """cells a skier can get to from the sources by going downhill (or nearly flat) on ground below `cap` degrees"""
        G = self.graph(0, 0, cap=cap, strict_down=True)
        idx = np.array([self.node(*s) for s in sources])
        dist = dijkstra(G, directed=True, indices=idx, min_only=True)
        return (dist < 9000.0).reshape(self.ny, self.nx)


def resample(pts, step):
    d = np.r_[0.0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    s = np.arange(0.0, d[-1], step)
    return np.c_[np.interp(s, d, pts[:, 0]), np.interp(s, d, pts[:, 1])], s


def smooth_route(pts, sigma_m=38.0, step=2.0):
    p, s = resample(pts, step)
    sg = sigma_m / step
    q = np.c_[smooth1d(np.r_[np.repeat(p[:1, 0], 60), p[:, 0], np.repeat(p[-1:, 0], 60)], sg)[60:-60],
              smooth1d(np.r_[np.repeat(p[:1, 1], 60), p[:, 1], np.repeat(p[-1:, 1], 60)], sg)[60:-60]]
    q[0], q[-1] = p[0], p[-1]
    return resample(q, step)


# ============================================================================ terrain editing
def local_grid(cx, cz, reach):
    """slices and coordinate grids of the window of the height field around (cx, cz)"""
    i0 = max(int((cx - reach - X0) / DX), 0)
    i1 = min(int((cx + reach - X0) / DX) + 2, N)
    j0 = max(int((cz - reach - Z0) / DX), 0)
    j1 = min(int((cz + reach - Z0) / DX) + 2, N)
    xs = X0 + np.arange(i0, i1) * DX
    zs = Z0 + np.arange(j0, j1) * DX
    XX, ZZ = np.meshgrid(xs, zs)
    return (slice(j0, j1), slice(i0, i1)), XX, ZZ


def flatten(H, cx, cz, radius, blend, level=None, ellipse=None):
    """level a disc of ground (radius, blend in metres) or a rotated ellipse (ellipse = (cos, sin, rx, rz); blend in metres
    beyond the shore); returns the level used"""
    if ellipse is None:
        reach = radius + blend + DX * 3
    else:
        reach = max(ellipse[2], ellipse[3]) + blend + DX * 3
    sl, XX, ZZ = local_grid(cx, cz, reach)
    if ellipse is None:
        d = np.hypot(XX - cx, ZZ - cz)
        r0, r1 = radius, radius + blend
    else:
        c, s_, ax, az = ellipse
        u = (XX - cx) * c + (ZZ - cz) * s_
        v = -(XX - cx) * s_ + (ZZ - cz) * c
        d = np.hypot(u / ax, v / az)
        r0, r1 = 1.0, 1.0 + blend / min(ax, az)
    sub = H[sl]
    w = 1.0 - smoothstep(r0, r1, d)
    if level is None:
        inner = d < r0
        level = float(np.median(sub[inner])) if inner.any() else float(bilinear(H, cx, cz))
    sub += (level - sub) * w
    return level


def ground(H, x, z):
    return float(bilinear(H, x, z))


def snap_flat(H, x, z, radius=130.0, sigma=18.0, prefer_high=0.0):
    """the flattest spot near (x, z): smallest smoothed slope, mildly penalising the distance moved"""
    sl, XX, ZZ = local_grid(x, z, radius)
    sub = ndi.gaussian_filter(H[sl], sigma / DX)
    gz, gx = np.gradient(sub, DX)
    slope = np.hypot(gx, gz)
    d = np.hypot(XX - x, ZZ - z)
    cost = slope + 0.0012 * d - prefer_high * 0.0004 * (sub - sub.mean())
    cost = np.where(d <= radius, cost, 1e9)
    j, i = np.unravel_index(np.argmin(cost), cost.shape)
    return float(XX[j, i]), float(ZZ[j, i])


# shared plateaus where two lifts meet: (nominal x, z, radius, blend); the plateau is moved to the flattest ground nearby
HUBS = [(-110.0, -340.0, 56.0, 50.0)]
HUB_LIFTS = {"kessel": ("top", (-6.0, 34.0)), "eisfeld": ("bottom", (6.0, -30.0)), "nebel": ("bottom", (-34.0, -20.0))}   # offsets from the hub centre


# ============================================================================ pistes
class Piste:
    def __init__(self, spec, pts, H, rng):
        self.id, self.name, self.level = spec["id"], spec["name"], spec["level"]
        L = LEVELS[self.level]
        self.colour = L["colour"]
        p, s = smooth_route(pts, sigma_m=34.0)
        self.x, self.z, self.s = p[:, 0], p[:, 1], s
        n = len(s)
        # ground height along the route -> a smooth, always descending profile
        h = bilinear(H, self.x, self.z)
        y = smooth1d(h, 14.0)
        y = np.minimum.accumulate(y)
        y = smooth1d(y, 4.0)
        y = np.minimum.accumulate(y)
        y = self.limit_pitch(y, L["cap"])
        # never flatter than 0.6 degrees so water (and skiers) run off the plaza
        floor = y[0] - np.arange(n) * 2.0 * math.tan(math.radians(0.6))
        self.y = np.minimum(y, np.maximum(floor, y[-1]))
        self.tx = np.gradient(self.x, 2.0)
        self.tz = np.gradient(self.z, 2.0)
        m = np.hypot(self.tx, self.tz)
        self.tx, self.tz = self.tx / m, self.tz / m
        self.rx, self.rz = -self.tz, self.tx
        self.curv = smooth1d(np.gradient(self.tx, 2.0) * self.rx + np.gradient(self.tz, 2.0) * self.rz, 6.0)
        # width: wide where the hill is gentle, waist at the steep parts, plaza at both ends
        pitch = np.degrees(np.arctan(-np.gradient(self.y, 2.0)))
        base = L["width"]
        wobble = 1.0 + 0.16 * np.sin(s / 170.0 + rng.uniform(0, 6.28)) + 0.08 * np.sin(s / 61.0 + rng.uniform(0, 6.28))
        steep = 1.0 - 0.22 * smoothstep(L["hi"] - 2, L["hi"] + 8, smooth1d(pitch, 20.0))
        ends = 1.0 + 0.45 * (1 - smoothstep(0, 70, s)) + 0.9 * (1 - smoothstep(0, 140, s[-1] - s))
        self.width = np.clip(base * wobble * steep * ends, 16.0, 120.0)
        # cross slope: keep the natural side slope of the hill (limited) so the cuts stay small
        hw = self.width * 0.5
        hl = bilinear(H, self.x - self.rx * hw * 0.8, self.z - self.rz * hw * 0.8)
        hr = bilinear(H, self.x + self.rx * hw * 0.8, self.z + self.rz * hw * 0.8)
        cs = (hr - hl) / (1.6 * hw)
        self.cross = np.clip(smooth1d(cs, 20.0), -0.17, 0.17) * 0.85
        self.pitch = np.degrees(np.arctan(-np.gradient(self.y, 2.0)))

    @staticmethod
    def limit_pitch(y, cap_deg, ds=2.0):
        """smooth the descent profile until 97 % of it is no steeper than cap_deg (the ends stay where they are)"""
        n = len(y)
        t = np.linspace(0.0, 1.0, n)
        for sigma in (0.0, 22.0, 32.0, 46.0, 66.0, 92.0, 130.0, 180.0):
            ys = smooth1d(y, sigma / ds) if sigma else y.copy()
            ys = ys + (y[0] - ys[0]) * (1 - t) + (y[-1] - ys[-1]) * t
            ys = np.minimum.accumulate(ys)
            if np.percentile(np.degrees(np.arctan(-np.gradient(ys, ds))), 97) <= cap_deg:
                break
        return ys

    @property
    def length(self):
        return float(self.s[-1])

    def sample(self, s):
        return dict(x=np.interp(s, self.s, self.x), z=np.interp(s, self.s, self.z), y=np.interp(s, self.s, self.y),
                    tx=np.interp(s, self.s, self.tx), tz=np.interp(s, self.s, self.tz), width=np.interp(s, self.s, self.width))


def carve_pistes(H, pistes, blend=24.0):
    """Blend every piste surface into the height field. Returns the new field and the groomed-snow weight (0..1)."""
    Hn = H.copy().astype(np.float64)
    sumw = np.zeros_like(Hn)
    sump = np.zeros_like(Hn)
    keep = np.ones_like(Hn)
    groom = np.zeros_like(Hn)
    for pi, p in enumerate(pistes):
        reach = p.width.max() * 0.5 + blend + 6.0
        tree = cKDTree(np.c_[p.x, p.z])
        x_lo, x_hi = p.x.min() - reach, p.x.max() + reach
        z_lo, z_hi = p.z.min() - reach, p.z.max() + reach
        i0, i1 = max(int((x_lo - X0) / DX), 0), min(int((x_hi - X0) / DX) + 2, N)
        j0, j1 = max(int((z_lo - Z0) / DX), 0), min(int((z_hi - Z0) / DX) + 2, N)
        xs = X0 + np.arange(i0, i1) * DX
        zs = Z0 + np.arange(j0, j1) * DX
        XX, ZZ = np.meshgrid(xs, zs)
        q = np.c_[XX.ravel(), ZZ.ravel()]
        d, idx = tree.query(q, distance_upper_bound=reach, workers=-1)
        ok = np.isfinite(d)
        d = np.where(ok, d, reach + 1)
        idx = np.where(ok, idx, 0)
        # signed lateral offset
        dxp = q[:, 0] - p.x[idx]
        dzp = q[:, 1] - p.z[idx]
        t = dxp * p.rx[idx] + dzp * p.rz[idx]
        hw = p.width[idx] * 0.5
        surf = p.y[idx] + p.cross[idx] * t
        w = 1.0 - smoothstep(hw, hw + blend, d)
        w = np.where(ok, w, 0.0)
        g = 1.0 - smoothstep(hw - 2.0, hw + 1.2, d)
        g = np.where(ok, g, 0.0)
        sl = (slice(j0, j1), slice(i0, i1))
        w2 = w.reshape(XX.shape)
        sumw[sl] += w2
        sump[sl] += w2 * surf.reshape(XX.shape)
        keep[sl] *= (1.0 - w2)
        groom[sl] = np.maximum(groom[sl], g.reshape(XX.shape))
    W = 1.0 - keep
    Pavg = np.where(sumw > 1e-6, sump / np.maximum(sumw, 1e-6), Hn)
    Hn = Hn * (1.0 - W) + Pavg * W
    return Hn, groom


def add_kickers(H, piste, specs):
    """terrain park: (s, lateral offset m, height m, ramp length m, half width m) jumps beside the racing line"""
    Hn = H.copy()
    tree = cKDTree(np.c_[piste.x, piste.z])
    for s0, off, hgt, ramp, hwid in specs:
        i = int(np.argmin(np.abs(piste.s - s0)))
        cx = piste.x[i] + piste.rx[i] * off
        cz = piste.z[i] + piste.rz[i] * off
        sl, XX, ZZ = local_grid(cx, cz, ramp + 40)
        dx = XX - cx
        dz = ZZ - cz
        a = piste.tx[i] * dx + piste.tz[i] * dz            # along the run (positive = downhill)
        b = piste.rx[i] * dx + piste.rz[i] * dz
        up = smoothstep(-ramp, 0.0, a) * (a <= 0.0)
        lip = (1.0 - smoothstep(0.0, 3.0, a)) * (a > 0.0) * 0.55
        prof = hgt * (up ** 1.15 + lip)
        land = -0.5 * hgt * smoothstep(4.0, 10.0, a) * (1.0 - smoothstep(10.0, 34.0, a))
        win = np.exp(-(np.abs(b) / hwid) ** 4)
        Hn[sl] += (prof + land) * win
    return Hn


# ============================================================================ lifts
def build_lift(spec, H, spacing=78.0):
    bx, bz = spec["bottom"]
    tx, tz = spec["top"]
    length = math.hypot(tx - bx, tz - bz)
    n = max(int(round(length / spacing)), 3)
    pts = [(bx + (tx - bx) * k / n, bz + (tz - bz) * k / n) for k in range(n + 1)]
    return dict(spec, points=pts, length=length)


LIFT_FOLLOW = {"express": "talabfahrt", "kessel": "kessel_run", "eisfeld": "eisbowl", "sonnenalp": "sonne",
               "wolfstal": "wolf", "nebel": "nebel", "adler": "adler"}


def lift_from_piste(lift, piste, H, offset=62.0, spacing=78.0):
    """Re-route a lift to run beside the piste it serves (on whichever side has the calmer ground), from its bottom station to
    its top station, so the cable line follows the same gentle terrain the piste was routed over"""
    B = np.array(lift["points"][0], float)
    T = np.array(lift["points"][-1], float)
    tree = cKDTree(np.c_[piste.x, piste.z])
    ia = int(tree.query(B)[1])
    ib = int(tree.query(T)[1])
    lo, hi = min(ia, ib), max(ia, ib)
    idx = np.arange(hi, lo - 1, -1)                      # from the bottom (downhill end) up to the top
    if piste.y[idx[0]] > piste.y[idx[-1]]:
        idx = idx[::-1]
    x, z, rx, rz = piste.x[idx], piste.z[idx], piste.rx[idx], piste.rz[idx]
    n = len(idx)
    dist = np.arange(n) * 2.0
    ramp_b = smoothstep(0.0, 260.0, dist)
    ramp_t = smoothstep(0.0, 260.0, dist[-1] - dist)
    ramp = np.minimum(ramp_b, ramp_t)
    # the stations themselves are where they were planned: blend from their own lateral offset
    off_b = float((B[0] - x[0]) * rx[0] + (B[1] - z[0]) * rz[0])
    off_t = float((T[0] - x[-1]) * rx[-1] + (T[1] - z[-1]) * rz[-1])
    best = None
    for side in (-1.0, 1.0):
        lat = side * offset * ramp + off_b * (1 - ramp_b) + off_t * (1 - ramp_t)
        px, pz = x + rx * lat, z + rz * lat
        px = smooth1d(px, 22.0)
        pz = smooth1d(pz, 22.0)
        sl, _ = 0, 0
        gxx, gzz = grad(ndi.gaussian_filter(H, 3.0))
        cost = float(np.mean(np.hypot(bilinear(gxx, px, pz), bilinear(gzz, px, pz))))
        if best is None or cost < best[0]:
            best = (cost, px, pz)
    _, px, pz = best
    px[0], pz[0] = B
    px[-1], pz[-1] = T
    pts, s = resample(np.c_[px, pz], 1.0)
    k = max(int(round(s[-1] / spacing)), 3)
    cum = np.linspace(0.0, s[-1], k + 1)
    ptsx = np.interp(cum, s, pts[:, 0])
    ptsz = np.interp(cum, s, pts[:, 1])
    ptsx[0], ptsz[0] = B
    ptsx[-1], ptsz[-1] = T
    lift["points"] = [(float(a), float(b)) for a, b in zip(ptsx, ptsz)]
    lift["length"] = float(np.sum(np.hypot(np.diff(ptsx), np.diff(ptsz))))
    return lift


def relax_corridor(H, groom, talus=0.75, iters=45):
    """settle steps and ledges inside the groomed corridors (thermal erosion limited to the piste mask)"""
    w = np.clip(ndi.gaussian_filter(groom, 3.0) * 1.6, 0.0, 1.0)
    Hn = ot.thermal_erosion(H, iters, talus, 0.5)
    return H + (Hn - H) * w


def plan_pylons(H, lift, clear=7.5, hmax=27.0):
    """cable elevation at every pylon (absolute metres). Pylons start 9.8 m tall (4.6 m at the two stations) and are raised where
    the ground would come closer than `clear` metres to the sagging cable, so no terrain has to be cut away."""
    pts = np.array(lift["points"])
    n = len(pts)
    seg = np.r_[0.0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    g = np.array([ground(H, x, z) for x, z in pts])
    top = g + 9.84
    top[0] = g[0] + 4.6
    top[-1] = g[-1] + 4.6
    for _ in range(60):
        changed = False
        for j in range(n - 1):
            u0, u1 = seg[j], seg[j + 1]
            su = np.arange(u0, u1 + 0.01, 3.0)
            f = (su - u0) / (u1 - u0)
            px = np.interp(su, seg, pts[:, 0])
            pz = np.interp(su, seg, pts[:, 1])
            gy = bilinear(H, px, pz)
            L = math.hypot(u1 - u0, top[j + 1] - top[j])
            cable = top[j] * (1 - f) + top[j + 1] * f - 0.02 * L * 4 * f * (1 - f)
            clr = float((cable - gy).min())
            if clr < clear:
                need = clear - clr
                for k in (j, j + 1):
                    if 0 < k < n - 1 and top[k] - g[k] < hmax:
                        top[k] += need * 0.7
                        changed = True
        if not changed:
            break
    lift["cable"] = [round(float(v), 2) for v in top]
    lift["pylon_heights"] = [round(float(top[i] - g[i]), 1) for i in range(n)]
    return lift


# ============================================================================ scatter
def dist_to_polylines(x, z, lines, upper=200.0):
    best = np.full(x.shape, upper)
    q = np.c_[x, z]
    for xs, zs in lines:
        d, _ = cKDTree(np.c_[xs, zs]).query(q, distance_upper_bound=upper, workers=-1)
        best = np.minimum(best, np.where(np.isfinite(d), d, upper))
    return best


def scatter_forest(H, slope, rock, dpiste, lakemask, sites, lifts, rng):
    step = 5.0
    gx = np.arange(X0 + 8.0, X1 - 8.0, step)
    gz = np.arange(Z0 + 8.0, Z1 - 8.0, step)
    GX, GZ = np.meshgrid(gx, gz)
    x = (GX + rng.uniform(-2.2, 2.2, GX.shape)).ravel()
    z = (GZ + rng.uniform(-2.2, 2.2, GX.shape)).ravel()
    n_forest = spectral_noise(H.shape, DX, 60.0, 260.0, 2.0, rng)
    n_line = spectral_noise(H.shape, DX, 80.0, 700.0, 2.0, rng)
    n_gap = spectral_noise(H.shape, DX, 25.0, 90.0, 1.8, rng)
    y = bilinear(H, x, z)
    sl = bilinear(slope, x, z)
    dd = bilinear(dpiste, x, z)
    nf = bilinear(n_forest, x, z)
    nl = bilinear(n_line, x, z)
    ng = bilinear(n_gap, x, z)
    rk = bilinear(rock, x, z)
    lk = bilinear(lakemask, x, z)
    treeline = 2060.0 + 60.0 * np.tanh(nl)
    f_alt = 1.0 - smoothstep(treeline - 170.0, treeline + 60.0, y)
    f_slope = 1.0 - smoothstep(0.55, 0.95, sl)
    f_dist = smoothstep(4.0, 22.0, dd)
    f_clump = smoothstep(-0.55, 0.65, nf)
    f_gap = smoothstep(-1.3, -0.2, ng)
    f_rock = 1.0 - smoothstep(0.15, 0.5, rk)
    prob = np.clip(0.95 * f_alt * f_slope * f_dist * (0.10 + 0.90 * f_clump) * f_rock * (0.35 + 0.65 * f_gap) * (1 - lk), 0, 1)
    for (sx, sz, r) in sites:
        prob *= smoothstep(r * 0.7, r * 1.15, np.hypot(x - sx, z - sz))
    for lf in lifts:
        pts = np.array(lf["points"])
        prob *= smoothstep(6.0, 12.0, dist_to_polylines(x, z, [(pts[:, 0], pts[:, 1])], 30.0))
    keep = rng.random(x.shape) < prob
    tx, tz, ty = x[keep], z[keep], y[keep]
    tnf = nf[keep]
    n = tx.size
    u = rng.random(n)
    high = smoothstep(1780.0, 2000.0, ty)
    species = np.where(u < 0.5 - 0.25 * high, 0, np.where(u < 0.86 - 0.20 * high, 1, 2))
    species = np.where(rng.random(n) < 0.10 + 0.75 * high, 3, species)
    scale = rng.uniform(0.78, 1.30, n) * np.where(species == 3, 0.9, 1.0) * (1.0 - 0.25 * high) * (0.9 + 0.12 * np.tanh(tnf))
    yaw = rng.uniform(0.0, 2.0 * np.pi, n)
    trees = np.c_[tx, tz, ty, scale, yaw, species].astype(np.float32)
    print(f"trees: {n}")
    return trees


def scatter_rocks(H, slope, rock, dpiste, lakemask, sites, pistes, rng):
    step = 11.0
    gx = np.arange(X0 + 8.0, X1 - 8.0, step)
    gz = np.arange(Z0 + 8.0, Z1 - 8.0, step)
    GX, GZ = np.meshgrid(gx, gz)
    x = (GX + rng.uniform(-4, 4, GX.shape)).ravel()
    z = (GZ + rng.uniform(-4, 4, GX.shape)).ravel()
    sl = bilinear(slope, x, z)
    rk = bilinear(rock, x, z)
    dd = bilinear(dpiste, x, z)
    lk = bilinear(lakemask, x, z)
    y = bilinear(H, x, z)
    p = smoothstep(0.35, 0.85, rk) * 0.10 + smoothstep(0.55, 0.95, sl) * 0.05
    p *= smoothstep(6.0, 20.0, dd) * 0.9 * (1 - lk) * smoothstep(1500.0, 1700.0, y)
    for (sx, sz, r) in sites:
        p *= smoothstep(r * 0.6, r * 1.1, np.hypot(x - sx, z - sz))
    keep = rng.random(x.shape) < p
    rocks = []
    for xi, zi, yi, ki in zip(x[keep], z[keep], y[keep], sl[keep]):
        rocks.append((xi, zi, yi, rng.uniform(0.6, 3.2) * (1.0 + 1.2 * float(ki)), rng.uniform(0, 2 * np.pi), rng.integers(0, 4)))
    # boulders along the piste edges
    for pst in pistes:
        for _ in range(int(pst.length / 55.0)):
            i = rng.integers(20, len(pst.s) - 20)
            side = 1.0 if rng.random() < 0.5 else -1.0
            off = pst.width[i] * 0.5 + rng.uniform(1.5, 14.0)
            xx = pst.x[i] + side * off * pst.rx[i]
            zz = pst.z[i] + side * off * pst.rz[i]
            if bilinear(lakemask, xx, zz) > 0.05:
                continue
            rocks.append((xx, zz, float(bilinear(H, xx, zz)), rng.uniform(0.7, 2.2), rng.uniform(0, 2 * np.pi), rng.integers(0, 4)))
    rocks = np.array(rocks, dtype=np.float32)
    print(f"rocks: {len(rocks)}")
    return rocks


# ============================================================================ village and landmarks
def place_village(H, rng, pistes_lines):
    """flatten the plaza, the lake and every building site. Returns (buildings, lake dict)"""
    vx, vz = VILLAGE
    level = flatten(H, vx, vz, 130.0, 110.0)
    # the frozen lake (a dish of flat ground a little lower than the plaza)
    lake_level = level - 1.2
    c, s_ = math.cos(LAKE["yaw"]), math.sin(LAKE["yaw"])
    flatten(H, LAKE["x"], LAKE["z"], 1.0, 60.0, level=lake_level, ellipse=(c, s_, LAKE["rx"], LAKE["rz"]))
    lake = dict(LAKE, level=lake_level)

    buildings = []

    def site(kind, x, z, yaw, r, blend=16.0):
        y = flatten(H, x, z, r, blend)
        buildings.append(dict(type=kind, x=float(x), z=float(z), yaw=float(yaw), y=float(y), r=float(r)))
        return y

    # lodge in the middle of the plaza, facing the slope (its +z is the front)
    site("lodge", vx + 4.0, vz + 44.0, math.pi, 26.0, 24.0)
    site("alp_hut", vx + 70.0, vz + 18.0, -0.5, 10.0)                              # ski school
    site("chapel", vx - 96.0, vz + 30.0, 0.6, 11.0)
    # two rows of chalets along the valley road
    kinds = ["chalet_a", "chalet_b", "chalet_c"]
    k = 0
    for row, xc in ((-1, vx - 66.0), (1, vx + 78.0)):
        for zc in np.arange(vz - 120.0, vz + 130.0, 34.0):
            x = xc + rng.uniform(-8, 8)
            z = zc + rng.uniform(-6, 6)
            if math.hypot(x - (vx + 4), z - (vz + 44)) < 42:
                continue
            if math.hypot(x - (vx - 96), z - (vz + 30)) < 24 or math.hypot(x - (vx + 70), z - (vz + 18)) < 22:
                continue
            if ((x - LAKE["x"]) / (LAKE["rx"] + 30)) ** 2 + ((z - LAKE["z"]) / (LAKE["rz"] + 30)) ** 2 < 1:
                continue
            yaw = (math.pi / 2 if row < 0 else -math.pi / 2) + rng.uniform(-0.15, 0.15)
            site(kinds[k % 3], x, z, yaw, 9.5, 12.0)
            k += 1
    # a few chalets scattered on the hillside above the village
    for _ in range(9):
        x = vx + rng.uniform(-260, 260)
        z = vz + rng.uniform(-360, -150)
        if ((x - LAKE["x"]) / (LAKE["rx"] + 40)) ** 2 + ((z - LAKE["z"]) / (LAKE["rz"] + 40)) ** 2 < 1:
            continue
        near = min((math.hypot(x - b["x"], z - b["z"]) for b in buildings), default=999)
        if near < 35:
            continue
        sl = float(np.hypot(*[float(v) for v in (bilinear(ndi.sobel(H, axis=1) / (8 * DX), x, z), bilinear(ndi.sobel(H, axis=0) / (8 * DX), x, z))]))
        if sl > 0.28:
            continue
        # keep clear of the piste corridors
        d = dist_to_polylines(np.array([x]), np.array([z]), pistes_lines, 200.0)[0]
        if d < 60:
            continue
        site(kinds[k % 3], x, z, rng.uniform(0, 2 * math.pi), 9.5, 12.0)
        k += 1
    return buildings, lake


def main():
    argv = sys.argv[1:]
    rng = np.random.default_rng(SEED)
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    raw = os.path.join(BUILD, "open_H_raw.npy")
    if "--redo-terrain" in argv or not os.path.exists(raw):
        drops = int(argv[argv.index("--drops") + 1]) if "--drops" in argv else 2_600_000
        r = ot.build_heights(np.random.default_rng(ot.SEED), drops=drops)
        np.save(raw, r["H"])
    H = np.load(raw).astype(np.float64)
    print(f"terrain {H.shape}, {H.min():.0f}..{H.max():.0f} m")

    # ---- sites and lifts (flatten first so the route search sees the final ground)
    hubs = []
    for hx, hz, hr, hb in HUBS:
        cx, cz = snap_flat(H, hx, hz, radius=140.0, sigma=34.0)
        flatten(H, cx, cz, hr, hb)
        hubs.append((cx, cz, hr, hb))
        print(f"hub at ({cx:.0f}, {cz:.0f}) level {ground(H, cx, cz):.0f} m")
    specs = []
    for sp in LIFTS + EXTRA_LIFTS:
        sp = dict(sp)
        for key in ("bottom", "top"):
            if sp["id"] in HUB_LIFTS and HUB_LIFTS[sp["id"]][0] == key:
                off = HUB_LIFTS[sp["id"]][1]
                sp[key] = (hubs[0][0] + off[0], hubs[0][1] + off[1])
            else:
                x, z = sp[key]
                sp[key] = snap_flat(H, x, z, prefer_high=1.0 if key == "top" else 0.0)
        specs.append(sp)
    lifts = [build_lift(sp, H) for sp in specs]
    for lf in lifts:
        for (px, pz) in (lf["points"][0], lf["points"][-1]):
            flatten(H, px, pz, 15.0, 30.0)
    buildings, lake = place_village(H, rng, [])
    H = ndi.gaussian_filter(H, 0.5)

    # ---- routes
    router = Router(H)
    c, s_ = math.cos(LAKE["yaw"]), math.sin(LAKE["yaw"])
    xs = X0 + np.arange(router.nx) * router.cell
    zs = Z0 + np.arange(router.ny) * router.cell
    XC, ZC = np.meshgrid(xs, zs)
    u = (XC - LAKE["x"]) * c + (ZC - LAKE["z"]) * s_
    v = -(XC - LAKE["x"]) * s_ + (ZC - LAKE["z"]) * c
    router.blocked = (np.hypot(u / (LAKE["rx"] + 25), v / (LAKE["rz"] + 25)) < 1.0)
    for b in buildings:
        router.blocked |= (np.hypot(XC - b["x"], ZC - b["z"]) < b["r"] + 6.0)
    pistes = []
    stations = station_points(lifts)
    for spec in PISTES:
        L = LEVELS[spec["level"]]
        spec = dict(spec, via=[stations[v] if isinstance(v, str) else v for v in spec["via"]])
        pts = router.route(spec["via"], L["lo"], L["hi"])
        p = Piste(spec, pts, H, rng)
        router.claim(np.c_[p.x, p.z], free=[spec["via"][0], spec["via"][-1]] + [v for v in spec["via"][1:-1]])
        print(f"  piste {p.id:11s} {p.level:5s} {p.length:6.0f} m, drop {p.y[0] - p.y[-1]:5.0f} m, "
              f"pitch avg {np.degrees(np.arctan((p.y[0] - p.y[-1]) / p.length)):4.1f} deg, max {np.percentile(p.pitch, 98):4.1f}")
        pistes.append(p)
    H, groom = carve_pistes(H, pistes)
    H = relax_corridor(H, groom)
    # lifts run beside the pistes they serve
    for lf in lifts:
        pid = LIFT_FOLLOW.get(lf["id"])
        pst = next((p for p in pistes if p.id == pid), None)
        if pst is not None:
            lift_from_piste(lf, pst, H)
    # a small terrain park on the Sonnenalp piste
    sonne = next(p for p in pistes if p.id == "sonne")
    kick = [(180.0, 9.0, 1.6, 12.0, 4.0), (300.0, -9.0, 2.4, 14.0, 4.5), (430.0, 9.0, 3.2, 16.0, 5.0), (560.0, -9.0, 2.0, 13.0, 4.5),
            (690.0, 9.0, 2.8, 15.0, 5.0), (800.0, -9.0, 3.6, 17.0, 5.5)]
    H = add_kickers(H, sonne, [(s0, o, h, r, w) for (s0, o, h, r, w) in kick if s0 < sonne.length - 60])
    H = ndi.gaussian_filter(H, 0.35)
    for lf in lifts:
        plan_pylons(H, lf)

    gx, gz = grad(H)
    slope = np.hypot(gx, gz).astype(np.float32)

    # ---- derived maps for scatter and the map textures
    lines = [(p.x, p.z) for p in pistes]
    tree_p = cKDTree(np.concatenate([np.c_[p.x, p.z] for p in pistes]))
    hw_all = np.concatenate([p.width * 0.5 for p in pistes])
    X, Z = ot.grid()
    q = np.c_[X.ravel(), Z.ravel()]
    dd, ii = tree_p.query(q, distance_upper_bound=300.0, workers=-1)
    dd = np.where(np.isfinite(dd), dd, 300.0)
    dpiste = np.maximum(dd - hw_all[np.where(np.isfinite(dd), ii, 0) % len(hw_all)] * 0 - 0.0, 0)
    dpiste = (dd.reshape(H.shape) - 20.0).astype(np.float32)               # distance from the piste edge (approx.)
    ang = np.degrees(np.arctan(slope))
    alt_r = smoothstep(2000.0, 2600.0, H)
    n_rock = spectral_noise(H.shape, DX, 8.0, 60.0, 1.6, rng)
    rock = smoothstep(0.62 - 0.22 * alt_r, 1.0 - 0.22 * alt_r, slope + 0.10 * n_rock) * (1 - groom)
    rock = np.clip(rock, 0, 1).astype(np.float32)
    c2, s2 = math.cos(lake["yaw"]), math.sin(lake["yaw"])
    lu = (X - lake["x"]) * c2 + (Z - lake["z"]) * s2
    lv = -(X - lake["x"]) * s2 + (Z - lake["z"]) * c2
    lakemask = (1.0 - smoothstep(0.85, 1.15, np.hypot(lu / lake["rx"], lv / lake["rz"]))).astype(np.float32)

    sites = [(b["x"], b["z"], b["r"] + 9.0) for b in buildings]
    for lf in lifts:
        sites.append((lf["points"][0][0], lf["points"][0][1], 22.0))
        sites.append((lf["points"][-1][0], lf["points"][-1][1], 22.0))
    trees = scatter_forest(H, slope, rock, dpiste, lakemask, sites, lifts, rng)
    rocks = scatter_rocks(H, slope, rock, dpiste, lakemask, sites, pistes, rng)

    # ---- reachability, flags, landmarks
    router2 = Router(H)
    tops = [lf["points"][-1] for lf in lifts]
    reach = router2.reachable(tops)
    flags, landmarks = make_flags_and_landmarks(H, slope, rock, reach, router2, pistes, lifts, buildings, lake, trees, rng)

    # ---- outputs
    poles = make_poles(H, pistes)
    save_outputs(H, groom, slope, rock, trees, rocks, poles, pistes, lifts, buildings, lake, flags, landmarks, lakemask, dpiste)
    if "--no-preview" not in argv:
        preview(H, pistes, lifts, buildings, flags, landmarks, lake)


# ============================================================================ flags & landmarks
def make_flags_and_landmarks(H, slope, rock, reach, router, pistes, lifts, buildings, lake, trees, rng):
    nfl = 24
    # candidate cells: reachable, not too steep, not in the forest, away from buildings, above the village
    cell = router.cell
    xs = X0 + np.arange(router.nx) * cell
    zs = Z0 + np.arange(router.ny) * cell
    XC, ZC = np.meshgrid(xs, zs)
    Hc = router.Hc
    ok = reach & (router.slope < 30.0) & (Hc > 1450.0)
    tpos = np.c_[trees[:, 0], trees[:, 1]]
    tt = cKDTree(tpos)
    cand = np.c_[XC[ok], ZC[ok]]
    print('flag candidates: reachable+gentle', len(cand), 'reach cells', int(reach.sum()), 'ok cells', int(ok.sum()))
    dens = np.array([len(v) for v in tt.query_ball_point(cand, 26.0)])
    cand = cand[dens <= 1]
    print('  after tree filter', len(cand))
    # a flag stands on snow you can actually stop on: gentle ground (also in the neighbourhood) and no rock face
    fine_max = ndi.maximum_filter(slope, size=7)
    good = (bilinear(slope, cand[:, 0], cand[:, 1]) < 0.50) & (bilinear(fine_max, cand[:, 0], cand[:, 1]) < 0.68) & (bilinear(rock, cand[:, 0], cand[:, 1]) < 0.30)
    cand = cand[good]
    print('  after slope/rock filter', len(cand))
    for b in buildings:
        cand = cand[np.hypot(cand[:, 0] - b["x"], cand[:, 1] - b["z"]) > 60]
    lakem = ((cand[:, 0] - lake["x"]) / (lake["rx"] + 30)) ** 2 + ((cand[:, 1] - lake["z"]) / (lake["rz"] + 30)) ** 2 > 1
    cand = cand[lakem]
    cy = bilinear(H, cand[:, 0], cand[:, 1])
    print('  after buildings/lake', len(cand), 'height bands', [int(((cy > lo) & (cy < hi)).sum()) for lo, hi in [(1450, 1750), (1750, 2050), (2050, 2350), (2350, 3200)]])
    # points along the pistes
    flags = []
    picks = []

    def far_enough(p, dmin):
        return all(math.hypot(p[0] - q[0], p[1] - q[1]) > dmin for q in picks)

    # 6 on pistes (spread over the network), the rest off piste, spread over altitude bands
    order = rng.permutation(len(pistes))
    for k in range(6):
        pst = pistes[order[k % len(pistes)]]
        for _ in range(30):
            i = int(rng.uniform(0.2, 0.85) * len(pst.s))
            p = (pst.x[i] + pst.rx[i] * rng.uniform(-6, 6), pst.z[i] + pst.rz[i] * rng.uniform(-6, 6))
            if far_enough(p, 300):
                picks.append(p)
                break
    tries = 0
    spacing = 300.0
    while len(picks) < nfl and tries < 6000:
        tries += 1
        if tries % 1500 == 0:
            spacing *= 0.75                                   # thin bands get closer flags rather than none
        band = tries % 4
        lo, hi = [(1450, 1750), (1750, 2050), (2050, 2350), (2350, 3200)][band]
        m = (cy > lo) & (cy < hi)
        if not m.any():
            continue
        p = tuple(cand[np.nonzero(m)[0][rng.integers(0, m.sum())]])
        if far_enough(p, spacing):
            picks.append(p)
    for (x, z) in picks:
        flags.append(dict(x=float(x), z=float(z), y=float(ground(H, x, z))))
    # landmarks
    def bl(kind):
        return next(b for b in buildings if b["type"] == kind)

    lm = []

    def add(id_, name, text, x, z, radius=45.0):
        lm.append(dict(id=id_, name=name, text=text, x=float(x), z=float(z), y=float(ground(H, x, z)), radius=radius))

    chap = bl("chapel")
    add("chapel", "Chapel of St. Anna", "Built in 1743 by the first families of the valley.", chap["x"], chap["z"], 40)
    add("lake", "Lago Bianco", "The village lake, frozen solid from November to April.", lake["x"], lake["z"], max(lake["rx"] * 0.6, 60))
    mid = lifts[0]["points"][-1]
    add("alm", "Almhütte", "The mid station hut: soup, strudel and the best view of the valley.", mid[0], mid[1], 55)
    kes = lifts[1]["points"][-1]
    add("kessel", "The Kessel", "A natural amphitheatre where three valleys meet.", kes[0], kes[1], 70)
    top = lifts[2]["points"][-1]
    add("eisfeld", "Eisfeld Station", "The highest chairlift in the valley, at the foot of the Kronhorn.", top[0], top[1], 55)
    # the highest reachable point
    hc = np.where(reach & (router.slope < 34), Hc, -1)
    j, i = np.unravel_index(np.argmax(hc), hc.shape)
    add("summit", "Gipfelkreuz", f"The summit cross at {hc[j, i]:.0f} m: the roof of the ski area.", xs[i], zs[j], 60)
    # a viewpoint on the north-east ridge, an old cabin in the west forest, the kicker park and a quiet bowl
    def best(region, want_high=True):
        m = reach & (router.slope < 26) & region
        if not m.any():
            return None
        v = np.where(m, Hc if want_high else -Hc, -1e9)
        j, i = np.unravel_index(np.argmax(v), v.shape)
        return xs[i], zs[j]

    p = best((XC > 300) & (ZC < -300))
    if p:
        add("eyrie", "Adler's Eyrie", "Eagles nest on the cliffs below this ridge shoulder.", p[0], p[1], 70)
    west = [t for t in trees if t[0] < -650 and 1700 < t[2] < 1850]
    if west:
        t = west[len(west) // 2]
        add("cabin", "Wolf's Den", "An old woodcutters' cabin, roof caved in under the snow.", t[0] + 14, t[1] + 6, 50)
    sonne = next(p for p in pistes if p.id == "sonne")
    i = int(np.argmin(np.abs(sonne.s - 450)))
    add("park", "Sonnenalp Park", "Six kickers of growing size beside the piste.", sonne.x[i], sonne.z[i], 90)
    p = best((XC < -500) & (ZC < -600), True)
    if p:
        add("bowl", "Nebel Bowl", "A hidden bowl of untouched powder above the mist.", p[0], p[1], 80)
    print(f"flags {len(flags)}, landmarks {len(lm)}")
    return flags, lm


def make_poles(H, pistes):
    poles = []
    for p in pistes:
        lvl = LEVELS[p.level]["idx"]
        for s in np.arange(14.0, p.s[-1] - 20.0, 30.0):
            i = int(s / 2.0)
            for side in (-1.0, 1.0):
                off = side * (p.width[i] * 0.5 - 0.8)
                x = p.x[i] + off * p.rx[i]
                z = p.z[i] + off * p.rz[i]
                poles.append((x, z, float(bilinear(H, x, z)), lvl))
    return np.array(poles, dtype=np.float32)


# ============================================================================ output
def encode_heights(q):
    """uint16 heights -> zigzag coded residuals of the 2-D predictor (left + above - above-left); ski/js/world-data.js decodes it"""
    pred = np.zeros_like(q)
    pred[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    pred[0, 1:] = q[0, :-1]
    pred[1:, 0] = q[:-1, 0]
    r = q - pred
    return ((r << 1) ^ (r >> 31)).astype("<u2")


def save_outputs(H, groom, slope, rock, trees, rocks, poles, pistes, lifts, buildings, lake, flags, landmarks, lakemask, dpiste):
    np.savez_compressed(os.path.join(BUILD, "open.npz"), H=H.astype(np.float32), groom=groom.astype(np.float32),
                        slope=slope, rock=rock, trees=trees, rocks=rocks, lake=lakemask, dpiste=dpiste)
    q = np.clip(np.round((H - H_MIN) * H_QUANT), 0, 65535).astype(np.int32)
    encode_heights(q).tofile(os.path.join(OUT, "heightmap.pz"))
    old_raw = os.path.join(OUT, "heightmap.u16")
    if os.path.exists(old_raw):
        os.remove(old_raw)
    (np.clip(groom, 0, 1) * 255 + 0.5).astype(np.uint8).tofile(os.path.join(OUT, "groom.u8"))
    trees.astype("<f4").tofile(os.path.join(OUT, "trees.f32"))
    rocks.astype("<f4").tofile(os.path.join(OUT, "rocks.f32"))
    poles.astype("<f4").tofile(os.path.join(OUT, "poles.f32"))
    step = 4
    sel = slice(0, None, step // 2)
    pjson = []
    for p in pistes:
        s = p.s[sel]
        data = np.c_[s, p.x[sel], p.y[sel], p.z[sel], p.tx[sel], p.tz[sel], p.width[sel], p.cross[sel], p.curv[sel], p.pitch[sel]]
        pjson.append(dict(id=p.id, name=p.name, level=p.level, colour=p.colour, length=round(p.length, 1),
                          drop=round(float(p.y[0] - p.y[-1]), 1),
                          path=dict(step=float(step), columns=["s", "x", "y", "z", "tx", "tz", "width", "bank", "curv", "pitch"],
                                    data=[[round(float(v), 3) for v in row] for row in data])))
    ljson = []
    for lf in lifts:
        pts = lf["points"]
        ys = [ground(H, x, z) for x, z in pts]
        ljson.append(dict(id=lf["id"], name=lf["name"], speed=lf["speed"], length=round(lf["length"], 1),
                          rise=round(ys[-1] - ys[0], 1), points=[[round(x, 2), round(z, 2)] for x, z in pts],
                          cable=lf.get("cable"), ground=[round(float(y), 2) for y in ys]))
    sd = sun_direction()
    village = dict(x=VILLAGE[0], z=VILLAGE[1], y=ground(H, *VILLAGE))
    b0 = ljson[0]["points"][0]
    spawn = dict(x=b0[0] + 14.0, z=b0[1] + 18.0, yaw=math.atan2(0.0, 1.0))
    info = dict(
        version=2, kind="open",
        grid=dict(nx=N, nz=N, dx=DX, x0=X0, z0=Z0, hMin=H_MIN, hQuant=H_QUANT),
        sun=dict(azimuthDeg=SUN_AZIMUTH_DEG, elevationDeg=SUN_ELEVATION_DEG, dir=[float(v) for v in sd]),
        pistes=pjson, lifts=ljson, buildings=buildings, lake=lake, flags=flags, landmarks=landmarks,
        village=village, spawn=spawn, runs=[],
        counts=dict(trees=int(len(trees)), rocks=int(len(rocks)), poles=int(len(poles))),
    )
    with open(os.path.join(OUT, "world.json"), "w") as f:
        json.dump(info, f, separators=(",", ":"))
    print("wrote", OUT)


def preview(H, pistes, lifts, buildings, flags, landmarks, lake):
    from PIL import Image, ImageDraw
    sh = ot.hillshade(ndi.gaussian_filter(H, 1.0))
    gx, gz = grad(H)
    ang = np.degrees(np.arctan(ndi.gaussian_filter(np.hypot(gx, gz), 1.2)))
    col = np.zeros(H.shape + (3,), np.float32)
    col[:] = [0.86, 0.90, 0.95]
    col[ang > 18] = [0.78, 0.86, 0.72]
    col[ang > 27] = [0.95, 0.86, 0.55]
    col[ang > 36] = [0.90, 0.58, 0.38]
    col[ang > 45] = [0.50, 0.32, 0.32]
    img = col * (0.35 + 0.75 * sh[..., None])
    S = 1024
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((S, S))
    d = ImageDraw.Draw(im)

    def px(x, z):
        return ((x - X0) / (X1 - X0) * S, (z - Z0) / (Z1 - Z0) * S)

    cols = {"green": (30, 170, 60), "blue": (30, 90, 255), "red": (230, 40, 30), "black": (10, 10, 10)}
    for p in pistes:
        d.line([px(x, z) for x, z in zip(p.x[::5], p.z[::5])], fill=cols[p.level], width=3)
        d.text(px(p.x[len(p.x) // 2], p.z[len(p.z) // 2]), p.name, fill=(0, 0, 0))
    for lf in lifts:
        pts = lf["points"]
        d.line([px(*pts[0]), px(*pts[-1])], fill=(255, 0, 255), width=2)
        d.text(px(*pts[-1]), lf["name"], fill=(140, 0, 140))
    for b in buildings:
        x, z = px(b["x"], b["z"])
        d.rectangle([x - 2, z - 2, x + 2, z + 2], fill=(120, 60, 0))
    for f in flags:
        x, z = px(f["x"], f["z"])
        d.ellipse([x - 4, z - 4, x + 4, z + 4], outline=(255, 0, 0), width=2)
    for l in landmarks:
        x, z = px(l["x"], l["z"])
        d.rectangle([x - 4, z - 4, x + 4, z + 4], outline=(0, 120, 0), width=2)
        d.text((x + 5, z - 5), l["name"], fill=(0, 90, 0))
    im.save(os.path.join(BUILD, "open_overview.png"))
    print("preview written")


if __name__ == "__main__":
    main()
