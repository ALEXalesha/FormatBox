// Сохранение результата: рядом с источником или в выбранной папке, без перетирания (закон).
import fs from 'node:fs';
import path from 'node:path';
import { outputName } from '../../web/core/names.js';

const exists = (err) => err.code === 'EEXIST';

// Свободное имя в папке. write(dest) кладёт файл и возвращает false, если имя успели занять (гонка) -
// тогда берётся следующее. list - чтение папки (подменяется в тестах гонки).
export function placeUnique({ dir, source, to, tag = '', write, list = (d) => fs.readdirSync(d) }) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = outputName(path.basename(source), to, new Set(list(dir)), tag);
    const dest = path.join(dir, name);
    if (write(dest)) return { path: dest, name };
  }
  throw new Error('no-free-name');
}

// Готовый временный файл -> в папку. link не перезаписывает существующее; между дисками - копия с COPYFILE_EXCL
export function saveResult(tmpFile, source, to, outDir, tag = '', list) {
  const placed = placeUnique({
    dir: outDir || path.dirname(source), source, to, tag, list,
    write: (dest) => {
      try { fs.linkSync(tmpFile, dest); return true; } catch (err) { if (exists(err)) return false; }
      try { fs.copyFileSync(tmpFile, dest, fs.constants.COPYFILE_EXCL); return true; } catch (err) { if (exists(err)) return false; throw err; }
    },
  });
  return { ...placed, bytes: fs.statSync(placed.path).size };
}

// Байты в файл (результаты ядра: картинки, 3D, архивы, документы)
export function saveBytes(bytes, source, to, outDir, tag = '', list) {
  const placed = placeUnique({
    dir: outDir || path.dirname(source), source, to, tag, list,
    write: (dest) => {
      try { fs.writeFileSync(dest, bytes, { flag: 'wx' }); return true; } catch (err) { if (exists(err)) return false; throw err; }
    },
  });
  return { ...placed, bytes: bytes.length };
}
