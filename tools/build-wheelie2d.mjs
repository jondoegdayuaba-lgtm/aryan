// Builds desktop/wheelie-life-2d.html: the whole 2D game in one file that runs by
// double-clicking it, no web server needed.   npm run build:wheelie2d
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
let html = read('wheelie-life-2d/index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="style.css">', `<style>\n${read('wheelie-life-2d/style.css')}</style>`);
swap('<script src="game.js"></script>', `<script>\n${read('wheelie-life-2d/game.js').replace(/<\/script/gi, '<\\/script')}</script>`);
mkdirSync(resolve(root, 'desktop'), { recursive: true });
writeFileSync(resolve(root, 'desktop/wheelie-life-2d.html'), html);
console.log(`desktop/wheelie-life-2d.html written (${(html.length / 1024).toFixed(0)} KB)`);
