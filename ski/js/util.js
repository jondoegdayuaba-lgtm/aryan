// Small shared helpers (no three.js dependency so the physics can run in Node too).

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (e0, e1, x) => {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v < 0 ? -1 : 1);
export const DEG = Math.PI / 180;

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

/** Shortest signed angle difference a - b in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current, target, rate, dt) {
  return current + angleDiff(target, current) * (1 - Math.exp(-rate * dt));
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(seconds, digits = 2) {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const neg = seconds < 0;
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const txt = `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(digits)}`;
  return neg ? `-${txt}` : txt;
}

export function formatDelta(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const a = Math.abs(seconds);
  const txt = a >= 60 ? formatTime(a) : a.toFixed(2);
  return (seconds < 0 ? '-' : '+') + txt;
}

/**
 * Where a bundled asset really lives. The single-file desktop build unpacks its embedded assets into
 * blob: URLs and publishes the lookup as window.__assetUrl; from a web server the path is used as is.
 */
export const assetUrl = (path) => (typeof window !== 'undefined' && window.__assetUrl && window.__assetUrl(path)) || path;
