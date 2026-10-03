# The cowboy: one rig shared by the player, outlaws and townsfolk. Clothing
# pieces are separate skinned objects so the game can show or hide them and
# recolour them per character.
import math
import bpy
from mathutils import Matrix, Vector

from common import (Builder, Animator, make_armature, attach_to_bone, mat, trs, clamp,
                    smoothstep)

FWD = (0, -1, 0)
UP = (0, 0, 1)
SIDES = (('L', 1), ('R', -1))   # character's left is +X

# Joint positions (metres). The arms hang in a slight A-pose.
J = {
    'hips': (0, 0, 0.98), 'spine': (0, 0, 1.12), 'chest': (0, 0, 1.28),
    'neck': (0, 0, 1.46), 'head': (0, -0.012, 1.565), 'head_end': (0, -0.012, 1.80),
}
for s, k in SIDES:
    J[f'shoulder.{s}'] = (k * 0.19, 0.005, 1.425)
    J[f'elbow.{s}'] = (k * 0.235, 0.015, 1.15)
    J[f'wrist.{s}'] = (k * 0.262, -0.01, 0.905)
    J[f'fingers.{s}'] = (k * 0.27, -0.025, 0.80)
    J[f'hip.{s}'] = (k * 0.095, 0, 0.95)
    J[f'knee.{s}'] = (k * 0.10, -0.01, 0.52)
    J[f'ankle.{s}'] = (k * 0.105, 0.02, 0.09)
    J[f'toe.{s}'] = (k * 0.11, -0.12, 0.025)


def skeleton():
    bones = [
        ('hips', J['hips'], J['spine'], None, FWD),
        ('spine', J['spine'], J['chest'], 'hips', FWD),
        ('chest', J['chest'], J['neck'], 'spine', FWD),
        ('neck', J['neck'], J['head'], 'chest', FWD),
        ('head', J['head'], J['head_end'], 'neck', FWD),
    ]
    for s, _ in SIDES:
        bones += [
            (f'upperarm.{s}', J[f'shoulder.{s}'], J[f'elbow.{s}'], 'chest', FWD),
            (f'forearm.{s}', J[f'elbow.{s}'], J[f'wrist.{s}'], f'upperarm.{s}', FWD),
            (f'hand.{s}', J[f'wrist.{s}'], J[f'fingers.{s}'], f'forearm.{s}', FWD),
            (f'thigh.{s}', J[f'hip.{s}'], J[f'knee.{s}'], 'hips', FWD),
            (f'shin.{s}', J[f'knee.{s}'], J[f'ankle.{s}'], f'thigh.{s}', FWD),
            (f'foot.{s}', J[f'ankle.{s}'], J[f'toe.{s}'], f'shin.{s}', UP),
        ]
    return bones


UPPER = ['spine', 'chest', 'neck', 'head'] + [f'{b}.{s}' for b in ('upperarm', 'forearm', 'hand') for s in 'LR']


# ---------------------------------------------------------------------------
# Materials. Names matter: the game recolours characters by material name.
# ---------------------------------------------------------------------------
def materials():
    return {
        'skin': mat('Skin', '#b9805e', 0.7),
        'hands': mat('Hands', '#b9805e', 0.7),
        'hair': mat('Hair', '#3a281c', 0.9),
        'eye': mat('Eye', '#15110e', 0.3),
        'shirt': mat('Shirt', '#5b7596', 0.9),
        'pants': mat('Pants', '#5a4a3a', 0.95),
        'boots': mat('Boots', '#2f2219', 0.6),
        'sole': mat('Sole', '#1a1310', 0.8),
        'leather': mat('Leather', '#4e3221', 0.65),
        'belt': mat('Belt', '#3a2618', 0.6),
        'brass': mat('Brass', '#b08a3c', 0.35, 0.9),
        'hat': mat('Hat', '#3d2c20', 0.85),
        'hatband': mat('HatBand', '#1d1611', 0.6),
        'mask': mat('Mask', '#2a2a2e', 0.95, double=True),
        'coat': mat('Coat', '#4a4f45', 0.95, double=True),
        'vest': mat('Vest', '#2c2724', 0.9, double=True),
        'strap': mat('Strap', '#3b2a1c', 0.7),
        'metal': mat('GunMetal', '#2b2c30', 0.35, 0.85),
        'steel': mat('Steel', '#6d6f75', 0.3, 0.9),
        'grip': mat('GunWood', '#5a3a22', 0.55),
        'stock': mat('RifleWood', '#6e4524', 0.5),
        'badge': mat('Badge', '#d8b44a', 0.3, 1.0),
        'canvas': mat('Bedroll', '#8d7b5c', 0.95),
    }


# Torso profile: (z, side radius, front radius, y offset)
TORSO = [
    (0.86, 0.150, 0.102, 0.008), (0.92, 0.156, 0.108, 0.004), (0.98, 0.158, 0.108, 0.0),
    (1.06, 0.150, 0.100, -0.002), (1.16, 0.148, 0.099, 0.0), (1.26, 0.160, 0.106, 0.0),
    (1.35, 0.176, 0.112, 0.0), (1.415, 0.182, 0.106, 0.004), (1.455, 0.150, 0.090, 0.008),
    (1.49, 0.072, 0.064, 0.006),
]


def torso_at(z):
    pts = TORSO
    if z <= pts[0][0]:
        return pts[0][1:]
    for a, b in zip(pts, pts[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    return pts[-1][1:]


def torso_weights(co):
    z = co.z
    if z < 1.06:
        return {'hips': 1}
    if z < 1.18:
        t = smoothstep(1.06, 1.18, z)
        return {'hips': 1 - t, 'spine': t}
    if z < 1.32:
        t = smoothstep(1.18, 1.32, z)
        return {'spine': 1 - t, 'chest': t}
    return {'chest': 1}


def torso_surface(x, z, side, grow=0.0):
    """Point on the torso surface at height z, offset x, front (side=-1) or back (+1)."""
    rx, ry, yo = torso_at(z)
    rx += grow
    ry += grow
    f = math.sqrt(max(0.0, 1 - (x / rx) ** 2))
    return Vector((x, yo + side * ry * f, z))


def torso_normal(p):
    rx, ry, yo = torso_at(p.z)
    return Vector((p.x / rx ** 2, (p.y - yo) / ry ** 2, 0)).normalized()


def torso_tube(b, z0, z1, grow, material, arc=None, seg=16):
    rings = [r for r in TORSO if z0 <= r[0] <= z1]
    if rings[0][0] > z0:
        rings.insert(0, (z0, *torso_at(z0)))
    if rings[-1][0] < z1:
        rings.append((z1, *torso_at(z1)))
    path = [(0, r[3], r[0]) for r in rings]
    radii = [(r[1] + grow, r[2] + grow) for r in rings]
    return b.tube(path, radii, material, torso_weights, seg=seg, arc=arc,
                  caps=(arc is None, arc is None))


# ---------------------------------------------------------------------------
# Body
# ---------------------------------------------------------------------------
def build_body(rig, col, M):
    b = Builder('Body')
    head = 'head'
    # Head and face
    b.ball((0.090, 0.103, 0.115), (0, -0.004, 1.672), material=M['skin'], bone=head, seg=18, rings=12)
    b.ball((0.074, 0.078, 0.055), (0, -0.034, 1.606), material=M['skin'], bone=head, seg=14, rings=8)
    b.cyl((0, -0.097, 1.692), (0, -0.121, 1.655), 0.017, 0.012, M['skin'], head, seg=8)
    for s, k in SIDES:
        b.ball((0.013, 0.024, 0.032), (k * 0.09, 0.004, 1.665), material=M['skin'], bone=head, seg=8, rings=6)
        b.ball(0.0115, (k * 0.034, -0.092, 1.697), material=M['eye'], bone=head, seg=8, rings=6)
        b.box((0.036, 0.012, 0.009), (k * 0.035, -0.101, 1.718), (0, k * 0.12, 0), M['hair'], head)
    b.ball((0.094, 0.098, 0.112), (0, 0.018, 1.68), material=M['hair'], bone=head, seg=16, rings=10)
    b.cyl((0, 0, 1.44), (0, -0.01, 1.6), 0.052, 0.05, M['skin'], 'neck', seg=12)

    # Torso: pants below the belt, shirt above
    torso_tube(b, 0.86, 0.99, 0.0, M['pants'])
    torso_tube(b, 0.97, 1.49, 0.0, M['shirt'])
    b.tube([(0, 0.006, 1.455), (0, 0.004, 1.505)], [(0.07, 0.066), (0.066, 0.062)], M['shirt'], 'chest', seg=14)
    # Belt and buckle
    b.tube([(0, 0.0, 0.958), (0, 0.0, 0.996)], [(0.162, 0.112), (0.161, 0.111)], M['belt'], 'hips', seg=18)
    b.box((0.05, 0.014, 0.04), (0, -0.115, 0.977), material=M['brass'], bone='hips')

    for s, k in SIDES:
        sh, el, wr, fi = (Vector(J[f'{n}.{s}']) for n in ('shoulder', 'elbow', 'wrist', 'fingers'))
        # Arms
        b.ball(0.056, sh + Vector((-k * 0.006, 0, -0.018)), material=M['shirt'], bone=f'upperarm.{s}', seg=12, rings=8)
        b.tube([sh, sh.lerp(el, 0.5), el], [(0.06, 0.06), (0.054, 0.056), (0.047, 0.049)], M['shirt'],
               f'upperarm.{s}', seg=12)
        b.ball(0.047, el, material=M['shirt'], bone=f'forearm.{s}', seg=10, rings=8)
        b.tube([el, el.lerp(wr, 0.6), wr], [(0.046, 0.048), (0.042, 0.044), (0.036, 0.038)], M['shirt'],
               f'forearm.{s}', seg=12)
        b.tube([wr.lerp(el, 0.12), wr.lerp(el, 0.02)], [(0.041, 0.043), (0.041, 0.043)], M['shirt'],
               f'forearm.{s}', seg=12)
        # Hand: palm, curled fingers, thumb
        hand = f'hand.{s}'
        d = (fi - wr).normalized()
        palm_mid = wr + d * 0.045
        b.tube([wr + d * 0.005, palm_mid, wr + d * 0.075], [(0.019, 0.034), (0.021, 0.042), (0.02, 0.04)],
               M['hands'], hand, seg=10)
        b.tube([wr + d * 0.07, wr + d * 0.1 + Vector((0, 0.012, 0)), wr + d * 0.112 + Vector((0, 0.035, 0))],
               [(0.019, 0.038), (0.018, 0.034), (0.016, 0.026)], M['hands'], hand, seg=10)
        b.cyl(wr + d * 0.03 + Vector((k * -0.006, -0.03, 0)), wr + d * 0.075 + Vector((k * -0.008, -0.045, 0)),
              0.012, 0.01, M['hands'], hand, seg=8)

        # Legs
        hp, kn, an, to = (Vector(J[f'{n}.{s}']) for n in ('hip', 'knee', 'ankle', 'toe'))
        b.tube([hp + Vector((0, 0, 0.05)), hp.lerp(kn, 0.45), kn], [(0.085, 0.088), (0.072, 0.075), (0.058, 0.06)],
               M['pants'], f'thigh.{s}', seg=12)
        b.ball(0.058, kn, material=M['pants'], bone=f'shin.{s}', seg=10, rings=8)
        boot_top = kn.lerp(an, 0.62)
        b.tube([kn, kn.lerp(an, 0.5), boot_top], [(0.055, 0.057), (0.05, 0.052), (0.048, 0.05)], M['pants'],
               f'shin.{s}', seg=12)
        # Boot shaft with a flared top
        b.tube([boot_top + Vector((0, 0, 0.03)), boot_top, an + Vector((0, 0, 0.02))],
               [(0.058, 0.062), (0.053, 0.056), (0.046, 0.05)], M['boots'], f'shin.{s}', seg=12,
               caps=(False, True))
        foot = f'foot.{s}'
        b.ball((0.048, 0.12, 0.052), (k * 0.107, -0.045, 0.052), (0.05, 0, 0), M['boots'], foot, seg=12, rings=8,
               deform=lambda c: Vector((c.x, c.y - 0.02 * clamp((-c.y - 0.08) / 0.08), max(c.z, 0.012))))
        b.box((0.058, 0.22, 0.014), (k * 0.107, -0.045, 0.007), material=M['sole'], bone=foot)
        b.box((0.048, 0.045, 0.03), (k * 0.106, 0.04, 0.018), material=M['sole'], bone=foot)
    return b.build(col, rig)


def build_hat(rig, col, M):
    b = Builder('Hat')
    cz = 1.758

    def brim(c):
        x = abs(c.x) / 0.205
        z = c.z + 0.055 * x ** 2.4 - 0.012 * (c.y / 0.23) ** 2
        return Vector((c.x, c.y, z))

    v = b.tube([(0, -0.01, cz - 0.004), (0, -0.01, cz + 0.004)], [(0.205, 0.228), (0.205, 0.228)], M['hat'],
               'head', seg=28)
    for vert in v:
        vert.co = brim(vert.co)

    def crown(c):
        if c.z > cz + 0.1:
            dent = 0.028 * (1 - min(1, abs(c.x) / 0.07))
            pinch = 0.012 * max(0, -c.y - 0.03) / 0.07
            return Vector((c.x * (1 - pinch * 3), c.y, c.z - dent))
        return c

    v = b.tube([(0, -0.008, cz), (0, -0.008, cz + 0.06), (0, -0.006, cz + 0.11), (0, -0.004, cz + 0.128)],
               [(0.094, 0.112), (0.09, 0.106), (0.084, 0.098), (0.06, 0.075)], M['hat'], 'head', seg=20)
    for vert in v:
        vert.co = crown(vert.co)
    b.tube([(0, -0.008, cz + 0.004), (0, -0.008, cz + 0.026)], [(0.097, 0.115), (0.096, 0.113)], M['hatband'],
           'head', seg=20)
    ob = b.build(col, rig)
    return ob


def build_mask(rig, col, M):
    b = Builder('Mask')
    b.tube([(0, 0.004, 1.52), (0, -0.004, 1.585), (0, -0.006, 1.645), (0, -0.002, 1.675)],
           [(0.07, 0.086), (0.083, 0.098), (0.094, 0.116), (0.094, 0.112)], M['mask'], 'head', seg=18,
           caps=(False, False))
    # The knot flap hanging over the chest
    b.poly([(-0.075, -0.098, 1.585), (0.075, -0.098, 1.585), (0.0, -0.118, 1.44)], M['mask'], 'head')
    b.poly([(-0.075, -0.098, 1.585), (0.0, -0.118, 1.44), (0.0, -0.13, 1.6)], M['mask'], 'head')
    b.poly([(0.075, -0.098, 1.585), (0.0, -0.13, 1.6), (0.0, -0.118, 1.44)], M['mask'], 'head')
    return b.build(col, rig, recalc=False)


def build_beard(rig, col, M):
    b = Builder('Beard')
    b.ball((0.08, 0.084, 0.064), (0, -0.033, 1.598), material=M['hair'], bone='head', seg=14, rings=8,
           deform=lambda c: Vector((c.x, c.y, min(c.z, 1.645 - 0.3 * abs(c.x)))))
    b.box((0.06, 0.012, 0.012), (0, -0.112, 1.638), material=M['hair'], bone='head')
    return b.build(col, rig)


def skirt_weights(co):
    t = clamp((0.95 - co.z) / 0.45)
    if abs(co.x) < 1e-4:
        return {'hips': 1}
    side = 'L' if co.x > 0 else 'R'
    front = clamp(0.5 - co.y / 0.25)    # 1 at the front, 0 at the back
    w = t * 0.75 * front
    return {'hips': 1 - w, f'thigh.{side}': w}


def build_coat(rig, col, M, name='Coat', long=True):
    b = Builder(name)
    m = M['coat']
    gap = 0.16
    torso_tube(b, 0.93, 1.47, 0.016, m, arc=(math.pi / 2 + gap, math.pi / 2 + 2 * math.pi - gap), seg=22)
    # Collar, turned up a little
    b.tube([(0, 0.006, 1.45), (0, 0.004, 1.53)], [(0.09, 0.08), (0.098, 0.088)], m, 'chest', seg=16,
           arc=(math.pi / 2 + 0.5, math.pi / 2 + 2 * math.pi - 0.5))
    if long:
        zs = [0.96, 0.8, 0.62, 0.42]
        rs = [(0.172, 0.124), (0.2, 0.15), (0.23, 0.18), (0.255, 0.205)]
    else:
        zs = [0.96, 0.86, 0.78]
        rs = [(0.172, 0.124), (0.182, 0.132), (0.19, 0.14)]
    b.tube([(0, 0.01, z) for z in zs], rs, m, skirt_weights, seg=22,
           arc=(math.pi / 2 + 0.2, math.pi / 2 + 2 * math.pi - 0.2))
    for s, k in SIDES:
        sh, el, wr = (Vector(J[f'{n}.{s}']) for n in ('shoulder', 'elbow', 'wrist'))
        b.ball(0.066, sh + Vector((-k * 0.004, 0, -0.016)), material=m, bone=f'upperarm.{s}', seg=12, rings=8)
        b.tube([sh, el], [(0.07, 0.07), (0.058, 0.06)], m, f'upperarm.{s}', seg=12)
        b.ball(0.058, el, material=m, bone=f'forearm.{s}', seg=10, rings=8)
        b.tube([el, wr.lerp(el, 0.1), wr.lerp(el, 0.02)], [(0.056, 0.058), (0.05, 0.052), (0.052, 0.054)], m,
               f'forearm.{s}', seg=12, caps=(True, False))
    return b.build(col, rig)


def build_vest(rig, col, M):
    b = Builder('Vest')
    torso_tube(b, 0.95, 1.45, 0.008, M['vest'], arc=(math.pi / 2 + 0.2, math.pi / 2 + 2 * math.pi - 0.2), seg=20)
    return b.build(col, rig)


def build_suspenders(rig, col, M):
    b = Builder('Suspenders')
    for s, k in SIDES:
        front = [torso_surface(k * 0.072, z, -1) for z in (0.99, 1.1, 1.2, 1.3, 1.38, 1.43)]
        top = [Vector((k * 0.085, 0.0, 1.472))]
        back = [torso_surface(k * (0.06 - 0.045 * (1.43 - z) / 0.44), z, +1) for z in (1.43, 1.38, 1.3, 1.2, 1.1, 0.99)]
        pts = front + top + back
        b.ribbon(pts, 0.026, torso_normal, M['strap'], torso_weights, thick=0.005)
        b.box((0.03, 0.012, 0.02), front[0] + Vector((0, -0.006, 0.01)), material=M['brass'], bone='hips')
    return b.build(col, rig, recalc=False)


def build_badge(rig, col, M):
    b = Builder('Badge')
    p = torso_surface(0.09, 1.32, -1) + Vector((0, -0.006, 0))
    b.cyl(p + Vector((0, 0.004, 0)), p + Vector((0, -0.004, 0)), 0.028, 0.028, M['badge'], 'chest', seg=5)
    return b.build(col, rig)


def build_satchel(rig, col, M):
    b = Builder('Satchel')
    # Strap from the right shoulder across the chest to the left hip, and back round
    pts = []
    for i in range(9):
        t = i / 8
        z = 1.44 - t * 0.46
        x = -0.11 + t * 0.27
        pts.append(torso_surface(x, z, -1, 0.008))
    back = []
    for i in range(9):
        t = i / 8
        z = 1.44 - t * 0.46
        x = -0.11 + t * 0.27
        back.append(torso_surface(x, z, +1, 0.008))
    back.reverse()
    pts = back + [Vector((-0.12, 0.0, 1.475))] + pts
    b.ribbon(pts, 0.03, torso_normal, M['strap'], torso_weights, thick=0.006)
    b.box((0.06, 0.2, 0.17), (0.19, 0.0, 0.88), (0, 0, 0), M['leather'], 'hips', smooth=False)
    b.box((0.065, 0.205, 0.07), (0.19, 0.0, 0.94), (0, 0, 0), M['leather'], 'hips')
    b.box((0.014, 0.03, 0.02), (0.224, 0.0, 0.92), material=M['brass'], bone='hips')
    return b.build(col, rig, recalc=False)


def build_gunbelt(rig, col, M):
    b = Builder('GunBelt')
    v = b.tube([(0, 0.0, 0.9), (0, 0.0, 0.94)], [(0.175, 0.124), (0.174, 0.123)], M['leather'], 'hips', seg=20)
    tilt = Matrix.Rotation(-0.12, 4, 'Y')
    for vert in v:
        vert.co = tilt @ (vert.co - Vector((0, 0, 0.92))) + Vector((0, 0, 0.92))
    # Bullet loops along the front-left
    for i in range(8):
        a = math.radians(200 + i * 9)
        p = Vector((0.176 * math.cos(a) * -1, 0.125 * math.sin(a), 0.925 - 0.01 * i * 0.2))
        b.cyl(p + Vector((0, 0, -0.016)), p + Vector((0, 0, 0.022)), 0.0055, 0.0045, M['brass'], 'hips', seg=6)
    # Holster on the right hip
    b.cyl((-0.185, 0.01, 0.9), (-0.19, 0.03, 0.72), 0.034, 0.026, M['leather'], 'hips', seg=10, squash=0.6,
          ref=Vector((1, 0, 0)), smooth=False)
    return b.build(col, rig)


def revolver_parts(b, M, bone, m):
    """A single-action revolver in gun space (barrel along -Y, grip down -Z), placed by matrix m."""
    def P(x, y, z):
        return m @ Vector((x, y, z))

    def cyl(p0, p1, r0, r1, mm, seg=10):
        b.cyl(P(*p0), P(*p1), r0, r1, mm, bone, seg=seg)

    cyl((0, -0.035, 0.032), (0, -0.2, 0.032), 0.0085, 0.0085, M['metal'])
    cyl((0, -0.04, 0.018), (0, -0.17, 0.018), 0.0048, 0.0048, M['metal'], 8)
    cyl((0, 0.008, 0.026), (0, -0.04, 0.026), 0.021, 0.021, M['steel'], 12)
    cyl((0, -0.192, 0.042), (0, -0.2, 0.042), 0.002, 0.002, M['metal'], 4)
    for (sx, sy, sz), (lx, ly, lz) in (((0.016, 0.06, 0.05), (0, 0.0, 0.027)), ((0.012, 0.04, 0.012), (0, 0.035, 0.05)),
                                       ((0.006, 0.02, 0.022), (0, 0.048, 0.064)), ((0.004, 0.012, 0.03), (0, 0.012, -0.008))):
        mm = m @ trs((lx, ly, lz), (0, 0, 0), (sx, sy, sz))
        b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)
    # Trigger guard
    for i in range(5):
        a = math.pi * i / 4
        p = (0, 0.012 - 0.022 * math.cos(a), -0.002 - 0.022 * math.sin(a))
        mm = m @ trs(p, (0, 0, 0), (0.004, 0.008, 0.004))
        b.box((1, 1, 1), matrix=mm, material=M['brass'], bone=bone)
    # Grip
    b.cyl(P(0, 0.035, 0.012), P(0, 0.066, -0.075), 0.015, 0.017, M['grip'], bone, seg=10,
          ref=m.to_3x3() @ Vector((0, 1, 0)), squash=1.5)


def rifle_parts(b, M, bone, m):
    """Lever-action carbine, gun space like the revolver (wrist of the stock at the origin)."""
    def P(x, y, z):
        return m @ Vector((x, y, z))

    up = m.to_3x3() @ Vector((0, 0, 1))
    b.cyl(P(0, -0.12, 0.03), P(0, -0.68, 0.03), 0.009, 0.0085, M['metal'], bone, seg=8)
    b.cyl(P(0, -0.12, 0.014), P(0, -0.62, 0.014), 0.0075, 0.0075, M['metal'], bone, seg=8)
    b.cyl(P(0, -0.12, 0.018), P(0, -0.42, 0.018), 0.017, 0.015, M['stock'], bone, seg=8, ref=up, squash=1.2)
    mm = m @ trs((0, -0.06, 0.02), (0, 0, 0), (0.026, 0.13, 0.05))
    b.box((1, 1, 1), matrix=mm, material=M['brass'], bone=bone)
    # Stock: wrist then butt, dropping down and back
    b.cyl(P(0, 0.0, 0.012), P(0, 0.12, -0.01), 0.016, 0.018, M['stock'], bone, seg=8, ref=up, squash=1.3)
    b.cyl(P(0, 0.11, -0.005), P(0, 0.36, -0.03), 0.022, 0.03, M['stock'], bone, seg=8, ref=up, squash=1.7)
    mm = m @ trs((0, 0.362, -0.03), (0.05, 0, 0), (0.03, 0.012, 0.11))
    b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)
    # Lever loop
    for i in range(6):
        a = math.pi * i / 5
        p = (0, -0.02 + 0.03 * math.cos(a), -0.02 - 0.028 * math.sin(a))
        mm = m @ trs(p, (0, 0, 0), (0.006, 0.01, 0.006))
        b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)
    mm = m @ trs((0, -0.67, 0.042), (0, 0, 0), (0.003, 0.006, 0.006))
    b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)


def bone_matrix(rig, name):
    return rig.matrix_world @ rig.data.bones[name].matrix_local


# In hand space (bone Y toward the fingers, Z toward the thumb side): barrel
# along +Y, gun "up" toward the thumb. R maps gun space onto that.
GUN_IN_HAND = Matrix.Rotation(math.pi, 4, 'Z')


def build_weapons(rig, col, M):
    hand = bone_matrix(rig, 'hand.R')
    out = []
    # Revolver in hand: a static mesh parented to the hand bone
    b = Builder('Revolver')
    revolver_parts(b, M, None, Matrix())
    ob = b.build(col)
    attach_to_bone(ob, rig, 'hand.R', hand @ Matrix.Translation((0.004, 0.105, 0.012)) @ GUN_IN_HAND)
    out.append(ob)

    b = Builder('RifleHand')
    rifle_parts(b, M, None, Matrix())
    ob = b.build(col)
    attach_to_bone(ob, rig, 'hand.R', hand @ Matrix.Translation((0.004, 0.06, 0.0)) @ GUN_IN_HAND)
    out.append(ob)

    # Holstered revolver: grip sticking up out of the holster, skinned to the hips
    b = Builder('HolsterGun')
    m = Matrix.Translation((-0.188, 0.02, 0.905)) @ Matrix.Rotation(math.radians(78), 4, 'X')
    revolver_parts(b, M, 'hips', m)
    out.append(b.build(col, rig))

    # Rifle slung across the back
    b = Builder('RifleBack')
    p0, p1 = Vector((0.12, 0.15, 0.95)), Vector((-0.05, 0.16, 1.62))
    d = (p1 - p0).normalized()
    side = Vector((0, 1, 0)).cross(d).normalized()
    m = Matrix((side, -d, Vector((0, 1, 0)))).transposed().to_4x4()
    m.translation = p0
    rifle_parts(b, M, 'chest', m)
    # Sling: up the back, over the left shoulder, across the chest to the right hip
    sling = [Vector((0.13, 0.13, 0.95)), Vector((0.12, 0.122, 1.2)), Vector((0.11, 0.085, 1.42)),
             Vector((0.11, 0.0, 1.475)), torso_surface(0.09, 1.38, -1, 0.012), torso_surface(0.0, 1.2, -1, 0.012),
             torso_surface(-0.13, 1.0, -1, 0.012)]
    b.ribbon(sling, 0.024, lambda p: torso_normal(p) if p.z < 1.45 else Vector((0, 0, 1)), M['strap'],
             torso_weights, thick=0.008)
    out.append(b.build(col, rig, recalc=False))
    return out


# ---------------------------------------------------------------------------
# Animation
# ---------------------------------------------------------------------------
def R(P, name, x=0.0, y=0.0, z=0.0):
    e = P[name].rotation_euler
    e.x += x
    e.y += y
    e.z += z


def L(P, name, x=0.0, y=0.0, z=0.0):
    loc = P[name].location
    loc.x += x
    loc.y += y
    loc.z += z


def point_bone(rig, name, direction, toward=Vector((0, -1, 0))):
    """Pose bone `name` so it points along `direction` (armature space), its Z
    axis turned toward `toward`."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[name]
    y = Vector(direction).normalized()
    z = Vector(toward)
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = pb.head.copy()
    pb.matrix = m
    pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def reach(rig, side, target, pole, hand_dir=None, hand_up=Vector((0, -1, 0))):
    """Two-bone IK for an arm: put the wrist at `target` with the elbow toward `pole`."""
    bpy.context.view_layer.update()
    ua = rig.pose.bones[f'upperarm.{side}']
    s = ua.head.copy()
    l1 = (Vector(J[f'elbow.{side}']) - Vector(J[f'shoulder.{side}'])).length
    l2 = (Vector(J[f'wrist.{side}']) - Vector(J[f'elbow.{side}'])).length
    t = Vector(target)
    d = t - s
    dist = min(d.length, l1 + l2 - 1e-3)
    dn = d.normalized()
    a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    a = math.acos(max(-1, min(1, a)))
    pole_dir = (Vector(pole) - dn * Vector(pole).dot(dn)).normalized()
    elbow = s + (dn * math.cos(a) + pole_dir * math.sin(a)) * l1
    point_bone(rig, f'upperarm.{side}', elbow - s)
    wrist = s + dn * dist
    point_bone(rig, f'forearm.{side}', wrist - elbow, Vector((0, -1, 0)))
    if hand_dir is not None:
        point_bone(rig, f'hand.{side}', hand_dir, hand_up)


def animate(rig):
    A = Animator(rig)
    tau = 2 * math.pi

    def idle(P, t, f):
        b = math.sin(tau * t)
        R(P, 'spine', x=0.02 + 0.012 * b)
        R(P, 'chest', x=0.015 * b)
        R(P, 'head', x=-0.02 * b, y=0.06 * math.sin(tau * t + 1))
        L(P, 'hips', y=-0.004 + 0.003 * b)
        R(P, 'hips', z=0.02 * math.sin(tau * t))
        for s, k in SIDES:
            R(P, f'upperarm.{s}', x=0.03 * b, z=k * 0.05)
            R(P, f'forearm.{s}', x=0.18 + 0.03 * b)
            R(P, f'hand.{s}', x=0.1)
            R(P, f'thigh.{s}', z=k * 0.03, x=0.02)
            R(P, f'shin.{s}', x=-0.04)
            R(P, f'foot.{s}', x=0.02)
    A.clip('idle', 90, idle)

    def gait(P, t, run):
        ph = tau * t
        for s, k in SIDES:
            p = ph + (0 if s == 'L' else math.pi)
            sw = math.sin(p)
            if run:
                R(P, f'thigh.{s}', x=-0.12 + 0.9 * sw + 0.25)
                R(P, f'shin.{s}', x=-(0.25 + 1.55 * max(0, math.cos(p - 0.6)) ** 1.6))
                R(P, f'foot.{s}', x=0.25 * sw - 0.1)
                R(P, f'upperarm.{s}', x=-0.75 * sw + 0.1, z=k * 0.12)
                R(P, f'forearm.{s}', x=1.25 + 0.2 * sw)
                R(P, f'hand.{s}', x=0.2)
            else:
                R(P, f'thigh.{s}', x=0.42 * sw + 0.04)
                R(P, f'shin.{s}', x=-(0.08 + 0.8 * max(0, math.cos(p - 0.5)) ** 2))
                R(P, f'foot.{s}', x=0.2 * sw - 0.05 * max(0, -sw))
                R(P, f'upperarm.{s}', x=-0.38 * sw, z=k * 0.07)
                R(P, f'forearm.{s}', x=0.25 + 0.2 * max(0, -sw))
                R(P, f'hand.{s}', x=0.1)
        twist = math.sin(ph)
        if run:
            L(P, 'hips', y=-0.05 + 0.045 * math.cos(2 * ph))
            R(P, 'hips', y=-0.14 * twist, x=0.12)
            R(P, 'spine', x=0.1, y=0.08 * twist)
            R(P, 'chest', x=0.06, y=0.12 * twist)
            R(P, 'neck', x=-0.12)
            R(P, 'head', x=-0.1, y=-0.05 * twist)
        else:
            L(P, 'hips', y=-0.01 + 0.022 * math.cos(2 * ph))
            R(P, 'hips', y=-0.1 * twist, z=0.03 * math.sin(ph))
            R(P, 'spine', x=0.03, y=0.05 * twist)
            R(P, 'chest', y=0.08 * twist)
            R(P, 'head', y=-0.04 * twist, x=-0.02)
    A.clip('walk', 32, lambda P, t, f: gait(P, t, False))
    A.clip('run', 20, lambda P, t, f: gait(P, t, True))

    # Aim poses only key the upper body, so the game can lay them over walking.
    def aim_pistol(P, t, f):
        R(P, 'spine', y=0.08)
        R(P, 'chest', y=0.12, x=0.02)
        R(P, 'neck', y=-0.1)
        R(P, 'head', y=-0.08, x=-0.03)
        reach(rig, 'R', Vector((-0.07, -0.58, 1.42)), Vector((-1, 0.3, -0.6)), Vector((0.08, -1, 0.0)),
              Vector((0, 0, 1)))
        reach(rig, 'L', Vector((0.2, -0.12, 1.0)), Vector((1, 0.4, 0)), Vector((0, -0.3, -1)))
    A.clip('aim_pistol', 2, aim_pistol, bones=UPPER, step=1)

    def aim_rifle(P, t, f):
        R(P, 'spine', y=-0.25)
        R(P, 'chest', y=-0.3, x=0.04)
        R(P, 'neck', y=0.28)
        R(P, 'head', y=0.25, z=0.12, x=0.04)
        reach(rig, 'R', Vector((-0.11, -0.3, 1.38)), Vector((-1, 0.4, -0.25)), Vector((0.06, -1, -0.02)),
              Vector((0, 0, 1)))
        reach(rig, 'L', Vector((-0.1, -0.56, 1.37)), Vector((1, 0, -1)), Vector((-0.05, -1, 0)),
              Vector((-1, 0, 0.3)))
    A.clip('aim_rifle', 2, aim_rifle, bones=UPPER, step=1)

    def ride(P, t, f):
        b = math.sin(tau * t)
        R(P, 'hips', x=-0.05)
        R(P, 'spine', x=0.1 + 0.02 * b)
        R(P, 'chest', x=0.05)
        R(P, 'head', x=-0.12)
        for s, k in SIDES:
            R(P, f'thigh.{s}', x=1.25, z=k * 0.5)
            R(P, f'shin.{s}', x=-1.15, z=-k * 0.1)
            R(P, f'foot.{s}', x=0.1)
        bpy.context.view_layer.update()
        for s, k in SIDES:
            reach(rig, s, Vector((k * 0.07, -0.42, 1.14 + 0.01 * b)), Vector((k, 0.6, -0.4)),
                  Vector((-k * 0.2, -0.6, -0.6)), Vector((-k * 0.4, -0.5, 0.5)))
    A.clip('ride', 40, ride, step=2)

    def die(P, t, f):
        a = smoothstep(0.0, 0.35, t)
        b = smoothstep(0.25, 0.8, t)
        c = math.sin(math.pi * smoothstep(0.78, 1.0, t)) * 0.05
        L(P, 'hips', y=-0.3 * a - 0.55 * b + c, z=-0.15 * a - 0.35 * b)
        R(P, 'hips', x=-1.45 * b, z=0.15 * b)
        R(P, 'spine', x=0.25 * a - 0.15 * b)
        R(P, 'chest', x=0.2 * a - 0.2 * b)
        R(P, 'head', x=0.4 * a - 0.5 * b, y=0.4 * b)
        for s, k in SIDES:
            R(P, f'thigh.{s}', x=0.7 * a - 0.2 * b + (0.15 if s == 'L' else 0) * b, z=k * 0.15 * b)
            R(P, f'shin.{s}', x=-1.1 * a + 0.7 * b - (0.4 if s == 'L' else 0) * b)
            R(P, f'upperarm.{s}', x=0.5 * a - 0.2 * b, z=k * (0.25 * a + 1.0 * b))
            R(P, f'forearm.{s}', x=0.6 * a - 0.3 * b)
    A.clip('die', 40, die)

    def kneel(P, t, f):
        b = math.sin(tau * t)
        L(P, 'hips', y=-0.47, z=0.05)
        R(P, 'hips', x=0.05)
        R(P, 'thigh.L', x=1.45, z=0.12)
        R(P, 'shin.L', x=-1.55)
        R(P, 'foot.L', x=0.1)
        R(P, 'thigh.R', x=0.12, z=-0.1)
        R(P, 'shin.R', x=-1.95)
        R(P, 'foot.R', x=-0.6)
        R(P, 'spine', x=0.3)
        R(P, 'chest', x=0.2)
        R(P, 'head', x=0.2)
        for s, k in SIDES:
            R(P, f'upperarm.{s}', x=0.9 + 0.08 * b * k, z=k * 0.1)
            R(P, f'forearm.{s}', x=0.5 - 0.1 * b * k)
    A.clip('kneel', 40, kneel)

    def handsup(P, t, f):
        b = math.sin(tau * t)
        R(P, 'spine', x=-0.04 + 0.02 * b)
        R(P, 'head', x=0.08)
        for s, k in SIDES:
            R(P, f'upperarm.{s}', z=k * (2.3 + 0.05 * b), x=0.25)
            R(P, f'forearm.{s}', x=1.5)
            R(P, f'thigh.{s}', z=k * 0.05)
    A.clip('handsup', 40, handsup)


def build_cowboy(col):
    M = materials()
    rig = make_armature('Cowboy', skeleton(), col, mode='ZXY')
    objs = [rig, build_body(rig, col, M), build_hat(rig, col, M), build_mask(rig, col, M),
            build_beard(rig, col, M), build_coat(rig, col, M, 'Coat', True),
            build_coat(rig, col, M, 'Jacket', False), build_vest(rig, col, M),
            build_suspenders(rig, col, M), build_satchel(rig, col, M), build_gunbelt(rig, col, M),
            build_badge(rig, col, M)]
    objs += build_weapons(rig, col, M)
    animate(rig)
    return rig, objs
