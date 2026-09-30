// The map of the open world: a heading-up minimap in the HUD, the full map screen and the compass strip.
// Everything is drawn on 2D canvases in world coordinates (metres) on top of the baked hillshade map.
import { clamp } from './util.js';

const LEVEL_COLOUR = { green: '#2fa84f', blue: '#2f7dff', red: '#e0352b', black: '#15161a' };
const TAU = Math.PI * 2;

export class MapUI {
  /**
   * @param world WorldData of the open world
   * @param base  image element / canvas with the hillshade map (covers the whole height field)
   */
  constructor(world, base) {
    this.world = world;
    this.base = base;
    this.ex = world.x1 - world.x0;
    this.ez = world.z1 - world.z0;
    this.overlay = this._buildOverlay(1536);
    this.mini = null;
    this.hits = [];
  }

  // ---------------------------------------------------------------- static overlay
  _buildOverlay(size) {
    const w = this.world;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const k = size / this.ex;
    const px = (x) => (x - w.x0) * k, pz = (z) => (z - w.z0) * k;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // pistes: a white casing under the colour so they read on snow and forest alike
    for (const pst of w.pistes) {
      const s = pst.sampler;
      c.beginPath();
      for (let d = s.s0; d <= s.sEnd; d += 12) {
        const p = s.at(d, _p);
        if (d === s.s0) c.moveTo(px(p.x), pz(p.z)); else c.lineTo(px(p.x), pz(p.z));
      }
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 6.5;
      c.stroke();
      c.strokeStyle = LEVEL_COLOUR[pst.level] || '#333';
      c.lineWidth = 3.4;
      c.stroke();
    }
    // lifts
    c.setLineDash([9, 6]);
    for (const lf of w.info.lifts || []) {
      c.beginPath();
      lf.points.forEach(([x, z], i) => (i ? c.lineTo(px(x), pz(z)) : c.moveTo(px(x), pz(z))));
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 5;
      c.stroke();
      c.strokeStyle = '#1b1f2a';
      c.lineWidth = 2.4;
      c.stroke();
    }
    c.setLineDash([]);
    for (const lf of w.info.lifts || []) {
      for (const [x, z] of [lf.points[0], lf.points[lf.points.length - 1]]) {
        c.beginPath();
        c.arc(px(x), pz(z), 5, 0, TAU);
        c.fillStyle = '#1b1f2a';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#fff';
        c.stroke();
      }
    }
    // buildings
    c.fillStyle = '#5a3b22';
    for (const b of w.info.buildings || []) c.fillRect(px(b.x) - 2.2, pz(b.z) - 2.2, 4.4, 4.4);
    return cv;
  }

  // ------------------------------------------------------------------- minimap
  /** draw the heading-up minimap into canvas `cv`; state = { x, z, yaw, taken:Set, flagList, landmarks, foundSet:Set } */
  drawMini(cv, st, viewM = 1100) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const w = this.world;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 2, 0, TAU);
    c.clip();
    c.fillStyle = '#1a2233';
    c.fillRect(0, 0, W, H);
    const k = W / viewM;
    c.translate(W / 2, H / 2);
    c.rotate(-st.yaw);
    c.scale(k, k);
    c.translate(-st.x, -st.z);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, w.x0, w.z0, this.ex, this.ez);
    c.drawImage(this.overlay, w.x0, w.z0, this.ex, this.ez);
    this._markers(c, st, k, false);
    c.restore();
    // rim, north tick and the player
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 2, 0, TAU);
    c.stroke();
    const r = W / 2 - 13;
    c.fillStyle = '#fff';
    c.font = `700 ${Math.round(W * 0.075)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', W / 2 - r * Math.sin(st.yaw), H / 2 - r * Math.cos(st.yaw));
    this._arrow(c, W / 2, H / 2, W * 0.055, 0);
  }

  _arrow(c, x, y, r, ang) {
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(0, -r * 1.25);
    c.lineTo(r * 0.85, r);
    c.lineTo(0, r * 0.45);
    c.lineTo(-r * 0.85, r);
    c.closePath();
    c.fillStyle = '#ffdd55';
    c.strokeStyle = '#1b1f2a';
    c.lineWidth = r * 0.28;
    c.stroke();
    c.fill();
    c.restore();
  }

  _markers(c, st, k, full) {
    const w = this.world;
    const u = 1 / k;                                    // one canvas pixel in metres
    // flags: collected ones green, close uncollected ones red
    (st.flagList || []).forEach((f, i) => {
      const taken = st.taken && st.taken.has(i);
      if (full && !taken) return;
      const d2 = (f.x - st.x) ** 2 + (f.z - st.z) ** 2;
      if (!taken && d2 > 420 * 420) return;
      c.beginPath();
      c.arc(f.x, f.z, (full ? 5 : 4.5) * u, 0, TAU);
      c.fillStyle = taken ? '#37c46a' : '#ff3b30';
      c.fill();
      c.lineWidth = 1.5 * u;
      c.strokeStyle = '#fff';
      c.stroke();
    });
    // places
    for (const l of st.landmarks || []) {
      const got = st.foundSet && st.foundSet.has(l.id);
      if (!full && !got && (l.x - st.x) ** 2 + (l.z - st.z) ** 2 > 700 * 700) continue;
      const r = (full ? 7 : 5.5) * u;
      c.beginPath();
      c.moveTo(l.x, l.z - r); c.lineTo(l.x + r, l.z); c.lineTo(l.x, l.z + r); c.lineTo(l.x - r, l.z);
      c.closePath();
      c.fillStyle = got ? '#ffd23f' : 'rgba(255,255,255,0.35)';
      c.fill();
      c.lineWidth = 1.6 * u;
      c.strokeStyle = '#1b1f2a';
      c.stroke();
      if (full && got) {
        c.save();
        c.translate(l.x + r * 1.4, l.z);
        c.scale(u, u);
        c.font = '600 13px system-ui, sans-serif';
        c.textBaseline = 'middle';
        c.lineWidth = 3.5;
        c.strokeStyle = 'rgba(255,255,255,0.9)';
        c.strokeText(l.name, 0, 0);
        c.fillStyle = '#1b1f2a';
        c.fillText(l.name, 0, 0);
        c.restore();
      }
    }
    if (full) {
      // names of lifts and pistes
      c.save();
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      for (const lf of w.info.lifts || []) {
        const m = lf.points[Math.floor(lf.points.length / 2)];
        this._label(c, m[0], m[1], lf.name, '#1b1f2a', u, 12);
      }
      for (const pst of w.pistes) {
        const s = pst.sampler;
        const p = s.at(s.s0 + (s.sEnd - s.s0) * 0.38, _p);
        this._label(c, p.x, p.z, pst.name, LEVEL_COLOUR[pst.level], u, 12);
      }
      c.restore();
    }
  }

  _label(c, x, z, text, colour, u, px) {
    c.save();
    c.translate(x, z);
    c.scale(u, u);
    c.font = `700 ${px}px system-ui, sans-serif`;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.strokeText(text, 0, 0);
    c.fillStyle = colour;
    c.fillText(text, 0, 0);
    c.restore();
  }

  // ---------------------------------------------------------------------- full map
  /** draw the whole map into `cv`; returns nothing, fills this.hits with clickable fast-travel targets */
  drawFull(cv, st) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const w = this.world;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#1a2233';
    c.fillRect(0, 0, W, H);
    const k = W / this.ex;
    c.save();
    c.scale(k, k);
    c.translate(-w.x0, -w.z0);
    c.drawImage(this.base, w.x0, w.z0, this.ex, this.ez);
    c.drawImage(this.overlay, w.x0, w.z0, this.ex, this.ez);
    this._markers(c, st, k, true);
    // the player
    c.restore();
    const px = (st.x - w.x0) * k, pz = (st.z - w.z0) * k;
    this._arrow(c, px, pz, 11, st.yaw);
    // grid ticks every km
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.font = '600 12px system-ui, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText('N ↑', 10, 8);
    c.textAlign = 'right';
    c.fillText('1 km', W - 14, H - 22);
    c.fillRect(W - 14 - 1000 * k, H - 12, 1000 * k, 3);
  }

  /** map pixel -> world metres (for click-to-travel) */
  fromCanvas(cv, ex, ey) {
    const r = cv.getBoundingClientRect();
    const u = (ex - r.left) / r.width, v = (ey - r.top) / r.height;
    return { x: this.world.x0 + u * this.ex, z: this.world.z0 + v * this.ez };
  }
}

const _p = {};

/** compass strip: heading letters and the direction of the nearest flag */
export function drawCompass(cv, yaw, target) {
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const span = Math.PI * 0.9;                                  // visible field, radians
  const wrap = (v) => ((v % TAU) + TAU) % TAU;
  const px = (a) => W / 2 + (wrap(a - yaw + Math.PI) - Math.PI) / span * W;
  c.font = `700 ${Math.round(H * 0.44)}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16;
    const x = px(a);
    if (x < -20 || x > W + 20) continue;
    const major = i % 4 === 0;
    const name = ['N', '', '', '', 'E', '', '', '', 'S', '', '', '', 'W', '', '', ''][i];
    const edge = clamp(1 - Math.abs(x - W / 2) / (W / 2), 0, 1);
    c.fillStyle = `rgba(255,255,255,${0.15 + 0.85 * edge})`;
    if (major) c.fillText(name, x, H * 0.42);
    else c.fillRect(x - 1, H * 0.3, 2, H * 0.24);
  }
  c.fillStyle = '#ffdd55';
  c.beginPath();
  c.moveTo(W / 2, H * 0.78); c.lineTo(W / 2 - 6, H * 0.98); c.lineTo(W / 2 + 6, H * 0.98);
  c.closePath();
  c.fill();
  if (target) {
    // bearing of the target: yaw convention forward = (sin yaw, -cos yaw)
    const bearing = Math.atan2(target.dx, -target.dz);
    let x = px(bearing);
    const inside = x > 8 && x < W - 8;
    x = clamp(x, 10, W - 10);
    c.fillStyle = '#ff3b30';
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, H * 0.06);
    c.lineTo(x - 7, H * 0.3);
    c.lineTo(x + 7, H * 0.3);
    c.closePath();
    c.fill();
    c.stroke();
    void inside;
  }
}
