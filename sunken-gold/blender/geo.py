"""Procedural mesh toolkit on top of bmesh: grids of rings (lathe, sweep, loft),
caps, primitives, noise displacement and per-vertex colour painting.

Conventions: Blender space, +Z up. Creatures and the scooter face +Y, which the
glTF exporter turns into three.js's -Z forward."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

TAU = math.tau


# ---------------------------------------------------------------- materials

_mats = {}


def material(name, color='#808080', metal=0.0, rough=0.7, emit=None, emit_strength=1.0, alpha=1.0):
    """One shared Principled material per name. The game re-skins most of them
    by name, so these mainly need sensible PBR defaults."""
    from common import hex_lin
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = hex_lin(color)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = hex_lin(emit)
        p.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
    _mats[name] = m
    return m


# ---------------------------------------------------------------- mesh builder

class Mesh:
    """Accumulates geometry in a bmesh with material slots, then becomes an object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def grid(self, P, mat, closed_u=False, closed_v=False, uv=None, flip=False):
        """P: (nv, nu, 3) points. Quads between neighbours; closed_u wraps rings.
        uv: optional (nv, nu, 2). Returns the vertex array (nv, nu)."""
        P = np.asarray(P, dtype=np.float64)
        nv, nu = P.shape[:2]
        mi = self.slot(mat)
        V = [[self.bm.verts.new(P[i, j]) for j in range(nu)] for i in range(nv)]
        cu = nu if closed_u else nu - 1
        cv = nv if closed_v else nv - 1
        for i in range(cv):
            i2 = (i + 1) % nv
            for j in range(cu):
                j2 = (j + 1) % nu
                quad = [V[i][j], V[i][j2], V[i2][j2], V[i2][j]]
                if flip:
                    quad.reverse()
                try:
                    f = self.bm.faces.new(quad)
                except ValueError:
                    continue
                f.material_index = mi
                if uv is not None:
                    # Wrapped seams get u continued past the end so textures don't smear.
                    u_end = uv[i][j2][0] if j2 else uv[i][j][0] + (uv[i][j][0] - uv[i][j - 1][0] if j else 1.0)
                    u_end2 = uv[i2][j2][0] if j2 else uv[i2][j][0] + (uv[i2][j][0] - uv[i2][j - 1][0] if j else 1.0)
                    coords = [(uv[i][j][0], uv[i][j][1]), (u_end, uv[i][j2][1]),
                              (u_end2, uv[i2][j2][1]), (uv[i2][j][0], uv[i2][j][1])]
                    if flip:
                        coords.reverse()
                    for loop, c in zip(f.loops, coords):
                        loop[self.uv].uv = c
        return V

    def cap(self, ring, mat, center=None, flip=False):
        """Close a ring of verts with a fan around its centroid (or `center`)."""
        mi = self.slot(mat)
        pts = [v.co for v in ring]
        c = Vector(center) if center is not None else sum(pts, Vector()) / len(pts)
        cv = self.bm.verts.new(c)
        n = len(ring)
        for j in range(n):
            tri = [ring[j], ring[(j + 1) % n], cv]
            if flip:
                tri.reverse()
            try:
                f = self.bm.faces.new(tri)
                f.material_index = mi
            except ValueError:
                pass
        return cv

    def tris(self, verts, faces, mat):
        mi = self.slot(mat)
        V = [self.bm.verts.new(v) for v in verts]
        for f in faces:
            try:
                face = self.bm.faces.new([V[i] for i in f])
                face.material_index = mi
            except ValueError:
                pass
        return V

    def add(self, other, matrix=None):
        """Merge another Mesh in, optionally transformed."""
        tmp = bpy.data.meshes.new('tmp')
        other.bm.to_mesh(tmp)
        if matrix is not None:
            tmp.transform(matrix)
        remap = [self.slot(m) for m in other.mats]
        start = len(self.bm.faces)
        self.bm.from_mesh(tmp)
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[start:]:
            f.material_index = remap[f.material_index] if remap else 0
        bpy.data.meshes.remove(tmp)
        return self

    def transform(self, matrix):
        bmesh.ops.transform(self.bm, matrix=matrix, verts=self.bm.verts)
        return self

    def displace(self, fn):
        """fn(co: Vector) -> new Vector."""
        for v in self.bm.verts:
            v.co = fn(v.co.copy())
        return self

    def push(self, fn):
        """Move every vertex along its normal by fn(co: Vector) metres."""
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.normal_update()
        moves = [(v, v.normal.copy() * fn(v.co.copy())) for v in self.bm.verts]
        for v, d in moves:
            v.co += d
        return self

    def build(self, name, smooth=40, colors=None, weld=0.0):
        """Create the object. smooth: auto-smooth angle in degrees (None = flat).
        colors: fn(P (n,3), N (n,3)) -> (n,3) linear RGB painted per vertex."""
        if weld:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=weld)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        if smooth is not None:
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(smooth))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if colors is not None:
            paint(ob, colors)
        return ob


# ---------------------------------------------------------------- shapes

def ring_pts(center, n1, n2, rx, ry, seg, phase=0.0):
    a = np.linspace(0, TAU, seg, endpoint=False) + phase
    return (np.asarray(center)[None, :] + np.cos(a)[:, None] * rx * np.asarray(n1)[None, :]
            + np.sin(a)[:, None] * ry * np.asarray(n2)[None, :])


def lathe(m, profile, mat, seg=24, cap_bottom=False, cap_top=False, radial=None, uv_scale=(1.0, 1.0)):
    """Revolve [(r, z), ...] (bottom to top) around Z. radial(theta, i) -> radius factor."""
    a = np.linspace(0, TAU, seg, endpoint=False)
    P = np.zeros((len(profile), seg, 3))
    UV = np.zeros((len(profile), seg, 2))
    length = 0.0
    for i, (r, z) in enumerate(profile):
        if i:
            length += math.hypot(r - profile[i - 1][0], z - profile[i - 1][1])
        f = radial(a, i) if radial else 1.0
        P[i, :, 0] = np.cos(a) * r * f
        P[i, :, 1] = np.sin(a) * r * f
        P[i, :, 2] = z
        UV[i, :, 0] = a / TAU * uv_scale[0]
        UV[i, :, 1] = length * uv_scale[1]
    V = m.grid(P, mat, closed_u=True, uv=UV)
    if cap_bottom and profile[0][0] > 1e-6:
        m.cap(V[0], mat, flip=True)
    if cap_top and profile[-1][0] > 1e-6:
        m.cap(V[-1], mat)
    return V


def frames(path):
    """Parallel-transport frames along a polyline: (T, N, B) arrays."""
    P = np.asarray(path, dtype=np.float64)
    n = len(P)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    ref = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N = np.zeros_like(P)
    N[0] = np.cross(T[0], ref)
    N[0] /= np.linalg.norm(N[0])
    for i in range(1, n):
        v = N[i - 1] - np.dot(N[i - 1], T[i]) * T[i]
        ln = np.linalg.norm(v)
        N[i] = v / ln if ln > 1e-9 else N[i - 1]
    B = np.cross(T, N)
    return T, N, B


def sweep(m, path, radius, mat, sides=8, cap_start=True, cap_end=True, squash=1.0, uv_len=1.0):
    """Tube along `path` with per-point radius (float or list)."""
    P = np.asarray(path, dtype=np.float64)
    R = np.broadcast_to(np.asarray(radius, dtype=np.float64), (len(P),))
    T, N, B = frames(P)
    rings = np.stack([ring_pts(P[i], N[i], B[i], R[i], R[i] * squash, sides) for i in range(len(P))])
    seglen = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    UV = np.zeros((len(P), sides, 2))
    UV[..., 0] = np.linspace(0, 1, sides, endpoint=False)[None, :]
    UV[..., 1] = seglen[:, None] * uv_len
    V = m.grid(rings, mat, closed_u=True, uv=UV)
    if cap_start and R[0] > 1e-6:
        m.cap(V[0], mat, flip=True)
    if cap_end and R[-1] > 1e-6:
        m.cap(V[-1], mat)
    return V


def box(m, size, mat, center=(0, 0, 0), uv_scale=1.0):
    """Axis-aligned box with world-scaled UVs."""
    sx, sy, sz = (s / 2 for s in size)
    cx, cy, cz = center
    corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
               (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mi = m.slot(mat)
    V = [m.bm.verts.new((cx + x, cy + y, cz + z)) for x, y, z in corners]
    for f in faces:
        face = m.bm.faces.new([V[i] for i in f])
        face.material_index = mi
        n = face.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        uax = [(1, 2), (0, 2), (0, 1)][ax]
        for loop in face.loops:
            co = loop.vert.co
            loop[m.uv].uv = (co[uax[0]] * uv_scale, co[uax[1]] * uv_scale)
    return V


def ellipsoid(m, radii, mat, center=(0, 0, 0), seg=16, rings=10, deform=None):
    """UV-sphere ellipsoid; deform(P (n,3)) -> P for shaping."""
    rx, ry, rz = radii
    th = np.linspace(0, math.pi, rings + 1)[1:-1]
    a = np.linspace(0, TAU, seg, endpoint=False)
    P = np.zeros((len(th), seg, 3))
    P[..., 0] = np.sin(th)[:, None] * np.cos(a)[None, :] * rx
    P[..., 1] = np.sin(th)[:, None] * np.sin(a)[None, :] * ry
    P[..., 2] = -np.cos(th)[:, None] * rz
    if deform is not None:
        P = deform(P.reshape(-1, 3)).reshape(P.shape)
    P += np.asarray(center)
    V = m.grid(P, mat, closed_u=True)
    bottom = np.array(center) + (deform(np.array([[0, 0, -rz]]))[0] if deform else np.array([0, 0, -rz]))
    top = np.array(center) + (deform(np.array([[0, 0, rz]]))[0] if deform else np.array([0, 0, rz]))
    m.cap(V[0], mat, center=bottom, flip=True)
    m.cap(V[-1], mat, center=top)
    return V


def icosphere(m, radius, mat, subdiv=3, center=(0, 0, 0)):
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=radius)
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    me = bpy.data.meshes.new('ico')
    tmp.to_mesh(me)
    tmp.free()
    sub = Mesh()
    sub.bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    sub.mats = [mat]
    m.add(sub)
    return m


def strip(m, path, widths, mat, up=None, fold=0.0, uv=True):
    """Flat ribbon along a path (leaves, fins, blades). widths per point.
    up: side direction vectors per point (defaults to frame normal).
    fold: lift the edges into a V by this fraction of the width."""
    P = np.asarray(path, dtype=np.float64)
    W = np.broadcast_to(np.asarray(widths, dtype=np.float64), (len(P),))
    T, N, B = frames(P)
    side = np.asarray(up, dtype=np.float64) if up is not None else N
    if side.ndim == 1:
        side = np.broadcast_to(side, P.shape)
    lift = np.cross(T, side)
    G = np.zeros((len(P), 3, 3))
    for k, s in enumerate((-1.0, 0.0, 1.0)):
        G[:, k] = P + side * (W[:, None] * 0.5 * s) + lift * (abs(s) * fold * W[:, None])
    UV = None
    if uv:
        t = np.linspace(0, 1, len(P))
        UV = np.zeros((len(P), 3, 2))
        UV[..., 0] = np.array([0.0, 0.5, 1.0])[None, :]
        UV[..., 1] = t[:, None]
    return m.grid(G, mat, uv=UV)


# ---------------------------------------------------------------- noise / colour

def fbm(p, scale=1.0, octaves=4, offset=(0.0, 0.0, 0.0)):
    q = Vector(p) * scale + Vector(offset)
    return noise.fractal(q, 0.6, 2.0, octaves, noise_basis='PERLIN_ORIGINAL')


def vnoise(P, scale=1.0, octaves=3, offset=(0.0, 0.0, 0.0)):
    """Vectorised-ish fBm over an (n, 3) array (loops in C via mathutils)."""
    off = Vector(offset)
    return np.array([noise.fractal(Vector(p) * scale + off, 0.6, 2.0, octaves, noise_basis='PERLIN_ORIGINAL') for p in P])


def cells(P, scale=1.0):
    """Voronoi F1, F2 distances for an (n, 3) array."""
    out = np.zeros((len(P), 2))
    for i, p in enumerate(P):
        d, _ = noise.voronoi(Vector(p) * scale, distance_metric='DISTANCE', exponent=2.5)
        out[i] = d[0], d[1]
    return out


def hexc(h):
    from common import srgb_to_linear
    h = h.lstrip('#')
    return np.array(srgb_to_linear([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]))


def lerp_colors(t, stops):
    """t: (n,) in 0..1; stops: [(pos, '#hex')] -> (n,3) linear colours."""
    pos = np.array([s[0] for s in stops])
    cols = np.stack([hexc(s[1]) for s in stops])
    t = np.clip(t, pos[0], pos[-1])
    return np.stack([np.interp(t, pos, cols[:, k]) for k in range(3)], axis=1)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def paint(ob, fn):
    me = ob.data
    n = len(me.vertices)
    P = np.empty(n * 3)
    N = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    me.vertices.foreach_get('normal', N)
    C = np.asarray(fn(P.reshape(n, 3), N.reshape(n, 3)), dtype=np.float64)
    attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    rgba = np.ones((n, 4))
    rgba[:, :3] = np.clip(C, 0, 64)
    attr.data.foreach_set('color', rgba.astype(np.float32).ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def solid(color):
    c = hexc(color)
    return lambda P, N: np.broadcast_to(c, (len(P), 3))


# ---------------------------------------------------------------- objects

def join(objs, name):
    objs = [o for o in objs if o is not None]
    # Make sure every part carries the same colour attribute so joins keep colours.
    for o in objs:
        if o.type == 'MESH' and not o.data.color_attributes.get('Color'):
            paint(o, lambda P, N: np.ones((len(P), 3)))
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs):
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    ob.data.name = name
    return ob


def empty(name, children=(), location=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = location
    bpy.context.scene.collection.objects.link(e)
    for c in children:
        c.parent = e
    return e


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = (scale,) * 3 if np.isscalar(scale) else scale
    return ob


def apply_transform(ob):
    me = ob.data
    me.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
