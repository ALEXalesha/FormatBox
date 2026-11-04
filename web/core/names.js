// Имена результатов. Закон: результат не перетирает ни один существующий файл и не совпадает с источником.
const BAD = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function splitName(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

export function cleanStem(stem) {
  let s = String(stem).replace(BAD, '_').replace(/[. ]+$/, '').trim();
  if (!s) s = 'file';
  if (RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, 180);
}

// taken - Set имён в папке назначения (сравнение без учёта регистра, как в Windows и macOS)
export function uniqueName(wanted, taken) {
  const low = new Set([...taken].map((n) => n.toLowerCase()));
  const { stem, ext } = splitName(wanted);
  const tail = ext ? `.${ext}` : '';
  const base = cleanStem(stem);
  let name = base + tail;
  for (let i = 2; low.has(name.toLowerCase()); i++) name = `${base} (${i})${tail}`;
  return name;
}

// Имя результата для файла source: та же основа, новое расширение и метка, если формат тот же
export function outputName(source, ext, taken, tag = '') {
  const { stem, ext: oldExt } = splitName(source);
  const mark = tag || (oldExt.toLowerCase() === String(ext).toLowerCase() ? 'formatbox' : '');
  const wanted = `${stem}${mark ? `-${mark}` : ''}${ext ? `.${ext}` : ''}`;
  return uniqueName(wanted, taken);
}

// Папка для распаковки архива: имя архива без расширения (и без .tar.gz), не занятое в папке
export function archiveFolderName(archive, taken) {
  const low = String(archive).toLowerCase();
  const two = ['.tar.gz', '.tar.xz', '.tar.bz2'].find((x) => low.endsWith(x));
  const stem = two ? archive.slice(0, -two.length) : splitName(archive).stem;
  return uniqueName(stem, taken);
}
