// Builds desktop/last-signal.html: Last Signal (three.js, code, styles and the Blender-made models)
// in one file that runs by double-clicking it, no web server needed.
//   npm install && npm run build:last-signal
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = resolve(root, 'last-signal');
const read = (p) => readFileSync(resolve(game, p), 'utf8');

const result = await build({
  entryPoints: [resolve(game, 'js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'inline',
  alias: { three: resolve(root, 'vendor/three/three.module.js'), 'three/addons': resolve(root, 'vendor/three/addons') },
  define: { 'import.meta.url': 'document.baseURI' },
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = read('css/style.css');

// Models are embedded as base64 and read by js/models.js before it tries to fetch them.
const models = {};
for (const f of readdirSync(resolve(game, 'models')).filter((n) => n.endsWith('.glb'))) {
  models[f.replace(/\.glb$/, '')] = readFileSync(resolve(game, 'models', f)).toString('base64');
}

let html = read('index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
swap('<script type="module" src="js/main.js"></script>', `<script>window.__LS_MODELS__=${JSON.stringify(models)};</script>\n<script>\n${js}</script>`);

mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/last-signal.html'), html);
console.log(`desktop/last-signal.html written (${(html.length / 1048576).toFixed(1)} MB)`);
