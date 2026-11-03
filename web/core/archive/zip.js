// zip и gzip. Запись - через fflate (UTF-8 флаг имён, время в DOS-поле и точное в поле UT).
// Чтение zip - свой разбор центрального каталога: fflate теряет дубли имён и время.
import { zipSync, inflateSync, gunzipSync, gzipSync, Gunzip } from '../../vendor/fflate.js';
import { checkAbort, crc32, decodeName } from './entries.js';

const DOS_MIN = Date.UTC(1980, 0, 2);
const DOS_MAX = Date.UTC(2099, 11, 30);

function utField(ms) {
  const f = new Uint8Array(5);
  f[0] = 1; // есть время изменения
  const sec = Math.max(-0x80000000, Math.min(0x7fffffff, Math.floor(ms / 1000)));
  new DataView(f.buffer).setInt32(1, sec, true);
  return f;
}

export function writeZip(entries, { level = 6, signal, progress } = {}) {
  const files = {};
  entries.forEach((e, i) => {
    checkAbort(signal);
    const ms = e.mtime.getTime();
    const opts = {
      level: e.dir ? 0 : level,
      mtime: new Date(Math.max(DOS_MIN, Math.min(DOS_MAX, ms))),
      extra: { 0x5455: utField(ms) },
      os: 3,
      attrs: e.dir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0,
    };
    files[e.dir ? `${e.path}/` : e.path] = [e.dir ? new Uint8Array(0) : e.data, opts];
    progress?.((i + 1) / entries.length);
  });
  return zipSync(files);
}

function dosTime(date, time) {
  return new Date((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
}

function readExtra(b, from, to) {
  const out = {};
  for (let i = from; i + 4 <= to;) {
    const id = b[i] | (b[i + 1] << 8);
    const len = b[i + 2] | (b[i + 3] << 8);
    out[id] = b.subarray(i + 4, Math.min(to, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

// null - если нужен 7-Zip (zip64, шифрование, редкие методы сжатия)
export function readZip(b, { signal } = {}) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no central directory');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) return null;
  const out = [];
  for (let n = 0; n < count; n++) {
    checkAbort(signal);
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip: damaged central directory');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const attrs = v.getUint32(p + 38, true);
    const local = v.getUint32(p + 42, true);
    if ((flags & 1) || (method !== 0 && method !== 8) || csize === 0xffffffff || local === 0xffffffff) return null;
    const nameBytes = b.subarray(p + 46, p + 46 + nameLen);
    const extra = readExtra(b, p + 46 + nameLen, p + 46 + nameLen + extraLen);
    let path = decodeName(nameBytes, flags & 0x800);
    // Info-ZIP Unicode Path: точное имя в UTF-8 рядом со старым
    if (extra[0x7075]?.length > 5) path = new TextDecoder().decode(extra[0x7075].subarray(5));
    let mtime = dosTime(v.getUint16(p + 14, true), v.getUint16(p + 12, true));
    if (extra[0x5455]?.length >= 5 && (extra[0x5455][0] & 1)) {
      mtime = new DataView(extra[0x5455].buffer, extra[0x5455].byteOffset).getInt32(1, true) * 1000;
    }
    p += 46 + nameLen + extraLen + commentLen;
    const dir = path.endsWith('/') || (attrs & 0x10) !== 0 || ((attrs >>> 16) & 0o170000) === 0o40000;
    if (dir) { out.push({ path, data: new Uint8Array(0), mtime: new Date(mtime), dir: true }); continue; }
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`zip: damaged entry ${path}`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw.slice() : inflateSync(raw, { out: new Uint8Array(size) });
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip: damaged entry ${path}`);
    out.push({ path, data, mtime: new Date(mtime), dir: false });
  }
  return out;
}

export function isZip(b) {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x0403, 0x0605, 0x0807].includes(b[2] | (b[3] << 8));
}

export function isGzip(b) {
  return b.length >= 18 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 8;
}

// Первые байты распакованного gzip без распаковки целиком (чтобы узнать tar внутри)
export function peekGzip(b, want = 1024) {
  const out = [];
  let got = 0;
  const g = new Gunzip();
  g.ondata = (chunk) => { out.push(chunk); got += chunk.length; };
  try {
    for (let i = 0; i < Math.min(b.length, 65536) && got < want; i += 1024) g.push(b.subarray(i, i + 1024), false);
  } catch {
    // битые данные - просто «не tar»
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of out) { all.set(c, o); o += c.length; }
  return all.subarray(0, want);
}

// gzip: данные, имя (FNAME) и время из заголовка
export function readGzip(b) {
  const flags = b[3];
  const sec = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  let name = '';
  if (flags & 8) {
    let p = 10 + (flags & 4 ? 2 + (b[10] | (b[11] << 8)) : 0);
    const start = p;
    while (p < b.length && b[p] !== 0) p++;
    name = new TextDecoder('latin1').decode(b.subarray(start, p));
  }
  return { data: gunzipSync(b), name, mtime: new Date((sec >>> 0) * 1000) };
}

export function writeGzip(data, level = 6) {
  return gzipSync(data, { level, mtime: 0 });
}
