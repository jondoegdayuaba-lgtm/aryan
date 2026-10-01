# Extra modelling helpers (run inside models.py, so mat/box/cyl/sphere/limb/empty/finish are available).
# Everything is built in world space (+Y forward, +Z up) and then parented without moving.
import bmesh
from mathutils import Vector, Matrix, Quaternion


def _link(name, me, m=None, parent=None, smooth=True, sharp=0.6):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for mm in (m if isinstance(m, (list, tuple)) else [m]):
        if mm is not None:
            me.materials.append(mm)
    for p in me.polygons:
        p.use_smooth = smooth
    if smooth and sharp:
        me.set_sharp_from_angle(angle=sharp)
    if parent is not None:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


def apply_mods(o):
    """Bakes all modifiers of o into its mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = o.data
    o.modifiers.clear()
    o.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return o


def shade(o, sharp=0.6):
    for p in o.data.polygons:
        p.use_smooth = True
    if sharp:
        o.data.set_sharp_from_angle(angle=sharp)
    return o


def bevel(o, width, seg=2, angle=0.7):
    md = o.modifiers.new('bv', 'BEVEL')
    md.width = width
    md.segments = seg
    md.limit_method = 'ANGLE'
    md.angle_limit = angle
    md.miter_outer = 'MITER_ARC'
    apply_mods(o)
    return o


def rbox(name, size, loc, m, parent=None, r=0.006, seg=2, rot=(0, 0, 0)):
    """Box with rounded edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=False)
    if r > 0:
        bevel(o, min(r, min(size) * 0.45), seg)
    o.rotation_euler = rot
    o.location = loc
    bpy.context.view_layer.update()
    shade(o)
    if parent is not None:
        reparent(o, parent)
    return o


def reparent(o, parent):
    bpy.context.view_layer.update()
    mw = o.matrix_world.copy()
    o.parent = parent
    o.matrix_world = mw


def profile(name, pts, width, m, parent=None, x=0.0, bev=0.003, seg=2, axis='X', loc=(0, 0, 0), rot=(0, 0, 0)):
    """Extrudes a 2D outline. axis='X': pts are (y, z), thickness along X centred on x (side profile of a gun).
    axis='Z': pts are (x, y), extruded upwards from z=x by width.  axis='Y': pts are (x, z)."""
    bm = bmesh.new()
    if axis == 'X':
        vs = [bm.verts.new((x - width / 2, p[0], p[1])) for p in pts]
        off = Vector((width, 0, 0))
    elif axis == 'Y':
        vs = [bm.verts.new((p[0], x - width / 2, p[1])) for p in pts]
        off = Vector((0, width, 0))
    else:
        vs = [bm.verts.new((p[0], p[1], x)) for p in pts]
        off = Vector((0, 0, width))
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=off, verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=False)
    if bev > 0:
        bevel(o, bev, seg, 0.5)
    shade(o, 0.55)
    o.location = loc
    o.rotation_euler = rot
    if parent is not None:
        reparent(o, parent)
    return o


def _frames(pts):
    """Parallel-transport frames along a polyline."""
    pts = [Vector(p) for p in pts]
    tans = []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tans.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    n = tans[0].cross(ref).normalized()
    out = []
    for i, t in enumerate(tans):
        if i:
            q = tans[i - 1].rotation_difference(t)
            n = (q @ n).normalized()
        out.append((pts[i], t, n, t.cross(n).normalized()))
    return out


def tube(name, pts, r, m, parent=None, sides=10, cap=True, radii=None, smooth=True):
    """Tube along a polyline (r may vary per point through radii)."""
    bm = bmesh.new()
    rings = []
    for i, (p, t, n, b) in enumerate(_frames(pts)):
        rr = radii[i] if radii else r
        ring = []
        for k in range(sides):
            a = k / sides * math.tau
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * rr))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=smooth, sharp=1.2 if smooth else 0)
    if parent is not None:
        reparent(o, parent)
    return o


def lathe(name, prof, m, parent=None, segs=24, loc=(0, 0, 0), axis='Y', smooth=True, sharp=0.9):
    """Surface of revolution. prof = [(radius, position along axis), ...]; radius 0 closes the end."""
    bm = bmesh.new()
    rings = []
    for (rad, t) in prof:
        ring = []
        for k in range(segs):
            a = k / segs * math.tau
            c, s = math.cos(a) * rad, math.sin(a) * rad
            if axis == 'Y':
                co = (c, t, s)
            elif axis == 'X':
                co = (t, c, s)
            else:
                co = (c, s, t)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    if prof[0][0] > 0:
        bm.faces.new(list(reversed(rings[0])))
    if prof[-1][0] > 0:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=smooth, sharp=sharp)
    o.location = loc
    if parent is not None:
        reparent(o, parent)
    return o


def ellipsoid(name, radii, loc, m, parent=None, seg=24, rings=14, cut=None):
    """UV ellipsoid; cut=z keeps only the part above local z (for helmets, caps)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    if cut is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut], context='VERTS')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=True, sharp=0)
    o.location = loc
    if parent is not None:
        reparent(o, parent)
    return o


def solidify(o, t, offset=-1):
    md = o.modifiers.new('sd', 'SOLIDIFY')
    md.thickness = t
    md.offset = offset
    md.use_even_offset = True
    apply_mods(o)
    shade(o, 0.9)
    return o


def torus(name, R, r, loc, m, parent=None, rot=(0, 0, 0), major=24, minor=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major, minor_segments=minor, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    shade(o, 0)
    if parent is not None:
        reparent(o, parent)
    return o


def to_bone(objs, rig, bone):
    """Parents objects to an armature bone without moving them."""
    bpy.context.view_layer.update()
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = rig
        o.parent_type = 'BONE'
        o.parent_bone = bone
        o.matrix_world = mw


def aim_at(o, origin, direction, up=(0, 0, 1)):
    """Rotates an object built along +Y (with +Z up) so +Y points along direction, then moves it to origin."""
    d = Vector(direction).normalized()
    q = d.to_track_quat('Y', 'Z')
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q
    o.location = origin
    bpy.context.view_layer.update()
    return o
