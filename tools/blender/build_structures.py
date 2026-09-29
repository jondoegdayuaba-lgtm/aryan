"""Buildings and set pieces: cabin, fire tower, rope bridge, mine shed, camp. Y is forward in Blender
(the front door faces +Y); the game rotates each model to fit its site."""
import math
import bpy
import mathutils.noise as mn
from mathutils import Vector
from common import *


def log_run(part, p0, p1, z, r=0.15, segs=8, ends=0.22, sag=0.0):
    """One horizontal log between two points at height z, sticking out `ends` past each end."""
    a, b = Vector(p0), Vector(p1)
    d = (b - a).normalized()
    a2, b2 = a - d * ends, b + d * ends
    part.between((a2.x, a2.y, z), (b2.x, b2.y, z), r * 1.0, r * 0.95, segs)


def wall(part, p0, p1, rows, z0, dz, openings=(), r=0.15, jitter=None):
    """A log wall from p0 to p1. openings: [(t0, t1, zlo, zhi)] as fractions of the wall length and heights."""
    a, b = Vector(p0), Vector(p1)
    L = (b - a).length
    for row in range(rows):
        z = z0 + row * dz
        cuts = [(o[0], o[1]) for o in openings if o[2] - r < z + r and z - r < o[3]]
        cuts.sort()
        t = 0.0
        segs = []
        for c0, c1 in cuts:
            if c0 > t:
                segs.append((t, c0))
            t = max(t, c1)
        if t < 1.0:
            segs.append((t, 1.0))
        for s0, s1 in segs:
            pa, pb = a.lerp(b, s0), a.lerp(b, s1)
            ends = 0.24 if (s0 == 0.0 or s1 == 1.0) else 0.0
            # only extend at real wall ends; trimmed ends at openings are flush
            aa = pa - (b - a).normalized() * (ends if s0 == 0.0 else 0)
            bb = pb + (b - a).normalized() * (ends if s1 == 1.0 else 0)
            part.between((aa.x, aa.y, z), (bb.x, bb.y, z), r, r * 0.95, 8)


def gable_planks(part, x, halfd, z0, height):
    """Triangular plank infill under the roof at one end wall (x = +/- half the width)."""
    n = 12
    for i in range(n):
        t = i / n
        z = z0 + t * height
        w = halfd * (1 - t) * 2
        if w > 0.1:
            part.box((0.08, w, height / n * 0.98), (x, 0, z + height / n / 2), bevel=0.004)


def cabin():
    reset()
    objs = []
    W, D, H = 6.4, 5.0, 2.6                       # width (x), depth (y), wall height
    hx, hy = W / 2, D / 2
    logs = Part('Wood_Log', 'walls')
    planks = Part('Wood_Planks', 'floor')
    old = Part('Wood_Old', 'trim')
    fresh = Part('Wood_Fresh', 'furniture')
    roof = Part('Roof_Shingle', 'roof')
    stone = Part('Stone', 'stone')
    metal = Part('Metal_Rust', 'metal')
    fabric = Part('Fabric_Tent', 'fabric')
    glass = Part('Glass', 'glass', (0.3, 0.45, 0.55, 1), 0.05)
    dark = Part('Dark', 'dark')

    # foundation and floor
    for x in (-hx + 0.3, -1.6, 0, 1.6, hx - 0.3):
        stone.box((0.7, 0.7, 0.36), (x, hy - 0.2, 0.05), bevel=0.05)
        stone.box((0.7, 0.7, 0.36), (x, -hy + 0.2, 0.05), bevel=0.05)
    for y in (-1.2, 0.0, 1.2):
        stone.box((0.7, 0.7, 0.36), (-hx + 0.3, y, 0.05), bevel=0.05)
        stone.box((0.7, 0.7, 0.36), (hx - 0.3, y, 0.05), bevel=0.05)
    planks.box((W, D, 0.14), (0, 0, 0.26), bevel=0.01)

    # walls, with a door and windows cut in
    rows, z0, dz = 9, 0.42, 0.27
    door_t = ((W / 2 - 0.55) / W, (W / 2 + 0.55) / W)             # front wall runs -x -> +x
    win_front = (0.72, 0.9, 1.0, 1.85)
    wall(logs, (-hx, hy, 0), (hx, hy, 0), rows, z0, dz, [(door_t[0], door_t[1], 0, 2.15), win_front])
    wall(logs, (-hx, -hy, 0), (hx, -hy, 0), rows, z0, dz, [(0.42, 0.58, 1.0, 1.85)])
    wall(logs, (-hx, -hy, 0), (-hx, hy, 0), rows, z0, dz, [(0.35, 0.62, 1.0, 1.85)])
    wall(logs, (hx, -hy, 0), (hx, hy, 0), rows, z0, dz, [(0.58, 0.85, 1.0, 1.85)])
    objs.append(logs.finish(smooth=True, name='walls'))

    # roof: ridge along x, two slopes with an overhang
    pitch = math.radians(32)
    rise = (hy + 0.6) * math.tan(pitch)
    ztop = z0 + rows * dz
    gable_planks(old, hx, hy + 0.4, ztop - 0.05, rise * 0.98)
    gable_planks(old, -hx, hy + 0.4, ztop - 0.05, rise * 0.98)
    for s in (-1, 1):
        L = (hy + 0.7) / math.cos(pitch)
        roof.box((W + 1.2, L, 0.09), (0, s * (hy + 0.7) / 2 * 0.98, ztop + rise / 2 - 0.02), rot=(-s * pitch, 0, 0), bevel=0.01)
    logs2 = Part('Wood_Log', 'beams')
    logs2.between((-hx - 0.5, 0, ztop + rise + 0.05), (hx + 0.5, 0, ztop + rise + 0.05), 0.13)
    for x in (-hx - 0.3, hx + 0.3):
        for s in (-1, 1):
            logs2.between((x, s * (hy + 0.55), ztop + 0.05), (x, 0, ztop + rise), 0.06)
    objs.append(logs2.finish(smooth=True, name='beams'))

    # chimney (right wall) and stove
    stone.box((0.9, 0.9, ztop + rise + 0.6), (hx + 0.55, -0.3, (ztop + rise + 0.6) / 2), bevel=0.04)
    stone.box((1.1, 1.1, 0.25), (hx + 0.55, -0.3, 0.3), bevel=0.04)
    metal.box((0.7, 0.55, 0.7), (hx - 0.55, -0.3, 0.72), bevel=0.03)
    metal.between((hx - 0.55, -0.3, 1.05), (hx - 0.55, -0.3, ztop + 0.3), 0.07)
    metal.box((0.6, 0.04, 0.5), (hx - 0.55, -0.02, 0.75))

    # door (its own object, origin at the hinge so the game can swing it)
    door = Part('Wood_Old', 'DOOR_main')
    door.box((1.0, 0.07, 2.1), (0.5, 0, 1.05), bevel=0.01)
    door.box((0.08, 0.1, 0.5), (0.85, -0.04, 1.0), bevel=0.01)
    do = door.finish(name='DOOR_main')
    do.location = (-0.5, hy, 0.3)
    do.name = 'DOOR_main'
    objs.append(do)
    old.box((0.1, 0.2, 2.2), (-0.56, hy, 1.4)); old.box((0.1, 0.2, 2.2), (0.56, hy, 1.4)); old.box((1.2, 0.2, 0.1), (0, hy, 2.5))

    # windows: frame, cross bars and glass
    def window(cx, cy, cz, w, along):
        sx, sy = (w, 0.06) if along == 'x' else (0.06, w)
        old.box((w + 0.16, 0.16, 0.08) if along == 'x' else (0.16, w + 0.16, 0.08), (cx, cy, cz - 0.48))
        old.box((w + 0.16, 0.16, 0.08) if along == 'x' else (0.16, w + 0.16, 0.08), (cx, cy, cz + 0.48))
        old.box((0.08, 0.16, 1.0) if along == 'x' else (0.16, 0.08, 1.0), (cx - (w / 2 + 0.04 if along == 'x' else 0), cy - (w / 2 + 0.04 if along == 'y' else 0), cz))
        old.box((0.08, 0.16, 1.0) if along == 'x' else (0.16, 0.08, 1.0), (cx + (w / 2 + 0.04 if along == 'x' else 0), cy + (w / 2 + 0.04 if along == 'y' else 0), cz))
        old.box((0.03, 0.1, 0.9) if along == 'x' else (0.1, 0.03, 0.9), (cx, cy, cz))
        glass.box((sx, sy, 0.9), (cx, cy, cz))
    window(-hx + (0.72 + 0.9) / 2 * W * 0 + (0.81 * W - hx * 1.0) , hy, 1.42, 1.15, 'x') if False else None
    fx = -hx + 0.81 * W
    window(fx, hy, 1.42, 1.15, 'x')
    window(0, -hy, 1.42, 1.0, 'x')
    window(-hx, -hy + 0.485 * D, 1.42, 1.3, 'y')
    window(hx, -hy + 0.715 * D, 1.42, 1.3, 'y')

    # porch: deck, posts, a little roof, steps
    planks.box((W - 0.4, 1.9, 0.12), (0, hy + 0.95, 0.26), bevel=0.01)
    for x in (-hx + 0.3, hx - 0.3):
        logs2b = old
        old.box((0.18, 0.18, 2.3), (x, hy + 1.75, 1.4), bevel=0.01)
    old.box((W - 0.2, 0.2, 0.14), (0, hy + 1.75, 2.55))
    roof.box((W + 0.2, 2.2, 0.07), (0, hy + 1.0, 2.75), rot=(-0.16, 0, 0), bevel=0.01)
    for i in range(3):
        planks.box((1.4, 0.32, 0.1), (0.0, hy + 1.95 + 0.3 * i, 0.2 - 0.09 * i), bevel=0.01)

    # inside: bed, table and stools, shelf, radio desk, woodpile
    fresh.box((0.95, 2.0, 0.3), (-hx + 0.7, -hy + 1.25, 0.5), bevel=0.03)
    fabric.box((0.85, 1.85, 0.16), (-hx + 0.7, -hy + 1.25, 0.72), bevel=0.05)
    fabric.box((0.5, 0.35, 0.14), (-hx + 0.7, -hy + 0.5, 0.86), bevel=0.05)
    fresh.box((1.3, 0.8, 0.06), (-1.2, -hy + 0.7, 1.0), bevel=0.02)
    for sx in (-0.55, 0.55):
        for sy in (-0.3, 0.3):
            fresh.box((0.06, 0.06, 0.7), (-1.2 + sx, -hy + 0.7 + sy, 0.63))
    for sx in (-2.0, -0.4):
        fresh.box((0.4, 0.4, 0.05), (sx, -hy + 1.4, 0.75), bevel=0.01)
        for a in (-0.15, 0.15):
            fresh.box((0.05, 0.05, 0.45), (sx + a, -hy + 1.4 + a, 0.52))
    # shelves on the back wall
    for z in (1.35, 1.9):
        fresh.box((1.8, 0.28, 0.05), (1.0, -hy + 0.18, z), bevel=0.01)
    fresh.box((0.05, 0.28, 0.6), (0.15, -hy + 0.18, 1.6)); fresh.box((0.05, 0.28, 0.6), (1.85, -hy + 0.18, 1.6))
    # radio desk against the left wall's neighbour
    fresh.box((1.3, 0.6, 0.06), (0.4, hy - 0.5, 1.02), bevel=0.02)
    fresh.box((0.06, 0.5, 0.75), (-0.2, hy - 0.5, 0.65)); fresh.box((0.06, 0.5, 0.75), (1.0, hy - 0.5, 0.65))
    dark.box((0.5, 0.3, 0.22), (0.4, hy - 0.5, 1.17), bevel=0.02)          # the long-range radio
    dark.between((0.55, hy - 0.5, 1.28), (0.55, hy - 0.5, 1.95), 0.01)
    # woodpile inside by the stove
    for i in range(8):
        logs2p = Part('Wood_Log', 'pile') if False else None
    wood = Part('Wood_Log', 'woodpile')
    for row in range(3):
        for k in range(4 - row):
            wood.between((hx - 1.55 + row * 0.15 + k * 0.3, -hy + 0.3, 0.42 + row * 0.26), (hx - 1.55 + row * 0.15 + k * 0.3, -hy + 1.0, 0.42 + row * 0.26), 0.11)
    objs.append(wood.finish(smooth=True, name='woodpile'))

    for p in (planks, old, fresh, roof, stone, metal, fabric, glass, dark):
        objs.append(p.finish(smooth=False, name=p.name))

    # lantern anchor over the table, stove fire, interaction spots
    objs.append(empty('LIGHT_lantern', (-1.2, -hy + 0.7, 1.75), 'SPHERE', 0.15))
    objs.append(empty('FIRE_stove', (hx - 0.55, -0.3, 0.9), 'PLAIN_AXES', 0.2))
    objs.append(empty('ANCHOR_radio', (0.4, hy - 0.5, 1.3), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_bed', (-hx + 0.7, -hy + 1.25, 0.95), 'SPHERE', 0.3))
    objs.append(empty('ANCHOR_wood', (hx - 1.2, -hy + 0.6, 0.9), 'SPHERE', 0.3))
    objs.append(empty('ANCHOR_supplies', (1.0, -hy + 0.2, 1.45), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_medkit', (1.6, -hy + 0.2, 2.0), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_dryfire', (0.0, hy + 1.6, 0.5), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_door', (0.0, hy, 1.0), 'SPHERE', 0.3))
    # walls (with the doorway left open) and floor
    objs.append(collider_box('floor', (0, 0, 0.14), (W, D, 0.28)))
    objs.append(collider_box('porch', (0, hy + 0.95, 0.14), (W - 0.4, 1.9, 0.28)))
    objs.append(collider_box('wallBack', (0, -hy, 1.5), (W + 0.4, 0.3, 3.0)))
    objs.append(collider_box('wallL', (-hx, 0, 1.5), (0.3, D + 0.4, 3.0)))
    objs.append(collider_box('wallR', (hx, 0, 1.5), (0.3, D + 0.4, 3.0)))
    fw = W / 2 - 0.55
    objs.append(collider_box('wallFrontL', (-hx + fw / 2 - 0.2, hy, 1.5), (fw + 0.4, 0.3, 3.0)))
    objs.append(collider_box('wallFrontR', (hx - fw / 2 + 0.2, hy, 1.5), (fw + 0.4, 0.3, 3.0)))
    objs.append(collider_box('chimney', (hx + 0.55, -0.3, 2.0), (0.9, 0.9, 4.0)))
    objs.append(collider_box('stove', (hx - 0.55, -0.3, 0.7), (0.7, 0.55, 1.0)))
    objs.append(collider_box('bed', (-hx + 0.7, -hy + 1.25, 0.5), (0.95, 2.0, 0.9)))
    objs.append(collider_box('table', (-1.2, -hy + 0.7, 0.6), (1.3, 0.8, 1.0)))
    objs.append(collider_box('desk', (0.4, hy - 0.5, 0.6), (1.3, 0.6, 1.0)))
    export('cabin', objs)


def tower():
    reset()
    objs = []
    old, fresh, roof, metal, glass = Part('Wood_Old', 'frame'), Part('Wood_Fresh', 'cab'), Part('Roof_Tin', 'roof'), Part('Metal_Rust', 'metal'), Part('Glass', 'glass', (0.3, 0.45, 0.55, 1), 0.05)
    H, base, top = 12.0, 3.4, 1.7
    def corner(sx, sy, t):
        w = (base * (1 - t) + top * t) / 2
        return (sx * w, sy * w, t * H)
    for sx in (-1, 1):
        for sy in (-1, 1):
            old.between(corner(sx, sy, 0), corner(sx, sy, 1), 0.16, 0.13)
            old.box((0.7, 0.7, 0.3), (corner(sx, sy, 0)[0] * 1.06, corner(sx, sy, 0)[1] * 1.06, 0.05))
    levels = [0.0, 0.34, 0.68, 1.0]
    for i in range(len(levels) - 1):
        t0, t1 = levels[i], levels[i + 1]
        for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            old.between(corner(*a, t1), corner(*b, t1), 0.07)
            old.between(corner(*a, t0), corner(*b, t1), 0.045)      # diagonal braces
            old.between(corner(*b, t0), corner(*a, t1), 0.045)
    # landings
    for t in (0.34, 0.68):
        w = (base * (1 - t) + top * t)
        fresh.box((w * 0.5, w * 0.9, 0.08), (-w * 0.25 * 0.5 - 0.0, 0, t * H + 0.02), bevel=0.01)
    # ladder up the front face
    ly = corner(1, 1, 0)[1]
    for k in range(int(H / 0.32)):
        z = 0.4 + k * 0.32
        t = z / H
        w = (base * (1 - t) + top * t) / 2
        old.between((-0.28, w + 0.02, z), (0.28, w + 0.02, z), 0.022)
    old.between((-0.28, base / 2 + 0.02, 0.0), (-0.28, top / 2 + 0.02, H), 0.03)
    old.between((0.28, base / 2 + 0.02, 0.0), (0.28, top / 2 + 0.02, H), 0.03)
    # cab
    cw = 3.5
    fresh.box((cw + 0.5, cw + 0.5, 0.18), (0, 0, H + 0.02), bevel=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            fresh.box((0.16, 0.16, 2.3), (sx * cw / 2, sy * cw / 2, H + 1.2), bevel=0.01)
    fresh.box((cw, 0.1, 0.9), (0, -cw / 2, H + 0.6)); fresh.box((0.1, cw, 0.9), (-cw / 2, 0, H + 0.6)); fresh.box((0.1, cw, 0.9), (cw / 2, 0, H + 0.6))
    fresh.box((cw * 0.4, 0.1, 0.9), (-cw * 0.3, cw / 2, H + 0.6)); fresh.box((cw * 0.4, 0.1, 0.9), (cw * 0.3, cw / 2, H + 0.6))
    glass.box((cw - 0.2, 0.03, 1.0), (0, cw / 2, H + 1.7)); glass.box((cw - 0.2, 0.03, 1.0), (0, -cw / 2, H + 1.7))
    glass.box((0.03, cw - 0.2, 1.0), (cw / 2, 0, H + 1.7)); glass.box((0.03, cw - 0.2, 1.0), (-cw / 2, 0, H + 1.7))
    roof.box((cw + 1.2, cw + 1.2, 0.1), (0, 0, H + 2.5), bevel=0.02)
    for k in range(4):
        a = k * math.pi / 2
        roof.box((cw + 1.0, 0.9, 0.08), (math.sin(a) * 0.3, math.cos(a) * 0.3, H + 2.7 + 0.15), rot=(0, 0, a))
    # a table and a stool inside the cab
    fresh.box((1.2, 0.7, 0.06), (0, -1.0, H + 1.05), bevel=0.02)
    fresh.box((0.06, 0.06, 0.9), (-0.55, -1.0, H + 0.6)); fresh.box((0.06, 0.06, 0.9), (0.55, -1.0, H + 0.6))
    # a rail round the platform edge
    for sx, sy, w, d in ((0, 1, cw + 0.5, 0.05), (0, -1, cw + 0.5, 0.05), (1, 0, 0.05, cw + 0.5), (-1, 0, 0.05, cw + 0.5)):
        pass
    for p in (old, fresh, roof, metal, glass):
        objs.append(p.finish(name=p.name))
    objs.append(empty('ANCHOR_tower_radio', (0.0, -1.0, H + 1.2), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_binoculars', (0.5, -1.0, H + 1.15), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_ladder_bottom', (0, base / 2 + 0.35, 0.5), 'SPHERE', 0.3, props={'top': H + 0.2}))
    objs.append(empty('ANCHOR_ladder_top', (0, top / 2 + 0.35, H + 0.2), 'SPHERE', 0.3))
    objs.append(empty('ANCHOR_tower_deck', (0, 0, H + 0.12), 'SPHERE', 0.3))
    objs.append(collider_box('deck', (0, 0, H - 0.05), (cw + 0.5, cw + 0.5, 0.3)))
    objs.append(collider_box('wallN', (0, -cw / 2, H + 0.8), (cw, 0.15, 1.2)))
    objs.append(collider_box('wallW', (-cw / 2, 0, H + 0.8), (0.15, cw, 1.2)))
    objs.append(collider_box('wallE', (cw / 2, 0, H + 0.8), (0.15, cw, 1.2)))
    objs.append(collider_box('wallSL', (-cw * 0.3, cw / 2, H + 0.8), (cw * 0.4, 0.15, 1.2)))
    objs.append(collider_box('wallSR', (cw * 0.3, cw / 2, H + 0.8), (cw * 0.4, 0.15, 1.2)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            objs.append(collider_box(f'leg{sx}{sy}', (sx * base * 0.38, sy * base * 0.38, H * 0.3), (0.5, 0.5, H * 0.6)))
    export('tower', objs)


def bridge():
    reset()
    objs = []
    L, Wd = 30.0, 1.5
    wood, rope, old = Part('Wood_Old', 'deck'), Part('Rope', 'ropes', (0.5, 0.42, 0.3, 1), 1.0), Part('Wood_Log', 'posts')
    n = int(L / 0.42)
    r = rng(9)
    gap = (n // 2 - 1, n // 2 + 1)          # two missing planks in the middle: a leap of faith
    for i in range(n):
        if gap[0] <= i <= gap[1]:
            continue
        y = -L / 2 + (i + 0.5) * L / n
        sag = -0.35 * (1 - (2 * y / L) ** 2)
        wood.box((Wd, 0.36, 0.06), (r.uniform(-0.03, 0.03), y, sag + r.uniform(-0.01, 0.01)), rot=(0, 0, r.uniform(-0.03, 0.03)), bevel=0.008)
    for sx in (-1, 1):
        # main rope and hand rope, with the deck's sag
        pts_low = [(sx * (Wd / 2 + 0.05), -L / 2 + L * k / 12, -0.35 * (1 - (2 * (-L / 2 + L * k / 12) / L) ** 2) + 0.05) for k in range(13)]
        pts_high = [(x, y, z + 1.0) for x, y, z in pts_low]
        for a, b in zip(pts_low, pts_low[1:]):
            rope.between(a, b, 0.03, segs=6)
        for a, b in zip(pts_high, pts_high[1:]):
            rope.between(a, b, 0.035, segs=6)
        for i, (lo, hi) in enumerate(zip(pts_low, pts_high)):
            if i % 1 == 0:
                rope.between(lo, hi, 0.018, segs=5)
        for y in (-L / 2, L / 2):
            old.between((sx * (Wd / 2 + 0.15), y, -0.4), (sx * (Wd / 2 + 0.15), y, 1.3), 0.13)
    for p in (wood, rope, old):
        objs.append(p.finish(smooth=True, name=p.name))
    # deck colliders in two halves (gap in the middle) and low rails
    seg = (L / 2) - (gap[1] - gap[0] + 1) * L / n / 2
    for s in (-1, 1):
        objs.append(collider_box(f'deck{s}', (0, s * (L / 4 + (gap[1] - gap[0] + 1) * L / n / 4), -0.05), (Wd, L / 2 - (gap[1] - gap[0] + 1) * L / n / 2, 0.1)))
        objs.append(collider_box(f'rail{s}A', (Wd / 2 + 0.05, s * (L / 4 + 0.6), 0.5), (0.1, L / 2 - 1.2, 1.0)))
        objs.append(collider_box(f'rail{s}B', (-Wd / 2 - 0.05, s * (L / 4 + 0.6), 0.5), (0.1, L / 2 - 1.2, 1.0)))
    objs.append(empty('ANCHOR_gap', (0, 0, 0), 'SPHERE', 0.5))
    export('bridge', objs)


def build_all():
    cabin()
    tower()
    bridge()


if __name__ == '__main__':
    build_all()
