// Compatibility rendering for GPUs and browsers that can't render to
// floating-point targets (the HDR pipeline would come out black there):
// the scene is drawn straight to the screen with the renderer's own tone
// mapping, and the same interface as PostPipeline so the game doesn't care.
import * as THREE from 'three';

// Can this browser render to half-float colour buffers, multisampled too?
export function probeHdr() {
  let gl = null;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2');
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return false;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 4, 4);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)), gl.RGBA16F, 4, 4);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export class DirectPipeline {
  constructor(renderer, { renderScale = 1, exposureScale = 0.75 } = {}) {
    this.renderer = renderer;
    this.renderScale = renderScale;
    this.basePixelRatio = renderer.getPixelRatio();
    this.exposureScale = exposureScale;
    this.width = 1;
    this.height = 1;
    this.depthTexture = null;
    this.hdr = { texture: null };
    // ACES here comes closest to the HDR pipeline's AgX-plus-grading look.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The bits of the post pipeline's uniforms the game reads and writes.
    this.composite = { uniforms: { uExposure: { value: 1 }, uRadial: { value: 0 } } };
  }

  setSize(w, h) {
    const r = this.renderer;
    const pr = this.basePixelRatio * this.renderScale;
    if (Math.abs(r.getPixelRatio() - pr) > 1e-3) {
      r.setPixelRatio(pr);
      r.setSize(innerWidth, innerHeight, false);
    }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    void w; void h;
  }

  render(scene, camera, dt, extra = null) {
    const r = this.renderer;
    r.toneMappingExposure = this.composite.uniforms.uExposure.value * this.exposureScale;
    r.setRenderTarget(null);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (extra) extra(null);
  }

  resetAdaptation() {}
}

// Reads a few patches of the frame just drawn; true if they're all black.
export function frameLooksBlack(renderer) {
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const n = 12;
  const buf = new Uint8Array(n * n * 4);
  let max = 0;
  for (const [fx, fy] of [[0.5, 0.85], [0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.5, 0.15]]) {
    gl.readPixels(Math.floor(fx * w - n / 2), Math.floor(fy * h - n / 2), n, n, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let i = 0; i < buf.length; i += 4) max = Math.max(max, buf[i], buf[i + 1], buf[i + 2]);
  }
  return max < 10;
}
