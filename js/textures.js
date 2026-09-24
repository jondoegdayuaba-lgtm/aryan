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
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gridTexture({ bg, major, minor, label, labelColor, size = 256, minorDivs = 4, lineWidth = 3 }) {
  const [c, g] = canvas(size);
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  if (minor) {
    g.strokeStyle = minor;
    g.lineWidth = 1;
    for (let i = 1; i < minorDivs; i++) {
      const p = (i * size) / minorDivs + 0.5;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    }
  }
  g.strokeStyle = major;
  g.lineWidth = lineWidth;
  g.strokeRect(lineWidth / 2, lineWidth / 2, size - lineWidth, size - lineWidth);
  if (label) {
    g.save();
    g.fillStyle = labelColor;
    g.font = `bold ${Math.round(size * 0.055)}px monospace`;
    g.translate(size * 0.9, size * 0.94);
    g.rotate(-Math.PI / 2);
    g.fillText(label, 0, 0);
    g.font = `${Math.round(size * 0.035)}px monospace`;
    g.fillText('4 x 4 UNITS', 0, size * 0.05);
    g.restore();
  }
  return c;
}

export function makeTextures() {
  const T = {};

  T.testFloor = toTexture(gridTexture({
    bg: '#2b2f57', major: '#8d95d6', minor: '#394072', label: 'TEST GRID', labelColor: '#6f77b8',
  }), 55, 50);

  T.lavenderWall = gridTexture({ bg: '#dcd8f4', major: '#b9b3e6', minor: '#cfcaf0', size: 128, minorDivs: 2, lineWidth: 2 });
  T.orangeGrid = gridTexture({ bg: '#26121a', major: '#ff8a1f', minor: '#6b2c1c', label: 'TYPE B', labelColor: '#ff8a1f', size: 256, minorDivs: 4, lineWidth: 4 });

  T.grass = toTexture(gridTexture({ bg: '#2f9442', major: '#2a8a3b', minor: '#309a44', size: 128, minorDivs: 2, lineWidth: 2 }), 300, 300);

  // Hazard stripes (used on gates, hangar door and the Hornet skin).
  {
    const [c, g] = canvas(128);
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f4b400';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 64, 0); g.lineTo(i * 64 + 32, 0); g.lineTo(i * 64 + 32 + 128, 128); g.lineTo(i * 64 + 128, 128);
      g.closePath(); g.fill();
    }
    T.hazard = c;
  }

  // Pinkish brick like an old warehouse.
  {
    const r = rng(7);
    const [c, g] = canvas(512);
    g.fillStyle = '#e3c6c6';
    g.fillRect(0, 0, 512, 512);
    const bw = 64, bh = 24;
    for (let row = 0; row < 512 / bh + 1; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < 512 / bw + 1; col++) {
        const v = r();
        const l = 62 + v * 10;
        g.fillStyle = `hsl(${355 + r() * 8}, ${28 + r() * 10}%, ${l}%)`;
        g.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    T.brick = c;
  }

  // Window panes.
  {
    const [c, g] = canvas(128);
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#9fd0ff');
    grad.addColorStop(0.5, '#5d8fd8');
    grad.addColorStop(1, '#a9c7f2');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#2d2a38';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 122, 122);
    g.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo((i * 128) / 4, 0); g.lineTo((i * 128) / 4, 128); g.stroke();
    }
    for (let i = 1; i < 3; i++) {
      g.beginPath(); g.moveTo(0, (i * 128) / 3); g.lineTo(128, (i * 128) / 3); g.stroke();
    }
    T.window = toTexture(c);
  }

  // Desert camo.
  {
    const r = rng(42);
    const [c, g] = canvas(256);
    g.fillStyle = '#b89a66';
    g.fillRect(0, 0, 256, 256);
    const cols = ['#7a6a45', '#4b4331', '#d4bf8f', '#2d281e'];
    for (let i = 0; i < 70; i++) {
      g.fillStyle = cols[i % cols.length];
      const x = r() * 256, y = r() * 256, s = 8 + r() * 22;
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = s * (0.6 + r() * 0.6);
        const px = x + Math.cos(a) * rr * 1.6, py = y + Math.sin(a) * rr * 0.7;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    }
    T.camo = c;
  }

  // Glow sprite for the rocket exhaust.
  {
    const [c, g] = canvas(128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.25, 'rgba(255,190,60,0.9)');
    grad.addColorStop(0.6, 'rgba(255,90,20,0.35)');
    grad.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    T.glow = new THREE.CanvasTexture(c);
    T.glow.colorSpace = THREE.SRGBColorSpace;
  }

  // Hangar wall screens ("pad 01", "pad 02", ...).
  T.screens = [];
  for (let n = 1; n <= 4; n++) {
    const [c, g] = canvas(256, 160);
    g.fillStyle = '#10121c';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#3b4266';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 154);
    g.fillStyle = '#e8ecff';
    g.beginPath(); g.arc(90, 70, 20, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(90, 122, 34, 20, 0, Math.PI, 0); g.fill();
    g.font = 'bold 44px monospace';
    g.fillText(`0${n}`, 138, 100);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    T.screens.push(t);
  }

  T.repeat = (src, rx, ry) => toTexture(src, rx, ry);
  return T;
}
