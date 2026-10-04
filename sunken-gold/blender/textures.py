"""Tileable albedo + normal maps baked from procedural Cycles node trees:
seabed layers (sand, coral rubble, reef rock, silt), wreck planks and the
water surface's normal map."""
import os

import numpy as np

from common import TEX, Nodes, bake_plane_sockets, height_to_normal, linear_to_srgb, save_image


def sand(n: Nodes):
    big = n.noise(n.torus(), scale=1.6, detail=3, rough=0.55)[0]
    # Ripples: a sine along v with an integer count so it tiles, gently bent by
    # low-frequency noise so the crests meander and fork like real sand ripples.
    bend = n.noise(n.torus(1.0, 1.0, (3, 1, 2, 5)), scale=1.1, detail=3, rough=0.5)[0]
    phase = n.math('MULTIPLY_ADD', bend, 0.22, n.separate(n.uv())[1])
    wave = n.math('SINE', n.math('MULTIPLY', phase, 2 * np.pi * 22))
    ripple = n.math('POWER', n.math('MULTIPLY_ADD', wave, 0.5, 0.5), 1.6)
    fade = n.smooth(n.noise(n.torus(1, 1, (7, 2, 1, 3)), scale=1.3, detail=2)[0], 0.3, 0.55)
    ripple = n.math('MULTIPLY', ripple, n.math('MULTIPLY_ADD', fade, 0.7, 0.3))
    grain = n.noise(n.torus(), scale=170, detail=2, rough=0.7)[0]
    speck = n.smooth(n.noise(n.torus(1, 1, (11, 3, 5, 2)), scale=130, detail=1)[0], 0.67, 0.72)
    shell = n.voronoi(n.torus(1, 1, (4, 9, 1, 6)), scale=55, feature='F1')
    shell_on = n.math('MULTIPLY', n.smooth(shell[0], 0.25, 0.1), n.smooth(n.separate(shell[1])[0], 0.82, 0.86))
    col = n.ramp(big, [(0.25, '#bfae8e'), (0.5, '#d2c3a2'), (0.75, '#e0d3b6')])
    col = n.mix(col, n.ramp(grain, [(0.3, '#a99878'), (0.7, '#ece1c8')]), 0.35)
    col = n.mix(col, '#9c8b6c', n.math('MULTIPLY', n.math('SUBTRACT', 1, ripple), 0.35))
    col = n.mix(col, '#5d5444', n.math('MULTIPLY', speck, 0.5))
    col = n.mix(col, '#f4efe4', shell_on)
    height = n.math('ADD', n.math('MULTIPLY', ripple, 0.9), n.math('MULTIPLY', grain, 0.18))
    height = n.math('ADD', height, n.math('ADD', n.math('MULTIPLY', big, 0.3), n.math('MULTIPLY', shell_on, 0.3)))
    return {'albedo': col, 'height': height}


def rubble(n: Nodes):
    """Broken coral pieces lying in sand: the floor between coral heads."""
    warp = n.noise(n.torus(1, 1, (2, 5, 3, 1)), scale=3, detail=2)[0]
    t = n.torus(1, 1, (0, 0, 0, 0))
    pieces = n.voronoi(t, scale=16, feature='F1', random=0.9)
    edge = n.voronoi(t, scale=16, feature='DISTANCE_TO_EDGE', random=0.9)[0]
    tone = n.separate(pieces[1])
    dome = n.math('MULTIPLY', n.smooth(edge, 0.0, 0.12), n.smooth(tone[2], 0.18, 0.25))
    pores = n.smooth(n.voronoi(n.torus(1, 1, (5, 1, 8, 2)), scale=120, feature='F1')[0], 0.12, 0.3)
    sand_bits = n.noise(n.torus(1, 1, (3, 3, 3, 3)), scale=150, detail=2)[0]
    piece_col = n.ramp(tone[0], [(0.0, '#d9d2c2'), (0.35, '#c9bfae'), (0.6, '#b8aa98'), (0.8, '#c7a9a2'), (1.0, '#e8e2d4')])
    piece_col = n.mix(piece_col, '#8a826f', n.math('MULTIPLY', n.math('SUBTRACT', 1, pores), 0.35))
    piece_col = n.mix(piece_col, '#7d7a5a', n.math('MULTIPLY', n.smooth(warp, 0.55, 0.7), 0.5))
    sand_col = n.ramp(sand_bits, [(0.3, '#a5967a'), (0.7, '#cfc3a6')])
    col = n.mix(sand_col, piece_col, dome)
    col = n.mix(col, '#5b5345', n.math('MULTIPLY', n.math('SUBTRACT', 1, n.smooth(edge, 0.0, 0.04)), n.math('MULTIPLY', n.smooth(tone[2], 0.18, 0.25), 0.6)))
    height = n.math('ADD', n.math('MULTIPLY', n.math('POWER', dome, 0.6), 1.0), n.math('MULTIPLY', pores, 0.15))
    height = n.math('ADD', height, n.math('MULTIPLY', sand_bits, 0.1))
    return {'albedo': col, 'height': height}


def rock(n: Nodes):
    """Porous reef limestone with turf algae and pink coralline crusts."""
    warp = n.noise(n.torus(1, 1, (9, 2, 4, 1)), scale=2.5, detail=3)[1]
    vec, w = n.torus()
    vec = n.vmath('ADD', vec, n.vmath('SCALE', warp, scale=0.35))
    base = n.noise((vec, w), scale=3.0, detail=10, rough=0.62, distortion=0.2)[0]
    pits = n.voronoi(n.torus(1, 1, (1, 6, 2, 3)), scale=26, feature='F1')
    pit = n.math('MULTIPLY', n.smooth(pits[0], 0.32, 0.12), n.smooth(n.separate(pits[1])[0], 0.45, 0.5))
    small_pits = n.voronoi(n.torus(1, 1, (4, 4, 9, 1)), scale=70, feature='F1')
    small_pit = n.math('MULTIPLY', n.smooth(small_pits[0], 0.3, 0.1), n.smooth(n.separate(small_pits[1])[1], 0.5, 0.55))
    cracks = n.voronoi((vec, w), scale=2.2, feature='DISTANCE_TO_EDGE')[0]
    crack = n.math('SUBTRACT', 1.0, n.smooth(cracks, 0.0, 0.02))
    col = n.ramp(base, [(0.25, '#6d675b'), (0.45, '#8b8371'), (0.62, '#a39a86'), (0.8, '#b9b09c')])
    turf = n.smooth(n.noise(n.torus(1, 1, (3, 3, 9, 4)), scale=4, detail=6, rough=0.7)[0], 0.45, 0.6)
    col = n.mix(col, n.ramp(base, [(0.3, '#4e5530'), (0.7, '#717a45')]), n.math('MULTIPLY', turf, 0.7))
    crust = n.smooth(n.noise(n.torus(1, 1, (8, 1, 1, 7)), scale=5, detail=4, rough=0.6)[0], 0.62, 0.66)
    col = n.mix(col, n.ramp(base, [(0.3, '#8c7074'), (0.7, '#ad9095')]), n.math('MULTIPLY', crust, 0.6))
    col = n.mix(col, '#2b2620', n.math('MAXIMUM', n.math('MULTIPLY', pit, 0.85), n.math('MULTIPLY', small_pit, 0.7)))
    col = n.mix(col, '#3e3a32', n.math('MULTIPLY', crack, 0.3))
    height = n.math('SUBTRACT', base, n.math('ADD', n.math('MULTIPLY', pit, 0.5), n.math('MULTIPLY', small_pit, 0.2)))
    height = n.math('SUBTRACT', height, n.math('MULTIPLY', crack, 0.12))
    height = n.math('ADD', height, n.math('MULTIPLY', crust, 0.12))
    return {'albedo': col, 'height': height}


def silt(n: Nodes):
    """Fine dark mud of the deep trench, pocked by burrows."""
    base = n.noise(n.torus(), scale=2.2, detail=6, rough=0.55)[0]
    mottle = n.noise(n.torus(1, 1, (6, 1, 2, 9)), scale=9, detail=3)[0]
    holes = n.voronoi(n.torus(1, 1, (2, 2, 7, 1)), scale=14, feature='F1')
    on = n.smooth(n.separate(holes[1])[0], 0.86, 0.9)
    hole = n.math('MULTIPLY', n.smooth(holes[0], 0.09, 0.03), on)
    rim = n.math('MULTIPLY', n.math('MULTIPLY', n.smooth(holes[0], 0.05, 0.1), n.smooth(holes[0], 0.25, 0.12)), on)
    grain = n.noise(n.torus(1, 1, (1, 6, 3, 3)), scale=150, detail=2)[0]
    col = n.ramp(base, [(0.3, '#4a463b'), (0.55, '#5c5747'), (0.8, '#6d6753')])
    col = n.mix(col, n.ramp(mottle, [(0.3, '#3f3c33'), (0.7, '#6f6a58')]), 0.4)
    col = n.mix(col, n.ramp(grain, [(0.3, '#3a372f'), (0.7, '#7a7462')]), 0.25)
    col = n.mix(col, '#1c1a16', hole)
    height = n.math('ADD', n.math('MULTIPLY', base, 0.4), n.math('MULTIPLY', grain, 0.1))
    height = n.math('ADD', height, n.math('SUBTRACT', n.math('MULTIPLY', rim, 0.4), n.math('MULTIPLY', hole, 0.8)))
    return {'albedo': col, 'height': height}


def wood(n: Nodes):
    """Old ship planks, grey-brown and filmed with algae. Planks run along v."""
    u, v, _ = n.separate(n.uv())
    planks = 6
    idx = n.math('FLOOR', n.math('MULTIPLY', u, planks))
    fu = n.math('FRACT', n.math('MULTIPLY', u, planks))
    rnd = n.new('ShaderNodeTexWhiteNoise', noise_dimensions='1D')
    n.feed(rnd.inputs['W'], idx)
    r = rnd.outputs['Value']
    # Butt joints: every plank breaks at its own spot along v.
    fv = n.math('FRACT', n.math('ADD', n.math('MULTIPLY', v, 2), r))
    seam = n.math('MAXIMUM', n.smooth(n.math('ABSOLUTE', n.math('SUBTRACT', fu, 0.5)), 0.46, 0.5),
                  n.smooth(n.math('ABSOLUTE', n.math('SUBTRACT', fv, 0.5)), 0.49, 0.5))
    grain = n.noise(n.torus(planks * 7.0, 0.6, (0, 0, 0, 0)), scale=1.4, detail=6, rough=0.6, distortion=0.4)[0]
    knots = n.voronoi(n.torus(1, 1, (3, 2, 5, 4)), scale=12, feature='F1')
    knot = n.math('MULTIPLY', n.smooth(knots[0], 0.12, 0.02), n.smooth(n.separate(knots[1])[0], 0.8, 0.84))
    algae = n.noise(n.torus(1, 1, (7, 3, 1, 1)), scale=3, detail=6, rough=0.65)[0]
    tone = n.ramp(r, [(0.0, '#5a4d3c'), (0.5, '#6f604a'), (1.0, '#857257')])
    col = n.mix(tone, n.ramp(grain, [(0.2, '#3b3227'), (0.8, '#9a8a70')]), 0.45)
    col = n.mix(col, '#27211a', n.math('MULTIPLY', knot, 0.8))
    col = n.mix(col, n.ramp(algae, [(0.3, '#4b5435'), (0.7, '#7b7d55')]), n.smooth(algae, 0.45, 0.65))
    col = n.mix(col, '#1b1712', n.math('MULTIPLY', seam, 0.9))
    height = n.math('SUBTRACT', n.math('MULTIPLY', grain, 0.6), n.math('MULTIPLY', seam, 0.9))
    height = n.math('ADD', height, n.math('MULTIPLY', algae, 0.2))
    return {'albedo': col, 'height': height}


def brain(n: Nodes):
    """Meandering grooves of a brain coral; hue comes from the model's vertex colours."""
    a = n.noise(n.torus(), scale=5.0, detail=2, rough=0.5, distortion=0.6)[0]
    groove = n.math('SUBTRACT', 1.0, n.smooth(n.math('ABSOLUTE', n.math('SUBTRACT', a, 0.5)), 0.0, 0.05))
    fine = n.noise(n.torus(1, 1, (3, 1, 4, 1)), scale=60, detail=2)[0]
    col = n.ramp(fine, [(0.3, '#bdbdbd'), (0.7, '#e8e8e8')])
    col = n.mix(col, '#3a3a3a', n.math('MULTIPLY', groove, 0.85))
    height = n.math('SUBTRACT', n.math('MULTIPLY', fine, 0.15), n.math('MULTIPLY', groove, 1.0))
    return {'albedo': col, 'height': height}


def fan(n: Nodes):
    """Sea fan lattice (not tiled): colour plus an alpha mask in the height slot."""
    u, v, _ = n.separate(n.uv())
    du = n.math('SUBTRACT', u, 0.5)
    # Fan silhouette: a wide rounded wedge rising from the stalk.
    r = n.math('POWER', n.math('ADD', n.math('POWER', n.math('DIVIDE', du, 0.5), 2.0), n.math('POWER', n.math('DIVIDE', n.math('SUBTRACT', v, 0.02), 0.98), 2.0)), 0.5)
    edge_noise = n.new('ShaderNodeTexNoise', noise_dimensions='2D')
    n.feed(edge_noise.inputs['Vector'], n.uv())
    n.feed(edge_noise.inputs['Scale'], 6.0)
    sil = n.math('MULTIPLY', n.smooth(r, 1.0, 0.94 - 0.0), n.smooth(v, 0.0, 0.03))
    sil = n.math('MULTIPLY', sil, n.smooth(n.math('ADD', r, n.math('MULTIPLY', edge_noise.outputs[0], 0.12)), 1.02, 0.96))
    vor = n.new('ShaderNodeTexVoronoi', voronoi_dimensions='2D', feature='DISTANCE_TO_EDGE')
    n.feed(vor.inputs['Vector'], n.uv())
    n.feed(vor.inputs['Scale'], 34.0)
    net = n.smooth(vor.outputs['Distance'], 0.045, 0.02)
    ang = n.math('ARCTAN2', du, n.math('ADD', v, 0.05))
    wob = n.new('ShaderNodeTexNoise', noise_dimensions='2D')
    n.feed(wob.inputs['Vector'], n.uv())
    n.feed(wob.inputs['Scale'], 3.0)
    branches = n.smooth(n.math('ABSOLUTE', n.math('SINE', n.math('ADD', n.math('MULTIPLY', ang, 9.0), n.math('MULTIPLY', wob.outputs[0], 2.0)))), 0.12, 0.03)
    branches = n.math('MULTIPLY', branches, n.smooth(v, 0.95, 0.4))
    lattice = n.math('MAXIMUM', net, branches)
    alpha = n.math('MULTIPLY', sil, lattice)
    col = n.ramp(v, [(0.0, '#4a1f45'), (0.5, '#7d2f72'), (1.0, '#b05aa0')])
    col = n.mix(col, '#3a1636', n.math('MULTIPLY', branches, 0.6))
    return {'albedo': col, 'height': alpha}


def water(n: Nodes):
    a = n.noise(n.torus(), scale=4.0, detail=4, rough=0.55, distortion=0.3)[0]
    b = n.noise(n.torus(1, 1, (4, 2, 7, 1)), scale=11.0, detail=3, rough=0.5)[0]
    return {'height': n.math('ADD', a, n.math('MULTIPLY', b, 0.45))}


# name: (node builder, size, normal strength)
GROUND = {
    'sand': (sand, 1024, 4.0),
    'rubble': (rubble, 1024, 6.0),
    'rock': (rock, 1024, 9.0),
    'silt': (silt, 1024, 4.0),
    'wood': (wood, 1024, 5.0),
}


def build():
    print('Baking ground textures')
    for name, (fn, size, strength) in GROUND.items():
        maps = bake_plane_sockets(fn, size, ['albedo', 'height'])
        save_image(os.path.join(TEX, f'{name}_albedo.jpg'), linear_to_srgb(maps['albedo']))
        h = maps['height'][..., 0]
        h = (h - h.mean()) / (h.std() + 1e-6)
        save_image(os.path.join(TEX, f'{name}_normal.jpg'), height_to_normal(h * 0.02 * size / 64, strength), quality=92)
    maps = bake_plane_sockets(brain, 512, ['albedo', 'height'])
    save_image(os.path.join(TEX, 'brain_albedo.jpg'), linear_to_srgb(maps['albedo']))
    h = maps['height'][..., 0]
    h = (h - h.mean()) / (h.std() + 1e-6)
    save_image(os.path.join(TEX, 'brain_normal.jpg'), height_to_normal(h * 0.12, 1.0), quality=92)
    maps = bake_plane_sockets(fan, 512, ['albedo', 'height'])
    rgba = np.concatenate([linear_to_srgb(maps['albedo']), np.clip(maps['height'][..., :1], 0, 1)], axis=2)
    save_image(os.path.join(TEX, 'fan.png'), rgba)
    maps = bake_plane_sockets(water, 512, ['height'])
    h = maps['height'][..., 0]
    h = (h - h.mean()) / (h.std() + 1e-6)
    save_image(os.path.join(TEX, 'water_normal.jpg'), height_to_normal(h * 0.16, 1.0), quality=92)


if __name__ == '__main__':
    import common
    common.reset_scene()
    build()
