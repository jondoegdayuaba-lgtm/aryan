"""Sea life: reef fish species, a blacktip reef shark, a green sea turtle (with
separate flippers), a spotted eagle ray and a moon jellyfish.

Bodies run along +Y (snout at +Y) so they face three.js -Z after export. The
game bends them side to side in a vertex shader, so every part stays one mesh."""
import math

import numpy as np

from geo import (Mesh, cells, empty, ellipsoid, hexc, icosphere, join, lathe, lerp_colors, material,
                 smoothstep, strip, sweep, vnoise)


def interp(s, table, k):
    """Linear interpolation of column k of [(s, ...)] control rows."""
    xs = [r[0] for r in table]
    ys = [r[k] for r in table]
    return np.interp(s, xs, ys)


def body_loft(m, L, table, mat, seg=12, stations=26, power=2.2):
    """Loft a body along Y. table rows: (s, half_height, half_width, center_z),
    s=0 at the snout (+Y) and s=1 at the tail stalk. Returns (s, Y, H, W, Z)."""
    s = np.concatenate([[0, 0.012, 0.03], np.linspace(0.06, 1, stations - 3)])
    H, W, Z = interp(s, table, 1), interp(s, table, 2), interp(s, table, 3)
    Y = L * (0.5 - s)
    a = np.linspace(0, math.tau, seg, endpoint=False)
    # Superellipse-ish rings: fuller sides than a plain ellipse.
    ca, sa = np.cos(a), np.sin(a)
    ex = np.sign(ca) * np.abs(ca) ** (2 / power)
    ez = np.sign(sa) * np.abs(sa) ** (2 / power)
    P = np.zeros((len(s), seg, 3))
    P[..., 0] = W[:, None] * ex[None, :]
    P[..., 1] = Y[:, None]
    P[..., 2] = Z[:, None] + H[:, None] * ez[None, :]
    V = m.grid(P, mat, closed_u=True)
    m.cap(V[0], mat, center=(0, L * 0.5 + L * 0.004, Z[0]), flip=True)
    m.cap(V[-1], mat)
    return s, Y, H, W, Z


def fin(m, base, outline, mat):
    """A flat fin between a base line and an outline (same number of points)."""
    G = np.stack([np.asarray(base, float), np.asarray(outline, float)], axis=0)
    mid = (G[0] + G[1]) / 2
    G = np.stack([G[0], mid, G[1]], axis=0)
    return m.grid(G, mat)


# ---------------------------------------------------------------- reef fish

FISH = {
    # length, profile rows (s, half-height, half-width, z), dorsal (s0, s1, height), anal, tail span, tail fork
    'tang': dict(L=0.2, rows=[(0, 0.004, 0.003, 0.004), (0.06, 0.02, 0.008, 0.006), (0.25, 0.05, 0.013, 0.0),
                               (0.5, 0.048, 0.012, 0), (0.75, 0.025, 0.008, 0), (0.92, 0.009, 0.004, 0),
                               (1.0, 0.008, 0.003, 0)],
                 dorsal=(0.18, 0.86, 0.03), anal=(0.42, 0.86, 0.026), tail=0.045, fork=0.25),
    'chromis': dict(L=0.11, rows=[(0, 0.004, 0.003, 0), (0.08, 0.013, 0.008, 0), (0.3, 0.02, 0.01, 0),
                                  (0.6, 0.016, 0.008, 0), (0.88, 0.005, 0.003, 0), (1.0, 0.005, 0.0025, 0)],
                    dorsal=(0.25, 0.78, 0.01), anal=(0.55, 0.8, 0.008), tail=0.022, fork=0.6),
    'sergeant': dict(L=0.17, rows=[(0, 0.005, 0.004, 0), (0.08, 0.022, 0.01, 0), (0.3, 0.038, 0.014, 0),
                                   (0.6, 0.032, 0.012, 0), (0.88, 0.009, 0.004, 0), (1.0, 0.008, 0.003, 0)],
                     dorsal=(0.22, 0.8, 0.018), anal=(0.55, 0.82, 0.015), tail=0.032, fork=0.45),
    'clown': dict(L=0.1, rows=[(0, 0.005, 0.004, 0), (0.1, 0.016, 0.01, 0), (0.35, 0.021, 0.012, 0),
                               (0.7, 0.015, 0.008, 0), (0.9, 0.007, 0.004, 0), (1.0, 0.007, 0.003, 0)],
                  dorsal=(0.25, 0.85, 0.012), anal=(0.6, 0.85, 0.009), tail=0.016, fork=0.0),
    'grouper': dict(L=0.95, rows=[(0, 0.03, 0.03, -0.01), (0.08, 0.09, 0.08, 0), (0.3, 0.15, 0.12, 0),
                                  (0.6, 0.12, 0.09, 0), (0.86, 0.05, 0.035, 0), (1.0, 0.045, 0.02, 0)],
                    dorsal=(0.25, 0.85, 0.07), anal=(0.6, 0.86, 0.06), tail=0.13, fork=0.0),
    'barracuda': dict(L=1.25, rows=[(0, 0.012, 0.012, -0.005), (0.08, 0.04, 0.035, 0), (0.3, 0.07, 0.06, 0),
                                    (0.65, 0.06, 0.05, 0), (0.9, 0.025, 0.02, 0), (1.0, 0.02, 0.012, 0)],
                      dorsal=(0.42, 0.52, 0.06), anal=(0.7, 0.78, 0.04), tail=0.12, fork=0.7),
}


def fish_colors(kind, L):
    def f(P, N):
        s = 0.5 - P[:, 1] / L            # 0 snout .. 1 tail
        z = P[:, 2]
        top = smoothstep(-0.2, 0.6, z / (np.abs(z).max() + 1e-6))
        n = vnoise(P, 30 / L, 2) * 0.5 + 0.5
        if kind == 'tang':
            c = lerp_colors(top, [(0, '#f6dd3a'), (1, '#e3c21a')])
        elif kind == 'chromis':
            c = lerp_colors(top, [(0, '#b9e0db'), (0.5, '#5fb8c4'), (1, '#3a8fa8')])
        elif kind == 'sergeant':
            c = lerp_colors(top, [(0, '#e9ecef'), (0.55, '#dfe3d6'), (1, '#e3d97a')])
            bars = (np.sin((s - 0.2) * math.pi * 2 * 2.6) > 0.55) & (s > 0.18) & (s < 0.9)
            c[bars] = hexc('#1d2226')
        elif kind == 'clown':
            c = np.broadcast_to(hexc('#f2701b'), (len(P), 3)).copy()
            for c0, w in ((0.22, 0.05), (0.52, 0.06), (0.9, 0.035)):
                d = np.abs(s - c0)
                c[d < w + 0.018] = hexc('#15100c')
                c[d < w] = hexc('#f7f4ee')
        elif kind == 'grouper':
            c = lerp_colors(n, [(0.2, '#4c3a2a'), (0.6, '#7a5f43'), (0.9, '#a5845d')])
            spots = cells(P, 14 / L)
            c[spots[:, 0] < 0.25] = hexc('#c5ab84')
            c *= (0.6 + 0.4 * top)[:, None]
        else:  # barracuda
            c = lerp_colors(top, [(0, '#e6eaec'), (0.6, '#aab5bb'), (1, '#4c5a62')])
            bars = (np.sin(s * math.pi * 2 * 9) > 0.7) & (z > 0) & (s > 0.2) & (s < 0.85)
            c[bars] *= 0.6
            c[s > 0.97] = hexc('#2a2f33')
        eye = np.hypot((s - 0.1) * L, z - L * 0.03 * (1 if kind != 'barracuda' else 0.4)) < L * 0.035
        c[eye & (np.abs(P[:, 0]) > 0)] = hexc('#0b0b0c')
        return c
    return f


def fish(kind):
    spec = FISH[kind]
    L = spec['L']
    body = Mesh()
    s, Y, H, W, Z = body_loft(body, L, spec['rows'], material('fish', '#ffffff', rough=0.35))
    finm = material('fin', '#ffffff', rough=0.5)
    fins = Mesh()
    # Dorsal and anal fins follow the body outline.
    for (s0, s1, fh), sign in ((spec['dorsal'], 1), (spec['anal'], -1)):
        ss = np.linspace(s0, s1, 8)
        base = np.stack([np.zeros(8), L * (0.5 - ss), interp(ss, spec['rows'], 3) + sign * interp(ss, spec['rows'], 1) * 0.92], 1)
        prof = np.sin(np.linspace(0.25, math.pi * 0.92, 8)) ** 0.6
        out = base + np.stack([np.zeros(8), -np.full(8, L * 0.04), sign * fh * prof], 1)
        fin(fins, base, out, finm)
    # Tail: fan or fork from the tail stalk.
    ty = L * (0.5 - 1.0)
    hs = interp(1.0, spec['rows'], 1)
    span = spec['tail']
    k = 9
    v = np.linspace(-1, 1, k)
    base = np.stack([np.zeros(k), np.full(k, ty + L * 0.01), v * hs * 0.9], 1)
    depth = span * (1.0 - spec['fork'] * (1 - np.abs(v)) ** 1.5) * 0.9
    out = np.stack([np.zeros(k), ty - depth, v * span], 1)
    fin(fins, base, out, finm)
    # Pectoral fins.
    for sx in (-1, 1):
        root = np.array([sx * interp(0.28, spec['rows'], 2) * 0.9, L * (0.5 - 0.28), -interp(0.28, spec['rows'], 1) * 0.15])
        b = np.stack([root, root + np.array([0, -L * 0.06, -L * 0.01])])
        o = b + np.array([sx * L * 0.03, -L * 0.07, -L * 0.04])
        fin(fins, b, o, finm)
    ob = body.build(f'fish_{kind}', smooth=70, colors=fish_colors(kind, L))
    fob = fins.build(f'fish_{kind}_fins', smooth=None, colors=fish_colors(kind, L))
    tint = {'tang': '#f5dc3c', 'chromis': '#6cb6c9', 'sergeant': '#e9e4b0', 'clown': '#f2701b',
            'grouper': '#6d533b', 'barracuda': '#9aa5ab'}[kind]
    from geo import paint
    edge = hexc('#121212') if kind in ('clown', 'barracuda') else hexc(tint) * 0.8
    paint(fob, lambda P, N: np.broadcast_to(hexc(tint), (len(P), 3)) * 0.85 + 0 * edge)
    return join([ob, fob], f'fish_{kind}')


# ---------------------------------------------------------------- shark

def shark():
    L = 2.3
    rows = [(0, 0.03, 0.03, -0.02), (0.04, 0.08, 0.09, -0.01), (0.12, 0.14, 0.15, 0), (0.3, 0.2, 0.18, 0),
            (0.45, 0.19, 0.16, 0.01), (0.62, 0.13, 0.1, 0.02), (0.8, 0.06, 0.045, 0.02), (1.0, 0.035, 0.03, 0.02)]
    m = Mesh()
    body_loft(m, L, rows, material('shark', '#ffffff', rough=0.45), seg=16, stations=34, power=2.0)

    def body_col(P, N):
        z = P[:, 2] - 0.0
        s = 0.5 - P[:, 1] / L
        top = smoothstep(-0.06, 0.04, z + 0.02 * np.sin(s * 9))
        c = lerp_colors(top, [(0, '#e8e6df'), (1, '#7f8582')])
        c *= (0.92 + 0.08 * vnoise(P, 6, 2))[:, None]
        gills = (s > 0.2) & (s < 0.29) & (np.abs(np.sin((s - 0.2) * math.pi * 2 / 0.018)) > 0.92) & (np.abs(z) < 0.08) & (np.abs(P[:, 0]) > 0.1)
        c[gills] *= 0.35
        mouth = (s > 0.06) & (s < 0.14) & (z < -0.05) & (np.abs(P[:, 0]) < 0.11 * (1 - np.abs(s - 0.1) * 10))
        c[mouth] *= 0.45
        return c
    body = m.build('shark_body', smooth=70, colors=body_col)

    f = Mesh()
    mat = material('shark', '#ffffff', rough=0.45)

    def tri_fin(root_a, root_b, tip, mid_bulge=(0, 0, 0)):
        base = np.linspace(root_a, root_b, 6)
        tip = np.asarray(tip, float)
        out = np.array([tip + (b - root_b) * 0.15 * (1 - i / 5) for i, b in enumerate(base)])
        out = np.array([base[i] + (tip - base[i]) * (0.35 + 0.65 * (i / 5) ** 0.5) + np.asarray(mid_bulge) * math.sin(math.pi * i / 5) for i in range(6)])
        fin(f, base, out, mat)

    y = lambda s: L * (0.5 - s)
    tri_fin((0, y(0.33), 0.18), (0, y(0.5), 0.15), (0, y(0.56), 0.5), (0, 0.03, 0.02))           # first dorsal
    tri_fin((0, y(0.74), 0.07), (0, y(0.8), 0.06), (0, y(0.84), 0.16))                             # second dorsal
    tri_fin((0, y(0.73), -0.06), (0, y(0.79), -0.05), (0, y(0.83), -0.14))                         # anal
    for sx in (-1, 1):
        tri_fin((sx * 0.15, y(0.24), -0.1), (sx * 0.13, y(0.36), -0.1), (sx * 0.62, y(0.46), -0.3))   # pectoral
        tri_fin((sx * 0.08, y(0.6), -0.1), (sx * 0.07, y(0.67), -0.08), (sx * 0.2, y(0.72), -0.16))   # pelvic
    # Heterocercal tail: long upper lobe, short lower lobe.
    k = 9
    v = np.linspace(-1, 1, k)
    base = np.stack([np.zeros(k), np.full(k, y(0.99)), 0.02 + v * 0.03], 1)
    out = np.stack([np.zeros(k), y(1.0) - np.where(v > 0, 0.42, 0.22) * (0.25 + 0.75 * np.abs(v)) - 0.03,
                    0.02 + np.where(v > 0, 0.48, 0.3) * v], 1)
    fin(f, base, out, mat)

    def fin_col(P, N):
        c = lerp_colors(smoothstep(-0.1, 0.05, P[:, 2]), [(0, '#d6d4cc'), (1, '#7a807d')])
        r = np.hypot(np.abs(P[:, 0]) - 0.12, P[:, 2]) * (np.abs(P[:, 0]) > 0.2) + np.abs(P[:, 2]) * (np.abs(P[:, 0]) <= 0.2)
        tip = smoothstep(0.32, 0.42, r) + smoothstep(0.38, 0.45, np.abs(P[:, 2])) + (P[:, 1] < y(1.0) - 0.25) * 1.0
        return c * (1 - 0.85 * np.clip(tip, 0, 1))[:, None]
    fins = f.build('shark_fins', smooth=None, colors=fin_col)
    eyes = Mesh()
    for sx in (-1, 1):
        icosphere(eyes, 0.014, material('eye', '#050505', rough=0.15), subdiv=1, center=(sx * 0.085, y(0.085), 0.03))
    return join([body, fins, eyes.build('shark_eyes', smooth=80, colors=lambda P, N: np.full((len(P), 3), 0.02))], 'shark')


# ---------------------------------------------------------------- turtle

def turtle():
    """Green sea turtle. Flippers are child objects with their origin at the
    shoulder or hip so the game can rotate them."""
    shell = Mesh()
    mat = material('turtle', '#ffffff', rough=0.55)

    def dome(P):
        P = P.copy()
        up = P[:, 2] > 0
        P[up, 2] *= 1.0
        P[~up, 2] *= 0.45
        P[:, 2] += 0.02 * np.cos(P[:, 1] * 4)
        return P
    ellipsoid(shell, (0.4, 0.52, 0.17), mat, seg=72, rings=36, deform=dome)

    def shell_col(P, N):
        """Real scute layout: 5 vertebral plates down the middle, 4 costal plates
        each side and a ring of marginal plates, each with radiating streaks."""
        xn, yn = P[:, 0] / 0.4, P[:, 1] / 0.52
        r = np.hypot(xn, yn)
        ang = np.arctan2(yn, xn)
        top = P[:, 2] > -0.005
        line = np.zeros(len(P))
        cx = np.zeros(len(P))
        cy = np.zeros(len(P))
        marg = r > 0.86
        k = np.floor((ang + math.pi) / math.tau * 26)
        frac = (ang + math.pi) / math.tau * 26 - k
        line[marg] = np.minimum(frac, 1 - frac)[marg] * 0.25
        line[marg] = np.minimum(line[marg], np.abs(r[marg] - 0.86) * 3)
        a_mid = (k + 0.5) / 26 * math.tau - math.pi
        cx[marg], cy[marg] = 0.93 * np.cos(a_mid[marg]), 0.93 * np.sin(a_mid[marg])
        vert = ~marg & (np.abs(xn) < 0.26)
        yv = (yn + 0.86) / 1.72 * 5
        fv = yv - np.floor(yv)
        line[vert] = np.minimum(np.minimum(fv, 1 - fv)[vert] * 0.34, np.abs(np.abs(xn[vert]) - 0.26))
        cx[vert], cy[vert] = 0, (np.floor(yv[vert]) + 0.5) / 5 * 1.72 - 0.86
        cost = ~marg & ~vert
        yc = (yn + 0.8) / 1.6 * 4
        fc = yc - np.floor(yc)
        line[cost] = np.minimum(np.minimum(fc, 1 - fc)[cost] * 0.4, np.abs(np.abs(xn[cost]) - 0.26))
        line[cost] = np.minimum(line[cost], np.abs(r[cost] - 0.86))
        cx[cost], cy[cost] = np.sign(xn[cost]) * 0.56, (np.floor(yc[cost]) + 0.5) / 4 * 1.6 - 0.8
        streak_a = np.arctan2(yn - cy, xn - cx)
        streak = 0.5 + 0.5 * np.sin(streak_a * 11 + vnoise(P, 6, 2) * 4)
        dist = np.hypot(yn - cy, xn - cx)
        fill = lerp_colors(streak * 0.6 + smoothstep(0.0, 0.35, dist) * 0.4,
                           [(0.0, '#3a2814'), (0.45, '#6e4b22'), (0.75, '#94703a'), (1.0, '#a8874e')])
        edge = smoothstep(0.0, 0.03, line)
        c = fill * edge[:, None] + hexc('#d3c08e') * (1 - edge)[:, None]
        c[~top] = hexc('#e2d6aa')
        return c
    body = shell.build('turtle_shell', smooth=70, colors=shell_col)

    head = Mesh()
    ellipsoid(head, (0.075, 0.12, 0.065), mat, center=(0, 0.6, 0.0), seg=16, rings=10)
    sweep(head, [(0, 0.42, -0.01), (0, 0.52, 0.0)], [0.07, 0.065], mat, sides=10)

    def skin(P, N):
        cl = cells(P, 26)
        edge = smoothstep(0.0, 0.1, cl[:, 1] - cl[:, 0])
        c = hexc('#5a4630') * edge[:, None] + hexc('#d8c8a0') * (1 - edge)[:, None]
        under = N[:, 2] < -0.3
        c[under] = hexc('#e5dbbd')
        eye = np.hypot(np.abs(P[:, 0]) - 0.06, P[:, 1] - 0.66) < 0.016
        c[eye & (P[:, 2] > 0)] = hexc('#090807')
        return c
    headob = head.build('turtle_head', smooth=70, colors=skin)

    def flipper_skin(P, N):
        cl = cells(P, 22)
        edge = smoothstep(0.0, 0.12, cl[:, 1] - cl[:, 0])
        return hexc('#4a3a26') * edge[:, None] + hexc('#cdbb8e') * (1 - edge)[:, None]
    torso = join([body, headob], 'turtle_body')

    parts = [torso]
    for name, root, length, width, sx, back in (('turtle_flipper_fl', (0.3, 0.3, -0.03), 0.55, 0.15, 1, False),
                                                 ('turtle_flipper_fr', (-0.3, 0.3, -0.03), 0.55, 0.15, -1, False),
                                                 ('turtle_flipper_rl', (0.22, -0.4, -0.04), 0.22, 0.11, 1, True),
                                                 ('turtle_flipper_rr', (-0.22, -0.4, -0.04), 0.22, 0.11, -1, True)):
        fm = Mesh()
        t = np.linspace(0, 1, 8)
        sweepdir = np.array([sx * 1.0, -0.55 if not back else -1.2, 0.0])
        sweepdir /= np.linalg.norm(sweepdir)
        path = np.outer(t, sweepdir) * length + np.stack([np.zeros(8), -0.08 * t ** 2, np.zeros(8)], 1)
        w = width * np.sin(np.linspace(0.5, math.pi * 0.95, 8)) ** 0.7 + 0.03
        side = np.cross(sweepdir, [0, 0, 1])
        V = strip(fm, path, w, mat, up=side * sx, fold=-0.04)
        # Give the paddle thickness by sweeping a flattened tube along the leading edge.
        sweep(fm, path + side * sx * (w[:, None] * -0.35), np.linspace(0.035, 0.012, 8), mat, sides=8, squash=0.45)
        ob = fm.build(name, smooth=60, colors=flipper_skin)
        ob.location = root
        parts.append(ob)
        del V
    root = empty('turtle', parts)
    return root


# ---------------------------------------------------------------- eagle ray

def eagle_ray():
    m = Mesh()
    mat = material('ray', '#ffffff', rough=0.45)
    nu, nv = 22, 12
    u = np.linspace(0, 1, nu)               # 0 centre line .. 1 wingtip
    span = 1.05
    front = 0.42 * (1 - u) ** 0.9 + 0.02 - 0.06 * np.sin(u * math.pi) * u
    back = -0.42 * (1 - u) ** 1.6 - 0.02
    thick = 0.11 * (1 - u) ** 1.8 + 0.004
    sides = []
    for sx in (1, -1):
        top = np.zeros((nv, nu, 3))
        bot = np.zeros((nv, nu, 3))
        for j in range(nu):
            v = np.linspace(0, 1, nv)
            yy = back[j] + (front[j] - back[j]) * v
            prof = np.sin(np.clip(v, 0, 1) * math.pi) ** 0.7
            x = sx * u[j] * span
            top[:, j] = np.stack([np.full(nv, x), yy, thick[j] * prof + 0.04 * u[j] ** 2], 1)
            bot[:, j] = np.stack([np.full(nv, x), yy, -thick[j] * prof * 0.6 + 0.04 * u[j] ** 2], 1)
        sides.append((top, bot, sx))
    for top, bot, sx in sides:
        m.grid(top, mat, flip=sx < 0)
        m.grid(bot, mat, flip=sx > 0)
    ellipsoid(m, (0.075, 0.16, 0.06), mat, center=(0, 0.48, 0.0), seg=14, rings=8)
    tail = [(0, -0.4 - t * 1.9, 0.01 - 0.05 * t * t) for t in np.linspace(0, 1, 14)]
    sweep(m, tail, np.linspace(0.025, 0.003, 14), mat, sides=5)

    def col(P, N):
        ux = np.clip(np.abs(P[:, 0]) / 1.05, 0, 1)
        upper = P[:, 2] > 0.04 * ux ** 2 - 0.004
        c = np.broadcast_to(hexc('#f0eee8'), (len(P), 3)).copy()
        cl = cells(P * np.array([1, 1, 2]), 9)
        spot = cl[:, 0] < 0.22
        dark = lerp_colors(vnoise(P, 3, 2) * 0.5 + 0.5, [(0, '#1b2128'), (1, '#2b343c')])
        c[upper] = dark[upper]
        c[upper & spot] = hexc('#e9ecea')
        return c
    return m.build('eagle_ray', smooth=60, colors=col)


# ---------------------------------------------------------------- jellyfish

def jellyfish():
    m = Mesh()
    bell = material('jelly', '#e9b8ff', rough=0.2, emit='#c27bff', emit_strength=0.6)
    prof = [(0.001, 0.22), (0.12, 0.21), (0.22, 0.17), (0.29, 0.1), (0.32, 0.03), (0.33, -0.02), (0.3, 0.0),
            (0.24, 0.06), (0.12, 0.1), (0.001, 0.11)]
    lathe(m, prof, bell, seg=28, radial=lambda a, i: 1 + (0.03 * np.sin(a * 8) if 3 <= i <= 6 else 0))
    rng = np.random.default_rng(3)
    arm = material('jellyarm', '#f2c9ff', rough=0.3, emit='#d79bff', emit_strength=0.8)
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        pts = [(math.cos(a) * (0.04 + 0.05 * t) + 0.04 * math.sin(t * 9 + k), math.sin(a) * (0.04 + 0.05 * t), 0.08 - t * 0.75)
               for t in np.linspace(0, 1, 12)]
        strip(m, pts, 0.06 * (1 - np.linspace(0, 0.8, 12)), arm, up=np.array([-math.sin(a), math.cos(a), 0]), fold=0.3)
    for k in range(28):
        a = k / 28 * math.tau
        L = rng.uniform(0.6, 1.2)
        pts = [(math.cos(a) * 0.31 * (1 - 0.1 * t), math.sin(a) * 0.31 * (1 - 0.1 * t) + 0.02 * math.sin(t * 7 + k), -0.01 - t * L)
               for t in np.linspace(0, 1, 8)]
        sweep(m, pts, np.linspace(0.004, 0.0015, 8), arm, sides=3, cap_start=False)

    def col(P, N):
        r = np.hypot(P[:, 0], P[:, 1])
        c = lerp_colors(smoothstep(0, 0.33, r), [(0, '#f6e6ff'), (1, '#d39bf5')])
        gonad = (np.abs(r - 0.08) < 0.03) & (P[:, 2] > 0.1)
        c[gonad] = hexc('#ff9bd6')
        return c
    return m.build('jellyfish', smooth=70, colors=col)


def build():
    out = {f'fish_{k}': fish(k) for k in FISH}
    out['shark'] = shark()
    out['turtle'] = turtle()
    out['eagle_ray'] = eagle_ray()
    out['jellyfish'] = jellyfish()
    return out
