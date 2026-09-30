"""
Shared helpers for the Blender scripts (run with the `bpy` Python module or `blender -b -P`).

Coordinate mapping used everywhere: game (x, y, z) -> Blender (x, -z, y).  The glTF exporter then
turns Blender Z-up back into glTF Y-up, so exported models come out in game coordinates.
"""
import math
import os
import sys
import time

import numpy as np

try:
    import bpy
    import bmesh
    import mathutils
except ImportError:      # allow importing for docs / tooling without Blender
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "ski", "assets")
BUILD = os.path.join(HERE, "build")
for d in (BUILD, ASSETS, os.path.join(ASSETS, "models"), os.path.join(ASSETS, "tex")):
    os.makedirs(d, exist_ok=True)
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def game_to_blender(v):
    x, y, z = v
    return (x, -z, y)


def blender_to_game(v):
    x, y, z = v
    return (x, z, -y)


class Timer:
    def __init__(self, label):
        self.label, self.t0 = label, time.time()

    def __enter__(self):
        print(f"[{self.label}] ...", flush=True)
        return self

    def __exit__(self, *exc):
        print(f"[{self.label}] done in {time.time() - self.t0:.1f}s", flush=True)


# ------------------------------------------------------------------------ scene
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


def setup_cycles(samples=64, denoise=True, res=(512, 512), threads=0, noise_threshold=0.0, adaptive=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    cy.samples = samples
    cy.use_adaptive_sampling = adaptive
    if adaptive:
        cy.adaptive_threshold = noise_threshold or 0.02
    cy.use_denoising = denoise
    if denoise:
        try:
            cy.denoiser = 'OPENIMAGEDENOISE'
        except Exception:
            pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.threads_mode = 'AUTO' if threads == 0 else 'FIXED'
    if threads:
        sc.render.threads = threads
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    return sc


def render_to(path, fmt='PNG', color_mode='RGB', depth='8'):
    sc = bpy.context.scene
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.color_mode = color_mode
    if fmt in ('PNG', 'OPEN_EXR'):
        sc.render.image_settings.color_depth = depth
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


# --------------------------------------------------------------------- materials
class Mat:
    """Tiny node-material builder around the Principled BSDF."""

    def __init__(self, name, base=(0.8, 0.8, 0.8, 1.0), rough=0.5, metal=0.0, **inputs):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nodes, self.links = self.nt.nodes, self.nt.links
        self.bsdf = self.nodes['Principled BSDF']
        self.out = self.nodes['Material Output']
        self.set('Base Color', base)
        self.set('Roughness', rough)
        self.set('Metallic', metal)
        for k, v in inputs.items():
            self.set(k.replace('_', ' '), v)

    def set(self, name, value):
        sock = self.bsdf.inputs.get(name)
        if sock is None:
            return
        try:
            sock.default_value = value
        except TypeError:
            sock.default_value = tuple(value)[:len(sock.default_value)]

    def node(self, kind, x=0, y=0, **props):
        n = self.nodes.new(kind)
        n.location = (x, y)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, out, b, inp):
        self.links.new(a.outputs[out], b.inputs[inp])

    def link_bsdf(self, node, out, name):
        self.links.new(node.outputs[out], self.bsdf.inputs[name])


def assign(obj, mat):
    m = mat.mat if isinstance(mat, Mat) else mat
    obj.data.materials.append(m)


# ------------------------------------------------------------------------- meshes
def mesh_from_arrays(name, verts, tris, uv=None, smooth=True):
    """Fast mesh creation from numpy arrays. verts (N,3) float, tris (M,3) int, uv (M,3,2) per-corner."""
    verts = np.asarray(verts, dtype=np.float32)
    tris = np.asarray(tris, dtype=np.int32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    me.loops.add(len(tris) * 3)
    me.loops.foreach_set('vertex_index', tris.ravel())
    me.polygons.add(len(tris))
    me.polygons.foreach_set('loop_start', np.arange(0, len(tris) * 3, 3, dtype=np.int32))
    if uv is not None:
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', np.asarray(uv, dtype=np.float32).reshape(-1))
    me.update()
    me.validate()
    if smooth:
        me.polygons.foreach_set('use_smooth', np.ones(len(tris), dtype=bool))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def grid_triangles(nx, nz):
    """Triangle indices for an (nz, nx) vertex grid laid out row-major (x fastest), facing +Z in Blender."""
    a = (np.arange(nx - 1)[None, :] + nx * np.arange(nz - 1)[:, None]).ravel()
    t1 = np.stack([a, a + 1, a + nx], 1)
    t2 = np.stack([a + 1, a + nx + 1, a + nx], 1)
    return np.concatenate([t1, t2])


def new_object(name, mesh):
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def shade_smooth(ob, angle=None):
    for p in ob.data.polygons:
        p.use_smooth = True


def bmesh_to_object(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return new_object(name, me)


def add_modifier(ob, kind, **props):
    m = ob.modifiers.new(kind.title(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def apply_modifiers(ob):
    select_only([ob])
    for m in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print("modifier apply failed", m.name, e)


def join_objects(objs, name):
    select_only(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


# ---------------------------------------------------------------------- export
def export_glb(path, objs=None, materials=True, tangents=False, draco=False, skins=False,
               animations=False, vertex_colors=False, jpeg=True, jpeg_quality=88):
    kwargs = dict(
        filepath=path, export_format='GLB', use_selection=objs is not None,
        export_apply=not skins, export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=tangents, export_materials='EXPORT' if materials else 'NONE',
        export_cameras=False, export_lights=False, export_extras=False,
        export_skins=skins, export_animations=animations,
        export_draco_mesh_compression_enable=draco,
        export_image_format='JPEG' if jpeg else 'AUTO', export_jpeg_quality=jpeg_quality,
        export_vertex_color='ACTIVE' if vertex_colors else 'NONE',
        export_active_vertex_color_when_no_material=bool(vertex_colors),
    )
    if objs is not None:
        select_only(list(objs))
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(**{k: v for k, v in kwargs.items() if k in props})
    print(f"exported {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def image_to_numpy(img, top_first=True):
    """Blender image -> float32 array (h, w, 4). Row 0 is the TOP row unless top_first=False."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape(h, w, 4)
    return arr[::-1].copy() if top_first else arr


def numpy_to_image(name, arr, colorspace='Non-Color', top_first=True):
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), arr.dtype)], axis=2)
    if top_first:
        arr = arr[::-1]
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.update()
    return img
