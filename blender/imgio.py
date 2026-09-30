"""Small image and height-field codecs shared by the generators (numpy + Pillow only)."""
import numpy as np


def save_webp(img, path, quality=95):
    """Lossy WebP with a lossless alpha channel and the RGB under transparent texels kept: for the smooth mask textures and the
    foliage atlas, where it is 3 to 4 times smaller than PNG and indistinguishable at this quality."""
    from PIL import Image
    im = img if isinstance(img, Image.Image) else Image.fromarray(img)
    im.save(path, "WEBP", quality=quality, alpha_quality=100, method=6, exact=True)


def encode_heights(q):
    """uint16 heights [nz, nx] -> zigzag coded residuals of the 2-D predictor (left + above - above-left), little-endian uint16.
    gzip shrinks these about four times better than the raw heights. ski/js/world-data.js decodes them."""
    q = np.asarray(q, dtype=np.int32)
    pred = np.zeros_like(q)
    pred[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    pred[0, 1:] = q[0, :-1]
    pred[1:, 0] = q[:-1, 0]
    r = q - pred
    return ((r << 1) ^ (r >> 31)).astype("<u2")


def decode_heights(z, nz, nx):
    """inverse of encode_heights: the residuals are the mixed second difference, so two cumulative sums restore the field"""
    z = np.asarray(z, dtype=np.int64).reshape(nz, nx)
    r = (z >> 1) ^ -(z & 1)
    return (np.cumsum(np.cumsum(r, axis=1), axis=0) & 0xFFFF).astype("<u2")
