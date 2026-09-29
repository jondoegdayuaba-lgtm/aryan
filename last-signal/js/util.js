// Small shared helpers: math, seeded random numbers, storage.

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Seeded random so the world looks the same on every load.
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

// Integer hash of two ints -> 0..1, for stateless scatter patterns.
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// localStorage can be unavailable (private windows, blocked storage); the game works without it.
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('last-signal:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('last-signal:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem('last-signal:' + key); } catch { /* ignore */ }
  },
};

export const $ = (id) => document.getElementById(id);

// Lets the browser paint and handle input between heavy start-up steps.
export const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatClock(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${pad2(h)}:${pad2(m)}`;
}
