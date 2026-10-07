// Turns a TrackPath into meshes: tarmac, kerbs, deck sides, walls, tunnels,
// pillars, gates and corner signs.
import * as THREE from 'three';
import { KERB, WALL_GAP, WALL_T, WALL_H, deckDepth } from './path.js';
import { buildFeatures } from './featuremesh.js';
import { TAU } from './loops.js';

const RED = new THREE.Color('#e2342d'), WHITE = new THREE.Color('#f3f4f6');
const WALL = new THREE.Color('#d5d8e0'), WALL_DARK = new THREE.Color('#9da2ae');
const DECK = new THREE.Color('#5c6170'), DECK_UNDER = new THREE.Color('#474b57');
const TUNNEL_OUT = new THREE.Color('#3550d4'), TUNNEL_IN = new THREE.Color('#c3c8da'), TUNNEL_TRIM = new THREE.Color('#25348f');
const TUNNEL_H = 7.4;

// Collects triangles for one non-indexed geometry.
class Builder {
  constructor({ color = false, uv = false } = {}) {
    this.p = [];
    this.c = color ? [] : null;
    this.uv = uv ? [] : null;
  }

  tri(a, b, c, col, ua, ub, uc) {
    this.p.push(...a, ...b, ...c);
    if (this.c) for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
    if (this.uv) this.uv.push(...ua, ...ub, ...uc);
  }

  // a, b, c, d counter-clockwise as seen from the front.
  quad(a, b, c, d, col, ua, ub, uc, ud) {
    this.tri(a, b, c, col, ua, ub, uc);
    this.tri(a, c, d, col, ua, uc, ud);
  }

  // A flat polygon (convex, ordered) facing `normal`.
  face(pts, normal, col) {
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const p = n[0] * normal.x + n[1] * normal.y + n[2] * normal.z < 0 ? pts.slice().reverse() : pts;
    for (let i = 1; i < p.length - 1; i++) this.tri(p[0], p[i], p[i + 1], col, [0, 0], [0, 0], [0, 0]);
  }

  mesh(material, { cast = true, receive = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

// A point at lateral offset `lat` (positive = right of travel) and height `h`
// above the surface. `bank` false measures h from the centre line instead.
function pt(o, lat, h, bank = true) {
  return [o.x + o.rx * lat, o.y + (bank ? lat * o.tanB : 0) + h, o.z + o.rz * lat];
}

// Cross-sections are lists of [lateral, height]. Sweeping one from sample a to
// sample b, each face points to the left of the walk (lateral right, height up).
function sweep(B, a, b, pa, pb, colorAt, bank = true) {
  for (let j = 0; j < pa.length - 1; j++) {
    B.quad(pt(a, pa[j][0], pa[j][1], bank), pt(a, pa[j + 1][0], pa[j + 1][1], bank),
      pt(b, pb[j + 1][0], pb[j + 1][1], bank), pt(b, pb[j][0], pb[j][1], bank), colorAt(j));
  }
}
const mirror = (profile) => profile.map(([l, h]) => [-l, h]).reverse();

// finish: false leaves the finish gate off (the editor's unfinished road).
export function buildTrack(path, T, { finish = true } = {}) {
  const group = new THREE.Group();
  const S = path.samples, N = S.length;
  const next = (k) => S[(k + 1) % N];
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);

  const road = new Builder({ uv: true });
  const kerb = new Builder({ color: true });
  const deck = new Builder({ color: true });
  const walls = new Builder({ color: true });
  const tunnel = new Builder({ color: true });
  const tunnelIn = new Builder({ color: true });
  const lights = [];
  const pillars = [];

  // The ends of a loop as stand-in samples, so the road runs right up to the
  // loop and carries on from exactly where it comes out.
  const loopEnd = (s, exit) => {
    const L = path.loops.find((q) => s >= q.s0 - 0.01 && s <= q.s1 + 0.01);
    const p = exit ? L.X : L.E;
    return { x: p.x, y: p.y, z: p.z, s: exit ? L.s1 : L.s0, hw: L.hw, rx: L.Rt.x, rz: L.Rt.z, tx: L.F.x, tz: L.F.z, tanB: 0 };
  };

  for (let k = 0; k < path.segCount; k++) {
    let a = S[k], b = next(k);
    const fromLoop = a.loop && !b.gap, toLoop = b.loop && !a.gap;
    if (fromLoop) a = loopEnd(a.s, true);
    else if (a.gap) continue;
    if (toLoop) b = loopEnd(b.s, false);
    const prevGap = !fromLoop && (path.closed || k > 0 ? S[(k - 1 + N) % N].gap || (!path.closed && k === 0) : true);
    const nextGap = !toLoop && ((!path.closed && k === path.segCount - 1) || b.gap);

    // Tarmac.
    const va = a.s / 12, vb = va + path.step / 12;
    road.quad(pt(a, -a.hw, 0), pt(a, a.hw, 0), pt(b, b.hw, 0), pt(b, -b.hw, 0), null,
      [0, va], [1, va], [1, vb], [0, vb]);

    // Kerbs, alternating red and white every three metres or so.
    const col = Math.floor(a.s / 3) % 2 ? RED : WHITE;
    const kr = (o) => [[o.hw, 0], [o.hw + 0.15, 0.07], [o.hw + KERB - 0.2, 0.07], [o.hw + KERB, 0]];
    sweep(kerb, a, b, kr(a), kr(b), () => col);
    sweep(kerb, a, b, mirror(kr(a)), mirror(kr(b)), () => col);

    // Deck sides (each reaching down from its own edge, which differ on a
    // banked road) and the underside.
    const W = (o) => o.hw + KERB;
    const deckProfile = (o) => {
      const dr = deckDepth(o.y + W(o) * o.tanB), dl = deckDepth(o.y - W(o) * o.tanB);
      return [[W(o), 0], [W(o), -dr], [-W(o), -dl], [-W(o), 0]];
    };
    const pa = deckProfile(a), pb = deckProfile(b);
    if (a.y < 0.3) {
      sweep(deck, a, b, pa.slice(0, 2), pb.slice(0, 2), () => DECK);
      sweep(deck, a, b, pa.slice(2), pb.slice(2), () => DECK);
    } else {
      sweep(deck, a, b, pa, pb, (j) => (j === 1 ? DECK_UNDER : DECK));
    }
    // End caps where the road stops at a jump.
    const cap = (o, p, dir) => deck.face(p.map(([l, h]) => pt(o, l, h)), new THREE.Vector3(o.tx * dir, 0, o.tz * dir), DECK);
    if (prevGap && a.y > 0.2) cap(a, pa, -1);
    if (nextGap && b.y > 0.2) cap(b, pb, 1);

    // Pillars under raised road, unless there's road underneath.
    if (a.y > 2.5 && Math.floor(a.s / 22) !== Math.floor(b.s / 22)) {
      const offsets = a.hw > 5 ? [-a.hw * 0.55, a.hw * 0.55] : [0];
      for (const lat of offsets) {
        const [x, , z] = pt(a, lat, 0);
        const clear = [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]
          .every(([dx, dz]) => path.deckBelow(x + dx, z + dz, a.y - 3) === -Infinity);
        const deckY = a.y + lat * a.tanB;
        if (clear) pillars.push({ x, z, top: deckY - deckDepth(deckY) + 0.05 });
      }
    }

    // Walls.
    if (a.walls) {
      const wr = (o) => {
        const wi = o.hw + KERB + WALL_GAP, wo = wi + WALL_T;
        return [[wi, -0.1], [wi, 0.85], [wi, WALL_H], [wo, WALL_H], [wo, -0.1]];
      };
      const stripe = Math.floor(a.s / 4) % 2 ? RED : WHITE;
      const shade = (j) => (j === 0 ? WALL : j === 3 ? WALL_DARK : stripe);
      sweep(walls, a, b, wr(a), wr(b), shade);
      sweep(walls, a, b, mirror(wr(a)), mirror(wr(b)), (j) => shade(3 - j));
      const prevWall = path.closed || k > 0 ? S[(k - 1 + N) % N].walls && !S[(k - 1 + N) % N].gap : false;
      const nextWall = b.walls && !nextGap;
      const wcap = (o, dir) => {
        for (const side of [1, -1]) {
          const r = wr(o);
          const pts = [r[0], r[2], r[3], r[4]].map(([l, h]) => pt(o, l * side, h));
          walls.face(pts, new THREE.Vector3(o.tx * dir, 0, o.tz * dir), WALL_DARK);
        }
      };
      if (!prevWall) wcap(a, -1);
      if (!nextWall) wcap(b, 1);
    }

    // Tunnel shell: an inner and an outer skin with a trimmed portal at each end.
    if (a.tunnel) {
      const inner = (o) => {
        const w = o.hw + KERB + WALL_GAP + WALL_T + 0.3;
        return [[w, -0.1], [w, 4.6], [w - 2.6, TUNNEL_H], [-w + 2.6, TUNNEL_H], [-w, 4.6], [-w, -0.1]];
      };
      const outer = (o) => {
        const w = o.hw + KERB + WALL_GAP + WALL_T + 1.2;
        return [[-w, -0.1], [-w, 4.9], [-w + 2.9, TUNNEL_H + 0.9], [w - 2.9, TUNNEL_H + 0.9], [w, 4.9], [w, -0.1]];
      };
      sweep(tunnelIn, a, b, inner(a), inner(b), () => TUNNEL_IN, false);
      sweep(tunnel, a, b, outer(a), outer(b), () => TUNNEL_OUT, false);
      const prevT = path.closed || k > 0 ? S[(k - 1 + N) % N].tunnel : false;
      const portal = (o, dir) => {
        const i = inner(o), ou = outer(o).slice().reverse();
        for (let j = 0; j < 5; j++) {
          tunnel.face([pt(o, i[j][0], i[j][1], false), pt(o, i[j + 1][0], i[j + 1][1], false), pt(o, ou[j + 1][0], ou[j + 1][1], false), pt(o, ou[j][0], ou[j][1], false)],
            new THREE.Vector3(o.tx * dir, 0, o.tz * dir), TUNNEL_TRIM);
        }
      };
      if (!prevT) portal(a, -1);
      if (!b.tunnel || nextGap) portal(b, 1);
      if (Math.floor(a.s / 8) !== Math.floor(b.s / 8)) lights.push(pt(a, 0, TUNNEL_H - 0.08, false).concat(a.yaw));
    }
  }

  // Loops: the same road, kerbs and deck swept round the loop's curve, with
  // the road surface facing the middle of the loop.
  for (const L of path.loops) {
    const K = 160, W = L.hw;
    const frames = [];
    let arc = 0;
    for (let k = 0; k <= K; k++) {
      const F = L.frame((TAU * k) / K, {});
      if (k) arc += Math.hypot(F.x - frames[k - 1].x, F.y - frames[k - 1].y, F.z - frames[k - 1].z);
      F.arc = arc;
      frames.push(F);
    }
    const at = (F, l, h) => [F.x + F.bx * l + F.nx * h, F.y + F.by * l + F.ny * h, F.z + F.bz * l + F.nz * h];
    const loopSweep = (B, A, C, pa, pc, colorAt) => {
      for (let j = 0; j < pa.length - 1; j++) {
        B.quad(at(A, pa[j][0], pa[j][1]), at(A, pa[j + 1][0], pa[j + 1][1]), at(C, pc[j + 1][0], pc[j + 1][1]), at(C, pc[j][0], pc[j][1]), colorAt(j));
      }
    };
    const kr = [[W, 0], [W + 0.15, 0.07], [W + KERB - 0.2, 0.07], [W + KERB, 0]];
    const deckP = [[W + KERB, 0], [W + KERB, -0.9], [-W - KERB, -0.9], [-W - KERB, 0]];
    for (let k = 0; k < K; k++) {
      const A = frames[k], C = frames[k + 1];
      const va = A.arc / 12, vc = C.arc / 12;
      road.quad(at(A, -W, 0.01), at(A, W, 0.01), at(C, W, 0.01), at(C, -W, 0.01), null, [0, va], [1, va], [1, vc], [0, vc]);
      const col = Math.floor(A.arc / 3) % 2 ? RED : WHITE;
      loopSweep(kerb, A, C, kr, kr, () => col);
      loopSweep(kerb, A, C, mirror(kr), mirror(kr), () => col);
      loopSweep(deck, A, C, deckP, deckP, (j) => (j === 1 ? DECK_UNDER : DECK));
    }
    // Legs down to the ground from each side of the loop.
    for (const th of [Math.PI * 0.5, Math.PI * 1.5]) {
      const F = L.frame(th, {});
      for (const l of [-W + 1, W - 1]) {
        const [x, y, z] = at(F, l, -0.9);
        pillars.push({ x, z, top: y });
      }
    }
  }

  const roadMesh = road.mesh(lambert({ map: T.road }), { cast: false });
  group.add(roadMesh);
  group.add(kerb.mesh(lambert({ vertexColors: true }), { cast: false }));
  group.add(deck.mesh(lambert({ vertexColors: true }), { cast: true }));
  if (walls.p.length) group.add(walls.mesh(lambert({ vertexColors: true })));
  if (tunnel.p.length) group.add(tunnel.mesh(lambert({ vertexColors: true })));
  // The lining faces down and sits in shadow, so it glows a little to stay readable.
  if (tunnelIn.p.length) group.add(tunnelIn.mesh(lambert({ vertexColors: true, emissive: '#3b4262' })));

  if (pillars.length) {
    const geo = new THREE.BoxGeometry(1.5, 1, 1.5);
    geo.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(geo, lambert({ color: '#a7abb6' }), pillars.length);
    const m = new THREE.Matrix4();
    pillars.forEach((p, i) => inst.setMatrixAt(i, m.makeScale(1, p.top, 1).setPosition(p.x, 0, p.z)));
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
  }

  if (lights.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.7), new THREE.MeshBasicMaterial({ color: '#fff4c8' }), lights.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    lights.forEach(([x, y, z, yaw], i) => inst.setMatrixAt(i, m.compose(v.set(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), one)));
    group.add(inst);
  }

  // Gates.
  const gates = [];
  const postMat = lambert({ color: '#2b2f3a' });
  const makeGate = (g, kind) => {
    const gate = new THREE.Group();
    const o = path.samples[g.index];
    const wallOut = o.walls ? KERB + WALL_GAP + WALL_T + 0.7 : KERB + 1.2;
    const half = g.hw + wallOut;
    const top = Math.max(g.y + Math.abs(half * Math.tan(g.bank)), 0) + 6.2;
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, top, 0.7), postMat);
      post.position.set(side * half, top / 2, 0);
      post.castShadow = true;
      gate.add(post);
    }
    const tex = kind === 'checkpoint' ? T.checkpoint : kind === 'start' ? T.start : T.finish;
    const beamMat = lambert({ color: kind === 'checkpoint' ? '#ffd21f' : '#2b2f3a' });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.7, 1.3, 0.5), beamMat);
    beam.position.y = top - 0.25;
    beam.castShadow = true;
    gate.add(beam);
    const bannerMat = lambert({ map: tex });
    for (const dir of [-1, 1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 0.6, 1.15), bannerMat);
      banner.position.set(0, top - 0.25, dir * 0.27);
      if (dir < 0) banner.rotation.y = Math.PI;
      gate.add(banner);
    }
    gate.position.set(g.x, 0, g.z);
    gate.rotation.y = g.yaw;
    group.add(gate);
    if (kind !== 'checkpoint') {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(g.hw * 2, 2.4), lambert({
        map: T.checker, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      line.material.map = T.checker.clone();
      line.material.map.repeat.set(g.hw * 2 / 9.6, 1);
      line.rotation.set(-Math.PI / 2, 0, g.yaw + Math.PI);
      line.position.set(g.x, g.y + 0.03, g.z);
      line.receiveShadow = true;
      group.add(line);
    }
    return { group: gate, beamMat, bannerMat };
  };
  path.checkpoints.forEach((g) => gates.push(makeGate(g, 'checkpoint')));
  if (!path.closed) makeGate(path.start, 'start');
  if (finish || path.closed) makeGate(path.finish, 'finish');

  // Chevron boards on the outside of tight corners at ground level.
  const chevronL = T.chevron, chevronR = T.chevron.clone();
  chevronR.repeat.x = -1;
  chevronR.offset.x = 1;
  chevronR.wrapS = THREE.RepeatWrapping;
  const boardL = lambert({ map: chevronL }), boardR = lambert({ map: chevronR });
  let lastSign = -1e9;
  for (let k = 3; k < N - 3; k++) {
    const o = S[k], c = Math.abs(o.curv);
    if (c < 1 / 85 || c < Math.abs(S[k - 1].curv) || c < Math.abs(S[k + 1].curv)) continue;
    if (o.s - lastSign < 70 || o.walls || o.tunnel || o.gap || o.y > 2.5) continue;
    lastSign = o.s;
    const before = path.at(o.s - 30, {});
    const side = o.curv > 0 ? 1 : -1;          // outside of a left turn is the right
    const [x, , z] = pt(o, side * (o.hw + KERB + 5), 0);
    if (path.clearance(x, z) < 3) continue;
    const sign = new THREE.Group();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.95), o.curv > 0 ? boardL : boardR);
    board.position.y = 1.9;
    board.rotation.y = Math.PI;
    sign.add(board);
    const back = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.15, 0.15), postMat);
    back.position.set(0, 1.9, 0.1);
    back.castShadow = true;
    sign.add(back);
    for (const px of [-1.8, 1.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), postMat);
      post.position.set(px, 0.6, 0.1);
      sign.add(post);
    }
    sign.position.set(x, 0, z);
    sign.rotation.y = before.yaw;
    group.add(sign);
  }

  // Boost pads, jump pads and hoops; update(t) animates the pads.
  const features = buildFeatures(path, T);
  group.add(features.group);

  return { group, gates, roadMesh, update: features.update };
}
