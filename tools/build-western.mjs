// Builds desktop/outlaw-frontier.html: Outlaw Frontier in one file that runs
// by double-clicking it, no web server needed. Every asset is embedded,
// gzipped, as base64.
//   npm install && npm run build:western
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = resolve(root, 'western');
const read = (p) => readFileSync(resolve(game, p), 'utf8');

const threePlugin = {
  name: 'three',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: resolve(root, 'vendor/three/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: resolve(root, 'vendor/three/addons', a.path.slice('three/addons/'.length)) }));
  },
};

const result = await build({
  entryPoints: [resolve(game, 'js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'inline',
  plugins: [threePlugin],
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const assets = ['assets/cowboy.glb', 'assets/horse.glb', 'assets/deer.glb', 'assets/props.glb', 'assets/mountains.glb',
  'assets/world.json', 'assets/terrain.bin', 'assets/map.jpg',
  // only the textures the game loads itself; the models carry their own
  ...[...readFileSync(resolve(game, 'js/assets.js'), 'utf8').matchAll(/tex\('(\w+)'\)/g)]
    .map((m) => `assets/textures/${m[1]}.jpg`)];
const embedded = {};
let raw = 0;
for (const a of assets) {
  const buf = readFileSync(resolve(game, a));
  raw += buf.length;
  embedded[a] = gzipSync(buf, { level: 9 }).toString('base64');
}

let html = read('index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${read('css/style.css')}</style>`);
swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
swap('<script type="module" src="js/main.js"></script>',
  `<script>window.__EMBEDDED_ASSETS=${JSON.stringify(embedded)};</script>\n<script>\n${js}</script>`);

mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/outlaw-frontier.html'), html);
console.log(`desktop/outlaw-frontier.html written (${(html.length / 1048576).toFixed(1)} MB, assets ${(raw / 1048576).toFixed(1)} MB before compression)`);
