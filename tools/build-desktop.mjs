// Builds the one-file versions of the games in desktop/: each whole game
// (three.js included) in a single HTML file that runs by double-clicking it,
// no web server needed.
//   npm install && npm run build:desktop
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const games = [
  { dir: '.', out: 'desktop/missile-run.html' },
  // Canyon Rush's Blender models ride along inline (see canyon-rush/js/game/models.js).
  { dir: 'canyon-rush', out: 'desktop/canyon-rush.html', models: 'canyon-rush/models' },
];

for (const game of games) {
  const base = resolve(root, game.dir);
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
    if (!html.includes(from)) throw new Error(`${game.dir}/index.html no longer contains: ${from}`);
    html = html.replace(from, () => to);
  };
  swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
  swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
  let inline = '';
  if (game.models) {
    const dir = resolve(root, game.models);
    const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
    const data = Object.fromEntries(files.map((f) => [f, readFileSync(resolve(dir, f)).toString('base64')]));
    inline = `<script>window.__CANYON_MODELS__ = ${JSON.stringify(data)};</script>\n`;
  }
  swap('<script type="module" src="js/main.js"></script>', `${inline}<script>\n${js}</script>`);

  mkdirSync(resolve(root, 'desktop'), { recursive: true });
  writeFileSync(resolve(root, game.out), html);
  console.log(`${game.out} written (${(html.length / 1024).toFixed(0)} KB)`);
}
