// Сборка сайта для GitHub Pages: web/ целиком (с web/vendor после tools/vendor.js) в dist/web.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'web');
if (!fs.existsSync(path.join(ROOT, 'web', 'vendor', 'ffmpeg-core', 'ffmpeg-core.wasm'))) {
  console.error('build-web: run node tools/vendor.js first');
  process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'web'), OUT, { recursive: true, filter: (src) => !src.endsWith('.map') });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
let files = 0, bytes = 0;
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else { files++; bytes += st.size; } } };
walk(OUT);
console.log(`build-web: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in dist/web`);
