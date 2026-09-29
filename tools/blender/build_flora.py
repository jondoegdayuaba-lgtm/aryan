"""Trees, shrubs and rocks. Each GLB holds several variants; each variant has LOD nodes named
<variant>_lod0/1/2 (finer to coarser). Run through build_all.py."""
import math
import bpy
from mathutils import Vector
from common import *


def lerp(a, b, t):
    return a + (b - a) * t


def strip(bm, uvl, aol, origin, direction, side, length, width, droop, segs, ao0, ao1, tint=1.0):
    """A drooping strip of leaf/needle card. UV v runs base(0)->tip(1), u across."""
    verts = []
    for i in range(segs + 1):
        t = i / segs
        c = origin + direction * (length * t) + Vector((0, 0, -droop * t * t))
        w = width * 0.5 * (1.0 if t > 0.05 else 0.6)
        verts.append((bm.verts.new(c - side * w), bm.verts.new(c + side * w), t))
    for i in range(segs):
        a, b = verts[i], verts[i + 1]
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        for l, (u, v, ao) in zip(f.loops, ((0, a[2], ao0 + (ao1 - ao0) * a[2]), (1, a[2], ao0 + (ao1 - ao0) * a[2]),
                                            (1, b[2], ao0 + (ao1 - ao0) * b[2]), (0, b[2], ao0 + (ao1 - ao0) * b[2]))):
            l[uvl].uv = (u, v)
            l[aol] = (ao * tint, ao * tint, ao * tint, 1.0)
    return bm


def trunk(bm, uvl, aol, r0, r1, height, segs, lean=(0, 0), wobble=0.0, r=None, v_per_m=0.5, circ_scale=1.0):
    """Tapered trunk from z=0 to `height` with cylindrical UVs in metres."""
    rings = max(4, int(height / 1.2))
    layers = []
    for i in range(rings + 1):
        t = i / rings
        rad = lerp(r0, r1, t ** 0.85) * (1 + (r.uniform(-1, 1) * wobble if r and 0 < i < rings else 0))
        cx = lean[0] * t * t * height
        cy = lean[1] * t * t * height
        ring = []
        for s in range(segs):
            a = s / segs * math.tau
            ring.append(bm.verts.new((cx + math.cos(a) * rad, cy + math.sin(a) * rad, t * height)))
        layers.append((ring, t, rad))
    for i in range(rings):
        A, B = layers[i], layers[i + 1]
        for s in range(segs):
            s2 = (s + 1) % segs
            f = bm.faces.new((A[0][s], A[0][s2], B[0][s2], B[0][s]))
            us = (s / segs, (s + 1) / segs if s + 1 < segs else 1.0)
            circ = math.tau * A[2] * circ_scale
            for l, (u, v, k) in zip(f.loops, ((us[0], A[1], 0), (us[1], A[1], 0), (us[1], B[1], 0), (us[0], B[1], 0))):
                l[uvl].uv = (u * circ * 2.0, v * height * v_per_m * 2.0)
                shade = 0.62 + 0.38 * v
                l[aol] = (shade, shade, shade, 1.0)
    return layers


def pine(seed, lod, height):
    r = rng(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    aol = bm.loops.layers.float_color.new('AO')
    trunk_bm = bmesh.new()
    tuv = trunk_bm.loops.layers.uv.new('UVMap')
    tao = trunk_bm.loops.layers.float_color.new('AO')
    trunk(trunk_bm, tuv, tao, 0.26 * height / 12, 0.035, height * 0.96, 8 if lod == 0 else 5, lean=(r.uniform(-0.01, 0.01), r.uniform(-0.01, 0.01)), wobble=0.05, r=r)
    z0 = height * 0.17
    whorls = {0: 24, 1: 11}.get(lod, 0)
    if lod == 2:
        # Far version: stacked opaque cones, vertex-coloured.
        far = bmesh.new()
        far_ao = far.loops.layers.float_color.new('AO')
        far_uv = far.loops.layers.uv.new('UVMap')
        for i in range(4):
            t = i / 4
            rad = lerp(height * 0.19, height * 0.05, t)
            zc = lerp(height * 0.16, height * 0.9, t)
            h = height * lerp(0.36, 0.22, t)
            vs = bmesh.ops.create_cone(far, cap_ends=False, segments=7, radius1=rad, radius2=0.02, depth=h)['verts']
            bmesh.ops.translate(far, verts=vs, vec=(0, 0, zc + h * 0.5))
        for f in far.faces:
            for l in f.loops:
                k = 0.5 + 0.6 * (l.vert.co.z / height)
                l[far_ao] = (k, k, k, 1.0)
                l[far_uv].uv = (0.5, 0.5)
        far_o = new_obj(f'lod2_far', far, material('Pine_Far', (0.09, 0.22, 0.11, 1)))
        return [far_o]
    for w in range(whorls):
        t = w / max(1, whorls - 1)
        z = lerp(z0, height * 0.97, t)
        L = lerp(height * 0.19, height * 0.035, t ** 0.85) * r.uniform(0.9, 1.1)
        count = 7 if lod == 0 else 5
        off = r.uniform(0, math.tau)
        for b in range(count):
            a = off + b / count * math.tau + r.uniform(-0.25, 0.25)
            d = Vector((math.cos(a), math.sin(a), 0.0))
            side = Vector((-d.y, d.x, 0.0))
            droop = L * r.uniform(0.25, 0.38) * (1.0 - 0.35 * t)
            width = max(0.55, L * 0.62)
            ao0 = 0.42 + 0.3 * t
            ao1 = 0.85 + 0.35 * t
            org = Vector((0, 0, z + r.uniform(-0.1, 0.1)))
            strip(bm, uvl, aol, org, d, side, L, width, droop, 2, ao0, ao1)
            if lod == 0:
                # a second, crossed card gives the branch some thickness
                tilt = Vector((0, 0, 1)).cross(d).normalized()
                strip(bm, uvl, aol, org + Vector((0, 0, 0.06)), d, (side * 0.35 + Vector((0, 0, 0.8))).normalized(), L * 0.94, width * 0.85, droop, 2, ao0, ao1, 0.95)
    tr = new_obj('trunk', trunk_bm, material('Bark_Pine', (0.16, 0.11, 0.08, 1)))
    nd = new_obj('needles', bm, material('Pine_Needles', (0.1, 0.25, 0.12, 1)))
    return [tr, nd]


def leafy(seed, lod, height, autumn=True):
    r = rng(seed)
    tbm = bmesh.new()
    tuv = tbm.loops.layers.uv.new('UVMap')
    tao = tbm.loops.layers.float_color.new('AO')
    lean = (r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05))
    trunk(tbm, tuv, tao, 0.17 * height / 9, 0.05, height * 0.72, 8 if lod == 0 else 5, lean=lean, wobble=0.06, r=r, circ_scale=1.0)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    aol = bm.loops.layers.float_color.new('AO')
    n_limbs = 5 if lod == 0 else 4
    clusters = {0: 5, 1: 3}.get(lod, 2)
    for i in range(n_limbs):
        a = i / n_limbs * math.tau + r.uniform(-0.4, 0.4)
        z = height * r.uniform(0.42, 0.7)
        d = Vector((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.78)).normalized()
        L = height * r.uniform(0.28, 0.42)
        base = Vector((lean[0] * (z / height) ** 2 * height, lean[1] * (z / height) ** 2 * height, z))
        # limb: thin tapered box chain
        seg = 3
        pts = [base + d * (L * k / seg) + Vector((0, 0, -0.15 * (k / seg) ** 2 * L * -1)) for k in range(seg + 1)]
        if lod < 2:
            for k in range(seg):
                a0, b0 = pts[k], pts[k + 1]
                r0, r1 = lerp(0.08, 0.02, k / seg) * height / 9, lerp(0.08, 0.02, (k + 1) / seg) * height / 9
                dirv = (b0 - a0)
                ln = dirv.length
                res = bmesh.ops.create_cone(tbm, cap_ends=False, segments=5, radius1=r0, radius2=r1, depth=ln)
                vs = res['verts']
                rot = Vector((0, 0, 1)).rotation_difference(dirv.normalized()).to_matrix().to_4x4()
                bmesh.ops.transform(tbm, matrix=Matrix.Translation((a0 + b0) / 2) @ rot, verts=vs)
                for vv in vs:
                    for f in vv.link_faces:
                        for l in f.loops:
                            l[tuv].uv = (0.2, 0.2)
                            l[tao] = (0.8, 0.8, 0.8, 1.0)
        tip = pts[-1]
        for c in range(clusters):
            cen = tip - d * (L * 0.16 * c) + Vector((r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), r.uniform(-0.2, 0.7)))
            size = height * r.uniform(0.27, 0.36)
            for rot_a in ([0, math.pi / 2] if lod == 0 else [0]):
                sd = Vector((math.cos(rot_a), math.sin(rot_a), 0))
                # a vertical-ish card, u across, v up
                strip(bm, uvl, aol, cen - Vector((0, 0, size * 0.5)), Vector((0, 0, 1)), sd, size, size * 1.05, -size * 0.06, 1, 0.55, 1.2)
            if lod == 0:
                strip(bm, uvl, aol, cen - Vector((size * 0.5, 0, 0)), Vector((1, 0, 0)), Vector((0, 1, 0)), size, size * 0.95, 0, 1, 0.65, 1.15)
    tr = new_obj('trunk', tbm, material('Bark_Birch', (0.8, 0.78, 0.7, 1)))
    lf = new_obj('leaves', bm, material('Leaf_Autumn' if autumn else 'Leaf_Green', (0.8, 0.6, 0.15, 1)))
    return [tr, lf]


def snag(seed, lod, height):
    r = rng(seed)
    tbm = bmesh.new()
    tuv = tbm.loops.layers.uv.new('UVMap')
    tao = tbm.loops.layers.float_color.new('AO')
    trunk(tbm, tuv, tao, 0.2 * height / 9, 0.05, height, 8 if lod == 0 else 5, lean=(r.uniform(-0.03, 0.03), r.uniform(-0.03, 0.03)), wobble=0.08, r=r)
    for i in range(6 if lod == 0 else 3):
        a = r.uniform(0, math.tau)
        z = height * r.uniform(0.35, 0.9)
        d = Vector((math.cos(a), math.sin(a), r.uniform(0.15, 0.5))).normalized()
        L = r.uniform(1.0, 2.6) * (1.1 - z / height * 0.5)
        vs = bmesh.ops.create_cone(tbm, cap_ends=True, segments=4, radius1=0.06, radius2=0.012, depth=L)['verts']
        rot = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        bmesh.ops.transform(tbm, matrix=Matrix.Translation(Vector((0, 0, z)) + d * (L / 2)) @ rot, verts=vs)
        for vv in vs:
            for f in vv.link_faces:
                for l in f.loops:
                    l[tuv].uv = (0.3, 0.3)
                    l[tao] = (0.9, 0.9, 0.9, 1.0)
    return [new_obj('trunk', tbm, material('Bark_Dead', (0.32, 0.29, 0.26, 1)))]


def shrub(seed, lod, size):
    r = rng(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    aol = bm.loops.layers.float_color.new('AO')
    n = {0: 9, 1: 5, 2: 3}[lod]
    for i in range(n):
        a = i / n * math.tau + r.uniform(-0.3, 0.3)
        d = Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 1)).normalized()
        s = size * r.uniform(0.8, 1.15)
        side = Vector((-math.sin(a), math.cos(a), 0))
        strip(bm, uvl, aol, Vector((0, 0, 0.05)), d, side, s, s * 0.9, s * 0.25, 2, 0.4, 1.15)
    return [new_obj('leaves', bm, material('Leaf_Green', (0.15, 0.3, 0.1, 1)))]


def rock(seed, lod, size):
    r = rng(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3 if lod == 0 else 2, radius=1.0)
    sx, sy, sz = r.uniform(0.85, 1.25), r.uniform(0.8, 1.2), r.uniform(0.55, 0.85)
    ph = [r.uniform(0, 100) for _ in range(6)]
    import mathutils.noise as mn
    for v in bm.verts:
        p = v.co.copy()
        n = mn.noise(Vector((p.x * 1.6 + ph[0], p.y * 1.6 + ph[1], p.z * 1.6 + ph[2])))
        n2 = mn.noise(Vector((p.x * 4.2 + ph[3], p.y * 4.2 + ph[4], p.z * 4.2 + ph[5]))) * 0.25
        k = 1 + n * 0.32 + n2
        v.co = Vector((p.x * sx * k, p.y * sy * k, p.z * sz * k))
    # a few flat planes cut across make it look like broken rock rather than a blob
    for _ in range(4):
        nrm = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.2, 1))).normalized()
        off = r.uniform(0.55, 0.8)
        for v in bm.verts:
            d = v.co.dot(nrm) - off
            if d > 0:
                v.co -= nrm * d
    for v in bm.verts:
        v.co.z = max(v.co.z, -0.42 * sz)
        v.co *= size
    bm.normal_update()
    uvl = bm.loops.layers.uv.new('UVMap')
    box_uv(bm, 0.25)
    set_ao(bm, lambda p, n: 0.55 + 0.6 * min(1.0, max(0.0, (p.z / size + 0.45) / 1.0)) * (0.7 + 0.3 * n.z))
    return [new_obj('rock', bm, material('Rock', (0.45, 0.44, 0.42, 1)), smooth=(lod > 0))]


def build_group(fname, variants):
    """variants: list of (name, fn(seed, lod)->objs). Places variants side by side for a preview."""
    reset()
    all_objs = []
    for vi, (name, fn) in enumerate(variants):
        for lod in range(3):
            objs = fn(vi * 31 + 7, lod)
            if not objs:
                continue
            o = join(objs, f'{name}_lod{lod}') if len(objs) > 1 else objs[0]
            o.name = f'{name}_lod{lod}'
            o.location = (vi * 14, lod * 14, 0)
            all_objs.append(o)
            # apply the offset so LOD nodes overlap at the origin in-game
            o.location = (0, 0, 0)
    export(fname, all_objs)


def main():
    build_group('pine', [
        ('A', lambda s, l: pine(s, l, 13.0)),
        ('B', lambda s, l: pine(s + 5, l, 10.5)),
        ('C', lambda s, l: pine(s + 9, l, 16.0)),
    ])
    build_group('birch', [
        ('A', lambda s, l: leafy(s, l, 9.0)),
        ('B', lambda s, l: leafy(s + 3, l, 7.5)),
        ('C', lambda s, l: leafy(s + 8, l, 10.5, autumn=False)),
    ])
    build_group('snag', [('A', lambda s, l: snag(s, l, 9.0)), ('B', lambda s, l: snag(s + 4, l, 6.5))])
    build_group('shrub', [('A', lambda s, l: shrub(s, l, 1.1)), ('B', lambda s, l: shrub(s + 2, l, 0.8))])
    build_group('rock', [
        ('A', lambda s, l: rock(s, l, 1.3)), ('B', lambda s, l: rock(s + 1, l, 0.8)),
        ('C', lambda s, l: rock(s + 2, l, 2.4)), ('D', lambda s, l: rock(s + 3, l, 4.2)), ('E', lambda s, l: rock(s + 4, l, 0.45)),
    ])


if __name__ == '__main__':
    main()
