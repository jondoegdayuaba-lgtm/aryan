"""Original Outbuild environment props: trees, bushes, rocks, vehicles, farm/street props, landmarks.

Everything is built procedurally with bmesh (headless-safe) and exported to one file:
    ../assets/models/props.glb

Conventions (the game depends on them)
--------------------------------------
* 1 unit = 1 m, Z up, every prop is ONE mesh object built at the world origin, origin at the centre of
  its base (z = 0 is ground contact), front faces -Y. Natural props (trees, rocks, stumps) reach a little
  below z = 0 so they never float on sloped terrain.
* Custom properties (glTF extras -> three.js userData): col ('cyl' + r, h | 'box' + sx, sy, sz | 'none'),
  hp (int), mat ('wood' | 'stone' | 'metal').  Windmill also has hub_z (the separate Windmill_Blades
  object pivots at (0, 0, hub_z) in Windmill space; blades spin about the Y axis).
* Colour attribute 'Color' (POINT, BYTE_COLOR, active -> COLOR_0): R = baked ambient occlusion,
  G = wind sway weight (foliage only), B = 1.
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise
from mathutils.bvhtree import BVHTree

import common as C

M = {}


def mats():
    M.clear()

    def m(name, *a, **k):
        M[name] = C.material(name, *a, **k)

    m('Bark', '#7a5234', rough=0.9)
    m('BarkBirch', '#eeeae0', rough=0.75)
    m('Leaves', '#4f9e3a', rough=0.8)
    m('LeavesPine', '#2c6a50', rough=0.85)
    m('LeavesLight', '#9ec646', rough=0.8)
    # leaf cards: cut-out leaf clusters (the game draws the leaf texture, alpha-tested and double sided)
    m('LeafCard', '#5aa53c', rough=0.75)
    m('LeafCardLight', '#a3cf4e', rough=0.75)
    m('LeafCardPine', '#2f7356', rough=0.8)
    m('PalmLeaf', '#5fb043', rough=0.7)
    m('Rock', '#8e9299', rough=0.85)
    m('RockMoss', '#6e9d44', rough=0.9)
    m('Wood', '#c48d58', rough=0.8)
    m('WoodDark', '#5f402c', rough=0.85)
    m('Metal', '#8d97a2', rough=0.4, metal=0.8)
    m('MetalPainted', '#3d7fc4', rough=0.5, metal=0.25)
    m('Rust', '#8a4a2e', rough=0.92, metal=0.15)
    m('Rubber', '#2a2a2f', rough=0.85)
    m('Glass', '#8ccbea', rough=0.18, metal=0.3)
    m('Chrome', '#e4e9ef', rough=0.12, metal=1.0)
    m('CarPaint', '#e2473a', rough=0.3, metal=0.15)
    m('LightEmit', '#fff2cc', rough=0.3, emit='#ffd98a', emit_strength=4.0)
    m('RedLight', '#ff3a2e', rough=0.3, emit='#ff2a1a', emit_strength=5.0)
    m('Hay', '#e4c162', rough=0.95)
    m('Concrete', '#b8b4ab', rough=0.9)
    m('Plastic', '#f28a2b', rough=0.5)
    m('RedPaint', '#d03b2c', rough=0.45)
    m('WhitePaint', '#f1eee6', rough=0.5)


# =============================================================================================== helpers

def V(x, y, z):
    return Vector((x, y, z))


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def frame_matrix(z_axis, hint=None):
    """Rotation matrix whose local Z follows `z_axis` and local Y leans towards `hint`."""
    z = Vector(z_axis).normalized()
    h = Vector(hint) if hint is not None else Vector((0, 0, 1))
    if abs(h.normalized().dot(z)) > 0.95:
        h = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    x = h.cross(z).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def beam(b, p0, p1, w, h, mat, hint=None, bevel=0.0, segs=1):
    """Box from p0 to p1 with a w x h cross-section (local Y of the section leans towards `hint`)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    rot = frame_matrix(d, hint).to_euler()
    b.box((w, h, d.length), loc=(p0 + p1) / 2, rot=rot, mat=mat, bevel=bevel, bevel_segs=segs)


def rod(b, p0, p1, r, mat, segs=6, r2=None, cap=True):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    rot = frame_matrix(d).to_euler()
    b.cylinder(r, d.length, loc=(p0 + p1) / 2, rot=rot, mat=mat, segs=segs, radius2=r2, cap=cap)


def box_m(b, size, matrix, mat, bevel=0.0, segs=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=segs, affect='EDGES',
                        profile=0.5, clamp_overlap=True)
    b.add_bm(bm, mat, matrix)
    bm.free()


def add_local(b, bm, mats_, matrix=None):
    """Merge a bmesh whose face material_index values index into `mats_`."""
    me = bpy.data.meshes.new('tmp')
    bm.to_mesh(me)
    if matrix is not None:
        me.transform(matrix)
    before = set(b.bm.faces)
    b.bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    remap = [b.mat_index(m) for m in mats_]
    for f in b.bm.faces:
        if f not in before:
            f.material_index = remap[min(f.material_index, len(remap) - 1)]


def add_fn(b, bm, fn, matrix=None):
    """Merge a bmesh, choosing each face's material with fn(center, normal)."""
    me = bpy.data.meshes.new('tmp')
    bm.to_mesh(me)
    if matrix is not None:
        me.transform(matrix)
    before = set(b.bm.faces)
    b.bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    for f in b.bm.faces:
        if f not in before:
            f.material_index = b.mat_index(fn(f.calc_center_median(), f.normal))


def loft(rings, close_start=True, close_end=True):
    """bmesh skinned through rings (lists of points, all the same length, or a single point for a tip)."""
    bm = bmesh.new()
    vr = []
    for ring in rings:
        if isinstance(ring, Vector):
            vr.append([bm.verts.new(ring)])
        else:
            vr.append([bm.verts.new(p) for p in ring])
    n = max(len(r) for r in vr)
    for i in range(len(vr) - 1):
        A, B = vr[i], vr[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(n):
            k2 = (k + 1) % n
            if len(B) == 1:
                bm.faces.new((A[k], A[k2], B[0]))
            elif len(A) == 1:
                bm.faces.new((A[0], B[k2], B[k]))
            else:
                bm.faces.new((A[k], A[k2], B[k2], B[k]))
    if close_start and len(vr[0]) > 2:
        bm.faces.new(list(reversed(vr[0])))
    if close_end and len(vr[-1]) > 2:
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def path_frames(pts):
    tans = []
    n = len(pts)
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tans.append(t.normalized())
    ref = Vector((1, 0, 0)) if abs(tans[0].x) < 0.9 else Vector((0, 1, 0))
    nn = tans[0].cross(ref).normalized()
    out = []
    for t in tans:
        nn = (nn - t * nn.dot(t)).normalized()
        out.append((t, nn, t.cross(nn)))
    return out


def tube_rings(pts, radii, segs=8, rfn=None, jitter=0.0, seed=0, phase=0.0):
    pts = [Vector(p) for p in pts]
    rnd = random.Random(seed)
    rings = []
    for i, (p, (t, nn, bb)) in enumerate(zip(pts, path_frames(pts))):
        r = radii[i]
        if r <= 1e-4:
            rings.append(p.copy())
            continue
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs + phase
            rr = rfn(i, a, r) if rfn else r
            if jitter:
                rr *= 1 + (rnd.random() - 0.5) * 2 * jitter
            ring.append(p + (nn * math.cos(a) + bb * math.sin(a)) * rr)
        rings.append(ring)
    return rings


def tube(b, pts, radii, mat, segs=8, rfn=None, jitter=0.0, seed=0, cap_start=True, cap_end=True, phase=0.0):
    bm = loft(tube_rings(pts, radii, segs, rfn, jitter, seed, phase), cap_start, cap_end)
    b.add_bm(bm, mat)
    bm.free()


def flare(lobes, amp, n_rings, phase=0.3):
    def f(i, a, r):
        if i >= n_rings:
            return r
        k = 1.0 - i / n_rings
        return r * (1 + amp * k * max(0.0, math.cos(lobes * a + phase)) ** 2)
    return f


def lathe_mats(b, profile, mats_, segs=16, matrix=None, close=False, phase=0.0):
    """Revolve (r, z) points around Z; mats_[i] is the material of the band between point i and i+1.
    A radius of 0 makes a pole. close=True joins the last point back to the first (torus-like)."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        if r <= 1e-5:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs + phase),
                                        r * math.sin(2 * math.pi * i / segs + phase), z)) for i in range(segs)])
    n = len(rings)
    last = n if close else n - 1
    for k in range(last):
        A, B = rings[k], rings[(k + 1) % n]
        mi = k if k < len(mats_) else len(mats_) - 1
        for i in range(segs):
            j = (i + 1) % segs
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                f = bm.faces.new((A[0], B[i], B[j]))
            elif len(B) == 1:
                f = bm.faces.new((A[i], A[j], B[0]))
            else:
                f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    add_local(b, bm, mats_, matrix)
    bm.free()


def prism_x(profile, width, x0=0.0):
    """Extrude a closed (y, z) profile along X, centred on x0."""
    bm = bmesh.new()
    d = width / 2
    A = [bm.verts.new((x0 + d, y, z)) for (y, z) in profile]
    B = [bm.verts.new((x0 - d, y, z)) for (y, z) in profile]
    bm.faces.new(A)
    bm.faces.new(list(reversed(B)))
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((A[i], B[i], B[j], A[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bevel_sharp(bm, offset, segs=2, angle=25, edges=None):
    thr = math.radians(angle)
    src = edges if edges is not None else bm.edges
    es = [e for e in src if e.is_valid and len(e.link_faces) == 2 and e.calc_face_angle(0) > thr]
    if es:
        bmesh.ops.bevel(bm, geom=es, offset=offset, segments=segs, affect='EDGES', profile=0.5,
                        clamp_overlap=True)


def arch_pts(yc, zc, R, z_floor, n=8):
    """Wheel-arch arc from the +Y side over the top to the -Y side, meeting the floor line."""
    a0 = -math.asin(clamp((zc - z_floor) / R, -1, 1))
    return [(yc + R * math.cos(a0 + (math.pi - 2 * a0) * i / n), zc + R * math.sin(a0 + (math.pi - 2 * a0) * i / n))
            for i in range(n + 1)]


def cut(bm, co, no):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no), clear_outer=True)
    edges = [e for e in r['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)


_MB = [0]


def blob_bm(elems, target_tris, res=0.2, threshold=0.6, stiff=8.0, amp=0.0, freq=1.0, seed=0):
    """Merged blobby volume from metaball ellipsoids [(center, visual_radius, (sx, sy, sz)), ...],
    decimated to about `target_tris`."""
    _MB[0] += 1
    name = 'MBlob%d' % _MB[0]
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = threshold
    # with stiffness s the field (1 - d^2/R^2)^3 * s hits `threshold` at d = k R
    k = math.sqrt(1 - (threshold / stiff) ** (1 / 3))
    for e in elems:
        el = mb.elements.new(type='ELLIPSOID')
        el.co = e[0]
        el.radius = e[1] / k
        sc = e[2] if len(e) > 2 else (1, 1, 1)
        el.size_x, el.size_y, el.size_z = sc
        el.stiffness = stiff
    ob = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    tmp = bpy.data.objects.new(name + 'm', me)
    bpy.context.scene.collection.objects.link(tmp)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > target_tris:
        mod = tmp.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target_tris / tris
        C.apply_modifiers(tmp)
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    old = tmp.data
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(old)
    bm.normal_update()
    if amp:
        rnd = random.Random(seed)
        off = Vector((rnd.uniform(-40, 40), rnd.uniform(-40, 40), rnd.uniform(-40, 40)))
        for v in bm.verts:
            v.co += v.normal * amp * noise.noise(v.co * freq + off)
        bm.normal_update()
    return bm


def rock_bm(size, seed, cuts=4, subdiv=2, amp=0.2, freq=1.1, sink=0.12, base_cut=0.2, up_bias=0.5, top_cut=None):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((rnd.uniform(-60, 60), rnd.uniform(-60, 60), rnd.uniform(-60, 60)))
    for v in bm.verts:
        d = v.co.normalized()
        n1 = noise.noise(d * freq + off)
        n2 = noise.noise(d * freq * 2.4 + off * 1.3)
        n3 = noise.noise(d * freq * 6.0 + off * 0.7)
        v.co = d * (1 + amp * n1 + amp * 0.35 * n2 + amp * 0.12 * n3)
        v.co.x *= size[0] / 2
        v.co.y *= size[1] / 2
        v.co.z *= size[2] / 2
    for i in range(cuts):
        th = rnd.uniform(0, 2 * math.pi)
        el = rnd.uniform(-0.2, 1.0) if rnd.random() < up_bias else rnd.uniform(-0.3, 0.35)
        no = Vector((math.cos(el) * math.cos(th), math.cos(el) * math.sin(th), math.sin(el))).normalized()
        ext = max(v.co.dot(no) for v in bm.verts)
        cut(bm, no * ext * rnd.uniform(0.7, 0.88), no)
    if top_cut is not None:
        no = Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 1)).normalized()
        cut(bm, (0, 0, size[2] / 2 * top_cut), no)
    zmin = min(v.co.z for v in bm.verts)
    cut(bm, (0, 0, zmin + size[2] * base_cut), (0, 0, -1))
    zmin = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -zmin - sink), verts=bm.verts)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.2), verts=bm.verts, edges=bm.edges)
    bm.normal_update()
    return bm


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ----------------------------------------------------------------------------------------- vertex colours

def _sphere_dirs(n):
    ga = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(n):
        z = 1 - (i + 0.5) / n * 2
        r = math.sqrt(max(0.0, 1 - z * z))
        out.append(Vector((math.cos(ga * i) * r, math.sin(ga * i) * r, z)))
    return out


def bake_colors(obj, strength=0.55, dist=1.0, samples=20, wind=None, ground=True, shade=None, smooth_iters=1):
    """R = ambient occlusion (self + ground plane), G = wind weight, B = 1  ->  'Color' (active)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    dirs = _sphere_dirs(samples * 2)
    names = [m.name if m else '' for m in me.materials]
    eps = 0.004 + dist * 0.004
    ao = []
    buried = []
    for v in bm.verts:
        n = v.normal if v.normal.length > 0.5 else Vector((0, 0, 1))
        o = v.co + n * eps
        occ = tot = 0.0
        back = cnt = 0
        for d in dirs:
            c = d.dot(n)
            if c <= 0.02:
                continue
            tot += c
            cnt += 1
            hit = tree.ray_cast(o, d, dist)
            if hit[0] is not None:
                if hit[1].dot(d) > 0.0:
                    # we are inside another part: that hit says nothing about visible occlusion
                    back += 1
                    continue
                occ += c * (1.0 - 0.5 * hit[3] / dist)
            elif ground and d.z < -0.02 and o.z > -0.02:
                t = (o.z + 0.02) / -d.z
                if t < dist:
                    occ += c * (1.0 - 0.5 * t / dist)
        ao.append(1.0 - strength * occ / max(tot, 1e-6))
        buried.append(back > 0.45 * max(cnt, 1))
    # vertices buried inside other parts would smear darkness (or false light) across whole faces:
    # give them the average of their exposed neighbours instead
    for _ in range(3):
        for v in bm.verts:
            if buried[v.index]:
                nb = [e.other_vert(v).index for e in v.link_edges if not buried[e.other_vert(v).index]]
                if nb:
                    ao[v.index] = sum(ao[i] for i in nb) / len(nb)
                    buried[v.index] = False
    # soften the per-vertex noise
    for _ in range(smooth_iters):
        new = []
        for v in bm.verts:
            nb = [e.other_vert(v).index for e in v.link_edges]
            if nb:
                new.append(0.5 * ao[v.index] + 0.5 * sum(ao[i] for i in nb) / len(nb))
            else:
                new.append(ao[v.index])
        ao = new
    vals = []
    for v in bm.verts:
        mname = names[v.link_faces[0].material_index] if v.link_faces and names else ''
        a = ao[v.index]
        if shade:
            a *= shade(v.co, mname)
        w = clamp(wind(v.co, mname)) if wind else 0.0
        vals.append((clamp(a), w))
    bm.free()
    while me.color_attributes:
        me.color_attributes.remove(me.color_attributes[0])
    attr = me.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
    for i, (a, w) in enumerate(vals):
        attr.data[i].color = (a, w, 1.0, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    return attr


def finish(obj, col, hp, mat, ao=0.55, dist=1.0, samples=20, wind=None, smooth=35, ground=True, shade=None,
           **dims):
    if smooth is not None:
        C.set_smooth_by_angle(obj, smooth)
        flat_mats = {i for i, m in enumerate(obj.data.materials) if m and m.name in ('Glass',)}
        for p in obj.data.polygons:
            if p.loop_total > 6 or p.material_index in flat_mats:
                p.use_smooth = False
    bake_colors(obj, ao, dist, samples, wind, ground, shade)
    obj['col'] = col
    for k, v in dims.items():
        obj[k] = round(float(v), 3)
    obj['hp'] = int(hp)
    obj['mat'] = mat
    return obj


# =============================================================================================== trees

def _card(bm, p, u, v, s):
    vs = [bm.verts.new(p + (-u - v) * s / 2), bm.verts.new(p + (u - v) * s / 2), bm.verts.new(p + (u + v) * s / 2),
          bm.verts.new(p + (-u + v) * s / 2)]
    bm.faces.new(vs)


def leaf_cards(b, elems, n, seed, mat, size=(0.8, 1.3), up=0.45, out=(0.72, 1.05)):
    """Scatter leaf-cluster cards over a crown made of ellipsoid elements: they break up the blob's outline
    and give it real leafy texture. Normals are set to point out of the crown later (card_finish)."""
    rnd = random.Random(seed)
    weights = [e[1] ** 2 for e in elems]
    bm = bmesh.new()
    for _ in range(n):
        e = rnd.choices(elems, weights)[0]
        c, r = Vector(e[0]), e[1]
        sc = e[2] if len(e) > 2 else (1, 1, 1)
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1) + up))
        if d.length < 1e-3:
            continue
        d.normalize()
        p = c + Vector((d.x * sc[0], d.y * sc[1], d.z * sc[2])) * r * rnd.uniform(*out)
        nrm = (d + Vector((rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(-0.3, 0.7)))).normalized()
        t = nrm.cross(Vector((0, 0, 1)))
        if t.length < 1e-3:
            t = Vector((1, 0, 0))
        t.normalize()
        bt = nrm.cross(t)
        a = rnd.uniform(0, 2 * math.pi)
        u = t * math.cos(a) + bt * math.sin(a)
        v = nrm.cross(u)
        _card(bm, p, u, v, rnd.uniform(*size))
    b.add_bm(bm, M[mat])
    bm.free()


def card_finish(obj, centers, up=0.35):
    """UVs for the cards (each quad gets the whole leaf texture) and soft normals pointing out of the crown,
    so the foliage shades like one fluffy volume instead of flat shards."""
    me = obj.data
    names = [m.name if m else '' for m in me.materials]
    card = {i for i, nm in enumerate(names) if nm.startswith('LeafCard')}
    if not card:
        return obj
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    corner = [(0, 0), (1, 0), (1, 1), (0, 1)]
    normals = [Vector(n.vector) for n in me.corner_normals]
    cs = [Vector(c) for c in centers]
    for p in me.polygons:
        if p.material_index not in card:
            continue
        for k, li in enumerate(p.loop_indices):
            uv[li].uv = corner[k % 4]
        fc = p.center
        c = min(cs, key=lambda q: (q - fc).length)
        nrm = ((fc - c).normalized() + Vector((0, 0, up))).normalized()
        for li in p.loop_indices:
            normals[li] = nrm
    me.normals_split_custom_set(normals)
    return obj


def pine_fringe(b, tiers, seed, mat='LeafCardPine'):
    """Drooping needle sprays hanging off every tier's rim."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    for (zr, R, h) in tiers:
        n = max(8, int(R * 6))
        for k in range(n):
            a = 2 * math.pi * (k + rnd.uniform(-0.3, 0.3)) / n
            out = Vector((math.cos(a), math.sin(a), 0))
            tang = Vector((-math.sin(a), math.cos(a), 0))
            s = R * rnd.uniform(0.55, 0.8)
            down = (out * 0.55 + Vector((0, 0, -1))).normalized()
            p = Vector((0, 0, zr)) + out * R * rnd.uniform(0.78, 0.98) + down * s * 0.32 + Vector((0, 0, R * 0.05))
            _card(bm, p, tang, -down, s)
        # a few sprays on the tier's upper slope
        for k in range(max(4, int(R * 3))):
            a = rnd.uniform(0, 2 * math.pi)
            out = Vector((math.cos(a), math.sin(a), 0))
            tang = Vector((-math.sin(a), math.cos(a), 0))
            rr = R * rnd.uniform(0.35, 0.7)
            p = Vector((0, 0, zr + h * (1 - rr / R) * 0.55)) + out * rr
            slope = (out + Vector((0, 0, h / R * 0.6))).normalized()
            _card(bm, p, tang, slope, R * rnd.uniform(0.4, 0.6))
    b.add_bm(bm, M[mat])
    bm.free()

def pine_tier(b, zr, R, h, rnd, mat, segs=16):
    c = V(rnd.uniform(-0.07, 0.07), rnd.uniform(-0.07, 0.07), zr)
    rot = Euler((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), rnd.uniform(0, 6.28))).to_matrix()

    def ring(rf, zf):
        out = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            r, z = rf(k), zf(k)
            out.append(c + rot @ V(r * math.cos(a), r * math.sin(a), z))
        return out

    tip = [rnd.uniform(0.92, 1.08) for _ in range(segs)]
    rings = [
        c + rot @ V(0, 0, h),
        ring(lambda k: R * 0.42 * (1.07 if k % 2 == 0 else 0.93), lambda k: h * 0.5),
        ring(lambda k: R * (1.0 if k % 2 == 0 else 0.8) * tip[k], lambda k: -R * (0.2 if k % 2 == 0 else 0.07)),
        ring(lambda k: R * 0.6, lambda k: h * 0.05),
        ring(lambda k: 0.2, lambda k: h * 0.16),
    ]
    bm = loft(rings, close_start=False, close_end=True)
    b.add_bm(bm, mat)
    bm.free()


def tree_pine(name, H, tiers, trunk_r, seed, col_r, hp):
    rnd = random.Random(seed)
    b = C.MeshBuilder()
    top = H * 0.86
    pts = [V(0, 0, -0.25), V(0, 0, 0.2), V(0.02, 0, 0.9), V(0.03, 0.02, H * 0.3), V(0, 0.03, H * 0.6), V(0, 0, top)]
    radii = [trunk_r * 1.2, trunk_r * 1.05, trunk_r * 0.9, trunk_r * 0.72, trunk_r * 0.45, 0.06]
    tube(b, pts, radii, M['Bark'], segs=8, rfn=flare(5, 0.45, 2), cap_start=True)
    for (zr, R, h) in tiers:
        pine_tier(b, zr, R, h, rnd, M['LeavesPine'], segs=20)
    pine_fringe(b, tiers, seed + 50)
    obj = b.to_object(name)
    R0 = tiers[0][1]

    def wind(co, m):
        z = clamp(co.z / H)
        if m == 'Bark':
            return 0.3 * z * z
        return 0.2 + 0.45 * z ** 1.2 + 0.45 * clamp(co.xy.length / R0)

    def shade(co, m):
        if m == 'Bark':
            return 1.0
        return 0.78 + 0.22 * clamp(co.z / H) ** 0.7

    finish(obj, 'cyl', hp, 'wood', ao=0.55, dist=1.6, wind=wind, smooth=60, shade=shade, r=col_r, h=H)
    return card_finish(obj, [(0, 0, zr + h * 0.3) for (zr, R, h) in tiers], up=0.6)


def crown(b, elems, target, light=(), leaf='Leaves', leaf2='LeavesLight', res=0.2, amp=0.06, seed=0,
          threshold=0.6, stiff=8.0):
    """Puffy crown: the `light` lumps are a second intersecting blob in the second leaf material, so the
    colour change follows the crease between puffs instead of cutting across triangles."""
    groups = [([e for i, e in enumerate(elems) if i not in light], M[leaf]),
              ([e for i, e in enumerate(elems) if i in light], M[leaf2])]
    for gi, (es, mat) in enumerate(groups):
        if not es:
            continue
        bm = blob_bm(es, max(60, int(target * len(es) / len(elems))), res=res, amp=amp, freq=1.6, seed=seed + gi,
                     threshold=threshold, stiff=stiff)
        b.add_bm(bm, mat)
        bm.free()


def tree_broadleaf(name, H, seed, trunk, branches, elems, light, target, col_r, hp, trunk_r):
    b = C.MeshBuilder()
    pts, radii = trunk
    tube(b, pts, radii, M['Bark'], segs=9, rfn=flare(5, 0.5, 2), cap_start=True)
    for i, (bp, br) in enumerate(branches):
        tube(b, bp, br, M['Bark'], segs=6, seed=seed + i)
    # the blob is the shaded inner volume; leaf cards cover it and make the outline leafy
    inner = [(e[0], e[1] * 0.86) + tuple(e[2:]) for e in elems]
    crown(b, inner, target, light, seed=seed)
    area = sum(e[1] ** 2 for e in elems)
    leaf_cards(b, elems, int(area * 22), seed + 7, 'LeafCard', size=(0.75, 1.2), up=0.15, out=(0.82, 1.12))
    leaf_cards(b, [e for i, e in enumerate(elems) if i in light] or elems, int(area * 8),
               seed + 8, 'LeafCardLight', size=(0.75, 1.15), up=0.9, out=(0.85, 1.1))
    obj = b.to_object(name)
    zs = [e[0][2] for e in elems]
    z0 = min(z - e[1] * (e[2][2] if len(e) > 2 else 1) for z, e in zip(zs, elems))
    Rh = max(Vector(e[0]).xy.length + e[1] for e in elems)

    def wind(co, m):
        if m == 'Bark':
            return 0.35 * clamp(co.z / H) ** 2 + 0.25 * clamp(co.xy.length / Rh)
        return clamp(0.25 + 0.45 * clamp((co.z - z0) / (H - z0)) + 0.5 * clamp(co.xy.length / Rh))

    def shade(co, m):
        if m == 'Bark':
            return 0.8 + 0.2 * (1 - clamp((co.z - z0 + 1.0) / 2.0)) if co.z > z0 - 1.0 else 1.0
        t = clamp((co.z - z0) / (H - z0))
        return 0.7 + 0.3 * t ** 0.8

    finish(obj, 'cyl', hp, 'wood', ao=0.5, dist=1.8, wind=wind, smooth=65, shade=shade, r=col_r, h=H)
    return card_finish(obj, [e[0] for e in elems])


def tree_oak_a():
    trunk = ([V(0, 0, -0.25), V(0, 0, 0.25), V(0.05, 0, 1.2), V(0.1, 0.05, 2.3), V(0.12, 0.05, 3.1), V(0.1, 0.15, 4.4),
              V(0.0, 0.2, 5.6), V(0, 0.2, 6.6)],
             [0.64, 0.52, 0.44, 0.4, 0.36, 0.26, 0.16, 0.06])
    br = [
        ([V(0.12, 0.05, 2.8), V(0.7, 0.15, 3.7), V(1.3, 0.3, 4.6), V(1.75, 0.4, 5.5)], [0.26, 0.19, 0.12, 0.05]),
        ([V(0.1, 0.05, 2.9), V(-0.5, 0.4, 3.8), V(-1.1, 0.6, 4.7), V(-1.55, 0.75, 5.6)], [0.25, 0.18, 0.12, 0.05]),
        ([V(0.1, 0.0, 3.0), V(0.2, -0.6, 3.9), V(0.3, -1.15, 4.8), V(0.35, -1.6, 5.5)], [0.24, 0.18, 0.11, 0.05]),
        ([V(0.1, 0.1, 3.6), V(-0.6, -0.5, 4.6), V(-1.2, -0.9, 5.2), V(-1.7, -0.6, 5.3)], [0.17, 0.12, 0.08, 0.04]),
    ]
    elems = [
        ((0, 0.1, 6.5), 2.15, (1, 1, 0.82)),
        ((1.75, 0.4, 5.8), 1.5, (1, 1, 0.8)),
        ((-1.6, 0.75, 6.0), 1.45, (1, 1, 0.8)),
        ((0.35, -1.7, 5.75), 1.45, (1, 1, 0.8)),
        ((-0.95, -1.25, 6.9), 1.3, (1, 1, 0.85)),
        ((1.05, 1.5, 7.0), 1.3, (1, 1, 0.85)),
        ((0.25, 0.2, 7.95), 1.4, (1, 1, 0.75)),
        ((-1.85, -0.55, 5.25), 1.05, (1, 1, 0.85)),
        ((1.35, -1.05, 5.2), 1.0, (1, 1, 0.85)),
    ]
    return tree_broadleaf('Tree_Oak_A', 9.0, 11, trunk, br, elems, (1, 4, 6), 1250, 0.5, 320, 0.5)


def tree_oak_b():
    trunk = ([V(0, 0, -0.25), V(0, 0, 0.2), V(-0.04, 0.02, 1.0), V(-0.08, 0.04, 2.0), V(-0.06, 0.05, 2.6),
              V(0.0, 0.05, 3.6), V(0.05, 0.0, 4.8)],
             [0.56, 0.45, 0.39, 0.34, 0.31, 0.2, 0.08])
    br = [
        ([V(-0.06, 0.05, 2.3), V(0.5, 0.2, 3.0), V(1.0, 0.4, 3.7), V(1.3, 0.5, 4.3)], [0.22, 0.16, 0.1, 0.05]),
        ([V(-0.06, 0.05, 2.4), V(-0.6, 0.3, 3.1), V(-1.0, 0.55, 3.8), V(-1.25, 0.6, 4.4)], [0.21, 0.15, 0.1, 0.05]),
        ([V(-0.05, 0.0, 2.6), V(0.05, -0.6, 3.3), V(0.15, -1.0, 3.9), V(0.2, -1.3, 4.3)], [0.18, 0.13, 0.09, 0.04]),
    ]
    elems = [
        ((0, 0, 4.75), 1.95, (1, 1, 0.9)),
        ((1.3, 0.5, 4.3), 1.3, (1, 1, 0.9)),
        ((-1.25, 0.6, 4.4), 1.3, (1, 1, 0.9)),
        ((0.2, -1.35, 4.25), 1.3, (1, 1, 0.9)),
        ((-0.65, -0.85, 5.45), 1.15, (1, 1, 0.9)),
        ((0.75, 0.9, 5.55), 1.1, (1, 1, 0.9)),
        ((0.0, 0.1, 6.05), 1.15, (1, 1, 0.8)),
        ((-1.1, -0.6, 3.75), 0.9, (1, 1, 0.9)),
    ]
    return tree_broadleaf('Tree_Oak_B', 7.0, 23, trunk, br, elems, (3, 5), 1150, 0.42, 260, 0.42)


def tree_birch():
    rnd = random.Random(31)
    b = C.MeshBuilder()
    H = 9.0
    zs = [-0.2, 0.3, 1.5, 3.0, 4.5, 6.0, 7.2, 8.2]
    rs = [0.3, 0.23, 0.2, 0.17, 0.14, 0.1, 0.065, 0.03]

    def ctr(z):
        return V(0.2 * math.sin(z * 0.45), 0.08 * math.sin(z * 0.3 + 1.0), z)

    def rad(z):
        for i in range(len(zs) - 1):
            if zs[i] <= z <= zs[i + 1]:
                t = (z - zs[i]) / (zs[i + 1] - zs[i])
                return rs[i] * (1 - t) + rs[i + 1] * t
        return rs[-1]

    pts = [ctr(z) for z in zs]
    tube(b, pts, rs, M['BarkBirch'], segs=8, rfn=flare(4, 0.35, 2), cap_start=True)
    # dark lenticel marks
    for i in range(12):
        z = rnd.uniform(0.5, 6.2)
        a0 = rnd.uniform(0, 2 * math.pi)
        a1 = a0 + rnd.uniform(0.9, 1.7)
        r = rad(z)
        h = rnd.uniform(0.03, 0.07)
        c = ctr(z)
        rings = []
        for t in (0.0, 0.5, 1.0):
            a = a0 + (a1 - a0) * t
            d = V(math.cos(a), math.sin(a), 0)
            ri, ro = r * 0.9, r + (0.012 if t == 0.5 else 0.004)
            rings.append([c + d * ri + V(0, 0, -h / 2), c + d * ro + V(0, 0, -h / 2), c + d * ro + V(0, 0, h / 2),
                          c + d * ri + V(0, 0, h / 2)])
        mb = loft(rings, True, True)
        b.add_bm(mb, M['WoodDark'])
        mb.free()
    # short branches feeding an oval crown of puffs spiralling up the upper trunk
    elems, light = [], []
    n = 11
    for i in range(n):
        t = i / (n - 1)
        z = 3.9 + t * 4.5
        az = i * 2.39996 + 0.4
        spread = 0.45 + 0.55 * math.sin(math.pi * (0.15 + 0.75 * t))
        s0 = ctr(z - 0.45)
        d = V(math.cos(az), math.sin(az), 0)
        e = ctr(z) + d * spread
        if i < n - 1:
            tube(b, [s0, s0.lerp(e, 0.5) + V(0, 0, 0.05), e], [0.06, 0.04, 0.018], M['BarkBirch'], segs=5, seed=i)
        pr = (0.78 + 0.22 * math.sin(math.pi * (0.2 + 0.7 * t))) * rnd.uniform(0.9, 1.08)
        if i in (2, 5, 9):
            light.append(len(elems))
        elems.append(((e.x, e.y, e.z + 0.1), pr, (1, 1, 0.82)))
    elems.append(((ctr(8.45).x, ctr(8.45).y, 8.45), 0.55, (1, 1, 0.9)))
    # a couple of small low puffs so the crown doesn't start abruptly
    for (z, az, rr) in ((3.3, 2.0, 0.42), (3.6, 4.6, 0.38)):
        d = V(math.cos(az), math.sin(az), 0)
        s0 = ctr(z - 0.3)
        e = ctr(z) + d * 0.75
        tube(b, [s0, e], [0.045, 0.015], M['BarkBirch'], segs=4)
        elems.append(((e.x, e.y, e.z + 0.05), rr, (1, 1, 0.8)))
    crown(b, elems, 930, tuple(light), leaf='LeavesLight', leaf2='Leaves', res=0.1, amp=0.05, seed=5, stiff=2.2)
    leaf_cards(b, elems, 330, 41, 'LeafCardLight', size=(0.55, 0.95), up=0.2, out=(0.85, 1.12))
    leaf_cards(b, elems, 110, 42, 'LeafCard', size=(0.55, 0.85), up=0.1, out=(0.8, 1.05))
    obj = b.to_object('Tree_Birch_A')
    z0 = 3.2

    def wind(co, m):
        if m in ('BarkBirch', 'WoodDark'):
            return 0.3 * clamp(co.z / H) ** 2 + 0.3 * clamp((co.xy.length - 0.3) / 1.6)
        return clamp(0.3 + 0.4 * clamp((co.z - z0) / (H - z0)) + 0.5 * clamp(co.xy.length / 1.8))

    def shade(co, m):
        if m != 'LeavesLight':
            return 1.0
        return 0.75 + 0.25 * clamp((co.z - z0) / (H - z0))

    finish(obj, 'cyl', 220, 'wood', ao=0.5, dist=1.2, wind=wind, smooth=65, shade=shade, r=0.3, h=H)
    return card_finish(obj, [e[0] for e in elems])


def tree_palm():
    rnd = random.Random(7)
    b = C.MeshBuilder()
    H = 8.0

    def ctr(t):
        return V(0.95 * t * t, 0.12 * t * t, -0.2 + 7.45 * t)

    rings = []
    nseg = 10
    rings.append(tube_ring_at(ctr, 0.0, 0.44, 8))
    for j in range(nseg):
        t0, t1 = j / nseg, (j + 1) / nseg
        rj = 0.34 + (0.21 - 0.34) * (j / (nseg - 1))
        rings.append(tube_ring_at(ctr, t0 + 0.012, rj * 0.86, 8))
        rings.append(tube_ring_at(ctr, t1, rj * 1.07, 8))
    bm = loft(rings, True, True)
    b.add_bm(bm, M['Bark'])
    bm.free()
    T = ctr(1.0)
    b.sphere(0.34, loc=T + V(0, 0, 0.12), scale=(1, 1, 0.85), mat=M['Bark'], segs=8, rings=6)
    for i in range(4):
        a = i * 1.7 + 0.4
        b.sphere(0.15, loc=T + V(math.cos(a) * 0.27, math.sin(a) * 0.27, -0.12 - 0.05 * (i % 2)),
                 mat=M['WoodDark'], segs=8, rings=5)
    nf = 9
    tips = []
    for k in range(nf):
        az = k * 2 * math.pi / nf + rnd.uniform(-0.2, 0.2)
        young = k in (2, 6)
        el = rnd.uniform(0.95, 1.1) if young else rnd.uniform(0.6, 0.85)
        L = rnd.uniform(2.8, 3.1) if young else rnd.uniform(3.6, 4.1)
        droop = rnd.uniform(1.0, 1.2) if young else rnd.uniform(3.2, 3.8)
        hdir = V(math.cos(az), math.sin(az), 0)
        base = T + V(0, 0, 0.2) + hdir * 0.1

        def pos(s):
            return base + hdir * (L * s * math.cos(el)) + V(0, 0, L * s * math.sin(el) - droop * s * s)

        n = 12
        frings = [pos(0.0)]
        for i in range(1, n):
            s = i / n
            p = pos(s)
            t = (pos(s + 0.01) - pos(s - 0.01)).normalized()
            side = t.cross(V(0, 0, 1)).normalized()
            up = side.cross(t).normalized()
            w = 0.78 * math.sin(math.pi * s ** 0.7) ** 0.8
            if i % 2 == 1:
                w *= 0.6
            fold = 0.3 + 0.35 * s
            frings.append([p + side * w - up * fold * w, p + up * 0.035, p - side * w - up * fold * w,
                           p - up * 0.02])
        frings.append(pos(1.0))
        fbm = loft(frings, False, False)
        b.add_bm(fbm, M['PalmLeaf'])
        fbm.free()
        tips.append(pos(1.0))
    obj = b.to_object('Tree_Palm_A')
    Lmax = 4.1

    def wind(co, m):
        if m == 'PalmLeaf':
            return clamp(0.35 + 0.65 * (co - T).length / Lmax)
        return 0.35 * clamp(co.z / H) ** 2

    def shade(co, m):
        if m == 'PalmLeaf':
            return 0.8 + 0.2 * clamp((co.z - (T.z - 2.0)) / 2.5)
        return 1.0

    return finish(obj, 'cyl', 220, 'wood', ao=0.5, dist=1.2, wind=wind, smooth=60, shade=shade, r=0.35, h=H)


def tube_ring_at(ctr, t, r, segs):
    p = ctr(t)
    tn = (ctr(min(1.0, t + 0.01)) - ctr(max(0.0, t - 0.01))).normalized()
    ref = V(1, 0, 0)
    nn = (ref - tn * ref.dot(tn)).normalized()
    bb = tn.cross(nn)
    return [p + (nn * math.cos(2 * math.pi * k / segs) + bb * math.sin(2 * math.pi * k / segs)) * r
            for k in range(segs)]


def tree_dead():
    rnd = random.Random(55)
    b = C.MeshBuilder()
    H = 6.0
    zs = [-0.25, 0.2, 1.0, 2.0, 3.0, 4.0, 4.9, 5.6]
    pts = [V(0.12 * math.sin(z * 1.3) + (0.25 if z > 3 else 0.08 * z) * (z / 5.6), 0.1 * math.cos(z * 1.1) - 0.1, z)
           for z in zs]
    rs = [0.55, 0.42, 0.36, 0.31, 0.26, 0.2, 0.14, 0.0]
    tube(b, pts, rs, M['Bark'], segs=8, rfn=flare(4, 0.6, 2), cap_start=True)

    def trunk_at(z):
        for i in range(len(zs) - 1):
            if zs[i] <= z <= zs[i + 1]:
                t = (z - zs[i]) / (zs[i + 1] - zs[i])
                return pts[i].lerp(pts[i + 1], t), rs[i] * (1 - t) + rs[i + 1] * t
        return pts[-1], 0.05

    specs = [(2.3, 0.4, 2.2, 0.19), (2.9, 2.6, 2.0, 0.17), (3.5, 4.5, 1.9, 0.15), (4.1, 1.5, 1.6, 0.13),
             (4.7, 3.6, 1.3, 0.11), (1.6, 5.4, 1.2, 0.12)]
    for i, (z, az, L, r0) in enumerate(specs):
        s, _ = trunk_at(z)
        d = V(math.cos(az), math.sin(az), 0)
        bp = [s, s + d * L * 0.35 + V(0, 0, L * 0.15), s + d * L * 0.7 + V(0.1, -0.1, L * 0.45),
              s + d * L + V(0, 0, L * 0.85)]
        for p in bp[1:]:
            p += V(rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), rnd.uniform(-0.08, 0.08))
        tube(b, bp, [r0, r0 * 0.7, r0 * 0.4, 0.0], M['Bark'], segs=6, seed=i)
        # a twig from the branch middle
        m = bp[1].lerp(bp[2], 0.5)
        az2 = az + (0.9 if i % 2 else -0.9)
        d2 = V(math.cos(az2), math.sin(az2), 0)
        tube(b, [m, m + d2 * 0.4 + V(0, 0, 0.3), m + d2 * 0.7 + V(0, 0, 0.75)], [r0 * 0.45, r0 * 0.25, 0.0],
             M['Bark'], segs=5, seed=i + 9)
    obj = b.to_object('Tree_Dead_A')

    def wind(co, m):
        return 0.4 * clamp(co.z / H) ** 2 + 0.3 * clamp((co.xy.length - 0.3) / 1.8)

    return finish(obj, 'cyl', 150, 'wood', ao=0.5, dist=1.0, wind=wind, smooth=65, r=0.35, h=H)


# =============================================================================================== bushes

def bush(name, elems, target, leaf, berries, seed, H):
    b = C.MeshBuilder()
    bm = blob_bm(elems, target, res=0.07, amp=0.03, freq=3.0, seed=seed, stiff=5.0)
    rnd = random.Random(seed)
    tree = BVHTree.FromBMesh(bm)
    b.add_bm(bm, M[leaf])
    bm.free()
    placed = 0
    tries = 0
    while placed < berries and tries < 400:
        tries += 1
        a = rnd.uniform(0, 2 * math.pi)
        el = rnd.uniform(-0.1, 0.9)
        d = V(math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el))
        o = V(0, 0, H * 0.45) + d * 3.0
        hit = tree.ray_cast(o, -d, 5.0)
        if hit[0] is None or hit[0].z < 0.25:
            continue
        b.ico(0.055, loc=hit[0] + hit[1] * 0.02, mat=M['RedPaint'], subdiv=1)
        placed += 1
    leaf_cards(b, elems, int(sum(e[1] ** 2 for e in elems) * 60), seed + 9,
               'LeafCardPine' if leaf == 'LeavesPine' else 'LeafCard', size=(0.35, 0.55), up=0.3)
    obj = b.to_object(name)
    Rh = max(Vector(e[0]).xy.length + e[1] for e in elems)

    def wind(co, m):
        return clamp(0.15 + 0.6 * clamp(co.z / H) + 0.35 * clamp(co.xy.length / Rh))

    def shade(co, m):
        return 0.72 + 0.28 * clamp(co.z / H) ** 0.8

    finish(obj, 'none', 60, 'wood', ao=0.5, dist=0.5, wind=wind, smooth=70, shade=shade)
    return card_finish(obj, [e[0] for e in elems], up=0.4)


def bush_a():
    """Low, wide mound of puffs."""
    elems = [((0, 0, 0.36), 0.5, (1, 1, 0.9)), ((0.45, 0.12, 0.3), 0.38), ((-0.42, 0.22, 0.32), 0.38),
             ((0.1, -0.42, 0.3), 0.37), ((-0.22, -0.3, 0.62), 0.34), ((0.24, 0.3, 0.64), 0.33),
             ((0.02, 0.0, 0.8), 0.3), ((0.42, -0.3, 0.24), 0.26)]
    return bush('Bush_A', elems, 480, 'Leaves', 0, 3, 1.1)


def bush_b():
    """Taller rounded holly-like bush with red berries."""
    elems = [((0, 0, 0.6), 0.5, (1, 1, 1.2)), ((0.36, 0.14, 0.45), 0.34, (1, 1, 1.1)),
             ((-0.34, 0.2, 0.5), 0.34, (1, 1, 1.1)), ((0.05, -0.36, 0.45), 0.33, (1, 1, 1.1)),
             ((-0.08, 0.04, 1.05), 0.33), ((0.2, -0.15, 0.92), 0.27), ((-0.26, -0.2, 0.86), 0.27)]
    elems = [((e[0][0], e[0][1], e[0][2] - 0.08),) + tuple(e[1:]) for e in elems]
    return bush('Bush_B', elems, 360, 'LeavesPine', 7, 4, 1.4)


# =============================================================================================== rocks

def moss_fn(thr=0.6, seed=0):
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))

    def f(c, n):
        return M['RockMoss'] if n.z + 0.15 * noise.noise(c * 1.3 + off) > thr else M['Rock']
    return f


def rock(name, size, seed, hp, cuts=4, moss=0.6):
    b = C.MeshBuilder()
    bm = rock_bm(size, seed, cuts=cuts + 3, subdiv=3, amp=0.24, freq=1.3, sink=0.1)
    add_fn(b, bm, moss_fn(moss, seed))
    bm.free()
    obj = b.to_object(name)
    xs = [v.co for v in obj.data.vertices]
    w = max(max(v.x for v in xs) - min(v.x for v in xs), max(v.y for v in xs) - min(v.y for v in xs))
    h = max(v.z for v in xs)
    return finish(obj, 'cyl', hp, 'stone', ao=0.45, dist=max(0.4, w * 0.3), smooth=32, r=w / 2 * 0.85, h=h)


def rock_big():
    b = C.MeshBuilder()
    parts = [((3.6, 3.0, 5.6), (0.2, 0.3, 0), 0.2, 101, 0.7), ((3.0, 2.6, 4.0), (-1.55, 0.1, 0), 0.5, 102, 0.55),
             ((2.7, 2.4, 3.2), (1.75, -0.15, 0), -0.4, 103, 0.6), ((1.6, 1.4, 1.4), (-0.55, -1.45, 0), 0.9, 104, None),
             ((2.6, 2.2, 3.6), (0.8, 1.35, 0), 1.3, 105, 0.6), ((1.3, 1.1, 1.0), (2.3, -1.3, 0), 0.3, 106, None),
             ((1.2, 1.1, 0.9), (-2.4, -0.9, 0), 0.7, 107, None)]
    for (size, loc, rz, seed, top) in parts:
        bm = rock_bm(size, seed, cuts=6, subdiv=3, amp=0.18, sink=0.2, up_bias=0.3, top_cut=top)
        add_fn(b, bm, moss_fn(0.62, seed), Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, 'Z'))
        bm.free()
    for v in b.bm.verts:
        v.co.z *= 1.22
    obj = b.to_object('Rock_Big')
    return finish(obj, 'cyl', 1200, 'stone', ao=0.5, dist=1.6, smooth=32, r=2.6, h=4.0)


def rings_(bm, face, seq, center):
    """Concentric insets on a cut face: seq = [(width, material index), ...] from the rim inwards."""
    for th, mi in seq:
        r = bmesh.ops.inset_individual(bm, faces=[face], thickness=th, depth=0.0, use_even_offset=True)
        for f in r['faces']:
            f.material_index = mi
    face.material_index = center


def stump():
    b = C.MeshBuilder()
    rnd = random.Random(4)
    pts = [V(0, 0, -0.15), V(0, 0, 0.06), V(0.01, 0, 0.3), V(0.02, 0, 0.52)]
    rings = tube_rings(pts, [0.46, 0.39, 0.33, 0.31], segs=12, rfn=flare(5, 0.7, 2), jitter=0.03, seed=2)
    # slanted top
    top = rings[-1]
    for p in top:
        p.z += 0.06 * p.x / 0.3
    bm = loft(rings, True, True)
    for f in bm.faces:
        f.material_index = 0
    tf = max(bm.faces, key=lambda f: f.calc_center_median().z)
    rings_(bm, tf, [(0.045, 0), (0.06, 1), (0.018, 2), (0.07, 1), (0.018, 2), (0.06, 1)], 1)
    bmesh.ops.translate(bm, vec=(0, 0, -0.02), verts=tf.verts)
    add_local(b, bm, [M['Bark'], M['Wood'], M['WoodDark']])
    bm.free()
    for i, a in enumerate((0.5, 2.4, 4.3)):
        d = V(math.cos(a), math.sin(a), 0)
        tube(b, [d * 0.25 + V(0, 0, 0.12), d * 0.5 + V(0, 0, 0.02), d * 0.72 + V(0, 0, -0.1)], [0.11, 0.07, 0.0],
             M['Bark'], segs=6, seed=i)
    # two little mushrooms
    for (x, y, s) in ((0.36, -0.26, 1.0), (0.46, -0.1, 0.7)):
        b.cylinder(0.018 * s, 0.1 * s, loc=(x, y, 0.05 * s), mat=M['WhitePaint'], segs=6)
        b.sphere(0.055 * s, loc=(x, y, 0.1 * s), scale=(1, 1, 0.55), mat=M['RedPaint'], segs=8, rings=4)
    obj = b.to_object('Stump_A')
    return finish(obj, 'cyl', 80, 'wood', ao=0.5, dist=0.35, smooth=55, r=0.4, h=0.6)


def log():
    b = C.MeshBuilder()
    xs = [-2.0, -1.2, -0.4, 0.4, 1.2, 2.0]
    pts = [V(x, 0.06 * math.sin(x * 1.2), 0.32 + 0.015 * math.cos(x * 2.0)) for x in xs]
    rs = [0.33, 0.335, 0.33, 0.32, 0.31, 0.3]

    def rfn(i, a, r):
        return r * (1 + 0.05 * math.cos(7 * a + i))

    bm = loft(tube_rings(pts, rs, segs=11, rfn=rfn), True, True)
    for f in bm.faces:
        f.material_index = 0
    ends = [f for f in bm.faces if len(f.verts) > 4]
    for tf in ends:
        rings_(bm, tf, [(0.035, 0), (0.07, 1), (0.016, 2), (0.07, 1)], 1)
        n = tf.normal.copy()
        bmesh.ops.translate(bm, vec=-n * 0.02, verts=tf.verts)
    add_local(b, bm, [M['Bark'], M['Wood'], M['WoodDark']])
    bm.free()
    # broken branch stub + a leafy sprout
    tube(b, [V(0.6, 0.05, 0.45), V(0.75, -0.08, 0.72), V(0.85, -0.18, 0.92)], [0.1, 0.08, 0.065], M['Bark'], segs=6)
    b.cylinder(0.064, 0.02, loc=(0.855, -0.185, 0.93), rot=(0.45, 0.35, 0), mat=M['Wood'], segs=6)
    b.ico(0.16, loc=(-0.9, 0.05, 0.62), scale=(1.2, 1, 0.7), mat=M['Leaves'], subdiv=1, jitter=0.1, seed=1)
    b.ico(0.11, loc=(-0.72, -0.08, 0.63), scale=(1.1, 1, 0.8), mat=M['Leaves'], subdiv=1, jitter=0.1, seed=2)
    obj = b.to_object('Log_A')

    def wind(co, m):
        return 0.6 if m == 'Leaves' else 0.0

    return finish(obj, 'box', 150, 'wood', ao=0.5, dist=0.45, smooth=55, wind=wind, sx=4.0, sy=0.7, sz=0.7)


# =============================================================================================== preview

def _ground_mat():
    m = bpy.data.materials.new('__Ground')
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*C.hex_color('#8bbf5a'), 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    return m


def _debug_mat(channel):
    m = bpy.data.materials.new('__Debug')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    at = nt.nodes.new('ShaderNodeVertexColor')
    at.layer_name = 'Color'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(at.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs[channel], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def render_sheet(path, objs, gap=1.0, view=(-0.3, -1.0, 0.22), lens=50, size=(800, 500), samples=20, margin=1.0,
                 debug=None, follow=(), aim=0.5):
    """Lay `objs` out along X and render them in one image. follow = [(obj, leader, offset)]."""
    sc = bpy.context.scene
    for o in sc.objects:
        o.hide_render = True
    x = 0.0
    for o in objs:
        vs = [Vector(c) for c in o.bound_box]
        x0, x1 = min(v.x for v in vs), max(v.x for v in vs)
        o.location = (x - x0, 0, 0)
        o.hide_render = False
        x += (x1 - x0) + gap
    total = x - gap
    for o in objs:
        o.location.x -= total / 2
    for (o, leader, off) in follow:
        o.location = leader.location + Vector(off)
        o.hide_render = False
    hmax = max(max(Vector(c).z for c in o.bound_box) for o in objs)
    ymax = max(max(abs(Vector(c).y) for c in o.bound_box) for o in objs)
    # ground
    gme = bpy.data.meshes.new('__ground')
    gme.from_pydata([(-300, -300, 0), (300, -300, 0), (300, 300, 0), (-300, 300, 0)], [], [(0, 1, 2, 3)])
    gm = _ground_mat()
    gme.materials.append(gm)
    ground = bpy.data.objects.new('__ground', gme)
    sc.collection.objects.link(ground)
    # camera
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    if not sc.world:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (*C.hex_color('#b7d3ef'), 1)
    bg.inputs[1].default_value = 0.9
    cd = bpy.data.cameras.new('__cam')
    cd.lens = lens
    cam = bpy.data.objects.new('__cam', cd)
    sc.collection.objects.link(cam)
    d = Vector(view).normalized()
    tan_h = 18.0 / lens
    aspect = size[0] / size[1]
    half_w = total / 2 * margin
    half_h = hmax / 2 * margin * 1.15
    dist = max(half_w / tan_h, half_h * aspect / tan_h) + ymax
    target = Vector((0, 0, hmax * aim))
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sd = bpy.data.lights.new('__sun', 'SUN')
    sd.energy = 3.4
    sd.angle = 0.1
    sd.color = (1.0, 0.96, 0.9)
    sun = bpy.data.objects.new('__sun', sd)
    sun.rotation_euler = (0.8, 0.0, -0.55)
    sc.collection.objects.link(sun)
    dbg = None
    if debug:
        dbg = _debug_mat({'ao': 0, 'wind': 1}[debug])
        bpy.context.view_layer.material_override = dbg
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.context.view_layer.material_override = None
    for ob in (cam, sun, ground):
        bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(gme)
    bpy.data.materials.remove(gm)
    if dbg:
        bpy.data.materials.remove(dbg)
    for o in sc.objects:
        o.hide_render = False
        o.location = (0, 0, 0)
    print('rendered', path)


# =============================================================================================== vehicles

def lathe_bm(profile, mats_, segs=16, close=False):
    """Like lathe_mats but returns the bmesh (material_index -> mats_ position)."""
    tmp = C.MeshBuilder()
    lathe_mats(tmp, profile, mats_, segs=segs, close=close)
    for f in tmp.bm.faces:
        f.material_index = mats_.index(tmp.mats[f.material_index])
    return tmp.bm


def car_wheel(b, c, r, w, side, rim='Chrome', tyre='Rubber', segs=14, flat_z=None, rim_frac=0.6):
    """Tyre + dished rim. The wheel axis is X, `side` (+1/-1) is the outward direction."""
    ri = r * rim_frac
    prof = [(ri, -w * 0.42), (r * 0.84, -w * 0.5), (r * 0.96, -w * 0.46), (r, -w * 0.3), (r, w * 0.3),
            (r * 0.96, w * 0.46), (r * 0.84, w * 0.5), (ri, w * 0.42)]
    mt = Matrix.Translation(c) @ Matrix.Rotation(side * math.pi / 2, 4, 'Y')
    bm = lathe_bm(prof, [M[tyre]], segs, close=True)
    bmesh.ops.transform(bm, matrix=mt, verts=bm.verts)
    if flat_z is not None:
        for v in bm.verts:
            if v.co.z < flat_z:
                k = (flat_z - v.co.z)
                v.co.z = flat_z - k * 0.08
                v.co.x = c.x + (v.co.x - c.x) * (1 + 1.2 * k)
    add_local(b, bm, [M[tyre]])
    bm.free()
    rp = [(0, -w * 0.38), (ri * 1.01, -w * 0.38), (ri * 1.01, w * 0.36), (ri * 0.8, w * 0.27), (ri * 0.42, w * 0.25),
          (ri * 0.34, w * 0.4), (0, w * 0.42)]
    bm = lathe_bm(rp, [M[rim]], segs)
    bmesh.ops.transform(bm, matrix=mt, verts=bm.verts)
    add_local(b, bm, [M[rim]])
    bm.free()


def cabin(profile, width, top_scale, z_lo, z_hi, split_y, glass, paint, frame=0.065, sel_z=None):
    """Greenhouse: extruded side profile, tapered towards the roof, windows inset as Glass."""
    bm = prism_x(profile, width)
    for v in bm.verts:
        t = clamp((v.co.z - z_lo) / (z_hi - z_lo))
        v.co.x *= 1 - (1 - top_scale) * t
    if split_y is not None:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, split_y, 0), plane_no=(0, 1, 0))
    bm.normal_update()
    for f in bm.faces:
        f.material_index = 0
    zs = sel_z if sel_z is not None else z_lo + 0.08
    orig = list(bm.edges)
    sides = [f for f in bm.faces if abs(f.normal.x) > 0.5 and f.calc_center_median().z > zs]
    ends = [f for f in bm.faces if abs(f.normal.y) > 0.3 and f.calc_center_median().z > zs and f.calc_area() > 0.12]
    if sides:
        bmesh.ops.inset_individual(bm, faces=sides, thickness=frame, depth=-0.012, use_even_offset=True)
    if ends:
        bmesh.ops.inset_individual(bm, faces=ends, thickness=frame * 1.2, depth=-0.012, use_even_offset=True)
    for f in sides + ends:
        f.material_index = 1
    bevel_sharp(bm, 0.045, 2, 25, edges=orig)
    return bm, [paint, glass], sides, ends


def car_sedan(name='Car_Sedan', wreck=False):
    b = C.MeshBuilder()
    paint = M['Rust'] if wreck else M['CarPaint']
    ys = 4.2 / 4.4 if wreck else 1.0
    dz = -0.1 if wreck else 0.0
    wr, wy, wx = 0.36, 1.35 * ys, 0.76

    def P(pts):
        return [(y * ys, z + dz) for (y, z) in pts]

    lower = [(-2.14, 0.38), (-2.22, 0.5), (-2.22, 0.68), (-2.15, 0.82), (-1.95, 0.91), (-1.1, 0.97), (-0.75, 0.98),
             (1.5, 0.99), (2.08, 0.95), (2.2, 0.85), (2.22, 0.62), (2.16, 0.4), (2.02, 0.33)]
    lower = P(lower)
    lower += [(y, z + dz) for (y, z) in arch_pts(wy, wr, 0.43, 0.33, 8)]
    lower += [(y, z + dz) for (y, z) in arch_pts(-wy, wr, 0.43, 0.33, 8)]
    lower += P([(-2.02, 0.33)])
    bm = prism_x(lower, 1.8)
    bevel_sharp(bm, 0.07, 2, 25)
    add_local(b, bm, [paint])
    bm.free()
    glass = M['Glass']
    cab_prof = P([(-0.86, 0.9), (-0.8, 0.965), (-0.12, 1.42), (0.8, 1.44), (1.55, 0.99), (1.6, 0.9)])
    cbm, cm, sides, ends = cabin(cab_prof, 1.58, 0.83, 0.95 + dz, 1.44 + dz, 0.32 * ys, glass, paint)
    if wreck:
        # side + rear windows smashed out (dark voids), windscreen kept
        for f in sides:
            f.material_index = 2
        for f in ends:
            if f.normal.y > 0:
                f.material_index = 2
        cm = cm + [M['Rubber']]
    add_local(b, cbm, cm)
    cbm.free()
    sag = 0.14

    def sag_dz(x, y):
        u = clamp((x + 0.9) / 1.8)
        v = clamp((-y / ys + 2.2) / 4.4)
        return -sag * (1 - u) * v

    for sx in (1, -1):
        for sy in (1, -1):
            if wreck and sx == -1 and sy == -1:
                # wheel gone: the corner rests on the brake drum
                zc = 0.17 + 0.012 - sag_dz(-0.72, -wy)
                b.cylinder(0.17, 0.12, loc=(-0.7, -wy, zc), rot=(0, math.pi / 2, 0), mat=M['Rust'], segs=10)
                b.cylinder(0.06, 0.1, loc=(-0.78, -wy, zc), rot=(0, math.pi / 2, 0), mat=M['Metal'], segs=6)
                continue
            car_wheel(b, V(sx * wx, sy * wy, wr + (dz if wreck else 0)), wr, 0.24, sx,
                      rim='Rust' if wreck else 'Chrome', flat_z=0.03 if wreck else None)
    fy, ry = -2.2 * ys, 2.2 * ys
    for sx in (1, -1):
        # lights
        if wreck:
            b.box((0.34, 0.1, 0.12), loc=(sx * 0.56, fy + 0.03, 0.74 + dz), rot=(0.35, 0, 0),
                  mat=M['Glass'] if sx > 0 else M['Rubber'], bevel=0.02)
            b.box((0.36, 0.08, 0.12), loc=(sx * 0.58, ry, 0.78 + dz), rot=(-0.3, 0, 0), mat=M['RedPaint'], bevel=0.02)
        else:
            b.box((0.34, 0.1, 0.12), loc=(sx * 0.56, fy + 0.03, 0.74), rot=(0.35, 0, 0), mat=M['LightEmit'],
                  bevel=0.02)
            b.box((0.36, 0.08, 0.12), loc=(sx * 0.58, ry, 0.78), rot=(-0.3, 0, 0), mat=M['RedLight'], bevel=0.02)
        # mirrors + handles
        b.box((0.1, 0.16, 0.1), loc=(sx * 0.87, -0.66 * ys, 1.02 + dz), rot=(0, 0, -sx * 0.2), mat=paint, bevel=0.02)
        for hy in (-0.2, 0.72):
            b.box((0.03, 0.15, 0.035), loc=(sx * 0.9, hy * ys, 0.86 + dz), mat=M['Chrome'] if not wreck else M['Metal'])
    b.box((0.72, 0.08, 0.12), loc=(0, fy - 0.005, 0.62 + dz), mat=M['Rubber'], bevel=0.02)
    if wreck:
        # hood popped open over a dark engine bay, rear bumper hanging, no front bumper
        b.box((1.4, 0.9, 0.14), loc=(0, -1.4 * ys, 0.92 + dz), mat=M['Rubber'])
        hood_pivot = V(0, -0.8 * ys, 0.98 + dz)
        hm = Matrix.Translation(hood_pivot) @ Matrix.Rotation(-0.32, 4, 'X') @ Matrix.Translation((0, -0.62, 0.02))
        box_m(b, (1.62, 1.26, 0.05), hm, paint, bevel=0.02)
        bm_ = Matrix.Translation((0, ry + 0.02, 0.36 + dz)) @ Matrix.Rotation(0.2, 4, 'Y')
        box_m(b, (1.84, 0.16, 0.15), bm_, M['Metal'], bevel=0.04, segs=1)
        b.box((0.34, 0.02, 0.1), loc=(0, ry + 0.07, 0.62 + dz), rot=(0.1, 0.25, 0), mat=M['WhitePaint'])
        # a mismatched replacement door and a couple of rust-through holes
        b.box((0.024, 0.92 * ys, 0.4), loc=(-0.902, -0.3 * ys, 0.68 + dz), mat=M['MetalPainted'])
        b.box((0.024, 0.16, 0.1), loc=(0.902, 1.0 * ys, 0.55 + dz), rot=(0.3, 0, 0), mat=M['Rubber'])
        b.box((0.024, 0.12, 0.08), loc=(-0.902, 1.25 * ys, 0.5 + dz), rot=(-0.4, 0, 0), mat=M['Rubber'])
        for v in b.bm.verts:
            v.co.z += sag_dz(v.co.x, v.co.y)
    else:
        for yy, zz in ((fy, 0.44), (ry, 0.46)):
            b.box((1.86, 0.16, 0.15), loc=(0, yy, zz), mat=M['Chrome'], bevel=0.05, bevel_segs=2)
            b.box((0.34, 0.02, 0.1), loc=(0, yy + math.copysign(0.085, yy), zz), mat=M['WhitePaint'])
    if not wreck:
        for v in b.bm.verts:
            v.co.y *= 2.2 / 2.3
    obj = b.to_object(name)
    if wreck:
        return finish(obj, 'box', 350, 'metal', ao=0.55, dist=0.6, smooth=40, sx=1.8, sy=4.2, sz=1.3)
    return finish(obj, 'box', 400, 'metal', ao=0.55, dist=0.6, smooth=40, sx=1.8, sy=4.4, sz=1.45)


def car_pickup():
    b = C.MeshBuilder()
    paint = M['CarPaint']
    wr, ww, wx = 0.44, 0.3, 0.83
    fy, ry = -1.72, 1.6
    lower = [(-2.5, 0.48), (-2.6, 0.62), (-2.6, 0.98), (-2.52, 1.12), (-1.15, 1.2), (-0.95, 1.22), (0.34, 1.22),
             (0.34, 0.44)]
    lower += arch_pts(fy, wr, 0.52, 0.44, 8)
    lower += [(-2.4, 0.44)]
    bm = prism_x(lower, 1.96)
    bevel_sharp(bm, 0.065, 2, 25)
    add_local(b, bm, [paint])
    bm.free()
    cab_prof = [(-1.02, 1.12), (-0.96, 1.22), (-0.42, 1.8), (0.28, 1.8), (0.32, 1.22), (0.32, 1.12)]
    cbm, cm, _, _ = cabin(cab_prof, 1.9, 0.86, 1.22, 1.8, None, M['Glass'], paint, frame=0.07, sel_z=1.32)
    add_local(b, cbm, cm)
    cbm.free()
    # bed
    wall = [(0.36, 1.22), (2.6, 1.22), (2.6, 0.5)] + arch_pts(ry, wr, 0.53, 0.5, 8) + [(0.36, 0.5)]
    for sx in (1, -1):
        bm = prism_x(wall, 0.09, x0=sx * 0.935)
        bevel_sharp(bm, 0.03, 1, 25)
        add_local(b, bm, [paint])
        bm.free()
        b.box((0.13, 2.28, 0.045), loc=(sx * 0.935, 1.48, 1.24), mat=M['Rubber'], bevel=0.015, bevel_segs=1)
        b.box((0.26, 1.1, 0.34), loc=(sx * 0.76, ry, 0.9), mat=paint, bevel=0.05, bevel_segs=2)
        b.box((0.09, 0.05, 0.3), loc=(sx * 0.935, 2.615, 0.97), mat=M['RedLight'], bevel=0.015, bevel_segs=1)
    b.box((1.84, 2.22, 0.06), loc=(0, 1.48, 0.78), mat=M['Rubber'])
    b.box((1.3, 2.2, 0.3), loc=(0, 1.48, 0.6), mat=M['Rubber'])
    b.box((1.96, 0.09, 0.46), loc=(0, 0.385, 0.99), mat=paint, bevel=0.03, bevel_segs=1)
    b.box((1.96, 0.09, 0.7), loc=(0, 2.555, 0.86), mat=paint, bevel=0.03, bevel_segs=1)
    b.box((0.4, 0.03, 0.07), loc=(0, 2.6, 1.08), mat=M['Rubber'], bevel=0.01, bevel_segs=1)
    # front end
    b.box((1.42, 0.08, 0.44), loc=(0, -2.6, 0.82), mat=M['Chrome'], bevel=0.03, bevel_segs=1)
    b.box((1.24, 0.06, 0.32), loc=(0, -2.625, 0.82), mat=M['Rubber'])
    for zz in (0.74, 0.9):
        b.box((1.24, 0.05, 0.03), loc=(0, -2.64, zz), mat=M['Chrome'])
    for sx in (1, -1):
        b.box((0.26, 0.08, 0.18), loc=(sx * 0.82, -2.6, 0.9), mat=M['LightEmit'], bevel=0.02, bevel_segs=1)
        b.box((0.12, 0.2, 0.12), loc=(sx * 1.03, -0.78, 1.36), mat=M['Rubber'], bevel=0.02, bevel_segs=1)
        b.box((0.06, 0.1, 0.04), loc=(sx * 0.98, -0.72, 1.3), mat=M['Rubber'])
        b.box((0.03, 0.15, 0.035), loc=(sx * 0.985, -0.3, 1.1), mat=M['Chrome'])
    b.box((2.0, 0.2, 0.2), loc=(0, -2.6, 0.5), mat=M['Chrome'], bevel=0.05, bevel_segs=2)
    b.box((2.0, 0.18, 0.16), loc=(0, 2.62, 0.5), mat=M['Chrome'], bevel=0.04, bevel_segs=2)
    b.box((0.36, 0.02, 0.11), loc=(0, -2.705, 0.5), mat=M['WhitePaint'])
    b.box((0.36, 0.02, 0.11), loc=(0, 2.605, 0.72), mat=M['WhitePaint'])
    # roof light bar
    b.box((1.3, 0.16, 0.08), loc=(0, -0.2, 1.84), mat=M['Rubber'], bevel=0.02, bevel_segs=1)
    for x in (-0.45, -0.15, 0.15, 0.45):
        b.box((0.2, 0.04, 0.06), loc=(x, -0.285, 1.84), mat=M['LightEmit'])
    for sx in (1, -1):
        for sy in (fy, ry):
            car_wheel(b, V(sx * wx, sy, wr), wr, ww, sx)
    for v in b.bm.verts:
        v.co.y *= 2.6 / 2.71
    obj = b.to_object('Car_Pickup')
    return finish(obj, 'box', 500, 'metal', ao=0.55, dist=0.6, smooth=40, sx=2.0, sy=5.2, sz=1.8)


def tractor_tyre(b, c, r, w, side, lugs=0):
    rb = r - (0.07 if lugs else 0.0)
    ri = r * 0.6
    prof = [(ri, -w * 0.44), (rb * 0.86, -w * 0.5), (rb * 0.97, -w * 0.46), (rb, -w * 0.32), (rb, w * 0.32),
            (rb * 0.97, w * 0.46), (rb * 0.86, w * 0.5), (ri, w * 0.44)]
    mt = Matrix.Translation(c) @ Matrix.Rotation(side * math.pi / 2, 4, 'Y')
    lathe_mats(b, prof, [M['Rubber']], segs=16 if lugs else 11, matrix=mt, close=True)
    rp = [(0, -w * 0.3), (ri * 1.01, -w * 0.3), (ri * 1.01, w * 0.3), (ri * 0.75, w * 0.2), (ri * 0.32, w * 0.24),
          (ri * 0.28, w * 0.42), (0, w * 0.44)]
    lathe_mats(b, rp, [M['WhitePaint'], M['WhitePaint'], M['WhitePaint'], M['WhitePaint'], M['Metal'], M['Metal']],
               segs=14 if lugs else 10, matrix=mt)
    if lugs:
        X = V(1, 0, 0)
        for i in range(lugs):
            for k, sgn in ((0, 1), (1, -1)):
                th = 2 * math.pi * (i + 0.5 * k) / lugs
                R = V(0, math.cos(th), math.sin(th))
                T = V(0, -math.sin(th), math.cos(th))
                phi = 0.5 * sgn
                xa = X * math.cos(phi) + T * math.sin(phi)
                ya = -X * math.sin(phi) + T * math.cos(phi)
                ctr = c + X * (sgn * w * 0.24) + R * (rb + 0.03)
                m = Matrix.Translation(ctr) @ Matrix((xa, ya, R)).transposed().to_4x4()
                box_m(b, (w * 0.5, 0.11, 0.1), m, M['Rubber'])


def tractor():
    b = C.MeshBuilder()
    red, dark, metal = M['RedPaint'], M['Rubber'], M['Metal']
    rr, rw, ry = 0.78, 0.42, 0.72
    fr, fw, fyy = 0.42, 0.24, -1.3
    for sx in (1, -1):
        tractor_tyre(b, V(sx * 0.78, ry, rr), rr, rw, sx, lugs=12)
        tractor_tyre(b, V(sx * 0.6, fyy, fr), fr, fw, sx)
        # fenders over the rear wheels
        arc_o = [(ry + 0.9 * math.cos(a), rr + 0.9 * math.sin(a)) for a in
                 [math.radians(d) for d in range(15, 170, 15)]]
        arc_i = [(ry + 0.84 * math.cos(a), rr + 0.84 * math.sin(a)) for a in
                 [math.radians(d) for d in range(165, 10, -15)]]
        bm = prism_x(arc_o + arc_i, 0.52, x0=sx * 0.78)
        bevel_sharp(bm, 0.02, 1, 30)
        add_local(b, bm, [red])
        bm.free()
        # front lamps
        b.cylinder(0.075, 0.06, loc=(sx * 0.27, -1.745, 1.3), rot=(math.pi / 2, 0, 0), mat=M['LightEmit'], segs=10)
        b.cylinder(0.09, 0.05, loc=(sx * 0.27, -1.72, 1.3), rot=(math.pi / 2, 0, 0), mat=metal, segs=10)
        # roll bar posts
        rod(b, V(sx * 0.6, 1.14, 1.0), V(sx * 0.6, 1.14, 2.3), 0.05, dark, segs=8)
    # hood + engine
    b.box((0.8, 1.72, 0.66), loc=(0, -0.88, 1.1), mat=red, bevel=0.1, bevel_segs=2)
    b.box((0.6, 1.5, 0.36), loc=(0, -0.9, 0.62), mat=dark, bevel=0.03, bevel_segs=1)
    b.box((0.6, 0.05, 0.5), loc=(0, -1.735, 1.07), mat=dark)
    for z in (0.9, 1.02, 1.14, 1.26):
        b.box((0.64, 0.05, 0.035), loc=(0, -1.75, z), mat=metal)
    b.box((0.92, 0.24, 0.3), loc=(0, -1.84, 0.6), mat=dark, bevel=0.03, bevel_segs=1)
    beam(b, V(-0.62, fyy, fr), V(0.62, fyy, fr), 0.12, 0.12, metal)
    b.box((0.22, 0.22, 0.3), loc=(0, fyy, 0.56), mat=metal)
    rod(b, V(0.24, -1.2, 1.4), V(0.24, -1.2, 2.08), 0.045, metal, segs=8)
    rod(b, V(0.24, -1.2, 2.06), V(0.24, -1.1, 2.14), 0.05, dark, segs=8)
    rod(b, V(-0.22, -1.05, 1.4), V(-0.22, -1.05, 1.62), 0.07, metal, segs=8)
    # drivetrain, platform, seat, steering
    b.box((0.64, 1.0, 0.56), loc=(0, 0.35, 0.74), mat=red, bevel=0.05, bevel_segs=1)
    rod(b, V(-0.62, ry, rr), V(0.62, ry, rr), 0.13, metal, segs=10)
    b.box((1.1, 1.02, 0.08), loc=(0, 0.66, 1.03), mat=dark, bevel=0.02, bevel_segs=1)
    b.box((0.52, 0.2, 0.3), loc=(0, 0.0, 1.46), mat=red, bevel=0.04, bevel_segs=1)
    rod(b, V(0, 0.86, 1.07), V(0, 0.86, 1.25), 0.04, metal, segs=6)
    b.box((0.5, 0.44, 0.1), loc=(0, 0.86, 1.3), mat=dark, bevel=0.035, bevel_segs=2)
    b.box((0.5, 0.1, 0.36), loc=(0, 1.1, 1.52), rot=(-0.2, 0, 0), mat=dark, bevel=0.035, bevel_segs=2)
    rod(b, V(0, 0.06, 1.55), V(0, 0.33, 1.8), 0.03, metal, segs=6)
    b.torus(0.17, 0.022, loc=(0, 0.35, 1.82), rot=(-0.79, 0, 0), mat=dark, segs=14, ring_segs=5)
    beam(b, V(-0.6, 1.14, 2.3), V(0.6, 1.14, 2.3), 0.1, 0.1, dark)
    b.box((1.36, 1.3, 0.07), loc=(0, 0.72, 2.37), mat=M['WhitePaint'], bevel=0.03, bevel_segs=1)
    b.box((0.3, 0.25, 0.1), loc=(0, 1.3, 0.56), mat=metal)
    bmesh.ops.translate(b.bm, vec=(0, 0.18, 0), verts=b.bm.verts)
    obj = b.to_object('Tractor')
    return finish(obj, 'box', 400, 'metal', ao=0.55, dist=0.6, smooth=40, sx=2.0, sy=3.6, sz=2.4)


def corrugated_profile(length, pitch, depth, out_flat, slope, thick):
    n = int(round(length / pitch))
    pitch = length / n
    in_flat = pitch - 2 * slope - out_flat
    pts = []
    u = -length / 2
    for i in range(n):
        u0 = u + i * pitch
        pts += [(u0 + in_flat / 2, 0.0), (u0 + in_flat / 2 + slope, depth), (u0 + in_flat / 2 + slope + out_flat, depth),
                (u0 + in_flat / 2 + 2 * slope + out_flat, 0.0)]
    pts = [(-length / 2, 0.0)] + pts + [(length / 2, 0.0), (length / 2, -thick), (-length / 2, -thick)]
    return pts


def wall_z(b, pts, zs, mat):
    """Closed prism of a 2D (x, y) outline through several z levels (extra levels = extra edge loops)."""
    bm = loft([[V(x, y, z) for (x, y) in pts] for z in zs], True, True)
    b.add_bm(bm, mat)
    bm.free()


def container():
    b = C.MeshBuilder()
    P, Mt = M['MetalPainted'], M['Metal']
    L, W, H = 6.1, 2.44, 2.6
    hx, hy = L / 2, W / 2
    for sx in (1, -1):
        for sy in (1, -1):
            b.box((0.16, 0.16, H - 0.04), loc=(sx * (hx - 0.08), sy * (hy - 0.08), H / 2), mat=P, bevel=0.015,
                  bevel_segs=1)
            for z in (0.07, H - 0.07):
                b.box((0.18, 0.18, 0.14), loc=(sx * (hx - 0.09), sy * (hy - 0.09), z), mat=Mt, bevel=0.01,
                      bevel_segs=1)
        b.box((L - 0.36, 0.14, 0.2), loc=(0, sx * (hy - 0.07), 0.1), mat=P, bevel=0.012, bevel_segs=1)
        b.box((L - 0.36, 0.12, 0.13), loc=(0, sx * (hy - 0.06), H - 0.065), mat=P, bevel=0.012, bevel_segs=1)
        b.box((0.14, W - 0.36, 0.2), loc=(sx * (hx - 0.07), 0, 0.1), mat=P, bevel=0.012, bevel_segs=1)
        b.box((0.14, W - 0.36, 0.2), loc=(sx * (hx - 0.07), 0, H - 0.1), mat=P, bevel=0.012, bevel_segs=1)
    # corrugated long walls
    zc, zh = (0.2 + H - 0.13) / 2, H - 0.13 - 0.2
    zs = [0.2, 0.42, H - 0.36, H - 0.13]
    prof = corrugated_profile(L - 0.32, 0.28, 0.06, 0.08, 0.045, 0.03)
    for sy in (1, -1):
        wall_z(b, [(u, sy * (hy - 0.12 + v)) for (u, v) in prof], zs, P)
    # front (-X) end wall
    prof = corrugated_profile(W - 0.32, 0.28, 0.05, 0.08, 0.045, 0.03)
    wall_z(b, [(-(hx - 0.1 + v), u) for (u, v) in prof], zs, P)
    # roof
    prof = corrugated_profile(L - 0.32, 0.55, 0.025, 0.25, 0.06, 0.03)
    b.extrude_profile([(u, H - 0.07 + v) for (u, v) in prof], W - 0.3, axis='y', loc=(0, 0, 0), mat=P)
    # doors on +X
    dx = hx - 0.07
    for sy in (1, -1):
        yc = sy * (W - 0.32) / 4
        b.box((0.05, (W - 0.32) / 2 - 0.012, H - 0.36), loc=(dx, yc, H / 2), mat=P, bevel=0.01, bevel_segs=1)
        for k in (-1, 0, 1):
            b.box((0.02, 0.1, H - 0.7), loc=(dx + 0.03, yc + k * 0.3, H / 2), mat=P)
        for yy in (yc - sy * 0.18, yc + sy * 0.3):
            rod(b, V(dx + 0.07, yy, 0.24), V(dx + 0.07, yy, H - 0.24), 0.022, Mt, segs=6)
            for z in (0.3, H - 0.3):
                b.box((0.06, 0.07, 0.07), loc=(dx + 0.05, yy, z), mat=Mt)
            b.box((0.04, 0.2, 0.04), loc=(dx + 0.1, yy - sy * 0.09, 1.25), rot=(0.35, 0, 0), mat=Mt)
        for z in (0.5, 1.3, 2.1):
            b.box((0.05, 0.08, 0.14), loc=(dx + 0.02, sy * (hy - 0.18), z), mat=Mt)
    obj = b.to_object('Container_A')
    return finish(obj, 'box', 800, 'metal', ao=0.5, dist=0.8, smooth=35, sx=6.1, sy=2.44, sz=2.6)


# =============================================================================================== small props

def fence():
    b = C.MeshBuilder()
    rnd = random.Random(14)
    for i, x in enumerate((-1.93, 0.0, 1.93)):
        rz = rnd.uniform(-0.04, 0.04)
        b.box((0.14, 0.14, 1.22), loc=(x, 0, 0.51), rot=(rnd.uniform(-0.02, 0.02), 0, rz), mat=M['WoodDark'],
              bevel=0.012, bevel_segs=1)
        b.cylinder(0.1, 0.1, loc=(x, 0, 1.17), rot=(0, 0, math.pi / 4 + rz), radius2=0.0, mat=M['WoodDark'], segs=4)
    for j, z in enumerate((0.34, 0.66, 0.98)):
        b.box((3.98, 0.045, 0.15), loc=(0, -0.095, z + rnd.uniform(-0.015, 0.015)),
              rot=(0, rnd.uniform(-0.012, 0.012), 0), mat=M['Wood'], bevel=0.012, bevel_segs=1)
    # a few nail heads
    for x in (-1.93, 0.0, 1.93):
        for z in (0.34, 0.66, 0.98):
            b.box((0.025, 0.012, 0.025), loc=(x, -0.122, z), mat=M['Metal'])
    obj = b.to_object('Fence_Wood')
    return finish(obj, 'box', 60, 'wood', ao=0.5, dist=0.35, smooth=35, sx=4.0, sy=0.2, sz=1.2)


def crate_into(b, base, s=1.1, rz=0.0, detail=True, hide=()):
    Mr = Matrix.Translation(base) @ Matrix.Rotation(rz, 4, 'Z')
    wood, dark = M['Wood'], M['WoodDark']
    bev = 0.014 if detail else 0.0
    box_m(b, (s - 0.08, s - 0.08, s - 0.08), Mr @ Matrix.Translation((0, 0, s / 2)), wood, bevel=bev)
    h = s / 2 - 0.065
    for sx in (1, -1):
        for sy in (1, -1):
            box_m(b, (0.13, 0.13, s), Mr @ Matrix.Translation((sx * h, sy * h, s / 2)), dark, bevel=bev)
    L = s - 0.26
    f = s / 2 - 0.045
    for z in (0.065, s - 0.065):
        for sy in (1, -1):
            box_m(b, (L, 0.06, 0.13), Mr @ Matrix.Translation((0, sy * f, z)), dark)
            box_m(b, (0.06, L, 0.13), Mr @ Matrix.Translation((sy * f, 0, z)), dark)
    R = Mr.to_3x3()
    a, lo, hi = s / 2 - 0.14, 0.14, s - 0.14
    for k, (n, p0, p1) in enumerate([
        (V(0, -1, 0), V(-a, -f, lo), V(a, -f, hi)), (V(0, 1, 0), V(a, f, lo), V(-a, f, hi)),
        (V(1, 0, 0), V(f, -a, hi), V(f, a, lo)), (V(-1, 0, 0), V(-f, a, hi), V(-f, -a, lo))]):
        if ('-y', '+y', '+x', '-x')[k] in hide:
            continue
        q0 = Mr @ p0
        q1 = Mr @ p1
        dd = (q1 - q0).normalized()
        beam(b, q0 - dd * 0.02, q1 + dd * 0.02, 0.12, 0.055, dark, hint=R @ n)


def crate():
    b = C.MeshBuilder()
    crate_into(b, V(0, 0, 0), 1.1, 0.0, True)
    obj = b.to_object('Crate_A')
    return finish(obj, 'box', 90, 'wood', ao=0.5, dist=0.4, smooth=35, sx=1.1, sy=1.1, sz=1.1)


def crate_stack():
    b = C.MeshBuilder()
    crate_into(b, V(-0.58, 0.02, 0), 1.08, 0.03, False, hide=('+x',))
    crate_into(b, V(0.58, -0.03, 0), 1.08, -0.05, False, hide=('-x',))
    crate_into(b, V(0.08, 0.0, 1.08), 1.06, 0.14, False)
    obj = b.to_object('Crate_Stack')
    return finish(obj, 'box', 180, 'wood', ao=0.5, dist=0.5, smooth=35, sx=2.3, sy=1.2, sz=2.2)


def barrel():
    b = C.MeshBuilder()
    P, W = M['MetalPainted'], M['WhitePaint']
    prof = [(0, 0.0), (0.285, 0.0), (0.3, 0.02), (0.3, 0.27), (0.313, 0.285), (0.313, 0.315), (0.3, 0.33),
            (0.3, 0.41), (0.3, 0.49), (0.3, 0.57), (0.313, 0.585), (0.313, 0.615), (0.3, 0.63), (0.3, 0.875),
            (0.294, 0.895), (0.278, 0.9), (0.268, 0.882), (0, 0.882)]
    mts = [P] * 7 + [W] + [P] * 9
    lathe_mats(b, prof, mts, segs=16)
    b.cylinder(0.045, 0.03, loc=(0.15, 0.06, 0.89), mat=M['Metal'], segs=8)
    b.cylinder(0.03, 0.03, loc=(-0.17, -0.02, 0.89), mat=M['Metal'], segs=8)
    obj = b.to_object('Barrel_A')
    return finish(obj, 'cyl', 80, 'metal', ao=0.5, dist=0.3, smooth=40, r=0.32, h=0.9)


def pallets():
    b = C.MeshBuilder()
    rnd = random.Random(5)
    t = 0.144
    for i in range(4):
        z0 = i * t
        m = Matrix.Translation((rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), z0)) @ \
            Matrix.Rotation(rnd.uniform(-0.05, 0.05), 4, 'Z')
        mat = M['Wood'] if i != 2 else M['WoodDark']
        for x in (-0.54, 0.0, 0.54):
            box_m(b, (0.1, 1.0, 0.022), m @ Matrix.Translation((x, 0, 0.011)), mat)
        for y in (-0.44, 0.0, 0.44):
            box_m(b, (1.2, 0.1, 0.1), m @ Matrix.Translation((0, y, 0.072)), mat)
        for k in range(5):
            x = -0.54 + k * 0.27
            box_m(b, (0.13, 1.0, 0.022), m @ Matrix.Translation((x, 0, 0.133)), mat)
    obj = b.to_object('Pallets')
    return finish(obj, 'box', 70, 'wood', ao=0.5, dist=0.3, smooth=35, sx=1.2, sy=1.0, sz=0.6)


def hay_bale():
    b = C.MeshBuilder()
    H, T = M['Hay'], M['Plastic']
    prof = [(0, -0.6), (0.25, -0.612), (0.5, -0.6), (0.68, -0.585), (0.77, -0.53), (0.8, -0.43), (0.8, -0.27),
            (0.808, -0.255), (0.8, -0.24), (0.8, 0.24), (0.808, 0.255), (0.8, 0.27), (0.8, 0.43), (0.77, 0.53),
            (0.68, 0.585), (0.5, 0.6), (0.25, 0.612), (0, 0.6)]
    mts = [H] * 6 + [T, T] + [H] + [T, T] + [H] * 6
    bm = lathe_bm(prof, mts, segs=16)
    rnd = random.Random(3)
    for v in bm.verts:
        rr = v.co.xy.length
        if rr > 0.3:
            k = 1 + rnd.uniform(-0.012, 0.012)
            v.co.x *= k
            v.co.y *= k
    mt = Matrix.Translation((0, 0, 0.8)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    bmesh.ops.transform(bm, matrix=mt, verts=bm.verts)
    for v in bm.verts:
        if v.co.z < 0.05:
            v.co.z = 0.05 - (0.05 - v.co.z) * 0.15
    zmin = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -zmin), verts=bm.verts)
    add_local(b, bm, mts)
    bm.free()
    obj = b.to_object('HayBale')
    return finish(obj, 'box', 80, 'wood', ao=0.5, dist=0.5, smooth=50, sx=1.2, sy=1.6, sz=1.6)


def tires():
    b = C.MeshBuilder()
    rnd = random.Random(2)
    prof = [(0.25, -0.1), (0.38, -0.112), (0.44, -0.06), (0.44, 0.06), (0.38, 0.112), (0.25, 0.1)]
    for i in range(4):
        z = 0.112 + i * 0.222
        tilt = 0.07 if i == 3 else 0.0
        m = Matrix.Translation((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), z + tilt * 0.3)) @ \
            Matrix.Rotation(tilt, 4, 'X') @ Matrix.Rotation(rnd.uniform(0, 1), 4, 'Z')
        lathe_mats(b, prof, [M['Rubber']], segs=12, matrix=m, close=True)
    obj = b.to_object('Tires')
    return finish(obj, 'cyl', 60, 'metal', ao=0.55, dist=0.35, smooth=50, r=0.45, h=0.9)


def lamp_post():
    b = C.MeshBuilder()
    Mt = M['Metal']
    b.cylinder(0.27, 0.2, loc=(0, 0, 0.08), mat=M['Concrete'], segs=8, radius2=0.24)
    prof = [(0.17, 0.16), (0.17, 0.27), (0.13, 0.33), (0.11, 0.7), (0.125, 0.75), (0.08, 0.82), (0.065, 4.5),
            (0.09, 4.55), (0.09, 4.62), (0.05, 4.66), (0.03, 4.78), (0.0, 4.82)]
    lathe_mats(b, [(0.0, 0.16)] + prof, [Mt], segs=10)
    tube(b, [V(0, 0, 4.4), V(0, -0.25, 4.62), V(0, -0.6, 4.72), V(0, -0.9, 4.68), V(0, -1.04, 4.56)],
         [0.035] * 5, Mt, segs=6)
    hp = [(0, 0.16), (0.07, 0.16), (0.09, 0.12), (0.28, 0.0), (0.28, -0.035), (0.23, -0.035), (0.0, -0.1)]
    lathe_mats(b, hp, [Mt, Mt, Mt, Mt, Mt, M['LightEmit']], segs=12, matrix=Matrix.Translation((0, -1.05, 4.42)))
    obj = b.to_object('LampPost')
    return finish(obj, 'cyl', 120, 'metal', ao=0.5, dist=0.4, smooth=40, r=0.15, h=5.0)


def bench():
    b = C.MeshBuilder()
    iron, wood = M['Rubber'], M['Wood']
    for x in (-0.74, 0.74):
        beam(b, V(x, -0.25, 0), V(x, -0.2, 0.43), 0.06, 0.07, iron, hint=V(0, 1, 0))
        beam(b, V(x, 0.2, 0), V(x, 0.15, 0.43), 0.06, 0.07, iron, hint=V(0, 1, 0))
        beam(b, V(x, 0.15, 0.42), V(x, 0.29, 0.9), 0.06, 0.06, iron, hint=V(0, 1, 0))
        beam(b, V(x, -0.29, 0.415), V(x, 0.2, 0.415), 0.06, 0.05, iron, hint=V(0, 0, 1))
        beam(b, V(x, -0.22, 0.42), V(x, -0.22, 0.66), 0.05, 0.05, iron, hint=V(0, 1, 0))
        beam(b, V(x, -0.3, 0.67), V(x, 0.2, 0.67), 0.08, 0.04, iron, hint=V(0, 0, 1))
        b.box((0.1, 0.1, 0.02), loc=(x, -0.25, 0.01), mat=iron)
        b.box((0.1, 0.1, 0.02), loc=(x, 0.2, 0.01), mat=iron)
    for y in (-0.24, -0.12, 0.0, 0.12):
        b.box((1.8, 0.1, 0.035), loc=(0, y, 0.458), mat=wood, bevel=0.01, bevel_segs=1)
    d = (V(0, 0.29, 0.9) - V(0, 0.15, 0.42)).normalized()
    for t in (0.35, 0.62, 0.89):
        p = V(0, 0.15, 0.42).lerp(V(0, 0.29, 0.9), t) + V(0, -0.045, 0)
        b.box((1.8, 0.03, 0.11), loc=p, rot=(-math.atan2(d.y, d.z), 0, 0), mat=wood, bevel=0.01, bevel_segs=1)
    obj = b.to_object('Bench')
    return finish(obj, 'box', 60, 'wood', ao=0.5, dist=0.3, smooth=35, sx=1.8, sy=0.6, sz=0.9)


def mailbox():
    b = C.MeshBuilder()
    P = M['MetalPainted']
    b.box((0.1, 0.1, 1.04), loc=(0, 0.06, 0.47), mat=M['Wood'], bevel=0.01, bevel_segs=1)
    b.box((0.2, 0.5, 0.04), loc=(0, 0.0, 0.97), mat=M['Wood'], bevel=0.008, bevel_segs=1)
    prof = [(-0.13, 0.99), (0.13, 0.99)] + [(0.13 * math.cos(a), 1.075 + 0.13 * math.sin(a)) for a in
                                           [math.pi * i / 8 for i in range(9)]]
    b.extrude_profile(prof, 0.48, axis='y', loc=(0, 0.0, 0), mat=P)
    prof2 = [(-0.14, 0.985), (0.14, 0.985)] + [(0.14 * math.cos(a), 1.075 + 0.14 * math.sin(a)) for a in
                                              [math.pi * i / 8 for i in range(9)]]
    b.extrude_profile(prof2, 0.025, axis='y', loc=(0, -0.245, 0), mat=P)
    b.box((0.05, 0.03, 0.03), loc=(0, -0.265, 1.12), mat=M['Metal'])
    b.cylinder(0.025, 0.02, loc=(0.14, 0.1, 1.06), rot=(0, math.pi / 2, 0), mat=M['Metal'], segs=8)
    b.box((0.015, 0.03, 0.24), loc=(0.152, 0.1, 1.17), mat=M['RedPaint'])
    b.box((0.015, 0.13, 0.08), loc=(0.152, 0.05, 1.25), mat=M['RedPaint'])
    obj = b.to_object('Mailbox')
    return finish(obj, 'cyl', 40, 'metal', ao=0.5, dist=0.25, smooth=40, r=0.25, h=1.2)


def dumpster():
    b = C.MeshBuilder()
    P, Mt, dark = M['MetalPainted'], M['Metal'], M['Rubber']
    prof = [(-0.5, 0.15), (0.52, 0.15), (0.55, 1.1), (-0.6, 1.1)]
    bm = prism_x(prof, 1.9)
    bevel_sharp(bm, 0.04, 2, 25)
    add_local(b, bm, [P])
    bm.free()
    b.box((1.98, 0.09, 0.09), loc=(0, -0.62, 1.1), mat=P)
    b.box((1.98, 0.09, 0.09), loc=(0, 0.575, 1.1), mat=P)
    for sx in (1, -1):
        b.box((0.09, 1.22, 0.09), loc=(sx * 0.975, -0.02, 1.1), mat=P)
        b.box((0.1, 0.9, 0.16), loc=(sx * 0.98, -0.02, 0.8), mat=Mt, bevel=0.015, bevel_segs=1)
        m = Matrix.Translation((sx * 0.49, 0.6, 1.16)) @ Matrix.Rotation(0.075, 4, 'X') @ \
            Matrix.Translation((0, -0.61, 0.02))
        box_m(b, (0.95, 1.24, 0.05), m, dark, bevel=0.02)
        box_m(b, (0.3, 0.06, 0.04), m @ Matrix.Translation((0, -0.6, 0.0)), dark)
        rod(b, V(sx * 0.2, 0.62, 1.15), V(sx * 0.75, 0.62, 1.15), 0.03, Mt, segs=6)
        for sy in (1, -1):
            b.box((0.1, 0.1, 0.05), loc=(sx * 0.78, sy * 0.36, 0.13), mat=Mt)
            b.cylinder(0.065, 0.05, loc=(sx * 0.78, sy * 0.36, 0.065), rot=(0, math.pi / 2, 0), mat=dark, segs=8)
    for x in (-0.6, 0.0, 0.6):
        beam(b, V(x, -0.515, 0.2), V(x, -0.61, 1.03), 0.07, 0.04, P, hint=V(0, -1, 0))
    obj = b.to_object('Dumpster')
    return finish(obj, 'box', 250, 'metal', ao=0.55, dist=0.45, smooth=35, sx=2.0, sy=1.2, sz=1.3)


def stone_block(r0, r1, a0, a1, z0, z1, bulge=0.02):
    rings = []
    for t in (0.0, 0.5, 1.0):
        a = a0 + (a1 - a0) * t
        ca, sa = math.cos(a), math.sin(a)
        ro = r1 + (bulge if t == 0.5 else 0.0)
        zt = z1 + (0.012 if t == 0.5 else 0.0)
        rings.append([V(r0 * ca, r0 * sa, z0), V(ro * ca, ro * sa, z0), V(ro * ca, ro * sa, zt),
                      V(r0 * ca, r0 * sa, zt)])
    return loft(rings, True, True)


def well():
    b = C.MeshBuilder()
    rnd = random.Random(8)
    ri, ro = 0.6, 0.86
    lathe_mats(b, [(ri + 0.03, 0.0), (ro - 0.04, 0.0), (ro - 0.04, 0.8), (ri + 0.03, 0.8)], [M['Concrete']],
               segs=12, close=True)
    n = 9
    for k in range(3):
        z0, z1 = k * 0.265, (k + 1) * 0.265
        for i in range(n):
            a0 = (i + 0.5 * (k % 2)) * 2 * math.pi / n + 0.018
            a1 = a0 + 2 * math.pi / n - 0.036
            bm = stone_block(ri, ro + rnd.uniform(-0.015, 0.02), a0, a1, z0 + 0.008, z1 - 0.008 + rnd.uniform(-0.01, 0.01))
            b.add_bm(bm, M['Rock'])
            bm.free()
    for i in range(8):
        a0 = i * 2 * math.pi / 8 + 0.02
        a1 = a0 + 2 * math.pi / 8 - 0.04
        bm = stone_block(ri - 0.04, ro + 0.05, a0, a1, 0.79, 0.88 + rnd.uniform(-0.01, 0.01), 0.01)
        add_fn(b, bm, moss_fn(0.8, i + 3))
        bm.free()
    b.cylinder(ri + 0.02, 0.04, loc=(0, 0, 0.5), mat=M['Glass'], segs=12)
    wd = M['WoodDark']
    ridge, th = 2.4, 0.6
    for x in (-0.74, 0.74):
        b.box((0.12, 0.12, ridge - 0.84), loc=(x, 0, (0.84 + ridge) / 2), mat=wd, bevel=0.012, bevel_segs=1)
        beam(b, V(x, 0, 1.95), V(x, -0.36, ridge - 0.22), 0.07, 0.07, wd, hint=V(1, 0, 0))
        beam(b, V(x, 0, 1.95), V(x, 0.36, ridge - 0.22), 0.07, 0.07, wd, hint=V(1, 0, 0))
    b.cylinder(0.065, 1.62, loc=(0, 0, 1.72), rot=(0, math.pi / 2, 0), mat=M['Wood'], segs=8)
    b.cylinder(0.095, 0.34, loc=(0, 0, 1.72), rot=(0, math.pi / 2, 0), mat=M['Hay'], segs=8)
    rod(b, V(0.81, 0, 1.72), V(0.92, 0, 1.72), 0.025, M['Metal'], segs=5)
    rod(b, V(0.92, 0, 1.72), V(0.92, -0.02, 1.5), 0.022, M['Metal'], segs=5)
    rod(b, V(0.92, -0.02, 1.5), V(1.04, -0.02, 1.5), 0.028, M['Wood'], segs=6)
    rod(b, V(0, -0.09, 1.66), V(0, -0.09, 1.2), 0.012, M['Hay'], segs=4)
    lathe_mats(b, [(0, 0.0), (0.12, 0.0), (0.145, 0.2), (0.13, 0.2), (0.11, 0.03), (0, 0.03)],
               [M['Wood'], M['Wood'], M['Metal'], M['Wood'], M['Wood']], segs=10,
               matrix=Matrix.Translation((0, -0.09, 1.0)))
    rod(b, V(-0.13, -0.09, 1.2), V(0.13, -0.09, 1.2), 0.01, M['Metal'], segs=4)
    # gable roof (ridge along X) with shingle steps
    b.box((2.06, 0.12, 0.12), loc=(0, 0, ridge), mat=M['Wood'], bevel=0.015, bevel_segs=1)
    for sy in (1, -1):
        dirv = V(0, sy * math.cos(th), -math.sin(th))
        nrm = V(0, sy * math.sin(th), math.cos(th))
        c = V(0, 0, ridge + 0.02) + dirv * 0.52
        b.box((2.0, 1.04, 0.06), loc=c, rot=(-sy * th, 0, 0), mat=wd, bevel=0.015, bevel_segs=1)
        for t in (0.36, 0.7, 1.02):
            p = V(0, 0, ridge + 0.02) + dirv * t + nrm * 0.035
            b.box((2.03, 0.05, 0.035), loc=p, rot=(-sy * th, 0, 0), mat=wd)
    obj = b.to_object('Well')
    return finish(obj, 'cyl', 300, 'stone', ao=0.55, dist=0.45, smooth=40, r=0.9, h=2.5)


def tent():
    b = C.MeshBuilder()
    fly, inner, dark, Mt = M['Plastic'], M['WhitePaint'], M['Rubber'], M['Metal']
    b.extrude_profile([(-1.02, 0.0), (1.02, 0.0), (0.0, 1.28)], 1.76, axis='y', mat=inner)
    # sagging fly sheet
    eave, top = V(-1.2, 0, 0.1), V(0, 0, 1.44)
    outer = []
    n = 6
    for side in (-1, 1):
        rng = range(n + 1) if side == -1 else range(n - 1, -1, -1)
        for i in rng:
            t = i / n
            e = V(side * 1.2, 0, 0.1)
            p = e.lerp(top, t)
            nrm = V(-side * 1.34, 0, -1.2 * 1.0).normalized() * -1
            p = p - nrm * (0.07 * math.sin(math.pi * t))
            outer.append((p.x, p.z))
    innerp = [(x, z - 0.05) for (x, z) in reversed(outer)]
    b.extrude_profile(outer + innerp, 2.0, axis='y', mat=fly)
    # open door (dark) with rolled flaps
    b.extrude_profile([(-0.42, 0.02), (0.42, 0.02), (0.0, 0.98)], 0.02, axis='y', loc=(0, -0.885, 0), mat=dark)
    rod(b, V(-0.47, -0.9, 0.05), V(-0.05, -0.9, 1.0), 0.04, inner, segs=6)
    rod(b, V(0.47, -0.9, 0.05), V(0.05, -0.9, 1.0), 0.04, inner, segs=6)
    for sy in (1, -1):
        rod(b, V(0, sy * 1.02, 0), V(0, sy * 1.02, 1.56), 0.018, Mt, segs=6)
        rod(b, V(0, sy * 1.02, 1.5), V(0, sy * 1.7, 0.03), 0.007, inner, segs=4)
        rod(b, V(0, sy * 1.7, -0.05), V(0, sy * 1.72, 0.1), 0.015, Mt, segs=4)
        for sx in (1, -1):
            rod(b, V(sx * 1.2, sy * 0.98, 0.1), V(sx * 1.45, sy * 1.2, 0.02), 0.007, inner, segs=4)
            rod(b, V(sx * 1.45, sy * 1.2, -0.05), V(sx * 1.46, sy * 1.21, 0.08), 0.013, Mt, segs=4)
    obj = b.to_object('Tent')
    return finish(obj, 'box', 60, 'wood', ao=0.55, dist=0.5, smooth=35, sx=2.4, sy=2.0, sz=1.5)


def campfire():
    b = C.MeshBuilder()
    rnd = random.Random(12)
    for i in range(8):
        a = i * 2 * math.pi / 8 + rnd.uniform(-0.1, 0.1)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.22 * rnd.uniform(0.85, 1.15), 0.17, 0.15 * rnd.uniform(0.85, 1.2)), verts=bm.verts)
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=0.04, segments=1, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
        for v in bm.verts:
            v.co *= 1 + 0.12 * noise.noise(v.co * 6 + V(i * 3.1, i, 0))
        m = Matrix.Translation((0.55 * math.cos(a), 0.55 * math.sin(a), 0.05)) @ \
            Matrix.Rotation(a + math.pi / 2, 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.15, 0.15), 4, 'X')
        b.add_bm(bm, M['Rock'], m)
        bm.free()
    b.cylinder(0.44, 0.03, loc=(0, 0, 0.0), mat=M['Rubber'], segs=10)
    for i in range(4):
        a = i * math.pi / 2 + 0.4
        d = V(math.cos(a), math.sin(a), 0)
        rod(b, d * 0.36 + V(0, 0, 0.03), d * 0.05 + V(0, 0, 0.42), 0.05, M['Bark'], segs=5)
    rod(b, V(-0.36, -0.1, 0.06), V(0.36, 0.14, 0.08), 0.055, M['Bark'], segs=5)
    for (x, y, s, lean, az) in ((0, 0, 1.0, 0.0, 0.0), (0.1, 0.05, 0.62, 0.35, 0.5), (-0.09, -0.06, 0.7, 0.35, 3.6)):
        fb = lathe_bm([(0, 0.0), (0.12 * s, 0.07 * s), (0.13 * s, 0.18 * s), (0.08 * s, 0.34 * s), (0.03 * s, 0.5 * s),
                       (0, 0.64 * s)], [M['LightEmit']], segs=6)
        for v in fb.verts:
            h = v.co.z / (0.64 * s)
            ang = 1.6 * h
            x0, y0 = v.co.x, v.co.y
            v.co.x = x0 * math.cos(ang) - y0 * math.sin(ang) + 0.05 * s * math.sin(h * 5.0)
            v.co.y = x0 * math.sin(ang) + y0 * math.cos(ang)
        m = Matrix.Translation((x, y, 0.03)) @ Matrix.Rotation(az, 4, 'Z') @ Matrix.Rotation(lean, 4, 'Y')
        add_local(b, fb, [M['LightEmit']], m)
        fb.free()

    obj = b.to_object('Campfire')
    return finish(obj, 'none', 0, 'wood', ao=0.5, dist=0.3, smooth=40)


# =============================================================================================== landmarks

WINDMILL_HUB_Z = 13.2


def windmill():
    b = C.MeshBuilder()
    dark, wood, Mt, red = M['WoodDark'], M['Wood'], M['Metal'], M['RedPaint']
    base, top, zt = 1.45, 0.4, 11.0

    def leg(t, sx, sy):
        r = base + (top - base) * t
        return V(sx * r, sy * r, zt * t)

    corners = [(1, 1), (1, -1), (-1, -1), (-1, 1)]
    for sx, sy in corners:
        beam(b, leg(0, sx, sy) + V(0, 0, -0.15), leg(1, sx, sy) + V(0, 0, 0.05), 0.17, 0.17, dark,
             hint=V(sx, sy, 0))
        b.box((0.42, 0.42, 0.3), loc=leg(0, sx, sy) + V(0, 0, 0.1), mat=M['Concrete'], bevel=0.03, bevel_segs=1)
    levels = [0.0, 0.26, 0.48, 0.67, 0.84, 1.0]
    for li in range(len(levels) - 1):
        t0, t1 = levels[li], levels[li + 1]
        for ci in range(4):
            c1, c2 = corners[ci], corners[(ci + 1) % 4]
            nrm = V(c1[0] + c2[0], c1[1] + c2[1], 0).normalized()
            off = nrm * 0.06
            a0, a1 = leg(t0 + 0.01, *c1), leg(t1 - 0.01, *c2)
            beam(b, a0 + off, a1 + off, 0.09, 0.05, wood, hint=nrm)
            a0, a1 = leg(t0 + 0.01, *c2), leg(t1 - 0.01, *c1)
            beam(b, a0 + off * 1.8, a1 + off * 1.8, 0.09, 0.05, wood, hint=nrm)
            if li > 0:
                beam(b, leg(t0, *c1) + off * 0.9, leg(t0, *c2) + off * 0.9, 0.12, 0.07, dark, hint=nrm)
    # deck
    for k in range(6):
        y = -0.55 + k * 0.22
        b.box((1.3, 0.2, 0.06), loc=(0, y, zt + 0.08), mat=wood, bevel=0.01, bevel_segs=1)
    for sy in (1, -1):
        b.box((1.34, 0.1, 0.1), loc=(0, sy * 0.52, zt + 0.0), mat=dark)
    # ladder up the back (+Y) face
    for sx in (-0.22, 0.22):
        beam(b, V(sx, base + 0.14, 0.0), V(sx, top + 0.14, zt + 0.1), 0.05, 0.05, dark, hint=V(0, 1, 0))
    n = 26
    for i in range(1, n):
        t = i / n
        y = base + (top - base) * t + 0.14
        b.box((0.44, 0.035, 0.035), loc=(0, y, zt * t), mat=wood)
    # pump rod + base pump
    rod(b, V(0, 0, 0.3), V(0, 0, zt), 0.025, Mt, segs=5)
    b.box((0.3, 0.3, 0.5), loc=(0, 0, 0.25), mat=Mt, bevel=0.03, bevel_segs=1)
    rod(b, V(0, -0.1, 0.4), V(0, -0.45, 0.35), 0.04, Mt, segs=6)
    # mast, gearbox head, tail vane
    hz = WINDMILL_HUB_Z
    rod(b, V(0, 0.32, zt - 0.4), V(0, 0.32, hz - 0.2), 0.075, Mt, segs=8)
    b.box((0.44, 0.78, 0.44), loc=(0, 0.36, hz), mat=red, bevel=0.07, bevel_segs=2)
    rod(b, V(0, -0.06, hz), V(0, 0.1, hz), 0.07, Mt, segs=8)
    beam(b, V(0, 0.7, hz + 0.05), V(0, 2.55, hz + 0.25), 0.07, 0.07, Mt)
    beam(b, V(0, 0.7, hz - 0.15), V(0, 2.3, hz + 0.1), 0.05, 0.05, Mt)
    b.box((0.035, 1.35, 0.85), loc=(0, 2.95, hz + 0.25), mat=red, bevel=0.02, bevel_segs=1)
    b.box((0.045, 1.1, 0.16), loc=(0, 2.98, hz + 0.25), mat=M['WhitePaint'])
    obj = b.to_object('Windmill')
    finish(obj, 'cyl', 1000, 'wood', ao=0.5, dist=0.6, smooth=35, r=1.8, h=14.0)
    obj['hub_z'] = hz
    return obj


def windmill_blades():
    """Fan pivoting at its own origin; blades lie in the XZ plane, facing -Y (spin about Y)."""
    b = C.MeshBuilder()
    white, red, Mt = M['WhitePaint'], M['RedPaint'], M['Metal']
    n = 18
    R0, Rs, R1 = 0.45, 1.42, 1.85
    pitch = 0.42
    Y = V(0, 1, 0)
    for i in range(n):
        a = 2 * math.pi * i / n
        rad = V(math.cos(a), 0, math.sin(a))
        tan = V(-math.sin(a), 0, math.cos(a))
        tp = tan * math.cos(pitch) + Y * math.sin(pitch)
        nrm = rad.cross(tp).normalized()
        for (r0, r1, mat) in ((R0, Rs, white), (Rs, R1, red)):
            w0 = 0.2 + 0.2 * (r0 - R0) / (R1 - R0)
            w1 = 0.2 + 0.2 * (r1 - R0) / (R1 - R0)
            ring0 = [rad * r0 + tp * (w0 / 2) + nrm * 0.012, rad * r0 - tp * (w0 / 2) + nrm * 0.012,
                     rad * r0 - tp * (w0 / 2) - nrm * 0.012, rad * r0 + tp * (w0 / 2) - nrm * 0.012]
            ring1 = [rad * r1 + tp * (w1 / 2) + nrm * 0.012, rad * r1 - tp * (w1 / 2) + nrm * 0.012,
                     rad * r1 - tp * (w1 / 2) - nrm * 0.012, rad * r1 + tp * (w1 / 2) - nrm * 0.012]
            bm = loft([ring0, ring1], True, True)
            b.add_bm(bm, mat)
            bm.free()
    for rr in (0.95, 1.62):
        b.torus(rr, 0.03, loc=(0, 0.06, 0), rot=(math.pi / 2, 0, 0), mat=Mt, segs=30, ring_segs=4)
    for i in range(6):
        a = 2 * math.pi * (i + 0.5) / 6
        rad = V(math.cos(a), 0, math.sin(a))
        beam(b, rad * 0.15 + V(0, 0.06, 0), rad * 1.64 + V(0, 0.06, 0), 0.05, 0.04, Mt, hint=Y)
    b.cylinder(0.2, 0.3, loc=(0, 0.02, 0), rot=(math.pi / 2, 0, 0), mat=red, segs=12)
    b.cylinder(0.2, 0.2, loc=(0, -0.23, 0), rot=(math.pi / 2, 0, 0), radius2=0.05, mat=Mt, segs=12)
    obj = b.to_object('Windmill_Blades')
    return finish(obj, 'none', 0, 'wood', ao=0.4, dist=0.3, smooth=35, ground=False)


def water_tower():
    b = C.MeshBuilder()
    Mt, P, red = M['Metal'], M['MetalPainted'], M['RedPaint']
    lb, lt, zt = 1.72, 1.3, 9.6

    def leg(t, sx, sy):
        r = lb + (lt - lb) * t
        return V(sx * r, sy * r, zt * t)

    corners = [(1, 1), (1, -1), (-1, -1), (-1, 1)]
    for sx, sy in corners:
        rod(b, leg(0, sx, sy) + V(0, 0, -0.1), leg(1, sx, sy) + V(0, 0, 0.1), 0.14, Mt, segs=8)
        b.box((0.55, 0.55, 0.3), loc=leg(0, sx, sy) + V(0, 0, 0.1), mat=M['Concrete'], bevel=0.03, bevel_segs=1)
    levels = [0.0, 0.34, 0.67, 1.0]
    for li in range(len(levels) - 1):
        t0, t1 = levels[li], levels[li + 1]
        for ci in range(4):
            c1, c2 = corners[ci], corners[(ci + 1) % 4]
            rod(b, leg(t0 + 0.02, *c1), leg(t1 - 0.02, *c2), 0.03, Mt, segs=4)
            rod(b, leg(t0 + 0.02, *c2), leg(t1 - 0.02, *c1), 0.03, Mt, segs=4)
            if li > 0:
                rod(b, leg(t0, *c1), leg(t0, *c2), 0.065, Mt, segs=6)
    prof = [(0, 9.25), (0.9, 9.34), (1.8, 9.58), (2.25, 9.86), (2.32, 10.0), (2.32, 10.95), (2.37, 11.0),
            (2.37, 11.08), (2.32, 11.13), (2.32, 12.1), (2.37, 12.15), (2.37, 12.23), (2.32, 12.28), (2.32, 13.0),
            (2.5, 13.05), (2.5, 13.14), (1.4, 13.95), (0.35, 14.6), (0.12, 14.7), (0, 14.72)]
    mts = [P] * 15 + [red, red, red, red]
    lathe_mats(b, prof, mts, segs=24)
    b.sphere(0.13, loc=(0, 0, 14.82), mat=Mt, segs=8, rings=6)
    b.cylinder(0.12, 0.3, loc=(0.9, 0.3, 13.8), mat=Mt, segs=8)
    # catwalk + railing
    lathe_mats(b, [(2.3, 9.9), (2.95, 9.9), (2.95, 9.98), (2.3, 9.98)], [Mt], segs=24, close=True)
    for i in range(12):
        a = 2 * math.pi * i / 12
        p = V(math.cos(a) * 2.9, math.sin(a) * 2.9, 9.98)
        rod(b, p, p + V(0, 0, 0.92), 0.025, Mt, segs=4)
        s0 = V(math.cos(a) * 2.35, math.sin(a) * 2.35, 9.6)
        rod(b, s0, p - V(0, 0, 0.04), 0.03, Mt, segs=4)
    b.torus(2.9, 0.035, loc=(0, 0, 10.9), mat=Mt, segs=24, ring_segs=4)
    b.torus(2.9, 0.025, loc=(0, 0, 10.45), mat=Mt, segs=24, ring_segs=4)
    # ladders: up one leg, then up the tank wall
    c0, c1 = leg(0, 1, -1), leg(1, 1, -1)
    along = (c1 - c0).normalized()
    side = V(1, 1, 0).normalized()
    outv = V(1, -1, 0).normalized()
    for s in (-0.2, 0.2):
        rod(b, c0 + side * s + outv * 0.22, c1 + side * s + outv * 0.22 + V(0, 0, 0.3), 0.022, Mt, segs=4)
    L = (c1 - c0).length
    n = int(L / 0.36)
    for i in range(1, n):
        p = c0 + along * (L * i / n) + outv * 0.22
        rod(b, p - side * 0.2, p + side * 0.2, 0.016, Mt, segs=4)
    for s in (-0.2, 0.2):
        rod(b, V(s, -2.42, 9.98), V(s, -2.42, 13.1), 0.022, Mt, segs=4)
    for i in range(1, 9):
        z = 9.98 + i * 0.35
        rod(b, V(-0.2, -2.42, z), V(0.2, -2.42, z), 0.016, Mt, segs=4)
    obj = b.to_object('WaterTower')
    return finish(obj, 'cyl', 1500, 'metal', ao=0.5, dist=0.8, smooth=40, r=2.5, h=15.0)


def radio_tower():
    b = C.MeshBuilder()
    red, white, Mt = M['RedPaint'], M['WhitePaint'], M['Metal']
    H, rb, rt = 22.0, 1.12, 0.36
    angs = [math.radians(90), math.radians(210), math.radians(330)]

    def P(t, k):
        r = rb + (rt - rb) * t
        return V(r * math.cos(angs[k]), r * math.sin(angs[k]), H * t)

    nsec = 8
    for s in range(nsec):
        t0, t1 = s / nsec, (s + 1) / nsec
        mat = red if s % 2 == 1 else white
        for k in range(3):
            rod(b, P(t0, k) + V(0, 0, -0.2 if s == 0 else 0), P(t1, k), 0.07 - 0.02 * t0, mat, segs=6)
            k2 = (k + 1) % 3
            if s > 0:
                rod(b, P(t0, k), P(t0, k2), 0.03, mat, segs=4)
            if s % 2 == 0:
                rod(b, P(t0, k), P(t1, k2), 0.025, mat, segs=4)
            else:
                rod(b, P(t0, k2), P(t1, k), 0.025, mat, segs=4)
    for k in range(3):
        rod(b, P(1, k), P(1, (k + 1) % 3), 0.035, red, segs=4)
        b.box((0.6, 0.6, 0.32), loc=P(0, k) + V(0, 0, 0.08), mat=M['Concrete'], bevel=0.03, bevel_segs=1)
        # panel antennas
        pk = P(0.86, k)
        out = V(math.cos(angs[k]), math.sin(angs[k]), 0)
        b.box((0.26, 0.1, 1.3), loc=pk + out * 0.16, rot=(0, 0, angs[k] + math.pi / 2), mat=white, bevel=0.03,
              bevel_segs=1)
        b.ico(0.1, loc=P(0.5, k) + out * 0.1, mat=M['RedLight'], subdiv=1)
    rod(b, V(0, 0, H - 0.3), V(0, 0, H + 1.9), 0.07, Mt, segs=6, r2=0.035)
    b.ico(0.14, loc=(0, 0, H + 2.0), mat=M['RedLight'], subdiv=1)
    b.cylinder(0.3, 0.06, loc=(0, 0, H + 0.02), mat=Mt, segs=8)
    # drum dish facing -Y
    dz = 15.0
    dp = V(0, -0.62, dz)
    b.cylinder(0.46, 0.24, loc=dp + V(0, -0.1, 0), rot=(math.pi / 2, 0, 0), mat=white, segs=14)
    b.cylinder(0.46, 0.08, loc=dp + V(0, -0.26, 0), rot=(math.pi / 2, 0, 0), radius2=0.4, mat=M['Concrete'],
               segs=14)
    rod(b, dp + V(0, 0.05, 0), V(0, -0.2, dz), 0.05, Mt, segs=6)
    obj = b.to_object('RadioTower')
    return finish(obj, 'cyl', 1500, 'metal', ao=0.45, dist=0.8, smooth=40, r=1.2, h=24.0)


# =============================================================================================== build

def tree_pine_a():
    return tree_pine('Tree_Pine_A', 11.0, [(2.1, 3.0, 3.2), (4.0, 2.55, 3.0), (5.7, 2.1, 2.8), (7.2, 1.6, 2.6),
                                           (8.6, 1.1, 2.4)], 0.36, 1, 0.45, 300)


def tree_pine_b():
    return tree_pine('Tree_Pine_B', 8.0, [(1.8, 1.9, 2.6), (3.4, 1.6, 2.4), (4.9, 1.25, 2.2), (6.2, 0.85, 1.8)],
                     0.28, 2, 0.35, 240)


BUILDERS = [
    tree_pine_a, tree_pine_b, tree_oak_a, tree_oak_b, tree_birch, tree_palm, tree_dead,
    bush_a, bush_b,
    lambda: rock('Rock_A', (1.45, 1.25, 1.05), 11, 300),
    lambda: rock('Rock_B', (2.1, 1.8, 1.7), 12, 450),
    lambda: rock('Rock_C', (3.1, 2.6, 2.4), 13, 600),
    rock_big, stump, log,
    car_sedan, car_pickup, lambda: car_sedan('Car_Wreck', wreck=True), container, tractor,
    fence, crate, crate_stack, barrel, pallets, hay_bale, tires, lamp_post, bench, mailbox, dumpster, well, tent,
    campfire,
    windmill, windmill_blades, water_tower, radio_tower,
]

SHEETS = [
    ('trees_a', ['Tree_Pine_A', 'Tree_Pine_B', 'Tree_Oak_A', 'Tree_Oak_B'], dict(gap=0.3, size=(1000, 480))),
    ('trees_b', ['Tree_Birch_A', 'Tree_Palm_A', 'Tree_Dead_A', 'Bush_A', 'Bush_B'], dict(gap=0.4, size=(1000, 480))),
    ('rocks', ['Rock_A', 'Rock_B', 'Rock_C', 'Rock_Big', 'Stump_A', 'Log_A'], dict(gap=0.5, size=(1000, 420))),
    ('vehicles', ['Car_Sedan', 'Car_Pickup', 'Car_Wreck', 'Tractor'],
     dict(gap=1.0, size=(1000, 420), view=(-0.75, -1.0, 0.45))),
    ('misc_a', ['Container_A', 'Dumpster', 'Crate_A', 'Crate_Stack', 'Pallets', 'Barrel_A', 'Tires'],
     dict(gap=0.4, size=(1000, 420), view=(-0.45, -1.0, 0.42))),
    ('misc_b', ['Fence_Wood', 'HayBale', 'Bench', 'Mailbox', 'LampPost', 'Well', 'Tent', 'Campfire'],
     dict(gap=0.4, size=(1000, 420), view=(-0.35, -1.0, 0.38))),
    ('landmarks', ['Windmill', 'WaterTower', 'RadioTower'], dict(gap=2.0, size=(800, 600), view=(-0.4, -1.0, 0.3))),
]


def build(preview_dir=None, sheets=None, debug=False):
    C.reset()
    C.clear_material_cache()
    mats()
    objs = []
    for fn in BUILDERS:
        o = fn()
        o.location = (0, 0, 0)
        objs.append(o)
    by = {o.name: o for o in objs}
    if preview_dir:
        import os
        os.makedirs(preview_dir, exist_ok=True)
        for key, names, kw in SHEETS:
            if sheets and key not in sheets:
                continue
            follow = []
            if 'Windmill' in names:
                follow = [(by['Windmill_Blades'], by['Windmill'], (0, 0, by['Windmill']['hub_z']))]
            render_sheet(os.path.join(preview_dir, key + '.png'), [by[n] for n in names], follow=follow,
                         samples=16, **kw)
            if debug:
                for ch in ('ao', 'wind'):
                    render_sheet(os.path.join(preview_dir, '%s_%s.png' % (key, ch)), [by[n] for n in names],
                                 follow=follow, samples=4, debug=ch, **kw)
    for o in objs:
        o.location = (0, 0, 0)
    path = C.export_glb('props.glb', objs, colors=True)
    total = 0
    print('%-16s %6s  %s' % ('object', 'tris', 'props'))
    for o in objs:
        t = tri_count(o)
        total += t
        print('%-16s %6d  %s' % (o.name, t, {k: o[k] for k in o.keys()}))
    import os
    print('total tris', total, ' glb', os.path.getsize(path), 'bytes')
    return objs


if __name__ == '__main__':
    import sys
    build(sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else None)
