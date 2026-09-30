"""Build every game asset with Blender (bpy). Usage:

    python tools/blender/build_assets.py [--only city|bike|vehicles]

Needs:  pip install bpy==4.2.0 pillow numpy   (Python 3.11)
Writes GLB files into ebike/assets/.
"""
import argparse
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "ebike", "assets"))

ap = argparse.ArgumentParser()
ap.add_argument("--only", choices=["city", "bike", "vehicles"])
ap.add_argument("--tex", default=None, help="reuse an existing texture folder")
args = ap.parse_args()

import common as C  # noqa: E402  (bpy import)
import gen_textures  # noqa: E402

tex = args.tex or os.path.join(tempfile.gettempdir(), "ebike_tex")
if not args.tex:
    gen_textures.generate(tex)
C.TEX_DIR = tex

if args.only in (None, "city"):
    import city
    C.reset()
    city.build()
    C.export(os.path.join(OUT, "city.glb"))
if args.only in (None, "bike"):
    import bike
    C.reset()
    bike.build()
    C.export(os.path.join(OUT, "ebike.glb"))
if args.only in (None, "vehicles"):
    import vehicles
    for name, builder in vehicles.BUILDERS.items():
        C.reset()
        builder()
        C.export(os.path.join(OUT, f"{name}.glb"))
