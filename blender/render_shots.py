# Renders five stills in Cycles that recreate the reference screenshots,
# using the same models, terrain and layout as the game:
#
#   1 shootout   masked outlaws firing in front of the brick bank
#   2 pause      the red pause menu over a black-and-white frame
#   3 hilltop    the rider's back on a grassy hilltop, rifle slung, valley below
#   4 farm       aiming at a raider in the tobacco field, farmhouse burning
#   5 vista      on horseback above the river valley, pines and snowy peaks
#
#   python blender/render_shots.py [names...] [--samples N] [--size WxH]
#
# Run blender/build_assets.py first (this reads western/assets/world.json and
# terrain.bin). Output: blender/renders/<name>.jpg
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import animals  # noqa: E402
import buildings  # noqa: E402
import characters  # noqa: E402
import common  # noqa: E402
import nature  # noqa: E402
import textures  # noqa: E402
import worldmesh  # noqa: E402
from common import ASSETS, RENDERS, TEXTURES, srgb  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SAMPLES = 96
SIZE = (1280, 720)
NAMES = []
i = 0
while i < len(ARGS):
    a = ARGS[i]
    if a == '--samples':
        SAMPLES = int(ARGS[i + 1]); i += 2; continue
    if a == '--size':
        SIZE = tuple(int(v) for v in ARGS[i + 1].split('x')); i += 2; continue
    NAMES.append(a)
    i += 1
NAMES = NAMES or ['shootout', 'pause', 'hilltop', 'farm', 'vista']


def G(x, y, z):
    """Game coordinates (x east, y up, z south) to Blender (x, -z, y)."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------------------
# World data
# ---------------------------------------------------------------------------
class WorldData:
    def __init__(self):
        with open(os.path.join(ASSETS, 'world.json')) as f:
            self.d = json.load(f)
        n = self.d['n']
        raw = np.fromfile(os.path.join(ASSETS, 'terrain.bin'), dtype=np.uint8)
        q = raw[:n * n * 2].view('<u2').reshape(n, n)
        self.h = self.d['heightBase'] + q.astype(np.float64) * self.d['heightScale']
        off = n * n * 2
        self.dirt = raw[off:off + n * n].reshape(n, n) / 255.0
        self.field = raw[off + n * n:off + 2 * n * n].reshape(n, n) / 255.0
        self.forest = raw[off + 2 * n * n:off + 3 * n * n].reshape(n, n) / 255.0
        self.n = n
        self.size = self.d['size']
        self.half = self.size / 2
        self.step = self.size / (n - 1)

    def height(self, x, z):
        fx = (x + self.half) / self.step
        fz = (z + self.half) / self.step
        j = int(min(max(math.floor(fx), 0), self.n - 2))
        i = int(min(max(math.floor(fz), 0), self.n - 2))
        tx, tz = fx - j, fz - i
        h = self.h
        return float((h[i, j] * (1 - tx) + h[i, j + 1] * tx) * (1 - tz) + (h[i + 1, j] * (1 - tx) + h[i + 1, j + 1] * tx) * tz)

    def mask(self, a, x, z):
        j = int(min(max(round((x + self.half) / self.step), 0), self.n - 1))
        i = int(min(max(round((z + self.half) / self.step), 0), self.n - 1))
        return float(a[i, j])

    def pt(self, name):
        return self.d['points'][name]


W = None


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------
HAZE = {}


def fresh_scene():
    common.reset()
    HAZE.clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.cycles.volume_bounces = 1
    sc.cycles.volume_step_rate = 4.0
    sc.render.resolution_x, sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.film_transparent = False
    return sc


def sky(sc, sun_dir, strength=1.0, sun_size=1.5, elevation=None, haze=1.0):
    """Nishita-style sky (physical) plus a sun lamp for crisp shadows."""
    w = bpy.data.worlds.new('Sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    st = nt.nodes.new('ShaderNodeTexSky')
    try:
        st.sky_type = 'NISHITA'
        st.sun_elevation = math.radians(elevation if elevation is not None else 35)
        st.sun_rotation = math.atan2(sun_dir.x, sun_dir.y)
        st.air_density = 1.0
        st.dust_density = haze
        st.sun_disc = False      # the sun lamp provides the direct light
        st.sun_size = math.radians(sun_size)
        st.sun_intensity = 0.4
    except (TypeError, AttributeError):
        st.sky_type = 'HOSEK_WILKIE'
        st.sun_direction = sun_dir
    nt.links.new(st.outputs['Color'], bg.inputs['Color'])
    # The physical sky is daylight-bright; scale it to sit with a few-watt sun lamp
    bg.inputs['Strength'].default_value = strength * 0.14
    return w


def sun_lamp(direction, energy=4.0, color='#fff2dc', angle=1.0):
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = energy
    ld.color = srgb(color)
    ld.angle = math.radians(angle)
    ob = bpy.data.objects.new('Sun', ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = Vector(direction).to_track_quat('Z', 'Y').to_euler()
    return ob


def camera(pos, look, lens=35, roll=0.0):
    cd = bpy.data.cameras.new('Cam')
    cd.lens = lens
    cd.clip_start = 0.1
    cd.clip_end = 20000
    ob = bpy.data.objects.new('Cam', cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = pos
    q = (Vector(look) - Vector(pos)).to_track_quat('-Z', 'Y')
    ob.rotation_euler = q.to_euler()
    ob.rotation_euler.rotate_axis('Z', roll)
    bpy.context.scene.camera = ob
    bpy.context.view_layer.update()
    return ob


def mist(sc, start, depth, color, amount=1.0, falloff='QUADRATIC'):
    """Aerial haze in the compositor, from the mist pass (cheap, no volumes)."""
    sc.world.mist_settings.start = start
    sc.world.mist_settings.depth = depth
    sc.world.mist_settings.falloff = falloff
    for vl in sc.view_layers:
        vl.use_pass_mist = True
    sc.render.use_compositing = True
    HAZE['color'] = color
    HAZE['amount'] = amount


def build_compositor(sc, bw=False, blur=0, ui_layer=None):
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    rl.layer = sc.view_layers[0].name
    img = rl.outputs['Image']
    if HAZE:
        color, amount = HAZE['color'], HAZE['amount']
        mix = nt.nodes.new('CompositorNodeMixRGB')
        mix.blend_type = 'MIX'
        mul = nt.nodes.new('CompositorNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = amount
        nt.links.new(rl.outputs['Mist'], mul.inputs[0])
        nt.links.new(mul.outputs[0], mix.inputs['Fac'])
        nt.links.new(img, mix.inputs[1])
        mix.inputs[2].default_value = (*srgb(color), 1)
        img = mix.outputs['Image']
    if bw:
        hs = nt.nodes.new('CompositorNodeHueSat')
        hs.inputs['Saturation'].default_value = 0.0
        hs.inputs['Value'].default_value = 0.85
        nt.links.new(img, hs.inputs['Image'])
        img = hs.outputs['Image']
        bc = nt.nodes.new('CompositorNodeBrightContrast')
        bc.inputs['Contrast'].default_value = 18
        nt.links.new(img, bc.inputs['Image'])
        img = bc.outputs['Image']
    if blur:
        bl = nt.nodes.new('CompositorNodeBlur')
        try:
            bl.size_x = bl.size_y = blur
        except AttributeError:
            pass
        if 'Size' in bl.inputs:
            try:
                bl.inputs['Size'].default_value = (blur, blur)
            except TypeError:
                bl.inputs['Size'].default_value = blur
        bl.filter_type = 'GAUSS'
        nt.links.new(img, bl.inputs['Image'])
        img = bl.outputs['Image']
    if ui_layer:
        main = bpy.data.collections.new('Main')
        sc.collection.children.link(main)
        for ob in list(sc.collection.objects):
            if ob.type != 'CAMERA':
                main.objects.link(ob)
                sc.collection.objects.unlink(ob)
        sc.view_layers['UI'].layer_collection.children['Main'].exclude = True
        rl2 = nt.nodes.new('CompositorNodeRLayers')
        rl2.layer = ui_layer
        idm = nt.nodes.new('CompositorNodeIDMask')
        idm.index = 1
        idm.use_antialiasing = True
        nt.links.new(rl2.outputs['IndexOB'], idm.inputs[0])
        mx = nt.nodes.new('CompositorNodeMixRGB')
        nt.links.new(idm.outputs[0], mx.inputs['Fac'])
        nt.links.new(img, mx.inputs[1])
        nt.links.new(rl2.outputs['Image'], mx.inputs[2])
        img = mx.outputs['Image']
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(img, comp.inputs['Image'])


def render(name):
    sc = bpy.context.scene
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, name + '.jpg')
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    print(f'Rendering {name} ({SIZE[0]}x{SIZE[1]}, {SAMPLES} samples)...', flush=True)
    bpy.ops.render.render(write_still=True)
    print(f'  wrote blender/renders/{name}.jpg', flush=True)


# ---------------------------------------------------------------------------
# Terrain, water, plants
# ---------------------------------------------------------------------------
def image(name):
    return bpy.data.images.load(os.path.join(TEXTURES, name + '.jpg'), check_existing=True)


def terrain_material():
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    N = nt.nodes
    L = nt.links
    bsdf = N['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.95
    geo = N.new('ShaderNodeNewGeometry')
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Position'], sep.inputs[0])
    sepn = N.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Normal'], sepn.inputs[0])

    def tex(name, scale):
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (scale, scale, scale)
        L.new(geo.outputs['Position'], mp.inputs['Vector'])
        t = N.new('ShaderNodeTexImage')
        t.image = image(name)
        t.projection = 'FLAT'
        L.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t.outputs['Color']

    def mix(a, b, fac, blend='MIX', factor=None):
        n = N.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        cols = [i for i in n.inputs if i.type == 'RGBA']
        if fac is not None:
            L.new(fac, n.inputs['Factor'])
        else:
            n.inputs['Factor'].default_value = factor
        L.new(a, cols[0])
        L.new(b, cols[1])
        return [o for o in n.outputs if o.type == 'RGBA'][0]

    def attr(name):
        a = N.new('ShaderNodeAttribute')
        a.attribute_name = name
        return a.outputs['Fac']

    def ramp(src, a, b):
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = a
        mr.inputs['From Max'].default_value = b
        mr.clamp = True
        L.new(src, mr.inputs['Value'])
        return mr.outputs['Result']

    grass = tex('grass', 0.15)
    grass2 = tex('grass', 0.0021)
    tinted = mix(grass, grass2, None, 'MULTIPLY', 0.55)
    bright = N.new('ShaderNodeBrightContrast')
    bright.inputs['Bright'].default_value = 0.05
    L.new(tinted, bright.inputs['Color'])
    col = bright.outputs['Color']
    dirt = tex('dirt', 0.15)
    rock = tex('rock', 0.06)
    snow = tex('snow', 0.1)
    col = mix(col, dirt, ramp(attr('dirt'), 0.08, 0.55))
    col = mix(col, dirt, attr('field'))
    slope = N.new('ShaderNodeMath')
    slope.operation = 'SUBTRACT'
    slope.inputs[0].default_value = 1.0
    L.new(sepn.outputs['Z'], slope.inputs[1])
    col = mix(col, rock, ramp(slope.outputs[0], 0.24, 0.42))
    col = mix(col, snow, ramp(sep.outputs['Z'], 540, 600))
    L.new(col, bsdf.inputs['Base Color'])
    return m


def terrain(x0, z0, x1, z1, step=1):
    """Terrain mesh for a window of the map (game coords), every `step` cells."""
    n = W.n
    j0 = max(0, int((x0 + W.half) / W.step))
    j1 = min(n - 1, int((x1 + W.half) / W.step) + 1)
    i0 = max(0, int((z0 + W.half) / W.step))
    i1 = min(n - 1, int((z1 + W.half) / W.step) + 1)
    js = list(range(j0, j1 + 1, step))
    is_ = list(range(i0, i1 + 1, step))
    verts = []
    for i in is_:
        for j in js:
            verts.append((j * W.step - W.half, -(i * W.step - W.half), W.h[i, j]))
    cols = len(js)
    faces = []
    for a in range(len(is_) - 1):
        for b in range(cols - 1):
            v = a * cols + b
            faces.append((v, v + cols, v + cols + 1, v + 1))
    me = bpy.data.meshes.new('Terrain')
    me.from_pydata(verts, [], faces)
    for name, arr in (('dirt', W.dirt), ('field', W.field), ('forest', W.forest)):
        at = me.attributes.new(name, 'FLOAT', 'POINT')
        vals = [float(arr[i, j]) for i in is_ for j in js]
        at.data.foreach_set('value', vals)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(terrain_material())
    ob = bpy.data.objects.new('Terrain', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def river(z0, z1):
    pts = [p for p in W.d['river']['points'] if z0 - 20 <= p[1] <= z1 + 20]
    hw = W.d['river']['halfWidth']
    verts, faces = [], []
    for k, p in enumerate(pts):
        q = pts[min(k + 1, len(pts) - 1)]
        o = pts[max(k - 1, 0)]
        dx, dz = q[0] - o[0], q[1] - o[1]
        ln = math.hypot(dx, dz) or 1
        dx, dz = dx / ln, dz / ln
        for s in (-1, 1):
            x = p[0] + dz * hw * s
            z = p[1] - dx * hw * s
            verts.append((x, -z, p[2]))
    for k in range(len(pts) - 1):
        a = k * 2
        faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new('River')
    me.from_pydata(verts, [], faces)
    m = bpy.data.materials.new('Water')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb('#24363a'), 1)
    b.inputs['Roughness'].default_value = 0.05
    b.inputs['IOR'].default_value = 1.33
    b.inputs['Transmission Weight'].default_value = 0.4
    me.materials.append(m)
    ob = bpy.data.objects.new('River', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


PROPS = {}


def load_props():
    """Build all props once (from the same Blender code the game uses)."""
    if PROPS:
        return PROPS
    T = {k: bpy.data.images.load(os.path.join(TEXTURES, k + '.jpg'), check_existing=True)
         for k in ('brick', 'clapboard', 'whiteboard', 'planks', 'barnboard', 'logs', 'shingles', 'canvas', 'bark', 'grass',
                   'dirt', 'rock', 'snow')}
    lib = bpy.data.collections.new('Library')
    for name, (ob, _, _) in buildings.build_all(T).items():
        PROPS[name] = ob
    for name, ob in nature.build_all(T).items():
        PROPS[name] = ob
    for ob in PROPS.values():
        for c in ob.users_collection:
            c.objects.unlink(ob)
        lib.objects.link(ob)
    return PROPS


def place(model, x, y, z, yaw, scale=1.0):
    src = PROPS[model]
    ob = bpy.data.objects.new(model, src.data)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = G(x, y, z)
    ob.rotation_euler = (0, 0, yaw)
    ob.scale = (scale, scale, scale)
    return ob


def place_world(center, radius, keep=lambda m, x, z: True):
    """Buildings, props and plants from world.json within `radius` of `center` (game x, z)."""
    cx, cz = center
    for p in W.d['buildings'] + W.d['props']:
        if math.hypot(p['x'] - cx, p['z'] - cz) < radius and keep(p['model'], p['x'], p['z']):
            place(p['model'], p['x'], p['y'], p['z'], p['yaw'])
    for model, items in W.d['instances'].items():
        if model.startswith('Grass'):
            continue
        for x, y, z, yaw, s in items:
            if math.hypot(x - cx, z - cz) < radius and keep(model, x, z):
                place(model, x, y, z, yaw, s)


def scatter_grass(cam_xz, look_xz, radius, count, seed=1, avoid=None, smin=0.55, smax=1.05):
    """Geometry-nodes grass in a wedge in front of the camera."""
    rnd = random.Random(seed)
    cx, cz = cam_xz
    ang = math.atan2(look_xz[0] - cx, look_xz[1] - cz)
    pts = []
    tries = 0
    while len(pts) < count and tries < count * 6:
        tries += 1
        r = radius * math.sqrt(rnd.random())
        a = ang + (rnd.random() - 0.5) * 1.9
        x = cx + math.sin(a) * r
        z = cz + math.cos(a) * r
        if W.mask(W.dirt, x, z) > 0.25 or W.mask(W.field, x, z) > 0.4:
            continue
        if avoid and avoid(x, z):
            continue
        pts.append((x, -z, W.height(x, z) - 0.05))
    for k, name in enumerate(('Grass1', 'Grass2', 'Grass3')):
        sub = pts[k::3]
        me = bpy.data.meshes.new('GrassPts')
        me.from_pydata(sub, [], [])
        ob = bpy.data.objects.new('GrassField', me)
        bpy.context.scene.collection.objects.link(ob)
        gn_instance(ob, PROPS[name], smin, smax)


def gn_instance(ob, src_obj, smin, smax):
    mod = ob.modifiers.new('Scatter', 'NODES')
    tree = bpy.data.node_groups.new('Scatter', 'GeometryNodeTree')
    tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = tree.nodes
    L = tree.links
    gi = N.new('NodeGroupInput')
    go = N.new('NodeGroupOutput')
    inst = N.new('GeometryNodeInstanceOnPoints')
    info = N.new('GeometryNodeObjectInfo')
    info.inputs['Object'].default_value = src_obj
    rot = N.new('FunctionNodeRandomValue')
    rot.data_type = 'FLOAT_VECTOR'
    rot.inputs['Min'].default_value = (0, 0, 0)
    rot.inputs['Max'].default_value = (0, 0, 6.283)
    sc = N.new('FunctionNodeRandomValue')
    sc.data_type = 'FLOAT'
    sc.inputs[2].default_value = smin
    sc.inputs[3].default_value = smax
    L.new(gi.outputs[0], inst.inputs['Points'])
    L.new(info.outputs['Geometry'], inst.inputs['Instance'])
    L.new(rot.outputs[0], inst.inputs['Rotation'])
    L.new(sc.outputs[1], inst.inputs['Scale'])
    L.new(inst.outputs['Instances'], go.inputs[0])
    mod.node_group = tree


def mountains():
    ob = worldmesh.mountains()
    m = ob.data.materials[0]
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    return ob


# ---------------------------------------------------------------------------
# Characters
# ---------------------------------------------------------------------------
def cowboy(outfit, colors, at, yaw, action=None, frame=0, pose=None):
    """A posed cowboy. outfit: visible part names; colors: material name -> hex."""
    col = bpy.data.collections.new('Char')
    bpy.context.scene.collection.children.link(col)
    common._mats.clear()
    rig, objs = characters.build_cowboy(col)
    for o in objs:
        if o.type != 'MESH':
            continue
        o.hide_render = o.name.split('.')[0] not in outfit
        for slot in o.material_slots:
            m = slot.material
            base = m.name.split('.')[0]
            if base in colors:
                mm = m.copy()
                mm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb(colors[base]), 1)
                slot.material = mm
    rig.location = at
    rig.rotation_euler = (0, 0, yaw)
    if action:
        apply_action(rig, action, frame)
    if pose:
        pose(rig)
    return rig, objs


def rig_action(rig, name):
    for t in rig.animation_data.nla_tracks:
        if t.name == name:
            return t.strips[0].action
    raise KeyError(name)


def apply_action(rig, name, frame):
    """Pose a rig from one of its own actions at `frame`, then let go of it."""
    act = rig_action(rig, name)
    ad = rig.animation_data
    ad.action = act
    try:
        if act.slots and ad.action_slot is None:
            ad.action_slot = act.slots[0]
    except AttributeError:
        pass
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    ad.action = None


def horse(at, yaw, action='idle', frame=0, coat='#2b1c14'):
    col = bpy.data.collections.new('Horse')
    bpy.context.scene.collection.children.link(col)
    rig, objs = animals.build_animal(animals.HORSE, col)
    for o in objs:
        if o.type == 'MESH':
            for slot in o.material_slots:
                if slot.material.name.startswith('HorseCoat'):
                    slot.material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb(coat), 1)
    rig.location = at
    rig.rotation_euler = (0, 0, yaw)
    apply_action(rig, action, frame)
    seat = [o for o in objs if o.name.startswith('Seat')][0]
    bpy.context.view_layer.update()
    return rig, seat.matrix_world.translation.copy()


PLAYER_LOOK = dict(show={'Body', 'Hat', 'GunBelt', 'HolsterGun', 'Suspenders', 'Satchel', 'RifleBack', 'Beard'},
                   colors={'Shirt': '#4a6688', 'Pants': '#594a3b', 'Hat': '#3a2a1e'})
OUTLAW_LOOK = dict(show={'Body', 'Hat', 'Mask', 'Coat', 'GunBelt', 'HolsterGun'},
                   colors={'Coat': '#4e5246', 'Mask': '#2b2b2f', 'Hat': '#4a3a2c', 'Shirt': '#6a6050', 'Hands': '#3a2a20'})


def aim_pose(rig):
    """Upper body from the aim_pistol action (it only keys the upper body)."""
    apply_action(rig, 'aim_pistol', 0)


def muzzle_world(objs):
    gun = [o for o in objs if o.name.startswith('Revolver')][0]
    bpy.context.view_layer.update()
    return gun.matrix_world @ Vector((0, -0.2, 0.032)), (gun.matrix_world.to_3x3() @ Vector((0, -1, 0))).normalized()


# ---------------------------------------------------------------------------
# Effects: gun smoke and fire
# ---------------------------------------------------------------------------
def smoke_volume(center, size, density=1.5, color='#d8d4cc', seed=0, dark=False, rise=None):
    me = bpy.data.meshes.new('Smoke')
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    bm.to_mesh(me)
    ob = bpy.data.objects.new('Smoke', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = center
    ob.scale = size
    m = bpy.data.materials.new('SmokeVol')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    out = nt.nodes['Material Output']
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (*srgb(color), 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 2.2
    noise.inputs['Detail'].default_value = 6
    noise.noise_dimensions = '4D'
    noise.inputs['W'].default_value = seed
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'SPHERICAL'
    nt.links.new(tc.outputs['Object'], grad.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(noise.outputs['Fac'], mul.inputs[0])
    nt.links.new(grad.outputs['Fac'], mul.inputs[1])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.12
    mr.inputs['From Max'].default_value = 0.5
    mr.inputs['To Max'].default_value = density
    nt.links.new(mul.outputs[0], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], vol.inputs['Density'])
    if dark:
        vol.inputs['Absorption Color'].default_value = (0.02, 0.02, 0.02, 1)
    nt.links.new(vol.outputs['Volume'], out.inputs['Volume'])
    me.materials.append(m)
    return ob


def flames(center, size, count=14, seed=3):
    rnd = random.Random(seed)
    b = common.Builder('Flames')
    hot = common.mat('FlameHot', '#ffb040', emit='#ff8a20', emit_strength=12, double=True)
    warm = common.mat('FlameWarm', '#ff6010', emit='#e8480c', emit_strength=8, double=True)
    for k in range(count):
        p = Vector(center) + Vector((rnd.uniform(-1, 1) * size[0], rnd.uniform(-1, 1) * size[1], 0))
        h = rnd.uniform(0.6, 1.4) * size[2]
        r = rnd.uniform(0.25, 0.55) * size[2] * 0.6
        tip = p + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), h))
        b.cyl(p, tip, r, 0.02, hot if k % 2 else warm, None, seg=7, smooth=True)
    ob = b.build()
    light = bpy.data.lights.new('Fire', 'POINT')
    light.energy = 9000 * size[2]
    light.color = srgb('#ff8a3a')
    light.shadow_soft_size = 2.0
    lo = bpy.data.objects.new('FireLight', light)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = Vector(center) + Vector((0, 0, size[2] * 0.8))
    return ob


def muzzle_flash(pos, direction, scale=1.0):
    b = common.Builder('Flash')
    m = common.mat('MuzzleFlash', '#ffd080', emit='#ffc060', emit_strength=80, double=True)
    tip = pos + direction * 0.35 * scale
    b.cyl(pos, tip, 0.07 * scale, 0.005, m, None, seg=8)
    for k in range(5):
        a = k * 1.256
        side = direction.cross(Vector((0, 0, 1))).normalized()
        up = side.cross(direction).normalized()
        d = (side * math.cos(a) + up * math.sin(a)) * 0.12 * scale + direction * 0.08 * scale
        b.cyl(pos, pos + d, 0.03 * scale, 0.004, m, None, seg=5)
    b.build()
    light = bpy.data.lights.new('Flash', 'POINT')
    light.energy = 400 * scale
    light.color = srgb('#ffb060')
    lo = bpy.data.objects.new('FlashLight', light)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = pos + direction * 0.15


# ---------------------------------------------------------------------------
# UI overlays (rendered in their own view layer and laid over the frame)
# ---------------------------------------------------------------------------
def ui_layer(sc):
    col = bpy.data.collections.new('UI')
    sc.collection.children.link(col)
    main = sc.view_layers[0]
    main.layer_collection.children['UI'].exclude = True
    ui = sc.view_layers.new('UI')
    for c in ui.layer_collection.children:
        c.exclude = c.name != 'UI'
    ui.use_sky = False
    ui.use_pass_mist = False
    ui.use_pass_object_index = True
    return col


def ui_plane_space(cam):
    """Matrix placing UI objects on a plane 1 m in front of the camera; the
    returned function maps (u, v) in 0..1 screen space (u right, v down)."""
    cd = cam.data
    aspect = SIZE[0] / SIZE[1]
    w = 2 * math.tan(cd.angle / 2) if aspect >= 1 else 2 * math.tan(cd.angle / 2) * aspect
    h = w / aspect
    M = cam.matrix_world.copy()

    def at(u, v, depth=1.0):
        return M @ Vector(((u - 0.5) * w * depth, (0.5 - v) * h * depth, -depth))
    return at, w, h


def ui_mat(name, color, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*srgb(color), 1)
    em.inputs['Strength'].default_value = 1.0
    out = nt.nodes['Material Output']
    if alpha < 1:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mx = nt.nodes.new('ShaderNodeMixShader')
        mx.inputs['Fac'].default_value = alpha
        nt.links.new(tr.outputs[0], mx.inputs[1])
        nt.links.new(em.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], out.inputs['Surface'])
    else:
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def ui_poly(col, pts3, material):
    me = bpy.data.meshes.new('UIPoly')
    me.from_pydata(pts3, [], [list(range(len(pts3)))])
    me.materials.append(material)
    ob = bpy.data.objects.new('UIPoly', me)
    ob.pass_index = 1
    col.objects.link(ob)
    return ob


def ui_text(col, cam, text, u, v, size, material, align='LEFT', font_scale=1.0):
    cu = bpy.data.curves.new('UIText', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = align
    ob = bpy.data.objects.new('UIText', cu)
    ob.pass_index = 1
    col.objects.link(ob)
    cu.materials.append(material)
    at, w, h = ui_plane_space(cam)
    # A touch in front of the panel so the two don't z-fight
    ob.matrix_world = cam.matrix_world @ Matrix.Translation(((u - 0.5) * w * 0.99, (0.5 - v) * h * 0.99, -0.99))
    ob.scale = (font_scale, 1, 1)
    return ob


def ui_ring(col, cam, u, v, r, width, material, frac=1.0, seg=48):
    at, w, h = ui_plane_space(cam)
    rr = r * w
    pts = []
    n = max(3, int(seg * frac))
    for k in range(n + 1):
        a = -math.pi / 2 + 2 * math.pi * frac * k / n
        pts.append((math.cos(a), math.sin(a)))
    verts = []
    for c, s in pts:
        k = 0.99
        verts.append(cam.matrix_world @ Vector((((u - 0.5) * w + c * rr) * k, ((0.5 - v) * h - s * rr) * k, -k)))
        verts.append(cam.matrix_world @ Vector((((u - 0.5) * w + c * (rr - width * w)) * k,
                                                ((0.5 - v) * h - s * (rr - width * w)) * k, -k)))
    me = bpy.data.meshes.new('UIRing')
    faces = [(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2) for k in range(n)]
    me.from_pydata(verts, [], faces)
    me.materials.append(material)
    ob = bpy.data.objects.new('UIRing', me)
    ob.pass_index = 1
    col.objects.link(ob)
    return ob


def ui_disc(col, cam, u, v, r, material, seg=48):
    at, w, h = ui_plane_space(cam)
    rr = r * w
    c = Vector(((u - 0.5) * w, (0.5 - v) * h, -1.0))
    verts = [cam.matrix_world @ (c + Vector((math.cos(a) * rr, math.sin(a) * rr, 0)))
             for a in [2 * math.pi * k / seg for k in range(seg)]]
    return ui_poly(col, verts, material)


# ---------------------------------------------------------------------------
# The five shots
# ---------------------------------------------------------------------------
def face(dx, dy):
    """Rig Z rotation that turns a character (modelled facing -Y) toward (dx, dy)."""
    return math.atan2(dx, -dy)


def shot_shootout():
    """Screenshot 1: two masked outlaws firing on the bank's boardwalk."""
    sc = fresh_scene()
    sc.view_settings.exposure = 0.0
    load_props()
    bank = next(b for b in W.d['buildings'] if b['model'] == 'Bank')
    bx, by, bz = bank['x'], bank['y'], bank['z']
    place_world((bx, bz), 120)
    terrain(bx - 300, bz - 300, bx + 300, bz + 300)
    sky(sc, Vector((0.3, -0.6, 0.5)), strength=0.35, elevation=20, haze=1.5)
    sun_lamp(Vector((0.35, -0.75, 0.45)), energy=2.4, color='#ffe0b8', angle=3.0)
    # Blender coords: the facade runs along X at Y = -bz, the boardwalk is in front (smaller Y)
    fy = -bz
    walk_z = by + 0.38
    p1 = Vector((bx - 3.2, fy - 1.25, walk_z))
    p2 = Vector((bx + 4.6, fy - 2.3, walk_z))
    aim1 = Vector((1.0, -0.42, 0)).normalized()
    r1, o1 = cowboy(OUTLAW_LOOK['show'] | {'Revolver'}, OUTLAW_LOOK['colors'], p1, face(aim1.x, aim1.y), 'walk', 4, aim_pose)
    aim2 = Vector((-0.45, -0.89, 0)).normalized()
    look2 = dict(OUTLAW_LOOK['colors'], Hat='#1c1a19', Mask='#202024', Pants='#2a2826', Jacket='#2a2b2d', Shirt='#3a3634')
    r2, o2 = cowboy({'Body', 'Hat', 'Mask', 'Jacket', 'GunBelt', 'HolsterGun', 'Revolver'}, look2, p2,
                    face(aim2.x, aim2.y), 'walk', 20, aim_pose)
    mp, md = muzzle_world(o2)
    muzzle_flash(mp, md, 1.3)
    smoke_volume(mp + md * 0.7 + Vector((0, 0, 0.1)), (0.9, 0.7, 0.55), density=3.0, seed=1)
    smoke_volume(mp + md * 1.9 + Vector((0.2, -0.3, 0.35)), (1.5, 1.2, 0.9), density=1.4, seed=2)
    smoke_volume(p2 + Vector((1.4, 0.4, 2.0)), (2.2, 1.6, 1.3), density=0.6, seed=4)
    m1, d1 = muzzle_world(o1)
    smoke_volume(m1 + d1 * 0.8 + Vector((0, 0, 0.2)), (0.7, 0.6, 0.45), density=1.2, seed=7)
    right1 = aim1.cross(Vector((0, 0, 1)))
    cam_pos = p1 - aim1 * 2.0 + right1 * 1.45 + Vector((0, 0, 1.55))
    camera(cam_pos, p2 + Vector((0.4, -0.2, 1.15)), lens=26)
    mist(sc, 10, 300, '#8e8a82', 0.12)
    build_compositor(sc)
    render('shootout')


def shot_pause():
    """Screenshot 2: the pause menu over a black-and-white frame."""
    sc = fresh_scene()
    load_props()
    # On the north road, in the pines
    x, z = 268.0, -560.0
    y = W.height(x, z)
    place_world((x, z), 420)
    terrain(x - 900, z - 900, x + 900, z + 900)
    sky(sc, Vector((0.2, 0.7, 0.4)), strength=0.9, elevation=18, haze=6)
    sun_lamp(Vector((-0.3, 0.8, 0.5)), energy=2.5, angle=8)
    yaw = 3.05
    fwd = Vector((math.sin(yaw), -math.cos(yaw), 0))
    pos = G(x, y, z)
    cowboy(PLAYER_LOOK['show'] - {'RifleBack'}, dict(PLAYER_LOOK['colors'], Shirt='#2c2c2c'), pos,
           math.atan2(-fwd.x, fwd.y) + math.pi, 'walk', 6)
    scatter_grass((x, z), (x + fwd.x * 20, z - fwd.y * 20), 30, 5000, seed=3)
    cam = camera(pos - fwd * 3.6 + fwd.cross(Vector((0, 0, 1))) * 0.5 + Vector((0, 0, 1.7)), pos + fwd * 20 + Vector((0, 0, 1.2)), lens=30)
    mist(sc, 10, 160, '#8a8a8a', 0.8)
    ui = ui_layer(sc)
    at, w, h = ui_plane_space(cam)
    red = ui_mat('MenuRed', '#9e0f0c')
    rnd = random.Random(5)
    edge = [at(0, 0)]
    for k in range(41):
        v = k / 40
        edge.append(at(0.31 - v * 0.012 + rnd.uniform(-0.008, 0.008), v))
    edge.append(at(0, 1))
    ui_poly(ui, list(reversed(edge)), red)
    ink = ui_mat('Ink', '#16100c')
    ui_ring(ui, cam, 0.075, 0.15, 0.034, 0.006, ink)
    ui_ring(ui, cam, 0.075, 0.15, 0.027, 0.0022, ink)
    ui_ring(ui, cam, 0.075, 0.052, 0.006, 0.0028, ink)
    text = ui_mat('MenuText', '#f0e6d6')
    dim = ui_mat('MenuDim', '#d79a8a')
    beige = ui_mat('MenuBeige', '#e2cfb8')
    items = ['MAP', 'HELP', 'PROGRESS', 'PLAYER', 'STORY', 'SETTINGS', 'RESUME', 'QUIT TO TITLE']
    for k, label in enumerate(items):
        m = dim if label.startswith('QUIT') else text if label == 'STORY' else beige
        ui_text(ui, cam, label, 0.045, 0.34 + k * 0.064, 0.032 * w, m)
    ui_text(ui, cam, 'Select  [Enter]      Back  [Esc]', 0.79, 0.95, 0.015 * w, text)
    build_compositor(sc, bw=True, blur=3, ui_layer='UI')
    render('pause')


def shot_hilltop():
    """Screenshot 3: on foot atop a grassy hill, rifle on the back, valley ahead."""
    sc = fresh_scene()
    load_props()
    x, z = W.pt('lookout')[0] - 4, W.pt('lookout')[2] + 6
    y = W.height(x, z)
    place_world((x, z), 1500)
    terrain(x - 2000, z - 2200, x + 2400, z + 1400)
    river(z - 1500, z + 1500)
    mountains()
    sky(sc, Vector((0.6, 0.3, 0.6)), strength=1.0, elevation=38, haze=1.2)
    sun_lamp(Vector((-0.5, 0.5, 0.75)), energy=4.0, angle=1.5)
    yaw = 1.02    # facing east-north-east over the valley
    fwd = Vector((math.sin(yaw), math.cos(yaw), 0))
    pos = G(x, y, z)
    cowboy(PLAYER_LOOK['show'] | {'Jacket'}, dict(PLAYER_LOOK['colors'], Jacket='#4a3a2c'), pos,
           math.atan2(-fwd.x, fwd.y) + math.pi, 'idle', 30)
    cam_p = pos - fwd * 4.8 + fwd.cross(Vector((0, 0, 1))) * -0.6 + Vector((0, 0, 2.5))
    scatter_grass((cam_p.x, -cam_p.y), (x + fwd.x * 40, z - fwd.y * 40), 60, 16000, seed=5)
    camera(cam_p, pos + fwd * 60 + Vector((0, 0, -15)), lens=26)
    mist(sc, 200, 6000, '#c4d3e2', 0.75)
    build_compositor(sc)
    render('hilltop')


def shot_farm():
    """Screenshot 4: aiming at a raider in the tobacco, the farmhouse burning."""
    sc = fresh_scene()
    load_props()
    fh = next(b for b in W.d['buildings'] if b['model'] == 'Farmhouse')
    fx, fy, fz = fh['x'], fh['y'], fh['z']
    field = W.pt('field')
    place_world((fx, fz + 20), 260)
    terrain(fx - 500, fz - 500, fx + 500, fz + 500)
    sky(sc, Vector((-0.6, 0.6, 0.2)), strength=0.7, elevation=8, haze=8)
    sun_lamp(Vector((-0.75, 0.55, 0.22)), energy=2.6, color='#ffb46a', angle=4)
    # Fire on the farmhouse: flames along the roof and porch, a column of smoke
    house = G(fx, fy, fz)
    flames(house + Vector((0, 4.5, 6.5)), (3.5, 3.0, 2.6), count=22, seed=1)
    flames(house + Vector((-2.5, -1.4, 1.2)), (1.2, 0.6, 1.4), count=8, seed=2)
    smoke_volume(house + Vector((0.5, 6, 13)), (7, 6, 7), density=0.9, color='#3a3632', seed=3, dark=True)
    smoke_volume(house + Vector((3, 9, 22)), (10, 8, 8), density=0.5, color='#4a4540', seed=5, dark=True)
    # The raider is between us and the house; we aim from the tobacco rows
    hx, hz = fx, fz + 4
    away = Vector((0.25, 1.0)).normalized()          # from the house toward the field (game x, z)
    side = Vector((away.y, -away.x))
    rx, rz = hx + away.x * 26 + side.x * 4, hz + away.y * 26 + side.y * 4
    px, pz = rx + away.x * 9 - side.x * 3.5, rz + away.y * 9 - side.y * 3.5
    pos = G(px, W.height(px, pz), pz)
    rpos = G(rx, W.height(rx, rz), rz)
    to = (rpos - pos)
    to.z = 0
    to.normalize()
    pr, po = cowboy(PLAYER_LOOK['show'] | {'Revolver'}, PLAYER_LOOK['colors'], pos, face(to.x, to.y), 'walk', 0, aim_pose)
    rr, ro = cowboy({'Body', 'Hat', 'Mask', 'Vest', 'GunBelt', 'HolsterGun', 'Revolver'},
                    {'Mask': '#a8302a', 'Vest': '#3a2a20', 'Shirt': '#c8bca0', 'Hat': '#4a3a28'}, rpos,
                    face(-to.y, to.x) if False else face(to.x * 0.3 - to.y, to.y * 0.3 + to.x), 'run', 6)
    right = to.cross(Vector((0, 0, 1)))
    cam = camera(pos - to * 2.6 - right * 0.75 + Vector((0, 0, 1.72)), rpos + Vector((0, 0, 1.3)) + right * 1.5, lens=28)
    mist(sc, 25, 520, '#d8a46a', 0.85, falloff='LINEAR')
    # HUD: three cores and the minimap, bottom left
    ui = ui_layer(sc)
    white = ui_mat('HudWhite', '#efe8da')
    shade = ui_mat('HudShade', '#2a2420')
    for k in range(3):
        ui_disc(ui, cam, 0.03 + k * 0.032, 0.678, 0.011, shade)
        ui_ring(ui, cam, 0.03 + k * 0.032, 0.678, 0.011, 0.0018, white)
    ui_disc(ui, cam, 0.088, 0.845, 0.075, ui_mat('MiniMap', '#6c6a64'))
    ui_ring(ui, cam, 0.088, 0.845, 0.075, 0.003, ui_mat('MiniRim', '#2a2420'))
    build_compositor(sc, ui_layer='UI')
    render('farm')


def shot_vista():
    """Screenshot 5: on horseback above the valley, river and pines below, snowy peaks."""
    sc = fresh_scene()
    load_props()
    p = W.pt('lookout')
    x, z = p[0], p[2]
    y = W.height(x, z)
    place_world((x, z), 1700)
    terrain(x - 2000, z - 2400, x + 2600, z + 1400)
    river(z - 2000, z + 1500)
    mountains()
    sky(sc, Vector((0.4, 0.3, 0.7)), strength=1.0, elevation=42, haze=1.0)
    sun_lamp(Vector((-0.3, -0.6, 0.75)), energy=4.2, angle=1.2)
    yaw = 0.95
    fwd = Vector((math.sin(yaw), math.cos(yaw), 0))
    hpos = G(x, y, z)
    rig, seat = horse(hpos, math.atan2(-fwd.x, fwd.y) + math.pi, 'idle', 20)
    cowboy(PLAYER_LOOK['show'], PLAYER_LOOK['colors'], seat - Vector((0, 0, 0.98)), math.atan2(-fwd.x, fwd.y) + math.pi, 'ride', 0)
    side = fwd.cross(Vector((0, 0, 1)))
    cam_p = hpos - fwd * 9 - side * 2.2 + Vector((0, 0, 4.4))
    scatter_grass((cam_p.x, -cam_p.y), (x + fwd.x * 40, z - fwd.y * 40), 60, 16000, seed=9)
    camera(cam_p, hpos + fwd * 200 + Vector((0, 0, -75)), lens=22)
    mist(sc, 300, 7000, '#c8d8e8', 0.7)
    build_compositor(sc)
    render('vista')


SHOTS = {'shootout': shot_shootout, 'pause': shot_pause, 'hilltop': shot_hilltop, 'farm': shot_farm, 'vista': shot_vista}


def main():
    global W
    W = WorldData()
    for name in NAMES:
        PROPS.clear()
        SHOTS[name]()


if __name__ == '__main__':
    main()
