"""Inline tools/blender/models.json into sky-hopper.html (keeps the game a single file).

Usage: python3 tools/blender/embed.py
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
html_path = os.path.join(ROOT, "sky-hopper.html")
data = open(os.path.join(ROOT, "tools", "blender", "models.json")).read()
html = open(html_path).read()
pattern = re.compile(r'(<script type="application/json" id="models-data">)(.*?)(</script>)', re.S)
assert pattern.search(html), "models-data block not found"
html = pattern.sub(lambda m: m.group(1) + data + m.group(3), html, count=1)
open(html_path, "w").write(html)
print("Embedded", len(data) // 1024, "KB of model data into", html_path)
