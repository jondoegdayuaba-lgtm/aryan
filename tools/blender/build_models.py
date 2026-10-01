"""
Sky Hopper model builder (Blender 4.x / 5.x, run headless).

Builds the plane, trees and rock procedurally in Blender, then writes:
  - models/sky-hopper/*.glb       (standard glTF files, handy for editing)
  - tools/blender/models.json     (compact quantized mesh data that
                                   tools/blender/embed.py inlines into
                                   sky-hopper.html so the game stays one file)

Run with either:
  blender -b -P tools/blender/build_models.py
  python3 tools/blender/build_models.py        (with `pip install bpy`)

Blender is Z-up with the plane's nose toward +Y. The exporter converts to
three.js axes (Y-up, nose toward -Z): three = (x, z, -y).
"""
import base64
import json
import math
import os
import random
import struct

import bpy  # must come before bmesh/mathutils when running as a Python module
import bmesh
from mathutils import Vector, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_JSON = os.path.join(ROOT, "tools", "blender", "models.json")
OUT_GLB = os.path.join(ROOT, "models", "sky-hopper")

random.seed(7)


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


MATERIAL_COLORS = {
    "Body": (0.9, 0.25, 0.15), "Wing": (0.95, 0.8, 0.2), "Accent": (1, 1, 1),
    "Dark": (0.06, 0.06, 0.08), "Glass": (0.05, 0.12, 0.2), "Metal": (0.7, 0.7, 0.72),
    "Tire": (0.03, 0.03, 0.03), "Bark": (0.25, 0.17, 0.1), "Leaves": (0.15, 0.35, 0.1),
    "Needles": (0.08, 0.22, 0.1), "Rock": (0.45, 0.43, 0.4),
}


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        c = MATERIAL_COLORS.get(name, (0.8, 0.8, 0.8))
        mat.diffuse_color = (*c, 1)
    return mat


def mesh_object(name, bm, materials, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    for m in materials:
        me.materials.append(material(m))
    return obj


def finalize(obj, sharp_deg=50, subsurf=0):
    """Apply an optional subdivision, shade smooth, and mark sharp edges by angle."""
    if subsurf:
        mod = obj.modifiers.new("Subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        obj.modifiers.clear()
        old = obj.data
        obj.data = me
        bpy.data.meshes.remove(old)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.smooth = True
    limit = math.radians(sharp_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0) < limit
        else:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    return obj


def loft(bm, rings, closed_ring=True, cap_start=False, cap_end=False):
    """Connect a list of vertex-position rings with quads. Returns (verts per ring, faces)."""
    vrings = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    faces = []
    for a, b in zip(vrings, vrings[1:]):
        count = n if closed_ring else n - 1
        for i in range(count):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    if cap_start:
        faces.append(bm.faces.new(list(reversed(vrings[0]))))
    if cap_end:
        faces.append(bm.faces.new(vrings[-1]))
    return vrings, faces


def catmull(points, t):
    """Catmull-Rom interpolation through a list of tuples, t in [0, 1]."""
    n = len(points) - 1
    f = min(t * n, n - 1e-6)
    i = int(f)
    u = f - i
    p0 = points[max(i - 1, 0)]
    p1 = points[i]
    p2 = points[min(i + 1, n)]
    p3 = points[min(i + 2, n)]
    out = []
    for k in range(len(p1)):
        a, b, c, d = p0[k], p1[k], p2[k], p3[k]
        out.append(0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3))
    return out


def airfoil(n=14, thickness=0.12, camber=0.02):
    """NACA 4-digit style airfoil loop (x along chord 0..1, z thickness), closed loop."""
    pts_top, pts_bot = [], []
    for i in range(n + 1):
        x = (1 - math.cos(math.pi * i / n)) / 2
        yt = 5 * thickness * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        p = 0.4
        yc = camber / p ** 2 * (2 * p * x - x * x) if x < p else camber / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x)
        pts_top.append((x, yc + yt))
        pts_bot.append((x, yc - yt))
    # loop: trailing edge -> top -> leading edge -> bottom -> back to trailing edge
    loop = list(reversed(pts_top)) + pts_bot[1:-1]
    return loop


# ---------------------------------------------------------------------------
# Plane
# ---------------------------------------------------------------------------
# Fuselage stations: (y, half width, half height, z center)
FUS = [
    (-4.35, 0.05, 0.10, 0.40),
    (-3.70, 0.15, 0.24, 0.32),
    (-2.60, 0.30, 0.40, 0.22),
    (-1.30, 0.45, 0.55, 0.14),
    (0.00, 0.55, 0.66, 0.10),
    (1.10, 0.61, 0.71, 0.10),
    (2.10, 0.63, 0.68, 0.07),
    (2.90, 0.58, 0.58, 0.05),
    (3.30, 0.47, 0.47, 0.05),
    (3.42, 0.33, 0.33, 0.05),
]
SEG = 28


def fuselage_ring(y, w, h, zc, seg=SEG, exp=2.6):
    ring = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c, s = math.cos(a), math.sin(a)
        x = w * math.copysign(abs(c) ** (2 / exp), c)
        z = h * math.copysign(abs(s) ** (2 / exp), s)
        if z < 0:
            z *= 0.92  # slightly flatter belly
        ring.append(Vector((x, y, zc + z)))
    return ring


def build_fuselage():
    bm = bmesh.new()
    rings = []
    stations = 40
    for k in range(stations + 1):
        y, w, h, zc = catmull(FUS, k / stations)
        rings.append(fuselage_ring(y, w, h, zc))
    vrings, faces = loft(bm, rings, cap_start=True, cap_end=True)
    # Livery: belly in wing color, side stripe and cowling in accent
    for f in faces:
        c = f.calc_center_median()
        st = catmull(FUS, (c.y - FUS[0][0]) / (FUS[-1][0] - FUS[0][0]))
        zc, h = st[3], st[2]
        rel = (c.z - zc) / max(h, 1e-3)
        if c.y > 2.55:
            f.material_index = 2
        elif -0.12 < rel < 0.05 and c.y < 2.4:
            f.material_index = 2
        elif rel < -0.55:
            f.material_index = 1
        else:
            f.material_index = 0
    obj = mesh_object("Fuselage", bm, ["Body", "Wing", "Accent"])
    return finalize(obj, sharp_deg=70)


def build_canopy():
    bm = bmesh.new()
    rings = []
    n = 18
    for k in range(n + 1):
        t = k / n
        y = -0.55 + t * 2.1
        prof = math.sin(math.pi * t ** 0.8) ** 0.6  # bubble, fuller toward the front
        prof = max(prof, 0.02)
        ring = []
        m = 16
        for i in range(m + 1):
            a = math.pi * i / m  # half circle over the top
            x = math.cos(a) * 0.46 * prof
            z = math.sin(a) * 0.5 * prof
            ring.append(Vector((x, y, 0.62 + z)))
        rings.append(ring)
    loft(bm, rings, closed_ring=False)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    obj = mesh_object("Canopy", bm, ["Glass"], recalc=False)
    return finalize(obj, sharp_deg=80)


def lifting_surface(name, span, root_chord, tip_chord, sweep, dihedral_deg, thickness, camber,
                    origin, vertical=False, mats=("Wing", "Accent"), tip_frac=0.12, mirror=True):
    """Tapered airfoil surface with a rounded tip. Built for the +X half, mirrored if asked."""
    bm = bmesh.new()
    foil = airfoil(14, thickness, camber)
    sections = 12
    dih = math.radians(dihedral_deg)
    halves = [1, -1] if mirror else [1]
    for side in halves:
        rings = []
        for k in range(sections + 1):
            t = k / sections
            # rounded tip: shrink chord and thickness over the last stations
            tip_t = max(0.0, (t - 0.82) / 0.18)
            round_k = math.sqrt(max(0.0, 1 - tip_t ** 2))
            chord = (root_chord + (tip_chord - root_chord) * t) * (0.35 + 0.65 * round_k)
            thick_scale = 0.25 + 0.75 * round_k
            s = span * t
            le = origin[1] + chord * 0.0 - sweep * t + (root_chord + (tip_chord - root_chord) * t - chord) * 0.5 * -1
            ring = []
            for (fx, fz) in foil:
                along = le - fx * chord  # chord runs backward (toward -Y)
                thick = fz * chord * thick_scale
                if vertical:
                    ring.append(Vector((thick, along, origin[2] + s)))
                else:
                    x = side * (origin[0] + s * math.cos(dih))
                    z = origin[2] + s * math.sin(dih) + thick
                    ring.append(Vector((x, along, z)))
            rings.append(ring)
        if side < 0:
            rings = [list(reversed(r)) for r in rings]
        vrings, faces = loft(bm, rings, cap_start=True, cap_end=True)
        for f in faces:
            c = f.calc_center_median()
            spanpos = (abs(c.z - origin[2]) if vertical else abs(c.x) - origin[0]) / span
            f.material_index = 1 if spanpos > 1 - tip_frac else 0
        if vertical:
            break
    obj = mesh_object(name, bm, list(mats))
    return finalize(obj, sharp_deg=55)


def revolve(profile, axis_y, center, segs=20, name="Rev", mat="Metal"):
    """Revolve (radius, y) pairs around an axis parallel to Y through `center` (x, z)."""
    bm = bmesh.new()
    rings = []
    for (r, y) in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(Vector((center[0] + math.cos(a) * r, y, center[1] + math.sin(a) * r)))
        rings.append(ring)
    loft(bm, rings, cap_start=profile[0][0] > 1e-3, cap_end=profile[-1][0] > 1e-3)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    obj = mesh_object(name, bm, [mat])
    return finalize(obj, sharp_deg=60)


def wheel(name, center, radius, width, axis="x"):
    """Tire (torus-like) + hub as one mesh, axle along X."""
    bm = bmesh.new()
    segs, tube = 24, 10
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = []
        for j in range(tube):
            b = 2 * math.pi * j / tube
            rr = radius - width * 0.5 + math.cos(b) * width * 0.5
            x = math.sin(b) * width * 0.55
            ring.append(Vector((center[0] + x, center[1] + math.cos(a) * rr, center[2] + math.sin(a) * rr)))
        rings.append(ring)
    rings.append(rings[0])
    vr = [[bm.verts.new(p) for p in r] for r in rings[:-1]]
    vr.append(vr[0])
    faces = []
    for a, b in zip(vr, vr[1:]):
        for j in range(tube):
            k = (j + 1) % tube
            faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
    obj = mesh_object(name, bm, ["Tire"])
    return finalize(obj, sharp_deg=80)


def wheel_pant(name, center, length, width, height):
    """Teardrop fairing around a main wheel."""
    prof = []
    n = 14
    for k in range(n + 1):
        t = k / n
        r = math.sin(math.pi * t) ** 0.7 * (1 - 0.35 * t)
        prof.append((max(r, 0.0), t))
    bm = bmesh.new()
    rings = []
    for (r, t) in prof:
        y = center[1] + length * 0.45 - t * length
        ring = []
        for i in range(16):
            a = 2 * math.pi * i / 16
            ring.append(Vector((center[0] + math.cos(a) * width * r, y, center[2] + 0.05 + math.sin(a) * height * r)))
        rings.append(ring)
    loft(bm, rings)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    obj = mesh_object(name, bm, ["Body"])
    return finalize(obj, sharp_deg=80)


def strut(name, a, b, r=0.05, mat="Metal", bm=None):
    a, b = Vector(a), Vector(b)
    d = (b - a)
    into = bm is not None
    bm = bm or bmesh.new()
    perp1 = d.orthogonal().normalized()
    perp2 = d.normalized().cross(perp1)
    rings = []
    for t in (0, 1):
        c = a + d * t
        rings.append([c + (perp1 * math.cos(2 * math.pi * i / 8) + perp2 * math.sin(2 * math.pi * i / 8)) * r for i in range(8)])
    loft(bm, rings, cap_start=True, cap_end=True)
    if into:
        return None
    obj = mesh_object(name, bm, [mat])
    return finalize(obj, sharp_deg=60)


def blade_pair(hub, radius=1.7):
    """Two twisted, tapered propeller blades around the hub (spin axis = Y)."""
    bm = bmesh.new()
    foil = airfoil(8, 0.1, 0.03)
    for side in (1, -1):
        rings = []
        sections = 10
        for k in range(sections + 1):
            t = k / sections
            r = 0.18 + t * (radius - 0.18)
            tipround = math.sqrt(max(0.0, 1 - max(0.0, (t - 0.85) / 0.15) ** 2))
            chord = (0.24 - 0.1 * t) * (0.4 + 0.6 * tipround)
            twist = math.radians(38 - 26 * t)
            ring = []
            for (fx, fz) in foil:
                cx = (fx - 0.35) * chord
                cz = fz * chord
                # chord lies in the X/Y plane, rotated by twist around the blade axis (Z)
                x = cx * math.cos(twist) - cz * math.sin(twist)
                y = cx * math.sin(twist) + cz * math.cos(twist)
                ring.append(Vector((hub[0] + side * x, hub[1] + y, hub[2] + side * r)))
            if side < 0:
                ring = list(reversed(ring))
            rings.append(ring)
        vr, faces = loft(bm, rings, cap_start=True, cap_end=True)
        for f in faces:
            c = f.calc_center_median()
            f.material_index = 1 if abs(c.z - hub[2]) > radius - 0.22 else 0
    obj = mesh_object("Blades", bm, ["Dark", "Wing"])
    return finalize(obj, sharp_deg=60)


def build_plane():
    reset_scene()
    parts = {}
    parts["fuselage"] = build_fuselage()
    parts["canopy"] = build_canopy()
    # Main wing (low wing), horizontal tail, vertical fin
    parts["wing"] = lifting_surface("Wing", span=4.75, root_chord=2.0, tip_chord=1.15, sweep=-0.15,
                                    dihedral_deg=5, thickness=0.14, camber=0.025, origin=(0.35, 1.15, -0.32))
    parts["htail"] = lifting_surface("HTail", span=1.85, root_chord=1.1, tip_chord=0.65, sweep=0.25,
                                     dihedral_deg=0, thickness=0.09, camber=0.0, origin=(0.1, -3.2, 0.32), tip_frac=0.0)
    parts["fin"] = lifting_surface("Fin", span=1.55, root_chord=1.35, tip_chord=0.7, sweep=0.55,
                                   dihedral_deg=0, thickness=0.1, camber=0.0, origin=(0, -3.05, 0.38),
                                   vertical=True, mats=("Accent", "Body"), tip_frac=0.18, mirror=False)
    # Landing gear (tricycle). Wheel bottoms sit at z = -1.45.
    for s, nm in ((1, "R"), (-1, "L")):
        parts["gear" + nm] = strut("Gear" + nm, (s * 0.7, -0.25, -0.45), (s * 1.45, -0.25, -1.13), r=0.06)
        parts["wheel" + nm] = wheel("Wheel" + nm, (s * 1.45, -0.25, -1.13), 0.32, 0.2)
        parts["pant" + nm] = wheel_pant("Pant" + nm, (s * 1.45, -0.25, -1.13), 1.1, 0.17, 0.4)
    parts["noseStrut"] = strut("NoseStrut", (0, 2.6, -0.4), (0, 2.6, -1.21), r=0.055)
    parts["noseWheel"] = wheel("NoseWheel", (0, 2.6, -1.21), 0.24, 0.14)
    # Exhaust stubs
    for s, nm in ((1, "R"), (-1, "L")):
        parts["exhaust" + nm] = revolve([(0.07, 0), (0.07, 0.35)], 0, (0, 0), segs=10, name="Exh" + nm, mat="Dark")
        o = parts["exhaust" + nm]
        o.rotation_euler = (math.radians(-110), 0, math.radians(25 * s))  # point down and out
        o.location = (s * 0.5, 2.55, -0.2)
    # Spinner + blades spin together, built around the hub at the origin
    hub = Vector((0, 3.42, 0.05))
    spinner = revolve([(0.3, 0), (0.29, 0.12), (0.24, 0.3), (0.14, 0.48), (0.0, 0.6)], 0, (0, 0), segs=24,
                      name="Spinner", mat="Accent")
    parts["spinner"] = spinner
    parts["blades"] = blade_pair((0, 0.12, 0))
    markers = {
        "prop": (hub.x, hub.y, hub.z),
        "tipL": (-5.1, 0.25, 0.1), "tipR": (5.1, 0.25, 0.1),
        "navL": (-5.12, 0.4, 0.12), "navR": (5.12, 0.4, 0.12),
        "strobe": (0, -3.75, 1.9),
        "exhaust": (0, 2.55, -0.3),
        "eye": (0, -0.25, 1.18),  # pilot's eye, above the fuselage spine
    }
    return parts, markers


# ---------------------------------------------------------------------------
# Vegetation and rocks
# ---------------------------------------------------------------------------
def jitter(v, amt, freq=1.3, seed=0.0):
    n = noise.noise_vector(v * freq + Vector((seed, seed * 2, 0)))
    return v + n * amt


def build_pine():
    reset_scene()
    bm = bmesh.new()
    # trunk
    rings = []
    for k, (r, z) in enumerate([(0.32, -0.3), (0.26, 2.5), (0.16, 7.0), (0.05, 11.0)]):
        rings.append([Vector((math.cos(2 * math.pi * i / 7) * r, math.sin(2 * math.pi * i / 7) * r, z)) for i in range(7)])
    loft(bm, rings, cap_end=True)
    trunk = mesh_object("PineTrunk", bm, ["Bark"])
    finalize(trunk, sharp_deg=80)

    bm = bmesh.new()
    tiers = [(2.0, 3.0, 4.6), (3.6, 2.5, 4.2), (5.2, 2.0, 3.7), (6.8, 1.5, 3.2), (8.3, 1.0, 2.8)]
    for ti, (zb, rad, hgt) in enumerate(tiers):
        segs = 10
        ring_lo = []
        ring_mid = []
        for i in range(segs):
            a = 2 * math.pi * i / segs + ti * 0.4
            rr = rad * (0.85 + 0.3 * random.random())
            droop = -0.35 * random.random()
            ring_lo.append(jitter(Vector((math.cos(a) * rr, math.sin(a) * rr, zb + droop)), 0.25, seed=ti))
            ring_mid.append(jitter(Vector((math.cos(a + 0.3) * rr * 0.55, math.sin(a + 0.3) * rr * 0.55, zb + hgt * 0.45)), 0.15, seed=ti + 3))
        vlo = [bm.verts.new(p) for p in ring_lo]
        vmid = [bm.verts.new(p) for p in ring_mid]
        top = bm.verts.new(Vector((random.uniform(-0.1, 0.1), random.uniform(-0.1, 0.1), zb + hgt)))
        inner = [bm.verts.new(Vector((p.x * 0.3, p.y * 0.3, zb + 0.5))) for p in ring_lo]
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((vlo[i], vlo[j], vmid[j], vmid[i]))
            bm.faces.new((vmid[i], vmid[j], top))
            bm.faces.new((inner[i], inner[j], vlo[j], vlo[i]))  # underside
    leaves = mesh_object("PineLeaves", bm, ["Needles"])
    finalize(leaves, sharp_deg=75)
    return {"trunk": trunk, "leaves": leaves}


def build_oak():
    reset_scene()
    bm = bmesh.new()
    rings = []
    for (r, z) in [(0.42, -0.3), (0.33, 1.5), (0.26, 3.6), (0.12, 5.5)]:
        rings.append([Vector((math.cos(2 * math.pi * i / 7) * r, math.sin(2 * math.pi * i / 7) * r, z)) for i in range(7)])
    loft(bm, rings, cap_end=True)
    for k in range(3):  # branches
        a = k * 2.1 + 0.3
        strut("Branch", (0, 0, 3.0), (math.cos(a) * 2.2, math.sin(a) * 2.2, 5.8), r=0.12, bm=bm)
    trunk = mesh_object("OakTrunk", bm, ["Bark"])
    finalize(trunk, sharp_deg=80)

    # Canopy: several noise-displaced spheres merged into one mesh
    bm = bmesh.new()
    blobs = [((0, 0, 6.6), 2.9), ((1.7, 0.6, 6.0), 2.0), ((-1.5, 0.9, 6.2), 2.1), ((0.3, -1.7, 6.1), 2.0), ((0.2, 0.3, 8.2), 1.9)]
    for bi, (c, r) in enumerate(blobs):
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in res["verts"]:
            p = v.co.copy()
            n = noise.noise(p * 0.9 + Vector((bi * 3.1, 0, 0)))
            v.co = p * (1 + 0.18 * n) + Vector(c)
            v.co.z = c[2] + (v.co.z - c[2]) * 0.85
    leaves = mesh_object("OakLeaves", bm, ["Leaves"])
    finalize(leaves, sharp_deg=89)
    return {"trunk": trunk, "leaves": leaves}


def build_rock():
    reset_scene()
    bm = bmesh.new()
    res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in res["verts"]:
        p = v.co.copy()
        n = noise.fractal(p * 1.2 + Vector((5, 1, 2)), 0.6, 2.0, 3)
        p *= 1 + 0.35 * n
        p.z = p.z * 0.6 if p.z > 0 else p.z * 0.3
        v.co = p
    rock = mesh_object("Rock", bm, ["Rock"])
    finalize(rock, sharp_deg=40)
    return {"rock": rock}


# ---------------------------------------------------------------------------
# Export: quantized int16 positions, int8 normals, uint16 indices, uint8 shade
# ---------------------------------------------------------------------------
def b64(data):
    return base64.b64encode(data).decode("ascii")


def export_object(obj, origin=(0, 0, 0), shade_fn=None):
    """Return {materialName: {pos, nrm, idx, shade?, scale, offset}} in three.js axes."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    me.transform(obj.matrix_world)
    me.calc_loop_triangles()
    normals = me.corner_normals
    out = {}
    groups = {}
    for tri in me.loop_triangles:
        mat = me.materials[tri.material_index].name if me.materials else "Default"
        g = groups.setdefault(mat, {"verts": [], "nrms": [], "index": [], "lookup": {}})
        for li in tri.loops:
            vi = me.loops[li].vertex_index
            co = me.vertices[vi].co - Vector(origin)
            n = normals[li].vector
            key = (round(co.x, 4), round(co.y, 4), round(co.z, 4), round(n.x, 2), round(n.y, 2), round(n.z, 2))
            idx = g["lookup"].get(key)
            if idx is None:
                idx = len(g["verts"])
                g["lookup"][key] = idx
                g["verts"].append((co.x, co.z, -co.y))   # to three.js axes
                g["nrms"].append((n.x, n.z, -n.y))
            g["index"].append(idx)
    for mat, g in groups.items():
        vs = g["verts"]
        mins = [min(v[k] for v in vs) for k in range(3)]
        maxs = [max(v[k] for v in vs) for k in range(3)]
        center = [(a + b) / 2 for a, b in zip(mins, maxs)]
        half = [max((b - a) / 2, 1e-6) for a, b in zip(mins, maxs)]
        pos = b"".join(struct.pack("<3h", *[int(round((v[k] - center[k]) / half[k] * 32767)) for k in range(3)]) for v in vs)
        nrm = b"".join(struct.pack("<3b", *[int(round(max(-1, min(1, n[k])) * 127)) for k in range(3)]) for n in g["nrms"])
        fmt = "<%dH" % len(g["index"]) if len(vs) < 65536 else "<%dI" % len(g["index"])
        entry = {"pos": b64(pos), "nrm": b64(nrm), "idx": b64(struct.pack(fmt, *g["index"])),
                 "idx32": len(vs) >= 65536, "center": center, "half": half, "count": len(vs)}
        if shade_fn:
            entry["shade"] = b64(bytes(int(255 * max(0, min(1, shade_fn(v)))) for v in vs))
        out[mat] = entry
    ev.to_mesh_clear()
    return out


def merge_exports(target, more):
    for mat, data in more.items():
        target.setdefault(mat, []).append(data)


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True)
    except Exception as exc:  # glTF add-on missing in some bpy builds
        print("GLB export skipped:", exc)


def main():
    models = {}

    # Plane: everything except the propeller is one rigid model; the propeller spins on its own.
    parts, markers = build_plane()
    hub = markers["prop"]
    body = {}
    prop = {}
    for name, obj in parts.items():
        if name in ("spinner", "blades"):
            merge_exports(prop, export_object(obj))
        elif name == "canopy":
            pass
        else:
            merge_exports(body, export_object(obj))
    canopy = {}
    merge_exports(canopy, export_object(parts["canopy"]))
    to3 = lambda p: (p[0], p[2], -p[1])
    models["plane"] = {"body": body, "prop": prop, "canopy": canopy,
                       "markers": {k: to3(v) for k, v in markers.items()}}
    # Move the propeller meshes so its origin is the hub
    parts["spinner"].location = hub
    parts["blades"].location = hub
    export_glb(os.path.join(OUT_GLB, "plane.glb"))

    def tree_shade(height):
        return lambda v: 0.45 + 0.55 * min(1.0, max(0.0, v[1] / height))

    pine = build_pine()
    def grouped(obj, **kw):
        d = {}
        merge_exports(d, export_object(obj, **kw))
        return d
    models["pine"] = {"trunk": grouped(pine["trunk"]), "leaves": grouped(pine["leaves"], shade_fn=tree_shade(11))}
    export_glb(os.path.join(OUT_GLB, "pine.glb"))
    oak = build_oak()
    models["oak"] = {"trunk": grouped(oak["trunk"]), "leaves": grouped(oak["leaves"], shade_fn=tree_shade(10))}
    export_glb(os.path.join(OUT_GLB, "oak.glb"))
    rock = build_rock()
    models["rock"] = {"rock": grouped(rock["rock"], shade_fn=lambda v: 0.6 + 0.4 * min(1, max(0, (v[1] + 0.3) / 0.9)))}
    export_glb(os.path.join(OUT_GLB, "rock.glb"))

    with open(OUT_JSON, "w") as f:
        json.dump(models, f, separators=(",", ":"))
    tris = sum(len(base64.b64decode(g["idx"])) // (4 if g["idx32"] else 2) // 3
               for m in models.values() for part in m.values() if part and isinstance(next(iter(part.values())), list)
               for groups in part.values() for g in groups)
    print("Wrote", OUT_JSON, os.path.getsize(OUT_JSON) // 1024, "KB,", tris, "triangles total")


main()
