"""Render a contact sheet of models with Cycles, for checking shapes and colours.
  python preview.py out.png module [module ...]   (each module needs build() -> {name: obj})"""
import importlib
import math
import sys

import bpy
from mathutils import Vector

import common


def show_vertex_colors():
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        p = nt.nodes.get('Principled BSDF')
        if not p or p.inputs['Base Color'].is_linked:
            continue
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Color'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        mix.inputs[6].default_value = p.inputs['Base Color'].default_value
        nt.links.new(attr.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], p.inputs['Base Color'])


def contact_sheet(objs, out, cols=6, res=(1600, 1000), view='front'):
    scene = bpy.context.scene
    tops = [o for o in objs if o.parent is None]
    sizes = []
    for o in tops:
        pts = []
        for c in [o] + list(o.children_recursive):
            if c.type == 'MESH':
                pts += [c.matrix_world @ Vector(b) for b in c.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        sizes.append((lo, hi))
    cell = 1.0
    rows = math.ceil(len(tops) / cols)
    for k, (o, (lo, hi)) in enumerate(zip(tops, sizes)):
        ext = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
        s = 0.8 / ext
        o.scale = (s, s, s) if o.scale.x == 1 else o.scale
        c = (lo + hi) / 2
        r, col = divmod(k, cols)
        o.location = Vector((col * cell * 1.2, 0, -r * cell * 1.1)) - Vector((c.x, c.y, c.z)) * s
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(cols * 1.2, rows * 1.1 * res[0] / res[1]) * 1.02
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cx = (cols - 1) * 1.2 / 2
    cz = -(rows - 1) * 1.1 / 2
    cam.location = {'front': (cx + 6, -20, cz + 8), 'side': (cx + 30, 0, cz + 6), 'top': (cx, -3, cz + 30)}[view]
    if view != 'front':
        # Turn each model so the requested view looks at it in the X-Z sheet plane.
        for o in tops:
            if view == 'side':
                o.rotation_euler = (0, 0, math.radians(90))
            else:
                o.rotation_euler = (math.radians(90), 0, 0)
        cam.location = (cx + 2, -20, cz + 2)
    d = Vector((cx, 0, cz)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(40), math.radians(20), math.radians(-30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.4, 0.45, 1)
    scene.world = world
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.cycles.samples = 24
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = out
    show_vertex_colors()
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    out = args.pop(0)
    view = 'front'
    cols = 6
    if args[0] in ('front', 'side', 'top'):
        view = args.pop(0)
    if args[0].startswith('cols='):
        cols = int(args.pop(0)[5:])
    common.reset_scene()
    objs = []
    for mod in args:
        name, _, fn = mod.partition(':')
        result = getattr(importlib.import_module(name), fn or 'build')()
        objs += list(result.values()) if isinstance(result, dict) else [result]
    contact_sheet(objs, out, cols=cols, view=view)
