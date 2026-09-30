"""Shared Blender helpers: scene reset, PBR materials, a UV-aware mesh builder, GLB export.

Conventions (kept identical across every asset so the game can rely on them):
  * metres, Z up in Blender (glTF export converts to Y up)
  * vehicles / props face Blender +Y  ==  three.js -Z  (the object's "forward")
  * object origin sits on the ground, centred on the footprint
"""
import math
import os

import bpy  # noqa: F401  (must precede bmesh in the pip build)
import bmesh  # noqa: E402
from mathutils import Vector

TEX_DIR = None  # set by build_assets.py
_mat_cache = {}
_img_cache = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mat_cache.clear()
    _img_cache.clear()


def _image(name, srgb):
    key = (name, srgb)
    if key in _img_cache:
        return _img_cache[key]
    img = bpy.data.images.load(os.path.join(TEX_DIR, name), check_existing=True)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    _img_cache[key] = img
    return img


def pbr(name, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, emit=None, emit_strength=1.0,
        alpha=None, coat=0.0, albedo=None, orm=None, emissive=None, uv_scale=None, spec=0.5, ior=None):
    """Principled material; textures are file names inside TEX_DIR."""
    if name in _mat_cache:
        return _mat_cache[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if ior:
        bsdf.inputs["IOR"].default_value = ior
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if albedo:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _image(albedo, True)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if orm:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _image(orm, False)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(t.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if emissive:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _image(emissive, True)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    _mat_cache[name] = m
    return m


# ---------------------------------------------------------------------------------------
class MB:
    """bmesh wrapper with per-face materials and explicit UVs."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def face(self, pts, mat, uvs=None, smooth=False):
        verts = [self.bm.verts.new(Vector(p)) for p in pts]
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        f.material_index = self.mi(mat)
        f.smooth = smooth
        if uvs is not None:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
        return f

    def box(self, x0, y0, z0, x1, y1, z1, mat, top=None, bottom=None, uvscale=1.0):
        """Axis-aligned box; UVs in metres * uvscale. `top` optional different material."""
        top = top or mat
        P = lambda x, y, z: (x, y, z)
        s = uvscale
        # +Y, -Y, +X, -X sides (counter-clockwise seen from outside), top, bottom
        self.face([P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)], mat,
                  [(-x1 * s, z0 * s), (-x0 * s, z0 * s), (-x0 * s, z1 * s), (-x1 * s, z1 * s)])
        self.face([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], mat,
                  [(x0 * s, z0 * s), (x1 * s, z0 * s), (x1 * s, z1 * s), (x0 * s, z1 * s)])
        self.face([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], mat,
                  [(y0 * s, z0 * s), (y1 * s, z0 * s), (y1 * s, z1 * s), (y0 * s, z1 * s)])
        self.face([P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)], mat,
                  [(-y1 * s, z0 * s), (-y0 * s, z0 * s), (-y0 * s, z1 * s), (-y1 * s, z1 * s)])
        self.face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top,
                  [(x0 * s, y0 * s), (x1 * s, y0 * s), (x1 * s, y1 * s), (x0 * s, y1 * s)])
        if bottom is not False:
            self.face([P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0)], bottom or mat,
                      [(x0 * s, y1 * s), (x1 * s, y1 * s), (x1 * s, y0 * s), (x0 * s, y0 * s)])

    def cyl(self, cx, cy, z0, z1, r0, r1, mat, seg=16, cap_top=True, cap_bot=False, smooth=True, axis="z"):
        """Frustum along Z (axis='z'); for X/Y axis pass axis and treat cx,cy,z as (a,b,along)."""
        def pt(i, r, z):
            a = 2 * math.pi * i / seg
            u, v = cx + r * math.cos(a), cy + r * math.sin(a)
            if axis == "z":
                return (u, v, z)
            if axis == "x":
                return (z, u, v)
            return (v, z, u)  # y (cyclic permutation keeps the winding outward)
        for i in range(seg):
            j = (i + 1) % seg
            self.face([pt(i, r0, z0), pt(j, r0, z0), pt(j, r1, z1), pt(i, r1, z1)], mat,
                      [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1)], smooth)
        if cap_top:
            self.face([pt(i, r1, z1) for i in range(seg)], mat, [(0.5 + 0.5 * math.cos(2 * math.pi * i / seg), 0.5 + 0.5 * math.sin(2 * math.pi * i / seg)) for i in range(seg)])
        if cap_bot:
            self.face([pt(i, r0, z0) for i in reversed(range(seg))], mat, [(0.5, 0.5)] * seg)

    def lathe(self, profile, mat, seg=48, axis="x", center=(0, 0, 0), smooth=True, u_repeat=1.0, closed=False, flip=False, t_range=(0.0, 2 * math.pi), bump=None):
        """Revolve `profile` [(radius, axial), ...] around an axis through `center`."""
        cx, cy, cz = center

        def pt(r, a, t):
            c, s = r * math.cos(t), r * math.sin(t)
            if axis == "x":
                return (cx + a, cy + c, cz + s)
            if axis == "y":
                return (cx + s, cy + a, cz + c)
            return (cx + c, cy + s, cz + a)

        n = len(profile)
        rng = range(n) if closed else range(n - 1)
        ta, tb = t_range
        for i in range(seg):
            t0, t1 = ta + (tb - ta) * i / seg, ta + (tb - ta) * (i + 1) / seg
            for k in rng:
                (r0, a0), (r1, a1) = profile[k], profile[(k + 1) % n]
                d = (lambda t, kk: bump(t, kk, i)) if bump else (lambda t, kk: 0.0)
                pts = [pt(r0 + d(t0, k), a0, t0), pt(r0 + d(t1, k), a0, t1), pt(r1 + d(t1, k + 1), a1, t1), pt(r1 + d(t0, k + 1), a1, t0)]
                uvs = [(i / seg * u_repeat, k / n), ((i + 1) / seg * u_repeat, k / n), ((i + 1) / seg * u_repeat, (k + 1) / n), (i / seg * u_repeat, (k + 1) / n)]
                if flip:
                    pts, uvs = pts[::-1], uvs[::-1]
                self.face(pts, mat, uvs, smooth)

    def between(self, p0, p1, r0, mat, r1=None, seg=8, caps=True):
        """Cylinder/frustum from p0 to p1 (arbitrary direction)."""
        a, b = Vector(p0), Vector(p1)
        d = b - a
        L = d.length
        if L < 1e-6:
            return
        z = d / L
        ref = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
        x = z.cross(ref).normalized()
        y = z.cross(x)
        r1 = r0 if r1 is None else r1
        ring0 = [a + (x * math.cos(2 * math.pi * i / seg) + y * math.sin(2 * math.pi * i / seg)) * r0 for i in range(seg)]
        ring1 = [b + (x * math.cos(2 * math.pi * i / seg) + y * math.sin(2 * math.pi * i / seg)) * r1 for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            self.face([ring0[i], ring0[j], ring1[j], ring1[i]], mat, None, True)
        if caps:
            self.face(ring1, mat)
            self.face(ring0[::-1], mat)

    def finish(self, name=None, weld=False):
        me = bpy.data.meshes.new(name or self.name)
        if weld:  # merge shared corners so subdivision / booleans see a closed manifold
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name or self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def to_mesh_obj(ob):
    """Apply modifiers and return the object (mesh data evaluated)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    ob.modifiers.clear()
    ob.data = me
    return ob


def new_obj(name, me, mats=(), loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    ob.location = loc
    ob.rotation_euler = rot
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    if parent is not None:
        ob.parent = parent
    return ob


def shade_smooth(ob, angle=math.radians(40)):
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        # auto-smooth is a modifier-less attribute in 4.2; sharpen edges past the angle
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=angle)
        ob.select_set(False)
    except Exception:
        pass


def add_bevel_subsurf(ob, width=0.02, levels=2, segments=2):
    bev = ob.modifiers.new("bevel", "BEVEL")
    bev.width = width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    if levels:
        s = ob.modifiers.new("sub", "SUBSURF")
        s.levels = levels
        s.render_levels = levels


def prim(kind, name, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), parent=None, smooth=True, **kw):
    """Create a primitive mesh object with a material and transform."""
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1, **kw)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=kw.pop("vertices", 24), radius=kw.pop("radius", 0.5), depth=kw.pop("depth", 1), **kw)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.pop("segments", 24), ring_count=kw.pop("rings", 16), radius=kw.pop("radius", 0.5), **kw)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_segments=kw.pop("major_segments", 48), minor_segments=kw.pop("minor_segments", 16),
                                         major_radius=kw.pop("major_radius", 0.5), minor_radius=kw.pop("minor_radius", 0.1), **kw)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=kw.pop("vertices", 24), radius1=kw.pop("radius1", 0.5), radius2=kw.pop("radius2", 0), depth=kw.pop("depth", 1), **kw)
    ob = bpy.context.active_object
    ob.name = name
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = scale
    ob.data.materials.append(mat)
    if parent is not None:
        ob.parent = parent
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def tube(name, mat, pts, radius, parent=None, res=6, smooth_pts=True):
    """Bevelled curve tube through pts (list of xyz)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY" if not smooth_pts else "NURBS")
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    if smooth_pts:
        sp.use_endpoint_u = True
        sp.order_u = min(4, len(pts))
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def mesh_of_curve(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    mats = [m for m in ob.data.materials]
    parent = ob.parent
    loc, rot = ob.location.copy(), ob.rotation_euler.copy()
    name = ob.name
    bpy.data.objects.remove(ob)
    o2 = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o2)
    for m in mats:
        me.materials.append(m)
    o2.parent = parent
    o2.location, o2.rotation_euler = loc, rot
    for p in me.polygons:
        p.use_smooth = True
    return o2


def realize_all():
    """Convert every curve object to a mesh so the exporter sees plain meshes."""
    for ob in list(bpy.data.objects):
        if ob.type == "CURVE":
            mesh_of_curve(ob)


def export(path, objects=None):
    realize_all()
    bpy.ops.object.select_all(action="DESELECT")
    objs = objects if objects is not None else list(bpy.data.objects)
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=88,
        export_cameras=False, export_lights=False, export_extras=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_animations=False,
        export_draco_mesh_compression_enable=False,
    )
    print("exported", path, "%.1f KB" % (os.path.getsize(path) / 1024))


def rounded_rect(x0, y0, x1, y1, r, seg=6):
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def join(objs, name):
    """Join mesh objects (world transforms preserved) into one."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def tube_mesh(name, mat, pts, radius, res=6, smooth_pts=True):
    return mesh_of_curve(tube(name, mat, pts, radius, res=res, smooth_pts=smooth_pts))


def place(ob, pivot, parent=None):
    """Move the object's origin to `pivot` (world coords) without moving the geometry."""
    from mathutils import Matrix
    ob.data.transform(Matrix.Translation(-Vector(pivot)))
    ob.location = Vector(pivot) - (parent.location if parent is not None else Vector((0, 0, 0)))
    ob.parent = parent
    return ob
