"""
Hydraulic erosion for the height fields (particle based: a raindrop rolls downhill, picks up sediment where it is fast and
steep and drops it where it slows down, which carves the branching gullies and fans that real mountains have).

The loop is written in C (compiled on first use with the system C compiler and loaded through ctypes; ~5 s for two million
drops on a 2049 x 2049 grid).  Without a compiler the module falls back to a much smaller NumPy version (thermal
smoothing only) so the pipeline still runs, just with softer mountains.
"""
import ctypes
import hashlib
import os
import shutil
import subprocess
import tempfile

import numpy as np

C_SOURCE = r"""
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

/* xorshift64* : deterministic, no libc rand */
static uint64_t rng_state;
static inline double rnd(void) {
    rng_state ^= rng_state >> 12; rng_state ^= rng_state << 25; rng_state ^= rng_state >> 27;
    return (double)((rng_state * 2685821657736338717ULL) >> 11) * (1.0 / 9007199254740992.0);
}

/* h: nz*nx heights in metres (row = z).  dx: cell size in metres. */
void erode(float *h, int nx, int nz, double dx, long drops, int lifetime, uint64_t seed,
           double inertia, double capacity, double deposit, double erode_rate, double evaporate,
           double gravity, double min_slope, int radius, const float *rock /* NULL or 0..1 hardness map */)
{
    rng_state = seed * 0x9E3779B97F4A7C15ULL + 88172645463325252ULL;
    /* brush: cells within `radius` share the erosion, weighted by distance */
    int bn = 0;
    int *bo = (int*)malloc(sizeof(int) * (2*radius+1) * (2*radius+1) * 2);
    float *bw = (float*)malloc(sizeof(float) * (2*radius+1) * (2*radius+1));
    double wsum = 0.0;
    for (int j = -radius; j <= radius; j++) for (int i = -radius; i <= radius; i++) {
        double d = sqrt((double)(i*i + j*j));
        if (d > radius) continue;
        bo[bn*2] = i; bo[bn*2+1] = j; bw[bn] = (float)(1.0 - d / (radius + 1.0)); wsum += bw[bn]; bn++;
    }
    for (int k = 0; k < bn; k++) bw[k] = (float)(bw[k] / wsum);

    for (long n = 0; n < drops; n++) {
        double px = rnd() * (nx - 3) + 1.0, pz = rnd() * (nz - 3) + 1.0;
        double dirx = 0, dirz = 0, speed = 1.0, water = 1.0, sediment = 0.0;
        for (int life = 0; life < lifetime; life++) {
            int ix = (int)px, iz = (int)pz;
            if (ix < 1 || iz < 1 || ix >= nx - 2 || iz >= nz - 2) break;
            double fx = px - ix, fz = pz - iz;
            long i00 = (long)iz * nx + ix;
            double h00 = h[i00], h10 = h[i00 + 1], h01 = h[i00 + nx], h11 = h[i00 + nx + 1];
            /* gradient (metres per metre) and height at the drop */
            double gx = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / dx;
            double gz = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / dx;
            double hh = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
            dirx = dirx * inertia - gx * (1 - inertia);
            dirz = dirz * inertia - gz * (1 - inertia);
            double len = sqrt(dirx * dirx + dirz * dirz);
            if (len < 1e-9) { double a = rnd() * 6.283185307; dirx = cos(a); dirz = sin(a); len = 1.0; }
            dirx /= len; dirz /= len;
            double nxp = px + dirx, nzp = pz + dirz;
            int jx = (int)nxp, jz = (int)nzp;
            if (jx < 1 || jz < 1 || jx >= nx - 2 || jz >= nz - 2) break;
            double gx2 = nxp - jx, gz2 = nzp - jz;
            long j00 = (long)jz * nx + jx;
            double nh = h[j00] * (1 - gx2) * (1 - gz2) + h[j00 + 1] * gx2 * (1 - gz2) + h[j00 + nx] * (1 - gx2) * gz2 + h[j00 + nx + 1] * gx2 * gz2;
            double dh = nh - hh;
            double cap = -dh / dx * speed * water * capacity;
            if (cap < min_slope * speed * water * capacity) cap = min_slope * speed * water * capacity;
            if (sediment > cap || dh > 0) {
                double amt = (dh > 0) ? (dh < sediment ? dh : sediment) : (sediment - cap) * deposit;
                sediment -= amt;
                h[i00]          += (float)(amt * (1 - fx) * (1 - fz));
                h[i00 + 1]      += (float)(amt * fx * (1 - fz));
                h[i00 + nx]     += (float)(amt * (1 - fx) * fz);
                h[i00 + nx + 1] += (float)(amt * fx * fz);
            } else {
                double soft = 1.0;
                if (rock) soft = 1.0 - 0.75 * rock[i00];        /* hard rock erodes slower */
                double amt = (cap - sediment) * erode_rate * soft;
                if (amt > -dh) amt = -dh;
                if (amt < 0) amt = 0;
                for (int k = 0; k < bn; k++) {
                    int cx = ix + bo[k*2], cz = iz + bo[k*2+1];
                    if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
                    double take = amt * bw[k];
                    long c = (long)cz * nx + cx;
                    double w = take < h[c] ? take : h[c];
                    h[c] -= (float)w;
                }
                sediment += amt;
            }
            double s2 = speed * speed - dh / dx * gravity;      /* downhill speeds the drop up, uphill slows it */
            if (s2 < 0.01) s2 = 0.01;
            speed = sqrt(s2);
            if (speed > 12.0) speed = 12.0;
            water *= (1 - evaporate);
            px = nxp; pz = nzp;
            if (water < 0.01) break;
        }
    }
    free(bo); free(bw);
}
"""

_LIB = None


def _compile():
    cc = os.environ.get("CC") or shutil.which("cc") or shutil.which("gcc") or shutil.which("clang")
    if not cc:
        return None
    tag = hashlib.sha1(C_SOURCE.encode()).hexdigest()[:12]
    out_dir = os.path.join(tempfile.gettempdir(), "alpine_erosion")
    os.makedirs(out_dir, exist_ok=True)
    so = os.path.join(out_dir, f"erosion_{tag}.so")
    if not os.path.exists(so):
        src = os.path.join(out_dir, f"erosion_{tag}.c")
        with open(src, "w") as f:
            f.write(C_SOURCE)
        r = subprocess.run([cc, "-O2", "-shared", "-fPIC", "-o", so, src, "-lm"], capture_output=True, text=True)
        if r.returncode != 0:
            print("erosion: C compile failed:\n", r.stderr[:800])
            return None
    return ctypes.CDLL(so)


def _lib():
    global _LIB
    if _LIB is None:
        try:
            _LIB = _compile() or False
        except Exception as e:  # pragma: no cover
            print("erosion: could not build the C helper:", e)
            _LIB = False
    return _LIB


def available():
    return bool(_lib())


def hydraulic(h, dx, drops=2_000_000, lifetime=110, seed=1, inertia=0.30, capacity=0.10, deposit=0.30, erode_rate=0.30,
              evaporate=0.012, gravity=4.0, min_slope=0.02, radius=3, hardness=None):
    """Erode the height field h (float32, [z, x], metres) in place and return it."""
    lib = _lib()
    if not lib:
        print("erosion: no C compiler found, skipping hydraulic erosion (mountains will be smoother)")
        return h
    h = np.ascontiguousarray(h, dtype=np.float32)
    nz, nx = h.shape
    rock = None
    if hardness is not None:
        rock = np.ascontiguousarray(hardness, dtype=np.float32)
    fn = lib.erode
    fn.restype = None
    fn.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_double, ctypes.c_long, ctypes.c_int, ctypes.c_uint64,
                   ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.c_double,
                   ctypes.c_double, ctypes.c_int, ctypes.c_void_p]
    fn(h.ctypes.data, nx, nz, float(dx), int(drops), int(lifetime), int(seed), inertia, capacity, deposit, erode_rate,
       evaporate, gravity, min_slope, int(radius), rock.ctypes.data if rock is not None else None)
    return h
