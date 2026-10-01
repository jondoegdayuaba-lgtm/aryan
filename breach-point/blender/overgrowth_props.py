"""Overgrowth (jungle temple map) props. Exec'd inside models.py, so its helpers (mat, box, cyl, sphere, limb, empty,
finish, RX) are available. Every object, material and asset name starts with 'ovg_'.
Axes: +Y is the front, +Z up, origin at the bottom centre, sizes in metres."""
import math, random
from mathutils import Vector


# ---------------------------------------------------------------- helpers
def ovg_mesh(name, verts, faces, m, parent, double=False, smooth=False, closed=False):
    """Mesh object from raw vertices/faces. double=True adds back faces (for leaves and fronds);
    closed=True makes the faces of a closed solid point outwards."""
    vs = [tuple(v) for v in verts]
    fs = [tuple(f) for f in faces]
    if double:
        # back faces are a copy with reversed winding, nudged 2 mm behind the front so renderers never see coplanar faces
        n = len(vs)
        acc = [Vector((0, 0, 0)) for _ in vs]
        for f in fs:
            a_, b_, c_ = (Vector(vs[f[0]]), Vector(vs[f[1]]), Vector(vs[f[2]]))
            nrm = (b_ - a_).cross(c_ - a_)
            for i in f:
                acc[i] += nrm
        back = [tuple(Vector(v) - (acc[i].normalized() * 0.002 if acc[i].length > 1e-9 else Vector((0, 0, 0)))) for i, v in enumerate(vs)]
        vs = vs + back
        fs = fs + [tuple(i + n for i in reversed(f)) for f in fs]
    me = bpy.data.meshes.new(name)
    me.from_pydata(vs, [], fs)
    me.update()
    if closed:
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(m)
    if parent is not None:
        o.parent = parent
    return o


def ovg_jitter(o, amt, rng, keep_bottom=None):
    """Randomly displaces the vertices of an object (organic shapes); vertices below keep_bottom stay put."""
    for v in o.data.vertices:
        if keep_bottom is not None and v.co.z <= keep_bottom:
            continue
        v.co.x += rng.uniform(-amt, amt)
        v.co.y += rng.uniform(-amt, amt)
        v.co.z += rng.uniform(-amt, amt) * 0.6


def ovg_leaves(name, specs, m, parent):
    """One mesh of double-sided diamond leaves. specs: (centre, axis vector, side vector)."""
    verts, faces = [], []
    for c, a, b in specs:
        c, a, b = Vector(c), Vector(a), Vector(b)
        k = len(verts)
        verts += [c - a * 0.5, c + b * 0.5, c + a * 0.5, c - b * 0.5]
        faces.append((k, k + 1, k + 2, k + 3))
    return ovg_mesh(name, verts, faces, m, parent, double=True)


def ovg_ribbon(path, width, face=Vector((0, 1, 0))):
    """Flat strip along a polyline (vines, lianas). Returns verts, faces with local indices."""
    verts, faces = [], []
    for i, p in enumerate(path):
        p = Vector(p)
        d = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
        s = d.cross(face).normalized() * (width / 2)
        verts += [p - s, p + s]
        if i:
            k = 2 * i
            faces.append((k - 2, k - 1, k + 1, k))
    return verts, faces


def ovg_merge(parts):
    verts, faces = [], []
    for vs, fs in parts:
        k = len(verts)
        verts += list(vs)
        faces += [tuple(i + k for i in f) for f in fs]
    return verts, faces


def ovg_prism(profile, depth, axis_y=True):
    """Extrudes a closed 2D profile (x,z) along Y (centred). Returns verts, faces."""
    n = len(profile)
    verts = [Vector((x, -depth / 2, z)) for x, z in profile] + [Vector((x, depth / 2, z)) for x, z in profile]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return verts, faces


M_OVG = {}
def ovg_mats():
    if M_OVG:
        return M_OVG
    M_OVG.update(
        stone=mat('ovg_stone', 0x8f8c76, 0, 0.92),
        stone2=mat('ovg_stone_dark', 0x6c6a58, 0, 0.95),
        stone3=mat('ovg_stone_pale', 0xa6a28a, 0, 0.9),
        carve=mat('ovg_carving', 0x3e3d32, 0, 0.95),
        moss=mat('ovg_moss', 0x58772c, 0, 0.95),
        moss2=mat('ovg_moss_light', 0x74923a, 0, 0.95),
        leaf=mat('ovg_leaf', 0x467a2c, 0, 0.8),
        leaf2=mat('ovg_leaf_light', 0x64963a, 0, 0.8),
        leaf3=mat('ovg_leaf_dark', 0x335e24, 0, 0.85),
        leafs=mat('ovg_leaf_sun', 0x7aa646, 0, 0.8),
        bark=mat('ovg_bark', 0x584838, 0, 0.95),
        root=mat('ovg_rootbark', 0x6c5a46, 0, 0.95),
        liana=mat('ovg_liana', 0x4c5a2a, 0, 0.9),
        wood=mat('ovg_wood', 0x7c5c3a, 0, 0.88),
        wood2=mat('ovg_wood_dark', 0x56402a, 0, 0.9),
        endgrain=mat('ovg_endgrain', 0xa88a64, 0, 0.9),
        rope=mat('ovg_rope', 0xb49c70, 0, 0.95),
        fungus=mat('ovg_fungus', 0xcfa868, 0, 0.8),
        canvas=mat('ovg_canvas', 0x8e875c, 0, 0.95),
        canvas2=mat('ovg_canvas_dark', 0x6a6646, 0, 0.95),
        jade=mat('ovg_jade_emit2', 0x62d68a, 0, 0.4),
        flame=mat('ovg_flame_emit4', 0xff7a22, 0, 0.5),
        core=mat('ovg_flamecore_emit4', 0xffd25a, 0, 0.5),
        coal=mat('ovg_coal_emit2', 0xb8401a, 0, 0.8),
        iron=mat('ovg_iron', 0x2f2c28, 0.6, 0.55),
        petal=mat('ovg_petal', 0xf2d8e4, 0, 0.6),
    )
    return M_OVG


# ---------------------------------------------------------------- jungle tree
def ovg_tree(name='ovg_tree', seed=3, tall=1.0, spread=1.0):
    """Broadleaf jungle tree about 14 m tall: buttress roots, a long leaning trunk, spreading branches with
    layered leaf clumps and hanging lianas."""
    M = ovg_mats()
    rng = random.Random(seed)
    r = empty(f'{name}_root', (0, 0, 0))
    lean = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 0))
    pts = [Vector((0, 0, -0.1))] + [lean * (k / 4) ** 1.5 + Vector((0, 0, 10.0 * tall * k / 4)) for k in range(1, 5)]
    rad = [0.5, 0.4, 0.33, 0.27, 0.2]
    for i in range(4):
        limb(f'{name}_trunk{i}', pts[i], pts[i + 1], rad[i], M['bark'], r, r2=rad[i + 1], verts=9)
    # buttress roots: thin fins with a concave top edge
    parts = []
    for i in range(6):
        a = i * math.tau / 6 + rng.uniform(-0.25, 0.25)
        L = rng.uniform(1.5, 2.2)
        H = rng.uniform(1.9, 2.7)
        prof = [(0.18 + L * k / 5, H * (1 - k / 5) ** 1.7 + 0.02) for k in range(6)]
        prof += [(0.18 + L, -0.05), (0.18, -0.05)]
        vs, fs = ovg_prism(prof, 0.18)
        rot = Vector((math.cos(a), math.sin(a)))
        out = []
        for v in vs:
            th = 0.18 * (1 - 0.7 * max(0, (v.x - 0.18) / L))
            y = v.y / 0.18 * th
            out.append(Vector((v.x * rot.x - y * rot.y, v.x * rot.y + y * rot.x, v.z)))
        parts.append((out, fs))
    ovg_mesh(f'{name}_buttress', *ovg_merge(parts), M['root'], r, closed=True)
    # spreading branches from the upper trunk
    tips = []
    nb = 6
    for i in range(nb):
        a = i * math.tau / nb + rng.uniform(-0.3, 0.3)
        k = 0.55 + 0.4 * (i / nb)
        base = pts[0].lerp(pts[-1], k) + Vector((0, 0, 0))
        L = rng.uniform(3.0, 4.4) * spread
        tip = base + Vector((math.cos(a) * L, math.sin(a) * L, rng.uniform(1.6, 2.6) * tall))
        mid = base.lerp(tip, 0.5) + Vector((0, 0, 0.5))
        limb(f'{name}_branch{i}a', base, mid, 0.15, M['bark'], r, r2=0.1, verts=6)
        limb(f'{name}_branch{i}b', mid, tip, 0.1, M['bark'], r, r2=0.05, verts=5)
        tips.append(tip)
    crown = pts[-1] + Vector((0, 0, 1.8 * tall))
    limb(f'{name}_crown', pts[-1], crown, 0.2, M['bark'], r, r2=0.08, verts=6)
    tips.append(crown)
    # layered leaf clumps: big soft masses on the branch tips, smaller ones filling the gaps
    leafm = [M['leaf'], M['leaf2'], M['leafs']]
    n = 0
    for i, t in enumerate(tips):
        for k in range(2):
            c = t + Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), rng.uniform(-0.2, 0.4) + k * 0.6))
            s = rng.uniform(1.4, 2.0) * (1.3 if i == nb else 1) * (0.8 if k else 1)
            o = sphere(f'{name}_clump{n}', s, tuple(c), leafm[(i + k) % 3], r, scale=(1, 1, 0.52), seg=9, rings=6)
            ovg_jitter(o, 0.3 * s, rng)
            n += 1
    for i in range(nb):
        t = tips[i].lerp(tips[(i + 1) % nb], 0.5).lerp(crown, 0.35)
        o = sphere(f'{name}_clump{n}', rng.uniform(1.3, 1.8), tuple(t + Vector((0, 0, 0.3))), leafm[i % 3], r, scale=(1, 1, 0.5), seg=8, rings=5)
        ovg_jitter(o, 0.4, rng)
        n += 1
    # lianas hanging from the branches
    for i, t in enumerate(tips[:nb]):
        p0 = pts[-2].lerp(t, 0.6)
        L = rng.uniform(3.5, 6.0)
        path = [p0 + Vector((math.sin(k * 0.9 + i) * 0.15, math.cos(k * 0.7) * 0.12, -L * k / 6)) for k in range(7)]
        vs, fs = ovg_ribbon(path, 0.08, Vector((math.cos(i), math.sin(i), 0)))
        ovg_mesh(f'{name}_liana{i}', vs, fs, M['liana'], r, double=True)
    # moss on the root flare
    for i in range(3):
        a = i * 2.1
        sphere(f'{name}_moss{i}', 0.42, (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.15), M['moss'], r, scale=(1, 1, 0.45), seg=7, rings=4)


# ---------------------------------------------------------------- broken column
def ovg_column():
    """Broken fluted stone column on a stepped plinth (about 2.5 m), with a toppled drum and moss."""
    M = ovg_mats()
    rng = random.Random(11)
    r = empty('ovg_column_root', (0, 0, 0))
    box('ovg_column_plinth', (1.0, 1.0, 0.3), (0, 0, 0.15), M['stone2'], r, bevel=0.04)
    box('ovg_column_plinth2', (0.84, 0.84, 0.16), (0, 0, 0.38), M['stone'], r, bevel=0.03)
    n = 20
    verts, faces = [], []
    z0 = 0.46
    for i in range(n):
        a = i / n * math.tau
        rr = 0.34 if i % 2 == 0 else 0.315
        verts.append((rr * math.cos(a), rr * math.sin(a), z0))
    for i in range(n):
        a = i / n * math.tau
        rr = (0.31 if i % 2 == 0 else 0.29)
        zt = 2.25 + 0.3 * math.sin(a + 0.6) + rng.uniform(-0.12, 0.12)
        verts.append((rr * math.cos(a), rr * math.sin(a), zt))
    verts.append((0.04, -0.03, 2.3))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        faces.append((n + i, n + j, 2 * n))
    faces.append(tuple(range(n))[::-1])
    ovg_mesh('ovg_column_shaft', verts, faces, M['stone'], r, closed=True)
    # band near the base and a toppled fragment at the foot
    cyl('ovg_column_band', 0.36, 0.08, (0, 0, 0.62), M['stone2'], r, verts=16)
    frag = cyl('ovg_column_drum', 0.3, 0.42, (0.62, 0.42, 0.24), M['stone'], r, rot=(RX, 0, 0.7), verts=10)
    box('ovg_column_chip', (0.3, 0.22, 0.16), (-0.6, 0.5, 0.08), M['stone2'], r, rot=(0.2, 0.1, 0.5))
    # moss on the break and the plinth, a vine spiralling up
    sphere('ovg_column_mosstop', 0.28, (0.05, 0.0, 2.38), M['moss'], r, scale=(1.1, 1.1, 0.35), seg=8, rings=4)
    sphere('ovg_column_mossbase', 0.42, (-0.3, -0.32, 0.36), M['moss2'], r, scale=(1, 0.8, 0.3), seg=8, rings=4)
    path_specs = []
    for t in range(1, 11):
        a = t * 0.9
        c = Vector((0.39 * math.cos(a), 0.39 * math.sin(a), 0.5 + t * 0.17))
        nrm = Vector((math.cos(a), math.sin(a), 0))
        path_specs.append((c, Vector((0, 0, 0.14)) + nrm * 0.05, nrm.cross(Vector((0, 0, 1))) * 0.08))
    ovg_leaves('ovg_column_ivy', path_specs, M['leaf2'], r)


# ---------------------------------------------------------------- giant idol head
def ovg_idol():
    """Giant carved stone head (about 3.6 m tall, 3.4 m wide) half sunk into the ground, jade eyes, mossy crown."""
    M = ovg_mats()
    rng = random.Random(5)
    r = empty('ovg_idol_root', (0, 0, 0))
    S, D, C = M['stone'], M['stone2'], M['carve']
    box('ovg_idol_base', (3.5, 3.1, 0.35), (0, 0, 0.17), D, r, bevel=0.06)
    box('ovg_idol_head', (3.0, 2.6, 2.5), (0, 0, 1.6), S, r, bevel=0.14)
    box('ovg_idol_jaw', (2.6, 2.5, 0.6), (0, 0.06, 0.62), S, r, bevel=0.1)
    # headdress: stepped bands and a crest
    box('ovg_idol_band', (3.3, 2.85, 0.42), (0, 0, 2.95), D, r, bevel=0.06)
    box('ovg_idol_crown', (2.7, 2.4, 0.38), (0, -0.05, 3.33), S, r, bevel=0.05)
    box('ovg_idol_crest', (1.2, 0.5, 0.55), (0, 0.85, 3.7), S, r, bevel=0.05)
    for i in range(7):
        x = -1.35 + i * 0.45
        box(f'ovg_idol_stud{i}', (0.26, 0.14, 0.26), (x, 1.44, 2.95), S if i % 2 else M['stone3'], r, bevel=0.03)
    # face: brow, eyes, nose, mouth
    box('ovg_idol_brow', (2.6, 0.32, 0.3), (0, 1.36, 2.42), D, r, bevel=0.05)
    for s in (-1, 1):
        box(f'ovg_idol_socket{s}', (0.78, 0.1, 0.46), (s * 0.66, 1.31, 2.04), C, r)
        box(f'ovg_idol_eye{s}', (0.32, 0.08, 0.22), (s * 0.66, 1.36, 2.04), M['jade'], r)
        box(f'ovg_idol_lid{s}', (0.86, 0.16, 0.1), (s * 0.66, 1.36, 2.3), S, r, bevel=0.02)
        box(f'ovg_idol_cheek{s}', (0.5, 0.18, 0.5), (s * 0.95, 1.32, 1.45), S, r, bevel=0.05)
        cyl(f'ovg_idol_ear{s}', 0.48, 0.3, (s * 1.6, 0.15, 1.8), D, r, rot=(0, RX, 0), verts=12)
        cyl(f'ovg_idol_earhole{s}', 0.22, 0.32, (s * 1.62, 0.15, 1.8), C, r, rot=(0, RX, 0), verts=10)
        box(f'ovg_idol_earflap{s}', (0.22, 0.5, 0.9), (s * 1.58, 0.15, 1.1), S, r, bevel=0.04)
    box('ovg_idol_nose', (0.55, 0.5, 0.75), (0, 1.48, 1.6), S, r, bevel=0.1)
    box('ovg_idol_nostril', (0.5, 0.1, 0.12), (0, 1.74, 1.3), C, r)
    box('ovg_idol_lip', (1.5, 0.3, 0.36), (0, 1.38, 0.98), D, r, bevel=0.06)
    box('ovg_idol_mouth', (1.2, 0.1, 0.12), (0, 1.53, 0.98), C, r)
    for i in range(4):
        box(f'ovg_idol_tooth{i}', (0.16, 0.06, 0.12), (-0.36 + i * 0.24, 1.55, 0.9), M['stone3'], r)
    # back of the head: a carved panel and a stone braid
    box('ovg_idol_backpanel', (2.2, 0.1, 1.5), (0, -1.33, 1.75), D, r, bevel=0.03)
    for i in range(3):
        box(f'ovg_idol_backglyph{i}', (0.5, 0.08, 0.5), (-0.7 + i * 0.7, -1.38, 1.85), M['stone3'], r, bevel=0.02)
        box(f'ovg_idol_backglyphc{i}', (0.22, 0.06, 0.22), (-0.7 + i * 0.7, -1.43, 1.85), C, r)
    for i in range(5):
        box(f'ovg_idol_braid{i}', (0.4 - i * 0.03, 0.22, 0.3), (0, -1.42, 2.75 - i * 0.32), S if i % 2 else M['stone3'], r, bevel=0.05)
    # cracks and moss
    box('ovg_idol_crack0', (0.05, 0.04, 1.1), (0.3, 1.31, 2.6), C, r, rot=(0, 0.35, 0))
    box('ovg_idol_crack1', (0.04, 0.04, 0.8), (-1.2, 1.31, 1.0), C, r, rot=(0, -0.5, 0))
    for i in range(6):
        a = rng.uniform(0, math.tau)
        sphere(f'ovg_idol_moss{i}', rng.uniform(0.4, 0.7), (math.cos(a) * 0.9, math.sin(a) * 0.8 - 0.1, 3.5),
               M['moss'] if i % 2 else M['moss2'], r, scale=(1.2, 1, 0.35), seg=8, rings=4)
    sphere('ovg_idol_mossjaw', 0.6, (-1.1, 1.2, 0.35), M['moss'], r, scale=(1.3, 0.8, 0.5), seg=8, rings=4)
    sphere('ovg_idol_mossside', 0.7, (1.4, -0.9, 0.4), M['moss2'], r, scale=(0.8, 1.3, 0.6), seg=8, rings=4)
    # vines draped from the crown down the cheeks
    specs = []
    parts = []
    for k, x in enumerate((-1.25, -0.95, 1.05, 1.3)):
        path = [(x + 0.06 * math.sin(i * 1.3 + k), 1.33 + 0.02 * i, 3.5 - i * 0.36) for i in range(8)]
        parts.append(ovg_ribbon(path, 0.06))
        for i in range(1, 8, 1):
            p = Vector(path[i])
            specs.append((p + Vector((0.05 * (-1) ** i, 0.04, 0)), Vector((0.06 * (-1) ** i, 0.03, -0.13)), Vector((0.08, 0, 0.02))))
    ovg_mesh('ovg_idol_vines', *ovg_merge(parts), M['liana'], r, double=True)
    ovg_leaves('ovg_idol_leaves', specs, M['leaf2'], r)


# ---------------------------------------------------------------- hanging vines (wall decor)
def ovg_vines():
    """Curtain of leafy vines climbing a wall face (front +Y), about 2 m wide and 4-6 m tall, bottom at z = 0."""
    M = ovg_mats()
    rng = random.Random(7)
    r = empty('ovg_vines_root', (0, 0, 0))
    parts = []
    specs = ([], [], [])
    for s in range(7):
        x0 = -0.9 + s * 0.3 + rng.uniform(-0.08, 0.08)
        H = rng.uniform(3.4, 6.2)
        n = 10
        path = []
        for i in range(n + 1):
            t = i / n
            path.append((x0 + 0.2 * math.sin(t * 5 + s * 1.7), 0.05 + 0.04 * math.sin(t * 7 + s), 0.02 + H * t))
        parts.append(ovg_ribbon(path, 0.05))
        for i in range(1, n + 1):
            p = Vector(path[i])
            dens = 3 if i > n * 0.35 else 2
            for k in range(dens):
                side = (-1) ** (k + i)
                c = p + Vector((side * rng.uniform(0.06, 0.16), rng.uniform(0.06, 0.12), rng.uniform(-0.2, 0.2)))
                sz = rng.uniform(0.75, 1.25)
                ax = Vector((side * rng.uniform(0.03, 0.1), rng.uniform(0.04, 0.1), -rng.uniform(0.16, 0.24))) * sz
                sd = Vector((0.13, 0, 0.04 * side)) * sz
                specs[(i + k + s) % 3].append((c, ax, sd))
    # loose strands hanging down from the top
    for s in range(3):
        x0 = -0.6 + s * 0.6
        H = rng.uniform(4.8, 6.0)
        path = [(x0 + 0.05 * math.sin(i), 0.14 + 0.03 * i, H - i * 0.45) for i in range(6)]
        parts.append(ovg_ribbon(path, 0.04))
    ovg_mesh('ovg_vines_stems', *ovg_merge(parts), M['liana'], r, double=True)
    ovg_leaves('ovg_vines_leaves', specs[0], M['leaf'], r)
    ovg_leaves('ovg_vines_leaves2', specs[1], M['leaf2'], r)
    ovg_leaves('ovg_vines_leaves3', specs[2], M['leaf3'], r)


# ---------------------------------------------------------------- lily pads
def ovg_lilies():
    """A cluster of floating lily pads with two pale flowers (sits on the water surface at z = 0)."""
    M = ovg_mats()
    rng = random.Random(23)
    r = empty('ovg_lilies_root', (0, 0, 0))
    for i in range(7):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.2, 1.1)
        rr = rng.uniform(0.22, 0.42)
        n = 10
        cx, cy = math.cos(a) * d, math.sin(a) * d
        notch = rng.uniform(0, math.tau)
        verts = [(cx, cy, 0.02)]
        for k in range(n + 1):
            t = notch + 0.35 + k / n * (math.tau - 0.7)
            verts.append((cx + rr * math.cos(t), cy + rr * math.sin(t), 0.02))
        faces = [(0, k, k + 1) for k in range(1, n + 1)]
        ovg_mesh(f'ovg_lilies_pad{i}', verts, faces, M['leaf2'] if i % 2 else M['leaf'], r, double=True)
    petals = []
    for x, y in ((0.3, 0.2), (-0.5, -0.3)):
        for k in range(6):
            a = k / 6 * math.tau
            petals.append(((x + 0.07 * math.cos(a), y + 0.07 * math.sin(a), 0.08),
                           (0.12 * math.cos(a), 0.12 * math.sin(a), 0.07), (-0.06 * math.sin(a), 0.06 * math.cos(a), 0)))
    ovg_leaves('ovg_lilies_petals', petals, M['petal'], r)


# ---------------------------------------------------------------- fern bush
def ovg_fern():
    """Low fern bush (about 1.7 m across, 0.7 m tall) of arching fronds with leaflets."""
    M = ovg_mats()
    rng = random.Random(9)
    r = empty('ovg_fern_root', (0, 0, 0))
    A, B = [], []
    nf = 13
    for f in range(nf):
        a = f / nf * math.tau + rng.uniform(-0.2, 0.2)
        L = rng.uniform(0.75, 1.0)
        Hs = rng.uniform(1.8, 2.5)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        verts, faces = [], []
        N = 12
        for i in range(N + 1):
            t = i / N
            p = d * (L * t) + Vector((0, 0, 0.04 + Hs * t * 0.5 - (Hs * 0.5 + 0.12) * t * t))
            w = 0.17 * math.sin(math.pi * min(1.0, t * 1.08 + 0.02)) * (1.0 if i % 2 else 0.5)
            verts += [p + side * w + Vector((0, 0, 0.35 * w)), p - side * w + Vector((0, 0, 0.35 * w))]
            if i:
                k = 2 * i
                faces.append((k - 2, k, k + 1, k - 1))
        (A if f % 2 else B).append((verts, faces))
    ovg_mesh('ovg_fern_fronds', *ovg_merge(A), M['leaf'], r, double=True)
    ovg_mesh('ovg_fern_fronds2', *ovg_merge(B), M['leaf2'], r, double=True)
    sphere('ovg_fern_heart', 0.16, (0, 0, 0.06), M['leaf3'], r, scale=(1, 1, 0.6), seg=7, rings=4)


# ---------------------------------------------------------------- carved stone altar
def ovg_altar():
    """Carved stone altar block (1.9 x 1.25 x 1.15 m) with a glyph band, offering bowl and moss (front +Y)."""
    M = ovg_mats()
    r = empty('ovg_altar_root', (0, 0, 0))
    S, D, C = M['stone'], M['stone2'], M['carve']
    box('ovg_altar_plinth', (2.0, 1.4, 0.2), (0, 0, 0.1), D, r, bevel=0.03)
    box('ovg_altar_body', (1.6, 1.0, 0.66), (0, 0, 0.53), S, r, bevel=0.02)
    for s in (-1, 1):
        box(f'ovg_altar_band{s}', (1.36, 0.04, 0.24), (0, s * 0.5, 0.55), C, r)
        for i in range(4):
            box(f'ovg_altar_glyph{s}{i}', (0.22, 0.05, 0.18), (-0.48 + i * 0.32, s * 0.51, 0.55), M['stone3'], r, bevel=0.01)
            box(f'ovg_altar_glyphc{s}{i}', (0.08, 0.06, 0.06), (-0.48 + i * 0.32 + (0.03 if i % 2 else -0.03), s * 0.52, 0.56), C, r)
        box(f'ovg_altar_endcap{s}', (0.06, 0.8, 0.5), (s * 0.81, 0, 0.53), D, r)
        box(f'ovg_altar_head{s}', (0.28, 0.4, 0.3), (s * 0.95, 0, 1.2), S, r, bevel=0.04)
        box(f'ovg_altar_headeye{s}', (0.05, 0.1, 0.08), (s * 1.1, 0.1, 1.24), C, r)
        box(f'ovg_altar_headeye2{s}', (0.05, 0.1, 0.08), (s * 1.1, -0.1, 1.24), C, r)
    box('ovg_altar_top', (1.9, 1.25, 0.2), (0, 0, 0.96), S, r, bevel=0.03)
    box('ovg_altar_rim', (1.5, 0.9, 0.05), (0, 0, 1.08), D, r)
    cyl('ovg_altar_bowl', 0.26, 0.14, (0.35, 0.05, 1.13), D, r, verts=10, r2=0.18)
    cyl('ovg_altar_bowlin', 0.2, 0.02, (0.35, 0.05, 1.2), C, r, verts=10)
    sphere('ovg_altar_jade', 0.1, (-0.4, -0.1, 1.15), M['jade'], r, scale=(1, 1, 0.6), seg=7, rings=4)
    sphere('ovg_altar_moss0', 0.45, (-0.7, -0.35, 1.03), M['moss'], r, scale=(1, 0.8, 0.25), seg=8, rings=4)
    sphere('ovg_altar_moss1', 0.5, (0.8, 0.55, 0.2), M['moss2'], r, scale=(0.9, 0.7, 0.4), seg=8, rings=4)


# ---------------------------------------------------------------- fallen log
def ovg_log():
    """Fallen mossy log lying along X (2.1 m long, 0.8 m thick) with fungus shelves and a branch stub."""
    M = ovg_mats()
    rng = random.Random(13)
    r = empty('ovg_log_root', (0, 0, 0))
    body = cyl('ovg_log_body', 0.4, 2.1, (0, 0, 0.36), M['bark'], r, rot=(0, RX, 0), verts=11)
    ovg_jitter(body, 0.035, rng)
    for s in (-1, 1):
        cyl(f'ovg_log_end{s}', 0.36, 0.03, (s * 1.05, 0, 0.36), M['endgrain'], r, rot=(0, RX, 0), verts=11)
        cyl(f'ovg_log_ring{s}', 0.2, 0.035, (s * 1.055, 0, 0.36), M['wood2'], r, rot=(0, RX, 0), verts=9)
    for i in range(4):
        x = -0.75 + i * 0.5
        sphere(f'ovg_log_moss{i}', 0.32, (x, rng.uniform(-0.1, 0.05), 0.7), M['moss'] if i % 2 else M['moss2'], r,
               scale=(1.4, 0.9, 0.3), seg=8, rings=4)
    for i in range(3):
        x = -0.5 + i * 0.45
        o = cyl(f'ovg_log_fungus{i}', 0.16, 0.05, (x, 0.4, 0.42 + 0.1 * i), M['fungus'], r, verts=8)
        o.scale = (1, 0.6, 1)
    limb('ovg_log_stub', (0.4, -0.2, 0.55), (0.75, -0.65, 0.95), 0.1, M['bark'], r, r2=0.05, verts=6)
    sphere('ovg_log_fern', 0.3, (-0.85, -0.45, 0.12), M['leaf'], r, scale=(1, 1, 0.4), seg=7, rings=4)


# ---------------------------------------------------------------- rope bridge segment
def ovg_bridge():
    """2 m segment of a plank-and-rope bridge (walk direction X, 4 m wide), posts at x = -1, deck at z = 0."""
    M = ovg_mats()
    rng = random.Random(17)
    r = empty('ovg_bridge_root', (0, 0, 0))
    for i in range(8):
        x = -0.88 + i * 0.25
        box(f'ovg_bridge_plank{i}', (0.22, 3.8, 0.06), (x, rng.uniform(-0.05, 0.05), 0.04 + rng.uniform(-0.01, 0.01)),
            M['wood'] if i % 3 else M['wood2'], r, rot=(rng.uniform(-0.01, 0.01), 0, rng.uniform(-0.03, 0.03)))
    for s in (-1, 1):
        box(f'ovg_bridge_beam{s}', (2.0, 0.12, 0.08), (0, s * 1.75, 0.1), M['wood2'], r)
        cyl(f'ovg_bridge_post{s}', 0.07, 1.25, (-0.95, s * 1.88, 0.62), M['wood2'], r, verts=7)
        cyl(f'ovg_bridge_postcap{s}', 0.09, 0.08, (-0.95, s * 1.88, 1.25), M['rope'], r, verts=7)
        for z, sag in ((1.12, 0.14), (0.6, 0.08)):
            pts = [Vector((-0.95, s * 1.88, z)), Vector((0, s * 1.9, z - sag)), Vector((1.05, s * 1.88, z))]
            limb(f'ovg_bridge_rope{s}{z}a', pts[0], pts[1], 0.022, M['rope'], r, verts=5)
            limb(f'ovg_bridge_rope{s}{z}b', pts[1], pts[2], 0.022, M['rope'], r, verts=5)
        for k, x in enumerate((-0.45, 0.5)):
            limb(f'ovg_bridge_hang{s}{k}', (x, s * 1.89, 1.06), (x, s * 1.8, 0.1), 0.012, M['rope'], r, verts=4)


# ---------------------------------------------------------------- brazier
def ovg_brazier():
    """Stone fire brazier (about 1.3 m tall) with glowing coals and flames."""
    M = ovg_mats()
    r = empty('ovg_brazier_root', (0, 0, 0))
    box('ovg_brazier_base', (0.66, 0.66, 0.22), (0, 0, 0.11), M['stone2'], r, bevel=0.03)
    cyl('ovg_brazier_stem', 0.2, 0.55, (0, 0, 0.49), M['stone'], r, verts=8, r2=0.16)
    cyl('ovg_brazier_bowl', 0.24, 0.32, (0, 0, 0.92), M['stone'], r, verts=10, r2=0.48)
    cyl('ovg_brazier_rim', 0.5, 0.06, (0, 0, 1.08), M['stone2'], r, verts=10)
    sphere('ovg_brazier_coals', 0.4, (0, 0, 1.07), M['coal'], r, scale=(1, 1, 0.25), seg=8, rings=4)
    for i, (x, y, h, rr) in enumerate(((0, 0, 0.62, 0.2), (0.16, 0.1, 0.42, 0.13), (-0.14, -0.06, 0.48, 0.14), (0.02, -0.18, 0.36, 0.11))):
        cyl(f'ovg_brazier_flame{i}', rr, h, (x, y, 1.1 + h / 2), M['flame'], r, verts=6, r2=0.0)
    cyl('ovg_brazier_core', 0.1, 0.34, (0, 0.02, 1.25), M['core'], r, verts=6, r2=0.0)
    for s in range(4):
        a = s * RX + 0.78
        box(f'ovg_brazier_glyph{s}', (0.12, 0.04, 0.12), (0.335 * math.cos(a) * 1.0, 0.335 * math.sin(a), 0.12), M['carve'], r, rot=(0, 0, a + RX))


# ---------------------------------------------------------------- expedition tent and bedroll
def ovg_tent():
    """Expedition ridge tent (2.2 m wide, 3.6 m long, 1.95 m tall), open end facing +Y."""
    M = ovg_mats()
    r = empty('ovg_tent_root', (0, 0, 0))
    W, L, H = 1.1, 3.6, 1.95
    for s in (-1, 1):
        prof = [(0, H), (s * W, 0.0), (s * (W - 0.05), 0.0), (0, H - 0.07)]
        if s > 0:
            prof = prof[::-1]
        vs, fs = ovg_prism(prof, L)
        ovg_mesh(f'ovg_tent_wall{s}', vs, fs, M['canvas'], r, closed=True)
    # back wall and rolled front flaps
    ovg_mesh('ovg_tent_back', [(-W, -L / 2, 0), (W, -L / 2, 0), (0, -L / 2, H)], [(0, 1, 2)], M['canvas2'], r, double=True)
    for s in (-1, 1):
        ovg_mesh(f'ovg_tent_flap{s}', [(0, L / 2, H - 0.05), (s * W * 0.95, L / 2, 0.02), (s * W * 0.55, L / 2 + 0.35, 0.02)],
                 [(0, 1, 2)], M['canvas2'], r, double=True)
    box('ovg_tent_floor', (2.1, 3.5, 0.02), (0, 0, 0.01), M['wood2'], r)
    for y in (-L / 2 - 0.02, L / 2 + 0.02):
        cyl(f'ovg_tent_pole{y:.1f}', 0.035, H + 0.15, (0, y, (H + 0.15) / 2), M['wood2'], r, verts=6)
        for s in (-1, 1):
            limb(f'ovg_tent_guy{y:.1f}{s}', (0, y, H + 0.05), (s * 0.5, y + (0.9 if y > 0 else -0.9), 0.02), 0.01, M['rope'], r, verts=4)
            cyl(f'ovg_tent_peg{y:.1f}{s}', 0.025, 0.2, (s * 0.5, y + (0.9 if y > 0 else -0.9), 0.08), M['wood'], r, verts=4)
    limb('ovg_tent_ridge', (0, -L / 2, H + 0.02), (0, L / 2, H + 0.02), 0.03, M['wood2'], r, verts=6)
    cyl('ovg_tent_roll', 0.14, 0.75, (-0.45, 0.6, 0.15), M['canvas2'], r, rot=(0, RX, 0.1), verts=8)
    box('ovg_tent_crate', (0.55, 0.4, 0.38), (0.5, 1.05, 0.2), M['wood'], r, bevel=0.02)
    box('ovg_tent_lamp', (0.12, 0.12, 0.2), (0.5, 1.0, 0.49), M['core'], r)


def ovg_bedroll():
    """Rolled sleeping mat with a pack: hidden inside tents, marks their collision cells."""
    M = ovg_mats()
    r = empty('ovg_bedroll_root', (0, 0, 0))
    cyl('ovg_bedroll_roll', 0.13, 0.7, (0, 0, 0.13), M['canvas2'], r, rot=(0, RX, 0), verts=8)
    box('ovg_bedroll_pack', (0.4, 0.25, 0.45), (0.1, -0.35, 0.22), M['canvas'], r, bevel=0.04)


# ---------------------------------------------------------------- rubble
def ovg_rubble():
    """Pile of broken carved blocks (about 1.7 m across, 0.6 m tall) with moss."""
    M = ovg_mats()
    rng = random.Random(21)
    r = empty('ovg_rubble_root', (0, 0, 0))
    spots = [(0, 0, 0.2, 0.75, 0.55, 0.4), (0.55, 0.3, 0.15, 0.5, 0.45, 0.3), (-0.5, 0.35, 0.14, 0.5, 0.4, 0.28),
             (-0.3, -0.5, 0.12, 0.45, 0.5, 0.25), (0.45, -0.45, 0.12, 0.4, 0.35, 0.24), (0.1, 0.1, 0.48, 0.45, 0.35, 0.22)]
    for i, (x, y, z, sx, sy, sz) in enumerate(spots):
        box(f'ovg_rubble_block{i}', (sx, sy, sz), (x, y, z), [M['stone'], M['stone2'], M['stone3']][i % 3], r,
            bevel=0.03, rot=(rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(0, 3)))
    box('ovg_rubble_carved', (0.3, 0.06, 0.2), (0.0, 0.29, 0.22), M['carve'], r)
    sphere('ovg_rubble_moss', 0.35, (-0.2, 0.1, 0.36), M['moss'], r, scale=(1.2, 1, 0.3), seg=7, rings=4)


# ---------------------------------------------------------------- carved stela
def ovg_stela():
    """Standing carved stone slab (about 2.7 m) with glyph panels, face +Y."""
    M = ovg_mats()
    r = empty('ovg_stela_root', (0, 0, 0))
    box('ovg_stela_base', (1.1, 0.8, 0.25), (0, 0, 0.125), M['stone2'], r, bevel=0.03)
    box('ovg_stela_slab', (0.85, 0.42, 2.3), (0, 0, 1.4), M['stone'], r, bevel=0.05)
    box('ovg_stela_top', (0.95, 0.5, 0.18), (0, 0, 2.6), M['stone2'], r, bevel=0.04)
    for s in (-1, 1):
        for i in range(4):
            z = 0.6 + i * 0.48
            box(f'ovg_stela_panel{s}{i}', (0.62, 0.04, 0.38), (0, s * 0.215, z), M['carve'], r)
            box(f'ovg_stela_glyph{s}{i}', (0.36 - 0.06 * (i % 2), 0.05, 0.22), (0.04 * (-1) ** i, s * 0.225, z), M['stone3'], r, bevel=0.01)
    sphere('ovg_stela_moss', 0.3, (0.1, 0, 2.7), M['moss'], r, scale=(1.4, 0.9, 0.35), seg=7, rings=4)


ovg_tree('ovg_tree', seed=3, tall=1.0)
ovg_tree('ovg_treeB', seed=8, tall=1.2, spread=0.8)
ovg_column(); ovg_idol(); ovg_vines(); ovg_fern(); ovg_altar(); ovg_log(); ovg_bridge(); ovg_brazier()
ovg_tent(); ovg_bedroll(); ovg_rubble(); ovg_stela(); ovg_lilies()

# triangle budget report for the overgrowth assets
for _o in bpy.data.objects:
    if _o.name.endswith('_root') and _o.name.startswith('ovg_'):
        _t = sum(sum(len(p.vertices) - 2 for p in c.data.polygons) for c in _o.children_recursive if c.type == 'MESH')
        print('ovg asset', _o.name[:-5], _t, 'tris')
