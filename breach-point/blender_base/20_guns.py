# Firearms and the default knife, built from side outlines (extruded), surfaces of revolution and tubes.
# Every gun: '<id>_root' at the origin pointing +Y; '<id>_grip' (empty: centre of the pistol grip, where the
# hand closes), '<id>_fore' (empty: just under the support-hand point), '<id>_muzzle' (empty: barrel end).
# Part names matter: the game paints finishes on everything except names matching its SKIN_SKIP list
# (barrel, brake, flash, bolt, knob, bead, lens, glass, screen, optic, scope, obj, ocu, turret, mount, rail ...).


def side(r, name, pts, width, m, x=0.0, bev=0.003, seg=2):
    """Side outline (y, z) extruded across the gun."""
    return profile(name, pts, width, m, r, x=x, bev=bev, seg=seg)


def barrel(r, name, y0, y1, z, rad, m, segs=16):
    return lathe(name, [(0.0, y0), (rad, y0), (rad, y1), (rad * 0.6, y1), (0.0, y1)], m, r, segs=segs, loc=(0, 0, z))


def arc_pts(cx, cz, rx, rz, a0, a1, n=8):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + rz * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def curved_mag(r, name, y0, z0, w, length, bend, m, thick=0.03, steps=10):
    """Banana magazine seen from the side: front and back edges bend forward as they go down."""
    front, back = [], []
    for i in range(steps + 1):
        t = i / steps
        dy = bend * t * t
        z = z0 - length * t
        back.append((y0 + dy, z))
        front.append((y0 + w + dy + 0.006 * t, z))
    return side(r, name, back + list(reversed(front)), thick, m, bev=0.004)


def pistol_grip(r, gid, y, z, m, length=0.11, tilt=0.3, top=0.05, bot=0.044, width=0.032):
    """Grip outline around the grip centre (y, z), raked back by tilt; leaves the '<id>_grip' empty there."""
    c, s = math.cos(tilt), math.sin(tilt)
    pts = []
    for (u, v) in [(-top / 2, length / 2), (top / 2, length / 2), (bot / 2 + 0.004, -length / 2 + 0.01), (bot / 2 - 0.004, -length / 2),
                   (-bot / 2, -length / 2), (-bot / 2 - 0.006, -length / 2 + 0.02), (-top / 2 - 0.004, length / 4)]:
        pts.append((y + u * c - v * s, z + u * s + v * c))
    side(r, gid + '_pgrip', pts, width, m, bev=0.006, seg=3)
    for i in range(3):  # finger grooves on the front strap
        v = length * (0.22 - i * 0.2)
        rbox(f'{gid}_pgripf{i}', (width * 0.92, 0.008, 0.012), (0, y + (top / 2 + 0.002) * c - v * s, z + (top / 2) * s + v * c), m, r, r=0.003, seg=1, rot=(tilt, 0, 0))
    empty(gid + '_grip', (0, y, z), r)


def trigger(r, gid, y, z, m):
    tube(gid + '_tguard', [(0, y - 0.03, z), (0, y - 0.03, z - 0.035), (0, y + 0.01, z - 0.042), (0, y + 0.04, z - 0.03), (0, y + 0.045, z)], 0.0045, m, r, sides=6)
    tube(gid + '_trigger', [(0, y + 0.002, z), (0, y + 0.006, z - 0.014), (0, y + 0.0, z - 0.024)], 0.003, m, r, sides=6)


def picatinny(r, name, y0, y1, z, m, w=0.022):
    rbox(name, (w, y1 - y0, 0.008), (0, (y0 + y1) / 2, z), m, r, r=0.002, seg=1)
    n = int((y1 - y0) / 0.01)
    for i in range(n):
        rbox(f'{name}t{i}', (w + 0.002, 0.005, 0.005), (0, y0 + 0.005 + i * 0.01, z + 0.0055), m, r, r=0.0012, seg=1)


def red_dot(r, gid, y, z):
    lathe(gid + '_optic', [(0.0, -0.035), (0.017, -0.035), (0.019, -0.03), (0.019, 0.03), (0.017, 0.035), (0.0, 0.035)], G['black'], r, segs=18, loc=(0, y, z + 0.032))
    lathe(gid + '_lens', [(0.0, 0.0), (0.0145, 0.0), (0.0, 0.001)], G['glass'], r, segs=18, loc=(0, y + 0.036, z + 0.032))
    rbox(gid + '_mountbase', (0.026, 0.05, 0.014), (0, y, z + 0.006), G['black'], r, r=0.003, seg=1)
    rbox(gid + '_turretE', (0.012, 0.016, 0.012), (0.02, y, z + 0.032), G['black'], r, r=0.003, seg=1)


def ark7(r, n):
    gid = 'ark7'
    M, W, B = G['metal'], G['wood'], G['black']
    side(r, n('recv'), [(-0.13, -0.02), (0.17, -0.02), (0.17, 0.035), (-0.12, 0.035), (-0.135, 0.02)], 0.048, M, bev=0.003)
    side(r, n('cover'), [(-0.125, 0.034)] + arc_pts(-0.11, 0.047, 0.016, 0.016, 180, 90, 4) + [(0.15, 0.064), (0.17, 0.05), (0.17, 0.034)], 0.044, M, bev=0.004)
    rbox(n('rsight'), (0.03, 0.05, 0.022), (0, 0.17, 0.06), M, r, r=0.004, seg=2)
    side(r, n('guard'), [(0.18, -0.012), (0.37, -0.012), (0.38, 0.0), (0.38, 0.036), (0.18, 0.036), (0.175, 0.02)], 0.056, W, bev=0.008, seg=3)
    lathe(n('gastube'), [(0.0, 0.18), (0.017, 0.18), (0.018, 0.19), (0.018, 0.35), (0.015, 0.36), (0.0, 0.36)], W, r, segs=14, loc=(0, 0, 0.062))
    rbox(n('gasblock'), (0.026, 0.04, 0.04), (0, 0.395, 0.05), M, r, r=0.004, seg=2)
    barrel(r, n('barrel'), 0.17, 0.63, 0.032, 0.0095, M)
    lathe(n('brake'), [(0.0, 0.63), (0.015, 0.63), (0.016, 0.64), (0.014, 0.69), (0.012, 0.695), (0.0, 0.695)], M, r, segs=14, loc=(0, 0, 0.032))
    rbox(n('fsightbase'), (0.024, 0.035, 0.03), (0, 0.6, 0.05), M, r, r=0.004, seg=1)
    rbox(n('fsight'), (0.006, 0.006, 0.034), (0, 0.6, 0.08), M, r, r=0.001, seg=1)
    tube(n('rod'), [(0, 0.39, 0.019), (0, 0.6, 0.019)], 0.0035, M, r, sides=6)
    curved_mag(r, n('mag'), 0.075, -0.015, 0.075, 0.2, 0.09, M)
    pistol_grip(r, gid, -0.09, -0.07, W)
    trigger(r, gid, 0.02, -0.02, M)
    side(r, n('stock'), [(-0.13, 0.03), (-0.13, -0.02), (-0.2, -0.05), (-0.43, -0.09), (-0.43, 0.04), (-0.2, 0.035)], 0.044, W, bev=0.008, seg=3)
    side(r, n('butt'), [(-0.43, -0.092), (-0.445, -0.092), (-0.445, 0.042), (-0.43, 0.042)], 0.046, B, bev=0.004)
    lathe(n('chandle'), [(0.0, 0.0), (0.006, 0.0), (0.006, 0.02), (0.0, 0.02)], M, r, segs=8, loc=(0.03, 0.12, 0.045), axis='X')
    rbox(n('selector'), (0.004, 0.11, 0.012), (0.026, -0.02, 0.02), M, r, r=0.002, seg=1)
    empty(n('muzzle'), (0, 0.7, 0.032), r)
    empty(n('fore'), (0, 0.27, -0.035), r)


def m4r(r, n):
    gid = 'm4r'
    B, T, M = G['black'], G['tan'], G['metal']
    side(r, n('upper'), [(-0.12, 0.012), (0.17, 0.012), (0.17, 0.055), (-0.12, 0.055)], 0.046, B, bev=0.003)
    side(r, n('recv'), [(-0.12, 0.012), (0.075, 0.012), (0.075, -0.035), (0.03, -0.04), (-0.06, -0.03), (-0.1, -0.012), (-0.125, 0.0)], 0.044, B, bev=0.004)
    side(r, n('magwell'), [(0.075, 0.012), (0.075, -0.07), (0.02, -0.07), (0.02, -0.03)], 0.046, B, bev=0.003)
    picatinny(r, gid + '_rail', -0.11, 0.42, 0.06, B)
    lathe(n('guard'), [(0.0, 0.17), (0.029, 0.17), (0.031, 0.18), (0.031, 0.42), (0.029, 0.43), (0.0, 0.43)], T, r, segs=8, loc=(0, 0, 0.03))
    for i in range(5):
        for s in (-1, 1):
            rbox(f'{gid}_slot{i}{s}', (0.004, 0.03, 0.009), (s * 0.03, 0.21 + i * 0.045, 0.03), B, r, r=0.002, seg=1)
    barrel(r, n('barrel'), 0.17, 0.6, 0.03, 0.009, B)
    lathe(n('flash'), [(0.0, 0.6), (0.012, 0.6), (0.013, 0.61), (0.013, 0.655), (0.011, 0.66), (0.0, 0.66)], B, r, segs=10, loc=(0, 0, 0.03))
    rbox(n('fsight'), (0.02, 0.016, 0.03), (0, 0.405, 0.083), B, r, r=0.003, seg=1)
    red_dot(r, gid, 0.03, 0.064)
    lathe(n('buffer'), [(0.0, -0.36), (0.015, -0.36), (0.015, -0.12), (0.0, -0.12)], B, r, segs=14, loc=(0, 0, 0.03))
    side(r, n('stock'), [(-0.2, 0.06), (-0.37, 0.065), (-0.385, 0.055), (-0.385, -0.06), (-0.36, -0.065), (-0.3, -0.02), (-0.2, 0.0)], 0.044, T, bev=0.006, seg=2)
    curved_mag(r, n('mag'), 0.024, -0.06, 0.047, 0.14, 0.03, T, thick=0.026)
    pistol_grip(r, gid, -0.1, -0.07, B)
    trigger(r, gid, -0.01, -0.03, B)
    rbox(n('chandle'), (0.03, 0.02, 0.01), (0, -0.125, 0.052), B, r, r=0.003, seg=1)
    lathe(n('fassist'), [(0.0, 0.0), (0.007, 0.0), (0.007, 0.02), (0.0, 0.02)], B, r, segs=8, loc=(0.026, -0.05, 0.044), axis='X')
    rbox(n('port'), (0.003, 0.06, 0.018), (0.024, 0.04, 0.032), M, r, r=0.001, seg=1)
    empty(n('muzzle'), (0, 0.67, 0.03), r)
    empty(n('fore'), (0, 0.27, -0.025), r)


def vex(r, n):
    gid = 'vex'
    B, Gr, M = G['black'], G['gray'], G['metal']
    lathe(n('recv'), [(0.0, -0.13), (0.026, -0.13), (0.028, -0.12), (0.028, 0.16), (0.024, 0.17), (0.0, 0.17)], B, r, segs=16, loc=(0, 0, 0.032))
    lathe(n('ctube'), [(0.0, 0.0), (0.012, 0.0), (0.012, 0.22), (0.0, 0.22)], B, r, segs=10, loc=(0, 0, 0.068))
    side(r, n('lower'), [(-0.1, 0.01), (0.06, 0.01), (0.06, -0.02), (0.0, -0.035), (-0.1, -0.02)], 0.042, Gr, bev=0.004)
    side(r, n('front'), [(0.16, -0.01), (0.27, -0.008), (0.28, 0.02), (0.28, 0.05), (0.16, 0.05)], 0.05, B, bev=0.008, seg=3)
    barrel(r, n('barrel'), 0.27, 0.33, 0.032, 0.01, M)
    lathe(n('flash'), [(0.0, 0.33), (0.012, 0.33), (0.012, 0.35), (0.0, 0.35)], M, r, segs=10, loc=(0, 0, 0.032))
    curved_mag(r, n('mag'), 0.09, -0.005, 0.035, 0.19, 0.05, B, thick=0.024)
    pistol_grip(r, gid, -0.06, -0.07, Gr)
    trigger(r, gid, 0.02, -0.025, M)
    for s in (-1, 1):
        tube(f'{gid}_stockrod{s}', [(s * 0.022, -0.12, 0.04), (s * 0.022, -0.32, 0.03)], 0.005, M, r, sides=8)
    side(r, n('butt'), [(-0.32, 0.07), (-0.335, 0.07), (-0.335, -0.03), (-0.32, -0.03)], 0.06, B, bev=0.006)
    rbox(n('rsight'), (0.028, 0.03, 0.02), (0, -0.09, 0.07), B, r, r=0.004, seg=1)
    rbox(n('fsight'), (0.022, 0.02, 0.026), (0, 0.15, 0.07), B, r, r=0.004, seg=1)
    empty(n('muzzle'), (0, 0.35, 0.032), r)
    empty(n('fore'), (0, 0.21, -0.025), r)


def breacher(r, n):
    gid = 'breacher'
    M, W, B = G['metal'], G['wood'], G['black']
    side(r, n('recv'), [(-0.1, -0.015), (0.12, -0.015), (0.12, 0.058), (-0.08, 0.058), (-0.1, 0.04)], 0.05, M, bev=0.004)
    barrel(r, n('barrel'), 0.12, 0.66, 0.045, 0.0125, M)
    barrel(r, n('tube'), 0.12, 0.56, 0.012, 0.0115, M)
    rbox(n('band'), (0.02, 0.016, 0.05), (0, 0.55, 0.03), M, r, r=0.004, seg=1)
    prof = [(0.0, 0.22)]
    for i in range(9):
        y = 0.23 + i * 0.018
        prof += [(0.026, y), (0.029, y + 0.004), (0.029, y + 0.012), (0.026, y + 0.016)]
    prof += [(0.0, 0.39)]
    lathe(n('pump'), prof, W, r, segs=14, loc=(0, 0, 0.016))
    pistol_grip(r, gid, -0.09, -0.06, W, length=0.1)
    trigger(r, gid, 0.0, -0.015, M)
    side(r, n('stock'), [(-0.1, 0.045), (-0.1, -0.02), (-0.14, -0.04), (-0.4, -0.1), (-0.4, 0.05), (-0.15, 0.045)], 0.046, W, bev=0.01, seg=3)
    side(r, n('butt'), [(-0.4, -0.102), (-0.42, -0.102), (-0.42, 0.052), (-0.4, 0.052)], 0.048, B, bev=0.005)
    sphere(n('bead'), 0.005, (0, 0.65, 0.062), G['steel'], r)
    rbox(n('port'), (0.003, 0.07, 0.025), (0.026, 0.03, 0.03), B, r, r=0.001, seg=1)
    empty(n('muzzle'), (0, 0.67, 0.045), r)
    empty(n('fore'), (0, 0.3, -0.035), r)


def longshot(r, n):
    gid = 'longshot'
    Gn, M, B = G['green'], G['metal'], G['black']
    side(r, n('body'), [(-0.12, 0.045), (0.3, 0.045), (0.32, 0.02), (0.3, -0.02), (0.1, -0.03), (0.03, -0.045), (-0.03, -0.045), (-0.08, -0.03), (-0.12, -0.03)], 0.066, Gn, bev=0.01, seg=3)
    side(r, n('stock'), [(-0.12, 0.045), (-0.24, 0.07), (-0.44, 0.075), (-0.46, 0.06), (-0.46, -0.11), (-0.42, -0.115), (-0.3, -0.07),
                         (-0.22, -0.07), (-0.2, -0.03), (-0.12, -0.03)], 0.06, Gn, bev=0.012, seg=3)
    rbox(n('cheek'), (0.05, 0.16, 0.025), (0, -0.34, 0.085), Gn, r, r=0.008, seg=2)
    side(r, n('butt'), [(-0.46, -0.115), (-0.475, -0.115), (-0.475, 0.08), (-0.46, 0.08)], 0.062, B, bev=0.004)
    pistol_grip(r, gid, -0.15, -0.085, Gn, length=0.115, width=0.036)
    trigger(r, gid, -0.07, -0.035, M)
    lathe(n('recv'), [(0.0, -0.1), (0.024, -0.1), (0.024, 0.13), (0.02, 0.14), (0.0, 0.14)], M, r, segs=18, loc=(0, 0, 0.06))
    prof = [(0.0, 0.14), (0.016, 0.14), (0.015, 0.4), (0.012, 0.86), (0.0, 0.86)]
    lathe(n('barrel'), prof, M, r, segs=16, loc=(0, 0, 0.06))
    lathe(n('brake'), [(0.0, 0.86), (0.02, 0.86), (0.02, 0.92), (0.0, 0.92)], M, r, segs=10, loc=(0, 0, 0.06))
    for i in range(3):
        rbox(f'{gid}_brakeport{i}', (0.042, 0.008, 0.01), (0, 0.875 + i * 0.016, 0.06), B, r, r=0.002, seg=1)
    lathe(n('scope'), [(0.0, -0.2), (0.022, -0.2), (0.026, -0.18), (0.026, -0.13), (0.016, -0.1), (0.016, 0.1), (0.022, 0.14), (0.031, 0.17), (0.031, 0.21), (0.0, 0.21)],
          B, r, segs=20, loc=(0, 0, 0.125))
    lathe(n('obj'), [(0.0, 0.21), (0.027, 0.21), (0.0, 0.212)], G['glass'], r, segs=20, loc=(0, 0, 0.125))
    lathe(n('ocu'), [(0.0, -0.2), (0.019, -0.2), (0.0, -0.198)], G['glass'], r, segs=20, loc=(0, 0, 0.125))
    lathe(n('turretT'), [(0.0, 0.0), (0.012, 0.0), (0.012, 0.02), (0.0, 0.022)], B, r, segs=12, loc=(0, -0.0, 0.141), axis='Z')
    lathe(n('turretS'), [(0.0, 0.0), (0.011, 0.0), (0.011, 0.018), (0.0, 0.02)], B, r, segs=12, loc=(0.016, 0.0, 0.125), axis='X')
    for y in (-0.06, 0.08):
        rbox(f'{gid}_mount{y}', (0.03, 0.022, 0.04), (0, y, 0.095), B, r, r=0.004, seg=1)
    tube(n('bolt'), [(0.02, -0.07, 0.065), (0.05, -0.075, 0.05), (0.065, -0.08, 0.035)], 0.005, G['steel'], r, sides=8)
    sphere(n('knob'), 0.012, (0.068, -0.08, 0.032), B, r)
    side(r, n('mag'), [(0.01, -0.04), (0.1, -0.04), (0.098, -0.075), (0.012, -0.075)], 0.044, B, bev=0.004)
    for s in (-1, 1):
        tube(f'{gid}_bipod{s}', [(s * 0.012, 0.29, -0.02), (s * 0.02, 0.45, -0.025)], 0.0055, B, r, sides=8)
    empty(n('muzzle'), (0, 0.93, 0.06), r)
    empty(n('fore'), (0, 0.18, -0.055), r)


def pistol(slide_m, frame_m, length, chunky=1.0, gid=''):
    def b(r, n):
        L, c = length, chunky
        top, h = 0.052 * c, 0.036 * c
        side(r, n('slide'), [(-0.05, top - h), (L - 0.05, top - h), (L - 0.045, top - 0.004), (L - 0.052, top), (-0.04, top), (-0.05, top - 0.008)], 0.03 * c, slide_m, bev=0.004)
        for i in range(6):
            rbox(f'{gid}_serr{i}', (0.031 * c, 0.003, h * 0.75), (0, -0.04 + i * 0.007, top - h / 2), slide_m, r, r=0.0008, seg=1)
        rbox(n('port'), (0.004, 0.035, 0.012), (0.014 * c, 0.03, top - 0.012), G['steel'], r, r=0.001, seg=1)
        barrel(r, n('barrel'), L - 0.06, L - 0.048, top - h / 2, 0.0065 * c, G['steel'], segs=12)
        side(r, n('frame'), [(-0.045, top - h + 0.002), (L - 0.06, top - h + 0.002), (L - 0.06, top - h - 0.012), (0.04, top - h - 0.016), (-0.03, top - h - 0.016)],
             0.028 * c, frame_m, bev=0.003)
        pistol_grip(r, gid, -0.03, -0.045, frame_m, length=0.1, tilt=0.25, top=0.045 * c, bot=0.042 * c, width=0.03 * c)
        trigger(r, gid, 0.012, top - h - 0.016, frame_m)
        rbox(n('fsight'), (0.005, 0.006, 0.007), (0, L - 0.058, top + 0.003), G['black'], r, r=0.001, seg=1)
        rbox(n('rsight'), (0.02 * c, 0.008, 0.008), (0, -0.04, top + 0.003), G['black'], r, r=0.0015, seg=1)
        empty(n('muzzle'), (0, L - 0.045, top - h / 2), r)
        empty(n('fore'), (-0.01, -0.02, -0.06), r)
    return b


def knife(r, n):
    gid = 'knife'
    pts = [(0.02, -0.006), (0.12, -0.012), (0.2, -0.004), (0.255, 0.012)] + [(0.2, 0.018), (0.12, 0.02), (0.02, 0.018)]
    side(r, n('blade'), pts, 0.005, G['steel'], bev=0.0015, seg=1)
    side(r, n('fuller'), [(0.04, 0.005), (0.15, 0.006), (0.15, 0.01), (0.04, 0.01)], 0.0058, G['steel'], bev=0.001, seg=1)
    rbox(n('guardx'), (0.024, 0.01, 0.05), (0, 0.016, 0.006), G['metal'], r, r=0.003, seg=2)
    hp = [(-0.105, 0.0), (-0.1, -0.017), (-0.08, -0.015), (-0.065, -0.019), (-0.045, -0.015), (-0.03, -0.019), (-0.012, -0.016), (0.012, -0.014),
          (0.012, 0.022), (-0.1, 0.02)]
    side(r, n('handle'), hp, 0.022, G['black'], bev=0.005, seg=3)
    lathe(n('handlepommel'), [(0.0, -0.118), (0.012, -0.118), (0.014, -0.11), (0.012, -0.102), (0.0, -0.102)], G['metal'], r, segs=12, loc=(0, 0, 0.002))
    empty(n('muzzle'), (0, 0.25, 0.006), r)
    empty(n('fore'), (0, -0.045, 0), r)


gun('ark7', ark7); gun('m4r', m4r); gun('vex', vex); gun('breacher', breacher); gun('longshot', longshot)
gun('g9', pistol(G['black'], G['black'], 0.19, 1.0, 'g9')); gun('p12', pistol(G['metal'], G['tan'], 0.2, 1.05, 'p12'))
gun('hawk', pistol(G['steel'], G['black'], 0.26, 1.25, 'hawk')); gun('knife', knife)
