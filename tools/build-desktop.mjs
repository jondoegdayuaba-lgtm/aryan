// Builds a game into one HTML file (three.js included) that runs by
// double-clicking it, no web server needed.
//   npm install && npm run build:desktop
//   node tools/build-desktop.mjs            -> desktop/missile-run.html
//   node tools/build-desktop.mjs arena      -> desktop/block-brawl.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const GAMES = {
  'missile-run': { dir: '.', out: 'missile-run.html' },
  arena: { dir: 'arena', out: 'block-brawl.html' },
};
const game = GAMES[process.argv[2] || 'missile-run'];
if (!game) throw new Error(`Unknown game "${process.argv[2]}". Pick one of: ${Object.keys(GAMES).join(', ')}`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gameDir = resolve(root, game.dir);
const read = (p) => readFileSync(resolve(gameDir, p), 'utf8');

const result = await build({
  entryPoints: [resolve(gameDir, 'js/main.js')],
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
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
swap('<script type="module" src="js/main.js"></script>', `<script>\n${js}</script>`);

mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop', game.out), html);
console.log(`desktop/${game.out} written (${(html.length / 1024).toFixed(0)} KB)`);
