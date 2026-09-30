"""Builds the Wheelie Life sport bike and rider in Blender (headless) and
  1. exports the parts to wheelie-life/assets/bike.json (loaded by the game), and
  2. renders a Cycles hero image to wheelie-life/assets/hero.jpg.

    pip install bpy==4.2.0
    python3 tools/blender/build_bike.py [--no-render] [--samples 64]

Blender axes: +Y forward, +Z up. Exported coordinates are converted to three.js
(x, z, -y) and are relative to the rear axle, so the game can pivot the whole
bike around the rear axle for a wheelie.
"""
import base64, json, math, os, sys
import bpy, bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'wheelie-life', 'assets')
os.makedirs(OUT, exist_ok=True)

RA = Vector((0, -0.72, 0.32))   # rear axle
FA = Vector((0, 0.73, 0.32))    # front axle

# name: (rgba, metallic, roughness, extras)
MATS = {
    'paint':    ((0.55, 0.02, 0.02, 1), 0.6, 0.18, {'clearcoat': 1.0}),
    'paint2':   ((0.02, 0.02, 0.025, 1), 0.5, 0.25, {'clearcoat': 1.0}),
    'steel':    ((0.75, 0.75, 0.78, 1), 1.0, 0.28, {}),
    'darkmetal':((0.05, 0.05, 0.055, 1), 0.9, 0.42, {}),
    'chrome':   ((0.9, 0.9, 0.92, 1), 1.0, 0.08, {}),
    'rubber':   ((0.012, 0.012, 0.012, 1), 0.0, 0.85, {}),
    'seat':     ((0.02, 0.02, 0.02, 1), 0.0, 0.6, {}),
    'glass':    ((0.6, 0.75, 0.85, 1), 0.0, 0.03, {'alpha': 0.28}),
    'lamp':     ((1, 0.95, 0.8, 1), 0.0, 0.05, {'emissive': [1, 0.93, 0.75], 'emissiveIntensity': 1.5}),
    'taillamp': ((0.8, 0.02, 0.02, 1), 0.0, 0.2, {'emissive': [1, 0.05, 0.05], 'emissiveIntensity': 1.2}),
    'leather':  ((0.03, 0.03, 0.035, 1), 0.0, 0.42, {}),
    'suitred':  ((0.5, 0.02, 0.02, 1), 0.0, 0.45, {}),
    'helmet':   ((0.9, 0.9, 0.92, 1), 0.2, 0.1, {'clearcoat': 1.0}),
    'visor':    ((0.02, 0.03, 0.05, 1), 0.9, 0.02, {}),
}

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

bpy_mats = {}
for name, (col, met, rough, ex) in MATS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = col
    b.inputs['Metallic'].default_value = met
    b.inputs['Roughness'].default_value = rough
    if 'clearcoat' in ex:
        b.inputs['Coat Weight'].default_value = ex['clearcoat']
        b.inputs['Coat Roughness'].default_value = 0.03
    if 'alpha' in ex:
        b.inputs['Alpha'].default_value = ex['alpha']
    if 'emissive' in ex:
        b.inputs['Emission Color'].default_value = (*ex['emissive'], 1)
        b.inputs['Emission Strength'].default_value = ex['emissiveIntensity'] * 3
    bpy_mats[name] = m

parts = {'body': [], 'wheelF': [], 'wheelR': []}


def finish(obj, mat, part='body', smooth=True, subsurf=0, bevel=0.0):
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(bpy_mats[mat])
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    if bevel:
        m = obj.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = 3
        m.limit_method = 'ANGLE'
    if subsurf:
        m = obj.modifiers.new('sub', 'SUBSURF')
        m.levels = subsurf
        m.render_levels = subsurf
    parts[part].append((obj, mat))
    return obj


def sphere(c, s, mat, **kw):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=c)
    o = bpy.context.object
    o.scale = s
    return finish(o, mat, **kw)


def box(c, s, mat, rot=(0, 0, 0), **kw):
    bpy.ops.mesh.primitive_cube_add(location=c, rotation=rot)
    o = bpy.context.object
    o.scale = s
    kw.setdefault('bevel', 0.02)
    kw.setdefault('subsurf', 1)
    return finish(o, mat, **kw)


def limb(a, b, r, mat, r2=None, **kw):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r, radius2=r2 if r2 is not None else r,
                                    depth=d.length, location=(a + b) / 2)
    o = bpy.context.object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(o, mat, **kw)


def wheel(center, part):
    c = Vector(center)
    def torus(major, minor, mat, sx=1.0, **kw):
        bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                         major_segments=64, minor_segments=20, location=c,
                                         rotation=(0, math.pi / 2, 0))
        o = bpy.context.object
        o.scale = (sx, 1, 1)  # local x = axle axis after rotation? torus axis is Z, rotated to X
        return finish(o, mat, part=part, **kw)
    tire = torus(0.275, 0.048, 'rubber')
    tire.scale = (1.0, 1.0, 1.0)
    torus(0.228, 0.014, 'chrome')
    # brake disc
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.15, depth=0.008,
                                        location=c + Vector((0.03, 0, 0)), rotation=(0, math.pi / 2, 0))
    finish(bpy.context.object, 'steel', part=part)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.035, depth=0.14, location=c,
                                        rotation=(0, math.pi / 2, 0))
    finish(bpy.context.object, 'chrome', part=part)
    for i in range(5):  # spokes: Y-shaped alloy
        a = i * math.tau / 5
        for off in (-0.05, 0.05):
            aa = a + off
            p0 = c + Vector((0, math.cos(a) * 0.04, math.sin(a) * 0.04))
            p1 = c + Vector((0, math.cos(aa) * 0.225, math.sin(aa) * 0.225))
            limb(p0, p1, 0.011, 'darkmetal', part=part, smooth=True)


# ---- wheels ---------------------------------------------------------------
wheel(RA, 'wheelR')
wheel(FA, 'wheelF')

# ---- chassis --------------------------------------------------------------
steer_top = FA + Vector((0, -0.75 * math.sin(math.radians(26)), 0.75 * math.cos(math.radians(26))))
for x in (-0.09, 0.09):
    limb(FA + Vector((x, 0, 0)), steer_top + Vector((x, 0, 0)) - Vector((0, -0.03, 0.05)),
         0.021, 'chrome', r2=0.026)
    limb(FA + Vector((x, 0, 0.0)), FA + Vector((x, 0.0, 0.32)) + Vector((0, -0.14, 0.0)), 0.03, 'darkmetal')
    # front brake caliper
box(FA + Vector((0.055 if x > 0 else -0.055, 0.14, 0.05)), (0.025, 0.05, 0.06), 'paint2')
# front fender
box(FA + Vector((0, 0.03, 0.36)), (0.06, 0.2, 0.012), 'paint', rot=(math.radians(-8), 0, 0), subsurf=1)
# triple clamp + handlebar
box(steer_top, (0.11, 0.05, 0.03), 'darkmetal')
limb((-0.32, 0.36, 1.06), (0.32, 0.36, 1.06), 0.012, 'chrome')
for x in (-1, 1):
    limb((x * 0.30, 0.36, 1.06), (x * 0.40, 0.33, 1.045), 0.017, 'rubber')
    limb((x * 0.05, 0.36, 1.06), (x * 0.26, 0.34, 1.12), 0.008, 'darkmetal')  # brake lever
    limb((x * 0.31, 0.42, 1.12), (x * 0.33, 0.38, 1.22), 0.006, 'darkmetal')  # mirror stalk
    box((x * 0.34, 0.37, 1.235), (0.055, 0.02, 0.035), 'chrome')

# fairing, screen, headlamp
sphere((0, 0.55, 0.94), (0.17, 0.24, 0.14), 'paint', subsurf=0)
sphere((0, 0.42, 1.10), (0.16, 0.16, 0.13), 'glass', subsurf=0)
sphere((0, 0.72, 0.95), (0.08, 0.05, 0.06), 'lamp')
for x in (-1, 1):
    sphere((x * 0.16, 0.6, 0.86), (0.05, 0.13, 0.05), 'paint2')

# tank / seat / tail
sphere((0, 0.12, 1.0), (0.17, 0.30, 0.12), 'paint', subsurf=0)
box((0, -0.33, 0.93), (0.15, 0.30, 0.045), 'seat')
box((0, -0.80, 0.97), (0.085, 0.24, 0.05), 'paint', rot=(math.radians(6), 0, 0), bevel=0.03, subsurf=2)
box((0, -1.08, 1.0), (0.09, 0.03, 0.03), 'taillamp')
sphere((0, -1.05, 0.62), (0.02, 0.11, 0.05), 'paint2')  # license plate mount

# engine, frame, swingarm, exhaust
box((0, 0.02, 0.55), (0.14, 0.26, 0.17), 'darkmetal', bevel=0.06, subsurf=2)
for i in range(5):
    box((0, 0.22, 0.42 + i * 0.045), (0.14, 0.08, 0.01), 'steel', subsurf=0, bevel=0.005)
sphere((0, -0.05, 0.62), (0.13, 0.12, 0.12), 'darkmetal', subsurf=0)
for x in (-1, 1):
    limb((x * 0.13, 0.3, 0.98), (x * 0.14, -0.35, 0.78), 0.02, 'steel')          # frame spar
    limb((x * 0.11, -0.05, 0.36), RA + Vector((x * 0.075, 0, 0)), 0.03, 'steel')  # swingarm
    limb((x * 0.13, -0.05, 0.44), (x * 0.09, -0.62, 0.75), 0.02, 'darkmetal')      # rear shock
# exhaust
limb((0.13, 0.28, 0.36), (0.13, -0.12, 0.30), 0.04, 'chrome')
limb((0.14, -0.12, 0.30), (0.17, -0.98, 0.50), 0.055, 'chrome', r2=0.05)
sphere((0.17, -0.99, 0.50), (0.048, 0.02, 0.048), 'darkmetal', subsurf=0)
# chain
limb((0.085, -0.05, 0.36), RA + Vector((0.085, 0, 0.0)), 0.006, 'darkmetal')

# ---- rider ----------------------------------------------------------------
hips = (0, -0.45, 1.0)
shoulders = (0, 0.06, 1.36)
limb(hips, shoulders, 0.12, 'suitred', r2=0.145)
sphere((0, 0.0, 1.31), (0.16, 0.10, 0.11), 'leather', subsurf=0)  # back hump
sphere(hips, (0.17, 0.14, 0.13), 'leather')
sphere((0, 0.15, 1.52), (0.15, 0.19, 0.16), 'helmet', subsurf=0)   # helmet
sphere((0, 0.27, 1.515), (0.105, 0.075, 0.062), 'visor', subsurf=0)   # visor
for x in (-1, 1):
    limb((x * 0.20, 0.06, 1.36), (x * 0.30, 0.22, 1.19), 0.05, 'suitred', r2=0.042)   # upper arm
    limb((x * 0.30, 0.22, 1.19), (x * 0.36, 0.37, 1.07), 0.042, 'leather', r2=0.035)  # forearm
    sphere((x * 0.36, 0.37, 1.06), (0.05, 0.06, 0.045), 'leather')                    # glove
    sphere((x * 0.20, 0.06, 1.36), (0.07, 0.07, 0.07), 'suitred')                     # shoulder
    limb((x * 0.16, -0.45, 1.0), (x * 0.22, 0.08, 0.86), 0.085, 'leather', r2=0.06)   # thigh
    limb((x * 0.22, 0.08, 0.86), (x * 0.21, -0.14, 0.44), 0.058, 'leather', r2=0.045)  # shin
    sphere((x * 0.22, 0.08, 0.86), (0.07, 0.07, 0.07), 'suitred')                     # knee slider
    box((x * 0.21, -0.08, 0.40), (0.05, 0.12, 0.05), 'seat')                          # boot
    sphere((x * 0.21, 0.02, 0.38), (0.05, 0.06, 0.04), 'darkmetal')                   # boot toe


# ---- export ---------------------------------------------------------------
def b64(arr):
    import array
    a = array.array('f', arr)
    return base64.b64encode(a.tobytes()).decode()


def to_three(v):
    return (v.x, v.z, -v.y)


def export():
    dg = bpy.context.evaluated_depsgraph_get()
    pivots = {'body': RA, 'wheelR': Vector((0, 0, 0)), 'wheelF': FA - RA}
    out = {'materials': {n: {'color': list(c[:3]), 'metalness': m, 'roughness': r, **e}
                         for n, (c, m, r, e) in MATS.items()},
           'parts': []}
    for name, items in parts.items():
        by_mat = {}
        pivot_world = {'body': RA, 'wheelR': RA, 'wheelF': FA}[name]
        for obj, mat in items:
            ev = obj.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            nrm = me.corner_normals
            mw = obj.matrix_world
            nm = mw.to_3x3().inverted().transposed()
            pos, nor = by_mat.setdefault(mat, ([], []))
            for tri in me.loop_triangles:
                for li in tri.loops:
                    v = mw @ me.vertices[me.loops[li].vertex_index].co - pivot_world
                    n = (nm @ nrm[li].vector).normalized()
                    pos.extend(to_three(v))
                    nor.extend(to_three(n))
            ev.to_mesh_clear()
        out['parts'].append({
            'name': name,
            'pivot': list(to_three(pivots[name])),
            'meshes': [{'material': m, 'position': b64(p), 'normal': b64(n), 'count': len(p) // 3}
                       for m, (p, n) in by_mat.items()],
        })
    path = os.path.join(OUT, 'bike.json')
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    tris = sum(m['count'] for p in out['parts'] for m in p['meshes']) // 3
    print(f'bike.json: {os.path.getsize(path) / 1024:.0f} KB, {tris} triangles')


export()

# ---- side-view sprites for the 2D game ------------------------------------
if '--sprites' in sys.argv:
    from mathutils import Euler
    SPR = os.path.join(ROOT, 'wheelie-life-2d', 'assets')
    os.makedirs(SPR, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(sys.argv[sys.argv.index('--samples') + 1]) if '--samples' in sys.argv else 96
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.4
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    world = bpy.data.worlds.new('sky'); sc.world = world; world.use_nodes = True
    sky = world.node_tree.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'; sky.sun_elevation = math.radians(20); sky.sun_disc = False
    world.node_tree.links.new(sky.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.0; sun.color = (1.0, 0.88, 0.72); sun.angle = math.radians(3)
    so = bpy.data.objects.new('sun', sun); bpy.context.collection.objects.link(so)
    so.location = (5, -2.5, 6)
    so.rotation_euler = (Vector((0, 0, 0.8)) - so.location).to_track_quat('-Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cd); bpy.context.collection.objects.link(cam)
    sc.camera = cam
    cam.rotation_euler = Euler((math.pi / 2, 0, math.pi / 2))  # looks along -X, image right = +Y (bike front)

    def shoot(name, cx, cz, width_m, px_w, px_h, show):
        for part, items in parts.items():
            for obj, _ in items:
                obj.hide_render = part not in show
        cd.ortho_scale = width_m
        cam.location = (12, cx, cz)
        sc.render.resolution_x, sc.render.resolution_y = px_w, px_h
        sc.render.filepath = os.path.join(SPR, name + '.png')
        bpy.ops.render.render(write_still=True)

    W, H, CY, CZ, WM = 2000, 1250, 0.0, 0.88, 3.2   # 625 px per metre
    shoot('body', CY, CZ, WM, W, H, {'body'})
    shoot('wheel', RA.y, RA.z, 0.8, 500, 500, {'wheelR'})
    ppm = W / WM
    meta = {'ppm': ppm, 'body': {'w': W, 'h': H,
            'axleX': W / 2 + (RA.y - CY) * ppm, 'axleY': H / 2 - (RA.z - CZ) * ppm},
            'wheel': {'w': 500, 'h': 500, 'radius_m': 0.32}, 'wheelbase_m': FA.y - RA.y}
    json.dump(meta, open(os.path.join(SPR, 'sprites.json'), 'w'), indent=1)
    print('sprites done', meta)
    sys.exit(0)

# ---- hero render ----------------------------------------------------------
if '--no-render' in sys.argv:
    sys.exit(0)
samples = int(sys.argv[sys.argv.index('--samples') + 1]) if '--samples' in sys.argv else 64

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.view_settings.exposure = -1.3

# tilt the bike into a wheelie about the rear axle for the hero shot
pitch = math.radians(32)
for name, items in parts.items():
    for obj, _ in items:
        obj.location = obj.location  # noqa (keep)
pivot_empty = bpy.data.objects.new('pivot', None)
bpy.context.collection.objects.link(pivot_empty)
pivot_empty.location = RA
for items in parts.values():
    for obj, _ in items:
        obj.parent = pivot_empty
        obj.matrix_parent_inverse = pivot_empty.matrix_world.inverted()
pivot_empty.rotation_euler = (pitch, 0, 0)  # lift the nose
bpy.context.view_layer.update()

# spin the front wheel slightly is unnecessary; add asphalt ground with roughness variation
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
gp = bpy.context.object
gm = bpy.data.materials.new('asphalt')
gm.use_nodes = True
nt = gm.node_tree
bsdf = nt.nodes['Principled BSDF']
noise = nt.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 1400
noise.inputs['Detail'].default_value = 8
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.035, 0.035, 0.037, 1)
ramp.color_ramp.elements[1].color = (0.11, 0.11, 0.115, 1)
bump = nt.nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.15
nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.55
gp.data.materials.append(gm)

# sunset sky lighting
world = bpy.data.worlds.new('sky')
sc.world = world
world.use_nodes = True
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'NISHITA'
sky.sun_elevation = math.radians(9)
sky.sun_rotation = math.radians(20)
sky.sun_intensity = 0.6
sky.sun_size = math.radians(1.2)
sky.altitude = 20
world.node_tree.links.new(sky.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 45
cam_data.dof.use_dof = True
cam_data.dof.focus_distance = 7.2
cam_data.dof.aperture_fstop = 3.2
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (5.6, -4.4, 1.3)
tgt = Vector((0.0, -0.05, 0.85))
cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 90
sc.render.filepath = os.path.join(OUT, 'hero.jpg')
bpy.ops.render.render(write_still=True)
print('rendered', sc.render.filepath)
