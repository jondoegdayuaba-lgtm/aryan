"""Building pieces for Outbuild: player builds (wood / stone / metal) and the island's houses.

Everything sits on the same grid the player builds on:
    cell  = 4 m x 4 m, level height = 3 m
    Wall  : x -2..2, thickness centred on y = 0, z 0..3
    Floor : x/y -2..2, top surface at z = 0 (slab hangs below)
    Ramp  : x/y -2..2, rises from z 0 at y = +2 to z 3 at y = -2 (climbs toward -Y, i.e. +Z in game)
    Cone  : x/y -2..2, pyramid from z 0 to a 1.5 m apex
UVs are box-projected at 0.5 so each texture repeat covers 2 m (textures.py).
Material names are replaced in the game by shared textured materials.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

import common as C

S = 4.0
H = 3.0
HALF = S / 2
CONE_H = 1.5
UVS = 0.5


def M(name):
    colors = {
        'BuildWood': '#b98552', 'BuildWoodFrame': '#7a5230', 'BuildStone': '#9aa3ad', 'BuildStoneTrim': '#8a939c',
        'BuildMetal': '#8d99a6', 'BuildMetalFrame': '#5d6670', 'Siding': '#f0ede6', 'Trim': '#f7f5f0',
        'Brick': '#b2553b', 'BrickTrim': '#d9d2c5', 'Corrugated': '#e6e9ec', 'Concrete': '#b8b6b0',
        'FloorBoards': '#a8744a', 'Plaster': '#efe9df', 'Shingles': '#e9e4de', 'Glass': '#9fd4f0',
        'WoodDark': '#5a3a22', 'DoorFrame': '#f7f5f0', 'MetalDark': '#4a525b',
    }
    extra = {}
    if name == 'Glass':
        extra = dict(rough=0.05, metal=0.0, alpha=0.35)
    if name in ('BuildMetal', 'BuildMetalFrame', 'Corrugated', 'MetalDark'):
        extra = dict(rough=0.4, metal=0.6)
    return C.material(name, colors[name], **({'rough': 0.8} | extra))


def finish(obj, angle=30):
    C.box_uv(obj, UVS)
    C.set_smooth_by_angle(obj, angle)
    obj['piece'] = obj.name
    return obj


# ----------------------------------------------------------------------------- helpers

def wall_with_openings(b, thickness, mat, holes, y=0.0, trim=None, trim_w=0.12, trim_d=0.04, glass=None,
                       x0=-HALF, x1=HALF, z0=0.0, z1=H):
    """A wall slab with rectangular holes, built from boxes that tile around the holes.

    holes: list of (hx0, hx1, hz0, hz1) rectangles in wall coords.
    """
    xs = sorted({x0, x1, *[h[0] for h in holes], *[h[1] for h in holes]})
    zs = sorted({z0, z1, *[h[2] for h in holes], *[h[3] for h in holes]})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx = (xs[i] + xs[i + 1]) / 2
            cz = (zs[j] + zs[j + 1]) / 2
            if any(h[0] <= cx <= h[1] and h[2] <= cz <= h[3] for h in holes):
                continue
            w = xs[i + 1] - xs[i]
            hh = zs[j + 1] - zs[j]
            if w < 1e-4 or hh < 1e-4:
                continue
            b.box((w, thickness, hh), loc=(cx, y, cz), mat=mat)
    if trim:
        for (hx0, hx1, hz0, hz1) in holes:
            for side in (1, -1):
                yy = y + side * (thickness / 2 + trim_d / 2)
                # jambs
                b.box((trim_w, trim_d, hz1 - hz0 + trim_w), loc=(hx0 - trim_w / 2, yy, (hz0 + hz1) / 2 + trim_w / 2 * (hz0 > 0.01)),
                      mat=trim)
                b.box((trim_w, trim_d, hz1 - hz0 + trim_w), loc=(hx1 + trim_w / 2, yy, (hz0 + hz1) / 2 + trim_w / 2 * (hz0 > 0.01)),
                      mat=trim)
                # head
                b.box((hx1 - hx0 + trim_w * 2, trim_d, trim_w), loc=((hx0 + hx1) / 2, yy, hz1 + trim_w / 2), mat=trim)
                if hz0 > 0.01:  # sill
                    b.box((hx1 - hx0 + trim_w * 2.6, trim_d * 2.2, trim_w * 0.8),
                          loc=((hx0 + hx1) / 2, yy + side * trim_d * 0.6, hz0 - trim_w * 0.4), mat=trim)
            # reveal (inside faces of the hole)
            b.box((hx1 - hx0, thickness, 0.03), loc=((hx0 + hx1) / 2, y, hz1 - 0.015), mat=trim)
            b.box((0.03, thickness, hz1 - hz0), loc=(hx0 + 0.015, y, (hz0 + hz1) / 2), mat=trim)
            b.box((0.03, thickness, hz1 - hz0), loc=(hx1 - 0.015, y, (hz0 + hz1) / 2), mat=trim)
            if hz0 > 0.01:
                b.box((hx1 - hx0, thickness, 0.03), loc=((hx0 + hx1) / 2, y, hz0 + 0.015), mat=trim)
            if glass is not None and hz0 > 0.01:
                b.box((hx1 - hx0, 0.02, hz1 - hz0), loc=((hx0 + hx1) / 2, y, (hz0 + hz1) / 2), mat=glass)
                # mullions
                b.box((0.05, thickness * 0.6, hz1 - hz0), loc=((hx0 + hx1) / 2, y, (hz0 + hz1) / 2), mat=trim)
                b.box((hx1 - hx0, thickness * 0.6, 0.05), loc=((hx0 + hx1) / 2, y, (hz0 + hz1) / 2), mat=trim)


def ramp_frame():
    """Matrix taking a flat slab (x -2..2, y -2..2, top at z 0) onto the ramp incline."""
    ang = math.atan2(H, S)
    return Matrix.Translation((0, 0, H / 2)) @ Matrix.Rotation(ang, 4, 'X')


RAMP_LEN = math.hypot(S, H)


def cone_faces(b, mat, thickness, apex=CONE_H, inset=0.0):
    """Pyramid shell: 4 sloped faces + underside faces."""
    bm = bmesh.new()
    h = HALF - inset
    corners = [Vector((-h, -h, 0)), Vector((h, -h, 0)), Vector((h, h, 0)), Vector((-h, h, 0))]
    top = Vector((0, 0, apex))
    vt = bm.verts.new(top)
    vc = [bm.verts.new(c) for c in corners]
    for i in range(4):
        bm.faces.new((vc[i], vc[(i + 1) % 4], vt))
    # underside (inner pyramid)
    inner_top = bm.verts.new(top - Vector((0, 0, thickness * 1.6)))
    ic = [bm.verts.new(c + Vector((0, 0, -thickness))) for c in corners]
    for i in range(4):
        bm.faces.new((ic[(i + 1) % 4], ic[i], inner_top))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vc[j], vc[i], ic[i], ic[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    b.add_bm(bm, mat)
    bm.free()


# ----------------------------------------------------------------------------- player builds

BUILD_HOLES = {'window': (-0.7, 0.7, 1.0, 2.2), 'door': (-0.65, 0.65, 0.0, 2.35)}


def build_wall(kind, opening=None):
    """Player-built wall; `opening` ('window' | 'door') is what an edit turns it into."""
    b = C.MeshBuilder()
    hole = BUILD_HOLES.get(opening)
    holes = [hole] if hole else []
    if kind == 'wood':
        panel, frame = M('BuildWood'), M('BuildWoodFrame')
        wall_with_openings(b, 0.14, panel, holes, trim=frame if hole else None, trim_w=0.14, trim_d=0.05,
                           x0=-HALF + 0.3, x1=HALF - 0.3, z0=0.3, z1=H - 0.3)
        for x in (-HALF + 0.15, HALF - 0.15):
            b.box((0.3, 0.24, H), loc=(x, 0, H / 2), mat=frame, bevel=0.03)
        for z in (0.15, H - 0.15):
            if hole and z < 1 and hole[2] < 0.01:
                # a door cuts the bottom beam
                for (a0, a1) in ((-HALF + 0.3, hole[0]), (hole[1], HALF - 0.3)):
                    b.box((a1 - a0, 0.22, 0.3), loc=((a0 + a1) / 2, 0, z), mat=frame, bevel=0.03)
                continue
            b.box((S - 0.3, 0.22, 0.3), loc=(0, 0, z), mat=frame, bevel=0.03)
        if not hole:
            ln = math.hypot(S - 0.6, H - 0.6)
            ang = math.atan2(H - 0.6, S - 0.6)
            for y in (0.085, -0.085):
                b.box((ln, 0.04, 0.2), loc=(0, y, H / 2), rot=(0, -ang, 0), mat=frame)
    elif kind == 'stone':
        body, trim = M('BuildStone'), M('BuildStoneTrim')
        if hole:
            wall_with_openings(b, 0.3, body, holes, trim=trim, trim_w=0.16, trim_d=0.05)
        else:
            b.box((S, 0.3, H), loc=(0, 0, H / 2), mat=body, bevel=0.03)
        b.box((S + 0.02, 0.36, 0.22), loc=(0, 0, H - 0.11), mat=trim, bevel=0.04)
        if not (hole and hole[2] < 0.01):
            b.box((S + 0.02, 0.38, 0.25), loc=(0, 0, 0.125), mat=trim, bevel=0.04)
        for x in (-HALF + 0.2, HALF - 0.2):
            b.box((0.4, 0.36, H - 0.4), loc=(x, 0, H / 2), mat=trim, bevel=0.04)
    else:
        panel, frame = M('BuildMetal'), M('BuildMetalFrame')
        wall_with_openings(b, 0.1, panel, holes, trim=frame if hole else None, trim_w=0.12, trim_d=0.05,
                           x0=-HALF + 0.2, x1=HALF - 0.2, z0=0.2, z1=H - 0.2)
        for x in (-HALF + 0.1, HALF - 0.1):
            # I-beam posts
            b.box((0.2, 0.26, H), loc=(x, 0, H / 2), mat=frame, bevel=0.015)
        for z in (0.1, H / 2, H - 0.1):
            if hole and hole[2] <= z <= hole[3]:
                continue
            b.box((S - 0.2, 0.2, 0.16 if z != H / 2 else 0.1), loc=(0, 0, z), mat=frame, bevel=0.015)
    name = 'Wall_' + kind + ('_' + opening if opening else '')
    return finish(b.to_object(name))


def build_floor(kind):
    b = C.MeshBuilder()
    if kind == 'wood':
        panel, frame = M('BuildWood'), M('BuildWoodFrame')
        b.box((S - 0.3, S - 0.3, 0.14), loc=(0, 0, -0.08), mat=panel)
        for x in (-HALF + 0.15, HALF - 0.15):
            b.box((0.3, S, 0.22), loc=(x, 0, -0.11), mat=frame, bevel=0.03)
        for y in (-HALF + 0.15, HALF - 0.15):
            b.box((S - 0.6, 0.3, 0.2), loc=(0, y, -0.1), mat=frame, bevel=0.03)
    elif kind == 'stone':
        body, trim = M('BuildStone'), M('BuildStoneTrim')
        b.box((S, S, 0.24), loc=(0, 0, -0.12), mat=body, bevel=0.03)
        for x in (-HALF + 0.18, HALF - 0.18):
            b.box((0.36, S + 0.02, 0.28), loc=(x, 0, -0.13), mat=trim, bevel=0.04)
    else:
        panel, frame = M('BuildMetal'), M('BuildMetalFrame')
        b.box((S - 0.2, S - 0.2, 0.08), loc=(0, 0, -0.05), mat=panel)
        for x in (-HALF + 0.1, HALF - 0.1, 0):
            b.box((0.18, S, 0.2), loc=(x, 0, -0.1), mat=frame, bevel=0.015)
        for y in (-HALF + 0.1, HALF - 0.1):
            b.box((S - 0.2, 0.18, 0.2), loc=(0, y, -0.1), mat=frame, bevel=0.015)
    return finish(b.to_object('Floor_' + kind))


def build_ramp(kind):
    """Built flat along a slab of length RAMP_LEN, then tilted onto the incline."""
    b = C.MeshBuilder()
    L = RAMP_LEN
    if kind == 'wood':
        panel, frame = M('BuildWood'), M('BuildWoodFrame')
        b.box((S - 0.4, L, 0.12), loc=(0, 0, -0.08), mat=panel)
        for x in (-HALF + 0.2, HALF - 0.2):
            b.box((0.4, L, 0.26), loc=(x, 0, -0.12), mat=frame, bevel=0.03)
        n = 8
        for i in range(n):
            yy = -L / 2 + (i + 0.5) * L / n
            b.box((S - 0.4, 0.09, 0.06), loc=(0, yy, 0.0), mat=frame)
    elif kind == 'stone':
        body, trim = M('BuildStone'), M('BuildStoneTrim')
        b.box((S, L, 0.26), loc=(0, 0, -0.13), mat=body, bevel=0.03)
        for x in (-HALF + 0.18, HALF - 0.18):
            b.box((0.36, L, 0.34), loc=(x, 0, -0.13), mat=trim, bevel=0.04)
    else:
        panel, frame = M('BuildMetal'), M('BuildMetalFrame')
        b.box((S - 0.3, L, 0.08), loc=(0, 0, -0.05), mat=panel)
        for x in (-HALF + 0.15, HALF - 0.15):
            b.box((0.3, L, 0.22), loc=(x, 0, -0.11), mat=frame, bevel=0.015)
        n = 10
        for i in range(n):
            yy = -L / 2 + (i + 0.5) * L / n
            b.box((S - 0.3, 0.05, 0.035), loc=(0, yy, 0.0), mat=frame)
    obj = b.to_object('Ramp_' + kind)
    # tilt: the slab's -Y end must end up high (z = 3 at y = -2)
    obj.data.transform(Matrix.Translation((0, 0, H / 2)) @ Matrix.Rotation(-math.atan2(H, S), 4, 'X'))
    return finish(obj)


def build_cone(kind):
    b = C.MeshBuilder()
    if kind == 'wood':
        panel, frame = M('BuildWood'), M('BuildWoodFrame')
        cone_faces(b, panel, 0.12)
        for i in range(4):  # hip rafters
            a = math.pi / 4 + i * math.pi / 2
            ln = math.hypot(HALF * math.sqrt(2), CONE_H)
            tilt = math.atan2(CONE_H, HALF * math.sqrt(2))
            c = Vector((math.cos(a) * HALF * math.sqrt(2) / 2, math.sin(a) * HALF * math.sqrt(2) / 2, CONE_H / 2))
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(ln, 0.2, 0.16), verts=bm.verts)
            mt = Matrix.Translation(c + Vector((0, 0, 0.04))) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'Y')
            b.add_bm(bm, frame, mt)
            bm.free()
    elif kind == 'stone':
        cone_faces(b, M('BuildStone'), 0.22)
        b.box((S, 0.3, 0.2), loc=(0, -HALF + 0.15, 0.0), mat=M('BuildStoneTrim'), bevel=0.03)
        b.box((S, 0.3, 0.2), loc=(0, HALF - 0.15, 0.0), mat=M('BuildStoneTrim'), bevel=0.03)
        b.box((0.3, S - 0.6, 0.2), loc=(-HALF + 0.15, 0, 0.0), mat=M('BuildStoneTrim'), bevel=0.03)
        b.box((0.3, S - 0.6, 0.2), loc=(HALF - 0.15, 0, 0.0), mat=M('BuildStoneTrim'), bevel=0.03)
    else:
        cone_faces(b, M('BuildMetal'), 0.08)
        for y in (-HALF + 0.1, HALF - 0.1):
            b.box((S, 0.2, 0.16), loc=(0, y, 0.0), mat=M('BuildMetalFrame'), bevel=0.015)
        for x in (-HALF + 0.1, HALF - 0.1):
            b.box((0.2, S - 0.4, 0.16), loc=(x, 0, 0.0), mat=M('BuildMetalFrame'), bevel=0.015)
    return finish(b.to_object('Cone_' + kind))


# ----------------------------------------------------------------------------- houses

WIN = (-0.65, 0.65, 1.0, 2.2)
DOOR = (-0.6, 0.6, 0.0, 2.3)
GARAGE = (-1.5, 1.5, 0.0, 2.6)


def house_wall(style, opening):
    b = C.MeshBuilder()
    if style == 'siding':
        body, trim, th = M('Siding'), M('Trim'), 0.2
    elif style == 'brick':
        body, trim, th = M('Brick'), M('BrickTrim'), 0.26
    else:
        body, trim, th = M('Corrugated'), M('MetalDark'), 0.14
    holes = []
    if opening == 'window':
        holes = [WIN]
    elif opening == 'door':
        holes = [DOOR]
    elif opening == 'garage':
        holes = [GARAGE]
    wall_with_openings(b, th, body, holes, trim=trim, glass=M('Glass') if opening == 'window' else None,
                       trim_w=0.12 if style != 'metal' else 0.1)
    # corner boards / pilasters and a base course
    if style == 'siding':
        for x in (-HALF + 0.07, HALF - 0.07):
            b.box((0.14, th + 0.05, H), loc=(x, 0, H / 2), mat=trim)
        b.box((S, th + 0.05, 0.14), loc=(0, 0, H - 0.07), mat=trim)
    elif style == 'brick':
        b.box((S, th + 0.06, 0.16), loc=(0, 0, H - 0.08), mat=trim, bevel=0.02)
        b.box((S, th + 0.04, 0.2), loc=(0, 0, 0.1), mat=trim, bevel=0.02)
    else:
        for x in (-HALF + 0.08, HALF - 0.08):
            b.box((0.16, th + 0.08, H), loc=(x, 0, H / 2), mat=trim, bevel=0.01)
        b.box((S, th + 0.08, 0.12), loc=(0, 0, H - 0.06), mat=trim, bevel=0.01)
    name = {'siding': 'HouseWall', 'brick': 'BrickWall', 'metal': 'MetalWall'}[style]
    name += {'': '', 'window': 'Window', 'door': 'Door', 'garage': 'Garage'}[opening]
    return finish(b.to_object(name))


def house_floor(style):
    b = C.MeshBuilder()
    if style == 'wood':
        b.box((S, S, 0.02), loc=(0, 0, -0.01), mat=M('FloorBoards'))
        b.box((S, S, 0.2), loc=(0, 0, -0.12), mat=M('Plaster'))
        name = 'HouseFloor'
    else:
        b.box((S, S, 0.24), loc=(0, 0, -0.12), mat=M('Concrete'))
        name = 'ConcreteFloor'
    return finish(b.to_object(name))


def roof_ramp():
    b = C.MeshBuilder()
    L = RAMP_LEN
    b.box((S + 0.02, L + 0.1, 0.1), loc=(0, 0, -0.03), mat=M('Shingles'))
    b.box((S, L, 0.1), loc=(0, 0, -0.13), mat=M('Plaster'))
    # fascia along the sides and eave
    for x in (-HALF - 0.01, HALF + 0.01):
        b.box((0.06, L + 0.1, 0.26), loc=(x, 0, -0.08), mat=M('Trim'))
    b.box((S + 0.08, 0.06, 0.26), loc=(0, L / 2 + 0.05, -0.08), mat=M('Trim'))
    obj = b.to_object('Roof')
    obj.data.transform(Matrix.Translation((0, 0, H / 2)) @ Matrix.Rotation(-math.atan2(H, S), 4, 'X'))
    return finish(obj)


def roof_cone():
    b = C.MeshBuilder()
    cone_faces(b, M('Shingles'), 0.14, apex=CONE_H)
    for y in (-HALF, HALF):
        b.box((S + 0.06, 0.06, 0.22), loc=(0, y, -0.06), mat=M('Trim'))
    for x in (-HALF, HALF):
        b.box((0.06, S, 0.22), loc=(x, 0, -0.06), mat=M('Trim'))
    return finish(b.to_object('RoofCone'))


def stairs():
    b = C.MeshBuilder()
    n = 10
    run = S / n
    rise = H / n
    for i in range(n):
        y = HALF - (i + 0.5) * run
        z = (i + 1) * rise
        b.box((S - 0.5, run + 0.02, 0.06), loc=(0, y, z - 0.03), mat=M('FloorBoards'))
        b.box((S - 0.5, 0.03, rise), loc=(0, y + run / 2 - 0.015, z - rise / 2), mat=M('Plaster'))
    # stringers
    ln = RAMP_LEN
    ang = math.atan2(H, S)
    for x in (-HALF + 0.12, HALF - 0.12):
        b.box((0.24, ln, 0.34), loc=(x, 0, H / 2 - 0.12), rot=(-ang, 0, 0), mat=M('WoodDark'))
    return finish(b.to_object('Stairs'))


# ----------------------------------------------------------------------------- build

def build(preview=None):
    C.reset()
    C.clear_material_cache()
    objs = []
    for k in ('wood', 'stone', 'metal'):
        objs += [build_wall(k), build_floor(k), build_ramp(k), build_cone(k)]
    for k in ('wood', 'stone', 'metal'):
        objs += [build_wall(k, 'window'), build_wall(k, 'door')]
    for style in ('siding', 'brick'):
        for op in ('', 'window', 'door'):
            objs.append(house_wall(style, op))
    objs += [house_wall('metal', ''), house_wall('metal', 'door'), house_wall('metal', 'garage')]
    objs += [house_floor('wood'), house_floor('concrete'), roof_ramp(), roof_cone(), stairs()]
    if preview:
        # lay out a sample: row of player pieces and a little house
        placed = []
        for i, o in enumerate(objs[:12]):
            k, t = divmod(i, 4)
            o.location = (t * 5 - 7.5, k * 6, 0 if t != 1 else 1.0)
            placed.append(o)
        x0, y0 = -4, -10
        byname = {o.name: o for o in objs}

        def put(name, loc, rz=0):
            src = byname[name]
            o = bpy.data.objects.new(name + '_p', src.data)
            bpy.context.scene.collection.objects.link(o)
            o.location = loc
            o.rotation_euler = (0, 0, rz)
            return o

        put('HouseWallDoor', (x0 + 2, y0 - 2, 0))
        put('HouseWallWindow', (x0 + 6, y0 - 2, 0))
        put('HouseWall', (x0, y0, 0), math.pi / 2)
        put('BrickWallWindow', (x0 + 8, y0, 0), math.pi / 2)
        put('Roof', (x0 + 2, y0, 3))
        put('RoofCone', (x0 + 6, y0, 3))
        put('Stairs', (x0 + 14, y0, 0))
        put('MetalWallGarage', (x0 + 14, y0 - 4, 0))
        C.render_preview(preview, cam_loc=(14, -26, 14), target=(0, 0, 1.5), size=(960, 640), lens=35)
        for o in placed:
            o.location = (0, 0, 0)
    C.export_glb('pieces.glb', objs)
    return objs


if __name__ == '__main__':
    import sys
    build(sys.argv[-1] if sys.argv[-1].endswith('.png') else None)
