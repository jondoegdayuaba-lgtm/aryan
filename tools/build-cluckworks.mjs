// Packs cluckworks/ into one self-contained HTML file: desktop/cluckworks.html
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../cluckworks/', import.meta.url);
const read = f => readFileSync(new URL(f, dir), 'utf8');
// Keep "</script" from ending the inline block early.
const js = f => read(f).replace(/<\/script/gi, '<\\/script');

const html = read('index.html')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}</style>`)
  .replace('<script src="logic.js"></script>', () => `<script>\n${js('logic.js')}</script>`)
  .replace('<script src="ui.js"></script>', () => `<script>\n${js('ui.js')}</script>`);

if (/href="style.css"|src="(logic|ui).js"/.test(html)) throw new Error('an asset was not inlined');
writeFileSync(new URL('../desktop/cluckworks.html', import.meta.url), html);
console.log('wrote desktop/cluckworks.html');
