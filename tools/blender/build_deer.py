"""A deer as separate pieces with pivots at the joints (DEER_head at the neck, DEER_leg* at the hips),
so the game can walk, graze and bolt it by rotating parts."""
import math
import bpy
from mathutils import Vector
from common import *


def build():
    reset()
    objs = []
    fur, pale, dark = Part('Fur_Deer', 'body'), Part('Fur_White', 'pale'), Part('Dark', 'dark')
    # body: a barrel with a deeper chest and a slim rump
    rings = [(-0.62, 0.11, 0.16, 0.92), (-0.4, 0.19, 0.26, 0.94), (0.0, 0.21, 0.29, 0.97), (0.4, 0.2, 0.28, 1.0), (0.66, 0.15, 0.21, 1.06)]
    rows, faces = loft(fur.bm, rings, segs=12, bottom_flat=0.8)
    # pale belly and rump patch: faces low on the body or at the very back
    pal = [f for f in fur.bm.faces if f.calc_center_median().z < 0.8 or f.calc_center_median().y < -0.5]
    for f in pal:
        nv = [pale.bm.verts.new(v.co) for v in f.verts]
        try: pale.bm.faces.new(nv)
        except ValueError: pass
    bmesh.ops.delete(fur.bm, geom=pal, context='FACES')
    # a chest cap so the front of the barrel is closed
    bmesh.ops.create_uvsphere(fur.bm, u_segments=10, v_segments=8, radius=0.19, matrix=Matrix.Translation((0, 0.62, 1.07)))
    # tail: a short white tuft
    pale.between((0, -0.62, 1.0), (0, -0.78, 0.9), 0.05, 0.03)
    for p in (fur, pale):
        objs.append(p.finish(smooth=True, name=p.name))

    # neck and head as one piece pivoting at the shoulder
    head = Part('Fur_Deer', 'head')
    head.between((0, 0.0, 0.0), (0, 0.22, 0.42), 0.11, 0.075)
    r2, f2 = loft(head.bm, [(0.16, 0.055, 0.075, 0.44), (0.32, 0.07, 0.085, 0.48), (0.5, 0.045, 0.055, 0.44), (0.62, 0.03, 0.035, 0.42)], segs=10)
    for ex in (-1, 1):
        head.between((ex * 0.05, 0.3, 0.55), (ex * 0.14, 0.32, 0.72), 0.03, 0.006)
    hm = dark.__class__('Dark', 'nose'); hm.box((0.05, 0.04, 0.04), (0, 0.63, 0.41), bevel=0.01)
    ant = Part('Wood_Old', 'antlers')
    for ex in (-1, 1):
        ant.between((ex * 0.05, 0.27, 0.56), (ex * 0.13, 0.22, 0.95), 0.014, 0.008)
        for k, (a, b, c) in enumerate(((0.14, 0.2, 0.8), (0.17, 0.25, 0.88), (0.12, 0.3, 0.98))):
            ant.between((ex * (0.07 + k * 0.02), 0.24, 0.66 + k * 0.1), (ex * a * 1.4, b, c + 0.05), 0.008, 0.004)
    ho = head.finish(smooth=True, name='DEER_head'); ho.location = (0, 0.66, 1.1)
    no = hm.finish(name='DEER_nose'); no.location = ho.location
    ao = ant.finish(name='DEER_antlers'); ao.location = ho.location
    objs += [ho, no, ao]

    # legs: upper and lower segment with a hoof, pivot at the hip
    for name, x, y in (('FL', 0.11, 0.5), ('FR', -0.11, 0.5), ('BL', 0.11, -0.45), ('BR', -0.11, -0.45)):
        leg = Part('Fur_Deer', 'leg')
        leg.between((0, 0, 0), (0, 0.03 if y > 0 else -0.05, -0.42), 0.055, 0.035)
        leg.between((0, 0.03 if y > 0 else -0.05, -0.42), (0, 0.0 if y > 0 else 0.02, -0.9), 0.032, 0.022)
        hoof = Part('Dark', 'hoof'); hoof.box((0.05, 0.08, 0.05), (0, 0.0 if y > 0 else 0.02, -0.92), bevel=0.01)
        lo = join([leg.finish(smooth=True, name='l'), hoof.finish(name='h')], 'DEER_leg' + name)
        lo.location = (x, y, 0.9)
        objs.append(lo)
    objs.append(empty('ANCHOR_eye', (0, 0.9, 1.9), 'SPHERE', 0.1))
    export('deer', objs)


if __name__ == '__main__':
    build()
