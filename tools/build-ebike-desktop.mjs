// Builds desktop/night-run.html: Night Run (three.js, code and Blender models) in one file
// that runs by double-clicking it, no web server needed.
//   npm install && npm run build:ebike-desktop
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eb = (p) => resolve(root, 'ebike', p);
const read = (p) => readFileSync(eb(p), 'utf8');

const result = await build({
  entryPoints: [eb('js/main.js')],
  bundle: true, format: 'iife', minify: true, legalComments: 'none',
  alias: { three: eb('vendor/three/three.module.js'), 'three/addons': eb('vendor/three-addons') },
  write: false, logLevel: 'warning',
});
const safe = (t) => t.replace(/<\/script/gi, '<\\/script');
const assets = {};
for (const n of ['city', 'ebike', 'police', 'sedan', 'taxi', 'van']) assets[n] = readFileSync(eb(`assets/${n}.glb`)).toString('base64');

let html = read('index.html');
const swap = (from, to) => { if (!html.includes(from)) throw new Error('index.html changed: ' + from); html = html.replace(from, () => to); };
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${read('css/style.css')}</style>`);
html = html.replace(/\s*<script type="importmap">.*?<\/script>/, '');
swap('<script type="module" src="js/main.js"></script>',
  `<script>globalThis.__EMBEDDED_ASSETS=${JSON.stringify(assets)};</script>\n<script>\n${safe(result.outputFiles[0].text)}</script>`);
mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/night-run.html'), html);
console.log('wrote desktop/night-run.html', (html.length / 1048576).toFixed(1) + ' MB');
