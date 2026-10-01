"""Foundry props (map 'foundry'): a steelworks. Crucibles and molten-metal channels, a furnace front,
ingot and I-beam stacks, cable spools, hazard barriers, an ore wagon on rail bogies, rails, a control booth,
a storage silo, a chimney stack and industrial wall decor (pipes, lamps, shutter doors, steel windows).
Runs inside models.py (uses its helpers mat/box/cyl/sphere/limb/empty/finish/_apply/RX).
Every object, material, asset and function name starts with 'fdy_' so nothing collides with other plug-ins.
Axes: +Y is the front, +Z up, origin at the bottom centre (wall decor: back on the wall at y = 0)."""
import math
import bpy
import bmesh
from mathutils import Vector


def fdy_m(key, hexcol, metal=0.0, rough=0.7, alpha=1.0):
    return mat('fdy_' + key, hexcol, metal, rough, alpha)


# shared palette
FDY = dict(
    steel=fdy_m('steel', 0x55585c, 0.6, 0.5), dark=fdy_m('darksteel', 0x2c2d30, 0.6, 0.55),
    rust=fdy_m('rust', 0x6e3a22, 0.3, 0.85), rust2=fdy_m('rust2', 0x8a4a2a, 0.2, 0.9),
    yellow=fdy_m('yellow', 0xe0a81c, 0.2, 0.55), black=fdy_m('black', 0x1a1a1c, 0.2, 0.6),
    refr=fdy_m('refractory', 0x8a6a52, 0.0, 0.95), soot=fdy_m('soot', 0x3a302a, 0.0, 0.95),
    molten=fdy_m('molten_emit4', 0xff7a1c), hot=fdy_m('hot_emit2', 0xd0401a), crust=fdy_m('crust', 0x2a1c16, 0.1, 0.9),
    wood=fdy_m('dunnage', 0x6a4a2c, 0.0, 0.9), red=fdy_m('primer', 0x8a3424, 0.25, 0.7),
    conc=fdy_m('concrete', 0x8e8a82, 0.0, 0.95), ore=fdy_m('ore', 0x5a3a2c, 0.0, 0.95), ore2=fdy_m('ore2', 0x40302a, 0.1, 0.9),
    cable=fdy_m('cable', 0x222326, 0.1, 0.6), glass=fdy_m('glass', 0x283844, 0.5, 0.15),
    white=fdy_m('white', 0xd8d4c8, 0.1, 0.7), green=fdy_m('green', 0x3c5a48, 0.3, 0.6))


def fdy_prism(name, poly, y0, y1, m, parent, axis='Y'):
    """Extrudes a 2D polygon. axis 'Y': poly in (x, z), extruded from y0 to y1. axis 'X': poly in (y, z), from x0=y0 to x1=y1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    def P(u, v, w):
        return (u, w, v) if axis == 'Y' else (w, u, v)
    a = [bm.verts.new(P(u, v, y0)) for u, v in poly]
    b = [bm.verts.new(P(u, v, y1)) for u, v in poly]
    n = len(poly)
    bm.faces.new(a[::-1] if axis == 'Y' else a)
    bm.faces.new(b if axis == 'Y' else b[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]) if axis == 'Y' else (a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return finish(o, name, m, parent)


def fdy_clip(poly, x0, x1, z0, z1):
    """Sutherland-Hodgman clip of a 2D polygon to a rectangle."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out
    def ix(xv):
        return lambda a, b: (xv, a[1] + (b[1] - a[1]) * (xv - a[0]) / (b[0] - a[0]))
    def iz(zv):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (zv - a[1]) / (b[1] - a[1]), zv)
    p = poly
    for ins, it in ((lambda q: q[0] >= x0, ix(x0)), (lambda q: q[0] <= x1, ix(x1)), (lambda q: q[1] >= z0, iz(z0)), (lambda q: q[1] <= z1, iz(z1))):
        if not p:
            break
        p = clip(p, ins, it)
    return p


def fdy_stripes(name, x0, x1, z0, z1, y0, y1, parent, w=0.18, axis='Y'):
    """Yellow panel with diagonal black hazard stripes (separate thin prisms, slightly proud of the panel)."""
    fdy_prism(f'{name}_base', [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], y0, y1, FDY['yellow'], parent, axis)
    h = z1 - z0
    k = 0
    x = x0 - h - w
    while x < x1:
        poly = fdy_clip([(x, z0), (x + w, z0), (x + w + h, z1), (x + h, z1)], x0, x1, z0, z1)
        if len(poly) >= 3:
            fdy_prism(f'{name}_s{k}', poly, y0 - 0.006, y1 + 0.006, FDY['black'], parent, axis)
            k += 1
        x += 2 * w


# ------------------------------------------------------------------ hazard barrier (cover, 1.9 m along X)
def fdy_barrier():
    r = empty('fdy_barrier_root', (0, 0, 0))
    for s in (-1, 1):
        box(f'fdy_barrier_foot{s}', (0.16, 0.9, 0.08), (s * 0.82, 0, 0.04), FDY['dark'], r, bevel=0.01)
        box(f'fdy_barrier_post{s}', (0.1, 0.1, 1.0), (s * 0.82, 0, 0.5), FDY['dark'], r)
        limb(f'fdy_barrier_strutA{s}', (s * 0.82, -0.38, 0.06), (s * 0.82, 0, 0.45), 0.025, FDY['dark'], r)
        limb(f'fdy_barrier_strutB{s}', (s * 0.82, 0.38, 0.06), (s * 0.82, 0, 0.45), 0.025, FDY['dark'], r)
    fdy_stripes('fdy_barrier_top', -0.95, 0.95, 0.62, 1.0, -0.03, 0.03, r, w=0.16)
    fdy_stripes('fdy_barrier_low', -0.95, 0.95, 0.18, 0.42, -0.03, 0.03, r, w=0.16)
    box('fdy_barrier_lamp', (0.1, 0.1, 0.08), (0.82, 0, 1.04), fdy_m('beacon_emit2', 0xff8a1a), r)


# ------------------------------------------------------------------ crucible / ladle on a stand (1.9 m cell)
def fdy_crucible():
    r = empty('fdy_crucible_root', (0, 0, 0))
    st, dk = FDY['steel'], FDY['dark']
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'fdy_crucible_leg{sx}{sy}', (0.14, 0.14, 1.05), (sx * 0.72, sy * 0.72, 0.525), dk, r)
    for sy in (-1, 1):
        box(f'fdy_crucible_railx{sy}', (1.58, 0.12, 0.12), (0, sy * 0.72, 1.0), dk, r)
        box(f'fdy_crucible_lowx{sy}', (1.58, 0.08, 0.08), (0, sy * 0.72, 0.3), dk, r)
    for sx in (-1, 1):
        box(f'fdy_crucible_raily{sx}', (0.12, 1.58, 0.12), (sx * 0.72, 0, 1.0), dk, r)
    # tapered bucket
    cyl('fdy_crucible_shell', 0.62, 1.25, (0, 0, 1.5), FDY['rust'], r, verts=18, r2=0.8)
    for i, z in enumerate((1.1, 1.55, 2.0)):
        rr = 0.62 + (z - 0.875) / 1.25 * 0.18
        cyl(f'fdy_crucible_band{i}', rr + 0.03, 0.08, (0, 0, z), dk, r, verts=18)
    cyl('fdy_crucible_lip', 0.84, 0.12, (0, 0, 2.15), FDY['refr'], r, verts=18)
    cyl('fdy_crucible_melt', 0.72, 0.04, (0, 0, 2.17), FDY['molten'], r, verts=18)
    for i in range(5):
        a = i * 1.3 + 0.4
        sphere(f'fdy_crucible_slag{i}', 0.12, (0.4 * math.cos(a), 0.4 * math.sin(a), 2.19), FDY['crust'], r, scale=(1.3, 1, 0.3), seg=7, rings=4)
    # trunnions and spout
    for sx in (-1, 1):
        cyl(f'fdy_crucible_trun{sx}', 0.11, 0.3, (sx * 0.86, 0, 1.75), dk, r, rot=(0, RX, 0), verts=10)
    box('fdy_crucible_spout', (0.24, 0.5, 0.12), (0, 0.9, 2.08), FDY['refr'], r, rot=(0.25, 0, 0))
    box('fdy_crucible_spoutglow', (0.14, 0.42, 0.02), (0, 0.9, 2.15), FDY['hot'], r, rot=(0.25, 0, 0))
    # glow on the floor below a drip
    cyl('fdy_crucible_puddle', 0.22, 0.02, (0, 1.05, 0.01), FDY['hot'], r, verts=10)


# ------------------------------------------------------------------ molten channel segment (2 m along X)
def fdy_channel():
    r = empty('fdy_channel_root', (0, 0, 0))
    box('fdy_channel_bed', (2.0, 1.5, 0.2), (0, 0, 0.1), FDY['refr'], r)
    for s in (-1, 1):
        box(f'fdy_channel_wall{s}', (2.0, 0.34, 0.42), (0, s * 0.58, 0.41), FDY['refr'], r, bevel=0.03)
        box(f'fdy_channel_edge{s}', (2.0, 0.08, 0.06), (0, s * 0.75, 0.6), FDY['dark'], r)
    box('fdy_channel_melt', (2.0, 0.82, 0.06), (0, 0, 0.42), FDY['molten'], r)
    for i, (x, y) in enumerate(((-0.6, 0.1), (0.2, -0.15), (0.7, 0.18))):
        sphere(f'fdy_channel_crust{i}', 0.14, (x, y, 0.45), FDY['crust'], r, scale=(1.6, 0.9, 0.25), seg=7, rings=4)
    for s in (-1, 1):
        box(f'fdy_channel_soot{s}', (2.0, 0.02, 0.18), (0, s * 0.75, 0.12), FDY['soot'], r)


# ------------------------------------------------------------------ furnace front (wall decor, 5.4 m wide)
def fdy_furnace():
    r = empty('fdy_furnace_root', (0, 0, 0))
    brick, dk = fdy_m('furnbrick', 0x5a3a2e, 0, 0.95), FDY['dark']
    box('fdy_furnace_body', (5.4, 1.3, 5.2), (0, 0.65, 2.6), brick, r)
    for s in (-1, 1):
        box(f'fdy_furnace_col{s}', (0.4, 1.5, 6.4), (s * 2.6, 0.75, 3.2), dk, r, bevel=0.03)
        for k in range(4):
            box(f'fdy_furnace_rivet{s}{k}', (0.12, 0.06, 0.12), (s * 2.6, 1.52, 0.8 + k * 1.4), FDY['steel'], r)
    for i, z in enumerate((1.6, 5.2)):
        box(f'fdy_furnace_beam{i}', (5.6, 1.4, 0.3), (0, 0.72, z), dk, r)
    # mouth with glowing interior and a tapping hole
    box('fdy_furnace_mouthframe', (2.4, 0.3, 1.9), (0, 1.35, 3.25), FDY['refr'], r, bevel=0.04)
    box('fdy_furnace_mouth', (1.9, 0.08, 1.4), (0, 1.48, 3.25), fdy_m('mouth_emit4', 0xffa040), r)
    for k in range(5):
        box(f'fdy_furnace_grate{k}', (0.06, 0.1, 1.45), (-0.76 + k * 0.38, 1.53, 3.25), dk, r)
    box('fdy_furnace_tap', (0.9, 0.3, 0.6), (0, 1.35, 0.55), FDY['refr'], r)
    box('fdy_furnace_tapglow', (0.6, 0.06, 0.32), (0, 1.5, 0.55), FDY['molten'], r)
    # hood and stack pipes
    fdy_prism('fdy_furnace_hood', [(-2.9, 5.35), (2.9, 5.35), (2.0, 7.0), (-2.0, 7.0)], 0.0, 1.7, dk, r)
    for s in (-1, 1):
        cyl(f'fdy_furnace_pipe{s}', 0.3, 3.0, (s * 1.2, 0.8, 8.3), FDY['rust'], r, verts=12)
    fdy_stripes('fdy_furnace_warn', -1.2, 1.2, 4.35, 4.65, 1.3, 1.36, r, w=0.14)
    box('fdy_furnace_heat', (2.2, 0.04, 0.5), (0, 1.32, 2.15), FDY['hot'], r)


# ------------------------------------------------------------------ ingot stack on a pallet
def fdy_ingots():
    r = empty('fdy_ingots_root', (0, 0, 0))
    al = fdy_m('ingot', 0x9a9ea2, 0.7, 0.4)
    al2 = fdy_m('ingot2', 0x7e8286, 0.7, 0.45)
    for i in range(3):
        box(f'fdy_ingots_skid{i}', (1.6, 0.12, 0.12), (0, -0.6 + i * 0.6, 0.06), FDY['wood'], r)
    box('fdy_ingots_deck', (1.6, 1.5, 0.04), (0, 0, 0.14), FDY['wood'], r)
    k = 0
    for lvl in range(5):
        z = 0.16 + lvl * 0.16 + 0.07
        along = lvl % 2 == 0
        for i in range(4):
            o = -0.57 + i * 0.38
            loc = (0, o, z) if along else (o, 0, z)
            size = (1.5, 0.3, 0.14) if along else (0.3, 1.4, 0.14)
            box(f'fdy_ingots_bar{k}', size, loc, al if (i + lvl) % 2 else al2, r, bevel=0.03)
            k += 1
    for s in (-1, 1):
        box(f'fdy_ingots_strap{s}', (0.04, 1.56, 0.86), (s * 0.45, 0, 0.6), FDY['dark'], r)
    box('fdy_ingots_tag', (0.3, 0.02, 0.2), (0.3, 0.79, 0.6), FDY['yellow'], r)


# ------------------------------------------------------------------ I-beam stack on dunnage (1.9 m along X)
def fdy_ibeam(name, y, z, parent, m, L=1.9):
    box(f'{name}_top', (L, 0.3, 0.035), (0, y, z + 0.2825), m, parent)
    box(f'{name}_bot', (L, 0.3, 0.035), (0, y, z + 0.0175), m, parent)
    box(f'{name}_web', (L, 0.03, 0.27), (0, y, z + 0.15), m, parent)


def fdy_beams():
    r = empty('fdy_beams_root', (0, 0, 0))
    k = 0
    z = 0.0
    for lvl in range(3):
        for i in (-0.7, 0.7):
            box(f'fdy_beams_dun{lvl}{i}', (0.12, 1.7, 0.1), (i, 0, z + 0.05), FDY['wood'], r)
        z += 0.1
        n = 5 - lvl
        for i in range(n):
            fdy_ibeam(f'fdy_beams_b{k}', -0.66 + i * 0.33 + lvl * 0.165, z, r, FDY['red'] if (i + lvl) % 3 else FDY['steel'])
            k += 1
        z += 0.3
    box('fdy_beams_tag', (0.02, 0.24, 0.16), (0.96, 0.2, 0.25), FDY['white'], r)


# ------------------------------------------------------------------ cable spool (axis along X)
def fdy_spool():
    r = empty('fdy_spool_root', (0, 0, 0))
    wood = fdy_m('spoolwood', 0x8a6236, 0, 0.85)
    R = 0.78
    for s in (-1, 1):
        cyl(f'fdy_spool_flange{s}', R, 0.08, (s * 0.62, 0, R), wood, r, rot=(0, RX, 0), verts=20)
        cyl(f'fdy_spool_hub{s}', 0.16, 0.12, (s * 0.68, 0, R), FDY['dark'], r, rot=(0, RX, 0), verts=10)
        for k in range(6):
            a = k * math.pi / 3
            box(f'fdy_spool_bolt{s}{k}', (0.1, 0.05, 0.05), (s * 0.67, 0.6 * math.cos(a), R + 0.6 * math.sin(a)), FDY['dark'], r)
    cyl('fdy_spool_cable', 0.6, 1.16, (0, 0, R), FDY['cable'], r, rot=(0, RX, 0), verts=18)
    for k in range(7):
        cyl(f'fdy_spool_turn{k}', 0.615, 0.06, (-0.5 + k * 0.167, 0, R), fdy_m('cable2', 0x2e3034, 0.1, 0.5), r, rot=(0, RX, 0), verts=18)
    limb('fdy_spool_end', (0.4, -0.3, R - 0.53), (0.7, -0.7, 0.04), 0.035, FDY['cable'], r)
    box('fdy_spool_chock', (0.9, 0.18, 0.14), (0, -0.62, 0.07), FDY['wood'], r)


# ------------------------------------------------------------------ rail segment (2 m along X, gauge 1.44 m)
def fdy_rail():
    r = empty('fdy_rail_root', (0, 0, 0))
    railm = fdy_m('railsteel', 0x7a746e, 0.75, 0.4)
    for i in range(3):
        box(f'fdy_rail_sleeper{i}', (0.26, 2.3, 0.08), (-0.66 + i * 0.66, 0, 0.04), fdy_m('sleeper', 0x3e3026, 0, 0.95), r)
    for s in (-1, 1):
        box(f'fdy_rail_rail{s}', (2.0, 0.07, 0.07), (0, s * 0.72, 0.115), railm, r)
        box(f'fdy_rail_foot{s}', (2.0, 0.14, 0.02), (0, s * 0.72, 0.09), FDY['dark'], r)


# ------------------------------------------------------------------ wagon bogie (one per cell, under a wagon)
def fdy_bogie():
    r = empty('fdy_bogie_root', (0, 0, 0))
    dk = FDY['dark']
    for s in (-1, 1):
        box(f'fdy_bogie_side{s}', (1.7, 0.12, 0.3), (0, s * 0.86, 0.5), dk, r, bevel=0.02)
        box(f'fdy_bogie_spring{s}', (0.3, 0.16, 0.2), (0, s * 0.86, 0.72), FDY['yellow'], r)
    box('fdy_bogie_bolster', (0.4, 1.9, 0.18), (0, 0, 0.75), dk, r)
    for i, x in enumerate((-0.55, 0.55)):
        cyl(f'fdy_bogie_axle{i}', 0.07, 1.8, (x, 0, 0.47), FDY['steel'], r, rot=(RX, 0, 0), verts=8)
        for s in (-1, 1):
            cyl(f'fdy_bogie_wheel{i}{s}', 0.33, 0.1, (x, s * 0.72, 0.48), FDY['steel'], r, rot=(RX, 0, 0), verts=14)
    # rails under the bogie so it never floats
    fdy_m('railsteel', 0x7a746e, 0.75, 0.4)
    for s in (-1, 1):
        box(f'fdy_bogie_rail{s}', (2.0, 0.07, 0.15), (0, s * 0.72, 0.075), MATS['fdy_railsteel'], r)


# ------------------------------------------------------------------ ore wagon body (3.9 m along X, sits on two bogies)
def fdy_wagon(name, col):
    r = empty(f'{name}_root', (0, 0, 0))
    paint = fdy_m(f'{name[4:]}_patch', col, 0.3, 0.7)  # 'patch': plain paint, no grime map
    dk = FDY['dark']
    z0 = 0.84
    box(f'{name}_frame', (3.9, 2.0, 0.22), (0, 0, z0 + 0.11), dk, r)
    # hopper body: sloped ends and sides, wider at the top
    fdy_prism(f'{name}_body', [(-1.95, z0 + 0.22), (1.95, z0 + 0.22), (1.95, z0 + 1.9), (-1.95, z0 + 1.9)], -1.05, 1.05, paint, r)
    for i in range(7):
        x = -1.65 + i * 0.55
        for s in (-1, 1):
            box(f'{name}_rib{i}{s}', (0.09, 0.08, 1.6), (x, s * 1.07, z0 + 1.05), dk, r)
    for s in (-1, 1):
        box(f'{name}_topx{s}', (3.98, 0.12, 0.1), (0, s * 1.06, z0 + 1.92), dk, r)
        box(f'{name}_topy{s}', (0.12, 2.2, 0.1), (s * 1.97, 0, z0 + 1.92), dk, r)
        box(f'{name}_buffer{s}', (0.3, 0.3, 0.2), (s * 2.05, 0, z0 + 0.2), dk, r)
    fdy_prism(f'{name}_chute', [(-0.5, z0), (0.5, z0), (0.0, z0 - 0.36)], -0.3, 0.3, dk, r, axis='X')
    box(f'{name}_plate', (0.02, 0.9, 0.36), (1.97, 0, z0 + 1.3), FDY['white'], r)
    box(f'{name}_plate2', (0.9, 0.02, 0.36), (-0.9, -1.12, z0 + 1.4), FDY['white'], r)
    # heap of ore on top
    ores = ((-1.2, -0.4), (-0.5, 0.3), (0.3, -0.2), (1.1, 0.35), (0.0, 0.5), (-1.3, 0.5), (1.3, -0.5), (0.7, 0.0), (-0.2, -0.6))
    for i, (x, y) in enumerate(ores):
        sphere(f'{name}_ore{i}', 0.55, (x, y, z0 + 1.9), FDY['ore'] if i % 2 else FDY['ore2'], r, scale=(1.1, 0.9, 0.42), seg=8, rings=5)
    box(f'{name}_orebed', (3.8, 1.9, 0.08), (0, 0, z0 + 1.86), FDY['ore2'], r)
    for s in (-1, 1):
        limb(f'{name}_ladder{s}', (s * 1.99, 0.7, z0 + 0.2), (s * 1.99, 0.7, z0 + 1.9), 0.02, FDY['steel'], r)


# ------------------------------------------------------------------ control booth (about 3.8 x 3.6 m)
def fdy_booth():
    r = empty('fdy_booth_root', (0, 0, 0))
    wall = fdy_m('booth_patch', 0x5f7a6e, 0.3, 0.6)
    dk = FDY['dark']
    box('fdy_booth_base', (3.8, 3.6, 0.3), (0, 0, 0.15), FDY['conc'], r)
    box('fdy_booth_lower', (3.6, 3.4, 1.15), (0, 0, 0.88), wall, r)
    for s in (-1, 1):
        box(f'fdy_booth_postx{s}', (0.14, 0.14, 1.4), (s * 1.73, 1.63, 2.15), dk, r)
        box(f'fdy_booth_posty{s}', (0.14, 0.14, 1.4), (s * 1.73, -1.63, 2.15), dk, r)
    box('fdy_booth_glass', (3.5, 3.3, 1.3), (0, 0, 2.12), FDY['glass'], r)
    box('fdy_booth_glow', (3.3, 3.1, 1.2), (0, 0, 2.12), fdy_m('boothlight_emit', 0x9a6a38), r)
    box('fdy_booth_upper', (3.6, 3.4, 0.5), (0, 0, 3.06), wall, r)
    box('fdy_booth_roof', (4.0, 3.8, 0.14), (0, 0, 3.38), dk, r)
    box('fdy_booth_door', (0.95, 0.06, 1.0), (-1.0, 1.72, 0.85), dk, r)
    for i in range(3):
        box(f'fdy_booth_screen{i}', (0.5, 0.04, 0.32), (-1.0 + i * 0.7, 1.67, 1.75), fdy_m('screen_emit2', 0x50e0a0), r)
    fdy_stripes('fdy_booth_band', -1.8, 1.8, 0.32, 0.6, 1.7, 1.73, r, w=0.15)
    fdy_stripes('fdy_booth_bandb', -1.8, 1.8, 0.32, 0.6, -1.73, -1.7, r, w=0.15)
    cyl('fdy_booth_antenna', 0.03, 1.4, (1.4, -1.3, 4.1), FDY['steel'], r, verts=6)
    box('fdy_booth_ac', (0.9, 0.7, 0.5), (0.8, 0.2, 3.7), FDY['steel'], r, bevel=0.03)
    box('fdy_booth_beacon', (0.18, 0.18, 0.18), (-1.5, 1.5, 3.55), fdy_m('beacon_emit2', 0xff8a1a), r)


# ------------------------------------------------------------------ storage silo / tank (diameter 3.6 m, 9 m)
def fdy_tank():
    r = empty('fdy_tank_root', (0, 0, 0))
    paint = fdy_m('tankpaint', 0xa8a49a, 0.4, 0.6)
    dk = FDY['dark']
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        box(f'fdy_tank_leg{k}', (0.3, 0.3, 2.4), (1.35 * math.cos(a), 1.35 * math.sin(a), 1.2), dk, r)
    cyl('fdy_tank_cone', 0.4, 1.4, (0, 0, 2.1), paint, r, verts=20, r2=1.8)
    cyl('fdy_tank_body', 1.8, 5.8, (0, 0, 5.7), paint, r, verts=24)
    for i in range(5):
        cyl(f'fdy_tank_band{i}', 1.83, 0.1, (0, 0, 3.2 + i * 1.3), dk, r, verts=24)
    cyl('fdy_tank_roof', 1.85, 0.9, (0, 0, 9.05), paint, r, verts=24, r2=0.3)
    cyl('fdy_tank_streak', 1.81, 1.2, (0, 0, 8.0), fdy_m('tankrust', 0x8a5a3a, 0.2, 0.9), r, verts=24)
    for k in range(9):
        box(f'fdy_tank_rung{k}', (0.5, 0.05, 0.05), (0, 1.9, 3.0 + k * 0.7), FDY['steel'], r)
    for s in (-1, 1):
        box(f'fdy_tank_rail{s}', (0.05, 0.08, 6.6), (s * 0.25, 1.88, 6.0), FDY['steel'], r)
    box('fdy_tank_band_y', (1.6, 0.06, 0.8), (0, 1.8, 6.2), FDY['yellow'], r)
    cyl('fdy_tank_chute', 0.2, 1.2, (0, 0, 0.9), dk, r, verts=10)


# ------------------------------------------------------------------ chimney stack (scenery, about 32 m)
def fdy_chimney():
    r = empty('fdy_chimney_root', (0, 0, 0))
    brick = fdy_m('chimbrick', 0x6a4436, 0, 0.95)
    box('fdy_chimney_base', (5.0, 5.0, 4.0), (0, 0, 2.0), FDY['conc'], r, bevel=0.1)
    cyl('fdy_chimney_shaft', 1.9, 27.0, (0, 0, 17.5), brick, r, verts=20, r2=1.3)
    for i, z in enumerate((9, 16, 23)):
        rr = 1.9 - (z - 4) / 27 * 0.6
        cyl(f'fdy_chimney_ring{i}', rr + 0.08, 0.35, (0, 0, z), FDY['dark'], r, verts=20)
    cyl('fdy_chimney_red', 1.42, 1.6, (0, 0, 28.6), fdy_m('chimred', 0xa83024, 0.1, 0.7), r, verts=20, r2=1.36)
    cyl('fdy_chimney_white', 1.38, 1.2, (0, 0, 29.9), fdy_m('chimwhite', 0xd8d4cc, 0.1, 0.7), r, verts=20, r2=1.32)
    cyl('fdy_chimney_cap', 1.45, 0.5, (0, 0, 30.75), FDY['dark'], r, verts=20)
    cyl('fdy_chimney_soot', 1.2, 0.2, (0, 0, 31.0), FDY['soot'], r, verts=20)
    box('fdy_chimney_lamp', (0.3, 0.3, 0.3), (0, 1.4, 30.2), fdy_m('aviation_emit4', 0xff2a1a), r)


# ------------------------------------------------------------------ wall decor: pipe run with a valve (2 m wide)
def fdy_pipes():
    r = empty('fdy_pipes_root', (0, 0, 0))
    pm = fdy_m('pipe', 0x6a6e66, 0.5, 0.55)
    for i, (z, rad, m) in enumerate(((3.6, 0.16, pm), (3.1, 0.11, FDY['rust2']))):
        cyl(f'fdy_pipes_run{i}', rad, 2.0, (0, 0.3, z), m, r, rot=(0, RX, 0), verts=12)
        for s in (-1, 1):
            cyl(f'fdy_pipes_flange{i}{s}', rad + 0.05, 0.06, (s * 0.97, 0.3, z), FDY['dark'], r, rot=(0, RX, 0), verts=12)
    for s in (-1, 1):
        box(f'fdy_pipes_bracket{s}', (0.08, 0.5, 0.9), (s * 0.6, 0.22, 3.35), FDY['dark'], r)
    limb('fdy_pipes_drop', (0.3, 0.3, 3.1), (0.3, 0.3, 1.0), 0.09, FDY['rust2'], r)
    cyl('fdy_pipes_elbow', 0.12, 0.2, (0.3, 0.3, 0.95), FDY['dark'], r, verts=10)
    cyl('fdy_pipes_valvebody', 0.14, 0.26, (0.3, 0.3, 1.6), FDY['dark'], r, verts=10)
    limb('fdy_pipes_stem', (0.3, 0.3, 1.6), (0.3, 0.62, 1.6), 0.025, FDY['steel'], r)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.025, major_segments=14, minor_segments=6, location=(0.3, 0.63, 1.6), rotation=(RX, 0, 0))
    finish(bpy.context.object, 'fdy_pipes_wheel', fdy_m('valvered', 0xb02a1e, 0.3, 0.5), r, smooth=True)
    for k in range(3):
        a = k * math.pi / 3
        limb(f'fdy_pipes_spoke{k}', (0.3 - 0.17 * math.cos(a), 0.63, 1.6 - 0.17 * math.sin(a)), (0.3 + 0.17 * math.cos(a), 0.63, 1.6 + 0.17 * math.sin(a)), 0.015, fdy_m('valvered', 0xb02a1e, 0.3, 0.5), r)
    box('fdy_pipes_gauge', (0.18, 0.06, 0.18), (-0.4, 0.42, 3.1), FDY['white'], r)


# ------------------------------------------------------------------ wall decor: caged industrial lamp
def fdy_lamp():
    r = empty('fdy_lamp_root', (0, 0, 0))
    box('fdy_lamp_plate', (0.16, 0.04, 0.24), (0, 0.02, 0), FDY['dark'], r)
    limb('fdy_lamp_arm', (0, 0.03, 0.05), (0, 0.42, 0.18), 0.022, FDY['dark'], r)
    cyl('fdy_lamp_shade', 0.24, 0.12, (0, 0.46, 0.14), fdy_m('lampshade', 0x3e5a4a, 0.4, 0.5), r, verts=12, r2=0.06)
    sphere('fdy_lamp_bulb', 0.09, (0, 0.46, 0.04), fdy_m('lampbulb_emit4', 0xffc070), r, seg=8, rings=5)
    for k in range(4):
        a = k * math.pi / 2
        limb(f'fdy_lamp_cage{k}', (0.12 * math.cos(a), 0.46 + 0.12 * math.sin(a), 0.1), (0.05 * math.cos(a), 0.46 + 0.05 * math.sin(a), -0.08), 0.008, FDY['dark'], r)


# ------------------------------------------------------------------ wall decor: roll-up shutter door
def fdy_door():
    r = empty('fdy_door_root', (0, 0, 0))
    sh = fdy_m('shutter', 0x7a8288, 0.5, 0.5)
    sh2 = fdy_m('shutter2', 0x5e666c, 0.5, 0.55)
    for k in range(13):
        box(f'fdy_door_slat{k}', (1.8, 0.05, 0.19), (0, 0.04, 0.1 + k * 0.2), sh if k % 2 else sh2, r)
    fdy_stripes('fdy_door_edge', -0.9, 0.9, 0.0, 0.22, 0.06, 0.1, r, w=0.12)
    for s in (-1, 1):
        box(f'fdy_door_guide{s}', (0.14, 0.14, 2.7), (s * 0.97, 0.07, 1.35), FDY['dark'], r)
    box('fdy_door_box', (2.1, 0.4, 0.4), (0, 0.2, 2.85), FDY['dark'], r, bevel=0.03)
    box('fdy_door_handle', (0.3, 0.06, 0.05), (0, 0.1, 0.4), FDY['steel'], r)


# ------------------------------------------------------------------ wall decor: steel factory window
def fdy_window(name, glow):
    r = empty(f'{name}_root', (0, 0, 0))
    frame = fdy_m('winframe', 0x3a3e40, 0.5, 0.5)
    lit = fdy_m(f'{name[4:]}_emit', glow) if glow else FDY['glass']
    dark = fdy_m('winpane', 0x1e2428, 0.4, 0.2)
    W, H = 1.7, 1.5
    box(f'{name}_back', (W, 0.04, H), (0, 0.02, H / 2), lit, r)
    k = 0
    for i in range(4):
        for j in range(3):
            if (i * 3 + j) % 5 == 2:
                box(f'{name}_pane{k}', (W / 4 - 0.04, 0.02, H / 3 - 0.04), (-W / 2 + (i + 0.5) * W / 4, 0.045, (j + 0.5) * H / 3), dark, r)
                k += 1
    for i in range(5):
        box(f'{name}_mv{i}', (0.04, 0.08, H), (-W / 2 + i * W / 4, 0.05, H / 2), frame, r)
    for j in range(4):
        box(f'{name}_mh{j}', (W, 0.08, 0.04), (0, 0.05, j * H / 3), frame, r)
    box(f'{name}_sill', (W + 0.2, 0.22, 0.08), (0, 0.11, -0.04), FDY['conc'], r)


# ------------------------------------------------------------------ high-bay lamp hanging from a roof (origin at the ceiling)
def fdy_hanglamp():
    r = empty('fdy_hanglamp_root', (0, 0, 0))
    limb('fdy_hanglamp_rod', (0, 0, 0), (0, 0, -2.2), 0.02, FDY['dark'], r)
    cyl('fdy_hanglamp_box', 0.16, 0.22, (0, 0, -2.3), FDY['dark'], r, verts=10)
    cyl('fdy_hanglamp_shade', 0.12, 0.38, (0, 0, -2.6), fdy_m('hangshade', 0x4a5650, 0.5, 0.45), r, verts=14, r2=0.48)
    cyl('fdy_hanglamp_glow', 0.4, 0.03, (0, 0, -2.78), fdy_m('hanglamp_emit4', 0xffd8a0), r, verts=14)


# ------------------------------------------------------------------ base plate under hero props (invisible-ish)
def fdy_plate():
    r = empty('fdy_plate_root', (0, 0, 0))
    box('fdy_plate_steel', (1.9, 1.9, 0.03), (0, 0, 0.015), FDY['dark'], r)


def fdy_join_all():
    """Join each fdy_ asset's parts into one mesh (one primitive per material)."""
    for root in [o for o in bpy.data.objects if o.name.startswith('fdy_') and o.name.endswith('_root') and o.parent is None]:
        parts = [o for o in root.children_recursive if o.type == 'MESH']
        if len(parts) < 2:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:
            bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        parts[0].name = root.name[:-5] + '_mesh'
        bpy.ops.object.select_all(action='DESELECT')


# ------------------------------------------------------------------ build everything
fdy_barrier(); fdy_crucible(); fdy_channel(); fdy_furnace(); fdy_ingots(); fdy_beams(); fdy_spool()
fdy_rail(); fdy_bogie(); fdy_wagon('fdy_wagon', 0x7a3a22); fdy_wagon('fdy_wagonY', 0x9a7a2a)
fdy_booth(); fdy_tank(); fdy_chimney(); fdy_pipes(); fdy_lamp(); fdy_door()
fdy_window('fdy_window', 0x8a5226); fdy_window('fdy_windowD', None); fdy_plate(); fdy_hanglamp()
fdy_join_all()
