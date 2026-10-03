// Small math helpers shared across the game.
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential smoothing toward a target.
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
export const dampAngle = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
export const approach = (a, b, step) => (a < b ? Math.min(a + step, b) : Math.max(a - step, b));
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const money = (n) => '$' + n.toFixed(2);

// localStorage can be missing or throw (private mode, blocked storage).
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: progress just won't persist */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
