"""Neon Row props (map 'neonrow'): neon signs, lit windows, street furniture, a night market stall,
a taxi, parking-garage pieces and rooftop skyline decoration.
Runs inside models.py (uses its helpers mat/box/cyl/sphere/limb/empty/finish/_apply/RX).
Every object, material, asset and function name starts with 'neo_' so nothing collides with other plug-ins.
Axes: +Y is the front, +Z up, origin at the bottom centre (wall decor: back on the wall at y = 0)."""
import math
import bpy
from mathutils import Vector


def neo_m(key, hexcol, metal=0.0, rough=0.7, alpha=1.0):
    return mat('neo_' + key, hexcol, metal, rough, alpha)


def neo_tube(name, pts, r, m, parent, closed=False, verts=6):
    """A neon tube (or wire) through a list of points; segments overlap a little so corners stay closed."""
    pts = [Vector(p) for p in pts]
    if closed:
        pts.append(pts[0])
    k = 0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = b - a
        if d.length < 1e-4:
            continue
        e = d.normalized() * r * 0.7
        limb(f'{name}_{k}', a - e, b + e, r, m, parent, verts=verts)
        k += 1


def neo_arc(cx, cz, rx, rz, a0, a1, n, y):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), y, cz + rz * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def neo_rrect(cx, cz, w, h, rad, y, n=3):
    """Rounded rectangle outline in the XZ plane (closed list of points)."""
    pts = []
    for (qx, qz, a0) in ((w / 2 - rad, h / 2 - rad, 0), (-w / 2 + rad, h / 2 - rad, math.pi / 2),
                         (-w / 2 + rad, -h / 2 + rad, math.pi), (w / 2 - rad, -h / 2 + rad, 1.5 * math.pi)):
        for i in range(n + 1):
            a = a0 + (math.pi / 2) * i / n
            pts.append((cx + qx + rad * math.cos(a), y, cz + qz + rad * math.sin(a)))
    return pts


def neo_mounts(name, spots, depth, parent):
    iron = neo_m('mount', 0x26272b, 0.5, 0.5)
    for i, (x, z) in enumerate(spots):
        cyl(f'{name}{i}', 0.022, depth, (x, depth / 2, z), iron, parent, rot=(RX, 0, 0), verts=6)


def neo_board(name, w, h, zc, parent, y=0.12, col=0x17161f):
    back = neo_m('signback', col, 0.4, 0.45)
    box(name, (w, 0.04, h), (0, y, zc), back, parent, bevel=0.015)


# ------------------------------------------------------------------ neon signs (wall decor)
def neo_sign_bowl():
    r = empty('neo_signBowl_root', (0, 0, 0))
    pink = neo_m('neonPink', 0xff3fa8, 0, 0.4)
    cyan = neo_m('neonCyan', 0x3cf0ff, 0, 0.4)
    warm = neo_m('neonWarm', 0xfff0d8, 0, 0.4)
    neo_mounts('neo_signBowl_mount', [(-0.5, 0.15), (0.5, 0.15), (-0.5, 0.85), (0.5, 0.85)], 0.1, r)
    neo_board('neo_signBowl_board', 1.32, 1.0, 0.5, r)
    y = 0.165
    neo_tube('neo_signBowl_bowl', neo_arc(0, 0.5, 0.42, 0.38, math.pi, 2 * math.pi, 12, y), 0.022, cyan, r, closed=True)
    neo_tube('neo_signBowl_foot', [(-0.15, y, 0.07), (0.15, y, 0.07)], 0.022, cyan, r)
    neo_tube('neo_signBowl_stickA', [(0.04, y, 0.6), (0.52, y, 0.93)], 0.02, pink, r)
    neo_tube('neo_signBowl_stickB', [(0.14, y, 0.56), (0.6, y, 0.85)], 0.02, pink, r)
    for j, x0 in enumerate((-0.3, -0.12)):
        neo_tube(f'neo_signBowl_steam{j}', [(x0 + 0.05 * math.sin(k * 1.6), y, 0.6 + k * 0.085) for k in range(5)], 0.016, warm, r)


def neo_sign_open():
    r = empty('neo_signOpen_root', (0, 0, 0))
    pink = neo_m('neonPink', 0xff3fa8, 0, 0.4)
    cyan = neo_m('neonCyan', 0x3cf0ff, 0, 0.4)
    neo_mounts('neo_signOpen_mount', [(-0.6, 0.35), (0.6, 0.35)], 0.1, r)
    neo_board('neo_signOpen_board', 1.5, 0.62, 0.35, r)
    y = 0.165
    neo_tube('neo_signOpen_frame', neo_rrect(0, 0.35, 1.4, 0.52, 0.08, y), 0.018, cyan, r, closed=True)
    # letters are laid out along +X and then mirrored: seen from the front (+Y), +X is on the viewer's left
    mr = lambda pts: [(-x, yy, z) for x, yy, z in pts]
    xs = [-0.6 + i * 0.32 for i in range(4)]
    z0, z1, zm = 0.17, 0.53, 0.35
    x = xs[0]
    neo_tube('neo_signOpen_O', mr(neo_arc(x + 0.11, zm, 0.11, 0.18, 0, 2 * math.pi, 12, y)), 0.02, pink, r)
    x = xs[1]
    neo_tube('neo_signOpen_P', mr([(x, y, z0), (x, y, z1), (x + 0.1, y, z1)] + neo_arc(x + 0.1, 0.44, 0.09, 0.09, math.pi / 2, -math.pi / 2, 6, y)
             + [(x, y, zm)]), 0.02, pink, r)
    x = xs[2]
    neo_tube('neo_signOpen_E', mr([(x + 0.2, y, z1), (x, y, z1), (x, y, z0), (x + 0.2, y, z0)]), 0.02, pink, r)
    neo_tube('neo_signOpen_E2', mr([(x, y, zm), (x + 0.15, y, zm)]), 0.02, pink, r)
    x = xs[3]
    neo_tube('neo_signOpen_N', mr([(x, y, z0), (x, y, z1), (x + 0.21, y, z0), (x + 0.21, y, z1)]), 0.02, pink, r)


def neo_sign_arrow():
    r = empty('neo_signArrow_root', (0, 0, 0))
    amber = neo_m('neonAmber', 0xffa526, 0, 0.4)
    bulb = neo_m('bulbW_emit4', 0xffe2a8, 0, 0.3)
    neo_mounts('neo_signArrow_mount', [(-0.6, 0.45), (0.55, 0.45)], 0.1, r)
    neo_board('neo_signArrow_board', 1.5, 0.86, 0.45, r, col=0x141a2a)
    y = 0.165
    pts = [(-0.62, 0.12), (0.1, 0.12), (0.1, 0.32), (0.62, 0.0), (0.1, -0.32), (0.1, -0.12), (-0.62, -0.12)]
    neo_tube('neo_signArrow_out', [(x, y, z + 0.45) for x, z in pts], 0.022, amber, r, closed=True)
    for i in range(7):
        sphere(f'neo_signArrow_bulb{i}', 0.035, (-0.5 + i * 0.1, y, 0.45), bulb, r, seg=6, rings=4)


def neo_sign_cocktail():
    r = empty('neo_signCocktail_root', (0, 0, 0))
    mag = neo_m('neonMagenta', 0xff4cf2, 0, 0.4)
    cyan = neo_m('neonCyan', 0x3cf0ff, 0, 0.4)
    green = neo_m('neonGreen', 0x7dff6a, 0, 0.4)
    warm = neo_m('neonWarm', 0xfff0d8, 0, 0.4)
    back = neo_m('signback', 0x17161f, 0.4, 0.45)
    neo_mounts('neo_signCocktail_mount', [(-0.3, 0.5), (0.3, 0.5)], 0.1, r)
    cyl('neo_signCocktail_disc', 0.54, 0.04, (0, 0.12, 0.54), back, r, rot=(RX, 0, 0), verts=20)
    y = 0.165
    neo_tube('neo_signCocktail_ring', neo_arc(0, 0.54, 0.48, 0.48, 0, 2 * math.pi, 18, y), 0.02, cyan, r)
    neo_tube('neo_signCocktail_glass', [(-0.27, y, 0.8), (0.27, y, 0.8), (0, y, 0.48)], 0.022, mag, r, closed=True)
    neo_tube('neo_signCocktail_stem', [(0, y, 0.48), (0, y, 0.22)], 0.022, mag, r)
    neo_tube('neo_signCocktail_base', [(-0.15, y, 0.2), (0.15, y, 0.2)], 0.022, mag, r)
    neo_tube('neo_signCocktail_olive', neo_arc(0.07, 0.7, 0.05, 0.05, 0, 2 * math.pi, 8, y + 0.01), 0.016, green, r)
    neo_tube('neo_signCocktail_pick', [(-0.05, y + 0.01, 0.62), (0.17, y + 0.01, 0.86)], 0.012, warm, r)


NEO_GLYPHS = [
    [(0, 0.15, 0.36, 0.045), (0, 0, 0.045, 0.34), (0, -0.15, 0.3, 0.045)],
    [(-0.15, 0, 0.045, 0.36), (0.15, 0, 0.045, 0.36), (0, 0.02, 0.3, 0.045), (0, 0.16, 0.3, 0.045)],
    [(0, 0.12, 0.36, 0.045), (0, -0.02, 0.24, 0.045), (-0.08, -0.14, 0.045, 0.14), (0.08, -0.14, 0.045, 0.14)],
    [(0, 0.15, 0.22, 0.045), (0, 0, 0.045, 0.34), (-0.13, -0.05, 0.14, 0.045), (0.13, -0.05, 0.14, 0.045)],
]


def neo_sign_blade(name, border_hex, glyph_hex, order):
    """Vertical blade sign sticking out of the wall with neon edges and four abstract glyphs per side."""
    r = empty(f'{name}_root', (0, 0, 0))
    body = neo_m('bladebody', 0x1a1a26, 0.4, 0.45)
    iron = neo_m('mount', 0x26272b, 0.5, 0.5)
    edge = neo_m(f'{name}_neon', border_hex, 0, 0.4)
    gl = neo_m(f'{name}glyph_emit2', glyph_hex, 0, 0.4)
    for z in (0.35, 2.25):
        limb(f'{name}_arm{z}', (0, 0, z), (0, 0.3, z), 0.03, iron, r)
    box(f'{name}_body', (0.2, 0.8, 2.6), (0, 0.62, 1.3), body, r, bevel=0.02)
    box(f'{name}_cap', (0.26, 0.86, 0.08), (0, 0.62, 2.64), iron, r)
    for s in (-1, 1):
        x = s * 0.115
        loop = [(x, 0.27, 0.08), (x, 0.97, 0.08), (x, 0.97, 2.52), (x, 0.27, 2.52)]
        neo_tube(f'{name}_edge{s}', loop, 0.018, edge, r, closed=True)
        for i, gi in enumerate(order):
            zc = 0.45 + i * 0.55
            for j, (dy, dz, sy, sz) in enumerate(NEO_GLYPHS[gi]):
                box(f'{name}_g{s}{i}{j}', (0.016, sy * 1.25, sz * 1.25), (s * 0.105, 0.62 + dy * 1.25, zc + dz * 1.25), gl, r)


def neo_letter(name, strokes):
    """Big neon site letter on a dark board (wall decor, about 2.1 m tall)."""
    r = empty(f'{name}_root', (0, 0, 0))
    rose = neo_m('neonRose', 0xff2d55, 0, 0.4)
    warm = neo_m('neonWarm', 0xfff0d8, 0, 0.4)
    neo_mounts(f'{name}_mount', [(-0.55, 0.3), (0.55, 0.3), (-0.55, 1.8), (0.55, 1.8)], 0.1, r)
    neo_board(f'{name}_board', 1.6, 2.15, 1.07, r)
    y = 0.17
    neo_tube(f'{name}_frame', neo_rrect(0, 1.07, 1.48, 2.03, 0.12, y), 0.016, warm, r, closed=True)
    for i, s in enumerate(strokes):
        neo_tube(f'{name}_s{i}', [(x, y + 0.01, z) for x, z in s], 0.045, rose, r)


def neo_letters():
    neo_letter('neo_letterA', [[(-0.5, 0.2), (0, 1.9), (0.5, 0.2)], [(-0.27, 0.85), (0.27, 0.85)]])
    top = [(-0.42, 1.9), (0.05, 1.9)] + [(x, z) for x, _, z in neo_arc(0.05, 1.52, 0.38, 0.38, math.pi / 2, -math.pi / 2, 8, 0)] + [(-0.42, 1.14)]
    bot = [(-0.42, 1.14), (0.08, 1.14)] + [(x, z) for x, _, z in neo_arc(0.08, 0.67, 0.47, 0.47, math.pi / 2, -math.pi / 2, 8, 0)] + [(-0.42, 0.2)]
    # mirrored for the same reason as the OPEN sign
    neo_letter('neo_letterB', [[(-x, z) for x, z in st] for st in [[(-0.42, 0.2), (-0.42, 1.9)], top, bot]])


# ------------------------------------------------------------------ windows and wall clutter
def neo_window(name, glow_hex, variant):
    """Lit window (front faces +Y), bottom at z = 0, same footprint as the town window."""
    r = empty(f'{name}_root', (0, 0, 0))
    frame = neo_m('winframe', 0x2b2d31, 0.3, 0.6)
    glass = neo_m(f'{name}_emit', glow_hex, 0, 0.3)
    box(f'{name}_glass', (0.94, 0.03, 1.3), (0, 0.015, 0.65), glass, r)
    for s in (-1, 1):
        box(f'{name}_side{s}', (0.1, 0.11, 1.46), (s * 0.52, 0.055, 0.65), frame, r)
    box(f'{name}_head', (1.16, 0.13, 0.1), (0, 0.065, 1.35), frame, r)
    box(f'{name}_sill', (1.24, 0.2, 0.07), (0, 0.1, -0.035), frame, r)
    box(f'{name}_mull', (0.04, 0.06, 1.3), (0, 0.04, 0.65), frame, r)
    box(f'{name}_tran', (0.94, 0.06, 0.04), (0, 0.04, 0.92), frame, r)
    if variant == 'blinds':
        slat = neo_m('blind', 0x7a6a52, 0, 0.8)
        for i in range(7):
            box(f'{name}_slat{i}', (0.92, 0.02, 0.035), (0, 0.045, 0.88 + i * 0.062), slat, r)
        box(f'{name}_pot', (0.16, 0.14, 0.14), (-0.28, 0.1, 0.07), neo_m('pot', 0x5a3424, 0, 0.9), r)
        sphere(f'{name}_leaf', 0.13, (-0.28, 0.1, 0.24), neo_m('leaf', 0x1e3a22, 0, 0.9), r, seg=7, rings=5)
    else:
        cur = neo_m(f'{name}curtain', 0x5a2448, 0, 0.9)
        box(f'{name}_curtain', (0.36, 0.03, 1.26), (0.27, 0.05, 0.66), cur, r)
        box(f'{name}_curtain2', (0.16, 0.03, 1.26), (-0.38, 0.05, 0.66), cur, r)


def neo_acunit():
    r = empty('neo_acunit_root', (0, 0, 0))
    body = neo_m('acbody', 0xb9bab2, 0.2, 0.6)
    dark = neo_m('acdark', 0x232427, 0.4, 0.5)
    box('neo_acunit_body', (0.92, 0.56, 0.62), (0, 0.32, 0.36), body, r, bevel=0.03)
    cyl('neo_acunit_fan', 0.23, 0.03, (0.14, 0.6, 0.36), dark, r, rot=(RX, 0, 0), verts=16)
    cyl('neo_acunit_hub', 0.05, 0.05, (0.14, 0.61, 0.36), body, r, rot=(RX, 0, 0), verts=8)
    for i in range(4):
        box(f'neo_acunit_bar{i}', (0.46, 0.015, 0.015), (0.14, 0.625, 0.36), body, r, rot=(0, i * math.pi / 4, 0))
    for i in range(8):
        box(f'neo_acunit_louvre{i}', (0.22, 0.02, 0.02), (-0.28, 0.605, 0.13 + i * 0.065), dark, r)
    iron = neo_m('mount', 0x26272b, 0.5, 0.5)
    for s in (-1, 1):
        limb(f'neo_acunit_brH{s}', (s * 0.34, 0, 0.03), (s * 0.34, 0.6, 0.03), 0.018, iron, r)
        limb(f'neo_acunit_brD{s}', (s * 0.34, 0, -0.38), (s * 0.34, 0.5, 0.03), 0.018, iron, r)
    pipe = neo_m('pipe', 0x5a5c5e, 0.5, 0.5)
    neo_tube('neo_acunit_pipe', [(-0.47, 0.25, 0.2), (-0.53, 0.06, 0.12), (-0.53, 0.06, -1.3)], 0.02, pipe, r)


def neo_pipes():
    """Drainpipe, conduit and a fuse box on a wall (front +Y), 7.4 m tall."""
    r = empty('neo_pipes_root', (0, 0, 0))
    pipe = neo_m('pipe', 0x5a5c5e, 0.5, 0.5)
    iron = neo_m('mount', 0x26272b, 0.5, 0.5)
    cyl('neo_pipes_drain', 0.065, 7.3, (0.45, 0.1, 3.65), pipe, r, verts=8)
    cyl('neo_pipes_shoe', 0.075, 0.25, (0.45, 0.17, 0.12), pipe, r, rot=(0.6, 0, 0), verts=8)
    for i in range(5):
        box(f'neo_pipes_clamp{i}', (0.16, 0.06, 0.04), (0.45, 0.04, 0.6 + i * 1.5), iron, r)
    neo_tube('neo_pipes_conduit', [(-0.95, 0.05, 2.7), (0.2, 0.05, 2.7), (0.2, 0.05, 1.75)], 0.025, iron, r)
    box('neo_pipes_box', (0.34, 0.14, 0.44), (0.2, 0.07, 1.5), neo_m('fusebox', 0x4a5258, 0.4, 0.5), r, bevel=0.01)
    box('neo_pipes_tag', (0.18, 0.01, 0.08), (0.2, 0.145, 1.62), neo_m('hazardY', 0xe2b322, 0, 0.6), r)
    sphere('neo_pipes_led', 0.018, (0.3, 0.15, 1.38), neo_m('ledG_emit4', 0x40ff70, 0, 0.3), r, seg=6, rings=4)


def neo_shutter():
    """Rolled-down shop shutter with paint tags and a lamp above (door decor, front +Y)."""
    r = empty('neo_shutter_root', (0, 0, 0))
    steel = neo_m('shutter', 0x6b7076, 0.4, 0.5)
    dark = neo_m('shutterdark', 0x2c2f33, 0.4, 0.5)
    box('neo_shutter_curtain', (2.04, 0.05, 2.5), (0, 0.025, 1.25), steel, r)
    for i in range(20):
        box(f'neo_shutter_groove{i}', (2.04, 0.056, 0.014), (0, 0.028, 0.1 + i * 0.12), dark, r)
    box('neo_shutter_box', (2.3, 0.34, 0.36), (0, 0.17, 2.68), dark, r, bevel=0.02)
    for s in (-1, 1):
        box(f'neo_shutter_rail{s}', (0.08, 0.1, 2.52), (s * 1.06, 0.05, 1.26), dark, r)
    box('neo_shutter_handle', (0.3, 0.06, 0.05), (0, 0.07, 0.14), dark, r)
    tagP = neo_m('tagPink', 0xd8358a, 0, 0.8)
    tagC = neo_m('tagTeal', 0x2fb7b0, 0, 0.8)
    tagY = neo_m('tagYellow', 0xe8c43a, 0, 0.8)
    neo_tube('neo_shutter_tagA', [(-0.8, 0.065, 1.1), (-0.62, 0.065, 1.45), (-0.44, 0.065, 1.05), (-0.25, 0.065, 1.5), (-0.05, 0.065, 1.12)], 0.035, tagP, r, verts=4)
    neo_tube('neo_shutter_tagB', neo_arc(0.45, 1.25, 0.28, 0.2, 0.3, 5.9, 9, 0.065), 0.03, tagC, r, verts=4)
    neo_tube('neo_shutter_tagC', [(0.2, 0.068, 0.8), (0.75, 0.068, 0.95)], 0.025, tagY, r, verts=4)
    neo_sconce_parts('neo_shutter_lamp', (0, 0.34, 3.0), r)


def neo_sconce_parts(name, at, r):
    iron = neo_m('mount', 0x26272b, 0.5, 0.5)
    glow = neo_m('sconce_emit2', 0xffd9a0, 0, 0.3)
    x, y, z = at
    box(f'{name}_plate', (0.16, 0.03, 0.22), (x, 0.015, z), iron, r)
    limb(f'{name}_arm', (x, 0.02, z), (x, y, z + 0.05), 0.016, iron, r)
    box(f'{name}_hood', (0.3, 0.2, 0.05), (x, y, z + 0.06), iron, r)
    box(f'{name}_bulb', (0.22, 0.12, 0.04), (x, y, z + 0.02), glow, r)


def neo_sconce():
    r = empty('neo_sconce_root', (0, 0, 0))
    neo_sconce_parts('neo_sconce', (0, 0.3, 0.0), r)


def neo_bags():
    r = empty('neo_bags_root', (0, 0, 0))
    bag = neo_m('bag', 0x141516, 0.1, 0.38)
    bag2 = neo_m('bag2', 0x1d2a20, 0.1, 0.4)
    for i, (x, y, s) in enumerate(((-0.25, 0.25, 0.28), (0.12, 0.3, 0.24), (-0.05, 0.55, 0.22))):
        sphere(f'neo_bags_b{i}', s, (x, y, s * 0.75), bag if i != 1 else bag2, r, scale=(1, 0.9, 0.8), seg=8, rings=6)
        cyl(f'neo_bags_knot{i}', 0.04, 0.1, (x, y, s * 1.45), bag if i != 1 else bag2, r, verts=6, r2=0.015)
    box('neo_bags_carton', (0.5, 0.4, 0.34), (0.42, 0.45, 0.17), neo_m('carton', 0x8a6a46, 0, 0.9), r, rot=(0, 0, 0.3))


# ------------------------------------------------------------------ street furniture
def neo_dumpster():
    r = empty('neo_dumpster_root', (0, 0, 0))
    paint = neo_m('dumpgreen', 0x2d5a40, 0.3, 0.55)
    lid = neo_m('dumplid', 0x1b1d1f, 0, 0.55)
    iron = neo_m('dumpiron', 0x37393b, 0.5, 0.5)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.65))
    o = bpy.context.object
    o.scale = (1.9, 1.1, 1.0)
    _apply(o)
    for v in o.data.vertices:
        if v.co.z < 0:
            v.co.y *= 0.84
            v.co.x *= 0.97
    finish(o, 'neo_dumpster_body', paint, r)
    box('neo_dumpster_rim', (1.95, 1.16, 0.08), (0, 0, 1.13), iron, r)
    box('neo_dumpster_lidA', (0.95, 1.16, 0.05), (-0.48, 0, 1.19), lid, r)
    th = 0.42
    box('neo_dumpster_lidB', (0.95, 1.16, 0.05), (0.48, -0.56 + 0.58 * math.cos(th), 1.18 + 0.58 * math.sin(th)), lid, r, rot=(th, 0, 0))
    sphere('neo_dumpster_bag', 0.3, (0.45, 0.05, 1.12), neo_m('bag', 0x141516, 0.1, 0.38), r, scale=(1, 0.9, 0.65), seg=8, rings=6)
    for s in (-1, 1):
        box(f'neo_dumpster_pocket{s}', (0.12, 0.9, 0.18), (s * 0.99, 0, 0.82), iron, r)
        for i, x in enumerate((-0.6, 0, 0.6)):
            box(f'neo_dumpster_rib{s}{i}', (0.1, 0.04, 0.85), (x, s * 0.52, 0.62), paint, r, rot=(-s * 0.05, 0, 0))
    for i, (x, y) in enumerate(((0.75, 0.36), (-0.75, 0.36), (0.75, -0.36), (-0.75, -0.36))):
        cyl(f'neo_dumpster_wheel{i}', 0.08, 0.06, (x, y, 0.08), lid, r, rot=(0, RX, 0), verts=8)
    box('neo_dumpster_sticker', (0.34, 0.01, 0.2), (-0.5, 0.548, 0.9), neo_m('hazardY', 0xe2b322, 0, 0.6), r, rot=(-0.05, 0, 0))


def neo_vending(name, col, logo_hex):
    """Drinks vending machine, 1.0 x 0.8 x 1.95 m, glowing front (front +Y)."""
    r = empty(f'{name}_root', (0, 0, 0))
    body = neo_m(f'{name}body', col, 0.3, 0.45)
    dark = neo_m('venddark', 0x18191c, 0.3, 0.5)
    back = neo_m('vendback_emit2', 0xdff0ff, 0, 0.3)
    logo = neo_m(f'{name}logo_emit2', logo_hex, 0, 0.3)
    btn = neo_m('vendbtn_emit2', 0x9effa0, 0, 0.3)
    cans = [neo_m('canA_emit1', 0xff5a5a, 0, 0.3), neo_m('canB_emit1', 0x5aff9a, 0, 0.3),
            neo_m('canC_emit1', 0xffd84a, 0, 0.3), neo_m('canD_emit1', 0x5ab8ff, 0, 0.3)]
    box(f'{name}_body', (1.0, 0.8, 1.95), (0, 0, 0.975), body, r, bevel=0.02)
    box(f'{name}_window', (0.64, 0.02, 1.04), (-0.13, 0.405, 1.25), back, r)
    for row in range(4):
        z = 0.84 + row * 0.25
        box(f'{name}_shelf{row}', (0.64, 0.05, 0.015), (-0.13, 0.43, z - 0.075), dark, r)
        for k in range(5):
            cyl(f'{name}_can{row}{k}', 0.035, 0.12, (-0.38 + k * 0.125, 0.43, z), cans[(row + k) % 4], r, verts=6)
    box(f'{name}_panel', (0.24, 0.02, 0.6), (0.31, 0.405, 1.3), dark, r)
    for i in range(6):
        box(f'{name}_btn{i}', (0.06, 0.012, 0.035), (0.31, 0.418, 1.52 - i * 0.075), btn, r)
    box(f'{name}_coin', (0.08, 0.02, 0.12), (0.31, 0.42, 1.02), neo_m('chrome', 0xb8bcc0, 0.9, 0.2), r)
    box(f'{name}_logo', (0.92, 0.02, 0.2), (0, 0.405, 1.82), logo, r)
    box(f'{name}_slot', (0.64, 0.04, 0.22), (-0.13, 0.41, 0.36), dark, r)
    box(f'{name}_kick', (0.98, 0.78, 0.08), (0, 0, 0.04), dark, r)


def neo_barrier():
    """Concrete road barrier, 1.95 m long along X, 0.85 m tall, red/white reflectors and an amber blinker."""
    r = empty('neo_barrier_root', (0, 0, 0))
    conc = neo_m('barrierconc', 0xb2b0a8, 0, 0.85)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.16))
    o = bpy.context.object
    o.scale = (1.94, 0.62, 0.32)
    _apply(o)
    for v in o.data.vertices:
        if v.co.z > 0:
            v.co.y *= 0.72
    finish(o, 'neo_barrier_lo', conc, r)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.57))
    o = bpy.context.object
    o.scale = (1.94, 0.446, 0.5)
    _apply(o)
    for v in o.data.vertices:
        if v.co.z > 0:
            v.co.y *= 0.5
    finish(o, 'neo_barrier_hi', conc, r)
    sr = neo_m('stripeR_emit1', 0xd02424, 0, 0.4)
    sw = neo_m('stripeW_emit1', 0xd8d8d8, 0, 0.4)
    for side in (-1, 1):
        for i in range(6):
            x = -0.8 + i * 0.32
            box(f'neo_barrier_st{side}{i}', (0.3, 0.012, 0.14), (x, side * 0.164, 0.6), sr if i % 2 == 0 else sw, r, rot=(side * 0.226, 0, 0))
    iron = neo_m('mount', 0x26272b, 0.5, 0.5)
    box('neo_barrier_bkt', (0.1, 0.08, 0.08), (0.7, 0, 0.86), iron, r)
    cyl('neo_barrier_blink', 0.06, 0.09, (0.7, 0, 0.94), neo_m('blink_emit4', 0xffa020, 0, 0.3), r, verts=8)


def neo_taxi():
    r = empty('neo_taxi_root', (0, 0, 0))
    body = neo_m('taxipaint', 0xf0b419, 0.3, 0.4)
    tyre = neo_m('tyre', 0x1c1d20, 0, 0.9)
    glass = neo_m('taxiglass', 0x1d2a34, 0.6, 0.1)
    chrome = neo_m('chrome', 0xb8bcc0, 0.9, 0.2)
    blk = neo_m('checkK', 0x161616, 0, 0.6)
    box('neo_taxi_lower', (1.76, 4.1, 0.6), (0, 0, 0.62), body, r, bevel=0.08)
    box('neo_taxi_cab', (1.58, 2.1, 0.55), (0, -0.25, 1.18), body, r, bevel=0.1)
    box('neo_taxi_wind', (1.42, 0.05, 0.5), (0, 0.86, 1.2), glass, r, rot=(-0.75, 0, 0))
    box('neo_taxi_rwind', (1.42, 0.05, 0.46), (0, -1.36, 1.2), glass, r, rot=(0.75, 0, 0))
    for s in (-1, 1):
        box(f'neo_taxi_sidewin{s}', (0.03, 1.7, 0.36), (s * 0.795, -0.25, 1.23), glass, r)
        for i in range(13):
            for k in range(2):
                if (i + k) % 2:
                    box(f'neo_taxi_chk{s}{i}{k}', (0.02, 0.14, 0.07), (s * 0.885, -0.84 + i * 0.14, 0.78 + k * 0.07), blk, r)
    box('neo_taxi_signbase', (0.66, 0.3, 0.05), (0, -0.25, 1.47), blk, r)
    box('neo_taxi_sign', (0.62, 0.26, 0.2), (0, -0.25, 1.59), neo_m('taxisign_emit2', 0xffe08a, 0, 0.3), r, bevel=0.02)
    for i, (x, y) in enumerate(((0.8, 1.3), (-0.8, 1.3), (0.8, -1.3), (-0.8, -1.3))):
        cyl(f'neo_taxi_wheel{i}', 0.34, 0.24, (x, y, 0.34), tyre, r, rot=(0, RX, 0), verts=12)
        cyl(f'neo_taxi_hub{i}', 0.16, 0.25, (x, y, 0.34), chrome, r, rot=(0, RX, 0), verts=8)
    for s in (-1, 1):
        box(f'neo_taxi_bumper{s}', (1.78, 0.12, 0.16), (0, s * 2.08, 0.42), chrome, r, bevel=0.03)
        box(f'neo_taxi_head{s}', (0.32, 0.04, 0.12), (s * 0.58, 2.06, 0.74), neo_m('taxihead_emit2', 0xf4f8ff, 0, 0.3), r)
        box(f'neo_taxi_tail{s}', (0.28, 0.04, 0.12), (s * 0.6, -2.06, 0.74), neo_m('taxitail_emit2', 0xff2a20, 0, 0.3), r)
    box('neo_taxi_grille', (0.7, 0.03, 0.14), (0, 2.06, 0.62), blk, r)


def neo_stall(name, c1, c2):
    """Night-market food stall in one 2 m cell: counter, goods, striped canopy with bulbs and a lantern (front +Y)."""
    r = empty(f'{name}_root', (0, 0, 0))
    wood = neo_m('stallwood', 0x6b4a30, 0, 0.8)
    steel = neo_m('stallsteel', 0x5a5e62, 0.5, 0.45)
    cl1 = neo_m(f'{name}cloth', c1, 0, 0.85)
    cl2 = neo_m(f'{name}cloth2', c2, 0, 0.85)
    bulb = neo_m('bulbW_emit4', 0xffe2a8, 0, 0.3)
    wire = neo_m('wire', 0x111111, 0, 0.6)
    box(f'{name}_counter', (1.7, 0.75, 0.9), (0, 0.08, 0.45), wood, r, bevel=0.02)
    box(f'{name}_top', (1.82, 0.88, 0.05), (0, 0.1, 0.925), steel, r)
    box(f'{name}_skirt', (1.66, 0.02, 0.62), (0, 0.465, 0.48), cl1, r)
    for i in range(3):
        cyl(f'{name}_bowl{i}', 0.08, 0.08, (0.15 + i * 0.22, 0.25, 0.99), neo_m('ceramic', 0xe8e4dc, 0, 0.4), r, verts=10, r2=0.13)
    cyl(f'{name}_pot', 0.2, 0.26, (-0.5, 0.05, 1.08), steel, r, verts=12)
    cyl(f'{name}_potlid', 0.21, 0.03, (-0.5, 0.05, 1.22), neo_m('potlid', 0x2a2b2e, 0.5, 0.4), r, verts=12)
    for i, cc in enumerate((0xe0662a, 0x8ac23a)):
        box(f'{name}_crate{i}', (0.3, 0.24, 0.14), (0.62, -0.12 + i * 0.02, 1.02 + i * 0.14), neo_m(f'fruit{i}', cc, 0, 0.7), r)
    back = neo_m('stallback', 0x3b2a1f, 0, 0.85)
    box(f'{name}_back', (1.74, 0.04, 1.32), (0, -0.44, 1.6), back, r)
    for i in range(5):
        box(f'{name}_plank{i}', (0.02, 0.05, 1.32), (-0.7 + i * 0.35, -0.44, 1.6), neo_m('stallplank', 0x24190f, 0, 0.9), r)
    # rear face: striped cloth banner with a neon trim, so the stall reads well from behind too
    for i in range(6):
        box(f'{name}_rearcloth{i}', (0.29, 0.012, 1.3), (-0.725 + i * 0.29, -0.468, 1.6), cl1 if i % 2 == 0 else cl2, r)
    trim = neo_m(f'{name}trim_neon', c2 if c2 != 0xeee2cc else 0xff5fa0, 0, 0.3)
    box(f'{name}_reartrim', (1.7, 0.02, 0.035), (0, -0.48, 2.2), trim, r)
    box(f'{name}_reartrim2', (1.7, 0.02, 0.035), (0, -0.48, 1.0), trim, r)
    box(f'{name}_shelf', (1.6, 0.22, 0.04), (0, -0.33, 1.3), wood, r)
    for i in range(4):
        cyl(f'{name}_jar{i}', 0.06, 0.16, (-0.6 + i * 0.4, -0.33, 1.4), neo_m(f'jar{i % 2}', (0xc8762a, 0x6a9a3a)[i % 2], 0, 0.5), r, verts=8)
    box(f'{name}_valance', (1.74, 0.03, 0.22), (0, -0.465, 2.36), cl2, r)
    box(f'{name}_menu', (0.7, 0.03, 0.36), (-0.3, -0.41, 1.75), neo_m('signback', 0x17161f, 0.4, 0.45), r)
    for i in range(3):
        box(f'{name}_menuline{i}', (0.5 - i * 0.1, 0.01, 0.035), (-0.3 - i * 0.05, -0.39, 1.85 - i * 0.09), neo_m('menu_emit2', 0xffd7a0, 0, 0.3), r)
    for sx in (-0.88, 0.88):
        for sy, h in ((0.55, 2.22), (-0.46, 2.47)):
            limb(f'{name}_pole{sx}{sy}', (sx, sy, 0), (sx, sy, h), 0.03, steel, r)
    th = -math.atan2(0.3, 1.45)
    for i in range(6):
        x = -0.8 + i * 0.32
        box(f'{name}_roof{i}', (0.32, 1.5, 0.025), (x, 0.13, 2.37), cl1 if i % 2 == 0 else cl2, r, rot=(th, 0, 0))
        box(f'{name}_flap{i}', (0.32, 0.02, 0.2), (x, 0.86, 2.13), cl1 if i % 2 == 0 else cl2, r)
    neo_tube(f'{name}_wire', [(-0.9, 0.9, 2.04), (0, 0.9, 1.96), (0.9, 0.9, 2.04)], 0.008, wire, r, verts=4)
    for i in range(7):
        x = -0.78 + i * 0.26
        sphere(f'{name}_bulb{i}', 0.045, (x, 0.9, 1.97 - 0.05 * (1 - (x / 0.9) ** 2) - 0.03), bulb, r, seg=6, rings=4)
    lan = neo_m('lantern_emit2', 0xff4a24, 0, 0.5)
    sphere(f'{name}_lantern', 0.16, (0.7, 0.72, 1.72), lan, r, scale=(1, 1, 1.3), seg=10, rings=7)
    for dz in (-0.22, 0.22):
        cyl(f'{name}_lancap{dz}', 0.07, 0.04, (0.7, 0.72, 1.72 + dz), neo_m('potlid', 0x2a2b2e, 0.5, 0.4), r, verts=8)
    limb(f'{name}_lanstring', (0.7, 0.72, 1.94), (0.7, 0.72, 2.17), 0.006, wire, r)


def neo_tables():
    """Street-food table with plastic stools, bowls and bottles (one 2 m cell, about 0.8 m tall)."""
    r = empty('neo_tables_root', (0, 0, 0))
    top = neo_m('tabletop', 0xd8d2c4, 0, 0.5)
    leg = neo_m('stallsteel', 0x5a5e62, 0.5, 0.45)
    box('neo_tables_top', (1.25, 0.75, 0.04), (0, 0, 0.74), top, r, bevel=0.01)
    box('neo_tables_apron', (1.15, 0.65, 0.06), (0, 0, 0.69), leg, r)
    for sx in (-1, 1):
        for sy in (-1, 1):
            limb(f'neo_tables_leg{sx}{sy}', (sx * 0.55, sy * 0.3, 0), (sx * 0.55, sy * 0.3, 0.7), 0.02, leg, r, verts=6)
    cols = [neo_m('stoolA', 0xc8352c, 0, 0.45), neo_m('stoolB', 0x2f6fb8, 0, 0.45)]
    for i, (x, y) in enumerate(((-0.85, 0.05), (0.86, -0.05), (-0.3, 0.62), (0.35, -0.62), (0.3, 0.64))):
        cyl(f'neo_tables_stool{i}', 0.15, 0.44, (x, y, 0.22), cols[i % 2], r, verts=10, r2=0.17)
    bowl = neo_m('ceramic', 0xe8e4dc, 0, 0.4)
    for i, (x, y) in enumerate(((-0.3, 0.12), (0.15, -0.15), (0.38, 0.18))):
        cyl(f'neo_tables_bowl{i}', 0.06, 0.07, (x, y, 0.795), bowl, r, verts=10, r2=0.1)
    for i, (x, y) in enumerate(((-0.05, 0.22), (0.02, 0.27))):
        cyl(f'neo_tables_bottle{i}', 0.03, 0.24, (x, y, 0.88), neo_m('bottleG', 0x2e6a3a, 0.2, 0.2), r, verts=8)
    box('neo_tables_tissue', (0.14, 0.1, 0.08), (-0.45, -0.2, 0.8), neo_m('tissue', 0xd84a8a, 0, 0.6), r)
    box('neo_tables_cooler', (0.5, 0.36, 0.38), (0.05, -0.95 + 0.18, 0.19), neo_m('cooler', 0x2a7ab8, 0, 0.4), r, bevel=0.02)


def neo_vent():
    """Street grate with a column of steam (no collision)."""
    r = empty('neo_vent_root', (0, 0, 0))
    iron = neo_m('ventiron', 0x2b2d30, 0.6, 0.45)
    box('neo_vent_frame', (1.1, 1.1, 0.03), (0, 0, 0.015), iron, r)
    box('neo_vent_glow', (0.9, 0.9, 0.005), (0, 0, 0.032), neo_m('ventheat_emit1', 0xff7a30, 0, 0.5), r)
    for i in range(8):
        box(f'neo_vent_slat{i}', (0.05, 0.96, 0.03), (-0.42 + i * 0.12, 0, 0.05), iron, r)
    steam = neo_m('steam_glow', 0xc8d2dc, 0, 0.9, alpha=0.03)
    for k in range(4):
        rr = 0.45 + k * 0.2
        sphere(f'neo_vent_steam{k}', rr, (0.18 * math.sin(k * 2.1), 0.16 * k, 0.6 + k * 0.6), steam, r, scale=(1, 0.85, 0.5), seg=10, rings=6)


def neo_lamppost():
    """LED street lamp standing against a wall (arm reaches out along +Y) with a soft pool of light."""
    r = empty('neo_lamppost_root', (0, 0, 0))
    pole = neo_m('lpole', 0x2a2d33, 0.6, 0.4)
    led = neo_m('lamphead_emit2', 0xe6f0ff, 0, 0.3)
    cyl('neo_lamppost_base', 0.17, 0.6, (0, 0.28, 0.3), pole, r, verts=8)
    cyl('neo_lamppost_pole', 0.07, 5.5, (0, 0.28, 3.3), pole, r, verts=8, r2=0.05)
    neo_tube('neo_lamppost_arm', [(0, 0.28, 6.0), (0, 0.55, 6.2), (0, 1.0, 6.3), (0, 1.45, 6.27)], 0.04, pole, r)
    box('neo_lamppost_head', (0.3, 0.78, 0.12), (0, 1.62, 6.2), pole, r, bevel=0.03)
    box('neo_lamppost_led', (0.24, 0.64, 0.02), (0, 1.64, 6.135), led, r)


def neo_pillar():
    """Parking-garage column, 5 m to the ceiling, hazard bands and level plates."""
    r = empty('neo_pillar_root', (0, 0, 0))
    conc = neo_m('pillarconc', 0x8c8b86, 0, 0.85)
    yel = neo_m('hazardY', 0xe2b322, 0, 0.6)
    blk = neo_m('hazardK', 0x1b1b1b, 0, 0.6)
    box('neo_pillar_col', (0.7, 0.7, 5.0), (0, 0, 2.5), conc, r)
    for i in range(4):
        box(f'neo_pillar_band{i}', (0.72, 0.72, 0.25), (0, 0, 0.125 + i * 0.25), yel if i % 2 == 0 else blk, r)
    box('neo_pillar_cap', (1.0, 1.0, 0.25), (0, 0, 4.875), conc, r)
    plate = neo_m('levelplate', 0xe8e8e0, 0, 0.6)
    blue = neo_m('levelblue', 0x2a6fd8, 0, 0.5)
    for k, (dx, dy) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        box(f'neo_pillar_plate{k}', (0.02 if dx else 0.42, 0.02 if dy else 0.42, 0.42), (dx * 0.36, dy * 0.36, 2.1), plate, r)
        box(f'neo_pillar_stripe{k}', (0.022 if dx else 0.42, 0.022 if dy else 0.42, 0.1), (dx * 0.362, dy * 0.362, 2.36), blue, r)
        box(f'neo_pillar_num{k}', (0.024 if dx else 0.06, 0.024 if dy else 0.06, 0.22), (dx * 0.364, dy * 0.364, 2.08), neo_m('levelink', 0x1d2430, 0, 0.6), r)


def neo_tubelight():
    """Ceiling fluorescent fixture; the rods reach 0.6 m up (place it 0.6 m below the ceiling)."""
    r = empty('neo_tube_root', (0, 0, 0))
    house = neo_m('tubehouse', 0x3a3d42, 0.5, 0.5)
    box('neo_tube_house', (0.24, 1.5, 0.08), (0, 0, 0.12), house, r)
    box('neo_tube_light', (0.12, 1.4, 0.045), (0, 0, 0.06), neo_m('tube_emit2', 0xeaf6ff, 0, 0.3), r)
    for s in (-0.6, 0.6):
        limb(f'neo_tube_rod{s}', (0, s, 0.16), (0, s, 0.6), 0.008, house, r)


# ------------------------------------------------------------------ overhead and skyline
def neo_lights(name, length, sag, n):
    """String of coloured bulbs, ends at z = 0 (x = +-length/2), sagging in the middle."""
    r = empty(f'{name}_root', (0, 0, 0))
    wire = neo_m('wire', 0x111111, 0, 0.6)
    mats = [neo_m('bulbW_emit4', 0xffe2a8, 0, 0.3), neo_m('bulbP_emit4', 0xff5ab8, 0, 0.3), neo_m('bulbC_emit4', 0x5ae8ff, 0, 0.3)]
    z = lambda x: -sag * (1 - (2 * x / length) ** 2)
    pts = [(-length / 2 + length * i / 10, 0, z(-length / 2 + length * i / 10)) for i in range(11)]
    neo_tube(f'{name}_wire', pts, 0.01, wire, r, verts=4)
    for i in range(n):
        x = -length / 2 + (i + 0.5) * length / n
        sphere(f'{name}_b{i}', 0.055, (x, 0, z(x) - 0.08), mats[i % 3], r, seg=6, rings=4)


def neo_tarp(name, col, L=5.0, W=3.2, sag=0.55):
    """Sagging cloth canopy strung over an alley with ropes to the corners (origin at the corner height)."""
    r = empty(f'{name}_root', (0, 0, 0))
    cloth = neo_m(f'{name}cloth', col, 0, 0.85)
    rope = neo_m('wire', 0x111111, 0, 0.6)
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=6, size=1, location=(0, 0, 0))
    o = bpy.context.object
    for v in o.data.vertices:
        u, w = v.co.x, v.co.y
        v.co.x, v.co.y = u * L, w * W
        v.co.z = -sag * (1 - (2 * u) ** 2) * (1 - 0.5 * (2 * w) ** 2) - 0.12 * (1 - (2 * u) ** 2)
    mod = o.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = 0.03
    finish(o, f'{name}_cloth', cloth, r)
    for sx in (-1, 1):
        for sy in (-1, 1):
            limb(f'{name}_rope{sx}{sy}', (sx * L / 2, sy * W / 2, 0), (sx * (L / 2 + 1.2), sy * (W / 2 + 0.2), 0.45), 0.012, rope, r)


def neo_billboard():
    """Rooftop billboard, about 1 unit tall (scaled ~11-15 in game), lit on both faces."""
    r = empty('neo_billboard_root', (0, 0, 0))
    steel = neo_m('bbsteel', 0x2a2c31, 0.5, 0.5)
    for s in (-1, 1):
        box(f'neo_billboard_leg{s}', (0.014, 0.014, 0.72), (s * 0.2, 0, 0.36), steel, r)
        limb(f'neo_billboard_brace{s}', (s * 0.2, 0, 0.1), (-s * 0.2, 0, 0.6), 0.004, steel, r)
    box('neo_billboard_walk', (0.56, 0.05, 0.006), (0, 0.03, 0.68), steel, r)
    box('neo_billboard_frame', (0.58, 0.02, 0.3), (0, 0, 0.84), steel, r)
    bg = neo_m('bbBg_emit1', 0x3a1a6a, 0, 0.4)
    pink = neo_m('bbPink_emit2', 0xff3f9a, 0, 0.4)
    cyan = neo_m('bbCyan_emit2', 0x3ae6ff, 0, 0.4)
    white = neo_m('bbWhite_emit2', 0xfff4e6, 0, 0.4)
    yel = neo_m('bbYellow_emit2', 0xffc83a, 0, 0.4)
    for s in (-1, 1):
        y = s * 0.0105
        box(f'neo_billboard_bg{s}', (0.54, 0.002, 0.26), (0, y, 0.84), bg, r)
        y2 = s * 0.0125
        box(f'neo_billboard_bandA{s}', (0.54, 0.002, 0.025), (0, y2, 0.74), pink if s > 0 else cyan, r)
        box(f'neo_billboard_bandB{s}', (0.54, 0.002, 0.012), (0, y2, 0.77), cyan if s > 0 else pink, r)
        cyl(f'neo_billboard_disc{s}', 0.075, 0.002, (s * 0.15, y2, 0.87), yel if s > 0 else pink, r, rot=(RX, 0, 0), verts=16)
        for k in range(3):
            box(f'neo_billboard_txt{s}{k}', (0.24 - k * 0.06, 0.002, 0.022), (-s * 0.1 - k * 0.03 * s, y2, 0.93 - k * 0.045), white, r)
    flood = neo_m('bbFlood_emit2', 0xf2f6ff, 0, 0.3)
    for i, x in enumerate((-0.18, 0.0, 0.18)):
        limb(f'neo_billboard_farm{i}', (x, 0.01, 0.69), (x, 0.06, 0.7), 0.003, steel, r)
        box(f'neo_billboard_flood{i}', (0.03, 0.012, 0.012), (x, 0.065, 0.705), flood, r)


def neo_antenna():
    """Lattice mast with a red beacon, 1 unit tall."""
    r = empty('neo_antenna_root', (0, 0, 0))
    steel = neo_m('mast', 0x3a3d42, 0.5, 0.5)
    rad = 0.03
    P = lambda a, z, k=1.0: (rad * k * math.cos(a), rad * k * math.sin(a), z)
    angs = [0, 2.094, 4.189]
    for i, a in enumerate(angs):
        limb(f'neo_antenna_rod{i}', P(a, 0), P(a, 0.86, 0.6), 0.0028, steel, r, verts=4)
    for lv in range(8):
        z0, z1 = lv * 0.1, (lv + 1) * 0.1
        k0, k1 = 1 - 0.4 * z0 / 0.86, 1 - 0.4 * z1 / 0.86
        for i in range(3):
            a, b = angs[i], angs[(i + 1) % 3]
            limb(f'neo_antenna_h{lv}{i}', P(a, z1, k1), P(b, z1, k1), 0.0016, steel, r, verts=4)
            limb(f'neo_antenna_d{lv}{i}', P(a, z0, k0), P(b, z1, k1), 0.0016, steel, r, verts=4)
    limb('neo_antenna_top', (0, 0, 0.84), (0, 0, 1.0), 0.003, steel, r, verts=6)
    for i, (a, z) in enumerate(((0.5, 0.62), (3.0, 0.5))):
        cyl(f'neo_antenna_dish{i}', 0.035, 0.012, (0.03 * math.cos(a), 0.03 * math.sin(a), z), neo_m('dish', 0xd8d8d2, 0.2, 0.5), r,
            rot=(RX, 0, a + math.pi / 2), verts=12, r2=0.01)
    beacon = neo_m('beacon_emit4', 0xff2a2a, 0, 0.3)
    sphere('neo_antenna_beacon', 0.009, (0, 0, 1.005), beacon, r, seg=6, rings=4)
    sphere('neo_antenna_beacon2', 0.007, (0, 0, 0.6), beacon, r, seg=6, rings=4)


def neo_watertank():
    """Rooftop water tank on stilts, 1 unit tall."""
    r = empty('neo_watertank_root', (0, 0, 0))
    steel = neo_m('mast', 0x3a3d42, 0.5, 0.5)
    wood = neo_m('tankwood', 0x5e4430, 0, 0.85)
    hoop = neo_m('hoop', 0x24262a, 0.5, 0.5)
    for sx in (-1, 1):
        for sy in (-1, 1):
            limb(f'neo_watertank_leg{sx}{sy}', (sx * 0.085, sy * 0.085, 0), (sx * 0.07, sy * 0.07, 0.56), 0.005, steel, r, verts=6)
        limb(f'neo_watertank_x{sx}', (sx * 0.08, -0.08, 0.3), (sx * 0.075, 0.075, 0.52), 0.002, steel, r, verts=4)
    cyl('neo_watertank_deck', 0.13, 0.012, (0, 0, 0.565), steel, r, verts=16)
    cyl('neo_watertank_tank', 0.11, 0.27, (0, 0, 0.705), wood, r, verts=16)
    for i in range(4):
        cyl(f'neo_watertank_hoop{i}', 0.1125, 0.006, (0, 0, 0.6 + i * 0.07), hoop, r, verts=16)
    cyl('neo_watertank_roof', 0.12, 0.08, (0, 0, 0.88), hoop, r, verts=16, r2=0.0)


def neo_join_all():
    """Join each neo_ asset's parts into one mesh (one primitive per material): far fewer nodes in the GLB."""
    for root in [o for o in bpy.data.objects if o.name.startswith('neo_') and o.name.endswith('_root') and o.parent is None]:
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
neo_sign_bowl(); neo_sign_open(); neo_sign_arrow(); neo_sign_cocktail()
neo_sign_blade('neo_signBladeP', 0xff3fa8, 0xfff0d8, (0, 2, 1, 3))
neo_sign_blade('neo_signBladeC', 0x3cf0ff, 0xffd24a, (3, 1, 0, 2))
neo_letters()
neo_window('neo_winWarm', 0xffb468, 'blinds'); neo_window('neo_winCool', 0x9cc2ff, 'curtain')
neo_acunit(); neo_pipes(); neo_shutter(); neo_sconce(); neo_bags()
neo_dumpster(); neo_vending('neo_vendRed', 0xb81d2a, 0xfff2f2); neo_vending('neo_vendBlue', 0x1f4fa8, 0xd8f4ff)
neo_barrier(); neo_taxi()
neo_stall('neo_stallR', 0xb3262e, 0xeee2cc); neo_stall('neo_stallT', 0x1f7a7a, 0xf0c64a)
neo_vent(); neo_lamppost(); neo_pillar(); neo_tubelight(); neo_tables()
neo_lights('neo_lights8', 8.0, 0.55, 14); neo_lights('neo_lights12', 12.0, 0.8, 20)
neo_tarp('neo_tarpR', 0x7a1f34); neo_tarp('neo_tarpT', 0x1d5a62)
neo_billboard(); neo_antenna(); neo_watertank()
neo_join_all()
