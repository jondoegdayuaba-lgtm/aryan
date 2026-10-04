"""The galleon wreck and its debris: hull with a breach you can swim into,
gunports, a captain's cabin with broken stern windows, ribs, decks, snapped
masts, cannons, an admiralty anchor and cargo barrels.

Local space: keel at z=0, bow toward +Y, stern at y=-15."""
import math

import bmesh
import numpy as np
from mathutils import Vector, noise

from geo import Mesh, box, hexc, lathe, lerp_colors, material, smoothstep, sweep, vnoise

LENGTH = 30.0
HALF_BEAM = 4.2


def wood():
    return material('wood', '#7b6a52', rough=0.85)


def iron():
    return material('iron', '#3f3a35', metal=0.6, rough=0.75)


def half_breadth(s):
    s = np.asarray(s, float)
    aft = 0.72 + 0.28 * np.sin(np.clip(s / 0.4, 0, 1) * math.pi / 2)
    fwd = np.cos(np.clip((s - 0.4) / 0.6, 0, 1) * math.pi / 2) ** 0.75
    return HALF_BEAM * np.where(s < 0.4, aft, fwd)


def keel_z(s):
    s = np.asarray(s, float)
    return 3.2 * np.clip((s - 0.78) / 0.22, 0, 1) ** 2 + 0.7 * np.clip((0.06 - s) / 0.06, 0, 1)


def sheer_z(s):
    s = np.asarray(s, float)
    return 6.0 + 2.4 * smoothstep(0.26, 0.1, s) + 1.0 * np.clip((s - 0.82) / 0.18, 0, 1) ** 2


def section(s, q):
    """Point on the starboard hull side at station s (0 stern..1 bow), height q (0 keel..1 sheer)."""
    z0, z1 = keel_z(s), sheer_z(s)
    z = z0 + (z1 - z0) * q
    bilge = (1 - (1 - q) ** 2.4) ** 0.5
    tumble = 1 - 0.13 * smoothstep(0.62, 1.0, q)
    w = np.maximum(0.18, half_breadth(s) * bilge * tumble)
    return w, z


def station_y(s):
    return -LENGTH / 2 + LENGTH * np.asarray(s, float)


def rake(s, q):
    """Forward lean of the bow: higher planks reach further forward."""
    return 3.4 * smoothstep(0.8, 1.0, s) * np.asarray(q, float) ** 1.6


def hull():
    """Both sides of the hull as one open shell, with breach, gunports and stern
    windows cut out, then given plank thickness."""
    m = Mesh()
    ns, nq = 46, 18
    S = np.linspace(0, 1, ns)
    Q = np.linspace(0, 1, nq)
    cols = list(-np.flip(Q)) + list(Q[1:])                       # port (negative) to starboard
    P = np.zeros((ns, len(cols), 3))
    UV = np.zeros((ns, len(cols), 2))
    for i, s in enumerate(S):
        arc = 0.0
        prev = None
        for j, c in enumerate(cols):
            w, z = section(s, abs(c))
            pt = np.array([w * np.sign(c) if c else 0.0, station_y(s) + rake(s, abs(c)), z])
            if prev is not None:
                arc += np.linalg.norm(pt - prev)
            prev = pt
            P[i, j] = pt
            UV[i, j] = (arc / 1.8, station_y(s) / 3.5)
    V = m.grid(P, wood(), uv=UV)

    # Cut openings: decide per face from its centre's (s, q, side).
    kill = []
    for i in range(ns - 1):
        for j in range(len(cols) - 1):
            s = (S[i] + S[i + 1]) / 2
            c = (cols[j] + cols[j + 1]) / 2
            q = abs(c)
            side = 1 if c > 0 else -1
            y = station_y(s)
            n = noise.noise(Vector((s * 9, q * 6, side * 3.0)))
            # The breach: a ragged hole in the starboard side amidships.
            if side > 0 and 0.36 + 0.03 * n < s < 0.57 - 0.03 * n and 0.14 + 0.05 * n < q < 0.68 + 0.08 * n:
                kill.append((i, j))
            # Gunports along both sides.
            port_y = (y + 6.5) % 2.4
            if 0.27 < s < 0.8 and 0.66 < q < 0.76 and 0.7 < port_y < 1.5:
                kill.append((i, j))
            # Port-side damage near the bow.
            if side < 0 and 0.74 < s < 0.82 + 0.02 * n and 0.3 < q < 0.5 + 0.06 * n:
                kill.append((i, j))
    faces = []
    for i, j in set(kill):
        f = m.bm.faces.get([V[i][j], V[i][j + 1], V[i + 1][j + 1], V[i + 1][j]])
        if f:
            faces.append(f)
    bmesh.ops.delete(m.bm, geom=faces, context='FACES_ONLY')
    bmesh.ops.delete(m.bm, geom=[v for v in m.bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.solidify(m.bm, geom=list(m.bm.faces), thickness=0.16)

    # Transom with the cabin's stern windows (some smashed open).
    tr = Mesh()
    nx, nz = 12, 12
    TP = np.zeros((nz, nx, 3))
    TUV = np.zeros((nz, nx, 2))
    for r, q in enumerate(np.linspace(0.02, 1, nz)):
        w, z = section(0.0, q)
        for k, u in enumerate(np.linspace(-1, 1, nx)):
            TP[r, k] = (u * w * 0.98, station_y(0.0) + 0.05, z)
            TUV[r, k] = (u * w / 1.8, z / 1.8)
    TV = tr.grid(TP, wood(), uv=TUV, flip=True)
    win = []
    for r in range(nz - 1):
        for k in range(nx - 1):
            u = (k + 0.5) / (nx - 1) * 2 - 1
            q = (r + 0.5) / (nz - 1)
            if 0.62 < q < 0.8 and abs(u) < 0.75 and (k % 3) != 0:
                win.append(tr.bm.faces.get([TV[r][k], TV[r][k + 1], TV[r + 1][k + 1], TV[r + 1][k]]))
    bmesh.ops.delete(tr.bm, geom=[f for f in win if f], context='FACES_ONLY')
    bmesh.ops.solidify(tr.bm, geom=list(tr.bm.faces), thickness=0.16)
    m.add(tr)
    return m


def deck(m, s0, s1, z_of_s, inset=0.25, holes=(), across=8):
    ns = max(4, int((s1 - s0) * 40))
    S = np.linspace(s0, s1, ns)
    P = np.zeros((ns, across, 3))
    UV = np.zeros((ns, across, 2))
    for i, s in enumerate(S):
        z = z_of_s(s)
        zk, zs = keel_z(s), sheer_z(s)
        q = np.clip((z - zk) / max(zs - zk, 1e-3), 0, 1)
        w, _ = section(s, q)
        w = max(0.2, w - inset)
        for k, u in enumerate(np.linspace(-1, 1, across)):
            P[i, k] = (u * w, station_y(s), z)
            UV[i, k] = (u * w / 1.8, station_y(s) / 3.5)
    V = m.grid(P, wood(), uv=UV)
    kill = []
    for i in range(ns - 1):
        for k in range(across - 1):
            s = (S[i] + S[i + 1]) / 2
            u = ((k + 0.5) / (across - 1)) * 2 - 1
            for hs0, hs1, u0, u1 in holes:
                n = noise.noise(Vector((s * 13, u * 3, 1.7))) * 0.03
                if hs0 + n < s < hs1 - n and u0 < u < u1:
                    kill.append(m.bm.faces.get([V[i][k], V[i][k + 1], V[i + 1][k + 1], V[i + 1][k]]))
    bmesh.ops.delete(m.bm, geom=[f for f in kill if f], context='FACES_ONLY')
    return V


def broken_post(m, base, top_z, radius, mat, seed):
    """A mast or spar snapped off with a jagged top."""
    h = top_z - base[2]
    pts = [(base[0], base[1], base[2] + h * t) for t in np.linspace(0, 1, 8)]
    V = sweep(m, pts, np.linspace(radius, radius * 0.9, 8), mat, sides=12, cap_end=False)
    for k, v in enumerate(V[-1]):
        v.co.z += 0.5 * abs(noise.noise(Vector((k * 0.7, seed, 0.3)))) + 0.25 * ((k * 7) % 3)
    m.cap(V[-1], mat)


def galleon():
    m = hull()
    w = wood()
    # Keel, stem and sternpost.
    ks = np.linspace(0.0, 1.0, 30)
    keel_path = [(0, station_y(s) + rake(s, 0.0), keel_z(s) - 0.2) for s in ks]
    keel_path += [(0, station_y(1.0) + rake(1.0, q) + 0.15, keel_z(1.0) + (sheer_z(1.0) - keel_z(1.0)) * q) for q in (0.35, 0.7, 1.0)]
    keel_path.append((0, station_y(1.0) + rake(1.0, 1.0) + 0.5, sheer_z(1.0) + 0.8))
    sweep(m, keel_path, 0.24, w, sides=4)
    sweep(m, [(0, station_y(0.0) - 0.05, keel_z(0.0)), (0, station_y(0.0) - 0.3, sheer_z(0.0) + 0.3)], 0.2, w, sides=4)
    # Frames (ribs) inside the hull, most visible through the breach.
    for s in np.arange(0.06, 0.94, 0.045):
        pts = []
        for q in np.linspace(0.02, 0.98, 14):
            ww, z = section(s, q)
            pts.append((ww - 0.25, station_y(s), z))
        pts = [(-p[0], p[1], p[2]) for p in reversed(pts)] + pts
        sweep(m, pts, 0.11, w, sides=4, squash=1.4)
    # Hold floor, main deck (with collapsed sections) and the castle deck.
    deck(m, 0.08, 0.86, lambda s: keel_z(s) + 1.6 + 0.6 * smoothstep(0.7, 0.86, s), inset=0.35)
    deck(m, 0.2, 0.9, lambda s: 5.4 + 0.8 * np.clip((s - 0.82) / 0.18, 0, 1) ** 2, inset=0.2,
         holes=((0.38, 0.6, -0.2, 1.1), (0.66, 0.74, -0.9, -0.1)))
    deck(m, 0.0, 0.21, lambda s: 7.6, inset=0.2, holes=((0.04, 0.1, 0.1, 0.8),))
    deck(m, 0.02, 0.205, lambda s: 5.4, inset=0.25)
    # The captain's table, where the compass still lies.
    box(m, (1.3, 0.8, 0.06), w, center=(0.6, station_y(0.08), 5.9), uv_scale=1 / 1.8)
    for dx, dy in ((-0.55, -0.32), (0.55, -0.32), (-0.55, 0.32), (0.55, 0.32)):
        box(m, (0.07, 0.07, 0.46), w, center=(0.6 + dx, station_y(0.08) + dy, 5.64), uv_scale=1 / 1.8)
    # Cabin front wall (bulkhead) with a doorway.
    s_wall = 0.205
    ww, _ = section(s_wall, 0.85)
    for x0, x1 in ((-ww + 0.2, -0.55), (0.55, ww - 0.2)):
        box(m, (x1 - x0, 0.15, 2.2), w, center=((x0 + x1) / 2, station_y(s_wall), 6.5), uv_scale=1 / 1.8)
    box(m, (1.1, 0.15, 0.5), w, center=(0, station_y(s_wall), 7.35), uv_scale=1 / 1.8)
    # Gunwale rails along the sheer.
    for side in (-1, 1):
        rail = []
        for s in np.linspace(0.0, 0.97, 40):
            ww, z = section(s, 1.0)
            rail.append((side * ww, station_y(s) + rake(s, 1.0), z + 0.08))
        sweep(m, rail, 0.1, w, sides=4)
    # Snapped masts and the bowsprit.
    broken_post(m, (0, station_y(0.5), 1.0), 11.5, 0.34, w, 1)
    broken_post(m, (0, station_y(0.78), 2.0), 8.6, 0.3, w, 2)
    broken_post(m, (0, station_y(0.2), 1.0), 9.8, 0.26, w, 3)
    bs = [(0, station_y(0.97) + rake(0.97, 1.0) + 0.4 + t * 3.6, sheer_z(0.97) + 0.4 + t * 1.8) for t in np.linspace(0, 1, 6)]
    sweep(m, bs, np.linspace(0.22, 0.18, 6), w, sides=8)
    # Rigging stubs: a few iron chainplates along the sides.
    for side in (-1, 1):
        for s in (0.46, 0.5, 0.54, 0.75, 0.79):
            ww, z = section(s, 0.92)
            box(m, (0.08, 0.12, 1.4), iron(), center=(side * (ww + 0.12), station_y(s), z - 0.5))

    def colors(P, N):
        n = vnoise(P, 0.25, 3) * 0.5 + 0.5
        fine = vnoise(P, 1.3, 2, (4, 1, 2)) * 0.5 + 0.5
        c = lerp_colors(n, [(0.2, '#8f8a7a'), (0.5, '#b9b19c'), (0.8, '#d6cdb5')])
        growth = smoothstep(0.55, 0.7, fine) * smoothstep(-0.2, 0.6, N[:, 2])
        c = c * (1 - growth[:, None]) + lerp_colors(fine, [(0.5, '#8a8f5e'), (1.0, '#b49a8f')]) * growth[:, None]
        c *= (0.55 + 0.45 * smoothstep(0.0, 3.0, P[:, 2]))[:, None]
        return c
    return m.build('wreck', smooth=35, colors=colors)


def fallen_mast():
    m = Mesh()
    w = wood()
    path = [(0, y, 0.35 + 0.05 * math.sin(y)) for y in np.linspace(0, 15, 12)]
    V = sweep(m, path, np.linspace(0.36, 0.24, 12), w, sides=12, cap_start=False)
    for k, v in enumerate(V[0]):
        v.co.y -= 0.4 * abs(noise.noise(Vector((k * 0.9, 2.0, 0.5))))
    m.cap(V[0], w, flip=True)
    # Yard arm still lashed across it, and a few rope coils.
    sweep(m, [(-4.5, 9.0, 0.6), (4.5, 9.4, 0.45)], 0.16, w, sides=8)
    rope = material('rope', '#8a7d5e', rough=0.95)
    sweep(m, [(0.3 * math.cos(a), 11 + 0.3 * math.sin(a), 0.7 + a * 0.02) for a in np.linspace(0, 12, 40)], 0.03, rope, sides=5)
    return m.build('mast_fallen', smooth=50, colors=lambda P, N: lerp_colors(vnoise(P, 0.5, 2) * 0.5 + 0.5, [(0, '#9c947f'), (1, '#cfc6ad')]))


def cannon():
    m = Mesh()
    prof = [(0.001, -0.08), (0.06, -0.08), (0.08, -0.03), (0.2, 0.0), (0.21, 0.12), (0.19, 0.14), (0.19, 0.7),
            (0.175, 0.72), (0.17, 1.4), (0.16, 1.42), (0.15, 2.0), (0.17, 2.05), (0.18, 2.18), (0.16, 2.24),
            (0.07, 2.24), (0.07, 1.6), (0.001, 1.6)]
    sub = Mesh()
    lathe(sub, prof, iron(), seg=20)
    sweep(sub, [(-0.27, 0, 0.95), (0.27, 0, 0.95)], 0.05, iron(), sides=8)      # trunnions
    from mathutils import Matrix
    # Lathe runs along Z; lay the barrel along +Y with the trunnions over the carriage cheeks.
    m.add(sub, Matrix.Translation((0, -0.05, 0.6)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))

    def colors(P, N):
        n = vnoise(P, 3, 3) * 0.5 + 0.5
        c = lerp_colors(n, [(0.2, '#4a4038'), (0.5, '#6b5544'), (0.75, '#8a6a4c'), (0.9, '#9c8f73')])
        return c
    # Wooden carriage.
    car = Mesh()
    w = wood()
    box(car, (0.12, 1.3, 0.38), w, center=(-0.26, 0.6, 0.32), uv_scale=1 / 1.8)
    box(car, (0.12, 1.3, 0.38), w, center=(0.26, 0.6, 0.32), uv_scale=1 / 1.8)
    box(car, (0.52, 0.2, 0.15), w, center=(0, 0.2, 0.2), uv_scale=1 / 1.8)
    for x, y in ((-0.34, 0.15), (0.34, 0.15), (-0.34, 1.05), (0.34, 1.05)):
        wheel = Mesh()
        lathe(wheel, [(0.001, -0.05), (0.17, -0.05), (0.17, 0.05), (0.001, 0.05)], w, seg=14)
        wheel.transform(__import__('mathutils').Matrix.Rotation(math.pi / 2, 4, 'Y'))
        car.add(wheel, __import__('mathutils').Matrix.Translation((x, y, 0.17)))
    barrel = m.build('cannon_barrel', smooth=40, colors=colors)
    carriage = car.build('cannon_carriage', smooth=40,
                         colors=lambda P, N: lerp_colors(vnoise(P, 2, 2) * 0.5 + 0.5, [(0, '#8d846f'), (1, '#bdb39a')]))
    from geo import join
    return join([barrel, carriage], 'cannon')


def anchor():
    m = Mesh()
    ir = iron()
    sweep(m, [(0, 0, 0.3), (0, 0, 3.4)], np.linspace(0.11, 0.08, 2), ir, sides=10)          # shank
    arm = [(math.sin(a) * 1.3, 0, 0.3 + 1.3 - math.cos(a) * 1.3) for a in np.linspace(-1.1, 1.1, 16)]
    sweep(m, arm, 0.085, ir, sides=10)
    for sx in (-1, 1):
        a = 1.1 * sx
        tip = np.array([math.sin(a) * 1.3, 0, 0.3 + 1.3 - math.cos(a) * 1.3])
        fl = [tuple(tip), tuple(tip + np.array([-sx * 0.35, 0, -0.25]))]
        sweep(m, fl, [0.22, 0.04], ir, sides=4, squash=0.25)
    sweep(m, [(0.24 * math.cos(a), 0, 3.6 + 0.24 * math.sin(a)) for a in np.linspace(0, math.tau, 18)], 0.04, ir, sides=8,
          cap_start=False, cap_end=False)
    box(m, (0.22, 3.6, 0.22), wood(), center=(0, 0, 3.1), uv_scale=1 / 1.8)                 # stock
    return m.build('anchor', smooth=40, colors=lambda P, N: lerp_colors(vnoise(P, 2, 3) * 0.5 + 0.5,
                                                                         [(0.2, '#5a4a3c'), (0.6, '#7a5f48'), (0.9, '#a0927a')]))


def cargo_barrel():
    m = Mesh()
    prof = [(0.001, 0.0), (0.24, 0.0), (0.27, 0.12), (0.3, 0.42), (0.27, 0.72), (0.24, 0.84), (0.001, 0.84)]
    lathe(m, prof, wood(), seg=20, uv_scale=(1.6 / 1.8 * 1.0, 1 / 1.8))
    for z in (0.1, 0.3, 0.54, 0.74):
        r = 0.27 + 0.03 * math.sin(z / 0.84 * math.pi)
        sweep(m, [(r * math.cos(a), r * math.sin(a), z) for a in np.linspace(0, math.tau, 24)], 0.018, iron(), sides=4,
              cap_start=False, cap_end=False, squash=2.0)
    return m.build('barrel', smooth=40, colors=lambda P, N: lerp_colors(vnoise(P, 3, 2) * 0.5 + 0.5, [(0, '#9a917d'), (1, '#c9bfa6')]))


def build():
    return {
        'wreck': galleon(),
        'mast_fallen': fallen_mast(),
        'cannon': cannon(),
        'anchor': anchor(),
        'barrel': cargo_barrel(),
    }
