# Trees, rocks, bushes, tobacco plants and grass.
import math
import random
from mathutils import Vector, noise

from common import Builder, mat


def materials(T):
    return {
        'bark': mat('Bark', image=T['bark']),
        'deadwood': mat('DeadWood', '#7a6e62', 0.95),
        'pine': mat('PineNeedles', '#2a3a24', 0.9),
        'pine2': mat('PineNeedles2', '#33452b', 0.9),
        'pine3': mat('PineNeedles3', '#243220', 0.9),
        'oak': mat('OakLeaves', '#526b2a', 0.85),
        'oak2': mat('OakLeaves2', '#61792f', 0.85),
        'oak3': mat('OakLeaves3', '#435a23', 0.85),
        'bush': mat('BushLeaves', '#56652f', 0.9),
        'sage': mat('Sagebrush', '#7c8763', 0.95),
        'rock': mat('Rock', image=T['rock']),
        'rockdark': mat('RockDark', '#5d5a55', 0.95),
        'lichen': mat('Lichen', '#8c8a6a', 0.95),
        'tobacco': mat('TobaccoLeaf', '#748a2e', 0.75, double=True),
        'tobacco2': mat('TobaccoLeafOld', '#a39a3c', 0.8, double=True),
        'stalk': mat('Stalk', '#6f7a32', 0.8),
        'bloom': mat('Bloom', '#d9a3b0', 0.8),
        'grass': mat('Grass', '#8a8a45', 0.9, double=True),
        'grass2': mat('GrassDry', '#b0a35c', 0.9, double=True),
        'grass3': mat('GrassGreen', '#6c7a34', 0.9, double=True),
    }


def lumpy(b, center, radius, scale, material, seed, amp=0.3, subdiv=2):
    c = Vector(center)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))

    def deform(co):
        d = co - c
        n = noise.noise((d / radius) * 1.6 + off)
        return c + d * (1 + amp * n)
    return b.ico(radius, center, scale, material=material, subdiv=subdiv, smooth=True, deform=deform)


def pine(M, name, H, seed, slender=1.0):
    rnd = random.Random(seed)
    b = Builder(name)
    b.cyl((0, 0, -0.4), (0, 0, H * 0.9), 0.022 * H, 0.05, M['bark'], seg=7, uv=1.2)
    tiers = int(6 + H / 2.5)
    mats = (M['pine'], M['pine2'], M['pine3'])
    for i in range(tiers):
        t = i / (tiers - 1)
        z0 = H * (0.12 + 0.8 * t)
        r = ((1 - t) ** 0.85 * H * 0.2 + 0.4) * slender
        h = H * 0.17 * (1 - 0.35 * t) + 0.7
        verts = b.cyl((0, 0, z0), (0, 0, z0 + h), r, 0.02, mats[rnd.randrange(3)], seg=11, smooth=True)
        ph = rnd.random() * 6.28
        for v in verts:
            if v.co.z < z0 + 0.01:
                a = math.atan2(v.co.y, v.co.x)
                jag = 1 + 0.22 * math.sin(a * 5 + ph) + rnd.uniform(-0.08, 0.08)
                v.co.x *= jag
                v.co.y *= jag
                v.co.z -= 0.18 * r * jag
    ob = b.build()
    return ob


def oak(M, name, H, seed, R=None):
    rnd = random.Random(seed)
    b = Builder(name)
    R = R or H * 0.5
    top = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), H * 0.45))
    b.tube([(0, 0, -0.4), (0, 0, H * 0.2), top], [(0.42, 0.42), (0.32, 0.32), (0.26, 0.26)], M['bark'], None,
           seg=9, uv=1.2)
    tips = []
    n = 5
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.3, 0.3)
        reach = R * rnd.uniform(0.5, 0.7)
        tip = top + Vector((math.cos(a) * reach, math.sin(a) * reach, H * rnd.uniform(0.15, 0.3)))
        b.cyl(top, tip, 0.2, 0.07, M['bark'], seg=6)
        tips.append(tip)
    mats = (M['oak'], M['oak2'], M['oak3'])
    # A rounded crown: clumps at the branch tips, a big core, and more piled on top
    for i, tip in enumerate(tips):
        lumpy(b, tip + Vector((0, 0, 0.4)), R * rnd.uniform(0.36, 0.44), (1, 1, 0.9), mats[i % 3], seed + i)
    lumpy(b, top + Vector((0, 0, H * 0.4)), R * 0.62, (1, 1, 0.85), M['oak3'], seed + 9)
    for i in range(6):
        a = rnd.uniform(0, 6.28)
        rr = R * rnd.uniform(0.15, 0.4)
        p = top + Vector((math.cos(a) * rr, math.sin(a) * rr, H * rnd.uniform(0.45, 0.68)))
        lumpy(b, p, R * rnd.uniform(0.3, 0.4), (1, 1, 0.9), mats[(i + 1) % 3], seed + 20 + i)
    return b.build()


def dead_tree(M, name, H, seed):
    rnd = random.Random(seed)
    b = Builder(name)
    b.cyl((0, 0, -0.3), (0.2, 0.1, H), 0.3, 0.06, M['deadwood'], seg=7)
    for i in range(6):
        z = H * rnd.uniform(0.35, 0.85)
        a = rnd.uniform(0, 6.28)
        p0 = Vector((0.2 * z / H, 0.1 * z / H, z))
        p1 = p0 + Vector((math.cos(a), math.sin(a), rnd.uniform(0.5, 1.2))).normalized() * rnd.uniform(1.5, 3.0)
        b.cyl(p0, p1, 0.09, 0.02, M['deadwood'], seg=5)
        p2 = p1 + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0.8))
        b.cyl(p1, p2, 0.025, 0.01, M['deadwood'], seg=4)
    return b.build()


def bush(M, name, seed, size=1.0, material=None):
    rnd = random.Random(seed)
    b = Builder(name)
    for i in range(5):
        p = (rnd.uniform(-0.5, 0.5) * size, rnd.uniform(-0.5, 0.5) * size, rnd.uniform(0.25, 0.5) * size)
        lumpy(b, p, rnd.uniform(0.45, 0.7) * size, (1, 1, 0.75), material or M['bush'], seed + i, amp=0.35, subdiv=1)
    return b.build()


def rock(M, name, seed, scale, material=None):
    b = Builder(name)
    off = Vector((seed * 5.3, seed * 2.9, 0))

    def deform(co):
        n = noise.noise(co * 0.9 + off) * 0.28 + noise.noise(co * 2.4 + off) * 0.1
        d = co * (1 + n)
        d.z = max(d.z, -0.4)
        return d
    b.ico(1.0, (0, 0, 0.0), scale, material=material or M['rock'], subdiv=2, smooth=False, deform=deform)
    b.box_uv(list(b.bm.faces), 2.5)
    return b.build()


def rock_slab(M, name, seed):
    """Layered flat rock outcrop like the ones on grassy hilltops."""
    rnd = random.Random(seed)
    b = Builder(name)
    for i in range(4):
        sx, sy = rnd.uniform(2.5, 4.5), rnd.uniform(1.8, 3.2)
        p = (rnd.uniform(-1.2, 1.2), rnd.uniform(-1, 1), 0.25 + i * 0.45)
        off = Vector((seed + i, i * 2.0, 0))

        def deform(co, off=off):
            n = noise.noise(co * 0.6 + off)
            return Vector((co.x * (1 + 0.15 * n), co.y * (1 + 0.15 * n), co.z + 0.12 * n))
        b.ico(1.0, p, (sx * (1 - i * 0.15), sy * (1 - i * 0.15), 0.42), material=M['rock'], subdiv=2,
              smooth=False, deform=deform, rot=(0, 0, rnd.uniform(0, 3)))
    b.box_uv(list(b.bm.faces), 2.5)
    return b.build()


def tobacco(M, name, seed):
    rnd = random.Random(seed)
    b = Builder(name)
    H = rnd.uniform(1.2, 1.5)
    b.cyl((0, 0, 0), (0, 0, H), 0.025, 0.012, M['stalk'], seg=6)
    n = 7
    for i in range(n):
        t = i / (n - 1)
        z = 0.15 + t * (H - 0.3)
        a = i * 2.4 + rnd.uniform(-0.2, 0.2)
        L = 0.55 * (1 - 0.55 * t) + 0.12
        W = L * 0.42
        droop = 0.5 - 0.3 * t
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))

        def deform(co, z=z, d=d, side=side, L=L, droop=droop):
            # co is in the leaf's own frame: x across, y along, z thickness
            along = (co.y + L) / (2 * L)
            p = Vector((0, 0, z)) + d * (along * L * 1.6) + side * co.x
            p.z += 0.25 * along * L - droop * (along ** 2) * L + co.z
            return p
        m = M['tobacco2'] if t < 0.25 else M['tobacco']
        b.ball((W, L, 0.012), (0, 0, 0), (0, 0, 0), m, None, seg=6, rings=5, deform=deform)
    for i in range(4):
        a = i * 1.57
        b.ball(0.016, (math.cos(a) * 0.03, math.sin(a) * 0.03, H + 0.03), material=M['bloom'], seg=5, rings=3)
    return b.build()


def grass_clump(M, name, seed, blades=14, height=0.55, spread=0.35, mats=None):
    rnd = random.Random(seed)
    b = Builder(name)
    mats = mats or (M['grass'], M['grass2'], M['grass3'])
    for i in range(blades):
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0, spread)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        h = height * rnd.uniform(0.55, 1.2)
        lean = Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.08, 0.3) * h
        w = rnd.uniform(0.025, 0.045)
        side = Vector((-math.sin(a + 1.2), math.cos(a + 1.2), 0)) * w
        mid = base + lean * 0.4 + Vector((0, 0, h * 0.55))
        tip = base + lean + Vector((0, 0, h))
        b.poly([base - side, base + side, mid + side * 0.6, mid - side * 0.6], mats[rnd.randrange(len(mats))])
        b.poly([mid - side * 0.6, mid + side * 0.6, tip], mats[rnd.randrange(len(mats))])
    return b.build()


def fallen_log(M, name):
    b = Builder(name)
    b.cyl((-2.5, 0, 0.3), (2.5, 0.2, 0.35), 0.32, 0.26, M['bark'], seg=8, ref=Vector((0, 0, 1)), uv=1.2)
    b.cyl((1.0, 0.1, 0.5), (1.6, -0.6, 1.0), 0.07, 0.03, M['bark'], seg=5)
    return b.build()


def build_all(T):
    M = materials(T)
    out = {
        'Pine1': pine(M, 'Pine1', 13.0, 1),
        'Pine2': pine(M, 'Pine2', 9.0, 2),
        'Pine3': pine(M, 'Pine3', 18.0, 3, slender=0.8),
        'Oak1': oak(M, 'Oak1', 9.0, 4),
        'Oak2': oak(M, 'Oak2', 7.0, 5, R=4.2),
        'DeadTree': dead_tree(M, 'DeadTree', 7.0, 6),
        'Bush1': bush(M, 'Bush1', 7, 1.0),
        'Bush2': bush(M, 'Bush2', 8, 0.7),
        'Sage': bush(M, 'Sage', 9, 0.5, M['sage']),
        'Rock1': rock(M, 'Rock1', 10, (1.4, 1.1, 0.8)),
        'Rock2': rock(M, 'Rock2', 11, (0.7, 0.6, 0.5)),
        'Rock3': rock(M, 'Rock3', 12, (3.0, 2.2, 1.8)),
        'Boulder': rock(M, 'Boulder', 13, (5.5, 4.5, 3.5)),
        'RockSlab': rock_slab(M, 'RockSlab', 14),
        'Tobacco': tobacco(M, 'Tobacco', 15),
        'Tobacco2': tobacco(M, 'Tobacco2', 16),
        'Grass1': grass_clump(M, 'Grass1', 17),
        'Grass2': grass_clump(M, 'Grass2', 18, blades=10, height=0.4, spread=0.25),
        'Grass3': grass_clump(M, 'Grass3', 19, blades=16, height=0.75, spread=0.4),
        'FallenLog': fallen_log(M, 'FallenLog'),
    }
    return out
