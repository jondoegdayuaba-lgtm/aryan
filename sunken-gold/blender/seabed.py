"""The dive site: seabed height field, material splat map, ambient occlusion
baked with Cycles, and the placement of every coral, rock, creature spawn,
treasure and relic. Writes terrain.bin, splat.png, ao.jpg and world.json.

Everything here is in three.js world space: x east, y up, z south, metres,
sea surface at y = 0."""
import json
import math
import os

import bpy
import numpy as np

from common import OUT, TEX, save_image

SIZE = 640.0
N = 513            # height samples per side (mesh resolution 1.25 m)
FINE = 1025        # splat/AO resolution
SEED = 7

BOAT = (0.0, 0.0)
WRECK = dict(x=-26.0, z=-112.0, yaw=0.62, roll=0.2, sink=1.5)
ARCH = dict(x=128.0, z=-14.0, yaw=0.35)
KELP = (-140.0, 48.0, 62.0)          # centre x, z, radius
MEADOW = (42.0, 150.0, 70.0)
TRENCH_DEPTH = -66.0


# ---------------------------------------------------------------- noise

class Perlin:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        self.p = np.concatenate([rng.permutation(256)] * 2)
        a = rng.uniform(0, math.tau, 256)
        self.g = np.stack([np.cos(a), np.sin(a)], 1)

    def __call__(self, x, y):
        xi = np.floor(x).astype(int)
        yi = np.floor(y).astype(int)
        xf, yf = x - xi, y - yi
        xi &= 255
        yi &= 255
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)

        def dot(ix, iy, dx, dy):
            g = self.g[self.p[self.p[ix] + iy] & 255]
            return g[..., 0] * dx + g[..., 1] * dy
        n00 = dot(xi, yi, xf, yf)
        n10 = dot(xi + 1, yi, xf - 1, yf)
        n01 = dot(xi, yi + 1, xf, yf - 1)
        n11 = dot(xi + 1, yi + 1, xf - 1, yf - 1)
        return (n00 + u * (n10 - n00)) + v * ((n01 + u * (n11 - n01)) - (n00 + u * (n10 - n00)))


_P = [Perlin(SEED + i) for i in range(6)]


def fbm(x, z, scale, octaves=4, k=0, gain=0.5):
    total, amp, freq, norm = 0.0, 1.0, 1.0 / scale, 0.0
    for o in range(octaves):
        total = total + amp * _P[(k + o) % 6](x * freq + 17.3 * o, z * freq - 9.1 * o)
        norm += amp
        amp *= gain
        freq *= 2.03
    return total / norm * 1.6


def ridged(x, z, scale, octaves=4, k=0):
    return 1 - np.abs(fbm(x, z, scale, octaves, k))


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- layout

def bommies(rng):
    out = []
    while len(out) < 46:
        x, z = rng.uniform(-95, 95), rng.uniform(-55, 70)
        if math.hypot(x, z) < 9 or math.hypot(x, z) > 100:
            continue
        if any(math.hypot(x - b[0], z - b[1]) < 12 for b in out):
            continue
        out.append((x, z, rng.uniform(2.0, 4.6), rng.uniform(3.5, 7.5)))
    return out


def trench_center(x):
    return -238.0 + 18 * np.sin(x / 70.0) + 6 * np.sin(x / 23.0 + 1)


def wall_edge(x):
    return -64.0 + 9 * fbm(x, np.zeros_like(x) + 3.0, 60, 3, 4)


def height(x, z, bom):
    r = np.hypot(x, z)
    h = -9.0 + 1.1 * fbm(x, z, 45, 4, 0) + 0.35 * fbm(x, z, 9, 3, 1)
    # Gentle slope down to the south flats.
    h -= 6.5 * sstep(35, 190, z)
    # Spur-and-groove ridges running out to the drop-off.
    ze = wall_edge(x)
    near_wall = sstep(ze + 38, ze + 4, z) * sstep(ze - 2, ze + 4, z)
    h += 1.6 * np.maximum(0, np.sin(x / 6.2 + 2.2 * fbm(x, z, 30, 2, 2))) * near_wall
    # Coral heads on the plateau.
    for bx, bz, bh, br in bom:
        d = np.hypot(x - bx, z - bz) / br
        n = 1 + 0.25 * fbm(x, z, 3, 2, 3)
        h += bh * np.clip(1 - d * d * n, 0, 1) ** 1.5
    # The reef wall: a steep drop to the sand plain at about -30 m, with a ledge.
    t_wall = sstep(ze, ze - 13, z)
    ledge = 0.5 * sstep(ze - 4, ze - 6, z) * sstep(ze - 11, ze - 8, z)
    plain = -30.0 + 1.2 * fbm(x, z, 40, 3, 4) - 6.0 * sstep(-170, -205, z)
    h = mix(h, plain, np.clip(t_wall - ledge * 0.2, 0, 1))
    h += 2.5 * fbm(x, z, 5, 2, 5) * t_wall * (1 - t_wall) * 4
    # Wreck site: a flat, slightly scoured patch of sand.
    dw = np.hypot(x - WRECK['x'], z - WRECK['z'])
    h = mix(h, -30.6 + 0.3 * fbm(x, z, 8, 2, 1), sstep(34, 18, dw))
    # The trench.
    zt = trench_center(x)
    wi = 13 + 4 * fbm(x, z * 0 + 50, 40, 2, 2)
    dt = np.abs(z - zt)
    floor = TRENCH_DEPTH + 2.0 * fbm(x, z, 14, 3, 3)
    t_tr = sstep(wi + 15, wi, dt)
    h = mix(h, floor, t_tr ** 1.3)
    h += 3.0 * ridged(x, z, 9, 3, 1) * t_tr * (1 - t_tr) * 3
    beyond = sstep(zt - 10, zt - 40, z)
    h = mix(h, -44 + 2 * fbm(x, z, 30, 3, 5), beyond * (1 - t_tr))
    # Arch site: a broad, gentle hollow (no hard rim) so the arch stands clear.
    da = np.hypot(x - ARCH['x'], z - ARCH['z'])
    h -= 6.0 * sstep(70, 5, da) ** 1.5
    # Kelp forest: a wide rocky basin that eases in over a long distance.
    dk = np.hypot(x - KELP[0], z - KELP[1])
    basin = sstep(KELP[2] + 60, KELP[2] - 30, dk)
    h += basin * (-9.0 + 2.4 * (ridged(x, z, 14, 4, 3) - 0.5) + 1.2 * fbm(x, z, 30, 3, 0))
    # Sand mega-ripples on the open sand.
    sandy = sstep(40, 90, z) + sstep(-80, -95, z) * (1 - sstep(-195, -175, z))
    h += 0.45 * np.sin((x * 0.35 + z) / 7.0 + 2.5 * fbm(x, z, 60, 2, 3)) * np.clip(sandy, 0, 1)
    # Seagrass meadow: smooth sand.
    dm = np.hypot(x - MEADOW[0], z - MEADOW[1])
    h = mix(h, -14.5 + 0.5 * fbm(x, z, 30, 2, 1), sstep(MEADOW[2] + 20, MEADOW[2] - 20, dm) * 0.8)
    # Open ocean beyond the edge of the site.
    h = mix(h, -90.0, sstep(255, 315, r))
    return np.minimum(h, -3.5)


def grid(n):
    c = np.linspace(-SIZE / 2, SIZE / 2, n)
    X, Z = np.meshgrid(c, c)          # row = z, col = x
    return X, Z


# ---------------------------------------------------------------- sampling helpers

class Field:
    def __init__(self, H):
        self.H = H
        self.n = H.shape[0]
        self.cell = SIZE / (self.n - 1)

    def at(self, x, z):
        fx = (x + SIZE / 2) / self.cell
        fz = (z + SIZE / 2) / self.cell
        i = int(np.clip(np.floor(fx), 0, self.n - 2))
        j = int(np.clip(np.floor(fz), 0, self.n - 2))
        u, v = fx - i, fz - j
        H = self.H
        return float(H[j, i] * (1 - u) * (1 - v) + H[j, i + 1] * u * (1 - v) + H[j + 1, i] * (1 - u) * v + H[j + 1, i + 1] * u * v)

    def slope(self, x, z, e=1.0):
        dx = (self.at(x + e, z) - self.at(x - e, z)) / (2 * e)
        dz = (self.at(x, z + e) - self.at(x, z - e)) / (2 * e)
        return math.hypot(dx, dz)


def scatter(rng, count, accept, spacing=0.0, tries=60000, placed=None):
    out = []
    placed = placed if placed is not None else []
    for _ in range(tries):
        if len(out) >= count:
            break
        x, z = rng.uniform(-300, 300), rng.uniform(-300, 300)
        if not accept(x, z):
            continue
        if spacing and any((x - p[0]) ** 2 + (z - p[1]) ** 2 < spacing * spacing for p in placed[-400:]):
            continue
        out.append((x, z))
        placed.append((x, z))
    return out


def near(x, z, cx, cz, r):
    return (x - cx) ** 2 + (z - cz) ** 2 < r * r


def wreck_quat():
    """Rotation of the wreck as a quaternion (x, y, z, w): roll about its own
    long axis (three's local Z) then yaw about world Y."""
    cy, sy = math.cos(WRECK['yaw'] / 2), math.sin(WRECK['yaw'] / 2)
    cr, sr = math.cos(WRECK['roll'] / 2), math.sin(WRECK['roll'] / 2)
    # q = qYaw * qRoll
    qy = np.array([0, sy, 0, cy])
    qr = np.array([0, 0, sr, cr])

    def mul(a, b):
        ax, ay, az, aw = a
        bx, by, bz, bw = b
        return np.array([aw * bx + ax * bw + ay * bz - az * by,
                         aw * by - ax * bz + ay * bw + az * bx,
                         aw * bz + ax * by - ay * bx + az * bw,
                         aw * bw - ax * bx - ay * by - az * bz])
    return mul(qy, qr)


def rotate(q, v):
    x, y, z, w = q
    u = np.array([x, y, z])
    v = np.asarray(v, float)
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def blender_to_three(p):
    return np.array([p[0], p[2], -p[1]])


# ---------------------------------------------------------------- build

def build(models):
    rng = np.random.default_rng(SEED)
    bom = bommies(rng)
    print('Seabed: height field')
    Xf, Zf = grid(FINE)
    Hf = height(Xf, Zf, bom)
    H = Hf[::2, ::2].copy()                       # 513 x 513 mesh heights
    field = Field(H)

    # ---- material splat (R sand, G rubble, B rock, A silt) on the fine grid
    gz, gx = np.gradient(Hf, SIZE / (FINE - 1))
    slope = np.hypot(gx, gz)
    rock = sstep(0.5, 0.95, slope)
    dk = np.hypot(Xf - KELP[0], Zf - KELP[1])
    rock = np.maximum(rock, sstep(KELP[2] + 20, KELP[2] - 20, dk) * sstep(0.45, 0.75, ridged(Xf, Zf, 14, 4, 3)))
    reef = sstep(-15, -11, Hf) * sstep(115, 85, np.hypot(Xf, Zf)) * sstep(75, 50, Zf)
    patches = sstep(-0.25, 0.25, fbm(Xf, Zf, 18, 3, 2))
    rubble = reef * patches * (1 - rock)
    for bx, bz, bh, br in bom:
        d = np.hypot(Xf - bx, Zf - bz)
        rubble = np.maximum(rubble, sstep(br * 1.8, br * 0.9, d) * (1 - rock))
        rock = np.maximum(rock, sstep(br * 0.75, br * 0.35, d) * 0.35)
    silt = sstep(-42, -55, Hf) * (1 - rock * 0.6)
    sand = np.clip(1 - rock - rubble - silt, 0, 1)
    tot = sand + rubble + rock + silt + 1e-6
    splat = np.stack([sand, rubble, rock, silt], -1) / tot[..., None]
    # Row 0 (z = -SIZE/2, north) is written as the bottom image row, which is v = 0
    # for three.js with its default flipY, so the game samples v = (z + SIZE/2) / SIZE.
    save_image(os.path.join(TEX, 'splat.png'), splat)

    # ---- placements
    print('Seabed: placements')
    placed = []
    P = {}
    on_reef = lambda x, z: field.at(x, z) > -15.5 and math.hypot(x, z) < 108 and z > -62 and z < 72 and math.hypot(x, z) > 7
    def near_bommie():
        # Corals crowd onto and around the coral heads, leaving sand channels between.
        bx, bz, bh, br = bom[int(rng.integers(len(bom)))]
        a, r = rng.uniform(0, math.tau), br * math.sqrt(rng.uniform(0, 1)) * 1.7
        return bx + math.cos(a) * r, bz + math.sin(a) * r

    def scatter_reef(count, slope_max, spacing, share=0.65):
        out = []
        for _ in range(count * 40):
            if len(out) >= count:
                break
            on_head = rng.random() < share
            x, z = near_bommie() if on_head else (rng.uniform(-110, 110), rng.uniform(-62, 72))
            # Coral heads are steep, but that's exactly where coral grows.
            if not on_reef(x, z) or field.slope(x, z) > (slope_max + 0.9 if on_head else slope_max):
                continue
            if any((x - p[0]) ** 2 + (z - p[1]) ** 2 < spacing * spacing for p in placed[-300:]):
                continue
            out.append((x, z))
            placed.append((x, z))
        return out
    P['brain'] = scatter_reef(260, 0.7, 2.0)
    P['branch'] = scatter_reef(520, 0.8, 1.6)
    P['table'] = scatter_reef(90, 0.5, 3.2)
    wall_band = lambda x, z: (wall_edge(np.array([x]))[0] - 16 < z < wall_edge(np.array([x]))[0] + 3) and abs(x) < 240
    P['fan'] = scatter(rng, 110, lambda x, z: wall_band(x, z), 2.5, placed=placed) + scatter_reef(70, 0.8, 2.0, 0.8)
    P['tube'] = scatter(rng, 110, lambda x, z: wall_band(x, z) or near(x, z, WRECK['x'], WRECK['z'], 45) or
                        (field.at(x, z) < -40 and field.at(x, z) > -60 and rng.random() < 0.25), 3.0, placed=placed)
    P['barrel'] = scatter(rng, 40, lambda x, z: wall_band(x, z) and field.at(x, z) < -20 or
                          (abs(z - trench_center(np.array([x]))[0]) < 32 and field.at(x, z) > -60 and rng.random() < 0.3), 5.0, placed=placed)
    P['anemone'] = scatter(rng, 14, lambda x, z: on_reef(x, z) and math.hypot(x, z) < 70 and field.slope(x, z) < 0.35, 12.0, placed=[])
    P['tube'] += scatter_reef(70, 0.9, 2.0, 0.7)
    P['grass'] = scatter(rng, 2600, lambda x, z: near(x, z, MEADOW[0], MEADOW[1], MEADOW[2] + rng.uniform(-15, 15)) or
                         (field.at(x, z) < -12 and field.at(x, z) > -17 and z > 30 and rng.random() < 0.08), 0.0, tries=200000)
    P['kelp'] = scatter(rng, 170, lambda x, z: near(x, z, KELP[0], KELP[1], KELP[2] + rng.uniform(-10, 10)), 3.2, placed=placed)
    P['boulder'] = (scatter(rng, 40, lambda x, z: near(x, z, KELP[0], KELP[1], KELP[2] + 8), 6, placed=placed) +
                    scatter(rng, 26, lambda x, z: near(x, z, ARCH['x'], ARCH['z'], 45) and not near(x, z, ARCH['x'], ARCH['z'], 14), 7, placed=placed) +
                    scatter(rng, 30, lambda x, z: abs(z - trench_center(np.array([x]))[0]) < 34 and abs(z - trench_center(np.array([x]))[0]) > 14 and abs(x) < 250, 9, placed=placed) +
                    scatter(rng, 18, lambda x, z: wall_band(x, z), 9, placed=placed))
    for k in ('brain', 'branch', 'table', 'fan', 'tube', 'barrel', 'anemone', 'grass', 'kelp', 'boulder'):
        print(f'  {k}: {len(P[k])}')

    def inst(points, variants, smin, smax):
        return [[round(x, 2), round(z, 2), round(float(rng.uniform(0, math.tau)), 3), round(float(rng.uniform(smin, smax)), 3),
                 int(rng.integers(0, variants))] for x, z in points]

    scenery = {
        'brain': inst(P['brain'], 2, 0.5, 1.6), 'branch': inst(P['branch'], 3, 0.8, 1.7), 'table': inst(P['table'], 2, 0.7, 1.6),
        'fan': inst(P['fan'], 2, 0.6, 1.3), 'tube': inst(P['tube'], 2, 0.7, 1.5), 'barrel': inst(P['barrel'], 1, 0.8, 1.5),
        'anemone': inst(P['anemone'], 1, 1.0, 1.6), 'grass': inst(P['grass'], 2, 0.7, 1.4),
        'kelp': inst(P['kelp'], 2, 0.75, 1.2), 'boulder': inst(P['boulder'], 4, 1.4, 4.2),
    }

    # ---- the wreck and its debris field
    q = wreck_quat()
    wy = field.at(WRECK['x'], WRECK['z']) - WRECK['sink']
    wpos = np.array([WRECK['x'], wy, WRECK['z']])

    def wreck_point(bx, by, bz):
        return (wpos + rotate(q, blender_to_three((bx, by, bz)))).round(2).tolist()
    debris = []
    for name, (bx, by, yaw) in (('mast_fallen', (9.0, -3.0, 1.9)), ('anchor', (-6.0, 18.0, 0.4)), ('cannon', (8.0, 6.0, 0.9)),
                                ('cannon', (-7.5, -4.0, 2.4)), ('cannon', (10.5, -9.0, 4.0)), ('barrel', (7.0, 2.0, 0.0)),
                                ('barrel', (-6.5, 9.0, 1.0)), ('barrel', (11.0, 12.0, 2.0)), ('barrel', (5.5, -12.0, 0.4))):
        p = wpos + rotate(np.array([0, math.sin(WRECK['yaw'] / 2), 0, math.cos(WRECK['yaw'] / 2)]), blender_to_three((bx, by, 0)))
        debris.append({'model': name, 'x': round(float(p[0]), 2), 'z': round(float(p[2]), 2), 'yaw': round(WRECK['yaw'] + yaw, 3),
                       'tilt': name in ('barrel', 'anchor')})

    # ---- treasure
    def ground(x, z, lift=0.0):
        return [round(x, 2), round(field.at(x, z) + lift, 2), round(z, 2)]

    coins = []
    for count, accept in ((14, lambda x, z: near(x, z, WRECK['x'], WRECK['z'], 26)),
                          (20, lambda x, z: on_reef(x, z)),
                          (8, lambda x, z: near(x, z, KELP[0], KELP[1], KELP[2])),
                          (6, lambda x, z: near(x, z, ARCH['x'], ARCH['z'], 30)),
                          (7, lambda x, z: abs(z - trench_center(np.array([x]))[0]) < 10 and abs(x) < 220),
                          (5, lambda x, z: near(x, z, MEADOW[0], MEADOW[1], MEADOW[2]))):
        for x, z in scatter(rng, count, accept, 10.0):
            coins.append(ground(x, z) + [int(rng.integers(5, 13))])
    # Coins spilled inside the hold and cabin.
    for bx, by, bz in ((0.8, -2.5, 1.7), (-1.2, 1.5, 1.7), (0.4, 5.0, 2.0), (-0.6, -12.0, 5.5)):
        coins.append(wreck_point(bx, by, bz) + [8])

    clams = [ground(x, z, 0.1) for x, z in
             scatter(rng, 12, lambda x, z: on_reef(x, z) and field.slope(x, z) < 0.35, 14.0) +
             scatter(rng, 5, lambda x, z: wall_band(x, z) and field.slope(x, z) < 0.5, 14.0) +
             scatter(rng, 3, lambda x, z: near(x, z, MEADOW[0], MEADOW[1], MEADOW[2]), 14.0) +
             scatter(rng, 3, lambda x, z: near(x, z, KELP[0], KELP[1], KELP[2]) and field.slope(x, z) < 0.4, 14.0)]

    chests = [wreck_point(1.2, -1.8, 1.62), wreck_point(-1.4, 3.2, 1.62)]
    for accept in (lambda x, z: near(x, z, WRECK['x'] + 12, WRECK['z'] + 14, 6),
                   lambda x, z: on_reef(x, z) and field.slope(x, z) < 0.3 and math.hypot(x, z) > 40,
                   lambda x, z: on_reef(x, z) and field.slope(x, z) < 0.3 and x < -30,
                   lambda x, z: near(x, z, ARCH['x'] + 18, ARCH['z'] + 6, 6),
                   lambda x, z: near(x, z, KELP[0] + 20, KELP[1] - 15, 10) and field.slope(x, z) < 0.4,
                   lambda x, z: abs(z - trench_center(np.array([x]))[0]) < 6 and 60 < x < 140,
                   lambda x, z: abs(z - trench_center(np.array([x]))[0]) < 6 and -200 < x < -120,
                   lambda x, z: near(x, z, MEADOW[0] + 25, MEADOW[1] + 20, 10)):
        pts = scatter(rng, 1, accept)
        if pts:
            chests.append(ground(*pts[0]))

    artifacts = []
    for kind, count, accept in (('amphora', 14, lambda x, z: near(x, z, MEADOW[0] - 25, MEADOW[1] - 10, 22)),
                                ('goblet', 6, lambda x, z: near(x, z, WRECK['x'], WRECK['z'], 22) or on_reef(x, z) and rng.random() < 0.2),
                                ('ingot', 8, lambda x, z: near(x, z, WRECK['x'], WRECK['z'], 24) or abs(z - trench_center(np.array([x]))[0]) < 8),
                                ('gem', 10, lambda x, z: on_reef(x, z) or near(x, z, KELP[0], KELP[1], KELP[2]) or near(x, z, ARCH['x'], ARCH['z'], 30))):
        for x, z in scatter(rng, count, accept, 8.0):
            artifacts.append({'kind': kind, 'pos': ground(x, z, 0.04), 'yaw': round(float(rng.uniform(0, math.tau)), 2)})

    def trench_spot(x):
        z = float(trench_center(np.array([x]))[0])
        return ground(x, z, 0.0)
    relics = [
        {'id': 'compass', 'name': "Captain's Compass", 'model': 'relic_compass', 'pos': wreck_point(0.6, -12.6, 5.94), 'hint': 'inside the wreck, in the captain\'s cabin'},
        {'id': 'idol', 'name': 'Golden Idol', 'model': 'relic_idol', 'pos': trench_spot(-60.0), 'hint': 'at the bottom of the trench'},
        {'id': 'trident', 'name': "Sea King's Trident", 'model': 'relic_trident', 'pos': ground(ARCH['x'], ARCH['z'], 0.3), 'hint': 'under the stone arch'},
        {'id': 'sundisc', 'name': 'Sun Disc', 'model': 'relic_sundisc', 'pos': ground(KELP[0] + 4, KELP[1] - 3, 0.35), 'hint': 'deep in the kelp forest'},
        {'id': 'crown', 'name': 'Pearl Crown', 'model': 'relic_crown', 'pos': None, 'hint': 'at the foot of the reef wall'},
    ]
    x = 62.0
    ze = float(wall_edge(np.array([x]))[0])
    zc = ze - 16
    relics[4]['pos'] = ground(x, zc, 0.05)

    vent_spots = ((18.0, 26.0), (-48.0, -78.0), (WRECK['x'] + 16, WRECK['z'] - 10), (KELP[0] - 10, KELP[1] + 20),
                  (90.0, float(trench_center(np.array([90.0]))[0]) + 18), (-110.0, float(trench_center(np.array([-110.0]))[0])))
    vents = [ground(x, z) for x, z in vent_spots]
    tanks = [wreck_point(-1.0, -0.5, 1.7), ground(WRECK['x'] - 14, WRECK['z'] + 8, 0.1)]
    for accept in (lambda x, z: abs(z - trench_center(np.array([x]))[0]) < 8 and 0 < x < 60,
                   lambda x, z: abs(z - trench_center(np.array([x]))[0]) < 8 and -160 < x < -100,
                   lambda x, z: near(x, z, KELP[0], KELP[1], 30),
                   lambda x, z: near(x, z, ARCH['x'], ARCH['z'] + 25, 8)):
        pts = scatter(rng, 1, accept)
        if pts:
            tanks.append(ground(*pts[0], 0.1))

    # ---- creature zones
    life = {
        'schools': [
            {'species': 'chromis', 'count': 110, 'center': ground(12, -8, 3.0), 'radius': 12},
            {'species': 'chromis', 'count': 90, 'center': ground(-40, 20, 3.0), 'radius': 12},
            {'species': 'chromis', 'count': 80, 'center': ground(30, -35, 3.0), 'radius': 12},
            {'species': 'tang', 'count': 30, 'center': ground(-8, 12, 2.0), 'radius': 10},
            {'species': 'sergeant', 'count': 40, 'center': ground(20, 30, 2.0), 'radius': 12},
            {'species': 'tang', 'count': 34, 'center': ground(40, 10, 2.5), 'radius': 16},
            {'species': 'tang', 'count': 30, 'center': ground(-20, -40, 2.5), 'radius': 14},
            {'species': 'sergeant', 'count': 40, 'center': ground(-10, 40, 2.5), 'radius': 14},
            {'species': 'sergeant', 'count': 36, 'center': ground(WRECK['x'] + 6, WRECK['z'] + 4, 8), 'radius': 14},
            {'species': 'chromis', 'count': 55, 'center': ground(KELP[0], KELP[1], 6), 'radius': 18},
            {'species': 'barracuda', 'count': 14, 'center': ground(WRECK['x'] - 10, WRECK['z'] - 18, 12), 'radius': 12},
            {'species': 'chromis', 'count': 50, 'center': ground(ARCH['x'], ARCH['z'], 9), 'radius': 14},
        ],
        'loners': [{'species': 'grouper', 'center': ground(*p, 1.5), 'radius': 10} for p in
                   ((WRECK['x'], WRECK['z']), (30.0, -50.0), (-60.0, -10.0), (ARCH['x'], ARCH['z']), (KELP[0] + 15, KELP[1]))],
        'anemones': scenery['anemone'],
        'turtles': [ground(*p, 4) for p in ((20.0, 60.0), (MEADOW[0], MEADOW[1]), (-70.0, 5.0))],
        'rays': [ground(*p, 5) for p in ((MEADOW[0] - 20, MEADOW[1] + 20), (60.0, 90.0))],
        'sharks': [
            {'path': [ground(WRECK['x'] + 30 * math.cos(a), WRECK['z'] + 30 * math.sin(a), 6) for a in np.linspace(0, math.tau, 8, endpoint=False)], 'scale': 1.0},
            {'path': [ground(x, float(wall_edge(np.array([x]))[0]) - 18, 9) for x in np.linspace(-150, 150, 7)], 'scale': 0.9},
            {'path': [trench_spot(x)[:1] + [TRENCH_DEPTH + 12] + trench_spot(x)[2:] for x in np.linspace(-200, 200, 8)], 'scale': 1.45},
        ],
        'jellies': [trench_spot(x)[:1] + [round(float(TRENCH_DEPTH + rng.uniform(5, 26)), 2)] + [round(float(trench_center(np.array([x]))[0] + rng.uniform(-10, 10)), 2)]
                    for x in rng.uniform(-220, 220, 40)],
    }

    world = {
        'size': SIZE, 'n': N, 'seaLevel': 0.0,
        'boat': [BOAT[0], 0.0, BOAT[1]],
        'spawn': [BOAT[0] + 2.5, -1.5, BOAT[1] + 7.5],
        'anchor': ground(4.0, -6.0, 0.2),
        'wreck': {'pos': wpos.round(3).tolist(), 'quat': q.round(5).tolist()},
        'arch': {'pos': ground(ARCH['x'], ARCH['z'], -1.2), 'yaw': ARCH['yaw']},
        'zones': [
            {'name': 'Coral Garden', 'x': 0, 'z': 0, 'r': 95},
            {'name': 'The Wall', 'x': 0, 'z': -72, 'r': 22, 'band': True},
            {'name': 'Wreck of the San Aurelio', 'x': WRECK['x'], 'z': WRECK['z'], 'r': 40},
            {'name': 'Stone Arch', 'x': ARCH['x'], 'z': ARCH['z'], 'r': 40},
            {'name': 'Kelp Forest', 'x': KELP[0], 'z': KELP[1], 'r': KELP[2] + 10},
            {'name': 'Seagrass Meadow', 'x': MEADOW[0], 'z': MEADOW[1], 'r': MEADOW[2] + 10},
            {'name': 'The Trench', 'trench': True},
        ],
        'trench': {'amp': [18, 70, 6, 23], 'center': -238, 'width': 16},
        'scenery': scenery,
        'debris': debris,
        'treasure': {'coins': coins, 'clams': clams, 'chests': chests, 'artifacts': artifacts, 'relics': relics,
                     'vents': vents, 'tanks': tanks},
        'life': life,
    }

    # ---- height field file: Uint16, offset/scale in world.json
    lo, hi = float(H.min()) - 1, float(H.max()) + 1
    q16 = np.round((H - lo) / (hi - lo) * 65535).astype('<u2')
    with open(os.path.join(OUT, 'terrain.bin'), 'wb') as f:
        f.write(q16.tobytes())
    world['height'] = {'min': lo, 'max': hi}
    bake_ao(H, world, models)
    with open(os.path.join(OUT, 'world.json'), 'w') as f:
        json.dump(world, f, separators=(',', ':'))
    print(f'  world.json {os.path.getsize(os.path.join(OUT, "world.json")) / 1024:.0f} KB')
    return world


# ---------------------------------------------------------------- AO bake

def bake_ao(H, world, models):
    """Bake ambient occlusion onto the seabed with Cycles, with the wreck, arch,
    boulders and debris standing on it, so they sit in soft contact shadows."""
    print('Seabed: baking ambient occlusion (Cycles)')
    from mathutils import Matrix, Quaternion
    n = H.shape[0]
    c = np.linspace(-SIZE / 2, SIZE / 2, n)
    X, Z = np.meshgrid(c, c)
    verts = np.stack([X.ravel(), -Z.ravel(), H.ravel()], 1)       # three (x,y,z) -> blender (x,-z,y)
    idx = np.arange(n * n).reshape(n, n)
    quads = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
    me = bpy.data.meshes.new('seabed')
    me.from_pydata(verts.tolist(), [], quads.tolist())
    uv = me.uv_layers.new(name='UVMap')
    loops_v = np.empty(len(me.loops), dtype=int)
    me.loops.foreach_get('vertex_index', loops_v)
    U = (verts[loops_v, 0] + SIZE / 2) / SIZE
    V = (-verts[loops_v, 1] + SIZE / 2) / SIZE
    uv.data.foreach_set('uv', np.stack([U, V], 1).ravel())
    ob = bpy.data.objects.new('seabed', me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new('seabed_bake')
    mat.use_nodes = True
    ob.data.materials.append(mat)
    img = bpy.data.images.new('ao', FINE - 1, FINE - 1, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.nodes.active = tex

    C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three -> blender
    Ci = C.inverted()

    def place(name, pos, quat_xyzw=None, yaw=0.0, scale=1.0):
        src = models.get(name)
        if src is None:
            return
        parts = [src] + list(src.children_recursive)
        if quat_xyzw is not None:
            qx, qy, qz, qw = quat_xyzw
            R3 = Quaternion((qw, qx, qy, qz)).to_matrix().to_4x4()
        else:
            R3 = Matrix.Rotation(yaw, 4, 'Y')
        M = Matrix.Translation(C @ __import__('mathutils').Vector(pos)) @ (C @ R3 @ Ci) @ Matrix.Scale(scale, 4)
        for p in parts:
            if p.type != 'MESH':
                continue
            dup = bpy.data.objects.new(p.name + '_ao', p.data)
            bpy.context.scene.collection.objects.link(dup)
            dup.matrix_world = M @ p.matrix_world
    place('wreck', world['wreck']['pos'], world['wreck']['quat'])
    place('arch', world['arch']['pos'], yaw=world['arch']['yaw'])
    f = Field(H)
    for d in world['debris']:
        place(d['model'], (d['x'], f.at(d['x'], d['z']), d['z']), yaw=d['yaw'])
    for x, z, yaw, s, v in world['scenery']['boulder']:
        place(f'boulder_{v}', (x, f.at(x, z) - 0.25 * s, z), yaw=yaw, scale=s)
    for x, z, yaw, s, v in world['scenery']['brain']:
        place(f'brain_{v}', (x, f.at(x, z) - 0.05, z), yaw=yaw, scale=s)
    for x, z, yaw, s, v in world['scenery']['barrel']:
        place('barrel_0', (x, f.at(x, z) - 0.05, z), yaw=yaw, scale=s)

    for o in bpy.context.scene.objects:
        o.select_set(False)
        o.hide_render = not (o.name == 'seabed' or o.name.endswith('_ao'))
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    scene = bpy.context.scene
    scene.cycles.samples = 48
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 7.0
    scene.render.bake.margin = 2
    bpy.ops.object.bake(type='AO')
    px = np.empty((FINE - 1) * (FINE - 1) * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    ao = px.reshape(FINE - 1, FINE - 1, 4)[..., 0].astype(np.float64)
    # Soften Cycles noise with a small blur.
    k = np.array([1, 4, 6, 4, 1], float)
    k /= k.sum()
    for axis in (0, 1):
        ao = sum(np.roll(ao, i - 2, axis=axis) * k[i] for i in range(5))
    ao = np.clip(ao, 0, 1) ** 0.8
    save_image(os.path.join(TEX, 'ao.jpg'), np.repeat(ao[..., None], 3, axis=2), quality=90)
    for o in list(bpy.context.scene.objects):
        if o.name.endswith('_ao') or o.name == 'seabed':
            bpy.data.objects.remove(o)
        else:
            o.hide_render = False
