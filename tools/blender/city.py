"""City kit: ground tile, building archetypes and street props -> assets/city.glb

City layout contract shared with the game (ebike/js/config.js):
  tile period 100 m, block 80 m (+-40), road half-width 10 m around x,z = +-50,
  sidewalk 6 m, four 32 m building lots centred at (+-18, +-18).
"""
import math
import random

from mathutils import Vector

import common as C
from common import MB, pbr

FLOOR_H = 3.5
GROUND_H = 5.0
LOT = 32.0


# ---------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------
def materials():
    M = {}
    for n in ("brick", "glass", "concrete", "deco"):
        M[n] = pbr(f"fac_{n}", albedo=f"{n}_a.jpg", orm=f"{n}_orm.jpg", emissive=f"{n}_e.jpg", emit_strength=1.7)
    M["store"] = pbr("store", albedo="store_a.jpg", orm="store_orm.jpg", emissive="store_e.jpg", emit_strength=1.5)
    M["roof"] = pbr("roof", albedo="roof_a.jpg", orm="roof_orm.jpg")
    M["asphalt"] = pbr("asphalt", albedo="asphalt_a.jpg", orm="asphalt_orm.jpg")
    M["sidewalk"] = pbr("sidewalk", albedo="sidewalk_a.jpg", orm="sidewalk_orm.jpg")
    M["neon"] = pbr("neon_sign", albedo="neon_a.jpg", emissive="neon_e.jpg", emit_strength=3.2, rough=0.5)
    M["trim"] = pbr("trim", (0.32, 0.32, 0.31), 0.85)
    M["curb"] = pbr("curb", (0.42, 0.42, 0.40), 0.8)
    M["metal"] = pbr("metal", (0.42, 0.44, 0.47), 0.42, 0.85)
    M["darkmetal"] = pbr("darkmetal", (0.06, 0.065, 0.07), 0.45, 0.9)
    M["beacon"] = pbr("beacon", (1, 0.05, 0.03), 0.3, emit=(1, 0.08, 0.04), emit_strength=8)
    M["white_line"] = pbr("paint_white", (0.78, 0.78, 0.74), 0.55)
    M["yellow_line"] = pbr("paint_yellow", (0.9, 0.65, 0.08), 0.55)
    M["manhole"] = pbr("manhole", (0.05, 0.05, 0.055), 0.5, 0.8)
    M["wood"] = pbr("wood", (0.22, 0.12, 0.06), 0.8)
    M["tank"] = pbr("tank", (0.28, 0.16, 0.09), 0.85)
    M["lamp"] = pbr("lamp", (1, 0.8, 0.5), 0.3, emit=(1.0, 0.72, 0.38), emit_strength=9)
    M["led"] = pbr("led_white", (0.9, 0.95, 1), 0.3, emit=(0.85, 0.92, 1.0), emit_strength=6)
    M["red"] = pbr("hydrant_red", (0.55, 0.05, 0.04), 0.4, 0.3)
    M["blue"] = pbr("mailbox_blue", (0.05, 0.12, 0.4), 0.4, 0.3)
    M["green_bin"] = pbr("dumpster", (0.06, 0.2, 0.1), 0.5, 0.4)
    M["sig_red"] = pbr("sig_red", (1, 0.05, 0.03), 0.3, emit=(1, 0.08, 0.05), emit_strength=6)
    M["sig_green"] = pbr("sig_green", (0.05, 1, 0.4), 0.3, emit=(0.1, 1, 0.45), emit_strength=6)
    M["sig_amber"] = pbr("sig_amber", (1, 0.6, 0.05), 0.3, emit=(1, 0.6, 0.06), emit_strength=6)
    M["sig_case"] = pbr("sig_case", (0.02, 0.02, 0.02), 0.5, 0.2)
    M["orange"] = pbr("cone_orange", (0.95, 0.3, 0.02), 0.5)
    M["white"] = pbr("plain_white", (0.85, 0.85, 0.85), 0.5)
    M["leaf1"] = pbr("leaf_a", (0.05, 0.16, 0.05), 0.85)
    M["leaf2"] = pbr("leaf_b", (0.08, 0.22, 0.07), 0.85)
    M["bark"] = pbr("bark", (0.09, 0.06, 0.04), 0.9)
    M["ad"] = pbr("adpanel", (0.9, 0.9, 1), 0.3, emit=(0.6, 0.85, 1.0), emit_strength=2.5)
    M["glass_pane"] = pbr("shelter_glass", (0.5, 0.65, 0.75), 0.05, 0.0, alpha=0.18)
    M["concrete_barrier"] = pbr("barrier", (0.5, 0.5, 0.48), 0.9)
    M["stripe"] = pbr("barrier_stripe", (0.9, 0.55, 0.05), 0.7)
    M["crate"] = pbr("crate", (0.35, 0.22, 0.1), 0.85)
    M["steam"] = pbr("vent_grate", (0.03, 0.03, 0.035), 0.5, 0.9)
    M["bulb"] = pbr("string_bulb", (1, 0.85, 0.5), 0.3, emit=(1, 0.75, 0.35), emit_strength=5)
    M["fruit_r"] = pbr("fruit_red", (0.6, 0.05, 0.03), 0.6)
    M["fruit_g"] = pbr("fruit_green", (0.1, 0.4, 0.05), 0.6)
    M["fruit_y"] = pbr("fruit_yellow", (0.8, 0.6, 0.05), 0.6)
    M["awn_r"] = pbr("awning_red", (0.45, 0.04, 0.05), 0.85)
    M["awn_b"] = pbr("awning_blue", (0.05, 0.12, 0.4), 0.85)
    M["awn_g"] = pbr("awning_green", (0.05, 0.3, 0.14), 0.85)
    return M


# ---------------------------------------------------------------------------------------
# Building helpers
# ---------------------------------------------------------------------------------------
def wall_side(mb, x0, y0, x1, y1, z0, z1, mat, tw, th, zref, uoff=0.0):
    """Four wall quads with world-metre UVs (u along the wall, v up)."""
    for (a, b, n) in (
        ((x1, y0), (x1, y1), (1, 0)),
        ((x1, y1), (x0, y1), (0, 1)),
        ((x0, y1), (x0, y0), (-1, 0)),
        ((x0, y0), (x1, y0), (0, -1)),
    ):
        rx, ry = -n[1], n[0]
        ua = (a[0] * rx + a[1] * ry) / tw + uoff
        ub = (b[0] * rx + b[1] * ry) / tw + uoff
        va, vb = (z0 - zref) / th, (z1 - zref) / th
        mb.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat,
                [(ua, va), (ub, va), (ub, vb), (ua, vb)])


def roof_top(mb, x0, y0, x1, y1, z, mat):
    mb.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat,
            [(x0 / 8, y0 / 8), (x1 / 8, y0 / 8), (x1 / 8, y1 / 8), (x0 / 8, y1 / 8)])


def parapet(mb, x0, y0, x1, y1, z, M, h=0.9, t=0.35):
    for (a, b, c, d) in ((x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1), (x0, y0 + t, x0 + t, y1 - t), (x1 - t, y0 + t, x1, y1 - t)):
        mb.box(a, b, z, c, d, z + h, M["trim"])


def ac_unit(mb, x, y, z, M, s=1.0):
    mb.box(x - 1.1 * s, y - 0.8 * s, z, x + 1.1 * s, y + 0.8 * s, z + 1.1 * s, M["metal"])
    mb.cyl(x - 0.55 * s, y, z + 1.1 * s, z + 1.25 * s, 0.0, 0.5 * s, M["darkmetal"], 14, cap_top=True)
    mb.cyl(x + 0.55 * s, y, z + 1.1 * s, z + 1.25 * s, 0.0, 0.5 * s, M["darkmetal"], 14, cap_top=True)


def water_tank(mb, x, y, z, M):
    for dx in (-1.3, 1.3):
        for dy in (-1.3, 1.3):
            mb.box(x + dx - 0.1, y + dy - 0.1, z, x + dx + 0.1, y + dy + 0.1, z + 3.0, M["darkmetal"])
    mb.cyl(x, y, z + 3.0, z + 6.2, 1.9, 1.9, M["tank"], 20, cap_top=False, cap_bot=True)
    for zz in (3.8, 4.8, 5.8):
        mb.cyl(x, y, z + zz, z + zz + 0.12, 1.95, 1.95, M["darkmetal"], 20, cap_top=False)
    mb.cyl(x, y, z + 6.2, z + 7.3, 1.9, 0.1, M["tank"], 20, cap_top=True)


def antenna(mb, x, y, z, h, M):
    mb.cyl(x, y, z, z + h, 0.22, 0.05, M["metal"], 8)
    for k in (0.5, 0.7):
        mb.box(x - 1.5, y - 0.05, z + h * k, x + 1.5, y + 0.05, z + h * k + 0.08, M["metal"])
    mb.cyl(x, y, z + h, z + h + 0.5, 0.18, 0.18, M["beacon"], 8)


def awning(mb, x0, x1, y, z, depth, mat, out=1):
    """Sloped shop awning on a wall at y, projecting to +y (out=1) or -y (out=-1)."""
    y2 = y + depth * out
    top = z + 0.2
    mb.face([(x0, y, z + 0.9), (x1, y, z + 0.9), (x1, y2, z + 0.05), (x0, y2, z + 0.05)][::out], mat)
    mb.face([(x0, y2, z + 0.05), (x1, y2, z + 0.05), (x1, y2, z - 0.3), (x0, y2, z - 0.3)][::out], mat)
    mb.face([(x0, y, z + 0.9), (x0, y2, z + 0.05), (x0, y, z + 0.05)][::-out], mat)
    mb.face([(x1, y, z + 0.9), (x1, y, z + 0.05), (x1, y2, z + 0.05)][::-out], mat)


def fire_escape(mb, x, y0, floors, M, side=1):
    """Zig-zag fire escape hanging on the +/-Y face at x; side=+1 → +Y face."""
    z = GROUND_H
    w = 3.0
    d = 1.3
    for f in range(1, floors):
        zf = z + f * FLOOR_H
        ya, yb = y0, y0 + d * side
        mb.box(x - w / 2, min(ya, yb), zf - 0.12, x + w / 2, max(ya, yb), zf - 0.04, M["metal"])
        # railing
        mb.box(x - w / 2, yb - 0.03 * side, zf, x + w / 2, yb + 0.03 * side, zf + 0.05, M["darkmetal"])
        mb.box(x - w / 2, yb - 0.03 * side, zf, x + w / 2, yb + 0.03 * side, zf + 1.0, M["darkmetal"])
        for k in range(5):
            xx = x - w / 2 + k * w / 4
            mb.box(xx - 0.02, yb - 0.02, zf, xx + 0.02, yb + 0.02, zf + 1.0, M["darkmetal"])
        # stairs down to previous platform
        steps = 9
        for s in range(steps):
            t = s / steps
            yy = yb - side * (0.3 + t * 0.5)
            zz = zf - 0.12 - t * (FLOOR_H - 0.2)
            mb.box(x + w / 2 - 1.05, min(yy, yy - 0.28 * side), zz - 0.04, x + w / 2 - 0.1, max(yy, yy - 0.28 * side), zz, M["metal"])


def balconies(mb, x0, y0, x1, y1, floors, M, rng):
    """Slab balconies on the +Y and -Y faces, every second bay."""
    for f in range(1, floors):
        zf = GROUND_H + f * FLOOR_H
        for face_y, out in ((y1, 1), (y0, -1)):
            for bx in (-12, -4, 4, 12):
                if rng.random() < 0.55:
                    ya, yb = face_y, face_y + 1.5 * out
                    mb.box(bx - 1.6, min(ya, yb), zf - 0.15, bx + 1.6, max(ya, yb), zf, M["trim"])
                    mb.box(bx - 1.6, yb - 0.03, zf, bx + 1.6, yb + 0.03, zf + 1.0, M["darkmetal"])
                    mb.box(bx - 1.6, min(ya, yb), zf, bx - 1.55, max(ya, yb), zf + 1.0, M["darkmetal"])
                    mb.box(bx + 1.55, min(ya, yb), zf, bx + 1.6, max(ya, yb), zf + 1.0, M["darkmetal"])


def ledge(mb, x0, y0, x1, y1, z, M, out=0.35, h=0.4):
    mb.box(x0 - out, y0 - out, z, x1 + out, y1 + out, z + h, M["trim"])


def wall_details(mb, M, hx, hy, z0, z1, rng, density=0.5):
    """Window AC units, drain pipes and cable runs bolted to the four walls."""
    for (nx, ny) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        tx, ty = -ny, nx
        wx, wy = (hx if nx else hy), (hy if ny else hx)
        # drain pipe near one corner
        px, py = nx * (hx + 0.12) + tx * (hy - 0.6), ny * (hy + 0.12) + ty * (hx - 0.6)
        mb.cyl(px, py, 0, z1, 0.09, 0.09, M["darkmetal"], 8, cap_top=True)
        floors = int((z1 - z0) / FLOOR_H)
        for f in range(1, floors):
            for col in range(-3, 4):
                if rng.random() > density * 0.22:
                    continue
                zc = z0 + f * FLOOR_H + 0.7
                off = col * 4.0 + 1.3
                if abs(off) > (hy if nx else hx) - 2:
                    continue
                cx, cy = nx * (hx + 0.3) + tx * off, ny * (hy + 0.3) + ty * off
                sx, sy = (0.3, 0.45) if nx else (0.45, 0.3)
                mb.box(cx - sx, cy - sy, zc, cx + sx, cy + sy, zc + 0.55, M["metal"])
                mb.box(cx - sx * 0.6, cy - sy * 0.6, zc + 0.55, cx + sx * 0.6, cy + sy * 0.6, zc + 0.62, M["darkmetal"])


def tier(mb, M, fac, x0, y0, x1, y1, z0, z1, uoff, first=False):
    """One building tier: (optional) storefront band, facade, roof slab."""
    zb = z0
    if first:
        wall_side(mb, x0, y0, x1, y1, 0, GROUND_H, M["store"], 16, GROUND_H, 0, uoff)
        ledge(mb, x0, y0, x1, y1, GROUND_H - 0.05, M, 0.3, 0.45)
        zb = GROUND_H + 0.4
    wall_side(mb, x0, y0, x1, y1, zb, z1, M[fac], 16, 14, GROUND_H + 0.4 if first else z0, uoff)
    roof_top(mb, x0, y0, x1, y1, z1, M["roof"])


def build_glass(M, rng):
    mb = MB("bld_glass")
    tier(mb, M, "glass", -16, -16, 16, 16, 0, GROUND_H + 0.4 + 13 * FLOOR_H, 0.0, True)
    z1 = GROUND_H + 0.4 + 13 * FLOOR_H
    parapet(mb, -16, -16, 16, 16, z1, M)
    tier(mb, M, "glass", -12, -12, 12, 12, z1, z1 + 7 * FLOOR_H, 0.25)
    z2 = z1 + 7 * FLOOR_H
    parapet(mb, -12, -12, 12, 12, z2, M)
    tier(mb, M, "glass", -8, -8, 8, 8, z2, z2 + 4 * FLOOR_H, 0.5)
    z3 = z2 + 4 * FLOOR_H
    ac_unit(mb, -4, -2, z3, M)
    ac_unit(mb, 3.5, 3, z3, M, 0.8)
    mb.box(-3, -6, z3, 1, -3, z3 + 3, M["trim"])
    antenna(mb, 0, 0, z3, 22, M)
    awning(mb, -12, -2, 16.05, 5, 2.4, M["awn_b"], 1)
    return mb.finish()


def build_brick(M, rng):
    mb = MB("bld_brick")
    h = GROUND_H + 0.4 + 6 * FLOOR_H
    tier(mb, M, "brick", -15, -15, 15, 15, 0, h, 0.0, True)
    parapet(mb, -15, -15, 15, 15, h, M, 1.0, 0.45)
    ledge(mb, -15, -15, 15, 15, h - 0.6, M, 0.25, 0.3)
    water_tank(mb, -6, -5, h, M)
    ac_unit(mb, 7, 6, h, M, 0.9)
    mb.box(5, -11, h, 10, -7, h + 3, M["trim"])
    fire_escape(mb, 6, 15.0, 6, M, 1)
    wall_details(mb, M, 15, 15, GROUND_H + 0.4, h, rng, 0.9)
    awning(mb, -13, -3, 15.05, 5, 2.2, M["awn_r"], 1)
    awning(mb, 3, 12, -15.05, 5, 2.2, M["awn_g"], -1)
    return mb.finish()


def build_concrete(M, rng):
    mb = MB("bld_concrete")
    h = GROUND_H + 0.4 + 10 * FLOOR_H
    tier(mb, M, "concrete", -16, -16, 16, 16, 0, h, 0.125, True)
    parapet(mb, -16, -16, 16, 16, h, M)
    wall_details(mb, M, 16, 16, GROUND_H + 0.4, h, rng, 0.8)
    mb.box(-6, -6, h, 8, 6, h + 4.5, M["trim"])  # penthouse
    for (x, y) in ((-11, -10), (-11, 0), (-11, 9), (11, -9), (12, 9)):
        ac_unit(mb, x, y, h, M)
    mb.cyl(11, 0, h, h + 5, 0.6, 0.6, M["metal"], 12)
    antenna(mb, 4, 3, h + 4.5, 9, M)
    awning(mb, -14, -6, 16.05, 5, 2.4, M["awn_b"], 1)
    awning(mb, 4, 14, 16.05, 5, 2.4, M["awn_r"], 1)
    return mb.finish()


def build_deco(M, rng):
    mb = MB("bld_deco")
    z = GROUND_H + 0.4 + 9 * FLOOR_H
    tier(mb, M, "deco", -15, -15, 15, 15, 0, z, 0.0, True)
    ledge(mb, -15, -15, 15, 15, z - 0.3, M, 0.5, 0.6)
    tier(mb, M, "deco", -11, -11, 11, 11, z, z + 6 * FLOOR_H, 0.25)
    z2 = z + 6 * FLOOR_H
    ledge(mb, -11, -11, 11, 11, z2 - 0.3, M, 0.4, 0.5)
    tier(mb, M, "deco", -7, -7, 7, 7, z2, z2 + 4 * FLOOR_H, 0.5)
    z3 = z2 + 4 * FLOOR_H
    ledge(mb, -7, -7, 7, 7, z3 - 0.3, M, 0.35, 0.45)
    mb.cyl(0, 0, z3, z3 + 9, 4.0, 3.2, M["deco"], 8, cap_top=False)
    mb.cyl(0, 0, z3 + 9, z3 + 20, 3.2, 0.25, M["metal"], 8, cap_top=True)
    mb.cyl(0, 0, z3 + 20, z3 + 21, 0.25, 0.25, M["beacon"], 8)
    awning(mb, -12, -2, 15.05, 5, 2.4, M["awn_g"], 1)
    return mb.finish()


def build_lowrise(M, rng):
    mb = MB("bld_lowrise")
    h = GROUND_H + 0.4 + 3 * FLOOR_H
    tier(mb, M, "concrete", -16, -16, 16, 16, 0, h, 0.0, True)
    wall_details(mb, M, 16, 16, GROUND_H + 0.4, h, rng, 0.7)
    parapet(mb, -16, -16, 16, 16, h, M, 1.1)
    for (x, y) in ((-10, -5), (-4, 8), (9, -8), (11, 9)):
        ac_unit(mb, x, y, h, M, 1.1)
    # billboard frame on the roof facing +Y
    for x in (-10, 10):
        mb.box(x - 0.25, 10, h, x + 0.25, 10.5, h + 6.5, M["darkmetal"])
    mb.box(-13, 10, h + 5, 13, 10.5, h + 11, M["darkmetal"])
    mb.box(-12.5, 10.5, h + 5.4, 12.5, 10.55, h + 10.6, M["ad"])
    mb.box(-13, 9, h + 3, 13, 9.4, h + 4, M["darkmetal"])
    water_tank(mb, 3, -8, h, M)
    awning(mb, -14, -2, 16.05, 5, 2.4, M["awn_r"], 1)
    return mb.finish()


def build_resi(M, rng):
    mb = MB("bld_resi")
    h = GROUND_H + 0.4 + 11 * FLOOR_H
    tier(mb, M, "deco", -15, -15, 15, 15, 0, h, 0.125, True)
    parapet(mb, -15, -15, 15, 15, h, M)
    balconies(mb, -15, -15, 15, 15, 11, M, rng)
    wall_details(mb, M, 15, 15, GROUND_H + 0.4, h, rng, 0.35)
    mb.box(-4, -4, h, 6, 5, h + 3.4, M["trim"])
    ac_unit(mb, -9, -8, h, M)
    ac_unit(mb, 9, 8, h, M)
    water_tank(mb, 8, -7, h, M)
    antenna(mb, -8, 6, h, 12, M)
    awning(mb, -12, -3, 15.05, 5, 2.2, M["awn_g"], 1)
    return mb.finish()


def build_signs(M):
    """16 blade signs cut from the neon atlas (each a thin double-sided panel)."""
    out = []
    for i in range(16):
        mb = MB(f"neon_{i:02d}")
        cx, cy = (i % 4) / 4, 1 - (i // 4 + 1) / 4
        u0, v0, u1, v1 = cx + 0.01, cy + 0.01, cx + 0.24, cy + 0.24
        w, h = 1.7, 1.7
        # front (+Y) and back (-Y)
        mb.face([(-w / 2, 0.08, 0), (w / 2, 0.08, 0), (w / 2, 0.08, h), (-w / 2, 0.08, h)], M["neon"], [(u1, v0), (u0, v0), (u0, v1), (u1, v1)])
        mb.face([(w / 2, -0.08, 0), (-w / 2, -0.08, 0), (-w / 2, -0.08, h), (w / 2, -0.08, h)], M["neon"], [(u1, v0), (u0, v0), (u0, v1), (u1, v1)])
        mb.box(-w / 2, -0.08, -0.05, w / 2, 0.08, 0.0, M["darkmetal"], bottom=None)
        mb.box(-w / 2, -0.08, h, w / 2, 0.08, h + 0.05, M["darkmetal"])
        mb.box(-w / 2 - 0.04, -0.08, 0, -w / 2, 0.08, h, M["darkmetal"])
        mb.box(w / 2, -0.08, 0, w / 2 + 0.04, 0.08, h, M["darkmetal"])
        mb.box(-0.06, 0.08, h * 0.5, 0.06, 0.9, h * 0.5 + 0.1, M["darkmetal"])  # bracket into wall (+Y is toward wall)
        out.append(mb.finish())
    return out


# ---------------------------------------------------------------------------------------
# Ground tile
# ---------------------------------------------------------------------------------------
def build_ground(M):
    mb = MB("ground_tile")
    T = 50.0
    mb.face([(-T, -T, 0), (T, -T, 0), (T, T, 0), (-T, T, 0)], M["asphalt"],
            [(-T / 16, -T / 16), (T / 16, -T / 16), (T / 16, T / 16), (-T / 16, T / 16)])
    # a sidewalk platform with rounded corners
    B, r, hz = 40.0, 5.0, 0.16
    pts = C.rounded_rect(-B, -B, B, B, r, 8)
    n = len(pts)
    # top: triangle fan
    ctr = (0, 0, hz)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        mb.face([(a[0], a[1], hz), (b[0], b[1], hz), ctr], M["sidewalk"], [(a[0] / 6, a[1] / 6), (b[0] / 6, b[1] / 6), (0, 0)])
        # curb face
        mb.face([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], hz), (a[0], a[1], hz)], M["curb"])
    # lane markings (lifted 1 cm)
    z = 0.012
    R = 10.0
    def strip(x0, y0, x1, y1, mat):
        mb.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat)

    # double yellow on +x and +z roads (owned by this tile), leaving the intersection clear
    for c in (-0.18, 0.18):
        strip(50 + c - 0.06, -34, 50 + c + 0.06, 34, M["yellow_line"])
        strip(-34, 50 + c - 0.06, 34, 50 + c + 0.06, M["yellow_line"])
    # dashed white lane dividers on all four half-roads
    for k in range(-34, 34, 8):
        strip(45 - 0.07, k, 45 + 0.07, k + 4, M["white_line"])
        strip(-45 - 0.07, k, -45 + 0.07, k + 4, M["white_line"])
        strip(k, 45 - 0.07, k + 4, 45 + 0.07, M["white_line"])
        strip(k, -45 - 0.07, k + 4, -45 + 0.07, M["white_line"])
    # edge lines beside curbs
    for s in (-1, 1):
        strip(s * 41.2 - 0.06, -34, s * 41.2 + 0.06, 34, M["white_line"])
        strip(-34, s * 41.2 - 0.06, 34, s * 41.2 + 0.06, M["white_line"])
    # zebra crossings (each tile draws its own half of every crossing)
    for s in (-1, 1):
        for t in (-1, 1):
            # road along Z on +/-x side, crossing at the +/-z end
            for i in range(9):
                xx = s * (41.0 + i * 1.0)
                if abs(xx) <= 50:
                    strip(min(xx, xx + s * 0.55), t * 41.2, max(xx, xx + s * 0.55), t * 45.0, M["white_line"])
            for i in range(9):
                yy = s * (41.0 + i * 1.0)
                if abs(yy) <= 50:
                    strip(t * 41.2, min(yy, yy + s * 0.55), t * 45.0, max(yy, yy + s * 0.55), M["white_line"])
            # stop lines
            strip(s * 46.0, t * 47.0, s * 49.6, t * 47.5, M["white_line"])
    # manholes & drains
    rng = random.Random(9)
    for (x, y) in ((47, -20), (-46, 15), (12, 46), (-22, -47), (43, 30), (-41.5, -30)):
        mb.cyl(x, y, z, z + 0.01, 0.42, 0.42, M["manhole"], 14, cap_top=True)
    for s in (-1, 1):
        for k in (-22, 22):
            mb.box(s * 40.4 - 0.3, k - 0.5, 0.005, s * 40.4 + 0.3, k + 0.5, 0.02, M["manhole"])
            mb.box(k - 0.5, s * 40.4 - 0.3, 0.005, k + 0.5, s * 40.4 + 0.3, 0.02, M["manhole"])
    return mb.finish()


# ---------------------------------------------------------------------------------------
# Props (origin on the ground)
# ---------------------------------------------------------------------------------------
def build_props(M):
    objs = []

    # street light: tapered pole, curved arm reaching toward +Y (the road)
    mb = MB("prop_streetlight")
    mb.cyl(0, 0, 0, 0.5, 0.28, 0.28, M["darkmetal"], 10, cap_top=False)
    mb.cyl(0, 0, 0.5, 9.0, 0.16, 0.09, M["darkmetal"], 10, cap_top=True)
    for i in range(6):
        a0, a1 = i / 6, (i + 1) / 6
        ya, yb = 2.6 * math.sin(a0 * 1.2) * 1.0, 2.6 * math.sin(a1 * 1.2)
        za, zb = 9.0 + 0.5 * a0 ** 2, 9.0 + 0.5 * a1 ** 2
        mb.box(-0.045, min(ya, yb) - 0.02, min(za, zb), 0.045, max(ya, yb) + 0.02, max(za, zb) + 0.09, M["darkmetal"])
    mb.box(-0.32, 2.2, 9.35, 0.32, 3.4, 9.55, M["darkmetal"])
    mb.box(-0.26, 2.3, 9.3, 0.26, 3.3, 9.36, M["lamp"])
    objs.append(mb.finish())

    # traffic signal on a mast arm
    mb = MB("prop_signal")
    mb.cyl(0, 0, 0, 6.2, 0.16, 0.11, M["darkmetal"], 10)
    mb.box(-0.06, 0, 5.9, 0.06, 6.5, 6.05, M["darkmetal"])
    for y in (3.0, 6.0):
        mb.box(-0.2, y - 0.2, 5.0, 0.2, y + 0.2, 5.9, M["sig_case"])
        for k, m in enumerate((M["sig_red"], M["sig_amber"], M["sig_green"])):
            yy = y + 0.2
            mb.box(-0.1, yy, 5.72 - k * 0.28 - 0.09, 0.1, yy + 0.04, 5.72 - k * 0.28 + 0.09, m if k == 2 else M["sig_case"])
    objs.append(mb.finish())
    mb = MB("prop_signal_red")
    mb.cyl(0, 0, 0, 6.2, 0.16, 0.11, M["darkmetal"], 10)
    mb.box(-0.06, 0, 5.9, 0.06, 6.5, 6.05, M["darkmetal"])
    for y in (3.0, 6.0):
        mb.box(-0.2, y - 0.2, 5.0, 0.2, y + 0.2, 5.9, M["sig_case"])
        for k, m in enumerate((M["sig_red"], M["sig_amber"], M["sig_green"])):
            yy = y + 0.2
            mb.box(-0.1, yy, 5.72 - k * 0.28 - 0.09, 0.1, yy + 0.04, 5.72 - k * 0.28 + 0.09, m if k == 0 else M["sig_case"])
    objs.append(mb.finish())

    # hydrant
    mb = MB("prop_hydrant")
    mb.cyl(0, 0, 0, 0.12, 0.2, 0.2, M["red"], 12, cap_top=False)
    mb.cyl(0, 0, 0.12, 0.62, 0.14, 0.14, M["red"], 12)
    mb.cyl(0, 0, 0.62, 0.78, 0.17, 0.11, M["red"], 12)
    mb.cyl(0, 0, 0.3, 0.46, 0.09, 0.09, M["red"], 10, axis="x")
    mb.cyl(0, 0, 0.3, 0.46, 0.09, 0.09, M["red"], 10, axis="y")
    objs.append(mb.finish())

    # mailbox
    mb = MB("prop_mailbox")
    mb.box(-0.3, -0.25, 0, 0.3, 0.25, 1.1, M["blue"])
    mb.box(-0.32, -0.27, 1.1, 0.32, 0.27, 1.16, M["blue"])
    objs.append(mb.finish())

    # trash bin
    mb = MB("prop_bin")
    mb.cyl(0, 0, 0, 0.9, 0.34, 0.4, M["darkmetal"], 12)
    mb.cyl(0, 0, 0.9, 0.98, 0.42, 0.42, M["metal"], 12)
    objs.append(mb.finish())

    # dumpster
    mb = MB("prop_dumpster")
    mb.box(-1.6, -0.9, 0.25, 1.6, 0.9, 1.5, M["green_bin"])
    mb.box(-1.65, -0.95, 1.5, 1.65, 0.95, 1.6, M["darkmetal"])
    for x in (-1.3, 1.3):
        mb.box(x - 0.1, -0.7, 0, x + 0.1, -0.5, 0.3, M["darkmetal"])
        mb.box(x - 0.1, 0.5, 0, x + 0.1, 0.7, 0.3, M["darkmetal"])
    objs.append(mb.finish())

    # bench
    mb = MB("prop_bench")
    mb.box(-1.0, -0.25, 0.42, 1.0, 0.25, 0.48, M["wood"])
    mb.box(-1.0, 0.25, 0.5, 1.0, 0.31, 0.95, M["wood"])
    for x in (-0.9, 0.9):
        mb.box(x - 0.04, -0.25, 0, x + 0.04, 0.3, 0.42, M["darkmetal"])
    objs.append(mb.finish())

    # bus shelter with lit ad panel
    mb = MB("prop_shelter")
    mb.box(-2.1, -0.75, 2.5, 2.1, 0.75, 2.62, M["darkmetal"])
    for x in (-2.0, 2.0):
        mb.box(x - 0.05, -0.75, 0, x + 0.05, -0.7, 2.5, M["darkmetal"])
        mb.box(x - 0.05, 0.7, 0, x + 0.05, 0.75, 2.5, M["darkmetal"])
    mb.box(-2.0, 0.7, 0.25, 2.0, 0.72, 2.5, M["glass_pane"])
    mb.box(-2.0, -0.72, 0.25, -1.0, -0.7, 2.5, M["glass_pane"])
    mb.box(0.9, -0.74, 0.3, 1.95, -0.66, 2.3, M["ad"])
    mb.box(-1.5, 0.3, 0.42, 1.0, 0.65, 0.48, M["wood"])
    objs.append(mb.finish())

    # parking meter
    mb = MB("prop_meter")
    mb.cyl(0, 0, 0, 1.15, 0.035, 0.035, M["darkmetal"], 8)
    mb.box(-0.1, -0.08, 1.15, 0.1, 0.08, 1.45, M["metal"])
    mb.box(-0.06, 0.08, 1.3, 0.06, 0.09, 1.4, M["led"])
    objs.append(mb.finish())

    # traffic cone
    mb = MB("prop_cone")
    mb.box(-0.22, -0.22, 0, 0.22, 0.22, 0.04, M["darkmetal"])
    mb.cyl(0, 0, 0.04, 0.7, 0.16, 0.035, M["orange"], 12)
    mb.cyl(0, 0, 0.38, 0.5, 0.098, 0.078, M["white"], 12, cap_top=False)
    objs.append(mb.finish())

    # concrete jersey barrier
    mb = MB("prop_barrier")
    mb.box(-1.5, -0.3, 0, 1.5, 0.3, 0.25, M["concrete_barrier"])
    mb.box(-1.5, -0.2, 0.25, 1.5, 0.2, 0.8, M["concrete_barrier"])
    mb.box(-1.5, 0.19, 0.4, 1.5, 0.21, 0.55, M["stripe"])
    objs.append(mb.finish())

    # bollard
    mb = MB("prop_bollard")
    mb.cyl(0, 0, 0, 0.9, 0.09, 0.09, M["darkmetal"], 10)
    mb.cyl(0, 0, 0.75, 0.82, 0.095, 0.095, M["led"], 10, cap_top=False)
    objs.append(mb.finish())

    # street tree (trunk + 3 lumpy canopies)
    rng = random.Random(3)
    mb = MB("prop_tree")
    mb.cyl(0, 0, 0, 3.6, 0.28, 0.16, M["bark"], 8)
    mb.cyl(0, 0, 0, 0.3, 0.5, 0.5, M["darkmetal"], 10, cap_top=False)
    for (x, y, z, r, m) in ((0, 0, 5.4, 2.7, "leaf1"), (1.3, 0.4, 4.6, 1.9, "leaf2"), (-1.2, -0.5, 4.9, 2.0, "leaf2"), (0.2, 1.1, 6.6, 1.6, "leaf1"), (-0.3, -1.0, 6.4, 1.7, "leaf2")):
        seg, rings = 14, 9
        for j in range(rings):
            for i in range(seg):
                def vp(ii, jj):
                    th = math.pi * jj / rings
                    ph = 2 * math.pi * ii / seg
                    k = 1 + 0.07 * math.sin(ph * 3 + th * 2.4 + x * 3) + 0.04 * math.sin(ph * 5 - th * 3 + y * 2)
                    return (x + r * k * math.sin(th) * math.cos(ph), y + r * k * math.sin(th) * math.sin(ph), z + r * 0.85 * k * math.cos(th))
                a, b, c, d = vp(i, j), vp(i + 1, j), vp(i + 1, j + 1), vp(i, j + 1)
                if j == 0:
                    mb.face([a, d, c], M[m], None, True)
                elif j == rings - 1:
                    mb.face([a, c, b], M[m], None, True)
                else:
                    mb.face([a, d, c, b], M[m], None, True)
    objs.append(mb.finish(weld=True))   # weld so the canopy shades smoothly

    # planter
    mb = MB("prop_planter")
    mb.box(-0.6, -0.6, 0, 0.6, 0.6, 0.55, M["concrete_barrier"])
    mb.cyl(0, 0, 0.55, 0.85, 0.5, 0.45, M["leaf1"], 8)
    objs.append(mb.finish())

    # market stall: striped awning, crates of produce, hanging bulbs
    mb = MB("prop_stall")
    for x in (-1.4, 1.4):
        for y in (-0.9, 0.9):
            mb.box(x - 0.04, y - 0.04, 0, x + 0.04, y + 0.04, 2.4 if y < 0 else 2.0, M["darkmetal"])
    for k in range(8):
        x0 = -1.5 + k * 0.375
        mb.face([(x0, -1.0, 2.45), (x0 + 0.375, -1.0, 2.45), (x0 + 0.375, 1.1, 2.05), (x0, 1.1, 2.05)], M["awn_r"] if k % 2 == 0 else M["white"])
    mb.box(-1.5, -0.6, 0.0, 1.5, 0.6, 0.85, M["crate"])
    for i in range(6):
        x = -1.2 + i * 0.48
        m = (M["fruit_r"], M["fruit_g"], M["fruit_y"])[i % 3]
        mb.cyl(x, 0.0, 0.85, 0.98, 0.2, 0.15, m, 8)
        mb.cyl(x, 0.3, 0.85, 0.98, 0.15, 0.11, m, 8)
    mb.box(-1.4, -0.9, 0.0, -1.0, -0.5, 0.5, M["crate"])
    for i in range(5):
        x = -1.2 + i * 0.6
        mb.cyl(x, -1.0, 2.25, 2.35, 0.07, 0.05, M["bulb"], 8)
    objs.append(mb.finish())

    # scaffolding tower with planks and safety netting
    mb = MB("prop_scaffold")
    for lv in range(4):
        z = lv * 2.0
        for x in (-1.2, 1.2):
            for y in (-0.6, 0.6):
                mb.box(x - 0.03, y - 0.03, z, x + 0.03, y + 0.03, z + 2.0, M["metal"])
        mb.box(-1.25, -0.65, z + 2.0 - 0.05, 1.25, 0.65, z + 2.0, M["wood"])
        for y in (-0.6, 0.6):
            mb.box(-1.2, y - 0.02, z + 1.0, 1.2, y + 0.02, z + 1.04, M["metal"])
        mb.between((-1.2, -0.6, z), (1.2, -0.6, z + 2.0), 0.015, M["metal"], seg=4, caps=False)
    mb.box(-1.22, 0.62, 0.6, 1.22, 0.64, 8.0, M["orange"])
    objs.append(mb.finish())

    # steam vent grate with a stack
    mb = MB("prop_vent")
    mb.box(-0.5, -0.5, 0.0, 0.5, 0.5, 0.03, M["steam"])
    for i in range(7):
        mb.box(-0.45, -0.42 + i * 0.14, 0.03, 0.45, -0.36 + i * 0.14, 0.05, M["darkmetal"])
    mb.cyl(0.9, 0.0, 0.0, 0.9, 0.16, 0.14, M["orange"], 10)
    objs.append(mb.finish())

    # roadwork sign / A-frame
    mb = MB("prop_wet_sign")
    mb.box(-0.3, -0.25, 0, 0.3, -0.2, 0.9, M["orange"])
    mb.box(-0.3, 0.2, 0, 0.3, 0.25, 0.9, M["orange"])
    objs.append(mb.finish())

    return objs


def build():
    M = materials()
    rng = random.Random(42)
    objs = [build_ground(M)]
    for fn in (build_glass, build_brick, build_concrete, build_deco, build_lowrise, build_resi):
        objs.append(fn(M, rng))
    objs += build_signs(M)
    objs += build_props(M)
    return objs
