"""Shared helpers for the Last Signal model scripts.

Run any build script with the pip-installed Blender module:
    pip install bpy==5.0.1
    python3 tools/blender/build_all.py

Models are exported as GLB with geometry, UVs (1 unit = 1 metre so tiling textures keep their
scale), material *names* and a baked-looking ambient-occlusion vertex colour. The game supplies
the actual textures for each material name, so the files stay small.
"""
import math
import os
import random
import bpy
import bmesh
from mathutils import Vector, Matrix

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'last-signal', 'models')


def reset():
    _mats.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


_mats = {}


def material(name, color=(0.5, 0.5, 0.5, 1.0), rough=0.8, metal=0.0):
    """One named material per surface type; the game replaces them by name."""
    if name in _mats and _mats[name].name in bpy.data.materials:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    _mats[name] = m
    return m


def new_obj(name, bm, mat=None, loc=(0, 0, 0), smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if mesh.color_attributes:
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
    obj.location = loc
    if mat is not None:
        obj.data.materials.append(mat)
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    return obj


def box_uv(bm, scale=1.0, layer='UVMap'):
    """Box-projected UVs in metres (times `scale`), so wood, metal and stone tile at real size."""
    uv = bm.loops.layers.uv.get(layer) or bm.loops.layers.uv.new(layer)
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = l.vert.co
            if ax == 0:
                l[uv].uv = (p.y * scale, p.z * scale)
            elif ax == 1:
                l[uv].uv = (p.x * scale, p.z * scale)
            else:
                l[uv].uv = (p.x * scale, p.y * scale)


def set_ao(bm, fn, name='AO'):
    """fn(vertex_position, normal) -> brightness 0..1.5 written to the colour attribute."""
    layer = bm.loops.layers.float_color.get(name) or bm.loops.layers.float_color.new(name)
    for f in bm.faces:
        for l in f.loops:
            v = l.vert
            k = fn(v.co, v.normal)
            l[layer] = (k, k, k, 1.0)


def cube_bm(size=(1, 1, 1), loc=(0, 0, 0), bm=None, bevel=0.0, rot=None):
    """A box appended to bm (creates one if needed); size is full extents."""
    bm = bm or bmesh.new()
    n0 = len(bm.verts)
    bmesh.ops.create_cube(bm, size=1.0)
    verts = bm.verts[n0:]
    m = Matrix.Translation(loc)
    if rot:
        m = m @ Matrix.Rotation(rot[0], 4, 'Z') if isinstance(rot, tuple) else m @ rot
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    if bevel > 0:
        edges = {e for v in verts for e in v.link_edges}
        bmesh.ops.bevel(bm, geom=list(verts) + list(edges), offset=bevel, segments=2, affect='EDGES')
    return bm


def cylinder_bm(r0, r1, length, segs=8, loc=(0, 0, 0), axis='Z', bm=None, cap=True):
    """Tapered cylinder from r0 (base) to r1 (tip) along `axis` (X, Y or Z), centred at loc."""
    bm = bm or bmesh.new()
    n0 = len(bm.verts)
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=length)
    verts = bm.verts[n0:]
    m = Matrix.Translation(loc)
    if axis == 'X':
        m = m @ Matrix.Rotation(math.radians(90), 4, 'Y')
    elif axis == 'Y':
        m = m @ Matrix.Rotation(math.radians(-90), 4, 'X')
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    return bm


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def empty(name, loc=(0, 0, 0), kind='PLAIN_AXES', size=0.2, props=None, rot=None, scale=None):
    """A marker node the game reads: anchors, colliders (COL_*), interaction spots."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = loc
    if rot:
        e.rotation_euler = rot
    if scale:
        e.scale = scale
    for k, v in (props or {}).items():
        e[k] = v
    bpy.context.scene.collection.objects.link(e)
    return e


def collider_box(name, center, size, yaw=0.0):
    """Invisible collision box: a unit-cube empty scaled to `size` (full extents)."""
    return empty('COL_' + name, center, 'CUBE', 0.5, rot=(0, 0, yaw), scale=(size[0], size[1], size[2]))


def export(name, objs=None, animations=False):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for o in (objs if objs is not None else bpy.context.scene.objects):
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_image_format='NONE',
        export_extras=True, export_animations=animations, export_cameras=False, export_lights=False,
    )
    print(f'{name}.glb  {os.path.getsize(path) / 1024:.0f} KB')
    return path


def rng(seed):
    return random.Random(seed)
