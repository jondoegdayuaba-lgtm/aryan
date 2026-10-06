// All textures are drawn at runtime on canvases, so the game ships no image files.
import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, repeatX = 1, repeatY = repeatX) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}

// Seeded random so the textures look the same on every load.
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

const DISPLAY = '"Exo 2", "Arial Black", Impact, sans-serif';

function speckle(g, w, h, rand, count, colors, size = 2) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(rand() * colors.length) | 0];
    g.fillRect(rand() * w, rand() * h, size, size);
  }
}

function drawBanner(g, w, h, label, bg, fg) {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const sq = h / 6;
  for (let i = 0; i < w / sq; i++) {
    for (let r = 0; r < 2; r++) {
      g.fillStyle = (i + r) % 2 ? '#111318' : '#f5f5f5';
      g.fillRect(i * sq, r * sq, sq, sq);
      g.fillRect(i * sq, h - (r + 1) * sq, sq, sq);
    }
  }
  g.fillStyle = fg;
  g.font = `italic 800 ${Math.round(h * 0.42)}px ${DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, w / 2, h / 2 + 2);
}

export function makeTextures() {
  const T = {};
  const redraws = [];

  // Asphalt with white edge lines. u runs across the road, v along it.
  {
    const [c, g] = canvas(256, 512);
    const r = rng(7);
    g.fillStyle = '#80848e';
    g.fillRect(0, 0, 256, 512);
    speckle(g, 256, 512, r, 4200, ['#767a84', '#8a8e98', '#7b7f89', '#90939c'], 2);
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let i = 0; i < 6; i++) g.fillRect(r() * 220, 0, 24 + r() * 30, 512);   // faint tyre-worn bands
    g.fillStyle = '#eef0f4';
    g.fillRect(5, 0, 7, 512);
    g.fillRect(244, 0, 7, 512);
    T.road = toTexture(c, 1, 1);
  }

  // Grass: soft mottling, tiled.
  {
    const [c, g] = canvas(256);
    const r = rng(3);
    g.fillStyle = '#5aae50';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(76,160,70,0.35)' : 'rgba(104,186,92,0.3)';
      const x = r() * 256, y = r() * 256, s = 10 + r() * 34;
      for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, s, s * 0.7, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    speckle(g, 256, 256, r, 1500, ['#4f9f47', '#66b85a'], 2);
    T.grass = toTexture(c, 1, 1);
  }

  // Chequered strip for start and finish lines.
  {
    const [c, g] = canvas(256, 64);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#15171c' : '#f4f4f4';
        g.fillRect(i * 32, j * 32, 32, 32);
      }
    }
    T.checker = toTexture(c, 1, 1);
  }

  // Overhead banners. Redrawn once the display font has loaded.
  const banner = (key, label, bg, fg) => {
    const [c, g] = canvas(512, 96);
    const draw = () => drawBanner(g, 512, 96, label, bg, fg);
    draw();
    T[key] = toTexture(c, 1, 1);
    T[key].wrapS = T[key].wrapT = THREE.ClampToEdgeWrapping;
    redraws.push(() => { draw(); T[key].needsUpdate = true; });
  };
  banner('start', 'START', '#15171c', '#ffffff');
  banner('finish', 'FINISH', '#15171c', '#ffffff');

  // Checkpoint bar: yellow with black arrows pointing the way.
  {
    const [c, g] = canvas(512, 64);
    g.fillStyle = '#ffd21f';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#15171c';
    for (let i = 0; i < 9; i++) {
      const x = 22 + i * 56;
      g.beginPath();
      g.moveTo(x, 12); g.lineTo(x + 18, 32); g.lineTo(x, 52); g.lineTo(x + 12, 52); g.lineTo(x + 30, 32); g.lineTo(x + 12, 12);
      g.closePath();
      g.fill();
    }
    T.checkpoint = toTexture(c, 1, 1);
    T.checkpoint.wrapS = T.checkpoint.wrapT = THREE.ClampToEdgeWrapping;
  }

  // Corner warning board: black chevrons on yellow, pointing left.
  {
    const [c, g] = canvas(256, 96);
    g.fillStyle = '#ffd21f';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#15171c';
    for (let i = 0; i < 3; i++) {
      const x = 46 + i * 70;
      g.beginPath();
      g.moveTo(x + 26, 12); g.lineTo(x, 48); g.lineTo(x + 26, 84); g.lineTo(x + 46, 84); g.lineTo(x + 20, 48); g.lineTo(x + 46, 12);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#15171c';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 90);
    T.chevron = toTexture(c, 1, 1);
    T.chevron.wrapS = T.chevron.wrapT = THREE.ClampToEdgeWrapping;
  }

  // Hazard stripes for obstacles.
  {
    const [c, g] = canvas(128);
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffc21a';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 64, 0); g.lineTo(i * 64 + 32, 0); g.lineTo(i * 64 + 160, 128); g.lineTo(i * 64 + 128, 128);
      g.closePath();
      g.fill();
    }
    T.hazard = toTexture(c, 1, 1);
  }

  // Red and white bands (sweeper bars, hoops).
  {
    const [c, g] = canvas(128, 16);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f3f4f6' : '#e2342d';
      g.fillRect(i * 16, 0, 16, 16);
    }
    T.bands = toTexture(c, 1, 1);
  }

  // Boost pad: bright chevrons on deep blue, pointing up the texture (forward).
  {
    const [c, g] = canvas(128, 128);
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, '#0b3a8c');
    grad.addColorStop(0.5, '#1557d6');
    grad.addColorStop(1, '#0b3a8c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#5ff3ff';
    for (let i = 0; i < 2; i++) {
      const y = 12 + i * 64;
      g.beginPath();
      g.moveTo(14, y + 44); g.lineTo(64, y); g.lineTo(114, y + 44); g.lineTo(96, y + 50); g.lineTo(64, y + 22); g.lineTo(32, y + 50);
      g.closePath();
      g.fill();
    }
    T.boost = toTexture(c, 1, 1);
  }

  // Soft round puff for tyre smoke.
  {
    const [c, g] = canvas(64);
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    T.puff = toTexture(c, 1, 1);
  }

  // Sun glow.
  {
    const [c, g] = canvas(128);
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 63);
    grad.addColorStop(0, 'rgba(255,255,250,1)');
    grad.addColorStop(0.18, 'rgba(255,252,230,0.95)');
    grad.addColorStop(0.4, 'rgba(255,240,200,0.3)');
    grad.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    T.sun = toTexture(c, 1, 1);
  }

  // Sky: deep blue overhead fading to a pale horizon, with a band of clouds.
  // The top of the canvas is straight up, the middle row is the horizon.
  {
    const W = 2048, H = 512;
    const [c, g] = canvas(W, H);
    const grad = g.createLinearGradient(0, 0, 0, H / 2);
    grad.addColorStop(0, '#2f6fd6');
    grad.addColorStop(0.55, '#5d9ef0');
    grad.addColorStop(0.9, '#a9d3fb');
    grad.addColorStop(1, '#d4ecff');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H / 2);
    g.fillStyle = '#d4ecff';
    g.fillRect(0, H / 2, W, H / 2);
    const r = rng(19);
    const puff = (x, y, rx, ry, a) => {
      for (const dx of [0, W, -W]) {
        const gg = g.createRadialGradient(x + dx, y, 1, x + dx, y, rx);
        gg.addColorStop(0, `rgba(255,255,255,${a})`);
        gg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gg;
        g.save();
        g.translate(x + dx, y);
        g.scale(1, ry / rx);
        g.translate(-(x + dx), -y);
        g.beginPath();
        g.arc(x + dx, y, rx, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    };
    for (let i = 0; i < 26; i++) {
      const cx = r() * W, cy = H * (0.2 + r() * 0.24), n = 5 + ((r() * 6) | 0);
      const spread = 50 + r() * 120;
      for (let j = 0; j < n; j++) {
        puff(cx + (r() - 0.5) * spread * 2, cy + (r() - 0.5) * 14, 30 + r() * 60, 10 + r() * 16, 0.35 + r() * 0.35);
      }
    }
    T.sky = new THREE.CanvasTexture(c);
    T.sky.colorSpace = THREE.SRGBColorSpace;
    T.sky.wrapS = THREE.RepeatWrapping;
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.load(`italic 800 40px ${DISPLAY}`).then(() => redraws.forEach((f) => f())).catch(() => {});
  }
  return T;
}
