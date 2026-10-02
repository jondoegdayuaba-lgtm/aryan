// Builds desktop/missile-run.html and desktop/blockwild.html: each game
// (three.js included) in one file that runs by double-clicking it, no web
// server needed.
//   npm install && npm run build:desktop
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

async function buildGame({ dir, out }) {
  const at = (p) => (dir ? `${dir}/${p}` : p);
  const result = await build({
    entryPoints: [resolve(root, at('js/main.js'))],
    bundle: true,
    format: 'iife',
    minify: true,
    legalComments: 'inline',
    alias: { three: resolve(root, 'vendor/three/three.module.js') },
    write: false,
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = read(at('css/style.css'));

  let html = read(at('index.html'));
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`${at('index.html')} no longer contains: ${from}`);
    html = html.replace(from, () => to);
  };
  swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
  swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
  swap('<script type="module" src="js/main.js"></script>', `<script>\n${js}</script>`);

  mkdirSync(resolve(root, 'desktop'), { recursive: true });
  writeFileSync(resolve(root, out), html);
  console.log(`${out} written (${(html.length / 1024).toFixed(0)} KB)`);
}

await buildGame({ dir: '', out: 'desktop/missile-run.html' });
await buildGame({ dir: 'blockwild', out: 'desktop/blockwild.html' });
