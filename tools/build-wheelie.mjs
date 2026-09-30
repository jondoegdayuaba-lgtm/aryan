// Builds desktop/wheelie-life.html: the whole game (three.js, bike model, hero image)
// in one file that runs by double-clicking it, no web server needed.
//   npm install && npm run build:wheelie
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p, enc = 'utf8') => readFileSync(resolve(root, p), enc);

const result = await build({
  entryPoints: [resolve(root, 'wheelie-life/js/main.js')],
  bundle: true,
  format: 'esm',          // main.js uses top-level await
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  alias: { three: resolve(root, 'vendor/three/three.module.js') },
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const hero = 'data:image/jpeg;base64,' + read('wheelie-life/assets/hero.jpg', null).toString('base64');
const css = read('wheelie-life/css/style.css').replace("url('../assets/hero.jpg')", `url('${hero}')`);
const bike = read('wheelie-life/assets/bike.json');

let html = read('wheelie-life/index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
swap('<script type="module" src="js/main.js"></script>', `<script>window.__BIKE__=${bike};</script>\n<script type="module">\n${js}</script>`);

mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/wheelie-life.html'), html);
console.log(`desktop/wheelie-life.html written (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
