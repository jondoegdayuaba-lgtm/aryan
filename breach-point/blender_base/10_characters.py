# Agents: one skinned body (skin-modifier mannequin on an armature) dressed per outfit.
# Every agent exports '<id>_char' (root) with an armature whose bones the game poses by name:
#   pelvis spine chest neck head aim clavL/R upperarmL/R forearmL/R handL/R thighL/R shinL/R footL/R
# plus '<id>_gun' (weapon mount on the aim bone), '<id>_vmarmR' and '<id>_vmarmL' (first-person hands).
# The rest pose is a bladed rifle stance: hips square, shoulders turned TWIST to the right, head forward,
# right hand on the pistol grip and left hand on the handguard of a rifle whose origin sits at MOUNT.
# The body is built "square" first (everything above the waist turned back by TWIST), then the spine is
# posed and that pose is applied as the rest pose.
from mathutils import Matrix, Quaternion

AGENTS = {
    'S_raider': dict(team='S', head='balaclava', torso='vest', extras=['pack'], pat={'pants': 'camo'},
        L=dict(shirt=0xa88a5a, vest=0x4a4636, pants=0x6b6448, head=0x2b2b2b, skin=0xc99d7b, sleeve=0x8a7650,
               glove=0x2a2622, boot=0x3a2c20, pouch=0x5a5440, belt=0x3a3024, pack=0x6a5a3a)),
    'S_bandit': dict(team='S', head='balaclava', torso='vest', extras=['bandolier', 'rolled'], pat={'shirt': 'plaid', 'sleeve': 'plaid'},
        L=dict(shirt=0x9a4a32, vest=0x8a8f72, pants=0x4f5536, head=0x3d4a2c, skin=0xc08e6a, sleeve=0x9a4a32,
               glove=0x3a2c20, boot=0x5a3c22, pouch=0x6b6b4c, belt=0x4a3420, pack=0x6a5a3a)),
    'S_ghost': dict(team='S', head='hood', torso='jacket', extras=['shemagh', 'pack'], pat={'vest': 'camo', 'pants': 'camo'},
        L=dict(shirt=0xcdb48a, vest=0xb39a6e, pants=0x9c8660, head=0xb39a6e, skin=0xb98a66, sleeve=0xb39a6e,
               glove=0x5a4a36, boot=0x6b5236, pouch=0x8f7a54, belt=0x5a4630, pack=0x9c8660, scarf=0x8a6a4a)),
    'S_brute': dict(team='S', head='gasmask', torso='heavy', extras=['pads', 'pack'],
        L=dict(shirt=0x3a3a36, vest=0x2a2b25, pants=0x35352f, head=0x1e1f1c, skin=0xa87a5a, sleeve=0x3a3a36,
               glove=0x161616, boot=0x141414, pouch=0x34352e, belt=0x1a1a18, pack=0x2c2d28, accent=0xc8502a)),
    'W_officer': dict(team='W', head='helmet', torso='vest', extras=['pack', 'patch', 'beard'], pat={'shirt': 'digi', 'sleeve': 'digi', 'pants': 'digi'},
        L=dict(shirt=0x3e5068, vest=0x252c38, pants=0x3e4a5c, head=0xc99d7b, skin=0xc99d7b, sleeve=0x3e5068,
               glove=0x1f2226, boot=0x1c1d20, pouch=0x30394a, belt=0x22262c, pack=0x39424f, helmet=0x39424f)),
    'W_diver': dict(team='W', head='diver', torso='wetsuit', extras=['tank'],
        L=dict(shirt=0x1a1d22, vest=0x22262c, pants=0x1a1d22, head=0x15171a, skin=0xc99d7b, sleeve=0x1a1d22,
               glove=0x111214, boot=0x111214, pouch=0x2a2f36, belt=0x2a2f36, pack=0x3a4652, accent=0xe0b020, helmet=0x15171a)),
    'W_riot': dict(team='W', head='visor', torso='heavy', extras=['pads', 'patch'],
        L=dict(shirt=0x4a5560, vest=0x2a323a, pants=0x404a54, head=0xc99d7b, skin=0xb88a68, sleeve=0x4a5560,
               glove=0x1a1c1f, boot=0x15171a, pouch=0x343c44, belt=0x22262c, pack=0x39424f, helmet=0x2e363e, accent=0x5aa7ff)),
    'W_ranger': dict(team='W', head='cap', torso='jacket', extras=['shemagh', 'pack', 'beard'], pat={'vest': 'snowcamo', 'pants': 'snowcamo'},
        L=dict(shirt=0xd8dde2, vest=0xc4cbd2, pants=0xc4cbd2, head=0x6b7480, skin=0xd2a684, sleeve=0xc4cbd2,
               glove=0x3a3f46, boot=0x3a3530, pouch=0x8a949e, belt=0x4a4f56, pack=0x7a848e, scarf=0x5a6a7a, helmet=0x6b7480)),
}

RS = 1.32          # skin-modifier radius compensation for subdivision shrink
HEADC = Vector((0, 0.022, 1.655))
HEADR = Vector((0.080, 0.098, 0.112))
TWIST = math.radians(35)                                  # shoulders turned right in the rifle stance
MOUNT = Vector((0.14, 0.37, 1.38))                        # gun origin in the rest pose (a gun's stock ends ~0.4 behind it)
GRIP_P = Vector((0.0, -0.09, -0.07))                      # pistol-grip centre in gun space
GRIP_A = Vector((0.0, math.sin(0.3), math.cos(0.3)))      # pistol-grip axis (top leans forward)
FORE_P = Vector((0.0, 0.20, 0.02))                        # support hand on the handguard axis, gun space
UPPER, FOREARM = 0.30, 0.258                              # arm bone lengths
GRIP_R, GRIP_L = 0.019, 0.026                             # radius of what each hand holds


def rz(v, a):
    v = Vector(v)
    c, s = math.cos(a), math.sin(a)
    return Vector((v.x * c - v.y * s, v.x * s + v.y * c, v.z))


def wrist_off(sx, rg):
    return Vector((sx * (rg + 0.007), -0.064, -0.012))


def ik2(S, W, L1, L2, pole):
    """Two-bone IK: elbow and (reachable) wrist for shoulder S, wrist target W, bending towards pole."""
    D = W - S
    dist = min(D.length, (L1 + L2) * 0.995)
    dn = D.normalized()
    ca = max(-1.0, min(1.0, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)))
    p = (pole - dn * pole.dot(dn)).normalized()
    return S + dn * (L1 * ca) + p * (L1 * math.sqrt(1 - ca * ca)), S + dn * dist


def hand_frame(A, d, sx, rg):
    """Rotation of a fist() whose grip axis (local Z) lies along A and whose wrist points back along the
    forearm direction d (elbow to wrist)."""
    Z = Vector(A).normalized()
    u = -(d - Z * d.dot(Z))
    u.normalize()
    e2 = Z.cross(u)
    w = wrist_off(sx, rg).to_2d().normalized()
    X = (u * w.x - e2 * w.y).normalized()
    Y = Z.cross(X)
    return Matrix((X, Y, Z)).transposed()


def solve_arm(S, P, A, sx, rg, pole):
    d = (P - S).normalized()
    for _ in range(6):
        R = hand_frame(A, d, sx, rg)
        W = P + R @ wrist_off(sx, rg)
        E, W2 = ik2(S, W, UPPER, FOREARM, pole)
        d = (W2 - E).normalized()
    if (W2 - W).length > 0.004:
        print('  arm', sx, 'short of its target by', round((W2 - W).length, 3))
    return E, W2, R


def body_joints(bulk):
    J = {'pelvis': (0, -0.005, 0.965), 'waist': (0, 0.0, 1.075), 'lchest': (0, 0.012, 1.18), 'chest': (0, 0.014, 1.29),
         'uchest': (0, 0.0, 1.395), 'neck': (0, 0.012, 1.50), 'headb': (0, 0.02, 1.57)}
    hands = {}
    for s, sx in (('R', 1), ('L', -1)):
        S = Vector((0.19 * sx, -0.005, 1.405))
        if s == 'R':
            P, A, rg, pole = rz(MOUNT + GRIP_P, TWIST), rz(GRIP_A, TWIST), GRIP_R, Vector((0.6, -0.15, -0.8))
        else:
            P, A, rg, pole = rz(MOUNT + FORE_P, TWIST), rz(Vector((0, 1, 0)), TWIST), GRIP_L, Vector((-0.35, 0.0, -0.95))
        E, W, R = solve_arm(S, P, A, sx, rg, pole)
        hands[s] = (P, R, rg)
        J['clav' + s] = (0.115 * sx, 0.0, 1.43)
        J['sh' + s] = S[:]
        J['bic' + s] = S.lerp(E, 0.45)[:]
        J['el' + s] = E[:]
        J['farm' + s] = E.lerp(W, 0.4)[:]
        J['wr' + s] = W[:]
    for s, x in (('L', -0.097), ('R', 0.097)):
        J['hip' + s] = (x, 0.0, 0.925)
        J['th' + s] = (x * 1.02, 0.008, 0.80)
        J['th2' + s] = (x * 1.03, 0.018, 0.64)
        J['kn' + s] = (x * 1.04, 0.026, 0.50)
        J['calf' + s] = (x * 1.05, -0.006, 0.37)
        J['shin' + s] = (x * 1.06, -0.004, 0.22)
        J['an' + s] = (x * 1.07, -0.01, 0.10)
    E = [('pelvis', 'waist'), ('waist', 'lchest'), ('lchest', 'chest'), ('chest', 'uchest'), ('uchest', 'neck'), ('neck', 'headb')]
    for s in 'LR':
        E += [('uchest', 'clav' + s), ('clav' + s, 'sh' + s), ('sh' + s, 'bic' + s), ('bic' + s, 'el' + s), ('el' + s, 'farm' + s), ('farm' + s, 'wr' + s),
              ('pelvis', 'hip' + s), ('hip' + s, 'th' + s), ('th' + s, 'th2' + s), ('th2' + s, 'kn' + s), ('kn' + s, 'calf' + s), ('calf' + s, 'shin' + s), ('shin' + s, 'an' + s)]
    R = {'pelvis': (0.165, 0.118), 'waist': (0.146, 0.102), 'lchest': (0.155, 0.108), 'chest': (0.17, 0.114), 'uchest': (0.158, 0.10),
         'neck': (0.054, 0.056), 'headb': (0.048, 0.048)}
    for s in 'LR':
        R.update({'clav' + s: (0.072, 0.062), 'sh' + s: (0.068, 0.068), 'bic' + s: (0.061, 0.061), 'el' + s: (0.046, 0.046),
                  'farm' + s: (0.05, 0.047), 'wr' + s: (0.035, 0.031), 'hip' + s: (0.102, 0.102), 'th' + s: (0.092, 0.09),
                  'th2' + s: (0.074, 0.074), 'kn' + s: (0.056, 0.056), 'calf' + s: (0.061, 0.061), 'shin' + s: (0.046, 0.046), 'an' + s: (0.04, 0.04)})
    R = {k: (v[0] * RS * bulk, v[1] * RS * bulk) for k, v in R.items()}
    return J, E, R, hands


BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'upperarmL', 'forearmL', 'handL', 'clavR', 'upperarmR', 'forearmR', 'handR',
         'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']


def bone_layout(J, hands):
    V = lambda k: Vector(J[k])
    B = {'pelvis': (V('pelvis'), V('waist'), None), 'spine': (V('waist'), V('lchest'), 'pelvis'), 'chest': (V('lchest'), V('uchest'), 'spine'),
         'neck': (V('uchest'), V('headb'), 'chest'), 'head': (V('headb'), V('headb') + Vector((0, 0, 0.22)), 'neck'),
         'aim': (V('uchest'), V('uchest') + rz(Vector((0, 0.12, 0)), TWIST), 'chest')}
    for s in 'LR':
        wr, el = V('wr' + s), V('el' + s)
        B['clav' + s] = (V('uchest'), V('sh' + s), 'aim')
        B['upperarm' + s] = (V('sh' + s), el, 'clav' + s)
        B['forearm' + s] = (el, wr, 'upperarm' + s)
        B['hand' + s] = (wr, wr + (hands[s][0] - wr).normalized() * 0.09, 'forearm' + s)
        B['thigh' + s] = (V('hip' + s), V('kn' + s), 'pelvis')
        B['shin' + s] = (V('kn' + s), V('an' + s), 'thigh' + s)
        B['foot' + s] = (V('an' + s), V('an' + s) + Vector((0, 0.16, -0.06)), 'shin' + s)
    return B


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


def make_body(cid, bulk):
    J, E, R, hands = body_joints(bulk)
    names = list(J)
    ix = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new(cid + '_bodysk')
    me.from_pydata([J[n] for n in names], [(ix[a], ix[b]) for a, b in E], [])
    ob = bpy.data.objects.new(cid + '_body', me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for n in names:
        v = me.skin_vertices[0].data[ix[n]]
        v.radius = R[n]
        v.use_root = (n == 'pelvis')
    ss = ob.modifiers.new('sub', 'SUBSURF')
    ss.levels = 2
    ss.render_levels = 2
    apply_mods(ob)
    return ob, J, hands


def assign_weights(ob, B):
    """Distance-based skin weights to the deform bones; returns the dominant bone of every vertex."""
    segs = {n: (B[n][0], B[n][1]) for n in BONES}
    groups = {n: ob.vertex_groups.new(name=ob.name.replace('_body', '') + '_' + n) for n in BONES}
    dom = []
    for v in ob.data.vertices:
        p = v.co
        ws = sorted(((1.0 / (seg_dist(p, *segs[n]) ** 6 + 1e-12), n) for n in BONES), reverse=True)[:3]
        tot = sum(w for w, _ in ws)
        dom.append(ws[0][1])
        for w, n in ws:
            if w / tot > 0.03:
                groups[n].add([v.index], w / tot, 'REPLACE')
    return dom


TORSO = ('pelvis', 'spine', 'chest', 'clavL', 'clavR', 'neck')


def surface(ob, dom, z, kind, labels=TORSO, x0=0.0):
    """Samples the body at height z: front y, back y (near x0) or half width."""
    vals = []
    for v, d in zip(ob.data.vertices, dom):
        if d not in labels or abs(v.co.z - z) > 0.03:
            continue
        if kind == 'front' and abs(v.co.x - x0) < 0.05:
            vals.append(v.co.y)
        elif kind == 'back' and abs(v.co.x - x0) < 0.05:
            vals.append(-v.co.y)
        elif kind == 'side':
            vals.append(abs(v.co.x))
    if not vals:
        return {'front': 0.12, 'back': -0.1, 'side': 0.17}[kind]
    m = max(vals)
    return m if kind != 'back' else -m


def top(ob, x, y=0.0):
    """Highest point of the shoulders near (x, y)."""
    return max((v.co.z for v in ob.data.vertices if abs(v.co.x - x) < 0.025 and abs(v.co.y - y) < 0.03 and v.co.z < 1.52), default=1.45)


def shell(ob, cid, name, keep, offset, m, rig, solid=0.008, zmin=-9, zmax=9, filt=None):
    """A clothing layer: a copy of the body's faces whose dominant bone is in keep (and that pass filt(centre,
    normal)), pushed out along the normals. It keeps the body's weights, so it deforms with the skeleton."""
    o = ob.copy()
    o.data = ob.data.copy()
    o.modifiers.clear()
    o.name = cid + '_' + name
    bpy.context.scene.collection.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dl = bm.verts.layers.deform.active
    names = {g.index: g.name.replace(cid + '_', '') for g in o.vertex_groups}

    def domv(v):
        best, bw = None, -1
        for gi, w in v[dl].items():
            if w > bw:
                best, bw = names[gi], w
        return best

    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        ok = zmin < c.z < zmax and sum(1 for v in f.verts if domv(v) in keep) >= 3 and (filt is None or filt(c, f.normal))
        if not ok:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    if not bm.faces:
        print('  empty shell', name)
        bm.free()
        bpy.data.objects.remove(o)
        return None
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (offset(domv(v)) if callable(offset) else offset)
    bm.to_mesh(o.data)
    bm.free()
    o.data.materials.clear()
    o.data.materials.append(m)
    for p in o.data.polygons:
        p.material_index = 0
        p.use_smooth = True
    if solid:
        md = o.modifiers.new('sd', 'SOLIDIFY')
        md.thickness = solid
        md.offset = 1
        md.use_rim = True
        apply_mods(o)
    o.parent = rig
    md = o.modifiers.new('arm', 'ARMATURE')
    md.object = rig
    return o


# ---------------------------------------------------------------- head
def head_point(x, y, z):
    """Maps a point of the unit sphere onto the sculpted head (face towards +y)."""
    if z < -0.15:
        k = min(1.0, (-z - 0.15) / 0.85)
        x *= 1 - 0.30 * k
        y *= (1 - 0.05 * k) if y > 0 else (1 - 0.30 * k)
    if y < -0.2 and z > -0.3:
        y *= 1.05
    if y > 0.55:
        y = 0.55 + (y - 0.55) * 0.7
    p = Vector((x * HEADR.x, y * HEADR.y, z * HEADR.z))
    if y > 0.2:
        fade = min(1.0, (y - 0.2) / 0.25)
        p.y += face_relief(x, z) * fade
    return p + HEADC


def face_relief(x, z):
    """Forward displacement (metres) of the facial features over the smooth head, in unit-sphere x, z."""
    g = lambda dx, dz, wx, wz: math.exp(-((dx / wx) ** 2 + (dz / wz) ** 2))
    d = 0.0
    if -0.6 < z < 0.2:                                   # nose: thin bridge growing to the tip, wider at the base
        t = min(1.0, max(0.0, (0.12 - z) / 0.48))
        h = 0.004 + 0.021 * t ** 1.5
        w = 0.07 + 0.07 * t
        if z < -0.36:
            h *= math.exp(-((z + 0.36) / 0.07) ** 2)
        d += h * math.exp(-(x / w) ** 2)
    for s in (-1, 1):
        d += 0.0055 * g(x - s * 0.15, z + 0.4, 0.07, 0.06)    # nostril wings
        d -= 0.010 * g(x - s * 0.37, z - 0.03, 0.16, 0.1)     # eye sockets
        d += 0.0065 * g(x - s * 0.56, z + 0.14, 0.16, 0.12)   # cheekbones
        d -= 0.003 * g(x - s * 0.42, z + 0.55, 0.12, 0.12)    # hollows beside the mouth
    d += 0.0065 * math.exp(-((z - 0.15) / 0.07) ** 2) * math.exp(-(x / 0.6) ** 4)   # brow ridge
    d += 0.0035 * g(x, z + 0.555, 0.2, 0.04)                 # upper lip
    d += 0.004 * g(x, z + 0.665, 0.17, 0.045)                # lower lip
    d -= 0.0022 * g(x, z + 0.61, 0.22, 0.016)                # mouth line
    d -= 0.0035 * g(x, z + 0.76, 0.24, 0.045)                # groove above the chin
    d += 0.008 * g(x, z + 0.87, 0.22, 0.09)                  # chin
    return d


def head_mesh(cid, faceM, coverM, style, extra):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)
    unit = {}
    for v in bm.verts:
        unit[v.index] = v.co.copy()
        v.co = head_point(*v.co)
    bm.normal_update()
    me = bpy.data.meshes.new(cid + '_head')
    bm.to_mesh(me)
    bm.free()
    mats = [faceM, coverM, extra.get('stubble') or faceM, extra.get('lips') or faceM]
    o = _link(cid + '_headm', me, mats, None, smooth=True, sharp=0)
    paint_face(o, unit, 'stubble' in extra)
    for p in me.polygons:
        u = Vector((0, 0, 0))
        for vi in p.vertices:
            u += unit[vi]
        u /= len(p.vertices)
        ux, uy, uz = u
        covered = False
        lon, lat = math.degrees(math.atan2(ux, uy)), math.degrees(math.asin(max(-1.0, min(1.0, uz))))
        if style == 'balaclava':
            covered = not (abs(lon) < 40 and -8 < lat < 14)
        elif style == 'diver':
            covered = not (abs(lon) < 44 and -50 < lat < 17)
        if covered:
            p.material_index = 1
    return o


def col_attr(o):
    """The colour attribute that is exported as vertex colour (white = unchanged material colour)."""
    me = o.data
    ca = me.color_attributes.get('Col')
    if ca is None:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for d in ca.data:
            d.color = (1.0, 1.0, 1.0, 1.0)
    me.color_attributes.active_color = ca
    return ca


def paint_face(o, unit, beard):
    """Soft skin shading on the head: lips, a little colour on cheeks and nose, darker eye sockets and stubble."""
    g = lambda dx, dz, wx, wz: math.exp(-((dx / wx) ** 2 + (dz / wz) ** 2))
    ca = col_attr(o)
    for v in o.data.vertices:
        x, y, z = unit[v.index]
        r = gg = b = 1.0
        front = max(0.0, min(1.0, (y + 0.1) / 0.4))
        lip = (g(x, z + 0.555, 0.2, 0.045) + g(x, z + 0.665, 0.17, 0.05)) * front
        r *= 1 - 0.08 * lip; gg *= 1 - 0.3 * lip; b *= 1 - 0.27 * lip
        warm = (g(abs(x) - 0.5, z + 0.3, 0.2, 0.18) * 0.6 + g(x, z + 0.25, 0.1, 0.15) * 0.5) * front
        gg *= 1 - 0.06 * warm; b *= 1 - 0.08 * warm
        sock = g(abs(x) - 0.37, z - 0.05, 0.17, 0.11) * front
        r *= 1 - 0.14 * sock; gg *= 1 - 0.16 * sock; b *= 1 - 0.15 * sock
        if beard:
            jaw = max(0.0, min(1.0, (-0.22 - z) / 0.2)) * max(0.0, min(1.0, (y + 0.55) / 0.3))
            jaw *= 1 - 0.85 * lip / max(1.0, lip)
            jaw = max(jaw, 0.7 * g(x, z + 0.48, 0.3, 0.06) * front)
            k = 1 - 0.3 * jaw
            r *= k; gg *= k * 0.985; b *= k * 0.98
        ca.data[v.index].color = (r, gg, b, 1.0)


def face_parts(cid, M, faceVisible):
    out = []
    white = mat('ch_eyewhite', 0xe0dcd2, 0, 0.25)
    iris = mat('ch_iris', 0x2a1c12, 0, 0.15)
    for s in (-1, 1):
        ux, uz = s * 0.38, 0.02
        c = head_point(ux, math.sqrt(max(0.0, 1 - ux * ux - uz * uz)), uz)
        e = ellipsoid(f'{cid}_eye{s}', (0.0115, 0.008, 0.0072), c - Vector((0, 0.0045, 0)), white, seg=14, rings=8)
        i = ellipsoid(f'{cid}_iris{s}', (0.0052, 0.002, 0.0052), c + Vector((0, 0.0028, 0.0003)), iris, seg=10, rings=6)
        out += [e, i]
        if faceVisible:
            pts = []
            for k in range(4):
                bx = s * (0.20 + k * 0.13)
                bz = 0.17 + 0.05 * math.sin(k / 3 * math.pi) - 0.02 * k / 3
                pts.append(head_point(bx, math.sqrt(max(0.0, 1 - bx * bx - bz * bz)), bz) + Vector((0, 0.0015, 0)))
            out.append(tube(f'{cid}_brow{s}', pts, 0.0035, M['brow'], sides=6, radii=[0.0032, 0.0042, 0.0038, 0.0026]))
        ear = head_point(s * 1.0, -0.12, -0.12) + Vector((s * -0.006, 0, 0))
        e1 = ellipsoid(f'{cid}_ear{s}', (0.009, 0.021, 0.031), ear, M['skin'], seg=14, rings=8)
        e1.rotation_euler = (0, s * 0.15, s * 0.25)
        out.append(e1)
    return out


def cut_shell(name, radii, center, m, keep, thick=0.012, seg=36, rings=20):
    """Part of an ellipsoid (keep(ux,uy,uz) decides per vertex on the unit sphere), thickened."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(*v.co)], context='VERTS')
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + Vector(center)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(name, me, m, None, smooth=True, sharp=0)
    if thick:
        solidify(o, thick, 1)
        shade(o, 1.2)
    return o


def band(name, cx, cy, a, b, z0, z1, t, m, segs=32):
    """Elliptical belt-like band around (cx, cy) between heights z0 and z1, thickness t."""
    bm = bmesh.new()
    rings = []
    for z in (z0, z1):
        for rr in (0, t):
            rings.append([bm.verts.new((cx + (a + rr) * math.cos(k / segs * math.tau), cy + (b + rr) * math.sin(k / segs * math.tau), z)) for k in range(segs)])
    inner0, outer0, inner1, outer1 = rings
    for k in range(segs):
        k2 = (k + 1) % segs
        bm.faces.new((outer0[k], outer0[k2], outer1[k2], outer1[k]))
        bm.faces.new((inner0[k2], inner0[k], inner1[k], inner1[k2]))
        bm.faces.new((outer1[k], outer1[k2], inner1[k2], inner1[k]))
        bm.faces.new((inner0[k], inner0[k2], outer0[k2], outer0[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return _link(name, me, m, None, smooth=True, sharp=0.9)


def ring_at(ob, dom, z, labels):
    """Centre and half extents of the body cross-section at height z (for collars and belts)."""
    for tol in (0.012, 0.02, 0.03, 0.05):
        pts = [v.co for v, d in zip(ob.data.vertices, dom) if d in labels and abs(v.co.z - z) < tol]
        if len(pts) >= 6:
            break
    xs, ys = [p.x for p in pts], [p.y for p in pts]
    return (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def fist(name, glove, knuckle=None, palm='R', rg=GRIP_R, thumb='wrap'):
    """A gloved hand closed round a grip of radius rg whose axis is local Z through the origin.
    The palm is on +X (right hand) or -X (left hand), the fingers wrap round the front (+Y), the wrist is
    at wrist_off().  thumb='wrap' crosses over the grip (pistol grip), 'along' lies along it (handguard)."""
    sx = 1 if palm == 'R' else -1
    parts = [rbox(name + '_palm', (0.03, 0.088, 0.084), (sx * (rg + 0.015), -0.018, -0.002), glove, r=0.012, seg=3)]
    for i, (zf, rf) in enumerate(((0.029, 0.0098), (0.009, 0.0104), (-0.011, 0.01), (-0.029, 0.0088))):
        R0 = rg + rf * 0.95
        arc = (0.098 - 0.012 * abs(i - 1.3)) / R0
        pts = []
        for k in range(7):
            a = math.radians(-22) + arc * k / 6
            pts.append(Vector((sx * R0 * math.cos(a), R0 * math.sin(a), zf)))
        parts.append(tube(f'{name}_f{i}', pts, rf, glove, sides=8, radii=[rf * (1.08 - 0.22 * k / 6) for k in range(7)]))
        if knuckle is not None:
            kp = pts[2]
            parts.append(rbox(f'{name}_kn{i}', (0.012, 0.014, 0.016), Vector((kp.x * (1 + 0.012 / R0), kp.y * (1 + 0.012 / R0), kp.z)), knuckle, r=0.004, seg=1))
    if thumb == 'wrap':
        th = [(sx * (rg + 0.012), -0.034, 0.03), (sx * (rg * 0.6), -0.006, 0.046), (sx * (-rg * 0.2), 0.02, 0.045), (sx * (-rg * 0.65), 0.03, 0.037)]
    else:
        th = [(sx * (rg + 0.01), -0.036, 0.0), (sx * (rg * 0.55), -(rg + 0.008), 0.024), (sx * (rg * 0.1), -(rg + 0.011), 0.05), (sx * (-rg * 0.15), -(rg + 0.009), 0.072)]
    parts.append(tube(name + '_thumb', [Vector(p) for p in th], 0.0105, glove, sides=8, radii=[0.0125, 0.0115, 0.0105, 0.0088]))
    w = wrist_off(sx, rg)
    parts.append(tube(name + '_cuff', [w + Vector((0, 0.016, 0.002)), w + Vector((sx * 0.004, -0.03, -0.012))], 0.031, glove, sides=14))
    return join(parts, name)


def boot(name, M, x, an):
    pts = [(-0.068, 0.0), (0.16, 0.0), (0.195, 0.012), (0.21, 0.036), (0.198, 0.066), (0.13, 0.086), (0.065, 0.102), (0.048, 0.2),
           (-0.046, 0.212), (-0.072, 0.13), (-0.078, 0.04)]
    up = profile(name + '_upper', [(an[1] + p[0], p[1]) for p in pts], 0.106, M['boot'], x=x, bev=0.02, seg=3)
    sole = profile(name + '_sole', [(an[1] - 0.08, -0.005), (an[1] + 0.214, -0.005), (an[1] + 0.222, 0.022), (an[1] - 0.082, 0.022)], 0.114,
                   mat('ch_sole', 0x1a1715, 0, 0.9), x=x, bev=0.008, seg=2)
    toe = ellipsoid(name + '_toe', (0.05, 0.05, 0.04), (x, an[1] + 0.165, 0.035), mat('ch_sole', 0x1a1715, 0, 0.9), seg=14, rings=8, cut=-0.15)
    laces = [rbox(f'{name}_lace{i}', (0.05, 0.008, 0.006), (x, an[1] + 0.056 + i * 0.011, 0.112 + i * 0.022), M['belt'], r=0.002, seg=1, rot=(0.55, 0, 0)) for i in range(4)]
    return join([up, sole, toe] + laces, name)


def bake_twist(cid, rig, skinned):
    """Turns the shoulders TWIST to the right (head counter-turned) and makes that the rest pose."""
    tot = {'pelvis': 0.0, 'spine': -0.45, 'chest': -1.0, 'neck': -0.5, 'head': 0.0}
    par = {'spine': 'pelvis', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
    bpy.context.view_layer.objects.active = rig
    for bn in ('spine', 'chest', 'neck', 'head'):
        pb = rig.pose.bones[cid + '_' + bn]
        ax = pb.bone.matrix_local.to_3x3().inverted() @ Vector((0, 0, 1))
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion(ax, (tot[bn] - tot[par[bn]]) * TWIST)
    bpy.context.view_layer.update()
    rigid = [(o, o.matrix_world.copy()) for o in bpy.data.objects if o.parent == rig and o.parent_type == 'BONE']
    for o in skinned:
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
            bpy.ops.object.modifier_apply(modifier='arm')
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    for o, mw in rigid:
        o.matrix_world = mw
    for o in skinned:
        md = o.modifiers.new('arm', 'ARMATURE')
        md.object = rig


def build_character(cid):
    A = AGENTS[cid]
    L, team, hg, torso, ex, pat = A['L'], A['team'], A['head'], A['torso'], A['extras'], A.get('pat', {})
    M = {k: mat(f'{cid}_{k}' + ('_' + pat[k] if k in pat else ''), v, rough=0.85) for k, v in L.items() if k != 'skin'}
    M['skin'] = mat(f'{cid}_skin', L['skin'], 0, 0.5)
    M['brow'] = mat('ch_brow', 0x2a2018, 0, 0.8)
    sk = L['skin']
    dark = lambda c, f: (int(((c >> 16) & 255) * f) << 16) | (int(((c >> 8) & 255) * f) << 8) | int((c & 255) * f)
    faceX = {'lips': mat(f'{cid}_lips_skin', (dark(sk, 0.82) & 0xff0000) | (dark(sk, 0.66) & 0x00ff00) | (dark(sk, 0.66) & 0xff), 0, 0.45)}
    if 'beard' in ex:
        faceX['stubble'] = mat(f'{cid}_stubble_skin', dark(sk, 0.72), 0, 0.7)
    neckM = M['skin'] if hg in ('helmet', 'cap', 'visor', 'gasmask') else M['head']
    bulk = 1.07 if torso == 'heavy' else 0.96 if torso == 'wetsuit' else 1.0
    root = empty(f'{cid}_char', (0, 0, 0))
    body, J, hands = make_body(cid, bulk)
    B = bone_layout(J, hands)
    # armature
    arm = bpy.data.armatures.new(cid + '_arm')
    rig = bpy.data.objects.new(cid + '_rig', arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n in ['pelvis', 'spine', 'chest', 'neck', 'head', 'aim', 'clavL', 'upperarmL', 'forearmL', 'handL', 'clavR', 'upperarmR', 'forearmR', 'handR',
              'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']:
        h, t, par = B[n]
        b = arm.edit_bones.new(cid + '_' + n)
        b.head, b.tail = h, t
        b.use_deform = n != 'aim'
        if par:
            b.parent = eb[par]
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.parent = root
    dom = assign_weights(body, B)
    # body materials by region, with clean seams: collar line, belt line and sleeve rings
    rolled = 'rolled' in ex
    regM = {'pants': M['pants'], 'shirt': M['shirt'], 'sleeve': M['sleeve'], 'neck': neckM, 'skin': M['skin']}
    order = ['pants', 'shirt', 'sleeve', 'neck', 'skin']
    body.data.materials.clear()
    for k in order:
        body.data.materials.append(regM[k])

    def region(c, d):
        if d in ('neck', 'head') or c.z > 1.43:
            zc = 1.484 - 0.018 * max(-1.0, min(1.0, c.y / 0.07)) + 0.35 * max(0.0, abs(c.x) - 0.06)
            if c.z > zc:
                return 'neck'
        for s in 'LR':
            if d in ('upperarm' + s, 'forearm' + s, 'hand' + s):
                S, El, W = Vector(J['sh' + s]), Vector(J['el' + s]), Vector(J['wr' + s])
                if d == 'upperarm' + s and (c - S).dot(El - S) / (El - S).length_squared < 0.16:
                    return 'shirt'
                if rolled and d != 'upperarm' + s and (c - El).dot(W - El) / (W - El).length_squared > 0.28:
                    return 'skin'
                return 'sleeve'
        return 'pants' if c.z < 1.045 else 'shirt'

    for p in body.data.polygons:
        votes = {}
        for vi in p.vertices:
            votes[dom[vi]] = votes.get(dom[vi], 0) + 1
        p.material_index = order.index(region(p.center, max(votes, key=votes.get)))
        p.use_smooth = True
    body.parent = rig
    md = body.modifiers.new('arm', 'ARMATURE')
    md.object = rig
    skinned = [body]
    on = {n: [] for n in BONES + ['aim']}
    front = lambda z, x0=0.0: surface(body, dom, z, 'front', x0=x0)
    back = lambda z, x0=0.0: surface(body, dom, z, 'back', x0=x0)
    side = lambda z: surface(body, dom, z, 'side')

    # clothing layers that follow the body
    if torso in ('vest', 'heavy'):
        skinned.append(shell(body, cid, 'softvest', ('spine', 'chest'), 0.022 if torso == 'vest' else 0.03, M['vest'], rig, 0.01, zmin=1.06, zmax=1.45))
    if torso == 'jacket':
        skinned.append(shell(body, cid, 'jacket', ('pelvis', 'spine', 'chest', 'clavL', 'clavR', 'upperarmL', 'upperarmR', 'forearmL', 'forearmR'),
                             lambda d: 0.006 if d.startswith(('upperarm', 'forearm')) else 0.011, M['vest'], rig, 0.006,
                             zmin=0.975, zmax=1.47, filt=lambda c, n: not (c.z > 1.42 and abs(c.x) < 0.09)))
    if torso != 'wetsuit':
        for s, sd in (('L', -1), ('R', 1)):
            kn = Vector(J['kn' + s])
            skinned.append(shell(body, cid, 'kneepad' + s, ('thigh' + s, 'shin' + s), 0.014, M['pouch'] if torso != 'heavy' else M['vest'], rig, 0.012,
                                 filt=lambda c, n, kn=kn: n.y > 0.3 and abs(c.z - kn.z + 0.005) < 0.06 and abs(c.x - kn.x) < 0.07))
            if torso in ('vest', 'jacket'):
                skinned.append(shell(body, cid, 'cargo' + s, ('thigh' + s,), 0.01, M['pants'], rig, 0.008,
                                     filt=lambda c, n, sd=sd: n.x * sd > 0.5 and abs(c.z - 0.655) < 0.07 and abs(c.y - 0.005) < 0.065))
                skinned.append(shell(body, cid, 'cargoflap' + s, ('thigh' + s,), 0.019, M['pants'], rig, 0.004,
                                     filt=lambda c, n, sd=sd: n.x * sd > 0.5 and abs(c.z - 0.725) < 0.024 and abs(c.y - 0.005) < 0.07))

    # head and face
    head = head_mesh(cid, M['skin'], M['head'] if hg in ('balaclava', 'diver') else M['skin'], hg, faceX)
    on['head'] += [head] + face_parts(cid, M, hg in ('helmet', 'cap', 'visor'))
    hc = HEADC
    hair = mat('ch_hair', 0x2e241a, 0, 0.9)
    if hg in ('helmet', 'visor'):
        on['head'].append(cut_shell(cid + '_hair', (0.0835, 0.1015, 0.1155), (0, hc.y - 0.003, hc.z + 0.002), hair,
                                    lambda x, y, z: y < 0.32 and z > -0.3 + 0.25 * max(0.0, y) and not (abs(x) > 0.9 and z < 0.0), 0.003))
    if hg == 'helmet':
        on['head'].append(cut_shell(cid + '_helmet', (0.1, 0.118, 0.11), (0, hc.y - 0.006, hc.z + 0.02), M['helmet'],
                                    lambda x, y, z: z > -0.24 + 0.36 * max(0.0, y) - 0.06 * max(0.0, -y), 0.012))
        for s in (-1, 1):
            on['head'].append(rbox(f'{cid}_hrail{s}', (0.012, 0.09, 0.018), (s * 0.102, hc.y - 0.01, hc.z + 0.008), M['belt'], r=0.003, seg=1))
            on['head'].append(tube(f'{cid}_strap{s}', [(s * 0.086, hc.y - 0.012, hc.z - 0.008), (s * 0.077, hc.y + 0.018, hc.z - 0.07),
                                                        (s * 0.042, hc.y + 0.05, hc.z - 0.108), (0, hc.y + 0.056, hc.z - 0.116)], 0.005, M['belt'], sides=6))
        on['head'].append(rbox(cid + '_nvgmount', (0.05, 0.03, 0.04), (0, hc.y + 0.118, hc.z + 0.07), M['belt'], r=0.006, seg=2))
        gog = mat('ch_goggle', 0x14181c, 0.5, 0.12)
        on['head'].append(band(cid + '_gogband', 0, hc.y - 0.004, 0.102, 0.121, hc.z + 0.06, hc.z + 0.078, 0.005, M['belt']))
        on['head'].append(rbox(cid + '_goggles', (0.12, 0.03, 0.04), (0, hc.y + 0.112, hc.z + 0.074), gog, r=0.012, seg=3, rot=(-0.3, 0, 0)))
        on['head'].append(rbox(cid + '_hcover', (0.03, 0.05, 0.03), (0, hc.y - 0.11, hc.z + 0.05), M['pouch'], r=0.008, seg=2))
    elif hg == 'visor':
        on['head'].append(cut_shell(cid + '_helmet', (0.106, 0.124, 0.118), (0, hc.y - 0.008, hc.z + 0.02), M['helmet'],
                                    lambda x, y, z: z > -0.42 and not (y > 0.35 and z < 0.32 and abs(x) < 0.82), 0.014))
        on['head'].append(cut_shell(cid + '_visor', (0.118, 0.135, 0.13), (0, hc.y - 0.0, hc.z + 0.0), mat('g_visor', 0x1a2a3a, 0.5, 0.05, 0.55),
                                    lambda x, y, z: y > 0.3 and -0.75 < z < 0.36 and abs(x) < 0.85, 0.004))
        if 'accent' in L:
            on['head'].append(rbox(cid + '_hstripe', (0.02, 0.2, 0.006), (0, hc.y - 0.01, hc.z + 0.14), mat(f'{cid}_acc', L['accent'], rough=0.5), r=0.002, seg=1))
    elif hg == 'cap':
        on['head'].append(cut_shell(cid + '_cap', (0.089, 0.107, 0.082), (0, hc.y - 0.004, hc.z + 0.036), M['helmet'], lambda x, y, z: z > 0.0, 0.006))
        on['head'].append(profile(cid + '_brim', [(-0.06, hc.y + 0.075), (0.06, hc.y + 0.075), (0.052, hc.y + 0.13), (0.0, hc.y + 0.148), (-0.052, hc.y + 0.13)], 0.007, M['helmet'],
                                  x=hc.z + 0.04, axis='Z', bev=0.003, seg=1))
        on['head'].append(cut_shell(cid + '_hair', (0.0845, 0.1025, 0.115), (0, hc.y - 0.006, hc.z + 0.003), hair,
                                    lambda x, y, z: y < 0.25 and z > -0.32 + 0.2 * max(0.0, y), 0.004))
        on['head'].append(rbox(cid + '_shades', (0.124, 0.012, 0.024), (0, hc.y + 0.094, hc.z + 0.004), mat('ch_shades', 0x101418, 0.6, 0.08), r=0.008, seg=2))
        for s in (-1, 1):
            on['head'].append(tube(f'{cid}_shadearm{s}', [(s * 0.061, hc.y + 0.088, hc.z + 0.01), (s * 0.084, hc.y + 0.02, hc.z + 0.008), (s * 0.082, hc.y - 0.02, hc.z - 0.01)],
                                   0.0025, mat('ch_shades', 0x101418, 0.6, 0.08), sides=5))
    elif hg == 'hood':
        on['head'].append(cut_shell(cid + '_hood', (0.104, 0.122, 0.13), (0, hc.y - 0.012, hc.z + 0.012), M['vest'],
                                    lambda x, y, z: not (y > 0.42 and abs(x) < 0.72 and -0.5 < z < 0.5), 0.01))
        gog = mat('ch_goggle', 0x14181c, 0.5, 0.12)
        on['head'].append(rbox(cid + '_goggles', (0.115, 0.03, 0.034), (0, hc.y + 0.09, hc.z + 0.004), gog, r=0.012, seg=3))
        on['head'].append(band(cid + '_gogband2', 0, hc.y - 0.006, 0.106, 0.124, hc.z - 0.006, hc.z + 0.012, 0.004, M['belt']))
    elif hg == 'gasmask':
        mk = M['vest']
        on['head'].append(cut_shell(cid + '_mask', (0.092, 0.108, 0.118), (0, hc.y + 0.006, hc.z - 0.004), mk,
                                    lambda x, y, z: y > 0.05 and z < 0.42, 0.012))
        lensM = mat('ch_lens', 0x1a2228, 0.6, 0.06)
        for s in (-1, 1):
            on['head'].append(lathe(f'{cid}_lensring{s}', [(0.0, 0.0), (0.019, 0.0), (0.021, 0.006), (0.019, 0.012), (0.0, 0.012)], M['belt'], segs=20,
                                    loc=(s * 0.032, hc.y + 0.085, hc.z + 0.014)))
            on['head'].append(lathe(f'{cid}_lens{s}', [(0.0, 0.0), (0.016, 0.0), (0.0, 0.002)], lensM, segs=20, loc=(s * 0.032, hc.y + 0.097, hc.z + 0.014)))
        on['head'].append(lathe(cid + '_filter', [(0.0, 0.0), (0.026, 0.0), (0.03, 0.01), (0.03, 0.045), (0.026, 0.05), (0.012, 0.055), (0.0, 0.055)],
                                mat('g_filter', 0x2a2b2c, 0.3, 0.6), segs=20, loc=(0, hc.y + 0.1, hc.z - 0.055)))
        on['head'].append(cut_shell(cid + '_beanie', (0.088, 0.104, 0.1), (0, hc.y - 0.006, hc.z + 0.03), M['head'], lambda x, y, z: z > 0.05, 0.01))
        on['head'].append(band(cid + '_mstrap', 0, hc.y - 0.01, 0.086, 0.106, hc.z - 0.004, hc.z + 0.014, 0.004, M['belt']))
    elif hg == 'diver':
        on['head'].append(rbox(cid + '_maskglass', (0.105, 0.03, 0.06), (0, hc.y + 0.097, hc.z + 0.016), mat('ch_lens', 0x1a2228, 0.6, 0.06), r=0.014, seg=3))
        on['head'].append(rbox(cid + '_maskframe', (0.118, 0.022, 0.072), (0, hc.y + 0.088, hc.z + 0.016), mat(f'{cid}_acc', L['accent'], rough=0.5), r=0.016, seg=3))
        on['head'].append(band(cid + '_maskstrap', 0, hc.y - 0.006, 0.085, 0.104, hc.z + 0.008, hc.z + 0.026, 0.004, M['pouch']))
        on['head'].append(rbox(cid + '_reg', (0.04, 0.03, 0.03), (0, hc.y + 0.09, hc.z - 0.06), M['pouch'], r=0.01, seg=2))
    if 'shemagh' in ex:
        cx, cy, a, b = ring_at(body, dom, 1.49, ('neck', 'chest'))
        on['neck'].append(band(cid + '_scarf', cx, cy, a + 0.008, b + 0.008, 1.455, 1.535, 0.014, M['scarf']))
        on['chest'].append(cut_shell(cid + '_scarfdrape', (a + 0.04, b + 0.03, 0.09), (cx, cy + 0.01, 1.45), M['scarf'],
                                     lambda x, y, z: y > 0.2 and z < 0.0 and abs(x) < 0.75, 0.01))
        if hg == 'hood':
            on['head'].append(cut_shell(cid + '_facecloth', (0.09, 0.106, 0.12), (0, hc.y + 0.008, hc.z - 0.004), M['scarf'],
                                        lambda x, y, z: y > 0.0 and z < -0.12, 0.008))
    elif torso == 'vest':
        cx, cy, a, b = ring_at(body, dom, 1.484, ('neck', 'chest'))
        col = band(cid + '_collar', 0, 0, a + 0.006, b + 0.007, -0.014, 0.012, 0.008, M['shirt'])
        col.location = (cx, cy, 1.484)
        col.rotation_euler = (-0.24, 0, 0)
        on['chest'].append(col)

    # torso gear
    zc = 1.27
    if torso == 'vest':
        fy, by = front(zc), back(zc)
        on['chest'].append(rbox(cid + '_plateF', (0.29, 0.04, 0.29), (0, fy + 0.04, zc), M['vest'], r=0.02, seg=3, rot=(0.06, 0, 0)))
        on['chest'].append(rbox(cid + '_plateB', (0.3, 0.035, 0.31), (0, by - 0.035, zc + 0.01), M['vest'], r=0.02, seg=3))
        for i, x in enumerate((-0.085, 0.0, 0.085)):
            on['chest'].append(rbox(f'{cid}_mag{i}', (0.07, 0.05, 0.12), (x, fy + 0.085, zc - 0.07), M['pouch'], r=0.008, seg=2))
            on['chest'].append(rbox(f'{cid}_flap{i}', (0.074, 0.054, 0.028), (x, fy + 0.087, zc - 0.005), M['pouch'], r=0.006, seg=2))
            on['chest'].append(rbox(f'{cid}_magtop{i}', (0.05, 0.03, 0.02), (x, fy + 0.083, zc + 0.012), mat('g_metal', 0x2c2f33, 0.8, 0.45), r=0.004, seg=1))
        for i in range(3):
            on['chest'].append(rbox(f'{cid}_molle{i}', (0.27, 0.006, 0.012), (0, fy + 0.062, zc + 0.11 - i * 0.03), M['belt'], r=0.002, seg=1))
        for s in (-1, 1):
            tz = top(body, s * 0.12)
            on['chest'].append(tube(f'{cid}_pstrap{s}', [(s * 0.1, fy + 0.03, zc + 0.14), (s * 0.115, 0.05, tz + 0.006), (s * 0.115, -0.03, tz + 0.006), (s * 0.1, by - 0.02, zc + 0.15)],
                                    0.016, M['vest'], sides=6))
        on['chest'].append(rbox(cid + '_radio', (0.06, 0.04, 0.11), (0.17, back(1.24) + 0.12, 1.24), M['belt'], r=0.008, seg=2))
        on['chest'].append(tube(cid + '_ant', [(0.18, back(1.24) + 0.12, 1.29), (0.19, back(1.24) + 0.1, 1.46)], 0.004, M['belt'], sides=6))
    elif torso == 'heavy':
        fy, by = front(zc), back(zc)
        on['chest'].append(rbox(cid + '_plateF', (0.38, 0.07, 0.36), (0, fy + 0.05, zc), M['vest'], r=0.035, seg=4, rot=(0.05, 0, 0)))
        on['chest'].append(rbox(cid + '_plateF2', (0.3, 0.02, 0.22), (0, fy + 0.09, zc + 0.02), M['pouch'], r=0.01, seg=2, rot=(0.05, 0, 0)))
        on['chest'].append(rbox(cid + '_plateB', (0.38, 0.06, 0.38), (0, by - 0.045, zc + 0.01), M['vest'], r=0.035, seg=4))
        cx, cy, a, b = ring_at(body, dom, 1.46, ('neck', 'chest'))
        on['chest'].append(band(cid + '_collar', cx, cy, a + 0.02, b + 0.02, 1.42, 1.5, 0.022, M['vest']))
        on['pelvis'].append(rbox(cid + '_groin', (0.2, 0.04, 0.16), (0, front(1.05) + 0.04, 0.95), M['vest'], r=0.02, seg=3))
        if 'accent' in L:
            on['chest'].append(rbox(cid + '_stripe', (0.36, 0.01, 0.025), (0, fy + 0.1, zc + 0.1), mat(f'{cid}_acc', L['accent'], rough=0.5), r=0.003, seg=1, rot=(0.05, 0, 0)))
        for s, sd in (('L', -1), ('R', 1)):
            skinned.append(shell(body, cid, 'thplate' + s, ('thigh' + s,), 0.02, M['vest'], rig, 0.012,
                                 filt=lambda c, n: n.y > 0.2 and 0.6 < c.z < 0.84))
            skinned.append(shell(body, cid, 'shguard' + s, ('shin' + s,), 0.018, M['vest'], rig, 0.012,
                                 filt=lambda c, n: n.y > 0.1 and 0.16 < c.z < 0.43))
    elif torso == 'wetsuit':
        fy = front(1.2)
        for s in (-1, 1):
            on['chest'].append(tube(f'{cid}_harness{s}', [(s * 0.11, fy + 0.012, 1.4), (0, fy + 0.02, 1.22), (-s * 0.12, fy + 0.012, 1.06)], 0.011, M['belt'], sides=6))
        on['chest'].append(rbox(cid + '_rigbox', (0.16, 0.05, 0.11), (0, fy + 0.04, 1.2), M['pouch'], r=0.012, seg=2))
        skinned.append(shell(body, cid, 'wetpanel', ('spine', 'chest', 'pelvis'), 0.004, M['vest'], rig, 0.003,
                             filt=lambda c, n: abs(n.x) > 0.6 and 1.0 < c.z < 1.4))
    elif torso == 'jacket':
        fy = front(1.2)
        on['chest'].append(rbox(cid + '_zip', (0.012, 0.012, 0.36), (0, fy + 0.02, 1.21), M['belt'], r=0.003, seg=1))
        for s in (-1, 1):
            on['spine'].append(rbox(f'{cid}_pocket{s}', (0.1, 0.03, 0.1), (s * 0.09, front(1.1, s * 0.09) + 0.02, 1.1), M['pouch'], r=0.01, seg=2))
            on['chest'].append(rbox(f'{cid}_chpocket{s}', (0.09, 0.022, 0.1), (s * 0.085, front(1.32, s * 0.085) + 0.014, 1.32), M['vest'], r=0.01, seg=2))
        cx, cy, a, b = ring_at(body, dom, 1.47, ('neck', 'chest'))
        on['chest'].append(band(cid + '_jcollar', cx, cy, a + 0.012, b + 0.012, 1.44, 1.51, 0.012, M['vest']))
    if 'bandolier' in ex:
        fy = front(1.22)
        on['chest'].append(tube(cid + '_bandolier', [(-0.17, fy + 0.03, 1.42), (0, fy + 0.05, 1.22), (0.17, fy + 0.03, 1.02)], 0.022, M['belt'], sides=8))
        for i in range(6):
            t = i / 5
            p = Vector((-0.15 + 0.3 * t, fy + 0.07 - 0.02 * abs(t - 0.5), 1.4 - 0.36 * t))
            on['chest'].append(rbox(f'{cid}_shell{i}', (0.02, 0.025, 0.05), p, mat('g_brass', 0xb08a3a, 0.8, 0.3), r=0.005, seg=1, rot=(0, 0.8, 0)))
    if rolled:
        for s in 'LR':
            El, W = Vector(J['el' + s]), Vector(J['wr' + s])
            p = El.lerp(W, 0.24)
            tr = torus(f'{cid}_roll{s}', 0.05 * RS * 0.82, 0.012, p, M['sleeve'], major=20, minor=8)
            tr.rotation_mode = 'QUATERNION'
            tr.rotation_quaternion = (W - El).normalized().to_track_quat('Z', 'Y')
            on['forearm' + s].append(tr)
    if 'patch' in ex:
        S, El = Vector(J['shR']), Vector(J['elR'])
        p = S.lerp(El, 0.3)
        on['upperarmR'].append(rbox(cid + '_patch', (0.012, 0.06, 0.05), p + Vector((0.072 if torso != 'heavy' else 0.08, 0, 0)), mat('patch', 0x5aa7ff, rough=0.5), r=0.004, seg=1))
    if 'pack' in ex:
        by = back(1.25)
        if team == 'S':
            on['chest'].append(rbox(cid + '_pack', (0.3, 0.15, 0.36), (0, by - 0.11, 1.25), M['pack'], r=0.04, seg=3))
            on['chest'].append(rbox(cid + '_packfront', (0.24, 0.05, 0.16), (0, by - 0.205, 1.2), M['pouch'], r=0.02, seg=2))
            on['chest'].append(lathe(cid + '_roll', [(0.0, -0.17), (0.055, -0.17), (0.06, -0.16), (0.06, 0.16), (0.055, 0.17), (0.0, 0.17)], M['pouch'], segs=16, loc=(0, by - 0.1, 1.47), axis='X'))
            for s in (-1, 1):
                on['chest'].append(rbox(f'{cid}_packside{s}', (0.04, 0.1, 0.18), (s * 0.165, by - 0.1, 1.2), M['pouch'], r=0.012, seg=2))
                on['chest'].append(rbox(f'{cid}_packstrap{s}', (0.03, 0.16, 0.012), (s * 0.08, by - 0.11, 1.36), M['belt'], r=0.003, seg=1))
        else:
            on['chest'].append(rbox(cid + '_pack', (0.26, 0.1, 0.3), (0, by - 0.08, 1.27), M['pack'], r=0.03, seg=3))
            on['chest'].append(rbox(cid + '_packfront', (0.2, 0.04, 0.14), (0, by - 0.145, 1.22), M['pouch'], r=0.015, seg=2))
    if 'tank' in ex:
        by = back(1.22)
        for s in (-1, 1):
            on['chest'].append(lathe(f'{cid}_tank{s}', [(0.0, 0.0), (0.06, 0.0), (0.07, 0.03), (0.07, 0.4), (0.06, 0.45), (0.02, 0.48), (0.0, 0.48)], M['pack'], segs=20,
                                     loc=(s * 0.075, by - 0.08, 1.0), axis='Z'))
        on['chest'].append(rbox(cid + '_valve', (0.2, 0.03, 0.03), (0, by - 0.08, 1.49), mat('ch_metal', 0x8a8a84, 0.8, 0.35), r=0.008, seg=2))
        hz = HEADC.z - 0.06
        on['head'].append(tube(cid + '_hose', [(0.025, HEADC.y + 0.09, hz), (0.065, HEADC.y + 0.08, hz - 0.015), (0.095, HEADC.y + 0.03, hz - 0.04),
                                               (0.105, -0.02, 1.53), (0.1, -0.07, 1.5)], 0.008, mat(f'{cid}_acc', L['accent'], rough=0.5), sides=8))
    if 'pads' in ex:
        for s, sd in (('L', -1), ('R', 1)):
            sh = Vector(J['sh' + s])
            pad = cut_shell(f'{cid}_pad{s}', (0.1, 0.1, 0.085), (sh.x + sd * 0.02, sh.y, sh.z + 0.005), M['vest'], lambda x, y, z, sd=sd: z > -0.15 and x * sd > -0.45, 0.012)
            on['upperarm' + s].append(pad)

    # belt, holster, gloves, boots
    cx, cy, a, b = ring_at(body, dom, 1.05, ('pelvis', 'spine'))
    if torso != 'wetsuit':
        on['pelvis'].append(band(cid + '_belt', cx, cy, a + 0.006, b + 0.006, 1.03, 1.07, 0.012, M['belt']))
        on['pelvis'].append(rbox(cid + '_buckle', (0.05, 0.012, 0.036), (0, cy + b + 0.02, 1.05), mat('ch_metal', 0x6a6a64, 0.8, 0.4), r=0.004, seg=1))
        for s in (-1, 1):
            on['pelvis'].append(rbox(f'{cid}_bpouch{s}', (0.05, 0.08, 0.08), (s * (a + 0.03), cy + 0.02, 1.0), M['pouch'], r=0.008, seg=2))
    else:
        on['pelvis'].append(band(cid + '_wbelt', cx, cy, a + 0.006, b + 0.006, 1.02, 1.06, 0.014, M['belt']))
        on['shinL'].append(rbox(cid + '_knife', (0.03, 0.03, 0.17), (-0.15, 0.03, 0.3), M['belt'], r=0.008, seg=2))
    if torso not in ('wetsuit', 'heavy'):
        on['thighR'].append(profile(cid + '_holster', [(0.0, 0.0), (0.09, 0.0), (0.08, 0.17), (-0.01, 0.17)], 0.04, M['belt'], x=0.172, loc=(0, -0.03, 0.7), bev=0.008))
        on['thighR'].append(rbox(cid + '_holstergrip', (0.03, 0.035, 0.07), (0.172, -0.005, 0.895), mat('g_black', 0x18191b, 0.3, 0.6), r=0.008, seg=2, rot=(-0.2, 0, 0)))
        on['thighR'].append(band(cid + '_legstrap', 0.1, 0.012, 0.072, 0.078, 0.72, 0.745, 0.008, M['belt']))
    for s in 'LR':
        an = Vector(J['an' + s])
        on['foot' + s].append(boot(f'{cid}_boot{s}', M, an.x, an))
    for s in 'LR':
        P, R, rg = hands[s]
        g = fist(f'{cid}_glove{s}', M['glove'], knuckle=M['pouch'] if torso == 'heavy' else None, palm=s, rg=rg, thumb='wrap' if s == 'R' else 'along')
        g.matrix_world = Matrix.Translation(P) @ R.to_4x4()
        on['hand' + s].append(g)
    # parent everything to bones
    for bn, objs in on.items():
        if objs:
            to_bone(objs, rig, cid + '_' + bn)
    gun_mount = empty(f'{cid}_gun', rz(MOUNT, TWIST))
    gun_mount.rotation_euler = (0, 0, TWIST)
    to_bone([gun_mount], rig, cid + '_aim')
    bake_twist(cid, rig, [o for o in skinned if o is not None])
    first_person_arms(cid, M, torso, 'rolled' in ex)
    merge_character(cid, rig, body, [o for o in skinned[1:] if o is not None])
    bake_ao(cid)


def merge_character(cid, rig, body, shells):
    """Clothing shells join the body (one skinned mesh); the rigid gear of every bone becomes one object."""
    for o in [body] + shells:
        col_attr(o)
    if shells:
        join([body] + shells, cid + '_body')
    per_bone = {}
    for o in bpy.data.objects:
        if o.parent == rig and o.parent_type == 'BONE' and o.type == 'MESH':
            per_bone.setdefault(o.parent_bone, []).append(o)
    for bn, objs in per_bone.items():
        for o in objs:
            col_attr(o)
        join(objs, bn.replace(cid + '_', cid + '_g_'))
    for side in 'RL':
        root = bpy.data.objects[f'{cid}_vmarm{side}']
        objs = [o for o in root.children if o.type == 'MESH']
        for o in objs:
            col_attr(o)
        join(objs, f'{cid}_vmmesh{side}')


def bake_ao(cid, samples=48, dist=0.28, strength=0.75):
    """Bakes ambient occlusion of one agent (other objects hidden) and multiplies it into the vertex colours."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.device = 'CPU'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake_world')
    sc.world.light_settings.distance = dist
    mine = [o for o in bpy.data.objects if o.name.startswith(cid + '_')]
    hidden = [o for o in bpy.data.objects if o not in mine and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    for o in mine:
        if o.type != 'MESH' or not o.data.polygons:
            continue
        me = o.data
        ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ao
        for x in bpy.data.objects:
            x.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
        col = me.color_attributes['Col']
        for i, d in enumerate(ao.data):
            k = 1 - strength * (1 - d.color[0])
            c = col.data[i].color
            col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Col']
    for o in hidden:
        o.hide_render = False


def first_person_arms(cid, M, torso, rolled):
    """'<id>_vmarmR': right hand closed round a pistol grip whose axis is +Z through the origin, forearm running
    back and down to the camera.  '<id>_vmarmL': left hand under a handguard whose axis is +Y through the origin."""
    heavy = torso == 'heavy'
    sl = M['sleeve'] if torso != 'jacket' else M['vest']
    for side in ('R', 'L'):
        sx = 1 if side == 'R' else -1
        rg = GRIP_R if side == 'R' else GRIP_L
        root = empty(f'{cid}_vmarm{side}', (40 if side == 'R' else 42, 0, 0))
        off = Vector(root.location)
        g = fist(f'{cid}_vmglove{side}', M['glove'], knuckle=M['pouch'] if heavy else None, palm=side, rg=rg, thumb='wrap' if side == 'R' else 'along')
        if side == 'R':
            R = Matrix.Identity(3)
            sleeve_dir = Vector((0.22, -0.8, -0.56)).normalized()
        else:
            R = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0)))
            sleeve_dir = Vector((-0.42, -0.7, -0.58)).normalized()
        g.matrix_world = Matrix.Translation(off) @ R.to_4x4()
        wrist = R @ wrist_off(sx, rg)
        pts = [wrist + sleeve_dir * t for t in (-0.01, 0.07, 0.18, 0.3, 0.42, 0.52)]
        if rolled:
            rad = [0.031, 0.034, 0.038, 0.041, 0.045, 0.047]
            arm = tube(f'{cid}_vmskin{side}', [p + off for p in pts[:4]], 0.04, M['skin'], sides=16, radii=rad[:4])
            sleeve = tube(f'{cid}_vmsleeve{side}', [p + off for p in pts[3:]], 0.05, sl, sides=16, radii=[0.05, 0.056, 0.06])
            roll = torus(f'{cid}_vmroll{side}', 0.05, 0.013, pts[3] + off, sl, major=20, minor=8)
            roll.rotation_mode = 'QUATERNION'
            roll.rotation_quaternion = sleeve_dir.to_track_quat('Z', 'Y')
            parts = [g, arm, sleeve, roll]
        else:
            rad = [0.036, 0.04, 0.046, 0.052, 0.056, 0.058] if not heavy else [0.04, 0.047, 0.054, 0.058, 0.062, 0.064]
            sleeve = tube(f'{cid}_vmsleeve{side}', [p + off for p in pts[1:]], 0.05, sl, sides=18, radii=rad[1:])
            folds = []
            for k, t in enumerate((0.13, 0.25, 0.37)):
                f = torus(f'{cid}_vmfold{side}{k}', 0.044 + 0.022 * t, 0.006, wrist + sleeve_dir * t + off, sl, major=18, minor=6)
                f.rotation_mode = 'QUATERNION'
                f.rotation_quaternion = (sleeve_dir.to_track_quat('Z', 'Y') @ Quaternion((1, 0, 0), 0.25 * (k - 1)))
                folds.append(f)
            cuff = tube(f'{cid}_vmcuff{side}', [wrist + off + sleeve_dir * 0.035, wrist + off + sleeve_dir * 0.085], 0.042 if not heavy else 0.047,
                        M['pouch'] if not heavy else M['vest'], sides=18)
            parts = [g, sleeve, cuff] + folds
            if heavy:
                parts.append(tube(f'{cid}_vmbracer{side}', [wrist + off + sleeve_dir * 0.1, wrist + off + sleeve_dir * 0.26], 0.06, M['vest'], sides=12,
                                  radii=[0.058, 0.064]))
        if torso == 'jacket':
            parts.append(rbox(f'{cid}_vmzip{side}', (0.01, 0.12, 0.01), wrist + off + sleeve_dir * 0.2 + Vector((0, 0, 0.05)), M['belt'], r=0.002, seg=1))
        for p in parts:
            reparent(p, root)


for _cid in AGENTS:
    print('agent', _cid)
    build_character(_cid)
