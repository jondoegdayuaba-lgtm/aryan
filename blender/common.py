# Shared helpers for the Blender build scripts: materials, a mesh builder that
# assigns materials and bone weights as it goes, armatures and glTF export.
#
# Coordinates are Blender's: Z up, characters face -Y, a character's left is +X.
# glTF export turns that into three.js space (Y up, facing +Z).
import bpy
import bmesh
import math
import os
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'western', 'assets')
TEXTURES = os.path.join(ASSETS, 'textures')
RENDERS = os.path.join(ROOT, 'blender', 'renders')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    scene = bpy.context.scene
    scene.render.fps = 30
    return scene


def srgb(hexstr):
    """'#rrggbb' in sRGB -> linear RGB tuple, which is what Blender stores."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


_mats = {}


def mat(name, color='#ffffff', rough=0.85, metal=0.0, emit=None, emit_strength=1.0,
        image=None, double=False, alpha_clip=False):
    """Principled material, cached by name. The glTF exporter turns base colour,
    roughness, metallic, emission and an image texture into glTF PBR values."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(color), 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if image:
        img = image if isinstance(image, bpy.types.Image) else bpy.data.images.load(image, check_existing=True)
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_clip:
            m.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
    m.use_backface_culling = not double
    m.diffuse_color = (*srgb(color), 1)
    _mats[name] = m
    return m


def frame_from(direction, ref=Vector((0, -1, 0))):
    """Orthonormal (u, v, d) with d along `direction` and v as close to `ref` as possible."""
    d = Vector(direction).normalized()
    r = Vector(ref)
    if abs(d.dot(r.normalized())) > 0.98:
        r = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    v = (r - d * r.dot(d)).normalized()
    u = v.cross(d).normalized()
    return u, v, d


def look_matrix(p0, p1, ref=Vector((0, -1, 0))):
    """Matrix that maps local +Z onto the segment p0->p1, placed at its midpoint."""
    p0, p1 = Vector(p0), Vector(p1)
    u, v, d = frame_from(p1 - p0, ref)
    m = Matrix((u, v, d)).transposed().to_4x4()
    m.translation = (p0 + p1) / 2
    return m


def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    from mathutils import Euler
    return (Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
            @ Matrix.Diagonal(Vector((*scale, 1))))


class Builder:
    """Collects primitives into one bmesh, remembering a material slot and bone
    weights for each, then turns the lot into a single object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.groups = []
        self.dl = self.bm.verts.layers.deform.verify()
        self.uvl = self.bm.loops.layers.uv.verify()

    # -- bookkeeping ---------------------------------------------------------
    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _gi(self, g):
        if g not in self.groups:
            self.groups.append(g)
        return self.groups.index(g)

    def _finish(self, verts, material, bone, smooth=True, uv=None, deform=None):
        if deform:
            for v in verts:
                v.co = deform(v.co.copy())
            self.bm.normal_update()
        faces = {f for v in verts for f in v.link_faces}
        mi = self._mi(material)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
        self.weight(verts, bone)
        if uv:
            self.box_uv(faces, uv)
        return verts

    def weight(self, verts, bone):
        if not bone:
            return
        for v in verts:
            if callable(bone):
                ws = bone(v.co)
            elif isinstance(bone, dict):
                ws = bone
            else:
                ws = {bone: 1.0}
            total = sum(ws.values()) or 1
            for b, w in ws.items():
                if w > 0:
                    v[self.dl][self._gi(b)] = w / total

    def box_uv(self, faces, tile):
        """World-space box projection: one texture repeat per `tile` metres."""
        self.bm.normal_update()
        for f in faces:
            n = f.normal if f.normal.length > 0 else Vector((0, 0, 1))
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                c = loop.vert.co
                if ax == 0:
                    uv = (c.y * (1 if n.x > 0 else -1), c.z)
                elif ax == 1:
                    uv = (c.x * (-1 if n.y > 0 else 1), c.z)
                else:
                    uv = (c.x, c.y)
                loop[self.uvl].uv = (uv[0] / tile, uv[1] / tile)

    # -- primitives ----------------------------------------------------------
    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), material=None, bone=None,
            smooth=False, uv=None, deform=None, matrix=None):
        m = matrix if matrix is not None else trs(loc, rot, size)
        if matrix is not None:
            m = matrix @ Matrix.Diagonal(Vector((*size, 1)))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)['verts']
        self.bm.normal_update()
        return self._finish(verts, material, bone, smooth, uv, deform)

    def ball(self, radii, loc=(0, 0, 0), rot=(0, 0, 0), material=None, bone=None,
             seg=12, rings=8, smooth=True, deform=None, uv=None):
        r = radii if isinstance(radii, (tuple, list)) else (radii,) * 3
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0,
                                          matrix=trs(loc, rot, r))['verts']
        self.bm.normal_update()
        return self._finish(verts, material, bone, smooth, uv, deform)

    def ico(self, radius, loc=(0, 0, 0), scale=(1, 1, 1), material=None, bone=None, subdiv=1,
            smooth=False, deform=None, rot=(0, 0, 0)):
        verts = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=radius,
                                           matrix=trs(loc, rot, scale))['verts']
        self.bm.normal_update()
        return self._finish(verts, material, bone, smooth, None, deform)

    def cyl(self, p0, p1, r0, r1=None, material=None, bone=None, seg=10, cap=True,
            smooth=True, ref=Vector((0, -1, 0)), squash=1.0, uv=None, deform=None):
        r1 = r0 if r1 is None else r1
        p0, p1 = Vector(p0), Vector(p1)
        m = look_matrix(p0, p1, ref) @ Matrix.Diagonal(Vector((1, squash, 1, 1)))
        verts = bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=seg,
                                      radius1=r0, radius2=r1, depth=(p1 - p0).length, matrix=m)['verts']
        self.bm.normal_update()
        return self._finish(verts, material, bone, smooth, uv, deform)

    def tube(self, path, radii, material=None, bone=None, seg=12, caps=(True, True),
             smooth=True, ref=Vector((0, -1, 0)), arc=None, uv=None):
        """Loft through `path` points with elliptical rings. radii[i] = (side, front).
        `arc` = (a0, a1) leaves the tube open outside that angle range (radians,
        0 = side +u, pi/2 = front +v)."""
        bm = self.bm
        rings = []
        n = len(path)
        for i, (c, (ra, rb)) in enumerate(zip(path, radii)):
            c = Vector(c)
            if i == 0:
                d = Vector(path[1]) - c
            elif i == n - 1:
                d = c - Vector(path[i - 1])
            else:
                d = Vector(path[i + 1]) - Vector(path[i - 1])
            u, v, _ = frame_from(d, ref)
            ring = []
            count = seg if arc is None else seg + 1
            for j in range(count):
                if arc is None:
                    a = 2 * math.pi * j / seg
                else:
                    a = arc[0] + (arc[1] - arc[0]) * j / seg
                ring.append(bm.verts.new(c + u * (ra * math.cos(a)) + v * (rb * math.sin(a))))
            rings.append(ring)
        cols = len(rings[0]) if arc is not None else seg
        faces = []
        for i in range(n - 1):
            a, b = rings[i], rings[i + 1]
            for j in range(cols - (1 if arc is not None else 0)):
                k = (j + 1) % len(a)
                faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
        if arc is None:
            if caps[0]:
                faces.append(bm.faces.new(list(reversed(rings[0]))))
            if caps[-1]:
                faces.append(bm.faces.new(rings[-1]))
        bm.normal_update()
        verts = [v for r in rings for v in r]
        return self._finish(verts, material, bone, smooth, uv)

    def poly(self, pts, material=None, bone=None, smooth=False, uv=None):
        verts = [self.bm.verts.new(Vector(p)) for p in pts]
        self.bm.faces.new(verts)
        self.bm.normal_update()
        return self._finish(verts, material, bone, smooth, uv)

    def ribbon(self, pts, width, normal_fn, material=None, bone=None, thick=0.006):
        """Flat strap along `pts`; normal_fn(p) gives the surface normal to sit on."""
        bm = self.bm
        left, right = [], []
        for i, p in enumerate(pts):
            p = Vector(p)
            d = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
            nrm = Vector(normal_fn(p)).normalized()
            side = d.cross(nrm).normalized() * (width / 2)
            off = nrm * thick
            left.append(bm.verts.new(p + side + off))
            right.append(bm.verts.new(p - side + off))
        for i in range(len(pts) - 1):
            bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
        bm.normal_update()
        return self._finish(left + right, material, bone, False)

    # -- output --------------------------------------------------------------
    def build(self, collection=None, rig=None, recalc=False):
        bm = self.bm
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        for g in self.groups:
            ob.vertex_groups.new(name=g)
        if rig is not None:
            ob.parent = rig
            mod = ob.modifiers.new('Armature', 'ARMATURE')
            mod.object = rig
        return ob


def new_collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def make_armature(name, bones, collection=None, mode='XYZ'):
    """bones: list of (name, head, tail, parent, roll_ref). roll_ref is the
    direction the bone's local Z axis should face."""
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    (collection or bpy.context.scene.collection).objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    for o in bpy.context.selected_objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, head, tail, parent, ref in bones:
        b = arm.edit_bones.new(bname)
        b.head, b.tail = Vector(head), Vector(tail)
        b.align_roll(Vector(ref))
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = mode
    return rig


def attach_to_bone(ob, rig, bone, world_matrix):
    ob.parent = rig
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    bpy.context.view_layer.update()
    ob.matrix_world = world_matrix


class Animator:
    """Writes one action per call to `clip`: pose(frame, t) sets bone values,
    every listed bone gets keyed on every `step` frames."""

    def __init__(self, rig):
        self.rig = rig
        rig.animation_data_create()

    def rest(self):
        for pb in self.rig.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_euler = (0, 0, 0)
            pb.scale = (1, 1, 1)

    def clip(self, name, frames, pose, bones=None, step=1, keys=('rotation_euler', 'location')):
        rig = self.rig
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        names = bones or [b.name for b in rig.pose.bones]
        f = 0
        while True:
            self.rest()
            pose(rig.pose.bones, f / max(frames, 1), f)
            for n in names:
                pb = rig.pose.bones[n]
                for k in keys:
                    pb.keyframe_insert(k, frame=f, group=n)
            if f >= frames:
                break
            f = min(f + step, frames)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, act)
        track.mute = True
        rig.animation_data.action = None
        self.rest()
        return act


def select_only(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)


def export_glb(path, objs, animations=False):
    """Export only `objs` (and nothing else) as a binary glTF."""
    select_only(objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True,
                  export_apply=True, export_yup=True, export_texcoords=True,
                  export_normals=True, export_cameras=False, export_lights=False,
                  export_extras=True)
    if animations:
        kwargs.update(export_animations=True, export_animation_mode='ACTIONS',
                      export_skins=True, export_force_sampling=True,
                      export_def_bones=False, export_optimize_animation_size=True)
    else:
        kwargs.update(export_animations=False, export_skins=False)
    bpy.ops.export_scene.gltf(**kwargs)
    print(f'  wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)')


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))
