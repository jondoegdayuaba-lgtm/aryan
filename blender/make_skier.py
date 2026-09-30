"""
The skier: a downhill racer modelled procedurally in Blender and exported as a skinned GLB.

  * body: Skin-modifier volume (continuous limbs) + subdivision, race-suit design painted as smooth vertex colours
  * helmet with ear pads, mirrored goggles with strap, neck gaiter, gloves, race boots, skis
    with bindings and camber / tip rocker, carbon poles with baskets, race bib
  * 17-bone armature (Root, Hips, Spine, Chest, Neck, Head, arms, legs, feet) with smooth
    envelope-style weights computed from distance to the bones

The model is authored in a ski stance (knees and hips flexed, torso leaning) so the game only has
to bend it a little in either direction.  Faces +Z in glTF (-Y in Blender).  Game coordinates
(x right = character's LEFT is +X, y up, z forward) are converted with (x, -z, y).

usage: python make_skier.py [--preview]
"""
import json
import math
import os
import sys

import numpy as np

import common as C
from common import bpy

STYLE = 'race'
if '--style' in sys.argv:
    STYLE = sys.argv[sys.argv.index('--style') + 1]
FREE = STYLE == 'free'


# ------------------------------------------------------------------ stance (game coords)
SKI_LEN = 1.66
SKI_MOUNT_Z = -0.03           # boot centre relative to the ski middle
FOOT_X = 0.115                # lateral offset of each ski
ANKLE_Y = 0.135
L_SHIN, L_THIGH = 0.44, 0.44
L_UPPER, L_FORE = 0.30, 0.27
SHIN_LEAN, THIGH_LEAN, TORSO_LEAN = 30.0, 27.0, 32.0


def sagittal(p, length, ang_deg, fwd=True):
    """(y,z) step of `length` at angle from vertical; fwd leans toward +z"""
    a = math.radians(ang_deg)
    return np.array([length * math.cos(a), length * math.sin(a) * (1 if fwd else -1)])


def joints():
    J = {}
    ax, az = 0.0, SKI_MOUNT_Z - 0.015
    for side, sx in (('L', 1.0), ('R', -1.0)):
        ankle = np.array([sx * FOOT_X, ANKLE_Y, az])
        s = sagittal(None, L_SHIN, SHIN_LEAN, True)
        knee = ankle + np.array([0.0, s[0], s[1]])
        t = sagittal(None, L_THIGH, THIGH_LEAN, False)
        hip = knee + np.array([0.0, t[0], t[1]])
        hip[0] = sx * 0.088
        J[f'ankle.{side}'], J[f'knee.{side}'], J[f'hip.{side}'] = ankle, knee, hip
    pelvis = np.array([0.0, J['hip.L'][1] + 0.035, J['hip.L'][2] - 0.012])
    J['pelvis'] = pelvis
    lean = math.radians(TORSO_LEAN)
    up = np.array([0.0, math.cos(lean), math.sin(lean)])
    J['waist'] = pelvis + up * 0.20
    J['chest1'] = pelvis + up * 0.36
    J['chest2'] = pelvis + up * 0.50
    J['neckbase'] = pelvis + up * 0.585
    nl = math.radians(TORSO_LEAN - 14.0)
    nup = np.array([0.0, math.cos(nl), math.sin(nl)])
    J['neck'] = J['neckbase'] + nup * 0.075
    hl = math.radians(6.0)
    J['head'] = J['neck'] + np.array([0.0, math.cos(hl), math.sin(hl)]) * 0.115
    for side, sx in (('L', 1.0), ('R', -1.0)):
        sh = J['chest2'] + np.array([sx * 0.190, 0.005, -0.012])
        e = sh + np.array([sx * 0.02, -L_UPPER * math.cos(math.radians(40)), L_UPPER * math.sin(math.radians(40))])
        w = e + np.array([sx * -0.015, -L_FORE * 0.17, L_FORE * 0.985])
        hand = w + np.array([sx * -0.005, -0.02, 0.085])
        J[f'shoulder.{side}'], J[f'elbow.{side}'], J[f'wrist.{side}'], J[f'hand.{side}'] = sh, e, w, hand
    return J


J = joints()


def B(v):
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[..., 0], -v[..., 2], v[..., 1]], axis=-1)


# --------------------------------------------------------------------- mesh helpers
def make_obj(name, verts, tris, smooth=True, mats=None):
    """numpy verts/tris in GAME coordinates -> Blender object"""
    ob = C.mesh_from_arrays(name, B(np.asarray(verts)), np.asarray(tris), smooth=smooth)
    return ob


def ellipsoid(center, radii, rot=None, nu=24, nv=14, y_clip=None):
    """UV ellipsoid (game coords). y_clip = (lo, hi) drops the caps outside the range (open shell)"""
    verts, tris = [], []
    for j in range(nv + 1):
        phi = math.pi * j / nv
        for i in range(nu):
            th = 2 * math.pi * i / nu
            verts.append([math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th)])
    v = np.array(verts) * np.array(radii)
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            tris += [[a, b, a + nu], [b, b + nu, a + nu]]
    if rot is not None:
        v = v @ rot.T
    return v + np.asarray(center), np.array(tris)


def rot_x(deg):
    a = math.radians(deg)
    return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])


def rot_y(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])


def rot_z(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])


def frame_from_axis(axis):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    ref = np.array([0.0, 1.0, 0.0]) if abs(axis[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, ref)
    u /= np.linalg.norm(u)
    w = np.cross(axis, u)
    return u, axis, w


def tube(p0, p1, r0, r1, sides=12, rings=3, cap0=True, cap1=True, squash=(1.0, 1.0)):
    """Tapered tube between two points (game coords) with optional end caps"""
    u, ax, w = frame_from_axis(np.asarray(p1) - np.asarray(p0))
    verts, tris = [], []
    for k in range(rings + 1):
        t = k / rings
        c = np.asarray(p0) + (np.asarray(p1) - np.asarray(p0)) * t
        r = r0 + (r1 - r0) * t
        for s in range(sides):
            a = 2 * math.pi * s / sides
            verts.append(c + u * math.cos(a) * r * squash[0] + w * math.sin(a) * r * squash[1])
    for k in range(rings):
        for s in range(sides):
            a = k * sides + s
            b = k * sides + (s + 1) % sides
            tris += [[a, b, a + sides], [b, b + sides, a + sides]]
    if cap0:
        c = len(verts)
        verts.append(np.asarray(p0))
        for s in range(sides):
            tris.append([c, (s + 1) % sides, s])
    if cap1:
        c = len(verts)
        verts.append(np.asarray(p1))
        base = rings * sides
        for s in range(sides):
            tris.append([c, base + s, base + (s + 1) % sides])
    return np.array(verts), np.array(tris)


def merge(parts):
    vs, ts, off = [], [], 0
    for v, t in parts:
        vs.append(v)
        ts.append(t + off)
        off += len(v)
    return np.concatenate(vs), np.concatenate(ts)


def subdivide(ob, levels=1, crease=False):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    C.apply_modifiers(ob)


def bevel_sub(ob, width=0.006, levels=1):
    b = ob.modifiers.new('bev', 'BEVEL')
    b.width = width
    b.segments = 2
    b.limit_method = 'ANGLE'
    C.apply_modifiers(ob)
    if levels:
        subdivide(ob, levels)


# ------------------------------------------------------------------------- materials
def pbr(name, base, rough=0.6, metal=0.0, **kw):
    return C.Mat(name, base=(*base, 1.0), rough=rough, metal=metal, **kw)


def bib_texture(number='12'):
    """race bib artwork: white cloth, red header, big black number"""
    from PIL import Image, ImageDraw, ImageFont
    w, h = 512, 416
    im = Image.new('RGB', (w, h), (238, 238, 240))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 86], fill=(196, 28, 30))
    def font(px):
        try:
            return ImageFont.load_default(size=px)
        except TypeError:
            return ImageFont.load_default()
    f1 = font(58)
    d.text((w / 2, 44), 'ALPINE', fill=(255, 255, 255), font=f1, anchor='mm')
    f2 = font(250)
    d.text((w / 2, 250), number, fill=(14, 14, 18), font=f2, anchor='mm')
    d.rectangle([0, h - 30, w, h], fill=(14, 14, 18))
    path = os.path.join(C.BUILD, 'bib.png')
    im.save(path)
    return path


def make_materials():
    M = {}
    M['suit'] = pbr('suit', (1.0, 1.0, 1.0), 0.52, sheen_weight=0.35, sheen_roughness=0.5)
    vc = M['suit'].node('ShaderNodeVertexColor', -400, 200, layer_name='Col')
    M['suit'].link_bsdf(vc, 'Color', 'Base Color')
    M['gaiter'] = pbr('gaiter', (0.028, 0.030, 0.036), 0.88)
    M['helmet'] = pbr('helmet', (0.85, 0.28, 0.02) if FREE else (0.75, 0.03, 0.03), 0.22, coat_weight=1.0, coat_roughness=0.05)
    M['skin'] = pbr('skin', (0.62, 0.34, 0.24), 0.58)
    M['lips'] = pbr('lips', (0.38, 0.10, 0.09), 0.5)
    M['hair'] = pbr('hair', (0.035, 0.022, 0.014), 0.7)
    M['pack'] = pbr('pack', (0.85, 0.28, 0.02), 0.7)
    M['pack_strap'] = pbr('pack_strap', (0.03, 0.03, 0.035), 0.75)
    M['helmet_trim'] = pbr('helmet_trim', (0.02, 0.02, 0.025), 0.5)
    M['goggle_frame'] = pbr('goggle_frame', (0.015, 0.015, 0.018), 0.45)
    M['goggle_lens'] = pbr('goggle_lens', (0.32, 0.55, 0.85), 0.04, metal=1.0)
    M['strap'] = pbr('strap', (0.9, 0.9, 0.92), 0.7)
    M['boot'] = pbr('boot', (0.02, 0.022, 0.026), 0.42, coat_weight=0.4)
    M['boot_accent'] = pbr('boot_accent', (0.7, 0.03, 0.03), 0.4)
    M['buckle'] = pbr('buckle', (0.75, 0.75, 0.78), 0.25, metal=1.0)
    M['glove'] = pbr('glove', (0.03, 0.03, 0.035), 0.55)
    M['glove_accent'] = pbr('glove_accent', (0.65, 0.03, 0.03), 0.55)
    M['ski_top'] = pbr('ski_top', (0.9, 0.9, 0.92), 0.28, coat_weight=1.0, coat_roughness=0.05)
    M['ski_edge'] = pbr('ski_edge', (0.02, 0.02, 0.022), 0.5)
    M['ski_base'] = pbr('ski_base', (0.03, 0.03, 0.035), 0.4)
    M['binding'] = pbr('binding', (0.03, 0.03, 0.035), 0.4)
    M['binding_metal'] = pbr('binding_metal', (0.65, 0.65, 0.68), 0.3, metal=1.0)
    M['pole'] = pbr('pole', (0.015, 0.015, 0.018), 0.35, metal=0.2)
    M['pole_grip'] = pbr('pole_grip', (0.03, 0.03, 0.035), 0.75)
    M['basket'] = pbr('basket', (0.55, 0.03, 0.03), 0.5)
    M['bib'] = pbr('bib', (1.0, 1.0, 1.0), 0.8)
    tex = bib_texture()
    img = bpy.data.images.load(tex)
    img.colorspace_settings.name = 'sRGB'
    node = M['bib'].node('ShaderNodeTexImage', -400, 200)
    node.image = img
    M['bib'].link_bsdf(node, 'Color', 'Base Color')
    return M


# ----------------------------------------------------------------------- body (skin)
def build_body():
    verts, edges, radii = [], [], []
    names = {}

    def V(name, pos, rx, ry):
        names[name] = len(verts)
        verts.append(np.asarray(pos, dtype=np.float64))
        radii.append((rx, ry))

    def E(a, b):
        edges.append((names[a], names[b]))

    P = J['pelvis']
    tp = 1.10 if FREE else 1.0          # jacket volume
    ap = 1.16 if FREE else 1.0          # sleeves
    lp = 1.10 if FREE else 1.0          # trousers
    V('pelvis', P, 0.160 * lp, 0.130 * lp)
    V('waist', J['waist'], 0.152 * tp, 0.114 * tp)
    V('chest1', J['chest1'], 0.186 * tp, 0.130 * tp)
    V('chest2', J['chest2'], 0.206 * tp, 0.138 * tp)
    V('neckbase', J['neckbase'], 0.078, 0.080)
    V('neck', J['neck'], 0.060, 0.064)
    E('pelvis', 'waist'); E('waist', 'chest1'); E('chest1', 'chest2'); E('chest2', 'neckbase'); E('neckbase', 'neck')
    for side in 'LR':
        hip, knee, ankle = J[f'hip.{side}'], J[f'knee.{side}'], J[f'ankle.{side}']
        V(f'hip.{side}', hip, 0.104 * lp, 0.112 * lp)
        V(f'thigh.{side}', hip + (knee - hip) * 0.45, 0.096 * lp, 0.100 * lp)
        V(f'knee.{side}', knee, 0.068 * lp, 0.072 * lp)
        V(f'calf.{side}', knee + (ankle - knee) * 0.32, 0.068 * lp, 0.074 * lp)
        V(f'shin.{side}', knee + (ankle - knee) * 0.72, 0.054 * lp, 0.054 * lp)
        V(f'ankle.{side}', ankle + (knee - ankle) * 0.10, 0.048, 0.049)
        E('pelvis', f'hip.{side}'); E(f'hip.{side}', f'thigh.{side}'); E(f'thigh.{side}', f'knee.{side}')
        E(f'knee.{side}', f'calf.{side}'); E(f'calf.{side}', f'shin.{side}'); E(f'shin.{side}', f'ankle.{side}')
        sh, el, wr = J[f'shoulder.{side}'], J[f'elbow.{side}'], J[f'wrist.{side}']
        V(f'sh.{side}', sh, 0.070 * ap, 0.070 * ap)
        V(f'upper.{side}', sh + (el - sh) * 0.45, 0.058 * ap, 0.058 * ap)
        V(f'elbow.{side}', el, 0.048 * ap, 0.048 * ap)
        V(f'fore.{side}', el + (wr - el) * 0.4, 0.047 * ap, 0.047 * ap)
        V(f'wrist.{side}', wr, 0.033, 0.033)
        E('chest2', f'sh.{side}'); E(f'sh.{side}', f'upper.{side}'); E(f'upper.{side}', f'elbow.{side}')
        E(f'elbow.{side}', f'fore.{side}'); E(f'fore.{side}', f'wrist.{side}')

    me = bpy.data.meshes.new('BodySkin')
    me.from_pydata(B(np.array(verts)).tolist(), edges, [])
    ob = C.new_object('BodySkin', me)
    C.select_only([ob])
    sk = ob.modifiers.new('Skin', 'SKIN')
    sk.branch_smoothing = 0.55
    sk.use_smooth_shade = True
    for i, (rx, ry) in enumerate(radii):
        me.skin_vertices[0].data[i].radius = (rx, ry)
    me.skin_vertices[0].data[names['pelvis']].use_root = True
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 3                      # dense enough to paint crisp suit panels per vertex
    sub.render_levels = 3
    C.apply_modifiers(ob)
    return ob


# ---------------------------------------------------------------------------- head
def build_head(M):
    parts = {}
    head = J['head']
    # a real face: skin head, nose, cheeks, lips and chin (the goggles sit over the eyes and the helmet over the top)
    v, t = ellipsoid(head + np.array([0, 0.005, 0.005]), (0.094, 0.114, 0.106), nu=28, nv=16)
    parts['skull'] = (v, t, 'skin')
    feat = [ellipsoid(head + np.array([0.0, -0.020, 0.108]), (0.013, 0.028, 0.024), nu=12, nv=8),           # nose
            ellipsoid(head + np.array([0.047, -0.046, 0.080]), (0.032, 0.031, 0.030), nu=12, nv=8),          # cheeks
            ellipsoid(head + np.array([-0.047, -0.046, 0.080]), (0.032, 0.031, 0.030), nu=12, nv=8),
            ellipsoid(head + np.array([0.0, -0.092, 0.064]), (0.041, 0.031, 0.038), nu=14, nv=8)]           # chin
    parts['face'] = (*merge(feat), 'skin')
    v, t = ellipsoid(head + np.array([0.0, -0.062, 0.096]), (0.022, 0.006, 0.010), nu=14, nv=6)
    parts['lips'] = (v, t, 'lips')
    # hair showing under the helmet at the nape
    v, t = ellipsoid(head + np.array([0.0, -0.030, -0.070]), (0.092, 0.098, 0.052), nu=18, nv=10)
    parts['hair'] = (v, t, 'hair')
    # helmet: dome open at the bottom, slightly longer at the back
    hc = head + np.array([0, 0.022, -0.004])
    v, t = ellipsoid(hc, (0.128, 0.128, 0.142), nu=32, nv=18)
    keep = v[:, 1] > head[1] - 0.045
    idx = np.cumsum(keep) - 1
    tk = np.array([tr for tr in t if keep[tr].all()])
    v, t = v[keep], idx[tk]
    parts['helmet'] = (v, t, 'helmet')
    # ear pads
    ears = []
    for sx in (1, -1):
        ears.append(ellipsoid(head + np.array([sx * 0.114, -0.020, -0.006]), (0.017, 0.050, 0.055), nu=14, nv=8))
    parts['ears'] = (*merge(ears), 'helmet_trim')
    # goggles: curved frame + lens wrapped around the face
    R = 0.118
    gcen = head + np.array([0, 0.020, 0.0])
    nx, ny = 26, 7
    fr, ls = [], []
    for name, w_, h_, off, mat in (('frame', 0.112, 0.052, 0.010, 'goggle_frame'), ('lens', 0.103, 0.045, 0.014, 'goggle_lens')):
        verts, tris = [], []
        for j in range(ny + 1):
            for i in range(nx + 1):
                u = (i / nx - 0.5) * 2
                vv = (j / ny - 0.5) * 2
                sx = math.copysign(abs(u) ** 0.8, u)
                sy = math.copysign(abs(vv) ** 0.9, vv) * (1.0 - 0.18 * abs(u) ** 2)
                th = sx * w_ / R
                y = sy * h_
                r = R + off + 0.012 * (1 - abs(u) ** 2)
                verts.append(gcen + np.array([math.sin(th) * r, y, math.cos(th) * r * 0.97 - 0.010]))
        for j in range(ny):
            for i in range(nx):
                a_ = j * (nx + 1) + i
                tris += [[a_, a_ + 1, a_ + nx + 1], [a_ + 1, a_ + nx + 2, a_ + nx + 1]]
        (fr if name == 'frame' else ls).append((np.array(verts), np.array(tris)))
    parts['goggle_frame'] = (*merge(fr), 'goggle_frame')
    parts['goggle_lens'] = (*merge(ls), 'goggle_lens')
    # strap around the helmet
    verts, tris = [], []
    n = 40
    for i in range(n):
        th = 2 * math.pi * i / n
        for dy in (-0.022, 0.022):
            r = 0.132 + 0.001
            verts.append(gcen + np.array([math.sin(th) * r * 0.99, dy + 0.004, math.cos(th) * r * 1.13 - 0.008]))
    for i in range(n):
        a_ = 2 * i
        b_ = 2 * ((i + 1) % n)
        tris += [[a_, b_, a_ + 1], [b_, b_ + 1, a_ + 1]]
    parts['strap'] = (np.array(verts), np.array(tris), 'strap')
    return parts


def build_backpack():
    """freeride backpack strapped over the jacket"""
    parts = {}
    lean = math.radians(TORSO_LEAN)
    up = np.array([0.0, math.cos(lean), math.sin(lean)])
    back = np.array([0.0, math.sin(lean), -math.cos(lean)])
    c = J['chest1'] + up * 0.01 + back * 0.150
    rot = rot_x(TORSO_LEAN)
    v, t = ellipsoid(c, (0.118, 0.175, 0.066), rot=rot, nu=24, nv=14)
    parts['pack'] = (v, t, 'pack')
    v, t = ellipsoid(c + up * 0.15 + back * 0.012, (0.098, 0.04, 0.062), rot=rot, nu=16, nv=8)
    parts['pack_flap'] = (v, t, 'pack_strap')
    sv = []
    for sx in (1, -1):
        p0 = J['chest2'] + np.array([sx * 0.10, 0.06, 0.0]) + back * 0.06
        p1 = J['chest1'] + np.array([sx * 0.13, 0.0, 0.0]) - back * 0.02 + up * 0.03
        sv.append(tube(p0, p1, 0.022, 0.022, sides=8, rings=2))
    parts['pack_straps'] = (*merge(sv), 'pack_strap')
    return parts


# ---------------------------------------------------------------------- boots, skis
def build_boots():
    parts = {}
    for side, sx in (('L', 1.0), ('R', -1.0)):
        ank = J[f'ankle.{side}']
        c = np.array([sx * FOOT_X, 0.0, SKI_MOUNT_Z])
        # shell: lower boot as a rounded wedge
        v, t = ellipsoid(c + np.array([0, 0.088, 0.045]), (0.056, 0.076, 0.185), nu=20, nv=12)
        v[:, 1] = np.maximum(v[:, 1], 0.058)                       # flat sole
        parts[f'boot_shell.{side}'] = (v, t, 'boot')
        # cuff: tapered tube around the lower shin, leaning with it
        top = J[f'knee.{side}']
        p0 = ank + np.array([0, 0.02, 0.0])
        p1 = ank + (top - ank) * 0.42
        v, t = tube(p0, p1, 0.066, 0.062, sides=16, rings=4, squash=(1.0, 1.05))
        parts[f'boot_cuff.{side}'] = (v, t, 'boot')
        # tongue / accents
        v, t = tube(ank + np.array([0, 0.03, 0.03]), p1 + np.array([0, -0.02, 0.03]), 0.026, 0.024, sides=8, rings=2)
        parts[f'boot_accent.{side}'] = (v, t, 'boot_accent')
        # buckles
        bv, bt = [], []
        for k, f in enumerate((0.08, 0.22, 0.36)):
            pc = ank + (top - ank) * f + np.array([0.0, 0.0, 0.048])
            v, t = ellipsoid(pc, (0.05, 0.012, 0.012), nu=8, nv=6)
            bv.append((v, t))
        parts[f'buckles.{side}'] = (*merge(bv), 'buckle')
    return parts


def build_skis():
    parts = {}
    n_len, n_w = 90, 5
    for side, sx in (('L', 1.0), ('R', -1.0)):
        zs = np.linspace(-SKI_LEN / 2, SKI_LEN / 2, n_len)
        top_v, base_v = [], []
        for z in zs:
            t = z / (SKI_LEN / 2)                                     # -1 tail .. +1 tip
            # sidecut: wide tip, narrow waist
            width = 0.070 + 0.030 * max(t, 0) ** 2 * 1.4 + 0.012 * min(t, 0) ** 2 - 0.004
            width = max(width, 0.064)
            # camber + rocker
            camber = 0.010 * (1 - t * t) ** 1.5
            tip = 0.075 * max((t - 0.82) / 0.18, 0) ** 2 if t > 0.82 else 0.0
            tail = 0.030 * max((-t - 0.9) / 0.1, 0) ** 2 if t < -0.9 else 0.0
            y0 = camber + tip + tail
            thick = 0.016 + 0.020 * math.exp(-((z + 0.02) / 0.16) ** 2)
            for wi in range(n_w):
                xw = (wi / (n_w - 1) - 0.5) * width
                edge = abs(xw) / (width / 2)
                dz = 0.004 * edge ** 3
                top_v.append([sx * FOOT_X + xw, y0 + thick - dz, z])
                base_v.append([sx * FOOT_X + xw, y0, z])
        top_v, base_v = np.array(top_v), np.array(base_v)
        nt = len(top_v)
        allv = np.concatenate([top_v, base_v])
        tris_top, tris_base, tris_side = [], [], []
        for i in range(n_len - 1):
            for wi in range(n_w - 1):
                a = i * n_w + wi
                b = a + 1
                c = a + n_w
                d = c + 1
                tris_top += [[a, c, b], [b, c, d]]
                tris_base += [[nt + a, nt + b, nt + c], [nt + b, nt + d, nt + c]]
        for i in range(n_len - 1):
            for e in (0, n_w - 1):
                a = i * n_w + e
                c = a + n_w
                if e == 0:
                    tris_side += [[a, nt + a, c], [c, nt + a, nt + c]]
                else:
                    tris_side += [[a, c, nt + a], [c, nt + c, nt + a]]
        # tip and tail closing
        for e in (0, n_len - 1):
            for wi in range(n_w - 1):
                a = e * n_w + wi
                b = a + 1
                if e == 0:
                    tris_side += [[a, b, nt + a], [b, nt + b, nt + a]]
                else:
                    tris_side += [[a, nt + a, b], [b, nt + a, nt + b]]
        parts[f'ski_top.{side}'] = (allv, np.array(tris_top), 'ski_top')
        parts[f'ski_edge.{side}'] = (allv, np.array(tris_side), 'ski_edge')
        parts[f'ski_base.{side}'] = (allv, np.array(tris_base), 'ski_base')
        # binding: toe piece and heel piece
        bind = []
        for zc, size in ((SKI_MOUNT_Z + 0.185, (0.045, 0.028, 0.05)), (SKI_MOUNT_Z - 0.165, (0.046, 0.032, 0.05))):
            y = 0.010 + 0.034
            v, t = ellipsoid(np.array([sx * FOOT_X, y + 0.010, zc]), size, nu=12, nv=8)
            v[:, 1] = np.maximum(v[:, 1], y - 0.006)
            bind.append((v, t))
        parts[f'binding.{side}'] = (*merge(bind), 'binding')
        # metal brake arms / plate
        v, t = tube(np.array([sx * FOOT_X - 0.05, 0.05, SKI_MOUNT_Z - 0.20]), np.array([sx * FOOT_X - 0.05, 0.05, SKI_MOUNT_Z - 0.30]), 0.004, 0.004, sides=6, rings=1)
        v2, t2 = tube(np.array([sx * FOOT_X + 0.05, 0.05, SKI_MOUNT_Z - 0.20]), np.array([sx * FOOT_X + 0.05, 0.05, SKI_MOUNT_Z - 0.30]), 0.004, 0.004, sides=6, rings=1)
        parts[f'brake.{side}'] = (*merge([(v, t), (v2, t2)]), 'binding_metal')
    return parts


def build_hands_and_poles():
    parts = {}
    for side, sx in (('L', 1.0), ('R', -1.0)):
        w, hnd = J[f'wrist.{side}'], J[f'hand.{side}']
        d = (hnd - w) / np.linalg.norm(hnd - w)
        # glove: fist block + cuff
        cen = w + d * 0.055
        u, ax, wv = frame_from_axis(d)
        rot = np.stack([u, ax, wv], axis=1)
        v, t = ellipsoid((0, 0, 0), (0.046, 0.058, 0.040), nu=16, nv=10)
        v = v @ rot.T + cen
        parts[f'glove.{side}'] = (v, t, 'glove')
        v, t = tube(w - d * 0.055, w + d * 0.02, 0.040, 0.036, sides=14, rings=2)
        parts[f'glove_cuff.{side}'] = (v, t, 'glove_accent')
        v, t = ellipsoid((0, 0, 0), (0.016, 0.03, 0.018), nu=10, nv=8)
        v = v @ rot.T + (cen + np.array([-sx * 0.02, 0.015, 0.02]))
        parts[f'thumb.{side}'] = (v, t, 'glove')
        # pole: from the grip toward the snow, trailing behind the skier
        grip = cen + np.array([0.0, -0.005, 0.0])
        tilt = math.radians(24)
        pd = np.array([-sx * 0.05, -math.cos(tilt) * 0.95, -math.sin(tilt) * 1.0])
        pd /= np.linalg.norm(pd)
        top = grip - pd * 0.09
        tip = grip + pd * 1.03
        v, t = tube(top, top + pd * 0.14, 0.017, 0.017, sides=10, rings=2)
        parts[f'pole_grip.{side}'] = (v, t, 'pole_grip')
        v, t = tube(top + pd * 0.14, tip, 0.0085, 0.0062, sides=8, rings=6)
        parts[f'pole_shaft.{side}'] = (v, t, 'pole')
        # basket: flat cone
        bc = tip - pd * 0.055
        v, t = tube(bc, bc + pd * 0.03, 0.05, 0.012, sides=14, rings=1)
        parts[f'pole_basket.{side}'] = (v, t, 'basket')
        v, t = tube(tip - pd * 0.02, tip + pd * 0.03, 0.006, 0.001, sides=6, rings=1)
        parts[f'pole_tip.{side}'] = (v, t, 'pole')
        # strap loop
        loop = []
        for i in range(12):
            a = 2 * math.pi * i / 12
            loop.append(top + pd * 0.05 + u * math.cos(a) * 0.045 + ax * math.sin(a) * 0.015)
        lv, lt = [], []
        for i, p in enumerate(loop):
            lv.append(p)
        parts[f'strap_loop.{side}'] = None
    return {k: v for k, v in parts.items() if v is not None}


def build_bib():
    """race bib on the back, wrapped onto the torso (numbers are separate geometry)"""
    parts = {}
    c = J['chest1']
    lean = math.radians(TORSO_LEAN)
    up = np.array([0.0, math.cos(lean), math.sin(lean)])
    back = np.array([0.0, -math.sin(lean), math.cos(lean)]) * -1.0        # points out of the back
    nx, ny = 10, 8
    w, h = 0.30, 0.26
    verts, tris = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            u = (i / nx - 0.5) * w
            v = (j / ny - 0.5) * h
            th = u / 0.20
            r = 0.128 + 0.006
            p = c + up * v + np.array([math.sin(th) * 0.2, 0, 0]) + back * (r * math.cos(th) * 0.9 + 0.0)
            verts.append(p)
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            tris += [[a, a + nx + 1, a + 1], [a + 1, a + nx + 1, a + nx + 2]]
    parts['bib'] = (np.array(verts), np.array(tris), 'bib')
    return parts


# ------------------------------------------------------------------------ armature
BONES = [
    # name, parent, head, tail
    ('Root', None, np.array([0.0, 0.0, SKI_MOUNT_Z]), np.array([0.0, 0.10, SKI_MOUNT_Z])),
    ('Hips', 'Root', J['pelvis'], J['waist']),
    ('Spine', 'Hips', J['waist'], J['chest1']),
    ('Chest', 'Spine', J['chest1'], J['neckbase']),
    ('Neck', 'Chest', J['neckbase'], J['neck']),
    ('Head', 'Neck', J['neck'], J['head'] + np.array([0.0, 0.14, 0.0])),
]
for _s in 'LR':
    BONES += [
        (f'UpperLeg.{_s}', 'Hips', J[f'hip.{_s}'], J[f'knee.{_s}']),
        (f'LowerLeg.{_s}', f'UpperLeg.{_s}', J[f'knee.{_s}'], J[f'ankle.{_s}']),
        (f'Foot.{_s}', 'Root', J[f'ankle.{_s}'], np.array([J[f'ankle.{_s}'][0], 0.03, SKI_MOUNT_Z + 0.20])),
        (f'UpperArm.{_s}', 'Chest', J[f'shoulder.{_s}'], J[f'elbow.{_s}']),
        (f'ForeArm.{_s}', f'UpperArm.{_s}', J[f'elbow.{_s}'], J[f'wrist.{_s}']),
        (f'Hand.{_s}', f'ForeArm.{_s}', J[f'wrist.{_s}'], J[f'hand.{_s}'] + (J[f'hand.{_s}'] - J[f'wrist.{_s}']) * 0.6),
    ]


def make_armature():
    arm = bpy.data.armatures.new('SkierRig')
    ob = bpy.data.objects.new('SkierRig', arm)
    bpy.context.scene.collection.objects.link(ob)
    C.select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, parent, head, tail in BONES:
        b = arm.edit_bones.new(name)
        b.head = tuple(B(head))
        b.tail = tuple(B(tail))
        b.roll = 0.0
        eb[name] = b
    for name, parent, head, tail in BONES:
        if parent:
            eb[name].parent = eb[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def bone_weights(points, exclude_side=None):
    """envelope weights (N, nbones) from distance to bone segments"""
    names = [b[0] for b in BONES]
    W = np.zeros((len(points), len(names)))
    for k, (name, parent, head, tail) in enumerate(BONES):
        if name == 'Root':
            continue
        a, b = np.asarray(head), np.asarray(tail)
        ab = b - a
        t = np.clip(((points - a) @ ab) / (ab @ ab), 0, 1)
        proj = a + t[:, None] * ab
        d = np.linalg.norm(points - proj, axis=1)
        # radius of influence by bone
        rad = {'Hips': 0.16, 'Spine': 0.15, 'Chest': 0.17, 'Neck': 0.07, 'Head': 0.12}.get(name.split('.')[0], 0.075)
        W[:, k] = np.exp(-(d / rad) ** 2 * 2.2)
        if name.endswith('.L'):
            W[:, k] *= 1.0 / (1.0 + np.exp(-(points[:, 0] + 0.012) * 90))     # only near the +X side
        if name.endswith('.R'):
            W[:, k] *= 1.0 / (1.0 + np.exp((points[:, 0] - 0.012) * 90))
    return names, W


def skin_object(ob, arm, weights, names):
    """assign vertex groups from the weight matrix (top-4 per vertex)"""
    for n in names:
        if n not in ob.vertex_groups:
            ob.vertex_groups.new(name=n)
    W = weights.copy()
    top = np.argsort(-W, axis=1)[:, :4]
    for vi in range(W.shape[0]):
        s = W[vi, top[vi]].sum()
        if s <= 1e-9:
            continue
        for k in top[vi]:
            w = W[vi, k] / s
            if w > 0.001:
                ob.vertex_groups[names[k]].add([vi], float(w), 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    ob.parent = arm


def rigid_weights(n, bone, names):
    W = np.zeros((n, len(names)))
    W[:, names.index(bone)] = 1.0
    return W


# ---------------------------------------------------------------------------- main
def paint_suit(ob, M):
    """outfit design as smooth per-vertex colours (linear RGB), from position and normal.
    race: red suit, white side panels, black yoke, black lower legs, white cuffs, black neck gaiter.
    free: teal jacket with dark yoke and orange cuffs, charcoal trousers, neck gaiter pulled down."""
    me = ob.data
    me.materials.append(M['suit'].mat)
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    nor = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get('normal', nor)
    co, nor = co.reshape(-1, 3), nor.reshape(-1, 3)
    g = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1).astype(np.float64)           # Blender -> game (y up, z forward)
    gn = np.stack([nor[:, 0], nor[:, 2], -nor[:, 1]], 1).astype(np.float64)
    x, y, z = g[:, 0], g[:, 1], g[:, 2]

    def ss(a, b, v):
        t = np.clip((v - a) / (b - a), 0.0, 1.0)
        return t * t * (3 - 2 * t)

    WHITE = np.array([0.80, 0.82, 0.86])
    BLACK = np.array([0.011, 0.012, 0.015])
    ch2, ch1, nb = J['chest2'][1], J['chest1'][1], J['neckbase'][1]
    lean = math.radians(TORSO_LEAN)
    tup = np.array([0.0, math.cos(lean), math.sin(lean)])
    along = (g - J['pelvis']) @ tup                                              # distance up the torso axis
    if not FREE:
        RED = np.array([0.60, 0.030, 0.028])
        col = np.tile(RED, (n, 1))

        def mix(target, w):
            nonlocal col
            col = col * (1 - w[:, None]) + np.asarray(target)[None, :] * w[:, None]

        side = ss(0.80, 0.95, np.abs(gn[:, 0])) * ss(0.050, 0.090, np.abs(x))
        mix(WHITE, side * (1 - ss(ch2 - 0.030, ch2 + 0.010, y)) * ss(0.20, 0.26, y))
        arm = ss(0.35, 0.65, gn[:, 0] * np.sign(x)) * ss(0.19, 0.24, np.abs(x))
        mix(WHITE, arm * 0.85)
        yoke = ss(0.0, 0.020, (y + 0.32 * np.abs(x)) - (ch2 - 0.065))
        front = ss(0.10, 0.45, gn[:, 2])
        mix(BLACK, yoke * (1 - 0.85 * front * ss(ch2 + 0.02, ch2 - 0.03, y)))
        mix(BLACK, ss(0.34, 0.24, y))
        for s_ in 'LR':
            d = np.linalg.norm(g - J[f'wrist.{s_}'], axis=1)
            mix(WHITE, ss(0.075, 0.045, d))
        mix(BLACK, ss(nb - 0.015, nb + 0.010, y))
    else:
        JACKET = np.array([0.012, 0.28, 0.31])
        JACKET_D = np.array([0.006, 0.085, 0.105])
        PANTS = np.array([0.030, 0.032, 0.038])
        ORANGE = np.array([0.85, 0.30, 0.03])
        col = np.tile(PANTS, (n, 1))

        def mix(target, w):
            nonlocal col
            col = col * (1 - w[:, None]) + np.asarray(target)[None, :] * w[:, None]

        mix(JACKET, ss(0.095, 0.115, along))                                       # everything above the hips is jacket
        mix(JACKET_D, ss(0.44, 0.47, along) * (1 - 0.0))                           # dark shoulder yoke
        mix(JACKET_D, ss(0.115, 0.135, along) * (1 - ss(0.145, 0.165, along)))     # dark hem band
        mix(ORANGE, ss(0.16, 0.175, along) * (1 - ss(0.185, 0.20, along)) * 0.9)   # orange hem stripe
        for s_ in 'LR':
            d = np.linalg.norm(g - J[f'wrist.{s_}'], axis=1)
            mix(JACKET_D, ss(0.115, 0.085, d))                                      # sleeve cuffs
            mix(ORANGE, ss(0.17, 0.15, d) * (1 - ss(0.12, 0.10, d)) * 0.9)          # orange sleeve band
        # trousers: darker below the knees, lighter side panels
        mix(BLACK, ss(0.36, 0.25, y))
        mix(PANTS * 1.6, ss(0.80, 0.95, np.abs(gn[:, 0])) * ss(0.05, 0.09, np.abs(x)) * (1 - ss(0.095, 0.115, along)))
        mix(JACKET_D, ss(nb - 0.015, nb + 0.010, y))                                # neck gaiter, pulled down
    # a whisper of fabric variation so the suit does not look like plastic
    rng = np.random.default_rng(3)
    col *= (1.0 + 0.035 * np.sin(g @ np.array([31.0, 27.0, 23.0]) + rng.uniform(0, 6))[:, None])
    attr = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((n, 1))], axis=1)
    attr.data.foreach_set('color', rgba.astype(np.float32).ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = list(me.color_attributes).index(attr)


def uv_unwrap(ob):
    C.select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')


def main():
    C.reset_scene()
    M = make_materials()
    arm = make_armature()
    names = [b[0] for b in BONES]

    objs = []

    # ---- body
    body = build_body()
    body.name = 'Suit'
    paint_suit(body, M)
    pts = np.array([v.co[:] for v in body.data.vertices])
    gp = np.stack([pts[:, 0], pts[:, 2], -pts[:, 1]], 1)
    _, W = bone_weights(gp)
    skin_object(body, arm, W, names)
    objs.append(body)

    def add_parts(parts, bone_of, subdiv=0, bevel=0.0):
        for name, (v, t, mat) in parts.items():
            ob = make_obj(name, v, t)
            ob.data.materials.append(M[mat].mat)
            if bevel:
                bevel_sub(ob, bevel, subdiv)
            elif subdiv:
                subdivide(ob, subdiv)
            bone = bone_of(name)
            pts_ = np.array([vv.co[:] for vv in ob.data.vertices])
            gp_ = np.stack([pts_[:, 0], pts_[:, 2], -pts_[:, 1]], 1)
            if bone == 'auto':
                _, Wm = bone_weights(gp_)
            else:
                Wm = rigid_weights(len(gp_), bone, names)
            skin_object(ob, arm, Wm, names)
            objs.append(ob)

    def side_of(name):
        return name.split('.')[-1]

    add_parts(build_head(M), lambda n: 'Head', subdiv=1)
    # boots: shell -> Foot, cuff blends toward the lower leg
    boots = build_boots()
    for name, (v, t, mat) in boots.items():
        ob = make_obj(name, v, t)
        ob.data.materials.append(M[mat].mat)
        subdivide(ob, 1)
        s = side_of(name)
        pts_ = np.array([vv.co[:] for vv in ob.data.vertices])
        gp_ = np.stack([pts_[:, 0], pts_[:, 2], -pts_[:, 1]], 1)
        Wm = np.zeros((len(gp_), len(names)))
        if name.startswith('boot_shell'):
            Wm[:, names.index(f'Foot.{s}')] = 1
        else:
            ank = J[f'ankle.{s}'][1]
            f = np.clip((gp_[:, 1] - (ank + 0.03)) / 0.14, 0, 1)
            Wm[:, names.index(f'Foot.{s}')] = 1 - f
            Wm[:, names.index(f'LowerLeg.{s}')] = f
        skin_object(ob, arm, Wm, names)
        objs.append(ob)
    for name, (v, t, mat) in build_skis().items():
        ob = make_obj(name, v, t, smooth=False)
        ob.data.materials.append(M[mat].mat)
        s = side_of(name)
        skin_object(ob, arm, rigid_weights(len(ob.data.vertices), f'Foot.{s}', names), names)
        objs.append(ob)
    for name, (v, t, mat) in build_hands_and_poles().items():
        ob = make_obj(name, v, t)
        ob.data.materials.append(M[mat].mat)
        subdivide(ob, 1) if name.startswith(('glove', 'thumb')) else None
        s = side_of(name)
        skin_object(ob, arm, rigid_weights(len(ob.data.vertices), f'Hand.{s}', names), names)
        objs.append(ob)
    for name, (v, t, mat) in (build_bib().items() if not FREE else []):
        ob = make_obj(name, v, t)
        me = ob.data
        # planar UVs (the plate is a curved grid: u across, v up)
        nxq, nyq = 10, 8
        uvv = np.array([[1.0 - i / nxq, j / nyq] for j in range(nyq + 1) for i in range(nxq + 1)], dtype=np.float32)
        loops = np.empty(len(me.loops), dtype=np.int32)
        me.loops.foreach_get('vertex_index', loops)
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', uvv[loops].ravel())
        ob.data.materials.append(M[mat].mat)
        pts_ = np.array([vv.co[:] for vv in ob.data.vertices])
        gp_ = np.stack([pts_[:, 0], pts_[:, 2], -pts_[:, 1]], 1)
        _, Wm = bone_weights(gp_)
        skin_object(ob, arm, Wm, names)
        objs.append(ob)

    if FREE:
        for name, (v, t, mat) in build_backpack().items():
            ob = make_obj(name, v, t)
            ob.data.materials.append(M[mat].mat)
            pts_ = np.array([vv.co[:] for vv in ob.data.vertices])
            gp_ = np.stack([pts_[:, 0], pts_[:, 2], -pts_[:, 1]], 1)
            _, Wm = bone_weights(gp_)
            skin_object(ob, arm, Wm, names)
            objs.append(ob)

    # ---- export
    tri = sum(len(o.data.polygons) for o in objs)
    print(f'skier: {len(objs)} meshes, ~{tri} polygons, {len(names)} bones')
    out = os.path.join(C.ASSETS, 'models', 'skier_free.glb' if FREE else 'skier.glb')
    C.export_glb(out, [arm] + objs, materials=True, skins=True, jpeg=True, vertex_colors=True)
    rest = {b[0]: dict(head=[float(x) for x in b[2]], tail=[float(x) for x in b[3]], parent=b[1]) for b in BONES}
    with open(os.path.join(C.ASSETS, 'models', 'skier_rig.json'), 'w') as f:
        json.dump(dict(bones=rest, skiLength=SKI_LEN, mountZ=SKI_MOUNT_Z, footX=FOOT_X,
                       joints={k: [float(x) for x in v] for k, v in J.items()}), f, indent=1)
    if '--preview' in sys.argv:
        preview(objs, arm)


def preview(objs, arm):
    """Small Cycles turntable stills (front, side, back) under a simple studio light"""
    sc = bpy.context.scene
    C.setup_cycles(samples=40, denoise=True, res=(600, 900))
    w = bpy.data.worlds.new('studio')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.75, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    ground = C.mesh_from_arrays('g', [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]], [[0, 1, 2], [0, 2, 3]])
    gm = C.Mat('gm', base=(0.9, 0.93, 0.97, 1), rough=0.8)
    ground.data.materials.append(gm.mat)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 60
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    views = {'front': (0, -4.2, 1.05, 0), 'side': (4.2, 0, 1.0, 90), 'back': (0.5, 4.2, 1.15, 180)}
    for name, (x, y, z, rz) in views.items():
        co.location = (x, y, z)
        co.rotation_euler = (math.radians(90), 0, math.radians(rz))
        C.render_to(os.path.join(C.BUILD, f'skier_{"free_" if FREE else ""}{name}.png'), 'PNG', 'RGB')
    print('previews in', C.BUILD)


if __name__ == '__main__':
    main()
