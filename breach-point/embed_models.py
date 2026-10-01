"""Re-embed Blender models into breach-point.html.

Usage (from the repo root):
    python breach-point/models.py breach-point/models.glb   # needs the bpy module (Python 3.11: pip install bpy==4.2.0)
    python breach-point/embed_models.py breach-point/models.glb
"""
import base64, re, sys
from pathlib import Path

glb = Path(sys.argv[1] if len(sys.argv) > 1 else 'breach-point/models.glb')
html = Path(__file__).resolve().parent.parent / 'breach-point.html'
data = base64.b64encode(glb.read_bytes()).decode()
src = html.read_text()
new, n = re.subn(r'const MODELS_GLB="[A-Za-z0-9+/=]*";', lambda m: f'const MODELS_GLB="{data}";', src)
if n != 1:
    sys.exit('MODELS_GLB not found in breach-point.html')
html.write_text(new)
print(f'embedded {glb} ({glb.stat().st_size} bytes) into {html.name}')
