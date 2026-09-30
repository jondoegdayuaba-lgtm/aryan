"""Builds Canyon Rush's three e-bikes in Blender and exports canyon-rush/models/bike-<id>.glb.

Run it with Blender's Python module (pip install bpy==4.2.0, Python 3.11):
    python tools/blender/bikes.py [--preview /tmp/bike]
or inside Blender: blender -b -P tools/blender/bikes.py

Each bike is split into the parts that move on their own, named the way the
game's bikemodel.js groups them:
    body      frame, battery, motor, side panels, seat, tail, pegs
    fork      clamps, upper fork tubes, bars, number plate, headlight, fender
    slider    lower fork legs, guards, axle and front caliper (slides on the fork)
    wheelF    front wheel: tyre, rim, spokes, hub and disc (spins)
    swingarm  arms, chain and rear caliper (pivots)
    wheelR    rear wheel, with the sprocket (spins)
Each part's mesh is in that part's own frame (the fork's Y axis is the
steering axis, wheels turn about X, the swingarm runs back along +Z from the
pivot), and the objects are placed on the bike at rest so the file looks right
in Blender. The dimensions come from the same numbers the game's physics and
bikemodel.js use, so the wheels, pegs, grips and pivots line up.

Coordinates in this script are the game's (x right, y up, forward is -z);
parts are turned into Blender's z-up space just before export, and the glTF
exporter turns them back.
"""
import math
import os
import sys

import bpy  # noqa: I001  (first: it sets up bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT_DIR = os.path.join(ROOT, 'canyon-rush', 'models')
PREVIEW = args[args.index('--preview') + 1] if '--preview' in args else None
ONLY = args[args.index('--only') + 1] if '--only' in args else None

V = Vector

# Must match BIKES in canyon-rush/js/game/bike.js and LOOKS' style in bikemodel.js.
BIKES = {
    'volt': dict(wheelbase=1.26, cgBack=0.62, radius=0.32, travelF=0.22, travelR=0.24, style='bee'),
    'sting': dict(wheelbase=1.3, cgBack=0.64, radius=0.33, travelF=0.24, travelR=0.25, style='bee'),
    'storm': dict(wheelbase=1.48, cgBack=0.72, radius=0.36, travelF=0.3, travelR=0.31, style='mx'),
}

# Preview colours only: the game sets its own per bike.
PREVIEW_COLOURS = {
    'panel': (0.1, 0.1, 0.11), 'plastic': (0.1, 0.1, 0.11), 'accent': (0.25, 0.9, 0.1), 'plate': (0.9, 0.9, 0.9),
    'black': (0.02, 0.02, 0.02), 'frame': (0.15, 0.16, 0.17), 'battery': (0.05, 0.05, 0.05), 'alu': (0.7, 0.72, 0.75),
    'steel': (0.5, 0.52, 0.55), 'fork': (0.03, 0.03, 0.035), 'stanchion': (0.8, 0.6, 0.25), 'rim': (0.05, 0.05, 0.05),
    'seat': (0.05, 0.05, 0.06), 'rubber': (0.03, 0.03, 0.03), 'tread': (0.02, 0.02, 0.02), 'chain': (0.2, 0.19, 0.18),
    'lamp': (1, 1, 0.95), 'tail': (0.6, 0.02, 0.01), 'caliper': (0.8, 0.1, 0.1),
}
MATS = {}


def material(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*PREVIEW_COLOURS.get(name, (0.5, 0.5, 0.5)), 1)
        b.inputs['Roughness'].default_value = 0.5
        b.inputs['Metallic'].default_value = 1.0 if name in ('alu', 'steel', 'stanchion', 'chain') else 0.0
        MATS[name] = m
    return MATS[name]


def dims(spec):
    """Key points of a bike, as bikemodel.js works them out."""
    mx = spec['style'] == 'mx'
    R = spec['radius']
    zf, zr = -(spec['wheelbase'] - spec['cgBack']), spec['cgBack']
    k = spec['wheelbase'] / 1.26
    D = dict(mx=mx, R=R, zf=zf, zr=zr, k=k, W=1.1 if mx else 1.0)
    D['seatY'] = 0.96 if mx else 0.86 * min(1.05, k)
    D['rake'] = 0.44
    D['offset'] = 0.035
    D['pivot'] = V((0, 0.5 if mx else 0.44, 0.12 * k))
    D['peg'] = V((0.19, 0.4 if mx else 0.36, 0.14 * k))
    D['shockTop'] = V((0, 0.86 if mx else 0.78, 0.2 * k))
    D['axisDir'] = V((0, math.cos(D['rake']), math.sin(D['rake'])))
    D['axisBase'] = V((0, R, zf + D['offset'] / math.cos(D['rake'])))
    D['forkLen'] = 0.86 if mx else 0.76
    on_axis = lambda t: D['axisBase'] + D['axisDir'] * t
    D['headTop'] = on_axis(D['forkLen'])
    D['headBot'] = on_axis(D['forkLen'] - (0.2 if mx else 0.17))
    D['barW'] = 0.4 if mx else 0.37
    D['spread'] = 0.085 * D['W']
    D['armLen'] = math.hypot(zr - D['pivot'].z, D['pivot'].y - R)
    D['rimF'] = R - 0.075
    D['rimR'] = R - 0.085
    D['tyreW'] = (0.085 if mx else 0.075, 0.105 if mx else 0.09)
    return D


# ---------------------------------------------------------------- mesh helpers
class Part:
    """Collects geometry for one moving part, by material, in the part's frame."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []

    def mat_index(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, bm_src, mat, uv_fn=None, smooth=True, xform=None):
        """Merge a bmesh in, with a material and optional UVs from positions."""
        if xform is not None:
            bmesh.ops.transform(bm_src, matrix=xform, verts=bm_src.verts)
        idx = self.mat_index(mat)
        me = bpy.data.meshes.new('tmp')
        bm_src.to_mesh(me)
        bm_src.free()
        n0 = len(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[n0:]:
            f.material_index = idx
            f.smooth = smooth
            if uv_fn:
                for loop in f.loops:
                    loop[self.uv].uv = uv_fn(loop.vert.co)

    def to_object(self, location=V(), rotation=Matrix.Identity(3), collection=None):
        # Game space (y up) to Blender (z up): +90 degrees about x.
        conv = Matrix.Rotation(math.radians(90), 4, 'X')
        bmesh.ops.transform(self.bm, matrix=conv, verts=self.bm.verts)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.collection).objects.link(ob)
        ob.matrix_world = conv @ Matrix.Translation(location) @ rotation.to_4x4() @ conv.inverted()
        return ob


def catmull(points, n):
    """Points along a centripetal-ish Catmull-Rom spline through `points`."""
    P = [points[0] + (points[0] - points[1])] + list(points) + [points[-1] + (points[-1] - points[-2])]
    out = []
    segs = len(points) - 1
    for i in range(n + 1):
        t = i / n * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u))
    return out


def sweep(path, radius, sides=10, closed=False, caps=True, rx=None, ry=None):
    """A tube along a polyline (radius may be a function of 0..1), with parallel-transport frames."""
    bm = bmesh.new()
    n = len(path)
    tangents = []
    for i in range(n):
        a = path[max(0, i - 1)] if not closed else path[(i - 1) % n]
        b = path[min(n - 1, i + 1)] if not closed else path[(i + 1) % n]
        tangents.append((b - a).normalized())
    ref = V((1, 0, 0)) if abs(tangents[0].x) < 0.9 else V((0, 1, 0))
    normal = (ref - tangents[0] * ref.dot(tangents[0])).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        normal = (normal - t * normal.dot(t)).normalized()
        binormal = t.cross(normal)
        r = radius(i / (n - 1)) if callable(radius) else radius
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides
            ox = math.cos(a) * r * (rx or 1)
            oy = math.sin(a) * r * (ry or 1)
            ring.append(bm.verts.new(path[i] + normal * ox + binormal * oy))
        rings.append(ring)
    count = n if closed else n - 1
    for i in range(count):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for s in range(sides):
            bm.faces.new((r0[s], r0[(s + 1) % sides], r1[(s + 1) % sides], r1[s]))
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm


def tube(points, radius, n=24, sides=10, **kw):
    return sweep(catmull([V(p) for p in points], n), radius, sides, **kw)


def lathe(profile, segments=48, axis='x'):
    """Surface of revolution about x: profile is [(r, x)] points."""
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        rings.append([bm.verts.new(V((x, math.cos(a) * r, math.sin(a) * r))) for r, x in profile])
    for i in range(segments):
        r0, r1 = rings[i], rings[(i + 1) % segments]
        for j in range(len(profile) - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    return bm


def thicken(bm, faces, offset):
    """Extrude faces by a vector, keeping the originals, so a flat shape becomes a closed solid."""
    ret = bmesh.ops.extrude_face_region(bm, geom=list(faces), use_keep_orig=True)
    bmesh.ops.translate(bm, vec=V(offset), verts=[e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box(center, size, bevel=0.0, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.49), segments=segments, profile=0.5, affect='EDGES')
    bmesh.ops.translate(bm, vec=V(center), verts=bm.verts)
    return bm


def cylinder_x(center, r, width, segs=24, r2=None):
    """A capped cylinder along x."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r2 if r2 is not None else r, depth=width)
    bmesh.ops.rotate(bm, cent=V(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(center), verts=bm.verts)
    return bm


def cylinder_y(center, r, height, segs=16, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r2 if r2 is not None else r, depth=height)
    bmesh.ops.rotate(bm, cent=V(), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(center), verts=bm.verts)
    return bm


def slab(profile_zy, x0, x1, bevel=0.006, bulge=0.0, bevel_segments=3):
    """A side profile [(z, y)] extruded across x from x0 to x1, edges rounded.
    `bulge` pushes the middle of the outer face outward (panels look moulded)."""
    bm = bmesh.new()
    verts = [bm.verts.new(V((x0, y, z))) for z, y in profile_zy]
    face = bm.faces.new(verts)
    thicken(bm, [face], (x1 - x0, 0, 0))
    if bulge:
        zs = [p[0] for p in profile_zy]
        ys = [p[1] for p in profile_zy]
        zc, yc = (min(zs) + max(zs)) / 2, (min(ys) + max(ys)) / 2
        hz, hy = (max(zs) - min(zs)) / 2, (max(ys) - min(ys)) / 2
        outer = x1 if abs(x1) > abs(x0) else x0
        sign = 1 if outer > 0 else -1
        # Subdivide the big faces so the bulge has something to bend.
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.05], cuts=2, use_grid_fill=True)
        for v in bm.verts:
            u = 1 - min(1.0, ((v.co.z - zc) / hz) ** 2)
            w = 1 - min(1.0, ((v.co.y - yc) / hy) ** 2)
            v.co.x += sign * bulge * u * w
    if bevel > 0:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=bevel_segments, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def sheet(path_zy, width_fn, x_fn=lambda t: 0.0, droop=0.02, thickness=0.005, n=30, m=8):
    """A curved plastic sheet (fenders): runs along a side path, arched across its width."""
    pts = catmull([V((0, y, z)) for z, y in path_zy], n)
    bm = bmesh.new()
    layers = []
    for layer in (0, 1):
        grid = []
        for i, p in enumerate(pts):
            t = i / n
            a = (pts[min(n, i + 1)] - pts[max(0, i - 1)]).normalized()
            up = V((0, -a.z, a.y))           # across the path, in the side plane
            if up.y < 0:
                up = -up
            w = width_fn(t)
            row = []
            for j in range(m + 1):
                u = j / m * 2 - 1
                q = p + V((x_fn(t) + u * w / 2, 0, 0)) - up * (droop * u * u + layer * thickness)
                row.append(bm.verts.new(q))
            grid.append(row)
        layers.append(grid)
    top, bot = layers
    for i in range(n):
        for j in range(m):
            bm.faces.new((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
            bm.faces.new((bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]))
    for i in range(n):
        for j in (0, m):
            bm.faces.new((top[i][j], top[i + 1][j], bot[i + 1][j], bot[i][j]))
    for j in range(m):
        for i in (0, n):
            bm.faces.new((top[i][j], bot[i][j], bot[i][j + 1], top[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def side_uv(z0, z1, y0, y1):
    """Side-on UVs over a z/y box (for the livery canvas), mirrored on the left."""
    def f(co):
        u = (co.z - z0) / (z1 - z0)
        v = (co.y - y0) / (y1 - y0)
        return (u if co.x < 0 else 1 - u, v)
    return f


# ---------------------------------------------------------------- the bike
def build_bike(bike_id, spec):
    D = dims(spec)
    mx, R, W = D['mx'], D['R'], D['W']
    zf, zr, seatY = D['zf'], D['zr'], D['seatY']
    pv, peg = D['pivot'], D['peg']
    pz, py = pv.z, pv.y
    ht, hb = D['headTop'], D['headBot']
    tz, ty, hz, hy = ht.z, ht.y, hb.z, hb.y
    col = bpy.data.collections.new(bike_id)
    bpy.context.scene.collection.children.link(col)

    # ------------------------------------------------ body
    body = Part('body')
    # Head tube along the steering axis.
    axis = D['axisDir']
    a0, a1 = hb - axis * 0.03, ht + axis * 0.03
    body.add(sweep([a0, a1], 0.04, 18), 'frame')
    # Twin spars from the head tube round the battery to the swingarm pivot, a
    # cradle under the battery, and the subframe under the seat.
    mxo = 0.03 if mx else 0.0
    for sx in (-1, 1):
        x = sx * 0.1 * W
        spar = [(x, ty - 0.03, tz + 0.02), (x, seatY - 0.06, tz + 0.25), (x, seatY - 0.16, pz - 0.02), (x, py + 0.12, pz + 0.02), (x, py, pz + 0.02)]
        body.add(tube(spar, 0.026 * W, sides=12, rx=0.75, ry=1.2), 'frame')
        down = [(x * 0.92, hy + 0.02, hz), (x * 0.92, 0.5, hz + 0.08), (x * 0.92, 0.32 + mxo, hz + 0.14), (x * 0.92, 0.3 + mxo + 0.01, pz - 0.12), (x * 0.92, py - 0.04, pz)]
        body.add(tube(down, 0.02 * W, sides=10), 'frame')
        body.add(tube([(x * 0.85, py + 0.1, pz + 0.03), (x * 0.85, seatY - 0.1, zr - 0.12), (x * 0.85, seatY - 0.06, zr + 0.1)], 0.013, sides=8), 'frame')
        body.add(tube([(x * 0.85, seatY - 0.16, pz - 0.02), (x * 0.85, seatY - 0.08, zr - 0.06)], 0.012, sides=8), 'frame')
        # Gusset plate at the pivot.
        body.add(slab([(pz - 0.07, py + 0.08), (pz + 0.05, py + 0.1), (pz + 0.06, py - 0.05), (pz - 0.06, py - 0.07)], x - sx * 0.008, x + sx * 0.008, bevel=0.004), 'frame')
    # Cross member behind the head tube.
    body.add(cylinder_x((0, ty - 0.08, tz + 0.08), 0.018, 0.2 * W, 12), 'frame')

    # Battery pack, with cooling ribs, and a skid plate under it.
    bz0, bz1 = hz + 0.1, pz - 0.06
    by0, by1 = (0.36 if mx else 0.33), seatY - (0.12 if mx else 0.1)
    body.add(box(((0), (by0 + by1) / 2, (bz0 + bz1) / 2), (0.19 * W, by1 - by0, bz1 - bz0), bevel=0.02, segments=3), 'battery')
    for i in range(7):
        z = bz0 + 0.04 + i * (bz1 - bz0 - 0.08) / 6
        for sx in (-1, 1):
            body.add(box((sx * 0.097 * W, by0 + 0.07, z), (0.012, 0.09, 0.012), bevel=0.003, segments=1), 'black')
    skid = [(bz0 - 0.06, by0 + 0.06), (bz0 - 0.02, by0 - 0.02), (bz1 - 0.02, by0 - 0.03), (bz1 + 0.06, by0 + 0.01), (bz1 + 0.06, by0 - 0.005), (bz1 - 0.02, by0 - 0.045), (bz0 - 0.03, by0 - 0.035), (bz0 - 0.075, by0 + 0.05)]
    body.add(slab(skid, -0.1 * W, 0.1 * W, bevel=0.004), 'alu')

    # Motor low behind the battery: finned case, end cover with bolts, controller.
    mc = V((0.02, py - 0.06, pz - 0.06))
    body.add(cylinder_x(mc, 0.1 * W, 0.15, 32), 'black')
    for i in range(12):
        a = i / 12 * math.pi
        fin = box((0, 0, 0), (0.15, 0.012, 0.215 * W), bevel=0.002, segments=1)
        bmesh.ops.rotate(fin, cent=V(), matrix=Matrix.Rotation(a, 3, 'X'), verts=fin.verts)
        bmesh.ops.translate(fin, vec=mc, verts=fin.verts)
        body.add(fin, 'black')
    for sx in (-1, 1):
        body.add(cylinder_x(mc + V((sx * 0.08, 0, 0)), 0.075 * W, 0.02, 32, r2=0.068 * W), 'alu')
        for i in range(6):
            a = i / 6 * 2 * math.pi
            body.add(cylinder_x(mc + V((sx * 0.091, math.cos(a) * 0.055 * W, math.sin(a) * 0.055 * W)), 0.008, 0.008, 8), 'steel')
    body.add(box((0, by0 - 0.035, (bz0 + bz1) / 2 - 0.05), (0.12, 0.07, 0.2), bevel=0.01), 'black')

    # Side panels over the battery (the livery goes on these), gently domed.
    if mx:
        panel = [(tz + 0.06, ty - 0.06), (tz + 0.34, seatY + 0.02), (pz + 0.02, seatY - 0.02), (pz - 0.02, by0 + 0.2), (hz + 0.08, by0 + 0.16), (hz - 0.02, hy - 0.08)]
    else:
        panel = [(tz + 0.08, ty - 0.08), (tz + 0.3, seatY - 0.02), (pz - 0.02, seatY - 0.05), (pz - 0.06, by0 + 0.1), (hz + 0.1, by0 + 0.08), (hz + 0.02, hy - 0.06)]
    for sx in (-1, 1):
        x0 = sx * 0.099 * W
        body.add(slab(panel, x0, x0 + sx * 0.018, bevel=0.007, bulge=0.018), 'panel', uv_fn=side_uv(hz - 0.05, pz + 0.05, by0, seatY + 0.05))
    # Top cover between the panels, in front of the seat.
    cover = [(tz + 0.05, ty - 0.02), (tz + 0.34, seatY + 0.005), (tz + 0.34, seatY - 0.07), (tz + 0.06, ty - 0.1)]
    body.add(slab(cover, -0.1 * W, 0.1 * W, bevel=0.02, bevel_segments=4), 'plastic')

    # Seat: long, flat and padded.
    seat = [(tz + 0.3, seatY - 0.045), (tz + 0.33, seatY + 0.01), (tz + 0.45, seatY + 0.028), (zr - 0.02, seatY + 0.032), (zr + 0.07, seatY + 0.015), (zr + 0.05, seatY - 0.045), (tz + 0.34, seatY - 0.065)]
    body.add(slab(seat, -0.11 * W, 0.11 * W, bevel=0.035, bevel_segments=5), 'seat')

    # Rear fender: sweeps up and back from under the seat, arched across.
    tail_end = zr + (0.3 if mx else 0.22)
    body.add(sheet([(zr - 0.1, seatY - 0.05), (zr + 0.05, seatY - 0.02), (tail_end - 0.04, seatY + 0.045), (tail_end, seatY + 0.06)],
                   lambda t: (0.2 - 0.06 * t) * W, droop=0.03, thickness=0.006), 'plastic')
    # Side number plates under the seat on the MX bike.
    if mx:
        side = [(pz + 0.1, seatY - 0.075), (zr + 0.14, seatY - 0.045), (zr + 0.02, seatY - 0.24), (pz + 0.13, seatY - 0.25)]
        for sx in (-1, 1):
            x0 = sx * 0.125 * W
            body.add(slab(side, x0, x0 + sx * 0.01, bevel=0.004, bulge=0.006), 'plate', uv_fn=side_uv(pz + 0.1, zr + 0.14, seatY - 0.25, seatY - 0.045))
    # Tail light.
    tl = box((0, seatY + 0.03, tail_end - 0.035), (0.09, 0.026, 0.028), bevel=0.008)
    bmesh.ops.rotate(tl, cent=V((0, seatY + 0.03, tail_end - 0.035)), matrix=Matrix.Rotation(-0.5, 3, 'X'), verts=tl.verts)
    body.add(tl, 'tail')

    # Foot pegs, serrated, on black mounts; shock mount; chain guide.
    for sx in (-1, 1):
        px = sx * (peg.x + 0.01)
        body.add(box((px, peg.y, peg.z), (0.09, 0.022, 0.05), bevel=0.004, segments=1), 'steel')
        for i in range(5):
            for e in (-1, 1):
                body.add(box((px + (i - 2) * 0.017, peg.y + 0.013, peg.z + e * 0.02), (0.006, 0.01, 0.008), bevel=0.001, segments=1), 'steel')
        body.add(box((sx * 0.13, peg.y + 0.05, peg.z), (0.06, 0.1, 0.05), bevel=0.008), 'black')
    st = D['shockTop']
    body.add(box((0, st.y, st.z), (0.1, 0.06, 0.06), bevel=0.01), 'frame')
    body.to_object(collection=col)

    # ------------------------------------------------ fork (steering axis = y)
    fork = Part('fork')
    fl, sp, off = D['forkLen'], D['spread'], D['offset']
    clamp_lo = fl - (0.2 if mx else 0.17)
    for t, depth in ((clamp_lo, 0.09), (fl, 0.08)):
        c = slab([(-0.04, t - 0.018), (0.035, t - 0.018), (0.045, t + 0.018), (-0.05, t + 0.018)], -(sp + 0.045), sp + 0.045, bevel=0.01)
        fork.add(c, 'alu')
    # Upper fork tubes (upside-down fork: fat tubes in the clamps).
    outer_bot = fl - 0.52
    for sx in (-1, 1):
        fork.add(cylinder_y((sx * sp, (outer_bot + fl + 0.03) / 2, -off), 0.031, fl + 0.03 - outer_bot, 20), 'fork')
        fork.add(cylinder_y((sx * sp, outer_bot + 0.01, -off), 0.034, 0.03, 20), 'alu')
        fork.add(cylinder_y((sx * sp, fl + 0.035, -off), 0.022, 0.012, 16), 'alu')
    # Bars: a tapered MX bar in two clamps, with a pad in the middle.
    bw = D['barW']
    bar = [(-bw, fl + 0.1, 0.06), (-bw * 0.55, fl + 0.08, 0.04), (-0.08, fl + 0.06, 0.0), (0.08, fl + 0.06, 0.0), (bw * 0.55, fl + 0.08, 0.04), (bw, fl + 0.1, 0.06)]
    fork.add(tube(bar, lambda t: 0.011 + 0.004 * (1 - abs(2 * t - 1)) ** 0.5, n=40, sides=10), 'alu')
    for sx in (-1, 1):
        fork.add(box((sx * 0.045, fl + 0.045, 0.0), (0.035, 0.04, 0.05), bevel=0.008), 'black')
        # Grips (the rider's hands go here: see gripLocal in bikemodel.js).
        g = bw - 0.05
        grip = cylinder_x((sx * g, fl + 0.098, 0.058), 0.019, 0.12, 14)
        fork.add(grip, 'black')
        for i in range(5):
            fork.add(cylinder_x((sx * (g - 0.045 + i * 0.022), fl + 0.098, 0.058), 0.0205, 0.006, 14), 'black')
        # Lever and its master cylinder.
        lv = box((sx * (bw - 0.1), fl + 0.1, -0.035), (0.15, 0.008, 0.018), bevel=0.003, segments=1)
        bmesh.ops.rotate(lv, cent=V((sx * (bw - 0.1), fl + 0.1, -0.035)), matrix=Matrix.Rotation(sx * 0.25, 3, 'Y'), verts=lv.verts)
        fork.add(lv, 'alu')
        fork.add(box((sx * (bw - 0.16), fl + 0.11, 0.035), (0.05, 0.035, 0.03), bevel=0.008), 'black')
    fork.add(box((0, fl + 0.075, 0.005), (0.16, 0.045, 0.06), bevel=0.018, segments=3), 'accent')
    disp = box((0, fl + 0.11, 0.035), (0.09, 0.035, 0.05), bevel=0.008)
    bmesh.ops.rotate(disp, cent=V((0, fl + 0.11, 0.035)), matrix=Matrix.Rotation(-0.5, 3, 'X'), verts=disp.verts)
    fork.add(disp, 'black')
    # Front number plate with the headlight in it.
    pw, ph = (0.27, 0.25) if mx else (0.23, 0.21)
    pc = V((0, fl - 0.1, -0.095))
    plate_bm = bmesh.new()
    # A shallow curved plate facing forward: x across, y up, pushed out at the middle.
    nu, nv = 10, 8
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u = i / nu * 2 - 1
            v = j / nv * 2 - 1
            p = V((u * pw / 2, v * ph / 2, -0.012 * (1 - u * u) - 0.004 * (1 - v * v)))
            row.append(plate_bm.verts.new(p))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            plate_bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
    thicken(plate_bm, plate_bm.faces, (0, 0, 0.006))
    tilt = Matrix.Translation(pc) @ Matrix.Rotation(-0.18, 4, 'X')
    fork.add(plate_bm, 'plate', uv_fn=lambda co: (0.5 - (co.x - pc.x) / pw, 0.5 + (co.y - pc.y) / ph), xform=tilt)
    lamp = cylinder_x((0, 0, 0), 0.045, 0.02, 24)
    bmesh.ops.rotate(lamp, cent=V(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=lamp.verts)
    fork.add(lamp, 'lamp', xform=Matrix.Translation(V((0, fl - (0.22 if mx else 0.18), -0.115))) @ Matrix.Rotation(-0.18, 4, 'X'))
    # Front fender on the lower clamp, clear of the tyre at full compression.
    fr = R + 0.05
    fc = V((0, spec['travelF'] + 0.03, -off))
    arc = [(fc.z + fr * math.cos(a), fc.y + fr * math.sin(a)) for a in [math.pi * (0.3 + 0.55 * i / 8) for i in range(9)]]
    fork.add(sheet(arc, lambda t: (0.13 - 0.02 * t) * W, droop=0.025, thickness=0.005, n=24), 'plastic')
    fork.to_object(location=D['axisBase'], rotation=Matrix.Rotation(D['rake'], 3, 'X'), collection=col)

    # ------------------------------------------------ slider (moves along the fork)
    slider = Part('slider')
    inner = fl - 0.34
    for sx in (-1, 1):
        slider.add(cylinder_y((sx * sp, 0.05 + inner / 2, -off), 0.024, inner, 20), 'stanchion')
        lug = box((sx * sp, 0.02, -off), (0.06, 0.13, 0.06), bevel=0.02, segments=3)
        slider.add(lug, 'fork')
        guard = slab([(-off - 0.045, 0.04), (-off - 0.035, 0.3), (-off - 0.005, 0.32), (-off + 0.01, 0.05)], sx * (sp + 0.028), sx * (sp + 0.04), bevel=0.004)
        slider.add(guard, 'black')
    slider.add(cylinder_x((0, 0, -off), 0.012, sp * 2 + 0.08, 10), 'alu')
    cal = box((-sp + 0.03, 0.095, -off + 0.07), (0.035, 0.1, 0.07), bevel=0.012, segments=2)
    slider.add(cal, 'caliper')
    slider.to_object(location=D['axisBase'], rotation=Matrix.Rotation(D['rake'], 3, 'X'), collection=col)

    # ------------------------------------------------ wheels
    for front in (True, False):
        wheel = Part('wheelF' if front else 'wheelR')
        rim_r = D['rimF'] if front else D['rimR']
        tw = D['tyreW'][0 if front else 1]
        th = R - rim_r
        # Tyre carcass (sidewall text wrapped round it) and knobs in three staggered rows.
        prof = [(rim_r + th * 0.5 + math.cos(a) * th * 0.5, math.sin(a) * tw * 0.5) for a in [-math.pi / 2 + i / 14 * math.pi for i in range(15)]]
        def tyre_uv(co):
            return ((math.atan2(co.z, co.y) / (2 * math.pi) + 0.5) * 2, 0.5 + co.x * 4)
        wheel.add(lathe(prof, 64), 'rubber', uv_fn=tyre_uv)
        n = round(R * 2 * math.pi / 0.05)
        for i in range(n):
            a = i / n * 2 * math.pi
            for x, row_a, tilt in ((0, 0, 0), (-tw * 0.32, 0.5, 0.45), (tw * 0.32, 0.5, -0.45)):
                aa = a + row_a * 2 * math.pi / n
                r = R - 0.006 - abs(tilt) * 0.012
                # A tapered block, open underneath (it sits in the carcass).
                k = box((0, 0, 0), (0.022, 0.018, 0.026))
                for v in k.verts:
                    if v.co.y > 0:
                        v.co.x *= 0.78
                        v.co.z *= 0.78
                bmesh.ops.delete(k, geom=[f for f in k.faces if f.normal.y < -0.5], context='FACES')
                m = Matrix.Translation(V((x, math.cos(aa) * r, math.sin(aa) * r))) @ Matrix.Rotation(aa, 4, 'X') @ Matrix.Rotation(tilt, 4, 'Z')
                wheel.add(k, 'tread', xform=m, smooth=False)
        # Rim: a channel with a bead lip each side.
        rim = [(rim_r - 0.018, -0.022), (rim_r, -0.025), (rim_r + 0.005, -0.021), (rim_r - 0.003, -0.012), (rim_r - 0.004, 0.0), (rim_r - 0.003, 0.012), (rim_r + 0.005, 0.021), (rim_r, 0.025), (rim_r - 0.018, 0.022), (rim_r - 0.022, 0.0), (rim_r - 0.018, -0.022)]
        wheel.add(lathe(rim, 64), 'rim')
        # Hub with flanges, and crossed spokes with nipples.
        wheel.add(cylinder_x((0, 0, 0), 0.036, 0.13, 24), 'alu')
        for fx in (-0.045, 0.045):
            wheel.add(cylinder_x((fx, 0, 0), 0.054, 0.008, 24), 'alu')
        spokes = 32
        for i in range(spokes):
            side = 1 if i % 2 else -1
            a = i / spokes * 2 * math.pi
            cross = (1 if i % 4 < 2 else -1) * 2 * math.pi * 1.5 / spokes
            p0 = V((side * 0.045, math.cos(a + cross) * 0.048, math.sin(a + cross) * 0.048))
            p1 = V((side * 0.006, math.cos(a) * (rim_r - 0.014), math.sin(a) * (rim_r - 0.014)))
            wheel.add(sweep([p0, p1], 0.0022, 5), 'steel')
            wheel.add(sweep([p1, p1 + (p1 - p0).normalized() * 0.014], 0.0035, 6), 'alu')
        # Brake disc: a wavy rotor on a carrier; left in front, right at the back.
        disc_r = 0.12 if front else 0.1
        dx = -0.07 if front else 0.07
        dbm = bmesh.new()
        outer, inner_ring = [], []
        lobes = 12
        steps = lobes * 8
        for i in range(steps):
            a = i / steps * 2 * math.pi
            ro = disc_r * (1 - 0.05 * (0.5 + 0.5 * math.cos(a * lobes)))
            outer.append(dbm.verts.new(V((dx, math.cos(a) * ro, math.sin(a) * ro))))
            inner_ring.append(dbm.verts.new(V((dx, math.cos(a) * disc_r * 0.7, math.sin(a) * disc_r * 0.7))))
        for i in range(steps):
            j = (i + 1) % steps
            dbm.faces.new((outer[i], outer[j], inner_ring[j], inner_ring[i]))
        thicken(dbm, dbm.faces, (0.004 if not front else -0.004, 0, 0))
        wheel.add(dbm, 'steel', smooth=False)
        for i in range(5):
            a = i / 5 * 2 * math.pi
            arm = box((0, 0, 0), (0.006, 0.018, disc_r * 0.72), bevel=0.002, segments=1)
            m = Matrix.Translation(V((dx * 0.93, 0, 0))) @ Matrix.Rotation(a, 4, 'X') @ Matrix.Translation(V((0, 0, disc_r * 0.36)))
            wheel.add(arm, 'alu', xform=m, smooth=False)
        if not front:
            # Rear sprocket on the chain side.
            sbm = bmesh.new()
            teeth = 48
            ring = []
            for i in range(teeth * 2):
                a = i / (teeth * 2) * 2 * math.pi
                r = 0.105 if i % 2 == 0 else 0.097
                ring.append(sbm.verts.new(V((-0.075 * W, math.cos(a) * r, math.sin(a) * r))))
            hub_ring = [sbm.verts.new(V((-0.075 * W, math.cos(i / (teeth * 2) * 2 * math.pi) * 0.05, math.sin(i / (teeth * 2) * 2 * math.pi) * 0.05))) for i in range(teeth * 2)]
            for i in range(teeth * 2):
                j = (i + 1) % (teeth * 2)
                sbm.faces.new((ring[i], ring[j], hub_ring[j], hub_ring[i]))
            thicken(sbm, sbm.faces, (0.007, 0, 0))
            wheel.add(sbm, 'steel', smooth=False)
        if front:
            wheel.to_object(location=D['axisBase'] + V((0, 0, 0)) + Matrix.Rotation(D['rake'], 3, 'X') @ V((0, 0, -off)), collection=col)
        else:
            wheel.to_object(location=V((0, R, zr)), collection=col)

    # ------------------------------------------------ swingarm (pivot at origin, back along +z)
    arm = Part('swingarm')
    L = D['armLen']
    for sx in (-1, 1):
        x = sx * 0.1 * W
        a = box((x, 0, L / 2 + 0.01), (0.036, 0.07, L + 0.06), bevel=0.012, segments=2)
        for v in a.verts:
            f = (v.co.z + 0.02) / (L + 0.06)
            v.co.y *= 1 - 0.38 * max(0.0, min(1.0, f))
        arm.add(a, 'alu')
        # Axle block / chain adjuster at the end.
        arm.add(box((x, 0, L), (0.04, 0.045, 0.07), bevel=0.01), 'alu')
        arm.add(cylinder_x((x + sx * 0.02, 0, L), 0.015, 0.01, 12), 'steel')
    # Yoke across the front, and the pivot bolt.
    arm.add(tube([(-0.1 * W, 0.02, 0.1), (-0.05 * W, 0.035, 0.16), (0.05 * W, 0.035, 0.16), (0.1 * W, 0.02, 0.1)], 0.022, n=16, sides=10), 'alu')
    arm.add(cylinder_x((0, 0, 0), 0.022, 0.28 * W, 14), 'steel')
    arm.add(cylinder_x((0, 0, 0), 0.035, 0.2 * W, 20), 'alu')
    # Chain from the motor sprocket at the pivot round the rear sprocket.
    # Loop: round the front of the motor sprocket (at the pivot), along the
    # bottom run, round the back of the rear sprocket and along the top run.
    cr0, cr1 = 0.045, 0.105
    cx = -0.075 * W
    path = [V((cx, cr0 * math.cos(math.pi * t), -cr0 * math.sin(math.pi * t))) for t in [i / 16 for i in range(17)]]
    path += [V((cx, -cr0 - (cr1 - cr0) * t, L * t)) for t in [i / 12 for i in range(1, 12)]]
    path += [V((cx, -cr1 * math.cos(math.pi * t), L + cr1 * math.sin(math.pi * t))) for t in [i / 24 for i in range(25)]]
    path += [V((cx, cr1 - (cr1 - cr0) * t, L * (1 - t))) for t in [i / 12 for i in range(1, 12)]]
    arm.add(sweep(path, 0.0075, 6, closed=True, rx=0.7, ry=1.3), 'chain')
    # Chain slider on top of the left arm, rear caliper on the right.
    arm.add(box((-0.1 * W, 0.042, 0.16), (0.03, 0.014, 0.2), bevel=0.005), 'black')
    arm.add(box((0.09 * W, 0.07, L - 0.05), (0.035, 0.07, 0.08), bevel=0.012, segments=2), 'caliper')
    rest = math.atan2(pv.y - R, zr - pv.z)
    arm.to_object(location=pv, rotation=Matrix.Rotation(rest, 3, 'X'), collection=col)
    return col


def export(col, path):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in col.objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_skins=False, export_animations=False, export_morph=False,
        export_texcoords=True, export_normals=True, export_materials='EXPORT',
    )
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in col.objects)
    print(f'wrote {path}: {os.path.getsize(path)} bytes, {tris} triangles')


def preview(col, path):
    scene = bpy.context.scene
    for c in bpy.context.scene.collection.children:
        c.hide_render = c != col
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    if not bpy.data.objects.get('sun'):
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = 4
        sun.rotation_euler = (0.9, 0.2, 0.9)
        scene.collection.objects.link(sun)
        world = bpy.data.worlds.new('w')
        world.use_nodes = True
        world.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.55, 0.5, 1)
        world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
        scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 800
    scene.render.resolution_y = 560
    for name, loc, at, lens in (('side', (2.8, 0.1, 0.75), (0, 0, 0.55), 40), ('front', (1.7, -2.2, 1.2), (0, -0.1, 0.55), 40), ('rear', (-1.4, 2.1, 1.3), (0, 0.1, 0.55), 40)):
        cam.location = loc
        cam.rotation_euler = (V(at) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        scene.render.filepath = f'{path}_{col.name}_{name}.png'
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for bike_id, spec in BIKES.items():
        if ONLY and bike_id != ONLY:
            continue
        # A fresh scene per bike, so the parts keep their plain names (body, fork...).
        bpy.ops.wm.read_factory_settings(use_empty=True)
        MATS.clear()
        col = build_bike(bike_id, spec)
        export(col, os.path.join(OUT_DIR, f'bike-{bike_id}.glb'))
        if PREVIEW:
            preview(col, PREVIEW)
