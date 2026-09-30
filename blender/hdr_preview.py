"""Tone-map an .hdr for a quick look:  python hdr_preview.py in.hdr out.png [exposure]"""
import sys
import numpy as np
import common as C
from common import bpy
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
exp = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
img = bpy.data.images.load(src)
arr = C.image_to_numpy(img)[..., :3] * exp
arr = arr / (1.0 + arr)                    # simple Reinhard
arr = np.clip(arr, 0, 1) ** (1 / 2.2)
Image.fromarray((arr * 255).astype(np.uint8)).save(dst)
print('preview', dst, arr.shape)
