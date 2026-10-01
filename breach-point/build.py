"""Builds breach-point.html (one self-contained file) from breach-point/src.

    python breach-point/build.py

src/00-head.html holds the page and styles; the src/*.js files are joined in name order inside one
function scope; breach-point/models.glb (made by models.py in Blender) is embedded as base64.
"""
import argparse, base64, sys
from pathlib import Path

here = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--glb', default=str(here / 'models.glb'), help='models file to embed')
ap.add_argument('--out', default=str(here.parent / 'breach-point.html'), help='page to write')
ap.add_argument('--extra', action='append', default=[], help='also include the .js files of this folder (drafts); joined in name order with src')
args = ap.parse_args()
src = here / 'src'
head = (src / '00-head.html').read_text()
files = list(src.glob('*.js')) + [p for d in args.extra for p in Path(d).glob('*.js')]
js = '\n'.join(p.read_text() for p in sorted(files, key=lambda p: p.name))
sys.path.insert(0, str(here / 'tools'))
from glbpack import pack
glb = base64.b64encode(pack(Path(args.glb).read_bytes())).decode()
page = (head
        + '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
        + '<script>\n/* Characters, weapons and props modelled in Blender (breach-point/models.py), stored as GLB */\n'
        + f'const MODELS_GLB="{glb}";\n</script>\n'
        + '<script>\n' + js + '\n})();\n</script>\n</body>\n</html>\n')
out = Path(args.out)
out.write_text(page)
print(f'wrote {out.name}: {len(page) // 1024} KB')
