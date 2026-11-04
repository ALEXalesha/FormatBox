// Распаковка на ПК: новая папка рядом с архивом (имя не занимает существующее), пути не выходят за неё.
import fs from 'node:fs';
import path from 'node:path';
import { archiveFolderName } from '../../web/core/names.js';

export function extractTo(entries, source, outDir) {
  const parent = outDir || path.dirname(source);
  let folder = null;
  for (let attempt = 0; attempt < 50 && !folder; attempt++) {
    const name = archiveFolderName(path.basename(source), new Set(fs.readdirSync(parent)));
    try { fs.mkdirSync(path.join(parent, name)); folder = path.join(parent, name); } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  if (!folder) throw new Error('no-free-name');
  let files = 0;
  for (const e of entries) {
    const dest = path.resolve(folder, e.path);
    if (!dest.startsWith(folder + path.sep)) continue;
    if (e.dir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data, { flag: 'wx' });
    if (e.mtime) fs.utimesSync(dest, new Date(e.mtime), new Date(e.mtime));
    files += 1;
  }
  return { path: folder, name: path.basename(folder), files };
}
