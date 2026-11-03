// Копирует нужные файлы библиотек из node_modules в web/vendor/ - одинаковые пути
// для браузера, Worker, Electron и тестов в Node. Папка не хранится в git.
//   node tools/vendor.js           скопировать (пропускает неизменённые)
//   node tools/vendor.js --quiet   без вывода
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'web', 'vendor');
const quiet = process.argv.includes('--quiet');

export const FILES = [
  ['fflate/esm/browser.js', 'fflate.js'],
  ['earcut/src/earcut.js', 'earcut.js'],
  ['manifold-3d/manifold.js', 'manifold.js'],
  ['manifold-3d/manifold.wasm', 'manifold.wasm'],
  ['7z-wasm/7zz.es6.js', '7zz.js'],
  ['7z-wasm/7zz.wasm', '7zz.wasm'],
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.mjs'],
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.js'],
  ['@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit.js', 'umd'],
  ['heic2any/dist/heic2any.min.js', 'heic2any.js', 'umd'],
  ['@ffmpeg/ffmpeg/dist/esm', 'ffmpeg'],
  ['@ffmpeg/util/dist/esm', 'ffmpeg-util'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg-core/ffmpeg-core.js'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core/ffmpeg-core.wasm'],
];

// UMD-файл в модуль ES: тот же код видит module.exports и отдаёт его как default
function wrapUmd(src, dst) {
  const code = fs.readFileSync(src, 'utf8');
  const out = `const module = { exports: {} }; const exports = module.exports;\n${code}\nexport default module.exports;\n`;
  if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === out) return 0;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, out);
  return 1;
}

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(src)) if (!name.endsWith('.d.ts') && !name.endsWith('.map')) copy(path.join(src, name), path.join(dst, name));
    return 0;
  }
  if (fs.existsSync(dst) && fs.statSync(dst).size === st.size && fs.statSync(dst).mtimeMs >= st.mtimeMs) return 0;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return 1;
}

let copied = 0;
const missing = [];
for (const [from, to, kind] of FILES) {
  const src = path.join(NM, from);
  if (!fs.existsSync(src)) { missing.push(from); continue; }
  copied += kind === 'umd' ? wrapUmd(src, path.join(OUT, to)) : copy(src, path.join(OUT, to));
}
if (!quiet) console.log(`vendor: ${copied} files copied to web/vendor`);
if (missing.length) {
  console.error(`vendor: missing ${missing.join(', ')} - run npm install`);
  process.exit(1);
}
