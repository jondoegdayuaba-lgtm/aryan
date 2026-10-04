"""The diver's kit and the boat: an underwater scooter (with a separate
propeller), gloved hands and forearms for the first-person view, and the dive
boat that waits at the surface."""
import math

import numpy as np
from mathutils import Matrix

from geo import (Mesh, box, ellipsoid, empty, hexc, icosphere, lathe, lerp_colors, material, smoothstep, sweep,
                 vnoise)

TO_Y = Matrix.Rotation(-math.pi / 2, 4, 'X')        # lathe axis Z -> +Y


def white(P, N):
    return np.ones((len(P), 3))


def scooter():
    body = Mesh()
    yellow = material('scooter', '#f2b705', rough=0.35)
    black = material('rubber', '#141414', rough=0.6)
    sub = Mesh()
    lathe(sub, [(0.001, -0.02), (0.06, -0.02), (0.1, 0.04), (0.13, 0.14), (0.135, 0.5), (0.13, 0.6)], black, seg=28)
    lathe(sub, [(0.13, 0.6), (0.135, 0.62), (0.135, 0.66)], yellow, seg=28)
    lathe(sub, [(0.135, 0.14), (0.137, 0.16), (0.137, 0.6), (0.135, 0.62)], yellow, seg=28)
    lathe(sub, [(0.135, 0.66), (0.12, 0.74), (0.09, 0.79), (0.075, 0.8)], black, seg=28)
    body.add(sub, TO_Y)
    lamp = Mesh()
    lathe(lamp, [(0.075, 0.8), (0.07, 0.803), (0.001, 0.806)], material('lamp', '#ffffff', emit='#fff4dc', emit_strength=6), seg=24)
    body.add(lamp, TO_Y)
    shroud = Mesh()
    lathe(shroud, [(0.17, -0.16), (0.19, -0.15), (0.195, -0.04), (0.18, 0.0), (0.168, -0.02), (0.168, -0.14), (0.17, -0.16)],
          black, seg=32)
    body.add(shroud, TO_Y)
    for k in range(3):
        a = k / 3 * math.tau + 0.5
        sweep(body, [(math.cos(a) * 0.1, 0.0, math.sin(a) * 0.1), (math.cos(a) * 0.172, -0.05, math.sin(a) * 0.172)], 0.008, black, sides=5)
    # Grips: D-shaped handles each side.
    for sx in (-1, 1):
        pts = [(sx * 0.13, 0.26, 0.02), (sx * 0.26, 0.24, 0.03), (sx * 0.29, 0.14, 0.02), (sx * 0.27, 0.04, 0.0),
               (sx * 0.13, 0.02, 0.0)]
        sweep(body, pts, 0.016, black, sides=8)
        sweep(body, [(sx * 0.29, 0.2, 0.025), (sx * 0.29, 0.06, 0.012)], 0.022, material('grip', '#2b2b2b', rough=0.9), sides=10)
    # Control pod with a little display on top.
    box(body, (0.1, 0.12, 0.04), black, center=(0, 0.2, 0.15))
    box(body, (0.07, 0.07, 0.006), material('screen', '#0a1a10', emit='#38ff9a', emit_strength=1.5), center=(0, 0.2, 0.172))
    stripe = Mesh()
    lathe(stripe, [(0.138, 0.4), (0.138, 0.45)], material('stripe', '#1a1a1a', rough=0.5), seg=28)
    body.add(stripe, TO_Y)
    body_ob = body.build('scooter_body', smooth=40, colors=white)
    prop = Mesh()
    for k in range(3):
        a = k / 3 * math.tau
        blade = Mesh()
        P = np.zeros((2, 6, 3))
        for j, r in enumerate(np.linspace(0.03, 0.155, 6)):
            w = 0.035 * math.sin(math.pi * (0.15 + 0.85 * j / 5))
            P[0, j] = (r, -w * 0.4, -w)
            P[1, j] = (r, w * 0.4, w)
        blade.grid(P, black)
        prop.add(blade, Matrix.Rotation(a, 4, 'Y'))
    lathe(prop, [(0.001, -0.04), (0.03, -0.03), (0.035, 0.02), (0.001, 0.025)], black, seg=12)
    prop.transform(TO_Y @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    prop_ob = prop.build('scooter_prop', smooth=None, colors=white)
    prop_ob.location = (0, -0.1, 0)
    return empty('scooter', [body_ob, prop_ob])


def hands():
    """Neoprene gloves wrapped round the scooter grips, with forearms reaching
    back toward the camera. A dive computer sits on the left wrist."""
    m = Mesh()
    suit = material('wetsuit', '#1b1d20', rough=0.75)
    glove = material('glove', '#141516', rough=0.8)
    for sx in (-1, 1):
        gx, gy, gz = sx * 0.29, 0.13, 0.02
        ellipsoid(m, (0.04, 0.055, 0.03), glove, center=(gx + sx * 0.025, gy, gz + 0.03), seg=12, rings=8)
        for k in range(4):
            y = gy + 0.035 - k * 0.024
            pts = [(gx + sx * (0.02 - 0.045 * math.cos(a)), y, gz + 0.045 * math.sin(a) + 0.005) for a in np.linspace(0.3, math.pi * 1.25, 7)]
            sweep(m, pts, 0.0105, glove, sides=6)
        sweep(m, [(gx + sx * 0.05, gy + 0.03, gz + 0.04), (gx + sx * 0.0, gy + 0.07, gz + 0.06), (gx - sx * 0.02, gy + 0.075, gz + 0.04)],
              0.011, glove, sides=6)
        arm = [(gx + sx * 0.06, gy - 0.02, gz + 0.04), (gx + sx * 0.12, gy - 0.2, gz + 0.02), (gx + sx * 0.2, gy - 0.42, gz - 0.06)]
        sweep(m, arm, [0.035, 0.045, 0.055], suit, sides=12)
        sweep(m, [(gx + sx * 0.08, gy - 0.07, gz + 0.04), (gx + sx * 0.09, gy - 0.1, gz + 0.04)], 0.041, material('cuff', '#2a5bd7', rough=0.6), sides=12)
        if sx < 0:
            box(m, (0.06, 0.055, 0.02), material('computer', '#202428', rough=0.4), center=(gx + sx * 0.1, gy - 0.16, gz + 0.075))
            box(m, (0.045, 0.04, 0.004), material('screen', '#0a1a10', emit='#38ff9a', emit_strength=1.5), center=(gx + sx * 0.1, gy - 0.16, gz + 0.086))
    return m.build('hands', smooth=50, colors=white)


def dive_boat():
    """A 12 m dive boat: deep-V hull with antifouling paint, cabin, rails,
    outboards, a stern ladder hanging into the water and a diver-down flag.
    Waterline is z = 0."""
    m = Mesh()
    paint_mat = material('boat', '#ffffff', rough=0.35)
    ns, nq = 30, 12
    S = np.linspace(0, 1, ns)
    Q = np.linspace(0, 1, nq)
    cols = list(-np.flip(Q)) + list(Q[1:])
    P = np.zeros((ns, len(cols), 3))
    for i, s in enumerate(S):
        B = 2.1 * (1 - smoothstep(0.6, 1.0, s) ** 1.3 * 0.97)
        keel = -0.75 + 1.05 * smoothstep(0.7, 1.0, s) ** 1.6
        deck = 1.0 + 0.35 * smoothstep(0.6, 1.0, s)
        for j, c in enumerate(cols):
            q = abs(c)
            if q < 0.45:
                t = q / 0.45
                x, z = 0.85 * B * t, keel + (-0.22 - keel) * t ** 1.2
            else:
                t = (q - 0.45) / 0.55
                x, z = 0.85 * B + 0.15 * B * t ** 0.6, -0.22 + (deck + 0.22) * t
            y = -6 + 12 * s + 1.2 * smoothstep(0.75, 1.0, s) * q ** 1.5
            P[i, j] = (x * np.sign(c), y, z)
    V = m.grid(P, paint_mat)
    m.cap(V[0], paint_mat)
    # Deck, cabin, roof, rails.
    box(m, (3.8, 9.0, 0.08), material('deck', '#d9d6cc', rough=0.8), center=(0, -1.6, 0.95))
    box(m, (2.6, 3.4, 1.7), paint_mat, center=(0, 0.2, 1.85))
    box(m, (2.8, 3.8, 0.1), paint_mat, center=(0, 0.1, 2.75))
    glass = material('glass', '#1d2a33', rough=0.05, metal=0.2)
    box(m, (2.62, 3.0, 0.5), glass, center=(0, 0.3, 2.2))
    box(m, (2.3, 0.05, 0.6), glass, center=(0, 1.9, 2.2))
    chrome = material('chrome', '#d0d4d8', metal=1.0, rough=0.2)
    for sx in (-1, 1):
        rail = [(sx * 1.85 * (1 - smoothstep(4.0, 6.5, y) * 0.9), y, 1.75 + 0.3 * smoothstep(4.0, 6.5, y)) for y in np.linspace(-5.9, 6.3, 16)]
        sweep(m, rail, 0.025, chrome, sides=6)
        for y in np.linspace(-5.6, 5.4, 9):
            x = sx * 1.85 * (1 - smoothstep(4.0, 6.5, y) * 0.9)
            sweep(m, [(x, y, 1.0), (x, y, 1.76)], 0.02, chrome, sides=5)
    # Outboards on the transom.
    for x in (-0.7, 0.7):
        box(m, (0.55, 0.7, 0.9), material('engine', '#20252b', rough=0.4), center=(x, -6.45, 1.0))
        box(m, (0.16, 0.25, 1.2), material('engine', '#20252b', rough=0.4), center=(x, -6.5, -0.05))
    # Stern ladder into the water.
    for x in (-0.25, 0.25):
        sweep(m, [(x, -6.2, 1.0), (x, -6.6, 0.6), (x, -6.7, -1.6)], 0.022, chrome, sides=6)
    for z in np.linspace(-1.4, 0.4, 7):
        sweep(m, [(-0.25, -6.68, z), (0.25, -6.68, z)], 0.018, chrome, sides=6)
    # Diver-down flag on a pole above the cabin.
    sweep(m, [(0.9, 0.0, 2.8), (0.9, 0.0, 4.6)], 0.025, chrome, sides=6)
    flag = Mesh()
    FP = np.zeros((2, 6, 3))
    for j, y in enumerate(np.linspace(0, -0.9, 6)):
        FP[0, j] = (0.9, y, 4.05 + 0.03 * math.sin(j))
        FP[1, j] = (0.9, y, 4.6 + 0.03 * math.sin(j))
    flag.grid(FP, material('flag', '#ffffff', rough=0.8))

    def flag_col(P, N):
        c = np.broadcast_to(hexc('#d61f1f'), (len(P), 3)).copy()
        u = -P[:, 1] / 0.9
        v = (P[:, 2] - 4.05) / 0.55
        c[np.abs(u - v) < 0.18] = hexc('#ffffff')
        return c
    flag_ob = flag.build('boat_flag', smooth=None, colors=flag_col)

    def hull_col(P, N):
        z = P[:, 2]
        c = np.broadcast_to(hexc('#f4f4f1'), (len(P), 3)).copy()
        c[z < 0.08] = hexc('#1d3f73')
        c[z < -0.02] = hexc('#8b2a22')
        c[(z > 0.75) & (z < 0.9) & (np.abs(P[:, 0]) > 1.5)] = hexc('#1f5fae')
        c *= (0.9 + 0.1 * vnoise(P, 2, 2))[:, None]
        return c
    hull_ob = m.build('boat_hull', smooth=35, colors=hull_col)
    from geo import join
    return join([hull_ob, flag_ob], 'boat')


def build():
    return {'scooter': scooter(), 'hands': hands(), 'boat': dive_boat()}
