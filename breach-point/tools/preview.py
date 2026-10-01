"""Renders Blender assets from a GLB to a PNG with Cycles (CPU) for a quick look.
Usage: python tools/preview.py models.glb out.png asset [asset ...]   (asset = name without _root, e.g. crateS)
Assets are laid out in a row and framed automatically. Needs the bpy module."""
import bpy, math, sys
from mathutils import Vector
glb, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
roots = {o.name.replace('_root', ''): o for o in bpy.data.objects if o.parent is None}
x = 0.0; lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in roots.values():
    o.location = (0, 0, -1000)
for n in names:
    o = roots.get(n)
    if not o:
        print('missing asset', n); continue
    bpy.context.view_layer.update()
    pts = [c.matrix_world @ Vector(v) for c in o.children_recursive if c.type == 'MESH' for v in c.bound_box]
    if not pts: continue
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    w = mx.x - mn.x
    o.location = (x - mn.x + o.location.x, -(mn.y + mx.y) / 2 + o.location.y, -mn.z + o.location.z)
    lo = Vector((min(lo.x, x), min(lo.y, -(mx.y - mn.y) / 2), 0)); hi = Vector((max(hi.x, x + w), max(hi.y, (mx.y - mn.y) / 2), max(hi.z, mx.z - mn.z)))
    x += w + max(0.3, w * 0.25)
ctr = (lo + hi) / 2; rad = (hi - lo).length / 2
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
cam.data.lens = 35; fov = cam.data.angle
view = Vector((0.25, -1.0, 0.45)).normalized()
cam.location = ctr + view * (rad * 2.7 + 0.6)
cam.rotation_euler = (-view).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); bpy.context.scene.collection.objects.link(sun); sun.rotation_euler = (0.7, 0.2, 0.6); sun.data.energy = 4
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.device = 'CPU'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sc.render.resolution_x = 1400; sc.render.resolution_y = 700; sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('wrote', out)
