// Collision for a walking player: tree trunks and boulders are upright circles, buildings are
// oriented boxes. Boxes low enough to step onto become ground; taller ones are walls.
export class Collision {
  constructor(circles, boxes) {
    this.cell = 12;
    this.circleGrid = new Map();
    this.boxGrid = new Map();
    this.circles = circles;
    this.boxes = [];
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const key = this._key(c.x, c.z);
      let list = this.circleGrid.get(key);
      if (!list) this.circleGrid.set(key, (list = []));
      list.push(c);
    }
    this.addBoxes(boxes);
  }

  _key(x, z) { return Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell); }

  addBoxes(boxes) {
    for (const b of boxes) {
      this.boxes.push(b);
      const r = Math.hypot(b.hx, b.hz) + 1;
      for (let x = Math.floor((b.x - r) / this.cell); x <= Math.floor((b.x + r) / this.cell); x++) {
        for (let z = Math.floor((b.z - r) / this.cell); z <= Math.floor((b.z + r) / this.cell); z++) {
          const key = x * 100003 + z;
          let list = this.boxGrid.get(key);
          if (!list) this.boxGrid.set(key, (list = []));
          list.push(b);
        }
      }
    }
  }

  // Pushes a body (x/z, radius, vertical span) out of anything it overlaps. Returns true if it moved.
  resolve(pos, radius, feetY, headY, stepUp) {
    let moved = false;
    const cx = Math.floor(pos.x / this.cell), cz = Math.floor(pos.z / this.cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const key = gx * 100003 + gz;
        const cs = this.circleGrid.get(key);
        if (cs) {
          for (const c of cs) {
            const dx = pos.x - c.x, dz = pos.z - c.z, min = radius + c.r;
            const d2 = dx * dx + dz * dz;
            if (d2 < min * min) {
              const d = Math.sqrt(d2) || 1e-4;
              pos.x = c.x + (dx / d) * min;
              pos.z = c.z + (dz / d) * min;
              moved = true;
            }
          }
        }
        const bs = this.boxGrid.get(key);
        if (bs) {
          for (const b of bs) {
            if (b.y1 <= feetY + stepUp || b.y0 >= headY) continue;        // low enough to step onto, or overhead
            // player position in the box's frame
            const dx = pos.x - b.x, dz = pos.z - b.z;
            const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
            const px = Math.max(-b.hx, Math.min(b.hx, lx)), pz = Math.max(-b.hz, Math.min(b.hz, lz));
            let ox = lx - px, oz = lz - pz;
            const d2 = ox * ox + oz * oz;
            if (d2 < radius * radius) {
              let nx, nz, push;
              if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = ox / d; nz = oz / d; push = radius - d; }
              else {
                // centre is inside the box: leave by the nearest face
                const ex = b.hx - Math.abs(lx), ez = b.hz - Math.abs(lz);
                if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; push = ex + radius; } else { nx = 0; nz = Math.sign(lz) || 1; push = ez + radius; }
              }
              const wx = (nx * b.cos + nz * b.sin) * push, wz = (-nx * b.sin + nz * b.cos) * push;
              pos.x += wx; pos.z += wz;
              moved = true;
            }
          }
        }
      }
    }
    return moved;
  }

  // Highest box top the body is standing over that it can step onto (or -Infinity).
  boxGround(x, z, radius, feetY, stepUp) {
    let best = -Infinity;
    const key = this._key(x, z);
    const bs = this.boxGrid.get(key);
    if (!bs) return best;
    for (const b of bs) {
      if (b.y1 > feetY + stepUp || b.y1 < feetY - 3) continue;
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) <= b.hx + radius * 0.3 && Math.abs(lz) <= b.hz + radius * 0.3 && b.y1 > best) best = b.y1;
    }
    return best;
  }
}
