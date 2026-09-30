// Builds desktop/outbuild.html: the whole of Outbuild (three.js, PeerJS for online play, code, models and
// textures) in one file that runs by double-clicking it, no web server needed.
//   npm install && npm run build:outbuild
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = resolve(root, 'outbuild');
const read = (p) => readFileSync(resolve(game, p), 'utf8');

const threePlugin = {
  name: 'three-vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: resolve(root, 'vendor/three/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (args) => ({ path: resolve(root, 'vendor/three', args.path.slice('three/'.length)) }));
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
// PeerJS (online play) goes in as a classic script so window.Peer is there before the game asks for it
const peerjs = readFileSync(resolve(root, 'vendor/peerjs.min.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '').replace(/<\/script/gi, '<\\/script');

// every model and texture as a data: URL
const assets = {};
for (const [dir, mime] of [['assets/models', 'model/gltf-binary'], ['assets/textures', 'image/jpeg']]) {
  for (const f of readdirSync(resolve(game, dir))) {
    const data = readFileSync(join(game, dir, f)).toString('base64');
    assets[`${dir}/${f}`] = `data:${mime};base64,${data}`;
  }
}

let html = read('index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${read('css/style.css')}</style>`);
swap(/\s*<script type="importmap">.*<\/script>/.exec(html)[0], '');
swap('<script type="module" src="js/main.js"></script>',
  `<script>window.__OUTBUILD_ASSETS = ${JSON.stringify(assets)};</script>\n  <script>\n${peerjs}\n</script>\n  <script>\n${js}</script>`);

mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/outbuild.html'), html);
console.log(`desktop/outbuild.html written (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
