"""Keyframed character animation clips for the Outbuild rig (exported inside character.glb).

Every clip is a Blender action on the `Rig` armature, pushed onto its own NLA track so the glTF exporter
writes one animation per track. The game blends these clips (locomotion by speed, crouch, air, skydive,
glide, dance, death, swings and throws) and then layers aiming, IK arms and recoil on top.

Poses are written in the character's model axes, the same axes the game uses:
  x = pitch (positive leans a spine forward, lifts a leg backward, bends a knee),
  y = yaw (positive turns to the character's left), z = roll (for the left arm/leg, positive swings it outward).
Right-side values are mirrored from the left automatically with `side()`.
"""
import math
import bpy
from mathutils import Quaternion, Vector

FPS = 30
PI = math.pi

# game axis -> Blender armature axis (Blender: Z up, character faces -Y; game: Y up, faces +Z)
AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}

BONES = ['hips', 'spine', 'chest', 'neck', 'head'] + [f'{b}.{s}' for s in 'LR' for b in
                                                     ('shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot')]


def game_quat(x=0.0, y=0.0, z=0.0):
    """Euler 'YXZ' in game axes (as three.js would build it) as a Blender quaternion."""
    return Quaternion(AX['y'], y) @ Quaternion(AX['x'], x) @ Quaternion(AX['z'], z)


def game_vec(x=0.0, y=0.0, z=0.0):
    return Vector((x, -z, y))


# ----------------------------------------------------------------------------- pose helpers

def side(pose, bone, x=0.0, y=0.0, z=0.0, right=None):
    """Set bone.L to (x, y, z) and bone.R to its mirror (or to `right` if given, also mirrored)."""
    pose[bone + '.L'] = (x, y, z)
    rx, ry, rz = right if right is not None else (x, y, z)
    pose[bone + '.R'] = (rx, -ry, -rz)


def leg(pose, s, thigh, shin, foot, spread=0.0, twist=0.0):
    sg = 1 if s == 'L' else -1
    pose['thigh.' + s] = (thigh, sg * twist, sg * spread)
    pose['shin.' + s] = (shin, 0.0, 0.0)
    pose['foot.' + s] = (foot, 0.0, -sg * spread * 0.8)


def arm(pose, s, upper_x, upper_z, fore_x, upper_y=0.0, hand_x=0.0):
    sg = 1 if s == 'L' else -1
    pose['upperarm.' + s] = (upper_x, sg * upper_y, sg * upper_z)
    pose['forearm.' + s] = (fore_x, 0.0, 0.0)
    pose['hand.' + s] = (hand_x, 0.0, 0.0)


def lerp(a, b, t):
    return a + (b - a) * t


def table(keys, t):
    """Piecewise-smooth lookup in a cyclic key table [(phase, value...)] at phase t (0..1)."""
    t %= 1.0
    ks = keys + [(keys[0][0] + 1.0,) + tuple(keys[0][1:])]
    for i in range(len(ks) - 1):
        a, b = ks[i], ks[i + 1]
        if a[0] <= t <= b[0]:
            u = (t - a[0]) / (b[0] - a[0])
            u = u * u * (3 - 2 * u)  # ease between keys
            return tuple(lerp(a[k], b[k], u) for k in range(1, len(a)))
    return tuple(keys[0][1:])


# ----------------------------------------------------------------------------- gait
# One leg over a full cycle: (phase, thigh, shin, foot). Phase 0 = this foot's heel strike.
WALK_LEG = [(0.0, -0.42, 0.06, -0.22), (0.125, -0.3, 0.22, 0.02), (0.25, -0.02, 0.08, 0.02),
            (0.375, 0.26, 0.1, 0.16), (0.5, 0.38, 0.4, 0.4), (0.625, 0.1, 0.95, 0.12), (0.75, -0.3, 0.85, -0.12),
            (0.875, -0.48, 0.3, -0.25)]
RUN_LEG = [(0.0, -0.55, 0.25, -0.1), (0.125, -0.25, 0.55, 0.1), (0.25, 0.25, 0.3, 0.35), (0.375, 0.55, 0.9, 0.55),
           (0.5, 0.35, 1.75, 0.3), (0.625, -0.35, 1.9, 0.05), (0.75, -0.85, 1.3, -0.1), (0.875, -0.8, 0.5, -0.2)]


def gait_pose(t, style):
    """style: dict with leg table, amplitude, lean, bob, arm swing, crouch."""
    p = {}
    legs = style['legs']
    amp = style.get('amp', 1.0)
    crouch = style.get('crouch', 0.0)
    for s, off in (('L', 0.0), ('R', 0.5)):
        th, sh, ft = table(legs, t + off)
        leg(p, s, th * amp - crouch * 1.05, sh * amp + crouch * 1.75, ft * amp - crouch * 0.5,
            spread=0.03 + crouch * 0.08)
    c2 = math.cos(t * 4 * PI)            # twice per cycle (each step)
    s1 = math.sin(t * 2 * PI)            # once per cycle
    bob = style['bob']
    low = style.get('low', 0.0)          # phase shift of the lowest point after contact
    dip = math.cos((t - low) * 4 * PI)
    hips_y = -bob * (0.5 + 0.5 * dip) + bob * 0.3 - crouch * 0.36
    yaw = style['yaw']
    p['hips'] = (style['lean'] * 0.4 + crouch * 0.12, -yaw * math.cos(t * 2 * PI), style['roll'] * math.sin(t * 2 * PI))
    p['_hips'] = (0.0, hips_y, crouch * 0.05)
    p['spine'] = (style['lean'] * 0.45 + crouch * 0.1, yaw * 0.55 * math.cos(t * 2 * PI), -style['roll'] * 0.5 * s1)
    p['chest'] = (style['lean'] * 0.25 + 0.015 * c2, yaw * 0.7 * math.cos(t * 2 * PI), 0.0)
    p['neck'] = (-style['lean'] * 0.3, -yaw * 0.3 * math.cos(t * 2 * PI), 0.0)
    p['head'] = (-style['lean'] * 0.45 - crouch * 0.12 + 0.02 * c2, -yaw * 0.25 * math.cos(t * 2 * PI), 0.0)
    # arms swing against the legs: left arm is back when the left leg is forward
    sw = style['arm']
    for s, off in (('L', 0.0), ('R', 0.5)):
        c = math.cos((t + off) * 2 * PI)
        fore = style['fore'] - style.get('pump', 0.25) * max(0.0, -c)
        arm(p, s, sw * c, style['armz'], fore, upper_y=0.05 * c, hand_x=0.1)
    side(p, 'shoulder', 0.0, 0.0, -0.02 - 0.03 * style.get('pump', 0.0))
    return p


WALK = dict(legs=WALK_LEG, bob=0.03, lean=0.05, yaw=0.12, roll=0.05, arm=0.34, armz=-0.62, fore=-0.28, pump=0.25)
RUN = dict(legs=RUN_LEG, bob=0.055, low=0.08, lean=0.2, yaw=0.18, roll=0.04, arm=0.62, armz=-0.5, fore=-1.25,
           pump=0.3)
SPRINT = dict(legs=RUN_LEG, amp=1.2, bob=0.065, low=0.08, lean=0.34, yaw=0.2, roll=0.04, arm=0.85, armz=-0.46,
              fore=-1.45, pump=0.35)
CROUCH_WALK = dict(legs=WALK_LEG, amp=0.65, bob=0.02, lean=0.12, yaw=0.1, roll=0.03, arm=0.25, armz=-0.5,
                   fore=-0.55, pump=0.2, crouch=1.0)


def idle_pose(t, crouch=0.0):
    p = {}
    b = math.sin(t * 4 * PI)        # two breaths per loop
    w = math.sin(t * 2 * PI)        # one weight shift
    p['_hips'] = (0.012 * w, -0.006 * (0.5 + 0.5 * b) - crouch * 0.36, crouch * 0.05)
    p['hips'] = (crouch * 0.14, 0.03 * w, -0.035 * w)
    for s in 'LR':
        sg = 1 if s == 'L' else -1
        leg(p, s, -0.05 - crouch * 1.02 + 0.02 * w * sg, 0.1 + crouch * 1.72 - 0.03 * w * sg,
            -0.05 - crouch * 0.52, spread=0.07 + crouch * 0.1)
    p['spine'] = (0.02 + crouch * 0.1, -0.02 * w, 0.02 * w)
    p['chest'] = (-0.025 * b, 0.0, 0.015 * w)
    side(p, 'shoulder', 0.0, 0.0, 0.02 * b)
    p['neck'] = (0.02, 0.0, 0.0)
    look = math.sin(t * 2 * PI + 1.2) * 0.12 + math.sin(t * 6 * PI) * 0.02
    p['head'] = (0.03 - crouch * 0.1 + 0.01 * b, look, -0.02 * w)
    for s in 'LR':
        arm(p, s, 0.03 * w, -0.64 + 0.015 * b, -0.26 - crouch * 0.3, hand_x=0.12)
    return p


def jump_pose(t):
    p = {}
    u = min(1.0, t * 1.4)
    leg(p, 'L', lerp(-0.2, -0.75, u), lerp(0.3, 1.15, u), -0.15, spread=0.05)
    leg(p, 'R', lerp(0.1, -0.12, u), lerp(0.4, 0.7, u), 0.35, spread=0.05)
    p['_hips'] = (0, 0.0, 0)
    p['hips'] = (0.05, 0.06, 0)
    p['spine'] = (0.06, -0.04, 0)
    p['chest'] = (-0.04, -0.03, 0)
    p['head'] = (-0.08, 0.02, 0)
    arm(p, 'L', lerp(-0.2, -0.55, u), lerp(-0.4, -0.15, u), -0.9)
    arm(p, 'R', lerp(0.1, 0.25, u), lerp(-0.45, -0.25, u), -0.6)
    return p


def fall_pose(t):
    p = {}
    c = math.sin(t * 2 * PI)
    leg(p, 'L', -0.45 + 0.2 * c, 0.85 - 0.3 * c, 0.1, spread=0.07)
    leg(p, 'R', -0.2 - 0.2 * c, 0.6 + 0.3 * c, 0.2, spread=0.07)
    p['hips'] = (0.0, 0.0, 0.02 * c)
    p['spine'] = (-0.05, 0.0, 0.0)
    p['chest'] = (-0.06, 0.0, 0.0)
    p['head'] = (-0.05, 0.0, 0.0)
    for s, k in (('L', 1), ('R', -1)):
        arm(p, s, -0.25 + 0.08 * c * k, 0.12 + 0.12 * c * k, -0.55)
    return p


def sky_pose(t):
    p = {}
    c = math.sin(t * 2 * PI)
    c2 = math.sin(t * 4 * PI + 0.7)
    for s, k in (('L', 1), ('R', -1)):
        leg(p, s, 0.38 + 0.07 * c * k, 0.95 + 0.12 * c2 * k, 0.35, spread=0.2)
        arm(p, s, -0.3 + 0.06 * c2 * k, 0.78 + 0.06 * c * k, -0.95 + 0.1 * c2, hand_x=-0.2)
    p['spine'] = (-0.25, 0.0, 0.02 * c)
    p['chest'] = (-0.08, 0.0, 0.0)
    p['neck'] = (-0.4, 0.0, 0.0)
    p['head'] = (-0.5, 0.0, 0.0)
    return p


def glide_pose(t):
    p = {}
    for s, k in (('L', 0.0), ('R', 1.9)):
        a = t * 2 * PI + k
        leg(p, s, 0.18 + 0.14 * math.sin(a), 0.45 + 0.18 * math.sin(a + 1.0), 0.45, spread=0.06)
    p['spine'] = (-0.06, 0.0, 0.0)
    p['head'] = (-0.12, 0.0, 0.0)
    for s in 'LR':
        arm(p, s, -1.0, 0.2, -1.2)
    return p


def dance_pose(t):
    """'Tide Bounce': 8 beats; a side-step bounce with a travelling arm wave, then a chest roll and sky punches."""
    b = t * 8.0
    p = {}
    bounce = abs(math.sin(PI * b))
    sway = math.sin(PI * b / 2)
    p['_hips'] = (0.09 * sway, -0.06 * bounce - 0.02, 0.0)
    p['hips'] = (0.04, 0.12 * math.sin(PI * b / 4), -0.1 * sway)
    for s, k in (('L', 1), ('R', -1)):
        bend = max(0.0, -sway * k)
        leg(p, s, -0.12 - 0.35 * bend - 0.1 * bounce, 0.2 + 0.7 * bend + 0.2 * bounce, -0.1 - 0.2 * bend,
            spread=0.1 + 0.06 * max(0.0, sway * k))
    first = 1.0 - smooth01(b, 3.5, 4.0) + smooth01(b, 7.5, 8.0)   # 1 during beats 0-4, 0 during 4-8
    # half A: arms spread and ripple like a wave
    wa = {}
    for s, ph in (('L', 0.0), ('R', 1.4)):
        arm(wa, s, -0.2 + 0.15 * math.sin(PI * b + ph), 0.85 + 0.45 * math.sin(PI * b + ph),
            -0.5 - 0.55 * math.sin(PI * b + ph + 1.2), hand_x=0.4 * math.sin(PI * b + ph + 2.2))
    # half B: alternate punches to the sky
    wb = {}
    for s, ph in (('L', 0.0), ('R', PI)):
        up = 0.5 + 0.5 * math.sin(PI * b + ph)
        arm(wb, s, lerp(-0.6, -2.6, up), lerp(-0.3, 0.1, up), lerp(-1.6, -0.15, up), hand_x=-0.2)
    for k in wa:
        p[k] = tuple(lerp(wb[k][i], wa[k][i], first) for i in range(3))
    roll = (1.0 - first) * 0.3
    p['spine'] = (0.04 + 0.05 * bounce, -0.1 * sway + roll * math.sin(PI * b / 2), 0.08 * sway)
    p['chest'] = (-0.04 + 0.06 * bounce, roll * math.sin(PI * b / 2 + 0.6), 0.1 * sway * first)
    p['neck'] = (0.0, 0.0, 0.0)
    p['head'] = (0.14 * math.sin(2 * PI * b) - 0.04, -0.15 * sway, 0.08 * math.sin(PI * b))
    return p


def smooth01(x, a, b):
    if x <= a:
        return 0.0
    if x >= b:
        return 1.0
    u = (x - a) / (b - a)
    return u * u * (3 - 2 * u)


# Death, swing and throw are one-shot clips written as explicit key poses (time in seconds, pose).
def death_keys():
    k = []
    p = {}
    k.append((0.0, idle_pose(0.0)))
    p = {'_hips': (0, -0.02, -0.06), 'hips': (-0.12, 0.1, 0.0), 'spine': (-0.3, 0.1, 0.0), 'chest': (-0.2, 0.0, 0.0),
         'head': (-0.35, 0.2, 0.0)}
    leg(p, 'L', -0.15, 0.2, 0.0)
    leg(p, 'R', 0.05, 0.15, 0.1)
    arm(p, 'L', 0.2, -0.1, -0.5)
    arm(p, 'R', 0.3, -0.05, -0.7)
    k.append((0.18, p))
    p = {'_hips': (0.0, -0.48, 0.04), 'hips': (0.25, 0.15, 0.1), 'spine': (0.45, 0.1, 0.0), 'chest': (0.2, 0.0, 0.0),
         'head': (0.35, 0.15, 0.0)}
    leg(p, 'L', -0.95, 1.7, -0.3)
    leg(p, 'R', -0.75, 1.5, -0.2)
    arm(p, 'L', -0.35, -0.4, -0.3)
    arm(p, 'R', -0.5, -0.35, -0.4)
    k.append((0.5, p))
    p = {'_hips': (0.0, -0.74, 0.32), 'hips': (1.05, 0.2, 0.12), 'spine': (0.25, 0.05, 0.0), 'chest': (0.1, 0.0, 0.0),
         'head': (-0.2, 0.4, 0.0)}
    leg(p, 'L', -0.35, 1.0, 0.2)
    leg(p, 'R', -0.15, 0.8, 0.3)
    arm(p, 'L', -1.1, -0.2, -0.5)
    arm(p, 'R', -1.3, -0.3, -0.4)
    k.append((0.82, p))
    p = {'_hips': (0.0, -0.8, 0.58), 'hips': (1.52, 0.25, 0.1), 'spine': (0.06, 0.0, 0.0), 'chest': (-0.04, 0.0, 0.0),
         'neck': (-0.2, 0.3, 0.0), 'head': (-0.35, 0.9, 0.0)}
    leg(p, 'L', -0.05, 0.25, 0.7, spread=0.12)
    leg(p, 'R', 0.05, 0.12, 0.8, spread=0.08)
    arm(p, 'L', -0.4, -0.25, -0.9)
    arm(p, 'R', -1.9, -0.2, -0.25)
    k.append((1.08, p))
    p2 = dict(p)
    p2['_hips'] = (0.0, -0.81, 0.6)
    p2['head'] = (-0.38, 0.95, 0.0)
    k.append((1.4, p2))
    return k


def swing_keys():
    """Upper body for a pickaxe chop: wind up to the right, strike down across, recover."""
    def s(chest_y, spine_x, hips_y, lean_z=0.0, drop=0.0):
        return {'_hips': (0.0, -drop, 0.0), 'hips': (0.0, hips_y, 0.0), 'spine': (spine_x, chest_y * 0.4, lean_z),
                'chest': (spine_x * 0.6, chest_y * 0.6, lean_z * 0.5), 'neck': (-spine_x * 0.4, -chest_y * 0.3, 0.0),
                'head': (-spine_x * 0.5, -chest_y * 0.4, 0.0)}
    return [(0.0, s(0.0, 0.0, 0.0)), (0.2, s(-0.5, -0.18, -0.12, 0.05)), (0.3, s(-0.55, -0.2, -0.14, 0.06)),
            (0.36, s(0.25, 0.32, 0.1, -0.04, 0.05)), (0.45, s(0.35, 0.38, 0.12, -0.05, 0.06)),
            (0.6, s(0.0, 0.0, 0.0))]


def throw_keys():
    def p_(chest_y, spine_x, ru, rz, rf, lu, lz, lf, step=0.0):
        p = {'spine': (spine_x, chest_y * 0.4, 0.0), 'chest': (spine_x * 0.6, chest_y * 0.6, 0.0),
             'head': (-spine_x * 0.8, -chest_y * 0.6, 0.0), 'hips': (0.0, chest_y * 0.3, 0.0)}
        arm(p, 'R', ru, rz, rf)
        arm(p, 'L', lu, lz, lf)
        leg(p, 'L', -0.2 - step, 0.15 + step, -0.05)
        leg(p, 'R', 0.15, 0.1, 0.1)
        return p
    return [(0.0, p_(0.0, 0.0, -0.2, -0.6, -0.8, -0.2, -0.6, -0.5)),
            (0.22, p_(-0.45, -0.12, 0.55, 1.25, -1.5, -0.9, -0.1, -0.5, 0.1)),
            (0.32, p_(-0.5, -0.14, 0.6, 1.3, -1.6, -1.0, -0.1, -0.4, 0.15)),
            (0.42, p_(0.3, 0.28, -1.0, 1.2, -0.2, 0.3, -0.5, -0.6, 0.25)),
            (0.6, p_(0.1, 0.1, -0.5, -0.3, -0.5, 0.0, -0.6, -0.4, 0.1))]


# ----------------------------------------------------------------------------- baking into actions

def apply_pose(rig, pose, frame, rest_q):
    for name in BONES:
        pb = rig.pose.bones.get(name)
        if pb is None:
            continue
        pb.rotation_mode = 'QUATERNION'
        x, y, z = pose.get(name, (0.0, 0.0, 0.0))
        M = rest_q[name]
        pb.rotation_quaternion = M.inverted() @ game_quat(x, y, z) @ M
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if name == 'hips':
            off = pose.get('_hips', (0.0, 0.0, 0.0))
            pb.location = M.inverted() @ game_vec(*off)
            pb.keyframe_insert('location', frame=frame)


def make_clip(rig, name, frames, pose_at, rest_q, step=1):
    """Bake pose_at(u) (u = 0..1 over the clip) into an action on its own NLA track."""
    ad = rig.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    for f in range(0, frames + 1, step):
        apply_pose(rig, pose_at(f / frames), f + 1, rest_q)
    if frames % step:
        apply_pose(rig, pose_at(1.0), frames + 1, rest_q)
    for fc in act.fcurves if hasattr(act, 'fcurves') else []:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    tr = ad.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 1, act)
    ad.action = None
    return act


def keyed(keys):
    """pose_at(u) from explicit (seconds, pose) keys with eased blending."""
    total = keys[-1][0]

    def at(u):
        t = u * total
        for i in range(len(keys) - 1):
            (t0, a), (t1, b) = keys[i], keys[i + 1]
            if t0 <= t <= t1:
                w = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
                w = w * w * (3 - 2 * w)
                out = {}
                for k in set(a) | set(b):
                    va, vb = a.get(k, (0.0, 0.0, 0.0)), b.get(k, (0.0, 0.0, 0.0))
                    out[k] = tuple(lerp(va[i], vb[i], w) for i in range(3))
                return out
        return keys[-1][1]
    return at, total


def add_clips(rig):
    bpy.context.scene.render.fps = FPS
    rest_q = {b.name: b.matrix_local.to_quaternion() for b in rig.data.bones}
    clips = [
        ('Idle', 72, lambda u: idle_pose(u)),
        ('CrouchIdle', 72, lambda u: idle_pose(u, crouch=1.0)),
        ('Walk', 30, lambda u: gait_pose(u, WALK)),
        ('Run', 24, lambda u: gait_pose(u, RUN)),
        ('Sprint', 20, lambda u: gait_pose(u, SPRINT)),
        ('CrouchWalk', 32, lambda u: gait_pose(u, CROUCH_WALK)),
        ('Jump', 15, lambda u: jump_pose(u)),
        ('Fall', 30, lambda u: fall_pose(u)),
        ('Sky', 36, lambda u: sky_pose(u)),
        ('Glide', 60, lambda u: glide_pose(u)),
        ('Dance', 120, lambda u: dance_pose(u)),
    ]
    for name, frames, fn in clips:
        make_clip(rig, name, frames, fn, rest_q)
    for name, keys in (('Death', death_keys()), ('Swing', swing_keys()), ('Throw', throw_keys())):
        at, total = keyed(keys)
        make_clip(rig, name, max(2, round(total * FPS)), at, rest_q)
    # leave the rig in its rest pose
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    print('animation clips:', [t.name for t in rig.animation_data.nla_tracks])
