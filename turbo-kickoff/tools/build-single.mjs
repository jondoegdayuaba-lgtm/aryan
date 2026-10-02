// Builds turbo-kickoff.html: the whole game (three.js, cannon-es, every model)
// in one file that runs by double-clicking it, no web server needed.
//   npm install && npm run build:turbo
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p));

const result = await build({
  entryPoints: [resolve(root, 'js/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'inline',
  alias: {
    three: resolve(root, 'vendor/three/three.module.js'),
    'three/addons': resolve(root, 'vendor/three/addons'),
    'cannon-es': resolve(root, 'vendor/cannon-es.js'),
  },
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const files = ['arena.glb', 'ball.glb', 'car_blue.glb', 'car_orange.glb', 'boost_pad_small.glb', 'boost_pad_big.glb', 'arena_layout.json'];
const assets = Object.fromEntries(files.map((f) => [f, read('assets/models/' + f).toString('base64')]));

let html = read('index.html').toString();
const css = read('css/style.css').toString();
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>${css}</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace(/<script type="module" src="js\/main.js"><\/script>/, () =>
  `<script>window.TK_ASSETS=${JSON.stringify(assets)};</script>\n<script type="module">${js}</script>`);

writeFileSync(resolve(root, 'turbo-kickoff.html'), html);
console.log(`wrote turbo-kickoff.html (${(html.length / 1e6).toFixed(1)} MB)`);
