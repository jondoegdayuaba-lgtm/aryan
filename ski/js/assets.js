// Asset loading with progress reporting. Missing optional files fall back to
// neutral placeholders so the game still runs while assets are being rebuilt.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export class Loader {
  constructor(base = 'assets/', onProgress = () => {}) {
    this.base = base;
    this.total = 0;
    this.done = 0;
    this.onProgress = onProgress;
    this.missing = [];
    this._gltf = new GLTFLoader();
    this._hdr = new HDRLoader();
    this._tex = new THREE.TextureLoader();
  }

  _track(promise, label) {
    this.total++;
    this.onProgress(this.done, this.total, label);
    return promise.finally(() => {
      this.done++;
      this.onProgress(this.done, this.total, label);
    });
  }

  /** Image texture. opts: srgb (default true), repeat, flipY(false), anisotropy, mip (true) */
  texture(path, opts = {}) {
    const { srgb = true, repeat = false, anisotropy = 8, mip = true, optional = true, filter = true } = opts;
    const p = new Promise((resolve) => {
      this._tex.load(
        this.base + path,
        (t) => {
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.flipY = false;
          t.anisotropy = anisotropy;
          t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
          t.generateMipmaps = mip;
          t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
          t.magFilter = filter ? THREE.LinearFilter : THREE.NearestFilter;
          t.needsUpdate = true;
          resolve(t);
        },
        undefined,
        () => {
          this.missing.push(path);
          if (!optional) console.error('missing asset', path);
          resolve(null);
        });
    });
    return this._track(p, path);
  }

  hdr(path) {
    const p = this._hdr.loadAsync(this.base + path).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.LinearSRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }).catch(() => {
      this.missing.push(path);
      return null;
    });
    return this._track(p, path);
  }

  gltf(path) {
    const p = this._gltf.loadAsync(this.base + path).catch((e) => {
      this.missing.push(path);
      console.warn('could not load', path, e && e.message);
      return null;
    });
    return this._track(p, path);
  }

  async json(path) {
    return this._track(fetch(this.base + path).then((r) => (r.ok ? r.json() : null)).catch(() => null), path);
  }
}

/** 1x1 solid colour texture helper */
export function solidTexture(r, g, b, a = 255, srgb = false) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
