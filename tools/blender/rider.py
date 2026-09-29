"""Builds Canyon Rush's rider in Blender and exports canyon-rush/models/rider.glb.

Run it with Blender's Python module (pip install bpy==4.2.0, Python 3.11):
    python tools/blender/rider.py [out.glb] [--preview preview.png]
or inside Blender: blender -b -P tools/blender/rider.py -- [out.glb]

The body is a skin-modifier mesh grown over a simple skeleton, smoothed and
weighted to an armature, so it bends at the joints when the game poses it.
The kit is motocross: jersey with side panels, pants, knee-high boots with
buckles, gloves, a neck brace, and a helmet with a chin bar, a peak and
goggles. Materials are named after the part they cover (jersey, jersey2,
pants, boots, gloves, helmet, helmet2, lens, dark); the game recolours them
for each bike's rider. The character faces +Y here, which is -Z in glTF.
"""
import math
import os
import sys

import bpy  # noqa: I001  (first: it sets up bmesh and mathutils)
import bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = next((a for a in args if a.endswith('.glb')), os.path.join(ROOT, 'canyon-rush', 'models', 'rider.glb'))
PREVIEW = args[args.index('--preview') + 1] if '--preview' in args else None

V = Vector


def unit(*c):
    return V(c).normalized()


# ---------------------------------------------------------------- skeleton
# Character space: x to the rider's right, y forward, z up, feet on z = 0.
# Rest pose: standing, arms down and a little forward, elbows and knees
# slightly bent (so the game can tell which way they fold).
J = {
    'pelvis': V((0, 0.0, 0.985)),
    'waist': V((0, -0.012, 1.12)),
    'belly': V((0, -0.02, 1.24)),
    'chest': V((0, -0.022, 1.35)),
    'upchest': V((0, -0.028, 1.43)),
    'neck': V((0, -0.022, 1.495)),
    'skull': V((0, -0.006, 1.56)),
    'headc': V((0, 0.012, 1.655)),
}
LEN = {'thigh': 0.44, 'shin': 0.43, 'upper': 0.29, 'fore': 0.27, 'hand': 0.1}
SIDES = (('L', -1), ('R', 1))
for side, s in SIDES:
    J['clav' + side] = V((s * 0.035, -0.026, 1.435))
    J['shoulder' + side] = V((s * 0.185, -0.032, 1.42))
    J['elbow' + side] = J['shoulder' + side] + LEN['upper'] * unit(s * 0.5, 0.16, -0.85)
    J['wrist' + side] = J['elbow' + side] + LEN['fore'] * unit(s * 0.34, 0.42, -0.84)
    J['hand' + side] = J['wrist' + side] + LEN['hand'] * unit(s * 0.28, 0.46, -0.84)
    J['hip' + side] = V((s * 0.1, 0.0, 0.965))
    J['knee' + side] = J['hip' + side] + LEN['thigh'] * unit(0, 0.06, -1)
    J['ankle' + side] = J['knee' + side] + LEN['shin'] * unit(0, -0.06, -1)
    J['toe' + side] = J['ankle' + side] + V((0, 0.175, -0.055))

# Bones: name -> (head, tail, parent)
BONES = {
    'hips': ('pelvis', 'waist', None),
    'spine': ('waist', 'chest', 'hips'),
    'chest': ('chest', 'neck', 'spine'),
    'neck': ('neck', 'skull', 'chest'),
    'head': ('skull', 'headc', 'neck'),
}
for side, s in SIDES:
    BONES['shoulder' + side] = ('clav' + side, 'shoulder' + side, 'chest')
    BONES['upperArm' + side] = ('shoulder' + side, 'elbow' + side, 'shoulder' + side)
    BONES['foreArm' + side] = ('elbow' + side, 'wrist' + side, 'upperArm' + side)
    BONES['hand' + side] = ('wrist' + side, 'hand' + side, 'foreArm' + side)
    BONES['thigh' + side] = ('hip' + side, 'knee' + side, 'hips')
    BONES['shin' + side] = ('knee' + side, 'ankle' + side, 'thigh' + side)
    BONES['foot' + side] = ('ankle' + side, 'toe' + side, 'shin' + side)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_material(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


MATS = {}


def materials():
    spec = {
        'jersey': ((0.03, 0.03, 0.035), 0.85),
        'jersey2': ((0.25, 0.9, 0.1), 0.85),
        'pants': ((0.04, 0.04, 0.045), 0.8),
        'boots': ((0.9, 0.9, 0.88), 0.5),
        'gloves': ((0.25, 0.9, 0.1), 0.75),
        'helmet': ((0.92, 0.92, 0.9), 0.35),
        'helmet2': ((0.25, 0.9, 0.1), 0.35),
        'lens': ((0.05, 0.03, 0.01), 0.06),
        'dark': ((0.02, 0.02, 0.022), 0.6),
    }
    for name, (c, r) in spec.items():
        MATS[name] = new_material(name, c, r)


# ---------------------------------------------------------------- body
def body_mesh():
    """Skin-modifier body: a vertex per point with a radius (side, depth)."""
    pts, radii, edges = [], [], []

    def P(p, rx, ry):
        pts.append(V(p))
        radii.append((rx, ry))
        return len(pts) - 1

    def chain(ids):
        for a, b in zip(ids, ids[1:]):
            edges.append((a, b))

    lerp = lambda a, b, t: a.lerp(b, t)
    pelvis = P(J['pelvis'], 0.165, 0.138)
    waist = P(J['waist'], 0.152, 0.13)
    belly = P(J['belly'], 0.17, 0.145)
    chest = P(J['chest'], 0.185, 0.152)
    upchest = P(J['upchest'], 0.17, 0.128)
    neck = P(J['neck'], 0.06, 0.06)
    skull = P(J['skull'], 0.058, 0.062)
    head = P(J['headc'], 0.082, 0.095)
    chain([pelvis, waist, belly, chest, upchest, neck, skull, head])
    for side, s in SIDES:
        sh = P(J['shoulder' + side], 0.078, 0.08)
        ua = P(lerp(J['shoulder' + side], J['elbow' + side], 0.5), 0.064, 0.066)
        el = P(J['elbow' + side], 0.056, 0.058)
        fa = P(lerp(J['elbow' + side], J['wrist' + side], 0.5), 0.056, 0.053)
        cuff = P(lerp(J['elbow' + side], J['wrist' + side], 0.86), 0.05, 0.047)
        wr = P(J['wrist' + side], 0.038, 0.033)
        pm = P(lerp(J['wrist' + side], J['hand' + side], 0.45), 0.047, 0.03)
        fi = P(J['hand' + side], 0.038, 0.025)
        chain([upchest, sh, ua, el, fa, cuff, wr, pm, fi])
        hp = P(J['hip' + side], 0.1, 0.105)
        th = P(lerp(J['hip' + side], J['knee' + side], 0.5), 0.094, 0.096)
        kn = P(J['knee' + side], 0.08, 0.09)
        bt = P(lerp(J['knee' + side], J['ankle' + side], 0.2), 0.084, 0.086)
        ca = P(lerp(J['knee' + side], J['ankle' + side], 0.55), 0.076, 0.08)
        an = P(J['ankle' + side], 0.066, 0.076)
        fm = P(lerp(J['ankle' + side], J['toe' + side], 0.5) + V((0, 0, -0.018)), 0.058, 0.05)
        to = P(J['toe' + side] + V((0, 0.012, 0)), 0.05, 0.038)
        chain([pelvis, hp, th, kn, bt, ca, an, fm, to])
        heel = P(J['ankle' + side] + V((0, -0.045, -0.052)), 0.05, 0.042)
        chain([an, heel])

    me = bpy.data.meshes.new('body')
    me.from_pydata([tuple(p) for p in pts], edges, [])
    ob = bpy.data.objects.new('body', me)
    bpy.context.collection.objects.link(ob)
    mod = ob.modifiers.new('skin', 'SKIN')
    mod.branch_smoothing = 0.6
    mod.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for i, (rx, ry) in enumerate(radii):
        sv[i].radius = (rx, ry)
    sv[pelvis].use_root = True
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier='skin')
    bpy.ops.object.modifier_apply(modifier='sub')
    ob.select_set(False)
    return ob


# ---------------------------------------------------------------- kit
def bm_to_object(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(MATS[mat])
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def helmet():
    """MX helmet: a shell that runs out into a pointed chin bar, an eye port with
    goggles (frame, lens and a strap round the back), a peak over the port, a
    stripe over the top and a mouthpiece vent. The shell is one deformed sphere;
    the port, goggles and strap follow its latitude/longitude grid, so their
    edges are clean."""
    c = J['headc'] + V((0, 0.012, -0.004))
    SX, SY, SZ = 0.12, 0.142, 0.132

    def shape(p):
        x, y, z = p
        front = smoothstep(0.15, 1.0, y)
        low = smoothstep(0.05, -0.78, z)
        k = front * low
        y2 = y + 0.95 * k + 0.06 * max(0.0, -y) * smoothstep(-0.2, -0.85, z)
        z2 = z - 0.2 * k
        x2 = x * (1 - 0.5 * k)
        return V((x2 * SX, y2 * SY, z2 * SZ))

    def latlon(p):
        x, y, z = p
        return math.asin(max(-1.0, min(1.0, z))), math.atan2(x, y)

    PORT = (-0.03, 0.43, 0.98)      # latitude range and half-width in longitude (radians)
    FRAME = (-0.15, 0.55, 1.1)

    def region(p):
        lat, lon = latlon(p)
        if lat < -0.96:
            return None
        if PORT[0] < lat < PORT[1] and abs(lon) < PORT[2]:
            return 'lens'
        if FRAME[0] < lat < FRAME[1] and abs(lon) < FRAME[2]:
            return 'frame'
        if 0.08 < lat < 0.3:
            return 'strap'
        if lat < FRAME[0] and abs(lon) < 0.75:
            return 'chin'
        return 'shell'

    def cut(keep, out=0.0, seg=(64, 40)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
        centers = {f: f.calc_center_median().normalized() for f in bm.faces}
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if region(centers[f]) not in keep], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        for f in bm.faces:
            f.material_index = 1 if region(centers[f]) in ('chin', 'strap') else 0
        for v in bm.verts:
            n = v.co.normalized()
            v.co = shape(n) + c + V((n.x / SX, n.y / SY, n.z / SZ)).normalized() * out
        return bm

    parts = []
    shell = bm_to_object(cut({'shell', 'chin', 'strap'}), 'helmet', 'helmet')
    shell.data.materials.append(MATS['helmet2'])
    sol = shell.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.011
    sol.offset = -1
    parts.append(shell)
    parts.append(bm_to_object(cut({'lens'}, out=-0.003), 'lens', 'lens'))
    frame = bm_to_object(cut({'frame'}, out=0.004), 'goggles', 'dark')
    frame.modifiers.new('sol', 'SOLIDIFY').thickness = 0.014
    parts.append(frame)

    def strip(name, mat, pts_fn, n, out):
        """A band laid on the shell between the unit-sphere curves pts_fn(t, -1) and pts_fn(t, 1)."""
        bm = bmesh.new()
        rows = []
        for i in range(n + 1):
            t = i / n
            a, b = pts_fn(t, -1), pts_fn(t, 1)
            row = []
            for q in (a, b):
                q = q.normalized()
                row.append(bm.verts.new(shape(q) + c + V((q.x / SX, q.y / SY, q.z / SZ)).normalized() * out))
            rows.append(row)
        for i in range(n):
            bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
        return bm_to_object(bm, name, mat)

    # Stripe from the brow over the crown and down the back.
    parts.append(strip('stripe', 'helmet2', lambda t, side: V((0.1 * side, math.cos(0.95 + t * 2.9), math.sin(0.95 + t * 2.9))), 40, 0.0015))

    # Peak: from the brow above the port, out and up a little, drooping at the sides.
    bm = bmesh.new()
    nu, nv = 16, 6
    grid = []
    for j in range(nv + 1):
        t = j / nv
        row = []
        for i in range(nu + 1):
            u = i / nu * 2 - 1
            lon = u * 0.95
            lat = FRAME[1] + 0.02
            q = V((math.sin(lon) * math.cos(lat), math.cos(lon) * math.cos(lat), math.sin(lat)))
            base = shape(q) + c
            p = base + V((u * 0.012 * t, 0.135 * t, 0.022 * t - 0.022 * u * u * t))
            row.append(bm.verts.new(p))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    peak = bm_to_object(bm, 'peak', 'helmet2')
    peak.modifiers.new('sol', 'SOLIDIFY').thickness = 0.007
    parts.append(peak)

    # Mouthpiece vent at the point of the chin bar.
    q = V((0.0, math.cos(-0.62), math.sin(-0.62)))
    tip = shape(q) + c
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = tip + V((v.co.x * 0.052, v.co.y * 0.02 + 0.002, v.co.z * 0.036))
    vent = bm_to_object(bm, 'vent', 'dark')
    vent.modifiers.new('bev', 'BEVEL').width = 0.006
    parts.append(vent)
    return parts


def neck_brace():
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=1.0)
    ring = list(bm.verts)
    ret = bmesh.ops.extrude_edge_only(bm, edges=list(bm.edges))
    top = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]
    base = J['neck'] + V((0, 0, -0.04))
    for v in ring:
        a = math.atan2(v.co.y, v.co.x)
        v.co = base + V((math.cos(a) * 0.135, math.sin(a) * 0.115 - 0.005, -0.012 * math.sin(a)))
    for v in top:
        a = math.atan2(v.co.y, v.co.x)
        v.co = base + V((math.cos(a) * 0.09, math.sin(a) * 0.078, 0.05 - 0.012 * math.sin(a)))
    ob = bm_to_object(bm, 'brace', 'helmet')
    so = ob.modifiers.new('sol', 'SOLIDIFY')
    so.thickness = 0.014
    return ob


def buckles(side):
    """Three straps with buckles round each boot, facing out."""
    s = dict(SIDES)[side]
    obs = []
    for k, t in enumerate((0.3, 0.55, 0.8)):
        p = J['knee' + side].lerp(J['ankle' + side], t)
        bm = bmesh.new()
        bmesh.ops.create_cylinder(bm, cap_ends=False, segments=20, radius1=1.0, radius2=1.0, depth=1.0) if hasattr(bmesh.ops, 'create_cylinder') else bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=1.0, radius2=1.0, depth=1.0)
        r = 0.083 - 0.008 * t
        for v in bm.verts:
            v.co = p + V((v.co.x * r, v.co.y * r * 1.03, v.co.z * 0.022))
        strap = bm_to_object(bm, f'strap{side}{k}', 'dark')
        strap.modifiers.new('sol', 'SOLIDIFY').thickness = 0.004
        obs.append(strap)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = p + V((s * (r + 0.006) + v.co.x * 0.012, 0.01 + v.co.y * 0.04, v.co.z * 0.03))
        obs.append(bm_to_object(bm, f'buckle{side}{k}', 'helmet2' if k == 1 else 'dark'))
    return obs


# ---------------------------------------------------------------- rig
def armature():
    arm_data = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rider', arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    for name, (h, t, parent) in BONES.items():
        b = eb.new(name)
        b.head = J[h]
        b.tail = J[t]
        # Roll so each bone's Z axis points forward (or up, for the feet).
        b.align_roll(V((0, 0, 1)) if name.startswith('foot') else V((0, 1, 0)))
        if parent:
            b.parent = eb[parent]
            b.use_connect = (J[BONES[parent][1]] - J[h]).length < 1e-6
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    return arm


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length, t


def assign_materials(body):
    """Paint the one-piece body by region: jersey, side panels, pants, boots, gloves, collar."""
    me = body.data
    order = ['jersey', 'jersey2', 'pants', 'boots', 'gloves', 'dark']
    for n in order:
        me.materials.append(MATS[n])
    idx = {n: i for i, n in enumerate(order)}
    for poly in me.polygons:
        c = poly.center
        best, bname, bt = 1e9, None, 0
        for name, (h, t, _) in BONES.items():
            d, u = seg_dist(c, J[h], J[t])
            if d < best:
                best, bname, bt = d, name, u
        mat = 'jersey'
        if bname == 'hips':
            mat = 'jersey' if c.z > 1.075 else 'pants'
        elif bname in ('spine', 'chest'):
            # Side panels down the ribs.
            mat = 'jersey2' if (abs(poly.normal.x) > 0.82 and 1.12 < c.z < 1.4) else 'jersey'
        elif bname in ('neck', 'head'):
            mat = 'dark'
        elif bname.startswith('shoulder') or bname.startswith('upperArm'):
            mat = 'jersey2' if (bname.startswith('upperArm') and 0.3 < bt < 0.45) else 'jersey'
        elif bname.startswith('foreArm'):
            mat = 'gloves' if bt > 0.82 else ('jersey2' if 0.55 < bt < 0.66 else 'jersey')
        elif bname.startswith('hand'):
            mat = 'gloves'
        elif bname.startswith('thigh'):
            mat = 'pants'
        elif bname.startswith('shin'):
            mat = 'pants' if bt < 0.1 else 'boots'
        elif bname.startswith('foot'):
            mat = 'dark' if (c.z < 0.012) else 'boots'
        poly.material_index = idx[mat]


def weight_rigid(ob, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')


def smooth_weights(body):
    """Weights from distance to each bone, blended across the joints."""
    groups = {name: body.vertex_groups.new(name=name) for name in BONES}
    for v in body.data.vertices:
        p = v.co
        scored = []
        for name, (h, t, _) in BONES.items():
            d, _ = seg_dist(p, J[h], J[t])
            scored.append((d, name))
        scored.sort()
        d0 = scored[0][0]
        picks = [(d, n) for d, n in scored[:3] if d < d0 + 0.05]
        ws = [(math.exp(-((d - d0) / 0.018) ** 2), n) for d, n in picks]
        tot = sum(w for w, _ in ws)
        for w, n in ws:
            groups[n].add([v.index], w / tot, 'REPLACE')


def build():
    clear_scene()
    materials()
    body = body_mesh()
    assign_materials(body)
    arm = armature()

    # Weights: Blender's bone heat where it works, else distance-based.
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        ok = all(len(v.groups) > 0 for v in body.data.vertices)
    except Exception as e:  # noqa: BLE001
        print('bone heat failed:', e)
        ok = False
    if not ok:
        print('using distance weights')
        body.vertex_groups.clear()
        body.parent = None
        body.modifiers.clear()
        smooth_weights(body)
        body.parent = arm
        body.modifiers.new('arm', 'ARMATURE').object = arm

    # Rigid kit, joined into the body with full weight on one bone.
    rigid = [(o, 'head') for o in helmet()] + [(neck_brace(), 'chest')]
    for side, _ in SIDES:
        rigid += [(o, 'shin' + side) for o in buckles(side)]
    for o, bone in rigid:
        for m in list(o.modifiers):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
        weight_rigid(o, bone)
    bpy.ops.object.select_all(action='DESELECT')
    for o, _ in rigid:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = 'riderMesh'
    body.data.name = 'riderMesh'
    for p in body.data.polygons:
        p.use_smooth = True
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f'rider: {len(body.data.vertices)} vertices, {tris} triangles')
    return arm, body


def export(arm, body):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
        export_skins=True, export_animations=False, export_morph=False,
        export_texcoords=False, export_normals=True, export_materials='EXPORT',
        export_def_bones=False,
    )
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


def preview(path):
    """Quick Cycles renders of the rider (3/4 front, side, back, helmet close-up),
    for checking the model without the game: <path>_<view>.png."""
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (0.8, 0.2, 0.6)
    bpy.context.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.5, 0.45, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 600
    scene.render.resolution_y = 600
    views = {
        'front': ((1.5, 2.3, 1.2), (0, 0, 0.92), 42),
        'side': ((2.9, 0.1, 1.0), (0, 0, 0.92), 42),
        'back': ((-1.2, -2.4, 1.5), (0, 0, 0.95), 42),
        'helmet': ((0.45, 0.62, 1.72), (0, 0.03, 1.64), 55),
        'helmetside': ((0.75, 0.05, 1.68), (0, 0.03, 1.64), 55),
    }
    base = path[:-4] if path.endswith('.png') else path
    for name, (loc, at, lens) in views.items():
        cam.location = loc
        cam.rotation_euler = (V(at) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
        cam_data.lens = lens
        scene.render.filepath = f'{base}_{name}.png'
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    arm, body = build()
    export(arm, body)
    if PREVIEW:
        preview(PREVIEW)
