// Архивы: узнать формат, распаковать, показать список, упаковать, перепаковать.
// Запись: { path, data: Uint8Array, mtime: Date|number, dir: boolean }; на выходе mtime - Date.
import { normalizeEntries, checkAbort, safePath } from './entries.js';
import { writeTar, readTar, isTar } from './tar.js';
import { writeZip, readZip, isZip, isGzip, peekGzip, readGzip, writeGzip } from './zip.js';
import { extract7z, pack7z } from './sevenzip.js';

export { normalizeEntries, safePath };

// Что умеем: read - распаковка, write - упаковка
export const archiveFormats = {
  zip: { ext: ['zip'], read: true, write: true },
  tar: { ext: ['tar'], read: true, write: true },
  'tar.gz': { ext: ['tar.gz', 'tgz'], read: true, write: true },
  '7z': { ext: ['7z'], read: true, write: true },
  gz: { ext: ['gz'], read: true, write: false },
  rar: { ext: ['rar'], read: true, write: false },
  'tar.xz': { ext: ['tar.xz', 'txz'], read: true, write: false },
  xz: { ext: ['xz'], read: true, write: false },
  'tar.bz2': { ext: ['tar.bz2', 'tbz2', 'tbz'], read: true, write: false },
  bz2: { ext: ['bz2'], read: true, write: false },
};

const startsWith = (b, sig) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
const named = (name, fmt) => archiveFormats[fmt].ext.some((e) => name.toLowerCase().endsWith(`.${e}`));

// Формат по сигнатуре (расширение лишь уточняет tar внутри xz/bz2); null - не архив
export function detectArchive(bytes, name = '') {
  if (isZip(bytes)) return 'zip';
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return named(name, 'tar.xz') ? 'tar.xz' : 'xz';
  if (startsWith(bytes, [0x42, 0x5a, 0x68])) return named(name, 'tar.bz2') ? 'tar.bz2' : 'bz2';
  if (isGzip(bytes)) return named(name, 'tar.gz') || isTar(peekGzip(bytes)) ? 'tar.gz' : 'gz';
  if (isTar(bytes)) return 'tar';
  return null;
}

// Имя файла для 7-Zip: с расширением формата, чтобы файл внутри .xz/.bz2 назвался правильно
function nameFor7z(name, fmt) {
  const base = safePath(name).split('/').pop() || 'archive';
  const ext = fmt.startsWith('tar.') ? fmt.slice(4) : fmt;
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

function onlyFile(entries) {
  const f = entries.find((e) => !e.dir);
  if (!f) throw new Error('archive: empty compressed file');
  return f;
}

export async function extract(bytes, name = '', { signal, progress } = {}) {
  checkAbort(signal);
  const fmt = detectArchive(bytes, name);
  if (!fmt) throw new Error('archive: unknown format');
  const opts = { signal };
  let raw;
  if (fmt === 'zip') raw = readZip(bytes, opts) ?? (await extract7z(bytes, nameFor7z(name, fmt), opts));
  else if (fmt === 'tar') raw = readTar(bytes, opts);
  else if (fmt === 'tar.gz') raw = readTar(readGzip(bytes).data, opts);
  else if (fmt === 'gz') {
    const g = readGzip(bytes);
    const fallback = safePath(name).split('/').pop().replace(/\.gz$/i, '') || 'file';
    raw = [{ path: g.name || fallback, data: g.data, mtime: g.mtime, dir: false }];
  } else if (fmt === 'tar.xz' || fmt === 'tar.bz2') {
    raw = readTar(onlyFile(await extract7z(bytes, nameFor7z(name, fmt), opts)).data, opts);
  } else raw = await extract7z(bytes, nameFor7z(name, fmt), opts);
  progress?.(1);
  return normalizeEntries(raw);
}

// Список без содержимого: { path, size, mtime, dir }
export async function list(bytes, name = '', opts = {}) {
  return (await extract(bytes, name, opts)).map((e) => ({ path: e.path, size: e.data.length, mtime: e.mtime, dir: e.dir }));
}

export async function pack(entries, format, { level = 6, signal, progress } = {}) {
  if (format === 'rar') throw new Error('rar: packing is not possible - the format is closed, there is no free packer');
  if (!archiveFormats[format]?.write) throw new Error(`archive: cannot pack ${format}`);
  checkAbort(signal);
  const list = normalizeEntries(entries);
  const opts = { level, signal, progress };
  if (format === 'zip') return writeZip(list, opts);
  if (format === 'tar') return writeTar(list, opts);
  if (format === 'tar.gz') return writeGzip(writeTar(list, opts), level);
  const out = await pack7z(list, opts);
  progress?.(1);
  return out;
}

export async function repack(bytes, name, toFormat, opts = {}) {
  return pack(await extract(bytes, name, { signal: opts.signal }), toFormat, opts);
}
