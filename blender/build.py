"""
Rebuild every Blender-made asset of Alpine Descent, in dependency order.

    python blender/build.py               # everything (about 30-40 min on 4 cores; the lightmap bake dominates)
    python blender/build.py --quick       # smaller sky and lightmap: about 8 min, good for iterating
    python blender/build.py --only sky,props
    python blender/build.py --list

Steps: world  maps  sky  branches  trees  skier  skier_free  props  rocks  detail  bake  open  open_maps
       (`open` and `open_maps` build the open world; `open` needs a C compiler for the erosion helper but falls back without one)
Needs the `bpy` module (pip install -r blender/requirements.txt), numpy, scipy and Pillow.
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

STEPS = [
    ('world', 'mountain, piste, trees, rocks, courses', ['world_gen.py', '--no-preview'], ['world_gen.py', '--no-preview']),
    ('maps', 'terrain colour + mask textures', ['world_maps.py'], ['world_maps.py']),
    ('sky', 'Nishita sky + far mountains (HDR)', ['make_sky.py'], ['make_sky.py', '--quick']),
    ('branches', 'Cycles branch atlas for the foliage cards', ['make_branches.py'], ['make_branches.py', '--samples', '24']),
    ('trees', 'conifers, 4 species x 4 LODs', ['make_trees.py'], ['make_trees.py']),
    ('skier', 'rigged race-suit skier', ['make_skier.py'], ['make_skier.py']),
    ('skier_free', 'the freerider outfit (same skeleton)', ['make_skier.py', '--style', 'free'], ['make_skier.py', '--style', 'free']),
    ('props', 'gates, banners, nets, lodge, hut, chairlift, chalets, chapel, signs, flag', ['make_props.py'], ['make_props.py']),
    ('rocks', 'boulders, 4 kinds x 3 LODs', ['make_rocks.py'], ['make_rocks.py']),
    ('detail', 'tileable rock / snow detail textures', ['make_detail.py'], ['make_detail.py']),
    ('bake', 'terrain light map (sun shadows + ambient occlusion)',
     ['bake_terrain.py', '--res', '2048', '--samples', '40', '--ao-samples', '64', '--coarse', '1'],
     ['bake_terrain.py', '--res', '1024', '--samples', '16', '--ao-samples', '24', '--coarse', '2']),
    ('open', 'open world: basin, erosion, pistes, lifts, village, forest, flags', ['open_world.py', '--redo-terrain', '--no-preview'],
     ['open_world.py', '--redo-terrain', '--drops', '600000', '--no-preview']),
    ('open_maps', 'open world colour, mask, light and map textures', ['open_maps.py'], ['open_maps.py', '--size', '1024', '--quick']),
]


def main():
    args = sys.argv[1:]
    if '--list' in args:
        for name, what, _, _ in STEPS:
            print(f'{name:9s} {what}')
        return
    quick = '--quick' in args
    only = None
    if '--only' in args:
        only = set(args[args.index('--only') + 1].split(','))
        unknown = only - {s[0] for s in STEPS}
        if unknown:
            sys.exit(f'unknown step(s): {", ".join(sorted(unknown))} (see --list)')
    t_all = time.time()
    for name, what, full, fast in STEPS:
        if only and name not in only:
            continue
        cmd = [sys.executable, os.path.join(HERE, (fast if quick else full)[0])] + (fast if quick else full)[1:]
        print(f'\n=== {name}: {what}\n    {" ".join(os.path.basename(c) if i == 1 else c for i, c in enumerate(cmd))}', flush=True)
        t0 = time.time()
        r = subprocess.run(cmd, cwd=HERE)
        if r.returncode != 0:
            sys.exit(f'step "{name}" failed ({r.returncode})')
        print(f'=== {name} done in {time.time() - t0:.0f} s', flush=True)
    print(f'\nall done in {(time.time() - t_all) / 60:.1f} min')


if __name__ == '__main__':
    main()
