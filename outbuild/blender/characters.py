"""Original Outbuild characters: one rigged body plus swappable outfit parts.

The game clones `character.glb`, hides the parts an outfit doesn't use and recolours the
materials, so one file covers every skin. Bones are animated procedurally in the game
(`js/animator.js`), so no animation clips are exported.
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler
from mathutils.kdtree import KDTree

import common as C
import animations

# ----------------------------------------------------------------------------- skeleton
# Character faces -Y. `.L` is the character's left (+X).
ARM_DIR = Vector((0.743, 0.0, -0.669))  # A-pose, about 48 degrees from vertical
SHOULDER = Vector((0.2, 0.0, 1.415))
ELBOW = SHOULDER + ARM_DIR * 0.28 + Vector((0, 0.025, 0))
WRIST = ELBOW + ARM_DIR * 0.255 - Vector((0, 0.025, 0))
HAND_TIP = WRIST + ARM_DIR * 0.17
HIP = Vector((0.095, 0.0, 0.925))
KNEE = Vector((0.103, -0.018, 0.505))
ANKLE = Vector((0.108, 0.012, 0.095))
TOE = Vector((0.108, -0.125, 0.03))


def mirror(v):
    return Vector((-v.x, v.y, v.z))


def bone_table():
    t = [
        ('hips', (0, 0.0, 0.94), (0, 0.0, 1.06), None),
        ('spine', (0, 0.0, 1.06), (0, 0.0, 1.24), 'hips'),
        ('chest', (0, 0.0, 1.24), (0, 0.0, 1.46), 'spine'),
        ('neck', (0, 0.01, 1.46), (0, 0.0, 1.585), 'chest'),
        ('head', (0, 0.0, 1.585), (0, 0.0, 1.86), 'neck'),
    ]
    for side, f in (('L', lambda v: v), ('R', mirror)):
        t += [
            ('shoulder.' + side, f(Vector((0.035, 0.0, 1.395))), f(SHOULDER), 'chest'),
            ('upperarm.' + side, f(SHOULDER), f(ELBOW), 'shoulder.' + side),
            ('forearm.' + side, f(ELBOW), f(WRIST), 'upperarm.' + side),
            ('hand.' + side, f(WRIST), f(HAND_TIP), 'forearm.' + side),
            ('thigh.' + side, f(HIP), f(KNEE), 'hips'),
            ('shin.' + side, f(KNEE), f(ANKLE), 'thigh.' + side),
            ('foot.' + side, f(ANKLE), f(TOE), 'shin.' + side),
        ]
    return [(n, Vector(h), Vector(tl), p) for (n, h, tl, p) in t]


BONES = bone_table()
BONE = {b[0]: b for b in BONES}


def make_armature():
    arm = bpy.data.armatures.new('Rig')
    obj = bpy.data.objects.new('Rig', arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for name, head, tail, parent in BONES:
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        eb.align_roll(Vector((0, -1, 0)) if abs((tail - head).normalized().y) < 0.9 else Vector((0, 0, 1)))
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = (eb.head - ebs[parent].tail).length < 1e-4
        ebs[name] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


# ----------------------------------------------------------------------------- weights

def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length, t


def region_candidates(p):
    """Bones allowed to influence a vertex, by body region (stops limbs bleeding into each other)."""
    ax = abs(p.x)
    side = 'L' if p.x >= 0 else 'R'
    if p.z < 0.86:
        return ['thigh.' + side, 'shin.' + side, 'foot.' + side]
    if ax > 0.2 and p.z > 0.9 and p.z < 1.5:
        return ['chest', 'shoulder.' + side, 'upperarm.' + side, 'forearm.' + side, 'hand.' + side]
    if p.z < 1.02:
        return ['hips', 'spine', 'thigh.L', 'thigh.R']
    return ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'shoulder.R', 'upperarm.L', 'upperarm.R']


# Joints where a bone's weight should blend softly into its parent.
FALLOFF = {'hips': 0.07, 'spine': 0.07, 'chest': 0.08, 'neck': 0.035, 'head': 0.05}


def auto_weights(obj, rigid=None, smooth_iters=3):
    """Distance-to-bone weights, top 3 influences, then Laplacian smoothing."""
    me = obj.data
    mw = obj.matrix_world
    obj.vertex_groups.clear()
    groups = {n: obj.vertex_groups.new(name=n) for n, *_ in BONES}
    if rigid:
        idx = list(range(len(me.vertices)))
        groups[rigid].add(idx, 1.0, 'REPLACE')
        return
    weights = []
    for v in me.vertices:
        p = mw @ v.co
        cands = region_candidates(p)
        ws = {}
        for n in cands:
            _, h, t, _ = BONE[n]
            d, _ = seg_dist(p, h, t)
            ws[n] = 1.0 / (d + 0.012) ** 4
        weights.append(ws)
    # neighbour smoothing
    nbrs = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nbrs[a].append(b)
        nbrs[b].append(a)
    for i, ws in enumerate(weights):
        s = sum(ws.values())
        weights[i] = {k: w / s for k, w in ws.items()}
    for _ in range(smooth_iters):
        new = []
        for i, ws in enumerate(weights):
            acc = dict(ws)
            for j in nbrs[i]:
                for k, w in weights[j].items():
                    if k in ws:
                        acc[k] = acc.get(k, 0) + w
            s = sum(acc.values())
            new.append({k: w / s for k, w in acc.items()})
        weights = new
    for i, ws in enumerate(weights):
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:3]
        s = sum(w for _, w in top)
        for n, w in top:
            if w / s > 0.02:
                groups[n].add([i], w / s, 'REPLACE')


def bind(obj, rig, rigid=None):
    auto_weights(obj, rigid=rigid)
    obj.parent = rig
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# ----------------------------------------------------------------------------- materials

def mats():
    M = {}
    M['Skin'] = C.material('Skin', '#e0a882', rough=0.55)
    M['Top'] = C.material('Top', '#3d7fd6', rough=0.8)
    M['Sleeve'] = C.material('Sleeve', '#3d7fd6', rough=0.8)
    M['Bottom'] = C.material('Bottom', '#39414f', rough=0.85)
    M['Boots'] = C.material('Boots', '#4a3528', rough=0.6)
    M['Gloves'] = C.material('Gloves', '#2b2b2f', rough=0.6)
    M['Accent'] = C.material('Accent', '#f2a93b', rough=0.5)
    M['Gear'] = C.material('Gear', '#5b5f52', rough=0.7)
    M['Metal'] = C.material('Metal', '#a9b0b8', rough=0.35, metal=1.0)
    M['Hair'] = C.material('Hair', '#3b2618', rough=0.6)
    M['EyeWhite'] = C.material('EyeWhite', '#f4f1ec', rough=0.2)
    M['Iris'] = C.material('Iris', '#2c5b8c', rough=0.15)
    M['Dark'] = C.material('Dark', '#1a1414', rough=0.4)
    M['Lips'] = C.material('Lips', '#b86a5c', rough=0.5)
    M['Visor'] = C.material('Visor', '#39d0ff', rough=0.1, metal=0.3, emit='#39d0ff', emit_strength=2.0)
    return M


# ----------------------------------------------------------------------------- body

def skin_body(M):
    """Body built with the Skin modifier from a stick figure, then subdivided."""
    pts = []
    edges = []

    def add(p, r):
        pts.append((Vector(p), r))
        return len(pts) - 1

    pel = add((0, 0.008, 0.965), (0.165, 0.122))
    waist = add((0, 0.0, 1.10), (0.145, 0.108))
    chest = add((0, -0.01, 1.26), (0.19, 0.132))
    upc = add((0, 0.004, 1.39), (0.185, 0.118))
    neck = add((0, 0.012, 1.5), (0.064, 0.066))
    neck2 = add((0, 0.006, 1.6), (0.06, 0.062))
    edges += [(pel, waist), (waist, chest), (chest, upc), (upc, neck), (neck, neck2)]
    for f in (lambda v: v, mirror):
        hip = add(f(HIP + Vector((0, 0, -0.02))), (0.1, 0.1))
        thm = add(f((HIP * 0.55 + KNEE * 0.45) + Vector((0, 0.004, 0))), (0.088, 0.09))
        kn = add(f(KNEE), (0.066, 0.068))
        calf = add(f(KNEE * 0.55 + ANKLE * 0.45 + Vector((0, 0.012, 0))), (0.064, 0.068))
        ank = add(f(ANKLE + Vector((0, 0, 0.03))), (0.048, 0.05))
        edges += [(pel, hip), (hip, thm), (thm, kn), (kn, calf), (calf, ank)]
        sh = add(f(SHOULDER + Vector((-0.015, 0, -0.005))), (0.074, 0.076))
        uam = add(f(SHOULDER * 0.5 + ELBOW * 0.5), (0.06, 0.062))
        el = add(f(ELBOW), (0.049, 0.05))
        fam = add(f(ELBOW * 0.55 + WRIST * 0.45), (0.05, 0.046))
        wr = add(f(WRIST), (0.039, 0.035))
        edges += [(upc, sh), (sh, uam), (uam, el), (el, fam), (fam, wr)]

    me = bpy.data.meshes.new('BodySkel')
    me.from_pydata([p for p, _ in pts], edges, [])
    obj = bpy.data.objects.new('Body', me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('skin', 'SKIN')
    mod.branch_smoothing = 0.6
    mod.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for i, (_, r) in enumerate(pts):
        sv[i].radius = r
    sv[pel].use_root = True
    C.apply_modifiers(obj)
    C.subdivide(obj, 2)
    for p in obj.data.polygons:
        p.use_smooth = True
    # material zones by position
    for m in ('Skin', 'Top', 'Sleeve', 'Bottom'):
        obj.data.materials.append(M[m])
    me = obj.data
    for p in me.polygons:
        c = p.center
        ax = abs(c.x)
        on_arm = ax > 0.21 and c.z > 0.95
        if c.z > 1.49 and ax < 0.1:
            p.material_index = 0  # neck
        elif on_arm:
            along = (Vector((ax, c.y, c.z)) - SHOULDER).dot(ARM_DIR)
            p.material_index = 1 if along < 0.25 else 2  # upper arm = Top, forearm = Sleeve
        elif c.z < 1.02:
            p.material_index = 3
        else:
            p.material_index = 1
    return obj


def head_mesh(M):
    b = C.MeshBuilder()
    # skull: squashed sphere shaped into a head with a jaw
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        sx, sy, sz = 0.112, 0.122, 0.135
        if z < 0:  # jaw narrows and chin comes forward
            k = -z
            sx *= 1.0 - 0.28 * k * k
            sy *= 1.0 - 0.12 * k
            if y < 0:
                y *= 1.0 + 0.1 * k
        if y < -0.3:  # flatten the face slightly
            y = -0.3 + (y + 0.3) * 0.75
        v.co = Vector((x * sx, y * sy, z * sz))
    b.add_bm(bm, M['Skin'], Matrix.Translation((0, -0.005, 1.705)))
    bm.free()
    # ears
    for s in (1, -1):
        b.sphere(0.03, loc=(s * 0.108, 0.01, 1.70), scale=(0.45, 0.9, 1.25), mat=M['Skin'], segs=10, rings=8)
    # nose
    b.sphere(0.022, loc=(0, -0.125, 1.69), scale=(0.8, 1.0, 1.25), mat=M['Skin'], segs=10, rings=8)
    # eyes
    for s in (1, -1):
        ex = s * 0.043
        b.sphere(0.022, loc=(ex, -0.094, 1.725), scale=(1.2, 0.85, 0.95), mat=M['EyeWhite'], segs=14, rings=10)
        b.sphere(0.0125, loc=(ex + s * 0.001, -0.1105, 1.725), scale=(1, 0.5, 1.12), mat=M['Iris'], segs=12,
                 rings=8)
        b.sphere(0.0062, loc=(ex + s * 0.001, -0.1148, 1.725), scale=(1, 0.5, 1.1), mat=M['Dark'], segs=10,
                 rings=6)
        # brow
        b.box((0.042, 0.014, 0.011), loc=(s * 0.045, -0.113, 1.765), rot=(0.25, 0, -s * 0.12), mat=M['Hair'],
              bevel=0.004)
    # mouth
    b.sphere(0.03, loc=(0, -0.112, 1.635), scale=(1.0, 0.25, 0.22), mat=M['Lips'], segs=14, rings=8)
    obj = b.to_object('Head', smooth=True)
    return obj


def hand_mesh(M, side):
    """Gloved hand with fingers, built along the A-pose arm direction."""
    s = 1 if side == 'L' else -1
    b = C.MeshBuilder()
    # palm in a local frame: +Z along the hand, +X palm normal outward, Y across
    b.box((0.034, 0.078, 0.085), loc=(0, 0, 0.045), mat=M['Gloves'], bevel=0.014, bevel_segs=3)
    for i, off in enumerate((-0.028, -0.009, 0.01, 0.028)):
        ln = (0.062, 0.07, 0.066, 0.052)[i]
        b.cylinder(0.0105, ln, loc=(-0.004, off, 0.088 + ln / 2), mat=M['Gloves'], segs=8)
        b.sphere(0.0105, loc=(-0.004, off, 0.088 + ln), mat=M['Gloves'], segs=8, rings=6)
    # thumb, towards the front of the body
    b.cylinder(0.012, 0.055, loc=(-0.022, -0.04, 0.045), rot=(0.9, 0, 0), mat=M['Gloves'], segs=8)
    b.sphere(0.012, loc=(-0.022, -0.062, 0.066), mat=M['Gloves'], segs=8, rings=6)
    # cuff
    b.cylinder(0.04, 0.035, loc=(0, 0, 0.0), mat=M['Gloves'], segs=14)
    obj = b.to_object('Hand.' + side, smooth=True)
    d = ARM_DIR.copy()
    d.x *= s
    # frame: z -> arm direction, x -> palm points inward (toward the leg), y -> front/back
    z = d.normalized()
    x = Vector((-s * 0.669, 0, -0.743)).normalized() * -1  # outward normal of the back of the hand
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    rot = Matrix((x, y, z)).transposed().to_4x4()
    w = WRIST.copy()
    w.x *= s
    obj.data.transform(Matrix.Translation(w) @ rot @ Matrix.Scale(1.32, 4))
    return obj


def boot_mesh(M, side):
    s = 1 if side == 'L' else -1
    b = C.MeshBuilder()
    b.box((0.125, 0.27, 0.11), loc=(0, -0.05, 0.055), mat=M['Boots'], bevel=0.04, bevel_segs=3)
    b.box((0.13, 0.28, 0.032), loc=(0, -0.05, 0.016), mat=M['Dark'], bevel=0.013)
    b.cylinder(0.07, 0.15, loc=(0, 0.01, 0.15), mat=M['Boots'], segs=16, radius2=0.058)
    b.torus(0.064, 0.01, loc=(0, 0.01, 0.215), mat=M['Accent'], segs=16, ring_segs=6)
    obj = b.to_object('Boot.' + side, smooth=True)
    obj.data.transform(Matrix.Translation((s * ANKLE.x, 0, 0)))
    return obj


# ----------------------------------------------------------------------------- outfit parts

def shell_from_body(body, name, test, inflate, mat):
    """Copy the body faces that pass `test(center)` and push them out along their normals."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    remove = [f for f in bm.faces if not test(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=remove, context='FACES')
    for v in bm.verts:
        v.co += v.normal * inflate
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
        p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def hair_short(M):
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=1.0)
    rm = [v for v in bm.verts if v.co.z < -0.15 or (v.co.y < -0.35 and v.co.z < 0.45)]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    rnd = random.Random(3)
    for v in bm.verts:
        x, y, z = v.co
        bump = 1.0 + 0.06 * rnd.random() if z > 0.3 else 1.0
        v.co = Vector((x * 0.122 * bump, y * 0.132 * bump, z * 0.15 * bump))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    b.add_bm(bm, M['Hair'], Matrix.Translation((0, 0.002, 1.715)))
    bm.free()
    # swept fringe
    b.sphere(0.07, loc=(0.02, -0.085, 1.815), scale=(1.4, 0.7, 0.45), rot=(0.4, 0, 0.3), mat=M['Hair'], segs=14,
             rings=8)
    return b.to_object('Hair.Short', smooth=True)


def hair_long(M):
    obj = hair_short(M)
    obj.name = 'Hair.Long'
    b = C.MeshBuilder()
    b.sphere(0.11, loc=(0, 0.06, 1.6), scale=(1.12, 0.62, 1.55), mat=M['Hair'], segs=18, rings=12)
    for s in (1, -1):
        b.sphere(0.05, loc=(s * 0.1, -0.02, 1.62), scale=(0.6, 0.9, 1.8), mat=M['Hair'], segs=12, rings=8)
    extra = b.to_object('tmp', smooth=True)
    return C.join([obj, extra], 'Hair.Long')


def hair_bun(M):
    obj = hair_short(M)
    b = C.MeshBuilder()
    b.sphere(0.058, loc=(0, 0.08, 1.85), mat=M['Hair'], segs=16, rings=10)
    b.torus(0.04, 0.012, loc=(0, 0.07, 1.82), rot=(0.9, 0, 0), mat=M['Accent'], segs=14, ring_segs=6)
    extra = b.to_object('tmp', smooth=True)
    return C.join([obj, extra], 'Hair.Bun')


def hair_mohawk(M):
    b = C.MeshBuilder()
    for i in range(7):
        t = i / 6
        a = math.radians(-65 + 150 * t)
        r = 0.14
        p = (0, math.sin(a) * r * -1 + 0.01, 1.71 + math.cos(a) * r)
        b.ico(0.028 + 0.016 * math.sin(t * math.pi), loc=p, scale=(0.5, 1.2, 1.9), rot=(-a, 0, 0),
              mat=M['Hair'], subdiv=2)
    return b.to_object('Hair.Mohawk', smooth=True)


def beanie(M):
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=1.0)
    rm = [v for v in bm.verts if v.co.z < 0.05]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.13, y * 0.14, z * 0.16))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    b.add_bm(bm, M['Accent'], Matrix.Translation((0, 0.005, 1.74)))
    bm.free()
    b.torus(0.126, 0.02, loc=(0, 0.004, 1.755), rot=(-0.12, 0, 0), mat=M['Accent'], segs=28, ring_segs=8)
    b.sphere(0.035, loc=(0, 0.02, 1.915), mat=M['Top'], segs=12, rings=8)
    return b.to_object('Hat.Beanie', smooth=True)


def cap(M):
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=1.0)
    rm = [v for v in bm.verts if v.co.z < 0.0]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.128, y * 0.138, z * 0.12))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
    b.add_bm(bm, M['Accent'], Matrix.Translation((0, 0.004, 1.77)))
    bm.free()
    # brim
    prof = []
    for i in range(13):
        a = math.pi * i / 12
        prof.append((math.cos(a) * 0.11, -math.sin(a) * 0.11))
    b.extrude_profile(prof, 0.012, axis='z', loc=(0, -0.1, 1.775), rot=(-0.12, 0, 0), mat=M['Top'])
    b.sphere(0.014, loc=(0, 0.0, 1.892), mat=M['Top'], segs=8, rings=6)
    return b.to_object('Hat.Cap', smooth=True)


def helmet(M):
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=18, radius=1.0)
    rm = [v for v in bm.verts if v.co.z < -0.5 or (v.co.y < -0.2 and -0.45 < v.co.z < 0.3)]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.148, y * 0.158, z * 0.168))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.016)
    b.add_bm(bm, M['Gear'], Matrix.Translation((0, 0.004, 1.71)))
    bm.free()
    # visor
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=18, radius=1.0)
    keep_rm = [v for v in bm.verts if not (v.co.y < -0.15 and -0.5 < v.co.z < 0.35)]
    bmesh.ops.delete(bm, geom=keep_rm, context='VERTS')
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.14, y * 0.152, z * 0.16))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008)
    b.add_bm(bm, M['Visor'], Matrix.Translation((0, 0.0, 1.71)))
    bm.free()
    b.box((0.02, 0.05, 0.03), loc=(0.148, 0.0, 1.72), mat=M['Accent'], bevel=0.006)
    b.box((0.02, 0.05, 0.03), loc=(-0.148, 0.0, 1.72), mat=M['Accent'], bevel=0.006)
    b.box((0.03, 0.2, 0.02), loc=(0, 0.02, 1.885), mat=M['Accent'], bevel=0.008)
    return b.to_object('Hat.Helmet', smooth=True)


def hood(M):
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
    rm = [v for v in bm.verts if (v.co.y < -0.25 and v.co.z < 0.55) or v.co.z < -0.75]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.15, y * 0.165 + 0.01, z * 0.175))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.018)
    b.add_bm(bm, M['Top'], Matrix.Translation((0, 0.012, 1.7)))
    bm.free()
    return b.to_object('Hat.Hood', smooth=True)


def mask(M):
    """Bandana over the lower face."""
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=1.0)
    rm = [v for v in bm.verts if v.co.z > 0.05 or v.co.z < -0.85]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.122, y * 0.135, z * 0.13))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008)
    b.add_bm(bm, M['Accent'], Matrix.Translation((0, -0.008, 1.69)))
    bm.free()
    return b.to_object('Face.Mask', smooth=True)


def goggles(M):
    b = C.MeshBuilder()
    b.torus(0.126, 0.012, loc=(0, 0.0, 1.765), rot=(-0.15, 0, 0), mat=M['Dark'], segs=30, ring_segs=6)
    for s in (1, -1):
        b.cylinder(0.033, 0.03, loc=(s * 0.047, -0.118, 1.782), rot=(math.pi / 2 - 0.15, 0, 0), mat=M['Metal'],
                   segs=16)
        b.cylinder(0.027, 0.034, loc=(s * 0.047, -0.12, 1.782), rot=(math.pi / 2 - 0.15, 0, 0), mat=M['Visor'],
                   segs=16)
    return b.to_object('Face.Goggles', smooth=True)


def backpack(M):
    b = C.MeshBuilder()
    b.box((0.28, 0.14, 0.34), loc=(0, 0.2, 1.24), mat=M['Gear'], bevel=0.045, bevel_segs=3)
    b.box((0.22, 0.06, 0.16), loc=(0, 0.28, 1.17), mat=M['Gear'], bevel=0.025, bevel_segs=2)
    b.box((0.3, 0.05, 0.04), loc=(0, 0.2, 1.39), mat=M['Accent'], bevel=0.015)
    b.cylinder(0.055, 0.3, loc=(0, 0.24, 1.44), rot=(0, math.pi / 2, 0), mat=M['Accent'], segs=14)
    for s in (1, -1):
        b.box((0.035, 0.04, 0.3), loc=(s * 0.1, 0.13, 1.26), mat=M['Dark'], bevel=0.01)
    return b.to_object('Back.Pack', smooth=False, auto_smooth_angle=40)


def cape(M):
    """Short scarf + cape."""
    b = C.MeshBuilder()
    b.torus(0.08, 0.035, loc=(0, 0.0, 1.49), rot=(0.1, 0, 0), mat=M['Accent'], segs=20, ring_segs=10)
    prof = [(-0.2, 0), (0.2, 0), (0.24, -0.5), (-0.24, -0.5)]
    bm = bmesh.new()
    rows, cols = 8, 8
    vs = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for c in range(cols + 1):
            u = c / cols
            w = 0.18 + 0.1 * t
            x = (u - 0.5) * 2 * w
            y = 0.14 + 0.06 * t + 0.05 * math.cos((u - 0.5) * math.pi) ** 2 * 0.2 - 0.04 * math.cos((u - 0.5) * 3)
            z = 1.44 - 0.52 * t
            row.append(bm.verts.new((x, y + 0.02 * t * t, z)))
        vs.append(row)
    for r in range(rows):
        for c in range(cols):
            bm.faces.new((vs[r][c], vs[r][c + 1], vs[r + 1][c + 1], vs[r + 1][c]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    b.add_bm(bm, M['Accent'])
    bm.free()
    return b.to_object('Back.Cape', smooth=True)


def belt(M):
    b = C.MeshBuilder()
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=0.162, radius2=0.158, depth=0.05)
    for v in bm.verts:
        v.co.y *= 0.78
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    b.add_bm(bm, M['Dark'], Matrix.Translation((0, 0.008, 1.0)))
    bm.free()
    b.box((0.06, 0.02, 0.045), loc=(0, -0.13, 1.0), mat=M['Metal'], bevel=0.006)
    for s in (1, -1):
        b.box((0.07, 0.05, 0.08), loc=(s * 0.14, -0.05, 0.98), rot=(0, 0, s * 0.5), mat=M['Gear'], bevel=0.015)
    return b.to_object('Waist.Belt', smooth=False, auto_smooth_angle=40)


def pads(M):
    b = C.MeshBuilder()
    for s in (1, -1):
        # knee pads
        b.sphere(0.06, loc=(s * KNEE.x, KNEE.y - 0.052, KNEE.z + 0.01), scale=(1.0, 0.55, 1.2), mat=M['Gear'],
                 segs=14, rings=8)
        # shoulder pads
        b.sphere(0.085, loc=(s * (SHOULDER.x + 0.03), 0.0, SHOULDER.z + 0.02), scale=(1.0, 1.0, 0.55),
                 rot=(0, s * 0.55, 0), mat=M['Gear'], segs=16, rings=8)
    return b.to_object('Gear.Pads', smooth=True)


def vest(M, body):
    def test(c):
        return 1.03 < c.z < 1.47 and abs(c.x) < 0.2

    obj = shell_from_body(body, 'Gear.Vest', test, 0.022, M['Gear'])
    b = C.MeshBuilder()
    for s in (1, -1):
        b.box((0.07, 0.035, 0.08), loc=(s * 0.075, -0.15, 1.15), mat=M['Gear'], bevel=0.012)
        b.box((0.06, 0.03, 0.022), loc=(s * 0.075, -0.168, 1.2), mat=M['Accent'], bevel=0.006)
    extra = b.to_object('tmp', smooth=False)
    return C.join([obj, extra], 'Gear.Vest')


def jacket(M, body):
    def test(c):
        ax = abs(c.x)
        if c.z > 1.5:
            return False
        if ax > 0.21:
            along = (Vector((ax, c.y, c.z)) - SHOULDER).dot(ARM_DIR)
            return along < 0.43
        return c.z > 0.92

    return shell_from_body(body, 'Top.Jacket', test, 0.012, M['Top'])


# ----------------------------------------------------------------------------- build

PARTS_RIGID = {
    'Head': 'head', 'Hair.Short': 'head', 'Hair.Long': 'head', 'Hair.Bun': 'head', 'Hair.Mohawk': 'head',
    'Hat.Beanie': 'head', 'Hat.Cap': 'head', 'Hat.Helmet': 'head', 'Hat.Hood': 'head', 'Face.Mask': 'head',
    'Face.Goggles': 'head', 'Hand.L': 'hand.L', 'Hand.R': 'hand.R', 'Boot.L': 'foot.L', 'Boot.R': 'foot.R',
    'Back.Pack': 'chest', 'Back.Cape': 'chest',
}


def build(preview=None):
    C.reset()
    C.clear_material_cache()
    M = mats()
    rig = make_armature()
    body = skin_body(M)
    parts = [body, head_mesh(M), hand_mesh(M, 'L'), hand_mesh(M, 'R'), boot_mesh(M, 'L'), boot_mesh(M, 'R'),
             hair_short(M), hair_long(M), hair_bun(M), hair_mohawk(M), beanie(M), cap(M), helmet(M), hood(M),
             mask(M), goggles(M), backpack(M), cape(M), belt(M), pads(M), vest(M, body), jacket(M, body)]
    # boots merge onto the feet: one mesh per foot keeps the draw calls down
    for p in parts:
        bind(p, rig, rigid=PARTS_RIGID.get(p.name))
    if preview:
        for p in parts:
            p.hide_render = p.name not in ('Body', 'Head', 'Hand.L', 'Hand.R', 'Boot.L', 'Boot.R', 'Hair.Short',
                                           'Gear.Vest', 'Back.Pack', 'Waist.Belt', 'Gear.Pads')
        C.render_preview(preview, cam_loc=(1.6, -3.2, 1.5), target=(0, 0, 1.0), lens=45)
        C.render_preview(preview.replace('.png', '_face.png'), cam_loc=(0.25, -0.9, 1.72), target=(0, 0, 1.7),
                         lens=60)
        for p in parts:
            p.hide_render = False
    animations.add_clips(rig)
    C.export_glb('character.glb', [rig], skins=True, anims=True)
    return rig, parts


if __name__ == '__main__':
    import sys
    build(sys.argv[-1] if sys.argv[-1].endswith('.png') else None)
