"""Render quick preview PNGs of an exported GLB (Workbench engine, no GPU needed).
   python3 preview.py wreck [distance] [height] -> writes preview_<name>_<n>.png next to the scratchpad."""
import sys, os, math
import bpy
from mathutils import Vector

name = sys.argv[1]
dist = float(sys.argv[2]) if len(sys.argv) > 2 else 14
height = float(sys.argv[3]) if len(sys.argv) > 3 else 4
out_dir = sys.argv[4] if len(sys.argv) > 4 else '.'
bpy.ops.wm.read_factory_settings(use_empty=True)
here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.import_scene.gltf(filepath=os.path.join(here, '..', '..', 'last-signal', 'models', name + '.glb'))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 24
sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 720, 480
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.72, 0.9, 1); sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.2
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (0.9, 0.2, 0.6); sc.collection.objects.link(sun)
floor = None
# bounds
pts = [o.matrix_world @ Vector(c) for o in sc.objects if o.type == 'MESH' for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (lo + hi) / 2
size = max((hi - lo).x, (hi - lo).y, (hi - lo).z)
print('bounds', [round(v, 2) for v in lo], [round(v, 2) for v in hi])
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 35
for i, ang in enumerate((35, 125, 215)):
    a = math.radians(ang)
    d = dist if dist > 0 else size * 1.5
    cam.location = ctr + Vector((math.cos(a) * d, math.sin(a) * d, height if height else size * 0.5))
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out_dir, f'preview_{name}_{i}.png')
    bpy.ops.render.render(write_still=True)
