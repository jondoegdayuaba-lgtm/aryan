"""Riviera props (map 'riviera'): a sunny Mediterranean fishing village on a hillside by the sea.
Bell tower and church front for the piazza (site A), fishing boats, fish crates and net coils for the harbour
quay (site B), market stalls with striped umbrellas, cafe table sets, lemon trees in terracotta pots, cypress
trees, a fountain, pastel shuttered windows and doors, flower boxes, bougainvillea and a lighthouse on the
breakwater for the horizon.
Runs inside models.py (uses its helpers mat/box/cyl/sphere/limb/empty/finish/_apply/RX).
Every object, material, asset and function name starts with 'riv_' so nothing collides with other plug-ins.
Axes: +Y is the front, +Z up, origin at the bottom centre (wall decor: back on the wall at y = 0)."""
import math
import bpy
import bmesh
from mathutils import Vector


def riv_m(key, hexcol, metal=0.0, rough=0.7, alpha=1.0):
    return mat('riv_' + key, hexcol, metal, rough, alpha)


RIV = dict(
    stone=riv_m('stone', 0xd2c2a2, 0, 0.9), stone2=riv_m('stone2', 0xbfae8e, 0, 0.92), stoneD=riv_m('stoneD', 0x9a8a70, 0, 0.95),
    apricot=riv_m('apricot', 0xe8b48a, 0, 0.9), cream=riv_m('cream', 0xf2e8d2, 0, 0.88),
    terra=riv_m('terracotta', 0xb85a34, 0, 0.85), terra2=riv_m('terracotta2', 0xa04a2a, 0, 0.88),
    bronze=riv_m('bronze', 0x7a5a2a, 0.85, 0.35), iron=riv_m('iron', 0x2a2e2c, 0.6, 0.5), ironG=riv_m('irongreen', 0x2e4a3a, 0.5, 0.45),
    dark=riv_m('darkglass', 0x1c2228, 0.3, 0.2), wood=riv_m('wood', 0x8a5a32, 0, 0.8), woodD=riv_m('wooddark', 0x5a3a20, 0, 0.85),
    woodL=riv_m('woodlight', 0xb88a58, 0, 0.8), white=riv_m('white', 0xf4f2ec, 0, 0.6), clockW=riv_m('clockface', 0xf6f0e0, 0, 0.5),
    leaf=riv_m('leaf', 0x3f6a2c, 0, 0.85), leaf2=riv_m('leaf2', 0x557f34, 0, 0.85), cyp=riv_m('cypress', 0x24442a, 0, 0.9),
    cyp2=riv_m('cypress2', 0x2e5232, 0, 0.9), bark=riv_m('bark', 0x5a4632, 0, 0.95), lemon=riv_m('lemon', 0xf2d23a, 0, 0.5),
    orange=riv_m('orange', 0xe8862a, 0, 0.5), tomato=riv_m('tomato', 0xc8321e, 0, 0.45), soil=riv_m('soil', 0x4a3424, 0, 1.0),
    water=riv_m('water', 0x3a8a9a, 0.2, 0.05), rope=riv_m('rope', 0xc8ae78, 0, 0.95), net=riv_m('net', 0x3a7a5a, 0, 0.95),
    netR=riv_m('netred', 0xb84a2a, 0, 0.95), floatR=riv_m('floatred', 0xd8382a, 0, 0.5), floatW=riv_m('floatwhite', 0xeeeae0, 0, 0.5),
    blueS=riv_m('shutterblue', 0x4a8ab8, 0, 0.7), greenS=riv_m('shuttergreen', 0x3f7a5a, 0, 0.7), teal=riv_m('teal', 0x2e8a8a, 0, 0.6),
    pink=riv_m('flowerpink', 0xe0408a, 0, 0.7), magenta=riv_m('bougain', 0xc8287a, 0, 0.75), red=riv_m('geranium', 0xd8282a, 0, 0.7),
    fish=riv_m('fish', 0xb8c4cc, 0.6, 0.3), ice=riv_m('ice', 0xe8f4f8, 0, 0.2), crateB=riv_m('crateblue', 0x2e6ab0, 0, 0.5),
    crateW=riv_m('cratewhite', 0xe8e8e0, 0, 0.5), rock=riv_m('rock', 0x8a8478, 0, 0.95), rock2=riv_m('rock2', 0x6e6a60, 0, 0.95),
    lightred=riv_m('lhred', 0xb8302a, 0, 0.6), lamp=riv_m('lantern_emit4', 0xffe6a0), cloth=riv_m('cloth', 0xf0ead8, 0, 0.9))


def riv_prism(name, poly, y0, y1, m, parent):
    """Extrudes a 2D polygon given in (x, z) along Y from y0 to y1 (n-gon caps, works for concave shapes)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    a = [bm.verts.new((u, y0, v)) for u, v in poly]
    b = [bm.verts.new((u, y1, v)) for u, v in poly]
    n = len(poly)
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return finish(o, name, m, parent)


def riv_arch_shape(w, z0, zs, seg=10):
    """Outline of an arched opening (rectangle from z0 to zs with a semicircular top), in (x, z)."""
    pts = [(-w / 2, z0), (w / 2, z0)]
    for i in range(seg + 1):
        a = math.pi * i / seg
        pts.append((w / 2 * math.cos(a), zs + w / 2 * math.sin(a)))
    return pts


def riv_spandrel(w, zs, zt, seg=10):
    """Panel above an arch: rectangle [-w/2, w/2] x [zs, zt] minus the semicircle (concave polygon)."""
    pts = [(-w / 2, zs), (-w / 2, zt), (w / 2, zt), (w / 2, zs)]
    for i in range(1, seg):
        a = math.pi * i / seg
        pts.append((w / 2 * math.cos(a), zs + w / 2 * math.sin(a)))
    return pts


def riv_rot(o, angle):
    """Rotates an already built child object around the asset's Z axis (origin)."""
    from mathutils import Matrix
    o.matrix_world = Matrix.Rotation(angle, 4, 'Z') @ o.matrix_world


def riv_two_tone(o, m2):
    """Second material on alternating faces (striped umbrellas)."""
    o.data.materials.append(m2)
    for i, p in enumerate(o.data.polygons):
        p.material_index = i % 2


# ------------------------------------------------------------------ bell tower (hero, 4 x 4 m footprint, ~22 m)
def riv_belltower():
    r = empty('riv_belltower_root', (0, 0, 0))
    S, S2, P = RIV['stone'], RIV['stone2'], RIV['apricot']
    box('riv_belltower_base', (4.0, 4.0, 1.2), (0, 0, 0.6), S2, r, bevel=0.04)
    box('riv_belltower_plinth', (4.1, 4.1, 0.2), (0, 0, 1.25), S, r)
    box('riv_belltower_shaft', (3.6, 3.6, 11.8), (0, 0, 7.1), P, r)
    for z in (4.6, 9.2):
        box(f'riv_belltower_band{z}', (3.78, 3.78, 0.22), (0, 0, z), S, r)
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(11):
                z = 1.6 + k * 1.05
                lx, ly = (0.62, 0.4) if k % 2 else (0.4, 0.62)
                box(f'riv_belltower_quoin{sx}{sy}_{k}', (lx, ly, 0.48), (sx * (1.84 - lx / 2), sy * (1.84 - ly / 2), z), S, r)
    for i in range(4):
        a = i * math.pi / 2
        n = Vector((math.cos(a), math.sin(a), 0))
        # slit window
        o = box(f'riv_belltower_slit{i}', (0.32, 0.08, 1.1), tuple(n * 1.81 + Vector((0, 0, 6.6))), RIV['dark'], r, rot=(0, 0, a - math.pi / 2))
        o = box(f'riv_belltower_slitsill{i}', (0.5, 0.14, 0.1), tuple(n * 1.84 + Vector((0, 0, 6.02))), S, r, rot=(0, 0, a - math.pi / 2))
        # clock
        cyl(f'riv_belltower_clockrim{i}', 0.82, 0.08, tuple(n * 1.82 + Vector((0, 0, 11.0))), S, r, rot=(RX, 0, a + math.pi / 2), verts=20)
        cyl(f'riv_belltower_clock{i}', 0.7, 0.06, tuple(n * 1.87 + Vector((0, 0, 11.0))), RIV['clockW'], r, rot=(RX, 0, a + math.pi / 2), verts=20)
        box(f'riv_belltower_hourhand{i}', (0.06, 0.03, 0.4), tuple(n * 1.91 + Vector((0, 0, 11.15))), RIV['iron'], r, rot=(0, 0, a - math.pi / 2))
        box(f'riv_belltower_minhand{i}', (0.55, 0.03, 0.05), tuple(n * 1.91 + Vector((0.0, 0, 11.0)) + Vector((-math.sin(a), math.cos(a), 0)) * 0.22),
            RIV['iron'], r, rot=(0, 0, a - math.pi / 2))
    # belfry
    box('riv_belltower_floor', (3.9, 3.9, 0.3), (0, 0, 13.15), S, r)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'riv_belltower_pier{sx}{sy}', (0.75, 0.75, 4.0), (sx * 1.425, sy * 1.425, 15.3), P, r)
            box(f'riv_belltower_piercap{sx}{sy}', (0.85, 0.85, 0.15), (sx * 1.425, sy * 1.425, 15.75), S, r)
    for i in range(4):
        a = i * math.pi / 2
        o = riv_prism(f'riv_belltower_arch{i}', riv_spandrel(2.1, 15.8, 17.3), -0.2, 0.2, P, r)
        o.location = (0, 1.6, 0)
        riv_rot(o, a)
        o = box(f'riv_belltower_rail{i}', (2.1, 0.12, 0.1), (0, 1.62, 14.3), RIV['iron'], r)
        riv_rot(o, a)
        for k in range(7):
            o = box(f'riv_belltower_bal{i}_{k}', (0.05, 0.05, 0.95), (-0.9 + k * 0.3, 1.62, 13.8), RIV['iron'], r)
            riv_rot(o, a)
    cyl('riv_belltower_bell', 0.62, 0.85, (0, 0, 15.1), RIV['bronze'], r, verts=14, r2=0.38)
    cyl('riv_belltower_belltop', 0.38, 0.2, (0, 0, 15.62), RIV['bronze'], r, verts=14)
    box('riv_belltower_yoke', (3.2, 0.2, 0.25), (0, 0, 15.95), RIV['woodD'], r)
    box('riv_belltower_cornice', (4.25, 4.25, 0.35), (0, 0, 17.45), S, r, bevel=0.03)
    box('riv_belltower_cornice2', (4.0, 4.0, 0.25), (0, 0, 17.15), S2, r)
    cyl('riv_belltower_roof', 3.0, 3.6, (0, 0, 19.42), RIV['terra'], r, rot=(0, 0, math.pi / 4), verts=4, r2=0.05)
    sphere('riv_belltower_ball', 0.16, (0, 0, 21.3), RIV['bronze'], r, seg=8, rings=5)
    box('riv_belltower_crossv', (0.08, 0.08, 1.1), (0, 0, 21.9), RIV['iron'], r)
    box('riv_belltower_crossh', (0.55, 0.08, 0.08), (0, 0, 22.1), RIV['iron'], r)


# ------------------------------------------------------------------ church front (wall decor, 7 m wide)
def riv_churchfront():
    r = empty('riv_churchfront_root', (0, 0, 0))
    S, S2, C = RIV['stone'], RIV['stone2'], RIV['cream']
    box('riv_churchfront_panel', (6.6, 0.2, 6.2), (0, 0.1, 3.1), C, r)
    for x in (-3.05, -1.55, 1.55, 3.05):
        box(f'riv_churchfront_pil{x}', (0.5, 0.36, 5.9), (x, 0.18, 2.95), S, r)
        box(f'riv_churchfront_pilbase{x}', (0.62, 0.44, 0.4), (x, 0.22, 0.2), S2, r)
        box(f'riv_churchfront_pilcap{x}', (0.62, 0.44, 0.22), (x, 0.22, 5.95), S2, r)
    box('riv_churchfront_entab', (7.1, 0.5, 0.55), (0, 0.25, 6.33), S, r)
    box('riv_churchfront_frieze', (6.8, 0.42, 0.2), (0, 0.21, 6.0), S2, r)
    riv_prism('riv_churchfront_ped', [(-3.55, 6.6), (3.55, 6.6), (0, 8.1)], 0.0, 0.5, S, r)
    riv_prism('riv_churchfront_pedin', [(-2.9, 6.75), (2.9, 6.75), (0, 7.65)], 0.0, 0.53, C, r)
    sphere('riv_churchfront_finial', 0.16, (0, 0.25, 8.2), S, r, seg=8, rings=5)
    box('riv_churchfront_crossv', (0.08, 0.08, 0.8), (0, 0.25, 8.65), RIV['iron'], r)
    box('riv_churchfront_crossh', (0.4, 0.08, 0.08), (0, 0.25, 8.8), RIV['iron'], r)
    # arched main door with stone surround and two steps
    riv_prism('riv_churchfront_surround', riv_arch_shape(2.3, 0.0, 2.6), 0.0, 0.42, S2, r)
    riv_prism('riv_churchfront_door', riv_arch_shape(1.8, 0.0, 2.55), 0.0, 0.5, RIV['woodD'], r)
    box('riv_churchfront_doorsplit', (0.05, 0.05, 3.4), (0, 0.52, 1.7), RIV['iron'], r)
    for z in (0.7, 1.9):
        box(f'riv_churchfront_doorband{z}', (1.75, 0.05, 0.08), (0, 0.52, z), RIV['iron'], r)
    for s in (-1, 1):
        sphere(f'riv_churchfront_ring{s}', 0.07, (s * 0.25, 0.55, 1.35), RIV['bronze'], r, seg=8, rings=5)
    box('riv_churchfront_step1', (3.0, 0.6, 0.12), (0, 0.3, 0.06), S2, r)
    # rose window
    cyl('riv_churchfront_roserim', 0.85, 0.3, (0, 0.25, 4.55), S, r, rot=(RX, 0, 0), verts=24)
    cyl('riv_churchfront_rose', 0.68, 0.32, (0, 0.27, 4.55), RIV['dark'], r, rot=(RX, 0, 0), verts=24)
    for k in range(6):
        a = k * math.pi / 6
        box(f'riv_churchfront_spoke{k}', (1.3, 0.06, 0.06), (0, 0.43, 4.55), S, r, rot=(0, a, 0))
    cyl('riv_churchfront_rosehub', 0.14, 0.36, (0, 0.27, 4.55), S, r, rot=(RX, 0, 0), verts=12)
    # side niches with small arched windows
    for s in (-1, 1):
        riv_prism(f'riv_churchfront_sidewinframe{s}', [(x + s * 2.3, z) for x, z in riv_arch_shape(0.95, 2.2, 3.3)], 0.0, 0.3, S, r)
        riv_prism(f'riv_churchfront_sidewin{s}', [(x + s * 2.3, z) for x, z in riv_arch_shape(0.7, 2.32, 3.3)], 0.0, 0.32, RIV['dark'], r)
        box(f'riv_churchfront_sidesill{s}', (1.1, 0.4, 0.1), (s * 2.3, 0.2, 2.15), S2, r)
    box('riv_churchfront_plinth', (6.7, 0.3, 0.45), (0, 0.15, 0.22), S2, r)


# ------------------------------------------------------------------ fishing boat (gozzo), 5.6 m along Y
def riv_hull(name, sections, mside, mdeck, parent):
    """Lofts a closed hull. sections: (y, half width at sheer, half width at chine, sheer z, keel z)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vcache = {}

    def V(x, y, z):
        k = (round(x, 4), round(y, 4), round(z, 4))
        if k not in vcache:
            vcache[k] = bm.verts.new((x, y, z))
        return vcache[k]
    rings = []
    for y, hw, hc, zs, zk in sections:
        zc = zk + (zs - zk) * 0.45
        pts = [(-hw, zs), (-hc, zc), (-hc * 0.45, zk + 0.06), (0, zk), (hc * 0.45, zk + 0.06), (hc, zc), (hw, zs)]
        rings.append([V(x, y, z) for x, z in pts])
    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(n):
            kk = (k + 1) % n
            q = [a[k], a[kk], b[kk], b[k]]
            u = []
            for v in q:
                if v not in u:
                    u.append(v)
            if len(u) >= 3:
                f = bm.faces.new(u)
                f.material_index = 1 if k == n - 1 else 0
    for ring in (rings[0], rings[-1]):
        u = []
        for v in ring:
            if v not in u:
                u.append(v)
        if len(u) >= 3 and len({(round(v.co.x, 4), round(v.co.z, 4)) for v in u}) >= 3 and len({round(v.co.x, 4) for v in u}) > 1:
            bm.faces.new(u)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    finish(o, name, mside, parent)
    o.data.materials.append(mdeck)
    return o


def riv_plank(name, p0, p1, h, t, m, parent):
    """Thin vertical plank from p0 to p1 (bottom edge points), height h and thickness t (bulwarks)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    phi = math.atan2(-d.x, d.y)
    th = math.atan2(d.z, math.hypot(d.x, d.y))
    c = (p0 + p1) / 2 + Vector((0, 0, h / 2))
    return box(name, (t, L + 0.04, h), tuple(c), m, parent, rot=(th, 0, phi))


def riv_boat(name, hull_col, stripe_col, cabin):
    r = empty(f'{name}_root', (0, 0, 0))
    paint = riv_m(f'{name[4:]}_paint', hull_col, 0, 0.45)
    stripe = riv_m(f'{name[4:]}_stripe', stripe_col, 0, 0.45)
    secs = []
    for i in range(9):
        t = i / 8  # 0 stern .. 1 bow
        y = -2.8 + 5.6 * t
        bow = max(0.0, (t - 0.55) / 0.45)
        hw = 1.0 * (1 - bow ** 1.6) * (0.86 + 0.14 * math.sin(math.pi * min(1, t * 1.6)))
        if i == 8:
            hw = 0.0
        zs = 1.08 + 0.35 * bow ** 2 + (0.08 if i == 0 else 0)
        zk = 0.05 + 0.1 * bow
        secs.append((y, hw, hw * 0.82, zs - 0.32, zk))
    riv_hull(f'{name}_hull', secs, paint, RIV['woodL'], r)
    # bulwarks, rub rail and a coloured stripe on both sides
    for i in range(8):
        y0, hw0, _, zd0, _ = secs[i]
        y1, hw1, _, zd1, _ = secs[i + 1]
        for s in (-1, 1):
            riv_plank(f'{name}_bulwark{s}_{i}', (s * (hw0 - 0.03), y0, zd0), (s * (hw1 - 0.03), y1, zd1), 0.32, 0.07, paint, r)
            limb(f'{name}_rail{s}_{i}', (s * hw0, y0, zd0 + 0.33), (s * hw1, y1, zd1 + 0.33), 0.05, RIV['woodD'], r, verts=6)
            limb(f'{name}_stripe{s}_{i}', (s * hw0 * 0.99, y0, zd0 - 0.1), (s * hw1 * 0.99, y1, zd1 - 0.1), 0.06, stripe, r, verts=6)
    riv_plank(f'{name}_transom', (-secs[0][1], -2.8, secs[0][3]), (secs[0][1], -2.8, secs[0][3]), 0.32, 0.07, paint, r)
    zd = 0.8
    for y in (-1.3, 0.3):
        box(f'{name}_thwart{y}', (1.75, 0.28, 0.06), (0, y, zd + 0.24), RIV['wood'], r)
    for s in (-1, 1):
        limb(f'{name}_oar{s}', (s * 0.55, -1.9, zd + 0.33), (s * 0.4, 1.4, zd + 0.38), 0.035, RIV['woodL'], r, verts=6)
        box(f'{name}_blade{s}', (0.16, 0.6, 0.03), (s * 0.38, 1.7, zd + 0.38), RIV['woodL'], r)
        sphere(f'{name}_eye{s}', 0.09, (s * 0.21, 2.42, 1.15), RIV['white'], r, scale=(0.6, 1, 0.7), seg=8, rings=5)
    cyl(f'{name}_stem', 0.06, 0.6, (0, 2.78, 1.45), RIV['woodD'], r, verts=6)
    if cabin:
        box(f'{name}_cabin', (1.2, 1.1, 0.95), (0, -0.7, zd + 0.47), RIV['white'], r, bevel=0.04)
        box(f'{name}_cabinroof', (1.35, 1.25, 0.08), (0, -0.7, zd + 0.98), stripe, r)
        for s in (-1, 1):
            box(f'{name}_cabinwin{s}', (0.04, 0.6, 0.3), (s * 0.61, -0.65, zd + 0.65), RIV['dark'], r)
        box(f'{name}_cabinfront', (0.8, 0.04, 0.3), (0, -0.14, zd + 0.65), RIV['dark'], r)
        limb(f'{name}_mast', (0, -0.7, zd + 1.0), (0, -0.7, zd + 2.3), 0.035, RIV['woodD'], r)
        cyl(f'{name}_lantern', 0.08, 0.16, (0, -0.7, zd + 2.35), RIV['lamp'], r, verts=6)
    else:
        limb(f'{name}_mast', (0, 1.5, zd), (0, 1.5, zd + 1.7), 0.04, RIV['woodD'], r)
        cyl(f'{name}_lantern', 0.09, 0.2, (0, -2.45, zd + 0.75), RIV['lamp'], r, verts=6)
        limb(f'{name}_lanternpole', (0, -2.45, zd + 0.2), (0, -2.45, zd + 0.65), 0.02, RIV['iron'], r)
        sphere(f'{name}_netpile', 0.45, (0, -0.5, zd + 0.05), RIV['net'], r, scale=(1.2, 1.3, 0.45), seg=9, rings=5)
        for k in range(4):
            sphere(f'{name}_float{k}', 0.07, (0.35 * math.cos(k * 1.7), -0.5 + 0.45 * math.sin(k * 1.7), zd + 0.2), RIV['floatW'], r, seg=6, rings=4)


# ------------------------------------------------------------------ cypress (1 unit tall, scaled in game)
def riv_cypress():
    r = empty('riv_cypress_root', (0, 0, 0))
    limb('riv_cypress_trunk', (0, 0, 0), (0, 0, 0.14), 0.014, RIV['bark'], r, r2=0.01, verts=7)
    sphere('riv_cypress_main', 0.1, (0, 0, 0.5), RIV['cyp'], r, scale=(1, 1, 4.6), seg=10, rings=9)
    for i, (dx, dy, z, s, h) in enumerate(((0.035, 0.01, 0.42, 0.075, 3.6), (-0.03, 0.03, 0.36, 0.07, 3.2), (0.0, -0.035, 0.6, 0.06, 3.4),
                                           (-0.02, -0.02, 0.24, 0.08, 2.0))):
        sphere(f'riv_cypress_lobe{i}', s, (dx, dy, z), RIV['cyp2'] if i % 2 else RIV['cyp'], r, scale=(1, 1, h), seg=8, rings=7)


# ------------------------------------------------------------------ lemon tree in a terracotta pot (cell prop)
def riv_lemonpot():
    r = empty('riv_lemonpot_root', (0, 0, 0))
    cyl('riv_lemonpot_pot', 0.34, 0.72, (0, 0, 0.36), RIV['terra'], r, verts=14, r2=0.48)
    cyl('riv_lemonpot_rim', 0.53, 0.1, (0, 0, 0.75), RIV['terra2'], r, verts=14)
    cyl('riv_lemonpot_soil', 0.45, 0.04, (0, 0, 0.79), RIV['soil'], r, verts=14)
    for k in range(3):
        cyl(f'riv_lemonpot_band{k}', 0.4 + k * 0.035, 0.04, (0, 0, 0.25 + k * 0.17), RIV['terra2'], r, verts=14)
    limb('riv_lemonpot_trunk', (0, 0, 0.78), (0.05, 0.02, 1.55), 0.05, RIV['bark'], r, r2=0.035, verts=7)
    limb('riv_lemonpot_branch', (0.04, 0.02, 1.35), (-0.2, 0.1, 1.7), 0.025, RIV['bark'], r, verts=6)
    crown = [(0.05, 0.02, 1.95, 0.55), (-0.25, 0.1, 1.8, 0.38), (0.3, -0.15, 1.82, 0.36), (0.0, 0.3, 1.78, 0.36), (0.05, -0.28, 2.15, 0.34)]
    for i, (x, y, z, s) in enumerate(crown):
        sphere(f'riv_lemonpot_crown{i}', s, (x, y, z), RIV['leaf'] if i % 2 else RIV['leaf2'], r, scale=(1, 1, 0.85), seg=9, rings=6)
    for k in range(14):
        a = k * 2.399
        z = 1.65 + 0.5 * ((k * 0.37) % 1)
        rr = 0.5 * math.sqrt(max(0.05, 1 - ((z - 1.95) / 0.6) ** 2)) + 0.03
        sphere(f'riv_lemonpot_lemon{k}', 0.06, (0.05 + rr * math.cos(a), 0.02 + rr * math.sin(a), z), RIV['lemon'], r, scale=(1, 1, 1.3), seg=6, rings=4)


# ------------------------------------------------------------------ market stall with a striped umbrella (cell prop)
def riv_stall(name, c1, c2):
    r = empty(f'{name}_root', (0, 0, 0))
    a = riv_m(f'{name[4:]}_canvasA', c1, 0, 0.9)
    b = riv_m(f'{name[4:]}_canvasB', c2, 0, 0.9)
    box(f'{name}_top', (1.8, 0.95, 0.06), (0, 0, 0.88), RIV['woodL'], r)
    box(f'{name}_skirt', (1.76, 0.04, 0.7), (0, 0.45, 0.5), a, r)
    for k in range(6):
        box(f'{name}_skirtstripe{k}', (0.14, 0.05, 0.7), (-0.73 + k * 0.29, 0.455, 0.5), b, r)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'{name}_leg{sx}{sy}', (0.06, 0.06, 0.86), (sx * 0.84, sy * 0.42, 0.43), RIV['woodD'], r)
    produce = [RIV['lemon'], RIV['orange'], RIV['tomato'], RIV['leaf2'], RIV['lemon'], RIV['orange']]
    for i in range(6):
        x = -0.58 + (i % 3) * 0.58
        y = -0.22 + (i // 3) * 0.44
        tilt = 0.18 if i // 3 else 0
        box(f'{name}_tray{i}', (0.52, 0.4, 0.1), (x, y, 0.96), RIV['wood'], r)
        for k in range(5):
            sphere(f'{name}_fruit{i}_{k}', 0.07 if produce[i] is not RIV['leaf2'] else 0.09,
                   (x - 0.16 + (k % 3) * 0.16, y - 0.08 + (k // 3) * 0.16, 1.05), produce[i], r, seg=6, rings=4)
    box(f'{name}_crate', (0.5, 0.4, 0.3), (0.55, -0.55, 0.15), RIV['wood'], r)
    for k in range(4):
        sphere(f'{name}_cratefruit{k}', 0.07, (0.42 + (k % 2) * 0.24, -0.6 + (k // 2) * 0.14, 0.32), RIV['lemon'], r, seg=6, rings=4)
    limb(f'{name}_pole', (0, -0.1, 0.9), (0, -0.1, 2.75), 0.03, RIV['white'], r)
    o = cyl(f'{name}_umbrella', 1.55, 0.55, (0, -0.1, 2.5), a, r, verts=16, r2=0.06)
    riv_two_tone(o, b)
    for k in range(16):
        ang = (k + 0.5) / 16 * math.tau
        box(f'{name}_flap{k}', (0.6, 0.02, 0.14), (1.5 * math.cos(ang), -0.1 + 1.5 * math.sin(ang), 2.17), a if k % 2 else b, r, rot=(0, 0, ang + math.pi / 2))
    sphere(f'{name}_tip', 0.06, (0, -0.1, 2.8), RIV['white'], r, seg=6, rings=4)


# ------------------------------------------------------------------ cafe table with two chairs (cell prop)
def riv_cafe():
    r = empty('riv_cafe_root', (0, 0, 0))
    G_ = RIV['ironG']
    cyl('riv_cafe_top', 0.42, 0.04, (0, 0, 0.74), RIV['white'], r, verts=16)
    cyl('riv_cafe_edge', 0.43, 0.03, (0, 0, 0.71), G_, r, verts=16)
    limb('riv_cafe_pole', (0, 0, 0.05), (0, 0, 0.7), 0.03, G_, r)
    for k in range(3):
        a = k * math.tau / 3
        limb(f'riv_cafe_foot{k}', (0, 0, 0.12), (0.3 * math.cos(a), 0.3 * math.sin(a), 0.01), 0.02, G_, r)
    for k, (dx, dy) in enumerate(((0.12, 0.08), (-0.15, -0.05))):
        cyl(f'riv_cafe_cup{k}', 0.04, 0.06, (dx, dy, 0.79), RIV['white'], r, verts=8)
        cyl(f'riv_cafe_saucer{k}', 0.07, 0.01, (dx, dy, 0.765), RIV['white'], r, verts=10)
    cyl('riv_cafe_vase', 0.035, 0.14, (0.0, 0.18, 0.83), RIV['blueS'], r, verts=8)
    sphere('riv_cafe_flower', 0.05, (0, 0.18, 0.93), RIV['red'], r, seg=6, rings=4)
    for k, ang in enumerate((0.3, 0.3 + math.pi)):
        cxp, cyp = 0.68 * math.cos(ang), 0.68 * math.sin(ang)
        cyl(f'riv_cafe_seat{k}', 0.2, 0.04, (cxp, cyp, 0.46), RIV['woodL'], r, verts=12)
        for j in range(4):
            a = ang + math.pi / 4 + j * math.pi / 2
            limb(f'riv_cafe_leg{k}_{j}', (cxp + 0.13 * math.cos(a), cyp + 0.13 * math.sin(a), 0.44), (cxp + 0.17 * math.cos(a), cyp + 0.17 * math.sin(a), 0.0), 0.012, G_, r, verts=5)
        bx, by = cxp + 0.19 * math.cos(ang), cyp + 0.19 * math.sin(ang)
        for s in (-1, 1):
            px, py = bx - s * 0.15 * math.sin(ang), by + s * 0.15 * math.cos(ang)
            limb(f'riv_cafe_back{k}{s}', (px, py, 0.46), (px, py, 0.88), 0.012, G_, r, verts=5)
        o = box(f'riv_cafe_backrest{k}', (0.06, 0.34, 0.16), (bx, by, 0.8), RIV['woodL'], r, rot=(0, 0, ang))


# ------------------------------------------------------------------ flower box (wall decor, sits at y = 0)
def riv_flowerbox():
    r = empty('riv_flowerbox_root', (0, 0, 0))
    box('riv_flowerbox_box', (1.2, 0.3, 0.24), (0, 0.17, 0.12), RIV['terra'], r, bevel=0.015)
    box('riv_flowerbox_lip', (1.26, 0.34, 0.04), (0, 0.17, 0.25), RIV['terra2'], r)
    for s in (-1, 1):
        box(f'riv_flowerbox_bracket{s}', (0.04, 0.3, 0.04), (s * 0.45, 0.15, -0.04), RIV['iron'], r)
    for k in range(9):
        x = -0.5 + k * 0.125
        sphere(f'riv_flowerbox_leaf{k}', 0.11, (x, 0.18 + 0.04 * (k % 2), 0.32), RIV['leaf2'] if k % 2 else RIV['leaf'], r, scale=(1, 1, 0.75), seg=7, rings=5)
        sphere(f'riv_flowerbox_bloom{k}', 0.06, (x + 0.03, 0.26 - 0.05 * (k % 2), 0.42 + 0.04 * (k % 3)), RIV['red'] if k % 3 else RIV['pink'], r, seg=6, rings=4)
    for k in range(4):
        limb(f'riv_flowerbox_trail{k}', (-0.4 + k * 0.27, 0.32, 0.22), (-0.42 + k * 0.27, 0.36, -0.12), 0.03, RIV['leaf'], r, verts=5)


# ------------------------------------------------------------------ bougainvillea climbing a wall (wall decor)
def riv_bougain():
    r = empty('riv_bougain_root', (0, 0, 0))
    stems = [((0, 0.1, 0), (0.05, 0.12, 1.6)), ((0.05, 0.12, 1.6), (-0.9, 0.14, 2.9)), ((0.05, 0.12, 1.6), (0.9, 0.14, 3.0)),
             ((-0.9, 0.14, 2.9), (-1.5, 0.14, 4.1)), ((0.9, 0.14, 3.0), (1.6, 0.14, 4.2)), ((0.05, 0.12, 1.6), (0.1, 0.14, 3.6))]
    for i, (a, b) in enumerate(stems):
        limb(f'riv_bougain_stem{i}', a, b, 0.045 if i == 0 else 0.03, RIV['bark'], r, verts=5)
    sphere('riv_bougain_base', 0.4, (0, 0.25, 0.25), RIV['leaf'], r, scale=(1.3, 0.6, 0.7), seg=8, rings=5)
    import random
    rnd = random.Random(7)
    k = 0
    for cx_, cz_, n, spread in ((-1.1, 3.4, 9, 0.8), (1.2, 3.5, 9, 0.8), (0.1, 3.9, 7, 0.7), (-0.4, 2.5, 5, 0.6), (0.5, 2.4, 5, 0.6), (0.0, 1.2, 3, 0.4)):
        for j in range(n):
            x = cx_ + rnd.uniform(-spread, spread)
            z = cz_ + rnd.uniform(-spread * 0.6, spread * 0.6)
            s = rnd.uniform(0.22, 0.34)
            if j % 3 == 0:
                sphere(f'riv_bougain_leaf{k}', s, (x, 0.16, z), RIV['leaf2'] if k % 2 else RIV['leaf'], r, scale=(1.2, 0.4, 0.8), seg=7, rings=4)
            else:
                sphere(f'riv_bougain_bloom{k}', s, (x, 0.2, z), RIV['magenta'] if k % 4 else RIV['pink'], r, scale=(1.2, 0.38, 0.85), seg=7, rings=4)
            k += 1


# ------------------------------------------------------------------ net and rope coil with floats (cell prop)
def riv_netcoil():
    r = empty('riv_netcoil_root', (0, 0, 0))
    for k in range(4):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.36 - k * 0.02, minor_radius=0.065, major_segments=16, minor_segments=6, location=(0.35, 0.1, 0.07 + k * 0.12))
        finish(bpy.context.object, f'riv_netcoil_rope{k}', RIV['rope'], r, smooth=True)
    sphere('riv_netcoil_heap', 0.55, (-0.3, -0.15, 0.2), RIV['net'], r, scale=(1.1, 1.0, 0.5), seg=10, rings=6)
    sphere('riv_netcoil_heap2', 0.38, (-0.15, -0.35, 0.38), RIV['netR'], r, scale=(1.0, 1.0, 0.55), seg=9, rings=5)
    for k in range(7):
        a = k * 0.9
        sphere(f'riv_netcoil_float{k}', 0.08, (-0.3 + 0.5 * math.cos(a), -0.15 + 0.45 * math.sin(a), 0.32 + 0.05 * (k % 2)),
               RIV['floatR'] if k % 2 else RIV['floatW'], r, seg=7, rings=5)
    cyl('riv_netcoil_buoy', 0.16, 0.5, (0.45, -0.5, 0.25), RIV['floatR'], r, verts=10, r2=0.1)


# ------------------------------------------------------------------ stacked fish boxes (cell prop, cover ~1.2 m)
def riv_fishcrates():
    r = empty('riv_fishcrates_root', (0, 0, 0))
    k = 0
    layout = [(-0.42, -0.3, 0), (0.42, -0.3, 0), (-0.42, 0.32, 0), (0.42, 0.32, 0), (-0.4, -0.28, 1), (0.44, -0.26, 1), (-0.38, 0.3, 1), (0.0, 0.0, 2)]
    for x, y, lvl in layout:
        m = RIV['crateB'] if (k % 3) else RIV['crateW']
        z = lvl * 0.36
        box(f'riv_fishcrates_box{k}', (0.8, 0.58, 0.34), (x, y, z + 0.17), m, r, bevel=0.02)
        box(f'riv_fishcrates_ice{k}', (0.72, 0.5, 0.02), (x, y, z + 0.33), RIV['ice'], r)
        if lvl == 2 or (lvl == 1 and k == 5) or (lvl == 0 and k == 3):
            for j in range(4):
                sphere(f'riv_fishcrates_fish{k}_{j}', 0.05, (x - 0.24 + j * 0.16, y + 0.05 * (j % 2), z + 0.355), RIV['fish'], r, scale=(3.2, 1, 0.7), seg=6, rings=4)
        k += 1


# ------------------------------------------------------------------ fountain (2 x 2 cells, 4 m across)
def riv_fountain():
    r = empty('riv_fountain_root', (0, 0, 0))
    R = 1.85
    cyl('riv_fountain_basin', R, 0.62, (0, 0, 0.31), RIV['stone2'], r, rot=(0, 0, math.pi / 8), verts=8)
    cyl('riv_fountain_water', R - 0.1, 0.04, (0, 0, 0.66), RIV['water'], r, rot=(0, 0, math.pi / 8), verts=8)
    side = 2 * R * math.tan(math.pi / 8)
    for k in range(8):
        a = k * math.pi / 4
        rr = R * math.cos(math.pi / 8) - 0.1
        box(f'riv_fountain_rim{k}', (side + 0.05, 0.28, 0.24), (rr * math.cos(a), rr * math.sin(a), 0.74), RIV['stone'], r, rot=(0, 0, a + math.pi / 2))
    cyl('riv_fountain_step', R + 0.15, 0.12, (0, 0, 0.06), RIV['stoneD'], r, rot=(0, 0, math.pi / 8), verts=8)
    cyl('riv_fountain_column', 0.22, 1.3, (0, 0, 1.3), RIV['stone'], r, verts=10, r2=0.16)
    cyl('riv_fountain_bowl', 0.15, 0.3, (0, 0, 2.0), RIV['stone'], r, verts=14, r2=0.75)
    cyl('riv_fountain_bowlwater', 0.68, 0.03, (0, 0, 2.14), RIV['water'], r, verts=14)
    cyl('riv_fountain_top', 0.1, 0.5, (0, 0, 2.4), RIV['stone'], r, verts=10, r2=0.05)
    sphere('riv_fountain_knob', 0.12, (0, 0, 2.68), RIV['stone'], r, seg=8, rings=5)
    jet = riv_m('fountainjet', 0xd8f0f4, 0, 0.05, 0.55)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        limb(f'riv_fountain_jet{k}', (0.72 * math.cos(a), 0.72 * math.sin(a), 2.12), (1.0 * math.cos(a), 1.0 * math.sin(a), 0.68), 0.03, jet, r, verts=5)


# ------------------------------------------------------------------ pastel window with shutters (wall decor)
def riv_window(name, shut_hex, flowers):
    r = empty(f'{name}_root', (0, 0, 0))
    shut = riv_m(f'{name[4:]}_shutter', shut_hex, 0, 0.7)
    frame = RIV['white']
    box(f'{name}_glass', (0.85, 0.04, 1.3), (0, 0.02, 0.65), RIV['dark'], r)
    box(f'{name}_mull', (0.05, 0.07, 1.3), (0, 0.04, 0.65), frame, r)
    box(f'{name}_tran', (0.85, 0.07, 0.05), (0, 0.04, 0.85), frame, r)
    for s in (-1, 1):
        box(f'{name}_side{s}', (0.12, 0.1, 1.45), (s * 0.49, 0.05, 0.66), frame, r)
        box(f'{name}_shutter{s}', (0.44, 0.05, 1.32), (s * 0.78, 0.04, 0.66), shut, r)
        for k in range(7):
            box(f'{name}_slat{s}_{k}', (0.38, 0.06, 0.025), (s * 0.78, 0.06, 0.13 + k * 0.17), shut, r)
    box(f'{name}_sill', (1.15, 0.2, 0.07), (0, 0.1, -0.035), frame, r)
    box(f'{name}_head', (1.15, 0.12, 0.12), (0, 0.06, 1.38), frame, r)
    if flowers:
        box(f'{name}_box', (0.95, 0.24, 0.2), (0, 0.24, 0.08), RIV['terra'], r)
        for k in range(6):
            x = -0.38 + k * 0.152
            sphere(f'{name}_leaf{k}', 0.1, (x, 0.25, 0.22), RIV['leaf'], r, scale=(1, 1, 0.7), seg=6, rings=4)
            sphere(f'{name}_bloom{k}', 0.055, (x + 0.02, 0.32, 0.3), RIV['red'] if k % 2 else RIV['pink'], r, seg=6, rings=4)


def riv_door(name, paint_hex):
    r = empty(f'{name}_root', (0, 0, 0))
    paint = riv_m(f'{name[4:]}_paint', paint_hex, 0, 0.6)
    riv_prism(f'{name}_surround', riv_arch_shape(1.6, 0.0, 2.15), 0.0, 0.1, RIV['stone'], r)
    riv_prism(f'{name}_leaf', riv_arch_shape(1.2, 0.0, 2.1), 0.0, 0.14, paint, r)
    for k in range(4):
        box(f'{name}_plank{k}', (0.02, 0.03, 2.2), (-0.45 + k * 0.3, 0.15, 1.1), RIV['woodD'], r)
    sphere(f'{name}_knob', 0.04, (0.4, 0.18, 1.05), RIV['bronze'], r, seg=8, rings=5)
    box(f'{name}_step', (1.7, 0.35, 0.1), (0, 0.17, 0.05), RIV['stone2'], r)


# ------------------------------------------------------------------ lighthouse on rocks (scenery in the sea)
def riv_lighthouse():
    r = empty('riv_lighthouse_root', (0, 0, 0))
    for i, (x, y, z, s) in enumerate(((0, 0, 0.6, 3.2), (2.4, 1.2, 0.3, 2.2), (-2.2, -1.4, 0.3, 2.4), (1.2, -2.6, 0.2, 1.8), (-1.6, 2.3, 0.2, 1.9), (3.8, -0.8, 0.1, 1.5))):
        sphere(f'riv_lighthouse_rock{i}', s, (x, y, z), RIV['rock'] if i % 2 else RIV['rock2'], r, scale=(1.0, 0.85, 0.55), seg=8, rings=5)
    cyl('riv_lighthouse_base', 2.0, 1.4, (0, 0, 2.0), RIV['stone2'], r, verts=12)
    for k in range(4):
        cyl(f'riv_lighthouse_seg{k}', 1.45 - k * 0.12, 2.6, (0, 0, 4.0 + k * 2.6), RIV['white'] if k % 2 == 0 else RIV['lightred'], r, verts=14, r2=1.33 - k * 0.12)
    cyl('riv_lighthouse_gallery', 1.45, 0.25, (0, 0, 13.2), RIV['iron'], r, verts=14)
    cyl('riv_lighthouse_lantern', 0.75, 1.4, (0, 0, 14.0), RIV['lamp'], r, verts=10)
    cyl('riv_lighthouse_cap', 0.95, 0.9, (0, 0, 15.15), RIV['lightred'], r, verts=10, r2=0.1)
    for k in range(10):
        a = k * math.tau / 10
        limb(f'riv_lighthouse_rail{k}', (1.35 * math.cos(a), 1.35 * math.sin(a), 13.3), (1.35 * math.cos(a), 1.35 * math.sin(a), 13.95), 0.03, RIV['iron'], r, verts=4)


# ------------------------------------------------------------------ stone plinth under the tower / blocker (cell prop)
def riv_blank():
    r = empty('riv_blank_root', (0, 0, 0))
    box('riv_blank_slab', (1.98, 1.98, 0.04), (0, 0, 0.02), RIV['stoneD'], r)


def riv_join_all():
    """Join each riv_ asset's parts into one mesh (one primitive per material) so the GLB stays small."""
    for root in [o for o in bpy.data.objects if o.name.startswith('riv_') and o.name.endswith('_root') and o.parent is None]:
        parts = [o for o in root.children_recursive if o.type == 'MESH']
        if len(parts) < 2:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:
            bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        parts[0].name = root.name[:-5] + '_mesh'
        bpy.ops.object.select_all(action='DESELECT')


# ------------------------------------------------------------------ build everything
riv_belltower(); riv_churchfront()
riv_boat('riv_boat', 0xf2f0ea, 0x2e6ab0, False); riv_boat('riv_boatR', 0xe8dcc0, 0xb8302a, True); riv_boat('riv_boatG', 0x3a8a7a, 0xf2d23a, False)
riv_cypress(); riv_lemonpot(); riv_stall('riv_stall', 0xd8402a, 0xf4f0e4); riv_stall('riv_stallB', 0x2e7ab8, 0xf4f0e4)
riv_cafe(); riv_flowerbox(); riv_bougain(); riv_netcoil(); riv_fishcrates(); riv_fountain()
riv_window('riv_window', 0x4a8ab8, True); riv_window('riv_windowG', 0x3f7a5a, False); riv_window('riv_windowY', 0xd8b03a, True)
riv_door('riv_door', 0x2e8a8a); riv_door('riv_doorB', 0x3a5a9a)
riv_lighthouse(); riv_blank()
riv_join_all()
