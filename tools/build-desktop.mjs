// Builds desktop/missile-run.html and desktop/apex-rush.html: each game (three.js
// included) in one file that runs by double-clicking it, no web server needed.
//   npm install && npm run build:desktop
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GAMES = [
  { dir: '.', out: 'desktop/missile-run.html' },
  { dir: 'apex-rush', out: 'desktop/apex-rush.html' },
];

for (const game of GAMES) {
  const dir = resolve(root, game.dir);
  const read = (p) => readFileSync(resolve(dir, p), 'utf8');

  const result = await build({
    entryPoints: [resolve(dir, 'js/main.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    legalComments: 'inline',
    alias: { three: resolve(root, 'vendor/three/three.module.js') },
    write: false,
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = read('css/style.css');

  let html = read('index.html');
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`${game.dir}/index.html no longer contains: ${from}`);
    html = html.replace(from, () => to);
  };
  swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
  swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
  swap('<script type="module" src="js/main.js"></script>', `<script>\n${js}</script>`);

  mkdirSync(resolve(root, 'desktop'), { recursive: true });
  writeFileSync(resolve(root, game.out), html);
  console.log(`${game.out} written (${(html.length / 1024).toFixed(0)} KB)`);
}
