"""Small props, the abandoned camp and the mine. Props are separate top-level nodes named P_*; the
game clones them by name and drops them where it needs them (origin at the base of each)."""
import math
import bpy
from mathutils import Vector
from common import *


def prop(name, parts, at):
    """Finish parts, join them, and park the result at `at` for previewing."""
    objs = [p.finish(smooth=False, name=name + '_' + p.name) for p in parts]
    o = join(objs, 'P_' + name) if len(objs) > 1 else objs[0]
    o.name = 'P_' + name
    o.location = at
    return o


def props():
    reset()
    objs = []
    x = 0.0

    def nxt(dx=0.9):
        nonlocal x
        x += dx
        return (x, 0, 0)

    # backpack: rounded body, flap, straps, side pockets
    b = Part('Fabric_Tent', 'pack')
    b.box((0.36, 0.22, 0.55), (0, 0, 0.29), bevel=0.05)
    b.box((0.32, 0.06, 0.28), (0, -0.12, 0.42), bevel=0.02)
    b.box((0.1, 0.1, 0.22), (0.2, 0, 0.16), bevel=0.02); b.box((0.1, 0.1, 0.22), (-0.2, 0, 0.16), bevel=0.02)
    k = Part('Dark', 'straps')
    k.box((0.05, 0.02, 0.5), (0.1, 0.115, 0.3)); k.box((0.05, 0.02, 0.5), (-0.1, 0.115, 0.3)); k.box((0.34, 0.02, 0.04), (0, 0.115, 0.22))
    objs.append(prop('backpack', [b, k], nxt()))

    c = Part('Roof_Tin_Clean', 'can')
    c.cyl(0.04, 0.04, 0.11, (0, 0, 0.055), segs=14)
    c2 = Part('Fabric_Tent', 'label'); c2.cyl(0.041, 0.041, 0.07, (0, 0, 0.055), segs=14)
    objs.append(prop('can', [c, c2], nxt(0.4)))

    bar = Part('Metal_Paint_Red', 'bar'); bar.box((0.14, 0.05, 0.015), (0, 0, 0.01), bevel=0.003)
    objs.append(prop('bar', [bar], nxt(0.4)))

    bt = Part('Roof_Tin_Clean', 'bottle'); bt.cyl(0.04, 0.04, 0.2, (0, 0, 0.1), segs=14); bt.cyl(0.02, 0.02, 0.04, (0, 0, 0.22), segs=10)
    cap = Part('Metal_Paint_Red', 'cap'); cap.cyl(0.024, 0.024, 0.03, (0, 0, 0.255), segs=10)
    objs.append(prop('bottle', [bt, cap], nxt(0.4)))

    m = Part('Metal_Paint_Red', 'kit'); m.box((0.26, 0.1, 0.18), (0, 0, 0.09), bevel=0.012)
    mw = Part('Metal_Paint_White', 'cross'); mw.box((0.08, 0.012, 0.02), (0, -0.056, 0.09)); mw.box((0.02, 0.012, 0.08), (0, -0.056, 0.09))
    objs.append(prop('medkit', [m, mw], nxt(0.5)))

    bat = Part('Dark', 'battery'); bat.box((0.26, 0.17, 0.2), (0, 0, 0.1), bevel=0.012)
    bt2 = Part('Metal_Rust', 'terminals'); bt2.cyl(0.018, 0.018, 0.03, (-0.08, 0, 0.215), segs=8); bt2.cyl(0.018, 0.018, 0.03, (0.08, 0, 0.215), segs=8)
    objs.append(prop('battery', [bat, bt2], nxt(0.5)))

    f = Part('Dark', 'torch'); f.cyl(0.02, 0.02, 0.13, (0, 0, 0.065), segs=10)
    fh = Part('Metal_Paint_Olive', 'head'); fh.cyl(0.02, 0.04, 0.05, (0, 0, 0.155), segs=12)
    objs.append(prop('flashlight', [f, fh], nxt(0.4)))

    r = Part('Metal_Paint_Olive', 'radio'); r.box((0.09, 0.04, 0.18), (0, 0, 0.09), bevel=0.008); r.between((0.03, 0, 0.18), (0.03, 0, 0.34), 0.006)
    rd = Part('Dark', 'dial'); rd.box((0.06, 0.005, 0.05), (0, -0.022, 0.13)); rd.cyl(0.012, 0.012, 0.02, (-0.02, -0.03, 0.05), rot=(math.pi / 2, 0, 0), segs=8)
    objs.append(prop('radio', [r, rd], nxt(0.4)))

    fl = Part('Metal_Paint_Red', 'flare'); fl.cyl(0.02, 0.02, 0.2, (0, 0, 0.1), segs=10)
    flc = Part('Dark', 'flarecap'); flc.cyl(0.021, 0.021, 0.02, (0, 0, 0.005), segs=10)
    objs.append(prop('flare', [fl, flc], nxt(0.3)))

    mb = Part('Wood_Fresh', 'matches'); mb.box((0.05, 0.035, 0.015), (0, 0, 0.008), bevel=0.002)
    objs.append(prop('matches', [mb], nxt(0.3)))

    pp = Part('Paper', 'page'); pp.box((0.21, 0.297, 0.003), (0, 0, 0.002))
    objs.append(prop('paper', [pp], nxt(0.4)))

    an = Part('Metal_Rust', 'antenna')
    for i in range(9):
        a = i / 9 * math.tau
        an.between((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.01 + i * 0.006), (math.cos(a + 0.7) * 0.1, math.sin(a + 0.7) * 0.1, 0.016 + i * 0.006), 0.006)
    an.between((0, 0, 0.02), (0, 0, 0.6), 0.008)
    objs.append(prop('antenna', [an], nxt(0.4)))

    w = Part('Wood_Log', 'wood')
    for i in range(5):
        w.between((-0.25, (i - 2) * 0.07, 0.05 + (i % 2) * 0.08), (0.25, (i - 2) * 0.07, 0.05 + (i % 2) * 0.08), 0.045)
    rp = Part('Rope', 'tie'); rp.between((0, -0.16, 0.03), (0, 0.16, 0.03), 0.012)
    objs.append(prop('wood', [w, rp], nxt(0.7)))

    bk = Part('Bark_Birch', 'bark') if False else Part('Paper', 'bark'); bk.box((0.16, 0.1, 0.006), (0, 0, 0.01), rot=(0, 0.2, 0.3))
    objs.append(prop('bark', [bk], nxt(0.4)))

    # trail sign: post and board (SIGNFACE gets its lettering in the game)
    sp = Part('Wood_Old', 'post'); sp.box((0.1, 0.1, 1.6), (0, 0, 0.8), bevel=0.01); sp.box((0.6, 0.05, 0.22), (0.3, -0.0, 1.4), bevel=0.01)
    sf = Part('Sign', 'face'); sf.box((0.56, 0.02, 0.18), (0.3, -0.03, 1.4))
    objs.append(prop('sign', [sp, sf], nxt(1.0)))

    ca = Part('Stone', 'cairn')
    r = rng(4)
    z = 0.0
    for i in range(6):
        s = 0.55 - i * 0.07
        ca.box((s, s * 0.9, 0.14), (r.uniform(-0.03, 0.03), r.uniform(-0.03, 0.03), z + 0.07), rot=(0, 0, r.uniform(0, 3)), bevel=0.04)
        z += 0.13
    objs.append(prop('cairn', [ca], nxt(1.0)))

    ws = Part('Wood_Old', 'pole'); ws.between((0, 0, 0), (0, 0, 5.2), 0.06, 0.04)
    wk = Part('Fabric_Tent', 'sock')
    for i in range(4):
        wk.between((0.0, i * 0.34, 5.1), (0.0, i * 0.34 + 0.34, 5.1), 0.18 - i * 0.03, 0.15 - i * 0.03, segs=10)
    wk.between((0, 0, 5.1), (0, 0.01, 5.1), 0.19)
    for v in wk.bm.verts:
        pass
    sock = wk.finish(name='windsock_cloth'); sock.name = 'P_windsock_sock'
    pole = ws.finish(name='windsock_pole'); pole.name = 'P_windsock_pole'
    sock.location = (nxt(1.0)[0], 0, 0); pole.location = sock.location
    objs += [sock, pole]

    fp = Part('Stone', 'ring')
    for i in range(10):
        a = i / 10 * math.tau
        fp.box((0.3, 0.22, 0.2), (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.1), rot=(0, 0, a), bevel=0.04)
    objs.append(prop('firering', [fp], nxt(1.6)))
    export('props', objs)


def camp():
    reset()
    objs = []
    tent = Part('Fabric_Tent', 'tent')
    # dome tent: half-cylinder with a floor, torn open at the front
    from common import loft
    rings = [(-1.2, 0.02, 0.02, 0.0), (-1.0, 0.85, 1.05, 0.0), (0.0, 1.05, 1.25, 0.0), (1.0, 0.85, 1.05, 0.0), (1.2, 0.02, 0.02, 0.0)]
    rows, faces = loft(tent.bm, rings, segs=14, bottom_flat=0.0)
    for f in [f for f in tent.bm.faces if f.calc_center_median().z < -0.01]:
        tent.bm.faces.remove(f)
    tent.box((2.0, 2.4, 0.03), (0, 0, 0.02))
    poles = Part('Metal_Paint_Olive', 'poles')
    poles.between((-1.0, 0, 0), (0, 0, 1.28), 0.012); poles.between((1.0, 0, 0), (0, 0, 1.28), 0.012)
    for o in (tent.finish(smooth=True, name='tent'), poles.finish(name='poles')):
        o.location = (-2.4, 1.0, 0)
        objs.append(o)
    table = Part('Wood_Old', 'table')
    table.box((1.8, 0.75, 0.06), (0, 0, 0.78), bevel=0.01)
    for sy in (-1, 1):
        table.box((1.8, 0.28, 0.05), (0, sy * 0.68, 0.46), bevel=0.01)
        table.box((0.07, 0.07, 0.8), (-0.75, sy * 0.22, 0.4)); table.box((0.07, 0.07, 0.8), (0.75, sy * 0.22, 0.4))
    to = table.finish(name='table'); to.location = (2.2, 0.6, 0); to.rotation_euler = (0, 0, 0.25); objs.append(to)
    ring = Part('Stone', 'ring')
    for i in range(10):
        a = i / 10 * math.tau
        ring.box((0.3, 0.22, 0.2), (math.cos(a) * 0.6, math.sin(a) * 0.6, 0.1), rot=(0, 0, a), bevel=0.04)
    ro = ring.finish(name='ring'); ro.location = (0, -2.2, 0); objs.append(ro)
    logs = Part('Wood_Log', 'seat')
    logs.between((-0.7, 1.7, 0.2), (0.7, 1.7, 0.2), 0.2); logs.between((-1.6, -0.6, 0.2), (-1.6, 0.9, 0.2), 0.2)
    lo = logs.finish(smooth=True, name='seats'); lo.location = (0, -2.2 - 1.7, 0); objs.append(lo)
    for name, pos, props_ in (('ANCHOR_firepit', (0, -2.2, 0.1), None), ('ANCHOR_camp_pack', (-1.0, -0.2, 0.3), None), ('ANCHOR_tent', (-2.4, 1.0, 0.6), None), ('ANCHOR_camp_note', (2.2, 0.6, 0.83), None)):
        objs.append(empty(name, pos, 'SPHERE', 0.25))
    objs.append(collider_box('tent', (-2.4, 1.0, 0.6), (2.1, 2.4, 1.2)))
    objs.append(collider_box('table', (2.2, 0.6, 0.5), (1.8, 1.5, 1.0), 0.25))
    export('camp', objs)


def mine():
    reset()
    objs = []
    old, tin, wood, metal, dark, stone, rope = (Part('Wood_Old', 'frame'), Part('Roof_Tin', 'roof'), Part('Wood_Planks', 'walls'),
                                               Part('Metal_Rust', 'metal'), Part('Dark', 'dark'), Part('Stone', 'stone'), Part('Rope', 'rope'))
    W, D, H = 6.2, 4.6, 3.0
    hx, hy = W / 2, D / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            old.box((0.22, 0.22, H + 0.6), (sx * hx, sy * hy, (H + 0.6) / 2), bevel=0.01)
    for z in (0.2, H - 0.05):
        old.box((W + 0.3, 0.2, 0.2), (0, hy, z)); old.box((W + 0.3, 0.2, 0.2), (0, -hy, z))
        old.box((0.2, D + 0.3, 0.2), (hx, 0, z)); old.box((0.2, D + 0.3, 0.2), (-hx, 0, z))
    # plank walls on back and left; right wall half-open; front open
    wood.box((W, 0.08, H - 0.2), (0, -hy, (H - 0.2) / 2 + 0.2), bevel=0.01)
    wood.box((0.08, D, H - 0.2), (-hx, 0, (H - 0.2) / 2 + 0.2), bevel=0.01)
    wood.box((0.08, D * 0.5, H - 0.2), (hx, -D * 0.25, (H - 0.2) / 2 + 0.2), bevel=0.01)
    wood.box((W, D, 0.12), (0, 0, 0.1))
    # pitched tin roof
    pitch = math.radians(14)
    for s in (-1, 1):
        tin.box((W + 0.8, D / 2 / math.cos(pitch) + 0.5, 0.05), (0, s * D / 4, H + 0.25 + (D / 4) * math.tan(pitch) * 0.5), rot=(-s * pitch, 0, 0), bevel=0.01)
    # workbench with tools and the battery spot; shelves
    old.box((2.6, 0.75, 0.08), (-1.4, -hy + 0.5, 0.95), bevel=0.01)
    for sx in (-2.6, -0.2):
        old.box((0.08, 0.6, 0.9), (sx, -hy + 0.5, 0.5))
    metal.box((0.9, 0.5, 0.12), (-2.1, -hy + 0.5, 1.05), bevel=0.01)          # a vice or anvil block
    metal.between((-0.9, -hy + 0.4, 1.05), (-0.5, -hy + 0.45, 1.3), 0.02)
    for z in (1.5, 2.1):
        old.box((2.4, 0.3, 0.05), (1.6, -hy + 0.2, z))
    # barrels and crates
    for i, (bx, by) in enumerate(((hx - 0.5, hy - 0.7), (hx - 1.3, hy - 0.6))):
        metal.cyl(0.3, 0.3, 0.9, (bx, by, 0.55), segs=14)
    old.box((0.8, 0.8, 0.7), (1.3, -0.4, 0.45), bevel=0.01)
    # ore cart on rails outside, and rails
    cart = Part('Metal_Rust', 'cart')
    cart.box((1.0, 1.5, 0.08), (0, 0, 0.38)); cart.box((1.0, 0.06, 0.55), (0, 0.72, 0.62)); cart.box((1.0, 0.06, 0.55), (0, -0.72, 0.62))
    cart.box((0.06, 1.5, 0.55), (0.47, 0, 0.62)); cart.box((0.06, 1.5, 0.55), (-0.47, 0, 0.62))
    for wx in (-0.42, 0.42):
        for wy in (-0.5, 0.5):
            cart.cyl(0.16, 0.16, 0.06, (wx, wy, 0.16), rot=(0, math.pi / 2, 0), segs=12)
    cart.location = None if False else None
    cobj = cart.finish(name='cart')
    cobj.location = (hx + 4.5, 2.0, 0.0)
    cobj.rotation_euler = (0, 0, 0.1)
    objs.append(cobj)
    for sx in (-0.45, 0.45):
        metal.box((0.07, 16.0, 0.08), (hx + 4.5 + sx, 5.0, 0.06))
    for i in range(24):
        old.box((1.3, 0.14, 0.09), (hx + 4.5, -2.6 + i * 0.66, 0.02))
    # timber portal to a sealed adit at the hillside behind the shed
    for sx in (-1, 1):
        old.box((0.4, 0.4, 3.2), (sx * 1.5 - hx - 4.5 + 0 * 1, -2.0 - 0.0, 1.6), bevel=0.02) if False else None
    ax, ay = -hx - 5.5, 0.0
    for sx in (-1, 1):
        old.box((0.4, 0.4, 3.0), (ax, ay + sx * 1.4, 1.5), bevel=0.02)
    old.box((0.4, 3.6, 0.4), (ax, ay, 3.1), bevel=0.02)
    for i in range(6):
        old.box((0.08, 2.4, 0.22), (ax + 0.05, ay, 0.3 + i * 0.45), rot=(0, 0, 0.05 * (i % 2 - 0.5)))      # boards nailed across
    dark.box((0.3, 2.4, 2.8), (ax - 0.3, ay, 1.4))
    for p in (old, tin, wood, metal, dark, stone, rope):
        if len(p.bm.verts):
            objs.append(p.finish(name=p.name))
    objs.append(empty('ANCHOR_battery', (-1.4, -hy + 0.5, 1.05), 'SPHERE', 0.25))
    objs.append(empty('ANCHOR_mine_note', (1.6, -hy + 0.2, 2.15), 'SPHERE', 0.2))
    objs.append(empty('ANCHOR_shed_sign', (0, hy + 0.3, 2.4), 'SPHERE', 0.2))
    objs.append(collider_box('back', (0, -hy, 1.5), (W, 0.3, 3.0)))
    objs.append(collider_box('left', (-hx, 0, 1.5), (0.3, D, 3.0)))
    objs.append(collider_box('rightBack', (hx, -D * 0.25, 1.5), (0.3, D * 0.5, 3.0)))
    objs.append(collider_box('bench', (-1.4, -hy + 0.5, 0.5), (2.6, 0.75, 1.0)))
    objs.append(collider_box('barrel1', (hx - 0.5, hy - 0.7, 0.5), (0.6, 0.6, 1.0)))
    objs.append(collider_box('barrel2', (hx - 1.3, hy - 0.6, 0.5), (0.6, 0.6, 1.0)))
    objs.append(collider_box('crate', (1.3, -0.4, 0.4), (0.8, 0.8, 0.8)))
    objs.append(collider_box('cart', (hx + 4.5, 2.0, 0.5), (1.0, 1.5, 1.0), 0.1))
    objs.append(collider_box('adit', (ax - 0.2, ay, 1.5), (0.8, 3.6, 3.0)))
    export('mine', objs)


if __name__ == '__main__':
    props()
    camp()
    mine()
