# Four-legged animals: the horse (with saddle and tack) and a deer for hunting.
# Both come from one parametric builder so they share a bone layout and gaits.
import math
from mathutils import Matrix, Vector

from common import Builder, Animator, make_armature, attach_to_bone, mat, trs, clamp, smoothstep

FWD = (0, -1, 0)
UP = (0, 0, 1)
SIDES = (('L', 1), ('R', -1))

HORSE = dict(
    name='Horse', s=1.0, body_z=1.28, body_len=0.82, body_r=(0.28, 0.36), neck_len=1.0,
    head_len=0.58, head_r=(0.075, 0.12), leg_r=1.0, ears=0.1, tail_len=0.95, antlers=False,
    shoulder_z=1.18, hip_z=1.3,
)
DEER = dict(
    name='Deer', s=0.62, body_z=1.33, body_len=0.78, body_r=(0.24, 0.31), neck_len=0.95,
    head_len=0.5, head_r=(0.075, 0.095), leg_r=0.62, ears=0.2, tail_len=0.25, antlers=True,
    shoulder_z=1.18, hip_z=1.3,
)


def joints(P):
    s = P['s']
    j = {}
    bz = P['body_z'] * s
    bl = P['body_len'] * s
    j['body'] = (Vector((0, 0.25 * s, bz)), Vector((0, -0.35 * s, bz)))
    neck0 = Vector((0, -bl * 0.85, bz + 0.12 * s))
    neck1 = neck0 + Vector((0, -0.42, 0.62)).normalized() * P['neck_len'] * 0.72 * s
    head1 = neck1 + Vector((0, -0.62, -0.62)).normalized() * P['head_len'] * s
    j['neck'] = (neck0, neck1)
    j['head'] = (neck1, head1)
    t0 = Vector((0, bl * 1.0, bz + 0.18 * s))
    j['tail1'] = (t0, t0 + Vector((0, 0.2, -0.35)) * s * P['tail_len'])
    j['tail2'] = (j['tail1'][1], j['tail1'][1] + Vector((0, 0.06, -0.55)) * s * P['tail_len'])
    for side, k in SIDES:
        x = k * 0.17 * s
        fy = -bl * 0.74
        a = Vector((x, fy, P['shoulder_z'] * s))
        b = Vector((x, fy + 0.04 * s, 0.9 * s))
        c = Vector((x * 0.95, fy, 0.52 * s))
        d = Vector((x * 0.95, fy - 0.01 * s, 0.17 * s))
        e = Vector((x * 0.95, fy - 0.06 * s, 0.0))
        j[f'fl_upper.{side}'] = (a, b)
        j[f'fl_fore.{side}'] = (b, c)
        j[f'fl_cannon.{side}'] = (c, d)
        j[f'fl_hoof.{side}'] = (d, e)
        hy = bl * 0.78
        a = Vector((x * 1.05, hy, P['hip_z'] * s))
        b = Vector((x * 1.05, hy - 0.16 * s, 0.92 * s))
        c = Vector((x * 0.95, hy + 0.12 * s, 0.54 * s))
        d = Vector((x * 0.95, hy + 0.08 * s, 0.17 * s))
        e = Vector((x * 0.95, hy + 0.03 * s, 0.0))
        j[f'hl_thigh.{side}'] = (a, b)
        j[f'hl_gaskin.{side}'] = (b, c)
        j[f'hl_cannon.{side}'] = (c, d)
        j[f'hl_hoof.{side}'] = (d, e)
    return j


def skeleton(P):
    j = joints(P)
    bones = [
        ('body', *j['body'], None, UP),
        ('neck', *j['neck'], 'body', UP),
        ('head', *j['head'], 'neck', UP),
        ('tail1', *j['tail1'], 'body', UP),
        ('tail2', *j['tail2'], 'tail1', UP),
    ]
    for s, _ in SIDES:
        bones += [
            (f'fl_upper.{s}', *j[f'fl_upper.{s}'], 'body', FWD),
            (f'fl_fore.{s}', *j[f'fl_fore.{s}'], f'fl_upper.{s}', FWD),
            (f'fl_cannon.{s}', *j[f'fl_cannon.{s}'], f'fl_fore.{s}', FWD),
            (f'fl_hoof.{s}', *j[f'fl_hoof.{s}'], f'fl_cannon.{s}', FWD),
            (f'hl_thigh.{s}', *j[f'hl_thigh.{s}'], 'body', FWD),
            (f'hl_gaskin.{s}', *j[f'hl_gaskin.{s}'], f'hl_thigh.{s}', FWD),
            (f'hl_cannon.{s}', *j[f'hl_cannon.{s}'], f'hl_gaskin.{s}', FWD),
            (f'hl_hoof.{s}', *j[f'hl_hoof.{s}'], f'hl_cannon.{s}', FWD),
        ]
    return bones, j


def build_body(P, rig, col, M, j):
    s = P['s']
    b = Builder(P['name'] + 'Body')
    coat, dark, sock, hoof = M['coat'], M['dark'], M['sock'], M['hoof']
    bz = P['body_z'] * s
    bl = P['body_len'] * s
    rx, rz = P['body_r'][0] * s, P['body_r'][1] * s

    def body_w(co):
        # Blend the chest into the neck and the rump into the hind legs a little
        w = {'body': 1.0}
        if co.y < -bl * 0.8 and co.z > bz:
            w['neck'] = clamp((-bl * 0.8 - co.y) / (0.15 * s)) * 0.6
        return w

    # Barrel: rings from tail root to breast
    prof = [(1.06, 0.2, 0.25, 0.13), (1.0, 0.55, 0.66, 0.08), (0.82, 0.92, 0.94, 0.03), (0.45, 1.0, 1.0, 0.0),
            (0.0, 1.0, 1.0, -0.03), (-0.45, 0.98, 1.0, -0.01), (-0.75, 0.9, 0.97, 0.02), (-0.95, 0.68, 0.82, 0.06),
            (-1.06, 0.36, 0.5, 0.1)]
    path = [(0, bl * y, bz + dz * s) for y, _, _, dz in prof]
    radii = [(rx * a, rz * c) for _, a, c, _ in prof]
    v = b.tube(path, radii, coat, body_w, seg=18, ref=Vector((0, 0, 1)))
    # Flatten the back a little and drop the belly line toward the chest
    for vert in v:
        if vert.co.z > bz + rz * 0.75:
            vert.co.z = bz + rz * 0.75 + (vert.co.z - bz - rz * 0.75) * 0.5

    # Muscle masses over the shoulders and hindquarters, bound half to the legs
    for side, k in SIDES:
        sh = j[f'fl_upper.{side}'][0]
        b.ball((0.11 * s * P['leg_r'] + 0.03 * s, 0.2 * s, 0.3 * s), sh + Vector((0, -0.02 * s, 0.02 * s)),
               (0.25, 0, 0), coat, {'body': 0.5, f'fl_upper.{side}': 0.5}, seg=12, rings=8)
        hp = j[f'hl_thigh.{side}'][0]
        b.ball((0.14 * s * P['leg_r'] + 0.03 * s, 0.27 * s, 0.33 * s), hp + Vector((0, 0.0, -0.06 * s)),
               (-0.2, 0, 0), coat, {'body': 0.55, f'hl_thigh.{side}': 0.45}, seg=12, rings=8)

    # Neck
    n0, n1 = j['neck']
    b.tube([n0 + Vector((0, 0.12 * s, -0.12 * s)), n0.lerp(n1, 0.45), n1 + Vector((0, 0.04 * s, 0.02 * s))],
           [(rx * 0.55, rz * 0.68), (rx * 0.42, rz * 0.48), (rx * 0.32, rz * 0.36)], coat,
           lambda co: {'neck': clamp((co.z - bz) / (0.25 * s) + 0.2), 'body': 1 - clamp((co.z - bz) / (0.25 * s) + 0.2)},
           seg=14, ref=Vector((0, -1, 0)))

    # Head
    h0, h1 = j['head']
    hr = P['head_r']
    b.tube([h0 + (h0 - h1).normalized() * 0.06 * s, h0.lerp(h1, 0.4), h1.lerp(h0, 0.08), h1],
           [(hr[0] * 1.15 * s, hr[1] * 1.0 * s), (hr[0] * 1.05 * s, hr[1] * 0.85 * s), (hr[0] * 0.85 * s, hr[1] * 0.6 * s),
            (hr[0] * 0.7 * s, hr[1] * 0.42 * s)], coat, 'head', seg=12, ref=Vector((0, -1, 0)))
    b.ball((hr[0] * 0.75 * s, hr[1] * 0.55 * s, hr[1] * 0.5 * s), h1 + Vector((0, 0.0, -0.01 * s)),
           (0, 0, 0), M['muzzle'], 'head', seg=10, rings=7)
    b.ball((hr[0] * 0.8 * s, 0.12 * s, 0.07 * s), h0.lerp(h1, 0.35) + Vector((0, 0.06 * s, -0.08 * s)),
           (0.6, 0, 0), coat, 'head', seg=10, rings=6)
    d = (h1 - h0).normalized()
    for side, k in SIDES:
        eye = h0.lerp(h1, 0.22) + Vector((k * hr[0] * 1.0 * s, 0.0, 0.025 * s))
        b.ball(0.022 * s / max(s, 0.7), eye, material=M['eye'], bone='head', seg=8, rings=6)
        ear0 = h0 + Vector((k * 0.045 * s, 0.03 * s, 0.05 * s))
        ear1 = ear0 + Vector((k * 0.03, 0.02, 1.0)).normalized() * (P['ears'] * (1.4 if s < 1 else 1.0)) * s
        b.cyl(ear0, ear1, 0.03 * s * (1.4 if s < 1 else 1), 0.004, coat, 'head', seg=6, squash=0.5,
              ref=Vector((0, -1, 0)))
        nos = h1 + d * -0.01 * s + Vector((k * 0.03 * s, -0.01 * s, 0.02 * s))
        b.ball(0.012 * s, nos, material=M['eye'], bone='head', seg=6, rings=4)
    if P['name'] == 'Horse':
        # White blaze down the face
        blaze0 = h0.lerp(h1, 0.15) + Vector((0, -0.05, 0.075))
        blaze1 = h0.lerp(h1, 0.92) + Vector((0, -0.04, 0.035))
        b.cyl(blaze0, blaze1, 0.032, 0.024, sock, 'head', seg=8, squash=0.35, ref=Vector((0, 0, 1)))
        # Mane along the top of the neck, and a forelock
        p0, p2 = n0 + Vector((0, 0.12 * s, -0.12 * s)), n1 + Vector((0, 0.04 * s, 0.02 * s))
        nd = (p2 - p0).normalized()
        back = Vector((0, 1, 0)) - nd * nd.y
        back.normalize()
        crest = []
        for i in range(8):
            t = 0.1 + 0.92 * i / 7
            rb = (rz * 0.68) * (1 - t) + (rz * 0.36) * t
            crest.append(p0.lerp(p2, t) + back * (rb * 0.86))
        b.tube(crest, [(0.035, 0.07)] * 6 + [(0.03, 0.06), (0.02, 0.04)], M['mane'],
               lambda co: {'neck': clamp((co.z - bz) / (0.3 * s) + 0.1), 'body': 1 - clamp((co.z - bz) / (0.3 * s) + 0.1)},
               seg=8, ref=back)
        b.box((0.06, 0.04, 0.16), h0 + Vector((0, -0.07, 0.02)), (0.6, 0, 0), M['mane'], 'head')
    if P['antlers']:
        for side, k in SIDES:
            base = h0 + Vector((k * 0.03, -0.02, 0.06))
            tip = base + Vector((k * 0.12, 0.06, 0.2))
            b.cyl(base, tip, 0.012, 0.007, M['antler'], 'head', seg=6)
            for t, off in ((0.45, Vector((k * 0.02, -0.08, 0.1))), (0.85, Vector((k * 0.06, -0.05, 0.1)))):
                p = base.lerp(tip, t)
                b.cyl(p, p + off, 0.008, 0.004, M['antler'], 'head', seg=5)
            p2 = tip + Vector((-k * 0.04, -0.03, 0.12))
            b.cyl(tip, p2, 0.007, 0.004, M['antler'], 'head', seg=5)

    # Tail
    t0, t1 = j['tail1']
    _, t2 = j['tail2']
    if P['name'] == 'Horse':
        b.tube([t0, t1, t2 + Vector((0, 0.03, 0))], [(0.05, 0.06), (0.09, 0.07), (0.05, 0.035)], M['mane'],
               lambda co: {'tail1': 1 - clamp((t0.z - co.z) / (t0.z - t2.z) * 1.6 - 0.3),
                           'tail2': clamp((t0.z - co.z) / (t0.z - t2.z) * 1.6 - 0.3)},
               seg=10, ref=Vector((0, 1, 0)))
    else:
        b.ball((0.05, 0.035, 0.1), t0.lerp(t1, 0.5), (-0.4, 0, 0), M['tailwhite'], 'tail1', seg=8, rings=6)

    # Legs
    L = P['leg_r'] * s
    for side, k in SIDES:
        segs = [
            (f'fl_upper.{side}', 0.14, 0.09, coat), (f'fl_fore.{side}', 0.088, 0.052, coat),
            (f'fl_cannon.{side}', 0.045, 0.04, sock if P['name'] == 'Horse' else coat),
            (f'hl_thigh.{side}', 0.17, 0.1, coat), (f'hl_gaskin.{side}', 0.095, 0.05, coat),
            (f'hl_cannon.{side}', 0.047, 0.042, sock if P['name'] == 'Horse' else coat),
        ]
        for bone, r0, r1, m in segs:
            a, c = j[bone]
            b.tube([a, a.lerp(c, 0.5), c], [(r0 * L, r0 * L * 1.15), ((r0 + r1) / 2 * L, (r0 + r1) / 2 * L * 1.15),
                                             (r1 * L, r1 * L * 1.1)], m, bone, seg=10)
            b.ball(r1 * L * 1.08, c, material=m, bone=bone, seg=10, rings=6)
        for bone in (f'fl_hoof.{side}', f'hl_hoof.{side}'):
            a, c = j[bone]
            b.cyl(a, c.lerp(a, 0.35), 0.034 * L, 0.036 * L, sock if P['name'] == 'Horse' else coat, bone, seg=10)
            b.cyl(c.lerp(a, 0.38), c + Vector((0, -0.02 * s, 0)), 0.04 * L, 0.05 * L, hoof, bone, seg=10)
    return b.build(col, rig)


def build_tack(rig, col, M, j):
    """Saddle, blanket, bedroll, bridle and reins. Returns the object and the seat point."""
    b = Builder('Tack')
    bz = HORSE['body_z']
    top = bz + HORSE['body_r'][1] * 0.875 + 0.012
    sy = -0.12
    # Blanket draped over the back
    b.tube([(0, sy + 0.3, bz), (0, sy - 0.32, bz)], [(0.305, 0.33), (0.305, 0.33)], M['blanket'],
           'body', seg=14, arc=(0.42, math.pi - 0.42), ref=Vector((0, 0, 1)))
    # Saddle: seat, pommel with horn, cantle, fenders
    b.tube([(0, sy + 0.24, top + 0.02), (0, sy, top + 0.0), (0, sy - 0.22, top + 0.03)],
           [(0.2, 0.05), (0.21, 0.04), (0.18, 0.06)], M['saddle'], 'body', seg=12, ref=Vector((0, 0, 1)))
    b.box((0.2, 0.06, 0.12), (0, sy + 0.25, top + 0.08), (-0.3, 0, 0), M['saddle'], 'body')
    b.box((0.16, 0.08, 0.1), (0, sy - 0.24, top + 0.06), (0.3, 0, 0), M['saddle'], 'body')
    b.cyl((0, sy - 0.27, top + 0.08), (0, sy - 0.29, top + 0.17), 0.018, 0.02, M['saddle'], 'body', seg=8)
    b.cyl((0, sy - 0.29, top + 0.17), (0, sy - 0.29, top + 0.19), 0.035, 0.035, M['saddle'], 'body', seg=10)
    for side, k in SIDES:
        x = k * 0.27
        b.box((0.012, 0.16, 0.42), (x, sy, top - 0.22), (0, k * -0.12, 0), M['saddle'], 'body')
        # Stirrup
        b.box((0.07, 0.11, 0.02), (k * 0.31, sy - 0.02, top - 0.62), material=M['saddle'], bone='body')
        b.box((0.012, 0.012, 0.2), (k * 0.31, sy - 0.02, top - 0.52), material=M['saddle'], bone='body')
        # Saddlebags behind the cantle
        b.box((0.06, 0.2, 0.22), (k * 0.27, sy + 0.4, top - 0.12), (0, k * -0.15, 0), M['bag'], 'body')
    # Bedroll tied behind the saddle
    b.cyl((-0.28, sy + 0.4, top + 0.06), (0.28, sy + 0.4, top + 0.06), 0.075, 0.075, M['bedroll'], 'body', seg=12,
          ref=Vector((0, 0, 1)))
    # Girth strap under the belly
    b.tube([(0, sy - 0.05, bz), (0, sy - 0.08, bz)], [(0.29, 0.38), (0.29, 0.38)], M['saddle'], 'body', seg=16,
           ref=Vector((0, 0, 1)), arc=(math.pi + 0.5, 2 * math.pi - 0.5))
    # Bridle: noseband and cheek straps; reins to the horn
    h0, h1 = j['head']
    d = (h1 - h0).normalized()
    nose = h0.lerp(h1, 0.72)
    b.tube([nose - d * 0.015, nose + d * 0.015], [(0.08, 0.092), (0.08, 0.092)], M['saddle'], 'head', seg=12,
           ref=Vector((0, 0, 1)))
    brow = h0.lerp(h1, 0.05)
    b.tube([brow - d * 0.012, brow + d * 0.012], [(0.095, 0.13), (0.095, 0.13)], M['saddle'], 'head', seg=12,
           ref=Vector((0, 0, 1)))
    for side, k in SIDES:
        bit = h0.lerp(h1, 0.85) + Vector((k * 0.065, 0.02, -0.03))
        b.cyl(h0 + Vector((k * 0.09, 0, 0.0)), bit, 0.008, 0.008, M['saddle'], 'head', seg=4)
        horn = Vector((k * 0.04, sy - 0.32, top + 0.1))
        mid = bit.lerp(horn, 0.5) + Vector((0, 0, -0.12))
        b.cyl(bit, mid, 0.006, 0.006, M['saddle'], 'neck', seg=4)
        b.cyl(mid, horn, 0.006, 0.006, M['saddle'], 'body', seg=4)
    ob = b.build(col, rig)
    return ob, Vector((0, sy, top + 0.07))


def build_animal(P, col):
    M = {
        'coat': mat(P['name'] + 'Coat', '#2e2119' if P['name'] == 'Horse' else '#8a6a48', 0.8),
        'dark': mat('AnimalDark', '#1d1612', 0.8),
        'sock': mat('HorseSock', '#d9d2c4', 0.85),
        'hoof': mat('Hoof', '#2a2522', 0.6),
        'mane': mat('Mane', '#17110d', 0.9),
        'muzzle': mat(P['name'] + 'Muzzle', '#2a221e' if P['name'] == 'Horse' else '#3a2c22', 0.7),
        'eye': mat('AnimalEye', '#0c0a09', 0.2),
        'antler': mat('Antler', '#b9a586', 0.8),
        'tailwhite': mat('DeerTail', '#e9e2d5', 0.9),
        'saddle': mat('Saddle', '#5a3420', 0.6),
        'blanket': mat('Blanket', '#d8d0c0', 0.95, double=True),
        'bag': mat('SaddleBag', '#4c2e1c', 0.7),
        'bedroll': mat('Bedroll', '#8d7b5c', 0.95),
    }
    bones, j = skeleton(P)
    rig = make_armature(P['name'], bones, col, mode='ZXY')
    objs = [rig, build_body(P, rig, col, M, j)]
    seat = None
    if P['name'] == 'Horse':
        tack, seat_p = build_tack(rig, col, M, j)
        objs.append(tack)
        import bpy
        e = bpy.data.objects.new('Seat', None)
        col.objects.link(e)
        attach_to_bone(e, rig, 'body', Matrix.Translation(seat_p))
        objs.append(e)
    animate(rig, P)
    return rig, objs


# ---------------------------------------------------------------------------
# Gaits. Leg angles: +X swings a leg forward. phase 0..1 per leg.
# ---------------------------------------------------------------------------
def leg_cycle(p, duty, amp, lift):
    """Returns (swing angle, fold 0..1) for a leg at cycle phase p."""
    p %= 1.0
    if p < duty:
        u = p / duty
        return amp * (1 - 2 * u), 0.0
    u = (p - duty) / (1 - duty)
    ang = amp * (-1 + 2 * smoothstep(0, 1, u))
    return ang, lift * math.sin(math.pi * u) ** 1.2


def set_leg(Pb, front, side, ang, fold, rest_bias=0.0):
    e = lambda n: Pb[n].rotation_euler
    if front:
        e(f'fl_upper.{side}').x += ang * 0.7 + rest_bias
        e(f'fl_fore.{side}').x += ang * 0.3 + 0.35 * fold
        e(f'fl_cannon.{side}').x += -1.6 * fold
        e(f'fl_hoof.{side}').x += -0.8 * fold + 0.2 * ang
    else:
        e(f'hl_thigh.{side}').x += ang * 0.8 + rest_bias + 0.25 * fold
        e(f'hl_gaskin.{side}').x += -0.55 * fold
        e(f'hl_cannon.{side}').x += 1.0 * fold
        e(f'hl_hoof.{side}').x += -0.6 * fold + 0.2 * ang


def animate(rig, P):
    A = Animator(rig)
    tau = 2 * math.pi
    s = P['s']

    def gait(phases, duty, amp, lift, bob, pitch, neck, period_bob=2):
        def pose(Pb, t, f):
            for (front, side), off in phases.items():
                ang, fold = leg_cycle(t + off, duty, amp, lift)
                set_leg(Pb, front, side, ang, fold)
            w = tau * t * period_bob
            Pb['body'].location.z += bob * s * math.sin(w)
            Pb['body'].rotation_euler.x += pitch * math.sin(w + 0.8)
            Pb['neck'].rotation_euler.x += neck * math.sin(w + 2.0)
            Pb['head'].rotation_euler.x += -neck * 0.5 * math.sin(w + 2.4)
            Pb['tail1'].rotation_euler.x += 0.15 + 0.1 * math.sin(w + 1)
            Pb['tail1'].rotation_euler.z += 0.12 * math.sin(tau * t)
            Pb['tail2'].rotation_euler.x += 0.1 * math.sin(w + 1.5)
        return pose

    def idle(Pb, t, f):
        g = math.sin(tau * t)
        Pb['neck'].rotation_euler.x += -0.08 + 0.06 * g
        Pb['head'].rotation_euler.x += 0.05 * math.sin(tau * t * 2)
        Pb['head'].rotation_euler.z += 0.08 * math.sin(tau * t + 1)
        Pb['tail1'].rotation_euler.z += 0.25 * math.sin(tau * t * 3) * smoothstep(0.3, 0.5, t) * (1 - smoothstep(0.7, 0.9, t))
        Pb['tail1'].rotation_euler.x += 0.05
        Pb['body'].location.z += 0.005 * math.sin(tau * t * 2)
        set_leg(Pb, False, 'R', 0.0, 0.18 * (0.5 + 0.5 * g))
    A.clip('idle', 120, idle, step=2)

    walk = {(False, 'L'): 0.0, (True, 'L'): 0.25, (False, 'R'): 0.5, (True, 'R'): 0.75}
    A.clip('walk', 36, gait(walk, 0.62, 0.3, 0.75, 0.012, 0.012, 0.06), step=1)
    trot = {(True, 'L'): 0.0, (False, 'R'): 0.0, (True, 'R'): 0.5, (False, 'L'): 0.5}
    A.clip('trot', 20, gait(trot, 0.45, 0.38, 1.0, 0.03, 0.015, 0.05), step=1)
    gallop = {(False, 'L'): 0.0, (False, 'R'): 0.1, (True, 'L'): 0.38, (True, 'R'): 0.5}
    A.clip('gallop', 16, gait(gallop, 0.34, 0.55, 1.15, 0.06, 0.07, 0.12, period_bob=1), step=1)

    if P['name'] == 'Deer':
        def graze(Pb, t, f):
            Pb['neck'].rotation_euler.x += -1.0 + 0.04 * math.sin(tau * t * 2)
            Pb['head'].rotation_euler.x += -0.3 + 0.1 * math.sin(tau * t * 3)
            Pb['tail1'].rotation_euler.x += 0.1 * math.sin(tau * t * 4)
            for side in 'LR':
                Pb[f'fl_upper.{side}'].rotation_euler.x += 0.08
        A.clip('graze', 60, graze, step=2)

        def die(Pb, t, f):
            a = smoothstep(0.0, 0.6, t)
            Pb['body'].rotation_euler.y += 1.45 * a
            Pb['body'].location.z += -0.55 * s * a
            Pb['body'].location.x += 0.0
            Pb['neck'].rotation_euler.x += -0.4 * a
            Pb['head'].rotation_euler.x += -0.2 * a
            for side in 'LR':
                Pb[f'fl_upper.{side}'].rotation_euler.x += 0.3 * a
                Pb[f'fl_cannon.{side}'].rotation_euler.x += -0.5 * a
                Pb[f'hl_thigh.{side}'].rotation_euler.x += -0.2 * a
                Pb[f'hl_cannon.{side}'].rotation_euler.x += 0.4 * a
        A.clip('die', 30, die, step=1)
    else:
        def rear(Pb, t, f):
            a = math.sin(math.pi * t)
            Pb['body'].rotation_euler.x += 0.75 * a
            Pb['body'].location.z += 0.35 * a
            Pb['neck'].rotation_euler.x += -0.2 * a
            for side, k in SIDES:
                Pb[f'fl_upper.{side}'].rotation_euler.x += 0.6 * a + 0.2 * k * math.sin(tau * t * 3) * a
                Pb[f'fl_cannon.{side}'].rotation_euler.x += -1.4 * a
                Pb[f'hl_thigh.{side}'].rotation_euler.x += -0.55 * a
                Pb[f'hl_cannon.{side}'].rotation_euler.x += 0.5 * a
        A.clip('rear', 45, rear, step=1)
