// The paper map: a hillshaded contour map of the valley drawn once, revealed only where the
// player has walked or looked from a high point.
import { makeCanvas } from './textures.js';
import { clamp } from './util.js';

const SIZE = 900;

export class MapView {
  constructor(world) {
    this.world = world;
    this.fogRes = 256;
    [this.fog, this.fogCtx] = makeCanvas(this.fogRes);
    this.fogCtx.fillStyle = 'rgba(0,0,0,0)';
    this.base = null;
    this.lastStamp = { x: 1e9, z: 1e9 };
  }

  _buildBase() {
    const w = this.world, V = w.v;
    const [c, g] = makeCanvas(SIZE);
    const img = g.createImageData(SIZE, SIZE);
    const d = img.data;
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < w.heights.length; i += 7) { mn = Math.min(mn, w.heights[i]); mx = Math.max(mx, w.heights[i]); }
    const sun = [-0.55, 0.65, -0.5], sl = Math.hypot(...sun);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const ix = Math.min(V - 1, Math.round((x / (SIZE - 1)) * (V - 1))), iz = Math.min(V - 1, Math.round((y / (SIZE - 1)) * (V - 1)));
        const i = iz * V + ix, h = w.heights[i];
        const nx = w.normalTex[i * 4] / 127.5 - 1, ny = w.normalTex[i * 4 + 1] / 127.5 - 1, nz = w.normalTex[i * 4 + 2] / 127.5 - 1;
        const lit = clamp((nx * sun[0] + ny * sun[1] + nz * sun[2]) / sl, 0, 1);
        const e = clamp((h - w.lakeY) / 430, 0, 1);
        let r = 178 + e * 40, gg = 168 + e * 10 - e * e * 30, b = 128 + e * 20;               // parchment green-brown to grey stone
        const forest = w.splat[i * 4 + 1] / 255;
        r -= forest * 30; gg -= forest * 6; b -= forest * 34;
        if (w.lakeMask[i] && h < w.lakeY) { const dp = clamp((w.lakeY - h) / 15, 0, 1); r = 120 - dp * 40; gg = 158 - dp * 40; b = 178 - dp * 20; }
        else if (w.riverDist[i] < w.riverHw[i]) { r = 110; gg = 150; b = 176; }
        const k = 0.6 + 0.6 * lit;
        r *= k; gg *= k; b *= k;
        const hh = h / 25, fr = hh - Math.floor(hh);
        const idx = Math.abs(h / 100 - Math.round(h / 100)) < 0.012;
        if (fr < 0.04 || idx) { const a = idx ? 0.55 : 0.28; r *= 1 - a; gg *= 1 - a; b *= 1 - a * 0.9; }
        const o = (y * SIZE + x) * 4;
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // trails as dashed brown lines
    g.strokeStyle = 'rgba(96,58,26,0.9)'; g.lineWidth = 1.6; g.setLineDash([5, 3]);
    const px = (x) => ((x + w.half) / w.size) * SIZE;
    for (const line of Object.values(w.trails)) {
      if (line.length < 2) continue;
      g.beginPath();
      line.forEach((p, i) => { const X = px(p.x), Y = px(p.z); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.stroke();
    }
    g.setLineDash([]);
    this.base = c;
  }

  // Reveals ground around a point. `radius` grows with height: a tower shows much more.
  reveal(x, z, radius) {
    const f = this.fogCtx, r = this.fogRes;
    const cx = ((x + this.world.half) / this.world.size) * r, cz = ((z + this.world.half) / this.world.size) * r;
    const rad = (radius / this.world.size) * r;
    const grad = f.createRadialGradient(cx, cz, rad * 0.55, cx, cz, rad);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    f.fillStyle = grad;
    f.fillRect(cx - rad, cz - rad, rad * 2, rad * 2);
  }

  // Marks the ground you can see from where you stand.
  update(px, py, pz) {
    if (Math.hypot(px - this.lastStamp.x, pz - this.lastStamp.z) < 12) return;
    this.lastStamp = { x: px, z: pz };
    const height = py - this.world.heightAt(px, pz);
    this.reveal(px, pz, 70 + clamp((py - this.world.lakeY - 20) * 1.4, 0, 400) + height * 3);
  }

  toJSON() { return this.fog.toDataURL(); }
  load(url) {
    if (!url) return;
    const im = new Image();
    im.onload = () => this.fogCtx.drawImage(im, 0, 0);
    im.src = url;
  }

  // markers: [{x, z, label, kind}]; player: {x, z, yaw}
  render(canvas, player, markers) {
    if (!this.base) this._buildBase();
    const g = canvas.getContext('2d'), S = canvas.width, w = this.world;
    g.clearRect(0, 0, S, S);
    // parchment
    g.fillStyle = '#d9cba6'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(120,90,40,${Math.random() * 0.05})`; g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 20, 1); }
    // revealed terrain through the fog mask
    const [t, tg] = makeCanvas(S);
    tg.imageSmoothingEnabled = true;
    tg.drawImage(this.base, 0, 0, S, S);
    tg.globalCompositeOperation = 'destination-in';
    tg.filter = 'blur(4px)';
    tg.drawImage(this.fog, 0, 0, S, S);
    g.drawImage(t, 0, 0);
    // border and grid ticks
    g.strokeStyle = 'rgba(70,52,28,0.6)'; g.lineWidth = 2; g.strokeRect(6, 6, S - 12, S - 12);
    g.fillStyle = 'rgba(70,52,28,0.7)'; g.font = '600 18px Oswald, sans-serif'; g.textAlign = 'center'; g.fillText('N', S / 2, 26);
    const px = (x) => ((x + w.half) / w.size) * S;
    g.textAlign = 'left';
    for (const m of markers) {
      const X = px(m.x), Y = px(m.z);
      g.fillStyle = m.kind === 'objective' ? '#e2531a' : '#4a3a20';
      g.beginPath();
      if (m.kind === 'objective') { g.moveTo(X, Y - 11); g.lineTo(X + 8, Y); g.lineTo(X, Y + 11); g.lineTo(X - 8, Y); } else g.arc(X, Y, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#efe6cf'; g.lineWidth = 2; g.stroke();
      if (m.label) { g.font = 'italic 600 17px Lora, serif'; g.fillStyle = '#3b2f1e'; g.strokeStyle = 'rgba(239,230,207,0.85)'; g.lineWidth = 4; g.strokeText(m.label, X + 11, Y + 5); g.fillText(m.label, X + 11, Y + 5); }
    }
    // the player: a red arrow pointing where you face (yaw 0 faces north)
    const X = px(player.x), Y = px(player.z);
    g.save(); g.translate(X, Y); g.rotate(-player.yaw);
    g.fillStyle = '#c62b1c'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
