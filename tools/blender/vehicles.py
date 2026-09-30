"""Police cruiser, civilian sedan, taxi and van -> assets/{police,sedan,taxi,van}.glb

Bodies are lofted from cross-sections, smoothed with subdivision and cut with boolean
wheel arches. Node contract used by the game:
  car_root
    body            paint + glass + trim (materials `paint`, `paint_white`, `glass`, ...)
    wheel_fl / wheel_fr / wheel_rl / wheel_rr   spin about local X
Police materials `pl_red` / `pl_blue` (light bar + grille lights) are flashed by the game,
`taillight` is boosted on braking.
"""
import math

import bpy
from mathutils import Matrix, Vector

import common as C
from common import MB, pbr

TAU = 2 * math.pi


def mats():
    M = {}
    M["paint"] = pbr("paint", (0.6, 0.02, 0.02), 0.28, 0.5, coat=1.0)
    M["black"] = pbr("paint_black", (0.012, 0.013, 0.016), 0.24, 0.5, coat=1.0)
    M["white"] = pbr("paint_white", (0.82, 0.83, 0.85), 0.3, 0.3, coat=1.0)
    M["glass"] = pbr("glass", (0.008, 0.012, 0.018), 0.03, 0.85)
    M["trim"] = pbr("plastic_trim", (0.015, 0.015, 0.017), 0.6)
    M["chrome"] = pbr("chrome", (0.75, 0.76, 0.78), 0.12, 1.0)
    M["tire"] = pbr("tire", (0.02, 0.02, 0.022), 0.85)
    M["rim"] = pbr("rim_alloy", (0.6, 0.61, 0.64), 0.25, 1.0)
    M["rotor"] = pbr("brake_rotor", (0.4, 0.4, 0.42), 0.4, 1.0)
    M["well"] = pbr("wheelwell", (0.01, 0.01, 0.011), 0.9)
    M["head"] = pbr("headlamp", (1, 1, 1), 0.2, emit=(0.92, 0.96, 1.0), emit_strength=10)
    M["tail"] = pbr("taillight", (0.8, 0.02, 0.01), 0.3, emit=(1.0, 0.04, 0.03), emit_strength=3)
    M["amber"] = pbr("indicator", (1, 0.5, 0.05), 0.3, emit=(1, 0.45, 0.04), emit_strength=1.2)
    M["pl_red"] = pbr("pl_red", (1, 0.02, 0.02), 0.2, emit=(1, 0.02, 0.02), emit_strength=0.6)
    M["pl_blue"] = pbr("pl_blue", (0.05, 0.15, 1), 0.2, emit=(0.05, 0.2, 1.0), emit_strength=0.6)
    M["plate"] = pbr("plate", (0.9, 0.9, 0.85), 0.5)
    M["taxi_sign"] = pbr("taxi_sign", (1, 0.85, 0.3), 0.4, emit=(1, 0.8, 0.3), emit_strength=3)
    M["decal"] = pbr("decal_text", (0.01, 0.01, 0.02), 0.5)
    M["decal_w"] = pbr("decal_text_w", (0.9, 0.9, 0.95), 0.5)
    M["blue_stripe"] = pbr("police_blue", (0.02, 0.06, 0.3), 0.4, 0.3, coat=0.8)
    return M


# ---------------------------------------------------------------------------------------
def loft(name, stations, mat, half_profile=None, caps=True):
    """stations: [(y, w, zb, zs, zt), ...] -> closed body shell, symmetric in X."""
    mb = MB(name)
    rings = []
    for (y, w, zb, zs, zt) in stations:
        hp = [(0.0, zb), (w * 0.78, zb), (w * 0.96, zb + 0.10), (w, zb + 0.30), (w, zs - 0.06), (w * 0.965, zs + 0.02),
              (w * 0.86, zt - 0.05), (w * 0.5, zt), (0.0, zt)]
        pts = [(x, y, z) for x, z in hp] + [(-x, y, z) for x, z in reversed(hp[1:-1])]
        rings.append(pts)
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            mb.face([a[i], a[j], b[j], b[i]][::-1], mat)
    if caps:
        mb.face(rings[0], mat)
        mb.face(rings[-1][::-1], mat)
    return mb.finish(weld=True)


def cabin(name, stations, glass, paint):
    """Greenhouse: sections (y, w_base, z_base, w_top, z_top). Roof strip painted, rest glass."""
    mb = MB(name)
    rings = []
    for (y, wb, zb, wt, zt) in stations:
        rings.append([(wb, y, zb), (wt, y, zt), (-wt, y, zt), (-wb, y, zb)])
    for a, b in zip(rings, rings[1:]):
        # right side, roof, left side
        mb.face([a[0], b[0], b[1], a[1]], glass)
        mb.face([a[1], b[1], b[2], a[2]], paint)
        mb.face([a[2], b[2], b[3], a[3]], glass)
    mb.face(rings[0][::-1], glass)   # rear window
    mb.face(rings[-1], glass)        # windscreen
    ob = mb.finish()
    return ob


def wheel_obj(M, name, x, y, z, R=0.36, w=0.24, left=False):
    mb = MB(name)
    tire = [(0.22, -w / 2), (R * 0.86, -w / 2 - 0.004), (R * 0.985, -w / 2 * 0.86), (R, -w * 0.28), (R, w * 0.28), (R * 0.985, w / 2 * 0.86), (R * 0.86, w / 2 + 0.004), (0.22, w / 2)]
    mb.lathe(tire, M["tire"], 40, "x")
    # alloy: barrel + 5 twin spokes + lip
    mb.lathe([(0.225, -w / 2 * 0.9), (0.215, -w / 2 * 0.9), (0.215, w / 2 * 0.9), (0.225, w / 2 * 0.9)], M["rim"], 40, "x")
    face_a = (w / 2) * 0.88 * (-1 if left else 1)
    mb.lathe([(0.0, face_a * 0.88), (0.06, face_a * 0.95), (0.06, face_a)], M["rim"], 20, "x", closed=False)
    for i in range(5):
        a = TAU * i / 5
        for off in (-0.13, 0.13):
            p0 = (face_a, 0.06 * math.cos(a), 0.06 * math.sin(a))
            p1 = (face_a * 0.96, 0.208 * math.cos(a + off), 0.208 * math.sin(a + off))
            mb.between(p0, p1, 0.012, M["rim"], 0.017, seg=5, caps=False)
    # brake disc + caliper behind the spokes
    mb.lathe([(0.11, -0.03), (0.17, -0.03), (0.17, -0.02), (0.11, -0.02)], M["rotor"], 32, "x", closed=True)
    return mb.finish(name)


def text_mesh(txt, size, mat, loc, rot, extrude=0.004):
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = txt
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.materials.append(mat)
    ob = bpy.data.objects.new("t", cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return C.mesh_of_curve(ob)


def bool_arches(body, cutters, well_mat):
    for i, (x, y, z, r) in enumerate(cutters):
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=r, depth=0.42, location=(x, y, z), rotation=(0, math.pi / 2, 0))
        cu = bpy.context.active_object
        cu.name = f"cutter{i}"
        cu.data.materials.append(well_mat)
        md = body.modifiers.new(f"arch{i}", "BOOLEAN")
        md.operation = "DIFFERENCE"
        md.object = cu
        md.solver = "EXACT"
        try:
            md.material_mode = "TRANSFER"
        except Exception:
            pass
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.data.objects.remove(cu)


def finish_body(objs, name):
    for o in objs:
        for p in o.data.polygons:
            p.use_smooth = True
    return C.join(objs, name)


# ---------------------------------------------------------------------------------------
SEDAN = dict(
    L=4.9, W=0.95,
    stations=[(-2.46, 0.80, 0.34, 0.74, 0.86), (-2.36, 0.90, 0.30, 0.82, 0.96), (-2.0, 0.95, 0.27, 0.90, 1.03), (-1.2, 0.965, 0.26, 0.93, 1.03),
              (0.2, 0.965, 0.26, 0.93, 0.99), (1.0, 0.955, 0.26, 0.92, 0.98), (1.7, 0.94, 0.27, 0.85, 0.90), (2.25, 0.91, 0.29, 0.79, 0.83), (2.47, 0.82, 0.34, 0.68, 0.72)],
    cabin=[(-1.32, 0.84, 1.0, 0.60, 1.30), (-0.85, 0.88, 1.02, 0.66, 1.43), (-0.1, 0.885, 1.02, 0.70, 1.47), (0.55, 0.885, 1.0, 0.70, 1.47), (1.02, 0.86, 0.99, 0.64, 1.36), (1.42, 0.83, 0.97, 0.58, 1.06)],
    front=1.46, rear=-1.42,
)


def car(kind, M):
    P = SEDAN
    police = kind == "police"
    paint = M["black"] if police else M["paint"]
    body = loft("shell", P["stations"], paint)
    body.modifiers.new("sub", "SUBSURF").levels = 2
    C.to_mesh_obj(body)
    R = 0.37
    bool_arches(body, [(sx * 0.86, y, R, R + 0.09) for y in (P["front"], P["rear"]) for sx in (-1, 1)], M["well"])
    # paint the doors white on the police car (faces on the side panels between the wheel arches)
    if police:
        body.data.materials.append(M["white"])
        wi = len(body.data.materials) - 1
        for p in body.data.polygons:
            c = p.center
            if abs(p.normal.x) > 0.55 and abs(c.x) > 0.8 and -1.05 < c.y < 1.0 and 0.50 < c.z < 0.92:
                p.material_index = wi
    parts = [body]
    cb = cabin("cabin", P["cabin"], M["glass"], paint)
    parts.append(cb)
    # pillars, bumpers, grille, lights, mirrors, plates
    mb = MB("details")
    T = M["trim"]
    for s in (-1, 1):
        mb.between((0.86 * s, 1.02, 0.99), (0.64 * s, 1.02, 1.36), 0.022, paint, seg=6)      # A-pillar
        mb.between((0.885 * s, -0.10, 1.02), (0.70 * s, -0.10, 1.47), 0.03, paint, seg=6)    # B-pillar
        mb.between((0.84 * s, -1.32, 1.0), (0.60 * s, -1.32, 1.30), 0.04, paint, seg=6)      # C-pillar
        # mirrors
        mb.between((0.90 * s, 0.98, 1.05), (1.07 * s, 0.94, 1.09), 0.02, T, seg=6)
        # door handles
        for y in (0.35, -0.75):
            mb.box(0.955 * s - 0.01, y - 0.09, 0.93, 0.955 * s + 0.02, y + 0.09, 0.96, M["chrome"])
        # headlights, taillights, indicators
        mb.box(min(0.52 * s, 0.85 * s), 2.22, 0.66, max(0.52 * s, 0.85 * s), 2.40, 0.74, M["head"])
        mb.box(min(0.62 * s, 0.86 * s), -2.34, 0.78, max(0.62 * s, 0.86 * s), -2.46, 0.86, M["tail"])
        mb.box(min(0.86 * s, 0.9 * s), 2.20, 0.64, max(0.86 * s, 0.9 * s), 2.34, 0.70, M["amber"])
        # exhaust tips
        mb.between((0.55 * s, -2.42, 0.33), (0.55 * s, -2.52, 0.33), 0.045, M["chrome"], seg=10)
    # bumpers (lower trim) and grille
    mb.box(-0.80, 2.30, 0.30, 0.80, 2.50, 0.48, T)
    mb.box(-0.28, 2.42, 0.52, 0.28, 2.50, 0.66, T)
    mb.box(-0.75, -2.36, 0.30, 0.75, -2.50, 0.46, T)
    mb.box(-0.9, -2.3, 0.22, 0.9, 2.4, 0.27, T)   # underbody
    # panel gaps, belt-line chrome, grille slats, headlight bezels, wipers, antenna, fuel cap
    for sx in (-1, 1):
        for y in (-1.05, -0.10, 0.98):
            mb.box(0.962 * sx - 0.006, y - 0.006, 0.50, 0.962 * sx + 0.006, y + 0.006, 0.95, M["well"])
        mb.box(0.966 * sx - 0.004, -1.9, 0.955, 0.966 * sx + 0.004, 1.75, 0.968, M["chrome"])
        mb.box(min(0.5 * sx, 0.88 * sx), 2.36, 0.64, max(0.5 * sx, 0.88 * sx), 2.40, 0.77, M["well"])   # bezel
        mb.box(0.82 * sx - 0.03, -1.55, 0.84, 0.82 * sx + 0.03, -1.50, 0.92, M["chrome"])              # fuel cap
        mb.between((0.05 * sx, 1.26, 1.08), (0.58 * sx, 1.40, 1.13), 0.006, M["well"], seg=4)          # wipers
        mb.box(1.0 * sx - 0.055, 0.90, 1.035, 1.13 * sx + 0.055 * 0, 1.03, 1.115, T)                  # mirror housing
    for k in range(5):
        mb.box(-0.28, 2.505, 0.53 + k * 0.026, 0.28, 2.515, 0.545 + k * 0.026, M["chrome"])
    mb.between((-0.55, -0.95, 1.46), (-0.72, -1.15, 1.98), 0.006, T, seg=4)
    mb.box(-0.45, -2.49, 0.86, -0.36, -2.47, 0.90, M["decal_w"])                                       # reverse lamp
    mb.box(0.36, -2.49, 0.86, 0.45, -2.47, 0.90, M["decal_w"])
    mb.box(-0.9, -0.5, 0.28, -0.85, 0.7, 0.36, T); mb.box(0.85, -0.5, 0.28, 0.9, 0.7, 0.36, T)          # side skirts
    # plates
    mb.box(-0.26, -2.505, 0.60, 0.26, -2.495, 0.72, M["plate"])
    mb.box(-0.26, 2.505, 0.42, 0.26, 2.515, 0.52, M["plate"])
    parts.append(mb.finish())
    if police:
        parts += police_kit(M)
    if kind == "taxi":
        mb = MB("taxisign")
        mb.box(-0.32, -0.25, 1.47, 0.32, 0.25, 1.62, M["taxi_sign"])
        parts.append(mb.finish())
    body = finish_body(parts, "body")
    return body


def police_kit(M):
    out = []
    # roof light bar
    mb = MB("lightbar")
    mb.box(-0.62, -0.42, 1.475, 0.62, -0.08, 1.52, M["trim"])
    mb.box(-0.60, -0.40, 1.52, -0.02, -0.10, 1.60, M["pl_red"])
    mb.box(0.02, -0.40, 1.52, 0.60, -0.10, 1.60, M["pl_blue"])
    mb.box(-0.62, -0.42, 1.60, 0.62, -0.08, 1.63, M["trim"])
    out.append(mb.finish())
    # grille / dash / rear deck strobes, push bar
    mb = MB("strobes")
    mb.box(-0.72, 2.435, 0.60, -0.30, 2.5, 0.66, M["pl_red"])
    mb.box(0.30, 2.435, 0.60, 0.72, 2.5, 0.66, M["pl_blue"])
    mb.box(-0.30, 1.20, 1.03, -0.05, 1.32, 1.06, M["pl_red"])
    mb.box(0.05, 1.20, 1.03, 0.30, 1.32, 1.06, M["pl_blue"])
    mb.box(-0.55, -1.42, 1.03, -0.05, -1.34, 1.06, M["pl_blue"])
    mb.box(0.05, -1.42, 1.03, 0.55, -1.34, 1.06, M["pl_red"])
    for s in (-1, 1):  # mirrors carry lights too
        mb.box(1.02 * s - 0.03, 0.95, 1.08, 1.12 * s + 0.03, 1.0, 1.12, M["pl_red"] if s < 0 else M["pl_blue"])
    for x in (-0.55, 0.55):
        mb.between((x, 2.52, 0.34), (x, 2.55, 0.86), 0.03, M["trim"], seg=8)
    mb.between((-0.55, 2.55, 0.86), (0.55, 2.55, 0.86), 0.03, M["trim"], seg=8)
    mb.between((-0.55, 2.55, 0.42), (0.55, 2.55, 0.42), 0.03, M["trim"], seg=8)
    out.append(mb.finish())
    # A-pillar spotlights
    mb = MB("spot")
    for s in (-1,):
        mb.between((0.83 * s, 1.0, 1.10), (0.98 * s, 1.14, 1.16), 0.03, M["chrome"], seg=8)
    out.append(mb.finish())
    # livery: POLICE on both doors, blue stripe on the rear quarter, unit number on the roof
    for s in (-1, 1):
        rot = (math.pi / 2, 0, math.pi / 2 if s > 0 else -math.pi / 2)
        out.append(text_mesh("POLICE", 0.21, M["decal"], (0.972 * s, 0.10, 0.70), rot))
        out.append(text_mesh("POLICE", 0.10, M["decal_w"], (0.952 * s, -1.95, 0.83), rot))
        mb = MB("stripe")
        mb.box(0.945 * s - 0.006, -1.05, 0.52, 0.945 * s + 0.006, 1.0, 0.56, M["blue_stripe"])
        out.append(mb.finish())
    return out


def van(M):
    stations = [(-2.7, 0.85, 0.40, 1.7, 1.95), (-2.6, 0.94, 0.30, 1.75, 2.05), (-1.5, 0.96, 0.28, 1.78, 2.12), (0.6, 0.96, 0.28, 1.78, 2.12),
                (1.2, 0.95, 0.28, 1.5, 1.95), (1.8, 0.93, 0.29, 1.0, 1.35), (2.4, 0.9, 0.31, 0.85, 0.95), (2.6, 0.82, 0.36, 0.72, 0.8)]
    body = loft("shell", stations, M["paint"])
    body.modifiers.new("sub", "SUBSURF").levels = 2
    C.to_mesh_obj(body)
    R = 0.38
    bool_arches(body, [(sx * 0.87, y, R, R + 0.09) for y in (1.6, -1.55) for sx in (-1, 1)], M["well"])
    parts = [body]
    mb = MB("details")
    T = M["trim"]
    # windscreen + side glass + rear glass
    mb.face([(-0.82, 1.24, 1.42), (0.82, 1.24, 1.42), (0.66, 1.72, 1.10), (-0.66, 1.72, 1.10)][::-1], M["glass"])
    for s in (-1, 1):
        mb.face([(0.965 * s, 0.7, 1.32), (0.965 * s, 1.55, 1.32), (0.955 * s, 1.55, 1.75), (0.965 * s, 0.7, 1.75)][::s], M["glass"])
        mb.box(min(0.5 * s, 0.85 * s), 2.42, 0.64, max(0.5 * s, 0.85 * s), 2.58, 0.72, M["head"])
        mb.box(min(0.7 * s, 0.9 * s), -2.66, 1.0, max(0.7 * s, 0.9 * s), -2.74, 1.30, M["tail"])
        for y in (0.15,):
            mb.box(0.965 * s - 0.01, y - 0.1, 1.05, 0.965 * s + 0.03, y + 0.1, 1.09, M["chrome"])
        mb.between((0.92 * s, 1.3, 1.5), (1.10 * s, 1.24, 1.58), 0.025, T, seg=6)
        mb.box(0.98 * s - 0.03, 1.15, 1.48, 1.14 * s + 0.03, 1.28, 1.72, T)
    mb.box(-0.86, 2.48, 0.30, 0.86, 2.68, 0.50, T)
    mb.box(-0.86, -2.66, 0.30, 0.86, -2.80, 0.50, T)
    mb.box(-0.9, -2.7, 0.22, 0.9, 2.5, 0.27, T)
    mb.box(-0.24, -2.745, 0.6, 0.24, -2.735, 0.72, M["plate"])
    # roof rack ribs and rear doors seam
    mb.box(-0.005, -2.72, 0.5, 0.005, -2.60, 2.0, T)
    parts.append(mb.finish())
    return finish_body(parts, "body")


def build_car(kind):
    M = mats()
    root = C.empty("car_root")
    if kind == "van":
        body = van(M)
        wy = (1.6, -1.55)
        R = 0.38
    else:
        body = car(kind, M)
        wy = (SEDAN["front"], SEDAN["rear"])
        R = 0.37
    body.parent = root
    for name, sx, y in (("wheel_fl", -1, wy[0]), ("wheel_fr", 1, wy[0]), ("wheel_rl", -1, wy[1]), ("wheel_rr", 1, wy[1])):
        x = 0.86 * sx if kind != "van" else 0.87 * sx
        w = wheel_obj(M, name, x, y, R, R=R, left=sx < 0)
        w.parent = root
        w.location = (x, y, R)
    return root


BUILDERS = {
    "police": lambda: build_car("police"),
    "sedan": lambda: build_car("sedan"),
    "taxi": lambda: build_car("taxi"),
    "van": lambda: build_car("van"),
}
