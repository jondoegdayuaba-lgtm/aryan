"""Blender (bpy) script that models Breach Point's characters, weapons and props
and exports them to one GLB. Run with: python models.py out.glb
Convention: forward is +Y, up is +Z (the glTF exporter turns this into three.js -Z forward, +Y up).
Colours are stored as raw factors so three.js shows the exact hex values."""
import bpy, math, sys
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}

def mat(name, hexcol, metal=0.0, rough=0.7, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    r, g, bl = ((hexcol >> 16) & 255) / 255, ((hexcol >> 8) & 255) / 255, (hexcol & 255) / 255
    b.inputs['Base Color'].default_value = (r, g, bl, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    MATS[name] = m
    return m

def finish(o, name, m, parent, bevel=0.0, smooth=False):
    o.name = name
    if m is not None:
        o.data.materials.append(m)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = 'ANGLE'
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if parent is not None:
        mw = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = mw
    return o

def _apply(o):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.select_set(False)

def box(name, size, loc, m, parent=None, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    _apply(o)
    return finish(o, name, m, parent, bevel)

def cyl(name, r, depth, loc, m, parent=None, rot=(0, 0, 0), verts=10, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    return finish(o, name, m, parent, smooth=True)

def sphere(name, r, loc, m, parent=None, scale=(1, 1, 1), seg=10, rings=7):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.scale = scale
    _apply(o)
    return finish(o, name, m, parent, smooth=True)

def limb(name, a, b, r, m, parent=None, r2=None, verts=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat('Z', 'Y').to_euler()
    return cyl(name, r, d.length, (a + b) / 2, m, parent, rot=rot, verts=verts, r2=r2)

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent is not None:
        bpy.context.view_layer.update()
        mw = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = mw
    return o

Y = lambda v: (0, v, 0)
RX = math.pi / 2  # cylinder along Y

# ---------------------------------------------------------------- characters
# Agents: one body plan, many outfits. Every agent gets nodes named <id>_hipL/_kneeL/_upper/_head/_arms/_gun
# (animated in game) and a first-person forearm <id>_vmarm.
AGENTS = {
    'S_raider': dict(team='S', head='balaclava', torso='vest', extras=['pack'],
        L=dict(shirt=0xa88a5a, vest=0x4a4636, pants=0x5b5a42, head=0x2b2b2b, skin=0xc99d7b, sleeve=0x7a6a48,
               glove=0x2a2622, boot=0x2a2420, pouch=0x5a5440, belt=0x3a3024, pack=0x6a5a3a)),
    'S_bandit': dict(team='S', head='balaclava', torso='vest', extras=['plaid', 'bandolier'],
        L=dict(shirt=0xd9cdb0, vest=0x8a8f72, pants=0x4f5536, head=0x3d4a2c, skin=0xc99d7b, sleeve=0xd9cdb0,
               glove=0x3a2c20, boot=0x5a3c22, pouch=0x6b6b4c, belt=0x4a3420, pack=0x6a5a3a, plaid=0x9a3a2a)),
    'S_ghost': dict(team='S', head='hood', torso='jacket', extras=['shemagh', 'pack'],
        L=dict(shirt=0xcdb48a, vest=0xb39a6e, pants=0x9c8660, head=0xcdb48a, skin=0xb98a66, sleeve=0xc2a87c,
               glove=0x5a4a36, boot=0x6b5236, pouch=0x8f7a54, belt=0x5a4630, pack=0x9c8660, scarf=0x8a6a4a)),
    'S_brute': dict(team='S', head='gasmask', torso='heavy', extras=['pads', 'pack'],
        L=dict(shirt=0x3a3a36, vest=0x23241f, pants=0x35352f, head=0x1e1f1c, skin=0xa87a5a, sleeve=0x3a3a36,
               glove=0x161616, boot=0x141414, pouch=0x2f302a, belt=0x1a1a18, pack=0x2c2d28, accent=0xc8502a)),
    'W_officer': dict(team='W', head='helmet', torso='vest', extras=['pack', 'patch'],
        L=dict(shirt=0x34465e, vest=0x252c38, pants=0x3b4250, head=0xc99d7b, skin=0xc99d7b, sleeve=0x2f3d52,
               glove=0x1f2226, boot=0x1c1d20, pouch=0x30394a, belt=0x22262c, pack=0x39424f, helmet=0x39424f)),
    'W_diver': dict(team='W', head='diver', torso='wetsuit', extras=['tank'],
        L=dict(shirt=0x1a1d22, vest=0x22262c, pants=0x1a1d22, head=0x15171a, skin=0xc99d7b, sleeve=0x1a1d22,
               glove=0x111214, boot=0x111214, pouch=0x2a2f36, belt=0x2a2f36, pack=0x3a4652, accent=0xe0b020, helmet=0x15171a)),
    'W_riot': dict(team='W', head='visor', torso='heavy', extras=['pads', 'patch'],
        L=dict(shirt=0x4a5560, vest=0x2a323a, pants=0x404a54, head=0xc99d7b, skin=0xc99d7b, sleeve=0x4a5560,
               glove=0x1a1c1f, boot=0x15171a, pouch=0x343c44, belt=0x22262c, pack=0x39424f, helmet=0x2e363e, accent=0x5aa7ff)),
    'W_ranger': dict(team='W', head='cap', torso='jacket', extras=['shemagh', 'pack'],
        L=dict(shirt=0xd8dde2, vest=0x9aa4ae, pants=0xc4cbd2, head=0x6b7480, skin=0xd2a684, sleeve=0xd0d6dc,
               glove=0x3a3f46, boot=0x3a3530, pouch=0x8a949e, belt=0x4a4f56, pack=0x7a848e, scarf=0x5a6a7a, helmet=0x6b7480)),
}

def character(cid):
    A = AGENTS[cid]
    L, t, hg, torso, ex = A['L'], A['team'], A['head'], A['torso'], A['extras']
    M = {k: mat(f'{cid}_{k}', v, rough=0.85) for k, v in L.items()}
    lens = mat('lens', 0x14181c, metal=0.4, rough=0.2)
    root = empty(f'{cid}_char', (0, 0, 0))
    n = lambda s: f'{cid}_{s}'
    bulk = 1.12 if torso == 'heavy' else 0.92 if torso == 'wetsuit' else 1.0
    for s, side in ((-1, 'L'), (1, 'R')):
        x = s * 0.11
        hip = empty(n(f'hip{side}'), (x, 0, 0.92), root)
        limb(n(f'thigh{side}'), (x, 0, 0.92), (x, 0.02, 0.48), 0.095 * bulk, M['pants'], hip, r2=0.08 * bulk)
        knee = empty(n(f'knee{side}'), (x, 0.02, 0.48), hip)
        limb(n(f'shin{side}'), (x, 0.02, 0.48), (x, 0, 0.1), 0.078 * bulk, M['pants'], knee, r2=0.065 * bulk)
        if torso != 'wetsuit':
            box(n(f'kneepad{side}'), (0.13, 0.06, 0.12), (x, 0.09, 0.48), M['pouch'], knee, bevel=0.015)
        else:
            box(n(f'fin{side}'), (0.12, 0.42, 0.03), (x, 0.2, 0.02), M['pouch'], knee, bevel=0.01)
        box(n(f'boot{side}'), (0.13, 0.27, 0.11), (x, 0.045, 0.055), M['boot'], knee, bevel=0.02)
        if torso == 'heavy':
            box(n(f'shinguard{side}'), (0.12, 0.05, 0.26), (x, 0.08, 0.3), M['vest'], knee, bevel=0.015)
            box(n(f'thighplate{side}'), (0.13, 0.05, 0.2), (x, 0.1, 0.72), M['vest'], hip, bevel=0.015)
        if 'tank' not in ex and side == 'R':
            box(n('holster'), (0.06, 0.1, 0.16), (x + 0.1, 0.0, 0.78), M['belt'], hip, bevel=0.01)
    upper = empty(n('upper'), (0, 0, 0), root)
    box(n('pelvis'), (0.34, 0.21, 0.17), (0, 0, 0.95), M['pants'], upper, bevel=0.03)
    box(n('belt'), (0.36, 0.23, 0.05), (0, 0, 1.03), M['belt'], upper, bevel=0.01)
    box(n('torso'), (0.38 * bulk, 0.22 * bulk, 0.42), (0, 0, 1.24), M['shirt'], upper, bevel=0.05)
    if torso == 'vest':
        box(n('vest'), (0.43, 0.29, 0.34), (0, 0, 1.25), M['vest'], upper, bevel=0.035)
        for i, px in enumerate((-0.12, 0, 0.12)):
            box(n(f'pouch{i}'), (0.1, 0.06, 0.12), (px, 0.17, 1.15), M['pouch'], upper, bevel=0.012)
    elif torso == 'heavy':
        box(n('vest'), (0.5, 0.36, 0.42), (0, 0, 1.24), M['vest'], upper, bevel=0.05)
        box(n('plate'), (0.36, 0.05, 0.3), (0, 0.19, 1.27), M['pouch'], upper, bevel=0.02)
        box(n('collar'), (0.36, 0.3, 0.08), (0, -0.01, 1.47), M['vest'], upper, bevel=0.03)
        box(n('groin'), (0.22, 0.05, 0.16), (0, 0.13, 0.95), M['vest'], upper, bevel=0.015)
        if 'accent' in L:
            box(n('stripe'), (0.37, 0.055, 0.03), (0, 0.19, 1.36), mat(f'{cid}_acc', L['accent'], rough=0.5), upper)
    elif torso == 'wetsuit':
        limb(n('strapL'), (-0.12, 0.12, 1.42), (0.1, 0.12, 1.06), 0.02, M['belt'], upper)
        limb(n('strapR'), (0.12, 0.12, 1.42), (-0.1, 0.12, 1.06), 0.02, M['belt'], upper)
        box(n('chestrig'), (0.18, 0.06, 0.12), (0, 0.13, 1.24), M['pouch'], upper, bevel=0.015)
        box(n('knifeSheath'), (0.04, 0.03, 0.18), (-0.15, 0.12, 1.2), M['belt'], upper)
    else:  # jacket
        box(n('jacket'), (0.44, 0.28, 0.46), (0, 0, 1.22), M['vest'], upper, bevel=0.05)
        for s in (-1, 1):
            box(n(f'flap{s}'), (0.2, 0.05, 0.22), (s * 0.11, 0.0, 0.92), M['vest'], upper, bevel=0.02)
            box(n(f'pocket{s}'), (0.1, 0.05, 0.1), (s * 0.11, 0.15, 1.12), M['pouch'], upper, bevel=0.012)
        box(n('zip'), (0.02, 0.02, 0.4), (0, 0.145, 1.22), M['belt'], upper)
    if 'plaid' in ex:
        for i in range(4):
            box(n(f'plaidH{i}'), (0.385, 0.225, 0.018), (0, 0, 1.06 + i * 0.06), mat(f'{cid}_plaid', L['plaid'], rough=0.9), upper)
    if 'bandolier' in ex:
        limb(n('bandolier'), (-0.2, 0.16, 1.44), (0.18, 0.16, 1.0), 0.03, M['belt'], upper)
        for i in range(5):
            k = i / 4
            box(n(f'shell{i}'), (0.03, 0.04, 0.05), (-0.18 + 0.36 * k, 0.19, 1.42 - 0.4 * k), M['pouch'], upper)
    box(n('radio'), (0.06, 0.05, 0.12), (0.17, 0.12, 1.36), M['belt'], upper, bevel=0.01)
    if 'pack' in ex:
        if t == 'S':
            box(n('pack'), (0.32, 0.14, 0.36), (0, -0.21, 1.25), M['pack'], upper, bevel=0.04)
            cyl(n('roll'), 0.06, 0.34, (0, -0.2, 1.47), M['pouch'], upper, rot=(0, RX, 0))
        else:
            box(n('pack'), (0.3, 0.1, 0.3), (0, -0.19, 1.27), M['pack'], upper, bevel=0.03)
    if 'tank' in ex:
        for s in (-1, 1):
            cyl(n(f'tank{s}'), 0.07, 0.48, (s * 0.08, -0.2, 1.22), M['pack'], upper, verts=12)
            sphere(n(f'tankcap{s}'), 0.07, (s * 0.08, -0.2, 1.46), M['pack'], upper, scale=(1, 1, 0.6))
        limb(n('hose'), (0.08, -0.2, 1.5), (0.06, 0.13, 1.62), 0.015, mat(f'{cid}_acc', L['accent'], rough=0.5), upper)
    if 'patch' in ex:
        box(n('patch'), (0.1, 0.01, 0.06), (0.1, 0.152 if torso == 'vest' else 0.19, 1.36), mat('patch', 0x5aa7ff, rough=0.5), upper)
    for s in (-1, 1):
        sphere(n(f'shoulder{"LR"[s > 0]}'), 0.085 * bulk, (s * 0.21 * bulk, 0, 1.4), M['sleeve'], upper)
        if 'pads' in ex:
            sphere(n(f'pad{"LR"[s > 0]}'), 0.11, (s * 0.24, 0, 1.43), M['vest'], upper, scale=(1, 1.1, 0.75))
    cyl(n('neck'), 0.06, 0.1, (0, 0, 1.48), M['skin'] if hg in ('helmet', 'cap', 'visor') else M['head'], upper)
    head = empty(n('head'), (0, 0, 1.5), upper)
    box(n('skull'), (0.2, 0.22, 0.25), (0, 0.01, 1.63), M['head'], head, bevel=0.05)
    if hg == 'balaclava':
        box(n('eyes'), (0.17, 0.05, 0.05), (0, 0.115, 1.66), M['skin'], head, bevel=0.01)
        box(n('brow'), (0.205, 0.03, 0.02), (0, 0.121, 1.695), M['head'], head)
        for s in (-1, 1):
            box(n(f'eye{"LR"[s > 0]}'), (0.03, 0.01, 0.02), (s * 0.045, 0.142, 1.66), lens, head)
    elif hg == 'helmet':
        sphere(n('helmet'), 0.15, (0, 0, 1.68), M['helmet'], head, scale=(0.95, 1.05, 0.72))
        box(n('goggles'), (0.19, 0.04, 0.06), (0, 0.12, 1.65), lens, head, bevel=0.01)
        box(n('strap'), (0.215, 0.2, 0.03), (0, 0.0, 1.66), M['belt'], head)
        box(n('nvg'), (0.06, 0.05, 0.05), (0, 0.13, 1.75), M['belt'], head, bevel=0.01)
    elif hg == 'hood':
        sphere(n('hood'), 0.16, (0, -0.015, 1.66), M['vest'], head, scale=(0.92, 1.0, 1.0))
        box(n('face'), (0.15, 0.03, 0.12), (0, 0.13, 1.63), M['skin'], head)
        box(n('goggles'), (0.17, 0.04, 0.05), (0, 0.145, 1.67), lens, head, bevel=0.01)
    elif hg == 'gasmask':
        sphere(n('mask'), 0.12, (0, 0.06, 1.62), M['vest'], head, scale=(0.95, 0.9, 1.05))
        for s in (-1, 1):
            cyl(n(f'lens{s}'), 0.035, 0.03, (s * 0.05, 0.155, 1.66), lens, head, rot=(RX, 0, 0), verts=10)
        cyl(n('filter'), 0.04, 0.07, (0, 0.18, 1.57), mat('g_filter', 0x2a2b2c, 0.3, 0.6), head, rot=(RX, 0, 0), verts=10)
        sphere(n('cap'), 0.13, (0, -0.01, 1.69), M['head'], head, scale=(1, 1.05, 0.7))
    elif hg == 'diver':
        sphere(n('hoodie'), 0.15, (0, 0, 1.65), M['helmet'], head, scale=(0.9, 1.0, 1.05))
        box(n('mask'), (0.18, 0.07, 0.08), (0, 0.13, 1.67), lens, head, bevel=0.02)
        box(n('maskframe'), (0.2, 0.05, 0.1), (0, 0.11, 1.67), mat(f'{cid}_acc', L['accent'], rough=0.5), head, bevel=0.02)
        box(n('mouth'), (0.06, 0.05, 0.05), (0, 0.13, 1.56), M['pouch'], head, bevel=0.01)
    elif hg == 'visor':
        sphere(n('helmet'), 0.16, (0, 0, 1.67), M['helmet'], head, scale=(0.98, 1.08, 0.82))
        box(n('visor'), (0.22, 0.04, 0.14), (0, 0.15, 1.63), mat('g_visor', 0x1a2a3a, 0.5, 0.05, 0.7), head, rot=(0.15, 0, 0))
        if 'accent' in L:
            box(n('hstripe'), (0.03, 0.26, 0.02), (0, 0.0, 1.81), mat(f'{cid}_acc', L['accent'], rough=0.5), head)
    elif hg == 'cap':
        box(n('face'), (0.17, 0.03, 0.16), (0, 0.125, 1.62), M['skin'], head)
        box(n('glasses'), (0.18, 0.02, 0.035), (0, 0.142, 1.67), lens, head)
        sphere(n('cap'), 0.13, (0, 0, 1.72), M['helmet'], head, scale=(1, 1.05, 0.55))
        box(n('brim'), (0.16, 0.1, 0.015), (0, 0.15, 1.73), M['helmet'], head)
    if 'shemagh' in ex:
        cyl(n('scarf'), 0.1, 0.09, (0, 0.01, 1.5), M['scarf'], upper, verts=10)
        box(n('scarftail'), (0.1, 0.03, 0.2), (0.06, -0.12, 1.4), M['scarf'], upper, rot=(0.3, 0, 0))
    arms = empty(n('arms'), (0, 0, 1.4), upper)
    ab = 1.1 if torso == 'heavy' else 1.0
    limb(n('uarmR'), (0.21, 0, 1.4), (0.2, 0.18, 1.2), 0.065 * ab, M['sleeve'], arms, r2=0.058 * ab)
    limb(n('farmR'), (0.2, 0.18, 1.2), (0.06, 0.38, 1.27), 0.055 * ab, M['sleeve'], arms, r2=0.048 * ab)
    sphere(n('handR'), 0.05, (0.05, 0.4, 1.28), M['glove'], arms)
    limb(n('uarmL'), (-0.21, 0, 1.4), (-0.19, 0.24, 1.22), 0.065 * ab, M['sleeve'], arms, r2=0.058 * ab)
    limb(n('farmL'), (-0.19, 0.24, 1.22), (0.03, 0.62, 1.3), 0.055 * ab, M['sleeve'], arms, r2=0.048 * ab)
    sphere(n('handL'), 0.05, (0.04, 0.64, 1.3), M['glove'], arms)
    if torso == 'heavy':
        for s in (-1, 1):
            limb(n(f'bracer{s}'), (s * 0.19 if s > 0 else -0.17, 0.22 if s > 0 else 0.3, 1.22), (0.1 if s > 0 else -0.06, 0.34 if s > 0 else 0.5, 1.26), 0.065, M['vest'], arms)
    empty(n('gun'), (0.05, 0.42, 1.32), arms)
    # first-person forearm: hand at the origin, sleeve running back toward the camera (-Y)
    vm = empty(n('vmarm'), (20, 0, 0))
    sphere(n('vmglove'), 0.045, (20, 0, 0), M['glove'], vm, scale=(1, 1.3, 0.9))
    limb(n('vmwrist'), (20, -0.03, 0), (20, -0.1, -0.02), 0.042, M['glove'], vm)
    limb(n('vmsleeve'), (20, -0.09, -0.02), (20, -0.42, -0.1), 0.05 * ab, M['sleeve'], vm, r2=0.06 * ab)
    box(n('vmcuff'), (0.11, 0.03, 0.1), (20, -0.1, -0.02), M['pouch'] if 'plaid' not in ex else mat(f'{cid}_plaid', L['plaid']), vm, bevel=0.01)
    if torso == 'heavy':
        box(n('vmbracer'), (0.12, 0.16, 0.11), (20, -0.2, -0.05), M['vest'], vm, bevel=0.02)

# ---------------------------------------------------------------- weapons
G = dict(
    metal=mat('g_metal', 0x2c2f33, 0.8, 0.45), black=mat('g_black', 0x18191b, 0.3, 0.6),
    steel=mat('g_steel', 0x9aa0a6, 0.9, 0.25), wood=mat('g_wood', 0x8a4a1f, 0, 0.55),
    tan=mat('g_tan', 0x8d7a5a, 0, 0.8), green=mat('g_green', 0x485a3a, 0, 0.7), olive=mat('g_olive', 0x5d6b3c, 0, 0.7),
    gray=mat('g_gray', 0x6c7075, 0.4, 0.6), orange=mat('g_orange', 0xd8762a, 0, 0.6), glass=mat('g_glass', 0x223344, 0.5, 0.1),
    cloth=mat('g_cloth', 0xd8d0b0, 0, 0.9), bottle=mat('g_bottle', 0x6a4416, 0.1, 0.15),
    screen=mat('g_screen', 0x3cff6a, 0, 0.3), red=mat('g_red', 0xff2020, 0, 0.3), wire=mat('g_wire', 0xc0302a, 0, 0.6))

def gun(gid, build):
    root = empty(f'{gid}_root', (0, 0, 0))
    build(root, lambda n: f'{gid}_{n}')
    return root

def ark7(r, n):
    box(n('recv'), (0.062, 0.36, 0.085), (0, 0.04, 0.02), G['metal'], r, bevel=0.008)
    box(n('cover'), (0.056, 0.3, 0.03), (0, 0.06, 0.075), G['metal'], r, bevel=0.01)
    cyl(n('barrel'), 0.012, 0.36, (0, 0.42, 0.045), G['metal'], r, rot=(RX, 0, 0), verts=8)
    cyl(n('brake'), 0.017, 0.06, (0, 0.62, 0.045), G['metal'], r, rot=(RX, 0, 0), verts=8)
    box(n('guard'), (0.064, 0.2, 0.06), (0, 0.31, 0.02), G['wood'], r, bevel=0.012)
    cyl(n('gas'), 0.013, 0.2, (0, 0.33, 0.078), G['wood'], r, rot=(RX, 0, 0), verts=8)
    box(n('fsight'), (0.012, 0.012, 0.05), (0, 0.55, 0.075), G['metal'], r)
    box(n('rsight'), (0.03, 0.04, 0.025), (0, 0.12, 0.09), G['metal'], r)
    box(n('stock'), (0.048, 0.27, 0.075), (0, -0.28, 0.0), G['wood'], r, bevel=0.01, rot=(0.12, 0, 0))
    box(n('butt'), (0.05, 0.03, 0.12), (0, -0.41, -0.025), G['black'], r, bevel=0.005)
    box(n('grip'), (0.038, 0.05, 0.11), (0, -0.09, -0.07), G['wood'], r, bevel=0.008, rot=(-0.3, 0, 0))
    box(n('mag1'), (0.042, 0.07, 0.09), (0, 0.1, -0.06), G['metal'], r, bevel=0.006, rot=(0.2, 0, 0))
    box(n('mag2'), (0.042, 0.07, 0.09), (0, 0.13, -0.14), G['metal'], r, bevel=0.006, rot=(0.45, 0, 0))
    box(n('trigger'), (0.04, 0.06, 0.012), (0, -0.03, -0.035), G['metal'], r)
    empty(n('muzzle'), (0, 0.66, 0.045), r); empty(n('fore'), (0, 0.32, -0.01), r)

def m4r(r, n):
    box(n('recv'), (0.058, 0.32, 0.08), (0, 0.02, 0.02), G['black'], r, bevel=0.008)
    box(n('rail'), (0.03, 0.42, 0.025), (0, 0.12, 0.075), G['black'], r)
    for i in range(10):
        box(n(f'tooth{i}'), (0.034, 0.012, 0.012), (0, -0.07 + i * 0.04, 0.09), G['black'], r)
    box(n('guard'), (0.066, 0.24, 0.068), (0, 0.3, 0.03), G['tan'], r, bevel=0.012)
    cyl(n('barrel'), 0.012, 0.28, (0, 0.52, 0.04), G['black'], r, rot=(RX, 0, 0), verts=8)
    cyl(n('flash'), 0.017, 0.05, (0, 0.67, 0.04), G['black'], r, rot=(RX, 0, 0), verts=6)
    box(n('fsight'), (0.012, 0.012, 0.06), (0, 0.46, 0.09), G['black'], r)
    box(n('optic'), (0.04, 0.07, 0.05), (0, 0.06, 0.12), G['black'], r, bevel=0.01)
    box(n('lens'), (0.03, 0.005, 0.035), (0, 0.096, 0.12), G['glass'], r)
    box(n('buffer'), (0.03, 0.18, 0.035), (0, -0.2, 0.04), G['black'], r, bevel=0.005)
    box(n('stock'), (0.05, 0.14, 0.09), (0, -0.3, 0.01), G['tan'], r, bevel=0.012)
    box(n('grip'), (0.036, 0.05, 0.11), (0, -0.1, -0.07), G['black'], r, bevel=0.008, rot=(-0.3, 0, 0))
    box(n('mag'), (0.03, 0.065, 0.15), (0, 0.08, -0.09), G['tan'], r, bevel=0.005, rot=(0.12, 0, 0))
    empty(n('muzzle'), (0, 0.7, 0.04), r); empty(n('fore'), (0, 0.32, -0.01), r)

def vex(r, n):
    box(n('recv'), (0.058, 0.3, 0.1), (0, 0.04, 0.02), G['black'], r, bevel=0.012)
    box(n('front'), (0.05, 0.12, 0.05), (0, 0.18, 0.02), G['gray'], r, bevel=0.008)
    cyl(n('barrel'), 0.014, 0.12, (0, 0.27, 0.04), G['metal'], r, rot=(RX, 0, 0), verts=8)
    box(n('mag'), (0.036, 0.045, 0.2), (0, 0.09, -0.12), G['black'], r, bevel=0.005, rot=(0.05, 0, 0))
    box(n('grip'), (0.036, 0.05, 0.1), (0, -0.07, -0.07), G['black'], r, bevel=0.008, rot=(-0.25, 0, 0))
    limb(n('stockA'), (0.022, -0.1, 0.04), (0.022, -0.32, 0.04), 0.006, G['metal'], r)
    limb(n('stockB'), (-0.022, -0.1, 0.0), (-0.022, -0.32, 0.0), 0.006, G['metal'], r)
    box(n('butt'), (0.06, 0.012, 0.07), (0, -0.33, 0.02), G['metal'], r)
    box(n('sight'), (0.02, 0.06, 0.03), (0, 0.02, 0.085), G['black'], r)
    empty(n('muzzle'), (0, 0.33, 0.04), r); empty(n('fore'), (0, 0.16, -0.03), r)

def breacher(r, n):
    cyl(n('barrel'), 0.019, 0.62, (0, 0.36, 0.06), G['metal'], r, rot=(RX, 0, 0))
    cyl(n('tube'), 0.016, 0.48, (0, 0.3, 0.02), G['metal'], r, rot=(RX, 0, 0))
    box(n('recv'), (0.062, 0.26, 0.075), (0, 0.0, 0.035), G['metal'], r, bevel=0.01)
    cyl(n('pump'), 0.032, 0.16, (0, 0.3, 0.025), G['wood'], r, rot=(RX, 0, 0), verts=10)
    box(n('stock'), (0.052, 0.3, 0.1), (0, -0.27, -0.02), G['wood'], r, bevel=0.015, rot=(0.15, 0, 0))
    box(n('grip'), (0.04, 0.05, 0.09), (0, -0.09, -0.055), G['wood'], r, bevel=0.01, rot=(-0.3, 0, 0))
    sphere(n('bead'), 0.006, (0, 0.66, 0.082), G['steel'], r)
    empty(n('muzzle'), (0, 0.68, 0.06), r); empty(n('fore'), (0, 0.3, -0.005), r)

def longshot(r, n):
    box(n('body'), (0.07, 0.5, 0.1), (0, 0.0, 0.0), G['green'], r, bevel=0.015)
    cyl(n('barrel'), 0.016, 0.62, (0, 0.56, 0.03), G['metal'], r, rot=(RX, 0, 0), verts=8)
    cyl(n('brake'), 0.022, 0.07, (0, 0.88, 0.03), G['metal'], r, rot=(RX, 0, 0), verts=8)
    cyl(n('scope'), 0.026, 0.32, (0, 0.02, 0.12), G['black'], r, rot=(RX, 0, 0))
    cyl(n('obj'), 0.037, 0.08, (0, 0.2, 0.12), G['black'], r, rot=(RX, 0, 0), r2=0.026)
    cyl(n('ocu'), 0.032, 0.06, (0, -0.16, 0.12), G['black'], r, rot=(RX, 0, 0))
    cyl(n('turret'), 0.014, 0.04, (0, 0.03, 0.155), G['black'], r)
    box(n('mount1'), (0.02, 0.02, 0.05), (0, -0.06, 0.075), G['black'], r)
    box(n('mount2'), (0.02, 0.02, 0.05), (0, 0.08, 0.075), G['black'], r)
    box(n('stock'), (0.06, 0.28, 0.13), (0, -0.36, -0.02), G['green'], r, bevel=0.02, rot=(0.08, 0, 0))
    box(n('cheek'), (0.05, 0.14, 0.04), (0, -0.33, 0.06), G['green'], r, bevel=0.01)
    box(n('grip'), (0.045, 0.06, 0.12), (0, -0.14, -0.08), G['green'], r, bevel=0.01, rot=(-0.3, 0, 0))
    box(n('mag'), (0.04, 0.1, 0.06), (0, 0.06, -0.07), G['black'], r, bevel=0.005)
    limb(n('bolt'), (0.04, -0.12, 0.04), (0.08, -0.12, 0.04), 0.008, G['steel'], r)
    sphere(n('knob'), 0.015, (0.085, -0.12, 0.04), G['black'], r)
    empty(n('muzzle'), (0, 0.92, 0.03), r); empty(n('fore'), (0, 0.22, -0.04), r)

def pistol(slide_m, frame_m, length, chunky=1.0):
    def b(r, n):
        box(n('slide'), (0.032 * chunky, length, 0.042 * chunky), (0, 0.05, 0.03), slide_m, r, bevel=0.006)
        box(n('frame'), (0.03 * chunky, length * 0.8, 0.03), (0, 0.04, -0.005), frame_m, r, bevel=0.005)
        box(n('grip'), (0.03 * chunky, 0.048, 0.11), (0, -0.03, -0.06), frame_m, r, bevel=0.008, rot=(-0.25, 0, 0))
        box(n('guard'), (0.01, 0.05, 0.01), (0, 0.04, -0.035), frame_m, r)
        box(n('fsight'), (0.01, 0.01, 0.012), (0, 0.04 + length * 0.47, 0.056 * chunky), G['black'], r)
        box(n('rsight'), (0.026, 0.01, 0.012), (0, 0.05 - length * 0.45, 0.056 * chunky), G['black'], r)
        empty(n('muzzle'), (0, 0.06 + length / 2, 0.03), r); empty(n('fore'), (-0.01, -0.02, -0.06), r)
    return b

def knife(r, n):
    box(n('handle'), (0.026, 0.11, 0.036), (0, -0.04, 0), G['black'], r, bevel=0.008)
    box(n('guard'), (0.032, 0.012, 0.05), (0, 0.02, 0), G['metal'], r, bevel=0.003)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.13, 0.004))
    o = bpy.context.object
    o.scale = (0.006, 0.2, 0.036)
    _apply(o)
    for v in o.data.vertices:  # taper the blade to a point
        if v.co.y > 0:
            v.co.z = v.co.z * 0.15 - 0.012
    finish(o, n('blade'), G['steel'], r)
    empty(n('muzzle'), (0, 0.24, 0), r); empty(n('fore'), (0, -0.04, 0), r)

def he(r, n):
    sphere(n('body'), 0.04, (0, 0, 0), G['olive'], r, scale=(1, 1, 1.15))
    cyl(n('fuse'), 0.012, 0.03, (0, 0, 0.055), G['gray'], r)
    box(n('lever'), (0.012, 0.018, 0.07), (0.02, 0, 0.035), G['gray'], r, rot=(0, 0.25, 0))
    sphere(n('ring'), 0.012, (-0.015, 0, 0.07), G['steel'], r, scale=(1, 0.3, 1))
    empty(n('muzzle'), (0, 0, 0), r); empty(n('fore'), (0, 0, 0), r)

def canister(body, band):
    def b(r, n):
        cyl(n('body'), 0.027, 0.11, (0, 0, 0), body, r, verts=12)
        cyl(n('band'), 0.028, 0.02, (0, 0, 0.025), band, r, verts=12)
        cyl(n('top'), 0.012, 0.02, (0, 0, 0.065), G['black'], r)
        box(n('lever'), (0.012, 0.018, 0.08), (0.028, 0, 0.03), G['gray'], r)
        empty(n('muzzle'), (0, 0, 0), r); empty(n('fore'), (0, 0, 0), r)
    return b

def bottle(r, n):
    cyl(n('body'), 0.034, 0.12, (0, 0, 0), G['bottle'], r, verts=12)
    cyl(n('neck'), 0.012, 0.07, (0, 0, 0.09), G['bottle'], r, verts=8, r2=0.01)
    box(n('rag'), (0.03, 0.03, 0.06), (0, 0, 0.14), G['cloth'], r, rot=(0.2, 0.1, 0))
    empty(n('muzzle'), (0, 0, 0), r); empty(n('fore'), (0, 0, 0), r)

def bomb(r, n):
    box(n('brick'), (0.22, 0.14, 0.08), (0, 0, 0), G['tan'], r, bevel=0.01)
    for i, x in enumerate((-0.06, 0.0, 0.06)):
        box(n(f'tape{i}'), (0.025, 0.145, 0.082), (x, 0, 0), G['black'], r)
    box(n('pad'), (0.09, 0.08, 0.025), (-0.04, 0, 0.05), G['black'], r, bevel=0.005)
    box(n('screen'), (0.06, 0.03, 0.005), (-0.04, -0.015, 0.064), G['screen'], r)
    for i in range(3):
        box(n(f'key{i}'), (0.012, 0.012, 0.006), (-0.06 + i * 0.02, 0.022, 0.064), G['gray'], r)
    limb(n('wireA'), (0.04, -0.03, 0.045), (0.09, 0.03, 0.045), 0.005, G['wire'], r)
    limb(n('wireB'), (0.04, 0.03, 0.045), (0.09, -0.03, 0.045), 0.005, mat('g_bwire', 0x2a5ac0), r)
    sphere(n('led'), 0.009, (0.06, 0.045, 0.045), G['red'], r)
    empty(n('muzzle'), (0, 0, 0), r); empty(n('fore'), (0, 0, 0), r)

# ---------------------------------------------------------------- props
def barrel():
    r = empty('barrel_root', (0, 0, 0))
    wood = mat('p_barrelwood', 0x8a5e33, 0, 0.85)
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.34, depth=1.04, location=(0, 0, 0.52))
    o = bpy.context.object
    for v in o.data.vertices:  # bulge in the middle
        k = 1 + 0.09 * (1 - (abs(v.co.z) / 0.52) ** 2)
        v.co.x *= k; v.co.y *= k
    finish(o, 'barrel_body', wood, r, smooth=True)
    for i, z in enumerate((0.12, 0.38, 0.66, 0.92)):
        rr = 0.345 + 0.03 * (1 - ((z - 0.52) / 0.52) ** 2)
        cyl(f'barrel_hoop{i}', rr, 0.04, (0, 0, z), mat('p_hoop', 0x2e2a26, 0.6, 0.5), r, verts=14)
    cyl('barrel_lid', 0.3, 0.01, (0, 0, 1.04), mat('p_lid', 0x6b4520, 0, 0.9), r, verts=14)

def car(name, col, van):
    r = empty(f'{name}_root', (0, 0, 0))
    body = mat(f'{name}_paint', col, 0.3, 0.45)
    dark = mat('p_tyre', 0x1e1f21, 0, 0.9)
    glass = mat('p_carglass', 0x2a3c48, 0.6, 0.1)
    chrome = mat('p_chrome', 0xb8bcc0, 0.9, 0.2)
    lamp = mat('p_lamp', 0xfff1c0, 0, 0.3)
    box(f'{name}_lower', (1.7, 3.8, 0.62), (0, 0, 0.62), body, r, bevel=0.08)
    if van:
        box(f'{name}_cab', (1.66, 2.5, 1.05), (0, -0.55, 1.45), body, r, bevel=0.08)
        box(f'{name}_wind', (1.5, 0.05, 0.5), (0, 0.72, 1.6), glass, r, rot=(-0.25, 0, 0))
        for s in (-1, 1):
            box(f'{name}_sidewin{s}', (0.03, 0.7, 0.42), (s * 0.835, 0.3, 1.62), glass, r)
    else:
        box(f'{name}_cab', (1.56, 1.9, 0.56), (0, -0.25, 1.2), body, r, bevel=0.12)
        box(f'{name}_wind', (1.4, 0.05, 0.45), (0, 0.72, 1.18), glass, r, rot=(-0.7, 0, 0))
        box(f'{name}_rwind', (1.4, 0.05, 0.42), (0, -1.2, 1.18), glass, r, rot=(0.7, 0, 0))
        for s in (-1, 1):
            box(f'{name}_sidewin{s}', (0.03, 1.5, 0.36), (s * 0.785, -0.25, 1.24), glass, r)
    for i, (x, y) in enumerate(((0.8, 1.2), (-0.8, 1.2), (0.8, -1.2), (-0.8, -1.2))):
        cyl(f'{name}_wheel{i}', 0.34, 0.24, (x, y, 0.34), dark, r, rot=(0, RX, 0), verts=12)
        cyl(f'{name}_hub{i}', 0.16, 0.25, (x, y, 0.34), chrome, r, rot=(0, RX, 0), verts=8)
    box(f'{name}_bumperF', (1.72, 0.12, 0.16), (0, 1.92, 0.42), chrome, r, bevel=0.03)
    box(f'{name}_bumperR', (1.72, 0.12, 0.16), (0, -1.92, 0.42), chrome, r, bevel=0.03)
    for s in (-1, 1):
        box(f'{name}_head{s}', (0.3, 0.04, 0.14), (s * 0.6, 1.9, 0.72), lamp, r)
        box(f'{name}_tail{s}', (0.25, 0.04, 0.12), (s * 0.62, -1.9, 0.72), mat('p_tail', 0xb02020, 0, 0.4), r)

def palm():
    r = empty('palm_root', (0, 0, 0))
    bark = mat('p_bark', 0x8a6a45, 0, 0.95)
    leaf = mat('p_leaf', 0x4e7d34, 0, 0.8)
    leaf2 = mat('p_leaf2', 0x3d6a2a, 0, 0.8)
    pts = [Vector((0.0, 0.0, 0.0))]
    for i in range(1, 7):  # gently curving trunk, 1 unit tall in total (scaled in game)
        t = i / 6
        pts.append(Vector((0.08 * t * t, 0.0, t)))
    for i in range(6):
        limb(f'palm_trunk{i}', pts[i], pts[i + 1], 0.028 - i * 0.0025, bark, r, r2=0.026 - i * 0.0025, verts=7)
        cyl(f'palm_ring{i}', 0.03 - i * 0.0025, 0.012, pts[i + 1] - Vector((0, 0, 0.01)), bark, r, verts=7)
    top = pts[-1]
    for i in range(9):
        a = i / 9 * math.tau + (0.2 if i % 2 else 0)
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
        o = bpy.context.object
        me = o.data
        # frond: a strip bent downward, built along +X then rotated around the trunk
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.subdivide(number_cuts=5)
        bpy.ops.object.mode_set(mode='OBJECT')
        for v in me.vertices:
            u = v.co.x + 0.5              # 0..1 along the frond
            w = v.co.y * (0.09 * math.sin(math.pi * min(1, u * 1.1)) + 0.01)
            v.co.x = u * 0.36
            v.co.y = w
            v.co.z = 0.06 * u - 0.2 * u * u * (1.2 if i % 2 else 1)
        o.rotation_euler = (0.1 if i % 2 else -0.1, 0, a)
        o.location = top
        finish(o, f'palm_frond{i}', leaf if i % 2 else leaf2, r)
    for i in range(4):
        sphere(f'palm_nut{i}', 0.012, top + Vector((0.015 * math.cos(i * 1.6), 0.015 * math.sin(i * 1.6), -0.02)), mat('p_nut', 0x5a4020), r, seg=6, rings=4)

def crate(name, h, w=1.9):
    """Wooden crate: dark frame beams, lighter plank faces and a diagonal brace (origin at the bottom centre)."""
    r = empty(f'{name}_root', (0, 0, 0))
    plank = mat('p_plank', 0xa87a46, 0, 0.85)
    frame = mat('p_frame', 0x6b4520, 0, 0.9)
    box(f'{name}_core', (w - 0.06, w - 0.06, h - 0.06), (0, 0, h / 2), plank, r)
    b = 0.12
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'{name}_post{sx}{sy}', (b, b, h), (sx * (w / 2 - b / 2), sy * (w / 2 - b / 2), h / 2), frame, r)
    for z in (b / 2, h - b / 2):
        for sy in (-1, 1):
            box(f'{name}_beamx{z:.2f}{sy}', (w, b, b), (0, sy * (w / 2 - b / 2), z), frame, r)
        for sx in (-1, 1):
            box(f'{name}_beamy{z:.2f}{sx}', (b, w, b), (sx * (w / 2 - b / 2), 0, z), frame, r)
    diag = math.hypot(w - 2 * b, h - 2 * b)
    ang = math.atan2(h - 2 * b, w - 2 * b)
    for sy in (-1, 1):
        box(f'{name}_bracey{sy}', (diag, 0.04, 0.1), (0, sy * (w / 2 + 0.01), h / 2), frame, r, rot=(0, -ang * sy, 0))
    for sx in (-1, 1):
        box(f'{name}_bracex{sx}', (0.04, diag, 0.1), (sx * (w / 2 + 0.01), 0, h / 2), frame, r, rot=(ang * sx, 0, 0))
    for i in range(1, 4):
        z = h * i / 4
        for sy in (-1, 1):
            box(f'{name}_seamy{i}{sy}', (w - 2 * b, 0.012, 0.012), (0, sy * (w / 2 - 0.025), z), frame, r)
        for sx in (-1, 1):
            box(f'{name}_seamx{i}{sx}', (0.012, w - 2 * b, 0.012), (sx * (w / 2 - 0.025), 0, z), frame, r)

def crate_stack():
    r = empty('crateC_root', (0, 0, 0))
    crate('crateC_lo', 1.15)
    bpy.data.objects['crateC_lo_root'].parent = r
    crate('crateC_hi', 1.15, 1.6)
    hi = bpy.data.objects['crateC_hi_root']
    hi.location = (0.08, -0.05, 1.15); hi.rotation_euler = (0, 0, 0.12); hi.parent = r

def panel():
    """Thin wooden wall section, 2 m wide, 3 m tall, 0.24 m thick (shootable through)."""
    r = empty('panel_root', (0, 0, 0))
    plank = mat('p_plank', 0xa87a46, 0, 0.85)
    frame = mat('p_frame', 0x6b4520, 0, 0.9)
    for i in range(8):
        x = -0.875 + i * 0.25
        box(f'panel_board{i}', (0.235, 0.2, 2.96), (x, 0, 1.48), plank if i % 3 else mat('p_plank2', 0x94683a, 0, 0.85), r)
    for z in (0.5, 2.5):
        box(f'panel_rail{z}', (2.0, 0.24, 0.16), (0, 0, z), frame, r)
    box('panel_cap', (2.0, 0.26, 0.08), (0, 0, 2.98), frame, r)

def door():
    """Closed wooden door with frame and handle, sits flat against a wall (front faces +Y)."""
    r = empty('door_root', (0, 0, 0))
    wood = mat('p_doorwood', 0x7a4f2a, 0, 0.8)
    frame = mat('p_doorframe', 0x5a3a1e, 0, 0.9)
    box('door_leaf', (1.2, 0.06, 2.3), (0, 0.03, 1.15), wood, r)
    for i in range(4):
        box(f'door_board{i}', (0.02, 0.07, 2.25), (-0.45 + i * 0.3, 0.035, 1.15), frame, r)
    for z in (0.4, 1.9):
        box(f'door_strap{z}', (1.1, 0.08, 0.07), (0, 0.04, z), mat('p_iron', 0x2e2a26, 0.6, 0.5), r)
    box('door_top', (1.6, 0.14, 0.2), (0, 0.07, 2.4), frame, r)
    for s in (-1, 1):
        box(f'door_jamb{s}', (0.15, 0.12, 2.3), (s * 0.68, 0.06, 1.15), frame, r)
    sphere('door_knob', 0.04, (0.42, 0.1, 1.1), mat('p_brass', 0xb08a3a, 0.8, 0.3), r)

def window():
    """Window with frame, sill, dark glass and two shutters (front faces +Y), bottom at z = 0."""
    r = empty('window_root', (0, 0, 0))
    frame = mat('p_winframe', 0xbfa27a, 0, 0.8)
    glass = mat('p_winglass', 0x1d2228, 0.4, 0.15)
    shut = mat('p_shutter', 0x3f6f58, 0, 0.8)
    box('window_glass', (0.9, 0.04, 1.3), (0, 0.02, 0.65), glass, r)
    box('window_mull', (0.05, 0.08, 1.3), (0, 0.04, 0.65), frame, r)
    box('window_tran', (0.9, 0.08, 0.05), (0, 0.04, 0.9), frame, r)
    for s in (-1, 1):
        box(f'window_side{s}', (0.12, 0.12, 1.5), (s * 0.51, 0.06, 0.65), frame, r)
        box(f'window_shutter{s}', (0.42, 0.05, 1.3), (s * 0.8, 0.06, 0.65), shut, r)
        for k in range(6):
            box(f'window_slat{s}{k}', (0.38, 0.06, 0.03), (s * 0.8, 0.07, 0.15 + k * 0.2), mat('p_shutter2', 0x335c49, 0, 0.8), r)
    box('window_sill', (1.3, 0.2, 0.08), (0, 0.1, -0.04), frame, r)
    box('window_head', (1.3, 0.14, 0.12), (0, 0.07, 1.36), frame, r)

def awning(name, col):
    """Sloped cloth awning on two brackets (front faces +Y), mounted at z = 0 on the wall."""
    r = empty(f'{name}_root', (0, 0, 0))
    cloth = mat(f'{name}_cloth', col, 0, 0.9)
    stripe = mat('p_awstripe', 0xeee6d2, 0, 0.9)
    for i in range(6):
        box(f'{name}_strip{i}', (0.3, 1.1, 0.02), (-0.75 + i * 0.3, 0.5, -0.27), cloth if i % 2 == 0 else stripe, r, rot=(-0.5, 0, 0))
    for i in range(6):
        box(f'{name}_flap{i}', (0.3, 0.02, 0.18), (-0.75 + i * 0.3, 0.97, -0.6), cloth if i % 2 == 0 else stripe, r)
    for s in (-1, 1):
        limb(f'{name}_arm{s}', (s * 0.85, 0, -0.8), (s * 0.85, 0.95, -0.52), 0.015, mat('p_iron', 0x2e2a26, 0.6, 0.5), r)

def lamp():
    """Wall lamp on a curled bracket (front faces +Y)."""
    r = empty('lamp_root', (0, 0, 0))
    iron = mat('p_iron', 0x2e2a26, 0.6, 0.5)
    box('lamp_plate', (0.12, 0.03, 0.2), (0, 0.015, 0), iron, r)
    limb('lamp_arm', (0, 0.02, 0), (0, 0.35, 0.12), 0.015, iron, r)
    cyl('lamp_cap', 0.1, 0.06, (0, 0.38, 0.1), iron, r, verts=6, r2=0.03)
    cyl('lamp_glass', 0.07, 0.18, (0, 0.38, -0.02), mat('p_lampglass', 0xffe2a0, 0, 0.2), r, verts=6, r2=0.09)

def plant():
    """Clay pot with a small shrub, sits on the ground."""
    r = empty('plant_root', (0, 0, 0))
    cyl('plant_pot', 0.22, 0.4, (0, 0, 0.2), mat('p_clay', 0xb0603a, 0, 0.9), r, verts=10, r2=0.3)
    for i in range(5):
        a = i * 1.26
        sphere(f'plant_bush{i}', 0.18, (0.1 * math.cos(a), 0.1 * math.sin(a), 0.5 + 0.06 * (i % 2)), mat('p_bush', 0x557a36, 0, 0.9), r, seg=7, rings=5)

def container(name, col):
    """20 ft shipping container, 6.0 x 2.4 x 2.6 m, long axis along Y, origin at the bottom centre."""
    r = empty(f'{name}_root', (0, 0, 0))
    paint = mat(f'{name}_paint', col, 0.35, 0.55)
    dark = mat(f'{name}_rib', ((col >> 1) & 0x7f7f7f), 0.35, 0.6)
    steel = mat('p_cbar', 0x8a8f94, 0.8, 0.35)
    box(f'{name}_shell', (2.36, 5.96, 2.56), (0, 0, 1.3), paint, r)
    for i in range(14):
        y = -2.7 + i * 0.415
        for sx in (-1, 1):
            box(f'{name}_rib{i}{sx}', (0.06, 0.16, 2.3), (sx * 1.19, y, 1.3), dark, r)
    for z in (0.06, 2.54):
        for sx in (-1, 1):
            box(f'{name}_rail{z}{sx}', (0.12, 6.0, 0.12), (sx * 1.16, 0, z), dark, r)
    for sy in (-1, 1):
        for sx in (-1, 1):
            box(f'{name}_post{sx}{sy}', (0.14, 0.14, 2.6), (sx * 1.15, sy * 2.95, 1.3), dark, r)
            box(f'{name}_corner{sx}{sy}', (0.18, 0.18, 0.14), (sx * 1.13, sy * 2.93, 2.55), steel, r)
    for i, x in enumerate((-0.75, -0.35, 0.35, 0.75)):
        limb(f'{name}_lockbar{i}', (x, 3.02, 0.15), (x, 3.02, 2.45), 0.02, steel, r)
    box(f'{name}_doorseam', (0.03, 0.02, 2.3), (0, 3.0, 1.3), dark, r)
    box(f'{name}_label', (0.02, 1.4, 0.4), (1.23, 1.6, 2.1), mat('p_clabel', 0xece6d6, 0, 0.8), r)

def pine(name, snow):
    r = empty(f'{name}_root', (0, 0, 0))
    bark = mat('p_pinebark', 0x4a3424, 0, 0.95)
    needle = mat('p_needle', 0x2c4a2e, 0, 0.9)
    white = mat('p_snow', 0xf2f5f8, 0, 0.6)
    cyl(f'{name}_trunk', 0.035, 0.35, (0, 0, 0.175), bark, r, verts=7, r2=0.025)
    for i, (z, rad, h) in enumerate(((0.22, 0.26, 0.32), (0.42, 0.21, 0.28), (0.6, 0.16, 0.24), (0.76, 0.11, 0.2), (0.9, 0.06, 0.16))):
        cyl(f'{name}_tier{i}', rad, h, (0, 0, z + h / 2), needle, r, verts=9, r2=0.0)
        if snow:
            cyl(f'{name}_snow{i}', rad * 0.9, h * 0.55, (0, 0, z + h * 0.72), white, r, verts=9, r2=0.0)

def pallets():
    r = empty('pallets_root', (0, 0, 0))
    wood = mat('p_pallet', 0xb08a58, 0, 0.9)
    wrap = mat('p_wrap', 0xd8dfe4, 0.1, 0.25, 0.85)
    tan = mat('p_carton', 0xb7905e, 0, 0.9)
    for lvl in range(2):
        z0 = lvl * 0.14
        for i in range(3):
            box(f'pallets_block{lvl}{i}', (1.2, 0.1, 0.1), (0, -0.45 + i * 0.45, z0 + 0.05), wood, r)
        for i in range(5):
            box(f'pallets_top{lvl}{i}', (0.18, 1.0, 0.03), (-0.5 + i * 0.25, 0, z0 + 0.115), wood, r)
    for i in range(2):
        for j in range(2):
            box(f'pallets_carton{i}{j}', (0.56, 0.47, 0.42), (-0.29 + i * 0.58, -0.25 + j * 0.5, 0.5), tan, r, bevel=0.01)
            box(f'pallets_carton2{i}{j}', (0.56, 0.47, 0.42), (-0.29 + i * 0.58, -0.25 + j * 0.5, 0.93), tan, r, bevel=0.01)
    box('pallets_wrap', (1.22, 1.02, 0.88), (0, 0, 0.72), wrap, r)

def crane():
    """Dock gantry crane, about 30 m tall (decoration outside the playable area)."""
    r = empty('crane_root', (0, 0, 0))
    yel = mat('p_crane', 0xd8a028, 0.4, 0.5)
    dark = mat('p_cranedark', 0x3a3a3a, 0.5, 0.5)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'crane_leg{sx}{sy}', (0.9, 0.9, 24), (sx * 6, sy * 5, 12), yel, r)
        box(f'crane_tie{sx}', (0.6, 10.9, 0.6), (sx * 6, 0, 3), yel, r)
        box(f'crane_tie2{sx}', (0.6, 10.9, 0.6), (sx * 6, 0, 16), yel, r)
        limb(f'crane_brace{sx}', (sx * 6, -5, 3), (sx * 6, 5, 16), 0.25, yel, r)
    box('crane_beamA', (13, 1.4, 1.8), (0, -5, 24.5), yel, r)
    box('crane_beamB', (13, 1.4, 1.8), (0, 5, 24.5), yel, r)
    box('crane_boom', (2.2, 46, 1.6), (0, 8, 26.2), yel, r)
    box('crane_cab', (3, 3, 2.6), (0, 3, 22.2), dark, r, bevel=0.1)
    box('crane_window', (2.6, 0.1, 1.2), (0, 4.52, 22.5), mat('p_carglass', 0x2a3c48, 0.6, 0.1), r)
    box('crane_house', (5, 5, 3.4), (0, -9, 28.5), yel, r, bevel=0.1)
    box('crane_trolley', (2.6, 3, 1.4), (0, 18, 24.8), dark, r)
    limb('crane_cable', (0, 18, 24), (0, 18, 12), 0.05, dark, r)
    box('crane_spreader', (2.6, 6, 0.4), (0, 18, 11.8), yel, r)

def bollard():
    r = empty('bollard_root', (0, 0, 0))
    iron = mat('p_bollard', 0x2e3134, 0.7, 0.45)
    cyl('bollard_post', 0.18, 0.55, (0, 0, 0.275), iron, r, verts=12, r2=0.15)
    cyl('bollard_cap', 0.24, 0.1, (0, 0, 0.6), iron, r, verts=12)

def streetlamp():
    r = empty('streetlamp_root', (0, 0, 0))
    iron = mat('p_iron', 0x2e2a26, 0.6, 0.5)
    cyl('streetlamp_base', 0.14, 0.5, (0, 0, 0.25), iron, r, verts=8)
    cyl('streetlamp_pole', 0.06, 4.6, (0, 0, 2.8), iron, r, verts=8, r2=0.045)
    limb('streetlamp_arm', (0, 0, 5.0), (0, 0.8, 5.2), 0.035, iron, r)
    box('streetlamp_head', (0.34, 0.5, 0.12), (0, 0.95, 5.15), iron, r, bevel=0.03)
    box('streetlamp_glow', (0.28, 0.42, 0.03), (0, 0.95, 5.08), mat('p_lampglass', 0xffe2a0, 0, 0.2), r)

def sandbags():
    """A two-row wall of sandbags, 2 m long, 0.8 m tall, long axis along X."""
    r = empty('sandbags_root', (0, 0, 0))
    bag = mat('p_bag', 0xb9a57a, 0, 0.95)
    bag2 = mat('p_bag2', 0xa8946a, 0, 0.95)
    k = 0
    for row, (z, off) in enumerate(((0.14, 0.0), (0.4, 0.2), (0.65, 0.0))):
        for i in range(4 if off else 5):
            for d in (-0.2, 0.2):
                sphere(f'sandbags_b{k}', 0.24, (-0.8 + off + i * 0.4, d, z), bag if (i + row) % 2 else bag2, r, scale=(0.95, 0.75, 0.55), seg=8, rings=5)
                k += 1

def drum(name, col):
    r = empty(f'{name}_root', (0, 0, 0))
    paint = mat(f'{name}_paint', col, 0.5, 0.45)
    cyl(f'{name}_body', 0.29, 0.88, (0, 0, 0.44), paint, r, verts=14)
    for i, z in enumerate((0.03, 0.3, 0.58, 0.86)):
        cyl(f'{name}_rib{i}', 0.3, 0.035, (0, 0, z), paint, r, verts=14)
    cyl(f'{name}_cap', 0.04, 0.02, (0.15, 0.0, 0.89), mat('p_iron', 0x2e2a26, 0.6, 0.5), r, verts=8)

def forklift():
    r = empty('forklift_root', (0, 0, 0))
    yel = mat('p_fork', 0xe0a020, 0.3, 0.5)
    dark = mat('p_tyre', 0x1e1f21, 0, 0.9)
    iron = mat('p_iron', 0x2e2a26, 0.6, 0.5)
    box('forklift_body', (1.1, 1.8, 0.8), (0, -0.2, 0.75), yel, r, bevel=0.06)
    box('forklift_weight', (1.1, 0.4, 0.7), (0, -1.15, 0.85), iron, r, bevel=0.05)
    box('forklift_seat', (0.5, 0.4, 0.15), (0, -0.4, 1.25), dark, r, bevel=0.03)
    for sx in (-1, 1):
        limb(f'forklift_cage{sx}a', (sx * 0.5, 0.3, 1.15), (sx * 0.5, 0.2, 2.2), 0.03, iron, r)
        limb(f'forklift_cage{sx}b', (sx * 0.5, -0.9, 1.15), (sx * 0.5, -0.8, 2.2), 0.03, iron, r)
        box(f'forklift_mast{sx}', (0.08, 0.1, 2.4), (sx * 0.32, 0.85, 1.25), iron, r)
        box(f'forklift_fork{sx}', (0.1, 1.1, 0.05), (sx * 0.25, 1.45, 0.12), iron, r)
    box('forklift_roof', (1.1, 1.2, 0.05), (0, -0.3, 2.22), iron, r)
    box('forklift_carriage', (0.8, 0.08, 0.5), (0, 0.92, 0.4), iron, r)
    for i, (x, y) in enumerate(((0.5, 0.5), (-0.5, 0.5), (0.5, -0.9), (-0.5, -0.9))):
        cyl(f'forklift_wheel{i}', 0.28, 0.2, (x, y, 0.28), dark, r, rot=(0, RX, 0), verts=12)

def fence():
    """Wooden fence section, 2 m long along X."""
    r = empty('fence_root', (0, 0, 0))
    wood = mat('p_fence', 0x6b4a2e, 0, 0.9)
    for x in (-0.95, 0.0, 0.95):
        box(f'fence_post{x}', (0.1, 0.1, 1.15), (x, 0, 0.575), wood, r)
    for z in (0.35, 0.85):
        box(f'fence_rail{z}', (2.0, 0.05, 0.1), (0, 0.06, z), wood, r)

def lifebuoy():
    r = empty('lifebuoy_root', (0, 0, 0))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.32, minor_radius=0.07, major_segments=16, minor_segments=8, location=(0, 0.05, 1.3), rotation=(RX, 0, 0))
    finish(bpy.context.object, 'lifebuoy_ring', mat('p_buoy', 0xe04a2a, 0, 0.6), r, smooth=True)
    box('lifebuoy_board', (0.9, 0.05, 1.0), (0, 0, 1.3), mat('p_fence', 0x6b4a2e, 0, 0.9), r)
    cyl('lifebuoy_post', 0.05, 1.8, (0, -0.05, 0.9), mat('p_iron', 0x2e2a26, 0.6, 0.5), r, verts=8)

for cid in AGENTS:
    character(cid)
gun('ark7', ark7); gun('m4r', m4r); gun('vex', vex); gun('breacher', breacher); gun('longshot', longshot)
gun('g9', pistol(G['black'], G['black'], 0.18)); gun('p12', pistol(G['metal'], G['tan'], 0.21))
gun('hawk', pistol(G['steel'], G['black'], 0.25, 1.2)); gun('knife', knife)
gun('he', he); gun('flash', canister(G['gray'], G['steel'])); gun('smoke', canister(G['green'], G['black']))
gun('fireS', bottle); gun('fireW', canister(G['gray'], G['orange'])); gun('bomb', bomb)
barrel(); car('van', 0x3d6fa8, True); car('sedan', 0xe6e2d8, False); car('sedan2', 0xa8382d, False); palm()
crate('crateS', 1.1); crate('crateM', 1.6); crate_stack(); panel(); door(); window()
awning('awnR', 0xb83a2e); awning('awnB', 0x2e6f8f); awning('awnG', 0x3f7f3a); lamp(); plant()
container('contR', 0xa8382d); container('contB', 0x2e5f8f); container('contG', 0x3f6f3a); container('contO', 0xd8762a); container('contW', 0xd8d4c8)
pine('pine', False); pine('pineSnow', True); pallets(); crane(); bollard(); streetlamp(); sandbags()
drum('drumB', 0x2e5f8f); drum('drumR', 0xa8382d); forklift(); fence(); lifebuoy()

out = sys.argv[-1] if sys.argv[-1].endswith('.glb') else 'models.glb'
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_texcoords=False, export_materials='EXPORT', export_animations=False)
print('wrote', out)
