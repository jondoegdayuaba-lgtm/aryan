"""The e-bike (Sur-Ron style e-moto) and its rider -> assets/ebike.glb

Node contract used by the game:
  bike_root
    body             frame, battery, motor, swingarm, shock, seat, tail, pegs (static)
    wheel_r          rear wheel, spins about local X
    steer            steering pivot (rotate about local Y)
      fork, bars, headlight, front fender
      wheel_f        front wheel, spins about local X
    rider_lower      legs + shoes (static)
    rider_upper      torso, arms, helmet, backpack; pivot at the hips so it can lean
Materials named `taillight` and `headlamp` are emissive; the game boosts `taillight` when braking.
"""
import math
import random

from mathutils import Vector

import common as C
from common import MB, pbr

TAU = 2 * math.pi


def mats():
    M = {}
    M["frame"] = pbr("frame_alu", (0.05, 0.055, 0.06), 0.34, 0.9)
    M["gold"] = pbr("anodized_gold", (0.85, 0.55, 0.08), 0.28, 1.0)
    M["rubber"] = pbr("rubber", (0.015, 0.015, 0.017), 0.9)
    M["tire"] = pbr("tire", (0.02, 0.02, 0.022), 0.85, albedo="tread_a.jpg")
    M["rim"] = pbr("rim_alloy", (0.55, 0.56, 0.58), 0.32, 1.0)
    M["rotor"] = pbr("brake_rotor", (0.62, 0.62, 0.64), 0.35, 1.0)
    M["motor"] = pbr("motor", (0.34, 0.35, 0.38), 0.4, 0.9)
    M["battery"] = pbr("battery", (0.02, 0.022, 0.025), 0.3, 0.2, coat=0.6)
    M["seat"] = pbr("seat_vinyl", (0.012, 0.012, 0.014), 0.55, coat=0.3)
    M["glow"] = pbr("underglow", (0.1, 0.9, 1.0), 0.4, emit=(0.1, 0.85, 1.0), emit_strength=6)
    M["head"] = pbr("headlamp", (1, 1, 1), 0.2, emit=(0.9, 0.95, 1.0), emit_strength=14)
    M["tail"] = pbr("taillight", (1, 0.03, 0.02), 0.3, emit=(1.0, 0.05, 0.03), emit_strength=5)
    M["screen"] = pbr("dash_screen", (0, 0.1, 0.1), 0.3, emit=(0.2, 1.0, 0.8), emit_strength=2.5)
    M["hoodie"] = pbr("hoodie", (0.16, 0.17, 0.19), 0.92)
    M["jeans"] = pbr("jeans", (0.07, 0.11, 0.24), 0.9)
    M["helmet"] = pbr("helmet", (0.92, 0.92, 0.94), 0.16, coat=1.0)
    M["visor"] = pbr("visor", (0.02, 0.03, 0.05), 0.04, 1.0)
    M["stripe"] = pbr("helmet_stripe", (0.05, 0.9, 1.0), 0.4, emit=(0.05, 0.8, 1.0), emit_strength=2)
    M["skin"] = pbr("skin", (0.55, 0.36, 0.26), 0.6)
    M["glove"] = pbr("glove", (0.02, 0.02, 0.02), 0.6)
    M["shoe"] = pbr("sneaker", (0.85, 0.85, 0.88), 0.55)
    M["pack"] = pbr("delivery_pack", (0.95, 0.3, 0.02), 0.7)
    M["hivis"] = pbr("hivis", (0.75, 0.85, 0.7), 0.5, emit=(0.5, 0.65, 0.4), emit_strength=0.8)
    return M


def wheel(M, name, cy, cz, front=False):
    mb = MB(name)
    R = 0.33
    tire = [(0.232, -0.045), (0.285, -0.056), (0.322, -0.043), (R, -0.02), (R, 0.02), (0.322, 0.043), (0.285, 0.056), (0.232, 0.045)]
    N = 36

    def knobs(t, k, i):
        if k in (3, 4) or k in (2, 5):
            return 0.010 if (i % 4) in (1, 2) else 0.0
        return 0.0

    mb.lathe(tire, M["tire"], 144, "x", (0, 0, 0), u_repeat=N, bump=knobs)
    mb.lathe([(0.232, -0.045), (0.232, 0.045)], M["tire"], 72, "x")
    # rim
    rim = [(0.232, -0.038), (0.205, -0.038), (0.200, -0.030), (0.200, 0.030), (0.205, 0.038), (0.232, 0.038)]
    mb.lathe(rim, M["rim"], 72, "x")
    # hub
    mb.lathe([(0.0, -0.056), (0.045, -0.056), (0.045, -0.03), (0.032, -0.03), (0.032, 0.03), (0.045, 0.03), (0.045, 0.056), (0.0, 0.056)], M["rim"], 24, "x")
    # spokes: 32, crossing, hub flange to rim
    for i in range(32):
        a = TAU * i / 32
        side = -1 if i % 2 == 0 else 1
        cross = 0.075 * (1 if (i // 2) % 2 == 0 else -1)
        p0 = (side * 0.03, 0.042 * math.cos(a + cross * 3), 0.042 * math.sin(a + cross * 3))
        p1 = (side * 0.008, 0.2 * math.cos(a), 0.2 * math.sin(a))
        mb.between(p0, p1, 0.0022, M["rim"], seg=4, caps=False)
    # disc rotor on the left (-x) with cut-out ring
    rot = [(0.09, -0.056), (0.16, -0.056), (0.16, -0.0525), (0.09, -0.0525)]
    mb.lathe(rot, M["rotor"], 48, "x", closed=True)
    ob = mb.finish(name)
    from mathutils import Matrix
    ob.data.transform(Matrix.Translation((0, cy, cz)))  # built around the origin, moved onto the axle
    return ob


def build_wheels(M, root, steer):
    wr = wheel(M, "wheel_r", -0.58, 0.33)
    C.place(wr, (0, -0.58, 0.33), root)
    wf = wheel(M, "wheel_f", 0.66, 0.33, True)
    C.place(wf, (0, 0.66, 0.33), steer)


def build_body(M):
    objs = []
    T = C.tube_mesh
    # main twin spars
    for s in (-1, 1):
        x = 0.078 * s
        objs.append(T(f"spar_lo{s}", M["frame"], [(x, 0.33, 0.87), (x, 0.10, 0.76), (x, -0.08, 0.58), (x, -0.20, 0.42)], 0.024))
        objs.append(T(f"spar_up{s}", M["frame"], [(x, 0.36, 1.0), (x, 0.10, 0.96), (x, -0.10, 0.90), (x, -0.30, 0.88), (x, -0.55, 0.86)], 0.02))
        objs.append(T(f"seatstay{s}", M["frame"], [(x, -0.22, 0.88), (x, -0.20, 0.62), (x, -0.20, 0.44)], 0.018))
        # swingarm
        objs.append(T(f"swing{s}", M["frame"], [(0.085 * s, -0.20, 0.42), (0.082 * s, -0.40, 0.38), (0.078 * s, -0.58, 0.33)], 0.03))
        objs.append(T(f"swingtop{s}", M["frame"], [(0.085 * s, -0.20, 0.44), (0.082 * s, -0.40, 0.46), (0.078 * s, -0.56, 0.36)], 0.014))
        # footpeg + mounts
        objs.append(T(f"peg{s}", M["rim"], [(0.08 * s, -0.02, 0.38), (0.20 * s, -0.02, 0.37)], 0.012, smooth_pts=False))
    # head tube + crossmembers
    objs.append(T("headtube", M["frame"], [(0, 0.36, 1.0), (0, 0.33, 0.87)], 0.045, smooth_pts=False))
    objs.append(T("cross1", M["frame"], [(-0.078, 0.33, 0.86), (0.078, 0.33, 0.86)], 0.02, smooth_pts=False))
    objs.append(T("cross2", M["frame"], [(-0.078, -0.20, 0.42), (0.078, -0.20, 0.42)], 0.028, smooth_pts=False))
    # shock: spring + body
    mb = MB("shock")
    mb.between((0, -0.13, 0.90), (0, -0.40, 0.40), 0.034, M["gold"], seg=10)
    for k in range(9):
        t0, t1 = 0.12 + k * 0.09, 0.12 + k * 0.09 + 0.05
        a = Vector((0, -0.13, 0.90)).lerp(Vector((0, -0.40, 0.40)), t0)
        b = Vector((0, -0.13, 0.90)).lerp(Vector((0, -0.40, 0.40)), t1)
        mb.between(a, b, 0.05, M["glow"] if k % 3 == 1 else M["frame"], seg=10)
    objs.append(mb.finish())
    # battery pack (rounded box) + motor + sprocket
    mb = MB("pack")
    mb.box(-0.086, -0.15, 0.46, 0.086, 0.21, 0.83, M["battery"])
    ob = mb.finish()
    C.add_bevel_subsurf(ob, 0.03, 1, 3)
    C.to_mesh_obj(ob)
    objs.append(ob)
    mb = MB("motor")
    mb.lathe([(0.0, -0.12), (0.10, -0.12), (0.11, -0.10), (0.11, 0.10), (0.10, 0.12), (0.0, 0.12)], M["motor"], 32, "x", (0, -0.06, 0.37))
    mb.lathe([(0.0, -0.135), (0.062, -0.135), (0.062, -0.12)], M["gold"], 24, "x", (0, -0.06, 0.37))
    mb.lathe([(0.075, 0.115), (0.075, 0.13), (0.12, 0.13), (0.12, 0.115)], M["frame"], 24, "x", (0, -0.06, 0.37), closed=True)
    objs.append(mb.finish())
    # chain
    mb = MB("chain")
    mb.between((0.12, -0.06, 0.445), (0.055, -0.58, 0.395), 0.007, M["rotor"], seg=5)
    mb.between((0.12, -0.06, 0.295), (0.055, -0.58, 0.265), 0.007, M["rotor"], seg=5)
    objs.append(mb.finish())
    # seat (lofted) with bevel+subsurf
    mb = MB("seat")
    secs = [(0.16, 0.05, 0.86, 0.90), (0.02, 0.085, 0.855, 0.935), (-0.28, 0.10, 0.86, 0.945), (-0.50, 0.075, 0.87, 0.93), (-0.62, 0.05, 0.88, 0.915)]
    for a, b in zip(secs, secs[1:]):
        (y0, w0, zb0, zt0), (y1, w1, zb1, zt1) = a, b
        v = lambda y, w, z: (w, y, z)
        mb.face([(-w0, y0, zt0), (w0, y0, zt0), (w1, y1, zt1), (-w1, y1, zt1)], M["seat"])
        mb.face([(w0, y0, zt0), (w0, y0, zb0), (w1, y1, zb1), (w1, y1, zt1)], M["seat"])
        mb.face([(-w0, y0, zb0), (-w0, y0, zt0), (-w1, y1, zt1), (-w1, y1, zb1)], M["seat"])
        mb.face([(w0, y0, zb0), (-w0, y0, zb0), (-w1, y1, zb1), (w1, y1, zb1)], M["seat"])
    y0, w0, zb0, zt0 = secs[0]
    mb.face([(-w0, y0, zt0), (-w0, y0, zb0), (w0, y0, zb0), (w0, y0, zt0)], M["seat"])
    y1, w1, zb1, zt1 = secs[-1]
    mb.face([(w1, y1, zt1), (w1, y1, zb1), (-w1, y1, zb1), (-w1, y1, zt1)], M["seat"])
    ob = mb.finish()
    C.add_bevel_subsurf(ob, 0.02, 2, 2)
    C.to_mesh_obj(ob)
    objs.append(ob)
    # tail unit + light + plate
    mb = MB("tail")
    mb.box(-0.055, -0.70, 0.83, 0.055, -0.55, 0.90, M["frame"])
    mb.box(-0.05, -0.705, 0.845, 0.05, -0.70, 0.885, M["tail"])
    mb.box(-0.09, -0.74, 0.60, 0.09, -0.735, 0.72, M["rim"])
    mb.between((0, -0.60, 0.86), (0, -0.735, 0.68), 0.012, M["frame"], seg=6)
    mb.between((0, -0.58, 0.40), (0, -0.735, 0.62), 0.012, M["frame"], seg=6)
    objs.append(mb.finish())
    # underglow strips along the spars / swingarm
    mb = MB("glowstrip")
    for s in (-1, 1):
        mb.box(0.11 * s - 0.006, -0.35, 0.335, 0.11 * s + 0.006, 0.05, 0.345, M["glow"])
    mb.box(-0.07, 0.05, 0.28, 0.07, 0.10, 0.285, M["glow"])
    objs.append(mb.finish())
    return C.join(objs, "body")


def build_steer(M):
    objs = []
    T = C.tube_mesh
    top, ax = Vector((0, 0.38, 1.02)), Vector((0, 0.66, 0.33))
    mb = MB("fork")
    for s in (-1, 1):
        x = 0.10 * s
        a = Vector((x, 0.375, 1.0))
        mid = a.lerp(Vector((x, 0.66, 0.33)), 0.45)
        b = Vector((x, 0.66, 0.33))
        mb.between(a, mid, 0.022, M["gold"], seg=10)
        mb.between(mid, b, 0.03, M["frame"], seg=10)
    mb.box(-0.13, 0.35, 0.95, 0.13, 0.40, 1.00, M["frame"])   # crown
    mb.box(-0.13, 0.35, 0.80, 0.13, 0.40, 0.84, M["frame"])
    mb.box(-0.115, 0.645, 0.315, -0.09, 0.675, 0.345, M["rim"])  # axle ends
    mb.box(0.09, 0.645, 0.315, 0.115, 0.675, 0.345, M["rim"])
    mb.box(-0.125, 0.60, 0.34, -0.09, 0.66, 0.44, M["frame"])  # caliper
    # front fender arc
    mb.lathe([(0.35, -0.055), (0.365, -0.05), (0.365, 0.05), (0.35, 0.055)], M["frame"], 14, "x", (0, 0.66, 0.33), t_range=(math.radians(20), math.radians(115)), closed=True)
    ob = mb.finish()
    objs.append(ob)
    # bars
    mb = MB("bars")
    pts = [(-0.40, 0.36, 1.10), (-0.36, 0.38, 1.06), (-0.22, 0.395, 1.045), (0.22, 0.395, 1.045), (0.36, 0.38, 1.06), (0.40, 0.36, 1.10)]
    mb.between((-0.33, 0.385, 1.055), (0.33, 0.385, 1.055), 0.013, M["frame"], seg=8)
    for s in (-1, 1):
        mb.between((0.30 * s, 0.385, 1.055), (0.44 * s, 0.335, 1.075), 0.016, M["rubber"], seg=8)     # grip
        mb.between((0.30 * s, 0.395, 1.06), (0.34 * s, 0.505, 1.06), 0.006, M["frame"], seg=5)          # lever
    mb.box(-0.06, 0.375, 1.06, 0.06, 0.415, 1.10, M["frame"])
    mb.box(-0.045, 0.40, 1.065, 0.045, 0.418, 1.095, M["screen"])
    mb.between((0, 0.36, 1.0), (0, 0.385, 1.055), 0.02, M["frame"], seg=8)
    objs.append(mb.finish())
    # headlight
    mb = MB("headlight")
    mb.box(-0.09, 0.42, 0.90, 0.09, 0.48, 1.0, M["frame"])
    mb.box(-0.075, 0.478, 0.915, 0.075, 0.485, 0.985, M["head"])
    mb.box(-0.02, 0.48, 0.885, 0.02, 0.485, 0.9, M["glow"])
    objs.append(mb.finish())
    return C.join(objs, "steer_parts")


def blob(M, name, kind, loc, scale, rot=(0, 0, 0), sub=2):
    ob = C.prim("sphere", name, M[kind], loc=loc, rot=rot, scale=scale, segments=24, rings=16, radius=1.0)
    return ob


def limb(M, name, mat, pts, r0, r1=None):
    mb = MB(name)
    r1 = r0 if r1 is None else r1
    n = len(pts) - 1
    for i in range(n):
        ra = r0 + (r1 - r0) * i / n
        rb = r0 + (r1 - r0) * (i + 1) / n
        mb.between(pts[i], pts[i + 1], ra, mat, rb, seg=12, caps=False)
    ob = mb.finish()
    return ob


def build_rider(M):
    lower, upper = [], []
    hip = Vector((0, -0.22, 0.90))
    # legs
    for s in (-1, 1):
        thigh = [(0.11 * s, -0.22, 0.89), (0.18 * s, -0.04, 0.83), (0.19 * s, 0.10, 0.76)]
        shin = [(0.19 * s, 0.10, 0.76), (0.19 * s, 0.06, 0.58), (0.175 * s, -0.02, 0.43)]
        lower.append(limb(M, f"thigh{s}", M["jeans"], thigh, 0.085, 0.066))
        lower.append(limb(M, f"shin{s}", M["jeans"], shin, 0.066, 0.05))
        lower.append(blob(M, f"knee{s}", "jeans", (0.19 * s, 0.10, 0.76), (0.07, 0.07, 0.07)))
        lower.append(blob(M, f"butt{s}", "jeans", (0.09 * s, -0.27, 0.90), (0.10, 0.12, 0.10)))
        mbs = MB(f"shoe{s}")
        mbs.box(0.175 * s - 0.05, -0.10, 0.34, 0.175 * s + 0.05, 0.16, 0.42, M["shoe"])
        mbs.box(0.175 * s - 0.052, -0.10, 0.335, 0.175 * s + 0.052, 0.165, 0.355, M["rubber"])
        so = mbs.finish()
        C.add_bevel_subsurf(so, 0.02, 1, 2)
        C.to_mesh_obj(so)
        lower.append(so)
    # torso: hoodie ellipsoid leaning forward
    lean = math.radians(-52)
    torso = blob(M, "torso", "hoodie", (0, -0.03, 1.10), (0.20, 0.155, 0.31), (lean, 0, 0))
    upper.append(torso)
    upper.append(blob(M, "hood", "hoodie", (0, -0.10, 1.31), (0.13, 0.11, 0.10)))
    upper.append(blob(M, "belly", "hoodie", (0, -0.17, 0.98), (0.19, 0.15, 0.19), (lean, 0, 0)))
    # backpack (rounded box) strapped to the back, leaning with the torso
    mb = MB("pack_rider")
    mb.box(-0.20, -0.12, -0.17, 0.20, 0.12, 0.17, M["pack"])
    mb.box(-0.205, -0.125, -0.03, 0.205, 0.125, 0.01, M["hivis"])
    mb.box(-0.205, -0.125, 0.09, 0.205, 0.125, 0.12, M["hivis"])
    pk = mb.finish()
    C.add_bevel_subsurf(pk, 0.035, 1, 3)
    C.to_mesh_obj(pk)
    pk.rotation_euler = (lean, 0, 0)
    pk.location = (0, -0.17, 1.36)
    upper.append(pk)
    # arms to the grips
    for s in (-1, 1):
        sh = (0.20 * s, 0.10, 1.30)
        el = (0.30 * s, 0.27, 1.13)
        hd = (0.37 * s, 0.385, 1.06)
        upper.append(limb(M, f"uarm{s}", M["hoodie"], [sh, el], 0.058, 0.05))
        upper.append(limb(M, f"farm{s}", M["hoodie"], [el, hd], 0.05, 0.04))
        upper.append(blob(M, f"shoulder{s}", "hoodie", sh, (0.075, 0.075, 0.075)))
        upper.append(blob(M, f"elbow{s}", "hoodie", el, (0.055, 0.055, 0.055)))
        upper.append(blob(M, f"hand{s}", "glove", hd, (0.052, 0.06, 0.05)))
    # head + helmet
    hc = Vector((0, 0.235, 1.50))
    upper.append(blob(M, "neck", "skin", (0, 0.19, 1.37), (0.055, 0.055, 0.07)))
    upper.append(blob(M, "face", "skin", (0, 0.275, 1.475), (0.085, 0.09, 0.10)))
    helm = blob(M, "helmet", "helmet", tuple(hc + Vector((0, 0.0, 0.03))), (0.125, 0.16, 0.13), (math.radians(-12), 0, 0))
    upper.append(helm)
    upper.append(blob(M, "visor", "visor", (0, 0.335, 1.505), (0.105, 0.06, 0.055)))
    mb = MB("chinbar")
    mb.between((-0.075, 0.28, 1.43), (0, 0.345, 1.40), 0.02, M["helmet"], seg=8)
    mb.between((0.075, 0.28, 1.43), (0, 0.345, 1.40), 0.02, M["helmet"], seg=8)
    upper.append(mb.finish())
    mb = MB("hstripe")
    mb.between((0, 0.11, 1.64), (0, 0.32, 1.66), 0.014, M["stripe"], seg=6)
    mb.between((-0.001, 0.32, 1.66), (0, 0.36, 1.58), 0.014, M["stripe"], seg=6)
    upper.append(mb.finish())
    lo = C.join(lower, "rider_lower_mesh")
    up = C.join(upper, "rider_upper_mesh")
    return lo, up


def build():
    M = mats()
    root = C.empty("bike_root")
    body = build_body(M)
    body.parent = root
    steer = C.empty("steer", (0, 0.36, 0.95), parent=root)
    parts = build_steer(M)
    C.place(parts, (0, 0.36, 0.95), steer)
    parts.name = "steer_parts"
    build_wheels(M, root, steer)
    lo, up = build_rider(M)
    lo.name = "rider_lower"
    C.place(lo, (0, 0, 0), root)
    up.name = "rider_upper"
    C.place(up, (0, -0.22, 0.90), root)
    return root
