// Obstacles on the road: swinging hammers, spinning sweepers, pistons that
// shove out of the walls and bollard slaloms. Everything moves as a function
// of the race clock, so a run plays out the same every time and ghosts stay
// in sync. No rendering here (obstaclemesh.js draws them), so the track
// checker can drive through them headless.
//
// Each obstacle sits at a distance s along the track and works in its own
// frame: a along the road, l to the right, h up from the road.
import { KERB } from './path.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CAR_R = 1.05;              // the car is two circles this size...
const CAR_OFF = 1.15;            // ...this far ahead of and behind its centre
const CAR_H = 1.3;

export const KINDS = {
  // A big block on an arm, swinging side to side across the road from a gantry.
  hammer: {
    period: 2.8, amp: 1.05, pivot: 9.6, arm: 7.2, head: { ha: 1.5, hl: 2.5, hh: 1.25 },
    angle(t, o) { return this.amp * Math.sin(TAU * (t / this.period + o.phase)); },
    shapes(o, t, out) {
      const th = this.angle(t, o);
      const w = (TAU / this.period) * this.amp * Math.cos(TAU * (t / this.period + o.phase));
      const { ha, hl, hh } = this.head;
      out.push({ a: 0, l: this.arm * Math.sin(th), h: this.pivot - this.arm * Math.cos(th), ha, hl, hh, ang: 0,
        va: 0, vl: this.arm * Math.cos(th) * w });
    },
  },

  // A long bar spinning low over the road round a post in the middle.
  sweeper: {
    speed: 1.25, len: 7.4, post: 0.9,
    angle(t, o) { return this.speed * t + o.phase * TAU; },
    shapes(o, t, out) {
      out.push({ circle: true, a: 0, l: 0, r: this.post, h0: 0, h1: 2.6 });
      out.push({ a: 0, l: 0, h: 0.95, ha: this.len, hl: 0.32, hh: 0.32, ang: this.angle(t, o), spin: this.speed });
    },
    line: (a) => (Math.abs(a) < 30 ? 4 * Math.cos((a / 30) * Math.PI / 2) : 0),   // pass on the right of the post
  },

  // Two rows of blocks punching in and out from the sides, out of step.
  pistons: {
    period: 2.6, rows: [-6, 6], reach: 0.82,
    out(t, o, row, side) {
      const k = TAU * (t / this.period + o.phase) + row * Math.PI + (side > 0 ? 0 : Math.PI);
      return [(Math.sin(k) + 1) / 2, (Math.cos(k) * TAU) / this.period / 2];
    },
    shapes(o, t, out) {
      const W = o.hw + KERB;
      this.rows.forEach((a, row) => {
        for (const side of [1, -1]) {
          const [x, dx] = this.out(t, o, row, side);
          const inner = W - x * W * this.reach, outer = W + 1.2;
          out.push({ a, l: side * (inner + outer) / 2, h: 1.1, ha: 2.2, hl: (outer - inner) / 2, hh: 1.1, ang: 0,
            va: 0, vl: -side * (dx * W * this.reach) / 2 });
        }
      });
    },
  },

  // Rows of posts blocking alternate halves of the road: weave through.
  bollards: bollards([-21, -7, 7, 21]),
  // A shorter slalom that fits one editor square.
  slalom: bollards([-7, 7]),
};

function bollards(rows) {
  return {
    rows, limit: 26, span: rows[rows.length - 1] + 9, from: 1.4,
    posts(o) {
      const W = o.hw + KERB, out = [];
      this.rows.forEach((a, k) => {
        const side = k % 2 ? -1 : 1;
        for (let l = this.from; l < W; l += 1.6) out.push([a, side * l]);
      });
      return out;
    },
    shapes(o, t, out) {
      for (const [a, l] of o.posts || (o.posts = this.posts(o))) out.push({ circle: true, a, l, r: 0.45, h0: 0, h1: 1.2 });
    },
    line(a, o) {
      const W = o.hw + KERB;
      if (a < this.rows[0] - 12 || a > this.rows[this.rows.length - 1] + 12) return 0;
      // Through the open half of each row, smoothly from one to the next.
      const pts = this.rows.map((r, k) => [r, (k % 2 ? 1 : -1) * Math.min(2.8, W * 0.35)]);
      if (a <= pts[0][0]) return pts[0][1] * clamp(1 - (pts[0][0] - a) / 12, 0, 1);
      for (let k = 0; k < pts.length - 1; k++) {
        if (a <= pts[k + 1][0]) {
          const u = (a - pts[k][0]) / (pts[k + 1][0] - pts[k][0]);
          return pts[k][1] + (pts[k + 1][1] - pts[k][1]) * (u * u * (3 - 2 * u));
        }
      }
      const last = pts[pts.length - 1];
      return last[1] * clamp(1 - (a - last[0]) / 12, 0, 1);
    },
  };
}

export class Obstacles {
  constructor(path) {
    this.path = path;
    this.list = path.obstacleDefs.filter((d) => KINDS[d.kind]).map((d) => {
      const o = path.at(d.s, {});
      return { ...d, type: KINDS[d.kind], x: o.x, y: o.y, z: o.z, tx: o.tx, tz: o.tz, rx: o.rx, rz: o.rz, hw: o.hw, yaw: o.yaw };
    });
    this.tmp = [];
  }

  // Lateral offset for the robot driver to take round fixed obstacles at s.
  lineOffset(s) {
    for (const o of this.list) {
      const a = this.path.ahead(o.s, s);
      if (o.type.line && Math.abs(a) < 40) return o.type.line(a, o);
    }
    return 0;
  }

  // Is s in a stretch where the robot has to pick its way through?
  tight(s) {
    return this.list.some((o) => o.type.limit && Math.abs(this.path.ahead(o.s, s)) < o.type.span);
  }

  // The fastest the robot may go now so it's slow enough for any obstacle
  // zone it's in or about to reach (within range metres).
  limitAhead(s, range, decel) {
    let v = Infinity;
    for (const o of this.list) {
      const T = o.type;
      if (!T.limit) continue;
      const a = this.path.ahead(o.s, s);                 // where the car is relative to the obstacle
      if (Math.abs(a) <= T.span) v = Math.min(v, T.limit);
      else if (a < 0 && -a - T.span <= range) v = Math.min(v, Math.sqrt(T.limit ** 2 + 2 * decel * (-a - T.span)));
    }
    return v;
  }

  // Push the car out of anything it touches at race time t.
  collide(body, t) {
    for (const o of this.list) {
      const dx = body.pos.x - o.x, dz = body.pos.z - o.z;
      if (dx * dx + dz * dz > 40 * 40) continue;
      const shapes = this.tmp;
      shapes.length = 0;
      o.type.shapes(o, t, shapes);
      const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw);
      for (const k of [-CAR_OFF, CAR_OFF]) {
        const cx = body.pos.x + fx * k - o.x, cz = body.pos.z + fz * k - o.z;
        const pa = cx * o.tx + cz * o.tz, pl = cx * o.rx + cz * o.rz, ph = body.pos.y - o.y;
        for (const sh of shapes) this.hit(body, o, sh, pa, pl, ph, fx * k, fz * k);
      }
    }
  }

  hit(body, o, sh, pa, pl, ph, ox, oz) {
    let na, nl, pen, va = 0, vl = 0;
    if (sh.circle) {
      if (ph + CAR_H < sh.h0 || ph > sh.h1) return;
      const da = pa - sh.a, dl = pl - sh.l, d = Math.hypot(da, dl);
      if (d >= CAR_R + sh.r) return;
      na = d ? da / d : 1; nl = d ? dl / d : 0;
      pen = CAR_R + sh.r - d;
    } else {
      if (ph + CAR_H < sh.h - sh.hh || ph > sh.h + sh.hh) return;
      const c = Math.cos(sh.ang), s = Math.sin(sh.ang);
      const da = pa - sh.a, dl = pl - sh.l;
      const u = da * c + dl * s, v = -da * s + dl * c;
      const cu = clamp(u, -sh.ha, sh.ha), cv = clamp(v, -sh.hl, sh.hl);
      const du = u - cu, dv = v - cv, d = Math.hypot(du, dv);
      let nu, nv;
      if (d > 1e-6) {
        if (d >= CAR_R) return;
        nu = du / d; nv = dv / d; pen = CAR_R - d;
      } else if (sh.ha - Math.abs(u) < sh.hl - Math.abs(v)) {
        nu = Math.sign(u) || 1; nv = 0; pen = sh.ha - Math.abs(u) + CAR_R;
      } else {
        nu = 0; nv = Math.sign(v) || 1; pen = sh.hl - Math.abs(v) + CAR_R;
      }
      na = nu * c - nv * s; nl = nu * s + nv * c;
      va = (sh.va || 0) - (sh.spin || 0) * (pl - sh.l);
      vl = (sh.vl || 0) + (sh.spin || 0) * (pa - sh.a);
    }
    const nx = na * o.tx + nl * o.rx, nz = na * o.tz + nl * o.rz;
    const vx = va * o.tx + vl * o.rx, vz = va * o.tz + vl * o.rz;
    body.pos.x += nx * pen;
    body.pos.z += nz * pen;
    const rv = (body.vel.x - vx) * nx + (body.vel.z - vz) * nz;
    if (rv >= 0) return;
    body.vel.x -= 1.4 * rv * nx;
    body.vel.z -= 1.4 * rv * nz;
    const impact = -rv;
    const keep = Math.max(0.65, 1 - impact * 0.008);
    body.vel.x *= keep;
    body.vel.z *= keep;
    body.yawRate += clamp((oz * nx - ox * nz) * impact * 0.05, -3, 3);   // knocked into a spin
    if (impact > body.wallHit) {
      body.wallHit = impact;
      body.wallNx = nx;
      body.wallNz = nz;
    }
  }
}

// One shared set of obstacles per track.
export function obstaclesFor(path) {
  if (!path._obstacles) path._obstacles = new Obstacles(path);
  return path._obstacles;
}
