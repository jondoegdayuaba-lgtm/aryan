"""Render a GLB with Cycles for a quick visual check.

    python tools/blender/preview.py ebike/assets/ebike.glb out.png [cx cy cz] [tx ty tz] [size]
"""
import math
import sys

import bpy
from mathutils import Vector

src, out = sys.argv[1], sys.argv[2]
nums = [float(a) for a in sys.argv[3:]]
cam_pos = Vector(nums[0:3]) if len(nums) >= 3 else Vector((2.6, -2.8, 1.5))
target = Vector(nums[3:6]) if len(nums) >= 6 else Vector((0, 0, 0.6))
size = int(nums[6]) if len(nums) >= 7 else 900

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
w = bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.05, 0.07, 0.12, 1)
bg.inputs[1].default_value = 1.0
# floor
bpy.ops.mesh.primitive_plane_add(size=60)
fl = bpy.context.active_object
fm = bpy.data.materials.new("floor")
fm.diffuse_color = (0.08, 0.08, 0.09, 1)
fl.data.materials.append(fm)
for loc, e, col in (((4, -3, 5), 900, (1, 0.9, 0.8)), ((-4, 3, 3), 400, (0.5, 0.7, 1))):
    ld = bpy.data.lights.new("a", "AREA")
    ld.energy = e
    ld.size = 4
    ld.color = col
    lo = bpy.data.objects.new("a", ld)
    sc.collection.objects.link(lo)
    lo.location = loc
    d = (Vector((0, 0, 0.7)) - Vector(loc))
    lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
cd = bpy.data.cameras.new("c")
cd.lens = 45
co = bpy.data.objects.new("c", cd)
sc.collection.objects.link(co)
co.location = cam_pos
co.rotation_euler = (target - cam_pos).to_track_quat("-Z", "Y").to_euler()
sc.camera = co
sc.render.engine = "CYCLES"
sc.cycles.samples = 48
sc.cycles.device = "CPU"
sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = size, int(size * 0.7)
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("rendered", out)
