# Rooftop clutter placed on top of buildings by the world builder: air conditioners, water tanks,
# chimneys, antennas, satellite dishes and vent pipes. Each is '<name>_root' at the origin, +Z up.
RT = dict(metal=mat('rt_metal', 0xb8bcc0, 0.6, 0.45), dark=mat('rt_dark', 0x3a3d40, 0.4, 0.6), white=mat('rt_white', 0xe8e6e0, 0.1, 0.5),
          brick=mat('rt_brick', 0x9a5a44, 0, 0.9), rust=mat('rt_rust', 0x8a5a3a, 0.3, 0.8), tank=mat('rt_tank', 0x2e3a44, 0.2, 0.55),
          grille=mat('rt_grille', 0x55595c, 0.5, 0.5))


def roof_ac():
    r = empty('roofac_root', (0, 0, 0))
    rbox('roofac_body', (1.0, 0.7, 0.75), (0, 0, 0.475), RT['white'], r, r=0.03, seg=2)
    rbox('roofac_base', (1.05, 0.75, 0.1), (0, 0, 0.05), RT['dark'], r, r=0.01, seg=1)
    lathe('roofac_fan', [(0.0, 0.0), (0.27, 0.0), (0.27, 0.02), (0.0, 0.02)], RT['grille'], r, segs=24, loc=(0, 0.0, 0.85), axis='Z')
    rbox('roofac_grille', (0.9, 0.01, 0.5), (0, 0.352, 0.48), RT['grille'], r, r=0.0, seg=1)
    for i in range(9):
        rbox(f'roofac_slat{i}', (0.012, 0.012, 0.5), (-0.44 + i * 0.11, 0.357, 0.48), RT['grille'], r, r=0.0, seg=1)
    tube('roofac_pipe', [(0.45, -0.2, 0.3), (0.62, -0.2, 0.3), (0.62, -0.2, 0.0)], 0.025, RT['metal'], r, sides=8)


def roof_tank():
    r = empty('rooftank_root', (0, 0, 0))
    for x in (-0.55, 0.55):
        for y in (-0.55, 0.55):
            tube(f'rooftank_leg{x}{y}', [(x, y, 0), (x * 0.9, y * 0.9, 1.2)], 0.05, RT['rust'], r, sides=8)
    rbox('rooftank_deck', (1.5, 1.5, 0.08), (0, 0, 1.24), RT['rust'], r, r=0.01, seg=1)
    lathe('rooftank_body', [(0.0, 1.28), (0.72, 1.28), (0.75, 1.35), (0.75, 2.75), (0.72, 2.8), (0.3, 3.05), (0.0, 3.1)], RT['tank'], r, segs=24, axis='Z')
    for z in (1.7, 2.25):
        lathe(f'rooftank_hoop{z}', [(0.0, z), (0.77, z), (0.77, z + 0.05), (0.0, z + 0.05)], RT['dark'], r, segs=24, axis='Z')
    tube('rooftank_pipe', [(0.6, 0.3, 1.4), (0.85, 0.3, 1.4), (0.85, 0.3, 0.0)], 0.04, RT['metal'], r, sides=8)


def chimney():
    r = empty('chimney_root', (0, 0, 0))
    rbox('chimney_stack', (0.6, 0.5, 1.4), (0, 0, 0.7), RT['brick'], r, r=0.01, seg=1)
    rbox('chimney_cap', (0.7, 0.6, 0.08), (0, 0, 1.44), RT['dark'], r, r=0.01, seg=1)
    for x in (-0.13, 0.13):
        lathe(f'chimney_pot{x}', [(0.0, 1.48), (0.08, 1.48), (0.07, 1.75), (0.085, 1.78), (0.0, 1.78)], RT['rust'], r, segs=12, loc=(x, 0, 0), axis='Z')


def antenna():
    r = empty('antenna_root', (0, 0, 0))
    rbox('antenna_base', (0.3, 0.3, 0.06), (0, 0, 0.03), RT['dark'], r, r=0.01, seg=1)
    tube('antenna_mast', [(0, 0, 0), (0, 0, 3.0)], 0.03, RT['metal'], r, sides=8)
    for i, z in enumerate((2.2, 2.55, 2.85)):
        w = 0.9 - i * 0.2
        tube(f'antenna_bar{i}', [(-w / 2, 0, z), (w / 2, 0, z)], 0.012, RT['metal'], r, sides=6)
        for k in range(4):
            x = -w / 2 + k * w / 3
            tube(f'antenna_el{i}{k}', [(x, -0.2, z), (x, 0.2, z)], 0.008, RT['metal'], r, sides=5)
    for a in range(3):
        ang = a * 2.094
        tube(f'antenna_guy{a}', [(0, 0, 2.0), (math.cos(ang) * 1.0, math.sin(ang) * 1.0, 0.02)], 0.006, RT['dark'], r, sides=4)


def dish():
    r = empty('dish_root', (0, 0, 0))
    tube('dish_pole', [(0, 0, 0), (0, 0, 0.9)], 0.035, RT['dark'], r, sides=8)
    d = lathe('dish_bowl', [(0.0, 0.0), (0.2, 0.012), (0.38, 0.05), (0.42, 0.065), (0.4, 0.07), (0.0, 0.016)], RT['white'], r, segs=24, axis='Z')
    d.rotation_euler = (1.1, 0, 0)
    d.location = (0, 0.05, 1.0)
    tube('dish_arm', [(0, 0.05, 0.98), (0, 0.4, 1.25)], 0.012, RT['dark'], r, sides=6)
    rbox('dish_lnb', (0.06, 0.08, 0.06), (0, 0.42, 1.27), RT['dark'], r, r=0.01, seg=1)


def vent():
    r = empty('roofvent_root', (0, 0, 0))
    lathe('roofvent_pipe', [(0.0, 0.0), (0.16, 0.0), (0.16, 0.9), (0.0, 0.9)], RT['metal'], r, segs=16, axis='Z')
    lathe('roofvent_hat', [(0.0, 0.95), (0.3, 0.98), (0.26, 1.04), (0.0, 1.12)], RT['metal'], r, segs=16, axis='Z')
    for k in range(4):
        a = k * math.pi / 2
        tube(f'roofvent_strut{k}', [(math.cos(a) * 0.15, math.sin(a) * 0.15, 0.88), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.99)], 0.01, RT['metal'], r, sides=4)


roof_ac(); roof_tank(); chimney(); antenna(); dish(); vent()
