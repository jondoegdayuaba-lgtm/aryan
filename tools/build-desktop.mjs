// Builds the one-file desktop versions of both games: each is the whole game
// (three.js included) in a single HTML file that runs by double-clicking it,
// no web server needed.
//   npm install && npm run build:desktop
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

async function bundle(dir, out) {
  const result = await build({
    entryPoints: [resolve(root, dir, 'js/main.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    legalComments: 'inline',
    alias: { three: resolve(root, 'vendor/three/three.module.js') },
    write: false,
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = read(`${dir}/css/style.css`);

  let html = read(`${dir}/index.html`);
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`${dir}/index.html no longer contains: ${from}`);
    html = html.replace(from, () => to);
  };
  swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
  swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
  swap('<script type="module" src="js/main.js"></script>', `<script>\n${js}</script>`);

  mkdirSync(resolve(root, 'desktop'), { recursive: true });
  writeFileSync(resolve(root, 'desktop', out), html);
  console.log(`desktop/${out} written (${(html.length / 1024).toFixed(0)} KB)`);
}

await bundle('.', 'missile-run.html');
await bundle('arena', 'blockfire-arena.html');
