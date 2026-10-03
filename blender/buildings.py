# Buildings and man-made props. Every model sits on the ground at its origin
# with its front facing -Y (which the glTF export turns into +Z for the game).
# Each builder returns (object, colliders, platforms) in Blender local metres:
#   collider = (minx, miny, maxx, maxy, height)   solid box the player can't enter
#   platform = (minx, miny, maxx, maxy, height)   floor the player walks on (porches)
import math
import bpy
from mathutils import Matrix, Vector

from common import Builder, mat, trs


def materials(T):
    return {
        'brick': mat('Brick', image=T['brick']),
        'clap': mat('Clapboard', image=T['clapboard']),
        'white': mat('WhiteBoard', image=T['whiteboard']),
        'planks': mat('Planks', image=T['planks']),
        'barn': mat('BarnBoard', image=T['barnboard']),
        'logs': mat('Logs', image=T['logs']),
        'shingle': mat('Shingles', image=T['shingles']),
        'canvas': mat('Canvas', image=T['canvas'], double=True),
        'stone': mat('Stone', '#8a8478', 0.9),
        'trim': mat('Trim', '#3b3029', 0.8),
        'trimlight': mat('TrimLight', '#c9bfa8', 0.8),
        'wood': mat('Wood', '#6b5139', 0.85),
        'darkwood': mat('DarkWood', '#3a2a1e', 0.8),
        'glass': mat('Glass', '#1b2026', 0.15, 0.3),
        'door': mat('Door', '#4a3424', 0.8),
        'sign': mat('SignBoard', '#2d2620', 0.85),
        'letters': mat('SignPaint', '#e2d6b4', 0.7),
        'gold': mat('SignGold', '#c9a24a', 0.4, 0.6),
        'iron': mat('Iron', '#2a2a2c', 0.5, 0.8),
        'tin': mat('Tin', '#7a7d80', 0.45, 0.7),
        'ember': mat('Ember', '#ff6a1a', 0.9, emit='#ff7a20', emit_strength=6.0),
        'water': mat('TroughWater', '#2a3a3c', 0.1),
        'hay': mat('Hay', '#c2a35a', 0.95),
        'white_trim': mat('WhiteTrim', '#e7e1d2', 0.8),
    }


class Facade:
    """Boxes placed in a wall's own frame: u along the wall, n outward, z up."""

    def __init__(self, b, origin, yaw):
        self.b = b
        self.m = Matrix.Translation(Vector(origin)) @ Matrix.Rotation(yaw, 4, 'Z')

    def box(self, size, pos, material, uv=None, rot=(0, 0, 0)):
        su, sn, sz = size
        u, n, z = pos
        m = self.m @ trs((u, -n, z), rot)
        self.b.box((su, sn, sz), matrix=m, material=material, uv=uv)

    def window(self, M, u, z0, w, h, arch=False, shutters=None, bars=False, frame=None, panes=(2, 2)):
        frame = frame or M['trim']
        t = 0.07
        self.box((w, 0.03, h), (u, 0.005, z0 + h / 2), M['glass'])
        self.box((w + 2 * t, 0.08, t), (u, 0.04, z0 + h + t / 2), frame)
        self.box((w + 2 * t, 0.08, t), (u, 0.04, z0 - t / 2), frame)
        self.box((t, 0.08, h), (u - w / 2 - t / 2, 0.04, z0 + h / 2), frame)
        self.box((t, 0.08, h), (u + w / 2 + t / 2, 0.04, z0 + h / 2), frame)
        for i in range(1, panes[0]):
            self.box((0.035, 0.05, h), (u - w / 2 + w * i / panes[0], 0.03, z0 + h / 2), frame)
        for i in range(1, panes[1]):
            self.box((w, 0.05, 0.035), (u, 0.03, z0 + h * i / panes[1]), frame)
        self.box((w + 0.3, 0.14, 0.06), (u, 0.07, z0 - t - 0.03), M['stone'] if arch else frame)
        if arch:
            # Segmental brick arch over the window
            r = w * 0.75
            for i in range(9):
                a = math.radians(-38 + 76 * i / 8)
                x = u + math.sin(a) * r
                z = z0 + h + t + 0.1 + (math.cos(a) - math.cos(math.radians(38))) * r
                self.box((w / 7, 0.06, 0.24), (x, 0.03, z), M['stone'] if i == 4 else M['darkbrick'],
                         rot=(0, a, 0))
        if bars:
            for i in range(5):
                self.box((0.025, 0.025, h), (u - w / 2 + w * (i + 0.5) / 5, 0.1, z0 + h / 2), M['iron'])
        if shutters:
            for k in (-1, 1):
                self.box((w * 0.5, 0.04, h + 0.1), (u + k * (w * 0.75 + t + 0.03), 0.04, z0 + h / 2), shutters)

    def door(self, M, u, w, h, z0=0.0, double=False, transom=True, batwing=False):
        t = 0.1
        self.box((w, 0.03, h), (u, -0.02 + 0.04, z0 + h / 2), M['glass'] if batwing else M['darkwood'])
        if batwing:
            for k in (-1, 1):
                self.box((w / 2 - 0.03, 0.04, 1.1), (u + k * w / 4, 0.12, z0 + 1.15), M['door'])
        elif double:
            for k in (-1, 1):
                self.box((w / 2 - 0.02, 0.05, h - 0.05), (u + k * w / 4, 0.03, z0 + h / 2), M['door'])
                self.box((w / 2 - 0.3, 0.03, h * 0.35), (u + k * w / 4, 0.06, z0 + h * 0.66), M['glass'])
        else:
            self.box((w - 0.04, 0.05, h - 0.05), (u, 0.03, z0 + h / 2), M['door'])
            self.box((w - 0.4, 0.03, h * 0.3), (u, 0.06, z0 + h * 0.68), M['glass'])
        self.box((w + 2 * t, 0.1, t), (u, 0.05, z0 + h + t / 2), M['trim'])
        self.box((t, 0.1, h), (u - w / 2 - t / 2, 0.05, z0 + h / 2), M['trim'])
        self.box((t, 0.1, h), (u + w / 2 + t / 2, 0.05, z0 + h / 2), M['trim'])
        if transom:
            self.box((w, 0.03, 0.45), (u, 0.005, z0 + h + t + 0.25), M['glass'])
            self.box((w + 2 * t, 0.1, t), (u, 0.05, z0 + h + t + 0.52), M['trim'])

    def sign(self, M, text, u, z, w, h, size=None, board=True, color=None):
        if board:
            self.box((w, 0.08, h), (u, 0.06, z), M['sign'])
            self.box((w + 0.12, 0.1, 0.06), (u, 0.07, z + h / 2), M['trim'])
            self.box((w + 0.12, 0.1, 0.06), (u, 0.07, z - h / 2), M['trim'])
        size = size or h * 0.62
        add_text(self.b, text, size, self.m @ trs((u, -0.105, z), (math.pi / 2, 0, 0)), color or M['letters'])


def add_text(b, text, size, matrix, material):
    cu = bpy.data.curves.new('sign_text', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.012
    cu.space_character = 1.15
    ob = bpy.data.objects.new('sign_text', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    verts = [b.bm.verts.new(matrix @ v.co) for v in me.vertices]
    for p in me.polygons:
        try:
            b.bm.faces.new([verts[i] for i in p.vertices])
        except ValueError:
            pass
    b.bm.normal_update()
    b._finish(verts, material, None, False)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.curves.remove(cu)


def gable_roof(b, w, d, z0, rise, overhang, material, y0=0.0, gable_mat=None, thickness=0.12, front=True):
    """Gable roof over a w (x) by d (y) footprint whose ridge runs along Y."""
    half = w / 2 + overhang
    ang = math.atan2(rise, w / 2)
    slope = math.hypot(half, rise * half / (w / 2))
    for k in (-1, 1):
        cx = k * half / 2
        cz = z0 + rise - rise * (half / 2) / (w / 2)
        m = trs((cx, y0 + d / 2, cz), (0, k * ang, 0))
        b.box((slope, d + 2 * overhang, thickness), matrix=m, material=material, uv=1.6)
    b.box((0.18, d + 2 * overhang, 0.16), (0, y0 + d / 2, z0 + rise + 0.05), material=material)
    if gable_mat:
        for y in ((y0, y0 + d) if front else (y0 + d,)):
            b.poly([(-w / 2, y, z0), (w / 2, y, z0), (0, y, z0 + rise)] if y == y0 else
                   [(w / 2, y, z0), (-w / 2, y, z0), (0, y, z0 + rise)], gable_mat, uv=1.2)


def boardwalk(b, M, w, depth, h, posts=True, roof_h=None, roof_mat=None, rail=False, y_front=0.0):
    """Raised plank walk in front of a facade (front is at y=y_front, walk extends to -depth)."""
    b.box((w, depth, h), (0, y_front - depth / 2, h / 2), material=M['planks'], uv=1.5)
    b.box((w + 0.05, 0.12, 0.2), (0, y_front - depth + 0.02, h - 0.12), material=M['darkwood'])
    # Steps in the middle
    b.box((1.8, 0.35, h / 2), (0, y_front - depth - 0.17, h / 4), material=M['planks'], uv=1.5)
    if posts:
        n = max(2, int(w / 2.8) + 1)
        top = roof_h if roof_h else 3.4
        for i in range(n):
            x = -w / 2 + 0.12 + (w - 0.24) * i / (n - 1)
            b.box((0.14, 0.14, top - h), (x, y_front - depth + 0.15, h + (top - h) / 2), material=M['wood'])
            if rail and i < n - 1:
                xn = -w / 2 + 0.12 + (w - 0.24) * (i + 1) / (n - 1)
                if abs((x + xn) / 2) > 1.2:
                    b.box((xn - x, 0.08, 0.08), ((x + xn) / 2, y_front - depth + 0.15, h + 0.9), material=M['wood'])
        if roof_h:
            ang = math.radians(8)
            m = trs((0, y_front - depth / 2, roof_h + math.tan(ang) * depth / 2 - 0.05), (-ang, 0, 0))
            b.box((w + 0.3, depth + 0.4, 0.08), matrix=m, material=roof_mat or M['shingle'], uv=1.6)
            b.box((w + 0.3, 0.06, 0.25), (0, y_front - depth - 0.15, roof_h - 0.05), material=M['wood'])
    return (-w / 2, y_front - depth - 0.4, w / 2, y_front, h)


def brick_block(M, name, W, D, H, sign, floors=2, storefront=False, porch_roof=False, bars=False):
    b = Builder(name)
    b.box((W, D, H), (0, D / 2, H / 2), material=M['brick'], uv=1.2)
    b.box((W + 0.12, D + 0.12, 0.5), (0, D / 2, 0.25), material=M['stone'], uv=1.0)
    # Cornice with dentils and a parapet
    b.box((W + 0.5, D + 0.5, 0.32), (0, D / 2, H + 0.05), material=M['trim'])
    for i in range(int(W / 0.45)):
        x = -W / 2 + 0.25 + i * 0.45
        b.box((0.18, 0.12, 0.14), (x, -0.06, H - 0.18), material=M['trim'])
    b.box((W, 0.35, 0.7), (0, 0.17, H + 0.55), material=M['brick'], uv=1.2)
    b.box((W + 0.1, 0.45, 0.12), (0, 0.17, H + 0.92), material=M['stone'])
    f = Facade(b, (0, 0, 0), 0)
    if floors == 2:
        zf = H * 0.5
        b.box((W + 0.1, D + 0.1, 0.18), (0, D / 2, zf), material=M['stone'])
        n_up = max(2, int(W / 2.6))
        for i in range(n_up):
            u = -W / 2 + W * (i + 0.5) / n_up
            f.window(M, u, zf + 0.9, 1.05, 2.0, arch=True, panes=(2, 3))
    # Ground floor
    if storefront:
        f.door(M, 0, 1.6, 2.6, z0=0.0, double=True)
        for k in (-1, 1):
            u = k * (W / 4 + 0.35)
            f.box((W / 2 - 1.8, 0.12, 0.6), (u, 0.06, 0.3), M['trim'])
            f.window(M, u, 0.65, W / 2 - 2.0, 2.2, panes=(3, 1))
    else:
        f.door(M, 0, 1.7, 2.7, double=True)
        for k in (-1, 1):
            f.window(M, k * W * 0.3, 0.95, 1.3, 2.3, arch=True, bars=bars, panes=(2, 3))
    # Side windows
    sides = []
    for k, yaw in ((1, math.pi / 2), (-1, -math.pi / 2)):
        fs = Facade(b, (k * W / 2, D / 2, 0), yaw)
        n = max(1, int(D / 3.5))
        for i in range(n):
            u = -D / 2 + D * (i + 0.5) / n
            fs.window(M, u, 0.95, 1.0, 2.0, arch=True, bars=bars)
            if floors == 2:
                fs.window(M, u, H * 0.5 + 0.9, 1.0, 2.0, arch=True)
    if sign:
        if floors == 2:
            f.sign(M, sign, 0, H + 0.55, min(W * 0.6, len(sign) * 0.55 + 1.0), 0.55, board=False, color=M['gold'])
        else:
            f.sign(M, sign, 0, H + 0.55, min(W * 0.75, len(sign) * 0.5 + 1.0), 0.55, board=False, color=M['gold'])
    plat = boardwalk(b, M, W + 0.6, 2.8, 0.38, posts=porch_roof, roof_h=3.5 if porch_roof else None)
    ob = b.build()
    return ob, [(-W / 2, 0, W / 2, D, H + 1.0)], [plat]


def wood_block(M, name, W, D, H, sign, balcony=True, false_front=True, wall=None):
    """Two-storey wooden building (saloon, hotel) or one-storey false-front shop."""
    wall = wall or M['clap']
    b = Builder(name)
    two = H > 5
    b.box((W, D, H), (0, D / 2, H / 2), material=wall, uv=1.2)
    gable_roof(b, W, D, H, 1.6, 0.25, M['shingle'], gable_mat=wall, front=not false_front)
    ff_h = H + (1.9 if false_front else 0)
    if false_front:
        b.box((W + 0.3, 0.2, ff_h - H + 0.1), (0, 0.1, H + (ff_h - H) / 2), material=wall, uv=1.2)
        b.box((W + 0.6, 0.35, 0.18), (0, -0.08, ff_h + 0.05), material=M['trim'])
    for k in (-1, 1):
        b.box((0.16, 0.12, ff_h), (k * (W / 2 + 0.05), -0.06, ff_h / 2), material=M['trim'])
    f = Facade(b, (0, 0, 0), 0)
    if two:
        zf = 3.6
        for i, u in enumerate((-W * 0.33, 0, W * 0.33)):
            if balcony and i == 1:
                f.door(M, u, 1.0, 2.2, z0=zf + 0.15, transom=False)
            else:
                f.window(M, u, zf + 0.9, 1.0, 1.7, shutters=M['darkwood'])
        f.door(M, 0, 1.7, 2.6, batwing=(sign == 'SALOON'), double=(sign != 'SALOON'))
        for k in (-1, 1):
            f.window(M, k * W * 0.32, 0.8, 1.6, 2.0, panes=(3, 2))
        f.sign(M, sign, 0, H + (0.95 if false_front else -0.6), min(W * 0.8, len(sign) * 0.62 + 1.2), 0.85)
    else:
        f.door(M, 0, 1.2, 2.4)
        for k in (-1, 1):
            f.window(M, k * W * 0.3, 0.8, 1.4, 1.8, panes=(2, 2))
        f.sign(M, sign, 0, H + 0.9, min(W * 0.85, len(sign) * 0.5 + 1.0), 0.7)
    for k, yaw in ((1, math.pi / 2), (-1, -math.pi / 2)):
        fs = Facade(b, (k * W / 2, D / 2, 0), yaw)
        for i in range(max(1, int(D / 4))):
            u = -D / 2 + D * (i + 0.5) / max(1, int(D / 4))
            fs.window(M, u, 0.9, 0.9, 1.6)
            if two:
                fs.window(M, u, 4.5, 0.9, 1.5)
    plat = boardwalk(b, M, W + 0.6, 2.8, 0.38, posts=True, roof_h=3.5 if (two and balcony) else 3.3,
                     rail=True)
    if two and balcony:
        # Balcony on top of the porch roof, with a railing
        b.box((W + 0.5, 2.9, 0.12), (0, -1.45, 3.62), material=M['planks'], uv=1.5)
        for i in range(int(W / 0.35)):
            x = -W / 2 + 0.1 + i * 0.35
            b.box((0.05, 0.05, 0.9), (x, -2.75, 4.1), material=M['wood'])
        b.box((W + 0.4, 0.1, 0.08), (0, -2.75, 4.56), material=M['wood'])
    ob = b.build()
    return ob, [(-W / 2, 0, W / 2, D, ff_h)], [plat]


def house(M, name, W=7.0, D=8.0, wall=None, porch=True):
    wall = wall or M['clap']
    b = Builder(name)
    H = 3.0
    b.box((W, D, 0.4), (0, D / 2, 0.2), material=M['stone'], uv=1.0)
    b.box((W, D, H), (0, D / 2, 0.4 + H / 2), material=wall, uv=1.2)
    gable_roof(b, W, D, H + 0.4, 2.0, 0.35, M['shingle'], gable_mat=wall)
    b.box((0.7, 0.7, 2.6), (W / 2 - 0.8, D * 0.7, H + 2.0), material=M['stone'], uv=1.0)
    f = Facade(b, (0, 0, 0), 0)
    f.door(M, 0, 1.0, 2.2, z0=0.4, transom=False)
    for k in (-1, 1):
        f.window(M, k * W * 0.3, 1.3, 1.0, 1.4, shutters=M['darkwood'])
    for k, yaw in ((1, math.pi / 2), (-1, -math.pi / 2)):
        fs = Facade(b, (k * W / 2, D / 2, 0), yaw)
        fs.window(M, -D * 0.2, 1.3, 0.9, 1.3)
        fs.window(M, D * 0.25, 1.3, 0.9, 1.3)
    plats = []
    if porch:
        plats.append(boardwalk(b, M, W + 0.4, 2.2, 0.4, posts=True, roof_h=2.9))
    ob = b.build()
    return ob, [(-W / 2, 0, W / 2, D, H + 2.4)], plats


def farmhouse(M):
    """One-and-a-half storey farmhouse with its gable facing the yard and a deep porch."""
    b = Builder('Farmhouse')
    W, D, H = 8.0, 9.0, 4.2
    b.box((W, D, 0.5), (0, D / 2, 0.25), material=M['stone'], uv=1.0)
    b.box((W, D, H), (0, D / 2, 0.5 + H / 2), material=M['clap'], uv=1.2)
    # Ridge runs front-to-back so the gable faces the porch
    rise = 3.2
    half = W / 2 + 0.4
    ang = math.atan2(rise, W / 2)
    for k in (-1, 1):
        slope = half / math.cos(ang)
        cz = 0.5 + H + rise - math.tan(ang) * half / 2
        m = trs((k * half / 2, D / 2, cz), (0, k * ang, 0))
        b.box((slope, D + 0.8, 0.14), matrix=m, material=M['shingle'], uv=1.6)
    for y in (0.0, D):
        pts = [(-W / 2, y, 0.5 + H), (W / 2, y, 0.5 + H), (0, y, 0.5 + H + rise)]
        b.poly(pts if y == 0 else list(reversed(pts)), M['clap'], uv=1.2)
    f = Facade(b, (0, 0, 0), 0)
    f.door(M, -1.3, 1.0, 2.3, z0=0.5, transom=False)
    f.window(M, 1.6, 1.4, 1.1, 1.6, shutters=M['darkwood'])
    f.window(M, -3.0, 1.4, 0.8, 1.6)
    f.window(M, 0, 5.4, 0.9, 1.1)
    for k, yaw in ((1, math.pi / 2), (-1, -math.pi / 2)):
        fs = Facade(b, (k * W / 2, D / 2, 0), yaw)
        for u in (-2.6, 0.4, 3.0):
            fs.window(M, u, 1.4, 0.9, 1.5)
    # Chimney
    b.box((0.8, 0.8, 4.8), (W / 2 - 1.0, D * 0.62, 0.5 + H + 1.6), material=M['stone'], uv=1.0)
    # Porch with its own shed roof across the whole front
    plat = boardwalk(b, M, W + 1.2, 2.6, 0.5, posts=True, roof_h=3.2, rail=True)
    ob = b.build()
    return ob, [(-W / 2, 0, W / 2, D, H + 3.5)], [plat]


def barn(M):
    b = Builder('Barn')
    W, D, H = 10.0, 14.0, 4.6
    b.box((W, D, H), (0, D / 2, H / 2), material=M['barn'], uv=1.6)
    # Gambrel roof: steep lower slopes and shallow upper ones
    pts = [(-W / 2 - 0.3, H - 0.2), (-W / 2 + 1.4, H + 2.6), (0, H + 3.8), (W / 2 - 1.4, H + 2.6), (W / 2 + 0.3, H - 0.2)]
    for a, c in zip(pts, pts[1:]):
        mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
        L = math.hypot(c[0] - a[0], c[1] - a[1])
        ang = math.atan2(c[1] - a[1], c[0] - a[0])
        b.box((L + 0.05, D + 0.6, 0.14), matrix=trs((mid[0], D / 2, mid[1]), (0, -ang, 0)), material=M['tin'], uv=1.6)
    for y in (0.0, D):
        poly = [(-W / 2, y, H), (W / 2, y, H), (W / 2 - 1.4, y, H + 2.6), (0, y, H + 3.8), (-W / 2 + 1.4, y, H + 2.6)]
        b.poly(poly if y == 0 else list(reversed(poly)), M['barn'], uv=1.6)
    f = Facade(b, (0, 0, 0), 0)
    # Big sliding doors with white X bracing
    for k in (-1, 1):
        u = k * 1.6
        f.box((3.0, 0.08, 3.6), (u, 0.04, 1.8), M['barn'], uv=1.6)
        for (a, c) in (((-1.4, 0.1), (1.4, 3.5)), ((-1.4, 3.5), (1.4, 0.1))):
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            ang = math.atan2(c[1] - a[1], c[0] - a[0])
            f.box((L, 0.06, 0.16), (u, 0.1, 1.8), M['white_trim'], rot=(0, -ang, 0))
        f.box((3.0, 0.1, 0.16), (u, 0.1, 3.55), M['white_trim'])
        f.box((3.0, 0.1, 0.16), (u, 0.1, 0.1), M['white_trim'])
        f.box((0.16, 0.1, 3.6), (u + k * 1.42, 0.1, 1.8), M['white_trim'])
    f.box((6.6, 0.14, 0.14), (0, 0.1, 3.75), M['iron'])
    f.box((1.6, 0.06, 1.4), (0, 0.04, H + 1.4), M['darkwood'])
    f.box((1.8, 0.1, 0.12), (0, 0.08, H + 2.15), M['white_trim'])
    ob = b.build()
    return ob, [(-W / 2, 0, W / 2, D, H + 3.8)], []


def cabin(M):
    b = Builder('Cabin')
    W, D, H = 6.0, 5.0, 2.8
    b.box((W, D, H), (0, D / 2, H / 2), material=M['logs'], uv=1.2)
    # Log ends poking out at the corners
    for x in (-W / 2, W / 2):
        for y in (0, D):
            for i in range(7):
                b.cyl((x, y - 0.25, 0.2 + i * 0.38), (x, y + 0.25, 0.2 + i * 0.38), 0.17, 0.17, M['wood'], seg=8)
    gable_roof(b, W, D, H, 1.6, 0.4, M['shingle'], gable_mat=M['logs'])
    b.box((1.0, 0.9, 4.6), (-W / 2 - 0.3, D * 0.5, 2.3), material=M['stone'], uv=1.0)
    f = Facade(b, (0, 0, 0), 0)
    f.door(M, 0.8, 1.0, 2.0, transom=False)
    f.window(M, -1.5, 1.0, 0.8, 0.9)
    ob = b.build()
    return ob, [(-W / 2 - 0.8, 0, W / 2, D, H + 1.6)], []


def water_tower(M):
    b = Builder('WaterTower')
    for x in (-1.3, 1.3):
        for y in (-1.3, 1.3):
            b.box((0.22, 0.22, 6.0), (x, y, 3.0), material=M['wood'])
    for z in (1.5, 3.5):
        b.box((2.9, 0.12, 0.12), (0, -1.3, z), material=M['wood'])
        b.box((2.9, 0.12, 0.12), (0, 1.3, z), material=M['wood'])
        b.box((0.12, 2.9, 0.12), (-1.3, 0, z), material=M['wood'])
        b.box((0.12, 2.9, 0.12), (1.3, 0, z), material=M['wood'])
    b.cyl((0, 0, 6.0), (0, 0, 9.0), 2.0, 2.0, M['planks'], seg=20, smooth=False, uv=1.5)
    for z in (6.4, 7.5, 8.6):
        b.cyl((0, 0, z - 0.05), (0, 0, z + 0.05), 2.03, 2.03, M['iron'], seg=20, smooth=False)
    b.cyl((0, 0, 9.0), (0, 0, 10.2), 2.2, 0.15, M['shingle'], seg=20, smooth=False, uv=1.5)
    ob = b.build()
    return ob, [(-1.5, -1.5, 1.5, 1.5, 9.0)], []


def tent(M):
    b = Builder('Tent')
    w, d, h = 2.6, 3.2, 2.1
    for k in (-1, 1):
        L = math.hypot(w / 2, h)
        ang = math.atan2(h, w / 2)
        b.box((L, d, 0.02), matrix=trs((k * w / 4, d / 2, h / 2), (0, k * ang, 0)), material=M['canvas'], uv=2.0)
    b.poly([(w / 2, d, 0), (-w / 2, d, 0), (0, d, h)], M['canvas'], uv=2.0)
    # Open front flaps tied back
    for k in (-1, 1):
        b.poly([(k * w / 2, 0, 0), (k * w * 0.2, 0, h * 0.62), (k * (w / 2 + 0.5), -0.5, 0)], M['canvas'], uv=2.0)
    b.cyl((0, -0.2, 0), (0, -0.2, h + 0.15), 0.035, 0.035, M['wood'], seg=6)
    b.cyl((0, d + 0.1, 0), (0, d + 0.1, h + 0.1), 0.035, 0.035, M['wood'], seg=6)
    b.cyl((0, -0.2, h + 0.02), (0, d + 0.1, h + 0.02), 0.03, 0.03, M['wood'], seg=6)
    b.box((1.0, 2.0, 0.12), (0.5, d / 2 + 0.2, 0.06), material=mat('BedrollRed', '#7a2a24', 0.9))
    ob = b.build()
    return ob, [(-w / 2, 0, w / 2, d, h)], []


def wheel(b, M, center, r, axis='X', spokes=10):
    c = Vector(center)
    ax = Vector((1, 0, 0))
    for i in range(16):
        a0 = 2 * math.pi * i / 16
        a1 = 2 * math.pi * (i + 1) / 16
        p0 = c + Vector((0, math.cos(a0) * r, math.sin(a0) * r))
        p1 = c + Vector((0, math.cos(a1) * r, math.sin(a1) * r))
        b.cyl(p0, p1, 0.04, 0.04, M['darkwood'], seg=5, smooth=False, ref=ax)
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        b.cyl(c, c + Vector((0, math.cos(a) * r, math.sin(a) * r)), 0.018, 0.018, M['wood'], seg=5)
    b.cyl(c - ax * 0.08, c + ax * 0.08, 0.07, 0.07, M['darkwood'], seg=8)


def wagon(M):
    b = Builder('Wagon')
    bw, bl, bz = 1.3, 3.4, 0.9
    b.box((bw, bl, 0.55), (0, 0, bz + 0.27), material=M['planks'], uv=1.5)
    b.box((bw + 0.06, bl + 0.06, 0.08), (0, 0, bz + 0.56), material=M['darkwood'])
    for y, r in ((-1.15, 0.5), (1.15, 0.65)):
        for x in (-0.82, 0.82):
            wheel(b, M, (x, y, r), r)
        b.cyl((-0.85, y, r), (0.85, y, r), 0.05, 0.05, M['darkwood'], seg=6)
    b.cyl((0, -1.7, 0.55), (0, -3.6, 0.35), 0.045, 0.045, M['darkwood'], seg=6)
    # Canvas bonnet over hoops
    path = [(0, -bl / 2 + 0.1, bz + 0.56), (0, bl / 2 - 0.1, bz + 0.56)]
    b.tube(path, [(bw / 2 + 0.08, 1.3), (bw / 2 + 0.08, 1.3)], M['canvas'], None, seg=12,
           arc=(0, math.pi), ref=Vector((0, 0, 1)))
    ob = b.build()
    return ob, [(-0.9, -1.8, 0.9, 1.8, 2.4)], []


def campfire(M):
    b = Builder('Campfire')
    for i in range(9):
        a = 2 * math.pi * i / 9
        b.ico(0.16, (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.06), (1, 0.8, 0.6), material=M['stone'], subdiv=1)
    for i in range(4):
        a = math.pi * i / 4 + 0.3
        d = Vector((math.cos(a), math.sin(a), 0)) * 0.45
        b.cyl(-d + Vector((0, 0, 0.08)), d + Vector((0, 0, 0.16)), 0.06, 0.05, M['darkwood'], seg=6)
    b.ico(0.22, (0, 0, 0.05), (1.2, 1.2, 0.35), material=M['ember'], subdiv=1)
    # Cooking tripod
    for i in range(3):
        a = 2 * math.pi * i / 3
        b.cyl((math.cos(a) * 0.7, math.sin(a) * 0.7, 0), (0, 0, 1.2), 0.025, 0.02, M['wood'], seg=5)
    b.cyl((0, 0, 1.2), (0, 0, 0.75), 0.006, 0.006, M['iron'], seg=4)
    b.cyl((0, 0, 0.6), (0, 0, 0.78), 0.14, 0.16, M['iron'], seg=10)
    ob = b.build()
    return ob, [], []


def small_props(M):
    out = {}
    b = Builder('Barrel')
    b.tube([(0, 0, 0), (0, 0, 0.45), (0, 0, 0.9)], [(0.3, 0.3), (0.35, 0.35), (0.3, 0.3)], M['planks'], None,
           seg=14, uv=0.8)
    for z in (0.12, 0.78):
        b.tube([(0, 0, z - 0.03), (0, 0, z + 0.03)], [(0.32, 0.32), (0.32, 0.32)], M['iron'], None, seg=14)
    out['Barrel'] = (b.build(), [(-0.35, -0.35, 0.35, 0.35, 0.9)], [])

    b = Builder('Crate')
    b.box((0.8, 0.8, 0.7), (0, 0, 0.35), material=M['planks'], uv=0.8)
    for z in (0.05, 0.65):
        b.box((0.84, 0.84, 0.08), (0, 0, z), material=M['darkwood'])
    out['Crate'] = (b.build(), [(-0.42, -0.42, 0.42, 0.42, 0.7)], [])

    b = Builder('HitchPost')
    for x in (-1.4, 1.4):
        b.box((0.14, 0.14, 1.1), (x, 0, 0.55), material=M['wood'])
    b.cyl((-1.55, 0, 1.0), (1.55, 0, 1.0), 0.06, 0.06, M['wood'], seg=6, ref=Vector((0, 0, 1)))
    b.box((2.4, 0.5, 0.4), (0, 0.7, 0.2), material=M['planks'], uv=1.0)
    b.box((2.3, 0.4, 0.05), (0, 0.7, 0.38), material=M['water'])
    out['HitchPost'] = (b.build(), [(-1.6, -0.15, 1.6, 0.95, 1.1)], [])

    b = Builder('Fence')
    for x in (-1.5, 1.5):
        b.box((0.14, 0.14, 1.3), (x, 0, 0.65), material=M['wood'])
    for z in (0.55, 1.05):
        b.cyl((-1.6, 0, z), (1.6, 0, z + 0.02), 0.05, 0.05, M['wood'], seg=5, ref=Vector((0, 0, 1)))
    out['Fence'] = (b.build(), [(-1.6, -0.12, 1.6, 0.12, 1.3)], [])

    b = Builder('HayBale')
    b.box((1.2, 0.6, 0.5), (0, 0, 0.25), material=M['hay'])
    out['HayBale'] = (b.build(), [(-0.6, -0.3, 0.6, 0.3, 0.5)], [])

    b = Builder('LogSeat')
    b.cyl((-1.1, 0, 0.22), (1.1, 0, 0.22), 0.22, 0.2, M['darkwood'], seg=10, ref=Vector((0, 0, 1)))
    out['LogSeat'] = (b.build(), [], [])

    b = Builder('WantedBoard')
    for x in (-0.8, 0.8):
        b.box((0.12, 0.12, 2.2), (x, 0, 1.1), material=M['wood'])
    b.box((1.8, 0.06, 1.0), (0, 0, 1.6), material=M['planks'], uv=1.0)
    paper = mat('Poster', '#d9ccaa', 0.9)
    for i, x in enumerate((-0.5, 0.0, 0.5)):
        b.box((0.36, 0.02, 0.48), (x, -0.04, 1.62 + (0.05 if i == 1 else 0)), material=paper)
    out['WantedBoard'] = (b.build(), [(-0.9, -0.1, 0.9, 0.1, 2.2)], [])

    b = Builder('Bridge')
    L, W = 30.0, 4.4
    b.box((W, L, 0.25), (0, 0, 2.6), material=M['planks'], uv=1.5)
    for x in (-W / 2 + 0.15, W / 2 - 0.15):
        b.box((0.3, L, 0.4), (x, 0, 2.3), material=M['darkwood'])
        for i in range(11):
            y = -L / 2 + 0.2 + i * (L - 0.4) / 10
            b.box((0.14, 0.14, 1.1), (x, y, 3.25), material=M['wood'])
            b.box((0.3, 0.3, 3.4), (x, y, 0.6), material=M['darkwood'])
        b.box((0.1, L, 0.12), (x, 0, 3.75), material=M['wood'])
        b.box((0.08, L, 0.08), (x, 0, 3.2), material=M['wood'])
    out['Bridge'] = (b.build(), [], [(-W / 2, -L / 2, W / 2, L / 2, 2.725)])
    return out


def build_all(T):
    M = materials(T)
    M['darkbrick'] = mat('DarkBrick', '#4e2a20', 0.9)
    out = {}
    out['Bank'] = brick_block(M, 'Bank', 11.0, 12.0, 8.4, 'BANK', floors=2)
    out['Store'] = brick_block(M, 'Store', 9.5, 11.0, 7.8, 'GENERAL STORE', floors=2, storefront=True, porch_roof=True)
    out['Sheriff'] = brick_block(M, 'Sheriff', 7.5, 9.0, 4.6, 'SHERIFF', floors=1, porch_roof=True, bars=True)
    out['Saloon'] = wood_block(M, 'Saloon', 12.0, 14.0, 7.4, 'SALOON')
    out['Hotel'] = wood_block(M, 'Hotel', 11.0, 12.0, 7.2, 'HOTEL', wall=M['white'])
    out['Gunsmith'] = wood_block(M, 'Gunsmith', 7.0, 9.0, 4.2, 'GUNSMITH')
    out['Barber'] = wood_block(M, 'Barber', 6.5, 8.0, 4.0, 'BARBER', wall=M['white'])
    out['Livery'] = wood_block(M, 'Livery', 10.0, 12.0, 4.8, 'LIVERY', wall=M['barn'])
    out['House'] = house(M, 'House')
    out['HouseWhite'] = house(M, 'HouseWhite', 6.5, 7.5, wall=M['white'])
    out['Farmhouse'] = farmhouse(M)
    out['Barn'] = barn(M)
    out['Cabin'] = cabin(M)
    out['WaterTower'] = water_tower(M)
    out['Tent'] = tent(M)
    out['Wagon'] = wagon(M)
    out['Campfire'] = campfire(M)
    out.update(small_props(M))
    return out
