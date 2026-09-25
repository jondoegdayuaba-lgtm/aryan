// Builds one-file copies of the games, three.js included, that run by
// double-clicking them, no web server needed:
//   desktop/missile-run.html   (the game at the repo root)
//   desktop/ridge-rally.html   (rally/)
//   npm install && npm run build:desktop            # both
//   node tools/build-desktop.mjs rally              # just one
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GAMES = {
  missile: { dir: '.', out: 'desktop/missile-run.html' },
  rally: { dir: 'rally', out: 'desktop/ridge-rally.html' },
};

async function buildGame({ dir, out }) {
  const base = resolve(root, dir);
  const read = (p) => readFileSync(resolve(base, p), 'utf8');
  const result = await build({
    entryPoints: [resolve(base, 'js/main.js')],
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
    if (!html.includes(from)) throw new Error(`${dir}/index.html no longer contains: ${from}`);
    html = html.replace(from, () => to);
  };
  swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
  swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
  swap('<script type="module" src="js/main.js"></script>', `<script>\n${js}</script>`);

  const file = resolve(root, out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  console.log(`${out} written (${(html.length / 1024).toFixed(0)} KB)`);
}

const pick = process.argv.slice(2);
for (const name of pick.length ? pick : Object.keys(GAMES)) {
  if (!GAMES[name]) throw new Error(`Unknown game "${name}". Try: ${Object.keys(GAMES).join(', ')}`);
  await buildGame(GAMES[name]);
}
