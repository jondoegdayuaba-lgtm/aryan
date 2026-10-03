# The cowboy: one rig shared by the player, outlaws and townsfolk.
#
# The body is one continuous mesh grown from a stick figure with Blender's
# Skin and Subdivision modifiers, then shaped and weighted to the skeleton so
# shoulders, elbows and knees bend smoothly. The head is sculpted from a
# sphere (brow, eye sockets, nose, cheekbones, lips, jaw, chin) with eyeballs,
# lids and ears, and a painted face. Clothing is fitted to the body: shirt with
# collar, placket, pockets and cuffs, trousers, boots with heels, and separate
# pieces the game shows or hides per character (hat, bandana, duster, jacket,
# vest, suspenders, satchel, gun belt, badge, beard).
#
# Every material samples one texture atlas (char_textures.py) multiplied by its
# own colour, so the game can recolour clothes and still draw a whole
# character in a couple of draw calls.
import math
import bpy
import bmesh
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

from common import Builder, Animator, make_armature, attach_to_bone, clamp, smoothstep, srgb, trs
import char_textures as CT

FWD = (0, -1, 0)
UP = (0, 0, 1)
SIDES = (('L', 1), ('R', -1))   # character's left is +X
ARM_REST_SPREAD = 0.2           # rest pose holds the arms out a little; animations pull them back in

# Joint positions (metres)
J = {
    'hips': (0, 0, 0.98), 'spine': (0, 0, 1.12), 'chest': (0, 0, 1.28),
    'neck': (0, 0, 1.46), 'head': (0, -0.012, 1.55), 'head_end': (0, -0.012, 1.785),
}
for s, k in SIDES:
    J[f'shoulder.{s}'] = (k * 0.19, 0.005, 1.425)
    J[f'elbow.{s}'] = (k * 0.285, 0.02, 1.135)
    J[f'wrist.{s}'] = (k * 0.35, 0.0, 0.885)
    J[f'fingers.{s}'] = (k * 0.377, -0.012, 0.787)
    J[f'hip.{s}'] = (k * 0.095, 0, 0.95)
    J[f'knee.{s}'] = (k * 0.10, -0.01, 0.52)
    J[f'ankle.{s}'] = (k * 0.105, 0.02, 0.09)
    J[f'toe.{s}'] = (k * 0.11, -0.12, 0.025)

HEAD_C = Vector((0, 0.004, 1.662))
NECKLINE = 1.48         # shirt below, skin above; the collar band hides the seam     # centre of the head; chin at -0.125, crown at +0.125


def skeleton():
    bones = [
        ('hips', J['hips'], J['spine'], None, FWD),
        ('spine', J['spine'], J['chest'], 'hips', FWD),
        ('chest', J['chest'], J['neck'], 'spine', FWD),
        ('neck', J['neck'], J['head'], 'chest', FWD),
        ('head', J['head'], J['head_end'], 'neck', FWD),
    ]
    for s, _ in SIDES:
        bones += [
            (f'upperarm.{s}', J[f'shoulder.{s}'], J[f'elbow.{s}'], 'chest', FWD),
            (f'forearm.{s}', J[f'elbow.{s}'], J[f'wrist.{s}'], f'upperarm.{s}', FWD),
            (f'hand.{s}', J[f'wrist.{s}'], J[f'fingers.{s}'], f'forearm.{s}', FWD),
            (f'thigh.{s}', J[f'hip.{s}'], J[f'knee.{s}'], 'hips', FWD),
            (f'shin.{s}', J[f'knee.{s}'], J[f'ankle.{s}'], f'thigh.{s}', FWD),
            (f'foot.{s}', J[f'ankle.{s}'], J[f'toe.{s}'], f'shin.{s}', UP),
        ]
    return bones


UPPER = ['spine', 'chest', 'neck', 'head'] + [f'{b}.{s}' for b in ('upperarm', 'forearm', 'hand') for s in 'LR']


def g(x):
    return math.exp(-x)


# ---------------------------------------------------------------------------
# Materials: atlas tile x colour. Names matter: the game recolours by name.
# ---------------------------------------------------------------------------
TILE_OF = {}
SKIP_UV = set()     # faces with hand-made UVs (head, hair, beard, bandana)


def atlas_image():
    img = bpy.data.images.get('character')
    return img if img else CT.build_atlas()


def amat(name, color, tile, rough=0.8, metal=0.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = atlas_image()
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    cols = [i for i in mix.inputs if i.type == 'RGBA']
    nt.links.new(tex.outputs['Color'], cols[0])
    cols[1].default_value = (*srgb(color), 1)
    nt.links.new([o for o in mix.outputs if o.type == 'RGBA'][0], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.use_backface_culling = not double
    m.diffuse_color = (*srgb(color), 1)
    TILE_OF[m.name] = tile
    return m


def materials():
    TILE_OF.clear()
    SKIP_UV.clear()
    return {
        'skin': amat('Skin', CT.SKIN, 'skin', 0.55),
        'face': amat('Face', '#ffffff', 'face', 0.55),
        'hands': amat('Hands', CT.SKIN, 'skin', 0.55),
        'hair': amat('Hair', '#3a281c', 'hair', 0.75),
        'beard': amat('Beard', '#4a3424', 'hair', 0.8),
        'eyewhite': amat('EyeWhite', '#d6cfc4', 'flat', 0.25),
        'eye': amat('Eye', '#3a2618', 'flat', 0.15),
        'shirt': amat('Shirt', '#5b7596', 'cotton', 0.92),
        'button': amat('Button', '#d8ccb2', 'flat', 0.45),
        'pants': amat('Pants', '#5a4a3a', 'denim', 0.95),
        'boots': amat('Boots', '#3c2a1d', 'leather', 0.5),
        'sole': amat('Sole', '#1c1410', 'leather', 0.8),
        'leather': amat('Leather', '#5a3824', 'leather', 0.6),
        'belt': amat('Belt', '#3a2618', 'leather', 0.55),
        'brass': amat('Brass', '#b08a3c', 'flat', 0.35, 0.9),
        'hat': amat('Hat', '#4a3624', 'felt', 0.9),
        'hatband': amat('HatBand', '#1d1611', 'leather', 0.6),
        'mask': amat('Mask', '#2c2c30', 'bandana', 0.95, double=True),
        'coat': amat('Coat', '#4e5246', 'canvas', 0.95, double=True),
        'jacket': amat('Jacket', '#5a4632', 'canvas', 0.95, double=True),
        'vest': amat('Vest', '#2c2724', 'wool', 0.9, double=True),
        'strap': amat('Strap', '#3b2a1c', 'leather', 0.65),
        'metal': amat('GunMetal', '#2b2c30', 'flat', 0.35, 0.85),
        'steel': amat('Steel', '#6d6f75', 'flat', 0.3, 0.9),
        'grip': amat('GunWood', '#5a3a22', 'flat', 0.55),
        'stock': amat('RifleWood', '#6e4524', 'flat', 0.5),
        'badge': amat('Badge', '#d8b44a', 'flat', 0.3, 1.0),
        'canvas': amat('Bedroll', '#8d7b5c', 'canvas', 0.95),
    }


def atlas_uv(b):
    """Box-project each material's faces into its atlas tile, sized to fit."""
    groups = {}
    for f in b.bm.faces:
        if f in SKIP_UV:
            continue
        groups.setdefault(f.material_index, []).append(f)
    b.bm.normal_update()
    for mi, faces in groups.items():
        tile = TILE_OF.get(b.mats[mi].name, 'flat')
        if tile == 'face':
            tile = 'skin'
        u0, v0, u1, v1 = CT.tile_rect(tile)
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for f in faces:
            for v in f.verts:
                for i in range(3):
                    lo[i] = min(lo[i], v.co[i])
                    hi[i] = max(hi[i], v.co[i])
        c = (lo + hi) / 2
        s = max(hi - lo) * 1.02 + 1e-4
        for f in faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                p = loop.vert.co - c
                if ax == 0:
                    a, bb = p.y * (1 if n.x > 0 else -1), p.z
                elif ax == 1:
                    a, bb = p.x * (-1 if n.y > 0 else 1), p.z
                else:
                    a, bb = p.x, p.y
                u = clamp(a / s + 0.5, 0, 1)
                v = clamp(bb / s + 0.5, 0, 1)
                loop[b.uvl].uv = (u0 + u * (u1 - u0), v0 + v * (v1 - v0))


def cyl_uv(b, faces, tile, center, height, z0, u_scale=1.0):
    """Cylindrical UVs around `center` (straight ahead = middle of the tile)."""
    u0, v0, u1, v1 = CT.tile_rect(tile)
    for f in faces:
        us = []
        for loop in f.loops:
            p = loop.vert.co - center
            us.append(0.5 + math.atan2(p.x, -p.y) / (2 * math.pi) * u_scale)
        if max(us) - min(us) > 0.5:          # straddles the seam at the back
            us = [u if u > 0.5 else 0.999 for u in us]
        for loop, u in zip(f.loops, us):
            v = clamp((loop.vert.co.z - z0) / height, 0, 1)
            loop[b.uvl].uv = (u0 + clamp(u, 0, 1) * (u1 - u0), v0 + v * (v1 - v0))
        SKIP_UV.add(f)


# ---------------------------------------------------------------------------
# The body: a stick figure grown into a surface by the Skin modifier
# ---------------------------------------------------------------------------
def skin_surface(points, radii, edges, root=0, levels=2, branch_smooth=0.6):
    me = bpy.data.meshes.new('skel')
    bm = bmesh.new()
    sk = bm.verts.layers.skin.verify()      # before any verts: adding a layer invalidates them
    vs = [bm.verts.new(p) for p in points]
    for a, b in edges:
        bm.edges.new((vs[a], vs[b]))
    for v, r in zip(vs, radii):
        v[sk].radius = r
        v[sk].use_root = False
    vs[root][sk].use_root = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('skel', me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('Skin', 'SKIN')
    m.branch_smoothing = branch_smooth
    m.use_smooth_shade = True
    s = ob.modifiers.new('Sub', 'SUBSURF')
    s.levels = levels
    s.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


def body_figure():
    """Points, radii and edges of the stick figure, and a bone label per edge."""
    P, R, E, LBL = [], [], [], []

    def add(p, rx, ry=None):
        P.append(Vector(p))
        R.append((rx, ry if ry is not None else rx))
        return len(P) - 1

    torso = [add((0, 0.008, 0.945), 0.150, 0.108), add((0, 0.0, 1.03), 0.148, 0.102),
             add((0, -0.004, 1.12), 0.138, 0.096), add((0, -0.006, 1.235), 0.150, 0.106),
             add((0, -0.008, 1.335), 0.163, 0.113), add((0, 0.004, 1.425), 0.135, 0.096),
             add((0, 0.01, 1.475), 0.067, 0.064), add((0, 0.006, 1.53), 0.059, 0.06),
             add((0, -0.002, 1.585), 0.05, 0.05)]
    tl = ['hips', 'hips', 'spine', 'spine', 'chest', 'chest', 'neck', 'neck']
    for i in range(len(torso) - 1):
        E.append((torso[i], torso[i + 1]))
        LBL.append(('torso', tl[i]))
    for s, k in SIDES:
        sh = Vector(J[f'shoulder.{s}'])
        el = Vector(J[f'elbow.{s}'])
        wr = Vector(J[f'wrist.{s}'])
        a0 = add(sh + Vector((-k * 0.006, 0.0, -0.008)), 0.064, 0.067)
        a1 = add(sh.lerp(el, 0.5), 0.056, 0.058)
        a2 = add(el, 0.045, 0.047)
        a3 = add(el.lerp(wr, 0.38), 0.046, 0.041)
        a4 = add(wr + (wr - el).normalized() * 0.01, 0.033, 0.027)
        E.append((torso[5], a0))
        LBL.append(('link', 'chest', f'upperarm.{s}'))
        for a, b, bone in ((a0, a1, 'upperarm'), (a1, a2, 'upperarm'), (a2, a3, 'forearm'), (a3, a4, 'forearm')):
            E.append((a, b))
            LBL.append(('limb', f'{bone}.{s}'))
        hp = Vector(J[f'hip.{s}'])
        kn = Vector(J[f'knee.{s}'])
        an = Vector(J[f'ankle.{s}'])
        l0 = add(hp + Vector((-k * 0.004, 0.006, -0.045)), 0.088, 0.092)
        l1 = add(hp.lerp(kn, 0.48), 0.075, 0.078)
        l2 = add(kn, 0.056, 0.058)
        l3 = add(kn.lerp(an, 0.36) + Vector((0, 0.008, 0)), 0.056, 0.06)
        l4 = add(an + Vector((0, 0, 0.03)), 0.041, 0.043)
        E.append((torso[0], l0))
        LBL.append(('link', 'hips', f'thigh.{s}'))
        for a, b, bone in ((l0, l1, 'thigh'), (l1, l2, 'thigh'), (l2, l3, 'shin'), (l3, l4, 'shin')):
            E.append((a, b))
            LBL.append(('limb', f'{bone}.{s}'))
    return P, R, E, LBL


def torso_weights(z):
    if z < 1.06:
        return {'hips': 1}
    if z < 1.18:
        t = smoothstep(1.06, 1.18, z)
        return {'hips': 1 - t, 'spine': t}
    if z < 1.32:
        t = smoothstep(1.18, 1.32, z)
        return {'spine': 1 - t, 'chest': t}
    if z < 1.44:
        return {'chest': 1}
    if z < 1.53:
        t = smoothstep(1.44, 1.53, z)
        return {'chest': 1 - t, 'neck': t}
    if z < 1.6:
        t = smoothstep(1.545, 1.6, z)
        return {'neck': 1 - t, 'head': t}
    return {'head': 1}


def figure_weights(co, P, R, E, LBL):
    """Smooth skin weights for a point near the figure, plus its region."""
    best = None
    scores = []
    for i, (a, b) in enumerate(E):
        pa, pb = P[a], P[b]
        d = pb - pa
        L2 = d.length_squared or 1e-9
        t = clamp((co - pa).dot(d) / L2)
        q = pa + d * t
        ra = sum(R[a]) / 2
        rb = sum(R[b]) / 2
        sc = (co - q).length / (ra + (rb - ra) * t)
        scores.append((sc, t))
        if best is None or sc < scores[best][0]:
            best = i
    kind = LBL[best][0]
    if kind == 'torso':
        return torso_weights(co.z), 'torso'
    if kind == 'link':
        _, base, limb = LBL[best]
        t = scores[best][1]
        w = smoothstep(0.35, 1.0, t)
        ws = {base: 1 - w, limb: w}
        region = 'arm' if 'arm' in limb else 'leg'
        if region == 'arm':
            # Blend the top of the shoulder into the chest's own height weights
            return ws, 'shoulder'
        return ws, 'hip'
    # A limb: blend with the edges that share a joint with this one
    a0, b0 = E[best]
    s_min = scores[best][0]
    ws = {}
    for i, (a, b) in enumerate(E):
        if i != best and not ({a, b} & {a0, b0}):
            continue
        sc = scores[i][0]
        w = max(0.0, 1 - (sc - s_min) / 0.4) ** 2
        if w <= 0:
            continue
        lab = LBL[i]
        if lab[0] == 'limb':
            ws[lab[1]] = ws.get(lab[1], 0) + w
        elif lab[0] == 'link':
            t = scores[i][1]
            ws[lab[1]] = ws.get(lab[1], 0) + w * (1 - smoothstep(0.35, 1.0, t))
            ws[lab[2]] = ws.get(lab[2], 0) + w * smoothstep(0.35, 1.0, t)
    region = 'arm' if 'arm' in LBL[best][1] else 'leg'
    return ws, region


class Body:
    """The fitted body surface: lookups used to dress it."""

    def __init__(self, b, region, weights):
        self.b = b
        self.region = region
        self.weights = weights
        self.faces = list(b.bm.faces)       # the body proper, before head, hands and boots join it
        self.kd = KDTree(len(b.bm.verts))
        for v in b.bm.verts:
            self.kd.insert(v.co, v.index)
        self.kd.balance()
        torso = [f for f in b.bm.faces if all(region[v.index] in ('torso', 'hip', 'shoulder') for v in f.verts)]
        verts = [v.co.copy() for v in b.bm.verts]
        self.bvh = BVHTree.FromPolygons(verts, [[v.index for v in f.verts] for f in torso])

    def weights_at(self, co):
        _, i, _ = self.kd.find(co)
        return dict(self.weights[i])

    def surface(self, x, z, side, off=0.0):
        """Point on the torso at (x, z), front (side=-1) or back (+1), pushed out by `off`."""
        hit = self.bvh.ray_cast(Vector((x, side * 0.6, z)), Vector((0, -side, 0)), 1.0)
        if hit[0] is None:
            return Vector((x, side * 0.1, z)), Vector((0, side, 0))
        return hit[0] + hit[1] * off, hit[1]

    def ring(self, z, n=24, off=0.0, tilt=0.0):
        """Closed loop around the torso at height z (tilted down on the right by `tilt`)."""
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            d = Vector((math.cos(a), math.sin(a), 0))
            zz = z - tilt * max(0.0, -d.x)
            hit = self.bvh.ray_cast(Vector((0, 0, zz)) + d * 0.6, -d, 1.0)
            p = hit[0] + hit[1] * off if hit[0] is not None else Vector((0, 0, zz)) + d * 0.16
            pts.append(p)
        return pts

    def around(self, ang, z, off=0.0, cy=0.004):
        """Point on the torso/neck at height z, `ang` radians round from the front toward the left."""
        d = Vector((math.sin(ang), -math.cos(ang), 0))
        o = Vector((0, cy, z))
        hit = self.bvh.ray_cast(o + d * 0.6, -d, 1.0)
        if hit[0] is None:
            return o + d * 0.06
        return hit[0] + hit[1] * off

    def normal(self, p):
        loc, n, _, _ = self.bvh.find_nearest(p)
        return n if n is not None else Vector((0, 1, 0))


def build_body(b, M):
    """Grow, shape, dress-paint and weight the body inside builder b. Returns Body."""
    P, R, E, LBL = body_figure()
    me = skin_surface(P, R, E, root=0, levels=2)
    b.bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    b.dl = b.bm.verts.layers.deform.verify()
    b.uvl = b.bm.loops.layers.uv.verify()
    bm = b.bm
    bm.verts.ensure_lookup_table()
    # Anatomy: chest, shoulder blades, seat, calves
    for v in bm.verts:
        c = v.co
        ax = abs(c.x)
        if c.z > 0.85 and ax < 0.2:
            if c.y < 0:
                c.y -= 0.011 * g(((ax - 0.072) / 0.05) ** 2 + ((c.z - 1.33) / 0.05) ** 2)
                c.y += 0.006 * g(((c.z - 1.1) / 0.05) ** 2) * g((ax / 0.1) ** 2)
            else:
                c.y += 0.007 * g(((ax - 0.08) / 0.05) ** 2 + ((c.z - 1.36) / 0.06) ** 2)
                c.y += 0.015 * g(((ax - 0.07) / 0.055) ** 2 + ((c.z - 0.9) / 0.06) ** 2)
        if c.z < 0.5 and c.y > 0.0:
            c.y += 0.009 * g(((c.z - 0.42) / 0.05) ** 2)
    bm.normal_update()
    # Weights and regions
    region = {}
    weights = {}
    for v in bm.verts:
        ws, reg = figure_weights(v.co, P, R, E, LBL)
        total = sum(ws.values()) or 1
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:3]
        t3 = sum(w for _, w in top) or 1
        ws = {k: w / t3 for k, w in top if w / total > 0.02}
        region[v.index] = reg
        weights[v.index] = ws
        b.weight([v], ws)
    # Dress-paint: neck skin, shirt, trousers
    for f in bm.faces:
        c = f.calc_center_median()
        regs = {region[v.index] for v in f.verts}
        if c.z > NECKLINE and abs(c.x) < 0.1:
            m = M['skin']
        elif 'arm' in regs or 'shoulder' in regs:
            m = M['shirt']
        elif 'leg' in regs or 'hip' in regs or c.z < 0.975:
            m = M['pants']
        else:
            m = M['shirt']
        f.material_index = b._mi(m)
        f.smooth = True
    # Cloth: folds at the elbows, the tuck above the belt, the knees and the boot tops
    for v in bm.verts:
        c = v.co
        n = v.normal
        d = 0.0
        reg = region[v.index]
        d += noise.noise(c * 24) * 0.0016
        if reg == 'arm':
            for s, k in SIDES:
                el = Vector(J[f'elbow.{s}'])
                e = (c - el).length
                d += 0.0032 * math.sin(c.z * 210 + c.x * 40) * g((e / 0.075) ** 2)
        if reg in ('torso', 'hip') and 0.98 < c.z < 1.08:
            ang = math.atan2(c.y, c.x)
            d += 0.0035 * math.sin(ang * 13 + noise.noise(c * 8) * 2) * g(((c.z - 1.02) / 0.03) ** 2)
        if reg == 'leg':
            d += 0.003 * math.sin(c.z * 170) * (g(((c.z - 0.52) / 0.05) ** 2) + g(((c.z - 0.4) / 0.04) ** 2))
        c += n * d
    bm.normal_update()
    return Body(b, region, weights)


# ---------------------------------------------------------------------------
# The head
# ---------------------------------------------------------------------------
def sculpt(p):
    """Shape a point on the head ellipsoid (head space: x left, -y forward, z up)."""
    x, y, z = p.x, p.y, p.z
    ax = abs(x)
    sx = 1 if x >= 0 else -1
    # Jaw narrows toward the chin; the back of the lower head tucks into the neck
    x *= 1 - 0.24 * smoothstep(0.0, -0.12, z) - 0.1 * smoothstep(-0.04, -0.12, z) * smoothstep(0.0, -0.06, y)
    if y > 0:
        y *= 1 - 0.42 * smoothstep(-0.02, -0.12, z)
    # Flatter face, forehead sloping back, fuller crown
    if y < -0.03:
        y = -0.03 + (y + 0.03) * 0.8
    if y < 0:
        y += 0.017 * smoothstep(0.03, 0.125, z)
    x *= 1 + 0.06 * smoothstep(0.0, 0.08, z) * smoothstep(-0.02, 0.06, y)
    front = smoothstep(-0.03, -0.075, y)
    ax = abs(x)
    # Brow ridge and eye sockets
    y -= 0.007 * g(((z - 0.04) / 0.012) ** 2) * g((x / 0.05) ** 2) * front
    y += 0.012 * g(((ax - CT.EYE_X) / 0.017) ** 2 + ((z - 0.016) / 0.0125) ** 2) * front
    # Nose: bridge to tip, then the base; nostril wings
    if -0.045 < z < 0.035:
        prof = 0.006 + 0.019 * smoothstep(0.03, -0.024, z)
        prof *= 1 - smoothstep(-0.026, -0.043, z)
        width = 0.0075 + 0.007 * smoothstep(0.02, -0.03, z)
        y -= prof * g((x / width) ** 2) * front
    y -= 0.007 * g(((ax - 0.0145) / 0.0065) ** 2 + ((z + 0.034) / 0.0065) ** 2) * front
    # Cheekbones, temples, jaw angle
    x += sx * 0.006 * g(((ax - 0.05) / 0.02) ** 2 + (z / 0.02) ** 2) * front
    y -= 0.004 * g(((ax - 0.052) / 0.02) ** 2 + (z / 0.02) ** 2) * front
    x -= sx * 0.005 * g(((z - 0.045) / 0.02) ** 2 + ((y + 0.035) / 0.03) ** 2)
    x += sx * 0.006 * g(((z + 0.085) / 0.02) ** 2 + ((y - 0.015) / 0.03) ** 2)
    # Lips and the line between them
    y -= 0.0058 * g((x / 0.023) ** 2 + ((z + 0.051) / 0.0075) ** 2) * front
    y -= 0.0048 * g((x / 0.021) ** 2 + ((z + 0.064) / 0.0065) ** 2) * front
    y += 0.0032 * g((x / 0.025) ** 2 + ((z + 0.0575) / 0.0022) ** 2) * front
    # Chin
    y -= 0.012 * g((x / 0.028) ** 2 + ((z + 0.098) / 0.016) ** 2) * front
    return Vector((x, y, z))


def build_head(b, M):
    """Sculpted head, eyes, lids and ears into builder b. Returns head vert/face data for shells."""
    C = HEAD_C
    hw = {'head': 1.0}

    def head_w(co):
        z = co.z - C.z
        if z < -0.09 and co.y - C.y > -0.04:
            t = smoothstep(-0.09, -0.125, z)
            return {'head': 1 - 0.6 * t, 'neck': 0.6 * t}
        return hw

    verts = bmesh.ops.create_uvsphere(b.bm, u_segments=88, v_segments=60, radius=1.0,
                                      matrix=Matrix.Diagonal(Vector((0.076, 0.1, 0.125, 1))))['verts']
    for v in verts:
        v.co = C + sculpt(v.co)
    b.bm.normal_update()
    faces = list({f for v in verts for f in v.link_faces})
    mi = b._mi(M['face'])
    for f in faces:
        f.material_index = mi
        f.smooth = True
    b.weight(verts, head_w)
    cyl_uv(b, faces, 'face', C, CT.HEAD_H, C.z - 0.125)
    head = {'verts': verts, 'faces': faces}

    # Eyes: eyeball, iris, upper lid
    def front_y(x, z):
        best = None
        for v in verts:
            if v.co.y < C.y and abs(v.co.x - x) < 0.006 and abs(v.co.z - z) < 0.006:
                if best is None or v.co.y < best:
                    best = v.co.y
        return best if best is not None else C.y - 0.09

    for s, k in SIDES:
        ex = k * CT.EYE_X
        ez = C.z + 0.016
        sy = front_y(ex, ez)
        ec = Vector((ex, sy + 0.0085, ez))
        b.ball(0.0118, ec, material=M['eyewhite'], bone='head', seg=14, rings=10)
        b.ball((0.0058, 0.002, 0.0058), ec + Vector((0, -0.0112, 0.0005)), material=M['eye'], bone='head',
               seg=12, rings=6)
        # Upper lid: the top of a slightly bigger sphere, skin coloured
        lid = b.ball(0.0128, ec, material=M['skin'], bone='head', seg=14, rings=10)
        cut = [v for v in lid if v.co.z < ec.z + 0.0035]
        for v in cut:
            v.co.z = ec.z + 0.0035 + (v.co.z - ec.z - 0.0035) * 0.05
        # Lower lid: the bottom of the same sphere, so the eye shows as an almond, not a disc
        low = b.ball(0.0126, ec + Vector((0, 0.0004, 0)), material=M['skin'], bone='head', seg=14, rings=10)
        for v in low:
            top = ec.z - 0.0046 + 0.0018 * ((v.co.x - ec.x) / 0.0126) ** 2
            if v.co.z > top:
                v.co.z = top + (v.co.z - top) * 0.05
        # Ears
        ear_c = C + Vector((k * 0.074, 0.012, 0.004))
        b.ball((0.011, 0.024, 0.033), ear_c, (0.0, 0.0, k * -0.15), M['skin'], 'head', seg=12, rings=8,
               deform=lambda co, ear_c=ear_c, k=k: co + Vector((k * 0.006, 0, 0)) * g((((co - ear_c).y + 0.01) / 0.012) ** 2))
        rim = []
        for i in range(9):
            a = math.radians(-70 + 200 * i / 8)
            rim.append(ear_c + Vector((k * 0.009, -math.sin(a) * 0.022 + 0.004, math.cos(a) * 0.03)))
        b.tube(rim, [(0.0042, 0.0042)] * 9, M['skin'], 'head', seg=8)
    return head


def clip_layer(b, faces, cover, offset, weight, iso=0.0):
    """Copy `faces` into builder b where cover >= iso, pushed out along the normals.

    Faces are clipped along the cover = iso contour (interpolated on the
    edges, shared between neighbours), so a layer's edge follows a smooth
    line instead of the face grid. cover: {vert: value}; offset(co, c, src)
    gives the push for a point with cover c (src: nearest source vert);
    weight(v) gives a source vert's bone weights.
    """
    vmap, emap = {}, {}

    def vert(v):
        if v not in vmap:
            nv = b.bm.verts.new(v.co + v.normal * offset(v.co, cover[v], v))
            b.weight([nv], weight(v))
            vmap[v] = nv
        return vmap[v]

    def cut(u, v):
        key = frozenset((u, v))
        if key not in emap:
            t = (cover[u] - iso) / (cover[u] - cover[v])
            co = u.co.lerp(v.co, t)
            n = u.normal.lerp(v.normal, t).normalized()
            nv = b.bm.verts.new(co + n * offset(co, iso, u if t < 0.5 else v))
            wu, wv = weight(u), weight(v)
            b.weight([nv], {k: wu.get(k, 0) * (1 - t) + wv.get(k, 0) * t for k in set(wu) | set(wv)})
            emap[key] = nv
        return emap[key]

    out = []
    for f in faces:
        vs = list(f.verts)
        inside = [cover[v] >= iso for v in vs]
        if not any(inside):
            continue
        poly = []
        for i, v in enumerate(vs):
            j = (i + 1) % len(vs)
            if inside[i]:
                poly.append(vert(v))
            if inside[i] != inside[j]:
                poly.append(cut(v, vs[j]))
        if len(poly) >= 3:
            try:
                out.append(b.bm.faces.new(poly))
            except ValueError:
                pass
    b.bm.normal_update()
    return out


def shell(b, head, region, off, material, tile, bone_fn=None, rough_noise=0.0, floor=0.3, iso=0.5):
    """A layer over the head where `region` covers it (hair, beard, bandana).

    region(p) gives a coverage 0..1 for a point in head space (a bool works
    too); the layer thins toward its edge so it settles onto the skin.
    """
    cover = {v: float(region(v.co - HEAD_C)) for v in head['verts']}

    def offset(co, c, src):
        t = smoothstep(iso, 1.0, c) if iso < 1 else 1.0
        d = off * (floor + (1 - floor) * t)
        if rough_noise:
            d += noise.noise(co * 90) * rough_noise * t
        return d

    bones = bone_fn or {'head': 1.0}
    out = clip_layer(b, head['faces'], cover, offset, lambda v: bones, iso)
    mi = b._mi(material)
    for f in out:
        f.material_index = mi
        f.smooth = True
    cyl_uv(b, out, tile, HEAD_C, CT.HEAD_H, HEAD_C.z - 0.125)
    return out


def hairline(p):
    """Hair coverage of the scalp, 0..1, for p in head space."""
    ang = math.atan2(p.x, -p.y)                      # 0 ahead, +-pi behind
    line = 0.062 - 0.05 * (1 - math.cos(ang)) * 0.5 - 0.07 * max(0.0, -math.cos(ang)) ** 1.4
    if abs(p.x) > 0.055 and -0.035 < p.y < 0.0:
        line = min(line, -0.012)                     # sideburns
    if abs(p.x) > 0.062 and -0.016 < p.y < 0.036 and p.z < 0.034:
        return 0.0                                   # around the ears
    line += noise.noise(p * 160) * 0.004
    return smoothstep(line - 0.002, line + 0.012, p.z)


def beard_zone(p):
    """Short full beard: coverage 0..1 for p in head space."""
    ragged = noise.noise(p * 140) * 0.0025
    # cheek line: from the sideburns down to the corners of the mouth; moustache under the nose
    back = smoothstep(-0.075, -0.01, p.y)
    cheek = -0.046 + 0.042 * back
    top = cheek + (-0.032 - cheek) * (1 - smoothstep(0.02, 0.034, abs(p.x))) * (1 - back)
    m = top + ragged - p.z
    m = min(m, 0.012 - p.y)                          # stops in front of the ears
    # clear the lips, keep the moustache over them
    e = math.sqrt((p.x / 0.025) ** 2 + ((p.z + 0.0585) / 0.0098) ** 2)
    if p.y < -0.03:
        m = min(m, (e - 1) * 0.012)
    return smoothstep(-0.004, 0.006, m)


# ---------------------------------------------------------------------------
# Hands
# ---------------------------------------------------------------------------
def build_hand(b, M, s, k):
    wr = Vector(J[f'wrist.{s}'])
    fi = Vector(J[f'fingers.{s}'])
    D = (fi - wr).normalized()
    Np = Vector((-k, 0, 0))
    Np = (Np - D * Np.dot(D)).normalized()        # palm faces the body
    T = Np.cross(D).normalized()
    if T.y > 0:
        T = -T                                     # thumb toward the front
    bone = f'hand.{s}'
    m = M['hands']

    def blend(co):
        t = (co - wr).dot(D)
        w = smoothstep(-0.02, 0.02, t)
        return {bone: w, f'forearm.{s}': 1 - w}

    base = wr + D * 0.004
    b.tube([base - D * 0.012, base + D * 0.03, base + D * 0.065, base + D * 0.088],
           [(0.022, 0.03), (0.019, 0.04), (0.017, 0.044), (0.015, 0.043)], m, blend, seg=12, ref=T)
    fingers = [(0.024, 0.074), (0.008, 0.082), (-0.008, 0.077), (-0.023, 0.062)]
    for off, length in fingers:
        p = base + D * 0.088 + T * off + Np * 0.002
        d = D.copy()
        axis = D.cross(Np).normalized()
        path = [p - d * 0.008, p]
        for seg_len, curl in ((0.45, 0.42), (0.3, 0.55), (0.25, 0.45)):
            d = (Matrix.Rotation(curl, 3, axis) @ d).normalized()
            p = p + d * length * seg_len
            path.append(p)
        rad = [(0.0098, 0.0092), (0.0098, 0.0092), (0.0088, 0.0083), (0.0076, 0.0072), (0.0062, 0.006)]
        b.tube(path, rad, m, bone, seg=8, ref=Np)
    # Thumb
    p = base + D * 0.022 + T * 0.026 + Np * 0.006
    d = (D * 0.55 + T * 0.75 + Np * 0.3).normalized()
    path = [p - d * 0.01, p]
    axis = d.cross(Np).normalized()
    for seg_len, curl in ((0.042, 0.25), (0.032, 0.35), (0.026, 0.3)):
        d = (Matrix.Rotation(curl, 3, axis) @ d).normalized()
        p = p + d * seg_len
        path.append(p)
    b.tube(path, [(0.0125, 0.011), (0.0125, 0.011), (0.0115, 0.0102), (0.0098, 0.009), (0.0078, 0.0072)], m, bone,
           seg=8, ref=Np)


# ---------------------------------------------------------------------------
# Shirt details, belt and boots (part of the body object)
# ---------------------------------------------------------------------------
def build_shirt_details(b, M, body):
    W = body.weights_at
    # Collar band: hugs the neck over the shirt/skin seam, open a little at the throat
    n = 28
    gap = 0.16
    lo, hi, lip = [], [], []
    for i in range(n + 1):
        ang = gap + (2 * math.pi - 2 * gap) * i / n    # front-left, round the back, to front-right
        lo.append(body.around(ang, NECKLINE - 0.014, 0.0035))
        hi.append(body.around(ang, NECKLINE + 0.024, 0.0075))
        lip.append(body.around(ang, NECKLINE + 0.024, 0.002))
    vl = [b.bm.verts.new(p) for p in lo]
    vh = [b.bm.verts.new(p) for p in hi]
    vi = [b.bm.verts.new(p) for p in lip]
    for i in range(len(vl) - 1):
        b.bm.faces.new((vl[i], vl[i + 1], vh[i + 1], vh[i]))
        b.bm.faces.new((vh[i], vh[i + 1], vi[i + 1], vi[i]))
    b.bm.normal_update()
    b._finish(vl + vh + vi, M['shirt'], W, True)
    # Collar points folded down onto the chest
    for k in (-1, 1):
        q = [body.around(k * 0.2, NECKLINE + 0.026, 0.009), body.around(k * 0.62, NECKLINE + 0.012, 0.009),
             body.around(k * 0.7, NECKLINE - 0.03, 0.007), body.around(k * 0.36, NECKLINE - 0.052, 0.007),
             body.around(k * 0.12, NECKLINE - 0.012, 0.007)]
        b.poly(list(reversed(q)) if k > 0 else q, M['shirt'], W, smooth=True)
    # Placket and buttons down the front
    pts = [body.surface(0.0, z, -1, 0.002)[0] for z in (1.0, 1.1, 1.2, 1.3, 1.4, 1.452)]
    b.ribbon(pts, 0.03, lambda p: body.normal(p), M['shirt'], W, thick=0.0025)
    for z in (1.05, 1.15, 1.25, 1.35, 1.43):
        p, n = body.surface(0.0, z, -1, 0.006)
        b.cyl(p - n * 0.003, p + n * 0.0015, 0.0052, 0.0048, M['button'], W, seg=8)
    # Chest pockets with flaps and a button
    for k in (-1, 1):
        x0 = k * 0.072
        grid = [[body.surface(x0 + dx, z, -1, 0.0035)[0] for dx in (-0.035, 0.0, 0.035)] for z in (1.255, 1.3, 1.345)]
        vs = [[b.bm.verts.new(p) for p in row] for row in grid]
        for r in range(2):
            for c in range(2):
                q = (vs[r][c], vs[r][c + 1], vs[r + 1][c + 1], vs[r + 1][c])
                b.bm.faces.new(q if k > 0 else tuple(reversed(q)))
        b.bm.normal_update()
        b._finish([v for row in vs for v in row], M['shirt'], W, False)
        flap = [body.surface(x0 + dx, 1.352, -1, 0.0065)[0] for dx in (-0.038, 0.0, 0.038)]
        b.ribbon(flap, 0.026, lambda p: body.normal(p), M['shirt'], W, thick=0.002)
        p, n = body.surface(x0, 1.34, -1, 0.009)
        b.cyl(p - n * 0.003, p + n * 0.0015, 0.0045, 0.004, M['button'], W, seg=8)
    # Cuffs
    for s, k in SIDES:
        el, wr = Vector(J[f'elbow.{s}']), Vector(J[f'wrist.{s}'])
        d = (wr - el).normalized()
        b.tube([wr - d * 0.055, wr - d * 0.004], [(0.038, 0.034), (0.037, 0.033)], M['shirt'], W, seg=14,
               ref=Vector((0, -1, 0)))
    # Trouser belt with a buckle
    ring = body.ring(0.978, 28, 0.004)
    top = [p + Vector((0, 0, 0.019)) for p in ring]
    bot = [p - Vector((0, 0, 0.019)) for p in ring]
    va = [b.bm.verts.new(p) for p in bot]
    vb = [b.bm.verts.new(p) for p in top]
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        b.bm.faces.new((va[i], va[j], vb[j], vb[i]))
    b.bm.normal_update()
    b._finish(va + vb, M['belt'], W, False)
    p, n = body.surface(0.0, 0.978, -1, 0.008)
    b.box((0.046, 0.008, 0.036), p, material=M['brass'], bone=W)


def build_boots(b, M):
    for s, k in SIDES:
        foot = f'foot.{s}'
        shin = f'shin.{s}'
        an = Vector(J[f'ankle.{s}'])

        def bw(co, an=an, foot=foot, shin=shin):
            t = smoothstep(an.z + 0.01, an.z + 0.07, co.z)
            if co.y < an.y - 0.03:
                t *= 0.3
            return {shin: t, foot: 1 - t}
        x = k * 0.105
        # Shaft, flared at the top with a pull strap seam
        b.tube([(x, 0.012, 0.415), (x, 0.012, 0.395), (x, 0.014, 0.3), (x, 0.018, 0.18), (x, 0.022, 0.1)],
               [(0.064, 0.068), (0.06, 0.064), (0.057, 0.061), (0.049, 0.053), (0.046, 0.05)], M['boots'],
               lambda co, bw=bw, shin=shin: bw(co) if co.z < 0.16 else {shin: 1.0}, seg=18, caps=(False, False))
        b.tube([(x, 0.012, 0.418), (x, 0.012, 0.402)], [(0.066, 0.07), (0.066, 0.07)], M['boots'], shin, seg=18)
        # Foot: heel to a narrow toe
        path = [(x, 0.068, 0.052), (x, 0.045, 0.07), (x, 0.0, 0.072), (x, -0.06, 0.055), (x * 1.01, -0.11, 0.042),
                (x * 1.02, -0.15, 0.033), (x * 1.03, -0.168, 0.03)]
        radii = [(0.04, 0.042), (0.046, 0.05), (0.047, 0.05), (0.047, 0.04), (0.042, 0.03), (0.028, 0.022), (0.012, 0.012)]
        b.tube(path, radii, M['boots'], bw, seg=16, ref=Vector((0, 0, 1)))
        # Sole and the riding heel
        b.box((0.09, 0.2, 0.012), (x, -0.06, 0.012), material=M['sole'], bone=foot)
        b.box((0.075, 0.07, 0.006), (x * 1.02, -0.15, 0.012), material=M['sole'], bone=foot)
        b.box((0.058, 0.05, 0.04), (x, 0.05, 0.022), (0.08, 0, 0), M['sole'], foot)
        # Spur
        sp = Vector((x, 0.088, 0.045))
        b.cyl(sp + Vector((-0.004, 0, 0)), sp + Vector((0.004, 0, 0)), 0.014, 0.014, M['steel'], foot, seg=10,
              ref=Vector((0, 0, 1)))
        b.tube([Vector((x - 0.044, 0.04, 0.05)), Vector((x, 0.07, 0.05)), Vector((x + 0.044, 0.04, 0.05))],
               [(0.004, 0.006)] * 3, M['leather'], foot, seg=6)


# ---------------------------------------------------------------------------
# Separate clothing pieces (shown or hidden per character by the game)
# ---------------------------------------------------------------------------
def build_hat(M):
    b = Builder('Hat')
    cz = HEAD_C.z + 0.07
    yc = HEAD_C.y - 0.006

    def brim(c):
        x = abs(c.x) / 0.195
        f = clamp((-(c.y - yc)) / 0.215)
        return Vector((c.x, c.y, c.z + 0.05 * x ** 2.3 - 0.016 * f ** 2 + 0.006 * (1 - x) * (c.y - yc > 0)))

    v = b.tube([(0, yc, cz - 0.0045), (0, yc, cz + 0.0045)], [(0.195, 0.215), (0.195, 0.215)], M['hat'], 'head', seg=44)
    for vert in v:
        vert.co = brim(vert.co)
    # Rolled brim edge
    edge = []
    for i in range(45):
        a = 2 * math.pi * i / 44
        edge.append(brim(Vector((math.cos(a) * 0.196, yc + math.sin(a) * 0.216, cz + 0.002))))
    b.tube(edge, [(0.0055, 0.0055)] * 45, M['hat'], 'head', seg=6, caps=(False, False))

    def crown(c):
        dz = c.z - cz
        if dz > 0.09:
            dent = 0.03 * (1 - min(1, abs(c.x) / 0.06)) * smoothstep(0.09, 0.118, dz)
            pinch = smoothstep(0.0, 0.07, -(c.y - yc)) * smoothstep(0.06, 0.115, dz)
            return Vector((c.x * (1 - 0.35 * pinch), c.y, c.z - dent))
        return c

    v = b.tube([(0, yc, cz), (0, yc, cz + 0.05), (0, yc + 0.002, cz + 0.095), (0, yc + 0.004, cz + 0.116),
                (0, yc + 0.004, cz + 0.12)],
               [(0.08, 0.098), (0.078, 0.095), (0.074, 0.09), (0.06, 0.077), (0.035, 0.05)], M['hat'], 'head', seg=28)
    for vert in v:
        vert.co = crown(vert.co)
    b.tube([(0, yc, cz + 0.004), (0, yc, cz + 0.024)], [(0.0815, 0.0995), (0.0805, 0.0985)], M['hatband'], 'head', seg=28)
    b.bm.normal_update()
    return b


def build_beard(M, head):
    b = Builder('Beard')
    shell(b, head, beard_zone, 0.0045, M['beard'], 'hair', rough_noise=0.0012, floor=0.2)
    return b


def build_mask(M, head):
    b = Builder('Mask')
    C = HEAD_C
    tip_y = min(v.co.y for v in head['verts'] if abs(v.co.x) < 0.006 and abs(v.co.z - C.z + 0.022) < 0.006)

    def zone(p):
        return p.z < 0.006 and (p.y < 0.035 or p.z < -0.07)

    faces = shell(b, head, zone, 0.008, M['mask'], 'bandana', {'head': 1.0}, floor=1.0)
    # Drape: hang straight down from the nose instead of following the lips
    for v in {v for f in faces for v in f.verts}:
        local = v.co - C
        if local.y < -0.04 and local.z < -0.02:
            hang = tip_y + 0.004 + (-0.022 - local.z) * 0.22
            if v.co.y > hang and abs(local.x) < 0.045:
                v.co.y = v.co.y + (hang - v.co.y) * (1 - abs(local.x) / 0.045)
    # Down over the neck to the collar, and the knotted flap in front
    path = [(0, 0.006, 1.47), (0, 0.004, 1.51), (0, -0.002, 1.55)]
    b.tube(path, [(0.074, 0.074), (0.07, 0.072), (0.074, 0.084)], M['mask'],
           lambda co: {'neck': 1.0} if co.z < 1.52 else {'neck': 0.5, 'head': 0.5}, seg=20, caps=(False, False))
    flap = [(-0.07, -0.074, 1.528), (0.07, -0.074, 1.528), (0.0, -0.1, 1.41)]
    b.poly(flap, M['mask'], {'neck': 0.4, 'chest': 0.6})
    b.poly([(-0.07, -0.074, 1.528), (0.0, -0.1, 1.41), (0.0, -0.088, 1.532)], M['mask'], {'neck': 0.4, 'chest': 0.6})
    b.poly([(0.07, -0.074, 1.528), (0.0, -0.088, 1.532), (0.0, -0.1, 1.41)], M['mask'], {'neck': 0.4, 'chest': 0.6})
    b.ball((0.018, 0.012, 0.014), (0, 0.085, 1.55), material=M['mask'], bone='head', seg=8, rings=6)
    for k in (-1, 1):
        b.poly([(k * 0.008, 0.088, 1.548), (k * 0.03, 0.096, 1.49), (k * 0.012, 0.092, 1.49)], M['mask'], 'neck')
    b.bm.normal_update()
    return b


def garment(name, M, body, material, cover, off_fn):
    """A layer of cloth over the body where cover(v) >= 0 (signed metres), pushed out by off_fn(v)."""
    b = Builder(name)
    cv = {v: cover(v) for f in body.faces for v in f.verts}
    out = clip_layer(b, body.faces, cv, lambda co, c, src: off_fn(src), lambda v: body.weights[v.index])
    mi = b._mi(material)
    for f in out:
        f.material_index = mi
        f.smooth = True
    return b


def sleeve_end(co, inset):
    """Signed distance (m) along the forearm from co to `inset` short of the wrist."""
    s = 'L' if co.x > 0 else 'R'
    el, wr = Vector(J[f'elbow.{s}']), Vector(J[f'wrist.{s}'])
    d = (wr - el).normalized()
    return (wr - co).dot(d) - inset


def opening(z, base, top, z0=1.16, z1=1.42):
    return base + top * smoothstep(z0, z1, z)


def skirt_weights(co):
    t = clamp((0.95 - co.z) / 0.45)
    if abs(co.x) < 1e-4:
        return {'hips': 1}
    side = 'L' if co.x > 0 else 'R'
    front = clamp(0.5 - co.y / 0.25)
    w = t * 0.75 * front
    return {'hips': 1 - w, f'thigh.{side}': w}


def build_coat(M, body, name, long):
    material = M['coat'] if name == 'Coat' else M['jacket']
    region = body.region
    base, top = (0.05, 0.085) if long else (0.03, 0.075)

    def cover(v):
        c = v.co
        r = region[v.index]
        if r == 'leg':
            return -1.0
        m = min(c.z - 0.9, NECKLINE + 0.004 - c.z)
        if c.y < 0:
            m = min(m, abs(c.x) - opening(c.z, base, top))
        if r == 'arm':
            m = min(m, sleeve_end(c, 0.018))
        return m

    def off(v):
        if region[v.index] == 'arm':
            return 0.015 + 0.008 * smoothstep(0.12, 0.0, sleeve_end(v.co, 0.0))
        return 0.019

    b = garment(name, M, body, material, cover, off)
    # Skirt from the waist down, open at the front and opening wider toward the hem
    zs = [0.95, 0.8, 0.62, 0.42] if long else [0.95, 0.87, 0.8]
    flare = [1.0, 1.12, 1.25, 1.38] if long else [1.0, 1.04, 1.07]
    gaps = [0.36, 0.42, 0.5, 0.58] if long else [0.22, 0.25, 0.28]
    n = 36
    rings = []
    for z, fl, gap in zip(zs, flare, gaps):
        ring = []
        for i in range(n + 1):
            ang = gap + (2 * math.pi - 2 * gap) * i / n
            p = body.around(ang, 0.95, 0.024)
            ring.append(b.bm.verts.new(Vector((p.x * fl, (p.y - 0.01) * fl + 0.01, z))))
        rings.append(ring)
    for r in range(len(rings) - 1):
        for i in range(n):
            b.bm.faces.new((rings[r][i + 1], rings[r][i], rings[r + 1][i], rings[r + 1][i + 1]))
    b.bm.normal_update()
    b._finish([v for ring in rings for v in ring], material, skirt_weights, True)
    # Turned-up collar standing off the neck, open at the throat
    m = 22
    lo, hi = [], []
    for i in range(m + 1):
        ang = 0.55 + (2 * math.pi - 1.1) * i / m
        lo.append(b.bm.verts.new(body.around(ang, NECKLINE - 0.006, 0.021)))
        hi.append(b.bm.verts.new(body.around(ang, NECKLINE + 0.03, 0.03)))
    for i in range(m):
        b.bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
    b.bm.normal_update()
    b._finish(lo + hi, material, {'chest': 0.7, 'neck': 0.3}, True)
    # Lapels folded back over the chest along the opening
    for k in (-1, 1):
        zs_l = (1.18, 1.26, 1.34, 1.42)
        vin, vout = [], []
        for i, z in enumerate(zs_l):
            w = opening(z, base, top)
            vin.append(b.bm.verts.new(body.surface(k * w, z, -1, 0.022)[0]))
            vout.append(b.bm.verts.new(body.surface(k * (w + 0.022 + 0.014 * i), z + 0.004 * i, -1, 0.024)[0]))
        for i in range(3):
            q = (vin[i], vin[i + 1], vout[i + 1], vout[i])
            b.bm.faces.new(tuple(reversed(q)) if k > 0 else q)
        b.bm.normal_update()
        b._finish(vin + vout, material, body.weights_at, True)
    return b


def build_vest(M, body):
    region = body.region

    def cover(v):
        c = v.co
        r = region[v.index]
        if r in ('arm', 'leg'):
            return -1.0
        m = min(c.z - 0.93, NECKLINE - 0.012 - c.z)
        # arm holes, open all the way out past the shoulder
        e = math.sqrt((max(0.0, 0.17 - abs(c.x)) / 0.06) ** 2 + ((c.z - 1.36) / 0.11) ** 2)
        m = min(m, (e - 1) * 0.05)
        if r == 'shoulder' or c.z > 1.4:
            m = min(m, 0.13 - abs(c.x))
        if c.y < 0:
            m = min(m, abs(c.x) - opening(c.z, 0.014, 0.06, 1.08, 1.4))
        return m

    b = garment('Vest', M, body, M['vest'], cover, lambda v: 0.009)
    for z in (1.0, 1.07, 1.14, 1.21):
        w = opening(z, 0.014, 0.06, 1.08, 1.4)
        p, n = body.surface(w + 0.012, z, -1, 0.013)
        b.cyl(p - n * 0.003, p + n * 0.002, 0.005, 0.0045, M['brass'], body.weights_at, seg=8)
    return b


def strap(b, body, pts, width, material, thick=0.006):
    b.ribbon(pts, width, lambda p: body.normal(p), material, body.weights_at, thick=thick)


def build_suspenders(M, body):
    b = Builder('Suspenders')
    for s, k in SIDES:
        front = [body.surface(k * 0.07, z, -1, 0.004)[0] for z in (0.99, 1.1, 1.2, 1.3, 1.38, 1.44)]
        top = [Vector((k * 0.082, 0.004, 1.474))]
        back = [body.surface(k * (0.055 - 0.04 * (1.44 - z) / 0.45), z, 1, 0.004)[0] for z in (1.44, 1.38, 1.3, 1.2, 1.1, 0.99)]
        strap(b, body, front + top + back, 0.028, M['strap'])
        b.box((0.032, 0.01, 0.022), front[0] + Vector((0, -0.006, 0.012)), material=M['brass'], bone=body.weights_at)
    return b


def build_satchel(M, body):
    b = Builder('Satchel')
    front = [body.surface(-0.11 + t * 0.28, 1.44 - t * 0.46, -1, 0.008)[0] for t in [i / 8 for i in range(9)]]
    back = [body.surface(-0.11 + t * 0.28, 1.44 - t * 0.46, 1, 0.008)[0] for t in [i / 8 for i in range(9)]]
    back.reverse()
    strap(b, body, back + [Vector((-0.12, 0.004, 1.478))] + front, 0.032, M['strap'], 0.007)
    side = body.surface(0.17, 0.88, -1, 0.0)[0]
    x = max(0.19, side.x + 0.03) if side else 0.19
    b.box((0.06, 0.2, 0.17), (x, 0.0, 0.875), (0, 0, 0), M['leather'], 'hips')
    b.box((0.066, 0.206, 0.075), (x + 0.002, 0.0, 0.93), (0, 0.06, 0), M['leather'], 'hips')
    b.box((0.012, 0.028, 0.018), (x + 0.036, 0.0, 0.905), material=M['brass'], bone='hips')
    return b


def build_gunbelt(M, body):
    b = Builder('GunBelt')
    ring = body.ring(0.92, 32, 0.012, tilt=0.035)
    top = [p + Vector((0, 0, 0.022)) for p in ring]
    bot = [p - Vector((0, 0, 0.022)) for p in ring]
    va = [b.bm.verts.new(p) for p in bot]
    vb = [b.bm.verts.new(p) for p in top]
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        b.bm.faces.new((va[i], va[j], vb[j], vb[i]))
    b.bm.normal_update()
    b._finish(va + vb, M['leather'], 'hips', False)
    # Cartridge loops on the left and front
    for i in range(len(ring)):
        p = ring[i]
        a = math.atan2(p.y, p.x)
        if -2.4 < a < -0.4 or 0.2 < a < 1.0:
            n = (p - Vector((0, 0, p.z))).normalized()
            q = p + n * 0.006
            b.cyl(q - Vector((0, 0, 0.018)), q + Vector((0, 0, 0.024)), 0.0055, 0.0045, M['brass'], 'hips', seg=6)
    # Holster on the right hip, buckle in front
    hp = min(ring, key=lambda p: p.x)
    b.cyl(hp + Vector((-0.006, 0.012, -0.01)), hp + Vector((-0.012, 0.032, -0.2)), 0.034, 0.026, M['leather'], 'hips',
          seg=12, squash=0.6, ref=Vector((1, 0, 0)))
    front = min(ring, key=lambda p: p.y)
    b.box((0.05, 0.01, 0.04), front + Vector((0, -0.006, 0)), material=M['brass'], bone='hips')
    b.holster = hp
    return b


def build_badge(M, body):
    b = Builder('Badge')
    p, n = body.surface(0.085, 1.31, -1, 0.017)
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        r = 0.028 if i % 2 == 0 else 0.012
        pts.append(p + Vector((math.cos(a) * r, 0, math.sin(a) * r)))
    b.poly(list(reversed(pts)), M['badge'], 'chest')
    b.cyl(p + Vector((0, 0.003, 0)), p + Vector((0, -0.003, 0)), 0.013, 0.013, M['badge'], 'chest', seg=12)
    return b


def revolver_parts(b, M, bone, m):
    """A single-action revolver in gun space (barrel along -Y, grip down -Z), placed by matrix m."""
    def P(x, y, z):
        return m @ Vector((x, y, z))

    def cyl(p0, p1, r0, r1, mm, seg=10):
        b.cyl(P(*p0), P(*p1), r0, r1, mm, bone, seg=seg)

    cyl((0, -0.035, 0.032), (0, -0.2, 0.032), 0.0085, 0.0085, M['metal'])
    cyl((0, -0.04, 0.018), (0, -0.17, 0.018), 0.0048, 0.0048, M['metal'], 8)
    cyl((0, 0.008, 0.026), (0, -0.04, 0.026), 0.021, 0.021, M['steel'], 12)
    cyl((0, -0.192, 0.042), (0, -0.2, 0.042), 0.002, 0.002, M['metal'], 4)
    for (sx, sy, sz), (lx, ly, lz) in (((0.016, 0.06, 0.05), (0, 0.0, 0.027)), ((0.012, 0.04, 0.012), (0, 0.035, 0.05)),
                                       ((0.006, 0.02, 0.022), (0, 0.048, 0.064)), ((0.004, 0.012, 0.03), (0, 0.012, -0.008))):
        mm = m @ trs((lx, ly, lz), (0, 0, 0), (sx, sy, sz))
        b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)
    # Trigger guard
    for i in range(5):
        a = math.pi * i / 4
        p = (0, 0.012 - 0.022 * math.cos(a), -0.002 - 0.022 * math.sin(a))
        mm = m @ trs(p, (0, 0, 0), (0.004, 0.008, 0.004))
        b.box((1, 1, 1), matrix=mm, material=M['brass'], bone=bone)
    # Grip
    b.cyl(P(0, 0.035, 0.012), P(0, 0.066, -0.075), 0.015, 0.017, M['grip'], bone, seg=10,
          ref=m.to_3x3() @ Vector((0, 1, 0)), squash=1.5)


def rifle_parts(b, M, bone, m):
    """Lever-action carbine, gun space like the revolver (wrist of the stock at the origin)."""
    def P(x, y, z):
        return m @ Vector((x, y, z))

    up = m.to_3x3() @ Vector((0, 0, 1))
    b.cyl(P(0, -0.12, 0.03), P(0, -0.68, 0.03), 0.009, 0.0085, M['metal'], bone, seg=8)
    b.cyl(P(0, -0.12, 0.014), P(0, -0.62, 0.014), 0.0075, 0.0075, M['metal'], bone, seg=8)
    b.cyl(P(0, -0.12, 0.018), P(0, -0.42, 0.018), 0.017, 0.015, M['stock'], bone, seg=8, ref=up, squash=1.2)
    mm = m @ trs((0, -0.06, 0.02), (0, 0, 0), (0.026, 0.13, 0.05))
    b.box((1, 1, 1), matrix=mm, material=M['brass'], bone=bone)
    # Stock: wrist then butt, dropping down and back
    b.cyl(P(0, 0.0, 0.012), P(0, 0.12, -0.01), 0.016, 0.018, M['stock'], bone, seg=8, ref=up, squash=1.3)
    b.cyl(P(0, 0.11, -0.005), P(0, 0.36, -0.03), 0.022, 0.03, M['stock'], bone, seg=8, ref=up, squash=1.7)
    mm = m @ trs((0, 0.362, -0.03), (0.05, 0, 0), (0.03, 0.012, 0.11))
    b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)
    # Lever loop
    for i in range(6):
        a = math.pi * i / 5
        p = (0, -0.02 + 0.03 * math.cos(a), -0.02 - 0.028 * math.sin(a))
        mm = m @ trs(p, (0, 0, 0), (0.006, 0.01, 0.006))
        b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)
    mm = m @ trs((0, -0.67, 0.042), (0, 0, 0), (0.003, 0.006, 0.006))
    b.box((1, 1, 1), matrix=mm, material=M['metal'], bone=bone)


def bone_matrix(rig, name):
    return rig.matrix_world @ rig.data.bones[name].matrix_local


# In hand space (bone Y toward the fingers, Z toward the thumb side): barrel
# along +Y, gun "up" toward the thumb. R maps gun space onto that.
GUN_IN_HAND = Matrix.Rotation(math.pi, 4, 'Z')


def build_weapon_builders(M, body, gunbelt):
    """Skinned weapon pieces that need the body: holstered revolver, slung rifle."""
    hb = Builder('HolsterGun')
    hp = gunbelt.holster
    m = Matrix.Translation(hp + Vector((-0.004, 0.01, 0.0))) @ Matrix.Rotation(math.radians(78), 4, 'X')
    revolver_parts(hb, M, 'hips', m)

    rb = Builder('RifleBack')
    back = body.surface(0.08, 1.2, 1, 0.045)[0]
    p0 = Vector((0.13, back.y, 0.95))
    p1 = Vector((-0.05, back.y + 0.01, 1.62))
    d = (p1 - p0).normalized()
    side = Vector((0, 1, 0)).cross(d).normalized()
    mm = Matrix((side, -d, Vector((0, 1, 0)))).transposed().to_4x4()
    mm.translation = p0
    rifle_parts(rb, M, 'chest', mm)
    # Sling: up the back, over the left shoulder, across the chest to the right hip
    sling = [body.surface(0.13, 0.98, 1, 0.012)[0], body.surface(0.12, 1.2, 1, 0.012)[0],
             body.surface(0.11, 1.42, 1, 0.012)[0], Vector((0.1, 0.004, 1.48)),
             body.surface(0.085, 1.38, -1, 0.014)[0], body.surface(0.0, 1.2, -1, 0.014)[0],
             body.surface(-0.13, 1.0, -1, 0.014)[0]]
    strap(rb, body, sling, 0.024, M['strap'], 0.008)
    return hb, rb


def build_weapons(rig, col, M):
    """The guns held in the hand: plain meshes parented to the hand bone."""
    hand = bone_matrix(rig, 'hand.R')
    out = []
    b = Builder('Revolver')
    revolver_parts(b, M, None, Matrix())
    atlas_uv(b)
    ob = b.build(col)
    attach_to_bone(ob, rig, 'hand.R', hand @ Matrix.Translation((0.004, 0.105, 0.012)) @ GUN_IN_HAND)
    out.append(ob)
    b = Builder('RifleHand')
    rifle_parts(b, M, None, Matrix())
    atlas_uv(b)
    ob = b.build(col)
    attach_to_bone(ob, rig, 'hand.R', hand @ Matrix.Translation((0.004, 0.06, 0.0)) @ GUN_IN_HAND)
    out.append(ob)
    return out


# ---------------------------------------------------------------------------
# Animation
# ---------------------------------------------------------------------------
def R(P, name, x=0.0, y=0.0, z=0.0):
    e = P[name].rotation_euler
    e.x += x
    e.y += y
    e.z += z


def L(P, name, x=0.0, y=0.0, z=0.0):
    loc = P[name].location
    loc.x += x
    loc.y += y
    loc.z += z


def point_bone(rig, name, direction, toward=Vector((0, -1, 0))):
    """Pose bone `name` so it points along `direction` (armature space), its Z
    axis turned toward `toward`."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[name]
    y = Vector(direction).normalized()
    z = Vector(toward)
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = pb.head.copy()
    pb.matrix = m
    pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def reach(rig, side, target, pole, hand_dir=None, hand_up=Vector((0, -1, 0))):
    """Two-bone IK for an arm: put the wrist at `target` with the elbow toward `pole`."""
    bpy.context.view_layer.update()
    ua = rig.pose.bones[f'upperarm.{side}']
    s = ua.head.copy()
    l1 = (Vector(J[f'elbow.{side}']) - Vector(J[f'shoulder.{side}'])).length
    l2 = (Vector(J[f'wrist.{side}']) - Vector(J[f'elbow.{side}'])).length
    t = Vector(target)
    d = t - s
    dist = min(d.length, l1 + l2 - 1e-3)
    dn = d.normalized()
    a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    a = math.acos(max(-1, min(1, a)))
    pole_dir = (Vector(pole) - dn * Vector(pole).dot(dn)).normalized()
    elbow = s + (dn * math.cos(a) + pole_dir * math.sin(a)) * l1
    point_bone(rig, f'upperarm.{side}', elbow - s)
    wrist = s + dn * dist
    point_bone(rig, f'forearm.{side}', wrist - elbow, Vector((0, -1, 0)))
    if hand_dir is not None:
        point_bone(rig, f'hand.{side}', hand_dir, hand_up)


def animate(rig):
    A = Animator(rig)
    tau = 2 * math.pi

    def clip(name, frames, pose, **kw):
        # The rest pose holds the arms a little out; bring them back to the sides
        def posed(P, t, f):
            for s, k in SIDES:
                P[f'upperarm.{s}'].rotation_euler.z -= k * ARM_REST_SPREAD
            pose(P, t, f)
        A.clip(name, frames, posed, **kw)

    def idle(P, t, f):
        b = math.sin(tau * t)
        R(P, 'spine', x=0.02 + 0.012 * b)
        R(P, 'chest', x=0.015 * b)
        R(P, 'head', x=-0.02 * b, y=0.06 * math.sin(tau * t + 1))
        L(P, 'hips', y=-0.004 + 0.003 * b)
        R(P, 'hips', z=0.02 * math.sin(tau * t))
        for s, k in SIDES:
            R(P, f'upperarm.{s}', x=0.03 * b, z=k * 0.05)
            R(P, f'forearm.{s}', x=0.18 + 0.03 * b)
            R(P, f'hand.{s}', x=0.1)
            R(P, f'thigh.{s}', z=k * 0.03, x=0.02)
            R(P, f'shin.{s}', x=-0.04)
            R(P, f'foot.{s}', x=0.02)
    clip('idle', 90, idle)

    def gait(P, t, run):
        ph = tau * t
        for s, k in SIDES:
            p = ph + (0 if s == 'L' else math.pi)
            sw = math.sin(p)
            if run:
                R(P, f'thigh.{s}', x=-0.12 + 0.9 * sw + 0.25)
                R(P, f'shin.{s}', x=-(0.25 + 1.55 * max(0, math.cos(p - 0.6)) ** 1.6))
                R(P, f'foot.{s}', x=0.25 * sw - 0.1)
                R(P, f'upperarm.{s}', x=-0.75 * sw + 0.1, z=k * 0.12)
                R(P, f'forearm.{s}', x=1.25 + 0.2 * sw)
                R(P, f'hand.{s}', x=0.2)
            else:
                R(P, f'thigh.{s}', x=0.42 * sw + 0.04)
                R(P, f'shin.{s}', x=-(0.08 + 0.8 * max(0, math.cos(p - 0.5)) ** 2))
                R(P, f'foot.{s}', x=0.2 * sw - 0.05 * max(0, -sw))
                R(P, f'upperarm.{s}', x=-0.38 * sw, z=k * 0.07)
                R(P, f'forearm.{s}', x=0.25 + 0.2 * max(0, -sw))
                R(P, f'hand.{s}', x=0.1)
        twist = math.sin(ph)
        if run:
            L(P, 'hips', y=-0.05 + 0.045 * math.cos(2 * ph))
            R(P, 'hips', y=-0.14 * twist, x=0.12)
            R(P, 'spine', x=0.1, y=0.08 * twist)
            R(P, 'chest', x=0.06, y=0.12 * twist)
            R(P, 'neck', x=-0.12)
            R(P, 'head', x=-0.1, y=-0.05 * twist)
        else:
            L(P, 'hips', y=-0.01 + 0.022 * math.cos(2 * ph))
            R(P, 'hips', y=-0.1 * twist, z=0.03 * math.sin(ph))
            R(P, 'spine', x=0.03, y=0.05 * twist)
            R(P, 'chest', y=0.08 * twist)
            R(P, 'head', y=-0.04 * twist, x=-0.02)
    clip('walk', 32, lambda P, t, f: gait(P, t, False))
    clip('run', 20, lambda P, t, f: gait(P, t, True))

    # Aim poses only key the upper body, so the game can lay them over walking.
    def aim_pistol(P, t, f):
        R(P, 'spine', y=0.08)
        R(P, 'chest', y=0.12, x=0.02)
        R(P, 'neck', y=-0.1)
        R(P, 'head', y=-0.08, x=-0.03)
        reach(rig, 'R', Vector((-0.07, -0.58, 1.42)), Vector((-1, 0.3, -0.6)), Vector((0.08, -1, 0.0)),
              Vector((0, 0, 1)))
        reach(rig, 'L', Vector((0.2, -0.12, 1.0)), Vector((1, 0.4, 0)), Vector((0, -0.3, -1)))
    clip('aim_pistol', 2, aim_pistol, bones=UPPER, step=1)

    def aim_rifle(P, t, f):
        R(P, 'spine', y=-0.25)
        R(P, 'chest', y=-0.3, x=0.04)
        R(P, 'neck', y=0.28)
        R(P, 'head', y=0.25, z=0.12, x=0.04)
        reach(rig, 'R', Vector((-0.11, -0.3, 1.38)), Vector((-1, 0.4, -0.25)), Vector((0.06, -1, -0.02)),
              Vector((0, 0, 1)))
        reach(rig, 'L', Vector((-0.1, -0.56, 1.37)), Vector((1, 0, -1)), Vector((-0.05, -1, 0)),
              Vector((-1, 0, 0.3)))
    clip('aim_rifle', 2, aim_rifle, bones=UPPER, step=1)

    def ride(P, t, f):
        b = math.sin(tau * t)
        R(P, 'hips', x=-0.05)
        R(P, 'spine', x=0.1 + 0.02 * b)
        R(P, 'chest', x=0.05)
        R(P, 'head', x=-0.12)
        for s, k in SIDES:
            R(P, f'thigh.{s}', x=1.25, z=k * 0.5)
            R(P, f'shin.{s}', x=-1.15, z=-k * 0.1)
            R(P, f'foot.{s}', x=0.1)
        bpy.context.view_layer.update()
        for s, k in SIDES:
            reach(rig, s, Vector((k * 0.07, -0.42, 1.14 + 0.01 * b)), Vector((k, 0.6, -0.4)),
                  Vector((-k * 0.2, -0.6, -0.6)), Vector((-k * 0.4, -0.5, 0.5)))
    clip('ride', 40, ride, step=2)

    def die(P, t, f):
        a = smoothstep(0.0, 0.35, t)
        b = smoothstep(0.25, 0.8, t)
        c = math.sin(math.pi * smoothstep(0.78, 1.0, t)) * 0.05
        L(P, 'hips', y=-0.3 * a - 0.55 * b + c, z=-0.15 * a - 0.35 * b)
        R(P, 'hips', x=-1.45 * b, z=0.15 * b)
        R(P, 'spine', x=0.25 * a - 0.15 * b)
        R(P, 'chest', x=0.2 * a - 0.2 * b)
        R(P, 'head', x=0.4 * a - 0.5 * b, y=0.4 * b)
        for s, k in SIDES:
            R(P, f'thigh.{s}', x=0.7 * a - 0.2 * b + (0.15 if s == 'L' else 0) * b, z=k * 0.15 * b)
            R(P, f'shin.{s}', x=-1.1 * a + 0.7 * b - (0.4 if s == 'L' else 0) * b)
            R(P, f'upperarm.{s}', x=0.5 * a - 0.2 * b, z=k * (0.25 * a + 1.0 * b))
            R(P, f'forearm.{s}', x=0.6 * a - 0.3 * b)
    clip('die', 40, die)

    def kneel(P, t, f):
        b = math.sin(tau * t)
        L(P, 'hips', y=-0.47, z=0.05)
        R(P, 'hips', x=0.05)
        R(P, 'thigh.L', x=1.45, z=0.12)
        R(P, 'shin.L', x=-1.55)
        R(P, 'foot.L', x=0.1)
        R(P, 'thigh.R', x=0.12, z=-0.1)
        R(P, 'shin.R', x=-1.95)
        R(P, 'foot.R', x=-0.6)
        R(P, 'spine', x=0.3)
        R(P, 'chest', x=0.2)
        R(P, 'head', x=0.2)
        for s, k in SIDES:
            R(P, f'upperarm.{s}', x=0.9 + 0.08 * b * k, z=k * 0.1)
            R(P, f'forearm.{s}', x=0.5 - 0.1 * b * k)
    clip('kneel', 40, kneel)

    def handsup(P, t, f):
        b = math.sin(tau * t)
        R(P, 'spine', x=-0.04 + 0.02 * b)
        R(P, 'head', x=0.08)
        for s, k in SIDES:
            R(P, f'upperarm.{s}', z=k * (2.3 + 0.05 * b), x=0.25)
            R(P, f'forearm.{s}', x=1.5)
            R(P, f'thigh.{s}', z=k * 0.05)
    clip('handsup', 40, handsup)




def build_cowboy(col):
    M = materials()
    rig = make_armature('Cowboy', skeleton(), col, mode='ZXY')
    body_b = Builder('Body')
    body = build_body(body_b, M)
    head = build_head(body_b, M)
    shell(body_b, head, hairline, 0.0042, M['hair'], 'hair', rough_noise=0.0018)
    for s, k in SIDES:
        build_hand(body_b, M, s, k)
    build_shirt_details(body_b, M, body)
    build_boots(body_b, M)
    # Everything that is fitted to the body is made before the body is finalised
    gunbelt = build_gunbelt(M, body)
    pieces = [build_hat(M), build_mask(M, head), build_beard(M, head), build_coat(M, body, 'Coat', True),
              build_coat(M, body, 'Jacket', False), build_vest(M, body), build_suspenders(M, body),
              build_satchel(M, body), gunbelt, build_badge(M, body)]
    pieces += build_weapon_builders(M, body, gunbelt)
    for p in pieces:
        atlas_uv(p)
    objs = [rig]
    for p in pieces:
        objs.append(p.build(col, rig))
    atlas_uv(body_b)
    objs.insert(1, body_b.build(col, rig))
    objs += build_weapons(rig, col, M)
    animate(rig)
    return rig, objs
