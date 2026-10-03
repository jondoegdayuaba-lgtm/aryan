# The world: heightmap, river, roads, flattened building sites and where every
# building, tree and rock goes. The game and the Blender renders both read
# what this writes, so the two always agree.
#
# World coordinates here are the game's: x east, z south, y up (metres).
# Blender's are (x, -z, y).
import math
import random
import numpy as np

from textures import fbm

SIZE = 2400.0
N = 601
STEP = SIZE / (N - 1)
HALF = SIZE / 2
PLAY = 1080.0          # the player can't go past this from the centre


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def river_x(z):
    return -120 + 140 * np.sin(z / 260 + 0.5) + 60 * np.sin(z / 97)


def floor_h(z):
    return 70 - 0.025 * z


def grid():
    xs = np.linspace(-HALF, HALF, N)
    return np.meshgrid(xs, xs)   # X[row, col] = x, Z[row, col] = z


class World:
    def __init__(self):
        X, Z = grid()
        self.X, self.Z = X, Z
        self.rng = random.Random(7)
        self.h = self.base_heights()
        self.dirt = np.zeros((N, N), np.float32)
        self.field = np.zeros((N, N), np.float32)
        self.forest = np.zeros((N, N), np.float32)
        self.near = np.zeros((N, N), np.float32)
        self.buildings = []
        self.props = []
        self.instances = {}
        self.points = {}
        self.roads = []
        self.bridges = []
        self.zones = [
            ('town', 'rect', (325, 22, 485, 142), 45),
            ('farm', 'circle', (160, 700, 92), 60),
            ('camp', 'circle', (-232, 328, 34), 40),
            ('hideout', 'circle', (232, -862, 38), 55),
            ('ridge', 'circle', (-640, 30, 22), 40),
            ('lookout', 'circle', (-410, -240, 4), 16),
        ]
        self.flatten_zones()
        self.make_roads()
        self.place_town()
        self.place_farm()
        self.place_camp()
        self.place_hideout()
        self.place_nature()
        self.make_river()
        self.pick_points()

    # -- terrain --------------------------------------------------------------
    def base_heights(self):
        X, Z = self.X, self.Z
        rx = river_x(Z)
        d = X - rx
        ad = np.abs(d)
        big = fbm(N, 3.2, 101) - 0.5
        mid = fbm(N, 2.9, 102) - 0.5
        small = fbm(N, 1.7, 103) - 0.5
        fl = floor_h(Z)
        west = sstep(30, 650, -d) * (150 + 110 * big)
        west += 55 * np.exp(-(((X + 640) / 240) ** 2 + ((Z - 30) / 300) ** 2))
        # A bluff above the river bend: the lookout over the valley and the peaks
        west += 75 * np.exp(-(((X + 440) / 120) ** 2 + ((Z + 235) / 105) ** 2))
        east = sstep(30, 320, d) * 16 + sstep(320, 1200, d) * 50 * (1 + big)
        # Mountains to the north, opening into a broad forested valley around the river
        north = sstep(-470, -1180, Z) ** 1.8 * (360 + 180 * big) * (0.25 + 0.75 * sstep(60, 520, ad))
        south = sstep(850, 1150, Z) * 60
        edge = np.maximum(np.abs(X), np.abs(Z))
        rim = sstep(880, 1200, edge) * (110 + 90 * big) * sstep(20, 260, ad)
        hills = west + east + north + south + rim + 45 * big * sstep(60, 320, ad) + 6 * mid + 0.35 * small
        bank = sstep(14, 95, ad)
        h = fl + hills * bank + (1 - bank) * (mid * 1.2)
        h -= (1 - sstep(4, 15, ad)) * 1.6 + (1 - sstep(15, 22, ad)) * 0.6
        self.river_d = d
        return h.astype(np.float64)

    def zone_weight(self, zone, margin=0.0):
        X, Z = self.X, self.Z
        _, kind, geo, feather = zone
        if kind == 'rect':
            x0, z0, x1, z1 = geo
            dx = np.maximum(np.maximum(x0 - X, X - x1), 0)
            dz = np.maximum(np.maximum(z0 - Z, Z - z1), 0)
            dist = np.hypot(dx, dz)
        else:
            cx, cz, r = geo
            dist = np.maximum(np.hypot(X - cx, Z - cz) - r, 0)
        return 1 - sstep(margin, margin + feather, dist), dist

    def flatten_zones(self):
        for zone in self.zones:
            w, dist = self.zone_weight(zone)
            inner = dist <= 0
            target = float(np.mean(self.h[inner]))
            self.h = self.h * (1 - w) + target * w
            if zone[0] in ('town', 'camp', 'hideout'):
                inner = {'town': 0.0, 'camp': -18.0, 'hideout': -14.0}[zone[0]]
                self.dirt = np.maximum(self.dirt, (1 - sstep(inner, inner + 12, dist)) * (0.85 if zone[0] == 'town' else 0.7))

    def height(self, x, z):
        """Bilinear height at world (x, z)."""
        fx = (x + HALF) / STEP
        fz = (z + HALF) / STEP
        i0 = int(min(max(math.floor(fz), 0), N - 2))
        j0 = int(min(max(math.floor(fx), 0), N - 2))
        tz, tx = fz - i0, fx - j0
        h = self.h
        return float(h[i0, j0] * (1 - tx) * (1 - tz) + h[i0, j0 + 1] * tx * (1 - tz)
                     + h[i0 + 1, j0] * (1 - tx) * tz + h[i0 + 1, j0 + 1] * tx * tz)

    def slope(self, x, z):
        e = 2.0
        return math.hypot(self.height(x + e, z) - self.height(x - e, z),
                          self.height(x, z + e) - self.height(x, z - e)) / (2 * e)

    def window(self, x0, z0, x1, z1):
        j0 = max(0, int((x0 + HALF) / STEP) - 1)
        j1 = min(N, int((x1 + HALF) / STEP) + 2)
        i0 = max(0, int((z0 + HALF) / STEP) - 1)
        i1 = min(N, int((z1 + HALF) / STEP) + 2)
        return slice(i0, i1), slice(j0, j1)

    # -- roads ----------------------------------------------------------------
    def make_roads(self):
        roads = [
            ('main', 7.0, [(-232, 336), (-180, 322), (-110, 306), (-45, 300), (0, 300), (60, 300), (110, 292),
                           (180, 250), (260, 180), (318, 112), (340, 84), (480, 84), (530, 92)]),
            ('farm', 6.0, [(440, 90), (436, 160), (410, 300), (350, 430), (270, 560), (215, 640), (190, 675)]),
            ('north', 6.0, [(345, 82), (335, 0), (318, -120), (300, -280), (282, -440), (266, -600), (250, -740),
                            (236, -840)]),
            ('ridge', 4.0, [(-236, 322), (-300, 280), (-380, 220), (-460, 150), (-540, 90), (-610, 45), (-638, 32)]),
        ]
        for name, width, pts in roads:
            self.flatten_road(name, width, pts)

    def flatten_road(self, name, width, pts):
        # Densify to ~3 m and take a smoothed height profile
        dense = []
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(bx - ax, bz - az) / 3))
            for i in range(n):
                t = i / n
                dense.append((ax + (bx - ax) * t, az + (bz - az) * t))
        dense.append(pts[-1])
        hs = np.array([self.height(x, z) for x, z in dense])
        k = 9
        pad = np.pad(hs, k, mode='edge')
        ker = np.hanning(2 * k + 1)
        ker /= ker.sum()
        hs = np.convolve(pad, ker, mode='same')[k:-k]
        # Where the road crosses the river, span it with a level bridge deck
        rd = np.array([x - river_x(z) for x, z in dense])
        wet = np.abs(rd) < 30
        if wet.any() and name == 'main':
            idx = np.where(wet)[0]
            a, b = max(idx[0] - 1, 0), min(idx[-1] + 1, len(dense) - 1)
            deck = max(hs[a], hs[b]) + 0.3
            hs[a:b + 1] = deck
            mx = (dense[a][0] + dense[b][0]) / 2
            mz = (dense[a][1] + dense[b][1]) / 2
            yaw = math.atan2(dense[b][0] - dense[a][0], dense[b][1] - dense[a][1])
            self.bridges.append(dict(x=mx, z=mz, deck=deck, yaw=yaw))
        self.roads.append(dict(name=name, width=width, points=[[round(x, 1), round(z, 1), round(float(h), 2)]
                                                               for (x, z), h in zip(dense[::2], hs[::2])]))
        # Rasterise: distance to the polyline and the road height there
        best = np.full((N, N), 1e9)
        best_h = np.zeros((N, N))
        reach = width / 2 + 10
        for i in range(len(dense) - 1):
            (ax, az), (bx, bz) = dense[i], dense[i + 1]
            rs, cs = self.window(min(ax, bx) - reach, min(az, bz) - reach, max(ax, bx) + reach, max(az, bz) + reach)
            X = self.X[rs, cs]
            Z = self.Z[rs, cs]
            vx, vz = bx - ax, bz - az
            L2 = vx * vx + vz * vz or 1
            t = np.clip(((X - ax) * vx + (Z - az) * vz) / L2, 0, 1)
            d = np.hypot(X - (ax + vx * t), Z - (az + vz * t))
            hh = hs[i] + (hs[i + 1] - hs[i]) * t
            sub = best[rs, cs]
            m = d < sub
            sub[m] = d[m]
            best[rs, cs] = sub
            subh = best_h[rs, cs]
            subh[m] = hh[m]
            best_h[rs, cs] = subh
        dry = sstep(18, 32, np.abs(self.river_d))
        w = (1 - sstep(width / 2, width / 2 + 9, best)) * dry
        self.h = self.h * (1 - w) + best_h * w
        self.dirt = np.maximum(self.dirt, (1 - sstep(width / 2 - 1.5, width / 2 + 1.5, best)) * dry)
        self.near = np.maximum(self.near, (best < width / 2 + 7).astype(np.float32))

    # -- placement helpers ---------------------------------------------------
    def add(self, model, x, z, yaw=0.0, kind='prop', tag=None, y=None, footprint=None):
        if y is None:
            if footprint:
                # Sit on the lowest corner so nothing floats
                fx, depth = footprint
                c, s = math.cos(yaw), math.sin(yaw)
                ys = []
                for u, v in ((-fx, 0), (fx, 0), (-fx, -depth), (fx, -depth), (0, -depth / 2), (0, 3)):
                    ys.append(self.height(x + u * c + v * s, z - u * s + v * c))
                y = min(ys) - 0.05
            else:
                y = self.height(x, z)
        item = dict(model=model, x=round(x, 2), y=round(y, 2), z=round(z, 2), yaw=round(yaw, 4))
        if tag:
            item['tag'] = tag
        (self.buildings if kind == 'building' else self.props).append(item)
        return item

    def inst(self, model, x, z, yaw=None, scale=1.0, y=None):
        if yaw is None:
            yaw = self.rng.uniform(0, 6.283)
        if y is None:
            y = self.height(x, z)
        self.instances.setdefault(model, []).append([round(x, 1), round(y, 2), round(z, 1), round(yaw, 2),
                                                     round(scale, 2)])

    # -- town -----------------------------------------------------------------
    def place_town(self):
        street = 84.0
        north = [('Sheriff', 7.5, 9.0, 'sheriff'), ('Bank', 11.0, 12.0, 'bank'), ('Store', 9.5, 11.0, 'store'),
                 ('Gunsmith', 7.0, 9.0, 'gunsmith'), ('Hotel', 11.0, 12.0, 'hotel')]
        south = [('Saloon', 12.0, 14.0, 'saloon'), ('Barber', 6.5, 8.0, 'barber'), ('Livery', 10.0, 12.0, 'livery'),
                 ('House', 7.0, 8.0, None), ('HouseWhite', 6.5, 7.5, None)]
        x = 352.0
        for model, W, D, tag in north:
            cx = x + W / 2
            self.add(model, cx, street - 11.5, 0.0, 'building', tag, footprint=(W / 2, D))
            self.points[tag + '_door'] = [cx, street - 8.0]
            x += W + 4.5
        x = 350.0
        for model, W, D, tag in south:
            cx = x + W / 2
            self.add(model, cx, street + 11.5, math.pi, 'building', tag, footprint=(W / 2, D))
            if tag:
                self.points[tag + '_door'] = [cx, street + 8.0]
            x += W + 5.0
        self.add('WaterTower', 404, 48, 0.3, 'building', 'tower')
        for cx in (362, 390, 418, 446):
            self.add('HitchPost', cx, street - 6.6, 0.0)
        for cx in (372, 412, 440):
            self.add('HitchPost', cx, street + 6.6, math.pi)
        self.add('WantedBoard', 352.5, street - 6.0, 0.0, tag='wanted')
        r = self.rng
        for _ in range(16):
            side = r.choice((-1, 1))
            self.add(r.choice(('Barrel', 'Crate', 'Barrel')), r.uniform(352, 460), street + side * r.uniform(8.6, 9.6),
                     r.uniform(0, 6.28))
        self.add('Wagon', 470, street - 3, 1.4)
        self.points['town'] = [405, street]

    # -- farm -----------------------------------------------------------------
    def place_farm(self):
        self.add('Farmhouse', 150, 684, 0.0, 'building', 'farmhouse', footprint=(4.5, 9))
        self.add('Barn', 204, 676, -0.25, 'building', 'barn', footprint=(5, 14))
        for i in range(5):
            self.add('HayBale', 196 + i * 1.3, 688 + (i % 2) * 0.7, 0.1 * i)
        self.add('HayBale', 197, 688.4, 0.2, y=self.height(197, 688) + 0.5)
        self.add('Wagon', 176, 690, 2.2)
        self.add('Barrel', 160, 689, 0)
        self.add('HitchPost', 168, 684, 0.0)
        # Tobacco rows in front of the house, fenced
        x0, x1, z0, z1 = 116.0, 186.0, 704.0, 744.0
        r = self.rng
        z = z0 + 1.0
        while z < z1 - 0.5:
            x = x0 + 1.0
            while x < x1 - 0.5:
                self.inst('Tobacco' if r.random() < 0.6 else 'Tobacco2', x + r.uniform(-0.15, 0.15),
                          z + r.uniform(-0.1, 0.1), scale=r.uniform(0.85, 1.15))
                x += 1.05
            z += 1.6
        rs, cs = self.window(x0, z0, x1, z1)
        X, Z = self.X[rs, cs], self.Z[rs, cs]
        inside = (X > x0 - 1) & (X < x1 + 1) & (Z > z0 - 1) & (Z < z1 + 1)
        self.field[rs, cs] = np.maximum(self.field[rs, cs], inside.astype(np.float32))
        for edge in ('n', 's', 'w', 'e'):
            if edge in 'ns':
                zz = z0 - 1.5 if edge == 'n' else z1 + 1.5
                xx = x0
                while xx < x1:
                    if not (edge == 'n' and 140 < xx < 152):
                        self.add('Fence', xx + 1.6, zz, 0.0)
                    xx += 3.2
            else:
                xx = x0 - 1.5 if edge == 'w' else x1 + 1.5
                zz = z0
                while zz < z1:
                    self.add('Fence', xx, zz + 1.6, math.pi / 2)
                    zz += 3.2
        self.points['farmhouse'] = [150, 678]
        self.points['field'] = [150, 724]
        self.points['farm'] = [170, 690]

    # -- camp -----------------------------------------------------------------
    def place_camp(self):
        cx, cz = -232.0, 328.0
        self.add('Campfire', cx, cz, 0.0, tag='campfire')
        for i, a in enumerate((0.3, 1.5, 2.6, 4.0)):
            x, z = cx + math.cos(a) * 10, cz + math.sin(a) * 10
            # Tents face the fire
            yaw = math.atan2(cx - x, cz - z)
            self.add('Tent', x, z, yaw, 'building', 'tent%d' % i)
        for a in (0.9, 2.1, 3.4, 5.0):
            x, z = cx + math.cos(a) * 3.2, cz + math.sin(a) * 3.2
            self.add('LogSeat', x, z, a + math.pi / 2)
        self.add('Wagon', cx - 4, cz - 15, 1.2, 'building', 'campwagon')
        self.add('Crate', cx + 7, cz - 12, 0.4)
        self.add('Crate', cx + 7.8, cz - 11, 0.1)
        self.add('Barrel', cx + 6, cz - 13.5, 0)
        self.add('HitchPost', cx + 14, cz - 4, math.pi / 2)
        self.points['camp'] = [cx, cz]
        self.points['camp_hitch'] = [cx + 16.5, cz - 4]

    # -- hideout ----------------------------------------------------------------
    def place_hideout(self):
        cx, cz = 232.0, -862.0
        self.add('Cabin', cx, cz - 10, 0.0, 'building', 'cabin', footprint=(3.5, 5))
        self.add('Campfire', cx - 2, cz + 4, 0.0)
        self.add('Tent', cx - 14, cz + 2, 1.2, 'building', 'htent1')
        self.add('Tent', cx + 13, cz + 3, -1.4, 'building', 'htent2')
        self.add('Wagon', cx + 10, cz - 14, 0.6, 'building', 'hwagon')
        for i in range(6):
            self.add(('Crate', 'Barrel')[i % 2], cx - 8 + i * 1.1, cz - 13 + (i % 3) * 0.6, i)
        self.add('LogSeat', cx - 2, cz + 7.5, 0.0)
        self.points['hideout'] = [cx, cz]

    # -- trees, rocks ------------------------------------------------------------
    def blocked(self, x, z, clearance=6.0):
        if abs(x) > PLAY + 80 or abs(z) > PLAY + 80:
            return True
        if abs(x - river_x(z)) < 20:
            return True
        for zone in self.zones:
            _, kind, geo, feather = zone
            if kind == 'rect':
                x0, z0, x1, z1 = geo
                if x0 - 15 < x < x1 + 15 and z0 - 15 < z < z1 + 15:
                    return True
            else:
                gx, gz, r = geo
                if math.hypot(x - gx, z - gz) < r + 12:
                    return True
        i = int(round((z + HALF) / STEP))
        j = int(round((x + HALF) / STEP))
        if 0 <= i < N and 0 <= j < N and self.dirt[i, j] > 0.05:
            return True
        return False

    def place_nature(self):
        r = random.Random(11)
        clump = fbm(N, 2.6, 201)
        clump2 = fbm(N, 2.0, 202)

        def at(a, x, z):
            i = int(min(max(round((z + HALF) / STEP), 0), N - 1))
            j = int(min(max(round((x + HALF) / STEP), 0), N - 1))
            return a[i, j]

        def near_road(x, z, dist):
            return at(self.near, x, z) > 0

        spacing = 7.0
        g = -HALF + 40
        while g < HALF - 40:
            h = -HALF + 40
            while h < HALF - 40:
                x = g + r.uniform(-spacing / 2, spacing / 2)
                z = h + r.uniform(-spacing / 2, spacing / 2)
                h += spacing
                if self.blocked(x, z):
                    continue
                y = self.height(x, z)
                sl = self.slope(x, z)
                c = at(clump, x, z)
                rd = x - river_x(z)
                # Pine forest: the northern slopes, thinning out south; a belt along the river in the north
                pine = sstep(-280, -620, z) * sstep(0.35, 0.65, c) * 0.42
                pine += sstep(-100, -500, z) * (1 - sstep(25, 120, abs(rd))) * 0.3
                pine += (1 - sstep(60, 220, math.hypot(x - 232, z + 862))) * 0.5
                pine *= (1 - sstep(0.9, 1.3, sl)) * (1 - sstep(330, 420, y - floor_h(z)))
                oak = (sstep(0.55, 0.75, c) * 0.1 * sstep(-200, 100, z)
                       + (1 - sstep(60, 160, math.hypot(x - 160, z - 700))) * 0.08 * sstep(0.4, 0.6, c)
                       + (1 - sstep(25, 90, abs(rd))) * 0.06 * sstep(-150, 50, z)
                       + (1 - sstep(30, 90, math.hypot(x + 232, z - 328))) * 0.15)
                roll = r.random()
                if roll < pine and not near_road(x, z, 8):
                    m = r.choice(('Pine1', 'Pine1', 'Pine2', 'Pine3'))
                    self.inst(m, x, z, scale=r.uniform(0.75, 1.3), y=y - 0.2)
                    i = int(round((z + HALF) / STEP))
                    j = int(round((x + HALF) / STEP))
                    self.forest[max(i - 2, 0):i + 3, max(j - 2, 0):j + 3] = 1.0
                    continue
                if roll < pine + oak and sl < 0.7 and not near_road(x, z, 9):
                    self.inst(r.choice(('Oak1', 'Oak2')), x, z, scale=r.uniform(0.8, 1.25), y=y - 0.2)
                    continue
                roll2 = r.random()
                if sl > 0.75 and roll2 < 0.025:
                    self.inst(r.choice(('Rock1', 'Rock3', 'Rock3')), x, z, scale=r.uniform(0.8, 1.6), y=y - 0.4)
                elif roll2 < 0.0012 and z > -400:
                    self.inst('DeadTree', x, z, scale=r.uniform(0.8, 1.2), y=y - 0.2)
                elif roll2 < 0.035 + 0.04 * at(clump2, x, z):
                    self.inst(r.choice(('Bush1', 'Bush2', 'Sage', 'Sage')), x, z, scale=r.uniform(0.7, 1.4),
                              y=y - 0.1)
                elif roll2 < 0.05:
                    self.inst(r.choice(('Rock1', 'Rock2', 'Rock2')), x, z, scale=r.uniform(0.6, 1.4), y=y - 0.25)
                elif roll2 < 0.052 and sl < 0.5 and y - floor_h(z) > 60:
                    self.inst('RockSlab', x, z, scale=r.uniform(0.7, 1.2), y=y - 0.5)
                elif roll2 < 0.0535:
                    self.inst('Boulder', x, z, scale=r.uniform(0.6, 1.1), y=y - 1.2)
                elif roll2 < 0.056 and pine > 0.2:
                    self.inst('FallenLog', x, z, y=y)
            g += spacing
        # Hand-placed scenery for the lookouts and the camp
        self.inst('Oak1', -652, 40, 0.5, 1.15)
        self.inst('RockSlab', -632, 22, 2.0, 1.1, y=self.height(-632, 22) - 0.4)
        self.inst('RockSlab', -660, 22, 0.8, 0.9, y=self.height(-660, 22) - 0.4)
        self.inst('Rock3', -646, 12, 1.0, 1.0)
        self.inst('Oak2', -404, -268, 2.2, 1.25)
        self.inst('RockSlab', -401, -252, 0.5, 1.0, y=self.height(-401, -252) - 0.45)
        self.inst('Rock1', -418, -254, 1.3, 1.1)
        for a in range(6):
            ang = a * 1.1
            self.inst('Oak2' if a % 2 else 'Oak1', -232 + math.cos(ang) * 30, 328 + math.sin(ang) * 30,
                      scale=1.1)
        for a in range(5):
            ang = 0.6 + a * 0.5
            self.inst('Oak1', 160 + math.cos(ang) * 70, 700 - math.sin(ang) * 55, scale=1.3)

    # -- river ----------------------------------------------------------------
    def make_river(self):
        pts = []
        z = -HALF - 40
        while z <= HALF + 40:
            pts.append([round(float(river_x(z)), 2), round(z, 1), round(float(floor_h(z)) - 0.9, 2)])
            z += 8
        self.river = dict(points=pts, halfWidth=17.0)

    def highest(self, x0, z0, x1, z1):
        rs, cs = self.window(x0, z0, x1, z1)
        sub = self.h[rs, cs]
        i, j = np.unravel_index(np.argmax(sub), sub.shape)
        return [float(self.X[rs, cs][i, j]), float(self.Z[rs, cs][i, j])]

    def pick_points(self):
        b = self.bridges[0]
        self.points.update({
            'bridge': [round(b['x'], 1), round(b['z'], 1)],
            'eagle_ridge': [-640, 30],
            'lookout': [-410, -240],
            'deer_meadow': [-470, 330],
            'player_start': [-236, 334],
            'horse_start': [-217, 324],
        })
        for k, v in list(self.points.items()):
            self.points[k] = [round(v[0], 1), round(self.height(v[0], v[1]), 2), round(v[1], 1)]
        # The bridge itself
        self.props.append(dict(model='Bridge', x=round(b['x'], 2), y=round(b['deck'] - 2.725, 2), z=round(b['z'], 2),
                               yaw=round(b['yaw'], 4)))
