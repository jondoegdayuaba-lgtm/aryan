"""
TURBO KICKOFF - Blender asset generator (Part 1 of the game)

Builds every 3D model for the game and exports them as .glb files:

    car_blue.glb         chunky sports car, blue team
    car_orange.glb       the same car, orange team
    ball.glb             soccer-style ball with hexagon panels
    arena.glb            stadium: curved walls and ceiling, goals, neon lines, stands
    boost_pad_small.glb  small boost pad
    boost_pad_big.glb    big boost pad with a glowing orb
    arena_layout.json    arena sizes, boost pad positions and kickoff spots

HOW TO RUN
    1. Open Blender (4.2 or newer) and start a new "General" file.
    2. Click the "Scripting" tab at the top of the window.
    3. In the Text Editor, click "+ New", paste this whole file, and press
       the Run Script button (the play icon), or Alt+P with the mouse over
       the text.
    4. A message pops up showing the folder the files were saved to.

WHERE THE FILES GO
    - If EXPORT_DIR below is set, there.
    - Otherwise, if you opened this file from the project's
      turbo-kickoff/blender/ folder (Text > Open), straight into
      turbo-kickoff/assets/models/.
    - Otherwise into a "TurboKickoff/models" folder in your home folder.

Units are metres (1 Blender unit = 1 m). Blender is Z-up; the .glb files
are Y-up, so in three.js X is the arena's width, Y is up and Z is its length.
Running the script again rebuilds everything from scratch.
"""

import json
import math
import os
import random

import bpy

# =============================================================================
# SETTINGS (safe to change)
# =============================================================================

EXPORT_DIR = ""             # e.g. r"C:\Users\you\Documents\turbo-kickoff\assets\models"
DELETE_DEFAULT_CUBE = True  # removes Blender's start-up cube, which would sit inside the arena
CROWD_SEED = 7              # change for a differently arranged crowd

# Colours are sRGB hex codes, the same as in any colour picker.
TEAMS = {
    "blue": {"body": "#1d63ff", "accent": "#f4f7ff", "glow": "#3fd0ff", "seat": "#173a80"},
    "orange": {"body": "#ff7417", "accent": "#20232e", "glow": "#ffae2b", "seat": "#80340f"},
}

BALL_RADIUS = 0.93          # the car is 0.62 m tall, so the ball is about 3x its height

ARENA_HALF_WIDTH = 36.0     # side walls at x = +-36
ARENA_HALF_LENGTH = 48.0    # end walls (and goal lines) at y = +-48
ARENA_HEIGHT = 20.0
CORNER_RADIUS = 10.0        # rounded corners, seen from above
FLOOR_CURVE = 3.0           # radius of the ramp from the floor up into the walls
CEILING_CURVE = 6.0         # radius of the curve from the walls into the ceiling
GOAL_HALF_WIDTH = 8.9
GOAL_HEIGHT = 6.4
GOAL_DEPTH = 8.8

# =============================================================================
# Small vector helpers (plain tuples, double precision)
# =============================================================================


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_len(a):
    return math.sqrt(v_dot(a, a))


def v_norm(a):
    length = v_len(a)
    return v_mul(a, 1.0 / length) if length > 1e-12 else (0.0, 0.0, 0.0)


def v_lerp(a, b, t):
    return v_add(a, v_mul(v_sub(b, a), t))


def split(a, b, n):
    """n equal steps from a to b, both ends included."""
    return [a + (b - a) * i / n for i in range(n + 1)]


# =============================================================================
# Materials
# =============================================================================


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(code):
    code = code.lstrip("#")
    return tuple(srgb_to_linear(int(code[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def _set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def _try_set(target, attr, value):
    if hasattr(target, attr):
        try:
            setattr(target, attr, value)
        except (AttributeError, TypeError, ValueError):
            pass


def material(name, color, metallic=0.0, roughness=0.6, glow=0.0, alpha=1.0, double_sided=False):
    """Create (or refresh) a Principled BSDF material that exports cleanly to glTF.

    glow > 0 makes the colour emissive with that strength, which three.js
    reads back as emissiveIntensity (great with a bloom pass). alpha < 1
    makes the material see-through.
    """
    full_name = "TK_" + name
    mat = bpy.data.materials.get(full_name) or bpy.data.materials.new(full_name)
    if mat.node_tree is None:  # Blender 4.x; in 5.0+ every material already has nodes
        mat.use_nodes = True
    rgb = hex_rgb(color)

    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    mat.node_tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    _set_input(bsdf, ("Base Color",), (*rgb, 1.0))
    _set_input(bsdf, ("Metallic",), metallic)
    _set_input(bsdf, ("Roughness",), roughness)
    _set_input(bsdf, ("Alpha",), alpha)
    _set_input(bsdf, ("Emission Color", "Emission"), (*rgb, 1.0) if glow > 0 else (0.0, 0.0, 0.0, 1.0))
    _set_input(bsdf, ("Emission Strength",), glow)

    # Viewport (Solid mode) colours
    mat.diffuse_color = (*rgb, alpha)
    mat.metallic = metallic
    mat.roughness = roughness

    # Older exporters read the blend mode from these; 4.2+ reads the Alpha socket.
    if alpha < 1.0:
        _try_set(mat, "blend_method", "BLEND")
        _try_set(mat, "surface_render_method", "BLENDED")
        _try_set(mat, "shadow_method", "NONE")
        _try_set(mat, "show_transparent_back", False)
        _try_set(mat, "use_transparency_overlap", False)
    else:
        _try_set(mat, "blend_method", "OPAQUE")
        _try_set(mat, "surface_render_method", "DITHERED")
    mat.use_backface_culling = not double_sided
    return mat


# =============================================================================
# Mesh building
# =============================================================================


class MeshBuilder:
    """Collects vertices, faces and per-face materials, then becomes one object."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.face_mats = []
        self.materials = []
        self._slots = {}

    def vert(self, p):
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    def face(self, idx, mat, facing=None):
        if mat.name not in self._slots:
            self._slots[mat.name] = len(self.materials)
            self.materials.append(mat)
        self.faces.append(list(idx))
        self.face_mats.append(self._slots[mat.name])
        f = len(self.faces) - 1
        if facing is not None:
            self.orient(f, facing)
        return f

    def poly(self, points, mat, facing=None):
        return self.face([self.vert(p) for p in points], mat, facing)

    def mark(self):
        return len(self.faces)

    def normal(self, f):
        """Newell's method: robust for any planar-ish polygon."""
        pts = [self.verts[i] for i in self.faces[f]]
        nx = ny = nz = 0.0
        for k, (x0, y0, z0) in enumerate(pts):
            x1, y1, z1 = pts[(k + 1) % len(pts)]
            nx += (y0 - y1) * (z0 + z1)
            ny += (z0 - z1) * (x0 + x1)
            nz += (x0 - x1) * (y0 + y1)
        return (nx, ny, nz)

    def centroid(self, f):
        pts = [self.verts[i] for i in self.faces[f]]
        return v_mul((sum(p[0] for p in pts), sum(p[1] for p in pts), sum(p[2] for p in pts)), 1.0 / len(pts))

    def orient(self, f, facing):
        """Flip face f if its normal points away from the direction `facing`."""
        if v_dot(self.normal(f), facing) < 0:
            self.faces[f].reverse()

    def orient_toward(self, f, point):
        self.orient(f, v_sub(point, self.centroid(f)))

    def orient_away_from(self, point, start=0):
        for f in range(start, len(self.faces)):
            self.orient(f, v_sub(self.centroid(f), point))

    def make_outward(self, start=0):
        """Make a closed part (faces from `start` on) face outwards, using its signed volume."""
        faces = self.faces[start:]
        ids = {i for f in faces for i in f}
        if not ids:
            return
        c = v_mul(tuple(sum(self.verts[i][k] for i in ids) for k in range(3)), 1.0 / len(ids))
        volume = 0.0
        for f in faces:
            a = v_sub(self.verts[f[0]], c)
            for k in range(1, len(f) - 1):
                volume += v_dot(a, v_cross(v_sub(self.verts[f[k]], c), v_sub(self.verts[f[k + 1]], c)))
        if volume < 0:
            for f in faces:
                f.reverse()


def mesh_object(name, mb, collection, parent=None, location=(0.0, 0.0, 0.0), mesh_name=None):
    me = bpy.data.meshes.new("TK_" + (mesh_name or name))
    me.from_pydata(mb.verts, [], mb.faces)
    for mat in mb.materials:
        me.materials.append(mat)
    if mb.face_mats:
        me.polygons.foreach_set("material_index", mb.face_mats)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    ob.parent = parent
    ob.location = location
    return ob


def empty_object(name, collection, parent=None, location=(0.0, 0.0, 0.0), size=0.5):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = size
    collection.objects.link(ob)
    ob.parent = parent
    ob.location = location
    return ob


# Corner index = i + 2j + 4k, where i, j, k pick the -/+ side of the u, v, w axes.
CUBE_FACES = {
    "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5),
    "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3),
    "-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6),
}


def add_box(mb, center, half, mat, axes=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), skip=()):
    """Box with outward faces. `axes` (u, v, w) may be rotated; `skip` drops faces like '-z'."""
    u, v, w = axes
    if v_dot(v_cross(u, v), w) < 0:
        v = v_mul(v, -1.0)  # keep the axes right-handed so the faces point outwards
    corners = []
    for k in (-1, 1):
        for j in (-1, 1):
            for i in (-1, 1):
                offset = v_add(v_add(v_mul(u, i * half[0]), v_mul(v, j * half[1])), v_mul(w, k * half[2]))
                corners.append(mb.vert(v_add(center, offset)))
    for key, quad in CUBE_FACES.items():
        if key not in skip:
            m = mat.get(key, mat["default"]) if isinstance(mat, dict) else mat
            mb.face([corners[i] for i in quad], m)


def add_beam(mb, p0, p1, thick, mat, hint=(0.0, 0.0, 1.0), extend=0.0):
    """Square bar from p0 to p1. `hint` sets which way the bar's sides face."""
    d = v_sub(p1, p0)
    length = v_len(d)
    u = v_mul(d, 1.0 / length)
    hint = v_norm(hint)
    if abs(v_dot(u, hint)) > 0.95:
        hint = (1.0, 0.0, 0.0) if abs(u[0]) < 0.9 else (0.0, 1.0, 0.0)
    w = v_norm(v_sub(hint, v_mul(u, v_dot(hint, u))))
    v = v_cross(w, u)
    add_box(mb, v_lerp(p0, p1, 0.5), (length / 2 + extend, thick / 2, thick / 2), mat, (u, v, w))


def add_loft(mb, rings, mat, cap_start=None, cap_end=None):
    """Skin a list of same-sized point rings. `mat` may be a function (segment, edge) -> material."""
    start = mb.mark()
    idx = [[mb.vert(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for s in range(len(rings) - 1):
        a, b = idx[s], idx[s + 1]
        for i in range(n):
            j = (i + 1) % n
            mb.face((a[i], a[j], b[j], b[i]), mat(s, i) if callable(mat) else mat)
    if cap_start is not None:
        mb.face(list(reversed(idx[0])), cap_start)
    if cap_end is not None:
        mb.face(idx[-1], cap_end)
    if cap_start is not None and cap_end is not None:
        mb.make_outward(start)


def ring_points(center, axis, radius, segments, phase=0.0):
    a = v_norm(axis)
    ref = (0.0, 0.0, 1.0) if abs(a[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = v_norm(v_cross(a, ref))
    v = v_cross(a, u)
    pts = []
    for k in range(segments):
        t = phase + 2 * math.pi * k / segments
        pts.append(v_add(center, v_add(v_mul(u, radius * math.cos(t)), v_mul(v, radius * math.sin(t)))))
    return pts


def add_cylinder(mb, p0, p1, r0, r1, segments, side, cap0=None, cap1=None, phase=0.0):
    """Closed cylinder (or cone if r0 != r1) from p0 to p1."""
    axis = v_sub(p1, p0)
    rings = [ring_points(p0, axis, r0, segments, phase), ring_points(p1, axis, r1, segments, phase)]
    add_loft(mb, rings, side, cap0 or side, cap1 or side)


def add_ring_prism(mb, r_in, r_out, z0, z1, segments, mat, phase=0.0):
    """Flat washer shape around the Z axis."""
    start = mb.mark()

    def ring(r, z):
        return [mb.vert((r * math.cos(phase + 2 * math.pi * k / segments),
                         r * math.sin(phase + 2 * math.pi * k / segments), z)) for k in range(segments)]

    ob, ot, ib, it = ring(r_out, z0), ring(r_out, z1), ring(r_in, z0), ring(r_in, z1)
    for i in range(segments):
        j = (i + 1) % segments
        mb.face((ob[i], ob[j], ot[j], ot[i]), mat)
        mb.face((it[i], it[j], ib[j], ib[i]), mat)
        mb.face((ot[i], ot[j], it[j], it[i]), mat)
        mb.face((ib[i], ib[j], ob[j], ob[i]), mat)
    mb.make_outward(start)


def icosphere(subdivisions):
    """Unit icosphere: 0 -> 12 vertices, 1 -> 42, 2 -> 162."""
    t = (1 + 5 ** 0.5) / 2
    verts = [v_norm(p) for p in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
                                 (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
             (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5),
             (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(subdivisions):
        cache = {}

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                verts.append(v_norm(v_lerp(verts[a], verts[b], 0.5)))
                cache[key] = len(verts) - 1
            return cache[key]

        new_faces = []
        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            new_faces += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = new_faces
    return verts, faces


# =============================================================================
# CAR
# =============================================================================
# The car faces -Y in Blender, which the exporter turns into +Z in three.js
# (the glTF "forward"). Because it faces -Y, the car's left side is +X.
# Its origin is on the ground, midway between the axles.

CAR_HULL = [  # y, half width, bottom z, top z, bevel
    (-0.66, 0.24, 0.14, 0.24, 0.04),
    (-0.58, 0.29, 0.11, 0.30, 0.05),
    (-0.36, 0.30, 0.10, 0.34, 0.05),
    (-0.10, 0.31, 0.10, 0.37, 0.05),
    (0.25, 0.31, 0.10, 0.39, 0.05),
    (0.52, 0.30, 0.12, 0.40, 0.05),
    (0.64, 0.27, 0.15, 0.37, 0.04),
]
CAR_CABIN = [
    (-0.24, 0.27, 0.33, 0.37, 0.02),
    (-0.05, 0.25, 0.35, 0.57, 0.05),
    (0.17, 0.24, 0.36, 0.59, 0.05),
    (0.40, 0.26, 0.37, 0.41, 0.02),
]
CAR_WHEELS = [  # name, x, y, radius, width
    ("Wheel_FL", 0.385, -0.40, 0.17, 0.15),
    ("Wheel_FR", -0.385, -0.40, 0.17, 0.15),
    ("Wheel_RL", 0.41, 0.37, 0.20, 0.19),
    ("Wheel_RR", -0.41, 0.37, 0.20, 0.19),
]
CAR_HITBOX = {"size": (0.84, 0.36, 1.18), "center": (0.0, -0.01, 0.30)}  # Blender x, y, z


def bevel_ring(y, hw, zb, zt, bevel, cx=0.0):
    """Octagonal cross-section (a rectangle with bevelled corners) across the car at `y`.

    Edge order: 0 bottom, 1 bottom-right bevel, 2 right side, 3 top-right bevel,
    4 top, 5 top-left bevel, 6 left side, 7 bottom-left bevel.
    """
    b = min(bevel, hw * 0.45, (zt - zb) * 0.45)
    pts = [(-hw + b, zb), (hw - b, zb), (hw, zb + b), (hw, zt - b),
           (hw - b, zt), (-hw + b, zt), (-hw, zt - b), (-hw, zb + b)]
    return [(cx + x, y, z) for x, z in pts]


def _profile_top(sections, y):
    for (y0, _, _, t0, _), (y1, _, _, t1, _) in zip(sections, sections[1:]):
        if y0 <= y <= y1:
            return t0 + (t1 - t0) * (y - y0) / (y1 - y0)
    return sections[-1][3]


def car_materials(team):
    c = TEAMS[team]
    t = team.title()
    return {
        "body": material(f"Car_{t}_Body", c["body"], metallic=0.35, roughness=0.35),
        "accent": material(f"Car_{t}_Accent", c["accent"], metallic=0.2, roughness=0.4),
        "glow": material(f"Car_{t}_Boost", c["glow"], glow=3.0),
        "chassis": material("Car_Chassis", "#1b1e27", metallic=0.4, roughness=0.6),
        "glass": material("Car_Glass", "#0d1626", metallic=0.6, roughness=0.12),
        "tire": material("Car_Tire", "#17181c", roughness=0.9),
        "rim": material("Car_Rim", "#c9ced8", metallic=0.9, roughness=0.3),
        "rim_dark": material("Car_RimDark", "#3a3f4b", metallic=0.7, roughness=0.4),
        "metal": material("Car_Metal", "#8a919e", metallic=0.9, roughness=0.35),
        "headlight": material("Car_Headlight", "#fff6d8", glow=2.5),
        "taillight": material("Car_Taillight", "#ff2a2a", glow=2.0),
    }


def wheel_mesh(radius, width, side, M, segments=12):
    """A wheel spun around the X axis, centred on its own origin. side=+1 puts the rim on +X."""
    mb = MeshBuilder()
    h = width / 2
    lip = min(0.035, width * 0.2)
    profile = [  # (offset along the axle, radius)
        (-h, 0.0), (-h, 0.50 * radius), (-h, 0.86 * radius), (-h + 0.18 * width, radius),
        (h - 0.18 * width, radius), (h, 0.86 * radius), (h, 0.70 * radius),
        (h - lip, 0.64 * radius), (h - lip, 0.24 * radius), (h - lip * 0.4, 0.18 * radius), (h - lip * 0.4, 0.0),
    ]
    bands = ["chassis", "tire", "tire", "tire", "tire", "tire", "rim", "spokes", "rim", "rim"]
    rings = []
    for a, r in profile:
        if r < 1e-9:
            rings.append([mb.vert((side * a, 0.0, 0.0))])
        else:
            rings.append([mb.vert((side * a, r * math.cos(2 * math.pi * k / segments),
                                   r * math.sin(2 * math.pi * k / segments))) for k in range(segments)])
    for k, band in enumerate(bands):
        ring_a, ring_b = rings[k], rings[k + 1]
        for i in range(segments):
            j = (i + 1) % segments
            if band == "spokes":
                m = M["rim"] if i % 2 == 0 else M["rim_dark"]
            else:
                m = M[band]
            if len(ring_a) == 1:
                mb.face((ring_a[0], ring_b[j], ring_b[i]), m)
            elif len(ring_b) == 1:
                mb.face((ring_a[i], ring_a[j], ring_b[0]), m)
            else:
                mb.face((ring_a[i], ring_a[j], ring_b[j], ring_b[i]), m)
    mb.make_outward()
    return mb


def build_car(team, collection):
    M = car_materials(team)
    t = team.title()
    root = empty_object("Car_" + t, collection, size=0.8)
    mb = MeshBuilder()

    def underside(edge):
        return edge in (0, 1, 7)

    # Main hull, then the cabin on top (side windows, windscreen and rear glass)
    add_loft(mb, [bevel_ring(*s) for s in CAR_HULL],
             lambda s, e: M["chassis"] if underside(e) else M["body"], M["body"], M["chassis"])

    def cabin_mat(s, e):
        if e in (2, 6):
            return M["glass"]
        if e in (3, 4, 5):
            return M["body"] if s == 1 else M["glass"]
        return M["body"]

    add_loft(mb, [bevel_ring(*s) for s in CAR_CABIN], cabin_mat, M["body"], M["body"])

    # Wheel arches over each wheel
    for _, x, y, r, w in CAR_WHEELS:
        hw = w / 2 + 0.035
        sections = [(y - 1.2 * r, 1.50 * r, 1.80 * r), (y - 0.62 * r, 2.08 * r, 2.36 * r),
                    (y + 0.62 * r, 2.08 * r, 2.36 * r), (y + 1.2 * r, 1.50 * r, 1.80 * r)]
        add_loft(mb, [bevel_ring(sy, hw, zb, zt, 0.03, cx=x) for sy, zb, zt in sections],
                 lambda s, e: M["chassis"] if underside(e) else M["body"], M["body"], M["body"])

    # Side skirts between the wheels, with an accent stripe on the outside
    for sx in (1, -1):
        outer = 2 if sx > 0 else 6
        add_loft(mb, [bevel_ring(y, 0.075, 0.10, 0.22, 0.025, cx=sx * 0.33) for y in (-0.21, 0.15)],
                 lambda s, e, o=outer: M["accent"] if e == o else (M["chassis"] if underside(e) else M["body"]),
                 M["body"], M["body"])

    # Nose: splitter, grille, headlights
    add_box(mb, (0.0, -0.665, 0.10), (0.33, 0.06, 0.022), M["chassis"])
    add_box(mb, (0.0, -0.665, 0.17), (0.085, 0.01, 0.028), M["chassis"])
    for sx in (1, -1):
        add_box(mb, (sx * 0.155, -0.663, 0.205), (0.055, 0.012, 0.02), M["headlight"])

    # Tail: lights and twin rocket boosters with glowing nozzles
    for sx in (1, -1):
        add_box(mb, (sx * 0.18, 0.642, 0.325), (0.05, 0.008, 0.02), M["taillight"])
        bx = sx * 0.12
        add_cylinder(mb, (bx, 0.52, 0.23), (bx, 0.74, 0.23), 0.068, 0.068, 10, M["metal"])
        add_cylinder(mb, (bx, 0.74, 0.23), (bx, 0.80, 0.23), 0.068, 0.088, 10, M["chassis"],
                     cap0=M["chassis"], cap1=M["glow"])

    # Spoiler: two uprights, a wing and end plates
    for sx in (1, -1):
        add_box(mb, (sx * 0.17, 0.53, 0.47), (0.016, 0.03, 0.085), M["chassis"])
        add_box(mb, (sx * 0.43, 0.585, 0.585), (0.012, 0.13, 0.07), M["accent"])
    wing = [(0.46, 0.565), (0.52, 0.592), (0.69, 0.607), (0.70, 0.592), (0.56, 0.553)]
    add_loft(mb, [[(x, y, z) for y, z in wing] for x in (-0.42, 0.42)], M["body"], M["body"], M["body"])

    # Twin racing stripes over the bonnet, roof and rear deck
    def stripe(ys, top, x0, x1):
        for ya, yb in zip(ys, ys[1:]):
            za, zb = top(ya) + 0.004, top(yb) + 0.004
            mb.poly([(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)], M["accent"], facing=(0, 0, 1))

    def hull_top(y):
        return _profile_top(CAR_HULL, y)

    def roof_top(y):
        return _profile_top(CAR_CABIN, y)

    for x0, x1 in ((0.035, 0.095), (-0.095, -0.035)):
        stripe([-0.63, -0.58, -0.36, -0.26], hull_top, x0, x1)
        stripe([-0.03, 0.15], roof_top, x0, x1)
        stripe([0.43, 0.52, 0.62], hull_top, x0, x1)

    mesh_object("Body", mb, collection, parent=root, mesh_name=f"Car_{t}_Body")

    # Wheels are separate objects (origin at the hub) so the game can spin and steer them
    for name, x, y, r, w in CAR_WHEELS:
        mesh_object(name, wheel_mesh(r, w, 1 if x > 0 else -1, M), collection, parent=root,
                    location=(x, y, r), mesh_name=f"Car_{t}_{name}")

    # Where the boost flames come out
    empty_object("BoostExit_L", collection, parent=root, location=(0.12, 0.82, 0.23), size=0.1)
    empty_object("BoostExit_R", collection, parent=root, location=(-0.12, 0.82, 0.23), size=0.1)

    hb = CAR_HITBOX
    root["team"] = team
    root["hitbox_size"] = [hb["size"][0], hb["size"][1], hb["size"][2]]  # three.js x, y, z
    root["hitbox_offset"] = list(to_three(hb["center"]))
    root["front_wheel_radius"] = CAR_WHEELS[0][3]
    root["rear_wheel_radius"] = CAR_WHEELS[2][3]
    return root


# =============================================================================
# BALL
# =============================================================================


def build_ball(collection):
    """A Goldberg ball: 12 dark pentagons with glowing cores and 30 light hexagons, with grooved seams."""
    R = BALL_RADIUS
    M = {
        "light": material("Ball_Panel", "#e8ecf2", roughness=0.45),
        "dark": material("Ball_PanelDark", "#2b3140", metallic=0.3, roughness=0.5),
        "seam": material("Ball_Seam", "#101218", roughness=0.8),
        "glow": material("Ball_Glow", "#ffb340", glow=2.5),
    }
    verts, faces = icosphere(1)  # 42 vertices -> 42 panels
    mb = MeshBuilder()
    corner_dir = [v_norm(v_add(v_add(verts[a], verts[b]), verts[c])) for a, b, c in faces]
    corner_idx = [mb.vert(v_mul(d, R * 0.955)) for d in corner_dir]  # bottom of the seams
    around = [[] for _ in verts]
    for fi, f in enumerate(faces):
        for vi in f:
            around[vi].append(fi)

    for vi, center in enumerate(verts):
        ref = v_norm(v_cross(center, (0.0, 0.0, 1.0) if abs(center[2]) < 0.9 else (1.0, 0.0, 0.0)))
        ref2 = v_cross(center, ref)
        ring = sorted(around[vi], key=lambda fi: math.atan2(v_dot(corner_dir[fi], ref2), v_dot(corner_dir[fi], ref)))
        n = len(ring)
        inset_dirs = [v_norm(v_lerp(corner_dir[fi], center, 0.14)) for fi in ring]
        inset = [mb.vert(v_mul(d, R * 0.988)) for d in inset_dirs]
        tip = mb.vert(v_mul(center, R))
        for i in range(n):
            j = (i + 1) % n
            mb.face((corner_idx[ring[i]], corner_idx[ring[j]], inset[j], inset[i]), M["seam"])
        if n == 5:
            core = [mb.vert(v_mul(v_norm(v_lerp(d, center, 0.5)), R * 0.997)) for d in inset_dirs]
            for i in range(n):
                j = (i + 1) % n
                mb.face((inset[i], inset[j], core[j], core[i]), M["dark"])
                mb.face((tip, core[i], core[j]), M["glow"])
        else:
            for i in range(n):
                j = (i + 1) % n
                mb.face((tip, inset[i], inset[j]), M["light"])
    mb.orient_away_from((0.0, 0.0, 0.0))
    ball = mesh_object("Ball", mb, collection)
    ball["radius"] = R
    return ball


# =============================================================================
# BOOST PADS
# =============================================================================


def pad_materials():
    return {
        "base": material("Pad_Base", "#262b38", metallic=0.6, roughness=0.45),
        "trim": material("Pad_Trim", "#ff9d1f", glow=1.2),
        "glow": material("Pad_Glow", "#ffc23d", glow=2.5),
        "orb": material("Pad_Orb", "#ffb02b", glow=2.5),
    }


def build_small_pad(collection, M):
    root = empty_object("BoostPad_Small", collection, size=0.4)
    mb = MeshBuilder()
    add_cylinder(mb, (0, 0, 0), (0, 0, 0.05), 0.55, 0.49, 6, M["base"], phase=math.pi / 6)
    add_ring_prism(mb, 0.30, 0.40, 0.045, 0.065, 6, M["trim"], phase=math.pi / 6)
    mesh_object("BoostPad_Small_Base", mb, collection, parent=root)

    glow = MeshBuilder()  # the part that disappears when a car picks the pad up
    add_cylinder(glow, (0, 0, -0.03), (0, 0, 0.03), 0.17, 0.17, 6, M["glow"], phase=math.pi / 6)
    mesh_object("BoostPad_Small_Glow", glow, collection, parent=root, location=(0, 0, 0.17))

    root["boost_amount"] = 12
    root["pickup_radius"] = 1.44
    root["respawn_seconds"] = 4.0
    return root


def build_big_pad(collection, M):
    root = empty_object("BoostPad_Big", collection, size=0.6)
    mb = MeshBuilder()
    add_cylinder(mb, (0, 0, 0), (0, 0, 0.08), 1.15, 1.02, 8, M["base"], phase=math.pi / 8)
    add_ring_prism(mb, 0.70, 0.90, 0.075, 0.10, 16, M["trim"])
    for k in range(4):  # four claws reaching up towards the orb
        a = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        add_beam(mb, (0.92 * c, 0.92 * s, 0.06), (0.52 * c, 0.52 * s, 0.52), 0.07, M["base"], hint=(-s, c, 0))
    mesh_object("BoostPad_Big_Base", mb, collection, parent=root)

    orb = MeshBuilder()  # origin at its centre so the game can spin and bob it
    verts, faces = icosphere(1)
    idx = [orb.vert(v_mul(v, 0.42)) for v in verts]
    for f in faces:
        orb.face([idx[i] for i in f], M["orb"])
    orb.orient_away_from((0.0, 0.0, 0.0))
    mesh_object("BoostPad_Big_Orb", orb, collection, parent=root, location=(0, 0, 0.85))

    root["boost_amount"] = 100
    root["pickup_radius"] = 2.08
    root["respawn_seconds"] = 10.0
    return root


# =============================================================================
# ARENA
# =============================================================================
# Seen from above, the arena is a rectangle with rounded corners. Its walls
# are made by sweeping one side profile (floor ramp -> wall -> ceiling curve)
# all the way round, so the floor, walls and ceiling meet without gaps. The
# blue goal is at -Y (three.js +Z), the orange goal at +Y (three.js -Z).

CORNER_STEPS = 4  # each rounded corner has 2 * CORNER_STEPS segments
STAND_TIERS, STAND_DEPTH, STAND_RISE, STAND_Z0 = 10, 1.6, 1.0, 5.0


def rr_loop(hx, hy, rc, xs, ys, n_half=CORNER_STEPS):
    """Points (x, y, nx, ny, part) going anticlockwise round a rounded rectangle.

    (nx, ny) is the outward normal. xs / ys are the sample positions along the
    straight parts, from -(hx - rc) to (hx - rc) and -(hy - rc) to (hy - rc).
    """
    ax, ay = hx - rc, hy - rc
    steps = 2 * n_half
    out = []

    def corner(cx, cy, a0):
        for k in range(1, steps):
            a = a0 + (math.pi / 2) * k / steps
            out.append((cx + rc * math.cos(a), cy + rc * math.sin(a), math.cos(a), math.sin(a), "corner"))

    out += [(hx, y, 1.0, 0.0, "side") for y in ys]
    corner(ax, ay, 0.0)
    out += [(x, hy, 0.0, 1.0, "end") for x in reversed(xs)]
    corner(-ax, ay, math.pi / 2)
    out += [(-hx, y, -1.0, 0.0, "side") for y in reversed(ys)]
    corner(-ax, -ay, math.pi)
    out += [(x, -hy, 0.0, -1.0, "end") for x in xs]
    corner(ax, -ay, 1.5 * math.pi)
    return out


def rr_grid(hx, hy, rc, xs, ys, n_half=CORNER_STEPS):
    """A grid of points filling a rounded rectangle whose edge matches rr_loop exactly."""
    ax, ay = hx - rc, hy - rc
    band = [rc * math.tan((math.pi / 4) * k / n_half) for k in range(1, n_half + 1)]
    gx = [-(ax + b) for b in reversed(band)] + list(xs) + [ax + b for b in band]
    gy = [-(ay + b) for b in reversed(band)] + list(ys) + [ay + b for b in band]

    def mapped(x, y):
        cx, cy = max(-ax, min(ax, x)), max(-ay, min(ay, y))
        dx, dy = x - cx, y - cy
        if dx and dy:  # inside a corner square: squash it onto the quarter circle
            scale = max(abs(dx), abs(dy)) / math.hypot(dx, dy)
            dx, dy = dx * scale, dy * scale
        return (cx + dx, cy + dy)

    return [[mapped(x, y) for x in gx] for y in gy]


def rr_sample(hx, hy, rc, spacing):
    """Evenly spaced points (x, y, nx, ny) round a rounded rectangle."""
    ax, ay = hx - rc, hy - rc
    quarter = rc * math.pi / 2
    pieces = [
        ("line", 2 * ay, (hx, -ay), (0.0, 1.0), (1.0, 0.0)),
        ("arc", quarter, (ax, ay), 0.0),
        ("line", 2 * ax, (ax, hy), (-1.0, 0.0), (0.0, 1.0)),
        ("arc", quarter, (-ax, ay), math.pi / 2),
        ("line", 2 * ay, (-hx, ay), (0.0, -1.0), (-1.0, 0.0)),
        ("arc", quarter, (-ax, -ay), math.pi),
        ("line", 2 * ax, (-ax, -hy), (1.0, 0.0), (0.0, -1.0)),
        ("arc", quarter, (ax, -ay), 1.5 * math.pi),
    ]
    total = sum(p[1] for p in pieces)
    count = max(1, int(total / spacing))
    out = []
    for k in range(count):
        s = (k + 0.5) * total / count
        for piece in pieces:
            if s <= piece[1]:
                break
            s -= piece[1]
        if piece[0] == "line":
            _, _, (px, py), (dx, dy), (nx, ny) = piece
            out.append((px + dx * s, py + dy * s, nx, ny))
        else:
            _, _, (cx, cy), a0 = piece
            a = a0 + s / rc
            out.append((cx + rc * math.cos(a), cy + rc * math.sin(a), math.cos(a), math.sin(a)))
    return out


def wall_profile():
    """The wall's side profile as (d, z, nd, nz): d is how far in from the wall line,
    (nd, nz) the surface normal pointing into the arena. Returns (points, ramp_count)."""
    R1, R2, H = FLOOR_CURVE, CEILING_CURVE, ARENA_HEIGHT
    pts = []
    ramp_steps = 4
    for k in range(ramp_steps + 1):  # floor edge -> up the ramp
        a = (math.pi / 2) * k / ramp_steps
        pts.append((R1 - R1 * math.sin(a), R1 - R1 * math.cos(a), math.sin(a), math.cos(a)))
    for z in (GOAL_HEIGHT, (GOAL_HEIGHT + H - R2) / 2, H - R2):  # straight wall
        pts.append((0.0, z, 1.0, 0.0))
    top_steps = 6
    for k in range(1, top_steps + 1):  # wall -> over into the ceiling
        a = (math.pi / 2) * k / top_steps
        pts.append((R2 - R2 * math.cos(a), H - R2 + R2 * math.sin(a), math.cos(a), -math.sin(a)))
    return pts, ramp_steps + 1


def arena_materials():
    M = {
        "turf_a": material("Arena_TurfA", "#2f7a3b", roughness=0.9),
        "turf_b": material("Arena_TurfB", "#276a32", roughness=0.9),
        "ramp": material("Arena_Ramp", "#1b2232", metallic=0.3, roughness=0.6),
        "glass": material("Arena_Glass", "#9cc4ff", metallic=0.1, roughness=0.08, alpha=0.16),
        "ceiling": material("Arena_Ceiling", "#26324d", roughness=0.3, alpha=0.10),
        "frame": material("Arena_Frame", "#3a4560", metallic=0.7, roughness=0.4),
        "neon_white": material("Neon_White", "#e9f3ff", glow=1.6),
        "ground": material("Arena_Ground", "#0d1119", roughness=0.9),
        "concrete": material("Stand_Concrete", "#2a3040", roughness=0.85),
        "seat": material("Stand_Seat", "#1d2230", roughness=0.8),
        "back": material("Stand_Back", "#151a26", roughness=0.8),
        "led_white": material("Stand_LED_White", "#f2f6ff", glow=1.2),
        "floodlight": material("Floodlight", "#fffbea", glow=3.0),
        "crowd_white": material("Crowd_White", "#e6e8ee", roughness=0.8),
        "crowd_dark": material("Crowd_Dark", "#30343f", roughness=0.8),
    }
    for team, c in TEAMS.items():
        M["neon_" + team] = material(f"Neon_{team.title()}", c["glow"], glow=2.0)
        M["frame_" + team] = material(f"Goal_{team.title()}_Frame", c["body"], glow=2.5)
        M["netline_" + team] = material(f"Goal_{team.title()}_NetLines", c["glow"], glow=1.0)
        M["net_" + team] = material(f"Goal_{team.title()}_Net", c["body"], roughness=0.2, alpha=0.22,
                                    double_sided=True)
        M["goalfloor_" + team] = material(f"Goal_{team.title()}_Floor", c["seat"], roughness=0.7)
        M["riser_" + team] = material(f"Stand_{team.title()}_Riser", c["seat"], roughness=0.8)
        M["led_" + team] = material(f"Stand_{team.title()}_LED", c["body"], glow=1.4)
        M["crowd_" + team] = material(f"Crowd_{team.title()}", c["body"], roughness=0.8)
        M["crowd2_" + team] = material(f"Crowd_{team.title()}_Light", c["glow"], roughness=0.8)
    return M


def text_polygons(text, size):
    """Turn text into flat polygons (x, y) using Blender's built-in font."""
    curve = bpy.data.curves.new("TK_TempText", type="FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.resolution_u = 2
    ob = bpy.data.objects.new("TK_TempText", curve)
    bpy.context.scene.collection.objects.link(ob)
    try:
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(depsgraph))
        polys = [[tuple(me.vertices[i].co[:2]) for i in p.vertices] for p in me.polygons]
        bpy.data.meshes.remove(me)
    finally:
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.curves.remove(curve)
    return polys


def build_arena(collection):
    HX, HY, H = ARENA_HALF_WIDTH, ARENA_HALF_LENGTH, ARENA_HEIGHT
    RC, R1, R2 = CORNER_RADIUS, FLOOR_CURVE, CEILING_CURVE
    GW, GH, GD = GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_DEPTH
    if not (R1 + 1.0 < RC and R2 < RC and R1 < GH < H - R2 and GW < HX - RC):
        raise ValueError("Arena sizes don't fit together: check CORNER_RADIUS, the curves and the goal size.")

    M = arena_materials()
    root = empty_object("Arena", collection, size=4.0)
    ax, ay = HX - RC, HY - RC
    xs = split(-ax, -GW, 3)[:-1] + split(-GW, GW, 4) + split(GW, ax, 3)[1:]  # includes the goal posts
    ys = split(-ay, ay, 10)
    mouth_xs = [x for x in xs if abs(x) <= GW + 1e-6]
    profile, ramp_count = wall_profile()
    eps = 1e-6

    def team_of(y):
        return "blue" if y < 0 else "orange"

    def in_mouth(a, b):
        return a[4] == "end" and b[4] == "end" and abs(a[0]) <= GW + eps and abs(b[0]) <= GW + eps

    # --- Floor: turf stripes across the pitch ---------------------------------
    floor = MeshBuilder()
    fx, fy = HX - R1, HY - R1
    stripe_w = 2 * ay / 10

    def turf(y):
        return M["turf_a"] if math.floor((y + ay) / stripe_w) % 2 == 0 else M["turf_b"]

    grid = rr_grid(fx, fy, RC - R1, xs, ys)
    ids = [[floor.vert((x, y, 0.0)) for x, y in row] for row in grid]
    for r in range(len(grid) - 1):
        for c in range(len(grid[0]) - 1):
            yc = (grid[r][c][1] + grid[r + 1][c][1]) / 2
            floor.face((ids[r][c], ids[r][c + 1], ids[r + 1][c + 1], ids[r + 1][c]), turf(yc), facing=(0, 0, 1))
    for s in (-1, 1):  # flat floor in the goal mouths, where the ramp is cut away
        for xa, xb in zip(mouth_xs, mouth_xs[1:]):
            floor.poly([(xa, s * fy, 0), (xb, s * fy, 0), (xb, s * HY, 0), (xa, s * HY, 0)],
                       turf(s * (fy + R1 / 2)), facing=(0, 0, 1))
    mesh_object("Arena_Floor", floor, collection, parent=root)

    # --- Walls: opaque ramp, then glass up and over to the ceiling --------------
    loop = rr_loop(HX, HY, RC, xs, ys)
    walls = MeshBuilder()
    wid = [[walls.vert((x - nx * d, y - ny * d, z)) for d, z, _, _ in profile] for x, y, nx, ny, _ in loop]
    for i, a in enumerate(loop):
        i2 = (i + 1) % len(loop)
        b = loop[i2]
        mouth = in_mouth(a, b)
        nx, ny = (a[2] + b[2]) / 2, (a[3] + b[3]) / 2
        inside = ((a[0] + b[0]) / 2 - nx * 10, (a[1] + b[1]) / 2 - ny * 10, H / 2)
        for j in range(len(profile) - 1):
            if mouth and profile[j + 1][1] <= GH + eps:
                continue  # leave the goal mouth open
            m = M["ramp"] if j < ramp_count - 1 else M["glass"]
            f = walls.face((wid[i][j], wid[i2][j], wid[i2][j + 1], wid[i][j + 1]), m)
            walls.orient_toward(f, inside)
    mesh_object("Arena_Walls", walls, collection, parent=root)

    # --- Ceiling ----------------------------------------------------------------
    ceiling = MeshBuilder()
    grid = rr_grid(HX - R2, HY - R2, RC - R2, xs, ys)
    ids = [[ceiling.vert((x, y, H)) for x, y in row] for row in grid]
    for r in range(len(grid) - 1):
        for c in range(len(grid[0]) - 1):
            ceiling.face((ids[r][c], ids[r][c + 1], ids[r + 1][c + 1], ids[r + 1][c]), M["ceiling"],
                         facing=(0, 0, -1))
    mesh_object("Arena_Ceiling", ceiling, collection, parent=root)

    # --- Trim: glass frame ribs, neon bands, team banners -------------------------
    trim = MeshBuilder()
    rib, lift = 0.075, 0.03
    for x, y, nx, ny, part in loop:
        tx, ty = -ny, nx
        for j in range(ramp_count - 1, len(profile) - 1):
            if part == "end" and abs(x) <= GW + 0.01 and profile[j + 1][1] <= GH + eps:
                continue
            pts = []
            for d, z, nd, nz in (profile[j], profile[j + 1]):
                px, py, pz = x - nx * (d + nd * lift), y - ny * (d + nd * lift), z + nz * lift
                pts.append(((px - tx * rib, py - ty * rib, pz), (px + tx * rib, py + ty * rib, pz)))
            d, z, nd, nz = profile[j]
            trim.poly([pts[0][0], pts[0][1], pts[1][1], pts[1][0]], M["frame"], facing=(-nx * nd, -ny * nd, nz))

    def wall_band(z0, z1, mat_for, skip_mouth):
        off = 0.04
        for i, a in enumerate(loop):
            b = loop[(i + 1) % len(loop)]
            if skip_mouth and in_mouth(a, b):
                continue
            pa = (a[0] - a[2] * off, a[1] - a[3] * off)
            pb = (b[0] - b[2] * off, b[1] - b[3] * off)
            trim.poly([(pa[0], pa[1], z0), (pb[0], pb[1], z0), (pb[0], pb[1], z1), (pa[0], pa[1], z1)],
                      mat_for((a[1] + b[1]) / 2), facing=(-(a[2] + b[2]), -(a[3] + b[3]), 0))

    wall_band(R1 + 0.05, R1 + 0.35, lambda y: M["neon_" + team_of(y)], True)
    wall_band(H - R2 - 0.35, H - R2 - 0.05, lambda y: M["neon_white"], False)

    try:  # "TURBO KICKOFF" banner on the glass above each goal
        letters = text_polygons("TURBO KICKOFF", 2.8)
        for s in (-1, 1):
            for poly in letters:
                trim.poly([(s * px, s * (HY - 0.06), 11.5 + py) for px, py in poly], M["neon_white"],
                          facing=(0, -s, 0))
    except Exception as err:  # the banner is decoration; never fail the export over it
        print("Turbo Kickoff: skipped the banner text:", err)
    mesh_object("Arena_Trim", trim, collection, parent=root)

    # --- Neon floor lines ----------------------------------------------------------
    lines = MeshBuilder()
    zl = 0.02

    def strip(p0, p1, width, mat, extend=0.0):
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        px, py = -uy * width / 2, ux * width / 2
        a = (p0[0] - ux * extend, p0[1] - uy * extend)
        b = (p1[0] + ux * extend, p1[1] + uy * extend)
        lines.poly([(a[0] + px, a[1] + py, zl), (b[0] + px, b[1] + py, zl),
                    (b[0] - px, b[1] - py, zl), (a[0] - px, a[1] - py, zl)], mat, facing=(0, 0, 1))

    def arc(cx, cy, radius, width, mat, a0=0.0, a1=2 * math.pi, segments=48):
        for k in range(segments):
            t0 = a0 + (a1 - a0) * k / segments
            t1 = a0 + (a1 - a0) * (k + 1) / segments
            ri, ro = radius - width / 2, radius + width / 2
            lines.poly([(cx + ri * math.cos(t0), cy + ri * math.sin(t0), zl),
                        (cx + ro * math.cos(t0), cy + ro * math.sin(t0), zl),
                        (cx + ro * math.cos(t1), cy + ro * math.sin(t1), zl),
                        (cx + ri * math.cos(t1), cy + ri * math.sin(t1), zl)], mat, facing=(0, 0, 1))

    strip((-fx, 0), (fx, 0), 0.4, M["neon_white"])
    arc(0, 0, 9.0, 0.4, M["neon_white"])
    lines.poly([(0.6 * math.cos(2 * math.pi * k / 16), 0.6 * math.sin(2 * math.pi * k / 16), zl) for k in range(16)],
               M["neon_white"], facing=(0, 0, 1))
    box_x, box_y = 13.0, fy - 10.0
    for s in (-1, 1):
        mat = M["neon_" + team_of(s)]
        for sx in (-1, 1):
            strip((sx * box_x, s * box_y), (sx * box_x, s * fy), 0.3, mat)
        strip((-box_x, s * box_y), (box_x, s * box_y), 0.3, mat, extend=0.15)
        arc(0, s * box_y, 6.0, 0.3, mat, math.pi if s > 0 else 0.0, 2 * math.pi if s > 0 else math.pi, 24)
        strip((-GW, s * (HY - 0.15)), (GW, s * (HY - 0.15)), 0.3, mat)  # goal line
    edge = rr_loop(fx - 0.7, fy - 0.7, RC - R1 - 0.7, xs, ys)
    for i, a in enumerate(edge):
        b = edge[(i + 1) % len(edge)]
        if a[4] == "end" and b[4] == "end" and abs(a[0]) <= GW + 1.0 and abs(b[0]) <= GW + 1.0:
            continue
        strip(a[:2], b[:2], 0.3, M["neon_" + team_of((a[1] + b[1]) / 2)], extend=0.15)
    mesh_object("Arena_Lines", lines, collection, parent=root)

    # --- Goals --------------------------------------------------------------------
    for s, team in ((-1, "blue"), (1, "orange")):
        g = MeshBuilder()
        frame, net, netline = M["frame_" + team], M["net_" + team], M["netline_" + team]
        yg, yb = s * HY, s * (HY + GD)
        for xa, xb in zip(mouth_xs, mouth_xs[1:]):
            g.poly([(xa, yg, 0), (xb, yg, 0), (xb, yb, 0), (xa, yb, 0)], M["goalfloor_" + team], facing=(0, 0, 1))
        ramp_arc = [(s * (HY - d), z) for d, z, _, _ in profile[:ramp_count]]
        for sx in (-1, 1):
            # Side faces where the floor ramp is cut off at the goal mouth
            corner = g.vert((sx * GW, yg, 0))
            arc_ids = [g.vert((sx * GW, y, z)) for y, z in ramp_arc]
            for k in range(len(arc_ids) - 1):
                g.face((corner, arc_ids[k], arc_ids[k + 1]), M["ramp"], facing=(-sx, 0, 0))
            g.poly([(sx * GW, yg, 0), (sx * GW, yb, 0), (sx * GW, yb, GH), (sx * GW, yg, GH), (sx * GW, yg, R1)],
                   net, facing=(-sx, 0, 0))
        for xa, xb in zip(mouth_xs, mouth_xs[1:]):  # split like the wall so the edges line up exactly
            g.poly([(xa, yb, 0), (xb, yb, 0), (xb, yb, GH), (xa, yb, GH)], net, facing=(0, -s, 0))
            g.poly([(xa, yg, GH), (xb, yg, GH), (xb, yb, GH), (xa, yb, GH)], net, facing=(0, 0, -1))

        # Glowing frame round the mouth, following the ramp at the bottom of each post
        t = 0.32
        xo, zo = GW + t / 2, GH + t / 2
        path = [(-xo, y, z) for y, z in ramp_arc] + [(-xo, yg, zo), (xo, yg, zo)] + \
               [(xo, y, z) for y, z in reversed(ramp_arc)]
        for p0, p1 in zip(path, path[1:]):
            add_beam(g, p0, p1, t, frame, hint=(0, 1, 0), extend=t / 2)
        tb = 0.22
        for sx in (-1, 1):
            x = sx * GW
            add_beam(g, (x, yb, 0), (x, yb, GH), tb, frame, hint=(0, 1, 0), extend=tb / 2)
            add_beam(g, (x, yg, GH), (x, yb, GH), tb, frame, hint=(0, 0, 1), extend=tb / 2)
            add_beam(g, (x, yg, 0), (x, yb, 0), tb, frame, hint=(0, 0, 1), extend=tb / 2)
        add_beam(g, (-GW, yb, GH), (GW, yb, GH), tb, frame, hint=(0, 1, 0), extend=tb / 2)
        add_beam(g, (-GW, yb, 0), (GW, yb, 0), tb, frame, hint=(0, 1, 0), extend=tb / 2)

        # Net lines
        tn, inset = 0.06, 0.04
        for k in range(1, 8):
            x = -GW + 2 * GW * k / 8
            add_beam(g, (x, yb - s * inset, 0), (x, yb - s * inset, GH), tn, netline, hint=(0, 1, 0))
            add_beam(g, (x, yg, GH - inset), (x, yb, GH - inset), tn, netline)
        for k in (1, 2):
            z = GH * k / 3
            add_beam(g, (-GW, yb - s * inset, z), (GW, yb - s * inset, z), tn, netline, hint=(0, 1, 0))
            for sx in (-1, 1):
                add_beam(g, (sx * (GW - inset), yg, z), (sx * (GW - inset), yb, z), tn, netline, hint=(1, 0, 0))
        for k in (1, 2, 3):
            y = s * (HY + GD * k / 4)
            for sx in (-1, 1):
                add_beam(g, (sx * (GW - inset), y, 0), (sx * (GW - inset), y, GH), tn, netline, hint=(1, 0, 0))
            add_beam(g, (-GW, y, GH - inset), (GW, y, GH - inset), tn, netline)
        mesh_object(f"Arena_Goal_{team.title()}", g, collection, parent=root)

    # --- Stands ---------------------------------------------------------------------
    SX, SY, SR = HX + 4.0, HY + GD + 4.0, RC + 4.0
    sxs, sys_ = split(-(SX - SR), SX - SR, 6), split(-(SY - SR), SY - SR, 10)
    base = rr_loop(SX, SY, SR, sxs, sys_)
    z0 = STAND_Z0
    rows = [(0.0, -0.3), (0.0, z0 - 1.4), (0.0, z0 - 0.2), (0.0, z0)]
    kinds = ["concrete", "led", "concrete"]
    for t in range(STAND_TIERS):
        rows += [((t + 1) * STAND_DEPTH, z0 + t * STAND_RISE), ((t + 1) * STAND_DEPTH, z0 + (t + 1) * STAND_RISE)]
        kinds += ["seat", "riser"]
    top_o, top_z = STAND_TIERS * STAND_DEPTH, z0 + STAND_TIERS * STAND_RISE
    rows += [(top_o, top_z + 1.4), (top_o, top_z + 2.4), (top_o, top_z + 3.4), (top_o + 1.0, top_z + 3.4)]
    kinds += ["back", "led", "back", "seat"]

    stands = MeshBuilder()
    sid = [[stands.vert((x + nx * o, y + ny * o, z)) for o, z in rows] for x, y, nx, ny, _ in base]
    for i, a in enumerate(base):
        i2 = (i + 1) % len(base)
        b = base[i2]
        team = team_of((a[1] + b[1]) / 2)
        inward = (-(a[2] + b[2]), -(a[3] + b[3]), 0.0)
        for j, kind in enumerate(kinds):
            if kind == "led":
                m = M["led_white"] if i % 3 == 1 else M["led_" + team]
            elif kind == "riser":
                m = M["riser_" + team]
            else:
                m = M[kind]
            stands.face((sid[i][j], sid[i2][j], sid[i2][j + 1], sid[i][j + 1]), m,
                        facing=(0, 0, 1) if kind == "seat" else inward)
    ground = MeshBuilder()
    ground.poly([(-70, -90, -0.3), (70, -90, -0.3), (70, 90, -0.3), (-70, 90, -0.3)], M["ground"], facing=(0, 0, 1))
    mesh_object("Arena_Ground", ground, collection, parent=root)
    mesh_object("Arena_Stands", stands, collection, parent=root)

    # --- Crowd: one simple block per fan, blue fans on the blue half ------------------
    rng = random.Random(CROWD_SEED)
    crowd = MeshBuilder()
    fans = {team: [(M["crowd_" + team], 5), (M["crowd2_" + team], 2), (M["crowd_white"], 2), (M["crowd_dark"], 2)]
            for team in TEAMS}
    for t in range(STAND_TIERS):
        o = t * STAND_DEPTH + 0.8
        z = z0 + t * STAND_RISE
        for px, py, nx, ny in rr_sample(SX + o, SY + o, SR + o, 1.9):
            if rng.random() > 0.6:
                continue
            pick = rng.uniform(0, 11)
            for m, weight in fans[team_of(py)]:
                pick -= weight
                if pick <= 0:
                    break
            h = 0.7 + rng.random() * 0.25
            u, v = (-ny, nx, 0.0), (-nx, -ny, 0.0)
            shift = (rng.random() - 0.5) * 0.3
            add_box(crowd, (px + u[0] * shift, py + u[1] * shift, z + h / 2), (0.22 + rng.random() * 0.05, 0.17, h / 2),
                    m, (u, v, (0.0, 0.0, 1.0)), skip=("-z", "-y"))  # no bottom or back: never seen
    mesh_object("Arena_Crowd", crowd, collection, parent=root)

    # --- Floodlight towers at the four corners ------------------------------------------
    lights = MeshBuilder()
    reach = (SR + top_o + 7.0) * math.sqrt(0.5)
    for cx in (-1, 1):
        for cy in (-1, 1):
            x, y = cx * (SX - SR + reach), cy * (SY - SR + reach)
            add_box(lights, (x, y, 15.0), (0.7, 0.7, 15.0), M["frame"])
            d = v_norm((-x, -y, 0.0))
            axes = ((-d[1], d[0], 0.0), (-d[0], -d[1], 0.0), (0.0, 0.0, 1.0))
            add_box(lights, (x + d[0] * 0.6, y + d[1] * 0.6, 30.5), (3.0, 0.3, 1.6), M["frame"], axes)
            add_box(lights, (x + d[0] * 0.92, y + d[1] * 0.92, 30.5), (2.7, 0.05, 1.35), M["floodlight"], axes)
    mesh_object("Arena_Lights", lights, collection, parent=root)

    root["half_width"] = HX
    root["half_length"] = HY
    root["height"] = H
    root["corner_radius"] = RC
    root["floor_curve_radius"] = R1
    root["ceiling_curve_radius"] = R2
    root["goal_half_width"] = GW
    root["goal_height"] = GH
    root["goal_depth"] = GD
    return root


# =============================================================================
# Layout (boost pads, kickoff spots), in three.js coordinates
# =============================================================================
# Positions follow Rocket League's standard map, scaled to this arena.

BIG_PADS_UU = [(-3584, 0), (3584, 0), (-3072, -4096), (3072, -4096), (-3072, 4096), (3072, 4096)]
SMALL_PADS_UU = [
    (0, -4240), (-1792, -4184), (1792, -4184), (-940, -3308), (940, -3308), (0, -2816), (-3584, -2484),
    (3584, -2484), (-1788, -2300), (1788, -2300), (-2048, -1036), (0, -1024), (2048, -1036), (-1024, 0),
    (1024, 0), (-2048, 1036), (0, 1024), (2048, 1036), (-1788, 2300), (1788, 2300), (-3584, 2484), (3584, 2484),
    (0, 2816), (-940, 3310), (940, 3308), (-1792, 4184), (1792, 4184), (0, 4240),
]
KICKOFF_UU = [(-2048, -2560), (2048, -2560), (-256, -3840), (256, -3840), (0, -4608)]  # blue side


def to_three(p):
    """Blender (x, y, z) -> three.js / glTF (x, z, -y)."""
    return (round(p[0], 4), round(p[2], 4), round(-p[1], 4) + 0.0)


def from_uu(x, y):
    return (x / 4096 * ARENA_HALF_WIDTH, y / 5120 * ARENA_HALF_LENGTH)


def layout_data():
    pads = [{"size": "big", "position": list(to_three((*from_uu(x, y), 0.0)))} for x, y in BIG_PADS_UU]
    pads += [{"size": "small", "position": list(to_three((*from_uu(x, y), 0.0)))} for x, y in SMALL_PADS_UU]
    spawns = {"blue": [], "orange": []}
    for x, y in KICKOFF_UU:
        for team, sign in (("blue", 1), ("orange", -1)):
            bx, by = from_uu(sign * x, sign * y)
            p = to_three((bx, by, 0.0))
            yaw = math.atan2(-p[0], -p[2])  # rotation.y that points the car's +Z at the ball
            spawns[team].append({"position": list(p), "yaw": round(yaw, 4)})
    return {
        "about": "Turbo Kickoff arena layout. Metres, three.js axes (Y up). "
                 "Blue defends the goal at +Z, orange the goal at -Z. Cars face +Z before rotation.",
        "arena": {
            "half_width": ARENA_HALF_WIDTH, "half_length": ARENA_HALF_LENGTH, "height": ARENA_HEIGHT,
            "corner_radius": CORNER_RADIUS, "floor_curve_radius": FLOOR_CURVE,
            "ceiling_curve_radius": CEILING_CURVE,
        },
        "goal": {
            "half_width": GOAL_HALF_WIDTH, "height": GOAL_HEIGHT, "depth": GOAL_DEPTH,
            "blue_goal_line_z": ARENA_HALF_LENGTH, "orange_goal_line_z": -ARENA_HALF_LENGTH,
        },
        "ball": {"radius": BALL_RADIUS, "spawn": [0.0, BALL_RADIUS, 0.0]},
        "car": {
            "hitbox_size": list(CAR_HITBOX["size"]),
            "hitbox_offset": list(to_three(CAR_HITBOX["center"])),
            "front_wheel_radius": CAR_WHEELS[0][3], "rear_wheel_radius": CAR_WHEELS[2][3],
            "wheels": {name: list(to_three((x, y, r))) for name, x, y, r, _ in CAR_WHEELS},
        },
        "boost_pads": pads,
        "kickoff_spawns": spawns,
    }


# =============================================================================
# Scene housekeeping and export
# =============================================================================

TOP_COLLECTION = "Turbo Kickoff"


def remove_collection_tree(coll):
    for child in list(coll.children):
        remove_collection_tree(child)
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.collections.remove(coll)


def clear_previous_run():
    old = bpy.data.collections.get(TOP_COLLECTION)
    if old is not None:
        remove_collection_tree(old)
    for me in list(bpy.data.meshes):
        if me.name.startswith("TK_") and me.users == 0:
            bpy.data.meshes.remove(me)


def tidy_scene():
    active = bpy.context.view_layer.objects.active
    if active is not None and active.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    cube = bpy.data.objects.get("Cube")
    if (DELETE_DEFAULT_CUBE and cube is not None and cube.type == "MESH"
            and len(cube.data.vertices) == 8 and cube.location.length < 1e-6):
        bpy.data.objects.remove(cube, do_unlink=True)


def resolve_export_dir():
    if EXPORT_DIR.strip():
        return os.path.abspath(os.path.expanduser(EXPORT_DIR.strip()))
    script = ""
    try:  # opened from disk in the Text Editor?
        space = bpy.context.space_data
        if space is not None and space.type == "TEXT_EDITOR" and space.text and space.text.filepath:
            script = bpy.path.abspath(space.text.filepath)
    except AttributeError:
        pass
    if not script:  # run with: blender --background --python turbo_kickoff_assets.py
        candidate = globals().get("__file__", "")
        if candidate and os.path.isfile(candidate):
            script = candidate
    if script:
        game_dir = os.path.dirname(os.path.dirname(os.path.abspath(script)))
        if os.path.isdir(os.path.join(game_dir, "assets")):
            return os.path.join(game_dir, "assets", "models")
    return os.path.join(os.path.expanduser("~"), "TurboKickoff", "models")


def object_tree(root):
    out, stack = [], [root]
    while stack:
        ob = stack.pop()
        out.append(ob)
        stack.extend(ob.children)
    return out


def deselect_all():
    bpy.context.view_layer.update()
    for ob in bpy.context.view_layer.objects:
        if ob is not None:
            ob.select_set(False)


def export_glb(root, path):
    deselect_all()
    for ob in object_tree(root):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    wanted = {
        "filepath": path, "export_format": "GLB", "use_selection": True, "export_apply": True,
        "export_yup": True, "export_extras": True, "export_materials": "EXPORT",
        "export_cameras": False, "export_lights": False, "export_animations": False,
    }
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in known})
    print(f"  wrote {os.path.basename(path)} ({os.path.getsize(path) / 1024:.0f} KB)")


def show_message(lines):
    for line in lines:
        print(line)
    if bpy.app.background:
        return
    try:
        def draw(self, _context):
            for line in lines:
                self.layout.label(text=line)

        bpy.context.window_manager.popup_menu(draw, title="Turbo Kickoff", icon="INFO")
    except Exception:
        pass  # no window (background mode): the console output is enough


def set_viewport_to_material_preview():
    try:
        for area in bpy.context.screen.areas:
            if area.type == "VIEW_3D":
                for space in area.spaces:
                    if space.type == "VIEW_3D":
                        space.shading.type = "MATERIAL"
                        space.clip_end = max(space.clip_end, 2000.0)
    except AttributeError:
        pass


def blender_yaw_towards_centre(x, y):
    """rotation_euler.z that turns a car (which faces -Y) towards the arena centre."""
    return math.atan2(-x, y)


def main():
    tidy_scene()
    clear_previous_run()
    out_dir = resolve_export_dir()
    os.makedirs(out_dir, exist_ok=True)
    print(f"\nTurbo Kickoff: building assets, exporting to {out_dir}")

    top = bpy.data.collections.new(TOP_COLLECTION)
    bpy.context.scene.collection.children.link(top)

    def sub(name):
        coll = bpy.data.collections.new(name)
        top.children.link(coll)
        return coll

    ball = build_ball(sub("TK Ball"))
    export_glb(ball, os.path.join(out_dir, "ball.glb"))

    pad_coll = sub("TK Boost Pads")
    pad_mats = pad_materials()
    small_pad = build_small_pad(pad_coll, pad_mats)
    export_glb(small_pad, os.path.join(out_dir, "boost_pad_small.glb"))
    big_pad = build_big_pad(pad_coll, pad_mats)
    export_glb(big_pad, os.path.join(out_dir, "boost_pad_big.glb"))

    arena = build_arena(sub("TK Arena"))
    export_glb(arena, os.path.join(out_dir, "arena.glb"))

    cars = {}
    for team in TEAMS:
        car = build_car(team, sub(f"TK Car {team.title()}"))
        export_glb(car, os.path.join(out_dir, f"car_{team}.glb"))
        for ob in object_tree(car):  # rename after export so the next car can reuse the part names
            if ob is not car:
                ob.name = f"{team.title()}_{ob.name}"
        cars[team] = car

    layout = layout_data()
    with open(os.path.join(out_dir, "arena_layout.json"), "w", encoding="utf-8") as fh:
        json.dump(layout, fh, indent=2)
    print("  wrote arena_layout.json")

    # Arrange a preview in the viewport: ball on the centre spot, cars on kickoff
    # spots, boost pads around the pitch. Nothing below changes the exported files.
    ball.location = (0.0, 0.0, BALL_RADIUS)
    for team, spot in (("blue", (-18.0, -24.0)), ("orange", (18.0, 24.0))):
        cars[team].location = (spot[0], spot[1], 0.0)
        cars[team].rotation_euler = (0.0, 0.0, blender_yaw_towards_centre(*spot))
    preview = sub("TK Preview (not exported)")
    templates = {"big": big_pad, "small": small_pad}
    placed = {"big": False, "small": False}
    for pad in layout["boost_pads"]:
        x, _, z = pad["position"]
        template = templates[pad["size"]]
        if not placed[pad["size"]]:
            template.location = (x, -z, 0.0)
            placed[pad["size"]] = True
            continue
        copy_root = template.copy()
        preview.objects.link(copy_root)
        copy_root.location = (x, -z, 0.0)
        for child in template.children:
            c = child.copy()
            preview.objects.link(c)
            c.parent = copy_root
    deselect_all()
    set_viewport_to_material_preview()

    show_message([
        "Turbo Kickoff assets exported to:",
        out_dir,
        "car_blue.glb, car_orange.glb, ball.glb, arena.glb,",
        "boost_pad_small.glb, boost_pad_big.glb, arena_layout.json",
    ])


main()
