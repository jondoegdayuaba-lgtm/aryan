"""numpy-only noise helpers shared by the generators and the Blender scripts (no scipy needed)."""
import numpy as np


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def spectral_noise(shape, dx, lam_min, lam_max, beta, rng):
    """Band-limited 1/f^beta noise with unit standard deviation (periodic)."""
    nz, nx = shape
    kz = np.fft.fftfreq(nz, d=dx)[:, None]
    kx = np.fft.rfftfreq(nx, d=dx)[None, :]
    k = np.sqrt(kx ** 2 + kz ** 2)
    k[0, 0] = 1.0
    filt = k ** (-beta / 2.0)
    filt *= 1.0 / (1.0 + (k * lam_min) ** 4)
    filt *= 1.0 / (1.0 + (1.0 / (k * lam_max)) ** 4)
    filt[0, 0] = 0.0
    spec = np.fft.rfft2(rng.standard_normal(shape)) * filt
    out = np.fft.irfft2(spec, s=shape)
    return (out / out.std()).astype(np.float32)


def ridged(n, power=1.6, scale=2.6):
    r = 1.0 - np.abs(np.clip(n / scale, -1.0, 1.0))
    return r ** power
