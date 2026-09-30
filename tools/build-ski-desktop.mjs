// Builds desktop/alpine-descent.html: the whole ski game (three.js, code and every Blender-made asset)
// in one file that runs by double-clicking it, no web server needed.
//   npm install && npm run build:ski
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, extname, sep } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const MIME = {
  '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.u16': 'application/octet-stream', '.f32': 'application/octet-stream', '.pz': 'application/octet-stream', '.u8': 'application/octet-stream', '.webp': 'image/webp',
};

// ---------------------------------------------------------------------------------------- code
const result = await build({
  entryPoints: [resolve(root, 'ski/js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  target: 'es2022',
  alias: { 'three/addons': resolve(root, 'vendor/three/addons'), three: resolve(root, 'vendor/three/three.module.js') },
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = read('ski/css/ski.css');

// -------------------------------------------------------------------------------------- assets
// Binary assets are embedded as text in base 85 (four bytes -> five characters, 25 % overhead instead of base64's 33 %).
// The alphabet has no < > & quotes, backslash or slash, so nothing in it can end a <script> element or start a comment.
const B85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!*?()[]{}@%$#;,|~';
if (B85.length !== 85) throw new Error('base85 alphabet must have 85 characters');
function encodeBase85(bytes) {
  const groups = Math.ceil(bytes.length / 4);
  const out = Buffer.alloc(groups * 5);
  const table = Buffer.from(B85, 'latin1');
  for (let g = 0, o = 0; g < groups; g++, o += 5) {
    const i = g * 4;
    let v = (((bytes[i] << 24) >>> 0) + ((bytes[i + 1] || 0) << 16) + ((bytes[i + 2] || 0) << 8) + (bytes[i + 3] || 0));
    for (let k = 4; k >= 0; k--) { out[o + k] = table[v % 85]; v = Math.floor(v / 85); }
  }
  return out.toString('latin1');
}
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = resolve(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const assetRoot = resolve(root, 'ski/assets');
const packs = [];
let rawTotal = 0;
let packTotal = 0;
for (const file of walk(assetRoot).sort()) {
  const name = relative(assetRoot, file).split(sep).join('/');
  const raw = readFileSync(file);
  const gz = gzipSync(raw, { level: 9 });
  const useGz = gz.length < raw.length * 0.9;
  const bytes = useGz ? gz : raw;
  rawTotal += raw.length;
  packTotal += bytes.length;
  // the open world is only unpacked when the player chooses it (window.__assetsEnsure('open/'))
  const lazy = name.startsWith('open/');
  packs.push(`<script type="text/plain" data-asset="${name}" data-mime="${MIME[extname(file)] || 'application/octet-stream'}" data-len="${bytes.length}"${useGz ? ' data-gz="1"' : ''}${lazy ? ' data-lazy="1"' : ''}>${encodeBase85(bytes)}</script>`);
}

// The unpacker turns every embedded asset into a blob: URL so the game's loaders work unchanged. Assets marked lazy (the open
// world) stay packed until window.__assetsEnsure(prefix) asks for them.
const prelude = `
window.__assetsReady = (async () => {
  const urls = {};
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser is too old to unpack the game (use Chrome or Edge 80+, Firefox 113+ or Safari 16.4+)');
  const ALPHA = ${JSON.stringify(B85)};
  const LUT = new Uint8Array(128);
  for (let i = 0; i < 85; i++) LUT[ALPHA.charCodeAt(i)] = i;
  const b85 = (s, len) => {
    const out = new Uint8Array(Math.ceil(s.length / 5) * 4);
    const dv = new DataView(out.buffer);
    for (let i = 0, o = 0; i < s.length; i += 5, o += 4) {
      dv.setUint32(o, ((((LUT[s.charCodeAt(i)] * 85 + LUT[s.charCodeAt(i + 1)]) * 85 + LUT[s.charCodeAt(i + 2)]) * 85 + LUT[s.charCodeAt(i + 3)]) * 85 + LUT[s.charCodeAt(i + 4)]) >>> 0);
    }
    return out.subarray(0, len);
  };
  const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const decode = async (el) => {
    let bytes = b85(el.textContent, +el.dataset.len);
    if (el.dataset.gz) bytes = await inflate(bytes);
    urls[el.dataset.asset] = URL.createObjectURL(new Blob([bytes], { type: el.dataset.mime }));
    el.remove();
  };
  const els = [...document.querySelectorAll('script[data-asset]')];
  const lazy = els.filter((el) => el.dataset.lazy);
  await Promise.all(els.filter((el) => !el.dataset.lazy).map(decode));
  window.__assetUrl = (path) => urls[String(path).replace(/^(\\.\\/)?assets\\//, '')] || null;
  window.__assetsEnsure = async (prefix) => { await Promise.all(lazy.filter((el) => el.isConnected && el.dataset.asset.startsWith(prefix)).map(decode)); };
})();
`;

// ---------------------------------------------------------------------------------------- page
let html = read('ski/index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`ski/index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/ski.css">', `<style>\n${css}</style>`);
swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
// the unpacker must come after the asset blocks so it can see them
swap('<script type="module" src="js/main.js"></script>', `${packs.join('\n')}\n<script>${prelude}</script>\n<script>\n${js}</script>`);

mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/alpine-descent.html'), html);
console.log(`desktop/alpine-descent.html written: ${(html.length / 1048576).toFixed(1)} MB `
  + `(${packs.length} assets, ${(rawTotal / 1048576).toFixed(1)} MB raw -> ${(packTotal / 1048576).toFixed(1)} MB packed, code ${(js.length / 1024).toFixed(0)} KB)`);
