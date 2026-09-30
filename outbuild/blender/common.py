"""Shared helpers for the Outbuild asset scripts.

Everything is built with bmesh so the scripts run headless:
    python outbuild/blender/build_all.py      (with the `bpy` module installed)

Conventions
-----------
* Blender is Z-up; the glTF exporter converts to Y-up (Blender -Y becomes glTF +Z).
* Characters and props face -Y in Blender, so they face +Z in the game.
* Weapons point their barrel along -Y in Blender (+Z in the game), grip at the origin.
* 1 Blender unit = 1 metre.
* Material names matter: the game swaps them for its own shared materials by name.
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_MODELS = os.path.normpath(os.path.join(HERE, '..', 'assets', 'models'))
OUT_TEX = os.path.normpath(os.path.join(HERE, '..', 'assets', 'textures'))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


# --------------------------------------------------------------------------- materials

_MATS = {}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def material(name, color='#cccccc', rough=0.7, metal=0.0, emit=None, emit_strength=1.0, alpha=1.0):
    """Principled material. `color` is an sRGB hex string."""
    if name in _MATS and _MATS[name].name in bpy.data.materials:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    rgb = hex_color(color) if isinstance(color, str) else color
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        e = hex_color(emit) if isinstance(emit, str) else emit
        bsdf.inputs['Emission Color'].default_value = (*e, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    m.diffuse_color = (*rgb, 1.0)
    _MATS[name] = m
    return m


def clear_material_cache():
    _MATS.clear()


# --------------------------------------------------------------------------- mesh building

class MeshBuilder:
    """Accumulates bmesh geometry with per-face material slots, then makes an object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def mat_index(self, mat):
        if mat is None:
            return 0
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, geom_faces, mat):
        idx = self.mat_index(mat)
        for f in geom_faces:
            f.material_index = idx

    def _new_faces(self, before):
        return [f for f in self.bm.faces if f.index == -1 or f not in before]

    def add_bm(self, other, mat=None, matrix=None):
        """Merge another bmesh into this one."""
        me = bpy.data.meshes.new('tmp')
        other.to_mesh(me)
        if matrix is not None:
            me.transform(matrix)
        before = set(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        idx = self.mat_index(mat)
        for f in self.bm.faces:
            if f not in before:
                f.material_index = idx

    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0, bevel_segs=2):
        b = bmesh.new()
        bmesh.ops.create_cube(b, size=1.0)
        bmesh.ops.scale(b, vec=Vector(size), verts=b.verts)
        if bevel > 0:
            bmesh.ops.bevel(b, geom=b.edges[:] + b.verts[:], offset=bevel, segments=bevel_segs,
                            affect='EDGES', profile=0.5, clamp_overlap=True)
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def cylinder(self, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, segs=12, radius2=None,
                 bevel=0.0, cap=True):
        b = bmesh.new()
        r2 = radius if radius2 is None else radius2
        bmesh.ops.create_cone(b, cap_ends=cap, cap_tris=False, segments=segs, radius1=radius, radius2=r2,
                              depth=depth)
        if bevel > 0:
            rim = [e for e in b.edges if len(e.link_faces) == 2 and
                   abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
            bmesh.ops.bevel(b, geom=rim, offset=bevel, segments=2, affect='EDGES', profile=0.5,
                            clamp_overlap=True)
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def sphere(self, radius, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), mat=None, segs=16, rings=10):
        b = bmesh.new()
        bmesh.ops.create_uvsphere(b, u_segments=segs, v_segments=rings, radius=radius)
        bmesh.ops.scale(b, vec=Vector(scale), verts=b.verts)
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def ico(self, radius, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), mat=None, subdiv=2, jitter=0.0, seed=0):
        import random
        rnd = random.Random(seed)
        b = bmesh.new()
        bmesh.ops.create_icosphere(b, subdivisions=subdiv, radius=radius)
        if jitter:
            for v in b.verts:
                v.co *= 1.0 + (rnd.random() - 0.5) * 2 * jitter
        bmesh.ops.scale(b, vec=Vector(scale), verts=b.verts)
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def torus(self, major, minor, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, segs=16, ring_segs=8):
        b = bmesh.new()
        verts = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring = []
            for j in range(ring_segs):
                t = 2 * math.pi * j / ring_segs
                r = major + minor * math.cos(t)
                ring.append(b.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(t))))
            verts.append(ring)
        for i in range(segs):
            for j in range(ring_segs):
                a = verts[i][j]
                bb = verts[(i + 1) % segs][j]
                c = verts[(i + 1) % segs][(j + 1) % ring_segs]
                d = verts[i][(j + 1) % ring_segs]
                b.faces.new((a, bb, c, d))
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def poly(self, points, mat=None):
        """Add a single n-gon (list of 3D points)."""
        vs = [self.bm.verts.new(p) for p in points]
        f = self.bm.faces.new(vs)
        f.material_index = self.mat_index(mat)
        return f

    def extrude_profile(self, profile2d, depth, axis='x', loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
        """Extrude a closed 2D profile (list of (u, v)) along an axis, centred."""
        b = bmesh.new()
        d = depth / 2
        front, back = [], []
        for (u, v) in profile2d:
            if axis == 'x':
                front.append(b.verts.new((d, u, v)))
                back.append(b.verts.new((-d, u, v)))
            elif axis == 'y':
                front.append(b.verts.new((u, d, v)))
                back.append(b.verts.new((u, -d, v)))
            else:
                front.append(b.verts.new((u, v, d)))
                back.append(b.verts.new((u, v, -d)))
        n = len(profile2d)
        b.faces.new(front)
        b.faces.new(list(reversed(back)))
        for i in range(n):
            j = (i + 1) % n
            b.faces.new((front[i], back[i], back[j], front[j]))
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def lathe(self, profile, segs=16, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, cap_top=True, cap_bottom=True):
        """Revolve a list of (radius, z) points around Z."""
        b = bmesh.new()
        rings = []
        for (r, z) in profile:
            ring = []
            for i in range(segs):
                a = 2 * math.pi * i / segs
                ring.append(b.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
        for k in range(len(rings) - 1):
            for i in range(segs):
                j = (i + 1) % segs
                b.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
        if cap_bottom and profile[0][0] > 1e-4:
            b.faces.new(list(reversed(rings[0])))
        if cap_top and profile[-1][0] > 1e-4:
            b.faces.new(rings[-1])
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
        self.add_bm(b, mat, m)
        b.free()

    def to_object(self, name, smooth=False, auto_smooth_angle=None, collection=None):
        me = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        obj = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(obj)
        if auto_smooth_angle is not None:
            set_smooth_by_angle(obj, auto_smooth_angle)
        return obj


def set_smooth_by_angle(obj, angle_deg=35):
    """Smooth-shade faces, keep edges sharper than the angle hard (split normals)."""
    me = obj.data
    for p in me.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(me)
    thr = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0) < thr
        else:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    me.update()


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def apply_modifiers(obj):
    """Bake all modifiers into the mesh data (headless-safe)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def subdivide(obj, levels=1):
    m = obj.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return apply_modifiers(obj)


def join(objs, name):
    """Join mesh objects into one (keeps materials). The sources are deleted."""
    objs = [o for o in objs if o is not None]
    bm = bmesh.new()
    mats = []
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for p in me.polygons:
            p.material_index = remap[p.material_index] if remap else 0
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    for o in objs:
        old = o.data
        bpy.data.objects.remove(o)
        if old.users == 0:
            bpy.data.meshes.remove(old)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box_uv(obj, scale=1.0, offset=(0.0, 0.0, 0.0)):
    """World-scale box projection UVs: 1 UV unit = 1/scale metres."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    ox, oy, oz = offset
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            x, y, z = l.vert.co.x + ox, l.vert.co.y + oy, l.vert.co.z + oz
            if ax == 0:
                u, v = (y if n.x > 0 else -y), z
            elif ax == 1:
                u, v = (-x if n.y > 0 else x), z
            else:
                u, v = x, (y if n.z > 0 else -y)
            l[uv].uv = (u * scale, v * scale)
    bm.to_mesh(me)
    bm.free()


def set_origin(obj, point):
    """Move the object origin to `point` (world coordinates) without moving geometry."""
    p = Vector(point)
    obj.data.transform(Matrix.Translation(-(p - obj.location)))
    obj.location = p


def vertex_color_ao(obj, strength=0.6, samples=24, dist=0.5, name='AO'):
    """Cheap ambient occlusion baked into a colour attribute by ray casting against the mesh itself."""
    import random
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromBMesh(bm)
    rnd = random.Random(1)
    dirs = []
    while len(dirs) < samples:
        v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        if 0.1 < v.length <= 1:
            dirs.append(v.normalized())
    occ = []
    for v in bm.verts:
        n = v.normal
        hits = 0
        cnt = 0
        for d in dirs:
            if d.dot(n) <= 0:
                d = -d
            cnt += 1
            loc, _, _, _ = tree.ray_cast(v.co + n * 0.01, d, dist)
            if loc is not None:
                hits += 1
        occ.append(1.0 - strength * hits / max(cnt, 1))
    bm.free()
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, 'BYTE_COLOR', 'POINT')
    for i, o in enumerate(occ):
        attr.data[i].color = (o, o, o, 1.0)
    return attr


# --------------------------------------------------------------------------- export

def export_glb(filename, objects, skins=False, colors=False):
    os.makedirs(OUT_MODELS, exist_ok=True)
    path = os.path.join(OUT_MODELS, filename)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        for c in o.children_recursive:
            c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_skins=skins,
        export_morph=False,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE' if colors else 'NONE',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=colors,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_extras=True,
        export_image_format='NONE',
    )
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')
    return path


def render_preview(path, objects=None, cam_loc=(3, -4, 2.5), target=(0, 0, 1), size=(640, 640), samples=24,
                   lens=50, sun_rot=(0.9, 0.2, 0.6), world='#9ab8d8'):
    """Quick Cycles preview for checking models without a GPU."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    if not sc.world:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (*hex_color(world), 1)
    bg.inputs[1].default_value = 0.8
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    cam.location = cam_loc
    d = Vector(target) - Vector(cam_loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sun_d = bpy.data.lights.new('sun', 'SUN')
    sun_d.energy = 3.5
    sun_d.angle = 0.08
    sun = bpy.data.objects.new('sun', sun_d)
    sun.rotation_euler = sun_rot
    sc.collection.objects.link(sun)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)
