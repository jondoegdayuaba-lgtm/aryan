"""Fire and reload clips for the weapons (exported inside weapons.glb).

Each weapon has moving parts made in gear.py (`<Name>_Mag`, `_Bolt`, `_Slide`, `_Pump`, `_Handle`, `_Warhead`,
`_Shell`) plus the `<Name>_Hand` empty that the game uses as the left-hand IK target. Keyframing that empty makes
the character's hand follow the reload: grab the magazine, pull it, fetch a new one, seat it, work the bolt.

Clips are pushed to NLA tracks named `<Name>_Fire` / `<Name>_Reload`; the exporter merges same-named tracks
into one glTF animation. The game plays Fire over the shot interval and Reload over the reload time.

Positions are in weapon space: (f, z, x) = (forward, up, the weapon's left); see gear.V.
"""
import bpy
from mathutils import Vector, Quaternion

FPS = 30
AXES = {'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}


def V(f, z, x=0.0):
    return Vector((x, -f, z))


class Clip:
    def __init__(self, gun, name, frames):
        self.gun = gun
        self.name = f'{gun.name}_{name}'
        self.frames = frames
        self.keys = {}   # obj -> {frame: dict}

    def part(self, suffix):
        return bpy.data.objects[f'{self.gun.name}_{suffix}']

    def key(self, suffix, frame, loc=None, at=None, rot=None, scale=None):
        """loc: offset from the part's rest spot; at: absolute weapon-space spot; rot: (blender axis, angle)."""
        obj = self.part(suffix)
        k = self.keys.setdefault(obj, {}).setdefault(frame, {})
        if loc is not None:
            k['loc'] = V(*loc)
        if at is not None:
            k['loc'] = V(*at) - Vector(obj['rest_loc'])
        if rot is not None:
            k['rot'] = rot
        if scale is not None:
            k['scale'] = scale
        return self

    def hand(self, frame, f, z, x=0.0):
        return self.key('Hand', frame, at=(f, z, x))


def remember_rest(objs):
    for o in objs:
        o['rest_loc'] = o.location.copy()
        o['rest_scale'] = o.scale.copy()


def bake(clip):
    for obj, frames in clip.keys.items():
        rest_loc = Vector(obj['rest_loc'])
        rest_scale = Vector(obj['rest_scale'])
        frames.setdefault(0, {})
        frames.setdefault(clip.frames, {})
        ad = obj.animation_data_create()
        act = bpy.data.actions.new(clip.name + '_' + obj.name)
        act.use_fake_user = True
        ad.action = act
        quat = obj.rotation_mode == 'QUATERNION'
        # carry each channel forward so a key that only moves one channel keeps the others where they were
        cur = {'loc': Vector((0, 0, 0)), 'rot': None, 'scale': None}
        for f in sorted(frames):
            k = frames[f]
            for ch in ('loc', 'rot', 'scale'):
                if ch in k:
                    cur[ch] = k[ch]
            if f in (0, clip.frames) and not any(ch in k for ch in ('loc', 'rot', 'scale')):
                cur = {'loc': Vector((0, 0, 0)), 'rot': None, 'scale': None}
            obj.location = rest_loc + cur['loc']
            obj.keyframe_insert('location', frame=f + 1)
            if quat:
                obj.rotation_quaternion = (Quaternion(AXES[cur['rot'][0]], cur['rot'][1]) if cur['rot'] else Quaternion())
                obj.keyframe_insert('rotation_quaternion', frame=f + 1)
                s = cur['scale'] if cur['scale'] is not None else None
                obj.scale = Vector((s, s, s)) if s is not None else rest_scale
                obj.keyframe_insert('scale', frame=f + 1)
        tr = ad.nla_tracks.new()
        tr.name = clip.name
        tr.strips.new(clip.name, 1, act)
        ad.action = None
        obj.location = rest_loc
        if quat:
            obj.rotation_quaternion = Quaternion()
            obj.scale = rest_scale


def mag_swap(c, part, pivot, drop_dir, grab, pouch, t, hand_off=(0.0, -0.035, 0.035)):
    """Standard magazine change starting at frame t: grab, pull, drop (hidden), fetch a new one, insert, slap.
    Returns (frame after the slap, frame the old magazine leaves)."""
    df, dz = drop_dir
    def mag_at(k):   # k metres along the drop direction
        return (df * k, dz * k, 0.0)
    def hand_on(loc):
        return (pivot[0] + loc[0] + hand_off[0], pivot[1] + loc[1] + hand_off[1], loc[2] + hand_off[2])
    c.hand(t, *hand_on(mag_at(0.0)))
    c.key(part, t, loc=mag_at(0.0))
    c.key(part, t + 4, loc=mag_at(0.05)).hand(t + 4, *hand_on(mag_at(0.05)))
    c.key(part, t + 7, loc=mag_at(0.11)).hand(t + 7, *hand_on(mag_at(0.11)))
    drop = t + 8
    new = (mag_at(0.2)[0], mag_at(0.2)[1], 0.1)
    c.key(part, drop, loc=new, scale=0.0)
    c.hand(t + 15, *pouch)
    c.key(part, t + 16, loc=new, scale=0.0)
    c.key(part, t + 18, loc=new, scale=1.0).hand(t + 18, *hand_on(new))
    near = (mag_at(0.05)[0], mag_at(0.05)[1], 0.0)
    c.key(part, t + 26, loc=near).hand(t + 26, *hand_on(near))
    c.key(part, t + 31, loc=(0, 0, 0)).hand(t + 31, *hand_on((0, 0, 0)))
    c.key(part, t + 33, loc=(-df * 0.006, -dz * 0.006, 0)).hand(t + 33, *hand_on((0, 0.004, 0)))
    c.key(part, t + 35, loc=(0, 0, 0))
    return t + 35, drop


def add_clips(guns):
    objs = [o for g in guns.values() for o in [g] + list(g.children)]
    remember_rest(objs)
    bpy.context.scene.render.fps = FPS

    # ---------------------------------------------------------------- pistol
    g = guns['W_Pistol']
    c = Clip(g, 'Fire', 4)
    c.key('Slide', 1, loc=(-0.03, 0, 0)).key('Slide', 2, loc=(-0.03, 0, 0)).key('Slide', 4, loc=(0, 0, 0))
    bake(c)
    c = Clip(g, 'Reload', 46)
    c.hand(3, 0.0, -0.1, 0.06)
    end, drop = mag_swap(c, 'Mag', (-0.019, -0.07), (-0.25, -0.97), None, (-0.05, -0.2, 0.1), 3,
                         hand_off=(0.0, -0.02, 0.03))
    c.hand(end + 3, -0.03, 0.115, 0.0).key('Slide', end + 3, loc=(0, 0, 0))
    c.hand(end + 5, -0.06, 0.115, 0.0).key('Slide', end + 5, loc=(-0.03, 0, 0))
    c.key('Slide', end + 6, loc=(0, 0, 0))
    bake(c)
    g['mag_drop_at'] = (drop - 0.5) / 46

    # ---------------------------------------------------------------- SMG
    g = guns['W_SMG']
    c = Clip(g, 'Fire', 3)
    c.key('Bolt', 1, loc=(-0.025, 0, 0)).key('Bolt', 3, loc=(0, 0, 0))
    bake(c)
    c = Clip(g, 'Reload', 60)
    end, drop = mag_swap(c, 'Mag', (0.098, -0.06), (0.02, -1.0), None, (0.04, -0.22, 0.12), 6)
    c.hand(end + 5, 0.14, 0.13, 0.05).key('Bolt', end + 5, loc=(0, 0, 0))
    c.hand(end + 8, 0.08, 0.13, 0.05).key('Bolt', end + 8, loc=(-0.06, 0, 0))
    c.key('Bolt', end + 10, loc=(0, 0, 0))
    c.hand(60, 0.18, 0.012)
    bake(c)
    g['mag_drop_at'] = (drop - 0.5) / 60

    # ---------------------------------------------------------------- assault rifle
    g = guns['W_AR']
    c = Clip(g, 'Fire', 4)
    c.key('Bolt', 1, loc=(-0.032, 0, 0)).key('Bolt', 2, loc=(-0.032, 0, 0)).key('Bolt', 4, loc=(0, 0, 0))
    bake(c)
    c = Clip(g, 'Reload', 66)
    end, drop = mag_swap(c, 'Mag', (0.16, -0.03), (0.06, -1.0), None, (0.05, -0.22, 0.12), 6)
    c.hand(end + 6, -0.11, 0.17, 0.02).key('Handle', end + 6, loc=(0, 0, 0)).key('Bolt', end + 6, loc=(0, 0, 0))
    c.hand(end + 9, -0.17, 0.17, 0.02).key('Handle', end + 9, loc=(-0.06, 0, 0)).key('Bolt', end + 9, loc=(-0.045, 0, 0))
    c.key('Handle', end + 11, loc=(0, 0, 0)).key('Bolt', end + 11, loc=(0, 0, 0))
    c.hand(end + 13, -0.14, 0.19, 0.03)
    c.hand(66, 0.34, 0.066)
    bake(c)
    g['mag_drop_at'] = (drop - 0.5) / 66

    # ---------------------------------------------------------------- pump shotgun
    g = guns['W_Pump']
    hand = (0.35, 0.064)
    c = Clip(g, 'Fire', 21)
    c.key('Pump', 4, loc=(0, 0, 0)).hand(4, *hand)
    c.key('Pump', 9, loc=(-0.1, 0, 0)).hand(9, hand[0] - 0.1, hand[1])
    c.key('Pump', 13, loc=(0, 0, 0)).hand(13, *hand)
    bake(c)
    g['eject_at'] = 9 / 21
    c = Clip(g, 'Reload', 100)
    port = Vector(bpy.data.objects['W_Pump_Shell']['rest_loc'])
    port_f, port_z = -port.y, port.z
    c.hand(8, 0.0, -0.12, 0.1).key('Shell', 8, scale=0.0)
    for k in range(4):
        t = 10 + k * 20
        pouch = (0.0, -0.12, 0.1)
        c.key('Shell', t - 1, at=pouch, scale=0.0)
        c.key('Shell', t, at=pouch, scale=1.0).hand(t, *pouch)
        c.key('Shell', t + 8, at=(port_f + 0.01, port_z - 0.01, 0.0), scale=1.0).hand(t + 8, port_f + 0.01, port_z - 0.03)
        c.key('Shell', t + 11, loc=(0, 0, 0), scale=0.0).hand(t + 11, port_f, port_z - 0.015)
        if k < 3:
            c.hand(t + 18, *pouch)
    c.key('Pump', 92, loc=(0, 0, 0)).hand(92, *hand)
    c.key('Pump', 95, loc=(-0.1, 0, 0)).hand(95, hand[0] - 0.1, hand[1])
    c.key('Pump', 98, loc=(0, 0, 0)).hand(98, *hand)
    bake(c)

    # ---------------------------------------------------------------- combat shotgun
    g = guns['W_Tactical']
    c = Clip(g, 'Fire', 4)
    c.key('Mag', 1, loc=(0, -0.003, 0)).key('Mag', 4, loc=(0, 0, 0))
    bake(c)
    c = Clip(g, 'Reload', 62)
    end, drop = mag_swap(c, 'Mag', (0.148, -0.066), (-0.05, -1.0), None, (0.05, -0.22, 0.14), 6,
                         hand_off=(0.0, -0.05, 0.05))
    c.hand(end + 6, 0.2, 0.21, 0.0)
    c.hand(end + 9, 0.2, 0.175, 0.0)
    c.hand(62, 0.38, 0.062)
    bake(c)
    g['mag_drop_at'] = (drop - 0.5) / 62

    # ---------------------------------------------------------------- sniper: bolt action
    g = guns['W_Sniper']
    rest = (0.44, 0.062)

    def bolt_cycle(c, t):
        c.hand(t, -0.07, 0.09, -0.08).key('Bolt', t, loc=(0, 0, 0), rot=('Y', 0.0))
        c.hand(t + 4, -0.07, 0.14, -0.05).key('Bolt', t + 4, loc=(0, 0, 0), rot=('Y', 1.0))
        c.hand(t + 8, -0.14, 0.14, -0.05).key('Bolt', t + 8, loc=(-0.07, 0, 0), rot=('Y', 1.0))
        c.hand(t + 12, -0.07, 0.14, -0.05).key('Bolt', t + 12, loc=(0, 0, 0), rot=('Y', 1.0))
        c.hand(t + 15, -0.07, 0.09, -0.08).key('Bolt', t + 15, loc=(0, 0, 0), rot=('Y', 0.0))
        return t + 8

    c = Clip(g, 'Fire', 33)
    c.hand(2, *rest)
    ej = bolt_cycle(c, 8)
    c.hand(33, *rest)
    bake(c)
    g['eject_at'] = ej / 33
    c = Clip(g, 'Reload', 56)
    end, drop = mag_swap(c, 'Mag', (0.12, 0.02), (0.0, -1.0), None, (0.1, -0.2, 0.12), 3,
                         hand_off=(0.0, -0.04, 0.04))
    bolt_cycle(c, end + 2)
    c.hand(56, *rest)
    bake(c)
    g['mag_drop_at'] = (drop - 0.5) / 56

    # ---------------------------------------------------------------- rocket launcher
    g = guns['W_Rocket']
    piv = (0.75, 0.17)
    c = Clip(g, 'Fire', 6)
    c.key('Warhead', 0, scale=1.0).key('Warhead', 1, scale=0.0).key('Warhead', 6, scale=0.0)
    bake(c)
    c = Clip(g, 'Reload', 60)
    c.key('Warhead', 0, scale=0.0).hand(0, 0.31, 0.035)
    pouch = (0.2, -0.15, 0.15)
    c.hand(12, *pouch).key('Warhead', 12, at=(pouch[0] - 0.05, pouch[1], pouch[2]), scale=0.0)
    c.key('Warhead', 14, at=(pouch[0] - 0.05, pouch[1], pouch[2]), scale=1.0).hand(14, *pouch)
    c.key('Warhead', 27, loc=(0.3, 0.0, 0.0), scale=1.0).hand(27, piv[0] + 0.25, piv[1] - 0.04, 0.06)
    c.key('Warhead', 37, loc=(0, 0, 0), scale=1.0).hand(37, piv[0] - 0.05, piv[1] - 0.04, 0.06)
    c.key('Warhead', 60, loc=(0, 0, 0), scale=1.0).hand(47, 0.31, 0.035)
    bake(c)

    for o in objs:
        for k in ('rest_loc', 'rest_scale'):
            if k in o:
                del o[k]
    guns['W_Pump']['shell'] = 'shell'
    guns['W_Tactical']['shell'] = 'shell'
    print('gun clips:', sorted({t.name for o in objs if o.animation_data for t in o.animation_data.nla_tracks}))
