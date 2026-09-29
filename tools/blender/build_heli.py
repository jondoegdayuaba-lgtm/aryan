"""The rescue helicopter: fuselage, skids, tail boom, and separate rotor nodes so the game can spin them."""
import math
import bpy
from mathutils import Vector
from common import *


def build():
    reset()
    objs = []
    white, red, glass, dark, tin = Part('Metal_Paint_White', 'body'), Part('Metal_Paint_Red', 'stripe'), Part('Glass', 'glass', (0.2, 0.3, 0.35, 1), 0.05), Part('Dark', 'dark'), Part('Roof_Tin_Clean', 'metal')
    # fuselage: teardrop cabin narrowing into a boom
    rings = [(3.3, 0.25, 0.32, 1.25), (2.7, 0.62, 0.72, 1.4), (1.6, 0.94, 1.02, 1.55), (0.3, 1.0, 1.08, 1.6), (-1.0, 0.86, 0.95, 1.62), (-2.2, 0.5, 0.6, 1.72), (-3.4, 0.28, 0.34, 1.9), (-6.3, 0.09, 0.12, 2.15)]
    rows, faces = loft(white.bm, rings, segs=16, bottom_flat=0.7)
    # red belly stripe: faces low on the sides
    band = [f for f in white.bm.faces if abs(f.calc_center_median().x) > 0.3 and f.calc_center_median().z < 1.25 and f.calc_center_median().y > -3.0]
    for f in band:
        nv = [red.bm.verts.new(v.co) for v in f.verts]
        try: red.bm.faces.new(nv)
        except ValueError: pass
    bmesh.ops.delete(white.bm, geom=band, context='FACES')
    # tail fins
    white.box((0.06, 0.9, 1.2), (0, -6.0, 2.7), rot=(0.3, 0, 0), bevel=0.01)
    white.box((1.8, 0.5, 0.05), (0, -5.7, 2.15), bevel=0.01)
    # canopy glass over the front half
    glass.box((1.5, 1.6, 0.9), (0, 2.1, 1.85), rot=(-0.35, 0, 0), bevel=0.05)
    glass.box((0.04, 1.6, 0.8), (0.97, 0.6, 1.8)); glass.box((0.04, 1.6, 0.8), (-0.97, 0.6, 1.8))
    # engine cowling and exhaust on the roof
    white.box((1.2, 2.2, 0.55), (0, -0.7, 2.75), bevel=0.15)
    dark.cyl(0.14, 0.14, 0.5, (0.3, -1.8, 2.95), rot=(0.4, 0, 0), segs=8)
    # skids
    for sx in (-1, 1):
        dark.between((sx * 1.0, 2.6, 0.12), (sx * 1.0, -2.3, 0.12), 0.06)
        dark.between((sx * 1.0, 2.7, 0.14), (sx * 1.0, 3.1, 0.35), 0.05)
        for y in (1.4, -1.0):
            dark.between((sx * 0.95, y, 0.14), (sx * 0.72, y, 0.85), 0.045)
    # searchlight housing under the nose
    tin.cyl(0.18, 0.2, 0.25, (0, 2.9, 0.86), rot=(math.pi / 2 - 0.5, 0, 0), segs=12)
    for p in (white, red, glass, dark, tin):
        if len(p.bm.verts):
            objs.append(p.finish(smooth=True, name=p.name))

    # main rotor: hub and two long blades on their own node, origin at the mast top
    hub = Part('Dark', 'rotor')
    hub.cyl(0.12, 0.12, 0.3, (0, 0, 0), segs=10)
    hub.box((10.6, 0.36, 0.035), (0, 0, 0.14), bevel=0.005)
    hub.box((0.36, 10.6, 0.035), (0, 0, 0.16), bevel=0.005)
    ro = hub.finish(name='ROTOR_main'); ro.name = 'ROTOR_main'; ro.location = (0, 0.3, 3.15); objs.append(ro)
    # tail rotor: origin at the tail, spins about X
    tr = Part('Dark', 'trotor')
    tr.box((0.03, 0.14, 1.5), (0, 0, 0), bevel=0.004); tr.box((0.03, 1.5, 0.14), (0, 0, 0), bevel=0.004)
    to = tr.finish(name='ROTOR_tail'); to.name = 'ROTOR_tail'; to.location = (0.2, -6.2, 2.35); objs.append(to)

    objs.append(empty('LIGHT_search', (0, 3.0, 0.75), 'SPHERE', 0.2))
    objs.append(empty('NAV_red', (-1.02, 0.4, 1.3), 'SPHERE', 0.1))
    objs.append(empty('NAV_green', (1.02, 0.4, 1.3), 'SPHERE', 0.1))
    objs.append(empty('NAV_white', (0, -6.35, 2.2), 'SPHERE', 0.1))
    objs.append(empty('STROBE', (0, -1.2, 3.1), 'SPHERE', 0.1))
    objs.append(empty('ANCHOR_door', (1.0, 0.4, 1.3), 'SPHERE', 0.3))
    export('helicopter', objs)


if __name__ == '__main__':
    build()
