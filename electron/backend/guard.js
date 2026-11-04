// Что окно может трогать на диске. Окно (а с ним любая XSS или подменённая библиотека) не называет пути
// само: файлы попадают в список только из диалога или перетаскивания (preload), папки - из диалога.
import path from 'node:path';
import { FORMATS } from '../../web/core/formats.js';

export function createGuard() {
  const files = new Set();
  const dirs = new Set();
  const results = new Set();
  const norm = (p) => path.resolve(String(p));
  return {
    allowFile(p) { files.add(norm(p)); return norm(p); },
    allowDir(p) { dirs.add(norm(p)); return norm(p); },
    allowResult(p) { results.add(norm(p)); return p; },
    file(p) {
      const r = norm(p);
      if (typeof p !== 'string' || !files.has(r)) throw new Error('not-allowed');
      return r;
    },
    outDir(p) {
      if (p == null) return null;
      const r = norm(p);
      if (typeof p !== 'string' || !dirs.has(r)) throw new Error('not-allowed');
      return r;
    },
    result(p) {
      const r = norm(p);
      if (typeof p !== 'string' || !results.has(r)) throw new Error('not-allowed');
      return r;
    },
  };
}

// Расширение результата и метка в имени - только из известных: иначе to = '../x' уводило файл из папки
export function checkTarget(to) {
  if (typeof to !== 'string' || !Object.hasOwn(FORMATS, to)) throw new Error('bad-target');
  return to;
}

export function checkTag(tag = '') {
  if (typeof tag !== 'string' || !/^[\p{L}\p{N}_-]{0,24}$/u.test(tag)) throw new Error('bad-tag');
  return tag;
}
