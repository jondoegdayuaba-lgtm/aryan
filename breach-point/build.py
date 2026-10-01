"""Builds breach-point.html (one self-contained file) from breach-point/src.

    python breach-point/build.py

src/00-head.html holds the page and styles; the src/*.js files are joined in name order inside one
function scope; breach-point/models.glb (made by models.py in Blender) is embedded as base64.
"""
import base64
from pathlib import Path

here = Path(__file__).resolve().parent
src = here / 'src'
head = (src / '00-head.html').read_text()
js = '\n'.join(p.read_text() for p in sorted(src.glob('*.js')))
glb = base64.b64encode((here / 'models.glb').read_bytes()).decode()
page = (head
        + '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
        + '<script>\n/* Characters, weapons and props modelled in Blender (breach-point/models.py), stored as GLB */\n'
        + f'const MODELS_GLB="{glb}";\n</script>\n'
        + '<script>\n' + js + '\n})();\n</script>\n</body>\n</html>\n')
out = here.parent / 'breach-point.html'
out.write_text(page)
print(f'wrote {out.name}: {len(page) // 1024} KB')
