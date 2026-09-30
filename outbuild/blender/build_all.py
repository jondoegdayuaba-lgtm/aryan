"""Rebuild every Outbuild asset from scratch with Blender's Python module.

    pip install bpy numpy pillow        (bpy 4.5 needs Python 3.11)
    python outbuild/blender/build_all.py

Writes the GLB models to outbuild/assets/models and the textures to outbuild/assets/textures.
Each script can also be run on its own, e.g. `python -c "import characters; characters.build()"`
from this folder; pass a preview path to render a Cycles preview while you tweak a model.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import textures  # noqa: E402  (numpy + Pillow only)
import characters  # noqa: E402
import pieces  # noqa: E402
import props  # noqa: E402
import gear  # noqa: E402

if __name__ == '__main__':
    textures.build()
    characters.build()
    pieces.build()
    props.build()
    gear.build()
    print('all assets rebuilt')
