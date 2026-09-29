"""The crashed bush plane: torn fuselage, broken tail, one wing, engine, bent propeller, debris."""
import math
import bpy
import mathutils.noise as mn
from mathutils import Vector
from common import *


def crumple(bm, amp, freq, seed, region=None):
    for v in bm.verts:
        if region and not region(v.co):
            continue
        n = mn.noise(Vector((v.co.x * freq + seed, v.co.y * freq, v.co.z * freq - seed)))
        v.co += v.normal * n * amp


def build():
    reset()
    r = rng(12)
    objs = []

    # ---- fuselage: front section (cabin + engine) ----
    white = Part('Metal_Paint_White', 'fuselage')
    red = Part('Metal_Paint_Red', 'stripe')
    rings = [(-1.4, 0.55, 0.7, 0.84), (-0.2, 0.64, 0.8, 0.82), (1.0, 0.62, 0.74, 0.8), (2.0, 0.56, 0.66, 0.78),
             (2.7, 0.5, 0.56, 0.76), (3.15, 0.46, 0.5, 0.75)]
    rows, faces = loft(white.bm, rings, segs=16)
    # torn front edge and dented skin
    for v in rows[0]:
        v.co.y += (mn.noise(Vector((v.co.x * 3, v.co.z * 3, 1.3))) * 0.45)
    white.bm.normal_update()
    crumple(white.bm, 0.09, 1.7, 3.0)
    # open the cabin door side (left, x<0) and the tail-end break
    cut = [f for f in white.bm.faces if f.calc_center_median().x < -0.45 and -0.4 < f.calc_center_median().y < 1.2 and f.calc_center_median().z > 0.75]
    bmesh.ops.delete(white.bm, geom=cut, context='FACES')
    # stripe: move faces along the side band into the red part
    band = [f for f in white.bm.faces if abs(f.calc_center_median().x) > 0.35 and abs(f.calc_center_median().z - 0.86) < 0.12]
    for f in band:
        vs = [(v.co.copy()) for v in f.verts]
        nv = [red.bm.verts.new(p) for p in vs]
        try:
            red.bm.faces.new(nv)
        except ValueError:
            pass
    bmesh.ops.delete(white.bm, geom=band, context='FACES')
    front = [white.finish(smooth=True, name='fuselage'), red.finish(smooth=True, name='stripe')]
    objs += front

    # windows
    glass = Part('Glass', 'glass', (0.3, 0.45, 0.55, 1), 0.05)
    glass.box((0.02, 0.9, 0.34), (0.58, 0.5, 1.02), rot=(0, 0, 0), bevel=0.0)
    glass.box((1.02, 0.02, 0.34), (0, 1.55, 1.06), rot=(-0.6, 0, 0))
    objs.append(glass.finish(name='glass'))

    # interior: floor, two seats, panel, yoke
    dark = Part('Metal_Paint_Olive', 'interior')
    dark.box((1.0, 2.0, 0.05), (0, 0.4, 0.4))
    for sx in (-0.26, 0.26):
        dark.box((0.42, 0.42, 0.1), (sx, 0.2, 0.55), bevel=0.02)
        dark.box((0.42, 0.08, 0.6), (sx, -0.05, 0.9), rot=(-0.15, 0, 0), bevel=0.02)
    dark.box((1.0, 0.1, 0.32), (0, 1.35, 0.85), bevel=0.02)
    dark.between((0.25, 1.1, 0.75), (0.25, 1.32, 0.86), 0.015)
    objs.append(dark.finish(name='interior'))

    # ---- engine: exposed block, cowl ring, bent propeller ----
    eng = Part('Metal_Rust', 'engine')
    eng.cyl(0.32, 0.32, 0.7, (0, 3.35, 0.75), rot=(math.pi / 2, 0, 0), segs=12)
    for i in range(6):
        a = i / 6 * math.tau
        eng.cyl(0.13, 0.13, 0.3, (math.cos(a) * 0.3, 3.3, 0.75 + math.sin(a) * 0.3), rot=(math.pi / 2, 0, 0), segs=8)
    eng.cyl(0.08, 0.08, 0.6, (0, 3.85, 0.75), rot=(math.pi / 2, 0, 0), segs=8)
    objs.append(eng.finish(name='engine'))
    prop = Part('Metal_Rust', 'propeller', rough=0.6)
    prop.box((0.12, 0.05, 1.35), (0.0, 4.05, 0.75 + 0.1), rot=(0, 0.15, 0.25), bevel=0.01)
    prop.box((0.1, 0.05, 0.6), (-0.15, 4.0, 0.75 - 0.7), rot=(0.7, 0.2, 0.9), bevel=0.01)
    prop.cyl(0.13, 0.1, 0.16, (0, 3.98, 0.75), rot=(math.pi / 2, 0, 0), segs=10)
    objs.append(prop.finish(name='propeller'))

    # ---- broken tail section, lying at an angle ----
    tail_w, tail_r = Part('Metal_Paint_White', 'tail'), Part('Metal_Paint_Red', 'tail_stripe')
    trings = [(-4.6, 0.05, 0.07, 0.0), (-3.6, 0.16, 0.22, 0.05), (-2.4, 0.32, 0.42, 0.06), (-1.2, 0.5, 0.62, 0.05), (0.0, 0.56, 0.7, 0.0)]
    rows, faces = loft(tail_w.bm, trings, segs=12)
    for v in rows[-1]:
        v.co.y += mn.noise(Vector((v.co.x * 3, v.co.z * 3, 5.1))) * 0.4
    tail_w.bm.normal_update()
    crumple(tail_w.bm, 0.06, 1.9, 8.0)
    tail_w.box((0.05, 1.3, 1.5), (0, -4.15, 0.75), bevel=0.01)                 # fin
    tail_w.box((2.6, 0.75, 0.05), (0, -4.2, 0.1), bevel=0.01)                  # stabiliser
    tail_r.box((0.052, 0.45, 1.1), (0, -4.5, 0.75))                            # rudder stripe
    tail_objs = [tail_w.finish(smooth=True, name='tail'), tail_r.finish(name='tail_stripe')]
    tail_pivot = Vector((0, 0, 0))
    for o in tail_objs:
        o.rotation_euler = (0.32, 0.18, 0.5)
        o.location = (-3.4, -4.2, 0.35)
    objs += tail_objs

    # ---- one wing still attached, one lying in the grass ----
    wing_a = Part('Metal_Paint_White', 'wing')
    wing_a.box((4.6, 1.5, 0.14), (-2.9, 0.5, 1.45), rot=(0.0, 0.05, 0.05), bevel=0.03)
    wing_a.between((-0.4, 0.4, 0.45), (-2.2, 0.5, 1.4), 0.04)
    for v in wing_a.bm.verts:
        if v.co.x < -4.3:
            v.co.y += mn.noise(Vector((v.co.z * 5, v.co.x, 2))) * 0.35
            v.co.z += mn.noise(Vector((v.co.y * 4, 3, v.co.x))) * 0.1
    ws = Part('Metal_Paint_Red', 'wing_tip')
    ws.box((0.9, 1.3, 0.145), (-1.2, 0.5, 1.45), bevel=0.02)
    objs += [wing_a.finish(name='wing'), ws.finish(name='wing_stripe')]
    wing_b = Part('Metal_Paint_White', 'wing_lying')
    wing_b.box((4.8, 1.5, 0.14), (0, 0, 0), bevel=0.03)
    wing_b.between((-2.2, 0.2, 0.05), (-1.4, 0.2, 0.9), 0.04)
    o = wing_b.finish(name='wing_lying')
    o.location = (4.6, -0.8, 0.28)
    o.rotation_euler = (0.1, -0.12, 0.7)
    objs.append(o)

    # ---- landing gear and wheel ----
    gear = Part('Metal_Rust', 'gear')
    gear.between((0.35, 0.6, 0.35), (0.85, 0.75, -0.05), 0.045)
    objs.append(gear.finish(name='gear'))
    tyre = Part('Rubber', 'wheel', (0.03, 0.03, 0.03, 1), 0.95)
    tyre.cyl(0.36, 0.36, 0.2, (0.88, 0.75, 0.0), rot=(0, math.pi / 2, 0), segs=16)
    tyre.cyl(0.36, 0.36, 0.2, (-1.6, -0.2, 0.36), rot=(0.3, math.pi / 2 - 0.4, 0), segs=16)
    objs.append(tyre.finish(smooth=True, name='wheel'))

    # ---- debris: torn panels and wire ----
    deb = Part('Metal_Paint_White', 'debris')
    debr = Part('Metal_Paint_Red', 'debris_red')
    for i in range(16):
        a = r.uniform(0, math.tau)
        d = r.uniform(3.5, 9.5)
        p = (math.cos(a) * d, math.sin(a) * d + 1.0, 0.05)
        part = deb if i % 4 else debr
        part.box((r.uniform(0.3, 1.0), r.uniform(0.25, 0.8), 0.025), p, rot=(r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(0, 3)), bevel=0.005)
    objs += [deb.finish(name='debris'), debr.finish(name='debris_red')]

    # ---- anchors the game reads (named empties) ----
    objs.append(empty('ANCHOR_backpack', (-0.1, 0.1, 0.5), 'SPHERE', 0.25))
    objs.append(empty('FIRE_engine', (0, 3.4, 0.95), 'PLAIN_AXES', 0.3, props={'size': 1.0}))
    objs.append(empty('FIRE_wing', (-1.6, 0.5, 1.2), 'PLAIN_AXES', 0.3, props={'size': 0.6}))
    objs.append(empty('SMOKE', (0, 3.2, 1.0), 'PLAIN_AXES', 0.3))
    objs.append(empty('ANCHOR_wake', (0.0, 0.3, 0.6), 'PLAIN_AXES', 0.3))
    # collision boxes (centre, full size, yaw)
    objs.append(collider_box('fuselage', (0, 1.0, 0.9), (1.3, 4.6, 1.5)))
    objs.append(collider_box('engine', (0, 3.4, 0.7), (0.8, 1.0, 1.0)))
    objs.append(collider_box('wing', (-2.9, 0.5, 1.4), (4.6, 1.5, 0.3)))
    objs.append(collider_box('wing2', (4.6, -0.8, 0.5), (3.2, 4.4, 0.6), 0.7))
    objs.append(collider_box('tail', (-3.6, -4.5, 0.6), (1.2, 4.0, 1.3), 0.5))

    # the whole wreck rests a little nose-down and rolled
    for o in objs:
        pass
    export('wreck', objs)


if __name__ == '__main__':
    build()
