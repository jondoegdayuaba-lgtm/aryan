// Player settings (saved in localStorage when available) and graphics presets.

const KEY = 'canyon-rush:';

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(KEY + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(KEY + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

export const QUALITY = {
  low: { pixelRatio: 1, renderScale: 0.72, minScale: 0.5, msaa: 1, shadow: 1024, grid: 16, scatter: { dist: 0.6, density: 0.5 }, bakeStep: 2, soft: false },
  medium: { pixelRatio: 1.25, renderScale: 0.85, minScale: 0.55, msaa: 2, shadow: 2048, grid: 16, scatter: { dist: 0.8, density: 1 }, bakeStep: 2, soft: true },
  high: { pixelRatio: 1.5, renderScale: 1, minScale: 0.6, msaa: 4, shadow: 2048, grid: 32, scatter: { dist: 1, density: 1 }, bakeStep: 1, soft: true },
  ultra: { pixelRatio: 2, renderScale: 1, minScale: 0.7, msaa: 4, shadow: 4096, grid: 32, scatter: { dist: 1.35, density: 1 }, bakeStep: 1, soft: true },
};

export function autoQuality() {
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  if (coarse || small) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores <= 4 ? 'medium' : 'high';
}

export function loadSettings() {
  const s = {
    quality: store.get('quality', 'auto'),
    time: store.get('time', 'golden'),
    units: store.get('units', 'kmh'),
    volume: store.get('volume', 0.8),
    shake: store.get('shake', true),
    bike: store.get('bike', 0),
    muted: store.get('muted', false),
  };
  const q = new URLSearchParams(location.search);
  if (q.has('quality')) s.quality = q.get('quality');
  if (q.has('time')) s.time = q.get('time');
  s.qualityName = s.quality === 'auto' ? autoQuality() : s.quality;
  s.q = QUALITY[s.qualityName] || QUALITY.high;
  return s;
}
