"""Outbuild gear: weapons, pickups/items and vehicles.

    python -c "import sys; sys.path.insert(0, '.'); import gear; gear.build(preview_dir='/tmp/prev')"

Writes weapons.glb, items.glb and vehicles.glb to outbuild/assets/models.

Conventions (see common.py): Blender Z-up, metres.
* Weapons: barrel along -Y, origin at the right-hand pistol grip, child empties <Name>_Muzzle / <Name>_Hand.
* Items: origin at the base centre on the ground, front towards -Y.
* Every mesh carries a 'Color' point attribute: R = baked ambient occlusion, G = 0, B = 1.

All designs are original. Shapes are built from rounded side profiles ("slabs"), lathes and swept tubes,
then shaded with face-area weighted normals so the chamfered rims read as soft, chunky edges.
"""
import math
import os
import random
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

import common as C

PI = math.pi


# ============================================================================ geometry helpers
# Weapon space: f = distance forward (towards -Y), z = up, x = weapon's left.

def V(f, z, x=0.0):
    return Vector((x, -f, z))


def rounded(pts, r=0.0, segs=2):
    """Closed 2D polygon with filleted corners. pts: (u, v) or (u, v, radius)."""
    P = [Vector((p[0], p[1])) for p in pts]
    R = [p[2] if len(p) > 2 else r for p in pts]
    n = len(P)
    out = []
    for i in range(n):
        p, a, c = P[i], P[i - 1], P[(i + 1) % n]
        rad = R[i]
        if rad <= 0 or segs < 1:
            out.append(p.copy())
            continue
        d1 = p - a
        l1 = d1.length
        d2 = c - p
        l2 = d2.length
        if l1 < 1e-9 or l2 < 1e-9:
            out.append(p.copy())
            continue
        d1 /= l1
        d2 /= l2
        ang = math.acos(max(-1.0, min(1.0, -d1.dot(d2))))
        if ang > PI - 0.02:
            out.append(p.copy())
            continue
        t = min(rad / math.tan(ang / 2), 0.48 * l1, 0.48 * l2)
        s, e = p - d1 * t, p + d2 * t
        for k in range(segs + 1):
            u = k / segs
            out.append((1 - u) ** 2 * s + 2 * (1 - u) * u * p + u * u * e)
    return [(q.x, q.y) for q in out]


def _area2(pts):
    return sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts))) * 0.5


def _inset(pts, d):
    """Inset a CCW polygon by d (mitred)."""
    n = len(pts)
    P = [Vector(p) for p in pts]
    out = []
    for i in range(n):
        a, p, c = P[i - 1], P[i], P[(i + 1) % n]
        e1 = p - a
        e2 = c - p
        if e1.length < 1e-9:
            e1 = e2
        if e2.length < 1e-9:
            e2 = e1
        e1.normalize()
        e2.normalize()
        n1 = Vector((-e1.y, e1.x))
        n2 = Vector((-e2.y, e2.x))
        m = n1 + n2
        if m.length < 1e-6:
            m = n1
        m.normalize()
        k = max(m.dot(n1), 0.4)
        out.append(p + m * (d / k))
    return out


def loft(b, rings, mat=None, closed=True, wrap=False, cap0=False, cap1=False, mats=None, seg_mat=None):
    """Join rings of 3D points with quads (a ring of one point makes a fan). Returns the new faces.
    seg_mat(k, i) -> material overrides the material of band k, segment i."""
    bm = b.bm
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    nr = len(vr)
    faces = []

    def mi(k):
        return b.mat_index(mats[k] if mats else mat)

    for k in range(nr if wrap else nr - 1):
        A, B = vr[k], vr[(k + 1) % nr]
        idx = mi(k)
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1 or len(B) == 1:
            ring = B if len(A) == 1 else A
            tip = A[0] if len(A) == 1 else B[0]
            n = len(ring)
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                f = bm.faces.new((tip, ring[j], ring[i]) if len(A) == 1 else (ring[i], ring[j], tip))
                f.material_index = b.mat_index(seg_mat(k, i)) if seg_mat else idx
                faces.append(f)
            continue
        n = len(A)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = b.mat_index(seg_mat(k, i)) if seg_mat else idx
            faces.append(f)
    if cap0 and len(vr[0]) > 2:
        f = bm.faces.new(list(reversed(vr[0])))
        f.material_index = mi(0)
        faces.append(f)
    if cap1 and len(vr[-1]) > 2:
        f = bm.faces.new(vr[-1])
        f.material_index = mi(max(0, nr - 2))
        faces.append(f)
    return faces


def _mapper(axis, c0):
    """2D profile (u, v) + extrusion w -> 3D. axis x: (f, z) side profile; y: (x, z) cross-section extruded
    along f; z: (x, f) top view extruded up."""
    if axis == 'x':
        return lambda u, v, w: Vector((c0 + w, -u, v))
    if axis == 'y':
        return lambda u, v, w: Vector((u, -(c0 + w), v))
    return lambda u, v, w: Vector((u, -v, c0 + w))


def slab(b, pts, width, mat=None, bevel=0.004, bsegs=1, c=0.0, axis='x', wfun=None, xform=None):
    """Extrude a closed 2D profile by `width` (centred on c) with chamfered (bsegs=1) or rounded rims."""
    pts = [tuple(p) for p in pts]
    if _area2(pts) < 0:
        pts = list(reversed(pts))
    to3 = _mapper(axis, c)
    half = width / 2
    bevel = min(bevel, half * 0.9)
    prof = []
    for i in range(bsegs + 1):
        th = (PI / 2) * i / max(bsegs, 1)
        prof.append((bevel * (1 - math.sin(th)), half - bevel * (1 - math.cos(th))))
    if bevel <= 0:
        prof = [(0.0, half)]
    prof = prof + [(d, -w) for (d, w) in reversed(prof)]
    rings = []
    for d, w in prof:
        ring2 = _inset(pts, d) if d > 0 else [Vector(p) for p in pts]
        ring = []
        for q, o in zip(ring2, pts):
            ww = w * (wfun(o[0], o[1]) if wfun else 1.0)
            p3 = to3(q.x, q.y, ww)
            if xform is not None:
                p3 = xform @ p3
            ring.append(p3)
        rings.append(ring)
    return loft(b, rings, mat, closed=True, cap0=True, cap1=True)


def revolve(b, prof, axis='y', center=(0, 0, 0), segs=12, mat=None, mats=None, scale=(1.0, 1.0), cap0=True,
            cap1=True, closed_prof=False, rot0=0.0, xform=None, seg_mat=None):
    """Lathe a (radius, t) profile. axis 'y': t runs forward (towards -Y); 'z': t up; 'x': t along +X."""
    cx, cy, cz = center
    sx, sz = scale
    rings = []
    for r, t in prof:
        if r < 1e-6:
            pts = [(0.0, 0.0)]
        else:
            pts = [(r * math.cos(rot0 + 2 * PI * i / segs) * sx, r * math.sin(rot0 + 2 * PI * i / segs) * sz)
                   for i in range(segs)]
        ring = []
        for u, v in pts:
            if axis == 'y':
                p = Vector((cx + u, cy - t, cz + v))
            elif axis == 'z':
                p = Vector((cx + u, cy + v, cz + t))
            else:
                p = Vector((cx + t, cy + u, cz + v))
            if xform is not None:
                p = xform @ p
            ring.append(p)
        rings.append(ring)
    return loft(b, rings, mat, closed=True, wrap=closed_prof, cap0=cap0 and not closed_prof,
                cap1=cap1 and not closed_prof, mats=mats, seg_mat=seg_mat)


def frames(path, up=None):
    """Parallel-transport frames (T, N, B) along a polyline."""
    P = [Vector(p) for p in path]
    n = len(P)
    T = []
    for i in range(n):
        a = P[max(i - 1, 0)]
        c = P[min(i + 1, n - 1)]
        T.append((c - a).normalized())
    up = Vector(up) if up is not None else Vector((0, 0, 1))
    if abs(up.normalized().dot(T[0])) > 0.95:
        up = Vector((1, 0, 0)) if abs(T[0].x) < 0.9 else Vector((0, 1, 0))
    N = [(up - T[0] * up.dot(T[0])).normalized()]
    for i in range(1, n):
        q = T[i - 1].rotation_difference(T[i])
        nn = q @ N[-1]
        nn = (nn - T[i] * nn.dot(T[i])).normalized()
        N.append(nn)
    B = [T[i].cross(N[i]) for i in range(n)]
    return P, T, N, B


def sweep(b, path, radius=0.01, segs=8, mat=None, cap0=True, cap1=True, shape=None, scales=None, up=None,
          mats=None, closed=False, rot0=0.0):
    """Sweep a circle (or a 2D shape in the N/B plane) along a 3D path. scales: per-point (su, sv) or float."""
    P, T, N, B = frames(path, up)
    if shape is None:
        shape = [(math.cos(rot0 + 2 * PI * i / segs), math.sin(rot0 + 2 * PI * i / segs)) for i in range(segs)]
        base = radius
    else:
        base = 1.0
    rings = []
    for i, p in enumerate(P):
        s = scales[i] if scales is not None else 1.0
        su, sv = (s, s) if not isinstance(s, (tuple, list)) else s
        if su < 1e-6 and sv < 1e-6:
            rings.append([p.copy()])
            continue
        rings.append([p + N[i] * (u * base * su) + B[i] * (v * base * sv) for u, v in shape])
    return loft(b, rings, mat, closed=True, wrap=closed, cap0=cap0 and not closed, cap1=cap1 and not closed,
                mats=mats)


def bez(pts, n):
    """Sample a quadratic/cubic Bezier (3 or 4 control points) with n+1 points."""
    P = [Vector(p) for p in pts]
    out = []
    for k in range(n + 1):
        t = k / n
        if len(P) == 3:
            out.append((1 - t) ** 2 * P[0] + 2 * (1 - t) * t * P[1] + t * t * P[2])
        else:
            out.append((1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1] + 3 * (1 - t) * t * t * P[2] +
                       t ** 3 * P[3])
    return out


def bx(b, f0, f1, z0, z1, w, x=0.0, mat=None, bevel=0.0, segs=1, rot=(0, 0, 0)):
    """Box by weapon-space extents."""
    b.box((w, abs(f1 - f0), abs(z1 - z0)), loc=(x, -(f0 + f1) / 2, (z0 + z1) / 2), rot=rot, mat=mat,
          bevel=bevel, bevel_segs=segs)


def cy(b, r, f0, f1, z, x=0.0, segs=10, mat=None, r2=None, bevel=0.0):
    """Cylinder along the forward axis from f0 (radius r) to f1 (radius r2)."""
    b.cylinder(r, abs(f1 - f0), loc=(x, -(f0 + f1) / 2, z), rot=(PI / 2, 0, 0), mat=mat, segs=segs,
               radius2=r2, bevel=bevel)


def ring_prof(r_in, r_out, t0, t1, chamfer=0.0):
    """Closed (r, t) profile of a hollow ring / tube wall."""
    c = chamfer
    if c <= 0:
        return [(r_in, t0), (r_out, t0), (r_out, t1), (r_in, t1)]
    return [(r_in, t0), (r_out - c, t0), (r_out, t0 + c), (r_out, t1 - c), (r_out - c, t1), (r_in, t1)]


# ============================================================================ finishing

def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bake_ao(obj, dist=0.1, strength=0.8, samples=48, eps=None, ground=None, name='Color'):
    """Per-vertex AO by ray casting against the object itself (+ optional ground plane at z=ground, object
    space). Writes a POINT/BYTE_COLOR attribute with R = AO, G = 0, B = 1 and makes it the active colour."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    eps = dist * 0.02 if eps is None else eps
    # fibonacci sphere directions
    dirs = []
    ga = PI * (3 - math.sqrt(5))
    for i in range(samples * 2):
        z = 1 - (i + 0.5) / (samples * 2) * 2
        r = math.sqrt(max(0.0, 1 - z * z))
        dirs.append(Vector((math.cos(ga * i) * r, math.sin(ga * i) * r, z)))
    vals = []
    for v in bm.verts:
        n = v.normal
        if n.length < 0.5:
            vals.append(1.0)
            continue
        o = v.co + n * eps
        occ = 0.0
        tot = 0.0
        for d in dirs:
            c = d.dot(n)
            if c <= 0.05:
                continue
            tot += c
            loc, _, _, t = tree.ray_cast(o, d, dist)
            hit_t = t if loc is not None else None
            if ground is not None and d.z < -1e-4:
                tg = (ground - o.z) / d.z
                if 0 < tg < dist and (hit_t is None or tg < hit_t):
                    hit_t = tg
            if hit_t is not None:
                occ += c * (1.0 - 0.5 * hit_t / dist)
        a = 1.0 - strength * (occ / tot if tot else 0.0)
        vals.append(max(0.0, min(1.0, a)))
    bm.free()
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new(name, 'BYTE_COLOR', 'POINT')
    for i, a in enumerate(vals):
        attr.data[i].color = (a, 0.0, 1.0, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    me.color_attributes.default_color_name = name
    return attr


def finish(obj, ao_dist=0.1, ao_strength=0.75, sharp=60, ground=None, samples=48, weighted=True):
    """Smooth shading with hard edges above `sharp` degrees, area-weighted normals, baked AO colour."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges)
    bm.to_mesh(me)
    bm.free()
    C.set_smooth_by_angle(obj, sharp)
    if weighted:
        mod = obj.modifiers.new('wn', 'WEIGHTED_NORMAL')
        mod.mode = 'FACE_AREA'
        mod.weight = 50
        mod.keep_sharp = True
        mod.thresh = 0.01
        C.apply_modifiers(obj)
    bake_ao(obj, dist=ao_dist, strength=ao_strength, ground=ground, samples=samples)
    obj.data.name = obj.name
    return obj


def center_origin(obj, axes=(0, 1, 2)):
    """Shift the mesh so its bounding-box centre sits on the origin (for the chosen axes)."""
    vs = [v.co for v in obj.data.vertices]
    off = Vector((0, 0, 0))
    for a in axes:
        off[a] = -(min(v[a] for v in vs) + max(v[a] for v in vs)) / 2
    obj.data.transform(Matrix.Translation(off))
    return off


def drop_to_ground(obj):
    """Shift the mesh so its lowest point sits at z = 0 (items rest on the ground at their origin)."""
    zmin = min(v.co.z for v in obj.data.vertices)
    obj.data.transform(Matrix.Translation((0, 0, -zmin)))


def add_empty(parent, name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.03
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = Vector(loc)
    return e


# ============================================================================ preview rendering

def render(path, cam_loc, target, size=(800, 500), samples=24, lens=50, ortho=None, world='#aeb9c6',
           ground=None, sun_rot=(0.75, 0.15, 0.9), sun_energy=3.2):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy' if 'AgX - Punchy' in [
        i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
    if not sc.world:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (*C.hex_color(world), 1)
    bg.inputs[1].default_value = 0.9
    temp = []
    cd = bpy.data.cameras.new('cam')
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
    cd.clip_end = 500
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    cam.location = cam_loc
    cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    temp.append(cam)
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy = sun_energy
    sd.angle = 0.1
    sun = bpy.data.objects.new('sun', sd)
    sun.rotation_euler = sun_rot
    sc.collection.objects.link(sun)
    temp.append(sun)
    fd = bpy.data.lights.new('fill', 'SUN')
    fd.energy = 0.8
    fd.angle = 0.5
    fill = bpy.data.objects.new('fill', fd)
    fill.rotation_euler = (-0.9, 0.3, -2.4)
    sc.collection.objects.link(fill)
    temp.append(fill)
    if ground is not None:
        gm = bpy.data.meshes.new('ground')
        s = 400
        gm.from_pydata([(-s, -s, ground), (s, -s, ground), (s, s, ground), (-s, s, ground)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new('ground', gm)
        mat = bpy.data.materials.new('groundmat')
        mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*C.hex_color('#8d9a7c'), 1)
        mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
        gm.materials.append(mat)
        sc.collection.objects.link(g)
        temp.append(g)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in temp:
        data = o.data
        bpy.data.objects.remove(o)
        if isinstance(data, bpy.types.Mesh):
            for m in data.materials:
                if m:
                    bpy.data.materials.remove(m)
            bpy.data.meshes.remove(data)
    print('preview', path)


def _layout(placements):
    """Temporarily move top-level objects for a contact sheet. placements: {obj: (x, y, z, rotz)}."""
    saved = {}
    for o, (x, y, z, rz) in placements.items():
        saved[o] = (o.location.copy(), o.rotation_euler.copy())
        o.location = o.location + Vector((x, y, z))
        o.rotation_euler = (0, 0, rz)
    return saved


def _restore(saved):
    for o, (loc, rot) in saved.items():
        o.location = loc
        o.rotation_euler = rot


# ============================================================================ weapons

def weapon_mats():
    return dict(
        body=C.material('GunBody', '#2b2f36', rough=0.55),
        metal=C.material('GunMetal', '#70757d', rough=0.35, metal=1.0),
        wood=C.material('GunWood', '#8b5a34', rough=0.6),
        rar=C.material('Rarity', '#a7adb3', rough=0.45),
        glass=C.material('GunGlass', '#ff5a48', rough=0.1, emit='#ff2a18', emit_strength=4.0),
        tip=C.material('RocketTip', '#e04a2a', rough=0.45),
    )


def plate(b, pts, c, side, mat, h=0.0025, chamfer=0.0012, axis='x', sink=0.0015):
    """Thin raised panel / inset slot on a flat face at coordinate c, facing +side (one-sided, cheap)."""
    pts = [tuple(p) for p in pts]
    if _area2(pts) < 0:
        pts = list(reversed(pts))
    to3 = _mapper(axis, c)
    base = [to3(u, v, -side * sink) for (u, v) in pts]
    top = [to3(q.x, q.y, side * h) for q in _inset(pts, chamfer)]
    return loft(b, [base, top], mat, closed=True, cap1=True)


def pistol_grip(b, mat, top=0.058, bottom=-0.072, rake=0.028, depth=0.044, w=0.034, bevel=0.006,
                cap_mat=None):
    """Raked pistol grip centred on the origin (the right-hand hold)."""
    k = rake / (top - bottom)
    hd = depth / 2
    pts = [
        (k * top + hd + 0.012, top),
        (k * 0.03 + hd + 0.001, 0.03, 0.01),
        (k * -0.005 + hd + 0.004, -0.005, 0.012),
        (k * -0.035 + hd + 0.001, -0.035, 0.012),
        (k * bottom + hd + 0.002, bottom, 0.008),
        (k * bottom - hd - 0.006, bottom - 0.004, 0.01),
        (k * 0.0 - hd - 0.006, 0.0, 0.03),
        (k * top - hd, top, 0.0),
    ]
    slab(b, rounded(pts, segs=2), w, mat, bevel=bevel, bsegs=1)
    if cap_mat is not None:
        cb = bottom - 0.004
        slab(b, rounded([(k * bottom + hd + 0.004, cb + 0.012), (k * bottom - hd - 0.008, cb + 0.012),
                         (k * bottom - hd - 0.009, cb - 0.004, 0.004), (k * bottom + hd + 0.005, cb - 0.004, 0.004)],
                        segs=1), w + 0.004, cap_mat, bevel=0.003)


def bez_poly(pts, n=3):
    """Round a polyline by sampling quadratic Beziers through segment midpoints."""
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a = (P[i - 1] + P[i]) / 2 if i > 1 else P[0]
        c = (P[i] + P[i + 1]) / 2 if i < len(P) - 2 else P[-1]
        seg = bez([a, P[i], c], n)
        out.extend(seg[1:])
    return out


def trigger_group(b, m, f0=0.022, f1=0.09, ztop=0.048, zbot=0.012, guard_mat=None):
    """Trigger guard loop + trigger in front of the grip."""
    gm = guard_mat or m['body']
    path = [V(f0, zbot + 0.006), V(f0 + 0.02, zbot), V(f1 - 0.018, zbot), V(f1 - 0.002, zbot + 0.012),
            V(f1 + 0.002, ztop + 0.004)]
    sweep(b, bez_poly(path, 2), segs=6, mat=gm, up=(1, 0, 0),
          shape=[(math.cos(2 * PI * i / 6) * 0.0072, math.sin(2 * PI * i / 6) * 0.005) for i in range(6)])
    tf = f0 + (f1 - f0) * 0.42
    slab(b, rounded([(tf - 0.004, ztop + 0.004), (tf + 0.005, ztop + 0.004), (tf + 0.002, ztop - 0.014, 0.006),
                     (tf - 0.008, ztop - 0.026, 0.003), (tf - 0.01, ztop - 0.022), (tf - 0.004, ztop - 0.012, 0.006)],
                    segs=1), 0.008, m['metal'], bevel=0.0015)


def rail(b, m, f0, f1, z, w=0.024, pitch=0.03, mat=None):
    """Top accessory rail with cross slots."""
    mat = mat or m['metal']
    bx(b, f0, f1, z, z + 0.008, w, mat=mat, bevel=0.0015)
    n = int((f1 - f0 - 0.006) / pitch)
    s = f0 + (f1 - f0 - n * pitch) / 2 + pitch / 2
    for i in range(n):
        f = s + i * pitch
        bx(b, f - pitch * 0.3, f + pitch * 0.3, z + 0.007, z + 0.014, w, mat=mat)


def red_dot(b, m, f, z):
    """Chunky reflex sight standing on a rail whose top is at z."""
    bx(b, f - 0.032, f + 0.03, z, z + 0.012, 0.03, mat=m['metal'], bevel=0.003)
    zc = z + 0.04
    slab(b, rounded([(f - 0.034, z + 0.006), (f + 0.034, z + 0.006), (f + 0.034, zc - 0.006, 0.006),
                     (f - 0.034, zc - 0.006, 0.006)], segs=1), 0.042, m['body'], bevel=0.005)
    revolve(b, ring_prof(0.02, 0.027, f - 0.03, f + 0.034, 0.004), 'y', (0, 0, zc), segs=12, mat=m['body'],
            closed_prof=True, rot0=PI / 12)
    cy(b, 0.0205, f + 0.018, f + 0.022, zc, mat=m['glass'], segs=12)
    bx(b, f - 0.014, f + 0.012, zc + 0.024, zc + 0.033, 0.014, mat=m['rar'], bevel=0.003)
    b.cylinder(0.008, 0.012, loc=(-0.028, -(f - 0.004), zc - 0.004), rot=(0, PI / 2, 0), segs=8, mat=m['rar'])


def curved_mag(b, top, bottom, width, depth0, depth1, mat, base_mat, n=5, bend=0.014):
    """Curved box magazine between top and bottom centres (f, z)."""
    (tf, tz), (bf, bz) = top, bottom
    ctrl = ((tf + bf) / 2 - bend, (tz + bz) / 2)
    pts = bez([Vector((tf, tz)), Vector(ctrl), Vector((bf, bz))], n)
    left, right = [], []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        c = pts[min(i + 1, n)]
        t = (c - a).normalized()
        nrm = Vector((t.y, -t.x))
        if nrm.x < 0:
            nrm = -nrm
        hd = (depth0 + (depth1 - depth0) * i / n) / 2
        left.append(p + nrm * hd)
        right.append(p - nrm * hd)
    poly = [(q.x, q.y) for q in left] + [(q.x, q.y) for q in reversed(right)]
    poly = [(u, v, 0.007 if i in (n, n + 1) else 0.0) for i, (u, v) in enumerate(poly)]
    slab(b, rounded(poly, segs=2), width, mat, bevel=0.004, bsegs=1)
    # ribs on the sides
    for k in (0.35, 0.65):
        i = int(round(k * n))
        pa, pb = left[i], right[i]
        mid = (pa + pb) / 2
        d = (pa - pb).normalized()
        up = Vector((-d.y, d.x))
        if up.y < 0:
            up = -up
        hl = (pa - pb).length / 2 - 0.008
        quad = [mid + d * hl + up * 0.004, mid - d * hl + up * 0.004, mid - d * hl - up * 0.004,
                mid + d * hl - up * 0.004]
        for s in (1, -1):
            plate(b, rounded([(q.x, q.y, 0.003) for q in quad], segs=1), s * width / 2, s, base_mat, h=0.002)
    # base plate
    p, q = left[-1], right[-1]
    d = (p - q).normalized()
    dn = Vector((-d.y, d.x))
    if dn.y > 0:
        dn = -dn
    e0 = p + d * 0.006
    e1 = q - d * 0.005
    pl = [e0 + dn * 0.012, e1 + dn * 0.012, e1 - dn * 0.008, e0 - dn * 0.008]
    slab(b, rounded([(v.x, v.y, 0.004) for v in pl], segs=1), width + 0.006, base_mat, bevel=0.003)


# ---------------------------------------------------------------------------- pistol

def w_pistol(m):
    b = C.MeshBuilder()
    pistol_grip(b, m['body'], top=0.052, bottom=-0.066, rake=0.03, depth=0.042, w=0.032, cap_mat=m['metal'])
    k = 0.03 / 0.118
    for s in (1, -1):
        plate(b, rounded([(k * 0.035 + 0.017, 0.035), (k * -0.05 + 0.018, -0.05), (k * -0.05 - 0.021, -0.05),
                          (k * 0.035 - 0.02, 0.035)], r=0.008, segs=1), s * 0.016, s, m['rar'], h=0.003)
    trigger_group(b, m, f0=0.02, f1=0.075, ztop=0.046, zbot=0.014)
    # frame / dust cover with a small accessory rail
    slab(b, rounded([(-0.036, 0.062), (0.164, 0.062), (0.164, 0.045, 0.004), (0.15, 0.034, 0.004),
                     (0.07, 0.034), (0.05, 0.044), (-0.02, 0.044), (-0.04, 0.052, 0.006)], segs=1), 0.03,
         m['body'], bevel=0.004)
    for i in range(3):
        f = 0.105 + i * 0.018
        bx(b, f, f + 0.01, 0.03, 0.036, 0.022, mat=m['body'])
    # slide
    slab(b, rounded([(-0.046, 0.06), (0.172, 0.06), (0.174, 0.094, 0.006), (0.166, 0.102, 0.004),
                     (-0.04, 0.102, 0.004), (-0.046, 0.094, 0.004)], segs=2), 0.031, m['metal'], bevel=0.0045)
    plate(b, [(-0.006, -0.018), (0.006, -0.018), (0.006, 0.13), (-0.006, 0.13)], 0.102, 1, m['rar'], h=0.003,
          axis='z')
    for s in (1, -1):
        for i in range(4):
            f = -0.036 + i * 0.008
            plate(b, [(f - 0.002, 0.068), (f + 0.002, 0.068), (f + 0.002, 0.094), (f - 0.002, 0.094)], s * 0.0155,
                  s, m['body'], h=0.0012, chamfer=0.0005)
    plate(b, rounded([(0.035, 0.09), (0.078, 0.09), (0.078, 0.1), (0.035, 0.1)], r=0.002, segs=1), -0.0155, -1,
          m['body'], h=0.001)
    # muzzle + bore
    cy(b, 0.0085, 0.168, 0.1755, 0.08, segs=10, mat=m['body'])
    cy(b, 0.005, 0.174, 0.177, 0.08, segs=8, mat=m['metal'])
    # sights
    bx(b, 0.152, 0.164, 0.1, 0.11, 0.007, mat=m['body'], bevel=0.002)
    bx(b, -0.042, -0.026, 0.1, 0.112, 0.022, mat=m['body'], bevel=0.0025)
    b.sphere(0.0022, loc=V(0.158, 0.108, 0.0), segs=6, rings=4, mat=m['glass'])
    # hammer + slide stop
    bx(b, -0.054, -0.042, 0.066, 0.084, 0.012, mat=m['metal'], bevel=0.002, rot=(0.3, 0, 0))
    plate(b, rounded([(0.02, 0.063), (0.062, 0.063), (0.062, 0.07), (0.02, 0.07)], r=0.003, segs=1), 0.0155, 1,
          m['metal'], h=0.002)
    obj = b.to_object('W_Pistol')
    finish(obj, ao_dist=0.04)
    add_empty(obj, 'W_Pistol_Muzzle', V(0.177, 0.08))
    add_empty(obj, 'W_Pistol_Hand', V(0.006, -0.02, 0.024))
    return obj


# ---------------------------------------------------------------------------- SMG

def w_smg(m):
    b = C.MeshBuilder()
    zb = 0.105
    pistol_grip(b, m['body'], top=0.052, bottom=-0.07, rake=0.026, depth=0.042, w=0.032, cap_mat=m['rar'])
    trigger_group(b, m, f0=0.02, f1=0.075, ztop=0.046, zbot=0.012)
    # receiver
    slab(b, rounded([(-0.105, 0.146), (0.2, 0.146), (0.216, 0.132, 0.01), (0.216, 0.072, 0.01),
                     (0.2, 0.05, 0.006), (0.125, 0.05), (0.12, 0.022, 0.004), (0.068, 0.022, 0.004),
                     (0.062, 0.046), (-0.07, 0.046), (-0.105, 0.07, 0.01)], segs=2), 0.054, m['body'], bevel=0.006,
         bsegs=1)
    for s in (1, -1):
        plate(b, rounded([(-0.082, 0.098), (0.19, 0.098), (0.196, 0.128), (-0.076, 0.128)], r=0.005, segs=1),
              s * 0.027, s, m['rar'], h=0.003)
        plate(b, rounded([(0.0, 0.108), (0.15, 0.108), (0.15, 0.118), (0.0, 0.118)], r=0.004, segs=1),
              s * 0.03, s, m['body'], h=0.0012)
    # top: low rail + sights
    rail(b, m, -0.07, 0.17, 0.146, w=0.022, pitch=0.026)
    slab(b, rounded([(-0.09, 0.146), (-0.058, 0.146), (-0.062, 0.172, 0.005), (-0.086, 0.172, 0.005)], segs=1),
         0.03, m['body'], bevel=0.004)
    slab(b, rounded([(0.172, 0.146), (0.204, 0.146), (0.2, 0.176, 0.005), (0.178, 0.176, 0.005)], segs=1),
         0.024, m['body'], bevel=0.004)
    bx(b, 0.186, 0.192, 0.172, 0.18, 0.004, mat=m['rar'])
    # barrel shroud + barrel + muzzle
    revolve(b, [(0.0, 0.2), (0.021, 0.2), (0.023, 0.206), (0.023, 0.268), (0.02, 0.274), (0.0, 0.274)], 'y',
            (0, 0, zb), segs=10, mat=m['body'], rot0=PI / 10)
    for i in range(3):
        f = 0.22 + i * 0.016
        for s in (1, -1):
            plate(b, rounded([(f - 0.005, zb - 0.006), (f + 0.005, zb - 0.006), (f + 0.005, zb + 0.006),
                              (f - 0.005, zb + 0.006)], r=0.003, segs=1), s * 0.0215, s, m['metal'], h=0.002)
    revolve(b, [(0.0, 0.27), (0.01, 0.27), (0.01, 0.286), (0.014, 0.288), (0.014, 0.302), (0.012, 0.306),
                (0.0065, 0.306), (0.0065, 0.298), (0.0, 0.298)], 'y', (0, 0, zb), segs=10, mat=m['metal'])
    # straight magazine
    slab(b, rounded([(0.07, 0.03), (0.114, 0.03), (0.12, -0.15, 0.005), (0.078, -0.15, 0.005)], segs=1),
         0.026, m['metal'], bevel=0.003)
    slab(b, rounded([(0.072, -0.145), (0.126, -0.145), (0.126, -0.162, 0.005), (0.07, -0.162, 0.005)], segs=1),
         0.032, m['body'], bevel=0.003)
    for s in (1, -1):
        for i in range(2):
            z = -0.025 - i * 0.055
            plate(b, rounded([(0.082, z - 0.008), (0.108, z - 0.008), (0.109, z + 0.008), (0.083, z + 0.008)],
                             r=0.003, segs=1), s * 0.013, s, m['body'], h=0.002)
    # angled foregrip
    slab(b, rounded([(0.156, 0.052), (0.204, 0.052), (0.2, -0.012, 0.012), (0.194, -0.03, 0.008),
                     (0.162, -0.03, 0.008), (0.158, 0.0, 0.01)], segs=2), 0.032, m['body'], bevel=0.006, bsegs=1)
    for i in range(3):
        z = 0.03 - i * 0.02
        bx(b, 0.162, 0.2, z - 0.003, z + 0.003, 0.034, mat=m['rar'], bevel=0.001)
    # charging knob (left)
    b.cylinder(0.007, 0.022, loc=(0.034, -0.14, 0.13), rot=(0, PI / 2, 0), segs=8, mat=m['metal'])
    # folding stock: hinge + two struts + butt
    b.cylinder(0.012, 0.056, loc=(0.0, 0.113, 0.1), segs=10, mat=m['metal'])
    bx(b, -0.117, -0.1, 0.07, 0.134, 0.042, mat=m['metal'], bevel=0.003)
    sweep(b, [V(-0.11, 0.122), V(-0.2, 0.122)], 0.0072, segs=8, mat=m['metal'])
    sweep(b, [V(-0.11, 0.078), V(-0.2, 0.036)], 0.0072, segs=8, mat=m['metal'])
    slab(b, rounded([(-0.194, 0.142), (-0.212, 0.142), (-0.216, 0.12, 0.006), (-0.216, 0.03, 0.006),
                     (-0.194, 0.018), (-0.19, 0.028, 0.004), (-0.19, 0.132, 0.004)], segs=1), 0.038, m['body'],
         bevel=0.004)
    slab(b, rounded([(-0.214, 0.136), (-0.222, 0.136), (-0.222, 0.024), (-0.214, 0.024)], r=0.003, segs=1),
         0.036, m['rar'], bevel=0.002)
    obj = b.to_object('W_SMG')
    finish(obj, ao_dist=0.05)
    add_empty(obj, 'W_SMG_Muzzle', V(0.306, zb))
    add_empty(obj, 'W_SMG_Hand', V(0.18, 0.012))
    return obj


# ---------------------------------------------------------------------------- assault rifle

def w_ar(m):
    b = C.MeshBuilder()
    zb = 0.12
    pistol_grip(b, m['body'], cap_mat=m['body'])
    trigger_group(b, m, f0=0.024, f1=0.088, ztop=0.048, zbot=0.014)
    # lower receiver with magwell
    slab(b, rounded([(-0.105, 0.108), (0.182, 0.108), (0.182, 0.066, 0.008), (0.174, 0.018, 0.006),
                     (0.094, 0.018, 0.006), (0.088, 0.046), (-0.06, 0.046), (-0.105, 0.074, 0.012)], segs=2),
         0.05, m['body'], bevel=0.005, bsegs=1)
    for s in (1, -1):
        plate(b, rounded([(0.1, 0.03), (0.168, 0.03), (0.172, 0.07), (0.1, 0.07)], r=0.006, segs=1), s * 0.025, s,
              m['metal'], h=0.002)
    # upper receiver
    slab(b, rounded([(-0.114, 0.104), (0.222, 0.104), (0.222, 0.162, 0.006), (-0.1, 0.162, 0.006),
                     (-0.114, 0.148, 0.006)], segs=2), 0.054, m['body'], bevel=0.005, bsegs=1)
    plate(b, rounded([(0.02, 0.114), (0.1, 0.114), (0.1, 0.142), (0.02, 0.142)], r=0.004, segs=1), -0.027, -1,
          m['metal'], h=0.003)
    plate(b, rounded([(-0.09, 0.118), (0.0, 0.118), (0.0, 0.13), (-0.09, 0.13)], r=0.004, segs=1), 0.027, 1,
          m['rar'], h=0.003)
    plate(b, rounded([(-0.09, 0.118), (0.0, 0.118), (0.0, 0.13), (-0.09, 0.13)], r=0.004, segs=1), -0.027, -1,
          m['rar'], h=0.003)
    b.cylinder(0.009, 0.02, loc=(-0.03, 0.075, 0.138), rot=(PI / 2, 0, 0.5), segs=8, mat=m['metal'])
    bx(b, -0.126, -0.1, 0.146, 0.16, 0.04, mat=m['metal'], bevel=0.003)
    # rail + red dot
    rail(b, m, -0.095, 0.455, 0.162, w=0.026)
    red_dot(b, m, 0.03, 0.176)
    # handguard (rarity): rounded-octagon section, vent slots
    hg = rounded([(-0.031, 0.086), (-0.019, 0.07), (0.019, 0.07), (0.031, 0.086), (0.031, 0.148), (0.021, 0.162),
                  (-0.021, 0.162), (-0.031, 0.148)], r=0.006, segs=1)
    slab(b, hg, 0.25, m['rar'], bevel=0.007, bsegs=1, c=0.342, axis='y')
    for s in (1, -1):
        for i in range(3):
            f = 0.245 + i * 0.07
            plate(b, rounded([(f, 0.1), (f + 0.052, 0.1), (f + 0.052, 0.13), (f, 0.13)], r=0.012, segs=2),
                  s * 0.031, s, m['body'], h=0.0015)
    for i in range(3):
        f = 0.25 + i * 0.07
        plate(b, rounded([(-0.01, f), (0.01, f), (0.01, f + 0.045), (-0.01, f + 0.045)], r=0.006, segs=1), 0.07,
              -1, m['body'], h=0.0015, axis='z')
    # barrel, gas block, muzzle brake
    cy(b, 0.0125, 0.46, 0.57, zb, segs=10, mat=m['metal'])
    bx(b, 0.474, 0.5, zb - 0.018, zb + 0.022, 0.03, mat=m['metal'], bevel=0.004)
    revolve(b, [(0.0, 0.558), (0.018, 0.558), (0.021, 0.563), (0.021, 0.61), (0.017, 0.616),
                (0.008, 0.616), (0.008, 0.604), (0.0, 0.604)], 'y', (0, 0, zb), segs=8, mat=m['metal'],
            rot0=PI / 8)
    for i in range(2):
        f = 0.572 + i * 0.019
        for s in (1, -1):
            plate(b, [(f, zb - 0.007), (f + 0.011, zb - 0.007), (f + 0.011, zb + 0.007), (f, zb + 0.007)],
                  s * 0.0195, s, m['body'], h=0.001, chamfer=0.0008)
    # front sight post on rail end
    slab(b, rounded([(0.42, 0.176), (0.452, 0.176), (0.446, 0.204, 0.005), (0.43, 0.204, 0.005)], segs=1),
         0.024, m['body'], bevel=0.004)
    # curved magazine
    curved_mag(b, (0.134, 0.05), (0.196, -0.125), 0.03, 0.062, 0.068, m['metal'], m['body'])
    # stock: solid chunky body + rarity inserts + butt pad
    stock = [(-0.12, 0.158), (-0.29, 0.158, 0.012), (-0.306, 0.14), (-0.306, -0.028, 0.01), (-0.29, -0.04, 0.01),
             (-0.262, -0.03, 0.02), (-0.2, 0.066, 0.05), (-0.14, 0.094, 0.02), (-0.12, 0.098)]
    slab(b, rounded(stock, segs=2), 0.046, m['body'], bevel=0.007, bsegs=1,
         wfun=lambda u, v: 0.85 + 0.15 * min(1.0, max(0.0, (-u - 0.13) / 0.15)))
    for s in (1, -1):
        plate(b, rounded([(-0.17, 0.126), (-0.284, 0.128), (-0.284, 0.1), (-0.21, 0.084)], r=0.008, segs=2),
              s * 0.0228, s, m['rar'], h=0.003)
    slab(b, rounded([(-0.302, 0.156), (-0.322, 0.156), (-0.322, -0.036), (-0.302, -0.04)], r=0.006, segs=1),
         0.05, m['body'], bevel=0.005)
    obj = b.to_object('W_AR')
    finish(obj, ao_dist=0.07)
    add_empty(obj, 'W_AR_Muzzle', V(0.616, zb))
    add_empty(obj, 'W_AR_Hand', V(0.34, 0.066))
    return obj


# ---------------------------------------------------------------------------- pump shotgun

def w_pump(m):
    b = C.MeshBuilder()
    zb = 0.12
    zt = 0.084
    pistol_grip(b, m['wood'], top=0.056, bottom=-0.07, rake=0.034, depth=0.044, w=0.036, cap_mat=m['body'])
    trigger_group(b, m, f0=0.024, f1=0.088, ztop=0.046, zbot=0.014, guard_mat=m['metal'])
    # receiver
    slab(b, rounded([(-0.07, 0.134), (-0.05, 0.156), (0.15, 0.156), (0.156, 0.146), (0.156, 0.068),
                     (0.14, 0.052), (0.02, 0.046), (-0.07, 0.056)], r=0.008, segs=2), 0.056, m['body'],
         bevel=0.006, bsegs=1)
    for s in (1, -1):
        plate(b, rounded([(-0.036, 0.07), (0.132, 0.07), (0.137, 0.14), (-0.03, 0.142)], r=0.012, segs=2),
              s * 0.028, s, m['rar'], h=0.003)
        plate(b, rounded([(0.0, 0.1), (0.1, 0.1), (0.1, 0.11), (0.0, 0.11)], r=0.004, segs=1), s * 0.031, s,
              m['body'], h=0.0012)
    plate(b, rounded([(0.03, 0.124), (0.1, 0.124), (0.1, 0.142), (0.03, 0.142)], r=0.003, segs=1), -0.031, -1,
          m['metal'], h=0.001)
    # barrel + vent rib + bead
    cy(b, 0.015, 0.15, 0.672, zb, segs=12, mat=m['metal'])
    revolve(b, ring_prof(0.009, 0.0172, 0.666, 0.69, 0.003), 'y', (0, 0, zb), segs=12, mat=m['metal'],
            closed_prof=True)
    bx(b, 0.15, 0.672, zb + 0.013, zb + 0.02, 0.012, mat=m['metal'], bevel=0.0015)
    b.sphere(0.0045, loc=V(0.664, zb + 0.024), mat=m['rar'], segs=8, rings=6)
    # tube magazine + cap + barrel clamp
    cy(b, 0.013, 0.15, 0.6, zt, segs=12, mat=m['metal'])
    revolve(b, [(0.0, 0.6), (0.015, 0.6), (0.015, 0.622), (0.012, 0.63), (0.0, 0.632)], 'y', (0, 0, zt),
            segs=12, mat=m['body'])
    slab(b, rounded([(-0.022, zt - 0.013), (0.022, zt - 0.013), (0.022, zb + 0.004), (0.0, zb + 0.024),
                     (-0.022, zb + 0.004)], r=0.01, segs=2), 0.022, m['rar'], bevel=0.003, c=0.575, axis='y')
    # pump with grip ridges
    prof = [(0.0, 0.25), (0.019, 0.25), (0.027, 0.254)]
    f = 0.262
    for i in range(7):
        prof += [(0.032, f), (0.032, f + 0.012), (0.028, f + 0.016), (0.028, f + 0.022)]
        f += 0.022
    prof += [(0.032, f), (0.032, f + 0.02), (0.027, f + 0.028), (0.019, f + 0.032), (0.0, f + 0.032)]
    revolve(b, prof, 'y', (0, 0, zt + 0.006), segs=10, mat=m['wood'], scale=(1.0, 0.92), rot0=PI / 10)
    for s in (1, -1):
        cy(b, 0.0045, 0.15, 0.26, zt + 0.004, x=s * 0.021, segs=6, mat=m['metal'])
    # stock (wood, tapered) + recoil pad + rarity band
    stock = [(-0.06, 0.144), (-0.2, 0.134), (-0.318, 0.138, 0.008), (-0.322, 0.12), (-0.322, -0.022, 0.006),
             (-0.31, -0.034), (-0.2, 0.018, 0.05), (-0.11, 0.052, 0.03), (-0.04, 0.06)]
    wf = (lambda u, v: 0.8 + 0.2 * min(1.0, max(0.0, (-u - 0.06) / 0.2)))
    slab(b, rounded(stock, segs=2), 0.046, m['wood'], bevel=0.01, bsegs=2, wfun=wf)
    slab(b, rounded([(-0.318, 0.142), (-0.344, 0.142), (-0.344, -0.036), (-0.318, -0.03)], r=0.008, segs=2),
         0.05, m['body'], bevel=0.006, bsegs=1)
    for s in (1, -1):
        plate(b, rounded([(-0.29, 0.128), (-0.305, 0.128), (-0.305, -0.018), (-0.29, -0.01)], r=0.003, segs=1),
              s * 0.023, s, m['rar'], h=0.002)
    obj = b.to_object('W_Pump')
    finish(obj, ao_dist=0.07)
    add_empty(obj, 'W_Pump_Muzzle', V(0.69, zb))
    add_empty(obj, 'W_Pump_Hand', V(0.35, zt - 0.02))
    return obj


# ---------------------------------------------------------------------------- tactical shotgun

def w_tactical(m):
    b = C.MeshBuilder()
    zb = 0.12
    pistol_grip(b, m['body'], top=0.056, bottom=-0.074, rake=0.03, depth=0.046, w=0.036, cap_mat=m['rar'])
    trigger_group(b, m, f0=0.024, f1=0.088, ztop=0.048, zbot=0.014)
    # boxy receiver (chamfered)
    slab(b, [(-0.12, 0.068), (-0.12, 0.15), (-0.1, 0.17), (0.25, 0.17), (0.265, 0.155), (0.265, 0.062),
             (0.25, 0.05), (0.2, 0.05), (0.19, 0.03), (0.09, 0.03), (0.084, 0.048), (-0.04, 0.048)],
         0.066, m['body'], bevel=0.008, bsegs=1)
    for s in (1, -1):
        plate(b, [(-0.1, 0.1), (0.24, 0.1), (0.24, 0.145), (-0.08, 0.145), (-0.1, 0.13)], s * 0.033, s, m['rar'],
              h=0.003, chamfer=0.0015)
        plate(b, [(-0.08, 0.108), (0.2, 0.108), (0.2, 0.116), (-0.08, 0.116)], s * 0.036, s, m['body'], h=0.0012)
    # shroud / handguard
    slab(b, [(0.26, 0.07), (0.26, 0.168), (0.47, 0.168), (0.49, 0.15), (0.49, 0.085), (0.47, 0.066),
             (0.3, 0.066)], 0.06, m['body'], bevel=0.007, bsegs=1)
    for s in (1, -1):
        for i in range(3):
            f = 0.29 + i * 0.062
            plate(b, [(f, 0.1), (f + 0.045, 0.1), (f + 0.045, 0.14), (f, 0.14)], s * 0.03, s, m['rar'], h=0.003,
                  chamfer=0.0015)
            plate(b, [(f + 0.009, 0.112), (f + 0.036, 0.112), (f + 0.036, 0.128), (f + 0.009, 0.128)], s * 0.033, s,
                  m['body'], h=0.0012, chamfer=0.0008)
    # barrel + brake
    cy(b, 0.018, 0.48, 0.53, zb, segs=12, mat=m['metal'])
    slab(b, [(-0.024, zb - 0.021), (0.024, zb - 0.021), (0.029, zb - 0.015), (0.029, zb + 0.017),
             (0.024, zb + 0.023), (-0.024, zb + 0.023), (-0.029, zb + 0.017), (-0.029, zb - 0.015)], 0.062,
         m['metal'], bevel=0.004, c=0.556, axis='y')
    for i in range(3):
        f = 0.534 + i * 0.017
        for s in (1, -1):
            plate(b, [(f, zb - 0.01), (f + 0.01, zb - 0.01), (f + 0.01, zb + 0.013), (f, zb + 0.013)], s * 0.029,
                  s, m['body'], h=0.001, chamfer=0.0008)
    plate(b, [(-0.012, zb - 0.01), (0.012, zb - 0.01), (0.012, zb + 0.012), (-0.012, zb + 0.012)], 0.587, 1,
          m['body'], h=0.001, axis='y')
    # top: carry rail + ghost-ring sights
    rail(b, m, -0.07, 0.44, 0.17, w=0.028)
    slab(b, rounded([(-0.092, 0.17), (-0.05, 0.17), (-0.056, 0.206, 0.006), (-0.086, 0.206, 0.006)], segs=1),
         0.036, m['body'], bevel=0.004)
    revolve(b, ring_prof(0.007, 0.013, -0.076, -0.066), 'y', (0, 0, 0.202), segs=10, mat=m['metal'],
            closed_prof=True)
    slab(b, rounded([(0.41, 0.184), (0.446, 0.184), (0.44, 0.212, 0.006), (0.418, 0.212, 0.006)], segs=1), 0.028,
         m['body'], bevel=0.004)
    bx(b, 0.426, 0.432, 0.207, 0.22, 0.004, mat=m['rar'])
    # drum magazine (axis X)
    df, dz = 0.148, -0.066
    bx(b, 0.108, 0.19, -0.01, 0.036, 0.042, mat=m['body'], bevel=0.005)
    revolve(b, [(0.0, -0.035), (0.05, -0.035), (0.062, -0.033), (0.07, -0.025), (0.072, -0.012),
                (0.072, 0.012), (0.07, 0.025), (0.062, 0.033), (0.05, 0.035), (0.0, 0.035)], 'x',
            (0, -df, dz), segs=18, mat=m['metal'])
    for s in (1, -1):
        revolve(b, ring_prof(0.03, 0.048, s * 0.033, s * 0.04), 'x', (0, -df, dz), segs=18, mat=m['rar'],
                closed_prof=True)
        revolve(b, [(0.0, s * 0.036), (0.016, s * 0.036), (0.016, s * 0.043), (0.0, s * 0.043)], 'x',
                (0, -df, dz), segs=10, mat=m['body'])
    bx(b, df - 0.004, df + 0.004, dz - 0.012, dz + 0.012, 0.094, mat=m['body'], bevel=0.002)
    # stock
    slab(b, [(-0.11, 0.165), (-0.27, 0.165), (-0.29, 0.15), (-0.29, -0.03), (-0.275, -0.045), (-0.24, -0.045),
             (-0.225, -0.02), (-0.18, 0.05), (-0.13, 0.07), (-0.11, 0.07)], 0.052, m['body'], bevel=0.008)
    for s in (1, -1):
        plate(b, [(-0.14, 0.14), (-0.265, 0.14), (-0.265, 0.12), (-0.155, 0.12)], s * 0.026, s, m['rar'], h=0.003,
              chamfer=0.0015)
    slab(b, rounded([(-0.286, 0.162), (-0.308, 0.162), (-0.308, -0.042), (-0.286, -0.042)], r=0.006, segs=1),
         0.056, m['rar'], bevel=0.005)
    obj = b.to_object('W_Tactical')
    finish(obj, ao_dist=0.07)
    add_empty(obj, 'W_Tactical_Muzzle', V(0.588, zb))
    add_empty(obj, 'W_Tactical_Hand', V(0.38, 0.062))
    return obj


# ---------------------------------------------------------------------------- sniper

def scope(b, m, f0, f1, z, r=0.021, rb=0.036, re=0.03):
    prof = [(0.0, f0 + 0.004), (re - 0.005, f0), (re, f0 + 0.006), (re, f0 + 0.045), (r, f0 + 0.075),
            (r, f1 - 0.1), (rb, f1 - 0.055), (rb, f1 - 0.005), (rb - 0.005, f1), (0.0, f1)]
    mats = [m['body']] * (len(prof) - 1)
    mats[2] = m['rar']
    mats[6] = m['rar']
    revolve(b, prof, 'y', (0, 0, z), segs=14, mats=mats)
    cy(b, rb - 0.007, f1 - 0.004, f1 + 0.0015, z, segs=14, mat=m['glass'])
    cy(b, re - 0.008, f0 - 0.0015, f0 + 0.003, z, segs=14, mat=m['glass'])
    mid = f0 + (f1 - f0) * 0.45
    b.cylinder(0.014, 0.024, loc=V(mid, z + r + 0.009), segs=10, mat=m['metal'])
    b.cylinder(0.012, 0.022, loc=V(mid, z, r + 0.008), rot=(0, PI / 2, 0), segs=10, mat=m['metal'])
    bx(b, mid - 0.022, mid + 0.022, z - 0.015, z + 0.017, 0.036, mat=m['body'], bevel=0.006)


def w_sniper(m):
    b = C.MeshBuilder()
    zb = 0.12
    pistol_grip(b, m['body'], top=0.056, bottom=-0.074, rake=0.018, depth=0.046, w=0.036, cap_mat=m['body'])
    trigger_group(b, m, f0=0.026, f1=0.09, ztop=0.05, zbot=0.014)
    # chassis bed
    slab(b, rounded([(-0.09, 0.122), (0.3, 0.122), (0.3, 0.066, 0.01), (0.19, 0.05), (0.07, 0.05, 0.005),
                     (-0.03, 0.05), (-0.09, 0.064, 0.01)], segs=1), 0.054, m['body'], bevel=0.006, bsegs=1)
    # receiver cylinder + bolt
    revolve(b, [(0.0, -0.11), (0.018, -0.11), (0.023, -0.1), (0.023, 0.2), (0.019, 0.21), (0.0, 0.21)], 'y',
            (0, 0, zb + 0.006), segs=12, mat=m['metal'])
    revolve(b, [(0.0, -0.145), (0.013, -0.145), (0.018, -0.134), (0.018, -0.108), (0.0, -0.108)], 'y',
            (0, 0, zb + 0.006), segs=10, mat=m['body'])
    sweep(b, bez([V(-0.06, zb + 0.01, -0.02), V(-0.06, zb + 0.006, -0.052), V(-0.068, zb - 0.02, -0.06)], 3),
          0.0055, segs=8, mat=m['metal'])
    b.sphere(0.013, loc=V(-0.068, zb - 0.027, -0.062), segs=10, rings=6, mat=m['rar'])
    plate(b, rounded([(0.02, zb), (0.1, zb), (0.1, zb + 0.016), (0.02, zb + 0.016)], r=0.003, segs=1), -0.022, -1,
          m['body'], h=0.002)
    # rail + scope mounts + scope
    bx(b, -0.07, 0.22, zb + 0.024, zb + 0.034, 0.024, mat=m['metal'], bevel=0.002)
    zs = 0.222
    for f in (0.0, 0.16):
        bx(b, f - 0.015, f + 0.015, zb + 0.032, zs - 0.014, 0.024, mat=m['metal'], bevel=0.003)
        revolve(b, ring_prof(0.0205, 0.027, f - 0.012, f + 0.012, 0.002), 'y', (0, 0, zs), segs=14,
                mat=m['metal'], closed_prof=True)
    scope(b, m, -0.08, 0.285, zs)
    # forend
    slab(b, rounded([(0.28, 0.132), (0.6, 0.132), (0.615, 0.12, 0.006), (0.615, 0.078, 0.008),
                     (0.6, 0.064, 0.006), (0.28, 0.064)], segs=1), 0.054, m['body'], bevel=0.007, bsegs=1)
    for s in (1, -1):
        plate(b, rounded([(0.31, 0.088), (0.59, 0.088), (0.59, 0.108), (0.31, 0.108)], r=0.007, segs=1), s * 0.027,
              s, m['rar'], h=0.003)
        for i in range(3):
            f = 0.33 + i * 0.05
            plate(b, rounded([(f, 0.114), (f + 0.034, 0.114), (f + 0.034, 0.124), (f, 0.124)], r=0.004, segs=1),
                  s * 0.027, s, m['metal'], h=0.0015)
    # barrel + brake
    revolve(b, [(0.0, 0.2), (0.017, 0.2), (0.0145, 0.4), (0.0125, 0.83), (0.0, 0.83)], 'y', (0, 0, zb), segs=10,
            mat=m['metal'])
    slab(b, rounded([(-0.018, zb - 0.016), (0.018, zb - 0.016), (0.018, zb + 0.016), (-0.018, zb + 0.016)],
                    r=0.006, segs=1), 0.068, m['metal'], bevel=0.003, c=0.852, axis='y')
    for i in range(3):
        f = 0.826 + i * 0.019
        for s in (1, -1):
            plate(b, [(f, zb - 0.009), (f + 0.011, zb - 0.009), (f + 0.011, zb + 0.009), (f, zb + 0.009)],
                  s * 0.018, s, m['body'], h=0.001, chamfer=0.0008)
    plate(b, [(-0.009, zb - 0.009), (0.009, zb - 0.009), (0.009, zb + 0.009), (-0.009, zb + 0.009)], 0.886, 1,
          m['body'], h=0.001, axis='y')
    # folded bipod
    bx(b, 0.565, 0.605, 0.046, 0.068, 0.038, mat=m['metal'], bevel=0.004)
    for s in (1, -1):
        sweep(b, [V(0.585, 0.054, s * 0.012), V(0.7, 0.064, s * 0.017), V(0.79, 0.07, s * 0.017)], 0.0065, segs=8,
              mat=m['metal'])
        sweep(b, [V(0.62, 0.058, s * 0.014), V(0.74, 0.067, s * 0.017)], 0.0085, segs=8, mat=m['body'])
        b.sphere(0.011, loc=V(0.795, 0.07, s * 0.017), scale=(1, 1.3, 0.8), segs=8, rings=6, mat=m['body'])
    # box magazine
    slab(b, rounded([(0.085, 0.056), (0.155, 0.056), (0.155, -0.02), (0.085, -0.02)], r=0.004, segs=1), 0.038,
         m['metal'], bevel=0.003)
    slab(b, rounded([(0.08, -0.016), (0.162, -0.016), (0.162, -0.032), (0.08, -0.032)], r=0.005, segs=1), 0.044,
         m['body'], bevel=0.003)
    # stock + cheek riser + butt pad
    stock = [(-0.085, 0.126), (-0.2, 0.114), (-0.368, 0.12, 0.012), (-0.378, 0.1), (-0.382, -0.03, 0.01),
             (-0.36, -0.05, 0.012), (-0.26, -0.046, 0.012), (-0.24, -0.02, 0.012), (-0.2, 0.045, 0.03),
             (-0.12, 0.06, 0.02), (-0.085, 0.065)]
    slab(b, rounded(stock, segs=2), 0.05, m['body'], bevel=0.007, bsegs=1)
    slab(b, rounded([(-0.15, 0.112), (-0.35, 0.118), (-0.35, 0.156, 0.014), (-0.17, 0.152, 0.014)], segs=2),
         0.038, m['rar'], bevel=0.006, bsegs=1)
    for f in (-0.2, -0.3):
        b.cylinder(0.0045, 0.042, loc=V(f, 0.11), rot=(0, PI / 2, 0), segs=6, mat=m['metal'])
    slab(b, rounded([(-0.376, 0.122), (-0.4, 0.122), (-0.4, -0.05), (-0.376, -0.054)], r=0.006, segs=1),
         0.054, m['metal'], bevel=0.005)
    obj = b.to_object('W_Sniper')
    finish(obj, ao_dist=0.07)
    add_empty(obj, 'W_Sniper_Muzzle', V(0.887, zb))
    add_empty(obj, 'W_Sniper_Hand', V(0.44, 0.062))
    return obj


# ---------------------------------------------------------------------------- rocket launcher

def rocket_warhead(b, m, f_base, r=0.056, zc=0.0, x=0.0, segs=16):
    """Bulbous warhead (nose towards -Y) whose base is at f_base; 0.2 m long + fuse tip."""
    k = [(0.55, 0.0), (0.9, 0.02), (1.0, 0.05), (1.0, 0.085), (0.94, 0.115), (0.8, 0.145), (0.58, 0.17),
         (0.34, 0.186), (0.18, 0.193)]
    prof = [(0.0, f_base - 0.001)] + [(r * a, f_base + t) for a, t in k] + [(0.0, f_base + 0.195)]
    revolve(b, prof, 'y', (x, 0, zc), segs=segs, mat=m['tip'])
    revolve(b, ring_prof(0.0, r * 1.02, f_base + 0.06, f_base + 0.072), 'y', (x, 0, zc), segs=segs,
            mat=m['body'])
    revolve(b, [(0.0, f_base + 0.185), (0.011, f_base + 0.185), (0.011, f_base + 0.205), (0.008, f_base + 0.212),
                (0.0, f_base + 0.213)], 'y', (x, 0, zc), segs=8, mat=m['metal'])


def w_rocket(m):
    b = C.MeshBuilder()
    zt = 0.17
    R = 0.075
    pistol_grip(b, m['body'], top=0.06, bottom=-0.072, rake=0.03, depth=0.046, w=0.036, cap_mat=m['rar'])
    trigger_group(b, m, f0=0.024, f1=0.09, ztop=0.056, zbot=0.018)
    # trigger housing under the tube
    slab(b, rounded([(-0.08, zt - 0.05), (0.14, zt - 0.05), (0.14, 0.076, 0.012), (0.1, 0.054, 0.01),
                     (-0.04, 0.054, 0.01), (-0.08, 0.074, 0.012)], segs=2), 0.056, m['body'], bevel=0.007,
         bsegs=1)
    # launch tube with flared, hollow ends
    f0, f1 = -0.55, 0.75
    prof = [(R - 0.012, f0 + 0.1), (R - 0.012, f0), (R + 0.018, f0), (R + 0.02, f0 + 0.014),
            (R + 0.008, f0 + 0.065), (R, f0 + 0.085),
            (R, -0.42), (R + 0.004, -0.415), (R + 0.004, -0.35), (R, -0.345),
            (R, 0.52), (R + 0.004, 0.525), (R + 0.004, 0.6), (R, 0.605),
            (R, f1 - 0.05), (R + 0.013, f1 - 0.045), (R + 0.013, f1), (R - 0.008, f1), (R - 0.008, f1 - 0.1)]
    mats = []
    for i in range(len(prof) - 1):
        t = (prof[i][1] + prof[i + 1][1]) / 2
        if i < 5:
            mats.append(m['metal'])
        elif -0.42 <= t <= -0.345 or 0.52 <= t <= 0.605:
            mats.append(m['rar'])
        elif t > f1 - 0.05:
            mats.append(m['metal'])
        else:
            mats.append(m['body'])
    revolve(b, prof, 'y', (0, 0, zt), segs=16, mats=mats, cap0=True, cap1=True)
    rocket_warhead(b, m, f1 - 0.075, r=0.058, zc=zt, segs=16)
    # padded shoulder section
    pad = [(R - 0.004, -0.3), (R + 0.006, -0.3), (R + 0.013, -0.292), (R + 0.013, -0.216), (R + 0.008, -0.21),
           (R + 0.008, -0.19), (R + 0.013, -0.184), (R + 0.013, -0.108), (R + 0.006, -0.1), (R - 0.004, -0.1)]
    revolve(b, pad, 'y', (0, 0, zt), segs=16, mat=m['body'], closed_prof=True)
    # front grip
    slab(b, rounded([(0.28, 0.105), (0.338, 0.105), (0.332, -0.01, 0.012), (0.324, -0.03, 0.01),
                     (0.29, -0.03, 0.01), (0.284, 0.0, 0.012)], segs=2), 0.036, m['body'], bevel=0.006, bsegs=1)
    bx(b, 0.268, 0.348, 0.09, 0.11, 0.052, mat=m['metal'], bevel=0.004)
    for i in range(3):
        z = 0.07 - i * 0.03
        bx(b, 0.283, 0.336, z - 0.004, z + 0.004, 0.038, mat=m['rar'], bevel=0.0012)
    # flip-up sight: hinge block, tilted frame with a glowing post
    fs = 0.2
    bx(b, fs - 0.032, fs + 0.032, zt + R - 0.01, zt + R + 0.012, 0.034, mat=m['metal'], bevel=0.004)
    b.cylinder(0.008, 0.04, loc=V(fs + 0.016, zt + R + 0.016), rot=(0, PI / 2, 0), segs=8, mat=m['metal'])
    tilt = Matrix.Translation(V(fs + 0.016, zt + R + 0.016)) @ Matrix.Rotation(-0.15, 4, 'X')
    fr = rounded([(-0.029, 0.004), (0.029, 0.004), (0.029, 0.074), (-0.029, 0.074)], r=0.008, segs=1)
    sweep(b, [tilt @ Vector((u, 0, v)) for (u, v) in fr], closed=True, up=(0, 1, 0), mat=m['metal'],
          shape=[(-0.0045, -0.0035), (0.0045, -0.0035), (0.0045, 0.0035), (-0.0045, 0.0035)])
    b.box((0.004, 0.004, 0.034), loc=tilt @ Vector((0, 0, 0.022)), rot=(-0.15, 0, 0), mat=m['metal'])
    b.sphere(0.0055, loc=tilt @ Vector((0, 0, 0.042)), segs=8, rings=6, mat=m['glass'])
    # rear peep
    bx(b, -0.21, -0.17, zt + R - 0.01, zt + R + 0.01, 0.028, mat=m['metal'], bevel=0.003)
    bx(b, -0.194, -0.186, zt + R + 0.008, zt + R + 0.016, 0.006, mat=m['metal'])
    revolve(b, ring_prof(0.006, 0.014, -0.194, -0.186), 'y', (0, 0, zt + R + 0.028), segs=10, mat=m['metal'],
            closed_prof=True)
    # side sight box (left)
    slab(b, rounded([(-0.05, zt - 0.022), (0.12, zt - 0.022), (0.12, zt + 0.032), (-0.05, zt + 0.032)], r=0.012,
                    segs=2), 0.032, m['body'], bevel=0.006, c=R + 0.01)
    plate(b, rounded([(-0.03, zt - 0.008), (0.1, zt - 0.008), (0.1, zt + 0.018), (-0.03, zt + 0.018)], r=0.006,
                     segs=1), R + 0.026, 1, m['rar'], h=0.003)
    cy(b, 0.011, 0.118, 0.126, zt + 0.005, x=R + 0.01, segs=10, mat=m['glass'])
    obj = b.to_object('W_Rocket')
    finish(obj, ao_dist=0.1)
    add_empty(obj, 'W_Rocket_Muzzle', V(f1, zt))
    add_empty(obj, 'W_Rocket_Hand', V(0.31, 0.035))
    return obj


# ---------------------------------------------------------------------------- pickaxe

def w_pickaxe(m):
    b = C.MeshBuilder()
    zh = 0.56  # head centre
    # chunky wooden handle (lathe along Z) with a steel pommel and a dark grip wrap
    revolve(b, [(0.0, -0.19), (0.023, -0.19), (0.0215, -0.1), (0.0205, 0.2), (0.0225, 0.42), (0.026, zh - 0.06),
                (0.0, zh - 0.06)], 'z', (0, 0, 0), segs=10, mat=m['wood'])
    revolve(b, [(0.0, -0.236), (0.02, -0.236), (0.029, -0.228), (0.031, -0.21), (0.028, -0.192), (0.023, -0.182),
                (0.0, -0.182)], 'z', (0, 0, 0), segs=10, mat=m['metal'])
    wrap = [(0.0, -0.186)]
    z = -0.186
    for i in range(6):
        wrap += [(0.0245, z), (0.0265, z + 0.006), (0.0265, z + 0.026), (0.0245, z + 0.032)]
        z += 0.034
    wrap += [(0.0, z)]
    revolve(b, wrap, 'z', (0, 0, 0), segs=10, mat=m['body'], rot0=0.3)
    # rarity cloth binding below the head
    revolve(b, [(0.0, zh - 0.14), (0.025, zh - 0.14), (0.031, zh - 0.134), (0.031, zh - 0.108), (0.027, zh - 0.102),
                (0.031, zh - 0.096), (0.031, zh - 0.07), (0.025, zh - 0.064), (0.0, zh - 0.064)],
            'z', (0, 0, 0), segs=10, mat=m['rar'], rot0=0.3)
    # head core: chunky rounded block
    slab(b, rounded([(-0.076, zh - 0.066), (0.08, zh - 0.066), (0.088, zh + 0.066), (-0.08, zh + 0.066)],
                    r=0.028, segs=2), 0.09, m['metal'], bevel=0.015, bsegs=2)
    # rarity band around the core + studs
    slab(b, rounded([(-0.03, zh - 0.073), (0.03, zh - 0.073), (0.03, zh + 0.073), (-0.03, zh + 0.073)],
                    r=0.014, segs=2), 0.101, m['rar'], bevel=0.008, bsegs=1)
    for s in (1, -1):
        for dz in (0.034, -0.034):
            b.cylinder(0.009, 0.008, loc=(s * 0.048, -0.056, zh + dz), rot=(0, PI / 2, 0), segs=8, mat=m['body'])
            b.cylinder(0.009, 0.008, loc=(s * 0.047, 0.058, zh + dz), rot=(0, PI / 2, 0), segs=8, mat=m['body'])
    # curved pick beak towards -Y: rounded diamond section tapering to a blunt point
    path = bez([V(0.06, zh + 0.012), V(0.17, zh + 0.024), V(0.25, zh - 0.004), V(0.3, zh - 0.07)], 6)
    shape = rounded([(0.0, 1.0), (-0.8, 0.3), (-0.8, -0.3), (0.0, -1.0), (0.8, -0.3), (0.8, 0.3)], r=0.25, segs=1)
    n = len(path)
    scales = []
    for i in range(n):
        t = i / (n - 1)
        s = (1.0 - t) ** 0.6
        scales.append((0.038 * (0.3 + 0.7 * s), 0.052 * (0.22 + 0.78 * s)) if i < n - 1 else (0.0, 0.0))
    sweep(b, path, shape=shape, scales=scales, up=(1, 0, 0), mat=m['metal'], cap0=True)
    # hammer poll towards +Y (octagonal) with a rarity rim
    revolve(b, [(0.0, -0.07), (0.04, -0.07), (0.042, -0.11), (0.047, -0.14), (0.042, -0.152), (0.0, -0.152)], 'y',
            (0, 0, zh), segs=8, mat=m['metal'], rot0=PI / 8)
    revolve(b, ring_prof(0.0, 0.05, -0.118, -0.13, 0.002), 'y', (0, 0, zh), segs=8, mat=m['rar'], rot0=PI / 8)
    # bolt cap on top of the head
    revolve(b, [(0.0, zh + 0.064), (0.024, zh + 0.064), (0.022, zh + 0.078), (0.013, zh + 0.086), (0.0, zh + 0.088)],
            'z', (0, 0.0, 0), segs=8, mat=m['metal'], rot0=PI / 8)
    obj = b.to_object('W_Pickaxe')
    finish(obj, ao_dist=0.06)
    add_empty(obj, 'W_Pickaxe_Muzzle', path[-1])
    add_empty(obj, 'W_Pickaxe_Hand', (0, 0, -0.13))
    return obj


# ---------------------------------------------------------------------------- projectile + grenade

def projectile_rocket(m):
    b = C.MeshBuilder()
    rocket_warhead(b, m, 0.085, r=0.056, zc=0.0, segs=16)
    revolve(b, [(0.0, 0.088), (0.03, 0.088), (0.03, -0.2), (0.034, -0.208), (0.034, -0.27), (0.03, -0.285),
                (0.022, -0.285), (0.022, -0.27), (0.0, -0.27)], 'y', (0, 0, 0), segs=12,
            mats=[m['body'], m['body'], m['metal'], m['metal'], m['metal'], m['metal'], m['metal'], m['metal']])
    revolve(b, ring_prof(0.0, 0.0325, -0.0, -0.035), 'y', (0, 0, 0), segs=12, mat=m['rar'])
    for k in range(4):
        rot = Matrix.Rotation(PI / 4 + k * PI / 2, 4, 'Y')
        slab(b, [(-0.13, 0.026), (-0.25, 0.026), (-0.272, 0.078), (-0.235, 0.078)], 0.006, m['tip'], bevel=0.002,
             xform=rot)
    obj = b.to_object('Projectile_Rocket')
    center_origin(obj)
    finish(obj, ao_dist=0.06)
    return obj


def grenade(m):
    b = C.MeshBuilder()
    body = [(0.0, -0.046), (0.017, -0.046), (0.027, -0.041), (0.033, -0.031), (0.035, -0.016), (0.035, 0.016),
            (0.032, 0.029), (0.025, 0.038), (0.015, 0.042), (0.0, 0.042)]
    revolve(b, body, 'z', (0, 0, 0), segs=14, mat=m['body'])
    revolve(b, ring_prof(0.0, 0.0375, -0.009, 0.009, 0.003), 'z', (0, 0, 0), segs=14, mat=m['rar'])
    for zz in (-0.028, 0.026):
        revolve(b, ring_prof(0.0, 0.0335 if zz < 0 else 0.0315, zz - 0.003, zz + 0.003, 0.0), 'z', (0, 0, 0),
                segs=14, mat=m['metal'])
    # fuze
    revolve(b, [(0.0, 0.038), (0.014, 0.038), (0.014, 0.056), (0.012, 0.06), (0.0, 0.06)], 'z', (0, 0, 0),
            segs=10, mat=m['metal'])
    # spoon lever down the +Y side
    path = [Vector((0, 0.004, 0.058)), Vector((0, 0.024, 0.054)), Vector((0, 0.038, 0.034)),
            Vector((0, 0.042, 0.005)), Vector((0, 0.04, -0.02))]
    sweep(b, bez_poly(path, 2), shape=rounded([(-0.009, -0.0022), (0.009, -0.0022), (0.009, 0.0022),
                                               (-0.009, 0.0022)], r=0.0015, segs=1), up=(1, 0, 0), mat=m['metal'])
    # pull ring + pin
    b.torus(0.012, 0.0025, loc=(0.02, -0.004, 0.05), rot=(0, PI / 2, 0), mat=m['rar'], segs=12, ring_segs=6)
    b.cylinder(0.0022, 0.02, loc=(0.009, -0.004, 0.05), rot=(0, PI / 2, 0), segs=6, mat=m['metal'])
    obj = b.to_object('Grenade')
    center_origin(obj)
    finish(obj, ao_dist=0.03)
    return obj


def build_weapons(preview_dir=None):
    C.reset()
    C.clear_material_cache()
    m = weapon_mats()
    objs = [w_pistol(m), w_smg(m), w_ar(m), w_pump(m), w_tactical(m), w_sniper(m), w_rocket(m), w_pickaxe(m),
            projectile_rocket(m), grenade(m)]
    for o in objs:
        print('%-18s %5d tris' % (o.name, tri_count(o)))
    if preview_dir:
        preview_weapons(objs, preview_dir)
    C.export_glb('weapons.glb', objs, colors=True)
    return objs


def preview_weapons(objs, d):
    os.makedirs(d, exist_ok=True)
    O = {o.name: o for o in objs}

    def put(name, sx, sy):  # screen position for a camera on -X looking +X (screen right = -Y)
        return O[name], (0, -sx, sy, 0)

    rows = [put('W_Rocket', -0.1, 1.55), put('W_Sniper', -0.15, 1.2), put('W_Pump', -0.15, 0.88),
            put('W_AR', -0.15, 0.56), put('W_Tactical', -0.15, 0.2), put('W_SMG', -0.35, -0.2),
            put('W_Pistol', 0.25, -0.2), put('W_Pickaxe', -0.95, 0.35), put('Projectile_Rocket', -0.1, -0.45),
            put('Grenade', 0.45, -0.45)]
    s = _layout(dict(rows))
    render(os.path.join(d, 'weapons_side.png'), (-6, 0.1, 0.62), (0, 0.1, 0.62), size=(1000, 1000), ortho=2.6,
           samples=20, sun_rot=(0.5, 0.0, -2.0))
    _restore(s)
    # 3/4 views from the right-front, long guns then small ones
    for fname, names in (('weapons_long.png', ['W_Rocket', 'W_Sniper', 'W_Pump', 'W_AR', 'W_Tactical']),
                         ('weapons_small.png', ['W_SMG', 'W_Pistol', 'W_Pickaxe', 'Projectile_Rocket', 'Grenade'])):
        place = {}
        if fname == 'weapons_long.png':
            for i, n in enumerate(names):
                place[O[n]] = (0, 0, -i * 0.36, 0)
            cen = Vector((0, -0.2, -0.72))
            ortho = 1.9
        else:
            spots = {'W_SMG': (0, 0.12, 0.25), 'W_Pistol': (0, -0.3, 0.3), 'W_Pickaxe': (0, 0.55, -0.1),
                     'Projectile_Rocket': (0, 0.12, -0.1), 'Grenade': (0, -0.32, -0.05)}
            for n in names:
                x, y, z = spots[n]
                place[O[n]] = (x, y, z, 0)
            cen = Vector((0, 0.1, 0.12))
            ortho = 1.25
        s = _layout(place)
        hidden = [o for o in objs if o not in place]
        for o in hidden:
            o.hide_render = True
        dirv = Vector((-1.0, -0.62, 0.42)).normalized()
        render(os.path.join(d, fname), tuple(cen + dirv * 6), tuple(cen), size=(1000, 900), ortho=ortho,
               samples=20, sun_rot=(0.55, 0.0, -2.3))
        for o in hidden:
            o.hide_render = False
        _restore(s)


# ============================================================================ items

def items_mats():
    return dict(
        wood=C.material('ChestWood', '#9c6434', rough=0.7),
        gold=C.material('ChestGold', '#e8b53e', rough=0.3, metal=1.0),
        glow=C.material('ChestGlow', '#ffd978', rough=0.3, emit='#ffc244', emit_strength=5.0),
        green=C.material('AmmoGreen', '#5d6b3b', rough=0.55, metal=0.2),
        metal=C.material('GunMetal', '#70757d', rough=0.35, metal=1.0),
        blue=C.material('CrateBlue', '#2f80dc', rough=0.45),
        white=C.material('CrateWhite', '#eef2f5', rough=0.5),
        balloon=C.material('Balloon', '#f4f6f8', rough=0.55),
        bstripe=C.material('BalloonStripe', '#2f80dc', rough=0.55),
        rope=C.material('Rope', '#d9c9a0', rough=0.9),
        cloth=C.material('Cloth', '#f1ebdd', rough=0.9),
        medw=C.material('MedWhite', '#f2f4f3', rough=0.4),
        teal=C.material('MedTeal', '#17b3a0', rough=0.45),
        glass=C.material('Glass', '#d6ecff', rough=0.05, alpha=0.35),
        liquid=C.material('ShieldLiquid', '#43c6ff', rough=0.2, emit='#2aa6ff', emit_strength=3.0),
        cork=C.material('Cork', '#a97b4d', rough=0.85),
        light=C.material('AmmoLight', '#d9d2b0', rough=0.45, metal=0.3),
        medium=C.material('AmmoMedium', '#6c8f4e', rough=0.5),
        heavy=C.material('AmmoHeavy', '#3c5a78', rough=0.45, metal=0.3),
        shells=C.material('AmmoShells', '#c0392b', rough=0.5),
        tip=C.material('RocketTip', '#e04a2a', rough=0.45),
        brass=C.material('Brass', '#c9a24a', rough=0.3, metal=1.0),
        mwood=C.material('MatWood', '#b47a44', rough=0.75),
        mstone=C.material('MatStone', '#9ea3a8', rough=0.85),
        mmetal=C.material('MatMetal', '#aab5c0', rough=0.35, metal=0.9),
    )


def P3(x, y, z):
    return Vector((x, y, z))


def arch(a, b, z0, n, t0=0.0, t1=PI):
    """Points on a half ellipse over the Y axis (side profile (f, z) with f = -y)."""
    out = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        out.append((-a * math.cos(t), z0 + b * math.sin(t)))  # f = -y ; t=0 -> back (y=+a)
    return out


def arch_band(a, b, z0, th, n, t0=0.0, t1=PI):
    outer = arch(a, b, z0, n, t0, t1)
    inner = arch(a - th, b - th, z0, n, t0, t1)
    return outer + list(reversed(inner))


# ---------------------------------------------------------------------------- chest

def chest(m):
    D, HB = 0.55, 0.36  # depth, body height (lid tops out at ~0.6)
    b = C.MeshBuilder()
    # hollow body: core block (top hidden under a glowing loot layer) + rim walls
    bx(b, -0.24, 0.24, 0.03, 0.3, 0.83, mat=m['wood'])
    b.box((0.8, 0.46, 0.012), loc=(0, 0, 0.3), mat=m['glow'])
    for s in (1, -1):
        b.box((0.84, 0.04, 0.07), loc=(0, s * 0.225, 0.32), mat=m['wood'], bevel=0.006, bevel_segs=1)
        b.box((0.04, 0.46, 0.07), loc=(s * 0.4, 0, 0.32), mat=m['wood'], bevel=0.006, bevel_segs=1)
    # planks (front/back along X, ends along Y)
    for s in (1, -1):
        for i, zc in enumerate((0.09, 0.19, 0.29)):
            b.box((0.8, 0.034, 0.092), loc=(0, s * 0.255, zc), mat=m['wood'], bevel=0.01, bevel_segs=1)
            b.box((0.034, 0.47, 0.092), loc=(s * 0.432, 0, zc), mat=m['wood'], bevel=0.01, bevel_segs=1)
    # gold: base band, top rim, corner posts, straps
    b.box((0.93, 0.58, 0.05), loc=(0, 0, 0.025), mat=m['gold'], bevel=0.01)
    b.box((0.925, 0.575, 0.03), loc=(0, 0, HB - 0.015), mat=m['gold'], bevel=0.008, bevel_segs=1)
    for sx in (1, -1):
        for sy in (1, -1):
            b.box((0.075, 0.075, HB), loc=(sx * 0.43, sy * 0.255, HB / 2), mat=m['gold'], bevel=0.014, bevel_segs=2)
        for sy in (1, -1):
            b.box((0.06, 0.02, 0.28), loc=(sx * 0.24, sy * 0.277, 0.19), mat=m['gold'], bevel=0.006, bevel_segs=1)
            for zc in (0.08, 0.3):
                b.cylinder(0.009, 0.01, loc=(sx * 0.24, sy * 0.29, zc), rot=(PI / 2, 0, 0), segs=6, mat=m['gold'])
    # lock plate + glowing gem
    shield = rounded([(-0.085, 0.345), (0.085, 0.345), (0.085, 0.22, 0.02), (0.0, 0.155, 0.02), (-0.085, 0.22, 0.02)],
                     segs=2)
    slab(b, shield, 0.024, m['gold'], bevel=0.006, c=0.28, axis='y')
    revolve(b, [(0.0, 0.29), (0.036, 0.29), (0.043, 0.3), (0.036, 0.316), (0.0, 0.322)], 'y', (0, 0, 0.26), segs=6,
            mat=m['glow'], rot0=PI / 2)
    revolve(b, ring_prof(0.037, 0.049, 0.288, 0.3, 0.003), 'y', (0, 0, 0.26), segs=12, mat=m['gold'],
            closed_prof=True)
    body = b.to_object('Chest')
    finish(body, ao_dist=0.15, ground=0.0)

    # lid (separate): half-ellipse planks over a core, gold end caps and straps, hasp
    L = C.MeshBuilder()
    a, bb = 0.275, 0.24
    core = arch(a - 0.03, bb - 0.03, HB, 10)
    slab(L, core, 0.84, m['wood'], bevel=0.004, c=0.0)
    gap = 0.018
    for k in range(4):
        t0 = k * PI / 4 + (gap if k else 0.0)
        t1 = (k + 1) * PI / 4 - (gap if k < 3 else 0.0)
        slab(L, arch_band(a, bb, HB, 0.04, 3, t0, t1), 0.8, m['wood'], bevel=0.008)
    for s in (1, -1):
        slab(L, arch_band(a + 0.013, bb + 0.013, HB, 0.06, 10), 0.075, m['gold'], bevel=0.01, bsegs=1, c=s * 0.43)
        slab(L, arch_band(a + 0.01, bb + 0.01, HB, 0.03, 10), 0.06, m['gold'], bevel=0.006, c=s * 0.24)
        for t in (0.35, 1.57, 2.8):
            L.cylinder(0.009, 0.012, loc=(s * 0.24, a * 1.04 * math.cos(t) * 1.0, HB + (bb + 0.018) * math.sin(t)),
                       rot=(PI / 2 - t, 0, 0), segs=6, mat=m['gold'])
    hasp = rounded([(-0.055, HB + 0.004), (0.055, HB + 0.004), (0.055, HB + 0.1, 0.02), (-0.055, HB + 0.1, 0.02)],
                   segs=2)
    slab(L, hasp, 0.022, m['gold'], bevel=0.006, c=0.279, axis='y')
    L.box((0.93, 0.585, 0.02), loc=(0, 0, HB + 0.01), mat=m['gold'], bevel=0.006, bevel_segs=1)
    lid = L.to_object('Chest_Lid')
    C.set_origin(lid, (0, D / 2, HB))
    finish(lid, ao_dist=0.15)
    return [body, lid]


# ---------------------------------------------------------------------------- ammo box

def ammo_box(m):
    b = C.MeshBuilder()
    H = 0.275
    b.box((0.66, 0.36, H - 0.02), loc=(0, 0, 0.02 + (H - 0.02) / 2), mat=m['green'], bevel=0.02, bevel_segs=2)
    for zc in (0.075, 0.205):
        b.box((0.675, 0.375, 0.026), loc=(0, 0, zc), mat=m['green'], bevel=0.008)
    # skids
    for sy in (1, -1):
        b.box((0.62, 0.05, 0.03), loc=(0, sy * 0.12, 0.015), mat=m['metal'], bevel=0.006, bevel_segs=1)
    # stencil label plate (front) with two stripes
    plate(b, rounded([(-0.14, 0.11), (0.14, 0.11), (0.14, 0.17), (-0.14, 0.17)], r=0.008, segs=1), 0.18, 1,
          m['light'], h=0.003, axis='y')
    for x0 in (-0.1, 0.02):
        plate(b, [(x0, 0.128), (x0 + 0.08, 0.128), (x0 + 0.08, 0.152), (x0, 0.152)], 0.183, 1, m['green'],
              h=0.0015, axis='y', chamfer=0.001)
    # end handles
    for sx in (1, -1):
        x = sx * 0.33
        for sy in (1, -1):
            b.box((0.02, 0.04, 0.05), loc=(x + sx * 0.008, sy * 0.1, 0.19), mat=m['metal'], bevel=0.005, bevel_segs=1)
        path = [P3(x + sx * 0.01, -0.1, 0.19), P3(x + sx * 0.04, -0.1, 0.19), P3(x + sx * 0.05, -0.08, 0.19),
                P3(x + sx * 0.05, 0.08, 0.19), P3(x + sx * 0.04, 0.1, 0.19), P3(x + sx * 0.01, 0.1, 0.19)]
        sweep(b, bez_poly(path, 2), 0.009, segs=8, mat=m['metal'])
    # front latches (body part)
    for sx in (1, -1):
        b.box((0.06, 0.02, 0.07), loc=(sx * 0.2, -0.187, 0.23), mat=m['metal'], bevel=0.005, bevel_segs=1)
        b.cylinder(0.008, 0.066, loc=(sx * 0.2, -0.2, 0.2), rot=(0, PI / 2, 0), segs=8, mat=m['metal'])
    body = b.to_object('AmmoBox')
    finish(body, ao_dist=0.12, ground=0.0)

    L = C.MeshBuilder()
    L.box((0.68, 0.38, 0.06), loc=(0, 0, H + 0.03), mat=m['green'], bevel=0.018, bevel_segs=2)
    L.box((0.5, 0.24, 0.02), loc=(0, 0, H + 0.065), mat=m['green'], bevel=0.008)
    for sx in (1, -1):
        L.box((0.05, 0.022, 0.055), loc=(sx * 0.2, -0.196, H + 0.01), mat=m['metal'], bevel=0.005, bevel_segs=1)
    for x in (-0.22, 0.0, 0.22):
        L.cylinder(0.012, 0.12, loc=(x, 0.192, H + 0.004), rot=(0, PI / 2, 0), segs=8, mat=m['metal'])
    lid = L.to_object('AmmoBox_Lid')
    C.set_origin(lid, (0, 0.19, H))
    finish(lid, ao_dist=0.12)
    return [body, lid]


# ---------------------------------------------------------------------------- supply crate + balloon

def supply_crate(m):
    b = C.MeshBuilder()
    S = 1.4
    h = S / 2
    c = (0, 0, h)
    # blue core panels
    b.box((S - 0.1, S - 0.1, S - 0.1), loc=c, mat=m['blue'], bevel=0.02, bevel_segs=1)
    # white frame beams on all 12 edges
    t = 0.14
    for ax in range(3):
        for s1 in (1, -1):
            for s2 in (1, -1):
                size = [t, t, t]
                size[ax] = S - 0.02
                loc = [0.0, 0.0, 0.0]
                others = [i for i in range(3) if i != ax]
                loc[others[0]] = s1 * (h - t / 2)
                loc[others[1]] = s2 * (h - t / 2)
                loc[2] += h
                b.box(tuple(size), loc=tuple(loc), mat=m['white'], bevel=0.028, bevel_segs=1)
    # metal corner caps
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (0, 1):
                b.box((0.2, 0.2, 0.2), loc=(sx * (h - 0.09), sy * (h - 0.09), 0.1 + sz * (S - 0.2)),
                      mat=m['metal'], bevel=0.035, bevel_segs=2)
    # side emblems: white disc + blue down-arrow, on 4 faces
    arrow = [(-0.07, 0.12), (0.07, 0.12), (0.07, 0.0), (0.16, 0.0), (0.0, -0.17), (-0.16, 0.0), (-0.07, 0.0)]
    disc = [(0.33 * math.cos(2 * PI * i / 20), 0.33 * math.sin(2 * PI * i / 20)) for i in range(20)]
    for k in range(4):
        rz = Matrix.Rotation(k * PI / 2, 4, 'Z')
        # built facing -Y (axis 'y' profile (x, z)), then rotated around Z
        tmp = C.MeshBuilder()
        plate(tmp, [(u, v + h) for (u, v) in disc], h - 0.05, 1, m['white'], h=0.012, chamfer=0.006, axis='y')
        plate(tmp, rounded([(u, v + h + 0.02) for (u, v) in arrow], r=0.01, segs=1), h - 0.038, 1, m['blue'],
              h=0.008, chamfer=0.004, axis='y')
        tmp.bm.transform(rz)
        me = bpy.data.meshes.new('t')
        tmp.bm.to_mesh(me)
        before = set(b.bm.faces)
        b.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        remap = [b.mat_index(mm) for mm in tmp.mats]
        for f in b.bm.faces:
            if f not in before:
                f.material_index = remap[f.material_index]
        tmp.bm.free()
    # metal bands over the top and down two sides (parcel style), plus lifting eye
    for ax in (0, 1):
        for s in (1, -1):
            off = s * 0.42
            if ax == 0:
                b.box((0.1, S + 0.03, 0.03), loc=(off, 0, S + 0.005), mat=m['metal'], bevel=0.008, bevel_segs=1)
            else:
                b.box((S + 0.03, 0.1, 0.03), loc=(0, off, S + 0.005), mat=m['metal'], bevel=0.008, bevel_segs=1)
    b.box((0.36, 0.36, 0.05), loc=(0, 0, S + 0.02), mat=m['metal'], bevel=0.015, bevel_segs=1)
    b.torus(0.08, 0.022, loc=(0, 0, S + 0.1), rot=(PI / 2, 0, 0), mat=m['metal'], segs=14, ring_segs=6)
    obj = b.to_object('SupplyCrate')
    finish(obj, ao_dist=0.5, ground=0.0)
    return obj


def supply_balloon(m, top_z):
    b = C.MeshBuilder()
    zb = 1.55  # balloon bottom (above the attach point at the origin)
    prof = [(0.0, zb - 0.02), (0.32, zb), (0.62, zb + 0.08), (1.1, zb + 0.4), (1.52, zb + 0.95), (1.75, zb + 1.6),
            (1.78, zb + 2.1), (1.62, zb + 2.6), (1.28, zb + 3.0), (0.78, zb + 3.28), (0.28, zb + 3.4), (0.0, zb + 3.42)]
    segs = 24
    revolve(b, prof, 'z', (0, 0, 0), segs=segs, seg_mat=lambda k, i: m['bstripe'] if (i // 2) % 2 == 0 else m['balloon'])
    # top cap + bottom collar
    revolve(b, [(0.0, zb + 3.46), (0.34, zb + 3.43), (0.42, zb + 3.37), (0.3, zb + 3.36), (0.0, zb + 3.38)], 'z',
            (0, 0, 0), segs=segs, mat=m['bstripe'])
    b.torus(0.62, 0.05, loc=(0, 0, zb + 0.08), mat=m['metal'], segs=20, ring_segs=6)
    # strings from the collar to the harness ring at the origin
    n = 8
    for i in range(n):
        a = 2 * PI * i / n + PI / 8
        p0 = Vector((0.6 * math.cos(a), 0.6 * math.sin(a), zb + 0.06))
        p1 = Vector((0.07 * math.cos(a), 0.07 * math.sin(a), 0.1))
        sweep(b, [p0, (p0 + p1) / 2 + Vector((0, 0, -0.03)), p1], 0.014, segs=4, mat=m['rope'])
    b.torus(0.08, 0.02, loc=(0, 0, 0.1), mat=m['metal'], segs=12, ring_segs=6)
    b.cylinder(0.02, 0.1, loc=(0, 0, 0.05), segs=8, mat=m['metal'])
    obj = b.to_object('SupplyBalloon')
    finish(obj, ao_dist=0.6, samples=32)
    obj.location = (0, 0, top_z)
    return obj


# ---------------------------------------------------------------------------- healing

def plus_shape(s, t):
    """Plus sign outline: arm half-length s, half-thickness t."""
    return [(-t, s), (t, s), (t, t), (s, t), (s, -t), (t, -t), (t, -s), (-t, -s), (-t, -t), (-s, -t), (-s, t),
            (-t, t)]


def hull_path(centers, r, n=28):
    """Closed path hugging a set of circles (y, z) in the YZ plane (convex hull of discs)."""
    out = []
    for i in range(n):
        t = 2 * PI * i / n
        d = Vector((math.cos(t), math.sin(t)))
        c = max(centers, key=lambda q: Vector(q).dot(d))
        out.append(Vector(c) + d * r)
    return out


def bandage(m):
    b = C.MeshBuilder()
    r, L = 0.042, 0.13
    # three rolls in a pyramid, lying along X, with rolled-up rings on their ends
    prof = [(0.0, -L / 2), (r * 0.3, -L / 2 - 0.002), (r * 0.4, -L / 2), (r * 0.72, -L / 2 - 0.002),
            (r * 0.9, -L / 2), (r, -L / 2 + 0.008), (r, L / 2 - 0.008), (r * 0.9, L / 2), (r * 0.72, L / 2 - 0.002),
            (r * 0.4, L / 2), (r * 0.3, L / 2 - 0.002), (0.0, L / 2)]
    cz = math.sqrt((2 * r + 0.002) ** 2 - (r + 0.001) ** 2)
    centers = [(-r - 0.001, r), (r + 0.001, r), (0.0, r + cz)]
    for i, (y, z) in enumerate(centers):
        revolve(b, prof, 'x', (0.006 * (i - 1), y, z), segs=12, mat=m['cloth'], rot0=0.4 * i)
    # loose end peeling off the top roll and draping down the front
    top = Vector(centers[2])
    low = Vector(centers[0])
    pts = [top + Vector((math.cos(math.radians(a)), math.sin(math.radians(a)))) * (r + 0.004)
           for a in (60, 95, 130, 165)]
    pts += [low + Vector((math.cos(math.radians(a)), math.sin(math.radians(a)))) * (r + 0.004) for a in (150, 185)]
    pts += [Vector((low.x - r - 0.012, 0.004))]
    sweep(b, [P3(-0.03, q.x, q.y) for q in pts], up=(1, 0, 0), mat=m['cloth'],
          shape=[(-0.026, -0.0018), (0.026, -0.0018), (0.026, 0.0018), (-0.026, 0.0018)])
    # teal strap around the bundle, with a tag carrying a white plus on top
    hp = hull_path(centers, r + 0.0035, 28)
    sweep(b, [P3(0.0, q.x, q.y) for q in hp], closed=True, up=(1, 0, 0), mat=m['teal'],
          shape=[(-0.014, -0.0028), (0.014, -0.0028), (0.014, 0.0028), (-0.014, 0.0028)])
    zt = top.y + r + 0.006
    slab(b, rounded([(-0.03, -0.028), (0.03, -0.028), (0.03, 0.028), (-0.03, 0.028)], r=0.01, segs=2), 0.008,
         m['teal'], bevel=0.0025, c=zt, axis='z')
    plate(b, rounded(plus_shape(0.019, 0.007), r=0.002, segs=1), zt + 0.004, 1, m['cloth'], h=0.0025, axis='z')
    obj = b.to_object('Bandage')
    drop_to_ground(obj)
    finish(obj, ao_dist=0.05, ground=0.0)
    return obj


def medkit(m):
    b = C.MeshBuilder()
    Wx, Dy, Hz = 0.35, 0.12, 0.25
    zc = 0.012 + Hz / 2
    b.box((Wx, Dy, Hz), loc=(0, 0, zc), mat=m['medw'], bevel=0.03, bevel_segs=3)
    # teal seam band around the middle of the depth
    band = rounded([(-Wx / 2 - 0.004, zc - Hz / 2 - 0.004), (Wx / 2 + 0.004, zc - Hz / 2 - 0.004),
                    (Wx / 2 + 0.004, zc + Hz / 2 + 0.004), (-Wx / 2 - 0.004, zc + Hz / 2 + 0.004)], r=0.034, segs=3)
    slab(b, band, 0.026, m['teal'], bevel=0.004, c=0.0, axis='y')
    # front plus sign on a white rounded badge
    plate(b, rounded([(-0.075, zc - 0.075), (0.075, zc - 0.075), (0.075, zc + 0.075), (-0.075, zc + 0.075)],
                     r=0.03, segs=2), Dy / 2, 1, m['medw'], h=0.006, chamfer=0.004, axis='y')
    plate(b, rounded([(u, v + zc) for (u, v) in plus_shape(0.056, 0.019)], r=0.004, segs=1), Dy / 2 + 0.005, 1,
          m['teal'], h=0.006, chamfer=0.003, axis='y')
    plate(b, rounded([(-0.075, zc - 0.075), (0.075, zc - 0.075), (0.075, zc + 0.075), (-0.075, zc + 0.075)],
                     r=0.03, segs=2), -Dy / 2, -1, m['medw'], h=0.006, chamfer=0.004, axis='y')
    plate(b, rounded([(u, v + zc) for (u, v) in plus_shape(0.056, 0.019)], r=0.004, segs=1), -Dy / 2 - 0.005, -1,
          m['teal'], h=0.006, chamfer=0.003, axis='y')
    # handle on top + mounts, latches on the top front/back
    top = zc + Hz / 2
    path = bez_poly([P3(-0.07, 0, top), P3(-0.07, 0, top + 0.045), P3(0.07, 0, top + 0.045), P3(0.07, 0, top)], 3)
    sweep(b, path, shape=rounded([(-0.012, -0.009), (0.012, -0.009), (0.012, 0.009), (-0.012, 0.009)], r=0.004,
                                 segs=1), up=(0, 1, 0), mat=m['teal'])
    for sx in (1, -1):
        b.box((0.04, 0.05, 0.016), loc=(sx * 0.07, 0, top + 0.002), mat=m['metal'], bevel=0.005, bevel_segs=1)
        b.box((0.034, 0.02, 0.04), loc=(sx * 0.13, 0, top - 0.004), mat=m['metal'], bevel=0.005, bevel_segs=1)
    # corner bumpers
    for sx in (1, -1):
        for sz in (0, 1):
            b.box((0.05, Dy + 0.012, 0.05), loc=(sx * (Wx / 2 - 0.015), 0, 0.012 + 0.015 + sz * (Hz - 0.03)),
                  mat=m['teal'], bevel=0.014, bevel_segs=2)
    obj = b.to_object('Medkit')
    drop_to_ground(obj)
    finish(obj, ao_dist=0.06, ground=0.0)
    return obj


def potion(m, name, prof, fill, segs=16, extra=None):
    """Glass vessel (lathe profile (r, z)) with glowing liquid up to z=fill."""
    b = C.MeshBuilder()
    revolve(b, prof, 'z', (0, 0, 0), segs=segs, mat=m['glass'], cap1=False)
    liq = []
    for (r, z) in prof:
        if z <= fill:
            liq.append((r * 0.9 if r > 0 else 0.0, z + 0.004 if z < 0.005 else z))
    # close at the fill level
    for i in range(1, len(prof)):
        (r0, z0), (r1, z1) = prof[i - 1], prof[i]
        if z0 <= fill < z1:
            t = (fill - z0) / (z1 - z0)
            liq.append(((r0 + (r1 - r0) * t) * 0.9, fill))
            break
    liq.append((0.0, fill))
    revolve(b, liq, 'z', (0, 0, 0), segs=segs, mat=m['liquid'])
    if extra:
        extra(b)
    obj = b.to_object(name)
    finish(obj, ao_dist=0.05, ground=0.0, ao_strength=0.5)
    return obj


def shield_small(m):
    prof = [(0.0, 0.0), (0.032, 0.0), (0.046, 0.008), (0.056, 0.03), (0.058, 0.055), (0.052, 0.08),
            (0.038, 0.1), (0.02, 0.113), (0.017, 0.125), (0.017, 0.14), (0.021, 0.142), (0.021, 0.148),
            (0.016, 0.15)]

    def extra(b):
        revolve(b, [(0.0, 0.136), (0.0155, 0.136), (0.019, 0.15), (0.022, 0.176), (0.019, 0.182), (0.0, 0.183)],
                'z', (0, 0, 0), segs=10, mat=m['cork'])
        revolve(b, ring_prof(0.016, 0.022, 0.118, 0.13, 0.002), 'z', (0, 0, 0), segs=14, mat=m['metal'],
                closed_prof=True)
        # little metal shield badge hanging on a cord
        sweep(b, bez([P3(0.017, 0, 0.126), P3(0.04, -0.02, 0.1), P3(0.042, -0.045, 0.07)], 4), 0.0018, segs=4,
              mat=m['rope'])
        badge = rounded([(-0.014, 0.012), (0.014, 0.012), (0.014, -0.004, 0.006), (0.0, -0.016, 0.004),
                         (-0.014, -0.004, 0.006)], segs=1)
        tmp = [(u + 0.042, v + 0.06) for (u, v) in badge]
        slab(b, tmp, 0.005, m['metal'], bevel=0.0015, c=0.056, axis='y')
    return potion(m, 'ShieldSmall', prof, 0.085, segs=16, extra=extra)


def shield_badge(b, m, zc, f, w, mat):
    """Small heater-shield badge facing -Y at forward offset f."""
    pts = rounded([(-w, zc + w * 0.9), (w, zc + w * 0.9), (w, zc - w * 0.1, w * 0.5), (0.0, zc - w * 1.1, w * 0.3),
                   (-w, zc - w * 0.1, w * 0.5)], segs=2)
    slab(b, pts, 0.008, mat, bevel=0.003, c=f, axis='y')


def shield_big(m):
    prof = [(0.0, 0.0), (0.075, 0.0), (0.1, 0.014), (0.114, 0.048), (0.119, 0.1), (0.114, 0.15), (0.1, 0.19),
            (0.076, 0.224), (0.052, 0.248), (0.043, 0.266), (0.043, 0.294), (0.049, 0.296), (0.049, 0.306),
            (0.043, 0.308)]

    def extra(b):
        # screw cap with grip ridges
        revolve(b, [(0.0, 0.29), (0.052, 0.29), (0.054, 0.294), (0.054, 0.33), (0.049, 0.339), (0.0, 0.34)], 'z',
                (0, 0, 0), segs=14, mat=m['metal'])
        for k in range(10):
            a = 2 * PI * k / 10
            b.box((0.006, 0.012, 0.03), loc=(math.cos(a) * 0.055, math.sin(a) * 0.055, 0.314), rot=(0, 0, a),
                  mat=m['metal'])
        # metal bands around the body
        for zc, r in ((0.05, 0.114), (0.186, 0.102)):
            revolve(b, ring_prof(r - 0.004, r + 0.008, zc - 0.012, zc + 0.012, 0.003), 'z', (0, 0, 0), segs=20,
                    mat=m['metal'], closed_prof=True)
        # jug handle from the neck to the shoulder
        path = bez_poly([P3(0.04, 0, 0.27), P3(0.14, 0, 0.29), P3(0.155, 0, 0.19), P3(0.1, 0, 0.17)], 3)
        sweep(b, path, shape=rounded([(-0.016, -0.011), (0.016, -0.011), (0.016, 0.011), (-0.016, 0.011)],
                                     r=0.006, segs=1), up=(0, 1, 0), mat=m['metal'])
        # shield badge on the front
        shield_badge(b, m, 0.115, 0.118, 0.032, m['metal'])
    return potion(m, 'ShieldBig', prof, 0.2, segs=20, extra=extra)


# ---------------------------------------------------------------------------- ammo pickups

def bullet(b, m, x, y, z, r, L, case, tipm, lying=None, neck=0.7):
    """Bullet standing on (x, y, z) or lying along the given unit axis."""
    prof = [(0.0, 0.0), (r, 0.0), (r, L * 0.58), (r * 0.82, L * 0.64), (r * 0.8, L * 0.66)]
    tip = [(0.0, L * 0.64), (r * 0.8, L * 0.64), (r * 0.72, L * 0.8), (r * 0.4, L * 0.94), (0.0, L)]
    if lying is None:
        revolve(b, prof, 'z', (x, y, z), segs=8, mat=case, rot0=PI / 8)
        revolve(b, tip, 'z', (x, y, z), segs=8, mat=tipm, rot0=PI / 8)
    else:
        ax, rz = lying
        mat = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(-PI / 2, 4, 'Y')
        revolve(b, prof, 'z', (0, 0, 0), segs=10, mat=case, xform=mat)
        revolve(b, tip, 'z', (0, 0, 0), segs=10, mat=tipm, xform=mat)


def ammo_light(m):
    b = C.MeshBuilder()
    # clip tray + 6 small pale bullets standing in a row pair
    b.box((0.2, 0.075, 0.03), loc=(0, 0, 0.015), mat=m['metal'], bevel=0.008)
    b.box((0.21, 0.08, 0.012), loc=(0, 0, 0.034), mat=m['light'], bevel=0.004, bevel_segs=1)
    for i in range(5):
        for j, yy in enumerate((-0.018, 0.018)):
            bullet(b, m, -0.08 + i * 0.04, yy, 0.03, 0.013, 0.1 if j == 0 else 0.11, m['light'], m['metal'])
    obj = b.to_object('Ammo_Light')
    finish(obj, ao_dist=0.05, ground=0.0)
    return obj


def ammo_medium(m):
    b = C.MeshBuilder()
    # green box with an open flap and bullets poking out
    b.box((0.22, 0.13, 0.12), loc=(0, 0, 0.06), mat=m['medium'], bevel=0.01, bevel_segs=2)
    plate(b, rounded([(-0.08, 0.035), (0.08, 0.035), (0.08, 0.085), (-0.08, 0.085)], r=0.006, segs=1), 0.065, 1,
          m['light'], h=0.003, axis='y')
    plate(b, [(-0.06, 0.052), (0.06, 0.052), (0.06, 0.068), (-0.06, 0.068)], 0.068, 1, m['medium'], h=0.0015,
          axis='y', chamfer=0.001)
    # open lid flap tilted back
    b.box((0.22, 0.13, 0.012), loc=(0, 0.065 + 0.065 * math.cos(1.15), 0.12 + 0.065 * math.sin(1.15)),
          rot=(1.15, 0, 0), mat=m['medium'], bevel=0.004, bevel_segs=1)
    for i in range(4):
        for j in range(2):
            bullet(b, m, -0.066 + i * 0.044, -0.025 + j * 0.05, 0.07 + (0.01 if (i + j) % 2 else 0.0), 0.015, 0.09,
                   m['brass'], m['metal'])
    obj = b.to_object('Ammo_Medium')
    finish(obj, ao_dist=0.05, ground=0.0)
    return obj


def ammo_heavy(m):
    b = C.MeshBuilder()
    # three big dark rounds standing in a strapped cluster
    pos = [(-0.04, 0.02), (0.04, 0.02), (0.0, -0.045)]
    for x, y in pos:
        bullet(b, m, x, y, 0.0, 0.03, 0.22, m['heavy'], m['metal'])
    ring = [P3(0.078 * math.cos(2 * PI * i / 18), 0.078 * math.sin(2 * PI * i / 18) - 0.004, 0.06) for i in
            range(18)]
    sweep(b, ring, closed=True, up=(0, 0, 1), mat=m['metal'],
          shape=[(-0.004, -0.012), (0.004, -0.012), (0.004, 0.012), (-0.004, 0.012)])
    obj = b.to_object('Ammo_Heavy')
    finish(obj, ao_dist=0.06, ground=0.0)
    return obj


def ammo_shells(m):
    b = C.MeshBuilder()
    pos = [(0.0, 0.0), (0.042, 0.0), (-0.042, 0.0), (0.021, 0.036), (-0.021, 0.036), (0.021, -0.036),
           (-0.021, -0.036)]
    for (x, y) in pos:
        revolve(b, [(0.0, 0.0), (0.022, 0.0), (0.022, 0.022), (0.02, 0.024)], 'z', (x, y, 0), segs=10,
                mat=m['brass'])
        revolve(b, [(0.0199, 0.02), (0.0199, 0.12), (0.017, 0.124), (0.0, 0.124)], 'z', (x, y, 0), segs=10,
                mat=m['shells'])
    for zc in (0.045, 0.095):
        ring = [P3(0.066 * math.cos(2 * PI * i / 18), 0.066 * math.sin(2 * PI * i / 18), zc) for i in range(18)]
        sweep(b, ring, closed=True, up=(0, 0, 1), mat=m['metal'],
              shape=[(-0.003, -0.009), (0.003, -0.009), (0.003, 0.009), (-0.003, 0.009)])
    obj = b.to_object('Ammo_Shells')
    finish(obj, ao_dist=0.05, ground=0.0)
    return obj


def mini_rocket(b, m, x, y, z, L=0.28, r=0.03):
    """Small rocket lying along Y (nose towards -Y)."""
    body = [(0.0, -L / 2), (r * 0.8, -L / 2), (r * 0.8, -L / 2 + 0.02), (r, -L / 2 + 0.03), (r, L * 0.18)]
    revolve(b, body, 'y', (x, -y, z), segs=12, mat=m['heavy'])
    nose = [(r * 1.08, L * 0.16), (r * 1.08, L * 0.24), (r * 0.9, L * 0.33), (r * 0.5, L * 0.44), (0.0, L / 2)]
    revolve(b, [(0.0, L * 0.16)] + nose, 'y', (x, -y, z), segs=12, mat=m['tip'])
    for k in range(4):
        rot = Matrix.Translation((x, y, z)) @ Matrix.Rotation(PI / 4 + k * PI / 2, 4, 'Y')
        slab(b, [(-L / 2 + 0.01, r * 0.8), (-L / 2 + 0.07, r * 0.8), (-L / 2 + 0.03, r + 0.028),
                 (-L / 2 + 0.0, r + 0.028)], 0.004, m['metal'], bevel=0.0012, xform=rot)


def ammo_rockets(m):
    b = C.MeshBuilder()
    # two small rockets lying on a pair of cradles
    for sx in (1, -1):
        mini_rocket(b, m, sx * 0.045, 0.0, 0.062)
    for yy in (-0.08, 0.08):
        slab(b, rounded([(-0.1, 0.0), (0.1, 0.0), (0.1, 0.05), (0.078, 0.05), (0.045, 0.028, 0.012),
                         (0.012, 0.05), (-0.012, 0.05), (-0.045, 0.028, 0.012), (-0.078, 0.05), (-0.1, 0.05)],
                        r=0.004, segs=1), 0.03, m['metal'], bevel=0.004, c=-yy, axis='y')
    obj = b.to_object('Ammo_Rockets')
    finish(obj, ao_dist=0.06, ground=0.0)
    return obj


# ---------------------------------------------------------------------------- resource piles

def mat_wood(m):
    b = C.MeshBuilder()
    rnd = random.Random(4)
    pw, ph = 0.086, 0.034
    layers = [(-0.092, 0.0, 0.38), (0.0, 0.0, 0.38), (0.092, 0.0, 0.38),
              (-0.046, 1.0, 0.36), (0.046, 1.0, 0.36), (0.0, 2.0, 0.34)]
    for (y, lvl, ln) in layers:
        rz = rnd.uniform(-0.05, 0.05) if lvl < 2 else 0.22
        b.box((ln, pw, ph), loc=(rnd.uniform(-0.015, 0.015), y, ph / 2 + lvl * ph), rot=(0, 0, rz), mat=m['mwood'],
              bevel=0.007)
    # two straps around the lower layers
    for x in (-0.11, 0.11):
        loop = rounded([(-0.14, -0.002), (0.14, -0.002), (0.14, 0.036), (0.1, 0.071), (-0.1, 0.071),
                        (-0.14, 0.036)], r=0.01, segs=2)
        sweep(b, [P3(x, u, v) for (u, v) in loop], closed=True, up=(1, 0, 0), mat=m['rope'],
              shape=[(-0.011, -0.0025), (0.011, -0.0025), (0.011, 0.0025), (-0.011, 0.0025)])
    obj = b.to_object('Mat_Wood')
    drop_to_ground(obj)
    finish(obj, ao_dist=0.06, ground=0.0)
    return obj


def mat_stone(m):
    b = C.MeshBuilder()
    rnd = random.Random(7)
    spots = [(-0.1, -0.05, 0), (0.02, -0.06, 0), (0.12, 0.02, 0), (-0.08, 0.07, 0), (0.03, 0.06, 0),
             (-0.04, 0.0, 1), (0.07, 0.01, 1), (0.01, 0.02, 2)]
    for (x, y, lvl) in spots:
        sx, sy, sz = 0.12 + rnd.uniform(-0.01, 0.01), 0.075, 0.06
        b.box((sx, sy, sz), loc=(x, y, sz / 2 + lvl * 0.058), rot=(rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05),
                                                                  rnd.uniform(-0.5, 0.5)), mat=m['mstone'],
              bevel=0.013, bevel_segs=2)
    obj = b.to_object('Mat_Stone')
    drop_to_ground(obj)
    finish(obj, ao_dist=0.06, ground=0.0)
    return obj


def mat_metal(m):
    b = C.MeshBuilder()
    rnd = random.Random(2)
    for i in range(4):
        z = 0.012 + i * 0.026
        rz = rnd.uniform(-0.25, 0.25)
        b.box((0.3, 0.2, 0.024), loc=(rnd.uniform(-0.015, 0.015), rnd.uniform(-0.015, 0.015), z), rot=(0, 0, rz),
              mat=m['mmetal'], bevel=0.005)
        R = Matrix.Rotation(rz, 4, 'Z')
        for sx in (1, -1):
            for sy in (1, -1):
                p = R @ Vector((sx * 0.12, sy * 0.075, 0))
                b.cylinder(0.009, 0.006, loc=(p.x, p.y, z + 0.013), segs=8, mat=m['metal'])
    # I-beam offcut on top
    ib = [(-0.04, 0.0), (0.04, 0.0), (0.04, 0.012), (0.008, 0.012), (0.008, 0.058), (0.04, 0.058), (0.04, 0.07),
          (-0.04, 0.07), (-0.04, 0.058), (-0.008, 0.058), (-0.008, 0.012), (-0.04, 0.012)]
    tmp = [(u, v + 0.104) for (u, v) in ib]
    slab(b, tmp, 0.26, m['metal'], bevel=0.003, c=0.0, axis='y',
         xform=Matrix.Rotation(0.5, 4, 'Z'))
    obj = b.to_object('Mat_Metal')
    finish(obj, ao_dist=0.05, ground=0.0)
    return obj


def build_items(preview_dir=None):
    C.reset()
    C.clear_material_cache()
    m = items_mats()
    chest_objs = chest(m)
    box_objs = ammo_box(m)
    crate = supply_crate(m)
    balloon = supply_balloon(m, 1.52)
    singles = [bandage(m), medkit(m), shield_small(m), shield_big(m), ammo_light(m), ammo_medium(m),
               ammo_heavy(m), ammo_shells(m), ammo_rockets(m), mat_wood(m), mat_stone(m), mat_metal(m)]
    objs = chest_objs + box_objs + [crate, balloon] + singles
    for o in objs:
        print('%-18s %5d tris' % (o.name, tri_count(o)))
    if preview_dir:
        preview_items(objs, preview_dir)
    C.export_glb('items.glb', objs, colors=True)
    return objs


def preview_items(objs, d):
    os.makedirs(d, exist_ok=True)
    O = {o.name: o for o in objs}
    grid = {
        'Chest': (-1.05, 0.3), 'Chest_Lid': (-1.05, 0.3), 'AmmoBox': (0.05, 0.3), 'AmmoBox_Lid': (0.05, 0.3),
        'Medkit': (0.75, 0.3), 'ShieldBig': (1.2, 0.3), 'ShieldSmall': (1.55, 0.3), 'Bandage': (1.85, 0.3),
        'Ammo_Light': (-1.1, -0.35), 'Ammo_Medium': (-0.75, -0.35), 'Ammo_Heavy': (-0.4, -0.35),
        'Ammo_Shells': (-0.1, -0.35), 'Ammo_Rockets': (0.25, -0.35), 'Mat_Wood': (0.75, -0.35),
        'Mat_Stone': (1.25, -0.35), 'Mat_Metal': (1.75, -0.35),
    }
    for o in objs:
        o.hide_render = o.name not in grid
    s = _layout({O[n]: (x, y, 0, 0) for n, (x, y) in grid.items()})
    cen = Vector((0.35, 0.0, 0.1))
    dv = Vector((0.25, -1.0, 0.75)).normalized()
    render(os.path.join(d, 'items.png'), tuple(cen + dv * 8), tuple(cen), size=(1300, 700), ortho=3.7, samples=24,
           ground=0.0, sun_rot=(0.8, 0.0, 0.6))
    # open lids for a second look
    O['Chest_Lid'].rotation_euler = (-1.1, 0, 0)
    O['AmmoBox_Lid'].rotation_euler = (-1.3, 0, 0)
    cen2 = Vector((-0.5, 0.3, 0.3))
    dv2 = Vector((0.35, -1.0, 0.8)).normalized()
    for o in objs:
        o.hide_render = o.name not in ('Chest', 'Chest_Lid', 'AmmoBox', 'AmmoBox_Lid')
    render(os.path.join(d, 'items_chest_open.png'), tuple(cen2 + dv2 * 8), tuple(cen2), size=(900, 600), ortho=1.9,
           samples=24, ground=0.0, sun_rot=(0.8, 0.0, 0.6))
    _restore(s)
    # supply crate + balloon
    for o in objs:
        o.hide_render = o.name not in ('SupplyCrate', 'SupplyBalloon')
    cen3 = Vector((0, 0, 3.0))
    dv3 = Vector((0.5, -1.0, 0.35)).normalized()
    render(os.path.join(d, 'items_crate.png'), tuple(cen3 + dv3 * 30), tuple(cen3), size=(700, 900), ortho=7.2,
           samples=24, ground=0.0, sun_rot=(0.8, 0.0, 0.6))
    for o in objs:
        o.hide_render = False


# ============================================================================ vehicles

def vehicle_mats():
    return dict(
        skin=C.material('AirshipSkin', '#efe6d2', rough=0.6),
        stripe=C.material('AirshipStripe', '#e8553d', rough=0.5),
        cabin=C.material('AirshipCabin', '#3d6282', rough=0.55),
        metal=C.material('AirshipMetal', '#8e959d', rough=0.35, metal=1.0),
        dark=C.material('AirshipDark', '#1d252d', rough=0.6),
        glass=C.material('Glass', '#7fa6cc', rough=0.08, alpha=0.6),
        prop=C.material('PropWood', '#a36d3c', rough=0.6),
        fabric=C.material('GliderFabric', '#f2c14e', rough=0.7),
        trim=C.material('GliderTrim', '#2e86de', rough=0.6),
        frame=C.material('GliderFrame', '#c3cad2', rough=0.3, metal=0.9),
    )


ENVELOPE = [(0.0, 16.1), (1.3, 15.85), (2.5, 15.3), (3.5, 14.5), (4.3, 13.5), (4.9, 12.3), (5.2, 11.4),
            (5.45, 10.2), (5.62, 8.5), (5.72, 6.0), (5.72, 2.5), (5.6, -1.0), (5.3, -4.0), (4.8, -6.8), (4.1, -9.5),
            (3.3, -11.8), (2.5, -13.5), (1.6, -14.9), (0.9, -15.7), (0.0, -16.1)]


def env_radius(f):
    for (r0, t0), (r1, t1) in zip(ENVELOPE, ENVELOPE[1:]):
        if t1 <= f <= t0:
            return r0 + (r1 - r0) * (f - t0) / (t1 - t0)
    return 0.0


def env_point(f, ang_deg, inset=0.15):
    """Point on the envelope surface at forward f, angle from +X (towards +Z)."""
    r = env_radius(f) - inset
    a = math.radians(ang_deg)
    return Vector((r * math.cos(a), -f, r * math.sin(a)))


def airship(m):
    b = C.MeshBuilder()
    segs = 32
    prof = ENVELOPE

    def env_mat(k, i):
        t = (prof[k][1] + prof[k + 1][1]) / 2
        if t > 13.4 or 10.2 < t < 11.4 or t < -11.8:
            return m['stripe']
        if i in (0, segs // 2) and -11.8 < t < 10.2:
            return m['stripe']
        return m['skin']
    revolve(b, prof, 'y', (0, 0, 0), segs=segs, seg_mat=env_mat, rot0=-PI / segs)
    # nose mooring cone + tail cap
    revolve(b, [(0.0, 16.55), (0.22, 16.5), (0.42, 16.25), (0.62, 15.95), (0.0, 15.8)], 'y', (0, 0, 0), segs=12,
            mat=m['metal'])
    # four tail fins (+ layout)
    fin = rounded([(-8.8, 3.4), (-14.0, 6.35, 0.6), (-16.5, 6.0, 0.5), (-15.5, 0.8)], segs=2)
    for k in range(4):
        rot = Matrix.Rotation(k * PI / 2, 4, 'Y')
        slab(b, fin, 0.42, m['stripe'], bevel=0.14, bsegs=2, xform=rot)
        slab(b, [(-11.55, 5.0), (-16.36, 5.0), (-16.47, 5.6), (-12.62, 5.6)], 0.46, m['skin'], bevel=0.08,
             xform=rot)

    # ---- gondola
    zt, zb_ = -6.3, -9.1
    gprof = rounded([(5.2, -7.4, 0.7), (4.5, zt, 0.5), (-2.8, zt, 0.3), (-3.35, -6.8, 0.3), (-3.35, -8.4, 0.4),
                     (-2.5, zb_, 0.5), (3.6, zb_, 0.6), (5.0, -8.35, 0.5)], segs=2)
    wf = (lambda u, v: 1.0 - 0.38 * min(1.0, max(0.0, (u - 2.8) / 2.4)) ** 2)
    slab(b, gprof, 3.0, m['cabin'], bevel=0.16, bsegs=2, wfun=wf)
    # roof cap and red belt line
    slab(b, rounded([(4.1, zt - 0.05), (-2.6, zt - 0.05), (-2.5, zt + 0.22, 0.12), (4.0, zt + 0.22, 0.12)], segs=1),
         2.7, m['stripe'], bevel=0.08, wfun=wf)
    for s in (1, -1):
        plate(b, rounded([(-3.1, -6.85), (3.2, -6.85), (3.2, -6.62), (-3.1, -6.62)], r=0.08, segs=1), s * 1.5, s,
              m['stripe'], h=0.05, chamfer=0.03, sink=0.03)
        plate(b, rounded([(-2.8, -8.75), (3.3, -8.75), (3.3, -8.55), (-2.8, -8.55)], r=0.08, segs=1), s * 1.5, s,
              m['metal'], h=0.05, chamfer=0.03, sink=0.03)

    # windows: dark backing + glass pane (pushed in to follow the tapering nose)
    def window(f, side):
        pts = rounded([(f - 0.36, -7.75), (f + 0.36, -7.75), (f + 0.36, -6.98), (f - 0.36, -6.98)], r=0.2, segs=1)
        xs = 1.5 * wf(f + 0.36, 0)
        plate(b, pts, side * xs, side, m['dark'], h=0.03, chamfer=0.02, sink=0.03)
        plate(b, [(q.x, q.y) for q in _inset(pts, 0.07)], side * (xs + 0.03), side, m['glass'], h=0.02,
              chamfer=0.01)
    for f in (1.3, 2.3):
        window(f, 1)
    for f in (-2.2, -1.2, -0.2, 0.8, 1.8, 2.8):
        window(f, -1)
    # wrap-around bridge windows following the nose (dark band under a glass skin)
    z0, z1, fb = -7.82, -6.95, 3.3
    P = [Vector(q) for q in gprof]

    def cut(z):
        best = None
        for a_, c_ in zip(P, P[1:] + P[:1]):
            if (a_.y - z) * (c_.y - z) <= 0 and a_.y != c_.y:
                f = a_.x + (c_.x - a_.x) * (z - a_.y) / (c_.y - a_.y)
                best = f if best is None else max(best, f)
        return best
    front = sorted([q for q in P if z0 < q.y < z1 and q.x > fb + 0.2], key=lambda q: -q.y)
    band = ([(fb - 0.06, z1 + 0.05), (cut(z1 + 0.05) + 0.02, z1 + 0.05)] + [(q.x + 0.02, q.y) for q in front] +
            [(cut(z0 - 0.05) + 0.02, z0 - 0.05), (fb - 0.06, z0 - 0.05)])
    slab(b, band, 3.0, m['dark'], bevel=0.03, wfun=(lambda u, v: wf(u, v) + 0.02 / 1.5))
    gw = (lambda u, v: wf(u, v) + 0.04 / 1.5)
    for fa, fz in ((fb, 3.92), (4.02, 4.55)):
        slab(b, [(fa, z0), (fz, z0), (fz, z1), (fa, z1)], 3.0, m['glass'], bevel=0.02, wfun=gw)
    nose = ([(4.65, z1), (cut(z1) + 0.04, z1)] + [(q.x + 0.04, q.y) for q in front] + [(cut(z0) + 0.04, z0),
                                                                                        (4.65, z0)])
    slab(b, nose, 3.0, m['glass'], bevel=0.02, wfun=gw)
    # open side door (left, +X): dark opening, frame, slid-back door panel, step and grab rails
    df0, df1, dz0, dz1 = -0.85, 0.65, -8.75, -6.75
    plate(b, rounded([(df0, dz0), (df1, dz0), (df1, dz1), (df0, dz1)], r=0.12, segs=1), 1.5, 1, m['dark'],
          h=0.02, chamfer=0.01)
    frame = rounded([(df0 - 0.06, dz0 - 0.04), (df1 + 0.06, dz0 - 0.04), (df1 + 0.06, dz1 + 0.06),
                     (df0 - 0.06, dz1 + 0.06)], r=0.16, segs=1)
    sweep(b, [Vector((1.54, -u, v)) for (u, v) in frame], closed=True, up=(1, 0, 0), mat=m['stripe'],
          shape=[(-0.07, -0.05), (0.07, -0.05), (0.07, 0.05), (-0.07, 0.05)])
    slab(b, rounded([(-2.45, -8.72), (-0.95, -8.72), (-0.95, -6.78), (-2.45, -6.78)], r=0.12, segs=1), 0.1,
         m['cabin'], bevel=0.03, c=1.62)
    plate(b, rounded([(-2.05, -7.6), (-1.35, -7.6), (-1.35, -7.05), (-2.05, -7.05)], r=0.15, segs=1), 1.67, 1,
          m['dark'], h=0.02)
    for zz in (-6.62, -8.86):
        b.cylinder(0.05, 3.5, loc=(1.62, 0.95, zz), rot=(PI / 2, 0, 0), segs=6, mat=m['metal'])
    bx(b, df0 - 0.2, df1 + 0.2, -9.05, -8.9, 0.7, x=1.75, mat=m['metal'], bevel=0.04)
    for f in (df0 - 0.15, df1 + 0.15):
        sweep(b, [V(f, -8.9, 2.0), V(f, -7.5, 2.02), V(f, -7.3, 1.62)], 0.05, segs=6, mat=m['metal'])
    # stern lamp + keel skid
    b.sphere(0.2, loc=V(-3.35, -7.1), segs=10, rings=6, mat=m['stripe'])
    sweep(b, bez([V(3.3, -9.0), V(0.5, -9.35), V(-2.2, -9.0)], 4), 0.1, segs=6, mat=m['metal'])
    for f in (2.6, 0.5, -1.5):
        b.cylinder(0.06, 0.4, loc=V(f, -9.12), segs=6, mat=m['metal'])

    # ---- struts and rigging cables
    for f in (3.4, -2.2):
        for s in (1, -1):
            sweep(b, [V(f, zt + 0.1, s * 0.9), V(f + 0.2, -5.3, s * 1.2)], 0.13, segs=8, mat=m['metal'])
    for (f0, f1, ang) in ((4.0, 7.0, -50), (-2.5, -5.6, -50)):
        for s in (1, -1):
            p0 = V(f0, zt + 0.15, s * 1.25)
            p1 = env_point(f1, 180 - ang if s < 0 else ang, inset=0.1)
            p1 = Vector((s * abs(p1.x), p1.y, p1.z))
            sweep(b, [p0, p1], 0.045, segs=4, mat=m['dark'])
    for (f0, f1) in ((4.4, 9.2), (-2.9, -7.6)):
        sweep(b, [V(f0, zt + 0.1), env_point(f1, -90, inset=0.1)], 0.045, segs=4, mat=m['dark'])

    # ---- engine nacelles on outriggers
    props = []
    nf, nz, nx = -4.4, -7.0, 4.9
    for s in (1, -1):
        x = s * nx
        nac = [(0.0, nf - 1.95), (0.24, nf - 1.9), (0.44, nf - 1.5), (0.62, nf - 0.6), (0.72, nf + 0.4),
               (0.72, nf + 0.9), (0.7, nf + 1.2), (0.64, nf + 1.45), (0.56, nf + 1.6), (0.0, nf + 1.62)]
        mats = [m['cabin']] * (len(nac) - 1)
        mats[4] = m['stripe']
        mats[5] = m['metal']
        mats[6] = m['metal']
        mats[7] = m['metal']
        mats[8] = m['metal']
        revolve(b, nac, 'y', (x, 0, nz), segs=12, mats=mats)
        # exhausts + intake
        for sz in (1, -1):
            b.cylinder(0.09, 0.5, loc=(x - s * 0.55, -(nf - 0.9), nz + sz * 0.25), rot=(PI / 2 - 0.15, 0, 0), segs=6,
                       mat=m['dark'])
        bx(b, nf + 0.2, nf + 0.9, nz + 0.55, nz + 0.8, 0.5, x=x, mat=m['metal'], bevel=0.08)
        # streamlined outrigger arm and upper brace
        arm = rounded([(-0.12, -0.34), (0.12, -0.34), (0.12, 0.34), (-0.12, 0.34)], r=0.08, segs=2)
        sweep(b, [V(-2.75, nz, s * 1.3), V(nf + 0.1, nz, s * (nx - 0.35))], shape=arm, up=(0, 0, 1), mat=m['metal'])
        top = env_point(nf + 0.3, -40, inset=0.2)
        top = Vector((s * abs(top.x), top.y, top.z))
        sweep(b, [Vector((x - s * 0.15, -(nf + 0.3), nz + 0.6)), top], 0.1, segs=6, mat=m['metal'])
        sweep(b, [Vector((x - s * 0.1, -(nf + 0.8), nz + 0.55)), V(-2.2, zt + 0.15, s * 1.3)], 0.05, segs=4,
              mat=m['dark'])
        props.append((s, Vector((x, -(nf + 1.72), nz))))
    obj = b.to_object('Airship')
    finish(obj, ao_dist=3.0, ao_strength=0.7, samples=40)
    out = [obj]
    for s, hub in props:
        out.append(propeller(m, 'Airship_Prop_L' if s > 0 else 'Airship_Prop_R', hub, s))
    return out


def propeller(m, name, hub, side):
    b = C.MeshBuilder()
    revolve(b, [(0.0, 0.5), (0.1, 0.46), (0.2, 0.34), (0.27, 0.16), (0.29, 0.0), (0.29, -0.14), (0.0, -0.14)], 'y',
            (0, 0, 0), segs=12, mats=[m['stripe']] * 4 + [m['metal']] * 2)
    base = rounded([(-0.09, 0.2), (0.11, 0.2), (0.18, 0.55, 0.1), (0.15, 1.02), (-0.12, 1.02), (-0.14, 0.55, 0.1)],
                   segs=2)
    tip = rounded([(-0.12, 1.02), (0.15, 1.02), (0.1, 1.25, 0.08), (-0.06, 1.28, 0.06), (-0.12, 1.12)], segs=2)
    for k in range(3):
        R = Matrix.Rotation(side * 2 * PI * k / 3, 4, 'Y') @ Matrix.Rotation(side * 0.35, 4, 'Z')
        slab(b, base, 0.07, m['prop'], bevel=0.025, c=0.0, axis='y', xform=R)
        slab(b, tip, 0.07, m['stripe'], bevel=0.025, c=0.0, axis='y', xform=R)
    obj = b.to_object(name)
    finish(obj, ao_dist=0.4)
    obj.location = hub
    return obj


# ---------------------------------------------------------------------------- glider

def glider(m):
    b = C.MeshBuilder()
    H = 1.42           # keel height above the control bar
    span = 2.25
    nose = Vector((0.0, -1.25))
    tip_le = Vector((span, 0.33))

    def le(u):
        a = abs(u)
        p = nose.lerp(tip_le, a)
        return Vector((span * u, p.y))

    def te(u):
        a = abs(u)
        return Vector((span * u, 1.1 - 0.46 * a ** 1.25 + 0.07 * math.sin(PI * a)))

    def zf(u, v):
        return H + 0.06 + 0.1 * abs(u) + 0.15 * math.sin(PI * v ** 0.85) * (1.0 - 0.55 * u * u)

    # columns hit the wingtip panel edges, rows follow the leading-edge band and the chevron exactly
    inner = 14
    us = [-1.0] + [-0.86 + 1.72 * i / inner for i in range(inner + 1)] + [1.0]

    def chev(u):
        return min(0.34 + 0.42 * abs(u), 0.8)

    def rows(u):
        c = chev(u)
        return [0.0, 0.07, 0.14, (0.14 + c - 0.075) / 2, c - 0.075, c + 0.075,
                c + 0.075 + (1 - c - 0.075) / 3, c + 0.075 + 2 * (1 - c - 0.075) / 3, 1.0]
    nr = 9
    bm = bmesh.new()
    grid = []
    for j in range(nr):
        row = []
        for u in us:
            v = rows(u)[j]
            p = le(u).lerp(te(u), v)
            row.append(bm.verts.new((p.x, p.y, zf(u, v))))
        grid.append(row)
    for j in range(nr - 1):
        for i in range(len(us) - 1):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            u = (us[i] + us[i + 1]) / 2
            trim = j < 2 or j == 4 or abs(u) > 0.86
            f.material_index = 1 if trim else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.035)
    me = bpy.data.meshes.new('sail')
    bm.to_mesh(me)
    bm.free()
    fi, ti = b.mat_index(m['fabric']), b.mat_index(m['trim'])
    for p in me.polygons:
        p.material_index = ti if p.material_index == 1 else fi
    b.bm.from_mesh(me)
    bpy.data.meshes.remove(me)

    # frame: keel, leading edges, crossbar, king post, A-frame and control bar
    fr = m['frame']
    keel = [Vector((0, nose.y - 0.08, H + 0.02)), Vector((0, 1.2, H))]
    sweep(b, keel, 0.032, segs=8, mat=fr)
    for s in (1, -1):
        sweep(b, [Vector((0, nose.y - 0.05, H + 0.05)), Vector((s * span * 1.01, tip_le.y + 0.02, H + 0.15))],
              0.03, segs=8, mat=fr)
        b.sphere(0.05, loc=(s * span * 1.01, -(-tip_le.y - 0.02), H + 0.15), segs=8, rings=6, mat=m['trim'])
        sweep(b, [Vector((s * 1.22, -0.36, H + 0.075)), Vector((0, 0.08, H))], 0.026, segs=8, mat=fr)
    b.box((0.12, 0.2, 0.08), loc=(0, 0.08, H - 0.02), mat=m['trim'], bevel=0.02, bevel_segs=1)
    kp_top = Vector((0, 0.1, H + 0.62))
    sweep(b, [Vector((0, 0.08, H)), kp_top], 0.022, segs=6, mat=fr)
    b.sphere(0.035, loc=kp_top, segs=8, rings=6, mat=m['trim'])
    apex = Vector((0, 0.16, H - 0.03))
    bar = 0.62
    for s in (1, -1):
        sweep(b, [apex + Vector((s * 0.03, 0, 0)), Vector((s * bar, 0.0, 0.0))], 0.024, segs=8, mat=fr)
        b.sphere(0.04, loc=(s * bar, 0, 0), segs=8, rings=6, mat=fr)
    sweep(b, [Vector((-bar, 0, 0)), Vector((bar, 0, 0))], 0.022, segs=8, mat=fr)
    for s in (1, -1):
        b.cylinder(0.034, 0.26, loc=(s * 0.3, 0, 0), rot=(0, PI / 2, 0), segs=10, mat=m['trim'])
    # flying wires (below) and landing wires (above)
    anchors = [Vector((0, nose.y - 0.02, H + 0.03)), Vector((0, 1.18, H)), Vector((span * 0.98, tip_le.y, H + 0.14)),
               Vector((-span * 0.98, tip_le.y, H + 0.14))]
    for s in (1, -1):
        for a in anchors:
            if a.x * s < -0.1:
                continue
            sweep(b, [Vector((s * bar, 0, 0)), a], 0.006, segs=4, mat=fr)
    for a in anchors:
        sweep(b, [kp_top, a + Vector((0, 0, 0.04))], 0.006, segs=4, mat=fr)
    obj = b.to_object('Glider')
    finish(obj, ao_dist=0.5, samples=40)
    return obj


def build_vehicles(preview_dir=None):
    C.reset()
    C.clear_material_cache()
    m = vehicle_mats()
    ship = airship(m)
    gl = glider(m)
    objs = ship + [gl]
    for o in objs:
        print('%-18s %5d tris' % (o.name, tri_count(o)))
    print('airship total', sum(tri_count(o) for o in ship))
    if preview_dir:
        preview_vehicles(objs, preview_dir)
    C.export_glb('vehicles.glb', objs, colors=True)
    return objs


def preview_vehicles(objs, d):
    os.makedirs(d, exist_ok=True)
    O = {o.name: o for o in objs}
    O['Glider'].hide_render = True
    cen = Vector((0, 0, -1.5))
    dv = Vector((1.0, -0.75, 0.32)).normalized()
    render(os.path.join(d, 'airship.png'), tuple(cen + dv * 120), tuple(cen), size=(1200, 700), ortho=36, samples=24,
           world='#a9c4de')
    dv = Vector((0.8, -0.2, -0.35)).normalized()
    cen = Vector((0, -1.0, -6.8))
    render(os.path.join(d, 'airship_gondola.png'), tuple(cen + dv * 60), tuple(cen), size=(1000, 650), ortho=13,
           samples=24, world='#a9c4de')
    for o in objs:
        o.hide_render = o.name != 'Glider'
    cen = Vector((0, 0, 0.9))
    dv = Vector((0.75, -1.0, 0.55)).normalized()
    render(os.path.join(d, 'glider.png'), tuple(cen + dv * 20), tuple(cen), size=(1000, 700), ortho=5.4, samples=24,
           world='#a9c4de')
    for o in objs:
        o.hide_render = False


# ============================================================================ entry point

def build(preview_dir=None):
    """Build and export weapons.glb, items.glb and vehicles.glb (optionally rendering previews)."""
    build_weapons(preview_dir)
    build_items(preview_dir)
    build_vehicles(preview_dir)


if __name__ == '__main__':
    import sys
    build(sys.argv[1] if len(sys.argv) > 1 else None)
