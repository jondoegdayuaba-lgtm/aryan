# Five extra knife models (plug-in for models.py: runs in its namespace, so mat/rbox/profile/lathe/torus/tube/empty/gun/G/RX exist).
# Conventions copied from the default 'knife' in blender_base/20_guns.py: blade along +Y with the edge down (-Z), the grip at
# the origin ('<id>_handle' is built at the origin so the view model and the third-person mount put the fist there),
# '<id>_muzzle' at the tip and '<id>_fore' under the handle. Finishes paint every part except names matching SKIN_SKIP
# (all handle parts carry 'handle' in their names); blades use the shared steel so the plain "Vanilla" knife looks like steel.
import bmesh

KNIFE_GRIP_Y = -0.035  # where the fist closes: a little behind the handle front so guard and bolsters show in first person


def knife_loft(name, edge, spine, thick, m, parent, grind=0.42, fuller=None, fpos=(0.55, 0.67, 0.79), sharp=0.5):
    """Blade lofted through cross-sections. edge/spine: lists of (y, z) points (same length), thick: per-section thickness,
    fuller: per-section groove depth 0..1 (cut into both flats between fpos[0] and fpos[2] of the height).
    Each section: sharp edge (x=0) -> flat grind up to `grind` -> flats with the fuller -> square spine."""
    us = [(0.0, 0.0), (grind, 1.0), (fpos[0], 1.0), (fpos[1], None), (fpos[2], 1.0), (1.0, 1.0)]
    bm = bmesh.new()
    rings = []
    for i in range(len(edge)):
        (ey, ez), (sy, sz) = edge[i], spine[i]
        t = thick[i] / 2
        d = fuller[i] if fuller else 0.0
        right = []
        for u, f in us:
            f = 1.0 - d if f is None else f
            right.append((t * f, ey + (sy - ey) * u, ez + (sz - ez) * u))
        left = [(-x, y, z) for (x, y, z) in reversed(right[1:])]
        rings.append([bm.verts.new(c) for c in right + left])
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(n):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=True, sharp=sharp)
    reparent(o, parent)
    return o


def knife_interp(keys, ys):
    """Piecewise-linear value at each y from sorted (y, value) keys."""
    out = []
    for y in ys:
        if y <= keys[0][0]:
            out.append(keys[0][1]); continue
        for (y0, v0), (y1, v1) in zip(keys, keys[1:]):
            if y0 <= y <= y1:
                out.append(v0 + (v1 - v0) * (y - y0) / (y1 - y0)); break
        else:
            out.append(keys[-1][1])
    return out


def knife_pin(name, y, z, length, rad, m, parent, x=0.0):
    return lathe(name, [(0.0, x - length / 2), (rad, x - length / 2), (rad * 1.05, x - length / 2 + 0.0008), (rad * 1.05, x + length / 2 - 0.0008),
                        (rad, x + length / 2), (0.0, x + length / 2)], m, parent, segs=12, loc=(0, y, z), axis='X')


# ---------------------------------------------------------------- Hook Knife: claw blade, curved handle, finger ring
def knife_hook(r, n):
    grip = mat('knife_hook_grip', 0x2b2622, 0, 0.62)       # dark brown-black micarta scales
    C = (0.022, -0.125)                                    # centre of the claw arc (below the handle)
    Rs, N = 0.15, 18
    a0, a1 = math.radians(96), math.radians(34)
    edge, spine, th = [], [], []
    for i in range(N + 1):
        t = i / N
        a = a0 + (a1 - a0) * t
        w = 0.038 * (1 - t ** 2.1) * (1 - 0.25 * t) + 0.0006               # blade height tapers into the claw point
        re = Rs - w
        spine.append((C[0] + Rs * math.cos(a), C[1] + Rs * math.sin(a)))
        edge.append((C[0] + re * math.cos(a), C[1] + re * math.sin(a)))
        th.append(0.0058 * (1 - t ** 2.2) + 0.0006)
    knife_loft(n('blade'), edge, spine, th, G['steel'], r, grind=0.5)
    # spine jimping on the claw's back
    for i in range(6):
        a = math.radians(92 - i * 3.2)
        rbox(f'knife_hook_jimp{i}', (0.006, 0.0018, 0.003), (0, C[0] + (Rs + 0.0006) * math.cos(a), C[1] + (Rs + 0.0006) * math.sin(a)),
             G['steel'], r, r=0.0006, seg=1, rot=(a - math.pi / 2, 0, 0))
    # handle: banana-shaped scales with an index-finger choil, curving down to the ring
    zc = lambda y: 0.002 - 2.1 * y * y
    top = [(y, zc(y) + 0.0165) for y in (0.022, 0.0, -0.02, -0.04, -0.06, -0.075, -0.084)]
    bot = []
    for y in (-0.084, -0.075, -0.06, -0.045, -0.03, -0.015, 0.0, 0.012, 0.022):
        g = 0.003 * math.sin((y + 0.084) / 0.084 * math.pi * 2.0) if y < 0.0 else 0.0
        bot.append((y, zc(y) - 0.0155 + g + (0.004 if y > 0.006 else 0.0)))
    hp = top + bot
    profile(n('handle'), hp, 0.021, grip, r, bev=0.005, seg=3)
    # full tang showing between the scales, and the finger ring forged on it
    tang = [(y, z + (0.0012 if z > zc(y) else -0.0012)) for (y, z) in hp]
    profile(n('handletang'), tang, 0.0056, G['metal'], r, bev=0.0008, seg=1)
    torus(n('ring'), 0.0165, 0.0052, (0, -0.1, zc(-0.1) - 0.002), G['steel'], r, rot=(0, RX, 0), major=28, minor=8)
    for i, y in enumerate((-0.012, -0.056)):
        knife_pin(f'knife_hook_handlepin{i}', y, zc(y) + 0.001, 0.0225, 0.0028, G['steel'], r)
    tip = spine[-1]
    empty(n('muzzle'), (0, tip[0], tip[1]), r)
    empty(n('fore'), (0, -0.045, 0), r)
    empty(n('grip'), (0, KNIFE_GRIP_Y, 0), r)


# ---------------------------------------------------------------- Spire Bayonet: long fullered blade, muzzle-ring guard
def knife_spire(r, n):
    grip = mat('knife_spire_grip', 0x34402c, 0, 0.7)      # olive polymer handle
    ys = [0.01, 0.03, 0.06, 0.09, 0.12, 0.145, 0.165, 0.18, 0.192, 0.201, 0.207, 0.2105]
    ez = knife_interp([(0.01, -0.012), (0.145, -0.012), (0.165, -0.0095), (0.18, -0.0055), (0.192, -0.001), (0.201, 0.003), (0.207, 0.0055), (0.2105, 0.0068)], ys)
    sz = knife_interp([(0.01, 0.019), (0.145, 0.019), (0.165, 0.0172), (0.18, 0.0148), (0.192, 0.0122), (0.201, 0.0099), (0.207, 0.0083), (0.2105, 0.0072)], ys)
    th = knife_interp([(0.01, 0.0068), (0.145, 0.0062), (0.18, 0.0042), (0.2, 0.0022), (0.2105, 0.0005)], ys)
    fu = knife_interp([(0.01, 0.0), (0.03, 0.6), (0.125, 0.6), (0.15, 0.15), (0.165, 0.0)], ys)
    knife_loft(n('blade'), list(zip(ys, ez)), list(zip(ys, sz)), th, G['steel'], r, grind=0.36, fuller=fu, fpos=(0.5, 0.66, 0.82))
    # cross guard with the muzzle ring on top and a short hooked lower quillon
    profile(n('guard'), [(0.002, -0.026), (0.006, -0.032), (0.016, -0.036), (0.019, -0.032), (0.013, -0.026), (0.013, 0.03), (0.002, 0.03)],
            0.024, G['metal'], r, bev=0.0025, seg=2)
    profile(n('guardpost'), [(0.003, 0.029), (0.012, 0.029), (0.012, 0.036), (0.003, 0.036)], 0.012, G['metal'], r, bev=0.0015, seg=1)
    torus(n('guardring'), 0.0098, 0.0032, (0, 0.0075, 0.046), G['metal'], r, rot=(RX, 0, 0), major=24, minor=8)
    # grooved handle and a pommel block with the release button
    hp = [(0.003, 0.021), (-0.03, 0.022), (-0.07, 0.021), (-0.1, 0.019), (-0.103, 0.0), (-0.1, -0.017), (-0.07, -0.019), (-0.04, -0.017),
          (-0.01, -0.016), (0.003, -0.015)]
    profile(n('handle'), hp, 0.024, grip, r, bev=0.006, seg=3)
    for i in range(7):
        y = -0.012 - i * 0.012
        rbox(f'knife_spire_handlerib{i}', (0.0255, 0.005, 0.036), (0, y, 0.002), grip, r, r=0.002, seg=1)
    rbox(n('handlepommel'), (0.026, 0.016, 0.043), (0, -0.108, 0.002), G['metal'], r, r=0.004, seg=2)
    knife_pin('knife_spire_handlebutton', -0.108, 0.012, 0.03, 0.004, G['steel'], r)
    rbox(n('handleslot'), (0.0045, 0.006, 0.03), (0, -0.115, 0.0), G['black'], r, r=0.001, seg=1)
    empty(n('muzzle'), (0, 0.2105, 0.007), r)
    empty(n('fore'), (0, -0.045, 0), r)
    empty(n('grip'), (0, KNIFE_GRIP_Y, 0), r)


# ---------------------------------------------------------------- Flip Knife: drop-point folder with a flipper tab
def knife_flip(r, n):
    scale_m = mat('knife_flip_scales', 0x2c4a60, 0, 0.55)   # blue-grey G10 scales
    ys = [0.008, 0.03, 0.06, 0.09, 0.12, 0.145, 0.165, 0.18, 0.191, 0.199, 0.2035]
    ez = knife_interp([(0.008, -0.0095), (0.04, -0.0108), (0.09, -0.0118), (0.12, -0.0112), (0.145, -0.0088), (0.165, -0.0052),
                       (0.18, -0.0018), (0.191, 0.0012), (0.199, 0.0032), (0.2035, 0.0042)], ys)
    sz = knife_interp([(0.008, 0.0175), (0.12, 0.0178), (0.145, 0.0168), (0.165, 0.0146), (0.18, 0.0118), (0.191, 0.0088),
                       (0.199, 0.0062), (0.2035, 0.0047)], ys)
    th = knife_interp([(0.008, 0.0048), (0.14, 0.0044), (0.18, 0.0028), (0.2035, 0.0005)], ys)
    knife_loft(n('blade'), list(zip(ys, ez)), list(zip(ys, sz)), th, G['steel'], r, grind=0.55, fpos=(0.65, 0.75, 0.85))
    profile(n('flipper'), [(0.0, -0.007), (0.02, -0.007), (0.018, -0.016), (0.013, -0.027), (0.008, -0.03), (0.004, -0.026), (0.003, -0.016)],
            0.0046, G['steel'], r, bev=0.0012, seg=2)
    for i in range(5):  # jimping on the flipper and the spine
        rbox(f'knife_flip_jimp{i}', (0.0052, 0.0016, 0.0022), (0, 0.024 + i * 0.004, 0.0185), G['steel'], r, r=0.0005, seg=1)
    # liner (steel frame) with the scales on both sides
    hp = [(0.019, 0.0), (0.016, 0.0145), (0.0, 0.0175), (-0.03, 0.0185), (-0.065, 0.0175), (-0.092, 0.0155), (-0.102, 0.009), (-0.104, 0.0),
          (-0.1, -0.012), (-0.085, -0.0155), (-0.06, -0.0145), (-0.04, -0.0168), (-0.02, -0.0148), (0.0, -0.0128), (0.013, -0.011)]
    profile(n('handle'), hp, 0.0126, G['metal'], r, bev=0.0012, seg=1)
    sc = [(y * 0.985, z * 0.9) for (y, z) in hp]
    for s in (-1, 1):
        profile(f'knife_flip_handlescale{s}', sc, 0.0042, scale_m, r, x=s * 0.0081, bev=0.0016, seg=2)
    knife_pin('knife_flip_handlepivot', 0.004, 0.003, 0.0215, 0.0056, G['steel'], r)
    knife_pin('knife_flip_handlepin', -0.088, 0.002, 0.0205, 0.0028, G['steel'], r)
    knife_pin('knife_flip_handlestop', -0.012, 0.012, 0.0205, 0.0022, G['steel'], r)
    rbox('knife_flip_handleclip', (0.0016, 0.07, 0.0085), (0.0112, -0.058, 0.011), G['metal'], r, r=0.0006, seg=1)
    knife_pin('knife_flip_handleclipscrew', -0.088, 0.011, 0.004, 0.0022, G['steel'], r, x=0.0118)
    empty(n('muzzle'), (0, 0.2035, 0.0045), r)
    empty(n('fore'), (0, -0.045, 0), r)
    empty(n('grip'), (0, KNIFE_GRIP_Y, 0), r)


# ---------------------------------------------------------------- Ridgeback: big clip-point survival blade with a saw spine
def knife_ridge(r, n):
    rubber = mat('knife_ridge_rubber', 0x3c3f2e, 0, 0.85)  # olive-black rubber grip
    ys = [0.012, 0.03, 0.06, 0.09, 0.12, 0.138, 0.155, 0.17, 0.184, 0.196, 0.205, 0.2115, 0.2145]
    ez = knife_interp([(0.012, -0.019), (0.03, -0.0215), (0.09, -0.0225), (0.12, -0.0205), (0.138, -0.0178), (0.155, -0.0136),
                       (0.17, -0.0088), (0.184, -0.004), (0.196, 0.0002), (0.205, 0.0032), (0.2115, 0.0051), (0.2145, 0.0058)], ys)
    sz = knife_interp([(0.012, 0.0235), (0.12, 0.0235), (0.138, 0.0212), (0.155, 0.0178), (0.17, 0.0146), (0.184, 0.0119),
                       (0.196, 0.0096), (0.205, 0.0079), (0.2115, 0.0066), (0.2145, 0.0061)], ys)
    th = knife_interp([(0.012, 0.0072), (0.12, 0.0068), (0.17, 0.0046), (0.2, 0.0022), (0.2145, 0.0005)], ys)
    fu = knife_interp([(0.012, 0.0), (0.035, 0.42), (0.1, 0.42), (0.125, 0.0)], ys)
    knife_loft(n('blade'), list(zip(ys, ez)), list(zip(ys, sz)), th, G['steel'], r, grind=0.4, fuller=fu, fpos=(0.58, 0.7, 0.82))
    # saw teeth along the straight spine, hooked back towards the handle
    saw = [(0.026, 0.0215)]
    for i in range(9):
        y = 0.03 + i * 0.0098
        saw += [(y, 0.0235), (y + 0.0072, 0.0318), (y + 0.0098, 0.0235)]
    saw += [(0.1205, 0.0215)]
    profile(n('sawspine'), saw, 0.0064, G['steel'], r, bev=0.0006, seg=1)
    # double guard with curled quillons
    profile(n('guard'), [(0.003, -0.032), (0.014, -0.032), (0.014, 0.031), (0.003, 0.031)], 0.026, G['metal'], r, bev=0.003, seg=2)
    tube(n('guardq0'), [(0, 0.0085, -0.03), (0, 0.011, -0.041), (0, 0.018, -0.047), (0, 0.024, -0.046)], 0.0042, G['metal'], r, sides=10)
    tube(n('guardq1'), [(0, 0.0085, 0.029), (0, 0.011, 0.038), (0, 0.017, 0.043)], 0.0042, G['metal'], r, sides=10)
    # rubber grip with finger grooves, ribbed sides and a steel butt cap
    hp = [(0.004, 0.02), (-0.03, 0.0225), (-0.065, 0.0225), (-0.096, 0.02), (-0.098, -0.02)]
    for k in range(25):
        y = -0.096 + k * 0.1 / 24
        hp.append((y, -0.021 + 0.0042 * math.sin((y + 0.096) / 0.1 * math.pi * 4 - math.pi / 2) * (1 if y < -0.004 else 0.3)))
    profile(n('handle'), hp, 0.027, rubber, r, bev=0.006, seg=3)
    for i in range(6):
        for s in (-1, 1):
            rbox(f'knife_ridge_handlerib{i}{s}', (0.002, 0.006, 0.026), (s * 0.0136, -0.018 - i * 0.012, 0.001), rubber, r, r=0.0009, seg=1)
    profile(n('handlebutt'), [(-0.096, 0.0215), (-0.096, -0.0215), (-0.103, -0.022), (-0.109, -0.016), (-0.112, 0.0), (-0.109, 0.016), (-0.103, 0.022)],
            0.028, G['metal'], r, bev=0.003, seg=2)
    knife_pin('knife_ridge_handlelanyard', -0.105, 0.0, 0.0295, 0.0038, G['black'], r)
    empty(n('muzzle'), (0, 0.2145, 0.006), r)
    empty(n('fore'), (0, -0.045, 0), r)
    empty(n('grip'), (0, KNIFE_GRIP_Y, 0), r)


# ---------------------------------------------------------------- Moth Knife: balisong shown open, two skeleton handle halves
def knife_moth(r, n):
    anod = mat('knife_moth_anod', 0x4b3d8f, 0.15, 0.4)     # violet anodised handles
    slot = mat('knife_moth_slot', 0x121316, 0, 0.6)
    ys = [-0.004, 0.018, 0.05, 0.08, 0.1, 0.116, 0.13, 0.141, 0.149, 0.1545, 0.1575]
    ez = knife_interp([(-0.004, -0.0105), (0.018, -0.0112), (0.08, -0.0115), (0.1, -0.0102), (0.116, -0.0077), (0.13, -0.0046),
                       (0.141, -0.0016), (0.149, 0.0006), (0.1545, 0.0021), (0.1575, 0.0028)], ys)
    sz = knife_interp([(-0.004, 0.0115), (0.08, 0.0118), (0.1, 0.0113), (0.116, 0.0096), (0.13, 0.0074), (0.141, 0.0055),
                       (0.149, 0.0042), (0.1545, 0.0034), (0.1575, 0.003)], ys)
    th = knife_interp([(-0.004, 0.0046), (0.09, 0.0042), (0.13, 0.0028), (0.1575, 0.0005)], ys)
    knife_loft(n('blade'), list(zip(ys, ez)), list(zip(ys, sz)), th, G['steel'], r, grind=0.45, fpos=(0.6, 0.72, 0.84))
    # kicker under the tang and swedge-free spine jimping
    profile(n('kicker'), [(-0.002, -0.009), (0.012, -0.009), (0.009, -0.0135), (0.0, -0.0145)], 0.0046, G['steel'], r, bev=0.0008, seg=1)
    # two handle halves either side of the tang, rounded at the pivot end
    hp = []
    for k in range(9):
        a = math.pi / 2 - k * math.pi / 8
        hp.append((0.009 + 0.0125 * math.cos(a) * 0.9, 0.0125 * math.sin(a)))
    hp += [(-0.03, -0.0128), (-0.075, -0.0118), (-0.12, -0.0126), (-0.14, -0.0122), (-0.146, -0.008), (-0.147, 0.0),
           (-0.146, 0.008), (-0.14, 0.0122), (-0.12, 0.0126), (-0.075, 0.0118), (-0.03, 0.0128)]
    for s, nm in ((1, n('handle')), (-1, n('handleB'))):
        profile(nm, hp, 0.0082, anod, r, x=s * 0.0067, bev=0.0016, seg=2)
        for i, (y0, y1) in enumerate(((-0.012, -0.044), (-0.054, -0.086), (-0.096, -0.128))):
            rbox(f'knife_moth_handleslot{i}{"ab"[s > 0]}', (0.0014, y0 - y1, 0.0105 if i != 1 else 0.009), (s * 0.0107, (y0 + y1) / 2, 0.0), slot, r, r=0.0006, seg=1)
        knife_pin(f'knife_moth_handlepivot{"ab"[s > 0]}', 0.008, 0.0, 0.0018, 0.0045, G['steel'], r, x=s * 0.0112)
        knife_pin(f'knife_moth_handlescrew{"ab"[s > 0]}', -0.139, 0.0, 0.0018, 0.0026, G['steel'], r, x=s * 0.0112)
    knife_pin('knife_moth_handlepivotcore', 0.008, 0.0, 0.0215, 0.0032, G['steel'], r)
    knife_pin('knife_moth_handlepinB', -0.139, 0.0, 0.0215, 0.002, G['steel'], r)
    # latch closing the two halves at the butt
    rbox('knife_moth_handlelatch', (0.0185, 0.012, 0.0032), (0, -0.136, -0.0118), G['metal'], r, r=0.0008, seg=1)
    knife_pin('knife_moth_handlelatchpin', -0.131, -0.0098, 0.0215, 0.0016, G['steel'], r)
    empty(n('muzzle'), (0, 0.1575, 0.003), r)
    empty(n('fore'), (0, -0.045, 0), r)
    empty(n('grip'), (0, KNIFE_GRIP_Y, 0), r)


gun('knife_hook', knife_hook); gun('knife_spire', knife_spire); gun('knife_flip', knife_flip)
gun('knife_ridge', knife_ridge); gun('knife_moth', knife_moth)
