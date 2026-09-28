// Small geometry helpers (three.js addons aren't bundled, so these stand in).
import * as THREE from 'three';
import { hash2 } from '../noise.js';

// Concatenates geometries that share the same attribute set.
export function mergeGeometries(list) {
  const geos = list.map((g) => (g.index ? g : indexed(g)));
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  let vtx = 0;
  const idx = [];
  const data = {};
  for (const n of names) data[n] = [];
  for (const g of geos) {
    for (const n of names) {
      const a = g.attributes[n];
      if (!a) throw new Error(`mergeGeometries: missing attribute ${n}`);
      for (let i = 0; i < a.count * a.itemSize; i++) data[n].push(a.array[i]);
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + vtx);
    vtx += g.attributes.position.count;
  }
  for (const n of names) out.setAttribute(n, new THREE.Float32BufferAttribute(data[n], geos[0].attributes[n].itemSize));
  out.setIndex(idx);
  return out;
}

function indexed(g) {
  const n = g.attributes.position.count;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}

// Welds vertices at identical positions (used before displacing rocks so they stay closed).
export function weld(g, precision = 1e4) {
  const pos = g.attributes.position;
  const map = new Map();
  const newPos = [];
  const index = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = newPos.length / 3;
      newPos.push(x, y, z);
      map.set(key, k);
    }
    index.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(index);
  return out;
}

// 3D value noise for shaping geometry.
export function noise3(seed = 0) {
  const h = (x, y, z) => hash2(x * 73856093 ^ z * 83492791, y * 19349663, seed);
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => h(xi + dx, yi + dy, zi + dz);
    return L(
      L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy),
      L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy),
      fz,
    ) * 2 - 1;
  };
}

export function fbm3(n, x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f, y * f, z * f);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

// Adds a float attribute filled with a constant (so merged parts can share a shader).
export function fillAttribute(g, name, itemSize, fn) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * itemSize);
  for (let i = 0; i < n; i++) {
    const v = fn(i);
    if (itemSize === 1) arr[i] = v;
    else for (let k = 0; k < itemSize; k++) arr[i * itemSize + k] = v[k];
  }
  g.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  return g;
}
