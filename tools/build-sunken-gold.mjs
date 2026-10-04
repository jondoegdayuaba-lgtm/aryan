// Builds Sunken Gold for sharing:
//   sunken-gold/dist/          bundled web version (index.html, game.js, style.css, assets/) for any static host
//   desktop/sunken-gold.html   the whole game in one file, assets embedded, runs by double-clicking it
//   npm install && npm run build:sunken-gold
// The 3D assets themselves come from Blender: see sunken-gold/README.md.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, extname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = resolve(root, 'sunken-gold');
const read = (p) => readFileSync(resolve(game, p), 'utf8');

// 'three' and 'three/addons/...' resolve to the vendored copy at the repo root.
const threePlugin = {
  name: 'three',
  setup(b) {
    b.onResolve({ filter: /^three(\/addons\/.*)?$/ }, (a) => ({
      path: a.path === 'three' ? resolve(root, 'vendor/three/three.module.js') : resolve(root, 'vendor/three', a.path.slice('three/'.length)),
    }));
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
const js = result.outputFiles[0].text;

function page(scriptTags, css) {
  let html = read('index.html');
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
    html = html.replace(from, () => to);
  };
  swap('<link rel="stylesheet" href="css/style.css">', css);
  swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
  swap('<script type="module" src="js/main.js"></script>', scriptTags);
  return html;
}

// ---- web build
const dist = resolve(game, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(resolve(dist, 'game.js'), js);
writeFileSync(resolve(dist, 'style.css'), read('css/style.css'));
writeFileSync(resolve(dist, 'index.html'), page('<script src="game.js"></script>', '<link rel="stylesheet" href="style.css">'));
cpSync(resolve(game, 'assets'), resolve(dist, 'assets'), { recursive: true });
console.log(`sunken-gold/dist written (game.js ${(js.length / 1024).toFixed(0)} KB)`);

// ---- single file
const MIME = { '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png' };
const files = {};
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(resolve(game, 'assets'), p).split('\\').join('/')] = `data:${MIME[extname(f)] || 'application/octet-stream'};base64,${readFileSync(p).toString('base64')}`;
  }
};
walk(resolve(game, 'assets'));
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const single = page(
  `<script>window.SUNKEN_GOLD_FILES = ${JSON.stringify(files)};</script>\n<script>\n${safe(js)}</script>`,
  `<style>\n${read('css/style.css')}</style>`,
);
mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/sunken-gold.html'), single);
console.log(`desktop/sunken-gold.html written (${(single.length / 1024 / 1024).toFixed(1)} MB)`);
